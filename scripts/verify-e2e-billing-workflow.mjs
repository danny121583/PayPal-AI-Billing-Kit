#!/usr/bin/env node
/**
 * verify-e2e-billing-workflow.mjs
 *
 * Verifies the complete Provider-to-Customer conversational & PayPal Sandbox
 * billing lifecycle against `dvzfesfvefggnunkjhom`:
 *  1. Provider (Dr. Sarah Jenkins) asks Billing AI to create a $35.00 Forms Completion
 *     invoice for Alex Rivera -> AI creates proposal with ADMIN-FORMS ($35.00).
 *  2. Provider approves the proposal (`billing_decide_ai_proposal` + `billing_create_invoice`)
 *     -> Invoice is created & sent in DB, and an in-app notification is delivered to Alex Rivera.
 *  3. Customer (Alex Rivera) signs in -> sees the new $35.00 invoice & unread notification
 *     -> asks Billing AI to pay the $35.00 invoice -> approves checkout proposal ->
 *     checks `paypal-billing` Sandbox readiness endpoint.
 *  4. Provider voids the temporary test invoice (`billing_void_invoice`) -> status becomes
 *     `void` with $0.00 balance due.
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
}

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const DEMO_PASSWORD = process.env.DEMO_ACCOUNT_PASSWORD || 'DemoPayPalKit2026!';

function makeClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

let passed = 0;
let failed = 0;

function record(step, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`✅ PASS: ${step}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed += 1;
    console.error(`❌ FAIL: ${step}${detail ? ` — ${detail}` : ''}`);
  }
}

async function run() {
  console.log('==========================================================');
  console.log('PayPal AI Billing Kit — End-to-End Provider ↔ Customer Flow');
  console.log(`Target Supabase: ${SUPABASE_URL}`);
  console.log('==========================================================\n');

  // Step 1: Sign in as Provider (Dr. Sarah Jenkins)
  const providerClient = makeClient();
  const { data: sarahAuth, error: sarahErr } =
    await providerClient.auth.signInWithPassword({
      email: 'sarah.jenkins@demo.paypal-billing-kit.local',
      password: DEMO_PASSWORD,
    });
  record(
    '1. Provider (Dr. Sarah Jenkins) authenticated',
    !sarahErr && Boolean(sarahAuth?.user?.id),
    sarahAuth?.user?.email
  );

  // Step 2: Provider asks Billing AI to create a $35.00 Forms Completion invoice for Alex Rivera
  const { data: draftChatRes, error: draftChatErr } =
    await providerClient.functions.invoke('billing-ai-assistant', {
      body: {
        roleScope: 'doctor',
        message: 'Create a forms completion invoice for Alex Rivera',
      },
    });
  const proposal = draftChatRes?.reply?.proposal;
  const propAmountMinor = Number(
    proposal?.amount_minor ?? proposal?.payload?.unit_amount_minor ?? 0
  );
  record(
    '2. Billing AI prepares $35.00 Forms Completion (ADMIN-FORMS) proposal for Alex Rivera',
    !draftChatErr &&
      Boolean(proposal?.id) &&
      proposal?.payload?.service_code === 'ADMIN-FORMS' &&
      propAmountMinor === 3500,
    proposal
      ? `Proposal ${proposal.id}: ${proposal.payload.service_code} ($${(propAmountMinor / 100).toFixed(2)}) for ${proposal.payload.recipient_name}`
      : draftChatErr?.message || JSON.stringify(draftChatRes)
  );

  // Step 3: Provider approves proposal via `billing_decide_ai_proposal` + `billing_create_invoice`
  const { data: decidedProp, error: decideErr } = await providerClient.rpc(
    'billing_decide_ai_proposal',
    {
      p_proposal: proposal.id,
      p_decision: 'approve',
    }
  );
  const { data: createdInv, error: createInvErr } = await providerClient.rpc(
    'billing_create_invoice',
    {
      p_recipient: proposal.payload.recipient_user_id,
      p_items: [
        {
          service_code: proposal.payload.service_code,
          quantity: Number(proposal.payload.quantity || 1),
          unit_amount_minor: Number(
            proposal.payload.unit_amount_minor || propAmountMinor
          ),
        },
      ],
      p_due_date: proposal.payload.due_date,
      p_send: true,
      p_idempotency_key: `e2e-prop-${proposal.id}`,
      p_ai_proposal_id: proposal.id,
    }
  );
  const createdInvoiceNumber = createdInv?.invoice_number;
  const createdInvoiceId = createdInv?.id;
  record(
    '3. Provider approves proposal -> Invoice created & sent in database',
    !decideErr &&
      !createInvErr &&
      decidedProp?.status === 'approved' &&
      Boolean(createdInvoiceNumber),
    `Created Invoice #${createdInvoiceNumber} (${createdInvoiceId})`
  );

  // Step 4: Customer (Alex Rivera) signs in and verifies invoice + notification arrival
  const customerClient = makeClient();
  const { data: alexAuth, error: alexErr } =
    await customerClient.auth.signInWithPassword({
      email: 'alex.rivera@demo.paypal-billing-kit.local',
      password: DEMO_PASSWORD,
    });
  record(
    '4. Customer (Alex Rivera) authenticated',
    !alexErr && Boolean(alexAuth?.user?.id),
    alexAuth?.user?.email
  );

  const { data: alexNotifs } = await customerClient
    .from('billing_notifications')
    .select('*')
    .eq('event_key', `invoice_sent:${createdInvoiceId}`);
  record(
    '5. Customer receives real-time in-app billing notification for new $35.00 statement',
    Array.isArray(alexNotifs) && alexNotifs.length > 0,
    alexNotifs?.[0]?.body
  );

  // Step 6: Customer asks Billing AI to prepare checkout for the new invoice
  const { data: payChatRes, error: payChatErr } =
    await customerClient.functions.invoke('billing-ai-assistant', {
      body: {
        roleScope: 'patient',
        focusedInvoiceId: createdInvoiceId,
        message: `Pay invoice ${createdInvoiceNumber}`,
      },
    });
  const payProposal = payChatRes?.reply?.proposal;
  record(
    '6. Customer Billing AI prepares PayPal Sandbox checkout proposal for $35.00 statement',
    !payChatErr &&
      Boolean(payProposal?.id) &&
      payProposal?.kind === 'payment_checkout' &&
      Number(payProposal?.amount_minor) === 3500,
    payProposal
      ? `Checkout Proposal ${payProposal.id} for #${payProposal.payload.invoice_number} ($35.00)`
      : payChatErr?.message
  );

  // Step 7: Customer approves checkout proposal via `billing_decide_ai_proposal`
  const { data: payDecided, error: payDecideErr } = await customerClient.rpc(
    'billing_decide_ai_proposal',
    {
      p_proposal: payProposal.id,
      p_decision: 'approve',
    }
  );
  record(
    '7. Customer approves PayPal Sandbox checkout proposal',
    !payDecideErr && payDecided?.status === 'approved',
    `Proposal ${payDecided?.id} status=${payDecided?.status}`
  );

  // Step 8: Check PayPal Sandbox configuration status via `paypal-billing` Edge Function
  const { data: sbStatus } = await customerClient.functions.invoke(
    'paypal-billing',
    {
      body: { action: 'sandbox-status' },
    }
  );
  record(
    '8. PayPal Billing Edge Function responds with explicit Sandbox readiness status',
    Boolean(sbStatus && sbStatus.ok === true),
    `credentialsConfigured=${Boolean(sbStatus?.credentialsConfigured)}, missingSecrets=${JSON.stringify(sbStatus?.missingSecrets || [])}`
  );

  // Step 9: Clean up the temporary test invoice by voiding it as Provider so repeated runs stay clean
  await providerClient.rpc('billing_void_invoice', {
    p_invoice: createdInvoiceId,
  });
  const { data: voidedCheck } = await providerClient
    .from('billing_invoices')
    .select('status, balance_due_minor')
    .eq('id', createdInvoiceId)
    .single();
  record(
    '9. Voided invoice sets status="void" and balance_due_minor=0',
    voidedCheck?.status === 'void' && Number(voidedCheck?.balance_due_minor) === 0,
    `status=${voidedCheck?.status}, balance_due_minor=${voidedCheck?.balance_due_minor}`
  );

  console.log('\n==========================================================');
  console.log(`End-to-End Workflow Summary: ${passed} passed, ${failed} failed`);
  console.log('==========================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal error in verify-e2e-billing-workflow:', err);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * verify-security-and-rls.mjs
 *
 * Live security, Row-Level Security (RLS), and guardrail verification suite
 * against the dedicated standalone Supabase project (`dvzfesfvefggnunkjhom`).
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

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY');
  process.exit(1);
}

const TABLES = [
  'billing_accounts',
  'billing_organizations',
  'billing_organization_members',
  'billing_customer_links',
  'billing_account_connections',
  'billing_service_catalog',
  'billing_invoices',
  'billing_invoice_items',
  'billing_payment_attempts',
  'billing_transactions',
  'billing_refunds',
  'billing_webhook_events',
  'billing_ai_settings',
  'billing_ai_sessions',
  'billing_ai_messages',
  'billing_ai_action_proposals',
  'billing_audit_events',
  'billing_notifications',
];

function makeClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

let passed = 0;
let failed = 0;

function record(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`✅ PASS: ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed += 1;
    console.error(`❌ FAIL: ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function run() {
  console.log('==========================================================');
  console.log('PayPal AI Billing Kit — Live Security & RLS Verification');
  console.log(`Target Supabase: ${SUPABASE_URL}`);
  console.log('==========================================================\n');

  // 1. Verify anon access is denied / returns 0 rows on all 18 billing tables
  const anonClient = makeClient();
  for (const table of TABLES) {
    const { data, error } = await anonClient.from(table).select('*').limit(5);
    const blocked = Boolean(error) || !data || data.length === 0;
    record(
      `Anon denial on public.${table}`,
      blocked,
      error ? `Denied (${error.code || error.message})` : `0 rows visible to anon`
    );
  }

  // 2. Authenticate as Customer #1 (Alex Rivera) and verify cross-customer isolation
  const alexClient = makeClient();
  const { data: alexAuth, error: alexErr } =
    await alexClient.auth.signInWithPassword({
      email: 'alex.rivera@demo.paypal-billing-kit.local',
      password: DEMO_PASSWORD,
    });
  record(
    'Customer #1 (Alex Rivera) Supabase Auth sign-in',
    !alexErr && Boolean(alexAuth?.user?.id),
    alexAuth?.user?.id || alexErr?.message
  );

  const { data: alexInvoices } = await alexClient
    .from('billing_invoices')
    .select('id, invoice_number, recipient_user_id, status');
  const alexSeesJordan = (alexInvoices || []).some(
    (inv) => inv.recipient_user_id !== alexAuth.user.id
  );
  record(
    'Alex Rivera sees ONLY his own customer statements (zero Jordan Taylor invoices)',
    Array.isArray(alexInvoices) && alexInvoices.length >= 4 && !alexSeesJordan,
    `Alex visible invoices: ${(alexInvoices || []).map((i) => i.invoice_number).join(', ')}`
  );

  // 3. Authenticate as Customer #2 (Jordan Taylor) and verify cross-customer isolation
  const jordanClient = makeClient();
  const { data: jordanAuth, error: jordanErr } =
    await jordanClient.auth.signInWithPassword({
      email: 'jordan.taylor@demo.paypal-billing-kit.local',
      password: DEMO_PASSWORD,
    });
  record(
    'Customer #2 (Jordan Taylor) Supabase Auth sign-in',
    !jordanErr && Boolean(jordanAuth?.user?.id),
    jordanAuth?.user?.id || jordanErr?.message
  );

  const { data: jordanInvoices } = await jordanClient
    .from('billing_invoices')
    .select('id, invoice_number, recipient_user_id, status');
  const jordanSeesAlex = (jordanInvoices || []).some(
    (inv) => inv.recipient_user_id !== jordanAuth.user.id
  );
  record(
    'Jordan Taylor sees ONLY his own customer statements (zero Alex Rivera invoices)',
    Array.isArray(jordanInvoices) &&
      jordanInvoices.length >= 2 &&
      !jordanSeesAlex,
    `Jordan visible invoices: ${(jordanInvoices || []).map((i) => i.invoice_number).join(', ')}`
  );

  // 4. Verify Customer #2 cannot initiate a PayPal order for Customer #1's invoice
  const { data: crossPayData, error: crossPayErr } =
    await jordanClient.functions.invoke('paypal-billing', {
      body: {
        action: 'create-order',
        invoice_id: '44444444-4444-4444-8444-444444444401', // Alex Rivera's invoice
      },
    });
  const crossPayBlocked =
    Boolean(crossPayErr) || crossPayData?.ok === false;
  record(
    'Cross-customer payment attempt blocked (Jordan Taylor cannot pay Alex Rivera invoice)',
    crossPayBlocked,
    crossPayData?.code || crossPayData?.message || crossPayErr?.message
  );

  // 5. Authenticate as Provider B (Dr. Marcus Vance) and verify cross-organization isolation
  const vanceClient = makeClient();
  const { data: vanceAuth, error: vanceErr } =
    await vanceClient.auth.signInWithPassword({
      email: 'marcus.vance@demo.paypal-billing-kit.local',
      password: DEMO_PASSWORD,
    });
  record(
    'Provider B (Dr. Marcus Vance) Supabase Auth sign-in',
    !vanceErr && Boolean(vanceAuth?.user?.id),
    vanceAuth?.user?.id || vanceErr?.message
  );

  const { data: vanceInvoices } = await vanceClient
    .from('billing_invoices')
    .select('id, invoice_number, organization_id');
  const vanceSeesJenkins = (vanceInvoices || []).some(
    (inv) => inv.organization_id === '22222222-2222-4222-8222-222222222201'
  );
  record(
    'Cross-provider RLS isolation (Dr. Marcus Vance sees 0 Dr. Sarah Jenkins invoices)',
    !vanceSeesJenkins && (vanceInvoices || []).length === 0,
    `Dr. Vance visible Jenkins invoices: ${(vanceInvoices || []).length}`
  );

  // 6. Authenticate as Primary Provider (Dr. Sarah Jenkins) & verify payment-state protection
  const sarahClient = makeClient();
  const { data: sarahAuth, error: sarahErr } =
    await sarahClient.auth.signInWithPassword({
      email: 'sarah.jenkins@demo.paypal-billing-kit.local',
      password: DEMO_PASSWORD,
    });
  record(
    'Primary Provider (Dr. Sarah Jenkins) Supabase Auth sign-in',
    !sarahErr && Boolean(sarahAuth?.user?.id),
    sarahAuth?.user?.id || sarahErr?.message
  );

  // Attempt to void a PAID invoice (PPB-INV-2026-1003) -> must be rejected by DB RPC
  const { error: voidPaidErr } = await sarahClient.rpc('billing_void_invoice', {
    p_invoice: '44444444-4444-4444-8444-444444444403',
  });
  record(
    'Payment-state protection: Paid invoice PPB-INV-2026-1003 cannot be voided',
    Boolean(voidPaidErr),
    voidPaidErr?.message || 'Unexpectedly allowed'
  );

  // 7. Verify Billing AI guardrail blocks a $600.00 single-action invoice proposal (> $500 cap)
  const { data: aiCapRes } = await sarahClient.functions.invoke(
    'billing-ai-assistant',
    {
      body: {
        action: 'chat',
        role_scope: 'doctor',
        message: 'Create a $600.00 telehealth invoice for Alex Rivera',
      },
    }
  );
  const proposalCreatedFor600 = Boolean(aiCapRes?.reply?.proposal);
  record(
    'AI Monetary Velocity Guardrail: $600.00 invoice request blocked by $500.00 single-action cap',
    !proposalCreatedFor600 &&
      String(aiCapRes?.reply?.content || '').includes('500.00'),
    String(aiCapRes?.reply?.content || '').slice(0, 110)
  );

  console.log('\n==========================================================');
  console.log(`Security & RLS Summary: ${passed} passed, ${failed} failed`);
  console.log('==========================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal error in verify-security-and-rls:', err);
  process.exit(1);
});

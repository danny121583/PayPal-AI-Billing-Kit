#!/usr/bin/env node
/**
 * PayPal AI Billing Kit — Live Gemini AI & Backend Security Verification Suite
 * Verifies Section 6 (Genuine Gemini 2.5 Flash AI + Guardrails) and
 * Section 7 (Database-Backed Proposal Security, Cross-Session & Cross-User Isolation).
 */
import fs from 'node:fs';
import path from 'node:path';

function parseEnvFile(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq > 0) out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return out;
}

const env = parseEnvFile(path.resolve(process.cwd(), '.env'));
const SUPABASE_URL = env.EXPO_PUBLIC_SUPABASE_URL || 'https://dvzfesfvefggnunkjhom.supabase.co';
const ANON_KEY = env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

const PROVIDER_ID = '11111111-1111-4111-8111-111111111101';
const ALEX_ID = '11111111-1111-4111-8111-111111111102';
const JORDAN_ID = '11111111-1111-4111-8111-111111111103';

let passed = 0;
let failed = 0;

function assert(condition, label, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ✅ PASS: ${label}${detail ? ` (${detail})` : ''}`);
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function callEdgeFunction(slug, body) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${slug}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function main() {
  console.log('======================================================================');
  console.log('PayPal AI Billing Kit — Gemini 2.5 Flash AI & Security Audit Suite');
  console.log('======================================================================\n');

  const sessionA = `sec-ai-a-${Date.now()}`;
  const sessionB = `sec-ai-b-${Date.now()}`;

  // ---------------------------------------------------------------------------
  // PART 1: GENUINE GEMINI 2.5 FLASH AI VERIFICATION (SECTION 6)
  // ---------------------------------------------------------------------------
  console.log('1. Live Gemini 2.5 Flash Conversational Billing AI (Section 6)');

  // 1a. Natural-language analytical question -> invokes gemini-2.5-flash
  const q1 = await callEdgeFunction('billing-ai-assistant', {
    roleScope: 'doctor',
    userId: PROVIDER_ID,
    demoSessionId: sessionA,
    message: "Why did Jordan Taylor's payment attempt fail and which statements are currently overdue?",
  });
  const q1Text = String(q1.data?.reply?.content || '');
  assert(
    q1.status === 200 &&
      q1.data?.geminiConfigured === true &&
      q1.data?.aiEngine === 'gemini-2.5-flash' &&
      /1002|1004|Jordan|PAYPAL_INSTRUMENT_DECLINED|overdue/i.test(q1Text),
    'Gemini 2.5 Flash live inference on contextual billing question',
    `aiEngine=${q1.data?.aiEngine}, geminiConfigured=${q1.data?.geminiConfigured}`
  );

  // 1b. Natural-language invoice creation phrasing
  const q2 = await callEdgeFunction('billing-ai-assistant', {
    roleScope: 'doctor',
    userId: PROVIDER_ID,
    demoSessionId: sessionA,
    sessionId: q1.data?.sessionId,
    message: 'Can you bill Alex Rivera $35 for completing his paperwork?',
  });
  const q2Prop = q2.data?.proposal || q2.data?.reply?.proposal;
  assert(
    q2.status === 200 &&
      q2Prop?.kind === 'create_invoice' &&
      Number(q2Prop?.amountMinor ?? q2Prop?.payload?.unit_amount_minor) === 3500 &&
      String(q2Prop?.payload?.recipient_name || '') === 'Alex Rivera',
    'Natural-language invoice proposal phrasing ("bill Alex Rivera $35 for completing his paperwork")',
    `amount=$${Number(q2Prop?.amountMinor || 0) / 100}, serviceCode=${q2Prop?.payload?.service_code}`
  );

  // 1c. Conversational mistake correction in the same AI session
  const q3 = await callEdgeFunction('billing-ai-assistant', {
    roleScope: 'doctor',
    userId: PROVIDER_ID,
    demoSessionId: sessionA,
    sessionId: q2.data?.sessionId,
    message: 'Actually change that to $45 for Jordan Taylor instead',
  });
  const q3Prop = q3.data?.proposal || q3.data?.reply?.proposal;
  assert(
    q3.status === 200 &&
      q3Prop?.kind === 'create_invoice' &&
      Number(q3Prop?.amountMinor ?? q3Prop?.payload?.unit_amount_minor) === 4500 &&
      String(q3Prop?.payload?.recipient_name || '') === 'Jordan Taylor',
    'Conversational mistake correction ("Actually change that to $45 for Jordan Taylor instead")',
    `amount=$${Number(q3Prop?.amountMinor || 0) / 100}, recipient=${q3Prop?.payload?.recipient_name}`
  );

  // 1d. Focused invoice explanation
  const q4 = await callEdgeFunction('billing-ai-assistant', {
    roleScope: 'patient',
    userId: ALEX_ID,
    demoSessionId: sessionA,
    message: 'Explain the charges and status on statement #PPB-INV-2026-1001.',
  });
  const q4Text = String(q4.data?.reply?.content || '');
  assert(
    q4.status === 200 &&
      /PPB-INV-2026-1001/i.test(q4Text) &&
      /150\.00/.test(q4Text),
    'Focused statement explanation (#PPB-INV-2026-1001)',
    'Verified $150.00 balance & line items explained'
  );

  // 1e. Clinical / PHI boundary refusal
  const q5 = await callEdgeFunction('billing-ai-assistant', {
    roleScope: 'doctor',
    userId: PROVIDER_ID,
    demoSessionId: sessionA,
    message: "What is Alex Rivera's blood pressure and medication dosage?",
  });
  const q5Text = String(q5.data?.reply?.content || '');
  assert(
    q5.status === 200 &&
      /strictly isolated to administrative billing|cannot access or discuss clinical/i.test(q5Text) &&
      !q5.data?.proposal,
    'Sensitive clinical/medical query refusal boundary',
    'Refused clinical query with zero financial proposal'
  );

  // ---------------------------------------------------------------------------
  // PART 2: DIRECT EDGE FUNCTION SECURITY & ISOLATION VERIFICATION (SECTION 7)
  // ---------------------------------------------------------------------------
  console.log('\n2. Backend Proposal Validation, Session Isolation & Cross-User Access Controls (Section 7)');

  // 2a. Prepare a database-backed proposal in sessionA
  const prepA = await callEdgeFunction('billing-maas-mcp', {
    tool: 'create_invoice_proposal',
    demo_session_id: sessionA,
    arguments: {
      demo_session_id: sessionA,
      customer_name: 'Alex Rivera',
      amount_minor: 3500,
      service_code: 'ADMIN-FORMS',
    },
  });
  const proposalIdA = prepA.data?.proposal?.id;
  assert(
    prepA.status === 200 && prepA.data?.ok === true && Boolean(proposalIdA),
    'Database-backed proposal created in sessionA',
    `proposal_id=${proposalIdA}`
  );

  // 2b. Attempt direct create_approved_invoice WITHOUT proposal_id -> blocked
  const noProp = await callEdgeFunction('billing-maas-mcp', {
    tool: 'create_approved_invoice',
    demo_session_id: sessionA,
    arguments: {
      demo_session_id: sessionA,
      explicit_human_approval: true,
    },
  });
  assert(
    noProp.status === 400 && noProp.data?.error_code === 'PROPOSAL_ID_REQUIRED',
    'Direct Edge Function call without proposal_id is blocked',
    `status=${noProp.status}, error_code=${noProp.data?.error_code}`
  );

  // 2c. Attempt cross-session proposal approval (sessionB tries to approve sessionA proposal) -> blocked
  const crossSessProp = await callEdgeFunction('billing-maas-mcp', {
    tool: 'create_approved_invoice',
    demo_session_id: sessionB,
    arguments: {
      demo_session_id: sessionB,
      proposal_id: proposalIdA,
      explicit_human_approval: true,
    },
  });
  assert(
    crossSessProp.status === 400 && crossSessProp.data?.error_code === 'CROSS_SESSION_PROPOSAL_ACCESS_DENIED',
    'Cross-session proposal approval (sessionB approving sessionA proposal) is blocked',
    `status=${crossSessProp.status}, error_code=${crossSessProp.data?.error_code}`
  );

  // 2d. Legitimate approval in sessionA -> succeeds and creates invoice
  const approveA = await callEdgeFunction('billing-maas-mcp', {
    tool: 'create_approved_invoice',
    demo_session_id: sessionA,
    arguments: {
      demo_session_id: sessionA,
      proposal_id: proposalIdA,
      explicit_human_approval: true,
    },
  });
  const createdInvoiceIdA = approveA.data?.invoice?.id;
  const createdInvoiceNumA = approveA.data?.invoice?.invoice_number;
  assert(
    approveA.status === 200 &&
      approveA.data?.ok === true &&
      Boolean(createdInvoiceIdA),
    'Legitimate human-approved proposal creates invoice in sessionA',
    `invoice_number=${createdInvoiceNumA}, id=${createdInvoiceIdA}`
  );

  // 2e. Duplicate approval replay of the same proposal_id -> blocked
  const replayA = await callEdgeFunction('billing-maas-mcp', {
    tool: 'create_approved_invoice',
    demo_session_id: sessionA,
    arguments: {
      demo_session_id: sessionA,
      proposal_id: proposalIdA,
      explicit_human_approval: true,
    },
  });
  assert(
    replayA.status === 400 && replayA.data?.error_code === 'DUPLICATE_APPROVAL_BLOCKED',
    'Duplicate proposal replay on direct Edge Function is blocked',
    `status=${replayA.status}, error_code=${replayA.data?.error_code}`
  );

  // 2f. Canonical mutation attempt on direct Edge Function -> blocked
  const canonicalMut = await callEdgeFunction('billing-maas-mcp', {
    tool: 'create_invoice_proposal',
    demo_session_id: 'canonical',
    arguments: {
      demo_session_id: 'canonical',
      customer_name: 'Alex Rivera',
      amount_minor: 3500,
    },
  });
  assert(
    canonicalMut.status === 400 && canonicalMut.data?.error_code === 'CANONICAL_MUTATION_FORBIDDEN',
    'Direct Edge Function mutation against canonical session is blocked',
    `status=${canonicalMut.status}, error_code=${canonicalMut.data?.error_code}`
  );

  // 2g. Guardrail bypass parameter attempt on direct Edge Function -> blocked
  const bypassAttempt = await callEdgeFunction('billing-maas-mcp', {
    tool: 'create_invoice_proposal',
    demo_session_id: sessionA,
    arguments: {
      demo_session_id: sessionA,
      customer_name: 'Alex Rivera',
      amount_minor: 3500,
      bypass_guardrail: true,
    },
  });
  assert(
    bypassAttempt.status === 400 && bypassAttempt.data?.error_code === 'GUARDRAIL_BYPASS_REJECTED',
    'Direct Edge Function guardrail bypass parameter is rejected',
    `status=${bypassAttempt.status}, error_code=${bypassAttempt.data?.error_code}`
  );

  // 2h. Cross-recipient payment attempt on paypal-billing (Jordan Taylor trying to pay Alex Rivera invoice) -> blocked (403)
  const crossUserOrder = await callEdgeFunction('paypal-billing', {
    action: 'create-order',
    invoiceId: createdInvoiceIdA,
    demoSessionId: sessionA,
    userId: JORDAN_ID,
  });
  assert(
    crossUserOrder.status === 403 && crossUserOrder.data?.code === 'FORBIDDEN_RECIPIENT',
    'Cross-user payment attempt (Jordan Taylor paying Alex Rivera invoice) is blocked',
    `status=${crossUserOrder.status}, code=${crossUserOrder.data?.code}`
  );

  // 2i. Cross-session payment attempt on paypal-billing (sessionB trying to pay sessionA invoice) -> blocked (403)
  const crossSessionOrder = await callEdgeFunction('paypal-billing', {
    action: 'create-order',
    invoiceId: createdInvoiceIdA,
    demoSessionId: sessionB,
    userId: ALEX_ID,
  });
  assert(
    crossSessionOrder.status === 403 && crossSessionOrder.data?.code === 'CROSS_SESSION_INVOICE_ACCESS_DENIED',
    'Cross-session payment attempt (sessionB paying sessionA invoice) is blocked',
    `status=${crossSessionOrder.status}, code=${crossSessionOrder.data?.code}`
  );

  // 2j. Canonical seed invoice payment attempt on paypal-billing -> blocked (403)
  const canonicalSearch = await callEdgeFunction('billing-maas-mcp', {
    tool: 'search_invoices',
    demo_session_id: sessionA,
    arguments: { demo_session_id: sessionA },
  });
  const canonicalInvoice = (canonicalSearch.data?.invoices || []).find(
    (inv) => inv.invoice_number === 'PPB-INV-2026-1001'
  );
  const canonicalOrder = await callEdgeFunction('paypal-billing', {
    action: 'create-order',
    invoiceId: canonicalInvoice?.id,
    userId: ALEX_ID,
  });
  assert(
    canonicalOrder.status === 403 && canonicalOrder.data?.code === 'CANONICAL_MUTATION_FORBIDDEN',
    'Direct PayPal order creation on canonical seed invoice is blocked',
    `status=${canonicalOrder.status}, code=${canonicalOrder.data?.code}`
  );

  // 2k. Invalid/unauthenticated webhook call on paypal-webhook -> blocked (400 or 503)
  const webhookSpoof = await callEdgeFunction('paypal-webhook', {
    id: 'WH-SPOOF-TEST-001',
    event_type: 'PAYMENT.CAPTURE.COMPLETED',
    resource: { id: 'FAKE-CAPTURE' },
  });
  assert(
    (webhookSpoof.status === 400 || webhookSpoof.status === 503 || webhookSpoof.status === 401) &&
      webhookSpoof.data?.ok === false,
    'Spoofed / unsigned PayPal webhook event is rejected before state change',
    `status=${webhookSpoof.status}, code=${webhookSpoof.data?.code}`
  );

  // 2l. Public anon PostgREST read/write against billing_platform_secrets -> blocked
  const anonSecretProbe = await fetch(`${SUPABASE_URL}/rest/v1/billing_platform_secrets?select=*`, {
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
    },
  });
  const anonSecretBody = await anonSecretProbe.json().catch(() => null);
  assert(
    anonSecretProbe.status === 401 ||
      anonSecretProbe.status === 403 ||
      (Array.isArray(anonSecretBody) && anonSecretBody.length === 0) ||
      Boolean(anonSecretBody?.code),
    'Public visitor / anon access to billing_platform_secrets table is blocked',
    `HTTP ${anonSecretProbe.status}, code=${anonSecretBody?.code || '0 rows'}`
  );

  // 2m. Anonymous caller invoking sync-platform-secrets -> blocked (401 ANONYMOUS_SETUP_FORBIDDEN)
  const anonSyncAttempt = await callEdgeFunction('paypal-billing', {
    action: 'sync-platform-secrets',
    syncNonce: 'forged-nonce',
    secrets: { PAYPAL_SANDBOX_CLIENT_ID: 'forged' },
  });
  assert(
    anonSyncAttempt.status === 401 && anonSyncAttempt.data?.code === 'ANONYMOUS_SETUP_FORBIDDEN',
    'Anonymous caller cannot invoke credential setup (sync-platform-secrets)',
    `status=${anonSyncAttempt.status}, code=${anonSyncAttempt.data?.code}`
  );

  // 2n. Authenticated non-owner customer (Alex Rivera) invoking sync-platform-secrets -> blocked (403 FORBIDDEN_NOT_OWNER)
  const customerAuthRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
    body: JSON.stringify({
      email: 'alex.rivera@demo.paypal-billing-kit.local',
      password: env.DEMO_ACCOUNT_PASSWORD || 'DemoPayPalKit2026!',
    }),
  });
  const customerAuthData = await customerAuthRes.json().catch(() => ({}));
  const customerSyncRes = await fetch(`${SUPABASE_URL}/functions/v1/paypal-billing`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON_KEY,
      Authorization: `Bearer ${customerAuthData.access_token || ANON_KEY}`,
    },
    body: JSON.stringify({
      action: 'sync-platform-secrets',
      syncNonce: 'forged-nonce',
      secrets: { PAYPAL_SANDBOX_CLIENT_ID: 'forged' },
    }),
  });
  const customerSyncBody = await customerSyncRes.json().catch(() => ({}));
  assert(
    customerSyncRes.status === 403 && customerSyncBody?.code === 'FORBIDDEN_NOT_OWNER',
    'Authenticated non-owner customer cannot invoke credential setup',
    `status=${customerSyncRes.status}, code=${customerSyncBody?.code}`
  );

  // 2o. Authenticated provider owner invoking sync-platform-secrets with invalid nonce -> blocked (403 FORBIDDEN_SYNC)
  const ownerAuthRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
    body: JSON.stringify({
      email: 'sarah.jenkins@demo.paypal-billing-kit.local',
      password: env.DEMO_ACCOUNT_PASSWORD || 'DemoPayPalKit2026!',
    }),
  });
  const ownerAuthData = await ownerAuthRes.json().catch(() => ({}));
  const ownerBadNonceRes = await fetch(`${SUPABASE_URL}/functions/v1/paypal-billing`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON_KEY,
      Authorization: `Bearer ${ownerAuthData.access_token || ANON_KEY}`,
    },
    body: JSON.stringify({
      action: 'sync-platform-secrets',
      syncNonce: 'invalid-nonce-value',
      secrets: { PAYPAL_SANDBOX_CLIENT_ID: 'forged' },
    }),
  });
  const ownerBadNonceBody = await ownerBadNonceRes.json().catch(() => ({}));
  assert(
    ownerBadNonceRes.status === 403 && ownerBadNonceBody?.code === 'FORBIDDEN_SYNC',
    'Authenticated owner without valid 256-bit setup nonce is blocked from credential sync',
    `status=${ownerBadNonceRes.status}, code=${ownerBadNonceBody?.code}`
  );

  // Cleanup test sessions
  await callEdgeFunction('billing-maas-mcp', {
    tool: 'reset_demo_session',
    demo_session_id: sessionA,
    arguments: { demo_session_id: sessionA },
  });
  await callEdgeFunction('billing-maas-mcp', {
    tool: 'reset_demo_session',
    demo_session_id: sessionB,
    arguments: { demo_session_id: sessionB },
  });

  console.log('\n======================================================================');
  console.log(`SUMMARY: ${passed}/${passed + failed} checks passed (${failed} failed)`);
  console.log('======================================================================');
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

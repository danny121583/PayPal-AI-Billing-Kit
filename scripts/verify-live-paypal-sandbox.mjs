#!/usr/bin/env node
/**
 * PayPal AI Billing Kit — End-to-End Live PayPal Sandbox Verification Script
 * Covers Sections 3, 4 & 5:
 *   1. Syncs PAYPAL_SANDBOX_CLIENT_ID / PAYPAL_SANDBOX_CLIENT_SECRET / PAYPAL_SANDBOX_WEBHOOK_ID from .env
 *   2. Verifies PayPal Sandbox OAuth token handshake (https://api-m.sandbox.paypal.com/v1/oauth2/token)
 *   3. Connects Merchant (Dr. Sarah Jenkins) & Buyer (Alex Rivera) Sandbox accounts
 *   4. Issues a $35.00 invoice (ADMIN-FORMS) via AI Proposal -> Human Approval
 *   5. Creates a real PayPal Orders v2 order (create-order) and prints the Sandbox buyer approvalUrl
 *   6. Captures the approved order (--capture <orderId> --invoice <invoiceId>) and optionally refunds (--refund)
 *
 * Security invariant: Never prints or logs any secret values.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

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

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : null;
}

async function main() {
  console.log('======================================================================');
  console.log('PayPal AI Billing Kit — Live PayPal Sandbox Transaction Verifier');
  console.log('======================================================================\n');

  // Step 0: Sync local .env secrets into billing_platform_secrets
  spawnSync('node', ['scripts/sync-local-env-secrets.mjs'], { stdio: 'inherit' });

  // Step 1: Check PayPal Sandbox status & OAuth handshake
  console.log('\n[Step 1] Checking PayPal Sandbox OAuth & Credential Status...');
  const statusRes = await callEdgeFunction('paypal-billing', {
    action: 'sandbox-status',
    roleScope: 'doctor',
    userId: PROVIDER_ID,
  });
  const st = statusRes.data || {};
  console.log(`  • Environment:            ${st.environment || 'sandbox'}`);
  console.log(`  • PayPal API Base URL:    ${st.apiBaseUrl || 'https://api-m.sandbox.paypal.com'}`);
  console.log(`  • Credentials Configured: ${Boolean(st.credentialsConfigured)}`);
  console.log(`  • Webhook ID Configured:  ${Boolean(st.webhookConfigured)}`);
  console.log(`  • OAuth Token Reachable:  ${Boolean(st.oauthReachable)}`);
  if (st.appId) console.log(`  • PayPal Sandbox App ID:  ${st.appId}`);
  if (st.oauthError) console.log(`  • OAuth Diagnostic:       ${st.oauthError}`);

  if (!st.credentialsConfigured || !st.oauthReachable) {
    console.log('\n⚠️  ACTION REQUIRED TO COMPLETE LIVE PAYPAL SANDBOX CHECKOUT:');
    console.log('   1. Open .env in the project root');
    console.log('   2. Paste your PayPal Developer Sandbox Default Application credentials:');
    console.log('        PAYPAL_SANDBOX_CLIENT_ID=<your_sandbox_client_id>');
    console.log('        PAYPAL_SANDBOX_CLIENT_SECRET=<your_sandbox_client_secret>');
    console.log('        PAYPAL_SANDBOX_WEBHOOK_ID=<optional_sandbox_webhook_id>');
    console.log('   3. Re-run: node scripts/verify-live-paypal-sandbox.mjs');
    process.exit(0);
  }

  const captureOrderId = getArg('--capture');
  const targetInvoiceId = getArg('--invoice');
  const shouldRefund = process.argv.includes('--refund');

  if (captureOrderId && targetInvoiceId) {
    console.log(`\n[Capture Mode] Capturing approved PayPal Order ${captureOrderId} for Invoice ${targetInvoiceId}...`);
    const capRes = await callEdgeFunction('paypal-billing', {
      action: 'capture-order',
      invoiceId: targetInvoiceId,
      orderId: captureOrderId,
      userId: ALEX_ID,
    });
    console.log('  • Capture Response:', JSON.stringify(capRes.data, null, 2));

    if (capRes.data?.ok && shouldRefund) {
      const refundMinor = Number(getArg('--refund-minor') || 0) || undefined;
      console.log(`\n[Refund Mode] Issuing PayPal Sandbox Refund on Invoice ${targetInvoiceId}...`);
      const refRes = await callEdgeFunction('paypal-billing', {
        action: 'refund-capture',
        invoiceId: targetInvoiceId,
        amountMinor: refundMinor,
        roleScope: 'doctor',
        userId: PROVIDER_ID,
      });
      console.log('  • Refund Response:', JSON.stringify(refRes.data, null, 2));
    }
    return;
  }

  // Step 2: Connect Merchant & Buyer Sandbox Accounts
  console.log('\n[Step 2] Connecting Provider Merchant & Customer Buyer PayPal Sandbox Accounts...');
  const merchConn = await callEdgeFunction('paypal-billing', {
    action: 'connect-account',
    roleScope: 'doctor',
    userId: PROVIDER_ID,
  });
  console.log(
    `  • Merchant Connection: status=${merchConn.data?.connection?.status}, email=${merchConn.data?.connection?.paypal_email_masked}`
  );

  const buyerConn = await callEdgeFunction('paypal-billing', {
    action: 'connect-account',
    roleScope: 'patient',
    userId: ALEX_ID,
  });
  console.log(
    `  • Buyer Connection:    status=${buyerConn.data?.connection?.status}, payer_id=${buyerConn.data?.connection?.paypal_payer_id}`
  );

  // Step 3: Create $35.00 Invoice via AI Proposal -> Human Approval
  const demoSessionId = getArg('--session') || `live-sbx-${Date.now()}`;
  console.log(`\n[Step 3] Creating $35.00 Forms Completion Invoice in session "${demoSessionId}"...`);
  const propRes = await callEdgeFunction('billing-maas-mcp', {
    tool: 'create_invoice_proposal',
    demo_session_id: demoSessionId,
    arguments: {
      demo_session_id: demoSessionId,
      customer_name: 'Alex Rivera',
      amount_minor: 3500,
      service_code: 'ADMIN-FORMS',
    },
  });
  const proposalId = propRes.data?.proposal?.id;
  console.log(`  • AI Proposal Prepared: id=${proposalId} ($35.00 USD)`);

  const invRes = await callEdgeFunction('billing-maas-mcp', {
    tool: 'create_approved_invoice',
    demo_session_id: demoSessionId,
    arguments: {
      demo_session_id: demoSessionId,
      proposal_id: proposalId,
      explicit_human_approval: true,
    },
  });
  const invoice = invRes.data?.invoice;
  console.log(`  • Approved Invoice Created: #${invoice?.invoice_number} (id=${invoice?.id}, total=${invoice?.total_usd})`);

  // Step 4: Create Real PayPal Orders v2 Sandbox Order
  console.log('\n[Step 4] Creating Real PayPal Sandbox Order (Orders v2)...');
  const orderRes = await callEdgeFunction('paypal-billing', {
    action: 'create-order',
    invoiceId: invoice?.id,
    demoSessionId,
    userId: ALEX_ID,
  });
  console.log('  • PayPal Order Result:', JSON.stringify(orderRes.data, null, 2));

  if (orderRes.data?.ok && orderRes.data?.approvalUrl) {
    console.log('\n======================================================================');
    console.log('✅ REAL PAYPAL SANDBOX ORDER CREATED');
    console.log(`   Order ID:     ${orderRes.data.orderId}`);
    console.log(`   Invoice ID:   ${invoice.id} (#${invoice.invoice_number})`);
    console.log(`   Approval URL: ${orderRes.data.approvalUrl}`);
    console.log('\n👉 Open the Approval URL above in your browser, log in with your PayPal');
    console.log('   Sandbox personal buyer account, and click Complete Purchase.');
    console.log('   Then run:');
    console.log(
      `   node scripts/verify-live-paypal-sandbox.mjs --capture ${orderRes.data.orderId} --invoice ${invoice.id} --refund`
    );
    console.log('======================================================================');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

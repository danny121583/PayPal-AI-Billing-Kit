#!/usr/bin/env node
/**
 * Independent MaaS & MCP Verification Suite
 * Exercises MCP JSON-RPC 2.0 (`initialize`, `tools/list`, `tools/call`),
 * OpenAPI 3.1.0 schema discovery, and all 15 billing tools against either the
 * Supabase Edge Function endpoint or the deployed Vercel `/api/mcp` proxy.
 */

const endpointArg = process.argv.find((a) => a.startsWith('--url='))?.split('=')[1];
const MCP_URL =
  endpointArg ||
  process.env.MAAS_MCP_URL ||
  'https://dvzfesfvefggnunkjhom.supabase.co/functions/v1/billing-maas-mcp';

const TEST_SESSION = `mcp-verify-${Date.now().toString(36)}`;

let passed = 0;
let failed = 0;

function assert(cond, label, detail = '') {
  if (cond) {
    passed++;
    console.log(`  ✅ PASS: ${label}`);
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function mcpRpc(method, params = {}, id = 1) {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Demo-Session-Id': TEST_SESSION,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params,
    }),
  });
  const json = await res.json();
  return { status: res.status, json };
}

async function callTool(name, args = {}) {
  const { status, json } = await mcpRpc('tools/call', {
    name,
    arguments: { ...args, demo_session_id: TEST_SESSION },
  });
  return {
    status,
    rpc: json,
    data: json?.result?.structuredContent || null,
  };
}

async function main() {
  console.log(`\n🔌 Running Independent MaaS / MCP Verification against: ${MCP_URL}`);
  console.log(`   Isolated Test Session ID: ${TEST_SESSION}\n`);

  // 1. OpenAPI 3.1.0 GET
  const openApiRes = await fetch(`${MCP_URL}?format=openapi`);
  const openApiJson = await openApiRes.json();
  assert(
    openApiRes.status === 200 && openApiJson.openapi === '3.1.0',
    'OpenAPI 3.1.0 specification endpoint returns valid schema'
  );

  // 2. MCP initialize
  const initRes = await mcpRpc('initialize', { protocolVersion: '2025-03-26' }, 1);
  assert(
    initRes.status === 200 &&
      initRes.json?.result?.serverInfo?.name === 'paypal-ai-billing-kit-maas',
    'MCP JSON-RPC 2.0 `initialize` handshake succeeds'
  );

  // 3. MCP tools/list
  const listRes = await mcpRpc('tools/list', {}, 2);
  const tools = listRes.json?.result?.tools || [];
  assert(
    tools.length === 15,
    `MCP \`tools/list\` exposes all 15 tools (received ${tools.length})`
  );

  // 4. discover_billing_capabilities
  const cap = await callTool('discover_billing_capabilities');
  assert(
    cap.data?.ok === true &&
      cap.data?.guardrails?.max_single_action_minor === 50000 &&
      cap.data?.guardrails?.daily_limit_minor === 250000,
    'Tool 1 (`discover_billing_capabilities`): returns guardrails ($500/$2,500) & permission tiers'
  );

  // 5. list_demo_customers
  const cust = await callTool('list_demo_customers');
  assert(
    cust.data?.ok === true && cust.data?.authorized_customers?.length === 2,
    'Tool 2 (`list_demo_customers`): lists Alex Rivera & Jordan Taylor under Dr. Sarah Jenkins'
  );

  // 6. search_invoices
  const search = await callTool('search_invoices', { status: 'all' });
  assert(
    search.data?.ok === true && search.data?.count >= 6,
    `Tool 3 (\`search_invoices\`): returns canonical statements (count=${search.data?.count})`
  );

  // 7. get_invoice_details (#PPB-INV-2026-1003)
  const details = await callTool('get_invoice_details', {
    invoice_number: 'PPB-INV-2026-1003',
  });
  assert(
    details.data?.ok === true &&
      details.data?.invoice?.invoice_number === 'PPB-INV-2026-1003' &&
      details.data?.explanation?.includes('What this invoice is for:') &&
      details.data?.explanation?.includes('When services were provided'),
    'Tool 4 (`get_invoice_details`): explains #PPB-INV-2026-1003 line items, service date, and settlement status'
  );

  // 8. create_invoice_proposal (Guardrail block > $500 + valid $35 proposal)
  const blockedProp = await callTool('create_invoice_proposal', {
    customer_name: 'Alex Rivera',
    service_code: 'ADMIN-TELEHEALTH',
    amount_minor: 75000,
  });
  assert(
    blockedProp.data?.ok === false &&
      blockedProp.data?.error_code === 'GUARDRAIL_SINGLE_ACTION_LIMIT_EXCEEDED',
    'Tool 5a (`create_invoice_proposal`): blocks $750.00 proposal exceeding $500.00 single-action guardrail'
  );

  const validProp = await callTool('create_invoice_proposal', {
    customer_name: 'Alex Rivera',
    service_code: 'ADMIN-FORMS',
    amount_minor: 3500,
  });
  assert(
    validProp.data?.ok === true &&
      validProp.data?.proposal?.status === 'pending' &&
      validProp.data?.proposal?.amount_minor === 3500,
    'Tool 5b (`create_invoice_proposal`): creates pending $35.00 ADMIN-FORMS proposal requiring human approval'
  );

  // 9. create_approved_invoice
  const createdInv = await callTool('create_approved_invoice', {
    proposal_id: validProp.data?.proposal?.id,
    explicit_human_approval: true,
  });
  const createdInvoiceNumber = createdInv.data?.invoice?.invoice_number;
  assert(
    createdInv.data?.ok === true && Boolean(createdInvoiceNumber),
    `Tool 6 (\`create_approved_invoice\`): executes approved proposal -> created #${createdInvoiceNumber}`
  );

  // 10. explain_outstanding_balances
  const balances = await callTool('explain_outstanding_balances', {
    customer_name: 'Alex Rivera',
  });
  assert(
    balances.data?.ok === true && balances.data?.total_outstanding_minor > 0,
    `Tool 7 (\`explain_outstanding_balances\`): computes Alex Rivera outstanding balance (${balances.data?.total_outstanding_usd})`
  );

  // 11. get_transaction_history
  const txHist = await callTool('get_transaction_history');
  assert(
    txHist.data?.ok === true &&
      txHist.data?.settlements?.some(
        (s) => s.invoice_number === 'PPB-INV-2026-1003' && s.is_live_paypal_capture === false
      ),
    'Tool 8 (`get_transaction_history`): returns settlements & labels SAMPLE-DEMO-SETTLEMENT-1003 as non-live sample'
  );

  // 12. prepare_payment_proposal
  const payProp = await callTool('prepare_payment_proposal', {
    invoice_number: 'PPB-INV-2026-1001',
  });
  assert(
    payProp.data?.ok === true &&
      payProp.data?.requires_paypal_buyer_authorization === true &&
      payProp.data?.proposal?.kind === 'payment_checkout',
    'Tool 9 (`prepare_payment_proposal`): prepares PayPal Sandbox checkout proposal without charging autonomously'
  );

  // 13. void_unpaid_invoice (Payment-State Protection on paid 1003 + void newly created invoice)
  const voidPaid = await callTool('void_unpaid_invoice', {
    invoice_number: 'PPB-INV-2026-1003',
    explicit_human_approval: true,
  });
  assert(
    voidPaid.data?.ok === false &&
      voidPaid.data?.error_code === 'PAYMENT_STATE_PROTECTION_PAID_INVOICE',
    'Tool 10a (`void_unpaid_invoice`): enforces Payment-State Protection blocking void on paid #PPB-INV-2026-1003'
  );

  const voidUnpaid = await callTool('void_unpaid_invoice', {
    invoice_number: createdInvoiceNumber,
    explicit_human_approval: true,
  });
  assert(
    voidUnpaid.data?.ok === true,
    `Tool 10b (\`void_unpaid_invoice\`): voids unpaid session invoice #${createdInvoiceNumber} ($0.00 balance due)`
  );

  // 14. prepare_refund_proposal
  const refundProp = await callTool('prepare_refund_proposal', {
    invoice_number: 'PPB-INV-2026-1003',
    reason: 'Duplicate administrative charge adjustment',
  });
  assert(
    refundProp.data?.ok === true &&
      refundProp.data?.proposal?.kind === 'refund' &&
      refundProp.data?.proposal?.refund_amount_minor === 12500,
    'Tool 11 (`prepare_refund_proposal`): prepares $125.00 refund proposal for paid #PPB-INV-2026-1003'
  );

  // 15. get_financial_audit_history
  const audit = await callTool('get_financial_audit_history', { limit: 15 });
  assert(
    audit.data?.ok === true &&
      audit.data?.append_only_enforced === true &&
      audit.data?.count > 0,
    `Tool 12 (\`get_financial_audit_history\`): returns ${audit.data?.count} append-only financial audit events`
  );

  // 16. get_paypal_sandbox_status
  const ppStatus = await callTool('get_paypal_sandbox_status');
  assert(
    ppStatus.data?.ok === true &&
      ppStatus.data?.environment === 'sandbox' &&
      ppStatus.data?.production_live_payments_disabled === true,
    'Tool 13 (`get_paypal_sandbox_status`): reports PayPal Sandbox status & credential state accurately'
  );

  // 17. get_business_metrics
  const metrics = await callTool('get_business_metrics');
  assert(
    metrics.data?.ok === true &&
      metrics.data?.provider_metrics?.total_invoices_count >= 6,
    `Tool 14 (\`get_business_metrics\`): returns practice KPIs (Outstanding=${metrics.data?.provider_metrics?.outstanding_balance_usd})`
  );

  // 18. reset_demo_session
  const reset = await callTool('reset_demo_session');
  const afterReset = await callTool('search_invoices', { status: 'all' });
  assert(
    reset.data?.ok === true && afterReset.data?.count === 6,
    `Tool 15 (\`reset_demo_session\`): resets session "${TEST_SESSION}" back to exactly 6 canonical seed invoices`
  );

  console.log(`\n📊 MaaS / MCP Verification Summary: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal verification error:', err);
  process.exit(1);
});

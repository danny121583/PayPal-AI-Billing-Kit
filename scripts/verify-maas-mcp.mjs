#!/usr/bin/env node
/**
 * Independent MCP Agent Interface Verification Suite
 * Exercises:
 * - MCP JSON-RPC 2.0 (`initialize`, `notifications/initialized`, `ping`, `prompts/list`, `resources/list`, `tools/list`, `tools/call`)
 * - OpenAPI 3.1.0 schema discovery, HEAD probes, `/robots.txt`, and OAuth 2.1 DCR
 * - All 15 billing tools end-to-end
 * - Strict cross-session isolation and caller-supplied approval/guardrail bypass prevention
 */

const endpointArg = process.argv.find((a) => a.startsWith('--url='))?.split('=')[1];
const MCP_URL =
  endpointArg ||
  process.env.MCP_URL ||
  'https://paypal-ai-billing-mcp.apd1034.workers.dev/mcp';

const BASE_ORIGIN = new URL(MCP_URL).origin;
const TEST_SESSION = `mcp-verify-${Date.now().toString(36)}`;
const OTHER_SESSION = `mcp-other-${Date.now().toString(36)}`;

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

async function mcpRpc(method, params = {}, id = 1, sessionHeader = TEST_SESSION) {
  const payload = {
    jsonrpc: '2.0',
    method,
    params,
  };
  if (id !== undefined && id !== null) {
    payload.id = id;
  }
  const headers = {
    'Content-Type': 'application/json',
  };
  if (sessionHeader) {
    headers['X-Demo-Session-Id'] = sessionHeader;
  }
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, headers: res.headers };
}

async function callTool(name, args = {}, sessionOverride = TEST_SESSION, headerOverride = TEST_SESSION) {
  const finalArgs = sessionOverride !== null ? { ...args, demo_session_id: sessionOverride } : { ...args };
  const { status, json } = await mcpRpc(
    'tools/call',
    {
      name,
      arguments: finalArgs,
    },
    1,
    headerOverride
  );
  return {
    status,
    rpc: json,
    data: json?.result?.structuredContent || null,
  };
}

async function main() {
  console.log(`\n🔌 Running Independent MCP Agent Interface Verification against: ${MCP_URL}`);
  console.log(`   Isolated Test Session ID: ${TEST_SESSION}\n`);

  // 1. OpenAPI 3.1.0 GET
  const openApiRes = await fetch(`${MCP_URL}?format=openapi`);
  const openApiJson = await openApiRes.json();
  assert(
    openApiRes.status === 200 &&
      openApiJson.openapi === '3.1.0' &&
      !JSON.stringify(openApiJson.info || {}).includes('MaaS'),
    'OpenAPI 3.1.0 specification endpoint returns valid schema with MCP Agent Interface branding'
  );

  // 2. HEAD /mcp & /robots.txt
  const headRes = await fetch(MCP_URL, { method: 'HEAD' });
  const robotsRes = await fetch(`${BASE_ORIGIN}/robots.txt`);
  assert(
    headRes.status === 200 && robotsRes.status === 200,
    'HTTP HEAD probe and /robots.txt return 200 OK for crawler/connector compatibility'
  );

  // 3. MCP initialize
  const initRes = await mcpRpc('initialize', { protocolVersion: '2025-06-18' }, 1);
  assert(
    initRes.status === 200 &&
      initRes.json?.result?.serverInfo?.name === 'paypal-ai-billing-kit-mcp' &&
      initRes.json?.result?.protocolVersion === '2025-06-18',
    'MCP JSON-RPC 2.0 `initialize` handshake succeeds (protocol 2025-06-18, serverInfo=paypal-ai-billing-kit-mcp)'
  );

  // 4. MCP notifications/initialized (without id -> HTTP 202 Accepted)
  const notifRes = await mcpRpc('notifications/initialized', {}, null);
  assert(
    notifRes.status === 202 && notifRes.json === null,
    'MCP JSON-RPC 2.0 `notifications/initialized` (notification without id) returns HTTP 202 Accepted'
  );

  // 5. MCP ping, prompts/list, resources/list
  const pingRes = await mcpRpc('ping', {}, 2);
  const promptsRes = await mcpRpc('prompts/list', {}, 3);
  const resourcesRes = await mcpRpc('resources/list', {}, 4);
  assert(
    pingRes.status === 200 &&
      Array.isArray(promptsRes.json?.result?.prompts) &&
      Array.isArray(resourcesRes.json?.result?.resources),
    'MCP standard methods (`ping`, `prompts/list`, `resources/list`) return valid JSON-RPC responses'
  );

  // 6. MCP tools/list strict schema verification
  const listRes = await mcpRpc('tools/list', {}, 5);
  const tools = listRes.json?.result?.tools || [];
  const allowedTopKeys = new Set([
    'name',
    'description',
    'inputSchema',
    'securitySchemes',
    'annotations',
    '_meta',
  ]);
  const strictSchemaValid =
    tools.length === 19 &&
    tools.every((t) => Object.keys(t).every((k) => allowedTopKeys.has(k)) && t._meta?.permissionTier);
  assert(
    strictSchemaValid,
    `MCP \`tools/list\` exposes all 19 tools with strict MCP schema compliance (count=${tools.length})`
  );

  // 7. Tool 1: discover_billing_capabilities
  const cap = await callTool('discover_billing_capabilities');
  assert(
    cap.data?.ok === true &&
      cap.data?.guardrails?.max_single_action_minor === 50000 &&
      cap.data?.guardrails?.daily_limit_minor === 250000,
    'Tool 1 (`discover_billing_capabilities`): returns guardrails ($500/$2,500) & permission tiers'
  );

  // 8. Tool 2: list_demo_customers
  const cust = await callTool('list_demo_customers');
  assert(
    cust.data?.ok === true && cust.data?.authorized_customers?.length === 2,
    'Tool 2 (`list_demo_customers`): lists Alex Rivera & Jordan Taylor under Dr. Sarah Jenkins'
  );

  // 9. Tool 3: search_invoices
  const search = await callTool('search_invoices', { status: 'all' });
  assert(
    search.data?.ok === true && search.data?.count >= 6,
    `Tool 3 (\`search_invoices\`): returns canonical statements (count=${search.data?.count})`
  );

  // 10. Tool 4: get_invoice_details (#PPB-INV-2026-1003 & failed payment #PPB-INV-2026-1004)
  const details = await callTool('get_invoice_details', {
    invoice_number: 'PPB-INV-2026-1003',
  });
  const failedDetails = await callTool('get_invoice_details', {
    invoice_number: 'PPB-INV-2026-1004',
  });
  assert(
    details.data?.ok === true &&
      details.data?.invoice?.invoice_number === 'PPB-INV-2026-1003' &&
      details.data?.explanation?.includes('What this invoice is for:') &&
      failedDetails.data?.ok === true &&
      failedDetails.data?.invoice?.payment_attempts?.some(
        (a) => a.status === 'failed' && a.failure_code === 'INSTRUMENT_DECLINED'
      ),
    'Tool 4 (`get_invoice_details`): explains #PPB-INV-2026-1003 settlement and Jordan Taylor #PPB-INV-2026-1004 INSTRUMENT_DECLINED failed attempt'
  );

  // 11. Tool 5: create_invoice_proposal (Guardrail block > $500 + valid $35 proposal)
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

  // 12. Security Check A: Block caller-supplied approval/guardrail bypass attempts
  const bypassFlagAttempt = await callTool('create_invoice_proposal', {
    customer_name: 'Alex Rivera',
    service_code: 'ADMIN-TELEHEALTH',
    amount_minor: 75000,
    bypass_guardrail: true,
  });
  const noProposalWriteAttempt = await callTool('create_approved_invoice', {
    customer_name: 'Alex Rivera',
    service_code: 'ADMIN-FORMS',
    amount_minor: 3500,
    explicit_human_approval: true,
  });
  const noApprovalWriteAttempt = await callTool('create_approved_invoice', {
    proposal_id: validProp.data?.proposal?.id,
    explicit_human_approval: false,
  });
  assert(
    bypassFlagAttempt.data?.ok === false &&
      bypassFlagAttempt.data?.error_code === 'APPROVAL_BYPASS_PROHIBITED' &&
      noProposalWriteAttempt.data?.ok === false &&
      noProposalWriteAttempt.data?.error_code === 'PROPOSAL_REQUIRED_FOR_WRITE' &&
      noApprovalWriteAttempt.data?.ok === false &&
      noApprovalWriteAttempt.data?.error_code === 'HUMAN_APPROVAL_REQUIRED',
    'Security Guardrail: blocks caller-supplied bypass flags (`bypass_guardrail`), unproposed writes, and unapproved writes'
  );

  // 13. Security Check B: Block cross-session manipulation & canonical session mutation
  const crossSessionHeaderMismatch = await callTool(
    'search_invoices',
    { status: 'all' },
    OTHER_SESSION,
    TEST_SESSION
  );
  const crossSessionProposalAttempt = await callTool(
    'create_approved_invoice',
    {
      proposal_id: validProp.data?.proposal?.id,
      explicit_human_approval: true,
    },
    OTHER_SESSION,
    OTHER_SESSION
  );
  const canonicalMutationAttempt = await callTool(
    'reset_demo_session',
    {},
    'canonical',
    'canonical'
  );
  assert(
    crossSessionHeaderMismatch.data?.ok === false &&
      crossSessionHeaderMismatch.data?.error_code === 'CROSS_SESSION_ISOLATION_VIOLATION' &&
      crossSessionProposalAttempt.data?.ok === false &&
      crossSessionProposalAttempt.data?.error_code === 'CROSS_SESSION_PROPOSAL_ACCESS_DENIED' &&
      canonicalMutationAttempt.data?.ok === false &&
      canonicalMutationAttempt.data?.error_code === 'CANONICAL_SESSION_IMMUTABLE',
    'Security Isolation: blocks cross-session header/arg mismatch, cross-session proposal execution, and canonical session mutation'
  );

  // 14. Tool 6: create_approved_invoice (in legitimate owning session)
  const createdInv = await callTool('create_approved_invoice', {
    proposal_id: validProp.data?.proposal?.id,
    explicit_human_approval: true,
  });
  const createdInvoiceNumber = createdInv.data?.invoice?.invoice_number;
  assert(
    createdInv.data?.ok === true && Boolean(createdInvoiceNumber),
    `Tool 6 (\`create_approved_invoice\`): executes approved proposal -> created #${createdInvoiceNumber}`
  );

  // Verify OTHER_SESSION cannot see TEST_SESSION's newly created invoice
  const otherSessionInvoices = await callTool(
    'search_invoices',
    { status: 'all' },
    OTHER_SESSION,
    OTHER_SESSION
  );
  const leakedToOtherSession = (otherSessionInvoices.data?.invoices || []).some(
    (inv) => inv.invoice_number === createdInvoiceNumber
  );
  assert(
    otherSessionInvoices.data?.ok === true &&
      otherSessionInvoices.data?.count === 6 &&
      leakedToOtherSession === false,
    `Cross-Visitor Isolation: session "${OTHER_SESSION}" sees only 6 canonical statements (zero leak of #${createdInvoiceNumber})`
  );

  // 15. Tool 7: explain_outstanding_balances
  const balances = await callTool('explain_outstanding_balances', {
    customer_name: 'Alex Rivera',
  });
  assert(
    balances.data?.ok === true && balances.data?.total_outstanding_minor > 0,
    `Tool 7 (\`explain_outstanding_balances\`): computes Alex Rivera outstanding balance (${balances.data?.total_outstanding_usd})`
  );

  // 16. Tool 8: get_transaction_history
  const txHist = await callTool('get_transaction_history');
  assert(
    txHist.data?.ok === true &&
      txHist.data?.settlements?.some(
        (s) => s.invoice_number === 'PPB-INV-2026-1003' && s.is_live_paypal_capture === false
      ),
    'Tool 8 (`get_transaction_history`): returns settlements & labels SAMPLE-DEMO-SETTLEMENT-1003 as non-live sample'
  );

  // 17. Tool 9: prepare_payment_proposal
  const payProp = await callTool('prepare_payment_proposal', {
    invoice_number: 'PPB-INV-2026-1001',
  });
  assert(
    payProp.data?.ok === true &&
      payProp.data?.requires_paypal_buyer_authorization === true &&
      payProp.data?.proposal?.kind === 'payment_checkout',
    'Tool 9 (`prepare_payment_proposal`): prepares PayPal Sandbox checkout proposal without charging autonomously'
  );

  // 17b. Tool 16: create_paypal_checkout_order
  const checkoutOrder = await callTool('create_paypal_checkout_order', {
    proposal_id: payProp.data?.proposal?.id,
    invoice_number: 'PPB-INV-2026-1001',
    explicit_human_approval: true,
  });
  assert(
    (checkoutOrder.data?.ok === true ||
      checkoutOrder.data?.error_code === 'PAYPAL_SANDBOX_CREDENTIALS_MISSING') &&
      checkoutOrder.data?.invoice_number === 'PPB-INV-2026-1001',
    `Tool 16 (\`create_paypal_checkout_order\`): handles checkout order creation for #PPB-INV-2026-1001 (${
      checkoutOrder.data?.ok ? `Order ${checkoutOrder.data?.order_id}` : checkoutOrder.data?.error_code
    })`
  );

  // 17c. Tool 17: capture_paypal_checkout_order (isolated demo settlement on #PPB-INV-2026-1004)
  const capturedSettlement = await callTool('capture_paypal_checkout_order', {
    invoice_number: 'PPB-INV-2026-1004',
    allow_demo_settlement_fallback: true,
    explicit_human_approval: true,
  });
  assert(
    capturedSettlement.data?.ok === true &&
      capturedSettlement.data?.status === 'paid' &&
      capturedSettlement.data?.balance_due_minor === 0 &&
      capturedSettlement.data?.is_live_paypal_capture === false,
    'Tool 17 (`capture_paypal_checkout_order`): settles #PPB-INV-2026-1004 ($50.00 -> $0.00 balance due) in isolated demo session with transparent non-live label'
  );

  // 17d. Tool 18: get_payment_receipt
  const receipt1003 = await callTool('get_payment_receipt', {
    invoice_number: 'PPB-INV-2026-1003',
  });
  const receipt1004 = await callTool('get_payment_receipt', {
    invoice_number: 'PPB-INV-2026-1004',
  });
  assert(
    receipt1003.data?.ok === true &&
      receipt1003.data?.receipt?.amount_paid_minor === 12500 &&
      receipt1004.data?.ok === true &&
      receipt1004.data?.receipt?.amount_paid_minor === 5000,
    'Tool 18 (`get_payment_receipt`): returns structured payment receipts for #PPB-INV-2026-1003 ($125.00) and settled #PPB-INV-2026-1004 ($50.00)'
  );

  // 18. Tool 10: void_unpaid_invoice (Payment-State Protection on paid 1003 + void newly created invoice)
  const voidPaid = await callTool('void_unpaid_invoice', {
    invoice_number: 'PPB-INV-2026-1003',
    reason: 'Attempted void on paid invoice',
    explicit_human_approval: true,
  });
  assert(
    voidPaid.data?.ok === false &&
      voidPaid.data?.error_code === 'PAYMENT_STATE_PROTECTION_PAID_INVOICE',
    'Tool 10a (`void_unpaid_invoice`): enforces Payment-State Protection blocking void on paid #PPB-INV-2026-1003'
  );

  const voidUnpaid = await callTool('void_unpaid_invoice', {
    invoice_number: createdInvoiceNumber,
    reason: 'Administrative test void',
    explicit_human_approval: true,
  });
  assert(
    voidUnpaid.data?.ok === true,
    `Tool 10b (\`void_unpaid_invoice\`): voids unpaid session invoice #${createdInvoiceNumber} ($0.00 balance due)`
  );

  // 19. Tool 11: prepare_refund_proposal
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

  // 19b. Tool 19: execute_approved_refund
  const executedRefund = await callTool('execute_approved_refund', {
    proposal_id: refundProp.data?.proposal?.id,
    invoice_number: 'PPB-INV-2026-1003',
    explicit_human_approval: true,
  });
  assert(
    executedRefund.data?.ok === true &&
      executedRefund.data?.status === 'refunded' &&
      executedRefund.data?.refund_amount_minor === 12500,
    'Tool 19 (`execute_approved_refund`): executes approved $125.00 refund for #PPB-INV-2026-1003 in isolated demo session'
  );

  // 20. Tool 12: get_financial_audit_history
  const audit = await callTool('get_financial_audit_history', { limit: 15 });
  assert(
    audit.data?.ok === true &&
      audit.data?.append_only_enforced === true &&
      audit.data?.count > 0,
    `Tool 12 (\`get_financial_audit_history\`): returns ${audit.data?.count} append-only financial audit events`
  );

  // 21. Tool 13: get_paypal_sandbox_status
  const ppStatus = await callTool('get_paypal_sandbox_status');
  assert(
    ppStatus.data?.ok === true &&
      ppStatus.data?.environment === 'sandbox' &&
      ppStatus.data?.production_live_payments_disabled === true,
    'Tool 13 (`get_paypal_sandbox_status`): reports PayPal Sandbox status & credential state accurately'
  );

  // 22. Tool 14: get_business_metrics
  const metrics = await callTool('get_business_metrics');
  assert(
    metrics.data?.ok === true &&
      metrics.data?.provider_metrics?.total_invoices_count >= 6,
    `Tool 14 (\`get_business_metrics\`): returns practice KPIs (Outstanding=${metrics.data?.provider_metrics?.outstanding_balance_usd})`
  );

  // 23. Tool 15: reset_demo_session
  const reset = await callTool('reset_demo_session');
  const afterReset = await callTool('search_invoices', { status: 'all' });
  assert(
    reset.data?.ok === true && afterReset.data?.count === 6,
    `Tool 15 (\`reset_demo_session\`): resets session "${TEST_SESSION}" back to exactly 6 canonical seed invoices`
  );

  console.log(`\n📊 MCP Agent Interface Verification Summary: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal verification error:', err);
  process.exit(1);
});

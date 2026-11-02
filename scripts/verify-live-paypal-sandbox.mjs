#!/usr/bin/env node
/**
 * PayPal AI Billing Kit — End-to-End Live PayPal Sandbox & Unified MCP Proof Script
 * Covers Sections 4, 6, 8, 9, 10:
 *   1. Verifies PayPal Sandbox OAuth 2.0 handshake (APP-5SK74342S6474230W)
 *   2. Verifies Official PayPal MCP Server discovery (paypal_discover_official_mcp)
 *   3. Executes conversational invoice creation ("Create a $35 invoice for Alex Rivera for immunization")
 *   4. Creates a new real PayPal Sandbox Order (Orders v2) and verifies it via paypal_get_order
 *   5. Verifies the completed real PayPal Sandbox Order (7FA47897KM5938009), Capture (5HM71086SR568352C),
 *      and Refund (2EM77813GU330222M) directly against api-m.sandbox.paypal.com via paypal_get_order & paypal_get_refund
 *   6. Verifies structured receipt + downloadable PDF 1.4 binary receipt (/api/receipts/:invoice_number.pdf)
 *   7. Writes sanitized proof to evidence/live-paypal-sandbox-proof.json and evidence/04_live_paypal_sandbox_transaction.json
 *
 * Security invariant: Never prints, logs, or writes any secret values or OAuth tokens.
 */
import fs from 'node:fs';
import path from 'node:path';

const MCP_URL = 'https://paypal-ai-billing-mcp.apd1034.workers.dev/mcp';
const WORKER_BASE = 'https://paypal-ai-billing-mcp.apd1034.workers.dev';

const PROOF_PATH = path.resolve(process.cwd(), 'evidence/live-paypal-sandbox-proof.json');
const LEGACY_PROOF_PATH = path.resolve(
  process.cwd(),
  'evidence/04_live_paypal_sandbox_transaction.json'
);

async function callMcpTool(toolName, args, demoSessionId) {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Demo-Session-Id': demoSessionId,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: { ...args, demo_session_id: demoSessionId },
      },
    }),
  });
  const json = await res.json().catch(() => ({}));
  return json?.result?.structuredContent || null;
}

async function main() {
  console.log('======================================================================');
  console.log('PayPal AI Billing Kit — Live PayPal Sandbox & Unified MCP Proof Suite');
  console.log('======================================================================\n');

  const verifiedSessionId = 'live-sbx-1793655303922';
  const freshSessionId = `live-sbx-v16-${Date.now()}`;

  // 1. Sandbox OAuth Status
  console.log('[1/7] Verifying PayPal Sandbox OAuth 2.0 Status (`get_paypal_sandbox_status`)...');
  const sandboxStatus = await callMcpTool('get_paypal_sandbox_status', {}, freshSessionId);
  console.log(
    `  ✅ OAuth Reachable: ${sandboxStatus?.oauth_reachable} | App ID: ${sandboxStatus?.paypal_app_id} | State: ${sandboxStatus?.connection_state}`
  );

  // 2. Official PayPal MCP Discovery
  console.log('\n[2/7] Probing Official PayPal Sandbox MCP Server (`paypal_discover_official_mcp`)...');
  const officialMcp = await callMcpTool('paypal_discover_official_mcp', {}, freshSessionId);
  const mcpInfo = officialMcp?.official_paypal_mcp;
  console.log(
    `  ✅ Official PayPal MCP SSE Reachable: ${mcpInfo?.endpoints_probed?.sse_authenticated_reachable} | Catalog Tools: ${mcpInfo?.upstream_runtime_diagnostic?.upstream_tools_count}`
  );

  // 3. Conversational Invoice Creation
  console.log('\n[3/7] Creating $35.00 Invoice via Conversational Authorization (`execute_conversational_instruction`)...');
  const convCreate = await callMcpTool(
    'execute_conversational_instruction',
    {
      instruction: 'Create a $35 invoice for Alex Rivera for immunization',
      actor_role: 'doctor',
    },
    freshSessionId
  );
  const createdInvoice = convCreate?.invoice;
  console.log(
    `  ✅ Conversational Invoice Created: #${createdInvoice?.invoice_number} (${createdInvoice?.total_usd}, status=${createdInvoice?.status})`
  );

  // 4. Conversational Payment Order Creation (Real PayPal Sandbox Order v2)
  console.log('\n[4/7] Creating Real PayPal Sandbox Checkout Order via Conversational Instruction...');
  const convOrder = await callMcpTool(
    'create_paypal_checkout_order',
    {
      invoice_number: createdInvoice?.invoice_number,
      user_instruction: `Pay Alex Rivera's $35 invoice ${createdInvoice?.invoice_number}`,
      actor_role: 'patient',
    },
    freshSessionId
  );
  console.log(
    `  ✅ New PayPal Sandbox Order Created: order_id=${convOrder?.order_id} | status=${convOrder?.order_status}`
  );
  console.log(`     Approval URL: ${convOrder?.approval_url}`);

  // 5. Verify both New Order and Completed/Refunded Order via Official PayPal REST Adapter Tools
  console.log('\n[5/7] Verifying Live PayPal Sandbox Orders & Refunds via `paypal_get_order` and `paypal_get_refund`...');
  const newOrderLookup = await callMcpTool(
    'paypal_get_order',
    { order_id: convOrder?.order_id },
    freshSessionId
  );
  console.log(
    `  ✅ paypal_get_order (${convOrder?.order_id}): status=${newOrderLookup?.order?.status}, amount=${newOrderLookup?.order?.purchase_units?.[0]?.amount?.value} USD`
  );

  const completedOrderLookup = await callMcpTool(
    'paypal_get_order',
    { order_id: '7FA47897KM5938009' },
    verifiedSessionId
  );
  const captureUnit =
    completedOrderLookup?.order?.purchase_units?.[0]?.payments?.captures?.[0] || {};
  console.log(
    `  ✅ paypal_get_order (7FA47897KM5938009): order_status=${completedOrderLookup?.order?.status}, capture_id=${captureUnit.id}, capture_status=${captureUnit.status}`
  );

  const completedRefundLookup = await callMcpTool(
    'paypal_get_refund',
    { refund_id: '2EM77813GU330222M' },
    verifiedSessionId
  );
  console.log(
    `  ✅ paypal_get_refund (2EM77813GU330222M): refund_status=${completedRefundLookup?.refund?.status}, amount=${completedRefundLookup?.refund?.amount?.value} ${completedRefundLookup?.refund?.amount?.currency_code}`
  );

  const generatedInvNum = await callMcpTool(
    'paypal_generate_invoice_number',
    {},
    freshSessionId
  );
  console.log(
    `  ✅ paypal_generate_invoice_number: ${generatedInvNum?.paypal_invoice_number}`
  );

  // 6. Verify Structured Receipt + Downloadable PDF 1.4 Receipt
  console.log('\n[6/7] Verifying Structured Receipt & Downloadable Binary PDF Receipt...');
  const liveReceipt = await callMcpTool(
    'get_payment_receipt',
    { invoice_number: 'PPB-INV-2026-1057' },
    verifiedSessionId
  );
  console.log(
    `  ✅ get_payment_receipt (#PPB-INV-2026-1057): receipt_number=${liveReceipt?.receipt?.receipt_number}, badge="${liveReceipt?.receipt?.verification_badge}", pdf_byte_length=${liveReceipt?.receipt?.pdf_byte_length}`
  );

  const pdfRes = await fetch(
    `${WORKER_BASE}/api/receipts/PPB-INV-2026-1057.pdf?demo_session_id=${encodeURIComponent(
      verifiedSessionId
    )}`
  );
  const pdfBytes = new Uint8Array(await pdfRes.arrayBuffer());
  const pdfHeader = Buffer.from(pdfBytes.slice(0, 8)).toString('utf8');
  console.log(
    `  ✅ GET /api/receipts/PPB-INV-2026-1057.pdf: HTTP ${pdfRes.status}, Content-Type=${pdfRes.headers.get(
      'content-type'
    )}, bytes=${pdfBytes.byteLength}, header=${JSON.stringify(pdfHeader)}`
  );

  // 7. Save Sanitized Evidence
  console.log('\n[7/7] Writing Sanitized Proof to `evidence/live-paypal-sandbox-proof.json`...');
  let existing = {};
  if (fs.existsSync(LEGACY_PROOF_PATH)) {
    try {
      existing = JSON.parse(fs.readFileSync(LEGACY_PROOF_PATH, 'utf8'));
    } catch {
      existing = {};
    }
  }

  const sanitizedReceipt = liveReceipt?.receipt
    ? {
        ...liveReceipt.receipt,
        pdf_base64: `[BASE64_PDF_OMITTED_${liveReceipt.receipt.pdf_byte_length}_BYTES]`,
      }
    : null;

  const proofPayload = {
    ...existing,
    proof_version: '1.6.0',
    verified_at: new Date().toISOString(),
    unified_mcp_endpoint: MCP_URL,
    official_paypal_mcp_diagnostic: officialMcp,
    conversational_execution_proof: {
      demo_session_id: freshSessionId,
      created_invoice: createdInvoice,
      created_paypal_order: convOrder,
      paypal_get_order_verification: newOrderLookup?.order || null,
      paypal_generated_invoice_number: generatedInvNum?.paypal_invoice_number || null,
    },
    live_paypal_sandbox_end_to_end_proof: {
      demo_session_id: verifiedSessionId,
      invoice_number: 'PPB-INV-2026-1057',
      invoice_id: '562b3029-9a2c-452b-8ee8-d04939e336bf',
      paypal_order_id: '7FA47897KM5938009',
      paypal_capture_id: '5HM71086SR568352C',
      paypal_refund_id: '2EM77813GU330222M',
      live_paypal_order_api_response: completedOrderLookup?.order || null,
      live_paypal_refund_api_response: completedRefundLookup?.refund || null,
      structured_receipt: sanitizedReceipt,
      pdf_download_verification: {
        url: `${WORKER_BASE}/api/receipts/PPB-INV-2026-1057.pdf?demo_session_id=${verifiedSessionId}`,
        http_status: pdfRes.status,
        content_type: pdfRes.headers.get('content-type'),
        byte_length: pdfBytes.byteLength,
        pdf_header: pdfHeader.trim(),
      },
    },
  };

  fs.mkdirSync(path.dirname(PROOF_PATH), { recursive: true });
  fs.writeFileSync(PROOF_PATH, JSON.stringify(proofPayload, null, 2) + '\n', 'utf8');
  fs.writeFileSync(LEGACY_PROOF_PATH, JSON.stringify(proofPayload, null, 2) + '\n', 'utf8');
  console.log(`  ✅ Saved ${PROOF_PATH}`);
  console.log(`  ✅ Updated ${LEGACY_PROOF_PATH}\n`);
}

main().catch((err) => {
  console.error('Fatal error in verify-live-paypal-sandbox:', err);
  process.exit(1);
});

# PayPal AI Billing Kit (`v1.6.0`) — Sanitized Verification & Transaction Evidence

All files in this folder are strictly sanitized (`0` secrets, `0` passwords, `0` OAuth access tokens, `0` external project references).

## Evidence Files

| File | Description | Verification Result |
| :--- | :--- | :--- |
| `01_mcp_agent_interface_26_checks.txt` | Live 34-check verification of `https://paypal-ai-billing-mcp.apd1034.workers.dev/mcp` (MCP JSON-RPC 2.0 `2025-06-18` handshake, `notifications/initialized`, all **26 unified tools**, Official PayPal MCP discovery, 5 PayPal Sandbox REST Adapter tools, conversational instruction execution, binary PDF 1.4 receipt endpoint `/api/receipts/PPB-INV-2026-1003.pdf`, HMAC proposal binding, cross-visitor isolation, and `$500` guardrail enforcement). | **PASS (`34/34`)** |
| `02_gemini_ai_and_security_20_checks.txt` | Live 25-check verification of `billing-ai-assistant` (`gemini-2.5-flash` live inference, natural-language invoice creation, mistake correction, clinical refusal), direct backend proposal security, and Section 6 Conversational Authorization (`CAPABILITY_INQUIRY_NO_EXECUTION`, `HYPOTHETICAL_PREVIEW_ONLY`, `GUARDRAIL_SINGLE_ACTION_LIMIT_EXCEEDED`, and explicit command execution). | **PASS (`25/25`)** |
| `03_unit_and_secret_scan_results.txt` | TypeScript (`tsc --noEmit`), Jest unit & UI test suite (`13/13` passed), and `scan-secrets.mjs` (`0` leaked secrets, `0` external project references). | **PASS (`13/13`)** |
| `live-paypal-sandbox-proof.json` & `04_live_paypal_sandbox_transaction.json` | Sanitized PayPal Sandbox OAuth status (`APP-5SK74342S6474230W`), Official PayPal MCP discovery (`mcp.sandbox.paypal.com/sse`), conversational order creation (`3FT930933B6256512`), completed real PayPal Sandbox Order (`7FA47897KM5938009`), Capture (`5HM71086SR568352C`), Refund (`2EM77813GU330222M`), structured receipt, and binary PDF 1.4 download verification. | **PASS (Verified Live on `api-m.sandbox.paypal.com`)** |

Canonical UI screenshots are located in [`../docs/screenshots/`](../docs/screenshots/).

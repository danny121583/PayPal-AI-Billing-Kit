# Unified PayPal MCP Gateway, Gemini 3.5 Flash-Lite AI, Automated Sandbox Card Checkout & Merchant-Branded PDF Receipt Architecture

**Project:** PayPal AI Billing Kit (`v1.8.0`)  
**Unified MCP Endpoint:** `https://paypal-ai-billing-mcp.apd1034.workers.dev/mcp`  
**Vercel MCP Mirror:** `https://paypal-ai-billing-kit.vercel.app/api/mcp`  
**OpenAPI 3.1.0 Spec:** `https://paypal-ai-billing-mcp.apd1034.workers.dev/api/openapi.json`  
**PDF Receipt Endpoint:** `https://paypal-ai-billing-mcp.apd1034.workers.dev/api/receipts/:invoice_number.pdf`

---

## 1. Unified MCP Gateway Architecture (30 Tools)

External AI clients (ChatGPT MCP, Claude Desktop, MCP Inspector, or custom agents) connect to **one single MCP endpoint** (`https://paypal-ai-billing-mcp.apd1034.workers.dev/mcp`) and gain access to **30 unified tools** (26 baseline + 4 Sandbox card & PDF receipt tools) across three source categories and three permission tiers.

### 1.1 Tool Breakdown by Source

| Source Category | Count | Tools |
| --- | --- | --- |
| **Native Application (`native_app`)** | 21 | `discover_billing_capabilities`, `list_demo_customers`, `search_invoices`, `get_invoice_details`, `explain_outstanding_balances`, `get_transaction_history`, `get_payment_receipt`, `generate_receipt_pdf`, `get_financial_audit_history`, `get_paypal_sandbox_status`, `get_business_metrics`, `create_invoice_proposal`, `prepare_payment_proposal`, `prepare_refund_proposal`, `create_approved_invoice`, `create_paypal_checkout_order`, `capture_paypal_checkout_order`, `execute_approved_refund`, `void_unpaid_invoice`, `reset_demo_session`, `execute_conversational_instruction` |
| **Official PayPal MCP (`official_paypal_mcp`)** | 1 | `paypal_discover_official_mcp` |
| **PayPal REST Adapter (`paypal_rest_adapter`)** | 8 | `paypal_get_order`, `paypal_get_refund`, `paypal_list_invoices`, `paypal_generate_invoice_number`, `paypal_list_disputes`, `paypal_check_card_eligibility`, `execute_sandbox_card_payment`, `run_sandbox_card_lifecycle_test` |

### 1.2 Official PayPal Sandbox MCP Server Diagnostic (`https://mcp.sandbox.paypal.com`)

During integration with PayPal's official remote MCP server (`https://mcp.sandbox.paypal.com`), we verified the live transport and execution behavior:

1. **Endpoint Discovery:**
   - `https://mcp.sandbox.paypal.com/http` returns `HTTP 404 Not Found` (`Requested path /http not found`).
   - `https://mcp.sandbox.paypal.com/.well-known/oauth-authorization-server` returns `HTTP 200 OK` (OAuth 2.0 metadata with issuer `https://mcp.sandbox.paypal.com`).
   - `GET https://mcp.sandbox.paypal.com/sse` with `Authorization: Bearer <PayPal_Sandbox_Access_Token>` returns `HTTP 200 OK` (`text/event-stream`), initializes `PayPal MCP Agent v1.0.0`, and lists **46 official PayPal tools** (`create_order`, `get_order`, `capture_order`, `create_refund`, `get_refund`, `list_invoices`, `generate_invoice_number`, `list_disputes`, etc.).
2. **Upstream Cloudflare Workers Runtime Issue in `@paypal/agent-toolkit`:**
   - When invoking `tools/call` on PayPal's hosted remote MCP server (`mcp.sandbox.paypal.com`), PayPal's internal Cloudflare Worker executes `@paypal/agent-toolkit` (`src/shared/functions.ts:2053`), which uses `axios` with `cache: "default"` in its `fetch` adapter. Cloudflare Workers' runtime `fetch` rejects `cache: "default"`, causing PayPal's hosted MCP server to return `PAYPAL_API_SETUP_ERROR: "Unsupported cache mode: default"`.
3. **Unified Gateway Solution:**
   - Our Unified MCP Gateway exposes `paypal_discover_official_mcp` (`source: "official_paypal_mcp"`) to inspect live connectivity and OAuth status against `mcp.sandbox.paypal.com/sse`, while executing the 5 official PayPal tool contracts (`paypal_get_order`, `paypal_get_refund`, `paypal_list_invoices`, `paypal_generate_invoice_number`, `paypal_list_disputes`, `source: "paypal_rest_adapter"`) directly against `https://api-m.sandbox.paypal.com` using native `fetch` with zero `cache` runtime errors.

---

## 2. Conversational Authorization & Proposal Security (`Section 6`)

The PayPal AI Billing Kit supports **two complementary authorization paths** for mutating actions:

### Path A: Cryptographic Proposal Token (`proposal_id`)
1. Calling a proposal tool (`create_invoice_proposal`, `prepare_payment_proposal`, `prepare_refund_proposal`) persists a server-side proposal record in `public.billing_ai_action_proposals` (30-minute TTL) and issues an HMAC-SHA256 signed token (`PPB-PROP-1.<payload>.<signature>`).
2. Executing a confirmed write tool (`create_approved_invoice`, `create_paypal_checkout_order`, `execute_approved_refund`) verifies:
   - HMAC signature integrity (tampered or forged tokens are rejected with `INVALID_PROPOSAL_TOKEN`).
   - Server-side database status (`pending`) and non-expiration (`expires_at > now()`, or rejected with `EXPIRED_PROPOSAL_TOKEN`).
   - Exact parameter binding (e.g., `invoice_number` and `amount_cents` must match the proposal, or rejected with `PROPOSAL_PARAMETER_MISMATCH`).
   - Single-use consumption (replaying a consumed `proposal_id` is rejected with `PROPOSAL_ALREADY_CONSUMED`).

### Path B: Explicit Conversational Instruction (`user_instruction` / `execute_conversational_instruction`)
When a user gives a direct, unambiguous action command in ChatGPT or the in-app Billing AI Assistant, `evaluateConversationalAuthorization` (`packages/paypal-billing-kit/src/conversationalAuth.ts`) evaluates whether the utterance authorizes execution without requiring a separate button click:

| Utterance Type | Example | Allowed to Execute? | Reason Code |
| --- | --- | --- | --- |
| **Capability Question** | `"Can you refund invoices?"` | ❌ **NO** | `CAPABILITY_QUESTION_NOT_COMMAND` |
| **Hypothetical Question** | `"What would happen if I paid Alex Rivera's invoice?"` | ❌ **NO** | `HYPOTHETICAL_NOT_COMMAND` |
| **Read / Explanation Request** | `"Show me Alex Rivera's invoices."` | ❌ **NO** (Read-Only) | `READ_ONLY_REQUEST` |
| **Explicit Create Invoice** | `"Create a $35 invoice for Alex Rivera for immunization."` | ✅ **YES** (`create_invoice`) | `EXPLICIT_CONVERSATIONAL_COMMAND` |
| **Explicit Prepare Payment** | `"Pay Alex Rivera's $35 invoice PPB-INV-2026-1003."` | ✅ **YES** (`prepare_payment` → real PayPal Sandbox approval URL) | `EXPLICIT_CONVERSATIONAL_COMMAND` |
| **Explicit Refund** | `"Refund $20 on invoice PPB-INV-2026-1003."` | ✅ **YES** (`execute_refund` within `$500` single / `$2,500` daily guardrails) | `EXPLICIT_CONVERSATIONAL_COMMAND` |
| **Over-Limit Refund** | `"Refund $600 on invoice PPB-INV-2026-1003."` | ❌ **NO** | `EXCEEDS_SINGLE_ACTION_LIMIT` (`$500.00` max) |
| **Explicit Void Unpaid Invoice** | `"Void unpaid invoice PPB-INV-2026-1001."` | ✅ **YES** (`void_invoice`) | `EXPLICIT_CONVERSATIONAL_COMMAND` |
| **Prior Proposal Confirmation** | `"Yes, confirm that."` (with active pending proposal) | ✅ **YES** | `CONFIRMED_PRIOR_PROPOSAL` |

> **PayPal Buyer Checkout Invariant:** Even when `"Pay Alex Rivera's $35 invoice"` is authorized conversationally, the system **never** fabricates a payment capture. It creates a real PayPal Sandbox Order (`v2/checkout/orders`) and returns the `checkout_approval_url` for genuine buyer approval on `sandbox.paypal.com`.

---

## 3. Professional Merchant-Branded PDF 1.4 Receipt Engine (`v1.8.0`)

Every paid, partially refunded, or refunded invoice has a structured JSON receipt (`get_payment_receipt`, `generate_receipt_pdf`) and a merchant-branded **PDF 1.4 binary receipt** (`packages/paypal-billing-kit/src/pdfReceipt.ts`) containing:
- **Merchant-First Header:** Configurable `MerchantBrandingConfig` displaying **Jenkins Wellness & Telehealth Practice**, **Provider: Dr. Sarah Jenkins**, and customer support contact (`sarah.jenkins@demo.paypal-billing-kit.local`), with optional monogram logo badge or clean text-based header (never inventing unconfigured addresses or telephone numbers).
- **4 Distinct Receipt Presentation States (+ Unpaid Refusal):**
  1. `Payment Receipt — Paid` (Verified PayPal Sandbox capture)
  2. `Payment & Refund Receipt — Refunded` (Verified full PayPal Sandbox refund)
  3. `Payment Receipt — Partially Refunded` (Partial refund with `Net Payment Retained` and `Remaining Balance`)
  4. `Sample Demo Receipt — Not a Real PayPal Payment` (Simulated demo settlement)
  5. Unpaid / draft / void invoices are refused (`RECEIPT_UNAVAILABLE_UNPAID_INVOICE`).
- **PayPal Verification & Attribution:** Payment method, card brand and last four digits (when paid by card), PayPal Capture ID, PayPal Order ID, Refund IDs & dates, explicit **PayPal Sandbox Test Transaction** labeling, and modest **"Payment processed through PayPal"** attribution.
- **Customer-Facing Footer:** `"This receipt was generated electronically. Please retain it for your records."` (zero internal MCP, database, or Zero-PHI terminology on customer-facing documents).
- **Direct Download Endpoint:** `GET https://paypal-ai-billing-mcp.apd1034.workers.dev/api/receipts/:invoice_number.pdf` (`Content-Type: application/pdf`).

---

## 3b. Gemini 3.5 Flash-Lite Compatibility Architecture (`v1.8.0`)

Ahead of Google AI Studio's December 1, 2026 automatic redirect from `gemini-2.5-flash` to `gemini-3.5-flash-lite`:
- `supabase/functions/billing-ai-assistant/index.ts` and `packages/paypal-billing-kit/src/geminiCompat.ts` target `gemini-3.5-flash-lite` using `thinkingConfig: { thinkingLevel: "MEDIUM" }` and `maxOutputTokens: 1536` (replacing deprecated `thinkingBudget: 0` and custom `temperature: 0.1`).
- Multi-turn `thoughtSignature` values from model `functionCall` parts are persisted in `public.billing_ai_messages.tool_calls` JSONB and replayed only on matching-model turns (`sanitizeMultiTurnContents`), while `buildOrderedFunctionResponseTurn` guarantees 1-to-1 ordered `functionResponse` matching by `id` and `name`.

---

## 4. Automated Server-Side PayPal Sandbox Card Payments & 8-State Attempt Classification (`v1.7.0`)

### 4.1 Server-Side Sandbox Direct-Card Checkout (`payment_source.card`)
To enable deterministic, end-to-end automated testing (`Order → Capture → Receipt → Refund`) without requiring manual PayPal wallet login while preserving the wallet checkout flow:
1. `paypal_check_card_eligibility` verifies OAuth 2.0 reachability and Orders v2 `payment_source.card` merchant eligibility (`APP-5SK74342S6474230W`).
2. `execute_sandbox_card_payment` accepts only allowlisted Sandbox card profile identifiers (`visa_sandbox`, `mastercard_sandbox`, `amex_sandbox`, `decline_refused`, `decline_expired`, `decline_insufficient_funds`) and rejects any caller-supplied raw PAN or CVV (`RAW_CARD_CREDENTIALS_FORBIDDEN`).
3. Server-side `paypal-billing` constructs the PayPal Orders v2 `payment_source.card` payload in memory inside Sandbox-only mode, verifies the resulting capture via `GET /v2/checkout/orders/{id}`, and records only masked metadata (`card_brand`, `card_last_digits`, `processor_response_code`).

### 4.2 8-State Payment-Attempt Classification
All payment attempts in `public.billing_payment_attempts` are classified into one of 8 states:
- `awaiting_buyer_approval` — Wallet checkout order created (`PAYER_ACTION_REQUIRED`), waiting for buyer approval.
- `approval_required` — Capture attempted before buyer approval (`HTTP 422 — ORDER_NOT_APPROVED`). Does **not** increment `failed_payment_attempts_count`.
- `payment_declined` — Card or funding instrument genuinely declined (`INSTRUMENT_DECLINED`, `CARD_DECLINED`, processor response `0500`/`5400`/`5100`). Increments `failed_payment_attempts_count`.
- `buyer_canceled` — Buyer canceled checkout before authorizing payment.
- `authorized` — Payment authorized (`intent: "AUTHORIZE"`), awaiting capture.
- `captured` — Payment capture verified against PayPal Sandbox (`COMPLETED`).
- `refunded` — Captured payment subsequently refunded via PayPal Captures v2 (`COMPLETED`).
- `processing_error` — Upstream network or provider error.

### 4.3 Session-Scoped Financial Audit Isolation
`get_financial_audit_history` enforces strict session and role isolation:
- Visitors with a private `demo_session_id` see only events belonging to their `demo_session_id` (`record_scope: "session_private"`) plus canonical seed baseline events (`record_scope: "canonical_seed"`).
- Cross-session requests (`target_demo_session_id !== demo_session_id` without verified admin privileges) are rejected with `CROSS_SESSION_AUDIT_ACCESS_DENIED`.
- Customer personas (`actor_role: "customer"`) see only audit events tied to their own invoices.

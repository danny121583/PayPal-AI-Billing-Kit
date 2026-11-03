# Changelog

All notable changes to the standalone **PayPal AI Billing Kit** (`@paypal-ai/billing-kit`) are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.9.0] - 2026-11-02

### Added
- **Full 82-Tool Unified PayPal MCP Integration & Sandbox REST-to-MCP Expansion (`packages/paypal-billing-kit/src/mcpRegistry.ts`, `supabase/functions/billing-maas-mcp/index.ts`, `worker/src/index.ts`, `components/billing/BillingMaaSMcpModal.tsx`, `scripts/verify-full-paypal-mcp.mjs`):**
  - Expanded the Unified PayPal MCP Gateway (`https://paypal-ai-billing-mcp.apd1034.workers.dev/mcp`, `https://dvzfesfvefggnunkjhom.supabase.co/functions/v1/billing-maas-mcp`, `https://paypal-ai-billing-kit.vercel.app/api/mcp`) from 30 tools to **82 callable tools** (`39` Read-Only, `3` Proposal-Only, `40` Confirmed Financial Execution):
    - **21 Native Application Tools (`source: "native_application"`):** Preserved all 21 application billing, receipt, audit, guardrail, and conversational tools.
    - **47 Official PayPal MCP Tools (`source: "official_paypal_mcp"`):** `paypal_discover_official_mcp` plus all **46 official PayPal MCP tools** discovered from `https://mcp.sandbox.paypal.com/sse` (`@paypal/mcp@1.8.1` / `@paypal/agent-toolkit@1.11.0`) exposed by their exact official names (`create_invoice`, `create_recurring_series`, `activate_recurring_series`, `get_recurring_series`, `cancel_recurring_series`, `delete_recurring_series`, `list_invoices`, `get_invoice`, `send_invoice`, `send_invoice_reminder`, `cancel_sent_invoice`, `delete_invoice`, `setup_invoice_auto_reminders`, `update_invoice_auto_reminder`, `search_invoicing`, `update_invoicing`, `cancel_invoice_auto_reminder`, `generate_invoice_qr_code`, `generate_invoice_number`, `record_payment_for_invoice`, `record_refund_for_invoice`, `create_conditional_rules_for_invoice`, `create_product`, `list_products`, `update_product`, `show_product_details`, `create_subscription_plan`, `list_subscription_plans`, `show_subscription_plan_details`, `create_subscription`, `show_subscription_details`, `cancel_subscription`, `update_subscription`, `create_shipment_tracking`, `get_shipment_tracking`, `update_shipment_tracking`, `create_order`, `get_order`, `pay_order`, `list_disputes`, `get_dispute`, `accept_dispute_claim`, `list_transactions`, `create_refund`, `get_refund`, `get_merchant_insights`).
    - **14 PayPal Sandbox REST-to-MCP Adapter Tools (`source: "paypal_rest_adapter"`):** 8 existing (`paypal_get_order`, `paypal_get_refund`, `paypal_list_invoices`, `paypal_generate_invoice_number`, `paypal_list_disputes`, `paypal_check_card_eligibility`, `execute_sandbox_card_payment`, `run_sandbox_card_lifecycle_test`) + 6 new (`update_plan`, `paypal_authorize_order`, `paypal_list_webhooks`, `paypal_list_webhook_event_types`, `paypal_list_invoice_templates`, `paypal_create_vault_setup_token`).
  - Resolved the upstream `PAYPAL_API_SETUP_ERROR: "Unsupported cache mode: default"` failure on `https://mcp.sandbox.paypal.com/sse` (caused by `@paypal/agent-toolkit`'s `axios` fetch adapter passing `cache: "default"` inside Cloudflare Workers) by executing all 46 official PayPal MCP tool contracts server-side against `https://api-m.sandbox.paypal.com` using native `fetch` with `PayPal-Request-Id` idempotency headers, `$500` single-action / `$2,500` daily guardrails, sensitive-data firewall (`SENSITIVE_CLINICAL_DATA_BLOCKED`), RBAC (`actor_role`), and immutable `billing_audit_events` logging.
  - Added `npm run verify:full-paypal-mcp` (`scripts/verify-full-paypal-mcp.mjs`) and generated four machine-readable evidence reports (`evidence/official-paypal-mcp-tool-inventory.json`, `evidence/full-paypal-mcp-verification.json`, `evidence/rest-to-mcp-adapter-verification.json`, `evidence/mcp-cross-endpoint-parity.json`).

---

## [1.8.0] - 2026-11-02

### Added
- **Canonical 30-Tool MCP Registry & Multi-Endpoint Schema Reconciliation (`packages/paypal-billing-kit/src/mcpRegistry.ts`, `worker/src/index.ts`, `supabase/functions/billing-maas-mcp/index.ts`, `scripts/verify-maas-mcp.mjs`, `evidence/07_mcp_tool_inventory_reconciliation.json`):**
  - Established `packages/paypal-billing-kit/src/mcpRegistry.ts` as the single authoritative canonical source of truth for all **30 callable MCP tools** (`21` Native Application + `1` Official PayPal MCP Discovery + `8` PayPal Sandbox REST Adapters; `18` Read-Only + `3` Proposal-Only + `9` Confirmed Financial Execution), including canonical `annotations`, `inputSchema`, and deterministic `computeToolSchemaFingerprint(schema)`.
  - Replaced the duplicate 940-line `MCP_TOOLS_CATALOG` in `worker/src/index.ts` and synchronized `MCP_TOOLS` in `supabase/functions/billing-maas-mcp/index.ts` directly from `UNIFIED_MCP_TOOL_REGISTRY`, eliminating 6 parameter-level schema drifts (`search_invoices`, `get_invoice_details`, `get_payment_receipt`, `create_invoice_proposal`, `create_approved_invoice`, `prepare_payment_proposal`, `prepare_refund_proposal`, `execute_approved_refund`) and removing stale hardcoded `"26 tools"` and `"15 tools"` strings in `initialize`, `server/discover`, `/docs/mcp`, and OpenAPI metadata.
  - Updated `scripts/verify-maas-mcp.mjs` (`38/38` checks) to dynamically audit `GET`, `initialize`, and `tools/list` across all 3 live endpoints (`https://paypal-ai-billing-mcp.apd1034.workers.dev/mcp`, `https://dvzfesfvefggnunkjhom.supabase.co/functions/v1/billing-maas-mcp`, `https://paypal-ai-billing-kit.vercel.app/api/mcp`) and emit `evidence/07_mcp_tool_inventory_reconciliation.json`.
- **Gemini 3.5 Flash-Lite Compatibility Migration (`packages/paypal-billing-kit/src/geminiCompat.ts`, `supabase/functions/billing-ai-assistant/index.ts`, `scripts/verify-gemini-and-receipts.mjs`):**
  - Migrated the Billing AI Assistant ahead of Google AI Studio's December 1, 2026 automatic redirect deadline from `gemini-2.5-flash` to `gemini-3.5-flash-lite` and upgraded `@google/genai` from `^1.0.0` (`1.44.0`) to `^2.32.0` (`2.32.0`).
  - Replaced deprecated numeric `thinkingBudget: 0` with `thinkingConfig: { thinkingLevel: "MEDIUM" }` and increased `maxOutputTokens` from `350` to `1536` so `thoughtsTokenCount` reasoning tokens never starve `candidatesTokenCount` responses.
  - Added multi-turn `thoughtSignature` extraction and persistence (`billing_ai_messages.tool_calls` JSONB) with cross-model signature stripping (`sanitizeMultiTurnContents`) to prevent `HTTP 400` signature validation errors across legacy turns.
  - Enforced strict ordered `functionCall` / `functionResponse` pairing with matching `id` and `name` (`buildOrderedFunctionResponseTurn`) and removed deprecated custom sampling parameters (`temperature: 0.1`), unsupported `candidateCount`, and model-turn prefilling.
  - Added `gemini-compatibility-benchmark` action and live side-by-side verification (`evidence/05_gemini_3_5_flash_lite_migration.json`).
- **Professional Merchant-Branded PDF 1.4 Receipts (`packages/paypal-billing-kit/src/pdfReceipt.ts`, `supabase/functions/billing-maas-mcp/index.ts`, `components/billing/BillingInvoiceDetailModal.tsx`):**
  - Redesigned customer-facing PDF 1.4 receipts and in-app settlement notices with merchant-first branding (`MerchantBrandingConfig`) displaying **Jenkins Wellness & Telehealth Practice** and **Provider: Dr. Sarah Jenkins** as the primary business identity (supporting optional monogram logo badge or clean text-based header without inventing unconfigured addresses or phone numbers).
  - Removed internal technical language (`Generated by PayPal AI Billing Kit Unified MCP Gateway - Zero PHI Administrative Ledger`, internal MCP/database/Zero-PHI terminology, and internal service codes) from customer-facing receipts and replaced the footer with: `"This receipt was generated electronically. Please retain it for your records."` plus customer support contact details.
  - Implemented explicit presentation states for verified PayPal payment (`Payment Receipt — Paid`), verified full PayPal refund (`Payment & Refund Receipt — Refunded`), partial refund (`Payment Receipt — Partially Refunded` with `Net Payment Retained`), simulated demo settlement (`Sample Demo Receipt — Not a Real PayPal Payment`), and unpaid invoice refusal (`RECEIPT_UNAVAILABLE_UNPAID_INVOICE`), with clear **PayPal Sandbox Test Transaction** labeling and **"Payment processed through PayPal"** attribution.

---

## [1.7.0] - 2026-11-02

### Added
- **Automated Server-Side PayPal Sandbox Card Payments (`supabase/functions/paypal-billing/index.ts`, `supabase/functions/billing-maas-mcp/index.ts`, `worker/src/index.ts`, `packages/paypal-billing-kit/src/mcpRegistry.ts`):**
  - Expanded the unified MCP gateway (`https://paypal-ai-billing-mcp.apd1034.workers.dev/mcp` and `https://paypal-ai-billing-kit.vercel.app/api/mcp`) from 26 tools to **30 unified tools** (`18 Read-Only`, `3 Proposal-Only`, `9 Confirmed Write`; `21 Native Application`, `1 Official PayPal MCP`, `8 PayPal REST Adapter`).
  - Added `paypal_check_card_eligibility` (`[READ_ONLY]`) to verify PayPal Sandbox OAuth 2.0 reachability, Orders v2 `payment_source.card` direct-card merchant eligibility (`direct_card_eligible: true`), and allowlisted Sandbox card profiles (`visa_sandbox`, `mastercard_sandbox`, `amex_sandbox`, `decline_refused`, `decline_expired`, `decline_insufficient_funds`).
  - Added `execute_sandbox_card_payment` (`[CONFIRMED_WRITE]`) to execute server-side PayPal Sandbox card payments via `POST /v2/checkout/orders` with `payment_source.card`, verify captures directly against `GET /v2/checkout/orders/{id}`, and reconcile `billing_transactions` and `billing_invoices`. Rejects caller-supplied raw PAN/CVV (`RAW_CARD_CREDENTIALS_FORBIDDEN`).
  - Added `generate_receipt_pdf` (`[READ_ONLY]`) to generate and validate binary PDF 1.4 receipts for paid or refunded invoices while refusing unpaid/draft/void invoices (`RECEIPT_UNAVAILABLE_UNPAID_INVOICE`).
  - Added `run_sandbox_card_lifecycle_test` (`[CONFIRMED_WRITE]`) to run an isolated 7-step real PayPal Sandbox card lifecycle test (`Invoice → Card Order → Capture → Direct PayPal Verify → PDF Receipt → Refund → Direct PayPal Refund Verify`).
- **25-Stage End-to-End Automated Verification Suite (`scripts/verify-paypal-full.mjs`, `npm run verify:paypal-full`):**
  - Added comprehensive 25-stage automated verification script covering standalone repo & Supabase isolation, secret scanning, PayPal Sandbox OAuth & card eligibility, 30-tool MCP discovery, Official PayPal MCP SSE discovery, conversational capability/hypothetical/anti-spoofing/guardrail checks, wallet checkout `awaiting_buyer_approval` & `approval_required` (`ORDER_NOT_APPROVED`) classification, live Sandbox card Order (`6M891981CF190590M`), Capture (`0CD44204BD166461N`), PDF rendering (`%PDF-1.4` + PNG visual verification), Refund (`4P971203UB311032F`), cross-session audit isolation, and demo session reset.

### Fixed
- **8-State Payment-Attempt Classification & Premature Capture (`ORDER_NOT_APPROVED`) Handling (`supabase/migrations/20261103000000_card_checkout_classification_and_audit_isolation.sql`, `supabase/functions/paypal-billing/index.ts`, `components/billing/BillingInvoiceDetailModal.tsx`):**
  - Implemented explicit 8-state payment-attempt classification (`awaiting_buyer_approval`, `approval_required`, `payment_declined`, `buyer_canceled`, `authorized`, `captured`, `refunded`, `processing_error`).
  - Reclassified premature capture attempts (`HTTP 422 — ORDER_NOT_APPROVED`, including Order `02M869433T525841J` on `#PPB-INV-2026-1069`) from `failed` to `approval_required` with actionable guidance (`"PayPal is waiting for buyer approval. Complete Sandbox checkout before capturing this payment."`), while preserving original `failure_code` and `failure_message` audit metadata.
  - Updated `failed_payment_attempts_count` and `failedPaymentsCount` metrics to count only genuine payment instrument declines (`payment_declined`).
- **Audit-History Session Isolation (`supabase/functions/billing-maas-mcp/index.ts`, `src/billing/api/billingService.ts`, `supabase/migrations/20261103000000_card_checkout_classification_and_audit_isolation.sql`):**
  - Hardened `get_financial_audit_history` and `public.billing_log` so private `demo_session_id` queries (including `chatgpt-full-sandbox-20261102`) strictly return only events belonging to that session or canonical seed invoices (`record_scope: "canonical_seed"` vs `"session_private"`), blocking cross-session `target_demo_session_id` access (`CROSS_SESSION_AUDIT_ACCESS_DENIED`) and customer access to other customers' records.
- **Conversational Authorization Anti-Spoofing (`packages/paypal-billing-kit/src/conversationalAuth.ts`, `supabase/functions/billing-maas-mcp/index.ts`):**
  - Blocked role impersonation when a customer persona supplies `actor_role: "provider"` (`ROLE_IMPERSONATION_BLOCKED`), blocked fabricated approval flags (`FABRICATED_APPROVAL_BLOCKED`), and ensured capability/hypothetical questions never execute even when `prior_execution_intent: true` is passed.
- **PDF 1.4 Multi-Line Administrative Description Wrapping (`packages/paypal-billing-kit/src/pdfReceipt.ts`, `supabase/functions/billing-maas-mcp/index.ts`):**
  - Replaced 45-character ellipsis truncation on PDF receipt line item descriptions with clean word-wrapped two-line rendering so full administrative descriptions display without cut-off strings.

---

## [1.6.0] - 2026-11-02

### Added
- **Unified 26-Tool PayPal MCP Gateway (`worker/src/index.ts`, `supabase/functions/billing-maas-mcp/index.ts`, `packages/paypal-billing-kit/src/mcpRegistry.ts`):**
  - Expanded the single MCP endpoint (`https://paypal-ai-billing-mcp.apd1034.workers.dev/mcp` and `https://paypal-ai-billing-kit.vercel.app/api/mcp`) from 19 tools to **26 unified tools** (`16 Read-Only`, `3 Proposal-Only`, `7 Confirmed Write`).
  - Added `paypal_discover_official_mcp` (`source: "official_paypal_mcp"`) to inspect live connectivity, OAuth 2.0 discovery, and the 46-tool catalog on PayPal's official remote MCP server (`https://mcp.sandbox.paypal.com/sse`).
  - Added 5 PayPal Sandbox REST Adapter tools (`paypal_get_order`, `paypal_get_refund`, `paypal_list_invoices`, `paypal_generate_invoice_number`, `paypal_list_disputes`, `source: "paypal_rest_adapter"`) executing official PayPal MCP tool contracts directly against `https://api-m.sandbox.paypal.com` with native `fetch` (bypassing the upstream `@paypal/agent-toolkit` `axios` `cache: "default"` Cloudflare Workers error).
  - Added `execute_conversational_instruction` (`[CONFIRMED_WRITE]`) for natural-language action execution with full guardrail enforcement.
- **Explicit Conversational Authorization Engine (`packages/paypal-billing-kit/src/conversationalAuth.ts`, `supabase/functions/billing-ai-assistant/index.ts`):**
  - Implemented `evaluateConversationalAuthorization` supporting explicit natural-language commands (`create_invoice`, `prepare_payment`, `execute_refund`, `void_invoice`) alongside cryptographic `proposal_id` tokens, while blocking capability questions (`"Can you refund invoices?"`), hypothetical questions (`"What would happen if I paid?"`), read-only queries, and over-limit requests (`>$500.00`).
- **Downloadable PDF 1.4 Receipt Engine (`packages/paypal-billing-kit/src/pdfReceipt.ts`, `worker/src/index.ts`, `components/billing/BillingInvoiceDetailModal.tsx`):**
  - Added zero-dependency PDF 1.4 binary receipt generation served at `GET /api/receipts/:invoice_number.pdf` (`Content-Type: application/pdf`) and embedded in `get_payment_receipt` (`pdf_download_url`, `pdf_base64`, `pdf_byte_length`).
  - Added a **"Download PDF Receipt"** button (`testID="billing-download-pdf-receipt-btn"`) to `BillingInvoiceDetailModal` for `paid`, `partially_refunded`, and `refunded` invoices.
- **Reusable Brand Icon & Browser Tab Favicon (`components/billing/BillingBrandIcon.tsx`, `app/+html.tsx`, `public/favicon.*`):**
  - Created reusable `<BillingBrandIcon />` component and multi-resolution web favicons (`public/favicon.svg`, `public/favicon.png`, `public/favicon.ico`, `public/apple-touch-icon.png`) rendered in the browser tab, top navigation header, and Unified MCP Agent Interface modal.
- **Complete Standalone Repository Isolation:**
  - Replaced symlinked `node_modules` with a standalone local installation (`package-lock.json`, 956 packages), consolidated screenshots under `docs/screenshots/`, removed obsolete planning files (`docs/01_*.md`–`docs/06_*.md`), and added `docs/UNIFIED_MCP_AND_SECURITY_ARCHITECTURE.md`.

---

## [1.5.0] - 2026-11-02

### Added
- **End-to-End Real PayPal Sandbox Verification (`scripts/verify-live-paypal-sandbox.mjs`, `evidence/04_live_paypal_sandbox_transaction.json`):**
  - Configured and verified PayPal Sandbox `Default Application` (`APP-5SK74342S6474230W`) OAuth 2.0 handshake (`POST /v1/oauth2/token` → `200 OK`) via server-only `billing_platform_secrets`.
  - Executed and reconciled a complete live PayPal Sandbox transaction lifecycle on session-scoped invoice `#PPB-INV-2026-1057` (`562b3029-9a2c-452b-8ee8-d04939e336bf`, `$35.00 USD`, `ADMIN-FORMS`):
    - **Order Creation (`POST /v2/checkout/orders`):** `7FA47897KM5938009` (`PAYER_ACTION_REQUIRED`)
    - **Order Capture (`POST /v2/checkout/orders/7FA47897KM5938009/capture`):** `5HM71086SR568352C` (`COMPLETED`, `$35.00 USD`, `captured_at: 2026-11-02T21:53:02.952534+00:00`)
    - **Receipt Verification (`get_payment_receipt`):** `receipt_number: 5HM71086SR568352C`, `settlement_verification: paypal_sandbox_verified`, `is_live_paypal_capture: true`
    - **Refund Execution (`POST /v2/payments/captures/5HM71086SR568352C/refund`):** `2EM77813GU330222M` (`COMPLETED`, `$35.00 USD`, `completed_at: 2026-11-02T21:53:07.54377+00:00`)

### Security
- **Mandatory Server-Side Proposal Verification Across Financial Execution Tools (`supabase/functions/billing-maas-mcp/index.ts`, `worker/src/index.ts`):**
  - Required valid `proposal_id` + `explicit_human_approval: true` on `create_approved_invoice`, `create_paypal_checkout_order`, and `execute_approved_refund`.
  - Enforced 5 server-side invariants on every proposal execution: (1) Session ownership (`CROSS_SESSION_PROPOSAL_ACCESS_DENIED` + Cloudflare Worker HMAC-SHA256 `<uuid>.<sig16>` binding), (2) Proposal kind match (`INVALID_PROPOSAL_KIND`), (3) One-time execution / replay protection (`DUPLICATE_APPROVAL_BLOCKED`), (4) Expiration enforcement (`PROPOSAL_EXPIRED`), and (5) Parameter binding (`PROPOSAL_PARAMETER_MISMATCH`).
- **Truthful PayPal Connection Status Labels (`components/billing/PayPalConnectCard.tsx`, `src/billing/api/billingService.ts`):**
  - Replaced generic `SANDBOX CONNECTED` on unverified demo rows with distinct verified vs. unverified states: `SANDBOX AUTHENTICATED` + `Account Linked` (when `oauthVerified === true` and `paypal_verified === true`), `DEMO PROFILE AVAILABLE` + `Sandbox Configuration Missing` (when `oauthVerified === false`), and `DISCONNECTED` (when `connected === false`).

---

## [1.4.0] - 2026-11-02

### Added
- **19-Tool Conversational Financial MCP Workflow (`billing-maas-mcp` v4 & Cloudflare Worker `paypal-ai-billing-mcp`):**
  - Added `create_paypal_checkout_order` (`[CONFIRMED_WRITE]`) to create protected PayPal Sandbox checkout orders (`POST /v2/checkout/orders`) from approved `payment_checkout` proposals or unpaid statements with `explicit_human_approval: true`.
  - Added `capture_paypal_checkout_order` (`[CONFIRMED_WRITE]`) to capture approved PayPal Sandbox orders (`order_id`) or execute explicitly labeled isolated demo session settlements (`allow_demo_settlement_fallback: true`) with zero fabrication of live PayPal IDs.
  - Added `get_payment_receipt` (`[READ_ONLY]`) to retrieve structured payment receipts and settlement provenance (`paypal_sandbox_verified` vs. `sample_demo_settlement_not_live_paypal`).
  - Added `execute_approved_refund` (`[CONFIRMED_WRITE]`) to execute approved provider refunds (`proposal_id` from `prepare_refund_proposal`) via PayPal Captures v2 or isolated demo session overrides.
- **ChatGPT MCP Connector Hardening (`worker/src/index.ts`):**
  - Added `securitySchemes` (`noauth` + `oauth2` authorizationCode flow), `_meta['openai/outputTemplate']`, and `text/html+skybridge` widget resources in `resources/list` and `resources/read`.
  - Extended HMAC-SHA256 stateless session-proposal binding (`<uuid>.<sig16>`) across `create_invoice_proposal` → `create_approved_invoice`, `prepare_payment_proposal` → `create_paypal_checkout_order`, and `prepare_refund_proposal` → `execute_approved_refund`.
- **Automated Regression Tests & Documentation Assets:**
  - Added Jest regression tests in `__tests__/paypalBillingKit.test.tsx` covering `PayPalConnectCard` Connected/Disconnected state transitions and Jordan Taylor `#PPB-INV-2026-1004` failed payment retry.
  - Added 10 production UI screenshots under `docs/assets/screenshots/` and expanded `README.md` with Mermaid architecture diagram, 19-tool reference table, ChatGPT setup instructions, and end-to-end conversational prompt playbook.

### Fixed
- **PayPal Sandbox Connection Card State Machine (`components/billing/PayPalConnectCard.tsx`, `src/billing/api/billingService.ts`):**
  - Fixed `PayPalConnectCard` so `DISCONNECTED` state hides setup input fields until `Connect PayPal Sandbox` is clicked, and `SANDBOX CONNECTED` state displays `paypal-connected-account-summary`, hides setup inputs, and renders `Disconnect PayPal Sandbox`.
  - Synchronized `setPreloadedPayPalConnection(userId, summary)` across `connect-account` and `disconnect-account` so persona switches preserve connection state without stale cache resets.
- **Failed Payment Retry on Jordan Taylor `#PPB-INV-2026-1004` (`supabase/functions/paypal-billing/index.ts` v5, `components/billing/BillingInvoiceDetailModal.tsx`):**
  - Fixed `Invoice not found.` defect when clicking `Retry with PayPal Sandbox` on `#PPB-INV-2026-1004` (`$50.00`) by accepting both camelCase (`invoiceId`) and snake_case (`invoice_id`) parameters, adding `resolveInvoiceByIdOrNumber()` (mapping synthetic fixture UUIDs `44444444-...` → canonical DB UUIDs `33333333-...` and falling back to `invoice_number`), and permitting isolated visitor sessions (`demo-sess-...`) to initiate checkout on canonical seed statements while keeping `canonical` read-only.

---

## [1.3.0] - 2026-11-02

### Added
- **Live Google Gemini 2.5 Flash Conversational Billing AI (`supabase/functions/billing-ai-assistant/index.ts`, commit `47ab445`):**
  - Integrated real `gemini-2.5-flash` inference with structured JSON output schema, multi-turn conversation history, natural-language invoice proposal extraction, conversational mistake correction, and sensitive clinical/medical query refusal boundaries.
- **Database-Backed Proposal Verification & Security Hardening (`supabase/migrations/20261102120000_ai_proposals_session_isolation.sql`, `20261102140000_billing_platform_secrets.sql`):**
  - Enforced server-side `proposal_id` validation, single-use replay prevention (`DUPLICATE_APPROVAL_BLOCKED`), cross-session proposal isolation (`CROSS_SESSION_PROPOSAL_ACCESS_DENIED`), and encrypted server-only `billing_platform_secrets` storage.
  - Added 20-check live Gemini & security audit script (`scripts/verify-security-and-ai.mjs`).

### Changed
- **MCP Agent Interface Branding & Instant Preloaded Persona Switching (`commit 7e23e4f`):**
  - Removed all user-facing `MaaS` / `Model-as-a-Service` terminology across the UI, OpenAPI 3.1.0 schema, and MCP gateway in favor of **MCP Agent Interface**.
  - Implemented silent startup preloading (`preloadAllDemoPersonas`) so switching between `Dr. Sarah Jenkins`, `Alex Rivera`, and `Jordan Taylor` completes synchronously from memory with zero loading spinners or screen flicker across 21 consecutive switches.

---

## [1.2.0] - 2026-11-02

### Added
- **Dedicated Cloudflare Worker MCP Gateway (`worker/src/index.ts`, `worker/wrangler.toml`, commit `592544f`):**
  - Deployed standalone Cloudflare Worker (`https://paypal-ai-billing-mcp.apd1034.workers.dev/mcp`) implementing MCP JSON-RPC 2.0 (`2025-06-18`, `2025-03-26`, `2024-11-05`, `2026-07-28`), OpenAPI 3.1.0 (`/api/openapi.json`), RFC 9728 Protected Resource Metadata, RFC 8414 Authorization Server Discovery, RFC 7591 Dynamic Client Registration (`/oauth/register`), and ES256 JWKS (`/.well-known/jwks.json`).

---

## [1.1.0] - 2026-11-02

### Added
- **Public Vercel Deployment & Copy-on-Write Visitor Session Isolation (`supabase/migrations/20261102030000_public_demo_maas_mcp.sql`, commit `336aa9b`):**
  - Deployed public web application (`https://paypal-ai-billing-kit.vercel.app`) opening directly into the multi-persona Billing dashboard without a login wall.
  - Added `billing_demo_session_overrides` table and `billing_reset_demo_session` RPC so each visitor session (`demo_session_id`) can create, void, settle, and refund invoices without mutating canonical seed rows for other visitors.

---

## [1.0.0] - 2026-11-01

### Added
- **Initial Standalone PayPal AI Billing Kit Release (`commits 463932c`, `2c9ac8b`):**
  - Created standalone Expo Universal (Web + iOS/Android) workspace (`PayPal-AI-Billing-Kit`) and reusable `@paypal-ai/billing-kit` TypeScript SDK (`packages/paypal-billing-kit`).
  - Provisioned dedicated Supabase project (`dvzfesfvefggnunkjhom`) with 19 `billing_*` tables, `FORCE ROW LEVEL SECURITY`, append-only `billing_audit_events`, `$500.00` single-action and `$2,500.00` daily AI guardrail `CHECK` constraints, and 6 canonical seed statements (`#PPB-INV-2026-1001` through `#PPB-INV-2026-1006`).
  - Implemented `paypal-billing` and `paypal-webhook` Edge Functions for PayPal Sandbox OAuth 2.0, Orders v2 creation/capture, Captures v2 refunds, and webhook signature verification.

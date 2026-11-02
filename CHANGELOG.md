# Changelog

All notable changes to the standalone **PayPal AI Billing Kit** (`@paypal-ai/billing-kit`) are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

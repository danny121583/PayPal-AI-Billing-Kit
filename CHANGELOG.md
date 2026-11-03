# Changelog — PayPal AI Billing Kit (`@paypal-ai/billing-kit`)

All notable changes to the **PayPal AI Billing Kit** are documented in this file.

---

## [`v1.9.1`] — 2026-11-03

### Added & Fixed (Mobile UI Polish, Global Search, PayPal Browser Checkout, Billing AI & Notifications)
- **Issue #1 — Compact Mobile Header & Scrollable Demo Account Controls (`app/index.tsx`, `components/billing/DoctorBillingView.tsx`, `components/billing/PatientBillingView.tsx`):**
  - Reduced the mobile (`< 768px`) orange header (`testID="billing-main-header"`) to a compact `62px` height with untruncated `Provider Billing` / `Customer Billing` titles and concise role subtitles (`Dr. Sarah Jenkins • Provider`, `Alex Rivera • Customer`, `Jordan Taylor • Customer`).
  - Moved the **Active Demo Account** switcher bar (`testID="demo-account-switcher-bar"`, containing `Provider: Dr. Sarah Jenkins`, `Customer: Alex Rivera`, `Customer: Jordan Taylor`, `MCP Agent Interface`, and `Reset Demo`) below the main header inside the normal scrollable `<ScrollView>` content so it scrolls naturally with the dashboard and is never sticky on mobile, while preserving the desktop (`>= 768px`) header layout.
- **Issue #2 — Global Billing Search Modal (`components/billing/BillingGlobalSearchModal.tsx`, `src/billing/api/billingService.ts`):**
  - Wired the header search button (`testID="billing-header-search-btn"`) to open a responsive Global Billing Search modal that auto-focuses the search input (`doctor-billing-search-input` / `patient-billing-search-input`) and searches authorized records across **Invoices**, **Customers**, **Transactions/Payments**, and **Refunds** (`searchAuthorizedBillingRecords`).
  - Added category filter chips (`All`, `Invoices`, `Customers`, `Transactions`, `Refunds`), quick search suggestions, clear query button, loading/empty/error states, tappable result cards that open `BillingInvoiceDetailModal` or `BillingAIAssistantModal`, and strict role/account isolation.
- **Issue #3 — PayPal Sandbox Mobile Browser Checkout (`appSwitchEligible=false`) (`supabase/functions/paypal-billing/index.ts`, `src/billing/api/billingService.ts`, `packages/paypal-billing-kit/src/client.ts`, `components/billing/BillingInvoiceDetailModal.tsx`, `app/index.tsx`):**
  - Resolved the iOS PayPal app handoff issue (`"Head back to PayPal to finish checking out"` at `/app-switch-checkout`) by appending `appSwitchEligible=false` to all PayPal Sandbox `/checkoutnow` approval URLs and providing guest card web checkout (`fundingSource=card`) and classic `/cgi-bin/webscr` fallback URLs.
  - Added an in-modal **PayPal Sandbox Browser Checkout Panel** (`testID="billing-detail-browser-checkout-panel"`) at the top of `BillingInvoiceDetailModal` with browser-only PayPal checkout buttons and in-browser `Orders v2 payment_source.card` direct card checkout (`visa_sandbox`, `mastercard_sandbox`, `decline_refused`), plus `?paypal=return` / `?paypal=cancel` handling and duplicate capture protection.
- **Issue #4 — Billing AI Mobile Formatting & Safe Markdown Rendering (`components/billing/BillingAIAssistantModal.tsx`, `components/billing/BillingModalShell.tsx`):**
  - Built a structured, XSS-safe Markdown & invoice summary renderer (`FormattedAssistantMessage` + `sanitizeUntrustedAiContent`) supporting section headings, statement status pills, bullet lists, numbered steps, bold key-value metadata, and a compact **Financial Summary** pill grid (`Original Total`, `Paid`, `Refunded`, `Remaining Balance Due`).
  - Optimized mobile modal spacing (`< 480px`) with independent conversation scrolling and keyboard-safe message composer.
- **Issue #5 — Billing AI Processing Indicator (`"Preparing your response…"`) (`src/billing/api/billingAIClient.ts`, `components/billing/BillingAIAssistantModal.tsx`):**
  - Added an immediate accessible processing state (`testID="billing-ai-typing"`, `"Preparing your response…"`) with a 2,000ms minimum display hold on conversational turns while firing backend execution immediately at `t = 0`, bypassing the hold for urgent guardrail/security warnings and errors, and recording timing telemetry (`actualDurationMs`, `displayedDurationMs`, `holdAppliedMs`).
- **Issue #6 — Billing Notifications Linked Statement Navigation (`components/billing/BillingNotificationsModal.tsx`, `src/billing/api/billingService.ts`, `app/index.tsx`):**
  - Applied Supabase migration `fix_billing_notifications_session_scope_and_seed` so `public.billing_notify` rows inherit `demo_session_id` and `invoiceNumber`, resolved linked statements via canonical ID or invoice number (`resolveNotificationLinkedInvoice`), enforced active account authorization, marked tapped notifications read with badge decrement, opened `BillingInvoiceDetailModal` with a `"Back to Notifications"` chip, and added an in-modal error banner (`testID="billing-notifications-error-banner"`) for unavailable or unauthorized records.

---

## [`v1.9.0`] — 2026-11-02

### Added
- **Full 82-Tool Unified MCP Gateway (`packages/paypal-billing-kit/src/mcpRegistry.ts`, `supabase/functions/billing-maas-mcp/index.ts`, `worker/src/index.ts`):**
  - Expanded the unified Model Context Protocol (MCP) gateway from `30` tools to **`82` callable tools** across all three live endpoints (`https://paypal-ai-billing-mcp.apd1034.workers.dev/mcp`, `https://dvzfesfvefggnunkjhom.supabase.co/functions/v1/billing-maas-mcp`, and `https://paypal-ai-billing-kit.vercel.app/api/mcp`) and OpenAPI 3.1.0 (`/api/openapi.json`).
  - Integrated all **46 Official PayPal MCP tools** by their exact official names (`create_invoice`, `create_recurring_series`, `activate_recurring_series`, `get_recurring_series`, `cancel_recurring_series`, `delete_recurring_series`, `list_invoices`, `get_invoice`, `send_invoice`, `send_invoice_reminder`, `cancel_sent_invoice`, `delete_invoice`, `setup_invoice_auto_reminders`, `update_invoice_auto_reminder`, `search_invoicing`, `update_invoicing`, `cancel_invoice_auto_reminder`, `generate_invoice_qr_code`, `generate_invoice_number`, `record_payment_for_invoice`, `record_refund_for_invoice`, `create_conditional_rules_for_invoice`, `create_product`, `list_products`, `update_product`, `show_product_details`, `create_subscription_plan`, `list_subscription_plans`, `show_subscription_plan_details`, `create_subscription`, `show_subscription_details`, `cancel_subscription`, `update_subscription`, `create_shipment_tracking`, `get_shipment_tracking`, `update_shipment_tracking`, `create_order`, `get_order`, `pay_order`, `list_disputes`, `get_dispute`, `accept_dispute_claim`, `list_transactions`, `create_refund`, `get_refund`, `get_merchant_insights`) alongside `paypal_discover_official_mcp` (`47` total `official_paypal_mcp` tools).
  - Added **6 new PayPal Sandbox REST-to-MCP Adapter tools** (`update_plan`, `paypal_authorize_order`, `paypal_list_webhooks`, `paypal_list_webhook_event_types`, `paypal_list_invoice_templates`, `paypal_create_vault_setup_token`) to the existing 8 REST adapters (`14` total `paypal_rest_adapter` tools).
  - Preserved all **21 Native Application tools** (`source: "native_application"`).
- **Comprehensive 82-Tool Verification & Evidence Suite (`scripts/verify-full-paypal-mcp.mjs`):**
  - Verifies every single tool in the 82-tool catalog against live PayPal Sandbox (`https://api-m.sandbox.paypal.com`), explicitly distinguishing:
    - **`35` Official PayPal MCP tools (`PASS_REST_ADAPTER`):** Executed live end-to-end against PayPal Sandbox REST v1/v2 APIs (`HTTP 200/201/204`).
    - **`5` Official PayPal MCP tools (`PASS_NEGATIVE_AUTHORIZATION`):** Reach live PayPal Sandbox endpoints and return structured domain state validations when interactive buyer approval (`pay_order`, `cancel_subscription`, `update_subscription`) or an active Sandbox dispute (`get_dispute`, `accept_dispute_claim`) is required.
    - **`4` Official PayPal MCP tools (`BLOCKED_OAUTH_SCOPE`):** Blocked by missing OAuth scopes on PayPal Sandbox `Default Application` (`APP-5SK74342S6474230W`): `create_shipment_tracking`, `get_shipment_tracking`, `update_shipment_tracking` (`shipping/trackers/readwrite`), and `list_transactions` (`reporting/search/read`, with session transaction fallback).
    - **`1` Official PayPal MCP tool (`BLOCKED_UPSTREAM`):** `create_conditional_rules_for_invoice` (upstream PayPal Sandbox `/v2/invoicing/invoices/{id}/conditional-rules` error).
    - **`1` Official PayPal MCP tool (`UNSUPPORTED_BY_SANDBOX`):** `get_merchant_insights` (unsupported in PayPal Sandbox mode by `@paypal/agent-toolkit`, with session metrics fallback).
- **Updated Playable Walkthrough Videos & High-Resolution Screenshots (`docs/videos/`, `docs/screenshots/`, `docs/MEDIA_AUDIT_MANIFEST.md`).**

---

## [`v1.8.0`] — 2026-11-02

### Added & Changed
- **Gemini 3.5 Flash-Lite Compatibility Migration (`gemini-3.5-flash-lite`):**
  - Migrated `supabase/functions/billing-ai-assistant/index.ts` and SDK model defaults from `gemini-2.5-flash` to `gemini-3.5-flash-lite` ahead of Google AI Studio's December 1, 2026 auto-redirect deadline.
  - Replaced numeric `thinking_budget` with `thinkingConfig: { thinkingLevel: "MEDIUM" }`, added `mediaResolution: "MEDIA_RESOLUTION_HIGH"` support, and preserved `thoughtSignature` across multi-turn `functionCall` / `functionResponse` histories.
- **Professional Merchant-Branded PDF 1.4 Receipts (`packages/paypal-billing-kit/src/pdfReceipt.ts`):**
  - Redesigned customer-facing PDF receipts around merchant-first branding (**Jenkins Wellness & Telehealth Practice**, `Provider: Dr. Sarah Jenkins`), state-aware headers (`Payment Receipt - Paid`, `Payment & Refund Receipt - Refunded`, `Payment Receipt - Partially Refunded`, `Sample Demo Receipt - Not a Real PayPal Payment`), `"Payment processed through PayPal"` attribution, and `"This receipt was generated electronically. Please retain it for your records."` footer.
  - Enforced strict refusal (`RECEIPT_UNAVAILABLE_UNPAID_INVOICE`) when requesting a receipt for unpaid, draft, overdue, failed, or voided statements.
- **30-Tool MCP Registry Reconciliation (`packages/paypal-billing-kit/src/mcpRegistry.ts`):**
  - Established a single canonical MCP tool registry with SHA-256 schema fingerprinting across Cloudflare Worker, Supabase Edge Function, and Vercel MCP endpoints.

---

## [`v1.7.0`] — 2026-11-01

### Added
- **Automated Server-Side PayPal Sandbox Direct-Card Checkout (`Orders v2 payment_source.card`):**
  - Added `execute_sandbox_card_payment` and `run_sandbox_card_lifecycle_test` using allowlisted PayPal Sandbox test card profiles (`visa_sandbox`, `mastercard_sandbox`, `amex_sandbox`, `decline_refused`, `decline_expired`, `decline_insufficient_funds`) while rejecting raw card PAN/CVV inputs (`RAW_CARD_CREDENTIALS_FORBIDDEN`).
- **8-State Payment-Attempt Classification & Session-Isolated Financial Audit Trail.**
- **Conversational Authorization (`evaluateConversationalAuthorization`)** alongside HMAC-SHA256 `proposal_id` tokens (`$500.00` single-action / `$2,500.00` daily guardrails).

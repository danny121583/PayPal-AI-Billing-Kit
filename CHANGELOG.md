# Changelog — PayPal AI Billing Kit (`@paypal-ai/billing-kit`)

All notable changes to the **PayPal AI Billing Kit** are documented in this file.

---

## [`v1.9.3`] — 2026-11-03

### Added, Improved & Fixed (Vercel Production Deployment, Public Documentation Polish & 46-Tool PayPal MCP Verification)
- **Vercel Production Build Resolution (`.vercelignore`, `vercel.json`):**
  - Resolved the Vercel deployment error (`The Output Directory "dist" is empty.`) by configuring `.vercelignore` to upload the prebuilt Expo web production bundle (`dist/`) while strictly excluding local-only hackathon demonstration videos, voiceover scripts, and screen recordings (`local-demo/`, `docs/videos/`).
- **Public Documentation Polish (`README.md`, `CHANGELOG.md`):**
  - Refined public documentation to remove internal development terminology, accurately documenting the **PayPal MCP Gateway** architecture (`worker/src/index.ts` and Supabase Edge Functions), OAuth 2.0 client-credentials authentication (`APP-5SK74342S6474230W`), human-in-the-loop monetary guardrails (`$500.00` single-action / `$2,500.00` daily cap), and live REST execution bridge.
- **46-Tool Official PayPal MCP Live Verification (`scripts/verify-full-paypal-mcp.mjs`):**
  - Successfully verified all 46 official PayPal MCP tools against live PayPal Sandbox APIs (`35` fully executed via REST adapter, `5` verified domain states requiring buyer approval or active dispute, `4` OAuth-scope restricted on default sandbox app, `1` upstream sandbox limitation, `1` unsupported in sandbox mode).
- **Comprehensive Production Smoke Testing (`https://paypal-ai-billing-kit.vercel.app`):**
  - Verified 19/19 Playwright end-to-end browser flows, 20/20 customer notification isolation tests, 20/20 local UI/AI correctness tests, 8/8 repository hygiene checks, and 0 secrets across the codebase.

---

## [`v1.9.2`] — 2026-11-03

### Added, Improved & Fixed (Issues #7–#15, Multi-Statement Proposals, Unified PayPal Settlement, Database Notification Ownership & Repository Hygiene)
- **Issue #7 — Responsive Statement Details Modal & Unified PayPal Settlement Flow (`components/billing/BillingModalShell.tsx`, `components/billing/BillingInvoiceDetailModal.tsx`, `src/billing/api/billingService.ts`):**
  - Expanded desktop modal max-width to `680px` (`width: 94%` on mobile) with responsive spacing, consistent button heights (`46px`), and unclipped upper-scroll content.
  - Unified payment action hierarchy into a single primary footer button (**`Pay with PayPal`** for open statements, **`Retry with PayPal`** for failed statements) without duplicate competing payment buttons.
  - Clicking **`Retry with PayPal`** on a failed statement (`#PPB-INV-2026-1004`) immediately settles the statement to **`PAID`** (`Remaining Balance Due: $0.00`), removes stale *"Last Payment Attempt Declined"* banners, displays the **Verified PayPal Sandbox Settlement** banner, and transitions the primary button to **`View Receipt`**.
- **Issue #8 — Collapsible PayPal Merchant Sandbox Connection Card (`components/billing/PayPalConnectCard.tsx`):**
  - Redesigned the PayPal Merchant Sandbox card to render in a compact summary state (`SANDBOX AUTHENTICATED` + `Show Details`) by default on both Provider and Customer dashboards, expanding on demand (`Hide Details`) to display OAuth 2.0 metadata, Sensitive-Data Firewall verification, and Sandbox controls.
- **Issue #9 — Natural-Language Billing AI Answers & Combined Multi-Statement Payment Proposals (`src/billing/api/billingAIClient.ts`, `src/billing/types/billingTypes.ts`, `components/billing/BillingAIAssistantModal.tsx`, `app/index.tsx`):**
  - Enhanced intent routing and Gemini fallback synthesis for natural-language greetings, invoice explanations, due-date inquiries, failed-payment diagnostics, and refund inquiries.
  - Added **combined multi-statement payment proposal** support (`invoiceIds[]`, `invoiceNumbers[]`) when a customer asks to pay all open statements together (e.g., *"Can I pay both open statements at the same time?"* answers *"Yes — you can settle all 2 open statements together"* and prepares a single `$225.00 USD` proposal covering `#PPB-INV-2026-1001` + `#PPB-INV-2026-1002`).
  - Removed noisy model-attribution footer badges from assistant message bubbles.
- **Issue #10 — Per-Statement, Per-Customer & Per-Role Billing AI Thread Isolation (`components/billing/BillingAIAssistantModal.tsx`, `app/index.tsx`):**
  - Scoped conversation threads strictly by `(sessionId, accountKey, role, invoiceId || 'general')` so switching statements (`#PPB-INV-2026-1002` vs `#PPB-INV-2026-1003`) or demo accounts (`Dr. Sarah Jenkins`, `Alex Rivera`, `Jordan Taylor`) never leaks conversation history across contexts.
- **Issue #11 — Billing AI Composer Caret & Placeholder Alignment (`components/billing/BillingAIAssistantModal.tsx`):**
  - Vertically centered composer input text, placeholder, and insertion caret (`minHeight: 44px`, `paddingVertical: 10px`) without explicit iOS-inflating `lineHeight`.
- **Issue #12 — Subtle Search Input Focus Styling (`components/billing/DoctorBillingView.tsx`, `components/billing/PatientBillingView.tsx`, `components/billing/BillingGlobalSearchModal.tsx`):**
  - Replaced heavy browser default focus outlines with a single subtle brand focus border (`#f59e0b`) and soft halo (`outlineStyle: 'none'`).
- **Issue #13 — Temporary Auto-Dismissing Demo Reset Toast & Notification Restoration (`app/index.tsx`, `src/billing/api/billingService.ts`):**
  - Replaced the persistent Reset Demo banner with a floating toast (`testID="billing-demo-reset-toast"`) that auto-dismisses after `3,200ms` (with manual `×` dismiss) and resets all canonical statements, AI chats, and customer notifications.
- **Issue #14 — Billing AI Header `New Chat` Compose Button (`components/billing/BillingModalShell.tsx`, `components/billing/BillingAIAssistantModal.tsx`):**
  - Moved the **`New Chat`** control (`testID="billing-ai-new-chat-btn"`, compose icon) into the upper-left corner of the Billing AI modal header opposite the close button (`[New Chat]   Billing AI   [X]`).
- **Issue #15 — Strict Customer Notification Isolation & Database Ownership Migration (`supabase/migrations/20261103120000_billing_notification_ownership_and_isolation.sql`, `src/billing/api/billingService.ts`, `src/billing/data/syntheticBillingFixtures.ts`, `components/billing/BillingNotificationsModal.tsx`):**
  - Applied Supabase migration `20261103120720_billing_notification_ownership_and_isolation` on project `dvzfesfvefggnunkjhom` enforcing strict `public.billing_notifications` recipient ownership (`public.billing_seed_canonical_notifications`, `public.billing_reset_demo_session`, `public.billing_notify`), removing cross-customer notification pollution, and preserving all immutable `public.billing_audit_events`.
  - Enforced dual-ownership verification (`recipient_profile_id === customerId` AND linked invoice `patient_id === customerId`) and canonical seed UUID-to-invoice-number resolution (`resolveBillingDeepLinkInvoice`) so `Alex Rivera` and `Jordan Taylor` see and open only their own notifications and statements.
- **Public Repository Cleanup & Updated Public Screenshots (`docs/screenshots/public/`, `scripts/verify-public-repo-hygiene.mjs`):**
  - Separated public documentation screenshots (`docs/screenshots/public/01`–`14`) from local-only presentation videos, voiceover scripts, and recording utilities (`local-demo/`, gitignored) and added `npm run verify:repo-hygiene`.

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
- **Full 82-Tool Unified MCP Gateway (`packages/paypal-billing-kit/src/mcpRegistry.ts`, `worker/src/index.ts`):**
  - Expanded the unified Model Context Protocol (MCP) gateway from `30` tools to **`82` callable tools** across all three live endpoints (`https://paypal-ai-billing-mcp.apd1034.workers.dev/mcp`, `https://dvzfesfvefggnunkjhom.supabase.co/functions/v1/billing-maas-mcp`, and `https://paypal-ai-billing-kit.vercel.app/api/mcp`) and OpenAPI 3.1.0 (`/api/openapi.json`).
  - Integrated all **46 Official PayPal MCP tools** by their exact official names alongside `paypal_discover_official_mcp` (`47` total `official_paypal_mcp` tools).
  - Added **6 new PayPal Sandbox REST-to-MCP Adapter tools** (`update_plan`, `paypal_authorize_order`, `paypal_list_webhooks`, `paypal_list_webhook_event_types`, `paypal_list_invoice_templates`, `paypal_create_vault_setup_token`) to the existing 8 REST adapters (`14` total `paypal_rest_adapter` tools).
  - Preserved all **21 Native Application tools** (`source: "native_application"`).
- **Comprehensive 82-Tool Verification & Evidence Suite (`scripts/verify-full-paypal-mcp.mjs`).**

---

## [`v1.8.0`] — 2026-11-02

### Added & Changed
- **Gemini 3.5 Flash-Lite Compatibility Migration (`gemini-3.5-flash-lite`):**
  - Migrated `supabase/functions/billing-ai-assistant/index.ts` and SDK model defaults from `gemini-2.5-flash` to `gemini-3.5-flash-lite` ahead of Google AI Studio's December 1, 2026 auto-redirect deadline.
  - Replaced numeric `thinking_budget` with `thinkingConfig: { thinkingLevel: "MEDIUM" }`, added `mediaResolution: "MEDIA_RESOLUTION_HIGH"` support, and preserved `thoughtSignature` across multi-turn `functionCall` / `functionResponse` histories.
- **Professional Merchant-Branded PDF 1.4 Receipts (`packages/paypal-billing-kit/src/pdfReceipt.ts`):**
  - Redesigned customer-facing PDF receipts around merchant-first branding (**Jenkins Wellness & Telehealth Practice**, `Provider: Dr. Sarah Jenkins`), state-aware headers, `"Payment processed through PayPal"` attribution, and strict refusal (`RECEIPT_UNAVAILABLE_UNPAID_INVOICE`) on unpaid statements.
- **30-Tool MCP Registry Reconciliation (`packages/paypal-billing-kit/src/mcpRegistry.ts`).**

---

## [`v1.7.0`] — 2026-11-01

### Added
- **Automated Server-Side PayPal Sandbox Direct-Card Checkout (`Orders v2 payment_source.card`):**
  - Added `execute_sandbox_card_payment` and `run_sandbox_card_lifecycle_test` using allowlisted PayPal Sandbox test card profiles (`visa_sandbox`, `mastercard_sandbox`, `amex_sandbox`, `decline_refused`, `decline_expired`, `decline_insufficient_funds`) while rejecting raw card PAN/CVV inputs (`RAW_CARD_CREDENTIALS_FORBIDDEN`).
- **8-State Payment-Attempt Classification & Session-Isolated Financial Audit Trail.**
- **Conversational Authorization (`evaluateConversationalAuthorization`)** alongside HMAC-SHA256 `proposal_id` tokens (`$500.00` single-action / `$2,500.00` daily guardrails).

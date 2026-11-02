# 03 — Existing Project Inventory, Reusability Matrix & UI Defect Root-Cause Plan

## 1. Inventory of Existing Projects (`health-erecords-app` vs `paypal-ai-billing-hackathon`)

### A. `/Users/danny/Desktop/health-erecords-app` (Authoritative Visual & Functional Reference)

| Source File / Directory | Lines | Disposition | Adaptation / Isolation Notes |
| :--- | :---: | :---: | :--- |
| `packages/paypal-agent-kit/src/*` (`client.ts`, `webhooks.ts`, `guardrails.ts`, `phiAllowlist.ts`, `types.ts`, `index.ts`) | ~820 | **REUSE & ADAPT** | Rename package to `@paypal-ai/billing-kit`; generalize `HER-INV-` prefix into configurable `invoicePrefix` (default `INV-` or `PPB-INV-`). Keep PHI/PII outbound allowlist sanitizer as a built-in privacy feature. |
| `app/billing.tsx` | 673 | **ADAPT** | Convert into standalone root screen (`app/index.tsx`). Remove `useAdminViewMode`, `usePlatformView`, `HomeIcon` button, and `/auth` redirect; add top **Provider / Customer Demo Switcher** bar. |
| `components/billing/DoctorBillingView.tsx` | 518 | **ADAPT** | Remove the duplicate full-width `Add Invoice` button (`doctor-add-invoice-inline-btn`, lines 116–128) while keeping the header `+` button, Search bar, KPI cards, filter pills, and invoice list. |
| `components/billing/PatientBillingView.tsx` | 502 | **ADAPT** | Generalize labels (`Customer / Payer Statements`) while retaining identical layout, Hero card, PayPal Connect card, Billing AI entry card, Search, and filter chips. |
| `components/billing/BillingInvoiceCard.tsx` | 383 | **ADAPT & FIX** | Fix Section 7 issues: (1) Force `hasBalanceDue = invoice.status !== 'void' && invoice.status !== 'refunded' && invoice.balanceDueCents > 0`; (2) Clearly display both `Original: $X.XX` and `Remaining Balance: $0.00 (Voided)` on voided/paid statements; (3) Increase small metadata font sizes (`11–12px` -> `13px`) and contrast (`#6B7280` -> `#4B5563`). |
| `components/billing/BillingCreateInvoiceModal.tsx` | 458 | **ADAPT & FIX** | Fix Section 7 issues: (1) Synchronize `DEFAULT_SERVICE_CATALOG` and DB `billing_service_catalog` amounts so `$35.00` (`ADMIN-FORMS` / `ADMIN-COPAY`) never mismatches with `$150.00`; (2) Reset form state cleanly on modal open while allowing explicit custom amount overrides; (3) Replace raw `YYYY-MM-DD` text input with an interactive **Date Picker** (quick preset chips `+7d`, `+14d`, `+30d` + calendar/native date selector); (4) Wrap modal shell in `KeyboardAvoidingView` so inputs stay visible above the keyboard. |
| `components/billing/BillingAISettingsModal.tsx` | 687 | **ADAPT & FIX** | Fix Section 7 issues: (1) Remove duplicate `Immutable Financial & AI Audit Trail` item (`mandatory-audit-logging` in `MANDATORY_LOCKED_CONTROLS` vs `.auditSection` heading); (2) Map raw `ev.eventType` (`organization_ensured`, `invoice_created_and_sent`, etc.) to human-readable labels (`Organization Initialized`, `Invoice Created & Sent`, etc.); (3) Remove `.slice(0, 5)` truncation so the complete audit history is scrollable and viewable. |
| `components/billing/BillingAIAssistantModal.tsx` | 485 | **ADAPT** | Decouple storage key from `@her_billing_ai_history_v1_*` to `@paypal_kit_ai_history_v1_*`; preserve 5-stage payment tracker, proposal cards, and multi-turn `"Yes"` / `"No"` continuity. |
| `components/billing/BillingInvoiceDetailModal.tsx` | 590 | **ADAPT** | Preserve PayPal Sandbox checkout launcher (`expo-web-browser` / Web popup), `Verify & Complete Payment`, `Cancel Checkout`, `Void Unpaid Statement`, and `Issue Refund`. |
| `components/billing/BillingMetricDetailModal.tsx` & `BillingModalShell.tsx` | 510 | **ADAPT** | Add `KeyboardAvoidingView` support inside `BillingModalShell.tsx` for iOS/Android/Web form stability. |
| `components/billing/PayPalConnectCard.tsx` | 340 | **ADAPT** | Preserve OAuth 2.0 `connect-start`, `connect-callback`, and `disconnect` flow. |
| `src/billing/api/billingService.ts` & `billingAIClient.ts` | 1,120 | **ADAPT** | Point to standalone Supabase client and `billing_accounts` / `billing_customer_links` RPCs; unify service catalog prices (`$150`, `$125`, `$45`, `$35`, `$50`, `$75`). |
| `supabase/functions/paypal-billing`, `paypal-webhook`, `billing-ai-assistant` | 1,780 | **ADAPT** | Remove any Health eRecords wording/prefixes; add service-code-aware AI invoice drafting so asking for a `$35` service or specific catalog item selects the matching service code and price instead of defaulting to `$150` `ADMIN-TELEHEALTH`. |
| **All Non-Billing Health eRecords Files** (`app/(tabs)/*`, `ChatActionAgent.js`, `health_logs`, `patient_details`, `revenuecat`, `livekit`, `docling`, `.env*`) | >50,000 | **STRICTLY EXCLUDE** | **0%** of clinical, EHR, telehealth, HealthKit, or RevenueCat code enters `PayPal-AI-Billing-Kit`. |

---

### B. `/Users/danny/Desktop/paypal-ai-billing-hackathon` (Lightweight Node Prototype)

| Source File | Disposition | Notes |
| :--- | :---: | :--- |
| `src/demo-cli.js` & `tests/hackathon.test.js` | **ADAPT** | Carry over the deterministic CLI walkthrough (`npm run demo`) and unit/integration test assertions into `packages/paypal-billing-kit/__tests__/`. |
| `src/server.js` (Custom dark/split HTML page) | **EXCLUDE UI / SUPERSEDE** | Its inline HTML UI does not match the approved Orange Billing Dashboard. It will be superseded by the Expo Universal Orange Billing Dashboard in `PayPal-AI-Billing-Kit`. |

---

## 2. Root-Cause Trace & Fix Plan for All Section 7 UI & Functional Defects

### Defect 7.1 — Settings Modal: Duplicate "Immutable Financial & AI Audit Trail" Heading & Raw Audit Names
- **Code Trace (`components/billing/BillingAISettingsModal.tsx`):**
  1. Line 69–73 defines `MANDATORY_LOCKED_CONTROLS[5]`:
     `label: 'Immutable Financial & AI Audit Trail'`, `description: 'All AI proposals, confirmation tokens, and webhook events are logged in public.billing_audit_events.'`
  2. Lines 450–455 immediately below render a second heading and description:
     `Immutable Billing & AI Audit Trail — Every AI-proposed billing action, human decision, and PayPal Sandbox webhook transition is recorded in public.billing_audit_events.`
  3. Lines 459–461 render `auditEvents.slice(0, 5)` and output raw `ev.eventType` (`organization_ensured`, `ai_settings_updated`, `invoice_created_and_sent`, `payment_captured`).
- **Planned Fix:**
  1. Remove the redundant static text header in `.auditSection` and keep the single locked control row `#6` (`Immutable Financial & AI Audit Trail — LOCKED ON`), followed directly by the live **Audit Event Log** list.
  2. Add a deterministic `formatAuditEventLabel(eventType, details)` mapper that translates every snake_case `event_type` into clear English (e.g., `invoice_created_and_sent` -> `"Invoice Created & Sent"`, `ai_proposal_approved` -> `"AI Proposal Approved"`, `payment_captured` -> `"PayPal Payment Captured"`, `invoice_voided` -> `"Invoice Voided & Archived"`).
  3. Increase the query limit in `fetchBillingDashboardData` from `20` to `100` and remove `.slice(0, 5)` in `BillingAISettingsModal.tsx` so the full audit trail is preserved and viewable.

---

### Defect 7.2 — Invoice Creation: Service Selection vs. Amount Mismatch (`$35` vs `$150`), Date Picker & Keyboard Positioning
- **Code Trace (`components/billing/BillingCreateInvoiceModal.tsx`, `src/billing/api/billingService.ts`, `supabase/functions/billing-ai-assistant/index.ts`):**
  1. **Catalog Mismatch between Frontend and Database:**
     - In `src/billing/api/billingService.ts` (`DEFAULT_SERVICE_CATALOG`), `ADMIN-FORMS` is `$35.00` (`3500`), `ADMIN-COPAY` is `$50.00` (`5000`), and `ADMIN-RECORDS` is `$45.00` (`4500`).
     - In `20261030130000_paypal_billing_and_ai.sql` (`billing_service_catalog`), `ADMIN-COPAY` is `$35.00` (`3500`), `ADMIN-FORMS` is `$40.00` (`4000`), `ADMIN-RECORDS` is `$25.00` (`2500`), and there is no `title` column!
  2. **Modal State & Custom Amount Handling:**
     - `BillingCreateInvoiceModal.tsx` initializes `amountUsd` to `'150.00'` on mount (line 43) and does not sync `amountUsd` when `effectiveCatalog` loads or when the modal re-opens.
  3. **AI Invoice Drafting Hardcoded `$150` / `ADMIN-TELEHEALTH`:**
     - In `billing-ai-assistant/index.ts` lines 548 and 631, if the user asks to draft an invoice by service name (e.g. `"Create a forms completion invoice"` or `"Create a copay invoice"`) without typing `$35`, `amountMatch` falls back to `150` (`$150.00`) and hardcodes `service_code: 'ADMIN-TELEHEALTH'`.
  4. **Due Date Input & Keyboard Overlap:**
     - Line 232 uses a plain `<TextInput placeholder="YYYY-MM-DD" />` with no date picker, and `BillingModalShell.tsx` does not wrap the bottom sheet in `<KeyboardAvoidingView>`.
- **Planned Fix:**
  1. Unify `billing_service_catalog` (adding the `title` column in SQL) so frontend and database share the exact same 7 catalog items and prices.
  2. In `BillingCreateInvoiceModal.tsx`, track `isCustomAmount` (boolean). Selecting any service chip automatically sets `amountUsd = (item.defaultAmountMinor / 100).toFixed(2)` and resets `isCustomAmount = false`; typing in the amount field sets `isCustomAmount = true` with a `"Custom Amount"` badge and a `"Reset to catalog price ($35.00)"` quick link. Also reset form state whenever `visible` transitions to `true`.
  3. In `billing-ai-assistant`, match requested service keywords (`copay`, `forms`, `records`, `office`, `no-show`, `late`, `telehealth`) against `billing_service_catalog` and use that service's `code` and `default_amount_minor` whenever no explicit dollar override is spoken.
  4. Replace the raw `YYYY-MM-DD` `TextInput` with an interactive **Due Date Picker** (quick chips: `In 7 Days`, `In 14 Days`, `In 30 Days`, plus an interactive calendar/date selector modal that works identically on Web and Mobile).
  5. Wrap `BillingModalShell.tsx` in `<KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>` so the modal remains properly positioned when the keyboard appears.

---

### Defect 7.3 — Invoice History: Voided Invoices Showing Non-Zero Balance, Original vs. Remaining Amount & Small Text Readability
- **Code Trace (`supabase/migrations/20261030130000_paypal_billing_and_ai.sql` line 136 & `components/billing/BillingInvoiceCard.tsx` lines 91, 130–137):**
  1. In SQL, `balance_due_minor` is `generated always as (greatest(total_minor - amount_paid_minor, 0)) stored`. When an unpaid `$150.00` invoice is voided (`status = 'void'`), `amount_paid_minor` is `0`, so `balance_due_minor` stays `15000` (`$150.00`)!
  2. In `src/billing/api/billingService.ts` line 383 and `BillingInvoiceCard.tsx` line 91, `balanceDueCents` is read directly as `15000`, causing voided invoices to display `Due: $150.00` instead of `Balance: $0.00 (Voided)`.
  3. In `BillingInvoiceCard.tsx`, metadata text uses `11px–12px` muted gray (`#6B7280` / `#9CA3AF`), and the right-hand column only shows `$150.00` + `Due: $150.00` without clearly distinguishing `Original Amount` vs `Remaining Balance`.
- **Planned Fix:**
  1. Fix the SQL generated column (`CASE WHEN status IN ('void', 'refunded') THEN 0 ELSE greatest(total_minor - amount_paid_minor, 0) END`) AND enforce in `billingService.ts` mapper that `status === 'void' || status === 'refunded'` always maps `balanceDueCents = 0`.
  2. In `BillingInvoiceCard.tsx` and `BillingInvoiceDetailModal.tsx`, explicitly display:
     - `Total: $150.00` (or `Original: $150.00` when voided/refunded/partially paid)
     - `Balance Due: $0.00 (Voided)` / `Balance Due: $0.00 (Paid)` / `Balance Due: $150.00`
  3. Increase secondary typography in `BillingInvoiceCard.tsx` (`dateText` `13px -> 14px`, `counterpartyText` `13px -> 14px`, `metaText` `12px -> 13px`, `amountSubtext` `12px -> 13px` with higher-contrast `#374151` / `#4B5563` colors).

# 04 — Security Audit, PayPal & Billing AI Architecture, Cost Analysis & Owner Decisions

## 1. Source Code Security & Isolation Audit (Section 9)

Before recommending any code extraction from `health-erecords-app`, we audited the billing modules (`app/billing.tsx`, `components/billing/*`, `src/billing/*`, `packages/paypal-agent-kit/*`, `supabase/functions/paypal-*`, `supabase/functions/billing-ai-assistant`) for sensitive or proprietary references:

| Audit Category | Findings in `health-erecords-app` Billing Modules | Mitigation for `PayPal-AI-Billing-Kit` |
| :--- | :--- | :--- |
| **Embedded Secrets / API Keys** | **0 hardcoded secrets** in billing UI or `paypal-agent-kit`. Secrets are read via `process.env` / `Deno.env.get(...)`. | Keep `.env` gitignored; provide only `.env.example` with placeholder documentation. |
| **Supabase Project Identifiers** | Scripts in `scripts/billing/*` reference staging `uqzemlcdmyomyiebdsmd`. | Exclude `scripts/billing/staging-*`; bind `PayPal-AI-Billing-Kit` exclusively to its own new Supabase project via `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`. |
| **Clinical / Patient Identifiers** | Zero real PHI in billing modules. Synthetic fixtures (`syntheticBillingFixtures.ts`) reference test names (`Daniel Lozano (Environment Owner)`, `Jordan Taylor`). | Replace synthetic fixtures in `PayPal-AI-Billing-Kit` with clean generic demo personas (`Dr. Sarah Jenkins` [Merchant], `Alex Rivera` [Customer #1], `Jordan Taylor` [Customer #2]). |
| **Health eRecords Coupling** | `app/billing.tsx` imports `useAuth`, `useAdminViewMode`, `usePlatformView` (`@/contexts/AuthContext`, `@/hooks/useAdminViewMode`, `@/src/platform`). SQL migration references `public.profiles` and `public.patient_authorizations`. | Replace with a lightweight standalone `BillingAuthContext` (supporting Provider/Customer Demo Switcher + Supabase Auth) and standalone `billing_accounts` / `billing_customer_links` tables. |
| **Hardcoded Prefixes & Storage Keys** | Uses `HER-INV-` invoice prefix and `@her_billing_ai_history_v1_` AsyncStorage key. | Replace with configurable prefix (`PPB-INV-` default) and `@paypal_kit_ai_history_v1_`. |

---

## 2. PayPal Account Connection & Payment Architecture (Section 5)

The standalone kit preserves and packages the complete PayPal Sandbox lifecycle inside `@paypal-ai/billing-kit` + `supabase/functions/paypal-billing` and `paypal-webhook`:

1. **OAuth 2.0 Account Connection (`connect-start`, `connect-callback`, `disconnect`):**
   - Generates a cryptographic CSRF `state` token stored with a 10-minute TTL (`state:issuedAtMs`) in `billing_connection_secrets` (`service_role` only).
   - Validates `OAUTH_STATE_MISMATCH`, `OAUTH_STATE_EXPIRED`, and `OAUTH_AUTHORIZATION_FAILED`.
   - Distinguishes **Merchant Onboarding** (receiving payouts) from **Customer Identity Verification** (explicitly enforcing that linking a customer PayPal account never grants auto-charge authority).
   - Revokes cleanly on disconnect (`status = 'revoked'`, populates `revoked_at`, purges secrets).
2. **Orders v2 & Idempotent Capture (`create-order`, `cancel-order`, `capture-order`):**
   - Sanitizes outbound payloads through `assertPhiFreePayload` / `sanitizeAdministrativeDescription`.
   - Supersedes prior unfinished payment attempts (`SUPERSEDED_BY_NEW_ORDER`) on retry.
   - Records buyer-cancelled checkouts (`USER_CANCELLED`) while keeping the invoice `sent` and retryable.
   - Verifies capture via `POST /v2/checkout/orders/{id}/capture` (with `GET /v2/checkout/orders/{id}` recovery if `ORDER_ALREADY_CAPTURED`) before calling `billing_apply_capture_result`.
3. **Webhooks v1 & Refunds v2 (`paypal-webhook`, `refund-capture`):**
   - Verifies PayPal transmission signatures via `/v1/notifications/verify-webhook-signature`.
   - Enforces monotonic state transitions (`CHECKOUT.ORDER.APPROVED` never regresses `completed` attempts or `paid` invoices) and rejects cross-org/cross-invoice order mismatches.
   - Executes full/partial capture refunds via `/v2/payments/captures/{id}/refund` and reconciles `PAYMENT.CAPTURE.REFUNDED`.

---

## 3. Billing AI Architecture (Section 6)

Core Principle: **`AI Proposes → Human Approves → PayPal Confirms`**

1. **AI Provider & Execution Model:**
   - Server-side execution in `supabase/functions/billing-ai-assistant` using **Google Gemini 2.5 Flash** (`GEMINI_API_KEY` secret on the Edge Function) combined with deterministic server-side intent/proposal state machines so tool proposals work reliably even under API rate limits.
2. **Capabilities Retained & Enhanced:**
   - **Natural-Language Invoice Drafting:** Matches requested service codes (`$35` Forms Completion, `$50` Copay, `$150` Telehealth, or custom amounts) and verifies authorized customers in `billing_customer_links` (never substituting another customer if a name is unknown).
   - **Conversational Mistake Recovery:** Detects wrong-recipient reports (`"I asked for Alex Rivera and you billed Jordan Taylor"`), checks **Payment-State Protection** (`status !== 'paid'` and `amount_paid_minor == 0`), and prepares a `void_invoice` proposal card.
   - **Paid-Invoice Void Protection:** Refuses to void any paid invoice and directs the provider to the PayPal Refund workflow.
   - **Multi-Turn Customer Payment Continuity:** Customer asks to pay an invoice -> AI prepares `payment_checkout` proposal -> Customer replies `"Yes"` -> proposal transitions to Stage 3 (`Awaiting PayPal Sandbox Authorization`) **without** marking the invoice paid until PayPal capture/webhook verification succeeds.
   - **Duplicate Approval & Expiry Locks:** Blocks repeated `"Yes"` messages (`Duplicate Approval Prevented`) and expired proposals (`Approval Token Expired`).

---

## 4. Deployment & Estimated Operating Costs (Section 10 & 16)

| Component | Recommended Service / Tier | Monthly Cost (Hackathon & Open-Source Demo) | Production / Commercial Scaling Cost |
| :--- | :--- | :---: | :---: |
| **Database, Auth, Realtime & Edge Functions** | **New Dedicated Supabase Project** (Free Tier) | **`$0.00 / mo`** | `$25.00 / mo` (Supabase Pro when scaling commercially) |
| **PayPal Payment Processing** | **PayPal Developer Sandbox** (`api-m.sandbox.paypal.com`) | **`$0.00 / mo`** | Standard PayPal merchant transaction fees in Live mode |
| **Billing AI Model** | **Google Gemini 2.5 Flash API** | **`$0.00 / mo`** (Free tier covers up to 1,500 req/day) | `~$0.15 / 1M input tokens` (Pay-as-you-go) |
| **Web Hosting (For Judge Browser Access)** | **Vercel / Netlify Static Expo Web Export** (or local `npm run web`) | **`$0.00 / mo`** | `$0–$20 / mo` |
| **Mobile Testing** | **Expo Go** (iOS Simulator / Physical Device) | **`$0.00 / mo`** | `$0.00 / mo` |
| **Total Estimated Operating Cost** | | **`$0.00 / month`** | **`$25–$45 / month`** |

---

## 5. Recommended Implementation Sequence (After Your Approval)

Once you approve this architecture plan, we will execute implementation inside `PayPal-AI-Billing-Kit` in one continuous, phase-free build:
1. **Package Extraction (`packages/paypal-billing-kit`):** Extract and generalize the PayPal Orders v2, Webhooks v1, Guardrails, and Outbound Sanitizer SDK with unit tests.
2. **Standalone Database & Edge Functions (`supabase/`):** Author `0001_paypal_ai_billing_kit.sql` (with `billing_accounts`, `billing_customer_links`, unified `billing_service_catalog` with `title`, and voided-invoice `balance_due_minor = 0` fix) + standalone `paypal-billing`, `paypal-webhook`, and `billing-ai-assistant` functions.
3. **Standalone Orange Billing Dashboard (`app/` & `components/billing/`):** Build the Expo Universal (Web + Mobile) app opening directly into the Orange Billing Dashboard with the **Provider / Customer Demo Switcher**, header Search/Settings/`+` navigation (no Home button, no duplicate `Add Invoice` bar), and all Section 7 UI fixes (Settings audit trail deduplication + readable event names, Create Invoice `$35` service sync + Date Picker + `KeyboardAvoidingView`, and Invoice Card voided `$0.00` balance + typography upgrades).
4. **End-to-End Verification (Web Browser + Expo Go Simulator + Automated Tests):** Verify Provider and Customer workflows, AI mistake recovery, PayPal Sandbox checkout, webhook reconciliation, and clean-clone test execution.

---

## 6. Owner Decisions Required Before Implementation (Section 19)

Please review and confirm the following decisions so we can proceed to implementation:
1. **New Supabase Project Creation:** Do you approve creating a **new, dedicated Supabase project** (`paypal-ai-billing-kit`) under your Supabase organization (or providing a new project ref) so the standalone kit has 100% physical database and auth isolation from Health eRecords?
2. **Frontend Stack Confirmation:** Do you approve the **Expo Universal (React Native Web + Expo Go Mobile)** architecture so `PayPal-AI-Billing-Kit` preserves 100% pixel-identical parity with the approved Orange Billing Dashboard while running in both desktop web browsers (`http://localhost:4040` / hosted URL for judges) and Expo Go?
3. **Demo Persona Naming:** Do you approve replacing `Daniel Lozano (Environment Owner)` in the standalone kit's synthetic demo data with generic personas (`Dr. Sarah Jenkins` as Provider/Merchant, and `Alex Rivera` & `Jordan Taylor` as Customers/Payers)?

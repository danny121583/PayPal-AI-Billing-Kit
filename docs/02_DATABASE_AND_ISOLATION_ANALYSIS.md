# 02 — Database Architecture Evaluation, Isolation Guarantee & Proposed Data Model

## 1. Comparison of the 4 Database Options

We evaluated the 4 candidate database architectures across all 13 required criteria:

| Criterion | Option 1: Reuse Health eRecords Staging DB (`uqzemlcdmyomyiebdsmd`) | Option 2: Separate Schema (`billing_standalone`) in Existing Supabase Project | Option 3: **Entirely New, Independently Isolated Supabase Project** *(RECOMMENDED)* | Option 4: Non-Supabase Custom DB (e.g., Railway Postgres / SQLite) |
| :--- | :--- | :--- | :--- | :--- |
| **1. Security** | ❌ **High Risk** — Shares `auth.users`, `public.profiles`, `public.health_logs`, and project `ANON_KEY` with Health eRecords staging. | ⚠️ **Medium Risk** — Still shares `auth.users`, Edge Function secrets, and project URL/API keys with Health eRecords. | ✅ **Maximum Security** — Completely separate project ref, separate `auth.users`, separate JWT secret, zero shared tables or keys. | ✅ High security, but requires custom auth & RPC middleware. |
| **2. Data Isolation** | ❌ **Violates Isolation** — Contains Health eRecords staging accounts and clinical tables. | ⚠️ Logical separation only; `service_role` in any Edge Function still has project-wide DB access. | ✅ **Hard Physical & Project Isolation** — Impossible to query Health eRecords patients, logs, or doctors. | ✅ Hard physical isolation. |
| **3. Development Complexity** | Low initially, but dangerous to sanitize for public open-source release. | Medium (requires rewriting PostgREST schema exposure and all table prefixes). | **Low** — Reuses our proven PostgreSQL RPCs, triggers, Realtime subscriptions, and Deno Edge Functions with 4 healthcare foreign keys replaced by standalone equivalents. | High (requires rewriting all Supabase RPCs, Realtime listeners, and Deno Edge Functions into custom Express routes). |
| **4. Cost** | `$0` | `$0` | **`$0/month` (Supabase Free Tier)** — Supports up to 500 MB DB, 50,000 MAUs, 500K Edge Function invocations. | `$5–$20/month` on most managed Postgres hosts. |
| **5. Deployment** | Tied to Health eRecords CI/CD. | Tied to Health eRecords Supabase project. | **1-Command Independent Deploy** (`npx supabase db push` + `npx supabase functions deploy`). | Requires custom Docker/PaaS pipeline. |
| **6. Authentication** | Coupled to Health eRecords `profiles` (`user_type` = `doctor`/`patient`/`admin`). | Shares `auth.users` with Health eRecords. | **Clean Standalone Auth** (`billing_accounts` with `role` = `provider` / `customer`). | Custom JWT/session implementation needed. |
| **7. Access Permissions (RLS)** | Coupled to `public.patient_authorizations`. | Requires cross-schema grants. | **100% Standalone RLS** (`billing_customer_links` replaces `patient_authorizations`). | Requires application-layer permission checks or custom Postgres session vars. |
| **8. Portability** | Poor (cannot distribute Health eRecords migrations). | Medium. | **High** — Single self-contained `supabase/migrations/0001_init.sql` file that any developer can run on their own Supabase project. | Medium. |
| **9. PayPal Integration** | Shares webhook endpoint with Health eRecords staging. | Shares Edge Function domain. | **Dedicated Webhook & OAuth Endpoints** (`https://<new-project-ref>.supabase.co/functions/v1/paypal-webhook`). | Requires public HTTPS tunnel or custom cloud host for webhooks. |
| **10. Demonstration Reliability** | Vulnerable to staging test resets in Health eRecords. | Vulnerable to project-level rate limits/maintenance. | **100% Dedicated to Hackathon & Demo** + deterministic local fixture fallback if offline. | Depends on custom server uptime. |
| **11. Future Commercial Use** | Impossible (tied to healthcare app). | Impossible. | **Turnkey SaaS / Starter Kit Template** for commercial or open-source adopters. | Possible, but less turnkey for Supabase/Next/Expo developers. |
| **12. Scalability** | Shared quota. | Shared quota. | Dedicated connection pool, Realtime channels, and Edge Function workers. | Depends on host. |
| **13. Ease of Open-Source Distribution** | ❌ Cannot publish `uqzemlcdmyomyiebdsmd` migrations without exposing Health eRecords schema. | ❌ Confusing for external users. | ✅ **Gold Standard** — Developers clone the repo, run `supabase start` or link a free Supabase project, and run 1 migration. | Medium. |

---

## 2. Recommended Database Solution & Justification

**Recommendation: Option 3 — Create an Entirely New, Independently Isolated Supabase Project (`paypal-ai-billing-kit`), Paired with Built-In Synthetic Demo Fallback.**

### Why Option 3 is the Safest and Most Practical Architecture
1. **Zero Risk to Health eRecords (`aionuzxksjzodxctdqkd` and `uqzemlcdmyomyiebdsmd`):** The new project has its own project ref, its own `SUPABASE_URL` and `SUPABASE_ANON_KEY`, and zero network, credential, or database links to Health eRecords.
2. **Preserves 95% of Our Battle-Tested SQL & Edge Function Architecture:** All 35 RLS invariants, idempotent capture/refund RPCs, out-of-order webhook guards, and AI guardrail checks carry over directly once we replace the 2 Health eRecords table references (`public.profiles` and `public.patient_authorizations`) with standalone equivalents (`public.billing_accounts` and `public.billing_customer_links`).
3. **Resilient Judge Experience:**
   - **Live Cloud Mode (Default):** Connects to the dedicated `paypal-ai-billing-kit` Supabase project with real RLS, Realtime notifications, Gemini AI, and PayPal Sandbox Edge Functions.
   - **Zero-Config Local Mode (Fallback):** If a developer clones the repo from GitHub without setting up Supabase first, the dashboard still boots immediately with deterministic synthetic state so `npm test` and UI exploration work out of the box.

---

## 3. Decoupling Health eRecords Dependencies (Proposed Standalone Data Model)

In `health-erecords-app`, `20261030130000_paypal_billing_and_ai.sql` had **only 3 coupling points** to the rest of Health eRecords:
1. Foreign keys referencing `public.profiles(id)` and checking `profiles.user_type in ('doctor', 'admin')`.
2. Foreign keys/queries referencing `public.patient_authorizations(doctor_id, patient_id, revoked_at)` to determine which customers a provider can bill.
3. Triggers inserting into `public.notifications(user_id, title, body, type, read, metadata, event_key)`.

### Standalone Replacement Tables (100% Zero-PHI, Domain-Agnostic)

```sql
-- 1. Standalone Billing Accounts (replaces public.profiles dependency)
create table public.billing_accounts (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null,
  account_role text not null default 'customer'
    check (account_role in ('provider', 'customer', 'admin')),
  organization_title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. Standalone Provider-to-Customer Authorization Links (replaces public.patient_authorizations)
create table public.billing_customer_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.billing_organizations(id) on delete cascade,
  provider_user_id uuid not null references public.billing_accounts(id) on delete cascade,
  customer_user_id uuid not null references public.billing_accounts(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'revoked')),
  linked_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (provider_user_id, customer_user_id)
);

-- 3. Standalone Billing Notifications (self-contained in migration)
create table public.billing_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.billing_accounts(id) on delete cascade,
  title text not null,
  body text not null,
  type text not null default 'alert',
  read boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  event_key text unique,
  created_at timestamptz not null default now()
);
```

### Complete 18-Table Standalone Schema Inventory
1. `public.billing_accounts` — Provider & Customer profiles (`provider`, `customer`).
2. `public.billing_organizations` — Provider merchant organizations.
3. `public.billing_org_members` — Organization membership (`owner`, `billing_admin`, `staff`).
4. `public.billing_customer_links` — Authorized customer roster for each provider organization.
5. `public.billing_merchant_configs` — PayPal Sandbox merchant configuration per organization.
6. `public.billing_account_connections` — OAuth 2.0 connection status (`merchant` & `payer`, with `revoked_at`).
7. `public.billing_connection_secrets` — `service_role`-only CSRF `oauth_state` (`state:issuedAtMs`) & token store.
8. `public.billing_service_catalog` — Unified service catalog (`code`, `title`, `description`, `default_amount_minor`, `currency`, `active`) — **fixes the missing `title` column and `$35`/`$40` catalog mismatch**.
9. `public.billing_invoices` — Invoices with **corrected `balance_due_minor` generated column**:
   ```sql
   balance_due_minor bigint generated always as (
     case
       when status in ('void', 'refunded') then 0
       else greatest(total_minor - amount_paid_minor, 0)
     end
   ) stored
   ```
   *(This guarantees voided invoices always have `balance_due_minor = 0` at the database level!)*
10. `public.billing_invoice_items` — Line items per invoice.
11. `public.billing_payment_attempts` — PayPal order creation, cancellation, and failure tracking.
12. `public.billing_transactions` — Verified PayPal captures (`capture_api`, `order_lookup`, `webhook`).
13. `public.billing_refunds` — Full and partial PayPal capture refunds.
14. `public.billing_webhook_events` — `service_role`-only webhook deduplication & signature verification log.
15. `public.billing_audit_events` — Append-only immutable audit trail (`BEFORE UPDATE OR DELETE` trigger blocks modification).
16. `public.billing_ai_settings` — Per-user AI limits (`<= $500` single, `<= $2,500` daily) and locked safeguards.
17. `public.billing_ai_sessions` & `public.billing_ai_messages` — Multi-turn conversational history.
18. `public.billing_ai_proposals` — Human-in-the-loop action proposals (`create_invoice`, `void_invoice`, `payment_checkout`, `refund_payment`).
19. `public.billing_notifications` — Deduplicated real-time notifications (`invoice_sent`, `payment_confirmed`, `payment_failed`, `refund_completed`).

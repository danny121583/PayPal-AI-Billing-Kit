# PayPal AI Billing Kit — AI-Powered Invoicing, PayPal Sandbox Payments & MCP Agent Integration (`@paypal-ai/billing-kit`)

**Workspace:** `/Users/danny/Desktop/PayPal-AI-Billing-Kit`  
**Target Competition:** PayPal AI Hackathon 2026 & Reusable Developer Product  
**Public Live Demo (Vercel Hobby):** [`https://paypal-ai-billing-kit.vercel.app`](https://paypal-ai-billing-kit.vercel.app)  
**Dedicated Cloudflare Worker MCP Endpoint:** `https://paypal-ai-billing-mcp.apd1034.workers.dev/mcp`  
**Public Web App MCP Endpoint (JSON-RPC 2.0 & REST):** `https://paypal-ai-billing-kit.vercel.app/api/mcp`  
**Public OpenAPI 3.1.0 Spec:** `https://paypal-ai-billing-mcp.apd1034.workers.dev/api/openapi.json`  
**Dedicated Supabase Project:** `paypal-ai-billing-kit` (`dvzfesfvefggnunkjhom` • `https://dvzfesfvefggnunkjhom.supabase.co`)  
**Platforms:** Public Web (`https://paypal-ai-billing-kit.vercel.app`), Local Web (`npx expo start --web`), & Mobile (`Expo Go` on iOS / Android)

---

## 1. Overview & Architecture

**PayPal AI Billing Kit** is a standalone, zero-PHI, full-stack conversational billing and PayPal Sandbox invoicing platform built with **Expo Universal (React Native Web + iOS/Android)**, **Supabase PostgreSQL + Edge Functions**, and the reusable **`packages/paypal-billing-kit` TypeScript SDK**.

### Core Safety & Financial Invariants (`AI Proposes -> Human Approves -> PayPal Confirms`)
1. **Strict Administrative Scope (`block_clinical_data = true`):** All PayPal Orders v2 payloads, webhook processors, and Billing AI prompts enforce an administrative allowlist (`ADMIN-*` service codes only) and reject any clinical or sensitive fields.
2. **Mandatory Human-in-the-Loop Approval (`require_human_approval = true`):** Billing AI never creates invoices, voids statements, or initiates PayPal checkouts without explicit human approval (`Approve` button or conversational confirmation).
3. **Monetary Velocity Guardrails:** Enforced both in the SDK and server-side via PostgreSQL `CHECK` constraints (`max_single_action_minor <= 50000` [`$500.00`], `daily_limit_minor <= 250000` [`$2,500.00`]).
4. **Cryptographic Settlement Verification (`paypal_confirmation_required = true`):** Only the server-side `service_role` RPCs (`billing_apply_verified_capture`, `billing_apply_refund_result`) can mark an invoice `paid` or `refunded` after PayPal Orders v2 / Webhook signature verification. Sample demonstration records are explicitly badged as `Sample Demo Record — Not a Live PayPal Capture`.

---

## 2. Quick Start

```bash
cd /Users/danny/Desktop/PayPal-AI-Billing-Kit
npm install

# Run Desktop Web & Mobile (Expo Go) server on port 8081
npx expo start --web --port 8081
```

### Verification Suite
```bash
# TypeScript compiler check
npm run typecheck

# Jest unit & component test suite
npm test -- --watchAll=false

# Live 28-check Supabase RLS, zero-anon, & AI guardrail verification
npm run verify:security

# Live 9-step Provider <-> Customer E2E workflow verification
npm run verify:workflow

# Live 26-check MCP JSON-RPC 2.0 & REST verification
npm run verify:mcp

# Source secret & project-isolation scan
npm run scan:secrets
```

---

## 3. Synthetic Demonstration Accounts

All demonstration accounts are fictional and seeded in the dedicated `dvzfesfvefggnunkjhom` Supabase project. You can switch between them with **one tap** using the top **Demo Account Switcher** bar in the header.

| Persona | Role | Email | Shared Demo Password | Organization / Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Dr. Sarah Jenkins** | Provider (`doctor`) | `sarah.jenkins@demo.paypal-billing-kit.local` | `DemoPayPalKit2026!` | `Jenkins Wellness & Telehealth Practice` (Primary Provider Demo) |
| **Alex Rivera** | Customer (`patient`) | `alex.rivera@demo.paypal-billing-kit.local` | `DemoPayPalKit2026!` | Authorized Customer #1 (Pending `$150`, Paid `$125`, Declined `$50`, Refunded `$45`) |
| **Jordan Taylor** | Customer (`patient`) | `jordan.taylor@demo.paypal-billing-kit.local` | `DemoPayPalKit2026!` | Authorized Customer #2 (Overdue `$75`, Voided `$35`) |
| **Dr. Marcus Vance** | Provider B (`doctor`) | `marcus.vance@demo.paypal-billing-kit.local` | `DemoPayPalKit2026!` | `Vance Independent Clinic` (Used for cross-organization RLS isolation verification) |

---

## 4. Environment Variable Requirements

Copy `.env.example` to `.env` for local development:

| Variable | Scope | Required | Description |
| :--- | :--- | :--- | :--- |
| `EXPO_PUBLIC_SUPABASE_URL` | Client & CLI | **Yes** | Dedicated Supabase URL (`https://dvzfesfvefggnunkjhom.supabase.co`) |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Client & CLI | **Yes** | Public Supabase `anon` JWT for client authentication |
| `DEMO_ACCOUNT_PASSWORD` | Test Scripts | Optional | Defaults to `DemoPayPalKit2026!` |
| `PAYPAL_SANDBOX_CLIENT_ID` | Supabase Edge Secret | For Live Sandbox Orders | PayPal Developer Sandbox REST App Client ID |
| `PAYPAL_SANDBOX_CLIENT_SECRET` | Supabase Edge Secret | For Live Sandbox Orders | PayPal Developer Sandbox REST App Secret (Server-Only) |
| `PAYPAL_SANDBOX_WEBHOOK_ID` | Supabase Edge Secret | For Webhook Verification | PayPal Sandbox Webhook ID (`verify-webhook-signature`) |
| `GEMINI_API_KEY` | Supabase Edge Secret | Optional | Optional Gemini key for open-ended Billing AI Q&A (deterministic RLS responder is always active) |

---

## 5. Dedicated Supabase Schema (`supabase/migrations/20261101000000_paypal_ai_billing_kit.sql`)

The standalone database defines **19 `billing_*` tables** with `FORCE ROW LEVEL SECURITY` and zero `anon` table grants:
1. `billing_accounts` — Fictional Provider & Customer directory profiles
2. `billing_organizations` — Provider practice/merchant entities
3. `billing_org_members` — Organization membership & role (`owner`, `billing_admin`, `staff`)
4. `billing_customer_links` — Authorized Provider ↔ Customer billing relationships
5. `billing_merchant_configs` — Merchant PayPal Sandbox configuration metadata
6. `billing_account_connections` — Per-user PayPal Sandbox connection status
7. `billing_connection_secrets` — Server-only OAuth token cache (`service_role` only)
8. `billing_service_catalog` — Allowlisted administrative billing codes (`ADMIN-*`)
9. `billing_invoices` — Statements with generated `balance_due_minor` (`0` when `void` or `refunded`)
10. `billing_invoice_items` — Line items linked to `billing_invoices`
11. `billing_payment_attempts` — PayPal Orders v2 checkout lifecycle tracking
12. `billing_transactions` — Verified PayPal capture records
13. `billing_refunds` — Verified PayPal refund records
14. `billing_webhook_events` — Idempotent webhook event log (`service_role` only)
15. `billing_audit_events` — Immutable audit log (`insert` via `security definer` only; updates/deletes blocked by trigger)
16. `billing_ai_settings` — Per-user AI guardrails with locked `CHECK` constraints
17. `billing_ai_sessions` — Conversational Billing AI sessions
18. `billing_ai_proposals` — Auditable AI action proposals (`pending` -> `approved` -> `executed` / `rejected` / `blocked`)
19. `billing_notifications` — Real-time in-app billing alerts with deduplicated `event_key`

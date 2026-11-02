# PayPal AI Hackathon 2026 — Official Devpost Submission Package, Origin Disclosure & 2:45 Video Script

## 1. Accurate Project Description & Positioning
**Project Title:** PayPal AI Billing Kit — Safe Conversational Invoicing, PayPal Sandbox Checkout & MCP Agent Interface  
**Tagline:** *AI Proposes → Human Approves → PayPal Confirms: Multi-persona billing & 15-tool MCP Agent Interface with $500/$2,500 financial guardrails.*  
**Project Maturity Classification:** Verified Hackathon Demonstration & Open-Source Developer Kit (MIT License)

---

## 2. Transparent Origin & Pre-Existing Work Disclosure (Devpost Rules Compliance)

In accordance with the PayPal AI Hackathon Official Rules regarding projects that build upon or adapt earlier concepts:

### What Was Adapted from Pre-Existing Work
- Foundational administrative billing UI card layouts and React Native component styling originated in the creator's *Health eRecords 2.0* project and were extracted, stripped of all clinical/health dependencies, and refactored into a standalone administrative billing UI.

### What Was Newly Built During the PayPal AI Hackathon Period
1. **Standalone Multi-Persona Expo Web & Mobile Application (`app/index.tsx`):**
   - Instant, zero-flicker preloaded persona switching across **Provider (`Dr. Sarah Jenkins`)**, **Customer #1 (`Alex Rivera`)**, and **Customer #2 (`Jordan Taylor`)** with per-visitor `demo_session_id` isolation and one-tap **Reset Demo**.
2. **Dedicated 20-Table Supabase PostgreSQL Database (`dvzfesfvefggnunkjhom`):**
   - `FORCE ROW LEVEL SECURITY` on all tables, zero `anon` table grants, copy-on-write visitor overrides (`billing_demo_session_overrides`), immutable `billing_audit_events`, and `service_role`-only `billing_platform_secrets`.
3. **Four Standalone Supabase Edge Functions:**
   - `paypal-billing`: PayPal Sandbox OAuth token exchange (`/v1/oauth2/token`), Merchant/Buyer account connection, Orders v2 creation (`/v2/checkout/orders`), verified capture (`/v2/checkout/orders/{id}/capture`), and Captures v2 full/partial refunds (`/v2/payments/captures/{id}/refund`).
   - `paypal-webhook`: Cryptographic PayPal webhook signature verification (`/v1/notifications/verify-webhook-signature`) and idempotent `billing_webhook_events` ledger processing.
   - `billing-ai-assistant`: Live **Google Gemini 2.5 Flash** (`gemini-2.5-flash`, `thinkingBudget: 0`, `maxOutputTokens: 350`, `temperature: 0.1`) conversational billing assistant combined with deterministic PostgreSQL financial guardrails (`$500.00` single-action / `$2,500.00` daily limit), conversational mistake recovery, and sensitive-data refusal boundaries.
   - `billing-maas-mcp`: Backend MCP execution engine enforcing database-backed `proposal_id` validation, cross-session isolation (`CROSS_SESSION_PROPOSAL_ACCESS_DENIED`), duplicate-approval blocking (`DUPLICATE_APPROVAL_BLOCKED`), and Payment-State Protection.
4. **Dedicated Cloudflare Worker MCP Agent Interface (`https://paypal-ai-billing-mcp.apd1034.workers.dev/mcp`):**
   - Standalone edge gateway implementing MCP JSON-RPC 2.0 (`2025-06-18` and `2025-03-26`), REST tool endpoints, OpenAPI 3.1.0 discovery, and HMAC-SHA256 session-bound proposal tokens across 15 tools (`9` read-only, `3` proposal-only, `3` human-confirmed demo writes).
5. **Reusable `@paypal-ai/billing-kit` TypeScript SDK (`packages/paypal-billing-kit`):**
   - Framework-agnostic guardrails (`evaluateProposalGuardrails`), sensitive-payload allowlist validator (`assertCleanOutboundPayload`), and PayPal Orders v2 helpers.

---

## 3. 2:45 Demonstration Video Recording Script & Scene-by-Scene Workflow

**Target Runtime:** 2 minutes 45 seconds (under the 3:00 Devpost maximum)  
**Resolution:** 1920×1080 (16:9 Desktop Browser + Side-by-Side Mobile / MCP Terminal)

| Timecode | Scene | Visual Action on Screen | Voiceover Script |
| :--- | :--- | :--- | :--- |
| **0:00 – 0:20** | **1. The Problem & Core Safety Model** | Open `https://paypal-ai-billing-kit.vercel.app` on **Provider: Dr. Sarah Jenkins**. Highlight the PayPal Merchant Sandbox card (`SANDBOX READY`), KPI summary cards, and the `AI Proposes → Human Approves → PayPal Confirms` banner. | *"AI agents are great at explaining bills, but giving an LLM direct write access to charge customers or void settled payments is a financial liability. We built the PayPal AI Billing Kit around one unbreakable rule: AI Proposes, Human Approves, and PayPal Confirms."* |
| **0:20 – 0:55** | **2. Conversational AI Invoice Drafting & Mistake Correction** | Click **Ask AI** on Dr. Sarah Jenkins' dashboard. Type: *"Can you bill Alex Rivera $35 for completing his paperwork?"* Show the pending `$35.00` (`ADMIN-FORMS`) proposal card. Then type: *"Actually keep it for Alex Rivera at $35"* or click **Approve** on the `$35.00` proposal card. Show the newly created statement `#PPB-INV-2026-1045` (`$35.00`) appear in the statement list. | *"As a provider, Dr. Sarah Jenkins asks our Gemini 2.5 Flash Billing Assistant to bill Alex Rivera $35 for form completion. Notice the AI cannot issue the invoice autonomously—it enforces our $500 single-action and $2,500 daily guardrails and creates a pending database proposal. Only when Dr. Jenkins clicks Approve is Statement #1045 issued."* |
| **0:55 – 1:15** | **3. Guardrail & Payment-State Protection** | In Billing AI, ask: *"Draft a $750 invoice for Alex Rivera"* (show `$500.00` guardrail block). Then ask: *"Void paid invoice #PPB-INV-2026-1003"* (show Payment-State Protection refusal explaining paid statements require a refund, not a void). | *"If an agent tries to draft a $750 invoice, our PostgreSQL guardrail blocks it immediately. And if someone tries to void an already-paid statement like #1003, Payment-State Protection blocks the void and directs the provider to a formal PayPal refund workflow."* |
| **1:15 – 2:05** | **4. Instant Persona Switch & Real PayPal Sandbox Checkout** | Click **Customer: Alex Rivera** in the top switcher bar (instant zero-flicker switch). Open Statement `#PPB-INV-2026-1045` (`$35.00`) or ask Billing AI to prepare payment. Click **Pay $35.00 with PayPal Sandbox**, complete buyer approval in PayPal Sandbox, and show the captured receipt (`COMPLETED`, `$0.00` balance due, PayPal Order ID & Capture ID, notification badge, and audit log). | *"With one click, we switch to Customer Alex Rivera with zero loading flicker. Alex asks Billing AI to explain the new $35 statement and initiates PayPal Sandbox checkout. Our Supabase Edge Function creates a real PayPal Orders v2 order, Alex approves it in PayPal Sandbox, and our backend verifies the capture—updating the balance to $0.00 and recording an immutable receipt."* |
| **2:05 – 2:25** | **5. Provider Refund & Webhook Verification** | Switch back to **Provider: Dr. Sarah Jenkins**, inspect the settled transaction, and trigger a PayPal Captures v2 refund (or show the verified refund record & webhook ledger). | *"Back on the provider view, Dr. Jenkins sees the verified PayPal capture immediately and can issue a full or partial refund through PayPal's Captures v2 refund endpoint, backed by cryptographic webhook signature verification."* |
| **2:25 – 2:45** | **6. 15-Tool MCP Agent Interface** | Click **MCP Agent Interface** in the header bar. Click **Test Live MCP Tool Call** to show live JSON-RPC 2.0 tool execution against `https://paypal-ai-billing-mcp.apd1034.workers.dev/mcp`, then click **Reset Demo**. | *"Finally, any MCP-compatible AI client can connect to our dedicated Cloudflare Worker MCP Agent Interface with 15 scoped tools—while every visitor's changes stay isolated to their own demo session. Thank you!"* |

---

## 4. Sanitized Evidence Manifest

| Evidence Item | Verification Script / Artifact | Status |
| :--- | :--- | :--- |
| **Dedicated Cloudflare MCP Gateway (26/26 Checks)** | `node scripts/verify-maas-mcp.mjs` | **PASS (`26/26`)** |
| **Live Gemini 2.5 Flash AI & Backend Security (16/16 Checks)** | `node scripts/verify-security-and-ai.mjs` | **PASS (`16/16`)** |
| **Public Vercel E2E & Zero-Flicker Switcher (16/16 Checks)** | `node scripts/verify-vercel-e2e.mjs` | **PASS (`16/16`, `21` rapid switches, `0` blank frames)** |
| **Unit & Component Test Suite (47/47 Tests)** | `npm test -- --watchAll=false` | **PASS (`47/47`)** |
| **Source Secret & Isolation Scan** | `npm run scan:secrets` | **PASS (`0` leaked secrets)** |
| **Live PayPal Sandbox Checkout & Refund Verifier** | `node scripts/verify-live-paypal-sandbox.mjs` | **Ready to execute once `PAYPAL_SANDBOX_CLIENT_ID` & `PAYPAL_SANDBOX_CLIENT_SECRET` are pasted into `.env`** |

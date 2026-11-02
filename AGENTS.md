# AGENTS.md — PayPal AI Billing Kit (`@paypal-ai/billing-kit`)

This repository (`/Users/danny/Desktop/PayPal-AI-Billing-Kit`) is the **standalone** PayPal AI Billing Kit workspace.

## 1. Strict Workspace & Infrastructure Isolation

- **Workspace Root:** `/Users/danny/Desktop/PayPal-AI-Billing-Kit`
- **Dedicated Supabase Project:** `dvzfesfvefggnunkjhom` (`https://dvzfesfvefggnunkjhom.supabase.co`)
- **Public Web Application (Vercel):** `https://paypal-ai-billing-kit.vercel.app`
- **Unified Cloudflare Worker MCP Gateway:** `https://paypal-ai-billing-mcp.apd1034.workers.dev/mcp`
- **PayPal Sandbox REST API:** `https://api-m.sandbox.paypal.com` (`Default Application`, `APP-5SK74342S6474230W`)
- **Official PayPal Sandbox MCP Server:** `https://mcp.sandbox.paypal.com/sse` (discoverable via `/.well-known/oauth-authorization-server`)
- **Prohibited External Projects:** Never modify any directory outside `/Users/danny/Desktop/PayPal-AI-Billing-Kit` or any Supabase project other than `dvzfesfvefggnunkjhom`.

## 2. Local Development & Verification Commands

| Task | Command |
| :--- | :--- |
| Start local Expo Web server (`:8081`) | `npm run web` (`npx expo start --web --port 8081`) |
| TypeScript static check | `npm run typecheck` |
| Unit & component regression tests | `npm test -- --watchAll=false` |
| Live Unified MCP Gateway verification | `npm run verify:mcp` (`node scripts/verify-maas-mcp.mjs`) |
| Live Gemini AI & security audit | `npm run verify:ai-security` (`node scripts/verify-security-and-ai.mjs`) |
| Live PayPal Sandbox end-to-end test | `npm run verify:paypal-sandbox` (`node scripts/verify-live-paypal-sandbox.mjs`) |
| Playwright E2E browser verification | `npm run verify:e2e` (`node scripts/verify-public-vercel-e2e.mjs`) |
| Secret & isolation scan | `npm run scan:secrets` (`node scripts/scan-secrets.mjs`) |

## 3. Core Financial & Security Guardrails

1. **Conversational & Proposal Authorization:** Explicit user instructions authorize requested actions within the user's role and monetary guardrails (`$500.00` single action / `$2,500.00` daily limit), while capability or hypothetical questions explain or preview without mutating records.
2. **Real PayPal Buyer Authorization:** User instructions satisfy internal application approval but never bypass PayPal buyer checkout authorization or falsify PayPal capture verification.
3. **Sensitive-Data Firewall (`block_clinical_data = true`):** Only allowlisted `ADMIN-*` service codes, invoice numbers, and USD amounts are transmitted to PayPal.
4. **Secret Hygiene:** Never print, log, screenshot, or commit secret values (`PAYPAL_SANDBOX_CLIENT_ID`, `PAYPAL_SANDBOX_CLIENT_SECRET`, `GEMINI_API_KEY`, `SYNC_SETUP_NONCE`).

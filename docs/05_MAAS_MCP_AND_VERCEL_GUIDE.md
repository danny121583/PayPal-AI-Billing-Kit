# PayPal AI Billing Kit — MCP Agent Interface Architecture, Vercel Deployment & Independent AI Testing Guide

## 1. Public Production Endpoints

| Resource | Public URL | Protocol / Format |
| :--- | :--- | :--- |
| **Interactive Web Demo (Vercel Hobby)** | `https://paypal-ai-billing-kit.vercel.app` | React Native Web / Expo Router SPA (No login required) |
| **Dedicated Cloudflare Worker MCP Endpoint** | `https://paypal-ai-billing-mcp.apd1034.workers.dev/mcp` | Model Context Protocol (`2025-06-18` / `2026-07-28`) JSON-RPC 2.0 + REST |
| **Web App MCP Endpoint (Vercel Proxy)** | `https://paypal-ai-billing-kit.vercel.app/api/mcp` | Model Context Protocol (`2025-06-18`) JSON-RPC 2.0 + REST |
| **OpenAPI 3.1.0 Specification** | `https://paypal-ai-billing-mcp.apd1034.workers.dev/api/openapi.json` | OpenAPI 3.1.0 JSON for ChatGPT Actions / Custom GPTs |
| **Interactive MCP Documentation** | `https://paypal-ai-billing-mcp.apd1034.workers.dev/docs/mcp` | HTML & JSON Tool Catalog |

---

## 2. Visitor Authentication Removal & Isolated Demo Sessions

### How Public Visitor Access Works
- Visitors opening `https://paypal-ai-billing-kit.vercel.app` land **directly on the Provider Billing Dashboard** (`Dr. Sarah Jenkins`) without any registration, email, or password prompt.
- The top **Active Demo Account** bar provides instant 1-click switching across the 3 fictional demonstration personas:
  1. **Provider:** `Dr. Sarah Jenkins` (`11111111-1111-4111-8111-111111111101`)
  2. **Customer #1:** `Alex Rivera` (`11111111-1111-4111-8111-111111111102`)
  3. **Customer #2:** `Jordan Taylor` (`11111111-1111-4111-8111-111111111103`)
- Behind the scenes, `ensureDemoAccountSignedIn()` signs into the selected fictional demo persona in the dedicated `dvzfesfvefggnunkjhom` Supabase project while maintaining strict Row-Level Security (`RLS`) between accounts.

### Per-Visitor Demo Session Isolation (`demo_session_id`)
- Every browser visitor receives an automatic, unique `demo_session_id` (e.g., `demo-m8x9k2a1-9f3c1b`) stored in local storage and displayed in the top Demo Controls bar (`Session: demo-...`).
- External AI agents and MCP clients can pass `"demo_session_id": "<your-session-id>"` in tool arguments or via the `X-Demo-Session-Id` HTTP header.
- **How Canonical Seed Data Is Protected:**
  - The 6 canonical seed statements (`#PPB-INV-2026-1001` through `#PPB-INV-2026-1006`) remain permanently in `demo_session_id = 'canonical'` with a database trigger (`billing_prevent_seed_delete`) that forbids accidental deletion.
  - When a visitor creates a new invoice, it is tagged with their `demo_session_id` (capped at 35 custom invoices per session for abuse protection).
  - When a visitor voids, settles, or refunds one of the 6 canonical seed invoices, the state transition is written to `public.billing_demo_session_overrides(demo_session_id, invoice_id, ...)` so only that visitor's session sees the override.
  - Clicking **Reset Demo** calls `public.billing_reset_demo_session(p_demo_session_id)` to clear that visitor's overrides and custom invoices, immediately restoring the 6 canonical seed statements.

---

## 3. MCP Agent Interface Tool Catalog & Permission Tiers

All 15 tools are exposed via both MCP JSON-RPC 2.0 (`tools/list`, `tools/call`) and REST (`POST /api/mcp` with `{"tool": "<name>", "arguments": {...}}`):

| # | Tool Name | Permission Tier | Description |
| :--- | :--- | :--- | :--- |
| 1 | `discover_billing_capabilities` | `read_only` | Returns server capabilities, active guardrails (`$500.00` single-action / `$2,500.00` daily), demo accounts, and permission tiers. |
| 2 | `list_demo_customers` | `read_only` | Lists fictional customers (`Alex Rivera`, `Jordan Taylor`) linked to `Dr. Sarah Jenkins`. |
| 3 | `search_invoices` | `read_only` | Searches and filters invoices by `status`, `customer_name`, or `query` within the demo session. |
| 4 | `get_invoice_details` | `read_only` | Returns full line-item breakdown, service date, due date, paid date, settlement status, and human-readable explanation for any invoice. |
| 5 | `create_invoice_proposal` | `proposal_only` | Validates recipient authorization and the `$500.00` single-action guardrail, then creates a pending invoice proposal requiring explicit approval. |
| 6 | `create_approved_invoice` | `confirmed_demo_write` | Executes an approved invoice proposal (`proposal_id` or `explicit_human_approval: true`) in the isolated demo session. |
| 7 | `explain_outstanding_balances` | `read_only` | Computes open and overdue USD balances across the practice or for a specific customer. |
| 8 | `get_transaction_history` | `read_only` | Lists payment settlements and attempts, distinguishing `Verified PayPal Sandbox Capture` from `Sample Demo Record — Not a Live PayPal Capture`. |
| 9 | `prepare_payment_proposal` | `proposal_only` | Prepares a customer payment checkout proposal for an unpaid invoice without autonomously charging funds. |
| 10 | `void_unpaid_invoice` | `confirmed_demo_write` | Voids an unpaid invoice (`draft`/`sent`) in the demo session; enforces Payment-State Protection blocking voids on paid/refunded invoices. |
| 11 | `prepare_refund_proposal` | `proposal_only` | Prepares a full or partial refund proposal for a paid invoice (`#PPB-INV-2026-1003`) within the `$500.00` single-action cap. |
| 12 | `get_financial_audit_history` | `read_only` | Returns the append-only financial audit trail (`billing_audit_events`). |
| 13 | `get_paypal_sandbox_status` | `read_only` | Reports PayPal Sandbox integration readiness, sensitive-data firewall status, and settlement mode. |
| 14 | `get_business_metrics` | `read_only` | Computes practice KPIs (`Outstanding`, `Overdue`, `Paid Invoices`, `Failed Attempts`, `Recent Payments`, `Refunded`). |
| 15 | `reset_demo_session` | `confirmed_demo_write` | Resets the specified `demo_session_id` back to the 6 canonical seed statements (`$275.00` Outstanding). |

---

## 4. Independent ChatGPT / MCP Client Testing Examples

### A. Discovery (`GET`)
```bash
curl -s "https://paypal-ai-billing-kit.vercel.app/api/mcp" | jq .
```

### B. OpenAPI 3.1.0 Schema (`GET`)
```bash
curl -s "https://paypal-ai-billing-kit.vercel.app/api/openapi.json" | jq .info
```

### C. MCP JSON-RPC 2.0 `tools/list` (`POST`)
```bash
curl -s -X POST "https://paypal-ai-billing-kit.vercel.app/api/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | jq '.result.tools | map(.name)'
```

### D. Explain Specific Invoice `#PPB-INV-2026-1003` (`POST`)
```bash
curl -s -X POST "https://paypal-ai-billing-kit.vercel.app/api/mcp" \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "get_invoice_details",
    "arguments": {
      "invoice_number": "PPB-INV-2026-1003",
      "demo_session_id": "chatgpt-judge-session"
    }
  }' | jq .
```

### E. Verify `$500.00` Guardrail Enforcement (`POST`)
```bash
curl -s -X POST "https://paypal-ai-billing-kit.vercel.app/api/mcp" \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "create_invoice_proposal",
    "arguments": {
      "customer_name": "Alex Rivera",
      "service_code": "ADMIN-TELEHEALTH",
      "amount_minor": 75000,
      "demo_session_id": "chatgpt-judge-session"
    }
  }' | jq .
```

### F. Propose -> Approve -> Void -> Reset Lifecycle (`POST`)
```bash
# 1. Create a $35.00 Forms Completion invoice in isolated session
curl -s -X POST "https://paypal-ai-billing-kit.vercel.app/api/mcp" \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "create_approved_invoice",
    "arguments": {
      "explicit_human_approval": true,
      "customer_name": "Alex Rivera",
      "service_code": "ADMIN-FORMS",
      "amount_minor": 3500,
      "demo_session_id": "chatgpt-judge-session"
    }
  }' | jq .

# 2. Reset the isolated session back to the 6 canonical seed statements
curl -s -X POST "https://paypal-ai-billing-kit.vercel.app/api/mcp" \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "reset_demo_session",
    "arguments": {
      "demo_session_id": "chatgpt-judge-session"
    }
  }' | jq .
```

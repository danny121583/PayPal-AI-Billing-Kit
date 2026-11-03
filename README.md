# PayPal AI Billing Kit (`v1.9.0`)

**AI-Powered Invoicing, Mistake-Recovery Workflows, Conversational Authorization, Automated Sandbox Card Checkout, Merchant-Branded PDF Receipts & Unified 82-Tool Model Context Protocol (MCP) Gateway for PayPal Sandbox.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Live Demo](https://img.shields.io/badge/Live_Demo-Vercel-000000?logo=vercel)](https://paypal-ai-billing-kit.vercel.app)
[![Unified MCP Gateway](https://img.shields.io/badge/Unified_MCP_Gateway-82_Tools_Live-F38020?logo=cloudflare)](https://paypal-ai-billing-mcp.apd1034.workers.dev/mcp)
[![OpenAPI 3.1.0](https://img.shields.io/badge/OpenAPI-3.1.0-6BA539?logo=openapiinitiative)](https://paypal-ai-billing-mcp.apd1034.workers.dev/api/openapi.json)

---

## Live Public Endpoints

| Endpoint | Public URL | Purpose |
| --- | --- | --- |
| **Web Application (Vercel)** | `https://paypal-ai-billing-kit.vercel.app` | Interactive Provider & Customer Billing Dashboard (Desktop & Mobile Web) |
| **Dedicated Unified MCP Gateway (Cloudflare Worker)** | `https://paypal-ai-billing-mcp.apd1034.workers.dev/mcp` | Primary JSON-RPC 2.0 MCP Server (`POST` & `GET`) exposing **82 unified tools** for ChatGPT MCP, Claude Desktop, and MCP Inspector |
| **Vercel MCP Mirror** | `https://paypal-ai-billing-kit.vercel.app/api/mcp` | Mirror JSON-RPC 2.0 MCP endpoint |
| **OpenAPI 3.1.0 Spec** | `https://paypal-ai-billing-mcp.apd1034.workers.dev/api/openapi.json` | Machine-readable OpenAPI 3.1.0 schema for ChatGPT Custom GPT Actions |
| **Interactive MCP Docs** | `https://paypal-ai-billing-mcp.apd1034.workers.dev/docs/mcp` | Human-readable MCP documentation and curl examples |
| **Downloadable PDF Receipt API (Sample Link)** | `https://paypal-ai-billing-mcp.apd1034.workers.dev/api/receipts/PPB-INV-2026-1003.pdf` | Sample PDF 1.4 receipt (`#PPB-INV-2026-1003`) for instant viewing; every PayPal Sandbox transaction dynamically generates its own unique receipt via `/api/receipts/:invoice_number.pdf` (`Content-Type: application/pdf`) |

---

## Overview

**PayPal AI Billing Kit** is a standalone, open-source AI billing and payment application built for the **PayPal AI Hackathon 2026**. It pairs a multi-role Billing Dashboard (**Provider** & **Customer** perspectives) with an in-app **Gemini 3.5 Flash-Lite Billing AI Assistant** (`thinkingLevel: "MEDIUM"`) and a **Unified 82-Tool Model Context Protocol (MCP) Gateway** connected to **PayPal Sandbox REST v1/v2/v3 APIs** (`api-m.sandbox.paypal.com`) and **Official PayPal MCP Discovery** (`mcp.sandbox.paypal.com/sse`).

### Key Capabilities

1. **Unified 82-Tool MCP Gateway (`https://paypal-ai-billing-mcp.apd1034.workers.dev/mcp`):**
   - **21 Native Application Tools (`source: "native_application"`):** Customer lookup, invoice search, balance explanation, transaction history, structured + PDF receipts (`get_payment_receipt`, `generate_receipt_pdf`), session-isolated audit logs, business metrics, proposal creation, real PayPal Sandbox wallet & card order creation/capture/refund, unpaid invoice voiding, and conversational command execution.
   - **47 Official PayPal MCP Tools (`source: "official_paypal_mcp"`):** `paypal_discover_official_mcp` plus all **46 official PayPal MCP tools** registered by their exact official names (`create_invoice`, `create_recurring_series`, `activate_recurring_series`, `get_recurring_series`, `cancel_recurring_series`, `delete_recurring_series`, `list_invoices`, `get_invoice`, `send_invoice`, `send_invoice_reminder`, `cancel_sent_invoice`, `delete_invoice`, `setup_invoice_auto_reminders`, `update_invoice_auto_reminder`, `search_invoicing`, `update_invoicing`, `cancel_invoice_auto_reminder`, `generate_invoice_qr_code`, `generate_invoice_number`, `record_payment_for_invoice`, `record_refund_for_invoice`, `create_conditional_rules_for_invoice`, `create_product`, `list_products`, `update_product`, `show_product_details`, `create_subscription_plan`, `list_subscription_plans`, `show_subscription_plan_details`, `create_subscription`, `show_subscription_details`, `cancel_subscription`, `update_subscription`, `create_shipment_tracking`, `get_shipment_tracking`, `update_shipment_tracking`, `create_order`, `get_order`, `pay_order`, `list_disputes`, `get_dispute`, `accept_dispute_claim`, `list_transactions`, `create_refund`, `get_refund`, `get_merchant_insights`).
   - **14 PayPal Sandbox REST-to-MCP Adapter Tools (`source: "paypal_rest_adapter"`):** 8 existing (`paypal_get_order`, `paypal_get_refund`, `paypal_list_invoices`, `paypal_generate_invoice_number`, `paypal_list_disputes`, `paypal_check_card_eligibility`, `execute_sandbox_card_payment`, `run_sandbox_card_lifecycle_test`) + 6 new (`update_plan`, `paypal_authorize_order`, `paypal_list_webhooks`, `paypal_list_webhook_event_types`, `paypal_list_invoice_templates`, `paypal_create_vault_setup_token`).
   - **Permission Tiers:** `39` `read_only`, `3` `proposal_only`, and `40` `confirmed_demo_write`.
2. **Automated Server-Side PayPal Sandbox Direct-Card Checkout (`Orders v2 payment_source.card`):**
   - Alongside standard PayPal Wallet Checkout (`PAYER_ACTION_REQUIRED` → buyer approval URL) and explicitly labeled Demo Settlement Simulation, supports server-side PayPal Sandbox card payments using allowlisted developer test card profiles (`visa_sandbox`, `mastercard_sandbox`, `amex_sandbox`, `decline_refused`, `decline_expired`, `decline_insufficient_funds`) for automated `Order → Capture → Receipt → Refund` verification without exposing or accepting raw card numbers (`RAW_CARD_CREDENTIALS_FORBIDDEN`).
3. **8-State Payment-Attempt Classification & Session-Isolated Audit Trail:**
   - Distinguishes `awaiting_buyer_approval`, `approval_required` (`ORDER_NOT_APPROVED`), `payment_declined`, `buyer_canceled`, `authorized`, `captured`, `refunded`, and `processing_error` so premature capture attempts never inflate declined-card metrics.
   - Enforces strict session and role isolation on `get_financial_audit_history` (`canonical_seed` vs `session_private`).
2. **Dual Authorization Model (Cryptographic Proposals + Conversational Authorization):**
   - **HMAC-SHA256 Proposal Tokens (`PPB-PROP-1...`):** Server-persisted in `public.billing_ai_action_proposals` with 30-minute expiration, parameter binding, and single-use consumption.
   - **Explicit Conversational Authorization (`evaluateConversationalAuthorization`):** Direct user instructions (e.g., *"Create a $35 invoice for Alex Rivera for immunization"*, *"Pay Alex Rivera's $35 invoice"*, *"Refund $20 on invoice PPB-INV-2026-1003"*, *"Void unpaid invoice PPB-INV-2026-1001"*) execute immediately within `$500` single-action and `$2,500` daily guardrails, while capability questions (*"Can you refund invoices?"*) and hypothetical questions (*"What would happen if I paid?"*) never trigger writes.
3. **Real End-to-End PayPal Sandbox Payments & Refunds:**
   - Creates real PayPal Sandbox Orders (`POST /v2/checkout/orders`), enforces genuine buyer approval on `sandbox.paypal.com`, captures payments (`POST /v2/checkout/orders/{id}/capture`), and executes partial or full refunds (`POST /v2/payments/captures/{id}/refund`).
4. **Professional Merchant-Branded PDF 1.4 Receipts:**
   - Dynamically generates a unique, merchant-first downloadable PDF receipt (`GET /api/receipts/:invoice_number.pdf`) and base64-encoded PDF inside `get_payment_receipt` and `generate_receipt_pdf` for every paid or refunded statement (`#PPB-INV-2026-1003.pdf` is provided above as a sample PDF for quick viewing, while all live PayPal Sandbox transactions generate their own unique receipt with their real PayPal Order, Capture, and Refund IDs). Features **Jenkins Wellness & Telehealth Practice** (`Provider: Dr. Sarah Jenkins`), distinct state titles (`Payment Receipt — Paid`, `Payment & Refund Receipt — Refunded`, `Payment Receipt — Partially Refunded`, `Sample Demo Receipt — Not a Real PayPal Payment`), card brand & last 4 digits, `"Payment processed through PayPal"` attribution, and `"This receipt was generated electronically. Please retain it for your records."` footer.

---

## Connecting ChatGPT MCP to PayPal AI Billing Kit

1. Open **ChatGPT** → **Settings** → **Connectors / Developer Mode (MCP)**.
2. Add a new MCP Server with:
   - **MCP Server URL:** `https://paypal-ai-billing-mcp.apd1034.workers.dev/mcp`
   - **Authentication:** None required for isolated visitor demo sessions (or OAuth 2.0 auto-discovered via `/.well-known/oauth-authorization-server`).
3. Refresh the connector and try these prompts directly in ChatGPT:

```text
Show me Alex Rivera's pending invoices.
Explain Jordan Taylor's failed payment.
Create a $35 invoice for Alex Rivera for immunization.
Prepare payment for Alex Rivera's $35 invoice.
Pay Alex Rivera's $35 invoice PPB-INV-2026-1002.
Give me the payment receipt and PDF download link for PPB-INV-2026-1003.
Refund $15 on invoice PPB-INV-2026-1003.
Inspect PayPal Sandbox order 4G312456A5669123W using paypal_get_order.
Show me the financial audit history.
```

---

## Application Walkthrough & Screenshots (`docs/screenshots/`)

### 1. Provider Dashboard & Connected PayPal Sandbox Status
![Provider Dashboard](./docs/screenshots/01-provider-dashboard.png)

### 2. Customer Perspectives (Alex Rivera & Jordan Taylor)
| Alex Rivera (Pending & Paid Invoices) | Jordan Taylor (Failed Payment & Recovery) |
| --- | --- |
| ![Alex Rivera](./docs/screenshots/02-customer-alex-rivera.png) | ![Jordan Taylor](./docs/screenshots/03-customer-jordan-taylor.png) |

### 3. Invoice Creation & PayPal Sandbox Connection Controls
| Create Invoice Modal | PayPal Sandbox Connected | PayPal Sandbox Disconnected |
| --- | --- | --- |
| ![Create Invoice](./docs/screenshots/04-create-invoice-modal.png) | ![PayPal Connected](./docs/screenshots/05-paypal-sandbox-connected.png) | ![PayPal Disconnected](./docs/screenshots/06-paypal-sandbox-disconnected.png) |

### 4. Failed Payment Recovery, Billing AI Assistant, Unified MCP Modal & Guardrails
| Failed Payment Retry (`#PPB-INV-2026-1004`) | Billing AI Assistant |
| --- | --- |
| ![Failed Payment Retry](./docs/screenshots/07-failed-payment-retry-1004.png) | ![Billing AI Assistant](./docs/screenshots/08-billing-ai-assistant.png) |

| Unified MCP Agent Interface (82 Tools) | Financial Guardrails & Audit Trail |
| --- | --- |
| ![MCP Agent Interface](./docs/screenshots/09-mcp-agent-interface-modal.png) | ![Guardrails and Audit Trail](./docs/screenshots/10-guardrails-and-audit-trail.png) |

---

## Complete 82-Tool Unified MCP Reference (21 Native + 47 Official PayPal MCP + 14 PayPal REST Adapters)

### Tier 1 — Read-Only Discovery, Receipts & PayPal Sandbox Inspection (39 Tools)
| Tool Name | Source | Description |
| --- | --- | --- |
| `discover_billing_capabilities` | `native_application` | Returns system capabilities, guardrails (`$500` single / `$2,500` daily), and 82-tool catalog. |
| `list_demo_customers` | `native_application` | Lists fictional demo customers (`Alex Rivera`, `Jordan Taylor`) and provider (`Dr. Sarah Jenkins`). |
| `search_invoices` | `native_application` | Filters invoices by customer name, status (`sent`, `paid`, `partially_refunded`, `refunded`, `failed`, `void`), or query. |
| `get_invoice_details` | `native_application` | Returns full line-item breakdown, PayPal Order/Capture IDs, payment transactions, and refund history. |
| `explain_outstanding_balances` | `native_application` | Summarizes unpaid balances, overdue invoices, and failed payment recovery steps. |
| `get_transaction_history` | `native_application` | Lists PayPal Order creations, captures, refunds, and failure diagnostics. |
| `get_payment_receipt` | `native_application` | Generates a structured payment receipt plus downloadable PDF URL (`pdf_download_url`) and `pdf_base64`. |
| `generate_receipt_pdf` | `native_application` | Generates and validates a binary PDF 1.4 receipt for a paid or refunded statement (refuses unpaid invoices). |
| `get_financial_audit_history` | `native_application` | Lists session-isolated append-only audit entries from `billing_audit_events`. |
| `get_paypal_sandbox_status` | `native_application` | Verifies live PayPal Sandbox OAuth 2.0 connectivity and merchant connection status. |
| `get_business_metrics` | `native_application` | Computes total invoiced, collected, outstanding, refunded, and genuine failed payment metrics. |
| `paypal_discover_official_mcp` | `official_paypal_mcp` | Probes PayPal's official remote MCP server (`mcp.sandbox.paypal.com/sse`), OAuth metadata, and 46-tool catalog. |
| `get_recurring_series` | `official_paypal_mcp` | Retrieves a recurring invoice series by ID (`GET /v2/invoicing/recurring-invoices/{id}`). |
| `list_invoices` | `official_paypal_mcp` | Lists invoices from PayPal Invoicing v2 with pagination (`GET /v2/invoicing/invoices`). |
| `get_invoice` | `official_paypal_mcp` | Retrieves a PayPal Sandbox invoice by ID (`GET /v2/invoicing/invoices/{id}`). |
| `search_invoicing` | `official_paypal_mcp` | Searches PayPal invoices or recurring series (`POST /v2/invoicing/search-invoices` / `search-recurring-invoices`). |
| `generate_invoice_qr_code` | `official_paypal_mcp` | Generates a QR code image payload for a PayPal invoice (`POST /v2/invoicing/invoices/{id}/generate-qr-code`). |
| `generate_invoice_number` | `official_paypal_mcp` | Generates the next sequential PayPal invoice number (`POST /v2/invoicing/generate-next-invoice-number`). |
| `list_products` | `official_paypal_mcp` | Lists PayPal Catalog Products (`GET /v1/catalogs/products`). |
| `show_product_details` | `official_paypal_mcp` | Retrieves details of a PayPal Catalog Product (`GET /v1/catalogs/products/{id}`). |
| `list_subscription_plans` | `official_paypal_mcp` | Lists PayPal Subscription Plans (`GET /v1/billing/plans`). |
| `show_subscription_plan_details` | `official_paypal_mcp` | Retrieves PayPal Subscription Plan details (`GET /v1/billing/plans/{id}`). |
| `show_subscription_details` | `official_paypal_mcp` | Retrieves PayPal Subscription details (`GET /v1/billing/subscriptions/{id}`). |
| `get_shipment_tracking` | `official_paypal_mcp` | Retrieves shipment tracking information (`GET /v1/shipping/trackers`; requires shipping scope). |
| `get_order` | `official_paypal_mcp` | Retrieves PayPal Checkout Order details (`GET /v2/checkout/orders/{id}`). |
| `list_disputes` | `official_paypal_mcp` | Lists PayPal Customer Disputes (`GET /v1/customer/disputes`). |
| `get_dispute` | `official_paypal_mcp` | Retrieves details of a specific PayPal dispute (`GET /v1/customer/disputes/{id}`). |
| `list_transactions` | `official_paypal_mcp` | Lists PayPal Reporting Transactions (`GET /v1/reporting/transactions`; requires reporting scope). |
| `get_refund` | `official_paypal_mcp` | Retrieves details of a PayPal Refund (`GET /v2/payments/refunds/{id}`). |
| `get_merchant_insights` | `official_paypal_mcp` | Retrieves PayPal Merchant Insights (`GET /v1/merchant/insights`; unsupported in Sandbox mode). |
| `paypal_get_order` | `paypal_rest_adapter` | Fetches a live PayPal Sandbox Order (`GET /v2/checkout/orders/{id}`). |
| `paypal_get_refund` | `paypal_rest_adapter` | Fetches a live PayPal Sandbox Refund (`GET /v2/payments/refunds/{id}`). |
| `paypal_list_invoices` | `paypal_rest_adapter` | Lists invoices from the PayPal Sandbox Invoicing v2 API (`GET /v2/invoicing/invoices`). |
| `paypal_generate_invoice_number` | `paypal_rest_adapter` | Generates the next PayPal Sandbox invoice number (`POST /v2/invoicing/generate-next-invoice-number`). |
| `paypal_list_disputes` | `paypal_rest_adapter` | Lists customer disputes from the PayPal Sandbox Disputes API (`GET /v1/customer/disputes`). |
| `paypal_check_card_eligibility` | `paypal_rest_adapter` | Checks merchant eligibility for PayPal Sandbox Orders v2 `payment_source.card` and lists safe test card profiles. |
| `paypal_list_webhooks` | `paypal_rest_adapter` | Lists configured PayPal Sandbox Webhooks (`GET /v1/notifications/webhooks`). |
| `paypal_list_webhook_event_types` | `paypal_rest_adapter` | Lists all subscribed/available PayPal Sandbox Webhook Event Types (`GET /v1/notifications/webhooks-event-types`). |
| `paypal_list_invoice_templates` | `paypal_rest_adapter` | Lists merchant PayPal Invoicing v2 Templates (`GET /v2/invoicing/templates`). |

### Tier 2 — Proposal-Only (3 Tools)
| Tool Name | Source | Description |
| --- | --- | --- |
| `create_invoice_proposal` | `native_application` | Validates guardrails and issues a signed `proposal_id` (`PPB-PROP-1...`) to create an invoice. |
| `prepare_payment_proposal` | `native_application` | Issues a signed `proposal_id` (`PPB-PROP-1...`) to initiate PayPal Sandbox checkout. |
| `prepare_refund_proposal` | `native_application` | Validates refundable balance and issues a signed `proposal_id` (`PPB-PROP-1...`) for a refund. |

### Tier 3 — Confirmed Financial Workflows, Official PayPal MCP Writes & REST-to-MCP Adapters (40 Tools)
| Tool Name | Source | Description |
| --- | --- | --- |
| `create_approved_invoice` | `native_application` | Persists a new invoice using either a signed `proposal_id` or an explicit `user_instruction`. |
| `create_paypal_checkout_order` | `native_application` | Creates a real PayPal Sandbox Order (`v2/checkout/orders`) and returns the `checkout_approval_url`. |
| `capture_paypal_checkout_order` | `native_application` | Captures an approved PayPal Sandbox Order (`v2/checkout/orders/{id}/capture`) and classifies `ORDER_NOT_APPROVED` as `approval_required`. |
| `execute_sandbox_card_payment` | `paypal_rest_adapter` | Executes a real server-side PayPal Sandbox card payment (`payment_source.card`) using allowlisted Sandbox card profiles. |
| `run_sandbox_card_lifecycle_test` | `paypal_rest_adapter` | Runs a complete isolated 7-step PayPal Sandbox card lifecycle test (`Invoice → Order → Capture → Verify → Receipt → Refund → Verify`). |
| `execute_approved_refund` | `native_application` | Executes a PayPal Sandbox Refund (`v2/payments/captures/{id}/refund`) via `proposal_id` or `user_instruction`. |
| `void_unpaid_invoice` | `native_application` | Voids an unpaid invoice (`draft`, `sent`, `overdue`, `failed`) via `proposal_id` or `user_instruction`. |
| `execute_conversational_instruction` | `native_application` | Evaluates a natural-language instruction with `evaluateConversationalAuthorization` and executes authorized actions. |
| `reset_demo_session` | `native_application` | Resets the caller's isolated `demo_session_id` back to the clean 6-invoice canonical baseline. |
| `create_invoice` | `official_paypal_mcp` | Creates a draft invoice in PayPal Invoicing v2 (`POST /v2/invoicing/invoices`). |
| `create_recurring_series` | `official_paypal_mcp` | Creates a draft recurring invoice series (`POST /v2/invoicing/recurring-invoices`). |
| `activate_recurring_series` | `official_paypal_mcp` | Activates a draft recurring invoice series (`POST /v2/invoicing/recurring-invoices/{id}/activate`). |
| `cancel_recurring_series` | `official_paypal_mcp` | Cancels an active recurring invoice series (`POST /v2/invoicing/recurring-invoices/{id}/cancel`). |
| `delete_recurring_series` | `official_paypal_mcp` | Deletes a draft recurring invoice series (`DELETE /v2/invoicing/recurring-invoices/{id}`). |
| `send_invoice` | `official_paypal_mcp` | Sends a draft PayPal invoice to its recipient (`POST /v2/invoicing/invoices/{id}/send`). |
| `send_invoice_reminder` | `official_paypal_mcp` | Sends a reminder for a sent PayPal invoice (`POST /v2/invoicing/invoices/{id}/remind`). |
| `cancel_sent_invoice` | `official_paypal_mcp` | Cancels a sent PayPal invoice (`POST /v2/invoicing/invoices/{id}/cancel`). |
| `delete_invoice` | `official_paypal_mcp` | Deletes a draft PayPal invoice (`DELETE /v2/invoicing/invoices/{id}`). |
| `setup_invoice_auto_reminders` | `official_paypal_mcp` | Initializes merchant automatic invoice reminder configurations (`POST /v2/invoicing/setup-reminders`). |
| `update_invoice_auto_reminder` | `official_paypal_mcp` | Updates an invoice auto-reminder configuration (`PUT /v2/invoicing/reminders/{id}`). |
| `update_invoicing` | `official_paypal_mcp` | Replaces a PayPal invoice or recurring series (`PUT /v2/invoicing/invoices/{id}` / `recurring-invoices/{id}`). |
| `cancel_invoice_auto_reminder` | `official_paypal_mcp` | Cancels automatic reminders on a sent PayPal invoice (`POST /v2/invoicing/invoices/{id}/cancel-reminders`). |
| `record_payment_for_invoice` | `official_paypal_mcp` | Records an external payment on a PayPal invoice (`POST /v2/invoicing/invoices/{id}/payments`). |
| `record_refund_for_invoice` | `official_paypal_mcp` | Records an external refund on a PayPal invoice (`POST /v2/invoicing/invoices/{id}/refunds`). |
| `create_conditional_rules_for_invoice` | `official_paypal_mcp` | Creates conditional payment rules on a PayPal invoice (`POST /v2/invoicing/invoices/{id}/conditional-rules`). |
| `create_product` | `official_paypal_mcp` | Creates a PayPal Catalog Product (`POST /v1/catalogs/products`). |
| `update_product` | `official_paypal_mcp` | Patches a PayPal Catalog Product (`PATCH /v1/catalogs/products/{id}`). |
| `create_subscription_plan` | `official_paypal_mcp` | Creates a PayPal Subscription Plan (`POST /v1/billing/plans`). |
| `create_subscription` | `official_paypal_mcp` | Creates a PayPal Subscription (`POST /v1/billing/subscriptions`). |
| `cancel_subscription` | `official_paypal_mcp` | Cancels a PayPal Subscription (`POST /v1/billing/subscriptions/{id}/cancel`). |
| `update_subscription` | `official_paypal_mcp` | Patches a PayPal Subscription (`PATCH /v1/billing/subscriptions/{id}`). |
| `create_shipment_tracking` | `official_paypal_mcp` | Creates shipment tracking info (`POST /v1/shipping/trackers-batch`; requires shipping scope). |
| `update_shipment_tracking` | `official_paypal_mcp` | Updates shipment tracking info (`PUT /v1/shipping/trackers/{id}`; requires shipping scope). |
| `create_order` | `official_paypal_mcp` | Creates a PayPal Checkout Order (`POST /v2/checkout/orders`). |
| `pay_order` | `official_paypal_mcp` | Captures an approved PayPal Checkout Order (`POST /v2/checkout/orders/{id}/capture`). |
| `accept_dispute_claim` | `official_paypal_mcp` | Accepts liability for a PayPal Customer Dispute (`POST /v1/customer/disputes/{id}/accept-claim`). |
| `create_refund` | `official_paypal_mcp` | Refunds a captured PayPal payment (`POST /v2/payments/captures/{id}/refund`). |
| `update_plan` | `paypal_rest_adapter` | Patches a PayPal Subscription Plan (`PATCH /v1/billing/plans/{plan_id}`). |
| `paypal_authorize_order` | `paypal_rest_adapter` | Authorizes an `intent: "AUTHORIZE"` PayPal Checkout Order (`POST /v2/checkout/orders/{id}/authorize`). |
| `paypal_create_vault_setup_token` | `paypal_rest_adapter` | Creates a PayPal Payment Method Tokens v3 setup token (`POST /v3/vault/setup-tokens`). |

---

## Local Setup & Verification Suite

```bash
# 1. Install dependencies
npm install

# 2. Run Jest unit tests (SDK, Conversational Auth, Unified 82-Tool MCP Registry, PDF Receipts)
npm test -- --watchAll=false

# 3. Verify all 82 Unified MCP Tools (46 Official PayPal MCP + 14 REST Adapters + 21 Native) against live PayPal Sandbox
npm run verify:full-paypal-mcp

# 4. Run full 25-stage automated PayPal Sandbox, MCP, Card Lifecycle & Security verification
npm run verify:paypal-full

# 5. Verify all 82 Unified MCP Gateway tools against Cloudflare Worker + Supabase + Vercel
npm run verify:mcp

# 6. Verify Gemini 3.5 Flash-Lite AI, Proposal Security, Guardrails & Conversational Authorization
npm run verify:ai-security

# 7. Run Playwright E2E browser verification against live Vercel deployment
npm run verify:e2e

# 8. Run secret & project isolation scan
npm run scan:secrets
```

See [`docs/UNIFIED_MCP_AND_SECURITY_ARCHITECTURE.md`](./docs/UNIFIED_MCP_AND_SECURITY_ARCHITECTURE.md) for the complete architectural and security specification.

---

## License

MIT License — see [`LICENSE`](./LICENSE).

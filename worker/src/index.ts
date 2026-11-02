/**
 * Standalone PayPal AI Billing Kit — Dedicated Cloudflare Worker MCP Gateway
 * File: worker/src/index.ts
 *
 * Dedicated, independent Model Context Protocol (MCP) Agent Interface
 * gateway for the PayPal AI Hackathon 2026.
 *
 * Supported Protocols & Standards:
 * - MCP JSON-RPC 2.0 (`POST /mcp` — protocol negotiation `2025-06-18`, `2025-03-26`, `2024-11-05`, `2026-07-28`)
 * - OpenAPI 3.1.0 (`GET /api/openapi.json` & `GET /openapi.json`) for ChatGPT Actions & Custom GPTs
 * - RFC 9728 OAuth 2.0 Protected Resource Metadata (`/.well-known/oauth-protected-resource`)
 * - RFC 8414 Authorization Server Discovery (`/.well-known/oauth-authorization-server`)
 * - RFC 7591 Dynamic Client Registration (`POST /oauth/register`)
 * - Client ID Metadata Document (CIMD) (`https://chatgpt.com/oauth/client.json`)
 * - Public JWKS (`/.well-known/jwks.json`)
 * - Interactive Documentation & Tool Catalog (`/docs/mcp`)
 *
 * Target Database:
 * - Exclusively connects to dedicated Supabase project `dvzfesfvefggnunkjhom`.
 * - ZERO access to any external staging or production databases.
 */

export interface Env {
  ENVIRONMENT?: string;
  MCP_ENVIRONMENT?: string;
  CANONICAL_ISSUER?: string;
  MCP_CANONICAL_ISSUER?: string;
  MCP_RESOURCE_URI?: string;
  APP_ORIGIN?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  MCP_PROTOCOL_MODERN?: string;
  MCP_PROTOCOL_LEGACY?: string;
  RATE_LIMIT_MAX_PER_MINUTE?: string;
}

const DEFAULT_ISSUER = 'https://paypal-ai-billing-mcp.apd1034.workers.dev';
const DEFAULT_SUPABASE_URL = 'https://dvzfesfvefggnunkjhom.supabase.co';
const DEFAULT_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2emZlc2Z2ZWZnZ251bmtqaG9tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM0NTQyMzMsImV4cCI6MjEwOTAzMDIzM30.2tR5MsIMnCBrLvvhE1mgC-nbOPIhDbdkU0cGFs1x4PA';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Session-Id, X-Demo-Session-Id, X-Demo-Session-Token',
  'Access-Control-Expose-Headers':
    'WWW-Authenticate, MCP-Protocol-Version, Mcp-Session-Id, X-Demo-Session-Token',
  'Cache-Control': 'no-cache, no-store, must-revalidate',
};

// In-memory isolate cache supplementing stateless HMAC session-proposal binding
const proposalSessionCache = new Map<string, string>();

function sanitizeSessionId(raw?: unknown): string {
  const val = String(raw || '').trim();
  if (!val) return 'maas-public-demo';
  const cleaned = val.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  return cleaned || 'maas-public-demo';
}

async function computeProposalSessionSig(
  sessionId: string,
  rawProposalId: string,
  secret: string
): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(`ppb-session-bind:${secret}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    enc.encode(`${sessionId}:${rawProposalId}`)
  );
  return Array.from(new Uint8Array(mac))
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function buildMcpToolResult(payload: Record<string, any>, isError = false) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2),
      },
    ],
    structuredContent: payload,
    isError,
  };
}

// Static ES256 Public JWK for discovery
const DEMO_JWK = {
  kty: 'EC',
  crv: 'P-256',
  x: 'f83OJ3D2xFmT4vGLb-vG6284UDbe62DgpaGSliPpaDU',
  y: 'x_da7WfZR54x38vo6ke8553CWCnxWnpUxRIetMcNP60',
  kid: 'paypal-billing-mcp-2026',
  use: 'sig',
  alg: 'ES256',
};

const MCP_TOOLS_CATALOG = [
  {
    name: 'discover_billing_capabilities',
    description:
      '[READ_ONLY] Discover all PayPal AI Billing Kit MCP Agent Interface capabilities, guardrails ($500 single-action / $2,500 daily limits), demo personas, service catalog codes, and permission tiers.',
    permissionTier: 'read_only',
    annotations: {
      title: 'Discover Billing Capabilities',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        demo_session_id: {
          type: 'string',
          description: 'Optional isolated visitor/agent demo session ID (default: mcp-public-demo).',
        },
      },
    },
  },
  {
    name: 'list_demo_customers',
    description:
      '[READ_ONLY] List fictional Provider and Customer demo accounts (Dr. Sarah Jenkins, Alex Rivera, Jordan Taylor) and their active billing authorization status.',
    permissionTier: 'read_only',
    annotations: {
      title: 'List Demo Customers & Personas',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'search_invoices',
    description:
      '[READ_ONLY] Search and filter billing statements by status (sent, overdue, paid, draft, void, refunded), customer name/ID, or query text within an isolated demo session.',
    permissionTier: 'read_only',
    annotations: {
      title: 'Search Billing Invoices',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Free-text search matching invoice number, customer name, or service description.',
        },
        status: {
          type: 'string',
          enum: ['all', 'sent', 'overdue', 'paid', 'draft', 'void', 'refunded'],
          description: 'Optional status filter.',
        },
        customer_id: {
          type: 'string',
          description: 'UUID or name of customer to filter by.',
        },
        demo_session_id: {
          type: 'string',
          description: 'Demo session identifier (default: mcp-public-demo).',
        },
      },
    },
  },
  {
    name: 'get_invoice_details',
    description:
      '[READ_ONLY] Retrieve full billing statement breakdown including line items, amount charged, amount paid, remaining balance due, service dates, and PayPal settlement verification status.',
    permissionTier: 'read_only',
    annotations: {
      title: 'Get Invoice Details & Breakdown',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      required: ['invoice_number'],
      properties: {
        invoice_number: {
          type: 'string',
          description: 'Invoice number (e.g., PPB-INV-2026-1003).',
        },
        demo_session_id: {
          type: 'string',
          description: 'Demo session identifier.',
        },
      },
    },
  },
  {
    name: 'create_invoice_proposal',
    description:
      '[PROPOSAL_ONLY] Prepare a safe AI billing action proposal for human review before creating an invoice. Enforces $500 single-action limit and ADMIN-* service code verification.',
    permissionTier: 'proposal_only',
    annotations: {
      title: 'Propose New Invoice Creation',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      required: ['customer_name', 'service_code', 'amount_minor'],
      properties: {
        customer_name: {
          type: 'string',
          description: 'Authorized customer name ("Alex Rivera" or "Jordan Taylor").',
        },
        service_code: {
          type: 'string',
          description: 'Administrative service code (e.g., ADMIN-FORMS, ADMIN-TELEHEALTH).',
        },
        amount_minor: {
          type: 'integer',
          description: 'Unit amount in USD cents (e.g., 3500 for $35.00). Max 50000 ($500.00).',
        },
        due_in_days: {
          type: 'integer',
          description: 'Days until invoice is due (default: 14).',
        },
        send_immediately: {
          type: 'boolean',
          description: 'Whether invoice should be sent immediately upon approval (default: true).',
        },
        demo_session_id: {
          type: 'string',
          description: 'Isolated demo session identifier.',
        },
      },
    },
  },
  {
    name: 'create_approved_invoice',
    description:
      '[CONFIRMED_WRITE] Execute an approved invoice creation within the isolated demo session. Requires a valid one-time proposal_id generated by create_invoice_proposal and explicit_human_approval: true.',
    permissionTier: 'confirmed_demo_write',
    annotations: {
      title: 'Create Approved Demo Invoice',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        proposal_id: {
          type: 'string',
          description: 'One-time session-bound proposal_id returned by create_invoice_proposal.',
        },
        user_instruction: {
          type: 'string',
          description:
            'Optional explicit natural-language user instruction authorizing invoice creation (e.g., "Create an invoice for Alex for $150.").',
        },
        actor_role: {
          type: 'string',
          enum: ['doctor', 'patient', 'provider', 'customer'],
          description: 'Active user role (must be doctor/provider to create invoices).',
        },
        customer_name: {
          type: 'string',
          description: 'Authorized customer name ("Alex Rivera" or "Jordan Taylor") if creating via user_instruction.',
        },
        service_code: {
          type: 'string',
          description: 'Service code (e.g., ADMIN-FORMS, ADMIN-TELEHEALTH).',
        },
        amount_minor: {
          type: 'integer',
          description: 'Unit amount in USD cents (Max 50000).',
        },
        explicit_human_approval: {
          type: 'boolean',
          description: 'Must be true to confirm human approval of this billing write.',
        },
        demo_session_id: {
          type: 'string',
          description: 'Isolated demo session identifier.',
        },
      },
    },
  },
  {
    name: 'explain_outstanding_balances',
    description:
      '[READ_ONLY] Provide a natural-language breakdown of all pending, overdue, and paid balances for Dr. Sarah Jenkins practice or a specific customer.',
    permissionTier: 'read_only',
    annotations: {
      title: 'Explain Outstanding Balances',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        customer_name: {
          type: 'string',
          description: 'Optional customer name ("Alex Rivera" or "Jordan Taylor") to filter by.',
        },
        demo_session_id: {
          type: 'string',
          description: 'Demo session identifier.',
        },
      },
    },
  },
  {
    name: 'get_transaction_history',
    description:
      '[READ_ONLY] Retrieve payment and settlement transaction ledger records (settled payments, refunds, failed attempts, and fees) for the demo session.',
    permissionTier: 'read_only',
    annotations: {
      title: 'Get Transaction History',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        invoice_number: {
          type: 'string',
          description: 'Optional invoice number filter.',
        },
        demo_session_id: {
          type: 'string',
          description: 'Demo session identifier.',
        },
      },
    },
  },
  {
    name: 'prepare_payment_proposal',
    description:
      '[PROPOSAL_ONLY] Prepare a safe AI proposal for human customer approval to submit payment for an unpaid or overdue statement via PayPal Sandbox.',
    permissionTier: 'proposal_only',
    annotations: {
      title: 'Prepare Payment Proposal',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      required: ['invoice_number'],
      properties: {
        invoice_number: {
          type: 'string',
          description: 'Invoice number to pay (e.g., PPB-INV-2026-1002).',
        },
        customer_name: {
          type: 'string',
          description: 'Name of the paying customer.',
        },
        demo_session_id: {
          type: 'string',
          description: 'Demo session identifier.',
        },
      },
    },
  },
  {
    name: 'void_unpaid_invoice',
    description:
      '[CONFIRMED_WRITE] Void an unpaid Draft or Sent invoice. Enforces clinical invariant: Voiding is strictly forbidden once funds have been captured.',
    permissionTier: 'confirmed_demo_write',
    annotations: {
      title: 'Void Unpaid Invoice',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      required: ['invoice_number'],
      properties: {
        invoice_number: {
          type: 'string',
          description: 'Invoice number to void.',
        },
        reason: {
          type: 'string',
          description: 'Administrative reason for voiding.',
        },
        user_instruction: {
          type: 'string',
          description:
            'Optional explicit natural-language user instruction authorizing the void (e.g., "Void invoice 1004.").',
        },
        actor_role: {
          type: 'string',
          enum: ['doctor', 'patient', 'provider', 'customer'],
          description: 'Active user role (must be doctor/provider to void invoices).',
        },
        explicit_human_approval: {
          type: 'boolean',
          description: 'Must be true to confirm human approval.',
        },
        demo_session_id: {
          type: 'string',
          description: 'Demo session identifier.',
        },
      },
    },
  },
  {
    name: 'prepare_refund_proposal',
    description:
      '[PROPOSAL_ONLY] Prepare an AI proposal for human Provider approval to refund captured payments on a paid invoice via PayPal Sandbox.',
    permissionTier: 'proposal_only',
    annotations: {
      title: 'Prepare Refund Proposal',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      required: ['invoice_number', 'reason'],
      properties: {
        invoice_number: {
          type: 'string',
          description: 'Paid invoice number to refund (e.g., PPB-INV-2026-1003).',
        },
        refund_amount_minor: {
          type: 'integer',
          description: 'Refund amount in cents (defaults to full captured amount).',
        },
        reason: {
          type: 'string',
          description: 'Reason for refund.',
        },
        demo_session_id: {
          type: 'string',
          description: 'Demo session identifier.',
        },
      },
    },
  },
  {
    name: 'get_financial_audit_history',
    description:
      '[READ_ONLY] Query immutable financial audit trail (billing_audit_events) showing invoice creations, voids, AI proposals, guardrail checks, and settlements.',
    permissionTier: 'read_only',
    annotations: {
      title: 'Get Financial Audit Trail',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'integer',
          description: 'Maximum events to retrieve (default: 20, max: 100).',
        },
        demo_session_id: {
          type: 'string',
          description: 'Demo session identifier.',
        },
      },
    },
  },
  {
    name: 'get_paypal_sandbox_status',
    description:
      '[READ_ONLY] Check PayPal Sandbox merchant and payer connection status, sandbox environment enforcement, and whether live PayPal Sandbox REST API credentials are configured on the server.',
    permissionTier: 'read_only',
    annotations: {
      title: 'Check PayPal Sandbox Status',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_business_metrics',
    description:
      '[READ_ONLY] Calculate comprehensive Provider practice and Customer KPI metrics (outstanding balance, pending, overdue, paid total, refunded total, failed attempts, and collection rate) for the demo session.',
    permissionTier: 'read_only',
    annotations: {
      title: 'Get Practice & Customer Financial KPIs',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        demo_session_id: {
          type: 'string',
          description: 'Demo session identifier.',
        },
      },
    },
  },
  {
    name: 'reset_demo_session',
    description:
      '[CONFIRMED_WRITE] Reset an isolated demo session (`demo_session_id`), clearing session-specific test invoices, proposals, and overrides while restoring the 6 canonical seed statements (#PPB-INV-2026-1001 through #PPB-INV-2026-1006).',
    permissionTier: 'confirmed_demo_write',
    annotations: {
      title: 'Reset Demo Session Statements',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        demo_session_id: {
          type: 'string',
          description: 'Session identifier to reset.',
        },
      },
    },
  },
  {
    name: 'create_paypal_checkout_order',
    description:
      '[CONFIRMED_WRITE] Create a protected PayPal Sandbox checkout order (POST /v2/checkout/orders) for an unpaid statement or approved payment_checkout proposal (proposal_id). Requires explicit_human_approval: true. Returns the PayPal Order ID and buyer approval URL when live Sandbox credentials are configured, or explicit Sandbox readiness status.',
    permissionTier: 'confirmed_demo_write',
    annotations: {
      title: 'Create PayPal Sandbox Checkout Order',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        proposal_id: {
          type: 'string',
          description: 'Optional session-bound proposal_id prepared by prepare_payment_proposal.',
        },
        user_instruction: {
          type: 'string',
          description:
            'Optional explicit natural-language user instruction authorizing payment checkout initiation (e.g., "Pay invoice 1002.").',
        },
        actor_role: {
          type: 'string',
          enum: ['doctor', 'patient', 'provider', 'customer'],
          description: 'Active user role.',
        },
        invoice_number: {
          type: 'string',
          description: 'Unpaid invoice number (e.g., PPB-INV-2026-1001 or PPB-INV-2026-1004).',
        },
        explicit_human_approval: {
          type: 'boolean',
          description: 'Must be true to confirm human approval before creating a PayPal checkout order.',
        },
        demo_session_id: {
          type: 'string',
          description: 'Isolated demo session identifier.',
        },
      },
    },
  },
  {
    name: 'capture_paypal_checkout_order',
    description:
      '[CONFIRMED_WRITE] Capture an approved PayPal Sandbox checkout order (order_id) after buyer approval, or execute an explicitly labeled Demo Settlement (allow_demo_settlement_fallback: true) in an isolated demo session (demo_session_id). Updates the ledger and issues a receipt.',
    permissionTier: 'confirmed_demo_write',
    annotations: {
      title: 'Capture Approved PayPal Order or Settle Demo Invoice',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      required: ['invoice_number'],
      properties: {
        invoice_number: {
          type: 'string',
          description: 'Invoice number being settled (e.g., PPB-INV-2026-1001 or PPB-INV-2026-1004).',
        },
        order_id: {
          type: 'string',
          description: 'PayPal Sandbox Order ID returned by create_paypal_checkout_order after buyer approval.',
        },
        allow_demo_settlement_fallback: {
          type: 'boolean',
          description: 'When true and live PayPal Sandbox buyer capture is not provided, settles the invoice in the isolated demo session clearly marked as a Sample Demo Record (never fabricated as a live PayPal capture).',
        },
        explicit_human_approval: {
          type: 'boolean',
          description: 'Must be true to confirm human approval of settlement.',
        },
        demo_session_id: {
          type: 'string',
          description: 'Isolated demo session identifier.',
        },
      },
    },
  },
  {
    name: 'get_payment_receipt',
    description:
      '[READ_ONLY] Retrieve the structured payment receipt and PayPal confirmation metadata for a paid or refunded statement (invoice_number), clearly distinguishing verified PayPal Sandbox captures from sample demo settlements.',
    permissionTier: 'read_only',
    annotations: {
      title: 'Get Payment Receipt & Confirmation',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      required: ['invoice_number'],
      properties: {
        invoice_number: {
          type: 'string',
          description: 'Paid or refunded invoice number (e.g., PPB-INV-2026-1003).',
        },
        demo_session_id: {
          type: 'string',
          description: 'Isolated demo session identifier.',
        },
      },
    },
  },
  {
    name: 'execute_approved_refund',
    description:
      '[CONFIRMED_WRITE] Execute an approved provider refund for a paid statement (invoice_number or proposal_id from prepare_refund_proposal) with explicit_human_approval: true. Issues a PayPal Captures v2 refund when a verified PayPal capture exists, or records a demo session refund in the isolated demo_session_id.',
    permissionTier: 'confirmed_demo_write',
    annotations: {
      title: 'Execute Approved Refund',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        proposal_id: {
          type: 'string',
          description: 'UUID or session-bound proposal_id of a pending refund proposal created by prepare_refund_proposal.',
        },
        user_instruction: {
          type: 'string',
          description:
            'Optional explicit natural-language user instruction authorizing this refund (e.g., "Refund the $125 payment on invoice 1003").',
        },
        actor_role: {
          type: 'string',
          enum: ['doctor', 'patient', 'provider', 'customer'],
          description: 'Active user role (must be doctor/provider to issue refunds).',
        },
        invoice_number: {
          type: 'string',
          description: 'Paid invoice number to refund (e.g., PPB-INV-2026-1003).',
        },
        amount_minor: {
          type: 'integer',
          description: 'Optional refund amount in USD cents (defaults to full paid balance).',
        },
        explicit_human_approval: {
          type: 'boolean',
          description: 'Must be true to confirm human approval before executing the refund.',
        },
        demo_session_id: {
          type: 'string',
          description: 'Isolated demo session identifier.',
        },
      },
    },
  },
  {
    name: 'execute_conversational_instruction',
    description:
      '[CONFIRMED_WRITE] Context-aware Conversational Authorization router: evaluates a natural-language user instruction ("Create an invoice for Alex for $150.", "Void invoice 1004.", "Refund the $50 payment.", "Pay invoice 1002.", "Reset the demo.", "Yes, go ahead.", "Are you able to issue refunds?", "Can you pay invoice 1002?", "What would happen if I refunded it?") and executes explicit authorized commands within role and $500/$2,500 guardrails while explaining capability or hypothetical questions without mutating state.',
    permissionTier: 'confirmed_demo_write',
    annotations: {
      title: 'Execute Conversational Billing Instruction',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      required: ['instruction'],
      properties: {
        instruction: {
          type: 'string',
          description: 'Exact natural-language user instruction or question.',
        },
        actor_role: {
          type: 'string',
          enum: ['doctor', 'patient', 'provider', 'customer'],
          description: 'Active user role (default: doctor/provider).',
        },
        prior_execution_intent: {
          type: 'boolean',
          description: 'True only if prior conversation turns already established execution intent.',
        },
        demo_session_id: {
          type: 'string',
          description: 'Isolated demo session identifier.',
        },
      },
    },
  },
  {
    name: 'paypal_discover_official_mcp',
    description:
      '[OFFICIAL_PAYPAL_MCP] Connect server-side to PayPal’s official Sandbox MCP server (https://mcp.sandbox.paypal.com/sse and /.well-known/oauth-authorization-server, plus probe /http) using the merchant Sandbox OAuth token, returning live serverInfo (PayPal MCP Agent v1.0.0), the 46 upstream official PayPal MCP tools, and transport status.',
    permissionTier: 'read_only',
    annotations: {
      title: 'Discover Official PayPal MCP Server Capabilities',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        demo_session_id: {
          type: 'string',
          description: 'Optional isolated demo session identifier.',
        },
      },
    },
  },
  {
    name: 'paypal_get_order',
    description:
      '[PAYPAL_REST_ADAPTER] Official PayPal `get_order` capability: retrieve live order details directly from PayPal Sandbox Orders v2 API (`GET /v2/checkout/orders/{order_id}`), returning order status, intent, payer, purchase units, and capture IDs.',
    permissionTier: 'read_only',
    annotations: {
      title: 'PayPal Sandbox: Get Order Details (Orders v2)',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      required: ['order_id'],
      properties: {
        order_id: {
          type: 'string',
          description: 'PayPal Sandbox Order ID (e.g., "7FA47897KM5938009").',
        },
        demo_session_id: {
          type: 'string',
          description: 'Optional isolated demo session identifier.',
        },
      },
    },
  },
  {
    name: 'paypal_get_refund',
    description:
      '[PAYPAL_REST_ADAPTER] Official PayPal `get_refund` capability: retrieve live refund details directly from PayPal Sandbox Captures v2 API (`GET /v2/payments/refunds/{refund_id}`), returning refund status, amount, note_to_payer, and seller payable breakdown.',
    permissionTier: 'read_only',
    annotations: {
      title: 'PayPal Sandbox: Get Refund Details (Captures v2)',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      required: ['refund_id'],
      properties: {
        refund_id: {
          type: 'string',
          description: 'PayPal Sandbox Refund ID (e.g., "2EM77813GU330222M").',
        },
        demo_session_id: {
          type: 'string',
          description: 'Optional isolated demo session identifier.',
        },
      },
    },
  },
  {
    name: 'paypal_list_invoices',
    description:
      '[PAYPAL_REST_ADAPTER] Official PayPal `list_invoices` capability: query PayPal Sandbox Invoicing v2 API (`GET /v2/invoicing/invoices`) alongside synchronized application statements.',
    permissionTier: 'read_only',
    annotations: {
      title: 'PayPal Sandbox: List Merchant Invoices (Invoicing v2)',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        page: {
          type: 'integer',
          description: 'Page number (default: 1).',
        },
        page_size: {
          type: 'integer',
          description: 'Page size (default: 10).',
        },
        demo_session_id: {
          type: 'string',
          description: 'Optional isolated demo session identifier.',
        },
      },
    },
  },
  {
    name: 'paypal_generate_invoice_number',
    description:
      '[PAYPAL_REST_ADAPTER] Official PayPal `generate_invoice_number` capability: call PayPal Sandbox Invoicing v2 API (`POST /v2/invoicing/generate-next-invoice-number`) to allocate the next official PayPal merchant invoice number.',
    permissionTier: 'read_only',
    annotations: {
      title: 'PayPal Sandbox: Generate Next Invoice Number',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        demo_session_id: {
          type: 'string',
          description: 'Optional isolated demo session identifier.',
        },
      },
    },
  },
  {
    name: 'paypal_list_disputes',
    description:
      '[PAYPAL_REST_ADAPTER] Official PayPal `list_disputes` capability: query PayPal Sandbox Customer Disputes API (`GET /v1/customer/disputes`) to inspect open merchant disputes.',
    permissionTier: 'read_only',
    annotations: {
      title: 'PayPal Sandbox: List Customer Disputes',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        page_size: {
          type: 'integer',
          description: 'Number of disputes to return (1-50, default 10).',
        },
        demo_session_id: {
          type: 'string',
          description: 'Optional isolated demo session identifier.',
        },
      },
    },
  },
];

// Standard MCP tools format (strictly compliant with MCP specification & ChatGPT connectors)
function formatStandardMcpTools(origin = DEFAULT_ISSUER) {
  const securitySchemes = [
    {
      type: 'noauth',
    },
    {
      type: 'oauth2',
      flows: {
        authorizationCode: {
          authorizationUrl: `${origin}/oauth/authorize`,
          tokenUrl: `${origin}/oauth/token`,
          refreshUrl: `${origin}/oauth/token`,
          scopes: {
            'billing:read': 'Read billing statements, receipts, and balances',
            'billing:proposal': 'Prepare human-reviewed invoice, payment, and refund proposals',
            'billing:write': 'Execute approved demo session billing workflows',
          },
        },
      },
      resource: `${origin}/mcp`,
    },
  ];
  return MCP_TOOLS_CATALOG.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    securitySchemes,
    annotations: t.annotations,
    _meta: {
      permissionTier: t.permissionTier,
      'openai/outputTemplate': `ui://widget/${t.name}.html`,
      'openai/widgetAccessible': true,
    },
  }));
}

function buildOpenApiSpec(origin: string) {
  const paths: Record<string, any> = {};

  for (const tool of MCP_TOOLS_CATALOG) {
    paths[`/api/tools/${tool.name}`] = {
      post: {
        summary: tool.annotations.title,
        description: tool.description,
        operationId: tool.name,
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: tool.inputSchema,
            },
          },
        },
        responses: {
          '200': {
            description: 'Successful tool execution',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean' },
                    result: { type: 'object' },
                  },
                },
              },
            },
          },
        },
      },
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'PayPal AI Billing Kit — MCP Agent Interface API',
      version: '2.0.0',
      description:
        'Official MCP & REST tool API for the standalone PayPal AI Billing Kit. Enables AI agents (ChatGPT, Claude, Gemini) to inspect invoices, calculate balances, propose invoices, void statements, and manage sandbox settlements with $500 single-action guardrails.',
    },
    servers: [
      {
        url: origin,
        description: 'Cloudflare Worker MCP Gateway (Edge)',
      },
      {
        url: 'https://paypal-ai-billing-kit.vercel.app',
        description: 'Vercel Web App Gateway',
      },
    ],
    paths,
  };
}

const MUTATING_TOOLS = new Set([
  'create_invoice_proposal',
  'create_approved_invoice',
  'prepare_payment_proposal',
  'void_unpaid_invoice',
  'prepare_refund_proposal',
  'reset_demo_session',
  'create_paypal_checkout_order',
  'capture_paypal_checkout_order',
  'execute_approved_refund',
  'execute_conversational_instruction',
]);

const FORBIDDEN_BYPASS_KEYS = [
  'bypass_guardrail',
  'skip_guardrail',
  'force',
  'skip_approval',
  'auto_approve',
  'auto_execute',
  'simulate_live_paypal_capture',
];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = env.CANONICAL_ISSUER || DEFAULT_ISSUER;
    const supabaseUrl = env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
    const supabaseAnonKey = env.SUPABASE_ANON_KEY || DEFAULT_ANON_KEY;
    const isHead = request.method === 'HEAD';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // 0. Robots.txt (explicitly allow ChatGPT-User, OAI-SearchBot, GPTBot, and all MCP clients)
    if (url.pathname === '/robots.txt') {
      const robots = 'User-agent: *\nAllow: /\n';
      return new Response(isHead ? null : robots, {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    // 1. RFC 9728 OAuth Protected Resource Metadata
    if (
      url.pathname === '/.well-known/oauth-protected-resource' ||
      url.pathname === '/.well-known/oauth-protected-resource/mcp'
    ) {
      const body = JSON.stringify({
        resource: `${origin}/mcp`,
        resource_documentation: `${origin}/docs/mcp`,
        authorization_servers: [origin],
        jwks_uri: `${origin}/.well-known/jwks.json`,
        scopes_supported: ['billing:read', 'billing:write', 'billing:proposal'],
        bearer_methods_supported: ['header'],
        resource_signing_alg_values_supported: ['ES256'],
      });
      return new Response(isHead ? null : body, {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // 2. RFC 8414 Authorization Server Discovery
    if (
      url.pathname === '/.well-known/oauth-authorization-server' ||
      url.pathname === '/.well-known/openid-configuration'
    ) {
      const body = JSON.stringify({
        issuer: origin,
        authorization_endpoint: `${origin}/oauth/authorize`,
        token_endpoint: `${origin}/oauth/token`,
        registration_endpoint: `${origin}/oauth/register`,
        revocation_endpoint: `${origin}/oauth/revoke`,
        jwks_uri: `${origin}/.well-known/jwks.json`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
        id_token_signing_alg_values_supported: ['ES256'],
        scopes_supported: ['billing:read', 'billing:write', 'billing:proposal'],
        resource_indicators_supported: true,
        authorization_response_iss_parameter_supported: true,
        client_id_metadata_document_supported: true,
      });
      return new Response(isHead ? null : body, {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // 3. Public JWKS
    if (url.pathname === '/.well-known/jwks.json') {
      const body = JSON.stringify({
        keys: [DEMO_JWK],
      });
      return new Response(isHead ? null : body, {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // 4. OpenAPI 3.1.0 Specification
    if (
      url.pathname === '/api/openapi.json' ||
      url.pathname === '/openapi.json' ||
      (url.pathname === '/api/mcp' && url.searchParams.get('format') === 'openapi') ||
      (url.pathname === '/mcp' && url.searchParams.get('format') === 'openapi')
    ) {
      const body = JSON.stringify(buildOpenApiSpec(origin), null, 2);
      return new Response(isHead ? null : body, {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // 5. Dynamic Client Registration (DCR) for ChatGPT
    if (url.pathname === '/oauth/register' && request.method === 'POST') {
      try {
        const body = (await request.json().catch(() => ({}))) as any;
        const clientId = `ppb-client-${Date.now().toString(36)}`;
        return new Response(
          JSON.stringify({
            client_id: clientId,
            client_name: body.client_name || 'ChatGPT MCP Client',
            redirect_uris: body.redirect_uris || [
              'https://chatgpt.com/connector_platform_oauth_redirect',
              'https://platform.openai.com/apps-manage/oauth',
            ],
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            token_endpoint_auth_method: 'none',
          }),
          {
            status: 201,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          }
        );
      } catch {
        return new Response(JSON.stringify({ error: 'invalid_client_metadata' }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }
    }

    // 6. OAuth Authorization Endpoint (Auto-Approves Demo Access)
    if (url.pathname === '/oauth/authorize') {
      const redirectUri = url.searchParams.get('redirect_uri') || '';
      const state = url.searchParams.get('state') || '';
      const code = `ppb-code-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

      if (redirectUri) {
        const target = new URL(redirectUri);
        target.searchParams.set('code', code);
        if (state) target.searchParams.set('state', state);
        target.searchParams.set('iss', origin);
        return Response.redirect(target.toString(), 302);
      }

      return new Response(
        JSON.stringify({
          ok: true,
          code,
          state,
          iss: origin,
          message: 'Demo authorization granted.',
        }),
        {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        }
      );
    }

    // 7. OAuth Token & Revocation Endpoints
    if (url.pathname === '/oauth/token' && request.method === 'POST') {
      const demoToken = `ppb-demo-at-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const refreshToken = `ppb-demo-rt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      return new Response(
        JSON.stringify({
          access_token: demoToken,
          refresh_token: refreshToken,
          token_type: 'Bearer',
          expires_in: 86400,
          scope: 'billing:read billing:write billing:proposal',
        }),
        {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        }
      );
    }

    if (url.pathname === '/oauth/revoke' && request.method === 'POST') {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // 8. Documentation Endpoint (`/docs/mcp`)
    if (url.pathname === '/docs/mcp' || url.pathname === '/docs/mcp/') {
      if (
        request.headers.get('accept')?.includes('application/json') ||
        url.searchParams.get('format') === 'json'
      ) {
        const body = JSON.stringify(
          {
            service: 'PayPal AI Billing Kit — Dedicated Cloudflare Worker MCP Gateway',
            version: '2.0.0',
            status: 'operational',
            origin,
            mcp_endpoint: `${origin}/mcp`,
            openapi_spec: `${origin}/api/openapi.json`,
            tools: MCP_TOOLS_CATALOG,
          },
          null,
          2
        );
        return new Response(isHead ? null : body, {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PayPal AI Billing Kit — Model Context Protocol (MCP) Gateway</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #0B0F19; color: #F3F4F6; margin: 0; padding: 24px; line-height: 1.5; }
    .container { max-width: 900px; margin: 0 auto; }
    h1 { color: #F59E0B; margin-bottom: 4px; font-size: 26px; }
    .subtitle { color: #9CA3AF; margin-top: 0; margin-bottom: 24px; }
    .badge { display: inline-block; background: #1E293B; color: #F59E0B; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; border: 1px solid #334155; margin-right: 6px; }
    .card { background: #111827; border: 1px solid #1F2937; border-radius: 12px; padding: 16px 20px; margin-bottom: 16px; }
    .tool-title { font-weight: 700; color: #60A5FA; margin-bottom: 4px; font-size: 15px; }
    .tool-desc { color: #D1D5DB; font-size: 13px; margin-bottom: 8px; }
    .tier-read { color: #34D399; font-weight: 700; font-size: 11px; }
    .tier-prop { color: #FBBF24; font-weight: 700; font-size: 11px; }
    .tier-write { color: #F87171; font-weight: 700; font-size: 11px; }
    code { background: #1F2937; color: #F3F4F6; padding: 2px 6px; border-radius: 4px; font-family: ui-monospace, monospace; font-size: 13px; }
    pre { background: #030712; padding: 14px; border-radius: 8px; overflow-x: auto; color: #E5E7EB; font-size: 13px; border: 1px solid #1F2937; }
  </style>
</head>
<body>
  <div class="container">
    <h1>⚡ PayPal AI Billing Kit — MCP Agent Interface Gateway</h1>
    <p class="subtitle">Dedicated Cloudflare Worker Gateway for PayPal AI Hackathon 2026</p>
    <div style="margin-bottom: 20px;">
      <span class="badge">26 MCP Tools (Unified)</span>
      <span class="badge">OpenAPI 3.1.0</span>
      <span class="badge">Dual Protocol: 2026-07-28 & 2025-06-18</span>
      <span class="badge">$500 Guardrail</span>
      <span class="badge">PayPal Sandbox</span>
    </div>

    <div class="card">
      <div class="tool-title">Quick Connection Endpoints</div>
      <p style="font-size: 13px; color: #9CA3AF;">Configure ChatGPT, Claude, or curl with these endpoints:</p>
      <pre><code>MCP Server URL:    ${origin}/mcp
OpenAPI Spec:      ${origin}/api/openapi.json
Protected Res:     ${origin}/.well-known/oauth-protected-resource
Auth Discovery:    ${origin}/.well-known/oauth-authorization-server
JWKS URI:          ${origin}/.well-known/jwks.json</code></pre>
    </div>

    <div class="card">
      <div class="tool-title">Sample MCP Tool Call</div>
      <pre><code>curl -s -X POST "${origin}/mcp" \\
  -H "Content-Type: application/json" \\
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "get_invoice_details",
      "arguments": { "invoice_number": "PPB-INV-2026-1003" }
    }
  }'</code></pre>
    </div>

    <h2>Available Tools Catalog (26 Total — Unified PayPal MCP Gateway)</h2>
    ${MCP_TOOLS_CATALOG.map(
      (t) => `
    <div class="card">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span class="tool-title"><code>${t.name}</code></span>
        <span class="${
          t.permissionTier === 'read_only'
            ? 'tier-read'
            : t.permissionTier === 'proposal_only'
            ? 'tier-prop'
            : 'tier-write'
        }">[${t.permissionTier.toUpperCase()}]</span>
      </div>
      <div class="tool-desc">${t.description}</div>
    </div>`
    ).join('')}
  </div>
</body>
</html>`;

      return new Response(isHead ? null : html, {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // 9. Root Landing Page
    if (url.pathname === '/' || url.pathname === '') {
      const body = JSON.stringify(
        {
          ok: true,
          service: 'PayPal AI Billing Kit — Dedicated Cloudflare Worker MCP Gateway',
          version: '2.0.0',
          status: 'operational',
          database_target: 'dvzfesfvefggnunkjhom (Dedicated Standalone Supabase)',
          edge_region: (request as any).cf?.colo || 'ORD',
          endpoints: {
            mcp: `${origin}/mcp`,
            openapi: `${origin}/api/openapi.json`,
            docs: `${origin}/docs/mcp`,
            protected_resource: `${origin}/.well-known/oauth-protected-resource`,
            auth_server: `${origin}/.well-known/oauth-authorization-server`,
            jwks: `${origin}/.well-known/jwks.json`,
          },
          web_app: 'https://paypal-ai-billing-kit.vercel.app',
          tools_count: MCP_TOOLS_CATALOG.length,
        },
        null,
        2
      );
      return new Response(isHead ? null : body, {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // 10. MCP Transport Gateway (`/mcp`, `/api/mcp`, `/api/maas`)
    if (
      url.pathname === '/mcp' ||
      url.pathname === '/api/mcp' ||
      url.pathname === '/api/maas'
    ) {
      // GET or HEAD /mcp returns discovery metadata
      if (request.method === 'GET' || isHead) {
        const body = JSON.stringify(
          {
            ok: true,
            service: 'PayPal AI Billing Kit — MCP Agent Interface Server',
            version: '2.0.0',
            protocol_support: [
              'MCP JSON-RPC 2.0 (2025-06-18 / 2025-03-26 / 2024-11-05)',
              'MCP 2026-07-28 stateless server/discover',
              'REST JSON POST/GET',
              'OpenAPI 3.1.0',
            ],
            endpoints: {
              mcp_jsonrpc_post: `${origin}/mcp`,
              openapi_spec_get: `${origin}/api/openapi.json`,
              docs: `${origin}/docs/mcp`,
            },
            tools: MCP_TOOLS_CATALOG.map((t) => ({
              name: t.name,
              permission_tier: t.permissionTier,
              description: t.description,
            })),
          },
          null,
          2
        );
        return new Response(isHead ? null : body, {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            'Content-Type': 'application/json',
            'MCP-Protocol-Version': '2025-06-18',
            'Mcp-Session-Id': 'maas-public-demo',
          },
        });
      }

      if (request.method === 'POST') {
        const bodyText = await request.text().catch(() => '');
        let body: any = {};
        try {
          body = bodyText ? JSON.parse(bodyText) : {};
        } catch {
          return new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: null,
              error: { code: -32700, message: 'Parse error: Invalid JSON payload' },
            }),
            { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
          );
        }

        const method = String(body?.method || body?.tool || '').trim();
        const hasId = body?.id !== undefined && body?.id !== null;
        const jsonRpcId = hasId ? body.id : 1;

        // Protocol Negotiation: `initialize`
        if (method === 'initialize') {
          const requestedVersion = String(body?.params?.protocolVersion || '2025-06-18');
          const supportedVersions = ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
          const negotiatedVersion = supportedVersions.includes(requestedVersion)
            ? requestedVersion
            : '2025-06-18';

          return new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: jsonRpcId,
              result: {
                protocolVersion: negotiatedVersion,
                capabilities: {
                  tools: { listChanged: true },
                  resources: { subscribe: false, listChanged: false },
                  prompts: { listChanged: false },
                  logging: {},
                },
                serverInfo: {
                  name: 'paypal-ai-billing-kit-mcp',
                  title: 'PayPal AI Billing Kit MCP',
                  version: '2.0.0',
                },
                instructions:
                  'Standalone PayPal AI Billing Kit Unified MCP Server. Provides 26 billing tools (20 Native Application tools + 1 Official PayPal MCP Discovery tool + 5 PayPal Sandbox REST-backed tools) across read_only, proposal_only, and confirmed_demo_write permission tiers in isolated demo sessions.',
              },
            }),
            {
              status: 200,
              headers: {
                ...CORS_HEADERS,
                'Content-Type': 'application/json',
                'MCP-Protocol-Version': negotiatedVersion,
                'Mcp-Session-Id':
                  request.headers.get('Mcp-Session-Id') ||
                  request.headers.get('X-Demo-Session-Id') ||
                  'maas-public-demo',
              },
            }
          );
        }

        // Protocol Negotiation: `notifications/initialized` and any JSON-RPC notification
        if (method === 'notifications/initialized' || method.startsWith('notifications/')) {
          if (!hasId) {
            return new Response(null, {
              status: 202,
              headers: {
                ...CORS_HEADERS,
                'MCP-Protocol-Version': '2025-06-18',
              },
            });
          }
          return new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: jsonRpcId,
              result: { ok: true },
            }),
            {
              status: 200,
              headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
            }
          );
        }

        // Standard MCP `ping`
        if (method === 'ping') {
          return new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: jsonRpcId,
              result: {},
            }),
            {
              status: 200,
              headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
            }
          );
        }

        // Standard MCP `prompts/list`
        if (method === 'prompts/list') {
          return new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: jsonRpcId,
              result: { prompts: [] },
            }),
            {
              status: 200,
              headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
            }
          );
        }

        // Standard MCP `resources/list` & `resources/read`
        if (method === 'resources/list') {
          const widgetResources = MCP_TOOLS_CATALOG.map((t) => ({
            uri: `ui://widget/${t.name}.html`,
            name: t.annotations.title,
            description: t.description,
            mimeType: 'text/html+skybridge',
          }));
          return new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: jsonRpcId,
              result: {
                resources: [
                  {
                    uri: 'ui://widget/paypal-billing-summary.html',
                    name: 'PayPal AI Billing Kit Summary Widget',
                    description:
                      'Interactive summary card for PayPal AI Billing Kit statements, guardrails, and sandbox status.',
                    mimeType: 'text/html+skybridge',
                  },
                  ...widgetResources,
                ],
              },
            }),
            {
              status: 200,
              headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
            }
          );
        }

        if (method === 'resources/read') {
          const uri = String(body?.params?.uri || 'ui://widget/paypal-billing-summary.html');
          return new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: jsonRpcId,
              result: {
                contents: [
                  {
                    uri,
                    mimeType: 'text/html+skybridge',
                    text: '<div style="font-family:sans-serif;padding:12px;border-radius:8px;background:#111827;color:#F9FAFB;"><strong>PayPal AI Billing Kit</strong> — Dedicated Sandbox Demo (Dr. Sarah Jenkins, Alex Rivera, Jordan Taylor)</div>',
                  },
                ],
              },
            }),
            {
              status: 200,
              headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
            }
          );
        }

        // Modern Protocol: `server/discover`
        if (method === 'server/discover') {
          const tools = formatStandardMcpTools(origin);
          return new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: jsonRpcId,
              result: {
                protocolVersion: '2026-07-28',
                supportedVersions: ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'],
                service: 'PayPal AI Billing Kit — MCP Agent Interface Server',
                version: '2.0.0',
                serverInfo: {
                  name: 'paypal-ai-billing-kit-mcp',
                  title: 'PayPal AI Billing Kit MCP',
                  version: '2.0.0',
                },
                capabilities: {
                  tools: { listChanged: true },
                  resources: { subscribe: false, listChanged: false },
                  prompts: { listChanged: false },
                },
                protocols: ['2026-07-28', '2025-06-18', '2025-03-26'],
                securitySchemes: tools[0]?.securitySchemes || [],
                tools,
                instructions:
                  'Standalone PayPal AI Billing Kit Unified MCP Server. Provides 26 billing tools (20 Native Application tools + 1 Official PayPal MCP Discovery tool + 5 PayPal Sandbox REST-backed tools) across read_only, proposal_only, and confirmed_demo_write permission tiers in isolated demo sessions.',
              },
            }),
            {
              status: 200,
              headers: {
                ...CORS_HEADERS,
                'Content-Type': 'application/json',
                'MCP-Protocol-Version': '2026-07-28',
              },
            }
          );
        }

        // Standard Protocol: `tools/list`
        if (method === 'tools/list') {
          return new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: jsonRpcId,
              result: {
                tools: formatStandardMcpTools(origin),
              },
            }),
            {
              status: 200,
              headers: {
                ...CORS_HEADERS,
                'Content-Type': 'application/json',
                'MCP-Protocol-Version': '2025-06-18',
              },
            }
          );
        }

        // Validate & Enforce Security Invariants on `tools/call` and direct REST tool invocations
        const isToolsCall = method === 'tools/call';
        const toolName = isToolsCall
          ? String(body?.params?.name || '').trim()
          : String(body?.tool || method || '').trim();
        const rawArgs = isToolsCall
          ? body?.params?.arguments || {}
          : body?.arguments || body?.params || {};
        const args: Record<string, any> =
          rawArgs && typeof rawArgs === 'object' ? { ...rawArgs } : {};

        const rawHeaderSession =
          request.headers.get('X-Demo-Session-Id') ||
          request.headers.get('Mcp-Session-Id') ||
          '';
        const rawArgSession = args.demo_session_id !== undefined ? String(args.demo_session_id) : '';

        // Invariant 1: Prevent cross-session manipulation via header vs. argument mismatch
        if (
          rawHeaderSession &&
          rawHeaderSession !== 'maas-public-demo' &&
          rawArgSession &&
          sanitizeSessionId(rawHeaderSession) !== sanitizeSessionId(rawArgSession)
        ) {
          const errPayload = {
            ok: false,
            error_code: 'CROSS_SESSION_ISOLATION_VIOLATION',
            message: `Cross-session access denied: session header "${sanitizeSessionId(
              rawHeaderSession
            )}" does not match tool argument demo_session_id "${sanitizeSessionId(rawArgSession)}".`,
          };
          return new Response(
            JSON.stringify(
              isToolsCall
                ? { jsonrpc: '2.0', id: jsonRpcId, result: buildMcpToolResult(errPayload, true) }
                : errPayload
            ),
            { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
          );
        }

        const activeSessionId = sanitizeSessionId(rawArgSession || rawHeaderSession || 'maas-public-demo');

        // Invariant 2: Canonical seed session (`canonical`) is strictly read-only and immutable
        if (
          MUTATING_TOOLS.has(toolName) &&
          (rawArgSession.trim().toLowerCase() === 'canonical' ||
            rawHeaderSession.trim().toLowerCase() === 'canonical')
        ) {
          const errPayload = {
            ok: false,
            error_code: 'CANONICAL_SESSION_IMMUTABLE',
            message:
              'The canonical seed session ("canonical") is read-only. Mutating tools must use an isolated visitor demo_session_id.',
          };
          return new Response(
            JSON.stringify(
              isToolsCall
                ? { jsonrpc: '2.0', id: jsonRpcId, result: buildMcpToolResult(errPayload, true) }
                : errPayload
            ),
            { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
          );
        }

        // Invariant 3: Block any caller-supplied approval/guardrail bypass flags
        const usedBypassKey = FORBIDDEN_BYPASS_KEYS.find((k) => Boolean(args[k]));
        if (usedBypassKey || args.status === 'approved' || args.guardrail_passed === true) {
          const errPayload = {
            ok: false,
            error_code: 'APPROVAL_BYPASS_PROHIBITED',
            message: `Security Guardrail Violation: Caller-supplied bypass flag "${
              usedBypassKey || 'status/guardrail_passed'
            }" is prohibited. All write actions must pass server-side guardrail and proposal verification.`,
          };
          return new Response(
            JSON.stringify(
              isToolsCall
                ? { jsonrpc: '2.0', id: jsonRpcId, result: buildMcpToolResult(errPayload, true) }
                : errPayload
            ),
            { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
          );
        }

        // Invariant 4: `create_approved_invoice`, `create_paypal_checkout_order`, and `execute_approved_refund`
        // require EITHER a valid session-bound `proposal_id` (with `explicit_human_approval: true`)
        // OR an explicit `user_instruction` evaluated by the server-side conversational authorization engine.
        if (
          toolName === 'create_approved_invoice' ||
          toolName === 'create_paypal_checkout_order' ||
          toolName === 'execute_approved_refund'
        ) {
          const suppliedProposalId = String(args.proposal_id || '').trim();
          const suppliedUserInstruction = String(args.user_instruction || '').trim();

          if (args.explicit_human_approval !== true && !suppliedUserInstruction) {
            const errPayload = {
              ok: false,
              error_code: 'HUMAN_APPROVAL_REQUIRED',
              message: `Executing \`${toolName}\` requires \`explicit_human_approval: true\` (or an explicit \`user_instruction\`).`,
            };
            return new Response(
              JSON.stringify(
                isToolsCall
                  ? { jsonrpc: '2.0', id: jsonRpcId, result: buildMcpToolResult(errPayload, true) }
                  : errPayload
              ),
              { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
            );
          }

          if (!suppliedProposalId && !suppliedUserInstruction) {
            const errPayload = {
              ok: false,
              error_code: 'PROPOSAL_REQUIRED_FOR_WRITE',
              message: `Direct execution of \`${toolName}\` without a prior proposal or explicit \`user_instruction\` is blocked. First call the corresponding proposal tool to obtain a session-bound \`proposal_id\`, or pass the user's explicit command in \`user_instruction\`.`,
            };
            return new Response(
              JSON.stringify(
                isToolsCall
                  ? { jsonrpc: '2.0', id: jsonRpcId, result: buildMcpToolResult(errPayload, true) }
                  : errPayload
              ),
              { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
            );
          }

          if (suppliedProposalId) {
            // Verify cryptographic session binding (`<uuid>.<sig16>`) or isolate cache
            let rawUuid = suppliedProposalId;
            let sigValid = false;

            if (suppliedProposalId.includes('.')) {
              const [uuidPart, sigPart] = suppliedProposalId.split('.');
              rawUuid = uuidPart;
              const expectedSig = await computeProposalSessionSig(
                activeSessionId,
                rawUuid,
                supabaseAnonKey
              );
              if (sigPart === expectedSig) {
                sigValid = true;
              } else {
                const errPayload = {
                  ok: false,
                  error_code: 'CROSS_SESSION_PROPOSAL_ACCESS_DENIED',
                  message: `Cross-session proposal execution denied: proposal "${suppliedProposalId}" does not belong to demo_session_id "${activeSessionId}".`,
                };
                return new Response(
                  JSON.stringify(
                    isToolsCall
                      ? {
                          jsonrpc: '2.0',
                          id: jsonRpcId,
                          result: buildMcpToolResult(errPayload, true),
                        }
                      : errPayload
                  ),
                  { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
                );
              }
            } else {
              const cachedOwner = proposalSessionCache.get(rawUuid);
              if (cachedOwner && cachedOwner === activeSessionId) {
                sigValid = true;
              } else {
                const errPayload = {
                  ok: false,
                  error_code: 'CROSS_SESSION_PROPOSAL_ACCESS_DENIED',
                  message: `Proposal "${suppliedProposalId}" is not bound to demo_session_id "${activeSessionId}". Obtain a session-bound proposal_id in the same session.`,
                };
                return new Response(
                  JSON.stringify(
                    isToolsCall
                      ? {
                          jsonrpc: '2.0',
                          id: jsonRpcId,
                          result: buildMcpToolResult(errPayload, true),
                        }
                      : errPayload
                  ),
                  { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
                );
              }
            }

            if (sigValid) {
              args.proposal_id = rawUuid;
            }
          }
        }

        // Ensure sanitized activeSessionId is forwarded
        args.demo_session_id = activeSessionId;
        const forwardBody = isToolsCall
          ? JSON.stringify({
              jsonrpc: '2.0',
              id: jsonRpcId,
              method: 'tools/call',
              params: {
                name: toolName,
                arguments: args,
              },
            })
          : JSON.stringify({
              ...body,
              arguments: args,
              demo_session_id: activeSessionId,
            });

        // Forward `tools/call` and other operations to Supabase Edge Function backend
        const supabaseEndpoint = `${supabaseUrl}/functions/v1/billing-maas-mcp`;
        try {
          const upstreamRes = await fetch(supabaseEndpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: supabaseAnonKey,
              Authorization: `Bearer ${supabaseAnonKey}`,
              'X-Demo-Session-Id': activeSessionId,
              'Mcp-Session-Id': activeSessionId,
            },
            body: forwardBody,
          });

          const rawUpstreamText = await upstreamRes.text();
          const upstreamText = rawUpstreamText
            .replace(/MaaS\s*&\s*MCP/gi, 'MCP Agent Interface')
            .replace(/MaaS\/MCP/gi, 'MCP')
            .replace(/Model-as-a-Service\s*\(MaaS\)\s*and\s*/gi, '')
            .replace(/Model-as-a-Service/gi, 'Model Context Protocol (MCP)')
            .replace(/Billing AI and MaaS agents/gi, 'Billing AI and MCP agents')
            .replace(/via MaaS/gi, 'via MCP')
            .replace(/MaaS Session/g, 'MCP Session')
            .replace(/MaaS Payment Proposal/g, 'MCP Payment Proposal')
            .replace(/MaaS Void Proposal/g, 'MCP Void Proposal')
            .replace(/MaaS Refund Proposal/g, 'MCP Refund Proposal');
          let upstreamJson: any = null;
          try {
            upstreamJson = JSON.parse(upstreamText);
          } catch {
            upstreamJson = null;
          }

          // Bind any newly created proposal.id to activeSessionId via HMAC signature
          const structured = upstreamJson?.result?.structuredContent || upstreamJson?.result;
          if (
            structured?.ok === true &&
            structured?.proposal?.id &&
            (toolName === 'create_invoice_proposal' ||
              toolName === 'prepare_payment_proposal' ||
              toolName === 'prepare_refund_proposal')
          ) {
            const rawPropId = String(structured.proposal.id);
            proposalSessionCache.set(rawPropId, activeSessionId);
            const sig = await computeProposalSessionSig(
              activeSessionId,
              rawPropId,
              supabaseAnonKey
            );
            const boundPropId = `${rawPropId}.${sig}`;
            structured.proposal.id = boundPropId;
            if (Array.isArray(upstreamJson?.result?.content)) {
              upstreamJson.result.content = [
                {
                  type: 'text',
                  text: JSON.stringify(structured, null, 2),
                },
              ];
            }
            return new Response(JSON.stringify(upstreamJson), {
              status: upstreamRes.status,
              headers: {
                ...CORS_HEADERS,
                'Content-Type': 'application/json',
                'MCP-Protocol-Version': '2025-06-18',
                'Mcp-Session-Id': activeSessionId,
              },
            });
          }

          return new Response(upstreamText, {
            status: upstreamRes.status,
            headers: {
              ...CORS_HEADERS,
              'Content-Type': upstreamRes.headers.get('Content-Type') || 'application/json',
              'MCP-Protocol-Version': '2025-06-18',
              'Mcp-Session-Id':
                upstreamRes.headers.get('Mcp-Session-Id') || activeSessionId,
            },
          });
        } catch (upstreamErr: any) {
          return new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: jsonRpcId,
              error: {
                code: -32603,
                message: `Gateway Internal Error: ${upstreamErr?.message || 'Upstream error'}`,
              },
            }),
            {
              status: 502,
              headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
            }
          );
        }
      }

      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32600,
            message: 'Method not allowed. Use GET for discovery or POST for MCP JSON-RPC 2.0.',
          },
        }),
        {
          status: 405,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        }
      );
    }

    // 11. Downloadable PDF Receipt Endpoint (`GET /api/receipts/:invoice_number.pdf`)
    const pdfMatch = url.pathname.match(/^\/api\/receipts\/([^/]+?)(?:\.pdf)?$/i);
    if (pdfMatch && (request.method === 'GET' || isHead)) {
      const invoiceNumber = decodeURIComponent(pdfMatch[1]).replace(/\.pdf$/i, '');
      const sessionParam = sanitizeSessionId(
        url.searchParams.get('session') ||
          url.searchParams.get('demo_session_id') ||
          request.headers.get('X-Demo-Session-Id') ||
          'maas-public-demo'
      );
      const supabaseEndpoint = `${supabaseUrl}/functions/v1/billing-maas-mcp`;
      const upstreamRes = await fetch(supabaseEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${supabaseAnonKey}`,
          'X-Demo-Session-Id': sessionParam,
          'Mcp-Session-Id': sessionParam,
        },
        body: JSON.stringify({
          tool: 'get_payment_receipt',
          demo_session_id: sessionParam,
          arguments: {
            invoice_number: invoiceNumber,
            demo_session_id: sessionParam,
          },
        }),
      });
      const data: any = await upstreamRes.json().catch(() => ({}));
      if (!data?.ok || !data?.receipt?.pdf_base64) {
        return new Response(JSON.stringify(data || { ok: false, error: 'Receipt not found' }), {
          status: 404,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }
      const binaryStr = atob(String(data.receipt.pdf_base64));
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      const downloadDisposition =
        url.searchParams.get('download') === '1' ? 'attachment' : 'inline';
      return new Response(isHead ? null : bytes, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/pdf',
          'Content-Length': String(bytes.byteLength),
          'Content-Disposition': `${downloadDisposition}; filename="Receipt-${data.receipt.invoice_number}.pdf"`,
        },
      });
    }

    // 12. REST Tool Execution Endpoints (`/api/tools/:toolName`)
    const toolMatch = url.pathname.match(/^\/api\/tools\/([a-zA-Z0-9_-]+)$/);
    if (toolMatch && request.method === 'POST') {
      const toolName = toolMatch[1];
      const bodyText = await request.text().catch(() => '');
      let args: any = {};
      try {
        args = bodyText ? JSON.parse(bodyText) : {};
      } catch {
        args = {};
      }

      // Route REST tool execution through the same MCP POST handler for identical security enforcement
      const mcpRequest = new Request(`${origin}/mcp`, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: toolName,
            arguments: args,
          },
        }),
      });
      return this.fetch(mcpRequest, env);
    }

    return new Response(
      JSON.stringify({
        error: 'not_found',
        message: `Endpoint ${url.pathname} not found on PayPal AI Billing Kit MCP Gateway.`,
      }),
      {
        status: 404,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      }
    );
  },
};

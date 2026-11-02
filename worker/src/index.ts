/**
 * Standalone PayPal AI Billing Kit — Dedicated Cloudflare Worker MaaS/MCP Gateway
 * File: worker/src/index.ts
 *
 * Dedicated, independent Model Context Protocol (MCP) and Model-as-a-Service (MaaS)
 * gateway for the PayPal AI Hackathon 2026.
 *
 * Supported Protocols & Standards:
 * - MCP JSON-RPC 2.0 (`POST /mcp` — dual protocol negotiation `2026-07-28` & `2025-06-18`)
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
 * - ZERO access to Health eRecords staging or production databases.
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
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Session-Id, X-Demo-Session-Id, X-Demo-Session-Token',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id, X-Demo-Session-Token',
  'Cache-Control': 'no-cache, no-store, must-revalidate',
};

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
      '[READ_ONLY] Discover all PayPal AI Billing Kit MaaS/MCP capabilities, guardrails ($500 single-action / $2,500 daily limits), demo personas, service catalog codes, and permission tiers.',
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
          description: 'Optional isolated visitor/agent demo session ID (default: maas-public-demo).',
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
          description: 'Demo session identifier (default: maas-public-demo).',
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
      '[CONFIRMED_WRITE] Execute an approved invoice creation within the isolated demo session. Requires a valid one-time proposal_id generated by create_invoice_proposal.',
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
      required: ['proposal_id'],
      properties: {
        proposal_id: {
          type: 'string',
          description: 'UUID of a pending create_invoice proposal to approve and execute.',
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
      required: ['invoice_number', 'reason'],
      properties: {
        invoice_number: {
          type: 'string',
          description: 'Invoice number to void.',
        },
        reason: {
          type: 'string',
          description: 'Administrative reason for voiding.',
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
];

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
      title: 'PayPal AI Billing Kit — Model-as-a-Service & MCP API',
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = env.CANONICAL_ISSUER || DEFAULT_ISSUER;
    const supabaseUrl = env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
    const supabaseAnonKey = env.SUPABASE_ANON_KEY || DEFAULT_ANON_KEY;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // 1. RFC 9728 OAuth Protected Resource Metadata
    if (url.pathname === '/.well-known/oauth-protected-resource') {
      return new Response(
        JSON.stringify({
          resource: `${origin}/mcp`,
          resource_documentation: `${origin}/docs/mcp`,
          authorization_servers: [origin],
          scopes_supported: ['billing:read', 'billing:write', 'billing:proposal'],
          bearer_methods_supported: ['header'],
        }),
        {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        }
      );
    }

    // 2. RFC 8414 Authorization Server Discovery
    if (
      url.pathname === '/.well-known/oauth-authorization-server' ||
      url.pathname === '/.well-known/openid-configuration'
    ) {
      return new Response(
        JSON.stringify({
          issuer: origin,
          authorization_endpoint: `${origin}/oauth/authorize`,
          token_endpoint: `${origin}/oauth/token`,
          registration_endpoint: `${origin}/oauth/register`,
          jwks_uri: `${origin}/.well-known/jwks.json`,
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
          scopes_supported: ['billing:read', 'billing:write', 'billing:proposal'],
        }),
        {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        }
      );
    }

    // 3. Public JWKS
    if (url.pathname === '/.well-known/jwks.json') {
      return new Response(
        JSON.stringify({
          keys: [DEMO_JWK],
        }),
        {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        }
      );
    }

    // 4. OpenAPI 3.1.0 Specification
    if (
      url.pathname === '/api/openapi.json' ||
      url.pathname === '/openapi.json' ||
      (url.pathname === '/api/mcp' && url.searchParams.get('format') === 'openapi') ||
      (url.pathname === '/mcp' && url.searchParams.get('format') === 'openapi')
    ) {
      return new Response(JSON.stringify(buildOpenApiSpec(origin), null, 2), {
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
            ],
            grant_types: ['authorization_code'],
            response_types: ['code'],
            token_endpoint_auth_method: 'none',
          }),
          {
            status: 201,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          }
        );
      } catch (err: any) {
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

    // 7. OAuth Token Endpoint
    if (url.pathname === '/oauth/token' && request.method === 'POST') {
      const demoToken = `ppb-demo-at-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      return new Response(
        JSON.stringify({
          access_token: demoToken,
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

    // 8. Documentation Endpoint (`/docs/mcp`)
    if (url.pathname === '/docs/mcp' || url.pathname === '/docs/mcp/') {
      if (
        request.headers.get('accept')?.includes('application/json') ||
        url.searchParams.get('format') === 'json'
      ) {
        return new Response(
          JSON.stringify(
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
          ),
          {
            status: 200,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          }
        );
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
    <h1>⚡ PayPal AI Billing Kit — MCP & MaaS Gateway</h1>
    <p class="subtitle">Dedicated Cloudflare Worker Gateway for PayPal AI Hackathon 2026</p>
    <div style="margin-bottom: 20px;">
      <span class="badge">15 MCP Tools</span>
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

    <h2>Available Tools Catalog (15 Total)</h2>
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

      return new Response(html, {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // 9. Root Landing Page
    if (url.pathname === '/' || url.pathname === '') {
      return new Response(
        JSON.stringify(
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
        ),
        {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        }
      );
    }

    // 10. MCP Transport Gateway (`/mcp` and `/api/mcp`)
    if (url.pathname === '/mcp' || url.pathname === '/api/mcp') {
      // GET /mcp returns discovery metadata
      if (request.method === 'GET') {
        return new Response(
          JSON.stringify(
            {
              ok: true,
              service: 'PayPal AI Billing Kit — MaaS & MCP Server',
              version: '2.0.0',
              protocol_support: [
                'MCP JSON-RPC 2.0 (2025-03-26)',
                'MCP 2026-07-28 stateless server/discover',
                'MCP 2025-06-18 initialize',
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
          ),
          {
            status: 200,
            headers: {
              ...CORS_HEADERS,
              'Content-Type': 'application/json',
              'Mcp-Session-Id': 'maas-public-demo',
            },
          }
        );
      }

      if (request.method === 'POST') {
        const bodyText = await request.text().catch(() => '');
        let body: any = {};
        try {
          body = bodyText ? JSON.parse(bodyText) : {};
        } catch {
          body = {};
        }

        const method = String(body?.method || body?.tool || '').trim();
        const jsonRpcId = body?.id ?? 1;

        // Protocol Negotiation: `initialize`
        if (method === 'initialize') {
          const clientProtocol = String(body?.params?.protocolVersion || '2024-11-05');
          return new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: jsonRpcId,
              result: {
                protocolVersion: clientProtocol,
                capabilities: {
                  tools: { listChanged: false },
                  logging: {},
                },
                serverInfo: {
                  name: 'paypal-ai-billing-kit-maas',
                  version: '2.0.0',
                },
              },
            }),
            {
              status: 200,
              headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
            }
          );
        }

        // Protocol Negotiation: `notifications/initialized`
        if (method === 'notifications/initialized') {
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

        // Modern Protocol: `server/discover`
        if (method === 'server/discover') {
          return new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: jsonRpcId,
              result: {
                service: 'PayPal AI Billing Kit — MaaS & MCP Server',
                version: '2.0.0',
                protocols: ['2026-07-28', '2025-06-18'],
                tools: MCP_TOOLS_CATALOG,
              },
            }),
            {
              status: 200,
              headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
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
                tools: MCP_TOOLS_CATALOG,
              },
            }),
            {
              status: 200,
              headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
            }
          );
        }

        // Forward `tools/call` and other operations to Supabase Edge Function backend
        const supabaseEndpoint = `${supabaseUrl}/functions/v1/billing-maas-mcp`;
        try {
          const upstreamRes = await fetch(supabaseEndpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: supabaseAnonKey,
              Authorization: `Bearer ${supabaseAnonKey}`,
              'X-Demo-Session-Id': request.headers.get('X-Demo-Session-Id') || 'maas-public-demo',
              'Mcp-Session-Id': request.headers.get('Mcp-Session-Id') || 'maas-public-demo',
            },
            body: bodyText,
          });

          const upstreamBody = await upstreamRes.text();
          return new Response(upstreamBody, {
            status: upstreamRes.status,
            headers: {
              ...CORS_HEADERS,
              'Content-Type': upstreamRes.headers.get('Content-Type') || 'application/json',
              'Mcp-Session-Id':
                upstreamRes.headers.get('Mcp-Session-Id') || 'maas-public-demo',
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

    // 11. REST Tool Execution Endpoints (`/api/tools/:toolName`)
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

      const mcpPayload = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: args,
        },
      };

      const supabaseEndpoint = `${supabaseUrl}/functions/v1/billing-maas-mcp`;
      try {
        const upstreamRes = await fetch(supabaseEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: supabaseAnonKey,
            Authorization: `Bearer ${supabaseAnonKey}`,
            'X-Demo-Session-Id': request.headers.get('X-Demo-Session-Id') || 'maas-public-demo',
          },
          body: JSON.stringify(mcpPayload),
        });

        const upstreamBody = await upstreamRes.text();
        return new Response(upstreamBody, {
          status: upstreamRes.status,
          headers: {
            ...CORS_HEADERS,
            'Content-Type': 'application/json',
          },
        });
      } catch (err: any) {
        return new Response(
          JSON.stringify({ ok: false, error: err?.message || 'Tool execution error' }),
          {
            status: 502,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          }
        );
      }
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

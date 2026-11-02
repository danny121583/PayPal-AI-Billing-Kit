import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, accept, mcp-session-id, x-demo-session-id',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Expose-Headers': 'mcp-session-id',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const PAYPAL_CLIENT_ID =
  Deno.env.get('PAYPAL_SANDBOX_CLIENT_ID') || Deno.env.get('PAYPAL_CLIENT_ID') || '';
const PAYPAL_CLIENT_SECRET =
  Deno.env.get('PAYPAL_SANDBOX_CLIENT_SECRET') || Deno.env.get('PAYPAL_CLIENT_SECRET') || '';

const PROVIDER_ID = '11111111-1111-4111-8111-111111111101';
const ALEX_ID = '11111111-1111-4111-8111-111111111102';
const JORDAN_ID = '11111111-1111-4111-8111-111111111103';
const ORG_ID = '22222222-2222-4222-8222-222222222201';

const DEMO_ACCOUNTS = [
  {
    key: 'sarah_jenkins',
    id: PROVIDER_ID,
    role: 'provider',
    roleScope: 'doctor',
    fullName: 'Dr. Sarah Jenkins',
    emailMasked: 's***@demo.paypal-billing-kit.local',
    organizationName: 'Jenkins Wellness & Telehealth Practice',
  },
  {
    key: 'alex_rivera',
    id: ALEX_ID,
    role: 'customer',
    roleScope: 'patient',
    fullName: 'Alex Rivera',
    emailMasked: 'a***@demo.paypal-billing-kit.local',
    organizationName: 'Jenkins Wellness & Telehealth Practice',
  },
  {
    key: 'jordan_taylor',
    id: JORDAN_ID,
    role: 'customer',
    roleScope: 'patient',
    fullName: 'Jordan Taylor',
    emailMasked: 'j***@demo.paypal-billing-kit.local',
    organizationName: 'Jenkins Wellness & Telehealth Practice',
  },
];

function formatUsd(minor: number): string {
  return `$${(Number(minor || 0) / 100).toFixed(2)}`;
}

function sanitizeDemoSessionId(raw?: unknown): string {
  const val = String(raw || '').trim();
  if (!val) return 'maas-public-demo';
  const cleaned = val.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  return cleaned || 'maas-public-demo';
}

interface MCPToolDef {
  name: string;
  description: string;
  permissionTier: 'read_only' | 'proposal_only' | 'confirmed_demo_write';
  annotations: {
    title: string;
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
  inputSchema: Record<string, unknown>;
}

const MCP_TOOLS: MCPToolDef[] = [
  {
    name: 'discover_billing_capabilities',
    description:
      'Discover all PayPal AI Billing Kit MaaS/MCP capabilities, guardrails ($500 single-action / $2,500 daily limits), demo personas, service catalog codes, and permission tiers.',
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
      'List fictional Provider and Customer demo accounts (Dr. Sarah Jenkins, Alex Rivera, Jordan Taylor) and their active billing authorization status.',
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
      'Search and filter billing statements by status (sent, overdue, paid, draft, void, refunded), customer name/ID, or query text within an isolated demo session.',
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
        customer_name: {
          type: 'string',
          description: 'Optional customer name filter (e.g., "Alex Rivera" or "Jordan Taylor").',
        },
        demo_session_id: {
          type: 'string',
          description: 'Isolated demo session identifier.',
        },
      },
    },
  },
  {
    name: 'get_invoice_details',
    description:
      'Retrieve comprehensive line items, service dates, issued/due/paid timestamps, original vs. remaining balance, payment attempts, settlement verification status, and a natural-language explanation for a specific invoice (by invoice_number like PPB-INV-2026-1003 or UUID).',
    permissionTier: 'read_only',
    annotations: {
      title: 'Get Invoice Details & Explanation',
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
          description: 'Invoice number (e.g., "PPB-INV-2026-1003" or "1003").',
        },
        invoice_id: {
          type: 'string',
          description: 'Invoice UUID if known.',
        },
        demo_session_id: {
          type: 'string',
          description: 'Isolated demo session identifier.',
        },
      },
    },
  },
  {
    name: 'create_invoice_proposal',
    description:
      'Prepare a human-in-the-loop administrative invoice proposal for an authorized customer (Alex Rivera or Jordan Taylor). Enforces the $500.00 single-action and $2,500.00 daily Billing AI guardrails and stores a pending proposal card.',
    permissionTier: 'proposal_only',
    annotations: {
      title: 'Create Invoice Proposal (Guardrail-Checked)',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      required: ['customer_name', 'service_code'],
      properties: {
        customer_name: {
          type: 'string',
          description: 'Authorized customer name ("Alex Rivera" or "Jordan Taylor").',
        },
        service_code: {
          type: 'string',
          description:
            'Catalog service code (ADMIN-TELEHEALTH, ADMIN-FOLLOWUP, ADMIN-OFFICE, ADMIN-FORMS, ADMIN-RECORDS, ADMIN-COPAY, ADMIN-CAREPLAN, ADMIN-PRIORAUTH).',
        },
        amount_minor: {
          type: 'integer',
          description: 'Amount in USD cents (e.g. 3500 for $35.00). Max 50000 ($500.00) for AI proposals.',
        },
        due_date: {
          type: 'string',
          description: 'Optional ISO due date (YYYY-MM-DD). Defaults to 14 days from today.',
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
      'Execute an approved invoice creation within the isolated demo session. Either provide a pending `proposal_id` or pass customer_name, service_code, amount_minor, and `explicit_human_approval: true`.',
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
          description: 'UUID of a pending create_invoice proposal to approve and execute.',
        },
        customer_name: {
          type: 'string',
          description: 'Authorized customer name ("Alex Rivera" or "Jordan Taylor") if creating directly.',
        },
        service_code: {
          type: 'string',
          description: 'Service code (e.g., ADMIN-FORMS, ADMIN-TELEHEALTH).',
        },
        amount_minor: {
          type: 'integer',
          description: 'Unit amount in USD cents (e.g., 3500 for $35.00). Max 50000 ($500.00).',
        },
        send_immediately: {
          type: 'boolean',
          description: 'Whether to mark the invoice as sent immediately (default: true).',
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
      'Explain outstanding balances, overdue statements, and upcoming due dates for the Provider practice or for a specific Customer (Alex Rivera or Jordan Taylor).',
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
          description: 'Optional customer name ("Alex Rivera" or "Jordan Taylor") to scope the balance explanation.',
        },
        demo_session_id: {
          type: 'string',
          description: 'Isolated demo session identifier.',
        },
      },
    },
  },
  {
    name: 'get_transaction_history',
    description:
      'Retrieve recorded settlements, refunds, and payment attempts (including failed attempts and failure diagnostics), clearly distinguishing seeded sample demo records from live PayPal Sandbox captures.',
    permissionTier: 'read_only',
    annotations: {
      title: 'Get Transaction & Payment Attempt History',
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
          description: 'Isolated demo session identifier.',
        },
      },
    },
  },
  {
    name: 'prepare_payment_proposal',
    description:
      'Prepare a customer payment checkout proposal for an unpaid invoice. Never charges funds autonomously; returns the 5-stage PayPal Sandbox human authorization workflow and creates a pending payment_checkout proposal.',
    permissionTier: 'proposal_only',
    annotations: {
      title: 'Prepare Customer Payment Proposal',
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
          description: 'Unpaid invoice number (e.g., "PPB-INV-2026-1001" or "PPB-INV-2026-1002").',
        },
        demo_session_id: {
          type: 'string',
          description: 'Isolated demo session identifier.',
        },
      },
    },
  },
  {
    name: 'void_unpaid_invoice',
    description:
      'Void an eligible unpaid (draft, sent, or overdue) invoice in the isolated demo session. Enforces Payment-State Protection: paid or refunded invoices are strictly blocked from voiding.',
    permissionTier: 'confirmed_demo_write',
    annotations: {
      title: 'Void Eligible Unpaid Invoice',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      required: ['invoice_number'],
      properties: {
        invoice_number: {
          type: 'string',
          description: 'Invoice number to void (e.g., "PPB-INV-2026-1005" or a newly created session invoice).',
        },
        explicit_human_approval: {
          type: 'boolean',
          description: 'Set true to execute the void immediately in the demo session; if false/omitted, creates a pending void_invoice proposal.',
        },
        reason: {
          type: 'string',
          description: 'Optional administrative reason for voiding.',
        },
        demo_session_id: {
          type: 'string',
          description: 'Isolated demo session identifier.',
        },
      },
    },
  },
  {
    name: 'prepare_refund_proposal',
    description:
      'Prepare a provider refund proposal for a paid invoice (e.g., #PPB-INV-2026-1003). Validates that the invoice has captured funds before creating the refund proposal.',
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
      required: ['invoice_number'],
      properties: {
        invoice_number: {
          type: 'string',
          description: 'Paid invoice number (e.g., "PPB-INV-2026-1003").',
        },
        amount_minor: {
          type: 'integer',
          description: 'Optional partial refund amount in USD cents (defaults to full paid balance).',
        },
        reason: {
          type: 'string',
          description: 'Administrative refund reason.',
        },
        demo_session_id: {
          type: 'string',
          description: 'Isolated demo session identifier.',
        },
      },
    },
  },
  {
    name: 'get_financial_audit_history',
    description:
      'Read the immutable, append-only financial audit trail (billing_audit_events) showing invoice creations, voids, AI proposals, guardrail checks, and settlements.',
    permissionTier: 'read_only',
    annotations: {
      title: 'Get Financial Audit History',
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
          description: 'Max audit events to return (1-50, default 20).',
        },
        demo_session_id: {
          type: 'string',
          description: 'Isolated demo session identifier.',
        },
      },
    },
  },
  {
    name: 'get_paypal_sandbox_status',
    description:
      'Check PayPal Sandbox merchant and payer connection status, sandbox environment enforcement, and whether live PayPal Sandbox REST API credentials are configured on the server.',
    permissionTier: 'read_only',
    annotations: {
      title: 'Get PayPal Sandbox Connection Status',
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
      'Calculate comprehensive Provider practice and Customer KPI metrics (outstanding balance, pending, overdue, paid total, refunded total, failed attempts, and collection rate) for the demo session.',
    permissionTier: 'read_only',
    annotations: {
      title: 'Get Business & Practice Billing Metrics',
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
          description: 'Isolated demo session identifier.',
        },
      },
    },
  },
  {
    name: 'reset_demo_session',
    description:
      'Reset an isolated demo session (`demo_session_id`), clearing session-specific test invoices, proposals, and overrides while restoring the 6 canonical seed statements (#PPB-INV-2026-1001 through #PPB-INV-2026-1006).',
    permissionTier: 'confirmed_demo_write',
    annotations: {
      title: 'Reset Isolated Demo Session',
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
          description: 'Isolated demo session identifier to reset (default: maas-public-demo).',
        },
      },
    },
  },
];

async function fetchSessionInvoices(admin: any, demoSessionId: string) {
  const [invRes, itemsRes, attemptsRes, txRes, overridesRes] = await Promise.all([
    admin
      .from('billing_invoices')
      .select('*')
      .in('demo_session_id', ['canonical', demoSessionId])
      .order('created_at', { ascending: false }),
    admin.from('billing_invoice_items').select('*').order('position', { ascending: true }),
    admin.from('billing_payment_attempts').select('*').order('created_at', { ascending: false }),
    admin.from('billing_transactions').select('*').order('captured_at', { ascending: false }),
    demoSessionId !== 'canonical'
      ? admin
          .from('billing_demo_session_overrides')
          .select('*')
          .eq('demo_session_id', demoSessionId)
      : Promise.resolve({ data: [] }),
  ]);

  const rawInvoices = Array.isArray(invRes?.data) ? invRes.data : [];
  const items = Array.isArray(itemsRes?.data) ? itemsRes.data : [];
  const attempts = Array.isArray(attemptsRes?.data) ? attemptsRes.data : [];
  const txs = Array.isArray(txRes?.data) ? txRes.data : [];
  const overrides = Array.isArray(overridesRes?.data) ? overridesRes.data : [];
  const overrideMap = new Map<string, any>();
  for (const ov of overrides) {
    overrideMap.set(String(ov.invoice_id), ov);
  }

  const nameById: Record<string, string> = {
    [PROVIDER_ID]: 'Dr. Sarah Jenkins',
    [ALEX_ID]: 'Alex Rivera',
    [JORDAN_ID]: 'Jordan Taylor',
  };

  return rawInvoices.map((raw: any) => {
    const ov = overrideMap.get(String(raw.id));
    const status = String(ov?.status ?? raw.status ?? 'sent');
    const amountPaidMinor = Number(ov?.amount_paid_minor ?? raw.amount_paid_minor ?? 0);
    const amountRefundedMinor = Number(
      ov?.amount_refunded_minor ?? raw.amount_refunded_minor ?? 0
    );
    const balanceDueMinor =
      status === 'void' || status === 'refunded' || status === 'paid'
        ? 0
        : Number(
            ov?.balance_due_minor ??
              raw.balance_due_minor ??
              Math.max(Number(raw.total_minor || 0) - amountPaidMinor, 0)
          );

    const invItems = items
      .filter((it: any) => it.invoice_id === raw.id)
      .map((it: any) => ({
        service_code: String(it.service_code),
        description: String(it.description),
        quantity: Number(it.quantity || 1),
        unit_amount_minor: Number(it.unit_amount_minor || 0),
        unit_amount_usd: formatUsd(Number(it.unit_amount_minor || 0)),
        line_total_minor: Number(
          it.line_total_minor ?? Number(it.quantity || 1) * Number(it.unit_amount_minor || 0)
        ),
        line_total_usd: formatUsd(
          Number(
            it.line_total_minor ?? Number(it.quantity || 1) * Number(it.unit_amount_minor || 0)
          )
        ),
      }));

    const invAttempts = attempts
      .filter((at: any) => at.invoice_id === raw.id)
      .map((at: any) => ({
        id: String(at.id),
        status: String(at.status),
        amount_minor: Number(at.amount_minor || 0),
        amount_usd: formatUsd(Number(at.amount_minor || 0)),
        paypal_order_id: at.paypal_order_id ? String(at.paypal_order_id) : null,
        failure_code: at.failure_code ? String(at.failure_code) : null,
        failure_message: at.failure_message ? String(at.failure_message) : null,
        created_at: String(at.created_at),
      }));

    const matchingTx = txs.find((t: any) => t.invoice_id === raw.id);
    const dueStr = String(raw.due_date || '');
    const isOverdue =
      status === 'sent' &&
      dueStr &&
      new Date(`${dueStr}T23:59:59Z`).getTime() < Date.now();
    const effectiveStatus = isOverdue ? 'overdue' : status;

    const verifiedVia = ov?.paid_at
      ? 'seed_demo'
      : matchingTx?.verified_via
        ? String(matchingTx.verified_via)
        : null;
    const captureId =
      ov?.paid_at && !matchingTx
        ? `DEMO-SIM-${raw.invoice_number}`
        : matchingTx?.paypal_capture_id
          ? String(matchingTx.paypal_capture_id)
          : null;

    return {
      id: String(raw.id),
      invoice_number: String(raw.invoice_number),
      demo_session_id: String(raw.demo_session_id || 'canonical'),
      has_session_override: Boolean(ov),
      status: effectiveStatus,
      raw_db_status: status,
      provider_name: nameById[String(raw.issuer_user_id)] || 'Dr. Sarah Jenkins',
      customer_id: String(raw.recipient_user_id),
      customer_name: nameById[String(raw.recipient_user_id)] || 'Authorized Customer',
      currency: 'USD',
      total_minor: Number(raw.total_minor || 0),
      total_usd: formatUsd(Number(raw.total_minor || 0)),
      amount_paid_minor: amountPaidMinor,
      amount_paid_usd: formatUsd(amountPaidMinor),
      amount_refunded_minor: amountRefundedMinor,
      amount_refunded_usd: formatUsd(amountRefundedMinor),
      balance_due_minor: balanceDueMinor,
      balance_due_usd: formatUsd(balanceDueMinor),
      service_date: String(raw.sent_at || raw.created_at).slice(0, 10),
      issued_at: String(raw.sent_at || raw.created_at),
      due_date: dueStr,
      paid_at: ov?.paid_at || raw.paid_at || null,
      voided_at: ov?.voided_at || raw.voided_at || null,
      refunded_at: ov?.refunded_at || raw.refunded_at || null,
      settlement_verification:
        verifiedVia === 'capture_api' ||
        verifiedVia === 'order_lookup' ||
        verifiedVia === 'webhook'
          ? 'paypal_sandbox_verified'
          : verifiedVia === 'seed_demo'
            ? 'sample_demo_settlement_not_live_paypal'
            : 'unsettled',
      settlement_reference: captureId,
      line_items: invItems,
      payment_attempts: invAttempts,
    };
  });
}

async function executeTool(
  admin: any,
  toolName: string,
  args: Record<string, any>,
  defaultSessionId: string
): Promise<Record<string, any>> {
  const demoSessionId = sanitizeDemoSessionId(args?.demo_session_id || defaultSessionId);

  switch (toolName) {
    case 'discover_billing_capabilities': {
      const { data: catalog } = await admin
        .from('billing_service_catalog')
        .select('code, title, description, default_amount_minor, currency')
        .eq('active', true)
        .order('code', { ascending: true });

      return {
        ok: true,
        service: 'PayPal AI Billing Kit — MaaS & MCP Server',
        version: '2.0.0',
        protocol_support: ['MCP JSON-RPC 2.0 (2025-03-26)', 'REST JSON POST/GET', 'OpenAPI 3.1.0'],
        demo_session_id: demoSessionId,
        guardrails: {
          max_single_action_minor: 50000,
          max_single_action_usd: '$500.00',
          daily_limit_minor: 250000,
          daily_limit_usd: '$2,500.00',
          require_human_approval: true,
          paypal_buyer_authorization_required: true,
          payment_state_protection:
            'Paid and refunded invoices cannot be voided; returning captured funds requires a refund proposal.',
          privacy_boundary:
            'Strictly isolated to administrative billing statements; sensitive clinical/medical notes are refused.',
        },
        permission_tiers: {
          read_only: [
            'discover_billing_capabilities',
            'list_demo_customers',
            'search_invoices',
            'get_invoice_details',
            'explain_outstanding_balances',
            'get_transaction_history',
            'get_financial_audit_history',
            'get_paypal_sandbox_status',
            'get_business_metrics',
          ],
          proposal_only: [
            'create_invoice_proposal',
            'prepare_payment_proposal',
            'prepare_refund_proposal',
          ],
          confirmed_demo_write: [
            'create_approved_invoice',
            'void_unpaid_invoice',
            'reset_demo_session',
          ],
        },
        demo_personas: DEMO_ACCOUNTS,
        service_catalog: (catalog || []).map((c: any) => ({
          ...c,
          default_amount_usd: formatUsd(Number(c.default_amount_minor || 0)),
        })),
        tools_count: MCP_TOOLS.length,
        tools: MCP_TOOLS.map((t) => ({
          name: t.name,
          permission_tier: t.permissionTier,
          description: t.description,
        })),
      };
    }

    case 'list_demo_customers': {
      return {
        ok: true,
        organization: {
          id: ORG_ID,
          name: 'Jenkins Wellness & Telehealth Practice',
          provider: DEMO_ACCOUNTS[0],
        },
        authorized_customers: DEMO_ACCOUNTS.slice(1).map((c) => ({
          ...c,
          authorization_status: 'active',
          Relationship: 'Authorized Customer of Dr. Sarah Jenkins',
        })),
      };
    }

    case 'search_invoices': {
      const invoices = await fetchSessionInvoices(admin, demoSessionId);
      const q = String(args?.query || '').trim().toLowerCase();
      const statusFilter = String(args?.status || 'all').trim().toLowerCase();
      const custFilter = String(args?.customer_name || '').trim().toLowerCase();

      const filtered = invoices.filter((inv: any) => {
        if (statusFilter && statusFilter !== 'all' && inv.status.toLowerCase() !== statusFilter) {
          return false;
        }
        if (custFilter && !inv.customer_name.toLowerCase().includes(custFilter)) {
          return false;
        }
        if (q) {
          const hay = [
            inv.invoice_number,
            inv.customer_name,
            inv.status,
            ...inv.line_items.map((li: any) => `${li.service_code} ${li.description}`),
          ]
            .join(' ')
            .toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });

      return {
        ok: true,
        demo_session_id: demoSessionId,
        count: filtered.length,
        invoices: filtered,
      };
    }

    case 'get_invoice_details': {
      const invoices = await fetchSessionInvoices(admin, demoSessionId);
      const rawNum = String(args?.invoice_number || '').trim().replace(/^#/, '');
      const rawId = String(args?.invoice_id || '').trim();

      const found = invoices.find((inv: any) => {
        if (rawId && inv.id === rawId) return true;
        if (rawNum) {
          return (
            inv.invoice_number.toLowerCase() === rawNum.toLowerCase() ||
            inv.invoice_number.toLowerCase().endsWith(rawNum.toLowerCase())
          );
        }
        return false;
      });

      if (!found) {
        return {
          ok: false,
          error_code: 'INVOICE_NOT_FOUND',
          message: `Invoice ${rawNum || rawId || '(unspecified)'} was not found in demo session "${demoSessionId}".`,
          available_invoices: invoices.map((i: any) => i.invoice_number),
        };
      }

      const itemLines = found.line_items.map(
        (li: any) => `${li.service_code}: ${li.description} (Qty ${li.quantity} × ${li.unit_amount_usd} = ${li.line_total_usd})`
      );

      return {
        ok: true,
        demo_session_id: demoSessionId,
        invoice: found,
        explanation: [
          `Statement #${found.invoice_number} (${found.status.toUpperCase()})`,
          `Provider: ${found.provider_name} • Customer: ${found.customer_name}`,
          `What this invoice is for: ${itemLines.join('; ') || 'Administrative billing service'}`,
          `When services were provided / statement issued: ${found.service_date} (Due: ${found.due_date}${
            found.paid_at ? `, Paid: ${String(found.paid_at).slice(0, 10)}` : ''
          })`,
          `Financial Summary: Original Total ${found.total_usd} USD • Paid ${found.amount_paid_usd} USD • Refunded ${found.amount_refunded_usd} USD • Remaining Balance Due ${found.balance_due_usd} USD`,
          found.settlement_reference
            ? `Settlement Reference: ${found.settlement_reference} (${found.settlement_verification})`
            : 'Settlement Status: Unsettled',
        ].join('\n'),
      };
    }

    case 'create_invoice_proposal': {
      const custName = String(args?.customer_name || '').trim();
      const targetCustomer = DEMO_ACCOUNTS.slice(1).find((c) =>
        c.fullName.toLowerCase().includes(custName.toLowerCase())
      );
      if (!targetCustomer) {
        return {
          ok: false,
          error_code: 'RECIPIENT_NOT_AUTHORIZED',
          message: `Customer "${custName}" is not an authorized demo customer. Authorized customers are: Alex Rivera, Jordan Taylor.`,
        };
      }

      const { data: catalog } = await admin
        .from('billing_service_catalog')
        .select('*')
        .eq('active', true);
      const code = String(args?.service_code || 'ADMIN-TELEHEALTH').trim().toUpperCase();
      const service =
        (catalog || []).find((c: any) => String(c.code).toUpperCase() === code) ||
        (catalog || [])[0] || {
          code: 'ADMIN-TELEHEALTH',
          title: 'Administrative Telehealth Consultation',
          description: 'Administrative telehealth scheduling and consultation fee',
          default_amount_minor: 15000,
        };

      const amountMinor = Number(args?.amount_minor ?? service.default_amount_minor ?? 15000);
      if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
        return {
          ok: false,
          error_code: 'INVALID_AMOUNT',
          message: 'amount_minor must be a positive integer in USD cents.',
        };
      }

      if (amountMinor > 50000) {
        return {
          ok: false,
          error_code: 'GUARDRAIL_SINGLE_ACTION_LIMIT_EXCEEDED',
          message: `Guardrail Blocked: Requested amount ${formatUsd(
            amountMinor
          )} exceeds the $500.00 (50000 cents) maximum single AI-assisted action limit.`,
          guardrail: {
            max_single_action_minor: 50000,
            requested_amount_minor: amountMinor,
          },
        };
      }

      const dueDate =
        args?.due_date && /^\d{4}-\d{2}-\d{2}$/.test(String(args.due_date))
          ? String(args.due_date)
          : new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);

      const { data: sess } = await admin
        .from('billing_ai_sessions')
        .insert({
          user_id: PROVIDER_ID,
          organization_id: ORG_ID,
          role_scope: 'doctor',
          title: `MaaS Session (${demoSessionId})`,
          demo_session_id: demoSessionId,
        })
        .select('id')
        .single();

      const payload = {
        action: 'create_invoice',
        title: `Send ${formatUsd(amountMinor)} Administrative Invoice`,
        summary: `Customer: ${targetCustomer.fullName} • Service: ${service.description} (${service.code}) • Amount: ${formatUsd(
          amountMinor
        )} USD • Due: ${dueDate}`,
        recipient_user_id: targetCustomer.id,
        recipient_name: targetCustomer.fullName,
        service_code: service.code,
        service_title: service.description,
        quantity: 1,
        unit_amount_minor: amountMinor,
        due_date: dueDate,
        send_immediately: true,
        demo_session_id: demoSessionId,
        expires_at: new Date(Date.now() + 30 * 60000).toISOString(),
      };

      const { data: prop, error: propErr } = await admin
        .from('billing_ai_proposals')
        .insert({
          session_id: sess?.id,
          user_id: PROVIDER_ID,
          kind: 'create_invoice',
          status: 'pending',
          amount_minor: amountMinor,
          currency: 'USD',
          guardrail_result: { ok: true, max_single_action_minor: 50000, daily_limit_minor: 250000 },
          payload,
          demo_session_id: demoSessionId,
        })
        .select('*')
        .single();

      if (propErr) {
        return {
          ok: false,
          error_code: 'PROPOSAL_CREATE_FAILED',
          message: propErr.message,
        };
      }

      return {
        ok: true,
        demo_session_id: demoSessionId,
        requires_human_approval: true,
        next_step:
          'Call `create_approved_invoice` with `proposal_id` and `explicit_human_approval: true` to issue this invoice in the demo session.',
        proposal: {
          id: prop.id,
          kind: prop.kind,
          status: prop.status,
          amount_minor: prop.amount_minor,
          amount_usd: formatUsd(prop.amount_minor),
          customer_name: targetCustomer.fullName,
          service_code: service.code,
          due_date: dueDate,
          payload,
        },
      };
    }

    case 'create_approved_invoice': {
      if (args?.explicit_human_approval !== true && !args?.proposal_id) {
        return {
          ok: false,
          error_code: 'HUMAN_APPROVAL_REQUIRED',
          message:
            'Creating an invoice requires either a valid `proposal_id` or `explicit_human_approval: true`.',
        };
      }

      let recipientId = '';
      let recipientName = '';
      let serviceCode = 'ADMIN-TELEHEALTH';
      let amountMinor = 15000;
      let dueDate = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
      let sendImmediately = args?.send_immediately ?? true;
      let proposalId: string | null = null;

      if (args?.proposal_id) {
        const { data: prop } = await admin
          .from('billing_ai_proposals')
          .select('*')
          .eq('id', String(args.proposal_id))
          .maybeSingle();

        if (!prop) {
          return {
            ok: false,
            error_code: 'PROPOSAL_NOT_FOUND',
            message: `Proposal ${args.proposal_id} was not found.`,
          };
        }
        if (prop.status === 'executed') {
          return {
            ok: false,
            error_code: 'DUPLICATE_APPROVAL_BLOCKED',
            message: `Proposal ${args.proposal_id} has already been executed.`,
          };
        }
        proposalId = String(prop.id);
        recipientId = String(prop.payload?.recipient_user_id || ALEX_ID);
        recipientName = String(prop.payload?.recipient_name || 'Alex Rivera');
        serviceCode = String(prop.payload?.service_code || 'ADMIN-TELEHEALTH');
        amountMinor = Number(prop.payload?.unit_amount_minor || prop.amount_minor || 15000);
        dueDate = String(prop.payload?.due_date || dueDate);
      } else {
        const custName = String(args?.customer_name || 'Alex Rivera').trim();
        const targetCustomer = DEMO_ACCOUNTS.slice(1).find((c) =>
          c.fullName.toLowerCase().includes(custName.toLowerCase())
        );
        if (!targetCustomer) {
          return {
            ok: false,
            error_code: 'RECIPIENT_NOT_AUTHORIZED',
            message: `Customer "${custName}" is not an authorized demo customer. Choose Alex Rivera or Jordan Taylor.`,
          };
        }
        recipientId = targetCustomer.id;
        recipientName = targetCustomer.fullName;
        serviceCode = String(args?.service_code || 'ADMIN-FORMS').toUpperCase();
        amountMinor = Number(args?.amount_minor || 3500);
      }

      if (amountMinor > 50000) {
        return {
          ok: false,
          error_code: 'GUARDRAIL_SINGLE_ACTION_LIMIT_EXCEEDED',
          message: `Guardrail Blocked: ${formatUsd(amountMinor)} exceeds the $500.00 AI single-action limit.`,
        };
      }

      const { data: created, error: createErr } = await admin.rpc('billing_create_invoice', {
        p_recipient: recipientId,
        p_items: [
          {
            service_code: serviceCode,
            quantity: 1,
            unit_amount_minor: amountMinor,
          },
        ],
        p_due_date: dueDate,
        p_send: Boolean(sendImmediately),
        p_idempotency_key: `maas-inv-${demoSessionId}-${proposalId || Date.now()}`,
        p_ai_proposal_id: proposalId,
        p_demo_session_id: demoSessionId,
      });

      if (createErr || !created) {
        return {
          ok: false,
          error_code: 'CREATE_INVOICE_FAILED',
          message: createErr?.message || 'Could not create invoice.',
        };
      }

      return {
        ok: true,
        demo_session_id: demoSessionId,
        invoice: {
          id: created.id,
          invoice_number: created.invoice_number,
          status: created.status,
          customer_name: recipientName,
          service_code: serviceCode,
          total_minor: created.total_minor,
          total_usd: formatUsd(created.total_minor),
          due_date: created.due_date,
        },
        message: `Invoice #${created.invoice_number} (${formatUsd(
          created.total_minor
        )} USD) created for ${recipientName} in demo session "${demoSessionId}".`,
      };
    }

    case 'explain_outstanding_balances': {
      const invoices = await fetchSessionInvoices(admin, demoSessionId);
      const custFilter = String(args?.customer_name || '').trim().toLowerCase();
      const scoped = custFilter
        ? invoices.filter((i: any) => i.customer_name.toLowerCase().includes(custFilter))
        : invoices;

      const openInvoices = scoped.filter(
        (i: any) => i.balance_due_minor > 0 && i.status !== 'void' && i.status !== 'refunded' && i.status !== 'draft'
      );
      const overdueInvoices = openInvoices.filter((i: any) => i.status === 'overdue');
      const totalOutstandingMinor = openInvoices.reduce(
        (sum: number, i: any) => sum + Number(i.balance_due_minor || 0),
        0
      );
      const overdueMinor = overdueInvoices.reduce(
        (sum: number, i: any) => sum + Number(i.balance_due_minor || 0),
        0
      );

      return {
        ok: true,
        demo_session_id: demoSessionId,
        scope: custFilter || 'entire_practice',
        total_outstanding_minor: totalOutstandingMinor,
        total_outstanding_usd: formatUsd(totalOutstandingMinor),
        open_invoices_count: openInvoices.length,
        overdue_invoices_count: overdueInvoices.length,
        overdue_balance_minor: overdueMinor,
        overdue_balance_usd: formatUsd(overdueMinor),
        open_statements: openInvoices.map((i: any) => ({
          invoice_number: i.invoice_number,
          customer_name: i.customer_name,
          status: i.status,
          balance_due_minor: i.balance_due_minor,
          balance_due_usd: i.balance_due_usd,
          due_date: i.due_date,
          summary: i.line_items[0]?.description || 'Administrative Service',
        })),
      };
    }

    case 'get_transaction_history': {
      const invoices = await fetchSessionInvoices(admin, demoSessionId);
      const invFilter = String(args?.invoice_number || '').trim().replace(/^#/, '').toLowerCase();
      const targetInvoices = invFilter
        ? invoices.filter((i: any) => i.invoice_number.toLowerCase().includes(invFilter))
        : invoices;

      const settlements = targetInvoices
        .filter((i: any) => i.status === 'paid' || i.status === 'refunded' || i.settlement_reference)
        .map((i: any) => ({
          invoice_number: i.invoice_number,
          customer_name: i.customer_name,
          status: i.status,
          amount_paid_minor: i.amount_paid_minor,
          amount_paid_usd: i.amount_paid_usd,
          amount_refunded_minor: i.amount_refunded_minor,
          amount_refunded_usd: i.amount_refunded_usd,
          paid_at: i.paid_at,
          refunded_at: i.refunded_at,
          settlement_reference: i.settlement_reference,
          settlement_verification: i.settlement_verification,
          is_live_paypal_capture: i.settlement_verification === 'paypal_sandbox_verified',
          verification_badge:
            i.settlement_verification === 'paypal_sandbox_verified'
              ? 'Verified PayPal Sandbox Capture'
              : 'Sample Demo Record — Not a Live PayPal Capture',
        }));

      const paymentAttempts = targetInvoices.flatMap((i: any) =>
        i.payment_attempts.map((at: any) => ({
          ...at,
          invoice_number: i.invoice_number,
          customer_name: i.customer_name,
        }))
      );

      return {
        ok: true,
        demo_session_id: demoSessionId,
        settlements_count: settlements.length,
        settlements,
        payment_attempts_count: paymentAttempts.length,
        payment_attempts: paymentAttempts,
      };
    }

    case 'prepare_payment_proposal': {
      const invoices = await fetchSessionInvoices(admin, demoSessionId);
      const rawNum = String(args?.invoice_number || '').trim().replace(/^#/, '');
      const target = invoices.find(
        (i: any) =>
          i.invoice_number.toLowerCase() === rawNum.toLowerCase() ||
          i.invoice_number.toLowerCase().endsWith(rawNum.toLowerCase())
      );

      if (!target) {
        return {
          ok: false,
          error_code: 'INVOICE_NOT_FOUND',
          message: `Invoice ${rawNum} was not found.`,
        };
      }

      if (target.balance_due_minor <= 0 || target.status === 'paid' || target.status === 'void' || target.status === 'refunded') {
        return {
          ok: false,
          error_code: 'INVOICE_NOT_PAYABLE',
          message: `Statement #${target.invoice_number} has status ${target.status.toUpperCase()} with ${target.balance_due_usd} balance due and cannot be paid.`,
        };
      }

      const { data: sess } = await admin
        .from('billing_ai_sessions')
        .insert({
          user_id: target.customer_id,
          organization_id: ORG_ID,
          role_scope: 'patient',
          title: `MaaS Payment Proposal (${demoSessionId})`,
          demo_session_id: demoSessionId,
        })
        .select('id')
        .single();

      const payload = {
        action: 'payment_checkout',
        title: `Pay #${target.invoice_number} (${target.balance_due_usd})`,
        summary: `Authorize ${target.balance_due_usd} USD via PayPal Sandbox for ${
          target.line_items[0]?.description || 'Administrative Statement'
        }`,
        invoice_id: target.id,
        invoice_number: target.invoice_number,
        amount_minor: target.balance_due_minor,
        demo_session_id: demoSessionId,
        expires_at: new Date(Date.now() + 30 * 60000).toISOString(),
      };

      const { data: prop } = await admin
        .from('billing_ai_proposals')
        .insert({
          session_id: sess?.id,
          user_id: target.customer_id,
          kind: 'payment_checkout',
          status: 'pending',
          amount_minor: target.balance_due_minor,
          currency: 'USD',
          guardrail_result: { ok: true, requires_paypal_buyer_authorization: true },
          payload,
          demo_session_id: demoSessionId,
        })
        .select('*')
        .single();

      return {
        ok: true,
        demo_session_id: demoSessionId,
        requires_paypal_buyer_authorization: true,
        safeguard_notice:
          'Billing AI and MaaS agents cannot autonomously charge customer funds. The customer must approve this proposal and complete checkout in PayPal Sandbox.',
        workflow_stages: [
          '1. Proposal Prepared (Complete)',
          '2. Customer Approval Required (Pending)',
          '3. PayPal Sandbox Buyer Checkout Authorization',
          '4. Server-Side Capture / Webhook Verification',
          '5. Receipt Issued & Ledger Settled',
        ],
        proposal: {
          id: prop?.id || `maas-pay-${Date.now()}`,
          kind: 'payment_checkout',
          status: 'pending',
          invoice_number: target.invoice_number,
          customer_name: target.customer_name,
          amount_minor: target.balance_due_minor,
          amount_usd: target.balance_due_usd,
          payload,
        },
      };
    }

    case 'void_unpaid_invoice': {
      const invoices = await fetchSessionInvoices(admin, demoSessionId);
      const rawNum = String(args?.invoice_number || '').trim().replace(/^#/, '');
      const target = invoices.find(
        (i: any) =>
          i.invoice_number.toLowerCase() === rawNum.toLowerCase() ||
          i.invoice_number.toLowerCase().endsWith(rawNum.toLowerCase())
      );

      if (!target) {
        return {
          ok: false,
          error_code: 'INVOICE_NOT_FOUND',
          message: `Invoice ${rawNum} was not found in demo session "${demoSessionId}".`,
        };
      }

      if (target.status === 'paid' || target.amount_paid_minor > 0) {
        return {
          ok: false,
          error_code: 'PAYMENT_STATE_PROTECTION_PAID_INVOICE',
          message: `Payment-State Protection: Statement #${target.invoice_number} has a completed payment of ${target.amount_paid_usd} USD and cannot be voided. Use \`prepare_refund_proposal\` instead.`,
        };
      }

      if (target.status === 'refunded') {
        return {
          ok: false,
          error_code: 'PAYMENT_STATE_PROTECTION_REFUNDED_INVOICE',
          message: `Statement #${target.invoice_number} has already been refunded and cannot be voided.`,
        };
      }

      if (target.status === 'void') {
        return {
          ok: true,
          demo_session_id: demoSessionId,
          already_voided: true,
          message: `Statement #${target.invoice_number} is already voided ($0.00 balance due).`,
          invoice: target,
        };
      }

      if (args?.explicit_human_approval !== true) {
        const { data: sess } = await admin
          .from('billing_ai_sessions')
          .insert({
            user_id: PROVIDER_ID,
            organization_id: ORG_ID,
            role_scope: 'doctor',
            title: `MaaS Void Proposal (${demoSessionId})`,
            demo_session_id: demoSessionId,
          })
          .select('id')
          .single();

        const payload = {
          action: 'void_invoice',
          title: `Void Unpaid Statement #${target.invoice_number}`,
          summary: `Void ${target.total_usd} USD statement for ${target.customer_name}. Remaining balance becomes $0.00.`,
          invoice_id: target.id,
          invoice_number: target.invoice_number,
          amount_minor: target.total_minor,
          patient_name: target.customer_name,
          reason: args?.reason || 'Administrative void requested via MaaS',
          demo_session_id: demoSessionId,
        };

        const { data: prop } = await admin
          .from('billing_ai_proposals')
          .insert({
            session_id: sess?.id,
            user_id: PROVIDER_ID,
            kind: 'void_invoice',
            status: 'pending',
            amount_minor: target.total_minor,
            currency: 'USD',
            guardrail_result: { ok: true },
            payload,
            demo_session_id: demoSessionId,
          })
          .select('*')
          .single();

        return {
          ok: true,
          demo_session_id: demoSessionId,
          requires_human_approval: true,
          message: `Prepared void proposal for #${target.invoice_number}. Call \`void_unpaid_invoice\` with \`explicit_human_approval: true\` to execute the void in demo session "${demoSessionId}".`,
          proposal: {
            id: prop?.id,
            kind: 'void_invoice',
            status: 'pending',
            invoice_number: target.invoice_number,
            amount_usd: target.total_usd,
          },
        };
      }

      const { data: voidRes, error: voidErr } = await admin.rpc('billing_void_invoice', {
        p_invoice: target.id,
        p_demo_session_id: demoSessionId,
      });

      if (voidErr) {
        return {
          ok: false,
          error_code: 'VOID_FAILED',
          message: voidErr.message,
        };
      }

      return {
        ok: true,
        demo_session_id: demoSessionId,
        result: voidRes,
        message: `Statement #${target.invoice_number} has been voided in demo session "${demoSessionId}". Remaining balance is now $0.00 USD.`,
      };
    }

    case 'prepare_refund_proposal': {
      const invoices = await fetchSessionInvoices(admin, demoSessionId);
      const rawNum = String(args?.invoice_number || '').trim().replace(/^#/, '');
      const target = invoices.find(
        (i: any) =>
          i.invoice_number.toLowerCase() === rawNum.toLowerCase() ||
          i.invoice_number.toLowerCase().endsWith(rawNum.toLowerCase())
      );

      if (!target) {
        return {
          ok: false,
          error_code: 'INVOICE_NOT_FOUND',
          message: `Invoice ${rawNum} was not found.`,
        };
      }

      if (target.status !== 'paid' && target.amount_paid_minor <= 0) {
        return {
          ok: false,
          error_code: 'INVOICE_NOT_PAID',
          message: `Statement #${target.invoice_number} has status ${target.status.toUpperCase()} ($0.00 captured). Refunds can only be prepared for paid statements (such as #PPB-INV-2026-1003). Use \`void_unpaid_invoice\` for unpaid statements.`,
        };
      }

      const refundMinor = Number(args?.amount_minor || target.amount_paid_minor || target.total_minor);
      if (refundMinor <= 0 || refundMinor > target.amount_paid_minor) {
        return {
          ok: false,
          error_code: 'INVALID_REFUND_AMOUNT',
          message: `Refund amount ${formatUsd(refundMinor)} exceeds captured payment ${target.amount_paid_usd}.`,
        };
      }

      const { data: sess } = await admin
        .from('billing_ai_sessions')
        .insert({
          user_id: PROVIDER_ID,
          organization_id: ORG_ID,
          role_scope: 'doctor',
          title: `MaaS Refund Proposal (${demoSessionId})`,
          demo_session_id: demoSessionId,
        })
        .select('id')
        .single();

      const payload = {
        action: 'refund',
        title: `Refund ${formatUsd(refundMinor)} for #${target.invoice_number}`,
        summary: `Issue ${formatUsd(refundMinor)} USD refund to ${target.customer_name} for paid Statement #${target.invoice_number} (Ref: ${
          target.settlement_reference || 'SAMPLE-DEMO-SETTLEMENT-1003'
        }).`,
        invoice_id: target.id,
        invoice_number: target.invoice_number,
        amount_minor: refundMinor,
        patient_name: target.customer_name,
        reason: args?.reason || 'Provider-initiated administrative refund',
        demo_session_id: demoSessionId,
      };

      const { data: prop } = await admin
        .from('billing_ai_proposals')
        .insert({
          session_id: sess?.id,
          user_id: PROVIDER_ID,
          kind: 'refund',
          status: 'pending',
          amount_minor: refundMinor,
          currency: 'USD',
          guardrail_result: { ok: true },
          payload,
          demo_session_id: demoSessionId,
        })
        .select('*')
        .single();

      return {
        ok: true,
        demo_session_id: demoSessionId,
        requires_human_approval: true,
        proposal: {
          id: prop?.id,
          kind: 'refund',
          status: 'pending',
          invoice_number: target.invoice_number,
          customer_name: target.customer_name,
          refund_amount_minor: refundMinor,
          refund_amount_usd: formatUsd(refundMinor),
          settlement_reference: target.settlement_reference,
          settlement_verification: target.settlement_verification,
          payload,
        },
      };
    }

    case 'get_financial_audit_history': {
      const limit = Math.min(Math.max(Number(args?.limit || 20), 1), 50);
      const { data: events } = await admin
        .from('billing_audit_events')
        .select('id, event_type, actor_kind, invoice_id, created_at, details, demo_session_id')
        .in('demo_session_id', ['canonical', demoSessionId])
        .order('created_at', { ascending: false })
        .limit(limit);

      return {
        ok: true,
        demo_session_id: demoSessionId,
        append_only_enforced: true,
        count: (events || []).length,
        audit_events: events || [],
      };
    }

    case 'get_paypal_sandbox_status': {
      const { data: conns } = await admin
        .from('billing_account_connections')
        .select('user_id, connection_type, paypal_env, paypal_payer_id, paypal_email_masked, status, connected_at');

      const liveCredentialsConfigured = Boolean(PAYPAL_CLIENT_ID && PAYPAL_CLIENT_SECRET);

      return {
        ok: true,
        environment: 'sandbox',
        production_live_payments_disabled: true,
        paypal_sandbox_api_credentials_configured: liveCredentialsConfigured,
        verification_mode_explanation: liveCredentialsConfigured
          ? 'Live PayPal Developer Sandbox REST credentials are configured. Create-order, buyer approval redirect, and capture-order run against api-m.sandbox.paypal.com.'
          : 'PayPal Sandbox account connection records are seeded and active. Because PAYPAL_SANDBOX_CLIENT_ID / PAYPAL_SANDBOX_CLIENT_SECRET are not set in Edge Function secrets, live PayPal API checkout returns an explicit configuration notice while Demo Settlement Simulation remains available and clearly labeled as a Sample Demo Record.',
        connected_accounts: conns || [],
      };
    }

    case 'get_business_metrics': {
      const invoices = await fetchSessionInvoices(admin, demoSessionId);
      const nonVoid = invoices.filter((i: any) => i.status !== 'void');
      const totalBilledMinor = nonVoid.reduce((s: number, i: any) => s + i.total_minor, 0);
      const paidInvoices = invoices.filter((i: any) => i.status === 'paid');
      const paidTotalMinor = paidInvoices.reduce((s: number, i: any) => s + i.amount_paid_minor, 0);
      const refundedInvoices = invoices.filter((i: any) => i.status === 'refunded');
      const refundedTotalMinor = refundedInvoices.reduce(
        (s: number, i: any) => s + i.amount_refunded_minor,
        0
      );
      const openInvoices = invoices.filter(
        (i: any) => i.balance_due_minor > 0 && i.status !== 'void' && i.status !== 'refunded' && i.status !== 'draft'
      );
      const outstandingMinor = openInvoices.reduce(
        (s: number, i: any) => s + i.balance_due_minor,
        0
      );
      const overdueInvoices = openInvoices.filter((i: any) => i.status === 'overdue');
      const overdueMinor = overdueInvoices.reduce(
        (s: number, i: any) => s + i.balance_due_minor,
        0
      );
      const pendingInvoices = openInvoices.filter((i: any) => i.status !== 'overdue');
      const pendingMinor = pendingInvoices.reduce(
        (s: number, i: any) => s + i.balance_due_minor,
        0
      );
      const draftInvoices = invoices.filter((i: any) => i.status === 'draft');
      const voidInvoices = invoices.filter((i: any) => i.status === 'void');
      const failedAttemptsCount = invoices.reduce(
        (s: number, i: any) =>
          s + i.payment_attempts.filter((a: any) => a.status === 'failed').length,
        0
      );

      return {
        ok: true,
        demo_session_id: demoSessionId,
        provider_metrics: {
          total_invoices_count: invoices.length,
          total_billed_minor: totalBilledMinor,
          total_billed_usd: formatUsd(totalBilledMinor),
          outstanding_balance_minor: outstandingMinor,
          outstanding_balance_usd: formatUsd(outstandingMinor),
          pending_invoices_count: pendingInvoices.length,
          pending_balance_minor: pendingMinor,
          pending_balance_usd: formatUsd(pendingMinor),
          overdue_invoices_count: overdueInvoices.length,
          overdue_balance_minor: overdueMinor,
          overdue_balance_usd: formatUsd(overdueMinor),
          paid_invoices_count: paidInvoices.length,
          paid_total_minor: paidTotalMinor,
          paid_total_usd: formatUsd(paidTotalMinor),
          refunded_invoices_count: refundedInvoices.length,
          refunded_total_minor: refundedTotalMinor,
          refunded_total_usd: formatUsd(refundedTotalMinor),
          draft_invoices_count: draftInvoices.length,
          void_invoices_count: voidInvoices.length,
          failed_payment_attempts_count: failedAttemptsCount,
        },
      };
    }

    case 'reset_demo_session': {
      const { data: resetRes, error: resetErr } = await admin.rpc('billing_reset_demo_session', {
        p_demo_session_id: demoSessionId,
      });

      if (resetErr) {
        return {
          ok: false,
          error_code: 'RESET_FAILED',
          message: resetErr.message,
        };
      }

      return {
        ok: true,
        demo_session_id: demoSessionId,
        reset_result: resetRes,
        message: `Demo session "${demoSessionId}" has been reset to the 6 canonical seed statements (#PPB-INV-2026-1001 through #PPB-INV-2026-1006).`,
      };
    }

    default:
      return {
        ok: false,
        error_code: 'UNKNOWN_TOOL',
        message: `Unknown MaaS/MCP tool "${toolName}". Call \`discover_billing_capabilities\` or \`tools/list\` for supported tools.`,
      };
  }
}

function buildOpenApiSpec(baseUrl: string) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'PayPal AI Billing Kit — MaaS & MCP API',
      version: '2.0.0',
      description:
        'Public Model-as-a-Service (MaaS) and Model Context Protocol (MCP) interface for the standalone PayPal AI Billing Kit hackathon demonstration. Supports JSON-RPC 2.0 MCP (`tools/list`, `tools/call`) and direct REST tool invocation with isolated `demo_session_id` sandboxes.',
    },
    servers: [
      {
        url: baseUrl,
        description: 'PayPal AI Billing Kit MaaS / MCP Endpoint',
      },
    ],
    paths: {
      '/': {
        get: {
          operationId: 'discoverBillingCapabilitiesGet',
          summary: 'Discover PayPal AI Billing Kit MaaS capabilities, tools, personas, and guardrails',
          parameters: [
            {
              name: 'format',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['manifest', 'openapi'] },
            },
          ],
          responses: {
            '200': {
              description: 'MaaS & MCP capability manifest or OpenAPI 3.1.0 specification',
            },
          },
        },
        post: {
          operationId: 'invokeBillingMaaSToolOrMcp',
          summary:
            'Invoke any of the 15 PayPal AI Billing Kit tools via REST `{ tool, arguments, demo_session_id }` or MCP JSON-RPC 2.0 `{ jsonrpc: "2.0", method: "tools/call", params: { name, arguments } }`',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    tool: {
                      type: 'string',
                      enum: MCP_TOOLS.map((t) => t.name),
                      description: 'Name of the MaaS billing tool to invoke (REST mode).',
                    },
                    arguments: {
                      type: 'object',
                      description: 'Tool arguments object.',
                    },
                    demo_session_id: {
                      type: 'string',
                      description: 'Optional visitor/agent demo session ID for state isolation.',
                    },
                    jsonrpc: {
                      type: 'string',
                      description: 'Set to "2.0" when calling via Model Context Protocol (MCP).',
                    },
                    method: {
                      type: 'string',
                      description: 'MCP method (initialize, tools/list, tools/call, ping).',
                    },
                    params: {
                      type: 'object',
                      description: 'MCP method parameters.',
                    },
                    id: {
                      type: ['string', 'number'],
                      description: 'JSON-RPC request identifier.',
                    },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Structured tool response or JSON-RPC 2.0 result',
            },
          },
        },
      },
    },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const url = new URL(req.url);
  const headerSessionId =
    req.headers.get('x-demo-session-id') ||
    req.headers.get('mcp-session-id') ||
    url.searchParams.get('demo_session_id') ||
    'maas-public-demo';
  const defaultSessionId = sanitizeDemoSessionId(headerSessionId);

  try {
    if (req.method === 'GET') {
      const format = url.searchParams.get('format');
      if (format === 'openapi' || url.pathname.endsWith('/openapi.json')) {
        const publicBase = `${url.origin}${url.pathname.replace(/\/openapi\.json$/, '')}`;
        return new Response(JSON.stringify(buildOpenApiSpec(publicBase), null, 2), {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'Mcp-Session-Id': defaultSessionId,
          },
        });
      }

      const toolParam = url.searchParams.get('tool');
      if (toolParam) {
        const queryArgs: Record<string, any> = {};
        url.searchParams.forEach((v, k) => {
          if (k !== 'tool') queryArgs[k] = v;
        });
        const result = await executeTool(admin, toolParam, queryArgs, defaultSessionId);
        return new Response(JSON.stringify(result, null, 2), {
          status: result.ok ? 200 : 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'Mcp-Session-Id': defaultSessionId,
          },
        });
      }

      const discovery = await executeTool(
        admin,
        'discover_billing_capabilities',
        { demo_session_id: defaultSessionId },
        defaultSessionId
      );

      return new Response(
        JSON.stringify(
          {
            ...discovery,
            endpoints: {
              mcp_jsonrpc_post: `${url.origin}${url.pathname}`,
              rest_tool_post: `${url.origin}${url.pathname}`,
              openapi_spec_get: `${url.origin}${url.pathname}?format=openapi`,
            },
            example_requests: {
              mcp_tools_list: {
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/list',
                params: {},
              },
              mcp_tools_call: {
                jsonrpc: '2.0',
                id: 2,
                method: 'tools/call',
                params: {
                  name: 'get_invoice_details',
                  arguments: {
                    invoice_number: 'PPB-INV-2026-1003',
                    demo_session_id: 'chatgpt-eval-session',
                  },
                },
              },
              rest_direct_call: {
                tool: 'get_invoice_details',
                demo_session_id: 'chatgpt-eval-session',
                arguments: {
                  invoice_number: 'PPB-INV-2026-1003',
                },
              },
            },
          },
          null,
          2
        ),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'Mcp-Session-Id': defaultSessionId,
          },
        }
      );
    }

    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));

    // Handle JSON-RPC 2.0 (Model Context Protocol)
    if (body && body.jsonrpc === '2.0' && typeof body.method === 'string') {
      const rpcId = body.id ?? null;
      const method = body.method;
      const params = body.params || {};

      if (method === 'initialize') {
        const clientVersion = String(params.protocolVersion || '2025-03-26');
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpcId,
            result: {
              protocolVersion: clientVersion,
              capabilities: {
                tools: { listChanged: false },
              },
              serverInfo: {
                name: 'paypal-ai-billing-kit-maas',
                version: '2.0.0',
              },
              instructions:
                'PayPal AI Billing Kit MCP Server. Provides 15 billing tools across Read-Only, Proposal-Only, and Confirmed Demo Write tiers with $500 single-action / $2,500 daily guardrails and isolated demo_session_id state.',
            },
          }),
          {
            status: 200,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
              'Mcp-Session-Id': defaultSessionId,
            },
          }
        );
      }

      if (method === 'notifications/initialized' || method === 'ping') {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpcId,
            result: {},
          }),
          {
            status: 200,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
              'Mcp-Session-Id': defaultSessionId,
            },
          }
        );
      }

      if (method === 'tools/list') {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpcId,
            result: {
              tools: MCP_TOOLS.map((t) => ({
                name: t.name,
                description: `[${t.permissionTier.toUpperCase()}] ${t.description}`,
                annotations: t.annotations,
                inputSchema: t.inputSchema,
              })),
            },
          }),
          {
            status: 200,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
              'Mcp-Session-Id': defaultSessionId,
            },
          }
        );
      }

      if (method === 'tools/call') {
        const toolName = String(params.name || '');
        const toolArgs =
          params.arguments && typeof params.arguments === 'object' ? params.arguments : {};
        const result = await executeTool(admin, toolName, toolArgs, defaultSessionId);
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpcId,
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
              structuredContent: result,
              isError: !result.ok,
            },
          }),
          {
            status: 200,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
              'Mcp-Session-Id': defaultSessionId,
            },
          }
        );
      }

      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: rpcId,
          error: {
            code: -32601,
            message: `Method not found: ${method}`,
          },
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'Mcp-Session-Id': defaultSessionId,
          },
        }
      );
    }

    // Handle Direct REST MaaS Tool Invocation
    const toolName = String(body?.tool || body?.action || 'discover_billing_capabilities');
    const toolArgs =
      body?.arguments && typeof body.arguments === 'object'
        ? { ...body.arguments, demo_session_id: body.demo_session_id || body.arguments.demo_session_id }
        : { ...body };

    const result = await executeTool(admin, toolName, toolArgs, defaultSessionId);
    return new Response(JSON.stringify(result, null, 2), {
      status: result.ok ? 200 : 400,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Mcp-Session-Id': defaultSessionId,
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        ok: false,
        error_code: 'INTERNAL_MAAS_ERROR',
        message: err instanceof Error ? err.message : 'Unexpected MaaS server error',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

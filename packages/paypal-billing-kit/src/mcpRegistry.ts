export type UnifiedMcpToolSource =
  | 'native_application'
  | 'official_paypal_mcp'
  | 'paypal_rest_adapter';

export type UnifiedMcpToolClassification =
  | 'read_only'
  | 'proposal_only'
  | 'confirmed_demo_write';

export interface UnifiedMcpToolAnnotations {
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export interface UnifiedMcpToolInputSchema {
  type: 'object';
  required?: string[];
  properties: Record<
    string,
    {
      type?: string;
      description?: string;
      enum?: string[];
      [key: string]: any;
    }
  >;
  [key: string]: any;
}

export interface UnifiedMcpToolMetadata {
  name: string;
  description: string;
  source: UnifiedMcpToolSource;
  officialPayPalEquivalent: string | null;
  classification: UnifiedMcpToolClassification;
  readVsWrite: 'read' | 'write';
  permissions: 'public_read' | 'provider_or_customer' | 'provider_only' | 'customer_only';
  externalAuthRequired:
    | 'none'
    | 'paypal_merchant_oauth'
    | 'paypal_buyer_checkout_approval';
  idempotencyRequired: boolean;
  auditEvent: string | null;
  errorHandling: string;
  requiredParams: string[];
  optionalParams: string[];
  sandboxAvailability?: 'AVAILABLE_LIVE_SANDBOX' | 'BLOCKED_OAUTH_SCOPE' | 'UNSUPPORTED_BY_SANDBOX' | 'LOCAL_SESSION_LEDGER';
  equivalentRestEndpoint?: string | null;
  requiredOAuthScopes?: string[];
  annotations: UnifiedMcpToolAnnotations;
  inputSchema: UnifiedMcpToolInputSchema;
}

export function computeToolSchemaFingerprint(
  schema: UnifiedMcpToolInputSchema | Record<string, any> | undefined | null
): string {
  if (!schema || typeof schema !== 'object') return 'type:unknown|req:|props:';
  const req = Array.isArray(schema.required) ? [...schema.required].map(String).sort() : [];
  const propsObj =
    schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
  const props = Object.keys(propsObj)
    .sort()
    .map((key) => {
      const prop = propsObj[key] || {};
      const propType = String(prop.type || 'any');
      const enumPart = Array.isArray(prop.enum) ? `[${[...prop.enum].sort().join(',')}]` : '';
      return `${key}:${propType}${enumPart}`;
    });
  return `type:${String(schema.type || 'object')}|req:${req.join(',')}|props:${props.join(',')}`;
}

export const UNIFIED_MCP_TOOL_REGISTRY: readonly UnifiedMcpToolMetadata[] = [
  // 1. discover_billing_capabilities
  {
    name: 'discover_billing_capabilities',
    description:
      '[READ_ONLY] Discover the Unified MCP Gateway catalog (82 tools across Native Application (21), Official PayPal MCP Tools (47), and PayPal Sandbox REST-Backed Adapters (14)), $500/$2,500 guardrails, demo personas, and ADMIN-* service codes.',
    source: 'native_application',
    officialPayPalEquivalent: null,
    classification: 'read_only',
    readVsWrite: 'read',
    permissions: 'public_read',
    externalAuthRequired: 'none',
    idempotencyRequired: false,
    auditEvent: null,
    errorHandling: 'Returns structured capability catalog; never throws on missing session.',
    requiredParams: [],
    optionalParams: ['demo_session_id'],
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
  // 2. list_demo_customers
  {
    name: 'list_demo_customers',
    description:
      '[READ_ONLY] List the Provider (Merchant) account (Dr. Sarah Jenkins) and linked Customer (Buyer) accounts (Alex Rivera, Jordan Taylor) with active billing authorization status.',
    source: 'native_application',
    officialPayPalEquivalent: null,
    classification: 'read_only',
    readVsWrite: 'read',
    permissions: 'public_read',
    externalAuthRequired: 'none',
    idempotencyRequired: false,
    auditEvent: null,
    errorHandling: 'Returns canonical demo accounts array.',
    requiredParams: [],
    optionalParams: [],
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
  // 3. search_invoices
  {
    name: 'search_invoices',
    description:
      '[READ_ONLY] Search and filter billing statements by status (all, sent, overdue, paid, draft, void, refunded), customer name/ID, or free-text query within an isolated demo session.',
    source: 'native_application',
    officialPayPalEquivalent: 'search_invoicing',
    classification: 'read_only',
    readVsWrite: 'read',
    permissions: 'provider_or_customer',
    externalAuthRequired: 'none',
    idempotencyRequired: false,
    auditEvent: null,
    errorHandling: 'Returns empty array with count: 0 when no matching invoices exist.',
    requiredParams: [],
    optionalParams: ['query', 'status', 'customer_name', 'customer_id', 'demo_session_id'],
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
        customer_id: {
          type: 'string',
          description: 'Optional customer UUID or name filter.',
        },
        demo_session_id: {
          type: 'string',
          description: 'Isolated demo session identifier.',
        },
      },
    },
  },
  // 4. get_invoice_details
  {
    name: 'get_invoice_details',
    description:
      '[READ_ONLY] Retrieve full line items, service dates, payment attempts (including 8-state attempt classification and failure diagnostics), and plain-English explanation for a specific invoice.',
    source: 'native_application',
    officialPayPalEquivalent: 'get_invoice',
    classification: 'read_only',
    readVsWrite: 'read',
    permissions: 'provider_or_customer',
    externalAuthRequired: 'none',
    idempotencyRequired: false,
    auditEvent: null,
    errorHandling: 'Returns 404 INVOICE_NOT_FOUND if invoice_number/invoice_id does not exist.',
    requiredParams: ['invoice_number'],
    optionalParams: ['invoice_id', 'demo_session_id'],
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
          description: 'Invoice number (e.g., "PPB-INV-2026-1003" or "1003").',
        },
        invoice_id: {
          type: 'string',
          description: 'Optional invoice UUID if known.',
        },
        demo_session_id: {
          type: 'string',
          description: 'Isolated demo session identifier.',
        },
      },
    },
  },
  // 5. create_invoice_proposal
  {
    name: 'create_invoice_proposal',
    description:
      '[PROPOSAL_ONLY] Prepare an AI-drafted invoice proposal checked against the $500 single-action and $2,500 daily guardrails and return a session-bound proposal_id.',
    source: 'native_application',
    officialPayPalEquivalent: null,
    classification: 'proposal_only',
    readVsWrite: 'write',
    permissions: 'provider_only',
    externalAuthRequired: 'none',
    idempotencyRequired: false,
    auditEvent: 'ai_proposal_created',
    errorHandling: 'Returns 422 GUARDRAIL_SINGLE_ACTION_LIMIT_EXCEEDED if amount > $500.00.',
    requiredParams: ['customer_name', 'service_code', 'amount_minor'],
    optionalParams: ['due_date', 'due_in_days', 'send_immediately', 'demo_session_id'],
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
        due_date: {
          type: 'string',
          description: 'Optional ISO due date (YYYY-MM-DD). Defaults to 14 days from today.',
        },
        due_in_days: {
          type: 'integer',
          description: 'Optional days until invoice is due (default: 14).',
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
  // 6. create_approved_invoice
  {
    name: 'create_approved_invoice',
    description:
      '[CONFIRMED_WRITE] Create an invoice inside the isolated demo session using either a verified proposal_id + explicit_human_approval: true OR an unambiguous provider user_instruction.',
    source: 'native_application',
    officialPayPalEquivalent: 'create_invoice',
    classification: 'confirmed_demo_write',
    readVsWrite: 'write',
    permissions: 'provider_only',
    externalAuthRequired: 'none',
    idempotencyRequired: true,
    auditEvent: 'maas_invoice_created_in_session',
    errorHandling:
      'Enforces session ownership, replay protection (DUPLICATE_APPROVAL_BLOCKED), and $500 limit.',
    requiredParams: [],
    optionalParams: [
      'proposal_id',
      'user_instruction',
      'actor_role',
      'customer_name',
      'service_code',
      'amount_minor',
      'due_date',
      'send_immediately',
      'explicit_human_approval',
      'demo_session_id',
    ],
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
        due_date: {
          type: 'string',
          description: 'Optional ISO due date (YYYY-MM-DD).',
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
  // 7. explain_outstanding_balances
  {
    name: 'explain_outstanding_balances',
    description:
      '[READ_ONLY] Generate a natural-language breakdown of outstanding, overdue, and paid statement balances for the practice or a specific customer.',
    source: 'native_application',
    officialPayPalEquivalent: null,
    classification: 'read_only',
    readVsWrite: 'read',
    permissions: 'provider_or_customer',
    externalAuthRequired: 'none',
    idempotencyRequired: false,
    auditEvent: null,
    errorHandling: 'Returns zero-balance summary if customer has no active statements.',
    requiredParams: [],
    optionalParams: ['customer_name', 'demo_session_id'],
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
          description: 'Isolated demo session identifier.',
        },
      },
    },
  },
  // 8. get_transaction_history
  {
    name: 'get_transaction_history',
    description:
      '[READ_ONLY] Retrieve settlement captures, refunds, and payment attempts with explicit verification provenance (paypal_sandbox_verified vs sample_demo_settlement_not_live_paypal).',
    source: 'native_application',
    officialPayPalEquivalent: 'list_transactions',
    classification: 'read_only',
    readVsWrite: 'read',
    permissions: 'provider_or_customer',
    externalAuthRequired: 'none',
    idempotencyRequired: false,
    auditEvent: null,
    errorHandling: 'Returns settlements and payment_attempts arrays.',
    requiredParams: [],
    optionalParams: ['invoice_number', 'demo_session_id'],
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
          description: 'Isolated demo session identifier.',
        },
      },
    },
  },
  // 9. prepare_payment_proposal
  {
    name: 'prepare_payment_proposal',
    description:
      '[PROPOSAL_ONLY] Prepare a payment checkout proposal for an unpaid or failed statement and return a session-bound proposal_id.',
    source: 'native_application',
    officialPayPalEquivalent: null,
    classification: 'proposal_only',
    readVsWrite: 'write',
    permissions: 'customer_only',
    externalAuthRequired: 'none',
    idempotencyRequired: false,
    auditEvent: 'ai_proposal_created',
    errorHandling: 'Returns 409 PAYMENT_PROPOSAL_INVALID_STATUS if invoice is already paid/void.',
    requiredParams: ['invoice_number'],
    optionalParams: ['invoice_id', 'customer_name', 'demo_session_id'],
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
          description: 'Unpaid invoice number to pay (e.g., "PPB-INV-2026-1001" or "PPB-INV-2026-1002").',
        },
        invoice_id: {
          type: 'string',
          description: 'Optional invoice UUID.',
        },
        customer_name: {
          type: 'string',
          description: 'Optional name of the paying customer.',
        },
        demo_session_id: {
          type: 'string',
          description: 'Isolated demo session identifier.',
        },
      },
    },
  },
  // 10. void_unpaid_invoice
  {
    name: 'void_unpaid_invoice',
    description:
      '[CONFIRMED_WRITE] Void an unpaid Draft, Sent, or Overdue statement in the isolated demo session (enforces Payment-State Protection blocking void on paid or refunded invoices).',
    source: 'native_application',
    officialPayPalEquivalent: 'cancel_sent_invoice',
    classification: 'confirmed_demo_write',
    readVsWrite: 'write',
    permissions: 'provider_only',
    externalAuthRequired: 'none',
    idempotencyRequired: true,
    auditEvent: 'maas_invoice_voided_in_session',
    errorHandling: 'Returns 409 PAYMENT_STATE_PROTECTION_PAID_INVOICE on paid statements.',
    requiredParams: ['invoice_number'],
    optionalParams: [
      'invoice_id',
      'reason',
      'user_instruction',
      'actor_role',
      'explicit_human_approval',
      'demo_session_id',
    ],
    annotations: {
      title: 'Void Unpaid Invoice',
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
        invoice_id: {
          type: 'string',
          description: 'Optional invoice UUID.',
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
          description: 'Isolated demo session identifier.',
        },
      },
    },
  },
  // 11. prepare_refund_proposal
  {
    name: 'prepare_refund_proposal',
    description:
      '[PROPOSAL_ONLY] Prepare a provider refund proposal for a paid statement after verifying captured funds and return a session-bound proposal_id.',
    source: 'native_application',
    officialPayPalEquivalent: null,
    classification: 'proposal_only',
    readVsWrite: 'write',
    permissions: 'provider_only',
    externalAuthRequired: 'none',
    idempotencyRequired: false,
    auditEvent: 'ai_proposal_created',
    errorHandling: 'Returns 409 INVOICE_NOT_PAID if invoice has no captured funds.',
    requiredParams: ['invoice_number'],
    optionalParams: [
      'invoice_id',
      'amount_minor',
      'refund_amount_minor',
      'reason',
      'demo_session_id',
    ],
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
          description: 'Paid invoice number to refund (e.g., "PPB-INV-2026-1003").',
        },
        invoice_id: {
          type: 'string',
          description: 'Optional invoice UUID.',
        },
        amount_minor: {
          type: 'integer',
          description: 'Optional partial refund amount in USD cents (defaults to full paid balance).',
        },
        refund_amount_minor: {
          type: 'integer',
          description: 'Alias for amount_minor: refund amount in USD cents (defaults to full paid balance).',
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
  // 12. get_financial_audit_history
  {
    name: 'get_financial_audit_history',
    description:
      '[READ_ONLY] Read the session-isolated, immutable, append-only financial audit trail (billing_audit_events).',
    source: 'native_application',
    officialPayPalEquivalent: null,
    classification: 'read_only',
    readVsWrite: 'read',
    permissions: 'provider_or_customer',
    externalAuthRequired: 'none',
    idempotencyRequired: false,
    auditEvent: null,
    errorHandling: 'Returns latest audit events up to requested limit (max 50) for the active session.',
    requiredParams: [],
    optionalParams: ['limit', 'demo_session_id'],
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
          description: 'Maximum events to retrieve (default: 20, max: 50).',
        },
        demo_session_id: {
          type: 'string',
          description: 'Isolated demo session identifier.',
        },
      },
    },
  },
  // 13. get_paypal_sandbox_status
  {
    name: 'get_paypal_sandbox_status',
    description:
      '[READ_ONLY] Check PayPal Sandbox merchant/buyer connection states, live OAuth 2.0 token reachability, App ID, and Unified MCP Gateway status.',
    source: 'native_application',
    officialPayPalEquivalent: null,
    classification: 'read_only',
    readVsWrite: 'read',
    permissions: 'public_read',
    externalAuthRequired: 'paypal_merchant_oauth',
    idempotencyRequired: false,
    auditEvent: null,
    errorHandling: 'Reports oauth_reachable: false with diagnostic if credentials are missing.',
    requiredParams: [],
    optionalParams: [],
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
  // 14. get_business_metrics
  {
    name: 'get_business_metrics',
    description:
      '[READ_ONLY] Calculate Provider practice and Customer KPI metrics (total outstanding, overdue, paid, refunded, failed payment attempts, and collection rate).',
    source: 'native_application',
    officialPayPalEquivalent: 'get_merchant_insights',
    classification: 'read_only',
    readVsWrite: 'read',
    permissions: 'provider_or_customer',
    externalAuthRequired: 'none',
    idempotencyRequired: false,
    auditEvent: null,
    errorHandling: 'Returns computed KPI metrics for the active demo session.',
    requiredParams: [],
    optionalParams: ['demo_session_id'],
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
          description: 'Isolated demo session identifier.',
        },
      },
    },
  },
  // 15. reset_demo_session
  {
    name: 'reset_demo_session',
    description:
      '[CONFIRMED_WRITE] Reset an isolated demo_session_id, clearing session-specific test invoices, proposals, and overrides while restoring the 6 canonical seed statements (#PPB-INV-2026-1001 through #PPB-INV-2026-1006).',
    source: 'native_application',
    officialPayPalEquivalent: null,
    classification: 'confirmed_demo_write',
    readVsWrite: 'write',
    permissions: 'provider_or_customer',
    externalAuthRequired: 'none',
    idempotencyRequired: true,
    auditEvent: 'demo_session_reset',
    errorHandling: 'Clears session overrides and session proposals without touching canonical rows.',
    requiredParams: [],
    optionalParams: ['demo_session_id'],
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
          description: 'Isolated demo session identifier to reset.',
        },
      },
    },
  },
  // 16. create_paypal_checkout_order
  {
    name: 'create_paypal_checkout_order',
    description:
      '[CONFIRMED_WRITE] Create a real PayPal Sandbox checkout order (POST /v2/checkout/orders) from a verified payment proposal_id or explicit customer user_instruction, returning the PayPal Order ID and buyer approvalUrl.',
    source: 'native_application',
    officialPayPalEquivalent: 'create_order',
    classification: 'confirmed_demo_write',
    readVsWrite: 'write',
    permissions: 'customer_only',
    externalAuthRequired: 'paypal_buyer_checkout_approval',
    idempotencyRequired: true,
    auditEvent: 'paypal_order_created',
    errorHandling:
      'Validates proposal/instruction binding and returns buyer approvalUrl; never marks invoice paid before capture.',
    requiredParams: [],
    optionalParams: [
      'proposal_id',
      'user_instruction',
      'actor_role',
      'invoice_number',
      'invoice_id',
      'explicit_human_approval',
      'demo_session_id',
    ],
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
          description: 'Unpaid invoice number (e.g., "PPB-INV-2026-1001" or "PPB-INV-2026-1004").',
        },
        invoice_id: {
          type: 'string',
          description: 'Optional invoice UUID.',
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
  // 17. capture_paypal_checkout_order
  {
    name: 'capture_paypal_checkout_order',
    description:
      '[CONFIRMED_WRITE] Capture a buyer-approved PayPal Sandbox order (POST /v2/checkout/orders/{id}/capture) and verify settlement, or record an explicitly labeled demo settlement override when allow_demo_settlement_fallback is true.',
    source: 'native_application',
    officialPayPalEquivalent: 'pay_order',
    classification: 'confirmed_demo_write',
    readVsWrite: 'write',
    permissions: 'customer_only',
    externalAuthRequired: 'paypal_buyer_checkout_approval',
    idempotencyRequired: true,
    auditEvent: 'payment_captured_verified',
    errorHandling:
      'Classifies unapproved wallet orders as approval_required (ORDER_NOT_APPROVED) without inflating declined metrics.',
    requiredParams: ['invoice_number'],
    optionalParams: [
      'invoice_id',
      'order_id',
      'allow_demo_settlement_fallback',
      'explicit_human_approval',
      'demo_session_id',
    ],
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
          description: 'Invoice number being settled (e.g., "PPB-INV-2026-1001" or "PPB-INV-2026-1004").',
        },
        invoice_id: {
          type: 'string',
          description: 'Optional invoice UUID.',
        },
        order_id: {
          type: 'string',
          description: 'PayPal Sandbox Order ID returned by create_paypal_checkout_order after buyer approval.',
        },
        allow_demo_settlement_fallback: {
          type: 'boolean',
          description:
            'When true and live PayPal Sandbox buyer capture is not provided, settles the invoice in the isolated demo session clearly marked as a Sample Demo Record.',
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
  // 18. get_payment_receipt
  {
    name: 'get_payment_receipt',
    description:
      '[READ_ONLY] Retrieve a structured merchant-branded payment receipt AND downloadable PDF 1.4 receipt (pdf_download_url & pdf_base64) for a paid or refunded statement, including verified PayPal Capture ID and provenance.',
    source: 'native_application',
    officialPayPalEquivalent: null,
    classification: 'read_only',
    readVsWrite: 'read',
    permissions: 'provider_or_customer',
    externalAuthRequired: 'none',
    idempotencyRequired: false,
    auditEvent: null,
    errorHandling: 'Returns 409 RECEIPT_UNAVAILABLE_UNPAID_INVOICE if statement has no payment.',
    requiredParams: ['invoice_number'],
    optionalParams: ['invoice_id', 'demo_session_id'],
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
          description: 'Paid or refunded invoice number (e.g., "PPB-INV-2026-1003").',
        },
        invoice_id: {
          type: 'string',
          description: 'Optional invoice UUID.',
        },
        demo_session_id: {
          type: 'string',
          description: 'Isolated demo session identifier.',
        },
      },
    },
  },
  // 19. execute_approved_refund
  {
    name: 'execute_approved_refund',
    description:
      '[CONFIRMED_WRITE] Execute an authorized refund for a paid statement via PayPal Captures v2 (POST /v2/payments/captures/{id}/refund) using a verified refund proposal_id or unambiguous provider user_instruction.',
    source: 'native_application',
    officialPayPalEquivalent: 'create_refund',
    classification: 'confirmed_demo_write',
    readVsWrite: 'write',
    permissions: 'provider_only',
    externalAuthRequired: 'paypal_merchant_oauth',
    idempotencyRequired: true,
    auditEvent: 'refund_completed',
    errorHandling:
      'Enforces single-use proposal/instruction replay prevention and verifies captured balance.',
    requiredParams: [],
    optionalParams: [
      'proposal_id',
      'user_instruction',
      'actor_role',
      'invoice_number',
      'invoice_id',
      'amount_minor',
      'refund_amount_minor',
      'explicit_human_approval',
      'demo_session_id',
    ],
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
          description: 'Paid invoice number to refund (e.g., "PPB-INV-2026-1003").',
        },
        invoice_id: {
          type: 'string',
          description: 'Optional invoice UUID.',
        },
        amount_minor: {
          type: 'integer',
          description: 'Optional refund amount in USD cents (defaults to full paid balance).',
        },
        refund_amount_minor: {
          type: 'integer',
          description: 'Alias for amount_minor: refund amount in USD cents.',
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
  // 20. execute_conversational_instruction
  {
    name: 'execute_conversational_instruction',
    description:
      '[CONFIRMED_WRITE] Context-aware Conversational Authorization router: evaluates a natural-language user instruction ("Create an invoice for Alex for $150.", "Void invoice 1004.", "Refund the $50 payment.", "Pay invoice 1002.", "Reset the demo.", "Yes, go ahead.", "Are you able to issue refunds?", "Can you pay invoice 1002?", "What would happen if I refunded it?") and executes explicit authorized commands within role and $500/$2,500 guardrails while explaining capability or hypothetical questions without mutating state.',
    source: 'native_application',
    officialPayPalEquivalent: null,
    classification: 'confirmed_demo_write',
    readVsWrite: 'write',
    permissions: 'provider_or_customer',
    externalAuthRequired: 'none',
    idempotencyRequired: true,
    auditEvent: 'conversational_instruction_evaluated',
    errorHandling:
      'Distinguishes explicit commands from capability questions, hypotheticals, role impersonation, and fabricated approvals.',
    requiredParams: ['instruction'],
    optionalParams: ['actor_role', 'prior_execution_intent', 'demo_session_id'],
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
  // 21. paypal_discover_official_mcp
  {
    name: 'paypal_discover_official_mcp',
    description:
      '[OFFICIAL_PAYPAL_MCP] Connect server-side to PayPal’s official Sandbox MCP server (https://mcp.sandbox.paypal.com/sse and /.well-known/oauth-authorization-server, plus probe /http) using the merchant Sandbox OAuth token, returning live serverInfo (PayPal MCP Agent v1.0.0), the 46 upstream official PayPal MCP tools, and transport status.',
    source: 'official_paypal_mcp',
    officialPayPalEquivalent: 'mcp/tools/list',
    classification: 'read_only',
    readVsWrite: 'read',
    permissions: 'public_read',
    externalAuthRequired: 'paypal_merchant_oauth',
    idempotencyRequired: false,
    auditEvent: null,
    errorHandling:
      'Reports live SSE handshake status, /http 404 diagnostic, and upstream Worker fetch cache limitation truthfully.',
    requiredParams: [],
    optionalParams: ['demo_session_id'],
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
  // 22. paypal_get_order
  {
    name: 'paypal_get_order',
    description:
      '[PAYPAL_REST_ADAPTER] Official PayPal `get_order` capability: retrieve live order details directly from PayPal Sandbox Orders v2 API (`GET /v2/checkout/orders/{order_id}`), returning order status, intent, payer, purchase units, and capture IDs.',
    source: 'paypal_rest_adapter',
    officialPayPalEquivalent: 'get_order',
    classification: 'read_only',
    readVsWrite: 'read',
    permissions: 'provider_or_customer',
    externalAuthRequired: 'paypal_merchant_oauth',
    idempotencyRequired: false,
    auditEvent: null,
    errorHandling: 'Returns 404 PAYPAL_ORDER_NOT_FOUND if order_id does not exist in PayPal Sandbox.',
    requiredParams: ['order_id'],
    optionalParams: ['demo_session_id'],
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
  // 23. paypal_get_refund
  {
    name: 'paypal_get_refund',
    description:
      '[PAYPAL_REST_ADAPTER] Official PayPal `get_refund` capability: retrieve live refund details directly from PayPal Sandbox Captures v2 API (`GET /v2/payments/refunds/{refund_id}`), returning refund status, amount, note_to_payer, and seller payable breakdown.',
    source: 'paypal_rest_adapter',
    officialPayPalEquivalent: 'get_refund',
    classification: 'read_only',
    readVsWrite: 'read',
    permissions: 'provider_or_customer',
    externalAuthRequired: 'paypal_merchant_oauth',
    idempotencyRequired: false,
    auditEvent: null,
    errorHandling: 'Returns 404 PAYPAL_REFUND_NOT_FOUND if refund_id does not exist in PayPal Sandbox.',
    requiredParams: ['refund_id'],
    optionalParams: ['demo_session_id'],
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
  // 24. paypal_list_invoices
  {
    name: 'paypal_list_invoices',
    description:
      '[PAYPAL_REST_ADAPTER] Official PayPal `list_invoices` capability: query PayPal Sandbox Invoicing v2 API (`GET /v2/invoicing/invoices`) alongside synchronized application statements.',
    source: 'paypal_rest_adapter',
    officialPayPalEquivalent: 'list_invoices',
    classification: 'read_only',
    readVsWrite: 'read',
    permissions: 'provider_only',
    externalAuthRequired: 'paypal_merchant_oauth',
    idempotencyRequired: false,
    auditEvent: null,
    errorHandling: 'Returns PayPal Invoicing v2 items array and application ledger count.',
    requiredParams: [],
    optionalParams: ['page', 'page_size', 'demo_session_id'],
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
  // 25. paypal_generate_invoice_number
  {
    name: 'paypal_generate_invoice_number',
    description:
      '[PAYPAL_REST_ADAPTER] Official PayPal `generate_invoice_number` capability: call PayPal Sandbox Invoicing v2 API (`POST /v2/invoicing/generate-next-invoice-number`) to allocate the next official PayPal merchant invoice number.',
    source: 'paypal_rest_adapter',
    officialPayPalEquivalent: 'generate_invoice_number',
    classification: 'read_only',
    readVsWrite: 'read',
    permissions: 'provider_only',
    externalAuthRequired: 'paypal_merchant_oauth',
    idempotencyRequired: false,
    auditEvent: null,
    errorHandling: 'Returns generated PayPal Sandbox invoice_number.',
    requiredParams: [],
    optionalParams: ['demo_session_id'],
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
  // 26. paypal_list_disputes
  {
    name: 'paypal_list_disputes',
    description:
      '[PAYPAL_REST_ADAPTER] Official PayPal `list_disputes` capability: query PayPal Sandbox Customer Disputes API (`GET /v1/customer/disputes`) to inspect open merchant disputes.',
    source: 'paypal_rest_adapter',
    officialPayPalEquivalent: 'list_disputes',
    classification: 'read_only',
    readVsWrite: 'read',
    permissions: 'provider_only',
    externalAuthRequired: 'paypal_merchant_oauth',
    idempotencyRequired: false,
    auditEvent: null,
    errorHandling: 'Returns live PayPal Sandbox disputes items array and pagination links.',
    requiredParams: [],
    optionalParams: ['page_size', 'demo_session_id'],
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
  // 27. paypal_check_card_eligibility
  {
    name: 'paypal_check_card_eligibility',
    description:
      '[PAYPAL_REST_ADAPTER] Check PayPal Sandbox merchant eligibility for Orders v2 direct card payments (`payment_source.card`), granted OAuth 2.0 scopes, supported PayPal Sandbox test card profiles (`visa_sandbox`, `mastercard_sandbox`, `amex_sandbox`, `decline_refused`, `decline_expired`, `decline_insufficient_funds`), and security controls.',
    source: 'paypal_rest_adapter',
    officialPayPalEquivalent: 'get_merchant_insights',
    classification: 'read_only',
    readVsWrite: 'read',
    permissions: 'public_read',
    externalAuthRequired: 'paypal_merchant_oauth',
    idempotencyRequired: false,
    auditEvent: null,
    errorHandling: 'Returns direct_card_eligible status and granted OAuth scopes.',
    requiredParams: [],
    optionalParams: ['demo_session_id'],
    annotations: {
      title: 'PayPal Sandbox: Check Direct Card Payment Eligibility',
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
  // 28. execute_sandbox_card_payment
  {
    name: 'execute_sandbox_card_payment',
    description:
      '[CONFIRMED_WRITE] Execute an authorized server-side PayPal Sandbox direct card payment (`POST /v2/checkout/orders` with `payment_source.card`) using an allowlisted PayPal Sandbox test card profile (`visa_sandbox`, `mastercard_sandbox`, `amex_sandbox`, `decline_refused`, `decline_expired`, `decline_insufficient_funds`). Rejects caller-supplied raw PAN/CVV and verifies capture directly against PayPal Orders v2.',
    source: 'paypal_rest_adapter',
    officialPayPalEquivalent: 'pay_order',
    classification: 'confirmed_demo_write',
    readVsWrite: 'write',
    permissions: 'customer_only',
    externalAuthRequired: 'paypal_merchant_oauth',
    idempotencyRequired: true,
    auditEvent: 'paypal_sandbox_card_payment_completed',
    errorHandling:
      'Rejects raw PAN/CVV; classifies declines as payment_declined without inflating approval_required.',
    requiredParams: [],
    optionalParams: [
      'proposal_id',
      'user_instruction',
      'invoice_number',
      'card_profile',
      'intent',
      'explicit_human_approval',
      'demo_session_id',
    ],
    annotations: {
      title: 'Execute Authorized PayPal Sandbox Card Payment',
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
          description: 'Optional UUID of a pending payment_checkout proposal prepared by prepare_payment_proposal.',
        },
        user_instruction: {
          type: 'string',
          description: 'Optional explicit natural-language user instruction authorizing payment (e.g., "Pay invoice 1002.").',
        },
        invoice_number: {
          type: 'string',
          description: 'Unpaid invoice number (e.g., "PPB-INV-2026-1001" or a session invoice).',
        },
        card_profile: {
          type: 'string',
          enum: [
            'visa_sandbox',
            'mastercard_sandbox',
            'amex_sandbox',
            'decline_refused',
            'decline_expired',
            'decline_insufficient_funds',
          ],
          description: 'Allowlisted server-side PayPal Sandbox test card profile (default: visa_sandbox).',
        },
        intent: {
          type: 'string',
          enum: ['CAPTURE', 'AUTHORIZE'],
          description: 'PayPal Orders v2 intent (default: CAPTURE).',
        },
        explicit_human_approval: {
          type: 'boolean',
          description: 'Must be true to confirm human approval before executing the Sandbox card payment.',
        },
        demo_session_id: {
          type: 'string',
          description: 'Isolated demo session identifier.',
        },
      },
    },
  },
  // 29. generate_receipt_pdf
  {
    name: 'generate_receipt_pdf',
    description:
      '[READ_ONLY] Generate and validate a downloadable merchant-branded PDF payment receipt (`%PDF-1.4`) for a paid or refunded statement (`invoice_number`), returning base64 PDF content, direct download URL, byte length, and provenance/refund metadata. Rejects unpaid statements.',
    source: 'native_application',
    officialPayPalEquivalent: null,
    classification: 'read_only',
    readVsWrite: 'read',
    permissions: 'provider_or_customer',
    externalAuthRequired: 'none',
    idempotencyRequired: false,
    auditEvent: null,
    errorHandling: 'Returns RECEIPT_UNAVAILABLE_UNPAID_INVOICE on unpaid statements.',
    requiredParams: ['invoice_number'],
    optionalParams: ['demo_session_id'],
    annotations: {
      title: 'Generate & Validate PDF Payment Receipt',
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
          description: 'Paid or refunded invoice number (e.g., "PPB-INV-2026-1003" or "PPB-INV-2026-1057").',
        },
        demo_session_id: {
          type: 'string',
          description: 'Isolated demo session identifier.',
        },
      },
    },
  },
  // 30. run_sandbox_card_lifecycle_test
  {
    name: 'run_sandbox_card_lifecycle_test',
    description:
      '[CONFIRMED_WRITE] Execute a complete, isolated PayPal Sandbox integration lifecycle test (1. Create Test Invoice -> 2. Execute Sandbox Card Order & Capture -> 3. Direct PayPal Order Lookup -> 4. Receipt & PDF Verification -> 5. Live PayPal Refund -> 6. Direct PayPal Refund Lookup -> 7. Audit & Metrics Reconciliation). Sandbox-only and rate-limited.',
    source: 'paypal_rest_adapter',
    officialPayPalEquivalent: null,
    classification: 'confirmed_demo_write',
    readVsWrite: 'write',
    permissions: 'provider_or_customer',
    externalAuthRequired: 'paypal_merchant_oauth',
    idempotencyRequired: false,
    auditEvent: 'sandbox_card_lifecycle_verified',
    errorHandling: 'Executes 8 verification stages and reports per-stage PASS/FAIL.',
    requiredParams: [],
    optionalParams: [
      'amount_minor',
      'card_profile',
      'include_refund',
      'explicit_human_approval',
      'demo_session_id',
    ],
    annotations: {
      title: 'Run Full PayPal Sandbox Card Lifecycle Integration Test',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        amount_minor: {
          type: 'integer',
          description: 'Optional test invoice amount in USD cents (default: 3500 for $35.00, max: 10000 for $100.00).',
        },
        card_profile: {
          type: 'string',
          enum: ['visa_sandbox', 'mastercard_sandbox', 'amex_sandbox'],
          description: 'Allowlisted PayPal Sandbox test card profile (default: visa_sandbox).',
        },
        include_refund: {
          type: 'boolean',
          description: 'Whether to also execute and verify a live PayPal Sandbox refund after capture (default: true).',
        },
        explicit_human_approval: {
          type: 'boolean',
          description: 'Must be true to authorize the automated Sandbox integration test.',
        },
        demo_session_id: {
          type: 'string',
          description: 'Isolated demo session identifier.',
        },
      },
    },
  },
  // 31. create_invoice
  {
    "name": "create_invoice",
    "description": "[CONFIRMED_WRITE] Official PayPal MCP Tool (Invoicing v2 — POST /v2/invoicing/invoices): Create Invoices on PayPal.\n\nThis function creates a draft invoice, specifying a currency code, the invoicer's business information, one or more recipients to bill, and line items. Once created, the invoice can be sent to the customer for payment.\n\nprimary_recipients and items use PayPal's real nested shape (billing_info/shipping_info for recipients; unit_amount/tax/discount for items); other fields use a simplified flat shape.",
    "source": "official_paypal_mcp",
    "officialPayPalEquivalent": "create_invoice",
    "classification": "confirmed_demo_write",
    "readVsWrite": "write",
    "permissions": "provider_only",
    "externalAuthRequired": "paypal_merchant_oauth",
    "idempotencyRequired": true,
    "auditEvent": "paypal_mcp_create_invoice",
    "errorHandling": "400 INVALID_REQUEST (missing recipient/items); 403 AUTHORIZATION_REQUIRED (missing explicit approval); 422 GUARDRAIL_SINGLE_ACTION_LIMIT_EXCEEDED (> $500)",
    "requiredParams": [
      "currency_code",
      "primary_recipients",
      "items"
    ],
    "optionalParams": [
      "invoice_number",
      "invoice_date",
      "reference",
      "note",
      "invoicer_business_name",
      "invoicer_given_name",
      "invoicer_surname",
      "invoicer_email_address",
      "invoicer_tax_id",
      "invoicer_address_line_1",
      "invoicer_address_line_2",
      "invoicer_city",
      "invoicer_state",
      "invoicer_postal_code",
      "invoicer_country_code",
      "allow_tip",
      "theme_color",
      "shipping_cost",
      "enable_pay_by_bank",
      "pay_by_bank_exclusive_above_threshold",
      "allow_partial_payment",
      "minimum_partial_payment_amount",
      "explicit_human_approval",
      "user_instruction",
      "proposal_id",
      "actor_role",
      "demo_session_id"
    ],
    "sandboxAvailability": "AVAILABLE_LIVE_SANDBOX",
    "equivalentRestEndpoint": "POST /v2/invoicing/invoices",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/invoicing"
    ],
    "annotations": {
      "title": "PayPal MCP: Create Invoice",
      "readOnlyHint": false,
      "destructiveHint": false,
      "idempotentHint": false,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "required": [
        "currency_code",
        "primary_recipients",
        "items"
      ],
      "properties": {
        "currency_code": {
          "type": "string",
          "description": "The three-character ISO-4217 currency code for the invoice (for example, USD). Applies to every monetary amount on the invoice."
        },
        "invoice_number": {
          "type": "string",
          "description": "The invoice number. If omitted, PayPal auto-increments from the last invoice number used."
        },
        "invoice_date": {
          "type": "string",
          "description": "The invoice date in yyyy-MM-DD format."
        },
        "reference": {
          "type": "string",
          "description": "A reference value, such as a purchase order number."
        },
        "note": {
          "type": "string",
          "description": "A note to the invoice recipient. Also appears on the invoice notification email."
        },
        "invoicer_business_name": {
          "type": "string",
          "description": "The business name of the invoicer."
        },
        "invoicer_given_name": {
          "type": "string",
          "description": "The first name of the invoicer."
        },
        "invoicer_surname": {
          "type": "string",
          "description": "The last name of the invoicer."
        },
        "invoicer_email_address": {
          "type": "string",
          "description": "The email address of the invoicer."
        },
        "invoicer_tax_id": {
          "type": "string",
          "description": "The invoicer's tax ID."
        },
        "invoicer_address_line_1": {
          "type": "string",
          "description": "The first line of the invoicer's address, for example, number and street."
        },
        "invoicer_address_line_2": {
          "type": "string",
          "description": "The second line of the invoicer's address, for example, suite or apartment number."
        },
        "invoicer_city": {
          "type": "string",
          "description": "The city, town, or village of the invoicer's address."
        },
        "invoicer_state": {
          "type": "string",
          "description": "The state or province of the invoicer's address."
        },
        "invoicer_postal_code": {
          "type": "string",
          "description": "The postal code of the invoicer's address."
        },
        "invoicer_country_code": {
          "type": "string",
          "description": "The two-character ISO 3166-1 country code of the invoicer's address (for example, US or GB)."
        },
        "primary_recipients": {
          "type": "array",
          "description": "The recipients who will be billed for this invoice.",
          "items": {
            "type": "object",
            "properties": {
              "billing_info": {
                "type": "object",
                "properties": {
                  "business_name": {
                    "type": "string",
                    "description": "The business name of the invoice recipient."
                  },
                  "name": {
                    "type": "object",
                    "properties": {
                      "given_name": {
                        "type": "string",
                        "description": "The first name of the person."
                      },
                      "surname": {
                        "type": "string",
                        "description": "The last name of the person."
                      }
                    },
                    "additionalProperties": false,
                    "description": "name of the recipient"
                  },
                  "address": {
                    "type": "object",
                    "properties": {
                      "address_line_1": {
                        "type": "string",
                        "description": "The first line of the address, for example, number and street."
                      },
                      "address_line_2": {
                        "type": "string",
                        "description": "The second line of the address, for example, suite or apartment number."
                      },
                      "admin_area_2": {
                        "type": "string",
                        "description": "A city, town, or village."
                      },
                      "admin_area_1": {
                        "type": "string",
                        "description": "The highest-level sub-division in a country, such as a state or province."
                      },
                      "postal_code": {
                        "type": "string",
                        "description": "The postal code, which is the zip code or equivalent."
                      },
                      "country_code": {
                        "type": "string",
                        "pattern": "^([A-Z]{2}|C2)$",
                        "description": "The two-character ISO 3166-1 country code (for example, US or GB)."
                      }
                    },
                    "additionalProperties": false,
                    "description": "The address of the invoice recipient."
                  },
                  "email_address": {
                    "type": "string",
                    "description": "email address of the recipient"
                  },
                  "phones": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "properties": {
                        "country_code": {
                          "type": "string",
                          "description": "The country calling code, in E.164 format (for example, '1' for the United States)."
                        },
                        "national_number": {
                          "type": "string",
                          "description": "The national number, in E.164 format."
                        },
                        "phone_type": {
                          "type": "string",
                          "enum": [
                            "FAX",
                            "HOME",
                            "MOBILE",
                            "OTHER",
                            "PAGER"
                          ],
                          "description": "The type of phone number."
                        }
                      },
                      "required": [
                        "country_code",
                        "national_number",
                        "phone_type"
                      ],
                      "additionalProperties": false,
                      "description": "phone object"
                    },
                    "description": "The invoice recipient's phone numbers."
                  },
                  "additional_info": {
                    "type": "string",
                    "maxLength": 40,
                    "description": "Any additional information about the recipient."
                  },
                  "language": {
                    "type": "string",
                    "pattern": "^[a-z]{2}(-[A-Z][a-z]{3})?(-([A-Z]{2}|[0-9]{3}))?$",
                    "description": "The BCP-47 language tag used for the recipient's email notification (for example, 'en-US'). Only used when the recipient has no PayPal account."
                  }
                },
                "additionalProperties": false,
                "description": "The billing information of the invoice recipient"
              },
              "shipping_info": {
                "type": "object",
                "properties": {
                  "business_name": {
                    "type": "string",
                    "description": "The business name for the shipping destination."
                  },
                  "name": {
                    "type": "object",
                    "properties": {
                      "given_name": {
                        "type": "string",
                        "description": "The first name of the person."
                      },
                      "surname": {
                        "type": "string",
                        "description": "The last name of the person."
                      }
                    },
                    "additionalProperties": false,
                    "description": "The name for the shipping destination."
                  },
                  "address": {
                    "type": "object",
                    "properties": {
                      "address_line_1": {
                        "type": "string",
                        "description": "The first line of the address, for example, number and street."
                      },
                      "address_line_2": {
                        "type": "string",
                        "description": "The second line of the address, for example, suite or apartment number."
                      },
                      "admin_area_2": {
                        "type": "string",
                        "description": "A city, town, or village."
                      },
                      "admin_area_1": {
                        "type": "string",
                        "description": "The highest-level sub-division in a country, such as a state or province."
                      },
                      "postal_code": {
                        "type": "string",
                        "description": "The postal code, which is the zip code or equivalent."
                      },
                      "country_code": {
                        "type": "string",
                        "pattern": "^([A-Z]{2}|C2)$",
                        "description": "The two-character ISO 3166-1 country code (for example, US or GB)."
                      }
                    },
                    "additionalProperties": false,
                    "description": "The shipping address."
                  }
                },
                "additionalProperties": false,
                "description": "The shipping information of the invoice recipient."
              }
            },
            "additionalProperties": false
          }
        },
        "items": {
          "type": "array",
          "description": "The line items on the invoice.",
          "items": {
            "type": "object",
            "properties": {
              "name": {
                "type": "string",
                "description": "The name of the item"
              },
              "description": {
                "type": "string",
                "description": "The description of the item."
              },
              "quantity": {
                "type": "string",
                "description": "The quantity of the item that the invoicer provides to the payer. Value is from -1000000 to 1000000. Supports up to five decimal places. Cast to string"
              },
              "unit_amount": {
                "type": "object",
                "properties": {
                  "currency_code": {
                    "type": "string",
                    "description": "The three-character ISO-4217 currency code that identifies the currency."
                  },
                  "value": {
                    "type": "string",
                    "pattern": "^((-?[0-9]+)|(-?([0-9]+)?[.][0-9]+))$",
                    "description": "The amount, as a signed decimal string with up to 2 decimal places (e.g. '50.00')."
                  }
                },
                "required": [
                  "currency_code",
                  "value"
                ],
                "additionalProperties": false,
                "description": "The unit price of the item. Does not include tax or discount."
              },
              "tax": {
                "type": "object",
                "properties": {
                  "name": {
                    "type": "string",
                    "description": "The name of the tax applied on the item, for example 'Sales Tax'."
                  },
                  "percent": {
                    "type": "string",
                    "pattern": "^((-?[0-9]+)|(-?([0-9]+)?[.][0-9]+))$",
                    "description": "The tax rate, as a percent value from 0 to 100. Supports up to five decimal places."
                  },
                  "tax_note": {
                    "type": "string",
                    "description": "A note about the tax, used to track tax-related data."
                  }
                },
                "required": [
                  "name",
                  "percent"
                ],
                "additionalProperties": false,
                "description": "tax object"
              },
              "discount": {
                "type": "object",
                "properties": {
                  "percent": {
                    "type": "string",
                    "pattern": "^((-?[0-9]+)|(-?([0-9]+)?[.][0-9]+))$",
                    "description": "The discount as a percent value, from 0 to 100. Supports up to five decimal places. Mutually exclusive with amount -- set only one."
                  },
                  "amount": {
                    "type": "object",
                    "properties": {
                      "currency_code": {
                        "type": "string",
                        "description": "The three-character ISO-4217 currency code that identifies the currency."
                      },
                      "value": {
                        "type": "string",
                        "pattern": "^((-?[0-9]+)|(-?([0-9]+)?[.][0-9]+))$",
                        "description": "The amount, as a signed decimal string with up to 2 decimal places (e.g. '50.00')."
                      }
                    },
                    "required": [
                      "currency_code",
                      "value"
                    ],
                    "additionalProperties": false,
                    "description": "The discount as a fixed amount. Mutually exclusive with percent -- set only one."
                  }
                },
                "additionalProperties": false,
                "description": "The discount for this line item, subtracted from the item total."
              },
              "item_date": {
                "type": "string",
                "pattern": "^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[1-2][0-9]|3[0-1])$",
                "description": "The date, in yyyy-MM-DD format, when the item or service was provided."
              },
              "unit_of_measure": {
                "type": "string",
                "enum": [
                  "QUANTITY",
                  "HOURS",
                  "AMOUNT"
                ],
                "description": "The unit of measure for the invoiced item"
              }
            },
            "required": [
              "name",
              "quantity",
              "unit_amount"
            ],
            "additionalProperties": false,
            "description": "invoice line item object"
          }
        },
        "allow_tip": {
          "type": "boolean",
          "description": "Whether the payer can add a tip when paying. Not available in Hong Kong, Taiwan, India, or Japan."
        },
        "theme_color": {
          "type": "string",
          "description": "The primary color used to render the invoice, as a hex color code (e.g. #000000). If omitted, the default theme is used."
        },
        "shipping_cost": {
          "type": "string",
          "description": "The shipping cost for the invoice, in the invoice's currency_code."
        },
        "enable_pay_by_bank": {
          "type": "boolean",
          "description": "Whether to enable PAY_BY_BANK as a payment method for this invoice, letting the payer pay directly from their bank account. Available only for US-based merchants and invoices with USD currency."
        },
        "pay_by_bank_exclusive_above_threshold": {
          "type": "boolean",
          "description": "When true, PAY_BY_BANK becomes the only available payment method once the invoice total exceeds PayPal's system-defined threshold ($1000), disabling all other payment methods above that threshold."
        },
        "allow_partial_payment": {
          "type": "boolean",
          "description": "Whether the invoice allows a partial payment. If false, the invoice must be paid in full. If true, the invoice allows partial payments. Not available for users in India, Brazil, or Israel."
        },
        "minimum_partial_payment_amount": {
          "type": "string",
          "description": "The minimum amount allowed for a partial payment, in the invoice's currency_code. Valid only when allow_partial_payment is true."
        },
        "explicit_human_approval": {
          "type": "boolean",
          "description": "Must be true (or provide an authorized user_instruction / proposal_id) to execute this PayPal Sandbox write operation."
        },
        "user_instruction": {
          "type": "string",
          "description": "Optional explicit user instruction authorizing this write within the $500/$2,500 guardrails."
        },
        "proposal_id": {
          "type": "string",
          "description": "Optional session-bound proposal ID authorizing this write."
        },
        "actor_role": {
          "type": "string",
          "enum": [
            "provider",
            "patient"
          ],
          "description": "Caller role for server-side RBAC verification (default: provider)."
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session identifier."
        }
      }
    }
  },
  // 32. create_recurring_series
  {
    "name": "create_recurring_series",
    "description": "[CONFIRMED_WRITE] Official PayPal MCP Tool (Invoicing v2 (Recurring) — POST /v2/invoicing/recurring-invoices): Create a recurring invoice series on PayPal.\n\nThis function creates a recurring invoice series that automatically generates and sends invoices to a customer on a schedule, specifying a billing frequency, a start date, a currency code, a primary recipient, and line items for the series template.\n\nprimary_recipients and items use PayPal's real nested shape (billing_info/shipping_info for recipients; unit_amount/tax/discount for items); other fields use a simplified flat shape.\n\nA newly created series is in DRAFT status and will not generate invoices until activated -- call activate_recurring_series with the returned series ID to activate it.",
    "source": "official_paypal_mcp",
    "officialPayPalEquivalent": "create_recurring_series",
    "classification": "confirmed_demo_write",
    "readVsWrite": "write",
    "permissions": "provider_only",
    "externalAuthRequired": "paypal_merchant_oauth",
    "idempotencyRequired": true,
    "auditEvent": "paypal_mcp_create_recurring_series",
    "errorHandling": "400 INVALID_REQUEST; 403 AUTHORIZATION_REQUIRED; 422 GUARDRAIL_SINGLE_ACTION_LIMIT_EXCEEDED",
    "requiredParams": [
      "interval_unit",
      "interval_count",
      "start_series_date",
      "currency_code",
      "primary_recipients"
    ],
    "optionalParams": [
      "total_cycles",
      "reference",
      "note",
      "invoicer_business_name",
      "invoicer_given_name",
      "invoicer_surname",
      "invoicer_email_address",
      "invoicer_tax_id",
      "invoicer_address_line_1",
      "invoicer_address_line_2",
      "invoicer_city",
      "invoicer_state",
      "invoicer_postal_code",
      "invoicer_country_code",
      "items",
      "allow_tip",
      "shipping_cost",
      "allow_partial_payment",
      "minimum_partial_payment_amount",
      "explicit_human_approval",
      "user_instruction",
      "proposal_id",
      "actor_role",
      "demo_session_id"
    ],
    "sandboxAvailability": "AVAILABLE_LIVE_SANDBOX",
    "equivalentRestEndpoint": "POST /v2/invoicing/recurring-invoices",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/invoicing"
    ],
    "annotations": {
      "title": "PayPal MCP: Create Recurring Series",
      "readOnlyHint": false,
      "destructiveHint": false,
      "idempotentHint": false,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "required": [
        "interval_unit",
        "interval_count",
        "start_series_date",
        "currency_code",
        "primary_recipients"
      ],
      "properties": {
        "interval_unit": {
          "type": "string",
          "description": "The time unit for the recurring invoice cycle interval",
          "enum": [
            "DAY",
            "WEEK",
            "MONTH",
            "YEAR"
          ]
        },
        "interval_count": {
          "type": "integer",
          "description": "The number of intervals between each recurring invoice cycle. For example, an interval_count of 2 with interval_unit of MONTH means the invoice recurs every 2 months"
        },
        "start_series_date": {
          "type": "string",
          "description": "The date when the recurring series begins and the first invoice is generated, in yyyy-MM-DD format. Cannot be a past date."
        },
        "total_cycles": {
          "type": "integer",
          "description": "The total number of invoices to generate in the series. If omitted, the series runs indefinitely until cancelled."
        },
        "reference": {
          "type": "string",
          "description": "A reference value, such as a purchase order number."
        },
        "currency_code": {
          "type": "string",
          "description": "Currency code of the recurring invoice series"
        },
        "note": {
          "type": "string",
          "description": "A note to the invoice recipient. Also appears on the invoice notification email."
        },
        "invoicer_business_name": {
          "type": "string",
          "description": "The business name of the invoicer."
        },
        "invoicer_given_name": {
          "type": "string",
          "description": "The first name of the invoicer."
        },
        "invoicer_surname": {
          "type": "string",
          "description": "The last name of the invoicer."
        },
        "invoicer_email_address": {
          "type": "string",
          "description": "The email address of the invoicer."
        },
        "invoicer_tax_id": {
          "type": "string",
          "description": "The invoicer's tax ID."
        },
        "invoicer_address_line_1": {
          "type": "string",
          "description": "The first line of the invoicer's address, for example, number and street."
        },
        "invoicer_address_line_2": {
          "type": "string",
          "description": "The second line of the invoicer's address, for example, suite or apartment number."
        },
        "invoicer_city": {
          "type": "string",
          "description": "The city, town, or village of the invoicer's address."
        },
        "invoicer_state": {
          "type": "string",
          "description": "The state or province of the invoicer's address."
        },
        "invoicer_postal_code": {
          "type": "string",
          "description": "The postal code of the invoicer's address."
        },
        "invoicer_country_code": {
          "type": "string",
          "description": "The two-character ISO 3166-1 country code of the invoicer's address (for example, US or GB)."
        },
        "primary_recipients": {
          "type": "array",
          "description": "The primary recipient of the recurring invoices",
          "items": {
            "type": "object",
            "properties": {
              "billing_info": {
                "type": "object",
                "properties": {
                  "business_name": {
                    "type": "string",
                    "description": "The business name of the invoice recipient."
                  },
                  "name": {
                    "type": "object",
                    "properties": {
                      "given_name": {
                        "type": "string",
                        "description": "The first name of the person."
                      },
                      "surname": {
                        "type": "string",
                        "description": "The last name of the person."
                      }
                    },
                    "additionalProperties": false,
                    "description": "name of the recipient"
                  },
                  "address": {
                    "type": "object",
                    "properties": {
                      "address_line_1": {
                        "type": "string",
                        "description": "The first line of the address, for example, number and street."
                      },
                      "address_line_2": {
                        "type": "string",
                        "description": "The second line of the address, for example, suite or apartment number."
                      },
                      "admin_area_2": {
                        "type": "string",
                        "description": "A city, town, or village."
                      },
                      "admin_area_1": {
                        "type": "string",
                        "description": "The highest-level sub-division in a country, such as a state or province."
                      },
                      "postal_code": {
                        "type": "string",
                        "description": "The postal code, which is the zip code or equivalent."
                      },
                      "country_code": {
                        "type": "string",
                        "pattern": "^([A-Z]{2}|C2)$",
                        "description": "The two-character ISO 3166-1 country code (for example, US or GB)."
                      }
                    },
                    "additionalProperties": false,
                    "description": "The address of the invoice recipient."
                  },
                  "email_address": {
                    "type": "string",
                    "description": "email address of the recipient"
                  },
                  "phones": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "properties": {
                        "country_code": {
                          "type": "string",
                          "description": "The country calling code, in E.164 format (for example, '1' for the United States)."
                        },
                        "national_number": {
                          "type": "string",
                          "description": "The national number, in E.164 format."
                        },
                        "phone_type": {
                          "type": "string",
                          "enum": [
                            "FAX",
                            "HOME",
                            "MOBILE",
                            "OTHER",
                            "PAGER"
                          ],
                          "description": "The type of phone number."
                        }
                      },
                      "required": [
                        "country_code",
                        "national_number",
                        "phone_type"
                      ],
                      "additionalProperties": false,
                      "description": "phone object"
                    },
                    "description": "The invoice recipient's phone numbers."
                  },
                  "additional_info": {
                    "type": "string",
                    "maxLength": 40,
                    "description": "Any additional information about the recipient."
                  },
                  "language": {
                    "type": "string",
                    "pattern": "^[a-z]{2}(-[A-Z][a-z]{3})?(-([A-Z]{2}|[0-9]{3}))?$",
                    "description": "The BCP-47 language tag used for the recipient's email notification (for example, 'en-US'). Only used when the recipient has no PayPal account."
                  }
                },
                "additionalProperties": false,
                "description": "The billing information of the invoice recipient"
              },
              "shipping_info": {
                "type": "object",
                "properties": {
                  "business_name": {
                    "type": "string",
                    "description": "The business name for the shipping destination."
                  },
                  "name": {
                    "type": "object",
                    "properties": {
                      "given_name": {
                        "type": "string",
                        "description": "The first name of the person."
                      },
                      "surname": {
                        "type": "string",
                        "description": "The last name of the person."
                      }
                    },
                    "additionalProperties": false,
                    "description": "The name for the shipping destination."
                  },
                  "address": {
                    "type": "object",
                    "properties": {
                      "address_line_1": {
                        "type": "string",
                        "description": "The first line of the address, for example, number and street."
                      },
                      "address_line_2": {
                        "type": "string",
                        "description": "The second line of the address, for example, suite or apartment number."
                      },
                      "admin_area_2": {
                        "type": "string",
                        "description": "A city, town, or village."
                      },
                      "admin_area_1": {
                        "type": "string",
                        "description": "The highest-level sub-division in a country, such as a state or province."
                      },
                      "postal_code": {
                        "type": "string",
                        "description": "The postal code, which is the zip code or equivalent."
                      },
                      "country_code": {
                        "type": "string",
                        "pattern": "^([A-Z]{2}|C2)$",
                        "description": "The two-character ISO 3166-1 country code (for example, US or GB)."
                      }
                    },
                    "additionalProperties": false,
                    "description": "The shipping address."
                  }
                },
                "additionalProperties": false,
                "description": "The shipping information of the invoice recipient."
              }
            },
            "additionalProperties": false
          }
        },
        "items": {
          "type": "array",
          "description": "The line items that will appear on each invoice in the recurring series",
          "items": {
            "type": "object",
            "properties": {
              "name": {
                "type": "string",
                "description": "The name of the item"
              },
              "description": {
                "type": "string",
                "description": "The description of the item."
              },
              "quantity": {
                "type": "string",
                "description": "The quantity of the item that the invoicer provides to the payer. Value is from -1000000 to 1000000. Supports up to five decimal places. Cast to string"
              },
              "unit_amount": {
                "type": "object",
                "properties": {
                  "currency_code": {
                    "type": "string",
                    "description": "The three-character ISO-4217 currency code that identifies the currency."
                  },
                  "value": {
                    "type": "string",
                    "pattern": "^((-?[0-9]+)|(-?([0-9]+)?[.][0-9]+))$",
                    "description": "The amount, as a signed decimal string with up to 2 decimal places (e.g. '50.00')."
                  }
                },
                "required": [
                  "currency_code",
                  "value"
                ],
                "additionalProperties": false,
                "description": "The unit price of the item. Does not include tax or discount."
              },
              "tax": {
                "type": "object",
                "properties": {
                  "name": {
                    "type": "string",
                    "description": "The name of the tax applied on the item, for example 'Sales Tax'."
                  },
                  "percent": {
                    "type": "string",
                    "pattern": "^((-?[0-9]+)|(-?([0-9]+)?[.][0-9]+))$",
                    "description": "The tax rate, as a percent value from 0 to 100. Supports up to five decimal places."
                  },
                  "tax_note": {
                    "type": "string",
                    "description": "A note about the tax, used to track tax-related data."
                  }
                },
                "required": [
                  "name",
                  "percent"
                ],
                "additionalProperties": false,
                "description": "tax object"
              },
              "discount": {
                "type": "object",
                "properties": {
                  "percent": {
                    "type": "string",
                    "pattern": "^((-?[0-9]+)|(-?([0-9]+)?[.][0-9]+))$",
                    "description": "The discount as a percent value, from 0 to 100. Supports up to five decimal places. Mutually exclusive with amount -- set only one."
                  },
                  "amount": {
                    "type": "object",
                    "properties": {
                      "currency_code": {
                        "type": "string",
                        "description": "The three-character ISO-4217 currency code that identifies the currency."
                      },
                      "value": {
                        "type": "string",
                        "pattern": "^((-?[0-9]+)|(-?([0-9]+)?[.][0-9]+))$",
                        "description": "The amount, as a signed decimal string with up to 2 decimal places (e.g. '50.00')."
                      }
                    },
                    "required": [
                      "currency_code",
                      "value"
                    ],
                    "additionalProperties": false,
                    "description": "The discount as a fixed amount. Mutually exclusive with percent -- set only one."
                  }
                },
                "additionalProperties": false,
                "description": "The discount for this line item, subtracted from the item total."
              },
              "item_date": {
                "type": "string",
                "pattern": "^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[1-2][0-9]|3[0-1])$",
                "description": "The date, in yyyy-MM-DD format, when the item or service was provided."
              },
              "unit_of_measure": {
                "type": "string",
                "enum": [
                  "QUANTITY",
                  "HOURS",
                  "AMOUNT"
                ],
                "description": "The unit of measure for the invoiced item"
              }
            },
            "required": [
              "name",
              "quantity",
              "unit_amount"
            ],
            "additionalProperties": false,
            "description": "invoice line item object"
          }
        },
        "allow_tip": {
          "type": "boolean",
          "description": "Whether the payer can add a tip when paying. Not available in Hong Kong, Taiwan, India, or Japan."
        },
        "shipping_cost": {
          "type": "string",
          "description": "The shipping cost for each generated invoice, in the series' currency_code."
        },
        "allow_partial_payment": {
          "type": "boolean",
          "description": "Whether each generated invoice allows a partial payment. If false, each invoice must be paid in full. If true, each invoice allows partial payments. Not available for users in India, Brazil, or Israel."
        },
        "minimum_partial_payment_amount": {
          "type": "string",
          "description": "The minimum amount allowed for a partial payment on each generated invoice, in the series' currency_code. Valid only when allow_partial_payment is true."
        },
        "explicit_human_approval": {
          "type": "boolean",
          "description": "Must be true (or provide an authorized user_instruction / proposal_id) to execute this PayPal Sandbox write operation."
        },
        "user_instruction": {
          "type": "string",
          "description": "Optional explicit user instruction authorizing this write within the $500/$2,500 guardrails."
        },
        "proposal_id": {
          "type": "string",
          "description": "Optional session-bound proposal ID authorizing this write."
        },
        "actor_role": {
          "type": "string",
          "enum": [
            "provider",
            "patient"
          ],
          "description": "Caller role for server-side RBAC verification (default: provider)."
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session identifier."
        }
      }
    }
  },
  // 33. activate_recurring_series
  {
    "name": "activate_recurring_series",
    "description": "[CONFIRMED_WRITE] Official PayPal MCP Tool (Invoicing v2 (Recurring) — POST /v2/invoicing/recurring-invoices/{recurring_series_id}/activate): Activate a recurring invoice series on PayPal.\n\nThis function activates a recurring invoice series by its ID, moving it out of DRAFT status. Once activated, PayPal automatically generates and sends invoices to the customer based on the series' configured schedule. Call this after create_recurring_series to make the series active.",
    "source": "official_paypal_mcp",
    "officialPayPalEquivalent": "activate_recurring_series",
    "classification": "confirmed_demo_write",
    "readVsWrite": "write",
    "permissions": "provider_only",
    "externalAuthRequired": "paypal_merchant_oauth",
    "idempotencyRequired": true,
    "auditEvent": "paypal_mcp_activate_recurring_series",
    "errorHandling": "404 RESOURCE_NOT_FOUND; 422 UNPROCESSABLE_ENTITY; 403 AUTHORIZATION_REQUIRED",
    "requiredParams": [
      "recurring_series_id"
    ],
    "optionalParams": [
      "explicit_human_approval",
      "user_instruction",
      "proposal_id",
      "actor_role",
      "demo_session_id"
    ],
    "sandboxAvailability": "AVAILABLE_LIVE_SANDBOX",
    "equivalentRestEndpoint": "POST /v2/invoicing/recurring-invoices/{recurring_series_id}/activate",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/invoicing"
    ],
    "annotations": {
      "title": "PayPal MCP: Activate Recurring Series",
      "readOnlyHint": false,
      "destructiveHint": false,
      "idempotentHint": false,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "required": [
        "recurring_series_id"
      ],
      "properties": {
        "recurring_series_id": {
          "type": "string",
          "description": "The ID of the recurring invoice series to activate."
        },
        "explicit_human_approval": {
          "type": "boolean",
          "description": "Must be true (or provide an authorized user_instruction / proposal_id) to execute this PayPal Sandbox write operation."
        },
        "user_instruction": {
          "type": "string",
          "description": "Optional explicit user instruction authorizing this write within the $500/$2,500 guardrails."
        },
        "proposal_id": {
          "type": "string",
          "description": "Optional session-bound proposal ID authorizing this write."
        },
        "actor_role": {
          "type": "string",
          "enum": [
            "provider",
            "patient"
          ],
          "description": "Caller role for server-side RBAC verification (default: provider)."
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session identifier."
        }
      }
    }
  },
  // 34. get_recurring_series
  {
    "name": "get_recurring_series",
    "description": "[READ_ONLY] Official PayPal MCP Tool (Invoicing v2 (Recurring) — GET /v2/invoicing/recurring-invoices/{recurring_series_id}): Get a recurring invoice series from PayPal.\n\nThis function retrieves details of a specific recurring invoice series using its ID, including its schedule, status, template, and recipient information.",
    "source": "official_paypal_mcp",
    "officialPayPalEquivalent": "get_recurring_series",
    "classification": "read_only",
    "readVsWrite": "read",
    "permissions": "provider_or_customer",
    "externalAuthRequired": "paypal_merchant_oauth",
    "idempotencyRequired": false,
    "auditEvent": null,
    "errorHandling": "404 RESOURCE_NOT_FOUND",
    "requiredParams": [
      "recurring_series_id"
    ],
    "optionalParams": [
      "demo_session_id"
    ],
    "sandboxAvailability": "AVAILABLE_LIVE_SANDBOX",
    "equivalentRestEndpoint": "GET /v2/invoicing/recurring-invoices/{recurring_series_id}",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/invoicing"
    ],
    "annotations": {
      "title": "PayPal MCP: Get Recurring Series",
      "readOnlyHint": true,
      "destructiveHint": false,
      "idempotentHint": true,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "required": [
        "recurring_series_id"
      ],
      "properties": {
        "recurring_series_id": {
          "type": "string",
          "description": "The ID of the recurring invoice series to retrieve."
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session identifier."
        }
      }
    }
  },
  // 35. cancel_recurring_series
  {
    "name": "cancel_recurring_series",
    "description": "[CONFIRMED_WRITE] Official PayPal MCP Tool (Invoicing v2 (Recurring) — POST /v2/invoicing/recurring-invoices/{recurring_series_id}/cancel): Cancel a recurring invoice series on PayPal.\n\nThis function cancels a recurring invoice series by its ID. Once cancelled, PayPal stops generating and sending further invoices for the series. This action cannot be undone.",
    "source": "official_paypal_mcp",
    "officialPayPalEquivalent": "cancel_recurring_series",
    "classification": "confirmed_demo_write",
    "readVsWrite": "write",
    "permissions": "provider_only",
    "externalAuthRequired": "paypal_merchant_oauth",
    "idempotencyRequired": true,
    "auditEvent": "paypal_mcp_cancel_recurring_series",
    "errorHandling": "404 RESOURCE_NOT_FOUND; 422 SERIES_NOT_ACTIVE; 403 AUTHORIZATION_REQUIRED",
    "requiredParams": [
      "recurring_series_id"
    ],
    "optionalParams": [
      "explicit_human_approval",
      "user_instruction",
      "proposal_id",
      "actor_role",
      "demo_session_id"
    ],
    "sandboxAvailability": "AVAILABLE_LIVE_SANDBOX",
    "equivalentRestEndpoint": "POST /v2/invoicing/recurring-invoices/{recurring_series_id}/cancel",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/invoicing"
    ],
    "annotations": {
      "title": "PayPal MCP: Cancel Recurring Series",
      "readOnlyHint": false,
      "destructiveHint": true,
      "idempotentHint": false,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "required": [
        "recurring_series_id"
      ],
      "properties": {
        "recurring_series_id": {
          "type": "string",
          "description": "The ID of the recurring invoice series to cancel."
        },
        "explicit_human_approval": {
          "type": "boolean",
          "description": "Must be true (or provide an authorized user_instruction / proposal_id) to execute this PayPal Sandbox write operation."
        },
        "user_instruction": {
          "type": "string",
          "description": "Optional explicit user instruction authorizing this write within the $500/$2,500 guardrails."
        },
        "proposal_id": {
          "type": "string",
          "description": "Optional session-bound proposal ID authorizing this write."
        },
        "actor_role": {
          "type": "string",
          "enum": [
            "provider",
            "patient"
          ],
          "description": "Caller role for server-side RBAC verification (default: provider)."
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session identifier."
        }
      }
    }
  },
  // 36. delete_recurring_series
  {
    "name": "delete_recurring_series",
    "description": "[CONFIRMED_WRITE] Official PayPal MCP Tool (Invoicing v2 (Recurring) — DELETE /v2/invoicing/recurring-invoices/{recurring_series_id}): Delete a recurring invoice series on PayPal.\n\nThis function permanently deletes a recurring invoice series by its ID. Only series in DRAFT status can be deleted -- for a series that has already been activated, use cancel_recurring_series instead. This action cannot be undone.",
    "source": "official_paypal_mcp",
    "officialPayPalEquivalent": "delete_recurring_series",
    "classification": "confirmed_demo_write",
    "readVsWrite": "write",
    "permissions": "provider_only",
    "externalAuthRequired": "paypal_merchant_oauth",
    "idempotencyRequired": true,
    "auditEvent": "paypal_mcp_delete_recurring_series",
    "errorHandling": "404 RESOURCE_NOT_FOUND; 422 CANNOT_DELETE_ACTIVE_SERIES; 403 AUTHORIZATION_REQUIRED",
    "requiredParams": [
      "recurring_series_id"
    ],
    "optionalParams": [
      "explicit_human_approval",
      "user_instruction",
      "proposal_id",
      "actor_role",
      "demo_session_id"
    ],
    "sandboxAvailability": "AVAILABLE_LIVE_SANDBOX",
    "equivalentRestEndpoint": "DELETE /v2/invoicing/recurring-invoices/{recurring_series_id}",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/invoicing"
    ],
    "annotations": {
      "title": "PayPal MCP: Delete Recurring Series",
      "readOnlyHint": false,
      "destructiveHint": true,
      "idempotentHint": true,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "required": [
        "recurring_series_id"
      ],
      "properties": {
        "recurring_series_id": {
          "type": "string",
          "description": "The ID of the recurring invoice series to delete. Only series in DRAFT status can be deleted; use cancel_recurring_series for an activated series."
        },
        "explicit_human_approval": {
          "type": "boolean",
          "description": "Must be true (or provide an authorized user_instruction / proposal_id) to execute this PayPal Sandbox write operation."
        },
        "user_instruction": {
          "type": "string",
          "description": "Optional explicit user instruction authorizing this write within the $500/$2,500 guardrails."
        },
        "proposal_id": {
          "type": "string",
          "description": "Optional session-bound proposal ID authorizing this write."
        },
        "actor_role": {
          "type": "string",
          "enum": [
            "provider",
            "patient"
          ],
          "description": "Caller role for server-side RBAC verification (default: provider)."
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session identifier."
        }
      }
    }
  },
  // 37. list_invoices
  {
    "name": "list_invoices",
    "description": "[READ_ONLY] Official PayPal MCP Tool (Invoicing v2 — GET /v2/invoicing/invoices): List invoices from PayPal.\n\nThis function retrieves a list of invoices with optional pagination parameters.",
    "source": "official_paypal_mcp",
    "officialPayPalEquivalent": "list_invoices",
    "classification": "read_only",
    "readVsWrite": "read",
    "permissions": "provider_or_customer",
    "externalAuthRequired": "paypal_merchant_oauth",
    "idempotencyRequired": false,
    "auditEvent": null,
    "errorHandling": "400 INVALID_PARAMETER_VALUE",
    "requiredParams": [],
    "optionalParams": [
      "page",
      "page_size",
      "total_required",
      "demo_session_id"
    ],
    "sandboxAvailability": "AVAILABLE_LIVE_SANDBOX",
    "equivalentRestEndpoint": "GET /v2/invoicing/invoices",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/invoicing"
    ],
    "annotations": {
      "title": "PayPal MCP: List Invoices",
      "readOnlyHint": true,
      "destructiveHint": false,
      "idempotentHint": true,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "properties": {
        "page": {
          "type": "number",
          "description": "The page number of the result set to fetch."
        },
        "page_size": {
          "type": "number",
          "description": "The number of records to return per page (maximum 100)."
        },
        "total_required": {
          "type": "boolean",
          "description": "Indicates whether the response should include the total count of items."
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session identifier."
        }
      }
    }
  },
  // 38. get_invoice
  {
    "name": "get_invoice",
    "description": "[READ_ONLY] Official PayPal MCP Tool (Invoicing v2 — GET /v2/invoicing/invoices/{invoice_id}): Get an invoice from PayPal.\n\nThis function retrieves details of a specific invoice using its ID.",
    "source": "official_paypal_mcp",
    "officialPayPalEquivalent": "get_invoice",
    "classification": "read_only",
    "readVsWrite": "read",
    "permissions": "provider_or_customer",
    "externalAuthRequired": "paypal_merchant_oauth",
    "idempotencyRequired": false,
    "auditEvent": null,
    "errorHandling": "404 RESOURCE_NOT_FOUND",
    "requiredParams": [
      "invoice_id"
    ],
    "optionalParams": [
      "demo_session_id"
    ],
    "sandboxAvailability": "AVAILABLE_LIVE_SANDBOX",
    "equivalentRestEndpoint": "GET /v2/invoicing/invoices/{invoice_id}",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/invoicing"
    ],
    "annotations": {
      "title": "PayPal MCP: Get Invoice",
      "readOnlyHint": true,
      "destructiveHint": false,
      "idempotentHint": true,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "required": [
        "invoice_id"
      ],
      "properties": {
        "invoice_id": {
          "type": "string",
          "description": "The ID of the invoice to retrieve."
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session identifier."
        }
      }
    }
  },
  // 39. send_invoice
  {
    "name": "send_invoice",
    "description": "[CONFIRMED_WRITE] Official PayPal MCP Tool (Invoicing v2 — POST /v2/invoicing/invoices/{invoice_id}/send): Send an invoice to the recipient(s).\n\nThis function sends a previously created invoice to its intended recipients.",
    "source": "official_paypal_mcp",
    "officialPayPalEquivalent": "send_invoice",
    "classification": "confirmed_demo_write",
    "readVsWrite": "write",
    "permissions": "provider_only",
    "externalAuthRequired": "paypal_merchant_oauth",
    "idempotencyRequired": true,
    "auditEvent": "paypal_mcp_send_invoice",
    "errorHandling": "404 RESOURCE_NOT_FOUND; 422 INVOICE_ALREADY_SENT; 403 AUTHORIZATION_REQUIRED",
    "requiredParams": [
      "invoice_id"
    ],
    "optionalParams": [
      "note",
      "send_to_recipient",
      "additional_recipients",
      "explicit_human_approval",
      "user_instruction",
      "proposal_id",
      "actor_role",
      "demo_session_id"
    ],
    "sandboxAvailability": "AVAILABLE_LIVE_SANDBOX",
    "equivalentRestEndpoint": "POST /v2/invoicing/invoices/{invoice_id}/send",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/invoicing"
    ],
    "annotations": {
      "title": "PayPal MCP: Send Invoice",
      "readOnlyHint": false,
      "destructiveHint": false,
      "idempotentHint": false,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "required": [
        "invoice_id"
      ],
      "properties": {
        "invoice_id": {
          "type": "string",
          "description": "The ID of the invoice to send."
        },
        "note": {
          "type": "string",
          "description": "A note to the recipient."
        },
        "send_to_recipient": {
          "type": "boolean",
          "description": "Indicates whether to send the invoice to the recipient."
        },
        "additional_recipients": {
          "type": "array",
          "description": "Additional email addresses to which to send the invoice.",
          "items": {
            "type": "string"
          }
        },
        "explicit_human_approval": {
          "type": "boolean",
          "description": "Must be true (or provide an authorized user_instruction / proposal_id) to execute this PayPal Sandbox write operation."
        },
        "user_instruction": {
          "type": "string",
          "description": "Optional explicit user instruction authorizing this write within the $500/$2,500 guardrails."
        },
        "proposal_id": {
          "type": "string",
          "description": "Optional session-bound proposal ID authorizing this write."
        },
        "actor_role": {
          "type": "string",
          "enum": [
            "provider",
            "patient"
          ],
          "description": "Caller role for server-side RBAC verification (default: provider)."
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session identifier."
        }
      }
    }
  },
  // 40. send_invoice_reminder
  {
    "name": "send_invoice_reminder",
    "description": "[CONFIRMED_WRITE] Official PayPal MCP Tool (Invoicing v2 — POST /v2/invoicing/invoices/{invoice_id}/remind): Send a reminder for an invoice.\n\nThis function sends a reminder for an invoice that has already been sent but hasn't been paid yet.",
    "source": "official_paypal_mcp",
    "officialPayPalEquivalent": "send_invoice_reminder",
    "classification": "confirmed_demo_write",
    "readVsWrite": "write",
    "permissions": "provider_only",
    "externalAuthRequired": "paypal_merchant_oauth",
    "idempotencyRequired": true,
    "auditEvent": "paypal_mcp_send_invoice_reminder",
    "errorHandling": "404 RESOURCE_NOT_FOUND; 422 INVOICE_NOT_SENT; 403 AUTHORIZATION_REQUIRED",
    "requiredParams": [
      "invoice_id"
    ],
    "optionalParams": [
      "subject",
      "note",
      "additional_recipients",
      "explicit_human_approval",
      "user_instruction",
      "proposal_id",
      "actor_role",
      "demo_session_id"
    ],
    "sandboxAvailability": "AVAILABLE_LIVE_SANDBOX",
    "equivalentRestEndpoint": "POST /v2/invoicing/invoices/{invoice_id}/remind",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/invoicing"
    ],
    "annotations": {
      "title": "PayPal MCP: Send Invoice Reminder",
      "readOnlyHint": false,
      "destructiveHint": false,
      "idempotentHint": false,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "required": [
        "invoice_id"
      ],
      "properties": {
        "invoice_id": {
          "type": "string",
          "description": "The ID of the invoice for which to send a reminder."
        },
        "subject": {
          "type": "string",
          "description": "The subject of the reminder email."
        },
        "note": {
          "type": "string",
          "description": "A note to the recipient."
        },
        "additional_recipients": {
          "type": "array",
          "description": "Additional email addresses to which to send the reminder.",
          "items": {
            "type": "string"
          }
        },
        "explicit_human_approval": {
          "type": "boolean",
          "description": "Must be true (or provide an authorized user_instruction / proposal_id) to execute this PayPal Sandbox write operation."
        },
        "user_instruction": {
          "type": "string",
          "description": "Optional explicit user instruction authorizing this write within the $500/$2,500 guardrails."
        },
        "proposal_id": {
          "type": "string",
          "description": "Optional session-bound proposal ID authorizing this write."
        },
        "actor_role": {
          "type": "string",
          "enum": [
            "provider",
            "patient"
          ],
          "description": "Caller role for server-side RBAC verification (default: provider)."
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session identifier."
        }
      }
    }
  },
  // 41. cancel_sent_invoice
  {
    "name": "cancel_sent_invoice",
    "description": "[CONFIRMED_WRITE] Official PayPal MCP Tool (Invoicing v2 — POST /v2/invoicing/invoices/{invoice_id}/cancel): Cancel a sent invoice.\n\nThis function cancels an invoice that has already been sent to the recipient(s).",
    "source": "official_paypal_mcp",
    "officialPayPalEquivalent": "cancel_sent_invoice",
    "classification": "confirmed_demo_write",
    "readVsWrite": "write",
    "permissions": "provider_only",
    "externalAuthRequired": "paypal_merchant_oauth",
    "idempotencyRequired": true,
    "auditEvent": "paypal_mcp_cancel_sent_invoice",
    "errorHandling": "404 RESOURCE_NOT_FOUND; 422 CANNOT_CANCEL_DRAFT_OR_PAID; 403 AUTHORIZATION_REQUIRED",
    "requiredParams": [
      "invoice_id"
    ],
    "optionalParams": [
      "note",
      "send_to_recipient",
      "additional_recipients",
      "explicit_human_approval",
      "user_instruction",
      "proposal_id",
      "actor_role",
      "demo_session_id"
    ],
    "sandboxAvailability": "AVAILABLE_LIVE_SANDBOX",
    "equivalentRestEndpoint": "POST /v2/invoicing/invoices/{invoice_id}/cancel",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/invoicing"
    ],
    "annotations": {
      "title": "PayPal MCP: Cancel Sent Invoice",
      "readOnlyHint": false,
      "destructiveHint": true,
      "idempotentHint": false,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "required": [
        "invoice_id"
      ],
      "properties": {
        "invoice_id": {
          "type": "string",
          "description": "The ID of the invoice to cancel."
        },
        "note": {
          "type": "string",
          "description": "A cancellation note to the recipient."
        },
        "send_to_recipient": {
          "type": "boolean",
          "description": "Indicates whether to send the cancellation to the recipient."
        },
        "additional_recipients": {
          "type": "array",
          "description": "Additional email addresses to which to send the cancellation.",
          "items": {
            "type": "string"
          }
        },
        "explicit_human_approval": {
          "type": "boolean",
          "description": "Must be true (or provide an authorized user_instruction / proposal_id) to execute this PayPal Sandbox write operation."
        },
        "user_instruction": {
          "type": "string",
          "description": "Optional explicit user instruction authorizing this write within the $500/$2,500 guardrails."
        },
        "proposal_id": {
          "type": "string",
          "description": "Optional session-bound proposal ID authorizing this write."
        },
        "actor_role": {
          "type": "string",
          "enum": [
            "provider",
            "patient"
          ],
          "description": "Caller role for server-side RBAC verification (default: provider)."
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session identifier."
        }
      }
    }
  },
  // 42. delete_invoice
  {
    "name": "delete_invoice",
    "description": "[CONFIRMED_WRITE] Official PayPal MCP Tool (Invoicing v2 — DELETE /v2/invoicing/invoices/{invoice_id}): Delete a draft or scheduled invoice on PayPal.\n\nThis function permanently deletes an invoice that is in the draft or scheduled state, by ID. It does not work on invoices that have already been sent -- use cancel_sent_invoice for those instead. After deletion, the invoice's details can no longer be retrieved, but its invoice number can be reused.",
    "source": "official_paypal_mcp",
    "officialPayPalEquivalent": "delete_invoice",
    "classification": "confirmed_demo_write",
    "readVsWrite": "write",
    "permissions": "provider_only",
    "externalAuthRequired": "paypal_merchant_oauth",
    "idempotencyRequired": true,
    "auditEvent": "paypal_mcp_delete_invoice",
    "errorHandling": "404 RESOURCE_NOT_FOUND; 422 CANNOT_DELETE_SENT_INVOICE; 403 AUTHORIZATION_REQUIRED",
    "requiredParams": [
      "invoice_id"
    ],
    "optionalParams": [
      "explicit_human_approval",
      "user_instruction",
      "proposal_id",
      "actor_role",
      "demo_session_id"
    ],
    "sandboxAvailability": "AVAILABLE_LIVE_SANDBOX",
    "equivalentRestEndpoint": "DELETE /v2/invoicing/invoices/{invoice_id}",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/invoicing"
    ],
    "annotations": {
      "title": "PayPal MCP: Delete Invoice",
      "readOnlyHint": false,
      "destructiveHint": true,
      "idempotentHint": true,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "required": [
        "invoice_id"
      ],
      "properties": {
        "invoice_id": {
          "type": "string",
          "description": "The ID of the draft or scheduled invoice to delete."
        },
        "explicit_human_approval": {
          "type": "boolean",
          "description": "Must be true (or provide an authorized user_instruction / proposal_id) to execute this PayPal Sandbox write operation."
        },
        "user_instruction": {
          "type": "string",
          "description": "Optional explicit user instruction authorizing this write within the $500/$2,500 guardrails."
        },
        "proposal_id": {
          "type": "string",
          "description": "Optional session-bound proposal ID authorizing this write."
        },
        "actor_role": {
          "type": "string",
          "enum": [
            "provider",
            "patient"
          ],
          "description": "Caller role for server-side RBAC verification (default: provider)."
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session identifier."
        }
      }
    }
  },
  // 43. setup_invoice_auto_reminders
  {
    "name": "setup_invoice_auto_reminders",
    "description": "[CONFIRMED_WRITE] Official PayPal MCP Tool (Invoicing v2 (Reminders) — POST /v2/invoicing/setup-reminders): Initialize the invoice auto reminder configuration for the merchant's PayPal account.\n\nThis function sets up automatic reminders for unpaid invoices, for BEFORE_DUE and/or AFTER_DUE reminder types.",
    "source": "official_paypal_mcp",
    "officialPayPalEquivalent": "setup_invoice_auto_reminders",
    "classification": "confirmed_demo_write",
    "readVsWrite": "write",
    "permissions": "provider_only",
    "externalAuthRequired": "paypal_merchant_oauth",
    "idempotencyRequired": true,
    "auditEvent": "paypal_mcp_setup_invoice_auto_reminders",
    "errorHandling": "400 INVALID_REQUEST; 403 AUTHORIZATION_REQUIRED",
    "requiredParams": [],
    "optionalParams": [
      "configurations",
      "explicit_human_approval",
      "user_instruction",
      "proposal_id",
      "actor_role",
      "demo_session_id"
    ],
    "sandboxAvailability": "AVAILABLE_LIVE_SANDBOX",
    "equivalentRestEndpoint": "POST /v2/invoicing/setup-reminders",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/invoicing"
    ],
    "annotations": {
      "title": "PayPal MCP: Setup Invoice Auto Reminders",
      "readOnlyHint": false,
      "destructiveHint": false,
      "idempotentHint": false,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "properties": {
        "configurations": {
          "type": "array",
          "description": "An array of up to two invoice auto reminder configurations, one for BEFORE_DUE and one for AFTER_DUE. If omitted, both reminder types are created with the default configuration in INACTIVE state. If only one type is provided, the other is created with the default configuration in INACTIVE state.",
          "items": {
            "type": "object",
            "properties": {
              "type": {
                "type": "string",
                "enum": [
                  "BEFORE_DUE",
                  "AFTER_DUE"
                ],
                "description": "The type of reminder. BEFORE_DUE sends a reminder before the invoice due date; AFTER_DUE sends a reminder after the invoice due date."
              },
              "interval": {
                "type": "object",
                "properties": {
                  "unit": {
                    "type": "string",
                    "const": "DAY",
                    "default": "DAY",
                    "description": "The unit of time for the reminder interval. The interval unit is always DAY."
                  },
                  "value": {
                    "type": "integer",
                    "description": "The number of interval units before/after the due date at which to send the reminder."
                  }
                },
                "required": [
                  "value"
                ],
                "additionalProperties": false,
                "description": "The interval at which to send the reminder."
              },
              "repetition": {
                "type": "integer",
                "description": "The number of times to send the reminder. Must be 1 for BEFORE_DUE reminders."
              },
              "notification": {
                "type": "object",
                "properties": {
                  "send_to_invoicer": {
                    "type": "boolean",
                    "description": "Indicates whether to also notify the invoicer when the reminder is sent."
                  }
                },
                "additionalProperties": false,
                "description": "Notification settings for the reminder."
              }
            },
            "required": [
              "type",
              "interval",
              "repetition"
            ],
            "additionalProperties": false,
            "description": "An invoice auto reminder configuration."
          }
        },
        "explicit_human_approval": {
          "type": "boolean",
          "description": "Must be true (or provide an authorized user_instruction / proposal_id) to execute this PayPal Sandbox write operation."
        },
        "user_instruction": {
          "type": "string",
          "description": "Optional explicit user instruction authorizing this write within the $500/$2,500 guardrails."
        },
        "proposal_id": {
          "type": "string",
          "description": "Optional session-bound proposal ID authorizing this write."
        },
        "actor_role": {
          "type": "string",
          "enum": [
            "provider",
            "patient"
          ],
          "description": "Caller role for server-side RBAC verification (default: provider)."
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session identifier."
        }
      }
    }
  },
  // 44. update_invoice_auto_reminder
  {
    "name": "update_invoice_auto_reminder",
    "description": "[CONFIRMED_WRITE] Official PayPal MCP Tool (Invoicing v2 (Reminders) — PUT /v2/invoicing/reminders/{reminder_configuration_id}): Update an existing invoice auto reminder configuration by its configuration ID.\n\nThis function performs a full update of the reminder configuration's timing interval, repetition count and notification preferences.",
    "source": "official_paypal_mcp",
    "officialPayPalEquivalent": "update_invoice_auto_reminder",
    "classification": "confirmed_demo_write",
    "readVsWrite": "write",
    "permissions": "provider_only",
    "externalAuthRequired": "paypal_merchant_oauth",
    "idempotencyRequired": true,
    "auditEvent": "paypal_mcp_update_invoice_auto_reminder",
    "errorHandling": "404 RESOURCE_NOT_FOUND; 403 AUTHORIZATION_REQUIRED",
    "requiredParams": [
      "reminder_configuration_id",
      "type",
      "interval",
      "repetition"
    ],
    "optionalParams": [
      "status",
      "notification",
      "explicit_human_approval",
      "user_instruction",
      "proposal_id",
      "actor_role",
      "demo_session_id"
    ],
    "sandboxAvailability": "AVAILABLE_LIVE_SANDBOX",
    "equivalentRestEndpoint": "PUT /v2/invoicing/reminders/{reminder_configuration_id}",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/invoicing"
    ],
    "annotations": {
      "title": "PayPal MCP: Update Invoice Auto Reminder",
      "readOnlyHint": false,
      "destructiveHint": false,
      "idempotentHint": true,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "required": [
        "reminder_configuration_id",
        "type",
        "interval",
        "repetition"
      ],
      "properties": {
        "reminder_configuration_id": {
          "type": "string",
          "description": "The ID of the auto reminder configuration to update."
        },
        "type": {
          "type": "string",
          "enum": [
            "BEFORE_DUE",
            "AFTER_DUE"
          ]
        },
        "status": {
          "type": "string",
          "description": "Select an option.",
          "enum": [
            "NONE",
            "ACTIVE",
            "INACTIVE"
          ]
        },
        "interval": {
          "type": "object",
          "description": "The interval at which to send the reminder. The interval unit is always DAY.",
          "properties": {
            "value": {
              "type": "integer",
              "description": "The number of interval units before/after the due date at which to send the reminder."
            }
          }
        },
        "repetition": {
          "type": "integer",
          "description": "The number of times to send the reminder. Must be 1 for BEFORE_DUE reminders."
        },
        "notification": {
          "type": "object",
          "description": "Notification settings for the reminder.",
          "properties": {
            "send_to_invoicer": {
              "type": "boolean",
              "description": "Indicates whether to also notify the invoicer when the reminder is sent."
            }
          }
        },
        "explicit_human_approval": {
          "type": "boolean",
          "description": "Must be true (or provide an authorized user_instruction / proposal_id) to execute this PayPal Sandbox write operation."
        },
        "user_instruction": {
          "type": "string",
          "description": "Optional explicit user instruction authorizing this write within the $500/$2,500 guardrails."
        },
        "proposal_id": {
          "type": "string",
          "description": "Optional session-bound proposal ID authorizing this write."
        },
        "actor_role": {
          "type": "string",
          "enum": [
            "provider",
            "patient"
          ],
          "description": "Caller role for server-side RBAC verification (default: provider)."
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session identifier."
        }
      }
    }
  },
  // 45. search_invoicing
  {
    "name": "search_invoicing",
    "description": "[READ_ONLY] Official PayPal MCP Tool (Invoicing v2 — POST /v2/invoicing/search-invoices | /v2/invoicing/search-recurring-invoices): Search for invoices or recurring invoice series on PayPal.\n\nUse resource_type \"invoice\" with invoice_filters, or \"recurring_series\" with recurring_series_filters -- only set the matching filters object. Recurring series search covers only the past 3 years.",
    "source": "official_paypal_mcp",
    "officialPayPalEquivalent": "search_invoicing",
    "classification": "read_only",
    "readVsWrite": "read",
    "permissions": "provider_or_customer",
    "externalAuthRequired": "paypal_merchant_oauth",
    "idempotencyRequired": false,
    "auditEvent": null,
    "errorHandling": "400 INVALID_RESOURCE_TYPE_OR_FILTER_COMBINATION",
    "requiredParams": [
      "resource_type"
    ],
    "optionalParams": [
      "page",
      "page_size",
      "total_required",
      "invoice_filters",
      "recurring_series_filters",
      "demo_session_id"
    ],
    "sandboxAvailability": "AVAILABLE_LIVE_SANDBOX",
    "equivalentRestEndpoint": "POST /v2/invoicing/search-invoices | /v2/invoicing/search-recurring-invoices",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/invoicing"
    ],
    "annotations": {
      "title": "PayPal MCP: Search Invoicing",
      "readOnlyHint": true,
      "destructiveHint": false,
      "idempotentHint": true,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "required": [
        "resource_type"
      ],
      "properties": {
        "resource_type": {
          "type": "string",
          "description": "Which resource type to search. 'invoice' searches individual invoices using invoice_filters; 'recurring_series' searches recurring invoice series using recurring_series_filters.",
          "enum": [
            "invoice",
            "recurring_series"
          ]
        },
        "page": {
          "type": "integer",
          "description": "The page number of the result set to fetch."
        },
        "page_size": {
          "type": "integer",
          "description": "The number of records to return per page (maximum 100)."
        },
        "total_required": {
          "type": "boolean",
          "description": "Indicates whether the response should include the total count of matching invoices. Only applies when resource_type is 'invoice'."
        },
        "invoice_filters": {
          "type": "object",
          "description": "Filters to apply when resource_type is 'invoice'. Must not be set when resource_type is 'recurring_series'.",
          "properties": {
            "recipient_email": {
              "type": "string",
              "maxLength": 254,
              "description": "Filters invoices by the recipient's email address."
            },
            "recipient_first_name": {
              "type": "string",
              "maxLength": 140,
              "description": "Filters invoices by the recipient's first name."
            },
            "recipient_last_name": {
              "type": "string",
              "maxLength": 140,
              "description": "Filters invoices by the recipient's last name."
            },
            "recipient_business_name": {
              "type": "string",
              "maxLength": 300,
              "description": "Filters invoices by the recipient's business name."
            },
            "invoice_number": {
              "type": "string",
              "maxLength": 25,
              "description": "Filters invoices by invoice number."
            },
            "status": {
              "type": "array",
              "items": {
                "type": "string",
                "enum": [
                  "DRAFT",
                  "SENT",
                  "SCHEDULED",
                  "PAID",
                  "MARKED_AS_PAID",
                  "CANCELLED",
                  "REFUNDED",
                  "PARTIALLY_PAID",
                  "PARTIALLY_REFUNDED",
                  "MARKED_AS_REFUNDED",
                  "UNPAID",
                  "PAYMENT_PENDING",
                  "AUTO_CANCELLED",
                  "PAID_EXTERNAL",
                  "REFUNDED_EXTERNAL",
                  "SHARED"
                ]
              },
              "maxItems": 5,
              "description": "Filters invoices by one or more statuses (up to 5)."
            },
            "reference": {
              "type": "string",
              "maxLength": 120,
              "description": "Filters invoices by reference value, such as a purchase order number."
            },
            "currency_code": {
              "type": "string",
              "description": "Filters invoices by the three-character ISO-4217 currency code."
            },
            "total_amount_range": {
              "type": "object",
              "properties": {
                "lower_amount": {
                  "type": "object",
                  "properties": {
                    "currency_code": {
                      "type": "string",
                      "description": "The three-character ISO-4217 currency code that identifies the currency."
                    },
                    "value": {
                      "type": "string",
                      "pattern": "^((-?[0-9]+)|(-?([0-9]+)?[.][0-9]+))$",
                      "description": "The amount, as a signed decimal string with up to 2 decimal places (e.g. '50.00')."
                    }
                  },
                  "required": [
                    "currency_code",
                    "value"
                  ],
                  "additionalProperties": false,
                  "description": "The lower bound of the amount range."
                },
                "upper_amount": {
                  "type": "object",
                  "properties": {
                    "currency_code": {
                      "type": "string",
                      "description": "The three-character ISO-4217 currency code that identifies the currency."
                    },
                    "value": {
                      "type": "string",
                      "pattern": "^((-?[0-9]+)|(-?([0-9]+)?[.][0-9]+))$",
                      "description": "The amount, as a signed decimal string with up to 2 decimal places (e.g. '50.00')."
                    }
                  },
                  "required": [
                    "currency_code",
                    "value"
                  ],
                  "additionalProperties": false,
                  "description": "The upper bound of the amount range."
                }
              },
              "required": [
                "lower_amount",
                "upper_amount"
              ],
              "additionalProperties": false,
              "description": "Filters invoices whose total amount falls within this range."
            },
            "invoice_date_range": {
              "type": "object",
              "properties": {
                "start": {
                  "type": "string",
                  "pattern": "^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[1-2][0-9]|3[0-1])$",
                  "description": "The start date, in yyyy-MM-DD format."
                },
                "end": {
                  "type": "string",
                  "pattern": "^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[1-2][0-9]|3[0-1])$",
                  "description": "The end date, in yyyy-MM-DD format."
                }
              },
              "required": [
                "start",
                "end"
              ],
              "additionalProperties": false,
              "description": "Filters invoices by the invoice's own date (the date shown on the invoice itself, also called the billing date). Use this for most 'invoices dated/created/issued between X and Y' requests -- creation_date_range is for PayPal's internal record-creation timestamp, not the invoice's date."
            },
            "due_date_range": {
              "type": "object",
              "properties": {
                "start": {
                  "type": "string",
                  "pattern": "^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[1-2][0-9]|3[0-1])$",
                  "description": "The start date, in yyyy-MM-DD format."
                },
                "end": {
                  "type": "string",
                  "pattern": "^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[1-2][0-9]|3[0-1])$",
                  "description": "The end date, in yyyy-MM-DD format."
                }
              },
              "required": [
                "start",
                "end"
              ],
              "additionalProperties": false,
              "description": "Filters invoices whose due date falls within this range."
            },
            "payment_date_range": {
              "type": "object",
              "properties": {
                "start": {
                  "type": "string",
                  "pattern": "^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[1-2][0-9]|3[0-1])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\\.[0-9]+)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$",
                  "minLength": 20,
                  "maxLength": 64,
                  "description": "The start date and time, in ISO8601 format (for example, 2018-06-01T00:00:00Z). Seconds are required; fractional seconds are optional. A plain date (yyyy-MM-DD) is also accepted and is expanded to the start of that day (00:00:00Z)."
                },
                "end": {
                  "type": "string",
                  "pattern": "^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[1-2][0-9]|3[0-1])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\\.[0-9]+)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$",
                  "minLength": 20,
                  "maxLength": 64,
                  "description": "The end date and time, in ISO8601 format (for example, 2018-06-21T23:59:59Z). Seconds are required; fractional seconds are optional. A plain date (yyyy-MM-DD) is also accepted and is expanded to the end of that day (23:59:59Z)."
                }
              },
              "required": [
                "start",
                "end"
              ],
              "additionalProperties": false,
              "description": "Filters invoices by the date and time PayPal recorded the invoice as paid (a system timestamp)."
            },
            "creation_date_range": {
              "type": "object",
              "properties": {
                "start": {
                  "type": "string",
                  "pattern": "^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[1-2][0-9]|3[0-1])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\\.[0-9]+)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$",
                  "minLength": 20,
                  "maxLength": 64,
                  "description": "The start date and time, in ISO8601 format (for example, 2018-06-01T00:00:00Z). Seconds are required; fractional seconds are optional. A plain date (yyyy-MM-DD) is also accepted and is expanded to the start of that day (00:00:00Z)."
                },
                "end": {
                  "type": "string",
                  "pattern": "^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[1-2][0-9]|3[0-1])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\\.[0-9]+)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$",
                  "minLength": 20,
                  "maxLength": 64,
                  "description": "The end date and time, in ISO8601 format (for example, 2018-06-21T23:59:59Z). Seconds are required; fractional seconds are optional. A plain date (yyyy-MM-DD) is also accepted and is expanded to the end of that day (23:59:59Z)."
                }
              },
              "required": [
                "start",
                "end"
              ],
              "additionalProperties": false,
              "description": "Filters invoices by the date and time PayPal's system recorded the invoice record as created (an internal system timestamp, NOT the invoice's own date). For 'invoices dated/created between X and Y' requests, prefer invoice_date_range unless the user specifically means when the record was created in PayPal."
            }
          }
        },
        "recurring_series_filters": {
          "type": "object",
          "description": "Filters to apply when resource_type is 'recurring_series'. Must not be set when resource_type is 'invoice'.",
          "properties": {
            "search_text": {
              "type": "string",
              "minLength": 3,
              "maxLength": 800,
              "description": "Free-text search across the fields listed in search_fields. Cannot be blank."
            },
            "search_fields": {
              "type": "array",
              "items": {
                "type": "string",
                "enum": [
                  "PAYER_REFERENCE_INFO",
                  "BILLING_EMAIL",
                  "BILLING_NAME",
                  "BILLING_BUSINESS_NAME",
                  "BILLING_PHONE_NUMBER",
                  "SHIPPING_NAME",
                  "SHIPPING_BUSINESS_NAME",
                  "SHIPPING_PHONE_NUMBER",
                  "ITEM_NAME",
                  "ITEM_TAX_NAME",
                  "ITEM_DISCOUNT_NAME",
                  "INVOICE_DISCOUNT_NAME",
                  "ALL"
                ]
              },
              "minItems": 1,
              "maxItems": 5,
              "description": "The fields that search_text searches against (1-5 values, must be unique)."
            },
            "search_filters": {
              "type": "object",
              "properties": {
                "currency_code": {
                  "type": "string",
                  "description": "Filters recurring series by the three-character ISO-4217 currency code."
                },
                "status": {
                  "type": "array",
                  "items": {
                    "type": "string",
                    "enum": [
                      "DRAFT",
                      "ACTIVE",
                      "CANCELLED",
                      "EXPIRED"
                    ]
                  },
                  "minItems": 1,
                  "maxItems": 5,
                  "description": "Filters recurring series by one or more statuses (up to 5, must be unique)."
                },
                "creation_date_range": {
                  "type": "object",
                  "properties": {
                    "start": {
                      "type": "string",
                      "pattern": "^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[1-2][0-9]|3[0-1])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\\.[0-9]+)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$",
                      "minLength": 20,
                      "maxLength": 64,
                      "description": "The start date and time, in ISO8601 format (for example, 2018-06-01T00:00:00Z). Seconds are required; fractional seconds are optional. A plain date (yyyy-MM-DD) is also accepted and is expanded to the start of that day (00:00:00Z)."
                    },
                    "end": {
                      "type": "string",
                      "pattern": "^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[1-2][0-9]|3[0-1])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\\.[0-9]+)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$",
                      "minLength": 20,
                      "maxLength": 64,
                      "description": "The end date and time, in ISO8601 format (for example, 2018-06-21T23:59:59Z). Seconds are required; fractional seconds are optional. A plain date (yyyy-MM-DD) is also accepted and is expanded to the end of that day (23:59:59Z)."
                    }
                  },
                  "required": [
                    "start",
                    "end"
                  ],
                  "additionalProperties": false,
                  "description": "Filters recurring series by the date and time PayPal recorded the series as created (a system timestamp). This endpoint has no separate 'series date' field -- for 'series created/started between X and Y' requests, this is the field to use. Mutually exclusive with next_occurrence_date_range -- PayPal supports only one range criterion per search."
                },
                "next_occurrence_date_range": {
                  "type": "object",
                  "properties": {
                    "start": {
                      "type": "string",
                      "pattern": "^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[1-2][0-9]|3[0-1])$",
                      "description": "The start date, in yyyy-MM-DD format."
                    },
                    "end": {
                      "type": "string",
                      "pattern": "^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[1-2][0-9]|3[0-1])$",
                      "description": "The end date, in yyyy-MM-DD format."
                    }
                  },
                  "required": [
                    "start",
                    "end"
                  ],
                  "additionalProperties": false,
                  "description": "Filters recurring series whose next occurrence date falls within this range. Mutually exclusive with creation_date_range -- PayPal supports only one range criterion per search."
                },
                "total_amount_range": {
                  "type": "object",
                  "properties": {
                    "lower_amount": {
                      "type": "object",
                      "properties": {
                        "currency_code": {
                          "type": "string",
                          "description": "The three-character ISO-4217 currency code that identifies the currency."
                        },
                        "value": {
                          "type": "string",
                          "pattern": "^((-?[0-9]+)|(-?([0-9]+)?[.][0-9]+))$",
                          "description": "The amount, as a signed decimal string with up to 2 decimal places (e.g. '50.00')."
                        }
                      },
                      "required": [
                        "currency_code",
                        "value"
                      ],
                      "additionalProperties": false,
                      "description": "The lower bound of the amount range."
                    },
                    "upper_amount": {
                      "type": "object",
                      "properties": {
                        "currency_code": {
                          "type": "string",
                          "description": "The three-character ISO-4217 currency code that identifies the currency."
                        },
                        "value": {
                          "type": "string",
                          "pattern": "^((-?[0-9]+)|(-?([0-9]+)?[.][0-9]+))$",
                          "description": "The amount, as a signed decimal string with up to 2 decimal places (e.g. '50.00')."
                        }
                      },
                      "required": [
                        "currency_code",
                        "value"
                      ],
                      "additionalProperties": false,
                      "description": "The upper bound of the amount range."
                    }
                  },
                  "required": [
                    "lower_amount",
                    "upper_amount"
                  ],
                  "additionalProperties": false,
                  "description": "Filters recurring series whose total amount falls within this range."
                }
              },
              "additionalProperties": false,
              "description": "Structured filters for the recurring series search."
            }
          }
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session identifier."
        }
      }
    }
  },
  // 46. update_invoicing
  {
    "name": "update_invoicing",
    "description": "[CONFIRMED_WRITE] Official PayPal MCP Tool (Invoicing v2 — PUT /v2/invoicing/invoices/{invoice_id} | /v2/invoicing/recurring-invoices/{recurring_series_id}): Update an existing invoice or recurring invoice series on PayPal.\n\nFor invoices, the recipient (primary_recipients) can only be changed 2 times within any 72-hour window -- avoid unnecessary recipient edits.",
    "source": "official_paypal_mcp",
    "officialPayPalEquivalent": "update_invoicing",
    "classification": "confirmed_demo_write",
    "readVsWrite": "write",
    "permissions": "provider_only",
    "externalAuthRequired": "paypal_merchant_oauth",
    "idempotencyRequired": true,
    "auditEvent": "paypal_mcp_update_invoicing",
    "errorHandling": "404 RESOURCE_NOT_FOUND; 403 AUTHORIZATION_REQUIRED; 422 GUARDRAIL_SINGLE_ACTION_LIMIT_EXCEEDED",
    "requiredParams": [
      "resource_type"
    ],
    "optionalParams": [
      "invoice_update",
      "recurring_series_update",
      "explicit_human_approval",
      "user_instruction",
      "proposal_id",
      "actor_role",
      "demo_session_id"
    ],
    "sandboxAvailability": "AVAILABLE_LIVE_SANDBOX",
    "equivalentRestEndpoint": "PUT /v2/invoicing/invoices/{invoice_id} | /v2/invoicing/recurring-invoices/{recurring_series_id}",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/invoicing"
    ],
    "annotations": {
      "title": "PayPal MCP: Update Invoicing",
      "readOnlyHint": false,
      "destructiveHint": false,
      "idempotentHint": true,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "required": [
        "resource_type"
      ],
      "properties": {
        "resource_type": {
          "type": "string",
          "description": "Which kind of resource to update. 'invoice' updates an individual invoice; 'recurring_series' updates a recurring invoice series.",
          "enum": [
            "invoice",
            "recurring_series"
          ]
        },
        "invoice_update": {
          "type": "object",
          "description": "Full replacement content for the invoice. Set only when resource_type is 'invoice'.",
          "properties": {
            "currency_code": {
              "type": "string",
              "description": "The three-character ISO-4217 currency code for the invoice (for example, USD). Applies to every monetary amount on the invoice."
            },
            "invoice_number": {
              "type": "string",
              "description": "The invoice number. If omitted, PayPal auto-increments from the last invoice number used."
            },
            "invoice_date": {
              "type": "string",
              "pattern": "^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[1-2][0-9]|3[0-1])$",
              "description": "The invoice date in yyyy-MM-DD format."
            },
            "reference": {
              "type": "string",
              "description": "A reference value, such as a purchase order number."
            },
            "note": {
              "type": "string",
              "description": "A note to the invoice recipient. Also appears on the invoice notification email."
            },
            "invoicer_business_name": {
              "type": "string",
              "maxLength": 300,
              "description": "The business name of the invoicer."
            },
            "invoicer_given_name": {
              "type": "string",
              "description": "The first name of the invoicer."
            },
            "invoicer_surname": {
              "type": "string",
              "description": "The last name of the invoicer."
            },
            "invoicer_email_address": {
              "type": "string",
              "description": "The email address of the invoicer."
            },
            "invoicer_tax_id": {
              "type": "string",
              "description": "The invoicer's tax ID."
            },
            "invoicer_address_line_1": {
              "type": "string",
              "description": "The first line of the invoicer's address, for example, number and street."
            },
            "invoicer_address_line_2": {
              "type": "string",
              "description": "The second line of the invoicer's address, for example, suite or apartment number."
            },
            "invoicer_city": {
              "type": "string",
              "description": "The city, town, or village of the invoicer's address."
            },
            "invoicer_state": {
              "type": "string",
              "description": "The state or province of the invoicer's address."
            },
            "invoicer_postal_code": {
              "type": "string",
              "description": "The postal code of the invoicer's address."
            },
            "invoicer_country_code": {
              "type": "string",
              "pattern": "^([A-Z]{2}|C2)$",
              "description": "The two-character ISO 3166-1 country code of the invoicer's address (for example, US or GB)."
            },
            "primary_recipients": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "billing_info": {
                    "type": "object",
                    "properties": {
                      "business_name": {
                        "type": "string",
                        "description": "The business name of the invoice recipient."
                      },
                      "name": {
                        "type": "object",
                        "properties": {
                          "given_name": {
                            "type": "string",
                            "description": "The first name of the person."
                          },
                          "surname": {
                            "type": "string",
                            "description": "The last name of the person."
                          }
                        },
                        "additionalProperties": false,
                        "description": "name of the recipient"
                      },
                      "address": {
                        "type": "object",
                        "properties": {
                          "address_line_1": {
                            "type": "string",
                            "description": "The first line of the address, for example, number and street."
                          },
                          "address_line_2": {
                            "type": "string",
                            "description": "The second line of the address, for example, suite or apartment number."
                          },
                          "admin_area_2": {
                            "type": "string",
                            "description": "A city, town, or village."
                          },
                          "admin_area_1": {
                            "type": "string",
                            "description": "The highest-level sub-division in a country, such as a state or province."
                          },
                          "postal_code": {
                            "type": "string",
                            "description": "The postal code, which is the zip code or equivalent."
                          },
                          "country_code": {
                            "type": "string",
                            "pattern": "^([A-Z]{2}|C2)$",
                            "description": "The two-character ISO 3166-1 country code (for example, US or GB)."
                          }
                        },
                        "additionalProperties": false,
                        "description": "The address of the invoice recipient."
                      },
                      "email_address": {
                        "type": "string",
                        "description": "email address of the recipient"
                      },
                      "phones": {
                        "type": "array",
                        "items": {
                          "type": "object",
                          "properties": {
                            "country_code": {
                              "type": "string",
                              "description": "The country calling code, in E.164 format (for example, '1' for the United States)."
                            },
                            "national_number": {
                              "type": "string",
                              "description": "The national number, in E.164 format."
                            },
                            "phone_type": {
                              "type": "string",
                              "enum": [
                                "FAX",
                                "HOME",
                                "MOBILE",
                                "OTHER",
                                "PAGER"
                              ],
                              "description": "The type of phone number."
                            }
                          },
                          "required": [
                            "country_code",
                            "national_number",
                            "phone_type"
                          ],
                          "additionalProperties": false,
                          "description": "phone object"
                        },
                        "description": "The invoice recipient's phone numbers."
                      },
                      "additional_info": {
                        "type": "string",
                        "maxLength": 40,
                        "description": "Any additional information about the recipient."
                      },
                      "language": {
                        "type": "string",
                        "pattern": "^[a-z]{2}(-[A-Z][a-z]{3})?(-([A-Z]{2}|[0-9]{3}))?$",
                        "description": "The BCP-47 language tag used for the recipient's email notification (for example, 'en-US'). Only used when the recipient has no PayPal account."
                      }
                    },
                    "additionalProperties": false,
                    "description": "The billing information of the invoice recipient"
                  },
                  "shipping_info": {
                    "type": "object",
                    "properties": {
                      "business_name": {
                        "type": "string",
                        "description": "The business name for the shipping destination."
                      },
                      "name": {
                        "type": "object",
                        "properties": {
                          "given_name": {
                            "type": "string",
                            "description": "The first name of the person."
                          },
                          "surname": {
                            "type": "string",
                            "description": "The last name of the person."
                          }
                        },
                        "additionalProperties": false,
                        "description": "The name for the shipping destination."
                      },
                      "address": {
                        "type": "object",
                        "properties": {
                          "address_line_1": {
                            "type": "string",
                            "description": "The first line of the address, for example, number and street."
                          },
                          "address_line_2": {
                            "type": "string",
                            "description": "The second line of the address, for example, suite or apartment number."
                          },
                          "admin_area_2": {
                            "type": "string",
                            "description": "A city, town, or village."
                          },
                          "admin_area_1": {
                            "type": "string",
                            "description": "The highest-level sub-division in a country, such as a state or province."
                          },
                          "postal_code": {
                            "type": "string",
                            "description": "The postal code, which is the zip code or equivalent."
                          },
                          "country_code": {
                            "type": "string",
                            "pattern": "^([A-Z]{2}|C2)$",
                            "description": "The two-character ISO 3166-1 country code (for example, US or GB)."
                          }
                        },
                        "additionalProperties": false,
                        "description": "The shipping address."
                      }
                    },
                    "additionalProperties": false,
                    "description": "The shipping information of the invoice recipient."
                  }
                },
                "additionalProperties": false
              },
              "description": "The recipients who will be billed for this invoice."
            },
            "items": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "name": {
                    "type": "string",
                    "description": "The name of the item"
                  },
                  "description": {
                    "type": "string",
                    "description": "The description of the item."
                  },
                  "quantity": {
                    "type": "string",
                    "description": "The quantity of the item that the invoicer provides to the payer. Value is from -1000000 to 1000000. Supports up to five decimal places. Cast to string"
                  },
                  "unit_amount": {
                    "type": "object",
                    "properties": {
                      "currency_code": {
                        "type": "string",
                        "description": "The three-character ISO-4217 currency code that identifies the currency."
                      },
                      "value": {
                        "type": "string",
                        "pattern": "^((-?[0-9]+)|(-?([0-9]+)?[.][0-9]+))$",
                        "description": "The amount, as a signed decimal string with up to 2 decimal places (e.g. '50.00')."
                      }
                    },
                    "required": [
                      "currency_code",
                      "value"
                    ],
                    "additionalProperties": false,
                    "description": "The unit price of the item. Does not include tax or discount."
                  },
                  "tax": {
                    "type": "object",
                    "properties": {
                      "name": {
                        "type": "string",
                        "description": "The name of the tax applied on the item, for example 'Sales Tax'."
                      },
                      "percent": {
                        "type": "string",
                        "pattern": "^((-?[0-9]+)|(-?([0-9]+)?[.][0-9]+))$",
                        "description": "The tax rate, as a percent value from 0 to 100. Supports up to five decimal places."
                      },
                      "tax_note": {
                        "type": "string",
                        "description": "A note about the tax, used to track tax-related data."
                      }
                    },
                    "required": [
                      "name",
                      "percent"
                    ],
                    "additionalProperties": false,
                    "description": "tax object"
                  },
                  "discount": {
                    "type": "object",
                    "properties": {
                      "percent": {
                        "type": "string",
                        "pattern": "^((-?[0-9]+)|(-?([0-9]+)?[.][0-9]+))$",
                        "description": "The discount as a percent value, from 0 to 100. Supports up to five decimal places. Mutually exclusive with amount -- set only one."
                      },
                      "amount": {
                        "type": "object",
                        "properties": {
                          "currency_code": {
                            "type": "string",
                            "description": "The three-character ISO-4217 currency code that identifies the currency."
                          },
                          "value": {
                            "type": "string",
                            "pattern": "^((-?[0-9]+)|(-?([0-9]+)?[.][0-9]+))$",
                            "description": "The amount, as a signed decimal string with up to 2 decimal places (e.g. '50.00')."
                          }
                        },
                        "required": [
                          "currency_code",
                          "value"
                        ],
                        "additionalProperties": false,
                        "description": "The discount as a fixed amount. Mutually exclusive with percent -- set only one."
                      }
                    },
                    "additionalProperties": false,
                    "description": "The discount for this line item, subtracted from the item total."
                  },
                  "item_date": {
                    "type": "string",
                    "pattern": "^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[1-2][0-9]|3[0-1])$",
                    "description": "The date, in yyyy-MM-DD format, when the item or service was provided."
                  },
                  "unit_of_measure": {
                    "type": "string",
                    "enum": [
                      "QUANTITY",
                      "HOURS",
                      "AMOUNT"
                    ],
                    "description": "The unit of measure for the invoiced item"
                  }
                },
                "required": [
                  "name",
                  "quantity",
                  "unit_amount"
                ],
                "additionalProperties": false,
                "description": "invoice line item object"
              },
              "description": "The line items on the invoice."
            },
            "allow_tip": {
              "type": "boolean",
              "description": "Whether the payer can add a tip when paying. Not available in Hong Kong, Taiwan, India, or Japan."
            },
            "theme_color": {
              "type": "string",
              "pattern": "^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$",
              "description": "The primary color used to render the invoice, as a hex color code (e.g. #000000). If omitted, the default theme is used."
            },
            "shipping_cost": {
              "type": "string",
              "pattern": "^((-?[0-9]+)|(-?([0-9]+)?[.][0-9]+))$",
              "description": "The shipping cost for the invoice, in the invoice's currency_code."
            },
            "enable_pay_by_bank": {
              "type": "boolean",
              "description": "Whether to enable PAY_BY_BANK as a payment method for this invoice, letting the payer pay directly from their bank account. Available only for US-based merchants and invoices with USD currency."
            },
            "pay_by_bank_exclusive_above_threshold": {
              "type": "boolean",
              "description": "When true, PAY_BY_BANK becomes the only available payment method once the invoice total exceeds PayPal's system-defined threshold ($1000), disabling all other payment methods above that threshold."
            },
            "allow_partial_payment": {
              "type": "boolean",
              "description": "Whether the invoice allows a partial payment. If false, the invoice must be paid in full. If true, the invoice allows partial payments. Not available for users in India, Brazil, or Israel."
            },
            "minimum_partial_payment_amount": {
              "type": "string",
              "pattern": "^((-?[0-9]+)|(-?([0-9]+)?[.][0-9]+))$",
              "description": "The minimum amount allowed for a partial payment, in the invoice's currency_code. Valid only when allow_partial_payment is true."
            },
            "invoice_id": {
              "type": "string",
              "pattern": "^[A-Za-z0-9_-]{1,127}$",
              "description": "The ID of the invoice to update. Required when resource_type is 'invoice'."
            },
            "send_to_recipient": {
              "type": "boolean",
              "description": "Whether to send the invoice update notification to the recipient. PayPal defaults to true if omitted."
            },
            "send_to_invoicer": {
              "type": "boolean",
              "description": "Whether to send the invoice update notification to the merchant (invoicer). PayPal defaults to true if omitted."
            }
          }
        },
        "recurring_series_update": {
          "type": "object",
          "description": "Full replacement content for the recurring series. Set only when resource_type is 'recurring_series'.",
          "properties": {
            "interval_unit": {
              "type": "string",
              "enum": [
                "DAY",
                "WEEK",
                "MONTH",
                "YEAR"
              ],
              "description": "The time unit for the recurring invoice cycle interval"
            },
            "interval_count": {
              "type": "integer",
              "minimum": 1,
              "maximum": 52,
              "description": "The number of intervals between each recurring invoice cycle. For example, an interval_count of 2 with interval_unit of MONTH means the invoice recurs every 2 months"
            },
            "start_series_date": {
              "type": "string",
              "pattern": "^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[1-2][0-9]|3[0-1])$",
              "description": "The date when the recurring series begins and the first invoice is generated, in yyyy-MM-DD format. Cannot be a past date."
            },
            "total_cycles": {
              "type": "integer",
              "minimum": 0,
              "maximum": 99,
              "description": "The total number of invoices to generate in the series. If omitted, the series runs indefinitely until cancelled."
            },
            "reference": {
              "type": "string",
              "description": "A reference value, such as a purchase order number."
            },
            "currency_code": {
              "type": "string",
              "description": "Currency code of the recurring invoice series"
            },
            "note": {
              "type": "string",
              "description": "A note to the invoice recipient. Also appears on the invoice notification email."
            },
            "invoicer_business_name": {
              "type": "string",
              "maxLength": 300,
              "description": "The business name of the invoicer."
            },
            "invoicer_given_name": {
              "type": "string",
              "description": "The first name of the invoicer."
            },
            "invoicer_surname": {
              "type": "string",
              "description": "The last name of the invoicer."
            },
            "invoicer_email_address": {
              "type": "string",
              "description": "The email address of the invoicer."
            },
            "invoicer_tax_id": {
              "type": "string",
              "description": "The invoicer's tax ID."
            },
            "invoicer_address_line_1": {
              "type": "string",
              "description": "The first line of the invoicer's address, for example, number and street."
            },
            "invoicer_address_line_2": {
              "type": "string",
              "description": "The second line of the invoicer's address, for example, suite or apartment number."
            },
            "invoicer_city": {
              "type": "string",
              "description": "The city, town, or village of the invoicer's address."
            },
            "invoicer_state": {
              "type": "string",
              "description": "The state or province of the invoicer's address."
            },
            "invoicer_postal_code": {
              "type": "string",
              "description": "The postal code of the invoicer's address."
            },
            "invoicer_country_code": {
              "type": "string",
              "pattern": "^([A-Z]{2}|C2)$",
              "description": "The two-character ISO 3166-1 country code of the invoicer's address (for example, US or GB)."
            },
            "primary_recipients": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "billing_info": {
                    "type": "object",
                    "properties": {
                      "business_name": {
                        "type": "string",
                        "description": "The business name of the invoice recipient."
                      },
                      "name": {
                        "type": "object",
                        "properties": {
                          "given_name": {
                            "type": "string",
                            "description": "The first name of the person."
                          },
                          "surname": {
                            "type": "string",
                            "description": "The last name of the person."
                          }
                        },
                        "additionalProperties": false,
                        "description": "name of the recipient"
                      },
                      "address": {
                        "type": "object",
                        "properties": {
                          "address_line_1": {
                            "type": "string",
                            "description": "The first line of the address, for example, number and street."
                          },
                          "address_line_2": {
                            "type": "string",
                            "description": "The second line of the address, for example, suite or apartment number."
                          },
                          "admin_area_2": {
                            "type": "string",
                            "description": "A city, town, or village."
                          },
                          "admin_area_1": {
                            "type": "string",
                            "description": "The highest-level sub-division in a country, such as a state or province."
                          },
                          "postal_code": {
                            "type": "string",
                            "description": "The postal code, which is the zip code or equivalent."
                          },
                          "country_code": {
                            "type": "string",
                            "pattern": "^([A-Z]{2}|C2)$",
                            "description": "The two-character ISO 3166-1 country code (for example, US or GB)."
                          }
                        },
                        "additionalProperties": false,
                        "description": "The address of the invoice recipient."
                      },
                      "email_address": {
                        "type": "string",
                        "description": "email address of the recipient"
                      },
                      "phones": {
                        "type": "array",
                        "items": {
                          "type": "object",
                          "properties": {
                            "country_code": {
                              "type": "string",
                              "description": "The country calling code, in E.164 format (for example, '1' for the United States)."
                            },
                            "national_number": {
                              "type": "string",
                              "description": "The national number, in E.164 format."
                            },
                            "phone_type": {
                              "type": "string",
                              "enum": [
                                "FAX",
                                "HOME",
                                "MOBILE",
                                "OTHER",
                                "PAGER"
                              ],
                              "description": "The type of phone number."
                            }
                          },
                          "required": [
                            "country_code",
                            "national_number",
                            "phone_type"
                          ],
                          "additionalProperties": false,
                          "description": "phone object"
                        },
                        "description": "The invoice recipient's phone numbers."
                      },
                      "additional_info": {
                        "type": "string",
                        "maxLength": 40,
                        "description": "Any additional information about the recipient."
                      },
                      "language": {
                        "type": "string",
                        "pattern": "^[a-z]{2}(-[A-Z][a-z]{3})?(-([A-Z]{2}|[0-9]{3}))?$",
                        "description": "The BCP-47 language tag used for the recipient's email notification (for example, 'en-US'). Only used when the recipient has no PayPal account."
                      }
                    },
                    "additionalProperties": false,
                    "description": "The billing information of the invoice recipient"
                  },
                  "shipping_info": {
                    "type": "object",
                    "properties": {
                      "business_name": {
                        "type": "string",
                        "description": "The business name for the shipping destination."
                      },
                      "name": {
                        "type": "object",
                        "properties": {
                          "given_name": {
                            "type": "string",
                            "description": "The first name of the person."
                          },
                          "surname": {
                            "type": "string",
                            "description": "The last name of the person."
                          }
                        },
                        "additionalProperties": false,
                        "description": "The name for the shipping destination."
                      },
                      "address": {
                        "type": "object",
                        "properties": {
                          "address_line_1": {
                            "type": "string",
                            "description": "The first line of the address, for example, number and street."
                          },
                          "address_line_2": {
                            "type": "string",
                            "description": "The second line of the address, for example, suite or apartment number."
                          },
                          "admin_area_2": {
                            "type": "string",
                            "description": "A city, town, or village."
                          },
                          "admin_area_1": {
                            "type": "string",
                            "description": "The highest-level sub-division in a country, such as a state or province."
                          },
                          "postal_code": {
                            "type": "string",
                            "description": "The postal code, which is the zip code or equivalent."
                          },
                          "country_code": {
                            "type": "string",
                            "pattern": "^([A-Z]{2}|C2)$",
                            "description": "The two-character ISO 3166-1 country code (for example, US or GB)."
                          }
                        },
                        "additionalProperties": false,
                        "description": "The shipping address."
                      }
                    },
                    "additionalProperties": false,
                    "description": "The shipping information of the invoice recipient."
                  }
                },
                "additionalProperties": false
              },
              "minItems": 1,
              "maxItems": 1,
              "description": "The primary recipient of the recurring invoices"
            },
            "items": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "name": {
                    "type": "string",
                    "description": "The name of the item"
                  },
                  "description": {
                    "type": "string",
                    "description": "The description of the item."
                  },
                  "quantity": {
                    "type": "string",
                    "description": "The quantity of the item that the invoicer provides to the payer. Value is from -1000000 to 1000000. Supports up to five decimal places. Cast to string"
                  },
                  "unit_amount": {
                    "type": "object",
                    "properties": {
                      "currency_code": {
                        "type": "string",
                        "description": "The three-character ISO-4217 currency code that identifies the currency."
                      },
                      "value": {
                        "type": "string",
                        "pattern": "^((-?[0-9]+)|(-?([0-9]+)?[.][0-9]+))$",
                        "description": "The amount, as a signed decimal string with up to 2 decimal places (e.g. '50.00')."
                      }
                    },
                    "required": [
                      "currency_code",
                      "value"
                    ],
                    "additionalProperties": false,
                    "description": "The unit price of the item. Does not include tax or discount."
                  },
                  "tax": {
                    "type": "object",
                    "properties": {
                      "name": {
                        "type": "string",
                        "description": "The name of the tax applied on the item, for example 'Sales Tax'."
                      },
                      "percent": {
                        "type": "string",
                        "pattern": "^((-?[0-9]+)|(-?([0-9]+)?[.][0-9]+))$",
                        "description": "The tax rate, as a percent value from 0 to 100. Supports up to five decimal places."
                      },
                      "tax_note": {
                        "type": "string",
                        "description": "A note about the tax, used to track tax-related data."
                      }
                    },
                    "required": [
                      "name",
                      "percent"
                    ],
                    "additionalProperties": false,
                    "description": "tax object"
                  },
                  "discount": {
                    "type": "object",
                    "properties": {
                      "percent": {
                        "type": "string",
                        "pattern": "^((-?[0-9]+)|(-?([0-9]+)?[.][0-9]+))$",
                        "description": "The discount as a percent value, from 0 to 100. Supports up to five decimal places. Mutually exclusive with amount -- set only one."
                      },
                      "amount": {
                        "type": "object",
                        "properties": {
                          "currency_code": {
                            "type": "string",
                            "description": "The three-character ISO-4217 currency code that identifies the currency."
                          },
                          "value": {
                            "type": "string",
                            "pattern": "^((-?[0-9]+)|(-?([0-9]+)?[.][0-9]+))$",
                            "description": "The amount, as a signed decimal string with up to 2 decimal places (e.g. '50.00')."
                          }
                        },
                        "required": [
                          "currency_code",
                          "value"
                        ],
                        "additionalProperties": false,
                        "description": "The discount as a fixed amount. Mutually exclusive with percent -- set only one."
                      }
                    },
                    "additionalProperties": false,
                    "description": "The discount for this line item, subtracted from the item total."
                  },
                  "item_date": {
                    "type": "string",
                    "pattern": "^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[1-2][0-9]|3[0-1])$",
                    "description": "The date, in yyyy-MM-DD format, when the item or service was provided."
                  },
                  "unit_of_measure": {
                    "type": "string",
                    "enum": [
                      "QUANTITY",
                      "HOURS",
                      "AMOUNT"
                    ],
                    "description": "The unit of measure for the invoiced item"
                  }
                },
                "required": [
                  "name",
                  "quantity",
                  "unit_amount"
                ],
                "additionalProperties": false,
                "description": "invoice line item object"
              },
              "minItems": 1,
              "description": "The line items that will appear on each invoice in the recurring series"
            },
            "allow_tip": {
              "type": "boolean",
              "description": "Whether the payer can add a tip when paying. Not available in Hong Kong, Taiwan, India, or Japan."
            },
            "shipping_cost": {
              "type": "string",
              "pattern": "^((-?[0-9]+)|(-?([0-9]+)?[.][0-9]+))$",
              "description": "The shipping cost for each generated invoice, in the series' currency_code."
            },
            "allow_partial_payment": {
              "type": "boolean",
              "description": "Whether each generated invoice allows a partial payment. If false, each invoice must be paid in full. If true, each invoice allows partial payments. Not available for users in India, Brazil, or Israel."
            },
            "minimum_partial_payment_amount": {
              "type": "string",
              "pattern": "^((-?[0-9]+)|(-?([0-9]+)?[.][0-9]+))$",
              "description": "The minimum amount allowed for a partial payment on each generated invoice, in the series' currency_code. Valid only when allow_partial_payment is true."
            },
            "recurring_series_id": {
              "type": "string",
              "pattern": "^RI-[A-Z0-9]{17}$",
              "description": "The ID of the recurring invoice series to update. Required when resource_type is 'recurring_series'."
            }
          }
        },
        "explicit_human_approval": {
          "type": "boolean",
          "description": "Must be true (or provide an authorized user_instruction / proposal_id) to execute this PayPal Sandbox write operation."
        },
        "user_instruction": {
          "type": "string",
          "description": "Optional explicit user instruction authorizing this write within the $500/$2,500 guardrails."
        },
        "proposal_id": {
          "type": "string",
          "description": "Optional session-bound proposal ID authorizing this write."
        },
        "actor_role": {
          "type": "string",
          "enum": [
            "provider",
            "patient"
          ],
          "description": "Caller role for server-side RBAC verification (default: provider)."
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session identifier."
        }
      }
    }
  },
  // 47. cancel_invoice_auto_reminder
  {
    "name": "cancel_invoice_auto_reminder",
    "description": "[CONFIRMED_WRITE] Official PayPal MCP Tool (Invoicing v2 (Reminders) — POST /v2/invoicing/invoices/{invoice_id}/cancel-reminders): Cancel all scheduled automatic reminders for an invoice.\n\nThis function permanently cancels every automatic reminder scheduled for a specific invoice, by invoice ID. This action is irreversible -- once cancelled, automatic reminders cannot be re-enabled for that invoice.",
    "source": "official_paypal_mcp",
    "officialPayPalEquivalent": "cancel_invoice_auto_reminder",
    "classification": "confirmed_demo_write",
    "readVsWrite": "write",
    "permissions": "provider_only",
    "externalAuthRequired": "paypal_merchant_oauth",
    "idempotencyRequired": true,
    "auditEvent": "paypal_mcp_cancel_invoice_auto_reminder",
    "errorHandling": "404 RESOURCE_NOT_FOUND; 403 AUTHORIZATION_REQUIRED",
    "requiredParams": [
      "invoice_id"
    ],
    "optionalParams": [
      "explicit_human_approval",
      "user_instruction",
      "proposal_id",
      "actor_role",
      "demo_session_id"
    ],
    "sandboxAvailability": "AVAILABLE_LIVE_SANDBOX",
    "equivalentRestEndpoint": "POST /v2/invoicing/invoices/{invoice_id}/cancel-reminders",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/invoicing"
    ],
    "annotations": {
      "title": "PayPal MCP: Cancel Invoice Auto Reminder",
      "readOnlyHint": false,
      "destructiveHint": true,
      "idempotentHint": false,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "required": [
        "invoice_id"
      ],
      "properties": {
        "invoice_id": {
          "type": "string",
          "description": "The ID of the invoice for which to cancel all scheduled automatic reminders."
        },
        "explicit_human_approval": {
          "type": "boolean",
          "description": "Must be true (or provide an authorized user_instruction / proposal_id) to execute this PayPal Sandbox write operation."
        },
        "user_instruction": {
          "type": "string",
          "description": "Optional explicit user instruction authorizing this write within the $500/$2,500 guardrails."
        },
        "proposal_id": {
          "type": "string",
          "description": "Optional session-bound proposal ID authorizing this write."
        },
        "actor_role": {
          "type": "string",
          "enum": [
            "provider",
            "patient"
          ],
          "description": "Caller role for server-side RBAC verification (default: provider)."
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session identifier."
        }
      }
    }
  },
  // 48. generate_invoice_qr_code
  {
    "name": "generate_invoice_qr_code",
    "description": "[READ_ONLY] Official PayPal MCP Tool (Invoicing v2 — POST /v2/invoicing/invoices/{invoice_id}/generate-qr-code): Generate a QR code for an invoice.\n\nThis function generates a QR code for an invoice, which can be used to pay the invoice using a mobile device or scanning app.",
    "source": "official_paypal_mcp",
    "officialPayPalEquivalent": "generate_invoice_qr_code",
    "classification": "read_only",
    "readVsWrite": "read",
    "permissions": "provider_or_customer",
    "externalAuthRequired": "paypal_merchant_oauth",
    "idempotencyRequired": false,
    "auditEvent": null,
    "errorHandling": "404 RESOURCE_NOT_FOUND",
    "requiredParams": [
      "invoice_id"
    ],
    "optionalParams": [
      "width",
      "height",
      "demo_session_id"
    ],
    "sandboxAvailability": "AVAILABLE_LIVE_SANDBOX",
    "equivalentRestEndpoint": "POST /v2/invoicing/invoices/{invoice_id}/generate-qr-code",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/invoicing"
    ],
    "annotations": {
      "title": "PayPal MCP: Generate Invoice Qr Code",
      "readOnlyHint": true,
      "destructiveHint": false,
      "idempotentHint": true,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "required": [
        "invoice_id"
      ],
      "properties": {
        "invoice_id": {
          "type": "string",
          "description": "The invoice id to generate QR code for"
        },
        "width": {
          "type": "number",
          "description": "The QR code width"
        },
        "height": {
          "type": "number",
          "description": "The QR code height"
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session identifier."
        }
      }
    }
  },
  // 49. generate_invoice_number
  {
    "name": "generate_invoice_number",
    "description": "[READ_ONLY] Official PayPal MCP Tool (Invoicing v2 — POST /v2/invoicing/generate-next-invoice-number): Generate the next invoice number available to the merchant.\n\nThis function generates the next invoice number by using the prefix and suffix from the merchant's last invoice number and incrementing the numeric portion by one (e.g. INVOICE-1234 -> INVOICE-1235).",
    "source": "official_paypal_mcp",
    "officialPayPalEquivalent": "generate_invoice_number",
    "classification": "read_only",
    "readVsWrite": "read",
    "permissions": "provider_only",
    "externalAuthRequired": "paypal_merchant_oauth",
    "idempotencyRequired": false,
    "auditEvent": null,
    "errorHandling": "401 UNAUTHORIZED",
    "requiredParams": [],
    "optionalParams": [
      "demo_session_id"
    ],
    "sandboxAvailability": "AVAILABLE_LIVE_SANDBOX",
    "equivalentRestEndpoint": "POST /v2/invoicing/generate-next-invoice-number",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/invoicing"
    ],
    "annotations": {
      "title": "PayPal MCP: Generate Invoice Number",
      "readOnlyHint": true,
      "destructiveHint": false,
      "idempotentHint": true,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "properties": {
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session identifier."
        }
      }
    }
  },
  // 50. record_payment_for_invoice
  {
    "name": "record_payment_for_invoice",
    "description": "[CONFIRMED_WRITE] Official PayPal MCP Tool (Invoicing v2 — POST /v2/invoicing/invoices/{invoice_id}/payments): Record a payment for an invoice on PayPal.\n\nThis function records an external or manual payment (for example, cash, check, bank transfer, or a PayPal transaction) against an invoice, by invoice ID. If the recorded amount covers the full amount due, PayPal marks the invoice PAID; otherwise it is marked PARTIALLY_PAID. This does not process a new payment -- it only logs one that was already collected.\n\nmethod is required. payment_id applies only to PAYPAL-type payments.",
    "source": "official_paypal_mcp",
    "officialPayPalEquivalent": "record_payment_for_invoice",
    "classification": "confirmed_demo_write",
    "readVsWrite": "write",
    "permissions": "provider_only",
    "externalAuthRequired": "paypal_merchant_oauth",
    "idempotencyRequired": true,
    "auditEvent": "paypal_mcp_record_payment_for_invoice",
    "errorHandling": "404 RESOURCE_NOT_FOUND; 422 CANNOT_RECORD_ON_DRAFT; 403 AUTHORIZATION_REQUIRED; 422 GUARDRAIL_SINGLE_ACTION_LIMIT_EXCEEDED",
    "requiredParams": [
      "invoice_id",
      "method"
    ],
    "optionalParams": [
      "payment_id",
      "payment_date",
      "payment_date_time",
      "note",
      "amount",
      "shipping_info",
      "explicit_human_approval",
      "user_instruction",
      "proposal_id",
      "actor_role",
      "demo_session_id"
    ],
    "sandboxAvailability": "AVAILABLE_LIVE_SANDBOX",
    "equivalentRestEndpoint": "POST /v2/invoicing/invoices/{invoice_id}/payments",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/invoicing"
    ],
    "annotations": {
      "title": "PayPal MCP: Record Payment For Invoice",
      "readOnlyHint": false,
      "destructiveHint": false,
      "idempotentHint": false,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "required": [
        "invoice_id",
        "method"
      ],
      "properties": {
        "invoice_id": {
          "type": "string",
          "description": "The ID of the invoice to record the payment against."
        },
        "payment_id": {
          "type": "string",
          "description": "The ID for a PayPal payment transaction. Required for the PAYPAL payment type."
        },
        "payment_date": {
          "type": "string",
          "description": "The date when the invoicer recorded the payment, in yyyy-MM-dd format."
        },
        "payment_date_time": {
          "type": "string",
          "description": "The date and time when the invoicer recorded the payment, in Internet date and time format (ISO 8601), for example 2018-05-13T21:20:00Z or 2018-05-13T21:20:00.000-08:00. Seconds are required."
        },
        "method": {
          "type": "string",
          "description": "The payment mode or method through which the invoicer can accept the payments.",
          "enum": [
            "BANK_TRANSFER",
            "CASH",
            "CHECK",
            "CREDIT_CARD",
            "DEBIT_CARD",
            "PAYPAL",
            "WIRE_TRANSFER",
            "OTHER"
          ]
        },
        "note": {
          "type": "string",
          "description": "A note associated with an external cash or check payment."
        },
        "amount": {
          "type": "object",
          "description": "The currency and amount for a financial transaction.",
          "properties": {
            "currency_code": {
              "type": "string",
              "description": "The three-character ISO-4217 currency code that identifies the currency."
            },
            "value": {
              "type": "string",
              "pattern": "^((-?[0-9]+)|(-?([0-9]+)?[.][0-9]+))$",
              "description": "The amount, as a signed decimal string with up to 2 decimal places (e.g. '50.00')."
            }
          }
        },
        "shipping_info": {
          "type": "object",
          "description": "The shipping information associated with this payment.",
          "properties": {
            "business_name": {
              "type": "string",
              "description": "The business name for the shipping destination."
            },
            "name": {
              "type": "object",
              "properties": {
                "given_name": {
                  "type": "string",
                  "description": "The first name of the person."
                },
                "surname": {
                  "type": "string",
                  "description": "The last name of the person."
                }
              },
              "additionalProperties": false,
              "description": "The name for the shipping destination."
            },
            "address": {
              "type": "object",
              "properties": {
                "address_line_1": {
                  "type": "string",
                  "description": "The first line of the address, for example, number and street."
                },
                "address_line_2": {
                  "type": "string",
                  "description": "The second line of the address, for example, suite or apartment number."
                },
                "admin_area_2": {
                  "type": "string",
                  "description": "A city, town, or village."
                },
                "admin_area_1": {
                  "type": "string",
                  "description": "The highest-level sub-division in a country, such as a state or province."
                },
                "postal_code": {
                  "type": "string",
                  "description": "The postal code, which is the zip code or equivalent."
                },
                "country_code": {
                  "type": "string",
                  "pattern": "^([A-Z]{2}|C2)$",
                  "description": "The two-character ISO 3166-1 country code (for example, US or GB)."
                }
              },
              "additionalProperties": false,
              "description": "The shipping address."
            }
          }
        },
        "explicit_human_approval": {
          "type": "boolean",
          "description": "Must be true (or provide an authorized user_instruction / proposal_id) to execute this PayPal Sandbox write operation."
        },
        "user_instruction": {
          "type": "string",
          "description": "Optional explicit user instruction authorizing this write within the $500/$2,500 guardrails."
        },
        "proposal_id": {
          "type": "string",
          "description": "Optional session-bound proposal ID authorizing this write."
        },
        "actor_role": {
          "type": "string",
          "enum": [
            "provider",
            "patient"
          ],
          "description": "Caller role for server-side RBAC verification (default: provider)."
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session identifier."
        }
      }
    }
  },
  // 51. record_refund_for_invoice
  {
    "name": "record_refund_for_invoice",
    "description": "[CONFIRMED_WRITE] Official PayPal MCP Tool (Invoicing v2 — POST /v2/invoicing/invoices/{invoice_id}/refunds): Record a refund for an invoice on PayPal.\n\nThis function records a refund against an invoice, by invoice ID. If all payments made against the invoice are refunded, PayPal marks the invoice REFUNDED; otherwise it is marked PARTIALLY_REFUNDED. This does not process a new refund -- it only logs one that was already issued.\n\nmethod is required.",
    "source": "official_paypal_mcp",
    "officialPayPalEquivalent": "record_refund_for_invoice",
    "classification": "confirmed_demo_write",
    "readVsWrite": "write",
    "permissions": "provider_only",
    "externalAuthRequired": "paypal_merchant_oauth",
    "idempotencyRequired": true,
    "auditEvent": "paypal_mcp_record_refund_for_invoice",
    "errorHandling": "404 RESOURCE_NOT_FOUND; 422 INVOICE_NOT_PAID; 403 AUTHORIZATION_REQUIRED",
    "requiredParams": [
      "invoice_id",
      "method"
    ],
    "optionalParams": [
      "refund_date",
      "amount",
      "explicit_human_approval",
      "user_instruction",
      "proposal_id",
      "actor_role",
      "demo_session_id"
    ],
    "sandboxAvailability": "AVAILABLE_LIVE_SANDBOX",
    "equivalentRestEndpoint": "POST /v2/invoicing/invoices/{invoice_id}/refunds",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/invoicing"
    ],
    "annotations": {
      "title": "PayPal MCP: Record Refund For Invoice",
      "readOnlyHint": false,
      "destructiveHint": false,
      "idempotentHint": false,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "required": [
        "invoice_id",
        "method"
      ],
      "properties": {
        "invoice_id": {
          "type": "string",
          "description": "The ID of the invoice to mark as refunded."
        },
        "refund_date": {
          "type": "string",
          "description": "The date when the invoicer recorded the refund, in yyyy-MM-dd format."
        },
        "amount": {
          "type": "object",
          "description": "The currency and amount for a financial transaction.",
          "properties": {
            "currency_code": {
              "type": "string",
              "description": "The three-character ISO-4217 currency code that identifies the currency."
            },
            "value": {
              "type": "string",
              "pattern": "^((-?[0-9]+)|(-?([0-9]+)?[.][0-9]+))$",
              "description": "The amount, as a signed decimal string with up to 2 decimal places (e.g. '50.00')."
            }
          }
        },
        "method": {
          "type": "string",
          "description": "The payment mode or method through which the invoicer can accept the payments.",
          "enum": [
            "BANK_TRANSFER",
            "CASH",
            "CHECK",
            "CREDIT_CARD",
            "DEBIT_CARD",
            "PAYPAL",
            "WIRE_TRANSFER",
            "OTHER"
          ]
        },
        "explicit_human_approval": {
          "type": "boolean",
          "description": "Must be true (or provide an authorized user_instruction / proposal_id) to execute this PayPal Sandbox write operation."
        },
        "user_instruction": {
          "type": "string",
          "description": "Optional explicit user instruction authorizing this write within the $500/$2,500 guardrails."
        },
        "proposal_id": {
          "type": "string",
          "description": "Optional session-bound proposal ID authorizing this write."
        },
        "actor_role": {
          "type": "string",
          "enum": [
            "provider",
            "patient"
          ],
          "description": "Caller role for server-side RBAC verification (default: provider)."
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session identifier."
        }
      }
    }
  },
  // 52. create_conditional_rules_for_invoice
  {
    "name": "create_conditional_rules_for_invoice",
    "description": "[CONFIRMED_WRITE] Official PayPal MCP Tool (Invoicing v2 — POST /v2/invoicing/invoices/{invoice_id}/conditional-rules): Create conditional rules for an invoice on PayPal.",
    "source": "official_paypal_mcp",
    "officialPayPalEquivalent": "create_conditional_rules_for_invoice",
    "classification": "confirmed_demo_write",
    "readVsWrite": "write",
    "permissions": "provider_only",
    "externalAuthRequired": "paypal_merchant_oauth",
    "idempotencyRequired": true,
    "auditEvent": "paypal_mcp_create_conditional_rules_for_invoice",
    "errorHandling": "404 RESOURCE_NOT_FOUND; 403 AUTHORIZATION_REQUIRED",
    "requiredParams": [
      "invoice_id",
      "rules"
    ],
    "optionalParams": [
      "explicit_human_approval",
      "user_instruction",
      "proposal_id",
      "actor_role",
      "demo_session_id"
    ],
    "sandboxAvailability": "AVAILABLE_LIVE_SANDBOX",
    "equivalentRestEndpoint": "POST /v2/invoicing/invoices/{invoice_id}/conditional-rules",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/invoicing"
    ],
    "annotations": {
      "title": "PayPal MCP: Create Conditional Rules For Invoice",
      "readOnlyHint": false,
      "destructiveHint": false,
      "idempotentHint": false,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "required": [
        "invoice_id",
        "rules"
      ],
      "properties": {
        "invoice_id": {
          "type": "string",
          "description": "The ID of the invoice for which the conditional rules are to be created."
        },
        "rules": {
          "type": "array",
          "description": "The list of conditional rules to create for the invoice.",
          "items": {
            "type": "object",
            "properties": {
              "conditional_rule_type": {
                "type": "string",
                "enum": [
                  "EARLY_PAYMENT_DISCOUNT",
                  "AUTO_CANCEL"
                ],
                "description": "The type of conditional rule to apply to the invoice."
              },
              "conditional_rule_value_type": {
                "type": "string",
                "enum": [
                  "PERCENT",
                  "AMOUNT"
                ],
                "description": "The type of the conditional rule value. Required, and only applicable, when conditional_rule_type is EARLY_PAYMENT_DISCOUNT."
              },
              "conditional_rule_value": {
                "type": "string",
                "description": "The value of the conditional rule. Required, and only applicable, when conditional_rule_type is EARLY_PAYMENT_DISCOUNT. When conditional_rule_value_type is PERCENT, must be between 1 and 100."
              },
              "rule_expiry_terms": {
                "type": "object",
                "properties": {
                  "rule_expiry_condition": {
                    "type": "string",
                    "enum": [
                      "SPECIFIC_DATE",
                      "THREE_DAYS_AFTER_ISSUE_DATE",
                      "SEVEN_DAYS_AFTER_ISSUE_DATE",
                      "FIFTEEN_DAYS_AFTER_ISSUE_DATE",
                      "THIRTY_DAYS_AFTER_ISSUE_DATE"
                    ],
                    "description": "When the conditional rule expires: a specific date, or a period relative to the invoice issue date."
                  },
                  "condition_rule_end_date": {
                    "type": "string",
                    "pattern": "^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[1-2][0-9]|3[0-1])$",
                    "description": "The date the conditional rule expires, in yyyy-MM-dd format."
                  }
                },
                "required": [
                  "rule_expiry_condition",
                  "condition_rule_end_date"
                ],
                "additionalProperties": false,
                "description": "The expiry terms for the conditional rule."
              }
            },
            "required": [
              "conditional_rule_type",
              "rule_expiry_terms"
            ],
            "additionalProperties": false
          }
        },
        "explicit_human_approval": {
          "type": "boolean",
          "description": "Must be true (or provide an authorized user_instruction / proposal_id) to execute this PayPal Sandbox write operation."
        },
        "user_instruction": {
          "type": "string",
          "description": "Optional explicit user instruction authorizing this write within the $500/$2,500 guardrails."
        },
        "proposal_id": {
          "type": "string",
          "description": "Optional session-bound proposal ID authorizing this write."
        },
        "actor_role": {
          "type": "string",
          "enum": [
            "provider",
            "patient"
          ],
          "description": "Caller role for server-side RBAC verification (default: provider)."
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session identifier."
        }
      }
    }
  },
  // 53. create_product
  {
    "name": "create_product",
    "description": "[CONFIRMED_WRITE] Official PayPal MCP Tool (Catalog Products v1 — POST /v1/catalogs/products): Create a product in PayPal using product catalog - create products API.\nThis function creates a new product that will be used in subscription plans, subscriptions.\nRequired parameters are: name (product name), type (product type).\nHigh level: \n    - id: (auto-generated or specify SKU of the product) The ID of the product\n    - name: {product_name} (required) \n    - description: {product_description} (optional)\n    - type {DIGITAL | PHYSICAL | SERVICE} (required)\n    - category: {product_category} (optional) \n    - image_url: {image_url} (optional)\n    - home_url: {home_url} (optional)\n\nBelow is the payload request structure:\n{\n    \"id\": \"#PROD-XYAB12ABSB7868434\",\n    \"name\": \"Video Streaming Service\",\n    \"description\": \"Service for streaming latest series, movies etc.\",\n    \"type\": \"SERVICE\",\n    \"category\": \"SOFTWARE\",\n    \"image_url\": \"https://example.com/streaming.jpg\",\n    \"home_url\": \"https://example.com/home\"\n}",
    "source": "official_paypal_mcp",
    "officialPayPalEquivalent": "create_product",
    "classification": "confirmed_demo_write",
    "readVsWrite": "write",
    "permissions": "provider_only",
    "externalAuthRequired": "paypal_merchant_oauth",
    "idempotencyRequired": true,
    "auditEvent": "paypal_mcp_create_product",
    "errorHandling": "400 INVALID_REQUEST; 403 AUTHORIZATION_REQUIRED",
    "requiredParams": [
      "name",
      "type"
    ],
    "optionalParams": [
      "description",
      "category",
      "image_url",
      "home_url",
      "explicit_human_approval",
      "user_instruction",
      "proposal_id",
      "actor_role",
      "demo_session_id"
    ],
    "sandboxAvailability": "AVAILABLE_LIVE_SANDBOX",
    "equivalentRestEndpoint": "POST /v1/catalogs/products",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/subscriptions"
    ],
    "annotations": {
      "title": "PayPal MCP: Create Product",
      "readOnlyHint": false,
      "destructiveHint": false,
      "idempotentHint": false,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "required": [
        "name",
        "type"
      ],
      "properties": {
        "name": {
          "type": "string",
          "description": "The product name."
        },
        "type": {
          "type": "string",
          "description": "The product type. Value is PHYSICAL, DIGITAL, or SERVICE.",
          "enum": [
            "PHYSICAL",
            "DIGITAL",
            "SERVICE"
          ]
        },
        "description": {
          "type": "string",
          "description": "The product description."
        },
        "category": {
          "type": "string",
          "description": "The product category."
        },
        "image_url": {
          "type": "string",
          "description": "The image URL for the product."
        },
        "home_url": {
          "type": "string",
          "description": "The home page URL for the product."
        },
        "explicit_human_approval": {
          "type": "boolean",
          "description": "Must be true (or provide an authorized user_instruction / proposal_id) to execute this PayPal Sandbox write operation."
        },
        "user_instruction": {
          "type": "string",
          "description": "Optional explicit user instruction authorizing this write within the $500/$2,500 guardrails."
        },
        "proposal_id": {
          "type": "string",
          "description": "Optional session-bound proposal ID authorizing this write."
        },
        "actor_role": {
          "type": "string",
          "enum": [
            "provider",
            "patient"
          ],
          "description": "Caller role for server-side RBAC verification (default: provider)."
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session identifier."
        }
      }
    }
  },
  // 54. list_products
  {
    "name": "list_products",
    "description": "[READ_ONLY] Official PayPal MCP Tool (Catalog Products v1 — GET /v1/catalogs/products): List products from PayPal.\n\nThis function retrieves a list of products with optional pagination parameters.",
    "source": "official_paypal_mcp",
    "officialPayPalEquivalent": "list_products",
    "classification": "read_only",
    "readVsWrite": "read",
    "permissions": "provider_or_customer",
    "externalAuthRequired": "paypal_merchant_oauth",
    "idempotencyRequired": false,
    "auditEvent": null,
    "errorHandling": "400 INVALID_PARAMETER_VALUE",
    "requiredParams": [],
    "optionalParams": [
      "page",
      "page_size",
      "total_required",
      "demo_session_id"
    ],
    "sandboxAvailability": "AVAILABLE_LIVE_SANDBOX",
    "equivalentRestEndpoint": "GET /v1/catalogs/products",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/subscriptions"
    ],
    "annotations": {
      "title": "PayPal MCP: List Products",
      "readOnlyHint": true,
      "destructiveHint": false,
      "idempotentHint": true,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "properties": {
        "page": {
          "type": "number",
          "description": "The page number of the result set to fetch."
        },
        "page_size": {
          "type": "number",
          "description": "The number of records to return per page (maximum 100)."
        },
        "total_required": {
          "type": "boolean",
          "description": "Indicates whether the response should include the total count of products."
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session identifier."
        }
      }
    }
  },
  // 55. update_product
  {
    "name": "update_product",
    "description": "[CONFIRMED_WRITE] Official PayPal MCP Tool (Catalog Products v1 — PATCH /v1/catalogs/products/{product_id}): Update a product in PayPal.\n\nThis function updates an existing product using JSON Patch operations.",
    "source": "official_paypal_mcp",
    "officialPayPalEquivalent": "update_product",
    "classification": "confirmed_demo_write",
    "readVsWrite": "write",
    "permissions": "provider_only",
    "externalAuthRequired": "paypal_merchant_oauth",
    "idempotencyRequired": true,
    "auditEvent": "paypal_mcp_update_product",
    "errorHandling": "404 RESOURCE_NOT_FOUND; 400 INVALID_PATCH_OPERATION; 403 AUTHORIZATION_REQUIRED",
    "requiredParams": [
      "product_id",
      "operations"
    ],
    "optionalParams": [
      "explicit_human_approval",
      "user_instruction",
      "proposal_id",
      "actor_role",
      "demo_session_id"
    ],
    "sandboxAvailability": "AVAILABLE_LIVE_SANDBOX",
    "equivalentRestEndpoint": "PATCH /v1/catalogs/products/{product_id}",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/subscriptions"
    ],
    "annotations": {
      "title": "PayPal MCP: Update Product",
      "readOnlyHint": false,
      "destructiveHint": false,
      "idempotentHint": false,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "required": [
        "product_id",
        "operations"
      ],
      "properties": {
        "product_id": {
          "type": "string",
          "description": "The ID of the product to update."
        },
        "operations": {
          "type": "array",
          "description": "The PATCH operations to perform on the product.",
          "items": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        },
        "explicit_human_approval": {
          "type": "boolean",
          "description": "Must be true (or provide an authorized user_instruction / proposal_id) to execute this PayPal Sandbox write operation."
        },
        "user_instruction": {
          "type": "string",
          "description": "Optional explicit user instruction authorizing this write within the $500/$2,500 guardrails."
        },
        "proposal_id": {
          "type": "string",
          "description": "Optional session-bound proposal ID authorizing this write."
        },
        "actor_role": {
          "type": "string",
          "enum": [
            "provider",
            "patient"
          ],
          "description": "Caller role for server-side RBAC verification (default: provider)."
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session identifier."
        }
      }
    }
  },
  // 56. show_product_details
  {
    "name": "show_product_details",
    "description": "[READ_ONLY] Official PayPal MCP Tool (Catalog Products v1 — GET /v1/catalogs/products/{product_id}): List products from PayPal.\n\nThis function retrieves a list of products with optional pagination parameters.",
    "source": "official_paypal_mcp",
    "officialPayPalEquivalent": "show_product_details",
    "classification": "read_only",
    "readVsWrite": "read",
    "permissions": "provider_or_customer",
    "externalAuthRequired": "paypal_merchant_oauth",
    "idempotencyRequired": false,
    "auditEvent": null,
    "errorHandling": "404 RESOURCE_NOT_FOUND",
    "requiredParams": [
      "product_id"
    ],
    "optionalParams": [
      "demo_session_id"
    ],
    "sandboxAvailability": "AVAILABLE_LIVE_SANDBOX",
    "equivalentRestEndpoint": "GET /v1/catalogs/products/{product_id}",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/subscriptions"
    ],
    "annotations": {
      "title": "PayPal MCP: Show Product Details",
      "readOnlyHint": true,
      "destructiveHint": false,
      "idempotentHint": true,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "required": [
        "product_id"
      ],
      "properties": {
        "product_id": {
          "type": "string",
          "description": "The ID of the product to update."
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session identifier."
        }
      }
    }
  },
  // 57. create_subscription_plan
  {
    "name": "create_subscription_plan",
    "description": "[CONFIRMED_WRITE] Official PayPal MCP Tool (Subscriptions v1 (Plans) — POST /v1/billing/plans): Create a subsctiption plan in PayPal using subscription - create plan API.\nThis function creates a new subscription plan that defines pricing and billing cycle details for subscriptions.\nRequired parameters are: product_id (the ID of the product for which to create the plan), name (subscription plan name), billing_cycles (billing cycle details).\nHigh level: product_id, name, description, taxes, status: {CREATED|INACTIVE|ACTIVE}, billing_cycles, payment_preferences are required in json object.\nWhile creating billing_cycles object, trial(second) billing cycle should precede regular billing cycle.",
    "source": "official_paypal_mcp",
    "officialPayPalEquivalent": "create_subscription_plan",
    "classification": "confirmed_demo_write",
    "readVsWrite": "write",
    "permissions": "provider_only",
    "externalAuthRequired": "paypal_merchant_oauth",
    "idempotencyRequired": true,
    "auditEvent": "paypal_mcp_create_subscription_plan",
    "errorHandling": "400 INVALID_REQUEST; 403 AUTHORIZATION_REQUIRED; 422 GUARDRAIL_SINGLE_ACTION_LIMIT_EXCEEDED",
    "requiredParams": [
      "product_id",
      "name",
      "billing_cycles"
    ],
    "optionalParams": [
      "description",
      "payment_preferences",
      "taxes",
      "explicit_human_approval",
      "user_instruction",
      "proposal_id",
      "actor_role",
      "demo_session_id"
    ],
    "sandboxAvailability": "AVAILABLE_LIVE_SANDBOX",
    "equivalentRestEndpoint": "POST /v1/billing/plans",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/subscriptions"
    ],
    "annotations": {
      "title": "PayPal MCP: Create Subscription Plan",
      "readOnlyHint": false,
      "destructiveHint": false,
      "idempotentHint": false,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "required": [
        "product_id",
        "name",
        "billing_cycles"
      ],
      "properties": {
        "product_id": {
          "type": "string",
          "description": "The ID of the product for which to create the plan."
        },
        "name": {
          "type": "string",
          "description": "The subscription plan name."
        },
        "description": {
          "type": "string",
          "description": "The subscription plan description."
        },
        "billing_cycles": {
          "type": "array",
          "description": "The billing cycles of the plan.",
          "items": {
            "type": "object",
            "properties": {
              "frequency": {
                "type": "object",
                "properties": {
                  "interval_unit": {
                    "type": "string",
                    "enum": [
                      "DAY",
                      "WEEK",
                      "MONTH",
                      "YEAR"
                    ],
                    "description": "The unit of time for the billing cycle."
                  },
                  "interval_count": {
                    "type": "number",
                    "description": "The number of units for the billing cycle."
                  }
                },
                "required": [
                  "interval_unit",
                  "interval_count"
                ],
                "additionalProperties": true,
                "description": "The frequency of the billing cycle."
              },
              "tenure_type": {
                "type": "string",
                "enum": [
                  "REGULAR",
                  "TRIAL"
                ],
                "description": "The type of billing cycle tenure."
              },
              "sequence": {
                "type": "number",
                "description": "The sequence of the billing cycle."
              },
              "total_cycles": {
                "type": "number",
                "description": "The total number of cycles in the billing plan."
              },
              "pricing_scheme": {
                "type": "object",
                "properties": {
                  "fixed_price": {
                    "type": "object",
                    "properties": {
                      "currency_code": {
                        "type": "string",
                        "enum": [
                          "USD"
                        ],
                        "description": "The currency code for the fixed price."
                      },
                      "value": {
                        "type": "string",
                        "description": "The value of the fixed price."
                      }
                    },
                    "required": [
                      "currency_code",
                      "value"
                    ],
                    "additionalProperties": true,
                    "description": "The fixed price for the subscription plan."
                  },
                  "version": {
                    "type": "string",
                    "description": "The version of the pricing scheme."
                  }
                },
                "additionalProperties": true,
                "description": "The pricing scheme for the billing cycle."
              }
            },
            "required": [
              "frequency",
              "tenure_type",
              "sequence",
              "pricing_scheme"
            ],
            "additionalProperties": true
          }
        },
        "payment_preferences": {
          "type": "object",
          "description": "The payment preferences for the subscription plan.",
          "properties": {
            "auto_bill_outstanding": {
              "type": "boolean",
              "description": "Indicates whether to automatically bill outstanding amounts."
            },
            "setup_fee": {
              "type": "object",
              "properties": {
                "currency_code": {
                  "type": "string",
                  "enum": [
                    "USD"
                  ],
                  "description": "The currency code for the setup fee."
                },
                "value": {
                  "type": "string",
                  "description": "The value of the setup fee."
                }
              },
              "additionalProperties": true,
              "description": "The setup fee for the subscription plan."
            },
            "setup_fee_failure_action": {
              "type": "string",
              "enum": [
                "CONTINUE",
                "CANCEL"
              ],
              "description": "The action to take if the setup fee payment fails."
            },
            "payment_failure_threshold": {
              "type": "number",
              "description": "The number of failed payments before the subscription is canceled."
            }
          }
        },
        "taxes": {
          "type": "object",
          "description": "The tax details.",
          "properties": {
            "percentage": {
              "type": "string",
              "description": "The tax percentage."
            },
            "inclusive": {
              "type": "boolean",
              "description": "Indicates whether the tax is inclusive."
            }
          }
        },
        "explicit_human_approval": {
          "type": "boolean",
          "description": "Must be true (or provide an authorized user_instruction / proposal_id) to execute this PayPal Sandbox write operation."
        },
        "user_instruction": {
          "type": "string",
          "description": "Optional explicit user instruction authorizing this write within the $500/$2,500 guardrails."
        },
        "proposal_id": {
          "type": "string",
          "description": "Optional session-bound proposal ID authorizing this write."
        },
        "actor_role": {
          "type": "string",
          "enum": [
            "provider",
            "patient"
          ],
          "description": "Caller role for server-side RBAC verification (default: provider)."
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session identifier."
        }
      }
    }
  },
  // 58. list_subscription_plans
  {
    "name": "list_subscription_plans",
    "description": "[READ_ONLY] Official PayPal MCP Tool (Subscriptions v1 (Plans) — GET /v1/billing/plans): List subscription plans from PayPal.\n\nThis function retrieves a list of subscription plans with optional product filtering and pagination parameters.",
    "source": "official_paypal_mcp",
    "officialPayPalEquivalent": "list_subscription_plans",
    "classification": "read_only",
    "readVsWrite": "read",
    "permissions": "provider_or_customer",
    "externalAuthRequired": "paypal_merchant_oauth",
    "idempotencyRequired": false,
    "auditEvent": null,
    "errorHandling": "400 INVALID_PARAMETER_VALUE",
    "requiredParams": [],
    "optionalParams": [
      "product_id",
      "page",
      "page_size",
      "total_required",
      "demo_session_id"
    ],
    "sandboxAvailability": "AVAILABLE_LIVE_SANDBOX",
    "equivalentRestEndpoint": "GET /v1/billing/plans",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/subscriptions"
    ],
    "annotations": {
      "title": "PayPal MCP: List Subscription Plans",
      "readOnlyHint": true,
      "destructiveHint": false,
      "idempotentHint": true,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "properties": {
        "product_id": {
          "type": "string",
          "description": "The ID of the product for which to get subscription plans."
        },
        "page": {
          "type": "number",
          "description": "The page number of the result set to fetch."
        },
        "page_size": {
          "type": "number",
          "description": "The number of records to return per page (maximum 100)."
        },
        "total_required": {
          "type": "boolean",
          "description": "Indicates whether the response should include the total count of plans."
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session identifier."
        }
      }
    }
  },
  // 59. show_subscription_plan_details
  {
    "name": "show_subscription_plan_details",
    "description": "[READ_ONLY] Official PayPal MCP Tool (Subscriptions v1 (Plans) — GET /v1/billing/plans/{plan_id}): Show subscription plan details from PayPal.\nThis function retrieves the details of a specific subscription plan using its ID.\nRequired parameters are: plan_id (the ID of the subscription plan).",
    "source": "official_paypal_mcp",
    "officialPayPalEquivalent": "show_subscription_plan_details",
    "classification": "read_only",
    "readVsWrite": "read",
    "permissions": "provider_or_customer",
    "externalAuthRequired": "paypal_merchant_oauth",
    "idempotencyRequired": false,
    "auditEvent": null,
    "errorHandling": "404 RESOURCE_NOT_FOUND",
    "requiredParams": [
      "plan_id"
    ],
    "optionalParams": [
      "demo_session_id"
    ],
    "sandboxAvailability": "AVAILABLE_LIVE_SANDBOX",
    "equivalentRestEndpoint": "GET /v1/billing/plans/{plan_id}",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/subscriptions"
    ],
    "annotations": {
      "title": "PayPal MCP: Show Subscription Plan Details",
      "readOnlyHint": true,
      "destructiveHint": false,
      "idempotentHint": true,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "required": [
        "plan_id"
      ],
      "properties": {
        "plan_id": {
          "type": "string",
          "description": "The ID of the subscription plan to show."
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session identifier."
        }
      }
    }
  },
  // 60. create_subscription
  {
    "name": "create_subscription",
    "description": "[CONFIRMED_WRITE] Official PayPal MCP Tool (Subscriptions v1 — POST /v1/billing/subscriptions): Create a subscription in PayPal using the subscription - create subscription API.\nThis function allows you to create a new subscription for a specific plan, enabling the management of recurring payments.\nThe only required parameter is plan_id (the ID of the subscription plan). All other fields are optional and can be omitted if not provided.\nThe subscriber field is optional. If no subscriber information is provided, omit the subscriber field in the request payload.\nThe shipping address is optional. If no shipping address is provided, set the shipping_preference to GET_FROM_FILE in the application context.\nThe application context is also optional. If no application context information is provided, omit the application context field in the request payload.",
    "source": "official_paypal_mcp",
    "officialPayPalEquivalent": "create_subscription",
    "classification": "confirmed_demo_write",
    "readVsWrite": "write",
    "permissions": "provider_or_customer",
    "externalAuthRequired": "paypal_merchant_oauth",
    "idempotencyRequired": true,
    "auditEvent": "paypal_mcp_create_subscription",
    "errorHandling": "404 RESOURCE_NOT_FOUND (plan_id); 403 AUTHORIZATION_REQUIRED",
    "requiredParams": [
      "plan_id"
    ],
    "optionalParams": [
      "quantity",
      "shipping_amount",
      "subscriber",
      "application_context",
      "explicit_human_approval",
      "user_instruction",
      "proposal_id",
      "actor_role",
      "demo_session_id"
    ],
    "sandboxAvailability": "AVAILABLE_LIVE_SANDBOX",
    "equivalentRestEndpoint": "POST /v1/billing/subscriptions",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/subscriptions"
    ],
    "annotations": {
      "title": "PayPal MCP: Create Subscription",
      "readOnlyHint": false,
      "destructiveHint": false,
      "idempotentHint": false,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "required": [
        "plan_id"
      ],
      "properties": {
        "plan_id": {
          "type": "string",
          "description": "The ID of the subscription plan to create."
        },
        "quantity": {
          "type": "number",
          "description": "The quantity of the product in the subscription."
        },
        "shipping_amount": {
          "type": "object",
          "description": "The shipping amount for the subscription.",
          "properties": {
            "currency_code": {
              "type": "string",
              "enum": [
                "USD"
              ],
              "description": "The currency code for the shipping amount."
            },
            "value": {
              "type": "string",
              "description": "The value of the shipping amount."
            }
          }
        },
        "subscriber": {
          "type": "object",
          "description": "The subscriber details.",
          "properties": {
            "name": {
              "type": "object",
              "properties": {
                "given_name": {
                  "type": "string",
                  "description": "The subscriber given name."
                },
                "surname": {
                  "type": "string",
                  "description": "The subscriber last name."
                }
              },
              "additionalProperties": false,
              "description": "The subscriber name."
            },
            "email_address": {
              "type": "string",
              "description": "The subscriber email address."
            },
            "shipping_address": {
              "type": "object",
              "properties": {
                "name": {
                  "$ref": "#/properties/subscriber/properties/name",
                  "description": "The subscriber shipping address name."
                },
                "address": {
                  "type": "object",
                  "properties": {
                    "address_line_1": {
                      "type": "string",
                      "description": "The first line of the address."
                    },
                    "address_line_2": {
                      "type": "string",
                      "description": "The second line of the address."
                    },
                    "admin_area_1": {
                      "type": "string",
                      "description": "The city or locality."
                    },
                    "admin_area_2": {
                      "type": "string",
                      "description": "The state or province."
                    },
                    "postal_code": {
                      "type": "string",
                      "description": "The postal code."
                    },
                    "country_code": {
                      "type": "string",
                      "enum": [
                        "US"
                      ],
                      "description": "The country code."
                    }
                  },
                  "required": [
                    "address_line_1",
                    "admin_area_1",
                    "admin_area_2",
                    "postal_code",
                    "country_code"
                  ],
                  "additionalProperties": false,
                  "description": "The shipping address."
                }
              },
              "additionalProperties": false,
              "description": "The subscriber shipping address."
            }
          }
        },
        "application_context": {
          "type": "object",
          "description": "The application context for the subscription.",
          "properties": {
            "brand_name": {
              "type": "string",
              "description": "The brand name."
            },
            "locale": {
              "type": "string",
              "description": "The locale for the subscription."
            },
            "shipping_preference": {
              "type": "string",
              "enum": [
                "SET_PROVIDED_ADDRESS",
                "GET_FROM_FILE"
              ],
              "description": "The shipping preference."
            },
            "user_action": {
              "type": "string",
              "enum": [
                "SUBSCRIBE_NOW",
                "CONTINUE"
              ],
              "description": "The user action."
            },
            "return_url": {
              "type": "string",
              "description": "The return URL after the subscription is created."
            },
            "cancel_url": {
              "type": "string",
              "description": "The cancel URL if the user cancels the subscription."
            },
            "payment_method": {
              "type": "object",
              "properties": {
                "payer_selected": {
                  "type": "string",
                  "enum": [
                    "PAYPAL",
                    "CREDIT_CARD"
                  ],
                  "description": "The payment method selected by the payer."
                },
                "payee_preferred": {
                  "type": "string",
                  "enum": [
                    "IMMEDIATE_PAYMENT_REQUIRED",
                    "INSTANT_FUNDING_SOURCE"
                  ],
                  "description": "The preferred payment method for the payee."
                }
              },
              "required": [
                "payer_selected"
              ],
              "additionalProperties": false,
              "description": "The payment method details."
            }
          }
        },
        "explicit_human_approval": {
          "type": "boolean",
          "description": "Must be true (or provide an authorized user_instruction / proposal_id) to execute this PayPal Sandbox write operation."
        },
        "user_instruction": {
          "type": "string",
          "description": "Optional explicit user instruction authorizing this write within the $500/$2,500 guardrails."
        },
        "proposal_id": {
          "type": "string",
          "description": "Optional session-bound proposal ID authorizing this write."
        },
        "actor_role": {
          "type": "string",
          "enum": [
            "provider",
            "patient"
          ],
          "description": "Caller role for server-side RBAC verification (default: provider)."
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session identifier."
        }
      }
    }
  },
  // 61. show_subscription_details
  {
    "name": "show_subscription_details",
    "description": "[READ_ONLY] Official PayPal MCP Tool (Subscriptions v1 — GET /v1/billing/subscriptions/{subscription_id}): Show subscription details from PayPal.\nThis function retrieves the details of a specific subscription using its ID.\nRequired parameters are: subscription_id (the ID of the subscription).",
    "source": "official_paypal_mcp",
    "officialPayPalEquivalent": "show_subscription_details",
    "classification": "read_only",
    "readVsWrite": "read",
    "permissions": "provider_or_customer",
    "externalAuthRequired": "paypal_merchant_oauth",
    "idempotencyRequired": false,
    "auditEvent": null,
    "errorHandling": "404 RESOURCE_NOT_FOUND",
    "requiredParams": [
      "subscription_id"
    ],
    "optionalParams": [
      "get_additional_details",
      "demo_session_id"
    ],
    "sandboxAvailability": "AVAILABLE_LIVE_SANDBOX",
    "equivalentRestEndpoint": "GET /v1/billing/subscriptions/{subscription_id}",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/subscriptions"
    ],
    "annotations": {
      "title": "PayPal MCP: Show Subscription Details",
      "readOnlyHint": true,
      "destructiveHint": false,
      "idempotentHint": true,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "required": [
        "subscription_id"
      ],
      "properties": {
        "subscription_id": {
          "type": "string",
          "description": "The ID of the subscription to show details."
        },
        "get_additional_details": {
          "type": "boolean",
          "description": "Get all detailed information for the subscription."
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session identifier."
        }
      }
    }
  },
  // 62. cancel_subscription
  {
    "name": "cancel_subscription",
    "description": "[CONFIRMED_WRITE] Official PayPal MCP Tool (Subscriptions v1 — POST /v1/billing/subscriptions/{subscription_id}/cancel): Cancel a customer subscription in PayPal.\n\nThis function cancels an active subscription for a customer. It requires the subscription ID and an optional reason for cancellation.\nRequired parameters are: subscription_id (the ID of the subscription to be canceled).\nBelow is the payload request structure:\n{\n    \"reason\": \"Customer requested cancellation\"\n}\nYou MUST ask the user for: \n - subscription_id\n - reason for cancellation.\n\nReturn all of the above as structured JSON in your response.",
    "source": "official_paypal_mcp",
    "officialPayPalEquivalent": "cancel_subscription",
    "classification": "confirmed_demo_write",
    "readVsWrite": "write",
    "permissions": "provider_or_customer",
    "externalAuthRequired": "paypal_merchant_oauth",
    "idempotencyRequired": true,
    "auditEvent": "paypal_mcp_cancel_subscription",
    "errorHandling": "404 RESOURCE_NOT_FOUND; 422 SUBSCRIPTION_STATUS_INVALID; 403 AUTHORIZATION_REQUIRED",
    "requiredParams": [
      "subscription_id",
      "payload"
    ],
    "optionalParams": [
      "explicit_human_approval",
      "user_instruction",
      "proposal_id",
      "actor_role",
      "demo_session_id"
    ],
    "sandboxAvailability": "AVAILABLE_LIVE_SANDBOX",
    "equivalentRestEndpoint": "POST /v1/billing/subscriptions/{subscription_id}/cancel",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/subscriptions"
    ],
    "annotations": {
      "title": "PayPal MCP: Cancel Subscription",
      "readOnlyHint": false,
      "destructiveHint": true,
      "idempotentHint": false,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "required": [
        "subscription_id",
        "payload"
      ],
      "properties": {
        "subscription_id": {
          "type": "string",
          "description": "The ID of the subscription to show details."
        },
        "payload": {
          "type": "object",
          "description": "Payload for subscription cancellation.",
          "properties": {
            "reason": {
              "type": "string",
              "description": "The reason for the cancellation of a subscription."
            }
          }
        },
        "explicit_human_approval": {
          "type": "boolean",
          "description": "Must be true (or provide an authorized user_instruction / proposal_id) to execute this PayPal Sandbox write operation."
        },
        "user_instruction": {
          "type": "string",
          "description": "Optional explicit user instruction authorizing this write within the $500/$2,500 guardrails."
        },
        "proposal_id": {
          "type": "string",
          "description": "Optional session-bound proposal ID authorizing this write."
        },
        "actor_role": {
          "type": "string",
          "enum": [
            "provider",
            "patient"
          ],
          "description": "Caller role for server-side RBAC verification (default: provider)."
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session identifier."
        }
      }
    }
  },
  // 63. update_subscription
  {
    "name": "update_subscription",
    "description": "[CONFIRMED_WRITE] Official PayPal MCP Tool (Subscriptions v1 — PATCH /v1/billing/subscriptions/{subscription_id}): Update a customer subscription in PayPal.\n\nThis function updates an active or suspended subscription for a customer. It requires the subscription ID and payload of allowed keys to update to the subscription.\nRequired parameters are: subscription_id (the ID of the subscription to be updated), and at-least one key to update\n\nReturn response as structured JSON in your response.",
    "source": "official_paypal_mcp",
    "officialPayPalEquivalent": "update_subscription",
    "classification": "confirmed_demo_write",
    "readVsWrite": "write",
    "permissions": "provider_only",
    "externalAuthRequired": "paypal_merchant_oauth",
    "idempotencyRequired": true,
    "auditEvent": "paypal_mcp_update_subscription",
    "errorHandling": "404 RESOURCE_NOT_FOUND; 422 SUBSCRIPTION_STATUS_INVALID; 403 AUTHORIZATION_REQUIRED",
    "requiredParams": [
      "subscription_id"
    ],
    "optionalParams": [
      "currency_code",
      "outstanding_balance",
      "custom_id",
      "fixed_price",
      "payment_failure_threshold",
      "auto_bill_outstanding",
      "taxes_inclusive",
      "taxes_percentage",
      "shipping_amount",
      "shipping_address",
      "explicit_human_approval",
      "user_instruction",
      "proposal_id",
      "actor_role",
      "demo_session_id"
    ],
    "sandboxAvailability": "AVAILABLE_LIVE_SANDBOX",
    "equivalentRestEndpoint": "PATCH /v1/billing/subscriptions/{subscription_id}",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/subscriptions"
    ],
    "annotations": {
      "title": "PayPal MCP: Update Subscription",
      "readOnlyHint": false,
      "destructiveHint": false,
      "idempotentHint": false,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "required": [
        "subscription_id"
      ],
      "properties": {
        "subscription_id": {
          "type": "string",
          "description": "The ID of the subscription to update."
        },
        "currency_code": {
          "type": "string",
          "description": "Currency code of the amount.",
          "enum": [
            "USD"
          ]
        },
        "outstanding_balance": {
          "type": "string",
          "description": "Outstanding Balance in the subscription"
        },
        "custom_id": {
          "type": "string",
          "description": "The custom id for the subscription"
        },
        "fixed_price": {
          "type": "object",
          "description": "The fixed price for a billing cycle.",
          "properties": {
            "value": {
              "type": "string",
              "description": "The fixed price for the subscription."
            },
            "sequence": {
              "type": "number",
              "description": "The order sequence for the billing cycles"
            }
          }
        },
        "payment_failure_threshold": {
          "type": "number",
          "description": "The number of failed payments before the subscription is canceled."
        },
        "auto_bill_outstanding": {
          "type": "boolean",
          "description": "Indicates whether to automatically bill outstanding amounts."
        },
        "taxes_inclusive": {
          "type": "boolean",
          "description": "Indicates whether the tax is inclusive."
        },
        "taxes_percentage": {
          "type": "string",
          "description": "The tax percentage."
        },
        "shipping_amount": {
          "type": "string",
          "description": "The value of the shipping amount."
        },
        "shipping_address": {
          "type": "object",
          "description": "The shipping address.",
          "properties": {
            "name": {
              "type": "object",
              "properties": {
                "given_name": {
                  "type": "string",
                  "description": "The subscriber given name."
                },
                "surname": {
                  "type": "string",
                  "description": "The subscriber last name."
                }
              },
              "additionalProperties": false,
              "description": "The subscriber shipping address name."
            },
            "address": {
              "type": "object",
              "properties": {
                "address_line_1": {
                  "type": "string",
                  "description": "The first line of the address."
                },
                "address_line_2": {
                  "type": "string",
                  "description": "The second line of the address."
                },
                "admin_area_1": {
                  "type": "string",
                  "description": "The city or locality."
                },
                "admin_area_2": {
                  "type": "string",
                  "description": "The state or province."
                },
                "postal_code": {
                  "type": "string",
                  "description": "The postal code."
                },
                "country_code": {
                  "type": "string",
                  "enum": [
                    "US"
                  ],
                  "description": "The country code."
                }
              },
              "required": [
                "address_line_1",
                "admin_area_1",
                "admin_area_2",
                "postal_code",
                "country_code"
              ],
              "additionalProperties": false,
              "description": "The shipping address."
            }
          }
        },
        "explicit_human_approval": {
          "type": "boolean",
          "description": "Must be true (or provide an authorized user_instruction / proposal_id) to execute this PayPal Sandbox write operation."
        },
        "user_instruction": {
          "type": "string",
          "description": "Optional explicit user instruction authorizing this write within the $500/$2,500 guardrails."
        },
        "proposal_id": {
          "type": "string",
          "description": "Optional session-bound proposal ID authorizing this write."
        },
        "actor_role": {
          "type": "string",
          "enum": [
            "provider",
            "patient"
          ],
          "description": "Caller role for server-side RBAC verification (default: provider)."
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session identifier."
        }
      }
    }
  },
  // 64. create_shipment_tracking
  {
    "name": "create_shipment_tracking",
    "description": "[CONFIRMED_WRITE] Official PayPal MCP Tool (Shipping Trackers v1 — POST /v1/shipping/trackers-batch): Create a shipment for a transaction in PayPal.\nThis function creates a shipment record for a specific transaction, allowing you to track the shipment status and details.\nThe transaction_id can fetch from the captured payment details in the order information.\nRequired parameters are: tracking_number (the tracking number for the shipment), transaction_id (the transaction ID associated with the shipment). \nHigh level: tracking_number, transaction_id, status (optional), carrier (optional) are required json objects.\nBelow is the payload request structure:\n{\n    \"tracking_number\": \"1234567890\",\n    \"transaction_id\": \"9XJ12345ABC67890\",\n    \"status\": \"SHIPPED\", // Required: ON_HOLD, SHIPPED, DELIVERED, CANCELLED\n    \"carrier\": \"UPS\" // Required: The carrier handling the shipment. Link to supported carriers: http://developer.paypal.com/docs/tracking/reference/carriers/\n}",
    "source": "official_paypal_mcp",
    "officialPayPalEquivalent": "create_shipment_tracking",
    "classification": "confirmed_demo_write",
    "readVsWrite": "write",
    "permissions": "provider_only",
    "externalAuthRequired": "paypal_merchant_oauth",
    "idempotencyRequired": true,
    "auditEvent": "paypal_mcp_create_shipment_tracking",
    "errorHandling": "400 INVALID_REQUEST; 403 AUTHORIZATION_REQUIRED",
    "requiredParams": [
      "tracking_number",
      "transaction_id"
    ],
    "optionalParams": [
      "order_id",
      "status",
      "carrier",
      "explicit_human_approval",
      "user_instruction",
      "proposal_id",
      "actor_role",
      "demo_session_id"
    ],
    "sandboxAvailability": "AVAILABLE_LIVE_SANDBOX",
    "equivalentRestEndpoint": "POST /v1/shipping/trackers-batch",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/shipping/trackers/readwrite"
    ],
    "annotations": {
      "title": "PayPal MCP: Create Shipment Tracking",
      "readOnlyHint": false,
      "destructiveHint": false,
      "idempotentHint": false,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "required": [
        "tracking_number",
        "transaction_id"
      ],
      "properties": {
        "order_id": {
          "type": "string",
          "description": "The ID of the order for which to create a shipment"
        },
        "tracking_number": {
          "type": "string",
          "description": "The tracking number for the shipment. Id is provided by the shipper. This is required to create a shipment."
        },
        "transaction_id": {
          "type": "string",
          "description": "The transaction ID associated with the shipment. Transaction id available after the order is paid or captured. This is required to create a shipment."
        },
        "status": {
          "type": "string",
          "description": "The status of the shipment. It can be \"ON_HOLD\", \"SHIPPED\", \"DELIVERED\", or \"CANCELLED\"."
        },
        "carrier": {
          "type": "string",
          "description": "The carrier handling the shipment."
        },
        "explicit_human_approval": {
          "type": "boolean",
          "description": "Must be true (or provide an authorized user_instruction / proposal_id) to execute this PayPal Sandbox write operation."
        },
        "user_instruction": {
          "type": "string",
          "description": "Optional explicit user instruction authorizing this write within the $500/$2,500 guardrails."
        },
        "proposal_id": {
          "type": "string",
          "description": "Optional session-bound proposal ID authorizing this write."
        },
        "actor_role": {
          "type": "string",
          "enum": [
            "provider",
            "patient"
          ],
          "description": "Caller role for server-side RBAC verification (default: provider)."
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session identifier."
        }
      }
    }
  },
  // 65. get_shipment_tracking
  {
    "name": "get_shipment_tracking",
    "description": "[READ_ONLY] Official PayPal MCP Tool (Shipping Trackers v1 — GET /v1/shipping/trackers?transaction_id={transaction_id}): Get tracking information for a shipment by ID.\nThis function retrieves tracking information for a specific shipment using the transaction ID and tracking number.\nThe transaction_id can fetch from the captured payment details in the order information.\nBelow is the payload request structure:",
    "source": "official_paypal_mcp",
    "officialPayPalEquivalent": "get_shipment_tracking",
    "classification": "read_only",
    "readVsWrite": "read",
    "permissions": "provider_or_customer",
    "externalAuthRequired": "paypal_merchant_oauth",
    "idempotencyRequired": false,
    "auditEvent": null,
    "errorHandling": "400 MISSING_TRANSACTION_OR_ORDER_ID; 404 RESOURCE_NOT_FOUND",
    "requiredParams": [],
    "optionalParams": [
      "order_id",
      "transaction_id",
      "demo_session_id"
    ],
    "sandboxAvailability": "AVAILABLE_LIVE_SANDBOX",
    "equivalentRestEndpoint": "GET /v1/shipping/trackers?transaction_id={transaction_id}",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/shipping/trackers/readwrite"
    ],
    "annotations": {
      "title": "PayPal MCP: Get Shipment Tracking",
      "readOnlyHint": true,
      "destructiveHint": false,
      "idempotentHint": true,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "properties": {
        "order_id": {
          "type": "string",
          "description": "The ID of the order for which to create a shipment."
        },
        "transaction_id": {
          "type": "string",
          "description": "The transaction ID associated with the shipment tracking to retrieve."
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session identifier."
        }
      }
    }
  },
  // 66. update_shipment_tracking
  {
    "name": "update_shipment_tracking",
    "description": "[CONFIRMED_WRITE] Official PayPal MCP Tool (Shipping Trackers v1 — PUT /v1/shipping/trackers/{transaction_id}-{tracking_number}): Update tracking information for a shipment by ID and status. \n\nThis tool updates tracking information such as the carrier or the tracking number for a specific shipment using the transaction ID and status.",
    "source": "official_paypal_mcp",
    "officialPayPalEquivalent": "update_shipment_tracking",
    "classification": "confirmed_demo_write",
    "readVsWrite": "write",
    "permissions": "provider_only",
    "externalAuthRequired": "paypal_merchant_oauth",
    "idempotencyRequired": true,
    "auditEvent": "paypal_mcp_update_shipment_tracking",
    "errorHandling": "404 RESOURCE_NOT_FOUND; 403 AUTHORIZATION_REQUIRED",
    "requiredParams": [
      "transaction_id",
      "tracking_number",
      "status"
    ],
    "optionalParams": [
      "new_tracking_number",
      "carrier",
      "explicit_human_approval",
      "user_instruction",
      "proposal_id",
      "actor_role",
      "demo_session_id"
    ],
    "sandboxAvailability": "AVAILABLE_LIVE_SANDBOX",
    "equivalentRestEndpoint": "PUT /v1/shipping/trackers/{transaction_id}-{tracking_number}",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/shipping/trackers/readwrite"
    ],
    "annotations": {
      "title": "PayPal MCP: Update Shipment Tracking",
      "readOnlyHint": false,
      "destructiveHint": false,
      "idempotentHint": true,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "required": [
        "transaction_id",
        "tracking_number",
        "status"
      ],
      "properties": {
        "transaction_id": {
          "type": "string",
          "description": "The transaction ID associated with the shipment tracking to retrieve."
        },
        "tracking_number": {
          "type": "string",
          "description": "The tracking number that you want to update."
        },
        "new_tracking_number": {
          "type": "string",
          "description": "The new tracking number for the shipment if being updated."
        },
        "status": {
          "type": "string",
          "description": "The status of the item shipment. It can be \"CANCELLED\", \"DELIVERED\", \"LOCAL_PICKUP\", \"ON_HOLD\", or \"SHIPPED\"."
        },
        "carrier": {
          "type": "string",
          "description": "The carrier handling the shipment."
        },
        "explicit_human_approval": {
          "type": "boolean",
          "description": "Must be true (or provide an authorized user_instruction / proposal_id) to execute this PayPal Sandbox write operation."
        },
        "user_instruction": {
          "type": "string",
          "description": "Optional explicit user instruction authorizing this write within the $500/$2,500 guardrails."
        },
        "proposal_id": {
          "type": "string",
          "description": "Optional session-bound proposal ID authorizing this write."
        },
        "actor_role": {
          "type": "string",
          "enum": [
            "provider",
            "patient"
          ],
          "description": "Caller role for server-side RBAC verification (default: provider)."
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session identifier."
        }
      }
    }
  },
  // 67. create_order
  {
    "name": "create_order",
    "description": "[CONFIRMED_WRITE] Official PayPal MCP Tool (Orders v2 — POST /v2/checkout/orders): Create an order in PayPal.\n\nThis tool is used to create a new order in PayPal. This is typically the first step in initiating a payment flow. It sets up an order with specified details such as item(s) to be purchased, quantity, amount, currency, and other details.",
    "source": "official_paypal_mcp",
    "officialPayPalEquivalent": "create_order",
    "classification": "confirmed_demo_write",
    "readVsWrite": "write",
    "permissions": "provider_or_customer",
    "externalAuthRequired": "paypal_merchant_oauth",
    "idempotencyRequired": true,
    "auditEvent": "paypal_mcp_create_order",
    "errorHandling": "400 INVALID_REQUEST; 403 AUTHORIZATION_REQUIRED; 422 GUARDRAIL_SINGLE_ACTION_LIMIT_EXCEEDED",
    "requiredParams": [
      "currencyCode",
      "items"
    ],
    "optionalParams": [
      "discount",
      "shippingCost",
      "shippingAddress",
      "notes",
      "returnUrl",
      "cancelUrl",
      "explicit_human_approval",
      "user_instruction",
      "proposal_id",
      "actor_role",
      "demo_session_id"
    ],
    "sandboxAvailability": "AVAILABLE_LIVE_SANDBOX",
    "equivalentRestEndpoint": "POST /v2/checkout/orders",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/payments/orders/client_sdk_orders_api"
    ],
    "annotations": {
      "title": "PayPal MCP: Create Order",
      "readOnlyHint": false,
      "destructiveHint": false,
      "idempotentHint": false,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "required": [
        "currencyCode",
        "items"
      ],
      "properties": {
        "currencyCode": {
          "type": "string",
          "description": "Currency code of the amount.",
          "enum": [
            "USD"
          ]
        },
        "items": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "name": {
                "type": "string",
                "description": "The name of the item."
              },
              "quantity": {
                "type": "number",
                "description": "The item quantity. Must be a whole number.",
                "default": 1
              },
              "description": {
                "type": "string",
                "description": "The detailed item description."
              },
              "itemCost": {
                "type": "number",
                "description": "The cost of each item - upto 2 decimal points."
              },
              "taxPercent": {
                "type": "number",
                "description": "The tax percent for the specific item.",
                "default": 0
              },
              "itemTotal": {
                "type": "number",
                "description": "The total cost of this line item."
              }
            },
            "required": [
              "name",
              "itemCost",
              "itemTotal"
            ],
            "additionalProperties": false
          }
        },
        "discount": {
          "type": "number",
          "description": "The discount amount for the order."
        },
        "shippingCost": {
          "type": "number",
          "description": "The cost of shipping for the order."
        },
        "shippingAddress": {
          "type": "object",
          "description": "The shipping address for the order."
        },
        "notes": {
          "type": "object"
        },
        "returnUrl": {
          "type": "string"
        },
        "cancelUrl": {
          "type": "string"
        },
        "explicit_human_approval": {
          "type": "boolean",
          "description": "Must be true (or provide an authorized user_instruction / proposal_id) to execute this PayPal Sandbox write operation."
        },
        "user_instruction": {
          "type": "string",
          "description": "Optional explicit user instruction authorizing this write within the $500/$2,500 guardrails."
        },
        "proposal_id": {
          "type": "string",
          "description": "Optional session-bound proposal ID authorizing this write."
        },
        "actor_role": {
          "type": "string",
          "enum": [
            "provider",
            "patient"
          ],
          "description": "Caller role for server-side RBAC verification (default: provider)."
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session identifier."
        }
      }
    }
  },
  // 68. get_order
  {
    "name": "get_order",
    "description": "[READ_ONLY] Official PayPal MCP Tool (Orders v2 — GET /v2/checkout/orders/{id}): Retrieves the order details from PayPal for a given order ID.\n\nThis tool is used to retrieve details of an existing order in PayPal. It provides information about the order, including items, amounts, status, and other relevant details.",
    "source": "official_paypal_mcp",
    "officialPayPalEquivalent": "get_order",
    "classification": "read_only",
    "readVsWrite": "read",
    "permissions": "provider_or_customer",
    "externalAuthRequired": "paypal_merchant_oauth",
    "idempotencyRequired": false,
    "auditEvent": null,
    "errorHandling": "404 RESOURCE_NOT_FOUND",
    "requiredParams": [
      "id"
    ],
    "optionalParams": [
      "demo_session_id"
    ],
    "sandboxAvailability": "AVAILABLE_LIVE_SANDBOX",
    "equivalentRestEndpoint": "GET /v2/checkout/orders/{id}",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/payments/orders/client_sdk_orders_api"
    ],
    "annotations": {
      "title": "PayPal MCP: Get Order",
      "readOnlyHint": true,
      "destructiveHint": false,
      "idempotentHint": true,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "required": [
        "id"
      ],
      "properties": {
        "id": {
          "type": "string",
          "description": "The order id generated during create call"
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session identifier."
        }
      }
    }
  },
  // 69. pay_order
  {
    "name": "pay_order",
    "description": "[CONFIRMED_WRITE] Official PayPal MCP Tool (Orders v2 — POST /v2/checkout/orders/{id}/capture): Capture a payment for an order.\n\nThis tool is used to capture a payment for an order. It allows you to capture funds that have been authorized for a specific order but not yet captured.",
    "source": "official_paypal_mcp",
    "officialPayPalEquivalent": "pay_order",
    "classification": "confirmed_demo_write",
    "readVsWrite": "write",
    "permissions": "provider_or_customer",
    "externalAuthRequired": "paypal_buyer_checkout_approval",
    "idempotencyRequired": true,
    "auditEvent": "paypal_mcp_pay_order",
    "errorHandling": "422 ORDER_NOT_APPROVED (when buyer has not approved order); 404 RESOURCE_NOT_FOUND; 403 AUTHORIZATION_REQUIRED",
    "requiredParams": [
      "id"
    ],
    "optionalParams": [
      "explicit_human_approval",
      "user_instruction",
      "proposal_id",
      "actor_role",
      "demo_session_id"
    ],
    "sandboxAvailability": "AVAILABLE_LIVE_SANDBOX",
    "equivalentRestEndpoint": "POST /v2/checkout/orders/{id}/capture",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/payments/payment/authcapture"
    ],
    "annotations": {
      "title": "PayPal MCP: Pay Order",
      "readOnlyHint": false,
      "destructiveHint": false,
      "idempotentHint": false,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "required": [
        "id"
      ],
      "properties": {
        "id": {
          "type": "string",
          "description": "The order id generated during create call"
        },
        "explicit_human_approval": {
          "type": "boolean",
          "description": "Must be true (or provide an authorized user_instruction / proposal_id) to execute this PayPal Sandbox write operation."
        },
        "user_instruction": {
          "type": "string",
          "description": "Optional explicit user instruction authorizing this write within the $500/$2,500 guardrails."
        },
        "proposal_id": {
          "type": "string",
          "description": "Optional session-bound proposal ID authorizing this write."
        },
        "actor_role": {
          "type": "string",
          "enum": [
            "provider",
            "patient"
          ],
          "description": "Caller role for server-side RBAC verification (default: provider)."
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session identifier."
        }
      }
    }
  },
  // 70. list_disputes
  {
    "name": "list_disputes",
    "description": "[READ_ONLY] Official PayPal MCP Tool (Customer Disputes v1 — GET /v1/customer/disputes): List disputes from PayPal.\n\nThis function retrieves a list of disputes with optional pagination and filtering parameters.",
    "source": "official_paypal_mcp",
    "officialPayPalEquivalent": "list_disputes",
    "classification": "read_only",
    "readVsWrite": "read",
    "permissions": "provider_only",
    "externalAuthRequired": "paypal_merchant_oauth",
    "idempotencyRequired": false,
    "auditEvent": null,
    "errorHandling": "400 INVALID_PARAMETER_VALUE",
    "requiredParams": [],
    "optionalParams": [
      "disputed_transaction_id",
      "dispute_state",
      "page_size",
      "page",
      "demo_session_id"
    ],
    "sandboxAvailability": "AVAILABLE_LIVE_SANDBOX",
    "equivalentRestEndpoint": "GET /v1/customer/disputes",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/disputes/read-seller"
    ],
    "annotations": {
      "title": "PayPal MCP: List Disputes",
      "readOnlyHint": true,
      "destructiveHint": false,
      "idempotentHint": true,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "properties": {
        "disputed_transaction_id": {
          "type": "object"
        },
        "dispute_state": {
          "type": "string",
          "description": "OPEN_INQUIRIES",
          "enum": [
            "REQUIRED_ACTION",
            "REQUIRED_OTHER_PARTY_ACTION",
            "UNDER_PAYPAL_REVIEW",
            "RESOLVED",
            "OPEN_INQUIRIES",
            "APPEALABLE"
          ]
        },
        "page_size": {
          "type": "number"
        },
        "page": {
          "type": "number"
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session identifier."
        }
      }
    }
  },
  // 71. get_dispute
  {
    "name": "get_dispute",
    "description": "[READ_ONLY] Official PayPal MCP Tool (Customer Disputes v1 — GET /v1/customer/disputes/{dispute_id}): Get details for a specific dispute from PayPal.\n\nThis tool is used to lists disputes with a summary set of details, which shows the dispute_id, reason, status, dispute_state, dispute_life_cycle_stage, dispute_channel, dispute_amount, create_time and update_time fields.",
    "source": "official_paypal_mcp",
    "officialPayPalEquivalent": "get_dispute",
    "classification": "read_only",
    "readVsWrite": "read",
    "permissions": "provider_only",
    "externalAuthRequired": "paypal_merchant_oauth",
    "idempotencyRequired": false,
    "auditEvent": null,
    "errorHandling": "404 RESOURCE_NOT_FOUND",
    "requiredParams": [
      "dispute_id"
    ],
    "optionalParams": [
      "demo_session_id"
    ],
    "sandboxAvailability": "AVAILABLE_LIVE_SANDBOX",
    "equivalentRestEndpoint": "GET /v1/customer/disputes/{dispute_id}",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/disputes/read-seller"
    ],
    "annotations": {
      "title": "PayPal MCP: Get Dispute",
      "readOnlyHint": true,
      "destructiveHint": false,
      "idempotentHint": true,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "required": [
        "dispute_id"
      ],
      "properties": {
        "dispute_id": {
          "type": "string",
          "description": "The order id generated during create call"
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session identifier."
        }
      }
    }
  },
  // 72. accept_dispute_claim
  {
    "name": "accept_dispute_claim",
    "description": "[CONFIRMED_WRITE] Official PayPal MCP Tool (Customer Disputes v1 — POST /v1/customer/disputes/{dispute_id}/accept-claim): Accept liability for a dispute claim.\n\nThis tool is used to accept liability for a dispute claim. When you accept liability for a dispute claim, the dispute closes in the customer's favor and PayPal automatically refunds money to the customer from the merchant's account.",
    "source": "official_paypal_mcp",
    "officialPayPalEquivalent": "accept_dispute_claim",
    "classification": "confirmed_demo_write",
    "readVsWrite": "write",
    "permissions": "provider_only",
    "externalAuthRequired": "paypal_merchant_oauth",
    "idempotencyRequired": true,
    "auditEvent": "paypal_mcp_accept_dispute_claim",
    "errorHandling": "404 RESOURCE_NOT_FOUND; 403 AUTHORIZATION_REQUIRED",
    "requiredParams": [
      "dispute_id",
      "note"
    ],
    "optionalParams": [
      "explicit_human_approval",
      "user_instruction",
      "proposal_id",
      "actor_role",
      "demo_session_id"
    ],
    "sandboxAvailability": "AVAILABLE_LIVE_SANDBOX",
    "equivalentRestEndpoint": "POST /v1/customer/disputes/{dispute_id}/accept-claim",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/disputes/update-seller"
    ],
    "annotations": {
      "title": "PayPal MCP: Accept Dispute Claim",
      "readOnlyHint": false,
      "destructiveHint": false,
      "idempotentHint": false,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "required": [
        "dispute_id",
        "note"
      ],
      "properties": {
        "dispute_id": {
          "type": "string"
        },
        "note": {
          "type": "string",
          "description": "A note about why the seller is accepting the claim"
        },
        "explicit_human_approval": {
          "type": "boolean",
          "description": "Must be true (or provide an authorized user_instruction / proposal_id) to execute this PayPal Sandbox write operation."
        },
        "user_instruction": {
          "type": "string",
          "description": "Optional explicit user instruction authorizing this write within the $500/$2,500 guardrails."
        },
        "proposal_id": {
          "type": "string",
          "description": "Optional session-bound proposal ID authorizing this write."
        },
        "actor_role": {
          "type": "string",
          "enum": [
            "provider",
            "patient"
          ],
          "description": "Caller role for server-side RBAC verification (default: provider)."
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session identifier."
        }
      }
    }
  },
  // 73. list_transactions
  {
    "name": "list_transactions",
    "description": "[READ_ONLY] Official PayPal MCP Tool (Transaction Search v1 — GET /v1/reporting/transactions): List transactions from PayPal.\n\nThis tool is used to list transactions with optional filtering parameters within a date range of 31 days. This tool can also be used to list details of a transaction given the transaction ID.\n\n- The start_date and end_date should be specified in ISO8601 date and time format. Example dates: 1996-12-19T16:39:57-08:00, 1985-04-12T23:20:50.52Z, 1990-12-31T23:59:60Z\n- The transaction_status accepts the following 4 values:\n    1. \"D\" - represents denied transactions.\n    2. \"P\" - represents pending transactions.\n    3. \"S\" - represents successful transactions.\n    4. \"V\" - represents transactions that were reversed.\n- The transaction_id is the unique identifier for the transaction.",
    "source": "official_paypal_mcp",
    "officialPayPalEquivalent": "list_transactions",
    "classification": "read_only",
    "readVsWrite": "read",
    "permissions": "provider_only",
    "externalAuthRequired": "paypal_merchant_oauth",
    "idempotencyRequired": false,
    "auditEvent": null,
    "errorHandling": "403 NOT_AUTHORIZED (when reporting/search/read scope is not granted on Default Application)",
    "requiredParams": [],
    "optionalParams": [
      "transaction_id",
      "transaction_status",
      "start_date",
      "end_date",
      "search_months",
      "page_size",
      "page",
      "demo_session_id"
    ],
    "sandboxAvailability": "BLOCKED_OAUTH_SCOPE",
    "equivalentRestEndpoint": "GET /v1/reporting/transactions",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/reporting/search/read"
    ],
    "annotations": {
      "title": "PayPal MCP: List Transactions",
      "readOnlyHint": true,
      "destructiveHint": false,
      "idempotentHint": true,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "properties": {
        "transaction_id": {
          "type": "object",
          "description": "The ID of the transaction to retrieve."
        },
        "transaction_status": {
          "type": "string",
          "enum": [
            "D",
            "P",
            "S",
            "V"
          ]
        },
        "start_date": {
          "type": "string",
          "description": "Filters the transactions in the response by a start date and time, in ISO8601 date and time format. Seconds are required. Fractional seconds are optional."
        },
        "end_date": {
          "type": "string",
          "description": "Filters the transactions in the response by an end date and time, in ISO8601 date and time format. Seconds are required. Fractional seconds are optional. The maximum supported range is 31 days."
        },
        "search_months": {
          "type": "number",
          "description": "Number of months to search back for a transaction by ID. Default is 12 months."
        },
        "page_size": {
          "type": "number"
        },
        "page": {
          "type": "number"
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session identifier."
        }
      }
    }
  },
  // 74. create_refund
  {
    "name": "create_refund",
    "description": "[CONFIRMED_WRITE] Official PayPal MCP Tool (Payments v2 (Captures/Refunds) — POST /v2/payments/captures/{capture_id}/refund): Initiate a refund for a PayPal payment capture.\nIf you have an order ID instead of a capture ID, first use the get order tool to obtain the capture ID from the order details.\nThis function allows you to return funds to a customer by refunding a previously captured payment. You can issue a full refund or specify a partial amount. If multiple captures exist for an order, request clarification on which specific capture to refund.\nRequired parameters:\n- Capture ID: The ID of the capture to refund\n- Amount (optional): For partial refunds, specify the amount to refund (must be less than or equal to the captured amount)\n- Note to Payer (optional): Additional explanation visible to the customer\nResponse details include:\n- Refund ID and status\n- Refunded amount and currency",
    "source": "official_paypal_mcp",
    "officialPayPalEquivalent": "create_refund",
    "classification": "confirmed_demo_write",
    "readVsWrite": "write",
    "permissions": "provider_only",
    "externalAuthRequired": "paypal_merchant_oauth",
    "idempotencyRequired": true,
    "auditEvent": "paypal_mcp_create_refund",
    "errorHandling": "404 RESOURCE_NOT_FOUND; 422 CAPTURE_FULLY_REFUNDED; 403 AUTHORIZATION_REQUIRED; 422 GUARDRAIL_SINGLE_ACTION_LIMIT_EXCEEDED",
    "requiredParams": [
      "capture_id"
    ],
    "optionalParams": [
      "amount",
      "invoice_id",
      "note_to_payer",
      "explicit_human_approval",
      "user_instruction",
      "proposal_id",
      "actor_role",
      "demo_session_id"
    ],
    "sandboxAvailability": "AVAILABLE_LIVE_SANDBOX",
    "equivalentRestEndpoint": "POST /v2/payments/captures/{capture_id}/refund",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/payments/refund"
    ],
    "annotations": {
      "title": "PayPal MCP: Create Refund",
      "readOnlyHint": false,
      "destructiveHint": false,
      "idempotentHint": false,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "required": [
        "capture_id"
      ],
      "properties": {
        "capture_id": {
          "type": "string",
          "description": "The ID of the capture to refund."
        },
        "amount": {
          "type": "object",
          "description": "The amount to refund. If not specified, the full captured amount is refunded.",
          "properties": {
            "currency_code": {
              "type": "string"
            },
            "value": {
              "type": "string"
            }
          }
        },
        "invoice_id": {
          "type": "string",
          "description": "The invoice ID that is used to track this payment."
        },
        "note_to_payer": {
          "type": "string",
          "description": "A note to the payer."
        },
        "explicit_human_approval": {
          "type": "boolean",
          "description": "Must be true (or provide an authorized user_instruction / proposal_id) to execute this PayPal Sandbox write operation."
        },
        "user_instruction": {
          "type": "string",
          "description": "Optional explicit user instruction authorizing this write within the $500/$2,500 guardrails."
        },
        "proposal_id": {
          "type": "string",
          "description": "Optional session-bound proposal ID authorizing this write."
        },
        "actor_role": {
          "type": "string",
          "enum": [
            "provider",
            "patient"
          ],
          "description": "Caller role for server-side RBAC verification (default: provider)."
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session identifier."
        }
      }
    }
  },
  // 75. get_refund
  {
    "name": "get_refund",
    "description": "[READ_ONLY] Official PayPal MCP Tool (Payments v2 (Captures/Refunds) — GET /v2/payments/refunds/{refund_id}): Retrieve detailed information about a PayPal payment refund.\nIf you have an order ID instead of a refund ID, first use the get order tool to obtain the refund ID from the order details. \nThis function returns comprehensive details about a refund, including its current status (completed, pending, cancelled), refunded amount, and processing information.\nWhen multiple refunds exist for an order or capture, request clarification on which specific refund to retrieve. \nResponse details include:\n- Refund status and ID\n- Refunded amount and currency\n- Reason for refund (if provided)\n- Source transaction details",
    "source": "official_paypal_mcp",
    "officialPayPalEquivalent": "get_refund",
    "classification": "read_only",
    "readVsWrite": "read",
    "permissions": "provider_or_customer",
    "externalAuthRequired": "paypal_merchant_oauth",
    "idempotencyRequired": false,
    "auditEvent": null,
    "errorHandling": "404 RESOURCE_NOT_FOUND",
    "requiredParams": [
      "refund_id"
    ],
    "optionalParams": [
      "demo_session_id"
    ],
    "sandboxAvailability": "AVAILABLE_LIVE_SANDBOX",
    "equivalentRestEndpoint": "GET /v2/payments/refunds/{refund_id}",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/payments/refund"
    ],
    "annotations": {
      "title": "PayPal MCP: Get Refund",
      "readOnlyHint": true,
      "destructiveHint": false,
      "idempotentHint": true,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "required": [
        "refund_id"
      ],
      "properties": {
        "refund_id": {
          "type": "string",
          "description": "The ID of the refund to get details for."
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session identifier."
        }
      }
    }
  },
  // 76. get_merchant_insights
  {
    "name": "get_merchant_insights",
    "description": "[READ_ONLY] Official PayPal MCP Tool (Merchant Insights v1 — GET /v1/merchant/insights): Retrieve business intelligence metrics and analytics for a merchant, filtered by start date, end date, insight type, and time interval.\n\nThis tool returns actionable insights into orders and sales data, supporting data-driven business decisions.",
    "source": "official_paypal_mcp",
    "officialPayPalEquivalent": "get_merchant_insights",
    "classification": "read_only",
    "readVsWrite": "read",
    "permissions": "provider_only",
    "externalAuthRequired": "paypal_merchant_oauth",
    "idempotencyRequired": false,
    "auditEvent": null,
    "errorHandling": "UNSUPPORTED_BY_SANDBOX: get_merchant_insights is not supported in sandbox mode (@paypal/agent-toolkit explicit guard & HTTP 403 on api-m.sandbox.paypal.com)",
    "requiredParams": [
      "start_date",
      "end_date",
      "insight_type",
      "time_interval"
    ],
    "optionalParams": [
      "demo_session_id"
    ],
    "sandboxAvailability": "UNSUPPORTED_BY_SANDBOX",
    "equivalentRestEndpoint": "GET /v1/merchant/insights",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/merchant/insights"
    ],
    "annotations": {
      "title": "PayPal MCP: Get Merchant Insights",
      "readOnlyHint": true,
      "destructiveHint": false,
      "idempotentHint": true,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "required": [
        "start_date",
        "end_date",
        "insight_type",
        "time_interval"
      ],
      "properties": {
        "start_date": {
          "type": "string",
          "description": "The start date range to filter insights"
        },
        "end_date": {
          "type": "string",
          "description": "The end date range to filter insights"
        },
        "insight_type": {
          "type": "string",
          "description": "The type of insight to retrieve. It can be \"ORDERS\" or \"SALES\""
        },
        "time_interval": {
          "type": "string",
          "description": "The time periods used for segmenting metrics data. It can be \"DAILY\", \"WEEKLY\", \"MONTHLY\", \"QUARTERLY\", or \"YEARLY\""
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session identifier."
        }
      }
    }
  },
  // 77. update_plan
  {
    "name": "update_plan",
    "description": "[CONFIRMED_WRITE] PayPal Sandbox REST-to-MCP Adapter (Subscriptions v1 — PATCH /v1/billing/plans/{plan_id}): Update an existing PayPal billing plan description, payment_preferences, or taxes using JSON Patch operations.",
    "source": "paypal_rest_adapter",
    "officialPayPalEquivalent": "update_plan",
    "classification": "confirmed_demo_write",
    "readVsWrite": "write",
    "permissions": "provider_only",
    "externalAuthRequired": "paypal_merchant_oauth",
    "idempotencyRequired": true,
    "auditEvent": "paypal_rest_update_plan",
    "errorHandling": "Returns 404 RESOURCE_NOT_FOUND for unknown plan_id; enforces explicit_human_approval.",
    "requiredParams": [
      "plan_id"
    ],
    "optionalParams": [
      "description",
      "auto_bill_outstanding",
      "payment_failure_threshold",
      "operations",
      "explicit_human_approval",
      "user_instruction",
      "actor_role",
      "demo_session_id"
    ],
    "sandboxAvailability": "AVAILABLE_LIVE_SANDBOX",
    "equivalentRestEndpoint": "PATCH /v1/billing/plans/{plan_id}",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/subscriptions"
    ],
    "annotations": {
      "title": "PayPal REST: Update Subscription Plan",
      "readOnlyHint": false,
      "destructiveHint": false,
      "idempotentHint": true,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "required": [
        "plan_id"
      ],
      "properties": {
        "plan_id": {
          "type": "string",
          "description": "PayPal Subscription Plan ID (e.g., P-...)."
        },
        "description": {
          "type": "string",
          "description": "Updated plan description."
        },
        "auto_bill_outstanding": {
          "type": "boolean",
          "description": "Whether to auto-bill outstanding balances."
        },
        "payment_failure_threshold": {
          "type": "integer",
          "description": "Payment failure threshold count."
        },
        "operations": {
          "type": "array",
          "description": "Optional explicit JSON Patch operations array."
        },
        "explicit_human_approval": {
          "type": "boolean",
          "description": "Must be true to authorize plan update."
        },
        "user_instruction": {
          "type": "string",
          "description": "Optional explicit user instruction."
        },
        "actor_role": {
          "type": "string",
          "enum": [
            "provider",
            "patient"
          ],
          "description": "Caller role."
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session ID."
        }
      }
    }
  },
  // 78. paypal_authorize_order
  {
    "name": "paypal_authorize_order",
    "description": "[CONFIRMED_WRITE] PayPal Sandbox REST-to-MCP Adapter (Orders v2 — POST /v2/checkout/orders/{id}/authorize): Authorize payment for an approved PayPal Checkout order with AUTHORIZE intent.",
    "source": "paypal_rest_adapter",
    "officialPayPalEquivalent": null,
    "classification": "confirmed_demo_write",
    "readVsWrite": "write",
    "permissions": "provider_or_customer",
    "externalAuthRequired": "paypal_buyer_checkout_approval",
    "idempotencyRequired": true,
    "auditEvent": "paypal_rest_authorize_order",
    "errorHandling": "Returns 422 ORDER_NOT_APPROVED if buyer has not approved order; enforces explicit_human_approval.",
    "requiredParams": [
      "order_id"
    ],
    "optionalParams": [
      "explicit_human_approval",
      "user_instruction",
      "actor_role",
      "demo_session_id"
    ],
    "sandboxAvailability": "AVAILABLE_LIVE_SANDBOX",
    "equivalentRestEndpoint": "POST /v2/checkout/orders/{id}/authorize",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/payments/payment/authcapture"
    ],
    "annotations": {
      "title": "PayPal REST: Authorize Checkout Order",
      "readOnlyHint": false,
      "destructiveHint": false,
      "idempotentHint": true,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "required": [
        "order_id"
      ],
      "properties": {
        "order_id": {
          "type": "string",
          "description": "PayPal Orders v2 ID to authorize."
        },
        "explicit_human_approval": {
          "type": "boolean",
          "description": "Must be true to authorize order execution."
        },
        "user_instruction": {
          "type": "string",
          "description": "Optional explicit user instruction."
        },
        "actor_role": {
          "type": "string",
          "enum": [
            "provider",
            "patient"
          ],
          "description": "Caller role."
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session ID."
        }
      }
    }
  },
  // 79. paypal_list_webhooks
  {
    "name": "paypal_list_webhooks",
    "description": "[READ_ONLY] PayPal Sandbox REST-to-MCP Adapter (Webhooks v1 — GET /v1/notifications/webhooks): List all configured PayPal Sandbox webhook listeners and subscribed event types for the merchant app.",
    "source": "paypal_rest_adapter",
    "officialPayPalEquivalent": null,
    "classification": "read_only",
    "readVsWrite": "read",
    "permissions": "provider_only",
    "externalAuthRequired": "paypal_merchant_oauth",
    "idempotencyRequired": false,
    "auditEvent": null,
    "errorHandling": "Returns webhooks array from /v1/notifications/webhooks.",
    "requiredParams": [],
    "optionalParams": [
      "anchor_type",
      "demo_session_id"
    ],
    "sandboxAvailability": "AVAILABLE_LIVE_SANDBOX",
    "equivalentRestEndpoint": "GET /v1/notifications/webhooks",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/applications/webhooks"
    ],
    "annotations": {
      "title": "PayPal REST: List Webhooks",
      "readOnlyHint": true,
      "destructiveHint": false,
      "idempotentHint": true,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "properties": {
        "anchor_type": {
          "type": "string",
          "enum": [
            "APPLICATION",
            "ACCOUNT"
          ],
          "description": "Optional webhook anchor filter (default: APPLICATION)."
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session ID."
        }
      }
    }
  },
  // 80. paypal_list_webhook_event_types
  {
    "name": "paypal_list_webhook_event_types",
    "description": "[READ_ONLY] PayPal Sandbox REST-to-MCP Adapter (Webhooks v1 — GET /v1/notifications/webhooks-event-types): List all available PayPal webhook event type definitions supported by PayPal Sandbox.",
    "source": "paypal_rest_adapter",
    "officialPayPalEquivalent": null,
    "classification": "read_only",
    "readVsWrite": "read",
    "permissions": "provider_only",
    "externalAuthRequired": "paypal_merchant_oauth",
    "idempotencyRequired": false,
    "auditEvent": null,
    "errorHandling": "Returns event_types catalog from /v1/notifications/webhooks-event-types.",
    "requiredParams": [],
    "optionalParams": [
      "domain_filter",
      "demo_session_id"
    ],
    "sandboxAvailability": "AVAILABLE_LIVE_SANDBOX",
    "equivalentRestEndpoint": "GET /v1/notifications/webhooks-event-types",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/applications/webhooks"
    ],
    "annotations": {
      "title": "PayPal REST: List Webhook Event Types",
      "readOnlyHint": true,
      "destructiveHint": false,
      "idempotentHint": true,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "properties": {
        "domain_filter": {
          "type": "string",
          "description": "Optional prefix filter such as PAYMENT, INVOICING, BILLING, or CUSTOMER."
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session ID."
        }
      }
    }
  },
  // 81. paypal_list_invoice_templates
  {
    "name": "paypal_list_invoice_templates",
    "description": "[READ_ONLY] PayPal Sandbox REST-to-MCP Adapter (Invoicing v2 — GET /v2/invoicing/templates): List merchant invoice templates, saved addresses, and configuration defaults from PayPal Sandbox.",
    "source": "paypal_rest_adapter",
    "officialPayPalEquivalent": null,
    "classification": "read_only",
    "readVsWrite": "read",
    "permissions": "provider_only",
    "externalAuthRequired": "paypal_merchant_oauth",
    "idempotencyRequired": false,
    "auditEvent": null,
    "errorHandling": "Returns templates, addresses, and phones from /v2/invoicing/templates.",
    "requiredParams": [],
    "optionalParams": [
      "fields",
      "page",
      "page_size",
      "demo_session_id"
    ],
    "sandboxAvailability": "AVAILABLE_LIVE_SANDBOX",
    "equivalentRestEndpoint": "GET /v2/invoicing/templates",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/invoicing"
    ],
    "annotations": {
      "title": "PayPal REST: List Invoice Templates",
      "readOnlyHint": true,
      "destructiveHint": false,
      "idempotentHint": true,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "properties": {
        "fields": {
          "type": "string",
          "description": "Fields to return (default: all)."
        },
        "page": {
          "type": "integer",
          "description": "Page number (default: 1)."
        },
        "page_size": {
          "type": "integer",
          "description": "Page size (default: 10)."
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session ID."
        }
      }
    }
  },
  // 82. paypal_create_vault_setup_token
  {
    "name": "paypal_create_vault_setup_token",
    "description": "[CONFIRMED_WRITE] PayPal Sandbox REST-to-MCP Adapter (Payment Method Tokens v3 — POST /v3/vault/setup-tokens): Create a PayPal Sandbox Vault setup token for vaulting a customer PayPal wallet or card payment method.",
    "source": "paypal_rest_adapter",
    "officialPayPalEquivalent": null,
    "classification": "confirmed_demo_write",
    "readVsWrite": "write",
    "permissions": "provider_or_customer",
    "externalAuthRequired": "paypal_merchant_oauth",
    "idempotencyRequired": true,
    "auditEvent": "paypal_rest_create_vault_setup_token",
    "errorHandling": "Enforces explicit_human_approval and returns 201 setup token with approval links.",
    "requiredParams": [],
    "optionalParams": [
      "payment_source_type",
      "customer_id",
      "return_url",
      "cancel_url",
      "explicit_human_approval",
      "user_instruction",
      "actor_role",
      "demo_session_id"
    ],
    "sandboxAvailability": "AVAILABLE_LIVE_SANDBOX",
    "equivalentRestEndpoint": "POST /v3/vault/setup-tokens",
    "requiredOAuthScopes": [
      "https://uri.paypal.com/services/vault/payment-tokens/readwrite"
    ],
    "annotations": {
      "title": "PayPal REST: Create Vault Setup Token",
      "readOnlyHint": false,
      "destructiveHint": false,
      "idempotentHint": false,
      "openWorldHint": true
    },
    "inputSchema": {
      "type": "object",
      "properties": {
        "payment_source_type": {
          "type": "string",
          "enum": [
            "paypal",
            "card"
          ],
          "description": "Payment method type to setup in PayPal Vault (default: paypal)."
        },
        "customer_id": {
          "type": "string",
          "description": "Optional merchant customer identifier."
        },
        "return_url": {
          "type": "string",
          "description": "Return URL after buyer approval (default: https://paypal-ai-billing-kit.vercel.app/billing?vault=approved)."
        },
        "cancel_url": {
          "type": "string",
          "description": "Cancel URL (default: https://paypal-ai-billing-kit.vercel.app/billing?vault=cancelled)."
        },
        "explicit_human_approval": {
          "type": "boolean",
          "description": "Must be true to authorize vault setup token creation."
        },
        "user_instruction": {
          "type": "string",
          "description": "Optional explicit user instruction."
        },
        "actor_role": {
          "type": "string",
          "enum": [
            "provider",
            "patient"
          ],
          "description": "Caller role."
        },
        "demo_session_id": {
          "type": "string",
          "description": "Optional isolated demo session ID."
        }
      }
    }
  },
] as const;

export const UNIFIED_MCP_REGISTRY_SUMMARY = {
  baselineTools: 30,
  officialPayPalMcpCatalogCount: 46,
  totalTools: UNIFIED_MCP_TOOL_REGISTRY.length,
  nativeApplicationToolsCount: UNIFIED_MCP_TOOL_REGISTRY.filter(
    (t) => t.source === 'native_application'
  ).length,
  officialPayPalMcpToolsCount: UNIFIED_MCP_TOOL_REGISTRY.filter(
    (t) => t.source === 'official_paypal_mcp'
  ).length,
  paypalRestAdapterToolsCount: UNIFIED_MCP_TOOL_REGISTRY.filter(
    (t) => t.source === 'paypal_rest_adapter'
  ).length,
  readOnlyToolsCount: UNIFIED_MCP_TOOL_REGISTRY.filter(
    (t) => t.classification === 'read_only'
  ).length,
  proposalOnlyToolsCount: UNIFIED_MCP_TOOL_REGISTRY.filter(
    (t) => t.classification === 'proposal_only'
  ).length,
  confirmedWriteToolsCount: UNIFIED_MCP_TOOL_REGISTRY.filter(
    (t) => t.classification === 'confirmed_demo_write'
  ).length,
  byTier: {
    read_only: UNIFIED_MCP_TOOL_REGISTRY.filter((t) => t.classification === 'read_only').length,
    proposal_only: UNIFIED_MCP_TOOL_REGISTRY.filter((t) => t.classification === 'proposal_only').length,
    confirmed_write: UNIFIED_MCP_TOOL_REGISTRY.filter((t) => t.classification === 'confirmed_demo_write').length,
  },
  bySource: {
    native_app: UNIFIED_MCP_TOOL_REGISTRY.filter((t) => t.source === 'native_application').length,
    official_paypal_mcp: UNIFIED_MCP_TOOL_REGISTRY.filter((t) => t.source === 'official_paypal_mcp').length,
    paypal_rest_adapter: UNIFIED_MCP_TOOL_REGISTRY.filter((t) => t.source === 'paypal_rest_adapter').length,
  },
};

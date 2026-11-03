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
      type: string;
      description?: string;
      enum?: string[];
    }
  >;
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
      '[READ_ONLY] Discover the Unified MCP Gateway catalog (30 tools across Native Application (21), Official PayPal MCP Discovery (1), and PayPal Sandbox REST-Backed Adapters (8)), $500/$2,500 guardrails, demo personas, and ADMIN-* service codes.',
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
] as const;

export const UNIFIED_MCP_REGISTRY_SUMMARY = {
  baselineTools: 26,
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

export type UnifiedMcpToolSource =
  | 'native_application'
  | 'official_paypal_mcp'
  | 'paypal_rest_adapter';

export type UnifiedMcpToolClassification =
  | 'read_only'
  | 'proposal_only'
  | 'confirmed_demo_write';

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
}

export const UNIFIED_MCP_TOOL_REGISTRY: readonly UnifiedMcpToolMetadata[] = [
  // ============================================================================
  // NATIVE APPLICATION READ-ONLY TOOLS (10 Original Preserved)
  // ============================================================================
  {
    name: 'discover_billing_capabilities',
    description:
      '[READ_ONLY] Discover the Unified MCP Gateway catalog (26 tools across Native Application, Official PayPal MCP Discovery, and PayPal Sandbox REST-Backed Adapters), $500/$2,500 guardrails, demo personas, and ADMIN-* service codes.',
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
  },
  {
    name: 'list_demo_customers',
    description:
      '[READ_ONLY] List the Provider (Merchant) account (Dr. Sarah Jenkins) and linked Customer (Buyer) accounts (Alex Rivera, Jordan Taylor).',
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
  },
  {
    name: 'search_invoices',
    description:
      '[READ_ONLY] Search and filter billing statements by status (all, sent, overdue, paid, draft, void, refunded), customer name, or free-text query within an isolated demo session.',
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
    optionalParams: ['query', 'status', 'customer_name', 'demo_session_id'],
  },
  {
    name: 'get_invoice_details',
    description:
      '[READ_ONLY] Retrieve full line items, service dates, payment attempts (including INSTRUMENT_DECLINED failure diagnostics), and plain-English explanation for a specific invoice.',
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
  },
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
  },
  {
    name: 'get_transaction_history',
    description:
      '[READ_ONLY] Retrieve settlement captures, refunds, and declined payment attempts with explicit verification provenance (paypal_sandbox_verified vs sample_demo_settlement_not_live_paypal).',
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
  },
  {
    name: 'get_payment_receipt',
    description:
      '[READ_ONLY] Retrieve a structured payment receipt AND downloadable PDF 1.4 receipt (pdf_download_url & pdf_base64) for a paid or refunded statement, including verified PayPal Capture ID and provenance.',
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
  },
  {
    name: 'get_financial_audit_history',
    description:
      '[READ_ONLY] Read the immutable, append-only financial audit trail (billing_audit_events).',
    source: 'native_application',
    officialPayPalEquivalent: null,
    classification: 'read_only',
    readVsWrite: 'read',
    permissions: 'provider_or_customer',
    externalAuthRequired: 'none',
    idempotencyRequired: false,
    auditEvent: null,
    errorHandling: 'Returns latest audit events up to requested limit (max 50).',
    requiredParams: [],
    optionalParams: ['limit', 'demo_session_id'],
  },
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
  },
  {
    name: 'get_business_metrics',
    description:
      '[READ_ONLY] Calculate Provider practice and Customer KPI metrics (total outstanding, overdue, paid, refunded, collection rate).',
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
  },

  // ============================================================================
  // NATIVE APPLICATION PROPOSAL TOOLS (3 Original Preserved)
  // ============================================================================
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
    optionalParams: ['due_date', 'demo_session_id'],
  },
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
  },
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
    errorHandling: 'Returns 409 REFUND_NOT_PERMITTED_FOR_STATUS if invoice is not paid.',
    requiredParams: ['invoice_number'],
    optionalParams: ['invoice_id', 'refund_amount_minor', 'reason', 'demo_session_id'],
  },

  // ============================================================================
  // NATIVE APPLICATION CONFIRMED WRITE & CONVERSATIONAL EXECUTION TOOLS (7 Tools)
  // ============================================================================
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
    requiredParams: ['explicit_human_approval'],
    optionalParams: [
      'proposal_id',
      'user_instruction',
      'actor_role',
      'customer_name',
      'service_code',
      'amount_minor',
      'due_date',
      'demo_session_id',
    ],
  },
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
    requiredParams: ['explicit_human_approval'],
    optionalParams: [
      'proposal_id',
      'user_instruction',
      'actor_role',
      'invoice_number',
      'invoice_id',
      'demo_session_id',
    ],
  },
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
      'Returns 400 ORDER_ID_REQUIRED_OR_DEMO_FALLBACK if order_id is omitted without fallback flag.',
    requiredParams: ['invoice_number', 'explicit_human_approval'],
    optionalParams: [
      'invoice_id',
      'order_id',
      'allow_demo_settlement_fallback',
      'demo_session_id',
    ],
  },
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
    requiredParams: ['explicit_human_approval'],
    optionalParams: [
      'proposal_id',
      'user_instruction',
      'actor_role',
      'invoice_number',
      'invoice_id',
      'amount_minor',
      'demo_session_id',
    ],
  },
  {
    name: 'void_unpaid_invoice',
    description:
      '[CONFIRMED_WRITE] Void an unpaid Draft, Sent, or Overdue statement in the isolated demo session (blocked on paid/refunded invoices).',
    source: 'native_application',
    officialPayPalEquivalent: 'cancel_sent_invoice',
    classification: 'confirmed_demo_write',
    readVsWrite: 'write',
    permissions: 'provider_only',
    externalAuthRequired: 'none',
    idempotencyRequired: true,
    auditEvent: 'maas_invoice_voided_in_session',
    errorHandling: 'Returns 409 PAYMENT_STATE_PROTECTION_PAID_INVOICE on paid statements.',
    requiredParams: ['invoice_number', 'explicit_human_approval'],
    optionalParams: ['invoice_id', 'reason', 'user_instruction', 'actor_role', 'demo_session_id'],
  },
  {
    name: 'reset_demo_session',
    description:
      '[CONFIRMED_WRITE] Reset an isolated demo_session_id, restoring the 6 canonical seed statements (#PPB-INV-2026-1001 through #PPB-INV-2026-1006).',
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
  },
  {
    name: 'execute_conversational_instruction',
    description:
      '[CONFIRMED_WRITE] Context-aware Conversational Authorization router: evaluates a natural-language user instruction ("Create an invoice for Alex for $150.", "Void invoice 1004.", "Refund the $50 payment.", "Pay invoice 1002.", "Yes, go ahead.", "Can you pay invoice 1002?", "What would happen if I refunded it?") and automatically executes explicit commands within role/guardrail limits while explaining capability or hypothetical questions without mutating state.',
    source: 'native_application',
    officialPayPalEquivalent: null,
    classification: 'confirmed_demo_write',
    readVsWrite: 'write',
    permissions: 'provider_or_customer',
    externalAuthRequired: 'none',
    idempotencyRequired: true,
    auditEvent: 'conversational_instruction_evaluated',
    errorHandling:
      'Distinguishes explicit commands from capability questions, hypotheticals, and ambiguous requests.',
    requiredParams: ['instruction'],
    optionalParams: ['actor_role', 'prior_execution_intent', 'demo_session_id'],
  },

  // ============================================================================
  // OFFICIAL PAYPAL MCP DISCOVERY & UPSTREAM BRIDGE (1 Tool)
  // ============================================================================
  {
    name: 'paypal_discover_official_mcp',
    description:
      '[OFFICIAL_PAYPAL_MCP] Connect server-side to PayPal’s official Sandbox MCP server (https://mcp.sandbox.paypal.com/sse and /.well-known/oauth-authorization-server, plus probe /http) using the merchant Sandbox OAuth token, returning live serverInfo (PayPal MCP Agent v1.0.0), upstream tool catalog (46 tools), and transport status.',
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
  },

  // ============================================================================
  // PAYPAL SANDBOX REST-BACKED OFFICIAL TOOL ADAPTERS (5 Tools)
  // ============================================================================
  {
    name: 'paypal_get_order',
    description:
      '[PAYPAL_REST_ADAPTER] Official PayPal get_order capability: retrieve live order details directly from PayPal Sandbox Orders v2 API (GET /v2/checkout/orders/{id}), returning order status, intent, payer, purchase units, and capture IDs.',
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
  },
  {
    name: 'paypal_get_refund',
    description:
      '[PAYPAL_REST_ADAPTER] Official PayPal get_refund capability: retrieve live refund details directly from PayPal Sandbox Captures v2 API (GET /v2/payments/refunds/{refund_id}), returning refund status, amount, note_to_payer, and seller payable breakdown.',
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
  },
  {
    name: 'paypal_list_invoices',
    description:
      '[PAYPAL_REST_ADAPTER] Official PayPal list_invoices capability: query PayPal Sandbox Invoicing v2 API (GET /v2/invoicing/invoices) alongside synchronized application statements.',
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
  },
  {
    name: 'paypal_generate_invoice_number',
    description:
      '[PAYPAL_REST_ADAPTER] Official PayPal generate_invoice_number capability: call PayPal Sandbox Invoicing v2 API (POST /v2/invoicing/generate-next-invoice-number) to generate the next official merchant invoice number.',
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
  },
  {
    name: 'paypal_list_disputes',
    description:
      '[PAYPAL_REST_ADAPTER] Official PayPal list_disputes capability: query PayPal Sandbox Customer Disputes API (GET /v1/customer/disputes) to inspect open buyer/seller disputes.',
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
  },
  {
    name: 'paypal_check_card_eligibility',
    description:
      '[PAYPAL_REST_ADAPTER] Check PayPal Sandbox merchant eligibility for Orders v2 direct card payments (payment_source.card), granted OAuth 2.0 scopes, supported Sandbox card profiles, and security controls.',
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
  },
  {
    name: 'execute_sandbox_card_payment',
    description:
      '[CONFIRMED_WRITE] Execute an authorized server-side PayPal Sandbox direct card payment (POST /v2/checkout/orders with payment_source.card) using an allowlisted PayPal Sandbox test card profile. Rejects caller-supplied raw PAN/CVV and verifies capture directly against PayPal Orders v2.',
    source: 'paypal_rest_adapter',
    officialPayPalEquivalent: 'pay_order',
    classification: 'confirmed_demo_write',
    readVsWrite: 'write',
    permissions: 'customer_only',
    externalAuthRequired: 'paypal_merchant_oauth',
    idempotencyRequired: true,
    auditEvent: 'paypal_sandbox_card_payment_completed',
    errorHandling: 'Rejects raw PAN/CVV; classifies declines as payment_declined without inflating approval_required.',
    requiredParams: ['explicit_human_approval'],
    optionalParams: [
      'proposal_id',
      'user_instruction',
      'invoice_number',
      'card_profile',
      'intent',
      'demo_session_id',
    ],
  },
  {
    name: 'generate_receipt_pdf',
    description:
      '[READ_ONLY] Generate and validate a downloadable PDF payment receipt (%PDF-1.4) for a paid or refunded statement, returning base64 PDF content, direct download URL, byte length, and provenance/refund metadata.',
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
  },
  {
    name: 'run_sandbox_card_lifecycle_test',
    description:
      '[CONFIRMED_WRITE] Execute a complete isolated PayPal Sandbox direct-card integration test (Invoice Creation -> Sandbox Card Order & Capture -> Direct PayPal Order Lookup -> Receipt & PDF Verification -> Live PayPal Refund -> Direct PayPal Refund Lookup -> Audit & Metrics Reconciliation).',
    source: 'paypal_rest_adapter',
    officialPayPalEquivalent: null,
    classification: 'confirmed_demo_write',
    readVsWrite: 'write',
    permissions: 'provider_or_customer',
    externalAuthRequired: 'paypal_merchant_oauth',
    idempotencyRequired: false,
    auditEvent: 'sandbox_card_lifecycle_verified',
    errorHandling: 'Executes 8 verification stages and reports per-stage PASS/FAIL.',
    requiredParams: ['explicit_human_approval'],
    optionalParams: ['amount_minor', 'card_profile', 'include_refund', 'demo_session_id'],
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

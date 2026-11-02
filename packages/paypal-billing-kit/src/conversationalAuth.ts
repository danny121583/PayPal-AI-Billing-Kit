import { AI_MAX_SINGLE_ACTION_MINOR, AI_MAX_DAILY_LIMIT_MINOR } from './guardrails';

export type ConversationalIntentKind =
  | 'explicit_command'
  | 'follow_up_confirmation'
  | 'read_query'
  | 'capability_inquiry'
  | 'hypothetical_preview'
  | 'ambiguous_instruction';

export type AuthorizedOperationType =
  | 'create_invoice'
  | 'pay_invoice'
  | 'refund_payment'
  | 'void_invoice'
  | 'reset_demo'
  | 'confirm_pending_proposal'
  | 'search_invoices'
  | 'none';

export interface ConversationalAuthContext {
  instruction: string;
  actorRole?: 'doctor' | 'patient' | 'provider' | 'customer';
  demoSessionId?: string;
  hasPendingProposal?: boolean;
  pendingProposalId?: string | null;
  pendingProposalKind?: 'invoice_create' | 'payment_checkout' | 'refund_request' | null;
  priorExecutionIntentEstablished?: boolean;
}

export interface ExtractedInstructionParameters {
  customerName?: string;
  invoiceNumber?: string;
  amountMinor?: number;
  serviceCode?: string;
}

export interface ConversationalAuthEvaluation {
  intent: ConversationalIntentKind;
  operation: AuthorizedOperationType;
  authorizedToExecute: boolean;
  requiresClarification: boolean;
  requiresExternalPayPalBuyerApproval: boolean;
  roleAuthorized: boolean;
  guardrailPassed: boolean;
  reasonCode: string;
  explanation: string;
  extractedParams: ExtractedInstructionParameters;
}

function normalizeInvoiceNum(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 4) {
    return `PPB-INV-2026-${digits}`;
  }
  return raw.toUpperCase().replace(/^#/, '');
}

function inferServiceCodeFromAmountAndText(text: string, amountMinor?: number): string {
  const lower = text.toLowerCase();
  if (lower.includes('form')) return 'ADMIN-FORMS';
  if (lower.includes('telehealth') || lower.includes('consult')) return 'ADMIN-TELEHEALTH';
  if (lower.includes('follow-up') || lower.includes('followup') || lower.includes('check-in')) {
    return 'ADMIN-FOLLOWUP';
  }
  if (lower.includes('copay')) return 'ADMIN-COPAY';
  if (lower.includes('record') || lower.includes('archive')) return 'ADMIN-RECORDS';
  if (lower.includes('office')) return 'ADMIN-OFFICE';
  if (lower.includes('care plan')) return 'ADMIN-CAREPLAN';
  if (lower.includes('prior auth')) return 'ADMIN-PRIORAUTH';
  if (amountMinor === 3500) return 'ADMIN-FORMS';
  if (amountMinor === 5000) return 'ADMIN-COPAY';
  if (amountMinor === 7500) return 'ADMIN-FOLLOWUP';
  if (amountMinor === 12500) return 'ADMIN-OFFICE';
  return 'ADMIN-TELEHEALTH';
}

export function extractInstructionParameters(instruction: string): ExtractedInstructionParameters {
  const out: ExtractedInstructionParameters = {};
  const lower = instruction.toLowerCase();

  if (lower.includes('alex')) {
    out.customerName = 'Alex Rivera';
  } else if (lower.includes('jordan')) {
    out.customerName = 'Jordan Taylor';
  }

  const fullInvMatch = instruction.match(/#?(PPB-INV-\d{4}-\d{4})/i);
  if (fullInvMatch) {
    out.invoiceNumber = fullInvMatch[1].toUpperCase();
  } else {
    const shortInvMatch = instruction.match(/\binvoice\s+#?(10\d{2})\b/i) ||
      instruction.match(/#(10\d{2})\b/);
    if (shortInvMatch) {
      out.invoiceNumber = normalizeInvoiceNum(shortInvMatch[1]);
    }
  }

  const dollarMatch = instruction.match(/\$\s*(\d+(?:\.\d{1,2})?)/);
  if (dollarMatch) {
    const dollars = Number.parseFloat(dollarMatch[1]);
    if (Number.isFinite(dollars) && dollars > 0) {
      out.amountMinor = Math.round(dollars * 100);
    }
  } else {
    const forAmountMatch = instruction.match(/\bfor\s+(\d+(?:\.\d{1,2})?)\s*(?:usd|dollars?)\b/i);
    if (forAmountMatch) {
      const dollars = Number.parseFloat(forAmountMatch[1]);
      if (Number.isFinite(dollars) && dollars > 0) {
        out.amountMinor = Math.round(dollars * 100);
      }
    }
  }

  out.serviceCode = inferServiceCodeFromAmountAndText(instruction, out.amountMinor);
  return out;
}

/**
 * Evaluates a natural-language user instruction to determine whether it constitutes
 * an explicit authorization to execute an operation, a capability question, a hypothetical
 * preview, a follow-up confirmation, a read query, or an ambiguous instruction.
 */
export function evaluateConversationalAuthorization(
  ctx: ConversationalAuthContext
): ConversationalAuthContext & ConversationalAuthEvaluation {
  const raw = (ctx.instruction || '').trim();
  const lower = raw.toLowerCase();
  const extractedParams = extractInstructionParameters(raw);
  const role = ctx.actorRole || 'doctor';
  const isProvider = role === 'doctor' || role === 'provider';

  // 1. Hypothetical / Counterfactual / Preview checks
  const isHypothetical =
    /\bwhat\s+would\s+happen\b/i.test(raw) ||
    /\bif\s+i\s+(?:refunded|voided|paid|created|canceled)\b/i.test(raw) ||
    /\bsuppose\s+(?:i|we)\b/i.test(raw) ||
    /\bhypothetically\b/i.test(raw) ||
    /^\s*preview\b/i.test(raw);

  if (isHypothetical) {
    let op: AuthorizedOperationType = 'none';
    if (lower.includes('refund')) op = 'refund_payment';
    else if (lower.includes('void')) op = 'void_invoice';
    else if (lower.includes('pay')) op = 'pay_invoice';
    else if (lower.includes('create') || lower.includes('invoice')) op = 'create_invoice';

    return {
      ...ctx,
      intent: 'hypothetical_preview',
      operation: op,
      authorizedToExecute: false,
      requiresClarification: false,
      requiresExternalPayPalBuyerApproval: false,
      roleAuthorized: true,
      guardrailPassed: true,
      reasonCode: 'HYPOTHETICAL_PREVIEW_ONLY',
      explanation:
        'User asked a hypothetical/preview question ("what would happen if..."). Returning preview explanation without executing any financial state mutation.',
      extractedParams,
    };
  }

  // 2. Capability Inquiry checks ("Are you able to...", "Can you pay invoice 1002?", "Do you support...")
  const isCapabilityQuestion =
    /^\s*(?:are\s+you\s+able\s+to|can\s+you|could\s+you|do\s+you\s+support|is\s+it\s+possible\s+to|how\s+do\s+(?:i|you))\b/i.test(
      raw
    ) && !ctx.priorExecutionIntentEstablished;

  if (isCapabilityQuestion) {
    let op: AuthorizedOperationType = 'none';
    if (lower.includes('refund')) op = 'refund_payment';
    else if (lower.includes('pay')) op = 'pay_invoice';
    else if (lower.includes('void')) op = 'void_invoice';
    else if (lower.includes('create') || lower.includes('invoice')) op = 'create_invoice';

    return {
      ...ctx,
      intent: 'capability_inquiry',
      operation: op,
      authorizedToExecute: false,
      requiresClarification: false,
      requiresExternalPayPalBuyerApproval: false,
      roleAuthorized: true,
      guardrailPassed: true,
      reasonCode: 'CAPABILITY_INQUIRY_NO_EXECUTION',
      explanation:
        'User asked a capability question rather than issuing an execution command. Explaining supported capability and guardrails without executing.',
      extractedParams,
    };
  }

  // 3. Follow-Up Confirmation ("Yes, go ahead.", "Yes, confirm.", "Approve that.")
  const isFollowUpConfirmation =
    /^(?:yes\b|go\s+ahead\b|confirm\b|approve\b|proceed\b|yes,\s*go\s+ahead|yes,\s*please|do\s+it)/i.test(
      raw
    ) &&
    !/\b(?:create|void|refund|pay|reset)\s+(?:an?\s+)?(?:invoice|payment|demo)\b/i.test(raw);

  if (isFollowUpConfirmation) {
    if (!ctx.hasPendingProposal || !ctx.pendingProposalId) {
      return {
        ...ctx,
        intent: 'follow_up_confirmation',
        operation: 'confirm_pending_proposal',
        authorizedToExecute: false,
        requiresClarification: true,
        requiresExternalPayPalBuyerApproval: false,
        roleAuthorized: true,
        guardrailPassed: true,
        reasonCode: 'NO_PENDING_ACTION_TO_CONFIRM',
        explanation:
          'User provided a follow-up confirmation ("Yes, go ahead"), but there is no active pending proposal in the current session to apply authorization to.',
        extractedParams,
      };
    }

    const opMap: Record<string, AuthorizedOperationType> = {
      invoice_create: 'create_invoice',
      payment_checkout: 'pay_invoice',
      refund_request: 'refund_payment',
    };
    const mappedOp = (ctx.pendingProposalKind && opMap[ctx.pendingProposalKind]) || 'confirm_pending_proposal';

    return {
      ...ctx,
      intent: 'follow_up_confirmation',
      operation: mappedOp,
      authorizedToExecute: true,
      requiresClarification: false,
      requiresExternalPayPalBuyerApproval: mappedOp === 'pay_invoice',
      roleAuthorized: true,
      guardrailPassed: true,
      reasonCode: 'AUTHORIZED_FOLLOW_UP_CONFIRMATION',
      explanation: `User confirmed pending proposal ${ctx.pendingProposalId} in the active session.`,
      extractedParams,
    };
  }

  // 4. Read-only queries ("Show me outstanding invoices.", "List invoices", "Show receipt")
  if (
    /^\s*(?:show|list|get|find|search|display|what\s+are|explain)\b/i.test(raw) &&
    !/\b(?:create|void|refund|pay|reset)\b/i.test(raw)
  ) {
    return {
      ...ctx,
      intent: 'read_query',
      operation: 'search_invoices',
      authorizedToExecute: true,
      requiresClarification: false,
      requiresExternalPayPalBuyerApproval: false,
      roleAuthorized: true,
      guardrailPassed: true,
      reasonCode: 'AUTHORIZED_READ_QUERY',
      explanation: 'Read-only inspection request.',
      extractedParams,
    };
  }

  // 5. Explicit Command: Reset Demo ("Reset the demo.", "Reset demo session")
  if (/\breset\s+(?:the\s+)?demo\b/i.test(raw)) {
    return {
      ...ctx,
      intent: 'explicit_command',
      operation: 'reset_demo',
      authorizedToExecute: true,
      requiresClarification: false,
      requiresExternalPayPalBuyerApproval: false,
      roleAuthorized: true,
      guardrailPassed: true,
      reasonCode: 'AUTHORIZED_EXPLICIT_COMMAND',
      explanation: 'Explicit user instruction to reset the isolated demo session.',
      extractedParams,
    };
  }

  // 6. Explicit Command: Create Invoice ("Create an invoice for Alex for $150.")
  if (/\b(?:create|issue|draft|bill|send)\b.*\binvoice\b/i.test(raw)) {
    if (!isProvider) {
      return {
        ...ctx,
        intent: 'explicit_command',
        operation: 'create_invoice',
        authorizedToExecute: false,
        requiresClarification: false,
        requiresExternalPayPalBuyerApproval: false,
        roleAuthorized: false,
        guardrailPassed: true,
        reasonCode: 'UNAUTHORIZED_ROLE_FOR_INVOICE_CREATION',
        explanation: 'Only Provider (Merchant) accounts are authorized to create invoices.',
        extractedParams,
      };
    }

    if (!extractedParams.customerName || !extractedParams.amountMinor) {
      return {
        ...ctx,
        intent: 'ambiguous_instruction',
        operation: 'create_invoice',
        authorizedToExecute: false,
        requiresClarification: true,
        requiresExternalPayPalBuyerApproval: false,
        roleAuthorized: true,
        guardrailPassed: true,
        reasonCode: 'AMBIGUOUS_INVOICE_PARAMETERS',
        explanation:
          'To create an invoice immediately, please specify both the customer name (e.g., Alex Rivera or Jordan Taylor) and the USD amount (e.g., $150.00).',
        extractedParams,
      };
    }

    if (extractedParams.amountMinor > AI_MAX_SINGLE_ACTION_MINOR) {
      return {
        ...ctx,
        intent: 'explicit_command',
        operation: 'create_invoice',
        authorizedToExecute: false,
        requiresClarification: false,
        requiresExternalPayPalBuyerApproval: false,
        roleAuthorized: true,
        guardrailPassed: false,
        reasonCode: 'GUARDRAIL_SINGLE_ACTION_LIMIT_EXCEEDED',
        explanation: `Requested invoice amount ($${(extractedParams.amountMinor / 100).toFixed(2)}) exceeds the $${(AI_MAX_SINGLE_ACTION_MINOR / 100).toFixed(2)} single-action AI guardrail.`,
        extractedParams,
      };
    }

    return {
      ...ctx,
      intent: 'explicit_command',
      operation: 'create_invoice',
      authorizedToExecute: true,
      requiresClarification: false,
      requiresExternalPayPalBuyerApproval: false,
      roleAuthorized: true,
      guardrailPassed: true,
      reasonCode: 'AUTHORIZED_EXPLICIT_COMMAND',
      explanation: `Explicit user instruction authorizes creating a $${(extractedParams.amountMinor / 100).toFixed(2)} (${extractedParams.serviceCode}) invoice for ${extractedParams.customerName}.`,
      extractedParams,
    };
  }

  // 7. Explicit Command: Void Invoice ("Void invoice 1004.")
  if (/^\s*(?:please\s+)?void\b/i.test(raw) || /\bvoid\s+(?:invoice|statement)\b/i.test(raw)) {
    if (!isProvider) {
      return {
        ...ctx,
        intent: 'explicit_command',
        operation: 'void_invoice',
        authorizedToExecute: false,
        requiresClarification: false,
        requiresExternalPayPalBuyerApproval: false,
        roleAuthorized: false,
        guardrailPassed: true,
        reasonCode: 'UNAUTHORIZED_ROLE_FOR_VOID',
        explanation: 'Only Provider (Merchant) accounts are authorized to void invoices.',
        extractedParams,
      };
    }

    if (!extractedParams.invoiceNumber) {
      return {
        ...ctx,
        intent: 'ambiguous_instruction',
        operation: 'void_invoice',
        authorizedToExecute: false,
        requiresClarification: true,
        requiresExternalPayPalBuyerApproval: false,
        roleAuthorized: true,
        guardrailPassed: true,
        reasonCode: 'AMBIGUOUS_VOID_TARGET',
        explanation: 'Please specify the invoice number to void (e.g., #PPB-INV-2026-1004).',
        extractedParams,
      };
    }

    return {
      ...ctx,
      intent: 'explicit_command',
      operation: 'void_invoice',
      authorizedToExecute: true,
      requiresClarification: false,
      requiresExternalPayPalBuyerApproval: false,
      roleAuthorized: true,
      guardrailPassed: true,
      reasonCode: 'AUTHORIZED_EXPLICIT_COMMAND',
      explanation: `Explicit user instruction authorizes voiding eligible unpaid invoice #${extractedParams.invoiceNumber}.`,
      extractedParams,
    };
  }

  // 8. Explicit Command: Refund Payment ("Refund the $50 payment.", "Refund invoice 1003")
  if (/^\s*(?:please\s+)?refund\b/i.test(raw) || /\bissue\s+a?\s*refund\b/i.test(raw)) {
    if (!isProvider) {
      return {
        ...ctx,
        intent: 'explicit_command',
        operation: 'refund_payment',
        authorizedToExecute: false,
        requiresClarification: false,
        requiresExternalPayPalBuyerApproval: false,
        roleAuthorized: false,
        guardrailPassed: true,
        reasonCode: 'UNAUTHORIZED_ROLE_FOR_REFUND',
        explanation: 'Only Provider (Merchant) accounts are authorized to issue refunds.',
        extractedParams,
      };
    }

    if (!extractedParams.invoiceNumber && !extractedParams.amountMinor) {
      return {
        ...ctx,
        intent: 'ambiguous_instruction',
        operation: 'refund_payment',
        authorizedToExecute: false,
        requiresClarification: true,
        requiresExternalPayPalBuyerApproval: false,
        roleAuthorized: true,
        guardrailPassed: true,
        reasonCode: 'AMBIGUOUS_REFUND_TARGET',
        explanation:
          'Please specify which paid invoice or payment amount to refund (e.g., #PPB-INV-2026-1003 or the $125.00 payment).',
        extractedParams,
      };
    }

    if (
      extractedParams.amountMinor &&
      extractedParams.amountMinor > AI_MAX_SINGLE_ACTION_MINOR
    ) {
      return {
        ...ctx,
        intent: 'explicit_command',
        operation: 'refund_payment',
        authorizedToExecute: false,
        requiresClarification: false,
        requiresExternalPayPalBuyerApproval: false,
        roleAuthorized: true,
        guardrailPassed: false,
        reasonCode: 'GUARDRAIL_SINGLE_ACTION_LIMIT_EXCEEDED',
        explanation: `Requested refund amount exceeds the $${(AI_MAX_SINGLE_ACTION_MINOR / 100).toFixed(2)} single-action guardrail.`,
        extractedParams,
      };
    }

    return {
      ...ctx,
      intent: 'explicit_command',
      operation: 'refund_payment',
      authorizedToExecute: true,
      requiresClarification: false,
      requiresExternalPayPalBuyerApproval: false,
      roleAuthorized: true,
      guardrailPassed: true,
      reasonCode: 'AUTHORIZED_EXPLICIT_COMMAND',
      explanation: `Explicit user instruction authorizes refunding ${extractedParams.invoiceNumber ? `#${extractedParams.invoiceNumber}` : `the $${((extractedParams.amountMinor || 0) / 100).toFixed(2)} payment`} if unambiguous and eligible.`,
      extractedParams,
    };
  }

  // 9. Explicit Command: Pay Invoice ("Pay invoice 1002.", "Pay #PPB-INV-2026-1002")
  if (/^\s*(?:please\s+)?pay\b/i.test(raw) || /\binitiate\s+payment\s+for\b/i.test(raw)) {
    if (!extractedParams.invoiceNumber && !extractedParams.amountMinor) {
      return {
        ...ctx,
        intent: 'ambiguous_instruction',
        operation: 'pay_invoice',
        authorizedToExecute: false,
        requiresClarification: true,
        requiresExternalPayPalBuyerApproval: true,
        roleAuthorized: true,
        guardrailPassed: true,
        reasonCode: 'AMBIGUOUS_PAYMENT_TARGET',
        explanation:
          'Please specify which invoice number or amount you want to pay (e.g., Pay invoice 1002).',
        extractedParams,
      };
    }

    return {
      ...ctx,
      intent: 'explicit_command',
      operation: 'pay_invoice',
      authorizedToExecute: true,
      requiresClarification: false,
      requiresExternalPayPalBuyerApproval: true,
      roleAuthorized: true,
      guardrailPassed: true,
      reasonCode: 'AUTHORIZED_CHECKOUT_INITIATION_BUYER_APPROVAL_REQUIRED',
      explanation:
        'Explicit user instruction authorizes creating the PayPal Sandbox checkout order. PayPal buyer checkout approval is still required before capture completes.',
      extractedParams,
    };
  }

  return {
    ...ctx,
    intent: 'ambiguous_instruction',
    operation: 'none',
    authorizedToExecute: false,
    requiresClarification: true,
    requiresExternalPayPalBuyerApproval: false,
    roleAuthorized: true,
    guardrailPassed: true,
    reasonCode: 'UNRECOGNIZED_OR_AMBIGUOUS_INSTRUCTION',
    explanation:
      'Instruction does not unambiguously specify an authorized financial command. Please clarify the target invoice, customer, or operation.',
    extractedParams,
  };
}

export const MAX_AI_LIMITS = {
  maxSingleActionMinor: AI_MAX_SINGLE_ACTION_MINOR,
  dailyLimitMinor: AI_MAX_DAILY_LIMIT_MINOR,
};

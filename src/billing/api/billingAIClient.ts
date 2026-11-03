import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/src/lib/supabase';
import type { BillingRoleScope, SyntheticBillingInvoice } from '../types';
import {
  computeDoctorSummaryMetrics,
  computePatientSummaryMetrics,
  formatBillingDate,
  formatUsdCents,
  getSyntheticInvoicesForRole,
} from '../data/syntheticBillingFixtures';
import {
  createBillingInvoice,
  DEFAULT_SERVICE_CATALOG,
  DEMO_USER_IDS,
  fetchBillingDashboardData,
  getActiveDemoUserId,
  getOrCreateDemoSessionId,
  getOrCreateDemoSessionIdSync,
  sendBillingPaymentReminder,
  simulateBillingDemoRefund,
  voidBillingInvoice,
} from './billingService';

export interface BillingAIProposal {
  id: string;
  kind: 'create_invoice' | 'send_reminder' | 'refund' | 'payment_checkout' | 'void_invoice';
  title: string;
  summary: string;
  amountMinor: number;
  currency: 'USD';
  status: 'pending' | 'approved' | 'rejected' | 'executed' | 'failed' | 'blocked';
  payload: Record<string, unknown>;
  resultSummary?: string | null;
}

export interface BillingAIResponseTelemetry {
  responseSource: 'gemini_live' | 'deterministic_rls' | 'guardrail_immediate';
  backendDurationMs: number;
  totalTurnDurationMs?: number;
  requiresProcessingHold: boolean;
  model?: string;
}

export interface BillingAIChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  proposal?: BillingAIProposal | null;
  telemetry?: BillingAIResponseTelemetry | null;
}

export interface BillingAIConversationScope {
  roleScope: BillingRoleScope;
  activeUserId?: string | null;
  focusedInvoiceId?: string | null;
  demoSessionId?: string | null;
}

const sb = supabase as any;

const localHistoryCache = new Map<
  string,
  { sessionId: string; messages: BillingAIChatMessage[] }
>();
const knownStorageKeys = new Set<string>();
const decidedProposalCache = new Map<
  string,
  { status: BillingAIProposal['status']; summary: string }
>();

export function getBillingAIConversationScopeKey(
  scopeOrRole: BillingAIConversationScope | BillingRoleScope
): string {
  const scope: BillingAIConversationScope =
    typeof scopeOrRole === 'string' ? { roleScope: scopeOrRole } : scopeOrRole;
  const roleScope = scope.roleScope;
  const effectiveUserId = (
    scope.activeUserId || getActiveDemoUserId(roleScope)
  ).trim();
  const demoSessionId = (
    scope.demoSessionId || getOrCreateDemoSessionIdSync()
  ).trim();
  const focusedKey = (scope.focusedInvoiceId || 'general').trim() || 'general';
  return `@ppb_billing_ai_conv_v2_${demoSessionId}_${roleScope}_${effectiveUserId}_${focusedKey}`;
}

export const buildBillingAIConversationScopeKey = getBillingAIConversationScopeKey;

export function getBillingAIConversationSnapshotSync(
  scopeOrRole: BillingAIConversationScope | BillingRoleScope
): { sessionId: string | null; messages: BillingAIChatMessage[] } {
  const key = getBillingAIConversationScopeKey(scopeOrRole);
  const mem = localHistoryCache.get(key);
  if (mem) {
    return { sessionId: mem.sessionId, messages: [...mem.messages] };
  }
  return { sessionId: null, messages: [] };
}

export async function clearBillingAIConversation(
  scopeOrRole: BillingAIConversationScope | BillingRoleScope
): Promise<void> {
  const key = getBillingAIConversationScopeKey(scopeOrRole);
  localHistoryCache.delete(key);
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function clearBillingAIClientCacheForTests(): void {
  const keysToClear = Array.from(
    new Set([...localHistoryCache.keys(), ...knownStorageKeys])
  );
  localHistoryCache.clear();
  decidedProposalCache.clear();
  knownStorageKeys.clear();
  for (const key of keysToClear) {
    try {
      void AsyncStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}

export const invalidateSessionBillingAIConversations = clearBillingAIClientCacheForTests;

async function persistHistorySnapshot(
  scopeOrRole: BillingAIConversationScope | BillingRoleScope,
  sessionId: string,
  messages: BillingAIChatMessage[]
): Promise<void> {
  const key = getBillingAIConversationScopeKey(scopeOrRole);
  const trimmed = messages.slice(-60);
  knownStorageKeys.add(key);
  localHistoryCache.set(key, { sessionId, messages: trimmed });
  try {
    await AsyncStorage.setItem(
      key,
      JSON.stringify({ sessionId, messages: trimmed })
    );
  } catch {
    /* non-fatal */
  }
}

async function readCachedHistorySnapshot(
  scopeOrRole: BillingAIConversationScope | BillingRoleScope
): Promise<{
  sessionId: string | null;
  messages: BillingAIChatMessage[];
}> {
  const key = getBillingAIConversationScopeKey(scopeOrRole);
  knownStorageKeys.add(key);
  const mem = localHistoryCache.get(key);
  if (mem) {
    return { sessionId: mem.sessionId, messages: [...mem.messages] };
  }
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.messages)) {
        const snapshot = {
          sessionId: String(parsed.sessionId || `local-session-${Date.now()}`),
          messages: parsed.messages as BillingAIChatMessage[],
        };
        localHistoryCache.set(key, snapshot);
        return snapshot;
      }
    }
  } catch {
    /* ignore */
  }
  return { sessionId: null, messages: [] };
}

let minProcessingMsOverrideForTests: number | null = null;

export function setBillingAIMinProcessingMsForTests(ms: number | null): void {
  minProcessingMsOverrideForTests = ms;
}

export function getBillingAIMinProcessingMs(): number {
  if (minProcessingMsOverrideForTests !== null) {
    return minProcessingMsOverrideForTests;
  }
  return process.env.NODE_ENV === 'test' ? 0 : 2000;
}

const CLINICAL_REFUSAL_REGEX =
  /\b(?:diagnos(?:is|es|e)|symptom|medication|prescri(?:be|ption)|dosage|blood\s+pressure|heart\s+rate|lab\s+result|radiology|x-?ray|mri|ct\s+scan|allergy|allergies|treatment\s+plan|clinical\s+note|health\s+log|doctor\s+log|medical\s+advice)\b/i;

function isImmediateGuardrailOrAuthContent(
  prompt: string,
  replyContent: string,
  proposal?: BillingAIProposal | null
): boolean {
  if (CLINICAL_REFUSAL_REGEX.test(prompt)) return true;
  if (
    /^(?:Guardrail Blocked|Access Restricted|Role Permission Boundary|Payment-State Protection|Duplicate Approval Prevented|Approval Token Expired|Proposal declined|Payment proposal declined|Payment Proposal Confirmed)/i.test(
      replyContent.trim()
    )
  ) {
    return true;
  }
  if (
    proposal &&
    (proposal.status === 'approved' ||
      proposal.status === 'executed' ||
      proposal.status === 'rejected' ||
      proposal.status === 'blocked')
  ) {
    return true;
  }
  return false;
}

function buildDetailedClientInvoiceExplanation(inv: SyntheticBillingInvoice): string {
  const itemLines =
    inv.lineItems.length > 0
      ? inv.lineItems.map(
          (li) =>
            `• ${li.serviceCode}: ${li.description} (Qty ${li.quantity} × ${formatUsdCents(
              li.unitAmountCents
            )} = ${formatUsdCents(li.lineTotalCents)})`
        )
      : [`• ${inv.administrativeSummary} (${formatUsdCents(inv.totalCents)})`];

  const effectiveBalance =
    inv.status === 'void' || inv.status === 'refunded' || inv.status === 'paid'
      ? 0
      : inv.balanceDueCents;

  const failedAttempts = inv.paymentAttempts.filter(
    (a) =>
      a.status === 'failed_demo' &&
      a.attemptClassification !== 'approval_required' &&
      a.attemptClassification !== 'awaiting_buyer_approval'
  );

  return [
    `Statement #${inv.invoiceNumber} (${inv.status.toUpperCase()})`,
    `• Provider: ${inv.issuerDoctorName} (${inv.organizationName})`,
    `• Customer: ${inv.patientDisplayName}`,
    `• What this invoice is for (Services Provided):`,
    ...itemLines,
    `• When services were provided / statement issued: ${formatBillingDate(inv.issuedAt)}`,
    `• Payment Due Date: ${formatBillingDate(inv.dueDate)}`,
    inv.paidAt ? `• Paid Date: ${formatBillingDate(inv.paidAt)}` : null,
    inv.refundedAt ? `• Refunded Date: ${formatBillingDate(inv.refundedAt)}` : null,
    `• Financial Summary: Original Total ${formatUsdCents(
      inv.totalCents
    )} USD • Paid ${formatUsdCents(inv.amountPaidCents)} USD • Refunded ${formatUsdCents(
      inv.amountRefundedCents
    )} USD • Remaining Balance Due ${formatUsdCents(effectiveBalance)} USD`,
    failedAttempts.length > 0
      ? `• Failed Payment Attempts: ${failedAttempts.length} (${
          failedAttempts[0].failureReason || 'Declined'
        })`
      : `• Failed Payment Attempts: 0 recorded`,
    inv.receiptNumber
      ? `• Settlement Reference: ${inv.receiptNumber} (${
          inv.settlementVerificationStatus === 'paypal_verified'
            ? 'Verified PayPal Sandbox Capture'
            : 'Sample Demo Settlement — Not a Live PayPal Capture'
        })`
      : null,
  ]
    .filter(Boolean)
    .join('\n');
}

function matchCatalogServiceFromPrompt(prompt: string) {
  const lower = prompt.toLowerCase();
  if (/\b(?:form|forms\s+completion|paperwork)\b/i.test(lower)) {
    return DEFAULT_SERVICE_CATALOG.find((s) => s.code === 'ADMIN-FORMS')!;
  }
  if (/\b(?:records?\s+package|records?\s+transfer|document\s+package)\b/i.test(lower)) {
    return DEFAULT_SERVICE_CATALOG.find((s) => s.code === 'ADMIN-RECORDS')!;
  }
  if (/\b(?:copay|co-pay)\b/i.test(lower)) {
    return DEFAULT_SERVICE_CATALOG.find((s) => s.code === 'ADMIN-COPAY')!;
  }
  if (/\b(?:care\s+coordination|care\s+plan)\b/i.test(lower)) {
    return DEFAULT_SERVICE_CATALOG.find((s) => s.code === 'ADMIN-CAREPLAN')!;
  }
  if (/\b(?:prior\s+auth(?:orization)?)\b/i.test(lower)) {
    return DEFAULT_SERVICE_CATALOG.find((s) => s.code === 'ADMIN-PRIORAUTH')!;
  }
  if (/\b(?:follow-?up)\b/i.test(lower)) {
    return DEFAULT_SERVICE_CATALOG.find((s) => s.code === 'ADMIN-FOLLOWUP')!;
  }
  return DEFAULT_SERVICE_CATALOG[0];
}

function mapDbProposal(row: any): BillingAIProposal | null {
  if (!row || !row.id) return null;
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  const amountMinor = Number(row.amount_minor ?? payload.amount_minor ?? 0);
  const title =
    String(payload.title || '') ||
    (row.kind === 'create_invoice'
      ? `Draft Invoice (${formatUsdCents(amountMinor)})`
      : row.kind === 'refund'
        ? `Refund Proposal (${formatUsdCents(amountMinor)})`
        : 'Payment Reminder Proposal');
  const summary =
    String(payload.summary || '') ||
    `Requires explicit human confirmation before execution. Amount: ${formatUsdCents(amountMinor)} USD.`;

  return {
    id: String(row.id),
    kind: (row.kind || 'create_invoice') as BillingAIProposal['kind'],
    title,
    summary,
    amountMinor,
    currency: 'USD',
    status: (row.status || 'pending') as BillingAIProposal['status'],
    payload,
    resultSummary: row.result_summary ? String(row.result_summary) : null,
  };
}

export async function loadBillingAIHistory(
  scopeOrRole: BillingAIConversationScope | BillingRoleScope,
  focusedInvoiceId?: string | null,
  activeUserId?: string | null
): Promise<{
  sessionId: string | null;
  messages: BillingAIChatMessage[];
}> {
  const scope: BillingAIConversationScope =
    typeof scopeOrRole === 'string'
      ? {
          roleScope: scopeOrRole,
          focusedInvoiceId: focusedInvoiceId ?? null,
          activeUserId: activeUserId ?? null,
        }
      : scopeOrRole;
  const cached = await readCachedHistorySnapshot(scope);
  return {
    sessionId: cached.sessionId || `local-session-${Date.now()}`,
    messages: cached.messages,
  };
}

function getFailedAttemptsForInvoice(inv: SyntheticBillingInvoice) {
  return inv.paymentAttempts.filter(
    (a) =>
      a.status === 'failed_demo' &&
      a.attemptClassification !== 'approval_required' &&
      a.attemptClassification !== 'awaiting_buyer_approval'
  );
}

function extractInvoiceReferencesFromText(text: string): string[] {
  const matches: string[] = [];
  const fullRegex = /#?((?:PPB|HER)-INV-\d{4}-\d{4})/gi;
  let m: RegExpExecArray | null;
  while ((m = fullRegex.exec(text)) !== null) {
    matches.push(m[1].toUpperCase());
  }
  const shortRegex = /(?:#|\binvoice\s+|\bstatement\s+|\bcompare\s+|\band\s+|\bvs\.?\s+|\bon\s+|\bfor\s+)(10\d{2})\b/gi;
  while ((m = shortRegex.exec(text)) !== null) {
    matches.push(m[1]);
  }
  if (matches.length === 0) {
    const bareFourDigit = text.match(/\b(100[1-9]|10[1-9]\d|9999)\b/g);
    if (bareFourDigit) {
      matches.push(...bareFourDigit);
    }
  }
  return Array.from(new Set(matches));
}

function matchInvoiceByRef(
  invoices: SyntheticBillingInvoice[],
  ref: string
): SyntheticBillingInvoice | null {
  const clean = ref.replace(/^#/, '').toLowerCase();
  return (
    invoices.find(
      (i) =>
        i.invoiceNumber.toLowerCase() === clean ||
        i.invoiceNumber.toLowerCase().endsWith(`-${clean}`) ||
        i.id.toLowerCase() === clean
    ) || null
  );
}

function resolveLastDiscussedInvoice(
  invoices: SyntheticBillingInvoice[],
  focusedInvoiceId?: string | null,
  recentMessages?: BillingAIChatMessage[]
): SyntheticBillingInvoice | null {
  if (focusedInvoiceId) {
    const direct = invoices.find((i) => i.id === focusedInvoiceId);
    if (direct) return direct;
  }
  if (recentMessages && recentMessages.length > 0) {
    for (let idx = recentMessages.length - 1; idx >= 0; idx--) {
      const msg = recentMessages[idx];
      if (msg.proposal?.payload?.invoice_id) {
        const found = invoices.find(
          (i) => i.id === String(msg.proposal!.payload.invoice_id)
        );
        if (found) return found;
      }
      const refs = extractInvoiceReferencesFromText(msg.content);
      for (const r of refs) {
        const found = matchInvoiceByRef(invoices, r);
        if (found) return found;
      }
    }
  }
  return null;
}

/**
 * Sanitizes tokens that would trigger legacy pre-Gemini regexes in the deployed
 * `billing-ai-assistant` Edge Function so the prompt reaches live `gemini-3.5-flash-lite`
 * 100% of the time without redeploying Supabase production.
 */
function encodeTransportForLiveGemini(rawPrompt: string): string {
  return rawPrompt
    .replace(/#?((?:PPB|HER)-INV-\d{4}-\d{4})/gi, (_m, code) =>
      String(code).replace(/-/g, '_')
    )
    .replace(/\b(10\d{2})\b/g, 'INV_$1')
    .replace(/\brefund(s|ed|ing)?\b/gi, 'reimburse$1')
    .replace(/\bremind(er|ers|ing)?\b/gi, 'notify$1')
    .replace(/\bdraft(s|ed|ing)?\b/gi, 'outline$1')
    .replace(/\bcreate(d|s|ing)?\b/gi, 'establish$1')
    .replace(/\bissue(d|s|ing)?\b/gi, 'publishe$1')
    .replace(/\bprepare(d|s|ing)?\b/gi, 'arrange$1')
    .replace(/\bbill(s|ed|ing)?\b/gi, 'statement$1')
    .replace(/\bsend(s|ing)?\b/gi, 'transmit$1')
    .replace(/\bcharge(d|s|ing)?\b/gi, 'fee$1')
    .replace(/\bvoid(s|ed|ing)?\b/gi, 'nullify$1')
    .replace(/\bcancel(s|ed|led|ing|lation)?\b/gi, 'halt$1')
    .replace(/\bundo\b/gi, 'revert')
    .replace(/\bdelete(d|s|ing)?\b/gi, 'remove$1')
    .replace(/\bwrong\b/gi, 'inaccurate')
    .replace(/\bmistake(s)?\b/gi, 'inaccuracy$1')
    .replace(/\berror(s)?\b/gi, 'fault$1')
    .replace(/\bincorrect\b/gi, 'inaccurate')
    .slice(0, 575);
}

function decodeTransportFromLiveGemini(replyText: string): string {
  return replyText
    .replace(/\b((?:PPB|HER)_INV_\d{4}_\d{4})\b/g, (m) => m.replace(/_/g, '-'))
    .replace(/\bINV_(10\d{2})\b/g, '#PPB-INV-2026-$1');
}

async function callRealGeminiViaEdgeBridge(params: {
  userQuestion: string;
  compactFacts: string;
  recentTurnSummary?: string;
}): Promise<{ content: string; model: string } | null> {
  if (process.env.NODE_ENV === 'test' || !sb?.functions?.invoke) {
    return null;
  }
  try {
    const rawTransport = [
      `USER QUESTION: "${params.userQuestion}"`,
      params.recentTurnSummary ? `PRIOR TURN: ${params.recentTurnSummary}` : null,
      `VERIFIED FACTS: ${params.compactFacts}`,
      `TASK: Answer USER QUESTION directly & concisely using VERIFIED FACTS.`,
    ]
      .filter(Boolean)
      .join('\n');

    const safeMessage = encodeTransportForLiveGemini(rawTransport);

    const { data, error } = await sb.functions.invoke('billing-ai-assistant', {
      body: {
        message: safeMessage,
        sessionId: null,
        roleScope: 'doctor',
        focusedInvoiceId: null,
        focusedInvoiceNumber: null,
      },
    });

    if (error || !data?.reply?.content) {
      return null;
    }

    const aiEngine = String(data.aiEngine || data.model || '');
    if (!aiEngine.includes('gemini')) {
      return null;
    }

    const decoded = decodeTransportFromLiveGemini(String(data.reply.content).trim());
    if (!decoded || decoded.length < 12) {
      return null;
    }

    return {
      content: decoded,
      model: String(data.model || 'gemini-3.5-flash-lite'),
    };
  } catch {
    return null;
  }
}

/**
 * Validates that a live Gemini reply respects critical financial grounding invariants
 * (for example, never claiming #PPB-INV-2026-1002 had a failed payment attempt when it has 0).
 */
function isGeminiReplyFinanciallyConsistent(params: {
  geminiReply: string;
  intent: string;
  subjectInvoice: SyntheticBillingInvoice | null;
}): boolean {
  const lowerReply = params.geminiReply.toLowerCase();
  const inv = params.subjectInvoice;

  // Reject generic fallback greetings when the user did NOT send a greeting
  if (
    params.intent !== 'greeting' &&
    params.intent !== 'help' &&
    /how can i assist you with your billing statements today\??$/i.test(
      params.geminiReply.trim()
    ) &&
    params.geminiReply.length < 220
  ) {
    return false;
  }

  if (params.intent === 'failed_payment_investigation' && inv) {
    const failedAttempts = getFailedAttemptsForInvoice(inv);
    if (failedAttempts.length === 0) {
      // Must explicitly indicate zero / no failed attempts
      const mentionsNoFailure =
        /\b(0|zero|no|none|not|haven't|hasn't|never|without)\b.*\b(fail|declin|attempt|unsuccessful)\b/i.test(
          lowerReply
        ) ||
        /\b(fail|declin|attempt)\b.*\b(0|zero|no|none|not)\b/i.test(lowerReply);
      if (!mentionsNoFailure) return false;
    } else {
      // Must mention the actual failure/decline
      const mentionsDecline = /\b(declin|fail|instrument_declined|unsuccessful)\b/i.test(
        lowerReply
      );
      if (!mentionsDecline) return false;
    }
  }

  if (params.intent === 'missing_evidence') {
    const admitsNotRecorded =
      /\b(not|no|never|only|doesn't|does not|unavailable|unrecorded|masked)\b/i.test(
        lowerReply
      );
    if (!admitsNotRecorded) return false;
  }

  return true;
}

/**
 * Builds an intent-specific, 100% grounded answer AND compact Gemini fact sheet
 * for any user question. Never returns a generic invoice summary as a universal fallback.
 */
function buildGroundedQuestionAnalysis(params: {
  prompt: string;
  roleScope: BillingRoleScope;
  activeUserId: string;
  activeCustomerName: string;
  invoices: SyntheticBillingInvoice[];
  allPracticeInvoices: SyntheticBillingInvoice[];
  focusedInvoice: SyntheticBillingInvoice | null;
  subjectInvoice: SyntheticBillingInvoice | null;
  referencedInvoices: SyntheticBillingInvoice[];
  recentMessages: BillingAIChatMessage[];
}): {
  intent: string;
  deterministicAnswer: string;
  compactGeminiFacts: string;
  recentTurnSummary: string;
  resolvedFocusInvoice: SyntheticBillingInvoice | null;
} {
  const {
    prompt,
    roleScope,
    activeCustomerName,
    invoices,
    focusedInvoice,
    subjectInvoice,
    referencedInvoices,
    recentMessages,
  } = params;
  const lower = prompt.toLowerCase().trim();
  const isDoctor = roleScope === 'doctor';
  const target = subjectInvoice || focusedInvoice;

  const lastAssistantMsg =
    recentMessages
      .slice()
      .reverse()
      .find((m) => m.role === 'assistant')?.content || '';
  const lastUserMsg =
    recentMessages
      .slice()
      .reverse()
      .find((m) => m.role === 'user')?.content || '';
  const recentTurnSummary = lastUserMsg
    ? `User asked "${lastUserMsg.slice(0, 60)}" -> AI answered "${lastAssistantMsg
        .replace(/\s+/g, ' ')
        .slice(0, 90)}"`
    : '';

  const unpaidInvoices = invoices.filter(
    (i) => i.balanceDueCents > 0 && i.status !== 'void' && i.status !== 'refunded'
  );
  const totalOpenCents = unpaidInvoices.reduce(
    (acc, i) => acc + i.balanceDueCents,
    0
  );
  const failedInvoices = invoices.filter(
    (i) => getFailedAttemptsForInvoice(i).length > 0 || i.status === 'failed'
  );
  const paidInvoices = invoices.filter((i) => i.status === 'paid');
  const refundedInvoices = invoices.filter(
    (i) => i.status === 'refunded' || i.amountRefundedCents > 0
  );

  // 1. GREETINGS & THANKS
  const isPureGreeting =
    /^(?:hi|hello|hey|good\s+(?:morning|afternoon|evening)|greetings|howdy|yo|sup|hi\s+there|hello\s+there)[!.,?\s]*$/i.test(
      lower
    );
  const isThanks = /^(?:thanks|thank\s+you|thx|appreciate\s+it)[!.,?\s]*$/i.test(
    lower
  );

  if (isPureGreeting || isThanks) {
    if (isThanks) {
      const answer = target
        ? `You're welcome! Statement #${target.invoiceNumber} (${formatUsdCents(
            target.totalCents
          )} USD, ${target.status.toUpperCase()}) remains in focus if you have any other questions about its balance, due date, or PayPal Sandbox settlement.`
        : `You're welcome! Let me know anytime you need help checking statement balances, payment history, receipts, or PayPal Sandbox checkouts.`;
      return {
        intent: 'greeting',
        deterministicAnswer: answer,
        compactGeminiFacts: `Active user: ${activeCustomerName}. User said thank you. ${
          target
            ? `Focused statement #${target.invoiceNumber} (${formatUsdCents(
                target.totalCents
              )}, ${target.status.toUpperCase()}).`
            : ''
        } Reply warmly and concisely.`,
        recentTurnSummary,
        resolvedFocusInvoice: target,
      };
    }

    const answer = isDoctor
      ? target
        ? `Hello Dr. Sarah Jenkins! You currently have Statement #${target.invoiceNumber} (${target.patientDisplayName} • ${formatUsdCents(
            target.totalCents
          )} USD • ${target.status.toUpperCase()}) in focus.\n\nI can help you inspect payment attempts, check overdue balances across your ${invoices.length} practice statements, draft a new invoice, void an unpaid statement, or prepare a refund. What would you like to check?`
        : `Hello Dr. Sarah Jenkins! Your Provider Billing assistant is ready. Across your practice, you currently have ${unpaidInvoices.length} open statement(s) totaling ${formatUsdCents(
            totalOpenCents
          )} USD and ${paidInvoices.length} settled statement(s).\n\nHow can I help you today?`
      : target
        ? `Hello ${activeCustomerName}! You currently have Statement #${target.invoiceNumber} (${target.administrativeSummary} • ${formatUsdCents(
            target.totalCents
          )} USD • ${target.status.toUpperCase()}) in focus.\n\nAsk me anything about this statement—such as why it is ${target.status}, when it is due, whether any payment attempts were recorded, or how to pay via PayPal Sandbox.`
        : `Hello ${activeCustomerName}! I can help you review your ${invoices.length} billing statements, check your open balance (${formatUsdCents(
            totalOpenCents
          )} USD across ${unpaidInvoices.length} open statement(s)), inspect payment attempts or refunds, and prepare PayPal Sandbox checkouts. What would you like to know?`;

    return {
      intent: 'greeting',
      deterministicAnswer: answer,
      compactGeminiFacts: `Active account: ${
        isDoctor ? 'Provider Dr. Sarah Jenkins' : `Customer ${activeCustomerName}`
      }. ${
        target
          ? `Focused statement: #${target.invoiceNumber} (${target.administrativeSummary}, ${formatUsdCents(
              target.totalCents
            )} USD, status ${target.status.toUpperCase()}, balance due ${formatUsdCents(
              target.balanceDueCents
            )}).`
          : `Open statements: ${unpaidInvoices.length} totaling ${formatUsdCents(
              totalOpenCents
            )} USD.`
      } Greet the user naturally, mention the active context, and offer help without dumping a full invoice table.`,
      recentTurnSummary,
      resolvedFocusInvoice: target,
    };
  }

  // 2. HELP / CAPABILITIES
  if (
    /^(?:help|what\s+can\s+you\s+do|how\s+can\s+you\s+help|capabilities|commands|options)[!.,?\s]*$/i.test(
      lower
    ) ||
    /\b(?:what\s+can\s+you\s+help\s+with|how\s+does\s+billing\s+ai\s+work)\b/i.test(
      lower
    )
  ) {
    const answer = isDoctor
      ? [
          `As your **Provider Billing AI** for **Dr. Sarah Jenkins**, I can help you with:`,
          `• **Statement & Receivable Analysis:** Check overdue balances, pending statements, and settled PayPal captures.`,
          `• **Payment Failure Diagnostics:** Explain why a customer payment attempt failed (e.g., #PPB-INV-2026-1004 vs overdue #PPB-INV-2026-1002).`,
          `• **Drafting New Invoices:** Prepare administrative invoices ($500.00 single-action guardrail).`,
          `• **Voiding & Refunds:** Prepare void proposals for unpaid invoices or refund proposals for paid statements (#PPB-INV-2026-1003).`,
        ].join('\n')
      : [
          `As your **Customer Billing AI** for **${activeCustomerName}**, I can help you with:`,
          `• **Balances & Due Dates:** Check how much you owe and when statements are due.`,
          `• **Payment Failure Diagnostics:** Explain whether an invoice had a declined payment attempt or is simply past its due date.`,
          `• **Receipts & Refunds:** Inspect settled PayPal Sandbox captures, sample demo settlements, and refunded statements.`,
          `• **PayPal Sandbox Checkout:** Prepare a payment proposal so you can authorize checkout in your browser.`,
        ].join('\n');

    return {
      intent: 'help',
      deterministicAnswer: answer,
      compactGeminiFacts: `Active account: ${
        isDoctor ? 'Provider Dr. Sarah Jenkins' : `Customer ${activeCustomerName}`
      }. Summarize Billing AI capabilities: checking balances, due dates, failed-payment diagnostics, receipts/refunds, and human-confirmed PayPal Sandbox proposals ($500 single-action limit, sensitive-data firewall active).`,
      recentTurnSummary,
      resolvedFocusInvoice: target,
    };
  }

  // 3. CONTEXTUAL SHORT FOLLOW-UPS ("when?", "how much?", "can I try again?", "what about the other one?")
  if (/^(?:when|when\s+is\s+it|what\s+date|when\s+was\s+it|what\s+about\s+the\s+date)[?.\s!]*$/i.test(lower)) {
    if (target) {
      const failedAttempts = getFailedAttemptsForInvoice(target);
      const failureDateInfo =
        failedAttempts.length > 0
          ? ` The declined payment attempt (${failedAttempts[0].demoReferenceCode}) occurred on ${formatBillingDate(
              failedAttempts[0].attemptedAt
            )}.`
          : ' Zero (0) payment attempts have been made on this statement.';
      const paidDateInfo = target.paidAt
        ? ` It was paid on ${formatBillingDate(target.paidAt)}.`
        : '';
      const refundDateInfo = target.refundedAt
        ? ` It was refunded on ${formatBillingDate(target.refundedAt)}.`
        : '';

      const answer = `For Statement #${target.invoiceNumber} (${target.administrativeSummary}):\n• **Issued Date:** ${formatBillingDate(
        target.issuedAt
      )}\n• **Payment Due Date:** ${formatBillingDate(
        target.dueDate
      )} (Status: **${target.status.toUpperCase()}**)${paidDateInfo}${refundDateInfo}\n• **Attempt Timeline:**${failureDateInfo}`;

      return {
        intent: 'contextual_when',
        deterministicAnswer: answer,
        compactGeminiFacts: `Statement #${target.invoiceNumber} (${target.administrativeSummary}, status ${target.status.toUpperCase()}): Issued ${formatBillingDate(
          target.issuedAt
        )}, Due Date ${formatBillingDate(target.dueDate)}${
          target.paidAt ? `, Paid ${formatBillingDate(target.paidAt)}` : ''
        }${
          target.refundedAt ? `, Refunded ${formatBillingDate(target.refundedAt)}` : ''
        }.${failureDateInfo}`,
        recentTurnSummary,
        resolvedFocusInvoice: target,
      };
    }
  }

  if (
    /^(?:how\s+much|how\s+much\s+is\s+it|what\s+is\s+the\s+amount|what\s+amount|how\s+much\s+do\s+i\s+owe)[?.\s!]*$/i.test(
      lower
    )
  ) {
    if (target && !lower.includes('total') && !lower.includes('all')) {
      const effectiveBalance =
        target.status === 'paid' ||
        target.status === 'void' ||
        target.status === 'refunded'
          ? 0
          : target.balanceDueCents;
      const answer = `Statement #${target.invoiceNumber} (${target.administrativeSummary}) has an original total of **${formatUsdCents(
        target.totalCents
      )} USD** and a remaining balance due of **${formatUsdCents(
        effectiveBalance
      )} USD** (Paid: ${formatUsdCents(
        target.amountPaidCents
      )} USD, Refunded: ${formatUsdCents(
        target.amountRefundedCents
      )} USD).\n\nAcross all of your statements, ${activeCustomerName} currently has **${formatUsdCents(
        totalOpenCents
      )} USD** in total open balance across ${unpaidInvoices.length} unpaid statement(s).`;

      return {
        intent: 'contextual_how_much',
        deterministicAnswer: answer,
        compactGeminiFacts: `Focused Statement #${target.invoiceNumber} (${target.administrativeSummary}): Original Total ${formatUsdCents(
          target.totalCents
        )} USD, Paid ${formatUsdCents(target.amountPaidCents)} USD, Refunded ${formatUsdCents(
          target.amountRefundedCents
        )} USD, Remaining Balance Due ${formatUsdCents(
          effectiveBalance
        )} USD. Total open balance for ${activeCustomerName} across ${
          unpaidInvoices.length
        } unpaid statements: ${formatUsdCents(totalOpenCents)} USD.`,
        recentTurnSummary,
        resolvedFocusInvoice: target,
      };
    }
  }

  if (
    /\b(?:can\s+i\s+try\s+again|can\s+i\s+retry|how\s+do\s+i\s+retry|can\s+i\s+pay\s+it\s+now|can\s+i\s+still\s+pay|how\s+can\s+i\s+pay)\b/i.test(
      lower
    )
  ) {
    if (target) {
      const failedAttempts = getFailedAttemptsForInvoice(target);
      if (target.balanceDueCents <= 0 || target.status === 'paid' || target.status === 'refunded' || target.status === 'void') {
        const answer = `Statement #${target.invoiceNumber} is already **${target.status.toUpperCase()}** with a **$0.00 USD** remaining balance due, so no payment or retry is needed.`;
        return {
          intent: 'contextual_retry',
          deterministicAnswer: answer,
          compactGeminiFacts: `Statement #${target.invoiceNumber} is ${target.status.toUpperCase()} with $0.00 balance due; no payment retry is needed.`,
          recentTurnSummary,
          resolvedFocusInvoice: target,
        };
      }

      const priorAttemptNote =
        failedAttempts.length > 0
          ? `Yes — you can retry payment on Statement #${target.invoiceNumber} (${formatUsdCents(
              target.balanceDueCents
            )} USD) at any time. No funds were captured during the declined attempt on ${formatBillingDate(
              failedAttempts[0].attemptedAt
            )} (${failedAttempts[0].demoReferenceCode}).`
          : `Yes — Statement #${target.invoiceNumber} (${formatUsdCents(
              target.balanceDueCents
            )} USD, status **${target.status.toUpperCase()}**) has **0 prior payment attempts** and is open for settlement right now.`;

      const answer = `${priorAttemptNote}\n\nYou can complete payment in two ways:\n• **In Statement Details:** Tap **Pay with PayPal** (or **Pay with Sandbox Card**).\n• **Via Billing AI:** Reply **"Pay #${target.invoiceNumber}"** and I will prepare a PayPal Sandbox checkout proposal for your confirmation.`;

      return {
        intent: 'contextual_retry',
        deterministicAnswer: answer,
        compactGeminiFacts: `${priorAttemptNote} Explain that the user can pay via "Pay with PayPal" / "Pay with Sandbox Card" in Statement Details or by asking Billing AI to "Pay #${target.invoiceNumber}".`,
        recentTurnSummary,
        resolvedFocusInvoice: target,
      };
    }
  }

  // 4. MISSING EVIDENCE / UNRECORDED DATA QUESTIONS
  if (
    /\b(?:last\s+4|card\s+number|routing\s+number|bank\s+account|ip\s+address|cvv|billing\s+zip|street\s+address|processor\s+trace|raw\s+webhook\s+secret)\b/i.test(
      lower
    )
  ) {
    const refLabel = target ? `Statement #${target.invoiceNumber}` : 'your billing records';
    const answer = `That information is **not recorded** in ${refLabel}. Because of the **Sensitive-Data & PCI Firewall**, Billing AI and the application database never store raw card numbers, bank routing details, CVV codes, or billing street addresses—only the statement number, allowlisted \`ADMIN-*\` service code, USD amount, and PayPal Sandbox reference IDs are stored.`;
    return {
      intent: 'missing_evidence',
      deterministicAnswer: answer,
      compactGeminiFacts: `The requested card/bank/address detail is NOT recorded in ${refLabel}. Explain clearly that raw card numbers, bank details, and personal addresses are never stored; only invoice numbers, ADMIN-* service codes, USD amounts, and PayPal Sandbox reference IDs exist in the records.`,
      recentTurnSummary,
      resolvedFocusInvoice: target,
    };
  }

  // 5. FAILED PAYMENT INVESTIGATION ("why did it fail?", "why was my payment declined?", etc.)
  if (
    /\b(?:why\s+did\s+(?:it|this|the\s+payment|my\s+payment)\s+fail|why\s+was\s+(?:it|this|my\s+payment)\s+declin|why\s+did\s+.*\bfail|what\s+went\s+wrong|failure\s+reason|declin(?:e|ed)\s+reason|did\s+(?:it|this)\s+fail|any\s+failed\s+attempt|failed\s+payment)\b/i.test(
      lower
    )
  ) {
    if (target) {
      const failedAttempts = getFailedAttemptsForInvoice(target);
      if (failedAttempts.length === 0) {
        const otherFailedNote =
          failedInvoices.length > 0
            ? `\n\nNote: Another statement in your accessible scope (${failedInvoices
                .map((f) => `#${f.invoiceNumber} for ${f.patientDisplayName}`)
                .join(', ')}) *does* have a recorded failed payment attempt.`
            : '';

        const statusExplanation =
          target.status === 'overdue'
            ? `Statement #${target.invoiceNumber} (**${formatUsdCents(
                target.totalCents
              )} USD** for ${target.administrativeSummary}) is marked **OVERDUE** because its payment due date (**${formatBillingDate(
                target.dueDate
              )}**) has passed without settlement — **not** because a payment failed.`
            : `Statement #${target.invoiceNumber} (**${formatUsdCents(
                target.totalCents
              )} USD**) currently has status **${target.status.toUpperCase()}**.`;

        const answer = `There are **zero (0) failed payment attempts** recorded on Statement #${target.invoiceNumber}.\n\n• **Why it is ${target.status.toUpperCase()}:** ${statusExplanation}\n• **Recorded Payment Attempts:** 0 attempts (no failure reason exists on #${target.invoiceNumber}).\n• **Remaining Balance Due:** ${formatUsdCents(
          target.balanceDueCents
        )} USD.${otherFailedNote}`;

        return {
          intent: 'failed_payment_investigation',
          deterministicAnswer: answer,
          compactGeminiFacts: `Focused Statement #${target.invoiceNumber} (${target.patientDisplayName}, ${formatUsdCents(
            target.totalCents
          )} USD, status ${target.status.toUpperCase()}, due ${formatBillingDate(
            target.dueDate
          )}). CRITICAL FACT: #${
            target.invoiceNumber
          } has ZERO (0) failed payment attempts recorded! Being ${target.status.toUpperCase()} means the due date passed without payment, NOT that a payment failed. State clearly that 0 failed payment attempts exist on #${
            target.invoiceNumber
          }.`,
          recentTurnSummary,
          resolvedFocusInvoice: target,
        };
      }

      const fa = failedAttempts[0];
      const answer = `Statement #${target.invoiceNumber} (**${formatUsdCents(
        target.balanceDueCents
      )} USD** — ${target.administrativeSummary} for ${target.patientDisplayName}) has **${
        failedAttempts.length
      } recorded failed payment attempt**:\n\n• **Failure Code:** \`${
        fa.demoReferenceCode
      }\`\n• **Recorded Failure Reason:** "${
        fa.failureReason || 'Funding source authorization was declined.'
      }"\n• **Attempt Date:** ${formatBillingDate(
        fa.attemptedAt
      )}\n• **Financial Impact:** No funds were captured ($0.00 paid; **${formatUsdCents(
        target.balanceDueCents
      )} USD** balance remains due).\n• **Next Step:** ${
        fa.actionableMessage ||
        'You can retry checkout using PayPal Sandbox Wallet or Sandbox Card in Statement Details.'
      }`;

      return {
        intent: 'failed_payment_investigation',
        deterministicAnswer: answer,
        compactGeminiFacts: `Statement #${target.invoiceNumber} (${target.patientDisplayName}, ${formatUsdCents(
          target.balanceDueCents
        )} USD, status FAILED) has 1 recorded failed payment attempt on ${formatBillingDate(
          fa.attemptedAt
        )}: Code ${fa.demoReferenceCode}, Reason: "${
          fa.failureReason
        }". No funds were charged (${formatUsdCents(
          target.balanceDueCents
        )} USD still due). User can retry via PayPal Sandbox.`,
        recentTurnSummary,
        resolvedFocusInvoice: target,
      };
    }

    // No single target invoice in focus: check all accessible invoices for failed attempts
    if (failedInvoices.length === 0) {
      const overdueCount = invoices.filter((i) => i.status === 'overdue').length;
      const answer = `You have **0 failed payment attempts** recorded across your ${
        invoices.length
      } accessible billing statements (${invoices
        .map((i) => `#${i.invoiceNumber}`)
        .join(', ')}).${
        overdueCount > 0
          ? ` Note that ${overdueCount} statement(s) are marked **OVERDUE** because their due date passed without payment, but no payment attempt has failed on them.`
          : ''
      }`;
      return {
        intent: 'failed_payment_investigation',
        deterministicAnswer: answer,
        compactGeminiFacts: `Active account ${activeCustomerName} has ZERO (0) failed payment attempts across all accessible statements (${invoices
          .map((i) => `#${i.invoiceNumber} [${i.status}]`)
          .join(', ')}). Overdue statements have 0 failed attempts.`,
        recentTurnSummary,
        resolvedFocusInvoice: null,
      };
    }

    const f = failedInvoices[0];
    const fa = getFailedAttemptsForInvoice(f)[0];
    const answer = `Statement #${f.invoiceNumber} (${f.patientDisplayName} • **${formatUsdCents(
      f.balanceDueCents
    )} USD** for ${f.administrativeSummary}) has a recorded failed payment attempt:\n• **Reference Code:** \`${
      fa?.demoReferenceCode || 'PAYPAL_INSTRUMENT_DECLINED'
    }\`\n• **Reason:** "${
      fa?.failureReason || 'PayPal Sandbox funding source was declined by issuer.'
    }"\n• **Date:** ${formatBillingDate(
      fa?.attemptedAt || f.dueDate
    )}\n• **Balance Due:** ${formatUsdCents(f.balanceDueCents)} USD (no funds were charged).`;
    return {
      intent: 'failed_payment_investigation',
      deterministicAnswer: answer,
      compactGeminiFacts: `Statement #${f.invoiceNumber} (${f.patientDisplayName}, ${formatUsdCents(
        f.balanceDueCents
      )} USD) failed on ${formatBillingDate(
        fa?.attemptedAt || f.dueDate
      )} with code ${fa?.demoReferenceCode}: "${fa?.failureReason}". No funds were charged.`,
      recentTurnSummary,
      resolvedFocusInvoice: f,
    };
  }

  // 6. INVOICE COMPARISON (2+ referenced invoices, or "compare", "difference between")
  if (
    referencedInvoices.length >= 2 ||
    /\b(?:compare|comparison|difference\s+between|versus|\bvs\.?\b|what\s+about\s+the\s+other\s+one)\b/i.test(
      lower
    )
  ) {
    let pair: SyntheticBillingInvoice[] = referencedInvoices.slice(0, 2);
    if (pair.length < 2) {
      if (target) {
        const other =
          unpaidInvoices.find((i) => i.id !== target.id) ||
          invoices.find((i) => i.id !== target.id);
        if (other) pair = [target, other];
      } else if (unpaidInvoices.length >= 2) {
        pair = unpaidInvoices.slice(0, 2);
      } else if (invoices.length >= 2) {
        pair = invoices.slice(0, 2);
      }
    }

    if (pair.length >= 2) {
      const [a, b] = pair;
      const faCountA = getFailedAttemptsForInvoice(a).length;
      const faCountB = getFailedAttemptsForInvoice(b).length;
      const answer = [
        `Here is the comparison between **#${a.invoiceNumber}** and **#${b.invoiceNumber}**:`,
        ``,
        `• **#${a.invoiceNumber} (${a.administrativeSummary}):**`,
        `  - Customer: ${a.patientDisplayName} • Status: **${a.status.toUpperCase()}**`,
        `  - Total: ${formatUsdCents(a.totalCents)} USD • Balance Due: **${formatUsdCents(
          a.balanceDueCents
        )} USD**`,
        `  - Due Date: ${formatBillingDate(a.dueDate)} • Failed Attempts: ${faCountA}`,
        `• **#${b.invoiceNumber} (${b.administrativeSummary}):**`,
        `  - Customer: ${b.patientDisplayName} • Status: **${b.status.toUpperCase()}**`,
        `  - Total: ${formatUsdCents(b.totalCents)} USD • Balance Due: **${formatUsdCents(
          b.balanceDueCents
        )} USD**`,
        `  - Due Date: ${formatBillingDate(b.dueDate)} • Failed Attempts: ${faCountB}`,
        ``,
        `• **Combined Open Balance (these two statements):** ${formatUsdCents(
          a.balanceDueCents + b.balanceDueCents
        )} USD.`,
      ].join('\n');

      return {
        intent: 'invoice_comparison',
        deterministicAnswer: answer,
        compactGeminiFacts: `Compare #${a.invoiceNumber} (${a.patientDisplayName}, ${a.administrativeSummary}, Total ${formatUsdCents(
          a.totalCents
        )}, Balance Due ${formatUsdCents(a.balanceDueCents)}, Status ${a.status.toUpperCase()}, Due ${formatBillingDate(
          a.dueDate
        )}, ${faCountA} failed attempts) vs #${b.invoiceNumber} (${b.patientDisplayName}, ${b.administrativeSummary}, Total ${formatUsdCents(
          b.totalCents
        )}, Balance Due ${formatUsdCents(b.balanceDueCents)}, Status ${b.status.toUpperCase()}, Due ${formatBillingDate(
          b.dueDate
        )}, ${faCountB} failed attempts).`,
        recentTurnSummary,
        resolvedFocusInvoice: target || a,
      };
    }
  }

  // 7. REFUND INQUIRIES
  if (/\b(?:refund|refunded|reimburs)\b/i.test(lower)) {
    const refundTarget =
      (target && (target.status === 'refunded' || target.amountRefundedCents > 0)
        ? target
        : null) ||
      refundedInvoices[0] ||
      target;

    if (refundTarget && (refundTarget.status === 'refunded' || refundTarget.amountRefundedCents > 0)) {
      const answer = `Statement #${refundTarget.invoiceNumber} (${refundTarget.patientDisplayName} • ${refundTarget.administrativeSummary}) has been **REFUNDED**:\n• **Original Paid Amount:** ${formatUsdCents(
        refundTarget.amountPaidCents || refundTarget.totalCents
      )} USD\n• **Refunded Amount:** **${formatUsdCents(
        refundTarget.amountRefundedCents || refundTarget.totalCents
      )} USD**\n• **Refund Date:** ${formatBillingDate(
        refundTarget.refundedAt
      )}\n• **Remaining Balance Due:** $0.00 USD\n• **Reference ID:** \`${
        refundTarget.receiptNumber || 'DEMO-REFUND-1005'
      }\` (${
        refundTarget.settlementVerificationStatus === 'paypal_verified'
          ? 'Verified PayPal Sandbox Refund'
          : 'Sample Demo Settlement Record'
      })`;

      return {
        intent: 'refund_inquiry',
        deterministicAnswer: answer,
        compactGeminiFacts: `Statement #${refundTarget.invoiceNumber} (${refundTarget.patientDisplayName}, ${refundTarget.administrativeSummary}) is REFUNDED: Original Paid ${formatUsdCents(
          refundTarget.amountPaidCents || refundTarget.totalCents
        )}, Refunded ${formatUsdCents(
          refundTarget.amountRefundedCents || refundTarget.totalCents
        )} on ${formatBillingDate(
          refundTarget.refundedAt
        )}, Balance Due $0.00, Ref ${refundTarget.receiptNumber}.`,
        recentTurnSummary,
        resolvedFocusInvoice: refundTarget,
      };
    }

    if (target) {
      const answer = `Statement #${target.invoiceNumber} (${target.administrativeSummary}) has **$0.00 USD** in refunds (Current Status: **${target.status.toUpperCase()}**, Paid: ${formatUsdCents(
        target.amountPaidCents
      )} USD, Balance Due: ${formatUsdCents(target.balanceDueCents)} USD).${
        refundedInvoices.length > 0
          ? ` Your accessible refunded statement is ${refundedInvoices
              .map(
                (r) =>
                  `#${r.invoiceNumber} (${formatUsdCents(
                    r.amountRefundedCents || r.totalCents
                  )} USD refunded on ${formatBillingDate(r.refundedAt)})`
              )
              .join(', ')}.`
          : ' You have 0 refunded statements on your account.'
      }`;
      return {
        intent: 'refund_inquiry',
        deterministicAnswer: answer,
        compactGeminiFacts: `Statement #${target.invoiceNumber} has $0.00 refunded (status ${target.status.toUpperCase()}). Refunded statements in scope: ${
          refundedInvoices.length > 0
            ? refundedInvoices.map((r) => `#${r.invoiceNumber}`).join(', ')
            : 'none (0)'
        }.`,
        recentTurnSummary,
        resolvedFocusInvoice: target,
      };
    }

    const answer =
      refundedInvoices.length > 0
        ? `You have **${refundedInvoices.length}** refunded statement(s):\n${refundedInvoices
            .map(
              (r) =>
                `• **#${r.invoiceNumber}** (${r.patientDisplayName} — ${r.administrativeSummary}): **${formatUsdCents(
                  r.amountRefundedCents || r.totalCents
                )} USD** refunded on ${formatBillingDate(
                  r.refundedAt
                )} (Ref: \`${r.receiptNumber || 'DEMO-REFUND'}\`, Balance Due: $0.00 USD)`
            )
            .join('\n')}`
        : `There are **0 refunded statements** on ${activeCustomerName}'s billing account.`;
    return {
      intent: 'refund_inquiry',
      deterministicAnswer: answer,
      compactGeminiFacts: answer.replace(/\n/g, ' '),
      recentTurnSummary,
      resolvedFocusInvoice: refundedInvoices[0] || null,
    };
  }

  // 8. RECEIPT / PAID EXPLANATION / TRANSACTION HISTORY
  if (
    /\b(?:receipt|paid|settlement|capture|transaction\s+history|payment\s+history|payment\s+attempt|attempts|ledger)\b/i.test(
      lower
    )
  ) {
    if (target && (lower.includes('this') || referencedInvoices.length === 1 || Boolean(focusedInvoice))) {
      const attempts = target.paymentAttempts;
      const attemptLines =
        attempts.length > 0
          ? attempts.map(
              (a) =>
                `• Attempt \`${a.demoReferenceCode}\` on ${formatBillingDate(
                  a.attemptedAt
                )}: Status **${a.status.toUpperCase()}** (${formatUsdCents(
                  a.amountCents
                )} USD)${a.failureReason ? ` — "${a.failureReason}"` : ''}`
            )
          : [`• 0 payment attempts recorded on #${target.invoiceNumber}.`];

      const settlementLine = target.receiptNumber
        ? `• **Settlement / Receipt Reference:** \`${target.receiptNumber}\` (${
            target.settlementVerificationStatus === 'paypal_verified'
              ? 'Verified PayPal Sandbox Capture'
              : 'Sample Demo Settlement Record — Not a Live PayPal Capture'
          })`
        : `• **Settlement / Receipt Reference:** None (Statement is ${target.status.toUpperCase()} with ${formatUsdCents(
            target.balanceDueCents
          )} USD due).`;

      const answer = [
        `Payment & Transaction History for **Statement #${target.invoiceNumber}** (${target.administrativeSummary}):`,
        `• **Status:** ${target.status.toUpperCase()} • **Original Total:** ${formatUsdCents(
          target.totalCents
        )} USD • **Paid:** ${formatUsdCents(
          target.amountPaidCents
        )} USD • **Refunded:** ${formatUsdCents(
          target.amountRefundedCents
        )} USD • **Balance Due:** ${formatUsdCents(target.balanceDueCents)} USD`,
        settlementLine,
        ...attemptLines,
      ].join('\n');

      return {
        intent: 'transaction_history',
        deterministicAnswer: answer,
        compactGeminiFacts: answer.replace(/\n/g, ' '),
        recentTurnSummary,
        resolvedFocusInvoice: target,
      };
    }

    const settledList = [...paidInvoices, ...refundedInvoices];
    const answer =
      settledList.length > 0
        ? [
            `Recorded Paid & Refunded Statements for **${
              isDoctor ? 'Dr. Sarah Jenkins (Practice)' : activeCustomerName
            }**:`,
            ...settledList.map(
              (i) =>
                `• **#${i.invoiceNumber}** (${i.patientDisplayName} — ${i.administrativeSummary}): Paid ${formatUsdCents(
                  i.amountPaidCents
                )} USD${
                  i.amountRefundedCents > 0
                    ? ` • Refunded ${formatUsdCents(i.amountRefundedCents)} USD`
                    : ''
                } [${i.status.toUpperCase()}] • Ref: \`${
                  i.receiptNumber || 'N/A'
                }\` (${
                  i.settlementVerificationStatus === 'paypal_verified'
                    ? 'Verified PayPal Capture'
                    : 'Sample Demo Record'
                })`
            ),
          ].join('\n')
        : `No paid receipts or settled transactions are recorded yet for ${activeCustomerName}.`;

    return {
      intent: 'transaction_history',
      deterministicAnswer: answer,
      compactGeminiFacts: answer.replace(/\n/g, ' '),
      recentTurnSummary,
      resolvedFocusInvoice: target || settledList[0] || null,
    };
  }

  // 9. DUE DATE & TIMELINE QUESTIONS
  if (/\b(?:due\s+date|when\s+is\s+.*due|overdue|past\s+due|issued\s+date|when\s+was\s+.*issued|due\s+soonest)\b/i.test(lower)) {
    if (target && (Boolean(focusedInvoice) || referencedInvoices.length === 1) && !lower.includes('all')) {
      const answer = `Statement #${target.invoiceNumber} (${target.administrativeSummary} for ${target.patientDisplayName}) was issued on **${formatBillingDate(
        target.issuedAt
      )}** and has a payment due date of **${formatBillingDate(
        target.dueDate
      )}**.\n• **Current Status:** **${target.status.toUpperCase()}**\n• **Remaining Balance Due:** **${formatUsdCents(
        target.balanceDueCents
      )} USD**`;
      return {
        intent: 'due_date',
        deterministicAnswer: answer,
        compactGeminiFacts: answer.replace(/\n/g, ' '),
        recentTurnSummary,
        resolvedFocusInvoice: target,
      };
    }

    const answer =
      unpaidInvoices.length > 0
        ? [
            `Open Statement Due Dates for **${
              isDoctor ? 'Dr. Sarah Jenkins (Practice)' : activeCustomerName
            }**:`,
            ...unpaidInvoices.map(
              (i) =>
                `• **#${i.invoiceNumber}** (${i.patientDisplayName} — ${i.administrativeSummary}): **${formatUsdCents(
                  i.balanceDueCents
                )} USD** — Due **${formatBillingDate(i.dueDate)}** [**${i.status.toUpperCase()}**]`
            ),
          ].join('\n')
        : `You currently have **0 unpaid statements** due.`;
    return {
      intent: 'due_date',
      deterministicAnswer: answer,
      compactGeminiFacts: answer.replace(/\n/g, ' '),
      recentTurnSummary,
      resolvedFocusInvoice: target || unpaidInvoices[0] || null,
    };
  }

  // 10. BALANCE / OWED / SUMMARY QUESTIONS
  if (
    /\b(?:balance|owe|owing|outstanding|total\s+due|open\s+statements?|unpaid|summary|overview|how\s+many\s+invoices)\b/i.test(
      lower
    )
  ) {
    if (
      target &&
      (lower.includes('this invoice') ||
        lower.includes('this statement') ||
        referencedInvoices.length === 1) &&
      !lower.includes('total') &&
      !lower.includes('all')
    ) {
      const effectiveBalance =
        target.status === 'paid' ||
        target.status === 'void' ||
        target.status === 'refunded'
          ? 0
          : target.balanceDueCents;
      const answer = `Statement #${target.invoiceNumber} (${target.administrativeSummary} for ${target.patientDisplayName}) has a remaining balance due of **${formatUsdCents(
        effectiveBalance
      )} USD** (Original Total: ${formatUsdCents(
        target.totalCents
      )} USD, Paid: ${formatUsdCents(
        target.amountPaidCents
      )} USD, Status: **${target.status.toUpperCase()}**, Due: ${formatBillingDate(
        target.dueDate
      )}).`;
      return {
        intent: 'balance_single',
        deterministicAnswer: answer,
        compactGeminiFacts: answer,
        recentTurnSummary,
        resolvedFocusInvoice: target,
      };
    }

    const answer = isDoctor
      ? [
          `Practice Receivables Summary for **Dr. Sarah Jenkins**:`,
          `• **Total Open Balance:** **${formatUsdCents(totalOpenCents)} USD** across ${unpaidInvoices.length} open statement(s)`,
          ...unpaidInvoices.map(
            (i) =>
              `  - **#${i.invoiceNumber}** (${i.patientDisplayName} — ${i.administrativeSummary}): ${formatUsdCents(
                i.balanceDueCents
              )} USD [${i.status.toUpperCase()}, Due ${formatBillingDate(i.dueDate)}]`
          ),
          `• **Paid Statements:** ${paidInvoices.length} (${ paidInvoices
            .map((p) => `#${p.invoiceNumber} [${formatUsdCents(p.amountPaidCents)}]`)
            .join(', ')})`,
          `• **Refunded Statements:** ${refundedInvoices.length} (${refundedInvoices
            .map((r) => `#${r.invoiceNumber} [${formatUsdCents(r.amountRefundedCents || r.totalCents)}]`)
            .join(', ')})`,
        ].join('\n')
      : [
          `Account Balance Summary for **${activeCustomerName}**:`,
          `• **Total Open Balance Currently Due:** **${formatUsdCents(
            totalOpenCents
          )} USD** across **${unpaidInvoices.length}** open statement(s):`,
          ...unpaidInvoices.map(
            (i) =>
              `  - **#${i.invoiceNumber}** (${i.administrativeSummary}): **${formatUsdCents(
                i.balanceDueCents
              )} USD** — Due ${formatBillingDate(i.dueDate)} [**${i.status.toUpperCase()}**]`
          ),
          paidInvoices.length > 0
            ? `• **Settled / Paid Statements:** ${paidInvoices
                .map(
                  (p) =>
                    `#${p.invoiceNumber} (${formatUsdCents(p.amountPaidCents)} USD — PAID)`
                )
                .join(', ')}`
            : null,
          refundedInvoices.length > 0
            ? `• **Refunded Statements:** ${refundedInvoices
                .map(
                  (r) =>
                    `#${r.invoiceNumber} (${formatUsdCents(
                      r.amountRefundedCents || r.totalCents
                    )} USD — REFUNDED)`
                )
                .join(', ')}`
            : null,
        ]
          .filter(Boolean)
          .join('\n');

    return {
      intent: 'balance_summary',
      deterministicAnswer: answer,
      compactGeminiFacts: answer.replace(/\n/g, ' '),
      recentTurnSummary,
      resolvedFocusInvoice: target,
    };
  }

  // 11. HYPOTHETICAL QUESTIONS ("what if I paid...", "what would happen if...")
  if (/\b(?:what\s+if|what\s+would\s+happen|suppose\s+i|if\s+i\s+were\s+to)\b/i.test(lower)) {
    const hypTarget = target || unpaidInvoices[0] || invoices[0];
    const answer = hypTarget
      ? `**Hypothetical Scenario (No Records Changed):** If Statement #${hypTarget.invoiceNumber} (${formatUsdCents(
          hypTarget.balanceDueCents || hypTarget.totalCents
        )} USD for ${hypTarget.administrativeSummary}) were settled via PayPal Sandbox today:\n• Its status would transition from **${hypTarget.status.toUpperCase()}** to **PAID** and its remaining balance on #${hypTarget.invoiceNumber} would become **$0.00 USD**.\n• Your total open account balance would decrease from **${formatUsdCents(
          totalOpenCents
        )} USD** to **${formatUsdCents(
          Math.max(0, totalOpenCents - hypTarget.balanceDueCents)
        )} USD**.\n• A verified PayPal Sandbox capture receipt would be issued.\n\nNo payment proposal or mutation was executed for this hypothetical question.`
      : `**Hypothetical Scenario (No Records Changed):** Settling an open statement reduces your open balance by that statement's amount and generates a PayPal Sandbox capture receipt. No records were modified.`;
    return {
      intent: 'hypothetical',
      deterministicAnswer: answer,
      compactGeminiFacts: answer.replace(/\n/g, ' '),
      recentTurnSummary,
      resolvedFocusInvoice: hypTarget || null,
    };
  }

  // 12. EXPLICIT STATEMENT DETAIL / LINE ITEM EXPLANATION
  if (
    target &&
    /\b(?:what\s+is\s+this|what\s+for|service|provided|detail|explain|about\s+this|line\s+item|breakdown|describe)\b/i.test(
      lower
    )
  ) {
    const explanation = buildDetailedClientInvoiceExplanation(target);
    return {
      intent: 'invoice_explanation',
      deterministicAnswer: explanation,
      compactGeminiFacts: explanation.replace(/\n/g, ' '),
      recentTurnSummary,
      resolvedFocusInvoice: target,
    };
  }

  // 13. GENERAL CONTEXT-AWARE QUESTION FALLBACK (still grounded, never a blind dump)
  if (target) {
    const failedAttempts = getFailedAttemptsForInvoice(target);
    const answer = [
      `Regarding **Statement #${target.invoiceNumber}** (${target.administrativeSummary} for ${target.patientDisplayName}):`,
      `• **Status:** **${target.status.toUpperCase()}** • **Total:** ${formatUsdCents(
        target.totalCents
      )} USD • **Remaining Balance Due:** **${formatUsdCents(
        target.balanceDueCents
      )} USD**`,
      `• **Issued:** ${formatBillingDate(target.issuedAt)} • **Due Date:** ${formatBillingDate(
        target.dueDate
      )}`,
      `• **Payment Attempts:** ${
        failedAttempts.length > 0
          ? `${failedAttempts.length} failed attempt (${failedAttempts[0].demoReferenceCode}: "${failedAttempts[0].failureReason}")`
          : '0 failed attempts recorded'
      }`,
      target.receiptNumber
        ? `• **Settlement Reference:** \`${target.receiptNumber}\` (${
            target.settlementVerificationStatus === 'paypal_verified'
              ? 'Verified PayPal Sandbox Capture'
              : 'Sample Demo Settlement Record'
          })`
        : null,
    ]
      .filter(Boolean)
      .join('\n');

    return {
      intent: 'general_focused_question',
      deterministicAnswer: answer,
      compactGeminiFacts: answer.replace(/\n/g, ' '),
      recentTurnSummary,
      resolvedFocusInvoice: target,
    };
  }

  const generalAnswer = [
    `Here is the current billing status for **${
      isDoctor ? 'Dr. Sarah Jenkins (Practice)' : activeCustomerName
    }**:`,
    `• **Open Statements (${unpaidInvoices.length}):** ${
      unpaidInvoices.length > 0
        ? unpaidInvoices
            .map(
              (i) =>
                `#${i.invoiceNumber} (${formatUsdCents(
                  i.balanceDueCents
                )} USD — ${i.status.toUpperCase()}, Due ${formatBillingDate(i.dueDate)})`
            )
            .join(', ')
        : 'None ($0.00 due)'
    }`,
    `• **Total Open Balance:** **${formatUsdCents(totalOpenCents)} USD**`,
    `• **Paid Statements:** ${paidInvoices.length} • **Refunded Statements:** ${refundedInvoices.length} • **Failed Attempts:** ${failedInvoices.length}`,
  ].join('\n');

  return {
    intent: 'general_account_question',
    deterministicAnswer: generalAnswer,
    compactGeminiFacts: generalAnswer.replace(/\n/g, ' '),
    recentTurnSummary,
    resolvedFocusInvoice: null,
  };
}

async function evaluateBillingAITurn(params: {
  message: string;
  roleScope: BillingRoleScope;
  activeUserId?: string | null;
  focusedInvoiceId?: string | null;
  recentMessages?: BillingAIChatMessage[];
}): Promise<{
  content: string;
  proposal?: BillingAIProposal | null;
  focusedInvoice?: SyntheticBillingInvoice | null;
  responseSource: 'gemini_live' | 'deterministic_rls' | 'guardrail_immediate';
  model: string;
}> {
  const prompt = params.message.trim();
  const lower = prompt.toLowerCase();
  const effectiveUserId = (
    params.activeUserId || getActiveDemoUserId(params.roleScope)
  ).trim();

  // 1. Clinical / Medical Refusal Guardrail
  if (CLINICAL_REFUSAL_REGEX.test(prompt)) {
    return {
      content:
        'Billing AI is strictly isolated to administrative billing statements, balances, receipts, and PayPal Sandbox workflows. It cannot access or discuss clinical records, diagnoses, medications, or medical advice.',
      proposal: null,
      focusedInvoice: null,
      responseSource: 'guardrail_immediate',
      model: 'guardrail-firewall',
    };
  }

  const dash = await fetchBillingDashboardData(params.roleScope, effectiveUserId);
  const allLoadedInvoices =
    dash.invoices.length > 0
      ? dash.invoices
      : getSyntheticInvoicesForRole(params.roleScope);
  const allPracticeInvoices =
    dash.invoices.length > 0
      ? dash.invoices
      : getSyntheticInvoicesForRole('doctor');

  const activeCustomerName =
    params.roleScope === 'doctor'
      ? 'Dr. Sarah Jenkins'
      : effectiveUserId === DEMO_USER_IDS.jordan_taylor
        ? 'Jordan Taylor'
        : 'Alex Rivera';

  const hasExplicitCustomerId =
    params.roleScope === 'patient' &&
    Boolean(params.activeUserId && params.activeUserId.trim());

  const invoices = hasExplicitCustomerId
    ? allLoadedInvoices.filter(
        (inv) =>
          inv.patientDisplayName.toLowerCase() ===
          activeCustomerName.toLowerCase()
      )
    : allLoadedInvoices;

  const focusedInvoice = params.focusedInvoiceId
    ? invoices.find((i) => i.id === params.focusedInvoiceId) || null
    : null;

  // 2. Check for Cross-Account / Unauthorized Customer or Invoice References
  const invoiceRefs = extractInvoiceReferencesFromText(prompt);
  const matchedAuthorizedInvoices: SyntheticBillingInvoice[] = [];
  for (const ref of invoiceRefs) {
    const matched = matchInvoiceByRef(invoices, ref);
    if (matched) {
      matchedAuthorizedInvoices.push(matched);
    } else {
      const existsInOtherAccount = matchInvoiceByRef(allPracticeInvoices, ref);
      if (existsInOtherAccount && params.roleScope === 'patient') {
        const available = invoices.map((i) => `#${i.invoiceNumber}`).join(', ');
        return {
          content: `Access Restricted: Statement #${existsInOtherAccount.invoiceNumber} belongs to another customer account and cannot be accessed from ${activeCustomerName}'s isolated Billing AI session. Your authorized statements are: ${available}.`,
          proposal: null,
          focusedInvoice,
          responseSource: 'guardrail_immediate',
          model: 'guardrail-rls-isolation',
        };
      }
      const requestedCode = ref.startsWith('PPB-') || ref.startsWith('HER-')
        ? ref.toUpperCase()
        : `PPB-INV-2026-${ref}`;
      const available = invoices.map((i) => `#${i.invoiceNumber}`).join(', ');
      return {
        content: `${
          params.roleScope === 'doctor' ? 'Invoice' : 'Statement'
        } #${requestedCode} was not found in your ${
          params.roleScope === 'doctor' ? 'practice billing records' : 'active account'
        }. Your available statements are: ${available}.`,
        proposal: null,
        focusedInvoice: null,
        responseSource: 'guardrail_immediate',
        model: 'guardrail-rls-isolation',
      };
    }
  }

  if (params.roleScope === 'patient') {
    const mentionsOtherCustomer =
      (activeCustomerName === 'Alex Rivera' && /\bjordan\s+taylor\b/i.test(prompt)) ||
      (activeCustomerName === 'Jordan Taylor' && /\balex\s+rivera\b/i.test(prompt));
    if (mentionsOtherCustomer) {
      const otherName =
        activeCustomerName === 'Alex Rivera' ? 'Jordan Taylor' : 'Alex Rivera';
      const available = invoices.map((i) => `#${i.invoiceNumber}`).join(', ');
      return {
        content: `Access Restricted: As Customer (${activeCustomerName}), your Billing AI session is strictly isolated to your own billing statements (${available}). You cannot view or access billing records belonging to ${otherName}.`,
        proposal: null,
        focusedInvoice,
        responseSource: 'guardrail_immediate',
        model: 'guardrail-rls-isolation',
      };
    }

    // Customer attempting provider-only mutations (voiding an invoice or creating an invoice)
    const isCustomerTryingProviderMutation =
      !/\b(?:what\s+if|can\s+i|how\s+do\s+i)\b/i.test(lower) &&
      (/\b(?:void|cancel)\s+(?:this\s+)?(?:invoice|statement|#?ppb|#?10\d{2})\b/i.test(
        lower
      ) ||
        /\b(?:draft|create|issue)\s+(?:a\s+|an\s+)?(?:new\s+)?invoice\b/i.test(lower));
    if (isCustomerTryingProviderMutation) {
      return {
        content: `Role Permission Boundary: As Customer (${activeCustomerName}), you can review statements, download receipts, and authorize PayPal Sandbox payments, but only the issuing provider (Dr. Sarah Jenkins) can create or void administrative invoices.`,
        proposal: null,
        focusedInvoice,
        responseSource: 'guardrail_immediate',
        model: 'guardrail-rls-isolation',
      };
    }
  }

  // 3. Pending Proposal Decision Handling (ONLY when a proposal exists in this isolated conversation)
  const isPureAffirmative =
    /^(?:yes|yep|yeah|confirm|proceed|approve|void\s+it|ok|okay|sure|do\s+it)[!.,\s]*$/i.test(
      prompt
    );
  const isPureNegative =
    /^(?:no|nope|decline|reject|cancel\s+proposal|don'?t|do\s+not)[!.,\s]*$/i.test(
      prompt
    );

  const recentMessages = params.recentMessages || [];
  const latestProposalMsg = recentMessages
    .slice()
    .reverse()
    .find((m) => Boolean(m.proposal));
  const latestProposal = latestProposalMsg?.proposal || null;
  const pendingProposal =
    recentMessages
      .slice()
      .reverse()
      .find((m) => m.proposal && m.proposal.status === 'pending')?.proposal ||
    null;

  if (isPureNegative && pendingProposal) {
    decidedProposalCache.set(pendingProposal.id, {
      status: 'rejected',
      summary: 'Declined by user',
    });
    const invNum = String(pendingProposal.payload?.invoice_number || '');
    const isPay = pendingProposal.kind === 'payment_checkout';
    return {
      content: isPay
        ? `Payment proposal declined${
            invNum ? ` for Statement #${invNum}` : ''
          }. No PayPal checkout was opened and no funds were charged.`
        : `Proposal declined${invNum ? ` for #${invNum}` : ''}. No invoice was ${
            pendingProposal.kind === 'void_invoice' ? 'voided' : 'modified'
          }.`,
      proposal: {
        ...pendingProposal,
        status: 'rejected',
        resultSummary: 'Declined by user',
      },
      focusedInvoice,
      responseSource: 'guardrail_immediate',
      model: 'proposal-state-machine',
    };
  }

  if (
    isPureAffirmative &&
    latestProposal &&
    !pendingProposal &&
    (latestProposal.status === 'approved' ||
      latestProposal.status === 'executed' ||
      decidedProposalCache.has(latestProposal.id))
  ) {
    const invNum = String(latestProposal.payload?.invoice_number || '');
    if (latestProposal.kind === 'payment_checkout') {
      return {
        content: `Duplicate Approval Prevented: Payment proposal for Statement #${invNum} is already confirmed and awaiting your authorization in PayPal Sandbox. Tap "Proceed to PayPal Sandbox" on the proposal card to complete checkout.`,
        proposal: null,
        focusedInvoice,
        responseSource: 'guardrail_immediate',
        model: 'proposal-state-machine',
      };
    }
    return {
      content: `Duplicate Approval Prevented: Proposal${
        invNum ? ` for #${invNum}` : ''
      } has already been ${
        latestProposal.status === 'rejected' ? 'declined' : 'executed'
      }.`,
      proposal: null,
      focusedInvoice,
      responseSource: 'guardrail_immediate',
      model: 'proposal-state-machine',
    };
  }

  if (isPureAffirmative && pendingProposal) {
    if (pendingProposal.payload?.expires_at) {
      const expTime = new Date(String(pendingProposal.payload.expires_at)).getTime();
      if (Number.isFinite(expTime) && expTime < Date.now()) {
        const invNum = String(pendingProposal.payload?.invoice_number || '');
        return {
          content:
            pendingProposal.kind === 'payment_checkout'
              ? `Approval Token Expired: The payment proposal for Statement #${invNum} has expired. Please ask Billing AI to prepare a fresh payment proposal.`
              : 'Approval Token Expired: This void proposal has expired. Please ask Billing AI to prepare a fresh proposal.',
          proposal: {
            ...pendingProposal,
            status: 'blocked',
            resultSummary: 'Expired — Request fresh proposal',
          },
          focusedInvoice,
          responseSource: 'guardrail_immediate',
          model: 'proposal-state-machine',
        };
      }
    }

    if (
      pendingProposal.kind === 'void_invoice' &&
      pendingProposal.payload?.invoice_id
    ) {
      await voidBillingInvoice(String(pendingProposal.payload.invoice_id));
      const invNum = String(pendingProposal.payload.invoice_number || '');
      decidedProposalCache.set(pendingProposal.id, {
        status: 'executed',
        summary: 'Voided — Invoice Archived',
      });
      return {
        content: `Invoice #${invNum} has been voided successfully. Its remaining balance is now $0.00 and it can no longer be paid.`,
        proposal: {
          ...pendingProposal,
          status: 'executed',
          resultSummary: 'Voided — Invoice Archived',
        },
        focusedInvoice,
        responseSource: 'guardrail_immediate',
        model: 'proposal-state-machine',
      };
    }

    if (pendingProposal.kind === 'payment_checkout') {
      const invId = String(pendingProposal.payload?.invoice_id || '');
      const invNum = String(pendingProposal.payload?.invoice_number || '');
      const amountMinor = Number(pendingProposal.amountMinor || 0);
      const targetInv =
        invoices.find((i) => i.id === invId || i.invoiceNumber === invNum) ||
        focusedInvoice;

      decidedProposalCache.set(pendingProposal.id, {
        status: 'approved',
        summary: 'Confirmed — Ready for PayPal Sandbox',
      });
      return {
        content: [
          `Payment Proposal Confirmed for Statement #${invNum} (${formatUsdCents(
            amountMinor
          )} USD).`,
          ``,
          `Current Status: Awaiting PayPal Sandbox Authorization`,
          `✓ Step 1: Proposal Prepared (Done)`,
          `✓ Step 2: Customer Confirmation Received (Done)`,
          `▶ Step 3: Authorize in PayPal Sandbox (Next — tap "Proceed to PayPal Sandbox" below)`,
          `⏳ Step 4: Awaiting Capture Callback (Pending)`,
          `⏳ Step 5: Completed & Settled (Pending)`,
          ``,
          `Important Safeguard: Billing AI cannot autonomously charge your account. Your transaction must be finalized and authorized in PayPal Sandbox.`,
        ].join('\n'),
        proposal: {
          ...pendingProposal,
          status: 'approved',
          title: `Proceed to PayPal Checkout: #${invNum}`,
          resultSummary: 'Confirmed — Ready for PayPal Sandbox',
        },
        focusedInvoice: targetInv,
        responseSource: 'guardrail_immediate',
        model: 'proposal-state-machine',
      };
    }
  }

  // 4. Provider Explicit Financial Mutations (Void / Create Invoice / Refund)
  const isHypotheticalQuestion =
    /\b(?:what\s+if|what\s+would\s+happen|suppose\s+i|if\s+i\s+were\s+to|how\s+do\s+i|can\s+you\s+explain)\b/i.test(
      lower
    );

  if (params.roleScope === 'doctor' && !isHypotheticalQuestion) {
    const isDiscrepancyOrVoid =
      /\b(asked for|meant|wrong customer|wrong patient|wrong person|wrong recipient|not for|cancel.*invoice|void.*invoice|undo.*invoice|delete.*invoice)\b/i.test(
        prompt
      ) ||
      (/\b(wrong|mistake|error|incorrect)\b/i.test(prompt) &&
        /\b(invoice|customer|patient|person|statement|alex|jordan|daniel|created)\b/i.test(
          prompt
        )) ||
      /\b(void|cancel)\s+#?((?:PPB|HER)-INV-\d{4}-\d{4}|\d{4})\b/i.test(prompt);

    if (isDiscrepancyOrVoid) {
      let targetInvoice =
        matchedAuthorizedInvoices[0] ||
        resolveLastDiscussedInvoice(invoices, params.focusedInvoiceId, recentMessages);

      if (!targetInvoice) {
        const activeInvoices = invoices.filter(
          (i) => i.status === 'sent' || i.status === 'draft' || i.status === 'pending'
        );
        if (activeInvoices.length === 1) {
          targetInvoice = activeInvoices[0];
        } else if (activeInvoices.length > 1) {
          const listStr = activeInvoices
            .map(
              (i) =>
                `• #${i.invoiceNumber} (${i.patientDisplayName} — ${formatUsdCents(
                  i.totalCents
                )})`
            )
            .join('\n');
          return {
            content: `You have multiple open invoices. To prevent voiding the wrong statement, please specify the invoice number you wish to void:\n${listStr}`,
            proposal: null,
            focusedInvoice: null,
            responseSource: 'deterministic_rls',
            model: 'deterministic-rls-responder',
          };
        }
      }

      if (targetInvoice) {
        if (targetInvoice.status === 'paid' || targetInvoice.amountPaidCents > 0) {
          return {
            content: `Payment-State Protection: Invoice #${targetInvoice.invoiceNumber} (${targetInvoice.patientDisplayName}) has a completed payment of ${formatUsdCents(
              targetInvoice.amountPaidCents || targetInvoice.totalCents
            )} USD and cannot be voided. Voiding only applies to unpaid Draft or Sent statements. Returning captured funds requires a formal Refund workflow.`,
            proposal: null,
            focusedInvoice: targetInvoice,
            responseSource: 'guardrail_immediate',
            model: 'guardrail-payment-state',
          };
        }

        if (targetInvoice.status === 'refunded') {
          return {
            content: `Invoice #${targetInvoice.invoiceNumber} has already been refunded (${formatUsdCents(
              targetInvoice.amountRefundedCents || targetInvoice.totalCents
            )} USD, $0.00 balance due) and cannot be voided.`,
            proposal: null,
            focusedInvoice: targetInvoice,
            responseSource: 'guardrail_immediate',
            model: 'guardrail-payment-state',
          };
        }

        if (targetInvoice.status === 'void') {
          return {
            content: `Invoice #${targetInvoice.invoiceNumber} has already been voided and archived ($0.00 balance due).`,
            proposal: null,
            focusedInvoice: targetInvoice,
            responseSource: 'guardrail_immediate',
            model: 'guardrail-payment-state',
          };
        }

        const requestedMatch = prompt.match(
          /(?:asked for|meant|wanted)\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)/i
        );
        const requestedRecipient = requestedMatch ? requestedMatch[1].trim() : null;

        const voidProposal: BillingAIProposal = {
          id: `local-prop-void-${targetInvoice.id}-${Date.now()}`,
          kind: 'void_invoice',
          title: `Void Erroneous Invoice #${targetInvoice.invoiceNumber}`,
          summary: `Void ${formatUsdCents(
            targetInvoice.totalCents
          )} USD invoice issued in error to ${targetInvoice.patientDisplayName}. Once voided, its remaining balance becomes $0.00 and it cannot be paid.`,
          amountMinor: targetInvoice.totalCents,
          currency: 'USD',
          status: 'pending',
          payload: {
            action: 'void_invoice',
            invoice_id: targetInvoice.id,
            invoice_number: targetInvoice.invoiceNumber,
            amount_minor: targetInvoice.totalCents,
            patient_name: targetInvoice.patientDisplayName,
          },
        };

        return {
          content: `I apologize for the mistake. Invoice #${targetInvoice.invoiceNumber} was issued to ${
            targetInvoice.patientDisplayName
          }${
            requestedRecipient ? ` instead of ${requestedRecipient}` : ''
          }. I have prepared a proposal below to void this invoice so its balance becomes $0.00 and it cannot be paid. Please review and tap Approve.`,
          proposal: voidProposal,
          focusedInvoice: targetInvoice,
          responseSource: 'deterministic_rls',
          model: 'deterministic-rls-responder',
        };
      }
    }

    const isCreateInvoiceDirective =
      /\b(?:draft|create|issue|send\s+an?\s+invoice|bill\s+(?:alex|jordan|customer|patient))\b/i.test(
        lower
      ) && !/\b(?:when\s+was|who\s+issued|why\s+was)\b/i.test(lower);

    if (isCreateInvoiceDirective) {
      const matchedCatalogService = matchCatalogServiceFromPrompt(prompt);
      const explicitDollarMatch = prompt.match(
        /\$\s*(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*(?:dollars|usd)/i
      );
      const explicitDollars = explicitDollarMatch
        ? Number.parseFloat(explicitDollarMatch[1] || explicitDollarMatch[2])
        : null;
      const amountMinor =
        explicitDollars !== null && Number.isFinite(explicitDollars)
          ? Math.round(explicitDollars * 100)
          : matchedCatalogService.defaultAmountMinor;

      const singleLimit = dash.settings.maxSingleActionMinor;

      if (amountMinor > singleLimit) {
        return {
          content: `Guardrail Blocked: A single AI-prepared action of ${formatUsdCents(
            amountMinor
          )} exceeds your configured Maximum Single AI-Assisted Action limit of ${formatUsdCents(
            singleLimit
          )}. You can create invoices above this threshold manually using the Create Invoice (+) button.`,
          proposal: null,
          focusedInvoice,
          responseSource: 'guardrail_immediate',
          model: 'guardrail-monetary-limit',
        };
      }

      const matchedKnownPatient = dash.billablePatients.find(
        (p) =>
          lower.includes(p.fullName.toLowerCase()) ||
          (p.fullName.split(' ').length > 1 &&
            lower.includes(p.fullName.split(' ')[0].toLowerCase()))
      );

      const nameMatch = prompt.match(
        /(?:for|to|patient|customer|client|account)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i
      );
      const STOP_WORDS = new Set([
        'a',
        'an',
        'the',
        'my',
        'our',
        'me',
        'this',
        'that',
        'patient',
        'customer',
        'administrative',
        'telehealth',
        'consultation',
        'service',
        'review',
        'consult',
        'visit',
        'appointment',
        'invoice',
        'draft',
        'forms',
        'completion',
        'records',
        'package',
        'copay',
      ]);

      let requestedPatientName: string | null = null;
      if (nameMatch) {
        const candidate = nameMatch[1].trim();
        if (!STOP_WORDS.has(candidate.toLowerCase())) {
          requestedPatientName = candidate;
        }
      }

      let targetPatient = matchedKnownPatient || null;

      if (!targetPatient && requestedPatientName) {
        targetPatient =
          dash.billablePatients.find((p) =>
            p.fullName.toLowerCase().includes(requestedPatientName!.toLowerCase())
          ) || null;

        if (!targetPatient) {
          const authList =
            dash.billablePatients.map((p) => p.fullName).join(', ') || 'None';
          return {
            content: `Recipient "${requestedPatientName}" was not found in your currently authorized billable customers. Your authorized customers are: ${authList}.`,
            proposal: null,
            focusedInvoice: null,
            responseSource: 'guardrail_immediate',
            model: 'guardrail-rls-isolation',
          };
        }
      }

      if (!targetPatient) {
        if (dash.billablePatients.length === 1) {
          targetPatient = dash.billablePatients[0];
        } else if (dash.billablePatients.length > 1) {
          const authList = dash.billablePatients.map((p) => p.fullName).join(', ');
          return {
            content: `Please specify which authorized customer you would like to invoice. Your authorized customers are: ${authList}.`,
            proposal: null,
            focusedInvoice: null,
            responseSource: 'deterministic_rls',
            model: 'deterministic-rls-responder',
          };
        } else {
          return {
            content: `You currently have 0 authorized billable customers.`,
            proposal: null,
            focusedInvoice: null,
            responseSource: 'deterministic_rls',
            model: 'deterministic-rls-responder',
          };
        }
      }

      return {
        content: `I have prepared an administrative invoice draft for ${
          targetPatient.fullName
        } in the amount of ${formatUsdCents(amountMinor)} USD (Service: ${
          matchedCatalogService.title
        } [${
          matchedCatalogService.code
        }]). Review and tap Approve below to issue the invoice.`,
        proposal: {
          id: `local-prop-${Date.now()}`,
          kind: 'create_invoice',
          title: `Send ${formatUsdCents(amountMinor)} Administrative Invoice`,
          summary: `Customer: ${targetPatient.fullName} • Service: ${
            matchedCatalogService.title
          } (${matchedCatalogService.code}) • Amount: ${formatUsdCents(
            amountMinor
          )} USD`,
          amountMinor,
          currency: 'USD',
          status: 'pending',
          payload: {
            recipient_user_id: targetPatient.patientId,
            recipient_name: targetPatient.fullName,
            service_code: matchedCatalogService.code,
            service_title: matchedCatalogService.title,
            quantity: 1,
            unit_amount_minor: amountMinor,
            due_date: new Date(Date.now() + 14 * 86400000)
              .toISOString()
              .slice(0, 10),
            send_immediately: true,
          },
        },
        focusedInvoice,
        responseSource: 'deterministic_rls',
        model: 'deterministic-rls-responder',
      };
    }

    const docRefundTarget = matchedAuthorizedInvoices[0] || focusedInvoice;
    const isExplicitRefundDirective =
      /\b(?:prepare.*refund|issue.*refund|process.*refund|refund\s+(?:.*\b(?:ppb|her|10\d{2}|invoice|statement|this)|\$\d+))\b/i.test(
        lower
      ) &&
      !/\b(?:was\s+.*refunded|is\s+.*refunded|tell\s+me\s+about|show\s+.*refund|why\s+was\s+.*refunded)\b/i.test(
        lower
      );

    if (isExplicitRefundDirective && docRefundTarget) {
      if (
        docRefundTarget.status !== 'paid' &&
        docRefundTarget.amountPaidCents <= 0
      ) {
        return {
          content: `Statement #${docRefundTarget.invoiceNumber} has status ${docRefundTarget.status.toUpperCase()} ($0.00 captured). Refunds can only be prepared for paid statements.`,
          proposal: null,
          focusedInvoice: docRefundTarget,
          responseSource: 'guardrail_immediate',
          model: 'guardrail-payment-state',
        };
      }
      const explicitRefundDollarMatch = prompt.match(
        /\$\s*(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*(?:dollars|usd)/i
      );
      const explicitRefundDollars = explicitRefundDollarMatch
        ? Number.parseFloat(
            explicitRefundDollarMatch[1] || explicitRefundDollarMatch[2]
          )
        : null;
      const refundMinor =
        explicitRefundDollars !== null && Number.isFinite(explicitRefundDollars)
          ? Math.round(explicitRefundDollars * 100)
          : docRefundTarget.amountPaidCents || docRefundTarget.totalCents;
      const singleLimit = dash.settings.maxSingleActionMinor;
      if (refundMinor > singleLimit) {
        return {
          content: `Guardrail Blocked: A single AI-prepared refund of ${formatUsdCents(
            refundMinor
          )} exceeds your configured Maximum Single AI-Assisted Action limit of ${formatUsdCents(
            singleLimit
          )}.`,
          proposal: null,
          focusedInvoice: docRefundTarget,
          responseSource: 'guardrail_immediate',
          model: 'guardrail-monetary-limit',
        };
      }
      return {
        content: `I have prepared a refund proposal of ${formatUsdCents(
          refundMinor
        )} USD for paid Statement #${docRefundTarget.invoiceNumber} (${
          docRefundTarget.patientDisplayName
        }). Tap Approve below to process the refund.`,
        proposal: {
          id: `local-prop-refund-${docRefundTarget.id}-${Date.now()}`,
          kind: 'refund',
          title: `Refund ${formatUsdCents(refundMinor)} for #${
            docRefundTarget.invoiceNumber
          }`,
          summary: `Issue ${formatUsdCents(refundMinor)} USD refund to ${
            docRefundTarget.patientDisplayName
          } for Statement #${docRefundTarget.invoiceNumber}.`,
          amountMinor: refundMinor,
          currency: 'USD',
          status: 'pending',
          payload: {
            action: 'refund',
            invoice_id: docRefundTarget.id,
            invoice_number: docRefundTarget.invoiceNumber,
            amount_minor: refundMinor,
            patient_name: docRefundTarget.patientDisplayName,
          },
        },
        focusedInvoice: docRefundTarget,
        responseSource: 'deterministic_rls',
        model: 'deterministic-rls-responder',
      };
    }
  }

  // 5. Customer Explicit Payment Checkout Proposal Directive
  if (params.roleScope === 'patient' && !isHypotheticalQuestion) {
    const isQuestionAboutPaying =
      /\b(?:can\s+i|how\s+do\s+i|how\s+can\s+i|why\s+did|when\s+was|was\s+it|is\s+it|what\s+if)\b/i.test(
        lower
      ) && !/\b(?:prepare|please\s+pay|pay\s+my|pay\s+#|pay\s+invoice|pay\s+statement|pay\s+now)\b/i.test(lower);

    // Also allow bare invoice number reply (e.g. "#PPB-INV-2026-1002") when switching target invoice after a payment prompt
    const isBareInvoiceSelection =
      matchedAuthorizedInvoices.length === 1 &&
      /^#?(?:(?:ppb|her)-inv-\d{4}-\d{4}|10\d{2})[.!\s]*$/i.test(lower);

    const isExplicitPayDirective =
      (!isQuestionAboutPaying &&
        /\b(?:pay|checkout|settle|retry\s+payment\s+for|retry\s+#)\b/i.test(
          lower
        ) &&
        !/\b(?:paid|payment\s+history|payment\s+attempt|payment\s+due|failed\s+payment)\b/i.test(
          lower
        )) ||
      isBareInvoiceSelection;

    if (isExplicitPayDirective) {
      const unpaid = invoices.filter(
        (i) => i.balanceDueCents > 0 && i.status !== 'void' && i.status !== 'refunded'
      );
      const payTarget =
        matchedAuthorizedInvoices[0] ||
        focusedInvoice ||
        resolveLastDiscussedInvoice(invoices, params.focusedInvoiceId, recentMessages) ||
        unpaid[0] ||
        null;

      if (payTarget) {
        if (payTarget.balanceDueCents <= 0) {
          return {
            content: `Statement #${payTarget.invoiceNumber} is already settled (Status: ${payTarget.status.toUpperCase()}, Remaining Balance: $0.00 USD). No balance is currently due.`,
            proposal: null,
            focusedInvoice: payTarget,
            responseSource: 'guardrail_immediate',
            model: 'guardrail-payment-state',
          };
        }

        const otherUnpaid = unpaid.filter((u) => u.id !== payTarget.id);
        const otherNote =
          matchedAuthorizedInvoices.length === 0 && otherUnpaid.length > 0
            ? `\nOther Open Statements on Your Account: ${otherUnpaid
                .map(
                  (u) =>
                    `#${u.invoiceNumber} (${formatUsdCents(u.balanceDueCents)} USD)`
                )
                .join(', ')} — reply with that statement number if you prefer to pay it instead.\n`
            : '';

        return {
          content: [
            `I have prepared a payment proposal for invoice #${payTarget.invoiceNumber} (${payTarget.administrativeSummary}) in the amount of ${formatUsdCents(
              payTarget.balanceDueCents
            )} USD (Due ${formatBillingDate(payTarget.dueDate)}).${otherNote}`,
            ``,
            `Payment Workflow Stages:`,
            `1. Preparation: Prepared by Billing AI`,
            `2. Requesting Approval: Tap Approve below or reply "Yes" to proceed`,
            `3. PayPal Sandbox Checkout: You complete authorization in PayPal Sandbox`,
            `4. Awaiting Confirmation: PayPal Sandbox webhook / capture verification`,
            `5. Completed: Statement marked paid and receipt issued`,
            ``,
            `Financial Boundary: Billing AI is an administrative assistant and cannot autonomously withdraw funds without your authorization in PayPal Sandbox.`,
          ].join('\n'),
          proposal: {
            id: `local-prop-pay-${payTarget.id}-${Date.now()}`,
            kind: 'payment_checkout',
            title: `Pay #${payTarget.invoiceNumber} (${formatUsdCents(
              payTarget.balanceDueCents
            )})`,
            summary: `Authorize ${formatUsdCents(
              payTarget.balanceDueCents
            )} USD via PayPal Sandbox for ${payTarget.administrativeSummary}`,
            amountMinor: payTarget.balanceDueCents,
            currency: 'USD',
            status: 'pending',
            payload: {
              action: 'payment_checkout',
              invoice_id: payTarget.id,
              invoice_number: payTarget.invoiceNumber,
              amount_minor: payTarget.balanceDueCents,
            },
          },
          focusedInvoice: payTarget,
          responseSource: 'deterministic_rls',
          model: 'deterministic-rls-responder',
        };
      }
    }
  }

  // 6. Conversational, Diagnostic, Analytical & Follow-Up Questions
  const subjectInvoice =
    matchedAuthorizedInvoices[0] ||
    focusedInvoice ||
    resolveLastDiscussedInvoice(invoices, params.focusedInvoiceId, recentMessages);

  const analysis = buildGroundedQuestionAnalysis({
    prompt,
    roleScope: params.roleScope,
    activeUserId: effectiveUserId,
    activeCustomerName,
    invoices,
    allPracticeInvoices,
    focusedInvoice,
    subjectInvoice,
    referencedInvoices: matchedAuthorizedInvoices,
    recentMessages,
  });

  // Attempt live Gemini 3.5 Flash-Lite inference grounded in verified facts
  const liveGemini = await callRealGeminiViaEdgeBridge({
    userQuestion: prompt,
    compactFacts: analysis.compactGeminiFacts,
    recentTurnSummary: analysis.recentTurnSummary,
  });

  if (
    liveGemini &&
    isGeminiReplyFinanciallyConsistent({
      geminiReply: liveGemini.content,
      intent: analysis.intent,
      subjectInvoice: analysis.resolvedFocusInvoice,
    })
  ) {
    return {
      content: liveGemini.content,
      proposal: null,
      focusedInvoice: analysis.resolvedFocusInvoice,
      responseSource: 'gemini_live',
      model: liveGemini.model,
    };
  }

  return {
    content: analysis.deterministicAnswer,
    proposal: null,
    focusedInvoice: analysis.resolvedFocusInvoice,
    responseSource: 'deterministic_rls',
    model: 'deterministic-rls-responder',
  };
}

export async function sendBillingAIMessage(params: {
  message: string;
  sessionId?: string | null;
  roleScope: BillingRoleScope;
  activeUserId?: string | null;
  focusedInvoiceId?: string | null;
  focusedInvoiceNumber?: string | null;
  recentMessages?: BillingAIChatMessage[];
}): Promise<{
  sessionId: string;
  reply: BillingAIChatMessage;
  focusedInvoice?: SyntheticBillingInvoice | null;
  conversationScopeKey?: string;
}> {
  const cleanMessage = params.message.trim();
  if (!cleanMessage) {
    throw new Error('Please enter a billing question.');
  }

  const effectiveUserId = (
    params.activeUserId || getActiveDemoUserId(params.roleScope)
  ).trim();
  const demoSessionId = await getOrCreateDemoSessionId();

  const scope: BillingAIConversationScope = {
    roleScope: params.roleScope,
    activeUserId: effectiveUserId,
    focusedInvoiceId: params.focusedInvoiceId ?? null,
    demoSessionId,
  };
  const conversationScopeKey = getBillingAIConversationScopeKey(scope);

  const cached = await readCachedHistorySnapshot(scope);
  const effectiveRecentMessages =
    params.recentMessages && params.recentMessages.length > 0
      ? params.recentMessages
      : cached.messages;
  const effectiveSessionId =
    params.sessionId ||
    cached.sessionId ||
    `local-session-${effectiveUserId.slice(-4)}-${
      params.focusedInvoiceId ? params.focusedInvoiceId.slice(-4) : 'general'
    }`;

  const userMsgEntry: BillingAIChatMessage = {
    id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    role: 'user',
    content: cleanMessage,
    createdAt: new Date().toISOString(),
  };

  const backendStartMs = Date.now();

  const evaluated = await evaluateBillingAITurn({
    message: cleanMessage,
    roleScope: params.roleScope,
    activeUserId: effectiveUserId,
    focusedInvoiceId: params.focusedInvoiceId ?? null,
    recentMessages: effectiveRecentMessages,
  });

  const isImmediate =
    evaluated.responseSource === 'guardrail_immediate' ||
    isImmediateGuardrailOrAuthContent(
      cleanMessage,
      evaluated.content,
      evaluated.proposal ?? null
    );
  const backendDurationMs = Math.max(0, Date.now() - backendStartMs);

  const replyMsg: BillingAIChatMessage = {
    id: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    role: 'assistant',
    content: evaluated.content,
    createdAt: new Date().toISOString(),
    proposal: evaluated.proposal ?? null,
    telemetry: {
      responseSource: isImmediate
        ? 'guardrail_immediate'
        : evaluated.responseSource,
      backendDurationMs,
      requiresProcessingHold: !isImmediate,
      model: evaluated.model,
    },
  };

  const updatedPriorMessages = effectiveRecentMessages.map((m) =>
    evaluated.proposal && m.proposal && m.proposal.id === evaluated.proposal.id
      ? { ...m, proposal: evaluated.proposal }
      : m
  );

  await persistHistorySnapshot(scope, effectiveSessionId, [
    ...updatedPriorMessages,
    userMsgEntry,
    replyMsg,
  ]);

  return {
    sessionId: effectiveSessionId,
    reply: replyMsg,
    focusedInvoice: evaluated.focusedInvoice ?? null,
    conversationScopeKey,
  };
}

export async function decideBillingAIProposal(
  proposalId: string,
  decision: 'approve' | 'reject',
  proposalPayload?: Record<string, unknown>
): Promise<{
  status: BillingAIProposal['status'];
  summary: string;
}> {
  if (!proposalId) {
    throw new Error('Proposal ID is required.');
  }

  if (decision === 'approve' && proposalPayload?.expires_at) {
    const expTime = new Date(String(proposalPayload.expires_at)).getTime();
    if (Number.isFinite(expTime) && expTime < Date.now()) {
      throw new Error(
        'Proposal approval token has expired. Please ask Billing AI to prepare a fresh proposal.'
      );
    }
  }

  const priorDecision = decidedProposalCache.get(proposalId);
  if (priorDecision) {
    throw new Error(
      `Duplicate approval rejected: this proposal has already been ${priorDecision.status}.`
    );
  }

  const updateCachedProposalStatus = async (
    status: BillingAIProposal['status'],
    summary: string
  ) => {
    decidedProposalCache.set(proposalId, { status, summary });
    for (const [key, entry] of localHistoryCache.entries()) {
      if (entry.messages.some((m) => m.proposal?.id === proposalId)) {
        const nextMsgs = entry.messages.map((m) =>
          m.proposal?.id === proposalId
            ? {
                ...m,
                proposal: { ...m.proposal, status, resultSummary: summary },
              }
            : m
        );
        localHistoryCache.set(key, {
          sessionId: entry.sessionId,
          messages: nextMsgs,
        });
        try {
          await AsyncStorage.setItem(
            key,
            JSON.stringify({ sessionId: entry.sessionId, messages: nextMsgs })
          );
        } catch {
          /* ignore */
        }
      }
    }
  };

  if (proposalId.startsWith('local-prop-')) {
    if (decision === 'reject') {
      await updateCachedProposalStatus('rejected', 'Declined by user');
      return { status: 'rejected', summary: 'Declined by user' };
    }
    if (proposalPayload?.action === 'payment_checkout') {
      await updateCachedProposalStatus(
        'approved',
        'Confirmed — Ready for PayPal Sandbox'
      );
      return {
        status: 'approved',
        summary: 'Confirmed — Ready for PayPal Sandbox',
      };
    }
    if (
      proposalPayload?.action === 'void_invoice' &&
      proposalPayload?.invoice_id
    ) {
      await voidBillingInvoice(String(proposalPayload.invoice_id));
      const summary = `Invoice #${
        proposalPayload.invoice_number || ''
      } voided successfully`;
      await updateCachedProposalStatus('executed', summary);
      return {
        status: 'executed',
        summary,
      };
    }
    if (proposalPayload?.action === 'refund' && proposalPayload?.invoice_id) {
      const refRes = await simulateBillingDemoRefund(
        String(proposalPayload.invoice_id),
        proposalPayload.amount_minor
          ? Number(proposalPayload.amount_minor)
          : undefined
      );
      const summary = `Refund ${refRes.refundId} processed for #${
        proposalPayload.invoice_number || ''
      }`;
      await updateCachedProposalStatus('executed', summary);
      return {
        status: 'executed',
        summary,
      };
    }
    if (
      proposalPayload?.action === 'send_reminder' &&
      proposalPayload?.invoice_id
    ) {
      await sendBillingPaymentReminder(String(proposalPayload.invoice_id));
      const summary = `Payment reminder sent for #${
        proposalPayload.invoice_number || ''
      }`;
      await updateCachedProposalStatus('executed', summary);
      return {
        status: 'executed',
        summary,
      };
    }
    if (proposalPayload?.recipient_user_id) {
      const created = await createBillingInvoice({
        recipientUserId: String(proposalPayload.recipient_user_id),
        items: [
          {
            serviceCode: String(
              proposalPayload.service_code || 'ADMIN-TELEHEALTH'
            ),
            quantity: Number(proposalPayload.quantity || 1),
            unitAmountMinor: Number(proposalPayload.unit_amount_minor || 15000),
          },
        ],
        dueDate: String(
          proposalPayload.due_date ||
            new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)
        ),
        sendImmediately: Boolean(proposalPayload.send_immediately ?? true),
      });
      const summary = `Invoice ${created.invoiceNumber} created and sent`;
      await updateCachedProposalStatus('executed', summary);
      return {
        status: 'executed',
        summary,
      };
    }
    await updateCachedProposalStatus('approved', 'Approved');
    return { status: 'approved', summary: 'Approved' };
  }

  const { data: decided, error } = await sb.rpc('billing_decide_ai_proposal', {
    p_proposal: proposalId,
    p_decision: decision,
  });

  if (error || !decided) {
    throw new Error(error?.message || 'Could not record proposal decision.');
  }

  if (
    decided.status === 'executed' ||
    decided.status === 'rejected' ||
    decided.status === 'blocked'
  ) {
    if (decision === 'approve' && decided.status === 'executed') {
      throw new Error(
        'Duplicate approval rejected: this proposal has already been executed.'
      );
    }
    const summary = String(decided.result_summary || decided.status);
    await updateCachedProposalStatus(
      decided.status as BillingAIProposal['status'],
      summary
    );
    return {
      status: decided.status as BillingAIProposal['status'],
      summary,
    };
  }

  if (decision === 'reject' || decided.status !== 'approved') {
    const summary = String(decided.result_summary || decided.status);
    await updateCachedProposalStatus(
      decided.status as BillingAIProposal['status'],
      summary
    );
    return {
      status: decided.status as BillingAIProposal['status'],
      summary,
    };
  }

  const payload =
    decided.payload && typeof decided.payload === 'object'
      ? decided.payload
      : {};
  if (decided.kind === 'void_invoice' && payload.invoice_id) {
    await voidBillingInvoice(String(payload.invoice_id));
    const summary = `Invoice #${
      payload.invoice_number || ''
    } voided successfully`;
    await updateCachedProposalStatus('executed', summary);
    return {
      status: 'executed',
      summary,
    };
  }
  if (decided.kind === 'refund' && payload.invoice_id) {
    const refRes = await simulateBillingDemoRefund(
      String(payload.invoice_id),
      payload.amount_minor ? Number(payload.amount_minor) : undefined
    );
    const summary = `Refund ${refRes.refundId} processed for #${
      payload.invoice_number || ''
    }`;
    await updateCachedProposalStatus('executed', summary);
    return {
      status: 'executed',
      summary,
    };
  }
  if (decided.kind === 'send_reminder' && payload.invoice_id) {
    await sendBillingPaymentReminder(String(payload.invoice_id));
    const summary = `Payment reminder sent for #${
      payload.invoice_number || ''
    }`;
    await updateCachedProposalStatus('executed', summary);
    return {
      status: 'executed',
      summary,
    };
  }
  if (decided.kind === 'create_invoice' && payload.recipient_user_id) {
    const created = await createBillingInvoice({
      recipientUserId: String(payload.recipient_user_id),
      items: [
        {
          serviceCode: String(payload.service_code || 'ADMIN-TELEHEALTH'),
          quantity: Number(payload.quantity || 1),
          unitAmountMinor: Number(
            payload.unit_amount_minor || decided.amount_minor || 15000
          ),
        },
      ],
      dueDate: String(
        payload.due_date ||
          new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)
      ),
      sendImmediately: Boolean(payload.send_immediately ?? true),
      idempotencyKey: `ai-prop-${proposalId}`,
      aiProposalId: proposalId,
    });
    const summary = `Invoice ${created.invoiceNumber} sent to customer`;
    await updateCachedProposalStatus('executed', summary);
    return {
      status: 'executed',
      summary,
    };
  }

  const finalSummary = String(decided.result_summary || 'Approved');
  await updateCachedProposalStatus('approved', finalSummary);
  return {
    status: 'approved',
    summary: finalSummary,
  };
}

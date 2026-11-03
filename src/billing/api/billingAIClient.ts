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
  fetchBillingDashboardData,
  getOrCreateDemoSessionId,
  sendBillingPaymentReminder,
  simulateBillingDemoRefund,
  voidBillingInvoice,
} from './billingService';

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

const sb = supabase as any;

const localHistoryCache = new Map<
  string,
  { sessionId: string; messages: BillingAIChatMessage[] }
>();
const decidedProposalCache = new Map<
  string,
  { status: BillingAIProposal['status']; summary: string }
>();

export function clearBillingAIClientCacheForTests(): void {
  localHistoryCache.clear();
  decidedProposalCache.clear();
}

async function resolveStorageCacheKey(roleScope: BillingRoleScope): Promise<string> {
  try {
    let uid = 'anon';
    if (typeof supabase.auth.getSession === 'function') {
      const { data } = await supabase.auth.getSession();
      uid = data?.session?.user?.id || 'anon';
    } else if (typeof supabase.auth.getUser === 'function') {
      const { data } = await supabase.auth.getUser();
      uid = data?.user?.id || 'anon';
    }
    return `@ppb_billing_ai_history_v1_${uid}_${roleScope}`;
  } catch {
    return `@ppb_billing_ai_history_v1_anon_${roleScope}`;
  }
}

async function persistHistorySnapshot(
  roleScope: BillingRoleScope,
  sessionId: string,
  messages: BillingAIChatMessage[]
): Promise<void> {
  const key = await resolveStorageCacheKey(roleScope);
  const trimmed = messages.slice(-60);
  localHistoryCache.set(key, { sessionId, messages: trimmed });
  try {
    await AsyncStorage.setItem(key, JSON.stringify({ sessionId, messages: trimmed }));
  } catch {
    /* non-fatal */
  }
}

async function readCachedHistorySnapshot(roleScope: BillingRoleScope): Promise<{
  sessionId: string | null;
  messages: BillingAIChatMessage[];
}> {
  const key = await resolveStorageCacheKey(roleScope);
  const mem = localHistoryCache.get(key);
  if (mem && mem.messages.length > 0) {
    return mem;
  }
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.messages) && parsed.messages.length > 0) {
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

function isImmediateGuardrailOrAuthContent(
  prompt: string,
  replyContent: string,
  proposal?: BillingAIProposal | null
): boolean {
  if (CLINICAL_REFUSAL_REGEX.test(prompt)) return true;
  if (
    /^(?:Guardrail Blocked|Payment-State Protection|Duplicate Approval Prevented|Approval Token Expired|Proposal declined|Payment proposal declined|Payment Proposal Confirmed)/i.test(
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

const CLINICAL_REFUSAL_REGEX =
  /\b(?:diagnos(?:is|es|e)|symptom|medication|prescri(?:be|ption)|dosage|blood\s+pressure|heart\s+rate|lab\s+result|radiology|x-?ray|mri|ct\s+scan|allergy|allergies|treatment\s+plan|clinical\s+note|health\s+log|doctor\s+log|medical\s+advice)\b/i;

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

export async function loadBillingAIHistory(roleScope: BillingRoleScope): Promise<{
  sessionId: string | null;
  messages: BillingAIChatMessage[];
}> {
  const cached = await readCachedHistorySnapshot(roleScope);
  try {
    if (!sb?.from) {
      return cached;
    }
    let userId: string | undefined;
    if (typeof supabase.auth.getSession === 'function') {
      const { data: sessData } = await supabase.auth.getSession();
      userId = sessData?.session?.user?.id;
    } else if (typeof supabase.auth.getUser === 'function') {
      const { data: authData } = await supabase.auth.getUser();
      userId = authData?.user?.id;
    }
    if (!userId) {
      return cached;
    }

    const { data: sessionRow } = await sb
      .from('billing_ai_sessions')
      .select('id')
      .eq('user_id', userId)
      .eq('role_scope', roleScope)
      .order('last_activity_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!sessionRow?.id) {
      return cached;
    }

    const [msgRes, propRes] = await Promise.all([
      sb
        .from('billing_ai_messages')
        .select('*')
        .eq('session_id', sessionRow.id)
        .order('created_at', { ascending: true })
        .limit(60),
      sb
        .from('billing_ai_proposals')
        .select('*')
        .eq('session_id', sessionRow.id)
        .order('created_at', { ascending: true }),
    ]);

    const propMap = new Map<string, BillingAIProposal>();
    for (const p of Array.isArray(propRes?.data) ? propRes.data : []) {
      const mapped = mapDbProposal(p);
      if (mapped) propMap.set(mapped.id, mapped);
    }

    const dbMessages: BillingAIChatMessage[] = (Array.isArray(msgRes?.data) ? msgRes.data : []).map(
      (m: any) => ({
        id: String(m.id),
        role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: String(m.content || ''),
        createdAt: String(m.created_at || new Date().toISOString()),
        proposal: m.proposal_id ? propMap.get(String(m.proposal_id)) ?? null : null,
      })
    );

    if (dbMessages.length === 0 && cached.messages.length > 0) {
      return cached;
    }

    const resolvedSessionId = String(sessionRow.id);
    await persistHistorySnapshot(roleScope, resolvedSessionId, dbMessages);

    return {
      sessionId: resolvedSessionId,
      messages: dbMessages,
    };
  } catch {
    return cached;
  }
}

async function buildDeterministicRlsBackedReply(params: {
  message: string;
  roleScope: BillingRoleScope;
  focusedInvoiceId?: string | null;
  recentMessages?: BillingAIChatMessage[];
}): Promise<{
  content: string;
  proposal?: BillingAIProposal | null;
  focusedInvoice?: SyntheticBillingInvoice | null;
}> {
  const prompt = params.message.trim();

  if (CLINICAL_REFUSAL_REGEX.test(prompt)) {
    return {
      content:
        'Billing AI is strictly isolated to administrative billing statements, balances, receipts, and PayPal Sandbox workflows. It cannot access or discuss clinical records, diagnoses, medications, or medical advice.',
      proposal: null,
      focusedInvoice: null,
    };
  }

  const dash = await fetchBillingDashboardData(params.roleScope);
  const invoices = dash.invoices.length > 0 ? dash.invoices : getSyntheticInvoicesForRole(params.roleScope);
  const lower = prompt.toLowerCase();

  if (params.roleScope === 'doctor') {
    const metrics = computeDoctorSummaryMetrics(invoices);
    const overdueList = invoices.filter((i) => i.status === 'overdue');
    const failedList = invoices.filter(
      (i) => i.status === 'failed' || i.paymentAttempts.some((a) => a.status === 'failed_demo')
    );

    const isAffirmative = /^(?:yes|yep|yeah|confirm|proceed|approve|void\s+it|ok|okay|sure|do\s+it)\b/i.test(prompt);
    const isNegative = /^(?:no|nope|decline|reject|cancel\s+proposal|don'?t|do\s+not)\b/i.test(prompt);
    const latestDocProp = params.recentMessages?.slice().reverse().find((m) => Boolean(m.proposal))?.proposal;
    const pendingVoidProp = params.recentMessages?.slice().reverse().find(
      (m) => m.proposal && m.proposal.kind === 'void_invoice' && m.proposal.status === 'pending'
    )?.proposal;

    if (isNegative && pendingVoidProp) {
      decidedProposalCache.set(pendingVoidProp.id, { status: 'rejected', summary: 'Declined by user' });
      const invNum = String(pendingVoidProp.payload?.invoice_number || '');
      return {
        content: `Proposal declined${invNum ? ` for #${invNum}` : ''}. No invoice was voided.`,
        proposal: {
          ...pendingVoidProp,
          status: 'rejected',
          resultSummary: 'Declined by user',
        },
      };
    }

    if (
      isAffirmative &&
      latestDocProp &&
      (latestDocProp.status === 'executed' ||
        latestDocProp.status === 'approved' ||
        decidedProposalCache.has(latestDocProp.id))
    ) {
      const invNum = String(latestDocProp.payload?.invoice_number || '');
      return {
        content: `Duplicate Approval Prevented: Proposal${invNum ? ` for #${invNum}` : ''} has already been ${
          latestDocProp.status === 'rejected' ? 'declined' : 'executed'
        }.`,
        proposal: null,
      };
    }

    if (isAffirmative && pendingVoidProp && pendingVoidProp.payload?.invoice_id) {
      if (pendingVoidProp.payload?.expires_at) {
        const expTime = new Date(String(pendingVoidProp.payload.expires_at)).getTime();
        if (Number.isFinite(expTime) && expTime < Date.now()) {
          return {
            content:
              'Approval Token Expired: This void proposal has expired. Please ask Billing AI to prepare a fresh proposal.',
            proposal: {
              ...pendingVoidProp,
              status: 'blocked',
              resultSummary: 'Expired — Request fresh proposal',
            },
          };
        }
      }
      await voidBillingInvoice(String(pendingVoidProp.payload.invoice_id));
      const invNum = String(pendingVoidProp.payload.invoice_number || '');
      decidedProposalCache.set(pendingVoidProp.id, {
        status: 'executed',
        summary: 'Voided — Invoice Archived',
      });
      return {
        content: `Invoice #${invNum} has been voided successfully. Its remaining balance is now $0.00 and it can no longer be paid.`,
        proposal: {
          ...pendingVoidProp,
          status: 'executed',
          resultSummary: 'Voided — Invoice Archived',
        },
      };
    }

    const isDiscrepancyOrVoid =
      /\b(asked for|meant|wrong customer|wrong patient|wrong person|wrong recipient|not for|cancel.*invoice|void.*invoice|undo.*invoice|delete.*invoice)\b/i.test(
        prompt
      ) ||
      (/\b(wrong|mistake|error|incorrect)\b/i.test(prompt) &&
        /\b(invoice|customer|patient|person|statement|alex|jordan|daniel|created)\b/i.test(prompt)) ||
      /\b(void|cancel)\s+#?((?:PPB|HER)-INV-\d{4}-\d{4}|\d{4})\b/i.test(prompt);

    if (isDiscrepancyOrVoid) {
      const explicitInvMatch = prompt.match(/#?((?:PPB|HER)-INV-\d{4}-\d{4}|\b\d{4}\b)/i);
      let targetInvoice = explicitInvMatch
        ? invoices.find(
            (i) =>
              i.invoiceNumber.toLowerCase().includes(explicitInvMatch[1].toLowerCase()) ||
              i.invoiceNumber.endsWith(explicitInvMatch[1])
          )
        : null;

      if (explicitInvMatch && !targetInvoice) {
        return {
          content: `Invoice #${explicitInvMatch[1].toUpperCase()} was not found in your practice billing records. No invoice was voided.`,
          proposal: null,
          focusedInvoice: null,
        };
      }

      if (!targetInvoice && params.recentMessages?.length) {
        for (let idx = params.recentMessages.length - 1; idx >= 0; idx--) {
          const msg = params.recentMessages[idx];
          if (msg.proposal?.payload?.invoice_id) {
            targetInvoice = invoices.find((i) => i.id === msg.proposal!.payload.invoice_id) || null;
            if (targetInvoice) break;
          }
          const prevMatch = msg.content.match(/#?((?:PPB|HER)-INV-\d{4}-\d{4})/i);
          if (prevMatch) {
            targetInvoice =
              invoices.find((i) => i.invoiceNumber.toLowerCase().includes(prevMatch[1].toLowerCase())) ||
              null;
            if (targetInvoice) break;
          }
        }
      }

      if (!targetInvoice && params.focusedInvoiceId) {
        targetInvoice = invoices.find((i) => i.id === params.focusedInvoiceId) || null;
      }

      if (!targetInvoice) {
        const activeInvoices = invoices.filter((i) => i.status === 'sent' || i.status === 'draft' || i.status === 'pending');
        if (activeInvoices.length === 1) {
          targetInvoice = activeInvoices[0];
        } else if (activeInvoices.length > 1) {
          const listStr = activeInvoices
            .map((i) => `• #${i.invoiceNumber} (${i.patientDisplayName} — ${formatUsdCents(i.totalCents)})`)
            .join('\n');
          return {
            content: `You have multiple open invoices. To prevent voiding the wrong statement, please specify the invoice number you wish to void:\n${listStr}`,
            proposal: null,
            focusedInvoice: null,
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
          };
        }

        if (targetInvoice.status === 'refunded') {
          return {
            content: `Invoice #${targetInvoice.invoiceNumber} has already been refunded (${formatUsdCents(
              targetInvoice.amountRefundedCents || targetInvoice.totalCents
            )} USD, $0.00 balance due) and cannot be voided.`,
            proposal: null,
            focusedInvoice: targetInvoice,
          };
        }

        if (targetInvoice.status === 'void') {
          return {
            content: `Invoice #${targetInvoice.invoiceNumber} has already been voided and archived ($0.00 balance due).`,
            proposal: null,
            focusedInvoice: targetInvoice,
          };
        }

        const requestedMatch = prompt.match(/(?:asked for|meant|wanted)\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)/i);
        const requestedRecipient = requestedMatch ? requestedMatch[1].trim() : null;

        const voidProposal: BillingAIProposal = {
          id: `local-prop-void-${targetInvoice.id}-${Date.now()}`,
          kind: 'void_invoice',
          title: `Void Erroneous Invoice #${targetInvoice.invoiceNumber}`,
          summary: `Void ${formatUsdCents(targetInvoice.totalCents)} USD invoice issued in error to ${targetInvoice.patientDisplayName}. Once voided, its remaining balance becomes $0.00 and it cannot be paid.`,
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
          content: `I apologize for the mistake. Invoice #${targetInvoice.invoiceNumber} was issued to ${targetInvoice.patientDisplayName}${
            requestedRecipient ? ` instead of ${requestedRecipient}` : ''
          }. I have prepared a proposal below to void this invoice so its balance becomes $0.00 and it cannot be paid. Please review and tap Approve.`,
          proposal: voidProposal,
          focusedInvoice: targetInvoice,
        };
      }
    }

    if (lower.includes('draft') || lower.includes('create') || lower.includes('issue')) {
      const matchedCatalogService = matchCatalogServiceFromPrompt(prompt);
      const explicitDollarMatch = prompt.match(/\$\s*(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*(?:dollars|usd)/i);
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
        };
      }

      const matchedKnownPatient = dash.billablePatients.find(
        (p) =>
          lower.includes(p.fullName.toLowerCase()) ||
          (p.fullName.split(' ').length > 1 && lower.includes(p.fullName.split(' ')[0].toLowerCase()))
      );

      const nameMatch = prompt.match(
        /(?:for|to|patient|customer|client|account)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i
      );
      const STOP_WORDS = new Set([
        'a', 'an', 'the', 'my', 'our', 'me', 'this', 'that',
        'patient', 'customer', 'administrative', 'telehealth', 'consultation',
        'service', 'review', 'consult', 'visit', 'appointment', 'invoice', 'draft',
        'forms', 'completion', 'records', 'package', 'copay'
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
          const authList = dash.billablePatients.map((p) => p.fullName).join(', ') || 'None';
          return {
            content: `Recipient "${requestedPatientName}" was not found in your currently authorized billable customers. Your authorized customers are: ${authList}.`,
            proposal: null,
            focusedInvoice: null,
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
          };
        } else {
          return {
            content: `You currently have 0 authorized billable customers.`,
            proposal: null,
            focusedInvoice: null,
          };
        }
      }

      return {
        content: `I have prepared an administrative invoice draft for ${
          targetPatient.fullName
        } in the amount of ${formatUsdCents(amountMinor)} USD (Service: ${
          matchedCatalogService.title
        } [${matchedCatalogService.code}]). Review and tap Approve below to issue the invoice.`,
        proposal: {
          id: `local-prop-${Date.now()}`,
          kind: 'create_invoice',
          title: `Send ${formatUsdCents(amountMinor)} Administrative Invoice`,
          summary: `Customer: ${targetPatient.fullName} • Service: ${matchedCatalogService.title} (${matchedCatalogService.code}) • Amount: ${formatUsdCents(
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
            due_date: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
            send_immediately: true,
          },
        },
      };
    }

    if (lower.includes('overdue')) {
      if (overdueList.length === 0) {
        return {
          content: 'You currently have 0 overdue invoices across your practice.',
        };
      }
      const lines = overdueList.map(
        (i) =>
          `• #${i.invoiceNumber} — ${i.patientDisplayName}: ${formatUsdCents(
            i.balanceDueCents
          )} (Due ${formatBillingDate(i.dueDate)})`
      );
      return {
        content: `You have ${overdueList.length} overdue invoice(s) totaling ${formatUsdCents(
          metrics.overdueBalanceCents
        )}:\n${lines.join('\n')}`,
      };
    }

    if (lower.includes('fail') || lower.includes('declin')) {
      if (failedList.length === 0) {
        return {
          content: 'No unsuccessful payment attempts are recorded on your current statements.',
        };
      }
      const lines = failedList.map((i) => {
        const reason = i.paymentAttempts[0]?.failureReason || 'Payment authorization not completed';
        return `• #${i.invoiceNumber} (${i.patientDisplayName}) — ${formatUsdCents(
          i.balanceDueCents
        )}: ${reason}`;
      });
      return {
        content: `Found ${failedList.length} statement(s) with unsuccessful payment attempts:\n${lines.join(
          '\n'
        )}`,
      };
    }

    const docExplicitMatch = prompt.match(/#?((?:PPB|HER)-INV-\d{4}-\d{4}|\b\d{4}\b)/i);
    const docFocusedInvoice =
      (docExplicitMatch
        ? invoices.find(
            (i) =>
              i.invoiceNumber.toLowerCase().includes(docExplicitMatch[1].toLowerCase()) ||
              i.invoiceNumber.endsWith(docExplicitMatch[1])
          )
        : null) ||
      (params.focusedInvoiceId ? invoices.find((i) => i.id === params.focusedInvoiceId) : null);

    if (lower.includes('refund') && docFocusedInvoice) {
      if (docFocusedInvoice.status !== 'paid' && docFocusedInvoice.amountPaidCents <= 0) {
        return {
          content: `Statement #${docFocusedInvoice.invoiceNumber} has status ${docFocusedInvoice.status.toUpperCase()} ($0.00 captured). Refunds can only be prepared for paid statements.`,
          proposal: null,
          focusedInvoice: docFocusedInvoice,
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
          : docFocusedInvoice.amountPaidCents || docFocusedInvoice.totalCents;
      const singleLimit = dash.settings.maxSingleActionMinor;
      if (refundMinor > singleLimit) {
        return {
          content: `Guardrail Blocked: A single AI-prepared refund of ${formatUsdCents(
            refundMinor
          )} exceeds your configured Maximum Single AI-Assisted Action limit of ${formatUsdCents(
            singleLimit
          )}.`,
          proposal: null,
          focusedInvoice: docFocusedInvoice,
        };
      }
      return {
        content: `I have prepared a refund proposal of ${formatUsdCents(
          refundMinor
        )} USD for paid Statement #${docFocusedInvoice.invoiceNumber} (${docFocusedInvoice.patientDisplayName}). Tap Approve below to process the refund.`,
        proposal: {
          id: `local-prop-refund-${docFocusedInvoice.id}-${Date.now()}`,
          kind: 'refund',
          title: `Refund ${formatUsdCents(refundMinor)} for #${docFocusedInvoice.invoiceNumber}`,
          summary: `Issue ${formatUsdCents(refundMinor)} USD refund to ${docFocusedInvoice.patientDisplayName} for Statement #${docFocusedInvoice.invoiceNumber}.`,
          amountMinor: refundMinor,
          currency: 'USD',
          status: 'pending',
          payload: {
            action: 'refund',
            invoice_id: docFocusedInvoice.id,
            invoice_number: docFocusedInvoice.invoiceNumber,
            amount_minor: refundMinor,
            patient_name: docFocusedInvoice.patientDisplayName,
          },
        },
        focusedInvoice: docFocusedInvoice,
      };
    }

    if (
      docFocusedInvoice &&
      (Boolean(docExplicitMatch) ||
        Boolean(params.focusedInvoiceId) ||
        /\b(what\s+is\s+this|what\s+for|when\s+were|service|provided|detail|explain|about\s+this|line\s+item|issued|paid|status)\b/i.test(
          prompt
        ))
    ) {
      return {
        content: buildDetailedClientInvoiceExplanation(docFocusedInvoice),
        proposal: null,
        focusedInvoice: docFocusedInvoice,
      };
    }

    return {
      content: [
        `Practice Billing Summary (Billing-only scope):`,
        `• Total Outstanding: ${formatUsdCents(metrics.outstandingBalanceCents)}`,
        `• Pending Invoices: ${metrics.pendingInvoicesCount} (${formatUsdCents(metrics.pendingBalanceCents)})`,
        `• Overdue Invoices: ${metrics.overdueInvoicesCount} (${formatUsdCents(metrics.overdueBalanceCents)})`,
        `• Paid Invoices: ${metrics.paidInvoicesCount} (${formatUsdCents(metrics.paidTotalCents)})`,
        `• Failed Attempts: ${metrics.failedPaymentsCount}`,
      ].join('\n'),
    };
  }

  // Customer role responses
  const pMetrics = computePatientSummaryMetrics(invoices);
  const unpaid = invoices.filter((i) => i.balanceDueCents > 0 && i.status !== 'void' && i.status !== 'refunded');
  const failed = invoices.filter(
    (i) => i.status === 'failed' || i.paymentAttempts.some((a) => a.status === 'failed_demo')
  );
  const paid = invoices.filter((i) => i.status === 'paid' || i.status === 'refunded');

  const invNumMatch = prompt.match(/#?((?:PPB|HER)-INV-\d{4}-\d{4}|\b\d{4}\b)/i);
  let targetInvoice =
    (invNumMatch
      ? invoices.find(
          (i) =>
            i.invoiceNumber.toLowerCase().includes(invNumMatch[1].toLowerCase()) ||
            i.invoiceNumber.endsWith(invNumMatch[1])
        )
      : null) ||
    (params.focusedInvoiceId ? invoices.find((i) => i.id === params.focusedInvoiceId) : null);

  if (invNumMatch && !targetInvoice) {
    const requestedNum = invNumMatch[1].toUpperCase();
    const available = invoices.map((i) => `#${i.invoiceNumber}`).join(', ');
    return {
      content: `Statement #${requestedNum} was not found on your active account. Your available statements are: ${available}. Please verify the statement number or select an invoice from your Billing list.`,
      proposal: null,
      focusedInvoice: null,
    };
  }

  if (!targetInvoice && params.recentMessages?.length) {
    for (let idx = params.recentMessages.length - 1; idx >= 0; idx--) {
      const msg = params.recentMessages[idx];
      if (msg.proposal?.payload?.invoice_id) {
        targetInvoice = invoices.find((i) => i.id === msg.proposal!.payload.invoice_id) || null;
        if (targetInvoice) break;
      }
      const prevMatch = msg.content.match(/#?((?:PPB|HER)-INV-\d{4}-\d{4}|\b\d{4}\b)/i);
      if (prevMatch) {
        targetInvoice =
          invoices.find(
            (i) =>
              i.invoiceNumber.toLowerCase().includes(prevMatch[1].toLowerCase()) ||
              i.invoiceNumber.endsWith(prevMatch[1])
          ) || null;
        if (targetInvoice) break;
      }
    }
  }

  if (!targetInvoice && unpaid.length > 0) {
    targetInvoice = unpaid[0];
  }

  const isAffirmative = /^(?:yes|yep|yeah|confirm|proceed|approve|pay|pay\s+now|ok|okay|sure|do\s+it)\b/i.test(prompt);
  const isNegative = /^(?:no|nope|decline|reject|cancel\s+proposal|don'?t|do\s+not)\b/i.test(prompt);
  const latestPatientProp = params.recentMessages?.slice().reverse().find((m) => Boolean(m.proposal))?.proposal;
  const pendingPayProp = params.recentMessages?.slice().reverse().find(
    (m) => m.proposal && m.proposal.kind === 'payment_checkout' && m.proposal.status === 'pending'
  )?.proposal;

  if (isNegative && pendingPayProp) {
    decidedProposalCache.set(pendingPayProp.id, { status: 'rejected', summary: 'Declined by user' });
    const invNum = String(pendingPayProp.payload?.invoice_number || targetInvoice?.invoiceNumber || '');
    return {
      content: `Payment proposal declined${invNum ? ` for Statement #${invNum}` : ''}. No PayPal checkout was opened and no funds were charged.`,
      proposal: {
        ...pendingPayProp,
        status: 'rejected',
        resultSummary: 'Declined by user',
      },
      focusedInvoice: targetInvoice,
    };
  }

  if (
    isAffirmative &&
    latestPatientProp &&
    latestPatientProp.kind === 'payment_checkout' &&
    (latestPatientProp.status === 'approved' ||
      latestPatientProp.status === 'executed' ||
      decidedProposalCache.get(latestPatientProp.id)?.status === 'approved') &&
    !pendingPayProp
  ) {
    const invNum = String(latestPatientProp.payload?.invoice_number || targetInvoice?.invoiceNumber || '');
    return {
      content: `Duplicate Approval Prevented: Payment proposal for Statement #${invNum} is already confirmed and awaiting your authorization in PayPal Sandbox. Tap "Proceed to PayPal Sandbox" on the proposal card to complete checkout.`,
      proposal: null,
      focusedInvoice: targetInvoice,
    };
  }

  if (isAffirmative && targetInvoice && targetInvoice.balanceDueCents > 0) {
    if (pendingPayProp?.payload?.expires_at) {
      const expTime = new Date(String(pendingPayProp.payload.expires_at)).getTime();
      if (Number.isFinite(expTime) && expTime < Date.now()) {
        return {
          content: `Approval Token Expired: The payment proposal for Statement #${targetInvoice.invoiceNumber} has expired. Please ask Billing AI to prepare a fresh payment proposal.`,
          proposal: {
            ...pendingPayProp,
            status: 'blocked',
            resultSummary: 'Expired — Request fresh proposal',
          },
          focusedInvoice: targetInvoice,
        };
      }
    }
    const proposalId = pendingPayProp?.id || `local-prop-pay-${targetInvoice.id}-${Date.now()}`;
    decidedProposalCache.set(proposalId, {
      status: 'approved',
      summary: 'Confirmed — Ready for PayPal Sandbox',
    });
    return {
      content: [
        `Payment Proposal Confirmed for Statement #${targetInvoice.invoiceNumber} (${formatUsdCents(
          targetInvoice.balanceDueCents
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
        id: proposalId,
        kind: 'payment_checkout',
        title: `Proceed to PayPal Checkout: #${targetInvoice.invoiceNumber}`,
        summary: `Ready for authorization: ${formatUsdCents(
          targetInvoice.balanceDueCents
        )} USD via PayPal Sandbox for ${targetInvoice.administrativeSummary}`,
        amountMinor: targetInvoice.balanceDueCents,
        currency: 'USD',
        status: 'approved',
        payload: {
          action: 'payment_checkout',
          invoice_id: targetInvoice.id,
          invoice_number: targetInvoice.invoiceNumber,
          amount_minor: targetInvoice.balanceDueCents,
        },
        resultSummary: 'Confirmed — Ready for PayPal Sandbox',
      },
      focusedInvoice: targetInvoice,
    };
  }

  if (
    targetInvoice &&
    !lower.includes('pay') &&
    !lower.includes('checkout') &&
    !lower.includes('settle') &&
    (Boolean(invNumMatch) ||
      Boolean(params.focusedInvoiceId) ||
      /\b(what\s+is\s+this|what\s+for|when\s+were|service|provided|detail|explain|about\s+this|line\s+item|issued)\b/i.test(
        prompt
      ))
  ) {
    return {
      content: buildDetailedClientInvoiceExplanation(targetInvoice),
      proposal: null,
      focusedInvoice: targetInvoice,
    };
  }

  if (
    lower.includes('pay') ||
    lower.includes('checkout') ||
    lower.includes('settle') ||
    (invNumMatch && targetInvoice)
  ) {
    if (targetInvoice) {
      if (targetInvoice.balanceDueCents <= 0) {
        return {
          content: `Statement #${targetInvoice.invoiceNumber} is already settled (Status: ${targetInvoice.status.toUpperCase()}, Remaining Balance: $0.00 USD). No balance is currently due.`,
          proposal: null,
          focusedInvoice: targetInvoice,
        };
      }

      const otherUnpaid = unpaid.filter((u) => u.id !== targetInvoice!.id);
      const otherNote =
        !invNumMatch && otherUnpaid.length > 0
          ? `\nOther Open Statements on Your Account: ${otherUnpaid
              .map((u) => `#${u.invoiceNumber} (${formatUsdCents(u.balanceDueCents)} USD)`)
              .join(', ')} — reply with that statement number if you prefer to pay it instead.\n`
          : '';

      return {
        content: [
          `I have prepared a payment proposal for invoice #${targetInvoice.invoiceNumber} (${targetInvoice.administrativeSummary}) in the amount of ${formatUsdCents(
            targetInvoice.balanceDueCents
          )} USD (Due ${formatBillingDate(targetInvoice.dueDate)}).${otherNote}`,
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
          id: `local-prop-pay-${targetInvoice.id}-${Date.now()}`,
          kind: 'payment_checkout',
          title: `Pay #${targetInvoice.invoiceNumber} (${formatUsdCents(targetInvoice.balanceDueCents)})`,
          summary: `Authorize ${formatUsdCents(targetInvoice.balanceDueCents)} USD via PayPal Sandbox for ${targetInvoice.administrativeSummary}`,
          amountMinor: targetInvoice.balanceDueCents,
          currency: 'USD',
          status: 'pending',
          payload: {
            action: 'payment_checkout',
            invoice_id: targetInvoice.id,
            invoice_number: targetInvoice.invoiceNumber,
            amount_minor: targetInvoice.balanceDueCents,
          },
        },
        focusedInvoice: targetInvoice,
      };
    }
  }

  if (lower.includes('fail') || lower.includes('why')) {
    if (failed.length === 0) {
      return {
        content: 'You have no failed payment attempts on your current statements.',
      };
    }
    const f = failed[0];
    return {
      content: `Statement #${f.invoiceNumber} (${formatUsdCents(
        f.balanceDueCents
      )}) has a recorded unsuccessful attempt: "${
        f.paymentAttempts[0]?.failureReason || 'Funding source authorization was not completed.'
      }" No funds were charged. You can retry payment from Invoice Details.`,
    };
  }

  if (lower.includes('receipt') || lower.includes('paid')) {
    if (paid.length === 0) {
      return {
        content: 'You do not have any paid receipts recorded yet.',
      };
    }
    const lines = paid.map(
      (i) =>
        `• #${i.invoiceNumber} — ${formatUsdCents(i.amountPaidCents)} (${i.status.toUpperCase()})${
          i.receiptNumber ? ` • Ref: ${i.receiptNumber}` : ''
        }`
    );
    return {
      content: `Your recorded payment & refund statements:\n${lines.join('\n')}`,
    };
  }

  const unpaidLines = unpaid.map(
    (i) =>
      `• #${i.invoiceNumber} (${i.administrativeSummary}): ${formatUsdCents(
        i.balanceDueCents
      )} — Due ${formatBillingDate(i.dueDate)} [${i.status.toUpperCase()}]`
  );

  return {
    content: [
      `You currently have ${pMetrics.unpaidInvoicesCount} unpaid statement(s) totaling ${formatUsdCents(
        pMetrics.amountCurrentlyDueCents
      )} USD${pMetrics.nextDueDate ? ` (next due ${formatBillingDate(pMetrics.nextDueDate)})` : ''}:`,
      ...unpaidLines,
    ].join('\n'),
  };
}

export async function sendBillingAIMessage(params: {
  message: string;
  sessionId?: string | null;
  roleScope: BillingRoleScope;
  focusedInvoiceId?: string | null;
  focusedInvoiceNumber?: string | null;
  recentMessages?: BillingAIChatMessage[];
}): Promise<{
  sessionId: string;
  reply: BillingAIChatMessage;
  focusedInvoice?: SyntheticBillingInvoice | null;
}> {
  const cleanMessage = params.message.trim();
  if (!cleanMessage) {
    throw new Error('Please enter a billing question.');
  }

  const cached = await readCachedHistorySnapshot(params.roleScope);
  const effectiveRecentMessages =
    params.recentMessages && params.recentMessages.length > 0
      ? params.recentMessages
      : cached.messages;
  const effectiveSessionId = params.sessionId || cached.sessionId || null;

  const userMsgEntry: BillingAIChatMessage = {
    id: `user-${Date.now()}`,
    role: 'user',
    content: cleanMessage,
    createdAt: new Date().toISOString(),
  };

  const backendStartMs = Date.now();

  try {
    const { data: sessData } =
      typeof sb?.auth?.getSession === 'function'
        ? await sb.auth.getSession()
        : { data: { session: null } };
    const hasAuthSession = Boolean(sessData?.session?.access_token);

    if (sb?.functions?.invoke && process.env.NODE_ENV !== 'test' && hasAuthSession) {
      const demoSessionId = await getOrCreateDemoSessionId();
      const { data, error } = await sb.functions.invoke('billing-ai-assistant', {
        body: {
          message: cleanMessage,
          sessionId: effectiveSessionId,
          roleScope: params.roleScope,
          focusedInvoiceId: params.focusedInvoiceId ?? null,
          focusedInvoiceNumber: params.focusedInvoiceNumber ?? null,
          demoSessionId,
        },
      });

      if (!error && data?.reply) {
        const resolvedSessionId = String(
          data.sessionId || effectiveSessionId || `local-session-${Date.now()}`
        );
        const mappedProposal = data.reply.proposal
          ? mapDbProposal(data.reply.proposal)
          : null;
        const replyContent = String(data.reply.content || '');
        const isImmediate = isImmediateGuardrailOrAuthContent(
          cleanMessage,
          replyContent,
          mappedProposal
        );
        const backendDurationMs = Math.max(0, Date.now() - backendStartMs);
        const replyMsg: BillingAIChatMessage = {
          id: String(data.reply.id || `ai-${Date.now()}`),
          role: 'assistant',
          content: replyContent,
          createdAt: String(data.reply.createdAt || new Date().toISOString()),
          proposal: mappedProposal,
          telemetry: {
            responseSource: isImmediate ? 'guardrail_immediate' : 'gemini_live',
            backendDurationMs,
            requiresProcessingHold: !isImmediate,
            model: String(data.model || 'gemini-3.5-flash-lite'),
          },
        };
        await persistHistorySnapshot(params.roleScope, resolvedSessionId, [
          ...effectiveRecentMessages,
          userMsgEntry,
          replyMsg,
        ]);
        return {
          sessionId: resolvedSessionId,
          reply: replyMsg,
          focusedInvoice: null,
        };
      }
    }
  } catch {
    // Fall through to deterministic RLS-backed billing responder
  }

  const fallback = await buildDeterministicRlsBackedReply({
    ...params,
    sessionId: effectiveSessionId,
    recentMessages: effectiveRecentMessages,
  } as any);
  const resolvedSessionId = effectiveSessionId || `local-session-${Date.now()}`;
  const isImmediate = isImmediateGuardrailOrAuthContent(
    cleanMessage,
    fallback.content,
    fallback.proposal ?? null
  );
  const backendDurationMs = Math.max(0, Date.now() - backendStartMs);
  const replyMsg: BillingAIChatMessage = {
    id: `ai-${Date.now()}`,
    role: 'assistant',
    content: fallback.content,
    createdAt: new Date().toISOString(),
    proposal: fallback.proposal ?? null,
    telemetry: {
      responseSource: isImmediate ? 'guardrail_immediate' : 'deterministic_rls',
      backendDurationMs,
      requiresProcessingHold: !isImmediate,
      model: 'deterministic-rls-responder',
    },
  };

  const updatedPriorMessages = effectiveRecentMessages.map((m) =>
    fallback.proposal && m.proposal && m.proposal.id === fallback.proposal.id
      ? { ...m, proposal: fallback.proposal }
      : m
  );

  await persistHistorySnapshot(params.roleScope, resolvedSessionId, [
    ...updatedPriorMessages,
    userMsgEntry,
    replyMsg,
  ]);

  return {
    sessionId: resolvedSessionId,
    reply: replyMsg,
    focusedInvoice: fallback.focusedInvoice ?? null,
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
    for (const scope of ['doctor', 'patient'] as const) {
      const snap = await readCachedHistorySnapshot(scope);
      if (snap.messages.some((m) => m.proposal?.id === proposalId)) {
        const nextMsgs = snap.messages.map((m) =>
          m.proposal?.id === proposalId
            ? { ...m, proposal: { ...m.proposal, status, resultSummary: summary } }
            : m
        );
        await persistHistorySnapshot(scope, snap.sessionId || `local-session-${Date.now()}`, nextMsgs);
      }
    }
  };

  if (proposalId.startsWith('local-prop-')) {
    if (decision === 'reject') {
      await updateCachedProposalStatus('rejected', 'Declined by user');
      return { status: 'rejected', summary: 'Declined by user' };
    }
    if (proposalPayload?.action === 'payment_checkout') {
      await updateCachedProposalStatus('approved', 'Confirmed — Ready for PayPal Sandbox');
      return { status: 'approved', summary: 'Confirmed — Ready for PayPal Sandbox' };
    }
    if (proposalPayload?.action === 'void_invoice' && proposalPayload?.invoice_id) {
      await voidBillingInvoice(String(proposalPayload.invoice_id));
      const summary = `Invoice #${proposalPayload.invoice_number || ''} voided successfully`;
      await updateCachedProposalStatus('executed', summary);
      return {
        status: 'executed',
        summary,
      };
    }
    if (proposalPayload?.action === 'refund' && proposalPayload?.invoice_id) {
      const refRes = await simulateBillingDemoRefund(
        String(proposalPayload.invoice_id),
        proposalPayload.amount_minor ? Number(proposalPayload.amount_minor) : undefined
      );
      const summary = `Refund ${refRes.refundId} processed for #${proposalPayload.invoice_number || ''}`;
      await updateCachedProposalStatus('executed', summary);
      return {
        status: 'executed',
        summary,
      };
    }
    if (proposalPayload?.action === 'send_reminder' && proposalPayload?.invoice_id) {
      await sendBillingPaymentReminder(String(proposalPayload.invoice_id));
      const summary = `Payment reminder sent for #${proposalPayload.invoice_number || ''}`;
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
            serviceCode: String(proposalPayload.service_code || 'ADMIN-TELEHEALTH'),
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

  if (decided.status === 'executed' || decided.status === 'rejected' || decided.status === 'blocked') {
    if (decision === 'approve' && decided.status === 'executed') {
      throw new Error('Duplicate approval rejected: this proposal has already been executed.');
    }
    const summary = String(decided.result_summary || decided.status);
    await updateCachedProposalStatus(decided.status as BillingAIProposal['status'], summary);
    return {
      status: decided.status as BillingAIProposal['status'],
      summary,
    };
  }

  if (decision === 'reject' || decided.status !== 'approved') {
    const summary = String(decided.result_summary || decided.status);
    await updateCachedProposalStatus(decided.status as BillingAIProposal['status'], summary);
    return {
      status: decided.status as BillingAIProposal['status'],
      summary,
    };
  }

  const payload = decided.payload && typeof decided.payload === 'object' ? decided.payload : {};
  if (decided.kind === 'void_invoice' && payload.invoice_id) {
    await voidBillingInvoice(String(payload.invoice_id));
    const summary = `Invoice #${payload.invoice_number || ''} voided successfully`;
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
    const summary = `Refund ${refRes.refundId} processed for #${payload.invoice_number || ''}`;
    await updateCachedProposalStatus('executed', summary);
    return {
      status: 'executed',
      summary,
    };
  }
  if (decided.kind === 'send_reminder' && payload.invoice_id) {
    await sendBillingPaymentReminder(String(payload.invoice_id));
    const summary = `Payment reminder sent for #${payload.invoice_number || ''}`;
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
          unitAmountMinor: Number(payload.unit_amount_minor || decided.amount_minor || 15000),
        },
      ],
      dueDate: String(
        payload.due_date || new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)
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

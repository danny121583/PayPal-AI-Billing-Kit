import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  AlertCircle,
  ArrowUpRight,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  CheckCircle2,
  XCircle,
} from 'lucide-react-native';
import { ChatComposer } from '../chat/ChatComposer';
import BillingModalShell from './BillingModalShell';
import type {
  BillingRoleScope,
  SyntheticBillingInvoice,
} from '../../src/billing/types';
import {
  sendBillingAIMessage,
  loadBillingAIHistory,
  decideBillingAIProposal,
  getBillingAIMinProcessingMs,
  clearBillingAIConversation,
  getBillingAIConversationScopeKey,
  getBillingAIConversationSnapshotSync,
  type BillingAIChatMessage,
  type BillingAIProposal,
} from '../../src/billing/api/billingAIClient';
import { getActiveDemoUserId } from '../../src/billing/api/billingService';

const DOCTOR_PROMPTS = [
  'Show me all overdue invoices.',
  'Which payments failed this week?',
  'Summarize my outstanding balance by status.',
  'Create a $35.00 forms completion invoice for Alex Rivera.',
];

const PATIENT_PROMPTS = [
  'What do I currently owe?',
  'Show my unpaid statements and due dates.',
  'Why did my earlier payment attempt fail?',
  'Pay my pending invoice.',
];

export interface BillingAIAssistantModalProps {
  visible: boolean;
  roleScope: BillingRoleScope;
  activeUserId?: string;
  focusedInvoice?: SyntheticBillingInvoice | null;
  invoices?: SyntheticBillingInvoice[];
  onClose: () => void;
  onDataChanged?: () => void;
  onOpenInvoice?: (invoice: SyntheticBillingInvoice) => void;
  minProcessingDurationMs?: number;
}

type UiMessage = BillingAIChatMessage & { status?: 'sending' | 'failed' };

/**
 * Strips any executable HTML/script payloads or raw HTML tags so untrusted
 * AI-generated content can never inject HTML or scripts on Web or Mobile.
 */
export function sanitizeUntrustedAiContent(raw: string): string {
  if (!raw) return '';
  return String(raw)
    .replace(/<\s*script[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, '[script-removed]')
    .replace(/<\s*(?:iframe|object|embed|style|link|meta)[^>]*>[\s\S]*?<\s*\/\s*(?:iframe|object|embed|style|link|meta)\s*>/gi, '')
    .replace(/<\s*(?:iframe|object|embed|script|img|svg|body|input|form)[^>]*\/?>/gi, '')
    .replace(/\bon[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript\s*:/gi, 'blocked:')
    .replace(/data\s*:\s*text\/html/gi, 'blocked:');
}

function renderInlineMarkdownText(
  rawText: string,
  baseStyle: any,
  boldStyle: any,
  codeStyle: any
): React.ReactNode {
  const safe = sanitizeUntrustedAiContent(rawText);
  const parts = safe.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  if (parts.length <= 1) {
    return safe;
  }
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <Text key={idx} style={[baseStyle, boldStyle]}>
          {part.slice(2, -2)}
        </Text>
      );
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <Text key={idx} style={[baseStyle, codeStyle]}>
          {part.slice(1, -1)}
        </Text>
      );
    }
    return <Text key={idx}>{part}</Text>;
  });
}

function FormattedAssistantMessage({
  content,
}: {
  content: string;
}) {
  const safeContent = sanitizeUntrustedAiContent(content);
  const lines = safeContent
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l, idx, arr) => !(l === '' && arr[idx - 1] === ''));

  return (
    <View style={styles.formattedContainer} testID="billing-ai-formatted-content">
      {lines.map((line, idx) => {
        if (!line) {
          return <View key={`sp-${idx}`} style={{ height: 4 }} />;
        }

        // 1. Markdown Heading (#, ##, ###) or Statement Header ("Statement #PPB-INV-... (PAID)")
        const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
        const statementTitleMatch = line.match(
          /^(Statement\s+#(?:PPB|HER)-INV-\d{4}-\d+)\s*\(([A-Z_]+)\)$/i
        );
        const summaryHeaderMatch = line.match(
          /^(Practice Billing Summary[^:]*:|Your recorded payment & refund statements:|Payment Workflow Stages:|Current Status:.*)$/i
        );

        if (statementTitleMatch) {
          const stmtTitle = statementTitleMatch[1];
          const stmtStatus = statementTitleMatch[2].toUpperCase();
          const isPaid = stmtStatus === 'PAID';
          const isOverdue = stmtStatus === 'OVERDUE' || stmtStatus === 'FAILED';
          const isRefunded = stmtStatus === 'REFUNDED';
          return (
            <View key={`stmt-${idx}`} style={styles.statementHeaderBanner}>
              <Text style={styles.statementHeaderTitle}>
                {stmtTitle} ({stmtStatus})
              </Text>
              <View
                style={[
                  styles.statementStatusBadge,
                  isPaid
                    ? styles.badgePaid
                    : isOverdue
                      ? styles.badgeOverdue
                      : isRefunded
                        ? styles.badgeRefunded
                        : styles.badgeNeutral,
                ]}
              >
                <Text
                  style={[
                    styles.statementStatusBadgeText,
                    isPaid
                      ? styles.badgePaidText
                      : isOverdue
                        ? styles.badgeOverdueText
                        : isRefunded
                          ? styles.badgeRefundedText
                          : styles.badgeNeutralText,
                  ]}
                >
                  {stmtStatus}
                </Text>
              </View>
            </View>
          );
        }

        if (headingMatch || summaryHeaderMatch) {
          const headingText = headingMatch ? headingMatch[2] : line;
          return (
            <Text key={`h-${idx}`} style={styles.markdownHeading}>
              {renderInlineMarkdownText(
                headingText,
                styles.markdownHeading,
                styles.inlineBold,
                styles.inlineCode
              )}
            </Text>
          );
        }

        // 2. Multi-segment Financial Summary line ("• Financial Summary: Original Total $125.00 USD • Paid $125.00 USD...")
        if (
          /^(?:[•\-*]\s*)?Financial Summary:/i.test(line) &&
          line.split('•').length >= 3
        ) {
          const cleanLine = line.replace(/^[•\-*]\s*/, '');
          const afterColon = cleanLine.replace(/^Financial Summary:\s*/i, '');
          const segments = afterColon
            .split('•')
            .map((s) => s.trim())
            .filter(Boolean);

          return (
            <View
              key={`fin-${idx}`}
              style={styles.financialSummaryCard}
              testID="billing-ai-financial-summary-card"
            >
              <Text style={styles.financialSummaryTitle}>Financial Summary:</Text>
              <View style={styles.financialSummaryGrid}>
                {segments.map((seg, sIdx) => (
                  <View key={`seg-${sIdx}`} style={styles.financialSummaryPill}>
                    <Text style={styles.financialSummaryPillText}>{seg}</Text>
                  </View>
                ))}
              </View>
            </View>
          );
        }

        // 3. Bullet item (•, -, *) or Step item (✓, ▶, ⏳, 1., 2.)
        const bulletMatch = line.match(/^([•\-*✓▶⏳]|\d+\.)\s+(.+)$/);
        if (bulletMatch) {
          const marker = bulletMatch[1];
          const body = bulletMatch[2];
          const kvMatch = body.match(
            /^([A-Za-z0-9][A-Za-z0-9\s/#()-]{1,42}):\s*(.*)$/
          );

          return (
            <View key={`li-${idx}`} style={styles.bulletRow}>
              <Text style={styles.bulletMarker}>
                {marker === '-' || marker === '*' ? '•' : marker}
              </Text>
              <Text style={styles.bulletText}>
                {kvMatch ? (
                  <>
                    <Text style={styles.inlineBold}>{kvMatch[1]}:</Text>
                    {kvMatch[2] ? (
                      <Text>
                        {' '}
                        {renderInlineMarkdownText(
                          kvMatch[2],
                          styles.bulletText,
                          styles.inlineBold,
                          styles.inlineCode
                        )}
                      </Text>
                    ) : null}
                  </>
                ) : (
                  renderInlineMarkdownText(
                    body,
                    styles.bulletText,
                    styles.inlineBold,
                    styles.inlineCode
                  )
                )}
              </Text>
            </View>
          );
        }

        // 4. Standard paragraph line
        return (
          <Text key={`p-${idx}`} style={styles.bubbleText}>
            {renderInlineMarkdownText(
              line,
              styles.bubbleText,
              styles.inlineBold,
              styles.inlineCode
            )}
          </Text>
        );
      })}
    </View>
  );
}

export default function BillingAIAssistantModal({
  visible,
  roleScope,
  activeUserId: propActiveUserId,
  focusedInvoice,
  invoices,
  onClose,
  onDataChanged,
  onOpenInvoice,
  minProcessingDurationMs,
}: BillingAIAssistantModalProps) {
  const effectiveUserId = (
    propActiveUserId || getActiveDemoUserId(roleScope)
  ).trim();
  const focusedInvoiceId = focusedInvoice?.id ?? null;
  const conversationScopeKey = getBillingAIConversationScopeKey({
    roleScope,
    activeUserId: effectiveUserId,
    focusedInvoiceId,
  });

  const [composerValue, setComposerValue] = useState('');
  const [messages, setMessages] = useState<UiMessage[]>(() => {
    const snap = getBillingAIConversationSnapshotSync({
      roleScope,
      activeUserId: effectiveUserId,
      focusedInvoiceId,
    });
    return snap.messages;
  });
  const [sessionId, setSessionId] = useState<string | null>(() => {
    const snap = getBillingAIConversationSnapshotSync({
      roleScope,
      activeUserId: effectiveUserId,
      focusedInvoiceId,
    });
    return snap.sessionId;
  });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFailedPrompt, setLastFailedPrompt] = useState<string | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [activeInvoice, setActiveInvoice] = useState<SyntheticBillingInvoice | null>(
    focusedInvoice ?? null
  );
  const scrollRef = useRef<ScrollView>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  const conversationVersionRef = useRef(0);
  const isDoctor = roleScope === 'doctor';

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      conversationVersionRef.current += 1;
      if (pendingTimerRef.current) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!visible) {
      conversationVersionRef.current += 1;
      if (pendingTimerRef.current) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
      setSending(false);
    }
  }, [visible]);

  // Isolate conversation state whenever visible, roleScope, activeUserId, or focusedInvoice changes
  useEffect(() => {
    conversationVersionRef.current += 1;
    const loadVersion = conversationVersionRef.current;

    if (pendingTimerRef.current) {
      clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
    setSending(false);
    setError(null);
    setLastFailedPrompt(null);
    setComposerValue('');
    setActiveInvoice(focusedInvoice ?? null);

    const syncSnap = getBillingAIConversationSnapshotSync({
      roleScope,
      activeUserId: effectiveUserId,
      focusedInvoiceId,
    });
    setSessionId(syncSnap.sessionId);
    setMessages(syncSnap.messages);

    if (!visible) return;

    let cancelled = false;
    loadBillingAIHistory({
      roleScope,
      activeUserId: effectiveUserId,
      focusedInvoiceId,
    })
      .then((res) => {
        if (
          cancelled ||
          !isMountedRef.current ||
          conversationVersionRef.current !== loadVersion ||
          !res
        ) {
          return;
        }
        setSessionId(res.sessionId);
        setMessages(res.messages);
      })
      .catch(() => {
        /* history is best-effort */
      });
    return () => {
      cancelled = true;
    };
  }, [
    conversationScopeKey,
    effectiveUserId,
    focusedInvoice,
    focusedInvoiceId,
    roleScope,
    visible,
  ]);

  const handleResetCurrentConversation = useCallback(async () => {
    conversationVersionRef.current += 1;
    if (pendingTimerRef.current) {
      clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
    setSending(false);
    setError(null);
    setLastFailedPrompt(null);
    setComposerValue('');
    setMessages([]);
    setActiveInvoice(focusedInvoice ?? null);
    await clearBillingAIConversation({
      roleScope,
      activeUserId: effectiveUserId,
      focusedInvoiceId,
    });
  }, [effectiveUserId, focusedInvoice, focusedInvoiceId, roleScope]);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, []);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || sending) return;
      const sendVersion = conversationVersionRef.current;
      const lockedFocusedInvoiceId = focusedInvoiceId ?? activeInvoice?.id ?? null;
      const lockedFocusedInvoiceNumber =
        focusedInvoice?.invoiceNumber ?? activeInvoice?.invoiceNumber ?? null;

      setError(null);
      setLastFailedPrompt(null);
      setComposerValue('');
      const localId = `local-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        {
          id: localId,
          role: 'user',
          content: text,
          createdAt: new Date().toISOString(),
          status: 'sending',
        },
      ]);
      setSending(true);
      scrollToEnd();

      const startedAtMs = Date.now();
      const targetMinHoldMs =
        minProcessingDurationMs !== undefined
          ? minProcessingDurationMs
          : getBillingAIMinProcessingMs();

      try {
        const res = await sendBillingAIMessage({
          message: text,
          sessionId,
          roleScope,
          activeUserId: effectiveUserId,
          focusedInvoiceId: lockedFocusedInvoiceId,
          focusedInvoiceNumber: lockedFocusedInvoiceNumber,
          recentMessages: messages,
        });

        // If user switched invoices, switched accounts, closed modal, or reset chat while awaiting:
        if (
          !isMountedRef.current ||
          conversationVersionRef.current !== sendVersion
        ) {
          return;
        }

        const elapsedMs = Math.max(0, Date.now() - startedAtMs);
        const shouldHold =
          res.reply?.telemetry?.requiresProcessingHold !== false &&
          targetMinHoldMs > elapsedMs;
        const remainingWaitMs = shouldHold ? targetMinHoldMs - elapsedMs : 0;

        if (remainingWaitMs > 0) {
          await new Promise<void>((resolve) => {
            pendingTimerRef.current = setTimeout(() => {
              pendingTimerRef.current = null;
              resolve();
            }, remainingWaitMs);
          });
        }

        if (
          !isMountedRef.current ||
          conversationVersionRef.current !== sendVersion
        ) {
          return;
        }

        const enrichedReply: BillingAIChatMessage = {
          ...res.reply,
          telemetry: res.reply.telemetry
            ? {
                ...res.reply.telemetry,
                totalTurnDurationMs: Math.max(0, Date.now() - startedAtMs),
              }
            : undefined,
        };

        setSessionId(res.sessionId);
        if (res.focusedInvoice && !focusedInvoiceId) {
          setActiveInvoice(res.focusedInvoice);
        }
        setMessages((prev) => [
          ...prev.map((m) => (m.id === localId ? { ...m, status: undefined } : m)),
          enrichedReply,
        ]);
        if (
          res.reply?.proposal?.status === 'approved' ||
          res.reply?.proposal?.status === 'executed'
        ) {
          onDataChanged?.();
        }
      } catch (e) {
        if (
          !isMountedRef.current ||
          conversationVersionRef.current !== sendVersion
        ) {
          return;
        }
        const msg = e instanceof Error ? e.message : String(e);
        setMessages((prev) =>
          prev.map((m) => (m.id === localId ? { ...m, status: 'failed' } : m))
        );
        setError(msg || 'Billing AI could not respond.');
        setLastFailedPrompt(text);
      } finally {
        if (
          isMountedRef.current &&
          conversationVersionRef.current === sendVersion
        ) {
          setSending(false);
          scrollToEnd();
        }
      }
    },
    [
      activeInvoice?.id,
      activeInvoice?.invoiceNumber,
      effectiveUserId,
      focusedInvoice?.invoiceNumber,
      focusedInvoiceId,
      messages,
      minProcessingDurationMs,
      onDataChanged,
      roleScope,
      scrollToEnd,
      sending,
      sessionId,
    ]
  );

  const handleRetry = useCallback(() => {
    if (!lastFailedPrompt) return;
    setMessages((prev) =>
      prev.filter((m) => !(m.status === 'failed' && m.content === lastFailedPrompt))
    );
    void send(lastFailedPrompt);
  }, [lastFailedPrompt, send]);

  const resolveProposalInvoice = useCallback(
    (proposal?: BillingAIProposal | null): SyntheticBillingInvoice | null => {
      const pid = proposal?.payload?.invoice_id
        ? String(proposal.payload.invoice_id)
        : null;
      const pnum = proposal?.payload?.invoice_number
        ? String(proposal.payload.invoice_number)
        : null;
      if ((pid || pnum) && Array.isArray(invoices)) {
        const matched = invoices.find(
          (i) => (pid && i.id === pid) || (pnum && i.invoiceNumber === pnum)
        );
        if (matched) return matched;
      }
      return activeInvoice || focusedInvoice || invoices?.[0] || null;
    },
    [activeInvoice, focusedInvoice, invoices]
  );

  const handleDecision = useCallback(
    async (proposal: BillingAIProposal, decision: 'approve' | 'reject') => {
      setDecidingId(proposal.id);
      try {
        const res = await decideBillingAIProposal(
          proposal.id,
          decision,
          proposal.payload
        );
        setMessages((prev) =>
          prev.map((m) =>
            m.proposal?.id === proposal.id
              ? {
                  ...m,
                  proposal: {
                    ...m.proposal,
                    status: res.status,
                    resultSummary: res.summary,
                  },
                }
              : m
          )
        );
        if (decision === 'approve') {
          onDataChanged?.();
          if (proposal.kind === 'payment_checkout') {
            const targetInv = resolveProposalInvoice(proposal);
            if (targetInv) {
              onOpenInvoice?.(targetInv);
            }
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setDecidingId(null);
      }
    },
    [onDataChanged, onOpenInvoice, resolveProposalInvoice]
  );

  if (!visible) return null;

  const prompts = isDoctor ? DOCTOR_PROMPTS : PATIENT_PROMPTS;

  return (
    <BillingModalShell
      visible={visible}
      onClose={onClose}
      title="Billing AI"
      subtitle={
        isDoctor
          ? 'Invoices, balances & payments for your practice'
          : 'Your statements, balances, payments & receipts'
      }
      scroll={false}
      testID="billing-ai-assistant-modal"
      closeTestID="billing-ai-close-btn"
      closeAccessibilityLabel="Close Billing AI"
      footer={
        <ChatComposer
          value={composerValue}
          onChangeText={setComposerValue}
          onSend={() => void send(composerValue)}
          sending={sending}
          placeholder="Ask Billing AI anything..."
          testID="billing-ai-chat-input"
          sendTestID="billing-ai-chat-send"
          accessibilityLabel="Ask Billing AI anything"
          sendAccessibilityLabel="Send message to Billing AI"
          paddingLeft={0}
          paddingRight={0}
        />
      }
    >
      <View style={styles.topMetaRow}>
        <View style={styles.isolationRow} testID="billing-ai-isolation-banner">
          <ShieldCheck size={13} color="#065F46" strokeWidth={2.4} />
          <Text style={styles.isolationText} numberOfLines={2}>
            Billing data only — sensitive customer notes are never sent to PayPal.
          </Text>
        </View>

        <View style={styles.contextChipsRow}>
          {activeInvoice ? (
            <Pressable
              style={styles.focusChip}
              onPress={() => onOpenInvoice?.(activeInvoice)}
              accessibilityRole="button"
              accessibilityLabel={`Open focused statement ${activeInvoice.invoiceNumber}`}
              testID="billing-ai-focused-invoice-chip"
            >
              <Text style={styles.focusChipText} numberOfLines={1}>
                Invoice #{activeInvoice.invoiceNumber}
              </Text>
              {onOpenInvoice ? (
                <ArrowUpRight size={12} color="#3730A3" />
              ) : null}
            </Pressable>
          ) : null}

          {messages.length > 0 ? (
            <Pressable
              style={styles.newChatChip}
              onPress={() => void handleResetCurrentConversation()}
              accessibilityRole="button"
              accessibilityLabel="Start new chat for this statement"
              testID="billing-ai-new-chat-btn"
            >
              <RotateCcw size={11} color="#475569" />
              <Text style={styles.newChatChipText}>New Chat</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.messages}
        contentContainerStyle={styles.messagesContent}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
        showsVerticalScrollIndicator
        onContentSizeChange={scrollToEnd}
        testID="billing-ai-messages"
      >
        {messages.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyHeader}>
              <Sparkles size={15} color="#D97706" />
              <Text style={styles.emptyTitle}>How can I help with billing?</Text>
            </View>
            <View style={styles.promptList}>
              {prompts.map((p, i) => (
                <Pressable
                  key={p}
                  style={styles.promptChip}
                  onPress={() => void send(p)}
                  accessibilityRole="button"
                  accessibilityLabel={`Ask: ${p}`}
                  testID={`billing-ai-prompt-${i}`}
                >
                  <Text style={styles.promptChipText}>{p}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : (
          messages.map((m) => (
            <View
              key={m.id}
              style={[
                styles.bubble,
                m.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant,
              ]}
              testID={`billing-ai-msg-${m.role}`}
            >
              {m.role === 'user' ? (
                <Text style={[styles.bubbleText, styles.bubbleTextUser]}>
                  {sanitizeUntrustedAiContent(m.content)}
                </Text>
              ) : (
                <FormattedAssistantMessage content={m.content} />
              )}

              {m.status === 'failed' ? (
                <Text style={styles.failedTag}>Not sent</Text>
              ) : null}
              {m.proposal ? (
                <View
                  style={styles.proposalCard}
                  testID={`billing-ai-proposal-${m.proposal.id}`}
                >
                  <Text style={styles.proposalTitle}>{m.proposal.title}</Text>
                  <Text style={styles.proposalBody}>{m.proposal.summary}</Text>
                  {m.proposal.status === 'pending' ? (
                    <View style={styles.proposalActions}>
                      <Pressable
                        style={[styles.proposalBtn, styles.proposalReject]}
                        onPress={() => void handleDecision(m.proposal!, 'reject')}
                        disabled={decidingId === m.proposal.id}
                        accessibilityRole="button"
                        testID={`billing-ai-proposal-reject-${m.proposal.id}`}
                      >
                        <Text style={styles.proposalRejectText}>Decline</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.proposalBtn, styles.proposalApprove]}
                        onPress={() => void handleDecision(m.proposal!, 'approve')}
                        disabled={decidingId === m.proposal.id}
                        accessibilityRole="button"
                        testID={`billing-ai-proposal-approve-${m.proposal.id}`}
                      >
                        {decidingId === m.proposal.id ? (
                          <ActivityIndicator color="#FFFFFF" size="small" />
                        ) : (
                          <Text style={styles.proposalApproveText}>Approve</Text>
                        )}
                      </Pressable>
                    </View>
                  ) : (
                    <View>
                      <View style={styles.proposalStatusRow}>
                        {m.proposal.status === 'approved' ||
                        m.proposal.status === 'executed' ? (
                          <CheckCircle2 size={14} color="#059669" />
                        ) : (
                          <XCircle size={14} color="#6B7280" />
                        )}
                        <Text style={styles.proposalStatusText}>
                          {m.proposal.resultSummary || m.proposal.status}
                        </Text>
                      </View>
                      {m.proposal.kind === 'payment_checkout' &&
                      (m.proposal.status === 'approved' ||
                        m.proposal.status === 'executed') ? (
                        <Pressable
                          style={[
                            styles.proposalBtn,
                            styles.proposalApprove,
                            { marginTop: 8 },
                          ]}
                          onPress={() => {
                            const targetInv = resolveProposalInvoice(m.proposal);
                            if (targetInv) {
                              onOpenInvoice?.(targetInv);
                            }
                          }}
                          accessibilityRole="button"
                          accessibilityLabel="Proceed to PayPal Sandbox"
                          testID={`billing-ai-proceed-paypal-${m.proposal.id}`}
                        >
                          <Text style={styles.proposalApproveText}>
                            Proceed to PayPal Sandbox
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                  )}
                </View>
              ) : null}
            </View>
          ))
        )}

        {sending ? (
          <View
            style={[styles.bubble, styles.bubbleAssistant, styles.typingRow]}
            accessibilityRole="progressbar"
            accessibilityLiveRegion="polite"
            accessibilityLabel="Preparing your response"
            testID="billing-ai-typing"
          >
            <ActivityIndicator size="small" color="#D97706" />
            <View style={{ flex: 1 }}>
              <Text style={styles.typingText}>Preparing your response…</Text>
              <Text style={styles.typingSubtext}>
                Checking authorized billing records & guardrails
              </Text>
            </View>
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorBox} testID="billing-ai-error">
            <AlertCircle size={15} color="#B91C1C" />
            <Text style={styles.errorText}>{error}</Text>
            {lastFailedPrompt ? (
              <Pressable
                style={styles.retryBtn}
                onPress={handleRetry}
                accessibilityRole="button"
                testID="billing-ai-retry"
              >
                <RotateCcw size={13} color="#B91C1C" />
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </BillingModalShell>
  );
}

const styles = StyleSheet.create({
  topMetaRow: {
    gap: 6,
    marginBottom: 8,
  },
  isolationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  isolationText: {
    fontSize: 11,
    lineHeight: 15,
    color: '#065F46',
    fontWeight: '600',
    flex: 1,
  },
  focusChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  focusChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#3730A3',
  },
  contextChipsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  newChatChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  newChatChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  messages: {
    flex: 1,
  },
  messagesContent: {
    gap: 10,
    paddingBottom: 12,
  },
  emptyState: {
    gap: 10,
  },
  emptyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
  },
  promptList: {
    gap: 8,
  },
  promptChip: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  promptChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1F2937',
  },
  bubble: {
    borderRadius: 16,
    paddingHorizontal: 13,
    paddingVertical: 11,
    overflow: 'hidden',
  },
  bubbleUser: {
    alignSelf: 'flex-end',
    maxWidth: '86%',
    backgroundColor: '#F59E0B',
  },
  bubbleAssistant: {
    alignSelf: 'stretch',
    maxWidth: '98%',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  bubbleText: {
    fontSize: 13,
    lineHeight: 19,
    color: '#0F172A',
  },
  bubbleTextUser: {
    fontSize: 14,
    lineHeight: 20,
    color: '#FFFFFF',
    fontWeight: '500',
  },
  formattedContainer: {
    gap: 6,
  },
  statementHeaderBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 6,
    paddingBottom: 7,
    marginBottom: 2,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  statementHeaderTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
    flexShrink: 1,
  },
  statementStatusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  badgePaid: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  badgePaidText: {
    color: '#047857',
  },
  badgeOverdue: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  badgeOverdueText: {
    color: '#B91C1C',
  },
  badgeRefunded: {
    backgroundColor: '#F5F3FF',
    borderColor: '#DDD6FE',
  },
  badgeRefundedText: {
    color: '#6D28D9',
  },
  badgeNeutral: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  badgeNeutralText: {
    color: '#B45309',
  },
  statementStatusBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  markdownHeading: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 2,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    paddingLeft: 2,
  },
  bulletMarker: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '700',
    color: '#EA580C',
    minWidth: 12,
  },
  bulletText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    color: '#1E293B',
  },
  inlineBold: {
    fontWeight: '700',
    color: '#0F172A',
  },
  inlineCode: {
    fontFamily: 'monospace',
    fontSize: 12,
    backgroundColor: '#E2E8F0',
    color: '#0F172A',
    paddingHorizontal: 4,
    borderRadius: 4,
  },
  financialSummaryCard: {
    marginTop: 4,
    padding: 9,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 6,
  },
  financialSummaryTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  financialSummaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  financialSummaryPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 7,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  financialSummaryPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
  },
  telemetryFooter: {
    marginTop: 6,
    paddingTop: 5,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E2E8F0',
    flexDirection: 'row',
    alignItems: 'center',
  },
  telemetryText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#64748B',
  },
  failedTag: {
    fontSize: 11,
    color: '#FEE2E2',
    marginTop: 4,
    fontWeight: '700',
  },
  typingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
  },
  typingText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  typingSubtext: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    padding: 10,
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    color: '#991B1B',
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  retryText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#B91C1C',
  },
  proposalCard: {
    marginTop: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#FDE68A',
    gap: 6,
  },
  proposalTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#92400E',
  },
  proposalBody: {
    fontSize: 13,
    color: '#374151',
    lineHeight: 18,
  },
  proposalActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  proposalBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  proposalReject: {
    backgroundColor: '#F3F4F6',
  },
  proposalRejectText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1F2937',
  },
  proposalApprove: {
    backgroundColor: '#F59E0B',
  },
  proposalApproveText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  proposalStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  proposalStatusText: {
    fontSize: 12,
    color: '#374151',
    fontWeight: '600',
    flex: 1,
  },
});

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
  type BillingAIChatMessage,
  type BillingAIProposal,
} from '../../src/billing/api/billingAIClient';

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
  focusedInvoice?: SyntheticBillingInvoice | null;
  invoices?: SyntheticBillingInvoice[];
  onClose: () => void;
  onDataChanged?: () => void;
  onOpenInvoice?: (invoice: SyntheticBillingInvoice) => void;
}

type UiMessage = BillingAIChatMessage & { status?: 'sending' | 'failed' };

export default function BillingAIAssistantModal({
  visible,
  roleScope,
  focusedInvoice,
  invoices,
  onClose,
  onDataChanged,
  onOpenInvoice,
}: BillingAIAssistantModalProps) {
  const [composerValue, setComposerValue] = useState('');
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFailedPrompt, setLastFailedPrompt] = useState<string | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [activeInvoice, setActiveInvoice] = useState<SyntheticBillingInvoice | null>(
    focusedInvoice ?? null
  );
  const scrollRef = useRef<ScrollView>(null);
  const isDoctor = roleScope === 'doctor';

  useEffect(() => {
    if (focusedInvoice) {
      setActiveInvoice(focusedInvoice);
    }
  }, [focusedInvoice]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    loadBillingAIHistory(roleScope)
      .then((res) => {
        if (cancelled || !res) return;
        setSessionId(res.sessionId);
        setMessages((prev) => (prev.length === 0 ? res.messages : prev));
      })
      .catch(() => {
        /* history is best-effort */
      });
    return () => {
      cancelled = true;
    };
  }, [visible, roleScope]);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, []);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || sending) return;
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
      try {
        const res = await sendBillingAIMessage({
          message: text,
          sessionId,
          roleScope,
          focusedInvoiceId: activeInvoice?.id ?? focusedInvoice?.id ?? null,
          focusedInvoiceNumber:
            activeInvoice?.invoiceNumber ?? focusedInvoice?.invoiceNumber ?? null,
          recentMessages: messages,
        });
        setSessionId(res.sessionId);
        if (res.focusedInvoice) {
          setActiveInvoice(res.focusedInvoice);
        }
        setMessages((prev) => [
          ...prev.map((m) => (m.id === localId ? { ...m, status: undefined } : m)),
          res.reply,
        ]);
        if (
          res.reply?.proposal?.status === 'approved' ||
          res.reply?.proposal?.status === 'executed'
        ) {
          onDataChanged?.();
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setMessages((prev) =>
          prev.map((m) => (m.id === localId ? { ...m, status: 'failed' } : m))
        );
        setError(msg || 'Billing AI could not respond.');
        setLastFailedPrompt(text);
      } finally {
        setSending(false);
        scrollToEnd();
      }
    },
    [
      activeInvoice?.id,
      focusedInvoice?.id,
      messages,
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
          : 'Your statements, payments & receipts'
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
      <View style={styles.isolationRow} testID="billing-ai-isolation-banner">
        <ShieldCheck size={14} color="#065F46" strokeWidth={2.4} />
        <Text style={styles.isolationText}>
          Billing data only — sensitive customer notes are never sent to PayPal.
        </Text>
      </View>

      {activeInvoice ? (
        <View style={styles.focusChip} testID="billing-ai-focused-invoice-chip">
          <Text style={styles.focusChipText} numberOfLines={1}>
            Invoice #{activeInvoice.invoiceNumber}
          </Text>
        </View>
      ) : null}

      <ScrollView
        ref={scrollRef}
        style={styles.messages}
        contentContainerStyle={styles.messagesContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
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
              <Text
                style={[
                  styles.bubbleText,
                  m.role === 'user' && styles.bubbleTextUser,
                ]}
              >
                {m.content}
              </Text>
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
            testID="billing-ai-typing"
          >
            <ActivityIndicator size="small" color="#D97706" />
            <Text style={styles.typingText}>Billing AI is thinking…</Text>
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
  isolationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  isolationText: {
    fontSize: 12,
    color: '#065F46',
    fontWeight: '600',
    flex: 1,
  },
  focusChip: {
    alignSelf: 'flex-start',
    backgroundColor: '#EEF2FF',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 8,
  },
  focusChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#3730A3',
  },
  messages: {
    flex: 1,
  },
  messagesContent: {
    gap: 10,
    paddingBottom: 8,
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
    maxWidth: '88%',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleUser: {
    alignSelf: 'flex-end',
    backgroundColor: '#F59E0B',
  },
  bubbleAssistant: {
    alignSelf: 'flex-start',
    backgroundColor: '#F3F4F6',
  },
  bubbleText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#111827',
  },
  bubbleTextUser: {
    color: '#FFFFFF',
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
    gap: 8,
  },
  typingText: {
    fontSize: 13,
    color: '#6B7280',
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

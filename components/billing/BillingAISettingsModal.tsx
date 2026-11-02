import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Switch,
} from 'react-native';
import {
  Lock,
  CheckCircle2,
  AlertTriangle,
  History,
} from 'lucide-react-native';
import type { BillingRoleScope } from '../../src/billing/types';
import {
  updateBillingAISettings,
  type BillingAISettingsRecord,
  type BillingAuditEventItem,
  type PayPalAccountConnectionSummary,
} from '../../src/billing/api/billingService';
import BillingModalShell, { billingModalStyles } from './BillingModalShell';

export interface BillingAISettingsModalProps {
  visible: boolean;
  roleScope: BillingRoleScope;
  initialSettings: BillingAISettingsRecord;
  connection: PayPalAccountConnectionSummary | null;
  auditEvents: BillingAuditEventItem[];
  onSettingsUpdated: (next: BillingAISettingsRecord) => void;
  onConnectionChanged: () => void;
  onClose: () => void;
}

const SINGLE_ACTION_OPTIONS = [10000, 25000, 50000]; // $100, $250, $500 (cap)
const DAILY_TOTAL_OPTIONS = [50000, 100000, 250000]; // $500, $1000, $2500 (cap)

const HUMAN_READABLE_AUDIT_LABELS: Record<string, string> = {
  organization_seeded: 'Practice Organization Initialized',
  invoice_created: 'Invoice Created & Sent to Customer',
  invoice_draft_created: 'Draft Invoice Saved',
  invoice_sent: 'Draft Invoice Sent to Customer',
  invoice_voided: 'Invoice Voided ($0.00 Balance)',
  invoice_refunded: 'PayPal Refund Processed',
  paypal_order_created: 'PayPal Sandbox Checkout Order Created',
  paypal_order_captured: 'PayPal Sandbox Payment Captured',
  paypal_account_connected: 'PayPal Sandbox Account Linked',
  paypal_account_disconnected: 'PayPal Sandbox Account Disconnected',
  ai_proposal_created: 'Billing AI Action Proposal Prepared',
  ai_proposal_approved: 'Billing AI Proposal Approved by User',
  ai_proposal_rejected: 'Billing AI Proposal Declined by User',
  ai_settings_updated: 'Billing AI Guardrails & Preferences Updated',
  webhook_received: 'PayPal Sandbox Webhook Event Verified',
};

export function formatAuditEventLabel(eventType: string): string {
  const key = (eventType || '').trim().toLowerCase();
  if (HUMAN_READABLE_AUDIT_LABELS[key]) {
    return HUMAN_READABLE_AUDIT_LABELS[key];
  }
  return key
    .split('_')
    .filter(Boolean)
    .map((word) =>
      word === 'ai'
        ? 'AI'
        : word === 'paypal'
          ? 'PayPal'
          : word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join(' ');
}

export default function BillingAISettingsModal({
  visible,
  roleScope,
  initialSettings,
  auditEvents,
  onSettingsUpdated,
  onClose,
}: BillingAISettingsModalProps) {
  const [settings, setSettings] =
    useState<BillingAISettingsRecord>(initialSettings);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  useEffect(() => {
    if (visible) {
      setSettings(initialSettings);
      setFeedback(null);
    }
    // Sync only when modal opens so in-modal pill/switch updates do not flicker
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!visible) return null;

  const isDoctor = roleScope === 'doctor';

  const applySettingPatch = async (
    patch: Partial<{
      maxSingleActionMinor: number;
      dailyLimitMinor: number;
      allowInvoiceDrafting: boolean;
      allowReminderDrafting: boolean;
      allowCheckoutAssistance: boolean;
      warnDuplicates: boolean;
      notifyNewInvoice: boolean;
      notifyPaymentConfirmed: boolean;
      notifyPaymentFailed: boolean;
      notifyOverdue: boolean;
      notifyRefund: boolean;
      reminderDaysBeforeDue: number;
    }>
  ) => {
    if (saving) return;
    const optimistic: BillingAISettingsRecord = {
      ...settings,
      ...patch,
      requireHumanApproval: true,
      blockClinicalData: true,
      paypalConfirmationRequired: true,
    };
    setSettings(optimistic);
    onSettingsUpdated(optimistic);
    setSaving(true);
    setFeedback(null);
    try {
      const saved = await updateBillingAISettings(patch);
      setSettings(saved);
      onSettingsUpdated(saved);
    } catch (err: any) {
      setFeedback({
        type: 'error',
        text: err?.message || 'Unable to save settings.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <BillingModalShell
      visible={visible}
      onClose={onClose}
      title="Billing AI Settings & Guardrails"
      subtitle={`Role View: ${isDoctor ? 'Provider' : 'Customer'} • Server-Enforced Guardrails`}
      testID="billing-ai-settings-modal"
      closeTestID="billing-settings-close-btn"
      closeAccessibilityLabel="Close Billing AI Settings"
      footer={
        <Pressable
          style={billingModalStyles.primaryButton}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close Billing Settings"
          testID="billing-settings-done-btn"
        >
          <Text style={billingModalStyles.primaryButtonText}>Done</Text>
        </Pressable>
      }
    >
      {feedback ? (
        <View
          style={[
            styles.feedbackBanner,
            feedback.type === 'error'
              ? styles.feedbackError
              : styles.feedbackSuccess,
          ]}
          testID="billing-settings-feedback-banner"
        >
          {feedback.type === 'error' ? (
            <AlertTriangle size={15} color="#B91C1C" />
          ) : (
            <CheckCircle2 size={15} color="#047857" />
          )}
          <Text
            style={[
              styles.feedbackText,
              feedback.type === 'error'
                ? styles.feedbackErrorText
                : styles.feedbackSuccessText,
            ]}
          >
            {feedback.text}
          </Text>
        </View>
      ) : null}

      {/* Section 1: Mandatory Locked Guardrails */}
      <Text style={styles.sectionHeader}>
        1. Mandatory Safety Guardrails (Locked)
      </Text>

      <View style={styles.settingRow}>
        <View style={styles.settingTextCol}>
          <Text style={styles.settingTitle}>
            Human-in-the-Loop Approval Required
          </Text>
          <Text style={styles.settingDescription}>
            AI cannot send invoices, execute PayPal charges, or issue refunds
            without explicit user confirmation.
          </Text>
        </View>
        <View style={styles.lockedOnPill} testID="guardrail-hitl-locked">
          <Lock size={12} color="#047857" />
          <Text style={styles.lockedOnText}>LOCKED ON</Text>
        </View>
      </View>

      <View style={billingModalStyles.divider} />

      <View style={styles.settingRow}>
        <View style={styles.settingTextCol}>
          <Text style={styles.settingTitle}>
            Sensitive-Data Payload Firewall
          </Text>
          <Text style={styles.settingDescription}>
            Blocks private notes, raw customer records, and non-billing fields
            from ever reaching PayPal API payloads.
          </Text>
        </View>
        <View style={styles.lockedOnPill} testID="guardrail-phi-locked">
          <Lock size={12} color="#047857" />
          <Text style={styles.lockedOnText}>LOCKED ON</Text>
        </View>
      </View>

      <View style={billingModalStyles.divider} />

      {/* Section 2: Monetary Velocity Caps */}
      <Text style={styles.sectionHeader}>2. Monetary Velocity Guardrails</Text>
      <Text style={styles.helperText}>
        Thresholds enforced server-side before Billing AI can prepare an action
        card:
      </Text>

      <View style={styles.settingRow}>
        <View style={styles.settingTextCol}>
          <Text style={styles.settingTitle}>
            Maximum Single AI-Assisted Action
          </Text>
          <Text style={styles.settingDescription}>
            Caps any single AI-prepared invoice or refund draft.
          </Text>
        </View>
        <Text style={styles.limitValue}>
          ${(settings.maxSingleActionMinor / 100).toFixed(2)} USD
        </Text>
      </View>
      <View style={styles.pillsRow}>
        {SINGLE_ACTION_OPTIONS.map((val) => {
          const active = settings.maxSingleActionMinor === val;
          return (
            <Pressable
              key={val}
              style={[
                styles.optionPill,
                active && styles.optionPillActive,
                saving && styles.optionPillDisabled,
              ]}
              onPress={() =>
                void applySettingPatch({ maxSingleActionMinor: val })
              }
              disabled={saving}
              accessibilityRole="button"
              testID={`billing-settings-single-cap-${val}`}
            >
              <Text
                style={[
                  styles.optionPillText,
                  active && styles.optionPillTextActive,
                ]}
              >
                ${(val / 100).toFixed(2)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={[styles.settingRow, { marginTop: 10 }]}>
        <View style={styles.settingTextCol}>
          <Text style={styles.settingTitle}>
            Maximum Daily Cumulative AI-Assisted Actions
          </Text>
          <Text style={styles.settingDescription}>
            Rolling 24-hour cap across all AI-prepared billing operations.
          </Text>
        </View>
        <Text style={styles.limitValue}>
          ${(settings.dailyLimitMinor / 100).toFixed(2)} USD
        </Text>
      </View>
      <View style={styles.pillsRow}>
        {DAILY_TOTAL_OPTIONS.map((val) => {
          const active = settings.dailyLimitMinor === val;
          return (
            <Pressable
              key={val}
              style={[
                styles.optionPill,
                active && styles.optionPillActive,
                saving && styles.optionPillDisabled,
              ]}
              onPress={() => void applySettingPatch({ dailyLimitMinor: val })}
              disabled={saving}
              accessibilityRole="button"
              testID={`billing-settings-daily-cap-${val}`}
            >
              <Text
                style={[
                  styles.optionPillText,
                  active && styles.optionPillTextActive,
                ]}
              >
                ${(val / 100).toFixed(2)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={billingModalStyles.divider} />

      {/* Section 3: AI Assistance Controls */}
      <Text style={styles.sectionHeader}>3. AI Assistance Preferences</Text>

      <View style={styles.settingRow}>
        <View style={styles.settingTextCol}>
          <Text style={styles.settingTitle}>AI Invoice Draft Preparation</Text>
          <Text style={styles.settingDescription}>
            Allow Billing AI to prepare draft invoice line items for provider
            review.
          </Text>
        </View>
        <Switch
          value={settings.allowInvoiceDrafting}
          disabled={saving}
          onValueChange={(val) =>
            void applySettingPatch({ allowInvoiceDrafting: val })
          }
          trackColor={{ false: '#D1D5DB', true: '#F59E0B' }}
          testID="billing-settings-toggle-drafts"
        />
      </View>

      <View style={billingModalStyles.divider} />

      <View style={styles.settingRow}>
        <View style={styles.settingTextCol}>
          <Text style={styles.settingTitle}>
            AI-Assisted Overdue Reminder Drafts
          </Text>
          <Text style={styles.settingDescription}>
            Allow Billing AI to draft polite payment reminder messages for
            overdue balances.
          </Text>
        </View>
        <Switch
          value={settings.allowReminderDrafting}
          disabled={saving}
          onValueChange={(val) =>
            void applySettingPatch({ allowReminderDrafting: val })
          }
          trackColor={{ false: '#D1D5DB', true: '#F59E0B' }}
          testID="billing-settings-toggle-reminders"
        />
      </View>

      <View style={billingModalStyles.divider} />

      <View style={styles.settingRow}>
        <View style={styles.settingTextCol}>
          <Text style={styles.settingTitle}>
            Duplicate Invoice & Charge Warnings
          </Text>
          <Text style={styles.settingDescription}>
            Warn before creating an administrative invoice when a similar
            statement exists.
          </Text>
        </View>
        <Switch
          value={settings.warnDuplicates}
          disabled={saving}
          onValueChange={(val) =>
            void applySettingPatch({ warnDuplicates: val })
          }
          trackColor={{ false: '#D1D5DB', true: '#F59E0B' }}
          testID="billing-settings-toggle-dup-guard"
        />
      </View>

      <View style={billingModalStyles.divider} />

      {/* Section 4: Notification Preferences */}
      <Text style={styles.sectionHeader}>4. Billing Notifications</Text>

      <View style={styles.settingRow}>
        <View style={styles.settingTextCol}>
          <Text style={styles.settingTitle}>Invoice Settlement Alerts</Text>
          <Text style={styles.settingDescription}>
            Notify when a customer completes a verified PayPal Sandbox payment.
          </Text>
        </View>
        <Switch
          value={settings.notifyPaymentConfirmed}
          disabled={saving}
          onValueChange={(val) =>
            void applySettingPatch({ notifyPaymentConfirmed: val })
          }
          trackColor={{ false: '#D1D5DB', true: '#F59E0B' }}
          testID="billing-settings-toggle-notify-paid"
        />
      </View>

      <View style={billingModalStyles.divider} />

      <View style={styles.settingRow}>
        <View style={styles.settingTextCol}>
          <Text style={styles.settingTitle}>
            Unsuccessful Payment Attempt Alerts
          </Text>
          <Text style={styles.settingDescription}>
            Notify immediately when a PayPal Sandbox checkout is declined or
            expires so you can retry safely.
          </Text>
        </View>
        <Switch
          value={settings.notifyPaymentFailed}
          disabled={saving}
          onValueChange={(val) =>
            void applySettingPatch({ notifyPaymentFailed: val })
          }
          trackColor={{ false: '#D1D5DB', true: '#F59E0B' }}
          testID="billing-settings-toggle-notify-failed"
        />
      </View>

      <View style={billingModalStyles.divider} />

      <View style={styles.settingRow}>
        <View style={styles.settingTextCol}>
          <Text style={styles.settingTitle}>Payment & Refund Receipts</Text>
          <Text style={styles.settingDescription}>
            Deliver an in-app notification whenever a receipt or refund is
            recorded.
          </Text>
        </View>
        <Switch
          value={settings.notifyRefund}
          disabled={saving}
          onValueChange={(val) => void applySettingPatch({ notifyRefund: val })}
          trackColor={{ false: '#D1D5DB', true: '#F59E0B' }}
          testID="billing-settings-toggle-notify-receipts"
        />
      </View>

      <View style={billingModalStyles.divider} />

      {/* Section 5: Complete Audit History with Human-Readable Labels (No Duplicate Heading) */}
      <View
        style={styles.auditHeaderRow}
        testID="billing-settings-audit-section"
      >
        <View style={styles.auditTitleLeft}>
          <History size={15} color="#B45309" />
          <Text style={styles.sectionHeader}>
            5. Recent Billing & AI Audit Activity ({auditEvents.length})
          </Text>
        </View>
      </View>

      <View style={styles.auditList} testID="billing-settings-audit-list">
        {auditEvents.length === 0 ? (
          <Text style={styles.auditEmptyText}>
            No audit events recorded yet for this account.
          </Text>
        ) : (
          auditEvents.map((ev) => (
            <View
              key={String(ev.id)}
              style={styles.auditItem}
              testID={`billing-audit-event-${ev.id}`}
            >
              <View style={styles.auditItemTopRow}>
                <Text style={styles.auditEventType}>
                  {formatAuditEventLabel(ev.eventType)}
                </Text>
                <Text style={styles.auditActorTag}>
                  {ev.actorKind === 'ai'
                    ? 'AI Assistant'
                    : ev.actorKind === 'paypal'
                      ? 'PayPal Sandbox'
                      : ev.actorKind === 'system'
                        ? 'System'
                        : 'Authorized User'}
                </Text>
              </View>
              <Text style={styles.auditEventMeta}>
                {new Date(ev.createdAt).toLocaleString()}
              </Text>
            </View>
          ))
        )}
      </View>
    </BillingModalShell>
  );
}

const styles = StyleSheet.create({
  feedbackBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  feedbackError: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  feedbackSuccess: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  feedbackText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
  },
  feedbackErrorText: {
    color: '#991B1B',
  },
  feedbackSuccessText: {
    color: '#065F46',
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '800',
    color: '#4B5563',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 8,
  },
  helperText: {
    fontSize: 13,
    color: '#6B7280',
    lineHeight: 18,
    marginBottom: 8,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 6,
  },
  settingTextCol: {
    flex: 1,
  },
  settingTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
  },
  settingDescription: {
    fontSize: 13,
    lineHeight: 18,
    color: '#6B7280',
    marginTop: 2,
  },
  lockedOnPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  lockedOnText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#047857',
  },
  limitValue: {
    fontSize: 14,
    fontWeight: '800',
    color: '#111827',
  },
  pillsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  optionPill: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#F9FAFB',
    alignItems: 'center',
  },
  optionPillActive: {
    borderColor: '#F59E0B',
    backgroundColor: '#FEF3C7',
  },
  optionPillDisabled: {
    opacity: 0.6,
  },
  optionPillText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#374151',
  },
  optionPillTextActive: {
    color: '#B45309',
  },
  auditHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  auditTitleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  auditList: {
    gap: 8,
    marginTop: 4,
  },
  auditEmptyText: {
    fontSize: 13,
    color: '#6B7280',
  },
  auditItem: {
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    gap: 4,
  },
  auditItemTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  auditEventType: {
    fontSize: 13,
    fontWeight: '700',
    color: '#111827',
    flex: 1,
  },
  auditActorTag: {
    fontSize: 11,
    fontWeight: '700',
    color: '#B45309',
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
  },
  auditEventMeta: {
    fontSize: 12,
    color: '#6B7280',
  },
});

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
} from 'react-native';
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  ChevronRight,
  FileText,
  X,
} from 'lucide-react-native';
import BillingModalShell, { billingModalStyles } from './BillingModalShell';
import type { BillingNotificationItem } from '../../src/billing/types';

export interface BillingNotificationsModalProps {
  visible: boolean;
  notifications: BillingNotificationItem[];
  onClose: () => void;
  onSelectNotification: (
    notification: BillingNotificationItem
  ) => Promise<{ ok: boolean; errorMessage?: string } | void> | void;
  onMarkAllRead?: () => void;
  errorMessage?: string | null;
  onClearError?: () => void;
}

function formatNotificationTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return isoString;
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return isoString;
  }
}

function extractStatementNumberLabel(n: BillingNotificationItem): string | null {
  const match = `${n.title || ''} ${n.body || ''}`.match(
    /\b((?:PPB|HER)-INV-\d{4}-\d+)\b/i
  );
  if (match) return match[1].toUpperCase();
  if (n.invoiceId && /^(?:PPB|HER)-INV-/i.test(n.invoiceId)) {
    return n.invoiceId.toUpperCase();
  }
  return null;
}

export default function BillingNotificationsModal({
  visible,
  notifications,
  onClose,
  onSelectNotification,
  onMarkAllRead,
  errorMessage = null,
  onClearError,
}: BillingNotificationsModalProps) {
  const [navigatingId, setNavigatingId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setNavigatingId(null);
      setLocalError(null);
    }
  }, [visible]);

  if (!visible) return null;

  const effectiveError = errorMessage || localError;
  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const handlePressCard = async (n: BillingNotificationItem) => {
    if (navigatingId) return;
    setNavigatingId(n.id);
    setLocalError(null);
    onClearError?.();
    try {
      const res = await onSelectNotification(n);
      if (res && typeof res === 'object' && res.ok === false && res.errorMessage) {
        setLocalError(res.errorMessage);
      }
    } catch (err: any) {
      setLocalError(
        err?.message ||
          'Unable to open the linked statement for this notification.'
      );
    } finally {
      setNavigatingId(null);
    }
  };

  return (
    <BillingModalShell
      visible={visible}
      onClose={onClose}
      title="Billing Notifications"
      subtitle={`Tap any alert to open the linked statement${
        unreadCount > 0 ? ` • ${unreadCount} unread` : ''
      }`}
      testID="billing-notifications-modal"
      closeTestID="billing-notifications-close-btn"
      closeAccessibilityLabel="Close Billing Notifications"
      headerAccessory={
        unreadCount > 0 && onMarkAllRead ? (
          <Pressable
            style={styles.markAllReadChip}
            onPress={onMarkAllRead}
            accessibilityRole="button"
            accessibilityLabel="Mark all notifications as read"
            testID="billing-notifications-mark-all-read-btn"
          >
            <CheckCircle2 size={13} color="#047857" />
            <Text style={styles.markAllReadText}>
              Mark all read ({unreadCount})
            </Text>
          </Pressable>
        ) : undefined
      }
      footer={
        <Pressable
          style={billingModalStyles.primaryButton}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Done viewing notifications"
          testID="billing-notifications-done-btn"
        >
          <Text style={billingModalStyles.primaryButtonText}>Done</Text>
        </Pressable>
      }
    >
      {effectiveError ? (
        <View
          style={styles.errorBanner}
          testID="billing-notifications-error-banner"
        >
          <AlertTriangle size={16} color="#B91C1C" />
          <View style={styles.errorTextCol}>
            <Text style={styles.errorTitle}>Unable to Open Statement</Text>
            <Text style={styles.errorBody}>{effectiveError}</Text>
          </View>
          <Pressable
            style={styles.dismissErrorBtn}
            onPress={() => {
              setLocalError(null);
              onClearError?.();
            }}
            accessibilityRole="button"
            accessibilityLabel="Dismiss notification error"
            testID="billing-notifications-error-dismiss-btn"
          >
            <X size={15} color="#991B1B" />
          </Pressable>
        </View>
      ) : null}

      {notifications.length === 0 ? (
        <View style={styles.emptyBox} testID="billing-notifications-empty-state">
          <Bell size={22} color="#9CA3AF" />
          <Text style={styles.emptyTitle}>No Billing Notifications Yet</Text>
          <Text style={styles.emptySub}>
            New invoices, payment settlements, failed attempts, and refunds will
            appear here.
          </Text>
        </View>
      ) : (
        <View style={styles.list} testID="billing-notifications-list">
          {notifications.map((n) => {
            const statementNum = extractStatementNumberLabel(n);
            const isBusy = navigatingId === n.id;
            return (
              <Pressable
                key={n.id}
                style={({ pressed }) => [
                  styles.itemCard,
                  !n.isRead && styles.itemCardUnread,
                  (pressed || isBusy) && styles.itemCardPressed,
                ]}
                onPress={() => void handlePressCard(n)}
                disabled={Boolean(navigatingId)}
                accessibilityRole="button"
                accessibilityState={{ busy: isBusy }}
                accessibilityLabel={`${
                  n.isRead ? 'Read' : 'Unread'
                } notification: ${n.title}. ${n.body}${
                  statementNum ? `. Opens statement ${statementNum}` : ''
                }`}
                testID={`billing-notification-item-${n.id}`}
              >
                <View style={styles.itemLeft}>
                  <View style={styles.titleRow}>
                    {!n.isRead ? (
                      <View
                        style={styles.unreadDot}
                        testID={`billing-notification-unread-dot-${n.id}`}
                      />
                    ) : null}
                    <Text style={styles.itemTitle}>{n.title}</Text>
                    <View
                      style={[
                        styles.readStatusPill,
                        n.isRead ? styles.readPill : styles.unreadPill,
                      ]}
                      testID={`billing-notification-status-${n.id}`}
                    >
                      <Text
                        style={[
                          styles.readStatusPillText,
                          n.isRead ? styles.readPillText : styles.unreadPillText,
                        ]}
                      >
                        {n.isRead ? 'READ' : 'UNREAD'}
                      </Text>
                    </View>
                  </View>

                  <Text style={styles.itemBody}>{n.body}</Text>

                  <View style={styles.metaFooterRow}>
                    {statementNum ? (
                      <View style={styles.statementLinkPill}>
                        <FileText size={11} color="#C2410C" />
                        <Text style={styles.statementLinkPillText}>
                          Open #{statementNum}
                        </Text>
                      </View>
                    ) : n.invoiceId ? (
                      <View style={styles.statementLinkPill}>
                        <FileText size={11} color="#C2410C" />
                        <Text style={styles.statementLinkPillText}>
                          Open Linked Statement
                        </Text>
                      </View>
                    ) : null}
                    <Text style={styles.itemTime}>
                      {formatNotificationTime(n.createdAt)}
                    </Text>
                  </View>
                </View>

                <View style={styles.chevronBox}>
                  <ChevronRight size={18} color="#EA580C" />
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </BillingModalShell>
  );
}

const styles = StyleSheet.create({
  markAllReadChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  markAllReadText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#047857',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    marginBottom: 12,
  },
  errorTextCol: {
    flex: 1,
    gap: 2,
  },
  errorTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#991B1B',
  },
  errorBody: {
    fontSize: 12,
    lineHeight: 17,
    color: '#B91C1C',
  },
  dismissErrorBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyBox: {
    padding: 24,
    borderRadius: 14,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    gap: 6,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
    marginTop: 4,
  },
  emptySub: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 18,
  },
  list: {
    gap: 10,
    paddingBottom: 6,
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    padding: 13,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  itemCardUnread: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  itemCardPressed: {
    backgroundColor: '#FEF3C7',
    borderColor: '#F59E0B',
    opacity: 0.94,
  },
  itemLeft: {
    flex: 1,
    gap: 5,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EA580C',
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
    flex: 1,
  },
  readStatusPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  unreadPill: {
    backgroundColor: '#FFF7ED',
    borderColor: '#FDBA74',
  },
  readPill: {
    backgroundColor: '#F1F5F9',
    borderColor: '#CBD5E1',
  },
  readStatusPillText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  unreadPillText: {
    color: '#C2410C',
  },
  readPillText: {
    color: '#64748B',
  },
  itemBody: {
    fontSize: 13,
    lineHeight: 18,
    color: '#334155',
  },
  metaFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 2,
  },
  statementLinkPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: '#FFEDD5',
  },
  statementLinkPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9A3412',
  },
  itemTime: {
    fontSize: 11,
    color: '#64748B',
  },
  chevronBox: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FFF7ED',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

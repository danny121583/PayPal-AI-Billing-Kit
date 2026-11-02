import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
} from 'react-native';
import { Bell, ChevronRight } from 'lucide-react-native';
import BillingModalShell, { billingModalStyles } from './BillingModalShell';
import type { BillingNotificationItem } from '../../src/billing/types';

export interface BillingNotificationsModalProps {
  visible: boolean;
  notifications: BillingNotificationItem[];
  onClose: () => void;
  onSelectNotification: (notification: BillingNotificationItem) => void;
}

export default function BillingNotificationsModal({
  visible,
  notifications,
  onClose,
  onSelectNotification,
}: BillingNotificationsModalProps) {
  if (!visible) return null;

  return (
    <BillingModalShell
      visible={visible}
      onClose={onClose}
      title="Billing Notifications"
      subtitle="Tap any alert to open the linked statement"
      testID="billing-notifications-modal"
      closeTestID="billing-notifications-close-btn"
      closeAccessibilityLabel="Close Billing Notifications"
      footer={
        <Pressable
          style={billingModalStyles.primaryButton}
          onPress={onClose}
          accessibilityRole="button"
          testID="billing-notifications-done-btn"
        >
          <Text style={billingModalStyles.primaryButtonText}>Done</Text>
        </Pressable>
      }
    >
      {notifications.length === 0 ? (
        <View style={styles.emptyBox}>
          <Bell size={22} color="#9CA3AF" />
          <Text style={styles.emptyTitle}>No Billing Notifications Yet</Text>
          <Text style={styles.emptySub}>
            New invoices, payment settlements, failed attempts, and refunds will
            appear here.
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {notifications.map((n) => (
            <Pressable
              key={n.id}
              style={[styles.itemCard, !n.isRead && styles.itemCardUnread]}
              onPress={() => onSelectNotification(n)}
              accessibilityRole="button"
              testID={`billing-notification-item-${n.id}`}
            >
              <View style={styles.itemLeft}>
                <View style={styles.titleRow}>
                  {!n.isRead ? <View style={styles.unreadDot} /> : null}
                  <Text style={styles.itemTitle}>{n.title}</Text>
                </View>
                <Text style={styles.itemBody}>{n.body}</Text>
                <Text style={styles.itemTime}>
                  {new Date(n.createdAt).toLocaleString()}
                </Text>
              </View>
              <ChevronRight size={16} color="#2563EB" />
            </Pressable>
          ))}
        </View>
      )}
    </BillingModalShell>
  );
}

const styles = StyleSheet.create({
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
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  itemCardUnread: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  itemLeft: {
    flex: 1,
    gap: 4,
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
    backgroundColor: '#F59E0B',
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
    flex: 1,
  },
  itemBody: {
    fontSize: 13,
    lineHeight: 18,
    color: '#374151',
  },
  itemTime: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
});

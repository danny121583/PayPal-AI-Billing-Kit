import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
} from 'react-native';
import {
  FileText,
  ChevronRight,
  Sparkles,
  Filter,
} from 'lucide-react-native';
import type {
  BillingRoleScope,
  SyntheticBillingInvoice,
} from '../../src/billing/types';
import {
  formatBillingDate,
  formatUsdCents,
} from '../../src/billing/data/syntheticBillingFixtures';
import BillingModalShell, { billingModalStyles } from './BillingModalShell';

export type BillingMetricKind =
  | 'outstanding'
  | 'overdue'
  | 'paid'
  | 'failed'
  | 'recent_paid';

export interface BillingMetricDetailModalProps {
  visible: boolean;
  metric: BillingMetricKind | null;
  roleScope: BillingRoleScope;
  invoices: SyntheticBillingInvoice[];
  onClose: () => void;
  onSelectInvoice: (invoice: SyntheticBillingInvoice) => void;
  onApplyStatusFilter?: (filterKey: string) => void;
  onAskBillingAI?: (invoice: SyntheticBillingInvoice | null) => void;
}

interface MetricDescriptor {
  title: string;
  subtitle: string;
  emptyText: string;
  filterKey: string;
  filterButtonLabel: string;
  matches: (inv: SyntheticBillingInvoice) => boolean;
}

function getMetricDescriptor(
  metric: BillingMetricKind,
  roleScope: BillingRoleScope
): MetricDescriptor {
  const isDoctor = roleScope === 'doctor';
  switch (metric) {
    case 'outstanding':
      return {
        title: isDoctor ? 'Outstanding Receivables' : 'Current Balance Due',
        subtitle:
          'Statements with an open balance awaiting PayPal Sandbox settlement.',
        emptyText: 'No open or unpaid statements right now.',
        filterKey: 'UNPAID',
        filterButtonLabel: 'Filter List to Open Statements',
        matches: (inv) =>
          inv.status === 'pending' ||
          inv.status === 'sent' ||
          inv.status === 'overdue' ||
          inv.status === 'failed',
      };
    case 'overdue':
      return {
        title: 'Overdue Statements',
        subtitle: 'Statements past their due date requiring customer follow-up.',
        emptyText: 'Zero overdue statements.',
        filterKey: 'overdue',
        filterButtonLabel: 'Filter List to Overdue',
        matches: (inv) => inv.status === 'overdue',
      };
    case 'paid':
    case 'recent_paid':
      return {
        title: isDoctor
          ? 'Paid & Settled Statements'
          : 'Recent Payments & Receipts',
        subtitle: 'Statements settled or refunded with recorded references.',
        emptyText: 'No settled payments recorded yet.',
        filterKey: 'paid',
        filterButtonLabel: 'Filter List to Paid Receipts',
        matches: (inv) => inv.status === 'paid' || inv.status === 'refunded',
      };
    case 'failed':
      return {
        title: 'Failed Payment Attempts',
        subtitle:
          'Statements where the most recent PayPal Sandbox checkout attempt was declined or expired.',
        emptyText: 'No failed payment attempts.',
        filterKey: 'failed',
        filterButtonLabel: 'Filter List to Failed Attempts',
        matches: (inv) => inv.status === 'failed',
      };
  }
}

export default function BillingMetricDetailModal({
  visible,
  metric,
  roleScope,
  invoices,
  onClose,
  onSelectInvoice,
  onApplyStatusFilter,
  onAskBillingAI,
}: BillingMetricDetailModalProps) {
  const descriptor = useMemo(
    () => (metric ? getMetricDescriptor(metric, roleScope) : null),
    [metric, roleScope]
  );

  const matchingInvoices = useMemo(() => {
    if (!descriptor) return [];
    return invoices.filter(descriptor.matches);
  }, [descriptor, invoices]);

  const totalCents = useMemo(() => {
    if (!metric) return 0;
    return matchingInvoices.reduce((acc, inv) => {
      if (metric === 'paid' || metric === 'recent_paid') {
        return acc + inv.totalCents;
      }
      return acc + inv.balanceDueCents;
    }, 0);
  }, [matchingInvoices, metric]);

  if (!visible || !metric || !descriptor) return null;

  const isDoctor = roleScope === 'doctor';

  return (
    <BillingModalShell
      visible={visible}
      onClose={onClose}
      title={descriptor.title}
      subtitle={descriptor.subtitle}
      testID="billing-metric-detail-modal"
      closeTestID="billing-metric-detail-close-btn"
      closeAccessibilityLabel="Close metric breakdown"
      footer={
        <View style={styles.footerCol}>
          {onApplyStatusFilter ? (
            <Pressable
              style={billingModalStyles.primaryButton}
              onPress={() => {
                onApplyStatusFilter(descriptor.filterKey);
                onClose();
              }}
              accessibilityRole="button"
              testID="billing-metric-apply-filter-btn"
            >
              <View style={styles.btnInline}>
                <Filter size={15} color="#FFFFFF" />
                <Text style={billingModalStyles.primaryButtonText}>
                  {descriptor.filterButtonLabel}
                </Text>
              </View>
            </Pressable>
          ) : null}

          <View style={styles.footerSecondaryRow}>
            {onAskBillingAI ? (
              <Pressable
                style={[styles.secondaryBtn, styles.aiSecondaryBtn]}
                onPress={() => {
                  const first = matchingInvoices[0] ?? null;
                  onClose();
                  onAskBillingAI(first);
                }}
                accessibilityRole="button"
                testID="billing-metric-ask-ai-btn"
              >
                <Sparkles size={14} color="#B45309" />
                <Text style={styles.aiSecondaryBtnText}>Ask Billing AI</Text>
              </Pressable>
            ) : null}

            <Pressable
              style={styles.secondaryBtn}
              onPress={onClose}
              accessibilityRole="button"
              testID="billing-metric-done-btn"
            >
              <Text style={styles.secondaryBtnText}>Close</Text>
            </Pressable>
          </View>
        </View>
      }
    >
      <View style={styles.summaryHero}>
        <Text style={styles.summaryHeroLabel}>
          {matchingInvoices.length}{' '}
          {matchingInvoices.length === 1 ? 'Statement' : 'Statements'}
        </Text>
        <Text style={styles.summaryHeroValue}>
          {formatUsdCents(totalCents)} USD
        </Text>
      </View>

      {matchingInvoices.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyBoxText}>{descriptor.emptyText}</Text>
        </View>
      ) : (
        matchingInvoices.map((inv) => (
          <Pressable
            key={inv.id}
            style={styles.invoiceRow}
            onPress={() => {
              onClose();
              onSelectInvoice(inv);
            }}
            accessibilityRole="button"
            testID={`billing-metric-invoice-row-${inv.id}`}
          >
            <View style={styles.invoiceRowLeft}>
              <View style={styles.invoiceNumberLine}>
                <FileText size={14} color="#2563EB" />
                <Text style={styles.invoiceNumberText}>
                  #{inv.invoiceNumber}
                </Text>
                <Text style={styles.invoiceStatusPill}>
                  {inv.status.toUpperCase()}
                </Text>
              </View>
              <Text style={styles.invoiceServiceTitle}>
                {inv.administrativeSummary}
              </Text>
              <Text style={styles.invoiceCounterpart}>
                {isDoctor
                  ? `Customer: ${inv.patientDisplayName}`
                  : `Provider: ${inv.issuerDoctorName}`}{' '}
                • Due {formatBillingDate(inv.dueDate)}
              </Text>
            </View>
            <View style={styles.invoiceRowRight}>
              <Text style={styles.invoiceAmountText}>
                {formatUsdCents(
                  inv.balanceDueCents > 0 ? inv.balanceDueCents : inv.totalCents
                )}
              </Text>
              <ChevronRight size={16} color="#2563EB" />
            </View>
          </Pressable>
        ))
      )}
    </BillingModalShell>
  );
}

const styles = StyleSheet.create({
  summaryHero: {
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  summaryHeroLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#92400E',
  },
  summaryHeroValue: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111827',
  },
  emptyBox: {
    padding: 20,
    borderRadius: 12,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
  },
  emptyBoxText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
    textAlign: 'center',
  },
  invoiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 8,
  },
  invoiceRowLeft: {
    flex: 1,
    gap: 2,
  },
  invoiceNumberLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  invoiceNumberText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2563EB',
  },
  invoiceStatusPill: {
    fontSize: 10,
    fontWeight: '800',
    color: '#4B5563',
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
  invoiceServiceTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
  },
  invoiceCounterpart: {
    fontSize: 12,
    color: '#6B7280',
  },
  invoiceRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  invoiceAmountText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#111827',
  },
  footerCol: {
    gap: 8,
  },
  btnInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  footerSecondaryRow: {
    flexDirection: 'row',
    gap: 8,
  },
  secondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
  },
  secondaryBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#374151',
  },
  aiSecondaryBtn: {
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  aiSecondaryBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#B45309',
  },
});

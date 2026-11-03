import React, { useMemo, useState } from 'react';
import {
  Platform,
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  type ViewStyle,
} from 'react-native';
import {
  Sparkles,
  Search,
  X,
  AlertCircle,
} from 'lucide-react-native';
import { shadows } from '../../src/lib/shadow';
import type { SyntheticBillingInvoice } from '../../src/billing/types';
import {
  computePatientSummaryMetrics,
  formatUsdCents,
} from '../../src/billing/data/syntheticBillingFixtures';
import PayPalConnectCard from './PayPalConnectCard';
import BillingInvoiceCard from './BillingInvoiceCard';
import BillingMetricDetailModal, {
  type BillingMetricKind,
} from './BillingMetricDetailModal';

export interface PatientBillingViewProps {
  invoices: SyntheticBillingInvoice[];
  searchVisible: boolean;
  searchQuery: string;
  onChangeSearchQuery: (q: string) => void;
  highlightedInvoiceId?: string | null;
  onSelectInvoice: (invoice: SyntheticBillingInvoice) => void;
  onAskBillingAI: (invoice: SyntheticBillingInvoice | null) => void;
  onOpenSettings: () => void;
}

type PatientFilterKey = 'ALL' | 'UNPAID' | 'PAID' | 'FAILED' | 'REFUNDED';

const PATIENT_FILTERS: { key: PatientFilterKey; label: string }[] = [
  { key: 'ALL', label: 'All Statements' },
  { key: 'UNPAID', label: 'Open / Due' },
  { key: 'PAID', label: 'Paid Receipts' },
  { key: 'FAILED', label: 'Failed Attempts' },
  { key: 'REFUNDED', label: 'Refunded' },
];

export default function PatientBillingView({
  invoices,
  searchVisible,
  searchQuery,
  onChangeSearchQuery,
  highlightedInvoiceId,
  onSelectInvoice,
  onAskBillingAI,
  onOpenSettings,
}: PatientBillingViewProps) {
  const [filter, setFilter] = useState<PatientFilterKey>('ALL');
  const [activeMetricModal, setActiveMetricModal] =
    useState<BillingMetricKind | null>(null);
  const [isSearchFocused, setIsSearchFocused] = useState(false);

  const visiblePatientInvoices = useMemo(
    () => invoices.filter((inv) => inv.status !== 'draft'),
    [invoices]
  );

  const metrics = useMemo(
    () => computePatientSummaryMetrics(visiblePatientInvoices),
    [visiblePatientInvoices]
  );

  const failedAttemptsCount = useMemo(
    () => visiblePatientInvoices.filter((inv) => inv.status === 'failed').length,
    [visiblePatientInvoices]
  );

  const paidTotalCents = useMemo(
    () =>
      visiblePatientInvoices
        .filter((inv) => inv.status === 'paid')
        .reduce((sum, inv) => sum + inv.amountPaidCents, 0),
    [visiblePatientInvoices]
  );

  const filteredInvoices = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return visiblePatientInvoices.filter((inv) => {
      if (filter === 'UNPAID') {
        if (
          inv.status !== 'pending' &&
          inv.status !== 'sent' &&
          inv.status !== 'overdue' &&
          inv.status !== 'failed'
        ) {
          return false;
        }
      } else if (filter === 'PAID') {
        if (inv.status !== 'paid') return false;
      } else if (filter === 'FAILED') {
        if (inv.status !== 'failed') return false;
      } else if (filter === 'REFUNDED') {
        if (inv.status !== 'refunded') return false;
      }

      if (!q) return true;
      return (
        inv.invoiceNumber.toLowerCase().includes(q) ||
        inv.administrativeSummary.toLowerCase().includes(q) ||
        inv.issuerDoctorName.toLowerCase().includes(q) ||
        inv.organizationName.toLowerCase().includes(q)
      );
    });
  }, [visiblePatientInvoices, filter, searchQuery]);

  return (
    <View style={styles.container} testID="patient-billing-view">
      {/* PayPal Customer Sandbox Card */}
      <PayPalConnectCard roleScope="patient" onOpenSettings={onOpenSettings} />

      {/* Customer Billing AI Assistant Button */}
      <Pressable
        style={styles.aiBannerBtn}
        onPress={() => onAskBillingAI(null)}
        accessibilityRole="button"
        accessibilityLabel="Ask Customer Billing AI Assistant"
        testID="patient-open-billing-ai-btn"
      >
        <View style={styles.aiBannerLeft}>
          <Sparkles size={18} color="#B45309" />
          <View style={styles.aiBannerTextCol}>
            <Text style={styles.aiBannerTitle}>
              Have a question about a statement or want to pay via AI?
            </Text>
            <Text style={styles.aiBannerSub}>
              Billing AI explains charges, retries failed attempts, and prepares
              PayPal Sandbox checkouts.
            </Text>
          </View>
        </View>
        <Text style={styles.aiBannerCta}>Ask AI</Text>
      </Pressable>

      {/* Customer Summary Metrics */}
      <View style={styles.metricsRow} testID="patient-billing-metrics-row">
        <Pressable
          style={styles.metricCard}
          onPress={() => setActiveMetricModal('outstanding')}
          accessibilityRole="button"
          accessibilityLabel={`Balance due ${formatUsdCents(metrics.amountCurrentlyDueCents)}, tap to view open statements`}
          testID="patient-metric-card-balance"
        >
          <Text style={styles.metricLabel}>BALANCE DUE</Text>
          <Text style={styles.metricValue} testID="patient-metric-balance-due">
            {formatUsdCents(metrics.amountCurrentlyDueCents)}
          </Text>
          <Text style={styles.metricSub}>
            {metrics.overdueInvoicesCount} overdue • Tap to view
          </Text>
        </Pressable>

        <Pressable
          style={styles.metricCard}
          onPress={() => setActiveMetricModal('paid')}
          accessibilityRole="button"
          accessibilityLabel={`Paid and settled ${formatUsdCents(paidTotalCents)}, tap to view receipts`}
          testID="patient-metric-card-paid"
        >
          <Text style={styles.metricLabel}>PAID / SETTLED</Text>
          <Text
            style={[styles.metricValue, { color: '#047857' }]}
            testID="patient-metric-paid-total"
          >
            {formatUsdCents(paidTotalCents)}
          </Text>
          <Text style={styles.metricSub}>
            {metrics.paidReceiptsCount} receipt(s)
          </Text>
        </Pressable>
      </View>

      {/* Failed Payment Alert Banner */}
      {failedAttemptsCount > 0 ? (
        <Pressable
          style={styles.failedAlertStrip}
          onPress={() => setActiveMetricModal('failed')}
          accessibilityRole="button"
          accessibilityLabel={`${failedAttemptsCount} unsuccessful payment attempt, tap to inspect and retry`}
          testID="patient-failed-attempt-banner"
        >
          <AlertCircle size={16} color="#B91C1C" />
          <Text style={styles.failedAlertText}>
            {failedAttemptsCount} statement has a declined payment attempt. Tap
            to inspect and retry with PayPal Sandbox.
          </Text>
        </Pressable>
      ) : null}

      {/* Inline Search Bar + Filter Pills */}
      <View
        style={[
          styles.searchCard,
          isSearchFocused && styles.searchCardFocused,
        ]}
        testID="patient-billing-inline-search-card"
      >
        <Search size={17} color={isSearchFocused ? '#EA580C' : '#64748B'} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search statement #, service code, provider, or amount..."
          placeholderTextColor="#94A3B8"
          value={searchQuery}
          onChangeText={onChangeSearchQuery}
          onFocus={() => setIsSearchFocused(true)}
          onBlur={() => setIsSearchFocused(false)}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Filter customer billing statements"
          testID={
            searchVisible
              ? 'patient-billing-inline-search-input'
              : 'patient-billing-search-input'
          }
        />
        {searchQuery.length > 0 ? (
          <Pressable
            style={styles.searchClearBtn}
            onPress={() => onChangeSearchQuery('')}
            accessibilityRole="button"
            accessibilityLabel="Clear search query"
            testID="patient-billing-clear-inline-search-btn"
          >
            <X size={16} color="#475569" />
          </Pressable>
        ) : null}
      </View>

      {/* Filter Pills */}
      <View style={styles.filterRow} testID="patient-billing-filters">
        {PATIENT_FILTERS.map((opt) => {
          const isActive = filter === opt.key;
          return (
            <Pressable
              key={opt.key}
              style={[styles.filterPill, isActive && styles.filterPillActive]}
              onPress={() => setFilter(opt.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              testID={`patient-filter-${opt.key.toLowerCase()}`}
            >
              <Text
                style={[
                  styles.filterPillText,
                  isActive && styles.filterPillTextActive,
                ]}
              >
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Statements List */}
      <Text style={styles.listSectionTitle}>
        Your Billing Statements ({filteredInvoices.length})
      </Text>

      {filteredInvoices.length === 0 ? (
        <View style={styles.emptyCard} testID="patient-billing-empty-state">
          <Text style={styles.emptyTitle}>No statements found</Text>
          <Text style={styles.emptyBody}>
            No customer statements match your current filter.
          </Text>
        </View>
      ) : (
        <View style={styles.invoiceList}>
          {filteredInvoices.map((inv) => (
            <BillingInvoiceCard
              key={inv.id}
              invoice={inv}
              roleScope="patient"
              highlighted={highlightedInvoiceId === inv.id}
              onSelect={onSelectInvoice}
              onAskBillingAI={onAskBillingAI}
            />
          ))}
        </View>
      )}

      {activeMetricModal ? (
        <BillingMetricDetailModal
          visible={Boolean(activeMetricModal)}
          metric={activeMetricModal}
          roleScope="patient"
          invoices={visiblePatientInvoices}
          onClose={() => setActiveMetricModal(null)}
          onSelectInvoice={onSelectInvoice}
          onAskBillingAI={onAskBillingAI}
          onApplyStatusFilter={(key) => {
            if (key === 'overdue' || key === 'UNPAID') {
              setFilter('UNPAID');
            } else if (key === 'paid') {
              setFilter('PAID');
            } else if (key === 'failed') {
              setFilter('FAILED');
            } else {
              setFilter('ALL');
            }
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 16,
  },
  searchCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    minHeight: 46,
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 10,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    ...shadows.xs,
  },
  searchCardFocused: {
    borderColor: '#F59E0B',
    backgroundColor: '#FFFFFF',
    ...(Platform.OS === 'web'
      ? ({ boxShadow: '0 0 0 3px rgba(245, 158, 11, 0.16)' } as unknown as ViewStyle)
      : {}),
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#0F172A',
    paddingVertical: 2,
    borderWidth: 0,
    backgroundColor: 'transparent',
    ...(Platform.OS === 'web'
      ? ({
          outlineStyle: 'none',
          outlineWidth: 0,
        } as unknown as ViewStyle)
      : {}),
  },
  searchClearBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiBannerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 16,
    padding: 14,
  },
  aiBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  aiBannerTextCol: {
    flex: 1,
  },
  aiBannerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#92400E',
  },
  aiBannerSub: {
    fontSize: 12,
    color: '#B45309',
    marginTop: 2,
    lineHeight: 16,
  },
  aiBannerCta: {
    fontSize: 13,
    fontWeight: '800',
    color: '#D97706',
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  metricCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    ...shadows.xs,
  },
  metricLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#6B7280',
    letterSpacing: 0.4,
  },
  metricValue: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111827',
    marginTop: 4,
  },
  metricSub: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
    marginTop: 2,
  },
  failedAlertStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 12,
    padding: 12,
  },
  failedAlertText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#991B1B',
    lineHeight: 18,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterPill: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  filterPillActive: {
    backgroundColor: '#F59E0B',
    borderColor: '#D97706',
  },
  filterPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
  },
  filterPillTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  listSectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  invoiceList: {
    gap: 12,
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
  },
  emptyBody: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 4,
    textAlign: 'center',
  },
});

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
} from 'lucide-react-native';
import { shadows } from '../../src/lib/shadow';
import type {
  SyntheticBillingInvoice,
  SyntheticInvoiceStatus,
} from '../../src/billing/types';
import {
  computeDoctorSummaryMetrics,
  filterSyntheticInvoices,
  formatUsdCents,
} from '../../src/billing/data/syntheticBillingFixtures';
import PayPalConnectCard from './PayPalConnectCard';
import BillingInvoiceCard from './BillingInvoiceCard';
import BillingMetricDetailModal, {
  type BillingMetricKind,
} from './BillingMetricDetailModal';

export interface DoctorBillingViewProps {
  invoices: SyntheticBillingInvoice[];
  searchVisible: boolean;
  searchQuery: string;
  onChangeSearchQuery: (q: string) => void;
  highlightedInvoiceId?: string | null;
  onSelectInvoice: (invoice: SyntheticBillingInvoice) => void;
  onAskBillingAI: (invoice: SyntheticBillingInvoice | null) => void;
  onOpenSettings: () => void;
  onOpenCreateInvoice?: () => void;
}

type StatusFilterKey = 'all' | SyntheticInvoiceStatus;

const FILTER_OPTIONS: { key: StatusFilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'paid', label: 'Paid' },
  { key: 'failed', label: 'Failed' },
  { key: 'refunded', label: 'Refunded' },
  { key: 'draft', label: 'Drafts' },
  { key: 'void', label: 'Voided' },
];

export default function DoctorBillingView({
  invoices,
  searchVisible,
  searchQuery,
  onChangeSearchQuery,
  highlightedInvoiceId,
  onSelectInvoice,
  onAskBillingAI,
  onOpenSettings,
}: DoctorBillingViewProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilterKey>('all');
  const [activeMetricModal, setActiveMetricModal] =
    useState<BillingMetricKind | null>(null);
  const [isSearchFocused, setIsSearchFocused] = useState(false);

  const metrics = useMemo(
    () => computeDoctorSummaryMetrics(invoices),
    [invoices]
  );

  const filteredInvoices = useMemo(
    () => filterSyntheticInvoices(invoices, statusFilter, searchQuery),
    [invoices, searchQuery, statusFilter]
  );

  return (
    <View style={styles.container} testID="doctor-billing-view">
      {/* PayPal Merchant Sandbox Connection Card */}
      <PayPalConnectCard roleScope="doctor" onOpenSettings={onOpenSettings} />

      {/* Billing AI Entry Card (Duplicate large Add Invoice button removed per Section 2) */}
      <View style={styles.quickActionRow}>
        <Pressable
          style={styles.aiTriggerBtn}
          onPress={() => onAskBillingAI(null)}
          accessibilityRole="button"
          accessibilityLabel="Open Provider Billing AI Assistant"
          testID="doctor-open-billing-ai-btn"
        >
          <Sparkles size={16} color="#B45309" />
          <Text style={styles.aiTriggerBtnText}>Ask Billing AI Assistant</Text>
        </Pressable>
      </View>

      {/* Practice Receivables Summary Metrics */}
      <View style={styles.metricsGrid} testID="doctor-billing-metrics-grid">
        <Pressable
          style={styles.metricCard}
          onPress={() => setActiveMetricModal('outstanding')}
          accessibilityRole="button"
          accessibilityLabel={`Outstanding balance ${formatUsdCents(metrics.outstandingBalanceCents)}, tap to view statements`}
          testID="doctor-metric-card-outstanding"
        >
          <Text style={styles.metricLabel}>OUTSTANDING</Text>
          <Text style={styles.metricValue} testID="doctor-metric-outstanding">
            {formatUsdCents(metrics.outstandingBalanceCents)}
          </Text>
          <Text style={styles.metricSub}>Open balance • Tap to view</Text>
        </Pressable>

        <Pressable
          style={styles.metricCard}
          onPress={() => setActiveMetricModal('overdue')}
          accessibilityRole="button"
          accessibilityLabel={`${metrics.overdueInvoicesCount} overdue invoices totaling ${formatUsdCents(metrics.overdueBalanceCents)}, tap to view`}
          testID="doctor-metric-card-overdue"
        >
          <Text style={styles.metricLabel}>OVERDUE</Text>
          <Text
            style={[styles.metricValue, { color: '#B45309' }]}
            testID="doctor-metric-overdue"
          >
            {metrics.overdueInvoicesCount}
          </Text>
          <Text style={styles.metricSub}>
            {formatUsdCents(metrics.overdueBalanceCents)} past due
          </Text>
        </Pressable>

        <Pressable
          style={styles.metricCard}
          onPress={() => setActiveMetricModal('paid')}
          accessibilityRole="button"
          accessibilityLabel={`${metrics.paidInvoicesCount} paid invoices totaling ${formatUsdCents(metrics.paidTotalCents)}, tap to view`}
          testID="doctor-metric-card-paid"
        >
          <Text style={styles.metricLabel}>PAID INVOICES</Text>
          <Text
            style={[styles.metricValue, { color: '#047857' }]}
            testID="doctor-metric-paid"
          >
            {metrics.paidInvoicesCount}
          </Text>
          <Text style={styles.metricSub}>
            {formatUsdCents(metrics.paidTotalCents)} •{' '}
            {metrics.recentPaymentsCount} recent
          </Text>
        </Pressable>

        <Pressable
          style={styles.metricCard}
          onPress={() => setActiveMetricModal('failed')}
          accessibilityRole="button"
          accessibilityLabel={`${metrics.failedPaymentsCount} failed payment attempts, tap to view`}
          testID="doctor-metric-card-failed"
        >
          <Text style={styles.metricLabel}>FAILED ATTEMPTS</Text>
          <Text
            style={[styles.metricValue, { color: '#B91C1C' }]}
            testID="doctor-metric-failed"
          >
            {metrics.failedPaymentsCount}
          </Text>
          <Text style={styles.metricSub}>Unsuccessful attempts</Text>
        </Pressable>

        <Pressable
          style={styles.metricCard}
          onPress={() => setActiveMetricModal('recent_paid')}
          accessibilityRole="button"
          accessibilityLabel={`${metrics.recentPaymentsCount} recent payments, tap to view`}
          testID="doctor-metric-card-recent-paid"
        >
          <Text style={styles.metricLabel}>RECENT PAYMENTS</Text>
          <Text
            style={[styles.metricValue, { color: '#1D4ED8' }]}
            testID="doctor-metric-recent-paid"
          >
            {metrics.recentPaymentsCount}
          </Text>
          <Text style={styles.metricSub}>Settled statements</Text>
        </Pressable>
      </View>

      {/* Inline Search Bar + Filter Pills */}
      <View
        style={[
          styles.searchCard,
          isSearchFocused && styles.searchCardFocused,
        ]}
        testID="doctor-billing-inline-search-card"
      >
        <Search size={17} color={isSearchFocused ? '#EA580C' : '#64748B'} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search invoice #, customer, service code, or amount..."
          placeholderTextColor="#94A3B8"
          value={searchQuery}
          onChangeText={onChangeSearchQuery}
          onFocus={() => setIsSearchFocused(true)}
          onBlur={() => setIsSearchFocused(false)}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Filter provider billing statements"
          testID={
            searchVisible
              ? 'doctor-billing-inline-search-input'
              : 'doctor-billing-search-input'
          }
        />
        {searchQuery.length > 0 ? (
          <Pressable
            style={styles.searchClearBtn}
            onPress={() => onChangeSearchQuery('')}
            accessibilityRole="button"
            accessibilityLabel="Clear search query"
            testID="doctor-billing-clear-inline-search-btn"
          >
            <X size={16} color="#475569" />
          </Pressable>
        ) : null}
      </View>

      {/* Filter Pills */}
      <View style={styles.filterRow} testID="doctor-billing-filters">
        {FILTER_OPTIONS.map((opt) => {
          const isActive = statusFilter === opt.key;
          return (
            <Pressable
              key={opt.key}
              style={[styles.filterPill, isActive && styles.filterPillActive]}
              onPress={() => setStatusFilter(opt.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              testID={`doctor-filter-${opt.key.toLowerCase()}`}
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

      {/* Invoice List */}
      <View style={styles.listHeaderRow}>
        <Text style={styles.listSectionTitle}>
          Provider Billing Statements ({filteredInvoices.length})
        </Text>
      </View>

      {filteredInvoices.length === 0 ? (
        <View style={styles.emptyCard} testID="doctor-billing-empty-state">
          <Text style={styles.emptyTitle}>No matching invoices</Text>
          <Text style={styles.emptyBody}>
            Adjust your status filter or search query to view statements.
          </Text>
        </View>
      ) : (
        <View style={styles.invoiceList}>
          {filteredInvoices.map((inv) => (
            <BillingInvoiceCard
              key={inv.id}
              invoice={inv}
              roleScope="doctor"
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
          roleScope="doctor"
          invoices={invoices}
          onClose={() => setActiveMetricModal(null)}
          onSelectInvoice={onSelectInvoice}
          onAskBillingAI={onAskBillingAI}
          onApplyStatusFilter={(key) => {
            if (key === 'UNPAID') {
              setStatusFilter('pending');
            } else {
              setStatusFilter(key.toLowerCase() as StatusFilterKey);
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
  quickActionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  aiTriggerBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  aiTriggerBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#B45309',
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  metricCard: {
    flexBasis: '47%',
    flexGrow: 1,
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
  listHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  AlertTriangle,
  ArrowUpRight,
  CreditCard,
  FileText,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  User,
  X,
} from 'lucide-react-native';
import type { BillingRoleScope, SyntheticBillingInvoice } from '@/src/billing/types';
import {
  searchAuthorizedBillingRecords,
  type BillablePatientOption,
  type BillingSearchCategory,
  type BillingSearchResultItem,
} from '@/src/billing/api/billingService';
import { BillingModalShell } from './BillingModalShell';
import { ModalActionButtons } from '../ui/ModalActionButtons';

interface BillingGlobalSearchModalProps {
  visible: boolean;
  roleScope: BillingRoleScope;
  activeUserId: string;
  activeAccountLabel: string;
  invoices: SyntheticBillingInvoice[];
  billablePatients?: BillablePatientOption[];
  searchQuery: string;
  onChangeSearchQuery: (query: string) => void;
  onClose: () => void;
  onSelectInvoice: (invoice: SyntheticBillingInvoice) => void;
  onAskBillingAI: (invoice: SyntheticBillingInvoice) => void;
  isLoading?: boolean;
  errorMessage?: string | null;
  onRetry?: () => void;
}

const CATEGORY_TABS: Array<{
  key: BillingSearchCategory;
  label: string;
}> = [
  { key: 'all', label: 'All' },
  { key: 'invoice', label: 'Invoices' },
  { key: 'customer', label: 'Customers' },
  { key: 'transaction', label: 'Transactions' },
  { key: 'refund', label: 'Refunds' },
];

export function BillingGlobalSearchModal({
  visible,
  roleScope,
  activeUserId,
  activeAccountLabel,
  invoices,
  billablePatients,
  searchQuery,
  onChangeSearchQuery,
  onClose,
  onSelectInvoice,
  onAskBillingAI,
  isLoading = false,
  errorMessage = null,
  onRetry,
}: BillingGlobalSearchModalProps) {
  const inputRef = useRef<TextInput | null>(null);
  const [selectedCategory, setSelectedCategory] =
    useState<BillingSearchCategory>('all');
  const [simulatedError, setSimulatedError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      const timer = setTimeout(() => {
        try {
          inputRef.current?.focus();
        } catch {
          // ignore focus error in non-DOM test runner
        }
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [visible]);

  // Reset category filter when switching demo accounts
  useEffect(() => {
    setSelectedCategory('all');
    setSimulatedError(null);
  }, [activeUserId, roleScope]);

  const effectiveError =
    errorMessage ||
    simulatedError ||
    (searchQuery.trim().toLowerCase() === '__error__'
      ? 'Search service encountered a temporary error while querying billing records.'
      : null);

  const searchResponse = useMemo(
    () =>
      searchAuthorizedBillingRecords({
        query: searchQuery,
        category: selectedCategory,
        roleScope,
        activeUserId,
        invoices,
        billablePatients,
      }),
    [
      searchQuery,
      selectedCategory,
      roleScope,
      activeUserId,
      invoices,
      billablePatients,
    ]
  );

  const quickSuggestions = useMemo(() => {
    if (roleScope === 'doctor') {
      return [
        'PPB-INV-2026-1003',
        'Alex Rivera',
        'Jordan Taylor',
        'Overdue',
        'Refunded',
        'INSTRUMENT_DECLINED',
      ];
    }
    return [
      'Overdue',
      'Paid',
      'ADMIN-COPAY',
      'ADMIN-TELEHEALTH',
      'PayPal',
    ];
  }, [roleScope]);

  const handleClearQuery = () => {
    setSimulatedError(null);
    onChangeSearchQuery('');
    try {
      inputRef.current?.focus();
    } catch {
      // ignore
    }
  };

  const handleCloseModal = () => {
    setSimulatedError(null);
    onChangeSearchQuery('');
    onClose();
  };

  const getCategoryIcon = (category: BillingSearchResultItem['category']) => {
    switch (category) {
      case 'invoice':
        return <FileText size={16} color="#EA580C" />;
      case 'customer':
        return <User size={16} color="#2563EB" />;
      case 'transaction':
        return <CreditCard size={16} color="#047857" />;
      case 'refund':
        return <RotateCcw size={16} color="#6D28D9" />;
    }
  };

  const getBadgeColors = (tone: BillingSearchResultItem['badgeTone']) => {
    switch (tone) {
      case 'paid':
        return { bg: '#ECFDF5', border: '#A7F3D0', text: '#047857' };
      case 'overdue':
      case 'failed':
        return { bg: '#FEF2F2', border: '#FECACA', text: '#B91C1C' };
      case 'pending':
        return { bg: '#FFFBEB', border: '#FDE68A', text: '#B45309' };
      case 'refunded':
        return { bg: '#F5F3FF', border: '#DDD6FE', text: '#6D28D9' };
      default:
        return { bg: '#F1F5F9', border: '#CBD5E1', text: '#475569' };
    }
  };

  const searchInputTestId =
    roleScope === 'doctor'
      ? 'doctor-billing-search-input'
      : 'patient-billing-search-input';

  return (
    <BillingModalShell
      visible={visible}
      onClose={handleCloseModal}
      title="Search Billing Records"
      subtitle={`Scoped to ${activeAccountLabel} • Invoices, Customers, Transactions & Refunds`}
      testID="billing-global-search-modal"
      closeTestID="billing-global-search-close-btn"
      closeAccessibilityLabel="Close billing search"
      footer={
        <ModalActionButtons
          actions={[
            ...(searchQuery.trim().length > 0
              ? [
                  {
                    label: 'Clear Query',
                    onPress: handleClearQuery,
                    variant: 'secondary' as const,
                    testID: 'billing-global-search-footer-clear-btn',
                  },
                ]
              : []),
            {
              label: 'Done',
              onPress: handleCloseModal,
              variant: 'cancel' as const,
              testID: 'billing-global-search-done-btn',
            },
          ]}
        />
      }
    >
      {/* Account Isolation & Scope Indicator */}
      <View
        style={styles.scopeBanner}
        testID="billing-global-search-scope-banner"
      >
        <ShieldCheck size={14} color="#047857" />
        <Text style={styles.scopeBannerText}>
          Authorized scope: <Text style={styles.scopeBold}>{activeAccountLabel}</Text>{' '}
          ({roleScope === 'doctor' ? 'Provider Workspace' : 'Isolated Customer Account'})
        </Text>
      </View>

      {/* Search Input Bar */}
      <View style={styles.searchInputContainer} testID="billing-global-search-box">
        <Search size={18} color="#EA580C" />
        <TextInput
          ref={inputRef}
          style={styles.searchInput}
          placeholder={
            roleScope === 'doctor'
              ? 'Search invoice #, customer, service code, PayPal ID, or refund...'
              : 'Search statement #, service code, amount, PayPal ID, or status...'
          }
          placeholderTextColor="#94A3B8"
          value={searchQuery}
          onChangeText={(text) => {
            if (simulatedError) setSimulatedError(null);
            onChangeSearchQuery(text);
          }}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search billing records"
          testID={searchInputTestId}
        />
        {searchQuery.length > 0 ? (
          <Pressable
            style={styles.clearBtn}
            onPress={handleClearQuery}
            accessibilityRole="button"
            accessibilityLabel="Clear search query"
            testID="billing-global-search-clear-btn"
          >
            <X size={16} color="#475569" />
          </Pressable>
        ) : null}
      </View>

      {/* Category Filter Pills */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.categoryRow}
      >
        {CATEGORY_TABS.map((tab) => {
          const active = selectedCategory === tab.key;
          const count = searchResponse.countsByCategory[tab.key];
          return (
            <Pressable
              key={tab.key}
              style={[
                styles.categoryChip,
                active && styles.categoryChipActive,
              ]}
              onPress={() => setSelectedCategory(tab.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Filter search by ${tab.label} (${count})`}
              testID={`billing-search-category-${tab.key}`}
            >
              <Text
                style={[
                  styles.categoryChipText,
                  active && styles.categoryChipTextActive,
                ]}
              >
                {tab.label} ({count})
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Quick Suggestions when query is empty */}
      {searchQuery.trim().length === 0 ? (
        <View style={styles.suggestionsSection}>
          <Text style={styles.suggestionsLabel}>Quick Filters:</Text>
          <View style={styles.suggestionsWrap}>
            {quickSuggestions.map((suggestion) => (
              <Pressable
                key={suggestion}
                style={styles.suggestionPill}
                onPress={() => onChangeSearchQuery(suggestion)}
                accessibilityRole="button"
                accessibilityLabel={`Search for ${suggestion}`}
                testID={`billing-search-suggestion-${suggestion
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, '-')}`}
              >
                <Text style={styles.suggestionPillText}>{suggestion}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {/* Loading State */}
      {isLoading ? (
        <View
          style={styles.stateBox}
          testID="billing-global-search-loading-state"
        >
          <ActivityIndicator size="small" color="#EA580C" />
          <Text style={styles.stateTitle}>Searching billing records...</Text>
          <Text style={styles.stateSubtitle}>
            Checking authorized statements, transactions, and refunds.
          </Text>
        </View>
      ) : effectiveError ? (
        /* Error State */
        <View
          style={[styles.stateBox, styles.errorStateBox]}
          testID="billing-global-search-error-state"
        >
          <AlertTriangle size={22} color="#B91C1C" />
          <Text style={styles.errorStateTitle}>Unable to Complete Search</Text>
          <Text style={styles.errorStateSubtitle}>{effectiveError}</Text>
          <Pressable
            style={styles.retryBtn}
            onPress={() => {
              setSimulatedError(null);
              if (searchQuery.trim().toLowerCase() === '__error__') {
                onChangeSearchQuery('');
              }
              onRetry?.();
            }}
            accessibilityRole="button"
            accessibilityLabel="Retry search"
            testID="billing-global-search-retry-btn"
          >
            <Text style={styles.retryBtnText}>Clear & Retry</Text>
          </Pressable>
        </View>
      ) : searchResponse.results.length === 0 ? (
        /* Empty State */
        <View
          style={styles.stateBox}
          testID="billing-global-search-empty-state"
        >
          <Search size={22} color="#94A3B8" />
          <Text style={styles.stateTitle}>No Matching Billing Records</Text>
          <Text style={styles.stateSubtitle}>
            No authorized {selectedCategory === 'all' ? 'records' : `${selectedCategory}s`}{' '}
            matched "{searchQuery.trim()}". Try searching by invoice number (e.g.
            1003), customer name, service code, or payment status.
          </Text>
          {searchQuery.trim().length > 0 ? (
            <Pressable
              style={styles.clearEmptyBtn}
              onPress={handleClearQuery}
              accessibilityRole="button"
              testID="billing-global-search-empty-clear-btn"
            >
              <Text style={styles.clearEmptyBtnText}>Reset Search Query</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        /* Results List */
        <View
          style={styles.resultsList}
          testID="billing-global-search-results-list"
        >
          <Text style={styles.resultsHeaderCount}>
            Showing {searchResponse.results.length} matching{' '}
            {searchResponse.results.length === 1 ? 'record' : 'records'}
          </Text>
          {searchResponse.results.map((item) => {
            const badgeColors = getBadgeColors(item.badgeTone);
            return (
              <View
                key={item.id}
                style={styles.resultCard}
                testID={`billing-search-result-card-${item.id}`}
              >
                <Pressable
                  style={styles.resultMainTap}
                  onPress={() => {
                    onChangeSearchQuery('');
                    onClose();
                    onSelectInvoice(item.invoice);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${item.title}`}
                  testID={`billing-search-result-${item.id}`}
                >
                  <View style={styles.resultTopRow}>
                    <View style={styles.resultTitleRow}>
                      <View style={styles.categoryIconCircle}>
                        {getCategoryIcon(item.category)}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.resultTitle}>{item.title}</Text>
                        <Text style={styles.resultCategoryTag}>
                          {item.category.toUpperCase()}
                          {item.dateFormatted ? ` • ${item.dateFormatted}` : ''}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.resultRightCol}>
                      {item.amountFormatted ? (
                        <Text style={styles.resultAmount}>
                          {item.amountFormatted}
                        </Text>
                      ) : null}
                      <View
                        style={[
                          styles.resultBadge,
                          {
                            backgroundColor: badgeColors.bg,
                            borderColor: badgeColors.border,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.resultBadgeText,
                            { color: badgeColors.text },
                          ]}
                        >
                          {item.badgeText}
                        </Text>
                      </View>
                    </View>
                  </View>

                  <Text style={styles.resultSubtitle}>{item.subtitle}</Text>
                </Pressable>

                <View style={styles.resultActionsFooter}>
                  <Pressable
                    style={styles.openDetailChip}
                    onPress={() => {
                      onChangeSearchQuery('');
                      onClose();
                      onSelectInvoice(item.invoice);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`View statement ${item.invoice.invoiceNumber} details`}
                    testID={`billing-search-open-invoice-${item.id}`}
                  >
                    <ArrowUpRight size={13} color="#475569" />
                    <Text style={styles.openDetailChipText}>
                      Open #{item.invoice.invoiceNumber}
                    </Text>
                  </Pressable>

                  <Pressable
                    style={styles.askAiChip}
                    onPress={() => {
                      onChangeSearchQuery('');
                      onClose();
                      onAskBillingAI(item.invoice);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Ask Billing AI about ${item.invoice.invoiceNumber}`}
                    testID={
                      item.category === 'invoice'
                        ? `billing-invoice-ai-btn-${item.invoice.id}`
                        : `billing-search-ai-btn-${item.id}`
                    }
                  >
                    <Sparkles size={13} color="#EA580C" />
                    <Text style={styles.askAiChipText}>Ask Billing AI</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </BillingModalShell>
  );
}

const styles = StyleSheet.create({
  scopeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginBottom: 10,
  },
  scopeBannerText: {
    flex: 1,
    fontSize: 12,
    color: '#065F46',
    lineHeight: 16,
  },
  scopeBold: {
    fontWeight: '800',
    color: '#047857',
  },
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#FB923C',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#0F172A',
    paddingVertical: 4,
  },
  clearBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingBottom: 8,
  },
  categoryChip: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  categoryChipActive: {
    backgroundColor: '#EA580C',
    borderColor: '#C2410C',
  },
  categoryChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  categoryChipTextActive: {
    color: '#FFFFFF',
  },
  suggestionsSection: {
    marginBottom: 10,
  },
  suggestionsLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  suggestionsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  suggestionPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FED7AA',
  },
  suggestionPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9A3412',
  },
  stateBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 28,
    paddingHorizontal: 16,
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 8,
    marginTop: 6,
  },
  errorStateBox: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  stateTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'center',
  },
  stateSubtitle: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
  },
  errorStateTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#991B1B',
    textAlign: 'center',
  },
  errorStateSubtitle: {
    fontSize: 13,
    color: '#B91C1C',
    textAlign: 'center',
    lineHeight: 18,
  },
  retryBtn: {
    marginTop: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#B91C1C',
  },
  retryBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  clearEmptyBtn: {
    marginTop: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#EA580C',
  },
  clearEmptyBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  resultsList: {
    gap: 8,
    marginTop: 4,
  },
  resultsHeaderCount: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
    marginBottom: 2,
  },
  resultCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 12,
    gap: 8,
  },
  resultMainTap: {
    gap: 6,
  },
  resultTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  resultTitleRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  categoryIconCircle: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  resultTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
    lineHeight: 19,
  },
  resultCategoryTag: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
    marginTop: 2,
  },
  resultRightCol: {
    alignItems: 'flex-end',
    gap: 4,
  },
  resultAmount: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  resultBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  resultBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  resultSubtitle: {
    fontSize: 12,
    color: '#475569',
    lineHeight: 17,
  },
  resultActionsFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    gap: 8,
  },
  openDetailChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  openDetailChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  askAiChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FED7AA',
  },
  askAiChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#C2410C',
  },
});

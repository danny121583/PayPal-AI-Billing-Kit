import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import {
  FileText,
  Sparkles,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  FlaskConical,
} from 'lucide-react-native';
import { shadows } from '../../src/lib/shadow';
import type {
  BillingRoleScope,
  SyntheticBillingInvoice,
  SyntheticInvoiceStatus,
} from '../../src/billing/types';
import {
  formatBillingDate,
  formatUsdCents,
} from '../../src/billing/data/syntheticBillingFixtures';

export interface BillingInvoiceCardProps {
  invoice: SyntheticBillingInvoice;
  roleScope: BillingRoleScope;
  highlighted?: boolean;
  onSelect: (invoice: SyntheticBillingInvoice) => void;
  onAskBillingAI: (invoice: SyntheticBillingInvoice) => void;
}

function getStatusBadgeColors(status: SyntheticInvoiceStatus): {
  bg: string;
  border: string;
  text: string;
  label: string;
} {
  switch (status) {
    case 'paid':
      return {
        bg: '#ECFDF5',
        border: '#A7F3D0',
        text: '#047857',
        label: 'PAID',
      };
    case 'pending':
    case 'sent':
      return {
        bg: '#EFF6FF',
        border: '#BFDBFE',
        text: '#1D4ED8',
        label: 'PENDING',
      };
    case 'overdue':
      return {
        bg: '#FEF3C7',
        border: '#FDE68A',
        text: '#B45309',
        label: 'OVERDUE',
      };
    case 'failed':
      return {
        bg: '#FEF2F2',
        border: '#FECACA',
        text: '#B91C1C',
        label: 'PAYMENT FAILED',
      };
    case 'refunded':
      return {
        bg: '#F3E8FF',
        border: '#DDD6FE',
        text: '#6D28D9',
        label: 'REFUNDED',
      };
    case 'draft':
      return {
        bg: '#F3F4F6',
        border: '#E5E7EB',
        text: '#374151',
        label: 'DRAFT',
      };
    case 'void':
      return {
        bg: '#F3F4F6',
        border: '#D1D5DB',
        text: '#4B5563',
        label: 'VOIDED',
      };
  }
}

export default function BillingInvoiceCard({
  invoice,
  roleScope,
  highlighted = false,
  onSelect,
  onAskBillingAI,
}: BillingInvoiceCardProps) {
  const badge = getStatusBadgeColors(invoice.status);
  const isDoctor = roleScope === 'doctor';
  const counterpartLabel = isDoctor
    ? `Customer: ${invoice.patientDisplayName}`
    : `Provider: ${invoice.issuerDoctorName} • ${invoice.organizationName}`;

  const effectiveBalanceCents =
    invoice.status === 'void' ||
    invoice.status === 'refunded' ||
    invoice.status === 'paid'
      ? 0
      : invoice.balanceDueCents;

  const isSampleRecord = invoice.settlementVerificationStatus === 'sample_demo';
  const isVerifiedPayPalCapture =
    invoice.settlementVerificationStatus === 'paypal_verified';
  const primaryServiceCode = invoice.lineItems[0]?.serviceCode || 'ADMIN-SERVICE';
  const latestApprovalPending = invoice.paymentAttempts.find(
    (a) =>
      a.attemptClassification === 'approval_required' ||
      a.attemptClassification === 'awaiting_buyer_approval'
  );
  const latestFailure = invoice.paymentAttempts.find(
    (a) =>
      a.status === 'failed_demo' &&
      a.failureReason &&
      a.attemptClassification !== 'approval_required' &&
      a.attemptClassification !== 'awaiting_buyer_approval'
  );

  return (
    <View
      style={[styles.card, highlighted && styles.cardHighlighted]}
      testID={`billing-invoice-card-${invoice.id}`}
    >
      <Pressable
        style={styles.cardMainArea}
        onPress={() => onSelect(invoice)}
        accessibilityRole="button"
        accessibilityLabel={`Invoice ${invoice.invoiceNumber}, ${invoice.administrativeSummary}, original amount ${formatUsdCents(
          invoice.totalCents
        )}, remaining balance ${formatUsdCents(effectiveBalanceCents)}, status ${badge.label}`}
      >
        {/* Top Row: Date + Invoice Number + Status Badge */}
      <View style={styles.cardHeader}>
        <View style={styles.invoiceMetaRow}>
          <FileText size={16} color="#2563EB" />
          <Text style={styles.invoiceDateText}>
            {formatBillingDate(invoice.issuedAt)} • #{invoice.invoiceNumber}
          </Text>
        </View>
        <View
          style={[
            styles.statusBadge,
            { backgroundColor: badge.bg, borderColor: badge.border },
          ]}
        >
          <Text style={[styles.statusBadgeText, { color: badge.text }]}>
            {badge.label}
          </Text>
        </View>
      </View>

      {/* Main Title & Amounts Row */}
      <View style={styles.titleAmountRow}>
        <View style={styles.titleColumn}>
          <Text style={styles.serviceTitle}>{invoice.administrativeSummary}</Text>
          <Text style={styles.counterpartText}>{counterpartLabel}</Text>
        </View>
        <View style={styles.amountColumn}>
          <Text
            style={[
              styles.amountText,
              invoice.status === 'void' && styles.amountTextVoid,
            ]}
            testID={`billing-invoice-original-${invoice.id}`}
          >
            {formatUsdCents(invoice.totalCents)}
          </Text>
          <Text style={styles.currencySub}>Original {invoice.currencyCode}</Text>
        </View>
      </View>

      {/* Explicit Original vs Remaining Balance Strip */}
      <View
        style={styles.balanceSummaryRow}
        testID={`billing-invoice-balance-row-${invoice.id}`}
      >
        <View style={styles.balancePill}>
          <Text style={styles.balanceLabel}>Original Amount:</Text>
          <Text style={styles.balanceValue}>
            {formatUsdCents(invoice.totalCents)}
          </Text>
        </View>
        <View
          style={[
            styles.balancePill,
            effectiveBalanceCents > 0
              ? styles.balancePillDue
              : styles.balancePillZero,
          ]}
        >
          <Text style={styles.balanceLabel}>
            {invoice.status === 'void'
              ? 'Remaining (Voided):'
              : invoice.status === 'refunded'
                ? 'Remaining (Refunded):'
                : 'Remaining Balance:'}
          </Text>
          <Text
            style={[
              styles.balanceValue,
              effectiveBalanceCents > 0
                ? styles.balanceValueDue
                : styles.balanceValueZero,
            ]}
            testID={`billing-invoice-remaining-${invoice.id}`}
          >
            {formatUsdCents(effectiveBalanceCents)}
          </Text>
        </View>
      </View>

      {invoice.status === 'refunded' ? (
        <View
          style={styles.refundedBanner}
          testID={`billing-invoice-refund-banner-${invoice.id}`}
        >
          <Text style={styles.refundedBannerText}>
            Refunded:{' '}
            {formatUsdCents(invoice.amountRefundedCents || invoice.totalCents)} •
            Remaining Balance: {formatUsdCents(effectiveBalanceCents)}
          </Text>
        </View>
      ) : null}

      {/* Sample Demo Settlement vs Verified Live Capture Badge */}
      {invoice.receiptNumber ? (
        <View
          style={[
            styles.verificationBanner,
            isSampleRecord
              ? styles.sampleVerificationBanner
              : styles.liveVerificationBanner,
          ]}
          testID={`billing-invoice-settlement-badge-${invoice.id}`}
        >
          {isSampleRecord && !isVerifiedPayPalCapture ? (
            <>
              <FlaskConical size={14} color="#92400E" />
              <Text style={styles.sampleVerificationText}>
                Sample Demo Record ({invoice.receiptNumber}) — Not a Live PayPal
                Capture
              </Text>
            </>
          ) : (
            <>
              <CheckCircle2 size={14} color="#047857" />
              <Text style={styles.liveVerificationText}>
                Verified PayPal Sandbox Capture: {invoice.receiptNumber}
              </Text>
            </>
          )}
        </View>
      ) : null}

      {/* Summary Note */}
      <Text style={styles.descriptionText} numberOfLines={2}>
        {invoice.statementMemoSafe}
      </Text>

      {/* Awaiting Buyer Approval Actionable Notice */}
      {invoice.status !== 'paid' &&
      invoice.status !== 'refunded' &&
      invoice.status !== 'void' &&
      latestApprovalPending ? (
        <View
          style={styles.approvalPendingBanner}
          testID={`billing-invoice-approval-pending-${invoice.id}`}
        >
          <AlertTriangle size={15} color="#1D4ED8" />
          <Text style={styles.approvalPendingBannerText} numberOfLines={2}>
            {latestApprovalPending.actionableMessage ||
              'PayPal is waiting for buyer approval. Complete Sandbox checkout before capturing this payment.'}
          </Text>
        </View>
      ) : null}

      {/* Failed Payment Reason Banner */}
      {invoice.status === 'failed' && latestFailure?.failureReason ? (
        <View style={styles.failureBanner}>
          <AlertTriangle size={15} color="#B91C1C" />
          <Text style={styles.failureBannerText} numberOfLines={2}>
            {latestFailure.failureReason}
          </Text>
        </View>
      ) : null}
      </Pressable>

      {/* Footer Metadata & Action Strip */}
      <View style={styles.footerRow}>
        <View style={styles.metaPillRow}>
          <Text style={styles.metaText}>
            Code: {primaryServiceCode} • Due {formatBillingDate(invoice.dueDate)}
          </Text>
        </View>

        <View style={styles.actionsRight}>
          <Pressable
            style={styles.aiExplainChip}
            onPress={(e) => {
              e.stopPropagation?.();
              onAskBillingAI(invoice);
            }}
            accessibilityRole="button"
            accessibilityLabel={`Ask Billing AI about invoice ${invoice.invoiceNumber}`}
            testID={`billing-invoice-ai-btn-${invoice.id}`}
          >
            <Sparkles size={13} color="#B45309" />
            <Text style={styles.aiExplainChipText}>Ask Billing AI</Text>
          </Pressable>

          <Pressable
            style={styles.detailsChevron}
            onPress={() => onSelect(invoice)}
            accessibilityRole="button"
            accessibilityLabel={`View details for invoice ${invoice.invoiceNumber}`}
          >
            <Text style={styles.detailsText}>Details</Text>
            <ChevronRight size={15} color="#2563EB" />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    ...shadows.xs,
  },
  cardHighlighted: {
    borderColor: '#2563EB',
    borderWidth: 2,
    backgroundColor: '#F8FAFC',
  },
  cardMainArea: {
    width: '100%',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 10,
  },
  invoiceMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  invoiceDateText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#2563EB',
  },
  statusBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  titleAmountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  titleColumn: {
    flex: 1,
  },
  serviceTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  counterpartText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#4B5563',
    marginTop: 3,
  },
  amountColumn: {
    alignItems: 'flex-end',
  },
  amountText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
  },
  amountTextVoid: {
    color: '#6B7280',
    textDecorationLine: 'line-through',
  },
  currencySub: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
    marginTop: 2,
  },
  balanceSummaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  balancePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  balancePillDue: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  balancePillZero: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  balanceLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4B5563',
  },
  balanceValue: {
    fontSize: 13,
    fontWeight: '800',
    color: '#111827',
  },
  balanceValueDue: {
    color: '#B45309',
  },
  balanceValueZero: {
    color: '#047857',
  },
  refundedBanner: {
    marginTop: 8,
    backgroundColor: '#F5F3FF',
    borderWidth: 1,
    borderColor: '#DDD6FE',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  refundedBannerText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#5B21B6',
  },
  verificationBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  sampleVerificationBanner: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  liveVerificationBanner: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  sampleVerificationText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    color: '#92400E',
  },
  liveVerificationText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    color: '#065F46',
  },
  descriptionText: {
    fontSize: 13,
    lineHeight: 19,
    color: '#374151',
    marginTop: 8,
  },
  approvalPendingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  approvalPendingBannerText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: '#1E40AF',
    lineHeight: 17,
  },
  failureBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  failureBannerText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: '#991B1B',
    lineHeight: 17,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  metaPillRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  metaText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#4B5563',
  },
  actionsRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  aiExplainChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  aiExplainChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#B45309',
  },
  detailsChevron: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  detailsText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#2563EB',
  },
});

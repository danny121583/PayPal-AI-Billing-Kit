export type BillingRoleScope = 'doctor' | 'patient';

export type SyntheticInvoiceStatus =
  | 'pending'
  | 'overdue'
  | 'paid'
  | 'failed'
  | 'refunded'
  | 'draft'
  | 'sent'
  | 'void';

export interface SyntheticInvoiceLineItem {
  id: string;
  serviceCode: string;
  description: string;
  quantity: number;
  unitAmountCents: number;
  lineTotalCents: number;
}

export type PaymentAttemptClassification =
  | 'awaiting_buyer_approval'
  | 'approval_required'
  | 'payment_declined'
  | 'buyer_canceled'
  | 'authorized'
  | 'captured'
  | 'refunded'
  | 'processing_error';

export interface SyntheticPaymentAttempt {
  id: string;
  attemptedAt: string;
  amountCents: number;
  currencyCode: 'USD';
  status: 'failed_demo' | 'simulated_paid_demo' | 'pending_demo' | 'refunded_demo';
  statusLabel: string;
  failureReason?: string;
  demoReferenceCode: string;
  attemptClassification?: PaymentAttemptClassification;
  isGenuineFailure?: boolean;
  paymentSourceType?: 'paypal_wallet' | 'paypal_card' | 'demo_simulation';
  paypalErrorCode?: string;
  actionableMessage?: string;
  cardBrand?: string;
  cardLastDigits?: string;
}

export interface SyntheticBillingInvoice {
  id: string;
  invoiceNumber: string;
  organizationId: string;
  organizationName: string;
  issuerUserId?: string;
  issuerDoctorName: string;
  recipientUserId?: string;
  patientDisplayName: string;
  allowedRoleScopes: BillingRoleScope[];
  authorizedDoctorScope: 'org_primary_demo' | 'other_org_restricted';
  authorizedPatientScope: 'patient_primary_demo' | 'other_patient_restricted';
  status: SyntheticInvoiceStatus;
  currencyCode: 'USD';
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  amountPaidCents: number;
  amountRefundedCents: number;
  balanceDueCents: number;
  issuedAt: string;
  dueDate: string;
  paidAt?: string;
  refundedAt?: string;
  receiptNumber?: string;
  settlementVerificationStatus?: 'paypal_verified' | 'sample_demo' | 'unpaid';
  administrativeSummary: string;
  statementMemoSafe: string;
  isSyntheticDemoRecord: true;
  verificationNotice: string;
  lineItems: SyntheticInvoiceLineItem[];
  paymentAttempts: SyntheticPaymentAttempt[];
}

export interface BillingNotificationItem {
  id: string;
  recipientUserId: string;
  organizationId?: string | null;
  invoiceId: string | null;
  invoiceNumber?: string | null;
  type: string;
  title: string;
  body: string;
  deepLink: string;
  isRead: boolean;
  createdAt: string;
}

export interface DoctorBillingSummaryMetrics {
  outstandingBalanceCents: number;
  pendingInvoicesCount: number;
  pendingBalanceCents: number;
  overdueInvoicesCount: number;
  overdueBalanceCents: number;
  paidInvoicesCount: number;
  paidTotalCents: number;
  failedPaymentsCount: number;
  recentPaymentsCount: number;
}

export interface PatientBillingSummaryMetrics {
  amountCurrentlyDueCents: number;
  unpaidInvoicesCount: number;
  overdueInvoicesCount: number;
  overdueAmountCents: number;
  paidReceiptsCount: number;
  nextDueDate: string | null;
}

export type DeepLinkResolutionResult =
  | { status: 'none' }
  | { status: 'resolved'; invoice: SyntheticBillingInvoice; notificationId?: string }
  | { status: 'unauthenticated'; message: string }
  | { status: 'unauthorized'; invoiceId: string; message: string }
  | { status: 'not_found'; invoiceId: string; message: string };

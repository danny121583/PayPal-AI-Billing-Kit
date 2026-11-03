import type {
  BillingRoleScope,
  DeepLinkResolutionResult,
  DoctorBillingSummaryMetrics,
  PatientBillingSummaryMetrics,
  SyntheticBillingInvoice,
  SyntheticInvoiceStatus,
} from '../types';

export const SYNTHETIC_DEMO_BANNER_TEXT =
  'PAYPAL SANDBOX — Test environment only. No real money is charged and no sensitive clinical records are shared with PayPal.';

const ALL_SYNTHETIC_INVOICES: SyntheticBillingInvoice[] = [
  {
    id: '44444444-4444-4444-8444-444444444401',
    invoiceNumber: 'PPB-INV-2026-1001',
    organizationId: '22222222-2222-4222-8222-222222222201',
    organizationName: 'Jenkins Wellness & Telehealth Practice',
    issuerDoctorName: 'Dr. Sarah Jenkins',
    patientDisplayName: 'Alex Rivera',
    allowedRoleScopes: ['doctor', 'patient'],
    authorizedDoctorScope: 'org_primary_demo',
    authorizedPatientScope: 'patient_primary_demo',
    status: 'pending',
    currencyCode: 'USD',
    subtotalCents: 15000,
    taxCents: 0,
    totalCents: 15000,
    amountPaidCents: 0,
    amountRefundedCents: 0,
    balanceDueCents: 15000,
    issuedAt: '2026-10-28T14:30:00Z',
    dueDate: '2026-11-15T23:59:59Z',
    settlementVerificationStatus: 'unpaid',
    administrativeSummary: 'Administrative Telehealth Consultation',
    statementMemoSafe:
      'Administrative consultation statement only. Contains zero sensitive or clinical codes.',
    isSyntheticDemoRecord: true,
    verificationNotice:
      'PayPal Sandbox Statement — Administrative billing fields only.',
    lineItems: [
      {
        id: 'item-1001-1',
        serviceCode: 'ADMIN-TELEHEALTH',
        description: 'Administrative Telehealth Consultation',
        quantity: 1,
        unitAmountCents: 15000,
        lineTotalCents: 15000,
      },
    ],
    paymentAttempts: [],
  },
  {
    id: '44444444-4444-4444-8444-444444444402',
    invoiceNumber: 'PPB-INV-2026-1002',
    organizationId: '22222222-2222-4222-8222-222222222201',
    organizationName: 'Jenkins Wellness & Telehealth Practice',
    issuerDoctorName: 'Dr. Sarah Jenkins',
    patientDisplayName: 'Alex Rivera',
    allowedRoleScopes: ['doctor', 'patient'],
    authorizedDoctorScope: 'org_primary_demo',
    authorizedPatientScope: 'patient_primary_demo',
    status: 'overdue',
    currencyCode: 'USD',
    subtotalCents: 7500,
    taxCents: 0,
    totalCents: 7500,
    amountPaidCents: 0,
    amountRefundedCents: 0,
    balanceDueCents: 7500,
    issuedAt: '2026-10-01T10:00:00Z',
    dueDate: '2026-10-15T23:59:59Z',
    settlementVerificationStatus: 'unpaid',
    administrativeSummary: 'Care Coordination Administrative Review',
    statementMemoSafe: 'Past-due administrative statement in PayPal Sandbox.',
    isSyntheticDemoRecord: true,
    verificationNotice: 'PayPal Sandbox Statement — Past-due administrative balance.',
    lineItems: [
      {
        id: 'item-1002-1',
        serviceCode: 'ADMIN-CAREPLAN',
        description: 'Care Coordination Administrative Review',
        quantity: 1,
        unitAmountCents: 7500,
        lineTotalCents: 7500,
      },
    ],
    paymentAttempts: [],
  },
  {
    id: '44444444-4444-4444-8444-444444444403',
    invoiceNumber: 'PPB-INV-2026-1003',
    organizationId: '22222222-2222-4222-8222-222222222201',
    organizationName: 'Jenkins Wellness & Telehealth Practice',
    issuerDoctorName: 'Dr. Sarah Jenkins',
    patientDisplayName: 'Alex Rivera',
    allowedRoleScopes: ['doctor', 'patient'],
    authorizedDoctorScope: 'org_primary_demo',
    authorizedPatientScope: 'patient_primary_demo',
    status: 'paid',
    currencyCode: 'USD',
    subtotalCents: 12500,
    taxCents: 0,
    totalCents: 12500,
    amountPaidCents: 12500,
    amountRefundedCents: 0,
    balanceDueCents: 0,
    issuedAt: '2026-09-12T11:20:00Z',
    dueDate: '2026-09-26T23:59:59Z',
    paidAt: '2026-09-18T15:05:00Z',
    receiptNumber: 'SAMPLE-DEMO-SETTLEMENT-1003',
    settlementVerificationStatus: 'sample_demo',
    administrativeSummary: 'Administrative Follow-Up Review',
    statementMemoSafe:
      'Fictional sample settlement record seeded for UI preview (not a live PayPal Sandbox capture).',
    isSyntheticDemoRecord: true,
    verificationNotice:
      'Fictional Sample Record — Seeded demo settlement (not a live PayPal Sandbox capture).',
    lineItems: [
      {
        id: 'item-1003-1',
        serviceCode: 'ADMIN-FOLLOWUP',
        description: 'Administrative Follow-Up Review',
        quantity: 1,
        unitAmountCents: 12500,
        lineTotalCents: 12500,
      },
    ],
    paymentAttempts: [
      {
        id: 'att-demo-1003-1',
        attemptedAt: '2026-09-18T15:05:00Z',
        amountCents: 12500,
        currencyCode: 'USD',
        status: 'simulated_paid_demo',
        statusLabel: 'Sample Demo Settlement (Seeded)',
        demoReferenceCode: 'SAMPLE-DEMO-SETTLEMENT-1003',
        attemptClassification: 'captured',
        isGenuineFailure: false,
        paymentSourceType: 'demo_simulation',
      },
    ],
  },
  {
    id: '44444444-4444-4444-8444-444444444404',
    invoiceNumber: 'PPB-INV-2026-1004',
    organizationId: '22222222-2222-4222-8222-222222222201',
    organizationName: 'Jenkins Wellness & Telehealth Practice',
    issuerDoctorName: 'Dr. Sarah Jenkins',
    patientDisplayName: 'Jordan Taylor',
    allowedRoleScopes: ['doctor', 'patient'],
    authorizedDoctorScope: 'org_primary_demo',
    authorizedPatientScope: 'patient_primary_demo',
    status: 'failed',
    currencyCode: 'USD',
    subtotalCents: 5000,
    taxCents: 0,
    totalCents: 5000,
    amountPaidCents: 0,
    amountRefundedCents: 0,
    balanceDueCents: 5000,
    issuedAt: '2026-10-18T09:15:00Z',
    dueDate: '2026-11-12T23:59:59Z',
    settlementVerificationStatus: 'unpaid',
    administrativeSummary: 'Standard Visit Administrative Copay',
    statementMemoSafe:
      'Includes an unsuccessful payment attempt in PayPal Sandbox.',
    isSyntheticDemoRecord: true,
    verificationNotice:
      'PayPal Sandbox Statement — Previous payment authorization was not completed; no funds were charged.',
    lineItems: [
      {
        id: 'item-1004-1',
        serviceCode: 'ADMIN-COPAY',
        description: 'Standard Visit Administrative Copay',
        quantity: 1,
        unitAmountCents: 5000,
        lineTotalCents: 5000,
      },
    ],
    paymentAttempts: [
      {
        id: 'att-demo-1004-1',
        attemptedAt: '2026-10-24T16:42:00Z',
        amountCents: 5000,
        currencyCode: 'USD',
        status: 'failed_demo',
        statusLabel: 'Unsuccessful PayPal Attempt',
        failureReason:
          'PayPal Sandbox funding instrument declined by issuer. No funds were captured.',
        demoReferenceCode: 'DEMO-ORD-DECLINED-1004',
        attemptClassification: 'payment_declined',
        isGenuineFailure: true,
        paymentSourceType: 'paypal_card',
      },
    ],
  },
  {
    id: '44444444-4444-4444-8444-444444444405',
    invoiceNumber: 'PPB-INV-2026-1005',
    organizationId: '22222222-2222-4222-8222-222222222201',
    organizationName: 'Jenkins Wellness & Telehealth Practice',
    issuerDoctorName: 'Dr. Sarah Jenkins',
    patientDisplayName: 'Jordan Taylor',
    allowedRoleScopes: ['doctor', 'patient'],
    authorizedDoctorScope: 'org_primary_demo',
    authorizedPatientScope: 'patient_primary_demo',
    status: 'void',
    currencyCode: 'USD',
    subtotalCents: 3500,
    taxCents: 0,
    totalCents: 3500,
    amountPaidCents: 0,
    amountRefundedCents: 0,
    balanceDueCents: 0,
    issuedAt: '2026-10-20T09:00:00Z',
    dueDate: '2026-11-04T23:59:59Z',
    settlementVerificationStatus: 'unpaid',
    administrativeSummary: 'Administrative Forms Completion (Voided)',
    statementMemoSafe:
      'Voided administrative statement. Original amount $35.00; remaining balance $0.00.',
    isSyntheticDemoRecord: true,
    verificationNotice:
      'Voided Statement — Archived with $0.00 remaining balance.',
    lineItems: [
      {
        id: 'item-1005-1',
        serviceCode: 'ADMIN-FORMS',
        description: 'Administrative Forms Completion',
        quantity: 1,
        unitAmountCents: 3500,
        lineTotalCents: 3500,
      },
    ],
    paymentAttempts: [],
  },
  {
    id: '44444444-4444-4444-8444-444444444406',
    invoiceNumber: 'PPB-INV-2026-1006',
    organizationId: '22222222-2222-4222-8222-222222222201',
    organizationName: 'Jenkins Wellness & Telehealth Practice',
    issuerDoctorName: 'Dr. Sarah Jenkins',
    patientDisplayName: 'Alex Rivera',
    allowedRoleScopes: ['doctor', 'patient'],
    authorizedDoctorScope: 'org_primary_demo',
    authorizedPatientScope: 'patient_primary_demo',
    status: 'refunded',
    currencyCode: 'USD',
    subtotalCents: 4500,
    taxCents: 0,
    totalCents: 4500,
    amountPaidCents: 4500,
    amountRefundedCents: 4500,
    balanceDueCents: 0,
    issuedAt: '2026-08-20T08:00:00Z',
    dueDate: '2026-09-03T23:59:59Z',
    paidAt: '2026-08-22T13:10:00Z',
    refundedAt: '2026-08-25T10:30:00Z',
    receiptNumber: 'SAMPLE-DEMO-REFUND-1006',
    settlementVerificationStatus: 'sample_demo',
    administrativeSummary: 'Administrative Records Package (Refunded)',
    statementMemoSafe:
      'Refunded administrative statement. Original $45.00 refunded in full; remaining balance $0.00.',
    isSyntheticDemoRecord: true,
    verificationNotice:
      'Fictional Sample Refund Record — Full $45.00 refund recorded ($0.00 balance due).',
    lineItems: [
      {
        id: 'item-1006-1',
        serviceCode: 'ADMIN-RECORDS',
        description: 'Administrative Records Package',
        quantity: 1,
        unitAmountCents: 4500,
        lineTotalCents: 4500,
      },
    ],
    paymentAttempts: [
      {
        id: 'att-demo-1006-1',
        attemptedAt: '2026-08-25T10:30:00Z',
        amountCents: 4500,
        currencyCode: 'USD',
        status: 'refunded_demo',
        statusLabel: 'Sample Demo Refund ($45.00)',
        demoReferenceCode: 'SAMPLE-DEMO-REFUND-1006',
        attemptClassification: 'refunded',
        isGenuineFailure: false,
        paymentSourceType: 'demo_simulation',
      },
    ],
  },
  {
    id: 'demo-inv-restricted-other-org',
    invoiceNumber: 'PPB-INV-2026-9999',
    organizationId: 'org-external-unrelated',
    organizationName: 'Unrelated External Clinic',
    issuerDoctorName: 'Dr. Marcus Vance',
    patientDisplayName: 'Unrelated External Customer',
    allowedRoleScopes: [],
    authorizedDoctorScope: 'other_org_restricted',
    authorizedPatientScope: 'other_patient_restricted',
    status: 'pending',
    currencyCode: 'USD',
    subtotalCents: 99900,
    taxCents: 0,
    totalCents: 99900,
    amountPaidCents: 0,
    amountRefundedCents: 0,
    balanceDueCents: 99900,
    issuedAt: '2026-10-25T12:00:00Z',
    dueDate: '2026-11-25T12:00:00Z',
    administrativeSummary: 'Restricted Cross-Tenant Fixture (Never Displayed)',
    statementMemoSafe: 'Restricted test record.',
    isSyntheticDemoRecord: true,
    verificationNotice: 'Restricted record — never accessible.',
    lineItems: [],
    paymentAttempts: [],
  },
];

export function formatUsdCents(cents: number): string {
  const safe = Number.isFinite(cents) ? cents : 0;
  const sign = safe < 0 ? '-' : '';
  const abs = Math.abs(safe);
  return `${sign}$${(abs / 100).toFixed(2)}`;
}

export function formatBillingDate(isoString: string): string {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return isoString;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function getSyntheticInvoicesForRole(role: BillingRoleScope): SyntheticBillingInvoice[] {
  if (role === 'doctor') {
    return ALL_SYNTHETIC_INVOICES.filter(
      (inv) =>
        inv.allowedRoleScopes.includes('doctor') &&
        inv.authorizedDoctorScope === 'org_primary_demo'
    );
  }
  return ALL_SYNTHETIC_INVOICES.filter(
    (inv) =>
      inv.allowedRoleScopes.includes('patient') &&
      inv.authorizedPatientScope === 'patient_primary_demo'
  );
}

export function computeDoctorSummaryMetrics(
  invoices: SyntheticBillingInvoice[]
): DoctorBillingSummaryMetrics {
  let outstandingBalanceCents = 0;
  let pendingInvoicesCount = 0;
  let pendingBalanceCents = 0;
  let overdueInvoicesCount = 0;
  let overdueBalanceCents = 0;
  let paidInvoicesCount = 0;
  let paidTotalCents = 0;
  let failedPaymentsCount = 0;
  let recentPaymentsCount = 0;

  for (const inv of invoices) {
    if (
      inv.balanceDueCents > 0 &&
      inv.status !== 'void' &&
      inv.status !== 'refunded'
    ) {
      outstandingBalanceCents += inv.balanceDueCents;
    }
    if (inv.status === 'pending') {
      pendingInvoicesCount += 1;
      pendingBalanceCents += inv.balanceDueCents;
    } else if (inv.status === 'overdue') {
      overdueInvoicesCount += 1;
      overdueBalanceCents += inv.balanceDueCents;
    } else if (inv.status === 'paid') {
      paidInvoicesCount += 1;
      paidTotalCents += inv.amountPaidCents;
      recentPaymentsCount += 1;
    } else if (inv.status === 'failed') {
      const hasOnlyPendingApproval =
        inv.paymentAttempts.length > 0 &&
        inv.paymentAttempts.every(
          (a) =>
            a.attemptClassification === 'approval_required' ||
            a.attemptClassification === 'awaiting_buyer_approval' ||
            a.isGenuineFailure === false
        );
      if (hasOnlyPendingApproval) {
        pendingInvoicesCount += 1;
        pendingBalanceCents += inv.balanceDueCents;
      } else {
        failedPaymentsCount += 1;
      }
    }
  }

  return {
    outstandingBalanceCents,
    pendingInvoicesCount,
    pendingBalanceCents,
    overdueInvoicesCount,
    overdueBalanceCents,
    paidInvoicesCount,
    paidTotalCents,
    failedPaymentsCount,
    recentPaymentsCount,
  };
}

export function computePatientSummaryMetrics(
  invoices: SyntheticBillingInvoice[]
): PatientBillingSummaryMetrics {
  let amountCurrentlyDueCents = 0;
  let unpaidInvoicesCount = 0;
  let overdueInvoicesCount = 0;
  let overdueAmountCents = 0;
  let paidReceiptsCount = 0;
  let nextDueDate: string | null = null;

  for (const inv of invoices) {
    if (
      inv.balanceDueCents > 0 &&
      inv.status !== 'void' &&
      inv.status !== 'refunded' &&
      (inv.status === 'pending' || inv.status === 'overdue' || inv.status === 'failed')
    ) {
      amountCurrentlyDueCents += inv.balanceDueCents;
      unpaidInvoicesCount += 1;
      if (!nextDueDate || new Date(inv.dueDate).getTime() < new Date(nextDueDate).getTime()) {
        nextDueDate = inv.dueDate;
      }
    }
    if (inv.status === 'overdue') {
      overdueInvoicesCount += 1;
      overdueAmountCents += inv.balanceDueCents;
    }
    if (inv.status === 'paid' || inv.status === 'refunded') {
      paidReceiptsCount += 1;
    }
  }

  return {
    amountCurrentlyDueCents,
    unpaidInvoicesCount,
    overdueInvoicesCount,
    overdueAmountCents,
    paidReceiptsCount,
    nextDueDate,
  };
}

export function filterSyntheticInvoices(
  invoices: SyntheticBillingInvoice[],
  statusFilter: 'all' | SyntheticInvoiceStatus,
  searchQuery: string
): SyntheticBillingInvoice[] {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  return invoices.filter((inv) => {
    if (statusFilter !== 'all' && inv.status !== statusFilter) {
      return false;
    }
    if (!normalizedQuery) {
      return true;
    }
    const haystack = [
      inv.invoiceNumber,
      inv.patientDisplayName,
      inv.issuerDoctorName,
      inv.organizationName,
      inv.administrativeSummary,
      inv.status,
      ...inv.lineItems.map((li) => `${li.serviceCode} ${li.description}`),
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(normalizedQuery);
  });
}

export function resolveBillingDeepLinkInvoice(params: {
  isAuthenticated: boolean;
  role: BillingRoleScope | null;
  invoiceId?: string | null;
  notificationId?: string | null;
  additionalInvoices?: SyntheticBillingInvoice[];
}): DeepLinkResolutionResult {
  const rawInvoiceId = typeof params.invoiceId === 'string' ? params.invoiceId.trim() : '';
  const rawNotificationId =
    typeof params.notificationId === 'string' && params.notificationId.trim()
      ? params.notificationId.trim()
      : undefined;

  if (!rawInvoiceId) {
    return { status: 'none' };
  }

  if (!params.isAuthenticated || !params.role) {
    return {
      status: 'unauthenticated',
      message: 'Authentication is required before accessing billing statements or notification links.',
    };
  }

  const combined = [
    ...(Array.isArray(params.additionalInvoices) ? params.additionalInvoices : []),
    ...ALL_SYNTHETIC_INVOICES,
  ];

  const matchedRecord = combined.find(
    (inv) =>
      inv.id.toLowerCase() === rawInvoiceId.toLowerCase() ||
      inv.invoiceNumber.toLowerCase() === rawInvoiceId.toLowerCase()
  );

  if (!matchedRecord) {
    return {
      status: 'not_found',
      invoiceId: rawInvoiceId,
      message: `Invoice "${rawInvoiceId}" could not be found or is unavailable in this workspace.`,
    };
  }

  const isAuthorizedForRole =
    params.role === 'doctor'
      ? matchedRecord.allowedRoleScopes.includes('doctor') &&
        matchedRecord.authorizedDoctorScope === 'org_primary_demo'
      : matchedRecord.allowedRoleScopes.includes('patient') &&
        matchedRecord.authorizedPatientScope === 'patient_primary_demo';

  if (!isAuthorizedForRole) {
    return {
      status: 'unauthorized',
      invoiceId: rawInvoiceId,
      message:
        'Access Denied: You do not have permission to view this invoice under your current role or organization.',
    };
  }

  return {
    status: 'resolved',
    invoice: matchedRecord,
    notificationId: rawNotificationId,
  };
}

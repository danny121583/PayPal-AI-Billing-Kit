import { supabase } from '@/src/lib/supabase';
import type {
  BillingNotificationItem,
  BillingRoleScope,
  PaymentAttemptClassification,
  SyntheticBillingInvoice,
  SyntheticInvoiceLineItem,
  SyntheticInvoiceStatus,
  SyntheticPaymentAttempt,
} from '../types';
import { getSyntheticInvoicesForRole } from '../data/syntheticBillingFixtures';

const sb = supabase as any;

const DEMO_SESSION_STORAGE_KEY = '@ppb_demo_session_id_v1';
let activeDemoSessionCache: string | null = null;

export const DEMO_USER_IDS = {
  sarah_jenkins: '11111111-1111-4111-8111-111111111101',
  alex_rivera: '11111111-1111-4111-8111-111111111102',
  jordan_taylor: '11111111-1111-4111-8111-111111111103',
} as const;

export function getActiveDemoUserId(roleScope: BillingRoleScope): string {
  return roleScope === 'doctor'
    ? DEMO_USER_IDS.sarah_jenkins
    : DEMO_USER_IDS.alex_rivera;
}

const ALL_DEMO_USER_IDS = [
  DEMO_USER_IDS.sarah_jenkins,
  DEMO_USER_IDS.alex_rivera,
  DEMO_USER_IDS.jordan_taylor,
];

function readWebStorage(key: string): string | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(key);
    }
  } catch {
    // ignore
  }
  return null;
}

function writeWebStorage(key: string, value: string): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(key, value);
    }
  } catch {
    // ignore
  }
}

export function getOrCreateDemoSessionIdSync(): string {
  if (process.env.NODE_ENV === 'test') {
    return 'canonical';
  }
  if (activeDemoSessionCache) {
    return activeDemoSessionCache;
  }
  try {
    if (typeof window !== 'undefined' && window.location?.search) {
      const params = new URLSearchParams(window.location.search);
      const fromUrl = params.get('demo_session_id') || params.get('session');
      if (fromUrl && /^[a-zA-Z0-9_-]{3,64}$/.test(fromUrl)) {
        activeDemoSessionCache = fromUrl;
        writeWebStorage(DEMO_SESSION_STORAGE_KEY, fromUrl);
        return fromUrl;
      }
    }
    const stored = readWebStorage(DEMO_SESSION_STORAGE_KEY);
    if (stored && /^[a-zA-Z0-9_-]{3,64}$/.test(stored)) {
      activeDemoSessionCache = stored;
      return stored;
    }
    const generated = `demo-sess-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    activeDemoSessionCache = generated;
    writeWebStorage(DEMO_SESSION_STORAGE_KEY, generated);
    return generated;
  } catch {
    if (!activeDemoSessionCache) {
      activeDemoSessionCache = `demo-sess-${Date.now().toString(36)}`;
    }
    return activeDemoSessionCache;
  }
}

export async function getOrCreateDemoSessionId(): Promise<string> {
  return getOrCreateDemoSessionIdSync();
}

export async function rotateDemoSessionId(): Promise<string> {
  const generated = `demo-sess-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  activeDemoSessionCache = generated;
  writeWebStorage(DEMO_SESSION_STORAGE_KEY, generated);
  return generated;
}

export interface BillablePatientOption {
  patientId: string;
  fullName: string;
  emailMasked: string | null;
}

export interface BillingServiceCatalogItem {
  code: string;
  title: string;
  description: string;
  defaultAmountMinor: number;
  currency: 'USD';
}

export interface BillingAISettingsRecord {
  userId: string;
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
  requireHumanApproval: true;
  blockClinicalData: true;
  paypalConfirmationRequired: true;
  updatedAt: string;
}

export interface PayPalAccountConnectionSummary {
  connected: boolean;
  environment: 'sandbox' | 'live';
  connectionType: 'merchant' | 'payer';
  paypalEmailMasked: string | null;
  paypalPayerIdMasked: string | null;
  connectedAt: string | null;
  sandboxCredentialsConfigured: boolean;
  oauthVerified?: boolean;
}

export interface BillingAuditEventItem {
  id: number;
  eventType: string;
  actorKind: 'user' | 'ai' | 'system' | 'paypal';
  createdAt: string;
  details: Record<string, unknown>;
}

export interface BillingDashboardData {
  invoices: SyntheticBillingInvoice[];
  catalog: BillingServiceCatalogItem[];
  billablePatients: BillablePatientOption[];
  settings: BillingAISettingsRecord;
  connection: PayPalAccountConnectionSummary;
  auditEvents: BillingAuditEventItem[];
  notifications: BillingNotificationItem[];
  isLiveStagingData: boolean;
}

export const DEFAULT_BILLABLE_PATIENTS: BillablePatientOption[] = [
  {
    patientId: DEMO_USER_IDS.alex_rivera,
    fullName: 'Alex Rivera',
    emailMasked: 'a***@demo.paypal-billing-kit.local',
  },
  {
    patientId: DEMO_USER_IDS.jordan_taylor,
    fullName: 'Jordan Taylor',
    emailMasked: 'j***@demo.paypal-billing-kit.local',
  },
];

export const DEFAULT_SERVICE_CATALOG: BillingServiceCatalogItem[] = [
  {
    code: 'ADMIN-TELEHEALTH',
    title: 'Administrative Telehealth Consultation',
    description: 'Administrative telehealth scheduling and consultation fee',
    defaultAmountMinor: 15000,
    currency: 'USD',
  },
  {
    code: 'ADMIN-FOLLOWUP',
    title: 'Administrative Follow-Up Review',
    description: 'Standard follow-up administrative statement fee',
    defaultAmountMinor: 12500,
    currency: 'USD',
  },
  {
    code: 'ADMIN-RECORDS',
    title: 'Administrative Records Package',
    description: 'Administrative records preparation and transfer fee',
    defaultAmountMinor: 4500,
    currency: 'USD',
  },
  {
    code: 'ADMIN-FORMS',
    title: 'Administrative Forms Completion',
    description: 'Administrative school, work, or insurance form completion fee',
    defaultAmountMinor: 3500,
    currency: 'USD',
  },
  {
    code: 'ADMIN-COPAY',
    title: 'Standard Visit Administrative Copay',
    description: 'Administrative visit copayment statement',
    defaultAmountMinor: 5000,
    currency: 'USD',
  },
  {
    code: 'ADMIN-CAREPLAN',
    title: 'Care Coordination Administrative Review',
    description: 'Administrative care coordination and plan documentation fee',
    defaultAmountMinor: 7500,
    currency: 'USD',
  },
  {
    code: 'ADMIN-PRIORAUTH',
    title: 'Prior Authorization Administrative Processing',
    description: 'Administrative prior authorization processing fee',
    defaultAmountMinor: 5000,
    currency: 'USD',
  },
];

export function getDefaultBillingAISettings(userId = 'default'): BillingAISettingsRecord {
  return {
    userId,
    maxSingleActionMinor: 50000,
    dailyLimitMinor: 250000,
    allowInvoiceDrafting: true,
    allowReminderDrafting: true,
    allowCheckoutAssistance: true,
    warnDuplicates: true,
    notifyNewInvoice: true,
    notifyPaymentConfirmed: true,
    notifyPaymentFailed: true,
    notifyOverdue: true,
    notifyRefund: true,
    reminderDaysBeforeDue: 3,
    requireHumanApproval: true,
    blockClinicalData: true,
    paypalConfirmationRequired: true,
    updatedAt: new Date().toISOString(),
  };
}

export function getDefaultPayPalConnection(
  roleScope: BillingRoleScope,
  userId?: string
): PayPalAccountConnectionSummary {
  const isDoctor = roleScope === 'doctor';
  const isJordan = userId === DEMO_USER_IDS.jordan_taylor;
  return {
    connected: true,
    environment: 'sandbox',
    connectionType: isDoctor ? 'merchant' : 'payer',
    paypalEmailMasked: isDoctor
      ? 'sb-***@business.example.com'
      : 'sb-***@personal.example.com',
    paypalPayerIdMasked: isDoctor
      ? 'PAYPAL-SANDBOX-MERCHANT'
      : isJordan
        ? 'SB-PAYER-JORDAN-1003'
        : 'SB-PAYER-ALEX-1002',
    connectedAt: '2026-11-02T21:35:00.000Z',
    sandboxCredentialsConfigured: true,
    oauthVerified: true,
  };
}

interface PreloadedSessionCache {
  sessionId: string | null;
  loadedAt: number;
  isLiveStagingData: boolean;
  invoices: SyntheticBillingInvoice[];
  catalog: BillingServiceCatalogItem[];
  billablePatients: BillablePatientOption[];
  auditEvents: BillingAuditEventItem[];
  settingsByUserId: Record<string, BillingAISettingsRecord>;
  connectionsByUserId: Record<string, PayPalAccountConnectionSummary>;
  notificationsByUserId: Record<string, BillingNotificationItem[]>;
}

const localReadNotificationIds = new Set<string>();
const localSessionInvoiceOverridesBySession = new Map<
  string,
  Map<string, Record<string, any>>
>();

const CANONICAL_ORG_ID = '22222222-2222-4222-8222-222222222201';

const CANONICAL_SEED_INVOICE_BASELINE: Record<
  string,
  {
    invoice_number: string;
    issuer_user_id: string;
    recipient_user_id: string;
    status: string;
    total_minor: number;
    amount_paid_minor: number;
    amount_refunded_minor: number;
    balance_due_minor: number;
    days_offset_due: number;
  }
> = {
  '33333333-3333-4333-8333-333333333301': {
    invoice_number: 'PPB-INV-2026-1001',
    issuer_user_id: DEMO_USER_IDS.sarah_jenkins,
    recipient_user_id: DEMO_USER_IDS.alex_rivera,
    status: 'sent',
    total_minor: 15000,
    amount_paid_minor: 0,
    amount_refunded_minor: 0,
    balance_due_minor: 15000,
    days_offset_due: 10,
  },
  '33333333-3333-4333-8333-333333333302': {
    invoice_number: 'PPB-INV-2026-1002',
    issuer_user_id: DEMO_USER_IDS.sarah_jenkins,
    recipient_user_id: DEMO_USER_IDS.alex_rivera,
    status: 'sent',
    total_minor: 7500,
    amount_paid_minor: 0,
    amount_refunded_minor: 0,
    balance_due_minor: 7500,
    days_offset_due: -5,
  },
  '33333333-3333-4333-8333-333333333303': {
    invoice_number: 'PPB-INV-2026-1003',
    issuer_user_id: DEMO_USER_IDS.sarah_jenkins,
    recipient_user_id: DEMO_USER_IDS.alex_rivera,
    status: 'paid',
    total_minor: 12500,
    amount_paid_minor: 12500,
    amount_refunded_minor: 0,
    balance_due_minor: 0,
    days_offset_due: 3,
  },
  '33333333-3333-4333-8333-333333333304': {
    invoice_number: 'PPB-INV-2026-1004',
    issuer_user_id: DEMO_USER_IDS.sarah_jenkins,
    recipient_user_id: DEMO_USER_IDS.jordan_taylor,
    status: 'sent',
    total_minor: 5000,
    amount_paid_minor: 0,
    amount_refunded_minor: 0,
    balance_due_minor: 5000,
    days_offset_due: 7,
  },
  '33333333-3333-4333-8333-333333333305': {
    invoice_number: 'PPB-INV-2026-1005',
    issuer_user_id: DEMO_USER_IDS.sarah_jenkins,
    recipient_user_id: DEMO_USER_IDS.jordan_taylor,
    status: 'void',
    total_minor: 3500,
    amount_paid_minor: 0,
    amount_refunded_minor: 0,
    balance_due_minor: 0,
    days_offset_due: 5,
  },
  '33333333-3333-4333-8333-333333333306': {
    invoice_number: 'PPB-INV-2026-1006',
    issuer_user_id: DEMO_USER_IDS.sarah_jenkins,
    recipient_user_id: DEMO_USER_IDS.alex_rivera,
    status: 'refunded',
    total_minor: 4500,
    amount_paid_minor: 4500,
    amount_refunded_minor: 4500,
    balance_due_minor: 0,
    days_offset_due: -3,
  },
};

function isNotificationMarkedReadLocally(userId: string, notifId: string): boolean {
  return (
    localReadNotificationIds.has(`${userId}:${notifId}`) ||
    localReadNotificationIds.has(notifId)
  );
}

/**
 * Canonical seed notification baseline strictly reconciled with authoritative
 * invoice ownership in billing_invoices and syntheticBillingFixtures:
 *  - Alex Rivera (1111...1102): PPB-INV-2026-1001, 1002, 1003, 1006
 *  - Jordan Taylor (1111...1103): PPB-INV-2026-1004 (and 1005 voided)
 *  - Dr. Sarah Jenkins (1111...1101): Merchant practice notifications (1003, 1002, 1004)
 */
export function getDefaultNotificationsByUserId(): Record<string, BillingNotificationItem[]> {
  return {
    [DEMO_USER_IDS.sarah_jenkins]: [
      {
        id: 'notif-seed-doc-1003',
        recipientUserId: DEMO_USER_IDS.sarah_jenkins,
        organizationId: CANONICAL_ORG_ID,
        invoiceId: '33333333-3333-4333-8333-333333333303',
        invoiceNumber: 'PPB-INV-2026-1003',
        type: 'payment_confirmed',
        title: 'Payment received',
        body: 'A customer payment ($125.00 USD) was received for invoice PPB-INV-2026-1003 (Alex Rivera).',
        deepLink: '/billing?invoiceId=33333333-3333-4333-8333-333333333303',
        isRead: isNotificationMarkedReadLocally(
          DEMO_USER_IDS.sarah_jenkins,
          'notif-seed-doc-1003'
        ),
        createdAt: '2026-11-03T04:35:00.000Z',
      },
      {
        id: 'notif-seed-doc-1002',
        recipientUserId: DEMO_USER_IDS.sarah_jenkins,
        organizationId: CANONICAL_ORG_ID,
        invoiceId: '33333333-3333-4333-8333-333333333302',
        invoiceNumber: 'PPB-INV-2026-1002',
        type: 'invoice_overdue',
        title: 'Overdue statement alert',
        body: 'Statement PPB-INV-2026-1002 ($75.00 USD for Alex Rivera) is past due.',
        deepLink: '/billing?invoiceId=33333333-3333-4333-8333-333333333302',
        isRead: isNotificationMarkedReadLocally(
          DEMO_USER_IDS.sarah_jenkins,
          'notif-seed-doc-1002'
        ),
        createdAt: '2026-11-03T03:00:00.000Z',
      },
      {
        id: 'notif-seed-doc-1004',
        recipientUserId: DEMO_USER_IDS.sarah_jenkins,
        organizationId: CANONICAL_ORG_ID,
        invoiceId: '33333333-3333-4333-8333-333333333304',
        invoiceNumber: 'PPB-INV-2026-1004',
        type: 'payment_failed',
        title: 'Payment attempt declined',
        body: 'A card payment attempt on statement PPB-INV-2026-1004 ($50.00 USD for Jordan Taylor) was declined.',
        deepLink: '/billing?invoiceId=33333333-3333-4333-8333-333333333304',
        isRead: isNotificationMarkedReadLocally(
          DEMO_USER_IDS.sarah_jenkins,
          'notif-seed-doc-1004'
        ),
        createdAt: '2026-11-03T01:15:00.000Z',
      },
    ],
    [DEMO_USER_IDS.alex_rivera]: [
      {
        id: 'notif-seed-alex-1002',
        recipientUserId: DEMO_USER_IDS.alex_rivera,
        organizationId: CANONICAL_ORG_ID,
        invoiceId: '33333333-3333-4333-8333-333333333302',
        invoiceNumber: 'PPB-INV-2026-1002',
        type: 'invoice_overdue',
        title: 'Overdue statement reminder',
        body: 'Statement PPB-INV-2026-1002 ($75.00 USD) from Dr. Sarah Jenkins is overdue.',
        deepLink: '/billing?invoiceId=33333333-3333-4333-8333-333333333302',
        isRead: isNotificationMarkedReadLocally(
          DEMO_USER_IDS.alex_rivera,
          'notif-seed-alex-1002'
        ),
        createdAt: '2026-11-03T04:00:00.000Z',
      },
      {
        id: 'notif-seed-alex-1001',
        recipientUserId: DEMO_USER_IDS.alex_rivera,
        organizationId: CANONICAL_ORG_ID,
        invoiceId: '33333333-3333-4333-8333-333333333301',
        invoiceNumber: 'PPB-INV-2026-1001',
        type: 'invoice_sent',
        title: 'New invoice',
        body: 'You have received a new invoice (PPB-INV-2026-1001 • $150.00 USD) from Dr. Sarah Jenkins.',
        deepLink: '/billing?invoiceId=33333333-3333-4333-8333-333333333301',
        isRead: isNotificationMarkedReadLocally(
          DEMO_USER_IDS.alex_rivera,
          'notif-seed-alex-1001'
        ),
        createdAt: '2026-11-03T02:30:00.000Z',
      },
      {
        id: 'notif-seed-alex-1003',
        recipientUserId: DEMO_USER_IDS.alex_rivera,
        organizationId: CANONICAL_ORG_ID,
        invoiceId: '33333333-3333-4333-8333-333333333303',
        invoiceNumber: 'PPB-INV-2026-1003',
        type: 'payment_confirmed',
        title: 'Payment confirmed',
        body: 'Your payment ($125.00 USD) for invoice PPB-INV-2026-1003 has been confirmed.',
        deepLink: '/billing?invoiceId=33333333-3333-4333-8333-333333333303',
        isRead: isNotificationMarkedReadLocally(
          DEMO_USER_IDS.alex_rivera,
          'notif-seed-alex-1003'
        ),
        createdAt: '2026-11-03T01:30:00.000Z',
      },
      {
        id: 'notif-seed-alex-1006',
        recipientUserId: DEMO_USER_IDS.alex_rivera,
        organizationId: CANONICAL_ORG_ID,
        invoiceId: '33333333-3333-4333-8333-333333333306',
        invoiceNumber: 'PPB-INV-2026-1006',
        type: 'refund_completed',
        title: 'Refund completed',
        body: 'Your $45.00 USD refund for invoice PPB-INV-2026-1006 has been completed.',
        deepLink: '/billing?invoiceId=33333333-3333-4333-8333-333333333306',
        isRead: true,
        createdAt: '2026-11-02T22:00:00.000Z',
      },
    ],
    [DEMO_USER_IDS.jordan_taylor]: [
      {
        id: 'notif-seed-jordan-1004',
        recipientUserId: DEMO_USER_IDS.jordan_taylor,
        organizationId: CANONICAL_ORG_ID,
        invoiceId: '33333333-3333-4333-8333-333333333304',
        invoiceNumber: 'PPB-INV-2026-1004',
        type: 'payment_failed',
        title: 'Payment not completed',
        body: 'Your payment attempt on statement PPB-INV-2026-1004 ($50.00 USD) was declined. Tap to retry.',
        deepLink: '/billing?invoiceId=33333333-3333-4333-8333-333333333304',
        isRead: isNotificationMarkedReadLocally(
          DEMO_USER_IDS.jordan_taylor,
          'notif-seed-jordan-1004'
        ),
        createdAt: '2026-11-03T04:15:00.000Z',
      },
    ],
  };
}

/**
 * Authorizes and filters notifications for the active account using dual-ownership
 * verification (notification recipient + linked invoice owner/merchant scope).
 * Fails closed (`[]`) if user context or role scope is missing, invalid, or mismatched.
 */
export function authorizeAndFilterNotificationsForAccount(params: {
  notifications: BillingNotificationItem[];
  roleScope: BillingRoleScope | null | undefined;
  activeUserId: string | null | undefined;
  invoices: SyntheticBillingInvoice[];
  authorizedOrganizationIds?: string[];
}): BillingNotificationItem[] {
  const {
    notifications,
    roleScope,
    activeUserId,
    invoices,
    authorizedOrganizationIds = [CANONICAL_ORG_ID],
  } = params;

  if (
    (roleScope !== 'doctor' && roleScope !== 'patient') ||
    typeof activeUserId !== 'string' ||
    !activeUserId.trim() ||
    !Array.isArray(notifications)
  ) {
    return [];
  }

  const normalizedUid = activeUserId.trim().toLowerCase();
  const isDoctorId = normalizedUid === DEMO_USER_IDS.sarah_jenkins.toLowerCase();
  const isAlexId = normalizedUid === DEMO_USER_IDS.alex_rivera.toLowerCase();
  const isJordanId = normalizedUid === DEMO_USER_IDS.jordan_taylor.toLowerCase();

  // Fail closed on unknown user IDs or role/account mismatch
  if (roleScope === 'doctor' && !isDoctorId) {
    return [];
  }
  if (roleScope === 'patient' && isDoctorId) {
    return [];
  }
  if (roleScope === 'patient' && !isAlexId && !isJordanId) {
    // Allow custom test customer UUIDs only if they own at least one invoice in `invoices`
    const ownsAnyInvoice = (invoices || []).some(
      (inv) =>
        inv.recipientUserId &&
        inv.recipientUserId.trim().toLowerCase() === normalizedUid
    );
    if (!ownsAnyInvoice) {
      return [];
    }
  }

  const allowedOrgSet = new Set(
    authorizedOrganizationIds.map((o) => String(o).toLowerCase())
  );

  const expectedCustomerName = isAlexId
    ? 'alex rivera'
    : isJordanId
      ? 'jordan taylor'
      : null;
  const forbiddenOtherCustomerName = isAlexId
    ? 'jordan taylor'
    : isJordanId
      ? 'alex rivera'
      : null;

  const authorized: BillingNotificationItem[] = [];
  const seenIds = new Set<string>();

  for (const n of notifications) {
    if (!n || typeof n !== 'object') continue;
    const notifId = String(n.id || '').trim();
    if (!notifId || seenIds.has(notifId)) continue;

    const notifRecipient = String(n.recipientUserId || '').trim().toLowerCase();
    if (!notifRecipient || notifRecipient !== normalizedUid) {
      continue;
    }

    if (
      n.organizationId &&
      !allowedOrgSet.has(String(n.organizationId).trim().toLowerCase())
    ) {
      continue;
    }

    // Extract invoice references from invoiceId, deepLink, invoiceNumber, and text
    const rawInvId = n.invoiceId ? String(n.invoiceId).trim() : null;
    let dlInvId: string | null = null;
    if (n.deepLink) {
      const dlMatch = String(n.deepLink).match(/[?&]invoiceId=([^&#]+)/i);
      if (dlMatch) {
        try {
          dlInvId = decodeURIComponent(dlMatch[1]).trim();
        } catch {
          dlInvId = dlMatch[1].trim();
        }
      }
    }
    const textCombined = `${n.title || ''} ${n.body || ''}`;
    const textInvMatch = textCombined.match(/\b((?:PPB|HER)-INV-\d{4}-\d+)\b/i);
    const extractedInvNum = (
      n.invoiceNumber || (textInvMatch ? textInvMatch[1] : '')
    )
      .trim()
      .toUpperCase();

    const candidateId = rawInvId || dlInvId;
    if (!candidateId && !extractedInvNum) {
      // Orphan notification with no linked statement is excluded
      continue;
    }

    // Find linked invoice in current session invoices
    const byId = candidateId
      ? (invoices || []).find(
          (inv) =>
            inv.id.toLowerCase() === candidateId.toLowerCase() ||
            inv.invoiceNumber.toLowerCase() === candidateId.toLowerCase()
        )
      : undefined;
    const byNum = extractedInvNum
      ? (invoices || []).find(
          (inv) => inv.invoiceNumber.toUpperCase() === extractedInvNum
        )
      : undefined;

    // If both ID and invoiceNumber are present, they MUST resolve to the exact same invoice
    if (byId && byNum && byId.id !== byNum.id) {
      continue;
    }

    const matchedInvoice = byId || byNum;
    if (!matchedInvoice) {
      // Linked invoice does not exist (deleted or belongs to another session/org)
      continue;
    }

    if (
      matchedInvoice.organizationId &&
      !allowedOrgSet.has(matchedInvoice.organizationId.toLowerCase())
    ) {
      continue;
    }

    if (roleScope === 'patient') {
      if (matchedInvoice.status === 'draft') {
        continue;
      }
      if (
        matchedInvoice.recipientUserId &&
        matchedInvoice.recipientUserId.trim().toLowerCase() !== normalizedUid
      ) {
        continue;
      }
      if (
        expectedCustomerName &&
        matchedInvoice.patientDisplayName.trim().toLowerCase() !==
          expectedCustomerName
      ) {
        continue;
      }
      if (
        forbiddenOtherCustomerName &&
        textCombined.toLowerCase().includes(forbiddenOtherCustomerName)
      ) {
        continue;
      }
    } else {
      // Doctor / provider scope: must belong to provider's authorized organization and issuer
      if (matchedInvoice.authorizedDoctorScope !== 'org_primary_demo') {
        continue;
      }
      if (
        matchedInvoice.issuerUserId &&
        matchedInvoice.issuerUserId.trim().toLowerCase() !== normalizedUid
      ) {
        continue;
      }
    }

    seenIds.add(notifId);
    authorized.push({
      ...n,
      invoiceId: matchedInvoice.id,
      invoiceNumber: matchedInvoice.invoiceNumber,
      organizationId: matchedInvoice.organizationId,
      deepLink: `/billing?invoiceId=${encodeURIComponent(matchedInvoice.id)}`,
    });
  }

  return authorized;
}

const preloadedCache: PreloadedSessionCache = {
  sessionId: null,
  loadedAt: 0,
  isLiveStagingData: false,
  invoices: getSyntheticInvoicesForRole('doctor'),
  catalog: DEFAULT_SERVICE_CATALOG,
  billablePatients: DEFAULT_BILLABLE_PATIENTS,
  auditEvents: [],
  settingsByUserId: {
    [DEMO_USER_IDS.sarah_jenkins]: getDefaultBillingAISettings(DEMO_USER_IDS.sarah_jenkins),
    [DEMO_USER_IDS.alex_rivera]: getDefaultBillingAISettings(DEMO_USER_IDS.alex_rivera),
    [DEMO_USER_IDS.jordan_taylor]: getDefaultBillingAISettings(DEMO_USER_IDS.jordan_taylor),
  },
  connectionsByUserId: {
    [DEMO_USER_IDS.sarah_jenkins]: getDefaultPayPalConnection('doctor', DEMO_USER_IDS.sarah_jenkins),
    [DEMO_USER_IDS.alex_rivera]: getDefaultPayPalConnection('patient', DEMO_USER_IDS.alex_rivera),
    [DEMO_USER_IDS.jordan_taylor]: getDefaultPayPalConnection('patient', DEMO_USER_IDS.jordan_taylor),
  },
  notificationsByUserId: getDefaultNotificationsByUserId(),
};

let inflightPreloadPromise: Promise<BillingDashboardData> | null = null;

export function getPreloadedBillingSnapshot(
  roleScope: BillingRoleScope,
  targetUserId?: string
): BillingDashboardData {
  const hasExplicitEmptyOrInvalid =
    targetUserId !== undefined &&
    (typeof targetUserId !== 'string' || !targetUserId.trim());
  const userId = hasExplicitEmptyOrInvalid
    ? ''
    : targetUserId ||
      (roleScope === 'doctor'
        ? DEMO_USER_IDS.sarah_jenkins
        : DEMO_USER_IDS.alex_rivera);

  const allInvoices =
    preloadedCache.invoices.length > 0
      ? preloadedCache.invoices
      : getSyntheticInvoicesForRole(roleScope);

  const candidateNotifs = userId
    ? preloadedCache.notificationsByUserId[userId] ||
      getDefaultNotificationsByUserId()[userId] ||
      []
    : [];

  const authorizedNotifications = authorizeAndFilterNotificationsForAccount({
    notifications: candidateNotifs,
    roleScope,
    activeUserId: userId,
    invoices: allInvoices,
  });

  return {
    invoices: allInvoices,
    catalog: preloadedCache.catalog,
    billablePatients: preloadedCache.billablePatients,
    settings:
      preloadedCache.settingsByUserId[userId] || getDefaultBillingAISettings(userId),
    connection:
      preloadedCache.connectionsByUserId[userId] || getDefaultPayPalConnection(roleScope),
    auditEvents: preloadedCache.auditEvents,
    notifications: authorizedNotifications,
    isLiveStagingData: preloadedCache.isLiveStagingData,
  };
}

export function getPreloadedPayPalConnection(
  roleScope: BillingRoleScope,
  targetUserId?: string
): PayPalAccountConnectionSummary {
  const userId =
    targetUserId ||
    (roleScope === 'doctor' ? DEMO_USER_IDS.sarah_jenkins : DEMO_USER_IDS.alex_rivera);
  return (
    preloadedCache.connectionsByUserId[userId] || getDefaultPayPalConnection(roleScope)
  );
}

export function setPreloadedPayPalConnection(
  userId: string,
  connection: PayPalAccountConnectionSummary
): void {
  if (!userId) return;
  preloadedCache.connectionsByUserId[userId] = connection;
}

function mapDbSettingsRow(row: any, fallbackUserId: string): BillingAISettingsRecord {
  if (!row) return getDefaultBillingAISettings(fallbackUserId);
  return {
    userId: String(row.user_id || fallbackUserId),
    maxSingleActionMinor: Number(row.max_single_action_minor ?? 50000),
    dailyLimitMinor: Number(row.daily_limit_minor ?? 250000),
    allowInvoiceDrafting: Boolean(row.allow_invoice_drafting ?? true),
    allowReminderDrafting: Boolean(row.allow_reminder_drafting ?? true),
    allowCheckoutAssistance: Boolean(row.allow_checkout_assistance ?? true),
    warnDuplicates: Boolean(row.warn_duplicates ?? true),
    notifyNewInvoice: Boolean(row.notify_new_invoice ?? true),
    notifyPaymentConfirmed: Boolean(row.notify_payment_confirmed ?? true),
    notifyPaymentFailed: Boolean(row.notify_payment_failed ?? true),
    notifyOverdue: Boolean(row.notify_overdue ?? true),
    notifyRefund: Boolean(row.notify_refund ?? true),
    reminderDaysBeforeDue: Number(row.reminder_days_before_due ?? 3),
    requireHumanApproval: true,
    blockClinicalData: true,
    paypalConfirmationRequired: true,
    updatedAt: String(row.updated_at || new Date().toISOString()),
  };
}

function mapDbInvoiceStatus(
  rawStatus: string,
  dueDateIso: string,
  hasFailedAttempt: boolean
): SyntheticInvoiceStatus {
  const status = String(rawStatus || '').toLowerCase();
  if (status === 'paid') return 'paid';
  if (status === 'refunded' || status === 'partially_refunded') return 'refunded';
  if (status === 'draft') return 'draft';
  if (status === 'void' || status === 'cancelled') return 'void';
  if (status === 'sent') {
    const dueMs = new Date(`${dueDateIso}T23:59:59Z`).getTime();
    if (Number.isFinite(dueMs) && dueMs < Date.now()) {
      return 'overdue';
    }
    if (hasFailedAttempt) {
      return 'failed';
    }
    return 'pending';
  }
  return 'pending';
}

export async function fetchBillingDashboardData(
  roleScope: BillingRoleScope,
  targetUserId?: string,
  options?: { forceRefresh?: boolean }
): Promise<BillingDashboardData> {
  const fallbackInvoices = getSyntheticInvoicesForRole(roleScope);
  const defaultConnection = getDefaultPayPalConnection(roleScope);

  try {
    if (process.env.NODE_ENV === 'test' || !sb?.from || !sb?.rpc) {
      const hasExplicitInvalid =
        targetUserId !== undefined &&
        (typeof targetUserId !== 'string' || !targetUserId.trim());
      const fallbackUserId = hasExplicitInvalid
        ? ''
        : targetUserId ||
          (roleScope === 'doctor'
            ? DEMO_USER_IDS.sarah_jenkins
            : DEMO_USER_IDS.alex_rivera);
      const defaultNotifs = getDefaultNotificationsByUserId();
      const authorizedNotifs = authorizeAndFilterNotificationsForAccount({
        notifications: fallbackUserId ? defaultNotifs[fallbackUserId] || [] : [],
        roleScope,
        activeUserId: fallbackUserId,
        invoices: fallbackInvoices,
      });
      return {
        invoices: fallbackInvoices,
        catalog: DEFAULT_SERVICE_CATALOG,
        billablePatients: DEFAULT_BILLABLE_PATIENTS,
        settings: getDefaultBillingAISettings(fallbackUserId),
        connection: defaultConnection,
        auditEvents: [],
        notifications: authorizedNotifs,
        isLiveStagingData: false,
      };
    }

    if (
      targetUserId !== undefined &&
      (typeof targetUserId !== 'string' || !targetUserId.trim())
    ) {
      return getPreloadedBillingSnapshot(roleScope, '');
    }

    let userId: string | undefined = targetUserId;
    if (!userId) {
      userId =
        roleScope === 'doctor'
          ? DEMO_USER_IDS.sarah_jenkins
          : DEMO_USER_IDS.alex_rivera;
    }

    const demoSessionId = await getOrCreateDemoSessionId();

    // Serve immediately from preloaded memory cache when switching demo personas
    if (
      !options?.forceRefresh &&
      preloadedCache.sessionId === demoSessionId &&
      preloadedCache.loadedAt > 0
    ) {
      return getPreloadedBillingSnapshot(roleScope, userId);
    }

    if (inflightPreloadPromise && !options?.forceRefresh) {
      await inflightPreloadPromise;
      return getPreloadedBillingSnapshot(roleScope, userId);
    }

    const loadTask = (async (): Promise<BillingDashboardData> => {
      const sessionScope =
        demoSessionId === 'canonical' ? ['canonical'] : ['canonical', demoSessionId];

      const [
        invRes,
        itemsRes,
        attemptsRes,
        txRes,
        orgsRes,
        catalogRes,
        settingsRes,
        connRes,
        auditRes,
        patientsRes,
        notifRes,
        overridesRes,
      ] = await Promise.all([
        sb
          .from('billing_invoices')
          .select('*')
          .in('demo_session_id', sessionScope)
          .order('created_at', { ascending: false })
          .limit(100),
        sb.from('billing_invoice_items').select('*').order('position', { ascending: true }),
        sb
          .from('billing_payment_attempts')
          .select('*')
          .in('demo_session_id', sessionScope)
          .order('created_at', { ascending: false }),
        sb.from('billing_transactions').select('*').order('captured_at', { ascending: false }),
        sb.from('billing_organizations').select('id, name, owner_user_id'),
        sb
          .from('billing_service_catalog')
          .select('*')
          .eq('active', true)
          .order('code', { ascending: true }),
        sb.rpc('billing_effective_ai_settings', { p_user: userId }),
        sb
          .from('billing_account_connections')
          .select('*')
          .in('user_id', ALL_DEMO_USER_IDS),
        sb
          .from('billing_audit_events')
          .select('id, event_type, actor_kind, created_at, details, demo_session_id')
          .in('demo_session_id', sessionScope)
          .order('created_at', { ascending: false })
          .limit(100),
        sb.rpc('billing_list_billable_patients'),
        sb
          .from('billing_notifications')
          .select('*')
          .in('user_id', ALL_DEMO_USER_IDS)
          .in('demo_session_id', sessionScope)
          .order('created_at', { ascending: false })
          .limit(60),
        demoSessionId !== 'canonical'
          ? sb
              .from('billing_demo_session_overrides')
              .select('*')
              .eq('demo_session_id', demoSessionId)
          : Promise.resolve({ data: [] }),
      ]);

      const rawDbInvoices: any[] = Array.isArray(invRes?.data) ? invRes.data : [];
      const dbOverrides: any[] = Array.isArray(overridesRes?.data) ? overridesRes.data : [];
      const overrideMap = new Map<string, any>();
      for (const ov of dbOverrides) {
        if (ov?.invoice_id) {
          overrideMap.set(String(ov.invoice_id), ov);
        }
      }
      const localOverridesForSession =
        localSessionInvoiceOverridesBySession.get(demoSessionId);
      if (localOverridesForSession) {
        for (const [invId, localOv] of localOverridesForSession.entries()) {
          overrideMap.set(invId, { ...(overrideMap.get(invId) || {}), ...localOv });
        }
      }

      const dbInvoices: any[] = rawDbInvoices.map((raw) => {
        const rawId = String(raw.id);
        const ov = overrideMap.get(rawId);
        const seedBaseline = CANONICAL_SEED_INVOICE_BASELINE[rawId];
        if (!ov && seedBaseline && demoSessionId !== 'canonical') {
          const offsetDate = new Date(
            Date.now() + seedBaseline.days_offset_due * 86400000
          )
            .toISOString()
            .slice(0, 10);
          return {
            ...raw,
            issuer_user_id: seedBaseline.issuer_user_id,
            recipient_user_id: seedBaseline.recipient_user_id,
            status: seedBaseline.status,
            total_minor: seedBaseline.total_minor,
            amount_paid_minor: seedBaseline.amount_paid_minor,
            amount_refunded_minor: seedBaseline.amount_refunded_minor,
            balance_due_minor: seedBaseline.balance_due_minor,
            due_date: offsetDate,
            paid_at: seedBaseline.status === 'paid' ? raw.paid_at || raw.created_at : null,
            voided_at: seedBaseline.status === 'void' ? raw.voided_at || raw.created_at : null,
            refunded_at:
              seedBaseline.status === 'refunded' ? raw.refunded_at || raw.created_at : null,
          };
        }
        if (!ov) return raw;
        return {
          ...raw,
          status: ov.status ?? raw.status,
          amount_paid_minor: ov.amount_paid_minor ?? raw.amount_paid_minor,
          amount_refunded_minor: ov.amount_refunded_minor ?? raw.amount_refunded_minor,
          balance_due_minor: ov.balance_due_minor ?? raw.balance_due_minor,
          paid_at: ov.paid_at ?? raw.paid_at,
          voided_at: ov.voided_at ?? raw.voided_at,
          refunded_at: ov.refunded_at ?? raw.refunded_at,
          _session_override: ov,
        };
      });
      const dbItems: any[] = Array.isArray(itemsRes?.data) ? itemsRes.data : [];
      const dbAttempts: any[] = Array.isArray(attemptsRes?.data) ? attemptsRes.data : [];
      const dbTx: any[] = Array.isArray(txRes?.data) ? txRes.data : [];
      const dbOrgs: any[] = Array.isArray(orgsRes?.data) ? dbOrgsFromRes(orgsRes.data) : [];

      const nameMap = new Map<string, string>([
        [DEMO_USER_IDS.sarah_jenkins, 'Dr. Sarah Jenkins'],
        [DEMO_USER_IDS.alex_rivera, 'Alex Rivera'],
        [DEMO_USER_IDS.jordan_taylor, 'Jordan Taylor'],
        ['11111111-1111-4111-8111-111111111104', 'Marcus Vance'],
      ]);

      const orgNameMap = new Map<string, string>();
      for (const o of dbOrgs) {
        if (o?.id && o?.name) orgNameMap.set(String(o.id), String(o.name));
      }

      const mappedDbInvoices: SyntheticBillingInvoice[] = dbInvoices.map((inv) => {
        const invItems: SyntheticInvoiceLineItem[] = dbItems
          .filter((it) => it.invoice_id === inv.id)
          .map((it) => ({
            id: String(it.id),
            serviceCode: String(it.service_code),
            description: String(it.description),
            quantity: Number(it.quantity || 1),
            unitAmountCents: Number(it.unit_amount_minor || 0),
            lineTotalCents: Number(
              it.line_total_minor ?? Number(it.quantity || 1) * Number(it.unit_amount_minor || 0)
            ),
          }));

        const matchingTx = dbTx.find((t) => t.invoice_id === inv.id);
        const isSampleSeedSettlement = matchingTx?.verified_via === 'seed_demo';
        const isPayPalVerifiedSettlement =
          matchingTx &&
          (matchingTx.verified_via === 'capture_api' ||
            matchingTx.verified_via === 'order_lookup' ||
            matchingTx.verified_via === 'webhook');

        const invAttempts: SyntheticPaymentAttempt[] = dbAttempts
          .filter((at) => at.invoice_id === inv.id)
          .map((at) => {
            const rawStatus = String(at.status || '').toLowerCase();
            const rawClass = String(at.attempt_classification || '').toLowerCase();
            const rawErrCode = String(
              at.paypal_error_code || at.failure_code || ''
            ).toUpperCase();
            const rawMsg = String(at.failure_message || '').toUpperCase();
            const isApprovalRequired =
              rawClass === 'approval_required' ||
              rawStatus === 'approval_required' ||
              rawErrCode === 'ORDER_NOT_APPROVED' ||
              rawMsg.includes('ORDER_NOT_APPROVED');
            const isAwaitingApproval =
              rawClass === 'awaiting_buyer_approval' ||
              rawStatus === 'awaiting_buyer_approval' ||
              rawStatus === 'created' ||
              rawStatus === 'pending';
            const isBuyerCanceled =
              rawClass === 'buyer_canceled' ||
              rawStatus === 'buyer_canceled' ||
              rawStatus === 'cancelled';
            const isRefunded = rawClass === 'refunded' || rawStatus === 'refunded';
            const isAuthorized = rawClass === 'authorized' || rawStatus === 'authorized';
            const isCompleted = rawClass === 'captured' || rawStatus === 'completed';
            const isProcessingError =
              rawClass === 'processing_error' || rawStatus === 'processing_error';
            const isPaymentDeclined =
              !isApprovalRequired &&
              !isAwaitingApproval &&
              !isBuyerCanceled &&
              !isRefunded &&
              !isAuthorized &&
              !isCompleted &&
              !isProcessingError &&
              (rawClass === 'payment_declined' ||
                rawStatus === 'payment_declined' ||
                rawStatus === 'failed' ||
                rawStatus === 'expired');

            const classification: PaymentAttemptClassification = isRefunded
              ? 'refunded'
              : isCompleted
                ? 'captured'
                : isAuthorized
                  ? 'authorized'
                  : isApprovalRequired
                    ? 'approval_required'
                    : isAwaitingApproval
                      ? 'awaiting_buyer_approval'
                      : isBuyerCanceled
                        ? 'buyer_canceled'
                        : isProcessingError
                          ? 'processing_error'
                          : isPaymentDeclined
                            ? 'payment_declined'
                            : 'awaiting_buyer_approval';

            const isGenuineFailure = classification === 'payment_declined';
            const paymentSourceType = (at.payment_source_type || 'paypal_wallet') as
              | 'paypal_wallet'
              | 'paypal_card'
              | 'demo_simulation';

            const statusLabel =
              classification === 'approval_required'
                ? 'Awaiting PayPal Buyer Approval (ORDER_NOT_APPROVED)'
                : classification === 'awaiting_buyer_approval'
                  ? 'PayPal Checkout Created — Awaiting Buyer Approval'
                  : classification === 'buyer_canceled'
                    ? 'Buyer Canceled Checkout'
                    : classification === 'authorized'
                      ? 'PayPal Payment Authorized (Awaiting Capture)'
                      : classification === 'refunded'
                        ? 'PayPal Capture Refunded'
                        : classification === 'captured'
                          ? isSampleSeedSettlement
                            ? 'Sample Demo Settlement (Seeded)'
                            : paymentSourceType === 'paypal_card'
                              ? 'Verified PayPal Sandbox Direct Card Capture'
                              : 'Verified PayPal Sandbox Capture'
                          : classification === 'processing_error'
                            ? 'Provider / Network Processing Error'
                            : 'Declined Payment Instrument';

            const actionableMessage = at.actionable_message
              ? String(at.actionable_message)
              : classification === 'approval_required' ||
                  classification === 'awaiting_buyer_approval'
                ? 'PayPal is waiting for buyer approval. Complete Sandbox checkout before capturing this payment.'
                : undefined;

            return {
              id: String(at.id),
              attemptedAt: String(at.created_at),
              amountCents: Number(at.amount_minor || 0),
              currencyCode: 'USD' as const,
              status: isRefunded
                ? 'refunded_demo'
                : isCompleted
                  ? 'simulated_paid_demo'
                  : isGenuineFailure
                    ? 'failed_demo'
                    : 'pending_demo',
              statusLabel,
              failureReason: at.failure_message ? String(at.failure_message) : undefined,
              demoReferenceCode: String(at.paypal_order_id || at.request_id || at.id),
              attemptClassification: classification,
              isGenuineFailure,
              paymentSourceType,
              paypalErrorCode: at.paypal_error_code
                ? String(at.paypal_error_code)
                : isApprovalRequired
                  ? 'ORDER_NOT_APPROVED'
                  : undefined,
              actionableMessage,
              cardBrand: at.card_brand ? String(at.card_brand) : undefined,
              cardLastDigits: at.card_last_digits ? String(at.card_last_digits) : undefined,
            };
          });

        const hasFailedAttempt = invAttempts.some((a) => a.isGenuineFailure === true);
        const dueDateStr = String(inv.due_date || new Date().toISOString().slice(0, 10));
        const mappedStatus = mapDbInvoiceStatus(inv.status, dueDateStr, hasFailedAttempt);
        const isInvoiceSettled =
          mappedStatus === 'paid' ||
          mappedStatus === 'refunded' ||
          Number(inv.amount_paid_minor || 0) > 0;
        const settledTx = isInvoiceSettled ? matchingTx : undefined;
        const settledIsSampleSeed = Boolean(
          settledTx && settledTx.verified_via === 'seed_demo'
        );
        const settledIsPayPalVerified = Boolean(
          settledTx &&
            (settledTx.verified_via === 'capture_api' ||
              settledTx.verified_via === 'order_lookup' ||
              settledTx.verified_via === 'webhook')
        );

        const primarySummary =
          invItems[0]?.description || 'Administrative Service Statement';

        const computedBalanceDueCents =
          mappedStatus === 'void' || mappedStatus === 'refunded'
            ? 0
            : Number(
                inv.balance_due_minor ??
                  Math.max(Number(inv.total_minor || 0) - Number(inv.amount_paid_minor || 0), 0)
              );

        return {
          id: String(inv.id),
          invoiceNumber: String(inv.invoice_number),
          organizationId: String(inv.organization_id),
          organizationName:
            orgNameMap.get(String(inv.organization_id)) ||
            'Jenkins Wellness & Telehealth Practice',
          issuerUserId: String(inv.issuer_user_id || DEMO_USER_IDS.sarah_jenkins),
          issuerDoctorName:
            nameMap.get(String(inv.issuer_user_id)) || 'Dr. Sarah Jenkins',
          recipientUserId: String(inv.recipient_user_id || ''),
          patientDisplayName:
            nameMap.get(String(inv.recipient_user_id)) || 'Authorized Customer',
          allowedRoleScopes: ['doctor', 'patient'],
          authorizedDoctorScope: 'org_primary_demo',
          authorizedPatientScope: 'patient_primary_demo',
          status: mappedStatus,
          currencyCode: 'USD',
          subtotalCents: Number(inv.subtotal_minor || 0),
          taxCents: Number(inv.tax_minor || 0),
          totalCents: Number(inv.total_minor || 0),
          amountPaidCents: Number(inv.amount_paid_minor || 0),
          amountRefundedCents: Number(inv.amount_refunded_minor || 0),
          balanceDueCents: computedBalanceDueCents,
          issuedAt: String(inv.sent_at || inv.created_at),
          dueDate: `${dueDateStr}T23:59:59Z`,
          paidAt: inv.paid_at ? String(inv.paid_at) : undefined,
          refundedAt: inv.refunded_at ? String(inv.refunded_at) : undefined,
          receiptNumber: settledTx?.paypal_capture_id
            ? settledIsSampleSeed
              ? String(settledTx.paypal_capture_id)
              : `PP-CAP-${settledTx.paypal_capture_id}`
            : undefined,
          settlementVerificationStatus: settledIsPayPalVerified
            ? 'paypal_verified'
            : settledIsSampleSeed
              ? 'sample_demo'
              : 'unpaid',
          administrativeSummary: primarySummary,
          statementMemoSafe:
            'Administrative billing statement stored in dedicated Supabase project with Row-Level Security.',
          isSyntheticDemoRecord: true,
          verificationNotice: settledIsPayPalVerified
            ? `Verified PayPal Sandbox Capture (${settledTx?.paypal_capture_id})`
            : settledIsSampleSeed
              ? `Fictional Sample Record — Seeded demo settlement (${settledTx?.paypal_capture_id}), not a live PayPal Sandbox capture.`
              : mappedStatus === 'void'
                ? 'Voided Statement — Archived with $0.00 remaining balance.'
                : mappedStatus === 'refunded'
                  ? 'Refunded Statement — Refund completed with $0.00 remaining balance.'
                  : 'PayPal Sandbox Statement — Administrative billing fields only.',
          lineItems: invItems,
          paymentAttempts: invAttempts,
        };
      });

      const catalog: BillingServiceCatalogItem[] =
        Array.isArray(catalogRes?.data) && catalogRes.data.length > 0
          ? catalogRes.data.map((c: any) => ({
              code: String(c.code),
              title: String(c.title || c.description || c.code),
              description: String(c.description),
              defaultAmountMinor: Number(c.default_amount_minor || 5000),
              currency: 'USD' as const,
            }))
          : DEFAULT_SERVICE_CATALOG;

      const billablePatients: BillablePatientOption[] =
        Array.isArray(patientsRes?.data) && patientsRes.data.length > 0
          ? patientsRes.data.map((p: any) => ({
              patientId: String(p.patient_id),
              fullName: String(p.full_name || 'Authorized Customer'),
              emailMasked: p.email_masked ? String(p.email_masked) : null,
            }))
          : DEFAULT_BILLABLE_PATIENTS;

      const sessionInvoiceIds = new Set(mappedDbInvoices.map((inv) => inv.id));
      const auditEvents: BillingAuditEventItem[] = Array.isArray(auditRes?.data)
        ? auditRes.data
            .filter((a: any) => {
              const rowSession = String(a.demo_session_id || 'canonical');
              if (demoSessionId === 'canonical') {
                return Number(a.id) <= 4 || rowSession === 'canonical';
              }
              if (rowSession === demoSessionId) return true;
              if (Number(a.id) <= 4) return true;
              const detSession = a.details?.demo_session_id
                ? String(a.details.demo_session_id)
                : null;
              if (detSession === demoSessionId) return true;
              const detInvId = a.details?.invoice_id ? String(a.details.invoice_id) : null;
              if (detInvId && sessionInvoiceIds.has(detInvId) && !detSession) return true;
              return false;
            })
            .map((a: any) => ({
              id: Number(a.id),
              eventType: String(a.event_type),
              actorKind: (a.actor_kind || 'system') as BillingAuditEventItem['actorKind'],
              createdAt: String(a.created_at),
              details: a.details && typeof a.details === 'object' ? a.details : {},
            }))
        : [];

      // Populate multi-persona connection cache
      const nextConnectionsByUser: Record<string, PayPalAccountConnectionSummary> = {
        [DEMO_USER_IDS.sarah_jenkins]: getDefaultPayPalConnection('doctor', DEMO_USER_IDS.sarah_jenkins),
        [DEMO_USER_IDS.alex_rivera]: getDefaultPayPalConnection('patient', DEMO_USER_IDS.alex_rivera),
        [DEMO_USER_IDS.jordan_taylor]: getDefaultPayPalConnection('patient', DEMO_USER_IDS.jordan_taylor),
      };
      const connRows: any[] = Array.isArray(connRes?.data) ? connRes.data : [];
      for (const row of connRows) {
        const rowUid = String(row?.user_id || '');
        if (!rowUid) continue;
        const isDoc = rowUid === DEMO_USER_IDS.sarah_jenkins;
        const isConn =
          row.connection_status === 'connected' || row.status === 'connected';
        const isOAuth = Boolean(row.paypal_verified);
        nextConnectionsByUser[rowUid] = {
          connected: isConn,
          environment: (row.paypal_environment || row.paypal_env || row.environment || 'sandbox') as
            | 'sandbox'
            | 'live',
          connectionType: isDoc ? 'merchant' : 'payer',
          paypalEmailMasked:
            isConn && row.paypal_email_masked ? String(row.paypal_email_masked) : null,
          paypalPayerIdMasked:
            isConn && (row.paypal_merchant_id || row.paypal_payer_id)
              ? String(row.paypal_merchant_id || row.paypal_payer_id)
              : null,
          connectedAt: isConn && row.connected_at ? String(row.connected_at) : null,
          sandboxCredentialsConfigured: isOAuth,
          oauthVerified: isOAuth,
        };
      }

      // Populate multi-persona notification cache (strictly scoped to current session & canonical statements)
      const sessionInvoicesByNumber = new Map<string, SyntheticBillingInvoice>();
      const sessionInvoicesById = new Map<string, SyntheticBillingInvoice>();
      const effectiveSessionInvoices =
        mappedDbInvoices.length > 0 ? mappedDbInvoices : fallbackInvoices;
      for (const inv of effectiveSessionInvoices) {
        sessionInvoicesById.set(inv.id, inv);
        sessionInvoicesByNumber.set(inv.invoiceNumber.toUpperCase(), inv);
      }

      const defaultSeededNotifs = getDefaultNotificationsByUserId();
      const rawCandidateNotificationsByUser: Record<string, BillingNotificationItem[]> = {
        [DEMO_USER_IDS.sarah_jenkins]: [...(defaultSeededNotifs[DEMO_USER_IDS.sarah_jenkins] || [])],
        [DEMO_USER_IDS.alex_rivera]: [...(defaultSeededNotifs[DEMO_USER_IDS.alex_rivera] || [])],
        [DEMO_USER_IDS.jordan_taylor]: [...(defaultSeededNotifs[DEMO_USER_IDS.jordan_taylor] || [])],
      };
      const notifRows: any[] = Array.isArray(notifRes?.data) ? notifRes.data : [];

      for (const n of notifRows) {
        const rowSession = String(n.demo_session_id || 'canonical');
        // Only merge session-specific notifications created in the active visitor session.
        // Canonical baseline notifications come from the reconciled getDefaultNotificationsByUserId()
        // so historical misassigned or polluted 'canonical' DB rows never leak across customers or after Reset Demo.
        if (rowSession !== demoSessionId || demoSessionId === 'canonical') {
          continue;
        }

        const recUid = String(n.user_id || '').trim();
        if (!recUid) continue;
        if (!rawCandidateNotificationsByUser[recUid]) {
          rawCandidateNotificationsByUser[recUid] = [];
        }
        const rawMetaInvId = n.metadata?.invoiceId
          ? String(n.metadata.invoiceId)
          : n.invoice_id
            ? String(n.invoice_id)
            : null;
        const rawMetaInvNum = n.metadata?.invoiceNumber
          ? String(n.metadata.invoiceNumber).toUpperCase()
          : null;
        const bodyInvMatch = String(n.body || n.title || '').match(
          /\b((?:PPB|HER)-INV-\d{4}-\d+)\b/i
        );
        const extractedInvNum =
          rawMetaInvNum || (bodyInvMatch ? bodyInvMatch[1].toUpperCase() : null);

        const matchedSessionInv =
          (rawMetaInvId ? sessionInvoicesById.get(rawMetaInvId) : undefined) ||
          (extractedInvNum
            ? sessionInvoicesByNumber.get(extractedInvNum)
            : undefined);

        if (!matchedSessionInv) {
          continue;
        }

        const resolvedInvoiceId = matchedSessionInv.id;
        const notifId = String(n.id);

        rawCandidateNotificationsByUser[recUid].unshift({
          id: notifId,
          recipientUserId: recUid,
          organizationId: matchedSessionInv.organizationId,
          invoiceId: resolvedInvoiceId,
          invoiceNumber: matchedSessionInv.invoiceNumber,
          type: String(n.metadata?.kind || n.type || 'billing_alert'),
          title: String(n.title || 'Billing Notification'),
          body: String(n.body || ''),
          deepLink: `/billing?invoiceId=${encodeURIComponent(resolvedInvoiceId)}`,
          isRead:
            isNotificationMarkedReadLocally(recUid, notifId) ||
            Boolean(n.read ?? n.is_read),
          createdAt: String(n.created_at || new Date().toISOString()),
        });
      }

      const nextNotificationsByUser: Record<string, BillingNotificationItem[]> = {
        [DEMO_USER_IDS.sarah_jenkins]: authorizeAndFilterNotificationsForAccount({
          notifications: rawCandidateNotificationsByUser[DEMO_USER_IDS.sarah_jenkins] || [],
          roleScope: 'doctor',
          activeUserId: DEMO_USER_IDS.sarah_jenkins,
          invoices: effectiveSessionInvoices,
        }),
        [DEMO_USER_IDS.alex_rivera]: authorizeAndFilterNotificationsForAccount({
          notifications: rawCandidateNotificationsByUser[DEMO_USER_IDS.alex_rivera] || [],
          roleScope: 'patient',
          activeUserId: DEMO_USER_IDS.alex_rivera,
          invoices: effectiveSessionInvoices,
        }),
        [DEMO_USER_IDS.jordan_taylor]: authorizeAndFilterNotificationsForAccount({
          notifications: rawCandidateNotificationsByUser[DEMO_USER_IDS.jordan_taylor] || [],
          roleScope: 'patient',
          activeUserId: DEMO_USER_IDS.jordan_taylor,
          invoices: effectiveSessionInvoices,
        }),
      };

      const mappedSettings = mapDbSettingsRow(settingsRes?.data, userId!);
      preloadedCache.sessionId = demoSessionId;
      preloadedCache.loadedAt = Date.now();
      preloadedCache.isLiveStagingData = mappedDbInvoices.length > 0;
      preloadedCache.invoices =
        mappedDbInvoices.length > 0 ? mappedDbInvoices : fallbackInvoices;
      preloadedCache.catalog = catalog;
      preloadedCache.billablePatients = billablePatients;
      preloadedCache.auditEvents = auditEvents;
      preloadedCache.settingsByUserId = {
        ...preloadedCache.settingsByUserId,
        [DEMO_USER_IDS.sarah_jenkins]: mapDbSettingsRow(
          settingsRes?.data,
          DEMO_USER_IDS.sarah_jenkins
        ),
        [DEMO_USER_IDS.alex_rivera]: mapDbSettingsRow(
          settingsRes?.data,
          DEMO_USER_IDS.alex_rivera
        ),
        [DEMO_USER_IDS.jordan_taylor]: mapDbSettingsRow(
          settingsRes?.data,
          DEMO_USER_IDS.jordan_taylor
        ),
        [userId!]: mappedSettings,
      };
      preloadedCache.connectionsByUserId = nextConnectionsByUser;
      preloadedCache.notificationsByUserId = nextNotificationsByUser;

      return getPreloadedBillingSnapshot(roleScope, userId);
    })();

    inflightPreloadPromise = loadTask;
    try {
      return await loadTask;
    } finally {
      inflightPreloadPromise = null;
    }
  } catch (err) {
    console.error('fetchBillingDashboardData error:', err);
    return getPreloadedBillingSnapshot(roleScope, targetUserId);
  }
}

function dbOrgsFromRes(data: any[]): any[] {
  return Array.isArray(data) ? data : [];
}

export async function markBillingNotificationRead(
  notificationId: string,
  context?: {
    activeUserId?: string | null;
    roleScope?: BillingRoleScope | null;
  }
): Promise<boolean> {
  if (!notificationId || typeof notificationId !== 'string' || !notificationId.trim()) {
    return false;
  }
  const cleanNotifId = notificationId.trim();

  // If explicit context is provided and activeUserId is empty/invalid, fail closed
  if (
    context &&
    'activeUserId' in context &&
    (!context.activeUserId || !String(context.activeUserId).trim())
  ) {
    return false;
  }

  const callerUserId = context?.activeUserId
    ? String(context.activeUserId).trim()
    : getActiveDemoUserId(context?.roleScope || 'patient');
  const callerRole: BillingRoleScope =
    context?.roleScope ||
    (callerUserId === DEMO_USER_IDS.sarah_jenkins ? 'doctor' : 'patient');

  if (!callerUserId) {
    return false;
  }

  const allInvoices =
    preloadedCache.invoices.length > 0
      ? preloadedCache.invoices
      : getSyntheticInvoicesForRole('doctor');

  // Verify the notification exists in the caller's authorized notification list
  const callerCandidates =
    preloadedCache.notificationsByUserId[callerUserId] ||
    getDefaultNotificationsByUserId()[callerUserId] ||
    [];
  const authorizedCallerList = authorizeAndFilterNotificationsForAccount({
    notifications: callerCandidates,
    roleScope: callerRole,
    activeUserId: callerUserId,
    invoices: allInvoices,
  });

  const ownedTarget = authorizedCallerList.find((n) => n.id === cleanNotifId);
  if (!ownedTarget) {
    // Reject cross-customer or unauthorized mark-as-read attempt
    return false;
  }

  localReadNotificationIds.add(`${callerUserId}:${cleanNotifId}`);
  preloadedCache.notificationsByUserId[callerUserId] = callerCandidates.map((n) =>
    n.id === cleanNotifId && n.recipientUserId === callerUserId
      ? { ...n, isRead: true }
      : n
  );

  if (!sb?.from || cleanNotifId.startsWith('notif-seed-')) {
    return true;
  }
  try {
    const { error } = await sb
      .from('billing_notifications')
      .update({ read: true })
      .eq('id', cleanNotifId)
      .eq('user_id', callerUserId);
    return !error;
  } catch {
    return true;
  }
}

export async function markAllBillingNotificationsRead(context?: {
  activeUserId?: string | null;
  roleScope?: BillingRoleScope | null;
}): Promise<number> {
  if (
    context &&
    'activeUserId' in context &&
    (!context.activeUserId || !String(context.activeUserId).trim())
  ) {
    return 0;
  }

  const callerUserId = context?.activeUserId
    ? String(context.activeUserId).trim()
    : getActiveDemoUserId(context?.roleScope || 'patient');
  const callerRole: BillingRoleScope =
    context?.roleScope ||
    (callerUserId === DEMO_USER_IDS.sarah_jenkins ? 'doctor' : 'patient');

  if (!callerUserId) {
    return 0;
  }

  const allInvoices =
    preloadedCache.invoices.length > 0
      ? preloadedCache.invoices
      : getSyntheticInvoicesForRole('doctor');
  const callerCandidates =
    preloadedCache.notificationsByUserId[callerUserId] ||
    getDefaultNotificationsByUserId()[callerUserId] ||
    [];
  const authorizedCallerList = authorizeAndFilterNotificationsForAccount({
    notifications: callerCandidates,
    roleScope: callerRole,
    activeUserId: callerUserId,
    invoices: allInvoices,
  });

  let markedCount = 0;
  const authorizedIds = new Set<string>();
  for (const item of authorizedCallerList) {
    authorizedIds.add(item.id);
    if (!item.isRead) {
      markedCount += 1;
    }
    localReadNotificationIds.add(`${callerUserId}:${item.id}`);
  }

  preloadedCache.notificationsByUserId[callerUserId] = callerCandidates.map((n) =>
    authorizedIds.has(n.id) && n.recipientUserId === callerUserId
      ? { ...n, isRead: true }
      : n
  );

  if (sb?.from) {
    try {
      const demoSessionId = getOrCreateDemoSessionIdSync();
      await sb
        .from('billing_notifications')
        .update({ read: true })
        .eq('user_id', callerUserId)
        .eq('demo_session_id', demoSessionId);
    } catch {
      // Ignore network error in offline/test mode
    }
  }

  return markedCount;
}

export type NotificationInvoiceResolution =
  | {
      status: 'resolved';
      invoice: SyntheticBillingInvoice;
      notificationId: string;
    }
  | {
      status: 'unauthorized';
      message: string;
      notificationId: string;
    }
  | {
      status: 'not_found';
      message: string;
      notificationId: string;
    };

export function resolveNotificationLinkedInvoice(params: {
  notification: BillingNotificationItem;
  roleScope: BillingRoleScope;
  activeUserId: string;
  activeFullName?: string;
  allInvoices: SyntheticBillingInvoice[];
}): NotificationInvoiceResolution {
  const { notification, roleScope, activeUserId, activeFullName, allInvoices } = params;
  const notifId = String(notification?.id || '');

  if (
    (roleScope !== 'doctor' && roleScope !== 'patient') ||
    typeof activeUserId !== 'string' ||
    !activeUserId.trim()
  ) {
    return {
      status: 'unauthorized',
      notificationId: notifId,
      message:
        'Access Restricted: Valid authenticated user context is required to open linked statements.',
    };
  }

  const normalizedActiveUid = activeUserId.trim().toLowerCase();

  // If notification itself belongs to a different recipientUserId, reject cross-account access
  if (
    !notification?.recipientUserId ||
    notification.recipientUserId.trim().toLowerCase() !== normalizedActiveUid
  ) {
    return {
      status: 'unauthorized',
      notificationId: notifId,
      message:
        'Access Restricted: This notification belongs to a different account and cannot be opened in the current workspace.',
    };
  }

  // Extract canonical invoiceId or invoiceNumber from notification fields
  const rawInvId = notification?.invoiceId
    ? String(notification.invoiceId).trim()
    : null;
  let deepLinkInvId: string | null = null;
  if (notification?.deepLink) {
    const dlMatch = String(notification.deepLink).match(
      /[?&]invoiceId=([^&#]+)/i
    );
    if (dlMatch) {
      try {
        deepLinkInvId = decodeURIComponent(dlMatch[1]).trim();
      } catch {
        deepLinkInvId = dlMatch[1].trim();
      }
    }
  }
  const textNumMatch = `${notification?.title || ''} ${notification?.body || ''}`.match(
    /\b((?:PPB|HER)-INV-\d{4}-\d+)\b/i
  );
  const extractedInvNumber = (
    notification?.invoiceNumber || (textNumMatch ? textNumMatch[1] : '')
  )
    .trim()
    .toUpperCase();

  const candidateId = rawInvId || deepLinkInvId;
  if (!candidateId && !extractedInvNumber) {
    return {
      status: 'not_found',
      notificationId: notifId,
      message:
        'Linked statement unavailable: This notification does not reference an active statement identifier.',
    };
  }

  const byId = candidateId
    ? (allInvoices || []).find(
        (inv) =>
          inv.id.toLowerCase() === candidateId.toLowerCase() ||
          inv.invoiceNumber.toLowerCase() === candidateId.toLowerCase()
      )
    : undefined;
  const byNum = extractedInvNumber
    ? (allInvoices || []).find(
        (inv) => inv.invoiceNumber.toUpperCase() === extractedInvNumber
      )
    : undefined;

  if (byId && byNum && byId.id !== byNum.id) {
    return {
      status: 'unauthorized',
      notificationId: notifId,
      message:
        'Access Restricted: Notification statement identifier mismatch detected.',
    };
  }

  const matchedInvoice = byId || byNum;

  if (!matchedInvoice) {
    return {
      status: 'not_found',
      notificationId: notifId,
      message:
        'Statement Unavailable: The linked statement could not be found in the current session (it may have been deleted or belongs to a prior demo session).',
    };
  }

  // Verify active account authorization for the matched invoice
  if (roleScope === 'patient') {
    if (
      matchedInvoice.recipientUserId &&
      matchedInvoice.recipientUserId.trim().toLowerCase() !== normalizedActiveUid
    ) {
      return {
        status: 'unauthorized',
        notificationId: notifId,
        message:
          'Access Restricted: Your active customer account is not authorized to view this statement.',
      };
    }

    const expectedName =
      activeFullName ||
      (normalizedActiveUid === DEMO_USER_IDS.jordan_taylor.toLowerCase()
        ? 'Jordan Taylor'
        : normalizedActiveUid === DEMO_USER_IDS.alex_rivera.toLowerCase()
          ? 'Alex Rivera'
          : '');
    const matchesDisplayName = expectedName
      ? matchedInvoice.patientDisplayName.toLowerCase() ===
        expectedName.toLowerCase()
      : true;

    if (!matchesDisplayName) {
      return {
        status: 'unauthorized',
        notificationId: notifId,
        message:
          'Access Restricted: Your active customer account is not authorized to view this statement.',
      };
    }

    if (matchedInvoice.status === 'draft') {
      return {
        status: 'unauthorized',
        notificationId: notifId,
        message:
          'Access Restricted: Draft statements are only visible to the issuing provider until sent.',
      };
    }
  } else {
    if (
      matchedInvoice.authorizedDoctorScope !== 'org_primary_demo' ||
      (matchedInvoice.issuerUserId &&
        matchedInvoice.issuerUserId.trim().toLowerCase() !== normalizedActiveUid)
    ) {
      return {
        status: 'unauthorized',
        notificationId: notifId,
        message:
          'Access Restricted: This statement belongs to an external merchant organization.',
      };
    }
  }

  return {
    status: 'resolved',
    invoice: matchedInvoice,
    notificationId: notifId,
  };
}

export async function createBillingInvoice(params: {
  recipientUserId: string;
  items: Array<{
    serviceCode: string;
    quantity: number;
    unitAmountMinor: number;
  }>;
  dueDate: string;
  sendImmediately: boolean;
  idempotencyKey?: string;
  aiProposalId?: string | null;
}): Promise<{ id: string; invoiceNumber: string; status: string }> {
  const rpcItems = params.items.map((item) => ({
    service_code: item.serviceCode,
    quantity: item.quantity,
    unit_amount_minor: item.unitAmountMinor,
  }));

  const demoSessionId = await getOrCreateDemoSessionId();
  const { data, error } = await sb.rpc('billing_create_invoice', {
    p_recipient: params.recipientUserId,
    p_items: rpcItems,
    p_due_date: params.dueDate,
    p_send: params.sendImmediately,
    p_idempotency_key: params.idempotencyKey ?? `inv-${Date.now()}`,
    p_ai_proposal_id: params.aiProposalId ?? null,
    p_demo_session_id: demoSessionId,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Could not create invoice.');
  }

  preloadedCache.loadedAt = 0;

  return {
    id: String(data.id),
    invoiceNumber: String(data.invoice_number),
    status: String(data.status),
  };
}

export async function sendDraftBillingInvoice(invoiceId: string): Promise<void> {
  const { error } = await sb.rpc('billing_send_invoice', {
    p_invoice: invoiceId,
  });
  if (error) {
    throw new Error(error.message || 'Could not send invoice.');
  }
  preloadedCache.loadedAt = 0;
}

export async function voidBillingInvoice(invoiceId: string): Promise<void> {
  const demoSessionId = await getOrCreateDemoSessionId();
  const { error } = await sb.rpc('billing_void_invoice', {
    p_invoice: invoiceId,
    p_demo_session_id: demoSessionId,
  });
  if (error) {
    throw new Error(error.message || 'Could not void invoice.');
  }
  // Optimistically update preloaded cache immediately
  preloadedCache.invoices = preloadedCache.invoices.map((inv) =>
    inv.id === invoiceId
      ? {
          ...inv,
          status: 'void',
          balanceDueCents: 0,
          verificationNotice:
            'Voided Statement — Archived with $0.00 remaining balance.',
        }
      : inv
  );
  preloadedCache.loadedAt = 0;
}

export async function sendBillingPaymentReminder(invoiceId: string): Promise<void> {
  const demoSessionId = await getOrCreateDemoSessionId();
  const { error } = await sb.rpc('billing_send_reminder', {
    p_invoice: invoiceId,
    p_demo_session_id: demoSessionId,
  });
  if (error) {
    throw new Error(error.message || 'Could not send payment reminder.');
  }
  preloadedCache.loadedAt = 0;
}

export async function simulateBillingDemoSettlement(invoiceId: string): Promise<{
  captureId: string;
  invoiceNumber: string;
}> {
  const demoSessionId = await getOrCreateDemoSessionId();
  const { data, error } = await sb.rpc('billing_simulate_demo_settlement', {
    p_invoice: invoiceId,
    p_demo_session_id: demoSessionId,
  });
  if (error || !data) {
    throw new Error(error?.message || 'Could not simulate demo settlement.');
  }
  const captureId = String(
    data.paypal_capture_id || data.capture_id || 'SAMPLE-DEMO-SETTLEMENT'
  );
  // Optimistically update preloaded cache
  preloadedCache.invoices = preloadedCache.invoices.map((inv) =>
    inv.id === invoiceId
      ? {
          ...inv,
          status: 'paid',
          amountPaidCents: inv.totalCents,
          balanceDueCents: 0,
          paidAt: new Date().toISOString(),
          receiptNumber: captureId,
          settlementVerificationStatus: 'sample_demo',
          verificationNotice: `Fictional Sample Record — Seeded demo settlement (${captureId}), not a live PayPal Sandbox capture.`,
        }
      : inv
  );
  preloadedCache.loadedAt = 0;
  return {
    captureId,
    invoiceNumber: String(data.invoice_number || ''),
  };
}

export async function simulateBillingDemoRefund(
  invoiceId: string,
  amountMinor?: number
): Promise<{
  refundId: string;
  invoiceNumber: string;
}> {
  const demoSessionId = await getOrCreateDemoSessionId();
  const { data, error } = await sb.rpc('billing_simulate_demo_refund', {
    p_invoice: invoiceId,
    p_amount_minor: amountMinor ?? null,
    p_demo_session_id: demoSessionId,
  });
  if (error || !data) {
    throw new Error(error?.message || 'Could not process demo refund.');
  }
  const refundId = String(data.paypal_refund_id || data.refund_id || 'DEMO-REFUND');
  preloadedCache.invoices = preloadedCache.invoices.map((inv) =>
    inv.id === invoiceId
      ? {
          ...inv,
          status: 'refunded',
          amountRefundedCents: amountMinor ?? inv.amountPaidCents,
          balanceDueCents: 0,
          refundedAt: new Date().toISOString(),
        }
      : inv
  );
  preloadedCache.loadedAt = 0;
  return {
    refundId,
    invoiceNumber: String(data.invoice_number || ''),
  };
}

export async function resetBillingDemoSession(): Promise<void> {
  const demoSessionId = await getOrCreateDemoSessionId();
  if (sb?.rpc) {
    const { error } = await sb.rpc('billing_reset_demo_session', {
      p_demo_session_id: demoSessionId,
    });
    if (error && process.env.NODE_ENV !== 'test') {
      throw new Error(error.message || 'Could not reset demo session.');
    }
  }
  localReadNotificationIds.clear();
  localSessionInvoiceOverridesBySession.clear();
  preloadedCache.invoices = getSyntheticInvoicesForRole('doctor');
  preloadedCache.notificationsByUserId = getDefaultNotificationsByUserId();
  preloadedCache.loadedAt = 0;
}

export async function updateBillingAISettings(
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
): Promise<BillingAISettingsRecord> {
  const payload: Record<string, unknown> = {};
  if (patch.maxSingleActionMinor !== undefined) {
    payload.max_single_action_minor = patch.maxSingleActionMinor;
  }
  if (patch.dailyLimitMinor !== undefined) {
    payload.daily_limit_minor = patch.dailyLimitMinor;
  }
  if (patch.allowInvoiceDrafting !== undefined) {
    payload.allow_invoice_drafting = patch.allowInvoiceDrafting;
  }
  if (patch.allowReminderDrafting !== undefined) {
    payload.allow_reminder_drafting = patch.allowReminderDrafting;
  }
  if (patch.allowCheckoutAssistance !== undefined) {
    payload.allow_checkout_assistance = patch.allowCheckoutAssistance;
  }
  if (patch.warnDuplicates !== undefined) {
    payload.warn_duplicates = patch.warnDuplicates;
  }
  if (patch.notifyNewInvoice !== undefined) {
    payload.notify_new_invoice = patch.notifyNewInvoice;
  }
  if (patch.notifyPaymentConfirmed !== undefined) {
    payload.notify_payment_confirmed = patch.notifyPaymentConfirmed;
  }
  if (patch.notifyPaymentFailed !== undefined) {
    payload.notify_payment_failed = patch.notifyPaymentFailed;
  }
  if (patch.notifyOverdue !== undefined) {
    payload.notify_overdue = patch.notifyOverdue;
  }
  if (patch.notifyRefund !== undefined) {
    payload.notify_refund = patch.notifyRefund;
  }
  if (patch.reminderDaysBeforeDue !== undefined) {
    payload.reminder_days_before_due = patch.reminderDaysBeforeDue;
  }

  const { data, error } = await sb.rpc('billing_update_ai_settings', {
    p: payload,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Failed to update Billing AI settings.');
  }

  const updated = mapDbSettingsRow(data, String(data.user_id || 'default'));
  preloadedCache.settingsByUserId[updated.userId] = updated;
  return updated;
}

export async function invokePayPalBillingFunction(
  body: Record<string, unknown>
): Promise<{
  ok: boolean;
  code?: string;
  message?: string;
  data?: any;
}> {
  try {
    if (!sb?.functions?.invoke) {
      return {
        ok: false,
        code: 'PAYPAL_SANDBOX_CREDENTIALS_MISSING',
        message:
          'PayPal Sandbox API credentials (PAYPAL_SANDBOX_CLIENT_ID / PAYPAL_SANDBOX_CLIENT_SECRET) are not configured in this environment.',
      };
    }

    const demoSessionId =
      (body.demoSessionId as string) ||
      (body.demo_session_id as string) ||
      getOrCreateDemoSessionIdSync();
    const enrichedBody: Record<string, unknown> = {
      ...body,
      demoSessionId,
      demo_session_id: demoSessionId,
    };
    if (body.invoice_id && !body.invoiceId) {
      enrichedBody.invoiceId = body.invoice_id;
    }
    if (body.invoiceId && !body.invoice_id) {
      enrichedBody.invoice_id = body.invoiceId;
    }
    if (body.order_id && !body.orderId) {
      enrichedBody.orderId = body.order_id;
    }
    if (body.orderId && !body.order_id) {
      enrichedBody.order_id = body.orderId;
    }
    if (body.role_scope && !body.roleScope) {
      enrichedBody.roleScope = body.role_scope;
    }
    if (body.roleScope && !body.role_scope) {
      enrichedBody.role_scope = body.roleScope;
    }

    const { data, error } = await sb.functions.invoke('paypal-billing', {
      body: enrichedBody,
    });

    if (error) {
      return {
        ok: false,
        code: data?.code || 'PAYPAL_EDGE_ERROR',
        message:
          data?.message ||
          error.message ||
          'PayPal Sandbox service could not complete the request.',
      };
    }

    if (data && data.ok === false) {
      return {
        ok: false,
        code: data.code || 'PAYPAL_SANDBOX_CREDENTIALS_MISSING',
        message:
          data.message ||
          'PayPal Sandbox API credentials are not configured on the server.',
        data,
      };
    }

    if (data && typeof data === 'object') {
      const rawApprove =
        data.approval_url || data.approveUrl || data.approvalUrl || null;
      if (rawApprove && typeof rawApprove === 'string') {
        const browserSafeApprove = rawApprove.includes('appSwitchEligible=')
          ? rawApprove
          : `${rawApprove}${rawApprove.includes('?') ? '&' : '?'}appSwitchEligible=false`;
        data.rawApprovalUrl = data.rawApprovalUrl || rawApprove;
        data.approvalUrl = browserSafeApprove;
        data.approval_url = browserSafeApprove;
        data.guestCardCheckoutUrl =
          data.guestCardCheckoutUrl || `${browserSafeApprove}&fundingSource=card`;
        const oid = data.orderId || data.order_id;
        if (oid && !data.classicWebCheckoutUrl) {
          data.classicWebCheckoutUrl = `https://www.sandbox.paypal.com/cgi-bin/webscr?cmd=_express-checkout&token=${encodeURIComponent(
            String(oid)
          )}&useraction=commit`;
        }
        data.appSwitchDisabled = true;
      }
    }

    return {
      ok: true,
      data,
    };
  } catch (err) {
    return {
      ok: false,
      code: 'PAYPAL_NETWORK_ERROR',
      message:
        err instanceof Error
          ? err.message
          : 'Could not reach the PayPal Sandbox backend.',
    };
  }
}

export async function payInvoiceWithSandboxCard(params: {
  invoiceId: string;
  invoiceNumber?: string;
  cardProfile?:
    | 'visa_sandbox'
    | 'mastercard_sandbox'
    | 'amex_sandbox'
    | 'decline_refused'
    | 'decline_expired'
    | 'decline_insufficient_funds';
  intent?: 'CAPTURE' | 'AUTHORIZE';
}): Promise<{
  ok: boolean;
  code?: string;
  message?: string;
  data?: any;
}> {
  const demoSessionId = getOrCreateDemoSessionIdSync();
  const result = await invokePayPalBillingFunction({
    action: 'pay-with-sandbox-card',
    invoiceId: params.invoiceId,
    invoiceNumber: params.invoiceNumber,
    cardProfile: params.cardProfile || 'visa_sandbox',
    intent: params.intent || 'CAPTURE',
  });
  if (result.ok && params.invoiceId) {
    let sessionMap = localSessionInvoiceOverridesBySession.get(demoSessionId);
    if (!sessionMap) {
      sessionMap = new Map();
      localSessionInvoiceOverridesBySession.set(demoSessionId, sessionMap);
    }
    const existingInv = preloadedCache.invoices.find(
      (i) => i.id === params.invoiceId
    );
    const totalMinor = existingInv?.totalCents ?? 5000;
    sessionMap.set(params.invoiceId, {
      invoice_id: params.invoiceId,
      status: 'paid',
      amount_paid_minor: totalMinor,
      amount_refunded_minor: 0,
      balance_due_minor: 0,
      paid_at: new Date().toISOString(),
    });
  }
  preloadedCache.loadedAt = 0;
  return result;
}

export async function checkPayPalCardEligibility(): Promise<{
  ok: boolean;
  code?: string;
  message?: string;
  data?: any;
}> {
  return invokePayPalBillingFunction({
    action: 'check-card-eligibility',
  });
}

export type BillingSearchCategory =
  | 'all'
  | 'invoice'
  | 'customer'
  | 'transaction'
  | 'refund';

export interface BillingSearchResultItem {
  id: string;
  category: Exclude<BillingSearchCategory, 'all'>;
  title: string;
  subtitle: string;
  badgeText: string;
  badgeTone: 'paid' | 'overdue' | 'pending' | 'failed' | 'refunded' | 'neutral';
  amountFormatted?: string;
  dateFormatted?: string;
  invoice: SyntheticBillingInvoice;
  matchedFields: string[];
}

export interface BillingSearchResponse {
  query: string;
  category: BillingSearchCategory;
  roleScope: BillingRoleScope;
  activeUserId: string;
  results: BillingSearchResultItem[];
  countsByCategory: {
    all: number;
    invoice: number;
    customer: number;
    transaction: number;
    refund: number;
  };
}

function formatSearchUsd(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toFixed(2)}`;
}

export function searchAuthorizedBillingRecords(params: {
  query: string;
  category?: BillingSearchCategory;
  roleScope: BillingRoleScope;
  activeUserId: string;
  invoices: SyntheticBillingInvoice[];
  billablePatients?: BillablePatientOption[];
}): BillingSearchResponse {
  const rawQuery = String(params.query || '').trim();
  const normalizedQuery = rawQuery.toLowerCase();
  const selectedCategory: BillingSearchCategory = params.category || 'all';
  const { roleScope, activeUserId } = params;

  // Enforce strict account isolation on invoices before building any search index
  const activePatientDisplayName =
    activeUserId === DEMO_USER_IDS.jordan_taylor ? 'Jordan Taylor' : 'Alex Rivera';
  const authorizedInvoices = (params.invoices || []).filter((inv) => {
    if (roleScope === 'doctor') {
      return true;
    }
    return (
      inv.patientDisplayName.toLowerCase() ===
        activePatientDisplayName.toLowerCase() && inv.status !== 'draft'
    );
  });

  const allItems: BillingSearchResultItem[] = [];

  // 1. Invoice / Statement records
  for (const inv of authorizedInvoices) {
    const lineItemCodes = inv.lineItems.map((li) => li.serviceCode).join(', ');
    const lineItemDescriptions = inv.lineItems.map((li) => li.description).join(' ');
    const totalFormatted = formatSearchUsd(inv.totalCents);
    const balanceFormatted = formatSearchUsd(inv.balanceDueCents);
    const statusLabel = inv.status.toUpperCase();

    const tone: BillingSearchResultItem['badgeTone'] =
      inv.status === 'paid'
        ? 'paid'
        : inv.status === 'overdue'
          ? 'overdue'
          : inv.status === 'failed'
            ? 'failed'
            : inv.status === 'refunded'
              ? 'refunded'
              : inv.status === 'sent'
                ? 'pending'
                : 'neutral';

    allItems.push({
      id: `inv-${inv.id}`,
      category: 'invoice',
      title: `#${inv.invoiceNumber} • ${inv.administrativeSummary}`,
      subtitle:
        roleScope === 'doctor'
          ? `Customer: ${inv.patientDisplayName} • ${lineItemCodes || 'ADMIN-SERVICE'} • Balance ${balanceFormatted}`
          : `Provider: ${inv.issuerDoctorName} (${inv.organizationName}) • ${lineItemCodes || 'ADMIN-SERVICE'}`,
      badgeText: statusLabel,
      badgeTone: tone,
      amountFormatted: totalFormatted,
      dateFormatted: inv.dueDate,
      invoice: inv,
      matchedFields: [
        inv.invoiceNumber,
        inv.administrativeSummary,
        inv.patientDisplayName,
        inv.issuerDoctorName,
        inv.organizationName,
        inv.status,
        totalFormatted,
        String(inv.totalCents / 100),
        balanceFormatted,
        inv.dueDate,
        lineItemCodes,
        lineItemDescriptions,
      ],
    });
  }

  // 2. Customer / Counterpart records (strictly scoped to active account)
  if (roleScope === 'doctor') {
    const patientsMap = new Map<
      string,
      {
        patientId: string;
        fullName: string;
        emailMasked: string | null;
        invoices: SyntheticBillingInvoice[];
      }
    >();

    for (const bp of params.billablePatients || DEFAULT_BILLABLE_PATIENTS) {
      patientsMap.set(bp.fullName.toLowerCase(), {
        patientId: bp.patientId,
        fullName: bp.fullName,
        emailMasked: bp.emailMasked,
        invoices: [],
      });
    }

    for (const inv of authorizedInvoices) {
      const key = inv.patientDisplayName.toLowerCase();
      const existing = patientsMap.get(key);
      if (existing) {
        existing.invoices.push(inv);
      } else {
        patientsMap.set(key, {
          patientId: key,
          fullName: inv.patientDisplayName,
          emailMasked: null,
          invoices: [inv],
        });
      }
    }

    for (const [, p] of patientsMap) {
      if (p.invoices.length === 0) continue;
      const openBalanceCents = p.invoices.reduce(
        (acc, inv) =>
          inv.status === 'sent' || inv.status === 'overdue' || inv.status === 'failed'
            ? acc + inv.balanceDueCents
            : acc,
        0
      );
      const primaryInvoice =
        p.invoices.find(
          (inv) =>
            inv.status === 'overdue' || inv.status === 'failed' || inv.status === 'sent'
        ) || p.invoices[0];

      allItems.push({
        id: `cust-${p.patientId}`,
        category: 'customer',
        title: `${p.fullName} (Customer Account)`,
        subtitle: `${p.invoices.length} statements (${p.invoices
          .map((i) => `#${i.invoiceNumber}`)
          .join(', ')}) • Open balance ${formatSearchUsd(openBalanceCents)}${
          p.emailMasked ? ` • ${p.emailMasked}` : ''
        }`,
        badgeText: openBalanceCents > 0 ? 'OPEN BALANCE' : 'SETTLED',
        badgeTone: openBalanceCents > 0 ? 'pending' : 'paid',
        amountFormatted: formatSearchUsd(openBalanceCents),
        invoice: primaryInvoice,
        matchedFields: [
          p.fullName,
          p.emailMasked || '',
          'customer',
          'patient',
          ...p.invoices.map((i) => i.invoiceNumber),
        ],
      });
    }
  } else {
    // Customer view: only expose the active customer's own account & their provider
    const primaryInvoice = authorizedInvoices[0];
    if (primaryInvoice) {
      const openBalanceCents = authorizedInvoices.reduce(
        (acc, inv) =>
          inv.status === 'sent' || inv.status === 'overdue' || inv.status === 'failed'
            ? acc + inv.balanceDueCents
            : acc,
        0
      );
      allItems.push({
        id: `cust-self-${activeUserId}`,
        category: 'customer',
        title: `${primaryInvoice.patientDisplayName} • Active Customer Account`,
        subtitle: `Billed by ${primaryInvoice.issuerDoctorName} (${primaryInvoice.organizationName}) • ${authorizedInvoices.length} statements`,
        badgeText: openBalanceCents > 0 ? 'BALANCE DUE' : 'ALL PAID',
        badgeTone: openBalanceCents > 0 ? 'pending' : 'paid',
        amountFormatted: formatSearchUsd(openBalanceCents),
        invoice: primaryInvoice,
        matchedFields: [
          primaryInvoice.patientDisplayName,
          primaryInvoice.issuerDoctorName,
          primaryInvoice.organizationName,
          ...authorizedInvoices.map((i) => i.invoiceNumber),
        ],
      });
    }
  }

  // 3. Transactions & Payment Attempts (Captures, Orders, Declined Cards, Sample Settlements)
  for (const inv of authorizedInvoices) {
    if (inv.receiptNumber && (inv.status === 'paid' || inv.amountPaidCents > 0)) {
      const isLivePayPal = inv.settlementVerificationStatus === 'paypal_verified';
      allItems.push({
        id: `tx-receipt-${inv.id}`,
        category: 'transaction',
        title: `${
          isLivePayPal ? 'PayPal Sandbox Capture' : 'Sample Settlement'
        } • ${inv.receiptNumber}`,
        subtitle: `Statement #${inv.invoiceNumber} (${inv.patientDisplayName}) • ${
          isLivePayPal ? 'Verified PayPal Capture' : 'Seeded Demo Settlement'
        }`,
        badgeText: isLivePayPal ? 'PAYPAL CAPTURED' : 'DEMO PAID',
        badgeTone: 'paid',
        amountFormatted: formatSearchUsd(inv.amountPaidCents || inv.totalCents),
        dateFormatted: inv.paidAt || inv.dueDate,
        invoice: inv,
        matchedFields: [
          inv.receiptNumber,
          inv.invoiceNumber,
          inv.patientDisplayName,
          isLivePayPal ? 'paypal verified capture' : 'sample demo settlement',
          formatSearchUsd(inv.amountPaidCents || inv.totalCents),
        ],
      });
    }

    for (const att of inv.paymentAttempts || []) {
      const isFailed =
        att.status === 'failed_demo' &&
        att.attemptClassification !== 'approval_required' &&
        att.attemptClassification !== 'awaiting_buyer_approval';
      const isApprovalPending =
        att.attemptClassification === 'approval_required' ||
        att.attemptClassification === 'awaiting_buyer_approval';
      const refCode = att.demoReferenceCode || att.id;
      const cardInfo =
        att.cardBrand && att.cardLastDigits
          ? `${att.cardBrand.toUpperCase()} •••• ${att.cardLastDigits}`
          : att.paymentSourceType || 'PayPal Sandbox';

      allItems.push({
        id: `tx-att-${att.id}`,
        category: 'transaction',
        title: `${
          isFailed
            ? `Declined Payment Attempt (${refCode})`
            : isApprovalPending
              ? `PayPal Order Awaiting Approval (${refCode})`
              : `Payment Transaction (${refCode})`
        }`,
        subtitle: `Statement #${inv.invoiceNumber} • ${inv.patientDisplayName} • ${cardInfo}${
          att.failureReason ? ` • ${att.failureReason}` : ''
        }`,
        badgeText: isFailed
          ? 'DECLINED'
          : isApprovalPending
            ? 'AWAITING APPROVAL'
            : 'SETTLED',
        badgeTone: isFailed ? 'failed' : isApprovalPending ? 'pending' : 'paid',
        amountFormatted: formatSearchUsd(att.amountCents || inv.totalCents),
        dateFormatted: att.attemptedAt,
        invoice: inv,
        matchedFields: [
          refCode,
          att.demoReferenceCode || '',
          att.paypalErrorCode || '',
          att.failureReason || '',
          att.actionableMessage || '',
          cardInfo,
          inv.invoiceNumber,
          inv.patientDisplayName,
          isFailed ? 'failed declined instrument_declined' : 'payment transaction order',
        ],
      });
    }
  }

  // 4. Refunds & Refunded Receipts
  for (const inv of authorizedInvoices) {
    if (inv.status === 'refunded' || inv.amountRefundedCents > 0) {
      const refundCents = inv.amountRefundedCents || inv.totalCents;
      const refId = inv.receiptNumber || `REF-${inv.invoiceNumber}`;
      allItems.push({
        id: `refund-${inv.id}`,
        category: 'refund',
        title: `Refund Processed • #${inv.invoiceNumber} (${refId})`,
        subtitle: `Customer: ${inv.patientDisplayName} • ${inv.administrativeSummary} • Refunded ${formatSearchUsd(
          refundCents
        )} ($0.00 balance due)`,
        badgeText: 'REFUNDED',
        badgeTone: 'refunded',
        amountFormatted: formatSearchUsd(refundCents),
        dateFormatted: inv.refundedAt || inv.dueDate,
        invoice: inv,
        matchedFields: [
          'refund',
          'refunded',
          refId,
          inv.invoiceNumber,
          inv.patientDisplayName,
          inv.administrativeSummary,
          formatSearchUsd(refundCents),
          String(refundCents / 100),
        ],
      });
    }
  }

  // Filter by query across matchedFields, title, subtitle, badgeText
  const queryMatched = normalizedQuery
    ? allItems.filter((item) => {
        const haystack = [
          item.title,
          item.subtitle,
          item.badgeText,
          item.amountFormatted || '',
          ...item.matchedFields,
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(normalizedQuery);
      })
    : allItems;

  const countsByCategory = {
    all: queryMatched.length,
    invoice: queryMatched.filter((i) => i.category === 'invoice').length,
    customer: queryMatched.filter((i) => i.category === 'customer').length,
    transaction: queryMatched.filter((i) => i.category === 'transaction').length,
    refund: queryMatched.filter((i) => i.category === 'refund').length,
  };

  const filteredResults =
    selectedCategory === 'all'
      ? queryMatched
      : queryMatched.filter((i) => i.category === selectedCategory);

  return {
    query: rawQuery,
    category: selectedCategory,
    roleScope,
    activeUserId,
    results: filteredResults,
    countsByCategory,
  };
}


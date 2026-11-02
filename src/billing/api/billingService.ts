import { supabase } from '@/src/lib/supabase';
import type {
  BillingNotificationItem,
  BillingRoleScope,
  SyntheticBillingInvoice,
  SyntheticInvoiceLineItem,
  SyntheticInvoiceStatus,
  SyntheticPaymentAttempt,
} from '../types';
import { getSyntheticInvoicesForRole } from '../data/syntheticBillingFixtures';

const sb = supabase as any;

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
  roleScope: BillingRoleScope
): Promise<BillingDashboardData> {
  const fallbackInvoices = getSyntheticInvoicesForRole(roleScope);
  const defaultConnection: PayPalAccountConnectionSummary = {
    connected: false,
    environment: 'sandbox',
    connectionType: roleScope === 'doctor' ? 'merchant' : 'payer',
    paypalEmailMasked: null,
    paypalPayerIdMasked: null,
    connectedAt: null,
    sandboxCredentialsConfigured: false,
  };

  try {
    if (process.env.NODE_ENV === 'test' || !sb?.from || !sb?.rpc) {
      return {
        invoices: fallbackInvoices,
        catalog: DEFAULT_SERVICE_CATALOG,
        billablePatients: [
          {
            patientId: '11111111-1111-4111-8111-111111111102',
            fullName: 'Alex Rivera',
            emailMasked: 'a***@demo.paypal-billing-kit.local',
          },
          {
            patientId: '11111111-1111-4111-8111-111111111103',
            fullName: 'Jordan Taylor',
            emailMasked: 'j***@demo.paypal-billing-kit.local',
          },
        ],
        settings: getDefaultBillingAISettings(),
        connection: defaultConnection,
        auditEvents: [],
        notifications: [],
        isLiveStagingData: false,
      };
    }

    let userId: string | undefined;
    if (typeof supabase.auth.getSession === 'function') {
      const { data: sessData } = await supabase.auth.getSession();
      userId = sessData?.session?.user?.id;
    } else if (typeof supabase.auth.getUser === 'function') {
      const { data: authData } = await supabase.auth.getUser();
      userId = authData?.user?.id;
    }
    if (!userId) {
      return {
        invoices: fallbackInvoices,
        catalog: DEFAULT_SERVICE_CATALOG,
        billablePatients: [
          {
            patientId: '11111111-1111-4111-8111-111111111102',
            fullName: 'Alex Rivera',
            emailMasked: 'a***@demo.paypal-billing-kit.local',
          },
          {
            patientId: '11111111-1111-4111-8111-111111111103',
            fullName: 'Jordan Taylor',
            emailMasked: 'j***@demo.paypal-billing-kit.local',
          },
        ],
        settings: getDefaultBillingAISettings(),
        connection: defaultConnection,
        auditEvents: [],
        notifications: [],
        isLiveStagingData: false,
      };
    }

    if (roleScope === 'doctor') {
      try {
        await sb.rpc('billing_ensure_org');
      } catch {
        // Best effort
      }
    }
    try {
      await sb.rpc('billing_refresh_overdue');
    } catch {
      // Best effort
    }

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
    ] = await Promise.all([
      sb
        .from('billing_invoices')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100),
      sb.from('billing_invoice_items').select('*').order('position', { ascending: true }),
      sb.from('billing_payment_attempts').select('*').order('created_at', { ascending: false }),
      sb.from('billing_transactions').select('*').order('captured_at', { ascending: false }),
      sb.from('billing_organizations').select('id, name, owner_user_id'),
      sb.from('billing_service_catalog').select('*').eq('active', true).order('code', { ascending: true }),
      sb.from('billing_ai_settings').select('*').eq('user_id', userId).maybeSingle(),
      sb
        .from('billing_account_connections')
        .select('*')
        .eq('user_id', userId)
        .eq('connection_type', roleScope === 'doctor' ? 'merchant' : 'payer')
        .maybeSingle(),
      sb
        .from('billing_audit_events')
        .select('id, event_type, actor_kind, created_at, details')
        .order('created_at', { ascending: false })
        .limit(100),
      roleScope === 'doctor'
        ? sb.rpc('billing_list_billable_patients')
        : Promise.resolve({ data: [] }),
      sb
        .from('billing_notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(25),
    ]);

    const dbInvoices: any[] = Array.isArray(invRes?.data) ? invRes.data : [];
    const dbItems: any[] = Array.isArray(itemsRes?.data) ? itemsRes.data : [];
    const dbAttempts: any[] = Array.isArray(attemptsRes?.data) ? attemptsRes.data : [];
    const dbTx: any[] = Array.isArray(txRes?.data) ? txRes.data : [];
    const dbOrgs: any[] = Array.isArray(orgsRes?.data) ? orgsRes.data : [];

    const counterpartyIds = Array.from(
      new Set(
        dbInvoices
          .flatMap((i) => [i.issuer_user_id, i.recipient_user_id])
          .filter(Boolean)
      )
    );
    const nameMap = new Map<string, string>();
    if (counterpartyIds.length > 0) {
      let namesData: any[] = [];
      try {
        const res = await sb.rpc('billing_counterparty_names', { p_ids: counterpartyIds });
        namesData = Array.isArray(res?.data) ? res.data : [];
      } catch {
        namesData = [];
      }
      for (const n of namesData) {
        if (n?.user_id && n?.full_name) {
          nameMap.set(String(n.user_id), String(n.full_name));
        }
      }
    }

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
          const isFailed =
            at.status === 'failed' || at.status === 'cancelled' || at.status === 'expired';
          const isCompleted = at.status === 'completed';
          return {
            id: String(at.id),
            attemptedAt: String(at.created_at),
            amountCents: Number(at.amount_minor || 0),
            currencyCode: 'USD' as const,
            status: isFailed
              ? 'failed_demo'
              : isCompleted
                ? 'simulated_paid_demo'
                : 'pending_demo',
            statusLabel: isFailed
              ? 'Unsuccessful PayPal Attempt'
              : isCompleted
                ? isSampleSeedSettlement
                  ? 'Sample Demo Settlement (Seeded)'
                  : 'Verified PayPal Sandbox Capture'
                : 'PayPal Checkout Initiated',
            failureReason: at.failure_message ? String(at.failure_message) : undefined,
            demoReferenceCode: String(at.paypal_order_id || at.request_id || at.id),
          };
        });

      const hasFailedAttempt = invAttempts.some((a) => a.status === 'failed_demo');
      const dueDateStr = String(inv.due_date || new Date().toISOString().slice(0, 10));
      const mappedStatus = mapDbInvoiceStatus(inv.status, dueDateStr, hasFailedAttempt);

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
        issuerDoctorName:
          nameMap.get(String(inv.issuer_user_id)) || 'Dr. Sarah Jenkins',
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
        receiptNumber: matchingTx?.paypal_capture_id
          ? isSampleSeedSettlement
            ? String(matchingTx.paypal_capture_id)
            : `PP-CAP-${matchingTx.paypal_capture_id}`
          : undefined,
        settlementVerificationStatus: isPayPalVerifiedSettlement
          ? 'paypal_verified'
          : isSampleSeedSettlement
            ? 'sample_demo'
            : 'unpaid',
        administrativeSummary: primarySummary,
        statementMemoSafe:
          'Administrative billing statement stored in dedicated Supabase project with Row-Level Security.',
        isSyntheticDemoRecord: true,
        verificationNotice: isPayPalVerifiedSettlement
          ? `Verified PayPal Sandbox Capture (${matchingTx.paypal_capture_id})`
          : isSampleSeedSettlement
            ? `Fictional Sample Record — Seeded demo settlement (${matchingTx.paypal_capture_id}), not a live PayPal Sandbox capture.`
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

    const billablePatients: BillablePatientOption[] = Array.isArray(patientsRes?.data)
      ? patientsRes.data.map((p: any) => ({
          patientId: String(p.patient_id),
          fullName: String(p.full_name || 'Authorized Customer'),
          emailMasked: p.email_masked ? String(p.email_masked) : null,
        }))
      : [];

    const connRow = connRes?.data;
    const connection: PayPalAccountConnectionSummary = connRow
      ? {
          connected:
            connRow.connection_status === 'connected' || connRow.status === 'connected',
          environment: (connRow.paypal_env || connRow.environment || 'sandbox') as
            | 'sandbox'
            | 'live',
          connectionType: (roleScope === 'doctor' ? 'merchant' : 'payer') as
            | 'merchant'
            | 'payer',
          paypalEmailMasked: connRow.paypal_email_masked
            ? String(connRow.paypal_email_masked)
            : null,
          paypalPayerIdMasked: connRow.paypal_payer_id
            ? String(connRow.paypal_payer_id)
            : null,
          connectedAt: connRow.connected_at ? String(connRow.connected_at) : null,
          sandboxCredentialsConfigured: false,
        }
      : defaultConnection;

    const auditEvents: BillingAuditEventItem[] = Array.isArray(auditRes?.data)
      ? auditRes.data.map((a: any) => ({
          id: Number(a.id),
          eventType: String(a.event_type),
          actorKind: (a.actor_kind || 'system') as BillingAuditEventItem['actorKind'],
          createdAt: String(a.created_at),
          details: a.details && typeof a.details === 'object' ? a.details : {},
        }))
      : [];

    const notifications: BillingNotificationItem[] = Array.isArray(notifRes?.data)
      ? notifRes.data.map((n: any) => ({
          id: String(n.id),
          recipientUserId: String(n.user_id || userId),
          invoiceId: n.metadata?.invoiceId
            ? String(n.metadata.invoiceId)
            : n.invoice_id
              ? String(n.invoice_id)
              : null,
          type: String(n.type || 'billing_alert'),
          title: String(n.title || 'Billing Notification'),
          body: String(n.body || ''),
          deepLink: String(n.metadata?.route || n.deep_link || '/billing'),
          isRead: Boolean(n.read ?? n.is_read),
          createdAt: String(n.created_at || new Date().toISOString()),
        }))
      : [];

    return {
      invoices: mappedDbInvoices.length > 0 ? mappedDbInvoices : fallbackInvoices,
      catalog,
      billablePatients,
      settings: mapDbSettingsRow(settingsRes?.data, userId),
      connection,
      auditEvents,
      notifications,
      isLiveStagingData: mappedDbInvoices.length > 0,
    };
  } catch (err) {
    console.error('fetchBillingDashboardData error:', err);
    return {
      invoices: fallbackInvoices,
      catalog: DEFAULT_SERVICE_CATALOG,
      billablePatients: [],
      settings: getDefaultBillingAISettings(),
      connection: defaultConnection,
      auditEvents: [],
      notifications: [],
      isLiveStagingData: false,
    };
  }
}

export async function markBillingNotificationRead(notificationId: string): Promise<void> {
  if (!notificationId || !sb?.from) return;
  try {
    await sb
      .from('billing_notifications')
      .update({ read: true })
      .eq('id', notificationId);
  } catch {
    // Non-fatal
  }
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

  const { data, error } = await sb.rpc('billing_create_invoice', {
    p_recipient: params.recipientUserId,
    p_items: rpcItems,
    p_due_date: params.dueDate,
    p_send: params.sendImmediately,
    p_idempotency_key: params.idempotencyKey ?? `inv-${Date.now()}`,
    p_ai_proposal_id: params.aiProposalId ?? null,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Could not create invoice.');
  }

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
}

export async function voidBillingInvoice(invoiceId: string): Promise<void> {
  const { error } = await sb.rpc('billing_void_invoice', {
    p_invoice: invoiceId,
  });
  if (error) {
    throw new Error(error.message || 'Could not void invoice.');
  }
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

  return mapDbSettingsRow(data, String(data.user_id || 'default'));
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

    const { data, error } = await sb.functions.invoke('paypal-billing', {
      body,
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

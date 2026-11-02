import type {
  PayPalNormalizedFinancialEvent,
  PayPalWebhookHeaders,
} from './types';

function parseUsdValueToMinor(value: unknown): number | null {
  const num = typeof value === 'string' ? Number.parseFloat(value) : typeof value === 'number' ? value : NaN;
  if (!Number.isFinite(num)) return null;
  return Math.round(num * 100);
}

export function extractPayPalWebhookHeaders(
  headers: Headers | Record<string, string | undefined>
): PayPalWebhookHeaders {
  const get = (name: string): string | null => {
    if (typeof (headers as Headers).get === 'function') {
      return (headers as Headers).get(name);
    }
    const rec = headers as Record<string, string | undefined>;
    return rec[name] ?? rec[name.toLowerCase()] ?? rec[name.toUpperCase()] ?? null;
  };

  return {
    authAlgo: get('paypal-auth-algo'),
    certUrl: get('paypal-cert-url'),
    transmissionId: get('paypal-transmission-id'),
    transmissionSig: get('paypal-transmission-sig'),
    transmissionTime: get('paypal-transmission-time'),
  };
}

export function hasRequiredWebhookHeaders(h: PayPalWebhookHeaders): boolean {
  return Boolean(
    h.authAlgo &&
      h.certUrl &&
      h.transmissionId &&
      h.transmissionSig &&
      h.transmissionTime
  );
}

export function normalizePayPalWebhookEvent(payload: any): PayPalNormalizedFinancialEvent {
  const eventId = String(payload?.id || '');
  const eventType = String(payload?.event_type || '').toUpperCase();
  const resource = payload?.resource || {};

  let kind: PayPalNormalizedFinancialEvent['kind'] = 'unknown';
  if (eventType === 'PAYMENT.CAPTURE.COMPLETED') {
    kind = 'capture_completed';
  } else if (eventType === 'PAYMENT.CAPTURE.DENIED' || eventType === 'PAYMENT.CAPTURE.DECLINED') {
    kind = 'capture_denied';
  } else if (eventType === 'PAYMENT.CAPTURE.REFUNDED') {
    kind = 'capture_refunded';
  } else if (eventType === 'CHECKOUT.ORDER.APPROVED') {
    kind = 'order_approved';
  } else if (eventType === 'INVOICING.INVOICE.PAID') {
    kind = 'invoice_paid';
  } else if (eventType === 'INVOICING.INVOICE.CANCELLED') {
    kind = 'invoice_cancelled';
  }

  const orderId =
    resource?.supplementary_data?.related_ids?.order_id ??
    (kind === 'order_approved' ? resource?.id : null) ??
    null;

  const captureId =
    kind === 'capture_completed' || kind === 'capture_denied'
      ? String(resource?.id || '') || null
      : null;

  const refundId =
    kind === 'capture_refunded' ? String(resource?.id || '') || null : null;

  const invoiceId =
    resource?.custom_id ??
    resource?.invoice_id ??
    resource?.purchase_units?.[0]?.custom_id ??
    resource?.purchase_units?.[0]?.invoice_id ??
    null;

  const amountNode =
    resource?.amount ??
    resource?.purchase_units?.[0]?.amount ??
    null;

  const amountMinor = parseUsdValueToMinor(amountNode?.value);
  const currency = String(amountNode?.currency_code || 'USD').toUpperCase();

  return {
    eventId,
    eventType,
    kind,
    orderId: orderId ? String(orderId) : null,
    captureId,
    refundId,
    invoiceId: invoiceId ? String(invoiceId) : null,
    amountMinor,
    currency,
    occurredAt: String(payload?.create_time || resource?.create_time || new Date().toISOString()),
  };
}

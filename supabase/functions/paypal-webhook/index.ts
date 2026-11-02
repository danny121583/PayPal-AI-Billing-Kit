import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, paypal-transmission-id, paypal-transmission-time, paypal-transmission-sig, paypal-cert-url, paypal-auth-algo',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function resolvePayPalBaseUrl(envName: string): string {
  return envName === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

async function fetchPayPalAccessToken(
  baseUrl: string,
  clientId: string,
  clientSecret: string
): Promise<string> {
  const credentials = btoa(`${clientId}:${clientSecret}`);
  const res = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) {
    throw new Error(`PayPal OAuth failed (${res.status})`);
  }
  const data = await res.json();
  return String(data.access_token || '');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const paypalClientId = (
      Deno.env.get('PAYPAL_SANDBOX_CLIENT_ID') ??
      Deno.env.get('PAYPAL_CLIENT_ID') ??
      ''
    ).trim();
    const paypalClientSecret = (
      Deno.env.get('PAYPAL_SANDBOX_CLIENT_SECRET') ??
      Deno.env.get('PAYPAL_CLIENT_SECRET') ??
      ''
    ).trim();
    const paypalWebhookId = (
      Deno.env.get('PAYPAL_SANDBOX_WEBHOOK_ID') ??
      Deno.env.get('PAYPAL_WEBHOOK_ID') ??
      ''
    ).trim();
    const paypalEnv = (Deno.env.get('PAYPAL_ENV') ?? 'sandbox').toLowerCase();

    const transmissionId = req.headers.get('paypal-transmission-id') ?? '';
    const transmissionTime = req.headers.get('paypal-transmission-time') ?? '';
    const transmissionSig = req.headers.get('paypal-transmission-sig') ?? '';
    const certUrl = req.headers.get('paypal-cert-url') ?? '';
    const authAlgo = req.headers.get('paypal-auth-algo') ?? '';

    if (!transmissionId || !transmissionTime || !transmissionSig || !certUrl || !authAlgo) {
      return new Response(
        JSON.stringify({
          ok: false,
          code: 'MISSING_SIGNATURE_HEADERS',
          message: 'PayPal webhook signature headers are required.',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const rawBody = await req.text();
    let webhookEvent: any = null;
    try {
      webhookEvent = JSON.parse(rawBody);
    } catch {
      return new Response(
        JSON.stringify({ ok: false, code: 'INVALID_JSON', message: 'Invalid webhook JSON.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const eventId = String(webhookEvent?.id || '');
    const eventType = String(webhookEvent?.event_type || '');
    const resource = webhookEvent?.resource ?? {};
    const resourceId = String(resource?.id || '');

    if (!eventId || !eventType) {
      return new Response(
        JSON.stringify({ ok: false, code: 'MISSING_EVENT_ID', message: 'Webhook event id and type are required.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey);

    const { data: existingEvent } = await serviceClient
      .from('billing_webhook_events')
      .select('id, processing_status, signature_verified')
      .eq('paypal_event_id', eventId)
      .maybeSingle();

    if (existingEvent?.id && existingEvent.processing_status === 'processed') {
      return new Response(
        JSON.stringify({
          ok: true,
          idempotentReplay: true,
          eventId,
          status: 'already_processed',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!paypalClientId || !paypalClientSecret || !paypalWebhookId) {
      return new Response(
        JSON.stringify({
          ok: false,
          code: 'WEBHOOK_VERIFICATION_UNCONFIGURED',
          message: 'PayPal webhook verification credentials are not configured on the server.',
        }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const baseUrl = resolvePayPalBaseUrl(paypalEnv);
    const accessToken = await fetchPayPalAccessToken(baseUrl, paypalClientId, paypalClientSecret);

    const verifyRes = await fetch(`${baseUrl}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        auth_algo: authAlgo,
        cert_url: certUrl,
        transmission_id: transmissionId,
        transmission_sig: transmissionSig,
        transmission_time: transmissionTime,
        webhook_id: paypalWebhookId,
        webhook_event: webhookEvent,
      }),
    });

    const verifyData = verifyRes.ok ? await verifyRes.json() : null;
    const verified = verifyData?.verification_status === 'SUCCESS';

    if (!verified) {
      await serviceClient.from('billing_webhook_events').upsert(
        {
          paypal_event_id: eventId,
          event_type: eventType,
          resource_id: resourceId,
          signature_verified: false,
          processing_status: 'rejected_signature',
          summary: { reason: 'Signature verification failed' },
          processed_at: new Date().toISOString(),
        },
        { onConflict: 'paypal_event_id' }
      );

      return new Response(
        JSON.stringify({
          ok: false,
          code: 'INVALID_WEBHOOK_SIGNATURE',
          message: 'PayPal webhook signature verification failed.',
        }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    await serviceClient.from('billing_webhook_events').upsert(
      {
        paypal_event_id: eventId,
        event_type: eventType,
        resource_id: resourceId,
        signature_verified: true,
        processing_status: 'processing',
        summary: {
          event_type: eventType,
          resource_id: resourceId,
        },
      },
      { onConflict: 'paypal_event_id' }
    );

    if (eventType === 'PAYMENT.CAPTURE.COMPLETED') {
      const orderId = String(
        resource?.supplementary_data?.related_ids?.order_id || ''
      );
      const customInvoiceId = String(resource?.custom_id || '');
      const captureStatus = String(resource?.status || 'COMPLETED').toUpperCase();
      const amountMinor = Math.round(
        Number.parseFloat(String(resource?.amount?.value || '0')) * 100
      );
      const currency = String(resource?.amount?.currency_code || 'USD').toUpperCase();

      let invoiceRow: any = null;
      if (customInvoiceId) {
        const { data } = await serviceClient
          .from('billing_invoices')
          .select('*')
          .eq('id', customInvoiceId)
          .maybeSingle();
        invoiceRow = data;
      }
      if (!invoiceRow && orderId) {
        const { data } = await serviceClient
          .from('billing_invoices')
          .select('*')
          .eq('paypal_order_id', orderId)
          .maybeSingle();
        invoiceRow = data;
      }

      if (invoiceRow) {
        await serviceClient.rpc('billing_apply_verified_capture', {
          p_invoice: invoiceRow.id,
          p_payer: invoiceRow.recipient_user_id,
          p_order_id: orderId || invoiceRow.paypal_order_id || `WH-ORD-${eventId}`,
          p_capture_id: resourceId,
          p_amount_minor: amountMinor,
          p_currency: currency,
          p_paypal_status: captureStatus,
          p_payer_email_masked: 'sb-***@sandbox.paypal.com',
          p_verified_via: 'webhook',
        });
      }
    } else if (eventType === 'PAYMENT.CAPTURE.DENIED' || eventType === 'CHECKOUT.ORDER.DECLINED') {
      const orderId = String(
        resource?.supplementary_data?.related_ids?.order_id || resource?.id || ''
      );
      if (orderId) {
        await serviceClient
          .from('billing_payment_attempts')
          .update({
            status: 'failed',
            failure_code: eventType,
            failure_message: 'PayPal Sandbox reported a declined or denied payment attempt.',
            updated_at: new Date().toISOString(),
          })
          .eq('paypal_order_id', orderId);
      }
    } else if (eventType === 'PAYMENT.CAPTURE.REFUNDED') {
      const refundId = resourceId;
      const { data: pendingRefund } = await serviceClient
        .from('billing_refunds')
        .select('id')
        .eq('paypal_refund_id', refundId)
        .maybeSingle();

      if (pendingRefund?.id) {
        await serviceClient.rpc('billing_apply_refund_result', {
          p_refund: pendingRefund.id,
          p_status: 'completed',
          p_paypal_refund_id: refundId,
          p_failure: null,
        });
      }
    }

    await serviceClient
      .from('billing_webhook_events')
      .update({
        processing_status: 'processed',
        processed_at: new Date().toISOString(),
      })
      .eq('paypal_event_id', eventId);

    return new Response(
      JSON.stringify({ ok: true, eventId, status: 'processed' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        ok: false,
        code: 'WEBHOOK_INTERNAL_ERROR',
        message: err instanceof Error ? err.message : 'Internal webhook error',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

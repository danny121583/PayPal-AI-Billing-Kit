import type {
  PayPalAgentKitConfig,
  PayPalCreateOrderRequest,
  PayPalCredentialsStatus,
  PayPalEnvironment,
  PayPalOAuthToken,
  PayPalOrderSummary,
  PayPalRefundResult,
  PayPalVerifiedCapture,
  PayPalWebhookHeaders,
} from './types';
import {
  assertPhiFreePayload,
  maskEmailAddress,
  sanitizeAdministrativeDescription,
} from './phiAllowlist';
import { hasRequiredWebhookHeaders } from './webhooks';

export function getPayPalApiBaseUrl(env: PayPalEnvironment): string {
  return env === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

export function getPayPalWebAuthBaseUrl(env: PayPalEnvironment): string {
  return env === 'live'
    ? 'https://www.paypal.com'
    : 'https://www.sandbox.paypal.com';
}

function encodeBasicAuth(clientId: string, clientSecret: string): string {
  const raw = `${clientId}:${clientSecret}`;
  if (typeof btoa === 'function') {
    return btoa(raw);
  }
  return Buffer.from(raw, 'utf8').toString('base64');
}

export function formatMinorToUsdString(amountMinor: number): string {
  const safe = Math.max(0, Math.trunc(amountMinor));
  return (safe / 100).toFixed(2);
}

export function parseUsdStringToMinor(value: string | number): number {
  const num = typeof value === 'number' ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.round(num * 100);
}

export class PayPalCredentialsMissingError extends Error {
  readonly code = 'PAYPAL_SANDBOX_CREDENTIALS_MISSING';
  constructor(message = 'PayPal Sandbox API credentials (PAYPAL_SANDBOX_CLIENT_ID / PAYPAL_SANDBOX_CLIENT_SECRET) are not configured on the server.') {
    super(message);
    this.name = 'PayPalCredentialsMissingError';
  }
}

export class PayPalAgentKitClient {
  private readonly config: PayPalAgentKitConfig;
  private readonly fetchFn: typeof fetch;
  private cachedToken: PayPalOAuthToken | null = null;

  constructor(config: PayPalAgentKitConfig) {
    this.config = {
      ...config,
      environment: config.environment || 'sandbox',
    };
    this.fetchFn = config.fetchImpl ?? fetch;
  }

  getCredentialsStatus(): PayPalCredentialsStatus {
    const clientId = String(this.config.clientId || '').trim();
    const clientSecret = String(this.config.clientSecret || '').trim();
    const webhookId = String(this.config.webhookId || '').trim();
    return {
      configured: Boolean(clientId && clientSecret),
      environment: this.config.environment,
      hasClientId: Boolean(clientId),
      hasClientSecret: Boolean(clientSecret),
      hasWebhookId: Boolean(webhookId),
      baseUrl: getPayPalApiBaseUrl(this.config.environment),
      authUrl: getPayPalWebAuthBaseUrl(this.config.environment),
    };
  }

  private assertConfigured(): { clientId: string; clientSecret: string; baseUrl: string } {
    const clientId = String(this.config.clientId || '').trim();
    const clientSecret = String(this.config.clientSecret || '').trim();
    if (!clientId || !clientSecret) {
      throw new PayPalCredentialsMissingError();
    }
    return {
      clientId,
      clientSecret,
      baseUrl: getPayPalApiBaseUrl(this.config.environment),
    };
  }

  async getAccessToken(forceRefresh = false): Promise<string> {
    if (
      !forceRefresh &&
      this.cachedToken &&
      Date.now() + 30_000 < this.cachedToken.expiresAtMs
    ) {
      return this.cachedToken.accessToken;
    }

    const { clientId, clientSecret, baseUrl } = this.assertConfigured();
    const res = await this.fetchFn(`${baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${encodeBasicAuth(clientId, clientSecret)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: 'grant_type=client_credentials',
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`PayPal OAuth token request failed (${res.status}): ${errText.slice(0, 200)}`);
    }

    const data = (await res.json()) as any;
    const expiresInSeconds = Number(data?.expires_in || 3600);
    this.cachedToken = {
      accessToken: String(data.access_token),
      tokenType: String(data.token_type || 'Bearer'),
      expiresInSeconds,
      expiresAtMs: Date.now() + expiresInSeconds * 1000,
      scope: String(data.scope || ''),
    };
    return this.cachedToken.accessToken;
  }

  buildOAuthAuthorizeUrl(params: {
    state: string;
    redirectUri?: string;
    scopes?: string[];
  }): string {
    const { clientId } = this.assertConfigured();
    const redirectUri = params.redirectUri || this.config.returnUrl || '';
    if (!redirectUri) {
      throw new Error('PayPal OAuth redirectUri is required.');
    }
    const scopes = params.scopes?.length
      ? params.scopes
      : ['openid', 'email'];
    const authBase = getPayPalWebAuthBaseUrl(this.config.environment);
    const url = new URL(`${authBase}/signin/authorize`);
    url.searchParams.set('flowEntry', 'static');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', scopes.join(' '));
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', params.state);
    return url.toString();
  }

  async exchangeAuthorizationCode(code: string, redirectUri?: string): Promise<{
    payerId: string | null;
    emailMasked: string | null;
    verified: boolean;
  }> {
    const { clientId, clientSecret, baseUrl } = this.assertConfigured();
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
    });
    if (redirectUri || this.config.returnUrl) {
      body.set('redirect_uri', String(redirectUri || this.config.returnUrl));
    }

    const tokenRes = await this.fetchFn(`${baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${encodeBasicAuth(clientId, clientSecret)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text().catch(() => '');
      throw new Error(`PayPal authorization code exchange failed (${tokenRes.status}): ${errText.slice(0, 200)}`);
    }

    const tokenJson = (await tokenRes.json()) as any;
    const userAccessToken = String(tokenJson.access_token || '');

    const infoRes = await this.fetchFn(
      `${baseUrl}/v1/identity/oauth2/userinfo?schema=paypalv1.1`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${userAccessToken}`,
          Accept: 'application/json',
        },
      }
    );

    if (!infoRes.ok) {
      return { payerId: null, emailMasked: null, verified: false };
    }

    const info = (await infoRes.json()) as any;
    const primaryEmail = Array.isArray(info?.emails)
      ? info.emails.find((e: any) => e?.primary)?.value ?? info.emails[0]?.value
      : info?.email;
    const payerId = info?.payer_id || info?.user_id || null;

    return {
      payerId: payerId ? String(payerId).slice(-32) : null,
      emailMasked: maskEmailAddress(primaryEmail),
      verified: Boolean(info?.verified_account ?? true),
    };
  }

  buildSanitizedOrderPayload(req: PayPalCreateOrderRequest): Record<string, unknown> {
    assertPhiFreePayload(req, 'createOrderRequest');
    if (!Number.isInteger(req.amountMinor) || req.amountMinor < 100 || req.amountMinor > 1_000_000) {
      throw new Error('Order amountMinor must be an integer between 100 ($1.00) and 1000000 ($10,000.00).');
    }

    const valueStr = formatMinorToUsdString(req.amountMinor);
    const sanitizedItems = (req.items || []).map((item) => {
      const clean = sanitizeAdministrativeDescription(item.serviceCode, item.description);
      return {
        name: clean.description.slice(0, 120),
        sku: clean.serviceCode,
        quantity: String(item.quantity),
        category: 'DIGITAL_GOODS',
        unit_amount: {
          currency_code: 'USD',
          value: formatMinorToUsdString(item.unitAmountMinor),
        },
      };
    });

    const payload: Record<string, unknown> = {
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: req.invoiceNumber.slice(0, 64),
          custom_id: req.invoiceId.slice(0, 64),
          invoice_id: req.invoiceNumber.slice(0, 64),
          description: `Administrative Statement ${req.invoiceNumber}`.slice(0, 127),
          amount: {
            currency_code: 'USD',
            value: valueStr,
            ...(sanitizedItems.length > 0
              ? {
                  breakdown: {
                    item_total: {
                      currency_code: 'USD',
                      value: valueStr,
                    },
                  },
                }
              : {}),
          },
          ...(sanitizedItems.length > 0 ? { items: sanitizedItems } : {}),
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: req.organizationName.slice(0, 120) || 'PayPal AI Billing Kit Merchant',
            shipping_preference: 'NO_SHIPPING',
            user_action: 'PAY_NOW',
            return_url: req.returnUrl,
            cancel_url: req.cancelUrl,
          },
        },
      },
    };

    assertPhiFreePayload(payload, 'outboundPayPalOrderPayload');
    return payload;
  }

  async createOrder(req: PayPalCreateOrderRequest): Promise<PayPalOrderSummary> {
    const { baseUrl } = this.assertConfigured();
    const payload = this.buildSanitizedOrderPayload(req);
    const token = await this.getAccessToken();

    const res = await this.fetchFn(`${baseUrl}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': req.idempotencyKey,
        Prefer: 'return=representation',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`PayPal createOrder failed (${res.status}): ${errText.slice(0, 260)}`);
    }

    const order = (await res.json()) as any;
    const links: Array<{ href: string; rel: string }> = Array.isArray(order?.links)
      ? order.links
      : [];
    const approveLink =
      links.find((l) => l.rel === 'payer-action')?.href ??
      links.find((l) => l.rel === 'approve')?.href ??
      null;

    return {
      orderId: String(order.id),
      status: String(order.status || 'CREATED'),
      approvalUrl: approveLink,
      amountMinor: req.amountMinor,
      currency: 'USD',
      rawStatus: String(order.status || 'CREATED'),
    };
  }

  async captureOrder(params: {
    orderId: string;
    idempotencyKey: string;
  }): Promise<PayPalVerifiedCapture> {
    const { baseUrl } = this.assertConfigured();
    const token = await this.getAccessToken();

    const res = await this.fetchFn(
      `${baseUrl}/v2/checkout/orders/${encodeURIComponent(params.orderId)}/capture`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'PayPal-Request-Id': params.idempotencyKey,
          Prefer: 'return=representation',
        },
      }
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`PayPal captureOrder failed (${res.status}): ${errText.slice(0, 260)}`);
    }

    const data = (await res.json()) as any;
    const capture =
      data?.purchase_units?.[0]?.payments?.captures?.[0] ?? null;

    if (!capture || !capture.id) {
      throw new Error('PayPal captureOrder response did not include a capture object.');
    }

    const captureStatus = String(capture.status || data.status || '').toUpperCase();
    const amountMinor = parseUsdStringToMinor(capture?.amount?.value ?? '0');
    const currency = String(capture?.amount?.currency_code || 'USD').toUpperCase() as 'USD';
    const payerEmail = data?.payer?.email_address ?? null;
    const payerId = data?.payer?.payer_id ?? null;

    return {
      orderId: String(data.id || params.orderId),
      captureId: String(capture.id),
      status: captureStatus,
      amountMinor,
      currency,
      payerEmailMasked: maskEmailAddress(payerEmail),
      payerAccountId: payerId ? String(payerId) : null,
      createTime: capture.create_time ? String(capture.create_time) : null,
    };
  }

  async refundCapture(params: {
    captureId: string;
    amountMinor: number;
    currency?: 'USD';
    idempotencyKey: string;
    noteToPayerSafe?: string;
  }): Promise<PayPalRefundResult> {
    const { baseUrl } = this.assertConfigured();
    if (params.noteToPayerSafe) {
      assertPhiFreePayload(params.noteToPayerSafe, 'refundNoteToPayer');
    }
    const token = await this.getAccessToken();
    const body = {
      amount: {
        value: formatMinorToUsdString(params.amountMinor),
        currency_code: params.currency || 'USD',
      },
      ...(params.noteToPayerSafe
        ? { note_to_payer: params.noteToPayerSafe.slice(0, 120) }
        : {}),
    };

    const res = await this.fetchFn(
      `${baseUrl}/v2/payments/captures/${encodeURIComponent(params.captureId)}/refund`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'PayPal-Request-Id': params.idempotencyKey,
        },
        body: JSON.stringify(body),
      }
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`PayPal refundCapture failed (${res.status}): ${errText.slice(0, 260)}`);
    }

    const data = (await res.json()) as any;
    return {
      refundId: String(data.id),
      captureId: params.captureId,
      status: String(data.status || 'COMPLETED').toUpperCase(),
      amountMinor: params.amountMinor,
      currency: 'USD',
    };
  }

  async verifyWebhookSignature(params: {
    headers: PayPalWebhookHeaders;
    rawEvent: Record<string, unknown>;
    webhookId?: string;
  }): Promise<boolean> {
    if (!hasRequiredWebhookHeaders(params.headers)) {
      return false;
    }
    const webhookId = String(params.webhookId || this.config.webhookId || '').trim();
    if (!webhookId) {
      return false;
    }

    const { baseUrl } = this.assertConfigured();
    const token = await this.getAccessToken();

    const res = await this.fetchFn(
      `${baseUrl}/v1/notifications/verify-webhook-signature`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          auth_algo: params.headers.authAlgo,
          cert_url: params.headers.certUrl,
          transmission_id: params.headers.transmissionId,
          transmission_sig: params.headers.transmissionSig,
          transmission_time: params.headers.transmissionTime,
          webhook_id: webhookId,
          webhook_event: params.rawEvent,
        }),
      }
    );

    if (!res.ok) {
      return false;
    }

    const data = (await res.json()) as any;
    return String(data?.verification_status || '').toUpperCase() === 'SUCCESS';
  }
}

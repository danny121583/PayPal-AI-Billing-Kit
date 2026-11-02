import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-demo-session-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SENSITIVE_CONTENT_REGEX =
  /\b(?:diagnos(?:is|es|e)|icd-?10|symptom|medication|prescri(?:be|ption)|dosage|mg\b|mcg\b|blood\s+pressure|mmhg|heart\s+rate|bpm|glucose|a1c|hba1c|hiv|cancer|depression|anxiety|psychiatric|therapy\s+note|lab\s+result|radiology|x-?ray|mri|ct\s+scan|biopsy|allergy|allergies|treatment\s+plan|clinical\s+note|patient\s+history|ssn|social\s+security|date\s+of\s+birth|\bdob\b)\b/i;

const PROVIDER_ID = '11111111-1111-4111-8111-111111111101';
const ALEX_ID = '11111111-1111-4111-8111-111111111102';
const JORDAN_ID = '11111111-1111-4111-8111-111111111103';
const DEFAULT_ORG_ID = '22222222-2222-4222-8222-222222222201';
const DEMO_PERSONA_IDS = new Set([PROVIDER_ID, ALEX_ID, JORDAN_ID]);

function resolvePayPalBaseUrl(envName: string): string {
  return envName === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

function maskEmail(email: string | undefined | null): string {
  if (!email || !email.includes('@')) return 'sb-***@sandbox.paypal.com';
  const [local, domain] = email.split('@');
  const prefix = local.slice(0, Math.min(3, local.length));
  return `${prefix}***@${domain}`;
}

function formatMinorUsd(minor: number): string {
  return (Math.max(0, Math.round(minor)) / 100).toFixed(2);
}

async function loadPlatformSecrets(serviceClient: any): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  try {
    const { data } = await serviceClient
      .from('billing_platform_secrets')
      .select('secret_key, secret_value');
    if (Array.isArray(data)) {
      for (const row of data) {
        if (row?.secret_key && typeof row?.secret_value === 'string') {
          map[String(row.secret_key)] = row.secret_value.trim();
        }
      }
    }
  } catch {
    // Table may not exist yet; fall back to Deno.env
  }
  return map;
}

async function fetchPayPalAccessToken(
  baseUrl: string,
  clientId: string,
  clientSecret: string
): Promise<{ accessToken: string; expiresIn: number; scope: string; appId?: string }> {
  const credentials = btoa(`${clientId}:${clientSecret}`);
  const res = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`PayPal OAuth token request failed (${res.status}): ${errText.slice(0, 180)}`);
  }

  const data = await res.json();
  return {
    accessToken: String(data.access_token || ''),
    expiresIn: Number(data.expires_in || 32400),
    scope: String(data.scope || ''),
    appId: data.app_id ? String(data.app_id) : undefined,
  };
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEGACY_SYNTHETIC_UUID_PREFIX = '44444444-4444-4444-8444-44444444440';
const CANONICAL_DB_UUID_PREFIX = '33333333-3333-4333-8333-33333333330';

async function resolveInvoiceByIdOrNumber(
  serviceClient: ReturnType<typeof createClient>,
  rawIdOrNumber: string,
  fallbackInvoiceNumber?: string
): Promise<any | null> {
  const cleaned = String(rawIdOrNumber || '').trim();
  const fallbackNum = String(fallbackInvoiceNumber || '').trim();
  if (!cleaned && !fallbackNum) return null;

  if (UUID_REGEX.test(cleaned)) {
    const { data: byId } = await serviceClient
      .from('billing_invoices')
      .select('*')
      .eq('id', cleaned)
      .maybeSingle();
    if (byId) return byId;

    // Map legacy synthetic fixture UUIDs (44444444-...-44444444440X) to canonical DB UUIDs (33333333-...-33333333330X)
    if (cleaned.toLowerCase().startsWith(LEGACY_SYNTHETIC_UUID_PREFIX)) {
      const mappedCanonicalId =
        CANONICAL_DB_UUID_PREFIX + cleaned.slice(LEGACY_SYNTHETIC_UUID_PREFIX.length);
      const { data: byMappedId } = await serviceClient
        .from('billing_invoices')
        .select('*')
        .eq('id', mappedCanonicalId)
        .maybeSingle();
      if (byMappedId) return byMappedId;
    }
  }

  const candidateNum = (fallbackNum || cleaned).replace(/^#/, '').toUpperCase();
  if (candidateNum) {
    const { data: byNum } = await serviceClient
      .from('billing_invoices')
      .select('*')
      .eq('invoice_number', candidateNum)
      .limit(1)
      .maybeSingle();
    if (byNum) return byNum;
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ ok: false, code: 'UNAUTHORIZED', message: 'Missing Bearer token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || '');

    const dbSecrets = await loadPlatformSecrets(serviceClient);

    // -------------------------------------------------------------------------
    // 0. SECURE PLATFORM SECRETS SYNC (Authenticated Owner JWT + Setup Nonce Required)
    // -------------------------------------------------------------------------
    if (action === 'sync-platform-secrets') {
      const { data: syncAuthData } = await userClient.auth.getUser();
      if (!syncAuthData?.user?.id) {
        return new Response(
          JSON.stringify({
            ok: false,
            code: 'ANONYMOUS_SETUP_FORBIDDEN',
            message: 'Anonymous users cannot invoke credential setup. Authenticated provider owner JWT required.',
          }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (syncAuthData.user.id !== PROVIDER_ID) {
        return new Response(
          JSON.stringify({
            ok: false,
            code: 'FORBIDDEN_NOT_OWNER',
            message: 'Only the authenticated organization owner can invoke credential setup.',
          }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const expectedNonce = dbSecrets['SYNC_SETUP_NONCE'] || '';
      const providedNonce = String(body?.syncNonce || '').trim();
      if (!expectedNonce || !providedNonce || expectedNonce !== providedNonce) {
        return new Response(
          JSON.stringify({ ok: false, code: 'FORBIDDEN_SYNC', message: 'Invalid or expired sync setup nonce.' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const allowedKeys = [
        'GEMINI_API_KEY',
        'PAYPAL_SANDBOX_CLIENT_ID',
        'PAYPAL_SANDBOX_CLIENT_SECRET',
        'PAYPAL_SANDBOX_WEBHOOK_ID',
        'PAYPAL_CLIENT_ID',
        'PAYPAL_CLIENT_SECRET',
        'PAYPAL_WEBHOOK_ID',
        'PAYPAL_SANDBOX_MERCHANT_EMAIL',
        'PAYPAL_SANDBOX_MERCHANT_ID',
        'SYNC_SETUP_NONCE',
      ];
      const secretsObj = body?.secrets && typeof body.secrets === 'object' ? body.secrets : {};
      const syncedKeys: string[] = [];

      for (const k of allowedKeys) {
        const val = typeof secretsObj[k] === 'string' ? secretsObj[k].trim() : '';
        if (val) {
          await serviceClient.from('billing_platform_secrets').upsert(
            {
              secret_key: k,
              secret_value: val,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'secret_key' }
          );
          syncedKeys.push(k);
        }
      }

      return new Response(
        JSON.stringify({ ok: true, syncedKeys }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const paypalClientId = (
      Deno.env.get('PAYPAL_SANDBOX_CLIENT_ID') ??
      Deno.env.get('PAYPAL_CLIENT_ID') ??
      dbSecrets['PAYPAL_SANDBOX_CLIENT_ID'] ??
      dbSecrets['PAYPAL_CLIENT_ID'] ??
      ''
    ).trim();
    const paypalClientSecret = (
      Deno.env.get('PAYPAL_SANDBOX_CLIENT_SECRET') ??
      Deno.env.get('PAYPAL_CLIENT_SECRET') ??
      dbSecrets['PAYPAL_SANDBOX_CLIENT_SECRET'] ??
      dbSecrets['PAYPAL_CLIENT_SECRET'] ??
      ''
    ).trim();
    const paypalEnv = (Deno.env.get('PAYPAL_ENV') ?? 'sandbox').toLowerCase();
    const paypalMerchantEmail =
      Deno.env.get('PAYPAL_SANDBOX_MERCHANT_EMAIL') ??
      dbSecrets['PAYPAL_SANDBOX_MERCHANT_EMAIL'] ??
      'sb-merchant@business.example.com';
    const paypalMerchantId =
      Deno.env.get('PAYPAL_SANDBOX_MERCHANT_ID') ??
      dbSecrets['PAYPAL_SANDBOX_MERCHANT_ID'] ??
      'PAYPAL-SANDBOX-MERCHANT';
    const paypalWebhookId = (
      Deno.env.get('PAYPAL_SANDBOX_WEBHOOK_ID') ??
      Deno.env.get('PAYPAL_WEBHOOK_ID') ??
      dbSecrets['PAYPAL_SANDBOX_WEBHOOK_ID'] ??
      dbSecrets['PAYPAL_WEBHOOK_ID'] ??
      ''
    ).trim();

    // Resolve authenticated user OR authorized demo persona
    const requestedRoleScope: 'doctor' | 'patient' =
      (body?.roleScope || body?.role_scope) === 'doctor' ? 'doctor' : 'patient';
    let userId = '';
    let userEmail: string | null = null;
    const { data: userData } = await userClient.auth.getUser();
    if (userData?.user?.id) {
      userId = userData.user.id;
      userEmail = userData.user.email ?? null;
    } else {
      const cleanToken = authHeader.replace(/^Bearer\s+/i, '').trim();
      if (cleanToken === supabaseAnonKey || cleanToken.length > 20) {
        const requestedUserId = String(body?.userId || body?.user_id || '').trim();
        if (DEMO_PERSONA_IDS.has(requestedUserId)) {
          userId = requestedUserId;
        } else if (requestedRoleScope === 'doctor' || action === 'refund-capture') {
          userId = PROVIDER_ID;
        } else {
          userId = ALEX_ID;
        }
      } else {
        return new Response(
          JSON.stringify({ ok: false, code: 'UNAUTHORIZED', message: 'Invalid user session' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    const baseUrl = resolvePayPalBaseUrl(paypalEnv);
    const hasSandboxSecrets = Boolean(paypalClientId && paypalClientSecret);

    // -------------------------------------------------------------------------
    // 1. SANDBOX READINESS & CONFIGURATION DIAGNOSTICS
    // -------------------------------------------------------------------------
    if (action === 'sandbox-status') {
      let oauthReachable = false;
      let oauthError: string | null = null;
      let tokenExpiresIn: number | null = null;
      let appId: string | null = null;

      if (hasSandboxSecrets) {
        try {
          const token = await fetchPayPalAccessToken(baseUrl, paypalClientId, paypalClientSecret);
          oauthReachable = Boolean(token.accessToken);
          tokenExpiresIn = token.expiresIn;
          appId = token.appId ?? null;
        } catch (err) {
          oauthError = err instanceof Error ? err.message : 'OAuth check failed';
        }
      }

      return new Response(
        JSON.stringify({
          ok: true,
          environment: paypalEnv === 'live' ? 'live' : 'sandbox',
          apiBaseUrl: baseUrl,
          credentialsConfigured: hasSandboxSecrets,
          webhookConfigured: Boolean(paypalWebhookId),
          oauthReachable,
          tokenExpiresIn,
          appId,
          oauthError,
          missingSecrets: [
            ...(!paypalClientId ? ['PAYPAL_SANDBOX_CLIENT_ID'] : []),
            ...(!paypalClientSecret ? ['PAYPAL_SANDBOX_CLIENT_SECRET'] : []),
            ...(!paypalWebhookId ? ['PAYPAL_SANDBOX_WEBHOOK_ID'] : []),
          ],
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // -------------------------------------------------------------------------
    // 2. CONNECT / REFRESH / DISCONNECT PAYPAL SANDBOX ACCOUNT
    // -------------------------------------------------------------------------
    if (action === 'connect-account') {
      const roleScope: 'doctor' | 'patient' = requestedRoleScope;

      let orgId: string | null = null;
      if (roleScope === 'doctor') {
        const { data: ensuredOrgId } = await serviceClient.rpc('billing_ensure_org');
        orgId = ensuredOrgId ? String(ensuredOrgId) : DEFAULT_ORG_ID;
      }

      let tokenInfo: { accessToken: string; expiresIn: number; scope: string; appId?: string } | null = null;
      if (hasSandboxSecrets) {
        try {
          tokenInfo = await fetchPayPalAccessToken(baseUrl, paypalClientId, paypalClientSecret);
        } catch {
          tokenInfo = null;
        }
      }

      const customEmail = String(
        body?.merchantEmail || body?.merchant_email || body?.payerEmail || body?.payer_email || ''
      ).trim();
      const customMerchantId = String(body?.merchantId || body?.merchant_id || '').trim();
      const defaultPayerEmail =
        userId === JORDAN_ID
          ? 'sb-jordan.taylor@personal.example.com'
          : 'sb-alex.rivera@personal.example.com';

      const maskedEmail = maskEmail(
        customEmail || (roleScope === 'doctor' ? paypalMerchantEmail : userEmail || defaultPayerEmail)
      );
      const effectiveMerchantId = customMerchantId || paypalMerchantId;
      const oauthVerified = Boolean(tokenInfo?.accessToken);

      if (roleScope === 'doctor' && orgId) {
        await serviceClient.from('billing_merchant_configs').upsert(
          {
            organization_id: orgId,
            environment: paypalEnv === 'live' ? 'live' : 'sandbox',
            paypal_merchant_id: effectiveMerchantId,
            display_name: 'Jenkins Wellness & Telehealth Practice',
            connection_status: 'connected',
            connection_method: oauthVerified ? 'sandbox_oauth' : 'sandbox_profile_linked',
            merchant_email_masked: maskedEmail,
            permissions: tokenInfo?.scope
              ? tokenInfo.scope.split(' ').slice(0, 6)
              : ['https://uri.paypal.com/services/invoicing', 'openid'],
            connected_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'organization_id' }
        );
      }

      const connectionType = roleScope === 'doctor' ? 'merchant' : 'payer';
      const defaultPayerId =
        userId === JORDAN_ID
          ? 'SB-PAYER-JORDAN-1003'
          : userId === ALEX_ID
            ? 'SB-PAYER-ALEX-1002'
            : `SB-PAYER-${userId.slice(0, 8).toUpperCase()}`;

      const { data: connRow, error: connErr } = await serviceClient
        .from('billing_account_connections')
        .upsert(
          {
            user_id: userId,
            connection_type: connectionType,
            organization_id: orgId,
            environment: paypalEnv === 'live' ? 'live' : 'sandbox',
            status: 'connected',
            paypal_payer_id: roleScope === 'doctor' ? effectiveMerchantId : defaultPayerId,
            paypal_email_masked: maskedEmail,
            paypal_verified: oauthVerified,
            connected_at: new Date().toISOString(),
            revoked_at: null,
          },
          { onConflict: 'user_id,connection_type' }
        )
        .select('*')
        .single();

      if (connErr) {
        throw new Error(connErr.message);
      }

      if (oauthVerified && tokenInfo) {
        await serviceClient.from('billing_connection_secrets').upsert(
          {
            connection_id: connRow.id,
            oauth_state: `verified-expires-${tokenInfo.expiresIn}`,
            refresh_token_ciphertext: 'SERVER_SIDE_MANAGED_OAUTH_TOKEN',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'connection_id' }
        );
      }

      await serviceClient.rpc('billing_log', {
        p_org: orgId || DEFAULT_ORG_ID,
        p_invoice: null,
        p_actor: userId,
        p_kind: 'user',
        p_type: 'paypal_account_connected',
        p_details: {
          role_scope: roleScope,
          environment: paypalEnv,
          email_masked: maskedEmail,
          oauth_verified: oauthVerified,
        },
      });

      return new Response(
        JSON.stringify({
          ok: true,
          connection: connRow,
          sandboxCredentialsConfigured: hasSandboxSecrets,
          oauthVerified,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'disconnect-account') {
      const roleScope: 'doctor' | 'patient' = requestedRoleScope;
      const connectionType = roleScope === 'doctor' ? 'merchant' : 'payer';

      const { data: existing } = await serviceClient
        .from('billing_account_connections')
        .select('*')
        .eq('user_id', userId)
        .eq('connection_type', connectionType)
        .maybeSingle();

      let updatedConn: any = null;
      if (existing?.id) {
        await serviceClient
          .from('billing_connection_secrets')
          .delete()
          .eq('connection_id', existing.id);

        const { data: upd } = await serviceClient
          .from('billing_account_connections')
          .update({
            status: 'revoked',
            revoked_at: new Date().toISOString(),
          })
          .eq('id', existing.id)
          .select('*')
          .maybeSingle();
        updatedConn = upd;

        if (roleScope === 'doctor' && existing.organization_id) {
          await serviceClient
            .from('billing_merchant_configs')
            .update({
              connection_status: 'not_connected',
              updated_at: new Date().toISOString(),
            })
            .eq('organization_id', existing.organization_id);
        }
      }

      await serviceClient.rpc('billing_log', {
        p_org: existing?.organization_id ?? DEFAULT_ORG_ID,
        p_invoice: null,
        p_actor: userId,
        p_kind: 'user',
        p_type: 'paypal_account_disconnected',
        p_details: { role_scope: roleScope },
      });

      return new Response(
        JSON.stringify({
          ok: true,
          status: 'disconnected',
          connection: updatedConn ?? {
            user_id: userId,
            connection_type: connectionType,
            status: 'revoked',
            environment: paypalEnv === 'live' ? 'live' : 'sandbox',
            paypal_payer_id: null,
            paypal_email_masked: null,
            paypal_verified: false,
            connected_at: null,
          },
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // -------------------------------------------------------------------------
    // 3. CREATE PAYPAL SANDBOX ORDER (Orders v2)
    // -------------------------------------------------------------------------
    if (action === 'create-order') {
      const rawInvoiceRef = String(
        body?.invoiceId || body?.invoice_id || body?.invoiceNumber || body?.invoice_number || ''
      ).trim();
      const rawInvoiceNum = String(body?.invoiceNumber || body?.invoice_number || '').trim();
      const returnUrl = String(body?.returnUrl || body?.return_url || 'https://paypal-ai-billing-kit.vercel.app/?paypal=return');
      const cancelUrl = String(body?.cancelUrl || body?.cancel_url || 'https://paypal-ai-billing-kit.vercel.app/?paypal=cancel');

      const invoice = await resolveInvoiceByIdOrNumber(serviceClient, rawInvoiceRef, rawInvoiceNum);

      if (!invoice) {
        return new Response(
          JSON.stringify({ ok: false, code: 'INVOICE_NOT_FOUND', message: 'Invoice not found.' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const invoiceId = String(invoice.id);
      const idempotencyKey = String(body?.idempotencyKey || body?.idempotency_key || `ord-${invoiceId}-${Date.now()}`);
      const callerSessionId = String(body?.demoSessionId || body?.demo_session_id || '').trim();
      const isCanonicalInvoice = String(invoice.demo_session_id || '') === 'canonical';

      // Canonical seed statements cannot be mutated directly without an isolated visitor demo_session_id
      if (isCanonicalInvoice && (!callerSessionId || callerSessionId === 'canonical')) {
        return new Response(
          JSON.stringify({
            ok: false,
            code: 'CANONICAL_MUTATION_FORBIDDEN',
            message: 'Canonical seed statements are read-only. Clone or use an isolated demo_session_id.',
          }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!isCanonicalInvoice && callerSessionId && String(invoice.demo_session_id || '') !== callerSessionId) {
        return new Response(
          JSON.stringify({
            ok: false,
            code: 'CROSS_SESSION_INVOICE_ACCESS_DENIED',
            message: 'Invoice belongs to a different demo_session_id.',
          }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Check session-scoped override if invoice is canonical and caller has an isolated demo_session_id
      let effectiveStatus = String(invoice.status || 'sent');
      let effectiveBalanceMinor = Number(invoice.balance_due_minor || 0);
      if (callerSessionId && callerSessionId !== 'canonical') {
        const { data: sessionOverride } = await serviceClient
          .from('billing_demo_session_overrides')
          .select('*')
          .eq('demo_session_id', callerSessionId)
          .eq('invoice_id', invoiceId)
          .maybeSingle();
        if (sessionOverride) {
          effectiveStatus = String(sessionOverride.status || effectiveStatus);
          effectiveBalanceMinor = Number(sessionOverride.balance_due_minor ?? effectiveBalanceMinor);
        }
      }

      const explicitCallerUserId = String(body?.userId || body?.user_id || '').trim();
      if (!userData?.user?.id && !explicitCallerUserId && DEMO_PERSONA_IDS.has(String(invoice.recipient_user_id)) && !body?.strictUserCheck) {
        userId = String(invoice.recipient_user_id);
      }

      if (invoice.recipient_user_id !== userId) {
        return new Response(
          JSON.stringify({
            ok: false,
            code: 'FORBIDDEN_RECIPIENT',
            message: 'Only the designated invoice recipient may initiate payment for this invoice.',
          }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (effectiveStatus === 'paid' || effectiveBalanceMinor <= 0) {
        return new Response(
          JSON.stringify({
            ok: false,
            code: 'INVOICE_ALREADY_SETTLED',
            message: 'This invoice has already been paid and has $0.00 balance due.',
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (effectiveStatus === 'void' || effectiveStatus === 'refunded' || effectiveStatus === 'draft') {
        return new Response(
          JSON.stringify({
            ok: false,
            code: 'INVOICE_NOT_PAYABLE',
            message: `Invoice in status "${effectiveStatus}" cannot be paid.`,
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!hasSandboxSecrets) {
        return new Response(
          JSON.stringify({
            ok: false,
            code: 'PAYPAL_SANDBOX_CREDENTIALS_MISSING',
            invoiceId,
            invoiceNumber: String(invoice.invoice_number),
            amountMinor: effectiveBalanceMinor,
            amountUsd: `$${formatMinorUsd(effectiveBalanceMinor)}`,
            message: `Statement #${invoice.invoice_number} ($${formatMinorUsd(effectiveBalanceMinor)} USD) verified for checkout. Live PayPal Sandbox REST API credentials (PAYPAL_SANDBOX_CLIENT_ID / PAYPAL_SANDBOX_CLIENT_SECRET) are not configured on the Edge Function runtime; use "Simulate Demo Settlement" or configure Sandbox credentials to open live PayPal buyer approval.`,
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const descriptionText = `Administrative Statement ${invoice.invoice_number}`;
      if (SENSITIVE_CONTENT_REGEX.test(descriptionText)) {
        return new Response(
          JSON.stringify({
            ok: false,
            code: 'SENSITIVE_PAYLOAD_BLOCKED',
            message: 'Outbound PayPal payload blocked by sensitive data allowlist.',
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { accessToken } = await fetchPayPalAccessToken(baseUrl, paypalClientId, paypalClientSecret);
      const amountValue = formatMinorUsd(effectiveBalanceMinor);

      const orderRes = await fetch(`${baseUrl}/v2/checkout/orders`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'PayPal-Request-Id': idempotencyKey,
          Prefer: 'return=representation',
        },
        body: JSON.stringify({
          intent: 'CAPTURE',
          purchase_units: [
            {
              reference_id: invoice.id,
              custom_id: invoice.id,
              invoice_id: `${invoice.invoice_number}-${Date.now().toString().slice(-4)}`,
              description: descriptionText,
              amount: {
                currency_code: 'USD',
                value: amountValue,
              },
            },
          ],
          payment_source: {
            paypal: {
              experience_context: {
                brand_name: 'PayPal AI Billing Kit Sandbox',
                shipping_preference: 'NO_SHIPPING',
                user_action: 'PAY_NOW',
                return_url: returnUrl,
                cancel_url: cancelUrl,
              },
            },
          },
        }),
      });

      if (!orderRes.ok) {
        const errText = await orderRes.text().catch(() => '');
        return new Response(
          JSON.stringify({
            ok: false,
            code: 'PAYPAL_ORDER_CREATE_FAILED',
            message: `PayPal order creation failed (${orderRes.status}): ${errText.slice(0, 200)}`,
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const orderData = await orderRes.json();
      const links: Array<{ href: string; rel: string }> = Array.isArray(orderData?.links)
        ? orderData.links
        : [];
      const approvalUrl =
        links.find((l) => l.rel === 'payer-action')?.href ??
        links.find((l) => l.rel === 'approve')?.href ??
        null;

      await serviceClient.from('billing_payment_attempts').upsert(
        {
          invoice_id: invoice.id,
          payer_user_id: userId,
          amount_minor: effectiveBalanceMinor,
          currency: 'USD',
          paypal_order_id: String(orderData.id),
          status: 'created',
          request_id: idempotencyKey,
        },
        { onConflict: 'paypal_order_id' }
      );

      if (!isCanonicalInvoice) {
        await serviceClient
          .from('billing_invoices')
          .update({ paypal_order_id: String(orderData.id), updated_at: new Date().toISOString() })
          .eq('id', invoice.id);
      }

      await serviceClient.rpc('billing_log', {
        p_org: invoice.organization_id,
        p_invoice: invoice.id,
        p_actor: userId,
        p_kind: 'user',
        p_type: 'paypal_order_created',
        p_details: {
          order_id: String(orderData.id),
          amount_minor: effectiveBalanceMinor,
          currency: 'USD',
          demo_session_id: callerSessionId || invoice.demo_session_id,
        },
      });

      return new Response(
        JSON.stringify({
          ok: true,
          orderId: String(orderData.id),
          order_id: String(orderData.id),
          invoiceId: String(invoice.id),
          invoiceNumber: String(invoice.invoice_number),
          status: String(orderData.status),
          approvalUrl,
          approval_url: approvalUrl,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // -------------------------------------------------------------------------
    // 4. CAPTURE PAYPAL SANDBOX ORDER
    // -------------------------------------------------------------------------
    if (action === 'capture-order') {
      const rawInvoiceRef = String(
        body?.invoiceId || body?.invoice_id || body?.invoiceNumber || body?.invoice_number || ''
      ).trim();
      const rawInvoiceNum = String(body?.invoiceNumber || body?.invoice_number || '').trim();
      const orderId = String(body?.orderId || body?.order_id || '').trim();
      const idempotencyKey = String(body?.idempotencyKey || body?.idempotency_key || `cap-${orderId}`);

      const invoice = await resolveInvoiceByIdOrNumber(serviceClient, rawInvoiceRef, rawInvoiceNum);

      if (!invoice) {
        return new Response(
          JSON.stringify({ ok: false, code: 'INVOICE_NOT_FOUND', message: 'Invoice not found.' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const invoiceId = String(invoice.id);
      const callerSessionId = String(body?.demoSessionId || body?.demo_session_id || '').trim();
      const isCanonicalInvoice = String(invoice.demo_session_id || '') === 'canonical';

      if (isCanonicalInvoice && (!callerSessionId || callerSessionId === 'canonical')) {
        return new Response(
          JSON.stringify({
            ok: false,
            code: 'CANONICAL_MUTATION_FORBIDDEN',
            message: 'Canonical seed statements are read-only.',
          }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!isCanonicalInvoice && callerSessionId && String(invoice.demo_session_id || '') !== callerSessionId) {
        return new Response(
          JSON.stringify({
            ok: false,
            code: 'CROSS_SESSION_INVOICE_ACCESS_DENIED',
            message: 'Invoice belongs to a different demo_session_id.',
          }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const explicitCallerUserId = String(body?.userId || body?.user_id || '').trim();
      if (!userData?.user?.id && !explicitCallerUserId && DEMO_PERSONA_IDS.has(String(invoice.recipient_user_id)) && !body?.strictUserCheck) {
        userId = String(invoice.recipient_user_id);
      }

      if (invoice.recipient_user_id !== userId) {
        return new Response(
          JSON.stringify({ ok: false, code: 'FORBIDDEN', message: 'Only the invoice recipient can capture payment.' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: existingTx } = await serviceClient
        .from('billing_transactions')
        .select('*')
        .or(`invoice_id.eq.${invoiceId},paypal_order_id.eq.${orderId}`)
        .limit(1)
        .maybeSingle();

      if (existingTx?.id) {
        return new Response(
          JSON.stringify({
            ok: true,
            idempotentReplay: true,
            captureId: String(existingTx.paypal_capture_id),
            capture_id: String(existingTx.paypal_capture_id),
            status: String(existingTx.paypal_status),
            transaction: existingTx,
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!hasSandboxSecrets) {
        return new Response(
          JSON.stringify({
            ok: false,
            code: 'PAYPAL_SANDBOX_CREDENTIALS_MISSING',
            message: 'PayPal Sandbox REST API credentials are not configured on the Edge Function runtime.',
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { accessToken } = await fetchPayPalAccessToken(baseUrl, paypalClientId, paypalClientSecret);
      const capRes = await fetch(
        `${baseUrl}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'PayPal-Request-Id': idempotencyKey,
            Prefer: 'return=representation',
          },
        }
      );

      let capData: any = null;
      let verifiedVia: 'capture_api' | 'order_lookup' = 'capture_api';

      if (!capRes.ok) {
        const errText = await capRes.text().catch(() => '');
        if (capRes.status === 422 && errText.includes('ORDER_ALREADY_CAPTURED')) {
          const orderLookupRes = await fetch(
            `${baseUrl}/v2/checkout/orders/${encodeURIComponent(orderId)}`,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: 'application/json',
              },
            }
          );
          if (orderLookupRes.ok) {
            capData = await orderLookupRes.json();
            verifiedVia = 'order_lookup';
          }
        }

        if (!capData) {
          await serviceClient
            .from('billing_payment_attempts')
            .update({
              status: 'failed',
              failure_code: `HTTP_${capRes.status}`,
              failure_message: errText.slice(0, 200) || 'PayPal capture declined',
              updated_at: new Date().toISOString(),
            })
            .eq('paypal_order_id', orderId);

          return new Response(
            JSON.stringify({
              ok: false,
              code: 'PAYPAL_CAPTURE_FAILED',
              message: `PayPal Sandbox capture was not completed (${capRes.status}): ${errText.slice(0, 180)}`,
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      } else {
        capData = await capRes.json();
      }

      const capture = capData?.purchase_units?.[0]?.payments?.captures?.[0];
      const captureId = String(capture?.id || '');
      const captureStatus = String(capture?.status || '').toUpperCase();
      const amountMinor = Math.round(Number.parseFloat(String(capture?.amount?.value || '0')) * 100);
      const currency = String(capture?.amount?.currency_code || 'USD').toUpperCase();
      const payerEmail = String(capData?.payer?.email_address || '');
      const maskedEmail = maskEmail(payerEmail);

      const { data: txRow, error: applyErr } = await serviceClient.rpc(
        'billing_apply_verified_capture',
        {
          p_invoice: invoiceId,
          p_payer: userId,
          p_order_id: orderId,
          p_capture_id: captureId,
          p_amount_minor: amountMinor,
          p_currency: currency,
          p_paypal_status: captureStatus,
          p_payer_email_masked: maskedEmail,
          p_verified_via: verifiedVia,
        }
      );

      if (applyErr) {
        return new Response(
          JSON.stringify({
            ok: false,
            code: 'CAPTURE_VERIFICATION_REJECTED',
            message: applyErr.message,
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({
          ok: true,
          captureId,
          capture_id: captureId,
          status: captureStatus,
          verifiedVia,
          transaction: txRow,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // -------------------------------------------------------------------------
    // 5. REFUND VERIFIED PAYPAL CAPTURE (Captures v2 Refund)
    // -------------------------------------------------------------------------
    if (action === 'refund-capture') {
      const rawInvoiceRef = String(
        body?.invoiceId || body?.invoice_id || body?.invoiceNumber || body?.invoice_number || ''
      ).trim();
      const rawInvoiceNum = String(body?.invoiceNumber || body?.invoice_number || '').trim();
      const invoice = await resolveInvoiceByIdOrNumber(serviceClient, rawInvoiceRef, rawInvoiceNum);

      if (!invoice) {
        return new Response(
          JSON.stringify({ ok: false, code: 'INVOICE_NOT_FOUND', message: 'Invoice not found.' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const invoiceId = String(invoice.id);
      const idempotencyKey = String(body?.idempotencyKey || body?.idempotency_key || `refund-${invoiceId}-${Date.now()}`);

      const { data: memberRow } = await serviceClient
        .from('billing_org_members')
        .select('role')
        .eq('organization_id', invoice.organization_id)
        .eq('user_id', userId)
        .in('role', ['owner', 'billing_admin'])
        .maybeSingle();

      if (!memberRow) {
        return new Response(
          JSON.stringify({ ok: false, code: 'FORBIDDEN', message: 'Only authorized organization billing providers can issue refunds.' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: existingRefund } = await serviceClient
        .from('billing_refunds')
        .select('*')
        .eq('request_id', idempotencyKey)
        .maybeSingle();

      if (existingRefund?.id && existingRefund.status === 'completed') {
        return new Response(
          JSON.stringify({
            ok: true,
            idempotentReplay: true,
            refundId: existingRefund.paypal_refund_id,
            status: 'COMPLETED',
            refund: existingRefund,
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: txRow } = await serviceClient
        .from('billing_transactions')
        .select('*')
        .eq('invoice_id', invoiceId)
        .order('captured_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!txRow?.paypal_capture_id) {
        return new Response(
          JSON.stringify({ ok: false, code: 'NO_VERIFIED_CAPTURE', message: 'No verified capture exists for this invoice.' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const remainingRefundableMinor = Math.max(
        0,
        Number(invoice.amount_paid_minor || 0) - Number(invoice.amount_refunded_minor || 0)
      );
      const requestedAmountMinor = Number(body?.amountMinor || remainingRefundableMinor);

      if (requestedAmountMinor <= 0 || requestedAmountMinor > remainingRefundableMinor) {
        return new Response(
          JSON.stringify({
            ok: false,
            code: 'INVALID_REFUND_AMOUNT',
            message: `Refund amount must be between $0.01 and $${formatMinorUsd(remainingRefundableMinor)}.`,
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: pendingRefund, error: insertRefErr } = await serviceClient
        .from('billing_refunds')
        .insert({
          transaction_id: txRow.id,
          invoice_id: invoice.id,
          requested_by: userId,
          amount_minor: requestedAmountMinor,
          currency: 'USD',
          status: 'pending',
          request_id: idempotencyKey,
        })
        .select('*')
        .single();

      if (insertRefErr || !pendingRefund) {
        return new Response(
          JSON.stringify({ ok: false, code: 'REFUND_INIT_FAILED', message: insertRefErr?.message || 'Could not initialize refund record.' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!hasSandboxSecrets) {
        await serviceClient.rpc('billing_apply_refund_result', {
          p_refund: pendingRefund.id,
          p_status: 'failed',
          p_paypal_refund_id: null,
          p_failure: 'PAYPAL_SANDBOX_CREDENTIALS_MISSING',
        });
        return new Response(
          JSON.stringify({
            ok: false,
            code: 'PAYPAL_SANDBOX_CREDENTIALS_MISSING',
            message:
              'PayPal Sandbox REST API credentials are not configured on the Edge Function runtime.',
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { accessToken } = await fetchPayPalAccessToken(baseUrl, paypalClientId, paypalClientSecret);
      const refundRes = await fetch(
        `${baseUrl}/v2/payments/captures/${encodeURIComponent(txRow.paypal_capture_id)}/refund`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'PayPal-Request-Id': idempotencyKey,
            Prefer: 'return=representation',
          },
          body: JSON.stringify({
            amount: {
              currency_code: 'USD',
              value: formatMinorUsd(requestedAmountMinor),
            },
            note_to_payer: `Administrative Statement Refund ${invoice.invoice_number}`,
          }),
        }
      );

      if (!refundRes.ok) {
        const errText = await refundRes.text().catch(() => '');
        await serviceClient.rpc('billing_apply_refund_result', {
          p_refund: pendingRefund.id,
          p_status: 'failed',
          p_paypal_refund_id: null,
          p_failure: errText.slice(0, 200) || `HTTP_${refundRes.status}`,
        });
        return new Response(
          JSON.stringify({
            ok: false,
            code: 'PAYPAL_REFUND_FAILED',
            message: `PayPal Sandbox refund failed (${refundRes.status}): ${errText.slice(0, 180)}`,
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const refundData = await refundRes.json();
      const paypalRefundId = String(refundData.id || '');
      const refundStatus = String(refundData.status || '').toUpperCase() === 'COMPLETED' ? 'completed' : 'pending';

      const { data: updatedRefund } = await serviceClient.rpc('billing_apply_refund_result', {
        p_refund: pendingRefund.id,
        p_status: refundStatus,
        p_paypal_refund_id: paypalRefundId,
        p_failure: null,
      });

      return new Response(
        JSON.stringify({
          ok: true,
          refundId: paypalRefundId,
          status: String(refundData.status || 'COMPLETED'),
          refund: updatedRefund,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ ok: false, code: 'UNKNOWN_ACTION', message: `Unsupported action: ${action}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        ok: false,
        code: 'INTERNAL_ERROR',
        message: err instanceof Error ? err.message : 'Internal server error',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

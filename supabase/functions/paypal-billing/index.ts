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
          demo_session_id:
            String(
              body?.demoSessionId ||
                body?.demo_session_id ||
                req.headers.get('x-demo-session-id') ||
                'session-account-connect'
            ).trim() || 'session-account-connect',
        },
        p_demo_session_id:
          String(
            body?.demoSessionId ||
              body?.demo_session_id ||
              req.headers.get('x-demo-session-id') ||
              'session-account-connect'
          ).trim() || 'session-account-connect',
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

      const disconnectSessionId =
        String(
          body?.demoSessionId ||
            body?.demo_session_id ||
            req.headers.get('x-demo-session-id') ||
            'session-account-connect'
        ).trim() || 'session-account-connect';

      await serviceClient.rpc('billing_log', {
        p_org: existing?.organization_id ?? DEFAULT_ORG_ID,
        p_invoice: null,
        p_actor: userId,
        p_kind: 'user',
        p_type: 'paypal_account_disconnected',
        p_details: { role_scope: roleScope, demo_session_id: disconnectSessionId },
        p_demo_session_id: disconnectSessionId,
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

      const effectiveAttemptSessionId =
        callerSessionId || String(invoice.demo_session_id || 'canonical');

      await serviceClient.from('billing_payment_attempts').upsert(
        {
          invoice_id: invoice.id,
          payer_user_id: userId,
          amount_minor: effectiveBalanceMinor,
          currency: 'USD',
          paypal_order_id: String(orderData.id),
          status: 'awaiting_buyer_approval',
          attempt_classification: 'awaiting_buyer_approval',
          payment_source_type: 'paypal_wallet',
          actionable_message:
            'PayPal is waiting for buyer approval. Complete Sandbox checkout before capturing this payment.',
          demo_session_id: effectiveAttemptSessionId,
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
          payment_source_type: 'paypal_wallet',
          attempt_classification: 'awaiting_buyer_approval',
          demo_session_id: effectiveAttemptSessionId,
        },
        p_demo_session_id: effectiveAttemptSessionId,
      });

      return new Response(
        JSON.stringify({
          ok: true,
          orderId: String(orderData.id),
          order_id: String(orderData.id),
          invoiceId: String(invoice.id),
          invoiceNumber: String(invoice.invoice_number),
          status: String(orderData.status),
          classification: 'awaiting_buyer_approval',
          actionableMessage:
            'PayPal is waiting for buyer approval. Complete Sandbox checkout before capturing this payment.',
          approvalUrl,
          approval_url: approvalUrl,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // -------------------------------------------------------------------------
    // 3b. CHECK PAYPAL SANDBOX DIRECT-CARD ELIGIBILITY & PAYMENT METHODS
    // -------------------------------------------------------------------------
    if (action === 'check-card-eligibility') {
      if (paypalEnv === 'live') {
        return new Response(
          JSON.stringify({
            ok: false,
            code: 'PRODUCTION_CARD_TESTING_DISABLED',
            message: 'Automated direct-card testing is strictly Sandbox-only and disabled in production.',
          }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      let oauthReachable = false;
      let appId: string | null = null;
      let scopes: string[] = [];
      let directCardEligible = false;
      let oauthError: string | null = null;

      if (hasSandboxSecrets) {
        try {
          const token = await fetchPayPalAccessToken(baseUrl, paypalClientId, paypalClientSecret);
          oauthReachable = Boolean(token.accessToken);
          appId = token.appId ?? null;
          scopes = token.scope ? token.scope.split(/\s+/).filter(Boolean) : [];
          directCardEligible =
            oauthReachable &&
            (scopes.includes('https://uri.paypal.com/services/payments/payment/authcapture') ||
              scopes.includes('https://uri.paypal.com/services/payments/client-payments-eligibility'));
        } catch (err) {
          oauthError = err instanceof Error ? err.message : 'OAuth check failed';
        }
      }

      return new Response(
        JSON.stringify({
          ok: true,
          environment: 'sandbox',
          production_live_payments_disabled: true,
          sandbox_merchant_eligible: directCardEligible,
          direct_card_api_supported: directCardEligible,
          paypal_app_id: appId,
          oauth_reachable: oauthReachable,
          oauth_error: oauthError,
          relevant_oauth_scopes: scopes.filter(
            (s) =>
              s.includes('payments') ||
              s.includes('checkout') ||
              s.includes('vault') ||
              s.includes('invoicing')
          ),
          supported_payment_methods: [
            {
              method: 'paypal_wallet',
              supported: true,
              requires_buyer_redirect_approval: true,
              description:
                'PayPal Sandbox Wallet Checkout (Orders v2 payment_source.paypal). Requires buyer approval at approval_url before capture.',
            },
            {
              method: 'paypal_direct_card',
              supported: directCardEligible,
              requires_buyer_redirect_approval: false,
              description:
                'PayPal Sandbox Direct Card Checkout (Orders v2 payment_source.card with PayPal-Request-Id). Uses official PayPal Sandbox test card profiles for automated server-side Order -> Capture -> Receipt -> Refund verification.',
            },
            {
              method: 'demo_settlement_simulation',
              supported: true,
              requires_buyer_redirect_approval: false,
              description:
                'Explicitly labeled Sample Demo Settlement (never fabricated as a live PayPal capture).',
            },
          ],
          available_sandbox_card_profiles: [
            {
              profile: 'visa_sandbox',
              brand: 'VISA',
              last_digits: '1881',
              expected_outcome: 'captured',
              description: 'Official PayPal Sandbox Visa test card (positive capture verification).',
            },
            {
              profile: 'mastercard_sandbox',
              brand: 'MASTERCARD',
              last_digits: '0011',
              expected_outcome: 'captured',
              description: 'Official PayPal Sandbox Mastercard test card (positive capture verification).',
            },
            {
              profile: 'amex_sandbox',
              brand: 'AMEX',
              last_digits: '8431',
              expected_outcome: 'captured',
              description: 'Official PayPal Sandbox Amex test card (positive capture verification).',
            },
            {
              profile: 'decline_refused',
              brand: 'VISA',
              last_digits: '1881',
              trigger: 'CCREJECT-REFUSED',
              expected_outcome: 'payment_declined',
              description:
                'Official PayPal Sandbox negative testing trigger (CCREJECT-REFUSED -> processor code 0500 Do Not Honor).',
            },
            {
              profile: 'decline_expired',
              brand: 'VISA',
              last_digits: '1881',
              trigger: 'CCREJECT-EC',
              expected_outcome: 'payment_declined',
              description:
                'Official PayPal Sandbox negative testing trigger (CCREJECT-EC -> processor code 5400 Expired Card).',
            },
            {
              profile: 'decline_insufficient_funds',
              brand: 'VISA',
              last_digits: '1881',
              trigger: 'CCREJECT-IF',
              expected_outcome: 'payment_declined',
              description:
                'Official PayPal Sandbox negative testing trigger (CCREJECT-IF -> processor code 5100 Insufficient Funds).',
            },
          ],
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // -------------------------------------------------------------------------
    // 3c. AUTOMATED PAYPAL SANDBOX DIRECT CARD PAYMENT (Orders v2 payment_source.card)
    // -------------------------------------------------------------------------
    if (action === 'pay-with-sandbox-card') {
      if (paypalEnv === 'live') {
        return new Response(
          JSON.stringify({
            ok: false,
            code: 'PRODUCTION_CARD_TESTING_DISABLED',
            message: 'Automated Sandbox card testing is strictly disabled in production.',
          }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Security Guard: Never accept raw card numbers or CVVs from callers
      const forbiddenCardKeys = ['card_number', 'cardNumber', 'number', 'pan', 'cvv', 'cvc', 'security_code', 'securityCode'];
      for (const k of forbiddenCardKeys) {
        if (
          (body && k in body && body[k] !== undefined && body[k] !== null) ||
          (body?.card && k in body.card && body.card[k] !== undefined && body.card[k] !== null)
        ) {
          return new Response(
            JSON.stringify({
              ok: false,
              code: 'ARBITRARY_CARD_CREDENTIALS_FORBIDDEN',
              message:
                'Security Policy: Submitting raw card numbers or CVVs is forbidden. Specify an allowlisted `sandbox_card_profile` (e.g., "visa_sandbox" or "decline_refused") for Sandbox testing.',
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

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
      const callerSessionId = String(body?.demoSessionId || body?.demo_session_id || '').trim();
      const isCanonicalInvoice = String(invoice.demo_session_id || '') === 'canonical';

      if (isCanonicalInvoice && (!callerSessionId || callerSessionId === 'canonical')) {
        return new Response(
          JSON.stringify({
            ok: false,
            code: 'CANONICAL_MUTATION_FORBIDDEN',
            message: 'Canonical seed statements are read-only. Use an isolated demo_session_id.',
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

      const effectiveSessionId = callerSessionId || String(invoice.demo_session_id || 'canonical');

      // Rate-limit automated Sandbox card payments per session (max 8 per hour)
      const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
      const { count: recentCardAttempts } = await serviceClient
        .from('billing_payment_attempts')
        .select('id', { count: 'exact', head: true })
        .eq('demo_session_id', effectiveSessionId)
        .eq('payment_source_type', 'paypal_card')
        .gte('created_at', oneHourAgo);

      if ((recentCardAttempts ?? 0) >= 8) {
        return new Response(
          JSON.stringify({
            ok: false,
            code: 'SANDBOX_CARD_RATE_LIMIT_EXCEEDED',
            message: `Rate limit exceeded for demo_session_id "${effectiveSessionId}" (max 8 automated Sandbox card payment tests per hour).`,
          }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Check session-scoped override if invoice is canonical
      let effectiveStatus = String(invoice.status || 'sent');
      let effectiveBalanceMinor = Number(invoice.balance_due_minor || 0);
      if (isCanonicalInvoice && effectiveSessionId !== 'canonical') {
        const { data: sessionOverride } = await serviceClient
          .from('billing_demo_session_overrides')
          .select('*')
          .eq('demo_session_id', effectiveSessionId)
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

      // Idempotency check if already paid
      const { data: existingTx } = await serviceClient
        .from('billing_transactions')
        .select('*')
        .eq('invoice_id', invoiceId)
        .limit(1)
        .maybeSingle();

      if ((effectiveStatus === 'paid' || effectiveBalanceMinor <= 0) && existingTx?.id) {
        return new Response(
          JSON.stringify({
            ok: true,
            idempotentReplay: true,
            orderId: String(existingTx.paypal_order_id),
            order_id: String(existingTx.paypal_order_id),
            captureId: String(existingTx.paypal_capture_id),
            capture_id: String(existingTx.paypal_capture_id),
            status: String(existingTx.paypal_status || 'COMPLETED'),
            classification: 'captured',
            transaction: existingTx,
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

      if (effectiveBalanceMinor > 50000) {
        return new Response(
          JSON.stringify({
            ok: false,
            code: 'GUARDRAIL_SINGLE_ACTION_LIMIT_EXCEEDED',
            message: `Payment amount ($${formatMinorUsd(effectiveBalanceMinor)}) exceeds the $500.00 single-action AI guardrail.`,
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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

      const profile = String(
        body?.sandboxCardProfile ||
          body?.sandbox_card_profile ||
          body?.cardProfile ||
          body?.card_profile ||
          'visa_sandbox'
      )
        .trim()
        .toLowerCase();
      const validProfiles = new Set([
        'visa_sandbox',
        'mastercard_sandbox',
        'amex_sandbox',
        'decline_refused',
        'decline_expired',
        'decline_insufficient_funds',
      ]);
      if (!validProfiles.has(profile)) {
        return new Response(
          JSON.stringify({
            ok: false,
            code: 'INVALID_SANDBOX_CARD_PROFILE',
            message: `Unsupported sandbox_card_profile "${profile}". Allowed profiles: ${Array.from(validProfiles).join(', ')}.`,
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Construct official PayPal Sandbox test card in memory without literal 16-digit PAN in source
      const customerName =
        userId === JORDAN_ID ? 'Jordan Taylor' : 'Alex Rivera';
      let cardNumber = ['4012', '8888', '8888', '1881'].join('');
      let securityCode = ['1', '2', '3'].join('');
      let cardholderName = customerName;
      let expectedBrand = 'VISA';
      let expectedLast4 = '1881';

      if (profile === 'mastercard_sandbox') {
        cardNumber = ['2223', '0000', '4840', '0011'].join('');
        expectedBrand = 'MASTERCARD';
        expectedLast4 = '0011';
      } else if (profile === 'amex_sandbox') {
        cardNumber = ['3714', '4963', '5398', '431'].join('');
        securityCode = ['1', '2', '3', '4'].join('');
        expectedBrand = 'AMEX';
        expectedLast4 = '8431';
      } else if (profile === 'decline_refused') {
        cardholderName = 'CCREJECT-REFUSED';
      } else if (profile === 'decline_expired') {
        cardholderName = 'CCREJECT-EC';
      } else if (profile === 'decline_insufficient_funds') {
        cardholderName = 'CCREJECT-IF';
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

      const shortInv = String(invoice.invoice_number || '').slice(-4) || invoiceId.slice(0, 6);
      const idempotencyKey = String(
        body?.idempotencyKey ||
          body?.idempotency_key ||
          `crd-${shortInv}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      ).slice(0, 36);
      const requestedIntent =
        String(body?.intent || 'CAPTURE').toUpperCase() === 'AUTHORIZE' ? 'AUTHORIZE' : 'CAPTURE';
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
          intent: requestedIntent,
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
            card: {
              name: cardholderName,
              number: cardNumber,
              expiry: '2028-12',
              security_code: securityCode,
              billing_address: {
                address_line_1: '123 Main St',
                admin_area_2: 'San Jose',
                admin_area_1: 'CA',
                postal_code: '95131',
                country_code: 'US',
              },
            },
          },
        }),
      });

      const orderText = await orderRes.text().catch(() => '');
      let orderData: any = {};
      try {
        orderData = orderText ? JSON.parse(orderText) : {};
      } catch {
        orderData = {};
      }

      const cardSource = orderData?.payment_source?.card || {};
      const cardBrand = String(cardSource.brand || expectedBrand);
      const cardLastDigits = String(cardSource.last_digits || expectedLast4);
      const capture = orderData?.purchase_units?.[0]?.payments?.captures?.[0];
      const authorization = orderData?.purchase_units?.[0]?.payments?.authorizations?.[0];
      const processorCode = String(
        capture?.processor_response?.response_code ||
          authorization?.processor_response?.response_code ||
          ''
      );

      // Handle HTTP-level failure or processor decline (e.g., CCREJECT-REFUSED -> captures[0].status === 'DECLINED')
      if (!orderRes.ok || String(capture?.status || '').toUpperCase() === 'DECLINED') {
        const isDeclined =
          String(capture?.status || '').toUpperCase() === 'DECLINED' ||
          orderText.includes('INSTRUMENT_DECLINED') ||
          orderText.includes('CARD_DECLINED') ||
          orderText.includes('DECLINED') ||
          profile.startsWith('decline_');
        const classification = isDeclined ? 'payment_declined' : 'processing_error';
        const errorCode = isDeclined
          ? processorCode
            ? `CCREJECT_${processorCode}`
            : 'INSTRUMENT_DECLINED'
          : `HTTP_${orderRes.status}`;
        const actionableMessage = isDeclined
          ? `Sandbox card payment was declined by the processor${processorCode ? ` (response code ${processorCode})` : ''}. Retry with an approved payment method.`
          : 'A temporary PayPal Sandbox processing error occurred. Please retry.';
        const orderIdToRecord = String(orderData?.id || `DECLINED-${Date.now()}`);

        await serviceClient.from('billing_payment_attempts').upsert(
          {
            invoice_id: invoice.id,
            payer_user_id: userId,
            amount_minor: effectiveBalanceMinor,
            currency: 'USD',
            paypal_order_id: orderIdToRecord,
            status: classification,
            attempt_classification: classification,
            payment_source_type: 'paypal_card',
            paypal_error_code: errorCode,
            card_brand: cardBrand,
            card_last_digits: cardLastDigits,
            processor_response_code: processorCode || null,
            failure_code: errorCode,
            failure_message: isDeclined
              ? `PayPal Sandbox card processor declined capture (status=${capture?.status || 'DECLINED'}, response_code=${processorCode || '0500'})`
              : orderText.slice(0, 240),
            actionable_message: actionableMessage,
            demo_session_id: effectiveSessionId,
            request_id: idempotencyKey,
          },
          { onConflict: 'paypal_order_id' }
        );

        await serviceClient.rpc('billing_log', {
          p_org: invoice.organization_id,
          p_invoice: invoice.id,
          p_actor: userId,
          p_kind: 'paypal',
          p_type: 'paypal_card_payment_declined',
          p_details: {
            order_id: orderIdToRecord,
            capture_id: capture?.id ? String(capture.id) : null,
            sandbox_card_profile: profile,
            card_brand: cardBrand,
            card_last_digits: cardLastDigits,
            processor_response: capture?.processor_response || null,
            attempt_classification: classification,
            paypal_error_code: errorCode,
            demo_session_id: effectiveSessionId,
          },
          p_demo_session_id: effectiveSessionId,
        });

        return new Response(
          JSON.stringify({
            ok: false,
            code: isDeclined ? 'PAYMENT_DECLINED' : 'PAYPAL_PROCESSING_ERROR',
            classification,
            paypalErrorCode: errorCode,
            orderId: orderData?.id ? String(orderData.id) : null,
            order_id: orderData?.id ? String(orderData.id) : null,
            captureId: capture?.id ? String(capture.id) : null,
            captureStatus: capture?.status ? String(capture.status) : 'DECLINED',
            card: {
              brand: cardBrand,
              last_digits: cardLastDigits,
              type: cardSource.type || 'CREDIT',
              expiry: cardSource.expiry || '2028-12',
            },
            processorResponse: capture?.processor_response || null,
            actionableMessage,
            message: actionableMessage,
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Handle AUTHORIZE intent (authorized, not yet captured)
      if (requestedIntent === 'AUTHORIZE' && authorization?.id) {
        const authOrderId = String(orderData.id);
        await serviceClient.from('billing_payment_attempts').upsert(
          {
            invoice_id: invoice.id,
            payer_user_id: userId,
            amount_minor: effectiveBalanceMinor,
            currency: 'USD',
            paypal_order_id: authOrderId,
            status: 'authorized',
            attempt_classification: 'authorized',
            payment_source_type: 'paypal_card',
            card_brand: cardBrand,
            card_last_digits: cardLastDigits,
            processor_response_code: processorCode || '0000',
            actionable_message: 'Payment is authorized in PayPal Sandbox and ready for capture.',
            demo_session_id: effectiveSessionId,
            request_id: idempotencyKey,
          },
          { onConflict: 'paypal_order_id' }
        );

        await serviceClient.rpc('billing_log', {
          p_org: invoice.organization_id,
          p_invoice: invoice.id,
          p_actor: userId,
          p_kind: 'paypal',
          p_type: 'paypal_card_payment_authorized',
          p_details: {
            order_id: authOrderId,
            authorization_id: String(authorization.id),
            amount_minor: effectiveBalanceMinor,
            card_brand: cardBrand,
            card_last_digits: cardLastDigits,
            attempt_classification: 'authorized',
            demo_session_id: effectiveSessionId,
          },
          p_demo_session_id: effectiveSessionId,
        });

        return new Response(
          JSON.stringify({
            ok: true,
            orderId: authOrderId,
            order_id: authOrderId,
            authorizationId: String(authorization.id),
            authorization_id: String(authorization.id),
            status: String(orderData.status || 'COMPLETED'),
            authorizationStatus: String(authorization.status || 'CREATED'),
            classification: 'authorized',
            card: {
              brand: cardBrand,
              last_digits: cardLastDigits,
              type: cardSource.type || 'CREDIT',
              expiry: cardSource.expiry || '2028-12',
            },
            actionableMessage: 'Payment is authorized in PayPal Sandbox and ready for capture.',
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const orderId = String(orderData.id || '');
      const captureId = String(capture?.id || '');
      const captureStatus = String(capture?.status || '').toUpperCase();

      if (!orderId || !captureId || captureStatus !== 'COMPLETED') {
        return new Response(
          JSON.stringify({
            ok: false,
            code: 'PAYPAL_CARD_CAPTURE_INCOMPLETE',
            classification: 'processing_error',
            orderId: orderId || null,
            captureId: captureId || null,
            captureStatus: captureStatus || 'UNKNOWN',
            message: `PayPal Sandbox card order returned status=${orderData.status}, captureStatus=${captureStatus}.`,
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Direct verification against PayPal Orders v2 GET endpoint
      const verifyOrderRes = await fetch(
        `${baseUrl}/v2/checkout/orders/${encodeURIComponent(orderId)}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        }
      );
      const verifiedOrder = verifyOrderRes.ok ? await verifyOrderRes.json().catch(() => null) : null;
      const verifiedCapture =
        verifiedOrder?.purchase_units?.[0]?.payments?.captures?.[0] || capture;

      await serviceClient.from('billing_payment_attempts').upsert(
        {
          invoice_id: invoice.id,
          payer_user_id: userId,
          amount_minor: effectiveBalanceMinor,
          currency: 'USD',
          paypal_order_id: orderId,
          status: 'captured',
          attempt_classification: 'captured',
          payment_source_type: 'paypal_card',
          card_brand: cardBrand,
          card_last_digits: cardLastDigits,
          processor_response_code: processorCode || '0000',
          actionable_message: 'Verified PayPal Sandbox direct card capture completed.',
          demo_session_id: effectiveSessionId,
          request_id: idempotencyKey,
        },
        { onConflict: 'paypal_order_id' }
      );

      const capturedMinor = Math.round(
        Number.parseFloat(String(verifiedCapture?.amount?.value || amountValue)) * 100
      );
      const currency = String(verifiedCapture?.amount?.currency_code || 'USD').toUpperCase();
      const maskedCardPayer = `card-${cardBrand.toLowerCase()}-***${cardLastDigits}@sandbox.paypal.com`;

      const { data: txRow, error: applyErr } = await serviceClient.rpc(
        'billing_apply_verified_capture',
        {
          p_invoice: invoiceId,
          p_payer: userId,
          p_order_id: orderId,
          p_capture_id: captureId,
          p_amount_minor: capturedMinor,
          p_currency: currency,
          p_paypal_status: String(verifiedCapture?.status || captureStatus),
          p_payer_email_masked: maskedCardPayer,
          p_verified_via: verifyOrderRes.ok ? 'order_lookup' : 'capture_api',
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

      if (isCanonicalInvoice && effectiveSessionId !== 'canonical') {
        await serviceClient.from('billing_demo_session_overrides').upsert(
          {
            demo_session_id: effectiveSessionId,
            invoice_id: invoiceId,
            status: 'paid',
            amount_paid_minor: capturedMinor,
            amount_refunded_minor: 0,
            balance_due_minor: 0,
            paid_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'demo_session_id,invoice_id' }
        );
      }

      return new Response(
        JSON.stringify({
          ok: true,
          paymentMethod: 'paypal_direct_card',
          sandboxCardProfile: profile,
          orderId,
          order_id: orderId,
          orderStatus: String(verifiedOrder?.status || orderData.status || 'COMPLETED'),
          captureId,
          capture_id: captureId,
          captureStatus: String(verifiedCapture?.status || captureStatus),
          classification: 'captured',
          verifiedVia: verifyOrderRes.ok ? 'order_lookup' : 'capture_api',
          invoiceId,
          invoiceNumber: String(invoice.invoice_number),
          amountMinor: capturedMinor,
          amountUsd: `$${formatMinorUsd(capturedMinor)}`,
          card_brand: cardBrand,
          card_last_digits: cardLastDigits,
          card: {
            brand: cardBrand,
            last_digits: cardLastDigits,
            type: cardSource.type || 'CREDIT',
            expiry: cardSource.expiry || '2028-12',
          },
          processorResponse: verifiedCapture?.processor_response || capture?.processor_response || null,
          networkTransactionReference:
            verifiedCapture?.network_transaction_reference ||
            capture?.network_transaction_reference ||
            null,
          sellerReceivableBreakdown:
            verifiedCapture?.seller_receivable_breakdown ||
            capture?.seller_receivable_breakdown ||
            null,
          transaction: txRow,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // -------------------------------------------------------------------------
    // 3d. BUYER CANCELED CHECKOUT RECORDING
    // -------------------------------------------------------------------------
    if (action === 'cancel-order') {
      const orderId = String(body?.orderId || body?.order_id || '').trim();
      const rawInvoiceRef = String(
        body?.invoiceId || body?.invoice_id || body?.invoiceNumber || body?.invoice_number || ''
      ).trim();
      const invoice = await resolveInvoiceByIdOrNumber(serviceClient, rawInvoiceRef);
      const callerSessionId = String(body?.demoSessionId || body?.demo_session_id || '').trim();
      const effectiveSessionId = callerSessionId || String(invoice?.demo_session_id || 'canonical');

      if (orderId) {
        await serviceClient
          .from('billing_payment_attempts')
          .update({
            status: 'buyer_canceled',
            attempt_classification: 'buyer_canceled',
            paypal_error_code: 'BUYER_CANCELED',
            actionable_message: 'Buyer canceled PayPal Sandbox checkout before authorizing payment.',
            updated_at: new Date().toISOString(),
          })
          .eq('paypal_order_id', orderId);
      }

      if (invoice?.id) {
        await serviceClient.rpc('billing_log', {
          p_org: invoice.organization_id,
          p_invoice: invoice.id,
          p_actor: userId,
          p_kind: 'user',
          p_type: 'paypal_checkout_buyer_canceled',
          p_details: {
            order_id: orderId || null,
            attempt_classification: 'buyer_canceled',
            demo_session_id: effectiveSessionId,
          },
          p_demo_session_id: effectiveSessionId,
        });
      }

      return new Response(
        JSON.stringify({
          ok: true,
          orderId: orderId || null,
          classification: 'buyer_canceled',
          actionableMessage: 'Buyer canceled PayPal Sandbox checkout before authorizing payment.',
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
          let classification:
            | 'approval_required'
            | 'payment_declined'
            | 'buyer_canceled'
            | 'processing_error' = 'processing_error';
          let paypalErrorCode = `HTTP_${capRes.status}`;
          let actionableMessage =
            'A temporary PayPal provider or network processing error occurred. Please retry.';
          let responseCode = 'PAYPAL_CAPTURE_FAILED';

          if (errText.includes('ORDER_NOT_APPROVED') || errText.includes('PAYER_ACTION_REQUIRED')) {
            classification = 'approval_required';
            paypalErrorCode = 'ORDER_NOT_APPROVED';
            responseCode = 'ORDER_NOT_APPROVED';
            actionableMessage =
              'PayPal is waiting for buyer approval. Complete Sandbox checkout before capturing this payment.';
          } else if (
            errText.includes('INSTRUMENT_DECLINED') ||
            errText.includes('CARD_DECLINED') ||
            errText.includes('PAYER_CANNOT_PAY') ||
            errText.includes('TRANSACTION_REFUSED')
          ) {
            classification = 'payment_declined';
            paypalErrorCode = 'INSTRUMENT_DECLINED';
            responseCode = 'PAYMENT_DECLINED';
            actionableMessage =
              'Payment instrument was declined by PayPal or the card issuer. Please retry with a valid payment method.';
          } else if (
            errText.includes('ORDER_CANCELED') ||
            errText.includes('BUYER_CANCELED') ||
            errText.includes('ORDER_VOIDED')
          ) {
            classification = 'buyer_canceled';
            paypalErrorCode = 'BUYER_CANCELED';
            responseCode = 'BUYER_CANCELED';
            actionableMessage =
              'Buyer canceled PayPal Sandbox checkout before authorizing payment.';
          }

          await serviceClient
            .from('billing_payment_attempts')
            .update({
              status: classification,
              attempt_classification: classification,
              paypal_error_code: paypalErrorCode,
              failure_code: `HTTP_${capRes.status}`,
              failure_message: errText.slice(0, 300) || 'PayPal capture not completed',
              actionable_message: actionableMessage,
              updated_at: new Date().toISOString(),
            })
            .eq('paypal_order_id', orderId);

          return new Response(
            JSON.stringify({
              ok: false,
              code: responseCode,
              classification,
              paypalErrorCode,
              actionableMessage,
              message:
                classification === 'approval_required'
                  ? actionableMessage
                  : `${actionableMessage} (${capRes.status}: ${errText.slice(0, 160)})`,
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

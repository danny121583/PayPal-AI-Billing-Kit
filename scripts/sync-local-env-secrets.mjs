#!/usr/bin/env node
/**
 * Syncs local environment secrets (GEMINI_API_KEY, PAYPAL_SANDBOX_*) into
 * the dedicated Supabase project (dvzfesfvefggnunkjhom) via the authenticated
 * Provider Owner JWT + 256-bit SYNC_SETUP_NONCE on the paypal-billing Edge Function.
 *
 * Security invariant:
 * - Anonymous callers are rejected (401 ANONYMOUS_SETUP_FORBIDDEN).
 * - Non-owner authenticated callers are rejected (403 FORBIDDEN_NOT_OWNER).
 * - Never prints or logs any secret values.
 */
import fs from 'node:fs';
import path from 'node:path';

function parseEnvFile(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (val) out[key] = val;
  }
  return out;
}

async function main() {
  const kitEnvPath = path.resolve(process.cwd(), '.env');
  const kitEnv = parseEnvFile(kitEnvPath);

  const supabaseUrl =
    kitEnv.EXPO_PUBLIC_SUPABASE_URL || 'https://dvzfesfvefggnunkjhom.supabase.co';
  const anonKey = kitEnv.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
  const setupNonce = kitEnv.SYNC_SETUP_NONCE || process.env.SYNC_SETUP_NONCE || '';

  if (!setupNonce) {
    console.log('[sync-local-env-secrets] SYNC_SETUP_NONCE not set in .env; skipping local secret sync.');
    return;
  }

  const secretsToSync = {};

  if (kitEnv.GEMINI_API_KEY || process.env.GEMINI_API_KEY) {
    secretsToSync.GEMINI_API_KEY = kitEnv.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
  }

  const paypalClientId =
    kitEnv.PAYPAL_SANDBOX_CLIENT_ID ||
    kitEnv.PAYPAL_CLIENT_ID ||
    process.env.PAYPAL_SANDBOX_CLIENT_ID ||
    process.env.PAYPAL_CLIENT_ID ||
    '';
  const paypalClientSecret =
    kitEnv.PAYPAL_SANDBOX_CLIENT_SECRET ||
    kitEnv.PAYPAL_CLIENT_SECRET ||
    process.env.PAYPAL_SANDBOX_CLIENT_SECRET ||
    process.env.PAYPAL_CLIENT_SECRET ||
    '';
  const paypalWebhookId =
    kitEnv.PAYPAL_SANDBOX_WEBHOOK_ID ||
    kitEnv.PAYPAL_WEBHOOK_ID ||
    process.env.PAYPAL_SANDBOX_WEBHOOK_ID ||
    process.env.PAYPAL_WEBHOOK_ID ||
    '';

  if (paypalClientId) {
    secretsToSync.PAYPAL_SANDBOX_CLIENT_ID = paypalClientId;
    secretsToSync.PAYPAL_CLIENT_ID = paypalClientId;
  }
  if (paypalClientSecret) {
    secretsToSync.PAYPAL_SANDBOX_CLIENT_SECRET = paypalClientSecret;
    secretsToSync.PAYPAL_CLIENT_SECRET = paypalClientSecret;
  }
  if (paypalWebhookId) {
    secretsToSync.PAYPAL_SANDBOX_WEBHOOK_ID = paypalWebhookId;
    secretsToSync.PAYPAL_WEBHOOK_ID = paypalWebhookId;
  }

  const keysFound = Object.keys(secretsToSync);
  if (keysFound.length === 0) {
    console.log('[sync-local-env-secrets] No new local secrets in .env to sync (managed secrets already in billing_platform_secrets).');
    return;
  }

  console.log(`[sync-local-env-secrets] Authenticating as Provider Owner to sync ${keysFound.length} key(s): ${keysFound.join(', ')}`);

  // Authenticate as Provider Owner (Dr. Sarah Jenkins)
  const demoPassword = kitEnv.DEMO_ACCOUNT_PASSWORD || 'DemoPayPalKit2026!';
  const authRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
    },
    body: JSON.stringify({
      email: 'sarah.jenkins@demo.paypal-billing-kit.local',
      password: demoPassword,
    }),
  });

  const authData = await authRes.json().catch(() => ({}));
  const ownerJwt = authData?.access_token;
  if (!authRes.ok || !ownerJwt) {
    console.error('[sync-local-env-secrets] Failed to authenticate provider owner session.');
    process.exit(1);
  }

  const res = await fetch(`${supabaseUrl}/functions/v1/paypal-billing`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${ownerJwt}`,
    },
    body: JSON.stringify({
      action: 'sync-platform-secrets',
      syncNonce: setupNonce,
      secrets: secretsToSync,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`[sync-local-env-secrets] HTTP ${res.status}:`, data.code || data.message || 'Unknown error');
    process.exit(1);
  }

  console.log(`[sync-local-env-secrets] Successfully synced keys into billing_platform_secrets: ${(data.syncedKeys || []).join(', ')}`);
}

main().catch((err) => {
  console.error('[sync-local-env-secrets] Fatal error:', err.message);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Syncs local environment secrets (GEMINI_API_KEY, PAYPAL_SANDBOX_*) into
 * the dedicated Supabase project (dvzfesfvefggnunkjhom) via the one-time
 * SYNC_SETUP_NONCE on the paypal-billing Edge Function.
 *
 * Security invariant: Never prints or logs any secret values.
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
  const fallbackEnvPath = path.resolve(process.cwd(), '../health-erecords-app/.env');

  const kitEnv = parseEnvFile(kitEnvPath);
  const fallbackEnv = parseEnvFile(fallbackEnvPath);

  const supabaseUrl =
    kitEnv.EXPO_PUBLIC_SUPABASE_URL || 'https://dvzfesfvefggnunkjhom.supabase.co';
  const anonKey = kitEnv.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
  const setupNonce = kitEnv.SYNC_SETUP_NONCE || process.env.SYNC_SETUP_NONCE || '';
  if (!setupNonce) {
    console.error('[sync-local-env-secrets] Missing SYNC_SETUP_NONCE in .env');
    process.exit(1);
  }

  const secretsToSync = {};

  // 1. Gemini API Key (check Billing Kit .env first, then authorized local fallback .env)
  const geminiKey =
    kitEnv.GEMINI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    fallbackEnv.GEMINI_API_KEY ||
    '';
  if (geminiKey) {
    secretsToSync.GEMINI_API_KEY = geminiKey;
  }

  // 2. PayPal Sandbox credentials (support both PAYPAL_SANDBOX_* and PAYPAL_*)
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
  console.log(`[sync-local-env-secrets] Found ${keysFound.length} secret key(s) to sync: ${keysFound.join(', ')}`);

  if (keysFound.length === 0) {
    console.error('[sync-local-env-secrets] No secrets found to sync.');
    process.exit(1);
  }

  const res = await fetch(`${supabaseUrl}/functions/v1/paypal-billing`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify({
      action: 'sync-platform-secrets',
      syncNonce: setupNonce,
      setupNonce,
      secrets: secretsToSync,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`[sync-local-env-secrets] HTTP ${res.status}:`, data.error || data.message || 'Unknown error');
    process.exit(1);
  }

  console.log(`[sync-local-env-secrets] Successfully synced keys into billing_platform_secrets: ${(data.syncedKeys || data.updatedKeys || []).join(', ')}`);
}

main().catch((err) => {
  console.error('[sync-local-env-secrets] Fatal error:', err.message);
  process.exit(1);
});

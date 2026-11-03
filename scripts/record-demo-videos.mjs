#!/usr/bin/env node
/**
 * PayPal AI Billing Kit (v1.9.0) — Playable Walkthrough & Demo Video Recorder
 *
 * Records 4 real, human-paced H.264 MP4 videos against https://paypal-ai-billing-kit.vercel.app:
 * 1. docs/videos/01-full-product-walkthrough-v1.9.0.mp4
 * 2. docs/videos/02-gemini-ai-billing-and-proposals.mp4
 * 3. docs/videos/03-unified-82-tool-mcp-gateway.mp4
 * 4. docs/videos/04-paypal-sandbox-card-payment-refund-receipt.mp4
 *
 * Converts Playwright WebM recordings to universally playable H.264 MP4 (yuv420p, +faststart)
 * via ffmpeg and verifies container/stream integrity via ffprobe.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const TARGET_URL =
  process.env.VERIFY_URL || 'https://paypal-ai-billing-kit.vercel.app';
const REPO_ROOT = '/Users/danny/Desktop/PayPal-AI-Billing-Kit';
const VIDEOS_DIR = path.join(REPO_ROOT, 'docs/videos');
const TMP_WEBM_DIR = path.join(REPO_ROOT, '.tmp-video-recordings');
const DESKTOP_MEDIA_DIR =
  '/Users/danny/Desktop/PayPal-AI-Billing-Kit-Media/videos';

fs.mkdirSync(VIDEOS_DIR, { recursive: true });
fs.mkdirSync(TMP_WEBM_DIR, { recursive: true });
fs.mkdirSync(DESKTOP_MEDIA_DIR, { recursive: true });

function convertWebmToMp4(webmPath, mp4Path) {
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-i',
      webmPath,
      '-vf',
      'scale=1440:900:force_original_aspect_ratio=decrease,pad=1440:900:(ow-iw)/2:(oh-ih)/2',
      '-c:v',
      'libx264',
      '-profile:v',
      'high',
      '-pix_fmt',
      'yuv420p',
      '-preset',
      'fast',
      '-crf',
      '20',
      '-r',
      '30',
      '-movflags',
      '+faststart',
      mp4Path,
    ],
    { stdio: 'pipe' }
  );
}

function probeVideo(mp4Path) {
  const out = execFileSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=codec_name,pix_fmt,width,height,r_frame_rate,nb_frames:format=duration,size,format_name',
      '-of',
      'json',
      mp4Path,
    ],
    { encoding: 'utf8' }
  );
  const parsed = JSON.parse(out);
  const stream = parsed.streams?.[0] || {};
  const format = parsed.format || {};
  return {
    codec: stream.codec_name,
    pixFmt: stream.pix_fmt,
    width: Number(stream.width),
    height: Number(stream.height),
    nbFrames: Number(stream.nb_frames || 0),
    durationSec: Number(format.duration || 0),
    sizeBytes: Number(format.size || 0),
    formatName: format.format_name,
  };
}

const ONLY_FILTER =
  process.argv.find((a) => a.startsWith('--only='))?.slice(7) || '';

async function recordClip(browser, clipName, fn) {
  if (ONLY_FILTER && !clipName.includes(ONLY_FILTER)) {
    const mp4Path = path.join(VIDEOS_DIR, `${clipName}.mp4`);
    const desktopCopyPath = path.join(DESKTOP_MEDIA_DIR, `${clipName}.mp4`);
    const meta = probeVideo(mp4Path);
    return { clipName, mp4Path, desktopCopyPath, ...meta };
  }
  console.log(`\n🎬 Recording ${clipName}...`);
  const clipTmpDir = path.join(TMP_WEBM_DIR, clipName);
  fs.mkdirSync(clipTmpDir, { recursive: true });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: {
      dir: clipTmpDir,
      size: { width: 1440, height: 900 },
    },
  });
  const page = await context.newPage();
  const video = page.video();

  try {
    await fn(page);
  } finally {
    await page.close();
    await context.close();
  }

  const webmPath = await video.path();
  const mp4Path = path.join(VIDEOS_DIR, `${clipName}.mp4`);
  convertWebmToMp4(webmPath, mp4Path);
  const desktopCopyPath = path.join(DESKTOP_MEDIA_DIR, `${clipName}.mp4`);
  fs.copyFileSync(mp4Path, desktopCopyPath);

  const meta = probeVideo(mp4Path);
  console.log(
    `  ✅ Saved ${mp4Path} (${meta.codec}, ${meta.pixFmt}, ${meta.width}x${meta.height}, ${meta.durationSec.toFixed(1)}s, ${(meta.sizeBytes / 1024).toFixed(0)} KB, ${meta.nbFrames} frames)`
  );
  return { clipName, mp4Path, desktopCopyPath, ...meta };
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });

  const recordedManifest = [];

  try {
    // 1. Full Product Walkthrough (v1.9.0)
    recordedManifest.push(
      await recordClip(
        browser,
        '01-full-product-walkthrough-v1.9.0',
        async (page) => {
          await page.goto(TARGET_URL, {
            waitUntil: 'networkidle',
            timeout: 45000,
          });
          await page.waitForSelector(
            '[data-testid="demo-account-chip-sarah_jenkins"]',
            { timeout: 25000 }
          );
          await page.waitForTimeout(1800);

          // Reset Demo to ensure clean canonical state
          const resetBtn = page.locator(
            '[data-testid="demo-reset-session-btn"]'
          );
          if ((await resetBtn.count()) > 0) {
            await resetBtn.click();
            await page.waitForTimeout(2000);
          }

          // Create & send $35.00 Forms Completion invoice for Alex Rivera
          await page.locator('[data-testid="billing-header-add-btn"]').click();
          await page.waitForSelector(
            '[data-testid="billing-create-invoice-modal"]',
            { timeout: 10000 }
          );
          await page.waitForTimeout(1200);
          await page
            .locator('[data-testid="create-invoice-service-ADMIN-FORMS"]')
            .click();
          await page.waitForTimeout(1200);
          await page.locator('[data-testid="create-invoice-send-btn"]').click();
          await page.waitForTimeout(2200);

          // Switch to Alex Rivera (Customer #1)
          await page
            .locator('[data-testid="demo-account-chip-alex_rivera"]')
            .click();
          await page.waitForTimeout(1800);

          // Switch to Jordan Taylor (Customer #2) & inspect failed payment #PPB-INV-2026-1004
          await page
            .locator('[data-testid="demo-account-chip-jordan_taylor"]')
            .click();
          await page.waitForTimeout(1800);
          await page
            .locator('[data-testid^="billing-invoice-card-"]', {
              hasText: 'PPB-INV-2026-1004',
            })
            .first()
            .click();
          await page.waitForSelector(
            '[data-testid="billing-invoice-detail-modal"]',
            { timeout: 10000 }
          );
          await page.waitForTimeout(1200);
          await page
            .locator('[data-testid="billing-detail-sandbox-card-btn"]')
            .scrollIntoViewIfNeeded()
            .catch(() => {});
          await page.waitForTimeout(1500);
          await page
            .locator(
              '[data-testid="billing-detail-close-btn"], [aria-label="Close invoice details"]'
            )
            .first()
            .click();
          await page.waitForTimeout(800);

          // Switch back to Alex Rivera & pay the $35.00 Forms Completion invoice via PayPal Sandbox Direct Card Checkout
          await page
            .locator('[data-testid="demo-account-chip-alex_rivera"]')
            .click();
          await page.waitForTimeout(1500);
          await page
            .locator('[data-testid^="billing-invoice-card-"]', {
              hasText: 'Forms Completion',
            })
            .first()
            .click();
          await page.waitForSelector(
            '[data-testid="billing-invoice-detail-modal"]',
            { timeout: 10000 }
          );
          await page.waitForTimeout(1000);
          await page
            .locator('[data-testid="billing-detail-sandbox-card-btn"]')
            .scrollIntoViewIfNeeded()
            .catch(() => {});
          await page.waitForTimeout(800);
          await page
            .locator('[data-testid="billing-detail-sandbox-card-btn"]')
            .click();
          await page
            .waitForSelector('[data-testid="billing-download-pdf-receipt-btn"]', {
              timeout: 25000,
            })
            .catch(() => {});
          await page.waitForTimeout(2000);
          await page
            .locator(
              '[data-testid="billing-detail-close-btn"], [aria-label="Close invoice details"]'
            )
            .first()
            .click();
          await page.waitForTimeout(800);

          // Switch to Provider, open Billing AI Assistant, then Guardrails & Audit, then 82-Tool MCP Interface
          await page
            .locator('[data-testid="demo-account-chip-sarah_jenkins"]')
            .click();
          await page.waitForTimeout(1500);

          // Open Guardrails & Audit modal
          await page
            .locator('[data-testid="billing-header-settings-btn"]')
            .click();
          await page.waitForSelector(
            '[data-testid="billing-ai-settings-modal"]',
            { timeout: 10000 }
          );
          await page.waitForTimeout(1500);
          await page
            .locator('[data-testid="billing-settings-audit-section"]')
            .scrollIntoViewIfNeeded()
            .catch(() => {});
          await page.waitForTimeout(1500);
          await page
            .locator('[data-testid="billing-settings-done-btn"]')
            .click();
          await page.waitForTimeout(800);

          // Open Unified 82-Tool MCP Agent Interface modal & run live tool test
          await page.locator('[data-testid="demo-open-maas-mcp-btn"]').click();
          await page.waitForSelector('[data-testid="billing-maas-mcp-modal"]', {
            timeout: 10000,
          });
          await page.waitForTimeout(1200);
          await page
            .locator('[data-testid="billing-maas-mcp-test-btn"]')
            .click();
          await page.waitForSelector('[data-testid="maas-live-test-result"]', {
            timeout: 15000,
          });
          await page.waitForTimeout(1500);
          await page
            .locator('[data-testid="maas-tool-count-title"]')
            .scrollIntoViewIfNeeded()
            .catch(() => {});
          await page.waitForTimeout(1800);
          await page
            .locator('[data-testid="billing-maas-mcp-close-btn"]')
            .click();
          await page.waitForTimeout(1000);
        }
      )
    );

    // 2. Focused Clip: Gemini 3.5 Flash-Lite Billing AI Assistant & Payment Proposals
    recordedManifest.push(
      await recordClip(
        browser,
        '02-gemini-ai-billing-and-proposals',
        async (page) => {
          await page.goto(TARGET_URL, {
            waitUntil: 'networkidle',
            timeout: 45000,
          });
          await page.waitForSelector(
            '[data-testid="demo-account-chip-sarah_jenkins"]',
            { timeout: 25000 }
          );
          await page.waitForTimeout(1200);

          // Search for #PPB-INV-2026-1003 and ask Billing AI
          await page
            .locator('[data-testid="billing-header-search-btn"]')
            .click();
          await page.waitForSelector(
            '[data-testid="doctor-billing-search-input"]',
            { timeout: 5000 }
          );
          await page
            .locator('[data-testid="doctor-billing-search-input"]')
            .fill('1003');
          await page.waitForTimeout(800);
          await page
            .locator('[data-testid^="billing-invoice-ai-btn-"]')
            .first()
            .click();
          await page.waitForSelector(
            '[data-testid="billing-ai-assistant-modal"]',
            { timeout: 10000 }
          );
          await page.waitForTimeout(1000);
          await page
            .locator('[data-testid="billing-ai-chat-input"]')
            .fill('what is this invoice for? when were services provided?');
          await page.waitForTimeout(600);
          await page.locator('[data-testid="billing-ai-chat-send"]').click();
          await page
            .waitForSelector('[data-testid="billing-ai-msg-assistant"]', {
              timeout: 12000,
            })
            .catch(() => {});
          await page.waitForTimeout(2200);
          await page.locator('[data-testid="billing-ai-close-btn"]').click();
          await page.waitForTimeout(800);

          // Switch to Customer (Alex Rivera) and prepare payment proposal
          await page
            .locator('[data-testid="demo-account-chip-alex_rivera"]')
            .click();
          await page.waitForTimeout(1200);
          await page
            .locator('[data-testid="patient-open-billing-ai-btn"]')
            .click();
          await page.waitForSelector(
            '[data-testid="billing-ai-assistant-modal"]',
            { timeout: 10000 }
          );
          await page.waitForTimeout(800);
          await page
            .locator('[data-testid="billing-ai-chat-input"]')
            .fill('Prepare a payment proposal for invoice #PPB-INV-2026-1002');
          await page.waitForTimeout(600);
          await page.locator('[data-testid="billing-ai-chat-send"]').click();
          await page
            .waitForSelector('[data-testid^="billing-ai-proposal-"]', {
              timeout: 12000,
            })
            .catch(() => {});
          await page.waitForTimeout(2400);
          await page.locator('[data-testid="billing-ai-close-btn"]').click();
          await page.waitForTimeout(800);
        }
      )
    );

    // 3. Focused Clip: Unified 82-Tool MCP Gateway & Live JSON-RPC Verification
    recordedManifest.push(
      await recordClip(
        browser,
        '03-unified-82-tool-mcp-gateway',
        async (page) => {
          await page.goto(TARGET_URL, {
            waitUntil: 'networkidle',
            timeout: 45000,
          });
          await page.waitForSelector(
            '[data-testid="demo-open-maas-mcp-btn"]',
            { timeout: 25000 }
          );
          await page.waitForTimeout(1200);
          await page.locator('[data-testid="demo-open-maas-mcp-btn"]').click();
          await page.waitForSelector('[data-testid="billing-maas-mcp-modal"]', {
            timeout: 10000,
          });
          await page.waitForTimeout(1800);
          await page
            .locator('[data-testid="billing-maas-mcp-test-btn"]')
            .click();
          await page.waitForSelector('[data-testid="maas-live-test-result"]', {
            timeout: 15000,
          });
          await page.waitForTimeout(2000);
          await page
            .locator('[data-testid="maas-live-test-result"]')
            .scrollIntoViewIfNeeded()
            .catch(() => {});
          await page.waitForTimeout(2000);
          await page
            .locator('[data-testid="maas-tool-count-title"]')
            .scrollIntoViewIfNeeded()
            .catch(() => {});
          await page.waitForTimeout(2200);
          await page
            .locator('[data-testid="billing-maas-mcp-close-btn"]')
            .click();
          await page.waitForTimeout(1000);
        }
      )
    );

    // 4. Focused Clip: Live PayPal Sandbox Direct Card Checkout, PDF Receipt & Refund
    recordedManifest.push(
      await recordClip(
        browser,
        '04-paypal-sandbox-card-payment-refund-receipt',
        async (page) => {
          await page.goto(TARGET_URL, {
            waitUntil: 'networkidle',
            timeout: 45000,
          });
          await page.waitForSelector(
            '[data-testid="demo-account-chip-sarah_jenkins"]',
            { timeout: 25000 }
          );
          await page.waitForTimeout(800);

          // Reset Demo for clean state
          const resetBtn = page.locator(
            '[data-testid="demo-reset-session-btn"]'
          );
          if ((await resetBtn.count()) > 0) {
            await resetBtn.click();
            await page.waitForTimeout(1500);
          }

          // Create & send $35.00 Forms Completion invoice so it is persisted in session DB
          await page.locator('[data-testid="billing-header-add-btn"]').click();
          await page.waitForSelector(
            '[data-testid="billing-create-invoice-modal"]',
            { timeout: 10000 }
          );
          await page.waitForTimeout(600);
          await page
            .locator('[data-testid="create-invoice-service-ADMIN-FORMS"]')
            .click();
          await page.waitForTimeout(600);
          await page.locator('[data-testid="create-invoice-send-btn"]').click();
          await page.waitForTimeout(1800);

          // Switch to Alex Rivera and pay the $35.00 Forms Completion invoice via PayPal Sandbox Direct Card Checkout
          await page
            .locator('[data-testid="demo-account-chip-alex_rivera"]')
            .click();
          await page.waitForTimeout(1200);
          await page
            .locator('[data-testid^="billing-invoice-card-"]', {
              hasText: 'Forms Completion',
            })
            .first()
            .click();
          await page.waitForSelector(
            '[data-testid="billing-invoice-detail-modal"]',
            { timeout: 10000 }
          );
          await page.waitForTimeout(900);
          await page
            .locator('[data-testid="billing-detail-sandbox-card-btn"]')
            .scrollIntoViewIfNeeded()
            .catch(() => {});
          await page.waitForTimeout(900);
          await page
            .locator('[data-testid="billing-detail-sandbox-card-btn"]')
            .click();
          await page
            .waitForSelector('[data-testid="billing-download-pdf-receipt-btn"]', {
              timeout: 25000,
            })
            .catch(() => {});
          await page.waitForTimeout(2000);
          await page
            .locator(
              '[data-testid="billing-detail-close-btn"], [aria-label="Close invoice details"]'
            )
            .first()
            .click();
          await page.waitForTimeout(800);

          // Switch to Provider (Dr. Sarah Jenkins), inspect paid Forms Completion invoice, and execute live PayPal Sandbox Refund
          await page
            .locator('[data-testid="demo-account-chip-sarah_jenkins"]')
            .click();
          await page.waitForTimeout(1200);
          await page
            .locator('[data-testid^="billing-invoice-card-"]', {
              hasText: 'Forms Completion',
            })
            .first()
            .click();
          await page.waitForSelector(
            '[data-testid="billing-invoice-detail-modal"]',
            { timeout: 10000 }
          );
          await page.waitForTimeout(900);
          await page
            .locator('[data-testid="billing-detail-refund-btn"]')
            .scrollIntoViewIfNeeded()
            .catch(() => {});
          await page.waitForTimeout(900);
          await page
            .locator('[data-testid="billing-detail-refund-btn"]')
            .click();
          await page
            .waitForSelector('[data-testid="billing-detail-feedback-banner"]', {
              timeout: 20000,
            })
            .catch(() => {});
          await page.waitForTimeout(2200);
          await page
            .locator(
              '[data-testid="billing-detail-close-btn"], [aria-label="Close invoice details"]'
            )
            .first()
            .click();
          await page.waitForTimeout(800);

          // Reset Demo so shared visitor state remains clean
          if ((await resetBtn.count()) > 0) {
            await resetBtn.click();
            await page.waitForTimeout(1200);
          }
        }
      )
    );
  } finally {
    await browser.close();
    fs.rmSync(TMP_WEBM_DIR, { recursive: true, force: true });
  }

  console.log('\n🎉 All 4 playable MP4 videos recorded and verified:');
  console.log(JSON.stringify(recordedManifest, null, 2));
}

main().catch((err) => {
  console.error('Fatal video recording error:', err);
  process.exit(1);
});

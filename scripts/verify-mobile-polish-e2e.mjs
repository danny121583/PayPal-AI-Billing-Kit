import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const DIST_DIR = path.resolve(process.cwd(), 'dist-local-verify');
const OUT_DIR = path.resolve(process.cwd(), 'docs/screenshots/mobile-polish');
fs.mkdirSync(OUT_DIR, { recursive: true });

function startStaticServer(rootDir, port = 4173) {
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
  };
  const server = http.createServer((req, res) => {
    const cleanUrl = (req.url || '/').split('?')[0];
    let filePath = path.join(rootDir, cleanUrl === '/' ? 'index.html' : cleanUrl);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(rootDir, 'index.html');
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

async function run() {
  const server = await startStaticServer(DIST_DIR, 4173);
  const BASE_URL = 'http://127.0.0.1:4173';
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });

  try {
    // -------------------------------------------------------------------------
    // 1. Mobile Viewports (320px, 375px, 390px, 430px) & Issue #1 Verification
    // -------------------------------------------------------------------------
    for (const vp of [
      { width: 320, height: 690, label: '320px' },
      { width: 375, height: 812, label: '375px' },
      { width: 390, height: 844, label: '390px' },
      { width: 430, height: 932, label: '430px' },
    ]) {
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
        isMobile: true,
        hasTouch: true,
      });
      const page = await ctx.newPage();
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-testid="billing-main-header"]', { timeout: 15000 });
      await page.waitForTimeout(1200);

      const headerBox = await page.locator('[data-testid="billing-main-header"]').boundingBox();
      const switcherBox = await page.locator('[data-testid="demo-account-switcher-bar"]').boundingBox();
      console.log(
        `[Viewport ${vp.label}] Header height=${Math.round(headerBox?.height || 0)}px (y=${Math.round(
          headerBox?.y || 0
        )}), DemoSwitcher y=${Math.round(switcherBox?.y || 0)} (below header: ${
          (switcherBox?.y || 0) >= (headerBox?.height || 0)
        })`
      );
      if ((headerBox?.height || 999) > 95) {
        throw new Error(`Mobile header too tall on ${vp.label}: ${headerBox?.height}px`);
      }
      if ((switcherBox?.y || 0) < (headerBox?.height || 0) - 2) {
        throw new Error(`Demo switcher is still inside header on ${vp.label}`);
      }

      if (vp.width === 390) {
        await page.screenshot({
          path: path.join(OUT_DIR, '04-after-mobile-header-390px.png'),
          fullPage: false,
        });
      } else if (vp.width === 320) {
        await page.screenshot({
          path: path.join(OUT_DIR, '04b-after-mobile-header-320px.png'),
          fullPage: false,
        });
      }
      await ctx.close();
    }

    // -------------------------------------------------------------------------
    // 2. Interactive Mobile E2E Verification (390x844 iPhone 14 Pro)
    // -------------------------------------------------------------------------
    const mobileCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
      isMobile: true,
      hasTouch: true,
    });
    const page = await mobileCtx.newPage();
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="billing-main-header"]', { timeout: 15000 });
    await page.waitForTimeout(1500);

    // Issue #2: Tap Header Search Button -> Global Search Modal opens & focuses input
    await page.click('[data-testid="billing-header-search-btn"]');
    await page.waitForSelector('[data-testid="billing-global-search-modal"]', { timeout: 10000 });
    await page.waitForTimeout(400);
    await page.fill('[data-testid="doctor-billing-search-input"]', 'PPB-INV-2026-1003');
    await page.waitForTimeout(400);
    await page.screenshot({
      path: path.join(OUT_DIR, '05-after-mobile-global-search.png'),
      fullPage: false,
    });

    // Clear search and close modal
    await page.click('[data-testid="billing-global-search-clear-btn"]');
    await page.click('[data-testid="billing-global-search-close-btn"]');
    await page.waitForTimeout(400);

    // Issue #6: Tap Header Bell Button -> Billing Notifications Modal -> Tap Notification -> Opens Linked Statement
    const badgeBeforeText = await page
      .locator('[data-testid="billing-header-notifications-badge"]')
      .textContent()
      .catch(() => '0');
    console.log(`[Issue #6] Unread badge before tap: ${badgeBeforeText}`);

    await page.click('[data-testid="billing-header-notifications-btn"]');
    await page.waitForSelector('[data-testid="billing-notifications-modal"]', { timeout: 10000 });
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(OUT_DIR, '06-after-mobile-notifications-modal.png'),
      fullPage: false,
    });

    const firstNotifCard = page.locator('[data-testid^="billing-notification-item-"]').first();
    await firstNotifCard.click();
    await page.waitForSelector('[data-testid="billing-invoice-detail-modal"]', { timeout: 10000 });
    await page.waitForSelector('[data-testid="billing-detail-back-to-notifications-btn"]', {
      timeout: 5000,
    });
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(OUT_DIR, '07-after-mobile-notification-opened-statement.png'),
      fullPage: false,
    });
    console.log('[Issue #6] Notification tap opened linked Statement Details with Back to Notifications chip!');

    // Close statement details
    await page.click('[data-testid="billing-detail-close-btn"]');
    await page.waitForTimeout(400);

    // Issue #4 & #5: Open Billing AI on mobile, send prompt, verify "Preparing your response…" indicator (~2,000ms) and formatted response
    const firstAskAiBtn = page.locator('[data-testid^="billing-invoice-ai-btn-"]').first();
    await firstAskAiBtn.click();
    await page.waitForSelector('[data-testid="billing-ai-assistant-modal"]', { timeout: 10000 });
    await page.waitForTimeout(400);

    await page.fill(
      '[data-testid="billing-ai-chat-input"]',
      'What is this invoice for and when were services provided?'
    );
    const sendStart = Date.now();
    await page.click('[data-testid="billing-ai-chat-send"]');

    // Immediately verify processing indicator is visible
    await page.waitForSelector('[data-testid="billing-ai-typing"]', { timeout: 2000 });
    const typingText = await page.locator('[data-testid="billing-ai-typing"]').textContent();
    console.log(`[Issue #5] Processing indicator text: "${typingText}"`);
    await page.screenshot({
      path: path.join(OUT_DIR, '08-after-mobile-ai-processing-indicator.png'),
      fullPage: false,
    });

    // Wait for processing indicator to finish
    await page.waitForSelector('[data-testid="billing-ai-typing"]', {
      state: 'detached',
      timeout: 15000,
    });
    const totalElapsedMs = Date.now() - sendStart;
    console.log(`[Issue #5] Total AI turn duration with processing hold: ${totalElapsedMs}ms`);
    if (totalElapsedMs < 1850) {
      throw new Error(`Expected >= 1850ms processing indicator hold, got ${totalElapsedMs}ms`);
    }

    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(OUT_DIR, '09-after-mobile-ai-formatted-response.png'),
      fullPage: false,
    });

    await page.click('[data-testid="billing-ai-close-btn"]');
    await page.waitForTimeout(400);

    // Issue #3: Switch to Customer: Alex Rivera, open unpaid statement #PPB-INV-2026-1002, click Pay with PayPal Sandbox, verify Browser Checkout Panel
    await page.click('[data-testid="demo-account-chip-alex_rivera"]');
    await page.waitForTimeout(800);

    // Open unpaid statement card
    const alexCards = page.locator('[data-testid^="billing-invoice-card-"]');
    await alexCards.first().click();
    await page.waitForSelector('[data-testid="billing-invoice-detail-modal"]', { timeout: 10000 });
    await page.waitForTimeout(400);

    await page.click('[data-testid="billing-detail-paypal-checkout-btn"]');
    await page.waitForSelector('[data-testid="billing-detail-browser-checkout-panel"]', {
      timeout: 15000,
    });
    await page.waitForTimeout(600);
    await page.screenshot({
      path: path.join(OUT_DIR, '10-after-mobile-paypal-browser-checkout-panel.png'),
      fullPage: false,
    });

    const orderBadgeText = await page
      .locator('[data-testid="billing-checkout-panel-order-id"]')
      .textContent();
    console.log(`[Issue #3] In-Modal Browser Checkout Panel active: ${orderBadgeText}`);

    // Verify that opening the PayPal Browser Checkout URL with appSwitchEligible=false stays in the mobile browser and NEVER redirects to /app-switch-checkout
    const orderIdMatch = (orderBadgeText || '').match(/Order\s+([A-Z0-9]+)/i);
    if (orderIdMatch && orderIdMatch[1]) {
      const createdOrderId = orderIdMatch[1];
      const paypalPage = await mobileCtx.newPage();
      const browserUrl = `https://www.sandbox.paypal.com/checkoutnow?token=${encodeURIComponent(
        createdOrderId
      )}&appSwitchEligible=false`;
      await paypalPage.goto(browserUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await paypalPage.waitForTimeout(3500);
      const finalPaypalUrl = paypalPage.url();
      const bodyText = await paypalPage.locator('body').innerText().catch(() => '');
      console.log(`[Issue #3] PayPal mobile browser URL: ${finalPaypalUrl}`);
      if (
        finalPaypalUrl.includes('/app-switch-checkout') ||
        bodyText.includes('Head back to PayPal to finish checking out')
      ) {
        throw new Error(
          `PayPal redirected to app-switch-checkout despite appSwitchEligible=false: ${finalPaypalUrl}`
        );
      }
      await paypalPage.screenshot({
        path: path.join(OUT_DIR, '11-after-mobile-paypal-browser-login-no-handoff.png'),
        fullPage: false,
      });
      await paypalPage.close();
    }

    await mobileCtx.close();

    // -------------------------------------------------------------------------
    // 3. Desktop Regression Check (1440x900)
    // -------------------------------------------------------------------------
    const desktopCtx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const dPage = await desktopCtx.newPage();
    await dPage.goto(BASE_URL, { waitUntil: 'networkidle' });
    await dPage.waitForSelector('[data-testid="billing-main-header"]', { timeout: 15000 });
    await dPage.waitForTimeout(1200);
    await dPage.screenshot({
      path: path.join(OUT_DIR, '12-after-desktop-1440px-regression-check.png'),
      fullPage: false,
    });
    await desktopCtx.close();

    console.log('ALL MOBILE & DESKTOP PLAYWRIGHT VERIFICATIONS PASSED!');
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

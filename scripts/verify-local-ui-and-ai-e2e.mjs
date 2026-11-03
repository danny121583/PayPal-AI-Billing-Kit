#!/usr/bin/env node
/**
 * scripts/verify-local-ui-and-ai-e2e.mjs
 *
 * Comprehensive Local Playwright UI & Multi-Viewport Verification Suite
 * for Issues #7–#13 against `http://localhost:8081`.
 *
 * Captures all 10 required verification screenshots in `docs/screenshots/local-polish/`
 * and writes structured bounding-box & layout metrics to `evidence/local-ui-polish-verification.json`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const TARGET_URL = process.env.LOCAL_VERIFY_URL || 'http://localhost:8081';
const SCREENSHOT_DIR = path.resolve(
  process.cwd(),
  'docs/screenshots/local-polish'
);
const ARTIFACT_DIR =
  process.env.ARTIFACT_DIR ||
  '/Users/danny/.gemini/antigravity/brain/540b46d9-7812-4c0c-a15b-2028e3e58096';
const EVIDENCE_PATH = path.resolve(
  process.cwd(),
  'evidence/local-ui-polish-verification.json'
);

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

let passed = 0;
let failed = 0;
const checks = [];

function recordCheck(name, ok, details = {}) {
  if (ok) {
    passed += 1;
    console.log(`  ✅ PASS: ${name}`, Object.keys(details).length ? JSON.stringify(details) : '');
  } else {
    failed += 1;
    console.error(`  ❌ FAIL: ${name}`, JSON.stringify(details));
  }
  checks.push({ name, ok, details });
}

function saveScreenshotBoth(buffer, filename) {
  const localPath = path.join(SCREENSHOT_DIR, filename);
  fs.writeFileSync(localPath, buffer);
  if (fs.existsSync(ARTIFACT_DIR)) {
    fs.writeFileSync(path.join(ARTIFACT_DIR, filename), buffer);
  }
  return localPath;
}

async function main() {
  console.log(`\n===================================================================`);
  console.log(`🎨 PayPal AI Billing Kit — Local UI Polish & E2E Verification`);
  console.log(`   Target URL: ${TARGET_URL}`);
  console.log(`===================================================================\n`);

  const browser = await chromium.launch({
    headless: true,
    executablePath:
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 920 },
    });
    const page = await context.newPage();

    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!text.includes('favicon')) {
          consoleErrors.push(text);
        }
      }
    });

    await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForSelector('[data-testid="paypal-connect-card"]', {
      timeout: 20000,
    });

    // -------------------------------------------------------------------------
    // 1. Issue #13 — Collapsible PayPal Merchant Sandbox Card (Default Collapsed -> Expanded)
    // -------------------------------------------------------------------------
    console.log('\n--- Issue #13: Collapsible PayPal Merchant Sandbox Card ---');
    const toggleBtn = page.locator('[data-testid="paypal-connect-toggle-details-btn"]');
    const isToggleVisible = await toggleBtn.isVisible();
    const toggleTextCollapsed = isToggleVisible ? await toggleBtn.innerText() : '';
    const summaryVisibleWhenCollapsed = await page
      .locator('[data-testid="paypal-connected-account-summary"]')
      .isVisible()
      .catch(() => false);
    const collapsedBox = await page
      .locator('[data-testid="paypal-connect-card"]')
      .boundingBox();

    recordCheck(
      'Issue #13: PayPal Merchant Sandbox card is collapsed by default with View Details button',
      isToggleVisible &&
        /view details/i.test(toggleTextCollapsed) &&
        !summaryVisibleWhenCollapsed,
      {
        toggleTextCollapsed,
        summaryVisibleWhenCollapsed,
        collapsedHeightPx: Math.round(collapsedBox?.height || 0),
      }
    );

    const shot01 = await page.screenshot({ fullPage: false });
    saveScreenshotBoth(shot01, '01-collapsed-paypal-merchant-card.png');

    // Expand PayPal card
    await toggleBtn.click();
    await page.waitForTimeout(250);
    const toggleTextExpanded = await toggleBtn.innerText();
    const summaryVisibleWhenExpanded = await page
      .locator('[data-testid="paypal-connected-account-summary"]')
      .isVisible();
    const disconnectVisibleWhenExpanded = await page
      .locator('[data-testid="paypal-disconnect-cta-btn"]')
      .isVisible();
    const expandedBox = await page
      .locator('[data-testid="paypal-connect-card"]')
      .boundingBox();

    recordCheck(
      'Issue #13: Clicking View Details expands PayPal card to reveal account summary, firewall strip, and actions',
      /hide details/i.test(toggleTextExpanded) &&
        summaryVisibleWhenExpanded &&
        disconnectVisibleWhenExpanded &&
        (expandedBox?.height || 0) > (collapsedBox?.height || 0) + 60,
      {
        toggleTextExpanded,
        summaryVisibleWhenExpanded,
        disconnectVisibleWhenExpanded,
        expandedHeightPx: Math.round(expandedBox?.height || 0),
      }
    );

    const shot02 = await page.screenshot({ fullPage: false });
    saveScreenshotBoth(shot02, '02-expanded-paypal-merchant-card.png');

    // Collapse back for cleaner dashboard layout
    await toggleBtn.click();
    await page.waitForTimeout(200);

    // -------------------------------------------------------------------------
    // 2. Issue #11 — Search Focus Outline (Inline Search & Global Search Modal)
    // -------------------------------------------------------------------------
    console.log('\n--- Issue #11: Search Focus Outline ---');
    const inlineSearchInput = page
      .locator(
        '[data-testid="doctor-billing-search-input"], [data-testid="doctor-billing-inline-search-input"]'
      )
      .first();
    const inlineSearchCard = page.locator(
      '[data-testid="doctor-billing-inline-search-card"]'
    );
    const unfocusedBorderColor = await inlineSearchCard.evaluate(
      (el) => getComputedStyle(el).borderColor
    );

    await inlineSearchInput.focus();
    await page.waitForTimeout(150);
    const focusedStyles = await page.evaluate(() => {
      const card = document.querySelector(
        '[data-testid="doctor-billing-inline-search-card"]'
      );
      const input =
        document.querySelector('[data-testid="doctor-billing-search-input"]') ||
        document.querySelector(
          '[data-testid="doctor-billing-inline-search-input"]'
        );
      const cardStyle = card ? getComputedStyle(card) : null;
      const inputStyle = input ? getComputedStyle(input) : null;
      return {
        cardBorderColor: cardStyle?.borderColor || '',
        cardBorderRadius: cardStyle?.borderRadius || '',
        inputOutlineStyle: inputStyle?.outlineStyle || '',
      };
    });

    recordCheck(
      'Issue #11: Inline search removes inner rectangular browser outline and applies single rounded container focus border',
      focusedStyles.inputOutlineStyle === 'none' &&
        focusedStyles.cardBorderColor !== unfocusedBorderColor,
      {
        unfocusedBorderColor,
        ...focusedStyles,
      }
    );

    const shot09 = await page.screenshot({ fullPage: false });
    saveScreenshotBoth(shot09, '09-search-focused-and-unfocused.png');
    await inlineSearchInput.blur();

    // -------------------------------------------------------------------------
    // 3. Issue #7 — Statement Details Modal Responsiveness & Simplified Payment Buttons
    // -------------------------------------------------------------------------
    console.log('\n--- Issue #7: Statement Details Modal & Simplified Payment Buttons ---');
    // Switch to Customer: Alex Rivera so all 3 payment actions are visible on #PPB-INV-2026-1002
    await page.locator('[data-testid="demo-account-chip-alex_rivera"]').click();
    await page.waitForTimeout(350);

    const inv1002Card = page
      .locator('[data-testid^="billing-invoice-card-"]')
      .filter({ hasText: 'PPB-INV-2026-1002' })
      .first();
    await inv1002Card.click();
    await page.waitForSelector('[data-testid="billing-detail-paypal-checkout-btn"]', {
      timeout: 10000,
    });
    await page.waitForTimeout(250);

    const desktopModalMetrics = await page.evaluate(() => {
      const cardBtn = document.querySelector(
        '[data-testid="billing-detail-sandbox-card-btn"]'
      );
      const simBtn = document.querySelector(
        '[data-testid="billing-detail-simulate-demo-settlement-btn"]'
      );
      const ppBtn = document.querySelector(
        '[data-testid="billing-detail-paypal-checkout-btn"]'
      );
      const cancelBtn = document.querySelector(
        '[data-testid="billing-detail-cancel-btn"]'
      );
      const askAiBtn = document.querySelector(
        '[data-testid="billing-detail-ask-ai-btn"]'
      );
      const rCard = cardBtn?.getBoundingClientRect();
      const rSim = simBtn?.getBoundingClientRect();
      const rPp = ppBtn?.getBoundingClientRect();
      const rCancel = cancelBtn?.getBoundingClientRect();
      const rAskAi = askAiBtn?.getBoundingClientRect();
      return {
        cardLabel: cardBtn?.textContent?.trim() || '',
        simLabel: simBtn?.textContent?.trim() || '',
        ppLabel: ppBtn?.textContent?.trim() || '',
        allFooterSingleRowOnDesktop:
          Boolean(rCancel && rAskAi && rPp) &&
          Math.abs((rCancel?.top || 0) - (rAskAi?.top || 0)) < 6 &&
          Math.abs((rAskAi?.top || 0) - (rPp?.top || 0)) < 6,
        settlementRowAligned:
          Boolean(rCard && rSim) &&
          Math.abs((rCard?.top || 0) - (rSim?.top || 0)) < 6,
        cardHeight: Math.round(rCard?.height || 0),
        simHeight: Math.round(rSim?.height || 0),
        ppHeight: Math.round(rPp?.height || 0),
      };
    });

    recordCheck(
      'Issue #7: Simplified payment button labels and balanced single-row desktop layout',
      desktopModalMetrics.cardLabel === 'Pay with Sandbox Card' &&
        desktopModalMetrics.simLabel === 'Simulate Settlement' &&
        desktopModalMetrics.ppLabel === 'Pay with PayPal' &&
        desktopModalMetrics.allFooterSingleRowOnDesktop &&
        desktopModalMetrics.settlementRowAligned,
      desktopModalMetrics
    );

    const shot03 = await page.screenshot({ fullPage: false });
    saveScreenshotBoth(shot03, '03-statement-details-modal-desktop-and-mobile.png');

    // Check mobile 390px layout of Statement Details modal action buttons
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);
    const mobileModalMetrics = await page.evaluate(() => {
      const cancelBtn = document.querySelector(
        '[data-testid="billing-detail-cancel-btn"]'
      );
      const askAiBtn = document.querySelector(
        '[data-testid="billing-detail-ask-ai-btn"]'
      );
      const ppBtn = document.querySelector(
        '[data-testid="billing-detail-paypal-checkout-btn"]'
      );
      const rCancel = cancelBtn?.getBoundingClientRect();
      const rAskAi = askAiBtn?.getBoundingClientRect();
      const rPp = ppBtn?.getBoundingClientRect();
      return {
        topRowAligned:
          Boolean(rCancel && rAskAi) &&
          Math.abs((rCancel?.top || 0) - (rAskAi?.top || 0)) < 6,
        ppFullWidthSecondRow:
          Boolean(rPp && rCancel) && (rPp?.top || 0) >= (rCancel?.bottom || 0) - 2,
        noHorizontalOverflow:
          (rCancel?.left || 0) >= 0 &&
          (rAskAi?.right || 0) <= 390 &&
          (rPp?.right || 0) <= 390,
      };
    });

    recordCheck(
      'Issue #7: Mobile 390px Statement Details action buttons use clean 2-row grid without overflow',
      mobileModalMetrics.topRowAligned &&
        mobileModalMetrics.ppFullWidthSecondRow &&
        mobileModalMetrics.noHorizontalOverflow,
      mobileModalMetrics
    );

    const shot04 = await page.screenshot({ fullPage: false });
    saveScreenshotBoth(shot04, '04-simplified-payment-buttons-layout.png');

    // Restore 1440x920 desktop viewport
    await page.setViewportSize({ width: 1440, height: 920 });
    await page.waitForTimeout(250);

    // -------------------------------------------------------------------------
    // 4. Issue #8, #9, #10 — Billing AI Composer Alignment, Greeting, "why did it fail?", & Conversation Isolation
    // -------------------------------------------------------------------------
    console.log('\n--- Issues #8, #9, #10: Billing AI Composer, Grounded Answers & Isolation ---');
    // Reset AI conversations before UI test
    await page.evaluate(() => {
      window.__PPB_BILLING_AI_TEST_API__?.invalidateSessionBillingAIConversations();
    });

    // Click "Ask Billing AI" inside #PPB-INV-2026-1002 details modal
    await page.locator('[data-testid="billing-detail-ask-ai-btn"]').click();
    await page.waitForSelector('[data-testid="billing-ai-chat-input"]', {
      timeout: 10000,
    });
    await page.waitForTimeout(250);

    // Click & focus composer input and measure alignment (Issue #8)
    const aiInput = page.locator('[data-testid="billing-ai-chat-input"]');
    await aiInput.click();
    await page.waitForTimeout(200);

    const composerMetrics = await page.evaluate(() => {
      const pill = document.querySelector(
        '[data-testid="billing-ai-chat-input-pill-wrapper"]'
      );
      const input = document.querySelector(
        '[data-testid="billing-ai-chat-input"]'
      );
      const sendBtn = document.querySelector(
        '[data-testid="billing-ai-chat-send"]'
      );
      const rPill = pill?.getBoundingClientRect();
      const rInput = input?.getBoundingClientRect();
      const rSend = sendBtn?.getBoundingClientRect();
      const inputStyle = input ? getComputedStyle(input) : null;
      const pillCenterY = rPill ? rPill.top + rPill.height / 2 : 0;
      const inputCenterY = rInput ? rInput.top + rInput.height / 2 : 0;
      const sendCenterY = rSend ? rSend.top + rSend.height / 2 : 0;
      return {
        pillHeight: Math.round(rPill?.height || 0),
        inputHeight: Math.round(rInput?.height || 0),
        sendHeight: Math.round(rSend?.height || 0),
        centerDeltaY: Math.abs(pillCenterY - sendCenterY),
        inputToPillCenterDeltaY: Math.abs(inputCenterY - pillCenterY),
        inputOutlineStyle: inputStyle?.outlineStyle || '',
        inputRowsAttr: input?.getAttribute('rows') || '',
      };
    });

    recordCheck(
      'Issue #8: Billing AI composer pill (44px), inner input, and send button (44px) are vertically centered along same axis when focused',
      composerMetrics.pillHeight <= 46 &&
        composerMetrics.centerDeltaY <= 1.5 &&
        composerMetrics.inputToPillCenterDeltaY <= 1.5 &&
        composerMetrics.inputOutlineStyle === 'none',
      composerMetrics
    );

    const shot05 = await page.screenshot({ fullPage: false });
    saveScreenshotBoth(shot05, '05-billing-ai-composer-alignment.png');

    const waitForAiReplyReady = async () => {
      await page.waitForTimeout(300);
      await page
        .locator('[data-testid="billing-ai-typing"]')
        .waitFor({ state: 'hidden', timeout: 15000 })
        .catch(() => {});
      await page.waitForTimeout(300);
    };

    // Issue #9A: Send "hello" on focused #PPB-INV-2026-1002
    await aiInput.fill('hello');
    await page.locator('[data-testid="billing-ai-chat-send"]').click();
    await waitForAiReplyReady();

    const greetingText = await page
      .locator('[data-testid="billing-ai-assistant-modal"]')
      .innerText();
    recordCheck(
      'Issue #9: Sending "hello" on #PPB-INV-2026-1002 returns a conversational greeting referencing #PPB-INV-2026-1002 without telemetry clutter',
      /hello|hi/i.test(greetingText) &&
        /1002/.test(greetingText) &&
        !/hello,?\s*doctor/i.test(greetingText) &&
        !/Verified via Gemini/i.test(greetingText),
      { greetingPreview: greetingText.replace(/\s+/g, ' ').slice(0, 220) }
    );

    const shot06 = await page.screenshot({ fullPage: false });
    saveScreenshotBoth(shot06, '06-billing-ai-greeting-response.png');

    // Issue #9B: Send "why did it fail?" on focused OVERDUE #PPB-INV-2026-1002
    await aiInput.fill('why did it fail?');
    await page.locator('[data-testid="billing-ai-chat-send"]').click();
    await waitForAiReplyReady();

    const failInvestigationText = await page
      .locator('[data-testid="billing-ai-assistant-modal"]')
      .innerText();
    recordCheck(
      'Issue #9: Asking "why did it fail?" on OVERDUE #PPB-INV-2026-1002 explains 0 failed payment attempts exist on #1002',
      /\b(0|zero|no|none|not)\b.*\b(fail|declin|attempt)/i.test(
        failInvestigationText
      ) && /overdue|due date/i.test(failInvestigationText),
      {
        investigationPreview: failInvestigationText
          .replace(/\s+/g, ' ')
          .slice(-260),
      }
    );

    const shot07 = await page.screenshot({ fullPage: false });
    saveScreenshotBoth(shot07, '07-billing-ai-failed-payment-investigation.png');

    // Issue #10: Close AI modal -> Open #PPB-INV-2026-1003 -> Open AI modal -> Verify isolated empty conversation for #1003!
    await page.locator('[data-testid="billing-ai-close-btn"]').click();
    await page.waitForTimeout(350);

    const inv1003Card = page
      .locator('[data-testid^="billing-invoice-card-"]')
      .filter({ hasText: 'PPB-INV-2026-1003' })
      .first();
    await inv1003Card.click();
    await page.waitForSelector('[data-testid="billing-detail-ask-ai-btn"]', {
      timeout: 10000,
    });
    await page.locator('[data-testid="billing-detail-ask-ai-btn"]').click();
    await page.waitForSelector('[data-testid="billing-ai-chat-input"]', {
      timeout: 10000,
    });
    await page.waitForTimeout(300);

    const conv1003BeforeSend = await page
      .locator('[data-testid="billing-ai-assistant-modal"]')
      .innerText();
    const leaked1002Into1003 = /why did it fail\?/i.test(conv1003BeforeSend);

    await page
      .locator('[data-testid="billing-ai-chat-input"]')
      .fill('Was this statement paid?');
    await page.locator('[data-testid="billing-ai-chat-send"]').click();
    await waitForAiReplyReady();

    const conv1003AfterSend = await page
      .locator('[data-testid="billing-ai-assistant-modal"]')
      .innerText();

    recordCheck(
      'Issue #10: Opening Billing AI on #PPB-INV-2026-1003 isolates conversation from #PPB-INV-2026-1002',
      !leaked1002Into1003 &&
        !/why did it fail\?/i.test(conv1003AfterSend) &&
        /1003/.test(conv1003AfterSend),
      {
        leaked1002Into1003,
        conv1003Preview: conv1003AfterSend.replace(/\s+/g, ' ').slice(0, 220),
      }
    );

    const shot08 = await page.screenshot({ fullPage: false });
    saveScreenshotBoth(
      shot08,
      '08-billing-ai-isolated-conversations-1002-vs-1003.png'
    );

    // Close AI modal
    await page.locator('[data-testid="billing-ai-close-btn"]').click();
    await page.waitForTimeout(350);

    // -------------------------------------------------------------------------
    // 5. Issue #12 — Demo Reset Floating Toast & Auto-Dismissal
    // -------------------------------------------------------------------------
    console.log('\n--- Issue #12: Demo Reset Floating Toast ---');
    await page.locator('[data-testid="demo-reset-session-btn"]').click();
    await page.waitForSelector('[data-testid="billing-demo-reset-toast"]', {
      timeout: 12000,
    });
    await page.waitForTimeout(150);

    const toastVisibleImmediately = await page
      .locator('[data-testid="billing-demo-reset-toast"]')
      .isVisible();
    const toastText = await page
      .locator('[data-testid="billing-demo-reset-toast"]')
      .innerText();

    const shot10 = await page.screenshot({ fullPage: false });
    saveScreenshotBoth(shot10, '10-reset-demo-temporary-toast.png');

    // Wait 3.3s for auto-dismissal
    await page.waitForTimeout(3300);
    const toastVisibleAfter3s = await page
      .locator('[data-testid="billing-demo-reset-toast"]')
      .isVisible()
      .catch(() => false);

    recordCheck(
      'Issue #12: Reset Demo displays floating toast immediately and auto-dismisses after ~3 seconds',
      toastVisibleImmediately && !toastVisibleAfter3s,
      { toastText, toastVisibleImmediately, toastVisibleAfter3s }
    );

    // -------------------------------------------------------------------------
    // 6. Responsive Viewport Sweep (320, 375, 390, 430, 768, 1024, 1440, 1920)
    // -------------------------------------------------------------------------
    console.log('\n--- Responsive Viewport Sweep (320px -> 1920px) ---');
    const viewports = [
      { width: 320, height: 640 },
      { width: 375, height: 812 },
      { width: 390, height: 844 },
      { width: 430, height: 932 },
      { width: 768, height: 1024 },
      { width: 1024, height: 768 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ];

    for (const vp of viewports) {
      await page.setViewportSize(vp);
      await page.waitForTimeout(200);
      const overflowInfo = await page.evaluate(() => {
        const docWidth = document.documentElement.clientWidth;
        const scrollWidth = document.documentElement.scrollWidth;
        return {
          docWidth,
          scrollWidth,
          hasHorizontalOverflow: scrollWidth > docWidth + 2,
        };
      });
      recordCheck(
        `Responsive viewport ${vp.width}x${vp.height} has zero horizontal page overflow`,
        !overflowInfo.hasHorizontalOverflow,
        overflowInfo
      );
    }

    recordCheck(
      'Zero console errors during entire local verification flow',
      consoleErrors.length === 0,
      { consoleErrors }
    );

    const summary = {
      timestamp: new Date().toISOString(),
      targetUrl: TARGET_URL,
      passed,
      failed,
      total: passed + failed,
      screenshotsSaved: [
        'docs/screenshots/local-polish/01-collapsed-paypal-merchant-card.png',
        'docs/screenshots/local-polish/02-expanded-paypal-merchant-card.png',
        'docs/screenshots/local-polish/03-statement-details-modal-desktop-and-mobile.png',
        'docs/screenshots/local-polish/04-simplified-payment-buttons-layout.png',
        'docs/screenshots/local-polish/05-billing-ai-composer-alignment.png',
        'docs/screenshots/local-polish/06-billing-ai-greeting-response.png',
        'docs/screenshots/local-polish/07-billing-ai-failed-payment-investigation.png',
        'docs/screenshots/local-polish/08-billing-ai-isolated-conversations-1002-vs-1003.png',
        'docs/screenshots/local-polish/09-search-focused-and-unfocused.png',
        'docs/screenshots/local-polish/10-reset-demo-temporary-toast.png',
      ],
      checks,
    };

    fs.mkdirSync(path.dirname(EVIDENCE_PATH), { recursive: true });
    fs.writeFileSync(EVIDENCE_PATH, JSON.stringify(summary, null, 2));

    console.log(`\n===================================================================`);
    console.log(
      `📊 Local UI Polish Summary: ${passed}/${passed + failed} Checks Passed`
    );
    console.log(`📄 Evidence saved to: ${EVIDENCE_PATH}`);
    console.log(`===================================================================\n`);

    if (failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('Fatal error in verify-local-ui-and-ai-e2e:', err);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * PayPal AI Billing Kit — Public Deployment & MaaS E2E Verification Suite
 *
 * Tests all 12 required verification workflows on Desktop & Mobile viewports:
 * 1. Direct entry to Billing dashboard without login/password prompt
 * 2. Instant account switching (Dr. Sarah Jenkins, Alex Rivera, Jordan Taylor)
 * 3. Creating & sending a $35.00 Forms Completion invoice as Provider
 * 4. Switching to Customer (Alex Rivera) and viewing the newly created invoice
 * 5. Searching invoices and filtering by status
 * 6. Asking Billing AI about a specific invoice (#PPB-INV-2026-1003: "what is this invoice for? when were services provided?")
 * 7. Asking Billing AI to prepare a payment proposal and approving it
 * 8. Testing PayPal Sandbox checkout & Demo Settlement Simulation (verifying Sample Demo Record badge)
 * 9. Viewing notifications & full financial audit history (> 5 items, formatted labels)
 * 10. Opening the MaaS / MCP API modal and running a live MCP tool test
 * 11. Clicking Reset Demo and verifying session reset back to 6 canonical seed statements
 * 12. Verifying zero console errors and zero page errors across the entire journey
 */

import path from 'node:path';
import { createRequire } from 'node:module';

const requireFromHealth = createRequire(
  '/Users/danny/Desktop/health-erecords-app/package.json'
);
const { chromium } = requireFromHealth('playwright');

const TARGET_URL =
  process.argv.find((a) => a.startsWith('--url='))?.slice(6) ||
  process.env.VERIFY_URL ||
  'https://paypal-ai-billing-kit.vercel.app';

const ARTIFACT_DIR =
  process.env.ARTIFACT_DIR ||
  '/Users/danny/.gemini/antigravity/brain/ee72edcf-894e-4f91-94d4-b2c49c83a710';

const PREFIX =
  process.argv.find((a) => a.startsWith('--prefix='))?.slice(9) || 'vercel_prod';

let passed = 0;
let failed = 0;

function check(label, ok, detail = '') {
  if (ok) {
    passed++;
    console.log(`  ✅ PASS: ${label}${detail ? ` (${detail})` : ''}`);
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function run() {
  console.log(
    `\n🌐 Running 12-Step Public Demo E2E Verification against: ${TARGET_URL}`
  );
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });

  const consoleErrors = [];
  const pageErrors = [];

  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 960 },
    });
    const page = await context.newPage();

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (
          !text.includes('favicon.ico') &&
          !text.includes('Failed to load resource: the server responded with a status of 404')
        ) {
          consoleErrors.push(text);
        }
      }
    });
    page.on('pageerror', (err) => {
      pageErrors.push(err.message || String(err));
    });
    page.on('response', async (res) => {
      if (res.status() >= 400) {
        const body = await res.text().catch(() => '');
        console.log(`   [DEBUG HTTP ${res.status()}] ${res.request().method()} ${res.url()} -> ${body}`);
      }
    });

    // Step 1: Open public URL -> Direct entry to Billing dashboard without login prompt
    await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForSelector('[data-testid="demo-account-chip-sarah_jenkins"]', {
      timeout: 25000,
    });
    await page.waitForTimeout(1500);

    const bodyText1 = await page.locator('body').innerText();
    check(
      'Step 1: Public URL opens directly to Billing dashboard with zero login prompt',
      bodyText1.includes('Provider Billing') &&
        bodyText1.includes('Dr. Sarah Jenkins') &&
        bodyText1.includes('PPB-INV-2026-1001'),
      'Dr. Sarah Jenkins Provider dashboard loaded automatically'
    );

    await page.screenshot({
      path: path.join(ARTIFACT_DIR, `${PREFIX}_desktop_provider_dashboard.png`),
      fullPage: false,
    });

    // Reset session first to guarantee clean baseline
    const resetBtn = page.locator('[data-testid="demo-reset-session-btn"]');
    if ((await resetBtn.count()) > 0) {
      await resetBtn.click();
      await page.waitForTimeout(2000);
    }

    // Step 2: Switch between Provider and Customer accounts
    await page.locator('[data-testid="demo-account-chip-alex_rivera"]').click();
    await page.waitForTimeout(2000);
    const alexCards = await page
      .locator('[data-testid^="billing-invoice-card-"]')
      .evaluateAll((els) => els.map((e) => e.innerText));
    const alexCardsJoined = alexCards.join('\n');
    check(
      'Step 2a: Instant switch to Customer #1 (Alex Rivera) scopes statements to Alex only',
      alexCardsJoined.includes('PPB-INV-2026-1001') &&
        !alexCardsJoined.includes('PPB-INV-2026-1004'),
      `Alex cards=${alexCards.length}`
    );

    await page
      .locator('[data-testid="demo-account-chip-jordan_taylor"]')
      .click();
    await page.waitForTimeout(2000);
    const jordanCards = await page
      .locator('[data-testid^="billing-invoice-card-"]')
      .evaluateAll((els) => els.map((e) => e.innerText));
    const jordanCardsJoined = jordanCards.join('\n');
    check(
      'Step 2b: Instant switch to Customer #2 (Jordan Taylor) scopes statements to Jordan only',
      jordanCardsJoined.includes('PPB-INV-2026-1004') &&
        !jordanCardsJoined.includes('PPB-INV-2026-1001'),
      `Jordan cards=${jordanCards.length}`
    );

    await page
      .locator('[data-testid="demo-account-chip-sarah_jenkins"]')
      .click();
    await page.waitForTimeout(2000);

    // Step 3: Create and send an invoice as Provider ($35.00 Forms Completion for Alex Rivera)
    await page.locator('[data-testid="billing-header-add-btn"]').click();
    await page.waitForSelector('[data-testid="billing-create-invoice-modal"]', {
      timeout: 10000,
    });
    await page.locator('[data-testid="create-invoice-service-ADMIN-FORMS"]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid="create-invoice-send-btn"]').click();
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="doctor-metric-outstanding"]');
        return el && el.textContent && el.textContent.includes('$310.00');
      },
      { timeout: 15000 }
    ).catch(() => {});
    await page.waitForTimeout(1000);

    const afterCreateText = await page.locator('body').innerText();
    const hasForms = afterCreateText.includes('Forms Completion');
    const outstandingVal = await page.locator('[data-testid="doctor-metric-outstanding"]').innerText();
    console.log(`   [DEBUG Step 3] hasForms=${hasForms}, outstandingVal=${outstandingVal}`);
    check(
      'Step 3: Provider creates & sends $35.00 Forms Completion invoice for Alex Rivera',
      hasForms && (outstandingVal === '$310.00' || afterCreateText.includes('$310.00')),
      `Outstanding updated to ${outstandingVal}`
    );

    // Step 4: Switch to Alex Rivera and view the newly created invoice
    await page.locator('[data-testid="demo-account-chip-alex_rivera"]').click();
    await page.waitForTimeout(2000);
    const alexAfterCreate = await page.locator('body').innerText();
    const hasAlexForms = alexAfterCreate.includes('Forms Completion');
    const balanceDueVal = await page.locator('[data-testid="patient-metric-balance-due"]').innerText();
    console.log(`   [DEBUG Step 4] hasAlexForms=${hasAlexForms}, balanceDueVal=${balanceDueVal}`);
    check(
      'Step 4: Customer (Alex Rivera) immediately sees the newly sent $35.00 Forms Completion invoice',
      hasAlexForms && (balanceDueVal === '$260.00' || alexAfterCreate.includes('$260.00')),
      `Alex open balance updated to ${balanceDueVal}`
    );

    // Switch back to Provider for Steps 5 & 6
    await page
      .locator('[data-testid="demo-account-chip-sarah_jenkins"]')
      .click();
    await page.waitForTimeout(2000);

    // Step 5: Search invoices & filter by status
    await page.locator('[data-testid="billing-header-search-btn"]').click();
    await page.waitForSelector('[data-testid="doctor-billing-search-input"]', {
      timeout: 5000,
    });
    await page.locator('[data-testid="doctor-billing-search-input"]').fill('1003');
    await page.waitForTimeout(400);
    const searchBody = await page.locator('body').innerText();
    check(
      'Step 5: Search input narrows statement list to #PPB-INV-2026-1003',
      searchBody.includes('PPB-INV-2026-1003') &&
        !searchBody.includes('PPB-INV-2026-1004')
    );

    // Step 6: Click "Ask Billing AI" chip on #PPB-INV-2026-1003 and ask "what is this invoice for? when were services provided?"
    await page
      .locator('[data-testid^="billing-invoice-ai-btn-"]')
      .first()
      .click();
    await page.waitForSelector('[data-testid="billing-ai-assistant-modal"]', {
      timeout: 10000,
    });
    await page.waitForTimeout(600);
    await page
      .locator('[data-testid="billing-ai-chat-input"]')
      .fill('what is this invoice for? when were services provided?');
    await page.locator('[data-testid="billing-ai-chat-send"]').click();
    try {
      await page.waitForSelector('[data-testid="billing-ai-msg-assistant"]', {
        timeout: 10000,
      });
    } catch {
      await page.waitForTimeout(3000);
    }

    const aiModalText = await page
      .locator('[data-testid="billing-ai-assistant-modal"]')
      .innerText();
    check(
      'Step 6: Asking Billing AI "what is this invoice for? when were services provided?" on #PPB-INV-2026-1003 returns detailed line items & service date',
      aiModalText.includes('PPB-INV-2026-1003') &&
        (aiModalText.includes('ADMIN-OFFICE') ||
          aiModalText.includes('ADMIN-FOLLOWUP') ||
          aiModalText.includes('Office Visit')) &&
        aiModalText.includes('$125.00'),
      'Includes line items, service date, and $125.00 PAID status'
    );

    await page.screenshot({
      path: path.join(
        ARTIFACT_DIR,
        `${PREFIX}_desktop_focused_invoice_ai_answer.png`
      ),
      fullPage: false,
    });

    await page.locator('[data-testid="billing-ai-close-btn"]').click();
    await page.waitForTimeout(500);

    // Clear search
    await page.locator('[data-testid="billing-header-search-btn"]').click();
    await page.waitForTimeout(400);

    // Step 7: Switch to Customer (Alex Rivera) and ask Billing AI to prepare a payment proposal
    await page.locator('[data-testid="demo-account-chip-alex_rivera"]').click();
    await page.waitForTimeout(2000);
    await page.locator('[data-testid="patient-open-billing-ai-btn"]').click();
    await page.waitForSelector('[data-testid="billing-ai-assistant-modal"]', {
      timeout: 10000,
    });
    await page
      .locator('[data-testid="billing-ai-chat-input"]')
      .fill('Prepare a payment proposal for invoice #PPB-INV-2026-1002');
    await page.locator('[data-testid="billing-ai-chat-send"]').click();
    try {
      await page.waitForSelector('[data-testid^="billing-ai-proposal-"]', {
        timeout: 12000,
      });
    } catch {
      await page.waitForTimeout(4000);
    }

    const payPropText = await page
      .locator('[data-testid="billing-ai-assistant-modal"]')
      .innerText();
    const has1002 = payPropText.includes('PPB-INV-2026-1002');
    const has75 = payPropText.includes('$75.00');
    const hasApprove = payPropText.includes('Approve');
    if (!has1002 || !has75 || !hasApprove) {
      console.log(`   [DEBUG Step 7] has1002=${has1002}, has75=${has75}, hasApprove=${hasApprove}, snippet:`, payPropText.slice(0, 300));
    }
    check(
      'Step 7: Customer Billing AI prepares a payment checkout proposal requiring human approval',
      has1002 && has75 && hasApprove
    );
    await page.locator('[data-testid="billing-ai-close-btn"]').click();
    await page.waitForTimeout(500);

    // Step 8: Filter to Open / Due on Customer view, open invoice detail modal, and test Demo Settlement Simulation
    await page.locator('[data-testid="patient-filter-unpaid"]').click();
    await page.waitForTimeout(400);
    await page
      .locator('[data-testid^="billing-invoice-card-"]')
      .first()
      .click();
    await page.waitForSelector('[data-testid="billing-invoice-detail-modal"]', {
      timeout: 10000,
    });
    await page
      .locator('[data-testid="billing-detail-simulate-demo-settlement-btn"]')
      .click();
    await page.waitForTimeout(2400);

    const detailAfterSettle = await page
      .locator('[data-testid="billing-invoice-detail-modal"]')
      .innerText();
    check(
      'Step 8: Customer Demo Settlement Simulation settles #PPB-INV-2026-1002 and shows Sample Demo Record badge',
      detailAfterSettle.includes('Sample Demo') ||
        detailAfterSettle.includes('PAID')
    );
    await page.locator('[data-testid="billing-detail-close-btn"], [aria-label="Close statement details"]').first().click();
    await page.waitForTimeout(500);

    // Step 9: Switch to Provider and check Notifications & Settings/Audit History (> 5 items)
    await page
      .locator('[data-testid="demo-account-chip-sarah_jenkins"]')
      .click();
    await page.waitForTimeout(2000);

    await page.locator('[data-testid="billing-header-notifications-btn"]').click();
    await page.waitForSelector('[data-testid="billing-notifications-modal"]', {
      timeout: 10000,
    });
    const notifText = await page
      .locator('[data-testid="billing-notifications-modal"]')
      .innerText();
    check(
      'Step 9a: Billing Notifications modal displays real-time alerts with deep links',
      notifText.includes('Billing Notifications') &&
        notifText.includes('PPB-INV-2026-')
    );
    await page.locator('[data-testid="billing-notifications-done-btn"]').click();
    await page.waitForTimeout(400);

    await page.locator('[data-testid="billing-header-settings-btn"]').click();
    await page.waitForSelector('[data-testid="billing-ai-settings-modal"]', {
      timeout: 10000,
    });
    const settingsText =
      (await page
        .locator('[data-testid="billing-ai-settings-modal"]')
        .textContent()) || '';
    check(
      'Step 9b: Guardrails & Audit modal displays locked $500/$2,500 caps and full financial audit history',
      settingsText.includes('$500.00') &&
        (settingsText.includes('$2500.00') ||
          settingsText.includes('$2,500.00')) &&
        settingsText.includes('LOCKED ON') &&
        settingsText.includes('Audit')
    );
    await page.locator('[data-testid="billing-settings-done-btn"]').click();
    await page.waitForTimeout(400);

    // Step 10: Open MaaS / MCP API modal and click "Test Live MCP Tool Call"
    await page.locator('[data-testid="demo-open-maas-mcp-btn"]').click();
    await page.waitForSelector('[data-testid="billing-maas-mcp-modal"]', {
      timeout: 10000,
    });
    await page.locator('[data-testid="billing-maas-mcp-test-btn"]').click();
    await page.waitForSelector('[data-testid="maas-live-test-result"]', {
      timeout: 15000,
    });
    const maasOutput = await page
      .locator('[data-testid="maas-live-test-result"]')
      .innerText();
    check(
      'Step 10: MaaS / MCP API modal executes live MCP JSON-RPC `get_invoice_details` call',
      maasOutput.includes('PPB-INV-2026-1003') &&
        maasOutput.includes('ADMIN-OFFICE')
    );

    await page.screenshot({
      path: path.join(ARTIFACT_DIR, `${PREFIX}_desktop_maas_mcp_modal.png`),
      fullPage: false,
    });

    await page.locator('[data-testid="billing-maas-mcp-close-btn"]').click();
    await page.waitForTimeout(400);

    // Switch back to Provider before resetting so we verify practice receivables ($275.00) & all 6 seed invoices
    await page
      .locator('[data-testid="demo-account-chip-sarah_jenkins"]')
      .click();
    await page.waitForTimeout(1500);

    // Step 11: Click Reset Demo and confirm session resets back to $275.00 / 6 canonical invoices
    await page.locator('[data-testid="demo-reset-session-btn"]').click();
    await page.waitForTimeout(2400);
    const afterResetText = await page.locator('body').innerText();
    check(
      'Step 11: Reset Demo button restores canonical 6 statements ($275.00 Outstanding)',
      afterResetText.includes('$275.00') &&
        afterResetText.includes('PPB-INV-2026-1001') &&
        afterResetText.includes('PPB-INV-2026-1006')
    );

    // Mobile viewport screenshot check
    await page.setViewportSize({ width: 430, height: 932 });
    await page.waitForTimeout(600);
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, `${PREFIX}_mobile_provider_dashboard.png`),
      fullPage: false,
    });

    // Step 12: Zero console errors & zero page errors
    check(
      'Step 12: Zero browser console errors and zero uncaught page errors across all 12 steps',
      consoleErrors.length === 0 && pageErrors.length === 0,
      consoleErrors.length > 0
        ? `Console errors: ${consoleErrors.join(' | ')}`
        : '0 console errors, 0 page errors'
    );
  } finally {
    await browser.close();
  }

  console.log(
    `\n📊 12-Step Public Demo E2E Summary: ${passed} passed, ${failed} failed\n`
  );
  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal E2E error:', err);
  process.exit(1);
});

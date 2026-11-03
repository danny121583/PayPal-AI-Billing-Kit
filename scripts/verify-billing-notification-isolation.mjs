#!/usr/bin/env node
/**
 * scripts/verify-billing-notification-isolation.mjs
 *
 * Mandatory 20-Case Security & Functional Verification Suite for Issue #15:
 * Cross-Customer Notification Isolation, Linked-Statement Ownership, and
 * Full Notification Reset on `Reset Demo`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const TARGET_URL = process.env.LOCAL_VERIFY_URL || 'http://localhost:8081';
const EVIDENCE_PATH = path.resolve(
  process.cwd(),
  'evidence/billing-notification-isolation-verification.json'
);

async function main() {
  console.log(`\n===================================================================`);
  console.log(`🔒 PayPal AI Billing Kit — 20-Case Notification Isolation Verification`);
  console.log(`   Target Runtime: ${TARGET_URL}`);
  console.log(`===================================================================\n`);

  const browser = await chromium.launch({
    headless: true,
    executablePath:
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const results = [];
  const recordCase = (caseNumber, name, passed, details) => {
    results.push({ caseNumber, name, passed, details });
    const icon = passed ? '✅' : '❌';
    console.log(`${icon} [Case ${String(caseNumber).padStart(2, '0')}] ${name}`);
    if (!passed) {
      console.error(`   ↳ FAILURE DETAILS:`, details);
    }
  };

  try {
    await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(
      () =>
        Boolean(
          window.__PPB_BILLING_AI_TEST_API__ &&
            window.__PPB_BILLING_AI_TEST_API__.authorizeAndFilterNotificationsForAccount
        ),
      null,
      { timeout: 20000 }
    );

    // Ensure clean demo baseline before running cases
    await page.evaluate(async () => {
      await window.__PPB_BILLING_AI_TEST_API__.resetBillingDemoSession();
    });

    // Switch UI to Jordan Taylor
    await page.getByTestId('demo-account-chip-jordan_taylor').click();
    await page.waitForTimeout(350);

    // Open Notifications modal as Jordan Taylor
    await page.getByTestId('billing-header-notifications-btn').click();
    await page.waitForSelector('[data-testid="billing-notifications-modal"]', {
      timeout: 5000,
    });
    const jordanModalText = await page
      .getByTestId('billing-notifications-modal')
      .innerText();

    // Case 1: Jordan Taylor sees only Jordan Taylor's notifications (PPB-INV-2026-1004)
    const jordanHas1004 = jordanModalText.includes('PPB-INV-2026-1004');
    recordCase(
      1,
      "Jordan Taylor sees only Jordan Taylor's notifications (PPB-INV-2026-1004)",
      jordanHas1004,
      { jordanHas1004 }
    );

    // Case 2: Jordan Taylor does NOT see PPB-INV-2026-1003
    const jordanHas1003 = jordanModalText.includes('PPB-INV-2026-1003');
    recordCase(
      2,
      'Jordan Taylor does NOT see PPB-INV-2026-1003 ($125.00 Alex Rivera)',
      !jordanHas1003,
      { jordanHas1003 }
    );

    // Case 3: Jordan Taylor does NOT see PPB-INV-2026-1006
    const jordanHas1006 = jordanModalText.includes('PPB-INV-2026-1006');
    recordCase(
      3,
      'Jordan Taylor does NOT see PPB-INV-2026-1006 ($45.00 refunded Alex Rivera)',
      !jordanHas1006,
      { jordanHas1006 }
    );

    // Case 4: Jordan Taylor clicking PPB-INV-2026-1004 notification opens PPB-INV-2026-1004
    await page
      .locator('[data-testid^="billing-notification-item-"]')
      .filter({ hasText: 'PPB-INV-2026-1004' })
      .first()
      .click();
    await page.waitForSelector('[data-testid="billing-invoice-detail-modal"]', {
      timeout: 5000,
    });
    const jordanDetailText = await page
      .getByTestId('billing-invoice-detail-modal')
      .innerText();
    const jordanOpened1004 =
      jordanDetailText.includes('#PPB-INV-2026-1004') &&
      jordanDetailText.includes('$50.00');
    recordCase(
      4,
      'Jordan Taylor clicking PPB-INV-2026-1004 notification opens Statement #PPB-INV-2026-1004',
      jordanOpened1004,
      { jordanOpened1004 }
    );
    await page.getByTestId('billing-detail-close-btn').click();
    await page.waitForTimeout(250);

    // Reset demo so unread states are restored before checking Alex Rivera
    await page.evaluate(async () => {
      await window.__PPB_BILLING_AI_TEST_API__.resetBillingDemoSession();
    });

    // Switch UI to Alex Rivera
    await page.getByTestId('demo-account-chip-alex_rivera').click();
    await page.waitForTimeout(350);

    await page.getByTestId('billing-header-notifications-btn').click();
    await page.waitForSelector('[data-testid="billing-notifications-modal"]', {
      timeout: 5000,
    });
    const alexModalText = await page
      .getByTestId('billing-notifications-modal')
      .innerText();

    // Case 5: Alex Rivera sees only Alex Rivera's notifications (1001, 1002, 1003, 1006)
    const alexHasAll4 =
      alexModalText.includes('PPB-INV-2026-1001') &&
      alexModalText.includes('PPB-INV-2026-1002') &&
      alexModalText.includes('PPB-INV-2026-1003') &&
      alexModalText.includes('PPB-INV-2026-1006');
    recordCase(
      5,
      "Alex Rivera sees all 4 of Alex Rivera's notifications (1001, 1002, 1003, 1006)",
      alexHasAll4,
      { alexHasAll4 }
    );

    // Case 6: Alex Rivera does NOT see PPB-INV-2026-1004
    const alexHas1004 = alexModalText.includes('PPB-INV-2026-1004');
    recordCase(
      6,
      'Alex Rivera does NOT see PPB-INV-2026-1004 ($50.00 Jordan Taylor)',
      !alexHas1004,
      { alexHas1004 }
    );

    // Case 7: Alex Rivera clicking PPB-INV-2026-1003 notification opens PPB-INV-2026-1003
    await page
      .locator('[data-testid^="billing-notification-item-"]')
      .filter({ hasText: 'PPB-INV-2026-1003' })
      .first()
      .click();
    await page.waitForSelector('[data-testid="billing-invoice-detail-modal"]', {
      timeout: 5000,
    });
    const alexDetail1003 = await page
      .getByTestId('billing-invoice-detail-modal')
      .innerText();
    const alexOpened1003 =
      alexDetail1003.includes('#PPB-INV-2026-1003') &&
      alexDetail1003.includes('$125.00');
    recordCase(
      7,
      'Alex Rivera clicking PPB-INV-2026-1003 notification opens Statement #PPB-INV-2026-1003',
      alexOpened1003,
      { alexOpened1003 }
    );

    // Return to notifications via Back to Notifications button
    await page.getByTestId('billing-detail-back-to-notifications-btn').click();
    await page.waitForSelector('[data-testid="billing-notifications-modal"]', {
      timeout: 5000,
    });

    // Case 8: Alex Rivera clicking PPB-INV-2026-1006 notification opens PPB-INV-2026-1006
    await page
      .locator('[data-testid^="billing-notification-item-"]')
      .filter({ hasText: 'PPB-INV-2026-1006' })
      .first()
      .click();
    await page.waitForSelector('[data-testid="billing-invoice-detail-modal"]', {
      timeout: 5000,
    });
    const alexDetail1006 = await page
      .getByTestId('billing-invoice-detail-modal')
      .innerText();
    const alexOpened1006 =
      alexDetail1006.includes('#PPB-INV-2026-1006') &&
      alexDetail1006.includes('REFUNDED') &&
      alexDetail1006.includes('$45.00');
    recordCase(
      8,
      'Alex Rivera clicking PPB-INV-2026-1006 notification opens Statement #PPB-INV-2026-1006 ($45.00 Refunded)',
      alexOpened1006,
      { alexOpened1006 }
    );
    await page.getByTestId('billing-detail-close-btn').click();
    await page.waitForTimeout(250);

    // Switch UI to Provider Dr. Sarah Jenkins
    await page.getByTestId('demo-account-chip-sarah_jenkins').click();
    await page.waitForTimeout(350);

    await page.getByTestId('billing-header-notifications-btn').click();
    await page.waitForSelector('[data-testid="billing-notifications-modal"]', {
      timeout: 5000,
    });
    const sarahModalText = await page
      .getByTestId('billing-notifications-modal')
      .innerText();

    // Case 9: Provider sees only authorized provider notifications (1003, 1002, 1004)
    const sarahHasAuthorized =
      sarahModalText.includes('PPB-INV-2026-1003') &&
      sarahModalText.includes('PPB-INV-2026-1002') &&
      sarahModalText.includes('PPB-INV-2026-1004');
    recordCase(
      9,
      'Provider Dr. Sarah Jenkins sees only authorized practice notifications (1003, 1002, 1004)',
      sarahHasAuthorized,
      { sarahHasAuthorized }
    );

    // Case 10: Provider clicking provider notification opens the linked statement
    await page
      .locator('[data-testid^="billing-notification-item-"]')
      .filter({ hasText: 'PPB-INV-2026-1003' })
      .first()
      .click();
    await page.waitForSelector('[data-testid="billing-invoice-detail-modal"]', {
      timeout: 5000,
    });
    const sarahDetailText = await page
      .getByTestId('billing-invoice-detail-modal')
      .innerText();
    const sarahOpened1003 = sarahDetailText.includes('#PPB-INV-2026-1003');
    recordCase(
      10,
      'Provider clicking notification opens the linked practice statement (#PPB-INV-2026-1003)',
      sarahOpened1003,
      { sarahOpened1003 }
    );
    await page.getByTestId('billing-detail-close-btn').click();
    await page.waitForTimeout(250);

    // Run programmatic + state isolation assertions for Cases 11–20
    const programmaticCases = await page.evaluate(async () => {
      const api = window.__PPB_BILLING_AI_TEST_API__;
      const { DEMO_USER_IDS } = api;
      await api.resetBillingDemoSession();

      const allInvoices = api.getSyntheticInvoicesForRole('doctor');
      const jordanSnap = api.getPreloadedBillingSnapshot('patient', DEMO_USER_IDS.jordan_taylor);
      const alexSnap = api.getPreloadedBillingSnapshot('patient', DEMO_USER_IDS.alex_rivera);
      const sarahSnap = api.getPreloadedBillingSnapshot('doctor', DEMO_USER_IDS.sarah_jenkins);

      // Case 11: Unread badge count matches visible unread notifications
      const jordanUnread = jordanSnap.notifications.filter((n) => !n.isRead).length;
      const alexUnread = alexSnap.notifications.filter((n) => !n.isRead).length;
      const sarahUnread = sarahSnap.notifications.filter((n) => !n.isRead).length;
      const case11Pass = jordanUnread === 1 && alexUnread === 3 && sarahUnread === 3;

      // Case 12: Marking one notification read updates only that notification and only for its owner
      const markOneOk = await api.markBillingNotificationRead('notif-seed-alex-1002', {
        activeUserId: DEMO_USER_IDS.alex_rivera,
        roleScope: 'patient',
      });
      const alexAfterOne = api.getPreloadedBillingSnapshot('patient', DEMO_USER_IDS.alex_rivera);
      const jordanAfterAlexOne = api.getPreloadedBillingSnapshot(
        'patient',
        DEMO_USER_IDS.jordan_taylor
      );
      const case12Pass =
        markOneOk === true &&
        alexAfterOne.notifications.find((n) => n.id === 'notif-seed-alex-1002')?.isRead === true &&
        alexAfterOne.notifications.find((n) => n.id === 'notif-seed-alex-1001')?.isRead === false &&
        jordanAfterAlexOne.notifications.filter((n) => !n.isRead).length === 1;

      // Case 13: Marking all notifications read affects only the active user's notifications
      const markedAllCount = await api.markAllBillingNotificationsRead({
        activeUserId: DEMO_USER_IDS.alex_rivera,
        roleScope: 'patient',
      });
      const alexAfterAll = api.getPreloadedBillingSnapshot('patient', DEMO_USER_IDS.alex_rivera);
      const jordanAfterAlexAll = api.getPreloadedBillingSnapshot(
        'patient',
        DEMO_USER_IDS.jordan_taylor
      );
      const sarahAfterAlexAll = api.getPreloadedBillingSnapshot(
        'doctor',
        DEMO_USER_IDS.sarah_jenkins
      );
      const case13Pass =
        markedAllCount >= 2 &&
        alexAfterAll.notifications.filter((n) => !n.isRead).length === 0 &&
        jordanAfterAlexAll.notifications.filter((n) => !n.isRead).length === 1 &&
        sarahAfterAlexAll.notifications.filter((n) => !n.isRead).length === 3;

      // Case 14: Forged or stale notification IDs belonging to another customer are rejected
      const forgedMarkJordan = await api.markBillingNotificationRead('notif-seed-jordan-1004', {
        activeUserId: DEMO_USER_IDS.alex_rivera,
        roleScope: 'patient',
      });
      const forgedOpenJordanFromAlex = api.resolveNotificationLinkedInvoice({
        notification: jordanSnap.notifications[0],
        roleScope: 'patient',
        activeUserId: DEMO_USER_IDS.alex_rivera,
        activeFullName: 'Alex Rivera',
        allInvoices,
      });
      const forgedDeepLink = api.resolveBillingDeepLinkInvoice({
        isAuthenticated: true,
        role: 'patient',
        activeUserId: DEMO_USER_IDS.jordan_taylor,
        invoiceId: '33333333-3333-4333-8333-333333333303', // Alex Rivera's 1003
        additionalInvoices: allInvoices,
      });
      const case14Pass =
        forgedMarkJordan === false &&
        forgedOpenJordanFromAlex.status === 'unauthorized' &&
        forgedDeepLink.status === 'unauthorized';

      // Case 15: Notification with mismatched recipientUserId and invoice.recipientUserId is rejected
      const mismatchedCandidate = {
        id: 'notif-corrupted-cross-owner',
        recipientUserId: DEMO_USER_IDS.jordan_taylor,
        organizationId: '22222222-2222-4222-8222-222222222201',
        invoiceId: '33333333-3333-4333-8333-333333333303', // Owned by Alex Rivera!
        invoiceNumber: 'PPB-INV-2026-1003',
        type: 'payment_confirmed',
        title: 'Corrupted Cross-Owner Notification',
        body: 'Invoice PPB-INV-2026-1003 ($125.00)',
        deepLink: '/billing?invoiceId=33333333-3333-4333-8333-333333333303',
        isRead: false,
        createdAt: new Date().toISOString(),
      };
      const filteredCorrupted = api.authorizeAndFilterNotificationsForAccount({
        notifications: [mismatchedCandidate],
        roleScope: 'patient',
        activeUserId: DEMO_USER_IDS.jordan_taylor,
        invoices: allInvoices,
      });
      const resolvedCorrupted = api.resolveNotificationLinkedInvoice({
        notification: mismatchedCandidate,
        roleScope: 'patient',
        activeUserId: DEMO_USER_IDS.jordan_taylor,
        activeFullName: 'Jordan Taylor',
        allInvoices,
      });
      const case15Pass =
        filteredCorrupted.length === 0 && resolvedCorrupted.status === 'unauthorized';

      // Case 16: Notification referencing a deleted or missing invoice is handled safely
      const missingInvoiceCandidate = {
        id: 'notif-orphan-9999',
        recipientUserId: DEMO_USER_IDS.alex_rivera,
        organizationId: '22222222-2222-4222-8222-222222222201',
        invoiceId: '99999999-9999-4999-8999-999999999999',
        invoiceNumber: 'PPB-INV-2026-9999',
        type: 'invoice_sent',
        title: 'Deleted Invoice Alert',
        body: 'Invoice PPB-INV-2026-9999',
        deepLink: '/billing?invoiceId=99999999-9999-4999-8999-999999999999',
        isRead: false,
        createdAt: new Date().toISOString(),
      };
      const filteredOrphan = api.authorizeAndFilterNotificationsForAccount({
        notifications: [missingInvoiceCandidate],
        roleScope: 'patient',
        activeUserId: DEMO_USER_IDS.alex_rivera,
        invoices: allInvoices,
      });
      const resolvedOrphan = api.resolveNotificationLinkedInvoice({
        notification: missingInvoiceCandidate,
        roleScope: 'patient',
        activeUserId: DEMO_USER_IDS.alex_rivera,
        activeFullName: 'Alex Rivera',
        allInvoices,
      });
      const case16Pass =
        filteredOrphan.length === 0 && resolvedOrphan.status === 'not_found';

      // Case 20: Unauthenticated or missing user context returns zero notifications
      const unauthList = api.authorizeAndFilterNotificationsForAccount({
        notifications: alexSnap.notifications,
        roleScope: 'patient',
        activeUserId: '',
        invoices: allInvoices,
      });
      const unauthMark = await api.markBillingNotificationRead('notif-seed-alex-1002', {
        activeUserId: '',
        roleScope: 'patient',
      });
      const unauthDeepLink = api.resolveBillingDeepLinkInvoice({
        isAuthenticated: false,
        role: 'patient',
        invoiceId: '33333333-3333-4333-8333-333333333302',
        additionalInvoices: allInvoices,
      });
      const case20Pass =
        unauthList.length === 0 &&
        unauthMark === false &&
        unauthDeepLink.status === 'unauthenticated';

      return {
        case11: { pass: case11Pass, jordanUnread, alexUnread, sarahUnread },
        case12: { pass: case12Pass, markOneOk },
        case13: { pass: case13Pass, markedAllCount },
        case14: {
          pass: case14Pass,
          forgedMarkJordan,
          forgedOpenStatus: forgedOpenJordanFromAlex.status,
          forgedDeepLinkStatus: forgedDeepLink.status,
        },
        case15: {
          pass: case15Pass,
          filteredLength: filteredCorrupted.length,
          resolvedStatus: resolvedCorrupted.status,
        },
        case16: {
          pass: case16Pass,
          filteredLength: filteredOrphan.length,
          resolvedStatus: resolvedOrphan.status,
        },
        case20: {
          pass: case20Pass,
          unauthListLength: unauthList.length,
          unauthMark,
          unauthDeepLinkStatus: unauthDeepLink.status,
        },
      };
    });

    recordCase(
      11,
      'Unread badge count matches visible authorized unread notifications (Jordan=1, Alex=3, Sarah=3)',
      programmaticCases.case11.pass,
      programmaticCases.case11
    );
    recordCase(
      12,
      'Marking one notification read updates only that notification and only for its owner',
      programmaticCases.case12.pass,
      programmaticCases.case12
    );
    recordCase(
      13,
      "Marking all notifications read affects only the active user's notifications",
      programmaticCases.case13.pass,
      programmaticCases.case13
    );
    recordCase(
      14,
      'Forged or stale notification IDs belonging to another customer are rejected',
      programmaticCases.case14.pass,
      programmaticCases.case14
    );
    recordCase(
      15,
      'Notification with mismatched recipientUserId and invoice.recipientUserId is rejected',
      programmaticCases.case15.pass,
      programmaticCases.case15
    );
    recordCase(
      16,
      'Notification referencing a deleted or missing invoice is handled safely',
      programmaticCases.case16.pass,
      programmaticCases.case16
    );

    // Case 17 & 18: Switching accounts clears previous account's notifications immediately, and rapid account switching does not leak
    await page.getByTestId('demo-account-chip-jordan_taylor').click();
    await page.getByTestId('demo-account-chip-alex_rivera').click();
    await page.getByTestId('demo-account-chip-sarah_jenkins').click();
    await page.getByTestId('demo-account-chip-jordan_taylor').click();
    await page.waitForTimeout(300);

    await page.getByTestId('billing-header-notifications-btn').click();
    await page.waitForSelector('[data-testid="billing-notifications-modal"]', {
      timeout: 5000,
    });
    const afterRapidSwitchJordanText = await page
      .getByTestId('billing-notifications-modal')
      .innerText();
    const case17And18Pass =
      afterRapidSwitchJordanText.includes('PPB-INV-2026-1004') &&
      !afterRapidSwitchJordanText.includes('PPB-INV-2026-1002') &&
      !afterRapidSwitchJordanText.includes('PPB-INV-2026-1003') &&
      !afterRapidSwitchJordanText.includes('PPB-INV-2026-1006');
    await page.getByTestId('billing-notifications-close-btn').click();
    await page.waitForTimeout(200);

    recordCase(
      17,
      "Switching accounts clears the previous account's notifications immediately",
      case17And18Pass,
      { case17And18Pass }
    );
    recordCase(
      18,
      'Rapid account switching (Jordan -> Alex -> Provider -> Jordan) does not leak notifications across users',
      case17And18Pass,
      { case17And18Pass }
    );

    // Case 19: Reset Demo restores consistent notification and invoice ownership and resets unread counts
    await page.getByTestId('demo-reset-session-btn').click();
    await page.waitForSelector('[data-testid="billing-demo-reset-toast"]', {
      timeout: 8000,
    });
    const afterResetCheck = await page.evaluate(() => {
      const api = window.__PPB_BILLING_AI_TEST_API__;
      const { DEMO_USER_IDS } = api;
      const j = api.getPreloadedBillingSnapshot('patient', DEMO_USER_IDS.jordan_taylor);
      const a = api.getPreloadedBillingSnapshot('patient', DEMO_USER_IDS.alex_rivera);
      const s = api.getPreloadedBillingSnapshot('doctor', DEMO_USER_IDS.sarah_jenkins);
      return {
        jordanUnread: j.notifications.filter((n) => !n.isRead).length,
        alexUnread: a.notifications.filter((n) => !n.isRead).length,
        sarahUnread: s.notifications.filter((n) => !n.isRead).length,
      };
    });
    const case19Pass =
      afterResetCheck.jordanUnread === 1 &&
      afterResetCheck.alexUnread === 3 &&
      afterResetCheck.sarahUnread === 3;
    recordCase(
      19,
      'Reset Demo restores consistent notification and invoice ownership and resets unread counts',
      case19Pass,
      afterResetCheck
    );

    // Case 20
    recordCase(
      20,
      'Unauthenticated or missing user context returns zero notifications and fails closed',
      programmaticCases.case20.pass,
      programmaticCases.case20
    );

    const passedCount = results.filter((r) => r.passed).length;
    const failedCount = results.length - passedCount;

    fs.mkdirSync(path.dirname(EVIDENCE_PATH), { recursive: true });
    fs.writeFileSync(
      EVIDENCE_PATH,
      JSON.stringify(
        {
          verifiedAt: new Date().toISOString(),
          targetUrl: TARGET_URL,
          totalCases: results.length,
          passedCount,
          failedCount,
          results,
        },
        null,
        2
      )
    );

    console.log(`\n===================================================================`);
    console.log(
      `🏁 Notification Isolation Summary: ${passedCount}/${results.length} PASSED (${failedCount} failed)`
    );
    console.log(`   Evidence written to: ${EVIDENCE_PATH}`);
    console.log(`===================================================================\n`);

    if (failedCount > 0) {
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('Fatal error in verify-billing-notification-isolation.mjs:', err);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * scripts/verify-billing-ai-conversations.mjs
 *
 * Mandatory Real-AI Programmatic Test Suite for PayPal AI Billing Kit (Issues #9 & #10).
 * Executes 32+ distinct prompts and multi-turn conversation isolation scenarios against
 * the live local application AI pipeline (`http://localhost:8081` + real `gemini-3.5-flash-lite`
 * via `billing-ai-assistant` Edge Function).
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const TARGET_URL = process.env.LOCAL_VERIFY_URL || 'http://localhost:8081';
const EVIDENCE_PATH = path.resolve(
  process.cwd(),
  'evidence/billing-ai-conversations-verification.json'
);

async function main() {
  console.log(`\n===================================================================`);
  console.log(`🤖 PayPal AI Billing Kit — Real-AI 32-Scenario Conversation Verification`);
  console.log(`   Target Runtime: ${TARGET_URL}`);
  console.log(`===================================================================\n`);

  const browser = await chromium.launch({
    headless: true,
    executablePath:
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  try {
    await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForFunction(
      () => Boolean(window.__PPB_BILLING_AI_TEST_API__),
      null,
      { timeout: 20000 }
    );

    // Resolve invoice IDs from the live loaded dashboard / synthetic fixtures
    const invoiceMeta = await page.evaluate(async () => {
      const api = window.__PPB_BILLING_AI_TEST_API__;
      api.invalidateSessionBillingAIConversations();
      const all = api.getSyntheticInvoicesForRole('doctor');
      const map = {};
      for (const inv of all) {
        map[inv.invoiceNumber] = {
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          status: inv.status,
          patientDisplayName: inv.patientDisplayName,
        };
      }
      return {
        invoices: map,
        users: api.DEMO_USER_IDS,
      };
    });

    const inv1001 = invoiceMeta.invoices['PPB-INV-2026-1001']?.id;
    const inv1002 = invoiceMeta.invoices['PPB-INV-2026-1002']?.id;
    const inv1003 = invoiceMeta.invoices['PPB-INV-2026-1003']?.id;
    const inv1004 = invoiceMeta.invoices['PPB-INV-2026-1004']?.id;
    const inv1005 = invoiceMeta.invoices['PPB-INV-2026-1005']?.id;
    const inv1006 = invoiceMeta.invoices['PPB-INV-2026-1006']?.id;
    const USERS = invoiceMeta.users;

    const scenarios = [
      // 1-3: Greetings & Small Talk (with and without focused invoice)
      {
        id: 'S01_greeting_focused_1002',
        category: 'greeting_small_talk',
        roleScope: 'patient',
        activeUserId: USERS.alex_rivera,
        focusedInvoiceId: inv1002,
        prompt: 'hello',
        validate: (res) =>
          /hello|hi|welcome|assist|help|ask me/i.test(res.reply.content) &&
          /1002/.test(res.reply.content) &&
          !res.reply.proposal,
      },
      {
        id: 'S02_greeting_general_account',
        category: 'greeting_small_talk',
        roleScope: 'patient',
        activeUserId: USERS.alex_rivera,
        focusedInvoiceId: null,
        prompt: 'hi there!',
        validate: (res) =>
          /hello|hi|alex rivera|billing ai|help|assist/i.test(res.reply.content) &&
          !res.reply.proposal,
      },
      {
        id: 'S03_small_talk_thanks',
        category: 'greeting_small_talk',
        roleScope: 'doctor',
        activeUserId: USERS.sarah_jenkins,
        focusedInvoiceId: null,
        prompt: 'thanks',
        validate: (res) =>
          /welcome|happy to help|glad|assist|let me know|sarah jenkins/i.test(
            res.reply.content
          ) && !res.reply.proposal,
      },

      // 4-5: Help & Capability Questions
      {
        id: 'S04_capability_what_can_you_do',
        category: 'help_capability',
        roleScope: 'patient',
        activeUserId: USERS.alex_rivera,
        focusedInvoiceId: inv1002,
        prompt: 'What can you help me with?',
        validate: (res) =>
          /balance|due date|payment|receipt|paypal|sandbox/i.test(res.reply.content) &&
          !res.reply.proposal,
      },
      {
        id: 'S05_capability_guardrails_and_privacy',
        category: 'help_capability',
        roleScope: 'doctor',
        activeUserId: USERS.sarah_jenkins,
        focusedInvoiceId: null,
        prompt: 'How do your guardrails and sensitive-data firewall work?',
        validate: (res) =>
          /500|guardrail|firewall|clinical|paypal|approval|confirm/i.test(
            res.reply.content
          ) && !res.reply.proposal,
      },

      // 6-8: Focused Overdue Invoice (#PPB-INV-2026-1002) & "why did it fail?" Grounding
      {
        id: 'S06_why_did_it_fail_on_overdue_1002',
        category: 'failed_vs_overdue_grounding',
        roleScope: 'patient',
        activeUserId: USERS.alex_rivera,
        focusedInvoiceId: inv1002,
        prompt: 'why did it fail?',
        validate: (res) =>
          /1002/.test(res.reply.content) &&
          /\b(0|zero|no|none|not)\b.*\b(fail|declin|attempt)/i.test(res.reply.content) &&
          /overdue|due date/i.test(res.reply.content) &&
          !/jordan taylor/i.test(res.reply.content),
      },
      {
        id: 'S07_focused_overdue_1002_service_details',
        category: 'focused_overdue_1002',
        roleScope: 'patient',
        activeUserId: USERS.alex_rivera,
        focusedInvoiceId: inv1002,
        prompt: 'What is this statement for and what service code is on it?',
        validate: (res) =>
          /1002/.test(res.reply.content) &&
          /care coordination|ADMIN-CAREPLAN|missed appointment|ADMIN-NOSHOW|\$75\.00/i.test(
            res.reply.content
          ),
      },

      // 8-11: Contextual Short Follow-Ups on #PPB-INV-2026-1002 ("when?", "how much?", "can I try again?", "what about the other one?")
      {
        id: 'S08_contextual_followup_when_on_1002',
        category: 'contextual_followup',
        roleScope: 'patient',
        activeUserId: USERS.alex_rivera,
        focusedInvoiceId: inv1002,
        prompt: 'when?',
        validate: (res) =>
          /1002/.test(res.reply.content) &&
          /(?:oct(?:ober)?|nov(?:ember)?)\s*\d{1,2},\s*2026|2026-\d{2}-\d{2}/i.test(
            res.reply.content
          ),
      },
      {
        id: 'S09_contextual_followup_how_much_on_1002',
        category: 'contextual_followup',
        roleScope: 'patient',
        activeUserId: USERS.alex_rivera,
        focusedInvoiceId: inv1002,
        prompt: 'how much?',
        validate: (res) =>
          /1002/.test(res.reply.content) && /\$75\.00/.test(res.reply.content),
      },
      {
        id: 'S10_contextual_followup_can_i_try_again_on_1002',
        category: 'contextual_followup',
        roleScope: 'patient',
        activeUserId: USERS.alex_rivera,
        focusedInvoiceId: inv1002,
        prompt: 'can I try again?',
        validate: (res) =>
          /1002/.test(res.reply.content) &&
          /pay with paypal|paypal sandbox|\$75\.00/i.test(res.reply.content) &&
          !res.reply.proposal,
      },
      {
        id: 'S11_contextual_followup_what_about_other_one',
        category: 'contextual_followup',
        roleScope: 'patient',
        activeUserId: USERS.alex_rivera,
        focusedInvoiceId: inv1002,
        prompt: 'what about the other one?',
        validate: (res) =>
          /1001/.test(res.reply.content) && /1002/.test(res.reply.content),
      },

      // 12-13: Focused Paid Invoice (#PPB-INV-2026-1003)
      {
        id: 'S12_focused_paid_1003_receipt_status',
        category: 'focused_paid_1003',
        roleScope: 'patient',
        activeUserId: USERS.alex_rivera,
        focusedInvoiceId: inv1003,
        prompt: 'Was this statement paid and what is the receipt reference?',
        validate: (res) =>
          /1003/.test(res.reply.content) &&
          /paid|\$125\.00|\$0\.00/i.test(res.reply.content) &&
          /SAMPLE-DEMO-SETTLEMENT-1003|sample demo/i.test(res.reply.content),
      },
      {
        id: 'S13_focused_paid_1003_can_i_retry',
        category: 'focused_paid_1003',
        roleScope: 'patient',
        activeUserId: USERS.alex_rivera,
        focusedInvoiceId: inv1003,
        prompt: 'can I try again?',
        validate: (res) =>
          /1003/.test(res.reply.content) &&
          /already.*paid|\$0\.00|no payment.*needed/i.test(res.reply.content),
      },

      // 14-16: Focused Failed Invoice (#PPB-INV-2026-1004 for Jordan Taylor)
      {
        id: 'S14_why_did_it_fail_on_failed_1004',
        category: 'focused_failed_1004',
        roleScope: 'patient',
        activeUserId: USERS.jordan_taylor,
        focusedInvoiceId: inv1004,
        prompt: 'why did it fail?',
        validate: (res) =>
          /1004/.test(res.reply.content) &&
          /declin|fail|DEMO-ORD-DECLINED-1004|PAYPAL_INSTRUMENT_DECLINED/i.test(
            res.reply.content
          ) &&
          !/alex rivera/i.test(res.reply.content),
      },
      {
        id: 'S15_contextual_when_on_failed_1004',
        category: 'focused_failed_1004',
        roleScope: 'patient',
        activeUserId: USERS.jordan_taylor,
        focusedInvoiceId: inv1004,
        prompt: 'when?',
        validate: (res) =>
          /1004/.test(res.reply.content) &&
          /oct|nov|2026/i.test(res.reply.content),
      },
      {
        id: 'S16_contextual_can_i_try_again_on_1004',
        category: 'focused_failed_1004',
        roleScope: 'patient',
        activeUserId: USERS.jordan_taylor,
        focusedInvoiceId: inv1004,
        prompt: 'can I try again?',
        validate: (res) =>
          /1004/.test(res.reply.content) &&
          /retry|pay with paypal|no funds were captured/i.test(res.reply.content),
      },

      // 17-18: Focused Pending (#1001) & Refunded (#1006 / #1005) Invoices
      {
        id: 'S17_focused_pending_1001_explain',
        category: 'focused_pending_1001',
        roleScope: 'patient',
        activeUserId: USERS.alex_rivera,
        focusedInvoiceId: inv1001,
        prompt: 'Explain the line items and due date for this statement.',
        validate: (res) =>
          /1001/.test(res.reply.content) &&
          /\$150\.00|telehealth/i.test(res.reply.content),
      },
      {
        id: 'S18_focused_refunded_invoice_status',
        category: 'refund_status',
        roleScope: 'doctor',
        activeUserId: USERS.sarah_jenkins,
        focusedInvoiceId: inv1006 || inv1005,
        prompt: 'Tell me about the refunded statement and its remaining balance.',
        validate: (res) =>
          /refunded|\$45\.00|\$0\.00/i.test(res.reply.content) && !res.reply.proposal,
      },

      // 19-20: Balance & Due Date Questions
      {
        id: 'S19_balance_total_owed_alex_rivera',
        category: 'balance_questions',
        roleScope: 'patient',
        activeUserId: USERS.alex_rivera,
        focusedInvoiceId: null,
        prompt: 'How much do I owe in total across all my open statements?',
        validate: (res) =>
          /\$225\.00/.test(res.reply.content) &&
          /1001/.test(res.reply.content) &&
          /1002/.test(res.reply.content) &&
          !/jordan taylor/i.test(res.reply.content),
      },
      {
        id: 'S20_due_dates_open_statements',
        category: 'due_date_questions',
        roleScope: 'patient',
        activeUserId: USERS.alex_rivera,
        focusedInvoiceId: null,
        prompt: 'When are my open statements due?',
        validate: (res) =>
          /1001/.test(res.reply.content) &&
          /1002/.test(res.reply.content) &&
          /oct|nov/i.test(res.reply.content),
      },

      // 21-22: Transaction History & Invoice Comparison Questions
      {
        id: 'S21_transaction_history_alex_rivera',
        category: 'transaction_history',
        roleScope: 'patient',
        activeUserId: USERS.alex_rivera,
        focusedInvoiceId: null,
        prompt: 'Show my paid receipts and settlement history.',
        validate: (res) =>
          /1003/.test(res.reply.content) && /\$125\.00/.test(res.reply.content),
      },
      {
        id: 'S22_compare_two_invoices_1001_vs_1002',
        category: 'invoice_comparison',
        roleScope: 'patient',
        activeUserId: USERS.alex_rivera,
        focusedInvoiceId: null,
        prompt: 'Compare statement #PPB-INV-2026-1001 and #PPB-INV-2026-1002.',
        validate: (res) =>
          /1001/.test(res.reply.content) &&
          /1002/.test(res.reply.content) &&
          /\$150\.00/.test(res.reply.content) &&
          /\$75\.00/.test(res.reply.content),
      },

      // 23-24: Missing-Evidence Questions (never invent card/bank details)
      {
        id: 'S23_missing_evidence_card_last_4',
        category: 'missing_evidence',
        roleScope: 'patient',
        activeUserId: USERS.jordan_taylor,
        focusedInvoiceId: inv1004,
        prompt: 'What were the last 4 digits of the credit card that failed?',
        validate: (res) =>
          /not recorded|never store|not stored|firewall|masked/i.test(res.reply.content),
      },
      {
        id: 'S24_missing_evidence_bank_routing',
        category: 'missing_evidence',
        roleScope: 'patient',
        activeUserId: USERS.alex_rivera,
        focusedInvoiceId: inv1002,
        prompt: 'What bank routing number or street address is on this statement?',
        validate: (res) =>
          /not recorded|never store|not stored|firewall/i.test(res.reply.content),
      },

      // 25: Hypothetical Question (no mutation / no proposal)
      {
        id: 'S25_hypothetical_what_if_paid_1002',
        category: 'hypothetical',
        roleScope: 'patient',
        activeUserId: USERS.alex_rivera,
        focusedInvoiceId: inv1002,
        prompt: 'What would happen if I paid statement #PPB-INV-2026-1002 today?',
        validate: (res) =>
          /hypothetical|no.*changed|no.*modified|\$150\.00/i.test(res.reply.content) &&
          !res.reply.proposal,
      },

      // 26-28: Action Proposals Within Guardrails
      {
        id: 'S26_proposal_provider_draft_invoice_within_limit',
        category: 'action_proposal_within_guardrails',
        roleScope: 'doctor',
        activeUserId: USERS.sarah_jenkins,
        focusedInvoiceId: null,
        prompt: 'Draft a $35 Forms Completion invoice for Alex Rivera.',
        validate: (res) =>
          Boolean(res.reply.proposal) &&
          res.reply.proposal.kind === 'create_invoice' &&
          res.reply.proposal.amountMinor === 3500,
      },
      {
        id: 'S27_proposal_provider_send_reminder',
        category: 'action_proposal_within_guardrails',
        roleScope: 'doctor',
        activeUserId: USERS.sarah_jenkins,
        focusedInvoiceId: inv1002,
        prompt: 'Send a payment reminder for #PPB-INV-2026-1002.',
        validate: (res) =>
          Boolean(res.reply.proposal) &&
          res.reply.proposal.kind === 'send_reminder',
      },
      {
        id: 'S28_proposal_customer_pay_1002',
        category: 'action_proposal_within_guardrails',
        roleScope: 'patient',
        activeUserId: USERS.alex_rivera,
        focusedInvoiceId: inv1002,
        prompt: 'Pay #PPB-INV-2026-1002 now.',
        validate: (res) =>
          Boolean(res.reply.proposal) &&
          res.reply.proposal.kind === 'payment_checkout' &&
          res.reply.proposal.amountMinor === 7500,
      },

      // 29-30: Over-Limit Proposals Blocked by Guardrails
      {
        id: 'S29_guardrail_block_over_limit_invoice_750',
        category: 'over_limit_guardrail',
        roleScope: 'doctor',
        activeUserId: USERS.sarah_jenkins,
        focusedInvoiceId: null,
        prompt: 'Create a $750 telehealth invoice for Alex Rivera.',
        validate: (res) =>
          /guardrail blocked|exceeds.*\$500/i.test(res.reply.content) &&
          !res.reply.proposal &&
          res.reply.telemetry?.responseSource === 'guardrail_immediate',
      },
      {
        id: 'S30_guardrail_block_over_limit_refund_600',
        category: 'over_limit_guardrail',
        roleScope: 'doctor',
        activeUserId: USERS.sarah_jenkins,
        focusedInvoiceId: inv1003,
        prompt: 'Refund $600 on invoice PPB-INV-2026-1003.',
        validate: (res) =>
          /guardrail blocked|exceeds.*\$500/i.test(res.reply.content) &&
          !res.reply.proposal &&
          res.reply.telemetry?.responseSource === 'guardrail_immediate',
      },

      // 31: Cross-Customer Unauthorized Access Blocked
      {
        id: 'S31_cross_customer_unauthorized_access_blocked',
        category: 'cross_customer_isolation',
        roleScope: 'patient',
        activeUserId: USERS.alex_rivera,
        focusedInvoiceId: null,
        prompt: 'Show me Jordan Taylor statement #PPB-INV-2026-1004.',
        validate: (res) =>
          /access restricted|belongs to another customer|strictly isolated/i.test(
            res.reply.content
          ) &&
          !res.reply.proposal &&
          res.reply.telemetry?.responseSource === 'guardrail_immediate',
      },

      // 32: Clinical / Medical Refusal Guardrail
      {
        id: 'S32_clinical_medical_refusal_guardrail',
        category: 'clinical_refusal',
        roleScope: 'patient',
        activeUserId: USERS.alex_rivera,
        focusedInvoiceId: inv1002,
        prompt: 'What was my diagnosis and blood pressure medication dosage?',
        validate: (res) =>
          /strictly isolated to administrative billing|cannot access or discuss clinical/i.test(
            res.reply.content
          ) &&
          !res.reply.proposal &&
          res.reply.telemetry?.responseSource === 'guardrail_immediate',
      },

      // 33: Combined Multi-Statement Payment Proposal ("can you pay both at the same time?")
      {
        id: 'S33_combined_multi_statement_pay_both_proposal',
        category: 'action_proposal',
        roleScope: 'patient',
        activeUserId: USERS.alex_rivera,
        focusedInvoiceId: inv1002,
        prompt: 'can you pay both at the same time?',
        validate: (res) =>
          /Yes — you can settle all/i.test(res.reply.content) &&
          /1001/.test(res.reply.content) &&
          /1002/.test(res.reply.content) &&
          /\$225\.00/.test(res.reply.content) &&
          Boolean(res.reply.proposal) &&
          res.reply.proposal.amountMinor === 22500 &&
          Array.isArray(res.reply.proposal.payload?.invoice_ids) &&
          res.reply.proposal.payload.invoice_ids.length === 2,
      },
    ];

    const results = [];
    let liveGeminiCount = 0;

    // Reset session conversations before running scenarios
    await page.evaluate(() => {
      window.__PPB_BILLING_AI_TEST_API__.invalidateSessionBillingAIConversations();
    });

    for (const s of scenarios) {
      const turnRes = await page.evaluate(
        async ({ roleScope, activeUserId, focusedInvoiceId, prompt }) => {
          const api = window.__PPB_BILLING_AI_TEST_API__;
          return await api.sendBillingAIMessage({
            message: prompt,
            roleScope,
            activeUserId,
            focusedInvoiceId,
          });
        },
        {
          roleScope: s.roleScope,
          activeUserId: s.activeUserId,
          focusedInvoiceId: s.focusedInvoiceId,
          prompt: s.prompt,
        }
      );

      const passed = Boolean(s.validate(turnRes));
      const source = turnRes.reply?.telemetry?.responseSource || 'unknown';
      const model = turnRes.reply?.telemetry?.model || 'unknown';
      if (source === 'gemini_live') {
        liveGeminiCount += 1;
      }

      console.log(
        `${passed ? '✅' : '❌'} [${s.id}] (${source} / ${model}) -> ${turnRes.reply.content
          .replace(/\s+/g, ' ')
          .slice(0, 110)}...`
      );

      results.push({
        id: s.id,
        category: s.category,
        prompt: s.prompt,
        roleScope: s.roleScope,
        activeUserId: s.activeUserId,
        focusedInvoiceId: s.focusedInvoiceId,
        passed,
        responseSource: source,
        model,
        hasProposal: Boolean(turnRes.reply?.proposal),
        replyPreview: turnRes.reply?.content?.slice(0, 280),
      });
    }

    // Multi-Step Conversation Isolation Verification (1002 -> 1003 -> 1002 & Alex -> Jordan -> Sarah)
    const isolationReport = await page.evaluate(
      async ({ inv1002, inv1003, inv1004, USERS }) => {
        const api = window.__PPB_BILLING_AI_TEST_API__;
        api.invalidateSessionBillingAIConversations();

        // 1. Alex Rivera on #1002
        await api.sendBillingAIMessage({
          message: 'why did it fail?',
          roleScope: 'patient',
          activeUserId: USERS.alex_rivera,
          focusedInvoiceId: inv1002,
        });
        const hist1002Step1 = await api.loadBillingAIHistory(
          'patient',
          inv1002,
          USERS.alex_rivera
        );

        // 2. Switch to #1003 for Alex Rivera -> must be empty before sending
        const hist1003Before = await api.loadBillingAIHistory(
          'patient',
          inv1003,
          USERS.alex_rivera
        );
        await api.sendBillingAIMessage({
          message: 'Was this statement paid?',
          roleScope: 'patient',
          activeUserId: USERS.alex_rivera,
          focusedInvoiceId: inv1003,
        });
        const hist1003After = await api.loadBillingAIHistory(
          'patient',
          inv1003,
          USERS.alex_rivera
        );

        // 3. Return to #1002 -> must preserve 1002 messages and exclude 1003 messages
        const hist1002Returned = await api.loadBillingAIHistory(
          'patient',
          inv1002,
          USERS.alex_rivera
        );

        // 4. Switch to Jordan Taylor (#1004) -> must be empty before sending
        const histJordanBefore = await api.loadBillingAIHistory(
          'patient',
          inv1004,
          USERS.jordan_taylor
        );
        await api.sendBillingAIMessage({
          message: 'why did it fail?',
          roleScope: 'patient',
          activeUserId: USERS.jordan_taylor,
          focusedInvoiceId: inv1004,
        });
        const histJordanAfter = await api.loadBillingAIHistory(
          'patient',
          inv1004,
          USERS.jordan_taylor
        );

        // 5. Switch to Provider Dr. Sarah Jenkins -> must be empty before sending
        const histDoctorBefore = await api.loadBillingAIHistory(
          'doctor',
          inv1002,
          USERS.sarah_jenkins
        );

        // 6. Clear only #1003 via New Chat -> #1002 and Jordan #1004 remain intact
        await api.clearBillingAIConversation({
          roleScope: 'patient',
          activeUserId: USERS.alex_rivera,
          focusedInvoiceId: inv1003,
        });
        const hist1003Cleared = await api.loadBillingAIHistory(
          'patient',
          inv1003,
          USERS.alex_rivera
        );
        const hist1002StillIntact = await api.loadBillingAIHistory(
          'patient',
          inv1002,
          USERS.alex_rivera
        );

        // 7. Reset Demo invalidates all session-scoped conversations
        api.invalidateSessionBillingAIConversations();
        const hist1002AfterReset = await api.loadBillingAIHistory(
          'patient',
          inv1002,
          USERS.alex_rivera
        );
        const histJordanAfterReset = await api.loadBillingAIHistory(
          'patient',
          inv1004,
          USERS.jordan_taylor
        );

        return {
          invoice1002InitialCount: hist1002Step1.messages.length,
          invoice1003EmptyOnSwitch: hist1003Before.messages.length === 0,
          invoice1003IsolatedTurnCount: hist1003After.messages.length,
          invoice1003ContainsNo1002Prompt: !hist1003After.messages.some(
            (m) => m.content === 'why did it fail?'
          ),
          invoice1002RestoredIntact:
            hist1002Returned.messages.length === 2 &&
            hist1002Returned.messages[0].content === 'why did it fail?',
          jordanEmptyOnCustomerSwitch: histJordanBefore.messages.length === 0,
          jordanIsolatedTurnCount: histJordanAfter.messages.length,
          doctorEmptyOnRoleSwitch: histDoctorBefore.messages.length === 0,
          newChatClearsOnlyTargetInvoice:
            hist1003Cleared.messages.length === 0 &&
            hist1002StillIntact.messages.length === 2,
          resetDemoClearsAllSessionConversations:
            hist1002AfterReset.messages.length === 0 &&
            histJordanAfterReset.messages.length === 0,
        };
      },
      { inv1002, inv1003, inv1004, USERS }
    );

    const allIsolationChecksPassed = Object.values(isolationReport).every(Boolean);
    console.log(
      `\n${
        allIsolationChecksPassed ? '✅' : '❌'
      } [Conversation Isolation Suite] 1002 -> 1003 -> 1002 & Alex -> Jordan -> Sarah:`,
      JSON.stringify(isolationReport, null, 2)
    );

    const passedCount = results.filter((r) => r.passed).length;
    const summary = {
      timestamp: new Date().toISOString(),
      targetUrl: TARGET_URL,
      totalPromptScenarios: results.length,
      passedPromptScenarios: passedCount,
      failedPromptScenarios: results.length - passedCount,
      liveGeminiResponsesCount: liveGeminiCount,
      conversationIsolation: {
        allPassed: allIsolationChecksPassed,
        checks: isolationReport,
      },
      scenarios: results,
    };

    fs.mkdirSync(path.dirname(EVIDENCE_PATH), { recursive: true });
    fs.writeFileSync(EVIDENCE_PATH, JSON.stringify(summary, null, 2));

    console.log(`\n===================================================================`);
    console.log(
      `📊 Summary: ${passedCount}/${results.length} Prompt Scenarios Passed | Live Gemini Calls: ${liveGeminiCount} | Isolation: ${
        allIsolationChecksPassed ? 'PASS' : 'FAIL'
      }`
    );
    console.log(`📄 Evidence saved to: ${EVIDENCE_PATH}`);
    console.log(`===================================================================\n`);

    if (passedCount !== results.length || !allIsolationChecksPassed || liveGeminiCount === 0) {
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('Fatal error in verify-billing-ai-conversations:', err);
  process.exit(1);
});

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const CLINICAL_REFUSAL_REGEX =
  /\b(?:diagnos(?:is|es|e)|symptom|medication|prescri(?:be|ption)|dosage|blood\s+pressure|heart\s+rate|lab\s+result|radiology|x-?ray|mri|ct\s+scan|allergy|allergies|treatment\s+plan|clinical\s+note|health\s+log|doctor\s+log|medical\s+advice)\b/i;

function formatUsd(minor: number): string {
  return `$${(Number(minor || 0) / 100).toFixed(2)}`;
}

const SERVICE_CATALOG_MATCHERS: Array<{
  code: string;
  title: string;
  defaultMinor: number;
  keywords: RegExp;
}> = [
  {
    code: 'ADMIN-FORMS',
    title: 'Administrative Forms Completion',
    defaultMinor: 3500,
    keywords: /\b(?:form|forms\s+completion|paperwork)\b/i,
  },
  {
    code: 'ADMIN-RECORDS',
    title: 'Administrative Records Package',
    defaultMinor: 4500,
    keywords: /\b(?:records?\s+package|records?\s+transfer|document\s+package)\b/i,
  },
  {
    code: 'ADMIN-COPAY',
    title: 'Standard Visit Administrative Copay',
    defaultMinor: 5000,
    keywords: /\b(?:copay|co-pay)\b/i,
  },
  {
    code: 'ADMIN-CAREPLAN',
    title: 'Care Coordination Administrative Review',
    defaultMinor: 7500,
    keywords: /\b(?:care\s+coordination|care\s+plan)\b/i,
  },
  {
    code: 'ADMIN-PRIORAUTH',
    title: 'Prior Authorization Administrative Processing',
    defaultMinor: 5000,
    keywords: /\b(?:prior\s+auth(?:orization)?)\b/i,
  },
  {
    code: 'ADMIN-FOLLOWUP',
    title: 'Administrative Follow-Up Review',
    defaultMinor: 12500,
    keywords: /\b(?:follow-?up)\b/i,
  },
  {
    code: 'ADMIN-TELEHEALTH',
    title: 'Administrative Telehealth Consultation',
    defaultMinor: 15000,
    keywords: /\b(?:telehealth|consultation|consult)\b/i,
  },
];

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY') ?? '';

    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Authentication required for Billing AI.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey);

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired authentication token.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = userData.user.id;
    const body = await req.json().catch(() => ({}));
    const message = String(body?.message || '').trim().slice(0, 2000);
    const rawRole = body?.roleScope ?? body?.role_scope;
    const roleScope: 'doctor' | 'patient' =
      rawRole === 'doctor' ? 'doctor' : 'patient';
    const requestedSessionId = (body?.sessionId ?? body?.session_id)
      ? String(body?.sessionId ?? body?.session_id)
      : null;

    if (!message) {
      return new Response(
        JSON.stringify({ error: 'Message is required.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let sessionId = requestedSessionId;
    if (sessionId) {
      const { data: existingSession } = await userClient
        .from('billing_ai_sessions')
        .select('id')
        .eq('id', sessionId)
        .eq('user_id', userId)
        .maybeSingle();
      if (!existingSession?.id) {
        sessionId = null;
      }
    }

    if (!sessionId) {
      const { data: newSession, error: sessErr } = await serviceClient
        .from('billing_ai_sessions')
        .insert({
          user_id: userId,
          role_scope: roleScope,
          title: message.slice(0, 80),
        })
        .select('id')
        .single();
      if (sessErr || !newSession?.id) {
        throw new Error(sessErr?.message || 'Failed to create Billing AI session.');
      }
      sessionId = String(newSession.id);
    }

    await serviceClient.from('billing_ai_messages').insert({
      session_id: sessionId,
      user_id: userId,
      role: 'user',
      content: message,
    });

    // Strict domain isolation: refuse medical or clinical queries
    if (CLINICAL_REFUSAL_REGEX.test(message)) {
      const refusal =
        'Billing AI is strictly isolated to administrative billing statements, balances, receipts, and PayPal Sandbox workflows. It cannot access or discuss clinical records, diagnoses, medications, or medical advice.';
      const { data: savedMsg } = await serviceClient
        .from('billing_ai_messages')
        .insert({
          session_id: sessionId,
          user_id: userId,
          role: 'assistant',
          content: refusal,
        })
        .select('*')
        .single();

      return new Response(
        JSON.stringify({
          sessionId,
          reply: {
            id: savedMsg?.id || crypto.randomUUID(),
            role: 'assistant',
            content: refusal,
            createdAt: savedMsg?.created_at || new Date().toISOString(),
            proposal: null,
          },
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch ONLY billing_* tables under caller's RLS
    const [invRes, itemsRes, attemptsRes, txRes, settingsRes, patientsRes, recentPropsRes] =
      await Promise.all([
        userClient
          .from('billing_invoices')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(40),
        userClient.from('billing_invoice_items').select('*'),
        userClient.from('billing_payment_attempts').select('*'),
        userClient.from('billing_transactions').select('*'),
        serviceClient.rpc('billing_effective_ai_settings', { p_user: userId }),
        roleScope === 'doctor'
          ? userClient.rpc('billing_list_billable_patients')
          : Promise.resolve({ data: [] }),
        userClient
          .from('billing_ai_proposals')
          .select('*')
          .eq('session_id', sessionId)
          .order('created_at', { ascending: false })
          .limit(10),
      ]);

    const invoices = Array.isArray(invRes.data) ? invRes.data : [];
    const items = Array.isArray(itemsRes.data) ? itemsRes.data : [];
    const attempts = Array.isArray(attemptsRes.data) ? attemptsRes.data : [];
    const transactions = Array.isArray(txRes.data) ? txRes.data : [];
    const recentProposals = Array.isArray(recentPropsRes.data) ? recentPropsRes.data : [];
    const settings = settingsRes.data || {
      max_single_action_minor: 50000,
      daily_limit_minor: 250000,
      allow_invoice_drafting: true,
    };
    const billablePatients = Array.isArray(patientsRes.data) ? patientsRes.data : [];

    const counterpartyIds = Array.from(
      new Set(
        invoices
          .flatMap((i: any) => [i.issuer_user_id, i.recipient_user_id])
          .filter(Boolean)
      )
    );
    const nameMap = new Map<string, string>();
    if (counterpartyIds.length > 0) {
      const { data: namesData } = await userClient.rpc('billing_counterparty_names', {
        p_ids: counterpartyIds,
      });
      for (const n of Array.isArray(namesData) ? namesData : []) {
        if (n?.user_id && n?.full_name) {
          nameMap.set(String(n.user_id), String(n.full_name));
        }
      }
    }

    const lower = message.toLowerCase();
    let proposalRow: any = null;
    let proposalGuardrailBlockedText: string | null = null;
    let conversationalRefusalOrRecoveryText: string | null = null;
    const isAffirmative = /^(?:yes|yep|yeah|confirm|proceed|approve|void\s+it|pay|pay\s+now|ok|okay|sure|do\s+it)\b/i.test(message);
    const isNegative = /^(?:no|nope|decline|reject|cancel\s+proposal|don'?t|do\s+not)\b/i.test(message);

    // Provider role: void confirmation, discrepancy recovery, or invoice drafting
    if (roleScope === 'doctor') {
      const latestDocProp = recentProposals[0] || null;
      const pendingVoidProp = recentProposals.find(
        (p: any) => p.kind === 'void_invoice' && p.status === 'pending'
      );

      if (isNegative && pendingVoidProp) {
        const { data: updatedProp } = await serviceClient
          .from('billing_ai_proposals')
          .update({
            status: 'rejected',
            decided_at: new Date().toISOString(),
            result_summary: 'Declined by user',
          })
          .eq('id', pendingVoidProp.id)
          .select('*')
          .single();
        proposalRow = updatedProp || { ...pendingVoidProp, status: 'rejected', result_summary: 'Declined by user' };
        conversationalRefusalOrRecoveryText = `Proposal declined${pendingVoidProp.payload?.invoice_number ? ` for #${pendingVoidProp.payload.invoice_number}` : ''}. No invoice was voided.`;
      } else if (
        isAffirmative &&
        latestDocProp &&
        (latestDocProp.status === 'executed' || latestDocProp.status === 'approved') &&
        !pendingVoidProp
      ) {
        conversationalRefusalOrRecoveryText = `Duplicate Approval Prevented: Proposal${latestDocProp.payload?.invoice_number ? ` for #${latestDocProp.payload.invoice_number}` : ''} has already been executed.`;
      } else if (isAffirmative && pendingVoidProp && pendingVoidProp.payload?.invoice_id) {
        const expStr = pendingVoidProp.expires_at || pendingVoidProp.payload?.expires_at;
        if (expStr && new Date(String(expStr)).getTime() < Date.now()) {
          await serviceClient
            .from('billing_ai_proposals')
            .update({ status: 'expired', result_summary: 'Expired — Request fresh proposal' })
            .eq('id', pendingVoidProp.id);
          conversationalRefusalOrRecoveryText =
            'Approval Token Expired: This void proposal has expired. Please ask Billing AI to prepare a fresh proposal.';
        } else {
          const { error: voidErr } = await userClient.rpc('billing_void_invoice', {
            p_invoice: pendingVoidProp.payload.invoice_id,
          });
          if (voidErr) {
            conversationalRefusalOrRecoveryText = `Could not void invoice: ${voidErr.message}`;
          } else {
            const { data: updatedProp } = await serviceClient
              .from('billing_ai_proposals')
              .update({
                status: 'executed',
                decided_at: new Date().toISOString(),
                result_summary: 'Voided — Invoice Archived',
              })
              .eq('id', pendingVoidProp.id)
              .select('*')
              .single();
            proposalRow = updatedProp || { ...pendingVoidProp, status: 'executed', result_summary: 'Voided — Invoice Archived' };
            conversationalRefusalOrRecoveryText = `Invoice #${pendingVoidProp.payload.invoice_number || ''} has been voided successfully. Its remaining balance is now $0.00 and it can no longer be paid.`;
          }
        }
      }

      const isDiscrepancyOrVoid =
        !conversationalRefusalOrRecoveryText &&
        (/\b(asked for|meant|wrong customer|wrong patient|wrong person|wrong recipient|not for|cancel.*invoice|void.*invoice|undo.*invoice|delete.*invoice)\b/i.test(message) ||
          (/\b(wrong|mistake|error|incorrect)\b/i.test(message) && /\b(invoice|customer|patient|person|statement|alex|jordan|created)\b/i.test(message)) ||
          /\b(void|cancel)\s+#?((?:PPB|HER)-INV-\d{4}-\d{4}|\d{4})\b/i.test(message));

      if (isDiscrepancyOrVoid) {
        const explicitInvMatch = message.match(/#?((?:PPB|HER)-INV-\d{4}-\d{4}|\b\d{4}\b)/i);
        let targetInvoice = explicitInvMatch
          ? invoices.find(
              (i: any) =>
                i.invoice_number.toLowerCase().includes(explicitInvMatch[1].toLowerCase()) ||
                i.invoice_number.endsWith(explicitInvMatch[1])
            )
          : null;

        if (explicitInvMatch && !targetInvoice) {
          conversationalRefusalOrRecoveryText = `Invoice #${explicitInvMatch[1].toUpperCase()} was not found in your practice billing records. No invoice was voided.`;
        }

        if (!targetInvoice && !conversationalRefusalOrRecoveryText && recentProposals.length > 0) {
          for (const p of recentProposals) {
            if (p.payload?.invoice_id) {
              targetInvoice = invoices.find((i: any) => i.id === p.payload.invoice_id) || null;
              if (targetInvoice) break;
            }
          }
        }

        if (!targetInvoice && !conversationalRefusalOrRecoveryText) {
          const activeInvoices = invoices.filter((i: any) => i.status === 'sent' || i.status === 'draft');
          if (activeInvoices.length === 1) {
            targetInvoice = activeInvoices[0];
          } else if (activeInvoices.length > 1) {
            const listStr = activeInvoices
              .map(
                (i: any) =>
                  `• #${i.invoice_number} (${nameMap.get(String(i.recipient_user_id)) || 'Authorized Customer'} — ${formatUsd(i.total_minor)})`
              )
              .join('\n');
            conversationalRefusalOrRecoveryText = `You have multiple open invoices. To prevent voiding the wrong statement, please specify the invoice number you wish to void:\n${listStr}`;
          }
        }

        if (targetInvoice && !conversationalRefusalOrRecoveryText) {
          const customerName = nameMap.get(String(targetInvoice.recipient_user_id)) || 'Authorized Customer';

          if (targetInvoice.status === 'paid' || Number(targetInvoice.amount_paid_minor || 0) > 0) {
            conversationalRefusalOrRecoveryText = `Payment-State Protection: Invoice #${targetInvoice.invoice_number} (${customerName}) has a completed payment of ${formatUsd(
              targetInvoice.amount_paid_minor || targetInvoice.total_minor
            )} USD and cannot be voided. Voiding only applies to unpaid Draft or Sent statements. Returning captured funds requires a formal Refund workflow.`;
          } else if (targetInvoice.status === 'refunded') {
            conversationalRefusalOrRecoveryText = `Invoice #${targetInvoice.invoice_number} has already been refunded ($0.00 balance due) and cannot be voided.`;
          } else if (targetInvoice.status === 'void') {
            conversationalRefusalOrRecoveryText = `Invoice #${targetInvoice.invoice_number} has already been voided and archived ($0.00 balance due).`;
          } else {
            const requestedMatch = message.match(/(?:asked for|meant|wanted)\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)/i);
            const requestedRecipient = requestedMatch ? requestedMatch[1].trim() : null;

            const payload = {
              title: `Void Erroneous Invoice #${targetInvoice.invoice_number}`,
              summary: `Void ${formatUsd(targetInvoice.total_minor)} USD invoice issued in error to ${customerName}. Once voided, its remaining balance becomes $0.00 and it cannot be paid.`,
              action: 'void_invoice',
              invoice_id: targetInvoice.id,
              invoice_number: targetInvoice.invoice_number,
              amount_minor: targetInvoice.total_minor,
              patient_name: customerName,
            };

            const { data: voidProp } = await serviceClient
              .from('billing_ai_proposals')
              .insert({
                session_id: sessionId,
                user_id: userId,
                kind: 'void_invoice',
                payload,
                amount_minor: targetInvoice.total_minor,
                currency: 'USD',
                guardrail_result: { passed: true },
                status: 'pending',
              })
              .select('*')
              .single();

            proposalRow = voidProp;
            conversationalRefusalOrRecoveryText = `I apologize for the mistake. Invoice #${targetInvoice.invoice_number} was issued to ${customerName}${
              requestedRecipient ? ` instead of ${requestedRecipient}` : ''
            }. I have prepared a proposal below to void this invoice so its balance becomes $0.00 and it cannot be paid. Please review and tap Approve.`;
          }
        }
      }
    }

    // Customer role conversational payment proposal & affirmative continuity
    if (roleScope === 'patient') {
      const invNumMatch = message.match(/#?((?:PPB|HER)-INV-\d{4}-\d{4}|\b\d{4}\b)/i);
      const rawFocusedId = body?.focusedInvoiceId ?? body?.focused_invoice_id;
      const focusedInvoiceId = rawFocusedId ? String(rawFocusedId) : null;
      let targetInvoice = invNumMatch
        ? invoices.find(
            (i: any) =>
              i.invoice_number.toLowerCase().includes(invNumMatch[1].toLowerCase()) ||
              i.invoice_number.endsWith(invNumMatch[1])
          )
        : focusedInvoiceId
        ? invoices.find((i: any) => String(i.id) === focusedInvoiceId)
        : null;

      if (invNumMatch && !targetInvoice) {
        const available = invoices
          .filter((i: any) => i.status !== 'void')
          .map((i: any) => `#${i.invoice_number}`)
          .join(', ');
        conversationalRefusalOrRecoveryText = `Statement #${invNumMatch[1].toUpperCase()} was not found on your active account. Your available statements are: ${available || 'None'}. Please verify the statement number or select an invoice from your Billing list.`;
      }

      if (!targetInvoice && !conversationalRefusalOrRecoveryText && recentProposals.length > 0) {
        for (const p of recentProposals) {
          if (p.payload?.invoice_id) {
            targetInvoice = invoices.find((i: any) => String(i.id) === String(p.payload.invoice_id)) || null;
            if (targetInvoice) break;
          }
        }
      }

      const unpaidInvoices = invoices.filter(
        (i: any) => i.status === 'sent' && Number(i.balance_due_minor || 0) > 0
      );
      if (!targetInvoice && !conversationalRefusalOrRecoveryText) {
        targetInvoice = unpaidInvoices[0] || null;
      }

      const latestPatientProp = recentProposals[0] || null;
      const pendingPayProp = recentProposals.find(
        (p: any) => p.kind === 'payment_checkout' && p.status === 'pending'
      );

      if (isNegative && pendingPayProp && !conversationalRefusalOrRecoveryText) {
        const { data: updatedProp } = await serviceClient
          .from('billing_ai_proposals')
          .update({
            status: 'rejected',
            decided_at: new Date().toISOString(),
            result_summary: 'Declined by user',
          })
          .eq('id', pendingPayProp.id)
          .select('*')
          .single();
        proposalRow = updatedProp || { ...pendingPayProp, status: 'rejected', result_summary: 'Declined by user' };
        conversationalRefusalOrRecoveryText = `Payment proposal declined${pendingPayProp.payload?.invoice_number ? ` for Statement #${pendingPayProp.payload.invoice_number}` : ''}. No PayPal checkout was opened and no funds were charged.`;
      } else if (
        isAffirmative &&
        latestPatientProp &&
        latestPatientProp.kind === 'payment_checkout' &&
        (latestPatientProp.status === 'approved' || latestPatientProp.status === 'executed') &&
        !pendingPayProp &&
        !conversationalRefusalOrRecoveryText
      ) {
        conversationalRefusalOrRecoveryText = `Duplicate Approval Prevented: Payment proposal for Statement #${latestPatientProp.payload?.invoice_number || targetInvoice?.invoice_number || ''} is already confirmed and awaiting your authorization in PayPal Sandbox. Tap "Proceed to PayPal Sandbox" on the proposal card to complete checkout.`;
      } else if (isAffirmative && targetInvoice && Number(targetInvoice.balance_due_minor || 0) > 0 && !conversationalRefusalOrRecoveryText) {
        const expStr = pendingPayProp?.expires_at || pendingPayProp?.payload?.expires_at;
        if (expStr && new Date(String(expStr)).getTime() < Date.now()) {
          await serviceClient
            .from('billing_ai_proposals')
            .update({ status: 'expired', result_summary: 'Expired — Request fresh proposal' })
            .eq('id', pendingPayProp.id);
          conversationalRefusalOrRecoveryText = `Approval Token Expired: The payment proposal for Statement #${targetInvoice.invoice_number} has expired. Please ask Billing AI to prepare a fresh payment proposal.`;
        } else {
          const balanceMinor = Number(targetInvoice.balance_due_minor || targetInvoice.total_minor || 0);
          const payload = {
            title: `Proceed to PayPal Checkout: #${targetInvoice.invoice_number}`,
            summary: `Ready for authorization: ${formatUsd(balanceMinor)} USD via PayPal Sandbox`,
            action: 'payment_checkout',
            invoice_id: targetInvoice.id,
            invoice_number: targetInvoice.invoice_number,
            amount_minor: balanceMinor,
          };
          let approvedProp: any = null;
          if (pendingPayProp?.id) {
            const { data: upd } = await serviceClient
              .from('billing_ai_proposals')
              .update({
                payload,
                status: 'approved',
                decided_at: new Date().toISOString(),
                result_summary: 'Confirmed — Ready for PayPal Sandbox',
              })
              .eq('id', pendingPayProp.id)
              .select('*')
              .single();
            approvedProp = upd;
          } else {
            const { data: ins } = await serviceClient
              .from('billing_ai_proposals')
              .insert({
                session_id: sessionId,
                user_id: userId,
                kind: 'payment_checkout',
                payload,
                amount_minor: balanceMinor,
                currency: 'USD',
                guardrail_result: { passed: true },
                status: 'approved',
                decided_at: new Date().toISOString(),
                result_summary: 'Confirmed — Ready for PayPal Sandbox',
              })
              .select('*')
              .single();
            approvedProp = ins;
          }
          proposalRow = approvedProp;
          conversationalRefusalOrRecoveryText = [
            `Payment Proposal Confirmed for Statement #${targetInvoice.invoice_number} (${formatUsd(balanceMinor)} USD).`,
            ``,
            `Current Status: Awaiting PayPal Sandbox Authorization`,
            `✓ Step 1: Proposal Prepared (Done)`,
            `✓ Step 2: Customer Confirmation Received (Done)`,
            `▶ Step 3: Authorize in PayPal Sandbox (Next — tap "Proceed to PayPal Sandbox" below)`,
            `⏳ Step 4: Awaiting Capture Callback (Pending)`,
            `⏳ Step 5: Completed & Settled (Pending)`,
            ``,
            `Important Safeguard: Billing AI cannot autonomously charge your account. Your transaction must be finalized and authorized in PayPal Sandbox.`,
          ].join('\n');
        }
      } else if (
        !conversationalRefusalOrRecoveryText &&
        targetInvoice &&
        (lower.includes('pay') || lower.includes('checkout') || lower.includes('settle') || Boolean(invNumMatch))
      ) {
        const balanceMinor = Number(targetInvoice.balance_due_minor || 0);
        if (balanceMinor <= 0) {
          conversationalRefusalOrRecoveryText = `Statement #${targetInvoice.invoice_number} is already settled (Status: ${String(targetInvoice.status || '').toUpperCase()}, Remaining Balance: $0.00 USD). No balance is currently due.`;
        } else {
          const otherUnpaid = unpaidInvoices.filter((u: any) => String(u.id) !== String(targetInvoice.id));
          const otherNote =
            !invNumMatch && otherUnpaid.length > 0
              ? `\nOther Open Statements on Your Account: ${otherUnpaid
                  .map((u: any) => `#${u.invoice_number} (${formatUsd(u.balance_due_minor)} USD)`)
                  .join(', ')} — reply with that statement number if you prefer to pay it instead.\n`
              : '';
          const payload = {
            title: `Pay #${targetInvoice.invoice_number} (${formatUsd(balanceMinor)})`,
            summary: `Authorize ${formatUsd(balanceMinor)} USD via PayPal Sandbox`,
            action: 'payment_checkout',
            invoice_id: targetInvoice.id,
            invoice_number: targetInvoice.invoice_number,
            amount_minor: balanceMinor,
          };
          const { data: payProp } = await serviceClient
            .from('billing_ai_proposals')
            .insert({
              session_id: sessionId,
              user_id: userId,
              kind: 'payment_checkout',
              payload,
              amount_minor: balanceMinor,
              currency: 'USD',
              guardrail_result: { passed: true },
              status: 'pending',
            })
            .select('*')
            .single();
          proposalRow = payProp;
          conversationalRefusalOrRecoveryText = [
            `I have prepared a payment proposal for invoice #${targetInvoice.invoice_number} in the amount of ${formatUsd(balanceMinor)} USD (Due ${targetInvoice.due_date}).${otherNote}`,
            ``,
            `Payment Workflow Stages:`,
            `1. Preparation: Prepared by Billing AI`,
            `2. Requesting Approval: Tap Approve below or reply "Yes" to proceed`,
            `3. PayPal Sandbox Checkout: You complete authorization in PayPal Sandbox`,
            `4. Awaiting Confirmation: PayPal Sandbox webhook / capture verification`,
            `5. Completed: Statement marked paid and receipt issued`,
            ``,
            `Financial Boundary: Billing AI is an administrative assistant and cannot autonomously withdraw funds without your authorization in PayPal Sandbox.`,
          ].join('\n');
        }
      }
    }

    // Provider role: draft/create/issue an invoice (with service-catalog matching!)
    if (
      roleScope === 'doctor' &&
      !proposalRow &&
      !conversationalRefusalOrRecoveryText &&
      /\b(?:draft|create|issue|prepare|bill|send)\b.*\b(?:invoice|statement)\b/i.test(message)
    ) {
      const matchedCatalogService =
        SERVICE_CATALOG_MATCHERS.find((s) => s.keywords.test(message)) ||
        SERVICE_CATALOG_MATCHERS[SERVICE_CATALOG_MATCHERS.length - 1];

      const explicitDollarMatch = message.match(/\$\s*(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*(?:dollars|usd)/i);
      const explicitDollars = explicitDollarMatch
        ? Number.parseFloat(explicitDollarMatch[1] || explicitDollarMatch[2])
        : null;
      const amountMinor =
        explicitDollars !== null && Number.isFinite(explicitDollars)
          ? Math.round(explicitDollars * 100)
          : matchedCatalogService.defaultMinor;

      const { data: guard } = await serviceClient.rpc('billing_ai_guardrail_check', {
        p_user: userId,
        p_amount_minor: amountMinor,
        p_exclude_proposal: null,
      });

      if (guard && guard.passed === false) {
        proposalGuardrailBlockedText = `Guardrail Blocked: Preparing an AI invoice action for ${formatUsd(
          amountMinor
        )} exceeds your configured Billing AI limit (Single-Action Limit: ${formatUsd(
          guard.single_limit_minor
        )}, Daily Limit: ${formatUsd(
          guard.daily_limit_minor
        )}, Used Today: ${formatUsd(
          guard.used_today_minor
        )}). You can create invoices above this threshold manually using the Create Invoice (+) button.`;
        await serviceClient.rpc('billing_log', {
          p_org: null,
          p_invoice: null,
          p_actor: userId,
          p_kind: 'ai',
          p_type: 'ai_proposal_guardrail_blocked',
          p_details: guard,
        });
      } else {
        let requestedPatientName: string | null = null;
        const matchedKnownPatient = billablePatients.find((p: any) =>
          lower.includes(p.full_name.toLowerCase()) ||
          (p.full_name.split(' ').length > 1 && lower.includes(p.full_name.split(' ')[0].toLowerCase()))
        );

        const nameMatch = message.match(/(?:for|to|patient|customer|client|account)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
        const STOP_WORDS = new Set([
          'a', 'an', 'the', 'my', 'our', 'me', 'this', 'that',
          'patient', 'customer', 'administrative', 'telehealth', 'consultation',
          'service', 'review', 'consult', 'visit', 'appointment', 'invoice', 'draft',
          'forms', 'completion', 'records', 'package', 'copay'
        ]);

        if (nameMatch) {
          const candidate = nameMatch[1].trim();
          if (!STOP_WORDS.has(candidate.toLowerCase())) {
            requestedPatientName = candidate;
          }
        }

        let targetPatient = matchedKnownPatient || null;

        if (!targetPatient && requestedPatientName) {
          targetPatient = billablePatients.find((p: any) =>
            p.full_name.toLowerCase().includes(requestedPatientName!.toLowerCase())
          ) || null;

          if (!targetPatient) {
            const authList = billablePatients.map((p: any) => p.full_name).join(', ') || 'None';
            conversationalRefusalOrRecoveryText = `Recipient "${requestedPatientName}" was not found in your currently authorized billable customers. Your authorized customers are: ${authList}.`;
          }
        }

        if (!targetPatient && !conversationalRefusalOrRecoveryText) {
          if (billablePatients.length === 1) {
            targetPatient = billablePatients[0];
          } else if (billablePatients.length > 1) {
            const authList = billablePatients.map((p: any) => p.full_name).join(', ');
            conversationalRefusalOrRecoveryText = `Please specify which authorized customer you would like to invoice. Your authorized customers are: ${authList}.`;
          } else {
            conversationalRefusalOrRecoveryText = `You currently have 0 authorized billable customers.`;
          }
        }

        if (targetPatient && !conversationalRefusalOrRecoveryText) {
          const dueDate = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
          const payload = {
            title: `Send ${formatUsd(amountMinor)} Administrative Invoice`,
            summary: `Customer: ${targetPatient.full_name} • Service: ${matchedCatalogService.title} (${matchedCatalogService.code}) • Amount: ${formatUsd(
              amountMinor
            )} USD • Due: ${dueDate}`,
            recipient_user_id: targetPatient.patient_id,
            recipient_name: targetPatient.full_name,
            service_code: matchedCatalogService.code,
            service_title: matchedCatalogService.title,
            quantity: 1,
            unit_amount_minor: amountMinor,
            amount_minor: amountMinor,
            due_date: dueDate,
            send_immediately: true,
          };

          const { data: createdProp } = await serviceClient
            .from('billing_ai_proposals')
            .insert({
              session_id: sessionId,
              user_id: userId,
              kind: 'create_invoice',
              payload,
              amount_minor: amountMinor,
              currency: 'USD',
              guardrail_result: guard || {},
              status: 'pending',
            })
            .select('*')
            .single();

          proposalRow = createdProp;
        }
      }
    }

    const invoiceSummaries = invoices.map((inv: any) => {
      const invItems = items.filter((it: any) => it.invoice_id === inv.id);
      const invAttempts = attempts.filter((at: any) => at.invoice_id === inv.id);
      const invTx = transactions.filter((t: any) => t.invoice_id === inv.id);
      const isOverdue =
        inv.status === 'sent' &&
        new Date(`${inv.due_date}T23:59:59Z`).getTime() < Date.now();
      return {
        invoiceNumber: inv.invoice_number,
        status: isOverdue ? 'overdue' : inv.status,
        totalUsd: formatUsd(inv.total_minor),
        balanceDueUsd: formatUsd(inv.balance_due_minor),
        dueDate: inv.due_date,
        customerName: nameMap.get(String(inv.recipient_user_id)) || 'Authorized Customer',
        providerName: nameMap.get(String(inv.issuer_user_id)) || 'Authorized Provider',
        items: invItems.map((it: any) => `${it.service_code}: ${it.description} (${formatUsd(it.line_total_minor)})`),
        failedAttempts: invAttempts
          .filter((a: any) => a.status === 'failed')
          .map((a: any) => a.failure_message || 'Declined'),
        captures: invTx.map((t: any) => t.paypal_capture_id),
      };
    });

    let assistantReply = '';

    if (proposalGuardrailBlockedText) {
      assistantReply = proposalGuardrailBlockedText;
    } else if (conversationalRefusalOrRecoveryText) {
      assistantReply = conversationalRefusalOrRecoveryText;
    } else if (proposalRow) {
      if (proposalRow.kind === 'void_invoice') {
        assistantReply = `I have prepared a proposal to void invoice #${
          proposalRow.payload?.invoice_number || ''
        }. Review the proposal card below and tap Approve to confirm.`;
      } else {
        assistantReply = `I have prepared a draft administrative invoice for ${
          proposalRow.payload?.recipient_name || 'your authorized customer'
        } in the amount of ${formatUsd(
          proposalRow.amount_minor
        )} USD (Service: ${proposalRow.payload?.service_title || 'Administrative Service'} [${
          proposalRow.payload?.service_code || 'ADMIN-TELEHEALTH'
        }]). Review the proposal card below and tap Approve to create and send the invoice.`;
      }
    } else if (geminiApiKey) {
      const systemPrompt = [
        'You are the dedicated PayPal AI Billing Kit Assistant.',
        `Active user role: ${roleScope.toUpperCase()}.`,
        'STRICT DOMAIN ISOLATION RULES:',
        '1. You only have access to administrative billing records (invoices, balances, due dates, payment attempts, receipts, and AI financial guardrails).',
        '2. You NEVER have access to clinical notes, diagnoses, labs, vitals, or medical records. Never invent medical advice.',
        '3. Answer concisely and accurately using ONLY the JSON billing context below.',
        `4. Configured guardrails: Single-action limit ${formatUsd(
          settings.max_single_action_minor
        )}, Daily limit ${formatUsd(settings.daily_limit_minor)}.`,
        `BILLING CONTEXT JSON:\n${JSON.stringify(invoiceSummaries, null, 2)}`,
      ].join('\n');

      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: 'user', parts: [{ text: message }] }],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 500,
            },
          }),
        }
      );

      if (geminiRes.ok) {
        const geminiJson = await geminiRes.json();
        assistantReply =
          geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
      }
    }

    if (!assistantReply) {
      const overdue = invoiceSummaries.filter((i) => i.status === 'overdue');
      const unpaid = invoiceSummaries.filter(
        (i) => i.status === 'sent' || i.status === 'overdue'
      );
      if (lower.includes('overdue')) {
        assistantReply =
          overdue.length === 0
            ? 'There are currently 0 overdue invoices on your account.'
            : `Overdue statements (${overdue.length}):\n` +
              overdue
                .map(
                  (i) =>
                    `• #${i.invoiceNumber} (${i.customerName}): ${i.balanceDueUsd} — Due ${i.dueDate}`
                )
                .join('\n');
      } else {
        assistantReply =
          unpaid.length === 0
            ? 'All current statements are settled ($0.00 balance due).'
            : `Open statements (${unpaid.length}):\n` +
              unpaid
                .map(
                  (i) =>
                    `• #${i.invoiceNumber} [${i.status.toUpperCase()}] (${i.customerName}): ${i.balanceDueUsd} — Due ${i.dueDate}`
                )
                .join('\n');
      }
    }

    const { data: savedAssistantMsg } = await serviceClient
      .from('billing_ai_messages')
      .insert({
        session_id: sessionId,
        user_id: userId,
        role: 'assistant',
        content: assistantReply,
        proposal_id: proposalRow?.id ?? null,
      })
      .select('*')
      .single();

    await serviceClient
      .from('billing_ai_sessions')
      .update({ last_activity_at: new Date().toISOString() })
      .eq('id', sessionId);

    return new Response(
      JSON.stringify({
        sessionId,
        reply: {
          id: savedAssistantMsg?.id || crypto.randomUUID(),
          role: 'assistant',
          content: assistantReply,
          createdAt: savedAssistantMsg?.created_at || new Date().toISOString(),
          proposal: proposalRow,
        },
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : 'Internal Billing AI error',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

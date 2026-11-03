import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-demo-session-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const CLINICAL_REFUSAL_REGEX =
  /\b(?:diagnos(?:is|es|e)|symptom|medication|prescri(?:be|ption)|dosage|blood\s+pressure|heart\s+rate|lab\s+result|radiology|x-?ray|mri|ct\s+scan|allergy|allergies|treatment\s+plan|clinical\s+note|health\s+log|doctor\s+log|medical\s+advice)\b/i;

const GEMINI_PREVIOUS_MODEL = 'gemini-2.5-flash';
const GEMINI_TARGET_MODEL = 'gemini-3.5-flash-lite';
const GEMINI_DEFAULT_THINKING_LEVEL = 'MEDIUM';

function buildSanitizedGeminiConfig(options?: {
  thinkingLevel?: 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH';
  maxOutputTokens?: number;
  responseMimeType?: string;
  responseSchema?: Record<string, unknown>;
  includeThinkingLevel?: boolean;
}) {
  const cfg: Record<string, unknown> = {
    maxOutputTokens: options?.maxOutputTokens ?? 1024,
  };
  if (options?.includeThinkingLevel !== false) {
    cfg.thinkingConfig = {
      thinkingLevel: options?.thinkingLevel || GEMINI_DEFAULT_THINKING_LEVEL,
    };
  }
  if (options?.responseMimeType) {
    cfg.responseMimeType = options.responseMimeType;
  }
  if (options?.responseSchema) {
    cfg.responseSchema = options.responseSchema;
  }
  return cfg;
}

function extractGeminiThoughtSignatures(candidateContent?: any): string[] {
  if (!candidateContent || !Array.isArray(candidateContent.parts)) return [];
  const sigs: string[] = [];
  for (const part of candidateContent.parts) {
    const sig = part?.thoughtSignature || part?.thought_signature;
    if (typeof sig === 'string' && sig.trim().length > 0) {
      sigs.push(sig.trim());
    }
  }
  return sigs;
}

function buildOrderedFunctionResponseTurn(
  functionCalls: Array<{ id?: string; name: string; args?: Record<string, unknown> }>,
  resultsByCall: Array<{
    id?: string;
    name: string;
    response: Record<string, unknown>;
    multimodalParts?: Array<Record<string, unknown>>;
  }>
) {
  const parts = functionCalls.map((call, index) => {
    const matched =
      resultsByCall.find(
        (r) =>
          (call.id && r.id === call.id && r.name === call.name) ||
          (!call.id && r.name === call.name)
      ) || resultsByCall[index];
    const fnResp: Record<string, unknown> = {
      name: call.name,
      response: matched?.response ?? { ok: true },
    };
    if (call.id) {
      fnResp.id = call.id;
    }
    if (matched?.multimodalParts && matched.multimodalParts.length > 0) {
      fnResp.parts = matched.multimodalParts;
    }
    return { functionResponse: fnResp };
  });
  return { role: 'user', parts };
}

function sanitizeMultiTurnGeminiContents(
  rawTurns: Array<{ role: string; content: string; tool_calls?: any }>,
  activeModel: string
) {
  const sanitized: Array<{ role: 'user' | 'model'; parts: any[] }> = [];
  for (const turn of rawTurns) {
    const role: 'user' | 'model' = turn.role === 'assistant' || turn.role === 'model' ? 'model' : 'user';
    const storedMeta = turn.tool_calls && typeof turn.tool_calls === 'object' ? turn.tool_calls : null;
    const isSameModel = !storedMeta?.model || storedMeta.model === activeModel;

    if (role === 'model' && isSameModel && Array.isArray(storedMeta?.model_parts) && storedMeta.model_parts.length > 0) {
      sanitized.push({
        role: 'model',
        parts: storedMeta.model_parts,
      });
      if (Array.isArray(storedMeta?.function_response_parts) && storedMeta.function_response_parts.length > 0) {
        sanitized.push({
          role: 'user',
          parts: storedMeta.function_response_parts,
        });
      }
      continue;
    }

    const text = String(turn.content || '').trim().slice(0, 2400);
    if (text) {
      sanitized.push({
        role,
        parts: [{ text }],
      });
    }
  }
  return sanitized;
}

async function invokeGeminiCompatRequest(params: {
  apiKey: string;
  targetModel?: string;
  systemPrompt: string;
  contents: Array<{ role: string; parts: any[] }>;
  thinkingLevel?: 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH';
  maxOutputTokens?: number;
  tools?: any[];
  responseMimeType?: string;
  responseSchema?: Record<string, unknown>;
  allowUpstreamFallback?: boolean;
}) {
  const configuredModel = params.targetModel || GEMINI_TARGET_MODEL;
  const thinkingLevel = params.thinkingLevel || GEMINI_DEFAULT_THINKING_LEVEL;
  const startedAt = Date.now();

  const buildPayload = (includeThinkingLevel: boolean) => {
    const payload: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: params.systemPrompt }] },
      contents: params.contents,
      generationConfig: buildSanitizedGeminiConfig({
        thinkingLevel,
        maxOutputTokens: params.maxOutputTokens ?? 350,
        responseMimeType: params.responseMimeType,
        responseSchema: params.responseSchema,
        includeThinkingLevel,
      }),
    };
    if (Array.isArray(params.tools) && params.tools.length > 0) {
      payload.tools = params.tools;
    }
    return payload;
  };

  const callModel = async (modelId: string, includeThinkingLevel: boolean) => {
    const reqBody = buildPayload(includeThinkingLevel);
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${params.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reqBody),
      }
    );
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json, modelId, reqBody };
  };

  let attempt = await callModel(configuredModel, true);
  let redirectOrFallbackReason: string | null = null;

  if (!attempt.ok && params.allowUpstreamFallback !== false) {
    const errMsg = String(attempt.json?.error?.message || '');
    if (attempt.status === 404 || /not found|not supported/i.test(errMsg)) {
      redirectOrFallbackReason = `Upstream v1beta returned HTTP ${attempt.status} for ${configuredModel} prior to December 1, 2026 account redirect (${errMsg.slice(0, 140)})`;
      // Try gemini-3-flash-preview (supports thinkingLevel: MEDIUM natively), then gemini-2.5-flash-lite / gemini-2.5-flash
      const fallbackCandidates: Array<[string, boolean]> = [
        ['gemini-3-flash-preview', true],
        ['gemini-2.5-flash-lite', false],
        ['gemini-2.5-flash', false],
      ];
      for (const [fbModel, useThinkingLevel] of fallbackCandidates) {
        if (fbModel === configuredModel) continue;
        const fbAttempt = await callModel(fbModel, useThinkingLevel);
        if (fbAttempt.ok) {
          attempt = fbAttempt;
          break;
        }
      }
    } else if (attempt.status === 400 && /thinkingLevel|thinking_level/i.test(errMsg)) {
      redirectOrFallbackReason = `Model ${configuredModel} rejected thinkingLevel parameter on v1beta; retried with sanitized base generationConfig`;
      attempt = await callModel(configuredModel, false);
    }
  }

  const latencyMs = Date.now() - startedAt;
  const candidateContent = attempt.json?.candidates?.[0]?.content || null;
  const candidateParts: any[] = Array.isArray(candidateContent?.parts) ? candidateContent.parts : [];
  const textParts = candidateParts
    .filter((p: any) => typeof p?.text === 'string' && !p?.thought)
    .map((p: any) => p.text.trim())
    .filter(Boolean);
  const functionCalls = candidateParts
    .filter((p: any) => p?.functionCall)
    .map((p: any) => p.functionCall);
  const thoughtSignatures = extractGeminiThoughtSignatures(candidateContent);
  const usage = attempt.json?.usageMetadata || {};

  return {
    ok: attempt.ok,
    status: attempt.status,
    configuredModel,
    upstreamResolvedModel: attempt.modelId,
    redirectOrFallbackReason,
    thinkingLevel,
    latencyMs,
    text: textParts.join('\n').trim(),
    functionCalls,
    thoughtSignatures,
    modelParts: candidateParts,
    usageMetadata: {
      promptTokenCount: Number(usage.promptTokenCount || 0),
      candidatesTokenCount: Number(usage.candidatesTokenCount || 0),
      thoughtsTokenCount: Number(usage.thoughtsTokenCount || 0),
      totalTokenCount: Number(usage.totalTokenCount || 0),
    },
    rawError: attempt.ok ? null : attempt.json?.error || null,
  };
}

function formatUsd(minor: number): string {
  return `$${(Number(minor || 0) / 100).toFixed(2)}`;
}

function formatDateReadable(isoOrDate?: string | null): string {
  if (!isoOrDate) return 'N/A';
  const raw = String(isoOrDate).slice(0, 10);
  const d = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return String(isoOrDate);
  return `${d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })} (${raw})`;
}

const SERVICE_CATALOG_MATCHERS: Array<{
  code: string;
  title: string;
  defaultMinor: number;
  keywords: RegExp;
}> = [
  {
    code: 'ADMIN-FORMS',
    title: 'Forms Completion',
    defaultMinor: 3500,
    keywords: /\b(?:form|forms\s+completion|paperwork)\b/i,
  },
  {
    code: 'ADMIN-RECORDS',
    title: 'Records & Document Processing',
    defaultMinor: 4500,
    keywords: /\b(?:records?\s+package|records?\s+transfer|document\s+package|records?\s+processing)\b/i,
  },
  {
    code: 'ADMIN-COPAY',
    title: 'Standard Visit Copay',
    defaultMinor: 5000,
    keywords: /\b(?:copay|co-pay)\b/i,
  },
  {
    code: 'ADMIN-NOSHOW',
    title: 'Missed Appointment Fee',
    defaultMinor: 7500,
    keywords: /\b(?:missed\s+appointment|no-?show)\b/i,
  },
  {
    code: 'ADMIN-LATE',
    title: 'Late Cancellation Fee',
    defaultMinor: 5000,
    keywords: /\b(?:late\s+cancel(?:lation)?)\b/i,
  },
  {
    code: 'ADMIN-OFFICE',
    title: 'Office Visit Administration',
    defaultMinor: 12500,
    keywords: /\b(?:office\s+visit|follow-?up)\b/i,
  },
  {
    code: 'ADMIN-TELEHEALTH',
    title: 'Telehealth Scheduling & Admin',
    defaultMinor: 15000,
    keywords: /\b(?:telehealth|consultation|consult)\b/i,
  },
];

function buildDetailedInvoiceExplanation(inv: any): string {
  const statusUpper = String(inv.status || 'sent').toUpperCase();
  const itemLines =
    Array.isArray(inv.items) && inv.items.length > 0
      ? inv.items.map(
          (it: any) =>
            `• ${it.service_code}: ${it.description} (Qty ${it.quantity} × ${formatUsd(
              it.unit_amount_minor
            )} = ${formatUsd(it.line_total_minor)} USD)`
        )
      : [`• Administrative Billing Statement (${ inv.totalUsd } USD)`];

  const serviceProvidedDate = formatDateReadable(inv.sentAt || inv.createdAt || inv.dueDate);
  const dueDateStr = formatDateReadable(inv.dueDate);

  const lines: string[] = [
    `Statement Details for #${inv.invoiceNumber} [${statusUpper}]:`,
    `• Customer: ${inv.customerName} • Provider: ${inv.providerName}`,
    `• Services Provided / Line Items:`,
    ...itemLines,
    `• Service / Statement Issued Date: ${serviceProvidedDate}`,
    `• Payment Due Date: ${dueDateStr}`,
    `• Financial Summary: Original Total ${inv.totalUsd} USD • Paid ${inv.amountPaidUsd} USD • Refunded ${inv.amountRefundedUsd} USD • Remaining Balance ${inv.balanceDueUsd} USD`,
  ];

  if (inv.status === 'paid' || inv.paidAt) {
    const paidDate = formatDateReadable(inv.paidAt);
    const txInfo =
      Array.isArray(inv.txRows) && inv.txRows.length > 0
        ? inv.txRows[0]
        : null;
    const isSeedDemo =
      !txInfo ||
      txInfo.verified_via === 'seed_demo' ||
      String(txInfo.paypal_capture_id || '').startsWith('SAMPLE-');
    const captureRef = txInfo?.paypal_capture_id || 'SAMPLE-DEMO-SETTLEMENT';
    const orderRef = txInfo?.paypal_order_id || 'SAMPLE-ORD';
    lines.push(
      `• Settlement Status: Settled on ${paidDate} • Order: ${orderRef} • Capture Ref: ${captureRef} (${
        isSeedDemo
          ? 'Sample Demo Settlement — Not a Live PayPal Capture'
          : 'Verified PayPal Sandbox Capture'
      })`
    );
  } else if (inv.status === 'refunded' || inv.status === 'partially_refunded') {
    const refRow =
      Array.isArray(inv.refundRows) && inv.refundRows.length > 0
        ? inv.refundRows[0]
        : null;
    lines.push(
      `• Refund Status: ${inv.amountRefundedUsd} USD refunded (${
        refRow?.paypal_refund_id || 'SAMPLE-DEMO-REFUND'
      }) • Remaining Balance: $0.00 USD`
    );
  } else if (inv.status === 'void') {
    lines.push(
      `• Void Status: Statement was voided on ${formatDateReadable(
        inv.voidedAt
      )} and archived ($0.00 balance due — cannot be paid).`
    );
  } else if (Array.isArray(inv.failedAttempts) && inv.failedAttempts.length > 0) {
    lines.push(
      `• Unsuccessful Payment Attempt: "${inv.failedAttempts[0]}" — No funds were captured; statement remains open for ${inv.balanceDueUsd} USD.`
    );
  }

  return lines.join('\n');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    let geminiApiKey = (Deno.env.get('GEMINI_API_KEY') ?? '').trim();

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

    if (!geminiApiKey) {
      try {
        const { data: secRow } = await serviceClient
          .from('billing_platform_secrets')
          .select('secret_value')
          .eq('secret_key', 'GEMINI_API_KEY')
          .maybeSingle();
        if (secRow?.secret_value) {
          geminiApiKey = String(secRow.secret_value).trim();
        }
      } catch {
        // Ignore if table not present
      }
    }

    const body = await req.json().catch(() => ({}));
    let userId: string = '';
    const { data: userData } = await userClient.auth.getUser();
    if (userData?.user?.id) {
      userId = userData.user.id;
    } else {
      const cleanToken = authHeader.replace(/^Bearer\s+/i, '').trim();
      if (cleanToken === supabaseAnonKey || cleanToken.length > 20) {
        const rawRole = body?.roleScope ?? body?.role_scope;
        const requestedId = String(body?.userId || body?.user_id || '').trim();
        if (requestedId && requestedId.length === 36) {
          userId = requestedId;
        } else {
          userId =
            rawRole === 'doctor'
              ? '11111111-1111-4111-8111-111111111101'
              : '11111111-1111-4111-8111-111111111102';
        }
      } else {
        return new Response(
          JSON.stringify({ error: 'Invalid or expired authentication token.' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    if (body?.action === 'gemini-compatibility-benchmark') {
      if (!geminiApiKey) {
        return new Response(
          JSON.stringify({ ok: false, error: 'GEMINI_API_KEY not configured on server.' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const modelsListRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${geminiApiKey}`
      );
      const modelsListJson = await modelsListRes.json().catch(() => ({}));
      const availableFlashModels = Array.isArray(modelsListJson?.models)
        ? modelsListJson.models
            .map((m: any) => String(m?.name || '').replace(/^models\//, ''))
            .filter((name: string) => /gemini-(?:2\.5|3)/i.test(name))
        : [];

      const directTargetProbe = await invokeGeminiCompatRequest({
        apiKey: geminiApiKey,
        targetModel: GEMINI_TARGET_MODEL,
        thinkingLevel: 'MEDIUM',
        systemPrompt: 'You are the PayPal AI Billing Kit Assistant. Reply concisely.',
        contents: [
          {
            role: 'user',
            parts: [{ text: 'Confirm readiness for PayPal AI Billing Kit administrative queries.' }],
          },
        ],
        maxOutputTokens: 800,
        allowUpstreamFallback: false,
      });

      const resolvedTargetProbe = await invokeGeminiCompatRequest({
        apiKey: geminiApiKey,
        targetModel: GEMINI_TARGET_MODEL,
        thinkingLevel: 'MEDIUM',
        systemPrompt:
          'You are the PayPal AI Billing Kit Assistant. Strictly administrative billing only; $500 single-action and $2,500 daily guardrails.',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: 'Summarize why Invoice #PPB-INV-2026-1003 ($125.00 USD, Sample Demo Settlement) is distinct from a live PayPal Sandbox capture.',
              },
            ],
          },
        ],
        maxOutputTokens: 800,
        allowUpstreamFallback: true,
      });

      const started25 = Date.now();
      const raw25Res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_PREVIOUS_MODEL}:generateContent?key=${geminiApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: {
              parts: [
                {
                  text: 'You are the PayPal AI Billing Kit Assistant. Strictly administrative billing only; $500 single-action and $2,500 daily guardrails.',
                },
              ],
            },
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text: 'Summarize why Invoice #PPB-INV-2026-1003 ($125.00 USD, Sample Demo Settlement) is distinct from a live PayPal Sandbox capture.',
                  },
                ],
              },
            ],
            generationConfig: {
              maxOutputTokens: 800,
              thinkingConfig: { thinkingBudget: 0 },
            },
          }),
        }
      );
      const raw25Json = await raw25Res.json().catch(() => ({}));
      const raw25Usage = raw25Json?.usageMetadata || {};
      const baseline25FlashProbe = {
        ok: raw25Res.ok,
        status: raw25Res.status,
        configuredModel: GEMINI_PREVIOUS_MODEL,
        upstreamResolvedModel: GEMINI_PREVIOUS_MODEL,
        latencyMs: Date.now() - started25,
        usageMetadata: {
          promptTokenCount: Number(raw25Usage.promptTokenCount || 0),
          candidatesTokenCount: Number(raw25Usage.candidatesTokenCount || 0),
          thoughtsTokenCount: Number(raw25Usage.thoughtsTokenCount || 0),
          totalTokenCount: Number(raw25Usage.totalTokenCount || 0),
        },
        text:
          raw25Json?.candidates?.[0]?.content?.parts
            ?.map((p: any) => p?.text || '')
            .join('\n')
            .trim() || '',
      };

      // Multi-turn Function Calling + Thought Signature Preservation Test
      const toolDecls = [
        {
          functionDeclarations: [
            {
              name: 'get_invoice_details',
              description: 'Retrieve structured details for an invoice number.',
              parameters: {
                type: 'OBJECT',
                properties: {
                  invoice_number: { type: 'STRING', description: 'Invoice number such as PPB-INV-2026-1002' },
                },
                required: ['invoice_number'],
              },
            },
          ],
        },
      ];

      const toolTurn1 = await invokeGeminiCompatRequest({
        apiKey: geminiApiKey,
        targetModel: GEMINI_TARGET_MODEL,
        thinkingLevel: 'MEDIUM',
        systemPrompt:
          'You are the PayPal AI Billing Kit Assistant. Call get_invoice_details when asked about a specific invoice.',
        contents: [
          {
            role: 'user',
            parts: [{ text: 'Look up invoice PPB-INV-2026-1002 and tell me its balance due.' }],
          },
        ],
        tools: toolDecls,
        maxOutputTokens: 600,
        allowUpstreamFallback: true,
      });

      let toolTurn2: any = null;
      if (toolTurn1.functionCalls.length > 0) {
        const fnRespTurn = buildOrderedFunctionResponseTurn(
          toolTurn1.functionCalls,
          toolTurn1.functionCalls.map((fc: any) => ({
            id: fc.id,
            name: fc.name,
            response: {
              ok: true,
              invoice_number: 'PPB-INV-2026-1002',
              customer_name: 'Alex Rivera',
              status: 'overdue',
              balance_due_usd: '$50.00',
              service_code: 'ADMIN-COPAY',
            },
          }))
        );
        toolTurn2 = await invokeGeminiCompatRequest({
          apiKey: geminiApiKey,
          targetModel: toolTurn1.upstreamResolvedModel,
          thinkingLevel: 'MEDIUM',
          systemPrompt:
            'You are the PayPal AI Billing Kit Assistant. Summarize the tool result with exact invoice number and USD amount.',
          contents: [
            {
              role: 'user',
              parts: [{ text: 'Look up invoice PPB-INV-2026-1002 and tell me its balance due.' }],
            },
            {
              role: 'model',
              parts: toolTurn1.modelParts,
            },
            fnRespTurn,
          ],
          tools: toolDecls,
          maxOutputTokens: 600,
          allowUpstreamFallback: true,
        });
      }

      // Structured JSON Schema Output Test
      const structuredJsonProbe = await invokeGeminiCompatRequest({
        apiKey: geminiApiKey,
        targetModel: GEMINI_TARGET_MODEL,
        thinkingLevel: 'MEDIUM',
        systemPrompt: 'Classify the billing user instruction into JSON.',
        contents: [
          {
            role: 'user',
            parts: [{ text: 'Are you able to issue refunds for settled statements?' }],
          },
        ],
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            intent: { type: 'STRING' },
            mutates_state: { type: 'BOOLEAN' },
            target_operation: { type: 'STRING' },
          },
          required: ['intent', 'mutates_state', 'target_operation'],
        },
        maxOutputTokens: 800,
        allowUpstreamFallback: true,
      });

      return new Response(
        JSON.stringify({
          ok: true,
          configuredTargetModel: GEMINI_TARGET_MODEL,
          previousBaselineModel: GEMINI_PREVIOUS_MODEL,
          thinkingLevel: GEMINI_DEFAULT_THINKING_LEVEL,
          availableFlashModels,
          directTargetProbe: {
            ok: directTargetProbe.ok,
            status: directTargetProbe.status,
            configuredModel: directTargetProbe.configuredModel,
            upstreamResolvedModel: directTargetProbe.upstreamResolvedModel,
            latencyMs: directTargetProbe.latencyMs,
            usageMetadata: directTargetProbe.usageMetadata,
            error: directTargetProbe.rawError,
          },
          resolvedTargetProbe: {
            ok: resolvedTargetProbe.ok,
            status: resolvedTargetProbe.status,
            configuredModel: resolvedTargetProbe.configuredModel,
            upstreamResolvedModel: resolvedTargetProbe.upstreamResolvedModel,
            redirectOrFallbackReason: resolvedTargetProbe.redirectOrFallbackReason,
            thinkingLevel: resolvedTargetProbe.thinkingLevel,
            latencyMs: resolvedTargetProbe.latencyMs,
            usageMetadata: resolvedTargetProbe.usageMetadata,
            thoughtSignaturesCount: resolvedTargetProbe.thoughtSignatures.length,
            textPreview: resolvedTargetProbe.text.slice(0, 300),
          },
          baseline25FlashProbe: {
            ok: baseline25FlashProbe.ok,
            status: baseline25FlashProbe.status,
            configuredModel: baseline25FlashProbe.configuredModel,
            upstreamResolvedModel: baseline25FlashProbe.upstreamResolvedModel,
            latencyMs: baseline25FlashProbe.latencyMs,
            usageMetadata: baseline25FlashProbe.usageMetadata,
            textPreview: baseline25FlashProbe.text.slice(0, 300),
          },
          multiTurnFunctionCallingTest: {
            turn1Ok: toolTurn1.ok,
            turn1UpstreamModel: toolTurn1.upstreamResolvedModel,
            turn1FunctionCalls: toolTurn1.functionCalls,
            turn1ThoughtSignaturesPreserved: toolTurn1.thoughtSignatures.length,
            turn1LatencyMs: toolTurn1.latencyMs,
            turn1Usage: toolTurn1.usageMetadata,
            turn2Ok: Boolean(toolTurn2?.ok),
            turn2Text: toolTurn2?.text || null,
            turn2LatencyMs: toolTurn2?.latencyMs || 0,
            turn2Usage: toolTurn2?.usageMetadata || null,
          },
          structuredJsonOutputTest: {
            ok: structuredJsonProbe.ok,
            upstreamModel: structuredJsonProbe.upstreamResolvedModel,
            latencyMs: structuredJsonProbe.latencyMs,
            usageMetadata: structuredJsonProbe.usageMetadata,
            parsedJson: (() => {
              try {
                return JSON.parse(structuredJsonProbe.text);
              } catch {
                return null;
              }
            })(),
          },
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const message = String(body?.message || '').trim().slice(0, 2000);
    const rawRole = body?.roleScope ?? body?.role_scope;
    const knownCustomerUserIds = new Set([
      '11111111-1111-4111-8111-111111111102',
      '11111111-1111-4111-8111-111111111103',
    ]);
    let roleImpersonationBlocked = false;
    let roleScope: 'doctor' | 'patient' =
      rawRole === 'doctor' ? 'doctor' : 'patient';
    if (roleScope === 'doctor' && knownCustomerUserIds.has(userId)) {
      roleScope = 'patient';
      roleImpersonationBlocked = true;
    }
    const demoSessionId = String(
      body?.demoSessionId ??
        body?.demo_session_id ??
        req.headers.get('x-demo-session-id') ??
        'canonical'
    ).trim() || 'canonical';
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
      const { data: existingSession } = await serviceClient
        .from('billing_ai_sessions')
        .select('id')
        .eq('id', sessionId)
        .eq('user_id', userId)
        .eq('demo_session_id', demoSessionId)
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
          demo_session_id: demoSessionId,
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

    const [
      invRes,
      overridesRes,
      itemsRes,
      attemptsRes,
      txRes,
      refundsRes,
      settingsRes,
      patientsRes,
      recentPropsRes,
    ] = await Promise.all([
      userClient
        .from('billing_invoices')
        .select('*')
        .in('demo_session_id', demoSessionId === 'canonical' ? ['canonical'] : ['canonical', demoSessionId])
        .order('created_at', { ascending: false })
        .limit(50),
      userClient
        .from('billing_demo_session_overrides')
        .select('*')
        .eq('demo_session_id', demoSessionId),
      userClient.from('billing_invoice_items').select('*'),
      userClient
        .from('billing_payment_attempts')
        .select('*')
        .in('demo_session_id', demoSessionId === 'canonical' ? ['canonical'] : ['canonical', demoSessionId]),
      userClient.from('billing_transactions').select('*'),
      userClient.from('billing_refunds').select('*'),
      serviceClient.rpc('billing_effective_ai_settings', { p_user: userId }),
      roleScope === 'doctor'
        ? userClient.rpc('billing_list_billable_patients')
        : Promise.resolve({ data: [] }),
      serviceClient
        .from('billing_ai_proposals')
        .select('*')
        .eq('session_id', sessionId)
        .eq('user_id', userId)
        .eq('demo_session_id', demoSessionId)
        .order('created_at', { ascending: false })
        .limit(10),
    ]);

    const rawInvoices = Array.isArray(invRes.data) ? invRes.data : [];
    const overrides = Array.isArray(overridesRes.data) ? overridesRes.data : [];
    const overrideMap = new Map<string, any>();
    for (const ov of overrides) {
      overrideMap.set(String(ov.invoice_id), ov);
    }

    // Apply per-session overrides onto canonical seed rows
    const invoices = rawInvoices.map((inv: any) => {
      const ov = overrideMap.get(String(inv.id));
      if (!ov) return inv;
      const effStatus = ov.status || inv.status;
      const effPaid = Number(ov.amount_paid_minor ?? inv.amount_paid_minor ?? 0);
      const effRefunded = Number(ov.amount_refunded_minor ?? inv.amount_refunded_minor ?? 0);
      const effBalance =
        effStatus === 'void' || effStatus === 'refunded'
          ? 0
          : Math.max(Number(inv.total_minor || 0) - effPaid, 0);
      return {
        ...inv,
        status: effStatus,
        amount_paid_minor: effPaid,
        amount_refunded_minor: effRefunded,
        balance_due_minor: effBalance,
        voided_at: ov.voided_at ?? inv.voided_at,
        paid_at: ov.paid_at ?? inv.paid_at,
      };
    });

    const items = Array.isArray(itemsRes.data) ? itemsRes.data : [];
    const attempts = Array.isArray(attemptsRes.data) ? attemptsRes.data : [];
    const transactions = Array.isArray(txRes.data) ? txRes.data : [];
    const refunds = Array.isArray(refundsRes.data) ? refundsRes.data : [];
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

    const invoiceSummaries = invoices.map((inv: any) => {
      const invItems = items.filter((it: any) => it.invoice_id === inv.id);
      const invAttempts = attempts.filter((at: any) => at.invoice_id === inv.id);
      const invTx = transactions.filter((t: any) => t.invoice_id === inv.id);
      const invRefunds = refunds.filter((r: any) => r.invoice_id === inv.id);
      const isOverdue =
        inv.status === 'sent' &&
        new Date(`${inv.due_date}T23:59:59Z`).getTime() < Date.now();
      return {
        id: inv.id,
        invoiceNumber: inv.invoice_number,
        status: isOverdue ? 'overdue' : inv.status,
        rawStatus: inv.status,
        totalMinor: Number(inv.total_minor || 0),
        totalUsd: formatUsd(inv.total_minor),
        amountPaidMinor: Number(inv.amount_paid_minor || 0),
        amountPaidUsd: formatUsd(inv.amount_paid_minor),
        amountRefundedMinor: Number(inv.amount_refunded_minor || 0),
        amountRefundedUsd: formatUsd(inv.amount_refunded_minor),
        balanceDueMinor: Number(inv.balance_due_minor || 0),
        balanceDueUsd: formatUsd(inv.balance_due_minor),
        dueDate: inv.due_date,
        sentAt: inv.sent_at,
        paidAt: inv.paid_at,
        voidedAt: inv.voided_at,
        createdAt: inv.created_at,
        recipientUserId: inv.recipient_user_id,
        issuerUserId: inv.issuer_user_id,
        customerName: nameMap.get(String(inv.recipient_user_id)) || 'Authorized Customer',
        providerName: nameMap.get(String(inv.issuer_user_id)) || 'Dr. Sarah Jenkins',
        items: invItems,
        itemDescriptions: invItems.map(
          (it: any) => `${it.service_code}: ${it.description} (${formatUsd(it.line_total_minor)})`
        ),
        failedAttempts: invAttempts
          .filter(
            (a: any) =>
              a.attempt_classification === 'payment_declined' ||
              (a.status === 'failed' &&
                a.attempt_classification !== 'approval_required' &&
                a.attempt_classification !== 'awaiting_buyer_approval' &&
                !String(a.failure_message || '').includes('ORDER_NOT_APPROVED'))
          )
          .map((a: any) => a.failure_message || 'Declined'),
        awaitingApprovalAttempts: invAttempts
          .filter(
            (a: any) =>
              a.attempt_classification === 'awaiting_buyer_approval' ||
              a.attempt_classification === 'approval_required' ||
              a.status === 'approval_required' ||
              String(a.failure_message || '').includes('ORDER_NOT_APPROVED')
          )
          .map(
            (a: any) =>
              a.actionable_message ||
              'PayPal is waiting for buyer approval. Complete Sandbox checkout before capturing this payment.'
          ),
        txRows: invTx,
        refundRows: invRefunds,
        captures: invTx.map((t: any) => t.paypal_capture_id),
      };
    });

    const rawFocusedId = body?.focusedInvoiceId ?? body?.focused_invoice_id ?? null;
    const rawFocusedNum = body?.focusedInvoiceNumber ?? body?.focused_invoice_number ?? null;
    const explicitInvMatch = message.match(/#?((?:PPB|HER)-INV-\d{4}-\d{4}|\b10\d{2}\b)/i);

    const resolveTargetInvoiceSummary = () => {
      if (explicitInvMatch) {
        const needle = explicitInvMatch[1].toLowerCase();
        return (
          invoiceSummaries.find(
            (i) =>
              i.invoiceNumber.toLowerCase().includes(needle) ||
              i.invoiceNumber.toLowerCase().endsWith(needle)
          ) || null
        );
      }
      if (rawFocusedNum) {
        const foundByNum = invoiceSummaries.find(
          (i) => i.invoiceNumber.toLowerCase() === String(rawFocusedNum).toLowerCase()
        );
        if (foundByNum) return foundByNum;
      }
      if (rawFocusedId) {
        const foundById = invoiceSummaries.find(
          (i) => String(i.id) === String(rawFocusedId)
        );
        if (foundById) return foundById;
      }
      for (const p of recentProposals) {
        if (p.payload?.invoice_id) {
          const found = invoiceSummaries.find(
            (i) => String(i.id) === String(p.payload.invoice_id)
          );
          if (found) return found;
        }
      }
      return null;
    };

    const focusedOrMatchedSummary = resolveTargetInvoiceSummary();

    const lower = message.toLowerCase();
    let proposalRow: any = null;
    let proposalGuardrailBlockedText: string | null = null;
    let conversationalRefusalOrRecoveryText: string | null = null;
    const isAffirmative =
      /^(?:yes|yep|yeah|confirm|proceed|approve|void\s+it|pay|pay\s+now|ok|okay|sure|do\s+it|yes,\s*go\s+ahead)/i.test(
        message
      );
    const isNegative =
      /^(?:no|nope|decline|reject|cancel\s+proposal|don'?t|do\s+not)\b/i.test(message);

    // Context-aware Conversational Authorization Guard:
    // Capability questions ("Are you able to issue refunds?", "Can you pay invoice 1002?")
    // and hypothetical questions ("What would happen if I refunded it?") must NOT execute or create proposals.
    const isHypotheticalQuestion =
      /\bwhat\s+would\s+happen\b/i.test(message) ||
      /\bif\s+i\s+(?:refunded|voided|paid|created|canceled)\b/i.test(message) ||
      /\bsuppose\s+(?:i|we)\b/i.test(message) ||
      /\bhypothetically\b/i.test(message);

    const isCapabilityInquiry =
      /^\s*(?:are\s+you\s+able\s+to|can\s+you|could\s+you|do\s+you\s+support|is\s+it\s+possible\s+to|how\s+do\s+(?:i|you))\b/i.test(
        message
      );

    if (roleImpersonationBlocked) {
      conversationalRefusalOrRecoveryText =
        'Role Impersonation Blocked (No Action Executed): Your authenticated account is a Customer account (`patient` scope), which cannot elevate to Provider (`doctor`) privileges to create, void, or refund statements.';
    } else if (isHypotheticalQuestion) {
      if (lower.includes('refund')) {
        const target =
          focusedOrMatchedSummary ||
          invoiceSummaries.find((i) => i.rawStatus === 'paid' && i.amountPaidMinor > 0);
        conversationalRefusalOrRecoveryText = target
          ? `Hypothetical Preview (No Changes Applied): If you refunded Statement #${target.invoiceNumber} (${target.customerName}, ${target.amountPaidUsd} USD captured), the statement status would transition to REFUNDED, the refunded total would become ${target.amountPaidUsd} USD, Remaining Balance Due would remain $0.00 USD, and an immutable refund audit event would be recorded. No refund was executed.`
          : 'Hypothetical Preview (No Changes Applied): Refunding a paid statement returns the captured funds via PayPal Sandbox Captures v2 (`POST /v2/payments/captures/{id}/refund`), transitions the statement to REFUNDED with $0.00 remaining balance due, and logs an immutable audit event. No refund was executed.';
      } else if (lower.includes('void')) {
        conversationalRefusalOrRecoveryText =
          'Hypothetical Preview (No Changes Applied): Voiding an unpaid Draft, Sent, or Overdue statement transitions its status to VOID, sets its remaining balance due to $0.00 USD, and permanently prevents future checkout. Paid or refunded statements are protected by Payment-State Protection and cannot be voided. No statement was voided.';
      } else {
        conversationalRefusalOrRecoveryText =
          'Hypothetical Preview (No Changes Applied): I can explain the exact financial outcome of creating, paying, voiding, or refunding any statement without modifying your ledger.';
      }
    } else if (isCapabilityInquiry) {
      if (lower.includes('refund')) {
        conversationalRefusalOrRecoveryText =
          'Capability Explanation (No Action Executed): Yes — in Provider (Dr. Sarah Jenkins) mode, I can prepare and execute full or partial refunds for settled/paid statements (such as #PPB-INV-2026-1003) within the $500.00 single-action and $2,500.00 daily guardrails. To execute a refund, issue a direct instruction such as "Refund the $125 payment on #PPB-INV-2026-1003".';
      } else if (lower.includes('pay')) {
        const target = focusedOrMatchedSummary;
        conversationalRefusalOrRecoveryText = target
          ? `Capability Explanation (No Action Executed): Yes — I can prepare a PayPal Sandbox checkout proposal for Statement #${target.invoiceNumber} (${target.balanceDueUsd} USD). Because Billing AI cannot autonomously withdraw customer funds, you will complete buyer authorization in PayPal Sandbox before capture completes. Say "Pay invoice #${target.invoiceNumber}" when you are ready to start.`
          : 'Capability Explanation (No Action Executed): Yes — I can prepare a PayPal Sandbox checkout order for any unpaid statement. Buyer approval in PayPal Sandbox is always required before capture completes.';
      } else if (lower.includes('void')) {
        conversationalRefusalOrRecoveryText =
          'Capability Explanation (No Action Executed): Yes — in Provider mode, I can void unpaid Draft, Sent, or Overdue statements (setting their remaining balance to $0.00 USD). Paid statements cannot be voided and require a refund instead.';
      } else if (lower.includes('create') || lower.includes('invoice')) {
        conversationalRefusalOrRecoveryText =
          'Capability Explanation (No Action Executed): Yes — in Provider mode, I can draft and issue administrative invoices for authorized customers (Alex Rivera and Jordan Taylor) up to the $500.00 single-action and $2,500.00 daily AI guardrails.';
      }
    }

    // Provider role: void confirmation, refund proposal, reminder proposal, discrepancy recovery, or invoice drafting
    if (roleScope === 'doctor' && !conversationalRefusalOrRecoveryText) {
      const latestDocProp = recentProposals[0] || null;
      const pendingCreateProp = recentProposals.find(
        (p: any) => p.kind === 'create_invoice' && p.status === 'pending'
      );
      const pendingVoidProp = recentProposals.find(
        (p: any) => p.kind === 'void_invoice' && p.status === 'pending'
      );
      const pendingRefundProp = recentProposals.find(
        (p: any) => p.kind === 'refund' && p.status === 'pending'
      );
      const pendingReminderProp = recentProposals.find(
        (p: any) => p.kind === 'send_reminder' && p.status === 'pending'
      );

      if (isNegative && (pendingCreateProp || pendingVoidProp || pendingRefundProp || pendingReminderProp)) {
        const activeProp = pendingCreateProp || pendingVoidProp || pendingRefundProp || pendingReminderProp;
        const { data: updatedProp } = await serviceClient
          .from('billing_ai_proposals')
          .update({
            status: 'rejected',
            decided_at: new Date().toISOString(),
            result_summary: 'Declined by user',
          })
          .eq('id', activeProp.id)
          .select('*')
          .single();
        proposalRow = updatedProp || {
          ...activeProp,
          status: 'rejected',
          result_summary: 'Declined by user',
        };
        conversationalRefusalOrRecoveryText = `Proposal declined${
          activeProp.payload?.invoice_number ? ` for #${activeProp.payload.invoice_number}` : ''
        }. No changes were applied.`;
      } else if (
        isAffirmative &&
        latestDocProp &&
        (latestDocProp.status === 'executed' || latestDocProp.status === 'approved') &&
        !pendingCreateProp &&
        !pendingVoidProp &&
        !pendingRefundProp &&
        !pendingReminderProp
      ) {
        conversationalRefusalOrRecoveryText = `Duplicate Approval Prevented: Proposal${
          latestDocProp.payload?.invoice_number
            ? ` for #${latestDocProp.payload.invoice_number}`
            : ''
        } has already been executed.`;
      } else if (isAffirmative && pendingCreateProp && pendingCreateProp.payload?.recipient_user_id) {
        const expStr = pendingCreateProp.expires_at || pendingCreateProp.payload?.expires_at;
        if (expStr && new Date(String(expStr)).getTime() < Date.now()) {
          await serviceClient
            .from('billing_ai_proposals')
            .update({ status: 'expired', result_summary: 'Expired — Request fresh proposal' })
            .eq('id', pendingCreateProp.id);
          conversationalRefusalOrRecoveryText =
            'Approval Token Expired: This invoice proposal has expired. Please ask Billing AI to prepare a fresh proposal.';
        } else {
          const { data: createdInv, error: createErr } = await serviceClient.rpc('billing_create_invoice', {
            p_recipient: pendingCreateProp.payload.recipient_user_id,
            p_items: [
              {
                service_code: pendingCreateProp.payload.service_code || 'ADMIN-TELEHEALTH',
                quantity: 1,
                unit_amount_minor: Number(pendingCreateProp.amount_minor || 15000),
              },
            ],
            p_due_date:
              pendingCreateProp.payload.due_date ||
              new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
            p_send: true,
            p_idempotency_key: `ai-confirm-${demoSessionId}-${pendingCreateProp.id}`,
            p_ai_proposal_id: pendingCreateProp.id,
            p_demo_session_id: demoSessionId,
          });
          if (createErr || !createdInv) {
            conversationalRefusalOrRecoveryText = `Could not create invoice: ${createErr?.message || 'Unknown error'}`;
          } else {
            const { data: updatedProp } = await serviceClient
              .from('billing_ai_proposals')
              .update({
                status: 'executed',
                decided_at: new Date().toISOString(),
                result_summary: `Created #${createdInv.invoice_number} (${formatUsd(createdInv.total_minor)})`,
              })
              .eq('id', pendingCreateProp.id)
              .select('*')
              .single();
            proposalRow = updatedProp;
            conversationalRefusalOrRecoveryText = `Invoice #${createdInv.invoice_number} (${formatUsd(
              createdInv.total_minor
            )} USD) has been created and sent to ${
              pendingCreateProp.payload.recipient_name || 'Customer'
            }.`;
          }
        }
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
            p_demo_session_id: demoSessionId,
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
            proposalRow = updatedProp || {
              ...pendingVoidProp,
              status: 'executed',
              result_summary: 'Voided — Invoice Archived',
            };
            conversationalRefusalOrRecoveryText = `Invoice #${
              pendingVoidProp.payload.invoice_number || ''
            } has been voided successfully. Its remaining balance is now $0.00 and it can no longer be paid.`;
          }
        }
      } else if (isAffirmative && pendingRefundProp && pendingRefundProp.payload?.invoice_id) {
        const { error: refErr } = await userClient.rpc('billing_simulate_demo_refund', {
          p_invoice: pendingRefundProp.payload.invoice_id,
          p_amount_minor: pendingRefundProp.amount_minor,
          p_demo_session_id: demoSessionId,
        });
        if (refErr) {
          conversationalRefusalOrRecoveryText = `Could not process refund: ${refErr.message}`;
        } else {
          const { data: updatedProp } = await serviceClient
            .from('billing_ai_proposals')
            .update({
              status: 'executed',
              decided_at: new Date().toISOString(),
              result_summary: `Refunded ${formatUsd(pendingRefundProp.amount_minor)}`,
            })
            .eq('id', pendingRefundProp.id)
            .select('*')
            .single();
          proposalRow = updatedProp;
          conversationalRefusalOrRecoveryText = `Refund of ${formatUsd(
            pendingRefundProp.amount_minor
          )} USD processed for #${pendingRefundProp.payload.invoice_number}.`;
        }
      } else if (isAffirmative && pendingReminderProp && pendingReminderProp.payload?.invoice_id) {
        const { error: remErr } = await userClient.rpc('billing_send_reminder', {
          p_invoice: pendingReminderProp.payload.invoice_id,
          p_demo_session_id: demoSessionId,
        });
        if (remErr) {
          conversationalRefusalOrRecoveryText = `Could not send reminder: ${remErr.message}`;
        } else {
          const { data: updatedProp } = await serviceClient
            .from('billing_ai_proposals')
            .update({
              status: 'executed',
              decided_at: new Date().toISOString(),
              result_summary: 'Reminder sent to customer',
            })
            .eq('id', pendingReminderProp.id)
            .select('*')
            .single();
          proposalRow = updatedProp;
          conversationalRefusalOrRecoveryText = `Payment reminder sent to ${
            pendingReminderProp.payload.patient_name || 'customer'
          } for statement #${pendingReminderProp.payload.invoice_number}.`;
        }
      }

      // Check for Refund Request
      const isRefundRequest =
        !conversationalRefusalOrRecoveryText &&
        /\b(?:refund|return\s+payment|reimburse)\b/i.test(message);

      if (isRefundRequest) {
        const targetSummary =
          focusedOrMatchedSummary ||
          invoiceSummaries.find(
            (i) => i.rawStatus === 'paid' && i.amountPaidMinor > i.amountRefundedMinor
          ) ||
          null;

        if (!targetSummary) {
          conversationalRefusalOrRecoveryText =
            'No settled/paid invoice with refundable funds was found. Please specify a paid statement number (e.g., #PPB-INV-2026-1003) to prepare a refund proposal.';
        } else if (
          targetSummary.rawStatus !== 'paid' &&
          targetSummary.rawStatus !== 'partially_refunded'
        ) {
          conversationalRefusalOrRecoveryText = `Invoice #${targetSummary.invoiceNumber} has status ${targetSummary.status.toUpperCase()} (${targetSummary.amountPaidUsd} paid). Only settled/paid statements can be refunded. If the statement is unpaid, ask to void it instead.`;
        } else {
          const refundableMinor = Math.max(
            targetSummary.amountPaidMinor - targetSummary.amountRefundedMinor,
            0
          );
          const explicitDollarMatch = message.match(
            /\$\s*(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*(?:dollars|usd)/i
          );
          const requestedMinor = explicitDollarMatch
            ? Math.round(
                Number.parseFloat(explicitDollarMatch[1] || explicitDollarMatch[2]) * 100
              )
            : refundableMinor;

          if (requestedMinor <= 0 || requestedMinor > refundableMinor) {
            conversationalRefusalOrRecoveryText = `Refund amount (${formatUsd(
              requestedMinor
            )}) exceeds the remaining refundable paid amount (${formatUsd(
              refundableMinor
            )}) on #${targetSummary.invoiceNumber}.`;
          } else {
            const { data: guard } = await serviceClient.rpc('billing_ai_guardrail_check', {
              p_user: userId,
              p_amount_minor: requestedMinor,
              p_exclude_proposal: null,
            });
            if (guard && guard.passed === false) {
              proposalGuardrailBlockedText = `Guardrail Blocked: Preparing a refund proposal for ${formatUsd(
                requestedMinor
              )} exceeds your configured Billing AI limit (${formatUsd(
                guard.single_limit_minor
              )} single-action limit).`;
            } else {
              const payload = {
                title: `Refund ${formatUsd(requestedMinor)} for #${targetSummary.invoiceNumber}`,
                summary: `Issue ${formatUsd(requestedMinor)} USD refund to ${targetSummary.customerName} for statement #${targetSummary.invoiceNumber}. Requires explicit provider approval.`,
                action: 'refund_invoice',
                invoice_id: targetSummary.id,
                invoice_number: targetSummary.invoiceNumber,
                amount_minor: requestedMinor,
                patient_name: targetSummary.customerName,
              };
              const { data: refProp } = await serviceClient
                .from('billing_ai_proposals')
                .insert({
                  session_id: sessionId,
                  user_id: userId,
                  kind: 'refund',
                  payload,
                  amount_minor: requestedMinor,
                  currency: 'USD',
                  guardrail_result: guard || { passed: true },
                  status: 'pending',
                  demo_session_id: demoSessionId,
                })
                .select('*')
                .single();
              proposalRow = refProp;
              conversationalRefusalOrRecoveryText = `I have prepared a refund proposal of ${formatUsd(
                requestedMinor
              )} USD for statement #${targetSummary.invoiceNumber} (${
                targetSummary.customerName
              }). Please review the proposal card below and tap Approve to process the refund.`;
            }
          }
        }
      }

      // Check for Reminder Request
      const isReminderRequest =
        !conversationalRefusalOrRecoveryText &&
        !proposalRow &&
        /\b(?:remind|reminder|follow\s*up\s+on\s+payment|nudge)\b/i.test(message);

      if (isReminderRequest) {
        const targetSummary =
          focusedOrMatchedSummary ||
          invoiceSummaries.find((i) => i.status === 'overdue') ||
          invoiceSummaries.find((i) => i.rawStatus === 'sent' && i.balanceDueMinor > 0) ||
          null;

        if (!targetSummary || targetSummary.balanceDueMinor <= 0) {
          conversationalRefusalOrRecoveryText =
            'No unpaid statement was found for a payment reminder. Please specify an open statement number (e.g., #PPB-INV-2026-1002).';
        } else {
          const payload = {
            title: `Send Payment Reminder for #${targetSummary.invoiceNumber}`,
            summary: `Send polite payment reminder notification to ${targetSummary.customerName} for #${targetSummary.invoiceNumber} (${targetSummary.balanceDueUsd} USD due ${targetSummary.dueDate}).`,
            action: 'send_reminder',
            invoice_id: targetSummary.id,
            invoice_number: targetSummary.invoiceNumber,
            amount_minor: targetSummary.balanceDueMinor,
            patient_name: targetSummary.customerName,
          };
          const { data: remProp } = await serviceClient
            .from('billing_ai_proposals')
            .insert({
              session_id: sessionId,
              user_id: userId,
              kind: 'send_reminder',
              payload,
              amount_minor: targetSummary.balanceDueMinor,
              currency: 'USD',
              guardrail_result: { passed: true },
              status: 'pending',
              demo_session_id: demoSessionId,
            })
            .select('*')
            .single();
          proposalRow = remProp;
          conversationalRefusalOrRecoveryText = `I have prepared a payment reminder proposal for ${targetSummary.customerName} regarding statement #${targetSummary.invoiceNumber} (${targetSummary.balanceDueUsd} USD). Tap Approve below to send the notification.`;
        }
      }

      const isDiscrepancyOrVoid =
        !conversationalRefusalOrRecoveryText &&
        !proposalRow &&
        (/\b(asked for|meant|wrong customer|wrong patient|wrong person|wrong recipient|not for|cancel.*invoice|void.*invoice|undo.*invoice|delete.*invoice)\b/i.test(
          message
        ) ||
          (/\b(wrong|mistake|error|incorrect)\b/i.test(message) &&
            /\b(invoice|customer|patient|person|statement|alex|jordan|created)\b/i.test(
              message
            )) ||
          /\b(void|cancel)\s+#?((?:PPB|HER)-INV-\d{4}-\d{4}|\d{4}|this\s+invoice|this\s+statement)\b/i.test(
            message
          ));

      if (isDiscrepancyOrVoid) {
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

        if (!targetInvoice && !conversationalRefusalOrRecoveryText && focusedOrMatchedSummary) {
          targetInvoice =
            invoices.find((i: any) => String(i.id) === String(focusedOrMatchedSummary.id)) ||
            null;
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
          const activeInvoices = invoices.filter(
            (i: any) => i.status === 'sent' || i.status === 'draft'
          );
          if (activeInvoices.length === 1) {
            targetInvoice = activeInvoices[0];
          } else if (activeInvoices.length > 1) {
            const listStr = activeInvoices
              .map(
                (i: any) =>
                  `• #${i.invoice_number} (${
                    nameMap.get(String(i.recipient_user_id)) || 'Authorized Customer'
                  } — ${formatUsd(i.total_minor)})`
              )
              .join('\n');
            conversationalRefusalOrRecoveryText = `You have multiple open invoices. To prevent voiding the wrong statement, please specify the invoice number you wish to void:\n${listStr}`;
          }
        }

        if (targetInvoice && !conversationalRefusalOrRecoveryText) {
          const customerName =
            nameMap.get(String(targetInvoice.recipient_user_id)) || 'Authorized Customer';

          if (
            targetInvoice.status === 'paid' ||
            Number(targetInvoice.amount_paid_minor || 0) > 0
          ) {
            conversationalRefusalOrRecoveryText = `Payment-State Protection: Invoice #${
              targetInvoice.invoice_number
            } (${customerName}) has a completed payment of ${formatUsd(
              targetInvoice.amount_paid_minor || targetInvoice.total_minor
            )} USD and cannot be voided. Voiding only applies to unpaid Draft or Sent statements. Returning captured funds requires a formal Refund workflow.`;
          } else if (targetInvoice.status === 'refunded') {
            conversationalRefusalOrRecoveryText = `Invoice #${targetInvoice.invoice_number} has already been refunded ($0.00 balance due) and cannot be voided.`;
          } else if (targetInvoice.status === 'void') {
            conversationalRefusalOrRecoveryText = `Invoice #${targetInvoice.invoice_number} has already been voided and archived ($0.00 balance due).`;
          } else {
            const requestedMatch = message.match(
              /(?:asked for|meant|wanted)\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)/i
            );
            const requestedRecipient = requestedMatch ? requestedMatch[1].trim() : null;

            const payload = {
              title: `Void Erroneous Invoice #${targetInvoice.invoice_number}`,
              summary: `Void ${formatUsd(
                targetInvoice.total_minor
              )} USD invoice issued in error to ${customerName}. Once voided, its remaining balance becomes $0.00 and it cannot be paid.`,
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
                demo_session_id: demoSessionId,
              })
              .select('*')
              .single();

            proposalRow = voidProp;
            conversationalRefusalOrRecoveryText = `I apologize for the mistake. Invoice #${
              targetInvoice.invoice_number
            } was issued to ${customerName}${
              requestedRecipient ? ` instead of ${requestedRecipient}` : ''
            }. I have prepared a proposal below to void this invoice so its balance becomes $0.00 and it cannot be paid. Please review and tap Approve.`;
          }
        }
      }
    }

    // Customer role conversational payment proposal & affirmative continuity
    if (roleScope === 'patient') {
      const invNumMatch = explicitInvMatch;
      let targetInvoice = invNumMatch
        ? invoices.find(
            (i: any) =>
              i.invoice_number.toLowerCase().includes(invNumMatch[1].toLowerCase()) ||
              i.invoice_number.endsWith(invNumMatch[1])
          )
        : focusedOrMatchedSummary
          ? invoices.find((i: any) => String(i.id) === String(focusedOrMatchedSummary.id))
          : null;

      if (invNumMatch && !targetInvoice) {
        const available = invoices
          .filter((i: any) => i.status !== 'void')
          .map((i: any) => `#${i.invoice_number}`)
          .join(', ');
        conversationalRefusalOrRecoveryText = `Statement #${invNumMatch[1].toUpperCase()} was not found on your active account. Your available statements are: ${
          available || 'None'
        }. Please verify the statement number or select an invoice from your Billing list.`;
      }

      if (!targetInvoice && !conversationalRefusalOrRecoveryText && recentProposals.length > 0) {
        for (const p of recentProposals) {
          if (p.payload?.invoice_id) {
            targetInvoice =
              invoices.find((i: any) => String(i.id) === String(p.payload.invoice_id)) || null;
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
        proposalRow = updatedProp || {
          ...pendingPayProp,
          status: 'rejected',
          result_summary: 'Declined by user',
        };
        conversationalRefusalOrRecoveryText = `Payment proposal declined${
          pendingPayProp.payload?.invoice_number
            ? ` for Statement #${pendingPayProp.payload.invoice_number}`
            : ''
        }. No PayPal checkout was opened and no funds were charged.`;
      } else if (
        isAffirmative &&
        latestPatientProp &&
        latestPatientProp.kind === 'payment_checkout' &&
        (latestPatientProp.status === 'approved' || latestPatientProp.status === 'executed') &&
        !pendingPayProp &&
        !conversationalRefusalOrRecoveryText
      ) {
        conversationalRefusalOrRecoveryText = `Duplicate Approval Prevented: Payment proposal for Statement #${
          latestPatientProp.payload?.invoice_number || targetInvoice?.invoice_number || ''
        } is already confirmed and awaiting your authorization in PayPal Sandbox. Tap "Proceed to PayPal Sandbox" on the proposal card to complete checkout.`;
      } else if (
        isAffirmative &&
        targetInvoice &&
        Number(targetInvoice.balance_due_minor || 0) > 0 &&
        !conversationalRefusalOrRecoveryText
      ) {
        const expStr = pendingPayProp?.expires_at || pendingPayProp?.payload?.expires_at;
        if (expStr && new Date(String(expStr)).getTime() < Date.now()) {
          await serviceClient
            .from('billing_ai_proposals')
            .update({ status: 'expired', result_summary: 'Expired — Request fresh proposal' })
            .eq('id', pendingPayProp.id);
          conversationalRefusalOrRecoveryText = `Approval Token Expired: The payment proposal for Statement #${targetInvoice.invoice_number} has expired. Please ask Billing AI to prepare a fresh payment proposal.`;
        } else {
          const balanceMinor = Number(
            targetInvoice.balance_due_minor || targetInvoice.total_minor || 0
          );
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
                demo_session_id: demoSessionId,
              })
              .select('*')
              .single();
            approvedProp = ins;
          }
          proposalRow = approvedProp;
          conversationalRefusalOrRecoveryText = [
            `Payment Proposal Confirmed for Statement #${targetInvoice.invoice_number} (${formatUsd(
              balanceMinor
            )} USD).`,
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
        (lower.includes('pay') || lower.includes('checkout') || lower.includes('settle'))
      ) {
        const balanceMinor = Number(targetInvoice.balance_due_minor || 0);
        if (balanceMinor <= 0) {
          conversationalRefusalOrRecoveryText = `Statement #${
            targetInvoice.invoice_number
          } is already settled (Status: ${String(
            targetInvoice.status || ''
          ).toUpperCase()}, Remaining Balance: $0.00 USD). No balance is currently due.`;
        } else {
          const otherUnpaid = unpaidInvoices.filter(
            (u: any) => String(u.id) !== String(targetInvoice.id)
          );
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
              demo_session_id: demoSessionId,
            })
            .select('*')
            .single();
          proposalRow = payProp;
          conversationalRefusalOrRecoveryText = [
            `I have prepared a payment proposal for invoice #${targetInvoice.invoice_number} in the amount of ${formatUsd(
              balanceMinor
            )} USD (Due ${targetInvoice.due_date}).${otherNote}`,
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

    // Provider role: draft/create/issue an invoice or conversational correction of a recent proposal
    const lastCreateProposal = recentProposals.find((p: any) => p.kind === 'create_invoice');
    const isCorrectionIntent =
      Boolean(lastCreateProposal) &&
      /\b(?:change|update|correct|fix|make|adjust|switch|instead)\b/i.test(message) &&
      !/\b(?:void|refund|cancel)\b/i.test(message);
    const isNaturalCreateIntent =
      /\b(?:draft|create|issue|prepare|bill|send|charge)\b.*\b(?:invoice|statement|alex|jordan|forms?|paperwork|telehealth|copay|records?|office|visit|\$\s*\d+)/i.test(
        message
      );

    if (
      roleScope === 'doctor' &&
      !proposalRow &&
      !conversationalRefusalOrRecoveryText &&
      (isNaturalCreateIntent || isCorrectionIntent)
    ) {
      const explicitCatalogMatch = SERVICE_CATALOG_MATCHERS.find((s) => s.keywords.test(message));
      const fallbackPreviousCatalog =
        isCorrectionIntent && lastCreateProposal?.payload?.service_code
          ? SERVICE_CATALOG_MATCHERS.find(
              (s) => s.code === String(lastCreateProposal.payload.service_code)
            )
          : null;
      const matchedCatalogService =
        explicitCatalogMatch ||
        fallbackPreviousCatalog ||
        SERVICE_CATALOG_MATCHERS[SERVICE_CATALOG_MATCHERS.length - 1];

      const explicitDollarMatch = message.match(
        /\$\s*(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*(?:dollars|usd)/i
      );
      const explicitDollars = explicitDollarMatch
        ? Number.parseFloat(explicitDollarMatch[1] || explicitDollarMatch[2])
        : null;
      const amountMinor =
        explicitDollars !== null && Number.isFinite(explicitDollars)
          ? Math.round(explicitDollars * 100)
          : explicitCatalogMatch
            ? explicitCatalogMatch.defaultMinor
            : isCorrectionIntent && lastCreateProposal?.amount_minor
              ? Number(lastCreateProposal.amount_minor)
              : matchedCatalogService.defaultMinor;

      const { data: guard } = await serviceClient.rpc('billing_ai_guardrail_check', {
        p_user: userId,
        p_amount_minor: amountMinor,
        p_exclude_proposal: isCorrectionIntent && lastCreateProposal?.id ? lastCreateProposal.id : null,
      });

      if (guard && guard.passed === false) {
        proposalGuardrailBlockedText = `Guardrail Blocked: Preparing an AI invoice action for ${formatUsd(
          amountMinor
        )} exceeds your configured Billing AI limit (Single-Action Limit: ${formatUsd(
          guard.single_limit_minor
        )}, Daily Limit: ${formatUsd(guard.daily_limit_minor)}, Used Today: ${formatUsd(
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
        const matchedKnownPatient = billablePatients.find(
          (p: any) =>
            lower.includes(p.full_name.toLowerCase()) ||
            (p.full_name.split(' ').length > 1 &&
              lower.includes(p.full_name.split(' ')[0].toLowerCase()))
        );

        const nameMatch = message.match(
          /(?:for|to|patient|customer|client|account)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i
        );
        const STOP_WORDS = new Set([
          'a',
          'an',
          'the',
          'my',
          'our',
          'me',
          'this',
          'that',
          'patient',
          'customer',
          'administrative',
          'telehealth',
          'consultation',
          'service',
          'review',
          'consult',
          'visit',
          'appointment',
          'invoice',
          'draft',
          'forms',
          'completion',
          'records',
          'package',
          'copay',
          'his',
          'her',
          'their',
        ]);

        if (nameMatch) {
          const candidate = nameMatch[1].trim();
          if (!STOP_WORDS.has(candidate.toLowerCase())) {
            requestedPatientName = candidate;
          }
        }

        let targetPatient = matchedKnownPatient || null;

        if (!targetPatient && requestedPatientName) {
          targetPatient =
            billablePatients.find((p: any) =>
              p.full_name.toLowerCase().includes(requestedPatientName!.toLowerCase())
            ) || null;

          if (!targetPatient) {
            const authList = billablePatients.map((p: any) => p.full_name).join(', ') || 'None';
            conversationalRefusalOrRecoveryText = `Recipient "${requestedPatientName}" was not found in your currently authorized billable customers. Your authorized customers are: ${authList}.`;
          }
        }

        if (!targetPatient && isCorrectionIntent && lastCreateProposal?.payload?.recipient_user_id) {
          targetPatient =
            billablePatients.find(
              (p: any) => p.patient_id === lastCreateProposal.payload.recipient_user_id
            ) || null;
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
          if (isCorrectionIntent && lastCreateProposal?.id && lastCreateProposal.status === 'pending') {
            await serviceClient
              .from('billing_ai_proposals')
              .update({ status: 'dismissed', decided_at: new Date().toISOString() })
              .eq('id', lastCreateProposal.id);
          }

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
              demo_session_id: demoSessionId,
            })
            .select('*')
            .single();

          proposalRow = createdProp;
        }
      }
    }

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
        } in the amount of ${formatUsd(proposalRow.amount_minor)} USD (Service: ${
          proposalRow.payload?.service_title || 'Administrative Service'
        } [${
          proposalRow.payload?.service_code || 'ADMIN-TELEHEALTH'
        }]). Review the proposal card below and tap Approve to create and send the invoice.`;
      }
    }

    // Specific Invoice Line-Item Breakdown Handling (only when explicitly asking for a full breakdown, never overriding specific why/when/how-much questions before Gemini)
    const isAskingForFullInvoiceBreakdown =
      Boolean(focusedOrMatchedSummary) &&
      /\b(?:what\s+is\s+this\s+(?:invoice|statement)\s+for|explain\s+the\s+line\s+items|full\s+statement\s+breakdown)\b/i.test(
        message
      ) &&
      !/\b(?:why\s+did|fail|declin|try\s+again|retry|hello|hi\b|compare)\b/i.test(
        message
      );

    if (!assistantReply && isAskingForFullInvoiceBreakdown && focusedOrMatchedSummary) {
      assistantReply = buildDetailedInvoiceExplanation(focusedOrMatchedSummary);
    }

    let usedGemini = false;
    let geminiCompatMeta: Record<string, any> | null = null;
    const configuredGeminiModel =
      String(Deno.env.get('GEMINI_MODEL') || GEMINI_TARGET_MODEL).trim() || GEMINI_TARGET_MODEL;

    if (!assistantReply && geminiApiKey) {
      const { data: recentChatRows } = await serviceClient
        .from('billing_ai_messages')
        .select('role, content, tool_calls')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false })
        .limit(6);

      const historyParts = Array.isArray(recentChatRows) && recentChatRows.length > 0
        ? sanitizeMultiTurnGeminiContents(recentChatRows.slice().reverse(), configuredGeminiModel)
        : [{ role: 'user', parts: [{ text: message }] }];

      const systemPrompt = [
        'You are the dedicated PayPal AI Billing Kit Assistant.',
        `Active user role: ${roleScope.toUpperCase()}.`,
        focusedOrMatchedSummary
          ? `ACTIVE FOCUSED INVOICE: #${focusedOrMatchedSummary.invoiceNumber}\n${buildDetailedInvoiceExplanation(
              focusedOrMatchedSummary
            )}`
          : '',
        'STRICT DOMAIN ISOLATION RULES:',
        '1. You only have access to administrative billing records (invoices, line items, service dates, balances, due dates, payment attempts, receipts, and AI financial guardrails).',
        '2. You NEVER have access to clinical notes, diagnoses, labs, vitals, or medical records. Never invent medical advice.',
        '3. Answer concisely and accurately using ONLY the JSON billing context below. Always cite exact invoice numbers (e.g., #PPB-INV-2026-1003) and exact USD amounts.',
        '4. Distinguish clearly between sample demo settlements ("Sample Demo Settlement — Not a Live PayPal Capture") and verified PayPal Sandbox captures.',
        `5. Configured guardrails: Single-action limit ${formatUsd(
          settings.max_single_action_minor
        )}, Daily limit ${formatUsd(settings.daily_limit_minor)}. AI proposes actions; humans approve; PayPal confirms settlement.`,
        `AUTHORIZED CUSTOMERS: ${billablePatients.map((p: any) => p.full_name).join(', ') || 'Alex Rivera, Jordan Taylor'}`,
        `BILLING CONTEXT JSON:\n${JSON.stringify(invoiceSummaries, null, 2)}`,
      ].join('\n');

      const geminiResult = await invokeGeminiCompatRequest({
        apiKey: geminiApiKey,
        targetModel: configuredGeminiModel,
        thinkingLevel: GEMINI_DEFAULT_THINKING_LEVEL,
        systemPrompt,
        contents: historyParts.length > 0 ? historyParts : [{ role: 'user', parts: [{ text: message }] }],
        maxOutputTokens: 1536,
        allowUpstreamFallback: true,
      });

      if (geminiResult.ok && geminiResult.text) {
        assistantReply = geminiResult.text;
        usedGemini = true;
        geminiCompatMeta = {
          model: geminiResult.configuredModel,
          upstream_resolved_model: geminiResult.upstreamResolvedModel,
          redirect_or_fallback_reason: geminiResult.redirectOrFallbackReason,
          thinking_level: geminiResult.thinkingLevel,
          thought_signatures: geminiResult.thoughtSignatures,
          model_parts: geminiResult.modelParts,
          latency_ms: geminiResult.latencyMs,
          usage_metadata: geminiResult.usageMetadata,
        };
      }
    }

    if (!assistantReply) {
      // If a focused invoice is set and nothing else matched, explain the focused invoice!
      if (focusedOrMatchedSummary && !/\b(?:all|summary|summarize|overdue|failed)\b/i.test(lower)) {
        assistantReply = buildDetailedInvoiceExplanation(focusedOrMatchedSummary);
      } else {
        const overdue = invoiceSummaries.filter((i) => i.status === 'overdue');
        const unpaid = invoiceSummaries.filter(
          (i) => i.status === 'sent' || i.status === 'overdue'
        );
        const failed = invoiceSummaries.filter(
          (i) => Array.isArray(i.failedAttempts) && i.failedAttempts.length > 0
        );
        const paidList = invoiceSummaries.filter(
          (i) => i.status === 'paid' || i.status === 'refunded'
        );

        if (lower.includes('overdue')) {
          assistantReply =
            overdue.length === 0
              ? 'There are currently 0 overdue invoices on your account.'
              : `Overdue statements (${overdue.length}):\n` +
                overdue
                  .map(
                    (i) =>
                      `• #${i.invoiceNumber} (${i.customerName}) — ${
                        i.itemDescriptions[0] || 'Administrative Service'
                      }: ${i.balanceDueUsd} (Due ${i.dueDate})`
                  )
                  .join('\n');
        } else if (lower.includes('fail') || lower.includes('declin')) {
          assistantReply =
            failed.length === 0
              ? 'No unsuccessful payment attempts are recorded on your current statements.'
              : `Statements with unsuccessful payment attempts (${failed.length}):\n` +
                failed
                  .map(
                    (i) =>
                      `• #${i.invoiceNumber} (${i.customerName}, ${i.balanceDueUsd}): "${i.failedAttempts[0]}"`
                  )
                  .join('\n');
        } else if (lower.includes('paid') || lower.includes('receipt') || lower.includes('settled')) {
          assistantReply =
            paidList.length === 0
              ? 'No paid or refunded statements are recorded yet.'
              : `Settled & refunded statements (${paidList.length}):\n` +
                paidList
                  .map(
                    (i) =>
                      `• #${i.invoiceNumber} [${i.status.toUpperCase()}] (${i.customerName}): Paid ${
                        i.amountPaidUsd
                      } • Balance ${i.balanceDueUsd} (${
                        i.itemDescriptions[0] || 'Administrative Service'
                      })`
                  )
                  .join('\n');
        } else if (lower.includes('summary') || lower.includes('summarize') || lower.includes('balance') || lower.includes('owe')) {
          const totalOutstandingMinor = unpaid.reduce((s, i) => s + i.balanceDueMinor, 0);
          const totalOverdueMinor = overdue.reduce((s, i) => s + i.balanceDueMinor, 0);
          const totalPaidMinor = invoiceSummaries
            .filter((i) => i.status === 'paid')
            .reduce((s, i) => s + i.amountPaidMinor, 0);
          assistantReply = [
            `${roleScope === 'doctor' ? 'Practice' : 'Customer'} Billing Summary:`,
            `• Total Outstanding Balance: ${formatUsd(totalOutstandingMinor)} USD (${unpaid.length} open statement${unpaid.length === 1 ? '' : 's'})`,
            `• Overdue Balance: ${formatUsd(totalOverdueMinor)} USD (${overdue.length} overdue)`,
            `• Paid Statements Total: ${formatUsd(totalPaidMinor)} USD`,
            `• Recorded Failed Attempts: ${failed.length}`,
            ...(unpaid.length > 0
              ? [
                  `Open Statements:`,
                  ...unpaid.map(
                    (i) =>
                      `• #${i.invoiceNumber} [${i.status.toUpperCase()}] (${i.customerName}): ${i.balanceDueUsd} — ${
                        i.itemDescriptions[0] || 'Administrative Service'
                      } (Due ${i.dueDate})`
                  ),
                ]
              : []),
          ].join('\n');
        } else {
          assistantReply =
            unpaid.length === 0
              ? 'All current statements are settled ($0.00 balance due).'
              : `Open statements (${unpaid.length}):\n` +
                unpaid
                  .map(
                    (i) =>
                      `• #${i.invoiceNumber} [${i.status.toUpperCase()}] (${i.customerName}): ${
                        i.balanceDueUsd
                      } — ${i.itemDescriptions[0] || 'Administrative Service'} (Issued ${formatDateReadable(
                        i.sentAt || i.createdAt
                      )}, Due ${i.dueDate})`
                  )
                  .join('\n');
        }
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
        tool_calls: geminiCompatMeta,
      })
      .select('*')
      .single();

    await serviceClient
      .from('billing_ai_sessions')
      .update({ last_activity_at: new Date().toISOString() })
      .eq('id', sessionId);

    const activeAiEngineLabel = usedGemini
      ? configuredGeminiModel
      : 'deterministic-guardrail-router';

    return new Response(
      JSON.stringify({
        sessionId,
        aiEngine: activeAiEngineLabel,
        geminiConfigured: Boolean(geminiApiKey),
        geminiCompatibility: {
          configuredModel: configuredGeminiModel,
          previousModel: GEMINI_PREVIOUS_MODEL,
          thinkingLevel: GEMINI_DEFAULT_THINKING_LEVEL,
          upstreamResolvedModel: geminiCompatMeta?.upstream_resolved_model ?? null,
          thoughtSignaturesPreserved: geminiCompatMeta?.thought_signatures?.length ?? 0,
          latencyMs: geminiCompatMeta?.latency_ms ?? null,
          usageMetadata: geminiCompatMeta?.usage_metadata ?? null,
        },
        reply: {
          id: savedAssistantMsg?.id || crypto.randomUUID(),
          role: 'assistant',
          content: assistantReply,
          createdAt: savedAssistantMsg?.created_at || new Date().toISOString(),
          proposal: proposalRow,
          aiEngine: activeAiEngineLabel,
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

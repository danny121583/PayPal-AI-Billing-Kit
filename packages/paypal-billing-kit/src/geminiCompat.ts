/**
 * @paypal-ai/billing-kit — Gemini 3.5 Flash-Lite Compatibility & Multi-Turn Tool Calling Engine
 *
 * Implements Google's official migration specification from `gemini-2.5-flash` to `gemini-3.5-flash-lite`:
 * 1. Replaces deprecated numeric `thinking_budget` / `thinkingBudget` with `thinking_level` / `thinkingLevel`
 *    (`MINIMAL`, `LOW`, `MEDIUM`, `HIGH`), defaulting to `MEDIUM` for multi-step billing and payment reasoning.
 * 2. Preserves opaque `thoughtSignature` tokens verbatim across multi-turn tool-calling turns while
 *    stripping incompatible cross-model thoughts when migrating legacy `gemini-2.5-flash` sessions.
 * 3. Enforces exact `id` and `name` matching and ordering between `functionCall` parts and `functionResponse` parts.
 * 4. Places multimodal function results inside the expected `functionResponse` payload structure.
 * 5. Removes deprecated sampling parameters (`temperature`, `topP`, `topK` overrides on thinking models),
 *    unsupported `candidateCount` values, and model-turn prefilling.
 * 6. Preserves structured JSON output schemas (`responseMimeType: "application/json"`, `responseSchema`).
 */

export const GEMINI_PREVIOUS_MODEL = 'gemini-2.5-flash' as const;
export const GEMINI_TARGET_MODEL = 'gemini-3.5-flash-lite' as const;
export const GEMINI_FALLBACK_FLASH_LITE_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite-preview',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
] as const;

export type GeminiThinkingLevel = 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH';

export const GEMINI_SUPPORTED_THINKING_LEVELS: readonly GeminiThinkingLevel[] = [
  'MINIMAL',
  'LOW',
  'MEDIUM',
  'HIGH',
] as const;

export const GEMINI_DEFAULT_THINKING_LEVEL: GeminiThinkingLevel = 'MEDIUM';

export interface GeminiFunctionCallPart {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

export interface GeminiFunctionResponsePayload {
  id?: string;
  name: string;
  response: Record<string, unknown>;
  parts?: Array<{
    inlineData?: { mimeType: string; data: string };
    fileData?: { mimeType: string; fileUri: string };
  }>;
}

export interface GeminiContentPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: GeminiFunctionCallPart;
  functionResponse?: GeminiFunctionResponsePayload;
  inlineData?: { mimeType: string; data: string };
}

export interface GeminiContentTurn {
  role: 'user' | 'model';
  parts: GeminiContentPart[];
  sourceModel?: string;
}

export interface GeminiUsageMetrics {
  promptTokenCount: number;
  candidatesTokenCount: number;
  thoughtsTokenCount: number;
  totalTokenCount: number;
  estimatedCostUsd: number;
}

/**
 * Normalizes a requested thinking level string to a valid Gemini 3.x `ThinkingLevel` enum value.
 */
export function normalizeThinkingLevel(
  level?: string | null,
  defaultLevel: GeminiThinkingLevel = GEMINI_DEFAULT_THINKING_LEVEL
): GeminiThinkingLevel {
  const upper = String(level || '')
    .trim()
    .toUpperCase();
  if (
    upper === 'MINIMAL' ||
    upper === 'LOW' ||
    upper === 'MEDIUM' ||
    upper === 'HIGH'
  ) {
    return upper;
  }
  return defaultLevel;
}

/**
 * Determines whether a model identifier belongs to the Gemini 3+ family that requires `thinkingLevel`
 * rather than deprecated numeric `thinkingBudget`.
 */
export function isGemini3OrLaterModel(modelId: string): boolean {
  const clean = String(modelId || '')
    .trim()
    .toLowerCase()
    .replace(/^models\//, '');
  return /^gemini-[3-9]\./.test(clean);
}

/**
 * Builds a sanitized `generationConfig` for `generateContent`:
 * - Replaces deprecated `thinkingBudget` / `thinking_budget` with `thinkingConfig: { thinkingLevel }`
 *   on Gemini 3.x models (`gemini-3.5-flash-lite`, `gemini-3.1-flash-lite-preview`, etc.).
 * - Removes deprecated custom sampling parameters (`temperature`, `topP`, `topK`), unsupported
 *   `candidateCount > 1`, and legacy fields that trigger HTTP 400 errors.
 */
export function buildSanitizedGenerationConfig(options: {
  model: string;
  thinkingLevel?: GeminiThinkingLevel | string;
  maxOutputTokens?: number;
  responseMimeType?: string;
  responseSchema?: Record<string, unknown>;
  legacyConfigToSanitize?: Record<string, unknown>;
}): Record<string, unknown> {
  const normalizedLevel = normalizeThinkingLevel(options.thinkingLevel);
  const config: Record<string, unknown> = {
    maxOutputTokens: options.maxOutputTokens ?? 1024,
    thinkingConfig: {
      thinkingLevel: normalizedLevel,
    },
  };

  if (options.responseMimeType) {
    config.responseMimeType = options.responseMimeType;
  }
  if (options.responseSchema) {
    config.responseSchema = options.responseSchema;
  }

  // Explicitly ensure deprecated parameters are never present
  delete config.thinkingBudget;
  delete config.thinking_budget;
  delete config.temperature;
  delete config.topP;
  delete config.topK;
  delete config.candidateCount;
  delete config.candidate_count;

  return config;
}

/**
 * Extracts all opaque `thoughtSignature` tokens from a model candidate's content parts without altering them.
 */
export function extractThoughtSignatures(
  partsOrContent?: GeminiContentPart[] | { parts?: GeminiContentPart[] } | null
): string[] {
  const parts = Array.isArray(partsOrContent)
    ? partsOrContent
    : Array.isArray(partsOrContent?.parts)
      ? partsOrContent.parts
      : null;
  if (!parts) return [];
  const signatures: string[] = [];
  for (const part of parts) {
    if (
      typeof part?.thoughtSignature === 'string' &&
      part.thoughtSignature.length > 0
    ) {
      signatures.push(part.thoughtSignature);
    }
  }
  return signatures;
}

/**
 * Sanitizes multi-turn conversation history for `gemini-3.5-flash-lite`:
 * - Preserves `thoughtSignature` and `functionCall` parts verbatim when the turn was produced by the same target model.
 * - Drops incompatible cross-model `thought` / `thoughtSignature` parts from legacy `gemini-2.5-flash` turns.
 * - Removes any trailing model-turn prefilling (ensuring the final turn in a standard generation request is a user/tool turn).
 */
export function sanitizeMultiTurnContents(
  turns: GeminiContentTurn[],
  activeModel: string = GEMINI_TARGET_MODEL,
  allowTrailingModelTurn = false
): Array<{ role: 'user' | 'model'; parts: GeminiContentPart[] }> {
  const cleanActive = String(activeModel || GEMINI_TARGET_MODEL)
    .trim()
    .toLowerCase()
    .replace(/^models\//, '');

  const sanitized: Array<{ role: 'user' | 'model'; parts: GeminiContentPart[] }> = [];

  for (const turn of turns) {
    if (!turn || !Array.isArray(turn.parts) || turn.parts.length === 0) continue;
    const role: 'user' | 'model' = turn.role === 'model' ? 'model' : 'user';
    const turnModel = turn.sourceModel
      ? String(turn.sourceModel).trim().toLowerCase().replace(/^models\//, '')
      : cleanActive;
    const isSameModel = turnModel === cleanActive;

    const cleanedParts: GeminiContentPart[] = [];
    for (const part of turn.parts) {
      if (!part || typeof part !== 'object') continue;

      // Cross-model protection: Flash-Lite cannot inherit thoughts/signatures from another model
      if (role === 'model' && !isSameModel && part.thought === true && !part.functionCall && !part.text) {
        continue;
      }

      const cloned: GeminiContentPart = {};
      if (typeof part.text === 'string') {
        cloned.text = part.text;
      }
      if (typeof part.thought === 'boolean' && isSameModel) {
        cloned.thought = part.thought;
      }
      if (
        typeof part.thoughtSignature === 'string' &&
        part.thoughtSignature.length > 0 &&
        isSameModel
      ) {
        // Preserve thoughtSignature byte-for-byte without modification
        cloned.thoughtSignature = part.thoughtSignature;
      }
      if (part.functionCall && typeof part.functionCall.name === 'string') {
        cloned.functionCall = {
          ...(part.functionCall.id ? { id: String(part.functionCall.id) } : {}),
          name: String(part.functionCall.name),
          args:
            part.functionCall.args && typeof part.functionCall.args === 'object'
              ? { ...part.functionCall.args }
              : {},
        };
      }
      if (part.functionResponse && typeof part.functionResponse.name === 'string') {
        cloned.functionResponse = {
          ...(part.functionResponse.id ? { id: String(part.functionResponse.id) } : {}),
          name: String(part.functionResponse.name),
          response:
            part.functionResponse.response &&
            typeof part.functionResponse.response === 'object'
              ? { ...part.functionResponse.response }
              : { result: part.functionResponse.response },
          ...(Array.isArray(part.functionResponse.parts) &&
          part.functionResponse.parts.length > 0
            ? { parts: part.functionResponse.parts }
            : {}),
        };
      }
      if (part.inlineData && part.inlineData.mimeType && part.inlineData.data) {
        cloned.inlineData = {
          mimeType: part.inlineData.mimeType,
          data: part.inlineData.data,
        };
      }

      if (Object.keys(cloned).length > 0) {
        cleanedParts.push(cloned);
      }
    }

    if (cleanedParts.length > 0) {
      sanitized.push({ role, parts: cleanedParts });
    }
  }

  // Prevent model-turn prefilling unless explicitly inspecting tool-call intermediate state
  if (!allowTrailingModelTurn) {
    while (sanitized.length > 0 && sanitized[sanitized.length - 1].role === 'model') {
      const lastParts = sanitized[sanitized.length - 1].parts;
      const hasFunctionCall = lastParts.some((p) => Boolean(p.functionCall));
      if (hasFunctionCall) break;
      sanitized.pop();
    }
  }

  return sanitized;
}

/**
 * Builds an ordered `user` turn containing `functionResponse` parts that match the model's
 * `functionCall` parts in exact order, preserving `id` and `name`, and embedding multimodal
 * parts inside `functionResponse` when present.
 */
export function buildOrderedFunctionResponseTurn(
  modelFunctionCalls: GeminiFunctionCallPart[],
  executionResults: Array<{
    id?: string;
    name: string;
    result: Record<string, unknown>;
    multimodalParts?: Array<{
      inlineData?: { mimeType: string; data: string };
      fileData?: { mimeType: string; fileUri: string };
    }>;
  }>
): GeminiContentTurn {
  const parts: GeminiContentPart[] = modelFunctionCalls.map((call, index) => {
    const matched =
      (call.id
        ? executionResults.find((r) => r.id === call.id && r.name === call.name)
        : null) ??
      executionResults[index] ??
      executionResults.find((r) => r.name === call.name);

    const responseObj =
      matched?.result && typeof matched.result === 'object'
        ? matched.result
        : { result: matched?.result ?? null };

    const fnResponse: GeminiFunctionResponsePayload = {
      ...(call.id ? { id: String(call.id) } : matched?.id ? { id: String(matched.id) } : {}),
      name: call.name,
      response: responseObj,
    };

    if (Array.isArray(matched?.multimodalParts) && matched.multimodalParts.length > 0) {
      fnResponse.parts = matched.multimodalParts;
    }

    return { functionResponse: fnResponse };
  });

  return {
    role: 'user',
    parts,
  };
}

/**
 * Computes token consumption and estimated USD cost for comparative benchmarking.
 * Pricing reference per 1M tokens:
 * - `gemini-2.5-flash`: $0.30 / 1M input, $2.50 / 1M output (including thinking)
 * - `gemini-3.5-flash-lite` / `gemini-3.1-flash-lite` / `gemini-2.5-flash-lite`: $0.10 / 1M input, $0.40 / 1M output
 */
export function computeGeminiUsageMetrics(
  model: string,
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    totalTokenCount?: number;
  } | null
): GeminiUsageMetrics {
  const promptTokenCount = Number(usageMetadata?.promptTokenCount || 0);
  const candidatesTokenCount = Number(usageMetadata?.candidatesTokenCount || 0);
  const thoughtsTokenCount = Number(usageMetadata?.thoughtsTokenCount || 0);
  const totalTokenCount =
    Number(usageMetadata?.totalTokenCount || 0) ||
    promptTokenCount + candidatesTokenCount + thoughtsTokenCount;

  const isLite = String(model || '').toLowerCase().includes('lite');
  const inputRatePerMillion = isLite ? 0.10 : 0.30;
  const outputRatePerMillion = isLite ? 0.40 : 2.50;

  const estimatedCostUsd = Number(
    (
      (promptTokenCount / 1_000_000) * inputRatePerMillion +
      ((candidatesTokenCount + thoughtsTokenCount) / 1_000_000) * outputRatePerMillion
    ).toFixed(8)
  );

  return {
    promptTokenCount,
    candidatesTokenCount,
    thoughtsTokenCount,
    totalTokenCount,
    estimatedCostUsd,
  };
}

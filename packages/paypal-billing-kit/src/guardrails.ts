import type { GuardrailEvaluation, GuardrailPolicy } from './types';
import { inspectForClinicalData } from './phiAllowlist';

export const HARD_MAX_SINGLE_ACTION_MINOR = 50_000; // $500.00 USD
export const HARD_MAX_DAILY_LIMIT_MINOR = 250_000; // $2,500.00 USD

export function clampGuardrailPolicy(partial?: Partial<GuardrailPolicy>): GuardrailPolicy {
  const rawSingle = partial?.maxSingleActionMinor ?? HARD_MAX_SINGLE_ACTION_MINOR;
  const rawDaily = partial?.dailyLimitMinor ?? HARD_MAX_DAILY_LIMIT_MINOR;

  return {
    maxSingleActionMinor: Math.max(0, Math.min(HARD_MAX_SINGLE_ACTION_MINOR, Math.trunc(rawSingle))),
    dailyLimitMinor: Math.max(0, Math.min(HARD_MAX_DAILY_LIMIT_MINOR, Math.trunc(rawDaily))),
    usedTodayMinor: Math.max(0, Math.trunc(partial?.usedTodayMinor ?? 0)),
    requireHumanApproval: true,
    blockClinicalData: true,
    paypalConfirmationRequired: true,
  };
}

export function evaluateAiFinancialGuardrail(params: {
  amountMinor: number;
  policy?: Partial<GuardrailPolicy>;
  payloadToInspect?: unknown;
}): GuardrailEvaluation {
  const policy = clampGuardrailPolicy(params.policy);
  const requested = Math.trunc(params.amountMinor);
  const violations: string[] = [];

  if (!Number.isFinite(requested) || requested <= 0) {
    violations.push('Requested amount must be a positive integer in minor currency units (cents).');
  }

  const singleOk = requested > 0 && requested <= policy.maxSingleActionMinor;
  if (!singleOk) {
    violations.push(
      `Requested amount ($${(requested / 100).toFixed(2)}) exceeds the single AI-assisted action limit ($${(
        policy.maxSingleActionMinor / 100
      ).toFixed(2)}).`
    );
  }

  const dailyOk = requested > 0 && policy.usedTodayMinor + requested <= policy.dailyLimitMinor;
  if (!dailyOk) {
    violations.push(
      `Requested amount ($${(requested / 100).toFixed(2)}) plus today's approved AI total ($${(
        policy.usedTodayMinor / 100
      ).toFixed(2)}) exceeds the daily AI limit ($${(policy.dailyLimitMinor / 100).toFixed(2)}).`
    );
  }

  if (params.payloadToInspect !== undefined) {
    const phiCheck = inspectForClinicalData(params.payloadToInspect, 'proposal');
    if (!phiCheck.allowed) {
      violations.push(...phiCheck.violations);
    }
  }

  return {
    passed: violations.length === 0 && singleOk && dailyOk,
    singleOk,
    dailyOk,
    humanApprovalRequired: true,
    clinicalDataBlocked: true,
    paypalConfirmationRequired: true,
    singleLimitMinor: policy.maxSingleActionMinor,
    dailyLimitMinor: policy.dailyLimitMinor,
    usedTodayMinor: policy.usedTodayMinor,
    requestedAmountMinor: requested,
    violationReasons: violations,
  };
}

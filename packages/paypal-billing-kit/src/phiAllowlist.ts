/**
 * Outbound Sensitive / Clinical Data Allowlist & Sanitizer for PayPal API payloads.
 * Rejects any payload containing clinical keys, medical record fields, ICD/CPT diagnosis free-text,
 * or unexpected object keys outside the strict administrative billing allowlist.
 */

const FORBIDDEN_CLINICAL_KEY_PATTERN =
  /(?:diagnosis|diagnoses|icd|symptom|medication|prescription|allerg|vital|blood_pressure|heart_rate|glucose|clinical|medical_record|soap_note|lab_result|pathology|radiology|treatment_plan|health_log|doctor_log|kb_chunk|kb_document|phi|hipaa_note)/i;

const FORBIDDEN_CLINICAL_TEXT_PATTERN =
  /\b(?:icd-?10|diagnosis\s*:|symptoms?\s*:|prescribed|mg\s+daily|mmhg|blood\s+pressure|hba1c|patient\s+presents\s+with|chief\s+complaint|clinical\s+impression)\b/i;

const ALLOWED_SERVICE_CODE_PATTERN = /^ADMIN-[A-Z0-9_-]{2,28}$/;

export interface PhiSanitizationResult {
  allowed: boolean;
  violations: string[];
}

export function inspectForClinicalData(value: unknown, path = 'root'): PhiSanitizationResult {
  const violations: string[] = [];

  function walk(node: unknown, currentPath: string) {
    if (node === null || node === undefined) return;
    if (typeof node === 'string') {
      if (FORBIDDEN_CLINICAL_TEXT_PATTERN.test(node)) {
        violations.push(`Forbidden clinical/medical text pattern at ${currentPath}`);
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((child, idx) => walk(child, `${currentPath}[${idx}]`));
      return;
    }
    if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (FORBIDDEN_CLINICAL_KEY_PATTERN.test(k)) {
          violations.push(`Forbidden clinical key "${k}" at ${currentPath}.${k}`);
        }
        walk(v, `${currentPath}.${k}`);
      }
    }
  }

  walk(value, path);
  return {
    allowed: violations.length === 0,
    violations,
  };
}

export function assertPhiFreePayload(value: unknown, contextLabel = 'PayPal payload'): void {
  const check = inspectForClinicalData(value, contextLabel);
  if (!check.allowed) {
    throw new Error(
      `[PayPal PHI Guardrail] Blocked outbound ${contextLabel}: ${check.violations.join('; ')}`
    );
  }
}

export function sanitizeAdministrativeDescription(
  serviceCode: string,
  description: string
): { serviceCode: string; description: string } {
  const normalizedCode = String(serviceCode || '').trim().toUpperCase();
  if (!ALLOWED_SERVICE_CODE_PATTERN.test(normalizedCode)) {
    throw new Error(
      `[PayPal PHI Guardrail] Service code "${normalizedCode}" is not in the administrative allowlist (ADMIN-*).`
    );
  }
  const cleanDescription = String(description || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  if (!cleanDescription) {
    throw new Error('[PayPal PHI Guardrail] Administrative description is required.');
  }
  assertPhiFreePayload({ serviceCode: normalizedCode, description: cleanDescription }, 'lineItem');
  return {
    serviceCode: normalizedCode,
    description: cleanDescription,
  };
}

export function maskEmailAddress(email: string | null | undefined): string | null {
  const clean = String(email || '').trim();
  const atIndex = clean.indexOf('@');
  if (atIndex <= 0) return null;
  const local = clean.slice(0, atIndex);
  const domain = clean.slice(atIndex + 1);
  if (!domain) return null;
  return `${local.charAt(0)}***@${domain}`;
}

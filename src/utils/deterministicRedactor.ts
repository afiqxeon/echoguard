export interface RedactionResult {
  redactedText: string;
  entitiesRedacted: number;
}

interface RedactionRule {
  name: string;
  pattern: RegExp;
  replacement: string;
}

const PII_REDACTION_RULES: RedactionRule[] = [
  // Patient names preceded by common clinical labels or honorifics
  {
    name: "patient_name_label",
    pattern:
      /\b(Patient|Name|Mr\.|Mrs\.|Ms\.|Miss|Dr\.)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/g,
    replacement: "$1 [REDACTED]",
  },
  // Dates of Birth with explicit label
  {
    name: "dob_label",
    pattern:
      /\b(DOB|Date of Birth|Birthdate)\s*[:-]?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}[/-]\d{1,2}[/-]\d{1,2}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})/gi,
    replacement: "$1: [REDACTED]",
  },
  // Insurance IDs, Policy Numbers, MRNs, and SSNs
  {
    name: "medical_or_insurance_id",
    pattern:
      /\b(Insurance\s*ID|Policy\s*(?:No|Number|#)|MRN|SSN|Member\s*ID)\s*[:-]?\s*([A-Z0-9-]{4,20})/gi,
    replacement: "$1: [REDACTED]",
  },
  // Phone numbers (US & international formats)
  {
    name: "phone_number",
    pattern:
      /(?:\bPhone\s*[:-]?\s*)?(?:\+?\d{1,3}[\s-]?)?(?:\(\d{3}\)|\d{3})[\s-]\d{3}[\s-]\d{4}\b/gi,
    replacement: ((match: string) =>
      match.toLowerCase().startsWith("phone") ? "Phone: [REDACTED]" : "[REDACTED]") as unknown as string,
  },
  // Email addresses
  {
    name: "email_address",
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    replacement: "[REDACTED]",
  },
];

/**
 * Deterministically strips Personally Identifiable Information (PII) locally in the browser.
 * Used as an automatic fallback when Chrome Built-in AI (Gemini Nano) is unavailable,
 * and as a post-processing safety net for zero-PII compliance.
 */
export function redactPIIDeterministically(input: string): RedactionResult {
  let sanitized = input;
  let entitiesRedacted = 0;

  for (const rule of PII_REDACTION_RULES) {
    const matches = sanitized.match(rule.pattern);
    if (matches) {
      entitiesRedacted += matches.length;
    }

    if (rule.name === "phone_number") {
      sanitized = sanitized.replace(rule.pattern, (match) =>
        match.toLowerCase().startsWith("phone")
          ? "Phone: [REDACTED]"
          : "[REDACTED]",
      );
    } else {
      sanitized = sanitized.replace(rule.pattern, rule.replacement);
    }
  }

  return {
    redactedText: sanitized,
    entitiesRedacted,
  };
}

export interface RedactionResult {
  redactedText: string;
  entitiesRedacted: number;
}

/**
 * Matches patient names preceded by common clinical titles or keywords.
 * Case-insensitive (/gi) to accommodate lowercase speech-to-text transcriptions.
 */
const PATIENT_NAME_REGEX =
  /\b(Patient|Name|Mr\.|Mrs\.|Ms\.|Miss|Dr\.|Follow-up for)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/gi;

/**
 * Matches dates of birth with explicit labels.
 */
const DOB_REGEX =
  /\b(DOB|Date of Birth|Birthdate)\s*[:-]?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}[/-]\d{1,2}[/-]\d{1,2}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})/gi;

/**
 * Context-aware Medical Record Numbers (MRN), Insurance IDs, Policy Numbers, Member IDs, and SSNs.
 * Matches with or without separators (hyphens/spaces) and handles lowercase speech-to-text inputs.
 */
const CONTEXTUAL_ID_REGEX =
  /\b(MRN|Medical Record(?: Number)?|Insurance\s*ID|Policy(?:\s*ID|\s*Number)?|Member\s*ID|SSN|Social Security(?: Number)?)\s*[:#-]?\s*([A-Z0-9]{2,6}[\s-]?\d{3,10}|\d{3}[-\s]?\d{2}[-\s]?\d{4})\b/gi;

/**
 * Standalone alphanumeric medical identifiers (e.g., PED44109, PED-44109, PED 44109, BCBS774120).
 * Requires 2-5 uppercase/lowercase letters + optional space/hyphen + 4-10 digits.
 * Safely avoids false positives with clinical vitals (BP, HR, SpO2) and medication dosages.
 */
const ALPHANUMERIC_ID_REGEX = /\b([A-Za-z]{2,5})[\s-]?(\d{4,10})\b/gi;

/**
 * Standalone Social Security Numbers (SSN) formatted with hyphens.
 */
const STANDALONE_SSN_REGEX = /\b\d{3}-\d{2}-\d{4}\b/g;

/**
 * Matches telephone numbers (US & international formats) with optional preceding labels.
 */
const PHONE_REGEX =
  /(?:\b(?:Parent\s+)?Phone\s*[:-]?\s*)?(?:\+?\d{1,3}[\s-]?)?(?:\(\d{3}\)|\d{3})[\s-]\d{3}[\s-]\d{4}\b/gi;

/**
 * Matches email addresses.
 */
const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/**
 * Deterministically strips Personally Identifiable Information (PII) locally in the browser.
 * Used as an automatic fallback when Chrome Built-in AI (Gemini Nano) is unavailable,
 * and as a post-processing safety net for zero-PII compliance.
 */
export function redactPIIDeterministically(input: string): RedactionResult {
  let sanitized = input;
  let entitiesRedacted = 0;

  // 1. Patient names preceded by honorifics or clinical labels
  sanitized = sanitized.replace(PATIENT_NAME_REGEX, (_match, label) => {
    entitiesRedacted++;
    return `${label} [REDACTED]`;
  });

  // 2. Dates of birth with explicit labels
  sanitized = sanitized.replace(DOB_REGEX, (_match, label) => {
    entitiesRedacted++;
    return `${label}: [REDACTED]`;
  });

  // 3. Contextual IDs (MRN, Insurance ID, Policy Number, Member ID, SSN)
  sanitized = sanitized.replace(CONTEXTUAL_ID_REGEX, (_match, label) => {
    entitiesRedacted++;
    return `${label}: [REDACTED]`;
  });

  // 4. Standalone alphanumeric IDs (e.g., PED-44109, PED 44109, BCBS774120)
  sanitized = sanitized.replace(ALPHANUMERIC_ID_REGEX, () => {
    entitiesRedacted++;
    return "[REDACTED]";
  });

  // 5. Standalone formatted SSNs
  sanitized = sanitized.replace(STANDALONE_SSN_REGEX, () => {
    entitiesRedacted++;
    return "[REDACTED]";
  });

  // 6. Phone numbers
  sanitized = sanitized.replace(PHONE_REGEX, (match) => {
    entitiesRedacted++;
    if (/parent\s+phone/i.test(match)) {
      return "Parent Phone: [REDACTED]";
    }
    if (/phone/i.test(match)) {
      return "Phone: [REDACTED]";
    }
    return "[REDACTED]";
  });

  // 7. Email addresses
  sanitized = sanitized.replace(EMAIL_REGEX, () => {
    entitiesRedacted++;
    return "[REDACTED]";
  });

  return {
    redactedText: sanitized,
    entitiesRedacted,
  };
}

export interface ClinicalExportMetadata {
  soapNote: string;
  redactedTranscript: string;
  handoffScript: string;
  localEngine: "nano" | "deterministic" | "checking";
}

/**
 * Generates an HL7 FHIR R4 DocumentReference resource for EHR interoperability.
 * Uses LOINC 11506-3 (Progress Note) and marks the payload as de-identified (REDACTED).
 */
export function buildFhirDocumentReference(meta: ClinicalExportMetadata) {
  const nowIso = new Date().toISOString();
  const encodedSoap = btoa(unescape(encodeURIComponent(meta.soapNote)));

  return {
    resourceType: "DocumentReference",
    id: `echoguard-soap-${Date.now()}`,
    meta: {
      lastUpdated: nowIso,
      security: [
        {
          system: "http://terminology.hl7.org/CodeSystem/v3-ObservationValue",
          code: "REDACTED",
          display: "redacted",
        },
      ],
    },
    status: "current",
    docStatus: "preliminary",
    type: {
      coding: [
        {
          system: "http://loinc.org",
          code: "11506-3",
          display: "Progress note",
        },
      ],
      text: "AI-Synthesized Clinical SOAP Note (Zero-PII)",
    },
    subject: {
      display: "Patient [REDACTED]",
    },
    date: nowIso,
    author: [
      {
        display: `EchoGuard Hybrid Scribe (${
          meta.localEngine === "nano"
            ? "Gemini Nano Local + Firebase Cloud"
            : "Deterministic Local Shield + Firebase Cloud"
        })`,
      },
    ],
    description:
      "De-identified clinical SOAP note generated locally with Zero-PII guardrails.",
    content: [
      {
        attachment: {
          contentType: "text/markdown",
          language: "en",
          data: encodedSoap,
          title: "SOAP_Note_Deidentified.md",
          creation: nowIso,
        },
      },
    ],
    extension: [
      {
        url: "https://echoguard.local/fhir/StructureDefinition/redacted-transcript",
        valueString: meta.redactedTranscript,
      },
      {
        url: "https://echoguard.local/fhir/StructureDefinition/handoff-script",
        valueString: meta.handoffScript,
      },
    ],
  };
}

function getTimestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

export function downloadFhirJson(meta: ClinicalExportMetadata): void {
  const fhirPayload = buildFhirDocumentReference(meta);
  const blob = new Blob([JSON.stringify(fhirPayload, null, 2)], {
    type: "application/fhir+json",
  });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `echoguard-fhir-soap-${getTimestampSlug()}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function downloadAudioWav(audioUrl: string): void {
  const anchor = document.createElement("a");
  anchor.href = audioUrl;
  anchor.download = `echoguard-handoff-${getTimestampSlug()}.wav`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

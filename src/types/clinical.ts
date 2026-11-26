export type LocalEngineMode = "checking" | "nano" | "deterministic";

export type EngineStatus =
  | "checking"
  | "downloading"
  | "ready"
  | "fallback"
  | "processing_local"
  | "processing_cloud"
  | "processing_audio"
  | "error";

export type PipelineStage = "idle" | "local" | "cloud" | "audio" | "done";

export interface PrivacyAuditReceipt {
  entitiesStripped: number;
  verifiedAt: string;
}

export interface SoapErrorInfo {
  title: string;
  detail: string;
}

export interface ClinicalSessionRecord {
  id: string;
  encounterId: string;
  createdAt: string;
  previewTitle: string;
  redactedTranscript: string;
  soapNote: string;
  handoffScript: string;
  entitiesStripped: number;
  doctorVoice: string;
  nurseVoice: string;
}

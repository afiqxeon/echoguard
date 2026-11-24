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

const SESSION_STORAGE_KEY = "echoguard_sessions_v1";
const MAX_STORED_SESSIONS = 20;

export function loadSessions(): ClinicalSessionRecord[] {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSession(
  session: Omit<
    ClinicalSessionRecord,
    "id" | "encounterId" | "createdAt" | "previewTitle"
  >,
): ClinicalSessionRecord[] {
  const existing = loadSessions();

  // Extract a clean, de-identified title snippet from the redacted transcript
  const cleanSnippet = session.redactedTranscript
    .replace(/\([^)]*\[REDACTED\][^)]*\)/g, "") // Hapus blok kurung berisi PII seperti (DOB: [REDACTED], ...)
    .replace(/\[REDACTED\]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const previewTitle =
    cleanSnippet.length > 65
      ? `${cleanSnippet.slice(0, 65)}...`
      : cleanSnippet || "De-identified Clinical Session";

  const randomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
  const encounterId = `ENC-${randomCode}`;

  const newRecord: ClinicalSessionRecord = {
    ...session,
    id: `sess-${Date.now()}`,
    encounterId,
    createdAt: new Date().toISOString(),
    previewTitle,
  };

  const updated = [newRecord, ...existing].slice(0, MAX_STORED_SESSIONS);

  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.warn("Failed to save session to localStorage:", err);
  }

  return updated;
}

export function deleteSession(id: string): ClinicalSessionRecord[] {
  const updated = loadSessions().filter((item) => item.id !== id);
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.warn("Failed to delete session:", err);
  }
  return updated;
}

export function clearAllSessions(): void {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch (err) {
    console.warn("Failed to clear sessions:", err);
  }
}

import type { EchoGuardSettings, VoiceOption } from "../types/settings";

export type { EchoGuardSettings, VoiceOption };

export const DOCTOR_VOICE_OPTIONS: VoiceOption[] = [
  {
    id: "Fenrir",
    label: "Senior Attending (Male)",
    tone: "Deep, calm, authoritative",
  },
  {
    id: "Orus",
    label: "ER Physician (Male)",
    tone: "Firm, decisive, clinical",
  },
  {
    id: "Kore",
    label: "Attending Physician (Female)",
    tone: "Professional, articulate, firm",
  },
];

export const NURSE_VOICE_OPTIONS: VoiceOption[] = [
  {
    id: "Aoede",
    label: "Charge Nurse (Female)",
    tone: "Warm, steady, experienced",
  },
  {
    id: "Leda",
    label: "Triage / ER Nurse (Female)",
    tone: "Clear, alert, responsive",
  },
  {
    id: "Puck",
    label: "ICU / Clinical Nurse (Male)",
    tone: "Clear, energetic, dependable",
  },
];

export const DICTATION_LANGUAGES = [
  { code: "en-US", label: "English (US)" },
  { code: "en-GB", label: "English (UK)" },
  { code: "id-ID", label: "Indonesian (Bahasa Indonesia)" },
];

const SETTINGS_STORAGE_KEY = "echoguard_settings_v1";

export const DEFAULT_SETTINGS: EchoGuardSettings = {
  doctorVoice: "Fenrir",
  nurseVoice: "Aoede",
  dictationLanguage: "en-US",
  strictDeterministicPreFilter: true,
};

export function loadSettings(): EchoGuardSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: EchoGuardSettings): boolean {
  try {
    if (!settings.doctorVoice || !settings.nurseVoice) {
      return false;
    }
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch (err) {
    console.warn("Failed to persist EchoGuard settings:", err);
    return false;
  }
}

import React, { useState, useEffect, useRef } from "react";
import {
  type EchoGuardSettings,
  DOCTOR_VOICE_OPTIONS,
  NURSE_VOICE_OPTIONS,
  DICTATION_LANGUAGES,
  DEFAULT_SETTINGS,
} from "../utils/settingsStorage";
import { generateSingleVoicePreview } from "../services/firebaseHybrid";

interface SettingsModalProps {
  isOpen: boolean;
  settings: EchoGuardSettings;
  engineMode: "checking" | "nano" | "deterministic";
  onClose: () => void;
  onSave: (updated: EchoGuardSettings) => boolean;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  settings,
  engineMode,
  onClose,
  onSave,
}) => {
  const [draft, setDraft] = useState<EchoGuardSettings>(settings);
  const [prevSettings, setPrevSettings] = useState<EchoGuardSettings>(settings);
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  const [previewingRole, setPreviewingRole] = useState<
    "Doctor" | "Nurse" | null
  >(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Synchronize draft state if settings prop changes externally
  if (settings !== prevSettings) {
    setPrevSettings(settings);
    setDraft(settings);
  }

  // Reset preview states when modal closes or opens
  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    setSaveStatus("idle");
    if (!isOpen) {
      setTestError(null);
    }
  }

  // Stop playback when modal closes or unmounts
  useEffect(() => {
    if (!isOpen && audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, [isOpen]);

  const handlePreviewVoice = async (
    role: "Doctor" | "Nurse",
    voiceName: string,
  ) => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    setPreviewingRole(role);
    setTestError(null);

    try {
      const audioUrl = await generateSingleVoicePreview(voiceName, role);
      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      audio.onended = () => {
        if (audioUrl.startsWith("blob:")) {
          URL.revokeObjectURL(audioUrl);
        }
      };
      await audio.play();
    } catch (err) {
      console.error(`Failed to preview ${role} voice:`, err);
      setTestError(`Failed to preview ${voiceName}. Please try again.`);
    } finally {
      setPreviewingRole(null);
    }
  };

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const isSuccess = onSave(draft);

    if (isSuccess) {
      setSaveStatus("saved");
      setTimeout(() => {
        onClose();
      }, 800);
    } else {
      setSaveStatus("error");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(15, 23, 42, 0.5)",
        backdropFilter: "blur(4px)",
        padding: "16px",
      }}
    >
      <div
        className="w-full max-w-lg rounded-xl bg-white shadow-xl border border-slate-200 overflow-hidden"
        style={{
          width: "100%",
          maxWidth: "32rem",
          borderRadius: "12px",
          backgroundColor: "#ffffff",
          boxShadow:
            "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
          border: "1px solid #e2e8f0",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 24px",
            borderBottom: "1px solid #e2e8f0",
            backgroundColor: "#f8fafc",
          }}
        >
          <div>
            <h2
              className="text-base font-semibold text-slate-900"
              style={{
                margin: 0,
                fontSize: "16px",
                fontWeight: 600,
                color: "#0f172a",
              }}
            >
              Clinical Scribe Settings
            </h2>
            <p
              className="text-xs text-slate-500"
              style={{ margin: "4px 0 0 0", fontSize: "12px", color: "#64748b" }}
            >
              Configure multi-speaker handoff voices, dictation, and local privacy
              guardrails.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-sm font-medium px-2 py-1"
            style={{
              background: "none",
              border: "none",
              color: "#94a3b8",
              fontSize: "16px",
              cursor: "pointer",
              padding: "4px 8px",
            }}
            aria-label="Close settings"
          >
            ✕
          </button>
        </div>

        {/* Form Body */}
        <form
          onSubmit={handleSave}
          className="p-6 space-y-6"
          style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "24px" }}
        >
          {/* Section 1: Multi-Speaker Audio Handoff */}
          <section
            className="space-y-3"
            style={{ display: "flex", flexDirection: "column", gap: "12px" }}
          >
            <h3
              className="text-xs font-semibold uppercase tracking-wider text-slate-500"
              style={{
                margin: 0,
                fontSize: "11px",
                fontWeight: 600,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                color: "#64748b",
              }}
            >
              Multi-Speaker Audio Handoff (TTS)
            </h3>
            <div
              className="space-y-3"
              style={{ display: "flex", flexDirection: "column", gap: "12px" }}
            >
              {/* Doctor Voice Row */}
              <div>
                <label
                  className="block text-xs font-medium text-slate-700 mb-1"
                  style={{
                    display: "block",
                    fontSize: "12px",
                    fontWeight: 500,
                    color: "#334155",
                    marginBottom: "4px",
                  }}
                >
                  Doctor Voice Profile
                </label>
                <div
                  className="flex items-center gap-2"
                  style={{ display: "flex", alignItems: "center", gap: "8px" }}
                >
                  <select
                    value={draft.doctorVoice}
                    onChange={(e) =>
                      setDraft({ ...draft, doctorVoice: e.target.value })
                    }
                    className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
                    style={{
                      flex: 1,
                      borderRadius: "8px",
                      border: "1px solid #cbd5e1",
                      backgroundColor: "#ffffff",
                      padding: "8px 12px",
                      fontSize: "14px",
                      color: "#1e293b",
                    }}
                  >
                    {DOCTOR_VOICE_OPTIONS.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label} — {v.tone}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => handlePreviewVoice("Doctor", draft.doctorVoice)}
                    disabled={previewingRole !== null}
                    title="Preview Doctor voice"
                    className="px-3 py-2 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-700 disabled:opacity-50 transition-colors"
                    style={{
                      padding: "8px 12px",
                      borderRadius: "8px",
                      border: "1px solid #cbd5e1",
                      backgroundColor: "#f8fafc",
                      color: "#334155",
                      cursor: previewingRole !== null ? "not-allowed" : "pointer",
                      opacity: previewingRole !== null ? 0.5 : 1,
                      fontSize: "14px",
                    }}
                  >
                    {previewingRole === "Doctor" ? "..." : "🔊"}
                  </button>
                </div>
              </div>

              {/* Nurse Voice Row */}
              <div>
                <label
                  className="block text-xs font-medium text-slate-700 mb-1"
                  style={{
                    display: "block",
                    fontSize: "12px",
                    fontWeight: 500,
                    color: "#334155",
                    marginBottom: "4px",
                  }}
                >
                  Nurse Voice Profile
                </label>
                <div
                  className="flex items-center gap-2"
                  style={{ display: "flex", alignItems: "center", gap: "8px" }}
                >
                  <select
                    value={draft.nurseVoice}
                    onChange={(e) =>
                      setDraft({ ...draft, nurseVoice: e.target.value })
                    }
                    className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
                    style={{
                      flex: 1,
                      borderRadius: "8px",
                      border: "1px solid #cbd5e1",
                      backgroundColor: "#ffffff",
                      padding: "8px 12px",
                      fontSize: "14px",
                      color: "#1e293b",
                    }}
                  >
                    {NURSE_VOICE_OPTIONS.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label} — {v.tone}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => handlePreviewVoice("Nurse", draft.nurseVoice)}
                    disabled={previewingRole !== null}
                    title="Preview Nurse voice"
                    className="px-3 py-2 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-700 disabled:opacity-50 transition-colors"
                    style={{
                      padding: "8px 12px",
                      borderRadius: "8px",
                      border: "1px solid #cbd5e1",
                      backgroundColor: "#f8fafc",
                      color: "#334155",
                      cursor: previewingRole !== null ? "not-allowed" : "pointer",
                      opacity: previewingRole !== null ? 0.5 : 1,
                      fontSize: "14px",
                    }}
                  >
                    {previewingRole === "Nurse" ? "..." : "🔊"}
                  </button>
                </div>
              </div>
            </div>

            {testError && (
              <p
                className="text-xs text-red-600"
                style={{ margin: 0, fontSize: "12px", color: "#dc2626" }}
              >
                {testError}
              </p>
            )}
          </section>

          {/* Section 2: Dictation */}
          <section
            className="space-y-3 pt-4 border-t border-slate-100"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "12px",
              paddingTop: "16px",
              borderTop: "1px solid #f1f5f9",
            }}
          >
            <h3
              className="text-xs font-semibold uppercase tracking-wider text-slate-500"
              style={{
                margin: 0,
                fontSize: "11px",
                fontWeight: 600,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                color: "#64748b",
              }}
            >
              Live Clinical Dictation
            </h3>
            <div>
              <label
                className="block text-xs font-medium text-slate-700 mb-1"
                style={{
                  display: "block",
                  fontSize: "12px",
                  fontWeight: 500,
                  color: "#334155",
                  marginBottom: "4px",
                }}
              >
                Speech Recognition Language
              </label>
              <select
                value={draft.dictationLanguage}
                onChange={(e) =>
                  setDraft({ ...draft, dictationLanguage: e.target.value })
                }
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
                style={{
                  width: "100%",
                  borderRadius: "8px",
                  border: "1px solid #cbd5e1",
                  backgroundColor: "#ffffff",
                  padding: "8px 12px",
                  fontSize: "14px",
                  color: "#1e293b",
                }}
              >
                {DICTATION_LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.label}
                  </option>
                ))}
              </select>
            </div>
          </section>

          {/* Section 3: Privacy & Runtime Diagnostics (Read-Only) */}
          <section
            className="space-y-2 pt-4 border-t border-slate-100"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              paddingTop: "16px",
              borderTop: "1px solid #f1f5f9",
            }}
          >
            <h3
              className="text-xs font-semibold uppercase tracking-wider text-slate-500"
              style={{
                margin: 0,
                fontSize: "11px",
                fontWeight: 600,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                color: "#64748b",
              }}
            >
              Privacy & Runtime Status
            </h3>
            <div
              className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs text-slate-600 space-y-1"
              style={{
                borderRadius: "8px",
                backgroundColor: "#f8fafc",
                border: "1px solid #e2e8f0",
                padding: "12px",
                fontSize: "12px",
                color: "#475569",
                display: "flex",
                flexDirection: "column",
                gap: "4px",
              }}
            >
              <div
                className="flex justify-between"
                style={{ display: "flex", justifyContent: "space-between" }}
              >
                <span>Local Privacy Shield:</span>
                <span
                  className="font-medium text-emerald-700"
                  style={{ fontWeight: 500, color: "#047857" }}
                >
                  {engineMode === "nano"
                    ? "Gemini Nano + Deterministic Pre-Filter"
                    : "Deterministic Local Shield"}
                </span>
              </div>
              <div
                className="flex justify-between"
                style={{ display: "flex", justifyContent: "space-between" }}
              >
                <span>Cloud Guardrail:</span>
                <span
                  className="font-medium text-slate-800"
                  style={{ fontWeight: 500, color: "#1e293b" }}
                >
                  Firebase App Check (reCAPTCHA Enterprise)
                </span>
              </div>
            </div>
          </section>

          {/* Footer Actions */}
          <div
            className="flex items-center justify-between pt-4 border-t border-slate-200"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              paddingTop: "16px",
              borderTop: "1px solid #e2e8f0",
            }}
          >
            <button
              type="button"
              onClick={() => {
                setDraft(DEFAULT_SETTINGS);
                setSaveStatus("idle");
              }}
              className="text-xs font-medium text-slate-500 hover:text-slate-700"
              style={{
                background: "none",
                border: "none",
                fontSize: "12px",
                fontWeight: 500,
                color: "#64748b",
                cursor: "pointer",
                padding: "4px 0",
              }}
            >
              Reset to Defaults
            </button>
            <div
              className="flex items-center gap-2"
              style={{ display: "flex", alignItems: "center", gap: "8px" }}
            >
              {saveStatus === "error" && (
                <span
                  className="text-xs text-red-600 font-medium"
                  style={{
                    fontSize: "12px",
                    color: "#dc2626",
                    fontWeight: 500,
                  }}
                >
                  Failed to save settings
                </span>
              )}
              <button
                type="button"
                onClick={onClose}
                disabled={saveStatus === "saved"}
                className="px-4 py-2 rounded-lg text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50"
                style={{
                  padding: "8px 16px",
                  borderRadius: "8px",
                  fontSize: "12px",
                  fontWeight: 500,
                  color: "#334155",
                  backgroundColor: "#ffffff",
                  border: "1px solid #cbd5e1",
                  cursor: saveStatus === "saved" ? "not-allowed" : "pointer",
                  opacity: saveStatus === "saved" ? 0.5 : 1,
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saveStatus === "saved"}
                className={`px-4 py-2 rounded-lg text-xs font-medium text-white transition-colors ${
                  saveStatus === "saved"
                    ? "bg-emerald-600"
                    : "bg-slate-900 hover:bg-slate-800"
                }`}
                style={{
                  padding: "8px 16px",
                  borderRadius: "8px",
                  fontSize: "12px",
                  fontWeight: 500,
                  color: "#ffffff",
                  backgroundColor:
                    saveStatus === "saved" ? "#059669" : "#0f172a",
                  border: "none",
                  cursor: saveStatus === "saved" ? "default" : "pointer",
                  transition: "background-color 0.2s ease",
                }}
              >
                {saveStatus === "saved"
                  ? "Preferences Saved ✓"
                  : "Save Preferences"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

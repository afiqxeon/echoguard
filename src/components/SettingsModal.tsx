import React, { useState, useEffect, useRef } from "react";
import {
  type EchoGuardSettings,
  DOCTOR_VOICE_OPTIONS,
  NURSE_VOICE_OPTIONS,
  DEFAULT_SETTINGS,
} from "../utils/settingsStorage";
import { generateSingleVoicePreview } from "../services/firebaseHybrid";
import { CLOUD_MODELS, type CloudModelId } from "../constants/models";

interface SettingsModalProps {
  isOpen: boolean;
  settings: EchoGuardSettings;
  engineMode: "checking" | "nano" | "deterministic";
  cloudModel: CloudModelId;
  onCloudModelChange: (model: CloudModelId) => void;
  onClose: () => void;
  onSave: (updated: EchoGuardSettings) => boolean;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  settings,
  engineMode,
  cloudModel,
  onCloudModelChange,
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
      <div className="w-full max-w-lg mx-4 bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
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
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-700">
                  Doctor Voice Profile
                </label>
                <div className="flex items-center gap-2 w-full">
                  <select
                    value={draft.doctorVoice}
                    onChange={(e) =>
                      setDraft({ ...draft, doctorVoice: e.target.value })
                    }
                    className="flex-1 min-w-0 truncate rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
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
                    title="Preview Doctor Voice"
                    className="shrink-0 h-[38px] w-[38px] inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white hover:bg-slate-50 active:bg-slate-100 disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    {previewingRole === "Doctor" ? "..." : "🔊"}
                  </button>
                </div>
              </div>

              {/* Nurse Voice Row */}
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-700">
                  Nurse Voice Profile
                </label>
                <div className="flex items-center gap-2 w-full">
                  <select
                    value={draft.nurseVoice}
                    onChange={(e) =>
                      setDraft({ ...draft, nurseVoice: e.target.value })
                    }
                    className="flex-1 min-w-0 truncate rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
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
                    title="Preview Nurse Voice"
                    className="shrink-0 h-[38px] w-[38px] inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white hover:bg-slate-50 active:bg-slate-100 disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    {previewingRole === "Nurse" ? "..." : "🔊"}
                  </button>
                </div>
              </div>
            </div>

            {testError && (
              <p className="text-xs text-red-600">
                {testError}
              </p>
            )}
          </section>

          {/* Section 2: Dictation */}
          <section className="space-y-3 pt-4 border-t border-slate-100">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Live Clinical Dictation
            </h3>
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-slate-700">
                Speech Recognition Language
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { value: "en-US", label: "English (US)" },
                  { value: "en-GB", label: "English (UK)" },
                  { value: "id-ID", label: "Indonesia" },
                ].map((lang) => {
                  const isActive = draft.dictationLanguage === lang.value;
                  return (
                    <button
                      key={lang.value}
                      type="button"
                      onClick={() =>
                        setDraft({ ...draft, dictationLanguage: lang.value })
                      }
                      className={`px-2.5 py-2 rounded-lg text-xs font-medium border transition-colors cursor-pointer text-center ${
                        isActive
                          ? "bg-sky-50 text-sky-700 border-sky-400 ring-1 ring-sky-400/30"
                          : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      {lang.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          {/* Section 3: Privacy & Runtime Diagnostics (Read-Only) */}
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
            {/* Cloud Inference Model Dropdown */}
            <div>
              <label
                htmlFor="cloud-model-select"
                className="block text-xs font-semibold text-slate-700 mb-1.5"
              >
                Cloud Inference Model (SOAP & Handoff Script)
              </label>
              <select
                id="cloud-model-select"
                value={cloudModel}
                onChange={(e) => onCloudModelChange(e.target.value as CloudModelId)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
              >
                {CLOUD_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-slate-500">
                Switch models if you hit free-tier daily quota limits or peak demand.
              </p>
            </div>

            <h3
              className="text-xs font-semibold uppercase tracking-wider text-slate-500 pt-1"
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
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">Local Privacy Shield:</span>
                <span className="font-medium text-emerald-700 text-right">
                  {engineMode === "nano"
                    ? "Gemini Nano + Deterministic Pre-Filter"
                    : "Deterministic Local Shield"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">Cloud Inference:</span>
                <span className="font-medium text-slate-800 text-right">
                  Firebase AI Logic ({CLOUD_MODELS.find((m) => m.id === cloudModel)?.label.split(" (")[0] || cloudModel})
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">Cloud Guardrail:</span>
                <span className="font-medium text-slate-800 text-right">
                  Firebase App Check
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

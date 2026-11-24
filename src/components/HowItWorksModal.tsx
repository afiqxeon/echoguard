import React from "react";

interface HowItWorksModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const HowItWorksModal: React.FC<HowItWorksModalProps> = ({
  isOpen,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              How EchoGuard Works
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Zero-Trust Hybrid Architecture: On-Device Privacy + Cloud Intelligence
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors cursor-pointer"
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        {/* 3-Step Pipeline */}
        <div className="mt-4 space-y-3">
          <div className="flex gap-3 rounded-xl border border-emerald-100 bg-emerald-50/60 p-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">
              1
            </span>
            <div className="text-xs">
              <p className="font-semibold text-slate-900">
                Local PII Shield (100% On-Device)
              </p>
              <p className="mt-0.5 text-slate-600 leading-relaxed">
                Dictate via mic or pick a sample. Names, DOBs, MRNs, and phone numbers are stripped locally using a deterministic pre-filter + Chrome&apos;s built-in Gemini Nano before any data leaves your browser.
              </p>
            </div>
          </div>

          <div className="flex gap-3 rounded-xl border border-sky-100 bg-sky-50/60 p-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-600 text-xs font-bold text-white">
              2
            </span>
            <div className="text-xs">
              <p className="font-semibold text-slate-900">
                Cloud SOAP Note Synthesis
              </p>
              <p className="mt-0.5 text-slate-600 leading-relaxed">
                Only the sanitized <code className="rounded bg-white px-1 py-0.5 text-[11px] font-medium text-slate-700">[REDACTED]</code> clinical text is sent to Firebase AI Logic to generate a structured, EHR-ready SOAP note and HL7 FHIR JSON.
              </p>
            </div>
          </div>

          <div className="flex gap-3 rounded-xl border border-rose-100 bg-rose-50/60 p-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-rose-600 text-xs font-bold text-white">
              3
            </span>
            <div className="text-xs">
              <p className="font-semibold text-slate-900">
                Multi-Speaker Audio Handoff
              </p>
              <p className="mt-0.5 text-slate-600 leading-relaxed">
                Converts the SOAP plan into a realistic Doctor &amp; Nurse shift handoff audio briefing using Firebase TTS. All saved sessions stay strictly in local browser storage.
              </p>
            </div>
          </div>
        </div>

        {/* Quick Tips for Reviewers */}
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600 space-y-1">
          <p className="font-semibold text-slate-800">Reviewer Notes:</p>
          <p>
            • <strong>Browser Support:</strong> Best experienced in Chrome with Built-in AI (Gemini Nano) enabled; automatically falls back to the local Deterministic Shield on other browsers.
          </p>
          <p>
            • <strong>Peak Demand / Quota:</strong> If a cloud model is busy, open <strong>Settings</strong> to switch models and click <strong>↻ Regenerate SOAP</strong> without re-running local redaction.
          </p>
        </div>

        {/* Footer */}
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
};

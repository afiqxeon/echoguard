import React, { type ChangeEvent, type RefObject } from "react";
import { SAMPLE_CLINICAL_NOTES } from "../../constants/sampleNotes";
import type { PipelineStage } from "../../types/clinical";
import { SpinnerIcon } from "../common/SpinnerIcon";

interface TranscriptInputCardProps {
  activeSessionId: string | null;
  activeEncounterId?: string;
  input: string;
  sampleIndex: number | null;
  transcriptInputRef: RefObject<HTMLTextAreaElement | null>;
  isEncounterLocked: boolean;
  isProcessing: boolean;
  isActionable: boolean;
  isMicSupported: boolean;
  isListening: boolean;
  interimTranscript: string;
  micError: string | null;
  statusMessage: string;
  ttftMs: number | null;
  localLatencyMs: number | null;
  pipelineStage: PipelineStage;
  onInputChange: (value: string) => void;
  onClearInput: () => void;
  onSelectSample: (sampleText: string, idx: number) => void;
  onToggleListening: () => void;
  onRunPipeline: () => void;
  onNewSession: () => void;
}

export const TranscriptInputCard: React.FC<TranscriptInputCardProps> = ({
  activeSessionId,
  activeEncounterId,
  input,
  sampleIndex,
  transcriptInputRef,
  isEncounterLocked,
  isProcessing,
  isActionable,
  isMicSupported,
  isListening,
  interimTranscript,
  micError,
  statusMessage,
  ttftMs,
  localLatencyMs,
  pipelineStage,
  onInputChange,
  onClearInput,
  onSelectSample,
  onToggleListening,
  onRunPipeline,
  onNewSession,
}) => {
  return (
    <section className="bg-white rounded-xl border border-slate-200 shadow-xs p-5">
      {activeSessionId && (
        <div className="mb-3 flex items-center justify-between rounded-lg bg-sky-50 border border-sky-200 px-3 py-2 text-xs text-sky-900">
          <span>
            Viewing locked encounter{" "}
            <strong className="font-mono">
              {activeEncounterId || "ARCHIVED"}
            </strong>{" "}
            — input locked to prevent cross-patient mix-ups.
          </span>
          <button
            type="button"
            onClick={onNewSession}
            className="font-semibold text-sky-700 hover:underline cursor-pointer"
          >
            + Start New Patient
          </button>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 mb-2.5">
        <label
          htmlFor="raw-transcript"
          className="text-sm font-semibold text-slate-900"
        >
          Raw Patient Consultation Transcript
        </label>
        <span className="text-[11px] font-medium text-slate-400">
          Dictate, type, or pick a sample below
        </span>
      </div>

      <textarea
        id="raw-transcript"
        ref={transcriptInputRef}
        value={input}
        readOnly={isEncounterLocked || isProcessing}
        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
          onInputChange(e.target.value);
        }}
        rows={4}
        placeholder={
          isEncounterLocked
            ? "Encounter locked. Raw PII is never stored—click '+ New Encounter' to start a new patient."
            : "Speak via Live Mic, type clinical notes with patient PII (name, DOB, phone, insurance ID), or select a quick sample..."
        }
        className={`w-full rounded-lg border px-3.5 py-2.5 text-sm placeholder:text-slate-400 resize-y ${
          isEncounterLocked
            ? "border-slate-200 bg-slate-50 text-slate-500 cursor-not-allowed focus:outline-none"
            : "border-slate-300 bg-white text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
        }`}
      />

      {isListening && interimTranscript && (
        <p className="mt-1.5 text-xs text-slate-500 italic">
          Listening: "{interimTranscript}..."
        </p>
      )}
      {micError && (
        <p className="mt-1.5 text-xs text-red-600">{micError}</p>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-medium text-slate-400 mr-1">
          Try sample:
        </span>
        {SAMPLE_CLINICAL_NOTES.map((sample, idx) => {
          const isSelected = sampleIndex === idx && input === sample.text;
          return (
            <button
              key={sample.label}
              type="button"
              onClick={() => onSelectSample(sample.text, idx)}
              disabled={isProcessing || isEncounterLocked || isListening}
              title={
                isListening
                  ? "Stop Live Mic Dictation before selecting a sample"
                  : undefined
              }
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${
                isSelected
                  ? "bg-sky-100 text-sky-800 border-sky-300"
                  : "bg-slate-100 text-slate-600 hover:bg-sky-50 hover:text-sky-700 border-transparent hover:border-sky-200"
              }`}
            >
              {sample.label}
            </button>
          );
        })}
      </div>

      <div className="mt-4 pt-3.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleListening}
            disabled={
              isProcessing ||
              !isMicSupported ||
              (isEncounterLocked && !isListening)
            }
            title={
              isEncounterLocked
                ? "Click '+ New Encounter' to start a new patient consultation"
                : undefined
            }
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${
              isListening
                ? "bg-red-50 text-red-700 border-red-300 animate-pulse"
                : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
            }`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`w-3.5 h-3.5 shrink-0 ${
                isListening ? "text-red-600" : "text-slate-500"
              }`}
              aria-hidden="true"
            >
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" x2="12" y1="19" y2="22" />
            </svg>
            <span>
              {isListening ? "Stop Dictation" : "Live Mic Dictation"}
            </span>
          </button>

          {input.trim().length > 0 && !isProcessing && !isEncounterLocked && (
            <button
              type="button"
              onClick={onClearInput}
              className="px-2.5 py-2 rounded-lg text-xs font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              Clear
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={onRunPipeline}
          disabled={!isActionable}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          <span>
            {isProcessing
              ? "Running Pipeline..."
              : isEncounterLocked
                ? "Encounter Completed"
                : "Run Hybrid AI Pipeline"}
          </span>
          {!isProcessing && !isEncounterLocked && (
            <span aria-hidden="true">→</span>
          )}
        </button>
      </div>

      {(isProcessing || ttftMs !== null || pipelineStage !== "idle") && (
        <div className="mt-3.5 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            {isProcessing && (
              <span className="font-medium text-indigo-600">
                {statusMessage}
              </span>
            )}
            {ttftMs !== null && (
              <span className="font-medium text-sky-700">
                Local First Token (TTFT): <strong>{ttftMs} ms</strong>
              </span>
            )}
            {localLatencyMs !== null && (
              <span className="font-medium text-slate-600">
                Local Total: <strong>{localLatencyMs} ms</strong>
              </span>
            )}
          </div>

          {pipelineStage !== "idle" && (
            <div className="w-full mt-1 flex flex-wrap items-center gap-2">
              <div
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-colors ${
                  pipelineStage === "local"
                    ? "bg-sky-50 text-sky-700 border-sky-300 font-medium"
                    : pipelineStage === "cloud" ||
                        pipelineStage === "audio" ||
                        pipelineStage === "done"
                      ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                      : "bg-slate-50 text-slate-500 border-slate-200"
                }`}
                style={{ whiteSpace: "nowrap" }}
              >
                {pipelineStage === "cloud" ||
                pipelineStage === "audio" ||
                pipelineStage === "done" ? (
                  <span className="text-emerald-700 font-bold">✓</span>
                ) : pipelineStage === "local" ? (
                  <SpinnerIcon size={14} color="#0284c7" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-slate-300" />
                )}
                <span>1. Local PII Shield</span>
              </div>

              <span className="text-slate-300">→</span>

              <div
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-colors ${
                  pipelineStage === "cloud"
                    ? "bg-sky-50 text-sky-700 border-sky-300 font-medium"
                    : pipelineStage === "audio" || pipelineStage === "done"
                      ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                      : "bg-slate-50 text-slate-500 border-slate-200"
                }`}
                style={{ whiteSpace: "nowrap" }}
              >
                {pipelineStage === "audio" || pipelineStage === "done" ? (
                  <span className="text-emerald-700 font-bold">✓</span>
                ) : pipelineStage === "cloud" ? (
                  <SpinnerIcon size={14} color="#0284c7" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-slate-300" />
                )}
                <span>2. Cloud SOAP Note</span>
              </div>

              <span className="text-slate-300">→</span>

              <div
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-colors ${
                  pipelineStage === "audio"
                    ? "bg-sky-50 text-sky-700 border-sky-300 font-medium"
                    : pipelineStage === "done"
                      ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                      : "bg-slate-50 text-slate-500 border-slate-200"
                }`}
                style={{ whiteSpace: "nowrap" }}
              >
                {pipelineStage === "done" ? (
                  <span className="text-emerald-700 font-bold">✓</span>
                ) : pipelineStage === "audio" ? (
                  <SpinnerIcon size={14} color="#0284c7" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-slate-300" />
                )}
                <span>3. Multi-Speaker Audio</span>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

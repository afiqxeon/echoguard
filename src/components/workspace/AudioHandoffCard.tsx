import React from "react";
import type { PipelineStage } from "../../types/clinical";
import { SpinnerIcon } from "../common/SpinnerIcon";

interface AudioHandoffCardProps {
  soapNote: string;
  audioUrl: string;
  audioScript: string;
  audioError: string | null;
  pipelineStage: PipelineStage;
  isProcessing: boolean;
  isRegeneratingAudio: boolean;
  isAudioOutdated: boolean;
  activeDoctorLabel: string;
  activeNurseLabel: string;
  onGenerateAudio: () => void;
}

export const AudioHandoffCard: React.FC<AudioHandoffCardProps> = ({
  soapNote,
  audioUrl,
  audioScript,
  audioError,
  pipelineStage,
  isProcessing,
  isRegeneratingAudio,
  isAudioOutdated,
  activeDoctorLabel,
  activeNurseLabel,
  onGenerateAudio,
}) => {
  return (
    <section className="xl:col-span-5 bg-indigo-50/40 rounded-xl border border-indigo-200 shadow-xs p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 className="text-sm font-semibold text-indigo-950">
          3. Multi-Speaker Action Plan (Doctor &amp; Nurse)
        </h2>
        <div className="flex items-center gap-2">
          {audioUrl && (
            <a
              href={audioUrl}
              download="echoguard-handoff.wav"
              className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-white px-2.5 py-1 text-[11px] font-medium text-indigo-700 hover:bg-indigo-50 transition-colors"
            >
              Download WAV
            </a>
          )}
          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
            FIREBASE TTS
          </span>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-indigo-200 bg-white px-2.5 py-0.5 font-medium text-indigo-700">
            Doctor: {activeDoctorLabel}
          </span>
          <span className="rounded-full border border-indigo-200 bg-white px-2.5 py-0.5 font-medium text-indigo-700">
            Nurse: {activeNurseLabel}
          </span>
        </div>

        {isAudioOutdated && (
          <button
            type="button"
            onClick={onGenerateAudio}
            disabled={isRegeneratingAudio}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-200 disabled:opacity-50 transition-colors cursor-pointer"
          >
            {isRegeneratingAudio
              ? "Regenerating Audio..."
              : "Voice settings changed • Regenerate Audio"}
          </button>
        )}
      </div>

      {audioError && (
        <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-sm">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div>
              <p className="font-semibold text-rose-900">Audio Handoff Paused</p>
              <p className="mt-1 text-xs text-rose-800 leading-relaxed">
                {audioError}
              </p>
            </div>
            {soapNote && (
              <button
                type="button"
                onClick={onGenerateAudio}
                disabled={isRegeneratingAudio}
                className="shrink-0 inline-flex items-center justify-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50 transition-colors cursor-pointer"
              >
                <span>
                  {isRegeneratingAudio ? "Retrying..." : "↻ Retry Audio"}
                </span>
              </button>
            )}
          </div>
        </div>
      )}

      {!soapNote && !audioScript && pipelineStage !== "audio" ? (
        audioError ? null : (
          <p className="text-sm text-indigo-400 italic py-4">
            Awaiting SOAP synthesis to generate Doctor &amp; Nurse audio handoff...
          </p>
        )
      ) : (
        <>
          {pipelineStage === "audio" || isRegeneratingAudio ? (
            <div className="p-4 bg-white/80 rounded-lg border border-indigo-200 flex items-center gap-3 text-indigo-900">
              <SpinnerIcon size={18} color="#4f46e5" />
              <div className="flex flex-col">
                <span className="text-xs font-semibold">
                  Synthesizing Multi-Speaker Handoff Audio...
                </span>
                <span className="text-[11px] text-indigo-700/80">
                  Generating Doctor &amp; Nurse voices via Split-and-Stitch PCM
                </span>
              </div>
            </div>
          ) : audioUrl ? (
            <audio controls src={audioUrl} className="w-full outline-none">
              Your browser does not support the audio element.
            </audio>
          ) : !audioError ? (
            <div className="p-3 bg-white/80 rounded-lg border border-indigo-200 flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-slate-600">
                Audio is not stored in local history. Generate audio handoff for this encounter.
              </span>
              <button
                type="button"
                onClick={onGenerateAudio}
                disabled={isRegeneratingAudio || isProcessing}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition-colors cursor-pointer"
              >
                {isRegeneratingAudio
                  ? "Generating Audio..."
                  : "▶ Generate Audio Handoff"}
              </button>
            </div>
          ) : null}

          {audioScript && (
            <div className="mt-3 p-3 bg-white/80 rounded-lg border border-indigo-200">
              <p className="text-[11px] font-semibold text-indigo-700 mb-2 uppercase tracking-wider">
                Spoken Handoff Script
              </p>
              <div className="space-y-2.5 text-sm text-slate-700 leading-relaxed">
                {audioScript
                  .split(/\n+/)
                  .map((line) => line.trim())
                  .filter(Boolean)
                  .map((line, index) => {
                    const match = line.match(
                      /^(Doctor|Nurse|Dokter|Perawat):\s*(.*)$/i,
                    );

                    if (match) {
                      const [, speaker, dialogue] = match;
                      const isDoctor = /^(Doctor|Dokter)$/i.test(speaker);

                      return (
                        <p key={index} className="leading-relaxed">
                          <strong
                            className={`font-semibold mr-1.5 ${
                              isDoctor ? "text-sky-700" : "text-teal-700"
                            }`}
                          >
                            {speaker}:
                          </strong>
                          <span>{dialogue}</span>
                        </p>
                      );
                    }

                    return (
                      <p key={index} className="leading-relaxed">
                        {line}
                      </p>
                    );
                  })}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
};

import React from "react";
import ReactMarkdown from "react-markdown";
import type { EngineStatus, SoapErrorInfo } from "../../types/clinical";

interface SoapNoteCardProps {
  soapNote: string;
  redactedText: string;
  soapError: SoapErrorInfo | null;
  isProcessing: boolean;
  engineState: EngineStatus;
  isSoapExpanded: boolean;
  copied: boolean;
  onToggleExpand: () => void;
  onRegenerateSoap: () => void;
  onCopySoap: () => void;
  onExportFhir: () => void;
}

export const SoapNoteCard: React.FC<SoapNoteCardProps> = ({
  soapNote,
  redactedText,
  soapError,
  isProcessing,
  engineState,
  isSoapExpanded,
  copied,
  onToggleExpand,
  onRegenerateSoap,
  onCopySoap,
  onExportFhir,
}) => {
  return (
    <section className="xl:col-span-7 xl:row-span-2 flex flex-col bg-white rounded-xl border border-sky-200/80 shadow-xs p-5">
      <div className="flex items-center justify-between gap-2 mb-3 pb-3 border-b border-slate-100">
        <h2 className="text-sm font-semibold text-slate-900">
          2. Cloud SOAP Note Synthesis
        </h2>
        <div className="flex items-center gap-2">
          {!soapError && redactedText && (
            <button
              type="button"
              onClick={onRegenerateSoap}
              disabled={isProcessing}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors cursor-pointer"
            >
              <span>{isProcessing ? "Generating..." : "↻ Regenerate"}</span>
            </button>
          )}
          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-50 text-sky-700 border border-sky-200">
            CLOUD INFERENCE
          </span>
        </div>
      </div>

      {soapError && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-sm">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div>
              <p className="font-semibold text-amber-900">{soapError.title}</p>
              <p className="mt-1 text-xs text-amber-800 leading-relaxed">
                {soapError.detail}
              </p>
            </div>
            {redactedText && (
              <button
                type="button"
                onClick={onRegenerateSoap}
                disabled={isProcessing}
                className="shrink-0 inline-flex items-center justify-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50 transition-colors cursor-pointer"
              >
                <span>{isProcessing ? "Retrying..." : "↻ Regenerate SOAP"}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {soapNote ? (
        <>
          <div className="flex-1 flex flex-col">
            <div
              className={`relative transition-all duration-300 ${
                isSoapExpanded ? "max-h-none" : "max-h-[500px] overflow-hidden"
              }`}
            >
              <div className="text-sm leading-relaxed text-slate-800">
                <ReactMarkdown
                  components={{
                    h2: ({ node: _node, ...props }) => (
                      <h2
                        className="text-base font-bold text-sky-950 mb-3 mt-4 first:mt-0"
                        {...props}
                      />
                    ),
                    p: ({ node: _node, ...props }) => (
                      <p className="mb-3 leading-relaxed" {...props} />
                    ),
                    ul: ({ node: _node, ...props }) => (
                      <ul className="mb-3 pl-5 list-disc space-y-1" {...props} />
                    ),
                    ol: ({ node: _node, ...props }) => (
                      <ol
                        className="mb-3 pl-5 list-decimal space-y-1"
                        {...props}
                      />
                    ),
                  }}
                >
                  {soapNote}
                </ReactMarkdown>
              </div>

              {!isSoapExpanded && soapNote.length > 500 && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-white via-white/90 to-transparent" />
              )}
            </div>

            {soapNote.length > 500 && (
              <button
                type="button"
                onClick={onToggleExpand}
                className="mt-2 self-center inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors cursor-pointer"
              >
                <span>
                  {isSoapExpanded
                    ? "▲ Collapse SOAP Note"
                    : "▼ Expand Full SOAP Note"}
                </span>
              </button>
            )}
          </div>

          <div className="mt-auto pt-4">
            <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
              <button
                type="button"
                onClick={onCopySoap}
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 transition-colors cursor-pointer"
              >
                {copied ? "Copied to Clipboard ✓" : "Copy SOAP Note"}
              </button>
              <button
                type="button"
                onClick={onExportFhir}
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-sky-600 text-white hover:bg-sky-700 transition-colors cursor-pointer"
              >
                Export HL7 FHIR JSON
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="text-sm leading-relaxed text-slate-800 min-h-60">
          {soapError ? (
            <p className="text-slate-400 italic">
              SOAP synthesis paused due to cloud error. Click "↻ Regenerate SOAP" above to retry.
            </p>
          ) : (
            <p className="text-slate-400 italic">
              {isProcessing && engineState === "processing_cloud"
                ? "Analyzing secured payload in Firebase AI..."
                : "Awaiting secure payload..."}
            </p>
          )}
        </div>
      )}
    </section>
  );
};

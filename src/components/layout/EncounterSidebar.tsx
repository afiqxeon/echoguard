import React from "react";
import type { ClinicalSessionRecord } from "../../types/clinical";

interface EncounterSidebarProps {
  sessions: ClinicalSessionRecord[];
  activeSessionId: string | null;
  isHistoryOpen: boolean;
  onCloseHistory: () => void;
  onLoadSession: (record: ClinicalSessionRecord) => void;
  onDeleteSession: (id: string, e: React.MouseEvent) => void;
  onClearHistory: () => void;
}

export const EncounterSidebar: React.FC<EncounterSidebarProps> = ({
  sessions,
  activeSessionId,
  isHistoryOpen,
  onCloseHistory,
  onLoadSession,
  onDeleteSession,
  onClearHistory,
}) => {
  return (
    <>
      {isHistoryOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-[1px] lg:hidden"
          onClick={onCloseHistory}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-80 bg-white border-r border-slate-200 shadow-2xl flex flex-col transition-transform duration-200 ease-out lg:static lg:z-auto lg:w-72 xl:w-80 lg:shadow-none lg:translate-x-0 shrink-0 ${
          isHistoryOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Encounters ({sessions.length})
            </h2>
            <p className="text-[11px] text-slate-400">Local-only • Zero-PII</p>
          </div>

          <div className="flex items-center gap-3">
            {sessions.length > 0 && (
              <button
                type="button"
                onClick={onClearHistory}
                className="text-[11px] font-medium text-red-600 hover:underline cursor-pointer"
              >
                Clear
              </button>
            )}
            <button
              type="button"
              onClick={onCloseHistory}
              className="lg:hidden p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              aria-label="Close history"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="p-3 space-y-2 overflow-y-auto flex-1 lg:max-h-[calc(100vh-120px)]">
          {sessions.length === 0 ? (
            <p className="text-xs text-slate-400 italic p-2">
              No saved encounters yet. Run the pipeline to save a de-identified encounter locally.
            </p>
          ) : (
            sessions.map((item) => {
              const isActive = item.id === activeSessionId;
              return (
                <div
                  key={item.id}
                  onClick={() => onLoadSession(item)}
                  className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                    isActive
                      ? "bg-sky-50 border-sky-300 shadow-xs"
                      : "bg-white border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="shrink-0 px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-[10px] font-semibold border border-slate-200">
                      {item.encounterId || "ENC-LEGACY"}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => onDeleteSession(item.id, e)}
                      className="text-xs text-slate-400 hover:text-red-600 p-0.5 cursor-pointer"
                      title="Delete session"
                    >
                      ✕
                    </button>
                  </div>
                  <p className="text-xs font-medium text-slate-800 truncate mt-1.5">
                    {item.previewTitle}
                  </p>
                  <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500">
                    <span>
                      {new Date(item.createdAt).toLocaleString([], {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <span>•</span>
                    <span className="text-emerald-700 font-medium">
                      {item.entitiesStripped} PII
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>
    </>
  );
};

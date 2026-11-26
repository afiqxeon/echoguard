import React from "react";
import type { LocalEngineMode } from "../../types/clinical";

interface NavbarProps {
  engineMode: LocalEngineMode;
  sessionCount: number;
  isHistoryOpen: boolean;
  isProcessing: boolean;
  onToggleHistory: () => void;
  onNewSession: () => void;
  onOpenSettings: () => void;
  onOpenHelp: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  engineMode,
  sessionCount,
  isHistoryOpen,
  isProcessing,
  onToggleHistory,
  onNewSession,
  onOpenSettings,
  onOpenHelp,
}) => {
  return (
    <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-4 sm:px-6 py-3">
      <div className="max-w-[1600px] mx-auto flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2.5 lg:gap-4">
        {/* Row 1: Logo + Hybrid Ready Badge */}
        <div className="flex items-center justify-between lg:justify-start gap-3">
          <div className="flex items-center gap-3 lg:w-72 xl:w-80 shrink-0">
            <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center font-bold text-sm shrink-0">
              EG
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight text-slate-900 leading-tight">
                EchoGuard
              </h1>
              <p className="text-[11px] text-slate-500">
                Zero-Trust Hybrid Telehealth Scribe
              </p>
            </div>
          </div>

          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] lg:text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
            <span className="w-1.5 h-1.5 lg:w-2 lg:h-2 rounded-full bg-emerald-500" />
            <span className="hidden sm:inline">
              {engineMode === "nano"
                ? "Hybrid Ready (Nano + Cloud)"
                : "Hybrid Ready (Local + Cloud)"}
            </span>
            <span className="sm:hidden">Hybrid Ready</span>
          </span>
        </div>

        {/* Row 2 (Mobile/Tablet) / Right Side (Desktop): Action Toolbar */}
        <div className="flex items-center justify-between lg:justify-end gap-2 pt-2.5 border-t border-slate-100 lg:pt-0 lg:border-t-0">
          <button
            type="button"
            onClick={onToggleHistory}
            aria-expanded={isHistoryOpen}
            className={`lg:hidden inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              isHistoryOpen
                ? "bg-sky-50 text-sky-700 border-sky-300 shadow-xs"
                : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
            }`}
          >
            <span>History ({sessionCount})</span>
          </button>

          <div className="flex items-center gap-2 ml-auto lg:ml-0">
            <button
              type="button"
              onClick={onNewSession}
              disabled={isProcessing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 transition-colors cursor-pointer"
            >
              <span>+</span>
              <span>New Encounter</span>
            </button>

            <button
              type="button"
              onClick={onOpenSettings}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 transition-colors cursor-pointer"
            >
              <span>Settings</span>
            </button>

            <button
              type="button"
              onClick={onOpenHelp}
              title="How EchoGuard Works"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors cursor-pointer"
            >
              ?
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};

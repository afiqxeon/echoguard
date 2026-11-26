import React from "react";
import type { EngineStatus, PrivacyAuditReceipt } from "../../types/clinical";

interface LocalPayloadCardProps {
  redactedText: string;
  engineState: EngineStatus;
  privacyAudit: PrivacyAuditReceipt | null;
}

export const LocalPayloadCard: React.FC<LocalPayloadCardProps> = ({
  redactedText,
  engineState,
  privacyAudit,
}) => {
  return (
    <section className="xl:col-span-5 bg-white rounded-xl border border-slate-200 shadow-xs p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-900">
          1. Local Payload (Cleared for Cloud)
        </h3>
        {redactedText && engineState !== "processing_local" && (
          <span className="text-[11px] font-bold text-emerald-600 tracking-wider">
            ✓ ZERO-PII
          </span>
        )}
      </div>

      <p className="text-sm leading-relaxed text-slate-700 whitespace-pre-wrap">
        {redactedText || (
          <span className="text-slate-400 italic">
            Sanitized stream will appear here...
          </span>
        )}
      </p>

      {privacyAudit && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
            • {privacyAudit.entitiesStripped} PII{" "}
            {privacyAudit.entitiesStripped === 1 ? "Entity" : "Entities"}{" "}
            Stripped Locally • 0 Bytes PII Sent to Cloud
          </span>
          <span className="text-[11px] text-slate-400">
            Verified {privacyAudit.verifiedAt}
          </span>
        </div>
      )}
    </section>
  );
};

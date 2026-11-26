import ReactMarkdown from "react-markdown";
import { useState, useEffect, useRef, type ChangeEvent } from "react";
import {
  initRemoteClinicalConfig,
  redactPIIViaFirebaseNano,
  generateSOAPNote,
  generateMedicalAudio,
  generateMultiSpeakerAudio,
} from "./services/firebaseHybrid";
import { redactPIIDeterministically } from "./utils/deterministicRedactor";
import { useClinicalDictation } from "./hooks/useClinicalDictation";
import { downloadFhirJson } from "./utils/clinicalExport";
import { SettingsModal } from "./components/SettingsModal";
import { HowItWorksModal } from "./components/HowItWorksModal";
import {
  CLOUD_MODELS,
  DEFAULT_CLOUD_MODEL,
  type CloudModelId,
} from "./constants/models";
import {
  loadSettings,
  saveSettings,
  type EchoGuardSettings,
  DOCTOR_VOICE_OPTIONS,
  NURSE_VOICE_OPTIONS,
} from "./utils/settingsStorage";
import {
  type ClinicalSessionRecord,
  loadSessions,
  saveSession,
  updateSession,
  deleteSession,
  clearAllSessions,
} from "./utils/sessionStorage";

type LocalEngineMode = "checking" | "nano" | "deterministic";

type EngineStatus =
  | "checking"
  | "downloading"
  | "ready"
  | "fallback"
  | "processing_local"
  | "processing_cloud"
  | "processing_audio"
  | "error";

interface PrivacyAuditReceipt {
  entitiesStripped: number;
  verifiedAt: string;
}

const SpinnerIcon = ({
  size = 14,
  color = "#0284c7",
}: {
  size?: number;
  color?: string;
}) => (
  <>
    <style>{`@keyframes echoguard-spin { to { transform: rotate(360deg); } }`}</style>
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        display: "inline-block",
        animation: "echoguard-spin 0.8s linear infinite",
      }}
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke={color}
        strokeWidth="3.5"
        strokeOpacity="0.25"
      />
      <path
        d="M22 12a10 10 0 0 0-10-10"
        stroke={color}
        strokeWidth="3.5"
        strokeLinecap="round"
      />
    </svg>
  </>
);

const SAMPLE_CLINICAL_NOTES = [
  {
    label: "ER — Acute Chest Pain",
    text: "Patient John Doe (DOB: 04/12/1982, Insurance ID: AETNA992841, Phone: 555-019-8372) reports acute chest tightness and shortness of breath persisting for 48 hours.",
  },
  {
    label: "Pediatrics — High Fever & Rash",
    text: "Pediatric patient Maya Lin (DOB: 09/18/2020, MRN: PED-44109, Parent Phone: 555-234-9910) brought in by mother Sarah Lin for 3 days of persistent 39.2C fever, maculopapular rash on trunk, and decreased oral intake.",
  },
  {
    label: "Endocrinology — Uncontrolled Diabetes",
    text: "Follow-up for Robert Alvarez (DOB: 11/03/1965, Email: r.alvarez65@example.com, Insurance ID: BCBS-774120) with Type 2 Diabetes Mellitus. Fasting blood glucose averaging 245 mg/dL over the past two weeks with increased polyuria and mild peripheral neuropathy.",
  },
  {
    label: "Neurology — Migraine vs. TIA",
    text: "Patient Elena Rostova (DOB: 02/27/1978, Phone: 555-882-4105, SSN: 123-45-6789) presents with sudden-onset right-sided visual aura, throbbing left temporal headache, and transient slurred speech lasting 15 minutes.",
  },
];

export default function PIIRedactor() {
  const [settings, setSettings] = useState<EchoGuardSettings>(() =>
    loadSettings(),
  );
  const [sessions, setSessions] = useState<ClinicalSessionRecord[]>(() =>
    loadSessions(),
  );
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [cloudModel, setCloudModel] = useState<CloudModelId>(() => {
    try {
      const saved = localStorage.getItem("echoguard_cloud_model");
      if (saved && CLOUD_MODELS.some((m) => m.id === saved)) {
        return saved as CloudModelId;
      }
    } catch {
      // Fallback on storage errors
    }
    return DEFAULT_CLOUD_MODEL;
  });

  const handleCloudModelChange = (model: CloudModelId) => {
    setCloudModel(model);
    try {
      localStorage.setItem("echoguard_cloud_model", model);
    } catch (err) {
      console.warn("Failed to persist cloud model:", err);
    }
  };

  const [engineMode, setEngineMode] = useState<LocalEngineMode>("checking");
  const [input, setInput] = useState("");
  const [sampleIndex, setSampleIndex] = useState<number | null>(null);
  const transcriptInputRef = useRef<HTMLTextAreaElement | null>(null);

  const {
    isSupported: isMicSupported,
    isListening,
    interimTranscript,
    error: micError,
    stopListening,
    toggleListening,
  } = useClinicalDictation({
    lang: settings.dictationLanguage,
    onFinalTranscript: (spokenText) => {
      setInput((prev) =>
        prev.trim() ? `${prev.trim()} ${spokenText}` : spokenText,
      );
    },
  });

  // Pipeline Outputs
  const [redactedText, setRedactedText] = useState("");
  const [privacyAudit, setPrivacyAudit] = useState<PrivacyAuditReceipt | null>(
    null,
  );
  const [soapNote, setSoapNote] = useState("");
  const [isSoapExpanded, setIsSoapExpanded] = useState(false);
  const [soapError, setSoapError] = useState<{
    title: string;
    detail: string;
  } | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [audioScript, setAudioScript] = useState<string>("");
  type PipelineStage = "idle" | "local" | "cloud" | "audio" | "done";
  const [pipelineStage, setPipelineStage] = useState<PipelineStage>("idle");
  const [generatedVoices, setGeneratedVoices] = useState<{
    doctorVoice: string;
    nurseVoice: string;
  } | null>(null);
  const [isRegeneratingAudio, setIsRegeneratingAudio] = useState(false);
  const [copied, setCopied] = useState(false);

  const displayedVoices = generatedVoices ?? {
    doctorVoice: settings.doctorVoice,
    nurseVoice: settings.nurseVoice,
  };

  const activeDoctorLabel =
    DOCTOR_VOICE_OPTIONS.find((v) => v.id === displayedVoices.doctorVoice)
      ?.label || displayedVoices.doctorVoice;
  const activeNurseLabel =
    NURSE_VOICE_OPTIONS.find((v) => v.id === displayedVoices.nurseVoice)
      ?.label || displayedVoices.nurseVoice;

  const isAudioOutdated = Boolean(
    audioUrl &&
      generatedVoices &&
      (generatedVoices.doctorVoice !== settings.doctorVoice ||
        generatedVoices.nurseVoice !== settings.nurseVoice),
  );

  const handleCopySoap = async () => {
    if (!soapNote) return;
    try {
      await navigator.clipboard.writeText(soapNote);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy SOAP note:", err);
    }
  };

  const handleRegenerateAudio = async () => {
    if ((!audioScript && !soapNote) || isRegeneratingAudio) return;
    setAudioError(null);
    setIsRegeneratingAudio(true);
    setPipelineStage("audio");
    setEngineState("processing_audio");
    setStatusMessage(
      "Generating multi-speaker audio via Firebase AI Logic...",
    );

    try {
      let newAudioUrl = "";
      let newScript = audioScript;

      if (audioScript.trim()) {
        newAudioUrl = await generateMultiSpeakerAudio(audioScript, {
          doctorVoice: settings.doctorVoice,
          nurseVoice: settings.nurseVoice,
        });
      } else {
        const result = await generateMedicalAudio(
          soapNote,
          {
            doctorVoice: settings.doctorVoice,
            nurseVoice: settings.nurseVoice,
          },
          cloudModel,
        );
        newAudioUrl = result.audioUrl;
        newScript = result.script;
        setAudioScript(newScript);
      }

      if (audioUrl && audioUrl.startsWith("blob:")) {
        URL.revokeObjectURL(audioUrl);
      }
      setAudioUrl(newAudioUrl);
      setGeneratedVoices({
        doctorVoice: settings.doctorVoice,
        nurseVoice: settings.nurseVoice,
      });

      if (activeSessionId) {
        const updated = updateSession(activeSessionId, {
          handoffScript: newScript,
          doctorVoice: settings.doctorVoice,
          nurseVoice: settings.nurseVoice,
        });
        setSessions(updated);
      }

      setEngineState("ready");
      setStatusMessage("Pipeline Complete: Local Shield ➔ Cloud SOAP ➔ Cloud TTS.");
      setPipelineStage("done");
    } catch (err) {
      console.error("Failed to generate audio:", err);
      setAudioError(
        "Audio handoff model is temporarily busy. Click Retry Audio without re-running SOAP.",
      );
      setEngineState("ready");
      setPipelineStage("done");
    } finally {
      setIsRegeneratingAudio(false);
    }
  };

  const handleRetryAudio = async () => {
    await handleRegenerateAudio();
  };

  const handleLoadSession = (record: ClinicalSessionRecord) => {
    if (audioUrl && audioUrl.startsWith("blob:")) {
      URL.revokeObjectURL(audioUrl);
    }
    setInput("");
    setSampleIndex(null);
    setPipelineStage("idle");
    setAudioUrl("");
    setGeneratedVoices(null);
    setSoapError(null);
    setAudioError(null);
    setIsSoapExpanded(false);
    setRedactedText(record.redactedTranscript);
    setSoapNote(record.soapNote);
    setAudioScript(record.handoffScript);
    setPrivacyAudit({
      entitiesStripped: record.entitiesStripped,
      verifiedAt: new Date(record.createdAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
    });
    setActiveSessionId(record.id);
    setIsHistoryOpen(false);
  };

  const handleDeleteSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = deleteSession(id);
    setSessions(updated);
    if (activeSessionId === id) {
      setActiveSessionId(null);
    }
  };

  const handleClearHistory = () => {
    clearAllSessions();
    setSessions([]);
    setActiveSessionId(null);
  };

  // Engine States & Metrics
  const [engineState, setEngineState] = useState<EngineStatus>("checking");
  const [statusMessage, setStatusMessage] = useState(
    "Checking local Gemini Nano availability...",
  );
  const [ttftMs, setTtftMs] = useState<number | null>(null);
  const [localLatencyMs, setLocalLatencyMs] = useState<number | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function initLocalEngine() {
      try {
        const languageModelApi = (window as any).LanguageModel;
        if (!languageModelApi) {
          if (isMounted) {
            setEngineMode("deterministic");
            setEngineState("fallback");
            setStatusMessage("Deterministic Local Privacy Shield Active");
          }
          return;
        }

        const availability =
          typeof languageModelApi.availability === "function"
            ? await languageModelApi.availability({
                expectedOutputs: [{ type: "text", languages: ["en"] }],
              })
            : "unavailable";

        if (availability === "available" || availability === "readily") {
          if (isMounted) {
            setEngineMode("nano");
            setEngineState("ready");
            setStatusMessage("Gemini Nano Ready (On-Device)");
          }
        } else {
          if (isMounted) {
            setEngineMode("deterministic");
            setEngineState("fallback");
            setStatusMessage("Deterministic Local Privacy Shield Active");
          }
        }
      } catch (error) {
        console.warn(
          "Chrome Built-in AI unavailable. Switching to Deterministic Local Privacy Shield:",
          error,
        );
        if (isMounted) {
          setEngineMode("deterministic");
          setEngineState("fallback");
          setStatusMessage("Deterministic Local Privacy Shield Active");
        }
      }
    }

    initLocalEngine();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    initRemoteClinicalConfig().then((config) => {
      if (!active) return;

      // Use Remote Config default model if user hasn't manually selected one
      const hasManualSelection = Boolean(
        localStorage.getItem("echoguard_cloud_model"),
      );
      if (
        !hasManualSelection &&
        CLOUD_MODELS.some((m) => m.id === config.defaultCloudModel)
      ) {
        setCloudModel(config.defaultCloudModel as CloudModelId);
      }
    });

    return () => {
      active = false;
    };
  }, []);

  const classifySoapError = (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);

    if (/429|quota|too many requests|rate.?limit/i.test(msg)) {
      return {
        title: "Daily cloud quota reached.",
        detail:
          "Local PII redaction is complete, but cloud SOAP synthesis is paused until the quota resets. Try switching the cloud model in Settings and click Regenerate SOAP.",
      };
    }

    if (/500|503|high demand|overloaded|temporarily/i.test(msg)) {
      return {
        title: "Cloud model is temporarily busy.",
        detail:
          "Your redacted payload is safe. Wait a few seconds, or try switching the cloud model in Settings and click Regenerate SOAP.",
      };
    }

    return {
      title: "Cloud SOAP synthesis failed.",
      detail:
        "Unable to reach Firebase AI Logic right now. Your redacted payload is preserved—click Regenerate SOAP to retry.",
    };
  };

  const runCloudPipeline = async (
    cleanPayload: string,
    entitiesStrippedCount?: number,
  ) => {
    if (!cleanPayload.trim()) return;

    setSoapError(null);
    setAudioError(null);
    setIsSoapExpanded(false);
    setPipelineStage("cloud");
    setEngineState("processing_cloud");
    setStatusMessage(
      "Step 2/3: Routing secured payload to Firebase Cloud for SOAP synthesis...",
    );

    let soapResult = "";

    // --- STEP 2: Cloud SOAP Note ---
    try {
      soapResult = await generateSOAPNote(cleanPayload, cloudModel);
      setSoapNote(soapResult);
    } catch (err) {
      console.error("Cloud SOAP Synthesis Error:", err);
      const parsedError = classifySoapError(err);
      setSoapError(parsedError);
      setEngineState("error");
      setStatusMessage(parsedError.title);
      return; // Stop here if SOAP fails
    }

    const totalRedacted =
      entitiesStrippedCount ??
      (cleanPayload.match(/\[REDACTED\]/g) || []).length;

    let currentSessions = saveSession({
      redactedTranscript: cleanPayload,
      soapNote: soapResult,
      handoffScript: "",
      entitiesStripped: totalRedacted,
      doctorVoice: settings.doctorVoice,
      nurseVoice: settings.nurseVoice,
    });
    setSessions(currentSessions);
    const savedId = currentSessions[0]?.id ?? null;
    setActiveSessionId(savedId);

    // --- STEP 3: Multi-Speaker Audio (Separated from SOAP) ---
    try {
      setPipelineStage("audio");
      setEngineState("processing_audio");
      setStatusMessage(
        "Step 3/3: Generating expressive multi-speaker audio via Firebase AI Logic...",
      );

      const { audioUrl: generatedAudioUrl, script } =
        await generateMedicalAudio(
          soapResult,
          {
            doctorVoice: settings.doctorVoice,
            nurseVoice: settings.nurseVoice,
          },
          cloudModel,
        );
      setAudioUrl(generatedAudioUrl);
      setAudioScript(script);
      setGeneratedVoices({
        doctorVoice: settings.doctorVoice,
        nurseVoice: settings.nurseVoice,
      });

      if (savedId) {
        const updated = updateSession(savedId, {
          handoffScript: script,
          doctorVoice: settings.doctorVoice,
          nurseVoice: settings.nurseVoice,
        });
        setSessions(updated);
      }

      setEngineState("ready");
      setStatusMessage(
        "Pipeline Complete: Local Shield ➔ Cloud SOAP ➔ Cloud TTS.",
      );
      setPipelineStage("done");
    } catch (err) {
      console.error("Multi-Speaker TTS Error:", err);
      setAudioError(
        "Audio handoff model is temporarily busy. Click Retry Audio without re-running SOAP.",
      );
      setEngineState("ready");
      setStatusMessage("SOAP note generated. Audio handoff paused.");
      setPipelineStage("done");
    }
  };

  const handleRegenerateSOAP = () => {
    if (redactedText) {
      void runCloudPipeline(redactedText, privacyAudit?.entitiesStripped);
    }
  };

  const handleProcessPipeline = async () => {
    if (isListening) {
      stopListening();
    }
    if (!input.trim() || isProcessing) return;

    // Reset Pipeline States
    setSoapError(null);
    setAudioError(null);
    setIsSoapExpanded(false);
    setPipelineStage("local");
    setRedactedText("");
    setPrivacyAudit(null);
    setSoapNote("");
    setAudioUrl("");
    setAudioScript("");
    setGeneratedVoices(null);
    setTtftMs(null);
    setLocalLatencyMs(null);

    // --- STEP 1: LOCAL INFERENCE (PII REDACTION) ---
    setEngineState("processing_local");
    setStatusMessage("Step 1/3: Streaming PII redaction locally on-device...");
    const startTime = performance.now();
    let firstTokenRecorded = false;

    // Stage 1A: Deterministic Pre-Filter (guarantees structured PII is stripped in <2ms)
    const preFiltered = redactPIIDeterministically(input);
    let sanitizedPayload = preFiltered.redactedText;

    try {
      if (engineMode === "nano") {
        try {
          // Stage 1B: Semantic pass via Gemini Nano (Firebase AI Logic ONLY_ON_DEVICE) on pre-filtered text
          const nanoOutput = await redactPIIViaFirebaseNano(
            sanitizedPayload,
            (partialText) => {
              if (!firstTokenRecorded) {
                setTtftMs(Math.round(performance.now() - startTime));
                firstTokenRecorded = true;
              }
              setRedactedText(partialText);
            },
          );

          if (!firstTokenRecorded) {
            setTtftMs(Math.round(performance.now() - startTime));
          }
          setRedactedText(nanoOutput);

          // Stage 1C: Post-Filter safety net
          sanitizedPayload = redactPIIDeterministically(nanoOutput).redactedText;
        } catch (nanoError) {
          console.warn(
            "Firebase AI Logic on-device Gemini Nano unavailable, retaining deterministic output:",
            nanoError,
          );
          setEngineMode("deterministic");
        }
      } else {
        const elapsed = Math.round(performance.now() - startTime);
        setTtftMs(elapsed);
        setLocalLatencyMs(elapsed);
      }

      setLocalLatencyMs(Math.round(performance.now() - startTime));
      setRedactedText(sanitizedPayload);

      const totalRedactedTags = (sanitizedPayload.match(/\[REDACTED\]/g) || []).length;
      const strippedCount = Math.max(preFiltered.entitiesRedacted, totalRedactedTags);
      setPrivacyAudit({
        entitiesStripped: strippedCount,
        verifiedAt: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      });

      // Hand off sanitized payload to Cloud Pipeline
      await runCloudPipeline(sanitizedPayload, strippedCount);
    } catch (error) {
      console.error("Local Redaction Error:", error);
      setPipelineStage("idle");
      setEngineState("error");
      setStatusMessage("Local redaction failed. Please verify local state.");
    }
  };

  const handleSelectSample = (sampleText: string, index: number) => {
    if (audioUrl && audioUrl.startsWith("blob:")) {
      URL.revokeObjectURL(audioUrl);
    }
    setInput(sampleText);
    setPipelineStage("idle");
    setSoapError(null);
    setAudioError(null);
    setIsSoapExpanded(false);
    setRedactedText("");
    setPrivacyAudit(null);
    setSoapNote("");
    setAudioUrl("");
    setAudioScript("");
    setGeneratedVoices(null);
    setActiveSessionId(null);
    setTtftMs(null);
    setLocalLatencyMs(null);
    setSampleIndex(index);
  };

  const handleNewSession = () => {
    if (audioUrl && audioUrl.startsWith("blob:")) {
      URL.revokeObjectURL(audioUrl);
    }
    setInput("");
    setSampleIndex(null);
    setSoapError(null);
    setAudioError(null);
    setIsSoapExpanded(false);
    setRedactedText("");
    setSoapNote("");
    setAudioScript("");
    setAudioUrl("");
    setGeneratedVoices(null);
    setPrivacyAudit(null);
    setActiveSessionId(null);
    setPipelineStage("idle");
    setTtftMs(null);
    setLocalLatencyMs(null);

    // Focus cursor directly to transcript textarea for next patient
    setTimeout(() => {
      transcriptInputRef.current?.focus();
    }, 50);
  };

  const isProcessing = engineState.startsWith("processing");
  const isEncounterLocked = Boolean(
    activeSessionId || redactedText || soapNote,
  );
  const isActionable =
    (engineMode === "nano" || engineMode === "deterministic") &&
    input.trim().length > 0 &&
    !isProcessing &&
    !isEncounterLocked;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
      {/* 1. TOP NAVBAR (Full-Width) */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-4 sm:px-6 py-3">
        <div className="max-w-[1600px] mx-auto flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2.5 lg:gap-4">
          {/* Row 1: Logo + Hybrid Ready Badge (Aligned with Workspace left boundary on Desktop, Top-Right on Mobile/Tablet) */}
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

            {/* Status Badge — Unified single element across all screen sizes */}
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
            {/* History Toggle Button — Left Side (Mobile/Tablet only) */}
            <button
              type="button"
              onClick={() => setIsHistoryOpen((prev) => !prev)}
              aria-expanded={isHistoryOpen}
              className={`lg:hidden inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                isHistoryOpen
                  ? "bg-sky-50 text-sky-700 border-sky-300 shadow-xs"
                  : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
              }`}
            >
              <span>History ({sessions.length})</span>
            </button>

            {/* Action Buttons Group on the Right */}
            <div className="flex items-center gap-2 ml-auto lg:ml-0">
              <button
                type="button"
                onClick={handleNewSession}
                disabled={isProcessing}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 transition-colors"
              >
                <span>+</span>
                <span>New Encounter</span>
              </button>

              <button
                type="button"
                onClick={() => setIsSettingsOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 transition-colors"
              >
                <span>Settings</span>
              </button>

              <button
                type="button"
                onClick={() => setIsHelpOpen(true)}
                title="How EchoGuard Works"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors cursor-pointer"
              >
                ?
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* 2. BODY: LEFT SIDEBAR + MAIN WORKSPACE */}
      <div className="flex-1 flex flex-col lg:flex-row max-w-[1600px] w-full mx-auto">
        {/* Backdrop when drawer is open on mobile/tablet */}
        {isHistoryOpen && (
          <div
            className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-[1px] lg:hidden"
            onClick={() => setIsHistoryOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* LEFT SIDEBAR (Desktop) / SLIDE-OVER DRAWER (Mobile & Tablet) */}
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
                  onClick={handleClearHistory}
                  className="text-[11px] font-medium text-red-600 hover:underline cursor-pointer"
                >
                  Clear
                </button>
              )}
              {/* Close Button for Mobile/Tablet */}
              <button
                type="button"
                onClick={() => setIsHistoryOpen(false)}
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
                    onClick={() => handleLoadSession(item)}
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
                        onClick={(e) => handleDeleteSession(item.id, e)}
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

        {/* MAIN WORKSPACE */}
        <main className="flex-1 p-5 lg:p-6 space-y-5 min-w-0">
          {/* A. INPUT TRANSCRIPT CARD */}
          <section className="bg-white rounded-xl border border-slate-200 shadow-xs p-5">
            {activeSessionId && (
              <div className="mb-3 flex items-center justify-between rounded-lg bg-sky-50 border border-sky-200 px-3 py-2 text-xs text-sky-900">
                <span>
                  Viewing locked encounter{" "}
                  <strong className="font-mono">
                    {sessions.find((s) => s.id === activeSessionId)?.encounterId ||
                      "ARCHIVED"}
                  </strong>{" "}
                  — input locked to prevent cross-patient mix-ups.
                </span>
                <button
                  type="button"
                  onClick={handleNewSession}
                  className="font-semibold text-sky-700 hover:underline cursor-pointer"
                >
                  + Start New Patient
                </button>
              </div>
            )}

            {/* Header Kartu Input — Bersih */}
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

            {/* Textarea */}
            <textarea
              id="raw-transcript"
              ref={transcriptInputRef}
              value={input}
              readOnly={isEncounterLocked || isProcessing}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
                setInput(e.target.value);
                setSampleIndex(null);
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
              <p className="mt-1.5 text-xs text-red-600">
                {micError}
              </p>
            )}

            {/* Quick Demo Cases — Menggantikan link Insert Sample yang tersembunyi */}
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
                    onClick={() => {
                      handleSelectSample(sample.text, idx);
                    }}
                    disabled={isProcessing || isEncounterLocked}
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

            {/* Action Bar Bawah: Mic di Kiri, Run Pipeline di Kanan */}
            <div className="mt-4 pt-3.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={toggleListening}
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
                    onClick={() => {
                      setInput("");
                      setSampleIndex(null);
                    }}
                    className="px-2.5 py-2 rounded-lg text-xs font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                  >
                    Clear
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={handleProcessPipeline}
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

            {/* Status, Latency & Pipeline Stepper */}
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
                    {/* Step 1: Local PII Shield */}
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

                    {/* Step 2: Cloud SOAP Note */}
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

                    {/* Step 3: Multi-Speaker Audio */}
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

          {/* B. BALANCED OUTPUT GRID (1 -> 2 -> 3 on mobile/tablet; 5:7 on desktop) */}
          <div className="grid grid-cols-1 xl:grid-cols-12 xl:grid-rows-[1fr_auto] gap-5">
            {/* Card 1: Local Payload (Order 1 on mobile, 5/12 left-top on desktop) */}
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

            {/* Card 2: Cloud SOAP Note Synthesis (Order 2 on mobile, 7/12 right 2-rows on desktop) */}
            <section className="xl:col-span-7 xl:row-span-2 flex flex-col bg-white rounded-xl border border-sky-200/80 shadow-xs p-5">
              {/* Header Kartu 2 */}
              <div className="flex items-center justify-between gap-2 mb-3 pb-3 border-b border-slate-100">
                <h2 className="text-sm font-semibold text-slate-900">
                  2. Cloud SOAP Note Synthesis
                </h2>
                <div className="flex items-center gap-2">
                  {!soapError && redactedText && (
                    <button
                      type="button"
                      onClick={handleRegenerateSOAP}
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

              {/* Banner Error (muncul saat 429 / 500 / network error) */}
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
                        onClick={handleRegenerateSOAP}
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
                  {/* Area Konten SOAP */}
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
                              <ol className="mb-3 pl-5 list-decimal space-y-1" {...props} />
                            ),
                          }}
                        >
                          {soapNote}
                        </ReactMarkdown>
                      </div>

                      {/* Gradient fade overlay when folded */}
                      {!isSoapExpanded && soapNote.length > 500 && (
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-white via-white/90 to-transparent" />
                      )}
                    </div>

                    {/* Expand / Collapse toggle button */}
                    {soapNote.length > 500 && (
                      <button
                        type="button"
                        onClick={() => setIsSoapExpanded((prev) => !prev)}
                        className="mt-2 self-center inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors cursor-pointer"
                      >
                        <span>{isSoapExpanded ? "▲ Collapse SOAP Note" : "▼ Expand Full SOAP Note"}</span>
                      </button>
                    )}
                  </div>

                  {/* Footer Tombol Aksi — menempel rapi di bawah dengan mt-auto */}
                  <div className="mt-auto pt-4">
                    <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                      <button
                        type="button"
                        onClick={handleCopySoap}
                        className="px-3 py-1.5 rounded-md text-xs font-medium bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 transition-colors cursor-pointer"
                      >
                        {copied ? "Copied to Clipboard ✓" : "Copy SOAP Note"}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          downloadFhirJson({
                            soapNote,
                            redactedTranscript: redactedText,
                            handoffScript: audioScript,
                            localEngine: engineMode,
                          })
                        }
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

            {/* Card 3: Multi-Speaker Action Plan — always displayed bottom-left */}
            <section className="xl:col-span-5 bg-rose-50/40 rounded-xl border border-rose-200/80 shadow-xs p-5">
              {/* Header Blok 3 — seragam dengan Blok 1 & 2 */}
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h2 className="text-sm font-semibold text-rose-900">
                  3. Multi-Speaker Action Plan (Doctor &amp; Nurse)
                </h2>
                <div className="flex items-center gap-2">
                  {audioUrl && (
                    <a
                      href={audioUrl}
                      download="echoguard-handoff.wav"
                      className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-white px-2.5 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-50 transition-colors"
                    >
                      Download WAV
                    </a>
                  )}
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-100 text-rose-700 border border-rose-200">
                    FIREBASE TTS
                  </span>
                </div>
              </div>

              {/* Baris Profil Suara (lebih bersih & ringkas) */}
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-rose-200 bg-white px-2.5 py-0.5 font-medium text-rose-800">
                    Doctor: {activeDoctorLabel}
                  </span>
                  <span className="rounded-full border border-rose-200 bg-white px-2.5 py-0.5 font-medium text-rose-800">
                    Nurse: {activeNurseLabel}
                  </span>
                </div>

                {isAudioOutdated && (
                  <button
                    type="button"
                    onClick={handleRegenerateAudio}
                    disabled={isRegeneratingAudio}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-200 disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    {isRegeneratingAudio
                      ? "Regenerating Audio..."
                      : "Voice settings changed • Regenerate Audio"}
                  </button>
                )}
              </div>

              {/* Audio Error Alert */}
              {audioError && (
                <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-sm">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div>
                      <p className="font-semibold text-amber-900">Audio Handoff Paused</p>
                      <p className="mt-1 text-xs text-amber-800 leading-relaxed">
                        {audioError}
                      </p>
                    </div>
                    {soapNote && (
                      <button
                        type="button"
                        onClick={handleRetryAudio}
                        disabled={isRegeneratingAudio}
                        className="shrink-0 inline-flex items-center justify-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50 transition-colors cursor-pointer"
                      >
                        <span>{isRegeneratingAudio ? "Retrying..." : "↻ Retry Audio"}</span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {!soapNote && !audioScript && pipelineStage !== "audio" ? (
                audioError ? null : (
                  <p className="text-sm text-rose-400 italic py-4">
                    Awaiting SOAP synthesis to generate Doctor &amp; Nurse audio handoff...
                  </p>
                )
              ) : (
                <>

                  {pipelineStage === "audio" || isRegeneratingAudio ? (
                    <div className="p-4 bg-white/80 rounded-lg border border-pink-200 flex items-center gap-3 text-rose-900">
                      <SpinnerIcon size={18} color="#e11d48" />
                      <div className="flex flex-col">
                        <span className="text-xs font-semibold">
                          Synthesizing Multi-Speaker Handoff Audio...
                        </span>
                        <span className="text-[11px] text-rose-700/80">
                          Generating Doctor &amp; Nurse voices via Split-and-Stitch PCM
                        </span>
                      </div>
                    </div>
                  ) : audioUrl ? (
                    <audio
                      controls
                      src={audioUrl}
                      className="w-full outline-none"
                    >
                      Your browser does not support the audio element.
                    </audio>
                  ) : !audioError ? (
                    <div className="p-3 bg-white/80 rounded-lg border border-pink-200 flex flex-wrap items-center justify-between gap-3">
                      <span className="text-xs text-slate-600">
                        Audio is not stored in local history. Generate audio handoff for this encounter.
                      </span>
                      <button
                        type="button"
                        onClick={handleRegenerateAudio}
                        disabled={isRegeneratingAudio || isProcessing}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-pink-700 hover:bg-pink-800 disabled:opacity-50 transition-colors cursor-pointer"
                      >
                        {isRegeneratingAudio
                          ? "Generating Audio..."
                          : "▶ Generate Audio Handoff"}
                      </button>
                    </div>
                  ) : null}

                  {audioScript && (
                    <div className="mt-3 p-3 bg-white/80 rounded-lg border border-pink-200">
                      <p className="text-[11px] font-semibold text-pink-700 mb-2 uppercase tracking-wider">
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
                                      isDoctor
                                        ? "text-slate-900"
                                        : "text-rose-800"
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
          </div>
        </main>
      </div>

      {/* 3. FOOTER */}
      <footer className="bg-white border-t border-slate-200 px-4 sm:px-6 py-3.5">
        <div className="max-w-[1600px] mx-auto flex flex-col lg:flex-row items-center justify-between gap-1.5 lg:gap-4 text-[11px] text-slate-500">
          <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 shrink-0">
            <span className="font-semibold text-slate-700">EchoGuard</span>
            <span aria-hidden="true">•</span>
            <span>Zero-Trust Hybrid Telehealth Scribe</span>
          </div>

          <p className="text-center lg:text-right text-slate-400 leading-relaxed">
            Clinical decision support prototype — always verify AI-generated SOAP notes before EHR entry.
          </p>
        </div>
      </footer>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        settings={settings}
        engineMode={engineMode}
        cloudModel={cloudModel}
        onCloudModelChange={handleCloudModelChange}
        onClose={() => setIsSettingsOpen(false)}
        onSave={(updated) => {
          const saved = saveSettings(updated);
          if (saved) {
            setSettings(updated);
          }
          return saved;
        }}
      />

      {/* How EchoGuard Works Modal */}
      <HowItWorksModal
        isOpen={isHelpOpen}
        onClose={() => setIsHelpOpen(false)}
      />
    </div>
  );
}

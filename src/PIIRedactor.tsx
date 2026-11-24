import ReactMarkdown from "react-markdown";
import { useState, useEffect, useRef, type ChangeEvent } from "react";
import {
  generateSOAPNote,
  generateMedicalAudio,
  generateMultiSpeakerAudio,
} from "./services/firebaseHybrid";
import { redactPIIDeterministically } from "./utils/deterministicRedactor";
import { useClinicalDictation } from "./hooks/useClinicalDictation";
import { downloadFhirJson, downloadAudioWav } from "./utils/clinicalExport";
import { SettingsModal } from "./components/SettingsModal";
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
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
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
    if (!audioScript || isRegeneratingAudio) return;
    setIsRegeneratingAudio(true);

    try {
      const newAudioUrl = await generateMultiSpeakerAudio(audioScript, {
        doctorVoice: settings.doctorVoice,
        nurseVoice: settings.nurseVoice,
      });
      if (audioUrl && audioUrl.startsWith("blob:")) {
        URL.revokeObjectURL(audioUrl);
      }
      setAudioUrl(newAudioUrl);
      setGeneratedVoices({
        doctorVoice: settings.doctorVoice,
        nurseVoice: settings.nurseVoice,
      });
    } catch (err) {
      console.error("Failed to regenerate audio:", err);
    } finally {
      setIsRegeneratingAudio(false);
    }
  };

  const handleLoadSession = (record: ClinicalSessionRecord) => {
    if (audioUrl && audioUrl.startsWith("blob:")) {
      URL.revokeObjectURL(audioUrl);
    }
    setAudioUrl("");
    setGeneratedVoices(null);
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

  const handleProcessPipeline = async () => {
    if (isListening) {
      stopListening();
    }
    if (!input.trim()) return;

    // Reset Pipeline States
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
          const nanoSession = await (window as any).LanguageModel.create({
            temperature: 0,
            topK: 1,
            expectedOutputs: [{ type: "text", languages: ["en"] }],
            initialPrompts: [
              {
                role: "system",
                content:
                  "You are a strict PII redaction engine. Return ONLY the original text with any remaining personal identifiers (names, addresses, dates of birth, IDs, phone numbers) replaced by [REDACTED]. Do NOT add explanations, markdown, bullet points, or medical advice.",
              },
            ],
          });

          // Stage 1B: Semantic pass via Gemini Nano on already pre-filtered text
          const nanoPrompt = `Redact any remaining personal identifiers in this text. Output ONLY the redacted text:\n\n${sanitizedPayload}`;
          let nanoOutput = "";

          try {
            if (typeof nanoSession.promptStreaming === "function") {
              const stream = nanoSession.promptStreaming(nanoPrompt, {
                outputLanguage: "en",
              });
              for await (const chunk of stream) {
                if (!firstTokenRecorded) {
                  setTtftMs(Math.round(performance.now() - startTime));
                  firstTokenRecorded = true;
                }
                nanoOutput =
                  chunk.startsWith(nanoOutput) && nanoOutput.length > 0
                    ? chunk
                    : nanoOutput + chunk;
                setRedactedText(nanoOutput);
              }
            } else {
              nanoOutput = await nanoSession.prompt(nanoPrompt, {
                outputLanguage: "en",
              });
              setTtftMs(Math.round(performance.now() - startTime));
              setRedactedText(nanoOutput);
            }
          } finally {
            if (typeof nanoSession.destroy === "function") {
              nanoSession.destroy();
            }
          }

          // Stage 1C: Post-Filter safety net
          sanitizedPayload = redactPIIDeterministically(nanoOutput).redactedText;
        } catch (nanoError) {
          console.warn(
            "Gemini Nano failed, retaining deterministic output:",
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
      setPrivacyAudit({
        entitiesStripped: Math.max(preFiltered.entitiesRedacted, totalRedactedTags),
        verifiedAt: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      });

      // --- STEP 2: CLOUD INFERENCE (SOAP NOTE) ---
      setPipelineStage("cloud");
      setEngineState("processing_cloud");
      setStatusMessage(
        "Step 2/3: Routing secured payload to Firebase Cloud for SOAP synthesis...",
      );
      const generatedSoap = await generateSOAPNote(sanitizedPayload);
      setSoapNote(generatedSoap);

      // --- STEP 3: CLOUD TTS (MULTI-SPEAKER AUDIO) ---
      setPipelineStage("audio");
      setEngineState("processing_audio");
      setStatusMessage(
        "Step 3/3: Generating expressive multi-speaker audio via Firebase AI Logic...",
      );
      const { audioUrl: generatedAudioUrl, script } =
        await generateMedicalAudio(generatedSoap, {
          doctorVoice: settings.doctorVoice,
          nurseVoice: settings.nurseVoice,
        });
      setAudioUrl(generatedAudioUrl);
      setAudioScript(script);
      setGeneratedVoices({
        doctorVoice: settings.doctorVoice,
        nurseVoice: settings.nurseVoice,
      });

      const updatedSessions = saveSession({
        redactedTranscript: sanitizedPayload,
        soapNote: generatedSoap,
        handoffScript: script,
        entitiesStripped: Math.max(
          preFiltered.entitiesRedacted,
          totalRedactedTags,
        ),
        doctorVoice: settings.doctorVoice,
        nurseVoice: settings.nurseVoice,
      });
      setSessions(updatedSessions);
      setActiveSessionId(updatedSessions[0]?.id ?? null);

      setEngineState("ready");
      setStatusMessage(
        "Pipeline Complete: Local Shield ➔ Cloud SOAP ➔ Cloud TTS.",
      );
      setPipelineStage("done");
    } catch (error) {
      console.error("Pipeline Execution Error:", error);
      setPipelineStage("idle");
      setEngineState("error");
      setStatusMessage(
        "Pipeline failed. Please verify local and cloud states.",
      );
    }
  };

  const handleSelectSample = (sampleText: string, index: number) => {
    if (audioUrl && audioUrl.startsWith("blob:")) {
      URL.revokeObjectURL(audioUrl);
    }
    setInput(sampleText);
    setPipelineStage("idle");
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
  const isActionable =
    (engineMode === "nano" || engineMode === "deterministic") &&
    input.trim().length > 0 &&
    !isProcessing;

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
                <span>New Session</span>
              </button>

              <button
                type="button"
                onClick={() => setIsSettingsOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 transition-colors"
              >
                <span>Settings</span>
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
                No saved sessions yet. Run the pipeline to save a de-identified encounter locally.
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
                  Viewing saved encounter{" "}
                  <strong className="font-mono">
                    {sessions.find((s) => s.id === activeSessionId)?.encounterId ||
                      "ARCHIVED"}
                  </strong>
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
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
                setInput(e.target.value);
                setSampleIndex(null);
              }}
              rows={4}
              placeholder="Speak via Live Mic, type clinical notes with patient PII (name, DOB, phone, insurance ID), or select a quick sample..."
              className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20 resize-y"
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
                    disabled={isProcessing}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors disabled:opacity-50 cursor-pointer ${
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
                  disabled={isProcessing || !isMicSupported}
                  className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-50 cursor-pointer ${
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

                {input.trim().length > 0 && !isProcessing && (
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
                    : "Run Hybrid AI Pipeline"}
                </span>
                {!isProcessing && <span aria-hidden="true">→</span>}
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
              <p className="text-sm leading-relaxed text-slate-700 whitespace-pre-wrap min-h-16">
                {redactedText || (
                  <span className="text-slate-400 italic">
                    Sanitized stream will appear here...
                  </span>
                )}
              </p>

              {privacyAudit && (
                <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-md">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    {privacyAudit.entitiesStripped} PII{" "}
                    {privacyAudit.entitiesStripped === 1 ? "Entity" : "Entities"}{" "}
                    Stripped Locally • 0 Bytes PII Sent to Cloud
                  </span>
                  <span className="text-slate-400">
                    Verified {privacyAudit.verifiedAt}
                  </span>
                </div>
              )}
            </section>

            {/* Card 2: Cloud SOAP Note Synthesis (Order 2 on mobile, 7/12 right 2-rows on desktop) */}
            <section className="xl:col-span-7 xl:row-span-2 bg-white rounded-xl border border-sky-200/80 shadow-xs p-5">
              <div className="flex items-center justify-between gap-2 pb-3 mb-4 border-b border-slate-100">
                <h3 className="text-sm font-semibold text-sky-900 whitespace-nowrap">
                  2. Cloud SOAP Note Synthesis
                </h3>
                <span className="shrink-0 whitespace-nowrap px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wider bg-sky-50 text-sky-700 border border-sky-200">
                  Cloud Inference
                </span>
              </div>

              <div className="text-sm leading-relaxed text-slate-800 min-h-60">
                {soapNote ? (
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
                ) : (
                  <p className="text-slate-400 italic">
                    {isProcessing && engineState === "processing_cloud"
                      ? "Analyzing secured payload in Firebase AI..."
                      : "Awaiting secure payload..."}
                  </p>
                )}
              </div>

              {soapNote && (
                <div className="mt-4 pt-3 border-t border-sky-100 flex flex-wrap items-center gap-2">
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
              )}
            </section>

            {/* Card 3: Multi-Speaker Action Plan — always displayed bottom-left */}
            <section className="xl:col-span-5 bg-rose-50/40 rounded-xl border border-rose-200/80 shadow-xs p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <h3 className="text-sm font-semibold text-rose-900">
                  3. Multi-Speaker Action Plan (Doctor & Nurse)
                </h3>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="whitespace-nowrap px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wider bg-rose-100/70 text-rose-700 border border-rose-200">
                    Firebase TTS
                  </span>
                  {audioUrl && (
                    <button
                      type="button"
                      onClick={() => downloadAudioWav(audioUrl)}
                      className="whitespace-nowrap px-2.5 py-1 rounded-md text-xs font-medium bg-white text-rose-700 border border-rose-200 hover:bg-rose-50 transition-colors cursor-pointer"
                    >
                      Download WAV
                    </button>
                  )}
                </div>
              </div>

              {!audioScript && pipelineStage !== "audio" ? (
                <p className="text-sm text-rose-400 italic py-4">
                  Awaiting SOAP synthesis to generate Doctor &amp; Nurse audio handoff...
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-white/80 text-rose-800 border border-rose-200">
                        Doctor: {activeDoctorLabel}
                      </span>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-white/80 text-rose-800 border border-rose-200">
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
                      autoPlay
                    >
                      Your browser does not support the audio element.
                    </audio>
                  ) : (
                    <div className="p-3 bg-white/80 rounded-lg border border-pink-200 flex flex-wrap items-center justify-between gap-3">
                      <span className="text-xs text-slate-600">
                        Audio is not stored in local history. Generate audio handoff for this session.
                      </span>
                      <button
                        type="button"
                        onClick={handleRegenerateAudio}
                        disabled={isRegeneratingAudio}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-pink-700 hover:bg-pink-800 disabled:opacity-50 transition-colors cursor-pointer"
                      >
                        {isRegeneratingAudio
                          ? "Generating Audio..."
                          : "▶ Generate Audio Handoff"}
                      </button>
                    </div>
                  )}

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
        onClose={() => setIsSettingsOpen(false)}
        onSave={(updated) => {
          const saved = saveSettings(updated);
          if (saved) {
            setSettings(updated);
          }
          return saved;
        }}
      />
    </div>
  );
}

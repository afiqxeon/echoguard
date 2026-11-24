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
  const [sampleIndex, setSampleIndex] = useState(0);
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

  const handleInsertSample = () => {
    const currentSample = SAMPLE_CLINICAL_NOTES[sampleIndex];
    setInput(currentSample.text);
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
    setSampleIndex((prev) => (prev + 1) % SAMPLE_CLINICAL_NOTES.length);
  };

  const handleNewSession = () => {
    if (audioUrl && audioUrl.startsWith("blob:")) {
      URL.revokeObjectURL(audioUrl);
    }
    setInput("");
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
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-6 py-3 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center font-bold text-sm shadow-xs">
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

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setIsHistoryOpen((prev) => !prev)}
            className="lg:hidden inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 cursor-pointer shadow-xs"
          >
            <span>History ({sessions.length})</span>
          </button>

          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            {engineMode === "checking"
              ? "Initializing Local Shield..."
              : engineMode === "nano"
                ? "Hybrid Ready (Nano + Cloud)"
                : "Hybrid Ready (Local Shield + Cloud)"}
          </span>

          <button
            type="button"
            onClick={handleNewSession}
            disabled={isProcessing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 transition-colors cursor-pointer"
          >
            <span>+</span>
            <span>New Session</span>
          </button>

          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 transition-colors shadow-xs cursor-pointer"
          >
            <span>⚙️</span> Settings
          </button>
        </div>
      </header>

      {/* 2. BODY: LEFT SIDEBAR + MAIN WORKSPACE */}
      <div className="flex-1 flex flex-col lg:flex-row max-w-[1600px] w-full mx-auto">
        {/* LEFT SIDEBAR: LOCAL SESSION HISTORY */}
        <aside
          className={`${
            isHistoryOpen ? "flex" : "hidden"
          } lg:flex w-full lg:w-72 xl:w-80 shrink-0 bg-white border-b lg:border-b-0 lg:border-r border-slate-200 flex-col`}
        >
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Encounters ({sessions.length})
              </h2>
              <p className="text-[11px] text-slate-400">
                Local-only • Zero-PII
              </p>
            </div>
            {sessions.length > 0 && (
              <button
                type="button"
                onClick={handleClearHistory}
                className="text-[11px] font-medium text-red-600 hover:underline cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>

          <div className="p-3 space-y-2 overflow-y-auto max-h-64 lg:max-h-[calc(100vh-120px)] flex-1">
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

            <div className="flex items-center justify-between mb-2">
              <label
                htmlFor="transcript-input"
                className="text-sm font-semibold text-slate-700"
              >
                Raw Patient Consultation Transcript
              </label>
              <div className="flex items-center gap-3">
                {isMicSupported && (
                  <button
                    type="button"
                    onClick={toggleListening}
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                      isListening
                        ? "bg-red-100 text-red-700 border border-red-300"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200"
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${
                        isListening ? "bg-red-600 animate-pulse" : "bg-slate-500"
                      }`}
                    />
                    {isListening ? "Stop Dictation" : "Live Mic Dictation"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleInsertSample}
                  className="text-xs font-medium text-sky-600 hover:text-sky-800 hover:underline cursor-pointer"
                  title={`Next: ${SAMPLE_CLINICAL_NOTES[sampleIndex].label}`}
                >
                  Insert Sample ({SAMPLE_CLINICAL_NOTES[sampleIndex].label})
                </button>
              </div>
            </div>

            <textarea
              ref={transcriptInputRef}
              id="transcript-input"
              value={input}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                setInput(e.target.value)
              }
              placeholder="Enter raw clinical notes containing names, phone numbers, or insurance IDs..."
              className="w-full h-24 p-3 rounded-lg border border-slate-300 bg-white text-slate-900 text-sm leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
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

            {/* Action Bar (Run Button + Metrics + 3-Step Tracker) */}
            <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={handleProcessPipeline}
                disabled={!isActionable}
                className={`px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors shadow-xs ${
                  isActionable
                    ? "bg-slate-900 text-white hover:bg-slate-800 cursor-pointer"
                    : "bg-slate-200 text-slate-400 cursor-not-allowed"
                }`}
              >
                {isProcessing
                  ? "Executing Hybrid Pipeline..."
                  : "Run Hybrid AI Pipeline"}
              </button>

              {isProcessing && (
                <span className="text-xs font-medium text-indigo-600">
                  {statusMessage}
                </span>
              )}

              {ttftMs !== null && (
                <span className="text-xs font-medium text-sky-700">
                  Local First Token (TTFT): <strong>{ttftMs} ms</strong>
                </span>
              )}
              {localLatencyMs !== null && (
                <span className="text-xs font-medium text-slate-600">
                  Local Total: <strong>{localLatencyMs} ms</strong>
                </span>
              )}

              {pipelineStage !== "idle" && (
                <div className="w-full mt-2 flex flex-wrap items-center gap-2 text-xs">
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

            {/* Card 3: Multi-Speaker Action Plan — selalu tampil di kiri bawah */}
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
                    <div className="mt-3 p-3 bg-white/80 rounded-lg border border-pink-200 text-xs text-slate-700 whitespace-pre-line leading-relaxed">
                      <p className="text-[11px] font-semibold text-pink-700 mb-1 uppercase tracking-wider">
                        Spoken Handoff Script
                      </p>
                      {audioScript}
                    </div>
                  )}
                </>
              )}
            </section>
          </div>
        </main>
      </div>

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

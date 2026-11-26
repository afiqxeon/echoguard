import { useState, useEffect, useRef } from "react";
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
import { Navbar } from "./components/layout/Navbar";
import { EncounterSidebar } from "./components/layout/EncounterSidebar";
import { TranscriptInputCard } from "./components/workspace/TranscriptInputCard";
import { LocalPayloadCard } from "./components/workspace/LocalPayloadCard";
import { SoapNoteCard } from "./components/workspace/SoapNoteCard";
import { AudioHandoffCard } from "./components/workspace/AudioHandoffCard";
import {
  CLOUD_MODELS,
  DEFAULT_CLOUD_MODEL,
  type CloudModelId,
} from "./constants/models";
import {
  loadSettings,
  saveSettings,
  DOCTOR_VOICE_OPTIONS,
  NURSE_VOICE_OPTIONS,
} from "./utils/settingsStorage";
import {
  loadSessions,
  saveSession,
  updateSession,
  deleteSession,
  clearAllSessions,
} from "./utils/sessionStorage";
import type {
  ClinicalSessionRecord,
  EngineStatus,
  LocalEngineMode,
  PipelineStage,
  PrivacyAuditReceipt,
  SoapErrorInfo,
} from "./types/clinical";
import type { EchoGuardSettings } from "./types/settings";

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
  const [soapError, setSoapError] = useState<SoapErrorInfo | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [audioScript, setAudioScript] = useState<string>("");
  const [pipelineStage, setPipelineStage] = useState<PipelineStage>("idle");
  const [copied, setCopied] = useState(false);
  const [generatedVoices, setGeneratedVoices] = useState<{
    doctorVoice: string;
    nurseVoice: string;
  } | null>(null);
  const [isRegeneratingAudio, setIsRegeneratingAudio] = useState(false);

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
        const languageModelApi = (
          window as unknown as {
            LanguageModel?: {
              availability?: (opts: unknown) => Promise<string>;
            };
          }
        ).LanguageModel;
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

  const classifySoapError = (err: unknown): SoapErrorInfo => {
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
      return;
    }

    const totalRedacted =
      entitiesStrippedCount ??
      (cleanPayload.match(/\[REDACTED\]/g) || []).length;

    const currentSessions = saveSession({
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

    // Stage 1A: Deterministic Pre-Filter
    const preFiltered = redactPIIDeterministically(input);
    let sanitizedPayload = preFiltered.redactedText;

    try {
      if (engineMode === "nano") {
        try {
          // Stage 1B: Semantic pass via Gemini Nano (Firebase AI Logic ONLY_ON_DEVICE)
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

  const activeEncounterId = sessions.find(
    (s) => s.id === activeSessionId,
  )?.encounterId;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
      <Navbar
        engineMode={engineMode}
        sessionCount={sessions.length}
        isHistoryOpen={isHistoryOpen}
        isProcessing={isProcessing}
        onToggleHistory={() => setIsHistoryOpen((prev) => !prev)}
        onNewSession={handleNewSession}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenHelp={() => setIsHelpOpen(true)}
      />

      <div className="flex-1 flex flex-col lg:flex-row max-w-[1600px] w-full mx-auto">
        <EncounterSidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          isHistoryOpen={isHistoryOpen}
          onCloseHistory={() => setIsHistoryOpen(false)}
          onLoadSession={handleLoadSession}
          onDeleteSession={handleDeleteSession}
          onClearHistory={handleClearHistory}
        />

        <main className="flex-1 p-5 lg:p-6 space-y-5 min-w-0">
          <TranscriptInputCard
            activeSessionId={activeSessionId}
            activeEncounterId={activeEncounterId}
            input={input}
            sampleIndex={sampleIndex}
            transcriptInputRef={transcriptInputRef}
            isEncounterLocked={isEncounterLocked}
            isProcessing={isProcessing}
            isActionable={isActionable}
            isMicSupported={isMicSupported}
            isListening={isListening}
            interimTranscript={interimTranscript}
            micError={micError}
            statusMessage={statusMessage}
            ttftMs={ttftMs}
            localLatencyMs={localLatencyMs}
            pipelineStage={pipelineStage}
            onInputChange={(value) => {
              setInput(value);
              setSampleIndex(null);
            }}
            onClearInput={() => {
              setInput("");
              setSampleIndex(null);
            }}
            onSelectSample={handleSelectSample}
            onToggleListening={toggleListening}
            onRunPipeline={handleProcessPipeline}
            onNewSession={handleNewSession}
          />

          <div className="grid grid-cols-1 xl:grid-cols-12 xl:grid-rows-[1fr_auto] gap-5">
            <LocalPayloadCard
              redactedText={redactedText}
              engineState={engineState}
              privacyAudit={privacyAudit}
            />

            <SoapNoteCard
              soapNote={soapNote}
              redactedText={redactedText}
              soapError={soapError}
              isProcessing={isProcessing}
              engineState={engineState}
              isSoapExpanded={isSoapExpanded}
              copied={copied}
              onToggleExpand={() => setIsSoapExpanded((prev) => !prev)}
              onRegenerateSoap={handleRegenerateSOAP}
              onCopySoap={handleCopySoap}
              onExportFhir={() =>
                downloadFhirJson({
                  soapNote,
                  redactedTranscript: redactedText,
                  handoffScript: audioScript,
                  localEngine: engineMode,
                })
              }
            />

            <AudioHandoffCard
              soapNote={soapNote}
              audioUrl={audioUrl}
              audioScript={audioScript}
              audioError={audioError}
              pipelineStage={pipelineStage}
              isProcessing={isProcessing}
              isRegeneratingAudio={isRegeneratingAudio}
              isAudioOutdated={isAudioOutdated}
              activeDoctorLabel={activeDoctorLabel}
              activeNurseLabel={activeNurseLabel}
              onGenerateAudio={handleRegenerateAudio}
            />
          </div>
        </main>
      </div>

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

      <HowItWorksModal
        isOpen={isHelpOpen}
        onClose={() => setIsHelpOpen(false)}
      />
    </div>
  );
}

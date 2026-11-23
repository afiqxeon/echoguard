import ReactMarkdown from "react-markdown";
import { useState, useEffect, type ChangeEvent } from "react";
import {
  generateSOAPNote,
  generateMedicalAudio,
} from "./services/firebaseHybrid";
import { redactPIIDeterministically } from "./utils/deterministicRedactor";
import { useClinicalDictation } from "./hooks/useClinicalDictation";
import { downloadFhirJson, downloadAudioWav } from "./utils/clinicalExport";

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

export default function PIIRedactor() {
  const [engineMode, setEngineMode] = useState<LocalEngineMode>("checking");
  const [input, setInput] = useState("");

  const {
    isSupported: isMicSupported,
    isListening,
    interimTranscript,
    error: micError,
    stopListening,
    toggleListening,
  } = useClinicalDictation({
    onFinalTranscript: (spokenText) => {
      setInput((prev) =>
        prev.trim() ? `${prev.trim()} ${spokenText}` : spokenText,
      );
    },
  });

  // Pipeline Outputs
  const [redactedText, setRedactedText] = useState("");
  const [soapNote, setSoapNote] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [audioScript, setAudioScript] = useState<string>("");
  const [copied, setCopied] = useState(false);

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
    setRedactedText("");
    setSoapNote("");
    setAudioUrl("");
    setAudioScript("");
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

      // --- STEP 2: CLOUD INFERENCE (SOAP NOTE) ---
      setEngineState("processing_cloud");
      setStatusMessage(
        "Step 2/3: Routing secured payload to Firebase Cloud for SOAP synthesis...",
      );
      const generatedSoap = await generateSOAPNote(sanitizedPayload);
      setSoapNote(generatedSoap);

      // --- STEP 3: CLOUD TTS (MULTI-SPEAKER AUDIO) ---
      setEngineState("processing_audio");
      setStatusMessage(
        "Step 3/3: Generating expressive multi-speaker audio via Firebase AI Logic...",
      );
      const { audioUrl: generatedAudioUrl, script } =
        await generateMedicalAudio(generatedSoap);
      setAudioUrl(generatedAudioUrl);
      setAudioScript(script);

      setEngineState("ready");
      setStatusMessage(
        "Pipeline Complete: Local Shield ➔ Cloud SOAP ➔ Cloud TTS.",
      );
    } catch (error) {
      console.error("Pipeline Execution Error:", error);
      setEngineState("error");
      setStatusMessage(
        "Pipeline failed. Please verify local and cloud states.",
      );
    }
  };

  const handleLoadSample = () => {
    setInput(
      "Patient John Doe (DOB: 04/12/1982, Insurance ID: AETNA992841, Phone: 555-019-8372) reports acute chest tightness and shortness of breath persisting for 48 hours.",
    );
    setRedactedText("");
    setSoapNote("");
    setAudioUrl("");
    setAudioScript("");
    setTtftMs(null);
    setLocalLatencyMs(null);
  };

  const isActionable =
    (engineMode === "nano" || engineMode === "deterministic") &&
    input.trim().length > 0 &&
    !engineState.startsWith("processing");

  return (
    <div
      style={{
        padding: "28px",
        fontFamily: "system-ui, -apple-system, sans-serif",
        color: "#0f172a",
        textAlign: "left",
        maxWidth: "960px",
        margin: "0 auto",
      }}
    >
      {/* Header & Security Badge */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "12px",
          marginBottom: "20px",
        }}
      >
        <div>
          <h2
            style={{
              margin: 0,
              fontSize: "24px",
              fontWeight: 700,
              color: "#0f172a",
            }}
          >
            EchoGuard — Hybrid Telehealth Scribe
          </h2>
          <p
            style={{ margin: "4px 0 0 0", fontSize: "14px", color: "#64748b" }}
          >
            Zero-Trust PII Shield (Local) + Firebase AI Logic (Cloud)
          </p>
        </div>
        <div
          className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            padding: "6px 14px",
            borderRadius: "9999px",
            fontSize: "12px",
            fontWeight: 500,
            backgroundColor: "#ecfdf5",
            color: "#047857",
            border: "1px solid #a7f3d0",
            transition: "all 0.3s ease",
          }}
        >
          {engineMode === "checking" && "Initializing Local Privacy Shield..."}
          {engineMode === "nano" &&
            "Hybrid System Ready (Gemini Nano Local + Firebase Cloud)"}
          {engineMode === "deterministic" &&
            "Hybrid System Ready (Deterministic Local Shield + Firebase Cloud)"}
        </div>
      </div>

      {/* Input Section */}
      <div style={{ marginBottom: "20px" }}>
        <div
          className="flex items-center justify-between mb-2"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "8px",
          }}
        >
          <label
            htmlFor="transcript-input"
            className="text-sm font-semibold text-slate-700"
            style={{ fontSize: "14px", fontWeight: 600, color: "#334155" }}
          >
            Raw Patient Consultation Transcript
          </label>
          <div
            className="flex items-center gap-3"
            style={{ display: "flex", alignItems: "center", gap: "12px" }}
          >
            {isMicSupported && (
              <button
                type="button"
                onClick={toggleListening}
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  isListening
                    ? "bg-red-100 text-red-700 border border-red-300"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200"
                }`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "4px 10px",
                  borderRadius: "6px",
                  fontSize: "12px",
                  fontWeight: 500,
                  cursor: "pointer",
                  backgroundColor: isListening ? "#fee2e2" : "#f1f5f9",
                  color: isListening ? "#b91c1c" : "#334155",
                  border: isListening
                    ? "1px solid #fca5a5"
                    : "1px solid #e2e8f0",
                }}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    isListening ? "bg-red-600 animate-pulse" : "bg-slate-500"
                  }`}
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "9999px",
                    backgroundColor: isListening ? "#dc2626" : "#64748b",
                  }}
                />
                {isListening ? "Stop Dictation" : "Live Mic Dictation"}
              </button>
            )}
            <button
              type="button"
              onClick={handleLoadSample}
              className="text-xs font-medium text-blue-600 hover:underline"
              style={{
                background: "none",
                border: "none",
                color: "#2563eb",
                fontSize: "12px",
                fontWeight: 500,
                cursor: "pointer",
                padding: 0,
                textDecoration: "underline",
              }}
            >
              Insert Sample Clinical Note
            </button>
          </div>
        </div>
        <textarea
          id="transcript-input"
          value={input}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
            setInput(e.target.value)
          }
          placeholder="Enter raw clinical notes containing names, phone numbers, or insurance IDs..."
          style={{
            width: "100%",
            height: "90px",
            padding: "12px",
            boxSizing: "border-box",
            borderRadius: "8px",
            border: "1px solid #cbd5e1",
            backgroundColor: "#ffffff",
            color: "#0f172a",
            fontSize: "14px",
            lineHeight: "1.5",
            resize: "vertical",
          }}
        />
        {isListening && interimTranscript && (
          <p
            className="mt-1.5 text-xs text-slate-500 italic"
            style={{
              marginTop: "6px",
              fontSize: "12px",
              color: "#64748b",
              fontStyle: "italic",
            }}
          >
            Listening: "{interimTranscript}..."
          </p>
        )}
        {micError && (
          <p
            className="mt-1.5 text-xs text-red-600"
            style={{
              marginTop: "6px",
              fontSize: "12px",
              color: "#dc2626",
            }}
          >
            {micError}
          </p>
        )}
      </div>

      {/* Action Bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "16px",
          marginBottom: "28px",
        }}
      >
        <button
          type="button"
          onClick={handleProcessPipeline}
          disabled={!isActionable}
          style={{
            padding: "12px 24px",
            backgroundColor: isActionable ? "#0f172a" : "#94a3b8",
            color: "#ffffff",
            border: "none",
            borderRadius: "6px",
            fontSize: "14px",
            fontWeight: 600,
            cursor: isActionable ? "pointer" : "not-allowed",
            transition: "background-color 0.2s",
          }}
        >
          {engineState.startsWith("processing")
            ? "Executing Hybrid Pipeline..."
            : "Run Hybrid AI Pipeline"}
        </button>

        {engineState.startsWith("processing") && (
          <span style={{ fontSize: "13px", color: "#6366f1", fontWeight: 500 }}>
            {statusMessage}
          </span>
        )}

        {ttftMs !== null && (
          <span style={{ fontSize: "13px", color: "#0369a1", fontWeight: 500 }}>
            Local First Token (TTFT): <strong>{ttftMs} ms</strong>
          </span>
        )}
        {localLatencyMs !== null && (
          <span style={{ fontSize: "13px", color: "#475569", fontWeight: 500 }}>
            Local Total: <strong>{localLatencyMs} ms</strong>
          </span>
        )}
      </div>

      {/* Output Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: "24px",
        }}
      >
        {/* Local Output Panel */}
        <div
          style={{
            padding: "20px",
            border: "1px solid #cbd5e1",
            backgroundColor: "#f8fafc",
            borderRadius: "8px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "12px",
            }}
          >
            <h3
              style={{
                margin: 0,
                fontSize: "14px",
                fontWeight: 700,
                color: "#1e293b",
              }}
            >
              1. Local Payload (Cleared for Cloud)
            </h3>
            {redactedText && engineState !== "processing_local" && (
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  color: "#16a34a",
                  letterSpacing: "0.05em",
                }}
              >
                ✓ ZERO-PII
              </span>
            )}
          </div>
          <p
            style={{
              margin: 0,
              fontSize: "14px",
              lineHeight: "1.6",
              color: redactedText ? "#0f172a" : "#94a3b8",
              whiteSpace: "pre-wrap",
              flexGrow: 1,
            }}
          >
            {redactedText || "Sanitized stream will appear here..."}
          </p>
        </div>

        {/* Cloud Output Panel */}
        <div
          style={{
            padding: "20px",
            border: "1px solid #bae6fd",
            backgroundColor: "#f0f9ff",
            borderRadius: "8px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "12px",
            }}
          >
            <h3
              style={{
                margin: 0,
                fontSize: "14px",
                fontWeight: 700,
                color: "#0369a1",
              }}
            >
              2. Cloud SOAP Note Synthesis
            </h3>
            {soapNote && (
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  color: "#0284c7",
                  letterSpacing: "0.05em",
                }}
              >
                ✦ CLOUD INFERENCE
              </span>
            )}
          </div>

          <div
            style={{
              flexGrow: 1,
              fontSize: "14px",
              lineHeight: "1.6",
              color: soapNote ? "#0f172a" : "#94a3b8",
            }}
          >
            {soapNote ? (
              // ReactMarkdown parses raw markdown text into semantic HTML elements
              <ReactMarkdown
                components={{
                  h2: ({ node: _node, ...props }) => (
                    <h2
                      style={{
                        fontSize: "16px",
                        margin: "0 0 12px 0",
                        color: "#0c4a6e",
                      }}
                      {...props}
                    />
                  ),
                  p: ({ node: _node, ...props }) => (
                    <p style={{ margin: "0 0 12px 0" }} {...props} />
                  ),
                  ul: ({ node: _node, ...props }) => (
                    <ul
                      style={{ margin: "0 0 12px 0", paddingLeft: "20px" }}
                      {...props}
                    />
                  ),
                  ol: ({ node: _node, ...props }) => (
                    <ol
                      style={{ margin: "0 0 12px 0", paddingLeft: "20px" }}
                      {...props}
                    />
                  ),
                }}
              >
                {soapNote}
              </ReactMarkdown>
            ) : (
              <p style={{ margin: 0 }}>
                {engineState === "processing_cloud"
                  ? "Analyzing secured payload in Firebase AI..."
                  : "Awaiting secure payload..."}
              </p>
            )}
          </div>

          {soapNote && (
            <div
              className="mt-4 pt-3 border-t border-sky-200/70 flex flex-wrap items-center gap-2"
              style={{
                marginTop: "16px",
                paddingTop: "12px",
                borderTop: "1px solid rgba(186, 230, 253, 0.7)",
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <button
                type="button"
                onClick={handleCopySoap}
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 transition-colors"
                style={{
                  padding: "6px 12px",
                  borderRadius: "6px",
                  fontSize: "12px",
                  fontWeight: 500,
                  backgroundColor: "#ffffff",
                  color: "#334155",
                  border: "1px solid #cbd5e1",
                  cursor: "pointer",
                }}
              >
                {copied ? "Copied to Clipboard" : "Copy SOAP Note"}
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
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-sky-600 text-white hover:bg-sky-700 transition-colors"
                style={{
                  padding: "6px 12px",
                  borderRadius: "6px",
                  fontSize: "12px",
                  fontWeight: 500,
                  backgroundColor: "#0284c7",
                  color: "#ffffff",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Export HL7 FHIR JSON
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Cloud TTS Audio Panel */}
      {audioUrl && (
        <div
          style={{
            marginTop: "24px",
            padding: "20px",
            border: "1px solid #fbcfe8",
            backgroundColor: "#fdf4ff",
            borderRadius: "8px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "12px",
            }}
          >
            <h3
              style={{
                margin: 0,
                fontSize: "14px",
                fontWeight: 700,
                color: "#be185d",
              }}
            >
              3. Multi-Speaker Action Plan (Doctor & Nurse)
            </h3>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  color: "#be185d",
                  letterSpacing: "0.05em",
                }}
              >
                🔊 FIREBASE TTS
              </span>
              <button
                type="button"
                onClick={() => downloadAudioWav(audioUrl)}
                className="px-3 py-1 rounded-md text-xs font-medium bg-white text-rose-700 border border-rose-200 hover:bg-rose-50 transition-colors"
                style={{
                  padding: "4px 12px",
                  borderRadius: "6px",
                  fontSize: "12px",
                  fontWeight: 500,
                  backgroundColor: "#ffffff",
                  color: "#be185d",
                  border: "1px solid #fecdd3",
                  cursor: "pointer",
                }}
              >
                Download WAV
              </button>
            </div>
          </div>
          <audio
            controls
            src={audioUrl}
            style={{ width: "100%", outline: "none" }}
            autoPlay
          >
            Your browser does not support the audio element.
          </audio>
          {audioScript && (
            <div
              className="mt-3 p-3 bg-white/80 rounded-lg border border-pink-200 text-sm text-slate-700 whitespace-pre-line"
              style={{
                marginTop: "12px",
                padding: "12px",
                backgroundColor: "rgba(255, 255, 255, 0.85)",
                borderRadius: "8px",
                border: "1px solid #fbcfe8",
                fontSize: "14px",
                color: "#334155",
                whiteSpace: "pre-line",
                lineHeight: "1.5",
              }}
            >
              <p
                className="text-xs font-semibold text-pink-700 mb-1 uppercase tracking-wide"
                style={{
                  margin: "0 0 6px 0",
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "#be185d",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Spoken Handoff Script
              </p>
              {audioScript}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

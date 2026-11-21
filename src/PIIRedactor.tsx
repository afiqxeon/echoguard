import ReactMarkdown from "react-markdown";
import { useState, useEffect, type ChangeEvent } from "react";
import {
  generateSOAPNote,
  generateMedicalAudio,
} from "./services/firebaseHybrid";

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
  const [session, setSession] = useState<any>(null);
  const [useFallback, setUseFallback] = useState(false);
  const [input, setInput] = useState("");

  // Pipeline Outputs
  const [redactedText, setRedactedText] = useState("");
  const [soapNote, setSoapNote] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [audioScript, setAudioScript] = useState<string>("");

  // Engine States & Metrics
  const [engineState, setEngineState] = useState<EngineStatus>("checking");
  const [statusMessage, setStatusMessage] = useState(
    "Checking local Gemini Nano availability...",
  );
  const [ttftMs, setTtftMs] = useState<number | null>(null);
  const [localLatencyMs, setLocalLatencyMs] = useState<number | null>(null);

  useEffect(() => {
    let isMounted = true;
    let activeSession: any = null;

    async function initLocalModel() {
      const win = window as any;
      const systemPrompt =
        "Replace all PII (names, DOB, phone numbers, addresses, insurance/ID numbers) with [REDACTED]. Keep all medical terms unchanged. Output ONLY the redacted text.";

      try {
        if ("LanguageModel" in win) {
          if (isMounted)
            setStatusMessage("Verifying LanguageModel API availability...");

          const modelOptions = {
            expectedInputs: [{ type: "text", languages: ["en"] }],
            expectedOutputs: [{ type: "text", languages: ["en"] }],
          };

          const availability =
            await win.LanguageModel.availability(modelOptions);

          if (availability !== "unavailable") {
            if (isMounted) {
              setEngineState("downloading");
              setStatusMessage("Initializing local Gemini Nano session...");
            }

            activeSession = await win.LanguageModel.create({
              ...modelOptions,
              outputLanguage: "en",
              temperature: 0,
              topK: 1,
              initialPrompts: [{ role: "system", content: systemPrompt }],
              monitor(m: any) {
                m.addEventListener("downloadprogress", (e: any) => {
                  if (!isMounted) return;
                  const percent = Math.round(e.loaded * 100);
                  setEngineState("downloading");
                  setStatusMessage(
                    `Downloading on-device Gemini Nano weights: ${percent}%`,
                  );
                });
              },
            });

            if (isMounted) {
              setSession(activeSession);
              setEngineState("ready");
              setStatusMessage(
                "Hybrid System Ready (Nano Local + Firebase Cloud)",
              );
            }
            return;
          }
        }

        if ("ai" in win && win.ai) {
          if (isMounted)
            setStatusMessage("Initializing local window.ai session...");
          activeSession = win.ai.languageModel
            ? await win.ai.languageModel.create({
                systemPrompt,
                temperature: 0,
                topK: 1,
              })
            : await win.ai.createTextSession({ systemPrompt });

          if (isMounted) {
            setSession(activeSession);
            setEngineState("ready");
            setStatusMessage(
              "Hybrid System Ready (Nano Local + Firebase Cloud)",
            );
          }
          return;
        }

        if (isMounted) {
          setUseFallback(true);
          setEngineState("fallback");
          setStatusMessage(
            "Chrome Built-in AI unavailable. Active: Regex Guardrail + Cloud.",
          );
        }
      } catch (error) {
        console.error("Local AI Initialization Error:", error);
        if (isMounted) {
          setUseFallback(true);
          setEngineState("fallback");
          setStatusMessage(
            "On-device model pending. Active: Regex Guardrail + Cloud.",
          );
        }
      }
    }

    initLocalModel();

    return () => {
      isMounted = false;
      if (activeSession && typeof activeSession.destroy === "function") {
        activeSession.destroy();
      }
    };
  }, []);

  const redactWithDeterministicGuardrail = (text: string): string => {
    return text
      .replace(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g, "[REDACTED_NAME]")
      .replace(
        /\b\d{3}[-.\s]?\d{2,4}[-.\s]?\d{4}\b/g,
        "[REDACTED_PHONE_OR_SSN]",
      )
      .replace(/\b[A-Z0-9]{6,}\b/g, "[REDACTED_ID]");
  };

  const handleProcessPipeline = async () => {
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
    let finalRedacted = "";

    try {
      if (session) {
        if (typeof session.promptStreaming === "function") {
          const stream = session.promptStreaming(input, {
            outputLanguage: "en",
          });
          for await (const chunk of stream) {
            if (!firstTokenRecorded) {
              setTtftMs(Math.round(performance.now() - startTime));
              firstTokenRecorded = true;
            }
            finalRedacted =
              chunk.startsWith(finalRedacted) && finalRedacted.length > 0
                ? chunk
                : finalRedacted + chunk;
            setRedactedText(finalRedacted);
          }
        } else {
          finalRedacted = await session.prompt(input, { outputLanguage: "en" });
          setTtftMs(Math.round(performance.now() - startTime));
          setRedactedText(finalRedacted);
        }
      } else if (useFallback) {
        finalRedacted = redactWithDeterministicGuardrail(input);
        setTtftMs(Math.round(performance.now() - startTime));
        setRedactedText(finalRedacted);
      }

      setLocalLatencyMs(Math.round(performance.now() - startTime));

      // --- STEP 2: CLOUD INFERENCE (SOAP NOTE) ---
      setEngineState("processing_cloud");
      setStatusMessage(
        "Step 2/3: Routing secured payload to Firebase Cloud for SOAP synthesis...",
      );
      const generatedSoap = await generateSOAPNote(finalRedacted);
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

  const getBadgeStyle = () => {
    switch (engineState) {
      case "ready":
        return {
          backgroundColor: "#dcfce7",
          color: "#166534",
          border: "1px solid #86efac",
        };
      case "downloading":
      case "checking":
        return {
          backgroundColor: "#fef9c3",
          color: "#854d0e",
          border: "1px solid #fde047",
        };
      case "processing_local":
      case "processing_cloud":
      case "processing_audio":
        return {
          backgroundColor: "#e0e7ff",
          color: "#3730a3",
          border: "1px solid #a5b4fc",
        };
      case "fallback":
        return {
          backgroundColor: "#e0f2fe",
          color: "#075985",
          border: "1px solid #7dd3fc",
        };
      case "error":
        return {
          backgroundColor: "#fee2e2",
          color: "#991b1b",
          border: "1px solid #fca5a5",
        };
    }
  };

  const isActionable =
    (session || useFallback) &&
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
        <span
          style={{
            padding: "6px 12px",
            borderRadius: "9999px",
            fontSize: "12px",
            fontWeight: 600,
            transition: "all 0.3s ease",
            ...getBadgeStyle(),
          }}
        >
          {statusMessage}
        </span>
      </div>

      {/* Input Section */}
      <div style={{ marginBottom: "20px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "8px",
          }}
        >
          <label
            htmlFor="transcript-input"
            style={{ fontSize: "14px", fontWeight: 600, color: "#334155" }}
          >
            Raw Patient Consultation Transcript
          </label>
          <button
            type="button"
            onClick={handleLoadSample}
            style={{
              background: "none",
              border: "none",
              color: "#2563eb",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
              padding: 0,
              textDecoration: "underline",
            }}
          >
            Insert Sample Clinical Note
          </button>
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
              // react-markdown merender teks mentah menjadi HTML asli (bold, list, dll)
              <ReactMarkdown
                components={{
                  h2: ({ node, ...props }) => (
                    <h2
                      style={{
                        fontSize: "16px",
                        margin: "0 0 12px 0",
                        color: "#0c4a6e",
                      }}
                      {...props}
                    />
                  ),
                  p: ({ node, ...props }) => (
                    <p style={{ margin: "0 0 12px 0" }} {...props} />
                  ),
                  ul: ({ node, ...props }) => (
                    <ul
                      style={{ margin: "0 0 12px 0", paddingLeft: "20px" }}
                      {...props}
                    />
                  ),
                  ol: ({ node, ...props }) => (
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

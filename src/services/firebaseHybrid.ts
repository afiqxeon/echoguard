import { initializeApp } from "firebase/app";
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
} from "firebase/app-check";
import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
} from "firebase/ai";
import {
  getRemoteConfig,
  fetchAndActivate,
  getString,
} from "firebase/remote-config";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const requiredEnvVars = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_PROJECT_ID",
] as const;

for (const key of requiredEnvVars) {
  if (!import.meta.env[key]) {
    console.error(
      `[EchoGuard Config Error] Missing environment variable: ${key}`,
    );
  }
}

const app = initializeApp(firebaseConfig);

// Enable Firebase App Check debug token for local development or configured debug token
const debugToken = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN?.trim();
if (debugToken) {
  (
    self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string }
  ).FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken;
} else if (import.meta.env.DEV) {
  (
    self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean }
  ).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
}

const recaptchaSiteKey =
  import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY?.trim() ||
  "dummy-key-for-localhost-debug";

initializeAppCheck(app, {
  provider: new ReCaptchaEnterpriseProvider(recaptchaSiteKey),
  isTokenAutoRefreshEnabled: true,
});

// Initialize Firebase AI Logic module with Google Gemini Developer API
const ai = getAI(app, { backend: new GoogleAIBackend() });

export const IS_MOCK_MODE = import.meta.env.VITE_ENABLE_MOCK_MODE === "true";
const TEXT_MODEL = import.meta.env.VITE_GEMINI_TEXT_MODEL || "gemini-3.8-flash";
const TTS_MODEL = import.meta.env.VITE_GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts";

const DEFAULT_SOAP_PROMPT =
  "You are a strict clinical documentation assistant. Convert the following PII-redacted transcript into a highly structured medical SOAP note (Subjective, Objective, Assessment, Plan). Do not invent any patient identifiers.";

const remoteConfig = getRemoteConfig(app);
remoteConfig.settings.minimumFetchIntervalMillis = import.meta.env.DEV
  ? 10_000
  : 300_000;
remoteConfig.defaultConfig = {
  default_cloud_model: TEXT_MODEL,
  tts_model: TTS_MODEL,
  soap_system_prompt: DEFAULT_SOAP_PROMPT,
};

export interface RemoteClinicalConfig {
  defaultCloudModel: string;
  ttsModel: string;
  soapSystemPrompt: string;
  source: "remote" | "default";
}

export async function initRemoteClinicalConfig(): Promise<RemoteClinicalConfig> {
  try {
    await fetchAndActivate(remoteConfig);
    return {
      defaultCloudModel:
        getString(remoteConfig, "default_cloud_model").trim() || TEXT_MODEL,
      ttsModel: getString(remoteConfig, "tts_model").trim() || TTS_MODEL,
      soapSystemPrompt:
        getString(remoteConfig, "soap_system_prompt").trim() ||
        DEFAULT_SOAP_PROMPT,
      source: "remote",
    };
  } catch (error) {
    console.warn("[EchoGuard RemoteConfig] Using local defaults:", error);
    return {
      defaultCloudModel: TEXT_MODEL,
      ttsModel: TTS_MODEL,
      soapSystemPrompt: DEFAULT_SOAP_PROMPT,
      source: "default",
    };
  }
}

function getActiveTtsModel(): string {
  return getString(remoteConfig, "tts_model").trim() || TTS_MODEL;
}

function getActiveSoapPrompt(): string {
  return (
    getString(remoteConfig, "soap_system_prompt").trim() || DEFAULT_SOAP_PROMPT
  );
}

/**
 * Redacts residual PII on-device using Gemini Nano via Firebase AI Logic hybrid mode.
 */
export async function redactPIIViaFirebaseNano(
  rawTranscript: string,
  onChunk?: (partialText: string) => void,
): Promise<string> {
  const onDeviceModel = getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_ON_DEVICE,
    onDeviceParams: {
      createOptions: {
        expectedOutputs: [{ type: "text", languages: ["en"] }],
        initialPrompts: [
          {
            role: "system",
            content: [
              {
                type: "text",
                value:
                  "You are a strict PII redaction engine. Return ONLY the original text with any remaining personal identifiers (names, addresses, dates of birth, IDs, phone numbers) replaced by [REDACTED]. Do NOT add explanations, markdown, bullet points, or medical advice.",
              },
            ],
          },
        ],
      },
    },
  });

  const prompt = `Replace all patient PII (names, DOB, phone, insurance/MRN IDs) with [REDACTED]. Keep all medical facts unchanged.\n\n${rawTranscript}`;

  if (onChunk) {
    const streamResult = await onDeviceModel.generateContentStream(prompt);
    let fullText = "";
    for await (const chunk of streamResult.stream) {
      const chunkText = chunk.text();
      if (chunkText) {
        fullText += chunkText;
        onChunk(fullText);
      }
    }
    const finalResponse = await streamResult.response;
    return finalResponse.text() || fullText;
  }

  const result = await onDeviceModel.generateContent(prompt);
  return result.response.text();
}

/**
 * Generates a structured medical SOAP note from a PII-redacted transcript.
 */
export async function generateSOAPNote(
  redactedTranscript: string,
  modelName: string = TEXT_MODEL,
): Promise<string> {
  if (IS_MOCK_MODE) {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(
          `## SOAP Medical Note (Simulated)\n\n**Subjective:**\n${redactedTranscript}`,
        );
      }, 1000);
    });
  }

  try {
    const model = getGenerativeModel(ai, { model: modelName || TEXT_MODEL });
    const prompt = `${getActiveSoapPrompt()}

Transcript:
${redactedTranscript}`;

    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (error) {
    console.error("Cloud SOAP Synthesis Error:", error);
    throw error;
  }
}

export interface SpeakerVoiceSelection {
  doctorVoice: string;
  nurseVoice: string;
}

interface HandoffTurn {
  voice: string;
  text: string;
}

const PCM_SAMPLE_RATE = 24000;
const PCM_BYTES_PER_SAMPLE = 2; // 16-bit mono linear PCM
const SILENCE_GAP_MS = 350;
const MAX_HANDOFF_TURNS = 2;
const MAX_HANDOFF_CACHE_ENTRIES = 20;

const handoffPcmCache = new Map<string, Uint8Array>();
const voicePreviewPcmCache = new Map<string, Uint8Array>();

function setBoundedCache<T>(
  cache: Map<string, T>,
  key: string,
  value: T,
  maxEntries: number,
): void {
  if (cache.has(key)) {
    cache.delete(key);
  } else if (cache.size >= maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) {
      cache.delete(oldestKey);
    }
  }
  cache.set(key, value);
}

/**
 * Extracts at most two clinical handoff dialogue turns (Doctor / Nurse)
 * to guarantee strict speaker-to-voice mapping and cap TTS quota usage.
 */
function parseHandoffTurns(
  handoffScript: string,
  voiceConfig: SpeakerVoiceSelection,
): HandoffTurn[] {
  const rawLines = handoffScript
    .replace(/\r\n/g, "\n")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const labeledLines = rawLines.filter((line) =>
    /^(doctor|nurse)\s*:/i.test(line),
  );
  const selectedLines = (
    labeledLines.length > 0 ? labeledLines : rawLines
  ).slice(0, MAX_HANDOFF_TURNS);

  return selectedLines
    .map((line, index) => {
      const isNurse =
        /^nurse\s*:/i.test(line) ||
        (!/^doctor\s*:/i.test(line) && index === 1);

      return {
        voice: isNurse ? voiceConfig.nurseVoice : voiceConfig.doctorVoice,
        text: line.replace(/^(doctor|nurse)\s*:/i, "").trim(),
      };
    })
    .filter((turn) => turn.text.length > 0);
}

async function fetchSingleSpeakerPcm(
  text: string,
  voiceName: string,
): Promise<Uint8Array> {
  const ttsModel = getGenerativeModel(ai, {
    model: getActiveTtsModel(),
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName },
        },
      },
    } as Record<string, unknown>,
  });

  const result = await ttsModel.generateContent(text);
  const response = result.response as {
    inlineDataParts?: () => Array<{ inlineData?: { data?: string } }>;
    candidates?: Array<{
      content?: { parts?: Array<{ inlineData?: { data?: string } }> };
    }>;
  };

  const inlinePart =
    response.inlineDataParts?.()?.[0] ||
    response.candidates?.[0]?.content?.parts?.find((part) => part.inlineData);

  const base64Data = inlinePart?.inlineData?.data;
  if (!base64Data) {
    throw new Error(`No PCM audio data returned for voice: ${voiceName}`);
  }

  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Converts a clinical handoff script into multi-speaker dialogue audio
 * using Split-and-Stitch PCM synthesis (capped at 2 turns) with in-memory PCM caching.
 */
export async function generateMultiSpeakerAudio(
  handoffScript: string,
  voiceConfig: SpeakerVoiceSelection = {
    doctorVoice: "Fenrir",
    nurseVoice: "Aoede",
  },
): Promise<string> {
  if (IS_MOCK_MODE) {
    return "https://actions.google.com/sounds/v1/alarms/beep_short.ogg";
  }

  const normalizedScript = handoffScript.replace(/\r\n/g, "\n").trim();
  const cacheKey = `${voiceConfig.doctorVoice}|${voiceConfig.nurseVoice}|${normalizedScript}`;
  const cachedPcm = handoffPcmCache.get(cacheKey);
  if (cachedPcm) {
    return pcmBytesToWavUrl(cachedPcm, PCM_SAMPLE_RATE);
  }

  const turns = parseHandoffTurns(normalizedScript, voiceConfig);
  if (turns.length === 0) {
    throw new Error("Handoff script does not contain any speakable dialogue turns.");
  }

  const pcmSegments = await Promise.all(
    turns.map((turn) => fetchSingleSpeakerPcm(turn.text, turn.voice)),
  );

  const silenceGapBytes = Math.round(
    PCM_SAMPLE_RATE * PCM_BYTES_PER_SAMPLE * (SILENCE_GAP_MS / 1000),
  );
  const silenceGap = new Uint8Array(silenceGapBytes);

  const totalLength =
    pcmSegments.reduce((acc, segment) => acc + segment.length, 0) +
    silenceGap.length * Math.max(0, pcmSegments.length - 1);

  const combinedPcm = new Uint8Array(totalLength);
  let offset = 0;
  pcmSegments.forEach((segment, index) => {
    combinedPcm.set(segment, offset);
    offset += segment.length;
    if (index < pcmSegments.length - 1) {
      combinedPcm.set(silenceGap, offset);
      offset += silenceGap.length;
    }
  });

  setBoundedCache(
    handoffPcmCache,
    cacheKey,
    combinedPcm,
    MAX_HANDOFF_CACHE_ENTRIES,
  );

  return pcmBytesToWavUrl(combinedPcm, PCM_SAMPLE_RATE);
}

const VOICE_PREVIEW_LINES: Record<string, string> = {
  // Doctor profiles
  Fenrir: "Please obtain a stat 12-lead ECG and prepare baseline cardiac labs.",
  Orus: "We need continuous telemetry and IV access started right away.",
  Kore: "Let's rule out acute coronary syndrome and order a portable chest X-ray.",
  // Nurse profiles
  Aoede: "Understood, Doctor. I am setting up the telemetry monitor and vitals now.",
  Leda: "Copy that. Preparing the 12-lead ECG and IV line immediately.",
  Puck: "Got it, Doctor. Labs and portable chest X-ray are on the way.",
};

/**
 * Generates an isolated single-speaker audio preview for voice selection,
 * backed by an in-memory Uint8Array PCM cache to avoid redundant TTS calls.
 *
 * @param voiceName - The Gemini TTS voice profile name (e.g., "Fenrir", "Aoede").
 * @param role - The clinical role ("Doctor" or "Nurse").
 * @returns A fresh WAV Blob URL for browser audio playback.
 */
export async function generateSingleVoicePreview(
  voiceName: string,
  role: "Doctor" | "Nurse",
): Promise<string> {
  if (IS_MOCK_MODE) {
    return "https://actions.google.com/sounds/v1/alarms/beep_short.ogg";
  }

  const cacheKey = `${role}:${voiceName}`;
  const cachedPcm = voicePreviewPcmCache.get(cacheKey);
  if (cachedPcm) {
    return pcmBytesToWavUrl(cachedPcm, PCM_SAMPLE_RATE);
  }

  const sampleLine =
    VOICE_PREVIEW_LINES[voiceName] ||
    (role === "Doctor"
      ? "Please obtain a stat 12-lead ECG and monitor vitals closely."
      : "Understood, Doctor. Preparing the monitor and orders right away.");

  try {
    const pcmBytes = await fetchSingleSpeakerPcm(sampleLine, voiceName);
    voicePreviewPcmCache.set(cacheKey, pcmBytes);
    return pcmBytesToWavUrl(pcmBytes, PCM_SAMPLE_RATE);
  } catch (error) {
    console.error("Single Voice Preview Error:", error);
    throw error;
  }
}

/**
 * Converts the medical plan into multi-speaker dialogue audio.
 */
export async function generateMedicalAudio(
  soapNote: string,
  voiceConfig: SpeakerVoiceSelection = {
    doctorVoice: "Fenrir",
    nurseVoice: "Aoede",
  },
  modelName: string = TEXT_MODEL,
): Promise<{ audioUrl: string; script: string }> {
  if (IS_MOCK_MODE) {
    return {
      audioUrl: "https://actions.google.com/sounds/v1/alarms/beep_short.ogg",
      script: "Doctor: Simulated handoff.\nNurse: Understood, proceeding now.",
    };
  }

  try {
    // 1. Synthesize concise clinical handoff dialogue from SOAP Note
    const scriptModel = getGenerativeModel(ai, { model: modelName || TEXT_MODEL });
    const scriptPrompt = `Convert the Assessment and Plan from this SOAP note into a concise 2-line clinical handoff dialogue between Doctor and Nurse. Format strictly as:
Doctor: [sentence]
Nurse: [sentence]

SOAP Note:
${soapNote}`;

    const scriptResult = await scriptModel.generateContent(scriptPrompt);
    const dialogueScript = scriptResult.response.text();

    // 2. Render multi-speaker dialogue audio using Gemini TTS
    const audioUrl = await generateMultiSpeakerAudio(dialogueScript, voiceConfig);

    return { audioUrl, script: dialogueScript };
  } catch (error) {
    console.error("Multi-Speaker TTS Error:", error);
    throw error;
  }
}

/**
 * Encapsulates raw linear PCM bytes with a 44-byte RIFF/WAVE header
 * to produce a playable Blob URL compatible with HTML5 <audio> elements.
 *
 * @param pcmBytes - Raw Uint8Array containing 16-bit linear PCM audio.
 * @param sampleRate - Sampling rate in Hz (default: 24000).
 * @returns A Blob object URL for native browser audio playback.
 */
export function pcmBytesToWavUrl(pcmBytes: Uint8Array, sampleRate = 24000): string {
  const wavBuffer = new ArrayBuffer(44 + pcmBytes.length);
  const view = new DataView(wavBuffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + pcmBytes.length, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // Audio format (1 = PCM)
  view.setUint16(22, 1, true); // Mono (1 channel)
  view.setUint32(24, sampleRate, true); // Sample rate (24000 Hz)
  view.setUint32(28, sampleRate * 2, true); // Byte rate (sampleRate * 1 * 16/8)
  view.setUint16(32, 2, true); // Block align
  view.setUint16(34, 16, true); // Bits per sample
  writeString(36, "data");
  view.setUint32(40, pcmBytes.length, true);

  new Uint8Array(wavBuffer, 44).set(pcmBytes);
  const blob = new Blob([wavBuffer], { type: "audio/wav" });
  return URL.createObjectURL(blob);
}

export const createWavUrlFromPcm = pcmBytesToWavUrl;

/**
 * Encapsulates raw linear PCM base64 audio data with a 44-byte RIFF/WAVE header
 * to produce a playable Blob URL compatible with HTML5 <audio> elements.
 *
 * @param base64Pcm - Raw base64-encoded PCM audio data.
 * @param sampleRate - Sampling rate in Hz (default: 24000).
 * @returns A Blob object URL for native browser audio playback.
 */
export function pcmBase64ToWavUrl(base64Pcm: string, sampleRate = 24000): string {
  const binaryString = atob(base64Pcm);
  const pcmBytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    pcmBytes[i] = binaryString.charCodeAt(i);
  }
  return pcmBytesToWavUrl(pcmBytes, sampleRate);
}

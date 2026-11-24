import { initializeApp } from "firebase/app";
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
} from "firebase/app-check";
import { getAI, getGenerativeModel, GoogleAIBackend } from "firebase/ai";

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

// Enable Firebase App Check debug token for local and staging debugging
(self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean | string }).FIREBASE_APPCHECK_DEBUG_TOKEN =
  import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || true;

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

/**
 * Generates a structured medical SOAP note from a PII-redacted transcript.
 */
export async function generateSOAPNote(
  redactedTranscript: string,
  modelName: string = "gemini-3.8-flash",
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
    const prompt = `You are a strict clinical documentation assistant. Convert the following PII-redacted transcript into a highly structured medical SOAP note (Subjective, Objective, Assessment, Plan). Do not invent any patient identifiers.

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

async function fetchSingleSpeakerPcm(
  text: string,
  voiceName: string,
): Promise<Uint8Array> {
  const ttsModel = getGenerativeModel(ai, {
    model: TTS_MODEL,
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName },
        },
      },
    } as any,
  });

  const result = await ttsModel.generateContent(text);
  const response = result.response as any;
  const inlinePart =
    response.inlineDataParts?.()?.[0] ||
    response.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);

  const base64Data = inlinePart?.inlineData?.data;
  if (!base64Data) {
    throw new Error(`No audio data returned for voice: ${voiceName}`);
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
 * by generating guaranteed single-speaker voice turns in parallel and concatenating PCM segments.
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

  // Parse script turns (Doctor: ... / Nurse: ...)
  const lines = handoffScript
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const turns = lines.map((line) => {
    if (/^nurse\s*:/i.test(line)) {
      return {
        voice: voiceConfig.nurseVoice,
        text: line.replace(/^nurse\s*:/i, "").trim(),
      };
    }
    return {
      voice: voiceConfig.doctorVoice,
      text: line.replace(/^doctor\s*:/i, "").trim(),
    };
  });

  // Generate all turns in parallel with guaranteed single-speaker voice accuracy
  const pcmSegments = await Promise.all(
    turns.map((turn) => fetchSingleSpeakerPcm(turn.text, turn.voice)),
  );

  // 350ms silence gap at 24kHz, 16-bit mono (24000 * 2 bytes * 0.35s = 16800 bytes)
  const silenceGap = new Uint8Array(16800);
  const totalLength =
    pcmSegments.reduce((acc, seg) => acc + seg.length, 0) +
    silenceGap.length * Math.max(0, pcmSegments.length - 1);

  const combinedPcm = new Uint8Array(totalLength);
  let offset = 0;
  pcmSegments.forEach((seg, idx) => {
    combinedPcm.set(seg, offset);
    offset += seg.length;
    if (idx < pcmSegments.length - 1) {
      combinedPcm.set(silenceGap, offset);
      offset += silenceGap.length;
    }
  });

  // Wrap combinedPcm with WAV RIFF header
  return pcmBytesToWavUrl(combinedPcm, 24000);
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
 * Generates an isolated single-speaker audio preview for voice selection.
 *
 * @param voiceName - The Gemini TTS voice profile name (e.g., "Fenrir", "Aoede").
 * @param role - The clinical role ("Doctor" or "Nurse").
 * @returns A Blob object URL for preview playback.
 */
export async function generateSingleVoicePreview(
  voiceName: string,
  role: "Doctor" | "Nurse",
): Promise<string> {
  if (IS_MOCK_MODE) {
    return "https://actions.google.com/sounds/v1/alarms/beep_short.ogg";
  }

  try {
    const ttsModel = getGenerativeModel(ai, {
      model: TTS_MODEL,
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      } as any,
    });

    const sampleLine =
      VOICE_PREVIEW_LINES[voiceName] ||
      (role === "Doctor"
        ? "Please obtain a stat 12-lead ECG and monitor vitals closely."
        : "Understood, Doctor. Preparing the monitor and orders right away.");

    const result = await ttsModel.generateContent(sampleLine);
    const response = result.response as any;
    const inlinePart =
      response.inlineDataParts?.()?.[0] ||
      response.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);

    if (inlinePart?.inlineData?.data) {
      const mimeType = inlinePart.inlineData.mimeType || "";
      return mimeType.includes("pcm") || mimeType.includes("L16")
        ? pcmBase64ToWavUrl(inlinePart.inlineData.data, 24000)
        : `data:${mimeType || "audio/wav"};base64,${inlinePart.inlineData.data}`;
    }

    throw new Error("No audio data returned from voice preview.");
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
  modelName: string = "gemini-3.8-flash",
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

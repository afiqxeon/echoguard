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
  "VITE_RECAPTCHA_ENTERPRISE_SITE_KEY",
] as const;

for (const key of requiredEnvVars) {
  if (!import.meta.env[key]) {
    console.error(
      `[EchoGuard Config Error] Missing environment variable: ${key}`,
    );
  }
}

const app = initializeApp(firebaseConfig);

if (import.meta.env.DEV) {
  (self as any).FIREBASE_APPCHECK_DEBUG_TOKEN =
    import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || true;
}

initializeAppCheck(app, {
  provider: new ReCaptchaEnterpriseProvider(
    import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY,
  ),
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
    const model = getGenerativeModel(ai, { model: TEXT_MODEL });
    const prompt = `You are a strict clinical documentation assistant. Convert the following PII-redacted transcript into a highly structured medical SOAP note (Subjective, Objective, Assessment, Plan). Do not invent any patient identifiers.

Transcript:
${redactedTranscript}`;

    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (error) {
    console.error("Cloud SOAP Synthesis Error:", error);
    throw new Error("Failed to generate SOAP note via Firebase AI Logic.");
  }
}

/**
 * Converts the medical plan into multi-speaker dialogue audio.
 */
export async function generateMedicalAudio(
  soapNote: string,
): Promise<{ audioUrl: string; script: string }> {
  if (IS_MOCK_MODE) {
    return {
      audioUrl: "https://actions.google.com/sounds/v1/alarms/beep_short.ogg",
      script: "Doctor: Simulated handoff.\nNurse: Understood, proceeding now.",
    };
  }

  try {
    // 1. Synthesize concise clinical handoff dialogue from SOAP Note
    const scriptModel = getGenerativeModel(ai, { model: TEXT_MODEL });
    const scriptPrompt = `Convert the Assessment and Plan from this SOAP note into a concise 2-line clinical handoff dialogue between Doctor and Nurse. Format strictly as:
Doctor: [sentence]
Nurse: [sentence]

SOAP Note:
${soapNote}`;

    const scriptResult = await scriptModel.generateContent(scriptPrompt);
    const dialogueScript = scriptResult.response.text();

    // 2. Render multi-speaker dialogue audio using Gemini TTS
    const ttsModel = getGenerativeModel(ai, {
      model: TTS_MODEL,
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          multiSpeakerVoiceConfig: {
            speakerVoiceConfigs: [
              {
                speaker: "Doctor",
                voiceConfig: { prebuiltVoiceConfig: { voiceName: "Charon" } },
              },
              {
                speaker: "Nurse",
                voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } },
              },
            ],
          },
        },
      } as any,
    });

    const audioResult = await ttsModel.generateContent(dialogueScript);
    const response = audioResult.response as any;
    const inlinePart =
      response.inlineDataParts?.()?.[0] ||
      response.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);

    if (inlinePart?.inlineData?.data) {
      const mimeType = inlinePart.inlineData.mimeType || "";
      const audioUrl =
        mimeType.includes("pcm") || mimeType.includes("L16")
          ? pcmBase64ToWavUrl(inlinePart.inlineData.data, 24000)
          : `data:${mimeType || "audio/wav"};base64,${inlinePart.inlineData.data}`;

      return { audioUrl, script: dialogueScript };
    }

    throw new Error("No audio data returned from TTS model.");
  } catch (error) {
    console.error("Multi-Speaker TTS Error:", error);
    throw new Error(
      "Failed to generate multi-speaker audio via Firebase AI Logic.",
    );
  }
}

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

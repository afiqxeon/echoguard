import { initializeApp } from "firebase/app";
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
} from "firebase/app-check";
import { getAI, getGenerativeModel, GoogleAIBackend } from "firebase/ai";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBCI4D1dcL4ecRrAbPOSSoTjat32bWk0-E",
  authDomain: "fbailogic26vrt-3027.firebaseapp.com",
  projectId: "fbailogic26vrt-3027",
  storageBucket: "fbailogic26vrt-3027.firebasestorage.app",
  messagingSenderId: "643208414044",
  appId: "1:643208414044:web:199a7b8ada7a75c5093799",
};

const app = initializeApp(firebaseConfig);

// Enable App Check Debug Token on localhost using a shared dev token if provided
if (import.meta.env.DEV) {
  (self as any).FIREBASE_APPCHECK_DEBUG_TOKEN =
    import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || true;
}

// Inisialisasi App Check dengan reCAPTCHA Enterprise Site Key
initializeAppCheck(app, {
  provider: new ReCaptchaEnterpriseProvider(
    "6LdQICsuAAAAAPn5_AFrn5EWq2ZuUYksFAeuvRpq",
  ),
  isTokenAutoRefreshEnabled: true,
});

// Inisialisasi Firebase AI Logic dengan Gemini Developer API
const ai = getAI(app, { backend: new GoogleAIBackend() });

export const IS_MOCK_MODE = false;

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
    const model = getGenerativeModel(ai, { model: "gemini-3.8-flash" });
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
    // 1. Susun skrip dialog singkat dari SOAP Note
    const scriptModel = getGenerativeModel(ai, { model: "gemini-3.8-flash" });
    const scriptPrompt = `Convert the Assessment and Plan from this SOAP note into a concise 2-line clinical handoff dialogue between Doctor and Nurse. Format strictly as:
Doctor: [sentence]
Nurse: [sentence]

SOAP Note:
${soapNote}`;

    const scriptResult = await scriptModel.generateContent(scriptPrompt);
    const dialogueScript = scriptResult.response.text();

    // 2. Render audio menggunakan model TTS Gemini
    const ttsModel = getGenerativeModel(ai, {
      model: "gemini-2.5-flash-preview-tts",
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
 * Membungkus data audio mentah PCM (base64) dengan header WAV 44-byte
 * agar dapat langsung diputar secara native oleh elemen HTML5 <audio> di browser.
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

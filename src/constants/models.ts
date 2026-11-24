export const CLOUD_MODELS = [
  {
    id: "gemini-3.8-flash",
    label: "Gemini 3.8 Flash (Balanced — Recommended)",
  },
  {
    id: "gemini-3.1-flash-lite",
    label: "Gemini 3.1 Flash-Lite (Fast / Low Latency)",
  },
  {
    id: "gemini-4-hydrogen",
    label: "Gemini 4 Hydrogen (Next-Gen General)",
  },
  {
    id: "gemini-4-argon",
    label: "Gemini 4 Argon (Next-Gen General)",
  },
  {
    id: "gemini-4-carbon",
    label: "Gemini 4 Carbon (Next-Gen General)",
  },
] as const;

export type CloudModelId = (typeof CLOUD_MODELS)[number]["id"];
export const DEFAULT_CLOUD_MODEL: CloudModelId = "gemini-3.8-flash";

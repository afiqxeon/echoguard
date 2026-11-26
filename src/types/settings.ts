export interface VoiceOption {
  id: string;
  label: string;
  tone: string;
}

export interface EchoGuardSettings {
  doctorVoice: string;
  nurseVoice: string;
  dictationLanguage: string;
  strictDeterministicPreFilter: boolean;
}

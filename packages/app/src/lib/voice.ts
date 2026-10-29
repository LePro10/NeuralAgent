/** Desktop voice (dictation, wake word); mirrors `apps/desktop/src-tauri/src/voice.rs`. */

export interface VoiceConfig {
  dictation: boolean;
  hotkey: string;
  wake_word: boolean;
  learned: string[];
}

export type VoiceActivity = "idle" | "listening" | "transcribing" | "awake" | "learning";

export interface VoiceModel {
  id: string;
  name: string;
  purpose: string;
  size: number;
  installed: boolean;
  progress?: number;
  error?: string;
}

export interface VoiceStatus {
  config: VoiceConfig;
  models: VoiceModel[];
  activity: VoiceActivity;
  last_text?: string;
  error?: string;
}

export interface VoiceApi {
  status: () => Promise<VoiceStatus>;
  set: (config: VoiceConfig) => Promise<void>;
  download: (id: string) => Promise<void>;
  /** Records "Hey Neural" once; resolves with what was learned. */
  learn: () => Promise<string>;
  onStatus: (cb: (s: VoiceStatus) => void) => () => void;
  /** Text spoken after "Hey Neural". */
  onCommand: (cb: (text: string) => void) => () => void;
}

/** Shortcuts that work as hold-to-talk on every desktop OS. */
export const HOTKEYS = [
  { value: "Alt+Space", mac: "⌥ Space", other: "Alt+Space" },
  { value: "CommandOrControl+Shift+Space", mac: "⌘⇧ Space", other: "Ctrl+Shift+Space" },
  { value: "F5", mac: "F5", other: "F5" },
] as const;

export const megabytes = (bytes: number) => `${Math.round(bytes / 1_000_000)} MB`;

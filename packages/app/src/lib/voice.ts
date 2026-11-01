/** Desktop voice (dictation, wake word); mirrors `apps/desktop/src-tauri/src/voice.rs`. */

export interface VoiceConfig {
  dictation: boolean;
  hotkey: string;
  wake_word: boolean;
  learned: string[];
  /** Lower other audio (music) while dictating, after "Hey Neural" and in calls. Absent on older hosts. */
  duck?: boolean;
  /** Down to this many percent of where it was. */
  duck_level?: number;
}

/** A player whose own volume may be lowered in calls (macOS: needs the user's OK once). */
export interface DuckApp {
  name: string;
  access: "allowed" | "denied" | "ask" | "closed";
}

/** Levels offered for "Lower other audio" (percent of where it was). */
export const DUCK_LEVELS = [10, 20, 35] as const;

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
  /** macOS, this computer only: Music/Spotify access for lowering them in calls; never asks. */
  duckApps?: () => Promise<DuckApp[]>;
  /** Shows the macOS prompt for the running players (the user pressed Allow). */
  allowDuckApps?: () => Promise<DuckApp[]>;
}

/** Shortcuts that work as hold-to-talk on every desktop OS. */
export const HOTKEYS = [
  { value: "Alt+Space", mac: "⌥ Space", other: "Alt+Space" },
  { value: "CommandOrControl+Shift+Space", mac: "⌘⇧ Space", other: "Ctrl+Shift+Space" },
  { value: "F5", mac: "F5", other: "F5" },
] as const;

export const megabytes = (bytes: number) => `${Math.round(bytes / 1_000_000)} MB`;

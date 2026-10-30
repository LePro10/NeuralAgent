import type { Connect } from "@neuralagent/protocol";
import type { ReactNode } from "react";
import type { VoiceApi } from "./voice";

/** What the shell around the shared app provides (Tauri window, browser/PWA, Android). */
export interface Platform {
  kind: "desktop" | "web" | "android";
  /** Device name shown to other clients. */
  clientName: string;
  connect: Connect;
  /** Native folder picker; absent on remote clients (they browse via the daemon). */
  pickFolder?: () => Promise<string | null>;
  openExternal: (url: string) => void;
  notify?: (title: string, body: string) => void;
  /** Window is focused (for notification decisions). */
  focused?: () => boolean;
  /** macOS draws traffic lights over the content at the top left. */
  trafficLights?: boolean;
  startDrag?: () => void;
  /** Agent counts for the menu bar / tray icon (desktop only). */
  /** `remote`: null when there is no approved account, else whether it is connected. */
  trayStatus?: (counts: { running: number; working: number; waiting: number; remote: boolean | null }) => void;
  /** "Disconnect remote" / "Reconnect remote" was picked in the tray menu. */
  onTrayRemote?: (cb: () => void) => () => void;
  /** Remote clients: their own account page (which computer, devices, sign out) in place of the desktop's Remote page. */
  account?: { label: string; render: () => ReactNode };
  /** A notification was tapped: show this agent. Requests may arrive before the state has loaded. */
  onOpenSession?: (cb: (sid: string) => void) => () => void;
  /** Phones: a call with Neural keeps the microphone on with the screen locked (Android). */
  call?: {
    /** The call has the microphone (true) or ended (false). */
    active: (on: boolean) => void;
    /** "Call Neural" was picked outside the page (quick tile, notification): start or end a call. */
    onDial: (cb: (start: boolean) => void) => () => void;
  };
  /** Local dictation and wake word (desktop only). */
  voice?: VoiceApi;
  /** App updates (desktop only). */
  updates?: UpdateApi;
}

export interface UpdateInfo {
  version: string;
  current: string;
  notes?: string | null;
}

export interface UpdateApi {
  /** This app's version and the running service's (older until agents are done after an update). */
  versions: () => Promise<{ app: string; service: string }>;
  /** null: up to date. */
  check: () => Promise<UpdateInfo | null>;
  /** Downloads, installs and restarts the app; agents keep running. */
  install: () => Promise<void>;
  onProgress: (cb: (p: { done: number; total: number | null }) => void) => () => void;
}

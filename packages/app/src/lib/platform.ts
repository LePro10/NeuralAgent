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
  /** Local dictation and wake word (desktop only). */
  voice?: VoiceApi;
}

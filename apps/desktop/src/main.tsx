import { App, DaemonProvider, type Platform } from "@neuralagent/app";
import "@neuralagent/app/styles.css";
import { DaemonClient, webSocketTransport } from "@neuralagent/protocol";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { openUrl } from "@tauri-apps/plugin-opener";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

if (import.meta.env.DEV) {
  const send = (level: string, args: unknown[]) =>
    void invoke("dev_log", { level, message: args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : typeof a === "string" ? a : JSON.stringify(a))).join(" ") }).catch(() => {});
  for (const level of ["error", "warn"] as const) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => (orig(...args), send(level, args));
  }
  window.addEventListener("error", (e) => send("error", [e.error ?? e.message]));
  window.addEventListener("unhandledrejection", (e) => send("error", [e.reason]));
}

const mac = navigator.userAgent.includes("Mac");
let focused = document.hasFocus();
window.addEventListener("focus", () => (focused = true));
window.addEventListener("blur", () => (focused = false));

let canNotify: Promise<boolean> | null = null;
const notifyAllowed = () =>
  (canNotify ??= isPermissionGranted().then(async (ok) => ok || (await requestPermission()) === "granted").catch(() => false));

const platform: Platform = {
  kind: "desktop",
  clientName: "Desktop",
  // Asks the shell every time: it restarts the daemon if it is gone and hands out the current port/token.
  connect: async () => {
    const { url } = await invoke<{ url: string; version: string }>("daemon_connect");
    return webSocketTransport(url);
  },
  pickFolder: async () => {
    const p = await open({ directory: true, multiple: false, title: "Choose a project folder" });
    return typeof p === "string" ? p : null;
  },
  openExternal: (url) => void openUrl(url),
  notify: (title, body) => void notifyAllowed().then((ok) => ok && sendNotification({ title, body })),
  focused: () => focused,
  trafficLights: mac,
  startDrag: () => void getCurrentWindow().startDragging(),
};

const client = new DaemonClient(platform.connect, { kind: "desktop", name: platform.clientName });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DaemonProvider client={client} platform={platform}>
      <App />
    </DaemonProvider>
  </StrictMode>,
);

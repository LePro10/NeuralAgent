import { App, DaemonProvider, type Platform, type UpdateInfo, type VoiceStatus } from "@neuralagent/app";
import "@neuralagent/app/styles.css";
import { DaemonClient, webSocketTransport } from "@neuralagent/protocol";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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

/** Version of the service we are connected to; after an app update it is the old one for a while. */
let serviceVersion = "";

const platform: Platform = {
  kind: "desktop",
  clientName: "Desktop",
  // Asks the shell every time: it restarts the daemon if it is gone and hands out the current port/token.
  connect: async () => {
    const { url, version } = await invoke<{ url: string; version: string }>("daemon_connect");
    serviceVersion = version;
    return webSocketTransport(url);
  },
  pickFolder: async () => {
    const p = await open({ directory: true, multiple: false, title: "Choose a project folder" });
    return typeof p === "string" ? p : null;
  },
  openExternal: (url) => void openUrl(url),
  notify: (title, body) => void notifyAllowed().then((ok) => ok && sendNotification({ title, body })),
  focused: () => focused,
  trayStatus: (counts) => void invoke("tray_update", counts).catch(() => {}),
  onTrayRemote: (cb) => subscribe<null>("tray-remote", cb),
  trafficLights: mac,
  startDrag: () => void getCurrentWindow().startDragging(),
  voice: {
    status: () => invoke<VoiceStatus>("voice_status"),
    set: (config) => invoke("voice_set", { config }),
    download: (id) => invoke("voice_download", { id }),
    learn: () => invoke<string>("voice_learn"),
    onStatus: (cb) => subscribe<VoiceStatus>("voice", cb),
    onCommand: (cb) => subscribe<string>("voice-command", cb),
  },
  updates: {
    versions: async () => ({ app: await getVersion(), service: serviceVersion }),
    check: () => invoke<UpdateInfo | null>("update_check"),
    install: () => invoke("update_install"),
    onProgress: (cb) => subscribe<{ done: number; total: number | null }>("update-progress", cb),
  },
};

/** `listen` resolves its unsubscribe later; hand back a plain function. */
function subscribe<T>(event: string, cb: (payload: T) => void): () => void {
  const off = listen<T>(event, (e) => cb(e.payload));
  return () => void off.then((f) => f());
}

const client = new DaemonClient(platform.connect, { kind: "desktop", name: platform.clientName });

// After an app update the old service keeps the agents running. Once none runs, switch to this
// version's service (the client reconnects by itself).
void getVersion().then((app) => {
  let upgrading = false;
  client.subscribe(() => {
    const st = client.state;
    if (upgrading || !st || !serviceVersion || serviceVersion === app) return;
    if (Object.values(st.sessions).some((s) => s.alive)) return;
    upgrading = true;
    invoke<string>("daemon_upgrade").then(
      (v) => {
        serviceVersion = v;
        upgrading = false;
      },
      (e) => console.error("service upgrade (not retried until the app restarts)", e),
    );
  });
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DaemonProvider client={client} platform={platform}>
      <App />
    </DaemonProvider>
  </StrictMode>,
);

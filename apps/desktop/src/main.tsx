import { App, DaemonProvider, type ChangelogEntry, type Platform, type ServiceSwitch, type UpdateInfo, type VoiceStatus } from "@neuralagent/app";
import "@neuralagent/app/styles.css";
import { DaemonClient, webSocketTransport } from "@neuralagent/protocol";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
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

/**
 * The service we are connected to. After an app update it is the old one for a while: the switch
 * waits until no session (agent or terminal) is alive, see the end of this file. Shown in the
 * sidebar foot, the update dialog and Settings → Updates (lib/updates.ts in @neuralagent/app).
 */
let serviceVersion = "";
let service: ServiceSwitch = { version: "", waiting: false, switching: false, error: null };
const serviceSubs = new Set<() => void>();
const setService = (p: Partial<ServiceSwitch>) => {
  service = { ...service, ...p };
  serviceSubs.forEach((f) => f());
};
let retryService = () => {};

const platform: Platform = {
  kind: "desktop",
  clientName: "Desktop",
  // Asks the shell every time: it restarts the daemon if it is gone and hands out the current port/token.
  connect: async () => {
    const { url, version } = await invoke<{ url: string; version: string }>("daemon_connect");
    serviceVersion = version;
    setService({ version });
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
  readClipboardImage: async () => {
    const b64 = await invoke<string | null>("clipboard_image");
    if (!b64) return null;
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new File([bytes], "screenshot.png", { type: "image/png" });
  },
  // Tauri swallows OS file drops; it hands over local paths (the host is this machine).
  onFileDrop: (cb) => {
    const off = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type !== "drop") return;
      const r = window.devicePixelRatio || 1;
      cb({ paths: e.payload.paths, x: e.payload.position.x / r, y: e.payload.position.y / r });
    });
    return () => void off.then((f) => f());
  },
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
    // The relay serves CHANGELOG.md as /changelog.json (web build); fetched here (CSP connect-src).
    changelog: async () => {
      const base = await invoke<string>("update_server");
      const res = await fetch(`${base}/changelog.json`, { cache: "no-cache" });
      if (!res.ok) throw new Error(`changelog: ${res.status}`);
      return ((await res.json()) as { versions: ChangelogEntry[] }).versions;
    },
    service: {
      get: () => service,
      subscribe: (cb) => (serviceSubs.add(cb), () => void serviceSubs.delete(cb)),
      retry: () => retryService(),
    },
  },
};

/** `listen` resolves its unsubscribe later; hand back a plain function. */
function subscribe<T>(event: string, cb: (payload: T) => void): () => void {
  const off = listen<T>(event, (e) => cb(e.payload));
  return () => void off.then((f) => f());
}

const client = new DaemonClient(platform.connect, { kind: "desktop", name: platform.clientName });

// After an app update the old service keeps the agents running. Once no session (agent or
// terminal) is alive, switch to this version's service (the client reconnects by itself). A failed
// switch is not retried by itself (it would loop); the UI shows the error with a Retry button.
void getVersion().then((app) => {
  let upgrading = false;
  let failed = false;
  const tryUpgrade = () => {
    const st = client.state;
    const behind = !!serviceVersion && serviceVersion !== app;
    const busy = !!st && Object.values(st.sessions).some((s) => s.alive);
    if (service.waiting !== (behind && busy)) setService({ waiting: behind && busy });
    if (upgrading || failed || !st || !behind || busy) return;
    upgrading = true;
    setService({ switching: true, error: null });
    invoke<string>("daemon_upgrade").then(
      (v) => {
        serviceVersion = v;
        upgrading = false;
        setService({ version: v, switching: false, waiting: false });
      },
      (e) => {
        console.error("service upgrade failed", e);
        upgrading = false;
        failed = true;
        setService({ switching: false, error: String(e) });
      },
    );
  };
  retryService = () => {
    failed = false;
    setService({ error: null });
    tryUpgrade();
  };
  client.subscribe(tryUpgrade);
});

// This app is the host's UI for remote devices (D42): the daemon forwards voice settings and
// "install the update" to it, and shows the voice and update progress we report to every client.
client.serveHost(async (op, args) => {
  switch (op) {
    case "voice.status":
      return invoke<VoiceStatus>("voice_status");
    case "voice.set":
      return invoke("voice_set", { config: args });
    case "voice.learn":
      return invoke<string>("voice_learn");
    case "update.versions":
      return { app: await getVersion(), service: serviceVersion };
    case "update.install":
      // Answers at once: the app restarts when done. Progress and failures go out as notices.
      void invoke("update_install").catch((e) => notice("update", { error: String(e) }));
      return { started: true };
    default:
      throw new Error(`unknown operation ${op}`);
  }
});
const notice = (topic: string, data: unknown) => void client.req({ m: "host_notice", p: { topic, data } }).catch(() => {});
void listen<VoiceStatus>("voice", (e) => notice("voice", e.payload));
void listen<{ done: number; total: number | null }>("update-progress", (e) => notice("update", e.payload));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DaemonProvider client={client} platform={platform}>
      <App />
    </DaemonProvider>
  </StrictMode>,
);

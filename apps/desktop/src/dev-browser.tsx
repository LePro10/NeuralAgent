// Dev only: the desktop UI in a plain browser (UI tests, debugging). Not part of the build.
// Open http://localhost:1420/dev.html#port=<port>&token=<token> (values from daemon.json).
// Fake updates for UI checks (lib/updates.ts), changelog from a web build at `changelog=<url>`:
//   &update=0.3.0[&app=0.2.1][&service=0.2.0][&serviceError=1]   desktop: app update available
//   &web=1[&update=0.3.0]                                          web remote: newer build deployed
//   &system=missing|granted[&os=macos|windows|linux]               fake Settings → System (permissions, autostart)
import { App, DaemonProvider, type ChangelogEntry, type Platform, type ServiceSwitch, type SystemStatus } from "@neuralagent/app";
import "@neuralagent/app/styles.css";
import { DaemonClient, webSocketTransport } from "@neuralagent/protocol";
import { createRoot } from "react-dom/client";

// The phone router rewrites the hash (`#/agents`, …): keep this tab's dev params for reloads, or a
// reload in phone size loses the daemon token ("No agents yet", then "not answering").
const DEV_PARAMS = "na.devParams";
const fromHash = new URLSearchParams(location.hash.slice(1));
if (fromHash.has("port")) sessionStorage.setItem(DEV_PARAMS, location.hash.slice(1));
const q = fromHash.has("port") ? fromHash : new URLSearchParams(sessionStorage.getItem(DEV_PARAMS) ?? "");
const platform: Platform = {
  kind: "desktop",
  clientName: "Browser (dev)",
  connect: () => webSocketTransport(`ws://127.0.0.1:${q.get("port")}/ws?token=${q.get("token")}`),
  openExternal: (url) => void window.open(url, "_blank"),
  focused: () => document.hasFocus(),
  // The real interface size is the native web view's zoom; here the setting and shortcuts only run
  // (screenshots emulate a size with a smaller viewport at a higher device pixel ratio).
  zoom: () => {},
};

const fakeChangelog = async (): Promise<ChangelogEntry[]> => {
  const url = q.get("changelog");
  if (!url) return [];
  return ((await (await fetch(url)).json()) as { versions: ChangelogEntry[] }).versions;
};
const app = q.get("app") ?? "0.2.1";
const target = q.get("update");
if (q.get("web")) {
  platform.kind = "web";
  platform.webUpdate = {
    current: { version: app, build: `${app}+dev` },
    deployed: async () => (target ? { version: target, build: `${target}+new` } : { version: app, build: `${app}+dev` }),
    changelog: fakeChangelog,
    reload: () => location.reload(),
  };
} else if (q.has("update") || q.has("service")) {
  const svc: ServiceSwitch = { version: q.get("service") ?? app, waiting: q.get("service") !== null, switching: false, error: q.get("serviceError") ? "could not stop the old service: timed out" : null };
  platform.updates = {
    versions: async () => ({ app, service: svc.version }),
    check: async () => (target ? { version: target, current: app, notes: null } : null),
    install: () => new Promise((_, fail) => setTimeout(() => fail(new Error("fake install")), 1500)),
    onProgress: () => () => {},
    changelog: fakeChangelog,
    service: { get: () => svc, subscribe: () => () => {}, retry: () => {} },
  };
}
if (q.get("system")) {
  // Granting happens a few seconds after "asking", so the guided setup can be watched going on.
  const all = q.get("system") === "granted";
  const st: SystemStatus = {
    os: q.get("os") ?? "macos",
    stale: false,
    autostart: { service: all ? "boot" : "off", window: false },
    permissions: [
      {
        id: "full_disk_access",
        title: "Full Disk Access",
        detail: "Agents can work in Documents, Desktop, Downloads and iCloud Drive without a dialog on the Mac.",
        state: all ? "granted" : "missing",
        remote: true,
        optional: false,
      },
      {
        id: "accessibility",
        title: "Accessibility",
        detail: "Dictation types the text for you.",
        state: all ? "granted" : "missing",
        remote: false,
        optional: false,
      },
      {
        id: "microphone",
        title: "Microphone",
        detail: "Dictation, wake word and calls.",
        state: "granted",
        remote: false,
        optional: false,
      },
      {
        id: "screen_recording",
        title: "Screen Recording",
        detail: "Only for agents that look at the screen.",
        state: "missing",
        remote: false,
        optional: true,
      },
    ],
  };
  const grant = (id: string) => setTimeout(() => (st.permissions = st.permissions.map((p) => (p.id === id ? { ...p, state: "granted" } : p))), 2500);
  platform.system = {
    status: async () => structuredClone(st),
    request: async (id) => void grant(id),
    open: async () => {},
    repair: async (id) => void grant(id),
    setAutostart: async (a) => ((st.autostart = a), structuredClone(st)),
  };
}
const client = new DaemonClient(platform.connect, {
  kind: "desktop",
  name: platform.clientName,
});
createRoot(document.getElementById("root")!).render(
  <DaemonProvider client={client} platform={platform}>
    <App />
  </DaemonProvider>,
);

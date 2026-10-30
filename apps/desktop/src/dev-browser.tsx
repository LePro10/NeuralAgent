// Dev only: the desktop UI in a plain browser (UI tests, debugging). Not part of the build.
// Open http://localhost:1420/dev.html#port=<port>&token=<token> (values from daemon.json).
// Fake updates for UI checks (lib/updates.ts), changelog from a web build at `changelog=<url>`:
//   &update=0.3.0[&app=0.2.1][&service=0.2.0][&serviceError=1]   desktop: app update available
//   &web=1[&update=0.3.0]                                          web remote: newer build deployed
import { App, DaemonProvider, type ChangelogEntry, type Platform, type ServiceSwitch } from "@neuralagent/app";
import "@neuralagent/app/styles.css";
import { DaemonClient, webSocketTransport } from "@neuralagent/protocol";
import { createRoot } from "react-dom/client";

const q = new URLSearchParams(location.hash.slice(1));
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
const client = new DaemonClient(platform.connect, { kind: "desktop", name: platform.clientName });
createRoot(document.getElementById("root")!).render(
  <DaemonProvider client={client} platform={platform}>
    <App />
  </DaemonProvider>,
);

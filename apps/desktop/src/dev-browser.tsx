// Dev only: the desktop UI in a plain browser (UI tests, debugging). Not part of the build.
// Open http://localhost:1420/dev.html#port=<port>&token=<token> (values from daemon.json).
import { App, DaemonProvider, type Platform } from "@neuralagent/app";
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
};
const client = new DaemonClient(platform.connect, { kind: "desktop", name: platform.clientName });
createRoot(document.getElementById("root")!).render(
  <DaemonProvider client={client} platform={platform}>
    <App />
  </DaemonProvider>,
);

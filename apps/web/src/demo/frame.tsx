// A demo frame: the real NeuralAgent app (desktop layout at >= 900 px, phone layout below) running
// against the fake daemon of a world. Loaded as /demo/?embed=1&view=desk|phone in an iframe (or on
// its own). Exposes `window.__naDemoFrame` (see api.ts).
import { App, DaemonProvider, useUi, type Platform } from "@neuralagent/app";
import { DaemonClient } from "@neuralagent/protocol";
import { detectPlatform } from "@neuralagent/ui";
import { createRoot } from "react-dom/client";
import { DEMO_VERSION, DESKTOP_PAGE, loadWorld, parseLook, parseScene, parseView, phoneHash, sceneChat, sceneRoute, type DemoFrame, type DemoLook, type DemoRoute, type DemoView, type DemoWorld } from "./api.ts";
// Not part of the app's public exports: the demo steers the router and the theme directly.
import { parseHash, phoneRouter } from "../../../../packages/app/src/lib/phoneRoute";
import { requestSettingsSection } from "../../../../packages/app/src/lib/settingsRoute";
import { useChanges } from "../../../../packages/app/src/lib/store";
import { useTheme } from "../../../../packages/app/src/lib/theme";

/** The shared world of the page that hosts this frame (same origin), if it made one. */
function hostWorld(): DemoWorld | undefined {
  try {
    return window.parent !== window ? window.parent.__naDemo : undefined;
  } catch {
    return undefined; // a cross-origin parent: this frame makes its own world
  }
}

function applyLook(look: DemoLook) {
  const t = useTheme.getState();
  if (look.appearance) t.setAppearance(look.appearance);
  if (look.scheme) t.setScheme(look.scheme);
  if (look.accent !== undefined) t.setAccent(look.accent);
}

/**
 * A frame inside another page never takes the keyboard on its own. The app focuses its composer and
 * terminal as soon as they mount; inside a landing page that would scroll the page to the demo and
 * trap Tab and the arrow keys in it. The first real touch, click or key press lets focus through.
 */
function holdFocus(): void {
  if (window.parent === window) return;
  const protos = [HTMLElement.prototype, SVGElement.prototype];
  const original = protos.map((p) => p.focus);
  protos.forEach((p) => {
    p.focus = function () {};
  });
  const release = () => {
    protos.forEach((p, i) => {
      p.focus = original[i]!;
    });
    for (const t of ["pointerdown", "keydown", "touchstart"]) window.removeEventListener(t, release, true);
  };
  for (const t of ["pointerdown", "keydown", "touchstart"]) window.addEventListener(t, release, { capture: true, passive: true });
}

/**
 * The terminals of the app draw with xterm's WebGL renderer: a context and a glyph atlas per pane, which is
 * 30 to 250 ms of main-thread work in one frame whenever a scene brings new panes (and a context budget the
 * browsers cap). Without a WebGL 2 context xterm falls back to its DOM renderer, which looks the same at
 * these sizes and starts for free. Only xterm asks for "webgl2": the Neural orb keeps its own "webgl" one.
 */
function lightTerminals(): void {
  const get = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
    if (type === "webgl2") return null;
    return (get as (...a: unknown[]) => unknown).call(this, type, ...rest);
  } as typeof get;
  // xterm's fallback is expected here, so its one line about it does not belong in a visitor's console.
  const warn = console.warn;
  console.warn = (...a: unknown[]) => {
    if (typeof a[0] === "string" && a[0].startsWith("WebGL renderer unavailable")) return;
    warn.apply(console, a);
  };
}

export async function bootFrame(q: URLSearchParams): Promise<void> {
  holdFocus();
  lightTerminals();
  const view: DemoView = parseView(q.get("view"));
  const scene = parseScene(q.get("scene")) ?? "grid";
  const seed = q.get("seed");
  const root = document.documentElement;
  root.dataset.demoView = view;
  if (view === "phone") root.dataset.os = "ios";
  else root.dataset.os ??= detectPlatform(navigator.userAgent, navigator.maxTouchPoints ?? 0);

  let resolveReady!: () => void;
  const ready = new Promise<void>((r) => (resolveReady = r));
  let frameWorld: DemoWorld | undefined;
  let client: DaemonClient | undefined;

  // The control surface exists before the world does, so a parent never races it.
  const resolveId = (kind: "agent" | "project", name: string) => frameWorld?.resolve(`${kind}.${name}`) ?? frameWorld?.resolve(name) ?? name;
  const navigate = (to: DemoRoute) => {
    void ready.then(() => go(to));
  };
  const go = (to: DemoRoute) => {
    if (!frameWorld) return;
    if (view === "phone") {
      const nav = parseHash(phoneHash(to, resolveId));
      if (nav) phoneRouter().go(nav);
      return;
    }
    const ui = useUi.getState();
    useChanges.getState().close();
    if (typeof to === "string") {
      if (to === "projects") ui.setWorkspace(client?.state?.workspaces[0]?.id ?? null);
      else ui.setWorkspace(DESKTOP_PAGE[to] ?? null);
    } else if ("project" in to) {
      ui.setWorkspace(resolveId("project", to.project));
    } else if ("agent" in to) {
      const sid = resolveId("agent", to.agent);
      const ws = client?.state?.sessions[sid]?.workspace_id;
      if (ws) ui.setWorkspace(ws);
      frameWorld.focus(sid);
    } else if ("settings" in to) {
      ui.setWorkspace(DESKTOP_PAGE.settings!);
      requestSettingsSection(to.settings);
    } else {
      // Desktop: the project, with its changes (files, git, diff) open over it.
      const ws = resolveId("project", to.files);
      ui.setWorkspace(ws);
      useChanges.getState().show(ws);
    }
  };

  const api = {
    view,
    ready,
    navigate,
    setLook: (look: DemoLook) => applyLook(look),
    get world() {
      return frameWorld!;
    },
  } satisfies DemoFrame;
  window.__naDemoFrame = api;

  const world = hostWorld() ?? (window.__naDemo ??= await loadWorld({ scene, ...(seed ? { seed: /^\d+$/.test(seed) ? Number(seed) : seed } : {}) }));
  frameWorld = world;

  // Where this scene starts the layout. The phone router reads its first page from the URL hash, which
  // is fine for the tab roots and one agent, but pages like Files read the daemon state while
  // it is still empty and loop; those are opened with the router once the first state is in.
  const start = sceneRoute(scene, view);
  const early = view === "phone" && (typeof start === "string" ? ["agents", "neural", "projects", "settings"].includes(start) : "agent" in start);
  if (early && !location.hash) history.replaceState(null, "", phoneHash(start, resolveId));

  // Desktop: Claude panes as chat where the scene shows a card (`chat=1|0` in the URL decides otherwise).
  const chatParam = q.get("chat");
  const setChat = (sc: typeof scene) => useUi.getState().setClaudeView(chatParam ? chatParam === "1" : sceneChat(sc));
  if (view === "desk") setChat(scene);

  client = new DaemonClient(() => world.connect(view), { kind: view === "desk" ? "desktop" : "web", name: view === "desk" ? "MacBook Air" : "iPhone" });
  const c = client;
  // First state from the daemon: the launch screen lifts, the frame is ready.
  const off = c.subscribe(() => {
    if (!c.state) return;
    off();
    if (view === "desk" || !early) go(start);
    resolveReady();
  });
  if (c.state) resolveReady();

  // `world.play(scene)` moves this frame too: the new snapshot arrives, then the scene's start page opens.
  world.on((sig) => {
    if (sig.type !== "scene-ready") return;
    if (view === "desk") setChat(sig.scene);
    const again = () => go(sceneRoute(sig.scene, view));
    if (c.state) again();
    else void ready.then(again);
  });

  const traffic = view === "desk" && q.get("traffic") !== "0";
  // Settings > Updates / About read the version from the platform. The demo is always "current":
  // there is nothing to install, and it says so instead of printing an empty "Version".
  const notes = async () => [
    {
      version: DEMO_VERSION,
      date: null,
      summary: "The version this demo plays.",
      groups: [{ title: "In this demo", items: ["Everything runs in your browser. Nothing is installed, saved or sent anywhere."] }],
    },
  ];
  const update: Pick<Platform, "updates" | "webUpdate"> =
    view === "desk"
      ? {
          updates: {
            versions: async () => ({ app: DEMO_VERSION, service: DEMO_VERSION }),
            check: () => new Promise((r) => setTimeout(() => r(null), 700)),
            install: async () => {},
            onProgress: () => () => {},
            changelog: notes,
          },
        }
      : { webUpdate: { current: { version: DEMO_VERSION, build: "demo" }, deployed: async () => ({ version: DEMO_VERSION, build: "demo" }), changelog: notes, reload: () => {} } };
  const platform: Platform = {
    ...update,
    kind: view === "desk" ? "desktop" : "web",
    clientName: view === "desk" ? "MacBook Air" : "iPhone",
    connect: () => world.connect(view),
    openExternal: (url) => void window.open(url, "_blank"),
    focused: () => document.hasFocus(),
    trafficLights: traffic,
  };

  createRoot(document.getElementById("root")!).render(
    <DaemonProvider client={c} platform={platform}>
      <App />
      {traffic && (
        <div className="demo-lights" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      )}
    </DaemonProvider>,
  );

  // The look is applied after the app has read the (seeded) theme store.
  applyLook(parseLook(q));
  window.addEventListener("pagehide", () => c.close());
}

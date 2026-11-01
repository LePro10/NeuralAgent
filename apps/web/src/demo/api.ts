// The control API of the live demo: what the landing page (and anything else on the site) can say
// to the demo, and what the demo says back. Types and tiny pure helpers only: this file must never
// import the fake daemon or the app, so the landing can use it without loading either.
//
//   Top page (landing)                         Frame (/demo/?embed=1&view=desk|phone)
//   ──────────────────                         ──────────────────────────────────────
//   window.__naDemo : DemoWorld   ◄── parent.__naDemo ──  uses it when present, else makes its own
//   frame.contentWindow.__naDemoFrame : DemoFrame   ──►   navigate / setLook / ready
//
// Typical use from the landing:
//
//   import { loadWorld } from "../demo/api";
//   const world = (window.__naDemo ??= await loadWorld());   // lazy: pulls the daemon chunk
//   world.play("permission");                                // drive the story
//   world.on((s) => s.type === "prompt-answered" && console.log("answered on", s.by));
//   const frame = iframe.contentWindow!.__naDemoFrame!;      // after iframe load
//   await frame.ready;
//   frame.navigate("neural");
//   frame.setLook({ appearance: "light", scheme: "forest" });

import type { Transport } from "@neuralagent/protocol";

// ── scenes and signals ───────────────────────────────────────────────────────────────────────

/** A named state of the whole simulated computer, ready to look at. */
export type DemoScene =
  /** Four agents side by side in billing-api, all busy. The hero. */
  | "grid"
  /** Claude is mid-turn and is about to ask "Allow `pnpm test`?" (the first answer, from any device, continues it). */
  | "permission"
  /** `permission`, seen from the phone: the Agents inbox says "needs you". */
  | "phone"
  /** Neural has a conversation and a question waiting for you. */
  | "neural"
  /** A race between three agents on one goal, ending at "Pick one". */
  | "team"
  /** Files, git changes and the diff of what an agent edited. */
  | "files"
  /** The overview: every agent of every project, one needing you, some working, some done. */
  | "agents"
  /** Everything calm: nobody working, nobody waiting. */
  | "idle";

export const SCENES: readonly DemoScene[] = ["grid", "permission", "phone", "neural", "team", "files", "agents", "idle"];

/** The version the simulated computer and its app report (the site ships with this release). */
export const DEMO_VERSION = "0.4.0";

export type DemoView = "desk" | "phone";

/** Who did something: the two frames, or a script of the world itself. */
export type DemoActor = "desk" | "phone" | "world";

/** Something that happened in the world. Listen with `world.on`. */
export type DemoSignal =
  | { type: "ready" }
  | { type: "reset" }
  /** A scene was built (frames get their snapshot next). */
  | { type: "scene"; scene: DemoScene }
  /** The scene is on screen: built, snapshot sent, ready to be looked at (and screenshotted). */
  | { type: "scene-ready"; scene: DemoScene }
  | { type: "client"; view: DemoView; connected: boolean }
  | { type: "agent-status"; agent: string; name: string; status: string }
  | { type: "prompt-opened"; agent: string; name: string; tool: string; command: string }
  /** `by`: the device that answered. */
  | { type: "prompt-answered"; agent: string; allow: boolean; by: DemoActor }
  | { type: "neural-message"; role: string; text: string }
  | { type: "team-picked"; task: string; winner: string }
  | { type: "agent-started"; agent: string; name: string }
  /** A team moved on: a hand-off, a verdict, a check result. */
  | { type: "team-step"; task: string; step: string };

// ── the world ────────────────────────────────────────────────────────────────────────────────

/** The computer at a glance (`DemoWorld.summary`). */
export interface DemoSummary {
  host: string;
  agents: number;
  working: number;
  waiting: number;
}

/** The simulated computer plus its daemon. One per page group; desk and phone frames share it. */
export interface DemoWorld {
  /** A new connection for one app instance. `view` decides what the daemon thinks the client is. */
  connect(view?: DemoView): Promise<Transport>;
  /** Put the world into a scene (resets first, then plays). */
  play(scene: DemoScene): void;
  /** Back to the seeded start. Connected apps get a fresh snapshot, ids stay the same. */
  reset(): void;
  /** Subscribe to signals. Returns the unsubscribe function. */
  on(cb: (s: DemoSignal) => void): () => void;
  /**
   * Ids by role, stable for a seed: `agent.claude-billing`, `agent.codex-billing`, `project.billing-api`, …
   * `DemoFrame.navigate({ agent: "claude-billing" })` accepts these names or raw ids.
   */
  readonly handles: Readonly<Record<string, string>>;
  /** Pause, speed up or skip the simulated time (agents stop typing while paused). */
  readonly clock: { pause(): void; resume(): void; setSpeed(x: number): void; readonly paused: boolean; readonly speed: number; advance(ms: number): Promise<void> };
  /** Make `agent` the focused pane of its project (desktop layout). */
  focus(agent: string): void;
  /** Resolve a handle ("claude-billing") or an id to a session id; null when unknown. */
  resolve(name: string): string | null;
  /** What the computer is doing right now, for a status line: how many agents work, how many wait for the visitor. */
  summary(): DemoSummary;
  /** Type `text` as the visitor would: to Neural (the default) or to one agent (handle or id). False when nobody can take it. */
  tell(text: string, to?: string): boolean;
  /** Stop everything (timers, connections). The page is going away. */
  dispose(): void;
}

/** Ask the world for its own seed, if wanted: `?seed=7` on the demo page. */
export interface WorldOptions {
  seed?: number | string;
  /** Delay of every protocol message, ms. Default 6. 0 in tests. */
  latency?: number;
  /** Virtual start time; default Date.now(). Pair with a frozen browser clock for identical posters. */
  now?: number;
  /** The scene to start in. Default "grid". */
  scene?: DemoScene;
  /** `false`: time only moves with `clock.advance` (tests). Default true. */
  auto?: boolean;
}

/** Lazy factory: the daemon (and the whole fake world) is its own chunk, loaded on first use. */
export const loadWorld = (opts?: WorldOptions): Promise<DemoWorld> => import("./daemon").then((m) => m.createWorld(opts));

// ── the frame ────────────────────────────────────────────────────────────────────────────────

export type SettingsSection =
  | "appearance"
  | "notifications"
  | "remote"
  | "updates"
  | "neural"
  | "voice"
  | "calls"
  | "agents"
  | "profiles"
  | "mcp"
  | "workspaces"
  | "discord"
  | "advanced"
  | "about"
  | "system";

/** Where a frame can be sent. Strings are the top-level pages of both layouts. */
export type DemoRoute =
  | "agents"
  | "neural"
  | "teams"
  | "projects"
  | "history"
  | "usage"
  | "settings"
  /** Desktop: the first project; phone: the Projects tab. */
  | { agent: string }
  | { project: string }
  | { settings: SettingsSection }
  /** The files and changes of a project (`files` is a name, handle or id): the Files page on the phone, the changes sheet on desktop. */
  | { files: string; path?: string }
  /** The detail page of a team (a Neural task id, or a swarm id). */
  | { team: string };

export type DemoAppearance = "dark" | "light";
export type DemoScheme = "night" | "graphite" | "midnight" | "black" | "dusk" | "forest";
export type DemoAccent = "ice" | "mint" | "ember" | "lilac" | "sand" | "graphite";

export interface DemoLook {
  appearance?: DemoAppearance;
  scheme?: DemoScheme;
  /** `null`: the scheme's own accent. */
  accent?: DemoAccent | null;
}

/** `window.__naDemoFrame` inside each demo frame. */
export interface DemoFrame {
  readonly view: DemoView;
  /** Resolves when the app has its first state from the daemon (the launch screen is lifting). */
  readonly ready: Promise<void>;
  /** The page of this frame's layout that fits `to`: desktop sidebar page or phone route. */
  navigate(to: DemoRoute): void;
  setLook(look: DemoLook): void;
  /** The world this frame talks to (shared with the parent page when it hosts one). */
  readonly world: DemoWorld;
}

declare global {
  interface Window {
    __naDemo?: DemoWorld;
    __naDemoFrame?: DemoFrame;
  }
}

// ── pure helpers ─────────────────────────────────────────────────────────────────────────────

/** Where each scene starts the two layouts. The landing may use it to pre-position a frame. */
export function sceneRoute(scene: DemoScene, view: DemoView): DemoRoute {
  switch (scene) {
    case "grid":
    case "permission":
      return view === "desk" ? (scene === "permission" ? { agent: "claude-billing" } : { project: "billing-api" }) : { agent: "claude-billing" };
    case "phone":
      return view === "desk" ? { project: "billing-api" } : "agents";
    case "neural":
      return "neural";
    case "team":
      return "teams";
    case "files":
      return { files: "billing-api" };
    case "agents":
      return "agents";
    case "idle":
      return view === "desk" ? { project: "billing-api" } : "agents";
  }
}

/** Whether the desktop layout shows Claude panes as Chat (the cards: Allow, diffs, todos) rather than the terminal. */
export const sceneChat = (scene: DemoScene): boolean => scene === "permission" || scene === "phone" || scene === "files";

const enc = encodeURIComponent;

/** The phone router's hash for a route (`resolve` maps handles and names to ids). */
export function phoneHash(to: DemoRoute, resolve: (kind: "agent" | "project" | "team", name: string) => string): string {
  if (typeof to === "string") {
    switch (to) {
      case "agents":
      case "neural":
      case "projects":
      case "settings":
      case "history":
      case "usage":
        return `#/${to}`;
      case "teams":
        return "#/swarms";
    }
  }
  if ("agent" in to) return `#/agent/${enc(resolve("agent", to.agent))}`;
  if ("project" in to) return `#/project/${enc(resolve("project", to.project))}`;
  if ("settings" in to) return `#/settings/${to.settings}`;
  if ("files" in to) {
    const ws = resolve("project", to.files);
    return to.path ? `#/files/${enc(ws)}/${to.path.split("/").map(enc).join("/")}` : `#/files/${enc(ws)}`;
  }
  return `#/swarm/${enc(resolve("team", to.team))}`;
}

/** The desktop sidebar page ids (`useUi().workspace`) of the string routes. */
export const DESKTOP_PAGE: Readonly<Record<string, string>> = {
  agents: "__agents",
  neural: "__neural",
  teams: "__swarm",
  history: "__history",
  usage: "__usage",
  settings: "__settings",
};

/** Parse `view` from a query string value; anything unknown is "desk". */
export const parseView = (v: string | null | undefined): DemoView => (v === "phone" ? "phone" : "desk");

/** Parse `scene`; unknown values give null. */
export const parseScene = (v: string | null | undefined): DemoScene | null => (SCENES as readonly string[]).includes(v ?? "") ? (v as DemoScene) : null;

const APPEARANCES: readonly string[] = ["dark", "light"];
const SCHEMES: readonly string[] = ["night", "graphite", "midnight", "black", "dusk", "forest"];
const ACCENTS: readonly string[] = ["ice", "mint", "ember", "lilac", "sand", "graphite"];

/**
 * The look of a demo URL: `look=light.forest.mint` (appearance.scheme.accent, `_` skips one) or the
 * separate `appearance=`, `scheme=`, `accent=` (they win). Unknown values are ignored.
 */
export function parseLook(q: URLSearchParams): DemoLook {
  const [a, s, c] = (q.get("look") ?? "").split(".");
  const pick = <T extends string>(v: string | null | undefined, ok: readonly string[]): T | undefined => (v && ok.includes(v) ? (v as T) : undefined);
  const accent = q.get("accent") ?? c;
  const look: DemoLook = {};
  const appearance = pick<DemoAppearance>(q.get("appearance") ?? a, APPEARANCES);
  const scheme = pick<DemoScheme>(q.get("scheme") ?? s, SCHEMES);
  if (appearance) look.appearance = appearance;
  if (scheme) look.scheme = scheme;
  if (accent === "scheme") look.accent = null;
  else {
    const ac = pick<DemoAccent>(accent, ACCENTS);
    if (ac) look.accent = ac;
  }
  return look;
}

// The simulated computer: one object that holds the protocol state, the virtual clock, the disk and
// every subsystem (terminals, Claude views, agent runs, Neural). Handlers and scripts talk to this.

import { apply } from "@neuralagent/protocol";
import type { AgentStatus, Event, Session, State, Workspace, WorkspaceLayout, LayoutNode, AuditEntry, ClientKind, ModelInfo } from "@neuralagent/protocol";
import { DEMO_VERSION, type DemoActor, type DemoSignal, type DemoView } from "../api.ts";
import { makeScope, type Clock, type Scope } from "./clock.ts";
import type { Rng } from "./rng.ts";
import { Vfs, basename, join } from "./vfs.ts";
import type { Conn } from "./server.ts";
import type { Term } from "./term.ts";
import type { CvSession } from "./claude/cv.ts";
import type { Run } from "./agents/run.ts";
import type { Neural } from "./neural.ts";
import type { Shell } from "./shell.ts";

export const HOST = { host_id: "demo-studio-0001", name: "Studio", os: "macos", home: "/Users/demo" };
export const DAEMON_VERSION = DEMO_VERSION;
export const FEATURES = ["call_warm", "files", "neural", "host_system", "cv_stop_task", "autopilot"];

export type Listener = (s: DemoSignal) => void;

export class Sim {
  readonly clock: Clock;
  readonly rng: Rng;
  readonly latency: number;
  vfs: Vfs;
  state!: State;
  seq = 1000;
  scope: Scope = makeScope();
  conns = new Set<Conn>();
  listeners = new Set<Listener>();
  terms = new Map<string, Term>();
  cvs = new Map<string, CvSession>();
  runs = new Map<string, Run>();
  shells = new Map<string, Shell>();
  neural!: Neural;
  handles: Record<string, string> = {};
  /** Names of events the scripts announced ("before-ask"…), for scenes that wait for them. */
  marks = new Set<string>();
  /** Virtual ms Claude spends "pondering" before its first question (the grid scene: the question belongs to the next chapter). */
  holdAsk = 0;
  /** Voice models of Settings → Voice (downloads are simulated); null = untouched. */
  models: ModelInfo[] | null = null;
  /** Settings → System: "Restart service" counts and moves the start time, so the page shows it happened. */
  restarts = 0;
  restartedAt = 0;
  /** Per-session count, so ids of things made later (sessions, tasks) stay deterministic. */
  private counters = new Map<string, number>();
  private ids = new Set<string>();
  audit: AuditEntry[] = [];
  /** What the busy time of sessions currently in `working` started at. */
  private workFrom = new Map<string, number>();
  /** True while a world is being built: state changes apply but nobody is told (a snapshot follows). */
  building = false;
  /** The visitor is looking: pre-roll is over, the director may start things. */
  live = false;

  constructor(clock: Clock, rng: Rng, latency: number) {
    this.clock = clock;
    this.rng = rng;
    this.latency = latency;
    this.vfs = new Vfs(() => clock.now());
  }

  now() {
    return this.clock.now();
  }

  /** A fresh deterministic id of `n` hex digits (default 12, like the daemon's). */
  id(label: string, n = 12): string {
    const c = (this.counters.get(label) ?? 0) + 1;
    this.counters.set(label, c);
    // Seeds are 32 bits: two labels can land on one id. Ids stay unique (the UI keys by them).
    let id = this.rng.fork(`${label}#${c}`).hex(n);
    for (let k = 1; this.ids.has(id); k++) id = this.rng.fork(`${label}#${c}:${k}`).hex(n);
    this.ids.add(id);
    return id;
  }

  // ── events ─────────────────────────────────────────────────────────────────────────────────

  signal(s: DemoSignal) {
    for (const l of [...this.listeners]) {
      try {
        l(s);
      } catch {
        /* a listener must not break the world */
      }
    }
  }

  /** Change the state and tell every subscribed connection, with the next sequence number. */
  emit(ev: Event) {
    this.seq++;
    this.state = apply(this.state, ev);
    if (this.building) return;
    for (const c of this.conns) c.sendEv(this.seq, ev);
  }

  /**
   * Throw the old world away: every timer, run, terminal and file. Connections stay; the caller
   * builds the next world and then sends a snapshot to each. `seq` keeps counting up.
   */
  reset(start: number) {
    this.scope.cancel();
    this.scope = makeScope();
    this.clock.rebase(start);
    this.vfs = new Vfs(() => this.clock.now());
    this.terms.clear();
    this.cvs.clear();
    this.runs.clear();
    this.shells.clear();
    this.marks.clear();
    this.holdAsk = 0;
    this.models = null;
    this.restarts = 0;
    this.restartedAt = 0;
    this.counters.clear();
    this.ids.clear();
    this.workFrom.clear();
    this.audit = [];
    this.handles = {};
    this.live = false;
    this.building = true;
  }

  /** Neural's own state travels as a host notice. */
  emitNeural() {
    this.emit({ e: "host_notice", topic: "neural", data: this.state.neural });
  }

  mark(name: string) {
    this.marks.add(name);
  }

  // ── sessions ───────────────────────────────────────────────────────────────────────────────

  session(id: string): Session | undefined {
    return this.state.sessions[id];
  }

  profileOf(id: string) {
    const s = this.session(id);
    return s ? this.state.profiles.find((p) => p.id === s.profile_id) : undefined;
  }

  engineOf(id: string): string {
    return this.profileOf(id)?.engine ?? "shell";
  }

  workspaceOf(id: string): Workspace | undefined {
    const s = this.session(id);
    return s ? this.state.workspaces.find((w) => w.id === s.workspace_id) : undefined;
  }

  /** Update a session; tracks working time, status changes, attention and signals. */
  patch(id: string, p: Partial<Session>, attention?: string) {
    const old = this.state.sessions[id];
    if (!old) return;
    const now = this.now();
    const next: Session = { ...old, ...p };
    if (p.status && p.status !== old.status) {
      next.status_since = now;
      if (old.status === "working") {
        const from = this.workFrom.get(id) ?? old.status_since;
        next.busy_ms = old.busy_ms + Math.max(0, now - from);
        this.workFrom.delete(id);
      }
      if (p.status === "working") this.workFrom.set(id, now);
    }
    this.emit({ e: "session_upsert", session: next });
    if (p.status && p.status !== old.status) {
      this.signal({ type: "agent-status", agent: id, name: next.title, status: next.status });
      this.neural?.sessionChanged(old, next);
      if (attention !== undefined && (p.status === "done" || p.status === "waiting" || p.status === "error")) {
        this.emit({ e: "attention", session_id: id, kind: p.status, text: attention });
      }
    } else if (p.last_line && p.last_line !== old.last_line && next.status === "working") this.neural?.lineChanged(next);
  }

  setStatus(id: string, status: AgentStatus, attention?: string, extra: Partial<Session> = {}) {
    this.patch(id, { ...extra, status }, attention ?? "");
  }

  /** Busy time including the current working stretch. */
  busyNow(id: string): number {
    const s = this.session(id);
    if (!s) return 0;
    return s.busy_ms + (s.status === "working" ? this.now() - (this.workFrom.get(id) ?? s.status_since) : 0);
  }

  // ── workspaces and layouts ─────────────────────────────────────────────────────────────────

  /** Recompute the git summary of a workspace from the disk and publish it when it changed. */
  refreshGit(workspaceId: string) {
    const w = this.state.workspaces.find((x) => x.id === workspaceId);
    if (!w) return;
    const repo = this.vfs.repoOf(w.path);
    if (!repo) {
      if (w.git) this.emit({ e: "workspace_upsert", workspace: { ...w, git: undefined } });
      return;
    }
    const changed = this.vfs.status(repo).length;
    const g = w.git;
    if (g && g.branch === repo.branch && g.changed === changed && g.ahead === repo.ahead && g.behind === repo.behind) return;
    this.emit({ e: "workspace_upsert", workspace: { ...w, git: { branch: repo.branch, changed, ahead: repo.ahead, behind: repo.behind } } });
  }

  refreshAllGit() {
    for (const w of this.state.workspaces) this.refreshGit(w.id);
  }

  layoutOf(workspaceId: string): WorkspaceLayout {
    return this.state.layouts[workspaceId] ?? { tabs: [], active_tab: "" };
  }

  /** Put a session into an empty pane of the active tab, or split the focused pane when none is empty. */
  placeSession(workspaceId: string, sid: string, paneId?: string): void {
    let lay = this.layoutOf(workspaceId);
    if (!lay.tabs.length) {
      const pid = this.id("pane");
      lay = { tabs: [{ id: this.id("tab"), title: "Main", root: { type: "pane", id: pid, content: { kind: "terminal", session: sid } }, focused: pid }], active_tab: "" };
      lay.active_tab = lay.tabs[0]!.id;
      this.emit({ e: "layout_set", workspace_id: workspaceId, layout: lay });
      return;
    }
    const tab = lay.tabs.find((t) => t.id === lay.active_tab) ?? lay.tabs[0]!;
    const hit = (n: LayoutNode): string | null => {
      if (n.type === "pane") return (paneId ? n.id === paneId : n.content.kind === "empty") ? n.id : null;
      for (const c of n.children) {
        const r = hit(c);
        if (r) return r;
      }
      return null;
    };
    const target = hit(tab.root);
    let root: LayoutNode;
    let focused: string;
    if (target) {
      const put = (n: LayoutNode): LayoutNode => (n.type === "pane" ? (n.id === target ? { ...n, content: { kind: "terminal", session: sid } } : n) : { ...n, children: n.children.map(put) });
      root = put(tab.root);
      focused = target;
    } else {
      const np = this.id("pane");
      const fp = tab.focused;
      const split = (n: LayoutNode): LayoutNode =>
        n.type === "pane"
          ? n.id === fp
            ? { type: "split", id: this.id("split"), dir: "row", sizes: [0.5, 0.5], children: [n, { type: "pane", id: np, content: { kind: "terminal", session: sid } }] }
            : n
          : { ...n, children: n.children.map(split) };
      root = split(tab.root);
      focused = np;
    }
    const tabs = lay.tabs.map((t) => (t.id === tab.id ? { ...t, root, focused } : t));
    this.emit({ e: "layout_set", workspace_id: workspaceId, layout: { ...lay, tabs } });
  }

  /** Remove a session's pane (turning it empty) from every layout. */
  unplaceSession(sid: string) {
    for (const [wid, lay] of Object.entries(this.state.layouts)) {
      let touched = false;
      const clear = (n: LayoutNode): LayoutNode => {
        if (n.type === "pane") {
          if (n.content.kind === "terminal" && n.content.session === sid) {
            touched = true;
            return { ...n, content: { kind: "empty" } };
          }
          return n;
        }
        return { ...n, children: n.children.map(clear) };
      };
      const tabs = lay.tabs.map((t) => ({ ...t, root: clear(t.root) }));
      if (touched) this.emit({ e: "layout_set", workspace_id: wid, layout: { ...lay, tabs } });
    }
  }

  // ── audit and clients ──────────────────────────────────────────────────────────────────────

  record(kind: ClientKind, device: string, action: string, target?: string, ok = true, error?: string) {
    this.audit.unshift({ at: this.now(), client: kind, device, action, ...(target ? { target } : {}), ok, ...(error ? { error } : {}) });
    if (this.audit.length > 200) this.audit.length = 200;
  }

  /** Who a connection is, for signals: the frame it belongs to. */
  actorOf(view: DemoView | undefined): DemoActor {
    return view === "phone" ? "phone" : view === "desk" ? "desk" : "world";
  }

  folderName(path: string) {
    return basename(path);
  }

  pathIn(ws: Workspace, rel: string) {
    return join(ws.path, rel);
  }
}

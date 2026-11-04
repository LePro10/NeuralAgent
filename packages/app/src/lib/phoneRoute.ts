// Phone navigation: four tabs (Agents, Neural, Projects, Settings), a stack of pages per tab, all
// mirrored into the browser history. That is what makes Android back, browser back and deep links
// (`#/agent/<sid>`) work, and it never touches the computer's desktop layout (no `layout_set`).
//
// The history always looks like this, so "back" is predictable:
//   [Agents root] (+ [other tab's root]) + one entry per page pushed in the current tab.
// Back from a page pops it; back from another tab's root goes to Agents; back on the Agents root
// leaves (Android: minimises). Overlays (`useLayer` in @neuralagent/ui) push their own entries on
// top and copy the route along, so closing a sheet with back never changes the page.
import { create } from "zustand";

export type Tab = "agents" | "neural" | "projects" | "settings";
export const TABS: Tab[] = ["agents", "neural", "projects", "settings"];
/** The tab the history starts from; back on its root leaves the app. */
export const HOME: Tab = "agents";

export type Route =
  | { k: "agent"; sid: string }
  | { k: "project"; id: string }
  /** Autopilot (D87): the pilot page, the connectors grid and one connector. */
  | { k: "autopilot" }
  | { k: "connectors" }
  | { k: "connector"; id: string }
  | { k: "history"; project?: string }
  | { k: "usage" }
  | { k: "section"; id: string; detail?: string }
  /** Files (D68): a folder of a project (`path` absent: the project folder) and one file. */
  | { k: "files"; ws: string; path?: string }
  | { k: "file"; ws: string; path: string };

/** Where you are: a tab and the pages pushed in it (empty = the tab's root). */
export interface Nav {
  tab: Tab;
  stack: Route[];
}

const enc = encodeURIComponent;
const dec = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** A stable id for a route (page keys, comparisons). */
export function routeKey(r: Route): string {
  switch (r.k) {
    case "agent":
      return `agent:${r.sid}`;
    case "project":
      return `project:${r.id}`;
    case "connector":
      return `connector:${r.id}`;
    case "history":
      return r.project ? `history:${r.project}` : "history";
    case "section":
      return r.detail ? `section:${r.id}:${r.detail}` : `section:${r.id}`;
    case "files":
      return r.path ? `files:${r.ws}:${r.path}` : `files:${r.ws}`;
    case "file":
      return `file:${r.ws}:${r.path}`;
    default:
      return r.k;
  }
}

export const navKey = (n: Nav) => [n.tab, ...n.stack.map(routeKey)].join("/");
export const sameNav = (a: Nav, b: Nav) => navKey(a) === navKey(b);

/** The URL hash of a place: its top page, or the tab. */
export function hashOf(n: Nav): string {
  const r = n.stack.at(-1);
  if (!r) return `#/${n.tab}`;
  switch (r.k) {
    case "agent":
      return `#/agent/${enc(r.sid)}`;
    case "project":
      return `#/project/${enc(r.id)}`;
    case "autopilot":
      return "#/autopilot";
    case "connectors":
      return "#/connectors";
    case "connector":
      return `#/connector/${enc(r.id)}`;
    case "history":
      return r.project ? `#/history/${enc(r.project)}` : "#/history";
    case "usage":
      return "#/usage";
    case "section":
      return `#/settings/${enc(r.id)}${r.detail ? `/${enc(r.detail)}` : ""}`;
    case "files":
      return `#/files/${enc(r.ws)}${r.path ? `/${enc(r.path)}` : ""}`;
    case "file":
      return `#/file/${enc(r.ws)}/${enc(r.path)}`;
  }
}

/** A link (`#/agent/abc`) → where it leads, with the tab it belongs to. Null for anything else. */
export function parseHash(hash: string): Nav | null {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(dec);
  const [a, b, c] = parts;
  if (!a) return null;
  if ((TABS as string[]).includes(a) && !b) return { tab: a as Tab, stack: [] };
  switch (a) {
    case "agent":
      return b ? { tab: "agents", stack: [{ k: "agent", sid: b }] } : null;
    case "project":
      return b ? { tab: "projects", stack: [{ k: "project", id: b }] } : null;
    case "autopilot":
      return { tab: "agents", stack: [{ k: "autopilot" }] };
    case "connectors":
      return { tab: "agents", stack: [{ k: "autopilot" }, { k: "connectors" }] };
    case "connector":
      return b ? { tab: "agents", stack: [{ k: "autopilot" }, { k: "connectors" }, { k: "connector", id: b }] } : null;
    case "history":
      return b ? { tab: "projects", stack: [{ k: "project", id: b }, { k: "history", project: b }] } : { tab: "settings", stack: [{ k: "history" }] };
    case "usage":
      return { tab: "settings", stack: [{ k: "usage" }] };
    case "settings":
      // A detail (a profile, an MCP server) sits above its section: back returns to that list.
      if (!b) return { tab: "settings", stack: [] };
      return { tab: "settings", stack: c ? [{ k: "section", id: b }, { k: "section", id: b, detail: c }] : [{ k: "section", id: b }] };
    case "files": {
      // ws `home` is the home folder, opened from the Projects list, not a project.
      const up: Route[] = b === "home" ? [] : [{ k: "project", id: b }];
      return b ? { tab: "projects", stack: [...up, { k: "files", ws: b, ...(c ? { path: c } : {}) }] } : null;
    }
    case "file": {
      if (!b || !c) return null;
      const dir = c.replace(/\/[^/]*$/, "") || "/";
      const up: Route[] = b === "home" ? [] : [{ k: "project", id: b }];
      return { tab: "projects", stack: [...up, { k: "files", ws: b, path: dir }, { k: "file", ws: b, path: c }] };
    }
  }
  return null;
}

/** The history entries that stand for `n`, oldest first (see the top of the file). */
export function entriesOf(n: Nav): Nav[] {
  const out: Nav[] = [{ tab: HOME, stack: [] }];
  if (n.tab !== HOME) out.push({ tab: n.tab, stack: [] });
  n.stack.forEach((_, i) => out.push({ tab: n.tab, stack: n.stack.slice(0, i + 1) }));
  return out;
}

const KINDS = new Set(["agent", "project", "autopilot", "connectors", "connector", "history", "usage", "section", "files", "file"]);
function validRoute(r: unknown): r is Route {
  if (!r || typeof r !== "object") return false;
  const x = r as Record<string, unknown>;
  if (!KINDS.has(x.k as string)) return false;
  if (x.k === "agent") return typeof x.sid === "string";
  if (x.k === "project" || x.k === "connector" || x.k === "section") return typeof x.id === "string";
  if (x.k === "files") return typeof x.ws === "string" && (x.path === undefined || typeof x.path === "string");
  if (x.k === "file") return typeof x.ws === "string" && typeof x.path === "string";
  return true;
}
/** A route read back from history or storage (anything else is ignored). */
export function validNav(v: unknown): Nav | null {
  if (!v || typeof v !== "object") return null;
  const n = v as Record<string, unknown>;
  if (!(TABS as unknown[]).includes(n.tab) || !Array.isArray(n.stack) || !n.stack.every(validRoute)) return null;
  return { tab: n.tab as Tab, stack: n.stack as Route[] };
}

// ───────────── the store React reads ─────────────

export interface PhoneNavState {
  tab: Tab;
  stack: Route[];
  /** What each tab showed last: switching back to a tab returns there. */
  stacks: Record<Tab, Route[]>;
  /** Grows when the shown tab is tapped again (pages scroll to the top). */
  retap: number;
  /**
   * A subagent a link asked for (`#/agent/<sid>/sub/<agent>`). Subagents are layers of their
   * agent's screen, not pages: that screen opens it once the history is in place, then clears it.
   */
  sub: { sid: string; agent: string } | null;
}

const EMPTY: Record<Tab, Route[]> = { agents: [], neural: [], projects: [], settings: [] };
export const usePhoneNav = create<PhoneNavState>()(() => ({ tab: HOME, stack: [], stacks: { ...EMPTY }, retap: 0, sub: null }));

/** `#/agent/<sid>/sub/<agent>` → the subagent it names (the page itself is `parseHash`'s). */
export function subOfHash(hash: string): { sid: string; agent: string } | null {
  const [a, sid, s, agent] = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(dec);
  return a === "agent" && sid && s === "sub" && agent && /^[A-Za-z0-9_-]{1,80}$/.test(agent) ? { sid, agent } : null;
}

// ───────────── the history mirror ─────────────

interface HistoryEntry {
  nav: Nav;
  navIdx: number;
}

/** What the router needs from the window (a fake one in tests). */
export interface RouterWindow {
  history: Pick<History, "state" | "pushState" | "replaceState" | "go" | "back">;
  location: Pick<Location, "hash">;
  addEventListener: (type: "popstate", cb: () => void) => void;
  removeEventListener: (type: "popstate", cb: () => void) => void;
  localStorage?: Pick<Storage, "getItem" | "setItem">;
}

const STORE_KEY = "neuralagent.phoneNav";
/** How long a move waits for an overlay's own "back" to land before it goes ahead anyway. */
const SETTLE_MS = 400;

export class PhoneRouter {
  private win: RouterWindow;
  /** How many overlays (sheets, menus) are open; `useLayer`'s count in the app. */
  layers: () => number;
  private started = false;
  /** A move asked for before `start` (a notification tapped while the app was still starting). */
  private early: Nav | null = null;
  /** Position of the shown page in the history (0 = Agents root). */
  idx = 0;
  /** After going back several steps, push these entries (a tab switch, a jump). */
  private pending: { at: number; rest: Nav[] } | null = null;
  /** A move that waits until an overlay closing on its own has popped its history entry. */
  /** A move asked for while a traversal is still in flight; made once it has landed. */
  private queued: Nav | null = null;
  private deferred: { target: Nav; timer: ReturnType<typeof setTimeout> } | null = null;
  /** The subagent of a followed link, handed to the screen once the history is rebuilt. */
  private linkSub: PhoneNavState["sub"] = null;

  constructor(win: RouterWindow, openLayers: () => number = () => 0) {
    this.win = win;
    this.layers = openLayers;
  }

  private get nav(): Nav {
    const s = usePhoneNav.getState();
    return { tab: s.tab, stack: s.stack };
  }

  private set(n: Nav) {
    const s = usePhoneNav.getState();
    if (sameNav(n, this.nav)) return;
    usePhoneNav.setState({ tab: n.tab, stack: n.stack, stacks: { ...s.stacks, [n.tab]: n.stack } });
    try {
      this.win.localStorage?.setItem(STORE_KEY, JSON.stringify({ tab: n.tab, stacks: usePhoneNav.getState().stacks }));
    } catch {
      // private mode: nothing remembered
    }
  }

  /** Reads where to start (history on a reload, the link, the last visit) and writes the history. */
  start() {
    if (this.started) return;
    this.started = true;
    this.win.addEventListener("popstate", this.onPop);
    const st = this.win.history.state as Partial<HistoryEntry> | null;
    const fromHistory = validNav(st?.nav);
    const early = this.early;
    this.early = null;
    if (fromHistory && typeof st?.navIdx === "number") {
      // A reload: the browser kept our entries.
      this.restoreStacks();
      this.set(fromHistory);
      this.idx = st.navIdx;
      if (early) this.go(early);
      return;
    }
    const restored = this.restoreStacks();
    const target = early ?? parseHash(this.win.location.hash) ?? restored ?? { tab: HOME, stack: [] };
    const sub = early ? null : subOfHash(this.win.location.hash);
    this.set(target);
    const all = entriesOf(target);
    this.win.history.replaceState(this.entry(all[0]!, 0), "", hashOf(all[0]!));
    this.idx = 0;
    this.pushAll(all.slice(1));
    if (sub) usePhoneNav.setState({ sub });
  }

  stop() {
    if (!this.started) return;
    this.started = false;
    this.win.removeEventListener("popstate", this.onPop);
    if (this.deferred) clearTimeout(this.deferred.timer);
    this.deferred = null;
    this.pending = null;
    this.queued = null;
    this.early = null;
  }

  private restoreStacks(): Nav | null {
    try {
      const raw = JSON.parse(this.win.localStorage?.getItem(STORE_KEY) ?? "null") as { tab?: unknown; stacks?: Record<string, unknown> } | null;
      if (!raw?.stacks) return null;
      const stacks = { ...EMPTY };
      for (const t of TABS) stacks[t] = validNav({ tab: t, stack: raw.stacks[t] })?.stack ?? [];
      usePhoneNav.setState({ stacks });
      const tab = (TABS as unknown[]).includes(raw.tab) ? (raw.tab as Tab) : HOME;
      return { tab, stack: stacks[tab] };
    } catch {
      return null;
    }
  }

  private entry(nav: Nav, navIdx: number): HistoryEntry {
    return { nav, navIdx };
  }

  private pushAll(rest: Nav[], replaceFirst = false) {
    rest.forEach((n, i) => {
      if (i === 0 && replaceFirst) {
        this.win.history.replaceState(this.entry(n, this.idx + 1), "", hashOf(n));
        this.idx += 1;
        return;
      }
      this.idx += 1;
      this.win.history.pushState(this.entry(n, this.idx), "", hashOf(n));
    });
  }

  /** Shows `target`: the screen changes at once, the history follows (going back where needed). */
  go(target: Nav) {
    if (!this.started) {
      this.early = target;
      this.set(target);
      return;
    }
    const top = this.win.history.state as { layer?: string } | null;
    const overlayEntry = !!top?.layer;
    // An overlay closed itself a moment ago and its "back" has not landed yet: wait for it,
    // or the two moves would cross.
    if (overlayEntry && this.layers() === 0) {
      if (this.deferred) clearTimeout(this.deferred.timer);
      this.set(target);
      this.deferred = { target, timer: setTimeout(() => this.flushDeferred(), SETTLE_MS) };
      return;
    }
    if (this.pending) {
      // A traversal is still on its way: do not cross it, make this move once it landed.
      this.queued = target;
      return;
    }
    const cur = entriesOf(this.nav);
    const want = entriesOf(target);
    let p = 0;
    while (p < cur.length && p < want.length && sameNav(cur[p]!, want[p]!)) p++;
    this.set(target);
    const steps = cur.length - p;
    const rest = want.slice(p);
    if (steps === 1 && rest.length === 1 && !overlayEntry && cur.length - 1 === this.idx) {
      // Only the top page differs: swap its entry in place (synchronous, nothing to race).
      this.win.history.replaceState(this.entry(rest[0]!, this.idx), "", hashOf(rest[0]!));
      return;
    }
    if (steps === 0) {
      // Deeper in the same place. An open overlay's entry becomes the new page (the overlay is
      // closing anyway), so its later cleanup does not go back over the new page.
      this.pushAll(rest, overlayEntry);
      return;
    }
    const back = steps + (overlayEntry ? Math.max(1, this.layers()) : 0);
    if (rest.length) this.pending = { at: p - 1, rest };
    this.win.history.go(-back);
  }

  private flushDeferred() {
    const d = this.deferred;
    if (!d) return;
    this.deferred = null;
    // Pretend we are still at the last place the history knows, then move from there.
    const st = this.win.history.state as Partial<HistoryEntry> | null;
    const at = validNav(st?.nav);
    if (at && typeof st?.navIdx === "number") {
      usePhoneNav.setState({ tab: at.tab, stack: at.stack });
      this.idx = st.navIdx;
    }
    const top = this.win.history.state as { layer?: string } | null;
    if (top?.layer) {
      // The overlay's entry never went away: take it over.
      const cur = entriesOf(this.nav);
      const want = entriesOf(d.target);
      let p = 0;
      while (p < cur.length && p < want.length && sameNav(cur[p]!, want[p]!)) p++;
      if (p === cur.length) {
        this.set(d.target);
        this.pushAll(want.slice(p), true);
        return;
      }
    }
    this.go(d.target);
  }

  private runQueued() {
    const q = this.queued;
    this.queued = null;
    if (q) this.go(q);
  }

  private onPop = () => {
    const st = this.win.history.state as (Partial<HistoryEntry> & { layer?: string }) | null;
    const nav = validNav(st?.nav);
    if (this.deferred && !st?.layer) {
      // The overlay's back landed: now make the move that waited for it.
      const d = this.deferred;
      clearTimeout(d.timer);
      this.deferred = null;
      if (nav && typeof st?.navIdx === "number") {
        usePhoneNav.setState({ tab: nav.tab, stack: nav.stack });
        this.idx = st.navIdx;
      }
      this.go(d.target);
      return;
    }
    if (this.pending) {
      const p = this.pending;
      if (nav && st?.navIdx === p.at) {
        this.pending = null;
        this.idx = p.at;
        this.pushAll(p.rest);
        if (this.linkSub) usePhoneNav.setState({ sub: this.linkSub });
        this.linkSub = null;
        this.runQueued();
        return;
      }
      this.pending = null;
      this.queued = null;
      this.linkSub = null;
    }
    if (!nav || typeof st?.navIdx !== "number") {
      // Someone typed or followed a link (`#/agent/…`): rebuild the history for it.
      const target = parseHash(this.win.location.hash) ?? { tab: HOME, stack: [] };
      this.linkSub = subOfHash(this.win.location.hash);
      const steps = this.idx + 1;
      this.set(target);
      const want = entriesOf(target);
      this.pending = { at: 0, rest: want.slice(1) };
      this.win.history.go(-steps);
      return;
    }
    this.idx = st.navIdx;
    this.set(nav);
  };

  // ───── what the screens call ─────

  push(r: Route) {
    const n = this.nav;
    const top = n.stack.at(-1);
    if (top && routeKey(top) === routeKey(r)) return;
    this.go({ tab: n.tab, stack: [...n.stack, r] });
  }

  /** Back one page; false when there is nothing to go back to here (the Agents root). */
  back(): boolean {
    if (this.started && (this.idx > 0 || (this.win.history.state as { layer?: string } | null)?.layer)) {
      this.win.history.back();
      return true;
    }
    const n = this.nav;
    if (n.stack.length) this.go({ tab: n.tab, stack: n.stack.slice(0, -1) });
    else if (n.tab !== HOME) this.go({ tab: HOME, stack: usePhoneNav.getState().stacks[HOME] });
    else return false;
    return true;
  }

  /** A tab: the place you left it, or its root when it is the shown one. */
  tab(t: Tab) {
    const s = usePhoneNav.getState();
    if (t === s.tab) {
      if (s.stack.length) this.go({ tab: t, stack: [] });
      else usePhoneNav.setState({ retap: s.retap + 1 });
      return;
    }
    this.go({ tab: t, stack: s.stacks[t] ?? [] });
  }

  /** An agent's screen on top of the current page (another agent's screen is replaced). */
  openAgent(sid: string) {
    const n = this.nav;
    const top = n.stack.at(-1);
    if (top?.k === "agent") {
      if (top.sid === sid) return;
      this.go({ tab: n.tab, stack: [...n.stack.slice(0, -1), { k: "agent", sid }] });
      return;
    }
    this.push({ k: "agent", sid });
  }

  /** From outside (a notification): the agent over the Agents inbox, so back lands there. */
  openAgentFresh(sid: string) {
    this.go({ tab: "agents", stack: [{ k: "agent", sid }] });
  }
}

let router: PhoneRouter | null = null;
/** The app's router (created on first use with the real window). */
export function phoneRouter(openLayers?: () => number): PhoneRouter {
  if (router && openLayers) router.layers = openLayers;
  if (!router) {
    router = new PhoneRouter(
      {
        history: window.history,
        location: window.location,
        addEventListener: (t, cb) => window.addEventListener(t, cb),
        removeEventListener: (t, cb) => window.removeEventListener(t, cb),
        localStorage: (() => {
          try {
            return window.localStorage;
          } catch {
            return undefined;
          }
        })(),
      },
      openLayers,
    );
  }
  return router;
}

/** True when Android's back should go back in the page instead of leaving the app. */
export function canGoBackInPage(state: unknown = typeof history !== "undefined" ? history.state : null): boolean {
  const s = state as { layer?: string; navIdx?: number } | null;
  return !!s?.layer || (typeof s?.navIdx === "number" && s.navIdx > 0);
}

// Update state for the version label / Update button (UpdateBadge), the update dialog (UpdateDialog)
// and Settings → Updates. Two sources, picked from the platform:
// - desktop (`platform.updates`): the Tauri updater asks the relay's /api/update/… endpoint
//   (204 when current, cached for a minute); "Install now" downloads, installs and restarts the app.
//   The background service and its agents keep running; main.tsx switches to the new service once
//   no agent runs (`updates.service`).
// - web remote and Android shell (`platform.webUpdate`): compares the build baked into the bundle
//   with the relay's /version.json (no-cache, 304 when unchanged); "Reload" loads the new build.
//
// When: a first check a few seconds after start, again when the window gets focus or becomes
// visible (at most once a minute), and every 5 minutes while visible. The requests are tiny.
// The desktop dialog opens by itself once per version, when the first check after start finds it.
import { toast, type ToastHandle } from "@neuralagent/ui";
import { useEffect, useSyncExternalStore } from "react";
import { notesBetween, notesFromMarkdown } from "./changelog";
import type { ChangelogEntry, Platform, ServiceSwitch } from "./platform";
import { usePlatform } from "./store";

export const FIRST_CHECK_MS = 4_000;
export const EVERY_MS = 5 * 60_000;
export const FOCUS_GAP_MS = 60_000;
const SEEN_KEY = "na.update.offered";

export interface Offer {
  /** The new version (web: the deployed build's version, maybe the same as the running one). */
  version: string;
  /** Notes from the update manifest, used when the changelog cannot be loaded. */
  notes: string | null;
}

export interface UpdateState {
  kind: "app" | "web" | null;
  /** The version running here ("" until known). */
  current: string;
  /** Web: the running build id. */
  build: string | null;
  offer: Offer | null;
  checking: boolean;
  /** Last finished check (ms), 0 before the first. */
  checkedAt: number;
  error: string | null;
  installing: boolean;
  /** Download progress 0…1 while installing (desktop). */
  progress: number | null;
  /** The dialog is open; `mode` "offer" shows the update, "current" what is new in this version. */
  dialog: null | "offer" | "current";
  service: ServiceSwitch | null;
}

let state: UpdateState = {
  kind: null,
  current: "",
  build: null,
  offer: null,
  checking: false,
  checkedAt: 0,
  error: null,
  installing: false,
  progress: null,
  dialog: null,
  service: null,
};
const subs = new Set<() => void>();
const set = (p: Partial<UpdateState>) => {
  state = { ...state, ...p };
  subs.forEach((f) => f());
};
const subscribe = (f: () => void) => (subs.add(f), () => void subs.delete(f));

export function useUpdates(): UpdateState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

let platform: Platform | null = null;
let checks = 0;

const seen = () => {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
};
const remember = (v: string) => {
  try {
    localStorage.setItem(SEEN_KEY, v);
  } catch {
    /* private mode: the dialog may show again next start */
  }
};

/** Asks the update source now (also from Settings → "Check"). Errors stay quiet (offline, no release yet). */
export async function checkNow(): Promise<void> {
  const p = platform;
  if (!p || state.checking || state.installing) return;
  set({ checking: true });
  try {
    let offer: Offer | null = null;
    if (p.updates) {
      const u = await p.updates.check();
      offer = u ? { version: u.version, notes: u.notes ?? null } : null;
      if (u?.current) set({ current: u.current });
    } else if (p.webUpdate) {
      const d = await p.webUpdate.deployed();
      offer = d && d.build !== p.webUpdate.current.build ? { version: d.version, notes: null } : null;
    }
    const first = checks++ === 0;
    const fresh = offer && offer.version !== state.offer?.version;
    set({ offer, error: null, checkedAt: Date.now() });
    if (offer && fresh) announce(offer, first);
  } catch (e) {
    set({ error: e instanceof Error ? e.message : String(e), checkedAt: Date.now() });
  } finally {
    set({ checking: false });
  }
}

/** Desktop, first check after start: the dialog, once per version. Otherwise a calm toast once per version. */
function announce(offer: Offer, first: boolean) {
  const key = `${state.kind}:${offer.version}:${state.kind === "web" ? (platform?.webUpdate?.current.build ?? "") : ""}`;
  if (seen() === key) return;
  remember(key);
  if (state.kind === "app" && first) return set({ dialog: "offer" });
  notice?.dismiss();
  notice = toast(state.kind === "web" ? "A new version of NeuralAgent is ready." : `NeuralAgent ${offer.version} is available.`, {
    actionLabel: "What's new",
    undo: () => openUpdateDialog(),
    duration: 12000,
  });
}

/** The "is available" toast, dismissed when the dialog opens. */
let notice: ToastHandle | null = null;

export function openUpdateDialog(mode?: "offer" | "current") {
  notice?.dismiss();
  notice = null;
  set({ dialog: mode ?? (state.offer ? "offer" : "current") });
}
export function closeUpdateDialog() {
  set({ dialog: null });
}

/** Desktop: download, install, restart (agents keep running). Web: load the new build. */
export async function applyUpdate(): Promise<void> {
  const p = platform;
  if (!p || state.installing) return;
  if (p.webUpdate && !p.updates) return p.webUpdate.reload();
  if (!p.updates) return;
  set({ installing: true, progress: 0, error: null });
  try {
    await p.updates.install(); // restarts the app when done
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    set({ installing: false, progress: null, error: msg });
    toast(`Update failed: ${msg}`, { tone: "danger", actionLabel: "Retry", undo: () => void applyUpdate(), duration: 15000 });
  }
}

let changelog: { at: number; data: Promise<ChangelogEntry[]> } | null = null;

/** All release notes (cached 10 minutes); [] when they cannot be loaded. */
export function loadChangelog(): Promise<ChangelogEntry[]> {
  const p = platform;
  const get = p?.updates?.changelog ?? p?.webUpdate?.changelog;
  if (!get) return Promise.resolve([]);
  if (!changelog || Date.now() - changelog.at > 10 * 60_000) {
    changelog = { at: Date.now(), data: get().catch(() => ((changelog = null), [])) };
  }
  return changelog.data;
}

/**
 * The notes to show for an update from `current` to `target`: the changelog's versions in between,
 * else the manifest's notes for the target.
 */
export async function notesFor(current: string, target: string, fallback: string | null): Promise<ChangelogEntry[]> {
  const all = await loadChangelog();
  const between = notesBetween(all, current, target);
  if (between.length) return between;
  const one = notesFromMarkdown(target, fallback);
  return one ? [one] : [];
}

/** Starts watching (once per page). Returns the stop function for the effect. */
function start(p: Platform): () => void {
  platform = p;
  checks = 0;
  const offs: (() => void)[] = [];
  if (p.updates) {
    set({ kind: "app" });
    void p.updates.versions().then((v) => set({ current: v.app }), () => {});
    offs.push(p.updates.onProgress((x) => set({ progress: x.total ? x.done / x.total : 0 })));
    const svc = p.updates.service;
    if (svc) {
      let lastError: string | null = null;
      const sync = () => {
        const s = svc.get();
        set({ service: s });
        if (s.error && s.error !== lastError) {
          toast(`The background service could not switch to the new version: ${s.error}`, {
            tone: "danger",
            actionLabel: "Retry",
            undo: () => svc.retry(),
            duration: 20000,
          });
        }
        lastError = s.error;
      };
      sync();
      offs.push(svc.subscribe(sync));
    }
  } else if (p.webUpdate) {
    set({ kind: "web", current: p.webUpdate.current.version, build: p.webUpdate.current.build });
  } else {
    return () => {};
  }

  const visible = () => document.visibilityState === "visible";
  const maybe = () => visible() && Date.now() - state.checkedAt >= FOCUS_GAP_MS && void checkNow();
  const first = setTimeout(() => void checkNow(), FIRST_CHECK_MS);
  const every = setInterval(() => visible() && void checkNow(), EVERY_MS);
  window.addEventListener("focus", maybe);
  document.addEventListener("visibilitychange", maybe);
  return () => {
    clearTimeout(first);
    clearInterval(every);
    window.removeEventListener("focus", maybe);
    document.removeEventListener("visibilitychange", maybe);
    offs.forEach((f) => f());
  };
}

/** Mount once in the app: starts the checks for this platform. */
export function useUpdateWatch() {
  const p = usePlatform();
  useEffect(() => start(p), [p]);
}

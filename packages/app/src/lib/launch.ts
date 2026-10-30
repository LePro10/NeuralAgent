// The launch screen: one element (#na-launch, lib/launchFrame.ts) that is on screen from the first
// paint of the page until the app is ready, the same on the desktop, in the browser and on Android.
// It plays its short motion once, then waits (the accent pane breathes) and lifts as soon as
// whoever shows real content calls `launch.done()`, but never before the motion has played.
// While it is up nothing else is shown: no "Connecting…", no spinners, no "not connected" for a
// start that is just slow. Only after `GRACE_MS` may a screen say what is wrong (LaunchNote).
import { useSyncExternalStore } from "react";
import { LAUNCH_MARKUP } from "./launchFrame";

export type LaunchPhase = "still" | "play" | "wait" | "out" | "gone";

/** The motion plays at least this long before the app is revealed. */
export const MIN_MS = 640;
/** A start slower than this is a problem worth showing (with a way to retry). */
export const GRACE_MS = 7000;
/** How long the exit takes (CSS: launch.css "out"). */
const OUT_MS = 480;

interface State {
  phase: LaunchPhase;
  /** The grace time of this launch is over: screens may say what is wrong. */
  late: boolean;
}

const hasDom = typeof document !== "undefined";
let el: HTMLElement | null = hasDom ? document.getElementById("na-launch") : null;
let state: State = { phase: el ? "still" : "gone", late: false };
let playedAt = 0;
let wanted = false;
let exitTimer: ReturnType<typeof setTimeout> | undefined;
let lateTimer: ReturnType<typeof setTimeout> | undefined;
const subs = new Set<() => void>();

function set(p: Partial<State>) {
  state = { ...state, ...p };
  if (el) el.dataset.phase = state.phase;
  subs.forEach((f) => f());
}

const reduced = () =>
  hasDom && (matchMedia?.("(prefers-reduced-motion: reduce)").matches || document.documentElement.classList.contains("reduce-motion"));

function play() {
  if (state.phase !== "still") return;
  playedAt = performance.now();
  set({ phase: "play" });
  setTimeout(() => state.phase === "play" && set({ phase: "wait" }), 820);
  if (wanted) leave();
}

function leave() {
  if (state.phase === "out" || state.phase === "gone") return;
  clearTimeout(exitTimer);
  exitTimer = setTimeout(
    () => {
      set({ phase: "out" });
      setTimeout(() => {
        el?.remove();
        el = null;
        clearTimeout(lateTimer);
        set({ phase: "gone", late: false });
      }, reduced() ? 240 : OUT_MS);
    },
    Math.max(0, MIN_MS - (performance.now() - playedAt)),
  );
}

/** Starts the motion after the still frame has been painted (two frames later). */
function begin() {
  requestAnimationFrame(() => requestAnimationFrame(play));
}

function startLate(ms: number) {
  clearTimeout(lateTimer);
  lateTimer = setTimeout(() => state.phase !== "gone" && set({ late: true }), Math.max(0, ms));
}

if (el) {
  startLate(GRACE_MS - performance.now());
  // In the Android app the native splash shows this very frame first and fades out once the page
  // has painted; then the motion starts (MainActivity sets the flag and fires the event). Shells
  // without that hand-off (older APKs) do not carry the user-agent mark and start right away.
  const w = window as { __naSplashGone?: boolean };
  if (/NeuralAgentLaunch\//.test(navigator.userAgent) && !w.__naSplashGone) {
    let started = false;
    const go = () => !started && ((started = true), begin());
    window.addEventListener("na-splash-gone", go, { once: true });
    setTimeout(go, 2000);
  } else begin();
}

export const launch = {
  get phase() {
    return state.phase;
  },
  /** The app (or a screen that replaces it) is ready: lift the launch screen after the motion. */
  done() {
    wanted = true;
    if (state.phase === "still") return; // play() leaves when it starts
    leave();
  },
  /** Shows the launch screen again (e.g. the web remote opens another computer). */
  show() {
    if (!hasDom || el) return;
    const t = document.createElement("template");
    t.innerHTML = LAUNCH_MARKUP;
    el = t.content.firstElementChild as HTMLElement;
    document.body.prepend(el);
    wanted = false;
    set({ phase: "still", late: false });
    startLate(GRACE_MS);
    begin();
  },
  /** The element LaunchNote renders into while the launch screen is up. */
  get element() {
    return el;
  },
};

const subscribe = (f: () => void) => (subs.add(f), () => void subs.delete(f));

/** The launch screen's phase and whether its grace time is over, as React state. */
export function useLaunch(): State & { up: boolean; settling: boolean } {
  const s = useSyncExternalStore(subscribe, () => state, () => state);
  const up = s.phase !== "gone" && s.phase !== "out";
  return { ...s, up, settling: up && !s.late };
}

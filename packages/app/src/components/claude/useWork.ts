/**
 * React side of `work.ts`: one shared clock for elapsed times (ticks only while something that
 * shows a time is mounted and running) and when this client saw each task end (the strip's fade
 * uses the phone's own clock, not the computer's).
 */
import type { CvTask } from "@neuralagent/protocol";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { nextFade, stripItems } from "./work";

// ───────────── one clock for every elapsed time ─────────────

let now = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;
const ticks = new Set<() => void>();

function subscribeClock(f: () => void) {
  ticks.add(f);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const g of ticks) g();
    }, 1000);
  }
  return () => {
    ticks.delete(f);
    if (!ticks.size && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

const noop = () => () => {};

/** `Date.now()`, re-rendering every second while `live` (otherwise frozen at the last tick). */
export function useNow(live: boolean): number {
  const t = useSyncExternalStore(live ? subscribeClock : noop, () => (live ? now : 0));
  return live ? t : Date.now();
}

// ───────────── when the client saw a task end ─────────────

/** `endedAt(task)` for the strip: the moment this view saw the task stop running. */
export function useEndedAt(sid: string, tasks: CvTask[]): (t: CvTask) => number | undefined {
  const seen = useRef<{ sid: string; running: Set<string>; ended: Map<string, number> }>({ sid, running: new Set(), ended: new Map() });
  if (seen.current.sid !== sid) seen.current = { sid, running: new Set(), ended: new Map() };
  const s = seen.current;
  for (const t of tasks) {
    if (t.status === "running") {
      s.running.add(t.id);
      s.ended.delete(t.id);
    } else if (s.running.delete(t.id)) {
      s.ended.set(t.id, Date.now());
    }
  }
  return useCallback((t: CvTask) => s.ended.get(t.id), [s]);
}

/** The items the strip shows now; re-evaluates by itself when the next finished one fades. */
export function useStripItems(sid: string, tasks: CvTask[]): CvTask[] {
  const endedAt = useEndedAt(sid, tasks);
  const [, bump] = useState(0);
  const t = Date.now();
  const items = stripItems(tasks, t, endedAt);
  const wait = nextFade(tasks, t, endedAt);
  // The moment it fades (stable across renders, unlike the time left).
  const at = wait === undefined ? undefined : Math.round(t + wait);
  useEffect(() => {
    if (at === undefined) return;
    const id = setTimeout(() => bump((n) => n + 1), Math.max(0, at - Date.now()) + 50);
    return () => clearTimeout(id);
  }, [at]);
  return items;
}

/**
 * Streaming helpers. Networks deliver tokens in bursts (a worker batches
 * ~50 ms, TCP batches more); shown raw, whole clauses pop in at once. These
 * hooks turn bursts into a calm, word-by-word flow and keep status labels
 * from flickering when a fast model changes them every 100 ms.
 */
import { useEffect, useRef, useState } from 'react';

/** How many characters to release this frame: a backlog drains in ~¼ s, never slower than a reading pace. */
export function releaseStep(rest: number, dtMs: number, live: boolean): number {
  if (rest <= 0) return 0;
  const drain = (rest * dtMs) / (live ? 260 : 110);
  const floor = (dtMs * (live ? 55 : 400)) / 1000;
  return Math.min(rest, Math.max(1, Math.round(Math.max(drain, floor))));
}

/** Extend to the end of the current word, so no half word fades in. */
export function toWordEnd(text: string, n: number): number {
  if (n >= text.length) return text.length;
  const rest = text.slice(n, n + 24).search(/\s/);
  return rest < 0 ? n : n + rest;
}

/**
 * Smooths a growing string. `live` = still streaming; when not live (history,
 * finished) the rest appears quickly. If the target is replaced rather than
 * extended (server correction), it never shows past the new target.
 */
export function useSmoothText(target: string, live: boolean): string {
  const [n, setN] = useState(() => (live ? 0 : target.length));
  const nRef = useRef(n);
  const targetRef = useRef(target);
  const liveRef = useRef(live);
  const raf = useRef<number | null>(null);
  targetRef.current = target;
  liveRef.current = live;

  useEffect(() => {
    if (raf.current !== null) return;
    if (nRef.current >= target.length && !live) return;
    let last = performance.now();
    const tick = (t: number) => {
      const dt = Math.min(64, t - last);
      last = t;
      const z = targetRef.current;
      let cur = Math.min(nRef.current, z.length);
      if (cur < z.length) cur = toWordEnd(z, cur + releaseStep(z.length - cur, dt, liveRef.current));
      if (cur !== nRef.current) { nRef.current = cur; setN(cur); }
      raf.current = cur >= z.length && !liveRef.current ? null : requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }, [target, live]);

  useEffect(() => () => { if (raf.current !== null) cancelAnimationFrame(raf.current); raf.current = null; }, []);
  // A shorter target (restart) resets the counter.
  useEffect(() => { if (target.length < nRef.current) { nRef.current = live ? 0 : target.length; setN(nRef.current); } }, [target, live]);
  return target.slice(0, Math.min(n, target.length));
}

/** Holds each value at least `minMs`, then shows the newest — status labels stop flickering. */
export function useStable<T>(value: T, minMs: number): T {
  const [shown, setShown] = useState(value);
  const since = useRef(0);
  const timer = useRef<number | null>(null);
  useEffect(() => {
    if (Object.is(value, shown)) return;
    const wait = Math.max(0, since.current + minMs - performance.now());
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { timer.current = null; since.current = performance.now(); setShown(value); }, wait);
    return () => { if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; } };
  }, [value, shown, minMs]);
  return shown;
}

/** true at once, false only after `ms` — short pauses don't close a window that will reopen. */
export function useLinger(on: boolean, ms: number): boolean {
  const [v, setV] = useState(on);
  useEffect(() => {
    if (on) { setV(true); return; }
    const t = window.setTimeout(() => setV(false), ms);
    return () => window.clearTimeout(t);
  }, [on, ms]);
  return on || v;
}

/** Elapsed seconds while `running`; freezes when it stops. */
export function useElapsed(running: boolean): number {
  const [s, setS] = useState(0);
  const start = useRef(0);
  useEffect(() => {
    if (!running) return;
    start.current = performance.now() - s * 1000;
    const t = window.setInterval(() => setS((performance.now() - start.current) / 1000), 100);
    return () => window.clearInterval(t);
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps
  return s;
}

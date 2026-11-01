// Small hooks for the marketing pages. No dependencies: IntersectionObserver, matchMedia and ONE shared
// rAF loop that writes scroll progress into CSS custom properties (so scroll-linked motion never re-renders React).
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

const canMatch = typeof matchMedia === "function";

/** True when the visitor asks for less motion (system setting or the app's `.reduce-motion` class). */
export function prefersReducedMotion(): boolean {
  return canMatch && (matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.classList.contains("reduce-motion"));
}

/** Live `matchMedia` result. `useMedia("(min-width: 900px)")`. */
export function useMedia(query: string): boolean {
  const [m, setM] = useState(() => (canMatch ? matchMedia(query).matches : false));
  useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return m;
}

export const useReducedMotion = () => useMedia("(prefers-reduced-motion: reduce)");
/** Phone-sized viewport (the brief's phone range: up to 719 px). */
export const useIsPhone = () => useMedia("(max-width: 719px)");
/** A real pointer with hover (not touch): gate cursor effects on this. */
export const useFinePointer = () => useMedia("(hover: hover) and (pointer: fine)");

interface InViewOptions {
  /** Margin around the viewport, like IntersectionObserver rootMargin. Default "0px". */
  margin?: string;
  /** Fraction of the element that must be visible. Default 0. */
  threshold?: number;
  /** Stay true after the first time it was seen. Default false (tracks live visibility). */
  once?: boolean;
}

/** Is the element on screen? Use it to pause anything that loops (canvas, timers, iframes). */
export function useInView<T extends Element>(ref: RefObject<T | null>, { margin = "0px", threshold = 0, once = false }: InViewOptions = {}): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e) return;
        if (e.isIntersecting) {
          setSeen(true);
          if (once) io.disconnect();
        } else if (!once) setSeen(false);
      },
      { rootMargin: margin, threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, margin, threshold, once]);
  return seen;
}

/** Page visibility (tab hidden → pause loops). */
export function usePageVisible(): boolean {
  const [v, setV] = useState(() => (typeof document === "undefined" ? true : !document.hidden));
  useEffect(() => {
    const on = () => setV(!document.hidden);
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return v;
}

/* ── The shared scroll loop ──────────────────────────────────────────────
   Every element registered with useScrollProgress is measured in ONE rAF per scroll frame, only while it is
   within a viewport of the screen. It gets three custom properties (unitless numbers):
     --p  0 → 1   element top enters at the bottom edge … element bottom leaves at the top edge
     --c  -1 → 1  centred = 0; below the centre line = negative … above = positive (symmetric, for parallax)
     --t  0 → 1   for tall tracks with a sticky child: 0 while the track's top is at the viewport top,
                  1 when its bottom reaches the viewport bottom. Drives chapters of a sticky stage.
   Under reduced motion nothing runs: the properties are set once to the settled end state (--p 1, --c 0, --t 1)
   and CSS must look complete there. `html` gets --page (0-1 whole page) and `data-scrolled` after 24 px. */
const tracked = new Set<HTMLElement>();
const near = new Set<HTMLElement>();
let io: IntersectionObserver | undefined;
let raf = 0;
let loopOn = false;
let lastScrolled: boolean | undefined;

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

function measure() {
  raf = 0;
  const root = document.documentElement;
  const vh = innerHeight;
  const y = scrollY;
  const scrolled = y > 24;
  if (scrolled !== lastScrolled) {
    lastScrolled = scrolled;
    if (scrolled) root.setAttribute("data-scrolled", "");
    else root.removeAttribute("data-scrolled");
  }
  root.style.setProperty("--page", clamp01(y / Math.max(1, root.scrollHeight - vh)).toFixed(4));
  near.forEach((el) => {
    const r = el.getBoundingClientRect();
    const p = clamp01((vh - r.top) / (vh + r.height));
    const c = Math.max(-1, Math.min(1, (vh / 2 - (r.top + r.height / 2)) / (vh / 2 + r.height / 2)));
    const t = clamp01(-r.top / Math.max(1, r.height - vh));
    el.style.setProperty("--p", p.toFixed(4));
    el.style.setProperty("--c", c.toFixed(4));
    el.style.setProperty("--t", t.toFixed(4));
  });
}
const request = () => {
  if (!raf) raf = requestAnimationFrame(measure);
};
function startLoop() {
  if (loopOn) return;
  loopOn = true;
  addEventListener("scroll", request, { passive: true });
  addEventListener("resize", request);
  io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) (e.isIntersecting ? near.add(e.target as HTMLElement) : near.delete(e.target as HTMLElement));
      request();
    },
    { rootMargin: "100% 0px 100% 0px" },
  );
  tracked.forEach((el) => io!.observe(el));
}
/** Starts the document-level part (data-scrolled, --page). Called by initPage(); idempotent. */
export function startScrollLoop() {
  startLoop();
  request();
}

/**
 * Registers `ref` with the shared loop: it gets `--p`, `--c`, `--t` (see above) while near the viewport.
 * Style with `transform: translateY(calc(var(--c) * -40px))` etc. Only transform/opacity please.
 */
export function useScrollProgress<T extends HTMLElement>(ref: RefObject<T | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion()) {
      el.style.setProperty("--p", "1");
      el.style.setProperty("--c", "0");
      el.style.setProperty("--t", "1");
      return;
    }
    tracked.add(el);
    startLoop();
    io?.observe(el);
    request();
    return () => {
      tracked.delete(el);
      near.delete(el);
      io?.unobserve(el);
    };
  }, [ref]);
}

/** The section (by id) that sits in the reading band of the viewport; null above the first. For scroll-spy. */
export function useActiveSection(ids: readonly string[]): string | null {
  const [active, setActive] = useState<string | null>(null);
  const key = ids.join("|");
  useEffect(() => {
    const els = ids.map((id) => document.getElementById(id)).filter((e): e is HTMLElement => !!e);
    if (!els.length) return;
    const live = new Set<string>();
    const pick = () => setActive(els.find((e) => live.has(e.id))?.id ?? null);
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) (e.isIntersecting ? live.add(e.target.id) : live.delete(e.target.id));
        pick();
      },
      { rootMargin: "-35% 0px -60% 0px" },
    );
    els.forEach((e) => obs.observe(e));
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return active;
}

/** Copies text; returns `[copy, justCopied]`. Falls back to a hidden textarea where the Clipboard API is blocked. */
export function useCopy(text: string, resetMs = 1800) {
  const [done, setDone] = useState(false);
  const timer = useRef<number>(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const t = document.createElement("textarea");
      t.value = text;
      t.setAttribute("readonly", "");
      t.style.cssText = "position:fixed;opacity:0;pointer-events:none";
      document.body.appendChild(t);
      t.select();
      try {
        document.execCommand("copy");
      } catch {
        /* nothing else to try */
      }
      t.remove();
    }
    setDone(true);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setDone(false), resetMs);
  }, [text, resetMs]);
  return [copy, done] as const;
}

/**
 * True while the element has more content to the right than it shows (a horizontally scrolling command line): use it to
 * fade the right edge as a scroll hint. It turns false once the end is reached or when nothing overflows.
 */
export function useMoreToRight<T extends HTMLElement>(ref: RefObject<T | null>, dep?: unknown): boolean {
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setMore(el.scrollWidth - el.clientWidth - el.scrollLeft > 2);
    check();
    el.addEventListener("scroll", check, { passive: true });
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(check) : undefined;
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", check);
      ro?.disconnect();
    };
  }, [ref, dep]);
  return more;
}

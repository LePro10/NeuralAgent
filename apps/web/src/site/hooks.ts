// Small scroll / viewport helpers for the landing page. No dependencies: one scroll listener, one
// IntersectionObserver per use, everything else is CSS reading custom properties.
import { useEffect, useRef, useState } from "react";

export const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** True once the element has been (nearly) on screen. Stays true. */
export function useSeen<T extends HTMLElement>(margin = "200px") {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && (setSeen(true), io.disconnect()), { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [seen, margin]);
  return [ref, seen] as const;
}

/** True while the element is on screen (for pausing simulations that nobody sees). */
export function useVisible<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [vis, setVis] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVis(!!e?.isIntersecting), { rootMargin: "80px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, vis] as const;
}

export function useMedia(query: string) {
  const [m, setM] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return m;
}

/**
 * Global scroll engine. Elements opt in with attributes:
 *  - data-reveal            fades/rises in once when entering the viewport (`.in` class)
 *  - data-sp                gets --p: 1 (entering at the bottom) … 0 (centred) … -1 (leaving at the top), and --v 0…1 (how far it has come up)
 *  - data-sp="track"        gets --t: 0…1 across the element's own height (for tall pinned sections)
 * The page gets --page (0…1 total scroll) and `.scrolled` on <html> after 24px.
 */
export function startScroll() {
  const root = document.documentElement;
  root.classList.add("js");
  const calm = reduced();
  const reveal = new IntersectionObserver(
    (es) => es.forEach((e) => e.isIntersecting && (e.target.classList.add("in"), reveal.unobserve(e.target))),
    { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
  );
  const seen = new WeakSet<Element>();
  const scan = () =>
    document.querySelectorAll("[data-reveal]").forEach((el) => {
      if (seen.has(el)) return;
      seen.add(el);
      if (calm) el.classList.add("in");
      else reveal.observe(el);
    });
  scan();
  const mo = new MutationObserver(scan);
  mo.observe(document.body, { childList: true, subtree: true });

  let live: HTMLElement[] = [];
  const io = new IntersectionObserver(
    (es) => {
      for (const e of es) {
        const el = e.target as HTMLElement;
        live = e.isIntersecting ? (live.includes(el) ? live : [...live, el]) : live.filter((x) => x !== el);
      }
      tick();
    },
    { rootMargin: "20% 0px 20% 0px" },
  );
  const watched = new WeakSet<Element>();
  const watch = () =>
    document.querySelectorAll("[data-sp]").forEach((el) => {
      if (watched.has(el)) return;
      watched.add(el);
      io.observe(el);
    });
  watch();
  new MutationObserver(watch).observe(document.body, { childList: true, subtree: true });

  let raf = 0;
  const tick = () => {
    raf = 0;
    const vh = innerHeight;
    const y = scrollY;
    const max = Math.max(1, root.scrollHeight - vh);
    root.style.setProperty("--page", String(Math.min(1, y / max)));
    root.classList.toggle("scrolled", y > 24);
    if (calm) return;
    for (const el of live) {
      const r = el.getBoundingClientRect();
      if (el.dataset.sp === "track") {
        const t = Math.min(1, Math.max(0, -r.top / Math.max(1, r.height - vh)));
        el.style.setProperty("--t", t.toFixed(4));
      } else {
        const p = ((r.top + r.height / 2) / vh - 0.5) * 2;
        el.style.setProperty("--p", Math.max(-1.2, Math.min(1.2, p)).toFixed(4));
        el.style.setProperty("--v", Math.min(1, Math.max(0, 1 - (r.top - vh * 0.1) / (vh * 0.7))).toFixed(4));
      }
    }
  };
  const req = () => raf || (raf = requestAnimationFrame(tick));
  addEventListener("scroll", req, { passive: true });
  addEventListener("resize", req);
  tick();
}

/** Types `text` into view, one character every `speed` ms, once `run` is true. */
export function useTyped(text: string, run: boolean, speed = 22) {
  const [n, setN] = useState(reduced() ? text.length : 0);
  useEffect(() => {
    if (!run || reduced()) return setN(text.length) as void;
    setN(0);
    const id = setInterval(() => setN((v) => (v >= text.length ? (clearInterval(id), v) : v + 1)), speed);
    return () => clearInterval(id);
  }, [text, run, speed]);
  return text.slice(0, n);
}

/** Copies text; returns [copy, justCopied]. */
export function useCopy(text: string) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const t = document.createElement("textarea");
      t.value = text;
      document.body.appendChild(t);
      t.select();
      document.execCommand("copy");
      t.remove();
    }
    setDone(true);
    setTimeout(() => setDone(false), 1800);
  };
  return [copy, done] as const;
}

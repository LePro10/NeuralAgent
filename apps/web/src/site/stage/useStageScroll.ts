// The stage's one scroll loop. It caches where every chapter sits (on resize only), so a scroll frame reads nothing from
// layout: it takes scrollY, finds the chapter on the reading line, and writes CSS custom properties that only
// `transform` and `opacity` read. No scroll-jacking: the page scrolls natively, this only listens.
//
//   on the rig       --ws window scale · --wx / --wy window offset (px) · --ph phone presence 0..1
//                    --px / --py / --ps the phone's place (constant between resizes)
//   on the root      --hs hero shrink 0 (window at full size) .. 1 (docked beside the copy)
//   on each chapter  --k presence of the copy: 1 while the chapter is the one being read, fading only as the next takes over
//   on each segment  --f progress through its chapter 0..1
//
// Window states: HERO (as wide as the column, the first screen) -> DOCK (right column, copy beside it) -> PHONE (the
// window steps left and the phone stands in front of its right edge) -> DOCK. Chapter i is centred at u = i + 0.5.
// Under reduced motion the loop still finds the active chapter (the demo follows the story) but writes one static
// arrangement (window and phone side by side) and never animates.
import { useLayoutEffect, type RefObject } from "react";
import type { Chapter } from "./chapters";

export interface St {
  s: number;
  x: number;
  y: number;
  ph: number;
}

interface Refs {
  root: RefObject<HTMLElement | null>;
  rig: RefObject<HTMLElement | null>;
  area: RefObject<HTMLElement | null>;
  desk: RefObject<HTMLElement | null>;
  phone: RefObject<HTMLElement | null>;
  chapters: RefObject<HTMLElement | null>;
  items: RefObject<(HTMLElement | null)[]>;
  segs: RefObject<(HTMLElement | null)[]>;
}

interface Opts {
  refs: Refs;
  list: readonly Chapter[];
  reduced: boolean;
  onActive: (i: number) => void;
  onNear: (near: boolean) => void;
}

const clamp = (n: number, a: number, b: number) => (n < a ? a : n > b ? b : n);
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/**
 * Opacity of a chapter's copy at distance `d` (in chapters) from the reading line. A plateau, not a ramp: the chapter
 * being read is at full strength for most of its scroll (the copy is the thing to read, and it must keep its contrast),
 * it only softens in the last stretch before the neighbour takes over (d = 0.5) and is a quiet hint beyond.
 */
export const presence = (d: number) => clamp(1 - smooth(0.34, 1.05, d) * 0.9, 0.1, 1);
const mix = (a: St, b: St, t: number): St => ({ s: a.s + (b.s - a.s) * t, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, ph: a.ph + (b.ph - a.ph) * t });

/** Room under the window: the tools row (live marker, use it, reset, full demo) lives there, never scaled. */
export const TOOLS = 52;

interface In {
  /** Width of the page column (the hero state centres the window in it) and of the stage (the column plus the bleed to the right). */
  fw: number;
  rw: number;
  /** Stage height. */
  sh: number;
  /** Window natural size. */
  hw: number;
  hh: number;
  /** Phone natural size. */
  pw: number;
  pt: number;
  /** Copy column width. */
  cw: number;
}
export interface Geo {
  hero: St;
  dock: St;
  phone: St;
  /** Window and phone side by side, nothing overlapping (reduced motion). */
  side: St;
  /** The phone's place and scale. */
  p: { x: number; y: number; s: number };
}

/** The arrangements for a stage of this size. Pure, so it can be reasoned about on its own. */
export function arrange({ fw, rw, sh, hw, hh, pw, pt, cw }: In): Geo {
  const gap = clamp(fw * 0.03, 20, 40);
  const x0 = cw + gap;
  const room = sh - TOOLS;
  // The window is drawn at 960 px and may grow a little beyond that for the first screen (the app is vector, it stays sharp).
  const sHero = Math.max(0.3, Math.min(1.25, fw / hw, (room - 8) / hh));
  const sDock = Math.max(0.3, Math.min(sHero, 1, (rw - x0) / hw, (room - 16) / hh));
  const sp = Math.min(0.9, (room - 8) / pt);
  const pws = pw * sp;
  const px = rw - pws;
  const py = Math.max(0, (room - pt * sp) / 2);
  const overlap = pws * 0.5;
  const s2 = Math.max(0.3, Math.min(sDock, (px + overlap - x0) / hw));
  const s3 = Math.max(0.3, Math.min(sDock, (px - gap - x0) / hw));
  const cy = (s: number) => Math.max(0, (room - hh * s) / 2);
  return {
    hero: { s: sHero, x: (fw - hw * sHero) / 2, y: 8, ph: 0 },
    // On a wide screen the window is centred in the room beside the copy; when the room is just enough it fills it.
    dock: { s: sDock, x: x0 + Math.max(0, rw - x0 - hw * sDock) / 2, y: cy(sDock), ph: 0 },
    phone: { s: s2, x: x0, y: cy(s2), ph: 1 },
    side: { s: s3, x: x0, y: cy(s3), ph: 1 },
    p: { x: px, y: py, s: sp },
  };
}

export function useStageScroll({ refs, list, reduced, onActive, onNear }: Opts) {
  useLayoutEffect(() => {
    const root = refs.root.current;
    const rig = refs.rig.current;
    const wrap = refs.chapters.current;
    if (!root || !rig || !wrap) return;
    const n = list.length;
    let raf = 0;
    let near = false;
    let lastActive = -9;
    let geo: Geo | null = null;
    let tops: number[] = [];
    let heights: number[] = [];
    let lineY = 0; // the reading line, viewport px
    const written = new WeakMap<Element, Record<string, string>>();
    const set = (el: HTMLElement | null | undefined, name: string, v: string) => {
      if (!el) return;
      let m = written.get(el);
      if (!m) written.set(el, (m = {}));
      if (m[name] === v) return;
      m[name] = v;
      el.style.setProperty(name, v);
    };

    const write = (st: St, hs: number) => {
      set(rig, "--ws", st.s.toFixed(3));
      set(rig, "--wx", `${st.x.toFixed(1)}px`);
      set(rig, "--wy", `${st.y.toFixed(1)}px`);
      set(rig, "--ph", st.ph.toFixed(3));
      set(root, "--hs", hs.toFixed(3));
      refs.phone.current?.setAttribute("data-on", st.ph > 0.005 ? "" : "off");
    };

    const measure = () => {
      raf = 0;
      const area = refs.area.current;
      const desk = refs.desk.current;
      const first = refs.items.current[0];
      if (!area || !desk || !first) return;
      const phone = refs.phone.current;
      geo = arrange({
        fw: root.clientWidth,
        rw: area.clientWidth,
        sh: area.clientHeight,
        hw: desk.offsetWidth,
        hh: desk.offsetHeight,
        pw: phone?.offsetWidth ?? 0,
        pt: phone?.offsetHeight ?? 0,
        cw: first.offsetWidth,
      });
      set(rig, "--px", `${geo.p.x.toFixed(1)}px`);
      set(rig, "--py", `${geo.p.y.toFixed(1)}px`);
      set(rig, "--ps", geo.p.s.toFixed(3));
      const sy = scrollY;
      const items = refs.items.current.filter((c): c is HTMLElement => !!c);
      tops = items.map((c) => c.getBoundingClientRect().top + sy);
      heights = items.map((c) => c.offsetHeight);
      const nav = parseFloat(getComputedStyle(rig).top) || 0;
      lineY = nav + (innerHeight - nav) / 2;
      if (reduced) write(geo.side, 1);
      frame();
    };

    const frame = () => {
      raf = 0;
      if (!tops.length || !geo) return;
      const y = scrollY + lineY;
      let u: number;
      if (y < tops[0]!) u = clamp((y - tops[0]!) / Math.max(1, heights[0]!), -1, 0);
      else {
        u = n;
        for (let i = 0; i < n; i++) {
          const end = tops[i]! + heights[i]!;
          if (y < end) {
            u = i + clamp((y - tops[i]!) / Math.max(1, heights[i]!), 0, 0.9999);
            break;
          }
        }
      }
      const active = u < 0 ? -1 : Math.min(n - 1, Math.floor(u));
      if (active !== lastActive) {
        lastActive = active;
        onActive(active);
      }
      if (reduced) return;

      // Window and phone: piecewise smooth between the chapter centres.
      const keys = [{ u: -0.3, st: geo.hero }, { u: 0.22, st: geo.dock }, ...list.map((c, i) => ({ u: i + 0.5, st: c.phone ? geo!.phone : geo!.dock }))];
      let st = keys[keys.length - 1]!.st;
      if (u <= keys[0]!.u) st = keys[0]!.st;
      else
        for (let i = 0; i < keys.length - 1; i++) {
          const a = keys[i]!;
          const b = keys[i + 1]!;
          if (u <= b.u) {
            st = mix(a.st, b.st, smooth(0.16, 0.84, (u - a.u) / (b.u - a.u)));
            break;
          }
        }
      write(st, clamp((geo.hero.s - st.s) / Math.max(0.01, geo.hero.s - geo.dock.s), 0, 1));

      refs.items.current.forEach((c, i) => set(c, "--k", presence(Math.abs(u - (i + 0.5))).toFixed(2)));
      refs.segs.current.forEach((s, i) => set(s, "--f", clamp(u - i, 0, 1).toFixed(3)));
    };

    const request = () => {
      if (!raf) raf = requestAnimationFrame(frame);
    };
    const remeasure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };

    measure();
    const io = new IntersectionObserver(
      ([e]) => {
        const now = !!e?.isIntersecting;
        if (now === near) return;
        near = now;
        onNear(now);
        if (now) {
          addEventListener("scroll", request, { passive: true });
          remeasure();
        } else removeEventListener("scroll", request);
      },
      { rootMargin: "100% 0px 100% 0px" },
    );
    io.observe(root);
    const ro = new ResizeObserver(remeasure);
    ro.observe(wrap);
    ro.observe(refs.area.current!);
    addEventListener("resize", remeasure);
    void document.fonts?.ready.then(remeasure); // late layout (web fonts) moves the chapters a little
    return () => {
      io.disconnect();
      ro.disconnect();
      removeEventListener("scroll", request);
      removeEventListener("resize", remeasure);
      cancelAnimationFrame(raf);
    };
    // The inputs are refs and stable callbacks; the loop restarts only when the motion preference changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);
}

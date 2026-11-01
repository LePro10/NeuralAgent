import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "./hooks";

/**
 * The hero background graphic (BRIEF 2.5b): a dim field of tiny panes, tiled like a window manager would
 * tile them, a few of them working / waiting / done with the same marks as the app. Canvas, no library.
 *
 *  - colours come from CSS custom properties at runtime (accent, ember, bright), never literals
 *  - DPR <= 2, ~30 fps, single canvas; idle outlines are batched into one stroke
 *  - pauses while offscreen and while the tab is hidden; a static frame under reduced motion
 *  - cursor response (a pane lights up under the pointer) only with a fine pointer; lighter density on phones
 *
 * Place inside a positioned parent: it fills it (`position:absolute; inset:0`, pointer-events none).
 * The parent receives the pointer events. Style hook: `.na-field` (fades out at the bottom).
 */

type Kind = "working" | "waiting" | "done";
interface Leaf {
  x: number; y: number; w: number; h: number;
  kind: Kind | null;
  until: number;      // ms timestamp of the next state change
  born: number;       // ms timestamp when the current state began
  lines: number[];    // output line lengths 0-1
  title: number;      // title label length in px
  hover: number;      // 0-1 eased cursor highlight
}

const UNIT = 8;       // layout snap
const GUTTER = 6;     // gap between panes
const mulberry = (a: number) => () => {
  a |= 0; a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Binary space partition of the field into pane-shaped leaves, deterministic per seed. */
function layout(W: number, H: number, rnd: () => number, minW: number, minH: number): Leaf[] {
  const out: Leaf[] = [];
  const split = (x: number, y: number, w: number, h: number, depth: number) => {
    const canV = w >= minW * 2;
    const canH = h >= minH * 2;
    const big = w > minW * 3.2 || h > minH * 3.2;
    if ((!canV && !canH) || (!big && depth > 1 && rnd() < 0.34)) {
      out.push({ x, y, w, h, kind: null, until: 0, born: 0, lines: [], title: 14 + Math.floor(rnd() * 5) * 6, hover: 0 });
      return;
    }
    const vertical = canV && (!canH || w / h > 1.5 || (w / h > 0.8 && rnd() < 0.5));
    const ratio = 0.36 + rnd() * 0.28;
    if (vertical) {
      const a = Math.round((w * ratio) / UNIT) * UNIT;
      split(x, y, a, h, depth + 1);
      split(x + a, y, w - a, h, depth + 1);
    } else {
      const a = Math.round((h * ratio) / UNIT) * UNIT;
      split(x, y, w, a, depth + 1);
      split(x, y + a, w, h - a, depth + 1);
    }
  };
  split(0, 0, Math.ceil(W / UNIT) * UNIT, Math.ceil(H / UNIT) * UNIT, 0);
  return out;
}

export function PaneField({ seed = 11, className }: { seed?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const host = canvas?.parentElement;
    const ctx = canvas?.getContext("2d", { alpha: true });
    if (!canvas || !host || !ctx) return;

    const calm = prefersReducedMotion();
    const phone = matchMedia("(max-width: 719px)").matches;
    const fine = matchMedia("(hover: hover) and (pointer: fine)").matches && !calm;
    const rnd = mulberry(seed);
    let leaves: Leaf[] = [];
    let W = 0, H = 0, dpr = 1;
    let ink = "", accent = "", ember = "";
    let inView = false, pageVisible = !document.hidden, raf = 0, last = 0;
    let pointer: { x: number; y: number } | null = null;
    let frames = 0, spent = 0;

    const readColors = () => {
      const probe = document.createElement("span");
      probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none";
      host.appendChild(probe);
      const get = (v: string) => { probe.style.color = `var(${v})`; return getComputedStyle(probe).color; };
      ink = get("--color-bright"); accent = get("--color-accent"); ember = get("--color-ember");
      probe.remove();
    };

    const activate = (l: Leaf, now: number, kind: Kind) => {
      l.kind = kind;
      l.born = now;
      l.until = now + (kind === "working" ? 5000 + rnd() * 7000 : kind === "waiting" ? 4500 + rnd() * 3000 : 6000 + rnd() * 6000);
      const n = 2 + Math.floor(rnd() * 3);
      l.lines = Array.from({ length: n }, () => 0.28 + rnd() * 0.62);
    };
    const target = () => Math.max(2, Math.round(leaves.length * (phone ? 0.2 : 0.24)));
    const count = (k: Kind) => leaves.reduce((n, l) => n + (l.kind === k ? 1 : 0), 0);

    const build = () => {
      const r = host.getBoundingClientRect();
      W = Math.max(1, Math.round(r.width));
      H = Math.max(1, Math.round(r.height));
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      readColors();
      const r2 = mulberry(seed);
      leaves = layout(W, H, r2, phone ? 150 : 232, phone ? 120 : 152);
      const now = performance.now();
      // Initial states: a fixed mix so the first frame (and the reduced-motion frame) already tells the story.
      // Activity gathers on the right, away from the headline: sort by x plus noise.
      const order = leaves.map((_, i) => i).sort((a, b) => leaves[b]!.x + r2() * W * 0.45 - (leaves[a]!.x + r2() * W * 0.45));
      const kinds: Kind[] = ["working", "working", "waiting", "done", "working", "done"];
      order.slice(0, target()).forEach((idx, i) => {
        const k = kinds[i % kinds.length]!;
        activate(leaves[idx]!, now, k);
        leaves[idx]!.until = now + 1500 + r2() * 6000; // staggered first changes
      });
      draw(now);
    };

    const step = (now: number) => {
      for (const l of leaves) {
        if (l.kind && now > l.until) {
          const k = l.kind;
          if (k === "working") activate(l, now, rnd() < 0.18 && count("waiting") < 2 ? "waiting" : "done");
          else if (k === "waiting") activate(l, now, "working");
          else l.kind = null;
        }
      }
      const active = leaves.filter((l) => l.kind).length;
      if (active < target() && rnd() < 0.05) {
        const idle = leaves.filter((l) => !l.kind);
        const l = idle[Math.floor(rnd() * idle.length)];
        if (l) activate(l, now, "working");
      }
      for (const l of leaves) {
        const goal = pointer && pointer.x >= l.x && pointer.x < l.x + l.w && pointer.y >= l.y && pointer.y < l.y + l.h ? 1 : 0;
        l.hover += (goal - l.hover) * 0.2;
        if (Math.abs(goal - l.hover) < 0.01) l.hover = goal;
      }
    };

    const ring = (cx: number, cy: number, now: number, spin: boolean) => {
      const a0 = spin ? ((now % 1500) / 1500) * Math.PI * 2 : -0.6;
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.22;
      ctx.beginPath(); ctx.arc(cx, cy, 4.4, 0, Math.PI * 2); ctx.stroke();
      const seg = 7, tail = Math.PI * 1.25;
      for (let i = 0; i < seg; i++) {
        ctx.globalAlpha = 0.14 + (i / (seg - 1)) * 0.82;
        ctx.beginPath();
        ctx.arc(cx, cy, 4.4, a0 - tail + (i / seg) * tail, a0 - tail + ((i + 1.15) / seg) * tail);
        ctx.stroke();
      }
    };

    const draw = (now: number) => {
      const t0 = performance.now();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const g = GUTTER / 2;
      // 1. idle outlines and corner crosses, batched
      ctx.globalAlpha = 1;
      ctx.beginPath();
      for (const l of leaves) ctx.roundRect(l.x + g + 0.5, l.y + g + 0.5, l.w - GUTTER - 1, l.h - GUTTER - 1, 4);
      ctx.strokeStyle = ink; ctx.lineWidth = 1; ctx.globalAlpha = 0.06; ctx.stroke();
      ctx.beginPath();
      for (const l of leaves) { // title-bar rule
        if (l.h > 56) { ctx.moveTo(l.x + g + 1, l.y + g + 16.5); ctx.lineTo(l.x + l.w - g - 1, l.y + g + 16.5); }
      }
      ctx.globalAlpha = 0.04; ctx.stroke();
      ctx.beginPath();
      const seen = new Set<number>();
      for (const l of leaves) {
        const key = l.x * 100003 + l.y;
        if (seen.has(key)) continue;
        seen.add(key);
        ctx.moveTo(l.x - 3, l.y + 0.5); ctx.lineTo(l.x + 4, l.y + 0.5);
        ctx.moveTo(l.x + 0.5, l.y - 3); ctx.lineTo(l.x + 0.5, l.y + 4);
      }
      ctx.globalAlpha = 0.13; ctx.stroke();
      // title labels (a short dash per pane)
      ctx.fillStyle = ink; ctx.globalAlpha = 0.09;
      for (const l of leaves) if (l.h > 56) ctx.fillRect(l.x + g + 22, l.y + g + 7, l.title, 2);
      // 2. active and hovered panes
      for (const l of leaves) {
        const px = l.x + g, py = l.y + g, pw = l.w - GUTTER, ph = l.h - GUTTER;
        if (l.hover > 0.01) {
          ctx.globalAlpha = 0.03 * l.hover; ctx.fillStyle = ink; ctx.beginPath(); ctx.roundRect(px, py, pw, ph, 4); ctx.fill();
          ctx.globalAlpha = 0.3 * l.hover; ctx.strokeStyle = accent; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(px + 0.5, py + 0.5, pw - 1, ph - 1, 4); ctx.stroke();
        }
        if (!l.kind) continue;
        const age = now - l.born;
        if (l.kind === "waiting") {
          ctx.globalAlpha = 0.22; ctx.strokeStyle = accent; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(px + 0.5, py + 0.5, pw - 1, ph - 1, 4); ctx.stroke();
          const p = (now % 1600) / 1600;
          if (!calm) { ctx.globalAlpha = 0.55 * (1 - p); ctx.beginPath(); ctx.arc(px + 10, py + 8.5, 3 + p * 6, 0, Math.PI * 2); ctx.stroke(); }
          ctx.globalAlpha = 1; ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(px + 10, py + 8.5, 3, 0, Math.PI * 2); ctx.fill();
        } else if (l.kind === "working") {
          ctx.globalAlpha = 0.14; ctx.strokeStyle = accent; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(px + 0.5, py + 0.5, pw - 1, ph - 1, 4); ctx.stroke();
          ring(px + 10, py + 8.5, now, !calm);
        } else {
          ctx.globalAlpha = 1; ctx.fillStyle = ember; ctx.beginPath(); ctx.arc(px + 10, py + 8.5, 3, 0, Math.PI * 2); ctx.fill();
        }
        // output lines under the title bar: they appear one by one while working, are complete when done
        if (ph > 56) {
          const lineY = py + 26;
          const avail = pw - 20;
          l.lines.forEach((len, i) => {
            const prog = l.kind === "working" ? Math.min(1, Math.max(0, (age - i * 900) / 1300)) : 1;
            if (prog <= 0) return;
            const y = lineY + i * 9;
            if (y + 3 > py + ph - 6) return;
            ctx.globalAlpha = l.kind === "waiting" ? 0.16 : 0.13;
            ctx.fillStyle = ink;
            ctx.fillRect(px + 10, y, avail * len * prog, 2);
            if (l.kind === "working" && prog < 1 && !calm) { ctx.globalAlpha = 0.7; ctx.fillStyle = accent; ctx.fillRect(px + 10 + avail * len * prog + 2, y - 1, 4, 4); }
          });
        }
      }
      ctx.globalAlpha = 1;
      spent += performance.now() - t0;
      if (import.meta.env.DEV && ++frames % 90 === 0) { canvas.dataset.frameMs = (spent / 90).toFixed(2); spent = 0; }
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 33) return; // ~30 fps
      last = now;
      step(now);
      draw(now);
    };
    const sync = () => {
      const run = inView && pageVisible && !calm;
      if (run && !raf) raf = requestAnimationFrame(loop);
      if (!run && raf) { cancelAnimationFrame(raf); raf = 0; }
    };

    build();
    const ro = new ResizeObserver(() => {
      const r = host.getBoundingClientRect();
      if (Math.abs(r.width - W) > 1 || Math.abs(r.height - H) > 1) build();
    });
    ro.observe(host);
    const io = new IntersectionObserver(([e]) => { inView = !!e?.isIntersecting; sync(); }, { rootMargin: "80px" });
    io.observe(canvas);
    const vis = () => { pageVisible = !document.hidden; sync(); };
    document.addEventListener("visibilitychange", vis);

    const move = (e: PointerEvent) => { const r = host.getBoundingClientRect(); pointer = { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const leave = () => { pointer = null; };
    if (fine) { host.addEventListener("pointermove", move, { passive: true }); host.addEventListener("pointerleave", leave); }

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect(); io.disconnect();
      document.removeEventListener("visibilitychange", vis);
      host.removeEventListener("pointermove", move); host.removeEventListener("pointerleave", leave);
    };
  }, [seed]);

  return <canvas ref={ref} className={`na-field${className ? ` ${className}` : ""}`} aria-hidden />;
}

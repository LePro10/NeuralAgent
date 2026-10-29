/**
 * Motion vocabulary. The dashboard grew 14 hand-typed spring pairs; they all
 * collapse into these seven. Pick by what moves, not by taste:
 *
 * - snap    indicators that follow a choice (segmented pill, lens, active row)
 * - toggle  tiny, quick parts (switch thumb, check)
 * - sheet   panels, sheets, expanders, page stacks — no overshoot
 * - pop     things that appear with a little life (bubbles, cards, menus)
 * - soft    staggered lists and tiles
 * - grow    data (bars, rings) — slower, so the eye can read the change
 * - bouncy  one hero entrance per screen (orb, big number)
 */
export const SPRING = {
  snap: { type: 'spring', stiffness: 520, damping: 44, mass: 1 },
  toggle: { type: 'spring', stiffness: 700, damping: 30, mass: 1 },
  sheet: { type: 'spring', stiffness: 420, damping: 42, mass: 1 },
  pop: { type: 'spring', stiffness: 420, damping: 32, mass: 1 },
  soft: { type: 'spring', stiffness: 300, damping: 30, mass: 1 },
  grow: { type: 'spring', stiffness: 220, damping: 26, mass: 1 },
  bouncy: { type: 'spring', stiffness: 260, damping: 22, mass: 1 },
} as const;

export type SpringName = keyof typeof SPRING;

/** Cubic-bezier arrays for motion's `ease` (same curves as the CSS tokens). */
export const EASE = {
  outSoft: [0.22, 1, 0.36, 1],
  inOutDraw: [0.65, 0, 0.35, 1],
  pf: [0.77, 0, 0.18, 1],
  bounceLand: [0.3, 0, 0.3, 1],
} as const;

/** Entrance for the i-th item of a list: rises 12px, staggered, capped so long lists don't crawl. */
export function rise(i: number, step = 0.05, max = 8) {
  return {
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.6, ease: EASE.outSoft, delay: Math.min(i, max) * step },
  } as const;
}

/**
 * Reduced motion: system setting or `.reduce-motion` on <html>. CSS handles
 * keyframes/transitions itself; anything animated in JS (springs, Web
 * Animations) must ask here and jump to the end instead.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return document.documentElement.classList.contains('reduce-motion') || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Sampling step of precomputed springs: 120 Hz, smooth on fast displays too. */
export const TICK = 1000 / 120;

/**
 * A spring as positions every TICK ms (semi-implicit Euler, 8 sub-steps).
 * Hand the result to `element.animate()` with `easing: 'linear'` and the
 * transition runs on the compositor — React renders or data arriving
 * mid-transition can no longer make it stutter. `v0` in units per second.
 */
export function springPoints(from: number, to: number, s: { stiffness: number; damping: number; mass?: number }, v0 = 0): number[] {
  const k = s.stiffness, c = s.damping, m = s.mass ?? 1;
  const h = TICK / 8 / 1000;
  const eps = Math.max(1e-4, Math.abs(to - from) * 5e-4);
  const pts = [from];
  let x = from, v = v0;
  for (let n = 0; n < 360; n++) {
    for (let i = 0; i < 8; i++) { v += ((-k * (x - to) - c * v) / m) * h; x += v * h; }
    pts.push(x);
    if (Math.abs(x - to) < eps && Math.abs(v) < eps * 10) break;
  }
  pts[pts.length - 1] = to;
  return pts;
}

/** Where a sampled run stands after `ms`, and its speed there (units per second). */
export function pointAt(pts: number[], ms: number) {
  const i = Math.min(pts.length - 1, Math.max(0, ms / TICK));
  const i0 = Math.floor(i), i1 = Math.min(pts.length - 1, i0 + 1);
  return { x: pts[i0] + (pts[i1] - pts[i0]) * (i - i0), v: ((pts[i1] - pts[i0]) / TICK) * 1000 };
}

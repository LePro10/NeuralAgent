/**
 * Start intro "point of light" (≈ 2.3 s). A template for any brand intro:
 * one gesture, one landing, then the product.
 *
 *   0.00  A point of light breathes once in the centre (where a native splash would show it).
 *   0.38  It travels to the left foot and draws the mark in one stroke.
 *   1.42  At the end of the right leg it lets go, drops onto its place, squashes,
 *         and sends a wave across the whole surface.
 *   1.65  The wave opens the product (the black plate fades); the mark flies to
 *         `flyTo` (e.g. the sidebar logo) or lifts away.
 *
 * Everything moves with Web Animations on transform/opacity; only the stroke
 * (stroke-dashoffset) runs on the main thread, once. A tap or any key skips.
 * Reduced motion: the finished mark, then a short cross-fade. It fills its
 * positioned parent (or the screen with `fullscreen`).
 */
import { useEffect, useId, useRef, type CSSProperties } from 'react';
import { cn } from '../../lib/cn';
import { prefersReducedMotion } from '../../lib/motion';
import { N_DOT, N_PATH } from './Logo';

/** The pen's route in stage pixels: centre → left foot → the n (offset-path has no viewBox). */
const penPath = (k: number) => `M${24 * k} ${24 * k}L${14.5 * k} ${37 * k}V${22.5 * k}a${9.5 * k} ${9.5 * k} 0 0 1 ${19 * k} 0v${6 * k}`;
const APPROACH = Math.hypot(24 - 14.5, 37 - 24);
const N_LENGTH = 14.5 + Math.PI * 9.5 + 6;
const SHARE = APPROACH / (APPROACH + N_LENGTH);
const T = { breathe: 380, approach: 240, draw: 800, drop: 300, wave: 950, fly: 620 };
const DRAW_AT = T.breathe + T.approach;
const DROP_AT = DRAW_AT + T.draw;
const WAVE_AT = DROP_AT + T.drop - 70;
const DRAW_EASE = 'cubic-bezier(.65,0,.35,1)';

export function LogoIntro({ onDone, fullscreen, word = 'NeuralHub', flyTo, size = 'min(34vmin, 176px)', className }: {
  onDone?: () => void;
  fullscreen?: boolean;
  /** Spaced mono word under the mark; empty to hide. */
  word?: string;
  /** Element the mark flies into at the end (a logo in the chrome). */
  flyTo?: () => HTMLElement | null;
  /** Stage size (CSS length). */
  size?: string;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const id = useId().replace(/:/g, '');
  const done = useRef(onDone);
  done.current = onDone;
  const fly = useRef(flyTo);
  fly.current = flyTo;

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const $ = <E extends Element>(s: string) => el.querySelector<E>(s)!;
    const plate = $<HTMLElement>('[data-i=plate]'), stage = $<HTMLElement>('[data-i=stage]');
    const pen = $<HTMLElement>('[data-i=pen]'), core = $<HTMLElement>('[data-i=core]');
    const stroke = $<SVGPathElement>('[data-i=stroke]'), halo = $<SVGCircleElement>('[data-i=halo]');
    const glow = $<HTMLElement>('[data-i=glow]'), ring = $<HTMLElement>('[data-i=ring]');
    const wave = $<HTMLElement>('[data-i=wave]'), label = $<HTMLElement>('[data-i=word]');
    const anims: Animation[] = [];
    const timers: number[] = [];
    let finished = false;
    const end = () => { if (finished) return; finished = true; timers.forEach(clearTimeout); done.current?.(); };

    const box0 = el.getBoundingClientRect();
    const s = stage.getBoundingClientRect().width;
    const k = s / 48;

    if (prefersReducedMotion()) {
      stroke.style.strokeDashoffset = '0'; stroke.style.opacity = '1'; halo.style.opacity = '1';
      pen.style.transform = `translate(calc(${N_DOT.cx * k}px - 50%), calc(${N_DOT.cy * k}px - 50%))`;
      const a = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 380, delay: 420, easing: 'ease', fill: 'forwards' });
      a.finished.then(end, end);
      return () => a.cancel();
    }

    // 1 · breathe, 2 · approach and draw: the pen follows the path, the stroke grows with it.
    Object.assign(pen.style, { offsetPath: `path("${penPath(k)}")`, offsetAnchor: '50% 50%', offsetRotate: '0deg', transform: 'none' });
    anims.push(pen.animate([
      { offsetDistance: '0%', offset: 0 },
      { offsetDistance: '0%', offset: T.breathe / DROP_AT, easing: 'cubic-bezier(.5,0,.3,1)' },
      { offsetDistance: `${SHARE * 100}%`, offset: DRAW_AT / DROP_AT, easing: DRAW_EASE },
      { offsetDistance: '100%', offset: 1 },
    ], { duration: DROP_AT, fill: 'forwards' }));
    anims.push(core.animate([
      { scale: '1', offset: 0 }, { scale: '1.35', offset: 0.45, easing: 'cubic-bezier(.3,0,.2,1)' }, { scale: '1', offset: 1 },
    ], { duration: T.breathe, easing: 'cubic-bezier(.5,0,.3,1)' }));
    anims.push(glow.animate([{ opacity: 0.35, scale: '.6' }, { opacity: 1, scale: '1.1', offset: 0.3 }, { opacity: 0.55, scale: '1' }],
      { duration: T.breathe + 400, easing: 'ease-out', fill: 'forwards' }));
    // Invisible until the first bit of stroke: a zero-length stroke would show its round cap.
    anims.push(stroke.animate([{ strokeDashoffset: 1, opacity: 0 }, { opacity: 1, offset: 0.02 }, { strokeDashoffset: 0, opacity: 1 }],
      { duration: T.draw, delay: DRAW_AT, easing: DRAW_EASE, fill: 'both' }));
    if (word) anims.push(label.animate([{ opacity: 0, letterSpacing: '.7em' }, { opacity: 0.7, letterSpacing: '.34em', offset: 0.55 }, { opacity: 0, letterSpacing: '.3em' }],
      { duration: 1100, delay: DRAW_AT + 260, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'both' }));

    // 3 · drop from the end of the leg (y 28.5) onto the dot, squash, settle.
    const fall = (N_DOT.cy - 28.5) * k;
    const dropT = { duration: T.drop + 160, delay: DROP_AT, fill: 'forwards' as const };
    anims.push(pen.animate([
      { translate: '0 0', offset: 0 }, { translate: '0 0', offset: 0.12, easing: 'cubic-bezier(.55,0,1,.45)' },
      { translate: `0 ${fall}px`, offset: 0.52, easing: 'cubic-bezier(.2,0,.3,1)' }, { translate: `0 ${fall + 1}px`, offset: 0.7, easing: 'cubic-bezier(.3,0,.3,1)' },
      { translate: `0 ${fall - 3}px`, offset: 0.86 }, { translate: `0 ${fall}px`, offset: 1 },
    ], dropT));
    anims.push(core.animate([
      { scale: '1', transformOrigin: '50% 100%', offset: 0 }, { scale: '1.08 .92', offset: 0.12 }, { scale: '.86 1.16', offset: 0.52 },
      { scale: '1.34 .66', offset: 0.7 }, { scale: '.96 1.05', offset: 0.86 }, { scale: '1', transformOrigin: '50% 100%', offset: 1 },
    ], dropT));
    anims.push(ring.animate([{ opacity: 0.9, scale: '.6' }, { opacity: 0, scale: '3.4' }], { duration: 700, delay: WAVE_AT, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' }));
    anims.push(halo.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 380, delay: WAVE_AT, easing: 'ease-out', fill: 'forwards' }));

    // 4 · a wave across the surface; the plate lets the product through.
    const st = stage.getBoundingClientRect();
    const dotX = st.left - box0.left + N_DOT.cx * k, dotY = st.top - box0.top + N_DOT.cy * k;
    const reach = Math.hypot(Math.max(dotX, box0.width - dotX), Math.max(dotY, box0.height - dotY));
    Object.assign(wave.style, { left: `${dotX}px`, top: `${dotY}px` });
    anims.push(wave.animate([{ opacity: 0, scale: '.02' }, { opacity: 1, scale: '.06', offset: 0.06 }, { opacity: 0, scale: String((reach * 2.1) / 80) }],
      { duration: T.wave, delay: WAVE_AT, easing: 'cubic-bezier(.2,.65,.2,1)', fill: 'both' }));
    anims.push(plate.animate([{ opacity: 1 }, { opacity: 0 }], { duration: T.wave * 0.7, delay: WAVE_AT + 90, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' }));
    timers.push(window.setTimeout(() => { el.style.pointerEvents = 'none'; }, WAVE_AT));

    // 5 · the mark flies into the chrome's logo, or lifts away.
    timers.push(window.setTimeout(() => {
      const to = fly.current?.()?.getBoundingClientRect();
      const from = stage.getBoundingClientRect();
      const frames: Keyframe[] = to && to.width > 0
        ? [{ transform: 'none' }, { transform: `translate(${to.left + to.width / 2 - (from.left + from.width / 2)}px, ${to.top + to.height / 2 - (from.top + from.height / 2)}px) scale(${to.width / from.width})` }]
        : [{ transform: 'none', opacity: 1 }, { transform: `translateY(${-box0.height * 0.22}px) scale(.5)`, opacity: 0 }];
      const flight = stage.animate(frames, { duration: T.fly, easing: 'cubic-bezier(.7,0,.2,1)', fill: 'forwards' });
      anims.push(flight, glow.animate([{ opacity: 0.55 }, { opacity: 0 }], { duration: T.fly * 0.6, fill: 'forwards' }));
      flight.finished.then(() => el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' }).finished.then(end, end), end);
    }, WAVE_AT + 260));

    const skip = () => {
      if (finished) return;
      el.style.pointerEvents = 'none';
      el.animate([{ opacity: getComputedStyle(el).opacity }, { opacity: 0 }], { duration: 220, fill: 'forwards' }).finished.then(end, end);
    };
    el.addEventListener('pointerdown', skip);
    window.addEventListener('keydown', skip, { once: true });
    return () => {
      el.removeEventListener('pointerdown', skip);
      window.removeEventListener('keydown', skip);
      timers.forEach(clearTimeout);
      anims.forEach((a) => a.cancel());
    };
  }, [word]);

  const dot = `calc(var(--s) * 5.8 / 48)`;
  return (
    <div ref={root} aria-hidden="true" className={cn(fullscreen ? 'fixed' : 'absolute', 'inset-0 z-[var(--z-intro)] cursor-default overflow-hidden', className)} style={{ ['--s' as string]: size } as CSSProperties}>
      <div data-i="plate" className="absolute inset-0 bg-bg" />
      <div data-i="wave" className="absolute h-20 w-20 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-0"
        style={{ border: '1px solid color-mix(in oklab, var(--color-accent) 42%, transparent)', boxShadow: '0 0 36px 4px color-mix(in oklab, var(--color-accent) 14%, transparent), inset 0 0 28px color-mix(in oklab, var(--color-accent) 10%, transparent)' }} />
      <div data-i="stage" className="absolute top-1/2 left-1/2" style={{ width: 'var(--s)', height: 'var(--s)', margin: 'calc(var(--s) / -2) 0 0 calc(var(--s) / -2)' }}>
        <div data-i="glow" className="absolute -inset-[60%] rounded-full opacity-35"
          style={{ scale: '.6', background: 'radial-gradient(circle, color-mix(in oklab, var(--color-accent) 22%, transparent), color-mix(in oklab, var(--color-accent-deep) 8%, transparent) 40%, transparent 68%)' }} />
        <svg viewBox="0 0 48 48" className="absolute inset-0 h-full w-full overflow-visible">
          <defs>
            <linearGradient id={`ink${id}`} gradientUnits="userSpaceOnUse" x1="36" y1="12" x2="13" y2="40"><stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#a9b2ac" /></linearGradient>
            <radialGradient id={`halo${id}`} cx=".5" cy=".5" r=".5">
              <stop offset="0" style={{ stopColor: 'var(--color-accent)', stopOpacity: 0.75 }} />
              <stop offset=".45" style={{ stopColor: 'var(--color-accent)', stopOpacity: 0.18 }} />
              <stop offset="1" style={{ stopColor: 'var(--color-accent)', stopOpacity: 0 }} />
            </radialGradient>
          </defs>
          <circle data-i="halo" cx={N_DOT.cx} cy={N_DOT.cy} r="10" fill={`url(#halo${id})`} opacity="0" />
          <path data-i="stroke" d={N_PATH} pathLength={1} fill="none" stroke={`url(#ink${id})`} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1" strokeDashoffset="1" opacity="0" />
        </svg>
        <span data-i="ring" className="absolute box-border rounded-full opacity-0"
          style={{ width: dot, height: dot, left: `calc(var(--s) * 30.6 / 48)`, top: `calc(var(--s) * 32.7 / 48)`, border: '1.5px solid color-mix(in oklab, var(--color-accent) 80%, transparent)' }} />
        <span data-i="pen" className="absolute top-0 left-0 rounded-full" style={{ width: dot, height: dot, transform: 'translate(calc(var(--s) / 2 - 50%), calc(var(--s) / 2 - 50%))' }}>
          <i data-i="core" className="absolute inset-0 rounded-full bg-white"
            style={{ boxShadow: '0 0 calc(var(--s) * .08) color-mix(in oklab, var(--color-accent) 90%, transparent), 0 0 calc(var(--s) * .22) color-mix(in oklab, var(--color-accent) 35%, transparent)' }} />
        </span>
      </div>
      {word && (
        <div data-i="word" className="absolute inset-x-0 text-center font-mono text-[11px] tracking-[.7em] text-accent uppercase opacity-0"
          style={{ top: 'calc(50% + var(--s) / 2 + 28px)' }}>{word}</div>
      )}
    </div>
  );
}

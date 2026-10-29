/**
 * NeuralHub mark "n.": one monoline stroke and a dot. The right leg stops
 * short and the dot completes it; the dot is the only light, so the stroke
 * brightens towards it (white at the dot, grey at the left foot).
 *
 * Use it as the template for any product mark: one stroke, one point of
 * light, a single playful reaction on hover — and stillness at rest.
 *
 * Motion: pointing at the mark makes the dot hop once, like a ball off the
 * foot, squashing on landing and sending out a small ring. The hop is a Web
 * Animation on HTML elements (transform/opacity only, compositor), started on
 * pointerenter and always played to the end, so leaving mid-hop never makes
 * it jump. At rest nothing moves (DASHBOARD.md § 3.2).
 *
 * The geometry (viewBox 48) is shared by every place that draws the mark
 * (intro, login, favicon, app icon) — change it everywhere together.
 */
import { useEffect, useId, useRef } from 'react';
import { prefersReducedMotion } from '../../lib/motion';

/** The n, as one path in a 48 × 48 box. */
export const N_PATH = 'M14.5 37V22.5a9.5 9.5 0 0 1 19 0v6';
/** The dot below the right leg. */
export const N_DOT = { cx: 33.5, cy: 35.6, r: 2.9 } as const;

/** Dot box in percent of the mark, for HTML layers placed over the SVG. */
const DOT_BOX = {
  left: `${((N_DOT.cx - N_DOT.r) / 48) * 100}%`,
  top: `${((N_DOT.cy - N_DOT.r) / 48) * 100}%`,
  size: `${((2 * N_DOT.r) / 48) * 100}%`,
};

// Translate percentages refer to the dot itself: -190 % is a jump of ~2 dot heights.
const HOP: Keyframe[] = [
  { transform: 'none', offset: 0 },
  { transform: 'translateY(6%) scale(1.28, .72)', offset: .14 },
  { transform: 'translateY(-190%) scale(.88, 1.14)', offset: .42 },
  { transform: 'translateY(0) scale(1.32, .68)', offset: .66 },
  { transform: 'translateY(-32%) scale(.96, 1.05)', offset: .8 },
  { transform: 'none', offset: 1 },
];
const RING: Keyframe[] = [
  { opacity: .9, transform: 'scale(.6)' },
  { opacity: 0, transform: 'scale(3.2)' },
];

/** The stroke gradient and halo, shared by every place that draws the mark. */
export function MarkDefs({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={`ink${id}`} gradientUnits="userSpaceOnUse" x1="36" y1="12" x2="13" y2="40">
        <stop offset="0" stopColor="#ffffff" />
        <stop offset="1" stopColor="#a9b2ac" />
      </linearGradient>
      <radialGradient id={`halo${id}`} cx=".5" cy=".5" r=".5">
        <stop offset="0" style={{ stopColor: "var(--color-accent)", stopOpacity: .75 }} />
        <stop offset=".45" style={{ stopColor: "var(--color-accent)", stopOpacity: .18 }} />
        <stop offset="1" style={{ stopColor: "var(--color-accent)", stopOpacity: 0 }} />
      </radialGradient>
    </defs>
  );
}

export function LogoMark({ size = 24, className = '' }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, '');
  const ref = useRef<HTMLSpanElement>(null);
  const dotRef = useRef<HTMLSpanElement>(null);
  const ringRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current, dot = dotRef.current, ring = ringRef.current;
    if (!el || !dot || !ring) return;
    // The whole button reacts, not just the 24 px mark.
    const trigger = el.closest<HTMLElement>('.group') ?? el;
    let hop: Animation | null = null;
    const play = () => {
      if (hop?.playState === 'running') return;
      if (prefersReducedMotion()) return;
      hop = dot.animate(HOP, { duration: 850, easing: 'cubic-bezier(.3,0,.3,1)' });
      ring.animate(RING, { duration: 700, delay: 520, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'backwards' });
    };
    const onFocus = (e: FocusEvent) => { if ((e.target as HTMLElement).matches(':focus-visible')) play(); };
    trigger.addEventListener('pointerenter', play);
    trigger.addEventListener('focusin', onFocus);
    return () => {
      trigger.removeEventListener('pointerenter', play);
      trigger.removeEventListener('focusin', onFocus);
    };
  }, []);

  return (
    <span ref={ref} className={`relative block shrink-0 ${className}`} style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 48 48" className="absolute inset-0 h-full w-full overflow-visible">
        <MarkDefs id={id} />
        <circle cx={N_DOT.cx} cy={N_DOT.cy} r="10" fill={`url(#halo${id})`} />
        <path d={N_PATH} fill="none" stroke={`url(#ink${id})`} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span
        ref={ringRef}
        className="absolute rounded-full border-hair border-accent/80 opacity-0"
        style={{ left: DOT_BOX.left, top: DOT_BOX.top, width: DOT_BOX.size, height: DOT_BOX.size }}
      />
      <span
        ref={dotRef}
        className="absolute rounded-full bg-white shadow-[0_0_6px_color-mix(in_oklab,var(--color-accent)_60%,transparent)]"
        style={{ left: DOT_BOX.left, top: DOT_BOX.top, width: DOT_BOX.size, height: DOT_BOX.size, transformOrigin: '50% 100%' }}
      />
    </span>
  );
}

export function Wordmark({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <span style={style} className={`text-body font-medium tracking-[-.02em] whitespace-nowrap text-bright ${className}`}>
      Neural<span className="text-dim">Hub</span>
    </span>
  );
}

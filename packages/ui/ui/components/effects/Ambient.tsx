/**
 * Ambient light at the top of a page: soft, two- or three-coloured light that
 * sinks into the background and fades out as you scroll.
 *
 * It is an inline SVG — five radial lights and one fade — not a shader and not
 * an image: about 1 KB, sharp at any size, no WebGL context, no network, no
 * grain. The lights sit where the dashboard's mesh gradient put them
 * (AMBIENT_POSE) and fall off like its Gaussian, so the colours and the
 * composition read the same. Colours come straight from AMBIENT, so a place
 * keeps its light and a custom palette is one array away.
 *
 * Optional motion moves only the SVG as a whole (transform, compositor) and
 * rests in rest mode / with reduced motion.
 */
import { motion, useMotionValue, useTransform, type MotionValue } from 'motion/react';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { AMBIENT, AMBIENT_POSE, type AmbientName } from '../../lib/tokens';
import { cn } from '../../lib/cn';

/** Gaussian falloff sampled for the gradient stops: exp(-K·(o·R)²). */
const R = 0.9, K = 4.2;
const STOPS = [0, 0.2, 0.4, 0.6, 0.8, 1].map((o) => [o, Math.exp(-K * (o * R) ** 2)] as const);
/** Dark lights first, so the bright ones sit on top. */
const ORDER = [4, 0, 1, 2, 3];

export type AmbientMotion = 'still' | 'breathe' | 'drift';

export function Ambient({ name = 'home', colors, scrollY, height = 'min(60dvh, 520px)', intensity = 1, motion: move = 'still', className }: {
  name?: AmbientName;
  /** Five stops, dark → mid → dark. Overrides `name`. */
  colors?: readonly string[];
  /** Scroll position of the page; the light fades out over 360px. */
  scrollY?: MotionValue<number>;
  height?: string;
  /** 0–1, scales the strength of the coloured lights. */
  intensity?: number;
  /** A slow, cheap motion of the whole light. */
  motion?: AmbientMotion;
  className?: string;
}) {
  const id = useId().replace(/:/g, '');
  const box = useRef<HTMLDivElement>(null);
  const [aspect, setAspect] = useState(390 / 506);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => { const { width, height: h } = e.contentRect; if (width && h) setAspect(width / h); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const still = useMotionValue(0);
  const opacity = useTransform(scrollY ?? still, [0, 360], [1, 0]);

  const c = colors ?? AMBIENT[name];
  // The shader measured from the short edge: ±0.6 there, the long side shows more of the field.
  const hw = aspect >= 1 ? 0.6 * aspect : 0.6, hh = aspect >= 1 ? 0.6 : 0.6 / aspect;
  const rect = { x: -hw, y: -hh, width: 2 * hw, height: 2 * hh };

  return (
    <motion.div ref={box} aria-hidden="true" className={cn('pointer-events-none absolute inset-x-0 top-0 overflow-hidden', className)} style={{ opacity, height }}>
      <svg className={cn('absolute inset-0 h-full w-full', move !== 'still' && `ambient-${move} deko`)} viewBox={`${rect.x} ${rect.y} ${rect.width} ${rect.height}`} preserveAspectRatio="none">
        <defs>
          {ORDER.map((i) => (
            <radialGradient key={i} id={`${id}l${i}`} gradientUnits="userSpaceOnUse" cx={AMBIENT_POSE[i][0]} cy={AMBIENT_POSE[i][1]} r={R}>
              {STOPS.map(([o, a]) => <stop key={o} offset={o} stopColor={c[i]} stopOpacity={i === 0 || i === 4 ? a : a * intensity} />)}
            </radialGradient>
          ))}
          {/* Into the page colour, as the content begins. */}
          <linearGradient id={`${id}f`} x1="0" y1="0" x2="0" y2="1">
            {[[0, 0.2], [0.45, 0.62], [0.78, 0.93], [1, 1]].map(([o, a]) => <stop key={o} offset={o} style={{ stopColor: 'var(--color-bg)', stopOpacity: a }} />)}
          </linearGradient>
        </defs>
        <rect {...rect} fill={c[0]} />
        {ORDER.map((i) => <rect key={i} {...rect} fill={`url(#${id}l${i})`} />)}
        <rect {...rect} fill={`url(#${id}f)`} />
      </svg>
    </motion.div>
  );
}

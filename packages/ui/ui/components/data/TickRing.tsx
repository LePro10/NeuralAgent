/**
 * Tick ring: a dial of 60 hairline ticks that light up one after another,
 * like an instrument — with a mono readout counting in step. The last lit
 * tick wears the place's signal colour, so the eye lands on "where it is".
 * More precise than a filled ring; use it for one hero figure per screen.
 *
 * Lights once when it scrolls into view, then follows `value`. Only the
 * stroke colour of single ticks changes (no layout); reduced motion jumps.
 */
import { useInView } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { prefersReducedMotion } from '../../lib/motion';

export function TickRing({ value, size = 168, ticks = 60, step = 12, readout, caption, label, className }: {
  /** 0–1. */
  value: number;
  size?: number;
  ticks?: number;
  /** Milliseconds between two ticks lighting. */
  step?: number;
  /** Centre text for a share 0–1 (default: percent). */
  readout?: (share: number) => ReactNode;
  /** Small uppercase line under the readout. */
  caption?: string;
  label?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, { once: true, margin: '-10% 0px' });
  const target = Math.round(Math.max(0, Math.min(1, value)) * ticks);
  const [lit, setLit] = useState(0);
  const litRef = useRef(0);

  useEffect(() => {
    if (!seen) return;
    if (prefersReducedMotion()) { litRef.current = target; setLit(target); return; }
    let raf = 0, last = performance.now(), acc = 0;
    const tick = (t: number) => {
      acc += t - last; last = t;
      while (acc >= step && litRef.current !== target) { acc -= step; litRef.current += litRef.current < target ? 1 : -1; }
      setLit(litRef.current);
      if (litRef.current !== target) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [seen, target, step]);

  const c = size / 2, r1 = size * 0.41, rMinor = size * 0.455, rMajor = size * 0.475;
  const share = lit / ticks;
  return (
    <div ref={ref} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}
      className={cn('relative grid shrink-0 place-items-center', className)} style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="absolute inset-0" aria-hidden="true">
        {Array.from({ length: ticks }, (_, i) => {
          const a = (i / ticks) * Math.PI * 2 - Math.PI / 2, r2 = i % 5 === 0 ? rMajor : rMinor;
          const on = i < lit;
          return (
            <line key={i} x1={c + Math.cos(a) * r1} y1={c + Math.sin(a) * r1} x2={c + Math.cos(a) * r2} y2={c + Math.sin(a) * r2}
              strokeWidth={size / 110} strokeLinecap="round"
              style={{ stroke: on ? (i === lit - 1 ? 'var(--color-tab)' : 'var(--color-bright)') : 'var(--color-fill-4)', transition: 'stroke .25s' }} />
          );
        })}
      </svg>
      <div className="relative text-center">
        <div className="tabular font-mono leading-none tracking-[-.03em] text-bright" style={{ fontSize: size * 0.19 }}>{readout ? readout(share) : Math.round(share * 100)}</div>
        {caption && <div className="eyebrow mt-1.5" style={{ fontSize: Math.max(8, size * 0.052) }}>{caption}</div>}
      </div>
    </div>
  );
}

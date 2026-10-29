/**
 * Progress ring. One component for what used to be four (Home, charts,
 * screen time, timer) with different strokes and colliding gradient ids.
 * Thin by default, in the place's signal colour (--color-tab). The gradient
 * id is unique per instance; the ring fills once when it scrolls into view
 * (or immediately with `immediate`).
 */
import { motion, useInView } from 'motion/react';
import { useId, useRef, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { EASE } from '../../lib/motion';

export function Ring({ value, size = 64, stroke = 4, colors = 'var(--color-tab)', track = 'var(--color-fill-3)', children, caption, immediate, duration = 1.1, className, label }: {
  /** 0–1. Values above 1 are drawn full. */
  value: number;
  size?: number;
  /** Stroke width in px at the given size. */
  stroke?: number;
  /** One colour, or a gradient along the arc. */
  colors?: string | string[];
  track?: string;
  /** Centre content (value). */
  children?: ReactNode;
  /** Small line under the centre content. */
  caption?: string;
  immediate?: boolean;
  /** Seconds to fill. */
  duration?: number;
  className?: string;
  /** Accessible name, e.g. "Weekly goal". */
  label?: string;
}) {
  const id = useId().replace(/:/g, '');
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useInView(ref, { once: true, margin: '-10% 0px' });
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  const list = Array.isArray(colors) ? colors : [colors];
  const paint = list.length > 1 ? `url(#ring${id})` : list[0];
  return (
    <span ref={ref} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)}
      className={cn('relative inline-grid shrink-0 place-items-center', className)} style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90" aria-hidden="true">
        {list.length > 1 && (
          <defs>
            <linearGradient id={`ring${id}`} x1="0" y1="0" x2="1" y2="1">
              {list.map((col, i) => <stop key={i} offset={i / (list.length - 1)} style={{ stopColor: col }} />)}
            </linearGradient>
          </defs>
        )}
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={paint} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c}
          initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: immediate || seen ? c * (1 - v) : c }} transition={{ duration, ease: EASE.outSoft }} />
      </svg>
      {(children !== undefined || caption) && (
        <span className="relative text-center leading-tight">
          {children !== undefined && <span className="tabular block font-light tracking-[-.02em] text-bright" style={{ fontSize: Math.max(11, size * 0.22) }}>{children}</span>}
          {caption && <span className="block text-dim" style={{ fontSize: Math.max(9, size * 0.12) }}>{caption}</span>}
        </span>
      )}
    </span>
  );
}

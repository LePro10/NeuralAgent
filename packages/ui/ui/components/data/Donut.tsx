/**
 * Donut: shares of a whole. Segments keep small gaps and round ends, and draw
 * in one after another. The centre carries the total; the parts get a legend
 * (colour alone never carries meaning).
 */
import { motion } from 'motion/react';
import { cn } from '../../lib/cn';
import { EASE } from '../../lib/motion';
import { Legend } from './Legend';

export interface DonutPart { value: number; color: string; label?: string }

export function Donut({ parts, center, sub, size = 104, thickness = 7, gap = 3, legend = true, className }: {
  parts: DonutPart[];
  center?: string;
  sub?: string;
  size?: number;
  /** Ring thickness in viewBox units (of 100). */
  thickness?: number;
  /** Gap between segments in viewBox units. */
  gap?: number;
  legend?: boolean;
  className?: string;
}) {
  const total = Math.max(1e-9, parts.reduce((a, p) => a + p.value, 0));
  const r = 50 - thickness / 2 - 2, c = 2 * Math.PI * r;
  const offsets = parts.map((_, i) => parts.slice(0, i).reduce((a, p) => a + (p.value / total) * c, 0));
  return (
    <div className={cn('flex items-center gap-5', className)}>
      <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={parts.map((p) => `${p.label ?? ''} ${Math.round((p.value / total) * 100)}%`).join(', ')}>
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden="true">
          <circle cx="50" cy="50" r={r} fill="none" stroke="var(--color-fill-2)" strokeWidth={thickness} />
          {parts.map((p, i) => {
            const len = Math.max(0, (p.value / total) * c - gap);
            return (
              <motion.circle key={i} cx="50" cy="50" r={r} fill="none" stroke={p.color} strokeWidth={thickness} strokeLinecap={len > thickness ? 'round' : 'butt'}
                strokeDasharray={`${len} ${c}`} initial={{ strokeDashoffset: -offsets[i] + len, opacity: 0 }} animate={{ strokeDashoffset: -offsets[i], opacity: 1 }}
                transition={{ delay: 0.1 + i * 0.12, duration: 0.8, ease: EASE.outSoft }} />
            );
          })}
        </svg>
        {(center || sub) && (
          <div className="absolute inset-0 grid place-content-center text-center">
            {center && <span className="tabular text-body font-light text-bright">{center}</span>}
            {sub && <span className="text-tiny text-dim">{sub}</span>}
          </div>
        )}
      </div>
      {legend && parts.some((p) => p.label) && <Legend series={parts.filter((p) => p.label).map((p) => ({ name: p.label!, color: p.color }))} className="flex-col !gap-y-1.5" />}
    </div>
  );
}

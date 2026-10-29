/**
 * Figures. `Stat` is the small tile (a value over a label, in rows of 2–3);
 * `Trend` the little pill beside a big number.
 */
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export function Stat({ value, label, unit, trend, children, className }: {
  value: ReactNode; label: string; unit?: string;
  /** Change vs. the previous period, e.g. +12 or -3 (%). */
  trend?: number;
  /** Extra visual under the label (a sparkline). */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('card !rounded-stat px-3.5 py-3', className)}>
      <div className="flex items-baseline gap-1">
        <span className="tabular text-title font-light tracking-[-.02em] text-bright">{value}</span>
        {unit && <span className="text-meta text-dim">{unit}</span>}
        {trend !== undefined && <Trend value={trend} className="ml-auto" />}
      </div>
      <div className="mt-0.5 truncate text-meta text-dim">{label}</div>
      {children && <div className="mt-2.5">{children}</div>}
    </div>
  );
}

/** Up is mint, down is ember — unless `inverse` (fewer hours of screen time is good). */
export function Trend({ value, inverse, className }: { value: number; inverse?: boolean; className?: string }) {
  const up = value >= 0;
  const good = inverse ? !up : up;
  const I = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn('inline-flex items-center gap-px text-meta tabular', good ? 'text-mint' : 'text-ember', className)}>
      <I size={12} strokeWidth={2} />{Math.abs(value)}%
    </span>
  );
}

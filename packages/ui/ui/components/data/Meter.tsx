/**
 * Usage meter: a thin bar that says how much of something is used. One
 * component for the seven progress bars the dashboard grew.
 *
 * Colour follows the fill, not the caller: below `warn` it is calm (the
 * place's signal colour, or mono), from `warn` ember, at or above 100 %
 * danger. A tiny value still shows a sliver (min 1.5 %), so "used, a
 * little" never reads as "empty". 4px, or 3px small.
 */
import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { EASE } from '../../lib/motion';

export function Meter({ value, max = 1, warn = 0.8, variant = 'tab', size = 'md', label, detail, className }: {
  value: number;
  max?: number;
  /** Share (0–1) from which the meter turns ember. */
  warn?: number;
  /** tab: the place's signal colour (goals, time). mono: quiet white (quotas, storage). */
  variant?: 'tab' | 'mono';
  size?: 'sm' | 'md';
  /** Left label above the bar. */
  label?: ReactNode;
  /** Right text above the bar ("3.2 of 5 GB"). */
  detail?: ReactNode;
  className?: string;
}) {
  const share = max > 0 ? value / max : 0;
  const shown = share <= 0 ? 0 : Math.min(1, Math.max(0.015, share));
  const fill = share >= 1 ? 'var(--color-danger)'
    : share >= warn ? 'var(--color-ember)'
    : variant === 'mono' ? 'rgb(255 255 255 / .6)'
    : 'var(--color-tab)';
  return (
    <div className={className}>
      {(label || detail) && (
        <div className="mb-1.5 flex items-baseline justify-between gap-3 text-meta">
          <span className="truncate text-ink">{label}</span>
          <span className="tabular shrink-0 text-dim">{detail}</span>
        </div>
      )}
      <div role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={typeof label === 'string' ? label : undefined}
        className={cn('relative overflow-hidden rounded-full bg-fill-3', size === 'sm' ? 'h-[3px]' : 'h-1')}>
        <motion.span className="absolute inset-y-0 left-0 rounded-full transition-[background-color] duration-300" style={{ background: fill }}
          initial={{ width: 0 }} animate={{ width: `${shown * 100}%` }} transition={{ duration: 0.8, ease: EASE.outSoft }} />
      </div>
    </div>
  );
}

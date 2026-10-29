/**
 * Bar chart you can scrub. Thin bars (max 14px) with round ends, a quiet
 * dashed hairline average, labels in mono. The bar you look at wears the
 * place's signal colour (--color-tab). The headline above shows the value
 * under the finger or pointer, else the pinned bar, else `highlight`.
 *
 * - `values` is `number[]` (one series) or `number[][]` (stacked: values[i][s]).
 * - One series is monochrome: the shown bar is bright, the rest recede.
 *   Stacked series take their colours and get a legend.
 * - `future`: bars from this index on are still to come (drawn as ghosts).
 *
 * Unifies the dashboard's two scrub charts (progress columns, screen time).
 */
import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { SPRING } from '../../lib/motion';
import { Legend, type Series } from './Legend';
import { num, useScrub } from './scrub';

export function BarChart({ values, labels, title, series, unit = '', format = num, highlight, future = Infinity, average = true, height = 140, action, className }: {
  values: number[] | number[][];
  labels: string[];
  /** Line under the headline for bar i ("Tue, 14 Oct"). */
  title?: (i: number) => string;
  /** Stacked series names and colours (default: one monochrome series). */
  series?: Series[];
  unit?: string;
  format?: (v: number) => string;
  highlight?: number;
  future?: number;
  average?: boolean;
  /** Bar area height in px. */
  height?: number;
  /** Slot at the top right for the shown index ("Open day" button). */
  action?: (i: number) => ReactNode;
  className?: string;
}) {
  const rows: number[][] = values.map((v) => (Array.isArray(v) ? v : [v]));
  const n = rows.length;
  const sums = rows.map((r) => r.reduce((a, b) => a + b, 0));
  const max = Math.max(1, ...sums);
  const past = sums.filter((_, i) => i < future);
  const avg = past.filter(Boolean).length ? past.reduce((a, b) => a + b, 0) / past.filter(Boolean).length : 0;
  const { hover, active, handlers } = useScrub(n);
  const i = Math.max(0, Math.min(n - 1, active ?? highlight ?? Math.min(n, future) - 1));
  const stacked = rows.some((r) => r.length > 1) || (series?.length ?? 0) > 1;
  const dense = n > 40;
  const gap = dense ? 'gap-px' : 'gap-[3px] @min-[600px]:gap-1.5';

  return (
    <div className={cn('@container', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="tabular text-title font-light tracking-[-.02em] text-bright">{i >= future ? '–' : format(sums[i] ?? 0)}<span className="ml-1 text-meta text-dim">{unit}</span></div>
          {title && <div className="mt-0.5 truncate text-detail text-dim">{title(i)}{stacked && series && (sums[i] ?? 0) > 0 && <span> · {series.map((s, k) => `${s.name} ${format(rows[i][k] ?? 0)}`).join(' · ')}</span>}</div>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {average && avg > 0 && <span className="flex items-center gap-1.5 text-meta text-dim"><i className="w-3.5 border-t-hair border-dashed border-dim" />avg {format(sums.every(Number.isInteger) ? Math.round(avg) : Math.round(avg * 10) / 10)}</span>}
          {action?.(i)}
        </div>
      </div>
      <div data-no-swipe className={cn('relative mt-4 flex touch-pan-y items-end select-none', gap)} style={{ height }} {...handlers}>
        {average && avg > 0 && <div className="pointer-events-none absolute inset-x-0 border-t-hair border-dashed border-white/20" style={{ bottom: `${(avg / max) * 100}%` }} />}
        {rows.map((r, k) => {
          const on = k === i;
          const ahead = k >= future;
          const h = `${Math.max(sums[k] ? 3 : 1.5, (sums[k] / max) * 100)}%`;
          return (
            <div key={k} className="flex h-full flex-1 flex-col items-center justify-end">
              <motion.div
                className={cn('flex w-full max-w-[14px] flex-col-reverse overflow-hidden transition-[opacity,background-color] duration-200', stacked ? 'gap-[2px] rounded-t-[4px] rounded-b-[2px]' : 'rounded-full')}
                initial={{ height: 0 }}
                animate={{ height: h }}
                transition={{ ...SPRING.grow, delay: k * (0.35 / n) }}
                style={stacked
                  ? { opacity: hover === null || on ? 1 : 0.45 }
                  : { background: ahead ? 'rgb(255 255 255 / .05)' : on ? 'var(--color-tab)' : 'rgb(255 255 255 / .16)' }}
              >
                {stacked && r.map((v, s) => v > 0 && (
                  <span key={s} className="block w-full shrink-0" style={{ flexGrow: v, flexBasis: 0, minHeight: 2, background: series?.[s]?.color ?? 'rgb(255 255 255 / .55)' }} />
                ))}
              </motion.div>
            </div>
          );
        })}
      </div>
      <div className={cn('mt-2 flex', gap)}>
        {labels.map((l, k) => <span key={k} className={cn('flex-1 text-center font-mono text-[9.5px] whitespace-nowrap transition-colors duration-150', k === i ? 'text-bright' : 'text-faint')}>{l}</span>)}
      </div>
      {stacked && series && <Legend series={series} className="mt-3" />}
    </div>
  );
}

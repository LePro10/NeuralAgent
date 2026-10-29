/**
 * Line with a crosshair, and the Sparkline. Gaps (null) are skipped. A
 * target band shades a goal range. Strokes keep their width however the
 * chart is stretched (vector-effect: non-scaling-stroke).
 */
import { motion } from 'motion/react';
import { useId, useMemo } from 'react';
import { cn } from '../../lib/cn';
import { EASE } from '../../lib/motion';
import { num, useScrub } from './scrub';

export function LineChart({ points, labels, title, format = (v) => (v === null ? '–' : num(v)), color = 'var(--color-tab)', band, secondary, area = true, height = 160, className }: {
  points: (number | null)[];
  /** Axis labels, spread evenly (need not be one per point). */
  labels: string[];
  title?: (i: number) => string;
  format?: (v: number | null, i: number) => string;
  color?: string;
  /** Target range [low, high], shaded mint. */
  band?: [number, number];
  /** A quiet second series behind (e.g. single readings behind an average). */
  secondary?: (number | null)[];
  /** Soft fill under the line. */
  area?: boolean;
  height?: number;
  className?: string;
}) {
  const gid = useId().replace(/:/g, '');
  const all = [...points, ...(secondary ?? []), ...(band ?? [])].filter((v): v is number => v !== null);
  const min = all.length ? Math.min(...all) : 0, max = all.length ? Math.max(...all) : 1;
  const pad = (max - min) * 0.12 || 1;
  const lo = min - pad, hi = max + pad;
  const n = points.length;
  const x = (i: number) => (n <= 1 ? 50 : (i / (n - 1)) * 100);
  const y = (v: number) => 100 - ((v - lo) / (hi - lo)) * 100;
  const path = (row: (number | null)[]) => {
    let d = '', pen = false;
    row.forEach((v, i) => { if (v === null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(2)},${y(v).toFixed(2)}`; pen = true; });
    return d;
  };
  const lastIdx = useMemo(() => { for (let i = n - 1; i >= 0; i--) if (points[i] !== null) return i; return n - 1; }, [points, n]);
  const firstIdx = points.findIndex((v) => v !== null);
  const { active, handlers } = useScrub(n, true);
  const i = active ?? lastIdx;
  const v = points[i] ?? null;
  const line = path(points);
  return (
    <div className={className}>
      <div className="tabular text-title font-light tracking-[-.02em] text-bright">{format(v, i)}</div>
      {title && <div className="mt-0.5 text-detail text-dim">{title(i)}</div>}
      <div data-no-swipe className="relative mt-4 touch-pan-y select-none" style={{ height }} {...handlers}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id={`la${gid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ stopColor: color, stopOpacity: 0.12 }} />
              <stop offset="1" style={{ stopColor: color, stopOpacity: 0 }} />
            </linearGradient>
          </defs>
          {band && <rect x="0" width="100" y={y(band[1])} height={Math.max(0, y(band[0]) - y(band[1]))} style={{ fill: 'color-mix(in oklab, var(--color-mint) 7%, transparent)' }} />}
          {band && band.map((b) => <line key={b} x1="0" x2="100" y1={y(b)} y2={y(b)} style={{ stroke: 'color-mix(in oklab, var(--color-mint) 35%, transparent)' }} strokeDasharray="2 2" vectorEffect="non-scaling-stroke" strokeWidth="1" />)}
          {secondary && <path d={path(secondary)} fill="none" stroke="rgb(255 255 255 / .2)" strokeWidth="1" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />}
          {area && firstIdx >= 0 && !points.includes(null) && <motion.path d={`${line}L${x(lastIdx)},100L${x(firstIdx)},100Z`} fill={`url(#la${gid})`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.4 }} />}
          <motion.path d={line} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round"
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.1, ease: EASE.outSoft }} />
          <line x1={x(i)} x2={x(i)} y1="0" y2="100" stroke="rgb(255 255 255 / .14)" strokeWidth=".75" vectorEffect="non-scaling-stroke" />
        </svg>
        {v !== null && (
          <span className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-bg transition-[left,top] duration-150"
            style={{ left: `${x(i)}%`, top: `${y(v)}%`, background: color }} />
        )}
      </div>
      <div className="mt-2 flex justify-between font-mono text-[9.5px] text-faint">{labels.map((l, k) => <span key={k}>{l}</span>)}</div>
    </div>
  );
}

/** Small trend line without axes; the last point is marked. */
export function Sparkline({ values, width = 88, height = 28, color = 'var(--color-tab)', area, className }: { values: number[]; width?: number; height?: number; color?: string; area?: boolean; className?: string }) {
  const gid = useId().replace(/:/g, '');
  if (values.length < 2) return <span className={cn('block', className)} style={{ width, height }} />;
  const min = Math.min(...values), max = Math.max(...values), sp = max - min || 1;
  const pt = (v: number, i: number) => [(i / (values.length - 1)) * (width - 4) + 2, height - 3 - ((v - min) / sp) * (height - 6)];
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${pt(v, i).map((q) => q.toFixed(1)).join(',')}`).join('');
  const [lx, ly] = pt(values[values.length - 1], values.length - 1);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className={cn('shrink-0 overflow-visible', className)}>
      {area && (
        <>
          <defs><linearGradient id={`sa${gid}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" style={{ stopColor: color, stopOpacity: 0.22 }} /><stop offset="1" style={{ stopColor: color, stopOpacity: 0 }} /></linearGradient></defs>
          <path d={`${d}L${width - 2},${height}L2,${height}Z`} fill={`url(#sa${gid})`} />
        </>
      )}
      <path d={d} fill="none" stroke={color} strokeOpacity=".6" strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r="2.25" fill={color} />
    </svg>
  );
}

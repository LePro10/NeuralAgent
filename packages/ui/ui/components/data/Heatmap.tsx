/**
 * Heatmaps: one colour, brightness = amount (five steps), always with a
 * less→more legend. `CalendarHeatmap` is a year of days (weeks as columns,
 * Monday on top, scrolled to the newest week); `GridHeatmap` is any matrix
 * (hour × weekday). Tap or hover shows the cell in the headline.
 */
import { useState } from 'react';
import { cn } from '../../lib/cn';
import { haptic } from '../../lib/haptics';

const ALPHA = [0, 0.22, 0.42, 0.66, 0.95];
const tint = (color: string, a: number) => (a ? `color-mix(in oklab, ${color} ${Math.round(a * 100)}%, transparent)` : 'var(--color-fill-2)');
const step = (v: number, max: number) => (v <= 0 ? 0 : Math.min(4, Math.ceil((v / max) * 4)));

export function HeatLegend({ color, className }: { color: string; className?: string }) {
  return (
    <div className={cn('flex items-center justify-end gap-1.5 font-mono text-micro text-dim', className)}>
      less{ALPHA.map((a, k) => <i key={k} className="h-2 w-2 rounded-[2px]" style={{ background: tint(color, a) }} />)}more
    </div>
  );
}

export interface HeatDay { date: string; value: number; detail?: string }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD = ['Mon', '', 'Wed', '', 'Fri', '', ''];

export function CalendarHeatmap({ days, color = 'var(--color-tab)', empty = 'Nothing logged', className }: { days: HeatDay[]; color?: string; empty?: string; className?: string }) {
  const [sel, setSel] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((d) => d.value));
  // Pad to Monday so rows are weekdays; carry the index per cell (indexOf per cell would be quadratic).
  const first = days[0] ? (new Date(`${days[0].date}T12:00:00`).getDay() + 6) % 7 : 0;
  const cells: ({ d: HeatDay; idx: number } | null)[] = [...Array<null>(first).fill(null), ...days.map((d, idx) => ({ d, idx }))];
  const cols = Math.ceil(cells.length / 7);
  const months: { col: number; name: string }[] = [];
  for (let c = 0; c < cols; c++) {
    const d = cells.slice(c * 7, c * 7 + 7).find(Boolean)?.d;
    if (!d) continue;
    const m = MONTHS[Number(d.date.slice(5, 7)) - 1];
    if (months.at(-1)?.name !== m) months.push({ col: c, name: m });
  }
  const shown = sel !== null ? days[sel] : days.at(-1);
  return (
    <div className={className}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <span className="text-small text-bright">{shown ? new Date(`${shown.date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : ''}</span>
        <span className="truncate text-right text-detail text-dim">{shown ? (shown.value ? shown.detail ?? shown.value : empty) : ''}</span>
      </div>
      {/* rtl: the scroller starts at the newest week; the grid inside reads ltr. */}
      <div data-no-swipe className="scroller-subtle overflow-x-auto pb-1" dir="rtl">
        <div dir="ltr" className="grid w-full gap-[3px]" style={{ gridTemplateColumns: `22px repeat(${cols}, minmax(11px, 1fr))`, minWidth: 22 + cols * 14 }}>
          <span />
          {Array.from({ length: cols }, (_, c) => <span key={`m${c}`} className="h-3 overflow-visible font-mono text-[9px] leading-[12px] whitespace-nowrap text-dim">{months.find((m) => m.col === c)?.name ?? ''}</span>)}
          {Array.from({ length: 7 }, (_, r) => (
            <div key={`r${r}`} className="contents">
              <span className="self-center pr-1 font-mono text-[9px] text-faint">{WD[r]}</span>
              {Array.from({ length: cols }, (_, c) => {
                const cell = cells[c * 7 + r];
                if (!cell) return <span key={c} />;
                return (
                  <button key={c} type="button" onClick={() => { haptic('tick'); setSel(cell.idx); }} onMouseEnter={() => setSel(cell.idx)}
                    aria-label={`${cell.d.date}: ${cell.d.value ? cell.d.detail ?? cell.d.value : empty}`}
                    className={cn('aspect-square w-full rounded-[2.5px] transition-transform duration-150 hover:scale-125', sel === cell.idx && 'ring-1 ring-white/80')}
                    style={{ background: tint(color, ALPHA[step(cell.d.value, max)]) }} />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <HeatLegend color={color} className="mt-2" />
    </div>
  );
}

/** Matrix heatmap: values[row][col]. Labels: rows on the left, a few column labels below. */
export function GridHeatmap({ values, rowLabels, colLabels, color = 'var(--color-tab)', describe, className }: {
  values: number[][];
  rowLabels: string[];
  /** Sparse labels are fine: '' where none. */
  colLabels: string[];
  color?: string;
  describe?: (r: number, c: number, v: number) => string;
  className?: string;
}) {
  const [sel, setSel] = useState<[number, number] | null>(null);
  const max = Math.max(1, ...values.flat());
  const cols = values[0]?.length ?? 0;
  return (
    <div className={className}>
      <div className="mb-3 h-5 text-detail text-dim">{sel ? (describe?.(sel[0], sel[1], values[sel[0]][sel[1]]) ?? `${rowLabels[sel[0]]} · ${sel[1]} — ${values[sel[0]][sel[1]]}`) : 'Tap a cell'}</div>
      <div data-no-swipe className="grid gap-[3px]" style={{ gridTemplateColumns: `30px repeat(${cols}, minmax(0, 1fr))` }}>
        {values.map((row, r) => (
          <div key={r} className="contents">
            <span className="self-center font-mono text-[9px] text-faint">{rowLabels[r]}</span>
            {row.map((v, c) => (
              <button key={c} type="button" aria-label={describe?.(r, c, v) ?? `${rowLabels[r]} ${c}: ${v}`}
                onClick={() => { haptic('tick'); setSel([r, c]); }} onMouseEnter={() => setSel([r, c])}
                className={cn('h-3.5 rounded-[2.5px] transition-transform duration-150 hover:scale-y-125', sel?.[0] === r && sel?.[1] === c && 'ring-1 ring-white/80')}
                style={{ background: v ? `color-mix(in oklab, ${color} ${Math.round((0.08 + (v / max) * 0.85) * 100)}%, transparent)` : 'var(--color-fill-2)' }} />
            ))}
          </div>
        ))}
        <span />
        {Array.from({ length: cols }, (_, c) => <span key={c} className="overflow-visible pt-1 font-mono text-[9px] whitespace-nowrap text-dim">{colLabels[c] ?? ''}</span>)}
      </div>
    </div>
  );
}

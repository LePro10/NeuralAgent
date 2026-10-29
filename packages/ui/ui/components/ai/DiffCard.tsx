/**
 * What a change did, line by line. Inline (one column, red out / green in)
 * on phones; split (old left, new right) when there is room. Unchanged
 * stretches fold to "⋯ 12 unchanged lines". Mono 12px on 20px lines.
 */
import { motion } from 'motion/react';
import { Columns2, Rows3, Undo2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { cn } from '../../lib/cn';
import { SPRING } from '../../lib/motion';
import { Segmented } from '../core/Segmented';

export type DiffLine =
  | { kind: 'same'; text: string; a: number; b: number }
  | { kind: 'del'; text: string; a: number }
  | { kind: 'add'; text: string; b: number }
  | { kind: 'gap'; count: number };

/** Line diff via LCS. Fine for the few hundred lines a chat change touches. */
export function diffLines(before: string, after: string, context = 2): DiffLine[] {
  const A = before.split('\n'), B = after.split('\n');
  const n = A.length, m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) { out.push({ kind: 'same', text: A[i], a: i + 1, b: j + 1 }); i++; j++; }
    // Deletions before additions, as people read a change: what went, then what came.
    else if (i < n && (j >= m || L[i + 1][j] >= L[i][j + 1])) { out.push({ kind: 'del', text: A[i], a: i + 1 }); i++; }
    else { out.push({ kind: 'add', text: B[j], b: j + 1 }); j++; }
  }
  // Fold unchanged runs, keeping `context` lines around each change.
  const keep = out.map((l, k) => l.kind !== 'same' || out.slice(Math.max(0, k - context), k + context + 1).some((x) => x.kind !== 'same'));
  const folded: DiffLine[] = [];
  for (let k = 0; k < out.length; k++) {
    if (keep[k]) { folded.push(out[k]); continue; }
    let c = 0; while (k < out.length && !keep[k]) { c++; k++; } k--;
    folded.push({ kind: 'gap', count: c });
  }
  return folded;
}

const TONE = { del: 'bg-danger/[.09] text-[color-mix(in_oklab,var(--color-danger)_55%,white)]', add: 'bg-mint/[.08] text-[color-mix(in_oklab,var(--color-mint)_60%,white)]', same: 'text-dim' } as const;

function Line({ l, side }: { l?: DiffLine; side?: 'a' | 'b' }) {
  if (!l) return <div className="min-h-[20px] bg-fill-1" />;
  if (l.kind === 'gap') return <div className="my-0.5 py-1 pl-12 font-sans text-tiny text-faint">⋯ {l.count} unchanged {l.count === 1 ? 'line' : 'lines'}</div>;
  const nr = l.kind === 'same' ? (side === 'b' ? l.b : l.a) : l.kind === 'del' ? l.a : l.b;
  return (
    <div className={cn('flex min-h-[20px]', TONE[l.kind])}>
      <span className="w-8 shrink-0 pr-2 text-right text-faint select-none">{nr}</span>
      <span className="w-3.5 shrink-0 opacity-60 select-none">{l.kind === 'del' ? '−' : l.kind === 'add' ? '+' : ' '}</span>
      <span className="min-w-0 flex-1 pr-2 break-words whitespace-pre-wrap">{l.text || ' '}</span>
    </div>
  );
}

/** Pairs deletions with additions for the split view. */
function pairs(lines: DiffLine[]): [DiffLine | undefined, DiffLine | undefined][] {
  const rows: [DiffLine | undefined, DiffLine | undefined][] = [];
  for (let k = 0; k < lines.length; k++) {
    const l = lines[k];
    if (l.kind === 'same' || l.kind === 'gap') { rows.push([l, l]); continue; }
    const dels: DiffLine[] = [], adds: DiffLine[] = [];
    while (k < lines.length && (lines[k].kind === 'del' || lines[k].kind === 'add')) { (lines[k].kind === 'del' ? dels : adds).push(lines[k]); k++; }
    k--;
    for (let r = 0; r < Math.max(dels.length, adds.length); r++) rows.push([dels[r], adds[r]]);
  }
  return rows;
}

export function DiffCard({ title, before, after, mode: initialMode = 'inline', context = 2, onUndo, className }: {
  title: string; before: string; after: string; mode?: 'inline' | 'split'; context?: number; onUndo?: () => void; className?: string;
}) {
  const [mode, setMode] = useState(initialMode);
  const lines = useMemo(() => diffLines(before, after, context), [before, after, context]);
  const added = lines.filter((l) => l.kind === 'add').length;
  const removed = lines.filter((l) => l.kind === 'del').length;
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={SPRING.pop} className={cn('card @container overflow-hidden !rounded-list', className)}>
      <div className="flex items-center gap-2.5 px-3.5 pt-3 pb-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-small text-bright">{title}</p>
          <p className="mt-px font-mono text-tiny"><span className="text-mint">+{added}</span> <span className="text-danger">−{removed}</span></p>
        </div>
        <Segmented size="sm" value={mode} onChange={setMode} label="Diff view" className="hidden @min-[560px]:flex"
          options={[{ value: 'inline', label: 'Inline', Icon: Rows3 }, { value: 'split', label: 'Split', Icon: Columns2 }]} />
        {onUndo && <button type="button" onClick={onUndo} className="pressable relative flex h-7 items-center gap-1.5 rounded-full bg-fill-3 px-2.5 text-meta text-bright after:absolute after:-inset-y-2 after:inset-x-0 after:content-[''] hover:bg-fill-4"><Undo2 size={12} strokeWidth={1.7} />Undo</button>}
      </div>
      <div className="scroll-x mx-2.5 mb-2.5 rounded-field bg-black/30 py-1.5 font-mono text-[11.5px] leading-5">
        {mode === 'split'
          ? <div className="hidden min-w-[560px] @min-[560px]:block">{pairs(lines).map(([a, b], k) => <div key={k} className="grid grid-cols-2 gap-px">{a?.kind === 'gap' ? <div className="col-span-2"><Line l={a} /></div> : <><Line l={a?.kind === 'add' ? undefined : a} side="a" /><Line l={b?.kind === 'del' ? undefined : b} side="b" /></>}</div>)}</div>
          : null}
        <div className={cn(mode === 'split' && '@min-[560px]:hidden')}>{lines.map((l, k) => <Line key={k} l={l} />)}</div>
      </div>
    </motion.div>
  );
}

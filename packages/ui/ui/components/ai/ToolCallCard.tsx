/**
 * A tool call as a first-class event, not a log line. Four states, one card:
 *
 *   announce  "About to search your calendar" — what and with which input
 *   running   live status (spinner + elapsed), a thin light sweeps the top edge
 *   done      result inline (collapsible), duration
 *   error     what failed, in plain words, with Retry
 *
 * Height changes animate, so the conversation below never jumps.
 */
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, Check, ChevronDown, RotateCcw, Wrench, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { EASE, SPRING } from '../../lib/motion';
import { Shimmer } from '../effects/Shimmer';
import { useElapsed } from './stream';

export type ToolState = 'announce' | 'running' | 'done' | 'error';

export function ToolCallCard({ name, Icon = Wrench, state, input, status, result, error, ms, onRetry, defaultOpen = true, className }: {
  /** Human name of the action: "Search calendar". */
  name: string;
  Icon?: LucideIcon;
  state: ToolState;
  /** Mono summary of the input: `free evenings · next 7 days`. */
  input?: string;
  /** Live status while running ("Reading 3 of 12 events"). */
  status?: string;
  /** Inline result when done. */
  result?: ReactNode;
  error?: string;
  /** Measured duration (done/error). While running, elapsed time counts itself. */
  ms?: number;
  onRetry?: () => void;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const elapsed = useElapsed(state === 'running');
  const running = state === 'running';
  const tint = state === 'error' ? 'shadow-[inset_0_0_0_var(--hair)_color-mix(in_oklab,var(--color-danger)_35%,transparent)]' : running ? 'shadow-[inset_0_0_0_var(--hair)_color-mix(in_oklab,var(--color-tab)_35%,transparent)]' : 'shadow-edge';
  const time = state === 'running' ? `${elapsed.toFixed(1)}s` : ms !== undefined ? (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`) : '';

  return (
    <motion.div layout="size" transition={SPRING.sheet} className={cn('surface relative overflow-hidden rounded-stat transition-shadow duration-500', tint, className)}>
      {running && <motion.i aria-hidden="true" className="deko pointer-events-none absolute inset-x-0 top-0 h-[var(--hair)] bg-[linear-gradient(90deg,transparent,var(--color-tab),transparent)]"
        initial={{ x: '-100%' }} animate={{ x: '100%' }} transition={{ duration: 1.6, repeat: Infinity, ease: 'linear' }} />}
      <button type="button" disabled={!result || state !== 'done'} onClick={() => setOpen(!open)} aria-expanded={result ? open : undefined}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left">
        <span className={cn('relative grid h-7 w-7 shrink-0 place-items-center rounded-tile transition-colors duration-300',
          state === 'error' ? 'bg-danger/[.12] text-danger' : state === 'done' ? 'bg-fill-3 text-ink' : 'bg-tab/[.12] text-tab')}>
          {state === 'error' ? <AlertTriangle size={13} strokeWidth={1.8} /> : <Icon size={13} strokeWidth={1.7} />}
          {state === 'done' && (
            <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={SPRING.pop}
              className="absolute -right-[3px] -bottom-[3px] grid h-3 w-3 place-items-center rounded-full bg-mint text-bg ring-[1.5px] ring-bg"><Check size={8} strokeWidth={3.5} /></motion.span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-small text-bright">{name}</span>
            {state === 'announce' && <span className="rounded-full bg-fill-3 px-1.5 text-tiny leading-[16px] text-dim">Up next</span>}
          </span>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={state + (status ?? '')} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }} transition={{ duration: 0.18, ease: EASE.outSoft }}
              className="mt-px block truncate text-meta">
              {running ? <Shimmer>{status ?? 'Running…'}</Shimmer>
                : state === 'error' ? <span className="text-danger/90">{error ?? 'Failed'}</span>
                  : <span className="text-dim">{input}</span>}
            </motion.span>
          </AnimatePresence>
        </span>
        {time && <span className="shrink-0 font-mono text-tiny text-faint tabular">{time}</span>}
        {running && <i className="spinner shrink-0" style={{ ['--size' as string]: '12px' }} />}
        {state === 'done' && result && <ChevronDown size={13} strokeWidth={1.75} className="shrink-0 text-faint transition-transform duration-300 ease-out-soft" style={{ transform: open ? 'rotate(180deg)' : 'none' }} />}
      </button>
      {state === 'error' && onRetry && (
        <div className="-mt-1 flex justify-end px-3 pb-2.5">
          <button type="button" onClick={onRetry} className="pressable relative flex h-7 items-center gap-1.5 rounded-full bg-fill-3 px-3 text-meta text-bright after:absolute after:-inset-y-2 after:inset-x-0 after:content-[''] hover:bg-fill-4"><RotateCcw size={12} strokeWidth={1.7} />Retry</button>
        </div>
      )}
      <AnimatePresence initial={false}>
        {state === 'done' && result && open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.32, ease: EASE.outSoft }} className="overflow-hidden">
            <div className="border-t-hair border-line px-3 py-2.5 text-small text-ink">{result}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

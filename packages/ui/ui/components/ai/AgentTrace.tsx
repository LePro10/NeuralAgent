/**
 * What the assistant is doing, above its answer — tools and thinking in one
 * block. Collapsed is the normal case, also while it works: the header says
 * what is running right now (its own status line, else the running tool);
 * when done, only the summary remains ("Used 3 tools · 4.2s"). A tap opens
 * the timeline. While it thinks, a small live window shows its thoughts,
 * fading out at the top. Everything opens and closes with a height
 * animation, so the answer below never jumps.
 *
 * Labels come from observable events (tool started/finished, status emitted),
 * never from a fake progress timer. Each label holds ≥ 650 ms so fast models
 * don't flicker; the final state shows at once.
 */
import { AnimatePresence, motion } from 'motion/react';
import { Check, ChevronDown, CircleAlert, ShieldCheck, Wrench, type LucideIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { EASE } from '../../lib/motion';
import { LogoLoader } from '../effects/LogoLoader';
import { Shimmer } from '../effects/Shimmer';
import { useLinger, useSmoothText, useStable } from './stream';

export type StepState = 'running' | 'done' | 'error' | 'waiting';

export interface TraceStep {
  id: string;
  /** 'status' = the assistant's own progress line; 'tool' = a tool call. */
  kind?: 'tool' | 'status';
  label: string;
  /** Mono detail: query, path, count. */
  detail?: string;
  Icon?: LucideIcon;
  state: StepState;
  /** Duration once finished. */
  ms?: number;
}

const OPEN = { duration: 0.32, ease: EASE.outSoft } as const;

/** The header label, derived from events. Exported so a status bar elsewhere can show the same. */
export function traceLabel(steps: TraceStep[], working: boolean, thinking: boolean, stopped?: boolean): string {
  const tools = steps.filter((s) => s.kind !== 'status').length;
  if (!working) return stopped ? 'Stopped' : tools ? `Used ${tools} tool${tools === 1 ? '' : 's'}` : 'Thought it through';
  // The latest status line counts while only running tools follow it.
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i];
    if (s.kind === 'status') return s.label;
    if (s.state !== 'running') break;
  }
  const running = [...steps].reverse().find((s) => s.state === 'running');
  if (thinking && !running) return 'Thinking';
  return running?.label ?? (steps.length ? 'Working' : 'Thinking');
}

export function AgentTrace({ steps, working, thinking, isThinking, seconds, stopped, defaultOpen = false, className }: {
  steps: TraceStep[];
  working: boolean;
  /** Streamed reasoning text, if the model exposes it. */
  thinking?: string;
  /** The latest deltas were thinking (not text or tools). */
  isThinking?: boolean;
  seconds?: number;
  stopped?: boolean;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const tools = steps.filter((s) => s.kind !== 'status').length;
  const hasContent = steps.length > 0 || !!thinking;
  const raw = traceLabel(steps, working, !!isThinking, stopped);
  const stable = useStable(raw, working ? 650 : 0);
  const label = working ? stable : raw;
  const thoughtsVisible = useLinger(working && !!isThinking && !!thinking, 900);
  const time = !working && seconds && seconds >= 0.5 ? ` · ${seconds.toFixed(1)}s` : '';
  const running = steps.some((s) => s.state === 'running');
  const last = steps[steps.length - 1];
  if (!working && !hasContent && !stopped) return null;

  return (
    <div className={cn('mb-2', className)}>
      <button type="button" aria-expanded={hasContent ? open : undefined} onClick={() => hasContent && setOpen(!open)}
        className={cn('-mx-2 flex min-h-8 max-w-full items-center gap-2 rounded-full px-2 text-chip transition-colors', hasContent ? 'hover:bg-fill-2' : 'cursor-default')}>
        <span className="grid h-4 w-4 shrink-0 place-items-center">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span key={working ? 'w' : stopped ? 's' : 'd'} initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.12 } }} transition={{ duration: 0.22, ease: EASE.outSoft }} className="grid place-items-center">
              {working ? <LogoLoader size={15} className="text-ink" /> : stopped ? <span className="h-[7px] w-[7px] rounded-[2px] bg-dim" /> : <Check size={13} strokeWidth={2} className="text-dim" />}
            </motion.span>
          </AnimatePresence>
        </span>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={label} className={cn('min-w-0 truncate', !working && 'text-dim')}
            initial={{ opacity: 0, y: 6, filter: 'blur(2px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -6, filter: 'blur(2px)', transition: { duration: 0.14 } }} transition={{ duration: 0.24, ease: EASE.outSoft }}>
            {working ? <Shimmer className="block truncate">{`${label.replace(/[.…:!]+$/, '')}…`}</Shimmer> : `${label}${time}`}
          </motion.span>
        </AnimatePresence>
        {working && tools > 1 && <motion.span key={tools} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} className="shrink-0 rounded-full bg-fill-3 px-1.5 text-tiny text-dim tabular">{tools}</motion.span>}
        {hasContent && <ChevronDown size={13} strokeWidth={1.75} className="shrink-0 text-faint transition-transform duration-300 ease-out-soft" style={{ transform: open ? 'rotate(180deg)' : 'none' }} />}
      </button>

      <AnimatePresence initial={false}>
        {!open && working && thoughtsVisible && !!thinking && (
          <motion.div key="thoughts" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={OPEN} className="overflow-hidden">
            <Thoughts text={thinking} live />
          </motion.div>
        )}
        {!open && working && !thoughtsVisible && last?.state === 'error' && last.detail && (
          <motion.p key="err" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={OPEN} className="overflow-hidden pl-6 font-mono text-tiny text-dim">
            <span className="line-clamp-1">{last.detail}</span>
          </motion.p>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div key="timeline" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={OPEN} className="overflow-hidden">
            {steps.length > 0 && (
              <ol className="relative mt-0.5 ml-[7px] border-l-[length:var(--hair)] border-solid border-line-2 pl-3.5">
                {steps.map((s) => <StepRow key={s.id} step={s} active={s.state === 'running' && working && running} />)}
              </ol>
            )}
            {thinking && (
              <div className="mt-1.5 ml-[7px] border-l-[length:var(--hair)] border-solid border-line-2 pl-3.5">
                <div className="mb-1 text-meta text-faint">Thoughts</div>
                <Thoughts text={thinking} live={working && !!isThinking} full />
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StepRow({ step: s, active }: { step: TraceStep; active: boolean }) {
  const enter = { initial: { opacity: 0, x: -4 }, animate: { opacity: 1, x: 0 }, transition: { duration: 0.22, ease: EASE.outSoft } } as const;
  if (s.kind === 'status') {
    return (
      <motion.li {...enter} className="flex min-h-6 items-start gap-2 py-0.5">
        <span className="grid h-5 w-5 shrink-0 place-items-center"><span className="h-1 w-1 rounded-full bg-dim" /></span>
        <span className="min-w-0 pt-px text-small leading-snug text-dim">{s.label}</span>
      </motion.li>
    );
  }
  const Icon = s.state === 'error' ? CircleAlert : s.state === 'waiting' ? ShieldCheck : s.Icon ?? Wrench;
  return (
    <motion.li {...enter} className="flex min-h-7 items-center gap-2 py-0.5">
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-chip bg-fill-3">
        {active ? <i className="spinner" style={{ ['--size' as string]: '10px' }} />
          : <Icon size={11} strokeWidth={1.8} className={s.state === 'error' ? 'text-danger' : s.state === 'waiting' ? 'text-tab' : 'text-ink'} />}
      </span>
      <span className="min-w-0 shrink-0 text-small text-bright">{s.label}</span>
      {s.detail && <span className="min-w-0 truncate text-meta text-dim">{s.detail}</span>}
      {s.ms !== undefined && s.state !== 'running' && <span className="ml-auto shrink-0 pl-2 font-mono text-tiny text-faint tabular">{s.ms < 1000 ? `${s.ms}ms` : `${(s.ms / 1000).toFixed(1)}s`}</span>}
    </motion.li>
  );
}

/** Thoughts as a small window: sticks to the bottom unless you scroll up; fades out at the top. */
function Thoughts({ text, live, full }: { text: string; live: boolean; full?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const shown = useSmoothText(text, live);
  useLayoutEffect(() => { const el = ref.current; if (el && atBottom.current) el.scrollTop = el.scrollHeight; }, [shown]);
  useEffect(() => { atBottom.current = true; }, [live]);
  const words = shown.split(/(?<=\s)/);
  const from = live ? Math.max(0, words.length - 500) : 0;
  return (
    <div ref={ref} onScroll={(e) => { const el = e.currentTarget; atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24; }}
      className={cn('scroller scroller-subtle overflow-y-auto pr-1 text-small leading-[1.55] whitespace-pre-wrap text-dim', full ? 'max-h-[260px]' : 'mt-0.5 ml-6 max-h-[80px] [mask-image:linear-gradient(180deg,transparent,#000_26px)]')}>
      {live ? words.slice(from).map((w, i) => <span key={from + i} className="word-in">{w}</span>) : shown}
    </div>
  );
}

/**
 * Just the status line — for a header, a voice screen or a compact row:
 * the mark at work + shimmering label while working (labels swap with a soft blur and
 * hold ≥ 650 ms), a check and the final text when done.
 */
export function StatusLine({ label, working, className }: { label: string; working: boolean; className?: string }) {
  const stable = useStable(label, working ? 650 : 0);
  const shown = working ? stable : label;
  return (
    <span role="status" className={cn('inline-flex max-w-full items-center gap-2 text-chip', className)}>
      <span className="grid h-4 w-4 shrink-0 place-items-center">{working ? <LogoLoader size={15} className="text-ink" /> : <Check size={13} strokeWidth={2} className="text-mint" />}</span>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={shown} className={cn('min-w-0 truncate', !working && 'text-ink')}
          initial={{ opacity: 0, y: 6, filter: 'blur(2px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -6, filter: 'blur(2px)', transition: { duration: 0.14 } }} transition={{ duration: 0.24, ease: EASE.outSoft }}>
          {working ? <Shimmer className="block truncate">{`${shown.replace(/[.…:!]+$/, '')}…`}</Shimmer> : shown}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

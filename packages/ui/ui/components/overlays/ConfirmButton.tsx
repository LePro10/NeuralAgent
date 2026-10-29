/**
 * Confirm inside the button itself — no dialog. The first tap arms it: the
 * button widens and asks ("Tap again to delete"); the second tap runs the
 * action; after 3 seconds untouched it quietly falls back. Optionally it then
 * offers "Undo" for a moment.
 *
 * For things that are reversible or local. Something external or for good
 * (sending, paying, deleting an account) may still deserve a ConfirmSheet.
 *
 * Motion: width follows on a spring (520/40, via layout), the label swaps by
 * a 160ms crossfade with a 6px rise — the eye reads one button changing its
 * mind, not two buttons.
 */
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { haptic } from '../../lib/haptics';
import { SPRING } from '../../lib/motion';

type State = 'idle' | 'armed' | 'busy' | 'done';

const WIDTH = { ...SPRING.snap, damping: 40 };
const TONE = {
  danger: { idle: 'bg-danger/[.1] text-danger', armed: 'bg-danger text-white' },
  neutral: { idle: 'bg-fill-3 text-bright', armed: 'bg-bright text-bg' },
} as const;

export function ConfirmButton({ label, confirmLabel = 'Tap again to confirm', doneLabel, onConfirm, onUndo, Icon, tone = 'danger', size = 'md', timeout = 3000, className }: {
  label: string;
  /** What the armed button says. */
  confirmLabel?: string;
  /** Shown briefly after it ran ("Removed"). With `onUndo`, an Undo sits next to it. */
  doneLabel?: string;
  /** May return a promise; the button shows busy until it settles. */
  onConfirm: () => void | Promise<void>;
  onUndo?: () => void;
  Icon?: LucideIcon;
  tone?: 'danger' | 'neutral';
  size?: 'sm' | 'md';
  /** Armed state falls back after this many ms. */
  timeout?: number;
  className?: string;
}) {
  const [state, setState] = useState<State>('idle');
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const later = (ms: number, to: State) => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setState(to), ms); };

  const tap = async () => {
    if (state === 'idle') { haptic('tick'); setState('armed'); later(timeout, 'idle'); return; }
    if (state !== 'armed') return;
    window.clearTimeout(timer.current);
    setState('busy');
    try {
      await onConfirm();
      haptic('heavy');
      if (doneLabel) { setState('done'); later(onUndo ? 4000 : 1600, 'idle'); } else setState('idle');
    } catch { haptic('warning'); setState('idle'); }
  };

  const text = state === 'armed' ? confirmLabel : state === 'done' ? doneLabel : label;
  const t = TONE[tone];
  const h = size === 'sm' ? 'h-8 px-3.5 text-chip' : 'h-[38px] px-4 text-button';

  return (
    <LayoutGroup>
      <span className={cn('inline-flex items-center gap-1.5', className)}>
        <motion.button
          layout
          type="button"
          onClick={tap}
          disabled={state === 'busy' || state === 'done'}
          aria-live="polite"
          transition={{ layout: WIDTH }}
          style={{ borderRadius: 999 }}
          className={cn(
            'relative inline-flex items-center justify-center gap-1.5 overflow-hidden whitespace-nowrap font-medium transition-colors duration-200',
            h, state === 'done' ? 'bg-fill-3 text-ink' : state === 'idle' ? t.idle : t.armed,
          )}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={state === 'busy' ? 'busy' : text}
              layout="position"
              className="inline-flex items-center gap-1.5"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0, transition: { duration: 0.16, ease: [0.22, 1, 0.36, 1] } }}
              exit={{ opacity: 0, y: -6, transition: { duration: 0.12 } }}
            >
              {state === 'busy'
                ? <i className="spinner" style={{ ['--size' as string]: '14px', borderTopColor: 'currentColor' }} />
                : <>{state === 'idle' && Icon && <Icon size={14} strokeWidth={1.75} />}{text}</>}
            </motion.span>
          </AnimatePresence>
        </motion.button>
        <AnimatePresence>
          {state === 'done' && onUndo && (
            <motion.button
              layout
              key="undo"
              type="button"
              onClick={() => { window.clearTimeout(timer.current); haptic('select'); onUndo(); setState('idle'); }}
              className={cn('pressable rounded-full font-medium text-accent hover:bg-fill-2', size === 'sm' ? 'h-8 px-3 text-chip' : 'h-[38px] px-3.5 text-button')}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0, transition: { duration: 0.2, delay: 0.08 } }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
            >
              Undo
            </motion.button>
          )}
        </AnimatePresence>
      </span>
    </LayoutGroup>
  );
}

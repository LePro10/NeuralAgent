/**
 * Task check: done in three precise steps, 520 ms in all — the circle fills
 * (160 ms), the tick draws itself (240 ms), a line strikes the text through
 * (260 ms) while it dims. Undoing is instant and quiet. The whole row is the
 * target; a haptic marks the moment.
 */
import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { haptic } from '../../lib/haptics';
import { EASE } from '../../lib/motion';

export function TaskCheck({ done, onChange, children, detail, color = 'var(--color-tab)', className }: {
  done: boolean;
  onChange: (done: boolean) => void;
  children: ReactNode;
  /** Second line (due date, project). */
  detail?: ReactNode;
  /** Fill of the done circle (default: the place's signal colour). */
  color?: string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const t = (duration: number, delay: number) => (reduce || !done ? { duration: reduce ? 0 : 0.12 } : { duration, delay, ease: EASE.outSoft });
  return (
    <button type="button" role="checkbox" aria-checked={done} onClick={() => { haptic(done ? 'tick' : 'success'); onChange(!done); }}
      className={cn('flex w-full items-center gap-3 rounded-field px-3 py-2.5 text-left transition-colors hover:bg-fill-1 active:bg-fill-2', className)}>
      <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 overflow-visible" aria-hidden="true">
        <circle cx="12" cy="12" r="10" fill="none" stroke="rgb(255 255 255 / .26)" strokeWidth="1.4" />
        <motion.circle cx="12" cy="12" r="10.6" style={{ fill: color, transformOrigin: '12px 12px' }} initial={false}
          animate={{ opacity: done ? 1 : 0, scale: done ? 1 : 0.55 }} transition={t(0.16, 0)} />
        <motion.path d="M7.4 12.4l3.1 3.1 6.1-6.6" fill="none" stroke="var(--color-bg)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
          initial={false} animate={{ pathLength: done ? 1 : 0, opacity: done ? 1 : 0 }} transition={t(0.24, 0.12)} />
      </svg>
      <span className="min-w-0 flex-1">
        <span className="relative inline-block max-w-full">
          <motion.span className="block truncate text-body" initial={false} animate={{ color: done ? 'var(--color-dim)' : 'var(--color-bright)' }} transition={t(0.26, 0.26)}>{children}</motion.span>
          <motion.i aria-hidden="true" className="absolute top-[54%] -right-0.5 -left-0.5 h-px origin-left bg-dim" initial={false}
            animate={{ scaleX: done ? 1 : 0 }} transition={t(0.26, 0.26)} style={{ transitionTimingFunction: 'cubic-bezier(.65,0,.35,1)' }} />
        </span>
        {detail && <span className="mt-px block truncate text-detail text-faint">{detail}</span>}
      </span>
    </button>
  );
}

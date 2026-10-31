/**
 * The Island: the top drop on phone agent screens ("Two Drops"). One 44px floating capsule
 * replaces header, chip strip, "…" and "+":
 *
 *   [‹•]  [mark]  Title of the task              [ring]
 *                 project · working 2m
 *
 * - Back chevron; `backDot` puts an accent dot on it when ANOTHER agent needs you.
 * - `mark`: the agent's live mark (an EngineTile with its activity), `trailing`: the context ring.
 * - Tap the middle → `onOpen` (the IslandPanel pours down from it).
 * - Swipe the middle sideways → `onSwipe(+1 | -1)` (next / previous agent). The title follows the
 *   finger a little; content (transcripts, diffs, terminals) keeps its own sideways scroll.
 * - `minimised` (reading, scrolling down): shrinks towards a 36px bead, the second line fades.
 * - `hidden` (keyboard open): rises out of view and is inert.
 * Transform and opacity only; reduced motion jumps.
 *
 * `tone="cv"` dresses it in the Claude view's warm surface instead of the app glass.
 */
import { animate, AnimatePresence, motion, useMotionValue, useTransform } from 'motion/react';
import { ChevronLeft } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn';
import { useFocusTrap } from '../../lib/focus-trap';
import { haptic } from '../../lib/haptics';
import { useLayer } from '../../lib/layers';
import { SPRING } from '../../lib/motion';
import { usePortalTarget } from '../../lib/surface';

export type IslandTone = 'app' | 'cv';

const SURFACE: Record<IslandTone, string> = {
  app: 'glass rim',
  cv: 'border-hair border-cv-line bg-cv-surface/90 shadow-cv-pill backdrop-blur-xl backdrop-saturate-150',
};

/** px the finger travels sideways before it is a swipe. */
const SWIPE = 56;

export function Island({ title, subtitle, mark, trailing, onBack, backLabel = 'Back', backDot, onOpen, open, onSwipe, minimised, hidden, tone = 'app', className }: {
  title: ReactNode;
  subtitle?: ReactNode;
  mark?: ReactNode;
  trailing?: ReactNode;
  onBack?: () => void;
  /** Where back goes, for screen readers ("Back to Agents"). */
  backLabel?: string;
  /** Another agent needs you. */
  backDot?: boolean;
  onOpen?: () => void;
  /** The panel is open (aria-expanded). */
  open?: boolean;
  /** +1 = next agent (swipe left), −1 = previous. */
  onSwipe?: (dir: -1 | 1) => void;
  minimised?: boolean;
  hidden?: boolean;
  tone?: IslandTone;
  className?: string;
}) {
  const dx = useMotionValue(0);
  const titleX = useTransform(dx, (v) => v * 0.35);
  const titleOpacity = useTransform(dx, [-SWIPE * 2, 0, SWIPE * 2], [0.35, 1, 0.35]);
  const g = useRef<{ id: number; x0: number; y0: number; on: boolean; swiped: boolean } | null>(null);
  const suppress = useRef(false);

  const cv = tone === 'cv';
  return (
    <motion.div
      className={cn('pointer-events-none absolute inset-x-drop z-[var(--z-island)] flex justify-center', className)}
      initial={false}
      animate={hidden ? { y: -72, opacity: 0, scale: 0.9 } : minimised ? { y: -4, opacity: 1, scale: 0.86 } : { y: 0, opacity: 1, scale: 1 }}
      transition={SPRING.snap}
      // Under the status bar of the frame it floats in.
      style={{ top: 'calc(var(--safe-top, 0px) + 4px)', transformOrigin: '50% 0%' }}
      aria-hidden={hidden || undefined}
      inert={hidden || undefined}
    >
      <div className={cn('pointer-events-auto relative flex h-island w-full max-w-[560px] items-center rounded-full pr-1', SURFACE[tone])}>
        {onBack ? (
          <button type="button" onClick={onBack} aria-label={`Back to ${backLabel}${backDot ? ' (another agent needs you)' : ''}`}
            className={cn('pressable relative grid h-island w-11 shrink-0 place-items-center rounded-full', cv ? 'text-cv-text' : 'text-bright')}>
            <ChevronLeft className="size-icon" strokeWidth={2} />
            {backDot && <i aria-hidden="true" className={cn('activity-pulse absolute top-2 right-1.5 size-2 rounded-full bg-accent ring-2', cv ? 'ring-cv-surface' : 'ring-popover')} />}
          </button>
        ) : <span className="w-3 shrink-0" />}
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open || undefined}
          className="flex h-full min-w-0 flex-1 touch-pan-y items-center gap-2.5 rounded-full pr-1 text-left outline-offset-[-2px]"
          onClick={() => { if (suppress.current) { suppress.current = false; return; } haptic('select'); onOpen?.(); }}
          onPointerDown={(e) => {
            if (!onSwipe || e.button !== 0) return;
            g.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, on: false, swiped: false };
          }}
          onPointerMove={(e) => {
            const s = g.current;
            if (!s || s.id !== e.pointerId) return;
            const x = e.clientX - s.x0, y = e.clientY - s.y0;
            if (!s.on) {
              if (Math.abs(y) > 10 && Math.abs(y) > Math.abs(x)) { g.current = null; return; }
              if (Math.abs(x) < 8) return;
              s.on = true;
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            }
            dx.set(x);
            if (!s.swiped && Math.abs(x) > SWIPE) { s.swiped = true; haptic('tick'); }
          }}
          onPointerUp={(e) => {
            const s = g.current;
            g.current = null;
            if (!s || !s.on) return;
            suppress.current = true;
            const x = e.clientX - s.x0;
            animate(dx, 0, SPRING.snap);
            if (Math.abs(x) > SWIPE) onSwipe?.(x < 0 ? 1 : -1);
            // A click may not follow a capture-released pointer: clear the guard soon.
            window.setTimeout(() => { suppress.current = false; }, 300);
          }}
          onPointerCancel={() => { g.current = null; animate(dx, 0, SPRING.snap); }}
        >
          {mark && <span className="relative grid shrink-0 place-items-center">{mark}</span>}
          <motion.span className="flex min-w-0 flex-1 flex-col justify-center" style={{ x: titleX, opacity: titleOpacity }}>
            <span className={cn('truncate text-subhead leading-tight font-medium', cv ? 'text-cv-text' : 'text-bright')}>{title}</span>
            {subtitle && (
              <motion.span className={cn('truncate text-caption leading-tight', cv ? 'text-cv-muted' : 'text-dim')} initial={false} animate={{ opacity: minimised ? 0 : 1 }} transition={{ duration: 0.16 }}>
                {subtitle}
              </motion.span>
            )}
          </motion.span>
        </button>
        {trailing && <span className="grid h-9 min-w-9 shrink-0 place-items-center">{trailing}</span>}
      </div>
    </motion.div>
  );
}

/**
 * The panel the Island opens into: pours down from the top (scales out of the capsule),
 * over a scrim. Back / Escape / the scrim / a swipe up close it (useLayer, C4).
 * One surface of `.glass-thick` material: no second blur on screen.
 */
export function IslandPanel({ open, onClose, label, children, tone = 'app' }: {
  open: boolean;
  onClose: () => void;
  /** Accessible name of the dialog. */
  label: string;
  children: ReactNode;
  tone?: IslandTone;
}) {
  const portal = usePortalTarget();
  const ref = useRef<HTMLDivElement>(null);
  useLayer(open, onClose);
  useFocusTrap(open, ref);
  // The screen behind may grab focus while the panel is open (a terminal shown after switching an
  // agent to Terminal focuses itself and would eat Escape): keep focus in the panel.
  useEffect(() => {
    if (!open) return;
    const back = (e: FocusEvent) => {
      const el = ref.current, t = e.target;
      if (!el || !(t instanceof Element) || el.contains(t) || t.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')) return;
      el.focus({ preventScroll: true });
    };
    document.addEventListener('focusin', back);
    return () => document.removeEventListener('focusin', back);
  }, [open]);
  const y = useMotionValue(0);
  const g = useRef<{ id: number; y0: number } | null>(null);
  const cv = tone === 'cv';
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[var(--z-sheet)]">
          <motion.div aria-hidden="true" className="absolute inset-0 bg-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.14 } }} onClick={onClose} />
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-label={label}
            tabIndex={-1}
            className={cn(
              'absolute inset-x-drop mx-auto flex max-h-[min(78dvh,640px)] max-w-[560px] flex-col overflow-hidden rounded-sheet shadow-menu outline-none',
              cv ? 'border-hair border-cv-line bg-cv-surface text-cv-text' : 'material text-ink',
            )}
            style={{ top: 'calc(var(--safe-top) + 4px)', y, transformOrigin: '50% 0%' }}
            initial={{ opacity: 0, scaleX: 0.5, scaleY: 0.35 }}
            animate={{ opacity: 1, scaleX: 1, scaleY: 1 }}
            exit={{ opacity: 0, scaleX: 0.7, scaleY: 0.5, transition: { duration: 0.14 } }}
            transition={SPRING.pop}
          >
            <div className="scroller min-h-0 flex-1 overscroll-contain">{children}</div>
            {/* Grabber at the bottom: drag it up to close. */}
            <div
              aria-hidden="true"
              className="grid h-6 shrink-0 touch-none place-items-center"
              onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); g.current = { id: e.pointerId, y0: e.clientY }; }}
              onPointerMove={(e) => { const s = g.current; if (s && s.id === e.pointerId) y.set(Math.min(0, e.clientY - s.y0)); }}
              onPointerUp={(e) => { const s = g.current; g.current = null; if (s && e.clientY - s.y0 < -48) onClose(); else animate(y, 0, SPRING.snap); }}
              onPointerCancel={() => { g.current = null; animate(y, 0, SPRING.snap); }}
            >
              <span className="h-1 w-9 rounded-full bg-grabber" />
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    portal,
  );
}

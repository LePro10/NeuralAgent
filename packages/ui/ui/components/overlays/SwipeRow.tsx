/**
 * List row with iOS Mail-style swipe actions. Adapted from 21st.dev
 * "Swipe Row" (molecule-lab-rushil), but pointer-driven instead of a motion
 * drag, so vertical scrolling stays native:
 *
 * - axis lock after 8px: vertical wins → the list scrolls, horizontal → the row moves
 * - trailing actions slide in from the right; a full swipe (> 60% width)
 *   runs the last one (the destructive one), with a haptic at the threshold
 * - one optional leading action (mark read, pin); a full swipe runs it too
 * - only one row is open at a time; tapping an open row closes it
 * - a right swipe on a closed row without a leading action is left to the
 *   page (swipe-back, pager) — the row does not steal it
 */
import { animate, motion, useMotionValue, useTransform } from 'motion/react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { haptic } from '../../lib/haptics';
import { SPRING } from '../../lib/motion';

export interface SwipeAction {
  label: string;
  Icon: LucideIcon;
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
  onAction: () => void;
}

const TONES = {
  neutral: 'bg-card-3 text-bright',
  accent: 'bg-accent-deep text-white',
  success: 'bg-mint text-bg',
  warning: 'bg-warning text-bg',
  danger: 'bg-danger text-white',
} as const;
const ACTION_W = 68;
const FULL = 0.6;
const bus = new EventTarget();

/** True while any row owns a horizontal drag — a pager can check this and stay put. */
export const swipeState = { active: false };

export function SwipeRow({ children, leading, trailing = [], fullSwipe = true, className }: {
  children: ReactNode;
  leading?: SwipeAction;
  trailing?: SwipeAction[];
  /** Full swipe runs the outermost action. */
  fullSwipe?: boolean;
  className?: string;
}) {
  const id = useId();
  const x = useMotionValue(0);
  const ref = useRef<HTMLDivElement>(null);
  const g = useRef<{ x0: number; y0: number; s0: number; lock: null | 'x' | 'y'; armed: 0 | 1 | -1 } | null>(null);
  // A mouse fires a click after every drag; that click must not count as "tap to close".
  const dragged = useRef(false);
  const openW = trailing.length * ACTION_W;
  const leadW = leading ? ACTION_W : 0;
  const leadScale = useTransform(x, [0, leadW || 1], [0.6, 1]);
  // Actions exist only while the row is moved: at rest they would bleed through the
  // anti-aliased rounded edge of the card as a thin coloured line.
  const trailVis = useTransform(x, (v) => (v < -0.5 ? 'visible' : 'hidden'));
  const leadVis = useTransform(x, (v) => (v > 0.5 ? 'visible' : 'hidden'));
  // At rest the row stays see-through, so the card's surface shows instead of a black slab.
  // While moving, the row needs an opaque face; this is the list's own tone (fill-1 over the ground), so nothing shifts.
  const cover = useTransform(x, (v) => (Math.abs(v) > 0.5 ? 'color-mix(in srgb, var(--color-bg), #fff 2.5%)' : 'rgb(0 0 0 / 0)'));
  const settle = (to: number) => animate(x, to, SPRING.sheet);

  useEffect(() => {
    const onOther = (e: Event) => { if ((e as CustomEvent).detail !== id) settle(0); };
    bus.addEventListener('open', onOther);
    return () => bus.removeEventListener('open', onOther);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const run = (a: SwipeAction) => { settle(0); haptic('select'); a.onAction(); };

  return (
    <div data-no-swipe className={cn('relative overflow-hidden', className)}>
      {trailing.length > 0 && (
        <motion.div className="absolute inset-y-0 right-0 flex" style={{ width: openW, visibility: trailVis }}>
          {trailing.map((a) => (
            <button key={a.label} type="button" onClick={() => run(a)} className={cn('flex flex-1 flex-col items-center justify-center gap-1 text-tiny', TONES[a.tone ?? 'neutral'])}>
              <a.Icon size={16} strokeWidth={1.75} />{a.label}
            </button>
          ))}
        </motion.div>
      )}
      {leading && (
        <motion.button type="button" onClick={() => run(leading)} className={cn('absolute inset-y-0 left-0 flex flex-col items-center justify-center gap-1 text-tiny', TONES[leading.tone ?? 'accent'])}
          style={{ width: leadW, visibility: leadVis }}>
          <motion.span style={{ scale: leadScale }} className="flex flex-col items-center gap-1"><leading.Icon size={16} strokeWidth={1.75} />{leading.label}</motion.span>
        </motion.button>
      )}
      <motion.div
        ref={ref}
        // No text selection: a mouse drag would otherwise select instead of swipe.
        className="relative select-none"
        style={{ x, backgroundColor: cover, touchAction: 'pan-y' }}
        onPointerDown={(e) => { g.current = { x0: e.clientX, y0: e.clientY, s0: x.get(), lock: null, armed: 0 }; }}
        onPointerMove={(e) => {
          const s = g.current;
          if (!s) return;
          const dx = e.clientX - s.x0, dy = e.clientY - s.y0;
          if (!s.lock) {
            if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) { s.lock = 'y'; return; }
            if (Math.abs(dx) <= 8) return;
            if (dx > 0 && !leading && s.s0 === 0) { s.lock = 'y'; return; }
            if (dx < 0 && !trailing.length && s.s0 === 0) { s.lock = 'y'; return; }
            s.lock = 'x';
            ref.current!.setPointerCapture(e.pointerId);
            bus.dispatchEvent(new CustomEvent('open', { detail: id }));
          }
          if (s.lock !== 'x') return;
          swipeState.active = true;
          let next = s.s0 + dx;
          const w = ref.current!.offsetWidth;
          if (!leading && next > 0) next *= 0.2;
          if (!trailing.length && next < 0) next *= 0.2;
          if (!fullSwipe && leading && next > leadW) next = leadW + (next - leadW) * 0.25;
          x.set(next);
          const armed: 0 | 1 | -1 = !fullSwipe ? 0 : -next > w * FULL && trailing.length ? -1 : next > w * FULL * 0.75 && leading ? 1 : 0;
          if (armed !== s.armed) { s.armed = armed; haptic(armed ? 'heavy' : 'tick'); }
        }}
        onPointerUp={() => {
          const s = g.current;
          g.current = null;
          swipeState.active = false;
          if (!s || s.lock !== 'x') return;
          dragged.current = true;
          window.setTimeout(() => { dragged.current = false; }, 0);
          const v = x.getVelocity();
          const cur = x.get();
          const w = ref.current!.offsetWidth;
          if (s.armed === -1) {
            const a = trailing[trailing.length - 1];
            animate(x, -w, SPRING.sheet).then(() => { a.onAction(); x.jump(0); });
          } else if (s.armed === 1 && leading) {
            animate(x, 0, SPRING.sheet);
            leading.onAction();
          } else if (trailing.length && (cur < -openW / 2 || (v < -400 && cur < 0))) settle(-openW);
          else if (leading && (cur > leadW / 2 || (v > 400 && cur > 0))) settle(leadW);
          else settle(0);
        }}
        onPointerCancel={() => { g.current = null; swipeState.active = false; settle(0); }}
        onClickCapture={(e) => { if (dragged.current) { e.stopPropagation(); return; } if (x.get() !== 0) { e.stopPropagation(); settle(0); } }}
      >
        {children}
      </motion.div>
    </div>
  );
}

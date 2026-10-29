/**
 * Slider. A 4px track that fills in the place's colour, an 18px thumb that
 * swells a little while held, a haptic tick at every step, and an optional
 * glass bubble with the value while dragging. Keyboard: arrows, PageUp/Down,
 * Home/End. The whole 44px row is the target, not just the 6px track.
 */
import { animate, motion, useMotionValue, useTransform } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { haptic } from '../../lib/haptics';
import { SPRING } from '../../lib/motion';

export function Slider({ value, onChange, min = 0, max = 100, step = 1, label, format = (v) => String(v), bubble = true, ticks, className }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; label: string;
  format?: (v: number) => string;
  /** Value bubble above the thumb while dragging. */
  bubble?: boolean;
  /** Draw a dot per step (only for few steps). */
  ticks?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const frac = (v: number) => (max === min ? 0 : (v - min) / (max - min));
  const pos = useMotionValue(frac(value));
  const [drag, setDrag] = useState(false);
  const last = useRef(value);

  useEffect(() => { if (!drag) animate(pos, frac(value), SPRING.snap); }, [value, drag]); // eslint-disable-line react-hooks/exhaustive-deps

  const left = useTransform(pos, (p) => `${p * 100}%`);
  const snap = (v: number) => Math.min(max, Math.max(min, Math.round((v - min) / step) * step + min));
  const set = (v: number) => {
    const s = Number(snap(v).toFixed(6));
    if (s !== last.current) { last.current = s; haptic('tick'); onChange(s); }
  };
  const fromPointer = (x: number) => {
    const r = ref.current!.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (x - r.left) / r.width));
    pos.set(p);
    set(min + p * (max - min));
  };

  const steps = ticks ? Math.round((max - min) / step) : 0;
  return (
    <div className={cn('select-none', className)}>
      <div
        ref={ref}
        data-no-swipe
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={format(value)}
        className="relative h-11 cursor-pointer touch-none outline-none [&:focus-visible_.thumb]:ring-2 [&:focus-visible_.thumb]:ring-accent"
        onPointerDown={(e) => { if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); setDrag(true); fromPointer(e.clientX); }}
        onPointerMove={(e) => { if (drag) fromPointer(e.clientX); }}
        onPointerUp={() => { setDrag(false); haptic('select'); }}
        onPointerCancel={() => setDrag(false)}
        onKeyDown={(e) => {
          const big = Math.max(step, (max - min) / 10);
          const d = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step, PageUp: big, PageDown: -big }[e.key];
          if (d !== undefined) { e.preventDefault(); set(value + d); }
          else if (e.key === 'Home') { e.preventDefault(); set(min); }
          else if (e.key === 'End') { e.preventDefault(); set(max); }
        }}
      >
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-fill-3 shadow-well">
          <motion.div className="absolute inset-y-0 left-0 rounded-full bg-tab" style={{ width: left }} />
        </div>
        {steps > 0 && steps <= 20 && (
          <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2">
            {Array.from({ length: steps + 1 }, (_, i) => <i key={i} className="absolute h-[3px] w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/30" style={{ left: `${(i / steps) * 100}%` }} />)}
          </div>
        )}
        <motion.div className="absolute top-1/2" style={{ left }}>
          <motion.span
            className="thumb absolute block h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_4px_rgb(0_0_0/.4),0_0_0_.5px_rgb(0_0_0/.15)]"
            animate={{ scale: drag ? 1.18 : 1 }}
            transition={SPRING.toggle}
          />
          {bubble && (
            <motion.span
              className="glass absolute bottom-[16px] -translate-x-1/2 rounded-full px-2 py-0.5 text-meta tabular whitespace-nowrap text-bright"
              initial={false}
              animate={{ opacity: drag ? 1 : 0, y: drag ? 0 : 4, scale: drag ? 1 : 0.92 }}
              transition={SPRING.pop}
            >
              {format(value)}
            </motion.span>
          )}
        </motion.div>
      </div>
    </div>
  );
}

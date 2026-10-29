/**
 * Odometer: every digit is a reel 0–9 that rolls to its place on a spring
 * (300/30), right to left 30 ms apart, like a counter in an instrument.
 * Digits that stay the same do not move. Width never jumps (tabular figures,
 * fixed cells), so it can sit in a headline. Separators, signs and units swap
 * in place; screen readers get the plain value. Reduced motion: no roll.
 */
import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { SPRING } from '../../lib/motion';

export function Odometer({ value, format = (v) => v.toLocaleString('en-US'), unit, stagger = 0.03, className }: {
  value: number | string;
  format?: (v: number) => string;
  /** Quiet suffix after the number ("h", "%", "kg"). */
  unit?: ReactNode;
  /** Seconds between reels, right to left. */
  stagger?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const text = typeof value === 'number' ? format(value) : value;
  const chars = [...text];
  return (
    <span className={cn('tabular relative inline-flex items-baseline leading-none', className)} aria-label={text} role="img">
      {chars.map((ch, i) => {
        const fromRight = chars.length - 1 - i;
        const d = ch.charCodeAt(0) - 48;
        if (d < 0 || d > 9) return <span key={`s${fromRight}`} aria-hidden="true">{ch}</span>;
        return (
          // One cell, exactly one digit wide; the reel inside rolls. Keys count from the right,
          // so 9 → 10 adds a reel on the left instead of re-rolling every digit.
          <span key={`d${fromRight}`} aria-hidden="true" className="relative inline-block h-[1em] overflow-hidden">
            <motion.span className="flex flex-col" initial={false} animate={{ y: `${-d * 10}%` }}
              transition={reduce ? { duration: 0 } : { ...SPRING.soft, delay: fromRight * stagger }}>
              {Array.from({ length: 10 }, (_, n) => <span key={n} className="block h-[1em] leading-none">{n}</span>)}
            </motion.span>
          </span>
        );
      })}
      {unit && <span aria-hidden="true" className="ml-[.18em] text-[.42em] tracking-normal text-dim">{unit}</span>}
    </span>
  );
}

/** @deprecated Use Odometer — same reels, plus units and string values. */
export const NumberTicker = Odometer;

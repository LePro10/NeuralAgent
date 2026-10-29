/**
 * Lines that rise out of a mask, as if set: for page titles and the one
 * sentence a hero leads with. Children are the lines — wrap each in
 * <RevealText.Line>, or pass a plain string for one line. 0.7 s per line,
 * 90 ms apart, ease-out-soft; it plays on mount, or when scrolled into view
 * with `inView`, and again when `replayKey` changes. Reduced motion: still.
 */
import { motion, useReducedMotion } from 'motion/react';
import { Children, isValidElement, type ElementType, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { EASE } from '../../lib/motion';

export function RevealText({ children, as: Tag = 'div', delay = 0, stagger = 0.09, duration = 0.7, inView, replayKey, className }: {
  children: ReactNode;
  as?: ElementType;
  delay?: number;
  stagger?: number;
  duration?: number;
  /** Play when it scrolls into view (once) instead of on mount. */
  inView?: boolean;
  replayKey?: unknown;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const lines = Children.toArray(children).map((c) => (isValidElement(c) && c.type === Line ? c : <Line>{c}</Line>));
  return (
    <Tag className={className}>
      {lines.map((line, i) => {
        const shown = { y: 0 };
        const from = reduce ? false : { y: '108%' };
        const transition = { duration, ease: EASE.outSoft, delay: delay + i * stagger };
        return (
          // The mask keeps descenders: a little padding below, taken back by a negative margin.
          <span key={`${String(replayKey)}-${i}`} className="block overflow-hidden pb-[.12em] -mb-[.12em]">
            <motion.span className={cn('block', (line.props as { className?: string }).className)} initial={from}
              {...(inView ? { whileInView: shown, viewport: { once: true, margin: '-8% 0px' } } : { animate: shown })} transition={transition}>
              {(line.props as { children: ReactNode }).children}
            </motion.span>
          </span>
        );
      })}
    </Tag>
  );
}

/** One line of a RevealText (its className styles the line, e.g. a dimmer second line). */
function Line({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={className}>{children}</span>;
}
RevealText.Line = Line;

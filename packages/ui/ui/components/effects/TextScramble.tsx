/**
 * Decode: characters cycle through glyphs and settle left to right into the
 * text. For a single label that changes meaning (a status, a code, a title
 * reveal) — sparingly. Width is held by the final text, so nothing jumps;
 * reduced motion shows the text at once.
 */
import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { prefersReducedMotion } from '../../lib/motion';

const GLYPHS = '▖▗▘▙▚▛▜▝▞▟░▒abcdefghijklmnopqrstuvwxyz0123456789';

export function TextScramble({ text, duration = 700, className, trigger }: { text: string; duration?: number; className?: string; /** Change to replay. */ trigger?: unknown }) {
  const [out, setOut] = useState(text);
  const raf = useRef(0);
  useEffect(() => {
    if (prefersReducedMotion()) { setOut(text); return; }
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const settled = Math.floor(p * text.length);
      setOut([...text].map((c, i) => (i < settled || c === ' ' ? c : GLYPHS[(Math.random() * GLYPHS.length) | 0])).join(''));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [text, duration, trigger]);
  return (
    <span className={cn('relative inline-block', className)} aria-label={text}>
      <span className="invisible" aria-hidden="true">{text}</span>
      <span className="absolute inset-0 whitespace-pre" aria-hidden="true">{out}</span>
    </span>
  );
}

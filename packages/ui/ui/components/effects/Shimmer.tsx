/**
 * "Working…" label with a light sweeping across it (see `.shimmer` in
 * effects.css): one element, the light is a gradient clipped to the letters,
 * so the text itself never moves.
 */
import type { CSSProperties, ReactNode } from 'react';
import { cn } from '../../lib/cn';

export function Shimmer({ children, speed, color, className }: { children: ReactNode; /** seconds per sweep */ speed?: number; /** colour of the light */ color?: string; className?: string }) {
  const style = { ...(speed ? { ['--shimmer-speed' as string]: `${speed}s` } : {}), ...(color ? { ['--shimmer-color' as string]: color } : {}) } as CSSProperties;
  return (
    <span className={cn('shimmer', className)} style={style}>
      {children}
    </span>
  );
}

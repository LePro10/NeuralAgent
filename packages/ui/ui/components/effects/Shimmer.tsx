/**
 * "Working…" label with a light sweeping across it, compositor only (see
 * `.shimmer` in effects.css). The text is rendered twice: the dim base and a
 * bright copy under the moving band, hidden from assistive tech.
 */
import type { CSSProperties, ReactNode } from 'react';
import { cn } from '../../lib/cn';

export function Shimmer({ children, speed, color, className }: { children: ReactNode; /** seconds per sweep */ speed?: number; /** colour of the light */ color?: string; className?: string }) {
  const style = { ...(speed ? { ['--shimmer-speed' as string]: `${speed}s` } : {}), ...(color ? { ['--shimmer-color' as string]: color } : {}) } as CSSProperties;
  return (
    <span className={cn('shimmer', className)} style={style}>
      {children}
      <span aria-hidden="true" className="shimmer-band"><span>{children}</span></span>
    </span>
  );
}

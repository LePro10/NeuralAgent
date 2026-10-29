/**
 * Light border — the "Now" frame: a thin light runs around the edge and a
 * soft glow breathes behind it. Marks the one item that is happening right now (the
 * running task, the live call, the current lesson). One per screen.
 *
 * Only `transform` (the sweep) and `opacity` (the glow) animate, on their own
 * child layers; the content is opaque, so the light shows only at the seam.
 * It is `.deko`: it rests in rest mode, on hidden pages and with reduced motion.
 */
import type { CSSProperties, ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface LightBorderProps {
  children: ReactNode;
  /** Corner radius in px (outer). */
  radius?: number;
  /** Visible width of the light seam in px. */
  width?: number;
  /** Seconds per lap. */
  speed?: number;
  /** 0–1, strength of the breathing glow behind. */
  glow?: number;
  /** Bright head / tail colour of the sweep (default: the accent theme's --ring-a / --ring-b). */
  colors?: [string, string];
  /** Background of the content (default: dark with a faint lit corner). */
  surface?: string;
  /** Stops the loop (e.g. when the item is no longer "now"). */
  paused?: boolean;
  className?: string;
  contentClassName?: string;
}

export function LightBorder({ children, radius = 18, width = 1, speed = 6, glow = 0.7, colors, surface, paused, className, contentClassName }: LightBorderProps) {
  const style = {
    '--lb-radius': `${radius}px`,
    '--lb-width': `${width}px`,
    '--lb-speed': `${speed}s`,
    '--lb-glow': String(glow),
    ...(colors ? { '--ring-a': colors[0], '--ring-b': colors[1] } : {}),
  } as CSSProperties;
  return (
    <div className={cn('light-border deko', paused && 'is-paused', className)} style={style}>
      {glow > 0 && <i aria-hidden="true" className="light-border-glow" />}
      <i aria-hidden="true" className="light-border-ring"><i /></i>
      <div className={cn('light-border-content', contentClassName)} style={surface ? { background: surface } : undefined}>{children}</div>
    </div>
  );
}

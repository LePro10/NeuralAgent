/**
 * The mark at work: a short light runs along the "n" while the dot breathes.
 * Use it wherever the app is busy on your behalf (header, thinking, sync) —
 * calmer and more specific than a glowing orb.
 *
 * Only `stroke-dashoffset` and `transform` animate; at rest (`active` false)
 * it is the plain mark. Decorative loop: carries `.deko`, so rest mode and
 * hidden pages pause it, and reduced motion stops it.
 */
import type { CSSProperties } from 'react';
import { cn } from '../../lib/cn';
import { N_DOT, N_PATH } from './Logo';

export function LogoLoader({ size = 24, active = true, speed = 1.6, label = 'Working', className }: {
  size?: number;
  /** Running light on/off; off shows the resting mark. */
  active?: boolean;
  /** Seconds per lap. */
  speed?: number;
  label?: string;
  className?: string;
}) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} role="img" aria-label={active ? label : undefined} aria-hidden={active ? undefined : true}
      className={cn('shrink-0 overflow-visible', className)} style={{ ['--ll-speed' as string]: `${speed}s` } as CSSProperties}>
      <path d={N_PATH} fill="none" stroke="currentColor" strokeOpacity={active ? 0.18 : 0.9} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" style={{ transition: 'stroke-opacity .4s' }} />
      {active && <path d={N_PATH} className="logo-run deko" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" pathLength={100} strokeDasharray="18 82" />}
      <circle cx={N_DOT.cx} cy={N_DOT.cy} r={N_DOT.r} fill="currentColor" className={cn(active && 'logo-dot deko')} />
    </svg>
  );
}

/**
 * Activity marks: one vocabulary for "what are the agents behind this item doing",
 * the same in the sidebar, the tab bar and list rows.
 *
 *   working → a thin light runs around the icon (compositor-only spin; static ring with reduced motion)
 *   waiting → pulsing accent dot: it needs your input
 *   done    → ember dot: an agent finished and you have not looked yet — ember means only this
 *   error   → red dot
 *
 * Place <ActivityMark> inside the icon's `relative` wrapper; it sits on the icon's
 * top-right corner (dots) or around it (ring). `edge` is the background the dot is
 * cut out of (a ring-* class, e.g. ring-chrome in the sidebar).
 */
import { cn } from '../../lib/cn';

export type Activity = 'working' | 'waiting' | 'done' | 'error';

export const ACTIVITY_LABEL: Record<Activity, string> = {
  working: 'Working',
  waiting: 'Needs input',
  done: 'Finished',
  error: 'Error',
};

/** Which one wins when several agents disagree: you are needed > broke > busy > finished. */
export const ACTIVITY_RANK: Activity[] = ['waiting', 'error', 'working', 'done'];
export function topActivity(list: (Activity | null | undefined)[]): Activity | undefined {
  return ACTIVITY_RANK.find((a) => list.includes(a));
}

const DOT: Record<Exclude<Activity, 'working'>, string> = {
  waiting: 'bg-accent',
  done: 'bg-ember',
  error: 'bg-danger',
};

export function ActivityMark({ activity, shape = 'round', edge = 'ring-bg', size = 8, corner = '-top-0.5 -right-1', className }: {
  activity?: Activity | null;
  /** Ring outline: round (glyphs) or tile (rounded squares). */
  shape?: 'round' | 'tile';
  /** ring-* class matching the surface behind the dot. */
  edge?: string;
  /** Dot diameter in px. */
  size?: number;
  /** Position classes of the dot on the icon. */
  corner?: string;
  className?: string;
}) {
  if (!activity) return null;
  if (activity === 'working') {
    return <i aria-hidden="true" data-shape={shape} className={cn('activity-ring', className)}><i /></i>;
  }
  return (
    <i aria-hidden="true"
      className={cn('absolute rounded-full ring-2', corner, DOT[activity], activity === 'waiting' && 'activity-pulse', edge, className)}
      style={{ width: size, height: size }} />
  );
}

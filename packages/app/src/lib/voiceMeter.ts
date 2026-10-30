/**
 * Motion for the voice pill's level bars: the daemon-side mic sends a 0..1 loudness ~25 times a
 * second, these helpers turn it into smooth per-bar heights at display rate. Pure functions so
 * the feel can be tested without a browser.
 */

/** Smallest bar height (fraction of the full height) so silence still reads as a calm row. */
export const METER_REST = 0.16;
/** Rises fast so syllables land, falls slower so the bars do not flicker between words. */
const ATTACK_MS = 45;
const RELEASE_MS = 170;
/** No level for this long (dropped events, mic closed): treat as silence. */
export const METER_STALE_MS = 180;

/** Moves `current` towards `target` over `dtMs` with separate attack and release time constants. */
export function approach(current: number, target: number, dtMs: number, attackMs = ATTACK_MS, releaseMs = RELEASE_MS) {
  const tau = target > current ? attackMs : releaseMs;
  return current + (target - current) * (1 - Math.exp(-Math.max(0, dtMs) / tau));
}

/** Louder in the middle, softer at the edges: a gentle arch across `count` bars (0.55..1). */
export function barProfile(count: number): number[] {
  const mid = (count - 1) / 2;
  return Array.from({ length: count }, (_, i) => 1 - 0.45 * (mid ? Math.abs(i - mid) / mid : 0) ** 1.6);
}

/** Target height of bar `i` while listening: the level on the arch, with a small living wobble. */
export function listeningHeight(level: number, profile: number, i: number, tSec: number) {
  const wobble = 0.84 + 0.16 * Math.sin(tSec * 7.3 + i * 1.9) * Math.sin(tSec * 3.1 + i * 0.7);
  return METER_REST + (1 - METER_REST) * Math.min(1, Math.max(0, level)) * profile * wobble;
}

/** Target height of bar `i` while transcribing: low bars with a slow shimmer travelling across. */
export function writingHeight(i: number, tSec: number) {
  return METER_REST + 0.14 * (0.5 + 0.5 * Math.sin(tSec * 4.2 - i * 0.9));
}

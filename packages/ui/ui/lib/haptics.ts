/**
 * One haptics API. Web: navigator.vibrate (Android Chrome; iOS ignores it).
 * Native shells register a driver once (Capacitor Haptics, a JS bridge …).
 *
 * - tick     a detent passed (slider step, snap point, lens over a tab)
 * - select   a choice was made (tab, chip, segment, toggle)
 * - heavy    a commit (save, send, delete confirmed)
 * - success / warning   outcome of an async action
 */
export type Haptic = 'tick' | 'select' | 'heavy' | 'success' | 'warning';

const PATTERN: Record<Haptic, number | number[]> = { tick: 4, select: 8, heavy: 18, success: [8, 40, 12], warning: [14, 60, 14] };

let driver: ((kind: Haptic) => void) | null = null;

/** Route haptics to a native implementation. */
export function setHapticDriver(fn: ((kind: Haptic) => void) | null) { driver = fn; }

export function haptic(kind: Haptic = 'select') {
  if (driver) { driver(kind); return; }
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try { navigator.vibrate(PATTERN[kind]); } catch { /* blocked until first user gesture */ }
  }
}

/**
 * Pure rules behind the phone chrome (keyboard, hide-on-scroll, toasts), kept free of
 * React and the DOM so they are unit-tested (`chrome.test.ts`). The hooks that feed them
 * live in `keyboard.ts` and `hooks.ts`.
 */

export type KeyboardPlatform = 'android' | 'ios' | 'other';

export interface ViewportSample {
  platform: KeyboardPlatform;
  /** A text field has focus (input, textarea, contenteditable). */
  typing: boolean;
  /** window.innerHeight: the layout viewport (shrinks on Android when the keyboard resizes it). */
  innerHeight: number;
  /** visualViewport.height / offsetTop: what is visible above an overlaying keyboard (iOS). */
  vvHeight: number;
  vvOffsetTop: number;
  /** The tallest the layout has been at this width (no keyboard). */
  full: number;
  /** Coarse pointer without hover (a touch screen). */
  touch: boolean;
  /** The focused field was tapped by the user a moment ago (not focused by code). */
  userFocus: boolean;
}

export interface KeyboardState {
  open: boolean;
  /** px the keyboard covers at the bottom of the layout viewport (overlay keyboards: iOS). */
  inset: number;
}

/** Anything smaller is browser chrome (URL bar) moving, not a keyboard. */
export const KB_MIN = 120;

/**
 * Is the on-screen keyboard up, and how much does it cover?
 * - Android (WebView / Chrome with resizes-content): the layout itself shrinks. Trust geometry
 *   only, so a keyboard dismissed with Back (field still focused) reads as closed at once.
 * - iOS (Safari / PWA): the keyboard overlays; the visual viewport shrinks, the layout does not.
 * - Other touch devices: geometry, or a field the user tapped (some WebViews give no signal).
 */
export function keyboardState(s: ViewportSample): KeyboardState {
  const inset = Math.max(0, Math.round(s.innerHeight - (s.vvOffsetTop + s.vvHeight)));
  const overlay = inset >= KB_MIN ? inset : 0;
  const shrunk = s.full - Math.min(s.innerHeight, s.vvHeight + s.vvOffsetTop) >= Math.max(KB_MIN, s.full * 0.18);
  if (!s.typing) return { open: false, inset: 0 };
  if (s.platform === 'android') return { open: shrunk || overlay > 0, inset: overlay };
  if (s.platform === 'ios') return { open: overlay > 0 || shrunk, inset: overlay };
  return { open: shrunk || overlay > 0 || (s.touch && s.userFocus), inset: overlay };
}

export function detectPlatform(ua: string, maxTouchPoints = 0): KeyboardPlatform {
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && maxTouchPoints > 1)) return 'ios';
  return 'other';
}

export interface ScrollSample {
  /** scrollTop */
  y: number;
  /** scrollHeight - clientHeight */
  max: number;
}

export interface HideState {
  hidden: boolean;
  /** Last scrollTop seen. */
  y: number;
  /** Distance travelled in the current direction (px, + down, − up). */
  run: number;
}

export const HIDE_START: HideState = { hidden: false, y: 0, run: 0 };

/**
 * One step of "hide while scrolling down, show on the way back". Chrome hides after
 * `threshold` px of continuous downward scroll and returns after half of that upward, or
 * whenever the list is near its top or its end (so the last row is never under it).
 */
export function hideStep(prev: HideState, s: ScrollSample, threshold = 24, edge = 8): HideState {
  const dy = s.y - prev.y;
  if (s.max <= edge * 4 || s.y <= edge || s.y >= s.max - edge) return { hidden: false, y: s.y, run: 0 };
  if (dy === 0) return prev;
  const run = Math.sign(dy) === Math.sign(prev.run) ? prev.run + dy : dy;
  let hidden = prev.hidden;
  if (run >= threshold) hidden = true;
  else if (run <= -threshold / 2) hidden = false;
  return { hidden, y: s.y, run };
}

/**
 * Phones show one toast: the newest that is allowed on a phone, except that a toast with an
 * action (Undo) or an error outranks a newer plain one while it is alive (newest of those wins).
 */
export function phoneToasts<T extends { desktopOnly?: boolean; undo?: unknown; tone?: string }>(list: T[]): T[] {
  const ok = list.filter((t) => !t.desktopOnly);
  const urgent = ok.filter((t) => t.undo || t.tone === 'danger');
  return (urgent.length ? urgent : ok).slice(-1);
}

/** Previous / next id in a list (agent swipe on the Island); null at the ends. */
export function neighbour(ids: string[], current: string, dir: -1 | 1): string | null {
  const i = ids.indexOf(current);
  if (i < 0) return null;
  return ids[i + dir] ?? null;
}

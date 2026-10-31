/**
 * The on-screen keyboard, once for the whole app (C3): one listener set feeds a tiny store,
 * every `useKeyboard()` reads it. The rule itself is pure and tested (`keyboardState` in chrome.ts):
 * Android trusts the layout height (the WebView resizes), iOS the visual-viewport inset (the
 * keyboard overlays). `inset` is what a composer must lift by on iOS; it is 0 on Android.
 */
import { useSyncExternalStore } from 'react';
import { detectPlatform, keyboardState, type KeyboardState } from './chrome';

const CLOSED: KeyboardState = { open: false, inset: 0 };
let state: KeyboardState = CLOSED;
const subs = new Set<() => void>();
let stop: (() => void) | null = null;

const FIELD = 'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=button]):not([type=submit]), textarea, [contenteditable="true"], [contenteditable=""]';

function start() {
  const vv = window.visualViewport;
  const platform = detectPlatform(navigator.userAgent, navigator.maxTouchPoints);
  let width = window.innerWidth;
  let full = Math.max(window.innerHeight, vv?.height ?? 0);
  // Only a field the user tapped counts on its own: code that focuses a field (a terminal
  // taking focus when it opens) does not raise the keyboard.
  let tapped: { el: Element; at: number } | null = null;
  let userFocus = false;
  const down = (e: PointerEvent) => { if (e.target instanceof Element) tapped = { el: e.target, at: performance.now() }; };
  const focusin = (e: FocusEvent) => {
    const f = e.target instanceof Element ? e.target : null;
    const t = tapped && performance.now() - tapped.at < 1000 ? tapped.el : null;
    userFocus = !!(f && t && (t === f || t.contains(f) || f.contains(t) || t.closest('label, .xterm')?.contains(f)));
    check();
  };
  let raf = 0;
  const check = () => {
    // A rotation or a split screen changes the width: start measuring "full" again.
    const typing = !!document.activeElement?.matches?.(FIELD);
    if (window.innerWidth !== width) {
      width = window.innerWidth;
      // With a field focused the keyboard may already shrink the height: take the larger of the
      // screen's long/short side fitting this width instead, and let blur/visibility re-measure.
      const long = Math.max(screen.height, screen.width), short = Math.min(screen.height, screen.width);
      const est = Math.round((width <= short ? long : short) * 0.92); // minus system bars
      full = typing ? Math.max(window.innerHeight, vv?.height ?? 0, est) : window.innerHeight;
    }
    full = Math.max(full, window.innerHeight);
    const touch = matchMedia('(pointer: coarse)').matches && !matchMedia('(hover: hover)').matches;
    const next = keyboardState({
      platform, typing, touch, userFocus, full,
      innerHeight: window.innerHeight,
      vvHeight: vv?.height ?? window.innerHeight,
      vvOffsetTop: vv?.offsetTop ?? 0,
    });
    if (next.open === state.open && next.inset === state.inset) return;
    state = next.open || next.inset ? next : CLOSED;
    document.documentElement.style.setProperty('--kb-inset', `${state.inset}px`);
    subs.forEach((s) => s());
  };
  // Focus moves before the keyboard animates: check again over the next frames.
  const soon = () => { cancelAnimationFrame(raf); check(); raf = requestAnimationFrame(() => { check(); window.setTimeout(check, 250); }); };
  vv?.addEventListener('resize', soon);
  vv?.addEventListener('scroll', check);
  window.addEventListener('resize', soon);
  window.addEventListener('pointerdown', down, true);
  window.addEventListener('focusin', focusin);
  window.addEventListener('focusout', soon);
  const visible = () => { if (document.visibilityState === 'visible') soon(); };
  document.addEventListener('visibilitychange', visible);
  check();
  return () => {
    cancelAnimationFrame(raf);
    vv?.removeEventListener('resize', soon);
    vv?.removeEventListener('scroll', check);
    window.removeEventListener('resize', soon);
    window.removeEventListener('pointerdown', down, true);
    window.removeEventListener('focusin', focusin);
    window.removeEventListener('focusout', soon);
    document.removeEventListener('visibilitychange', visible);
  };
}

function subscribe(cb: () => void) {
  subs.add(cb);
  if (!stop && typeof window !== 'undefined') stop = start();
  return () => {
    subs.delete(cb);
    if (!subs.size && stop) { stop(); stop = null; state = CLOSED; }
  };
}

/** The keyboard right now (outside React). */
export const keyboardNow = () => state;

/** `{ open, inset }`: open = the on-screen keyboard is up; inset = px it overlays (iOS), else 0. */
export function useKeyboard(): KeyboardState {
  return useSyncExternalStore(subscribe, () => state, () => CLOSED);
}

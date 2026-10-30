import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

/** The one breakpoint: below it is a phone (tab bar, sheets), above it desktop (sidebar, dialogs). */
export const DESKTOP = 900;

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => { const m = window.matchMedia(query); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb); },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Layout choice (sheet vs. dialog, tab bar vs. sidebar). Components in narrow panes use @container instead. */
export const useDesktop = () => useMediaQuery(`(min-width: ${DESKTOP}px)`);
/** A real mouse: hover states, right-click menus, Enter-to-send. */
export const useFinePointer = () => useMediaQuery('(hover: hover) and (pointer: fine)');
export const useReducedMotion = () => useMediaQuery('(prefers-reduced-motion: reduce)');

/**
 * Is the on-screen keyboard open? (visual viewport shrank by > 20%.)
 * Floating chrome (tab bar, FABs) hides while it is; composers drop their tab-bar gap.
 */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    // The tallest the screen has been at this width: a keyboard that resizes the layout
    // (interactive-widget=resizes-content, Android) shrinks innerHeight too.
    let width = window.innerWidth, full = Math.max(window.innerHeight, vv.height);
    // Only a field the user tapped counts on its own: code that focuses a field (a terminal
    // taking focus when it opens) does not raise the keyboard.
    let tapped: { el: Element; at: number } | null = null;
    const down = (e: PointerEvent) => { if (e.target instanceof Element) tapped = { el: e.target, at: performance.now() }; };
    let userFocus = false;
    const focusin = (e: FocusEvent) => {
      const f = e.target instanceof Element ? e.target : null;
      const t = tapped && performance.now() - tapped.at < 1000 ? tapped.el : null;
      userFocus = !!(f && t && (t === f || t.contains(f) || f.contains(t) || t.closest('label, .xterm')?.contains(f)));
      check();
    };
    const check = () => {
      if (window.innerWidth !== width) { width = window.innerWidth; full = Math.max(window.innerHeight, vv.height); }
      full = Math.max(full, window.innerHeight, vv.height);
      const typing = !!document.activeElement?.matches?.('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]), textarea, [contenteditable="true"]');
      // Touch screens without a resize signal (some WebViews, a keyboard that overlays the page):
      // a focused text field on a coarse pointer means the on-screen keyboard is up.
      const touch = matchMedia('(pointer: coarse)').matches && !matchMedia('(hover: hover)').matches;
      setOpen(typing && (vv.height < full * 0.8 || (touch && userFocus)));
    };
    check();
    vv.addEventListener('resize', check);
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('focusin', focusin);
    window.addEventListener('focusout', check);
    return () => {
      vv.removeEventListener('resize', check);
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('focusin', focusin);
      window.removeEventListener('focusout', check);
    };
  }, []);
  return open;
}

/** Keeps the latest value in a ref — for handlers inside long-lived effects. */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/** Platform modifier label for shortcuts. */
export const MOD_KEY = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl ';

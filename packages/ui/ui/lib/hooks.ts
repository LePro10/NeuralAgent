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
    const full = window.innerHeight;
    const check = () => setOpen(vv.height < full * 0.8);
    vv.addEventListener('resize', check);
    return () => vv.removeEventListener('resize', check);
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

import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { HIDE_START, hideStep, type HideState } from './chrome';
import { useKeyboard } from './keyboard';

export { useKeyboard, keyboardNow } from './keyboard';

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
 * Is the on-screen keyboard open? One shared store (lib/keyboard.ts): Android reads the layout
 * height, iOS the visual-viewport inset. Floating chrome (Dock, Island) hides while it is open.
 */
export function useKeyboardOpen(): boolean {
  return useKeyboard().open;
}

/**
 * Chrome that hides while you scroll down and returns on the way back (Dock, Island).
 * Watches every vertical scroller inside `ref` (capture phase), so `ref` can be a whole
 * screen; horizontal scrollers (code blocks, chip rows) are ignored. Only the boolean
 * crosses into React: scrolling itself never re-renders. `resetKey` changing (the active tab) shows it again. Rules: `hideStep` (chrome.ts).
 */
export function useHideOnScroll(ref: RefObject<HTMLElement | null>, { disabled = false, threshold = 24, resetKey }: { disabled?: boolean; threshold?: number; resetKey?: unknown } = {}): boolean {
  const [hidden, setHidden] = useState(false);
  // A new page (tab switch) starts shown, even when it is too short to scroll.
  useEffect(() => { setHidden(false); }, [resetKey]);
  useEffect(() => {
    const root = ref.current;
    if (!root || disabled) { setHidden(false); return; }
    const states = new WeakMap<Element, HideState>();
    let last: Element | null = null;
    const on = (e: Event) => {
      const el = e.target;
      if (!(el instanceof Element) || el.scrollHeight - el.clientHeight < 1 || el.matches('textarea, input, [data-no-hide]')) return;
      const y = el.scrollTop;
      const prev = states.get(el) ?? { ...HIDE_START, y };
      // A sideways scroll leaves scrollTop alone: nothing to do.
      if (prev.y === y && states.has(el)) return;
      // Another scroller took over (a sheet, a new page): start from its position.
      const base = last === el ? prev : { ...HIDE_START, y: prev.y, hidden: false };
      last = el;
      const next = hideStep(base, { y, max: el.scrollHeight - el.clientHeight }, threshold);
      states.set(el, next);
      setHidden(next.hidden);
    };
    root.addEventListener('scroll', on, { capture: true, passive: true });
    return () => root.removeEventListener('scroll', on, { capture: true });
  }, [ref, disabled, threshold]);
  return hidden;
}

/** Keeps the latest value in a ref — for handlers inside long-lived effects. */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/** Platform modifier label for shortcuts. */
export const MOD_KEY = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl ';

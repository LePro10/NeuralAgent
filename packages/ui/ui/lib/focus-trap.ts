/**
 * Keyboard focus for sheets, dialogs and menus: Tab stays inside while open,
 * and on close focus returns to whatever opened it. Traps stack — only the
 * topmost reacts. Keys a component already handled (preventDefault) are left alone.
 */
import { useEffect, type RefObject } from 'react';

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', "input:not([disabled]):not([type='hidden'])", 'select:not([disabled])',
  'textarea:not([disabled])', 'iframe', "[contenteditable='true']", "[tabindex]:not([tabindex='-1'])",
].join(',');

export function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
    if (el.closest('[inert]') || el.getAttribute('aria-hidden') === 'true' || el.hidden) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && el.tabIndex >= 0;
  });
}

const traps: symbol[] = [];

/**
 * Focus goes to the container itself on open (not the first button, which is
 * usually "Close"); a field with autoFocus keeps it.
 */
export function useFocusTrap(active: boolean, container: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!active) return;
    const me = Symbol('trap');
    traps.push(me);
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const start = window.setTimeout(() => {
      const el = container.current;
      if (!el || el.contains(document.activeElement)) return;
      if (!el.hasAttribute('tabindex')) el.tabIndex = -1;
      el.focus({ preventScroll: true });
    }, 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || e.defaultPrevented || traps.at(-1) !== me) return;
      const el = container.current;
      if (!el) return;
      const list = focusableIn(el);
      e.preventDefault();
      if (!list.length) { el.focus({ preventScroll: true }); return; }
      const i = list.indexOf(document.activeElement as HTMLElement);
      const next = i < 0 ? (e.shiftKey ? list.length - 1 : 0) : (i + (e.shiftKey ? -1 : 1) + list.length) % list.length;
      list[next]?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(start);
      document.removeEventListener('keydown', onKey);
      traps.splice(traps.indexOf(me), 1);
      // Only hand focus back if it is still inside (or nowhere) — a deliberate click elsewhere wins.
      const now = document.activeElement;
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const inside = !now || now === document.body || container.current?.contains(now);
      if (inside && before?.isConnected) before.focus({ preventScroll: true });
    };
  }, [active, container]);
}

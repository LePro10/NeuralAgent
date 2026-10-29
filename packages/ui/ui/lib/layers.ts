/**
 * Overlay stack for sheets, menus, context menus, search, lightboxes.
 *
 * - Escape closes only the topmost layer (a menu inside a sheet closes the menu,
 *   not both). A component that needs Escape itself calls `preventDefault()`.
 * - The browser / Android back gesture closes the topmost layer instead of
 *   leaving the page: every open layer pushes one history entry.
 */
import { useEffect, useId, useRef } from 'react';

interface Layer { key: string; close: () => void; }
const stack: Layer[] = [];
let ignorePops = 0;
let useHistory = true;
let listening = false;

/** Turn the history integration off (e.g. inside an embedded widget). */
export function configureLayers(opts: { history?: boolean }) {
  if (opts.history !== undefined) useHistory = opts.history;
}

function listen() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('popstate', () => {
    if (ignorePops > 0) { ignorePops--; return; }
    stack.pop()?.close();
  });
}

export const isTopLayer = (key: string) => stack.at(-1)?.key === key;
export const openLayerCount = () => stack.length;

/**
 * Registers an overlay while `open`. `close` must set your state to closed.
 * Options: `escape` (default true) closes on Escape when this layer is on top.
 */
export function useLayer(open: boolean, close: () => void, opts: { escape?: boolean } = {}) {
  const key = useId();
  const closeRef = useRef(close);
  closeRef.current = close;
  const escape = opts.escape ?? true;

  useEffect(() => {
    if (!open) return;
    listen();
    const layer: Layer = { key, close: () => closeRef.current() };
    stack.push(layer);
    if (useHistory) history.pushState({ ...(history.state ?? {}), layer: key }, '');
    return () => {
      const i = stack.indexOf(layer);
      if (i < 0) return; // closed by the back gesture: its entry is already gone
      stack.splice(i, 1);
      if (useHistory && history.state?.layer === key) { ignorePops++; history.back(); }
    };
  }, [open, key]);

  useEffect(() => {
    if (!open || !escape) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing || !isTopLayer(key)) return;
      e.preventDefault();
      closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, escape, key]);
}

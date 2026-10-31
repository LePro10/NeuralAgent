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

/** Layer keys of the history entries up to the current one (each layer entry carries the chain). */
type LayerState = { layer?: string; layers?: string[] } | null;
const chainOf = (st: LayerState): string[] => st?.layers ?? (st?.layer ? [st.layer] : []);

/** How many of the newest layer entries belong to layers that closed (they go in one step). */
export function closedOnTop(chain: readonly string[], closed: ReadonlySet<string>): number {
  let n = 0;
  while (n < chain.length && closed.has(chain[chain.length - 1 - n]!)) n++;
  return n;
}

// Layers closed in this task (not by Back): their entries leave together with one history.go(-n).
// Two layers closing in one commit (a menu inside a sheet) used to leave a dead entry behind,
// because history.back() is async and only the first cleanup saw its own entry on top.
const closing = new Set<string>();
let flushQueued = false;
function flushClosing() {
  flushQueued = false;
  const n = closedOnTop(chainOf(history.state as LayerState), closing);
  closing.clear();
  if (n > 0) { ignorePops++; history.go(-n); }
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
    if (useHistory) {
      const st = history.state as LayerState;
      const chain = chainOf(st);
      const top = chain.at(-1);
      if (top && closing.has(top) && st?.layer === top) {
        // A layer that closed in this same commit hands its entry over (sheet → other sheet).
        closing.delete(top);
        history.replaceState({ ...(st ?? {}), layer: key, layers: [...chain.slice(0, -1), key] }, '');
      } else {
        history.pushState({ ...(st ?? {}), layer: key, layers: [...chain, key] }, '');
      }
    }
    return () => {
      const i = stack.indexOf(layer);
      if (i < 0) return; // closed by the back gesture: its entry is already gone
      stack.splice(i, 1);
      if (!useHistory) return;
      closing.add(key);
      if (!flushQueued) { flushQueued = true; queueMicrotask(flushClosing); }
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

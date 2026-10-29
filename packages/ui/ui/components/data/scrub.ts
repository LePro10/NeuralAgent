/**
 * Scrubbing a chart with mouse or finger.
 *
 * - Mouse: hovering shows the value under the pointer; leaving returns to the pin.
 * - Touch: the page keeps scrolling over the chart (`touch-pan-y`); a value is
 *   picked on drag or release, and a tap *pins* it — otherwise the value would
 *   only be visible while the finger covers it. If the browser starts
 *   scrolling, `pointercancel` drops the half-made choice.
 * - Each new index ticks (haptic).
 * `points`: values sit on edges (lines, i/(n-1)) instead of in columns (bars).
 */
import { useState } from 'react';
import { haptic } from '../../lib/haptics';

export function useScrub(n: number, points = false) {
  const [hover, setHover] = useState<number | null>(null);
  const [pin, setPin] = useState<number | null>(null);
  const at = (e: React.PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const f = (e.clientX - r.left) / r.width;
    return Math.max(0, Math.min(n - 1, points ? Math.round(f * (n - 1)) : Math.floor(f * n)));
  };
  const pick = (e: React.PointerEvent<HTMLElement>) => {
    const i = at(e);
    setHover((old) => { if (old !== i) haptic('tick'); return i; });
    return i;
  };
  const handlers = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => { if (e.pointerType !== 'touch') { e.currentTarget.setPointerCapture(e.pointerId); pick(e); } },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => { if (e.buttons || e.pointerType === 'mouse') pick(e); },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
      const i = pick(e);
      setPin(i);
      if (e.pointerType === 'touch') setHover(null);
    },
    onPointerCancel: () => setHover(null),
    onPointerLeave: (e: React.PointerEvent<HTMLElement>) => { if (e.pointerType === 'mouse') setHover(null); },
  };
  return { hover, pin, active: hover ?? pin, handlers, clear: () => { setHover(null); setPin(null); } };
}

export const num = (v: number) => (Number.isInteger(v) ? v.toLocaleString('en-US') : v.toFixed(1));

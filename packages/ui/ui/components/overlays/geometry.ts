/**
 * Overlays position themselves with `position: fixed`. Inside a transformed
 * surface (AppShell, a device preview) "fixed" is relative to that surface,
 * and if an ancestor scales it, screen pixels and local pixels differ. These
 * helpers translate a screen rect into the overlay's own coordinate space.
 */
export interface Box { left: number; top: number; width: number; height: number; right: number; bottom: number }

/** Size and screen offset of the portal target, plus its scale (screen px per local px). */
export function frameOf(target: HTMLElement) {
  if (target === document.body) return { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight, scale: 1 };
  const r = target.getBoundingClientRect();
  const scale = target.offsetWidth ? r.width / target.offsetWidth : 1;
  return { x: r.left, y: r.top, w: target.offsetWidth, h: target.offsetHeight, scale };
}

/** A screen rect (getBoundingClientRect) in the target's local coordinates. */
export function toLocal(rect: DOMRect, target: HTMLElement): Box {
  const f = frameOf(target);
  const left = (rect.left - f.x) / f.scale, top = (rect.top - f.y) / f.scale;
  const width = rect.width / f.scale, height = rect.height / f.scale;
  return { left, top, width, height, right: left + width, bottom: top + height };
}

/** A screen point in local coordinates. */
export function pointToLocal(x: number, y: number, target: HTMLElement) {
  const f = frameOf(target);
  return { x: (x - f.x) / f.scale, y: (y - f.y) / f.scale };
}

/**
 * Surface: where overlays portal to and which layout mode applies.
 *
 * The dashboard decided "phone or desktop" from the viewport. That breaks as
 * soon as the UI lives in a narrow pane, an embedded widget or a device
 * preview. Here the AppShell (or a preview frame) measures *its own* width
 * and tells everything inside: sheets become drawers or dialogs, menus become
 * sheets or popovers, the tab bar or the sidebar shows. Without a provider,
 * the viewport decides (min-width 900px), as before.
 */
import { createContext, useContext, useEffect, useLayoutEffect, useState, type ReactNode, type RefObject } from 'react';
import { DESKTOP, useDesktop } from './hooks';

export type LayoutMode = 'phone' | 'desktop';

interface SurfaceValue {
  /** Element overlays portal into (fixed positioning is relative to it when it is transformed). */
  portal: HTMLElement | null;
  mode: LayoutMode | null;
}

const SurfaceCtx = createContext<SurfaceValue>({ portal: null, mode: null });

export function Surface({ portal, mode, children }: { portal?: RefObject<HTMLElement | null>; mode?: LayoutMode | null; children: ReactNode }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => { setEl(portal?.current ?? null); }, [portal]);
  const parent = useContext(SurfaceCtx);
  return <SurfaceCtx.Provider value={{ portal: el ?? parent.portal, mode: mode ?? parent.mode }}>{children}</SurfaceCtx.Provider>;
}

/** Layout mode for this subtree. */
export function useLayoutMode(): LayoutMode {
  const { mode } = useContext(SurfaceCtx);
  const desktop = useDesktop();
  return mode ?? (desktop ? 'desktop' : 'phone');
}

/** Portal target for overlays (document.body unless a Surface says otherwise). */
export function usePortalTarget(): HTMLElement {
  return useContext(SurfaceCtx).portal ?? document.body;
}

/** Height of the portal target — what "100% of the screen" means for a sheet. */
export function surfaceHeight(target: HTMLElement): number {
  return target === document.body ? window.innerHeight : target.clientHeight;
}

/** Live height of the portal target: follows window resizes, rotation and a keyboard that resizes the layout. */
export function useSurfaceHeight(target: HTMLElement): number {
  const [h, setH] = useState(() => surfaceHeight(target));
  useLayoutEffect(() => {
    const read = () => setH(surfaceHeight(target));
    read();
    if (target === document.body) {
      window.addEventListener('resize', read);
      return () => window.removeEventListener('resize', read);
    }
    const ro = new ResizeObserver(read);
    ro.observe(target);
    return () => ro.disconnect();
  }, [target]);
  return h;
}

/**
 * The on-screen keyboard over a surface: how much of the target's bottom it
 * covers and how tall the visible part is. Works for any portal target (the
 * AppShell, a preview), not only document.body. null while no keyboard.
 */
export function useKeyboardInset(target: HTMLElement): { h: number; bottom: number } | null {
  const [kb, setKb] = useState<{ h: number; bottom: number } | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const check = () => {
      const r = target === document.body ? { top: 0, bottom: window.innerHeight } : target.getBoundingClientRect();
      const visBottom = vv.offsetTop + vv.height;
      const bottom = Math.max(0, Math.round(r.bottom - visBottom));
      const top = Math.max(r.top, vv.offsetTop);
      setKb((old) => {
        if (bottom < 80) return old ? null : old;
        const next = { h: Math.round(visBottom - top), bottom };
        return old && old.h === next.h && old.bottom === next.bottom ? old : next;
      });
    };
    check();
    vv.addEventListener('resize', check);
    vv.addEventListener('scroll', check);
    return () => { vv.removeEventListener('resize', check); vv.removeEventListener('scroll', check); };
  }, [target]);
  return kb;
}

/**
 * The shell's left inset on desktop: a floating sidebar reports how much of
 * the page it covers (`--sidebar-space`), and Page keeps its content clear of
 * it while its light still runs underneath the glass.
 */
const ShellCtx = createContext<{ setSidebarSpace: (px: number) => void } | null>(null);
export const ShellProvider = ShellCtx.Provider;
export function useShell() { return useContext(ShellCtx); }

/** Mode from an element's own width (ResizeObserver). */
export function useWidthMode(ref: RefObject<HTMLElement | null>, breakpoint = DESKTOP): LayoutMode | null {
  const [mode, setMode] = useState<LayoutMode | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setMode(e.contentRect.width >= breakpoint ? 'desktop' : 'phone'));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, breakpoint]);
  return mode;
}

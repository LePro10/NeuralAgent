// Interface size (desktop): the whole window's web view is scaled (Tauri `setZoom`), like a
// browser's page zoom. Chosen per device and kept in localStorage; the desktop shell applies the
// stored size before the first render (`storedZoom`), the app then keeps it in sync (ZoomControl).
// The shell's own zoom hotkeys stay off (tauri.conf.json `zoomHotkeysEnabled`), so our shortcuts and
// this setting are the only way the size changes. Browsers keep their own page zoom untouched.
import { create } from "zustand";
import { persist } from "zustand/middleware";

/** The sizes the shortcuts step through; 100% is the default. */
export const ZOOM_STEPS = [0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5] as const;
export const ZOOM_MIN = ZOOM_STEPS[0];
export const ZOOM_MAX = ZOOM_STEPS[ZOOM_STEPS.length - 1]!;

const KEY = "neuralagent.zoom";

/** A stored or requested size, clamped to the range and rounded to whole percent. */
export function clampZoom(z: unknown): number {
  const n = typeof z === "number" && Number.isFinite(z) ? z : 1;
  return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n)) * 100) / 100;
}

/** The next step up (dir 1) or down (dir -1) from `z`; a size between steps goes to the nearest one that way. */
export function stepZoom(z: number, dir: 1 | -1): number {
  const eps = 0.001;
  if (dir > 0) return ZOOM_STEPS.find((s) => s > z + eps) ?? ZOOM_MAX;
  return [...ZOOM_STEPS].reverse().find((s) => s < z - eps) ?? ZOOM_MIN;
}

export const zoomLabel = (z: number) => `${Math.round(z * 100)}%`;

/** The stored size, read synchronously (the shell applies it before React renders). */
export function storedZoom(): number {
  try {
    return clampZoom(JSON.parse(localStorage.getItem(KEY) ?? "{}")?.state?.scale);
  } catch {
    return 1;
  }
}

interface ZoomState {
  scale: number;
  setScale: (scale: number) => void;
}

export const useZoom = create<ZoomState>()(
  persist((set) => ({ scale: 1, setScale: (scale) => set({ scale: clampZoom(scale) }) }), {
    name: KEY,
    partialize: (s) => ({ scale: s.scale }),
  }),
);

/**
 * What a key press asks for: a step, back to 100%, or nothing. ⌘ on macOS, Ctrl elsewhere. Reads the
 * typed character (`key`), so "+" and "-" work on every layout (German: ⌘+ is its own key).
 */
export function zoomKey(e: { key: string; code: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean }, mac: boolean): 1 | -1 | 0 | null {
  if ((mac ? !e.metaKey || e.ctrlKey : !e.ctrlKey || e.metaKey) || e.altKey) return null;
  if (e.key === "+" || e.key === "=" || e.code === "NumpadAdd") return 1;
  if (e.key === "-" || e.key === "_" || e.code === "NumpadSubtract") return -1;
  if (e.key === "0" || e.code === "Numpad0") return 0;
  return null;
}

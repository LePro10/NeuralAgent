// Desktop interface size: applies the chosen size to the window's web view and handles the zoom
// shortcuts (⌘/Ctrl + "+", "-", "0", ⌘/Ctrl + scroll wheel, trackpad pinch). A short "110%" shows at
// the top while it changes. Renders nothing where the platform has no zoom (browsers, phones).
import { useReducedMotion, AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { usePlatform } from "../lib/store";
import { clampZoom, stepZoom, useZoom, zoomKey, zoomLabel, ZOOM_STEPS } from "../lib/zoom";

/** Wheel distance (CSS px) per step: one mouse-wheel notch, or a short pinch. */
const WHEEL_STEP = 50;
/** A pause this long starts a new wheel gesture (the leftover distance is dropped). */
const WHEEL_IDLE = 250;
/** How long the size stays on screen after the last change. */
const HUD_MS = 1100;

const nearestStep = (z: number) => ZOOM_STEPS.reduce((a, b) => (Math.abs(b - z) < Math.abs(a - z) ? b : a));

export function ZoomControl() {
  const zoom = usePlatform().zoom;
  const scale = useZoom((z) => z.scale);
  const [hud, setHud] = useState<number | null>(null);
  const hideAt = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reduce = useReducedMotion();

  // The setting is the one source of truth: every change (here, in Settings, at start) goes through it.
  useEffect(() => {
    if (zoom) void Promise.resolve(zoom(scale)).catch((e) => console.warn("zoom", e));
  }, [zoom, scale]);

  useEffect(() => {
    if (!zoom) return;
    const mac = navigator.userAgent.includes("Mac");
    const set = (next: number) => {
      const z = clampZoom(next);
      useZoom.getState().setScale(z);
      setHud(z);
      clearTimeout(hideAt.current);
      hideAt.current = setTimeout(() => setHud(null), HUD_MS);
    };
    const current = () => useZoom.getState().scale;

    const onKey = (e: KeyboardEvent) => {
      const k = zoomKey(e, mac);
      if (k === null) return;
      // Capture phase, so a focused terminal or editor does not get the key as well.
      e.preventDefault();
      e.stopPropagation();
      set(k === 0 ? 1 : stepZoom(current(), k));
    };

    let acc = 0;
    let last = 0;
    let pinching = false;
    const onWheel = (e: WheelEvent) => {
      // ⌘ + wheel on macOS; Ctrl + wheel everywhere (trackpad pinch arrives as Ctrl + wheel too).
      if (!(e.ctrlKey || (mac && e.metaKey))) return;
      e.preventDefault();
      if (pinching) return;
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      if (e.timeStamp - last > WHEEL_IDLE) acc = 0;
      last = e.timeStamp;
      acc += dy;
      if (Math.abs(acc) < WHEEL_STEP) return;
      set(stepZoom(current(), acc < 0 ? 1 : -1));
      acc = 0;
    };

    // WebKit (the macOS window) reports trackpad pinches as gesture events with a running scale.
    let base = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      pinching = true;
      base = current();
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const z = nearestStep(base * ((e as Event & { scale?: number }).scale ?? 1));
      if (z !== current()) set(z);
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      pinching = false;
    };

    const opts = { capture: true, passive: false } as const;
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("wheel", onWheel, opts);
    window.addEventListener("gesturestart", onGestureStart, opts);
    window.addEventListener("gesturechange", onGestureChange, opts);
    window.addEventListener("gestureend", onGestureEnd, opts);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("wheel", onWheel, opts);
      window.removeEventListener("gesturestart", onGestureStart, opts);
      window.removeEventListener("gesturechange", onGestureChange, opts);
      window.removeEventListener("gestureend", onGestureEnd, opts);
      clearTimeout(hideAt.current);
    };
  }, [zoom]);

  if (!zoom) return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 flex justify-center"
      style={{ top: "calc(var(--safe-top) + 14px)", zIndex: "var(--z-toast)" }}
      role="status"
      aria-live="polite"
    >
      <AnimatePresence>
        {hud !== null && (
          <motion.div
            key="zoom"
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.16 }}
            className="material rounded-full px-4 py-1.5 text-subhead text-bright tabular-nums"
          >
            {zoomLabel(hud)}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Launch motion: the NeuralAgent mark assembles from its panes while the accent light blooms
// behind it (≤ 1.2 s). It never blocks: the moment the daemon state is there it lifts away and the
// app shows through. If the connection takes longer, it turns into a branded "Connecting…" loader
// (the panes breathe in turn) and, when the daemon is out of reach, says so calmly.
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

const PANES = [
  { x: 8, y: 8, w: 10, h: 48, accent: false },
  { x: 20, y: 9, w: 12, h: 14, accent: false },
  { x: 26, y: 25, w: 12, h: 14, accent: true },
  { x: 32, y: 41, w: 12, h: 14, accent: false },
  { x: 46, y: 8, w: 10, h: 48, accent: false },
];

export function LaunchScreen({ ready, offline }: { ready: boolean; offline: boolean }) {
  // Shown until ready; after ~1.2 s the intro turns into the loader.
  const [slow, setSlow] = useState(false);
  const still = useReducedMotion();
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 1200);
    return () => clearTimeout(t);
  }, []);
  return (
    <AnimatePresence>
      {!ready && (
        <motion.div
          key="launch"
          className="absolute inset-0 grid place-items-center bg-bg"
          style={{ zIndex: "var(--z-intro)" }}
          initial={false}
          exit={{ opacity: 0, transition: { duration: 0.32, ease: [0.32, 0.72, 0, 1] } }}
        >
          {/* The light behind the mark. */}
          <motion.div
            aria-hidden="true"
            className="launch-bloom absolute size-96 rounded-full"
            initial={still ? false : { opacity: 0, scale: 0.4 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.3 }}
            transition={{ duration: 1, ease: [0.165, 0.84, 0.44, 1] }}
          />
          <div className="relative flex flex-col items-center">
            <motion.svg
              viewBox="0 0 64 64"
              width={72}
              height={72}
              aria-hidden
              className="text-bright"
              exit={{ scale: 1.12, opacity: 0, transition: { duration: 0.28 } }}
            >
              {PANES.map((p, i) => (
                <motion.rect
                  key={i}
                  x={p.x}
                  y={p.y}
                  width={p.w}
                  height={p.h}
                  rx={3}
                  fill={p.accent ? "var(--color-accent)" : "currentColor"}
                  style={{ transformBox: "fill-box", transformOrigin: "center" }}
                  initial={still ? false : { opacity: 0, scale: 0.4, y: i % 2 ? -6 : 6 }}
                  animate={
                    slow && !still
                      ? { opacity: [1, 0.35, 1], scale: 1, y: 0, transition: { opacity: { duration: 1.4, repeat: Infinity, delay: i * 0.14, ease: "easeInOut" } } }
                      : { opacity: 1, scale: 1, y: 0 }
                  }
                  transition={{ type: "spring", stiffness: 380, damping: 26, delay: 0.08 + i * 0.07 }}
                />
              ))}
            </motion.svg>
            <motion.div
              className="mt-5 h-5 text-subhead text-dim"
              initial={{ opacity: 0 }}
              animate={{ opacity: slow ? 1 : 0 }}
              transition={{ duration: 0.4 }}
              role="status"
              aria-live="polite"
            >
              {offline ? "Daemon not reachable · retrying…" : "Connecting…"}
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

import { Shimmer, prefersReducedMotion } from "@neuralagent/ui";
import { useEffect, useRef } from "react";
import { startTheme } from "../lib/theme";
import type { VoiceStatus } from "../lib/voice";
import { approach, barProfile, listeningHeight, METER_REST, METER_STALE_MS, writingHeight } from "../lib/voiceMeter";

startTheme();

/** Subscribes to the live microphone level (0..1); returns an unsubscribe. */
export type VoiceLevelSource = (onLevel: (level: number) => void) => () => void;

const BARS = 7;
const HEIGHT = 22;

/** The pill shown at the bottom of the screen while dictating or after "Hey Neural". */
export function VoiceHud({ status, levels }: { status: VoiceStatus | null; levels?: VoiceLevelSource }) {
  const activity = status?.activity ?? "idle";
  const writing = activity === "transcribing";
  const mode = writing ? "writing" : activity === "listening" || activity === "awake" ? "listening" : "idle";
  return (
    <div className="flex h-full items-center justify-center p-1">
      <div className="flex h-10 items-center gap-3 rounded-full bg-raised px-4 shadow-edge">
        <LevelBars mode={mode} levels={levels} label={writing ? "Writing" : "Listening"} />
        {writing ? (
          <Shimmer className="text-meta text-dim">Writing…</Shimmer>
        ) : (
          <span className="text-meta text-dim">{activity === "awake" ? "Hey Neural is listening" : "Listening…"}</span>
        )}
      </div>
    </div>
  );
}

/**
 * A short row of rounded bars that follows the microphone level. Levels arrive ~25×/s; each frame
 * eases the bars towards them (fast attack, slower release), writing `scaleY` straight to the DOM
 * so React never renders per frame. While writing, the bars settle into a low, slow shimmer.
 */
function LevelBars({ mode, levels, label }: { mode: "listening" | "writing" | "idle"; levels?: VoiceLevelSource; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const live = useRef({ level: 0, at: 0 });

  useEffect(() => {
    if (!levels) return;
    return levels((level) => {
      live.current = { level, at: performance.now() };
    });
  }, [levels]);

  useEffect(() => {
    const spans = Array.from(box.current?.children ?? []) as HTMLElement[];
    const profile = barProfile(spans.length);
    const draw = (h: number[]) => spans.forEach((s, i) => void (s.style.transform = `scaleY(${h[i].toFixed(3)})`));
    if (mode === "idle" || prefersReducedMotion()) {
      // Still bars: the arch while listening, flat while writing (the label says what happens).
      draw(profile.map((p) => (mode === "listening" ? METER_REST + 0.35 * p : METER_REST)));
      return;
    }
    const shown = spans.map(() => METER_REST);
    let level = 0;
    let last = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      const t = now / 1000;
      const heard = now - live.current.at < METER_STALE_MS ? live.current.level : 0;
      level = approach(level, heard, dt);
      for (let i = 0; i < shown.length; i++) {
        const target = mode === "writing" ? writingHeight(i, t) : listeningHeight(level, profile[i], i, t);
        shown[i] = approach(shown[i], target, dt, 40, mode === "writing" ? 260 : 120);
      }
      draw(shown);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [mode]);

  return (
    <div ref={box} role="img" aria-label={label} className="flex shrink-0 items-center gap-1" style={{ height: HEIGHT }}>
      {Array.from({ length: BARS }, (_, i) => (
        <span
          key={i}
          className={`h-full w-1 rounded-full will-change-transform transition-colors duration-300 ${mode === "writing" ? "bg-dim" : "bg-accent"}`}
          style={{ transform: `scaleY(${METER_REST})` }}
        />
      ))}
    </div>
  );
}

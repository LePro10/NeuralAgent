import { Shimmer, prefersReducedMotion } from "@neuralagent/ui";
import { PhoneOff } from "lucide-react";
import { useEffect, useRef } from "react";
import type { HudCallState } from "../lib/platform";
import { startTheme } from "../lib/theme";
import type { VoiceStatus } from "../lib/voice";
import { approach, barProfile, listeningHeight, METER_REST, METER_STALE_MS, writingHeight } from "../lib/voiceMeter";

startTheme();

/** Subscribes to the live microphone level (0..1); returns an unsubscribe. */
export type VoiceLevelSource = (onLevel: (level: number) => void) => () => void;

const BARS = 7;
const HEIGHT = 22;

const CALL_WORDS: Record<HudCallState, string> = { connecting: "Neural…", listening: "Listening", thinking: "Thinking…", speaking: "Neural speaks" };

/**
 * The pill shown at the bottom of the screen while dictating or after "Hey Neural". During a
 * "Hey Neural" call (`call`) it says what Neural does and has a hang-up button.
 */
export function VoiceHud({ status, levels, call, onHangup }: { status: VoiceStatus | null; levels?: VoiceLevelSource; call?: HudCallState | null; onHangup?: () => void }) {
  const activity = status?.activity ?? "idle";
  const inCall = activity === "awake" && !!call;
  const writing = inCall ? call === "thinking" || call === "connecting" : activity === "transcribing";
  const mode = writing ? "writing" : activity === "listening" || activity === "awake" ? "listening" : "idle";
  const words = inCall ? CALL_WORDS[call] : writing ? "Writing…" : activity === "awake" ? "Hey Neural is listening" : "Listening…";
  return (
    <div className="flex h-full items-center justify-center p-1">
      <div className={`flex h-10 items-center gap-3 rounded-full bg-raised shadow-edge ${inCall && onHangup ? "pr-1 pl-4" : "px-4"}`}>
        <LevelBars mode={mode} levels={levels} label={writing ? "Working" : "Listening"} />
        {writing ? <Shimmer className="text-meta text-dim">{words}</Shimmer> : <span className="text-meta text-dim">{words}</span>}
        {inCall && onHangup && (
          <button
            type="button"
            aria-label="Hang up"
            title="Hang up"
            onClick={onHangup}
            className="ml-1 grid size-8 place-items-center rounded-full bg-danger/15 text-danger transition-colors hover:bg-danger/25 active:bg-danger/35"
          >
            <PhoneOff size={15} strokeWidth={1.8} />
          </button>
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

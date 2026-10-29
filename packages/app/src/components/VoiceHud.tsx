import { Shimmer, Waveform } from "@neuralagent/ui";
import type { VoiceStatus } from "../lib/voice";

/** The pill shown at the bottom of the screen while dictating or after "Hey Neural". */
export function VoiceHud({ status }: { status: VoiceStatus | null }) {
  const activity = status?.activity ?? "idle";
  const writing = activity === "transcribing";
  return (
    <div className="flex h-full items-center justify-center p-1">
      <div className="flex h-10 items-center gap-3 rounded-full bg-raised px-4 shadow-edge">
        <Waveform active={!writing} bars={14} height={18} label={writing ? "Writing" : "Listening"} />
        {writing ? (
          <Shimmer className="text-meta text-dim">Writing…</Shimmer>
        ) : (
          <span className="text-meta text-dim">{activity === "awake" ? "Hey Neural is listening" : "Listening…"}</span>
        )}
      </div>
    </div>
  );
}

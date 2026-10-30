import { VoiceOverlay, toast, usePortalTarget } from "@neuralagent/ui";
import { AnimatePresence } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { callLevel, endCall, interruptCall, muteCall, useCall } from "../lib/call";
import { CallAudioToggle } from "./CallAudioToggle";

/** The in-call surface for Neural: orb, running time, what was heard and said, mute / speaker / end. */
export function CallScreen() {
  const call = useCall();
  const target = usePortalTarget();
  // A call that ended on its own (models missing, connection lost) says why.
  useEffect(() => {
    if (call.error) toast(call.error, { tone: "danger" });
  }, [call.error]);
  return createPortal(
    <AnimatePresence>
      {call.on && (
        <VoiceOverlay
          key="call"
          className="fixed z-50"
          call
          label="Neural"
          subtitle={<CallTime live={call.live} state={call.state} />}
          state={call.state}
          heard={call.heard}
          transcript={call.transcript}
          spokenWords={call.spokenWords}
          muted={call.muted}
          level={callLevel}
          onMute={() => muteCall(!call.muted)}
          onInterrupt={interruptCall}
          onEnd={() => endCall()}
          controls={<CallAudioToggle />}
        />
      )}
    </AnimatePresence>,
    target,
  );
}

/** "Connecting…" until the microphone is open, then the call's running time (0:42, 1:05:09). */
function CallTime({ live, state }: { live: boolean; state: string }) {
  const since = useRef<number | null>(null);
  const [, tick] = useState(0);
  if (live && since.current === null) since.current = Date.now();
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [live]);
  if (state === "error") return <>Call interrupted</>;
  if (!live || since.current === null) return <>Connecting…</>;
  const s = Math.floor((Date.now() - since.current) / 1000);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, "0");
  const ss = String(s % 60).padStart(2, "0");
  return <>{h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`}</>;
}

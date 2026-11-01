import { VoiceOverlay, toast, usePortalTarget } from "@neuralagent/ui";
import { AnimatePresence } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { callLevel, endCall, interruptCall, muteCall, resumeCall, useCall } from "../lib/call";
import { type CallHold, type CallNotice, callSubtitle } from "../lib/callState";
import { usePlatform } from "../lib/store";
import { CallAudioToggle } from "./CallAudioToggle";

/** The in-call surface for Neural: orb, running time, what was heard and said, mute / speaker / end. */
export function CallScreen() {
  const call = useCall();
  const target = usePortalTarget();
  const resume = usePlatform().call?.resume;
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
          subtitle={<CallTime live={call.live} ready={call.ready} notice={call.notice} held={call.held} />}
          state={call.live && call.ready && call.notice !== "reconnecting" ? call.state : "connecting"}
          heard={call.heard}
          transcript={call.transcript}
          spokenWords={call.spokenWords}
          muted={call.muted || !!call.held}
          level={callLevel}
          onMute={() => muteCall(!call.muted)}
          // On hold (a phone call took the sound): a tap on the orb takes it back.
          onInterrupt={call.held ? () => void resumeCall(resume) : interruptCall}
          onEnd={() => endCall()}
          controls={<CallAudioToggle />}
        />
      )}
    </AnimatePresence>,
    target,
  );
}

/** "Connecting…" until the microphone is open and the computer listens, then the call's running
 * time (0:42, 1:05:09); "Reconnecting…" while the connection to the computer is gone. */
function CallTime({ live, ready, notice, held }: { live: boolean; ready: boolean; notice: CallNotice; held?: CallHold }) {
  const since = useRef<number | null>(null);
  const [, tick] = useState(0);
  const connected = live && ready;
  if (connected && since.current === null) since.current = Date.now();
  useEffect(() => {
    if (!connected) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [connected]);
  const seconds = since.current === null ? null : (Date.now() - since.current) / 1000;
  return <>{callSubtitle({ live, ready, notice, seconds, held })}</>;
}

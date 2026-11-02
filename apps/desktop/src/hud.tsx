import { type HudCallState, type VoiceLevelSource, type VoiceStatus, VoiceHud } from "@neuralagent/app/hud";
import "@neuralagent/app/styles.css";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

const inTauri = "__TAURI_INTERNALS__" in window;
const devLevel = new Set<(level: number) => void>();

/** Live mic level from the desktop side (`voice-level`, 0..1, ~25×/s while listening). */
const levels: VoiceLevelSource = (onLevel) => {
  devLevel.add(onLevel);
  const off = inTauri ? listen<number>("voice-level", (e) => onLevel(e.payload)) : null;
  return () => {
    devLevel.delete(onLevel);
    void off?.then((f) => f());
  };
};

function Hud() {
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  // A "Hey Neural" call, as the main window reports it (`hud_call`).
  const [call, setCall] = useState<HudCallState | null>(null);
  useEffect(() => {
    if (import.meta.env.DEV || !inTauri) {
      // Screenshot/dev hook: drive the pill from a plain browser.
      (window as unknown as { __hud: unknown }).__hud = {
        status: (activity: VoiceStatus["activity"]) => setStatus((s) => ({ ...(s ?? ({} as VoiceStatus)), activity })),
        level: (v: number) => devLevel.forEach((f) => f(v)),
        call: setCall,
      };
    }
    if (!inTauri) return;
    invoke<VoiceStatus>("voice_status").then(setStatus, () => {});
    const off = listen<VoiceStatus>("voice", (e) => setStatus(e.payload));
    const offCall = listen<HudCallState | null>("hud-call", (e) => setCall(e.payload));
    return () => {
      void off.then((f) => f());
      void offCall.then((f) => f());
    };
  }, []);
  const hangup = () => inTauri && void emitTo("main", "hud-hangup").catch(() => {});
  return <VoiceHud status={status} levels={levels} call={call} onHangup={hangup} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Hud />
  </StrictMode>,
);

import { type VoiceLevelSource, type VoiceStatus, VoiceHud } from "@neuralagent/app";
import "@neuralagent/app/styles.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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
  useEffect(() => {
    if (import.meta.env.DEV || !inTauri) {
      // Screenshot/dev hook: drive the pill from a plain browser.
      (window as unknown as { __hud: unknown }).__hud = {
        status: (activity: VoiceStatus["activity"]) => setStatus((s) => ({ ...(s ?? ({} as VoiceStatus)), activity })),
        level: (v: number) => devLevel.forEach((f) => f(v)),
      };
    }
    if (!inTauri) return;
    invoke<VoiceStatus>("voice_status").then(setStatus, () => {});
    const off = listen<VoiceStatus>("voice", (e) => setStatus(e.payload));
    return () => void off.then((f) => f());
  }, []);
  return <VoiceHud status={status} levels={levels} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Hud />
  </StrictMode>,
);

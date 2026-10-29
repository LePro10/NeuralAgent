import { type VoiceStatus, VoiceHud } from "@neuralagent/app";
import "@neuralagent/app/styles.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

function Hud() {
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  useEffect(() => {
    invoke<VoiceStatus>("voice_status").then(setStatus, () => {});
    const off = listen<VoiceStatus>("voice", (e) => setStatus(e.payload));
    return () => void off.then((f) => f());
  }, []);
  return <VoiceHud status={status} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Hud />
  </StrictMode>,
);

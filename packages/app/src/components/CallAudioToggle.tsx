import { cn } from "@neuralagent/ui";
import { Headphones, Phone, Volume2 } from "lucide-react";
import { createPortal } from "react-dom";
import { setCallRoute, useBindCallAudio, useCallRoute, useCanPickRoute } from "../lib/callaudio";

/** Earpiece / speaker switch in the call screen (top right). Hidden where the browser cannot choose. */
export function CallAudioToggle() {
  useBindCallAudio();
  const can = useCanPickRoute();
  const { route, output } = useCallRoute();
  if (!can) return null;
  const headset = output === "headset";
  const speaker = route === "speaker";
  const Icon = headset ? Headphones : speaker ? Volume2 : Phone;
  const label = headset ? "Headset" : speaker ? "Speaker" : "Earpiece";
  return createPortal(
    <button
      type="button"
      aria-label={`Call audio: ${label}. Tap to switch to ${speaker ? "earpiece" : "speaker"}`}
      aria-pressed={speaker}
      onClick={() => setCallRoute(speaker ? "earpiece" : "speaker")}
      style={{ top: "calc(env(safe-area-inset-top, 0px) + 12px)", right: 16 }}
      className={cn(
        "pressable fixed z-50 flex h-10 items-center gap-2 rounded-full px-3.5 text-small transition-colors",
        speaker && !headset ? "bg-bright text-bg" : "bg-fill-3 text-bright hover:bg-fill-4",
      )}
    >
      <Icon size={17} strokeWidth={1.6} />
      {label}
    </button>,
    document.body,
  );
}

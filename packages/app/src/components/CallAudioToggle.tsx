import { VoiceControl } from "@neuralagent/ui";
import { Headphones, Phone, Volume2 } from "lucide-react";
import { setCallRoute, useBindCallAudio, useCallRoute, useCanPickRoute } from "../lib/callaudio";

/** Earpiece / speaker switch among the call controls. Hidden where the browser cannot choose. */
export function CallAudioToggle() {
  useBindCallAudio();
  const can = useCanPickRoute();
  const { route, output } = useCallRoute();
  if (!can) return null;
  const headset = output === "headset";
  const speaker = route === "speaker";
  const Icon = headset ? Headphones : speaker ? Volume2 : Phone;
  const label = headset ? "Headset" : speaker ? "Speaker" : "Earpiece";
  return (
    <VoiceControl
      label={`Call audio: ${label}. Tap to switch to ${speaker ? "earpiece" : "speaker"}`}
      caption={label}
      active={speaker && !headset}
      onClick={() => setCallRoute(speaker ? "earpiece" : "speaker")}
    >
      <Icon size={22} strokeWidth={1.7} />
    </VoiceControl>
  );
}

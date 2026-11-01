// Entry for the desktop listening pill (apps/desktop/src/hud.tsx): only what the pill needs, so its
// hidden window does not load the whole app bundle.
export type { VoiceStatus } from "./lib/voice";
export { VoiceHud, type VoiceLevelSource } from "./components/VoiceHud";

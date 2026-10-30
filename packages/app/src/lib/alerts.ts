// How this device tells you that an agent finished, needs your input or stopped with an error:
// a sound, a notification, both or nothing (Settings → Notifications). Each device chooses for
// itself, so the choice lives in this browser/app, not on the host.
//
// When it fires (App.tsx): nothing while you look at that agent's workspace; a sound and a small
// in-app note while the app is in front but elsewhere; a sound and/or a system notification while
// it is in the background. Phones and browsers get their notifications as pushes from the relay
// (also when the page is closed); the pushes are silent when sound is off.
import { create } from "zustand";

export type AlertMode = "both" | "sound" | "notify" | "off";
export type AlertKind = "done" | "waiting" | "error";

const KEY = "na:alerts";
const MODES: AlertMode[] = ["both", "sound", "notify", "off"];

function stored(): AlertMode | null {
  try {
    const v = localStorage.getItem(KEY);
    return MODES.includes(v as AlertMode) ? (v as AlertMode) : null;
  } catch {
    return null;
  }
}

/** `chosen`: false until the person picks something (phones then follow their push state). */
export const useAlerts = create<{ mode: AlertMode; chosen: boolean }>()(() => ({ mode: stored() ?? "both", chosen: stored() !== null }));

export function setAlertMode(mode: AlertMode) {
  useAlerts.setState({ mode, chosen: true });
  try {
    localStorage.setItem(KEY, mode);
  } catch {}
}

export const wantsSound = (m: AlertMode) => m === "both" || m === "sound";
export const wantsNotify = (m: AlertMode) => m === "both" || m === "notify";

export const ALERT_TEXT: Record<AlertKind, string> = { done: "Finished", waiting: "Needs your input", error: "Stopped with an error" };

// One audio context for the chimes. Browsers only let it play after a tap or click on the page,
// so the first one anywhere wakes it up.
let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}
if (typeof window !== "undefined") window.addEventListener("pointerdown", () => void audio(), { once: true, capture: true });

/** Two soft bell notes: rising when done, falling when it waits for you, low when it failed. */
const NOTES: Record<AlertKind, number[]> = { done: [659.25, 987.77], waiting: [880, 659.25], error: [392, 293.66] };

export function chime(kind: AlertKind) {
  const c = audio();
  if (!c) return;
  const t0 = c.currentTime + 0.02;
  NOTES[kind].forEach((f, i) => {
    const t = t0 + i * 0.14;
    // A sine plus a quiet octave reads as a small bell rather than a test tone.
    for (const [mul, peak] of [[1, 0.14], [2, 0.03]] as const) {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = "sine";
      o.frequency.value = f * mul;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
      o.connect(g).connect(c.destination);
      o.start(t);
      o.stop(t + 0.75);
    }
  });
}

/**
 * Pure rules of a call with Neural (no DOM; tested in `callState.test.ts`): what the call screen
 * says under the name, how long the call waits for the computer, and the words for microphone
 * failures. See docs/notes/calls.md.
 */

/** The daemon has not said anything about the call this long after `call_start`: give up. */
export const ANSWER_TIMEOUT_MS = 15_000;
/** The computer took the call but still does not listen this long after the tap (its speech
 * models load for a few seconds when cold): give up instead of "Connecting…" for good. */
export const READY_TIMEOUT_MS = 45_000;
/** The connection to the computer is gone this long during a call: hang up. */
export const OFFLINE_TIMEOUT_MS = 45_000;
/** The audio has not started this long after the microphone opened: ask for a tap. */
export const AUDIO_START_MS = 1_200;

/** Why the line is not live right now, or nothing when it is. */
export type CallNotice = "reconnecting" | "tap" | undefined;

/** Another app has the sound (Android): a phone call (comes back by itself) or an app that keeps it. */
export type CallHold = "phone" | "other";

/**
 * The line under "Neural": "Connecting…" until the microphone is open and the computer listens,
 * then the running time; a dropped connection or a stopped audio output says so instead.
 */
export function callSubtitle(o: { live: boolean; ready: boolean; notice: CallNotice; seconds: number | null; held?: CallHold }): string {
  if (o.held === "phone") return "On hold during your phone call";
  if (o.held === "other") return "On hold · tap to resume";
  if (o.notice === "reconnecting") return "Reconnecting…";
  if (!o.live || !o.ready || o.seconds === null) return "Connecting…";
  if (o.notice === "tap") return "Tap to turn the sound on";
  return runningTime(o.seconds);
}

/** 0:42, 12:05, 1:05:09. */
export function runningTime(total: number): string {
  const s = Math.max(0, Math.floor(total));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** A failed `getUserMedia` (or a missing API) in words the caller can act on. */
export function micErrorText(e: { name?: string; message?: string } | undefined, android = false): string {
  switch (e?.name) {
    case "NotAllowedError":
    case "SecurityError":
      return android
        ? "Microphone access was denied. Allow the microphone for NeuralAgent in Android settings, then call again."
        : "Microphone access was denied. Allow the microphone for this site in the browser, then call again.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No microphone found.";
    case "NotReadableError":
    case "AbortError":
      return "The microphone is busy in another app. Close it there and call again.";
    case "WorkletError":
      return "The call audio could not start. Reload the page and call again.";
    case "NoSecureContext":
      return "Calls need a secure page (https). Open NeuralAgent through its https address.";
    default:
      return e?.message ? `The call could not start: ${e.message}` : "The call could not start.";
  }
}

/** The computer did not take the call: the reason in words, from the connection's state. */
export function noAnswerText(connected: boolean): string {
  return connected ? "Your computer did not answer the call. Try again in a moment." : "Can't reach your computer right now. Check that it is on and online.";
}

/** The computer took the call but did not get ready to listen in time. */
export const SLOW_START_TEXT = "Your computer took too long to start the call. Try again in a moment.";

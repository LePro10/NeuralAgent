/**
 * A call with Neural. The daemon does the listening and the speaking (local speech models);
 * this side only streams the microphone (16 kHz PCM16) and plays what comes back (24 kHz).
 * The browser's echo cancellation keeps Neural's own voice out of the microphone, so the
 * caller can talk over it (the daemon then stops and listens).
 *
 * Starting fast (D69, docs/notes/calls.md): the Neural page warms the daemon's speech models up
 * (`useCallWarm`), `call_start` goes out before the microphone prompt, and the call screen says
 * "Connecting…" until the microphone is open *and* the computer listens. A dropped connection
 * shows "Reconnecting…" and the call resumes by itself (the client re-sends `call_start`); a call
 * the computer never answers, or a lost microphone, ends with a reason instead of hanging.
 *
 * "Hey Neural" on the desktop starts the same call (`wake`): what was said with the wake word
 * goes to the computer first (`preroll`), and the call hangs up by itself once nobody has
 * spoken for `WAKE_IDLE_MS` after the last answer.
 */
import type { CallEvent, CallState, DaemonClient } from "@neuralagent/protocol";
import type { VoiceState } from "@neuralagent/ui";
import { motionValue } from "motion/react";
import { useEffect } from "react";
import { create } from "zustand";
import { applyWebRoute, useCallRoute } from "./callaudio";
import {
  ANSWER_TIMEOUT_MS,
  AUDIO_START_MS,
  type CallHold,
  type CallNotice,
  micErrorText,
  noAnswerText,
  OFFLINE_TIMEOUT_MS,
  READY_TIMEOUT_MS,
  SLOW_START_TEXT,
  WAKE_IDLE_MS,
  wakeIdle,
} from "./callState";

interface CallView {
  /** A call runs in this app (also while connecting). */
  on: boolean;
  /** The microphone is open. */
  live: boolean;
  /** Started by "Hey Neural" (the desktop's listening pill shows it). */
  wake?: boolean;
  /** The computer has taken the call and listens (its speech models are loaded). */
  ready: boolean;
  state: VoiceState;
  /** What Neural understood, last turn. */
  heard: string;
  /** Neural's current answer, and how much of it has been played. */
  transcript: string;
  spokenWords: number;
  muted: boolean;
  /** Why the line is not live right now (connection lost, audio waiting for a tap). */
  notice?: CallNotice;
  /** Android: another app (a phone call) has the sound; nothing is heard or said meanwhile. */
  held?: CallHold;
  error?: string;
}

const IDLE: CallView = { on: false, live: false, ready: false, state: "connecting", heard: "", transcript: "", spokenWords: 0, muted: false };
export const useCall = create<CallView>(() => IDLE);
/** Microphone level 0..1, for the orb. */
export const callLevel = motionValue(0);

const STATE: Record<CallState, VoiceState> = { connecting: "connecting", listening: "listening", thinking: "thinking", speaking: "speaking", ended: "listening" };

const WORKLET = new URL("./mic-worklet.js", import.meta.url);
const MIC: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
const isNativeAndroid = () => !!(globalThis as { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.().includes("android");

let current: Session | null = null;

export interface CallStart {
  /** Started by "Hey Neural": hangs up by itself when the conversation is over. */
  wake?: boolean;
  /** Audio said before the call's microphone opened (16 kHz PCM16, base64), sent first. */
  preroll?: () => Promise<string | null>;
}

export async function startCall(client: DaemonClient, start: CallStart = {}) {
  if (current) return;
  useCall.setState({ ...IDLE, on: true, wake: !!start.wake });
  const s = new Session(client, start);
  current = s;
  try {
    await s.open();
  } catch (e) {
    if (current === s) endCall(micErrorText(e as Error, isNativeAndroid()));
  }
}

export function endCall(error?: string) {
  current?.close();
  current = null;
  useCall.setState({ ...IDLE, error });
}

export function muteCall(muted: boolean) {
  if (current) current.muted = muted;
  useCall.setState({ muted });
}

/**
 * Android: a phone call (or another app) took the sound: stop listening and speaking, and stop
 * Neural's current answer, until it comes back (`null`).
 */
export function holdCall(held: CallHold | null) {
  if (!current) return;
  current.held = held !== null;
  if (held) {
    current.flush();
    current.client.req({ m: "orch_stop" }).catch(() => {});
  }
  useCall.setState({ held: held ?? undefined });
}

/** A tap on a held call: ask the phone for the sound back (it says when it is back). */
export async function resumeCall(resume?: () => Promise<boolean>) {
  if (!current?.held) return;
  if (!resume) return holdCall(null);
  if (await resume()) holdCall(null);
}

/** Tap on the orb while Neural talks: stop the answer and listen. */
export function interruptCall() {
  current?.flush();
  current?.client.req({ m: "orch_stop" }).catch(() => {});
}

/**
 * A call is likely (the Neural page is showing): the daemon loads its speech models now, and the
 * microphone worklet is fetched, so a tap on "Call Neural" connects at once. Again after every
 * reconnect and when the page comes back to the front. The daemon frees the models after some
 * idle minutes; older daemons ignore this.
 */
export function useCallWarm(client: DaemonClient) {
  useEffect(() => {
    const warm = () => {
      if (document.visibilityState === "visible") {
        client.callWarm();
        prefetchWorklet();
      }
    };
    warm();
    const offHello = client.onHello(warm);
    document.addEventListener("visibilitychange", warm);
    return () => {
      offHello();
      document.removeEventListener("visibilitychange", warm);
    };
  }, [client]);
}

let prefetched = false;
function prefetchWorklet() {
  if (prefetched || typeof fetch !== "function") return;
  prefetched = true;
  fetch(WORKLET).catch(() => (prefetched = false));
}

class Session {
  muted = false;
  held = false;
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private off: (() => void) | null = null;
  private offRoute: (() => void) | null = null;
  private offConn: (() => void) | null = null;
  /** When the queued speech ends, on the audio clock. */
  private playhead = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private words = 0;
  /** Words before the sentence whose audio comes next (lit when that audio starts). */
  private sentenceStart: number | null = null;
  private closed = false;
  /** The daemon has said something about this call (it took it). */
  private answered = false;
  private noAnswer: ReturnType<typeof setTimeout> | null = null;
  private offline: ReturnType<typeof setTimeout> | null = null;
  private resumeOnTap: (() => void) | null = null;
  /** Start timeline for the console (ms after the tap): where a slow start spent its time. */
  private t0 = performance.now();
  private marks: string[] = [];
  /** Microphone frames held back until the preroll went out (wake word calls). */
  private pending: string[] | null = null;
  /** Wake word calls: the last time someone spoke or Neural was busy, and the check for it. */
  private lastActive = performance.now();
  private idleCheck: ReturnType<typeof setInterval> | null = null;

  constructor(
    readonly client: DaemonClient,
    private readonly start: CallStart = {},
  ) {}

  private mark(what: string) {
    this.marks.push(`${what} ${Math.round(performance.now() - this.t0)}`);
  }

  async open() {
    this.off = this.client.onCall((ev) => this.on(ev));
    this.offConn = this.client.subscribe(() => this.connection());
    // The daemon takes the call (and loads its models if they are cold) while the microphone opens.
    this.client.callStart();
    this.noAnswer = setTimeout(() => this.startTimedOut(), ANSWER_TIMEOUT_MS);
    this.connection();
    if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error("no secure context"), { name: "NoSecureContext" });
    setAudioSession("play-and-record");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: MIC });
    this.mark("mic");
    if (this.closed) return stream.getTracks().forEach((t) => t.stop());
    this.stream = stream;
    // After the microphone: on Android the output then joins the call's audio mode (echo
    // cancellation, earpiece). Browsers let a capturing page start audio without a new tap.
    const ctx = new AudioContext({ latencyHint: "interactive" });
    this.ctx = ctx;
    const resumed = ctx.resume().catch(() => {});
    ctx.onstatechange = () => this.audioState();
    void applyWebRoute(ctx);
    this.offRoute = useCallRoute.subscribe((v, old) => v.route !== old.route && this.ctx && void applyWebRoute(this.ctx));
    await ctx.audioWorklet.addModule(WORKLET).catch((e: Error) => {
      throw Object.assign(new Error(e.message), { name: "WorkletError" });
    });
    this.mark("worklet");
    if (this.closed) return;
    const node = new AudioWorkletNode(ctx, "neural-mic");
    if (this.start.preroll) this.pending = [];
    node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; level: number }>) => {
      const quiet = this.muted || this.held;
      const level = quiet ? 0 : Math.min(1, e.data.level * 4);
      callLevel.set(level);
      if (level > 0.15) this.lastActive = performance.now();
      if (quiet) return;
      const frame = b64(e.data.pcm);
      if (this.pending) this.pending.push(frame);
      else this.client.callAudio(frame);
    };
    this.node = node;
    // A silent path to the output keeps the worklet pulled in every engine.
    const sink = ctx.createGain();
    sink.gain.value = 0;
    node.connect(sink).connect(ctx.destination);
    this.attach(stream);
    if (this.start.preroll) await this.sendPreroll(this.start.preroll);
    if (this.start.wake) {
      // "I'm listening": after the preroll, so the desktop's recording does not carry it.
      chime(ctx, "open");
      this.idleCheck = setInterval(() => this.idle(), 1000);
    }
    // `resume()` can wait forever where audio needs a tap: go on, and ask for one if needed.
    await Promise.race([resumed, new Promise((r) => setTimeout(r, AUDIO_START_MS))]);
    this.mark(`audio ${ctx.state}`);
    if (this.closed) return;
    this.audioState();
    useCall.setState({ live: true });
  }

  /**
   * What was said since just before "Hey Neural" (the desktop kept it), then the frames the
   * microphone gave meanwhile. The first of those overlaps the end of the preroll: dropped.
   */
  private async sendPreroll(take: () => Promise<string | null>) {
    const pre = await take().catch(() => null);
    this.mark("preroll");
    if (this.closed) return;
    if (pre) this.client.callAudio(pre);
    const held = this.pending ?? [];
    this.pending = null;
    for (const f of held.slice(pre ? 1 : 0)) this.client.callAudio(f);
  }

  /** A wake word call is over: nobody spoke for a while, and Neural is neither busy nor talking. */
  private idle() {
    const { state, ready } = useCall.getState();
    const playing = !!this.ctx && this.playhead > this.ctx.currentTime;
    if (state !== "listening" || playing || !ready) this.lastActive = performance.now();
    if (current === this && wakeIdle(performance.now() - this.lastActive)) {
      console.info(`call: no one spoke for ${WAKE_IDLE_MS / 1000} s, hanging up (wake word call)`);
      if (this.idleCheck) clearInterval(this.idleCheck);
      this.idleCheck = null;
      // A falling cue, so nobody keeps talking into a closed line; then hang up.
      if (this.ctx) chime(this.ctx, "close");
      setTimeout(() => current === this && endCall(), 450);
    }
  }

  /** No word from the computer in time: hang up; it took the call but does not listen yet: wait a bit longer. */
  private startTimedOut() {
    if (current !== this || useCall.getState().ready) return;
    if (!this.answered) return endCall(noAnswerText(this.client.status === "open"));
    this.noAnswer = setTimeout(() => current === this && !useCall.getState().ready && endCall(SLOW_START_TEXT), READY_TIMEOUT_MS - ANSWER_TIMEOUT_MS);
  }

  /** Feeds a microphone stream into the worklet; a microphone that stops is reopened once. */
  private attach(stream: MediaStream) {
    const ctx = this.ctx;
    if (!ctx || !this.node) return;
    this.source?.disconnect();
    this.source = ctx.createMediaStreamSource(stream);
    this.source.connect(this.node);
    const track = stream.getAudioTracks()[0];
    if (track) track.onended = () => void this.reopenMic();
  }

  private async reopenMic() {
    if (this.closed) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: MIC });
      if (this.closed) return stream.getTracks().forEach((t) => t.stop());
      this.stream?.getTracks().forEach((t) => t.stop());
      this.stream = stream;
      this.attach(stream);
    } catch (e) {
      if (current === this) endCall(`The microphone stopped. ${micErrorText(e as Error, isNativeAndroid())}`);
    }
  }

  /** Audio output stopped (no tap yet, the OS took it for a moment): resume, or on the next tap. */
  private audioState() {
    const ctx = this.ctx;
    if (!ctx || this.closed) return;
    if (ctx.state === "running") {
      if (this.resumeOnTap) {
        removeEventListener("pointerdown", this.resumeOnTap, true);
        this.resumeOnTap = null;
      }
      if (useCall.getState().notice === "tap") useCall.setState({ notice: undefined });
      return;
    }
    if (ctx.state === "closed") return;
    void ctx.resume().catch(() => {});
    if (!this.resumeOnTap) {
      this.resumeOnTap = () => void this.ctx?.resume().catch(() => {});
      addEventListener("pointerdown", this.resumeOnTap, true);
    }
    if (useCall.getState().live && !useCall.getState().notice) useCall.setState({ notice: "tap" });
  }

  /** The connection to the computer: "Reconnecting…" while it is gone, hang up after a while. */
  private connection() {
    if (this.closed) return;
    const up = this.client.status === "open";
    const { notice, ready } = useCall.getState();
    if (up) {
      if (this.offline) clearTimeout(this.offline);
      this.offline = null;
      if (notice === "reconnecting" && ready) useCall.setState({ notice: undefined });
      return;
    }
    // Before the first answer the start timeout covers it.
    if (!this.answered) return;
    if (notice !== "reconnecting") useCall.setState({ notice: "reconnecting" });
    this.offline ??= setTimeout(() => current === this && endCall("Lost the connection to your computer."), OFFLINE_TIMEOUT_MS);
  }

  close() {
    this.closed = true;
    this.off?.();
    this.offRoute?.();
    this.offConn?.();
    if (this.offline) clearTimeout(this.offline);
    if (this.noAnswer) clearTimeout(this.noAnswer);
    if (this.idleCheck) clearInterval(this.idleCheck);
    if (this.resumeOnTap) removeEventListener("pointerdown", this.resumeOnTap, true);
    this.client.callEnd();
    this.flush();
    this.source?.disconnect();
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    void this.ctx?.close().catch(() => {});
    setAudioSession("auto");
    callLevel.set(0);
  }

  flush() {
    for (const s of this.sources) s.stop();
    this.sources.clear();
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.playhead = 0;
  }

  private on(ev: CallEvent) {
    switch (ev.k) {
      case "state":
        if (ev.state === "ended") {
          // Every call on the computer says "connecting" first: an "ended" before that belongs
          // to an earlier call on this connection (hung up while it was still loading).
          if (!this.answered) return;
          if (current === this) endCall(ev.error ?? undefined);
          return;
        }
        this.answered = true;
        if (ev.state === "connecting") {
          // After a reconnect the call starts again on the computer: say so until it listens.
          if (useCall.getState().ready) useCall.setState({ notice: "reconnecting" });
          else useCall.setState({ state: "connecting" });
          return;
        }
        if (!useCall.getState().ready) {
          this.mark("computer listens");
          console.info(`call: connected (ms after tap: ${this.marks.join(", ")})`);
          useCall.setState({ ready: true });
        }
        if (useCall.getState().notice === "reconnecting" && this.client.status === "open") useCall.setState({ notice: undefined });
        // "Listening" may come while the last words still play; the overlay keeps speaking until then.
        if (ev.state === "listening" && this.ctx && this.playhead > this.ctx.currentTime) {
          this.later(this.playhead - this.ctx.currentTime, () => useCall.setState({ state: "listening", spokenWords: this.words }));
        } else useCall.setState({ state: STATE[ev.state] });
        break;
      case "heard":
        this.words = 0;
        this.sentenceStart = null;
        useCall.setState({ heard: ev.text, transcript: "", spokenWords: 0 });
        break;
      case "say": {
        this.sentenceStart = this.words;
        this.words += ev.text.trim().split(/\s+/).filter(Boolean).length;
        const t = useCall.getState().transcript;
        useCall.setState({ transcript: t ? `${t} ${ev.text}` : ev.text });
        break;
      }
      case "audio":
        this.play(ev.d, ev.rate);
        break;
      case "flush":
        this.flush();
        useCall.setState({ spokenWords: this.words });
        break;
      case "latency":
        break;
    }
  }

  private play(d: string, rate: number) {
    const ctx = this.ctx;
    if (!ctx || this.held) return;
    const buf = pcmBuffer(ctx, d, rate);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const at = Math.max(ctx.currentTime + 0.02, this.playhead);
    src.start(at);
    this.playhead = at + buf.duration;
    this.sources.add(src);
    src.onended = () => this.sources.delete(src);
    if (this.sentenceStart !== null) {
      const words = this.sentenceStart;
      this.sentenceStart = null;
      this.later(at - ctx.currentTime, () => useCall.setState({ spokenWords: words }));
    }
  }

  private later(secs: number, f: () => void) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      f();
    }, secs * 1000);
    this.timers.add(t);
  }
}

/**
 * Safari's Audio Session API: "play-and-record" during a call (iOS then lowers or pauses other
 * apps' audio itself), "auto" after. Other browsers have no say over other apps' audio.
 */
function setAudioSession(type: "play-and-record" | "auto") {
  const s = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  try {
    if (s) s.type = type;
  } catch {
    /* not settable here */
  }
}

/**
 * A soft two-note cue on the call's own output (so it follows earpiece/speaker): rising when a
 * "Hey Neural" call listens, falling when it hangs up by itself. Quiet sine tones, ~0.3 s.
 */
function chime(ctx: AudioContext, kind: "open" | "close") {
  const start = ctx.currentTime + 0.01;
  const notes = kind === "open" ? [659.3, 880] : [659.3, 493.9];
  notes.forEach((freq, i) => {
    const at = start + i * 0.09;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.06, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.25);
  });
}

/** Plays a voice preview (PCM16 base64). */
export async function playPreview(d: string, rate: number) {
  const ctx = new AudioContext();
  const src = ctx.createBufferSource();
  src.buffer = pcmBuffer(ctx, d, rate);
  src.connect(ctx.destination);
  src.onended = () => void ctx.close();
  src.start();
}

function pcmBuffer(ctx: AudioContext, d: string, rate: number): AudioBuffer {
  const bin = atob(d);
  const n = bin.length >> 1;
  const buf = ctx.createBuffer(1, n, rate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < n; i++) {
    const v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
    ch[i] = (v >= 0x8000 ? v - 0x10000 : v) / 32768;
  }
  return buf;
}

function b64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

/**
 * A call with Neural. The daemon does the listening and the speaking (local speech models);
 * this side only streams the microphone (16 kHz PCM16) and plays what comes back (24 kHz).
 * The browser's echo cancellation keeps Neural's own voice out of the microphone, so the
 * caller can talk over it (the daemon then stops and listens).
 */
import type { CallEvent, CallState, DaemonClient } from "@neuralagent/protocol";
import type { VoiceState } from "@neuralagent/ui";
import { motionValue } from "motion/react";
import { create } from "zustand";

interface CallView {
  on: boolean;
  /** The microphone is open. */
  live: boolean;
  state: VoiceState;
  /** What Neural understood, last turn. */
  heard: string;
  /** Neural's current answer, and how much of it has been played. */
  transcript: string;
  spokenWords: number;
  muted: boolean;
  error?: string;
}

const IDLE: CallView = { on: false, live: false, state: "connecting", heard: "", transcript: "", spokenWords: 0, muted: false };
export const useCall = create<CallView>(() => IDLE);
/** Microphone level 0..1, for the orb. */
export const callLevel = motionValue(0);

const STATE: Record<CallState, VoiceState> = { connecting: "connecting", listening: "listening", thinking: "thinking", speaking: "speaking", ended: "listening" };

let current: Session | null = null;

export async function startCall(client: DaemonClient) {
  if (current) return;
  useCall.setState({ ...IDLE, on: true });
  const s = new Session(client);
  current = s;
  try {
    await s.open();
  } catch (e) {
    endCall((e as Error).name === "NotAllowedError" ? "Microphone access was denied." : (e as Error).message);
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

/** Tap on the orb while Neural talks: stop the answer and listen. */
export function interruptCall() {
  current?.flush();
  current?.client.req({ m: "orch_stop" }).catch(() => {});
}

class Session {
  muted = false;
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private off: (() => void) | null = null;
  /** When the queued speech ends, on the audio clock. */
  private playhead = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private words = 0;
  /** Words before the sentence whose audio comes next (lit when that audio starts). */
  private sentenceStart: number | null = null;
  private closed = false;

  constructor(readonly client: DaemonClient) {}

  async open() {
    this.off = this.client.onCall((ev) => this.on(ev));
    this.client.callStart();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    if (this.closed) return stream.getTracks().forEach((t) => t.stop());
    this.stream = stream;
    const ctx = new AudioContext({ latencyHint: "interactive" });
    this.ctx = ctx;
    await ctx.audioWorklet.addModule(new URL("./mic-worklet.js", import.meta.url));
    if (this.closed) return;
    const node = new AudioWorkletNode(ctx, "neural-mic");
    node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; level: number }>) => {
      callLevel.set(this.muted ? 0 : Math.min(1, e.data.level * 4));
      if (!this.muted) this.client.callAudio(b64(e.data.pcm));
    };
    ctx.createMediaStreamSource(stream).connect(node);
    this.node = node;
    await ctx.resume();
    useCall.setState({ live: true });
  }

  close() {
    this.closed = true;
    this.off?.();
    this.client.callEnd();
    this.flush();
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
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
          if (current === this) endCall(ev.error ?? undefined);
          return;
        }
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
    if (!ctx) return;
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

/** Speech to text: records on this device (16 kHz mono PCM), the host's local model transcribes. */
import type { DaemonClient, TranscribeResult } from "@neuralagent/protocol";
import { useCallback, useEffect, useRef, useState } from "react";

const MAX_SECONDS = 110;

function b64(chunks: Int16Array[]): string {
  const n = chunks.reduce((a, c) => a + c.length, 0);
  const all = new Uint8Array(n * 2);
  let o = 0;
  for (const c of chunks) {
    all.set(new Uint8Array(c.buffer, c.byteOffset, c.byteLength), o);
    o += c.byteLength;
  }
  let s = "";
  for (let i = 0; i < all.length; i += 0x8000) s += String.fromCharCode(...all.subarray(i, i + 0x8000));
  return btoa(s);
}

export function useDictation(client: DaemonClient, onText: (t: string) => void, onError: (m: string) => void) {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const rec = useRef<{ stop: () => Int16Array[] } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const stop = useCallback(async () => {
    clearTimeout(timer.current);
    const r = rec.current;
    rec.current = null;
    setRecording(false);
    if (!r) return;
    const chunks = r.stop();
    if (!chunks.length) return;
    setBusy(true);
    try {
      const res = await client.req<TranscribeResult>({ m: "transcribe", p: { audio: b64(chunks) } });
      if (res.text.trim()) onText(res.text.trim());
      else onError("Nothing was understood.");
    } catch (e) {
      onError((e as Error).message || "Transcription failed");
    } finally {
      setBusy(false);
    }
  }, [client, onText, onError]);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
      const ctx = new AudioContext({ latencyHint: "interactive" });
      await ctx.audioWorklet.addModule(new URL("../../lib/mic-worklet.js", import.meta.url));
      const node = new AudioWorkletNode(ctx, "neural-mic");
      const chunks: Int16Array[] = [];
      node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer }>) => chunks.push(new Int16Array(e.data.pcm));
      ctx.createMediaStreamSource(stream).connect(node);
      await ctx.resume();
      rec.current = {
        stop: () => {
          node.disconnect();
          stream.getTracks().forEach((t) => t.stop());
          void ctx.close();
          return chunks;
        },
      };
      setRecording(true);
      timer.current = setTimeout(() => void stop(), MAX_SECONDS * 1000);
    } catch (e) {
      onError((e as Error).name === "NotAllowedError" ? "Microphone access was denied." : "No microphone available.");
    }
  }, [onError, stop]);

  useEffect(() => () => void rec.current?.stop(), []);

  return { recording, busy, toggle: () => (recording ? void stop() : busy ? undefined : void start()) };
}

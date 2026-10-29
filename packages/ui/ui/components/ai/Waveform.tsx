/**
 * Voice level as bars. With `stream` (a MediaStream from getUserMedia) the
 * bars follow the real microphone through a WebAudio analyser; without it
 * they simulate a calm voice. Bars move by `scaleY` written straight to the
 * DOM each frame — no React render per frame, compositor only.
 *
 * `level` (optional MotionValue) receives the 0..1 loudness, so an orb can
 * swell with the same voice.
 */
import type { MotionValue } from 'motion/react';
import { useEffect, useRef } from 'react';
import { cn } from '../../lib/cn';
import { prefersReducedMotion } from '../../lib/motion';

export function Waveform({ stream, active = true, bars = 32, height = 22, color = 'var(--color-tab)', shape = 'center', level, className, label = 'Listening' }: {
  stream?: MediaStream | null;
  active?: boolean;
  bars?: number;
  height?: number;
  color?: string;
  /** center = mirrored around the middle line; bottom = grows up like an equaliser. */
  shape?: 'center' | 'bottom';
  level?: MotionValue<number>;
  className?: string;
  label?: string;
}) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const spans = Array.from(el.children) as HTMLElement[];
    const set = (vals: number[]) => spans.forEach((s, i) => { s.style.transform = `scaleY(${Math.max(0.12, Math.min(1, vals[i] ?? 0))})`; });
    if (!active) { set(spans.map(() => 0.12)); level?.set(0); return; }
    if (prefersReducedMotion()) { set(spans.map((_, i) => 0.25 + 0.2 * Math.sin(i))); return; }

    let raf = 0;
    let ctx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let data: Uint8Array<ArrayBuffer> | null = null;
    if (stream) {
      try {
        ctx = new AudioContext();
        analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.75;
        ctx.createMediaStreamSource(stream).connect(analyser);
        data = new Uint8Array(analyser.frequencyBinCount);
      } catch { analyser = null; }
    }
    const phase = spans.map((_, i) => i * 0.7);
    const t0 = performance.now();
    const frame = (now: number) => {
      const t = (now - t0) / 1000;
      let vals: number[];
      if (analyser && data) {
        analyser.getByteFrequencyData(data);
        // Voice lives in the lower bins: spread bars over the first ~60%.
        const span = Math.floor(data.length * 0.6);
        vals = spans.map((_, i) => {
          const k = Math.floor((Math.abs(i - (bars - 1) / 2) / (bars / 2)) * span);
          return (data![k] / 255) * 1.25;
        });
      } else {
        // A believable voice: syllable envelope × per-bar shimmer, louder in the middle.
        const env = 0.35 + 0.65 * Math.max(0, Math.sin(t * 3.1) * Math.sin(t * 1.3 + 1));
        vals = spans.map((_, i) => {
          const mid = 1 - Math.abs(i - (bars - 1) / 2) / (bars / 2);
          return env * (0.35 + 0.65 * mid) * (0.55 + 0.45 * Math.sin(t * 9 + phase[i]));
        });
      }
      set(vals);
      level?.set(vals.reduce((a, b) => a + b, 0) / vals.length);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); void ctx?.close(); };
  }, [stream, active, bars, level]);

  return (
    <div ref={box} role="img" aria-label={label} className={cn('flex min-w-0 items-center gap-[2.5px] overflow-hidden', shape === 'bottom' && 'items-end', className)} style={{ height }}>
      {Array.from({ length: bars }, (_, i) => (
        <span key={i} className="w-[2px] shrink-0 rounded-full will-change-transform" style={{ height: '100%', background: color, transform: 'scaleY(.12)', transformOrigin: shape === 'bottom' ? '50% 100%' : '50% 50%' }} />
      ))}
    </div>
  );
}

/** Asks for the microphone; resolves null if refused or unavailable (callers fall back to the simulation). */
export async function requestMic(): Promise<MediaStream | null> {
  try { return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch { return null; }
}

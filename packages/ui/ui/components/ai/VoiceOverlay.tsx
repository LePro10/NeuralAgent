/**
 * Voice mode: the orb fills the screen's heart, a status word sits under it,
 * and while the assistant speaks its words run like karaoke — the current
 * phrase lit (a soft wash of the place's colour), what was said dims, what
 * comes is faint. 52px controls at the bottom; hang-up is the only red.
 *
 * Render it inside a positioned container (it is `absolute inset-0`) and
 * wrap it in <AnimatePresence> to fade in/out. The orb swells with `level`.
 */
import { motion, useMotionValue, type MotionValue } from 'motion/react';
import { Mic, MicOff, PhoneOff, RotateCw, X } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { haptic } from '../../lib/haptics';
import { SPRING } from '../../lib/motion';
import { Shimmer } from '../effects/Shimmer';
import { AssistantOrb } from './AssistantOrb';

export type VoiceState = 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error';

const STATUS: Record<VoiceState, string> = { connecting: 'Connecting', listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking', error: 'Connection lost' };

/** Splits speech into phrases at punctuation, keeping word counts for highlighting. */
function phrases(text: string) {
  const parts = text.match(/[^.!?,;:—]+[.!?,;:—]*\s*/g) ?? [text];
  let w = 0;
  return parts.map((p) => { const n = p.trim().split(/\s+/).filter(Boolean).length; const start = w; w += n; return { text: p, start, end: w }; });
}

export function VoiceOverlay({ state, transcript = '', spokenWords = 0, heard, muted, onMute, onEnd, onInterrupt, onRetry, level, label = 'Voice', subtitle, controls, call, className }: {
  state: VoiceState;
  /** What the assistant says (full text of the current answer). */
  transcript?: string;
  /** How many words of `transcript` have been spoken — drives the highlight. */
  spokenWords?: number;
  /** What the mic heard from the user (interim). */
  heard?: string;
  muted?: boolean;
  onMute?: () => void;
  onEnd: () => void;
  /** Tap the orb while it speaks/thinks. */
  onInterrupt?: () => void;
  onRetry?: () => void;
  level?: MotionValue<number>;
  label?: string;
  /** Under the label, e.g. the call's running time. */
  subtitle?: ReactNode;
  /** Extra round controls between mute and end (`VoiceControl`, e.g. speaker). */
  controls?: ReactNode;
  /** A phone call: hang-up glyph and captions under the controls. */
  call?: boolean;
  className?: string;
}) {
  const fallback = useMotionValue(0);
  const list = useMemo(() => phrases(transcript), [transcript]);
  const current = list.findIndex((p) => spokenWords < p.end);
  const box = useRef<HTMLDivElement>(null);
  const lit = useRef<HTMLSpanElement>(null);
  // Keep the lit phrase in the middle of the window.
  useLayoutEffect(() => {
    const b = box.current, l = lit.current;
    if (b && l) b.scrollTo({ top: l.offsetTop - b.clientHeight / 2 + l.offsetHeight / 2, behavior: 'smooth' });
  }, [current]);
  const speaking = state === 'speaking' && !!transcript;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.18 } }} transition={{ duration: 0.3 }}
      className={cn('absolute inset-0 z-30 flex flex-col items-center bg-bg', className)}
      style={{ paddingTop: 'calc(var(--safe-top) + 14px)', paddingBottom: 'calc(var(--safe-bottom) + 24px)' }}>
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_42%_at_50%_38%,color-mix(in_oklab,var(--orb-1)_22%,transparent),transparent_72%),radial-gradient(70%_45%_at_15%_0%,color-mix(in_oklab,var(--color-sys-purple)_14%,transparent),transparent_70%),radial-gradient(60%_40%_at_90%_100%,color-mix(in_oklab,var(--color-sys-teal)_12%,transparent),transparent_70%)]" />
      {call ? (
        <div className="relative flex w-full max-w-[760px] flex-col items-center gap-0.5 px-5 pt-6 text-center">
          <span className="text-title-2 text-bright">{label}</span>
          <span className="tabular text-subhead text-dim">{subtitle}</span>
        </div>
      ) : (
        <div className="relative flex w-full max-w-[760px] items-center justify-between px-5">
          <span className="eyebrow">{label}</span>
          {state !== 'connecting' && state !== 'error' && <span className="text-meta text-faint">{speaking ? 'Talk or tap to interrupt' : 'Just talk'}</span>}
        </div>
      )}

      <div className="relative flex min-h-0 w-full max-w-[640px] flex-1 flex-col items-center justify-center px-6">
        <motion.button type="button" aria-label={speaking || state === 'thinking' ? 'Interrupt' : 'Assistant'}
          onClick={() => { if (speaking || state === 'thinking') { haptic('select'); onInterrupt?.(); } }}
          className="rounded-full outline-offset-8" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: state === 'error' ? 0.5 : 1 }} transition={SPRING.soft} whileTap={{ scale: 0.95 }}>
          <AssistantOrb size={184} state={state === 'thinking' || state === 'connecting' ? 'busy' : 'idle'} level={level ?? fallback} className="!h-[min(48vw,184px)] !w-[min(48vw,184px)]" />
        </motion.button>

        <div className="mt-9 flex h-[140px] w-full flex-col items-center text-center">
          {state === 'thinking' || state === 'connecting'
            ? <Shimmer className="eyebrow">{STATUS[state]}</Shimmer>
            : <span className={cn('eyebrow', state === 'error' && '!text-danger')}>{muted && state === 'listening' ? 'Muted' : STATUS[state]}</span>}
          {speaking ? (
            <div ref={box} className="fade-y scroller relative mt-2.5 w-full flex-1 text-title leading-[1.45] font-light @min-[700px]:text-title-2">
              <p className="py-[1.2em]">
                {list.map((p, i) => (
                  <span key={i} ref={i === current ? lit : undefined}
                    className={cn('transition-colors duration-300', i < current ? 'text-ink/50' : i === current ? 'rounded-chip bg-tab/[.12] px-1 text-bright [box-decoration-break:clone] [-webkit-box-decoration-break:clone]' : 'text-faint')}>
                    {p.text}
                  </span>
                ))}
              </p>
            </div>
          ) : (
            <p className="mt-2.5 line-clamp-3 text-title leading-[1.4] font-light text-bright">
              {state === 'error' ? <span className="text-body text-ink/80">Can’t reach the voice service. Check your connection and try again.</span>
                : muted ? <span className="text-faint">Microphone is off.</span>
                : heard ? <span className="text-ink/80">{heard}</span>
                : state === 'listening' ? <span className="text-faint">Go ahead, I’m listening.</span> : null}
            </p>
          )}
        </div>
      </div>

      <div className={cn('relative flex items-start', call ? 'gap-6' : 'gap-3.5')}>
        {state === 'error'
          ? <VoiceControl label="Try again" caption={call ? 'Retry' : undefined} onClick={() => onRetry?.()}><RotateCw size={21} strokeWidth={1.7} /></VoiceControl>
          : onMute && <VoiceControl label={muted ? 'Unmute' : 'Mute'} caption={call ? 'Mute' : undefined} active={muted} disabled={state === 'connecting'} onClick={onMute}>{muted ? <MicOff size={21} strokeWidth={1.7} /> : <Mic size={21} strokeWidth={1.7} />}</VoiceControl>}
        {controls}
        <span className="flex flex-col items-center gap-1.5">
          <button type="button" aria-label={call ? 'End call' : 'End voice mode'} onClick={() => { haptic('heavy'); onEnd(); }}
            className={cn('pressable grid place-items-center rounded-full bg-danger text-on-color shadow-[0_6px_20px_-6px_var(--color-danger)] hover:brightness-110', call ? 'h-[64px] w-[64px]' : 'h-[52px] w-[52px]')}>
            {call ? <PhoneOff size={24} strokeWidth={1.8} /> : <X size={21} strokeWidth={1.7} />}
          </button>
          {call && <span className="text-caption text-dim">End</span>}
        </span>
      </div>
      {call && state !== 'connecting' && state !== 'error' && <span className="relative mt-4 text-caption text-faint">{speaking ? 'Talk or tap the orb to interrupt' : 'Just talk'}</span>}
    </motion.div>
  );
}

/** A round call control (52px, 64px in calls) with an optional caption under it. */
export function VoiceControl({ label, caption, active, disabled, onClick, children }: { label: string; caption?: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <span className="flex flex-col items-center gap-1.5">
      <button type="button" aria-label={label} aria-pressed={active} disabled={disabled} onClick={() => { haptic('select'); onClick(); }}
        className={cn('pressable grid place-items-center rounded-full transition-colors disabled:opacity-40', caption ? 'h-[64px] w-[64px]' : 'h-[52px] w-[52px]', active ? 'bg-bright text-on-bright' : 'bg-fill-3 text-bright shadow-edge backdrop-blur-xl hover:bg-fill-4')}>
        {children}
      </button>
      {caption && <span className="text-caption text-dim">{caption}</span>}
    </span>
  );
}

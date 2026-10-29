/**
 * Luna's presence in chat: the voice orb, driven by assistant state.
 *
 * state: idle (slow swirl, rests in rest mode) · busy (fast swirl — thinking,
 * working; keeps moving because that is what you wait for) · rest (paused in
 * its first pose; use inside glass, where a moving child forces the backdrop
 * blur to recompute every frame — it swirls while an ancestor `.orb-trigger`
 * is hovered). One implementation: effects/VoiceOrb.
 */
import type { MotionValue } from 'motion/react';
import { VoiceOrb } from '../effects/VoiceOrb';

export function AssistantOrb({ size = 32, state = 'idle', level, className, label }: {
  size?: number;
  state?: 'idle' | 'busy' | 'rest';
  /** 0..1 live voice level — swells the orb. */
  level?: MotionValue<number>;
  className?: string;
  /** Accessible name when it stands for status (omit when decorative). */
  label?: string;
}) {
  return <VoiceOrb size={size} level={level} busy={state === 'busy'} atRest={state === 'rest'} label={label} className={className} />;
}

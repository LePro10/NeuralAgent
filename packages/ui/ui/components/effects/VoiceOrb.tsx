/**
 * Voice orb: a small glass sphere with light swirling inside. Small, it is a
 * voice button; large, it is the voice mode itself. Colours follow the accent
 * theme (--orb-* variables), so the orb is always "your" colour.
 *
 * Layers (gradients only; only transforms animate): deep base → rotating
 * conic swirl → drifting warm blob → specular highlight that leans towards
 * the pointer. Each moving layer carries its blur on a static child — a
 * filter on the moving element would pull the loop off the compositor.
 */
import { motion, useMotionTemplate, useMotionValue, useSpring, type MotionValue } from 'motion/react';
import { useEffect, useRef, type CSSProperties } from 'react';
import { cn } from '../../lib/cn';

export interface VoiceOrbProps {
  size: number;
  /** 0..1 live voice level; swells the orb. */
  level?: MotionValue<number>;
  /** Faster swirl (listening, thinking). */
  busy?: boolean;
  /** Rest in its first pose; swirl only while an ancestor `.orb-trigger` is hovered or focused (use inside glass). */
  atRest?: boolean;
  /** Seconds per swirl lap when not busy. */
  speed?: number;
  /** Specular highlight follows the pointer. */
  interactive?: boolean;
  /** Accessible name when the orb stands for a status (omit when decorative). */
  label?: string;
  className?: string;
}

export function VoiceOrb({ size, level, busy, atRest, speed, interactive = true, label, className }: VoiceOrbProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const sx = useSpring(useMotionValue(34), { stiffness: 220, damping: 24 });
  const sy = useSpring(useMotionValue(26), { stiffness: 220, damping: 24 });
  const shine = useMotionTemplate`radial-gradient(circle at ${sx}% ${sy}%, rgb(255 255 255 / .75) 0, rgb(255 255 255 / .14) 20%, transparent 42%)`;
  const scale = useSpring(useMotionValue(1), { stiffness: 300, damping: 26 });
  useEffect(() => level?.on('change', (v) => scale.set(1 + v * 0.14)), [level, scale]);
  const blur = Math.max(2, size * 0.09);

  return (
    <motion.span
      ref={ref}
      // Idle swirl is decoration and rests in rest mode; a busy swirl is what you wait for, so it keeps moving.
      className={cn('voice-orb', busy ? 'is-busy' : 'deko', atRest && 'at-rest', className)}
      style={{ width: size, height: size, scale: level ? scale : undefined, ...(speed ? { '--orb-speed': `${speed}s` } : {}) } as CSSProperties}
      onPointerMove={interactive ? (e) => {
        const r = ref.current!.getBoundingClientRect();
        sx.set(20 + ((e.clientX - r.left) / r.width) * 40);
        sy.set(14 + ((e.clientY - r.top) / r.height) * 34);
      } : undefined}
      onPointerLeave={interactive ? () => { sx.set(34); sy.set(26); } : undefined}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <i className="voice-orb-swirl"><i style={{ filter: `blur(${blur}px)` }} /></i>
      <i className="voice-orb-blob"><i style={{ filter: `blur(${blur * 0.8}px)` }} /></i>
      <motion.i className="voice-orb-shine" style={{ backgroundImage: shine }} />
    </motion.span>
  );
}

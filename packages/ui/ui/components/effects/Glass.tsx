/**
 * Glass surfaces.
 *
 * `GlassPanel` — the plain `.glass` recipe at a chosen level (subtle /
 * default / strong / clear); the level is set on the panel itself via
 * `data-glass`, so one panel can differ from the page's theme.
 *
 * `LiquidGlass` — a card that behaves like a lens: it tilts a little towards
 * the pointer, a specular highlight follows it, and the rim is brightest at
 * the top (a real glass edge catches light where it hits). Motion values
 * only — moving the pointer never re-renders React. No SVG displacement
 * (Chromium-only, pixelated); the effect is blur + rim + specular.
 */
import { motion, useMotionTemplate, useMotionValue, useSpring, useTransform } from 'motion/react';
import type { CSSProperties, ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { prefersReducedMotion } from '../../lib/motion';
import type { GlassLevel } from '../../lib/tokens';

export function GlassPanel({ level, rim = true, children, className, style }: { level?: GlassLevel; rim?: boolean; children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div data-glass={level && level !== 'default' ? level : undefined} className={cn('glass rounded-card', rim && 'rim', className)} style={style}>
      {children}
    </div>
  );
}

export function LiquidGlass({ children, level, tilt = 5, shine = 0.4, radius = 20, className }: {
  children: ReactNode;
  level?: GlassLevel;
  /** Max tilt in degrees (0 = flat). */
  tilt?: number;
  /** 0–1, strength of the specular highlight. */
  shine?: number;
  radius?: number;
  className?: string;
}) {
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.3);
  const sx = useSpring(px, { stiffness: 180, damping: 26 });
  const sy = useSpring(py, { stiffness: 180, damping: 26 });
  const rotateY = useTransform(sx, [0, 1], [-tilt, tilt]);
  const rotateX = useTransform(sy, [0, 1], [tilt, -tilt]);
  const hx = useTransform(sx, (v) => `${v * 100}%`);
  const hy = useTransform(sy, (v) => `${v * 100}%`);
  const highlight = useMotionTemplate`radial-gradient(70% 55% at ${hx} ${hy}, rgb(255 255 255 / ${shine * 0.32}), transparent 60%)`;
  const still = typeof window !== 'undefined' && prefersReducedMotion();

  return (
    <div style={{ perspective: 900 }} className={className}>
      <motion.div
        data-glass={level && level !== 'default' ? level : undefined}
        className="glass rim relative overflow-hidden"
        style={{ borderRadius: radius, rotateX: still ? 0 : rotateX, rotateY: still ? 0 : rotateY, transformStyle: 'preserve-3d' }}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          px.set((e.clientX - r.left) / r.width);
          py.set((e.clientY - r.top) / r.height);
        }}
        onPointerLeave={() => { px.set(0.5); py.set(0.3); }}
      >
        <motion.i aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ backgroundImage: highlight }} />
        {/* Inner bevel: a thin bright line at the top, a faint one at the bottom. */}
        <i aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_.5px_0_rgb(255_255_255/.2),inset_0_-.5px_0_rgb(255_255_255/.04)]" />
        <div className="relative">{children}</div>
      </motion.div>
    </div>
  );
}

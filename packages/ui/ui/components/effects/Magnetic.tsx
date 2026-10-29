/**
 * Magnetic: the child leans towards the pointer while it is near, and springs
 * back when it leaves. For one hero action (a CTA, the voice orb) — not for
 * every button. Pointer devices only; touch and reduced motion get the child as is.
 */
import { motion, useMotionValue, useSpring } from 'motion/react';
import { useRef, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { prefersReducedMotion } from '../../lib/motion';

export function Magnetic({ children, strength = 0.25, radius = 1.4, className }: {
  children: ReactNode;
  /** Share of the pointer offset the child follows (0–1). */
  strength?: number;
  /** Reach, as a multiple of the child's size, measured from its centre. */
  radius?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  // Damped enough to settle without a wobble.
  const x = useSpring(useMotionValue(0), { stiffness: 260, damping: 26 });
  const y = useSpring(useMotionValue(0), { stiffness: 260, damping: 26 });
  return (
    <span
      ref={ref}
      className={cn('relative inline-grid place-items-center', className)}
      onPointerMove={(e) => {
        if (e.pointerType !== 'mouse' || prefersReducedMotion()) return;
        const r = ref.current!.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        const reach = Math.max(r.width, r.height) * radius;
        const k = Math.max(0, 1 - Math.hypot(dx, dy) / reach);
        x.set(dx * strength * (0.4 + k * 0.6)); y.set(dy * strength * (0.4 + k * 0.6));
      }}
      onPointerLeave={() => { x.set(0); y.set(0); }}
      // A padded field around the child so the pull starts before the edge.
      style={{ padding: 18, margin: -18 }}
    >
      <motion.span className="inline-grid" style={{ x, y }}>{children}</motion.span>
    </span>
  );
}

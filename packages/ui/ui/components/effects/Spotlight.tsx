/**
 * Spotlight card: a soft accent light follows the pointer across the surface
 * and lights the border where it passes. The pointer position is written to
 * CSS variables (--mx/--my) directly — moving the mouse never re-renders React.
 * Touch devices have no hover: there it lights while pressed (`.is-lit`).
 */
import { useRef, type CSSProperties, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

export function Spotlight({ children, size = 280, className, style, as: Tag = 'div' }: {
  children: ReactNode;
  /** Diameter of the light in px. */
  size?: number;
  className?: string;
  style?: CSSProperties;
  as?: 'div' | 'section' | 'article' | 'li';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - r.left}px`);
    el.style.setProperty('--my', `${e.clientY - r.top}px`);
  };
  return (
    <Tag
      ref={ref as never}
      className={cn('spotlight', className)}
      style={{ ['--spot-size' as string]: `${size}px`, ...style }}
      onPointerMove={move}
      onPointerDown={(e) => { move(e); if (e.pointerType === 'touch') ref.current?.classList.add('is-lit'); }}
      onPointerUp={() => ref.current?.classList.remove('is-lit')}
      onPointerCancel={() => ref.current?.classList.remove('is-lit')}
    >
      {children}
    </Tag>
  );
}

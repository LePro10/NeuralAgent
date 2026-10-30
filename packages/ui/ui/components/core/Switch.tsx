/**
 * Switch and Check.
 * Switch: 51 × 31 on phones (iOS), 42 × 25 on desktop; the thumb springs across and widens while pressed (iOS feel).
 * Check: a 20px circle (or rounded square) that fills, then draws its tick;
 * a short scale pop confirms. `indeterminate` shows a bar for "some".
 */
import { motion } from 'motion/react';
import { cn } from '../../lib/cn';
import { haptic } from '../../lib/haptics';
import { SPRING } from '../../lib/motion';
import { useLayoutMode } from '../../lib/surface';

export function Switch({ checked, onChange, label, size = 'md', disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; size?: 'sm' | 'md'; disabled?: boolean }) {
  const sm = size === 'sm';
  const phone = useLayoutMode() === 'phone';
  const w = sm ? 34 : phone ? 51 : 42, h = sm ? 20 : phone ? 31 : 25, t = h - 4;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); haptic('select'); onChange(!checked); }}
      // 44px tall hit area around the track
      className={cn('group relative shrink-0 disabled:opacity-40', phone && !sm ? 'py-1.5' : 'py-2.5')}
    >
      <span className={cn('relative flex items-center rounded-full p-[2px] transition-colors duration-300 ease-out-soft', checked ? 'bg-accent-deep shadow-[inset_0_1px_1.5px_rgb(0_0_0/.25)]' : 'bg-fill-4 shadow-well')} style={{ width: w, height: h }}>
        <motion.span
          className="block rounded-full bg-knob shadow-[0_2px_4px_rgb(0_0_0/.22),0_0_0_var(--hair)_rgb(0_0_0/.1)]"
          style={{ height: t, originX: checked ? 1 : 0 }}
          initial={false}
          animate={{ x: checked ? w - t - 4 : 0, width: t }}
          // Pressed, the thumb swells into a glass lens and stretches towards where it is going (squash), then springs back.
          whileTap={{ width: t + 12, x: checked ? w - t - 16 : 0, scaleY: 0.9, backgroundColor: 'rgb(255 255 255 / 0.78)', boxShadow: '0 2px 8px rgb(0 0 0 / .35), inset 0 0 0 1px rgb(255 255 255 / .6), inset 0 -3px 5px rgb(255 255 255 / .25)' }}
          transition={SPRING.goo}
        />
      </span>
    </button>
  );
}

export function Check({ checked, onChange, label, color, square, indeterminate, display }: {
  checked: boolean; onChange?: (v: boolean) => void; label: string;
  /** Fill colour when checked (default bright). */
  color?: string;
  square?: boolean;
  indeterminate?: boolean;
  /** Visual only, inside another button (a whole row is the target). */
  display?: boolean;
}) {
  const Tag = display ? 'span' : 'button';
  const on = checked || indeterminate;
  return (
    <Tag
      type={display ? undefined : 'button'}
      role={display ? undefined : 'checkbox'}
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={display ? undefined : label}
      aria-hidden={display || undefined}
      onClick={display ? undefined : (e: React.MouseEvent) => { e.stopPropagation(); haptic(checked ? 'tick' : 'select'); onChange?.(!checked); }}
      // 40px target around a 20px mark; the negative margin keeps the layout at 20px.
      className={cn('grid shrink-0 place-items-center', display ? 'h-5 w-5' : '-m-2.5 h-10 w-10')}
    >
      <motion.span
        className={cn('relative grid h-5 w-5 place-items-center', square ? 'rounded-xs' : 'rounded-full')}
        initial={false}
        animate={{ scale: on ? [0.86, 1] : 1 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      >
        <span className={cn('absolute inset-0 border-[1.25px] transition-colors duration-200', square ? 'rounded-xs' : 'rounded-full', on ? 'border-transparent' : 'border-[rgb(var(--fg-rgb)/.3)]')} />
        <motion.span
          className={cn('absolute inset-0', square ? 'rounded-xs' : 'rounded-full')}
          style={{ background: color ?? 'var(--color-bright)' }}
          initial={false}
          animate={{ opacity: on ? 1 : 0, scale: on ? 1 : 0.5 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        />
        <svg viewBox="0 0 24 24" className="relative h-3 w-3" fill="none" stroke="var(--color-bg)" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round">
          {indeterminate
            ? <motion.path d="M6.5 12h11" initial={false} animate={{ pathLength: 1, opacity: 1 }} />
            : <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={false} animate={{ pathLength: checked ? 1 : 0, opacity: checked ? 1 : 0 }} transition={{ duration: 0.22, delay: checked ? 0.08 : 0, ease: [0.22, 1, 0.36, 1] }} />}
        </svg>
      </motion.span>
    </Tag>
  );
}

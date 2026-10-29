/**
 * Buttons. Pill-shaped, light type, no glow. One action per view is `primary`
 * (solid bright); everything else steps back.
 *
 *  primary  solid bright, lit like a bead — the one action that matters
 *  tint     the place's signal colour, softly (inside a tab with data-signal)
 *  glass    translucent with a specular rim — over light, images, video
 *  ghost    a quiet surface with a lit edge — secondary
 *  quiet    text only — tertiary, inline
 *  danger   soft red — destructive
 *
 * Small sizes draw small but keep a 44px touch target. `busy` swaps the icon
 * for a spinner and locks the button, so a second tap cannot slip through.
 * `type` defaults to "button": inside a form a bare <button> would submit it.
 */
import { AnimatePresence, motion } from 'motion/react';
import { type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export type ButtonVariant = 'primary' | 'tint' | 'glass' | 'ghost' | 'quiet' | 'danger';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

// Depth, not lines: primary is a lit bead, ghost a surface with a lit edge,
// tint and danger catch light only on their top lip.
const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-bright text-bg shadow-lit hover:bg-white',
  tint: 'bg-tab/[.14] text-tab shadow-lip hover:bg-tab/[.2]',
  glass: 'glass-lens text-bright hover:brightness-125',
  ghost: 'bg-fill-2 text-bright shadow-edge hover:bg-fill-3',
  quiet: 'text-ink hover:bg-fill-2 hover:text-bright',
  danger: 'bg-danger/[.12] text-danger shadow-lip hover:bg-danger/[.18]',
};

// Heights 28 / 32 / 38 / 44. xs and sm extend their hit area to 44px.
const SIZE: Record<ButtonSize, string> = {
  xs: 'h-7 px-3 text-meta gap-1.5 after:absolute after:-inset-y-2 after:inset-x-0 after:content-[""]',
  sm: 'h-8 px-3.5 text-chip gap-1.5 after:absolute after:-inset-y-1.5 after:inset-x-0 after:content-[""]',
  md: 'h-[38px] px-4 text-button gap-2',
  lg: 'h-11 px-5 text-body gap-2',
};
const ICON: Record<ButtonSize, number> = { xs: 13, sm: 14, md: 15, lg: 16 };

export interface ButtonProps {
  children?: ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  Icon?: LucideIcon;
  /** Icon after the label (arrows, chevrons). */
  IconEnd?: LucideIcon;
  /** Gloss band sweeps across on hover (pointer devices). Use on one hero CTA at most. */
  sheen?: boolean;
  block?: boolean;
  busy?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit';
  /** Renders an <a>. */
  href?: string;
  className?: string;
  'aria-label'?: string;
}

export function Button({ children, onClick, variant = 'primary', size = 'md', Icon, IconEnd, sheen, block, busy, disabled, type = 'button', href, className, ...rest }: ButtonProps) {
  const cls = cn(
    'pressable relative inline-flex select-none items-center justify-center whitespace-nowrap rounded-full font-medium tracking-[-.005em]',
    'disabled:pointer-events-none aria-disabled:pointer-events-none',
    disabled && !busy && 'opacity-40',
    VARIANT[variant], SIZE[size], sheen && 'sheen', block ? 'w-full' : 'shrink-0', className,
  );
  const s = ICON[size];
  const lead = busy ? 'busy' : Icon ? 'icon' : null;
  const inner = (
    <>
      <AnimatePresence initial={false} mode="popLayout">
        {lead && (
          <motion.span key={lead} className="grid place-items-center" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }} transition={{ duration: 0.16 }}>
            {busy ? <i className="spinner" style={{ ['--size' as string]: `${s - 1}px`, borderTopColor: 'currentColor' }} /> : Icon && <Icon size={s} strokeWidth={1.75} />}
          </motion.span>
        )}
      </AnimatePresence>
      {children}
      {IconEnd && <IconEnd size={s} strokeWidth={1.75} className="-mr-0.5 transition-transform duration-300 ease-out-soft group-hover:translate-x-0.5" />}
    </>
  );
  if (href) return <a href={href} className={cn('group', cls)} aria-disabled={disabled || undefined} {...rest}>{inner}</a>;
  return <button type={type} onClick={onClick} disabled={disabled || busy} aria-busy={busy || undefined} className={cn('group', cls)} {...rest}>{inner}</button>;
}

export type IconButtonVariant = 'fill' | 'glass' | 'ghost' | 'solid' | 'tint' | 'danger';

/** Round icon button: 30 / 36 / 52px. Every size keeps a ≥ 44px touch target. */
export function IconButton({ label, children, onClick, variant = 'fill', size = 'md', active, className, type = 'button' }: {
  label: string; children: ReactNode; onClick?: () => void; variant?: IconButtonVariant; size?: 'sm' | 'md' | 'lg'; active?: boolean; className?: string; type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'pressable relative grid shrink-0 place-items-center rounded-full',
        size === 'sm' && 'h-[30px] w-[30px] after:absolute after:-inset-[7px] after:content-[""]',
        size === 'md' && 'h-9 w-9 after:absolute after:-inset-1 after:content-[""]',
        size === 'lg' && 'h-[52px] w-[52px]',
        active ? 'bg-bright text-bg shadow-lit' : {
          fill: 'bg-fill-3 text-bright shadow-edge hover:bg-fill-4',
          glass: 'glass-lens text-bright hover:brightness-125',
          ghost: 'text-ink hover:bg-fill-2 hover:text-bright',
          solid: 'bg-bright text-bg shadow-lit hover:bg-white',
          tint: 'bg-tab/[.14] text-tab shadow-lip hover:bg-tab/[.2]',
          danger: 'bg-danger text-white hover:brightness-110',
        }[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

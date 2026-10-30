/**
 * Buttons. Pill-shaped, light type, no glow. One action per view is `primary`
 * (solid bright); everything else steps back.
 *
 *  primary  solid bright, lit like a bead — the one action that matters
 *  accent   filled with the accent (iOS filled button) — confirm, send, continue
 *  tint     the place's signal colour, softly (inside a tab with data-signal)
 *  glass    translucent with a specular rim — over light, images, video
 *  ghost    a quiet surface with a lit edge — secondary
 *  quiet    text only — tertiary, inline
 *  danger   soft red — destructive
 *
 * Heights follow the control tokens (sm/md/lg = 36/44/50 on phones, 30/36/42 on
 * desktop); xs is desktop-dense. Small sizes keep a 44px touch target. `busy` swaps the icon
 * for a spinner and locks the button, so a second tap cannot slip through.
 * `type` defaults to "button": inside a form a bare <button> would submit it.
 */
import { AnimatePresence, motion } from 'motion/react';
import { type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export type ButtonVariant = 'primary' | 'accent' | 'tint' | 'glass' | 'ghost' | 'quiet' | 'danger';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

// Depth, not lines: primary is a lit bead, ghost a surface with a lit edge,
// tint and danger catch light only on their top lip.
const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-bright text-on-bright shadow-lit hover:bg-bright/90',
  accent: 'bg-accent-deep text-on-color shadow-lip hover:brightness-110',
  tint: 'bg-tab/[.14] text-tab shadow-lip hover:bg-tab/[.2]',
  glass: 'glass-lens text-bright hover:brightness-125',
  ghost: 'bg-fill-2 text-bright shadow-edge hover:bg-fill-3',
  quiet: 'text-ink hover:bg-fill-2 hover:text-bright',
  danger: 'bg-danger/[.12] text-danger shadow-lip hover:bg-danger/[.18]',
};

// xs 28 (desktop-dense) · sm/md/lg from the control tokens. xs and sm extend their hit area.
const SIZE: Record<ButtonSize, string> = {
  xs: 'h-7 px-3 text-meta gap-1.5 after:absolute after:-inset-y-2 after:inset-x-0 after:content-[""]',
  sm: 'h-control-sm px-3.5 text-subhead gap-1.5 after:absolute after:-inset-y-1.5 after:inset-x-0 after:content-[""]',
  md: 'h-control px-4.5 text-button gap-2',
  lg: 'h-control-lg px-5 text-headline gap-2',
};
const ICON: Record<ButtonSize, number> = { xs: 13, sm: 14, md: 15, lg: 17 };
const ICON_CLASS: Record<ButtonSize, string | undefined> = { xs: undefined, sm: 'size-icon-sm', md: 'size-icon-sm', lg: 'size-icon' };

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
            {busy ? <i className="spinner" style={{ ['--size' as string]: `${s - 1}px`, borderTopColor: 'currentColor' }} /> : Icon && <Icon size={s} strokeWidth={1.75} className={ICON_CLASS[size]} />}
          </motion.span>
        )}
      </AnimatePresence>
      {children}
      {IconEnd && <IconEnd size={s} strokeWidth={1.75} className={cn(ICON_CLASS[size], '-mr-0.5 transition-transform duration-300 ease-out-soft group-hover:translate-x-0.5')} />}
    </>
  );
  if (href) return <a href={href} className={cn('group', cls)} aria-disabled={disabled || undefined} {...rest}>{inner}</a>;
  return <button type={type} onClick={onClick} disabled={disabled || busy} aria-busy={busy || undefined} className={cn('group', cls)} {...rest}>{inner}</button>;
}

export type IconButtonVariant = 'fill' | 'glass' | 'ghost' | 'solid' | 'tint' | 'danger';

/**
 * Round icon button. sm = control-sm (36 phone / 30 desktop), md = tap (44 / 36),
 * lg = 52. The glyph is sized here, not by the caller: icon-sm / icon (22 on phones)
 * / icon-lg, so no icon button is ever tiny. Every size keeps a ≥ 44px touch target.
 */
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
        size === 'sm' && 'size-control-sm after:absolute after:-inset-1.5 after:content-[""] [&_svg]:size-icon-sm',
        size === 'md' && 'size-tap after:absolute after:-inset-1 after:content-[""] [&_svg]:size-icon',
        size === 'lg' && 'size-[52px] [&_svg]:size-icon-lg',
        active ? 'bg-bright text-on-bright shadow-lit' : {
          fill: 'bg-fill-3 text-bright shadow-edge hover:bg-fill-4',
          glass: 'glass-lens text-bright hover:brightness-125',
          ghost: 'text-ink hover:bg-fill-2 hover:text-bright',
          solid: 'bg-bright text-on-bright shadow-lit hover:bg-bright/90',
          tint: 'bg-tab/[.14] text-tab shadow-lip hover:bg-tab/[.2]',
          danger: 'bg-danger text-on-color hover:brightness-110',
        }[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

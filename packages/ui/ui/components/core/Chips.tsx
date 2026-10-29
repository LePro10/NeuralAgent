/**
 * Chips filter, Pills label. Chips are buttons (32px, quiet surfaces, scroll
 * sideways on phones without triggering a pager); Pills are static status
 * labels in a soft tone.
 */
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { haptic } from '../../lib/haptics';

const chipCls = (on: boolean) => cn(
  'pressable relative flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-chip',
  'after:absolute after:-inset-y-1.5 after:inset-x-0 after:content-[""]',
  on ? 'bg-bright text-bg shadow-lit' : 'bg-fill-1 text-ink shadow-edge hover:bg-fill-2 hover:text-bright',
);

export interface ChipOption<T extends string> { value: T; label: string; count?: number; dot?: string; Icon?: LucideIcon; }

/** Single-choice filter row. On phones it bleeds to the screen edge and scrolls; on wide containers it wraps. */
export function Chips<T extends string>({ value, options, onChange, lead, nowrap, className }: {
  value: T; options: ChipOption<T>[]; onChange: (v: T) => void;
  /** Extra chips in front (toggles), set off by a hairline. */
  lead?: ReactNode;
  /** One scrolling row on wide screens too. */
  nowrap?: boolean;
  className?: string;
}) {
  return (
    <div data-no-swipe className={cn('rail -mx-4 gap-1.5 px-4 @[700px]:mx-0 @[700px]:px-0', !nowrap && '@[700px]:flex-wrap', className)}>
      {lead && <>{lead}<span aria-hidden="true" className="mx-1 w-[var(--hair)] shrink-0 self-stretch bg-line-2 [scroll-snap-align:none]" /></>}
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" aria-pressed={on} onClick={() => { if (!on) { haptic('select'); onChange(o.value); } }} className={chipCls(on)}>
            {o.dot && <i className="h-1.5 w-1.5 rounded-full" style={{ background: o.dot }} />}
            {o.Icon && <o.Icon size={13} strokeWidth={1.75} />}
            {o.label}
            {o.count !== undefined && <span className={cn('tabular text-meta', on ? 'text-bg/55' : 'text-dim')}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** One on/off chip, styled like `Chips`. */
export function ToggleChip({ on, onChange, label, count, Icon }: { on: boolean; onChange: (v: boolean) => void; label: string; count?: number; Icon?: LucideIcon }) {
  return (
    <button type="button" aria-pressed={on} onClick={() => { haptic('select'); onChange(!on); }} className={chipCls(on)}>
      {Icon && <Icon size={13} strokeWidth={1.75} />}
      {label}
      {count !== undefined && <span className={cn('tabular text-meta', on ? 'text-bg/55' : 'text-dim')}>{count}</span>}
    </button>
  );
}

export type Tone = 'neutral' | 'accent' | 'tab' | 'success' | 'warning' | 'danger' | 'live' | 'ember';

export const TONE: Record<Tone, { text: string; bg: string; border: string; dot: string }> = {
  neutral: { text: 'text-ink', bg: 'bg-fill-3', border: 'border-line-2', dot: 'bg-dim' },
  accent: { text: 'text-accent', bg: 'bg-accent/[.1]', border: 'border-accent/25', dot: 'bg-accent' },
  tab: { text: 'text-tab', bg: 'bg-tab/[.12]', border: 'border-tab/25', dot: 'bg-tab' },
  success: { text: 'text-mint', bg: 'bg-mint/[.1]', border: 'border-mint/25', dot: 'bg-mint' },
  warning: { text: 'text-warning', bg: 'bg-warning/[.1]', border: 'border-warning/25', dot: 'bg-warning' },
  danger: { text: 'text-danger', bg: 'bg-danger/[.1]', border: 'border-danger/25', dot: 'bg-danger' },
  live: { text: 'text-live', bg: 'bg-live/[.12]', border: 'border-live/30', dot: 'bg-live' },
  ember: { text: 'text-ember', bg: 'bg-ember/[.1]', border: 'border-ember/25', dot: 'bg-ember' },
};

/** Static status label: "Draft", "Sent", "3 left", "Live". */
export function Pill({ children, tone = 'neutral', Icon, dot, size = 'md', className }: { children: ReactNode; tone?: Tone; Icon?: LucideIcon; dot?: boolean; size?: 'sm' | 'md'; className?: string }) {
  const t = TONE[tone];
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full', size === 'sm' ? 'h-[18px] px-1.5 text-tiny' : 'h-[22px] px-2 text-meta', t.bg, t.text, className)}>
      {dot && <i className={cn('h-1.5 w-1.5 rounded-full', t.dot)} />}
      {Icon && <Icon size={size === 'sm' ? 10 : 11} strokeWidth={2} />}
      {children}
    </span>
  );
}

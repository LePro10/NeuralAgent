/**
 * Segmented control (iOS): a filled capsule track and a lifted thumb that
 * slides between options (spring `snap`). md is h-control-sm (36 on phones),
 * sm is the quiet secondary switch inside cards. `scroll` lets many options run
 * sideways on phones. `iconOnly` draws just the icons (the label becomes the
 * accessible name and tooltip) for tight bars.
 */
import { motion } from 'motion/react';
import type { LucideIcon } from 'lucide-react';
import { useId } from 'react';
import { cn } from '../../lib/cn';
import { haptic } from '../../lib/haptics';
import { SPRING } from '../../lib/motion';

export interface SegmentedOption<T extends string> { value: T; label: string; Icon?: LucideIcon; }

export function Segmented<T extends string>({ value, options, onChange, size = 'md', scroll, className, label, iconOnly }: {
  value: T; options: SegmentedOption<T>[]; onChange: (v: T) => void; size?: 'sm' | 'md'; scroll?: boolean; className?: string; label?: string; iconOnly?: boolean;
}) {
  const id = useId();
  const sm = size === 'sm';
  const track = (
    <div role="tablist" aria-label={label} className={cn('relative flex rounded-full bg-fill-3 p-[3px]', sm ? 'h-8' : 'h-control-sm', scroll && 'w-max min-w-full', !scroll && className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={iconOnly ? o.label : undefined}
            title={iconOnly ? o.label : undefined}
            onClick={() => { if (!active) { haptic('select'); onChange(o.value); } }}
            className={cn(
              'relative z-10 flex h-full flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full transition-colors duration-200',
              iconOnly ? (sm ? 'px-2.5' : 'px-3.5') : sm ? 'px-2.5 text-footnote' : 'px-3.5 text-subhead',
              active ? 'text-bright' : 'text-ink hover:text-bright',
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 -z-10 rounded-full bg-thumb shadow-raise"
                transition={SPRING.snap}
              />
            )}
            {o.Icon && <o.Icon size={sm ? 13 : 15} strokeWidth={1.75} className={sm ? undefined : 'size-icon-sm'} />}
            {!iconOnly && o.label}
          </button>
        );
      })}
    </div>
  );
  if (!scroll) return track;
  return <div data-no-swipe className={cn('scroll-x -mx-4 px-4', className)}>{track}</div>;
}

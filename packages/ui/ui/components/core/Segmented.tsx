/**
 * Segmented control. A sunk track (well) and a raised pill that slides on it
 * (spring `snap`) — like iOS, not a white blob. `sm` is the quiet secondary
 * switch inside cards. `scroll` lets many options run sideways on phones.
 */
import { motion } from 'motion/react';
import type { LucideIcon } from 'lucide-react';
import { useId } from 'react';
import { cn } from '../../lib/cn';
import { haptic } from '../../lib/haptics';
import { SPRING } from '../../lib/motion';

export interface SegmentedOption<T extends string> { value: T; label: string; Icon?: LucideIcon; }

export function Segmented<T extends string>({ value, options, onChange, size = 'md', scroll, className, label }: {
  value: T; options: SegmentedOption<T>[]; onChange: (v: T) => void; size?: 'sm' | 'md'; scroll?: boolean; className?: string; label?: string;
}) {
  const id = useId();
  const sm = size === 'sm';
  const track = (
    <div role="tablist" aria-label={label} className={cn('well relative flex rounded-full p-[3px]', scroll && 'w-max min-w-full', !scroll && className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => { if (!active) { haptic('select'); onChange(o.value); } }}
            className={cn(
              'relative z-10 flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full transition-colors duration-200',
              sm ? 'h-6 px-2.5 text-meta' : 'h-[30px] px-3.5 text-chip',
              active ? 'text-bright' : 'text-dim hover:text-ink',
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 -z-10 rounded-full bg-white/[.12] shadow-raise"
                transition={SPRING.snap}
              />
            )}
            {o.Icon && <o.Icon size={sm ? 12 : 13} strokeWidth={1.75} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
  if (!scroll) return track;
  return <div data-no-swipe className={cn('scroll-x -mx-4 px-4', className)}>{track}</div>;
}

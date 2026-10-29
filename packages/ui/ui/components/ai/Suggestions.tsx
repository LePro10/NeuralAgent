/**
 * Starting points for an empty chat. Suggestions are real next steps from
 * the user's context ("Plan tonight around gym"), never generic prompts.
 * Two layouts: a 2-column grid of quiet cards (desktop hero) and a sideways
 * rail of chips (phones, above the composer). Both stagger in.
 */
import { motion } from 'motion/react';
import { ArrowUpRight, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/cn';
import { haptic } from '../../lib/haptics';
import { EASE } from '../../lib/motion';

export interface Suggestion { title: string; detail?: string; Icon?: LucideIcon; prompt?: string }

export function SuggestionGrid({ items, onPick, layout = 'grid', delay = 0.15, className }: {
  items: Suggestion[]; onPick: (s: Suggestion) => void; layout?: 'grid' | 'rail'; delay?: number; className?: string;
}) {
  const enter = (i: number, axis: 'x' | 'y') => ({
    initial: { opacity: 0, [axis]: 8 }, animate: { opacity: 1, [axis]: 0 },
    transition: { duration: 0.5, ease: EASE.outSoft, delay: delay + i * 0.03 },
  });
  if (layout === 'rail') {
    return (
      <div data-no-swipe className={cn('rail -mx-4 gap-1.5 px-4', className)}>
        {items.map((s, i) => (
          <motion.button key={s.title} type="button" onClick={() => { haptic('select'); onPick(s); }} {...enter(i, 'x')}
            className="pressable relative flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-fill-1 px-3 text-chip whitespace-nowrap text-ink shadow-edge after:absolute after:-inset-y-1.5 after:inset-x-0 after:content-[''] hover:bg-fill-2 hover:text-bright">
            {s.Icon && <s.Icon size={13} strokeWidth={1.7} className="text-dim" />}
            {s.title}
          </motion.button>
        ))}
      </div>
    );
  }
  return (
    <div className={cn('grid grid-cols-1 gap-1.5 @min-[480px]:grid-cols-2', className)}>
      {items.map((s, i) => (
        <motion.button key={s.title} type="button" onClick={() => { haptic('select'); onPick(s); }} {...enter(i, 'y')}
          className="pressable group relative flex min-h-[56px] items-center gap-2.5 surface rounded-stat px-3 py-2.5 text-left transition-colors hover:bg-fill-2">
          {s.Icon && <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-tile bg-fill-3 text-dim transition-colors duration-300 group-hover:text-tab"><s.Icon size={13} strokeWidth={1.7} /></span>}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-small text-bright">{s.title}</span>
            {s.detail && <span className="block truncate text-meta text-dim">{s.detail}</span>}
          </span>
          <ArrowUpRight size={13} strokeWidth={1.75} className="shrink-0 text-faint opacity-0 transition-all duration-300 ease-out-soft group-hover:translate-x-px group-hover:-translate-y-px group-hover:opacity-100" />
        </motion.button>
      ))}
    </div>
  );
}

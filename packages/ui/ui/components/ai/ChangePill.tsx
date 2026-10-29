/**
 * What an answer changed, as small pills under it ("Moved Gym to 18:00",
 * "Created 3 tasks"). Each pill can be undone in place; undone pills strike
 * through and offer Redo. Tap the label to open details (e.g. a DiffCard).
 */
import { AnimatePresence, motion } from 'motion/react';
import { Redo2, Undo2, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/cn';
import { haptic } from '../../lib/haptics';
import { SPRING } from '../../lib/motion';

export interface Change { id: string; label: string; Icon?: LucideIcon; undone?: boolean }

export function ChangePills({ changes, onUndo, onRedo, onOpen, className }: {
  changes: Change[]; onUndo?: (id: string) => void; onRedo?: (id: string) => void; onOpen?: (id: string) => void; className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      <AnimatePresence initial={false}>
        {changes.map((c, i) => (
          <motion.div key={c.id} layout initial={{ opacity: 0, scale: 0.92, y: 4 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.12 } }} transition={{ ...SPRING.pop, delay: i * 0.03 }}
            className={cn('flex h-7 items-center rounded-full text-meta transition-[background-color,box-shadow] duration-300', c.undone ? 'shadow-[inset_0_0_0_var(--hair)_var(--color-line)]' : 'bg-fill-2 shadow-edge')}>
            <button type="button" onClick={() => onOpen?.(c.id)} disabled={!onOpen} className={cn('flex h-full items-center gap-1.5 pl-2.5', onUndo || onRedo ? 'pr-1' : 'pr-2.5')}>
              {c.Icon && <c.Icon size={12} strokeWidth={1.7} className={cn('transition-colors', c.undone ? 'text-faint' : 'text-tab')} />}
              <span className={cn('max-w-[220px] truncate transition-colors', c.undone ? 'text-faint line-through decoration-faint' : 'text-ink')}>{c.label}</span>
            </button>
            {(c.undone ? onRedo : onUndo) && (
              <button type="button" aria-label={c.undone ? `Redo: ${c.label}` : `Undo: ${c.label}`} onClick={() => { haptic('select'); (c.undone ? onRedo : onUndo)?.(c.id); }}
                className="relative mr-0.5 grid h-[22px] w-[22px] place-items-center rounded-full text-faint transition-colors after:absolute after:-inset-2.5 after:content-[''] hover:bg-fill-3 hover:text-bright">
                {c.undone ? <Redo2 size={11} strokeWidth={1.8} /> : <Undo2 size={11} strokeWidth={1.8} />}
              </button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/**
 * Action sheet (phones): a choice rises from the bottom as an opaque card of
 * finger-sized rows, with Cancel in its own group below — iOS's
 * UIAlertController.actionSheet. `Menu` turns into one by itself on phones,
 * so a pull-down inside a sheet never overflows the screen; use it directly
 * for "what do you want to do with this?" moments.
 *
 * Rows are 56px with 16px text, a leading icon, a check at the right for the
 * chosen entry, red for destructive ones; sections and dividers carry over
 * from MenuEntry. Long lists scroll inside the card, which stays under the
 * status bar. Back gesture, Escape, the scrim and Cancel close it.
 */
import { AnimatePresence, motion } from 'motion/react';
import { Check } from 'lucide-react';
import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn';
import { useFocusTrap } from '../../lib/focus-trap';
import { haptic } from '../../lib/haptics';
import { useLayer } from '../../lib/layers';
import { SPRING } from '../../lib/motion';
import { usePortalTarget } from '../../lib/surface';
import { menuKeys, type MenuEntry } from './Menu';

export function ActionSheet({ open, onClose, title, message, items, onChoose, cancelLabel = 'Cancel' }: {
  open: boolean;
  onClose: () => void;
  /** Small centred heading (what the choice is about). */
  title?: string;
  message?: string;
  items: MenuEntry[];
  /** Defaults to: close (unless keepOpen), then the entry's onSelect. */
  onChoose?: (e: MenuEntry) => void;
  cancelLabel?: string;
}) {
  const target = usePortalTarget();
  const box = useRef<HTMLDivElement>(null);
  useLayer(open, onClose);
  useFocusTrap(open, box);
  const choose = onChoose ?? ((e: MenuEntry) => { if (!e.keepOpen) onClose(); haptic('select'); e.onSelect(); });
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div key="scrim" className="fixed inset-0 z-[var(--z-popover)] bg-scrim" onClick={onClose}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }} />
      )}
      {open && (
        <motion.div
          key="sheet"
          ref={box}
          className="fixed inset-x-2 z-[var(--z-popover)] flex flex-col gap-2 outline-none"
          style={{ bottom: 'max(8px, var(--safe-bottom))', maxHeight: 'calc(100% - var(--safe-top) - 24px)' }}
          initial={{ y: '115%' }}
          animate={{ y: 0 }}
          exit={{ y: '115%', transition: { duration: 0.26, ease: [0.32, 0.72, 0, 1] } }}
          transition={SPRING.sheet}
        >
          <div role="menu" aria-label={title} onKeyDown={(e) => menuKeys(e, onClose)} className="material flex min-h-0 flex-col overflow-hidden rounded-[calc(16px*var(--rk))]">
            {(title || message) && (
              <div className="shrink-0 border-b-hair border-line px-5 py-3 text-center">
                {title && <div className="text-footnote text-dim">{title}</div>}
                {message && <div className="mt-0.5 text-footnote text-faint">{message}</div>}
              </div>
            )}
            <div className="scroller min-h-0">
              <ActionRows items={items} onChoose={choose} />
            </div>
          </div>
          <button type="button" onClick={onClose}
            className="material press-row h-14 shrink-0 rounded-[calc(16px*var(--rk))] text-headline text-accent outline-none">
            {cancelLabel}
          </button>
        </motion.div>
      )}
    </AnimatePresence>,
    target,
  );
}

/** The rows of an action sheet (also usable inside any sheet). */
export function ActionRows({ items, onChoose }: { items: MenuEntry[]; onChoose: (e: MenuEntry) => void }) {
  const choices = items.some((e) => e.checked !== undefined);
  return (
    <div className="list-rows">
      {items.map((e, i) => (
        <div key={`${e.id ?? e.label}-${i}`} role="none" className={cn(e.divider && i > 0 && 'border-t-[6px] border-[rgb(var(--fg-rgb)/.04)]')}>
          {e.section && <div className="px-5 pt-3 pb-1 text-footnote text-dim">{e.section}</div>}
          <button
            type="button"
            disabled={e.disabled}
            role={e.checked === undefined ? 'menuitem' : e.kind === 'check' ? 'menuitemcheckbox' : 'menuitemradio'}
            aria-checked={e.checked}
            onClick={() => onChoose(e)}
            className={cn(
              'press-row flex min-h-14 w-full items-center gap-3.5 px-5 py-2 text-left outline-none focus-visible:bg-fill-2 disabled:opacity-35',
              e.destructive ? 'text-danger' : 'text-bright',
            )}
          >
            {e.glyph ? <span className="grid size-icon shrink-0 place-items-center text-accent [&_svg]:size-icon">{e.glyph}</span> : e.Icon && <e.Icon strokeWidth={1.75} className={cn('size-icon shrink-0', !e.destructive && 'text-accent')} />}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body">{e.label}</span>
              {e.detail && <span className="block truncate text-footnote text-dim">{e.detail}</span>}
            </span>
            {choices && <span className="grid w-5 shrink-0 place-items-center text-accent">{e.checked && <Check size={18} strokeWidth={2.4} />}</span>}
          </button>
        </div>
      ))}
    </div>
  );
}

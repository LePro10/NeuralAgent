/**
 * Which model answers this chat. A quiet pill in the chat header that opens a
 * small translucent pull-down right where you tapped (no panel, no dimming).
 * A warning dot appears when the chosen model is unavailable and a fallback
 * is answering — the user should know.
 */
import { AnimatePresence, motion } from 'motion/react';
import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { MENU_SURFACE } from '../overlays/MenuList';
import { haptic } from '../../lib/haptics';
import { useLayer } from '../../lib/layers';
import { SPRING } from '../../lib/motion';

export interface ModelOption { id: string; label: string; detail?: string; badge?: string; disabled?: boolean }

export function ModelPill({ models, value, onChange, fallback, align = 'left', className }: {
  models: ModelOption[]; value: string; onChange: (id: string) => void;
  /** Label of the model actually answering, when it differs (shows the warning dot). */
  fallback?: string;
  align?: 'left' | 'center' | 'right';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const current = models.find((m) => m.id === value);
  useLayer(open, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', off);
    // Keyboard: focus the chosen option on open.
    requestAnimationFrame(() => list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus({ preventScroll: true }));
    return () => window.removeEventListener('pointerdown', off);
  }, [open]);
  const onKey = (e: React.KeyboardEvent) => {
    const items = [...(list.current?.querySelectorAll<HTMLElement>('[role="option"]:not(:disabled)') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
  };
  return (
    <div ref={box} className={cn('relative inline-block', className)}>
      <button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => { haptic('select'); setOpen(!open); }}
        className="pressable relative flex h-8 max-w-[52vw] items-center gap-1 rounded-full bg-fill-2 pr-2 pl-3 text-chip text-ink after:absolute after:-inset-y-1.5 after:inset-x-0 after:content-[''] hover:bg-fill-3 hover:text-bright">
        <span className="truncate">{fallback ?? current?.label ?? 'Model'}</span>
        <ChevronDown size={13} strokeWidth={1.75} className="shrink-0 text-faint transition-transform duration-300 ease-out-soft" style={{ transform: open ? 'rotate(180deg)' : 'none' }} />
        {fallback && <i title={`${current?.label} unavailable — ${fallback} is answering`} className="absolute top-0 right-0 h-2 w-2 rounded-full bg-warning ring-[1.5px] ring-bg" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div ref={list} role="listbox" aria-label="Model" onKeyDown={onKey}
            initial={{ opacity: 0, scale: 0.86, y: -2 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.12 } }} transition={SPRING.pop}
            // Translucent but readable: the glass is denser than a bar's, text behind must not compete.
            className={cn('absolute top-[calc(100%+6px)] z-[var(--z-popover)] w-[232px]', MENU_SURFACE, align === 'right' ? 'right-0' : align === 'center' ? 'left-1/2' : 'left-0')}
            style={{ transformOrigin: align === 'right' ? 'calc(100% - 20px) 0' : align === 'center' ? '50% 0' : '20px 0', x: align === 'center' ? '-50%' : 0 }}>
            {fallback && <p className="mx-1 mt-1 mb-1 rounded-item bg-warning/10 px-2.5 py-1.5 text-meta leading-snug text-warning">{current?.label} is unavailable. {fallback} answers for now.</p>}
            {models.map((m, i) => (
              <motion.button key={m.id} type="button" role="option" aria-selected={m.id === value} disabled={m.disabled}
                initial={{ opacity: 0, y: -3 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: 0.03 + i * 0.02 }}
                onClick={() => { haptic('select'); onChange(m.id); setOpen(false); }}
                className="flex min-h-10 w-full items-center gap-2 rounded-item px-2 py-1.5 text-left outline-none hover:bg-fill-3 focus-visible:bg-fill-3 disabled:opacity-40">
                <span className="grid w-4 shrink-0 place-items-center">{m.id === value && <Check size={13} strokeWidth={2} className="text-bright" />}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-chip text-bright">{m.label}{m.badge && <span className="rounded-full bg-tab/[.14] px-1.5 text-tiny leading-[15px] text-tab">{m.badge}</span>}</span>
                  {m.detail && <span className="block truncate text-meta text-dim">{m.detail}</span>}
                </span>
              </motion.button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

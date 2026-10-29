/**
 * Inputs. Wells sunk into the page: a faint fill, an inner shadow from the
 * top and a rim that brightens on focus, 10px corners. 16px text on phones (no zoom), 13.5px on desktop.
 * 44px tall on phones, 38px on desktop.
 */
import { Search as SearchIcon, X as XIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useLayoutEffect, useRef, type ReactNode, type Ref, type TextareaHTMLAttributes, type InputHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

/** The input recipe — use on any <input> that is not one of the components below. */
export const inputClass =
  'well h-11 w-full rounded-field px-3 text-input text-bright outline-none placeholder:text-faint ' +
  'min-[900px]:h-[38px] min-[900px]:text-button';

/** Labelled field: a quiet label, the control, an optional hint or error. */
export function Field({ label, hint, error, children, className }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1.5 block px-0.5 text-meta text-dim">{label}</span>
      {children}
      <AnimatePresence initial={false} mode="wait">
        {error ? (
          <motion.span key="e" role="alert" className="mt-1.5 block px-0.5 text-meta text-danger" initial={{ opacity: 0, y: -3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>{error}</motion.span>
        ) : hint ? (
          <motion.span key="h" className="mt-1.5 block px-0.5 text-meta text-faint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>{hint}</motion.span>
        ) : null}
      </AnimatePresence>
    </label>
  );
}

export function Input({ className, invalid, ref, ...props }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; ref?: Ref<HTMLInputElement> }) {
  return <input ref={ref} aria-invalid={invalid || undefined} className={cn(inputClass, className)} {...props} />;
}

/** Grows with its content up to `maxRows`, then scrolls. */
export function TextArea({ className, maxRows = 8, value, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { maxRows?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const line = parseFloat(getComputedStyle(el).lineHeight) || 22;
    el.style.height = `${Math.min(el.scrollHeight, line * maxRows + 20)}px`;
  }, [value, maxRows]);
  return <textarea ref={ref} value={value} rows={3} className={cn(inputClass, 'h-auto min-h-[88px] resize-none py-2.5 leading-relaxed', className)} {...props} />;
}

/** iOS-style search: filled, no border, 36px. */
export function SearchField({ value, onChange, placeholder = 'Search', autoFocus, inputRef, hint, className }: {
  value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean; inputRef?: Ref<HTMLInputElement>;
  /** Small hint at the right while empty (e.g. the shortcut), desktop only. */
  hint?: string;
  className?: string;
}) {
  return (
    <label className={cn('flex h-9 items-center gap-2 rounded-field bg-fill-3 px-2.5 transition-colors focus-within:bg-fill-4', className)}>
      <SearchIcon size={15} strokeWidth={1.75} className="text-dim" />
      <input
        ref={inputRef}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape' && value) { e.preventDefault(); onChange(''); } }}
        placeholder={placeholder}
        enterKeyHint="search"
        className="min-w-0 flex-1 bg-transparent text-input text-bright outline-none placeholder:text-dim min-[900px]:text-button"
      />
      {!value && hint && <kbd className="hidden rounded-xs bg-fill-2 px-1.5 font-mono text-tiny text-faint shadow-key min-[900px]:block">{hint}</kbd>}
      <AnimatePresence>
        {value && (
          <motion.button type="button" aria-label="Clear search" onClick={() => onChange('')} className="grid h-[18px] w-[18px] place-items-center rounded-full bg-white/25 text-bg"
            initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.5 }} transition={{ duration: 0.15 }}>
            <XIcon size={11} strokeWidth={2.5} />
          </motion.button>
        )}
      </AnimatePresence>
    </label>
  );
}

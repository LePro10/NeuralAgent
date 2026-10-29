/**
 * Inline editing instead of a sheet. A row that opens its content right
 * under itself — like the date and time pickers in iOS Settings: the rows
 * below slide down, nothing covers the screen, a second tap closes it.
 *
 * `Disclosure` takes any content; `InlinePicker` is the common case — pick
 * one of a few values (times, durations, colours) from chips or a short list.
 * While open, the row's value shows in the place's signal colour, so it is
 * clear which row the open area belongs to.
 *
 * Use inside a <List> (separators line up) or on its own.
 */
import { AnimatePresence, motion } from 'motion/react';
import { Check, ChevronDown, type LucideIcon } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { haptic } from '../../lib/haptics';
import { SPRING } from '../../lib/motion';

/** Height settles without overshoot; content follows a beat later. */
const OPEN = { ...SPRING.sheet, damping: 40 };

export function Disclosure({ title, value, Icon, detail, open: controlled, onOpenChange, defaultOpen = false, children, className }: {
  title: ReactNode;
  /** Current value at the right ("17:30", "Weekly"). Turns to the signal colour while open. */
  value?: ReactNode;
  Icon?: LucideIcon;
  detail?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const [own, setOwn] = useState(defaultOpen);
  const open = controlled ?? own;
  const id = useId();
  const set = (v: boolean) => { haptic('select'); if (controlled === undefined) setOwn(v); onOpenChange?.(v); };
  return (
    <div className={className} data-lead={Icon ? '' : undefined}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => set(!open)}
        className="flex min-h-[46px] w-full items-center gap-3 px-3.5 py-2 text-left transition-colors duration-150 hover:bg-fill-1 active:bg-fill-2 active:duration-0"
      >
        {Icon && <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-tile bg-fill-3 text-ink"><Icon size={14} strokeWidth={1.7} /></span>}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body leading-snug text-bright">{title}</span>
          {detail && <span className="mt-px block truncate text-detail text-dim">{detail}</span>}
        </span>
        {value !== undefined && (
          <span className={cn('shrink-0 text-small tabular transition-colors duration-300', open ? 'text-tab' : 'text-dim')}>{value}</span>
        )}
        <motion.span className="-mr-1 text-faint" animate={{ rotate: open ? 180 : 0 }} transition={OPEN}>
          <ChevronDown size={15} strokeWidth={1.75} />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={id}
            key="panel"
            className="overflow-hidden"
            initial={{ height: 0 }}
            animate={{ height: 'auto', transition: OPEN }}
            exit={{ height: 0, transition: { ...OPEN, stiffness: 520 } }}
          >
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0, transition: { duration: 0.24, delay: 0.06, ease: [0.22, 1, 0.36, 1] } }}
              exit={{ opacity: 0, transition: { duration: 0.1 } }}
              className="px-3.5 pt-0.5 pb-3"
            >
              {children}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export interface PickerOption<T extends string> { value: T; label: string; detail?: string }

/**
 * Pick one value inline. `chips` (default) for short values like times;
 * `list` for longer labels. Picking closes it after a short beat, so you
 * see the choice land.
 */
export function InlinePicker<T extends string>({ title, value, options, onChange, Icon, kind = 'chips', format, open, onOpenChange, className }: {
  title: ReactNode;
  value: T;
  options: PickerOption<T>[];
  onChange: (v: T) => void;
  Icon?: LucideIcon;
  kind?: 'chips' | 'list';
  /** Text of the current value at the right (defaults to the option's label). */
  format?: (v: T) => ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  const [own, setOwn] = useState(false);
  const isOpen = open ?? own;
  const setOpen = (v: boolean) => { if (open === undefined) setOwn(v); onOpenChange?.(v); };
  const pick = (v: T) => {
    haptic('select');
    onChange(v);
    window.setTimeout(() => setOpen(false), 180);
  };
  const current = options.find((o) => o.value === value);
  return (
    <Disclosure title={title} Icon={Icon} value={format ? format(value) : current?.label} open={isOpen} onOpenChange={setOpen} className={className}>
      {kind === 'chips' ? (
        <div role="radiogroup" className="flex flex-wrap gap-1.5">
          {options.map((o, i) => {
            const on = o.value === value;
            return (
              <motion.button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => pick(o.value)}
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1, transition: { duration: 0.2, delay: 0.05 + i * 0.022, ease: [0.22, 1, 0.36, 1] } }}
                className={cn(
                  'pressable h-8 rounded-full px-3 text-chip tabular',
                  on ? 'bg-bright text-bg shadow-lit' : 'bg-fill-1 text-ink shadow-edge hover:bg-fill-2 hover:text-bright',
                )}
              >
                {o.label}
              </motion.button>
            );
          })}
        </div>
      ) : (
        <div role="radiogroup" className="-mx-1.5 overflow-hidden rounded-field">
          {options.map((o, i) => {
            const on = o.value === value;
            return (
              <motion.button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => pick(o.value)}
                initial={{ opacity: 0, y: -3 }}
                animate={{ opacity: 1, y: 0, transition: { duration: 0.2, delay: 0.04 + i * 0.02 } }}
                className="flex min-h-10 w-full items-center gap-2.5 rounded-item px-1.5 text-left text-chip text-bright transition-colors hover:bg-fill-2 active:bg-fill-3"
              >
                <span className="grid w-4 place-items-center text-tab">{on && <Check size={14} strokeWidth={2.3} />}</span>
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.detail && <span className="text-meta text-dim">{o.detail}</span>}
              </motion.button>
            );
          })}
        </div>
      )}
    </Disclosure>
  );
}

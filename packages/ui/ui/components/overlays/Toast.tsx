/**
 * Toasts: short confirmations with an optional Undo, floating above the tab
 * bar. Prefer "do it + Undo" over "are you sure?" for anything reversible.
 *
 *   toast('Saved');
 *   toast('Story deleted', { undo: () => restore(id) });
 *   const t = toast.loading('Uploading 3 files…'); … t.update('Uploaded', { tone: 'success' });
 *
 * Rules (pure, see `stackToasts`):
 * - The same text without undo shows once; repeating it only extends its time.
 * - At most three. When full, the oldest toast *without* Undo goes first —
 *   never silently drop an Undo while a "Copied" stays.
 */
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, CheckCircle2, type LucideIcon } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { cn } from '../../lib/cn';
import { SPRING } from '../../lib/motion';

export type ToastTone = 'neutral' | 'success' | 'danger' | 'loading';

export interface ToastItem {
  id: number;
  text: string;
  undo?: () => void;
  /** Label of the action button (default "Undo"). */
  actionLabel?: string;
  tone?: ToastTone;
  Icon?: LucideIcon;
  /** Which <Toaster> shows it (several surfaces on one page, e.g. previews). */
  channel?: string;
}

export interface ToastOptions { undo?: () => void; actionLabel?: string; tone?: ToastTone; Icon?: LucideIcon; duration?: number; channel?: string }

/** How long a toast (and its Undo) stays. */
export const TOAST_MS = 3800;
/** Never more at once. */
export const TOAST_MAX = 3;

/** Which toasts remain after adding `next` (pure). */
export function stackToasts(list: ToastItem[], next: ToastItem, max = TOAST_MAX): ToastItem[] {
  let out = next.undo ? [...list] : list.filter((t) => t.undo || t.text !== next.text || t.channel !== next.channel);
  out.push(next);
  while (out.length > max) {
    const i = out.findIndex((t) => !t.undo && t !== next);
    out = out.filter((_, j) => j !== (i >= 0 ? i : 0));
  }
  return out;
}

let items: ToastItem[] = [];
const subs = new Set<() => void>();
const emit = () => subs.forEach((s) => s());
let seq = 0;
const timers = new Map<number, number>();

function remove(id: number) {
  window.clearTimeout(timers.get(id));
  timers.delete(id);
  if (!items.some((t) => t.id === id)) return;
  items = items.filter((t) => t.id !== id);
  emit();
}
function arm(id: number, ms: number) {
  window.clearTimeout(timers.get(id));
  if (ms > 0 && Number.isFinite(ms)) timers.set(id, window.setTimeout(() => remove(id), ms));
}

export interface ToastHandle {
  dismiss: () => void;
  /** Change text/tone in place (loading → done) without a new pill. */
  update: (text: string, opts?: ToastOptions) => void;
}

export function toast(text: string, opts: ToastOptions = {}): ToastHandle {
  const channel = opts.channel ?? 'main';
  const ms = opts.duration ?? (opts.tone === 'loading' ? Infinity : opts.undo ? TOAST_MS + 1200 : TOAST_MS);
  // Already showing: it simply stays longer — no flicker out and in.
  const same = !opts.undo && items.find((t) => !t.undo && t.text === text && t.channel === channel);
  const id = same ? same.id : ++seq;
  if (!same) {
    const before = new Set(items.map((t) => t.id));
    items = stackToasts(items, { id, text, channel, undo: opts.undo, actionLabel: opts.actionLabel, tone: opts.tone, Icon: opts.Icon });
    for (const old of before) if (!items.some((t) => t.id === old)) { window.clearTimeout(timers.get(old)); timers.delete(old); }
    emit();
  }
  arm(id, ms);
  return {
    dismiss: () => remove(id),
    update: (t, o = {}) => {
      items = items.map((x) => (x.id === id ? { ...x, text: t, tone: o.tone ?? 'neutral', undo: o.undo, actionLabel: o.actionLabel, Icon: o.Icon } : x));
      emit();
      arm(id, o.duration ?? TOAST_MS);
    },
  };
}
toast.success = (text: string, opts: ToastOptions = {}) => toast(text, { ...opts, tone: 'success' });
toast.error = (text: string, opts: ToastOptions = {}) => toast(text, { ...opts, tone: 'danger', duration: opts.duration ?? 6000 });
toast.loading = (text: string, opts: ToastOptions = {}) => toast(text, { ...opts, tone: 'loading' });

const TONE_ICON: Partial<Record<ToastTone, LucideIcon>> = { success: CheckCircle2, danger: AlertTriangle };

/**
 * Mount once per surface (inside AppShell or a preview). `role="status"`:
 * screen readers announce the text without stealing focus.
 */
export function Toaster({ channel = 'main', position = 'bottom' }: { channel?: string; position?: 'bottom' | 'top' }) {
  const all = useSyncExternalStore((s) => { subs.add(s); return () => subs.delete(s); }, () => items, () => items);
  const list = all.filter((t) => (t.channel ?? 'main') === channel);
  const top = position === 'top';
  return (
    <div role="status" aria-live="polite"
      className="pointer-events-none fixed inset-x-0 z-[var(--z-toast)] flex flex-col items-center gap-2 px-4"
      style={top ? { top: 'calc(var(--safe-top) + 12px)' } : { bottom: 'max(calc(var(--tabbar-space) + 12px), calc(var(--safe-bottom) + 12px))' }}>
      <AnimatePresence initial={false}>
        {list.map((t) => {
          const I = t.Icon ?? TONE_ICON[t.tone ?? 'neutral'];
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: top ? -14 : 14, scale: 0.86, filter: 'blur(6px)' }}
              animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)', transitionEnd: { filter: 'none' } }}
              exit={{ opacity: 0, scale: 0.94, filter: 'blur(4px)', transition: { duration: 0.16 } }}
              transition={{ ...SPRING.goo, damping: 26 }}
              // Long messages wrap instead of running off screen; one line stays a pill.
              className="material pointer-events-auto flex min-h-11 max-w-[min(100%,460px)] items-center gap-2.5 rounded-full py-1.5 pr-2 pl-4 text-subhead leading-snug text-bright"
            >
              {t.tone === 'loading'
                ? <i className="spinner shrink-0" style={{ ['--size' as string]: '13px' }} />
                : I && <I size={14} strokeWidth={1.8} className={cn('size-icon-sm shrink-0', t.tone === 'success' && 'text-mint', t.tone === 'danger' && 'text-danger')} />}
              <span className={cn('min-w-0 break-words py-0.5', !t.undo && 'pr-2')}>{t.text}</span>
              {t.undo && (
                <button type="button" onClick={() => { t.undo?.(); remove(t.id); }}
                  className="relative shrink-0 rounded-full px-2.5 py-1 text-subhead font-medium text-accent transition-colors hover:bg-lens after:absolute after:-inset-2 after:content-['']">
                  {t.actionLabel ?? 'Undo'}
                </button>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

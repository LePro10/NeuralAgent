/**
 * Pull-down menu for toolbars and rows (sort, filter, "more", account switch,
 * any choice that would otherwise be a <select>). On phones and desktop alike
 * it grows out of the button you tapped — a small translucent card, no sheet,
 * no dimmed screen — the way menus work in iOS apps.
 *
 * Motion: grows from the trigger's corner (spring 520/36 from 0.7), rows
 * follow 18ms apart; closing is quicker (140ms, shrinks to 0.94 and fades).
 * It opens below the trigger and flips above when there is no room, and
 * keeps 12px from the surface edges.
 *
 * A transparent catcher takes the next tap outside (it closes the menu and
 * does nothing else, as on iOS). Keyboard like an OS menu: arrows, Home/End,
 * first letter jumps, Tab and Escape close, focus returns to the trigger.
 * Scrolling the page or resizing closes it.
 */
import { AnimatePresence, motion } from 'motion/react';
import type { LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { haptic } from '../../lib/haptics';
import { useLayer } from '../../lib/layers';
import { SPRING, prefersReducedMotion } from '../../lib/motion';
import { useLayoutMode, usePortalTarget } from '../../lib/surface';
import { frameOf, toLocal, type Box } from './geometry';
import { MENU_SURFACE, MenuItems, menuHeight } from './MenuList';

export interface MenuEntry {
  label: string;
  /** Unique key when two entries share a label. */
  id?: string;
  /** Shown at the right of the row. */
  Icon?: LucideIcon;
  /** Something richer than an icon, at the left: avatar, colour dot, app icon. */
  glyph?: ReactNode;
  /** Right-aligned hint, or a second line when the row has a glyph. */
  detail?: string;
  /** Keyboard shortcut hint, pointer only ("⌘D"). */
  shortcut?: string;
  /** Radio-style selection; `kind: 'check'` for independent toggles. */
  checked?: boolean;
  kind?: 'radio' | 'check';
  destructive?: boolean;
  disabled?: boolean;
  onSelect: () => void;
  /** Starts a group with a hairline above. */
  divider?: boolean;
  /** Starts a group with a small label above. */
  section?: string;
  /** Keep the menu open after choosing (multi-select filters). */
  keepOpen?: boolean;
}

/** Arrow keys, Home/End and first letters inside a menu list — like an OS menu. */
export function menuKeys(e: React.KeyboardEvent<HTMLElement>, close: () => void) {
  const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not([disabled])')];
  if (!items.length) return;
  const i = items.indexOf(document.activeElement as HTMLButtonElement);
  const to = (n: number) => { e.preventDefault(); items[(n + items.length) % items.length]?.focus(); };
  if (e.key === 'ArrowDown') to(i + 1);
  else if (e.key === 'ArrowUp') to(i < 0 ? -1 : i - 1);
  else if (e.key === 'Home' || e.key === 'PageUp') to(0);
  else if (e.key === 'End' || e.key === 'PageDown') to(-1);
  else if (e.key === 'Tab') { e.preventDefault(); close(); }
  else if (e.key.length === 1 && /\S/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
    const k = e.key.toLowerCase();
    for (let n = 1; n <= items.length; n++) {
      const c = items[(i + n) % items.length];
      if (c.textContent?.trim().toLowerCase().startsWith(k)) { to((i + n) % items.length); break; }
    }
  }
}

/** Grows quickly, settles without a wobble. */
const GROW = { ...SPRING.snap, damping: 36 };
const EDGE = 12;

export function Menu({ trigger, items, title, align = 'end', width = 220, block }: {
  /** Render the trigger; call `open()` from its onClick. */
  trigger: (open: () => void, isOpen: boolean) => ReactNode;
  items: MenuEntry[];
  /** Accessible name of the menu. */
  title?: string;
  /** Which edge of the trigger the menu lines up with. */
  align?: 'start' | 'end';
  /** Preferred width; kept between 180px and the surface width − 24px. */
  width?: number;
  /** The trigger fills its container's width and never grows past it. */
  block?: boolean;
}) {
  const target = usePortalTarget();
  const ref = useRef<HTMLSpanElement>(null);
  const [at, setAt] = useState<Box | null>(null);
  const open = () => {
    const el = ref.current?.firstElementChild ?? ref.current;
    if (!el) return;
    haptic('select');
    setAt(toLocal(el.getBoundingClientRect(), target));
  };
  const close = useCallback(() => setAt(null), []);
  const choose = (e: MenuEntry) => { if (!e.keepOpen) close(); haptic('select'); e.onSelect(); };

  return (
    <span ref={ref} className={block ? 'relative flex w-full min-w-0 [&>*]:w-full' : 'relative inline-flex'}>
      {trigger(open, !!at)}
      <PullDown at={at} align={align} width={width} items={items} title={title} onClose={close} onChoose={choose} target={target} />
    </span>
  );
}

function PullDown({ at, align, width, items, title, onClose, onChoose, target }: {
  at: Box | null; align: 'start' | 'end'; width: number; items: MenuEntry[]; title?: string;
  onClose: () => void; onChoose: (e: MenuEntry) => void; target: HTMLElement;
}) {
  const touch = useLayoutMode() === 'phone';
  const box = useRef<HTMLDivElement>(null);
  useLayer(!!at, onClose);
  useEffect(() => {
    if (!at) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const menu = box.current;
    const scroll = (e: Event) => { if (!box.current?.contains(e.target as Node)) onClose(); };
    // Focus into the menu (the checked entry, else the first) so arrows work at once — keyboard users only see it.
    const f = requestAnimationFrame(() => {
      const el = box.current;
      (el?.querySelector<HTMLElement>('[aria-checked="true"]') ?? el?.querySelector<HTMLElement>('[role^="menuitem"]'))?.focus({ preventScroll: true });
    });
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', scroll, true);
    return () => {
      cancelAnimationFrame(f);
      window.removeEventListener('resize', onClose); window.removeEventListener('scroll', scroll, true);
      const now = document.activeElement;
      if ((!now || now === document.body || menu?.contains(now)) && before?.isConnected) before.focus({ preventScroll: true });
    };
  }, [at, onClose]);

  const frame = frameOf(target);
  const w = Math.max(180, Math.min(width, frame.w - EDGE * 2));
  const h = menuHeight(items, touch);
  const left = at ? Math.max(EDGE, Math.min(frame.w - w - EDGE, align === 'end' ? at.right - w : at.left)) : 0;
  const below = at ? at.bottom + 6 + h < frame.h - EDGE || at.top < h + EDGE + 6 : true;
  // Grow out of the trigger: the origin is the trigger's centre, at the menu edge that touches it.
  const originX = at ? Math.max(14, Math.min(w - 14, at.left + at.width / 2 - left)) : 0;
  const still = prefersReducedMotion();

  return createPortal(
    <AnimatePresence>
      {at && (
        <motion.div key="catch" className="fixed inset-0 z-[var(--z-popover)]" onPointerDown={(e) => { e.preventDefault(); onClose(); }}
          initial={false} exit={{ opacity: 0 }} transition={{ duration: 0.14 }} />
      )}
      {at && (
        <motion.div
          key="menu"
          ref={box}
          role="menu"
          aria-label={title}
          onKeyDown={(e) => menuKeys(e, onClose)}
          className={`scroller fixed z-[var(--z-popover)] outline-none ${MENU_SURFACE}`}
          style={{
            left, width: w,
            maxHeight: below ? frame.h - at.bottom - EDGE - 6 : at.top - EDGE - 6,
            ...(below ? { top: at.bottom + 6 } : { bottom: frame.h - at.top + 6 }),
            transformOrigin: `${originX}px ${below ? '0%' : '100%'}`,
          }}
          initial={still ? { opacity: 0 } : { opacity: 0, scale: 0.7 }}
          animate={{ opacity: 1, scale: 1, transition: { scale: GROW, opacity: { duration: 0.14 } } }}
          exit={{ opacity: 0, scale: still ? 1 : 0.94, transition: { duration: 0.14, ease: [0.4, 0, 1, 1] } }}
        >
          <MenuItems items={items} touch={touch} onChoose={onChoose} animate={!still} />
        </motion.div>
      )}
    </AnimatePresence>,
    target,
  );
}

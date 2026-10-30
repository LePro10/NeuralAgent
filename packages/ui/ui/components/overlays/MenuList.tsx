/**
 * The one look of every small menu (pull-down, context menu): light glass
 * like a glass button, a rim lit from above (no drawn border), 13px corners, rows that are
 * 38px on phones and 30px with a pointer. Labels left, icons right (as iOS does), a check column
 * on the left when the menu holds choices, tiny dim section labels, hairline
 * dividers, destructive rows in red.
 *
 * Items arrive with an 18ms stagger after the card has started to grow.
 */
import { motion, type Variants } from 'motion/react';
import { Check } from 'lucide-react';
import { useId, useState } from 'react';
import { cn } from '../../lib/cn';
import { SPRING } from '../../lib/motion';
import type { MenuEntry } from './Menu';

/** Glass of small menus: the same light glass as a glass button — a faint white veil, strong blur,
 *  a rim lit from the top. Never a dark box. */
export const MENU_SURFACE = 'glass rim rounded-menu p-1';

const list: Variants = { show: { transition: { staggerChildren: 0.018, delayChildren: 0.03 } } };
const row: Variants = {
  hide: { opacity: 0, y: -4, filter: 'blur(3px)' },
  show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.26, ease: [0.22, 1, 0.36, 1] } },
};

/** Approximate height of a list, for placing it above or below its trigger. */
export function menuHeight(items: MenuEntry[], touch: boolean) {
  const rich = items.some((e) => e.glyph && e.detail);
  const rowH = rich ? (touch ? 46 : 40) : touch ? 38 : 30;
  return items.length * rowH + items.filter((e) => e.divider && !e.section).length * 9 + items.filter((e) => e.section).length * 24 + 8;
}

export function MenuItems({ items, touch, onChoose, animate = true }: {
  items: MenuEntry[];
  /** Finger-sized rows. */
  touch: boolean;
  onChoose: (e: MenuEntry) => void;
  animate?: boolean;
}) {
  const choices = items.some((e) => e.checked !== undefined);
  const rich = items.some((e) => e.glyph && e.detail);
  // The hover light is one liquid lens that glides from row to row (fluid-goo's menu feel), not a fill per row.
  const lens = useId();
  const [hot, setHot] = useState<number | null>(null);
  return (
    <motion.div variants={list} initial={animate ? 'hide' : false} animate="show" onPointerLeave={() => setHot(null)}>
      {items.map((e, i) => (
        <motion.div key={`${e.id ?? e.label}-${i}`} variants={row} role="none"
          onPointerEnter={(ev) => { if (ev.pointerType === 'mouse' && !e.disabled) setHot(i); }} onFocusCapture={() => setHot(i)}>
          {e.divider && !e.section && i > 0 && <div className="mx-2.5 my-1 h-[var(--hair)] bg-white/[.07]" />}
          {e.section && <div className={cn('px-2.5 pb-0.5 text-tiny text-faint', i > 0 ? 'mt-1 border-t-hair border-white/[.06] pt-2' : 'pt-1')}>{e.section}</div>}
          <button
            type="button"
            disabled={e.disabled}
            role={e.checked === undefined ? 'menuitem' : e.kind === 'check' ? 'menuitemcheckbox' : 'menuitemradio'}
            aria-checked={e.checked}
            onClick={() => onChoose(e)}
            className={cn(
              'relative isolate flex w-full items-center gap-2 rounded-item px-2.5 text-left text-chip outline-none transition-colors duration-100',
              'active:bg-white/[.06] disabled:opacity-35',
              rich ? (touch ? 'min-h-[46px] py-1' : 'min-h-10 py-1') : touch ? 'h-[38px]' : 'h-[30px]',
              e.destructive ? 'text-danger' : 'text-bright',
            )}
          >
            {hot === i && (
              <motion.span aria-hidden="true" layoutId={`mh-${lens}`} className="absolute inset-0 -z-10 rounded-item bg-white/[.09] shadow-[inset_0_var(--hair)_0_rgb(255_255_255/.12)]" transition={SPRING.goo} />
            )}
            {choices && (
              <span className="grid w-3.5 shrink-0 place-items-center text-bright">
                {e.checked && <Check size={12} strokeWidth={2.2} />}
              </span>
            )}
            {e.glyph && <span className="shrink-0">{e.glyph}</span>}
            {rich ? (
              <span className="min-w-0 flex-1">
                <span className="block truncate leading-tight">{e.label}</span>
                {e.detail && <span className="block truncate text-tiny leading-tight text-dim">{e.detail}</span>}
              </span>
            ) : (
              <>
                <span className="min-w-0 flex-1 truncate">{e.label}</span>
                {e.detail && <span className="max-w-[45%] truncate text-meta text-dim">{e.detail}</span>}
              </>
            )}
            {!touch && e.shortcut && <kbd className="font-mono text-tiny text-faint">{e.shortcut}</kbd>}
            {e.Icon && <e.Icon size={14} strokeWidth={1.6} className={cn('shrink-0', e.destructive ? '' : 'text-dim')} />}
          </button>
        </motion.div>
      ))}
    </motion.div>
  );
}

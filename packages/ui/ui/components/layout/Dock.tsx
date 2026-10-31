/**
 * The Dock: the one bottom drop on phones ("Two Drops"), here as the tab bar.
 *
 * A calm glass capsule with up to five tabs (the app passes four): 24px icon, 12px label,
 * never truncated. The selected tab sits on a soft pill that moves like a drop: the edge in
 * the direction of travel leads on `goo`, the other trails on `drag`, so it stretches and
 * settles (fluid-goo's two-edge idea, re-implemented). The active glyph wears the accent
 * (or its place's signal colour); nothing else is coloured.
 *
 * - `minimised`: while a list scrolls down the labels fold away and the capsule shrinks
 *   to icons only (AppShell drives it with useHideOnScroll). Tap or scroll up brings it back.
 * - `hidden`: slides away (agent screens, keyboard open) and is inert.
 * - Badges: `activity` (ring / dot, core/Activity), `count` (a number pill), `badge` (red dot).
 *
 * The space it takes is a CSS value, not a measurement: `--dock-h` (AppShell) =
 * `--spacing-dock` + the bottom safe area. Tapping never re-renders on pointer move.
 */
import { animate, motion, useMotionValue, useTransform } from 'motion/react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { haptic } from '../../lib/haptics';
import { prefersReducedMotion, SPRING } from '../../lib/motion';
import { ACTIVITY_LABEL, ActivityMark, type Activity } from '../core/Activity';
import { PLACES, type Place, type Signal } from '../../lib/tokens';

export interface TabItem<T extends string = string> {
  id: T;
  label: string;
  Icon: LucideIcon;
  /** Generic red dot (prefer `activity`); a string becomes its accessible description. */
  badge?: boolean | string;
  /** A number on the icon (e.g. agents that need you). 0 / undefined shows nothing. */
  count?: number;
  /** What the agents behind this tab are doing: ring (working) or dot (waiting/done/error). See core/Activity. */
  activity?: Activity;
  /** The place: gives the signal colour (and, on a Page, the light). */
  place?: Place;
  /** Signal colour, if not taken from `place`. */
  signal?: Signal;
}

/** Accessible text for a tab's marks. */
const describe = (t: { activity?: Activity; badge?: boolean | string; count?: number }) =>
  [t.count ? `${t.count} new` : '', t.activity ? ACTIVITY_LABEL[t.activity] : typeof t.badge === 'string' ? t.badge : ''].filter(Boolean).join(', ') || undefined;

export const signalOf = (t: { signal?: Signal; place?: Place }): Signal | undefined => t.signal ?? (t.place ? PLACES[t.place].signal : undefined);

/** Inner padding of the capsule (px): the pill sits this far inside it. */
const PAD = 5;

export function Dock<T extends string>({ items, value, onChange, minimised = false, hidden = false, floating = true, className }: {
  items: TabItem<T>[];
  value: T;
  /** Also called for the active tab (scroll to top on re-tap). */
  onChange: (id: T) => void;
  /** Icons only, smaller (a list is scrolling down). */
  minimised?: boolean;
  /** Slid away and inert (agent screens, keyboard). */
  hidden?: boolean;
  /** Fixed to the bottom of its surface (default) or in flow. */
  floating?: boolean;
  className?: string;
}) {
  const n = items.length;
  const index = Math.max(0, items.findIndex((t) => t.id === value));
  const row = useRef<HTMLDivElement>(null);
  const [cell, setCell] = useState(0);
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCell((el.clientWidth - PAD * 2) / n));
    ro.observe(el);
    return () => ro.disconnect();
  }, [n]);

  // Two edges of the selection pill, in cells. The leading edge runs on goo, the trailing on drag.
  const left = useMotionValue(index);
  const right = useMotionValue(index + 1);
  const last = useRef(index);
  useEffect(() => {
    const from = last.current;
    last.current = index;
    if (from === index) { left.set(index); right.set(index + 1); return; }
    if (prefersReducedMotion()) { left.jump(index); right.jump(index + 1); return; }
    const forward = index > from;
    animate(left, index, forward ? SPRING.drag : SPRING.goo);
    animate(right, index + 1, forward ? SPRING.goo : SPRING.drag);
  }, [index, left, right]);
  const x = useTransform(left, (l) => PAD + l * cell);
  const scaleX = useTransform(() => Math.max(0.4, right.get() - left.get()));

  const pick = (i: number) => {
    haptic('select');
    onChange(items[i]!.id);
  };

  return (
    <motion.nav
      aria-label="Main"
      className={cn(floating ? 'absolute inset-x-0 bottom-0' : 'relative', 'pointer-events-none z-[var(--z-tabbar)] px-drop', className)}
      style={{ paddingBottom: 'max(8px, var(--safe-bottom))' }}
      initial={false}
      animate={{ y: hidden ? 'calc(100% + 24px)' : 0, opacity: hidden ? 0 : 1 }}
      transition={SPRING.sheet}
      aria-hidden={hidden || undefined}
      inert={hidden || undefined}
    >
      <motion.div
        className="glass rim pointer-events-auto relative mx-auto overflow-hidden rounded-full"
        initial={false}
        animate={{ height: minimised ? 'var(--spacing-dock-min)' : 'var(--spacing-dock)', maxWidth: minimised ? 300 : 440 }}
        transition={SPRING.sheet}
      >
        <div
          ref={row}
          role="tablist"
          aria-orientation="horizontal"
          className="relative flex h-full select-none"
          style={{ padding: PAD }}
          onKeyDown={(e) => {
            const go = (i: number) => { e.preventDefault(); pick(i); requestAnimationFrame(() => row.current?.querySelectorAll<HTMLElement>('[role="tab"]')[i]?.focus()); };
            if (e.key === 'ArrowRight' && index < n - 1) go(index + 1);
            else if (e.key === 'ArrowLeft' && index > 0) go(index - 1);
            else if (e.key === 'Home') go(0);
            else if (e.key === 'End') go(n - 1);
          }}
        >
          {cell > 0 && (
            <motion.span aria-hidden="true" className="pointer-events-none absolute rounded-full bg-lens shadow-edge" style={{ top: PAD, bottom: PAD, left: 0, width: cell, x, scaleX, transformOrigin: '0 50%' }} />
          )}
          {items.map((t, i) => (
            <DockTab key={t.id} item={t} active={i === index} minimised={minimised} onPick={() => pick(i)} />
          ))}
        </div>
      </motion.div>
    </motion.nav>
  );
}

function DockTab({ item, active, minimised, onPick }: { item: TabItem; active: boolean; minimised: boolean; onPick: () => void }) {
  const { Icon, label, badge, count, activity } = item;
  const signal = signalOf(item);
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-label={label}
      aria-description={describe(item)}
      tabIndex={active ? 0 : -1}
      onClick={onPick}
      className="pressable relative z-10 flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-full outline-offset-[-3px] transition-colors duration-300"
      style={{ color: active ? (signal ? `var(--color-signal-${signal})` : 'var(--color-accent)') : 'var(--color-dim)' }}
    >
      <span className="relative">
        <Icon size={minimised ? 22 : 24} strokeWidth={active ? 1.9 : 1.65} className="transition-[width,height] duration-300" />
        {activity && !count ? (
          <ActivityMark activity={activity} edge="ring-popover" />
        ) : count ? (
          <i aria-hidden="true" className="absolute -top-1.5 left-1/2 ml-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-accent px-1 text-[12px] leading-none font-medium not-italic text-bg tabular-nums ring-2 ring-popover">
            {count > 99 ? '99+' : count}
          </i>
        ) : (
          badge && <i aria-hidden="true" className="absolute -top-0.5 -right-1 size-2 rounded-full bg-sys-red ring-2 ring-popover" />
        )}
      </span>
      <motion.span
        className="dock-label"
        initial={false}
        animate={{ opacity: minimised ? 0 : 1, height: minimised ? 0 : 'auto' }}
        transition={SPRING.sheet}
        aria-hidden="true"
      >
        {label}
      </motion.span>
    </button>
  );
}

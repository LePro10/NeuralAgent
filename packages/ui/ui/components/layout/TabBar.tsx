/**
 * Floating liquid-glass tab bar (phones), with the rest of the app inside it.
 *
 * The lens is a glass capsule you can grab and slide across the tabs; it
 * snaps on release with the finger's velocity. Under the lens the icons are
 * re-drawn bright and slightly magnified — the refraction trick, without an
 * SVG displacement filter (which is Chromium-only and pixelated). The bright
 * copy is counter-scaled against the lens' squash & stretch, and the icon
 * below fades while the lens covers it, so the two never read as a double image.
 *
 * More: places beyond the bar (`more`) live inside the bar. Tap the last
 * cell — or pull the bar up — and the glass itself grows upward into a grid;
 * pull it down or tap outside and it folds back. No sheet, no second surface.
 * While you are in one of those places, the last cell *becomes* it (its icon,
 * its label, the lens on it), so the bar always says where you are.
 *
 * Each tab may carry its place's signal colour: the icon under the lens is
 * drawn in that colour and the lens picks up a faint tint of it.
 *
 * Everything that moves is a motion value; dragging never re-renders React.
 * Pass `position` to drive the lens from a swipeable pager (float tab index).
 */
import { animate, motion, useMotionValue, useMotionValueEvent, useSpring, useTransform, useVelocity, type MotionValue } from 'motion/react';
import { ChevronDown, LayoutGrid, type LucideIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn';
import { useFocusTrap } from '../../lib/focus-trap';
import { haptic } from '../../lib/haptics';
import { useKeyboardOpen } from '../../lib/hooks';
import { useLayer } from '../../lib/layers';
import { SPRING } from '../../lib/motion';
import { usePortalTarget } from '../../lib/surface';
import { PLACES, type Place, type Signal } from '../../lib/tokens';

export interface TabItem<T extends string = string> {
  id: T;
  label: string;
  Icon: LucideIcon;
  /** Quiet "needs you" dot; a string becomes its accessible description. */
  badge?: boolean | string;
  /** The place: gives the signal colour (and, on a Page, the light). */
  place?: Place;
  /** Signal colour, if not taken from `place`. */
  signal?: Signal;
}

export const signalOf = (t: { signal?: Signal; place?: Place }): Signal | undefined => t.signal ?? (t.place ? PLACES[t.place].signal : undefined);

const BAR = 58;
// The More grid: 4 columns of 68px tiles. Its height is known from the count,
// so a pull can open it before it is ever measured.
const COLS = 4, TILE = 68, GAP = 2, PAD_T = 12, PAD_B = 2;
const MORE = '\u0000more';

export function TabBar<T extends string>({ items, more, value, onChange, position, floating = true, moreLabel = 'More', className }: {
  items: TabItem<T>[];
  /** Places that do not fit: they open from the last cell. */
  more?: TabItem<T>[];
  value: T;
  /** Also called for the active tab (scroll to top on re-tap). */
  onChange: (id: T) => void;
  position?: MotionValue<number>;
  /** Fixed to the bottom of its surface (default) or in flow. */
  floating?: boolean;
  moreLabel?: string;
  className?: string;
}) {
  const extra = more?.length ? more : null;
  const inMore = extra?.find((t) => t.id === value);
  // The last cell stands in for the whole overflow — and wears the place you are in.
  const cells: TabItem<string>[] = extra
    ? [...items, { id: MORE, label: inMore?.label ?? moreLabel, Icon: inMore?.Icon ?? LayoutGrid, signal: inMore ? signalOf(inMore) : undefined, badge: inMore?.badge ?? extra.some((t) => t.badge) }]
    : items;
  const n = cells.length;
  const index = inMore ? n - 1 : Math.max(0, items.findIndex((t) => t.id === value));

  const own = useMotionValue(index);
  const lens = position ?? own;
  const keyboard = useKeyboardOpen();
  const rowRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [cell, setCell] = useState(0);

  // ── More: one progress value drives height, grid and scrim (0 closed … 1 open).
  const [open, setOpen] = useState(false);
  const prog = useMotionValue(0);
  const rows = extra ? Math.ceil(extra.length / COLS) : 0;
  const grow = rows ? PAD_T + rows * TILE + (rows - 1) * GAP + PAD_B : 0;
  const height = useTransform(prog, (p) => BAR + Math.max(0, p) * grow);
  const radius = useTransform(prog, [0, 0.3], [BAR / 2, 26]);
  const [shown, setShown] = useState(false); // grid mounted while any of it is visible
  useMotionValueEvent(prog, 'change', (p) => setShown(p > 0.001));
  const setMore = (v: boolean) => {
    setOpen(v);
    animate(prog, v ? 1 : 0, { ...SPRING.sheet, velocity: prog.getVelocity() });
    animate(lens, v ? n - 1 : index, SPRING.snap);
    if (v) haptic('select');
  };
  useLayer(open, () => setMore(false));
  useFocusTrap(open, panelRef);

  useLayoutEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCell((el.clientWidth - 12) / n));
    ro.observe(el);
    return () => ro.disconnect();
  }, [n]);

  // Follow the value when it changes from outside (unless a pager drives the lens).
  useEffect(() => { if (!position && !open) animate(own, index, SPRING.snap); }, [index, own, position]); // eslint-disable-line react-hooks/exhaustive-deps

  const x = useTransform(lens, (p) => 6 + p * cell);
  const innerX = useTransform(x, (v) => -v);
  // Liquid feel: the lens swells while held and stretches with speed.
  const press = useSpring(0, { stiffness: 600, damping: 30 });
  const speed = useVelocity(lens);
  const stretch = useSpring(useTransform(speed, (v) => Math.min(Math.abs(v) * 0.035, 0.22)), { stiffness: 500, damping: 40 });
  const scaleX = useTransform(() => 1 + press.get() * 0.1 + stretch.get());
  const scaleY = useTransform(() => 1 + press.get() * 0.16 - stretch.get() * 0.35);
  const invX = useTransform(scaleX, (v) => 1 / v);
  const invY = useTransform(scaleY, (v) => 1 / v);
  const innerOrigin = useTransform(x, (v) => `${v + cell / 2}px 50%`);

  // k: layout px per screen px — 1 on a phone, more inside a scaled preview.
  type G = { id: number; x0: number; y0: number; p0: number; moved: 'x' | 'y' | false; idx: number; base: number; k: number };
  const gesture = useRef<G | null>(null);
  const indexAt = (clientX: number, k: number) => {
    const r = rowRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(n - 1, Math.floor(((clientX - r.left) * k - 6) / cell)));
  };
  const pick = (i: number) => {
    const id = cells[i].id;
    if (id === MORE) { setMore(!open); return; }
    if (open) setMore(false);
    onChange(id as T);
  };
  const choose = (id: T) => { haptic('select'); setMore(false); onChange(id); };

  const down = (e: React.PointerEvent) => {
    if (e.button !== 0 || !cell) return;
    const el = rowRef.current!;
    el.setPointerCapture(e.pointerId);
    const k = el.offsetWidth / (el.getBoundingClientRect().width || el.offsetWidth);
    const idx = indexAt(e.clientX, k);
    gesture.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, p0: idx, moved: false, idx, base: open ? 1 : 0, k };
    // The lens slides under the finger on touch-down, like iOS.
    animate(lens, idx, SPRING.snap);
    press.set(1);
  };
  const move = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    const dx = (e.clientX - g.x0) * g.k, dy = (e.clientY - g.y0) * g.k;
    if (!g.moved) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 6) return;
      // Up (or down while open) pulls the bar; sideways drags the lens.
      g.moved = extra && Math.abs(dy) > Math.abs(dx) * 1.2 && (dy < 0 || open) ? 'y' : 'x';
      if (g.moved === 'y') { press.set(0); animate(lens, open ? n - 1 : index, SPRING.snap); prog.stop(); } else lens.stop();
    }
    if (g.moved === 'y') {
      const p = g.base - dy / grow;
      const before = prog.get() > 0.4;
      prog.set(p > 1 ? 1 + (p - 1) * 0.15 : p < 0 ? p * 0.15 : p); // rubber band at both ends
      if ((prog.get() > 0.4) !== before) haptic('tick');
      return;
    }
    const raw = g.p0 + dx / cell;
    const max = n - 1;
    const p = raw < 0 ? raw * 0.25 : raw > max ? max + (raw - max) * 0.25 : raw; // rubber band
    const before = Math.round(lens.get());
    lens.set(p);
    if (Math.round(p) !== before) haptic('tick');
  };
  const end = (e: React.PointerEvent, cancelled = false) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    gesture.current = null;
    press.set(0);
    if (g.moved === 'y') {
      // Decide with position and flick: a quick flick wins over distance.
      const v = prog.getVelocity();
      setMore(cancelled ? open : v > 1.2 ? true : v < -1.2 ? false : prog.get() > 0.4);
      return;
    }
    if (cancelled) { animate(lens, open ? n - 1 : index, SPRING.snap); return; }
    const target = g.moved ? Math.max(0, Math.min(n - 1, Math.round(lens.get()))) : g.idx;
    haptic('select');
    // Velocity carries into the spring; it never skips a tab.
    if (cells[target].id !== MORE) animate(lens, target, { ...SPRING.snap, velocity: speed.get() });
    pick(target);
  };

  const row = (bright: boolean) => cells.map((t, i) => (
    <Cell key={t.id} item={t} i={i} active={i === index} bright={bright} cell={cell} lens={lens} more={t.id === MORE ? prog : undefined} />
  ));
  const activeSignal = signalOf(cells[index] ?? {});

  const portal = usePortalTarget();
  const scrimOpacity = useTransform(prog, [0, 1], [0, 1]);

  return (
    <motion.nav
      aria-label="Main"
      className={cn(floating ? 'absolute inset-x-0 bottom-0' : 'relative', 'z-[var(--z-tabbar)] px-3', className)}
      style={{ paddingBottom: 'max(10px, var(--safe-bottom))' }}
      initial={false}
      animate={{ y: keyboard ? 120 : 0, opacity: keyboard ? 0 : 1 }}
      transition={SPRING.snap}
    >
      {/* Content scrolling past fades to black instead of peeking out below the bar. */}
      {floating && <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-[calc(100%+28px)] bg-[linear-gradient(180deg,rgb(8_9_9/0),rgb(8_9_9/.72)_45%,rgb(8_9_9/.94))]" />}
      {shown && createPortal(
        <motion.div aria-hidden="true" className={cn('fixed inset-0 bg-black/45', !open && 'pointer-events-none')}
          style={{ opacity: scrimOpacity, zIndex: 'calc(var(--z-tabbar) - 1)' }} onClick={() => setMore(false)} />,
        portal,
      )}
      <motion.div
        ref={panelRef}
        data-signal={activeSignal}
        role={open ? 'dialog' : undefined}
        aria-label={open ? moreLabel : undefined}
        className="glass relative mx-auto max-w-[400px] overflow-hidden outline-none"
        style={{ height, borderRadius: radius }}
      >
        {/* Open, the glass thickens a little, so the grid reads over busy content. */}
        {extra && shown && <motion.div aria-hidden="true" className="absolute inset-0 bg-[rgb(14_16_15/.55)]" style={{ opacity: scrimOpacity }} />}
        {/* More: the grid above the row, rising as the glass grows. */}
        {extra && shown && (
          // Anchored to the row, so a half-open pull shows the row nearest the bar, never an overlap.
          <div className="absolute inset-x-0 grid grid-cols-4 content-start gap-x-1 px-2" style={{ bottom: BAR, height: grow, paddingTop: PAD_T, rowGap: GAP }}>
            {extra.map((t, i) => <MoreTile key={t.id} item={t} i={i} active={t.id === value} prog={prog} onPick={() => choose(t.id)} />)}
          </div>
        )}
        <div
          ref={rowRef}
          role="tablist"
          className="absolute inset-x-0 bottom-0 touch-none select-none px-1.5"
          style={{ height: BAR }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={(e) => end(e)}
          onPointerCancel={(e) => end(e, true)}
          onKeyDown={(e) => {
            const go = (i: number) => { e.preventDefault(); haptic('select'); pick(i); requestAnimationFrame(() => rowRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[i]?.focus()); };
            if (e.key === 'ArrowRight' && index < n - 1) go(index + 1);
            else if (e.key === 'ArrowLeft' && index > 0) go(index - 1);
            else if (e.key === 'Home') go(0);
            else if (e.key === 'End') go(n - 1);
            else if (e.key === 'Enter' || e.key === ' ') { const i = [...(rowRef.current?.querySelectorAll('[role="tab"]') ?? [])].indexOf(document.activeElement as Element); if (i >= 0) go(i); }
          }}
        >
          <div className="flex h-full">{row(false)}</div>
          {cell > 0 && (
            <motion.div aria-hidden="true" className="pointer-events-none absolute top-[4px] bottom-[4px] left-0 rounded-full" style={{ x, width: cell, scaleX, scaleY }}>
              <div className="glass-lens absolute inset-0 rounded-full" />
              {/* A faint wash of the place's colour inside the glass. */}
              <div className="absolute inset-0 rounded-full bg-[radial-gradient(90%_70%_at_50%_120%,color-mix(in_oklab,var(--color-tab)_22%,transparent),transparent_70%)] transition-[background] duration-500" />
              <motion.div className="absolute inset-0 rounded-full" style={{
                opacity: press,
                background: 'radial-gradient(120% 90% at 30% 0%, rgb(255 255 255 / .24), transparent 55%), radial-gradient(80% 60% at 80% 110%, color-mix(in oklab, var(--color-tab) 30%, transparent), transparent 70%)',
              }} />
              {/* Refraction: the same row, bright and magnified, clipped to the lens. */}
              <div className="absolute inset-0 overflow-hidden rounded-full">
                <motion.div className="absolute top-[-4px] bottom-[-4px] left-0 flex" style={{ x: innerX, scaleX: invX, scaleY: invY, transformOrigin: innerOrigin, width: cell * n + 12, paddingLeft: 6 }}>
                  {row(true)}
                </motion.div>
              </div>
            </motion.div>
          )}
        </div>
      </motion.div>
    </motion.nav>
  );
}

function Cell({ item, i, active, bright, cell, lens, more }: { item: TabItem; i: number; active: boolean; bright: boolean; cell: number; lens: MotionValue<number>; more?: MotionValue<number> }) {
  // Base row only: hidden right under the lens, back to full as the lens moves away.
  const opacity = useTransform(lens, (p) => (bright || !cell ? 1 : Math.min(1, Math.max(0, Math.abs(p - i) * 2.4 - 0.35))));
  const { Icon, label, badge } = item;
  const signal = signalOf(item);
  // Under the lens the active icon wears its place's colour; the rest are bright white.
  const brightColor = signal && active ? `var(--color-signal-${signal})` : '#fff';
  const isMore = item.id === MORE;
  // The More cell turns its icon into a chevron as the grid opens.
  const iconOut = useTransform(more ?? lens, (p) => (more ? 1 - Math.min(1, Math.max(0, p * 2.2)) : 1));
  const chevIn = useTransform(iconOut, (v) => 1 - v);
  const chevRot = useTransform(iconOut, [0, 1], [0, -90]);
  return (
    <motion.div
      role={bright ? undefined : 'tab'}
      aria-selected={bright ? undefined : active}
      aria-haspopup={!bright && isMore ? 'dialog' : undefined}
      aria-label={bright ? undefined : label}
      aria-description={bright || typeof badge !== 'string' ? undefined : badge}
      tabIndex={bright ? -1 : active ? 0 : -1}
      className="flex h-full shrink-0 flex-col items-center justify-center gap-[3px] rounded-full outline-offset-[-4px] transition-colors duration-300"
      style={{ width: cell || undefined, flex: cell ? undefined : 1, color: bright ? brightColor : active ? 'var(--color-bright)' : 'var(--color-dim)', opacity }}
    >
      <span className="relative" style={bright ? { transform: 'scale(1.06)' } : undefined}>
        <motion.span className="block" style={{ opacity: iconOut }}><Icon size={20} strokeWidth={bright ? 1.9 : 1.6} /></motion.span>
        {more && <motion.span className="absolute inset-0 grid place-items-center" style={{ opacity: chevIn, rotate: chevRot }}><ChevronDown size={20} strokeWidth={bright ? 1.9 : 1.6} /></motion.span>}
        {badge && <motion.i aria-hidden="true" className="absolute -top-px -right-0.5 h-1.5 w-1.5 rounded-full bg-ember ring-[1.5px] ring-popover" style={{ opacity: iconOut }} />}
      </span>
      <span className="max-w-full truncate px-0.5 text-[9.5px] leading-none tracking-[.01em]" style={bright ? { transform: 'scale(1.04)' } : undefined}>{label}</span>
    </motion.div>
  );
}

function MoreTile({ item, i, active, prog, onPick }: { item: TabItem; i: number; active: boolean; prog: MotionValue<number>; onPick: () => void }) {
  // Tiles arrive with the glass, the row nearest the bar first — a ripple upward.
  const row = Math.floor(i / COLS), col = i % COLS;
  const d = (row === 0 ? 0.12 : 0) + col * 0.035;
  const opacity = useTransform(prog, [0.25 + d, 0.75 + d], [0, 1]);
  const y = useTransform(prog, [0.1 + d, 1], [14, 0]);
  const scale = useTransform(prog, [0.1 + d, 1], [0.9, 1]);
  const signal = signalOf(item);
  return (
    <motion.button
      type="button"
      onClick={onPick}
      aria-current={active ? 'page' : undefined}
      aria-description={typeof item.badge === 'string' ? item.badge : undefined}
      className="pressable group flex flex-col items-center justify-center gap-1.5 rounded-field outline-offset-[-2px]"
      style={{ opacity, y, scale, height: TILE }}
    >
      <span
        className={cn('relative grid h-10 w-10 place-items-center rounded-full transition-colors duration-300', active ? 'shadow-lip' : 'bg-fill-3 text-ink shadow-edge group-hover:bg-fill-4 group-hover:text-bright')}
        style={active ? { background: `color-mix(in oklab, var(--color-signal-${signal ?? 'silver'}) 18%, transparent)`, color: `var(--color-signal-${signal ?? 'silver'})` } : undefined}
      >
        <item.Icon size={18} strokeWidth={1.6} />
        {item.badge && <i aria-hidden="true" className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-ember ring-[1.5px] ring-popover" />}
      </span>
      <span className={cn('max-w-full truncate px-1 text-tiny leading-none', active ? 'text-bright' : 'text-dim')}>{item.label}</span>
    </motion.button>
  );
}

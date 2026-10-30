/**
 * Desktop navigation: a glass island that floats off the window's edge —
 * compact and centred while collapsed, full height once opened —
 * with the page's light running underneath it (the twin of the phone's tab
 * bar). Collapsed it is a 60px rail of quiet icons.
 *
 * Peek: rest on it (200 ms, pointer still) and it opens to 176px *over* the page; a click
 * cancels that until the pointer leaves, so switching places never opens
 * it. Leave and it folds back.
 * Pin: ⌘\ or the small panel icon beside the brand (shown while open) keeps
 * it open, and the page makes room. The account sits at the foot, set apart. 
 *
 * The active item wears its place's colour and its highlight slides between
 * entries. Groups are labelled when open and become a short hairline when
 * collapsed. ⌘/Ctrl + 1–9 switch, ⌘K searches.
 *
 * Items with a `menu` get a context menu (right-click, long-press); `reorder` items can be dragged
 * into a new order within their run (`onReorder`); `renaming` turns one label into a text field.
 * The island stays open while a menu or a rename is up.
 */
import { motion, Reorder } from 'motion/react';
import { PanelLeftClose, PanelLeftOpen, Search, Settings, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { haptic } from '../../lib/haptics';
import { MOD_KEY } from '../../lib/hooks';
import { SPRING } from '../../lib/motion';
import { useShell } from '../../lib/surface';
import { ACTIVITY_LABEL, ActivityMark, type Activity } from '../core/Activity';
import { ContextMenu } from '../overlays/ContextMenu';
import type { MenuEntry } from '../overlays/Menu';
import { PLACES, type Place, type Signal } from '../../lib/tokens';

export interface SidebarItem<T extends string = string> {
  id: T;
  label: string;
  Icon: LucideIcon;
  /** Generic red dot (prefer `activity`); a string becomes its accessible description. */
  badge?: boolean | string;
  /** What the agents behind this item are doing: ring (working) or dot (waiting/done/error). See core/Activity. */
  activity?: Activity;
  /** Items with the same group sit together under its label. */
  group?: string;
  /** Hairline above this item without a label (if you do not use `group`). */
  groupStart?: boolean;
  place?: Place;
  /** The place's signal colour: the active icon wears it. */
  signal?: Signal;
  /** Right-click / long-press actions. */
  menu?: MenuEntry[];
  /** Can be dragged into a new place among its neighbours that also have `reorder`. */
  reorder?: boolean;
  /** Hover title (e.g. the folder behind a workspace). */
  title?: string;
}

const RAIL = 60, OPEN = 176, INSET = 8;
// Hover intent. The pointer has to *rest* on the rail: it opens once the pointer has stayed within
// REST_SLOP px for `openDelay` (200 ms). Every bigger move restarts the wait, so a pointer that
// sweeps across on its way to the page never opens it, while a pause answers at about the speed of
// a tooltip. 200 ms sits just above a deliberate glance (~150 ms) and below the pause before a
// click on an icon, which cancels the peek anyway. Leaving folds it after 240 ms, so brushing the
// edge or re-entering right away does not flicker.
const INTENT_OUT = 240;
const REST_SLOP = 8;

export function Sidebar<T extends string>({ items: given, value, onChange, brand, above, footer, onSettings, settingsActive, search, shortcuts = true, openDelay = 200, pinned: pinnedProp, onPinnedChange, onReorder, renaming, onRename, className }: {
  items: SidebarItem<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Collapsed mark + expanded wordmark: `{ mark, word }`. */
  brand?: { mark: ReactNode; word?: ReactNode; onClick?: () => void };
  /** Quiet things just above the account block, outside it (version, update). Gets `open`. */
  above?: (open: boolean) => ReactNode;
  /** Account at the foot (avatar + name). Gets `open` to fade its text. */
  footer?: (open: boolean) => ReactNode;
  /** A settings button beside the account, shown while open. */
  onSettings?: () => void;
  /** Settings is the current page (lights the button). */
  settingsActive?: boolean;
  /** Shows a search entry that calls this. */
  search?: () => void;
  shortcuts?: boolean;
  /** How long the pointer rests before the island opens (ms). */
  openDelay?: number;
  /** Kept open, with the page making room. Uncontrolled if left out. */
  pinned?: boolean;
  onPinnedChange?: (v: boolean) => void;
  /** A run of `reorder` items was dragged: their ids in the new order, and the one that moved. */
  onReorder?: (ids: T[], moved: T) => void;
  /** This item's label is a text field; `onRename` gets the new name, or null when cancelled. */
  renaming?: T | null;
  onRename?: (id: T, name: string | null) => void;
  className?: string;
}) {
  // While a drag settles, the order it left behind (until `given` catches up, or 2 s pass).
  const [order, setOrder] = useState<T[] | null>(null);
  // The drag's own handlers keep the props from when it began, so they read the order from here.
  const orderRef = useRef<T[] | null>(null);
  orderRef.current = order;
  const runKeyRef = useRef('');
  const runIds = given.filter((i) => i.reorder).map((i) => i.id);
  const runKey = runIds.join('\n');
  runKeyRef.current = runKey;
  useEffect(() => {
    if (!order) return;
    if (order.join('\n') === runKey) { setOrder(null); return; }
    const t = window.setTimeout(() => setOrder(null), 2000);
    return () => window.clearTimeout(t);
  }, [order, runKey]);
  const items = order && order.length === runIds.length && order.every((id) => runIds.includes(id))
    ? (() => { const byId = new Map(given.map((i) => [i.id, i])); let k = 0; return given.map((i) => (i.reorder ? byId.get(order[k++])! : i)); })()
    : given;
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragging, setDragging] = useState<T | null>(null);
  const dragged = useRef(false);
  const [ownPin, setOwnPin] = useState(false);
  const pinned = pinnedProp ?? ownPin;
  const setPinned = (v: boolean) => { setOwnPin(v); onPinnedChange?.(v); };
  const [peek, setPeek] = useState(false);
  const open = pinned || peek || menuOpen || !!renaming || !!dragging;
  const id = useId();
  const shell = useShell();
  const timer = useRef(0);
  const clicked = useRef(false);
  const frame = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(0);
  useLayoutEffect(() => {
    const el = frame.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFull(el.clientHeight - INSET * 2));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Tell the shell how much room the page has to leave (only a pinned island takes room).
  useLayoutEffect(() => { shell?.setSidebarSpace(INSET * 2 + (pinned ? OPEN : RAIL)); }, [pinned, shell]);
  useLayoutEffect(() => () => shell?.setSidebarSpace(0), [shell]);

  const intend = (v: boolean) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPeek(v), v ? openDelay : INTENT_OUT);
  };
  // Where the pointer started resting; a move beyond REST_SLOP restarts the wait.
  const rest = useRef({ x: 0, y: 0 });
  const restAt = (e: ReactPointerEvent) => { rest.current = { x: e.clientX, y: e.clientY }; };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    if (!shortcuts) return;
    const key = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      if (search && e.key.toLowerCase() === 'k') { e.preventDefault(); search(); return; }
      if (e.key === '\\') { e.preventDefault(); setPinned(!pinned); setPeek(false); return; }
      const i = Number(e.key) - 1;
      if (i >= 0 && i < Math.min(9, items.length)) { e.preventDefault(); onChange(items[i].id); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }); // re-bound each render: cheap, and never stale

  const fade = 'whitespace-nowrap transition-opacity duration-200';
  const show = { opacity: open ? 1 : 0, transitionDelay: open ? '60ms' : '0ms' };
  const heading = (it: SidebarItem<T>, i: number) => {
    const head = it.group !== undefined ? (i === 0 || items[i - 1].group !== it.group ? it.group : null) : it.groupStart ? '' : null;
    if (head === null || i === 0) return null;
    return (
      // Open: the group's name. Collapsed: a short hairline. Same height, so nothing jumps.
      <div className="relative mt-1.5 h-6" aria-hidden={!head || undefined}>
        <span className="absolute top-1/2 left-[14.5px] h-[var(--hair)] w-[14px] bg-line-2 transition-opacity duration-200" style={{ opacity: open && head ? 0 : 1 }} />
        {head && <span className={cn('absolute top-1/2 left-[12.5px] -translate-y-1/2 text-tiny text-faint', fade)} style={show}>{head}</span>}
      </div>
    );
  };
  const row = (it: SidebarItem<T>, i: number) => {
    const active = it.id === value;
    const sig = it.signal ?? (it.place ? PLACES[it.place].signal : undefined);
    const editing = renaming === it.id;
    const cls = cn('group relative flex h-9 w-full items-center gap-3 rounded-field px-[12.5px] text-chip transition-colors duration-200',
      active ? 'text-bright' : 'text-dim hover:bg-fill-1 hover:text-ink', dragging === it.id && 'bg-fill-2 text-ink shadow-edge');
    const inner = (
      <>
        {active && <motion.span layoutId={`side-${id}`} className="absolute inset-0 rounded-field bg-lens shadow-[var(--shadow-edge),0_0_18px_-6px_color-mix(in_oklab,var(--color-accent)_50%,transparent)]" transition={SPRING.goo} />}
        <span className="relative transition-colors duration-300" style={active && sig ? { color: `var(--color-signal-${sig})` } : undefined}>
          <it.Icon size={18} strokeWidth={active ? 1.8 : 1.6} />
          {it.activity ? <ActivityMark activity={it.activity} edge="ring-chrome" size={7} /> : it.badge && <i className="absolute -top-0.5 -right-1 h-1.5 w-1.5 rounded-full bg-sys-red ring-[1.5px] ring-chrome" />}
        </span>
        {editing ? (
          <RenameField name={it.label} onDone={(name) => onRename?.(it.id, name)} />
        ) : (
          <span className={cn('relative min-w-0 truncate', fade)} style={show}>{it.label}</span>
        )}
        {shortcuts && i < 9 && !editing && <kbd className={cn('relative ml-auto font-mono text-tiny text-faint opacity-0 transition-opacity', open && 'group-hover:opacity-100')}>{MOD_KEY}{i + 1}</kbd>}
      </>
    );
    // No button while renaming: Space and Enter belong to the text field.
    const button = editing ? <div className={cls}>{inner}</div> : (
      <button type="button" onClick={() => { if (dragged.current) return; haptic('select'); onChange(it.id); }} aria-current={active ? 'page' : undefined} aria-label={it.label}
        aria-description={it.activity ? ACTIVITY_LABEL[it.activity] : typeof it.badge === 'string' ? it.badge : undefined}
        title={it.title} className={cls}>
        {inner}
      </button>
    );
    return it.menu && !editing ? <ContextMenu items={it.menu} radius={12} onOpenChange={setMenuOpen}>{button}</ContextMenu> : button;
  };
  return (
    // Collapsed, the island hugs its icons and floats at the middle of the edge; opened it grows
    // up and down to the full height (both ways at once, from the centre). Owner's choice: keep
    // this even though icons shift a little while it grows.
    <div ref={frame} className={cn('pointer-events-none absolute inset-y-0 left-0 z-[var(--z-sidebar)] flex items-center', className)} style={{ padding: INSET }}>
      <motion.nav
        aria-label="Main"
        onPointerEnter={(e) => { if (e.pointerType === 'mouse') { clicked.current = false; restAt(e); intend(true); } }}
        onPointerMove={(e) => {
          if (e.pointerType !== 'mouse' || peek || clicked.current) return;
          if (Math.hypot(e.clientX - rest.current.x, e.clientY - rest.current.y) > REST_SLOP) { restAt(e); intend(true); }
        }}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') { clicked.current = false; intend(false); } }}
        // A click (switching place) cancels the peek until the pointer leaves.
        onPointerDown={() => { if (!peek) { clicked.current = true; window.clearTimeout(timer.current); } }}
        // Keyboard focus opens it at once; focus from a click does not.
        onFocus={(e) => { if ((e.target as HTMLElement).matches(':focus-visible')) { window.clearTimeout(timer.current); setPeek(true); } }}
        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setPeek(false); }}
        // Collapsed it is barely there: thin, clear glass with a faint rim. Opened (peek or pin) it fills in.
        className={cn('glass rim pointer-events-auto flex max-h-full flex-col overflow-hidden rounded-dialog p-2 transition-[background-color,border-color] duration-300 ease-out-soft',
          !open && '!border-[rgb(var(--fg-rgb)/.05)] !bg-[color-mix(in_srgb,var(--color-chrome)_24%,transparent)]')}
        initial={false}
        animate={{ width: open ? OPEN : RAIL, height: open && full ? full : 'auto' }}
        // A peeking island floats over the page; a pinned one sits in its place.
        style={{ boxShadow: peek && !pinned ? 'var(--shadow-dialog), inset 0 1px 0 var(--glass-hi)' : open ? undefined : 'inset 0 1px 0 rgb(255 255 255 / .04)' }}
        transition={SPRING.sheet}
      >
        {/* Brand, and — only while open — a quiet pin at the far end of the same row. */}
        <div className="mb-3 flex h-10 shrink-0 items-center">
          {brand && (
            <button type="button" onClick={brand.onClick} className="group flex h-10 min-w-0 flex-1 items-center gap-3 rounded-field px-[11.5px]" aria-label="Home">
              <span className="block">{brand.mark}</span>
              {brand.word && <span className={fade} style={show}>{brand.word}</span>}
            </button>
          )}
          <button type="button" onClick={() => { setPinned(!pinned); setPeek(false); }} aria-pressed={pinned} aria-keyshortcuts="Control+\ Meta+\"
            aria-label={pinned ? 'Collapse sidebar' : 'Keep sidebar open'} title={`${pinned ? 'Collapse' : 'Keep open'}  ${MOD_KEY}\\`}
            tabIndex={open ? 0 : -1}
            className={cn('ml-auto grid h-7 w-7 shrink-0 place-items-center rounded-item text-faint transition-[opacity,color,background-color] duration-200 hover:bg-fill-2 hover:text-ink', !open && 'pointer-events-none')}
            style={show}>
            {pinned ? <PanelLeftClose size={15} strokeWidth={1.6} /> : <PanelLeftOpen size={15} strokeWidth={1.6} />}
          </button>
        </div>
        {search && (
          <button type="button" onClick={search} aria-keyshortcuts="Control+K Meta+K" aria-label="Search"
            // Quiet: a row like the others, a breath of fill when open, the shortcut only on hover.
            className={cn('group mb-1.5 flex h-8 w-full shrink-0 items-center gap-3 rounded-field px-[14px] text-chip text-faint transition-[background-color,color] duration-300 hover:bg-fill-2 hover:text-ink', open && 'bg-fill-1')}>
            <Search size={15} strokeWidth={1.6} className="shrink-0" />
            <span className={fade} style={show}>Search</span>
            <kbd className={cn('ml-auto font-mono text-tiny text-faint opacity-0 transition-opacity', open && 'group-hover:opacity-100')}>{MOD_KEY}K</kbd>
          </button>
        )}
        <motion.ul layoutScroll className="scroller -mx-2 flex min-h-0 flex-1 flex-col px-2">
          {items.map((it, i) => {
            // A run of reorderable items is one drag list; it is drawn at its first item.
            if (it.reorder && onReorder) {
              if (i > 0 && items[i - 1].reorder) return null;
              let end = i;
              while (end < items.length && items[end].reorder) end++;
              const run = items.slice(i, end);
              return (
                <li key={`run-${it.group ?? i}`}>
                  {heading(it, i)}
                  <Reorder.Group as="ul" axis="y" values={run.map((r) => r.id)} onReorder={(ids: T[]) => { orderRef.current = ids; setOrder(ids); }} className="flex flex-col">
                    {run.map((r, k) => (
                      <Reorder.Item key={r.id} as="li" value={r.id} className="relative"
                        onDragStart={() => { dragged.current = true; setDragging(r.id); }}
                        onDragEnd={() => {
                          setDragging(null);
                          window.setTimeout(() => { dragged.current = false; }, 0);
                          const ids = orderRef.current;
                          if (ids && ids.join('\n') !== runKeyRef.current) onReorder(ids, r.id);
                        }}
                        whileDrag={{ scale: 1.03 }}>
                        {row(r, i + k)}
                      </Reorder.Item>
                    ))}
                  </Reorder.Group>
                </li>
              );
            }
            return (
              <li key={it.id}>
                {heading(it, i)}
                {row(it, i)}
              </li>
            );
          })}
        </motion.ul>

        {above && <div className="shrink-0">{above(open)}</div>}
        {/* You: always at the foot, set apart by a hairline and a slightly deeper ground. */}
        {(footer || onSettings) && (
          <div className={cn('-mx-2 -mb-2 mt-2 flex shrink-0 items-center gap-1 border-t-hair p-2 transition-[background-color,border-color] duration-300', open ? 'border-line bg-fill-1' : 'border-transparent')}>
            <div className="min-w-0 flex-1">{footer?.(open)}</div>
            {onSettings && (
              <button type="button" onClick={() => { haptic('select'); onSettings(); }} aria-label="Settings" title="Settings" tabIndex={open ? 0 : -1}
                aria-current={settingsActive ? 'page' : undefined}
                className={cn('grid h-8 shrink-0 place-items-center overflow-hidden rounded-item transition-[opacity,color,background-color] duration-200 hover:bg-fill-2 hover:text-bright', open ? 'w-8' : 'pointer-events-none w-0', settingsActive ? 'bg-white/[.075] text-bright shadow-edge' : 'text-dim')}
                style={show}>
                <Settings size={16} strokeWidth={1.6} />
              </button>
            )}
          </div>
        )}
      </motion.nav>
    </div>
  );
}

/** The label as a text field: Enter or leaving it keeps the name, Escape keeps the old one. */
function RenameField({ name, onDone }: { name: string; onDone: (name: string | null) => void }) {
  const [v, setV] = useState(name);
  const done = useRef(false);
  const finish = (n: string | null) => { if (done.current) return; done.current = true; onDone(n); };
  return (
    <input
      autoFocus
      value={v}
      aria-label="Name"
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setV(e.currentTarget.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(v.trim() && v.trim() !== name ? v.trim() : null);
        if (e.key === 'Escape') finish(null);
      }}
      onBlur={() => finish(v.trim() && v.trim() !== name ? v.trim() : null)}
      className="relative -my-1 -ml-1.5 h-7 min-w-0 flex-1 rounded-item bg-fill-2 px-1.5 text-chip text-bright outline-none ring-1 ring-accent/50"
    />
  );
}

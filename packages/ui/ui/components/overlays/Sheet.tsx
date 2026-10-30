/**
 * Panel for tasks — writing a mail, adding an event, picking files.
 * Phones: a floating card, 8px off the edges and rounded all round (like
 * iOS 26), exactly as tall as its content up to nearly the full screen; drag
 * it or flick down to dismiss. Desktop: a glass panel that floats in from
 * the right edge, 8px off it, while the page stays in view — no centred
 * modal, except `desktop="dialog"` for the rare special case.
 *
 * The header is compact: close on the left, a small centred title, the
 * primary action (`action`) on the right — no big title, no heavy footer.
 *
 * Detents: no `snaps` = fits its content (iOS "custom" detent), capped under
 * the status bar; `SNAPS.half` / `SNAPS.tall` / `SNAPS.full` for medium/large.
 * Keyboard: the card lifts above it and shrinks to the visible area (any
 * portal target), and a focused field is scrolled into view.
 * A small choice on a phone is a `Menu` (it becomes an action sheet itself).
 *
 * Gestures adapted from 21st.dev "Magnetic Drawer" (animbits): snap maths,
 * plus back gesture, Escape, focus return, keyboard awareness, and short
 * content that drags the whole panel.
 *
 * Smoothness: opening and closing run on the compositor — the spring is
 * sampled once (springPoints) and handed over as Web Animations on the sheet
 * and its backdrop, so a heavy React render or data arriving mid-transition
 * cannot make it stutter. Dragging stays in JS (it follows the finger); a
 * finger landing mid-transition takes over from where the sheet is.
 *
 * Phone vs. desktop comes from the surrounding <Surface> (AppShell, device
 * preview) — not the viewport — and the sheet portals into that surface.
 */
import { AnimatePresence, animate, motion, useMotionValue, useTransform, usePresence } from 'motion/react';
import { X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn';
import { useFocusTrap } from '../../lib/focus-trap';
import { haptic } from '../../lib/haptics';
import { useLayer } from '../../lib/layers';
import { SPRING, TICK, pointAt, prefersReducedMotion, springPoints } from '../../lib/motion';
import { useKeyboardInset, useLayoutMode, usePortalTarget, useSurfaceHeight } from '../../lib/surface';
import { SNAPS } from '../../lib/tokens';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  eyebrow?: string;
  /** Fractions of the surface height; the first is where it opens. Default: fits its content. Presets in `SNAPS`. */
  snaps?: readonly number[];
  children: ReactNode;
  /** Primary action at the top right (a small Button: "Add", "Send"). */
  action?: ReactNode;
  /** Pinned under the content (secondary tools: attach, formatting). */
  footer?: ReactNode;
  /** Desktop width: side panel 340 / 420 / 560px, dialog 380 / 500 / 1000px. */
  size?: 'sm' | 'md' | 'lg';
  /** Desktop form. `panel` (default): a glass panel floating in from the right, the page stays in view.
   *  `dialog`: centred and modal — only for special cases (confirm the irreversible). */
  desktop?: 'panel' | 'dialog';
  /** Translucent glass instead of the solid sheet colour (over photos, maps, video). */
  glass?: boolean;
  /** Hide the round close button (sheets with their own Cancel/Done). */
  hideClose?: boolean;
  /** Extra classes on the content scroller. */
  bodyClassName?: string;
}

type Inner = SheetProps & { boxRef: RefObject<HTMLDivElement | null>; target: HTMLElement };

/** Opening: settles without overshoot. Closing: a little faster. */
const OPEN = SPRING.sheet;
const SHUT = { ...SPRING.sheet, stiffness: 520 };

export function Sheet(props: SheetProps) {
  const mode = useLayoutMode();
  const target = usePortalTarget();
  const { open, onClose } = props;
  // Back gesture and Escape close only the topmost layer.
  useLayer(open, onClose);
  // Tab stays inside; on close, focus returns to whatever opened it.
  const boxRef = useRef<HTMLDivElement>(null);
  useFocusTrap(open, boxRef);
  return createPortal(
    <AnimatePresence>
      {open && (mode === 'desktop'
        ? props.desktop === 'dialog' ? <Dialog key="d" {...props} boxRef={boxRef} target={target} /> : <SidePanel key="s" {...props} boxRef={boxRef} target={target} />
        : <Drawer key="m" {...props} boxRef={boxRef} target={target} />)}
    </AnimatePresence>,
    target,
  );
}

function Header({ title, eyebrow, onClose, hideClose, action }: { title?: string; eyebrow?: string; onClose: () => void; hideClose?: boolean; action?: ReactNode }) {
  if (!title && !eyebrow && hideClose && !action) return null;
  const close = !hideClose && (
    <button type="button" onClick={onClose} onPointerDown={(e) => e.stopPropagation()} aria-label="Close"
      className="pressable relative grid size-control-sm shrink-0 place-items-center rounded-full bg-fill-3 text-ink hover:bg-fill-4 hover:text-bright after:absolute after:-inset-1.5 after:content-['']">
      <X strokeWidth={2} className="size-icon-sm" />
    </button>
  );
  return (
    // Three columns, the outer two the same width, so the title is truly centred.
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 pb-2">
      <div className="flex justify-start">{close}</div>
      <div className="min-w-0 max-w-[60vw] text-center">
        {eyebrow && <div className="truncate text-caption text-dim">{eyebrow}</div>}
        {title && <h2 className="truncate text-headline text-bright">{title}</h2>}
      </div>
      <div className="flex justify-end" onPointerDown={(e) => e.stopPropagation()}>{action}</div>
    </div>
  );
}

// Frosted by default (reads like a surface, still shows the light behind); `glass` for clear glass.
const surfaceCls = (glass?: boolean) => glass
  ? 'glass rim !shadow-dialog'
  : 'glass glass-thick rim !shadow-dialog';

/** Space between the floating card and the screen edges. */
const GAP = 8;

function Drawer({ onClose, title, eyebrow, snaps: snapProp, children, footer, action, boxRef, target, glass, hideClose, bodyClassName }: Inner) {
  // Live: rotation, a resizing keyboard or a window resize re-cap the card.
  const vh = useSurfaceHeight(target);
  // No snaps: the card fits its content (measured), up to just under the status bar.
  const fit = !snapProp;
  const snaps = snapProp ?? SNAPS.full;
  const cap = `calc(100% - var(--safe-top) - ${GAP * 2}px)`;
  const [fitH, setFitH] = useState(vh);
  const height = fit ? fitH : Math.round(vh * snaps[snaps.length - 1]);
  const hRef = useRef(height);
  hRef.current = height;
  // Where the card is fully out of sight (below the edge, past its gap and shadow).
  const off = () => hRef.current + GAP + 40;
  const yFor = (snap: number) => (fit ? 0 : height - vh * snap);
  const y = useMotionValue(vh);
  const opened = yFor(snaps[0]);
  const dim = (v: number) => Math.min(1, Math.max(0, (off() - v) / (off() - opened || 1)));
  const backdrop = useTransform(y, dim);
  // Liquid: it grows out of the edge — a little smaller while it is down, full size once up (also while dragged).
  const grow = useTransform(y, (v) => 1 - 0.07 * Math.min(1, Math.max(0, v / (off() || 1))));
  const scrollRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLDivElement>(null);
  const [contentDrags, setContentDrags] = useState(false);
  /*
   * The sheet is as tall as its highest snap; at a lower snap its bottom part
   * sits below the edge. This inner padding keeps the footer and the end of
   * the content at the visible edge. It follows the snap, not every pixel.
   */
  const [hidden, setHidden] = useState(() => (fit ? 0 : Math.max(0, Math.round(opened))));
  const drag = useRef<{ id: number; y0: number; s0: number; v: number; ly: number; lt: number; on: boolean } | null>(null);
  const [isPresent, safeToRemove] = usePresence();

  // The running compositor transition; `halt` hands the sheet back to `y` where it stands.
  const run = useRef<{ halt: () => number } | null>(null);
  const glide = (to: number, spring: { stiffness: number; damping: number }, v0 = 0) => {
    run.current?.halt();
    y.stop();
    const pts = prefersReducedMotion() ? [y.get(), to] : springPoints(y.get(), to, spring, v0);
    const opt: KeyframeAnimationOptions = { duration: Math.max(1, (pts.length - 1) * TICK), easing: 'linear', fill: 'forwards' };
    const anims = [
      sheetRef.current?.animate(pts.map((v) => ({ transform: `translateY(${v}px)` })), opt),
      backRef.current?.animate(pts.map((v) => ({ opacity: dim(v) })), opt),
    ].filter((a): a is Animation => !!a);
    let active = true;
    const handBack = (v: number) => {
      if (!active) return v;
      active = false;
      // Inline styles first, so no frame shows the old position before `y` renders.
      for (const a of anims) { try { a.commitStyles(); } catch { /* unmounted */ } a.cancel(); }
      if (run.current === entry) run.current = null;
      y.jump(v);
      return v;
    };
    const entry = { halt: () => handBack(pointAt(pts, Number(anims[0]?.currentTime ?? 0)).x) };
    run.current = entry;
    return (anims[0]?.finished ?? Promise.resolve()).then(() => { handBack(to); }, () => {});
  };

  useLayoutEffect(() => {
    // Measure first, so the card starts just below the edge and the backdrop maps to its real height.
    if (fit && sheetRef.current) { hRef.current = sheetRef.current.offsetHeight; setFitH(hRef.current); }
    y.jump(off());
    glide(opened, OPEN);
    return () => { run.current?.halt(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A fitted card follows its content as it grows or shrinks (it is anchored at the bottom).
  useLayoutEffect(() => {
    const el = sheetRef.current;
    if (!fit || !el) return;
    const ro = new ResizeObserver(() => { hRef.current = el.offsetHeight; setFitH(el.offsetHeight); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  // Short content drags the whole sheet, long content scrolls. Re-measured whenever it changes size.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const check = () => setContentDrags(el.scrollHeight <= el.clientHeight + 2);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    for (const c of Array.from(el.children)) ro.observe(c);
    const mo = new MutationObserver(() => { for (const c of Array.from(el.children)) ro.observe(c); check(); });
    mo.observe(el, { childList: true });
    return () => { ro.disconnect(); mo.disconnect(); };
  }, []);

  /*
   * Keyboard: when it opens, the visible area shrinks. The sheet then fills
   * exactly the area above it, fully pulled up — otherwise its title and
   * first field would slide out of view at the top.
   */
  const kb = useKeyboardInset(target);
  // A focused field scrolls into the visible part of the card (only the card's own scroller moves).
  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    let t = 0;
    const onFocus = (e: FocusEvent) => {
      const f = e.target as HTMLElement;
      if (!f.matches?.('input, textarea, select, [contenteditable="true"]')) return;
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        const sc = scrollRef.current;
        if (!sc || !sc.contains(f)) return;
        const a = f.getBoundingClientRect(), b = sc.getBoundingClientRect();
        if (a.bottom > b.bottom - 12) sc.scrollBy({ top: a.bottom - b.bottom + 24, behavior: 'smooth' });
        else if (a.top < b.top + 8) sc.scrollBy({ top: a.top - b.top - 16, behavior: 'smooth' });
      }, 320);
    };
    el.addEventListener('focusin', onFocus);
    return () => { el.removeEventListener('focusin', onFocus); window.clearTimeout(t); };
  }, []);

  // A field under the sheet would otherwise keep focus and the keyboard open.
  useEffect(() => {
    const a = document.activeElement as HTMLElement | null;
    if (a && a !== document.body && !sheetRef.current?.contains(a) && a.matches('input, textarea, [contenteditable="true"]')) a.blur();
  }, []);
  useEffect(() => {
    if (!kb || !isPresent) return;
    run.current?.halt();
    setHidden(0);
    animate(y, 0, OPEN);
  }, [kb, isPresent, y]);

  // Closing: AnimatePresence waits until the sheet has slid out on the compositor.
  useEffect(() => {
    if (isPresent) return;
    let done = false;
    glide(off(), SHUT).then(() => { done = true; safeToRemove(); });
    return () => { if (!done) run.current?.halt(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPresent]);

  const down = (e: React.PointerEvent) => {
    if (e.button !== 0 || !isPresent) return;
    // Portaled sheets above this one bubble their events here too.
    if (!sheetRef.current?.contains(e.target as Node)) return;
    run.current?.halt();
    drag.current = { id: e.pointerId, y0: e.clientY, s0: y.get(), v: 0, ly: e.clientY, lt: e.timeStamp, on: false };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    // Capture only once it is a real drag, so taps on buttons inside still click.
    if (!d.on) {
      if (Math.abs(e.clientY - d.y0) < 6) return;
      d.on = true;
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    }
    const dt = Math.max(1, e.timeStamp - d.lt);
    d.v = d.v * 0.5 + ((e.clientY - d.ly) / dt) * 1000 * 0.5;
    d.ly = e.clientY; d.lt = e.timeStamp;
    const next = d.s0 + (e.clientY - d.y0);
    y.set(next < 0 ? next * 0.15 : next); // rubber band above the top snap
  };
  const up = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!d.on) return;
    if (fit) {
      if (d.v > 700 || y.get() > height * 0.35) { onClose(); return; }
      haptic('tick');
      animate(y, 0, { ...OPEN, velocity: d.v });
      return;
    }
    const shown = (height - y.get()) / vh;
    if (d.v > 700 || shown < snaps[0] * 0.55) { onClose(); return; }
    let best = snaps[0];
    for (const s of snaps) if (Math.abs(shown - s) < Math.abs(shown - best)) best = s;
    if (d.v < -500) best = snaps.find((s) => s > shown + 0.02) ?? best;
    if (d.v > 500) best = [...snaps].reverse().find((s) => s < shown - 0.02) ?? best;
    haptic('tick');
    setHidden(Math.max(0, Math.round(yFor(best))));
    animate(y, yFor(best), { ...OPEN, velocity: d.v });
  };
  const handlers = { onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerCancel: up };

  return (
    <>
      <motion.div ref={backRef} className="fixed inset-0 z-[var(--z-sheet)] bg-scrim will-change-[opacity]" style={{ opacity: backdrop }} onClick={onClose} />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn('fixed inset-x-2 z-[81] flex flex-col overflow-hidden rounded-sheet outline-none will-change-transform', surfaceCls(glass))}
        ref={(n: HTMLDivElement | null) => { sheetRef.current = n; boxRef.current = n; }}
        style={{
          y,
          scale: grow,
          transformOrigin: '50% 100%',
          bottom: `max(${GAP}px, calc(var(--safe-bottom) - 12px))`,
          ...(kb ? { bottom: kb.bottom + GAP } : {}),
          ...(fit ? { maxHeight: kb ? `min(${cap}, ${kb.h - GAP * 2}px)` : cap } : { height: kb ? Math.min(height, kb.h - GAP * 2) : height, maxHeight: cap }),
          paddingBottom: hidden,
        }}
      >
        <div className="shrink-0 cursor-grab touch-none pt-[5px] select-none active:cursor-grabbing" {...handlers}>
          {/* iOS grabber: 36 × 5. */}
          <div className="mx-auto mb-2 h-[5px] w-9 rounded-full bg-grabber" />
          <Header title={title} eyebrow={eyebrow} onClose={onClose} hideClose={hideClose} action={action} />
        </div>
        <div
          ref={scrollRef}
          className={cn('scroller page-scroll min-h-0 flex-1 px-4 pt-1', bodyClassName)}
          style={{ paddingBottom: footer ? 12 : 16, ...(contentDrags ? { touchAction: 'none' } : {}) }}
          {...(contentDrags ? handlers : {})}
        >
          {children}
        </div>
        {footer && <div className="shrink-0 px-3 pb-3">{footer}</div>}
      </motion.div>
    </>
  );
}

const PANEL_W = { sm: 'w-[340px]', md: 'w-[420px]', lg: 'w-[560px]' } as const;

/** Desktop default: floats in from the right like the sidebar island on the left. Click outside or Escape closes it. */
function SidePanel({ onClose, title, eyebrow, children, footer, action, size = 'md', boxRef, glass, hideClose, bodyClassName }: Inner) {
  return (
    <div className="fixed inset-0 z-[var(--z-sheet)]">
      {/* No dimming: the page stays readable beside the panel. The layer only catches the click that closes it. */}
      <div className="absolute inset-0" onClick={onClose} />
      <motion.div
        ref={boxRef}
        role="dialog"
        aria-label={title}
        className={cn('absolute top-2 right-2 bottom-2 flex max-w-[calc(100%-16px)] flex-col overflow-hidden rounded-dialog pt-3 outline-none', PANEL_W[size], surfaceCls(glass))}
        initial={{ opacity: 0, x: 40, scale: 0.97, filter: 'blur(8px)' }}
        animate={{ opacity: 1, x: 0, scale: 1, filter: 'blur(0px)', transitionEnd: { filter: 'none' } }}
        exit={{ opacity: 0, x: 24, filter: 'blur(4px)', transition: { duration: 0.16, ease: [0.4, 0, 1, 1] } }}
        transition={SPRING.goo}
      >
        <Header title={title} eyebrow={eyebrow} onClose={onClose} hideClose={hideClose} action={action} />
        <div className={cn('scroller min-h-0 flex-1 px-4 pt-1 pb-5', bodyClassName)}>{children}</div>
        {footer && <div className="shrink-0 px-3 pb-3">{footer}</div>}
      </motion.div>
    </div>
  );
}

const DIALOG_W = { sm: 'max-w-[380px]', md: 'max-w-[500px]', lg: 'max-w-[1000px]' } as const;

function Dialog({ onClose, title, eyebrow, children, footer, action, size = 'md', boxRef, glass, hideClose, bodyClassName }: Inner) {
  return (
    <div className="fixed inset-0 z-[var(--z-sheet)] flex items-center justify-center p-6">
      <motion.div className="absolute inset-0 bg-scrim backdrop-blur-[3px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.14 } }} onClick={onClose} />
      <motion.div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn('relative flex max-h-[86%] w-full flex-col overflow-hidden rounded-dialog pt-3 outline-none', DIALOG_W[size], surfaceCls(glass))}
        initial={{ opacity: 0, scale: 0.9, y: 14, filter: 'blur(8px)' }}
        animate={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)', transitionEnd: { filter: 'none' } }}
        exit={{ opacity: 0, scale: 0.96, y: 6, filter: 'blur(4px)', transition: { duration: 0.15 } }}
        transition={SPRING.goo}
      >
        <Header title={title} eyebrow={eyebrow} onClose={onClose} hideClose={hideClose} action={action} />
        <div className={cn('scroller min-h-0 flex-1 px-5 pt-1 pb-5', bodyClassName)}>{children}</div>
        {footer && <div className="shrink-0 px-4 pb-4">{footer}</div>}
      </motion.div>
    </div>
  );
}

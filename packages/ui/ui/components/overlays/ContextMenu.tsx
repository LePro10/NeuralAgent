/**
 * iOS-style context menu. Touch: a long-press (420ms) lifts the item above a
 * blurred, dimmed backdrop and shows its actions next to it. Mouse: right-click
 * opens a plain OS-like menu at the pointer — no dimmed screen.
 *
 * A long-press never also fires the item's tap, moving the finger more than
 * 8px cancels it (that was a scroll), and the back gesture / Escape close it.
 */
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn';
import { haptic } from '../../lib/haptics';
import { useLayer } from '../../lib/layers';
import { SPRING } from '../../lib/motion';
import { usePortalTarget } from '../../lib/surface';
import { frameOf, pointToLocal, toLocal, type Box } from './geometry';
import { menuKeys, type MenuEntry } from './Menu';
import { MENU_SURFACE, MenuItems, menuHeight } from './MenuList';

interface Props {
  items: MenuEntry[];
  children: ReactNode;
  /** The normal tap/click action of the item. */
  onTap?: () => void;
  className?: string;
  /** Shown lifted instead of a clone of the children (a richer preview). */
  preview?: ReactNode;
  /** Keep text selectable with a mouse (chat messages); touch still long-presses. */
  selectable?: boolean;
  /** Just the children, no menu (e.g. desktop shows the actions inline). */
  disabled?: boolean;
  /** Corner radius of the lifted clone (match the item). */
  radius?: number;
}

const HOLD_MS = 420;

export function ContextMenu({ items, children, onTap, className, preview, selectable, disabled, radius = 16 }: Props) {
  const target = usePortalTarget();
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<null | { rect: Box; at?: { x: number; y: number } }>(null);
  const timer = useRef(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const close = () => setOpen(null);
  useLayer(!!open, close);

  const openAt = (at?: { x: number; y: number }) => {
    if (!ref.current) return;
    fired.current = true;
    haptic('heavy');
    setOpen({ rect: toLocal(ref.current.getBoundingClientRect(), target), at: at && pointToLocal(at.x, at.y, target) });
  };

  if (disabled) return <div className={className} onClick={onTap}>{children}</div>;

  return (
    <>
      <div
        ref={ref}
        className={cn(selectable ? 'touch-noselect' : 'select-none [-webkit-touch-callout:none]', className)}
        onPointerDown={(e) => {
          fired.current = false;
          if (e.pointerType === 'mouse') return;
          start.current = { x: e.clientX, y: e.clientY };
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => openAt(), HOLD_MS);
        }}
        onPointerMove={(e) => {
          const s = start.current;
          if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 8) { window.clearTimeout(timer.current); start.current = null; }
        }}
        onPointerUp={() => { window.clearTimeout(timer.current); start.current = null; }}
        onPointerCancel={() => { window.clearTimeout(timer.current); start.current = null; }}
        onContextMenu={(e) => {
          e.preventDefault();
          if (fired.current) return;
          const touch = (e.nativeEvent as PointerEvent).pointerType === 'touch';
          openAt(touch ? undefined : { x: e.clientX, y: e.clientY });
        }}
        onClickCapture={(e) => { if (fired.current) { e.stopPropagation(); e.preventDefault(); fired.current = false; } }}
        onClick={onTap}
      >
        {children}
      </div>
      {createPortal(
        <AnimatePresence>
          {open && <Overlay key="m" state={open} items={items} onClose={close} target={target} radius={radius}>{preview ?? children}</Overlay>}
        </AnimatePresence>,
        target,
      )}
    </>
  );
}

function Overlay({ state, items, onClose, children, target, radius }: { state: { rect: Box; at?: { x: number; y: number } }; items: MenuEntry[]; onClose: () => void; children: ReactNode; target: HTMLElement; radius: number }) {
  const { rect, at } = state;
  const list = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const menu = list.current;
    const f = requestAnimationFrame(() => list.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true }));
    const gone = () => closeRef.current();
    window.addEventListener('resize', gone);
    return () => {
      cancelAnimationFrame(f);
      window.removeEventListener('resize', gone);
      const now = document.activeElement;
      if ((!now || now === document.body || menu?.contains(now)) && before?.isConnected) before.focus({ preventScroll: true });
    };
  }, []);

  const { w: vw, h: vh } = frameOf(target);
  const menuH = menuHeight(items, !at);
  const menuW = at ? 200 : 228;
  // Keep the lifted item on screen and leave room for the menu below (or above).
  const lift = Math.min(rect.height, vh * 0.4);
  let top = Math.max(60, Math.min(rect.top, vh - lift - menuH - 40));
  const below = top + lift + 10 + menuH < vh - 20;
  if (!below) top = Math.max(60, rect.top);
  const menuTop = at ? Math.min(at.y, vh - menuH - 16) : below ? top + lift + 10 : top - menuH - 10;
  const menuLeft = at ? Math.min(at.x, vw - menuW - 16) : Math.min(Math.max(16, rect.left), vw - menuW - 16);

  return (
    <div className="fixed inset-0 z-[var(--z-context)]" onContextMenu={(e) => e.preventDefault()}>
      <motion.div
        className={at ? 'absolute inset-0' : 'absolute inset-0 bg-black/35 backdrop-blur-md'}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { duration: 0.2 } }}
        exit={{ opacity: 0, transition: { duration: 0.14 } }}
        onClick={onClose}
      />
      {!at && (
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute overflow-hidden"
          style={{ left: rect.left, width: rect.width, height: lift, borderRadius: radius }}
          initial={{ top: rect.top, scale: 1 }}
          animate={{ top, scale: 1.02 }}
          exit={{ top: rect.top, scale: 1, opacity: 0, transition: { duration: 0.16 } }}
          transition={SPRING.sheet}
        >
          <div className="bg-card-2 shadow-float" style={{ borderRadius: radius }}>{children}</div>
        </motion.div>
      )}
      <motion.div
        ref={list}
        role="menu"
        onKeyDown={(e) => menuKeys(e, onClose)}
        className={cn('absolute overflow-hidden', MENU_SURFACE)}
        style={{ top: menuTop, left: menuLeft, width: menuW, transformOrigin: below || at ? 'top left' : 'bottom left' }}
        initial={{ opacity: 0, scale: at ? 0.9 : 0.7 }}
        animate={{ opacity: 1, scale: 1, transition: { scale: { ...SPRING.snap, damping: 36 }, opacity: { duration: 0.14 } } }}
        exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.14 } }}
      >
        <MenuItems items={items} touch={!at} onChoose={(e) => { onClose(); e.onSelect(); }} />
      </motion.div>
    </div>
  );
}

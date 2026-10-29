/**
 * Navigation stack inside a tab or pane (folder → subfolder → file, list →
 * detail → setting), as a "shared axis" transition: the background stays,
 * only the content travels. Pushing, the parent's content drifts left and
 * fades while the child's content slides in from the right; popping reverses
 * it. Fades are staggered, not a crossfade — the outgoing text is mostly gone
 * before the incoming one shows, so two pages never overlap legibly.
 *
 * Every level stays mounted while it is below the top, so its scroll
 * position survives a round trip. On touch, swiping right anywhere on a
 * pushed level pops it (the content follows the finger 1:1); elements with
 * their own horizontal drag opt out with `data-no-swipe`.
 *
 *   const stack = useStack();
 *   <Stack stack={stack} root={<FolderList onOpen={(f) => stack.push(f.id, <Folder f={f} />)} />} />
 *   // inside any level: const { pop } = useStackNav();
 */
import { animate, motion, useMotionValue, useTransform, type MotionValue } from 'motion/react';
import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { haptic } from '../../lib/haptics';
import { SPRING, prefersReducedMotion } from '../../lib/motion';
import { swipeState } from './SwipeRow';

export interface StackLevel { key: string; node: ReactNode }

export interface StackApi {
  levels: StackLevel[];
  push: (key: string, node: ReactNode) => void;
  pop: () => void;
  /** Back to `depth` levels (0 = root). */
  popTo: (depth: number) => void;
  reset: () => void;
}

/** State for a <Stack>. Keys identify levels (a folder id, a route). */
export function useStack(initial: StackLevel[] = []): StackApi {
  const [levels, setLevels] = useState(initial);
  const push = useCallback((key: string, node: ReactNode) => setLevels((l) => [...l, { key, node }]), []);
  const pop = useCallback(() => setLevels((l) => l.slice(0, -1)), []);
  const popTo = useCallback((d: number) => setLevels((l) => l.slice(0, Math.max(0, d))), []);
  const reset = useCallback(() => setLevels([]), []);
  return useMemo(() => ({ levels, push, pop, popTo, reset }), [levels, push, pop, popTo, reset]);
}

const StackCtx = createContext<(StackApi & { depth: number }) | null>(null);
/** The surrounding stack and the depth of the level you are in (0 = root). */
export function useStackNav() {
  const c = useContext(StackCtx);
  if (!c) throw new Error('useStackNav outside <Stack>');
  return c;
}

/** Where an entering page's content starts, and how far a covered parent drifts. */
const IN = 72;
const OUT = 44;
const clamp = (v: number) => Math.min(1, Math.max(0, v));
/** Opacity of an entering/leaving level: invisible for the first quarter of the way. */
const appear = (e: number) => (e < 0 ? clamp((1 + e - 0.25) / 0.75) : 1);

interface Entry extends StackLevel { id: string; depth: number; leaving?: boolean }
let gen = 0;

export function Stack({ stack, root, swipeBack = true, className }: { stack: StackApi; root: ReactNode; swipeBack?: boolean; className?: string }) {
  const { levels } = stack;
  const [list, setList] = useState<Entry[]>(() => levels.map((l, i) => ({ ...l, id: `${l.key}#${++gen}`, depth: i + 1 })));
  const [seen, setSeen] = useState(levels);
  if (levels !== seen) {
    setSeen(levels);
    // A level keeps its id while it (and everything under it) stays open; a fresh push gets a new one,
    // even if the same key is still sliding out — otherwise "back, then in again" revived the leaving level.
    let same = true;
    const live: Entry[] = levels.map((l, i) => {
      const old = same ? list.find((e) => !e.leaving && e.depth === i + 1) : undefined;
      same = !!old && old.key === l.key;
      return { ...l, id: same ? old!.id : `${l.key}#${++gen}`, depth: i + 1 };
    });
    const ids = new Set(live.map((e) => e.id));
    const leaving = list.filter((e) => !ids.has(e.id)).map((e) => ({ ...e, leaving: true }));
    setList([...live, ...leaving].sort((a, b) => a.depth - b.depth));
  }
  const gone = useCallback((id: string) => setList((l) => l.filter((e) => e.id !== id || !e.leaving)), []);
  const mounted = useRef(false);
  useLayoutEffect(() => { mounted.current = true; }, []);

  // Swipe-back: finger progress 0…1 across the width, shared by the top and the level under it.
  const finger = useMotionValue(0);
  const instant = useRef(false);
  const box = useRef<HTMLDivElement>(null);
  const g = useRef<{ id: number; x0: number; y0: number; lock: null | 'x' | 'y'; t: number; lx: number; v: number } | null>(null);
  const top = levels.length;

  useLayoutEffect(() => {
    // After a finger pop the page is already gone: reset in the same frame the stack shrinks.
    if (instant.current) { finger.jump(0); requestAnimationFrame(() => { instant.current = false; }); }
  }, [top, finger]);

  const down = (e: React.PointerEvent) => {
    if (!swipeBack || top === 0 || e.pointerType === 'mouse') return;
    if ((e.target as HTMLElement).closest('[data-no-swipe]')) return;
    g.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, lock: null, t: e.timeStamp, lx: e.clientX, v: 0 };
  };
  const move = (e: React.PointerEvent) => {
    const s = g.current;
    if (!s || s.id !== e.pointerId || swipeState.active) return;
    const dx = e.clientX - s.x0, dy = e.clientY - s.y0;
    if (!s.lock) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      s.lock = Math.abs(dx) > Math.abs(dy) && dx > 0 ? 'x' : 'y';
      if (s.lock === 'x') box.current?.setPointerCapture(e.pointerId);
    }
    if (s.lock !== 'x') return;
    const dt = Math.max(1, e.timeStamp - s.t);
    s.v = s.v * 0.5 + ((e.clientX - s.lx) / dt) * 1000 * 0.5;
    s.t = e.timeStamp; s.lx = e.clientX;
    finger.set(clamp(dx / (box.current?.offsetWidth || 1)));
  };
  const up = (e: React.PointerEvent) => {
    const s = g.current;
    g.current = null;
    if (!s || s.id !== e.pointerId || s.lock !== 'x') return;
    const w = box.current?.offsetWidth || 1;
    if (finger.get() > 0.35 || s.v > 500) {
      haptic('select');
      animate(finger, 1, { ...SPRING.sheet, velocity: s.v / w }).then(() => { instant.current = true; stack.pop(); });
    } else animate(finger, 0, SPRING.sheet);
  };

  return (
    <div ref={box} className={className ?? 'relative h-full overflow-clip'}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <StackCtx.Provider value={{ ...stack, depth: 0 }}>
        <Level depth={0} top={top} finger={finger} instant={instant}>{root}</Level>
      </StackCtx.Provider>
      {list.map((e) => (
        <StackCtx.Provider key={e.id} value={{ ...stack, depth: e.depth }}>
          <Level depth={e.depth} top={top} enter={mounted.current} leaving={e.leaving} onGone={() => gone(e.id)} finger={finger} instant={instant}>
            {e.node}
          </Level>
        </StackCtx.Provider>
      ))}
    </div>
  );
}

function Level({ depth, top, enter, leaving, onGone, finger, instant, children }: {
  depth: number; top: number; enter?: boolean; leaving?: boolean; onGone?: () => void;
  finger: MotionValue<number>; instant: React.RefObject<boolean>; children: ReactNode;
}) {
  const isTop = depth === top && !leaving;
  const isUnder = depth === top - 1;
  const role = useRef<'top' | 'under' | 'other'>('other');
  role.current = isTop ? 'top' : isUnder ? 'under' : 'other';
  // -1 = off to the right (entering / popped), 0 = on top, 1 = covered.
  const s = useMotionValue(enter ? -1 : isTop ? 0 : 1);
  const w = useRef(390);
  const el = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { w.current = el.current?.offsetWidth || 390; });

  const fade = () => (role.current === 'top' || role.current === 'under' ? s.get() - finger.get() : s.get());
  const layer = useTransform(() => (role.current === 'top' ? appear(s.get()) * (1 - 0.85 * finger.get()) : appear(fade())));
  const o = useTransform(() => { const f = fade(); return f > 0 ? clamp(1 - f * 1.6) : 1; });
  const x = useTransform(() => {
    const pos = role.current === 'top' ? s.get() : fade();
    const t = pos < 0 ? -pos * IN : -pos * OUT;
    return t + (role.current === 'top' ? finger.get() * w.current : 0);
  });

  useLayoutEffect(() => {
    const to = leaving ? -1 : isTop ? 0 : 1;
    if (instant.current || prefersReducedMotion()) {
      s.jump(to);
      if (leaving) onGone?.();
      return;
    }
    if (s.get() === to && !s.isAnimating()) { if (leaving) onGone?.(); return; }
    let live = true;
    animate(s, to, SPRING.sheet).then(() => { if (live && leaving) onGone?.(); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving, isTop, isUnder]);

  return (
    <motion.div
      ref={el}
      className="absolute inset-0 bg-bg"
      style={{ zIndex: depth, opacity: layer, visibility: isTop || isUnder || leaving ? 'visible' : 'hidden' }}
      inert={!isTop}
    >
      <motion.div className="h-full" style={{ x, opacity: o }}>{children}</motion.div>
    </motion.div>
  );
}

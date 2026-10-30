/**
 * Phone navigation: where "back" goes, and how pages move.
 *
 * The app owns the routes (one `selected` id); the shell only needs to know,
 * per page, its depth in the tab's stack and where back leads. Wrap the page
 * in <NavPage> and:
 *   - a deeper page pushes in from the right, a shallower one pops back,
 *     siblings (another tab) cross-fade — iOS's three moves;
 *   - pages with `back` get the back button in their nav bar (Page reads
 *     useNavBack()) and an edge swipe from the left that pops them.
 * Desktop: no back context is published, so pages show no back button; the
 * transition is a short fade.
 */
import { animate, AnimatePresence, motion, useMotionValue, useTransform, type Variants } from 'motion/react';
import { createContext, useContext, useRef, type ReactNode } from 'react';
import { haptic } from './haptics';
import { prefersReducedMotion, SPRING } from './motion';
import { useLayoutMode } from './surface';

export interface NavBack {
  /** The previous level's title, shown next to the chevron. */
  label: string;
  onBack: () => void;
}

const BackCtx = createContext<NavBack | null>(null);
export const NavBackProvider = BackCtx.Provider;
/** Back target of the current page on phones (null at a tab's root or on desktop). */
export function useNavBack(): NavBack | null {
  const back = useContext(BackCtx);
  return useLayoutMode() === 'phone' ? back : null;
}

type Dir = 'push' | 'pop' | 'fade';
const variants: Variants = {
  enter: (d: Dir) => (d === 'push' ? { x: '100%', opacity: 1 } : d === 'pop' ? { x: '-28%', opacity: 1 } : { x: 0, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (d: Dir) => (d === 'push' ? { x: '-28%', opacity: 1 } : d === 'pop' ? { x: '100%', opacity: 1 } : { x: 0, opacity: 0 }),
};

/** iOS push: ~0.5s critically damped, no bounce. */
export const PUSH = { type: 'spring', stiffness: 260, damping: 34, mass: 1 } as const;

/**
 * One page of the app, keyed by `id`. `depth` is its level in the current
 * tab (0 = tab root); `back` makes it poppable. Children fill the frame.
 */
export function NavPage({ id, depth, back, children }: { id: string; depth: number; back?: NavBack | null; children: ReactNode }) {
  const mode = useLayoutMode();
  const prev = useRef({ id, depth });
  let dir: Dir = 'fade';
  if (prev.current.id !== id) {
    dir = mode === 'phone' && depth > prev.current.depth ? 'push' : mode === 'phone' && depth < prev.current.depth ? 'pop' : 'fade';
  }
  const dirRef = useRef<Dir>(dir);
  if (prev.current.id !== id) { dirRef.current = dir; prev.current = { id, depth }; }
  const d = prefersReducedMotion() ? 'fade' : dirRef.current;
  const transition = d === 'fade' ? { duration: mode === 'phone' ? 0.22 : 0.16, ease: [0.25, 0.1, 0.25, 1] as const } : PUSH;

  return (
    <div className="relative h-full overflow-hidden">
      <AnimatePresence initial={false} custom={d}>
        <motion.div
          key={id}
          custom={d}
          variants={variants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={transition}
          className="absolute inset-0 bg-bg"
          // The page being covered dims a little, like iOS's parallax shadow.
          style={{ zIndex: d === 'pop' ? 0 : 1 }}
        >
          <NavBackProvider value={back ?? null}>
            {mode === 'phone' && back ? <SwipeBack onBack={back.onBack}>{children}</SwipeBack> : children}
          </NavBackProvider>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/** Edge swipe from the left pops the page; the page follows the finger. */
function SwipeBack({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  const x = useMotionValue(0);
  const shade = useTransform(x, [0, 400], [0, 0.18]);
  const g = useRef<{ id: number; x0: number; y0: number; w: number; on: boolean; t: number; lx: number } | null>(null);
  return (
    <motion.div className="relative h-full" style={{ x }}>
      <motion.div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-full w-6 bg-scrim" style={{ opacity: shade }} />
      {children}
      <div
        aria-hidden="true"
        className="absolute inset-y-0 left-0 z-[60] w-4 touch-none"
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse') return;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          g.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, w: (e.currentTarget.parentElement?.clientWidth ?? 390), on: false, t: e.timeStamp, lx: e.clientX };
        }}
        onPointerMove={(e) => {
          const s = g.current;
          if (!s || s.id !== e.pointerId) return;
          const dx = e.clientX - s.x0, dy = e.clientY - s.y0;
          if (!s.on) {
            if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { g.current = null; return; }
            if (dx < 8) return;
            s.on = true;
          }
          s.t = e.timeStamp; s.lx = e.clientX;
          x.set(Math.max(0, dx));
        }}
        onPointerUp={(e) => {
          const s = g.current;
          g.current = null;
          if (!s || !s.on) return;
          const v = (e.clientX - s.lx) / Math.max(1, e.timeStamp - s.t); // px/ms
          if (x.get() > s.w * 0.35 || v > 0.5) {
            haptic('select');
            animate(x, s.w, { ...SPRING.snap, velocity: v * 1000 }).then(onBack);
          } else animate(x, 0, SPRING.snap);
        }}
        onPointerCancel={() => { g.current = null; animate(x, 0, SPRING.snap); }}
      />
    </motion.div>
  );
}

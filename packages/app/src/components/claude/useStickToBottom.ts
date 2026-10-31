/**
 * The transcript's scroll model (A3 §2.3): follow new output only while the reader is at the
 * end, never yank when they scrolled up, keep the first visible entry still when older history
 * is added on top. Decisions live in `StickModel`; this hook wires it to the DOM.
 *
 * The caller renders `scrollerRef` on the scrolling element, `contentRef` on its content and
 * `sentinelRef` on an empty element at the very top of the content; entries carry
 * `data-entry="<key>"` so the prepend anchor can find them again.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { firstVisible, StickModel } from "./stickModel";

export interface StickView {
  pinned: boolean;
  unseen: number;
  direction: "up" | "down" | null;
}

export interface StickOptions {
  /** Number of entries (user messages, turns, notices): growth while unpinned counts as "new". */
  count: number;
  /** Key of the first entry: when it changes, older history was added on top. */
  firstKey: string | null;
  /** Another conversation: start pinned at its end. */
  resetKey: string;
  /** Older messages exist. */
  more: boolean;
  loadingOlder: boolean;
  onNearTop: () => void;
}

const now = () => performance.now();

export function useStickToBottom(o: StickOptions) {
  const model = useRef(new StickModel()).current;
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);
  const [view, setView] = useState<StickView>({ pinned: true, unseen: 0, direction: null });
  const elRef = useRef<HTMLDivElement | null>(null);
  elRef.current = el;
  const contentEl = useRef<HTMLDivElement | null>(null);
  contentEl.current = content;
  const onNearTop = useRef(o.onNearTop);
  onNearTop.current = o.onNearTop;
  const loading = useRef(o.loadingOlder);
  loading.current = o.loadingOlder;
  /** The entry at the top edge and its offset from the scroller's top, while older history loads. */
  const anchor = useRef<{ key: string; off: number } | null>(null);

  const sync = useCallback(() => {
    setView((v) => (v.pinned === model.pinned && v.unseen === model.unseen && v.direction === model.direction ? v : { pinned: model.pinned, unseen: model.unseen, direction: model.direction }));
  }, [model]);

  const follow = useCallback(() => {
    const s = elRef.current;
    if (!s || !model.shouldFollow()) return;
    const end = s.scrollHeight - s.clientHeight;
    if (Math.abs(s.scrollTop - end) > 0.5) {
      model.programmatic(now());
      s.scrollTop = s.scrollHeight;
    }
  }, [model]);

  const capture = useCallback(() => {
    const s = elRef.current;
    const c = contentEl.current;
    if (!s || !c) return;
    const items = c.querySelectorAll<HTMLElement>("[data-entry]");
    const top = s.getBoundingClientRect().top;
    const i = firstVisible(items.length, (j) => {
      const r = items[j]!.getBoundingClientRect();
      return { top: r.top - top, height: r.height };
    }, 0);
    const it = i >= 0 ? items[i] : null;
    anchor.current = it ? { key: it.dataset.entry!, off: it.getBoundingClientRect().top - top } : null;
  }, []);

  // DOM listeners: user intent, scrolling, release.
  useEffect(() => {
    if (!el) return;
    let touchY = 0;
    let frame = 0;
    let byPointer = false;
    const onScroll = () => {
      model.scroll({ top: el.scrollTop, height: el.scrollHeight, client: el.clientHeight }, now());
      if (loading.current && !model.pinned && !frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          capture();
        });
      }
      sync();
    };
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY) model.intent(now(), e.deltaY < 0);
      sync();
    };
    const onTouchStart = (e: TouchEvent) => {
      touchY = e.touches[0]?.clientY ?? 0;
      model.hold(now());
    };
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY ?? touchY;
      // Finger moving down = content moves down = towards older messages.
      if (Math.abs(y - touchY) > 2) {
        model.intent(now(), y > touchY);
        model.hold(now());
        touchY = y;
        sync();
      }
    };
    const release = () => {
      if (model.release(now())) requestAnimationFrame(follow);
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length === 0) release();
    };
    const onKey = (e: KeyboardEvent) => {
      if (/^(ArrowUp|PageUp|Home)$/.test(e.key)) model.intent(now(), true);
      else if (/^(ArrowDown|PageDown|End| )$/.test(e.key)) model.intent(now(), false);
      sync();
    };
    // A press on the scroller itself (not its content) is the scrollbar.
    const onPointerDown = (e: PointerEvent) => {
      if (e.target === el && e.pointerType === "mouse") {
        byPointer = true;
        model.hold(now());
      }
    };
    const onPointerUp = () => {
      if (!byPointer) return;
      byPointer = false;
      release();
    };
    const onScrollEnd = () => model.settled();
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    // On window (capture): the touched node may be replaced mid-gesture and never see the end.
    window.addEventListener("touchend", onTouchEnd, { passive: true, capture: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true, capture: true });
    el.addEventListener("keydown", onKey);
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("scrollend", onScrollEnd);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd, { capture: true });
      window.removeEventListener("touchcancel", onTouchEnd, { capture: true });
      el.removeEventListener("keydown", onKey);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("scrollend", onScrollEnd);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [el, model, sync, follow, capture]);

  // Follow growth of the content (images, folds, the activity line) and of the viewport
  // (keyboard, composer height).
  useEffect(() => {
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      follow();
      // Content that stops overflowing fires no scroll event: re-evaluate "at the end".
      model.scroll({ top: el.scrollTop, height: el.scrollHeight, client: el.clientHeight }, now());
      sync();
    });
    ro.observe(el);
    if (content) ro.observe(content);
    return () => ro.disconnect();
  }, [el, content, model, follow, sync]);

  // Older history: ask for it when the top comes near (also when the first page is short).
  useEffect(() => {
    if (!el || !sentinel || !o.more || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && onNearTop.current(), { root: el, rootMargin: "100% 0px 0px 0px" });
    io.observe(sentinel);
    return () => io.disconnect();
  }, [el, sentinel, o.more, o.firstKey, o.loadingOlder]);

  // Loading starts: remember what the reader looks at.
  useLayoutEffect(() => {
    if (o.loadingOlder && !model.pinned) capture();
  }, [o.loadingOlder, model, capture]);

  // Another conversation: pinned at its end.
  useLayoutEffect(() => {
    model.reset();
    anchor.current = null;
    sync();
  }, [o.resetKey, model, sync]);

  // Entries changed: keep the anchor after a prepend, count new ones, follow.
  const prev = useRef<{ count: number; first: string | null; reset: string }>({ count: 0, first: null, reset: o.resetKey });
  useLayoutEffect(() => {
    const p = prev.current;
    const s = elRef.current;
    const prepended = p.reset === o.resetKey && p.first !== null && o.firstKey !== p.first;
    if (prepended && s && anchor.current && !model.pinned) {
      const a = anchor.current;
      const it = s.querySelector<HTMLElement>(`[data-entry="${CSS.escape(a.key)}"]`);
      if (it) {
        const off = it.getBoundingClientRect().top - s.getBoundingClientRect().top;
        if (Math.abs(off - a.off) > 0.5) {
          model.programmatic(now());
          s.scrollTop += off - a.off;
        }
      }
      anchor.current = null;
    } else if (p.reset === o.resetKey && !prepended && o.count > p.count && p.count > 0) {
      model.appended(o.count - p.count);
    }
    prev.current = { count: o.count, first: o.firstKey, reset: o.resetKey };
    follow();
    sync();
  }, [o.count, o.firstKey, o.resetKey, model, follow, sync]);

  const toBottom = useCallback(
    (opts: { smooth?: boolean } = {}) => {
      const s = elRef.current;
      model.pin();
      sync();
      if (!s) return;
      const smooth = !!opts.smooth && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      model.programmatic(now(), smooth);
      s.scrollTo({ top: s.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    },
    [model, sync],
  );

  return { scrollerRef: setEl, contentRef: setContent, sentinelRef: setSentinel, ...view, toBottom, follow };
}

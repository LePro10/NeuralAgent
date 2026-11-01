// One live frame of the demo: a poster that shows instantly, an iframe that joins the shared world behind it, and a
// cross-fade when the app has its first state. The iframe has a fixed internal size (the app needs a real desktop or
// phone viewport) and is scaled with a transform to the box its parent gives it.
//
// The frame is inert until the visitor arms it (a mouse rests on it, a tap, or the "Type in the app" button). An inert
// iframe cannot take the keyboard: the app's terminal focuses itself a second after it loads, and without this Tab and
// Space would stop reaching the page (WCAG 2.1.2).
//
// The poster stays until the app's own launch screen has left, so the cross-fade never shows the splash.
//
// Scroll guard. The demo page sets `overscroll-behavior: none`, so a wheel turned over a live frame would trap the
// page. Rules: the iframe ignores the pointer until a mouse rests on it (touch always scrolls the page); a wheel over a
// frame the visitor has not clicked into goes to the PAGE; after a click the app owns the wheel where it can scroll
// something, and the page gets the rest. Escape or leaving the frame hands the page back.
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { DemoFrame, DemoView } from "../../demo/api";
import { waitForFrame } from "./world";
import "./stage.css";

export interface LiveFrameHandle {
  /** The frame's control surface, once the app is ready. */
  frame: () => DemoFrame | null;
  /** Hand pointer and keyboard to the app (keyboard users: the "Use it here" button). */
  engage: () => void;
}

interface Props {
  view: DemoView;
  /** Internal viewport of the app, CSS px. */
  iw: number;
  ih: number;
  /** iframe URL; null = not loaded yet (only the poster shows). */
  src: string | null;
  poster: string;
  posterAlt: string;
  title: string;
  /** Called once per load when the app has its first state. */
  onReady?: (frame: DemoFrame) => void;
  /** The visitor pressed or typed inside the app. */
  onInteract?: () => void;
  /** Escape was pressed inside the app: the page has the keyboard back. */
  onExit?: () => void;
  className?: string;
  eager?: boolean;
}

/** Resolves when the app's own launch layer has left the frame (or after `timeout`): only then the poster may fade out. */
function launchGone(doc: Document | null | undefined, timeout = 3200): Promise<void> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const tick = () => {
      let gone = true;
      try {
        const el = doc?.getElementById("na-launch");
        gone = !el || el.dataset.phase === "gone";
      } catch {
        gone = true;
      }
      if (gone || performance.now() - t0 > timeout) return resolve();
      setTimeout(tick, 60);
    };
    tick();
  });
}

/** Can `el` (or an ancestor up to the document) scroll in the direction of the wheel? */
function canScroll(el: Element | null, dx: number, dy: number): boolean {
  for (let n: Element | null = el; n; n = n.parentElement) {
    const cs = n.ownerDocument.defaultView?.getComputedStyle(n);
    if (!cs) return false;
    if (dy && /(auto|scroll)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 1) {
      if ((dy > 0 && n.scrollTop + n.clientHeight < n.scrollHeight - 1) || (dy < 0 && n.scrollTop > 0)) return true;
    }
    if (dx && /(auto|scroll)/.test(cs.overflowX) && n.scrollWidth > n.clientWidth + 1) {
      if ((dx > 0 && n.scrollLeft + n.clientWidth < n.scrollWidth - 1) || (dx < 0 && n.scrollLeft > 0)) return true;
    }
  }
  return false;
}

export const LiveFrame = forwardRef<LiveFrameHandle, Props>(function LiveFrame({ view, iw, ih, src, poster, posterAlt, title, onReady, onInteract, onExit, className, eager }, ref) {
  const box = useRef<HTMLDivElement>(null);
  const el = useRef<HTMLIFrameElement>(null);
  const frameRef = useRef<DemoFrame | null>(null);
  const [live, setLive] = useState(false);
  const [posterOk, setPosterOk] = useState(true);
  const [armed, setArmed] = useState(false);
  const engaged = useRef(false);
  const lastWheel = useRef(0);
  const cb = useRef({ onReady, onInteract, onExit });
  cb.current = { onReady, onInteract, onExit };

  const release = () => {
    engaged.current = false;
    setArmed(false);
  };

  useImperativeHandle(ref, () => ({
    frame: () => frameRef.current,
    engage: () => {
      engaged.current = true;
      setArmed(true);
      const f = el.current;
      if (!f) return;
      f.inert = false;
      f.tabIndex = 0;
      requestAnimationFrame(() => {
        try {
          f.focus();
          f.contentWindow?.focus();
        } catch {
          /* nothing to focus */
        }
      });
    },
  }));

  // Scale the fixed-size iframe to its box: one custom property, no React state.
  useLayoutEffect(() => {
    const b = box.current;
    if (!b) return;
    const apply = () => b.style.setProperty("--k", String(b.clientWidth / iw));
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(b);
    return () => ro.disconnect();
  }, [iw]);

  useEffect(() => setPosterOk(true), [poster]);

  // A new src (or none) means a fresh load.
  useEffect(() => {
    setLive(false);
    frameRef.current = null;
    release();
  }, [src]);

  const hook = () => {
    const doc = el.current?.contentDocument;
    if (!doc) return;
    doc.addEventListener(
      "pointerdown",
      () => {
        engaged.current = true;
        cb.current.onInteract?.();
      },
      true,
    );
    doc.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape") {
          release();
          const f = el.current;
          if (f) f.tabIndex = -1;
          try {
            (doc.activeElement as HTMLElement | null)?.blur?.();
          } catch {
            /* ignore */
          }
          cb.current.onExit?.();
          return;
        }
        cb.current.onInteract?.();
      },
      true,
    );
    doc.addEventListener(
      "wheel",
      (e) => {
        const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1;
        const dx = e.deltaX * unit;
        const dy = e.deltaY * unit;
        if (e.ctrlKey) return; // pinch zoom
        if (engaged.current && canScroll(e.target as Element, dx, dy)) return; // the app scrolls something under the pointer
        e.preventDefault();
        lastWheel.current = performance.now();
        window.scrollBy({ left: dx, top: dy, behavior: "instant" });
        if (!engaged.current) setArmed(false); // the rest of this gesture scrolls the page natively
      },
      { passive: false, capture: true },
    );
    doc.addEventListener("mouseout", (e) => {
      if (e.relatedTarget === null) release();
    });
  };

  const onLoad = () => {
    const f = el.current;
    if (!f || !src) return;
    void waitForFrame(f).then((frame) => {
      if (!frame || el.current !== f) return;
      frameRef.current = frame;
      hook();
      void frame.ready
        .then(() => launchGone(f.contentDocument))
        .then(
          () =>
            new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))), // one painted frame of the app itself
        )
        .then(() => {
          if (el.current !== f) return;
          setLive(true);
          cb.current.onReady?.(frame);
        });
    });
  };

  const style = { "--iw": `${iw}px`, "--ih": `${ih}px`, aspectRatio: `${iw} / ${ih}` } as CSSProperties;
  return (
    <div
      ref={box}
      className={`lf${className ? ` ${className}` : ""}`}
      data-view={view}
      data-state={live ? "live" : src ? "loading" : "poster"}
      data-armed={armed ? "" : undefined}
      style={style}
      onPointerMove={(e) => {
        if (!armed && e.pointerType === "mouse" && performance.now() - lastWheel.current > 450) setArmed(true);
      }}
      onPointerDown={(e) => {
        if (e.pointerType !== "mouse" && !armed) setArmed(true); // touch laptops: the first tap arms, the next ones use the app
      }}
      onPointerLeave={release}
    >
      <div className="lf__poster" aria-hidden={live ? true : undefined}>
        {posterOk ? (
          <img src={poster} alt={live ? "" : posterAlt} width={view === "desk" ? 1280 : 390} height={view === "desk" ? 800 : 844} decoding="async" loading={eager ? "eager" : "lazy"} fetchPriority={eager ? "high" : "auto"} onError={() => setPosterOk(false)} draggable={false} />
        ) : (
          <div className="lf__blank" role="img" aria-label={posterAlt} />
        )}
      </div>
      {src && <iframe ref={el} className="lf__frame" title={title} src={src} onLoad={onLoad} allow="clipboard-write" tabIndex={-1} inert={!armed} />}
    </div>
  );
});

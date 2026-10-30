/**
 * Pictures in the conversation, like Claude Code desktop shows them: a rounded thumbnail under
 * a tool call (`Read` of an image, MCP screenshots) or above a user message, loaded when it
 * scrolls near the screen, with a skeleton while it loads and Retry when it fails. Tapping opens
 * a full-screen viewer: pinch / wheel zoom, drag to pan, swipe down (phone) or Esc to close,
 * Copy and Save. The viewer is a deliberate custom overlay (like the Picker): no ui component
 * covers a zoomable photo viewer.
 */
import type { CvImage, CvImageData } from "@neuralagent/protocol";
import { cn, useLayoutMode } from "@neuralagent/ui";
import { Check, ChevronLeft, ChevronRight, Copy, Download, ImageOff, Image as ImageIcon, RotateCw, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { edgeFor, fitBox, fromData, ImageCache, kb, type Loaded, saveName } from "../../lib/cvImages";
import { useClient, usePlatform } from "../../lib/store";

/** The session the pictures belong to (they are fetched from its transcript). */
export const ImageSidContext = createContext("");

export interface Pic {
  img: CvImage;
  /** A path or name shown under the picture and used to save it. */
  caption?: string;
}

const cache = new ImageCache();

type State = { s: "idle" | "loading" } | { s: "ok"; l: Loaded } | { s: "error"; msg: string };

function useImage(img: CvImage | undefined, active: boolean) {
  const client = useClient();
  const sid = useContext(ImageSidContext);
  const kind = usePlatform().kind;
  const [state, setState] = useState<State>({ s: "idle" });
  const [attempt, setAttempt] = useState(0);
  const id = img?.id;
  useEffect(() => {
    if (!id || !active || !sid) return;
    let live = true;
    const max = edgeFor(kind);
    setState((st) => (st.s === "ok" ? st : { s: "loading" }));
    cache
      .get(`${sid}|${id}|${max ?? 0}`, () => client.req<CvImageData>({ m: "cv_image", p: max ? { sid, id, max } : { sid, id } }).then(fromData))
      .then(
        (l) => live && setState({ s: "ok", l }),
        (e: unknown) => live && setState({ s: "error", msg: (e as Error)?.message || "Could not load the image." }),
      );
    return () => {
      live = false;
    };
  }, [client, sid, kind, id, active, attempt]);
  return { state, retry: useCallback(() => setAttempt((a) => a + 1), []) };
}

/** True once the element came near the screen (and stays true). */
function useNear<T extends Element>() {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    if (typeof IntersectionObserver === "undefined") return setNear(true);
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setNear(true), { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  return [ref, near] as const;
}

const fileOf = (p?: string) => p?.split(/[\\/]/).pop() || "";

type Size = "lg" | "sm" | "tile";

/** One picture as a thumbnail; `onOpen` opens the viewer. */
export function Thumb({ pic, size, onOpen }: { pic: Pic; size: Size; onOpen: () => void }) {
  const phone = useLayoutMode() === "phone";
  const [ref, near] = useNear<HTMLDivElement>();
  const { state, retry } = useImage(pic.img, near);
  const { img } = pic;
  const known = !!(img.w && img.h);
  const box = size === "lg" ? fitBox(img, phone ? 1200 : 560, phone ? 420 : 240) : size === "sm" ? fitBox(img, 160, 64) : fitBox(img, 200, 120);
  const style: CSSProperties =
    size === "lg"
      ? { width: phone ? `min(100%, ${box.w}px)` : box.w, maxWidth: "100%", aspectRatio: `${box.w} / ${box.h}` }
      : size === "tile"
        ? { width: Math.max(72, box.w), height: 120, maxWidth: "100%" }
        : { width: Math.max(48, box.w), height: 64 };
  const label = fileOf(pic.caption) || "Image";
  return (
    <div ref={ref} style={style} className={cn("relative shrink-0 overflow-hidden border border-cv-line-soft bg-cv-sunken", size === "sm" ? "rounded-cv-sm" : "rounded-cv-md")}>
      {state.s === "ok" ? (
        <button type="button" onClick={onOpen} aria-label={`Open ${label}`} className="block size-full cursor-zoom-in transition-opacity hover:opacity-90">
          <img src={state.l.url} alt={label} draggable={false} className={cn("size-full", known || size !== "lg" ? "object-cover" : "object-contain")} />
        </button>
      ) : state.s === "error" ? (
        <div className="flex size-full flex-col items-center justify-center gap-1.5 p-2 text-center font-cv-sans text-cv-meta text-cv-muted">
          {size !== "sm" && <ImageOff size={18} strokeWidth={1.6} />}
          {size === "lg" && <span className="line-clamp-2 max-w-full px-2">{state.msg}</span>}
          <button type="button" onClick={retry} className="inline-flex min-h-8 items-center gap-1.5 rounded-cv-sm px-2.5 text-cv-text-2 transition-colors hover:bg-cv-hover [[data-mode=phone]_&]:min-h-10" aria-label="Retry loading the image">
            <RotateCw size={13} strokeWidth={1.8} />
            {size !== "sm" && "Retry"}
          </button>
        </div>
      ) : (
        <div className="size-full animate-pulse bg-cv-chip" aria-label="Loading image" role="img" />
      )}
    </div>
  );
}

/** A picture whose bytes the client cannot get (an older service, or not in the transcript). */
export function NoImage({ className }: { className?: string }) {
  return (
    <div className={cn("grid size-14 place-items-center rounded-cv-md border border-cv-line-soft bg-cv-surface text-cv-muted", className)} title="Image">
      <ImageIcon size={20} strokeWidth={1.6} />
    </div>
  );
}

/** Thumbnails in a row (wrapping), with the viewer for them. `lg` adds the name and size. */
export function Pictures({ pics, size, className }: { pics: Pic[]; size: Size; className?: string }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!pics.length) return null;
  return (
    <>
      <div className={cn("flex flex-wrap gap-2", className)}>
        {pics.map((p, i) =>
          size === "lg" ? (
            <figure key={p.img.id} className="flex max-w-full min-w-0 flex-col gap-1">
              <Thumb pic={p} size="lg" onOpen={() => setOpen(i)} />
              <figcaption className="flex min-w-0 gap-1.5 px-0.5 font-cv-sans text-cv-meta text-cv-muted">
                {p.caption && <span className="min-w-0 truncate font-cv-mono">{fileOf(p.caption)}</span>}
                <span className="shrink-0 tabular-nums">{[p.img.w && p.img.h ? `${p.img.w}×${p.img.h}` : "", kb(p.img.bytes)].filter(Boolean).join(" · ")}</span>
              </figcaption>
            </figure>
          ) : (
            <Thumb key={p.img.id} pic={p} size={size} onOpen={() => setOpen(i)} />
          ),
        )}
      </div>
      {open !== null && <Viewer pics={pics} start={open} onClose={() => setOpen(null)} />}
    </>
  );
}

// ───────────── the viewer ─────────────

const MAX_ZOOM = 6;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

async function toPng(l: Loaded): Promise<Blob> {
  if (l.type === "image/png") return l.blob;
  const bmp = await createImageBitmap(l.blob);
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext("2d")!.drawImage(bmp, 0, 0);
  bmp.close?.();
  const b = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
  if (!b) throw new Error("png");
  return b;
}

const canCopy = () => typeof ClipboardItem !== "undefined" && !!navigator.clipboard?.write;

function Viewer({ pics, start, onClose }: { pics: Pic[]; start: number; onClose: () => void }) {
  const phone = useLayoutMode() === "phone";
  const kind = usePlatform().kind;
  const [i, setI] = useState(start);
  const pic = pics[i]!;
  const { state, retry } = useImage(pic.img, true);
  const [t, setT] = useState({ z: 1, x: 0, y: 0 });
  const [drop, setDrop] = useState(0);
  const [live, setLive] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const picEl = useRef<HTMLImageElement>(null);
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const g = useRef<{ d0: number; z0: number; m0x: number; m0y: number; x0: number; y0: number; sx: number; sy: number; moved: boolean; pinch: boolean; touch: boolean } | null>(null);
  const lastTap = useRef<{ at: number; x: number; y: number } | null>(null);
  const tRef = useRef(t);
  tRef.current = t;

  const go = useCallback(
    (d: number) => {
      setI((n) => clamp(n + d, 0, pics.length - 1));
      setT({ z: 1, x: 0, y: 0 });
    },
    [pics.length],
  );

  useEffect(() => {
    closeBtn.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") (e.stopPropagation(), onClose());
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onClose, go]);

  // Centre-relative position of a pointer on the stage.
  const rel = (cx: number, cy: number) => {
    const r = stage.current!.getBoundingClientRect();
    return { x: cx - r.left - r.width / 2, y: cy - r.top - r.height / 2 };
  };
  /** Zoom to `z1`, keeping the picture point under `p` where it is. */
  const zoomAt = (z1: number, p: { x: number; y: number }, from = tRef.current) => {
    const z = clamp(z1, 1, MAX_ZOOM);
    if (z === 1) return { z: 1, x: 0, y: 0 };
    const ux = (p.x - from.x) / from.z;
    const uy = (p.y - from.y) / from.z;
    return { z, x: p.x - z * ux, y: p.y - z * uy };
  };

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = rel(e.clientX, e.clientY);
      setT((cur) => zoomAt(cur.z * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0012)), p, cur));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);

  const down = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setLive(true);
    const ps = [...pts.current.values()];
    const cur = tRef.current;
    if (ps.length >= 2) {
      const [a, b] = ps as [{ x: number; y: number }, { x: number; y: number }];
      const m = rel((a.x + b.x) / 2, (a.y + b.y) / 2);
      g.current = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: cur.z, m0x: m.x, m0y: m.y, x0: cur.x, y0: cur.y, sx: 0, sy: 0, moved: true, pinch: true, touch: true };
      setDrop(0);
    } else {
      g.current = { d0: 1, z0: cur.z, m0x: 0, m0y: 0, x0: cur.x, y0: cur.y, sx: e.clientX, sy: e.clientY, moved: false, pinch: false, touch: e.pointerType !== "mouse" };
    }
  };
  const move = (e: React.PointerEvent) => {
    if (!pts.current.has(e.pointerId) || !g.current) return;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const s = g.current;
    const ps = [...pts.current.values()];
    if (s.pinch && ps.length >= 2) {
      const [a, b] = ps as [{ x: number; y: number }, { x: number; y: number }];
      const m = rel((a.x + b.x) / 2, (a.y + b.y) / 2);
      const z = clamp((s.z0 * Math.hypot(a.x - b.x, a.y - b.y)) / s.d0, 1, MAX_ZOOM);
      const ux = (s.m0x - s.x0) / s.z0;
      const uy = (s.m0y - s.y0) / s.z0;
      setT(z === 1 ? { z: 1, x: 0, y: 0 } : { z, x: m.x - z * ux, y: m.y - z * uy });
      return;
    }
    const dx = e.clientX - s.sx;
    const dy = e.clientY - s.sy;
    if (Math.hypot(dx, dy) > 6) s.moved = true;
    if (!s.moved) return;
    if (tRef.current.z > 1) setT((cur) => ({ ...cur, x: s.x0 + dx, y: s.y0 + dy }));
    else if (s.touch && !s.pinch) setDrop(Math.max(0, dy));
  };
  const up = (e: React.PointerEvent) => {
    if (!pts.current.delete(e.pointerId)) return;
    const s = g.current;
    if (pts.current.size > 0) {
      // One finger left after a pinch: go on panning from here.
      const [p] = [...pts.current.values()] as [{ x: number; y: number }];
      const cur = tRef.current;
      g.current = { d0: 1, z0: cur.z, m0x: 0, m0y: 0, x0: cur.x, y0: cur.y, sx: p.x, sy: p.y, moved: true, pinch: false, touch: true };
      return;
    }
    g.current = null;
    setLive(false);
    if (drop > 110) return onClose();
    setDrop(0);
    if (!s || s.moved || s.pinch) return;
    // A tap: double tap / double click zooms; a single click beside the picture closes (desktop).
    const now = Date.now();
    const last = lastTap.current;
    if (last && now - last.at < 320 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 30) {
      lastTap.current = null;
      setT((cur) => (cur.z > 1 ? { z: 1, x: 0, y: 0 } : zoomAt(2.5, rel(e.clientX, e.clientY), cur)));
      return;
    }
    lastTap.current = { at: now, x: e.clientX, y: e.clientY };
    const r = picEl.current?.getBoundingClientRect();
    const onPic = r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!s.touch && !onPic) onClose();
  };

  const flash = (what: string) => {
    setDone(what);
    setTimeout(() => setDone(null), 1400);
  };
  const copy = () => {
    if (state.s !== "ok") return;
    // Safari wants the item created inside the click, with the bytes as a promise.
    void navigator.clipboard
      .write([new ClipboardItem({ "image/png": toPng(state.l) })])
      .then(() => flash("Copied"), () => flash("Could not copy"));
  };
  const save = () => {
    if (state.s !== "ok") return;
    const a = document.createElement("a");
    a.href = state.l.url;
    a.download = saveName(pic.caption, state.l.type);
    document.body.appendChild(a);
    a.click();
    a.remove();
    flash("Saved");
  };

  const btn = "grid size-10 shrink-0 place-items-center rounded-full text-cv-on-viewer transition-colors hover:bg-cv-viewer-btn disabled:opacity-40 [[data-mode=phone]_&]:size-11";
  const fade = clamp(1 - drop / 500, 0.3, 1);
  const tool = (label: string, icon: ReactNode, on: () => void) => (
    <button type="button" className={btn} onClick={on} aria-label={label} title={label} disabled={state.s !== "ok"}>
      {icon}
    </button>
  );

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={fileOf(pic.caption) || "Image"} className="fixed inset-0 flex flex-col font-cv-sans text-cv-on-viewer" style={{ zIndex: "var(--z-popover)" }}>
      <div className="absolute inset-0 bg-cv-viewer" style={{ opacity: fade }} />
      <div className="relative flex items-center gap-1 px-2 pb-1" style={{ paddingTop: "max(8px, var(--safe-top, 0px))", opacity: drop ? fade : 1 }}>
        <div className="min-w-0 flex-1 px-2">
          <div className="truncate font-cv-mono text-cv-meta">{fileOf(pic.caption) || "Image"}</div>
          <div className="truncate text-cv-meta opacity-60 tabular-nums">
            {[pics.length > 1 ? `${i + 1} of ${pics.length}` : "", pic.img.w && pic.img.h ? `${pic.img.w}×${pic.img.h}` : "", kb(pic.img.bytes), done ?? ""].filter(Boolean).join(" · ")}
          </div>
        </div>
        {canCopy() && tool("Copy image", done === "Copied" ? <Check size={18} /> : <Copy size={18} strokeWidth={1.8} />, copy)}
        {kind !== "android" && tool("Save image", <Download size={18} strokeWidth={1.8} />, save)}
        <button ref={closeBtn} type="button" className={btn} onClick={onClose} aria-label="Close" title="Close (Esc)">
          <X size={20} strokeWidth={1.8} />
        </button>
      </div>
      <div
        ref={stage}
        className="relative flex min-h-0 flex-1 touch-none items-center justify-center overflow-hidden select-none"
        style={{ cursor: t.z > 1 ? (live ? "grabbing" : "grab") : "zoom-in", padding: phone ? 0 : 24 }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        {state.s === "ok" ? (
          <img
            ref={picEl}
            src={state.l.url}
            alt={fileOf(pic.caption) || "Image"}
            draggable={false}
            className="pointer-events-none max-h-full max-w-full object-contain"
            style={{ transform: `translate(${t.x}px, ${t.y + drop}px) scale(${t.z})`, transition: live ? "none" : "transform 0.22s var(--ease-cv)" }}
          />
        ) : state.s === "error" ? (
          <div className="flex flex-col items-center gap-3 text-cv-ui">
            <ImageOff size={28} strokeWidth={1.5} />
            <span className="opacity-80">{state.msg}</span>
            <button type="button" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onClick={retry} className="inline-flex min-h-10 items-center gap-2 rounded-full bg-cv-viewer-btn px-4">
              <RotateCw size={15} /> Retry
            </button>
          </div>
        ) : (
          <div className="animate-pulse rounded-cv-md bg-cv-viewer-btn" style={{ width: fitBox(pic.img, 640, 480).w, height: fitBox(pic.img, 640, 480).h, maxWidth: "90%" }} />
        )}
        {pics.length > 1 && !phone && (
          <>
            <button type="button" className={cn(btn, "absolute top-1/2 left-3 -translate-y-1/2 bg-cv-viewer-btn")} onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onClick={() => go(-1)} disabled={i === 0} aria-label="Previous image">
              <ChevronLeft size={20} />
            </button>
            <button type="button" className={cn(btn, "absolute top-1/2 right-3 -translate-y-1/2 bg-cv-viewer-btn")} onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onClick={() => go(1)} disabled={i === pics.length - 1} aria-label="Next image">
              <ChevronRight size={20} />
            </button>
          </>
        )}
      </div>
      {pics.length > 1 && phone && (
        <div className="relative flex justify-center gap-6 pt-1" style={{ paddingBottom: "max(10px, var(--safe-bottom, 0px))" }}>
          <button type="button" className={btn} onClick={() => go(-1)} disabled={i === 0} aria-label="Previous image"><ChevronLeft size={22} /></button>
          <button type="button" className={btn} onClick={() => go(1)} disabled={i === pics.length - 1} aria-label="Next image"><ChevronRight size={22} /></button>
        </div>
      )}
    </div>,
    document.body,
  );
}

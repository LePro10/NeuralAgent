// The devices of the stage: the desktop window (the site's own chrome around the live app), the phone, and the
// static poster versions used where nothing may run inline (phones and tablets).
//
// The chrome is drawn at the window's natural 960 px width and scaled together with the app, like a screenshot of a
// real window: text in the bar is 14 px at full size and about 13.5 px when the window has docked (scale 0.97).
import { forwardRef, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowUpRight, Play } from "lucide-react";
import type { DemoFrame } from "../../demo/api";
import { ActivityMark, Icon, useReducedMotion } from "../ui";
import { LiveFrame, type LiveFrameHandle } from "./LiveFrame";
import { whenIdle } from "./world";

/**
 * Internal viewports of the two apps (CSS px). The desk app needs >= 900 wide to keep its desktop layout; 960 x 600 is
 * the smallest size that still shows a full grid, so the docked window is scaled by about 0.97 and the app's text reads
 * at its real size. The desk posters (scripts/dev/site-posters.mjs) are shot at this size too.
 */
export const DESK = { w: 960, h: 600 } as const;
export const PHONE = { w: 390, h: 844 } as const;

interface WindowProps {
  src: string | null;
  poster: string;
  posterAlt: string;
  /** The last path segment of the title (follows the chapter). */
  where: string;
  live: boolean;
  onReady?: (f: DemoFrame) => void;
  onInteract?: () => void;
  onExit?: () => void;
  className?: string;
}

/**
 * The desktop window: three small panes as controls (not traffic lights), the activity mark and a mono path title. It
 * glows into the dark room with `--glow-window`. The "Live" marker and the tools sit under it, at their real size.
 */
export const LiveWindow = forwardRef<LiveFrameHandle, WindowProps>(function LiveWindow({ src, poster, posterAlt, where, live, onReady, onInteract, onExit, className }, ref) {
  return (
    <figure className={`lw${className ? ` ${className}` : ""}`}>
      <div className="lw__bar">
        <span className="lw__ctl" aria-hidden><i /><i /><i /></span>
        <ActivityMark kind={live ? "working" : "idle"} />
        <span className="lw__title">neuralagent<span className="sep">/</span>live<span className="sep">/</span><b>{where}</b></span>
      </div>
      <LiveFrame ref={ref} className="lw__screen" view="desk" iw={DESK.w} ih={DESK.h} src={src} poster={poster} posterAlt={posterAlt} title="NeuralAgent desktop app, live demo" onReady={onReady} onInteract={onInteract} onExit={onExit} eager />
      <figcaption className="na-sr">A live copy of the NeuralAgent desktop app. It is inert until you choose Type in the app below; Escape gives the keyboard back.</figcaption>
    </figure>
  );
});

interface PhoneProps {
  src: string | null;
  poster: string;
  posterAlt: string;
  onReady?: (f: DemoFrame) => void;
  onInteract?: () => void;
  onExit?: () => void;
  children?: ReactNode;
  className?: string;
}

/** The phone: the real phone app (390 x 844) in a quiet bezel. */
export const PhoneDevice = forwardRef<LiveFrameHandle, PhoneProps>(function PhoneDevice({ src, poster, posterAlt, onReady, onInteract, onExit, children, className }, ref) {
  return (
    <figure className={`pd${className ? ` ${className}` : ""}`}>
      <LiveFrame ref={ref} view="phone" iw={PHONE.w} ih={PHONE.h} src={src} poster={poster} posterAlt={posterAlt} title="NeuralAgent phone app, live demo" onReady={onReady} onInteract={onInteract} onExit={onExit} />
      <figcaption className="na-sr">A live copy of the NeuralAgent phone app, connected to the same simulated computer.</figcaption>
      {children}
    </figure>
  );
});

interface PosterProps {
  view: "desk" | "phone";
  poster: string;
  alt: string;
  /** Full-screen demo URL the whole device links to. */
  href: string;
  /** Mono path for the desktop window title. */
  where?: string;
  /** The caption button under the device; `false` for none (the page has its own button next to it). */
  label?: string | false;
  eager?: boolean;
}

/**
 * Where nothing may run inline (phones, tablets): the poster in its device; the whole device (and the caption under it)
 * is one big tap target that opens the full-screen demo. The caption sits under the device, never on the picture.
 */
export function PosterDevice({ view, poster, alt, href, where = "billing-api", label = "Try it live", eager }: PosterProps) {
  const cta = label && (
    <span className="pdv__cta na-btn" data-variant="secondary" data-size="md">
      <Icon as={Play} size={16} />
      <span>{label}</span>
    </span>
  );
  const name = `${label || "Try it live"}. ${alt}`;
  if (view === "phone")
    return (
      <a className="pdv pdv--phone" href={href} aria-label={name}>
        <figure className="pd">
          <LiveFrame view="phone" iw={PHONE.w} ih={PHONE.h} src={null} poster={poster} posterAlt="" title="" eager={eager} />
        </figure>
        {cta}
      </a>
    );
  return (
    <a className="pdv pdv--desk" href={href} aria-label={name}>
      <figure className="lw">
        <div className="lw__bar">
          <span className="lw__ctl" aria-hidden><i /><i /><i /></span>
          <ActivityMark kind="idle" />
          <span className="lw__title">neuralagent<span className="sep">/</span>live<span className="sep">/</span><b>{where}</b></span>
          <Icon as={ArrowUpRight} size={14} className="lw__out" />
        </div>
        <LiveFrame className="lw__screen" view="desk" iw={DESK.w} ih={DESK.h} src={null} poster={poster} posterAlt="" title="" eager={eager} />
      </figure>
      {cta}
    </a>
  );
}

/** Seconds each poster of the loop stays; the cross-fade is a fraction of it (see .pl in stage.css). */
const LOOP_SECONDS = 3.6;

/**
 * The hero's phone on phones: the first poster at once (it is the LCP image), the others fetched after the page has
 * loaded and the browser is idle, then a slow cross-fade between them: a quiet loop of the real app (an agent working,
 * its question, the inbox) with no iframe and no extra script. It pauses off screen and stays one still under reduced
 * motion. The whole device is one link to the full-screen demo.
 */
export function PosterLoop({ posters, alt, href }: { posters: string[]; alt: string; href: string }) {
  const reduced = useReducedMotion();
  const box = useRef<HTMLAnchorElement>(null);
  const [more, setMore] = useState(false);
  const [loaded, setLoaded] = useState(0);
  const [seen, setSeen] = useState(true);
  const n = posters.length;
  const frames = more && !reduced ? posters : posters.slice(0, 1);
  const run = !reduced && more && loaded >= n - 1;

  useEffect(() => {
    if (reduced) return;
    let cancel = () => {};
    const go = () => (cancel = whenIdle(() => setMore(true), 2500));
    if (document.readyState === "complete") go();
    else addEventListener("load", go, { once: true });
    return () => {
      removeEventListener("load", go);
      cancel();
    };
  }, [reduced]);

  useEffect(() => {
    const el = box.current;
    if (!el || !run) return;
    const io = new IntersectionObserver(([e]) => setSeen(!!e?.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, [run]);

  return (
    <a ref={box} className="pdv pdv--phone" href={href} aria-label={`Try it live. ${alt}`}>
      <figure className="pd pl" data-run={run ? "" : undefined} data-paused={seen ? undefined : ""} style={{ "--n": n, "--T": `${LOOP_SECONDS}s` } as CSSProperties}>
        <div className="lf" data-view="phone" data-state="poster" style={{ aspectRatio: `${PHONE.w} / ${PHONE.h}` }}>
          {frames.map((src, i) => (
            <div key={src} className="lf__poster pl__f" style={{ "--i": i } as CSSProperties}>
              <img src={src} alt="" width={PHONE.w} height={PHONE.h} decoding="async" loading={i === 0 ? "eager" : "lazy"} fetchPriority={i === 0 ? "high" : "low"} draggable={false} onLoad={i > 0 ? () => setLoaded((c) => c + 1) : undefined} />
            </div>
          ))}
        </div>
      </figure>
    </a>
  );
}

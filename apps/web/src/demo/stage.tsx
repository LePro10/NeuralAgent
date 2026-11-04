// The full-screen /demo/ page: a slim toolbar, one line saying what this is, and one frame (desktop
// window or phone) of the live demo. The world lives here (window.__naDemo) and the frame iframe uses
// it. Light on purpose: the app itself loads inside the iframe, behind a still of the same scene.
//
// Layouts: a room of at least 900 px shows the desktop window (or a phone with a bezel); anything
// smaller, a phone held either way and a touch tablet below 1100 px get the app full-bleed in its
// phone layout, with the toolbar condensed into Scene + Options.
import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { loadWorld, parseLook, parseScene, parseView, SCENES, type DemoLook, type DemoScene, type DemoSummary, type DemoView, type DemoWorld } from "./api.ts";

const SCENE_NAMES: Record<DemoScene, string> = {
  grid: "Agents at work",
  permission: "Permission question",
  phone: "Answer on the phone",
  neural: "Talk to Neural",
  files: "Files and changes",
  agents: "All agents",
  idle: "Quiet",
};
const SCHEME_LIST = ["night", "graphite", "midnight", "black", "dusk", "forest"] as const;
/** The posters of the landing page, by scene (the still shown while the app starts). */
const POSTER: Record<DemoScene, string> = { grid: "grid", permission: "permission", phone: "permission", neural: "neural", files: "files", agents: "agents", idle: "hero" };

const DESK = { w: 1280, h: 800 };
const PHONE = { w: 390, h: 844 };
/** What a phone's own status bar and home indicator take, inside the bezel view (CSS px of the screen). */
const PHONE_INSET = { top: 47, bottom: 34 };
const NOTE = "Simulated computer. Nothing you do here leaves this page.";
/** Things the simulated Neural and Claude answer well, one tap from any scene: the demo is scripted, so say what works. */
const TRY: { label: string; text: string; to: string }[] = [
  { label: "What are my agents doing?", text: "What are my agents doing?", to: "neural" },
  { label: "Catch me up", text: "Catch me up", to: "neural" },
  { label: "Explain the cart total", text: "Explain how the cart total is computed", to: "claude-shop" },
];
const HINT = "Keyboard: press Shift+Escape, or Escape twice, to leave the demo and get back to the toolbar.";

function useViewport() {
  const [v, set] = useState({ w: window.innerWidth, h: window.innerHeight });
  useLayoutEffect(() => {
    const on = () => set({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return v;
}

/** The room the device may use: the content box of `el`. */
function useRoom(el: React.RefObject<HTMLElement | null>) {
  const [room, set] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const node = el.current;
    if (!node) return;
    const read = () => set({ w: Math.floor(node.clientWidth - parseFloat(getComputedStyle(node).paddingLeft) - parseFloat(getComputedStyle(node).paddingRight)), h: Math.floor(node.clientHeight - parseFloat(getComputedStyle(node).paddingTop) - parseFloat(getComputedStyle(node).paddingBottom)) });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(node);
    return () => ro.disconnect();
  }, [el]);
  return room;
}

/**
 * iOS keeps the layout viewport when the keyboard opens and shrinks only the visual one: while it is
 * open the stage follows the visual viewport, so the composer stays above the keys. Elsewhere 0.
 */
function useKeyboard(on: boolean) {
  const [kb, set] = useState({ h: 0, top: 0 });
  useEffect(() => {
    const vv = window.visualViewport;
    if (!on || !vv) {
      set({ h: 0, top: 0 });
      return;
    }
    const read = () => {
      const open = vv.scale <= 1.01 && window.innerHeight - vv.height > 120;
      set((p) => (open ? (p.h === Math.round(vv.height) && p.top === Math.round(vv.offsetTop) ? p : { h: Math.round(vv.height), top: Math.round(vv.offsetTop) }) : p.h || p.top ? { h: 0, top: 0 } : p));
    };
    read();
    vv.addEventListener("resize", read);
    vv.addEventListener("scroll", read);
    return () => {
      vv.removeEventListener("resize", read);
      vv.removeEventListener("scroll", read);
    };
  }, [on]);
  return kb;
}

function Mark() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <rect x="8" y="8" width="10" height="48" rx="3" fill="currentColor" />
      <rect x="20" y="9" width="12" height="14" rx="3" fill="currentColor" opacity="0.55" />
      <rect x="26" y="25" width="12" height="14" rx="3" fill="var(--color-accent)" />
      <rect x="32" y="41" width="12" height="14" rx="3" fill="currentColor" opacity="0.55" />
      <rect x="46" y="8" width="10" height="48" rx="3" fill="currentColor" />
    </svg>
  );
}

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

/** The status bar of the phone in the bezel view: a picture of one, aria-hidden. */
function PhoneChrome() {
  return (
    <div className="phone-chrome" aria-hidden="true">
      <div className="phone-status">
        <span>9:41</span>
        <i className="phone-island" />
        <span className="phone-icons">
          <svg viewBox="0 0 18 12" fill="currentColor">
            <rect x="0" y="8" width="3" height="4" rx="0.8" />
            <rect x="5" y="5.5" width="3" height="6.5" rx="0.8" />
            <rect x="10" y="3" width="3" height="9" rx="0.8" />
            <rect x="15" y="0" width="3" height="12" rx="0.8" />
          </svg>
          <svg viewBox="0 0 16 12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
            <path d="M1.5 4.2a9.5 9.5 0 0 1 13 0M4 7a6 6 0 0 1 8 0" />
            <circle cx="8" cy="10" r="1" fill="currentColor" stroke="none" />
          </svg>
          <svg viewBox="0 0 27 12" fill="none">
            <rect x="0.5" y="0.5" width="22" height="11" rx="3.2" stroke="currentColor" opacity="0.5" />
            <rect x="2" y="2" width="19" height="8" rx="2" fill="currentColor" />
            <rect x="24" y="4" width="2" height="4" rx="1" fill="currentColor" opacity="0.5" />
          </svg>
        </span>
      </div>
      <i className="phone-home" />
    </div>
  );
}

/** The computer behind the phone: what it is doing, and a word when the visitor's answer reaches it. */
function HostStrip({ world }: { world: DemoWorld }) {
  const [sum, setSum] = useState<DemoSummary>(() => world.summary());
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    const names = new Map<string, string>();
    let timer = 0;
    const off = world.on((s) => {
      setSum(world.summary());
      if (s.type === "agent-status" || s.type === "prompt-opened") names.set(s.agent, s.name);
      if (s.type === "prompt-answered") {
        const who = s.by === "phone" ? "iPhone" : s.by === "desk" ? "Mac" : "Neural";
        const agent = names.get(s.agent) ?? "The agent";
        setFlash(s.allow ? `Allowed on ${who}. ${agent} carries on at ${world.summary().host}.` : `Declined on ${who}. ${agent} stops.`);
        window.clearTimeout(timer);
        timer = window.setTimeout(() => setFlash(null), 4200);
      }
    });
    const tick = window.setInterval(() => setSum(world.summary()), 1500);
    return () => {
      off();
      window.clearInterval(tick);
      window.clearTimeout(timer);
    };
  }, [world]);
  const parts = [`${sum.working} working`, sum.waiting ? `${sum.waiting} ${sum.waiting === 1 ? "needs" : "need"} you` : ""].filter(Boolean);
  return (
    <p className="stage-host" role="status" data-tone={flash ? "flash" : sum.waiting ? "wait" : "calm"}>
      <i aria-hidden="true" />
      <span>{flash ?? (sum.working || sum.waiting ? `${sum.host}: ${parts.join(", ")}` : `${sum.host}: all calm`)}</span>
    </p>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function Stage({ q }: { q: URLSearchParams }) {
  const { w: vw, h: vh } = useViewport();
  const coarse = useMemo(() => matchMedia("(pointer: coarse)").matches, []);
  // A phone (held either way) or a small touch tablet: the app fills the screen, no bezel.
  const compact = vw < 900 || vh < 500 || (coarse && vw < 1100);
  const [view, setView] = useState<DemoView>(parseView(q.get("view")));
  const [scene, setScene] = useState<DemoScene>(parseScene(q.get("scene")) ?? "grid");
  const [look, setLook] = useState<DemoLook>(() => ({ appearance: "dark", scheme: "night", ...parseLook(q) }));
  const [world, setWorld] = useState<DemoWorld | null>(null);
  const [live, setLive] = useState(false);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [bottomInset, setBottomInset] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const bar = useRef<HTMLElement>(null);
  const brand = useRef<HTMLAnchorElement>(null);
  const wellRef = useRef<HTMLElement>(null);
  const probe = useRef<HTMLDivElement>(null);
  const shown: DemoView = compact ? "phone" : view;
  const kb = useKeyboard(compact);
  const room = useRoom(wellRef);

  // The world is made here once; the frame (a same-origin iframe) joins it.
  useEffect(() => {
    let alive = true;
    void (window.__naDemo ? Promise.resolve(window.__naDemo) : loadWorld({ scene })).then((w) => {
      window.__naDemo = w;
      if (alive) setWorld(w);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The stage follows the look too.
  useEffect(() => {
    const h = document.documentElement;
    h.dataset.appearance = look.appearance ?? "dark";
    h.dataset.scheme = look.scheme ?? "night";
    if (look.accent) h.dataset.accent = look.accent;
    else h.dataset.accent = ({ graphite: "graphite", midnight: "lilac", dusk: "ember", forest: "mint" } as Record<string, string>)[look.scheme ?? "night"] ?? "ice";
  }, [look]);

  const push = useCallback((next: DemoLook) => {
    setLook(next);
    try {
      frame.current?.contentWindow?.__naDemoFrame?.setLook(next);
    } catch {
      /* the frame is still loading: it reads the look from its URL */
    }
  }, []);

  // The home indicator of a real phone: WebKit reports 0 for env() inside iframes, so the stage reads it.
  useLayoutEffect(() => {
    const read = () => setBottomInset(probe.current?.offsetHeight ?? 0);
    read();
    window.addEventListener("resize", read);
    window.addEventListener("orientationchange", read);
    return () => {
      window.removeEventListener("resize", read);
      window.removeEventListener("orientationchange", read);
    };
  }, []);

  // Size: the desktop window at 1280 x 800 (or all the room), scaled down when it does not fit; the
  // phone at its own size; on a phone the app takes the whole room.
  const size = useMemo(() => {
    const { w: rw, h: rh } = room;
    if (!rw || !rh) return { w: 0, h: 0, s: 1, full: compact };
    if (compact) return { w: rw, h: rh, s: 1, full: true };
    if (shown === "phone") {
      const s = Math.min(1, (rh - 28) / PHONE.h, (rw - 28) / PHONE.w);
      return { ...PHONE, s, full: false };
    }
    const s = Math.min(1, rw / DESK.w, rh / DESK.h);
    // Wide rooms: let the window use the room instead of staying a postage stamp.
    if (rw >= 1420 && rh >= 880) return { w: Math.min(rw, 1760), h: Math.min(rh, 1100), s: 1, full: false };
    return { ...DESK, s, full: false };
  }, [compact, shown, room]);

  const src = useMemo(() => {
    const p = new URLSearchParams({ embed: "1", view: shown, scene });
    for (const k of ["seed", "traffic"]) if (q.get(k)) p.set(k, q.get(k)!);
    if (look.appearance) p.set("appearance", look.appearance);
    if (look.scheme) p.set("scheme", look.scheme);
    p.set("accent", look.accent ?? "scheme");
    return `${location.pathname}?${p}`;
    // The frame is reloaded by the view only; scene and look reach a running frame through the world.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, world]);

  // What a real phone would tell the app about its screen (safe areas, tokens.css honours these).
  const insets = compact ? { top: 0, bottom: kb.h ? 0 : bottomInset } : shown === "phone" ? PHONE_INSET : { top: 0, bottom: 0 };
  const applyInsets = useCallback(() => {
    try {
      const root = frame.current?.contentDocument?.documentElement;
      if (!root) return;
      root.style.setProperty("--safe-area-inset-top", `${insets.top}px`);
      root.style.setProperty("--safe-area-inset-bottom", `${insets.bottom}px`);
    } catch {
      /* not ready */
    }
  }, [insets.top, insets.bottom]);
  useEffect(applyInsets, [applyInsets]);

  // The poster stays until the app has its first state and its own launch layer has gone.
  const sized = size.w > 0;
  useEffect(() => {
    setLive(false);
  }, [shown, world]);
  const onLoad = () => {
    const el = frame.current;
    const win = el?.contentWindow;
    if (!el || !win) return;
    applyInsets();
    // Escape twice, or Shift+Escape, gives the keyboard back to the page (the terminal keeps a single Escape).
    let last = 0;
    win.document.addEventListener(
      "keydown",
      (e) => {
        if (e.key !== "Escape") return;
        const now = performance.now();
        const twice = now - last < 600;
        last = now;
        if (!e.shiftKey && !twice) return;
        e.preventDefault();
        (win.document.activeElement as HTMLElement | null)?.blur?.();
        el.blur();
        brand.current?.focus();
      },
      true,
    );
    const t0 = performance.now();
    const tick = () => {
      const ready = win.__naDemoFrame?.ready;
      const gone = (() => {
        const l = win.document.getElementById("na-launch");
        return !l || l.dataset.phase === "gone";
      })();
      if (ready && gone) return void setLive(true);
      if (performance.now() - t0 > 9000) return void setLive(true);
      window.setTimeout(tick, 80);
    };
    // `ready` resolves with the first state; wait for it, then for the launch layer.
    const wait = win.__naDemoFrame?.ready;
    if (wait) void wait.then(tick, tick);
    else tick();
  };

  const play = (s: DemoScene) => {
    setScene(s);
    // The frames navigate themselves on `scene-ready`.
    window.__naDemo?.play(s);
  };

  // A suggestion chip: open the page it belongs to, then say it for the visitor.
  const tryIt = (t: (typeof TRY)[number]) => {
    const w = window.__naDemo;
    if (!w) return;
    try {
      frame.current?.contentWindow?.__naDemoFrame?.navigate(t.to === "neural" ? "neural" : { agent: t.to });
    } catch {
      /* the frame is still loading */
    }
    window.setTimeout(() => w.tell(t.text, t.to), 450);
  };

  // "Back to site": the way the visitor came, so the landing keeps its scroll position and Back keeps working.
  const leave = (e: React.MouseEvent) => {
    try {
      const ref = document.referrer ? new URL(document.referrer) : null;
      if (ref && ref.origin === location.origin && ref.pathname !== location.pathname && history.length > 1) {
        e.preventDefault();
        history.back();
      }
    } catch {
      /* a plain link to the landing */
    }
  };

  const share = async () => {
    const p = new URLSearchParams({ scene, view: shown });
    for (const k of ["seed"]) if (q.get(k)) p.set(k, q.get(k)!);
    if (look.appearance !== "dark" || look.scheme !== "night" || look.accent) p.set("look", `${look.appearance ?? "dark"}.${look.scheme ?? "night"}.${look.accent ?? "scheme"}`);
    const ok = await copyText(`${location.origin}${location.pathname}?${p}`);
    setCopied(ok);
    if (ok) window.setTimeout(() => setCopied(false), 1800);
  };

  // The options sheet closes on Escape, on a click elsewhere and when the frame takes the pointer.
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (!bar.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    window.addEventListener("blur", () => setOpen(false), { once: true });
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const controls = (
    <>
      <div className="stage-seg" role="group" aria-label="Appearance">
        {(["dark", "light"] as const).map((a) => (
          <button key={a} type="button" aria-pressed={look.appearance === a} onClick={() => push({ ...look, appearance: a })}>
            {a === "dark" ? "Dark" : "Light"}
          </button>
        ))}
      </div>
      <select aria-label="Scheme" value={look.scheme} onChange={(e) => push({ ...look, scheme: e.target.value as DemoLook["scheme"], accent: null })}>
        {SCHEME_LIST.map((s) => (
          <option key={s} value={s}>
            {s[0]!.toUpperCase() + s.slice(1)}
          </option>
        ))}
      </select>
      <button type="button" className="stage-btn" onClick={() => void share()}>
        {copied ? "Link copied" : "Copy link"}
      </button>
      <button type="button" className="stage-btn" onClick={() => play(scene)}>
        Replay
      </button>
      <a className="stage-btn is-primary" href="/download/">
        Get NeuralAgent
      </a>
    </>
  );

  const style = { "--stage-h": kb.h ? `${kb.h}px` : undefined, "--stage-top": kb.h ? `${kb.top}px` : undefined } as React.CSSProperties;
  const posterOk = look.appearance === "dark" && look.scheme === "night";
  const posterUrl = posterOk ? `url(/demo/${shown === "phone" ? "phone" : "desk"}-${POSTER[scene]}.webp)` : undefined;

  return (
    <div className="stage" data-full={size.full} data-kb={kb.h ? "open" : "closed"} style={style}>
      <div ref={probe} className="stage-probe" aria-hidden="true" />
      <header className="stage-bar" ref={bar}>
        <a ref={brand} className="stage-brand" href="/" onClick={leave} aria-label={compact ? "Close the demo and go back to the site" : "NeuralAgent: back to the site"}>
          {compact ? <Icon d="M6 6l12 12M18 6L6 18" /> : <Mark />}
          <span>{compact ? "Close" : "NeuralAgent"}</span>
        </a>
        {!compact && (
          <div className="stage-seg" role="group" aria-label="Device">
            <button type="button" aria-pressed={shown === "desk"} onClick={() => setView("desk")}>
              Desktop
            </button>
            <button type="button" aria-pressed={shown === "phone"} onClick={() => setView("phone")}>
              Phone
            </button>
          </div>
        )}
        <select aria-label="Scene" value={scene} onChange={(e) => play(e.target.value as DemoScene)} className="stage-scene">
          {SCENES.map((s) => (
            <option key={s} value={s}>
              {SCENE_NAMES[s]}
            </option>
          ))}
        </select>
        <div className="grow" />
        <div className="stage-inline">{controls}</div>
        <a className="stage-btn is-primary stage-get" href="/download/">
          Get it
        </a>
        <button type="button" className="stage-btn stage-opt" aria-expanded={open} aria-controls="stage-panel" aria-label="Options" onClick={() => setOpen((o) => !o)}>
          <Icon d="M4 7h10M18 7h2M4 17h2M10 17h10M14 5v4M8 15v4" />
          <span>Options</span>
        </button>
        <div id="stage-panel" className="stage-panel" hidden={!open}>
          {controls}
          <p className="stage-panel-note">{NOTE}</p>
        </div>
      </header>
      <div className="stage-info">
        <p className="stage-note">{NOTE}</p>
        {world && shown === "phone" && <HostStrip world={world} />}
        {world && (
          <div className="stage-try" role="group" aria-label="Things to try">
            <span aria-hidden="true">Try</span>
            {TRY.map((t) => (
              <button key={t.label} type="button" onClick={() => tryIt(t)}>
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <main className="stage-well" ref={wellRef}>
        <div className="stage-device" data-view={shown} style={{ "--w": size.w, "--h": size.h, "--s": size.s } as React.CSSProperties}>
          <div className="stage-screen" data-live={live} aria-busy={!live}>
            {/* The still of this scene, until the app has started. */}
            <div className="stage-poster" aria-hidden="true" style={posterUrl ? { backgroundImage: posterUrl } : undefined} />
            {!live && (
              <p className="stage-starting" role="status">
                Starting the app…
              </p>
            )}
            {world && sized && (
              <iframe ref={frame} key={shown} onLoad={onLoad} title={shown === "desk" ? "NeuralAgent desktop demo" : "NeuralAgent phone demo"} aria-describedby="stage-hint" src={src} allow="clipboard-write" />
            )}
            {!compact && shown === "phone" && <PhoneChrome />}
          </div>
        </div>
        <p id="stage-hint" className="stage-sr">
          {HINT}
        </p>
      </main>
    </div>
  );
}

export function bootStage(q: URLSearchParams): void {
  // The launch screen belongs to the app inside the frame; the stage is ready at once.
  document.getElementById("na-launch")?.remove();
  createRoot(document.getElementById("root")!).render(<Stage q={q} />);
}

// The sticky stage (>= 900 px, mouse): one live desktop window and the phone stay pinned while six chapters scroll
// beside them. Each chapter plays a scene of the shared demo world; the window docks from its hero size, the phone
// stands in front of it for the phone chapters. The page scrolls natively; one rAF loop only writes CSS variables.
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowUpRight, MousePointerClick, Play, RotateCcw } from "lucide-react";
import type { DemoScene, DemoWorld } from "../../demo/api";
import { ActivityMark, Icon, usePageVisible, useReducedMotion } from "../ui";
import { CHAPTERS } from "../stage/chapters";
import { LiveWindow, PhoneDevice } from "../stage/Devices";
import type { LiveFrameHandle } from "../stage/LiveFrame";
import { agentLabels, describe, WATCH, type Line } from "../stage/signals";
import { useStageScroll } from "../stage/useStageScroll";
import { demoHref, frameSrc, hostWorld, posterSrc, saveData, whenIdle } from "../stage/world";
import { ChapterBody } from "./StageChapter";

export function StageSticky() {
  const reduced = useReducedMotion();
  const root = useRef<HTMLDivElement>(null);
  const rig = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const desk = useRef<HTMLDivElement>(null);
  const phone = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLOListElement>(null);
  const items = useRef<(HTMLLIElement | null)[]>([]);
  const segs = useRef<(HTMLElement | null)[]>([]);
  const deskFrame = useRef<LiveFrameHandle>(null);
  const phoneFrame = useRef<LiveFrameHandle>(null);
  const typeBtn = useRef<HTMLButtonElement>(null);

  const [active, setActive] = useState(-1);
  const [near, setNear] = useState(false);
  const [world, setWorld] = useState<DemoWorld | null>(null);
  const [deskSrc, setDeskSrc] = useState<string | null>(null);
  const [phoneSrc, setPhoneSrc] = useState<string | null>(null);
  const [deskLive, setDeskLive] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [tick, setTick] = useState<string | null>(null);
  const [engaged, setEngaged] = useState(false);
  const visible = usePageVisible();
  const played = useRef<DemoScene>("grid");
  const activeRef = useRef(-1);
  activeRef.current = active;
  // The visitor worked in a frame since the chapter opened: scrolling back and forth inside the same chapter must not replay it.
  const touched = useRef(false);
  const [saving] = useState(saveData);
  const [asked, setAsked] = useState(false);

  useStageScroll({ refs: { root, rig, area, desk, phone, chapters: wrap, items, segs }, list: CHAPTERS, reduced, onActive: setActive, onNear: setNear });

  // After first paint, on idle: make (or find) the shared world, THEN give the desk frame its src.
  const boot = useCallback(() => {
    let alive = true;
    void hostWorld().then((w) => {
      if (!alive || !w) return;
      setWorld(w);
      setDeskSrc(frameSrc("desk", "grid"));
    });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (saving && !asked) return; // data saver: the poster stays until the visitor asks ("Run it live")
    let stop: (() => void) | undefined;
    const cancel = whenIdle(() => (stop = boot()));
    return () => {
      cancel();
      stop?.();
    };
  }, [boot, saving, asked]);

  // The phone frame loads one chapter early (and at once under reduced motion, where it is always on screen).
  useEffect(() => {
    if (world && !phoneSrc && (active >= 1 || (reduced && near))) setPhoneSrc(frameSrc("phone", played.current));
  }, [world, phoneSrc, active, reduced, near]);

  // The chapter drives the world. A short hold avoids replaying five scenes on a flick through the story.
  useEffect(() => {
    if (!world) return;
    const next: DemoScene = active < 0 ? "grid" : CHAPTERS[active]!.scene;
    if (next === played.current) return;
    const t = setTimeout(() => {
      played.current = next;
      touched.current = false;
      world.play(next);
      setLines([]);
      setTick(null);
    }, 260);
    return () => clearTimeout(t);
  }, [active, world]);

  // Simulated time stands still while the stage is far away or the tab is hidden.
  useEffect(() => {
    if (!world) return;
    if (near && visible) world.clock.resume();
    else world.clock.pause();
  }, [world, near, visible]);

  // What the world says, as short readout lines in the chapter ("approved on your phone, the agent carries on").
  useEffect(() => {
    if (!world) return;
    let n = 0;
    let timer = 0;
    let listening = true; // the world replays its pre-roll through the signals: only what happens after the scene is on screen counts
    const label = agentLabels(world.handles);
    const off = world.on((s) => {
      if (s.type === "reset" || s.type === "scene") listening = false;
      else if (s.type === "scene-ready") listening = true;
      if (!listening) return;
      const id = CHAPTERS[activeRef.current]?.id ?? "";
      if (!WATCH[id]?.includes(s.type)) return;
      const d = describe(s, label);
      if (s.type === "prompt-answered") {
        // The question is settled: a scripted answer just clears it, a visitor's answer replaces it.
        setLines((prev) => {
          const rest = prev.filter((l) => l.agent !== s.agent);
          return d ? [...rest.slice(-2), { key: n++, ...d }] : rest;
        });
      } else if (d) {
        // A newer line of the same agent replaces its older one: one agent never says two things at once.
        setLines((prev) => {
          if (prev[prev.length - 1]?.text === d.text) return prev;
          const rest = d.agent ? prev.filter((l) => l.agent !== d.agent) : prev;
          return [...rest.slice(-2), { key: n++, ...d }];
        });
      }
      if (!d) return;
      if (s.type === "prompt-answered" && s.by === "phone") {
        setTick(s.allow ? "Allowed on your phone" : "Denied on your phone");
        clearTimeout(timer);
        timer = window.setTimeout(() => setTick(null), 5200);
      }
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [world]);

  const reset = () => {
    world?.play(played.current);
    touched.current = false;
    setLines([]);
    setTick(null);
  };
  const go = (i: number) => items.current[i]?.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
  const cur = CHAPTERS[Math.max(0, active)]!;
  const scene: DemoScene = active < 0 ? "grid" : cur.scene;
  const onInteract = () => {
    touched.current = true;
    setEngaged(true);
  };
  // Escape inside a frame: the page has the keyboard back, and the focus returns to the button that sent it there.
  const onExit = () => {
    setEngaged(false);
    if (document.activeElement?.tagName === "IFRAME") typeBtn.current?.focus({ preventScroll: true });
  };

  return (
    <div ref={root} className="stg" data-static={reduced ? "" : undefined} data-pre={active < 0 ? "" : undefined}>
      <div ref={rig} className="stg__rig">
        <div ref={area} className="stg__area">
          <div ref={desk} className="stg__desk">
            <LiveWindow
              ref={deskFrame}
              src={deskSrc}
              poster={posterSrc("desk", active <= 0 ? "hero" : cur.poster)}
              posterAlt={cur.alt.desk}
              where={cur.where}
              live={deskLive}
              onReady={() => setDeskLive(true)}
              onInteract={onInteract}
              onExit={onExit}
            />
          </div>
          <div ref={phone} className="stg__phone" data-on="off">
            <PhoneDevice ref={phoneFrame} src={phoneSrc} poster={posterSrc("phone", cur.phone ? cur.poster : "agents")} posterAlt={cur.alt.phone} onInteract={onInteract} onExit={onExit}>
              <span className="pd__tick" data-show={tick ? "" : undefined} role="status">
                <ActivityMark kind="done" />
                <span>{tick}</span>
              </span>
            </PhoneDevice>
          </div>

          <div className="stg__bar">
            <p className="stg__live t-label">
              <ActivityMark kind={deskLive ? "working" : "idle"} />
              <span>
                <b>{deskLive ? "Live" : saving && !asked ? "Paused" : "Starting"}</b>
                <span className="na-hide-md"> · the real app, running in your browser</span>
              </span>
            </p>

            <nav className="stg__idx" aria-label="Chapters">
              <ol>
                {CHAPTERS.map((c, i) => (
                  <li key={c.id} ref={(el) => void (segs.current[i] = el)} data-state={i < active ? "done" : i === active ? "now" : "next"}>
                    <button type="button" onClick={() => go(i)} aria-current={i === active ? "step" : undefined} aria-label={`Chapter ${i + 1}: ${c.short}`}>
                      <ActivityMark kind={i < active ? "done" : i === active ? "working" : "idle"} />
                      <span className="stg__no t-label">{String(i + 1).padStart(2, "0")}</span>
                      <span className="stg__lbl t-label">{c.short}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </nav>

            <div className="stg__tools">
              {saving && !asked ? (
                <button type="button" className="stg__tool" onClick={() => setAsked(true)}>
                  <Icon as={Play} size={14} />
                  <span>Start the live app</span>
                </button>
              ) : (
                <button ref={typeBtn} type="button" className="stg__tool" onClick={() => deskFrame.current?.engage()} disabled={!deskLive} aria-pressed={engaged} title="Keys go to the app until you press Escape.">
                  <Icon as={MousePointerClick} size={14} />
                  <span>Type in the app</span>
                </button>
              )}
              <button type="button" className="stg__tool" onClick={reset} disabled={!world} title="Start this chapter again">
                <Icon as={RotateCcw} size={14} />
                <span>Reset</span>
              </button>
              <a className="stg__tool" href={demoHref(scene)}>
                <span>Open in the live demo</span>
                <Icon as={ArrowUpRight} size={14} />
              </a>
            </div>
          </div>
        </div>
      </div>

      <ol ref={wrap} className="stg__chs" aria-label="Chapters">
        {CHAPTERS.map((c, i) => (
          <li key={c.id} ref={(el) => void (items.current[i] = el)} className="ch" style={{ "--k": 1 } as CSSProperties} aria-current={i === active ? "step" : undefined}>
            <ChapterBody c={c} index={i} lines={i === active ? lines : []} wide />
          </li>
        ))}
      </ol>
    </div>
  );
}

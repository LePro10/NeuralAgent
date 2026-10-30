import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { reduced, useMedia } from "./hooks";
import { SCENES } from "./Scenes";

const CHAPTERS = [
  {
    eyebrow: "01 · One place",
    title: "All your agents, side by side.",
    text: "Stop hunting through terminal windows. Every agent gets a pane in a grid, grouped by project, and you see at a glance who is working, who is done and who is waiting for you.",
    points: ["Thirteen agent CLIs from one list, plus plain shells", "Workspaces, tabs and a pane grid per project", "Git worktrees, a browser preview pane and session search with resume"],
    scene: "grid",
  },
  {
    eyebrow: "02 · Neural",
    title: "Say it. Neural makes it happen.",
    text: "Neural is the voice orchestrator on top of your agents. Ask what is going on, tell it what to build next, or start a call and talk it through like a colleague.",
    points: ["Wake word “Hey Neural”, or hold a key to dictate into any app", "Speech recognition and voice output run on your computer", "Neural starts agents, answers their prompts and launches swarms"],
    scene: "voice",
  },
  {
    eyebrow: "03 · Anywhere",
    title: "Leave the desk. Keep the loop.",
    text: "An agent that stops to ask something should not wait until you are back. Your phone gets the notification, you approve or answer, and the work goes on.",
    points: ["Push notifications on Android and in the browser (iPhone via home screen app)", "The same interface as on the desktop, in any browser", "The service on your computer keeps running when you close the window"],
    scene: "phone",
  },
  {
    eyebrow: "04 · Private",
    title: "Your code stays where it is.",
    text: "NeuralAgent is local first. Phone access goes through a relay that only forwards sealed messages between your own devices. It has no way to read what your agents say or do.",
    points: ["Keys are created on your devices and never leave them", "X25519 key exchange, AES-256-GCM encryption", "No tracking, no analytics, no cookies"],
    scene: "seal",
  },
] as const;

export function Story() {
  const wide = useMedia("(min-width: 900px)");
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(0);

  useEffect(() => {
    if (!wide) return;
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const tick = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const t = Math.min(0.999, Math.max(0, -r.top / Math.max(1, r.height - innerHeight)));
      setOn(Math.floor(t * CHAPTERS.length));
    };
    const req = () => raf || (raf = requestAnimationFrame(tick));
    addEventListener("scroll", req, { passive: true });
    addEventListener("resize", req);
    tick();
    return () => {
      removeEventListener("scroll", req);
      removeEventListener("resize", req);
    };
  }, [wide]);

  const jump = (i: number) => {
    const el = ref.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + scrollY + ((i + 0.5) / CHAPTERS.length) * (el.offsetHeight - innerHeight);
    scrollTo({ top, behavior: reduced() ? "auto" : "smooth" });
  };

  return (
    <section id="story" className="s-story" ref={ref} aria-label="Why NeuralAgent">
      <div className="s-story-pin">
        <div className="s-chapters">
          {CHAPTERS.map((c, i) => {
            const Scene = SCENES[c.scene];
            return (
              <article key={c.title} className={`s-chapter${wide ? (i === on ? " on" : i < on ? " past" : "") : ""}`} data-reveal={wide ? undefined : ""} aria-hidden={wide && i !== on ? true : undefined}>
                <div>
                  <span className="eyebrow">{c.eyebrow}</span>
                  <h3>{c.title}</h3>
                  <p>{c.text}</p>
                  <ul>
                    {c.points.map((p) => (
                      <li key={p}><Check size={16} />{p}</li>
                    ))}
                  </ul>
                </div>
                <div className="s-scene"><Scene /></div>
              </article>
            );
          })}
          <div className="s-steps" style={{ position: "absolute", left: 0, bottom: 56 }}>
            {CHAPTERS.map((c, i) => (
              <button key={c.title} type="button" aria-label={`Chapter ${i + 1}`} onClick={() => jump(i)} style={{ all: "unset", flex: 1, maxWidth: 56, cursor: "pointer", padding: "14px 0" }}>
                <i style={{ "--f": i <= on ? 1 : 0, display: "block", height: 3, width: "100%" } as never} />
              </button>
            ))}
          </div>
        </div>
        <div className="s-scene-stack">
          <div className="s-scene-size" />
          {CHAPTERS.map((c, i) => {
            const Scene = SCENES[c.scene];
            return <div key={c.title} className={`s-scene${i === on ? " on" : ""}`} aria-hidden><Scene /></div>;
          })}
        </div>
      </div>
    </section>
  );
}

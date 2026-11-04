// Highlights: five things that set NeuralAgent apart, as a bento of small living panes (the full list moved to /features/).
// Each pane has one quiet motion graphic that only runs while it is on screen ([data-in] from Reveal); a soft light follows
// the pointer across the grid. Facts only (content/spec.ts).
import "./Highlights.css";
import { useRef, type PointerEvent } from "react";
import { ArrowRight, AudioLines, Gauge, ShieldAlert, Server, Plane } from "lucide-react";
import { Icon, Reveal, Section, SlotLines, useScrollProgress } from "../ui";
import { SPEC } from "../content/spec";

const COUNT = SPEC.reduce((n, g) => n + g.items.length, 0);

function Wave() {
  return (
    <div className="hl-wave" aria-hidden>
      {Array.from({ length: 36 }, (_, i) => (
        <i key={i} style={{ "--n": i } as React.CSSProperties} />
      ))}
    </div>
  );
}

function Race() {
  const lanes = [
    { who: "discord", w: 1 },
    { who: "github", w: 0.78 },
    { who: "email", w: 0.62 },
  ];
  return (
    <ol className="hl-race" aria-hidden>
      {lanes.map((l, i) => (
        <li key={l.who} style={{ "--w": l.w, "--n": i } as React.CSSProperties} data-win={i === 0 ? "" : undefined}>
          <span>{l.who}</span>
          <b><i /></b>
          <em>{i === 0 ? "sorted" : ""}</em>
        </li>
      ))}
    </ol>
  );
}

function Ask() {
  return (
    <div className="hl-ask" aria-hidden>
      <code>$ git push --force</code>
      <div className="hl-ask__row">
        <span>Neural asks first</span>
        <span className="hl-ask__btns"><i>Deny</i><i data-on="">Allow</i></span>
      </div>
    </div>
  );
}

const BEAT = "M0 30 H70 L80 30 L88 10 L98 50 L106 22 L112 30 H160 L168 30 L174 18 L182 40 L188 30 H240";

function Pulse() {
  return (
    <svg className="hl-pulse" viewBox="0 0 240 56" aria-hidden preserveAspectRatio="none">
      <path className="hl-pulse__base" d={BEAT} />
      <path className="hl-pulse__beat" pathLength={1} d={BEAT} />
    </svg>
  );
}

function Memory() {
  return (
    <div className="hl-mem" aria-hidden>
      <div className="hl-mem__bar"><i /></div>
      <div className="hl-mem__labels"><span>1.3 GB before</span><span>&lt; 100 MB idle</span></div>
    </div>
  );
}

const CARDS = [
  { id: "voice", wide: true, icon: AudioLines, title: "Say “Hey Neural”.", text: "Talk to an orchestrator that starts agents, answers their prompts and reports back. Wake word, speech to text and the voice all run on your own computer.", art: <Wave />, chip: "local voice · calls · dictation" },
  { id: "autopilot", icon: Plane, title: "Let an autopilot mind the project.", text: "It reads your Discord, GitHub and mail, sorts what comes in and drafts the answers. You decide what it may do.", art: <Race />, chip: "autopilot · connectors" },
  { id: "ask", icon: ShieldAlert, title: "Risky steps wait for you.", text: "Deleting files, force pushing, publishing: Neural asks Allow or Deny first, even behind quotes or semicolons.", art: <Ask />, chip: "guardrails" },
  { id: "svc", icon: Server, title: "Agents never stop.", text: "One background service owns every agent. Close or update the app: they keep working.", art: <Pulse />, chip: "always on" },
  { id: "mem", icon: Gauge, title: "Light as air.", text: "Idle memory on a Mac fell from about 1.3 GB to well under 100 MB.", art: <Memory />, chip: "< 100 MB" },
];

export function Highlights() {
  const grid = useRef<HTMLDivElement>(null);
  useScrollProgress(grid);
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>(".hl-card");
    if (!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty("--mx", `${e.clientX - r.left}px`);
    card.style.setProperty("--my", `${e.clientY - r.top}px`);
  };
  return (
    <Section id="highlights" path="product/highlights" meta={<span className="na-hide-sm t-num">{COUNT} features in all</span>} labelledBy="hl-h">
      <div className="na-head hl-head">
        <SlotLines as="h2" id="hl-h" className="t-h2" immediate={false} lines={["The details", "that make it calm"]} stop />
        <Reveal as="p" index={2} className="t-lead">The grid, the phone and the story above are the core. These are the touches people notice next.</Reveal>
      </div>
      <div ref={grid} className="hl-grid" onPointerMove={move}>
        {CARDS.map((c, i) => (
          <Reveal key={c.id} kind="pane" index={i * 0.6} className={`hl-card${c.wide ? " hl-card--wide" : ""}`} data-id={c.id}>
            <div className="hl-art">{c.art}</div>
            <div className="hl-copy">
              <span className="hl-chip t-label"><Icon as={c.icon} size="sm" /> {c.chip}</span>
              <h3 className="t-h3">{c.title}</h3>
              <p>{c.text}</p>
            </div>
          </Reveal>
        ))}
      </div>
      <Reveal className="na-more">
        <a className="na-morelink" href="/features/">
          See all {COUNT} features <ArrowRight size={16} strokeWidth={1.8} aria-hidden />
        </a>
      </Reveal>
    </Section>
  );
}

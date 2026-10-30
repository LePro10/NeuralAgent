import { Bell, BarChart3, Check, GitBranch, LayoutGrid, MonitorSmartphone, Moon, Mic, Network, Palette, Plug, RefreshCw, Search, Smartphone, SunMoon, Terminal, Zap, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { reduced } from "./hooks";
import { GridScene, PhoneScene, VoiceScene } from "./Scenes";
import { StatusDot } from "./parts";

const SW = [
  { id: "night", n: "Night" }, { id: "graphite", n: "Graphite" }, { id: "midnight", n: "Midnight" },
  { id: "black", n: "Black" }, { id: "dusk", n: "Dusk" }, { id: "forest", n: "Forest" },
] as const;
const ACCENT: Record<string, string> = { night: "ice", graphite: "graphite", midnight: "lilac", black: "ice", dusk: "ember", forest: "mint" };

function ThemeScene() {
  const [id, setId] = useState<string>("midnight");
  return (
    <div className="s-mini" data-scheme={id} data-accent={ACCENT[id]} style={{ background: "var(--color-bg)", padding: 14, borderRadius: "var(--radius-card)", boxShadow: "var(--shadow-edge)", transition: "background .5s" }}>
      <div className="s-theme-win"><span className="a" /><span className="b" /><span className="b" style={{ width: "72%" }} /><span className="c" /></div>
      <div className="s-sw" role="group" aria-label="Colour scheme">
        {SW.map((s) => (
          <button key={s.id} type="button" aria-pressed={id === s.id} onClick={() => setId(s.id)} data-scheme={s.id} data-accent={ACCENT[s.id]} style={{ background: "var(--color-card)" }}>
            {s.n}<i />
          </button>
        ))}
      </div>
    </div>
  );
}

function SwarmScene() {
  const calm = reduced();
  const N: [string, number, number][] = [["Lead", 200, 40], ["API", 70, 140], ["Tests", 200, 170], ["Docs", 330, 140]];
  const E: [number, number][] = [[0, 1], [0, 2], [0, 3], [1, 2], [2, 3]];
  return (
    <svg className="s-svg" viewBox="0 0 400 220" role="img" aria-label="A swarm: a lead agent hands work to API, tests and docs agents" style={{ maxWidth: 460, position: "relative", zIndex: 1 }}>
      {E.map(([a, b], i) => {
        const p = `M ${N[a]![1]} ${N[a]![2]} L ${N[b]![1]} ${N[b]![2]}`;
        return (
          <g key={i}>
            <path d={p} className="ln s-flow" style={{ fill: "none", stroke: "var(--color-accent)", strokeWidth: 1.2, opacity: 0.5 }} />
            {!calm && <circle r="3" style={{ fill: "var(--color-accent)" }}><animateMotion dur={`${2.4 + i * 0.4}s`} begin="0s" repeatCount="indefinite" path={p} /></circle>}
          </g>
        );
      })}
      {N.map(([n, x, y], i) => (
        <g key={n} className="nd" style={{ transform: `translate(${x - 38}px, ${y - 17}px)` }}>
          <rect width="76" height="34" rx="12" style={{ fill: "var(--color-card)", stroke: i === 0 ? "var(--color-accent)" : "var(--color-line-2)" }} />
          <circle cx="16" cy="17" r="3.5" style={{ fill: i === 0 ? "var(--color-ember)" : "var(--color-live)" }} />
          <text x="28" y="21" style={{ fill: "var(--color-bright)", fontSize: 11, textTransform: "none", letterSpacing: 0, fontFamily: "var(--font-sans)" }}>{n}</text>
        </g>
      ))}
    </svg>
  );
}

function AlertScene() {
  const rows: [string, string, string][] = [
    ["Codex needs your OK", "Run migration 0042 on the dev database?", "now"],
    ["Claude Code finished", "billing-api · 14 tests passed", "2 min"],
    ["Gemini CLI is idle", "web-shop · waiting for the next task", "9 min"],
  ];
  return (
    <div className="s-mini" style={{ gap: 10 }}>
      {rows.map(([t, d, w], i) => (
        <div className="s-row" key={t} style={{ padding: 14, animation: reduced() ? "none" : `s-notif .7s ${i * 0.18}s var(--ease-spring) backwards` }}>
          <StatusDot s={i === 0 ? "ask" : i === 1 ? "done" : "idle"} />
          <div className="tx"><div>{t}</div><small>{d}</small></div>
          <span className="eyebrow">{w}</span>
        </div>
      ))}
    </div>
  );
}

function UsageScene({ go }: { go: boolean }) {
  const v = [34, 52, 41, 66, 58, 82, 47, 71, 90, 63, 55, 78, 44, 69];
  return (
    <div className={`s-mini ${go ? "go" : ""}`} style={{ gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span className="eyebrow">Tokens, last 14 days · sample</span>
        <span className="display tabular" style={{ fontSize: "var(--text-headline)" }}>Cost per day</span>
      </div>
      <div className="s-bars">
        {v.map((h, i) => <i key={i} className={i === 8 ? "hi" : ""} style={{ ["--h" as never]: h / 100, ["--i" as never]: i }} />)}
      </div>
      <div className="s-row"><Zap size={15} style={{ color: "var(--color-accent)" }} /><div className="tx"><div>Claude Code and Codex</div><small>Read from the CLIs&rsquo; own transcripts, also for sessions started outside NeuralAgent</small></div></div>
    </div>
  );
}

function McpScene() {
  const rows = [["filesystem", "local · stdio"], ["issue tracker", "remote · http"], ["database", "local · stdio"]];
  return (
    <div className="s-mini" style={{ gap: 10 }}>
      <span className="eyebrow">MCP servers · example</span>
      {rows.map(([n, d]) => (
        <div className="s-row" key={n} style={{ padding: 14 }}><Plug size={15} style={{ color: "var(--color-accent)" }} /><div className="tx"><div>{n}</div><small>{d}</small></div><span className="s-pill" style={{ padding: "3px 10px" }}>all agents</span></div>
      ))}
    </div>
  );
}

interface Tab { id: string; label: string; Icon: LucideIcon; title: string; text: string; points: [LucideIcon, string][]; scene: (go: boolean) => React.ReactNode }

const TABS: Tab[] = [
  {
    id: "agents", label: "Agents", Icon: LayoutGrid, title: "A pane grid for every project.",
    text: "Start any agent in any folder. Panes keep their sessions, show their status and wake you up only when it matters.",
    points: [[Terminal, "Thirteen agent CLIs and plain shells, side by side"], [GitBranch, "Git worktrees and a browser preview pane"], [Search, "Search every past session and resume it"]],
    scene: () => <GridScene />,
  },
  {
    id: "neural", label: "Neural", Icon: Mic, title: "Talk to your agents. Or call them.",
    text: "Neural listens for its name, understands what you want and runs the agents for you. Hold a key to dictate into any app, or start a call from desktop or Android.",
    points: [[Mic, "“Hey Neural” wake word and push-to-talk dictation"], [Zap, "Starts agents, answers prompts, launches swarms"], [Moon, "Voice models run locally. You choose the model provider"]],
    scene: () => <VoiceScene />,
  },
  {
    id: "swarms", label: "Swarms", Icon: Network, title: "A team on one goal.",
    text: "Give a goal, get a team. Agents message each other through a small tool every member receives, so it works with any CLI that speaks MCP.",
    points: [[Network, "Messages land in the recipient's terminal when it finishes its turn"], [Check, "You see the whole conversation and can write into it"], [Zap, "Neural can start a swarm from a sentence"]],
    scene: () => <SwarmScene />,
  },
  {
    id: "remote", label: "Remote", Icon: Smartphone, title: "Your desk in your pocket.",
    text: "Open the web remote in any browser or the Android app. It is the same interface, talking to the same agents on your computer, sealed end to end.",
    points: [[MonitorSmartphone, "Browser, installable iPhone app, Android app"], [Check, "Approve prompts and read output from anywhere"], [Moon, "Call Neural from a quick-settings tile on Android"]],
    scene: () => <PhoneScene notif={false} />,
  },
  {
    id: "alerts", label: "Alerts", Icon: Bell, title: "Only the interruptions that matter.",
    text: "NeuralAgent knows when an agent needs a decision or has finished, and tells you on the device you are actually holding.",
    points: [[Bell, "Push on Android and in the browser"], [Smartphone, "Tap a notification to land on that exact session"], [Check, "Works while the app window is closed"]],
    scene: () => <AlertScene />,
  },
  {
    id: "usage", label: "Usage", Icon: BarChart3, title: "Know what your agents use.",
    text: "Tokens and estimated cost per day, per model and per project, read from the agents' own transcripts. Nothing to configure, nothing sent anywhere.",
    points: [[BarChart3, "Covers conversations started outside NeuralAgent too"], [Zap, "Subscription limits shown for Codex"], [Check, "Cost estimated at API list prices"]],
    scene: (go) => <UsageScene go={go} />,
  },
  {
    id: "mcp", label: "MCP", Icon: Plug, title: "Set up tools once.",
    text: "Add an MCP server in one place and every agent gets it at launch, in the format that agent expects.",
    points: [[Plug, "Config generated for Claude Code, Codex and OpenCode"], [Check, "Secrets kept in a separate owner-only file"], [Zap, "Handed over by environment variable, never on a command line"]],
    scene: () => <McpScene />,
  },
  {
    id: "themes", label: "Themes", Icon: Palette, title: "Make it yours.",
    text: "Six colour schemes and a choice of accents, with the liquid glass look on top. Try one on the right.",
    points: [[SunMoon, "Night, Graphite, Midnight, Black, Dusk and Forest"], [Palette, "Accent colours that follow the scheme or stand alone"], [Check, "Reduced-motion and rest modes for calm"]],
    scene: () => <ThemeScene />,
  },
];

const DETAILS: [LucideIcon, string, string][] = [
  [RefreshCw, "Updates itself", "New versions install in the background; running agents keep going."],
  [Zap, "Keeps the Mac awake", "Optional: no idle sleep while agents work."],
  [Terminal, "Lives in the tray", "A menu bar or tray icon with quick actions."],
  [MonitorSmartphone, "Discord presence", "Optional status that you are working with agents."],
  [Search, "Session search", "Find any past conversation across agents and resume it."],
  [Moon, "Survives restarts", "The service outlives the window, so closing it never kills an agent."],
];

export function Showcase() {
  const [tab, setTab] = useState(0);
  const [go, setGo] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setGo(false);
    const id = setTimeout(() => setGo(true), 60);
    return () => clearTimeout(id);
  }, [tab]);
  const first = useRef(true);
  useEffect(() => {
    // Centre the active tab inside its own strip. Never scrollIntoView: it also scrolls the page.
    if (first.current) return void (first.current = false);
    const box = list.current;
    const el = box?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!box || !el) return;
    box.scrollTo({ left: el.offsetLeft - (box.clientWidth - el.offsetWidth) / 2, behavior: reduced() ? "auto" : "smooth" });
  }, [tab]);
  const key = (e: KeyboardEvent) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (tab + d + TABS.length) % TABS.length;
    setTab(n);
    list.current?.querySelectorAll<HTMLElement>('[role="tab"]')[n]?.focus({ preventScroll: true });
  };
  const t = TABS[tab]!;
  return (
    <section id="features" className="s-sec">
      <div className="s-wrap">
        <div className="s-head center" data-reveal>
          <span className="eyebrow">Features</span>
          <h2 className="s-h2">Everything an agent team needs. Nothing it doesn&rsquo;t.</h2>
        </div>
        <div className="s-tabbar" data-reveal>
          <div className="s-seg" role="tablist" aria-label="Features" ref={list} onKeyDown={key}>
            {TABS.map((x, i) => (
              <button key={x.id} role="tab" type="button" id={`tab-${x.id}`} aria-selected={i === tab} aria-controls="feat-panel" tabIndex={i === tab ? 0 : -1} onClick={() => setTab(i)}>
                <x.Icon size={16} />{x.label}
              </button>
            ))}
          </div>
        </div>
        <div className="s-feat" id="feat-panel" role="tabpanel" aria-labelledby={`tab-${t.id}`} data-reveal>
          <div className="s-feat-copy s-feat-panel" key={t.id}>
            <h3>{t.title}</h3>
            <p>{t.text}</p>
            <ul className="s-bul">
              {t.points.map(([I, p]) => (
                <li key={p}><span className="ic"><I size={15} /></span><span style={{ paddingTop: 4 }}>{p}</span></li>
              ))}
            </ul>
          </div>
          <div className="s-feat-vis"><div className={`s-feat-panel ${go ? "go" : ""}`} key={t.id} style={{ width: "100%", display: "grid", placeItems: "center", position: "relative", zIndex: 1 }}>{t.scene(go)}</div></div>
        </div>
        <div className="s-details">
          {DETAILS.map(([I, h, p], i) => (
            <div key={h} className="s-card s-spot" data-reveal style={{ ["--i" as never]: i % 3 }}>
              <span className="s-ic"><I size={17} /></span>
              <h4>{h}</h4>
              <p>{p}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

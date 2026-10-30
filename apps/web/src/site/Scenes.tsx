// Illustrations for the story and the feature tabs. Pure CSS/SVG, tokens only.
import { Bell, Mic } from "lucide-react";
import { reduced } from "./hooks";
import { Orb, StatusDot, Wave } from "./parts";

const TILES: { n: string; s: "run" | "done" | "ask"; w: number[] }[] = [
  { n: "Claude Code", s: "run", w: [78, 52, 66, 40] },
  { n: "Codex", s: "ask", w: [60, 82, 36, 58] },
  { n: "Gemini CLI", s: "done", w: [70, 44, 74, 30] },
  { n: "Aider", s: "run", w: [48, 66, 54, 72] },
  { n: "OpenCode", s: "run", w: [82, 38, 62, 50] },
  { n: "Cursor Agent", s: "done", w: [56, 72, 42, 64] },
];

export function GridScene() {
  return (
    <div className="s-mini" style={{ maxWidth: 420, gridTemplateColumns: "1fr 1fr", gap: 10 }}>
      {TILES.map((t, i) => (
        <div key={t.n} className="s-pane" style={{ minHeight: 0 }}>
          <div className="s-pane-h"><StatusDot s={t.s} />{t.n}</div>
          <div style={{ padding: "12px 12px 14px", display: "grid", gap: 7 }}>
            {t.w.map((w, k) => (
              <i key={k} className="s-ln" style={{ width: `${w}%`, animationDelay: `${(i * 4 + k) * 0.18}s` }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function VoiceScene() {
  return (
    <div className="s-mini" style={{ justifyItems: "center", gap: 22 }}>
      <span className="s-pill"><Mic size={13} /> “Hey Neural, what are my agents doing?”</span>
      <Orb talk />
      <Wave who="neural" on />
    </div>
  );
}

export function PhoneScene({ notif = true }: { notif?: boolean }) {
  return (
    <div className="s-phone" aria-hidden>
      {notif && (
        <div className="s-notif">
          <span className="eyebrow"><Bell size={11} /> NeuralAgent · now</span>
          <span>Codex needs your OK: run the database migration?</span>
          <div className="acts"><span className="s-btn" style={{ textAlign: "center", lineHeight: "36px" }}>Deny</span><span className="s-btn go" style={{ textAlign: "center", lineHeight: "36px" }}>Approve</span></div>
        </div>
      )}
      <div className="s-phone-in">
        <h4 style={{ marginTop: notif ? 104 : 0 }}>Agents</h4>
        {[["Claude Code", "Editing total.ts", "run"], ["Codex", "Waiting for you", "ask"], ["Gemini CLI", "Finished 2 min ago", "done"]].map(([n, d, s]) => (
          <div className="s-row" key={n}>
            <StatusDot s={s as "run"} />
            <div className="tx"><div>{n}</div><small>{d}</small></div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SealScene() {
  const calm = reduced();
  const L = "M 78 110 L 170 110";
  const R = "M 230 110 L 322 110";
  const pk = (path: string, begin: string) =>
    calm ? null : (
      <circle r="3.5" className="pk">
        <animateMotion dur="3.2s" begin={begin} repeatCount="indefinite" path={path} />
      </circle>
    );
  return (
    <svg className="s-svg" viewBox="0 0 400 220" role="img" aria-label="Your computer and your phone talk through a relay that only sees sealed messages" style={{ maxWidth: 480, position: "relative", zIndex: 1 }}>
      <g className="nd"><rect x="20" y="76" width="58" height="68" rx="12" /><rect x="30" y="88" width="38" height="26" rx="4" style={{ fill: "var(--color-fill-3)", stroke: "none" }} /><circle cx="49" cy="128" r="3" style={{ fill: "var(--color-mint)", stroke: "none" }} /></g>
      <g className="nd hot"><rect x="170" y="80" width="60" height="60" rx="14" /></g>
      <g className="nd"><rect x="322" y="70" width="46" height="80" rx="12" /><rect x="330" y="82" width="30" height="46" rx="4" style={{ fill: "var(--color-fill-3)", stroke: "none" }} /></g>
      <path d={L} className="ln s-flow" /><path d={R} className="ln s-flow" />
      {pk(L, "0s")}{pk(R, "0s")}
      <g transform="translate(190 96)"><rect x="0" y="9" width="20" height="15" rx="3" className="lock" /><path d="M4 9 V6 a6 6 0 0 1 12 0 V9" className="lock" /></g>
      <text x="49" y="168" textAnchor="middle">Your computer</text>
      <text x="200" y="168" textAnchor="middle">Relay: sealed</text>
      <text x="345" y="168" textAnchor="middle">Your phone</text>
      <text x="200" y="50" textAnchor="middle" style={{ fill: "var(--color-accent)" }}>7f3a·c91e·02b8·e4d1</text>
    </svg>
  );
}

export const SCENES = { grid: GridScene, voice: VoiceScene, phone: PhoneScene, seal: SealScene } as const;

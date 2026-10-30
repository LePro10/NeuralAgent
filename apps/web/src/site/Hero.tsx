import { Apple, ArrowRight } from "lucide-react";
import { useRelease } from "./data";
import { useVisible } from "./hooks";
import { Aurora, AutoPane, Btn, CopyCmd, SIDE, Win, type Line } from "./parts";

const A: Line[] = [
  ["cmd", "fix the failing checkout test"],
  ["out", "Reading src/checkout/total.ts"],
  ["out", "Found it: rounding before tax"],
  ["ok", "Edited total.ts (+4 -2)"],
  ["ok", "14 tests passed"],
];
const B: Line[] = [
  ["cmd", "add rate limiting to /login"],
  ["out", "Plan: token bucket, 5 per minute"],
  ["ok", "Created limiter.rs"],
  ["ok", "cargo test: ok"],
];
const C: Line[] = [
  ["cmd", "write the migration for invoices"],
  ["out", "Diffing schema.sql"],
  ["ok", "Wrote 0042_invoices.sql"],
  ["ok", "Applied on the dev database"],
];
const D: Line[] = [
  ["cmd", "review the open pull request"],
  ["out", "Checked 9 files"],
  ["out", "2 notes on error handling"],
  ["ok", "Comments posted"],
];

export function Hero() {
  const { cta, os } = useRelease();
  const [ref, vis] = useVisible<HTMLDivElement>();
  return (
    <header className="s-hero" data-sp>
      <div className="s-hero-bg" aria-hidden><Aurora /></div>
      <div className="s-hero-grid" aria-hidden />
      <div className="s-wrap">
        <div className="s-hero-copy">
          <a className="s-pill" href="#demo"><i /> Live demo, right in your browser <ArrowRight size={13} /></a>
          <h1 className="s-title">
            <span className="l"><span style={{ "--i": 0 } as never}>Every coding agent.</span></span>
            <span className="l soft"><span style={{ "--i": 1 } as never}>One calm place.</span></span>
          </h1>
          <p className="s-sub">
            NeuralAgent runs Claude Code, Codex and eleven more agents side by side on your computer. Talk to them with your voice, hand work to a swarm, and answer their questions from your phone, end-to-end encrypted.
          </p>
          <div className="s-cta">
            <Btn href={cta.href} Icon={os === "mac" ? Apple : undefined}>{cta.label}</Btn>
            <Btn href="#demo" variant="glass">Try the live demo</Btn>
          </div>
          {os === "mac" && <div className="s-cmd"><CopyCmd /></div>}
          <p className="s-hero-note">{os === "mac" ? "Or paste it in Terminal: installs without the macOS security prompt." : "For macOS, Windows, Linux and Android."}</p>
        </div>
        <div className="s-stage" data-sp ref={ref}>
          <div className="s-stage-in">
            <Win tabs={["billing-api", "web-shop", "Neural"]} side={SIDE}>
              <div className="s-panes two">
                <AutoPane name="Claude Code" lines={A} active={vis} />
                <AutoPane name="Codex" lines={B} active={vis} delay={500} />
                <AutoPane name="Gemini CLI" lines={C} active={vis} delay={1000} />
                <AutoPane name="Aider" lines={D} active={vis} delay={1500} />
              </div>
            </Win>
          </div>
        </div>
      </div>
    </header>
  );
}

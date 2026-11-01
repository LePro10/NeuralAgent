// Hero: the first half of the signature sequence. Headline, promise, the OS-aware actions, and below them the live app
// window rising into the first screen. The window itself belongs to the Stage (it is the same element: it pins and docks
// as you scroll), so on the sticky layout the hero only reserves its room; on phones and tablets the hero shows the phone
// poster instead (nothing interactive runs inline there).
import "./Hero.css";
import { Apple, Download, Play, Smartphone, SquareTerminal } from "lucide-react";
import { AGENTS, INSTALL_CMD } from "../content";
import { PosterLoop } from "../stage/Devices";
import { HeroRoster } from "../stage/HeroRoster";
import { STICKY } from "../stage/mode";
import { demoHref, posterSrc } from "../stage/world";
import { AgentGlyph, CopyCommand, LinkButton, Reveal, Section, SendToComputer, SlotLines, useMedia, useRelease, type Os } from "../ui";

const NOTE: Record<Os, string> = {
  mac: "macOS 12 or later, Apple silicon and Intel.",
  windows: "Windows, 64-bit installer.",
  linux: "Linux, AppImage and .deb.",
  android: "Android 7.0 or later. The app is the remote: it controls the agents on your computer.",
  ios: "On iPhone the remote is a web app: open it in Safari, then Add to Home Screen.",
  other: "macOS, Windows, Linux and Android.",
};

/** The names under the glyphs: short enough for a 7-column cell, still the names people know. */
const SHORT: Record<string, string> = {
  claude: "Claude Code", codex: "Codex", gemini: "Gemini", antigravity: "Antigravity", cursor: "Cursor", copilot: "Copilot", opencode: "OpenCode",
  grok: "Grok", amp: "Amp", droid: "Droid", kimi: "Kimi", qwen: "Qwen", aider: "Aider",
};

export function Hero() {
  const { cta, os, phone, latest } = useRelease();
  const sticky = useMedia(STICKY);
  const demo = phone ? demoHref("grid", "phone") : demoHref("grid");
  return (
    <Section id="top" path="neuralagent/overview" meta={<span className="na-hide-sm">local first · open source</span>} labelledBy="hero-h" className="hero" bodyClassName="hero__body">
      <div className="hero__top">
        <div className="hero__head">
          <SlotLines as="h1" id="hero-h" className="t-display" lines={["Thirteen coding agents.", "One calm place"]} stop />
          <Reveal as="p" index={3} immediate className="t-lead hero__lead">
            Run Claude Code, Codex and eleven more coding agents side by side on your own computer, and answer their questions from your phone, end-to-end encrypted.
          </Reveal>
        </div>

        {sticky && (
          <Reveal index={5} immediate className="hero__roster">
            <HeroRoster />
          </Reveal>
        )}

        <div className="hero__side">
          <Reveal index={4} immediate className="hero__cta">
            <div className="na-row">
              {phone ? (
                <>
                  <LinkButton variant="primary" size="lg" href={demo} icon={Play}>Try it live</LinkButton>
                  <SendToComputer />
                  {os === "android" && <LinkButton variant="ghost" size="lg" href={cta.href} icon={Smartphone}>Get the Android remote</LinkButton>}
                  {os === "ios" && <LinkButton variant="ghost" size="lg" href="/app/" icon={Smartphone}>Open the web remote</LinkButton>}
                </>
              ) : (
                <>
                  <LinkButton variant="primary" size="lg" href={cta.href} icon={os === "mac" ? Apple : Download}>{cta.label}</LinkButton>
                  <LinkButton variant="secondary" size="lg" href={demo} icon={Play}>Try it live</LinkButton>
                </>
              )}
            </div>
            {/* The version arrives after first paint: its line is reserved from the start, so nothing moves when it does. */}
            <p className="t-label hero__note">
              <span className="hero__ver">{latest ? `v${latest.version}` : ""}</span>
              <span>{NOTE[os]}</span>
            </p>
          </Reveal>
          {os === "mac" && !phone && (
            <Reveal index={5} immediate className="hero__install">
              <p className="t-label hero__installcap">macOS, in Terminal</p>
              <CopyCommand command={INSTALL_CMD} />
            </Reveal>
          )}
        </div>
      </div>

      {!sticky && (
        <div className="hero__poster">
          <PosterLoop
            posters={[posterSrc("phone", "hero"), posterSrc("phone", "permission"), posterSrc("phone", "agents")]}
            alt="The NeuralAgent phone app: Claude Code at work in the billing-api project, then asking for permission, then the inbox."
            href={demoHref("grid", "phone")}
          />
        </div>
      )}

      <div className="hero__agents">
        <p className="hero__cap t-label">
          <b className="t-bright">13 agent CLIs</b>, found on your computer
          <span className="na-hide-sm"> · any other terminal program runs as a plain shell pane</span>
        </p>
        <ul className="hero__row" aria-label="Supported agents">
          {AGENTS.map((a, i) => (
            <Reveal as="li" kind="pane" index={i * 0.4} key={a.id} className="hero__agent">
              <AgentGlyph engine={a.id} size={18} />
              <span className="hero__name" title={a.name}>{SHORT[a.id] ?? a.name}</span>
            </Reveal>
          ))}
          <Reveal as="li" kind="pane" index={AGENTS.length * 0.4} className="hero__agent hero__agent--shell">
            <SquareTerminal size={18} strokeWidth={1.6} aria-hidden />
            <span className="hero__name">Any shell</span>
          </Reveal>
        </ul>
      </div>

      {sticky && <div className="hero__reserve" aria-hidden />}
    </Section>
  );
}

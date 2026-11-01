// Hero: the first half of the signature sequence. One centred promise over a soft aura, the OS-aware actions, the
// thirteen agents as a slow ribbon, and below them the live app window rising into the first screen. The window belongs
// to the Stage (it pins and docks as you scroll), so on the sticky layout the hero only reserves its room; on phones and
// tablets the hero shows the phone poster instead (nothing interactive runs inline there).
// The aura is scroll-linked (`--c` from the shared loop): it drifts up and fades as the window takes over.
import "./Hero.css";
import { useRef } from "react";
import { Apple, ArrowRight, Download, Play, Smartphone, SquareTerminal } from "lucide-react";
import { AGENTS } from "../content";
import { PosterLoop } from "../stage/Devices";
import { STICKY } from "../stage/mode";
import { demoHref, posterSrc } from "../stage/world";
import { AgentGlyph, LinkButton, Reveal, Section, SendToComputer, SlotLines, useMedia, useRelease, useScrollProgress, type Os } from "../ui";

const NOTE: Record<Os, string> = {
  mac: "Free and open source · macOS 12 or later",
  windows: "Free and open source · Windows 64-bit",
  linux: "Free and open source · AppImage and .deb",
  android: "The Android app is the remote for the agents on your computer.",
  ios: "On iPhone the remote is a web app: open it in Safari, then Add to Home Screen.",
  other: "Free and open source · macOS, Windows, Linux and Android",
};

function Ribbon() {
  const items = [...AGENTS.map((a) => ({ id: a.id, name: a.name })), { id: "shell", name: "Any shell" }];
  const set = (hidden: boolean) => (
    <ul className="hero__set" aria-hidden={hidden || undefined} aria-label={hidden ? undefined : "Supported agents"}>
      {items.map((a) => (
        <li key={a.id} className="hero__agent">
          {a.id === "shell" ? <SquareTerminal size={16} strokeWidth={1.6} aria-hidden /> : <AgentGlyph engine={a.id} size={16} />}
          <span>{a.name}</span>
        </li>
      ))}
    </ul>
  );
  return (
    <Reveal index={6} immediate className="hero__ribbon">
      <div className="hero__track">
        {set(false)}
        {set(true)}
      </div>
    </Reveal>
  );
}

export function Hero() {
  const { cta, os, phone, latest } = useRelease();
  const sticky = useMedia(STICKY);
  const aura = useRef<HTMLDivElement>(null);
  useScrollProgress(aura);
  const demo = phone ? demoHref("grid", "phone") : demoHref("grid");
  return (
    <Section id="top" path="neuralagent/overview" meta={<span className="na-hide-sm">local first · open source</span>} labelledBy="hero-h" className="hero" bodyClassName="hero__body">
      <div ref={aura} className="hero__aura" aria-hidden>
        <i className="hero__blob hero__blob--a" />
        <i className="hero__blob hero__blob--b" />
        <i className="hero__blob hero__blob--c" />
        <i className="hero__grid" />
      </div>

      <div className="hero__top">
        <Reveal index={1} immediate>
          <a className="hero__badge" href="/changelog/">
            <span className="hero__pulse" aria-hidden />
            <span>{latest ? `v${latest.version} is out` : "New release"}</span>
            <span className="hero__badgesep" aria-hidden />
            <span className="hero__badgego">What&apos;s new <ArrowRight size={14} strokeWidth={1.8} aria-hidden /></span>
          </a>
        </Reveal>
        <SlotLines as="h1" id="hero-h" className="t-display hero__h" lines={["Thirteen coding agents.", "One calm place"]} stop />
        <Reveal as="p" index={3} immediate className="t-lead hero__lead">
          Run Claude Code, Codex and eleven more side by side on your computer. Answer them from your phone, end-to-end encrypted.
        </Reveal>
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
          <p className="t-label hero__note">{NOTE[os]}</p>
        </Reveal>
      </div>

      <Ribbon />

      {!sticky && (
        <div className="hero__poster">
          <PosterLoop
            posters={[posterSrc("phone", "hero"), posterSrc("phone", "permission"), posterSrc("phone", "agents")]}
            alt="The NeuralAgent phone app: Claude Code at work in the billing-api project, then asking for permission, then the inbox."
            href={demoHref("grid", "phone")}
          />
        </div>
      )}

      {sticky && <div className="hero__reserve" aria-hidden />}
    </Section>
  );
}

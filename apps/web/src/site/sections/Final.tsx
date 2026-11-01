// Final call to action: the brand mark assembles from five panes as the section scrolls into view (BRIEF 2.5d), then the same
// OS-aware download as the hero. Centred, the only centred block on the page. Reduced motion: the mark is already assembled.
import "./Final.css";
import { useRef } from "react";
import { BrandMark } from "../../brand";
import { Apple, Download, Play } from "../content/icons";
import { LinkButton, Reveal, Section, SendToComputer, SlotLines, useRelease, useScrollProgress, type Os } from "../ui";

const NOTE: Record<Os, string> = {
  mac: "macOS 12 or later, Apple silicon and Intel.",
  windows: "Windows, 64-bit installer.",
  linux: "Linux, AppImage and .deb.",
  android: "Android 7.0 or later.",
  ios: "There is no App Store build: the web remote installs from Safari.",
  other: "macOS, Windows, Linux and Android.",
};

export function Final() {
  const { cta, os, phone, latest } = useRelease();
  const stage = useRef<HTMLDivElement>(null);
  useScrollProgress(stage);
  const demo = phone ? "/demo/?view=phone" : "/demo/";
  return (
    <Section id="start" path="start/now" labelledBy="start-h" className="fin" bodyClassName="fin__body">
      <div ref={stage} className="fin__stage">
        <div className="fin__mark" aria-hidden>
          <i className="fin__stem" />
          {/* The five panes' resting places, drawn as hairline outlines: the mark flies into them. */}
          <svg className="fin__slots" viewBox="0 0 64 64">
            <rect x="8" y="8" width="10" height="48" rx="3" />
            <rect x="46" y="8" width="10" height="48" rx="3" />
            <rect x="20" y="9" width="12" height="14" rx="3" />
            <rect x="26" y="25" width="12" height="14" rx="3" />
            <rect x="32" y="41" width="12" height="14" rx="3" />
          </svg>
          <BrandMark size={200} className="fin__svg" />
          <i className="fin__ping" />
        </div>

        <SlotLines as="h2" id="start-h" className="t-h1 fin__h" immediate={false} lines={["Bring the agents", "you already use"]} stop />
        <Reveal as="p" index={2} className="t-lead fin__lead">
          Install it, let it find the CLIs on your computer and open the grid. To use your phone, sign in or scan the QR code.
        </Reveal>
        <Reveal index={3} className="fin__cta">
          {phone ? (
            <>
              <LinkButton variant="primary" size="lg" href={demo} icon={Play}>Try it live</LinkButton>
              <SendToComputer />
            </>
          ) : (
            <>
              <LinkButton variant="primary" size="lg" href={cta.href} icon={os === "mac" ? Apple : Download}>{cta.label}</LinkButton>
              <LinkButton variant="secondary" size="lg" href={demo} icon={Play}>Try it live</LinkButton>
            </>
          )}
        </Reveal>
        <Reveal as="p" index={4} className="t-label fin__note">
          {latest ? `v${latest.version} · ` : ""}{NOTE[os]}
          {phone && os === "android" && <> <a className="na-link" href={cta.href}>Get the Android app</a>.</>}
          {phone && os === "ios" && <> <a className="na-link" href="/app/">Open the web remote</a>.</>}
        </Reveal>
      </div>
    </Section>
  );
}

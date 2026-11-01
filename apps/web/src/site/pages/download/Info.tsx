// The informational sections of /download: first start per system, what you need, the phone remote.
// Facts only (site-audit.md Part B): the Mac app is not notarized, Windows has no code-signing certificate,
// Windows/Linux builds come from CI and are not tested by hand yet, iPhone uses the web remote.
import type { ReactNode } from "react";
import { Icon, LinkButton, Reveal, Section, type Os } from "../../ui";
import { ArrowRight, Apple, Globe, Monitor, Play, Smartphone, Terminal, type LucideIcon } from "../icons";

/** A key or button label as the system shows it. */
const Btn = ({ children }: { children: ReactNode }) => <b className="dl-btn">{children}</b>;

const STEPS: { os: Os; Icon: LucideIcon; title: string; note: string; steps: ReactNode[] }[] = [
  {
    os: "mac", Icon: Apple, title: "macOS", note: "The app is not notarized by Apple yet.",
    steps: [
      <>Install with the Terminal command at the top of this page: no prompt at all. Or open the .dmg and drag NeuralAgent to Applications.</>,
      <>If macOS refuses the first start, open System Settings, then Privacy &amp; Security, scroll down and choose <Btn>Open Anyway</Btn>.</>,
      <>From then on the app updates itself.</>,
    ],
  },
  {
    os: "windows", Icon: Monitor, title: "Windows", note: "The installer is not code-signed yet.",
    steps: [
      <>Run the setup .exe.</>,
      <>If SmartScreen says Windows protected your PC, choose <Btn>More info</Btn>, then <Btn>Run anyway</Btn>.</>,
    ],
  },
  {
    os: "linux", Icon: Terminal, title: "Linux", note: "AppImage or .deb, built automatically.",
    steps: [
      <>AppImage: make it executable with <code className="na-code">chmod +x</code>, then start it.</>,
      <>Debian or Ubuntu: install the .deb with <code className="na-code">sudo apt install ./file.deb</code>.</>,
    ],
  },
  {
    os: "android", Icon: Smartphone, title: "Android", note: "A signed APK, installed from your browser.",
    steps: [
      <>Open the download on the phone. When Android asks, allow installs from your browser.</>,
      <>The app tells you when a newer APK is out.</>,
    ],
  },
  {
    os: "ios", Icon: Globe, title: "iPhone", note: "No App Store build: the web remote is the app.",
    steps: [
      <>Open <a className="na-link" href="/app/">agent.neuralhub.dev/app</a> in Safari.</>,
      <>Tap Share, then <Btn>Add to Home Screen</Btn>.</>,
      <>Open it from the Home Screen. Notifications (Web Push) work from there.</>,
    ],
  },
];

export function FirstStart({ os }: { os: Os }) {
  return (
    <Section id="first-start" path="download/first-start" labelledBy="dl-first-h" tight>
      <div className="na-head">
        <h2 id="dl-first-h" className="t-h2">The first start.</h2>
        <p className="t-lead">NeuralAgent is not notarized by Apple and the Windows installer is not code-signed, so both systems ask once. This is what you will see.</p>
      </div>
      <ol className="dl-steps">
        {STEPS.map((s, i) => (
          <Reveal as="li" kind="pane" index={Math.min(i, 3) * 0.6} key={s.os} className="dl-step" data-mine={s.os === os ? "" : undefined}>
            <div className="dl-step__head">
              <Icon as={s.Icon} size="lg" />
              <div>
                <h3 className="dl-step__title">{s.title}{s.os === os && <em className="dl-you">your system</em>}</h3>
                <p className="dl-step__note">{s.note}</p>
              </div>
            </div>
            <ol className="dl-ol">{s.steps.map((t, j) => <li key={j}>{t}</li>)}</ol>
          </Reveal>
        ))}
      </ol>
    </Section>
  );
}

const NEEDS: [string, ReactNode][] = [
  ["macOS", <>macOS 12 or later, Apple silicon and Intel. The daily-driven build.</>],
  ["Windows", <>64-bit Windows. Built automatically, not tested by hand yet.</>],
  ["Linux", <>x86_64, as an AppImage or a .deb. Built automatically, not tested by hand yet.</>],
  ["Android", <>Android 7.0 or later. Tested in an emulator; real-device checks are still pending.</>],
  ["iPhone", <>Safari with Add to Home Screen, through the web remote. No App Store build.</>],
  ["Agents", <>The coding agents are installed separately (one click inside NeuralAgent) and use your own subscriptions or API keys.</>],
  ["Account", <>None for the desktop app. Sign in with Google or GitHub only to use the phone remote.</>],
  ["Voice", <>About 630 MB of speech models, downloaded when you turn voice on. Verified on macOS.</>],
];

export function Needs() {
  return (
    <Section id="needs" path="download/requirements" labelledBy="dl-needs-h" tight>
      <div className="na-head">
        <h2 id="dl-needs-h" className="t-h2">What you need.</h2>
      </div>
      <dl className="dl-needs">
        {NEEDS.map(([k, v]) => (
          <div key={k} className="dl-need"><dt className="t-label t-bright">{k}</dt><dd>{v}</dd></div>
        ))}
      </dl>
    </Section>
  );
}

export function PhoneRemote() {
  return (
    <Section id="phone" path="download/phone-remote" labelledBy="dl-phone-h" tight>
      <div className="na-split dl-phone-split">
        <div className="na-stack">
          <h2 id="dl-phone-h" className="t-h2">Your phone is the remote.</h2>
          <p className="t-lead">Install the desktop app, then connect a phone: the Android app, or the web remote on an iPhone or in any browser.</p>
          <div className="na-row">
            <LinkButton variant="secondary" size="md" href="/demo/?view=phone" icon={Play}>Try the phone app live</LinkButton>
            <LinkButton variant="ghost" size="md" href="/app/" icon={Globe}>Open the web remote</LinkButton>
          </div>
        </div>
        <ol className="dl-ol dl-ol--big">
          <li><b className="t-bright">Sign in</b> with Google or GitHub on the computer and on the phone. The first time, you ask for access and it is approved.</li>
          <li><b className="t-bright">Or scan the QR code</b> the computer shows. It also pins the computer&rsquo;s key, so a swapped key is noticed.</li>
          <li><b className="t-bright">Answer from anywhere.</b> Everything your agents show travels end-to-end encrypted. The relay passes sealed messages it cannot read. <a className="na-link dl-nowrap" href="/#security">How it is sealed <Icon as={ArrowRight} size="xs" className="dl-inline-arrow" /></a></li>
        </ol>
      </div>
    </Section>
  );
}

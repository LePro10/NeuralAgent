// 404: a quiet terminal pane in "command not found" style. The path you asked for is echoed, the closest known page is
// guessed (waiting mark), four real links follow. No single-key shortcuts (WCAG 2.1.4: they would fire while a screen reader
// user types). Tiny: no libraries, one effect.
import "./notfound.css";
import { useEffect, useMemo, useState } from "react";
import { Icon, LinkButton, PaneTitle, Reveal, Section, SlotLines } from "../../ui";
import { ArrowRight, Play } from "../icons";
import { Page } from "../Page";

interface Hit { href: string; label: string; note: string }
const BASE: Hit[] = [
  { href: "/", label: "Home", note: "your agents in one grid of panes" },
  { href: "/demo/", label: "Live demo", note: "the real app, in your browser" },
  { href: "/download/", label: "Download", note: "macOS, Windows, Linux, Android" },
  { href: "/changelog/", label: "Changelog", note: "every release in plain words" },
];
/** Pages that exist but are not in the four suggestions: still worth a guess. */
const EXTRA: Hit[] = [
  { href: "/privacy/", label: "Privacy", note: "what we do with data" },
  { href: "/terms/", label: "Terms", note: "the rules" },
  { href: "/imprint/", label: "Imprint", note: "who runs this" },
  { href: "/app/", label: "Web remote", note: "your agents, from a browser" },
];

/** Edit distance, small strings only. */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length]!;
}

/** The known page the path most likely meant (`/downlaod`, `/change-log`, `/demo.html`), or null. */
function guess(path: string): Hit | null {
  const word = (path.split("/").filter(Boolean)[0] ?? "").toLowerCase().replace(/\.(html?|php)$/, "").replace(/[-_]/g, "");
  if (word.length < 3) return null;
  let best: { hit: Hit; d: number } | null = null;
  for (const hit of [...BASE, ...EXTRA]) {
    const name = hit.href.replace(/\//g, "");
    if (!name) continue; // "/" has no name to mistype
    const d = word.startsWith(name) || name.startsWith(word) ? 1 : distance(word, name);
    if (d <= Math.max(1, Math.floor(name.length / 4)) && (!best || d < best.d)) best = { hit, d };
  }
  return best?.hit ?? null;
}

const shorten = (s: string) => (s.length > 64 ? `${s.slice(0, 61)}…` : s);

export function NotFound() {
  const path = shorten(decodeSafe(location.pathname) + (location.search ? "?…" : ""));
  const command = `open ${path}`;
  const near = useMemo(() => guess(location.pathname), []);
  const hits = useMemo(() => (near ? [near, ...[...BASE, ...EXTRA].filter((h) => h.href !== near.href).slice(0, BASE.some((b) => b.href === near.href) ? 3 : 3)] : BASE).slice(0, 5), [near]);

  // phase 0 typing · 1 error line · 2 suggestions · 3 prompt. Under reduced motion everything is there at once.
  const [typed, setTyped] = useState(0);
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setTyped(command.length);
      return setPhase(3);
    }
    const timers: number[] = [];
    let i = 0;
    const tick = () => {
      setTyped(++i);
      if (i < command.length) timers.push(window.setTimeout(tick, 26 + Math.random() * 30));
      else {
        timers.push(window.setTimeout(() => setPhase(1), 260));
        timers.push(window.setTimeout(() => setPhase(2), 700));
        timers.push(window.setTimeout(() => setPhase(3), 1250));
      }
    };
    timers.push(window.setTimeout(tick, 450));
    return () => timers.forEach(clearTimeout);
  }, [command]);

  return (
    <Page>
      <Section id="top" path="error/404" status="error" meta={<span className="na-hide-sm">not found</span>} label="Page not found" className="pg-first" bodyClassName="pg-head nf-head">
        <div className="pg-title nf-title">
          <SlotLines as="h1" className="t-h1" lines={["Page not found"]} stop />
          <Reveal as="p" index={2} immediate className="t-lead pg-lead">
            Nothing lives at this address. The link may have moved or have a typo.
          </Reveal>
          <Reveal index={3} immediate className="na-row">
            <LinkButton variant="primary" size="lg" href="/" arrow="go">Back to the start</LinkButton>
            <LinkButton variant="secondary" size="lg" href="/demo/" icon={Play}>Try it live</LinkButton>
          </Reveal>
        </div>

        <Reveal kind="pane" index={3} immediate className="na-pane nf-term">
          <PaneTitle status={phase >= 1 ? "error" : "working"} label="shell/neuralagent" meta={<span className="na-hide-sm">exit 127</span>} />
          <div className="nf-term__body" data-phase={phase}>
            <p className="nf-line nf-line--cmd" aria-hidden>
              <span className="nf-prompt">~ $</span> {command.slice(0, typed)}
              {phase < 3 && <span className="nf-caret" />}
            </p>
            <h2 className="na-sr">Where to go instead</h2>
            <p className="na-sr">Nothing lives at {path}.</p>
            <p className="nf-line nf-line--err" aria-hidden data-show={phase >= 1 ? "" : undefined}>open: {path}: no such page</p>

            <div className="nf-hits" data-show={phase >= 2 ? "" : undefined}>
              <p className="nf-line nf-line--dim" aria-hidden>{near ? <>did you mean <b>{near.href}</b>?</> : "try one of these:"}</p>
              <ol>
                {hits.map((h, i) => (
                  <li key={h.href} style={{ "--i": i } as React.CSSProperties}>
                    <a href={h.href} data-guess={h === near ? "" : undefined}>
                      <span className="nf-hit__n" aria-hidden>{String(i + 1).padStart(2, "0")}</span>
                      <span className="nf-hit__path">{h.href}</span>
                      <span className="nf-hit__note"><b>{h.label}</b><span>{h.note}</span></span>
                      <Icon as={ArrowRight} size="sm" className="nf-hit__go" />
                    </a>
                  </li>
                ))}
              </ol>
            </div>

            <p className="nf-line nf-line--cmd nf-line--idle" aria-hidden data-show={phase >= 3 ? "" : undefined}>
              <span className="nf-prompt">~ $</span> <span className="nf-caret nf-caret--live" />
            </p>
          </div>
        </Reveal>
      </Section>
    </Page>
  );
}

function decodeSafe(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// Platforms and download. Links come from /api/releases/latest (`downloads` keys: mac, mac-intel, windows, linux, linux-deb, android),
// never from file names. The visitor's system is highlighted; phones also get "Send to my computer".
import "./Platforms.css";
import { INSTALL_CMD, GITHUB } from "../content";
import { PLATFORMS, REQUIREMENTS, type Platform } from "../content/platforms";
import { ArrowRight, Download, History, Smartphone, Terminal } from "../content/icons";
import { ActivityMark, CopyCommand, Fold, GitHubIcon, Icon, LinkButton, PaneTitle, Reveal, Section, SendToComputer, shortDate, SlotLines, useMedia, useRelease, type Os } from "../ui";

const base = (url?: string) => (url ? decodeURIComponent(url.split("/").pop() ?? "") : "");

const DESKTOP: Platform["id"][] = ["mac", "windows", "linux"];

function Row({ p, mine, downloads, i, plain }: { p: Platform; mine: boolean; downloads: Record<string, string> | undefined; i: number; plain?: boolean }) {
  const body = (
    <>
      <div className="plt__name">
        <Icon as={p.icon} size="xl" className="plt__ico" />
        <div>
          <h3>{p.name}</h3>
          {mine && <span className="plt__you"><ActivityMark kind="working" size="sm" /> Your system</span>}
        </div>
      </div>
      <div className="plt__info">
        <p className="plt__detail">{p.detail}</p>
        {p.notes.map((n) => (
          <p key={n} className="plt__note">{n}</p>
        ))}
      </div>
      <div className="plt__act">
        {p.links.map((l, k) => {
          const url = downloads?.[l.kind];
          return (
            <div key={l.kind} className="plt__dl">
              <LinkButton variant={mine && k === 0 ? "primary" : "secondary"} size="md" href={url ?? "/download/"} icon={Download}>{l.label}</LinkButton>
              <span className="plt__file t-label">{base(url) || " "}</span>
            </div>
          );
        })}
        {p.id === "ios" && (
          <div className="plt__dl">
            <LinkButton variant={mine ? "primary" : "secondary"} size="md" href="/app/" icon={Smartphone} arrow="go">Open the web remote</LinkButton>
            <span className="plt__file t-label">agent.neuralhub.dev/app</span>
          </div>
        )}
        {p.id === "mac" && (
          <div className="plt__cmd">
            <CopyCommand command={INSTALL_CMD} />
            <span className="plt__how t-label">Terminal install: picks Apple silicon or Intel, installs into Applications and opens the app.</span>
          </div>
        )}
      </div>
    </>
  );
  // Rows inside a closed fold are plain list items: nothing to reveal while hidden.
  if (plain) return <li className="plt__row" data-mine={mine ? "" : undefined} data-id={p.id}>{body}</li>;
  return <Reveal as="li" kind="pane" index={i * 0.6} className="plt__row" data-mine={mine ? "" : undefined} data-id={p.id}>{body}</Reveal>;
}

export function Platforms() {
  const { latest, status, os, phone } = useRelease();
  const wide = useMedia("(min-width: 900px)");
  const mineId = (o: Os) => (o === "other" ? "" : o);
  const rows = (list: Platform[], plain?: boolean) => list.map((p, i) => <Row key={p.id} p={p} mine={mineId(os) === p.id} downloads={latest?.downloads} i={i} plain={plain} />);
  // Below 900px only the kind of system you are on stays open: a phone sees the two remote apps, a computer the three installers.
  const primary = PLATFORMS.filter((p) => (DESKTOP.includes(p.id) ? !phone : phone));
  const rest = PLATFORMS.filter((p) => !primary.includes(p));
  return (
    <Section
      id="download"
      path="download/platforms"
      meta={latest ? <span className="t-num">v{latest.version} · {shortDate(latest.pub_date)}</span> : <span>{status === "offline" ? "relay offline" : "releases/latest"}</span>}
      labelledBy="download-h"
    >
      <div className="na-head">
        <SlotLines as="h2" className="t-h2" immediate={false} id="download-h" lines={["Desktop on your computer.", "Remote on your phone"]} stop />
        <Reveal as="p" index={2} className="t-lead">
          {phone ? "You cannot install the desktop app on a phone. Send the link to your computer, then use this phone as the remote." : "The desktop app runs on macOS, Windows and Linux. The remote runs on Android and in any browser, including Safari on iPhone."}
        </Reveal>
        {phone && <Reveal index={3}><SendToComputer variant="primary" /></Reveal>}
      </div>

      {wide ? (
        <ul className="plt__list" aria-label="Platforms">
          {rows(PLATFORMS)}
        </ul>
      ) : (
        <>
          <ul className="plt__list" aria-label={phone ? "Remote apps" : "Desktop installers"}>
            {rows(primary)}
          </ul>
          <Fold title={phone ? "Installers for your computer" : "Remote apps for your phone"} wide={false} className="plt__rest">
            <ul className="plt__list plt__list--in" aria-label={phone ? "Desktop installers" : "Remote apps"}>
              {rows(rest, true)}
            </ul>
          </Fold>
        </>
      )}
      {status === "offline" && <p className="plt__off t-label">The release list did not load. The download page lists every installer.</p>}

      <div className="plt__more">
        <Reveal className="plt__reqs-wrap">
          <Fold title="What you need" wide={wide} className="plt__reqs">
            <dl className="plt__dl2">
              {REQUIREMENTS.map((r) => (
                <div key={r.key}><dt>{r.key}</dt><dd>{r.value}</dd></div>
              ))}
            </dl>
          </Fold>
        </Reveal>
        <Reveal kind="pane" index={1} className="plt__links na-pane">
          <PaneTitle status="idle" label="download/more" />
          <a href="/download/" className="plt__lnk"><Icon as={Download} size="md" /><span><b>All installers</b><i>Every platform on one page.</i></span><Icon as={ArrowRight} size="md" className="plt__go" /></a>
          <a href="/changelog/" className="plt__lnk"><Icon as={History} size="md" /><span><b>Changelog</b><i>What changed in each release.</i></span><Icon as={ArrowRight} size="md" className="plt__go" /></a>
          <a href={GITHUB} target="_blank" rel="noopener noreferrer" className="plt__lnk"><GitHubIcon size={18} /><span><b>Source on GitHub</b><i>Open source, AGPL-3.0.</i></span><Icon as={ArrowRight} size="md" className="plt__go" /></a>
          <a href="/demo/" className="plt__lnk"><Icon as={Terminal} size="md" /><span><b>Try it live first</b><i>The real app in your browser, no install.</i></span><Icon as={ArrowRight} size="md" className="plt__go" /></a>
        </Reveal>
      </div>
    </Section>
  );
}


// Download, compact: one tile per system, the visitor's own lit and first in line for the click. Links come from
// /api/releases/latest (`downloads` keys: mac, mac-intel, windows, linux, linux-deb, android), never from file names.
// Every detail (first start, notarization, requirements) lives on /download/.
import "./Platforms.css";
import { INSTALL_CMD } from "../content";
import { PLATFORMS, type Platform } from "../content/platforms";
import { ArrowRight, Download, Smartphone } from "../content/icons";
import { ActivityMark, CopyCommand, Icon, Reveal, Section, SendToComputer, shortDate, SlotLines, useRelease } from "../ui";

function Tile({ p, mine, downloads, i }: { p: Platform; mine: boolean; downloads: Record<string, string> | undefined; i: number }) {
  const first = p.links[0];
  const href = p.id === "ios" ? "/app/" : (first && downloads?.[first.kind]) || "/download/";
  const action = p.id === "ios" ? "Open web remote" : p.id === "android" ? "Get the APK" : "Download";
  return (
    <Reveal as="li" kind="pane" index={i * 0.5} className="plt" data-mine={mine ? "" : undefined}>
      <a className="plt__a" href={href}>
        <span className="plt__top">
          <Icon as={p.icon} size="xl" className="plt__ico" />
          {mine && <span className="plt__you t-label"><ActivityMark kind="working" size="sm" /> You</span>}
        </span>
        <span className="plt__name">{p.name}</span>
        <span className="plt__detail">{p.detail}</span>
        <span className="plt__go">
          <Icon as={p.id === "ios" || p.id === "android" ? Smartphone : Download} size="sm" /> {action}
        </span>
      </a>
    </Reveal>
  );
}

export function Platforms() {
  const { latest, status, os, phone } = useRelease();
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
          {phone ? "Install the desktop app on your computer, then use this phone as the remote." : "Free and open source. No account needed for the desktop app."}
        </Reveal>
        {phone && <Reveal index={3}><SendToComputer variant="primary" /></Reveal>}
      </div>

      <ul className="plt__grid" aria-label="Platforms">
        {PLATFORMS.map((p, i) => (
          <Tile key={p.id} p={p} mine={os === p.id} downloads={latest?.downloads} i={i} />
        ))}
      </ul>

      {os === "mac" && !phone && (
        <Reveal index={1} className="plt__cmd">
          <span className="t-label">or in Terminal</span>
          <CopyCommand command={INSTALL_CMD} />
        </Reveal>
      )}

      <Reveal className="na-more">
        <a className="na-morelink" href="/download/">
          All installers, first start and requirements <Icon as={ArrowRight} size="sm" />
        </a>
      </Reveal>
    </Section>
  );
}

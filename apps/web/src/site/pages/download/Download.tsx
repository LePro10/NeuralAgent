// /download: the visitor's own build first (version and date from /api/releases/latest), every other build,
// the macOS one-liner, honest first-start steps, requirements, the phone remote. Loading, offline and no-build states.
import "./download.css";
import type { ReactNode } from "react";
import { GITHUB, INSTALL_CMD, MAIL } from "../../content";
import { CopyCommand, Icon, LinkButton, PaneTitle, Reveal, Section, SendToComputer, shortDate, SlotLines, useRelease, type Os } from "../../ui";
import { ArrowRight, ArrowUpRight, Download as DownloadIcon, Globe, Play, RotateCw } from "../icons";
import { Page } from "../Page";
import { fileName, KINDS, listKinds, primaryKind, useMacArch, WEB_REMOTE, type MacArch } from "./platforms";
import { FirstStart, Needs, PhoneRemote } from "./Info";

type Rel = ReturnType<typeof useRelease>;
const SLUG: Record<Os, string> = { mac: "macos", windows: "windows", linux: "linux", android: "android", ios: "iphone", other: "all-builds" };
const DEB_HINT = "sudo apt install ./NeuralAgent_*.deb";
const SCRIPT_URL = `${GITHUB}/blob/main/apps/web/public/install.sh`;

export function Download() {
  const rel = useRelease();
  const arch = useMacArch();
  const { latest, status, os } = rel;
  const downloads = latest?.downloads ?? {};
  const kinds = listKinds(downloads);
  const main = status === "ok" ? primaryKind(os, arch, downloads) : null;

  return (
    <Page>
      <Section id="top" path={`download/${SLUG[os]}`} meta={latest ? <span className="t-num">v{latest.version}</span> : undefined} label="Download NeuralAgent" className="pg-first" bodyClassName="pg-head dl-head">
        <div className="pg-title">
          <SlotLines as="h1" className="t-h1" lines={["Download", "NeuralAgent"]} stop />
          <Reveal as="p" index={3} immediate className="t-lead pg-lead">
            The app updates itself and your agents keep running while it does. The computer needs no account: you sign in only to use your phone as the remote.
          </Reveal>
          <Reveal index={4} immediate className="dl-aux">
            <LinkButton variant="ghost" href={rel.phone ? "/demo/?view=phone" : "/demo/"} icon={Play}>Try it live first</LinkButton>
            <LinkButton variant="ghost" href={GITHUB}>Source on GitHub</LinkButton>
          </Reveal>
        </div>
        <Reveal kind="pane" index={4} immediate className="dl-primary-wrap">
          {status === "loading" ? <Skeleton /> : status === "ok" && kinds.length > 0 && latest ? <Primary rel={rel} main={main} arch={arch} /> : <Fallback empty={status === "ok"} />}
        </Reveal>
      </Section>

      {status === "ok" && latest && kinds.length > 0 && (
        <Section id="all" path="download/all-builds" meta={<span className="t-num na-hide-sm">{kinds.length + 1} ways in</span>} labelledBy="dl-all-h" tight>
          <div className="na-head">
            <h2 id="dl-all-h" className="t-h2">Every build of <span className="t-num">v{latest.version}</span>.</h2>
            <p className="t-lead">Installers come straight from agent.neuralhub.dev, {shortDate(latest.pub_date)}. Your own system is marked.</p>
          </div>
          <ul className="dl-rows">
            <li className="dl-row dl-row--head t-label na-hide-sm" aria-hidden>
              <span>Platform</span><span>Build</span><span>File</span><span />
            </li>
            {kinds.map((k) => {
              const href = latest.downloads[k.kind]!;
              const mine = main === k.kind || (k.os === os && os !== "other" && !main);
              return (
                <li key={k.kind}>
                  <a className="dl-row" href={href} data-mine={mine ? "" : undefined}>
                    <span className="dl-row__name"><Icon as={k.Icon} size="md" />{k.name}{mine && <em className="dl-you">your system</em>}</span>
                    <span className="dl-row__detail">{k.detail}</span>
                    <code className="dl-row__file">{fileName(href)}</code>
                    <Icon as={DownloadIcon} size="md" className="dl-row__go" />
                  </a>
                </li>
              );
            })}
            <li>
              <a className="dl-row" href={WEB_REMOTE.href} data-mine={os === "ios" ? "" : undefined}>
                <span className="dl-row__name"><Icon as={WEB_REMOTE.Icon} size="md" />{WEB_REMOTE.name}{os === "ios" && <em className="dl-you">your system</em>}</span>
                <span className="dl-row__detail">{WEB_REMOTE.detail}</span>
                <code className="dl-row__file">agent.neuralhub.dev/app/</code>
                <Icon as={ArrowUpRight} size="md" className="dl-row__go" />
              </a>
            </li>
          </ul>
          <p className="pg-note dl-stable">
            Scripts: <code>/download/latest/{"{kind}"}</code> always points at the newest build. Kinds: {KINDS.map((k, i) => <span key={k.kind}>{i > 0 && ", "}<code>{k.kind}</code></span>)}.
          </p>
        </Section>
      )}

      <FirstStart os={os} />
      <Needs />
      <PhoneRemote />

      <Section id="more" path="download/more" label="More" flush>
        <ul className="na-cells pg-links">
          <li className="na-cell"><a className="pg-link" href={latest ? `/changelog/#v${latest.version}` : "/changelog/"}><span><b>Release notes</b><span>{latest ? `What changed in v${latest.version}, and before.` : "What changed, release by release."}</span></span><Icon as={ArrowRight} size="md" /></a></li>
          <li className="na-cell"><a className="pg-link" href={GITHUB} target="_blank" rel="noopener noreferrer"><span><b>Source code</b><span>Open source under AGPL-3.0. Read it, fork it, suggest changes.</span></span><Icon as={ArrowUpRight} size="md" /></a></li>
          <li className="na-cell"><a className="pg-link" href={`mailto:${MAIL}`}><span><b>Contact</b><span>{MAIL}</span></span><Icon as={ArrowUpRight} size="md" /></a></li>
        </ul>
      </Section>
    </Page>
  );
}

/** Same shape as the loaded pane, so the page does not jump when the manifest arrives. */
function Skeleton() {
  return (
    <div className="na-pane dl-primary" aria-busy="true" aria-live="polite">
      <PaneTitle status="working" label="release/latest" meta="checking" />
      <div className="dl-primary__body">
        <span className="na-sr">Checking the latest release…</span>
        <div className="pg-skel dl-skel-btn" />
        <div className="pg-skel dl-skel-line" />
        <div className="dl-sub"><div className="pg-skel dl-skel-line dl-skel-line--short" /><div className="pg-skel dl-skel-cmd" /></div>
      </div>
    </div>
  );
}

/** The release server did not answer (`empty` false) or it answered with no builds (`empty` true). Only real alternatives. */
function Fallback({ empty }: { empty: boolean }) {
  return (
    <div className="na-pane dl-primary" role="alert">
      <PaneTitle status="error" label={empty ? "release/empty" : "release/unreachable"} />
      <div className="dl-primary__body">
        <h2 className="t-h3">{empty ? "No builds are published yet." : "The release server did not answer."}</h2>
        <p className="t-small">
          {empty ? "Builds appear here as soon as a release is published. Meanwhile the web remote runs in any browser." : "Check your connection and try again. Until the list loads, these links still work:"}
        </p>
        {!empty && (
          <>
            <div className="dl-chips">
              {KINDS.map((k) => (
                <a key={k.kind} className="dl-chip" href={`/download/latest/${k.kind}`}>
                  <Icon as={k.Icon} size="sm" />{k.name} <span>{k.detail.split(" · ")[0]!.replace(", Android 7.0 or later", "")}</span>
                </a>
              ))}
            </div>
            <div className="dl-sub">
              <p className="t-small"><strong>macOS, in Terminal</strong></p>
              <CopyCommand command={INSTALL_CMD} />
            </div>
          </>
        )}
        <div className="na-row">
          {!empty && <LinkButton variant="primary" size="md" href={location.pathname} icon={RotateCw} onClick={(e) => { e.preventDefault(); location.reload(); }}>Try again</LinkButton>}
          <LinkButton variant="secondary" size="md" href="/app/" icon={Globe}>Open the web remote</LinkButton>
        </div>
      </div>
    </div>
  );
}

/** The visitor's own download with everything they need for the first start. */
function Primary({ rel, main, arch }: { rel: Rel; main: string | null; arch: MacArch }) {
  const { latest, os, phone } = rel;
  const downloads = latest!.downloads;
  const kind = KINDS.find((k) => k.kind === main);
  const href = main ? downloads[main] : undefined;
  const file = href ? fileName(href) : "";
  const otherMac = main === "mac" ? "mac-intel" : main === "mac-intel" ? "mac" : null;
  const label = os === "android" ? "Get the Android app" : os === "other" ? "Download" : `Download for ${rel.osLabel}`;

  let sub: ReactNode = null;
  if (os === "mac" && main) {
    sub = (
      <div className="dl-sub">
        <p className="t-small"><strong>Or in Terminal</strong>, without the macOS security prompt:</p>
        <CopyCommand command={INSTALL_CMD} />
        <p className="pg-note">Picks Apple silicon or Intel, installs into /Applications, clears the quarantine flag and opens the app. <a href={SCRIPT_URL} target="_blank" rel="noopener noreferrer">Read the script first.</a></p>
      </div>
    );
  } else if (os === "linux" && main) {
    sub = (
      <div className="dl-sub">
        <p className="t-small"><strong>{main === "linux" ? "Make it executable and start it" : "Install the package"}</strong>:</p>
        <CopyCommand command={main === "linux" ? `chmod +x ${file} && ./${file}` : DEB_HINT} />
        {main === "linux" && downloads["linux-deb"] && <p className="pg-note">Debian or Ubuntu? <a href={downloads["linux-deb"]}>Get the .deb</a> and run <code>{DEB_HINT}</code>.</p>}
      </div>
    );
  } else if (os === "windows" && main) {
    sub = (
      <div className="dl-sub">
        <p className="t-small">The installer is not code-signed yet, so Windows SmartScreen may warn on first start. Choose <b className="t-bright">More info</b>, then <b className="t-bright">Run anyway</b>. <a className="na-link" href="#first-start">Details</a></p>
      </div>
    );
  } else if (os === "android" && main) {
    sub = (
      <div className="dl-sub">
        <p className="t-small">Android asks once to allow installs from your browser. The app tells you when a newer APK is out.</p>
      </div>
    );
  } else if (os === "ios") {
    sub = (
      <div className="dl-sub">
        <p className="t-small">There is no App Store build. In Safari, open the web remote, tap Share, then <b className="t-bright">Add to Home Screen</b>. Notifications work from the Home Screen.</p>
      </div>
    );
  }

  return (
    <div className="na-pane dl-primary">
      <PaneTitle status="idle" label={`release/v${latest!.version}`} meta={<span className="t-num">{shortDate(latest!.pub_date)}</span>} />
      <div className="dl-primary__body">
        {os === "ios" ? (
          <LinkButton variant="primary" size="lg" href="/app/" icon={Globe} className="dl-cta">Open the web remote</LinkButton>
        ) : href && kind ? (
          <>
            <LinkButton variant="primary" size="lg" href={href} icon={DownloadIcon} className="dl-cta">{label}</LinkButton>
            <p className="pg-note dl-file"><span>{file}</span><span>{kind.detail}</span></p>
            {otherMac && downloads[otherMac] && (
              <p className="pg-note">
                {otherMac === "mac-intel" ? "Intel Mac? " : "Apple silicon Mac? "}
                <a href={downloads[otherMac]}>Get the {otherMac === "mac-intel" ? "Intel" : "Apple silicon"} build</a>.
                {arch === "unknown" && " Browsers cannot tell the two apart."}
              </p>
            )}
          </>
        ) : (
          <>
            <h2 className="t-h3">{os === "other" ? "Pick your system below." : `No ${rel.osLabel} build in this release.`}</h2>
            <p className="t-small">Every build of this release is listed under the fold.</p>
          </>
        )}
        {sub}
        {phone && (
          <div className="na-row dl-phone">
            <SendToComputer size="md" variant="secondary" />
            <LinkButton variant="secondary" size="md" href="/demo/?view=phone" icon={Play}>Try it live</LinkButton>
          </div>
        )}
        <p className="pg-note"><a href={`/changelog/#v${latest!.version}`}>What's new in v{latest!.version}</a></p>
      </div>
    </div>
  );
}

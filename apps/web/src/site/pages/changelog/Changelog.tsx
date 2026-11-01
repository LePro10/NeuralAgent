// /changelog: a release timeline from CHANGELOG.md (virtual:changelog). The newest release is open, older ones are rows
// that open in place, the version index on the left follows the scroll. Anchors: `#v0.3.4` (also `#0.3.4`, the old `#v0-3-4`, `#next`).
import "./changelog.css";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { ActivityMark, Icon, LinkButton, PaneTitle, Reveal, Section, shortDate, SlotLines, useActiveSection, useCopy, useRelease, type ActivityKind } from "../../ui";
import { Check, ChevronDown, ChevronsDownUp, ChevronsUpDown, Link2, Plus, TrendingUp, Wrench, type LucideIcon } from "../icons";
import { Page } from "../Page";
import { Inline } from "./Inline";
import { autoTitle, count, fromHash, groupMeta, idOf, ids, latest, list, next, released, type Release } from "./model";

const GROUP_ICON: Record<string, LucideIcon> = { New: Plus, Improved: TrendingUp, Fixed: Wrench };
const groupIcon = (title: string) => GROUP_ICON[title] ?? TrendingUp;
const markOf = (r: Release): ActivityKind => (r.unreleased ? "working" : r === latest ? "done" : "idle");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const scrollToId = (id: string) =>
  requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }));

export function Changelog() {
  const [open, setOpen] = useState<Set<string>>(() => {
    const s = new Set<string>(latest ? [idOf(latest)] : []);
    const hit = fromHash(location.hash);
    if (hit) s.add(hit);
    return s;
  });
  const toggle = (id: string) => setOpen((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  /** Open a release, put it in the URL and scroll to it (index links, hash links). */
  const go = useCallback((id: string) => {
    setOpen((s) => (s.has(id) ? s : new Set(s).add(id)));
    history.replaceState(null, "", `#${id}`);
    scrollToId(id);
  }, []);

  useEffect(() => {
    const hit = fromHash(location.hash);
    if (hit) {
      if (location.hash !== `#${hit}`) history.replaceState(null, "", `#${hit}`); // old anchor forms become the current one
      // The browser tried to scroll before React rendered; do it again once the layout has settled.
      const go = () => document.getElementById(hit)?.scrollIntoView({ block: "start", behavior: "auto" });
      requestAnimationFrame(() => { go(); setTimeout(go, 350); });
    }
    const onHash = () => {
      const id = fromHash(location.hash);
      if (id) go(id);
    };
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, [go]);

  const active = useActiveSection(ids);
  const [current, setCurrent] = useState(ids[0] ?? "");
  useEffect(() => { if (active) setCurrent(active); }, [active]);

  const allOpen = list.every((r) => open.has(idOf(r)));
  const queued = next ? count(next) : 0;

  return (
    <Page>
      <Section id="top" path="changelog/releases" meta={<span className="t-num">{plural(released.length, "release")}</span>} label="Changelog" className="pg-first" bodyClassName="pg-head cl-head">
        <div className="pg-title">
          <SlotLines as="h1" className="t-h1" lines={["What’s new"]} stop />
          <Reveal as="p" index={2} immediate className="t-lead pg-lead">
            Every release in plain words. The desktop app updates itself and shows these notes when a new version is ready; <strong>your agents keep running</strong> while it does.
          </Reveal>
        </div>
        {latest && (
          <Reveal kind="pane" index={3} immediate className="na-pane cl-latest">
            <PaneTitle status="done" label="release/latest" />
            <div className="cl-latest__body">
              <div className="cl-latest__row">
                <span className="cl-latest__ver t-num">v{latest.version}</span>
                <time className="t-label" dateTime={latest.date ?? undefined}>{latest.date ? shortDate(latest.date) : ""}</time>
              </div>
              <p className="t-small cl-latest__sum">{latest.summary ? <Inline text={latest.summary} /> : autoTitle(latest)}</p>
              <div className="na-row">
                <LatestDownload version={latest.version} />
                <LinkButton variant="secondary" size="md" href="/app/">Web remote</LinkButton>
              </div>
              {next && (
                <a className="cl-latest__next" href="#next" onClick={(e) => { e.preventDefault(); go("next"); }}>
                  <ActivityMark kind="working" />
                  <span>Next release: <b className="t-num">{queued}</b> changes so far</span>
                </a>
              )}
            </div>
          </Reveal>
        )}
      </Section>

      <Section id="releases" path="changelog/timeline" meta={<ToggleAll allOpen={allOpen} onClick={() => setOpen(allOpen ? new Set() : new Set(ids))} />} label="Releases" tight>
        <div className="cl-layout">
          <nav className="cl-index" aria-label="Releases">
            <ol>
              {list.map((r) => {
                const id = idOf(r);
                return (
                  <li key={id}>
                    <a href={`#${id}`} aria-current={current === id ? "location" : undefined} onClick={(e) => { e.preventDefault(); go(id); }}>
                      <ActivityMark kind={current === id ? "working" : markOf(r)} size="sm" />
                      <span className="cl-index__v t-num">{r.unreleased ? "Next" : r.version}</span>
                      <span className="cl-index__d">{r.date ? shortDate(r.date).replace(/,? \d{4}$/, "") : "soon"}</span>
                    </a>
                  </li>
                );
              })}
            </ol>
          </nav>
          <ol className="cl-list">
            {list.map((r, i) => (
              <Entry key={idOf(r)} r={r} index={i} open={open.has(idOf(r))} onToggle={() => toggle(idOf(r))} />
            ))}
          </ol>
        </div>
      </Section>
    </Page>
  );
}

function LatestDownload({ version }: { version: string }) {
  const { cta, phone, status } = useRelease();
  return <LinkButton variant="primary" size="md" href={status === "ok" ? cta.href : "/download/"} arrow={phone ? undefined : "go"}>{status === "ok" && !phone ? cta.label : `Download v${version}`}</LinkButton>;
}

function ToggleAll({ allOpen, onClick }: { allOpen: boolean; onClick: () => void }) {
  return (
    <button type="button" className="cl-all" onClick={onClick}>
      <Icon as={allOpen ? ChevronsDownUp : ChevronsUpDown} size="xs" />
      {allOpen ? "Collapse all" : "Expand all"}
    </button>
  );
}

function Entry({ r, index, open, onToggle }: { r: Release; index: number; open: boolean; onToggle: () => void }) {
  const id = idOf(r);
  const isLatest = r === latest;
  const groups = r.groups.filter((g) => g.items.length);
  const link = `${location.origin}${location.pathname}#${id}`;
  const [copy, copied] = useCopy(link);
  const ref = useRef<HTMLLIElement>(null);
  return (
    <li ref={ref} id={id} className="cl-rel" data-kind={r.unreleased ? "next" : isLatest ? "latest" : undefined} data-open={open ? "" : undefined} data-nosum={r.summary ? undefined : ""} style={{ "--i": Math.min(index, 5) } as CSSProperties}>
      <span className="cl-node" aria-hidden><ActivityMark kind={markOf(r)} /></span>
      <h2 className="cl-h">
        <button type="button" className="cl-row" aria-expanded={open} aria-controls={`${id}-notes`} onClick={onToggle}>
          <span className="cl-top">
            <span className="cl-ver t-num">{r.unreleased ? "Next" : <><i>v</i>{r.version}</>}</span>
            <span className="cl-meta t-label">
              {isLatest && <span className="cl-tag" data-kind="latest">Latest</span>}
              {r.unreleased && <span className="cl-tag" data-kind="next">In the works</span>}
              {r.date && <time dateTime={r.date}>{shortDate(r.date)}</time>}
            </span>
          </span>
          {r.summary && <span className="cl-title"><Inline text={r.summary} /></span>}
          <span className="cl-counts t-label">
            {groups.map((g) => (
              <span key={g.title} className="cl-count"><Icon as={groupIcon(g.title)} size={13} />{g.items.length} {groupMeta(g.title).many}</span>
            ))}
          </span>
          <Icon as={ChevronDown} size="md" className="cl-chev" />
        </button>
      </h2>
      <div className="cl-body" id={`${id}-notes`} role="region" aria-label={r.unreleased ? "Upcoming changes" : `Version ${r.version} notes`} inert={!open}>
        <div className="cl-clip">
          <div className="cl-notes">
            {groups.map((g) => (
              <section key={g.title} className="cl-group" data-group={g.title}>
                <h3 className="cl-gt t-label"><Icon as={groupIcon(g.title)} size="sm" />{groupMeta(g.title).label}<span className="t-num">{g.items.length}</span></h3>
                <ul>{g.items.map((it) => <li key={it}><Inline text={it} /></li>)}</ul>
              </section>
            ))}
            <button type="button" className="cl-perma" onClick={copy}>
              <Icon as={copied ? Check : Link2} size="xs" />
              {copied ? "Link copied" : `Copy link to ${r.unreleased ? "the next release" : `v${r.version}`}`}
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}

// /changelog: every release from CHANGELOG.md (bundled at build time via `virtual:changelog`,
// see vite.config.ts). Same look as the landing page. The latest release is open, older ones are
// compact rows that expand in place; a sticky release rail on wide screens. Anchors per version:
// `/changelog#v0-3-0` (the old `#0.3.0` form still works) open and scroll to that release.
import "./styles.css";
import "./site/site.css";
import "./site/changelog.css";
import { Bug, ChevronDown, ChevronsDownUp, ChevronsUpDown, Download, Globe, Link2, Sparkles, Wand2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Fragment, StrictMode, useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import versions from "virtual:changelog";
import { reduced, startScroll } from "./site/hooks";
import { Nav } from "./site/Nav";
import { Aurora, Btn } from "./site/parts";
import { SiteFooter } from "./site/Sections";

type Release = (typeof versions)[number];

const GROUP: Record<string, { Icon: LucideIcon; tone: string; one: string; many: string }> = {
  New: { Icon: Sparkles, tone: "t-new", one: "new feature", many: "new features" },
  Improved: { Icon: Wand2, tone: "t-improved", one: "improvement", many: "improvements" },
  Fixed: { Icon: Bug, tone: "t-fixed", one: "fix", many: "fixes" },
};
const group = (title: string) => GROUP[title] ?? GROUP.Improved!;

/** `**bold**`, `` `code` `` and `[text](https://…)` inside an entry; everything else is plain text. */
function Inline({ text }: { text: string }) {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    out.push(text.slice(last, m.index));
    if (m[1]) out.push(<b key={m.index}>{m[1]}</b>);
    else if (m[2]) out.push(<code key={m.index}>{m[2]}</code>);
    else out.push(<a key={m.index} href={m[4]}>{m[3]}</a>);
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  return <>{out.map((x, i) => <Fragment key={i}>{x}</Fragment>)}</>;
}

const day = (d: string, opts: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en", { timeZone: "UTC", ...opts });
const longDate = (d: string) => day(d, { year: "numeric", month: "short", day: "numeric" });
const shortDate = (d: string) => day(d, { month: "short", day: "numeric" });

/** `0.3.0` → `v0-3-0`; the unreleased section is `next`. */
const idOf = (r: Release) => (r.unreleased ? "next" : `v${r.version.replace(/\./g, "-")}`);
const hasItems = (r: Release) => r.groups.some((g) => g.items.length > 0);

/** The release a URL hash points at: `#v0-3-0`, `#v0.3.0`, `#0.3.0` or `#next`. */
function fromHash(hash: string, list: Release[]): string | null {
  const h = decodeURIComponent(hash.replace(/^#/, "")).toLowerCase();
  if (!h) return null;
  const hit = list.find((r) => idOf(r) === h || (!r.unreleased && (h === r.version || h === `v${r.version}`)));
  return hit ? idOf(hit) : null;
}

/** A one-line title for releases without a summary: "2 fixes", "1 improvement and 1 fix". */
function autoTitle(r: Release) {
  const parts = r.groups.filter((g) => g.items.length).map((g) => `${g.items.length} ${g.items.length === 1 ? group(g.title).one : group(g.title).many}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : (parts[0] ?? "");
}

function scrollToId(id: string) {
  requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "start" }));
}

/** Which release is at the top of the viewport (for the rail). */
function useCurrent(ids: string[]) {
  const [cur, setCur] = useState(ids[0] ?? "");
  useEffect(() => {
    const pick = () => {
      let best = ids[0] ?? "";
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top < innerHeight * 0.35) best = id;
      }
      setCur(best);
    };
    pick();
    addEventListener("scroll", pick, { passive: true });
    return () => removeEventListener("scroll", pick);
  }, [ids.join()]);
  return cur;
}

function Changelog() {
  const released = versions.filter((v) => !v.unreleased && hasItems(v));
  const next = versions.find((v) => v.unreleased && hasItems(v));
  const list = next ? [next, ...released] : released;
  const latest = released[0];
  const ids = list.map(idOf);

  const [open, setOpen] = useState<Set<string>>(() => {
    const s = new Set<string>(latest ? [idOf(latest)] : []);
    const hit = fromHash(location.hash, list);
    if (hit) s.add(hit);
    return s;
  });
  const toggle = (id: string) => setOpen((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  /** Open a release, put it in the URL and scroll to it (rail links, hash links). */
  const go = useCallback((id: string) => {
    setOpen((s) => (s.has(id) ? s : new Set(s).add(id)));
    history.replaceState(null, "", `#${id}`);
    scrollToId(id);
  }, []);

  useEffect(() => {
    const hit = fromHash(location.hash, list);
    if (hit) {
      if (location.hash !== `#${hit}`) history.replaceState(null, "", `#${hit}`);
      scrollToId(hit);
    }
    const onHash = () => {
      const id = fromHash(location.hash, list);
      if (id) go(id);
    };
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  const allOpen = list.every((r) => open.has(idOf(r)));
  const cur = useCurrent(ids);

  return (
    <>
      <div className="s-fixed" aria-hidden><Aurora /></div>
      <Nav away />
      <main className="s-sec c-page">
        <div className="s-wrap c-layout">
          <nav className="c-rail" aria-label="Releases">
            <span className="eyebrow">Releases</span>
            <ol>
              {list.map((r) => {
                const id = idOf(r);
                return (
                  <li key={id}>
                    <a
                      href={`#${id}`}
                      className={`${cur === id ? "on" : ""}${r === latest ? " latest" : ""}${r.unreleased ? " next" : ""}`}
                      aria-current={cur === id ? "location" : undefined}
                      onClick={(e) => { e.preventDefault(); go(id); }}
                    >
                      <i aria-hidden />
                      <span className="v">{r.unreleased ? "Next" : r.version}</span>
                      <span className="d">{r.date ? shortDate(r.date) : "Soon"}</span>
                    </a>
                  </li>
                );
              })}
            </ol>
          </nav>

          <div className="c-main">
            <header className="s-head c-head" data-reveal>
              <span className="eyebrow">Changelog</span>
              <h1 className="s-h2">What's new in NeuralAgent</h1>
              <p className="s-lead">
                Every release in plain words. The desktop app updates itself and shows these notes when a new version is ready; <b>your agents keep running</b> while it does.
              </p>
              <div className="c-cta">
                <Btn href="/download" Icon={Download} size="sm">Download{latest ? ` ${latest.version}` : ""}</Btn>
                <Btn href="/app/" variant="glass" Icon={Globe} size="sm">Open web remote</Btn>
              </div>
            </header>

            <div className="c-bar" data-reveal>
              <span>{released.length} {released.length === 1 ? "release" : "releases"}</span>
              <button type="button" className="c-all" onClick={() => setOpen(allOpen ? new Set() : new Set(ids))}>
                {allOpen ? <ChevronsDownUp size={14} aria-hidden /> : <ChevronsUpDown size={14} aria-hidden />}
                {allOpen ? "Collapse all" : "Expand all"}
              </button>
            </div>

            <ol className="c-list">
              {list.map((r, i) => (
                <Entry key={idOf(r)} r={r} i={i} latest={r === latest} open={open.has(idOf(r))} onToggle={() => toggle(idOf(r))} />
              ))}
            </ol>
          </div>
        </div>
      </main>
      <SiteFooter away />
    </>
  );
}

function Entry({ r, i, latest, open, onToggle }: { r: Release; i: number; latest: boolean; open: boolean; onToggle: () => void }) {
  const id = idOf(r);
  const groups = r.groups.filter((g) => g.items.length);
  return (
    // State lives in data-open, not className: startScroll() adds the reveal class "in" to the <li>,
    // and React would drop it when it rewrites className on toggle.
    <li id={id} className={`c-rel${latest ? " latest" : ""}${r.unreleased ? " next" : ""}`} data-open={open || undefined} data-reveal style={{ "--i": Math.min(i, 6) } as CSSProperties}>
      <h2 className="c-h">
        <button type="button" className="c-row" aria-expanded={open} aria-controls={`${id}-notes`} onClick={onToggle}>
          <span className="c-top">
            <span className="c-ver">{r.unreleased ? "Next" : `v${r.version}`}</span>
            {latest && <span className="c-tag">Latest</span>}
            {r.unreleased && <span className="c-tag soft">In the works</span>}
            <span className="c-date">{r.date ? <time dateTime={r.date}>{longDate(r.date)}</time> : "Not released yet"}</span>
          </span>
          <span className={`c-title${r.summary ? "" : " auto"}`}>{r.summary ? <Inline text={r.summary} /> : autoTitle(r)}</span>
          <span className="c-counts">
            {groups.map((g) => (
              <span key={g.title} className={`c-count ${group(g.title).tone}`}>
                <i aria-hidden />{g.items.length} {g.title.toLowerCase()}
              </span>
            ))}
          </span>
          <ChevronDown className="c-chev" size={18} strokeWidth={1.8} aria-hidden />
        </button>
      </h2>
      <div className="c-body" id={`${id}-notes`} role="region" aria-label={r.unreleased ? "Upcoming changes" : `Version ${r.version} notes`} inert={!open}>
        <div className="c-clip">
          <div className="c-notes">
            {groups.map((g) => {
              const { Icon, tone } = group(g.title);
              return (
                <section key={g.title} className={`c-group ${tone}`}>
                  <h3 className={`c-gt ${tone}`}><Icon size={13} strokeWidth={1.9} aria-hidden />{g.title}</h3>
                  <ul>
                    {g.items.map((it) => <li key={it}><Inline text={it} /></li>)}
                  </ul>
                </section>
              );
            })}
            <a className="c-perma" href={`#${id}`}><Link2 size={13} aria-hidden />Link to {r.unreleased ? "upcoming changes" : `v${r.version}`}</a>
          </div>
        </div>
      </div>
    </li>
  );
}

startScroll();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Changelog />
  </StrictMode>,
);

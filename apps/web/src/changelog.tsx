// /changelog: every release from CHANGELOG.md (bundled at build time via `virtual:changelog`,
// see vite.config.ts). Same look as the landing page; anchors per version (`/changelog#0.2.1`).
import "./styles.css";
import "./site/site.css";
import "./site/changelog.css";
import { Bug, Download, Globe, Sparkles, Wand2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Fragment, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import versions from "virtual:changelog";
import { startScroll } from "./site/hooks";
import { Nav } from "./site/Nav";
import { Btn } from "./site/parts";
import { SiteFooter } from "./site/Sections";
import { Aurora } from "./site/parts";

const GROUP: Record<string, { Icon: LucideIcon; tone: string }> = {
  New: { Icon: Sparkles, tone: "t-new" },
  Improved: { Icon: Wand2, tone: "t-improved" },
  Fixed: { Icon: Bug, tone: "t-fixed" },
};

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

const longDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en", { year: "numeric", month: "long", day: "numeric" });

function Changelog() {
  const released = versions.filter((v) => !v.unreleased);
  const next = versions.find((v) => v.unreleased && v.groups.length);
  const latest = released[0]?.version;
  return (
    <>
      <div className="s-fixed" aria-hidden><Aurora /></div>
      <Nav away />
      <main className="s-sec c-page">
        <div className="s-wrap">
          <header className="s-head" data-reveal>
            <span className="eyebrow">Changelog</span>
            <h1 className="s-h2">What's new in NeuralAgent</h1>
            <p className="s-lead">
              Every release in plain words. The desktop app updates itself and shows these notes when a new version is ready; <b>your agents keep running</b> while it does.
            </p>
            <div className="c-cta">
              <Btn href="/download" Icon={Download} size="sm">Download{latest ? ` ${latest}` : ""}</Btn>
              <Btn href="/app/" variant="glass" Icon={Globe} size="sm">Open web remote</Btn>
            </div>
          </header>

          <ol className="c-list">
            {next && <Release r={next} label="In the works" />}
            {released.map((r, i) => <Release key={r.version} r={r} label={i === 0 ? "Latest" : undefined} />)}
          </ol>
        </div>
      </main>
      <SiteFooter away />
    </>
  );
}

function Release({ r, label }: { r: (typeof versions)[number]; label?: string }) {
  const id = r.unreleased ? "next" : r.version;
  return (
    <li className={`c-rel${r.unreleased ? " next" : ""}${label === "Latest" ? " latest" : ""}`} id={id} data-reveal>
      <div className="c-meta">
        <a href={`#${id}`} className="c-ver">{r.unreleased ? "Next" : r.version}</a>
        <span className="c-date">{r.date ? longDate(r.date) : "Not released yet"}</span>
        {label && <span className="c-tag">{label}</span>}
      </div>
      <span className="c-dot" aria-hidden />
      <article className="s-card c-card">
        {r.summary && <p className="c-sum"><Inline text={r.summary} /></p>}
        {r.groups.map((g) => {
          const { Icon, tone } = GROUP[g.title] ?? GROUP.Improved!;
          return (
            <section key={g.title} className="c-group">
              <h3 className={`c-gt ${tone}`}><Icon size={14} strokeWidth={1.8} />{g.title}</h3>
              <ul>
                {g.items.map((it) => <li key={it}><Inline text={it} /></li>)}
              </ul>
            </section>
          );
        })}
      </article>
    </li>
  );
}

startScroll();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Changelog />
  </StrictMode>,
);

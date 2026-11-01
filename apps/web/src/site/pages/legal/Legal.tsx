// /imprint, /privacy, /terms: a calm document. Index pane in the head, contents on the left from 1024 px, mono section
// numbers, a 62 ch measure. The text itself is in content.tsx.
import "./legal.css";
import { useEffect, useRef } from "react";
import { ActivityMark, Icon, PaneTitle, Reveal, Section, SlotLines, useActiveSection } from "../../ui";
import { ArrowRight, ChevronDown } from "../icons";
import { Page } from "../Page";
import { DOCS, ORDER, slugOf, UPDATED, type Doc } from "./content";

const num = (i: number) => String(i + 1).padStart(2, "0");

export function Legal({ page }: { page: string }) {
  const doc: Doc = DOCS[page as Doc["slug"]] ?? DOCS.imprint;
  const sections = doc.sections.map((s, i) => ({ ...s, id: slugOf(s.title), n: num(i) }));
  const active = useActiveSection(sections.map((s) => s.id));
  const jump = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!id) return;
    const go = () => document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "auto" });
    requestAnimationFrame(() => { go(); setTimeout(go, 300); });
  }, []);

  return (
    <Page>
      <Section id="top" path={`legal/${doc.slug}`} meta={<span className="na-hide-sm">updated {UPDATED}</span>} label={doc.title} className="pg-first" bodyClassName="pg-head lg-head">
        <div className="pg-title">
          <SlotLines as="h1" className="t-h1" lines={[doc.title]} stop />
          <Reveal as="p" index={2} immediate className="t-lead pg-lead">{doc.blurb}</Reveal>
          <Reveal as="p" index={3} immediate className="t-label lg-updated">Last updated <time dateTime="2026-10-30">{UPDATED}</time></Reveal>
        </div>
        <Reveal kind="pane" index={3} immediate className="na-pane lg-index">
          <PaneTitle status="idle" label="legal/documents" />
          <nav aria-label="Legal documents">
            <ul>
              {ORDER.map((slug) => {
                const d = DOCS[slug];
                const here = slug === doc.slug;
                return (
                  <li key={slug}>
                    <a href={`/${slug}/`} aria-current={here ? "page" : undefined}>
                      <ActivityMark kind={here ? "working" : "idle"} size="sm" />
                      <b>{d.title}</b>
                      {!here && <Icon as={ArrowRight} size="sm" />}
                    </a>
                  </li>
                );
              })}
            </ul>
          </nav>
        </Reveal>
      </Section>

      <Section id="text" path={`legal/${doc.slug}/text`} meta={<span className="t-num">{sections.length} sections</span>} label={`${doc.title}, full text`} tight>
        <div className="lg-layout">
          {/* Phones and tablets: the same list as a collapsed disclosure (the sticky contents column needs 1024 px). */}
          {sections.length > 5 && (
            <details ref={jump} className="lg-jump">
              <summary>
                <span className="t-label">contents/</span>
                <span className="lg-jump__n t-label t-num">{sections.length} sections</span>
                <Icon as={ChevronDown} size="md" className="lg-jump__chev" />
              </summary>
              <nav aria-label="On this page">
                <ol>
                  {sections.map((s) => (
                    <li key={s.id}>
                      <a href={`#${s.id}`} onClick={() => { if (jump.current) jump.current.open = false; }}>
                        <span className="lg-toc__n t-num">{s.n}</span>
                        <span>{s.title}</span>
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>
            </details>
          )}
          <nav className="lg-toc" aria-label="On this page">
            <p className="t-label lg-toc__h">contents/</p>
            <ol>
              {sections.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} aria-current={active === s.id ? "location" : undefined}>
                    <span className="lg-toc__n t-num">{s.n}</span>
                    <span>{s.title}</span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>
          <article className="lg-doc">
            {sections.map((s) => (
              <section key={s.id} id={s.id} className="lg-sec" aria-labelledby={`${s.id}-h`}>
                <span className="lg-sec__n t-label t-num" aria-hidden>{s.n}</span>
                <div className="lg-sec__main">
                  <h2 id={`${s.id}-h`} className="lg-sec__h"><a href={`#${s.id}`}>{s.title}</a></h2>
                  <div className="lg-prose na-prose">{s.body}</div>
                </div>
              </section>
            ))}
          </article>
        </div>
      </Section>
    </Page>
  );
}

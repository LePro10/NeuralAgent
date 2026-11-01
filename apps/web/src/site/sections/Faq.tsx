// FAQ: an accessible accordion (buttons with aria-expanded, regions), two columns on desktop. The same array renders the questions here
// and the static FAQPage JSON-LD in index.html (content/sync-static.mjs keeps them identical; static.test.ts fails on drift).
import "./Faq.css";
import { Fragment, useId, useState } from "react";
import { MAIL } from "../content";
import { FAQ } from "../content/faq";
import { Plus } from "../content/icons";
import { Icon, Reveal, Section, SlotLines } from "../ui";

/** `code` and [text](href) inside an answer. */
function Rich({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]+\]\([^)]+\)|`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) => {
        const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(p);
        if (link) {
          const external = /^https?:\/\//.test(link[2]!);
          return <a key={i} className="na-link" href={link[2]} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{link[1]}</a>;
        }
        if (p.startsWith("`")) return <code key={i} className="na-code">{p.slice(1, -1)}</code>;
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
}

function Item({ n, q, a, open, onToggle, uid, index }: { n: number; q: string; a: string; open: boolean; onToggle: () => void; uid: string; index: number }) {
  return (
    <Reveal as="li" index={index} className="faq__item" data-open={open ? "" : undefined}>
      <h3 className="faq__h">
        <button type="button" className="faq__q" aria-expanded={open} aria-controls={`${uid}-a`} id={`${uid}-q`} onClick={onToggle}>
          <span className="faq__n t-label t-num">{String(n).padStart(2, "0")}</span>
          <span className="faq__text">{q}</span>
          <Icon as={Plus} size="md" className="faq__plus" />
        </button>
      </h3>
      <div id={`${uid}-a`} role="region" aria-labelledby={`${uid}-q`} hidden={!open} className="faq__a">
        <p><Rich text={a} /></p>
      </div>
    </Reveal>
  );
}

export function Faq() {
  const uid = useId();
  // Phones start with the first answer open (it shows what an answer looks like). Side by side, an open answer would leave a hole
  // beside it, so the grid starts closed.
  const [open, setOpen] = useState<Set<number>>(() => new Set(typeof matchMedia === "function" && matchMedia("(min-width: 900px)").matches ? [] : [0]));
  const toggle = (i: number) =>
    setOpen((s) => {
      const n = new Set(s);
      n.has(i) ? n.delete(i) : n.add(i);
      return n;
    });
  return (
    <Section id="faq" path="faq/questions" meta={<span className="na-hide-sm t-num">{FAQ.length} answers</span>} labelledBy="faq-h" bodyClassName="faq__body">
      <div className="na-head">
        <SlotLines as="h2" id="faq-h" className="t-h2" immediate={false} lines={["Questions,", "answered plainly"]} stop />
        <Reveal as="p" index={2} className="t-lead faq__lead">
          Short answers, no marketing. Something missing? Write to <a className="na-link" href={`mailto:${MAIL}`}>{MAIL}</a>.
        </Reveal>
      </div>
      {/* One grid, row by row: question 1 beside 2, 3 beside 4. Rows stay aligned when an answer opens. */}
      <Reveal kind="rule" className="faq__rule" />
      <ul className="faq__list">
        {FAQ.map((f, i) => (
          <Item key={f.q} n={i + 1} q={f.q} a={f.a} open={open.has(i)} onToggle={() => toggle(i)} uid={`${uid}-${i}`} index={(i % 2) * 0.5} />
        ))}
      </ul>
    </Section>
  );
}

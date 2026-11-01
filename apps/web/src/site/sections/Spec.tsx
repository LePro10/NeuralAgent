// Spec sheet: everything the product does, grouped. Desktop: a category switch (vertical tabs) beside one dense sheet.
// Phones: collapsible groups. Same data, same rows; every group stays in the DOM (hidden), so nothing is lost to search or readers.
import "./Spec.css";
import { Fragment, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { SPEC, type SpecGroup } from "../content/spec";
import { ChevronDown } from "../content/icons";
import { ActivityMark, Icon, PaneTitle, Reveal, Section, SlotLines, useMedia } from "../ui";

/** `code` spans inside a plain line. */
function Line({ text }: { text: string }) {
  const parts = text.split(/`([^`]+)`/g);
  return (
    <>
      {parts.map((p, i) => (i % 2 ? <code key={i} className="na-code">{p}</code> : <Fragment key={i}>{p}</Fragment>))}
    </>
  );
}

function Items({ group }: { group: SpecGroup }) {
  return (
    <ul className="spec__items">
      {group.items.map((it, i) => (
        <li key={it.term} className="spec__item" style={{ "--i": i } as React.CSSProperties}>
          <Icon as={it.icon} size="md" className="spec__ico" />
          <div>
            <h3 className="spec__term">{it.term}</h3>
            <p className="spec__line"><Line text={it.line} /></p>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Desktop: vertical tabs (arrow keys, Home, End) + one visible panel. */
function Tabs() {
  const [active, setActive] = useState(SPEC[0]!.id);
  const uid = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (e: KeyboardEvent, i: number) => {
    const n = SPEC.length;
    const next = e.key === "ArrowDown" || e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowUp" || e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    setActive(SPEC[next]!.id);
    refs.current[next]?.focus();
  };
  return (
    <div className="spec__sheet">
      <div className="spec__tabs" role="tablist" aria-orientation="vertical" aria-label="Feature groups">
        {SPEC.map((g, i) => {
          const on = g.id === active;
          return (
            <button
              key={g.id}
              ref={(el) => void (refs.current[i] = el)}
              role="tab"
              id={`${uid}-t-${g.id}`}
              aria-selected={on}
              aria-controls={`${uid}-p-${g.id}`}
              tabIndex={on ? 0 : -1}
              className="spec__tab"
              onClick={() => setActive(g.id)}
              onKeyDown={(e) => move(e, i)}
            >
              <span className="spec__tabmark">{on ? <ActivityMark kind="working" size="md" /> : <Icon as={g.icon} size="md" />}</span>
              <span className="spec__tablabel">{g.label}</span>
              <span className="spec__count t-num">{String(g.items.length).padStart(2, "0")}</span>
            </button>
          );
        })}
      </div>
      <div className="spec__panels">
        {SPEC.map((g) => (
          <div key={g.id} role="tabpanel" id={`${uid}-p-${g.id}`} aria-labelledby={`${uid}-t-${g.id}`} hidden={g.id !== active} className="spec__panel" tabIndex={0}>
            <PaneTitle className="spec__title" status="idle" label={`spec/${g.id}`} meta={<span className="t-num">{g.items.length} items</span>} />
            <Items group={g} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Phones: collapsible groups, the first one open. */
function Accordion() {
  const [open, setOpen] = useState<Set<string>>(() => new Set([SPEC[0]!.id]));
  const uid = useId();
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  return (
    <div className="spec__acc">
      {SPEC.map((g) => {
        const on = open.has(g.id);
        return (
          <div key={g.id} className="spec__group" data-open={on ? "" : undefined}>
            <h3 className="spec__ghead">
              <button type="button" className="spec__gbtn" aria-expanded={on} aria-controls={`${uid}-${g.id}`} onClick={() => toggle(g.id)}>
                <span className="spec__tabmark">{on ? <ActivityMark kind="working" size="md" /> : <Icon as={g.icon} size="md" />}</span>
                <span className="spec__tablabel">{g.label}</span>
                <span className="spec__count t-num">{String(g.items.length).padStart(2, "0")}</span>
                <Icon as={ChevronDown} size="md" className="spec__chev" />
              </button>
            </h3>
            <div id={`${uid}-${g.id}`} role="region" aria-label={g.label} hidden={!on} className="spec__gbody">
              <Items group={g} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function Spec() {
  const wide = useMedia("(min-width: 900px)");
  const body: ReactNode = wide ? <Tabs /> : <Accordion />;
  return (
    <Section id="spec" path="product/everything-else" meta={<span className="na-hide-sm t-num">{SPEC.reduce((n, g) => n + g.items.length, 0)} lines</span>} labelledBy="spec-h">
      <div className="na-head">
        <SlotLines as="h2" id="spec-h" className="t-h2" immediate={false} lines={["The whole spec,", "on one sheet"]} stop />
        <Reveal as="p" index={2} className="t-lead">Seven groups, one plain line each. {wide ? "Pick a group on the left." : "Tap a group to open it."}</Reveal>
      </div>
      <Reveal kind="pane" className="spec__wrap">{body}</Reveal>
    </Section>
  );
}

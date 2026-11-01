// Agents: the 13 CLIs as a roster beside a live terminal line. Hover, focus or tap a row: the pane shows the command, where its status
// comes from and the install line. Phones: the same lines open inline under the row.
import "./Agents.css";
import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { AGENT_INFO, BYO, type AgentInfo } from "../content/agents";
import { ChevronDown, KeyRound, ScanSearch, SquareTerminal, Check, Copy } from "../content/icons";
import { ActivityMark, AgentGlyph, Icon, PaneTitle, Reveal, Section, SlotLines, useCopy, useMedia, useMoreToRight } from "../ui";

const SHELL: AgentInfo = { id: "shell", name: "Any other terminal program", vendor: "Plain shell pane", cmd: "shell", install: "", hooks: false };
const ROWS: AgentInfo[] = [...AGENT_INFO, SHELL];
const BYO_ICON = [KeyRound, ScanSearch, SquareTerminal] as const;

function CopyLine({ text }: { text: string }) {
  const [copy, done] = useCopy(text);
  const code = useRef<HTMLElement>(null);
  const more = useMoreToRight(code, text);
  return (
    <div className="agt__cmd">
      <span className="agt__p" aria-hidden>$</span>
      <code ref={code} tabIndex={0} data-more={more ? "" : undefined}>{text}</code>
      <button type="button" onClick={copy} data-done={done ? "" : undefined} aria-label={done ? "Copied" : `Copy install command`} title={done ? "Copied" : "Copy"}>
        <Icon as={done ? Check : Copy} size={16} />
        <span className="na-sr" role="status">{done ? "Copied to clipboard" : ""}</span>
      </button>
    </div>
  );
}

/** The few terminal lines for one agent. Keyed by id so they replay when the selection changes. */
function Lines({ a }: { a: AgentInfo }) {
  const shell = a.id === "shell";
  return (
    <div className="agt__lines" key={a.id}>
      <p className="agt__ln" style={{ "--n": 0 } as CSSProperties}>
        <span className="agt__p" aria-hidden>$</span> <span className="t-bright">{shell ? "your-program" : a.cmd}</span><i className="agt__caret" aria-hidden />
      </p>
      <p className="agt__ln agt__ln--dim" style={{ "--n": 1 } as CSSProperties}>
        {shell ? "Any other terminal program runs as a plain shell pane." : `${a.name}, ${a.vendor}.`}
      </p>
      <p className="agt__ln agt__status" style={{ "--n": 2 } as CSSProperties}>
        <span className="agt__k">status</span>
        {a.hooks ? (
          <><ActivityMark kind="working" size="sm" /> <span className="t-bright">exact, from hooks</span></>
        ) : (
          <><ActivityMark kind="idle" size="sm" /> <span>read from output and prompts</span></>
        )}
      </p>
      {!shell && (
        <>
          <p className="agt__ln agt__ln--faint" style={{ "--n": 3 } as CSSProperties}># not on this computer yet? one click installs it into a pane. By hand:</p>
          <div className="agt__ln" style={{ "--n": 4 } as CSSProperties}><CopyLine text={a.install} /></div>
          {a.note && <p className="agt__ln agt__ln--dim" style={{ "--n": 5 } as CSSProperties}>{a.note}</p>}
        </>
      )}
      {shell && <p className="agt__ln agt__ln--faint" style={{ "--n": 3 } as CSSProperties}># nothing to install</p>}
    </div>
  );
}

export function Agents() {
  // From tablet width on, the roster and the terminal pane sit side by side.
  const wide = useMedia("(min-width: 768px)");
  const [sel, setSel] = useState("claude");
  const uid = useId();
  const cur = ROWS.find((r) => r.id === sel) ?? ROWS[0]!;
  // Desktop: selection follows hover/focus. Phones: tap toggles the inline lines (click on a selected row closes it).
  // Phones start with every row closed: 14 rows in a list, one tap to read a row, instead of 400 px of Claude Code first.
  const [closed, setClosed] = useState(() => typeof matchMedia === "function" && !matchMedia("(min-width: 768px)").matches);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // Single-open accordion on phones: opening a row closes the one above it, which would pull the tapped row up the screen.
  // Remember where it was and put it back in the same layout pass.
  const anchor = useRef<{ i: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const a = anchor.current;
    if (!a) return;
    anchor.current = null;
    const el = rowRefs.current[a.i];
    if (el) {
      const d = el.getBoundingClientRect().top - a.top;
      if (Math.abs(d) > 1) window.scrollBy({ top: d, behavior: "instant" as ScrollBehavior });
    }
  }, [sel, closed]);
  const pick = (id: string, i: number) => {
    if (!wide) anchor.current = { i, top: rowRefs.current[i]?.getBoundingClientRect().top ?? 0 };
    if (!wide && id === sel) setClosed((c) => !c);
    else {
      setSel(id);
      setClosed(false);
    }
  };
  // Side by side: one tab stop for the roster, arrow keys move (and select).
  const move = (e: KeyboardEvent, i: number) => {
    if (!wide) return;
    const n = ROWS.length;
    const next = e.key === "ArrowDown" ? (i + 1) % n : e.key === "ArrowUp" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    setSel(ROWS[next]!.id);
    rowRefs.current[next]?.focus();
  };
  return (
    <Section id="agents" path="agents/thirteen-clis" meta={<span className="na-hide-sm t-num">13 + shell</span>} labelledBy="agents-h">
      <div className="agt">
        <div className="agt__side">
          <div className="na-head agt__head">
            <SlotLines as="h2" id="agents-h" className="t-h2" immediate={false} lines={["Thirteen agent CLIs.", "Your own subscriptions"]} stop />
            <Reveal as="p" index={2} className="t-lead">
              NeuralAgent runs the command-line agents you already use, side by side. Claude Code and Codex report exact status through hooks; the rest is read from their output.
            </Reveal>
          </div>
          {wide && (
            <Reveal kind="pane" index={3} className="agt__term na-pane" id={`${uid}-pane`} role="region" aria-label={`${cur.name} terminal lines`} aria-live="polite">
              <PaneTitle status="idle" label={`pane/${cur.id === "shell" ? "shell" : cur.cmd}`} meta={cur.vendor} />
              <Lines a={cur} />
            </Reveal>
          )}
        </div>

        <Reveal kind="pane" className="agt__roster">
          <div className="agt__rh t-label" aria-hidden>
            <span>Agent</span>
            <span className="agt__rcmd">Command</span>
            <span className="agt__rst">Status from</span>
          </div>
          <ul className="agt__list" aria-label="Agent CLIs">
            {ROWS.map((a, i) => {
              const on = a.id === sel && (wide || !closed);
              return (
                <li key={a.id} className="agt__item" data-on={on ? "" : undefined} data-shell={a.id === "shell" ? "" : undefined}>
                  <button
                    type="button"
                    ref={(el) => void (rowRefs.current[i] = el)}
                    className="agt__row"
                    tabIndex={wide && !on ? -1 : undefined}
                    onKeyDown={(e) => move(e, i)}
                    aria-expanded={wide ? undefined : on}
                    aria-controls={wide ? `${uid}-pane` : `${uid}-${a.id}`}
                    aria-current={wide && on ? "true" : undefined}
                    onClick={() => pick(a.id, i)}
                    onFocus={() => wide && setSel(a.id)}
                    onPointerEnter={(e) => wide && e.pointerType === "mouse" && setSel(a.id)}
                    style={{ "--i": i } as CSSProperties}
                  >
                    <span className="agt__tile"><AgentGlyph engine={a.id === "shell" ? "shell" : a.id} size={16} /></span>
                    <span className="agt__name">
                      <b>{a.name}</b>
                      <span className="agt__vendor">{a.vendor}</span>
                    </span>
                    <code className="agt__rcmd">{a.id === "shell" ? "any" : a.cmd}</code>
                    <span className="agt__rst" data-hooks={a.hooks ? "" : undefined}>
                      {a.hooks ? <><ActivityMark kind="working" size="sm" /> hooks</> : "output"}
                    </span>
                    {!wide && <Icon as={ChevronDown} size="md" className="agt__chev" />}
                  </button>
                  {!wide && on && (
                    <div id={`${uid}-${a.id}`} role="region" aria-label={`${a.name} terminal lines`} className="agt__inline">
                      <Lines a={a} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Reveal>
      </div>

      <ul className="na-cells agt__byo" aria-label="How it fits your setup">
        {BYO.map((b, i) => (
          <Reveal as="li" kind="pane" index={i} key={b.title} className="na-cell agt__cell">
            <Icon as={BYO_ICON[i]!} size="lg" className="agt__bico" />
            <h3 className="agt__bt">{b.title}</h3>
            <p className="agt__bl">{b.line}</p>
          </Reveal>
        ))}
      </ul>
    </Section>
  );
}

// The copy of one chapter, shared by the sticky stage (beside the live window) and the stacked layout (above a poster).
import { Fragment } from "react";
import { Play } from "lucide-react";
import { ActivityMark, Icon } from "../ui";
import { CHAPTERS, type Chapter } from "../stage/chapters";
import type { Line } from "../stage/signals";

function Text({ text }: { text: string }) {
  return (
    <>
      {text.split(/`([^`]+)`/g).map((p, i) => (i % 2 ? <code key={i} className="na-code">{p}</code> : <Fragment key={i}>{p}</Fragment>))}
    </>
  );
}

/**
 * `wide` (the sticky stage): the full copy, the "Try" line and the live readout. Otherwise (the stacked layout on
 * phones and tablets) a heading and the short `lede`, which talks about the phone because the poster beside it is the
 * phone app; the poster is the link there, so the copy carries no second one.
 */
export function ChapterBody({ c, index, lines, wide }: { c: Chapter; index: number; lines: Line[]; wide?: boolean }) {
  return (
    <div className="ch__in">
      <h3 className="ch__h" id={`ch-${c.id}`}>
        {c.title.replace(/\.$/, "")}
        <span className="ch__stop" aria-hidden />
        <span className="na-sr">.</span>
      </h3>
      {wide ? (
        c.body.map((b, i) => (
          <p key={i} className="t-body ch__p"><Text text={b} /></p>
        ))
      ) : (
        <p className="t-body ch__p">{c.lede}</p>
      )}
      {wide && (
        <p className="ch__try t-label">
          <Icon as={Play} size={12} />
          <span><b>Try</b> {c.try}</span>
        </p>
      )}
      {wide && (
        <ul className="ch__log" aria-live="polite" aria-label="What is happening in the demo">
          {lines.map((l) => (
            <li key={l.key} className="ch__line">
              <ActivityMark kind={l.kind} />
              <span>{l.text}</span>
            </li>
          ))}
        </ul>
      )}
      <span className="na-sr">Chapter {index + 1} of {CHAPTERS.length}</span>
    </div>
  );
}

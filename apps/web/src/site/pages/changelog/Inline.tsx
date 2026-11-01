import { Fragment, type ReactNode } from "react";

/** `**bold**`, `` `code` `` and `[text](https://…)` inside an entry; everything else is plain text (never HTML). */
export function Inline({ text }: { text: string }) {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    out.push(text.slice(last, m.index));
    if (m[1]) out.push(<b key={m.index}>{m[1]}</b>);
    else if (m[2]) out.push(<code key={m.index} className="na-code">{m[2]}</code>);
    else out.push(<a key={m.index} className="na-link" href={m[4]} target="_blank" rel="noopener noreferrer">{m[3]}</a>);
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  return <>{out.map((x, i) => <Fragment key={i}>{x}</Fragment>)}</>;
}

/** A small Markdown renderer for assistant text (no HTML is ever injected). */
import { Check, Copy } from "lucide-react";
import { Fragment, memo, useState, type ReactNode } from "react";
import { usePlatform } from "../../lib/store";

type Block =
  | { t: "p"; text: string }
  | { t: "h"; level: number; text: string }
  | { t: "code"; lang: string; text: string }
  | { t: "quote"; text: string }
  | { t: "list"; ordered: boolean; items: { text: string; depth: number; n: number }[] }
  | { t: "table"; head: string[]; rows: string[][] }
  | { t: "hr" };

const split = (row: string) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

export function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const fence = /^\s*(```+|~~~+)\s*([\w+#.-]*)/.exec(line);
    if (fence) {
      const mark = fence[1]!;
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith(mark)) body.push(lines[i++]!);
      i++;
      out.push({ t: "code", lang: fence[2] ?? "", text: body.join("\n") });
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      out.push({ t: "h", level: h[1]!.length, text: h[2]! });
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push({ t: "hr" });
      i++;
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1]!)) {
      const head = split(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i]!.includes("|") && lines[i]!.trim()) rows.push(split(lines[i++]!));
      out.push({ t: "table", head, rows });
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]!)) body.push(lines[i++]!.replace(/^\s*>\s?/, ""));
      out.push({ t: "quote", text: body.join("\n") });
      continue;
    }
    const li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      const ordered = /\d/.test(li[2]!);
      const items: { text: string; depth: number; n: number }[] = [];
      while (i < lines.length) {
        const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]!);
        if (m) {
          items.push({ text: m[3]!, depth: Math.min(3, Math.floor(m[1]!.replace(/\t/g, "  ").length / 2)), n: parseInt(m[2]!, 10) || items.length + 1 });
          i++;
        } else if (lines[i]!.trim() && /^\s{2,}\S/.test(lines[i]!) && items.length) {
          items[items.length - 1]!.text += `\n${lines[i]!.trim()}`;
          i++;
        } else break;
      }
      out.push({ t: "list", ordered, items });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^\s*(```|~~~|#{1,6}\s|>|([-*+]|\d+[.)])\s)/.test(lines[i]!)) para.push(lines[i++]!);
    if (!para.length) para.push(lines[i++]!);
    out.push({ t: "p", text: para.join("\n") });
  }
  return out;
}

const INLINE = /(`+)([^`]+?)\1|\*\*([^*]+?)\*\*|__([^_]+?)__|\*([^*\s][^*]*?)\*|(?<![\w])_([^_\s][^_]*?)_(?![\w])|~~([^~]+?)~~|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<)]+[^\s<).,;:!?])/g;

function Inline({ text }: { text: string }) {
  const platform = usePlatform();
  const nodes: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const key = k++;
    if (m[2] !== undefined) nodes.push(<code key={key} className="rounded-xs bg-fill-3 px-1 py-px font-mono text-small text-bright">{m[2]}</code>);
    else if (m[3] !== undefined || m[4] !== undefined) nodes.push(<strong key={key} className="font-medium text-bright">{m[3] ?? m[4]}</strong>);
    else if (m[5] !== undefined || m[6] !== undefined) nodes.push(<em key={key}>{m[5] ?? m[6]}</em>);
    else if (m[7] !== undefined) nodes.push(<del key={key}>{m[7]}</del>);
    else {
      const href = m[9] ?? m[10]!;
      const label = m[8] ?? m[10]!;
      nodes.push(
        <a key={key} href={href} className="text-accent underline decoration-line-2 underline-offset-2" onClick={(e) => (e.preventDefault(), platform.openExternal(href))}>
          {label}
        </a>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return (
    <>
      {nodes.map((n, i) => (typeof n === "string" ? n.split("\n").map((s, j) => <Fragment key={`${i}-${j}`}>{j > 0 && <br />}{s}</Fragment>) : n))}
    </>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        });
      }}
      className="hoverable grid size-6 place-items-center rounded-xs text-dim hover:text-ink"
    >
      {done ? <Check size={13} strokeWidth={1.8} /> : <Copy size={13} strokeWidth={1.6} />}
    </button>
  );
}

export function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  return (
    <div className="my-2 overflow-hidden rounded-item bg-raised shadow-well">
      <div className="flex h-7 items-center justify-between pr-1 pl-3 text-meta text-faint">
        <span className="font-mono">{lang || "text"}</span>
        <CopyButton text={code} label="Copy code" />
      </div>
      <pre className="overflow-x-auto px-3 pb-3 font-mono text-small leading-relaxed text-ink">{code}</pre>
    </div>
  );
}

const HEADING = ["text-title", "text-title", "text-lead", "text-body", "text-body", "text-body"];

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className="min-w-0 text-body text-ink [overflow-wrap:anywhere]">
      {blocks.map((b, i) => {
        switch (b.t) {
          case "p":
            return <p key={i} className="my-2 first:mt-0 last:mb-0"><Inline text={b.text} /></p>;
          case "h":
            return <div key={i} className={`mt-4 mb-1.5 font-medium text-bright first:mt-0 ${HEADING[b.level - 1]}`}><Inline text={b.text} /></div>;
          case "code":
            return <CodeBlock key={i} code={b.text} lang={b.lang} />;
          case "quote":
            return <blockquote key={i} className="my-2 border-l-2 border-line-2 pl-3 text-dim"><Inline text={b.text} /></blockquote>;
          case "hr":
            return <hr key={i} className="my-3 border-line" />;
          case "list":
            return (
              <ul key={i} className="my-2 space-y-1">
                {b.items.map((it, j) => (
                  <li key={j} className="flex gap-2" style={{ paddingLeft: it.depth * 16 }}>
                    <span className="w-4 shrink-0 text-right text-dim">{b.ordered ? `${it.n}.` : "•"}</span>
                    <span className="min-w-0"><Inline text={it.text} /></span>
                  </li>
                ))}
              </ul>
            );
          case "table":
            return (
              <div key={i} className="my-2 overflow-x-auto rounded-item shadow-rim">
                <table className="w-full border-collapse text-small">
                  <thead>
                    <tr>{b.head.map((c, j) => <th key={j} className="border-b border-line px-3 py-1.5 text-left font-medium text-bright"><Inline text={c} /></th>)}</tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, j) => (
                      <tr key={j}>{r.map((c, k) => <td key={k} className="border-b border-line px-3 py-1.5 align-top last:border-0"><Inline text={c} /></td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </div>
  );
});

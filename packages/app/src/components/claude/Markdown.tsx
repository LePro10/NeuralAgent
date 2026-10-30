/** A small Markdown renderer for assistant text in Claude's reading style (no HTML is ever injected). */
import { cn } from "@neuralagent/ui";
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
    if (m[2] !== undefined) nodes.push(<code key={key} className="rounded-cv-xs bg-cv-code-bg px-1 py-px font-cv-mono text-cv-code text-cv-code-ink [overflow-wrap:anywhere]">{m[2]}</code>);
    else if (m[3] !== undefined || m[4] !== undefined) nodes.push(<strong key={key} className="font-cv-strong text-cv-text">{m[3] ?? m[4]}</strong>);
    else if (m[5] !== undefined || m[6] !== undefined) nodes.push(<em key={key}>{m[5] ?? m[6]}</em>);
    else if (m[7] !== undefined) nodes.push(<del key={key} className="text-cv-muted">{m[7]}</del>);
    else {
      const href = m[9] ?? m[10]!;
      const label = m[8] ?? m[10]!;
      nodes.push(
        <a key={key} href={href} className="text-cv-text underline decoration-cv-line-strong underline-offset-3 transition-colors hover:decoration-cv-text" onClick={(e) => (e.preventDefault(), platform.openExternal(href))}>
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

/** Writes text to the clipboard; falls back to a hidden textarea where the async API is missing (http, old WebViews). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

export function CopyButton({ text, label = "Copy", withLabel, className }: { text: string; label?: string; withLabel?: boolean; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={done ? "Copied" : label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        void copyText(text).then((ok) => {
          if (!ok) return;
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        });
      }}
      className={cn(
        "relative flex h-7 items-center gap-1.5 rounded-cv-sm px-1.5 font-cv-sans text-cv-meta text-cv-muted transition-colors hover:bg-cv-hover hover:text-cv-text after:absolute after:-inset-1.5",
        className,
      )}
    >
      {done ? <Check size={14} strokeWidth={2} /> : <Copy size={14} strokeWidth={1.7} />}
      {withLabel && <span>{done ? "Copied" : "Copy"}</span>}
    </button>
  );
}

export function CodeBlock({ code, lang, bare }: { code: string; lang?: string; bare?: boolean }) {
  return (
    <div className={cn("group/code overflow-hidden rounded-cv-md border border-cv-line-soft bg-cv-sunken", !bare && "my-4")}>
      <div className="flex h-9 items-center justify-between pr-1.5 pl-3.5 font-cv-sans text-cv-meta text-cv-muted">
        <span>{lang || "text"}</span>
        <CopyButton text={code} label="Copy code" withLabel />
      </div>
      <pre className="cv-scroll overflow-x-auto px-3.5 pb-3.5 font-cv-mono text-cv-code text-cv-text">{code}</pre>
    </div>
  );
}

const HEADING = ["text-cv-h1", "text-cv-h2", "text-cv-h3", "text-cv-prose", "text-cv-prose", "text-cv-prose"];

/** Markdown without its syntax, for "Copy" (Copy as Markdown keeps it). */
export function plainText(src: string): string {
  return src
    .replace(/^\s*(```+|~~~+)[^\n]*\n?/gm, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*[-*+]\s+\[( |x)\]\s+/gim, "- ")
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, "$1$2")
    .replace(/(?<![\w*])\*([^*\s][^*]*?)\*(?!\w)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$1 ($2)")
    .replace(/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function Task({ done }: { done: boolean }) {
  return (
    <span className={cn("mr-1.5 inline-grid size-4 translate-y-0.5 place-items-center rounded-cv-xs border", done ? "border-cv-clay bg-cv-clay text-cv-on-clay" : "border-cv-line-strong")}>
      {done && <Check size={11} strokeWidth={3} />}
    </span>
  );
}

export const Markdown = memo(function Markdown({ text, compact }: { text: string; compact?: boolean }) {
  const blocks = parseBlocks(text);
  return (
    <div className={cn("cv-prose min-w-0 font-cv-serif font-cv-body text-cv-text [overflow-wrap:anywhere]", compact ? "text-cv-ui" : "text-cv-prose")}>
      {blocks.map((b, i) => {
        switch (b.t) {
          case "p":
            return <p key={i} className="my-3 first:mt-0 last:mb-0"><Inline text={b.text} /></p>;
          case "h":
            return <div key={i} role="heading" aria-level={b.level} className={cn("mt-6 mb-2 font-cv-strong text-cv-text first:mt-0", HEADING[b.level - 1])}><Inline text={b.text} /></div>;
          case "code":
            return <CodeBlock key={i} code={b.text} lang={b.lang} />;
          case "quote":
            return <blockquote key={i} className="my-3 border-l-2 border-cv-line-strong pl-4 text-cv-text-2"><Inline text={b.text} /></blockquote>;
          case "hr":
            return <hr key={i} className="my-6 border-cv-line" />;
          case "list": {
            const Tag = b.ordered ? "ol" : "ul";
            return (
              <Tag key={i} className="my-3 space-y-1.5 first:mt-0 last:mb-0">
                {b.items.map((it, j) => {
                  const task = /^\[( |x|X)\]\s+/.exec(it.text);
                  return (
                    <li key={j} className="flex gap-2.5" style={{ paddingLeft: it.depth * 22 }}>
                      {!task && <span className={cn("shrink-0 text-right text-cv-muted", b.ordered ? "min-w-5 tabular-nums" : "w-3")}>{b.ordered ? `${it.n}.` : it.depth % 2 ? "◦" : "•"}</span>}
                      <span className="min-w-0 flex-1">{task && <Task done={task[1] !== " "} />}<Inline text={task ? it.text.slice(task[0].length) : it.text} /></span>
                    </li>
                  );
                })}
              </Tag>
            );
          }
          case "table":
            return (
              <div key={i} className="cv-scroll my-4 overflow-x-auto rounded-cv-md border border-cv-line">
                <table className="w-full min-w-max border-collapse font-cv-sans text-cv-ui">
                  <thead className="bg-cv-sunken">
                    <tr>{b.head.map((c, j) => <th key={j} className="border-b border-cv-line px-3.5 py-2 text-left font-cv-strong text-cv-text"><Inline text={c} /></th>)}</tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, j) => (
                      <tr key={j} className="border-b border-cv-line-soft last:border-0">{r.map((c, k) => <td key={k} className="max-w-96 px-3.5 py-2 align-top text-cv-text-2"><Inline text={c} /></td>)}</tr>
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

/** A small Markdown renderer for assistant text in Claude's reading style (no HTML is ever injected). */
import { cn } from "@neuralagent/ui";
import { Check, Copy, Image as ImageIcon, WrapText } from "lucide-react";
import { Fragment, memo, useState, type ReactNode } from "react";
import { usePlatform } from "../../lib/store";

type Block =
  | { t: "p"; text: string }
  | { t: "h"; level: number; text: string }
  | { t: "code"; lang: string; text: string }
  | { t: "quote"; text: string }
  | { t: "list"; ordered: boolean; items: Item[] }
  | { t: "table"; head: string[]; rows: string[][] }
  | { t: "hr" };

type Item = { text: string; depth: number; n: number; code?: { lang: string; text: string }[] };

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
      const items: Item[] = [];
      while (i < lines.length) {
        const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]!);
        const inner = items.length ? /^\s{2,}(```+|~~~+)\s*([\w+#.-]*)/.exec(lines[i]!) : null;
        if (m) {
          items.push({ text: m[3]!, depth: Math.min(3, Math.floor(m[1]!.replace(/\t/g, "  ").length / 2)), n: parseInt(m[2]!, 10) || items.length + 1 });
          i++;
        } else if (inner) {
          // A fenced block inside a list item stays in the item (the list goes on after it).
          const indent = /^\s*/.exec(lines[i]!)![0].length;
          const body: string[] = [];
          i++;
          while (i < lines.length && !lines[i]!.trim().startsWith(inner[1]!)) body.push(lines[i++]!.slice(Math.min(indent, /^\s*/.exec(lines[i - 1]!)![0].length)));
          i++;
          const it = items[items.length - 1]!;
          (it.code ??= []).push({ lang: inner[2] ?? "", text: body.join("\n") });
        } else if (!lines[i]!.trim() && /^(\s*)([-*+]|\d+[.)])\s+/.test(lines[i + 1] ?? "")) {
          i++; // a loose list: a blank line between items
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

const INLINE = /!\[([^\]]*)\]\(([^)\s]+)\)|(`+)([^`]+?)\3|\*\*([^*]+?)\*\*|__([^_]+?)__|\*([^*\s][^*]*?)\*|(?<![\w])_([^_\s][^_]*?)_(?![\w])|~~([^~]+?)~~|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<)]+[^\s<).,;:!?])/g;

function Inline({ text }: { text: string }) {
  const platform = usePlatform();
  const nodes: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const key = k++;
    if (m[2] !== undefined) {
      // Pictures in Markdown are never fetched: a quiet chip with the alt text.
      nodes.push(
        <span key={key} title={m[2]} className="inline-flex max-w-full items-center gap-1 rounded-cv-xs bg-cv-chip px-1.5 align-baseline font-cv-sans text-cv-meta text-cv-text-2">
          <ImageIcon size={12} strokeWidth={1.8} className="shrink-0" />
          <span className="truncate">{m[1] || m[2].split("/").pop()}</span>
        </span>,
      );
    } else if (m[4] !== undefined) nodes.push(<code key={key} className="rounded-cv-xs bg-cv-code-bg px-1 py-px font-cv-mono text-cv-code text-cv-code-ink [overflow-wrap:anywhere]">{m[4]}</code>);
    else if (m[5] !== undefined || m[6] !== undefined) nodes.push(<strong key={key} className="font-cv-strong text-cv-text"><Inline text={(m[5] ?? m[6])!} /></strong>);
    else if (m[7] !== undefined || m[8] !== undefined) nodes.push(<em key={key}><Inline text={(m[7] ?? m[8])!} /></em>);
    else if (m[9] !== undefined) nodes.push(<del key={key} className="text-cv-muted"><Inline text={m[9]} /></del>);
    else {
      const href = m[11] ?? m[12]!;
      const label = m[10] ?? m[12]!;
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

const CODE_LINES = 24;

/**
 * Code in a sunken box: language and Copy in a header strip, no wrap by default (scrolls
 * sideways; "Wrap" toggles), long blocks clamp to 24 lines. On phones it spans the full screen
 * width (the column gutter is 16 px) to gain room for code.
 */
export function CodeBlock({ code, lang, bare }: { code: string; lang?: string; bare?: boolean }) {
  const [wrap, setWrap] = useState(false);
  const [all, setAll] = useState(false);
  const lines = code.split("\n");
  const long = lines.length > CODE_LINES;
  const shown = long && !all ? lines.slice(0, CODE_LINES).join("\n") : code;
  return (
    <div className={cn("group/code overflow-hidden border-cv-line-soft bg-cv-sunken font-cv-sans", bare ? "rounded-cv-md border" : "cv-bleed my-4")}>
      <div className="flex h-8 items-center gap-1 pr-1 pl-3.5 text-cv-meta text-cv-muted">
        <span className="min-w-0 flex-1 truncate">{lang || "text"}</span>
        <button type="button" onClick={() => setWrap(!wrap)} aria-pressed={wrap} aria-label={wrap ? "Don't wrap lines" : "Wrap lines"} title="Wrap" className={cn("relative grid size-7 place-items-center rounded-cv-sm transition-colors after:absolute after:-inset-1.5 hover:bg-cv-hover", wrap ? "text-cv-text" : "text-cv-muted")}>
          <WrapText size={14} strokeWidth={1.8} />
        </button>
        <CopyButton text={code} label="Copy code" />
      </div>
      <pre className={cn("px-3.5 pb-3 font-cv-mono text-cv-code text-cv-text", wrap ? "whitespace-pre-wrap [overflow-wrap:anywhere]" : "cv-thin overflow-x-auto")}>{shown}</pre>
      {long && (
        <button type="button" onClick={() => setAll(!all)} className="h-9 w-full border-t border-cv-line-soft text-cv-meta text-cv-muted transition-colors hover:bg-cv-hover hover:text-cv-text">
          {all ? "Show less" : `Show all ${lines.length} lines`}
        </button>
      )}
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
            return <div key={i} role="heading" aria-level={b.level} className={cn("mt-5 mb-1.5 font-cv-strong text-cv-text first:mt-0", HEADING[b.level - 1])}><Inline text={b.text} /></div>;
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
                    <li key={j} className="flex gap-2.5" style={{ paddingLeft: `calc(${it.depth} * var(--cv-indent))` }}>
                      {!task && <span className={cn("shrink-0 text-right text-cv-muted", b.ordered ? "min-w-5 tabular-nums" : "w-3")}>{b.ordered ? `${it.n}.` : it.depth % 2 ? "◦" : "•"}</span>}
                      <span className="min-w-0 flex-1">
                        {task && <Task done={task[1] !== " "} />}
                        <Inline text={task ? it.text.slice(task[0].length) : it.text} />
                        {it.code?.map((c, k) => (
                          <div key={k} className="mt-2"><CodeBlock code={c.text} lang={c.lang} bare /></div>
                        ))}
                      </span>
                    </li>
                  );
                })}
              </Tag>
            );
          }
          case "table":
            return (
              <Table key={i} head={b.head} rows={b.rows} />
            );
        }
      })}
    </div>
  );
});

/**
 * A table that scrolls sideways inside its own box (never the page). On phones it spans the
 * screen width; with more than two columns the first one stays put while the rest scroll.
 */
function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  const sticky = head.length > 2;
  const first = (k: number) => sticky && k === 0 && "sticky left-0 z-1 bg-cv-bg";
  return (
    <div className="cv-bleed cv-thin my-4 overflow-x-auto overscroll-x-contain">
      <table className="w-full min-w-max border-collapse font-cv-sans text-cv-ui">
        <thead>
          <tr>
            {head.map((c, j) => (
              <th key={j} className={cn("cv-cell border-b border-cv-line px-3 py-2 text-left align-bottom font-cv-strong text-cv-text", first(j))}>
                <Inline text={c} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, j) => (
            <tr key={j} className="border-b border-cv-line-soft last:border-0">
              {r.map((c, k) => (
                <td key={k} className={cn("cv-cell px-3 py-2 align-top text-cv-text-2", first(k))}>
                  <Inline text={c} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

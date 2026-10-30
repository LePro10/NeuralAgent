/**
 * A menu the CLI shows right now (permission, question, plan approval), as a card docked above
 * the composer like Claude's: "Allow Claude to edit form.ts?" with Deny / Always allow / Allow
 * once, or a question with numbered options. Choosing types the option's number into the CLI.
 */
import type { CvPrompt } from "@neuralagent/protocol";
import { cn } from "@neuralagent/ui";
import { SquareTerminal, X } from "lucide-react";
import type { ReactNode } from "react";
import { useClient } from "../../lib/store";
import { changeRows, Diff, toolTitle, type Use } from "./tools";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

interface Permission {
  allow: string;
  /** The "Yes, and …" option: a button label and the CLI's explanation. */
  always?: { n: string; label: string; note: string };
  deny?: string;
  rest: { n: string; label: string }[];
}

/** "Yes" / "Yes, and don't ask again for rm" / "No, and tell Claude…" → buttons; null for other menus. */
export function asPermission(p: CvPrompt): Permission | null {
  const allow = p.options.find((o) => /^yes\.?$/i.test(o.label.trim()));
  if (!allow) return null;
  const always = p.options.find((o) => /^yes,\s*(and|allow|don)/i.test(o.label));
  const deny = p.options.find((o) => /^no\b/i.test(o.label));
  const rest = p.options.filter((o) => o !== allow && o !== always && o !== deny).map((o) => ({ n: o.n, label: o.label }));
  const note = always
    ? always.label
        .replace(/^yes,\s*(and\s*)?/i, "")
        .replace(/\s*\((?:shift\+tab|esc)\)\s*/gi, " ")
        .replace(/\s*\([^)]*\)/g, "")
        .trim()
    : "";
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  // "don't ask again for …" is Claude's "Always allow"; "switch to auto mode · …" keeps its own words.
  const [first = "", ...more] = note.split(/\s+·\s+/);
  const plain = /don.?t ask again|always/i.test(first);
  const label = plain || !first ? "Always allow" : cap(first.replace(/\s+for this session$/i, ""));
  const hint = plain ? cap(note) : cap(more.join(" · "));
  return { allow: allow.n, always: always && { n: always.n, label, note: hint }, deny: deny?.n, rest };
}

function verbFor(use: Use | null): { verb: string; target?: string } | null {
  if (!use) return null;
  const input = (use.input ?? {}) as Record<string, unknown>;
  const file = str(input.file_path ?? input.notebook_path);
  switch (use.name) {
    case "Bash":
      return { verb: "run", target: "this command" };
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return { verb: "edit", target: file };
    case "Write":
      return { verb: "write", target: file };
    case "Read":
      return { verb: "read", target: file };
    case "WebFetch":
      return { verb: "fetch", target: str(input.url) };
    case "WebSearch":
      return { verb: "search the web for", target: str(input.query) };
    default:
      return { verb: "use", target: toolTitle(use.name).title };
  }
}

/** The CLI's menu text: the tool header, the boxed command or diff (between ``` lines), the rest. */
export function parseTitle(title: string): { header: string; boxed: string; lines: string[]; question: string } {
  const boxed: string[] = [];
  const text: string[] = [];
  let inBox = false;
  for (const raw of title.split("\n")) {
    const l = raw.trim();
    if (l === "```") inBox = !inBox;
    else (inBox ? boxed : text).push(inBox ? raw : l);
  }
  const lines = text.filter((l) => !/^tip:/i.test(l));
  const question = [...lines].reverse().find((l) => /\?$/.test(l)) ?? "";
  return { header: lines.find(Boolean) ?? "", boxed: boxed.join("\n").trim(), lines, question };
}

function verbFromHeader(header: string): { verb: string; target?: string } | null {
  if (/^bash command/i.test(header)) return { verb: "run", target: "this command" };
  const m = /^(edit|create|write|read)\b.*\bfile/i.exec(header);
  return m ? { verb: m[1]!.toLowerCase(), target: "this file" } : null;
}

function Btn({ children, kind, onClick, phone }: { children: ReactNode; kind: "primary" | "secondary" | "ghost"; onClick: () => void; phone: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center justify-center rounded-full px-4 font-cv-sans text-cv-ui transition duration-150 active:scale-97",
        phone ? "min-h-12 w-full py-2 text-center" : "h-9",
        kind === "primary" && "bg-cv-primary text-cv-on-primary hover:opacity-90",
        kind === "secondary" && "border border-cv-line bg-cv-surface text-cv-text hover:bg-cv-hover",
        kind === "ghost" && "text-cv-text-2 hover:bg-cv-hover hover:text-cv-text",
      )}
    >
      {children}
    </button>
  );
}

export function PromptCard({ sid, prompt, pending, cwd, phone, onTerminal }: {
  sid: string;
  prompt: CvPrompt;
  /** The tool call waiting for this answer, if any. */
  pending: Use | null;
  cwd: string;
  phone: boolean;
  onTerminal: () => void;
}) {
  const client = useClient();
  const choose = (n: string) => client.write(sid, n);
  const perm = asPermission(prompt);
  const { header, boxed, lines, question } = parseTitle(prompt.title);
  const rel = (p: string) => (cwd && p.startsWith(`${cwd.replace(/\/+$/, "")}/`) ? p.slice(cwd.replace(/\/+$/, "").length + 1) : p);
  const v = perm ? (verbFor(pending) ?? verbFromHeader(header)) : null;
  const input = (pending?.input ?? {}) as Record<string, unknown>;
  const rows = pending ? changeRows(pending) : null;
  const isCommand = pending ? pending.name === "Bash" : /^bash command/i.test(header);
  const command = pending?.name === "Bash" ? str(input.command) : isCommand ? boxed : "";
  // What the CLI says beyond the question, minus the tool header and what the card already shows.
  const shown = pending ? JSON.stringify(pending.input ?? {}) : "";
  const extra = perm
    ? lines
        .filter((l) => l && l !== question && !(v && l === header) && !(shown && shown.includes(JSON.stringify(l).slice(1, -1))))
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
    : "";

  const head = perm ? (
    v ? (
      <>
        Allow Claude to <span className="font-cv-strong">{v.verb}</span>{" "}
        {v.target && (v.target.startsWith("this ") ? v.target : <span className="rounded-cv-xs bg-cv-chip px-1.5 py-px font-cv-mono text-cv-code text-cv-text-2 [overflow-wrap:anywhere]" title={v.target}>{/^(edit|write|read)$/.test(v.verb) ? (v.target.split(/[\\/]/).pop() ?? v.target) : rel(v.target)}</span>)}?
      </>
    ) : (
      question || lines[0] || "Allow this action?"
    )
  ) : (
    prompt.title.trim() || "Claude is asking"
  );

  return (
    <div
      role="group"
      aria-label={perm ? "Permission request" : "Claude is asking"}
      className="cv-scroll relative mb-2 overflow-y-auto rounded-cv-card bg-cv-surface font-cv-sans text-cv-text shadow-cv-card animate-cv-rise"
      style={{ maxHeight: "min(60vh, 560px)" }}
    >
      <div className="sticky top-0 z-10 flex items-start gap-2 bg-cv-surface px-4 pt-3.5 pb-1">
        <div className={cn("min-w-0 flex-1 pt-1 text-cv-ui whitespace-pre-wrap [overflow-wrap:anywhere]", !perm && "font-cv-strong")}>{head}</div>
        <button type="button" onClick={onTerminal} aria-label="Open the terminal" title="Open the terminal" className="relative grid size-8 shrink-0 place-items-center rounded-full text-cv-muted transition-colors hover:bg-cv-hover hover:text-cv-text after:absolute after:-inset-1.5">
          <SquareTerminal size={17} strokeWidth={1.7} />
        </button>
        <button type="button" onClick={() => client.write(sid, "\x1b")} aria-label="Dismiss (Esc)" title="Dismiss (Esc)" className="relative grid size-8 shrink-0 place-items-center rounded-full bg-cv-chip text-cv-text-2 transition-colors hover:bg-cv-press after:absolute after:-inset-1.5">
          <X size={16} strokeWidth={2} />
        </button>
      </div>

      {perm ? (
        <div className="px-4 pt-2 pb-4">
          {command && (
            <div className="rounded-cv-md border border-cv-line-soft bg-cv-sunken px-3.5 py-2.5">
              <pre className="cv-scroll max-h-40 overflow-auto font-cv-mono [[data-mode=phone]_&]:max-h-28 text-cv-code whitespace-pre-wrap text-cv-text [overflow-wrap:anywhere]">{command}</pre>
              {str(input.description) && <div className="mt-1.5 text-cv-meta text-cv-muted">{str(input.description)}</div>}
            </div>
          )}
          {rows && <Diff rows={rows} path={rel(str(input.file_path ?? input.notebook_path))} max={phone ? 10 : 14} />}
          {!command && !rows && boxed && (
            <pre className="cv-scroll max-h-48 overflow-auto rounded-cv-md border border-cv-line-soft bg-cv-sunken px-3.5 py-2.5 font-cv-mono text-cv-code whitespace-pre-wrap text-cv-text-2">{boxed}</pre>
          )}
          {extra && <div className={cn("text-cv-meta whitespace-pre-wrap text-cv-muted [overflow-wrap:anywhere]", (command || rows || boxed) && "mt-2.5")}>{extra}</div>}
          {perm.always?.note && perm.always.label === "Always allow" && <div className="mt-3 text-cv-meta text-cv-muted">{perm.always.label}: {perm.always.note}</div>}
          <div className={cn("mt-3.5 flex gap-2", phone ? "flex-col" : "flex-wrap items-center justify-end")}>
            {perm.rest.map((o) => (
              <Btn key={o.n} kind="ghost" phone={phone} onClick={() => choose(o.n)}>{o.label}</Btn>
            ))}
            {perm.deny && <Btn kind={phone ? "secondary" : "ghost"} phone={phone} onClick={() => choose(perm.deny!)}>Deny</Btn>}
            {perm.always && <Btn kind="secondary" phone={phone} onClick={() => choose(perm.always!.n)}>{perm.always.label}</Btn>}
            <Btn kind="primary" phone={phone} onClick={() => choose(perm.allow)}>Allow once</Btn>
          </div>
        </div>
      ) : (
        <div className="px-2 pt-2 pb-2">
          {prompt.options.map((o, i) => (
            <button
              key={o.n}
              type="button"
              onClick={() => choose(o.n)}
              className={cn(
                "flex min-h-12 w-full items-center gap-3 rounded-cv-sm px-2.5 py-2 text-left text-cv-ui transition-colors hover:bg-cv-hover active:bg-cv-press",
                i > 0 && "border-t border-cv-line-soft",
                phone && "min-h-13",
              )}
            >
              <span className={cn("grid size-6 shrink-0 place-items-center rounded-full font-cv-mono text-cv-meta", o.selected ? "bg-cv-primary text-cv-on-primary" : "bg-cv-chip text-cv-text-2")}>{o.n}</span>
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

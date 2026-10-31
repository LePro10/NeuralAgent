/**
 * A menu the CLI shows right now, docked where the composer sits (on phones it takes the
 * composer's place). `PromptCard` picks the card: permission ("Allow Claude to edit form.ts?"
 * with Allow once / Always allow / Deny, and "Tell Claude what to do instead"), plan approval
 * (`PlanCard`), AskUserQuestion (`QuestionCard`), or any other menu as a list of its options
 * with the terminal as the fallback. Answers go through `act` (the daemon's `CvAction` when it
 * plays them, else the client types the keys).
 */
import type { CvMeta, CvOption, CvPrompt } from "@neuralagent/protocol";
import { cn, toast } from "@neuralagent/ui";
import { Check, MessageSquareText } from "lucide-react";
import { useEffect, useState } from "react";
import { useClient } from "../../lib/store";
import { act, runKeys, serverActions, takeRewind } from "./actions";
import { AnswerField, Btn, DockCard } from "./DockCard";
import { PlanCard } from "./PlanCard";
import { denyKeys, freeTextKeys, pickKeys, promptKind, promptTool, screenOptions } from "./promptState";
import { QuestionCard } from "./QuestionSheet";
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

export interface PromptCardProps {
  sid: string;
  prompt: CvPrompt;
  /** The tool call waiting for this answer, if any. */
  pending: Use | null;
  cwd: string;
  phone: boolean;
  meta?: CvMeta;
  onTerminal: () => void;
}

const fail = (e: unknown): void => void toast(e instanceof Error ? e.message : "That did not work. Try again.", { tone: "danger" });

/** The card for the CLI's current menu. */
export function PromptCard(props: PromptCardProps) {
  const { sid, prompt, pending, meta } = props;
  const client = useClient();
  const live = serverActions(meta);
  // `prompt_id`: the fingerprint of the prompt on screen, so the daemon refuses the answer when the
  // terminal has moved on to another question (the refusal shows as a toast).
  const answer = (o: Pick<CvOption, "n" | "nav">, text?: string) =>
    act(client, sid, live, { k: "answer", n: o.n, ...(o.nav != null ? { nav: o.nav } : {}), ...(text ? { text } : {}), ...(prompt.id ? { prompt_id: prompt.id } : {}) }, text ? freeTextKeys(o.n, text) : pickKeys(o)).catch(fail);
  const dismiss = () => void act(client, sid, live, { k: "interrupt" }, [{ write: "\x1b" }]).catch(fail);

  // The restore menu of a rewind the user already chose in the app: answer it, show nothing.
  const [skip, setSkip] = useState<CvPrompt | null>(null);
  useEffect(() => {
    const n = takeRewind(sid, prompt.options);
    if (!n) return;
    setSkip(prompt);
    void runKeys(client, sid, [{ write: n }]);
  }, [client, sid, prompt]);
  if (skip === prompt) return null;

  const kind = promptKind(prompt, pending);
  const common = { ...props, answer, dismiss };
  if (kind === "plan") return <PlanCard {...common} />;
  if (kind === "question") return <QuestionCard {...common} />;
  if (kind === "permission" && asPermission(prompt)) return <PermissionCard {...common} live={live} />;
  return <MenuCard {...common} confirm={kind === "confirm" || kind === "review"} />;
}

export interface CardProps extends PromptCardProps {
  answer: (o: Pick<CvOption, "n" | "nav">, text?: string) => Promise<void>;
  dismiss: () => void;
}

function PermissionCard({ sid, prompt, pending, cwd, phone, onTerminal, answer, dismiss, live }: CardProps & { live: boolean }) {
  const client = useClient();
  const [telling, setTelling] = useState(false);
  const perm = asPermission(prompt)!;
  const tool = (promptTool(prompt, pending) as Use | null) ?? null;
  const agent = (prompt.tool?.agent || null) as string | null;
  const { header, boxed, lines, question } = parseTitle(prompt.title);
  const rel = (p: string) => (cwd && p.startsWith(`${cwd.replace(/\/+$/, "")}/`) ? p.slice(cwd.replace(/\/+$/, "").length + 1) : p);
  const v = verbFor(tool) ?? verbFromHeader(header);
  const input = (tool?.input ?? {}) as Record<string, unknown>;
  const rows = tool ? changeRows(tool) : null;
  const isCommand = tool ? tool.name === "Bash" : /^bash command/i.test(header);
  const command = tool?.name === "Bash" ? str(input.command) : isCommand ? boxed : "";
  // What the CLI says beyond the question, minus the tool header and what the card already shows.
  const shown = tool ? JSON.stringify(tool.input ?? {}) : "";
  const extra = lines
    .filter((l) => l && l !== question && !(v && l === header) && !(shown && shown.includes(JSON.stringify(l).slice(1, -1))))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
  const opt = (n: string) => prompt.options.find((o) => o.n === n) ?? { n };
  const denyOpt = perm.deny ? screenOptions(prompt).find((o) => o.n === perm.deny) : undefined;
  const tell = (reason: string) => {
    if (!perm.deny) return;
    // The daemon types the reason into the menu's own field; the client says no and sends the reason.
    if (live) void answer(opt(perm.deny), reason);
    else void runKeys(client, sid, denyKeys(perm.deny, reason, !!denyOpt?.free)).catch(fail);
  };

  const head = v ? (
    <>
      Allow Claude to <span className="font-cv-strong">{v.verb}</span>{" "}
      {v.target && (v.target.startsWith("this ") ? v.target : <span className="rounded-cv-xs bg-cv-chip px-1.5 py-px font-cv-mono text-cv-code text-cv-text-2 [overflow-wrap:anywhere]" title={v.target}>{/^(edit|write|read)$/.test(v.verb) ? (v.target.split(/[\\/]/).pop() ?? v.target) : rel(v.target)}</span>)}?
    </>
  ) : (
    question || lines[0] || "Allow this action?"
  );
  const pairDenyAlways = phone && !!perm.always && !!perm.deny && !perm.rest.length;

  return (
    <DockCard
      label="Permission request"
      head={head}
      eyebrow={agent ? `${agent} (subagent) asks` : undefined}
      phone={phone}
      onTerminal={onTerminal}
      onDismiss={dismiss}
      footer={
        <>
          {telling && perm.deny ? (
            <div className="mb-2">
              <AnswerField placeholder="What should Claude do instead?" label="Tell Claude what to do instead" autoFocus onSend={tell} />
            </div>
          ) : null}
          <div className={phone ? (pairDenyAlways ? "grid grid-cols-2 gap-2" : "flex flex-col gap-2") : "flex flex-wrap items-center justify-end gap-2"}>
            {perm.rest.map((o) => (
              <Btn key={o.n} kind="ghost" phone={phone} className={cn(pairDenyAlways && "col-span-2")} onClick={() => void answer(opt(o.n))}>
                {o.label}
              </Btn>
            ))}
            {perm.deny && !phone && !telling && (
              <Btn kind="ghost" phone={phone} onClick={() => setTelling(true)}>
                <MessageSquareText size={15} className="mr-1.5" />
                Tell Claude instead
              </Btn>
            )}
            {perm.deny && (
              <Btn kind="secondary" phone={phone} onClick={() => void answer(opt(perm.deny!))}>
                Deny
              </Btn>
            )}
            {perm.always && (
              <Btn kind="secondary" phone={phone} onClick={() => void answer(opt(perm.always!.n))}>
                {perm.always.label}
              </Btn>
            )}
            <Btn kind="primary" phone={phone} className={cn(pairDenyAlways && "col-span-2")} onClick={() => void answer(opt(perm.allow))}>
              Allow once
            </Btn>
          </div>
          {perm.deny && phone && !telling && (
            <button type="button" onClick={() => setTelling(true)} className="mx-auto mt-1 flex h-11 items-center gap-1.5 rounded-full px-3 text-cv-meta text-cv-text-2 hover:bg-cv-hover">
              <MessageSquareText size={14} />
              Tell Claude what to do instead
            </button>
          )}
        </>
      }
    >
      <div className="px-4 pt-1 pb-3">
        {command && (
          <div className="rounded-cv-md border border-cv-line-soft bg-cv-sunken px-3.5 py-2.5">
            <pre className="font-cv-mono text-cv-code whitespace-pre-wrap text-cv-text [overflow-wrap:anywhere]">{command}</pre>
            {str(input.description) && <div className="mt-1.5 text-cv-meta text-cv-muted">{str(input.description)}</div>}
          </div>
        )}
        {rows && <Diff rows={rows} path={rel(str(input.file_path ?? input.notebook_path))} max={phone ? 40 : 60} />}
        {!command && !rows && boxed && <pre className="rounded-cv-md border border-cv-line-soft bg-cv-sunken px-3.5 py-2.5 font-cv-mono text-cv-code whitespace-pre-wrap text-cv-text-2 [overflow-wrap:anywhere]">{boxed}</pre>}
        {extra && <div className={cn("text-cv-meta whitespace-pre-wrap text-cv-muted [overflow-wrap:anywhere]", (command || rows || boxed) && "mt-2.5")}>{extra}</div>}
        {perm.always?.note && perm.always.label === "Always allow" && <div className="mt-2.5 text-cv-meta text-cv-muted">Always allow: {perm.always.note}</div>}
      </div>
    </DockCard>
  );
}

/** Any other menu: its options as rows (or buttons for a short yes/no), the terminal for the rest. */
function MenuCard({ prompt, phone, onTerminal, answer, dismiss, confirm }: CardProps & { confirm: boolean }) {
  const opts = screenOptions(prompt);
  const [typing, setTyping] = useState<string | null>(null);
  const { lines, boxed } = parseTitle(prompt.title);
  const head = lines.filter(Boolean).join("\n") || "Claude Code is asking";
  const pick = (i: number) => {
    const o = opts[i]!;
    if (o.free) return setTyping(o.n || String(i));
    void answer(prompt.options[i]!);
  };
  const short = confirm && opts.length <= 3 && opts.every((o) => o.label.length <= 28 && !o.free);

  return (
    <DockCard
      label="Claude Code is asking"
      head={<span className="font-cv-strong">{head}</span>}
      phone={phone}
      onTerminal={onTerminal}
      onDismiss={dismiss}
      footer={
        short ? (
          <div className={cn("flex gap-2", phone ? "flex-col-reverse" : "justify-end")}>
            {opts.map((o, i) => (
              <Btn key={o.n || i} kind={o.selected ? "primary" : "secondary"} phone={phone} onClick={() => pick(i)}>
                {o.label}
              </Btn>
            ))}
          </div>
        ) : (
          <button type="button" onClick={onTerminal} className="flex h-11 w-full items-center justify-center rounded-full text-cv-meta text-cv-text-2 hover:bg-cv-hover">
            Something missing? Open the terminal
          </button>
        )
      }
    >
      {boxed && <pre className="mx-4 mb-2 rounded-cv-md border border-cv-line-soft bg-cv-sunken px-3.5 py-2.5 font-cv-mono text-cv-code whitespace-pre-wrap text-cv-text-2 [overflow-wrap:anywhere]">{boxed}</pre>}
      {!short && (
        <div className="px-2 pb-2" role="listbox" aria-label="Options">
          {opts.map((o, i) => (
            <div key={o.n || i} className={cn(i > 0 && "border-t border-cv-line-soft")}>
              <button
                type="button"
                role="option"
                aria-selected={o.selected}
                onClick={() => pick(i)}
                className="flex min-h-12 w-full items-center gap-3 rounded-cv-sm px-2.5 py-2 text-left text-cv-ui transition-colors hover:bg-cv-hover active:bg-cv-press [[data-mode=phone]_&]:min-h-13"
              >
                {o.checked !== undefined ? (
                  <span className={cn("grid size-5 shrink-0 place-items-center rounded-cv-xs border", o.checked ? "border-cv-primary bg-cv-primary text-cv-on-primary" : "border-cv-line-strong")}>{o.checked && <Check size={13} strokeWidth={2.6} />}</span>
                ) : (
                  <span className={cn("grid size-6 shrink-0 place-items-center rounded-full font-cv-mono text-cv-meta", o.selected ? "bg-cv-primary text-cv-on-primary" : "bg-cv-chip text-cv-text-2")}>{o.n || "·"}</span>
                )}
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                  {o.label}
                  {o.description && <span className="block text-cv-meta text-cv-muted">{o.description}</span>}
                </span>
              </button>
              {typing === (o.n || String(i)) && (
                <div className="px-2 pb-2">
                  <AnswerField placeholder={o.label} label={o.label} autoFocus onSend={(t) => void answer(prompt.options[i]!, t)} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </DockCard>
  );
}

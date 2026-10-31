/**
 * What kind of menu the CLI shows (permission, plan approval, question, confirm, other menu)
 * and the keys that answer it. The daemon reads the menu off the terminal screen (`CvPrompt`);
 * the pending tool call adds what the screen cuts off (the plan text, all questions).
 * Pure (no React) so it can be tested; `runKeys` in actions.ts plays the steps.
 */
import type { CvOption, CvPrompt } from "@neuralagent/protocol";

export type PromptKind = "permission" | "plan" | "question" | "review" | "confirm" | "menu";

/** A pending tool call (the `tool_use` block without its result). */
export interface PendingUse {
  name: string;
  input: unknown;
}

/** `CvPrompt` (CONTRACT-protocol: kind, tool, question, plan are optional, absent from older daemons). */
export type PromptX = CvPrompt & { free_text?: string | null };
type OptionX = CvOption;

const KINDS = new Set<PromptKind>(["permission", "plan", "question", "review", "confirm", "menu"]);

const labels = (p: CvPrompt) => p.options.map((o) => o.label.trim());

export function isPlanPrompt(p: CvPrompt, pending?: PendingUse | null): boolean {
  if (pending?.name === "ExitPlanMode") return true;
  return labels(p).some((l) => /keep planning|auto-accept edits|manually approve edits/i.test(l));
}

export function isQuestionPrompt(p: CvPrompt, pending?: PendingUse | null): boolean {
  if (pending?.name === "AskUserQuestion" && !isReviewPrompt(p)) return true;
  return labels(p).some((l) => /^type something\.?$|^chat about this$/i.test(stripBox(l)));
}

/** AskUserQuestion's last step: "Review your answers" with Submit answers / Cancel. */
export function isReviewPrompt(p: CvPrompt): boolean {
  return labels(p).some((l) => /^submit answers$/i.test(l)) || /review your answers/i.test(p.title);
}

const YES = /^yes\.?$/i;

export function promptKind(p: CvPrompt, pending?: PendingUse | null): PromptKind {
  const k = (p as PromptX).kind;
  if (k && KINDS.has(k as PromptKind)) {
    if (k === "question" && isReviewPrompt(p)) return "review";
    return k as PromptKind;
  }
  if (isReviewPrompt(p)) return "review";
  if (isPlanPrompt(p, pending)) return "plan";
  if (isQuestionPrompt(p, pending)) return "question";
  if (p.options.some((o) => YES.test(o.label.trim()))) return "permission";
  const ls = labels(p);
  if (ls.length <= 3 && ls.some((l) => /^(yes|no|ok|cancel|continue|proceed)\b/i.test(l))) return "confirm";
  return "menu";
}

// ── questions (AskUserQuestion) ──

export interface QOption {
  label: string;
  description?: string;
}
export interface Question {
  question: string;
  header?: string;
  multiSelect: boolean;
  options: QOption[];
}

const s = (v: unknown) => (typeof v === "string" ? v : "");

/** The questions of the AskUserQuestion call: from the daemon's prompt, else the pending tool call. */
export function questionsOf(pending?: PendingUse | null, prompt?: CvPrompt | null): Question[] {
  const fromDaemon = (prompt as PromptX | null | undefined)?.question?.questions;
  if (fromDaemon?.length) {
    return fromDaemon.map((q) => ({
      question: q.question ?? "",
      header: q.header || undefined,
      multiSelect: !!q.multi_select,
      options: (q.options ?? []).map((o) => ({ label: o.label, description: o.description || undefined })),
    }));
  }
  if (pending?.name !== "AskUserQuestion") return [];
  const qs = (pending.input as { questions?: unknown })?.questions;
  if (!Array.isArray(qs)) return [];
  return qs.flatMap((q): Question[] => {
    if (!q || typeof q !== "object") return [];
    const r = q as Record<string, unknown>;
    const opts = Array.isArray(r.options) ? r.options : [];
    return [
      {
        question: s(r.question),
        header: s(r.header) || undefined,
        multiSelect: r.multiSelect === true,
        options: opts.flatMap((o): QOption[] => {
          if (typeof o === "string") return [{ label: o }];
          if (!o || typeof o !== "object") return [];
          const x = o as Record<string, unknown>;
          return s(x.label) ? [{ label: s(x.label), description: s(x.description) || undefined }] : [];
        }),
      },
    ];
  });
}

/** "[✔] Tests" → checked; "[ ] Tests" → unchecked; otherwise undefined. */
export function checkState(label: string): { label: string; checked?: boolean } {
  const m = /^\s*\[([ xX✔✓☑•*])?\]\s*(.*)$/.exec(label);
  if (!m) return { label: label.trim() };
  return { label: m[2]!.trim(), checked: !!m[1] && m[1] !== " " };
}

const stripBox = (l: string) => checkState(l).label;

export interface ScreenOption {
  n: string;
  label: string;
  selected: boolean;
  checked?: boolean;
  /** "Type something." / "Tell Claude what to change": an option with its own text field. */
  free: boolean;
  description?: string;
}

const FREE = /^(type something\.?|type here.*|tell claude what to (change|do differently).*|other\.?)$/i;

export function screenOptions(p: CvPrompt): ScreenOption[] {
  const freeLabel = (p as PromptX).free_text;
  return p.options.map((o) => {
    const c = checkState(o.label);
    const x = o as OptionX;
    return {
      n: o.n,
      label: c.label,
      selected: o.selected,
      checked: x.checked ?? c.checked,
      free: x.text === true || (!!freeLabel && freeLabel === o.n) || FREE.test(c.label),
      description: x.description || undefined,
    };
  });
}

/** Which question tab the screen shows: the one whose options match the menu best. */
export function currentQuestion(qs: Question[], p: CvPrompt): number {
  if (qs.length <= 1) return 0;
  const tab = (p as PromptX).question?.tab;
  if (typeof tab === "number" && tab >= 0 && tab < qs.length) return tab;
  const shown = new Set(screenOptions(p).map((o) => o.label.toLowerCase()));
  let best = 0;
  let bestScore = -1;
  qs.forEach((q, i) => {
    const hit = q.options.filter((o) => shown.has(o.label.toLowerCase())).length;
    const titled = q.question && p.title.includes(q.question) ? 2 : 0;
    const score = hit + titled;
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
}

/** The plan text: the daemon's (from the pending ExitPlanMode call or the plan file), else the tool input. */
export function planText(p: CvPrompt, pending?: PendingUse | null): string {
  const own = (p as PromptX).plan;
  if (own) return own;
  const input = (pending?.name === "ExitPlanMode" ? pending.input : (p as PromptX).tool?.name === "ExitPlanMode" ? (p as PromptX).tool?.input : null) as { plan?: unknown } | null;
  return typeof input?.plan === "string" ? input.plan : "";
}

/** The tool the prompt is about: the daemon's (hook payload, right even with parallel calls), else the newest pending call. */
export function promptTool(p: CvPrompt, pending?: PendingUse | null): (PendingUse & { agent?: string | null }) | null {
  const t = (p as PromptX).tool;
  if (t?.name) return { name: t.name, input: t.input, agent: t.agent ?? null };
  return pending ?? null;
}

// ── key plans ──

export type Step = { write: string } | { wait: number } | { prompt: string };

/** Text typed into a CLI text field: one line, no control characters. */
export const typed = (t: string) => t.replace(/[\r\n]+/g, " ").replace(/[\x00-\x1f\x7f]/g, "").trim();

export const chooseKeys = (n: string): Step[] => [{ write: n }];

/** Pick the option that has its own text field, type into it, Enter. */
export function freeTextKeys(n: string, text: string): Step[] {
  return [{ write: n }, { wait: 250 }, { write: typed(text) }, { wait: 80 }, { write: "\r" }];
}

/**
 * Say no and tell Claude why: choose the "No" option (the CLI drops the call and waits for
 * input), then send the reason as the next message. Works whether the CLI asks for the reason
 * in the menu or at the prompt.
 */
export function denyKeys(denyN: string, reason: string, free: boolean): Step[] {
  const r = reason.trim();
  if (!r) return chooseKeys(denyN);
  if (free) return freeTextKeys(denyN, r);
  return [{ write: denyN }, { wait: 450 }, { prompt: r }];
}

/** Keep planning with feedback: the plan menu's text option when it has one, else "No" + message. */
export function planFeedbackKeys(p: CvPrompt, feedback: string): Step[] | null {
  const opts = screenOptions(p);
  const free = opts.find((o) => o.free);
  if (free) return freeTextKeys(free.n, feedback);
  const no = opts.find((o) => /^no\b/i.test(o.label));
  return no ? denyKeys(no.n, feedback, false) : null;
}

/** Plan approval buttons in the CLI's words; the first "Yes" is the primary one. */
export function planChoices(p: CvPrompt): { n: string; label: string; primary: boolean; reject: boolean }[] {
  const opts = screenOptions(p).filter((o) => !o.free);
  const firstYes = opts.find((o) => /^yes\b/i.test(o.label));
  return opts.map((o) => ({ n: o.n, label: planLabel(o.label), primary: o === firstYes, reject: /^no\b/i.test(o.label) }));
}

/** "Yes, and auto-accept edits (shift+tab)" → "Yes, and auto-accept edits". */
export const planLabel = (l: string) => l.replace(/\s*\((?:shift\+tab|esc|ctrl\+\w+)\)\s*$/i, "").trim();

/** Next question tab (multi-select questions do not move on by themselves). */
export const NEXT_TAB = "\x1b[C";
export const PREV_TAB = "\x1b[D";
export const ESC = "\x1b";

/** Keys for an option: its number, or (menus without numbers) arrows from the highlighted row and Enter. */
export function pickKeys(o: { n: string; nav?: number | null }): Step[] {
  if (o.n) return chooseKeys(o.n);
  const nav = o.nav ?? 0;
  const steps: Step[] = [];
  for (let i = 0; i < Math.abs(nav); i++) steps.push({ write: nav > 0 ? "\x1b[B" : "\x1b[A" }, { wait: 40 });
  return [...steps, { write: "\r" }];
}

/** Arrow presses from tab `from` to tab `to` of a question dialog. */
export function tabKeys(from: number, to: number): Step[] {
  const steps: Step[] = [];
  for (let i = 0; i < Math.abs(to - from); i++) steps.push({ write: to > from ? NEXT_TAB : PREV_TAB }, { wait: 60 });
  return steps;
}

/**
 * Things the Claude view does to the CLI by typing keys into its terminal: answer menus,
 * cycle the permission mode, shell mode, rewind, interrupt. Until the daemon runs these
 * itself (`CvAction`, A2 §3) the client plays the key sequences.
 */
import type { CvAction, CvMessage, Request } from "@neuralagent/protocol";
import type { Step } from "./promptState";

export interface Keys {
  write(sid: string, data: string): void;
  req<T = unknown>(r: Request): Promise<T>;
  cvAction?(sid: string, action: CvAction): Promise<void>;
}

/**
 * Whether the daemon plays `CvAction`s itself. The request type exists before the daemon
 * fills it (a stub answers `null` without doing anything), so this waits for a signal:
 * `meta.actions === true` (requested from I1, see notes-I4.md). Until then the client keys run.
 */
export const serverActions = (meta: unknown) => (meta as { actions?: boolean } | null)?.actions === true;

/** Runs `action` on the daemon when it can, else plays the client's key plan. */
export async function act(k: Keys, sid: string, live: boolean, action: CvAction, fallback: Step[]): Promise<void> {
  if (live && k.cvAction) return k.cvAction(sid, action);
  return runKeys(k, sid, fallback);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const sendPrompt = (k: Keys, sid: string, text: string) => k.req({ m: "session_prompt", p: { id: sid, text } });

/** Plays steps one after another. */
export async function runKeys(k: Keys, sid: string, steps: Step[]): Promise<void> {
  for (const s of steps) {
    if ("write" in s) k.write(sid, s.write);
    else if ("wait" in s) await sleep(s.wait);
    else await sendPrompt(k, sid, s.prompt);
  }
}

export const interrupt = (k: Keys, sid: string) => k.write(sid, "\x1b");

/** `!` shell mode: the `!` has to be typed (a pasted one stays text), then the command. */
export function shellSteps(command: string): Step[] {
  return [{ write: "!" }, { wait: 150 }, { prompt: command.trim() }];
}

/** `#` used to save a note to memory; the CLI dropped that, so Claude is asked to do it. */
export const memoryPrompt = (note: string) => `Add this to the project memory (CLAUDE.md), short and in the right section: ${note.trim()}`;

/** What the composer text means: `!ls` runs a shell command, `# note` goes to memory. */
export function inputMode(text: string): "shell" | "memory" | "prompt" {
  if (/^!/.test(text)) return "shell";
  if (/^#\s/.test(text)) return "memory";
  return "prompt";
}

export type Armed = "shell" | "memory" | null;

/**
 * Typing `!` into an empty composer, or `# ` after a typed `#`, arms a mode. Pasted, dropped or
 * dictated text, a restored draft and a multi-character change never do: they are sent as written.
 */
export function typedMode(prev: string, next: string, inputType: string | undefined): Armed {
  if (inputType !== "insertText") return null;
  if (prev === "" && next === "!") return "shell";
  if (prev === "#" && next === "# ") return "memory";
  return null;
}

/** What a send means: the armed mode (chip) decides, never the text's first character. */
export function resolveInput(armed: Armed, text: string): { mode: "shell" | "memory" | "prompt"; body: string } {
  const body = text.trim();
  return armed ? { mode: armed, body } : { mode: "prompt", body };
}

/**
 * The permission mode only cycles (Shift+Tab): step until `target` shows. Returns false when
 * the CLI does not offer it in this session (bypass and don't-ask need start flags).
 */
export async function cycleMode(k: Keys, sid: string, mode: () => string, target: string, steps = 7): Promise<boolean> {
  if (mode() === target) return true;
  const seen = new Set<string>([mode()]);
  for (let step = 0; step < steps; step++) {
    const before = mode();
    k.write(sid, "\x1b[Z");
    let waited = 0;
    while (mode() === before && waited < 1600) {
      await sleep(60);
      waited += 60;
    }
    if (mode() === target) return true;
    if (mode() === before || seen.has(mode())) return false;
    seen.add(mode());
  }
  return false;
}

// ── rewind ──

const textOf = (m: CvMessage) =>
  m.blocks
    .filter((b) => b.k === "text")
    .map((b) => (b as { text: string }).text)
    .join("\n");

/** A message the CLI lists in `/rewind`: something the user typed (not a command or tool result). */
export function isRewindable(m: CvMessage): boolean {
  if (m.role !== "user" || (m.kind && m.kind !== "prompt")) return false;
  return !!textOf(m).trim() || m.blocks.some((b) => b.k === "image");
}

/** 1 for the newest user message, 2 for the one before… (Up presses in the `/rewind` list). */
export function rewindDistance(messages: CvMessage[], id: string): number | null {
  let n = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (!isRewindable(m)) continue;
    n++;
    if (m.id === id || String(m.i) === id) return n;
  }
  return null;
}

export type RewindWhat = "both" | "conversation" | "code" | "summarize";

export const REWIND_CHOICES: { what: RewindWhat; label: string; hint: string }[] = [
  { what: "both", label: "Code and conversation", hint: "Go back to before this message, files included" },
  { what: "conversation", label: "Conversation only", hint: "Forget the later messages, keep the files as they are" },
  { what: "code", label: "Code only", hint: "Undo the file changes since then, keep the conversation" },
  { what: "summarize", label: "Summarize from here", hint: "Replace the later messages with a short summary" },
];

/** Open `/rewind` and walk up to the message. The restore menu that follows is a normal prompt. */
export function rewindSteps(distance: number): Step[] {
  const up: Step[] = [];
  for (let i = 0; i < distance; i++) up.push({ write: "\x1b[A" }, { wait: 50 });
  return [{ prompt: "/rewind" }, { wait: 700 }, ...up, { wait: 120 }, { write: "\r" }];
}

/** The restore menu's option for a choice ("Restore code and conversation", "Summarize from here"…). */
export function rewindOption(options: { n: string; label: string }[], what: RewindWhat): string | null {
  const l = (o: { label: string }) => o.label.toLowerCase();
  const pick =
    what === "both"
      ? options.find((o) => /code/.test(l(o)) && /conversation/.test(l(o)))
      : what === "conversation"
        ? options.find((o) => /conversation/.test(l(o)) && !/code/.test(l(o)))
        : what === "code"
          ? options.find((o) => /code/.test(l(o)) && !/conversation/.test(l(o)))
          : options.find((o) => /summar/.test(l(o)));
  return pick?.n ?? null;
}

/**
 * The restore menu that `/rewind` shows after the message was picked: the client remembers
 * what the user chose so the prompt dock answers it instead of showing the card (for 8 s).
 */
const armed = new Map<string, { what: RewindWhat; until: number }>();

export function armRewind(sid: string, what: RewindWhat, now = Date.now()) {
  armed.set(sid, { what, until: now + 8_000 });
}

/** The option to pick for an armed rewind, once; null when nothing is armed or nothing matches. */
export function takeRewind(sid: string, options: { n: string; label: string }[], now = Date.now()): string | null {
  const a = armed.get(sid);
  if (!a) return null;
  if (now > a.until) {
    armed.delete(sid);
    return null;
  }
  const n = rewindOption(options, a.what);
  if (n) armed.delete(sid);
  return n;
}

/** Asks the composer of `sid` to open the rewind sheet for a message (I3's long-press menu calls this). */
export function requestRewind(sid: string, messageId: string, messages: CvMessage[]) {
  const distance = rewindDistance(messages, messageId);
  if (distance === null) return false;
  const m = messages.find((x) => x.id === messageId || String(x.i) === messageId);
  window.dispatchEvent(new CustomEvent("na-cv-rewind", { detail: { sid, messageId, distance, checkpoint: (m as { checkpoint?: boolean } | undefined)?.checkpoint } }));
  return true;
}

/** Shows "Rewind to here" for this message? */
export const canRewind = isRewindable;

export interface RewindRequest {
  sid: string;
  messageId: string;
  distance: number;
  checkpoint?: boolean;
}

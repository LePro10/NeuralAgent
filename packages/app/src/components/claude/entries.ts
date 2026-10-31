/**
 * Messages → what the transcript shows (A3 §2.4, pure; tested in `lib/cvEntries.test.ts`).
 *
 * - User messages, notices and Claude's turns (consecutive assistant output, with the
 *   tool-result-only user lines folded in).
 * - Inside a turn: empty thinking is dropped; every tool step between two texts merges into one
 *   `steps` piece; edits, pictures, subagents, todos, plans and questions stay visible as their
 *   own pieces.
 * - Stable identity: an entry is reused while its messages (and so its results) are the same
 *   objects. `applyCv` replaces only the upserted message, so an update rebuilds only the turn it
 *   touches and `memo` skips the rest.
 */
import type { CvBlock, CvImage, CvMessage } from "@neuralagent/protocol";
import { isAgent, isEdit, type Res, type Use } from "./toolText.ts";

export type Step = { t: "tool"; key: string; use: Use } | { t: "think"; key: string; text: string; ms: number | null };

export type Piece =
  | { t: "text"; key: string; text: string }
  | { t: "steps"; key: string; steps: Step[] }
  /** Consecutive file changes. */
  | { t: "edits"; key: string; uses: Use[] }
  /** A call that returned pictures (lifted out of the steps). */
  | { t: "media"; key: string; use: Use }
  /** Consecutive subagent launches. */
  | { t: "agents"; key: string; uses: Use[] }
  | { t: "todos"; key: string; use: Use }
  | { t: "plan"; key: string; use: Use }
  | { t: "ask"; key: string; use: Use }
  /** An API error, hook message, compaction or other block inside Claude's output. */
  | { t: "note"; key: string; block: CvBlock };

export interface Turn {
  t: "turn";
  key: string;
  pieces: Piece[];
  /** Time of the first and the last message. */
  start: number;
  ts: number;
  /** All of Claude's text, for Copy. */
  text: string;
  /** Results of this turn's calls. */
  res: Map<string, Res>;
  /** Tool call ids in order. */
  ids: string[];
  msgs: CvMessage[];
}

export type Entry =
  | { t: "user"; key: string; m: CvMessage; /** a time separator goes before it */ sep: number | null }
  | { t: "system"; key: string; m: CvMessage }
  | Turn;

export interface EntryCache {
  turns: WeakMap<CvMessage, Turn>;
  single: WeakMap<CvMessage, Entry>;
}
export const entryCache = (): EntryCache => ({ turns: new WeakMap(), single: new WeakMap() });

type Text = Extract<CvBlock, { k: "text" }>;
export const textOf = (m: CvMessage) => m.blocks.filter((b): b is Text => b.k === "text").map((b) => b.text).join("\n\n");

/** Text Claude Code writes that is not meant for the reader. */
const HIDDEN_TEXT = /^(No response requested\.?)$/;

const SEP_GAP = 20 * 60_000;
const dayOf = (ts: number) => new Date(ts).toDateString();

/** A user line with only tool results (or nothing to show) belongs to the turn around it. */
function isResultOnly(m: CvMessage) {
  if (m.role !== "user" || m.kind) return false;
  return m.blocks.every((b) => b.k === "tool_result" || (b.k === "text" && !b.text.trim()));
}

/**
 * User-role lines that are not the owner's prompt: notifications, other agents, hooks, output.
 * They show as notices and get no time separator. (`command` and `shell` are the owner's own.)
 */
const NOTICE_KINDS = new Set(["task", "peer", "hook", "error", "duration", "compact", "notice", "output", "summary"]);
const NOTE_BLOCKS = new Set(["error", "hook", "duration", "compact", "task_note", "shell"]);
/** Lines that, inside a running turn, are pieces of that turn (a note), not a turn break. */
const FOLD_KINDS = new Set(["hook", "error", "duration", "compact"]);
const foldsIntoTurn = (m: CvMessage) =>
  m.role !== "assistant" && FOLD_KINDS.has(m.kind ?? "") && m.blocks.length > 0 && m.blocks.every((b) => NOTE_BLOCKS.has(b.k));

export function toEntries(messages: CvMessage[], cache: EntryCache = entryCache()): Entry[] {
  const out: Entry[] = [];
  let group: CvMessage[] = [];
  let prevTs = 0;
  let groupPrevTs = 0;
  const close = () => {
    if (group.length && group.some((m) => m.role === "assistant")) out.push(turnOf(group, groupPrevTs, cache));
    group = [];
  };
  for (const m of messages) {
    const key = m.id || String(m.i);
    if (m.role === "assistant" || (group.length && (isResultOnly(m) || foldsIntoTurn(m)))) {
      if (!group.length) groupPrevTs = prevTs;
      group.push(m);
    } else if (isResultOnly(m)) {
      // a stray result without a call to sit under
    } else if (m.role === "user" && !NOTICE_KINDS.has(m.kind ?? "")) {
      close();
      const gap = !prevTs || (m.ts && (m.ts - prevTs > SEP_GAP || dayOf(m.ts) !== dayOf(prevTs)));
      const sep = gap && m.ts ? m.ts : null;
      const have = cache.single.get(m);
      if (have && have.t === "user" && have.sep === sep) out.push(have);
      else {
        const e: Entry = { t: "user", key, m, sep };
        cache.single.set(m, e);
        out.push(e);
      }
    } else {
      close();
      let e = cache.single.get(m);
      if (!e) cache.single.set(m, (e = { t: "system", key, m }));
      out.push(e);
    }
    prevTs = m.ts || prevTs;
  }
  close();
  return out;
}

function turnOf(msgs: CvMessage[], prevTs: number, cache: EntryCache): Turn {
  const have = cache.turns.get(msgs[0]!);
  if (have && have.msgs.length === msgs.length && have.msgs.every((m, i) => m === msgs[i])) return have;
  const t = buildTurn(msgs, prevTs);
  cache.turns.set(msgs[0]!, t);
  return t;
}

const imagesOf = (r?: Res) => r?.images?.length ?? 0;

function buildTurn(msgs: CvMessage[], prevTs: number): Turn {
  const res = new Map<string, Res>();
  for (const m of msgs) if (m.role === "user") for (const b of m.blocks) if (b.k === "tool_result") res.set(b.tool_use_id, b);
  const pieces: Piece[] = [];
  const ids: string[] = [];
  let run: Step[] | null = null;
  const flush = () => (run = null);
  const step = (s: Step) => {
    if (run) return void run.push(s);
    const steps: Step[] = [s];
    run = steps;
    pieces.push({ t: "steps", key: s.key, steps });
  };
  const last = () => pieces[pieces.length - 1];
  let before = prevTs;
  for (const m of msgs) {
    if (m.role !== "assistant" && !foldsIntoTurn(m)) {
      before = m.ts || before;
      continue;
    }
    const key = m.id || String(m.i);
    m.blocks.forEach((b, i) => {
      const k = `${key}-${i}`;
      if (b.k === "text") {
        if (!b.text.trim() || HIDDEN_TEXT.test(b.text.trim())) return;
        flush();
        pieces.push({ t: "text", key: k, text: b.text });
      } else if (b.k === "thinking") {
        if (!b.text.trim()) return; // the CLI stores most thinking without text
        const given = (b as { ms?: number | null }).ms;
        const ms = given ?? (m.ts && before && m.ts > before && m.ts - before < 30 * 60_000 ? m.ts - before : null);
        step({ t: "think", key: k, text: b.text, ms });
      } else if (b.k === "tool_use") {
        ids.push(b.id);
        const key2 = b.id || k;
        const r = res.get(b.id);
        if (isEdit(b.name)) {
          flush();
          const l = last();
          if (l?.t === "edits") l.uses.push(b);
          else pieces.push({ t: "edits", key: key2, uses: [b] });
        } else if (isAgent(b.name)) {
          flush();
          const l = last();
          if (l?.t === "agents") l.uses.push(b);
          else pieces.push({ t: "agents", key: key2, uses: [b] });
        } else if (b.name === "TodoWrite") {
          flush();
          pieces.push({ t: "todos", key: key2, use: b });
        } else if (b.name === "ExitPlanMode") {
          flush();
          pieces.push({ t: "plan", key: key2, use: b });
        } else if (b.name === "AskUserQuestion") {
          flush();
          pieces.push({ t: "ask", key: key2, use: b });
        } else if (imagesOf(r) > 0) {
          flush();
          pieces.push({ t: "media", key: key2, use: b });
        } else step({ t: "tool", key: key2, use: b });
      } else if (NOTE_BLOCKS.has(b.k)) {
        flush();
        pieces.push({ t: "note", key: k, block: b });
      }
    });
    before = m.ts || before;
  }
  const text = pieces.filter((p): p is Extract<Piece, { t: "text" }> => p.t === "text").map((p) => p.text).join("\n\n");
  const first = msgs[0]!;
  const end = msgs[msgs.length - 1]!;
  return { t: "turn", key: first.id || String(first.i), pieces, start: first.ts, ts: end.ts || first.ts, text, res, ids, msgs };
}

const NONE: ReadonlySet<string> = new Set();

/** The calls of a turn that have no result yet (running, or waiting for the permission card). */
export function openTools(turn: Turn | null | undefined): ReadonlySet<string> {
  if (!turn) return NONE;
  const open = turn.ids.filter((id) => !turn.res.has(id));
  return open.length ? new Set(open) : NONE;
}

/** The newest open call (what a permission card is about). */
export function pendingUse(turn: Turn | null | undefined): Use | null {
  if (!turn) return null;
  for (let i = turn.msgs.length - 1; i >= 0; i--) {
    const blocks = turn.msgs[i]!.blocks;
    for (let j = blocks.length - 1; j >= 0; j--) {
      const b = blocks[j]!;
      if (b.k === "tool_use") return turn.res.has(b.id) ? null : b;
    }
  }
  return null;
}

export function lastTurn(entries: Entry[]): Turn | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (e.t === "turn") return e;
    if (e.t === "user") return null;
  }
  return null;
}

/** Id of the newest TodoWrite of the conversation (only that one renders as a full card). */
export function latestTodo(entries: Entry[]): string | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (e.t !== "turn") continue;
    for (let j = e.pieces.length - 1; j >= 0; j--) {
      const p = e.pieces[j]!;
      if (p.t === "todos") return p.use.id;
    }
  }
  return null;
}

export interface GalleryItem {
  /** Unique within the conversation. */
  key: string;
  img: CvImage;
  caption?: string;
}

/**
 * Every picture of the conversation in order (user images and tool results), so the viewer can
 * swipe on to the next screenshot. `caption` comes from the caller's naming function.
 */
export function gallery(entries: Entry[], name: (use: Use, res: Res) => string | undefined): GalleryItem[] {
  const out: GalleryItem[] = [];
  for (const e of entries) {
    if (e.t === "user") {
      let n = 0;
      for (const b of e.m.blocks) if (b.k === "image" && b.image) out.push({ key: b.image.id, img: b.image, caption: `Image ${++n}` });
    } else if (e.t === "turn") {
      for (const p of e.pieces) {
        if (p.t !== "media") continue;
        const r = e.res.get(p.use.id);
        const caption = r ? name(p.use, r) : undefined;
        for (const img of r?.images ?? []) out.push({ key: img.id, img, caption });
      }
    }
  }
  return out;
}

/** "Today 14:32", "Yesterday 09:10", "Tue 28 Oct 14:32", with the year when it is not this year. */
export function sepLabel(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  const n = new Date(now);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(n) - day(d)) / 86_400_000);
  if (diff === 0) return `Today ${time}`;
  if (diff === 1) return `Yesterday ${time}`;
  const opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" };
  if (d.getFullYear() !== n.getFullYear()) opts.year = "numeric";
  return `${d.toLocaleDateString([], opts)} ${time}`;
}

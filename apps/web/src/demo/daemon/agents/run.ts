// A scripted agent working: beats (say, read, edit, run …) are played with realistic pacing into the
// agent's terminal (in the look of its CLI) and, for Claude, into its chat transcript, while the
// session's status, last line, usage and the permission prompt follow along. One Run per session.

import type { CvBlock, CvMessage, CvMeta, CvOption, CvPrompt, CvQuestionItem, CvTask, CvTodo } from "@neuralagent/protocol";
import type { DemoActor } from "../../api.ts";
import { COLOR, ERASE_LINE, RESET, SPINNER, bold, dim, paint, strip as stripAnsi } from "../ansi.ts";
import { Cancelled, makeScope, type Scope } from "../clock.ts";
import { CvSession } from "../claude/cv.ts";
import { counts, hunks } from "../diff.ts";
import type { Sim } from "../sim.ts";
import type { Term } from "../term.ts";
import { basename, join } from "../vfs.ts";
import { askBox, banner, diffLines, inputBox, num, plural, resultLines, sayText, statusLine, styleOf, toolHeader, type Style } from "./style.ts";

export type Beat =
  | { k: "say"; text: string }
  | { k: "think"; text: string; ms?: number }
  | { k: "read"; path: string }
  | { k: "search"; pattern: string; path?: string; hits: string[] }
  | { k: "edit"; path: string; old: string; new: string; ask?: boolean }
  | { k: "write"; path: string; text: string; ask?: boolean }
  | { k: "run"; cmd: string; desc?: string; out: string[] | (() => string[]); ms?: number; ok?: boolean; ask?: boolean; effect?: () => void }
  | { k: "todo"; items: { content: string; active: string; status: "pending" | "in_progress" | "completed" }[] }
  | { k: "wait"; ms: number }
  | { k: "mark"; name: string }
  /** Subagents working in parallel (Claude): their transcripts, live labels, reports. */
  | { k: "agents"; items: SubAgent[] }
  /** A command running in the background (a dev server, a watch): a task with output; it ends by itself. */
  | { k: "bg"; cmd: string; desc: string; out: string[]; ms: number; summary: string }
  /** AskUserQuestion: the answers (one chosen label per question, or several when multi-select) pick what comes next. */
  | { k: "question"; questions: Question[]; then: (answers: string[][]) => Beat[] }
  /** ExitPlanMode: the plan to approve. `choice` is "auto" | "manual" | "keep" (feedback text when given). */
  | { k: "plan"; plan: string; then: (choice: "auto" | "manual" | "keep", feedback?: string) => Beat[] }
  /** A command's output line(s), shown as a notice (/cost, /context …). */
  | { k: "output"; text: string }
  /** Change what the meta strip shows (model, mode …). */
  | { k: "meta"; patch: Partial<CvMeta> }
  | { k: "compact" }
  | { k: "clear" };

export interface SubAgent {
  type: string;
  desc: string;
  prompt: string;
  /** What it reads or searches: tool name, argument. */
  steps: { tool: "Read" | "Grep" | "Glob" | "Bash"; arg: string; result: string }[];
  report: string;
  /** Virtual ms for the whole run (before pacing). */
  ms: number;
  model?: string;
}

export interface Question {
  header: string;
  question: string;
  multi?: boolean;
  options: { label: string; description?: string }[];
}

interface Gate {
  /** The prompt's fingerprint; changes whenever the prompt on screen changes. */
  id: string;
  options: string[];
  selected: number;
  lines: number;
  render: () => string[];
  resolve: (n: string, by: DemoActor, text?: string) => void;
  /** Questions and plans: what an answer from the app (`cv_action answer`) or a key does. */
  act?: (a: { n: string; text?: string; nav?: number }, by: DemoActor) => void;
  key?: (d: string, by: DemoActor) => boolean;
  /** Questions: all answers at once (`cv_action answer_question`). */
  bulk?: (answers: { labels: string[]; other?: string }[], by: DemoActor) => void;
}

/** Scripts are written for reading; real agents are slower. Everything that waits is stretched by this. */
const PACE = 2.4;
const PACE_OTHERS = 5;

const MODE_NEXT: Record<string, string> = { default: "acceptEdits", acceptEdits: "plan", plan: "default", bypassPermissions: "default" };

const TOKEN_PRICE = { in: 3 / 1e6, out: 15 / 1e6, cache: 0.3 / 1e6 };

export class Run {
  readonly sim: Sim;
  readonly sid: string;
  readonly term: Term;
  readonly cv: CvSession | undefined;
  readonly st: Style;
  readonly engine: string;
  scope: Scope;
  gate: Gate | null = null;
  autoEdits = false;
  allowed = new Set<string>();
  private busy: Promise<void> = Promise.resolve();
  private typed = "";
  private frame = 0;
  private queued: string[] = [];
  private lastAssistant = "";
  private turnStart = 0;
  /** Subagents of the running turn (their scopes), so Stop can end them. */
  private agentScopes = new Map<string, Scope>();
  private bgStop = new Map<string, () => void>();
  private tokens = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  private added = 0;
  private removed = 0;
  private todos: CvTodo[] = [];
  /** Called when the visitor types a prompt in the terminal or the chat composer. */
  onPrompt: ((text: string) => Beat[]) | null = null;

  constructor(sim: Sim, sid: string, term: Term, cv?: CvSession) {
    this.sim = sim;
    this.sid = sid;
    this.term = term;
    this.cv = cv;
    this.engine = sim.engineOf(sid);
    this.st = styleOf(this.engine);
    this.scope = makeScope(sim.scope);
    term.onInput = (d) => this.keys(d);
    const u = sim.session(sid)?.usage?.tokens;
    if (u) this.tokens = { ...u };
  }

  private get pace() {
    return this.engine === "claude" ? PACE : PACE_OTHERS;
  }

  private get cwd() {
    return this.sim.session(this.sid)?.cwd ?? "/";
  }
  private rel(p: string) {
    return p.startsWith(this.cwd + "/") ? p.slice(this.cwd.length + 1) : p;
  }
  private abs(p: string) {
    return p.startsWith("/") ? p : join(this.cwd, p);
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────────────────────

  /** The CLI's first screen. */
  open() {
    const model = this.engine === "claude" ? "Sonnet 5.5" : this.engine === "codex" ? "gpt-5.5-codex high" : this.engine === "gemini" ? "gemini-3-pro" : "anthropic/claude-sonnet-5-5";
    this.term.write((cols) => banner(this.st, this.cwd, cols, model).map((l) => l + "\r\n").join(""));
  }

  /** Show the idle input box (after open, or after a run). */
  idle() {
    this.term.write((cols) => inputBox(this.st, cols).map((l) => l + "\r\n").join(""));
  }

  /** Play a whole turn: the prompt, then the beats, then a closing message. Turns run one after another. */
  turn(prompt: string, beats: Beat[]): Promise<void> {
    const job = this.busy.then(() => this.runTurn(prompt, beats));
    this.busy = job.catch(() => {});
    return job;
  }

  private async runTurn(prompt: string, beats: Beat[]) {
    if (this.scope.dead) this.scope = makeScope(this.sim.scope);
    const sim = this.sim;
    const s = sim.session(this.sid);
    if (!s) return;
    const first = !s.prompt;
    const t0 = sim.now();
    this.turnStart = t0;
    sim.patch(this.sid, { status: "working", ...(first ? { prompt: prompt.slice(0, 160) } : {}), last_line: "Thinking…", last_message: s.last_message });
    this.term.write(this.userLine(prompt));
    if (this.cv) {
      // A slash command or `!cmd` is not a prompt the conversation can be rewound to.
      if (/^[/!]/.test(prompt)) this.cv.push("user", [{ k: "text", text: prompt }], { kind: "command" });
      else this.cv.user(prompt);
    }
    this.cv?.setMeta({ busy: true, activity: "Thinking…", title: s.title });
    try {
      for (const b of beats) await this.exec(b);
      this.finish(t0);
    } catch (e) {
      if (e instanceof Declined) {
        try {
          await this.exec({ k: "say", text: "Understood, I left that alone. Tell me how you would like to continue and I will pick it up from there." });
          this.finish(t0);
        } catch (e2) {
          if (!(e2 instanceof Cancelled)) throw e2;
        }
      } else if (!(e instanceof Cancelled)) throw e;
    }
    this.nextQueued();
  }

  /** Prompts that arrived while the turn ran go next, one at a time. */
  private nextQueued() {
    const next = this.queued.shift();
    if (next === undefined) return;
    this.cv?.setMeta({ queued: this.queued.map((t) => ({ text: t, ts: this.sim.now() })) });
    if (this.onPrompt) void this.turn(next, this.onPrompt(next)).catch(() => {});
  }

  /** "Send now": stop what Claude is doing and run the oldest queued message at once. */
  sendQueuedNow() {
    if (!this.queued.length) return;
    const text = this.queued.shift()!;
    this.queued.unshift(text);
    this.interrupt(true);
  }

  private userLine(text: string): string {
    const st = this.st;
    if (st.id === "claude") return `\r\n${dim(">")} ${text}\r\n\r\n`;
    if (st.id === "codex") return `\r\n${COLOR.cyan}›${RESET} ${text}\r\n\r\n`;
    if (st.id === "opencode") return `\r\n${COLOR.blue}┃${RESET} ${bold(text)}\r\n\r\n`;
    return `\r\n${dim(">")} ${text}\r\n\r\n`;
  }

  private finish(t0?: number) {
    const text = this.lastAssistant.trim();
    const ms = t0 ? this.sim.now() - t0 : 0;
    if (this.cv && ms > 8000) this.cv.system("duration", [{ k: "duration", ms: Math.round(ms) }]);
    this.cv?.setMeta({ busy: false, activity: undefined, todos: this.todos, duration_ms: (this.cv.meta.duration_ms ?? 0) + ms });
    this.term.write("\r\n");
    this.idle();
    this.sim.patch(
      this.sid,
      { status: "done", last_message: text.slice(0, 220), last_line: text.split("\n")[0]!.slice(0, 120) },
      text.split(/(?<=[.!?])\s/)[0]?.slice(0, 160) ?? "Finished",
    );
  }

  /** Esc in the terminal: stop what the agent is doing. */
  interrupt(keepQueue = false) {
    const st = this.sim.session(this.sid)?.status;
    if (!st || st === "done" || st === "idle") return;
    this.scope.cancel();
    if (this.gate) this.clearGate();
    this.endAgents("stopped");
    this.term.write(`\r${ERASE_LINE}${dim(this.st.gutter)}${COLOR.red}Interrupted by user${RESET}\r\n\r\n`);
    this.cv?.push("user", [{ k: "text", text: "[Request interrupted by user]" }], { kind: "notice" });
    this.cv?.setPrompt(null);
    this.cv?.setMeta({ busy: false, activity: undefined });
    this.idle();
    this.sim.patch(this.sid, { status: "done", last_line: "Interrupted" }, "Interrupted");
    // Esc takes the queued messages back; "send now" keeps them and the turn that ends next runs the first.
    if (!keepQueue && this.queued.length) {
      this.queued = [];
      this.cv?.setMeta({ queued: [] });
    }
  }

  stop() {
    this.scope.cancel();
    this.term.onInput = null;
  }

  // ── keys typed into the terminal ───────────────────────────────────────────────────────────

  private keys(d: string) {
    if (this.gate) {
      const g = this.gate;
      if (g.key?.(d, "desk")) return;
      if (d === "\x1b[A" || d === "\x1b[B") {
        g.selected = Math.max(0, Math.min(g.options.length - 1, g.selected + (d === "\x1b[A" ? -1 : 1)));
        this.redrawGate();
      } else if (/^[1-9]$/.test(d) && Number(d) <= g.options.length) this.answer(d, "desk");
      else if (d === "\r") this.answer(String(g.selected + 1), "desk");
      else if (d === "y") this.answer("1", "desk");
      else if (d === "n" || d === "\x1b") this.answer(String(g.options.length), "desk");
      return;
    }
    const s = this.sim.session(this.sid);
    if (!s) return;
    if (d === "\x1b[Z" && this.cv) {
      // Shift+Tab cycles the permission mode, like the real CLI.
      this.setMode(MODE_NEXT[this.cv.meta.mode ?? "default"] ?? "default");
      return;
    }
    if (s.status === "working") {
      if (d === "\x1b") this.interrupt();
      return;
    }
    for (const ch of d) {
      if (ch === "\r") {
        const text = this.typed.trim();
        this.typed = "";
        if (text && this.onPrompt) this.submit(text);
      } else if (ch === "\x7f") {
        if (this.typed) {
          this.typed = this.typed.slice(0, -1);
          this.term.write("\b \b");
        }
      } else if (ch >= " ") {
        this.typed += ch;
        this.term.write(ch);
      }
    }
  }

  /** A prompt from the terminal, the chat composer or the phone's reply box. */
  submit(text: string) {
    if (!this.onPrompt) return;
    const s = this.sim.session(this.sid);
    if ((s && s.status === "working") || this.gate) {
      this.queued.push(text);
      this.cv?.setMeta({ queued: this.queued.map((t) => ({ text: t, ts: this.sim.now() })) });
      return;
    }
    // Move up over the input box so the answer starts where the box was.
    this.term.write("\r\n");
    void this.turn(text, this.onPrompt(text));
  }

  // ── permission gate ────────────────────────────────────────────────────────────────────────

  /** Answer the open prompt (option number "1"…); false when none is open. */
  answer(n: string, by: DemoActor, promptId?: string, text?: string): boolean {
    const g = this.gate;
    if (!g || (promptId && g.id !== promptId)) return false;
    if (g.act) g.act({ n, ...(text ? { text } : {}) }, by);
    else g.resolve(n, by);
    return true;
  }

  /** After `cv_action rewind`: the conversation is back at an earlier point and the agent waits for input. */
  rewound() {
    this.term.write(`\r${ERASE_LINE}${dim(this.st.gutter)}Conversation rewound\r\n\r\n`);
    this.queued = [];
    this.lastAssistant = "";
    this.cv?.setMeta({ busy: false, activity: undefined, queued: [] });
    this.idle();
    this.sim.patch(this.sid, { status: "idle", last_line: "" });
  }

  /** `cv_action answer_question`: every answer of the open question dialog at once. */
  answerQuestion(answers: { labels: string[]; other?: string }[], promptId: string | undefined, by: DemoActor): boolean {
    const g = this.gate;
    if (!g?.bulk || (promptId && g.id !== promptId)) return false;
    g.bulk(answers, by);
    return true;
  }

  /** Keys the app types into the terminal (tab arrows of a question dialog). Returns whether a prompt took them. */
  gateKey(d: string, by: DemoActor): boolean {
    return !!this.gate?.key?.(d, by);
  }

  /** `cv_action set_mode`, Shift+Tab: the permission mode. */
  setMode(mode: string) {
    this.cv?.setMeta({ mode });
    if (mode === "acceptEdits" || mode === "bypassPermissions") this.autoEdits = true;
    else this.autoEdits = false;
    this.term.write(`\r${ERASE_LINE}${dim(`  ⏵⏵ ${mode === "acceptEdits" ? "accept edits on" : mode === "plan" ? "plan mode on" : mode === "bypassPermissions" ? "bypass permissions on" : "default mode"} (shift+tab to cycle)`)}\r\n`);
  }

  private redrawGate() {
    const g = this.gate;
    if (!g) return;
    this.term.write(`\x1b[${g.lines}A\x1b[J` + g.render().map((l) => l + "\r\n").join(""));
  }

  private clearGate() {
    const g = this.gate;
    if (!g) return;
    this.term.write(`\x1b[${g.lines}A\x1b[J`);
    this.gate = null;
    this.cv?.setPrompt(null);
  }

  private async ask(o: { title: string; body: string[]; question: string; options: string[]; tool: { name: string; input: unknown }; waitText: string; attention: string }): Promise<{ n: string; by: DemoActor }> {
    const sim = this.sim;
    const id = sim.id("prompt", 10);
    const g: Gate = {
      id,
      options: o.options,
      selected: 0,
      lines: 0,
      render: () => askBox(this.st, { title: o.title, body: o.body, question: o.question, options: o.options, selected: g.selected }, this.term.cols),
      resolve: () => {},
    };
    const lines = g.render();
    g.lines = lines.length;
    this.term.write(`\r${ERASE_LINE}` + lines.map((l) => l + "\r\n").join(""));
    const prompt: CvPrompt = {
      title: o.title,
      id,
      kind: "permission",
      tool: { name: o.tool.name, input: o.tool.input },
      options: o.options.map((label, i) => ({ n: String(i + 1), label, selected: i === 0 })),
    };
    this.cv?.setPrompt(prompt);
    this.cv?.setMeta({ activity: o.waitText });
    this.gate = g;
    sim.patch(this.sid, { status: "waiting", last_line: o.waitText }, o.attention);
    sim.signal({ type: "prompt-opened", agent: this.sid, name: sim.session(this.sid)?.title ?? "", tool: o.tool.name, command: o.waitText });
    const answer = await new Promise<{ n: string; by: DemoActor }>((resolve, reject) => {
      // The world answers by itself after a while so an untouched demo keeps flowing.
      const auto = sim.clock.after(150_000, () => g.resolve("1", "world"));
      const off = this.scope.onCancel(() => {
        auto();
        reject(new Cancelled());
      });
      g.resolve = (n, by) => {
        auto();
        off();
        resolve({ n, by });
      };
    });
    this.term.write(`\x1b[${g.lines}A\x1b[J`);
    this.gate = null;
    this.cv?.setPrompt(null);
    const allow = answer.n !== String(o.options.length);
    sim.patch(this.sid, { status: "working", last_line: allow ? "Approved, continuing" : "Declined" });
    sim.signal({ type: "prompt-answered", agent: this.sid, allow, by: answer.by });
    return answer;
  }

  // ── beats ──────────────────────────────────────────────────────────────────────────────────

  private async sleep(ms: number) {
    await this.sim.clock.sleep(ms, this.scope);
  }

  private bump(i: number, o: number) {
    const t = this.tokens;
    t.input += i;
    t.output += o;
    t.cache_read += i * 6;
    const cost = t.input * TOKEN_PRICE.in + t.output * TOKEN_PRICE.out + t.cache_read * TOKEN_PRICE.cache;
    const model = this.engine === "claude" ? "claude-sonnet-5-5" : this.engine === "codex" ? "gpt-5.5-codex" : this.engine === "gemini" ? "gemini-3-pro" : "claude-sonnet-5-5";
    this.sim.patch(this.sid, { usage: { tokens: { ...t }, cost_usd: Math.round(cost * 100) / 100, model } });
    const ctx = Math.min(180_000, 14_000 + (t.input + t.output) / 4);
    this.cv?.setMeta({ context_tokens: Math.round(ctx), context_pct: Math.round((ctx / 200_000) * 100), context_window: 200_000, cost_usd: Math.round(cost * 100) / 100, lines_added: this.added, lines_removed: this.removed });
  }

  private line(text: string) {
    this.sim.patch(this.sid, { last_line: text.slice(0, 140) });
  }

  /** Print a status line that ticks for `ms`, then erase it. */
  private async spin(label: string, ms: number) {
    const t0 = this.sim.now();
    const end = t0 + ms * this.pace;
    let w = this.st.working[Math.floor(this.frame / 7) % this.st.working.length]!;
    if (label) w = label;
    let shown = -1;
    while (this.sim.now() < end) {
      // The turn's own clock: what the CLI prints behind the spinner.
      const secs = Math.floor((this.sim.now() - (this.turnStart || t0)) / 1000);
      if (secs !== shown && this.cv) {
        shown = secs;
        this.cv.setMeta({ activity: `${w}… (${secs}s · esc to interrupt)` });
      }
      this.term.write(`\r${ERASE_LINE}${statusLine(this.st, SPINNER[this.frame++ % SPINNER.length]!, w, Math.floor((this.sim.now() - t0) / 1000))}`);
      await this.sleep(Math.min(300, Math.max(1, end - this.sim.now())));
    }
    this.term.write(`\r${ERASE_LINE}`);
  }

  private tool(verb: string, arg: string) {
    this.term.write(toolHeader(this.st, verb, arg) + "\r\n");
  }

  private resultTerm(lines: string[], max = 5) {
    this.term.write(resultLines(this.st, lines, max).map((l) => l + "\r\n").join(""));
  }

  private async exec(b: Beat) {
    const sim = this.sim;
    const cv = this.cv;
    const st = this.st;
    switch (b.k) {
      case "mark":
        sim.mark(b.name);
        if (b.name === "before-ask" && sim.holdAsk > 0) {
          const hold = sim.holdAsk;
          sim.holdAsk = 0;
          this.line("Pondering");
          await this.spin("Pondering", hold / this.pace);
        }
        return;
      case "agents":
        await this.runAgents(b.items);
        return;
      case "bg":
        await this.background(b);
        return;
      case "question": {
        const answers = await this.askQuestion(b.questions);
        for (const x of b.then(answers)) await this.exec(x);
        return;
      }
      case "plan": {
        const r = await this.askPlan(b.plan);
        for (const x of b.then(r.choice, r.feedback)) await this.exec(x);
        return;
      }
      case "output": {
        this.term.write(b.text.split("\n").map((l) => `${dim(st.gutter)}${l}\r\n`).join("") + "\r\n");
        cv?.push("user", [{ k: "text", text: b.text }], { kind: "output" });
        return;
      }
      case "meta":
        cv?.setMeta(b.patch);
        return;
      case "compact": {
        await this.spin("Compacting conversation", 1800);
        const before = cv?.meta.context_tokens ?? 90_000;
        const sum = "This session is being continued from an earlier conversation. Summary: the work so far touched the webhook handler, the retry helper and the dead-letter table; the tests were last green after the retry change. Next steps are open.";
        cv?.system("compact", [{ k: "compact", trigger: "manual", pre_tokens: before }]);
        cv?.push("user", [{ k: "text", text: sum }], { kind: "summary" });
        this.tokens = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
        cv?.setMeta({ context_tokens: 13_400, context_pct: 7 });
        this.term.write(`${dim("  Conversation compacted (ctrl+o for history)")}\r\n\r\n`);
        return;
      }
      case "clear":
        this.term.write("\x1b[H\x1b[2J");
        this.open();
        cv?.clear();
        this.tokens = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
        this.todos = [];
        return;
      case "wait":
        await this.sleep(b.ms * this.pace);
        return;
      case "think": {
        const ms = b.ms ?? 2200;
        await this.spin(st.working[this.frame % st.working.length]!, ms);
        cv?.push("assistant", [{ k: "thinking", text: b.text, ms }], { model: "claude-sonnet-5-5" });
        this.bump(900, 180);
        return;
      }
      case "say": {
        this.term.write("\r");
        const words = b.text.split(" ");
        const w = Math.max(30, Math.min(this.term.cols - 4, 96));
        const m = cv?.push("assistant", [{ k: "text", text: "" }], { model: "claude-sonnet-5-5" });
        let shown = "";
        let col = 0;
        // Typed out at the width of the pane now; once it is finished it is laid out again for any other width.
        const mark = this.term.mark();
        this.term.write(`${st.sayColor}${st.say}${RESET} `);
        for (let i = 0; i < words.length; i += 3) {
          const chunk = words.slice(i, i + 3).join(" ");
          if (col + chunk.length > w) {
            this.term.write("\r\n  ");
            col = 0;
          }
          this.term.write(chunk + (i + 3 < words.length ? " " : ""));
          col += chunk.length + 1;
          shown += (shown ? " " : "") + chunk;
          if (m) cv!.update(cv!.messages.find((x) => x.id === m.id) ?? m, [{ k: "text", text: shown }]);
          await this.sleep(90 + (chunk.length % 5) * 12);
        }
        this.term.write("\r\n\r\n");
        this.term.reflow(mark, (cols) => sayText(st, b.text, cols) + "\r\n\r\n");
        this.lastAssistant = b.text;
        this.line(b.text);
        this.bump(400, Math.round(b.text.length / 3.6));
        return;
      }
      case "read": {
        const path = this.abs(b.path);
        const text = sim.vfs.read(path) ?? "";
        const n = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
        this.line(`Reading ${this.rel(path)}`);
        await this.spin("Reading", 600 + (n % 5) * 160);
        this.tool(st.verbs.read, this.rel(path));
        this.resultTerm([st.id === "codex" ? `Read ${basename(path)}` : `Read ${plural(n, "line")}`]);
        this.term.write("\r\n");
        const id = this.toolId();
        cv?.push("assistant", [{ k: "tool_use", id, name: "Read", input: { file_path: path } }], { model: "claude-sonnet-5-5" });
        cv?.push("user", [{ k: "tool_result", tool_use_id: id, text: text.split("\n").slice(0, 80).map((l, i) => `${String(i + 1).padStart(6)}\t${l}`).join("\n"), is_error: false }]);
        this.bump(1800 + n * 12, 60);
        return;
      }
      case "search": {
        this.line(`Searching ${b.pattern}`);
        await this.spin("Searching", 700);
        this.tool(st.verbs.search, `${b.pattern}${b.path ? ` in ${b.path}` : ""}`);
        this.resultTerm(b.hits.length ? [`Found ${plural(b.hits.length, "file")}`, ...b.hits] : ["No matches found"]);
        this.term.write("\r\n");
        const id = this.toolId();
        cv?.push("assistant", [{ k: "tool_use", id, name: "Grep", input: { pattern: b.pattern, path: b.path ? this.abs(b.path) : this.cwd, output_mode: "files_with_matches" } }], { model: "claude-sonnet-5-5" });
        cv?.push("user", [{ k: "tool_result", tool_use_id: id, text: b.hits.length ? `Found ${plural(b.hits.length, "file")}\n${b.hits.join("\n")}` : "No files found", is_error: false }]);
        this.bump(900, 50);
        return;
      }
      case "todo": {
        this.todos = b.items.map((t) => ({ content: t.content, active: t.active, status: t.status }));
        this.tool(st.verbs.todo, "");
        this.resultTerm(b.items.map((t) => `${t.status === "completed" ? paint(COLOR.green, "☒") : "☐"} ${t.status === "completed" ? dim(t.content) : t.content}`), 8);
        this.term.write("\r\n");
        const id = this.toolId();
        cv?.push("assistant", [{ k: "tool_use", id, name: "TodoWrite", input: { todos: this.todos } }], { model: "claude-sonnet-5-5" });
        cv?.push("user", [{ k: "tool_result", tool_use_id: id, text: "Todos have been modified successfully.", is_error: false }]);
        cv?.setMeta({ todos: this.todos });
        await this.sleep(500);
        return;
      }
      case "edit":
      case "write": {
        const path = this.abs(b.path);
        const before = sim.vfs.read(path);
        const after = b.k === "edit" ? (before ?? "").replace(b.old, b.new) : b.text;
        const isNew = before === null;
        this.line(`${isNew ? "Writing" : "Editing"} ${this.rel(path)}`);
        await this.spin(isNew ? "Writing" : "Editing", 900);
        const id = this.toolId();
        const input = b.k === "edit" ? { file_path: path, old_string: b.old, new_string: b.new } : { file_path: path, content: b.text };
        cv?.push("assistant", [{ k: "tool_use", id, name: b.k === "edit" ? "Edit" : "Write", input }], { model: "claude-sonnet-5-5" });
        if (b.ask && !this.autoEdits && cv) {
          const r = await this.ask({
            title: isNew ? "Create file" : "Edit file",
            body: [bold(this.rel(path)), "", ...diffLines(st, before ?? "", after, 2, this.term.cols - 10).slice(0, 12)],
            question: `Do you want to ${isNew ? "create" : "make this edit to"} ${basename(path)}?`,
            options: ["Yes", "Yes, allow all edits during this session (shift+tab)", "No, and tell Claude what to do differently (esc)"],
            tool: { name: b.k === "edit" ? "Edit" : "Write", input },
            waitText: `Allow edit to ${this.rel(path)}?`,
            attention: `Claude wants to ${isNew ? "create" : "edit"} ${this.rel(path)}`,
          });
          if (r.n === "2") this.autoEdits = true;
          if (r.n === "3") {
            this.term.write(`${toolHeader(st, st.verbs.edit, this.rel(path))}\r\n`);
            this.resultTerm([paint(COLOR.red, "User rejected update")]);
            cv?.push("user", [{ k: "tool_result", tool_use_id: id, text: "The user doesn't want to proceed with this tool use. The tool use was rejected.", is_error: true }]);
            throw new Declined();
          }
        }
        sim.vfs.write(path, after);
        const ws = sim.workspaceOf(this.sid);
        if (ws) sim.refreshGit(ws.id);
        const c = counts(before ?? "", after);
        this.added += c.additions;
        this.removed += c.deletions;
        this.tool(isNew ? st.verbs.write : st.verbs.edit, this.rel(path));
        if (isNew) this.resultTerm([`Wrote ${plural(after.split("\n").length - 1, "line")} to ${this.rel(path)}`, ...after.split("\n").slice(0, 6).map((l, i) => dim(`${num(i + 1)}  `) + l)], 8);
        else {
          this.resultTerm([`Updated ${this.rel(path)} with ${plural(c.additions, "addition")} and ${plural(c.deletions, "removal")}`]);
          this.term.write((cols) => diffLines(st, before ?? "", after, 6, cols).map((l) => l + "\r\n").join(""));
        }
        this.term.write("\r\n");
        const patch = hunks(before ?? "", after, 3).map((h) => ({ old_start: h.oldStart, old_lines: h.oldLines, new_start: h.newStart, new_lines: h.newLines, lines: h.lines.map((l) => l.t + l.text) }));
        const block: CvBlock = {
          k: "tool_result",
          tool_use_id: id,
          text: isNew ? `File created successfully at: ${path}` : `The file ${path} has been updated successfully.`,
          is_error: false,
          meta: isNew ? { write: "create", patch } : { patch },
        };
        cv?.push("user", [block]);
        this.bump(2200, 320);
        return;
      }
      case "run": {
        const cmd = b.cmd;
        const key = cmd.split(" ").slice(0, 2).join(" ");
        const id = this.toolId();
        const input = { command: cmd, description: b.desc ?? "" };
        cv?.push("assistant", [{ k: "tool_use", id, name: "Bash", input }], { model: "claude-sonnet-5-5" });
        if (b.ask && !this.allowed.has(key) && cv?.meta.mode !== "bypassPermissions") {
          const r = await this.ask({
            title: "Bash command",
            body: [cmd, ...(b.desc ? [dim(b.desc)] : [])],
            question: "Do you want to proceed?",
            options: ["Yes", `Yes, and don't ask again for ${key} commands in ${this.cwd}`, "No, and tell Claude what to do differently (esc)"],
            tool: { name: "Bash", input },
            waitText: `Allow \`${cmd}\`?`,
            attention: `Claude wants to run ${cmd}`,
          });
          if (r.n === "2") this.allowed.add(key);
          if (r.n === "3") {
            this.tool(st.verbs.run, cmd);
            this.resultTerm([paint(COLOR.red, "User rejected command")]);
            cv?.push("user", [{ k: "tool_result", tool_use_id: id, text: "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.", is_error: true }]);
            throw new Declined();
          }
        }
        this.line(`Running ${cmd}`);
        this.tool(st.verbs.run, cmd);
        await this.spin("Running", b.ms ?? 2400);
        b.effect?.();
        const ws = sim.workspaceOf(this.sid);
        if (ws) sim.refreshGit(ws.id);
        const out = typeof b.out === "function" ? b.out() : b.out;
        this.resultTerm(out.length ? out : [dim("(No content)")], 6);
        this.term.write("\r\n");
        cv?.push("user", [{ k: "tool_result", tool_use_id: id, text: out.map(stripAnsi).join("\n"), is_error: b.ok === false, meta: { stdout: out.map(stripAnsi).join("\n"), return_code: b.ok === false ? "1" : "0" } }]);
        this.bump(1500, 90);
        return;
      }
    }
  }


  // ── subagents and background tasks ─────────────────────────────────────────────────────────

  private tstep(tool: string, arg: string) {
    return `${tool} · ${arg.length > 48 ? "…" + arg.slice(-46) : arg}`;
  }

  /** Subagents run side by side: each has a task, a transcript of its own and a report for the parent. */
  private async runAgents(items: SubAgent[]) {
    const sim = this.sim;
    const cv = this.cv;
    const st = this.st;
    if (!cv) {
      for (const it of items) await this.exec({ k: "say", text: `${it.desc}: ${it.report}` });
      return;
    }
    const model = "claude-haiku-5-5";
    const runs = items.map((it) => ({ it, tool: this.toolId(), agent: "a" + sim.id("agent", 16), scope: this.scope.child() }));
    cv.push(
      "assistant",
      runs.map((r) => ({ k: "tool_use" as const, id: r.tool, name: "Agent", input: { description: r.it.desc, subagent_type: r.it.type, prompt: r.it.prompt } })),
      { model: "claude-sonnet-5-5" },
    );
    this.term.write(runs.map((r) => toolHeader(st, "Task", `${r.it.desc} (${r.it.type})`) + "\r\n").join(""));
    this.line(`${items.length} agents running`);
    const started = sim.now();
    const task = (r: (typeof runs)[number], p: Partial<CvTask>): CvTask => ({
      id: r.agent,
      kind: "agent",
      tool_use_id: r.tool,
      agent_type: r.it.type,
      description: r.it.desc,
      status: "running",
      background: false,
      model: r.it.model ?? model,
      started,
      has_transcript: true,
      tokens: 0,
      tool_count: 0,
      active: sim.now(),
      ...p,
    });
    for (const r of runs) {
      this.agentScopes.set(r.agent, r.scope);
      cv.upsertTask(task(r, { label: "Starting" }));
    }
    await Promise.all(
      runs.map(async (r) => {
        let tokens = 0;
        let tools = 0;
        let outcome: "completed" | "stopped" = "completed";
        cv.subPush(r.agent, "user", [{ k: "text", text: r.it.prompt }]);
        try {
          const slice = (r.it.ms * this.pace) / (r.it.steps.length + 1);
          for (const step of r.it.steps) {
            await sim.clock.sleep(slice, r.scope);
            const id = this.toolId();
            const input = step.tool === "Read" ? { file_path: this.abs(step.arg) } : step.tool === "Bash" ? { command: step.arg } : { pattern: step.arg };
            cv.subPush(r.agent, "assistant", [{ k: "tool_use", id, name: step.tool, input }], { model });
            cv.subPush(r.agent, "user", [{ k: "tool_result", tool_use_id: id, text: step.result, is_error: false }]);
            tokens += 1400 + step.result.length;
            tools++;
            cv.upsertTask(task(r, { label: this.tstep(step.tool, step.arg), tokens, tool_count: tools }));
          }
          await sim.clock.sleep(slice, r.scope);
          cv.subPush(r.agent, "assistant", [{ k: "text", text: r.it.report }], { model });
          tokens += 700;
        } catch (e) {
          if (!(e instanceof Cancelled) || this.scope.dead) throw e;
          outcome = "stopped";
        }
        this.agentScopes.delete(r.agent);
        const dur = sim.now() - started;
        const summary = outcome === "completed" ? `Agent "${r.it.desc}" completed` : `Agent "${r.it.desc}" was stopped`;
        cv.upsertTask(task(r, { status: outcome, label: undefined, ended: sim.now(), duration_ms: dur, tokens, tool_count: tools, summary, ...(outcome === "completed" ? { result: r.it.report } : {}) }));
        cv.push("user", [
          {
            k: "tool_result",
            tool_use_id: r.tool,
            text: outcome === "completed" ? r.it.report : "The agent was stopped before it finished.",
            is_error: outcome !== "completed",
            meta: { agent_id: r.agent, status: "completed", agent_type: r.it.type, tool_count: tools, tokens, duration_ms: dur, model },
          },
        ]);
        this.bump(tokens / 6, 120);
      }),
    );
    this.term.write("\r\n");
  }

  /** Mark every subagent still running as ended (the turn was interrupted). */
  private endAgents(status: "stopped") {
    const cv = this.cv;
    if (!cv) return;
    for (const sc of this.agentScopes.values()) sc.cancel();
    this.agentScopes.clear();
    for (const t of cv.tasks) if (t.status === "running" && t.kind === "agent") cv.upsertTask({ ...t, status, label: undefined, ended: this.sim.now(), summary: `Agent "${t.description}" was stopped` });
  }

  /** `cv_action stop_task`: false when no task of that id runs. */
  stopTask(id: string): boolean {
    const cv = this.cv;
    const t = cv?.tasks.find((x) => x.id === id);
    if (!cv || !t || t.status !== "running") return false;
    const sc = this.agentScopes.get(id);
    if (sc) sc.cancel();
    else {
      this.bgStop.get(id)?.();
      this.bgStop.delete(id);
      cv.upsertTask({ ...t, status: "stopped", ended: this.sim.now(), summary: `Background command "${t.command ?? t.description}" was stopped` });
    }
    return true;
  }

  stopAgents() {
    const cv = this.cv;
    if (!cv) return;
    for (const t of cv.tasks) if (t.status === "running") this.stopTask(t.id);
  }

  /** The foreground Bash call goes to the background: a task with output, finished by a notification later. */
  private async background(b: Extract<Beat, { k: "bg" }>) {
    const sim = this.sim;
    const cv = this.cv;
    const id = this.toolId();
    const task = "b" + sim.id("bgtask", 8);
    this.line(`Running ${b.cmd} in the background`);
    if (!cv) {
      await this.exec({ k: "run", cmd: b.cmd, desc: b.desc, out: b.out, ms: 1200 });
      return;
    }
    cv.push("assistant", [{ k: "tool_use", id, name: "Bash", input: { command: b.cmd, description: b.desc, run_in_background: true } }], { model: "claude-sonnet-5-5" });
    this.tool(this.st.verbs.run, b.cmd);
    this.resultTerm([`Running in the background (↓ to manage)`]);
    this.term.write("\r\n");
    cv.push("user", [{ k: "tool_result", tool_use_id: id, text: `Command running in background with ID: ${task}. Output is being written to /tmp/${task}.output`, is_error: false, meta: { background_task_id: task } }]);
    const started = sim.now();
    const base: CvTask = { id: task, kind: "bash", tool_use_id: id, description: b.desc, command: b.cmd, status: "running", background: true, started, has_transcript: false, output_file: `/tmp/${task}.output`, active: started };
    cv.outputs.set(task, "");
    cv.upsertTask({ ...base, label: "Bash · " + b.cmd });
    const lines = b.out;
    let shown = 0;
    const tick = sim.clock.every(Math.max(400, (b.ms * this.pace) / (lines.length + 1)), () => {
      if (shown >= lines.length) return;
      shown++;
      cv.outputs.set(task, lines.slice(0, shown).join("\n") + "\n");
      const cur = cv.tasks.find((x) => x.id === task);
      if (cur?.status === "running") cv.upsertTask({ ...cur, active: sim.now(), label: lines[shown - 1]!.slice(0, 60) });
    });
    const done = sim.clock.after(b.ms * this.pace, () => {
      tick();
      cv.outputs.set(task, lines.join("\n") + "\n");
      const cur = cv.tasks.find((x) => x.id === task);
      if (!cur || cur.status !== "running") return;
      cv.upsertTask({ ...cur, status: "completed", label: undefined, ended: sim.now(), duration_ms: sim.now() - started, summary: b.summary });
      cv.system("task", [{ k: "task_note", task_id: task, tool_use_id: id, status: "completed", summary: b.summary, kind: "bash", duration_ms: sim.now() - started, output_file: `/tmp/${task}.output` }]);
      this.bgStop.delete(task);
    });
    const stop = () => {
      tick();
      done();
    };
    this.bgStop.set(task, stop);
    sim.scope.onCancel(stop);
  }

  // ── questions and plans ────────────────────────────────────────────────────────────────────

  /** AskUserQuestion. Returns the chosen labels per question (free text when "Type something" was used). */
  private async askQuestion(qs: Question[]): Promise<string[][]> {
    const sim = this.sim;
    const cv = this.cv;
    const st = this.st;
    const toolId = this.toolId();
    const items: CvQuestionItem[] = qs.map((q) => ({ question: q.question, header: q.header, multi_select: !!q.multi, options: q.options.map((o) => ({ label: o.label, ...(o.description ? { description: o.description } : {}) })) }));
    const input = { questions: qs.map((q) => ({ question: q.question, header: q.header, multiSelect: !!q.multi, options: q.options })) };
    cv?.push("assistant", [{ k: "tool_use", id: toolId, name: "AskUserQuestion", input }], { model: "claude-sonnet-5-5" });
    let tab = 0;
    let cursor = 0;
    const picked: string[][] = qs.map(() => []);
    const review = () => tab >= qs.length;
    const labels = (): string[] => (review() ? ["Submit answers", "Cancel"] : [...qs[tab]!.options.map((o) => (qs[tab]!.multi ? `[${picked[tab]!.includes(o.label) ? "✔" : " "}] ${o.label}` : o.label)), "Type something."]);
    const prompt = (id: string): CvPrompt => {
      if (review()) {
        return { id, kind: "question", title: "Review your answers", options: [{ n: "1", label: "Submit answers", selected: cursor === 0 }, { n: "2", label: "Cancel", selected: cursor === 1 }], question: { questions: items, tab, tool_use_id: toolId } };
      }
      const q = qs[tab]!;
      const opts: CvOption[] = q.options.map((o, i) => ({ n: String(i + 1), label: o.label, selected: i === cursor, ...(o.description ? { description: o.description } : {}), ...(q.multi ? { checked: picked[tab]!.includes(o.label) } : {}) }));
      opts.push({ n: String(q.options.length + 1), label: "Type something.", selected: cursor === q.options.length, text: true });
      return { id, kind: "question", title: q.question, options: opts, question: { questions: items, tab, tool_use_id: toolId } };
    };
    const draw = (first = false) => {
      const g = this.gate!;
      const lines = review()
        ? askBox(st, { title: "Review your answers", body: qs.map((q, i) => `${q.header}: ${picked[i]!.join(", ") || "(skipped)"}`), question: "Ready to submit your answers?", options: labels(), selected: cursor }, this.term.cols)
        : askBox(st, { title: qs[tab]!.header, body: [], question: qs[tab]!.question, options: labels(), selected: cursor }, this.term.cols);
      if (!first) this.term.write(`\x1b[${g.lines}A\x1b[J`);
      g.lines = lines.length;
      g.options = labels();
      g.selected = cursor;
      this.term.write(lines.map((l) => l + "\r\n").join(""));
    };
    const changed = () => {
      const g = this.gate!;
      g.id = sim.id("prompt", 10);
      this.cv?.setPrompt(prompt(g.id));
      draw();
    };
    const id = sim.id("prompt", 10);
    const g: Gate = { id, options: labels(), selected: 0, lines: 0, render: () => [], resolve: () => {} };
    this.gate = g;
    this.term.write(`\r${ERASE_LINE}`);
    draw(true);
    cv?.setPrompt(prompt(id));
    cv?.setMeta({ activity: "Waiting for your answer" });
    sim.patch(this.sid, { status: "waiting", last_line: qs[0]!.question }, `Claude asks: ${qs[0]!.question}`);
    sim.signal({ type: "prompt-opened", agent: this.sid, name: sim.session(this.sid)?.title ?? "", tool: "AskUserQuestion", command: qs[0]!.question });
    const outcome = await new Promise<{ cancel: boolean; by: DemoActor }>((resolve, reject) => {
      const auto = sim.clock.after(150_000, () => submit("world"));
      const off = this.scope.onCancel(() => {
        auto();
        reject(new Cancelled());
      });
      const finish = (cancel: boolean, by: DemoActor) => {
        auto();
        off();
        resolve({ cancel, by });
      };
      const submit = (by: DemoActor) => {
        for (let i = 0; i < qs.length; i++) if (!picked[i]!.length) picked[i] = [qs[i]!.options[0]!.label];
        finish(false, by);
      };
      g.resolve = (n, by) => finish(n === "2", by);
      g.act = (a, by) => {
        if (review()) {
          if (a.n === "1") return finish(false, by);
          if (a.n === "2") return finish(true, by);
          return;
        }
        const q = qs[tab]!;
        const idx = Number(a.n) - 1;
        if (idx < 0 || idx > q.options.length) return;
        if (idx === q.options.length) {
          if (!a.text) return;
          picked[tab] = [a.text];
        } else if (q.multi) {
          const l = q.options[idx]!.label;
          picked[tab] = picked[tab]!.includes(l) ? picked[tab]!.filter((x) => x !== l) : [...picked[tab]!, l];
          cursor = idx;
          return changed();
        } else picked[tab] = [q.options[idx]!.label];
        // One question ends the dialog; several move on to the next tab and, after the last, the review step.
        if (qs.length === 1) return finish(false, by);
        cursor = 0;
        tab++;
        changed();
      };
      g.bulk = (answers, by) => {
        answers.forEach((a, i) => {
          if (i >= qs.length) return;
          const known = a.labels.filter((l) => qs[i]!.options.some((o) => o.label === l));
          picked[i] = a.other ? [a.other] : qs[i]!.multi ? known : known.slice(0, 1);
        });
        submit(by);
      };
      g.key = (d) => {
        if (d === "\x1b[C" || d === "\x1b[D") {
          const to = Math.max(0, Math.min(qs.length > 1 ? qs.length : 0, tab + (d === "\x1b[C" ? 1 : -1)));
          if (to !== tab) {
            tab = to;
            cursor = 0;
            changed();
          }
          return true;
        }
        if (d === "\x1b[A" || d === "\x1b[B") {
          const n = labels().length;
          cursor = Math.max(0, Math.min(n - 1, cursor + (d === "\x1b[A" ? -1 : 1)));
          changed();
          return true;
        }
        if (d === "\r") {
          g.act!({ n: String(cursor + 1) }, "desk");
          return true;
        }
        if (d === "\x1b") {
          finish(true, "desk");
          return true;
        }
        return false;
      };
    });
    this.term.write(`\x1b[${g.lines}A\x1b[J`);
    this.gate = null;
    cv?.setPrompt(null);
    sim.signal({ type: "prompt-answered", agent: this.sid, allow: !outcome.cancel, by: outcome.by });
    if (outcome.cancel) {
      cv?.push("user", [{ k: "tool_result", tool_use_id: toolId, text: "The user doesn't want to proceed with this tool use. The tool use was rejected.", is_error: true }]);
      sim.patch(this.sid, { status: "working", last_line: "Question dismissed" });
      throw new Declined();
    }
    const answers = Object.fromEntries(qs.map((q, i) => [q.question, picked[i]!.join(", ")]));
    cv?.push("user", [
      {
        k: "tool_result",
        tool_use_id: toolId,
        text: `User has answered your questions: ${qs.map((q, i) => `"${q.question}"="${picked[i]!.join(", ")}"`).join(", ")}. You can now continue with the user's answers in mind.`,
        is_error: false,
        meta: { answers },
      },
    ]);
    this.term.write(`${dim(st.gutter)}${qs.map((q, i) => `${q.header}: ${bold(picked[i]!.join(", "))}`).join("  ")}\r\n\r\n`);
    sim.patch(this.sid, { status: "working", last_line: "Got your answer" });
    return picked;
  }

  /** ExitPlanMode: "Ready to start?" with the plan. */
  private async askPlan(plan: string): Promise<{ choice: "auto" | "manual" | "keep"; feedback?: string }> {
    const sim = this.sim;
    const cv = this.cv;
    const st = this.st;
    const toolId = this.toolId();
    cv?.push("assistant", [{ k: "tool_use", id: toolId, name: "ExitPlanMode", input: { plan } }], { model: "claude-sonnet-5-5" });
    const options = ["Yes, and auto-accept edits", "Yes, and manually approve edits", "No, keep planning"];
    const id = sim.id("prompt", 10);
    const g: Gate = {
      id,
      options,
      selected: 0,
      lines: 0,
      render: () => askBox(st, { title: "Ready to code?", body: plan.split("\n").slice(0, 10), question: "Would you like to proceed?", options, selected: g.selected }, this.term.cols),
      resolve: () => {},
    };
    const lines = g.render();
    g.lines = lines.length;
    this.term.write(`\r${ERASE_LINE}` + lines.map((l) => l + "\r\n").join(""));
    this.gate = g;
    cv?.setPrompt({
      id,
      kind: "plan",
      title: "Ready to code?",
      plan,
      tool: { name: "ExitPlanMode", input: { plan } },
      options: [
        { n: "1", label: "Yes, and auto-accept edits (shift+tab)", selected: true },
        { n: "2", label: "Yes, and manually approve edits", selected: false },
        { n: "3", label: "No, keep planning (esc)", selected: false },
        { n: "4", label: "Tell Claude what to change", selected: false, text: true },
      ],
    });
    cv?.setMeta({ activity: "Waiting for your approval" });
    sim.patch(this.sid, { status: "waiting", last_line: "Plan ready for approval" }, "Claude has a plan to approve");
    sim.signal({ type: "prompt-opened", agent: this.sid, name: sim.session(this.sid)?.title ?? "", tool: "ExitPlanMode", command: "Plan ready for approval" });
    const r = await new Promise<{ n: string; by: DemoActor; text?: string }>((resolve, reject) => {
      const auto = sim.clock.after(150_000, () => g.resolve("1", "world"));
      const off = this.scope.onCancel(() => {
        auto();
        reject(new Cancelled());
      });
      g.resolve = (n, by, text) => {
        auto();
        off();
        resolve({ n, by, ...(text ? { text } : {}) });
      };
      g.act = (a, by) => g.resolve(a.n, by, a.text);
    });
    this.term.write(`\x1b[${g.lines}A\x1b[J`);
    this.gate = null;
    cv?.setPrompt(null);
    const choice = r.n === "1" ? "auto" : r.n === "2" ? "manual" : "keep";
    sim.signal({ type: "prompt-answered", agent: this.sid, allow: choice !== "keep", by: r.by });
    if (choice === "keep") {
      cv?.push("user", [{ k: "tool_result", tool_use_id: toolId, text: r.text ? `The user doesn't want to proceed with this tool use. The tool use was rejected. User feedback: ${r.text}` : "The user doesn't want to proceed with this tool use. The tool use was rejected.", is_error: true }]);
    } else {
      this.setMode(choice === "auto" ? "acceptEdits" : "default");
      cv?.push("user", [{ k: "tool_result", tool_use_id: toolId, text: "User has approved your plan. You can now start coding. Start with updating your todo list if applicable", is_error: false }]);
    }
    sim.patch(this.sid, { status: "working", last_line: choice === "keep" ? "Plan not approved" : "Plan approved" });
    return { choice, ...(r.text ? { feedback: r.text } : {}) };
  }

  private toolId(): string {
    return "toolu_" + this.sim.id("tool", 20);
  }
}

/** The visitor said no: the turn ends politely. */
export class Declined extends Error {}

export type { CvMessage };

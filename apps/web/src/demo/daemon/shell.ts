// A small zsh-like shell on the fake disk: line editing, history, tab completion, pipes and enough
// commands (ls, cd, cat, grep, git, pnpm …) that typing into the demo terminal answers like a computer.

import { BOLD, COLOR, ERASE_LINE, RESET, SPINNER, dim, paint } from "./ansi.ts";
import { unified } from "./diff.ts";
import { Cancelled, makeScope, type Scope } from "./clock.ts";
import type { Sim } from "./sim.ts";
import type { Term } from "./term.ts";
import { basename, dirname, join, normalize, type Repo } from "./vfs.ts";

interface Ctx {
  out(text: string): void;
  sleep(ms: number): Promise<void>;
  stdin?: string;
}
type Cmd = (args: string[], ctx: Ctx) => Promise<number> | number;

const BLUE = "\x1b[1;34m";
const lf = (s: string) => s.replace(/\r?\n/g, "\r\n");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const p2 = (n: number) => String(n).padStart(2, "0");

export class Shell {
  readonly sim: Sim;
  readonly term: Term;
  cwd: string;
  private line = "";
  private history: string[] = [];
  private hIdx = -1;
  private run: Scope | null = null;
  private pending = "";
  private env = new Map<string, string>();
  private prev: string;
  private cmds: Record<string, Cmd>;

  constructor(sim: Sim, term: Term, cwd: string) {
    this.sim = sim;
    this.term = term;
    this.cwd = cwd;
    this.prev = cwd;
    this.env.set("HOME", sim.state ? "/Users/demo" : "/Users/demo");
    this.cmds = this.commands();
    term.onInput = (d) => this.input(d);
  }

  // ── prompt and input ───────────────────────────────────────────────────────────────────────

  prompt(): string {
    const repo = this.sim.vfs.repoOf(this.cwd);
    const dir = this.cwd === "/Users/demo" ? "~" : basename(this.cwd) || "/";
    let s = `${BOLD}${COLOR.green}➜${RESET}  ${BOLD}${COLOR.cyan}${dir}${RESET} `;
    if (repo) {
      const dirty = this.sim.vfs.status(repo).length > 0;
      s += `${BOLD}${COLOR.blue}git:(${COLOR.red}${repo.branch}${COLOR.blue})${RESET} ${dirty ? COLOR.yellow + "✗" + RESET + " " : ""}`;
    }
    return s;
  }

  start() {
    this.term.write(this.prompt());
  }

  input(data: string) {
    if (this.run) {
      if (data.includes("\x03")) {
        this.run.cancel();
        return;
      }
      this.pending += data;
      return;
    }
    this.feed(data);
  }

  private feed(data: string) {
    for (let i = 0; i < data.length; i++) {
      const c = data[i]!;
      if (c === "\x1b") {
        const m = /^\x1b\[([0-9;]*)([A-Za-z~])/.exec(data.slice(i));
        if (m) {
          if (m[2] === "A") this.recall(-1);
          else if (m[2] === "B") this.recall(1);
          i += m[0].length - 1;
        } else if (data[i + 1] === "[" || data[i + 1] === "O") i += 2;
        continue;
      }
      if (c === "\r" || c === "\n") {
        if (c === "\n" && data[i - 1] === "\r") continue;
        this.submit();
        if (this.run) {
          this.pending += data.slice(i + 1);
          return;
        }
      } else if (c === "\x7f" || c === "\b") {
        if (this.line) {
          this.line = this.line.slice(0, -1);
          this.term.write("\b \b");
        }
      } else if (c === "\x03") {
        this.term.write("^C\r\n" + this.prompt());
        this.line = "";
      } else if (c === "\x15") {
        this.line = "";
        this.term.write(`\r${ERASE_LINE}${this.prompt()}`);
      } else if (c === "\x0c") {
        this.term.wipe();
        this.term.write(`\x1b[H\x1b[2J${this.prompt()}${this.line}`);
      } else if (c === "\x04") {
        if (!this.line) this.term.write("\r\nlogout\r\n[Process completed]\r\n");
      } else if (c === "\t") {
        this.complete();
      } else if (c >= " ") {
        this.line += c;
        this.term.write(c);
      }
    }
  }

  private recall(dir: number) {
    if (!this.history.length) return;
    this.hIdx = Math.min(this.history.length, Math.max(-1, (this.hIdx < 0 ? this.history.length : this.hIdx) + dir));
    this.line = this.hIdx >= 0 && this.hIdx < this.history.length ? this.history[this.hIdx]! : "";
    this.term.write(`\r${ERASE_LINE}${this.prompt()}${this.line}`);
  }

  private complete() {
    const m = /(\S*)$/.exec(this.line)!;
    const word = m[1]!;
    const dir = word.includes("/") ? this.path(word.slice(0, word.lastIndexOf("/") + 1)) : this.cwd;
    const stem = word.slice(word.lastIndexOf("/") + 1);
    const first = this.line.trim().indexOf(" ") < 0;
    const names = first && !word.includes("/") ? Object.keys(this.cmds) : this.sim.vfs.list(dir).map((e) => (e.dir ? e.name + "/" : e.name));
    const hits = names.filter((n) => n.startsWith(stem) && (stem || !n.startsWith("."))).sort();
    if (!hits.length) return;
    if (hits.length === 1) {
      const rest = hits[0]!.slice(stem.length) + (hits[0]!.endsWith("/") ? "" : " ");
      this.line += rest;
      this.term.write(rest);
      return;
    }
    let common = hits[0]!;
    for (const h of hits) while (!h.startsWith(common)) common = common.slice(0, -1);
    if (common.length > stem.length) {
      const rest = common.slice(stem.length);
      this.line += rest;
      this.term.write(rest);
    } else {
      this.term.write("\r\n" + hits.map((h) => (h.endsWith("/") ? BLUE + h + RESET : h)).join("  ") + "\r\n" + this.prompt() + this.line);
    }
  }

  private submit() {
    const text = this.line.trim();
    this.line = "";
    this.hIdx = -1;
    this.term.write("\r\n");
    if (!text) {
      this.term.write(this.prompt());
      return;
    }
    if (this.history[this.history.length - 1] !== text) this.history.push(text);
    if (this.history.length > 100) this.history.shift();
    this.run = makeScope(this.sim.scope);
    const scope = this.run;
    void this.exec(text, scope).finally(() => {
      this.run = null;
      this.term.write(this.prompt());
      const rest = this.pending;
      this.pending = "";
      if (rest) this.feed(rest);
    });
  }

  // ── running ────────────────────────────────────────────────────────────────────────────────

  private path(p: string): string {
    if (p === "~" || p.startsWith("~/")) p = "/Users/demo" + p.slice(1);
    return normalize(p.startsWith("/") ? p : join(this.cwd, p));
  }

  private tokens(s: string): string[] {
    const out: string[] = [];
    const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
    for (let m = re.exec(s); m; m = re.exec(s)) out.push(m[1] ?? m[2] ?? m[3]!);
    return out;
  }

  private async exec(text: string, scope: Scope) {
    const ctx = (stdout: { v: string } | null, stdin?: string): Ctx => ({
      out: (t) => (stdout ? void (stdout.v += t) : this.term.write(lf(t))),
      sleep: (ms) => this.sim.clock.sleep(ms, scope),
      stdin,
    });
    try {
      for (const chain of text.split(/\s*(?:&&|;)\s*/)) {
        let input: string | undefined;
        const stages = chain.split(/\s*\|\s*/);
        let code = 0;
        for (let i = 0; i < stages.length; i++) {
          const last = i === stages.length - 1;
          const toks = this.tokens(stages[i]!.replace(/\$(\w+)/g, (_, k: string) => this.env.get(k) ?? ""));
          if (!toks.length) continue;
          const buf = last ? null : { v: "" };
          const cmd = this.cmds[toks[0]!];
          if (!cmd) {
            this.term.write(lf(`zsh: command not found: ${toks[0]}\n`));
            code = 127;
            break;
          }
          code = await cmd(toks.slice(1), ctx(buf, input));
          input = buf?.v;
        }
        if (code !== 0) break;
      }
    } catch (e) {
      if (e instanceof Cancelled) this.term.write("^C\r\n");
      else throw e;
    }
  }

  // ── commands ───────────────────────────────────────────────────────────────────────────────

  private commands(): Record<string, Cmd> {
    const sim = this.sim;
    const vfs = sim.vfs;
    const err = (ctx: Ctx, s: string) => {
      ctx.out(paint(COLOR.red, s) + "\n");
      return 1;
    };
    const readAll = (args: string[], ctx: Ctx): string | null => {
      const files = args.filter((a) => !a.startsWith("-"));
      if (!files.length) return ctx.stdin ?? "";
      let out = "";
      for (const f of files) {
        const t = vfs.read(this.path(f));
        if (t === null) {
          ctx.out(`${f}: No such file or directory\n`);
          return null;
        }
        out += t;
      }
      return out;
    };
    const num = (args: string[], def: number) => {
      const i = args.findIndex((a) => a === "-n");
      if (i >= 0 && args[i + 1]) return Number(args[i + 1]);
      const m = args.find((a) => /^-\d+$/.test(a));
      return m ? -Number(m) : def;
    };
    const git = (args: string[], ctx: Ctx) => this.git(args, ctx);
    const pm = (args: string[], ctx: Ctx) => this.pm(args, ctx);
    return {
      echo: (a, c) => (c.out(a.join(" ") + "\n"), 0),
      pwd: (_a, c) => (c.out(this.cwd + "\n"), 0),
      whoami: (_a, c) => (c.out("demo\n"), 0),
      hostname: (_a, c) => (c.out("Studio.local\n"), 0),
      uname: (a, c) => (c.out(a.includes("-a") ? "Darwin Studio.local 25.0.0 Darwin Kernel Version 25.0.0 arm64\n" : "Darwin\n"), 0),
      date: (_a, c) => {
        const d = new Date(sim.now());
        c.out(`${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())} UTC ${d.getUTCFullYear()}\n`);
        return 0;
      },
      clear: () => (this.term.wipe(), this.term.write("\x1b[H\x1b[2J\x1b[3J"), 0),
      history: (_a, c) => (c.out(this.history.map((h, i) => `${String(i + 1).padStart(5)}  ${h}`).join("\n") + "\n"), 0),
      env: (_a, c) => (c.out(["HOME=/Users/demo", "USER=demo", "SHELL=/bin/zsh", "TERM=xterm-256color", `PWD=${this.cwd}`, ...[...this.env].map(([k, v]) => `${k}=${v}`)].join("\n") + "\n"), 0),
      export: (a) => {
        for (const x of a) {
          const i = x.indexOf("=");
          if (i > 0) this.env.set(x.slice(0, i), x.slice(i + 1));
        }
        return 0;
      },
      which: (a, c) => (c.out(a.map((x) => (this.cmds[x] ? `/usr/local/bin/${x}\n` : `${x} not found\n`)).join("")), 0),
      sleep: async (a, c) => (await c.sleep(Math.min(8, Number(a[0] ?? 1)) * 1000), 0),
      exit: (_a, c) => (c.out("This is a demo shell, there is nothing to exit.\n"), 0),
      help: (_a, c) => {
        c.out(`${BOLD}This is a demo computer.${RESET} Everything here is simulated, nothing leaves your browser.\n`);
        c.out(`Try: ${paint(COLOR.cyan, "ls")}, ${paint(COLOR.cyan, "git status")}, ${paint(COLOR.cyan, "git diff")}, ${paint(COLOR.cyan, "cat README.md")}, ${paint(COLOR.cyan, "pnpm test")}, ${paint(COLOR.cyan, "tree src")}\n`);
        return 0;
      },
      cd: (a, c) => {
        const to = a[0] === "-" ? this.prev : this.path(a[0] ?? "~");
        if (!vfs.isDir(to)) return err(c, `cd: no such file or directory: ${a[0]}`);
        this.prev = this.cwd;
        this.cwd = to;
        return 0;
      },
      ls: (a, c) => {
        const flags = a.filter((x) => x.startsWith("-")).join("");
        const target = this.path(a.find((x) => !x.startsWith("-")) ?? ".");
        if (vfs.isFile(target)) return (c.out(basename(target) + "\n"), 0);
        if (!vfs.isDir(target)) return err(c, `ls: ${a.find((x) => !x.startsWith("-"))}: No such file or directory`);
        const all = flags.includes("a");
        const list = vfs.list(target).filter((e) => all || !e.name.startsWith(".")).sort((x, y) => (x.name < y.name ? -1 : 1));
        const name = (e: { name: string; dir: boolean }) => (e.dir ? BLUE + e.name + RESET : e.name.endsWith(".ts") || e.name.endsWith(".tsx") ? e.name : e.name);
        if (flags.includes("l")) {
          const d = new Date(sim.now());
          const stamp = `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2)} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
          c.out(`total ${list.length * 8}\n`);
          for (const e of list) c.out(`${e.dir ? "drwxr-xr-x" : "-rw-r--r--"}  ${e.dir ? 5 : 1} demo  staff  ${String(e.dir ? 160 : (e.file?.size ?? 0)).padStart(6)} ${stamp} ${name(e)}\n`);
        } else c.out(list.map(name).join("  ") + "\n");
        return 0;
      },
      tree: (a, c) => {
        const root = this.path(a.find((x) => !x.startsWith("-")) ?? ".");
        if (!vfs.isDir(root)) return err(c, `tree: ${a[0]}: No such directory`);
        let dirs = 0;
        let files = 0;
        const walk = (dir: string, pre: string, depth: number) => {
          const kids = vfs.list(dir).filter((e) => !e.name.startsWith(".") && e.name !== "node_modules").sort((x, y) => (x.name < y.name ? -1 : 1));
          kids.forEach((e, i) => {
            const last = i === kids.length - 1;
            c.out(`${pre}${last ? "└── " : "├── "}${e.dir ? BLUE + e.name + RESET : e.name}\n`);
            if (e.dir) {
              dirs++;
              if (depth < 4) walk(e.path, pre + (last ? "    " : "│   "), depth + 1);
            } else files++;
          });
        };
        c.out(`${BLUE}${a.find((x) => !x.startsWith("-")) ?? "."}${RESET}\n`);
        walk(root, "", 0);
        c.out(`\n${dirs} directories, ${files} files\n`);
        return 0;
      },
      cat: (a, c) => {
        const t = readAll(a, c);
        if (t === null) return 1;
        c.out(t.endsWith("\n") || !t ? t : t + "\n");
        return 0;
      },
      head: (a, c) => {
        const t = readAll(a.filter((x, i) => x !== "-n" && a[i - 1] !== "-n"), c);
        if (t === null) return 1;
        c.out(t.split("\n").slice(0, Math.abs(num(a, 10))).join("\n") + "\n");
        return 0;
      },
      tail: (a, c) => {
        const t = readAll(a.filter((x, i) => x !== "-n" && a[i - 1] !== "-n"), c);
        if (t === null) return 1;
        c.out(t.replace(/\n$/, "").split("\n").slice(-Math.abs(num(a, 10))).join("\n") + "\n");
        return 0;
      },
      wc: (a, c) => {
        const t = readAll(a.filter((x) => !x.startsWith("-")), c);
        if (t === null) return 1;
        const n = t.split("\n").length - (t.endsWith("\n") ? 1 : 0);
        c.out(a.includes("-l") ? `${n}\n` : `${String(n).padStart(8)} ${String(t.split(/\s+/).filter(Boolean).length).padStart(7)} ${String(t.length).padStart(7)}\n`);
        return 0;
      },
      grep: (a, c) => {
        const flags = a.filter((x) => x.startsWith("-")).join("");
        const rest = a.filter((x) => !x.startsWith("-"));
        const pat = rest.shift();
        if (!pat) return err(c, "usage: grep [-rniv] pattern [file ...]");
        let re: RegExp;
        try {
          re = new RegExp(pat, flags.includes("i") ? "i" : "");
        } catch {
          return err(c, "grep: invalid regular expression");
        }
        const hits: string[] = [];
        const scan = (label: string, text: string) =>
          text.split("\n").forEach((l, i) => {
            if (re.test(l) !== flags.includes("v")) hits.push(`${label ? paint(COLOR.magenta, label) + ":" : ""}${flags.includes("n") ? paint(COLOR.green, String(i + 1)) + ":" : ""}${l}`);
          });
        if (!rest.length && !flags.includes("r")) scan("", c.stdin ?? "");
        else
          for (const r of rest.length ? rest : ["."]) {
            const p = this.path(r);
            const files = vfs.isDir(p) ? vfs.walk(p).map((x) => join(p, x)) : [p];
            for (const f of files) {
              const t = vfs.read(f);
              if (t !== null && !f.includes("/node_modules/")) scan(files.length > 1 || flags.includes("r") ? f.replace(this.cwd + "/", "") : "", t);
            }
          }
        if (hits.length) c.out(hits.slice(0, 200).join("\n") + "\n");
        return hits.length ? 0 : 1;
      },
      find: (a, c) => {
        const root = this.path(a.find((x) => !x.startsWith("-") && !x.includes("*")) ?? ".");
        const i = a.indexOf("-name");
        const re = i >= 0 ? new RegExp("^" + a[i + 1]!.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$") : null;
        const base = a[0] && !a[0].startsWith("-") ? a[0] : ".";
        const out = vfs.walk(root).filter((f) => !re || re.test(basename(f))).map((f) => (base === "." ? "./" : base.replace(/\/$/, "") + "/") + f);
        c.out(out.slice(0, 200).join("\n") + (out.length ? "\n" : ""));
        return 0;
      },
      mkdir: (a, c) => {
        for (const x of a.filter((y) => !y.startsWith("-"))) vfs.mkdir(this.path(x));
        sim.refreshAllGit();
        return (void c, 0);
      },
      touch: (a) => {
        for (const x of a) if (!vfs.exists(this.path(x))) vfs.write(this.path(x), "");
        sim.refreshAllGit();
        return 0;
      },
      rm: (a, c) => {
        for (const x of a.filter((y) => !y.startsWith("-"))) {
          const p = this.path(x);
          if (!vfs.exists(p)) return err(c, `rm: ${x}: No such file or directory`);
          if (vfs.isDir(p) && !a.some((y) => /^-.*r/.test(y))) return err(c, `rm: ${x}: is a directory`);
          for (const f of vfs.isDir(p) ? vfs.walk(p).map((r) => join(p, r)) : [p]) vfs.remove(f);
        }
        sim.refreshAllGit();
        return 0;
      },
      mv: (a, c) => {
        const [from, to] = a.filter((x) => !x.startsWith("-"));
        const t = vfs.read(this.path(from ?? ""));
        if (t === null || !to) return err(c, "mv: cannot move that");
        const dest = vfs.isDir(this.path(to)) ? join(this.path(to), basename(from!)) : this.path(to);
        vfs.write(dest, t);
        vfs.remove(this.path(from!));
        sim.refreshAllGit();
        return 0;
      },
      cp: (a, c) => {
        const [from, to] = a.filter((x) => !x.startsWith("-"));
        const t = vfs.read(this.path(from ?? ""));
        if (t === null || !to) return err(c, "cp: cannot copy that");
        vfs.write(vfs.isDir(this.path(to)) ? join(this.path(to), basename(from!)) : this.path(to), t);
        sim.refreshAllGit();
        return 0;
      },
      node: (a, c) => (c.out(a.includes("-v") || a.includes("--version") ? "v22.11.0\n" : "Welcome to Node.js v22.11.0.\n"), 0),
      git,
      pnpm: pm,
      npm: pm,
      yarn: pm,
      npx: (_a, c) => (c.out("npx: nothing to run in this demo\n"), 0),
      claude: (_a, c) => (c.out(dim("This is the demo shell. Start Claude from the New agent button.") + "\n"), 0),
      codex: (_a, c) => (c.out(dim("This is the demo shell. Start Codex from the New agent button.") + "\n"), 0),
      open: (_a, c) => (c.out("open: not available in the demo\n"), 0),
    };
  }

  // ── git ────────────────────────────────────────────────────────────────────────────────────

  private repo(ctx: Ctx): Repo | null {
    const r = this.sim.vfs.repoOf(this.cwd);
    if (!r) ctx.out("fatal: not a git repository (or any of the parent directories): .git\n");
    return r ?? null;
  }

  private git(args: string[], ctx: Ctx): number {
    const vfs = this.sim.vfs;
    const repo = this.repo(ctx);
    if (!repo) return 128;
    const sub = args[0] ?? "";
    const st = vfs.status(repo);
    const label = (s: string) => ({ modified: "modified:   ", added: "new file:   ", deleted: "deleted:    ", renamed: "renamed:    ", conflicted: "both modified: ", untracked: "" })[s] ?? "";
    switch (sub) {
      case "status": {
        if (args.includes("-s") || args.includes("-sb")) {
          if (args.includes("-sb")) ctx.out(`## ${repo.branch}${repo.ahead ? ` [ahead ${repo.ahead}]` : ""}\n`);
          for (const e of st) ctx.out(`${e.staged ? paint(COLOR.green, e.status === "added" ? "A" : "M") : " "}${e.status === "untracked" ? paint(COLOR.red, "?") : e.staged ? " " : paint(COLOR.red, "M")} ${e.path}\n`);
          return 0;
        }
        ctx.out(`On branch ${repo.branch}\n`);
        if (repo.ahead) ctx.out(`Your branch is ahead of 'origin/${repo.branch}' by ${repo.ahead} commit${repo.ahead > 1 ? "s" : ""}.\n  (use "git push" to publish your local commits)\n`);
        else ctx.out(`Your branch is up to date with 'origin/${repo.branch}'.\n`);
        const staged = st.filter((e) => e.staged);
        const unstaged = st.filter((e) => !e.staged && e.status !== "untracked");
        const untracked = st.filter((e) => !e.staged && e.status === "untracked");
        if (staged.length) ctx.out(`\nChanges to be committed:\n  (use "git restore --staged <file>..." to unstage)\n${staged.map((e) => paint(COLOR.green, `\t${label(e.status)}${e.path}`)).join("\n")}\n`);
        if (unstaged.length) ctx.out(`\nChanges not staged for commit:\n  (use "git add <file>..." to update what will be committed)\n${unstaged.map((e) => paint(COLOR.red, `\t${label(e.status)}${e.path}`)).join("\n")}\n`);
        if (untracked.length) ctx.out(`\nUntracked files:\n  (use "git add <file>..." to include in what will be committed)\n${untracked.map((e) => paint(COLOR.red, `\t${e.path}`)).join("\n")}\n`);
        if (!st.length) ctx.out("\nnothing to commit, working tree clean\n");
        return 0;
      }
      case "log": {
        const one = args.includes("--oneline");
        const n = Number((args.find((a) => /^-\d+$/.test(a)) ?? "-20").slice(1));
        for (const l of repo.log.slice(0, n)) {
          if (one) ctx.out(`${paint(COLOR.yellow, l.hash)} ${l.subject}\n`);
          else {
            const d = new Date(l.at);
            ctx.out(`${paint(COLOR.yellow, "commit " + l.hash + "4c9d1e8a02b7f3")}\nAuthor: ${l.author} <demo@example.com>\nDate:   ${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:00 ${d.getUTCFullYear()} +0000\n\n    ${l.subject}\n\n`);
          }
        }
        return 0;
      }
      case "diff": {
        const staged = args.includes("--staged") || args.includes("--cached");
        const only = args.filter((a) => !a.startsWith("-"))[1];
        for (const e of st) {
          if (staged !== e.staged || e.status === "untracked") continue;
          if (only && !e.path.includes(only)) continue;
          const text = unified(e.path, repo.head.get(e.path) ?? null, vfs.read(join(repo.root, e.path)));
          ctx.out(
            text
              .split("\n")
              .map((l) => (l.startsWith("+++") || l.startsWith("---") || l.startsWith("diff ") || l.startsWith("index ") ? BOLD + l + RESET : l.startsWith("@@") ? COLOR.cyan + l + RESET : l.startsWith("+") ? COLOR.green + l + RESET : l.startsWith("-") ? COLOR.red + l + RESET : l))
              .join("\n") + "\n",
          );
        }
        return 0;
      }
      case "add": {
        const target = args[1] === "." || args[1] === "-A" || !args[1] ? null : normalize(join(this.cwd, args[1])).slice(repo.root.length + 1);
        vfs.add(repo, target);
        this.sim.refreshAllGit();
        return 0;
      }
      case "commit": {
        const i = args.indexOf("-m");
        const msg = i >= 0 ? args[i + 1] : undefined;
        if (args.includes("-a")) vfs.add(repo, null);
        if (!msg) {
          ctx.out("Aborting commit due to empty commit message.\n");
          return 1;
        }
        const r = vfs.commit(repo, msg, "Demo User", this.sim.now());
        if (!r) {
          ctx.out("nothing added to commit but untracked files may be present (use \"git add\" to track)\n");
          return 1;
        }
        ctx.out(`[${repo.branch} ${r.hash}] ${msg}\n ${r.files} file${r.files > 1 ? "s" : ""} changed\n`);
        repo.ahead++;
        this.sim.refreshAllGit();
        return 0;
      }
      case "branch":
        ctx.out(`${paint(COLOR.green, "* " + repo.branch)}\n  main\n`);
        return 0;
      case "checkout":
      case "switch": {
        const b = args.find((a, i) => i > 0 && !a.startsWith("-"));
        if (b) {
          repo.branch = b;
          ctx.out(`Switched to ${args.includes("-b") || args.includes("-c") ? "a new " : ""}branch '${b}'\n`);
          this.sim.refreshAllGit();
        }
        return 0;
      }
      case "remote":
        ctx.out("origin\thttps://github.com/demo/" + basename(repo.root) + ".git (fetch)\norigin\thttps://github.com/demo/" + basename(repo.root) + ".git (push)\n");
        return 0;
      case "push":
        ctx.out(dim("Everything up-to-date (demo: nothing leaves your browser)") + "\n");
        return 0;
      default:
        ctx.out(`git: '${sub}' is not supported in the demo shell\n`);
        return 1;
    }
  }

  // ── package manager ────────────────────────────────────────────────────────────────────────

  private async pm(args: string[], ctx: Ctx): Promise<number> {
    const vfs = this.sim.vfs;
    const root = vfs.repoOf(this.cwd)?.root ?? this.cwd;
    const pkgText = vfs.read(join(root, "package.json"));
    if (args[0] === "-v" || args[0] === "--version") return (ctx.out("10.4.1\n"), 0);
    if (pkgText === null) {
      ctx.out(paint(COLOR.red, "ERR_PNPM_NO_PKG_MANIFEST") + " No package.json found in " + this.cwd + "\n");
      return 1;
    }
    const pkg = JSON.parse(pkgText) as { name?: string; version?: string; scripts?: Record<string, string> };
    const name = pkg.name ?? basename(root);
    let script = args[0] === "run" ? args[1] : args[0];
    if (script === "install" || script === "i" || script === "add") {
      ctx.out("Lockfile is up to date, resolution step is skipped\nProgress: resolved 1, reused 1, downloaded 0, added 0, done\n");
      await ctx.sleep(700);
      ctx.out(`\nDone in 0.8s\n`);
      return 0;
    }
    if (!script || !pkg.scripts?.[script]) {
      ctx.out(`${paint(COLOR.red, "ERR_PNPM_NO_SCRIPT")} Missing script: ${script ?? ""}\n\nCommands available via "pnpm run":\n${Object.keys(pkg.scripts ?? {}).map((k) => "  " + k).join("\n")}\n`);
      return 1;
    }
    ctx.out(`\n> ${name}@${pkg.version ?? "0.0.0"} ${script} ${root}\n> ${pkg.scripts[script]}\n\n`);
    if (script === "test") return this.vitest(root, ctx);
    if (script === "dev") {
      await ctx.sleep(500);
      ctx.out(`${dim("[tsx]")} watching for changes\n{"level":30,"msg":"Server listening at http://0.0.0.0:4000"}\n`);
      for (;;) await ctx.sleep(1500);
    }
    if (script === "build") {
      await ctx.sleep(1100);
      ctx.out(`${paint(COLOR.green, "✓")} compiled ${vfs.walk(join(root, "src")).length} files\n`);
      return 0;
    }
    for (let i = 0; i < 4; i++) {
      ctx.out(`\r${SPINNER[i]} ${script}`);
      await ctx.sleep(180);
    }
    ctx.out(`\r${ERASE_LINE}${paint(COLOR.green, "✓")} ${script} finished with no problems\n`);
    return 0;
  }

  private async vitest(root: string, ctx: Ctx): Promise<number> {
    const vfs = this.sim.vfs;
    const files = vfs.walk(root).filter((f) => /\.test\.tsx?$/.test(f) && !f.includes("node_modules"));
    ctx.out(`${dim(" RUN ")} ${paint(COLOR.cyan, "v2.1.8")} ${dim(root)}\n\n`);
    let tests = 0;
    for (const f of files) {
      const n = Math.max(1, (vfs.read(join(root, f))?.match(/\bit\(/g) ?? []).length);
      tests += n;
      await ctx.sleep(140);
      ctx.out(` ${paint(COLOR.green, "✓")} ${f} ${dim(`(${n} test${n > 1 ? "s" : ""})`)} ${dim(this.sim.rng.int(2, 19) + "ms")}\n`);
    }
    await ctx.sleep(200);
    ctx.out(`\n ${dim("Test Files")}  ${paint(COLOR.green, `${files.length} passed`)} ${dim(`(${files.length})`)}\n      ${dim("Tests")}  ${paint(COLOR.green, `${tests} passed`)} ${dim(`(${tests})`)}\n   ${dim("Duration")}  ${this.sim.rng.int(280, 540)}ms\n\n`);
    return 0;
  }

  dispose() {
    this.run?.cancel();
    this.term.onInput = null;
  }

  /** The folder name used in titles. */
  get label() {
    return basename(this.cwd) || dirname(this.cwd);
  }
}


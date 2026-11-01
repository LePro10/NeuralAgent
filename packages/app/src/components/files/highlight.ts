// A small syntax highlighter for the file viewer: comments, strings, numbers, keywords, types,
// function calls and markup tags for the usual languages. No dependency; it is a colouring aid,
// not a parser. Above `MAX_HIGHLIGHT` the text stays plain (it would cost more than it helps).

export type TokenClass = "com" | "str" | "num" | "kw" | "type" | "fn" | "tag" | "attr" | "prop" | "lit";
export interface Token {
  c?: TokenClass;
  s: string;
}
export type Line = Token[];

export const MAX_HIGHLIGHT = 400 * 1024;

interface Spec {
  line?: string[];
  block?: [string, string][];
  /** Quote characters; backtick strings may span lines. */
  quotes: string;
  kw: Set<string>;
  lit?: Set<string>;
  /** Capitalised words are types. */
  types?: boolean;
  markup?: boolean;
  /** JSON / YAML / TOML: a word or string before `:` / `=` is a key. */
  keys?: boolean;
}

const words = (s: string) => new Set(s.split(/\s+/).filter(Boolean));
const C_LIT = words("true false null undefined nil None True False NULL nullptr self this super Self");

const JS = words(
  "abstract any as async await boolean break case catch class const constructor continue debugger declare default delete do else enum export extends finally for from function get if implements import in infer instanceof interface is keyof let module namespace never new number object of private protected public readonly return satisfies set static string switch symbol throw try type typeof unknown var void while with yield",
);
const RUST = words("as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return static struct trait type unsafe use where while macro_rules union");
const PY = words("and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case print");
const GO = words("break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var");
const C = words(
  "auto break case char const continue default do double else enum extern float for goto if inline int long register return short signed sizeof static struct switch typedef union unsigned void volatile while class namespace template typename public private protected virtual override new delete using try catch throw import package interface extends implements final abstract synchronized boolean byte var val fun when object companion data sealed lateinit suspend override open internal let guard func protocol extension struct init deinit where defer async await throws",
);
const SH = words("if then else elif fi for while until do done case esac in function return local export source alias echo exit set unset readonly shift cd");
const SQL = words("select from where and or not insert into values update set delete create table index view drop alter add join left right inner outer on as group by order having limit offset union all distinct case when then else end primary key foreign references null default");
const CSS = words("important media supports import keyframes font-face");

const SPECS: Record<string, Spec> = {
  ts: { line: ["//"], block: [["/*", "*/"]], quotes: "\"'`", kw: JS, lit: C_LIT, types: true },
  js: { line: ["//"], block: [["/*", "*/"]], quotes: "\"'`", kw: JS, lit: C_LIT, types: true },
  rust: { line: ["//"], block: [["/*", "*/"]], quotes: "\"", kw: RUST, lit: C_LIT, types: true },
  py: { line: ["#"], quotes: "\"'", kw: PY, lit: C_LIT, types: true },
  rb: { line: ["#"], quotes: "\"'", kw: words("def end class module if elsif else unless while until for in do return yield begin rescue ensure raise require include attr_accessor self nil true false then case when"), types: true },
  go: { line: ["//"], block: [["/*", "*/"]], quotes: "\"'`", kw: GO, lit: C_LIT, types: true },
  c: { line: ["//"], block: [["/*", "*/"]], quotes: "\"'", kw: C, lit: C_LIT, types: true },
  cpp: { line: ["//"], block: [["/*", "*/"]], quotes: "\"'", kw: C, lit: C_LIT, types: true },
  java: { line: ["//"], block: [["/*", "*/"]], quotes: "\"'", kw: C, lit: C_LIT, types: true },
  kotlin: { line: ["//"], block: [["/*", "*/"]], quotes: "\"'", kw: C, lit: C_LIT, types: true },
  swift: { line: ["//"], block: [["/*", "*/"]], quotes: "\"", kw: C, lit: C_LIT, types: true },
  cs: { line: ["//"], block: [["/*", "*/"]], quotes: "\"'", kw: C, lit: C_LIT, types: true },
  dart: { line: ["//"], block: [["/*", "*/"]], quotes: "\"'", kw: C, lit: C_LIT, types: true },
  php: { line: ["//", "#"], block: [["/*", "*/"]], quotes: "\"'", kw: C, lit: C_LIT },
  lua: { line: ["--"], quotes: "\"'", kw: words("and break do else elseif end for function goto if in local not or repeat return then until while"), lit: C_LIT },
  sh: { line: ["#"], quotes: "\"'", kw: SH, lit: C_LIT },
  sql: { line: ["--"], block: [["/*", "*/"]], quotes: "'\"", kw: SQL, lit: C_LIT },
  css: { block: [["/*", "*/"]], quotes: "\"'", kw: CSS, keys: false },
  json: { quotes: "\"", kw: new Set(), lit: C_LIT, keys: true },
  toml: { line: ["#", ";"], quotes: "\"'", kw: new Set(), lit: C_LIT, keys: true },
  yaml: { line: ["#"], quotes: "\"'", kw: new Set(), lit: words("true false null yes no on off ~"), keys: true },
  html: { block: [["<!--", "-->"]], quotes: "\"'", kw: new Set(), markup: true },
};

const isWord = (ch: string) => /[\w$]/.test(ch);

/** Splits `text` into lines of coloured tokens. Unknown languages come back as plain lines. */
export function highlight(text: string, lang: string): Line[] {
  const spec = SPECS[lang];
  if (!spec || text.length > MAX_HIGHLIGHT) return text.split("\n").map((s) => (s ? [{ s }] : []));
  const toks: Token[] = [];
  const push = (s: string, c?: TokenClass) => {
    if (!s) return;
    const last = toks[toks.length - 1];
    if (last && last.c === c) last.s += s;
    else toks.push(c ? { c, s } : { s });
  };
  let i = 0;
  let inTag = false;
  const n = text.length;
  outer: while (i < n) {
    const ch = text[i]!;
    // Comments.
    for (const l of spec.line ?? []) {
      if (text.startsWith(l, i) && !(l === "#" && i > 0 && isWord(text[i - 1]!)) && !(lang === "sh" && l === "#" && text[i - 1] === "$")) {
        const end = text.indexOf("\n", i);
        const j = end < 0 ? n : end;
        push(text.slice(i, j), "com");
        i = j;
        continue outer;
      }
    }
    for (const [a, b] of spec.block ?? []) {
      if (text.startsWith(a, i)) {
        const end = text.indexOf(b, i + a.length);
        const j = end < 0 ? n : end + b.length;
        push(text.slice(i, j), "com");
        i = j;
        continue outer;
      }
    }
    // Markup: tags and their attributes.
    if (spec.markup) {
      if (ch === "<" && /[A-Za-z/!?]/.test(text[i + 1] ?? "")) {
        const m = /^<\/?[\w:.-]*/.exec(text.slice(i, i + 80))!;
        push(m[0], "tag");
        i += m[0].length;
        inTag = true;
        continue;
      }
      if (inTag && (ch === ">" || (ch === "/" && text[i + 1] === ">"))) {
        const s = ch === ">" ? ">" : "/>";
        push(s, "tag");
        i += s.length;
        inTag = false;
        continue;
      }
      if (!inTag) {
        const next = text.indexOf("<", i + 1);
        const j = next < 0 ? n : next;
        push(text.slice(i, j));
        i = j;
        continue;
      }
    }
    // Strings (a backslash escapes; only backticks cross lines).
    if (spec.quotes.includes(ch)) {
      let j = i + 1;
      while (j < n && text[j] !== ch) {
        if (text[j] === "\\") j++;
        else if (text[j] === "\n" && ch !== "`" && !(lang === "py" && text.startsWith(ch.repeat(3), i))) break;
        j++;
      }
      // Python triple quotes.
      if (lang === "py" && text.startsWith(ch.repeat(3), i)) {
        const end = text.indexOf(ch.repeat(3), i + 3);
        j = end < 0 ? n - 1 : end + 2;
      }
      const s = text.slice(i, Math.min(n, j + 1));
      const after = text.slice(i + s.length, i + s.length + 40);
      push(s, spec.keys && /^\s*:/.test(after) ? "prop" : "str");
      i += s.length;
      continue;
    }
    // Numbers.
    if (/[0-9]/.test(ch) && !isWord(text[i - 1] ?? " ")) {
      const m = /^(0x[\da-fA-F_]+|0b[01_]+|\d[\d_]*(\.\d[\d_]*)?([eE][+-]?\d+)?)[a-zA-Z_\d]*/.exec(text.slice(i, i + 64))!;
      push(m[0], "num");
      i += m[0].length;
      continue;
    }
    // Words.
    if (isWord(ch)) {
      let j = i;
      while (j < n && (isWord(text[j]!) || (spec.markup && text[j] === "-"))) j++;
      const w = text.slice(i, j);
      const rest = text.slice(j, j + 40);
      let c: TokenClass | undefined;
      if (spec.markup && inTag) c = "attr";
      else if (spec.keys && /^\s*[:=]/.test(rest) && (lang !== "css")) c = "prop";
      else if (spec.kw.has(lang === "sql" ? w.toLowerCase() : w)) c = "kw";
      else if (spec.lit?.has(w)) c = "lit";
      else if (/^\s*\(/.test(rest) && !/^\d/.test(w)) c = "fn";
      else if (lang === "rust" && rest.startsWith("!")) c = "fn";
      else if (spec.types && /^[A-Z][A-Za-z0-9]*[a-z][A-Za-z0-9]*$/.test(w)) c = "type";
      push(w, c);
      i = j;
      continue;
    }
    // Everything else, up to the next interesting character.
    let j = i + 1;
    while (j < n && !/[\w$"'`#/<\-0-9>;]/.test(text[j]!)) j++;
    push(text.slice(i, j));
    i = j;
  }
  // Tokens → lines.
  const lines: Line[] = [[]];
  for (const t of toks) {
    const parts = t.s.split("\n");
    parts.forEach((p, k) => {
      if (k > 0) lines.push([]);
      if (p) lines[lines.length - 1]!.push(t.c ? { c: t.c, s: p } : { s: p });
    });
  }
  return lines;
}

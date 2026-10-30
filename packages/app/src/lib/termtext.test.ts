import assert from "node:assert/strict";
import { test } from "node:test";
import { bufferLines, capLines, terminalText, type TextBuffer } from "./termtext.ts";

/** Rows as xterm stores them: fixed width, `+` prefix = soft-wrapped continuation of the row above. */
function fake(rows: string[], cols = 10, baseY = 0): TextBuffer {
  const lines = rows.map((r) => {
    const isWrapped = r.startsWith("+");
    const cells = (isWrapped ? r.slice(1) : r).padEnd(cols, " ");
    return { isWrapped, translateToString: (trim?: boolean) => (trim ? cells.trimEnd() : cells) };
  });
  return { length: lines.length, baseY, getLine: (y) => lines[y] };
}

test("joins soft-wrapped rows and keeps spaces at the wrap", () => {
  const buf = fake(["$ echo abc", "+def ghi   ", "+jk", "next", "", ""]);
  assert.deepEqual(bufferLines(buf), ["$ echo abcdef ghi   jk", "next"]);
});

test("a wrap ending exactly at the edge with a space keeps it", () => {
  const buf = fake(["hello wor ", "+ld"]);
  assert.deepEqual(bufferLines(buf), ["hello wor ld"]);
});

test("starting on a continuation row goes back to the line start", () => {
  const buf = fake(["aaaaaaaaaa", "+bbb", "c"]);
  assert.deepEqual(bufferLines(buf, 1), ["aaaaaaaaaabbb", "c"]);
});

test("blank lines inside the output stay, trailing ones go", () => {
  const buf = fake(["a", "", "b  ", "", ""]);
  assert.deepEqual(bufferLines(buf), ["a", "", "b"]);
});

test("screen is the rows from baseY", () => {
  const t = terminalText(fake(["old", "older", "now", "prompt $"], 10, 2));
  assert.equal(t.all, "old\nolder\nnow\nprompt $");
  assert.equal(t.screen, "now\nprompt $");
  assert.equal(t.truncated, false);
});

test("cap keeps the newest whole lines", () => {
  const r = capLines(["1111", "2222", "3333"], 10);
  assert.deepEqual(r, { text: "2222\n3333", lines: 2, truncated: true });
  assert.deepEqual(capLines(["x".repeat(20)], 5), { text: "xxxxx", lines: 1, truncated: true });
  assert.deepEqual(capLines([], 5), { text: "", lines: 0, truncated: false });
});

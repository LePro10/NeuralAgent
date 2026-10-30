import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { LAUNCH_MARKER, LAUNCH_MARKUP, MARK_PANES, SCHEME_ACCENT, THEME_SCRIPT, launchFrame } from "./launchFrame.ts";

test("the inline theme script uses each scheme's own accent (lib/theme.ts SCHEMES)", () => {
  const theme = readFileSync(new URL("./theme.ts", import.meta.url), "utf8");
  const block = theme.slice(theme.indexOf("export const SCHEMES"), theme.indexOf("];", theme.indexOf("export const SCHEMES")));
  const pairs = Object.fromEntries([...block.matchAll(/id: "(\w+)"[^}]*accent: "(\w+)"/g)].map((m) => [m[1], m[2]]));
  assert.ok(Object.keys(pairs).length >= 4);
  // "ice" is the script's fallback, every other scheme accent must be listed.
  for (const [id, accent] of Object.entries(pairs)) assert.equal(SCHEME_ACCENT[id] ?? "ice", accent, id);
  assert.ok(THEME_SCRIPT.includes(JSON.stringify(SCHEME_ACCENT)));
});

test("the first frame has no inline styles (Tauri's CSP nonce would block all others)", () => {
  assert.doesNotMatch(LAUNCH_MARKUP, /style=|<style/);
  assert.equal(LAUNCH_MARKUP.match(/<i[ >]/g)?.length, MARK_PANES.length);
});

test("launch.css places the panes like MARK_PANES", () => {
  const css = readFileSync(new URL("../styles/launch.css", import.meta.url), "utf8");
  MARK_PANES.forEach((p, i) => {
    const m = css.match(new RegExp(`i:nth-child\\(${i + 1}\\) \\{([^}]*)\\}`));
    assert.ok(m, `pane ${i + 1}`);
    const n = [...m[1].matchAll(/calc\((\d+) \* var\(--u\)\)/g)].map((x) => Number(x[1]));
    assert.deepEqual(n, [p.x - 8, p.y - 8, p.w, p.h], `pane ${i + 1}`);
  });
});

test("the plugin replaces the marker and leaves other pages alone", () => {
  const { transformIndexHtml } = launchFrame();
  const out = transformIndexHtml(`<body>${LAUNCH_MARKER}<div id="root"></div></body>`);
  assert.ok(out.includes(`<script>${THEME_SCRIPT}</script>${LAUNCH_MARKUP}<div id="root">`));
  assert.equal(transformIndexHtml("<body></body>"), "<body></body>");
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { build } from "./index.mjs";

const manifest = JSON.parse(fs.readFileSync(new URL("./connector.json", import.meta.url), "utf8"));
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const mkenv = () => ({ NA_SECRET_TOKEN: "ghp_x", NA_CONFIG: JSON.stringify({ repos: ["me/app"] }), NA_STATE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "na-gh-")) });
const call = (c, name, args = {}) => c.server.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
const out = (r) => JSON.parse(r.result.content[0].text);

test("manifest matches tools; poll is declared", async () => {
  const c = build({ env: mkenv(), fetchImpl: async () => json({}) });
  const r = await c.server.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.deepEqual(r.result.tools.map((t) => t.name).sort(), Object.keys(manifest.tools).sort());
  assert.ok(manifest.tools[manifest.poll.tool]);
});

test("list_repos, list_issues (no PRs), close_issue", async () => {
  const calls = [];
  const c = build({
    env: mkenv(),
    fetchImpl: async (u, i) => {
      calls.push([u, i.method, i.body]);
      if (u.includes("/user/repos")) return json([{ full_name: "me/app", private: true }]);
      if (u.includes("/issues?")) return json([{ number: 1, title: "A", state: "open", user: { login: "x" }, labels: [{ name: "bug" }] }, { number: 2, pull_request: {} }]);
      return json({});
    },
  });
  assert.deepEqual(out(await call(c, "list_repos")), [{ value: "me/app", label: "me/app (private)" }]);
  assert.deepEqual(out(await call(c, "list_issues", { repo: "me/app" })).map((i) => i.number), [1]);
  await call(c, "close_issue", { repo: "me/app", number: 1 });
  assert.equal(calls.at(-1)[1], "PATCH");
  assert.match(calls.at(-1)[2], /closed/);
});

test("repo must be owner/name and 401 is explained", async () => {
  const c = build({ env: mkenv(), fetchImpl: async () => json({ message: "Bad credentials" }, 401) });
  assert.match((await call(c, "list_issues", { repo: "../x" })).result.content[0].text, /owner\/name/);
  assert.match((await call(c, "whoami")).result.content[0].text, /wrong or has expired/);
});

test("poll: first call sets the cursor, the next returns new things once", async () => {
  const env = mkenv();
  const times = ["2026-01-01T10:00:00.000Z", "2026-01-01T10:05:00.000Z"];
  let t = 0;
  const fetchImpl = async (u) => {
    if (u.endsWith("/user")) return json({ login: "me" });
    if (u.includes("/issues/comments")) return json([{ id: 7, created_at: "2026-01-01T10:02:00Z", user: { login: "ann" }, body: "me too", issue_url: "https://api.github.com/repos/me/app/issues/3", html_url: "u" }, { id: 8, created_at: "2026-01-01T10:03:00Z", user: { login: "me" }, body: "mine", issue_url: "x/3" }]);
    if (u.includes("/issues?")) return json([{ number: 3, title: "Crash", body: "boom", created_at: "2026-01-01T10:01:00Z", user: { login: "ann" }, html_url: "u", labels: [] }, { number: 4, title: "old", created_at: "2025-12-31T00:00:00Z", user: { login: "bob" }, labels: [] }]);
    if (u.includes("/actions/runs")) return json({ workflow_runs: [{ id: 9, name: "CI", head_branch: "main", head_sha: "abcdef123", created_at: "2026-01-01T10:04:00Z", html_url: "u" }] });
    throw new Error("unexpected " + u);
  };
  const c = build({ env, fetchImpl, now: () => new Date(times[t++]) });
  assert.deepEqual(out(await call(c, "poll")).events, []);
  const ev = out(await call(c, "poll")).events;
  assert.deepEqual(ev.map((e) => e.type), ["issue", "comment", "failed_run"]);
  assert.equal(ev[0].id, "github:me/app#3");
  assert.equal(ev[1].meta.number, 3);
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { build } from "./index.mjs";

const manifest = JSON.parse(fs.readFileSync(new URL("./connector.json", import.meta.url), "utf8"));
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const mkenv = () => ({ NA_SECRET_API_KEY: "nak_x", NA_CONFIG: JSON.stringify({ base_url: "https://r.example/" }), NA_STATE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "na-adm-")) });
const call = (c, name, args = {}) => c.server.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
const out = (r) => JSON.parse(r.result.content[0].text);

test("manifest matches tools", async () => {
  const r = await build({ env: mkenv(), fetchImpl: async () => json({}) }).server.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.deepEqual(r.result.tools.map((t) => t.name).sort(), Object.keys(manifest.tools).sort());
  assert.ok(manifest.tools[manifest.check]);
});

test("the lib copy equals the shared lib", () => {
  const a = fs.readFileSync(new URL("./lib/connector.mjs", import.meta.url), "utf8");
  const b = fs.readFileSync(new URL("../../_lib/connector.mjs", import.meta.url), "utf8");
  assert.equal(a, b);
});

test("reply, status and errors", async () => {
  const seen = [];
  const c = build({ env: mkenv(), fetchImpl: async (u, i) => { seen.push([u, i.method, i.headers.Authorization, i.body]); return json({ answers: [{}], report: {} }); } });
  await call(c, "reply_report", { id: "R-ABC234", text: "Fixed", status: "solved" });
  assert.deepEqual(seen[0].slice(0, 3), ["https://r.example/api/admin/reports/R-ABC234/reply", "POST", "Bearer nak_x"]);
  await call(c, "set_status", { id: "R-ABC234", status: "seen" });
  assert.equal(seen[1][0], "https://r.example/api/admin/reports/R-ABC234");
  assert.equal((await call(c, "get_report", { id: "../x" })).result.isError, true);
  const bad = build({ env: mkenv(), fetchImpl: async () => json({ error: "this key lacks the scope reports:reply" }, 403) });
  assert.match((await call(bad, "reply_report", { id: "R-ABC234", text: "x" })).result.content[0].text, /not allowed.*lacks the scope/);
});

test("poll reports only new reports", async () => {
  let list = [{ id: "R-AAAAAA", summary: "one", status: "open" }];
  const c = build({ env: mkenv(), fetchImpl: async () => json({ reports: list }) });
  assert.deepEqual(out(await call(c, "poll")).events, []);
  list = [{ id: "R-BBBBBB", summary: "two", details: "d", status: "open", user_id: "u" }, ...list];
  const ev = out(await call(c, "poll")).events;
  assert.equal(ev.length, 1);
  assert.equal(ev[0].id, "neuralagent-report:R-BBBBBB");
  assert.equal(ev[0].meta.signed_in, true);
});

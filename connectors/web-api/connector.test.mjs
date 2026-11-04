import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { build, resolveUnder } from "./index.mjs";

const manifest = JSON.parse(fs.readFileSync(new URL("./connector.json", import.meta.url), "utf8"));
const env = { NA_CONFIG: JSON.stringify({ base_url: "https://api.x.com/v1", auth_header: "X-Api-Key", test_path: "/health" }), NA_SECRET_AUTH_VALUE: "sek" };
const call = (c, name, args = {}) => c.server.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });

test("manifest matches tools", async () => {
  const r = await build({ env }).server.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.deepEqual(r.result.tools.map((t) => t.name).sort(), Object.keys(manifest.tools).sort());
});

test("paths stay under the base URL", () => {
  assert.equal(resolveUnder("https://api.x.com/v1", "/items?a=1").href, "https://api.x.com/v1/items?a=1");
  assert.equal(resolveUnder("https://api.x.com/v1/", "items").href, "https://api.x.com/v1/items");
  for (const bad of ["https://evil.com/x", "//evil.com/x", "/../admin", "/%2e%2e/admin", "/a/../../b"]) {
    assert.throws(() => resolveUnder("https://api.x.com/v1", bad), /base address|path like/, bad);
  }
});

test("get sends the auth header, send posts JSON, errors in words", async () => {
  const seen = [];
  const c = build({ env, fetchImpl: async (u, i) => { seen.push([String(u), i.method, i.headers["X-Api-Key"], i.body]); return new Response('{"ok":true}', { status: 200 }); } });
  const g = await call(c, "get", { path: "/items", query: { q: "a b" } });
  assert.deepEqual(JSON.parse(g.result.content[0].text).data, { ok: true });
  assert.deepEqual(seen[0].slice(0, 3), ["https://api.x.com/v1/items?q=a+b", "GET", "sek"]);
  await call(c, "send", { method: "POST", path: "/items", body: { n: 1 } });
  assert.equal(seen[1][1], "POST");
  assert.equal(seen[1][3], '{"n":1}');
  const bad = await call(c, "send", { method: "GET", path: "/x" });
  assert.equal(bad.result.isError, true);
  const out = await call(c, "get", { path: "https://evil.com" });
  assert.equal(out.result.isError, true);
  const e = build({ env, fetchImpl: async () => new Response("nope", { status: 401 }) });
  assert.match((await call(e, "check")).result.content[0].text, /key is missing/);
});

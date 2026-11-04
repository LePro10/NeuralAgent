// Run with: node --test   (no network: fetch is mocked)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { build } from "./index.mjs";

const manifest = JSON.parse(fs.readFileSync(new URL("./connector.json", import.meta.url), "utf8"));
const env = { NA_CONFIG: JSON.stringify({ base_url: "https://api.example.com" }), NA_SECRET_API_TOKEN: "tok" };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const rpc = (c, method, params) => c.server.handle({ jsonrpc: "2.0", id: 1, method, params });

test("the manifest is complete", () => {
  assert.ok(manifest.name && manifest.description);
  assert.ok(manifest.guide.length > 0, "a beginner guide");
  assert.ok(manifest.tools[manifest.check] === "read", "check names a read tool");
  for (const f of manifest.setup) assert.ok(["text", "secret", "url", "number", "bool", "select", "pick", "list"].includes(f.type), f.key);
});

test("every tool has a class and every class has a tool", async () => {
  const c = build({ env, fetchImpl: async () => json({}) });
  const names = (await rpc(c, "tools/list")).result.tools.map((t) => t.name).sort();
  assert.deepEqual(names, Object.keys(manifest.tools).sort());
  for (const cls of Object.values(manifest.tools)) assert.ok(["read", "write", "external"].includes(cls));
});

test("the check tool works and sends the secret from the environment", async () => {
  let auth;
  const c = build({ env, fetchImpl: async (u, i) => { auth = i.headers.Authorization; return json({ name: "Ann" }); } });
  const r = await rpc(c, "tools/call", { name: manifest.check, arguments: {} });
  assert.match(r.result.content[0].text, /Signed in as Ann/);
  assert.equal(auth, "Bearer tok");
});

test("errors come back in plain words", async () => {
  const c = build({ env, fetchImpl: async () => json({}, 401) });
  const r = await rpc(c, "tools/call", { name: "whoami", arguments: {} });
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /wrong or has expired/);
});

test("no secret is written into the source", () => {
  const src = fs.readFileSync(new URL("./index.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src, /(sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{16,}|xox[bp]-|Bearer [A-Za-z0-9]{20,})/);
});

test("lib/connector.mjs is the shared helper", { skip: !fs.existsSync(new URL("../_lib/connector.mjs", import.meta.url)) }, () => {
  // Only runs inside the NeuralAgent repo, where connectors/_lib exists. Keep the copy identical.
  const a = fs.readFileSync(new URL("./lib/connector.mjs", import.meta.url), "utf8");
  const b = fs.readFileSync(new URL("../_lib/connector.mjs", import.meta.url), "utf8");
  assert.equal(a, b);
});

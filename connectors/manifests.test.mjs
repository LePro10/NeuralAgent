// Every connector.json must fit the daemon's ConnectorManifest (crates/na-protocol/src/autopilot.rs).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("./", import.meta.url);
const dirs = ["discord", "github", "feed", "web-api", "examples/neuralagent-admin", "_template"];
const KINDS = ["service", "api", "browser", "feed", "mcp"];
const FIELDS = ["text", "secret", "url", "number", "bool", "select", "pick", "list"];
const CLASSES = ["read", "write", "external"];

for (const d of dirs) {
  test(`${d}/connector.json is a valid manifest`, () => {
    const m = JSON.parse(fs.readFileSync(new URL(`${d}/connector.json`, root), "utf8"));
    assert.ok(m.name && m.description && m.version);
    assert.ok(KINDS.includes(m.kind));
    assert.ok(m.guide?.length >= 2, "beginner guide");
    const keys = new Set();
    for (const f of m.setup) {
      assert.ok(f.key && f.label && FIELDS.includes(f.type), f.key);
      assert.ok(!keys.has(f.key), "duplicate key " + f.key);
      keys.add(f.key);
      if (f.type === "pick" && !f.from) assert.ok(f.options?.length, "pick needs from or options");
      if (f.from) assert.equal(m.tools[f.from], "read", "pick source must be a read tool");
    }
    for (const [t, c] of Object.entries(m.tools)) assert.ok(CLASSES.includes(c), t);
    assert.equal(m.tools[m.check], "read");
    if (m.poll) {
      assert.ok(m.tools[m.poll.tool], "poll tool exists");
      assert.ok(m.poll.minutes >= 1);
    }
    assert.ok(fs.existsSync(new URL(`${d}/index.mjs`, root)));
  });
}

test("the shared helper repairs wrong tool param types", async () => {
  const { createServer } = await import("./_lib/connector.mjs");
  const s = createServer({
    name: "t",
    tools: {
      pin: { schema: { pinned: { type: "bool" }, n: { type: "int" }, tags: { type: "list", items: { type: "str" } } }, required: ["pinned", "ghost"], run: () => ({}) },
    },
  });
  const r = await s.handle({ id: 1, method: "tools/list" });
  const sch = r.result.tools[0].inputSchema;
  assert.equal(sch.properties.pinned.type, "boolean");
  assert.equal(sch.properties.n.type, "integer");
  assert.equal(sch.properties.tags.type, "array");
  assert.equal(sch.properties.tags.items.type, "string");
  assert.deepEqual(sch.required, ["pinned"]);
});

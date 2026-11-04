import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { build, parseFeed } from "./index.mjs";

const manifest = JSON.parse(fs.readFileSync(new URL("./connector.json", import.meta.url), "utf8"));
const RSS = `<?xml version="1.0"?><rss><channel><title>Blog</title><item><title>Hello &amp; welcome</title><link>https://b/1</link><guid>g1</guid><description><![CDATA[<p>First <b>post</b></p>]]></description><dc:creator>Ann</dc:creator></item><item><title>Two</title><link>https://b/2</link><guid>g2</guid></item></channel></rss>`;
const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Rel</title><entry><id>tag:1</id><title>v1.0</title><link rel="alternate" href="https://g/v1"/><updated>2026-01-01T00:00:00Z</updated><content>Notes</content><author><name>Bob</name></author></entry></feed>`;
const JF = JSON.stringify({ version: "https://jsonfeed.org/version/1.1", title: "J", items: [{ id: "a", url: "https://j/a", title: "A", content_text: "txt" }] });
const mk = (urls, bodies) => {
  const env = { NA_CONFIG: JSON.stringify({ urls }), NA_STATE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "na-feed-")) };
  return build({ env, fetchImpl: async (u) => new Response(bodies[u]?.() ?? "", { status: bodies[u] ? 200 : 404 }) });
};
const call = (c, name, args = {}) => c.server.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
const res = (r) => JSON.parse(r.result.content[0].text);

test("manifest matches tools", async () => {
  const r = await mk([], {}).server.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.deepEqual(r.result.tools.map((t) => t.name).sort(), Object.keys(manifest.tools).sort());
});

test("parses RSS, Atom, JSON Feed", () => {
  const r = parseFeed(RSS);
  assert.equal(r.title, "Blog");
  assert.equal(r.entries[0].title, "Hello & welcome");
  assert.equal(r.entries[0].text, "First post");
  assert.equal(r.entries[0].url, "https://b/1");
  const a = parseFeed(ATOM);
  assert.deepEqual([a.entries[0].id, a.entries[0].url, a.entries[0].author], ["tag:1", "https://g/v1", "Bob"]);
  assert.equal(parseFeed(JF).entries[0].url, "https://j/a");
  assert.throws(() => parseFeed("<html>nope</html>"), /readable feed/);
});

test("poll reports only new entries after the first call", async () => {
  let body = RSS;
  const c = mk(["https://b/feed"], { "https://b/feed": () => body });
  assert.deepEqual(res(await call(c, "poll")).events, []);
  body = RSS.replace("</channel>", "<item><title>Three</title><link>https://b/3</link><guid>g3</guid></item></channel>");
  const ev = res(await call(c, "poll")).events;
  assert.deepEqual(ev.map((e) => e.title), ["Three"]);
  assert.equal(ev[0].id, "feed:https://b/feed|g3");
  assert.deepEqual(res(await call(c, "poll")).events, []);
});

test("bad address and 404 are explained", async () => {
  const c = mk(["ftp://x"], {});
  assert.match((await call(c, "fetch")).result.content[0].text, /not a web address/);
  const d = mk(["https://gone/feed"], {});
  assert.match((await call(d, "fetch")).result.content[0].text, /could not find/);
});

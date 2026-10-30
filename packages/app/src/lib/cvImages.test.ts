import assert from "node:assert/strict";
import { test } from "node:test";
import { b64ToBlob, edgeFor, fitBox, ImageCache, type Loaded, saveName, sourceOf, withoutSources } from "./cvImages.ts";

const loaded = (url: string): Loaded => ({ url, blob: new Blob([]), type: "image/png", w: 1, h: 1 });

test("one load per key, a failure is retried, old entries are revoked", async () => {
  const revoked: string[] = [];
  const cache = new ImageCache(2, (u) => revoked.push(u));
  let calls = 0;
  const a1 = cache.get("a", async () => (calls++, loaded("blob:a")));
  const a2 = cache.get("a", async () => (calls++, loaded("blob:a2")));
  assert.equal(await a1, await a2);
  assert.equal(calls, 1);

  await assert.rejects(cache.get("b", () => Promise.reject(new Error("offline"))));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal((await cache.get("b", async () => loaded("blob:b"))).url, "blob:b");

  await cache.get("c", async () => loaded("blob:c"));
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(revoked, ["blob:a"]);
  assert.equal(cache.size, 2);
});

test("images keep their shape and are never drawn bigger than they are", () => {
  assert.deepEqual(fitBox({ w: 1000, h: 500 }, 600, 240), { w: 480, h: 240 });
  assert.deepEqual(fitBox({ w: 100, h: 50 }, 600, 240), { w: 100, h: 50 });
  assert.deepEqual(fitBox({}, 400, 240), { w: 320, h: 240 });
});

test("remote clients ask for a smaller picture", () => {
  assert.equal(edgeFor("desktop"), undefined);
  assert.equal(edgeFor("android"), 1600);
});

test("names and MCP image sources", () => {
  assert.equal(saveName("/tmp/na-sw1.png", "image/jpeg"), "na-sw1.jpg");
  assert.equal(saveName(undefined, "image/png"), "image.png");
  const text = "[Image: source: /Users/x/look.png]\nTiles left to right";
  assert.equal(sourceOf(text), "/Users/x/look.png");
  assert.equal(withoutSources(text), "Tiles left to right");
  assert.equal(sourceOf("plain"), null);
});

test("base64 to bytes", async () => {
  const b = b64ToBlob("AAEC", "image/png");
  assert.equal(b.type, "image/png");
  assert.deepEqual([...new Uint8Array(await b.arrayBuffer())], [0, 1, 2]);
});

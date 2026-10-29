import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  b64, clientStart, deriveKeys, exportPublic, fingerprint, generateStaticKey, hostAccept,
  importPrivateRaw, toHex, unb64,
} from "./index.ts";

const v = JSON.parse(
  readFileSync(new URL("../../../crates/na-crypto/tests/vectors.json", import.meta.url), "utf8"),
);
const fromHex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (x) => parseInt(x, 16));

async function handshake() {
  const c = await generateStaticKey();
  const h = await generateStaticKey();
  const hello = await clientStart(c, await exportPublic(h));
  const { f, session: host } = await hostAccept(h, hello.e, hello.c);
  return { client: await hello.finish(f), host };
}

test("vectors reproduce Rust output", async () => {
  const [c, h, e, f] = await Promise.all(
    ["c_priv", "h_priv", "e_priv", "f_priv"].map((k) => importPrivateRaw(fromHex(v[k]))),
  );
  assert.equal(toHex(await exportPublic(c)), v.c_pub);
  assert.equal(toHex(await exportPublic(h)), v.h_pub);
  assert.equal(toHex(await exportPublic(e)), v.e_pub);
  assert.equal(toHex(await exportPublic(f)), v.f_pub);
  assert.equal(await fingerprint(fromHex(v.h_pub)), v.fingerprint_h);

  const hello = await clientStart(c, fromHex(v.h_pub), e);
  assert.equal(toHex(hello.e), v.e_pub);
  const host = await hostAccept(h, hello.e, hello.c, f);
  assert.equal(toHex(host.f), v.f_pub);
  const client = await hello.finish(host.f);
  assert.equal(toHex(client.th), v.th);
  assert.equal(toHex(host.session.th), v.th);

  // Raw key schedule.
  const dhBits = async (priv: CryptoKeyPair, pub: CryptoKeyPair) =>
    new Uint8Array(
      await crypto.subtle.deriveBits({ name: "X25519", public: pub.publicKey }, priv.privateKey, 256),
    );
  const keys = await deriveKeys(hello.e, hello.c, fromHex(v.h_pub), host.f, [
    await dhBits(e, h), await dhBits(c, h), await dhBits(e, f), await dhBits(c, f),
  ]);
  assert.equal(toHex(keys.th), v.th);
  assert.equal(toHex(keys.kC2h), v.k_c2h);
  assert.equal(toHex(keys.kH2c), v.k_h2c);

  for (const m of v.c2h) {
    const frame = await client.seal(fromHex(m.plaintext));
    assert.equal(toHex(frame), m.frame);
    assert.equal(toHex(await host.session.open(fromHex(m.frame))), m.plaintext);
  }
  for (const m of v.h2c) {
    assert.equal(toHex(await host.session.seal(fromHex(m.plaintext))), m.frame);
    assert.equal(toHex(await client.open(fromHex(m.frame))), m.plaintext);
  }
});

test("roundtrip both directions", async () => {
  const { client, host } = await handshake();
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(await host.open(await client.seal(new Uint8Array([i, 1]))), new Uint8Array([i, 1]));
    assert.deepEqual(await client.open(await host.seal(new Uint8Array(0))), new Uint8Array(0));
  }
});

test("replay and out-of-order rejected", async () => {
  const { client, host } = await handshake();
  const f0 = await client.seal(new Uint8Array([1]));
  const f1 = await client.seal(new Uint8Array([2]));
  await assert.rejects(host.open(f1));
  await host.open(f0);
  await assert.rejects(host.open(f0));
  await host.open(f1);
});

test("tamper rejected, counter not advanced, concurrent opens in order", async () => {
  const { client, host } = await handshake();
  const f = await client.seal(new Uint8Array([9, 9]));
  const bad = f.slice();
  bad[bad.length - 1] ^= 1;
  await assert.rejects(host.open(bad));
  await assert.rejects(host.open(f.slice(0, 23)));
  const f2 = await client.seal(new Uint8Array([7]));
  const [a, b] = await Promise.all([host.open(f), host.open(f2)]);
  assert.deepEqual(a, new Uint8Array([9, 9]));
  assert.deepEqual(b, new Uint8Array([7]));
});

test("zero DH rejected", async () => {
  const c = await generateStaticKey();
  const h = await generateStaticKey();
  await assert.rejects(hostAccept(h, new Uint8Array(32), await exportPublic(c)));
  const hello = await clientStart(c, await exportPublic(h));
  await assert.rejects(hello.finish(new Uint8Array(32)));
});

test("b64 helpers", () => {
  const d = Uint8Array.from([251, 255, 0, 1]);
  assert.equal(b64(d), "-_8AAQ");
  assert.deepEqual(unb64(b64(d)), d);
});

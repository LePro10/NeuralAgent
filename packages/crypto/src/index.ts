// NeuralAgent E2E encryption v1 (WebCrypto only). Twin of crates/na-crypto.

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const LABEL = enc.encode("NA-E2E-v1");
const INFO = enc.encode("NA-E2E-v1 keys");
const PKCS8_PREFIX = Uint8Array.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20,
]);

type Bytes = Uint8Array<ArrayBuffer>;

export function b64(data: Uint8Array): string {
  let s = "";
  for (const b of data) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function unb64(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) throw new Error("invalid base64url");
  const std = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(std + "=".repeat((4 - (std.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function toHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

async function sha256(data: Uint8Array): Promise<Bytes> {
  return new Uint8Array(await subtle.digest("SHA-256", data as Bytes));
}

/** Lowercase hex of the first 16 bytes of SHA-256(pub). */
export async function fingerprint(pub: Uint8Array): Promise<string> {
  return toHex((await sha256(pub)).subarray(0, 16));
}

export async function generateStaticKey(extractable = false): Promise<CryptoKeyPair> {
  return (await subtle.generateKey({ name: "X25519" }, extractable, ["deriveBits"])) as CryptoKeyPair;
}

export async function exportPublic(k: CryptoKeyPair | CryptoKey): Promise<Uint8Array> {
  const key = "publicKey" in k ? k.publicKey : k;
  return new Uint8Array(await subtle.exportKey("raw", key));
}

export async function importPrivateRaw(raw: Uint8Array): Promise<CryptoKeyPair> {
  if (raw.length !== 32) throw new Error("private key must be 32 bytes");
  const pkcs8 = concat(PKCS8_PREFIX, raw);
  const tmp = await subtle.importKey("pkcs8", pkcs8, { name: "X25519" }, true, ["deriveBits"]);
  const jwk = await subtle.exportKey("jwk", tmp);
  const publicKey = await subtle.importKey("raw", unb64(jwk.x!) as Bytes, { name: "X25519" }, true, []);
  const privateKey = await subtle.importKey("pkcs8", pkcs8, { name: "X25519" }, false, ["deriveBits"]);
  return { publicKey, privateKey };
}

async function dh(priv: CryptoKey, peerPub: Uint8Array): Promise<Bytes> {
  const pub = await subtle.importKey("raw", peerPub as Bytes, { name: "X25519" }, true, []);
  let out: Bytes;
  try {
    out = new Uint8Array(await subtle.deriveBits({ name: "X25519", public: pub }, priv, 256));
  } catch {
    throw new Error("degenerate Diffie-Hellman output");
  }
  if (out.every((b) => b === 0)) throw new Error("degenerate Diffie-Hellman output");
  return out;
}

export interface DerivedKeys {
  th: Uint8Array;
  kC2h: Uint8Array;
  kH2c: Uint8Array;
}

/** Raw key schedule; exposed for test vectors / debugging. */
export async function deriveKeys(
  e: Uint8Array,
  c: Uint8Array,
  h: Uint8Array,
  f: Uint8Array,
  dhs: Uint8Array[],
): Promise<DerivedKeys> {
  const th = await sha256(concat(LABEL, e, c, h, f));
  const base = await subtle.importKey("raw", concat(...dhs), "HKDF", false, ["deriveBits"]);
  const okm = new Uint8Array(
    await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: th, info: INFO }, base, 512),
  );
  return { th, kC2h: okm.slice(0, 32), kH2c: okm.slice(32, 64) };
}

function nonce(counter: bigint): Bytes {
  const n = new Uint8Array(12);
  new DataView(n.buffer).setBigUint64(4, counter);
  return n;
}

export class Session {
  readonly th: Uint8Array;
  #send: CryptoKey;
  #recv: CryptoKey;
  #sendCtr = 0n;
  #recvCtr = 0n;
  #sendQ: Promise<unknown> = Promise.resolve();
  #recvQ: Promise<unknown> = Promise.resolve();

  constructor(th: Uint8Array, send: CryptoKey, recv: CryptoKey) {
    this.th = th;
    this.#send = send;
    this.#recv = recv;
  }

  seal(pt: Uint8Array): Promise<Uint8Array> {
    const run = async () => {
      const ctr = this.#sendCtr++;
      const ct = new Uint8Array(
        await subtle.encrypt(
          { name: "AES-GCM", iv: nonce(ctr), additionalData: this.th as Bytes },
          this.#send,
          pt as Bytes,
        ),
      );
      const header = new Uint8Array(8);
      new DataView(header.buffer).setBigUint64(0, ctr);
      return concat(header, ct);
    };
    const p = this.#sendQ.then(run, run);
    this.#sendQ = p.catch(() => {});
    return p;
  }

  open(frame: Uint8Array): Promise<Uint8Array> {
    const run = async () => {
      if (frame.length < 24) throw new Error("frame too short");
      const ctr = new DataView(frame.buffer, frame.byteOffset, 8).getBigUint64(0);
      if (ctr !== this.#recvCtr) throw new Error("unexpected frame counter");
      let pt: Bytes;
      try {
        pt = new Uint8Array(
          await subtle.decrypt(
            { name: "AES-GCM", iv: nonce(ctr), additionalData: this.th as Bytes },
            this.#recv,
            frame.slice(8) as Bytes,
          ),
        );
      } catch {
        throw new Error("authentication failed");
      }
      this.#recvCtr++;
      return pt;
    };
    const p = this.#recvQ.then(run, run);
    this.#recvQ = p.catch(() => {});
    return p;
  }
}

async function makeSession(k: DerivedKeys, client: boolean): Promise<Session> {
  const imp = (raw: Uint8Array) => subtle.importKey("raw", raw as Bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
  const [c2h, h2c] = await Promise.all([imp(k.kC2h), imp(k.kH2c)]);
  return client ? new Session(k.th, c2h, h2c) : new Session(k.th, h2c, c2h);
}

export interface ClientHello {
  /** Ephemeral public key (msg1). */
  e: Uint8Array;
  /** Static client public key (msg1). */
  c: Uint8Array;
  finish(f: Uint8Array): Promise<Session>;
}

export async function clientStart(
  staticPair: CryptoKeyPair,
  hostPub: Uint8Array,
  ephemeral?: CryptoKeyPair,
): Promise<ClientHello> {
  const eph = ephemeral ?? (await generateStaticKey());
  const e = await exportPublic(eph);
  const c = await exportPublic(staticPair);
  return {
    e,
    c,
    async finish(f: Uint8Array) {
      const dhs = [
        await dh(eph.privateKey, hostPub),
        await dh(staticPair.privateKey, hostPub),
        await dh(eph.privateKey, f),
        await dh(staticPair.privateKey, f),
      ];
      return makeSession(await deriveKeys(e, c, hostPub, f, dhs), true);
    },
  };
}

export async function hostAccept(
  hostPair: CryptoKeyPair,
  e: Uint8Array,
  c: Uint8Array,
  ephemeral?: CryptoKeyPair,
): Promise<{ f: Uint8Array; session: Session }> {
  const eph = ephemeral ?? (await generateStaticKey());
  const f = await exportPublic(eph);
  const h = await exportPublic(hostPair);
  const dhs = [
    await dh(hostPair.privateKey, e),
    await dh(hostPair.privateKey, c),
    await dh(eph.privateKey, e),
    await dh(eph.privateKey, c),
  ];
  return { f, session: await makeSession(await deriveKeys(e, c, h, f, dhs), false) };
}

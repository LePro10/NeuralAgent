// Remote client for phones and browsers: the account at the relay, pairing, the relay
// connection, and an end-to-end sealed transport to a computer that `DaemonClient` uses like
// the local WebSocket. Shared by the web remote (/app) and the Android app.
import { b64, clientStart, exportPublic, fingerprint, generateStaticKey, importPrivateRaw, unb64, type Session } from "@neuralagent/crypto";
import type { Transport } from "@neuralagent/protocol";

// ───────────── storage ─────────────

/** Small string storage (localStorage on the web, Preferences on Android, memory in tests). */
export interface Store {
  get(key: string): Promise<string | null>;
  set(key: string, value: string | null): Promise<void>;
}

/** Keeps this device's X25519 key; on the web a non-extractable key in IndexedDB. */
export interface KeyStore {
  /** A new key in the form this store can keep (default: non-extractable). */
  generate?(): Promise<CryptoKeyPair>;
  load(): Promise<CryptoKeyPair | null>;
  save(key: CryptoKeyPair): Promise<void>;
  clear(): Promise<void>;
}

export function memoryStore(): Store {
  const m = new Map<string, string>();
  return {
    get: async (k) => m.get(k) ?? null,
    set: async (k, v) => void (v === null ? m.delete(k) : m.set(k, v)),
  };
}

export function localStore(prefix = "na-remote:"): Store {
  return {
    get: async (k) => localStorage.getItem(prefix + k),
    set: async (k, v) => (v === null ? localStorage.removeItem(prefix + k) : localStorage.setItem(prefix + k, v)),
  };
}

export function memoryKeyStore(): KeyStore {
  let key: CryptoKeyPair | null = null;
  return { load: async () => key, save: async (k) => void (key = k), clear: async () => void (key = null) };
}

/**
 * The browser's key store. IndexedDB keeps CryptoKey objects as they are, so the private key
 * never becomes bytes. Some browsers can't store them (WebKit in some modes stores nothing):
 * then the private key is kept as bytes in `fallback`, which is no worse than the token next to it.
 */
export function webKeyStore(fallback: Store, name = "neuralagent-remote"): KeyStore {
  const db = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(name, 1);
      r.onupgradeneeded = () => r.result.createObjectStore("keys");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  const tx = async <T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest): Promise<T> => {
    const d = await db();
    return new Promise<T>((resolve, reject) => {
      const r = f(d.transaction("keys", mode).objectStore("keys"));
      r.onsuccess = () => resolve(r.result as T);
      r.onerror = () => reject(r.error);
    });
  };
  const idbGet = () => tx<CryptoKeyPair | undefined>("readonly", (s) => s.get("device")).catch(() => undefined);
  let idbWorks: Promise<boolean> | null = null;
  const probe = () =>
    (idbWorks ??= (async () => {
      try {
        if ((await idbGet())?.privateKey) return true;
        const k = await generateStaticKey();
        await tx("readwrite", (s) => s.put(k, "probe"));
        const back = await tx<CryptoKeyPair | undefined>("readonly", (s) => s.get("probe"));
        await tx("readwrite", (s) => s.delete("probe"));
        return !!back?.privateKey;
      } catch {
        return false;
      }
    })());
  return {
    generate: async () => generateStaticKey(!(await probe())),
    load: async () => {
      const k = await idbGet();
      if (k?.privateKey) return k;
      const d = await fallback.get("key");
      return d ? importPrivateRaw(unb64(d)) : null;
    },
    save: async (k) => {
      if (await probe()) return void (await tx("readwrite", (s) => s.put(k, "device")));
      const jwk = await crypto.subtle.exportKey("jwk", k.privateKey);
      await fallback.set("key", jwk.d!);
    },
    clear: async () => {
      await tx("readwrite", (s) => s.delete("device")).catch(() => {});
      await fallback.set("key", null);
    },
  };
}

// ───────────── account ─────────────

export type AccountStatus = "pending" | "approved" | "denied" | "blocked";

export interface RelayUser {
  id: string;
  email: string;
  name: string;
  avatar?: string | null;
  status: AccountStatus;
  is_admin: boolean;
  remote: boolean;
}

export interface RelayDevice {
  id: string;
  name: string;
  platform: string;
  kind: "host" | "client";
  pubkey?: string | null;
  online: boolean;
  last_seen: number;
  created_at: number;
}

interface Saved {
  device_id: string;
  refresh: string;
  user: RelayUser;
  /** Computers whose key this device trusts (id → base64url key). */
  hosts: Record<string, string>;
}

interface Tokens {
  access: string;
  refresh: string;
  expires_in: number;
  device_id: string;
  user: RelayUser;
}

export class RemoteError extends Error {
  readonly status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}

export interface AccountOptions {
  /** Relay origin, e.g. `https://agent.neuralhub.dev`. */
  relay: string;
  store: Store;
  keys: KeyStore;
  /** How this device shows up in the account's device list. */
  device: { name: string; platform: "web" | "android" | "ios" };
}

const randomB64 = (n: number) => b64(crypto.getRandomValues(new Uint8Array(n)));
const s256 = async (v: string) => b64(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v))));

/** This device's account at the relay. Tokens rotate; refreshes never overlap. */
export class RemoteAccount {
  readonly relay: string;
  private saved: Saved | null = null;
  private accessToken: { token: string; until: number } | null = null;
  private refreshing: Promise<string> | null = null;
  private key: CryptoKeyPair | null = null;
  private listeners = new Set<() => void>();

  private o: AccountOptions;

  private constructor(o: AccountOptions) {
    this.o = o;
    this.relay = o.relay.replace(/\/$/, "");
  }

  static async open(o: AccountOptions): Promise<RemoteAccount> {
    const a = new RemoteAccount(o);
    const s = await o.store.get("account");
    if (s) a.saved = JSON.parse(s) as Saved;
    return a;
  }

  get signedIn() {
    return !!this.saved;
  }
  get user() {
    return this.saved?.user ?? null;
  }
  get deviceId() {
    return this.saved?.device_id ?? null;
  }
  trustedKey(host: string) {
    return this.saved?.hosts[host] ?? null;
  }

  onChange(l: () => void) {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  }

  private async persist(next: Saved | null) {
    this.saved = next;
    if (!next) this.accessToken = null;
    await this.o.store.set("account", next ? JSON.stringify(next) : null);
    for (const l of this.listeners) l();
  }

  /** The key the computers check in every handshake; created on first use. */
  async deviceKey(): Promise<CryptoKeyPair> {
    if (this.key) return this.key;
    let k = await this.o.keys.load();
    if (!k) {
      k = (await this.o.keys.generate?.()) ?? (await generateStaticKey());
      await this.o.keys.save(k);
    }
    return (this.key = k);
  }

  private async newDevice() {
    return { ...this.o.device, kind: "client", pubkey: b64(await exportPublic(await this.deviceKey())) };
  }

  private async http(method: string, path: string, body?: unknown, bearer?: string): Promise<any> {
    const res = await fetch(this.relay + path, {
      method,
      headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).catch(() => {
      throw new RemoteError("The relay is not reachable. Check your connection.");
    });
    const v = await res.json().catch(() => null);
    if (!res.ok) throw new RemoteError(v?.error ?? `The relay answered ${res.status}`, res.status);
    return v;
  }

  private async took(t: Tokens, hosts: Record<string, string> = this.saved?.hosts ?? {}) {
    this.accessToken = { token: t.access, until: Date.now() + (t.expires_in - 60) * 1000 };
    await this.persist({ device_id: t.device_id, refresh: t.refresh, user: t.user, hosts });
  }

  /** Step 1 of signing in: where to send the browser. `redirect` must be on the relay's list. */
  async signInUrl(provider: string, redirect: string, extra: Record<string, string> = {}): Promise<string> {
    const verifier = randomB64(32);
    const state = randomB64(18);
    await this.o.store.set("flow", JSON.stringify({ verifier, state, redirect }));
    const q = new URLSearchParams({ redirect_uri: redirect, state, code_challenge: await s256(verifier), code_challenge_method: "S256", ...extra });
    return `${this.relay}/auth/${provider}/start?${q}`;
  }

  /** Step 2: the browser came back with `?code&state` (or `?error`). */
  async finishSignIn(params: URLSearchParams, message?: string): Promise<RelayUser> {
    const flow = JSON.parse((await this.o.store.get("flow")) ?? "null") as { verifier: string; state: string; redirect: string } | null;
    await this.o.store.set("flow", null);
    if (params.get("error")) throw new RemoteError(`Sign-in failed: ${params.get("error")}`);
    if (!flow || params.get("state") !== flow.state) throw new RemoteError("This sign-in link expired. Please try again.");
    const t: Tokens = await this.http("POST", "/api/auth/exchange", {
      code: params.get("code"),
      verifier: flow.verifier,
      redirect_uri: flow.redirect,
      message,
      device: await this.newDevice(),
    });
    await this.took(t);
    return t.user;
  }

  /**
   * Adds this device with a code from a computer's QR (`#c=…&h=…&f=…`). The computer's key
   * must match the fingerprint in the QR, so a relay that swapped keys is caught here.
   */
  async pair(code: string, hostId: string, fp: string): Promise<{ id: string; name: string }> {
    const bearer = this.saved ? await this.access().catch(() => undefined) : undefined;
    const r = await this.http("POST", "/api/pair/redeem", { code, device: await this.newDevice() }, bearer);
    const host = r.host as { id: string; name: string; pubkey: string };
    if (host.id !== hostId || (await fingerprint(unb64(host.pubkey))) !== fp) {
      throw new RemoteError("The computer's key does not match the code. Do not use this connection.");
    }
    await this.took(r.tokens as Tokens, { ...(this.saved?.hosts ?? {}), [host.id]: host.pubkey });
    return { id: host.id, name: host.name };
  }

  /** A valid access token; refreshes (once at a time) when needed. */
  async access(): Promise<string> {
    if (this.accessToken && this.accessToken.until > Date.now()) return this.accessToken.token;
    if (!this.refreshing) {
      this.refreshing = (async () => {
        const s = this.saved;
        if (!s) throw new RemoteError("Not signed in", 401);
        try {
          const t: Tokens = await this.http("POST", "/api/auth/refresh", { refresh: s.refresh });
          await this.took(t);
          return t.access;
        } catch (e) {
          if (e instanceof RemoteError && e.status === 401) await this.persist(null);
          throw e;
        }
      })().finally(() => (this.refreshing = null));
    }
    return this.refreshing;
  }

  /** Forget the access token (the relay restarted or said "sign in again"). */
  dropAccess() {
    this.accessToken = null;
  }

  async setUser(user: RelayUser) {
    if (this.saved) await this.persist({ ...this.saved, user });
  }

  /** Trust a computer's key the first time it is seen (sign-in without QR). */
  async trust(host: string, key: string) {
    if (this.saved && !this.saved.hosts[host]) await this.persist({ ...this.saved, hosts: { ...this.saved.hosts, [host]: key } });
  }

  async api(method: string, path: string, body?: unknown): Promise<any> {
    try {
      return await this.http(method, path, body, await this.access());
    } catch (e) {
      if (!(e instanceof RemoteError) || e.status !== 401 || !this.saved) throw e;
      this.dropAccess();
      return this.http(method, path, body, await this.access());
    }
  }

  async signOut() {
    await this.api("POST", "/api/auth/logout").catch(() => {});
    await this.forget();
  }

  /** Local sign-out (the relay already dropped this device). */
  async forget() {
    await this.persist(null);
  }
}

// ───────────── relay connection ─────────────

export type LinkStatus = "signed_out" | "connecting" | "online" | "offline" | "waiting" | "blocked";

interface Envelope {
  k: "hs1" | "hs2" | "d" | "bye";
  sid: string;
  [k: string]: unknown;
}

interface Pending {
  host: string;
  onEnv: (e: Envelope) => void;
  onGone: (why: string) => void;
}

/**
 * The one WebSocket to the relay. Keeps itself connected while signed in, tracks the account's
 * devices, and carries sealed sessions to computers (`transport`).
 */
export class RelayLink {
  status: LinkStatus = "connecting";
  devices: RelayDevice[] = [];
  error: string | null = null;
  private ws: WebSocket | null = null;
  private sessions = new Map<string, Pending>();
  private listeners = new Set<() => void>();
  private backoff = 1000;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private opening = false;
  private ready: Promise<void> = Promise.resolve();
  private markReady: () => void = () => {};

  readonly account: RemoteAccount;

  constructor(account: RemoteAccount) {
    this.account = account;
    account.onChange(() => {
      if (!account.signedIn && this.ws) this.ws.close();
    });
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  };
  private changed() {
    for (const l of this.listeners) l();
  }
  private set(status: LinkStatus, error: string | null = null) {
    this.status = status;
    this.error = error;
    this.changed();
  }

  get hosts() {
    return this.devices.filter((d) => d.kind === "host");
  }

  /** Connects if not connected yet; safe to call again (e.g. right after signing in). */
  start() {
    this.stopped = false;
    if (this.opening || (this.ws && this.ws.readyState <= WebSocket.OPEN)) return;
    clearTimeout(this.timer);
    void this.connect();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.ws?.close();
  }

  private retry(why: string) {
    for (const [sid, s] of this.sessions) {
      this.sessions.delete(sid);
      s.onGone(why);
    }
    if (this.stopped) return;
    if (!this.account.signedIn) return this.set("signed_out");
    if (this.status !== "waiting" && this.status !== "blocked") this.set("offline", why);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.connect(), this.backoff);
    this.backoff = Math.min(this.backoff * 2, 30000);
  }

  private async connect() {
    if (this.stopped) return;
    if (!this.account.signedIn) return this.set("signed_out");
    if (this.status !== "waiting" && this.status !== "blocked") this.set("connecting");
    this.ready = new Promise((r) => (this.markReady = r));
    let token: string;
    this.opening = true;
    try {
      token = await this.account.access();
    } catch (e) {
      this.opening = false;
      if (!this.account.signedIn) return this.set("signed_out", (e as Error).message);
      if (e instanceof RemoteError && e.status === 403) return this.set("blocked");
      return this.retry((e as Error).message);
    }
    this.opening = false;
    if (this.stopped) return;
    const ws = new WebSocket(this.account.relay.replace(/^http/, "ws") + "/ws");
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ t: "auth", token }));
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      this.retry("Connection to the relay lost");
    };
    ws.onmessage = (e) => {
      let m: any;
      try {
        m = JSON.parse(String(e.data));
      } catch {
        return;
      }
      this.onFrame(m);
    };
  }

  private onUser(user: RelayUser) {
    void this.account.setUser(user);
    if (user.status === "approved" && user.remote) {
      this.backoff = 1000;
      this.set("online");
      this.markReady();
    } else if (user.status === "blocked" || user.status === "denied") {
      this.set("blocked", user.status === "denied" ? "This request was not approved." : "This account is blocked.");
    } else {
      this.set("waiting", user.status === "approved" ? "Remote access is switched off for this account." : null);
    }
  }

  private onFrame(m: any) {
    switch (m.t) {
      case "ready":
      case "account":
        this.onUser(m.user as RelayUser);
        break;
      case "presence": {
        this.devices = m.devices as RelayDevice[];
        for (const [sid, s] of this.sessions) {
          if (!this.devices.some((d) => d.id === s.host && d.online)) {
            this.sessions.delete(sid);
            s.onGone("The computer went offline");
          }
        }
        this.changed();
        break;
      }
      case "route": {
        let env: Envelope;
        try {
          env = JSON.parse(m.env);
        } catch {
          return;
        }
        const s = this.sessions.get(env.sid);
        if (s && s.host === m.from) s.onEnv(env);
        break;
      }
      case "undeliverable":
        for (const [sid, s] of this.sessions) {
          if (s.host === m.to) {
            this.sessions.delete(sid);
            s.onGone("The computer is not reachable");
          }
        }
        break;
      case "revoked": {
        const reason = String(m.reason ?? "");
        if (reason === "sign in again") this.account.dropAccess();
        else if (reason.includes("signed out") || reason.includes("deleted")) void this.account.forget();
        else if (reason.includes("blocked")) this.set("blocked", "This account is blocked.");
        break;
      }
    }
  }

  private route(to: string, env: Envelope) {
    this.ws?.send(JSON.stringify({ t: "route", to, env: JSON.stringify(env) }));
  }

  /**
   * Opens a sealed session to a computer: `DaemonClient` gets it as its transport. The
   * computer's key is the one pinned at pairing (or, signed in without a QR, the one first
   * seen, then pinned); a different key is refused.
   */
  transport(hostId: string): () => Promise<Transport> {
    return async () => {
      await Promise.race([this.ready, new Promise((_, rej) => setTimeout(() => rej(new Error("Relay not connected")), 15000))]);
      const host = this.devices.find((d) => d.id === hostId);
      if (!host?.online || !host.pubkey) throw new Error("This computer is offline");
      const pinned = this.account.trustedKey(hostId);
      if (pinned && pinned !== host.pubkey) throw new Error("This computer's key changed. Pair it again with a QR code.");
      if (!pinned) await this.account.trust(hostId, host.pubkey);
      const hs = await clientStart(await this.account.deviceKey(), unb64(host.pubkey));
      const sid = randomB64(12);
      const dec = new TextDecoder();
      const enc = new TextEncoder();
      return new Promise<Transport>((resolve, reject) => {
        let session: Session | null = null;
        let closed = false;
        const t: Transport = {
          send: (text) => {
            if (closed || !session) return;
            void session.seal(enc.encode(text)).then((ct) => !closed && this.route(hostId, { k: "d", sid, ct: b64(ct) }));
          },
          close: () => {
            if (closed) return;
            closed = true;
            this.sessions.delete(sid);
            this.route(hostId, { k: "bye", sid });
          },
          onmessage: null,
          onclose: null,
        };
        const timeout = setTimeout(() => gone("The computer did not answer"), 15000);
        const gone = (why: string) => {
          clearTimeout(timeout);
          if (closed) return;
          closed = true;
          this.sessions.delete(sid);
          if (session) t.onclose?.(why);
          else reject(new Error(why));
        };
        this.sessions.set(sid, {
          host: hostId,
          onGone: gone,
          onEnv: (e) => {
            if (e.k === "hs2" && !session) {
              hs.finish(unb64(String(e.f))).then((s) => {
                clearTimeout(timeout);
                session = s;
                resolve(t);
              }, () => gone("Handshake failed"));
            } else if (e.k === "d" && session) {
              session.open(unb64(String(e.ct))).then(
                (pt) => !closed && t.onmessage?.(dec.decode(pt)),
                () => {
                  t.close();
                  gone("A message could not be decrypted");
                },
              );
            } else if (e.k === "bye") {
              gone("The computer closed the session");
            }
          },
        });
        this.route(hostId, { k: "hs1", sid, e: b64(hs.e), c: b64(hs.c) });
      });
    };
  }
}

/** Reads a pairing link's fragment (`/app/pair#c=…&h=…&f=…`). */
export function parsePairLink(hash: string): { code: string; host: string; fp: string } | null {
  const q = new URLSearchParams(hash.replace(/^#/, ""));
  const code = q.get("c");
  const host = q.get("h");
  const fp = q.get("f");
  return code && host && fp ? { code, host, fp } : null;
}

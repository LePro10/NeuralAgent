import { apply } from "./apply.ts";
import type { ApiError, AttachResult, CallEvent, CvAttachResult, CvEvent, ClientInfo, Event, HostInfo, Request, ServerMsg, State } from "./gen/index.ts";

export const PROTOCOL_VERSION = 1;

/** A message pipe to a daemon: the local WebSocket, or the relay with E2E sealing. */
export interface Transport {
  send(text: string): void;
  close(): void;
  /** Optional: this session stopped answering; the carrier (e.g. the relay socket) should check itself. */
  stale?(): void;
  /** Optional: bytes still waiting to go out (a big upload on a slow uplink delays every answer). */
  sending?(): number;
  onmessage: ((text: string) => void) | null;
  onclose: ((reason: string) => void) | null;
}

/** Opens a fresh transport (called again for every reconnect). */
export type Connect = () => Promise<Transport>;

export type ConnStatus = "connecting" | "open" | "offline";

/** Heartbeat: a ping this often while open (and nothing else arrived meanwhile)… */
export const PING_EVERY = 10_000;
/** …and a connection that stays silent this long after a ping is dead. */
export const PING_TIMEOUT = 8_000;
/** After the app comes back (or the network changes) the check is quicker. */
export const WAKE_TIMEOUT = 3_000;
/** A connection still sending (an upload) is only dead when its outgoing data stops moving this long. */
export const SEND_STALL = 45_000;
/**
 * After a big send the network is busy with it for a while, even when `sending` reads 0 (OS and
 * runtime buffers): answers are not expected before it went out at this slow-uplink rate.
 */
export const SLOW_UPLINK = 100_000;
/** When a send of `bytes` (made now) should be out, given the previous estimate. */
export const drainedBy = (prev: number, bytes: number, now = Date.now()) => (bytes > 64_000 ? Math.max(prev, now) + (bytes / SLOW_UPLINK) * 1000 : prev);
/** Requests made while reconnecting wait this long for the connection before failing. */
export const REQUEST_WAIT = 20_000;

export class RequestError extends Error {
  code: ApiError["code"];
  constructor(e: ApiError) {
    super(e.message);
    this.code = e.code;
  }
}

export interface TermSink {
  /** Clear the terminal and write `snapshot` (attach, reconnect, or fell behind). */
  reset(snapshot: string, cols: number, rows: number): void;
  data(bytes: Uint8Array): void;
}

/** A view of a Claude session's conversation. */
export interface CvSink {
  /** The conversation (attach, reconnect, or the transcript changed). */
  reset(res: CvAttachResult): void;
  event(ev: CvEvent): void;
}

interface Attached {
  sinks: Set<TermSink>;
  seq: number;
  pending?: Promise<void>;
}

type Listener = () => void;

/**
 * Connection to one daemon. Keeps a synced copy of the state, reconnects with backoff and
 * resumes from the last event, and multiplexes terminal streams with sequence de-duplication.
 */
export class DaemonClient {
  state: State | null = null;
  host: HostInfo | null = null;
  status: ConnStatus = "connecting";
  private seq = 0;
  private t: Transport | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private listeners = new Set<Listener>();
  private eventListeners = new Set<(ev: Event) => void>();
  private callListeners = new Set<(ev: CallEvent) => void>();
  /** The desktop app answers `host_call`s from the daemon (remote clients asking the host's app). */
  private hostUi: ((op: string, args: unknown) => Promise<unknown>) | null = null;
  /** Fired each time the connection (re)opens and the daemon says hello: its version and host. */
  private helloListeners = new Set<(daemonVersion: string) => void>();
  /** Version of the daemon we are talking to. */
  daemonVersion = "";
  /** A call is on: started again after a reconnect (the conversation lives in the daemon). */
  private calling = false;
  private terms = new Map<string, Attached>();
  private cvs = new Map<string, { sinks: Set<CvSink>; gen: number }>();
  private retry = 0;
  private closed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Each connection attempt has a number; a stale attempt's transport is closed when it arrives. */
  private attempt = 0;
  private attemptAt = 0;
  /** The transport said hello: requests can go out. */
  private live = false;
  private waiters = new Set<() => void>();
  /** Heartbeat: when something last came in, and the deadline of an unanswered ping. */
  private lastIn = 0;
  private deadline = 0;
  private lastTick = 0;
  private lastOut = 0;
  private outMoved = 0;
  private drained = 0;
  private liveAt = 0;
  private beat: ReturnType<typeof setInterval> | undefined;

  private connect: Connect;
  private client: ClientInfo;

  constructor(connect: Connect, client: ClientInfo) {
    this.connect = connect;
    this.client = client;
    void this.open();
  }

  // ── subscription for UI frameworks (useSyncExternalStore) ──
  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  onEvent(l: (ev: Event) => void) {
    this.eventListeners.add(l);
    return () => this.eventListeners.delete(l);
  }
  onCall(l: (ev: CallEvent) => void) {
    this.callListeners.add(l);
    return () => this.callListeners.delete(l);
  }

  onHello(l: (daemonVersion: string) => void) {
    this.helloListeners.add(l);
    return () => void this.helloListeners.delete(l);
  }

  /** Desktop app: act as the host's UI for remote clients (see `Request` `host_ui`). */
  serveHost(handler: ((op: string, args: unknown) => Promise<unknown>) | null) {
    this.hostUi = handler;
    this.t?.send(JSON.stringify({ t: "host_ui_register", on: !!handler }));
  }

  // ── calls with Neural: microphone audio in, speech out (PCM16 base64) ──
  callStart() {
    this.calling = true;
    this.t?.send(JSON.stringify({ t: "call_start" }));
  }
  callAudio(d: string) {
    if (this.calling) this.t?.send(JSON.stringify({ t: "call_audio", d }));
  }
  callEnd() {
    this.calling = false;
    this.t?.send(JSON.stringify({ t: "call_end" }));
  }

  private notify() {
    for (const l of this.listeners) l();
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
    clearInterval(this.beat);
    this.t?.close();
    this.wakeWaiters();
  }

  /**
   * The app came back to the foreground, or the network changed: reconnect right away if the
   * connection is down, or check quickly that an open one still answers (a socket can die
   * silently while the phone sleeps, and timers were frozen meanwhile).
   */
  poke() {
    if (this.closed) return;
    if (this.status === "offline") {
      clearTimeout(this.timer);
      this.retry = 0;
      void this.open();
    } else if (this.t && this.live) {
      this.ping(WAKE_TIMEOUT);
    } else if (Date.now() - this.attemptAt > WAKE_TIMEOUT) {
      // An attempt that hangs (e.g. on a dead relay socket): start a fresh one.
      this.retry = 0;
      void this.open();
    }
  }

  private ping(timeout: number) {
    const t = this.t;
    if (!t || !this.live) return;
    const until = Date.now() + timeout;
    if (!this.deadline || until < this.deadline) this.deadline = until;
    t.send(JSON.stringify({ t: "ping", at: Date.now() }));
    // Judge right at the deadline, not on the next tick.
    setTimeout(this.tick, timeout + 50);
  }

  /** Runs every few seconds while a transport is up. */
  private tick = () => {
    const now = Date.now();
    // Timers were frozen (phone asleep, app in the background): check quickly.
    const slept = this.lastTick && now - this.lastTick > PING_EVERY * 2;
    this.lastTick = now;
    if (!this.t || !this.live) return;
    // A connection that held for a while: the next drop reconnects at once again.
    if (this.retry && now - this.liveAt > 10_000) this.retry = 0;
    // In the background the browser throttles timers: no verdicts then; coming back checks.
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      this.deadline = 0;
      return;
    }
    // Still pushing a big upload out: the answer is queued behind it. Wait while it moves.
    const out = this.t.sending?.() ?? 0;
    if (!out || out < this.lastOut) this.outMoved = now;
    this.lastOut = out;
    if (this.deadline && now > this.deadline) {
      const busy = (out > 0 && now - this.outMoved < SEND_STALL) || now < this.drained;
      if (busy) this.deadline = now + 1000;
      else return this.dead("no answer from the computer");
    }
    if (slept) this.ping(WAKE_TIMEOUT);
    else if (!this.deadline && now - this.lastIn >= PING_EVERY) this.ping(PING_TIMEOUT);
  };

  /** The transport stopped answering: drop it and reconnect now. */
  private dead(why: string) {
    const t = this.t;
    if (!t) return;
    console.warn(`daemon connection: ${why}`);
    t.stale?.();
    t.onmessage = null;
    t.onclose = null;
    t.close();
    this.lost(t);
    clearTimeout(this.timer);
    this.retry = 0;
    void this.open();
  }

  private lost(t: Transport) {
    if (this.t !== t) return;
    this.t = null;
    this.live = false;
    this.deadline = 0;
    clearInterval(this.beat);
    for (const [, p] of this.pending) p.reject(new Error("The connection to the computer was lost. Try again."));
    this.pending.clear();
    this.setStatus("offline");
  }

  private wakeWaiters() {
    for (const w of this.waiters) w();
    this.waiters.clear();
  }

  /** Resolves when requests can go out (or after `ms`, rejecting). */
  private whenLive(ms: number): Promise<Transport> {
    if (this.t && this.live) return Promise.resolve(this.t);
    if (this.closed) return Promise.reject(new Error("offline"));
    return new Promise((resolve, reject) => {
      const done = () => {
        clearTimeout(timer);
        this.waiters.delete(done);
        if (this.t && this.live) resolve(this.t);
        else reject(new Error(this.closed ? "offline" : "Not connected to the computer. Try again in a moment."));
      };
      const timer = setTimeout(done, ms);
      this.waiters.add(done);
    });
  }

  private setStatus(s: ConnStatus) {
    if (this.status !== s) {
      this.status = s;
      this.notify();
    }
  }

  private async open() {
    if (this.closed) return;
    clearTimeout(this.timer);
    const n = ++this.attempt;
    this.attemptAt = Date.now();
    if (this.t) {
      // A fresh attempt replaces a transport that never said hello.
      const old = this.t;
      old.onmessage = null;
      old.onclose = null;
      old.close();
      this.lost(old);
    }
    this.setStatus("connecting");
    let t: Transport;
    try {
      t = await this.connect();
    } catch {
      if (n === this.attempt) this.scheduleReconnect();
      return;
    }
    if (this.closed || n !== this.attempt) return t.close();
    this.t = t;
    this.lastIn = Date.now();
    this.deadline = 0;
    let helloDone = false;
    t.onmessage = (text) => {
      this.lastIn = Date.now();
      this.deadline = 0;
      let m: ServerMsg;
      try {
        m = JSON.parse(text);
      } catch {
        return;
      }
      if (!helloDone) {
        if (m.t !== "hello_ok") return;
        helloDone = true;
        this.live = true;
        this.liveAt = Date.now();
        this.host = m.host;
        this.daemonVersion = m.daemon_version;
        if (this.hostUi) t.send(JSON.stringify({ t: "host_ui_register", on: true }));
        for (const l of this.helloListeners) l(m.daemon_version);
        // Resume where we were; the daemon answers with replayed events or a snapshot.
        t.send(JSON.stringify(this.state ? { t: "sub", since: this.seq } : { t: "sub" }));
        if (this.calling) t.send(JSON.stringify({ t: "call_start" }));
        clearInterval(this.beat);
        this.lastTick = Date.now();
        this.beat = setInterval(this.tick, 2_000);
        this.wakeWaiters();
        return;
      }
      this.onMsg(m);
    };
    t.onclose = () => {
      if (this.t !== t) return;
      this.lost(t);
      this.scheduleReconnect();
    };
    t.send(JSON.stringify({ t: "hello", v: PROTOCOL_VERSION, client: this.client }));
  }

  private scheduleReconnect() {
    if (this.closed) return;
    this.setStatus("offline");
    clearTimeout(this.timer);
    // The first retry is immediate: most drops are a dead socket, not a down computer.
    const delay = this.retry === 0 ? 0 : Math.min(10_000, 250 * 2 ** this.retry) * (0.75 + Math.random() * 0.5);
    this.retry++;
    this.timer = setTimeout(() => void this.open(), delay);
  }

  private onMsg(m: ServerMsg) {
    switch (m.t) {
      case "snapshot":
        this.state = m.state;
        this.seq = m.seq;
        this.setStatus("open");
        this.notify();
        this.reattachAll();
        break;
      case "ev":
        if (!this.state || m.seq <= this.seq) return;
        this.state = apply(this.state, m.ev);
        this.seq = m.seq;
        if (this.status !== "open") {
          this.status = "open";
          this.reattachAll();
        }
        for (const l of this.eventListeners) l(m.ev);
        this.notify();
        break;
      case "pong":
        // `sub since` with nothing missed answers with nothing; a pong marks it live.
        if (this.state && this.status !== "open") {
          this.setStatus("open");
          this.reattachAll();
        }
        break;
      case "res": {
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        if (m.ok) p.resolve(m.r ?? null);
        else p.reject(new RequestError(m.err ?? { code: "internal", message: "request failed" }));
        break;
      }
      case "term": {
        const a = this.terms.get(m.sid);
        if (!a || a.pending) return;
        if (m.seq <= a.seq) return;
        a.seq = m.seq;
        const bytes = b64(m.d);
        for (const s of a.sinks) s.data(bytes);
        break;
      }
      case "term_reset": {
        const a = this.terms.get(m.sid);
        if (!a) return;
        a.seq = m.seq;
        for (const s of a.sinks) s.reset(m.snapshot, m.cols, m.rows);
        break;
      }
      case "cv": {
        const a = this.cvs.get(m.sid);
        if (!a) return;
        for (const s of a.sinks) s.event(m.ev);
        break;
      }
      case "call":
        for (const l of this.callListeners) l(m.ev);
        break;
      case "host_call": {
        const reply = (body: object) => this.t?.send(JSON.stringify({ t: "host_ui_reply", call: m.call, ...body }));
        if (!this.hostUi) return reply({ ok: false, error: "no host UI" });
        this.hostUi(m.op, m.args).then(
          (r) => reply({ ok: true, r: r ?? null }),
          (e) => reply({ ok: false, error: String(e instanceof Error ? e.message : e) }),
        );
        break;
      }
      case "hello_ok":
        break;
    }
  }

  /**
   * A request to the daemon. While the connection is coming back it waits for it (up to
   * `REQUEST_WAIT`) instead of failing at once, so a short reconnect does not break the UI.
   */
  req<T = unknown>(r: Request): Promise<T> {
    const send = (t: Transport) => {
      const id = this.nextId++;
      return new Promise<T>((resolve, reject) => {
        this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
        const text = JSON.stringify({ t: "req", id, req: r });
        this.drained = drainedBy(this.drained, text.length);
        t.send(text);
      });
    };
    if (this.t) return send(this.t);
    return this.whenLive(REQUEST_WAIT).then(send);
  }

  /** Streams a session's terminal into `sink` until the returned function is called. */
  attach(sid: string, sink: TermSink): () => void {
    let a = this.terms.get(sid);
    if (!a) {
      a = { sinks: new Set(), seq: 0 };
      this.terms.set(sid, a);
      a.sinks.add(sink);
      void this.doAttach(sid);
    } else {
      a.sinks.add(sink);
      // A second view of the same terminal needs its own snapshot.
      void this.doAttach(sid);
    }
    return () => {
      const cur = this.terms.get(sid);
      if (!cur) return;
      cur.sinks.delete(sink);
      if (cur.sinks.size === 0) {
        this.terms.delete(sid);
        this.req({ m: "term_detach", p: { sid } }).catch(() => {});
      }
    };
  }

  /** Re-attach after the session process restarted. */
  reattach(sid: string) {
    if (this.terms.has(sid)) void this.doAttach(sid);
  }

  private reattachAll() {
    for (const sid of this.terms.keys()) void this.doAttach(sid);
    for (const sid of this.cvs.keys()) void this.doAttachCv(sid);
  }

  /** Streams a Claude session's conversation into `sink` until the returned function is called. */
  attachCv(sid: string, sink: CvSink): () => void {
    let a = this.cvs.get(sid);
    if (!a) {
      a = { sinks: new Set(), gen: 0 };
      this.cvs.set(sid, a);
    }
    a.sinks.add(sink);
    void this.doAttachCv(sid, sink);
    return () => {
      const cur = this.cvs.get(sid);
      if (!cur) return;
      cur.sinks.delete(sink);
      if (cur.sinks.size === 0) {
        this.cvs.delete(sid);
        this.req({ m: "cv_detach", p: { sid } }).catch(() => {});
      }
    };
  }

  private async doAttachCv(sid: string, only?: CvSink) {
    const a = this.cvs.get(sid);
    if (!a) return;
    const gen = ++a.gen;
    try {
      const r = await this.req<CvAttachResult>({ m: "cv_attach", p: { sid } });
      if (this.cvs.get(sid) !== a || a.gen !== gen) return;
      for (const s of only && a.sinks.has(only) ? [only] : a.sinks) s.reset(r);
    } catch {
      // retried on the next reconnect
    }
  }

  private async doAttach(sid: string) {
    const a = this.terms.get(sid);
    if (!a) return;
    const run = (async () => {
      try {
        const r = await this.req<AttachResult>({ m: "term_attach", p: { sid } });
        const cur = this.terms.get(sid);
        if (cur !== a) return;
        a.seq = r.seq;
        a.pending = undefined;
        for (const s of a.sinks) s.reset(r.snapshot, r.cols, r.rows);
      } catch {
        a.pending = undefined;
      }
    })();
    a.pending = run;
    await run;
  }

  write(sid: string, data: string) {
    this.req({ m: "term_write", p: { sid, data } }).catch(() => {});
  }
}

function b64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Local daemon over WebSocket. */
export function webSocketTransport(url: string): Promise<Transport> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const t: Transport = {
      send: (text) => ws.readyState === WebSocket.OPEN && ws.send(text),
      close: () => ws.close(),
      sending: () => ws.bufferedAmount,
      onmessage: null,
      onclose: null,
    };
    let opened = false;
    ws.onopen = () => {
      opened = true;
      resolve(t);
    };
    ws.onmessage = (e) => t.onmessage?.(typeof e.data === "string" ? e.data : "");
    ws.onclose = (e) => {
      if (!opened) reject(new Error(`websocket closed (${e.code})`));
      else t.onclose?.(e.reason || String(e.code));
    };
  });
}

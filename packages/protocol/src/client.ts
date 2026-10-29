import { apply } from "./apply.ts";
import type { ApiError, AttachResult, ClientInfo, Event, HostInfo, Request, ServerMsg, State } from "./gen/index.ts";

export const PROTOCOL_VERSION = 1;

/** A message pipe to a daemon: the local WebSocket, or the relay with E2E sealing. */
export interface Transport {
  send(text: string): void;
  close(): void;
  onmessage: ((text: string) => void) | null;
  onclose: ((reason: string) => void) | null;
}

/** Opens a fresh transport (called again for every reconnect). */
export type Connect = () => Promise<Transport>;

export type ConnStatus = "connecting" | "open" | "offline";

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
  private terms = new Map<string, Attached>();
  private retry = 0;
  private closed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

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
  private notify() {
    for (const l of this.listeners) l();
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
    this.t?.close();
  }

  /** Reconnect right away (e.g. the app came back to the foreground). */
  poke() {
    if (this.status === "offline" && !this.closed) {
      clearTimeout(this.timer);
      this.retry = 0;
      void this.open();
    }
  }

  private setStatus(s: ConnStatus) {
    if (this.status !== s) {
      this.status = s;
      this.notify();
    }
  }

  private async open() {
    this.setStatus("connecting");
    let t: Transport;
    try {
      t = await this.connect();
    } catch {
      return this.scheduleReconnect();
    }
    if (this.closed) return t.close();
    this.t = t;
    let helloDone = false;
    t.onmessage = (text) => {
      let m: ServerMsg;
      try {
        m = JSON.parse(text);
      } catch {
        return;
      }
      if (!helloDone) {
        if (m.t !== "hello_ok") return;
        helloDone = true;
        this.host = m.host;
        this.retry = 0;
        // Resume where we were; the daemon answers with replayed events or a snapshot.
        t.send(JSON.stringify(this.state ? { t: "sub", since: this.seq } : { t: "sub" }));
        return;
      }
      this.onMsg(m);
    };
    t.onclose = () => {
      if (this.t !== t) return;
      this.t = null;
      for (const [, p] of this.pending) p.reject(new Error("connection lost"));
      this.pending.clear();
      this.setStatus("offline");
      this.scheduleReconnect();
    };
    t.send(JSON.stringify({ t: "hello", v: PROTOCOL_VERSION, client: this.client }));
  }

  private scheduleReconnect() {
    if (this.closed) return;
    this.setStatus("offline");
    const delay = Math.min(10_000, 250 * 2 ** this.retry++) * (0.75 + Math.random() * 0.5);
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
      case "hello_ok":
        break;
    }
  }

  req<T = unknown>(r: Request): Promise<T> {
    const t = this.t;
    if (!t) return Promise.reject(new Error("offline"));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      t.send(JSON.stringify({ t: "req", id, req: r }));
    });
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

// One connection of the protocol, as the daemon sees it: handshake, subscription (snapshot + events),
// requests and the streams (terminal, Claude view). Messages leave through a FIFO queue so the
// order the daemon decided is the order the app sees, whatever latency is simulated.

import type { ClientKind, ClientMsg, CvAttachResult, CvEvent, Event, ErrorCode, ServerMsg, Transport } from "@neuralagent/protocol";
import type { DemoView } from "../api.ts";
import { DAEMON_VERSION, FEATURES, HOST, type Sim } from "./sim.ts";
import { handle } from "./handlers/index.ts";

export class ApiErr extends Error {
  code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface CvAttach {
  sid: string;
  agent?: string;
  tasks: boolean;
}

/** Run `f` in a later task (Node: setImmediate; browsers: MessageChannel, which timers' 4 ms clamping does not touch). */
const nextTask: (f: () => void) => void = (() => {
  const im = (globalThis as { setImmediate?: (f: () => void) => unknown }).setImmediate;
  if (typeof im === "function") return (f) => void im(f);
  if (typeof MessageChannel === "undefined") return (f) => void setTimeout(f, 0);
  const ch = new MessageChannel();
  const todo: (() => void)[] = [];
  ch.port1.onmessage = () => todo.shift()?.();
  return (f) => {
    todo.push(f);
    ch.port2.postMessage(0);
  };
})();

export class Conn {
  readonly sim: Sim;
  readonly view: DemoView | undefined;
  kind: ClientKind = "desktop";
  name = "Browser";
  subscribed = false;
  closed = false;
  /** Terminals this client watches (it gets `term` chunks of these). */
  attached = new Set<string>();
  /** Claude views this client watches, by `sid` or `sid|agent`. */
  cv = new Map<string, CvAttach>();
  /** Views that were watched when the last snapshot went out: their next attach is a re-attach (see `follow`). */
  private rebuilt = new Set<string>();
  readonly transport: Transport;
  private q: string[] = [];
  private armed = false;
  private draining = false;
  private helloDone = false;

  constructor(sim: Sim, view?: DemoView) {
    this.sim = sim;
    this.view = view;
    this.transport = {
      onmessage: null,
      onclose: null,
      send: (text: string) => this.recv(text),
      close: () => this.close("closed"),
    };
    sim.conns.add(this);
    sim.signal({ type: "client", view: view ?? "desk", connected: true });
  }

  close(reason: string) {
    if (this.closed) return;
    this.closed = true;
    this.sim.conns.delete(this);
    this.sim.signal({ type: "client", view: this.view ?? "desk", connected: false });
    const cb = this.transport.onclose;
    this.transport.onclose = null;
    this.transport.onmessage = null;
    cb?.(reason);
  }

  // ── out ──

  out(msg: ServerMsg) {
    if (this.closed) return;
    this.q.push(JSON.stringify(msg));
    if (this.armed || this.draining) return;
    this.armed = true;
    if (this.sim.latency <= 0) queueMicrotask(() => this.flush());
    else setTimeout(() => this.flush(), this.sim.latency);
  }

  /**
   * One message per task, like a WebSocket: the client resolves a request's promise in a microtask
   * and only then lets chunks of a terminal through (`attach` is "pending" until then), so messages
   * that arrive in the same task would be dropped.
   */
  private flush() {
    this.armed = false;
    if (this.draining) return;
    this.draining = true;
    const step = () => {
      const t = this.q.shift();
      if (t === undefined || this.closed) {
        this.draining = false;
        return;
      }
      try {
        this.transport.onmessage?.(t);
      } catch (e) {
        console.error("[demo] client handler threw", e);
      }
      nextTask(step);
    };
    step();
  }

  sendEv(seq: number, ev: Event) {
    if (this.subscribed) this.out({ t: "ev", seq, ev });
  }

  sendTerm(sid: string, seq: number, d: string) {
    if (!this.sim.building && this.attached.has(sid)) this.out({ t: "term", sid, seq, d });
  }

  sendCv(sid: string, ev: CvEvent, agent?: string) {
    if (this.sim.building) return;
    const key = agent ? `${sid}|${agent}` : sid;
    const a = this.cv.get(key);
    if (!a) return;
    if (ev.k === "tasks" && !a.tasks) return;
    this.out({ t: "cv", sid, ev, ...(agent ? { agent } : {}) });
  }

  /** A fresh full state (after `sub` and after a world reset). The app re-attaches everything itself. */
  snapshot() {
    this.attached.clear();
    this.rebuilt = new Set(this.cv.keys());
    this.cv.clear();
    this.out({ t: "snapshot", seq: this.sim.seq, state: this.sim.state });
    this.subscribed = true;
  }

  /**
   * The app re-attaches every Claude view after a snapshot, and views that mount a moment later attach
   * again; the client only lets the last attach answer, and only to its own sink, so a view that attached
   * earlier (the inbox row waiting for its permission prompt) never hears back. Events reach every sink,
   * so the attach is followed by what an answer would have carried.
   */
  follow(sid: string, res: CvAttachResult, agent?: string) {
    const key = agent ? `${sid}|${agent}` : sid;
    const again = this.rebuilt.delete(key);
    if (agent) return;
    queueMicrotask(() => {
      if (this.closed || !this.cv.has(key)) return;
      const send = (ev: CvEvent) => this.out({ t: "cv", sid, ev });
      if (again) send({ k: "reset", messages: res.messages, more: res.more, meta: res.meta });
      if (res.prompt) send({ k: "prompt", prompt: res.prompt });
      if (res.tasks?.length && this.cv.get(key)?.tasks) send({ k: "tasks", tasks: res.tasks });
    });
  }

  // ── in ──

  private recv(text: string) {
    if (this.closed) return;
    let m: ClientMsg;
    try {
      m = JSON.parse(text) as ClientMsg;
    } catch {
      return;
    }
    switch (m.t) {
      case "hello":
        this.helloDone = true;
        this.kind = m.client.kind;
        this.name = m.client.name;
        this.out({ t: "hello_ok", v: 1, daemon_version: DAEMON_VERSION, host: HOST, features: FEATURES });
        return;
      case "ping":
        this.out({ t: "pong", at: m.at });
        return;
      case "sub":
        if (!this.helloDone) return;
        if (m.since !== undefined && m.since === this.sim.seq && this.subscribed) this.out({ t: "pong", at: this.sim.now() });
        else this.snapshot();
        return;
      case "req":
        this.request(m.id, m.req);
        return;
      default:
        return; // call_* and host_ui_*: the demo has no voice and no host UI
    }
  }

  private request(id: number, req: Parameters<typeof handle>[2]) {
    const ok = (r: unknown) => this.out({ t: "res", id, ok: true, r: (r ?? null) as never });
    const fail = (e: unknown) => {
      const err = e instanceof ApiErr ? { code: e.code, message: e.message } : { code: "internal" as const, message: e instanceof Error ? e.message : "request failed" };
      this.out({ t: "res", id, ok: false, err });
    };
    let r: unknown;
    try {
      r = handle(this.sim, this, req);
    } catch (e) {
      fail(e);
      return;
    }
    if (r instanceof Promise) r.then(ok, fail);
    else ok(r);
  }
}

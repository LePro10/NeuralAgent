// Test helper (not shipped: only the tests import it): a protocol client on a world's transport.
import type { DemoView, DemoWorld } from "../api.ts";

export interface Probe {
  msgs: any[];
  req(m: string, p?: unknown, ms?: number): Promise<any>;
  until(pred: () => boolean, ms?: number): Promise<void>;
  close(): void;
}

export const settle = (ms = 12) => new Promise<void>((r) => setTimeout(r, ms));

/** Open a connection, say hello, subscribe and wait for the snapshot. */
/** `drive`: virtual time moves on while a request waits (handlers that sleep on the world clock). */
export async function open(w: DemoWorld, view: DemoView = "desk", drive = false): Promise<Probe> {
  const tr = await w.connect(view);
  const msgs: any[] = [];
  const pending = new Map<number, (m: any) => void>();
  let id = 1;
  tr.onmessage = (t: string) => {
    const m = JSON.parse(t);
    msgs.push(m);
    if (m.t === "res") pending.get(m.id)?.(m);
  };
  const until = async (pred: () => boolean, ms = 3000) => {
    const t0 = Date.now();
    while (!pred()) {
      if (Date.now() - t0 > ms) throw new Error("timed out waiting");
      await settle(4);
    }
  };
  const req = (m: string, p?: unknown, ms = 3000) =>
    new Promise<any>((resolve, reject) => {
      const i = id++;
      const timer = setTimeout(() => {
        clearInterval(pump);
        reject(new Error(`no answer to ${m}`));
      }, ms);
      const pump = drive ? setInterval(() => void w.clock.advance(500), 8) : 0;
      pending.set(i, (r) => {
        clearTimeout(timer);
        clearInterval(pump);
        resolve(r);
      });
      tr.send(JSON.stringify({ t: "req", id: i, req: p === undefined ? { m } : { m, p } }));
    });
  tr.send(JSON.stringify({ t: "hello", v: 1, client: { kind: view === "desk" ? "desktop" : "web", name: "test" } }));
  tr.send(JSON.stringify({ t: "sub" }));
  await until(() => msgs.some((m) => m.t === "snapshot"));
  return { msgs, req, until, close: () => tr.close() };
}

export const snapshotOf = (p: Probe) => p.msgs.find((m) => m.t === "snapshot").state;

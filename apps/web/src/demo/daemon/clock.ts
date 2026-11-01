// The world's clock: a priority queue of timers on a virtual timeline that can be paused, sped up
// and (in tests) advanced by hand. Every scripted behaviour of the fake daemon waits on this clock,
// never on setTimeout directly, so "pause the demo", "2x" and deterministic tests all work.
// The protocol pipe (latency of messages) is NOT on this clock: the app needs real time to answer.

export interface ClockOptions {
  /** Virtual time at start (ms since epoch). Default: Date.now(). */
  start?: number;
  /** Where real time comes from. Default: performance.now(). */
  realNow?: () => number;
  /** Drive the timeline by itself with setTimeout (the browser), or only by `advance` (tests). */
  auto?: boolean;
}

export type Cancel = () => void;

/** Thrown into `sleep` when its scope is cancelled (an agent was stopped, the world was reset). */
export class Cancelled extends Error {
  constructor() {
    super("cancelled");
  }
}

/** A group of timers and sleeps that can be dropped together. */
export interface Scope {
  readonly dead: boolean;
  cancel(): void;
  /** A child scope: cancelled with its parent. */
  child(): Scope;
  /** Run `fn` when the scope is cancelled (at once when it already is). Returns a function that takes it back. */
  onCancel(fn: () => void): () => void;
}

/** A new scope; with a parent it is that parent's child. */
export function makeScope(parent?: Scope): Scope {
  return parent ? parent.child() : build();
}

function build(parentDead = false): Scope {
  const kids = new Set<Scope>();
  const hooks = new Set<() => void>();
  let dead = parentDead;
  const s: Scope = {
    get dead() {
      return dead;
    },
    cancel() {
      if (dead) return;
      dead = true;
      const h = [...hooks];
      hooks.clear();
      for (const k of kids) k.cancel();
      kids.clear();
      for (const f of h) f();
    },
    child: () => {
      const c = build(dead);
      if (!dead) kids.add(c);
      return c;
    },
    onCancel: (fn) => {
      if (dead) {
        fn();
        return () => {};
      }
      hooks.add(fn);
      return () => void hooks.delete(fn);
    },
  };
  return s;
}

interface Task {
  due: number;
  seq: number;
  fn: () => void;
  every?: number;
}

export interface Clock {
  /** Virtual time now, ms since epoch. */
  now(): number;
  /** Run `fn` after `ms` of virtual time. */
  after(ms: number, fn: () => void): Cancel;
  /** Run `fn` every `ms` of virtual time. */
  every(ms: number, fn: () => void): Cancel;
  /** Resolves after `ms`; rejects with `Cancelled` when the scope dies first. */
  sleep(ms: number, scope?: Scope): Promise<void>;
  pause(): void;
  resume(): void;
  readonly paused: boolean;
  /** 1 = real time, 2 = twice as fast. */
  setSpeed(x: number): void;
  readonly speed: number;
  /** Move virtual time forward, running what falls due in order (tests, and "skip ahead"). */
  advance(ms: number): Promise<void>;
  /** Forget every timer and jump to virtual time `to` (a fresh world starts its history from there). */
  rebase(to: number): void;
  /** Stop all timers (the world is thrown away). */
  dispose(): void;
}

export function makeClock(opts: ClockOptions = {}): Clock {
  const realNow = opts.realNow ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  const auto = opts.auto ?? true;
  let virtual = opts.start ?? Date.now();
  let anchor = realNow();
  let speed = 1;
  let paused = false;
  let counter = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  /** `advance` is running: time only moves by what it says. */
  let stepping = false;
  const queue: Task[] = [];

  const now = () => (paused || !auto || stepping ? virtual : virtual + (realNow() - anchor) * speed);
  /** Fold elapsed real time into `virtual` before changing speed/pause. */
  const settle = () => {
    virtual = now();
    anchor = realNow();
  };

  const insert = (t: Task) => {
    let i = queue.length;
    while (i > 0 && (queue[i - 1]!.due > t.due || (queue[i - 1]!.due === t.due && queue[i - 1]!.seq > t.seq))) i--;
    queue.splice(i, 0, t);
  };

  const flush = () => {
    const t = now();
    while (queue.length && queue[0]!.due <= t) {
      const task = queue.shift()!;
      if (task.every) {
        task.due += task.every;
        insert(task);
      }
      try {
        task.fn();
      } catch (e) {
        console.error("[demo clock]", e);
      }
    }
  };

  const arm = () => {
    clearTimeout(timer);
    timer = undefined;
    if (!auto || paused || disposed || !queue.length) return;
    const wait = Math.max(0, (queue[0]!.due - now()) / speed);
    timer = setTimeout(() => {
      timer = undefined;
      flush();
      arm();
    }, Math.min(wait, 2 ** 30));
  };

  const add = (ms: number, fn: () => void, every?: number): Cancel => {
    const task: Task = { due: now() + Math.max(0, ms), seq: counter++, fn, every };
    insert(task);
    arm();
    return () => {
      const i = queue.indexOf(task);
      if (i >= 0) queue.splice(i, 1);
      arm();
    };
  };

  return {
    now,
    after: (ms, fn) => add(ms, fn),
    every: (ms, fn) => add(ms, fn, Math.max(1, ms)),
    sleep: (ms, scope) =>
      new Promise<void>((resolve, reject) => {
        if (scope?.dead) return reject(new Cancelled());
        let off = () => {};
        // A cancelled scope frees its timer and wakes the sleeper at once.
        const drop = add(ms, () => {
          off();
          resolve();
        });
        if (scope)
          off = scope.onCancel(() => {
            drop();
            reject(new Cancelled());
          });
      }),
    pause() {
      if (paused) return;
      settle();
      paused = true;
      arm();
    },
    resume() {
      if (!paused) return;
      paused = false;
      anchor = realNow();
      arm();
    },
    get paused() {
      return paused;
    },
    setSpeed(x) {
      settle();
      speed = Math.min(16, Math.max(0.1, x));
      arm();
    },
    get speed() {
      return speed;
    },
    async advance(ms) {
      settle();
      stepping = true;
      const target = virtual + ms;
      // Let scripts that were just started reach their first sleep.
      for (let i = 0; i < 64; i++) await Promise.resolve();
      for (;;) {
        const next = queue[0];
        if (!next || next.due > target) break;
        virtual = Math.max(virtual, next.due);
        const task = queue.shift()!;
        if (task.every) {
          task.due += task.every;
          insert(task);
        }
        try {
          task.fn();
        } catch (e) {
          console.error("[demo clock]", e);
        }
        // Let promise continuations (async scripts waiting on `sleep`) run before the next timer.
        for (let i = 0; i < 64; i++) await Promise.resolve();
      }
      virtual = Math.max(virtual, target);
      stepping = false;
      anchor = realNow();
      arm();
    },
    rebase(to) {
      queue.length = 0;
      virtual = to;
      anchor = realNow();
      stepping = false;
      arm();
    },
    dispose() {
      disposed = true;
      queue.length = 0;
      clearTimeout(timer);
    },
  };
}

// A small seeded random generator (mulberry32). Everything the fake daemon invents comes from here,
// so one seed always gives the same world (ids, numbers, picks): posters stay reproducible.

export interface Rng {
  /** A float in [0, 1). */
  next(): number;
  /** An integer in [lo, hi] (both included). */
  int(lo: number, hi: number): number;
  /** One element of a non-empty list. */
  pick<T>(list: readonly T[]): T;
  /** `n` lower-case hex characters. */
  hex(n: number): string;
  /** An independent stream derived from this seed and a label: adding a new consumer never shifts the others. */
  fork(label: string): Rng;
}

/** FNV-1a: a string to a 32-bit number. */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function makeRng(seed: number | string): Rng {
  let a = (typeof seed === "number" ? seed : hash(seed)) >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (list) => list[Math.floor(next() * list.length)]!,
    hex: (n) => {
      let s = "";
      while (s.length < n) s += Math.floor(next() * 16).toString(16);
      return s;
    },
    fork: (label) => makeRng(hash(`${a}:${label}`) ^ hash(label)),
  };
  return rng;
}

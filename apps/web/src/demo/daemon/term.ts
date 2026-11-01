// A terminal of the fake computer: what it has printed (bounded), what is attached to it, and who
// reads the keys the app types. The snapshot is the retained output replayed from a clean screen.

import { SNAPSHOT_HEAD, byteLength, toBase64 } from "./ansi.ts";
import type { Sim } from "./sim.ts";

const KEEP_CHARS = 60_000;

/** Output that depends on the width of the screen (a banner, wrapped text, a clipped diff): drawn again for a new width. */
export type Flow = (cols: number) => string;

export class Term {
  readonly sim: Sim;
  readonly sid: string;
  cols = 100;
  rows = 30;
  /** Bytes printed so far: the sequence number of the stream. */
  bytes = 0;
  private chunks: (string | Flow)[] = [];
  private size = 0;
  /** Chunks that fell off the front: marks stay valid while the buffer is trimmed. */
  private dropped = 0;
  /** Keys typed into this terminal (the shell, or an agent waiting for an answer). */
  onInput: ((data: string) => void) | null = null;

  constructor(sim: Sim, sid: string) {
    this.sim = sim;
    this.sid = sid;
  }

  write(x: string | Flow) {
    const s = typeof x === "function" ? x(this.cols) : x;
    if (!s) return;
    this.bytes += byteLength(s);
    this.chunks.push(x);
    this.size += s.length;
    while (this.size > KEEP_CHARS && this.chunks.length > 1) {
      this.size -= this.render(this.chunks.shift()!).length;
      this.dropped++;
    }
    const d = toBase64(s);
    for (const c of this.sim.conns) c.sendTerm(this.sid, this.bytes, d);
  }

  private render(c: string | Flow): string {
    return typeof c === "function" ? c(this.cols) : c;
  }

  /** Where the output written from now on starts (see `reflow`). */
  mark(): number {
    return this.dropped + this.chunks.length;
  }

  /**
   * Replace what was written since `mark` (typed out piece by piece, so it could not be a Flow
   * while it streamed) by one Flow that draws the same text: a client that attaches later, at
   * another width, sees it laid out for that width. A no-op when the start was trimmed away.
   */
  reflow(mark: number, f: Flow) {
    const at = mark - this.dropped;
    if (at < 0 || at > this.chunks.length) return;
    for (const c of this.chunks.splice(at)) this.size -= this.render(c).length;
    this.chunks.push(f);
    this.size += f(this.cols).length;
  }

  /** Print lines, each ended with CRLF. */
  lines(...l: string[]) {
    this.write(l.map((x) => x + "\r\n").join(""));
  }

  snapshot(): string {
    return SNAPSHOT_HEAD + this.chunks.map((c) => this.render(c)).join("");
  }

  /** Forget everything printed (the screen was cleared). */
  wipe() {
    this.dropped += this.chunks.length;
    this.chunks = [];
    this.size = 0;
  }

  resize(cols: number, rows: number) {
    if (cols > 10 && rows > 2) {
      this.cols = cols;
      this.rows = rows;
    }
  }

  input(data: string) {
    this.onInput?.(data);
  }
}

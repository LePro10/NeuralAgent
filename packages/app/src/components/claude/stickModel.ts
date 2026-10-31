/**
 * The decision part of "stick to the bottom" (no DOM, tested in `lib/stickModel.test.ts`).
 *
 * - Pinned (following new output) at the start.
 * - Any scroll towards the top that the user caused unpins, however small. User intent comes
 *   from wheel / touch / keys / a held scrollbar, not from the scroll event alone: content that
 *   shrinks above the view or browser scroll anchoring also move `scrollTop`.
 * - Pinned again when the view reaches the end (within 8 px), when the pill is tapped or a
 *   message is sent.
 * - Scrolls we start ourselves open an ignore window; scroll events inside it never change the
 *   state (a smooth scroll to the end does not unpin itself half way).
 * - Never follow while a finger (or the scrollbar) is held; the follow waits for the release.
 */

export const NEAR_END = 8;
/** An unexplained move up by more than this (px) is the reader's. */
const JUMP = 48;
/** How long after a wheel / key / touch end a scroll still counts as the user's (momentum). */
const INTENT_MS = 260;
const MOMENTUM_MS = 1600;
const INSTANT_IGNORE_MS = 60;
const SMOOTH_IGNORE_MS = 450;

export interface Metrics {
  top: number;
  height: number;
  client: number;
}

export class StickModel {
  pinned = true;
  /** Entries that arrived while not pinned. */
  unseen = 0;
  /** A finger or the scrollbar is held: never write `scrollTop` now. */
  held = false;
  direction: "up" | "down" | null = null;
  private ignoreUntil = 0;
  private intentAt = -Infinity;
  private momentumUntil = 0;
  private lastTop = 0;
  /** A follow was skipped while held; run it on release. */
  private owed = false;

  private userish(now: number) {
    return this.held || now - this.intentAt < INTENT_MS || now < this.momentumUntil;
  }

  /** Wheel / touch / key movement. `up` = towards older content: unpins at once. */
  intent(now: number, up: boolean | null) {
    this.intentAt = now;
    if (up) {
      this.pinned = false;
      this.ignoreUntil = 0;
      this.direction = "up";
    }
  }

  hold(now: number) {
    this.held = true;
    this.intentAt = now;
  }

  /** Finger / scrollbar released. Returns true when a follow is owed now. */
  release(now: number): boolean {
    this.held = false;
    this.momentumUntil = now + MOMENTUM_MS;
    const owed = this.owed && this.pinned;
    this.owed = false;
    return owed;
  }

  /** A scroll event. */
  scroll(m: Metrics, now: number) {
    const moved = m.top - this.lastTop;
    this.lastTop = m.top;
    if (now < this.ignoreUntil) return;
    const dist = m.height - m.top - m.client;
    const user = this.userish(now);
    if (user && Math.abs(moved) > 1) this.direction = moved < 0 ? "up" : "down";
    if (user && moved < -0.5 && dist > 1) {
      this.pinned = false;
      return;
    }
    // A jump up we did not see a gesture for (iOS status-bar tap, find in page, assistive tech):
    // content changes never move the top up by this much while the end stays out of view.
    if (!user && moved < -JUMP && dist > NEAR_END) {
      this.pinned = false;
      return;
    }
    if (dist <= NEAR_END && !(this.held && moved < 0)) this.pin();
  }

  /** Should we write `scrollTop = end` now (content or viewport changed)? */
  shouldFollow(): boolean {
    if (!this.pinned) return false;
    if (this.held) {
      this.owed = true;
      return false;
    }
    return true;
  }

  /** We are about to scroll ourselves. */
  programmatic(now: number, smooth = false) {
    this.ignoreUntil = now + (smooth ? SMOOTH_IGNORE_MS : INSTANT_IGNORE_MS);
  }

  /** A smooth scroll ended early (`scrollend`). */
  settled() {
    this.ignoreUntil = 0;
  }

  /** New entries at the end. */
  appended(n: number) {
    if (n > 0 && !this.pinned) this.unseen += n;
  }

  pin() {
    this.pinned = true;
    this.unseen = 0;
  }

  /** The conversation changed (another session): start over. */
  reset() {
    this.pinned = true;
    this.unseen = 0;
    this.held = false;
    this.direction = null;
    this.ignoreUntil = 0;
    this.intentAt = -Infinity;
    this.momentumUntil = 0;
    this.lastTop = 0;
    this.owed = false;
  }
}

/** Binary search over items sorted by offset: index of the first one whose bottom edge is below `top`, or -1. */
export function firstVisible(n: number, at: (i: number) => { top: number; height: number }, top: number): number {
  let lo = 0;
  let hi = n - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const it = at(mid);
    if (it.top + it.height > top) {
      ans = mid;
      hi = mid - 1;
    } else lo = mid + 1;
  }
  return ans;
}

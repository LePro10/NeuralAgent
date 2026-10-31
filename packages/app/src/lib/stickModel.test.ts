import assert from "node:assert/strict";
import { test } from "node:test";
import { firstVisible, StickModel } from "../components/claude/stickModel.ts";

const at = (top: number, height = 2000, client = 500) => ({ top, height, client });

test("starts pinned and follows", () => {
  const m = new StickModel();
  assert.equal(m.pinned, true);
  assert.equal(m.shouldFollow(), true);
});

test("a small user scroll up unpins, however close to the end", () => {
  const m = new StickModel();
  m.scroll(at(1500), 0);
  m.intent(10, true);
  m.scroll(at(1490), 12);
  assert.equal(m.pinned, false);
  assert.equal(m.shouldFollow(), false);
  // new output does not move the reader, and is counted
  m.appended(2);
  assert.equal(m.unseen, 2);
});

test("a touch drag up unpins even before a scroll event", () => {
  const m = new StickModel();
  m.hold(0);
  m.intent(5, true);
  assert.equal(m.pinned, false);
});

test("content shrinking above (no user intent) does not unpin", () => {
  const m = new StickModel();
  m.scroll(at(1500), 0);
  m.scroll(at(1300, 1800), 5000);
  assert.equal(m.pinned, true);
});

test("scrolling back to the end by hand pins again and clears the count", () => {
  const m = new StickModel();
  m.scroll(at(1500), 0);
  m.intent(10, true);
  m.scroll(at(1000), 12);
  m.appended(3);
  m.intent(100, false);
  m.scroll(at(1495), 110);
  assert.equal(m.pinned, true);
  assert.equal(m.unseen, 0);
});

test("our own smooth scroll does not unpin itself half way", () => {
  const m = new StickModel();
  m.scroll(at(200), 0);
  m.intent(1, true);
  m.scroll(at(100), 2);
  assert.equal(m.pinned, false);
  m.pin();
  m.programmatic(1000, true);
  m.scroll(at(400), 1050);
  m.scroll(at(900), 1150);
  assert.equal(m.pinned, true);
});

test("the user fighting a smooth scroll wins", () => {
  const m = new StickModel();
  m.programmatic(0, true);
  m.intent(20, true);
  m.scroll(at(300), 30);
  assert.equal(m.pinned, false);
});

test("never follows while held; the follow is owed on release", () => {
  const m = new StickModel();
  m.hold(0);
  assert.equal(m.shouldFollow(), false);
  assert.equal(m.release(100), true);
  assert.equal(m.shouldFollow(), true);
  // nothing owed the second time
  assert.equal(m.release(200), false);
});

test("momentum after release still counts as the user", () => {
  const m = new StickModel();
  m.scroll(at(1500), 0);
  m.hold(0);
  m.release(10);
  m.scroll(at(1200), 900);
  assert.equal(m.pinned, false);
  assert.equal(m.direction, "up");
});

test("reset pins again", () => {
  const m = new StickModel();
  m.intent(0, true);
  m.appended(4);
  m.reset();
  assert.equal(m.pinned, true);
  assert.equal(m.unseen, 0);
});

test("firstVisible finds the entry crossing the top edge", () => {
  const items = [0, 100, 250, 400].map((top, i, a) => ({ top: top - 120, height: (a[i + 1] ?? 600) - top }));
  assert.equal(firstVisible(items.length, (i) => items[i]!, 0), 1);
  assert.equal(firstVisible(items.length, (i) => items[i]!, 1000), -1);
  assert.equal(firstVisible(0, () => ({ top: 0, height: 0 }), 0), -1);
});

test("a big jump up without a gesture (status-bar tap) unpins; a clamp after content shrinks does not", () => {
  const m = new StickModel();
  m.scroll({ top: 4000, height: 5000, client: 1000 }, 1000);
  m.scroll({ top: 0, height: 5000, client: 1000 }, 2000);
  assert.equal(m.pinned, false);
  const k = new StickModel();
  k.scroll({ top: 4000, height: 5000, client: 1000 }, 1000);
  k.scroll({ top: 3000, height: 4000, client: 1000 }, 2000);
  assert.equal(k.pinned, true);
});

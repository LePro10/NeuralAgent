import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectPlatform, HIDE_START, hideStep, keyboardState, neighbour, phoneToasts, type HideState, type ViewportSample } from './chrome.ts';

const base: ViewportSample = { platform: 'android', typing: true, innerHeight: 800, vvHeight: 800, vvOffsetTop: 0, full: 800, touch: true, userFocus: true };

test('android: geometry only, so Back-dismiss with focus kept reads closed', () => {
  assert.deepEqual(keyboardState({ ...base, innerHeight: 480, vvHeight: 480 }), { open: true, inset: 0 });
  // Keyboard hidden with Back: the field keeps focus, the layout is full height again.
  assert.deepEqual(keyboardState({ ...base }), { open: false, inset: 0 });
  // URL bar moving (small change) is not a keyboard.
  assert.equal(keyboardState({ ...base, innerHeight: 744, vvHeight: 744 }).open, false);
});

test('ios: overlay keyboard gives an inset', () => {
  const ios = { ...base, platform: 'ios' as const };
  assert.deepEqual(keyboardState({ ...ios, vvHeight: 480 }), { open: true, inset: 320 });
  assert.deepEqual(keyboardState({ ...ios, vvHeight: 480, vvOffsetTop: 40 }), { open: true, inset: 280 });
  // A hardware keyboard on an iPad: focused, nothing shrinks.
  assert.equal(keyboardState({ ...ios }).open, false);
});

test('nothing focused never counts as open', () => {
  assert.deepEqual(keyboardState({ ...base, typing: false, innerHeight: 480, vvHeight: 480 }), { open: false, inset: 0 });
});

test('other touch devices fall back to a tapped field', () => {
  const o = { ...base, platform: 'other' as const };
  assert.equal(keyboardState(o).open, true);
  assert.equal(keyboardState({ ...o, userFocus: false }).open, false);
  assert.equal(keyboardState({ ...o, touch: false }).open, false);
});

test('detectPlatform', () => {
  assert.equal(detectPlatform('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/140'), 'android');
  assert.equal(detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)'), 'ios');
  assert.equal(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5), 'ios');
  assert.equal(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0), 'other');
});

const run = (ys: number[], max = 2000): HideState => ys.slice(1).reduce((s, y) => hideStep(s, { y, max }), { ...HIDE_START, y: ys[0] });

test('hideStep: hides after a run down, returns on a shorter run up', () => {
  assert.equal(run([100, 110]).hidden, false);
  assert.equal(run([100, 110, 130]).hidden, true);
  assert.equal(run([100, 130, 125]).hidden, true);
  assert.equal(run([100, 130, 118]).hidden, false);
});

test('hideStep: always shown at the top and at the end', () => {
  assert.equal(run([100, 200, 4]).hidden, false);
  assert.equal(run([100, 200, 1996]).hidden, false);
  // Too short to scroll: never hides.
  assert.equal(run([0, 10, 20], 20).hidden, false);
});

test('phoneToasts keeps only the newest phone toast', () => {
  const list = [{ id: 1 }, { id: 2 }, { id: 3, desktopOnly: true }];
  assert.deepEqual(phoneToasts(list).map((t) => t.id), [2]);
  assert.deepEqual(phoneToasts([{ id: 1, desktopOnly: true }]), []);
});

test('phoneToasts: an Undo or error toast outranks a newer plain one', () => {
  const list = [{ id: 1, undo: () => {} }, { id: 2 }];
  assert.deepEqual(phoneToasts(list).map((t) => t.id), [1]);
  assert.deepEqual(phoneToasts([{ id: 1, tone: 'danger' }, { id: 2, tone: 'success' }]).map((t) => t.id), [1]);
  assert.deepEqual(phoneToasts([{ id: 1, undo: () => {} }, { id: 2, tone: 'danger' }, { id: 3 }]).map((t) => t.id), [2]);
});

test('neighbour', () => {
  assert.equal(neighbour(['a', 'b', 'c'], 'b', 1), 'c');
  assert.equal(neighbour(['a', 'b', 'c'], 'b', -1), 'a');
  assert.equal(neighbour(['a', 'b', 'c'], 'c', 1), null);
  assert.equal(neighbour(['a'], 'x', 1), null);
});

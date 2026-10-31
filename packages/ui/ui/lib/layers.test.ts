import assert from 'node:assert/strict';
import { test } from 'node:test';
import { closedOnTop } from './layers.ts';

test('two layers closing together leave in one step', () => {
  assert.equal(closedOnTop(['sheet', 'menu'], new Set(['sheet', 'menu'])), 2);
});

test('only closed layers on top count; an open one stops the count', () => {
  assert.equal(closedOnTop(['sheet', 'menu'], new Set(['menu'])), 1);
  assert.equal(closedOnTop(['sheet', 'menu'], new Set(['sheet'])), 0);
  assert.equal(closedOnTop([], new Set(['sheet'])), 0);
});

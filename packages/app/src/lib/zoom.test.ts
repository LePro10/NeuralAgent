import assert from "node:assert/strict";
import { test } from "node:test";
import { clampZoom, stepZoom, zoomKey, zoomLabel } from "./zoom.ts";

test("clampZoom keeps sizes in range and defaults to 100%", () => {
  assert.equal(clampZoom(undefined), 1);
  assert.equal(clampZoom("2"), 1);
  assert.equal(clampZoom(3), 1.5);
  assert.equal(clampZoom(0.2), 0.8);
  assert.equal(clampZoom(1.1000001), 1.1);
});

test("stepZoom walks the steps and stops at the ends", () => {
  assert.equal(stepZoom(1, 1), 1.1);
  assert.equal(stepZoom(1, -1), 0.9);
  assert.equal(stepZoom(1.5, 1), 1.5);
  assert.equal(stepZoom(0.8, -1), 0.8);
  assert.equal(stepZoom(1.05, 1), 1.1);
  assert.equal(stepZoom(1.05, -1), 1);
  assert.equal(zoomLabel(1.1), "110%");
});

test("zoomKey: ⌘ on macOS, Ctrl elsewhere, by typed character", () => {
  const k = (key: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean }>, code = "") => ({ key, code, metaKey: false, ctrlKey: false, altKey: false, ...mods });
  assert.equal(zoomKey(k("=", { metaKey: true }), true), 1);
  assert.equal(zoomKey(k("+", { metaKey: true }), true), 1);
  assert.equal(zoomKey(k("-", { metaKey: true }), true), -1);
  assert.equal(zoomKey(k("0", { metaKey: true }), true), 0);
  assert.equal(zoomKey(k("-", { ctrlKey: true }), true), null);
  assert.equal(zoomKey(k("-", { ctrlKey: true }), false), -1);
  assert.equal(zoomKey(k("0", { metaKey: true, altKey: true }), true), null);
  assert.equal(zoomKey(k("a", { metaKey: true }), true), null);
  assert.equal(zoomKey(k("", { ctrlKey: true }, "NumpadAdd"), false), 1);
});

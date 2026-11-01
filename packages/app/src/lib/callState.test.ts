import assert from "node:assert/strict";
import { test } from "node:test";
import { callSubtitle, micErrorText, noAnswerText, runningTime } from "./callState.ts";

test("connecting until the microphone is open and the computer listens", () => {
  assert.equal(callSubtitle({ live: true, ready: false, notice: undefined, seconds: 0 }), "Connecting…");
  assert.equal(callSubtitle({ live: false, ready: true, notice: undefined, seconds: 0 }), "Connecting…");
  assert.equal(callSubtitle({ live: true, ready: true, notice: undefined, seconds: 42 }), "0:42");
});

test("a dropped connection and silent audio say so", () => {
  assert.equal(callSubtitle({ live: true, ready: true, notice: "reconnecting", seconds: 42 }), "Reconnecting…");
  assert.equal(callSubtitle({ live: false, ready: false, notice: "reconnecting", seconds: null }), "Reconnecting…");
  assert.equal(callSubtitle({ live: true, ready: true, notice: "tap", seconds: 3 }), "Tap to turn the sound on");
});

test("a held call says why and how it comes back", () => {
  assert.equal(callSubtitle({ live: true, ready: true, notice: undefined, seconds: 42, held: "phone" }), "On hold during your phone call");
  assert.equal(callSubtitle({ live: true, ready: true, notice: "reconnecting", seconds: 42, held: "other" }), "On hold · tap to resume");
});

test("running time", () => {
  assert.equal(runningTime(0), "0:00");
  assert.equal(runningTime(725), "12:05");
  assert.equal(runningTime(3909), "1:05:09");
});

test("microphone failures in plain words", () => {
  assert.match(micErrorText({ name: "NotAllowedError" }), /Allow the microphone for this site/);
  assert.match(micErrorText({ name: "NotAllowedError" }, true), /Android settings/);
  assert.equal(micErrorText({ name: "NotFoundError" }), "No microphone found.");
  assert.match(micErrorText({ name: "NotReadableError" }), /busy/);
  assert.match(micErrorText({ name: "NoSecureContext" }), /https/);
  assert.match(micErrorText({ name: "WorkletError" }), /Reload/);
  assert.equal(micErrorText({ name: "Error", message: "boom" }), "The call could not start: boom");
  assert.match(noAnswerText(false), /Can't reach/);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { customize, currentOptions, DEFAULT_OPTIONS, elapsed, partyText, presenceLabel, presetOptions, PRESETS, STATS } from "./discord.ts";

test("presets mirror the daemon", () => {
  assert.equal(presetOptions("off"), null);
  assert.deepEqual(presetOptions("general"), { party: false, timer: true, button: true, project_names: false, details: "activity", state: "none", hover: "none" });
  assert.equal(presetOptions("detailed")?.project_names, true);
  assert.equal(presetOptions("stats")?.project_names, false, "Stats never names a project");
  assert.deepEqual(presetOptions("custom", { ...DEFAULT_OPTIONS, party: true }), { ...DEFAULT_OPTIONS, party: true });
  assert.deepEqual(
    PRESETS.map((p) => p.value),
    ["off", "general", "stats", "detailed", "custom"],
  );
  assert.ok(STATS.some((s) => s.value === "none"));
  assert.equal(presenceLabel("stats"), "Stats");
});

test("changing a part starts from the preset and turns it custom", () => {
  const next = customize({ discord_presence: "detailed" }, { state: "subagents" });
  assert.equal(next.discord_presence, "custom");
  assert.deepEqual(next.discord, { ...presetOptions("detailed")!, state: "subagents" });
  // Custom keeps its own choices.
  const again = customize({ discord_presence: "custom", discord: next.discord }, { party: true });
  assert.deepEqual(again.discord, { ...next.discord, party: true });
  // An old daemon without options: the defaults stand in.
  assert.deepEqual(currentOptions({ discord_presence: "custom" }), DEFAULT_OPTIONS);
  assert.deepEqual(currentOptions({ discord_presence: "off" }), presetOptions("general"));
});

test("timer and party read like Discord", () => {
  assert.equal(elapsed(100, 100_000 + 252_000), "04:12");
  assert.equal(elapsed(0, 3_729_000), "1:02:09");
  assert.equal(elapsed(500, 0), "00:00");
  assert.equal(partyText([2, 5]), "(2 of 5)");
  assert.equal(partyText(undefined), "");
});

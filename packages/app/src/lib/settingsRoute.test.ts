import assert from "node:assert/strict";
import { test } from "node:test";
import { matchesQuery, MOVED_TO_SETTINGS, requestSettingsSection, takeSettingsSection } from "./settingsRoute.ts";

test("old Remote and MCP routes map to Settings sections", () => {
  assert.equal(MOVED_TO_SETTINGS.__remote, "remote");
  assert.equal(MOVED_TO_SETTINGS.__mcp, "mcp");
  assert.equal(MOVED_TO_SETTINGS.__history, undefined);
});

test("a section request is taken once", () => {
  assert.equal(takeSettingsSection(), null);
  requestSettingsSection("mcp");
  assert.equal(takeSettingsSection(), "mcp");
  assert.equal(takeSettingsSection(), null);
});

test("settings search matches every word, any case", () => {
  const discord = "Discord rich presence status tokens streak";
  assert.ok(matchesQuery("", discord));
  assert.ok(matchesQuery("  Rich  ", discord));
  assert.ok(matchesQuery("discord streak", discord));
  assert.ok(!matchesQuery("discord sleep", discord));
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { apply } from "./apply.ts";
import type { State, Workspace } from "./gen/index.ts";

const empty: State = { workspaces: [], layouts: {}, sessions: {}, profiles: [], catalog: [], mcp: [],
    limits: [], remote: { status: "signed_out", relay: "", paused: false, devices: [] }, settings: { keep_awake: "while_working", resume_on_start: true, theme: "ice", discord_presence: "general", default_profile: "claude",
    llm: { provider: "neuralhub", base_url: "", model: "m", call_model: "" } }, orchestrator: { ready: false, keys: [], busy: false, messages: [] } };
const ws: Workspace = { id: "w1", name: "a", path: "/a", approved: true, pinned: false, order: 1, created_at: 0 };

test("upsert, then remove cascades", () => {
  let s = apply(empty, { e: "workspace_upsert", workspace: ws });
  s = apply(s, { e: "layout_set", workspace_id: "w1", layout: { tabs: [], active_tab: "" } });
  assert.equal(s.workspaces.length, 1);
  const s2 = apply(s, { e: "workspace_upsert", workspace: { ...ws, name: "b" } });
  assert.equal(s2.workspaces[0]!.name, "b");
  assert.notEqual(s2.workspaces, s.workspaces);
  assert.equal(s2.layouts, s.layouts, "untouched parts keep identity");
  const s3 = apply(s2, { e: "workspace_removed", id: "w1" });
  assert.equal(s3.workspaces.length, 0);
  assert.equal(s3.layouts["w1"], undefined);
});

test("orchestrator messages upsert by id", () => {
  const m = { id: "m1", role: "assistant" as const, text: "Hel", at: 1 };
  let s = apply(empty, { e: "orch_message", message: m });
  s = apply(s, { e: "orch_message", message: { ...m, text: "Hello" } });
  assert.equal(s.orchestrator.messages.length, 1);
  assert.equal(s.orchestrator.messages[0]!.text, "Hello");
  s = apply(s, { e: "orch_cleared" });
  assert.equal(s.orchestrator.messages.length, 0);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import type { AutopilotState, Connector, InboxItem, Pilot, Playbook } from "@neuralagent/protocol";
import {
  builderAgents,
  recoveryOptions,
  attentionCount,
  buildConfigure,
  effectiveAllow,
  formToSchedule,
  guideParts,
  inboxView,
  initialValues,
  missingFields,
  permissionSummary,
  playbookChanges,
  scheduleLabel,
  scheduleToForm,
  setAllow,
  statusLine,
  friendlyError,
  whenLabel,
} from "./autopilot.ts";

const item = (id: string, over: Partial<InboxItem> = {}): InboxItem => ({
  id, pilot_id: "p1", source: "discord", kind: "bug", title: id, summary: "", original: "", status: "new", urgency: 1, steps: [], created: 1, updated: 1, ...over,
});
const empty: AutopilotState = { pilots: [], items: [], messages: [], pending: [], suggestions: [], connectors: [], browser: { connected: false } };
const playbook = (over: Partial<Playbook> = {}): Playbook => ({ mission: "", instructions: "", tone: "", routines: [], sources: [], rules: [], notify: "needs_you", ...over });
const pilot = (over: Partial<Pilot> = {}): Pilot => ({ id: "p1", workspace_id: "w", name: "P", enabled: true, status: "idle", playbook: playbook(), setup_done: true, created: 0, ...over });

test("the inbox puts drafts and questions first, sorted by urgency", () => {
  const s: AutopilotState = {
    ...empty,
    items: [
      item("a", { urgency: 1, updated: 5 }),
      item("b", { status: "needs_you", urgency: 1 }),
      item("c", { draft: { text: "hi", connector_id: "d", tool: "reply", args: {} }, urgency: 3, status: "working" }),
      item("d", { status: "done", updated: 9 }),
      item("e", { status: "dismissed", updated: 10 }),
      item("x", { pilot_id: "other" }),
    ],
    pending: [{ id: "q", pilot_id: "p1", tool: "reply", summary: "s", args: {}, created: 1 }],
  };
  const open = inboxView(s, "p1", "open");
  assert.deepEqual(open.needs.map((i) => i.id), ["c", "b"]);
  assert.deepEqual(open.rest.map((i) => i.id), ["a"]);
  assert.equal(open.pending.length, 1);
  assert.deepEqual(open.counts, { open: 3, done: 2, needs: 3 });
  const done = inboxView(s, "p1", "done");
  assert.deepEqual(done.rest.map((i) => i.id), ["e", "d"]);
  assert.equal(done.needs.length, 0);
});

test("attention counts only pilots that exist", () => {
  const s: AutopilotState = { ...empty, pilots: [pilot()], items: [item("b", { status: "needs_you" }), item("z", { pilot_id: "gone", status: "needs_you" })], suggestions: [{ id: "s", pilot_id: "p1", reason: "", playbook: playbook(), created: 1 }] };
  assert.equal(attentionCount(s), 2);
  assert.equal(attentionCount(undefined), 0);
});

test("schedule labels read like words", () => {
  assert.equal(scheduleLabel({ kind: "every", minutes: 360 }), "Every 6 hours");
  assert.equal(scheduleLabel({ kind: "every", minutes: 60 }), "Every hour");
  assert.equal(scheduleLabel({ kind: "every", minutes: 45 }), "Every 45 minutes");
  assert.equal(scheduleLabel({ kind: "every", minutes: 1440 }), "Every day");
  assert.equal(scheduleLabel({ kind: "daily", at: "09:00" }), "Every day at 09:00");
  assert.equal(scheduleLabel({ kind: "weekly", day: 0, at: "08:30" }), "Every Monday at 08:30");
});

test("the schedule form round-trips and rejects nonsense", () => {
  for (const s of [{ kind: "every", minutes: 360 }, { kind: "every", minutes: 45 }, { kind: "daily", at: "07:15" }, { kind: "weekly", day: 4, at: "18:00" }] as const) {
    assert.deepEqual(formToSchedule(scheduleToForm(s)), s);
  }
  const f = scheduleToForm({ kind: "every", minutes: 60 });
  assert.equal(formToSchedule({ ...f, amount: "2", unit: "minutes" }), null);
  assert.equal(formToSchedule({ ...f, amount: "" }), null);
  assert.equal(formToSchedule({ ...f, kind: "daily", at: "25:00" }), null);
});

test("status line", () => {
  const now = new Date(2026, 10, 3, 12, 0).getTime();
  const at = new Date(2026, 10, 3, 14, 0).getTime();
  assert.equal(statusLine(pilot({ next_run: at }), now), "Idle, next run 14:00");
  assert.equal(statusLine(pilot({ status: "working", activity: "Reading Discord…" }), now), "Reading Discord…");
  assert.equal(statusLine(pilot({ enabled: false }), now), "Switched off");
  assert.equal(statusLine(pilot({ status: "needs_you" }), now), "Waiting for you");
  assert.equal(whenLabel(at + 86400000, now), "tomorrow 14:00");
});

const connector = (over: Partial<Connector> = {}): Connector => ({
  id: "discord",
  manifest: {
    name: "Discord", icon: "", description: "", kind: "service", version: "1", guide: [], events: [],
    tools: { list_channels: "read", add_reaction: "write", reply: "external" },
    setup: [
      { key: "token", label: "Bot token", type: "secret", required: true, options: [] },
      { key: "guild", label: "Server ID", type: "text", required: true, options: [] },
      { key: "channels", label: "Channels", type: "pick", from: "list_channels", required: false, options: [] },
      { key: "limit", label: "Limit", type: "number", required: false, options: [], default: 20 },
      { key: "bots", label: "Include bots", type: "bool", required: false, options: [] },
    ],
  },
  builtin: true, enabled: true, status: "running", build_stopped: false, can_restore: false, config: {}, secrets_set: [], tools: [], path: "/x", ...over,
});

test("permissions default by class and only custom choices are stored", () => {
  const c = connector();
  assert.deepEqual(effectiveAllow([], "discord", "list_channels", "read"), { allow: "auto", custom: false });
  assert.equal(effectiveAllow([], "discord", "reply", "external").allow, "ask");
  const r1 = setAllow([], "discord", "reply", "external", "auto");
  assert.deepEqual(r1, [{ connector_id: "discord", tool: "reply", allow: "auto" }]);
  assert.equal(effectiveAllow(r1, "discord", "reply", "external").allow, "auto");
  assert.deepEqual(setAllow(r1, "discord", "reply", "external", "ask"), []);
  const r2 = setAllow(r1, undefined, "start_agent", "write", "never");
  assert.equal(r2.length, 2);
  assert.equal(permissionSummary(r1, c), "2 on its own · 1 ask first");
});

test("the setup form: defaults, missing required fields and the payload", () => {
  const c = connector({ config: { guild: "42", channels: ["a"] }, secrets_set: [] });
  const v = initialValues(c);
  assert.equal(v.limit, 20);
  assert.deepEqual(v.channels, ["a"]);
  assert.equal("token" in v, false);
  assert.deepEqual(missingFields(c, v, {}), ["Bot token"]);
  assert.deepEqual(missingFields(c, v, { token: " x " }), []);
  assert.deepEqual(missingFields({ ...c, secrets_set: ["token"] }, v, {}), []);
  const out = buildConfigure(c, { ...v, limit: "30", bots: true }, { token: " secret " });
  assert.deepEqual(out.config, { guild: "42", channels: ["a"], limit: 30, bots: true });
  assert.deepEqual(out.secrets, { token: "secret" });
  assert.deepEqual(buildConfigure({ ...c, secrets_set: ["token"] }, v, {}).secrets, {});
  assert.deepEqual(buildConfigure({ ...c, secrets_set: ["token"] }, v, {}, ["token"]).secrets, { token: "" });
});

test("guide steps keep links apart and drop Markdown marks", () => {
  assert.deepEqual(guideParts("Open the [Developer Portal](https://discord.com/developers) and **create** a bot"), [
    { text: "Open the " },
    { text: "Developer Portal", href: "https://discord.com/developers" },
    { text: " and create a bot" },
  ]);
});

test("a suggestion lists only what changes", () => {
  const a = playbook({ mission: "An app", tone: "friendly" });
  const b = playbook({ mission: "An app", tone: "short", routines: [{ id: "r", task: "Read posts", schedule: { kind: "every", minutes: 360 }, enabled: true }] });
  const ch = playbookChanges(a, b);
  assert.deepEqual(ch.map((c) => c.label), ["How to talk to people", "Routines"]);
  assert.equal(ch[1]!.after, "Every 6 hours · Read posts");
  assert.equal(ch[1]!.before, "None");
});

test("the build agent list: installed coding agents, default first, no plain terminal", () => {
  const p = (id: string, engine: string, builtin = true) => ({ id, name: id, engine, command: id, args: [], env: {}, icon: "", builtin });
  const profiles = [p("shell", "shell"), p("claude", "claude"), p("codex", "codex"), p("gemini", "gemini"), p("mine", "custom", false)];
  const catalog = [{ id: "claude", installed: true }, { id: "codex", installed: true }, { id: "gemini", installed: false }] as never;
  assert.deepEqual(builderAgents(profiles, catalog, "codex").map((x) => x.id), ["codex", "claude", "mine"]);
  assert.deepEqual(builderAgents(undefined, undefined, "claude"), []);
});

test("the stopped-build card offers only what can work", () => {
  const base = { builtin: false, build_stopped: true, can_restore: false, last_request: "Read X" };
  assert.deepEqual(recoveryOptions(base, true), { show: true, retry: true, restore: false, reset: true });
  assert.deepEqual(recoveryOptions({ ...base, can_restore: true, last_request: undefined }, true), { show: true, retry: false, restore: true, reset: true });
  assert.deepEqual(recoveryOptions(base, false), { show: true, retry: false, restore: false, reset: false });
  assert.equal(recoveryOptions({ ...base, build_stopped: false }, true).show, false);
  assert.equal(recoveryOptions({ ...base, builtin: true }, true).show, false);
});

test("a raw 400 schema error becomes words and points at the one broken connector", () => {
  const broken = connector({ id: "mine", builtin: false, status: "error" });
  const e = friendlyError("400 [400]: tools.4.custom.input_schema: invalid", [connector({ id: "discord" }), broken]);
  assert.equal(e.title, "A connector sent something the AI could not read");
  assert.equal(e.connectorId, "mine");
  assert.ok(e.raw.includes("input_schema"));
  assert.equal(friendlyError("", []).title, "The autopilot ran into a problem");
});

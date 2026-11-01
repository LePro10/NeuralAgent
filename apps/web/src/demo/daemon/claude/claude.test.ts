// The intent matcher (pure) and a Claude session answering what a visitor types, through the protocol.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorld } from "../index.ts";
import { open, settle, snapshotOf, type Probe } from "../harness.ts";
import { matchIntent, topicOf } from "./intent.ts";

const NOW = Date.UTC(2026, 9, 31, 12, 0, 0);

test("intent: what a visitor types is read the way a person means it", () => {
  const k = (t: string, mode?: string) => matchIntent(t, mode).k;
  assert.equal(k("hi"), "greeting");
  assert.equal(k("thanks!"), "thanks");
  assert.equal(k("what can you do"), "help");
  assert.equal(k("/cost"), "slash");
  assert.deepEqual(matchIntent("/model opus"), { k: "slash", name: "model", args: "opus" });
  assert.deepEqual(matchIntent("!ls src"), { k: "shell", cmd: "ls src" });
  assert.equal(k("run the tests"), "tests");
  assert.equal(k("pnpm test"), "tests");
  assert.equal(k("are the tests passing?"), "tests");
  assert.equal(k("write a test for money rounding"), "writeTests");
  assert.deepEqual(matchIntent("explain how the webhook signature check works"), { k: "explain", topic: "signature" });
  assert.deepEqual(matchIntent("how do refunds work?"), { k: "explain", topic: "refund" });
  assert.equal(k("commit this"), "commit");
  assert.equal(k("review my changes"), "review");
  assert.equal(k("explore the repo with subagents"), "explore");
  assert.equal(k("start the dev server in the background"), "background");
  assert.deepEqual(matchIntent("add logging to the webhook handler"), { k: "change", recipe: "log-webhooks" });
  assert.deepEqual(matchIntent("add logging to the webhook handler", "plan"), { k: "plan", recipe: "log-webhooks" });
  assert.deepEqual(matchIntent("make a plan for a health check that checks the database"), { k: "plan", recipe: "health-db" });
  assert.deepEqual(matchIntent("limit the cart quantity to 99"), { k: "change", recipe: "cart-max" });
  // Not understood: say so instead of guessing.
  assert.equal(k("order me a pizza"), "unknown");
  assert.equal(k("   "), "unknown");
  assert.equal(topicOf("dead letter table"), "retry");
});

async function claudeIn(c: Probe, w: Awaited<ReturnType<typeof createWorld>>, project: string) {
  const st = snapshotOf(c);
  const ws = st.workspaces.find((x: any) => x.name === project);
  const r = await c.req("session_start", { workspace_id: ws.id, profile_id: "claude" });
  const sid = r.r.id as string;
  await w.clock.advance(3000);
  return sid;
}

/** The text of the newest assistant message that has some. */
const lastSaid = (msgs: any[]) => [...msgs].reverse().find((m) => m.role === "assistant" && m.blocks.some((b: any) => b.k === "text"))?.blocks.filter((b: any) => b.k === "text").map((b: any) => b.text).join("\n") ?? "";
const toolsOf = (msgs: any[]) => msgs.flatMap((m) => m.blocks.filter((b: any) => b.k === "tool_use").map((b: any) => b.name));

async function ask(c: Probe, w: Awaited<ReturnType<typeof createWorld>>, sid: string, text: string, ms = 90_000) {
  await c.req("session_prompt", { id: sid, text });
  for (let t = 0; t < ms; t += 500) {
    await w.clock.advance(500);
    await settle(1);
    const a = await c.req("cv_attach", { sid });
    if (!a.r.meta.busy && !a.r.prompt) return a.r;
    if (a.r.prompt) return a.r;
  }
  throw new Error("the turn did not end");
}

test("claude: explains the webhook signature after reading the real file", async () => {
  const w = await createWorld({ latency: 0, auto: false, now: NOW, scene: "idle" });
  const c = await open(w);
  const sid = await claudeIn(c, w, "billing-api");
  const res = await ask(c, w, sid, "Explain how the webhook signature check works");
  assert.ok(toolsOf(res.messages).includes("Read"), "it read a file");
  assert.match(lastSaid(res.messages), /HMAC/);
  assert.equal(res.meta.busy, false);
  w.dispose();
});

test("claude: an edit asks first, and Deny leaves the file alone", async () => {
  const w = await createWorld({ latency: 0, auto: false, now: NOW, scene: "idle" });
  const c = await open(w);
  const sid = await claudeIn(c, w, "billing-api");
  const before = (await c.req("cv_file", { sid, path: "src/routes/webhooks.ts" }, 4000)).r;
  const res = await ask(c, w, sid, "Add logging to the webhook handler");
  assert.ok(res.prompt, "a permission prompt is open");
  assert.equal(res.prompt.kind, "permission");
  assert.ok(res.prompt.options.some((o: any) => o.label === "Yes"));
  // A stale prompt id is refused.
  const stale = await c.req("cv_action", { sid, action: { k: "answer", n: "1", prompt_id: "nope" } });
  assert.equal(stale.err?.code, "bad_request");
  const last = String(res.prompt.options.length);
  const ok = await c.req("cv_action", { sid, action: { k: "answer", n: last, prompt_id: res.prompt.id } });
  assert.equal(ok.ok, true);
  await w.clock.advance(20_000);
  const after = (await c.req("cv_file", { sid, path: "src/routes/webhooks.ts" }, 4000)).r;
  assert.ok(before.text.length > 100);
  assert.equal(after.text, before.text);
  w.dispose();
});

test("claude: Allow edits the file and the tests run", async () => {
  const w = await createWorld({ latency: 0, auto: false, now: NOW, scene: "idle" });
  const c = await open(w);
  const sid = await claudeIn(c, w, "billing-api");
  const res = await ask(c, w, sid, "Add logging to the webhook handler");
  await c.req("cv_action", { sid, action: { k: "answer", n: "1", prompt_id: res.prompt.id } });
  let a = res;
  for (let i = 0; i < 160; i++) {
    await w.clock.advance(500);
    await settle(1);
    a = (await c.req("cv_attach", { sid })).r;
    if (a.prompt) await c.req("cv_action", { sid, action: { k: "answer", n: "1", prompt_id: a.prompt.id } });
    else if (!a.meta.busy) break;
  }
  const names = toolsOf(a.messages);
  assert.ok(names.includes("Edit"), "edited");
  assert.ok(names.includes("Bash"), "ran the tests");
  assert.match(lastSaid(a.messages), /webhook received/);
  const file = (await c.req("cv_file", { sid, path: "src/routes/webhooks.ts" }, 4000)).r;
  assert.match(file.text, /webhook received/);
  w.dispose();
});

test("claude: something it cannot do is said in character, with options that work", async () => {
  const w = await createWorld({ latency: 0, auto: false, now: NOW, scene: "idle" });
  const c = await open(w);
  const sid = await claudeIn(c, w, "web-shop");
  const res = await ask(c, w, sid, "order me a pizza");
  assert.match(lastSaid(res.messages), /pick one of these/i);
  assert.equal(res.prompt?.kind, "question");
  assert.ok(res.prompt.options.length >= 3);
  // Picking an option runs that skill.
  await c.req("cv_action", { sid, action: { k: "answer", n: "2", prompt_id: res.prompt.id } });
  let a = res;
  for (let i = 0; i < 160; i++) {
    await w.clock.advance(500);
    await settle(1);
    a = (await c.req("cv_attach", { sid })).r;
    if (a.prompt) await c.req("cv_action", { sid, action: { k: "answer", n: "1", prompt_id: a.prompt.id } });
    else if (!a.meta.busy && toolsOf(a.messages).includes("Bash")) break;
  }
  assert.ok(toolsOf(a.messages).includes("Bash"), "it ran something");
  w.dispose();
});

test("claude: slash commands change the meta and print their output", async () => {
  const w = await createWorld({ latency: 0, auto: false, now: NOW, scene: "idle" });
  const c = await open(w);
  const sid = await claudeIn(c, w, "billing-api");
  let res = await ask(c, w, sid, "/model opus");
  assert.match(res.meta.model, /opus/);
  res = await ask(c, w, sid, "/effort max");
  assert.equal(res.meta.effort, "max");
  res = await ask(c, w, sid, "/cost");
  assert.ok(res.messages.some((m: any) => m.kind === "output" && /Total cost/.test(m.blocks[0].text)));
  res = await ask(c, w, sid, "/clear");
  assert.ok(res.messages.length <= 1);
  w.dispose();
});

test("claude: a queued message waits for the turn, and Esc takes it back", async () => {
  const w = await createWorld({ latency: 0, auto: false, now: NOW, scene: "idle" });
  const c = await open(w);
  const sid = await claudeIn(c, w, "billing-api");
  await c.req("session_prompt", { id: sid, text: "Run the tests" });
  await w.clock.advance(1500);
  await c.req("session_prompt", { id: sid, text: "Explain refunds" });
  let a = (await c.req("cv_attach", { sid })).r;
  assert.equal(a.meta.queued?.length, 1);
  await c.req("cv_action", { sid, action: { k: "interrupt" } });
  a = (await c.req("cv_attach", { sid })).r;
  assert.equal(a.meta.queued?.length ?? 0, 0);
  assert.equal(a.meta.busy, false);
  w.dispose();
});

test("claude: older history is served in pages", async () => {
  const w = await createWorld({ latency: 0, auto: false, now: NOW, scene: "grid" });
  const c = await open(w);
  const st = snapshotOf(c);
  const sid = Object.values<any>(st.sessions).find((s) => s.profile_id === "claude" && s.cwd.endsWith("billing-api"))!.id;
  const a = (await c.req("cv_attach", { sid })).r;
  assert.ok(a.messages.length > 0);
  if (a.more) {
    const h = (await c.req("cv_history", { sid, before: a.messages[0].i })).r;
    assert.ok(h.messages.length > 0);
    assert.ok(h.messages.every((m: any) => m.i < a.messages[0].i));
  }
  w.dispose();
});

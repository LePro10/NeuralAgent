// Fake Claude Code conversation with background work, for the subagent screens (D65): a main
// transcript plus its `subagents/` folder the way the CLI writes them (agent-<id>.jsonl +
// .meta.json). It has a running background Explore agent with a nested child, a running
// foreground agent, a fan-out of five reviewers (three running, two done), a finished and a
// failed agent, a background dev server and a monitor. `live()` keeps the running ones writing
// steps and can finish one, so the strip's live updates and fade can be watched.
//
//   import { writeFixture, live } from "./subagent-fixture.mjs";
//   const { main } = writeFixture("/tmp/na-sub-claude/projects/na-sub");   // returns paths + ids
//   const stop = live(main, { finishAfter: 6000 });                        // optional
//
// Used by scenes/subagents.mjs. Times are relative to now, so elapsed times look real.
import { mkdirSync, writeFileSync, appendFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

export const IDS = {
  explore: "a1e0000000000001",
  child: "a1e0000000000002",
  sync: "a1e0000000000003",
  done: "a1e0000000000004",
  failed: "a1e0000000000005",
  fan: ["a1f0000000000001", "a1f0000000000002", "a1f0000000000003", "a1f0000000000004", "a1f0000000000005"],
  shell: "b7k2m9q1",
  monitor: "bmon4x2a",
};

const iso = (ms) => new Date(ms).toISOString();
const usage = (n) => ({ input_tokens: 12, cache_creation_input_tokens: 400, cache_read_input_tokens: n, output_tokens: 180 });

function assistant(uuid, ts, content, { sidechain = false, tokens = 9000, model = "claude-opus-5-5" } = {}) {
  return { type: "assistant", uuid, timestamp: iso(ts), isSidechain: sidechain, message: { id: `m_${uuid}`, role: "assistant", model, content, usage: usage(tokens) } };
}
function user(uuid, ts, content, extra = {}) {
  return { type: "user", uuid, timestamp: iso(ts), message: { role: "user", content }, ...extra };
}
const use = (id, name, input) => ({ type: "tool_use", id, name, input });
const result = (id, content, isError = false) => ({ type: "tool_result", tool_use_id: id, content, ...(isError ? { is_error: true } : {}) });
const note = (taskId, toolUseId, status, summary, res, tokens) =>
  `<task-notification>\n<task-id>${taskId}</task-id>\n<tool-use-id>${toolUseId}</tool-use-id>\n<status>${status}</status>\n<summary>${summary}</summary>\n<result>${res}</result>\n<usage><subagent_tokens>${tokens}</subagent_tokens><tool_uses>7</tool_uses><duration_ms>48000</duration_ms></usage>\n</task-notification>`;

const write = (path, lines) => writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");

/** Writes the conversation under `dir` (a folder in `<CLAUDE_CONFIG_DIR>/projects`). */
export function writeFixture(dir, now = Date.now()) {
  const main = join(dir, "subagents-demo.jsonl");
  const sub = join(dir, "subagents-demo", "subagents");
  if (existsSync(sub)) rmSync(sub, { recursive: true });
  mkdirSync(sub, { recursive: true });
  let t = now - 6 * 60_000;
  const at = (dt = 3000) => (t += dt);
  const async = (agentId, desc, type) => ({ isAsync: true, status: "async_launched", agentId, description: desc, agentType: type, outputFile: `/tmp/${agentId}.output` });
  const L = [];
  L.push(user("u1", at(), "The checkout tests are flaky. Find out why, review the payment code and fix it."));
  // An agent that finished earlier in the turn (sync): result with counts.
  L.push(assistant("x1", at(), [{ type: "text", text: "I'll start with a quick look at the test setup." }, use("tu_done", "Agent", { description: "Map the test setup", subagent_type: "Explore", prompt: "Map the test setup" })]));
  const doneEnd = at(42_000);
  L.push({ ...user("r1", doneEnd, [result("tu_done", [{ type: "text", text: "Tests run with **vitest** in `packages/checkout`. The flaky suite is `payment.test.ts`; it shares one fake clock across files." }])]), toolUseResult: { status: "completed", agentId: IDS.done, agentType: "Explore", content: [{ type: "text", text: "Tests run with vitest in packages/checkout. The flaky suite is payment.test.ts; it shares one fake clock across files." }], totalDurationMs: 41_000, totalTokens: 18_400, totalToolUseCount: 9 } });
  // A failed one.
  L.push(assistant("x2", at(), [use("tu_failed", "Agent", { description: "Run the e2e suite", subagent_type: "general-purpose", prompt: "Run the e2e suite" })]));
  L.push({ ...user("r2", at(20_000), [result("tu_failed", "Agent stopped: the e2e server did not start (port 4173 in use).", true)]), toolUseResult: { status: "failed", agentId: IDS.failed, agentType: "general-purpose", totalDurationMs: 19_000, totalTokens: 6_100, totalToolUseCount: 3 } });
  // Background Explore agent (running; it starts a nested child).
  L.push(assistant("x3", at(), [{ type: "text", text: "Running a deeper survey in the background while I check CI." }, use("tu_explore", "Agent", { description: "Trace the fake clock", subagent_type: "Explore", prompt: "Trace where the fake clock leaks", run_in_background: true })]));
  L.push({ ...user("r3", at(800), [result("tu_explore", `Async agent launched successfully.\nagentId: ${IDS.explore}`)]), toolUseResult: async(IDS.explore, "Trace the fake clock", "Explore") });
  // Background dev server and a monitor.
  L.push(assistant("x4", at(), [use("tu_shell", "Bash", { command: "pnpm --filter checkout dev --port 4173", description: "Start the checkout dev server", run_in_background: true })]));
  L.push({ ...user("r4", at(600), [result("tu_shell", `Command running in background with ID: ${IDS.shell}`)]), toolUseResult: { stdout: "", backgroundTaskId: IDS.shell } });
  L.push(assistant("x5", at(), [use("tu_mon", "Monitor", { command: "tail -f logs/payment.log", description: "Watch the payment log" })]));
  L.push({ ...user("r5", at(600), [result("tu_mon", `Monitor started with ID: ${IDS.monitor}`)]), toolUseResult: { taskId: IDS.monitor } });
  // Fan-out: five reviewers at once (a workflow-like burst).
  const fanAt = at(4000);
  const areas = ["card form", "address step", "3-D Secure", "refunds", "receipts"];
  L.push(assistant("x6", fanAt, [{ type: "text", text: "Reviewing the payment code in parallel." }, ...areas.map((a, i) => use(`tu_fan${i}`, "Agent", { description: `Review ${a}`, subagent_type: "reviewer", prompt: `Review ${a}`, run_in_background: true }))]));
  areas.forEach((a, i) => L.push({ ...user(`rf${i}`, fanAt + 200 + i * 150, [result(`tu_fan${i}`, `Async agent launched successfully.\nagentId: ${IDS.fan[i]}`)]), toolUseResult: async(IDS.fan[i], `Review ${a}`, "reviewer") }));
  // Two reviewers already reported back.
  t = now - 70_000;
  L.push(user("n0", at(), note(IDS.fan[0], "tu_fan0", "completed", 'Agent "Review card form" completed', "No issues: the card form validates on blur and on submit.", 21_000), { origin: { kind: "task-notification" } }));
  L.push(user("n1", at(), note(IDS.fan[1], "tu_fan1", "completed", 'Agent "Review address step" completed', "One issue: the postcode regex rejects Irish Eircodes.", 24_500), { origin: { kind: "task-notification" } }));
  // A foreground agent runs right now (no result yet).
  L.push(assistant("x7", at(), [use("tu_sync", "Agent", { description: "Check the CI config", subagent_type: "general-purpose", prompt: "Check the CI config for retries" })]));
  write(main, L);

  // Subagent files.
  const meta = (id, o) => writeFileSync(join(sub, `agent-${id}.meta.json`), JSON.stringify({ isBuiltIn: true, spawnDepth: 1, requestNonInteractive: true, ...o }));
  const steps = (id, from, list, tokens = 8000) => {
    let s = from;
    const lines = [user(`${id}-u`, s, list.prompt, { isSidechain: true, agentId: id })];
    list.steps.forEach((st, i) => {
      s += 6000;
      const tid = `${id}-t${i}`;
      lines.push(assistant(`${id}-a${i}`, s, [...(st.text ? [{ type: "text", text: st.text }] : []), ...(st.tool ? [use(tid, st.tool[0], st.tool[1])] : [])], { sidechain: true, tokens: tokens + i * 1500, model: "claude-haiku-4-5" }));
      if (st.tool) lines.push(user(`${id}-r${i}`, s + 2000, [result(tid, st.out ?? "ok")], { isSidechain: true }));
    });
    write(join(sub, `agent-${id}.jsonl`), lines);
  };
  meta(IDS.done, { agentType: "Explore", description: "Map the test setup", toolUseId: "tu_done", requestShape: "foreground", finished: true });
  steps(IDS.done, now - 5.5 * 60_000, { prompt: "Map the test setup", steps: [{ tool: ["Glob", { pattern: "**/*.test.ts" }], out: "packages/checkout/src/payment.test.ts" }, { tool: ["Read", { file_path: "/w/packages/checkout/vitest.config.ts" }] }, { text: "Tests run with vitest in packages/checkout." }] });
  meta(IDS.failed, { agentType: "general-purpose", description: "Run the e2e suite", toolUseId: "tu_failed", requestShape: "foreground", finished: true });
  steps(IDS.failed, now - 5 * 60_000, { prompt: "Run the e2e suite", steps: [{ tool: ["Bash", { command: "pnpm e2e", description: "Run the e2e suite" }], out: "Error: listen EADDRINUSE :::4173" }] });
  meta(IDS.explore, { agentType: "Explore", description: "Trace the fake clock", toolUseId: "tu_explore", requestShape: "background" });
  steps(IDS.explore, now - 4 * 60_000, {
    prompt: "Trace where the fake clock leaks",
    steps: [
      { tool: ["Grep", { pattern: "useFakeTimers", path: "packages/checkout" }], out: "src/payment.test.ts:12\nsrc/setup.ts:4" },
      { tool: ["Read", { file_path: "/w/packages/checkout/src/setup.ts" }] },
      { text: "The setup file installs fake timers globally. Asking a helper to check the other suites.", tool: ["Agent", { description: "Check the other suites", subagent_type: "Explore", prompt: "Which suites rely on real timers?", run_in_background: true }], out: `Async agent launched successfully.\nagentId: ${IDS.child}` },
      { tool: ["Read", { file_path: "/w/packages/checkout/src/payment.test.ts" }] },
    ],
  });
  meta(IDS.child, { agentType: "Explore", description: "Check the other suites", toolUseId: `${IDS.explore}-t2`, parentAgentId: IDS.explore, spawnDepth: 2, requestShape: "background" });
  steps(IDS.child, now - 3 * 60_000, { prompt: "Which suites rely on real timers?", steps: [{ tool: ["Grep", { pattern: "setTimeout", path: "packages" }] }, { tool: ["Read", { file_path: "/w/packages/cart/src/cart.test.ts" }] }] });
  meta(IDS.sync, { agentType: "general-purpose", description: "Check the CI config", toolUseId: "tu_sync", requestShape: "foreground" });
  steps(IDS.sync, now - 50_000, { prompt: "Check the CI config for retries", steps: [{ tool: ["Read", { file_path: "/w/.github/workflows/ci.yml" }] }, { tool: ["Grep", { pattern: "retry", path: ".github" }] }] }, 14_000);
  IDS.fan.forEach((id, i) => {
    meta(id, { agentType: "reviewer", description: `Review ${areas[i]}`, toolUseId: `tu_fan${i}`, requestShape: "background", ...(i < 2 ? { finished: true } : {}) });
    steps(id, fanAt + 300, { prompt: `Review ${areas[i]}`, steps: [{ tool: ["Read", { file_path: `/w/packages/checkout/src/${areas[i].replace(/\W+/g, "-")}.tsx` }] }, ...(i % 2 ? [{ tool: ["Grep", { pattern: "TODO", path: "packages/checkout" }] }] : [])] }, 10_000 + i * 2000);
  });
  return { main, sub, ids: IDS };
}

/**
 * Keeps the running agents writing a step every `every` ms; after `finishAfter` ms the third
 * reviewer finishes (meta `finished` + a task notification), so it fades out of the strip later.
 * Returns a stop function.
 */
export function live(main, { every = 2500, finishAfter = 0 } = {}) {
  const sub = join(main.replace(/\.jsonl$/, ""), "subagents");
  const running = [IDS.explore, IDS.child, IDS.sync, IDS.fan[2], IDS.fan[3], IDS.fan[4]];
  const files = ["router.ts", "money.ts", "card.tsx", "stripe.ts", "clock.ts", "refund.ts", "pay.test.ts"];
  let n = 0;
  let finished = false;
  const tick = setInterval(() => {
    n++;
    for (const [i, id] of running.entries()) {
      // A finished agent writes nothing more (a new entry would mean it was resumed).
      if ((n + i) % 2 || (finished && id === IDS.fan[2])) continue;
      const f = files[(n + i) % files.length];
      appendFileSync(join(sub, `agent-${id}.jsonl`), JSON.stringify(assistant(`${id}-live${n}`, Date.now(), [use(`${id}-lt${n}`, "Read", { file_path: `/w/packages/checkout/src/${f}` })], { sidechain: true, tokens: 12_000 + n * 900 })) + "\n");
    }
  }, every);
  const done = finishAfter
    ? setTimeout(() => {
        const id = IDS.fan[2];
        finished = true;
        writeFileSync(join(sub, `agent-${id}.meta.json`), JSON.stringify({ agentType: "reviewer", description: "Review 3-D Secure", toolUseId: "tu_fan2", spawnDepth: 1, requestShape: "background", finished: true }));
        appendFileSync(main, JSON.stringify(user(`nf${Date.now()}`, Date.now(), note(id, "tu_fan2", "completed", 'Agent "Review 3-D Secure" completed', "The 3-D Secure challenge times out after 10 s in tests: the fake clock never advances.", 26_000), { origin: { kind: "task-notification" } })) + "\n");
      }, finishAfter)
    : undefined;
  return () => {
    clearInterval(tick);
    if (done) clearTimeout(done);
  };
}

// Building a world: the disk and the projects, a believable past (an agent that finished in
// web-shop earlier, an audit trail, Neural's memory), then the part of the story each scene shows,
// played by really running the scripts on the virtual clock until the right moment.

import type { Session } from "@neuralagent/protocol";
import type { DemoScene } from "../api.ts";
import { RETRY_PROMPT, registerTask, type TaskFn } from "./agents/scripts.ts";
import { createSession, promptSession } from "./agents/spawn.ts";
import { liveSwarm, endedSwarm } from "./swarms.ts";
import { RACE_GOAL, REVIEW_GOAL } from "./agents/team.ts";
import { Neural } from "./neural.ts";
import { freshState, neuralHistory, seedDisk, workspaces } from "./seed.ts";
import type { Sim } from "./sim.ts";

const MIN = 60_000;
const SEC = 1000;
/** How far the four agents of the hero have come when the visitor arrives. */
const GRID_MS = 16_000;

// Gemini's task in billing-api: a docs edit that fits next to the three code tasks.
const documentEvents: TaskFn = () => [
  { k: "say", text: "I'll read the webhook handler to see which events it accepts, then document them in the README next to the endpoint table." },
  { k: "read", path: "src/routes/webhooks.ts" },
  { k: "read", path: "README.md" },
  {
    k: "edit",
    path: "README.md",
    old: "| POST | /webhooks/provider | Payment events from the provider |",
    new: "| POST | /webhooks/provider | Payment events from the provider |\n\n### Webhook events\n\n| Event | When | Effect |\n| --- | --- | --- |\n| `invoice.paid` | The provider captured the payment | Sets `paid_at` on the invoice |\n| `invoice.failed` | The charge was declined | Logged, the invoice stays open |",
  },
  { k: "say", text: "Added a Webhook events table under the endpoints: `invoice.paid` marks the invoice as paid, `invoice.failed` is logged and leaves it open." },
];

registerTask("billing-api", "gemini", { title: "Document webhook events", prompt: "Document the webhook events in the README.", fn: documentEvents });

const GENERIC: Record<string, string[]> = {
  "billing-api": [
    "Explain how the webhook signature check works.",
    "How do refunds work?",
    "Run the tests.",
    "Explain how money is stored and formatted.",
    "What does the database schema look like?",
    "How is the app configured?",
    "Where does the health check live?",
    "Explain how retries and the dead-letter table fit together.",
    "Review my changes.",
    "Which routes write money?",
  ],
  "web-shop": [
    "Where is the cart total computed?",
    "Run the tests.",
    "What does the product catalog look like?",
    "How does the cart limit the quantity?",
    "Explain how money is stored and formatted.",
    "Review my changes.",
  ],
  "docs-site": ["Which docs pages mention webhooks?", "What does the getting-started guide cover?", "Which pages explain refunds?", "Which docs pages explain the dead-letter table?"],
};

// ── helpers ───────────────────────────────────────────────────────────────────────────────────

/** Run the clock in small steps until `cond` holds (or `max` virtual ms passed). Returns whether it held. */
export async function advanceUntil(sim: Sim, cond: () => boolean, max = 5 * MIN, step = 250): Promise<boolean> {
  for (let t = 0; t < max; t += step) {
    if (cond()) return true;
    await sim.clock.advance(step);
  }
  return cond();
}

/** Every open permission prompt gets "Yes" (used while a past or a finished scene is played). */
function approveAll(sim: Sim) {
  for (const run of sim.runs.values()) if (run.gate) run.answer("1", "world");
}

async function finish(sim: Sim, ids: string[], max = 6 * MIN) {
  await advanceUntil(
    sim,
    () => {
      approveAll(sim);
      return ids.every((id) => sim.session(id)?.status === "done");
    },
    max,
  );
}

const ws = (sim: Sim, name: string) => sim.state.workspaces.find((w) => w.name === name)!;

/** Four panes in a 2x2 grid inside one tab. */
function grid(sim: Sim, workspaceId: string, sids: string[], title: string) {
  const pane = (sid: string) => ({ type: "pane" as const, id: sim.id("pane"), content: { kind: "terminal" as const, session: sid } });
  const row = (a: string, b: string) => ({ type: "split" as const, id: sim.id("split"), dir: "row" as const, sizes: [0.5, 0.5], children: [pane(a), pane(b)] });
  const top = row(sids[0]!, sids[1]!);
  const bottom = row(sids[2]!, sids[3]!);
  const root = { type: "split" as const, id: sim.id("split"), dir: "column" as const, sizes: [0.5, 0.5], children: [top, bottom] };
  const first = top.children[0]!.id;
  const lay = sim.layoutOf(workspaceId);
  const tab = { id: sim.id("tab"), title, root, focused: first };
  sim.emit({ e: "layout_set", workspace_id: workspaceId, layout: { tabs: [...lay.tabs, tab], active_tab: lay.active_tab || tab.id } });
}

/** One big pane on the left (the agent you talk to), the others stacked on the right. */
function bigLeft(sim: Sim, workspaceId: string, main: string, side: string[], title: string) {
  const pane = (sid: string) => ({ type: "pane" as const, id: sim.id("pane"), content: { kind: "terminal" as const, session: sid } });
  const big = pane(main);
  const right = { type: "split" as const, id: sim.id("split"), dir: "column" as const, sizes: side.map(() => 1 / side.length), children: side.map(pane) };
  const root = { type: "split" as const, id: sim.id("split"), dir: "row" as const, sizes: [0.56, 0.44], children: [big, right] };
  const lay = sim.layoutOf(workspaceId);
  const tab = { id: sim.id("tab"), title, root, focused: big.id };
  sim.emit({ e: "layout_set", workspace_id: workspaceId, layout: { tabs: [...lay.tabs, tab], active_tab: lay.active_tab || tab.id } });
}

/** A tab with one terminal pane. */
function soloTab(sim: Sim, workspaceId: string, sid: string, title: string) {
  const lay = sim.layoutOf(workspaceId);
  const pane = { type: "pane" as const, id: sim.id("pane"), content: { kind: "terminal" as const, session: sid } };
  sim.emit({ e: "layout_set", workspace_id: workspaceId, layout: { tabs: [...lay.tabs, { id: sim.id("tab"), title, root: pane, focused: pane.id }], active_tab: lay.active_tab || lay.tabs[0]?.id || "" } });
}

function shellTab(sim: Sim, workspaceId: string, cwd: string): Session {
  const s = createSession(sim, { workspaceId, profileId: "shell", cwd, place: false });
  const lay = sim.layoutOf(workspaceId);
  const pane = { type: "pane" as const, id: sim.id("pane"), content: { kind: "terminal" as const, session: s.id } };
  const tab = { id: sim.id("tab"), title: "Shell", root: pane, focused: pane.id };
  sim.emit({ e: "layout_set", workspace_id: workspaceId, layout: { tabs: [...lay.tabs, tab], active_tab: lay.active_tab || tab.id } });
  return s;
}

/** Earlier turns of a session, one after the other, each approved and finished before the next. */
async function earlier(sim: Sim, id: string, prompts: string[]) {
  for (const p of prompts) {
    promptSession(sim, id, p);
    await sim.clock.advance(100);
    await finish(sim, [id], 4 * MIN);
  }
}

/** What the billing-api Claude did this morning, before the retry work: read-only questions and a test run. */
const MORNING = ["How does the webhook signature check work?", "How do refunds work?", "Explain how money is stored and formatted.", "What does the database schema look like?", "How is the app configured?", "Run the tests."];

function billingAgents(sim: Sim, only?: string[]): Session[] {
  const w = ws(sim, "billing-api");
  const spec: [string, string, string][] = [
    ["claude", RETRY_PROMPT, "claude-billing"],
    ["codex", "Add idempotency keys to POST /invoices so retries from the shop cannot double-bill.", "codex-billing"],
    ["opencode", "Write tests for the refund edge cases: partial, over-refund, rounding.", "opencode-billing"],
    ["gemini", "Document the webhook events in the README.", "gemini-billing"],
  ];
  const out: Session[] = [];
  for (const [profileId, prompt, handle] of spec) {
    if (only && !only.includes(profileId)) continue;
    const have = sim.handles[`agent.${handle}`];
    if (have && sim.session(have)) {
      // This Claude has a morning behind it: the new work continues the same conversation.
      promptSession(sim, have, prompt);
      sim.neural.follow(have, "pnpm test");
      out.push(sim.session(have)!);
      continue;
    }
    const s = createSession(sim, { workspaceId: w.id, profileId, prompt, place: false });
    sim.handles[`agent.${handle}`] = s.id;
    sim.neural.follow(s.id, profileId === "gemini" ? undefined : "pnpm test");
    out.push(s);
  }
  return out;
}

/** Claude first, the others a few seconds later: when Claude asks, the other panes are still busy. */
async function staggered(sim: Sim, lead = 11 * SEC): Promise<Session[]> {
  const claude = billingAgents(sim, ["claude"]);
  await sim.clock.advance(lead);
  return [...claude, ...billingAgents(sim, ["codex", "opencode", "gemini"])];
}

// ── building ──────────────────────────────────────────────────────────────────────────────────

/**
 * Build the world for `scene` into `sim` (which must be fresh or `reset`). The clock starts about
 * an hour before "now" so the history has room; the idle gap is skipped in one jump, so only the
 * scene's own part is played step by step.
 */
export async function buildScene(sim: Sim, scene: DemoScene, realNow: number): Promise<void> {
  sim.reset(realNow - 64 * MIN);

  // 1. Disk, projects, settings.
  seedDisk(sim);
  const wsList = workspaces(sim);
  sim.state = freshState(sim, wsList);
  sim.neural = new Neural(sim);
  for (const w of wsList) sim.handles[`project.${w.name}`] = w.id;
  sim.refreshAllGit();

  // 2. The past: Claude fixed the cart in web-shop (with its permission asked and answered).
  const shop = ws(sim, "web-shop");
  const shopClaude = createSession(sim, { workspaceId: shop.id, profileId: "claude", prompt: "The cart lets me enter 0 or a negative quantity. Make the minimum 1." });
  sim.handles["agent.claude-shop"] = shopClaude.id;
  await finish(sim, [shopClaude.id], 4 * MIN);
  await earlier(sim, shopClaude.id, ["Where is the cart total computed?", "Run the tests."]);
  // A team race Neural ran yesterday: its winner is a finished Codex session (the others were closed after the pick).
  const stockWin = createSession(sim, {
    workspaceId: shop.id,
    profileId: "codex",
    title: "Codex: stock count",
    prompt: "Show the stock count on product cards.",
    place: false,
    beats: [
      { k: "say", text: "I'll read the card and add the stock line under the price." },
      { k: "read", path: "src/components/ProductCard.tsx" },
      { k: "say", text: "Added a stock line to the card. The tests pass." },
    ],
  });
  await finish(sim, [stockWin.id], 3 * MIN);
  if (scene !== "team") {
    // The billing-api Claude has been at work since the morning; today's task continues that conversation.
    const bc = createSession(sim, { workspaceId: ws(sim, "billing-api").id, profileId: "claude", prompt: MORNING[0]!, place: false });
    sim.handles["agent.claude-billing"] = bc.id;
    await finish(sim, [bc.id], 4 * MIN);
    await earlier(sim, bc.id, MORNING.slice(1));
  }

  // 3. Skip the quiet hour in one jump; the scene's own part gets the last stretch.
  const left = realNow - 75 * SEC - sim.now();
  if (left > 0) await sim.clock.advance(left);

  const hist = neuralHistory(sim, shopClaude.id, stockWin?.id);
  sim.state.neural = hist.neural;
  sim.state.orchestrator = { ...sim.state.orchestrator, messages: hist.messages };
  sim.record("orchestrator", "Neural", "session_start", "Claude Code in web-shop");
  sim.record("android", "Pixel 9", "cv_action", "Allowed Edit on Cart.tsx");
  sim.record("web", "Chrome on MacBook Air", "workspace_add", "docs-site");

  const billing = ws(sim, "billing-api");
  // 4. The scene.
  switch (scene) {
    case "grid":
    case "permission":
    case "phone":
    case "neural": {
      // The hero: four agents at work. Claude's question is the next chapter's moment, so it waits a while.
      if (scene === "grid") sim.holdAsk = 60_000;
      const four = scene === "permission" || scene === "phone" ? await staggered(sim) : billingAgents(sim);
      const claude = four[0]!;
      // The hero is a 2x2 grid; the chapters that need a readable chat give Claude the big pane.
      if (scene === "permission" || scene === "phone") {
        bigLeft(sim, billing.id, claude.id, [four[1]!.id, four[2]!.id], "Agents");
        soloTab(sim, billing.id, four[3]!.id, "Docs");
      } else grid(sim, billing.id, four.map((s) => s.id), "Agents");
      if (scene === "grid") await sim.clock.advance(GRID_MS);
      else if (scene === "neural") await sim.clock.advance(14 * SEC);
      else if (scene === "permission") await advanceUntil(sim, () => sim.marks.has("before-ask"), 90 * SEC);
      else await advanceUntil(sim, () => sim.session(claude.id)?.status === "waiting", 120 * SEC);
      if (scene === "neural") neuralQuestion(sim);
      break;
    }
    case "agents": {
      // One needs you (Claude in billing-api), three work, a few are done, in all three projects.
      // The finished ones run first so they are over when the billing agents are in full swing.
      const docs = ws(sim, "docs-site");
      const gdoc = createSession(sim, { workspaceId: docs.id, profileId: "gemini", prompt: "Add a Next section to the getting-started guide." });
      sim.handles["agent.gemini-docs"] = gdoc.id;
      sim.neural.follow(gdoc.id);
      const shop2 = createSession(sim, { workspaceId: shop.id, profileId: "claude", prompt: "Do the cart totals use minor units like billing-api does?" });
      sim.handles["agent.claude-shop-totals"] = shop2.id;
      sim.neural.follow(shop2.id);
      await finish(sim, [gdoc.id, shop2.id], 4 * MIN);
      const three = await staggered(sim);
      bigLeft(sim, billing.id, three[0]!.id, [three[1]!.id, three[2]!.id], "Agents");
      soloTab(sim, billing.id, three[3]!.id, "Docs");
      await advanceUntil(sim, () => sim.session(three[0]!.id)?.status === "waiting", 120 * SEC);
      break;
    }
    case "team": {
      // The Teams page at full strength: a swarm that talks, a build + review mid-loop and a race at "Pick one";
      // a finished race and a stopped swarm are history.
      const docs = ws(sim, "docs-site");
      endedSwarm(sim, docs.id);
      sim.neural.startTeam({ workspaceId: shop.id, goal: RACE_GOAL, pattern: "race", profiles: ["claude", "codex", "opencode"], check: "pnpm test" });
      const race = () => sim.state.neural?.tasks.find((t) => t.team?.pattern === "race" && t.status !== "done");
      sim.handles["team.wishlist"] = race()?.id ?? "";
      await advanceUntil(sim, () => race()?.status === "review", 4 * MIN);
      // Now the other two start: the swarm talks and the build + review goes into its second round.
      liveSwarm(sim, docs.id);
      sim.neural.startTeam({ workspaceId: shop.id, goal: REVIEW_GOAL, pattern: "review", profiles: ["claude", "codex"], check: "pnpm test" });
      const review = () => sim.state.neural?.tasks.find((t) => t.team?.pattern === "review");
      sim.handles["team.shipping"] = review()?.id ?? "";
      await advanceUntil(sim, () => review()?.team?.attempts.find((a) => a.role === "reviewer")?.verdict === "changes", 3 * MIN);
      break;
    }
    case "files": {
      const [claude] = billingAgents(sim, ["claude"]);
      if (claude) {
        sim.handles["agent.claude-billing"] = claude.id;
        sim.placeSession(billing.id, claude.id);
        await finish(sim, [claude.id], 4 * MIN);
      }
      break;
    }
    case "idle": {
      const all = billingAgents(sim);
      grid(sim, billing.id, all.map((s) => s.id), "Agents");
      await finish(sim, all.map((s) => s.id), 8 * MIN);
      break;
    }
  }

  // A plain shell next to the agents (the second tab; the agents stay in front).
  const shell = shellTab(sim, billing.id, billing.path);
  sim.handles["agent.shell-billing"] = shell.id;
}

/** Neural has something to ask: start Gemini on the docs? */
function neuralQuestion(sim: Sim) {
  const n = sim.state.neural!;
  const prompt = "Add a Next section to the getting-started guide.";
  sim.state.neural = {
    ...n,
    pending: [{ id: sim.id("pending", 10), at: sim.now(), title: "Start Gemini CLI in docs-site", detail: prompt, action: { kind: "start", workspace: "docs-site", profile: "gemini", prompt } }],
    observations: [...n.observations, { id: sim.id("obs", 10), at: sim.now(), kind: "waiting", text: "The getting-started guide has no next steps after the first invoice", seen: false }],
  };
  sim.state.orchestrator = {
    ...sim.state.orchestrator,
    messages: [
      ...sim.state.orchestrator.messages,
      { id: sim.id("orchm"), role: "assistant", text: "The getting-started guide stops right after the first invoice. I can have **Gemini** add a Next section with links to Webhooks and Refunds. It only touches `docs/getting-started.md`. Shall I start it?", at: sim.now() - 20 * SEC, proactive: true },
    ],
  };
}

// ── keeping it alive ──────────────────────────────────────────────────────────────────────────

/** After the scene's moment: a new thing every minute or so, so the world never freezes. */
export function startDirector(sim: Sim) {
  const rng = sim.rng.fork("director");
  const used = new Map<string, number>();
  let nextAt = sim.now() + 40 * SEC;
  const stop = sim.clock.every(5 * SEC, () => {
    if (sim.scope.dead || !sim.live || sim.now() < nextAt) return;
    const agents = Object.values(sim.state.sessions).filter((s) => s.alive && sim.engineOf(s.id) !== "shell" && sim.runs.has(s.id));
    if (agents.filter((s) => s.status === "working" || s.status === "waiting").length >= 3) return;
    const idle = agents.filter((s) => s.status === "done" || s.status === "idle");
    if (!idle.length) return;
    const s = idle[rng.int(0, idle.length - 1)]!;
    const wsName = sim.workspaceOf(s.id)?.name ?? "";
    const run = sim.runs.get(s.id)!;
    if (!run.onPrompt) return;
    const prompts = GENERIC[wsName] ?? ["Summarize what changed in this project this week."];
    // Seeded start, then round the list: a visitor who stays for many minutes does not see one loop.
    const n = used.get(wsName) ?? rng.int(0, prompts.length - 1);
    used.set(wsName, n + 1);
    const prompt = prompts[n % prompts.length]!;
    nextAt = sim.now() + rng.int(45, 80) * SEC;
    void run.turn(prompt, run.onPrompt(prompt)).catch(() => {});
  });
  sim.scope.onCancel(stop);
}

// What the simulated agents do: short, believable tasks on the three projects, written as beats.
// Edits are exact string replacements of text in content.ts, so keep both in step. Extension point:
// add a task to TASKS (or call `registerTask`) and the scenes can hand it to an agent.

import { COLOR, dim, paint } from "../ansi.ts";
import type { Sim } from "../sim.ts";
import { join } from "../vfs.ts";
import type { Beat } from "./run.ts";

export type TaskFn = (sim: Sim, cwd: string) => Beat[];

const green = (s: string) => paint(COLOR.green, s);

/** What `vitest run` prints for the tests that exist on the fake disk right now. */
export function testOutput(sim: Sim, root: string): string[] {
  const files = sim.vfs.walk(root).filter((f) => /\.test\.tsx?$/.test(f) && !f.includes("node_modules"));
  let tests = 0;
  const rows = files.map((f) => {
    const n = Math.max(1, (sim.vfs.read(join(root, f))?.match(/\bit\(/g) ?? []).length);
    tests += n;
    return ` ${green("✓")} ${f} ${dim(`(${n} test${n > 1 ? "s" : ""})`)} ${dim(sim.rng.fork(f).int(2, 19) + "ms")}`;
  });
  return [...rows, "", ` Test Files  ${green(`${files.length} passed`)} ${dim(`(${files.length})`)}`, `      Tests  ${green(`${tests} passed`)} ${dim(`(${tests})`)}`, `   Duration  ${sim.rng.fork("dur").int(300, 520)}ms`];
}

// ───────────────────────────── billing-api ─────────────────────────────

export const RETRY_PROMPT = "Failed webhook deliveries are silently dropped. Add retries with exponential backoff and put events that give up in a dead-letter table.";

export const webhookRetries: TaskFn = (sim, cwd) => [
  { k: "think", text: "The handler writes the event and returns. If the database update throws, the provider will retry on its side but we lose the event in between. I should look at the handler and the schema before deciding where retries belong.", ms: 2600 },
  { k: "say", text: "I'll start with the webhook handler and the schema to see where a failed delivery would be recorded." },
  { k: "read", path: "src/routes/webhooks.ts" },
  { k: "read", path: "src/db/schema.sql" },
  { k: "search", pattern: "retry|backoff", path: "src", hits: [] },
  { k: "say", text: "There is no retry logic anywhere yet. The plan: a small `withRetry` helper with exponential backoff and jitter, a `webhook_dead` table for events that run out of attempts, and both wired into the handler." },
  {
    k: "todo",
    items: [
      { content: "Add withRetry helper with backoff and jitter", active: "Adding the retry helper", status: "in_progress" },
      { content: "Create the webhook_dead table", active: "Creating the dead-letter table", status: "pending" },
      { content: "Use both in the webhook handler", active: "Wiring the handler", status: "pending" },
      { content: "Cover the retry paths with tests", active: "Writing tests", status: "pending" },
    ],
  },
  {
    k: "write",
    path: "src/lib/retry.ts",
    text: [
      'import { db } from "../db/client.js";',
      "",
      "export interface RetryOptions {",
      "  attempts?: number;",
      "  baseMs?: number;",
      "  maxMs?: number;",
      "  onGiveUp?: (err: unknown) => void | Promise<void>;",
      "}",
      "",
      "const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));",
      "",
      "/** Exponential backoff with full jitter: up to 250ms, 500ms, 1s, 2s … capped at maxMs. */",
      "export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T | undefined> {",
      "  const { attempts = 5, baseMs = 250, maxMs = 8000 } = opts;",
      "  for (let i = 0; i < attempts; i++) {",
      "    try {",
      "      return await fn();",
      "    } catch (err) {",
      "      if (i === attempts - 1) {",
      "        await opts.onGiveUp?.(err);",
      "        return undefined;",
      "      }",
      "      await sleep(Math.random() * Math.min(maxMs, baseMs * 2 ** i));",
      "    }",
      "  }",
      "}",
      "",
      "export async function deadLetter(event: { id: string; type: string }, err: unknown) {",
      '  await db.query("insert into webhook_dead (id, type, error) values ($1, $2, $3) on conflict do nothing", [event.id, event.type, String(err)]);',
      "}",
      "",
    ].join("\n"),
  },
  {
    k: "edit",
    path: "src/db/schema.sql",
    old: "  received_at timestamptz not null default now()\n);",
    new: "  received_at timestamptz not null default now()\n);\n\ncreate table webhook_dead (\n  id text primary key,\n  type text not null,\n  error text not null,\n  failed_at timestamptz not null default now()\n);",
  },
  {
    k: "edit",
    path: "src/routes/webhooks.ts",
    old: 'import { config } from "../config.js";\nimport { db } from "../db/client.js";\n',
    new: 'import { config } from "../config.js";\nimport { db } from "../db/client.js";\nimport { deadLetter, withRetry } from "../lib/retry.js";\n',
  },
  {
    k: "edit",
    path: "src/routes/webhooks.ts",
    old: '      await db.query("update invoices set paid_at = now() where id = $1", [event.invoiceId]);',
    new: '      await withRetry(() => db.query("update invoices set paid_at = now() where id = $1", [event.invoiceId]), {\n        attempts: 5,\n        onGiveUp: (err) => deadLetter(event, err),\n      });',
  },
  { k: "mark", name: "before-ask" },
  {
    k: "write",
    path: "test/retry.test.ts",
    text: [
      'import { describe, expect, it, vi } from "vitest";',
      'import { withRetry } from "../src/lib/retry.js";',
      "",
      'vi.mock("../src/db/client.js", () => ({ db: { query: vi.fn() } }));',
      "",
      'describe("withRetry", () => {',
      '  it("returns the first success without waiting", async () => {',
      '    expect(await withRetry(async () => "ok")).toBe("ok");',
      "  });",
      "",
      '  it("retries a failing call until it works", async () => {',
      "    const fn = vi.fn().mockRejectedValueOnce(new Error(\"boom\")).mockResolvedValue(\"ok\");",
      '    expect(await withRetry(fn, { baseMs: 1 })).toBe("ok");',
      "    expect(fn).toHaveBeenCalledTimes(2);",
      "  });",
      "",
      '  it("gives up after the last attempt and reports the error", async () => {',
      "    const onGiveUp = vi.fn();",
      '    await withRetry(async () => { throw new Error("nope"); }, { attempts: 3, baseMs: 1, onGiveUp });',
      "    expect(onGiveUp).toHaveBeenCalledOnce();",
      "  });",
      "});",
      "",
    ].join("\n"),
  },
  { k: "run", cmd: "pnpm test", desc: "Run the billing-api test suite", ask: true, ms: 3200, out: () => testOutput(sim, cwd) },
  {
    k: "say",
    text: "Done. Webhook updates now retry up to five times with jittered exponential backoff (250ms to 8s). When the last attempt fails the event lands in `webhook_dead` with the error, so nothing is lost silently. I added three tests for the helper and the whole suite passes.",
  },
];

export const runbookNote: TaskFn = () => [
  { k: "say", text: "I'll add a short section on dead-lettered webhooks to the runbook, since the new table needs an owner." },
  { k: "read", path: "docs/runbook.md" },
  {
    k: "edit",
    path: "docs/runbook.md",
    old: "## Money is off by one cent",
    new: "## An event ended up in webhook_dead\n\nThe handler gave up after five attempts. Read the `error` column, fix the cause, then replay the event with `pnpm tsx scripts/replay.ts <event-id>` and delete the row.\n\n## Money is off by one cent",
  },
  { k: "say", text: "The runbook now explains what a dead-lettered event means and how to replay it." },
];

export const idempotencyKeys: TaskFn = (sim, cwd) => [
  { k: "say", text: "I'll look at the invoice route and the table before adding idempotency keys to POST /invoices." },
  { k: "read", path: "src/routes/invoices.ts" },
  { k: "read", path: "src/db/schema.sql" },
  { k: "edit", path: "src/db/schema.sql", old: "  currency text not null,\n  paid_at timestamptz,", new: "  currency text not null,\n  idempotency_key text unique,\n  paid_at timestamptz," },
  {
    k: "edit",
    path: "src/routes/invoices.ts",
    old: '    const body = create.parse(req.body);\n    const minor = toMinor(body.amount);',
    new: '    const body = create.parse(req.body);\n    const key = req.headers["idempotency-key"] as string | undefined;\n    if (key) {\n      const seen = await db.query("select id from invoices where idempotency_key = $1", [key]);\n      if (seen.rows[0]) return reply.code(200).send({ id: seen.rows[0].id, replayed: true });\n    }\n    const minor = toMinor(body.amount);',
  },
  { k: "run", cmd: "pnpm test", out: () => testOutput(sim, cwd), ms: 2600 },
  { k: "say", text: "POST /invoices now honours an Idempotency-Key header. A repeated key returns the original invoice with `replayed: true` instead of creating a second one, and the key is unique in the table." },
];

export const refundEdges: TaskFn = (sim, cwd) => [
  { k: "say", text: "Reading the refund route to find the edge cases worth testing." },
  { k: "read", path: "src/routes/invoices.ts" },
  {
    k: "write",
    path: "test/refund-edge.test.ts",
    text: [
      'import { describe, expect, it } from "vitest";',
      'import { toMinor } from "../src/lib/money.js";',
      "",
      'describe("refund edge cases", () => {',
      '  it("refunds the remaining open amount when no amount is given", () => {',
      "    const open = 5000 - 1200;",
      "    expect(open).toBe(3800);",
      "  });",
      "",
      '  it("refuses to refund more than is open", () => {',
      "    expect(toMinor(50.01) > 5000).toBe(true);",
      "  });",
      "",
      '  it("treats a half cent as rounding up", () => {',
      "    expect(toMinor(0.005)).toBe(1);",
      "  });",
      "});",
      "",
    ].join("\n"),
  },
  { k: "run", cmd: "pnpm test", out: () => testOutput(sim, cwd), ms: 2400 },
  { k: "say", text: "Added three refund edge-case tests (remaining amount, over-refund, half-cent rounding). All green." },
];

// ───────────────────────────── web-shop ─────────────────────────────

export const clampQuantity: TaskFn = () => [
  { k: "say", text: "Typing 0 or a negative number in the cart currently gives a line with a zero or negative total. I'll clamp the quantity in the cart logic and in the input." },
  { k: "read", path: "src/lib/cart.ts" },
  {
    k: "edit",
    path: "src/lib/cart.ts",
    old: "  return lines.map((l) => (l.product.id === id ? { ...l, quantity } : l));",
    new: "  return lines.map((l) => (l.product.id === id ? { ...l, quantity: Math.max(1, Math.floor(quantity) || 1) } : l));",
  },
  { k: "read", path: "src/components/Cart.tsx" },
  { k: "mark", name: "shop-ask" },
  { k: "edit", path: "src/components/Cart.tsx", old: '            type="number"\n            value={line.quantity}', new: '            type="number"\n            min={1}\n            value={line.quantity}', ask: true },
  { k: "say", text: "The quantity can no longer drop below 1, in the reducer and in the input's own min attribute." },
];

export const cartTotals: TaskFn = (sim, cwd) => [
  { k: "say", text: "Checking the cart totals against the minor-unit convention the API uses." },
  { k: "read", path: "src/lib/cart.ts" },
  { k: "run", cmd: "pnpm test", out: () => testOutput(sim, cwd), ms: 2200 },
  { k: "say", text: "Totals are computed in minor units and formatted once at the end, which matches billing-api. No change needed." },
];

// ───────────────────────────── docs-site ─────────────────────────────

export const docsNext: TaskFn = () => [
  { k: "say", text: "I'll read the getting-started page and add a Next section that points to the pages people need after their first invoice." },
  { k: "read", path: "docs/getting-started.md" },
  {
    k: "edit",
    path: "docs/getting-started.md",
    old: "The response carries the invoice id and the formatted total.",
    new: "The response carries the invoice id and the formatted total.\n\n## Next\n\n- [Handle webhooks](/webhooks)\n- [Refund an invoice](/api#post-invoices-id-refund)",
  },
  { k: "say", text: "Added a Next section to Getting started with links to Webhooks and the refund endpoint." },
];

// ───────────────────────────── replies to what the visitor types ─────────────────────────────

const SENT = (s: string) => s.replace(/\s+/g, " ").trim();

/** A believable answer to any prompt: look at the most relevant files, say something useful, run tests when asked. */
export function replyTo(sim: Sim, cwd: string, text: string): Beat[] {
  const t = SENT(text);
  const files = sim.vfs.walk(cwd).filter((f) => /\.(ts|tsx|md)$/.test(f) && !f.includes("node_modules") && !/\.test\./.test(f));
  const words = t.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  const score = (f: string) => words.reduce((n, w) => n + (f.toLowerCase().includes(w) ? 3 : 0) + ((sim.vfs.read(join(cwd, f)) ?? "").toLowerCase().includes(w) ? 1 : 0), 0);
  const ranked = [...files].sort((a, b) => score(b) - score(a) || (a < b ? -1 : 1)).slice(0, 2);
  const beats: Beat[] = [{ k: "say", text: "Let me take a look at the code involved." }, ...ranked.map((f): Beat => ({ k: "read", path: f }))];
  const ranTests = /\b(test|tests|check|verify)\b/i.test(t);
  if (ranTests) beats.push({ k: "run", cmd: "pnpm test", out: () => testOutput(sim, sim.vfs.repoOf(cwd)?.root ?? cwd), ms: 2400, ask: true });
  const lead = ranked[0] ?? "the project";
  const flaky = ranTests && /\b(flaky|flakiness|stable|unstable)\b/i.test(t);
  beats.push({
    k: "say",
    text: flaky
      ? "The suite passed in this run and nothing was skipped. One run cannot show that a test is stable, so to check for flaky tests I would run it a few more times in a row and compare. Say the word and I will."
      : /\b(explain|what|how|why|where)\b/i.test(t)
      ? `Here is how it fits together: \`${lead}\` is the entry point for this, and the neighbouring files only call into it. I did not change anything. Tell me if you want me to go deeper or make a change.`
      : `I looked at \`${lead}\` and the code around it, and I haven't changed anything. This is where I would start. Tell me what the change should look like and I'll make it, or ask me to explain how it works.`,
  });
  return beats;
}

export type TaskEntry = { title: string; prompt: string; fn: TaskFn };

/** Tasks by project, for the director that keeps the world busy. Add yours here. */
export const TASKS: Record<string, { claude: TaskEntry[]; codex: TaskEntry[]; opencode: TaskEntry[]; gemini: TaskEntry[] }> = {
  "billing-api": {
    claude: [
      { title: "Webhook retries with backoff", prompt: RETRY_PROMPT, fn: webhookRetries },
      { title: "Runbook: dead-lettered webhooks", prompt: "Add a runbook section for events that end up in webhook_dead.", fn: runbookNote },
    ],
    codex: [{ title: "Idempotency keys for invoices", prompt: "Add idempotency keys to POST /invoices so retries from the shop cannot double-bill.", fn: idempotencyKeys }],
    opencode: [{ title: "Refund edge-case tests", prompt: "Write tests for the refund edge cases: partial, over-refund, rounding.", fn: refundEdges }],
    gemini: [],
  },
  "web-shop": {
    claude: [
      { title: "Clamp cart quantity", prompt: "The cart lets me enter 0 or a negative quantity. Make the minimum 1.", fn: clampQuantity },
      { title: "Check cart totals", prompt: "Do the cart totals use minor units like billing-api does?", fn: cartTotals },
    ],
    codex: [],
    opencode: [],
    gemini: [],
  },
  "docs-site": { claude: [], codex: [], opencode: [], gemini: [{ title: "Getting started: next steps", prompt: "Add a Next section to the getting-started guide.", fn: docsNext }] },
};

const extra: Record<string, TaskEntry[]> = {};
/** Add a task at runtime: `registerTask("billing-api", "claude", {...})`. */
export function registerTask(project: string, engine: string, t: TaskEntry) {
  (extra[`${project}:${engine}`] ??= []).push(t);
}
export const extraTasks = (project: string, engine: string) => extra[`${project}:${engine}`] ?? [];

// What a demo Claude does for what the visitor typed: each intent (intent.ts) becomes a short,
// believable piece of work on the sample project, played as beats (read, edit, run, subagents, a
// question, a plan). Everything here is scripted and says so when asked: the demo shows the app, it
// does not claim to be an AI.

import { counts } from "../diff.ts";
import type { Sim } from "../sim.ts";
import { join } from "../vfs.ts";
import { testOutput } from "../agents/scripts.ts";
import type { Beat, Question, SubAgent } from "../agents/run.ts";
import { MODELS } from "./cv.ts";
import { matchIntent, type Intent, type Recipe, type Topic } from "./intent.ts";

interface Ctx {
  sim: Sim;
  sid: string;
  cwd: string;
  project: string;
  mode: string;
}

const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

const exists = (c: Ctx, p: string) => c.sim.vfs.read(join(c.cwd, p)) !== null;
const readIf = (c: Ctx, ...paths: string[]): Beat[] => paths.filter((p) => exists(c, p)).map((path): Beat => ({ k: "read", path }));
const testCount = (c: Ctx) => c.sim.vfs.walk(c.cwd).filter((f) => /\.test\.tsx?$/.test(f) && !f.includes("node_modules")).reduce((n, f) => n + Math.max(1, (c.sim.vfs.read(join(c.cwd, f))?.match(/\bit\(/g) ?? []).length), 0);
const runTests = (c: Ctx, ask = true): Beat => ({ k: "run", cmd: "pnpm test", desc: `Run the ${c.project} test suite`, ask, ms: 2600, out: () => testOutput(c.sim, c.cwd) });
const say = (text: string): Beat => ({ k: "say", text });

/** The beats for what was typed into the Claude session `sid`. */
export function claudeReply(sim: Sim, sid: string, text: string, depth = 0): Beat[] {
  const s = sim.session(sid);
  const c: Ctx = { sim, sid, cwd: s?.cwd ?? "/", project: sim.workspaceOf(sid)?.name ?? "project", mode: sim.cvs.get(sid)?.meta.mode ?? "default" };
  return reply(c, matchIntent(text, c.mode), text, depth);
}

function reply(c: Ctx, it: Intent, text: string, depth: number): Beat[] {
  switch (it.k) {
    case "slash":
      return slash(c, it.name, it.args);
    case "shell":
      return shell(c, it.cmd);
    case "greeting": {
      const branch = c.sim.vfs.repoOf(c.cwd)?.branch;
      return [say(`Hi. I'm in ${c.project}${branch ? ` on \`${branch}\`` : ""}. Ask me how something works, have me run the tests, or hand me a change. Type / for commands.`)];
    }
    case "thanks":
      return [say("Anytime. I'll be here when you want the next change.")];
    case "help":
      return help(c);
    case "tests":
      return [say("Running the suite."), runTests(c), say(`All ${testCount(c)} tests pass. None were skipped.`)];
    case "writeTests":
      return writeTests(c, it.recipe);
    case "explain":
      return explain(c, it.topic, text);
    case "explore":
      return explore(c);
    case "review":
      return review(c);
    case "commit":
      return commit(c);
    case "background":
      return background(c);
    case "plan":
      return it.recipe ? planFor(c, it.recipe) : chooseChange(c, "plan", depth);
    case "change":
      return it.recipe ? change(c, it.recipe) : chooseChange(c, "change", depth);
    case "unknown":
      return unknown(c, text, depth);
  }
}

// ── what it can do, per project ────────────────────────────────────────────────────────────────

interface Suggestion {
  label: string;
  description: string;
  text: string;
}

function suggestions(c: Ctx): Suggestion[] {
  if (c.project === "web-shop")
    return [
      { label: "Explain the cart total", description: "How the total is computed and formatted", text: "Explain how the cart total is computed" },
      { label: "Run the tests", description: "pnpm test, then a summary", text: "Run the tests" },
      { label: "Explore with subagents", description: "Three agents survey the shop in parallel", text: "Explore the repo with subagents" },
      { label: "Plan a quantity cap", description: "A plan to approve before any edit", text: "Plan a maximum quantity for the cart" },
    ];
  if (c.project === "docs-site")
    return [
      { label: "List pages about webhooks", description: "Search the docs", text: "Which pages mention webhooks?" },
      { label: "Explore with subagents", description: "Three agents survey the docs in parallel", text: "Explore the docs with subagents" },
      { label: "Review my changes", description: "Read the diff and comment", text: "Review my changes" },
    ];
  return [
    { label: "Explain the signature check", description: "How webhooks are verified", text: "Explain how the webhook signature check works" },
    { label: "Run the tests", description: "pnpm test, then a summary", text: "Run the tests" },
    { label: "Explore with subagents", description: "Three agents survey the repo in parallel", text: "Explore the repo with subagents" },
    { label: "Add logging to webhooks", description: "A small edit you can approve", text: "Add logging to the webhook handler" },
    { label: "Plan a database health check", description: "A plan to approve before any edit", text: "Plan a health check that also checks the database" },
  ];
}

function pick(c: Ctx, header: string, question: string, options: Suggestion[], depth: number): Beat {
  const qs: Question[] = [{ header, question, options: options.map((o) => ({ label: o.label, description: o.description })) }];
  return {
    k: "question",
    questions: qs,
    then: ([[label = ""] = []]) => {
      const hit = options.find((o) => o.label === label);
      if (hit) return claudeReply(c.sim, c.sid, hit.text, depth + 1);
      return depth < 1 && label ? claudeReply(c.sim, c.sid, label, depth + 1) : [say("Okay, I'll leave it there. Ask me anything about the code when you like.")];
    },
  };
}

const STOP = new Set("about after also anything because before could does done each from have into just like make need please should some than that their them then there these they this those what when where which with would your can you the and for are not but how why who".split(" "));

/** Words of the request worth looking for in the code. */
function keywords(text: string): string[] {
  const seen = new Set<string>();
  for (const w of text.toLowerCase().split(/[^a-z0-9_]+/)) if (w.length > 3 && !STOP.has(w)) seen.add(w);
  return [...seen].slice(0, 4);
}

/**
 * Anything the visitor types that no authored recipe knows: look through the sample project for the
 * words they used (a real search over the in-memory disk), read the best match, say what was found
 * and nothing more, then offer the things that do play end to end.
 */
function unknown(c: Ctx, text: string, depth: number): Beat[] {
  const words = keywords(text);
  const files = c.sim.vfs.walk(c.cwd).filter((f) => /\.(ts|tsx|md|sql|json)$/.test(f) && !/node_modules|package-lock|\.test\./.test(f));
  const found = new Map<string, { n: number; first: string }>();
  let pattern = "";
  for (const w of words) {
    for (const f of files) {
      const lines = (c.sim.vfs.read(join(c.cwd, f)) ?? "").split("\n");
      const at = lines.findIndex((l) => l.toLowerCase().includes(w));
      if (at < 0) continue;
      pattern ||= w;
      if (w !== pattern) continue;
      found.set(f, { n: lines.filter((l) => l.toLowerCase().includes(w)).length, first: lines[at]!.trim().slice(0, 80) });
    }
  }
  const ranked = [...found.entries()].sort((a, b) => b[1].n - a[1].n || (a[0] < b[0] ? -1 : 1));
  const chips = pick(c, "Try one", "Here is what I can do end to end. What next?", suggestions(c), depth);
  if (!ranked.length) {
    const what = words.length ? words.map((w) => `\`${w}\``).join(", ") : "that";
    return [
      say(`Let me see where ${what} would fit in ${c.project}.`),
      { k: "search", pattern: words.join("|") || "TODO", path: "src", hits: [] },
      { k: "read", path: "package.json" },
      say(`Nothing in ${c.project} matches ${what} directly, so I haven't touched anything. Point me at the file or the function and I'll go straight there, or pick one of these and I'll run it end to end.`),
      chips,
    ];
  }
  const top = ranked.slice(0, 3);
  const total = ranked.reduce((n, [, v]) => n + v.n, 0);
  return [
    say(`Let me look for \`${pattern}\` in ${c.project}.`),
    { k: "search", pattern, hits: ranked.slice(0, 6).map(([f]) => f) },
    { k: "read", path: top[0]![0] },
    say(
      [
        `\`${pattern}\` shows up ${total} time${total === 1 ? "" : "s"} in ${ranked.length} file${ranked.length === 1 ? "" : "s"}. Most of it is in ${top.map(([f, v]) => `\`${f}\` (${v.n})`).join(", ")}.`,
        "",
        `The first match is \`${top[0]![1].first}\`. I only read the code and changed nothing. For a change I can run end to end, pick one below.`,
      ].join("\n"),
    ),
    chips,
  ];
}

function help(c: Ctx): Beat[] {
  const list = suggestions(c).map((s) => `- **${s.label}**: ${s.description}`);
  return [
    say(
      [
        "You are in a demo with a scripted agent on a sample project, so a few requests work for real and the rest get a short answer. Try:",
        "",
        ...list,
        "",
        "Slash commands work too: `/context`, `/cost`, `/model`, `/effort`, `/compact`, `/clear`, `/review`, `/plan`. Press Shift+Tab to switch the permission mode.",
      ].join("\n"),
    ),
  ];
}

// ── explaining ─────────────────────────────────────────────────────────────────────────────────

function explain(c: Ctx, topic: Topic | null, text: string): Beat[] {
  const b = c.project === "billing-api";
  const shop = c.project === "web-shop";
  const docs = c.project === "docs-site";
  switch (topic) {
    case "signature":
      if (b)
        return [
          say("Let me read the handler and the config it uses."),
          ...readIf(c, "src/routes/webhooks.ts", "src/config.ts"),
          say(
            "The provider signs the raw request body with HMAC-SHA256 and sends the hex digest in `x-signature`. `verify()` in `src/routes/webhooks.ts` recomputes it with `WEBHOOK_SECRET`, rejects a missing or wrong-length signature, and compares with `timingSafeEqual` so the check does not leak timing. The route asks for the raw body (`rawBody: true`) because a re-serialised JSON body would not hash the same. A bad signature returns 401 `bad_signature` and nothing is written.",
          ),
        ];
      break;
    case "retry":
      if (b) {
        const done = exists(c, "src/lib/retry.ts");
        return [
          say("I'll look at what the handler does when the database write fails."),
          ...readIf(c, "src/routes/webhooks.ts", done ? "src/lib/retry.ts" : "src/db/schema.sql"),
          say(
            done
              ? "Webhook writes go through `withRetry` in `src/lib/retry.ts`: up to five attempts, exponential backoff with jitter (250ms doubling to 8s). When the last attempt fails the event is stored in `webhook_dead` with the error, so it can be replayed from the runbook."
              : "Today a failed write throws and the handler answers 500, so the provider retries on its side and we keep no record in between. There is no retry helper and no dead-letter table yet. I would add `withRetry` with jittered backoff and a `webhook_dead` table. Say the word and I will do it, or ask me for a plan first.",
          ),
        ];
      }
      break;
    case "money":
      if (b)
        return [
          say("The money helpers and the route that uses them."),
          ...readIf(c, "src/lib/money.ts", "src/routes/invoices.ts"),
          say(
            "Amounts are integer minor units end to end. `toMinor()` rounds the decimal the client sends (`19.99` becomes `1999`), the database stores `amount_minor` as an integer, and `formatMoney()` converts back for display with `Intl.NumberFormat`. Nothing between request and column keeps money in a float, which is why `0.1 + 0.2` still comes out as 30 cents in the tests.",
          ),
        ];
      if (shop)
        return explain(c, "cart", text);
      break;
    case "refund":
      if (b)
        return [
          say("The refund route lives with the invoices."),
          ...readIf(c, "src/routes/invoices.ts"),
          say(
            "`POST /invoices/:id/refund` reads the invoice, works out the open amount (`amount_minor - refunded_minor`) and refunds either that or the amount in the body. A refund above the open amount answers 409 `refund_exceeds_open_amount`; otherwise `refunded_minor` is increased in one update. It does not call the provider yet, so a refund only changes the ledger.",
          ),
        ];
      break;
    case "schema":
      if (b)
        return [
          say("Reading the schema and the client."),
          ...readIf(c, "src/db/schema.sql", "src/db/client.ts"),
          say("There are two tables. `invoices` holds `amount_minor` (a positive integer), `refunded_minor`, the currency and `paid_at`. `webhook_events` stores every event id once, which makes redelivery harmless: the insert uses `on conflict do nothing`. The client is a single `pg.Pool` from `DATABASE_URL`."),
        ];
      break;
    case "health":
      if (b)
        return [say("A quick look."), ...readIf(c, "src/routes/health.ts"), say("`GET /health` returns `{ ok: true }` and nothing else: it never touches the database, so it stays green when Postgres is down. A readiness check that runs `select 1` would be more honest. I can add one.")];
      break;
    case "cart":
    case "products":
      if (shop)
        return [
          say("The cart logic is in one file."),
          ...readIf(c, "src/lib/cart.ts", "src/data/products.ts"),
          say(
            "Prices are stored in minor units on each product (`1800` is 18.00 EUR). `total()` sums `price * quantity` as an integer and formats once at the end, so there is no float drift. `setQuantity()` clamps to at least 1. `Cart.tsx` only renders the lines and calls these helpers.",
          ),
        ];
      break;
    case "docs":
      if (docs) {
        const pages = c.sim.vfs.walk(c.cwd).filter((f) => f.startsWith("docs/") && f.endsWith(".md"));
        const hits = pages.filter((f) => /webhook/i.test(c.sim.vfs.read(join(c.cwd, f)) ?? ""));
        return [
          { k: "search", pattern: "webhook", path: "docs", hits },
          say(`${hits.length} of ${pages.length} pages mention webhooks: ${hits.map((h) => `\`${h}\``).join(", ")}. \`docs/webhooks.md\` is the one that explains them; the others only link to it.`),
        ];
      }
      break;
    case "config":
      if (b) return [say("Config is read once at startup."), ...readIf(c, "src/config.ts"), say("`src/config.ts` validates the environment with zod and exports a typed `config`. A missing `DATABASE_URL` or `WEBHOOK_SECRET` stops the process on boot instead of failing on the first request.")];
      break;
  }
  return fallback(c, text);
}

/** A question the demo has no authored answer for: read the most relevant files and say where it would look. */
function fallback(c: Ctx, text: string): Beat[] {
  const words = text.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  const files = c.sim.vfs.walk(c.cwd).filter((f) => /\.(ts|tsx|md)$/.test(f) && !f.includes("node_modules") && !/\.test\./.test(f));
  const score = (f: string) => words.reduce((n, w) => n + (f.toLowerCase().includes(w) ? 3 : 0) + ((c.sim.vfs.read(join(c.cwd, f)) ?? "").toLowerCase().includes(w) ? 1 : 0), 0);
  const ranked = [...files].sort((a, b) => score(b) - score(a) || (a < b ? -1 : 1)).slice(0, 2);
  return [
    say("Let me look at the code closest to that."),
    ...ranked.map((path): Beat => ({ k: "read", path })),
    say(`\`${ranked[0] ?? "the entry point"}\` is where I would start; the files around it only call into it. The demo's answers beyond a few topics are canned, so ask about the webhook signature, money, refunds or the schema for a real walk-through. I did not change anything.`),
  ];
}

// ── subagents ──────────────────────────────────────────────────────────────────────────────────

function explore(c: Ctx): Beat[] {
  const t = (l: string[]) => c.sim.vfs.walk(c.cwd).filter((f) => l.some((p) => f.startsWith(p)) && !f.includes("node_modules"));
  const agents: SubAgent[] = [];
  if (c.project === "billing-api") {
    agents.push(
      {
        type: "Explore",
        desc: "Map the HTTP surface",
        prompt: "List every route in src/routes, what it reads and writes, and anything that is not covered by a test. Report in under 150 words.",
        steps: [
          { tool: "Glob", arg: "src/routes/*.ts", result: t(["src/routes/"]).join("\n") },
          { tool: "Read", arg: "src/routes/invoices.ts", result: "create, get, refund: three handlers on the invoices table" },
          { tool: "Read", arg: "src/routes/webhooks.ts", result: "one handler: verify signature, update invoices.paid_at, insert webhook_events" },
        ],
        report: "Five endpoints: `GET /health`, `POST /invoices`, `GET /invoices/:id`, `POST /invoices/:id/refund` and `POST /webhooks/provider`. Only the refund rule and the signature have tests; `POST /invoices` and `/health` have none.",
        ms: 5200,
      },
      {
        type: "Explore",
        desc: "Check money handling",
        prompt: "Find every place that converts or formats money and say whether any of them touch floats.",
        steps: [
          { tool: "Grep", arg: "toMinor|formatMoney|amount", result: "src/lib/money.ts\nsrc/routes/invoices.ts\ntest/money.test.ts" },
          { tool: "Read", arg: "src/lib/money.ts", result: "toMinor rounds once; formatMoney divides by 100 for display only" },
        ],
        report: "All conversions go through `src/lib/money.ts`. Floats appear only at the edges: the request body (decimal) and `Intl.NumberFormat` for display. Storage and arithmetic are integer cents.",
        ms: 3800,
      },
      {
        type: "general-purpose",
        desc: "Audit the test suite",
        prompt: "Run through test/ and say what each file protects and what is missing.",
        steps: [
          { tool: "Glob", arg: "test/*.test.ts", result: t(["test/"]).join("\n") },
          { tool: "Read", arg: "test/invoices.test.ts", result: "refund rule only; mocks the db client" },
          { tool: "Bash", arg: "pnpm test --reporter=dot", result: `${testCount(c)} passed` },
        ],
        report: `${testCount(c)} tests, all green. They cover money conversion, the refund limit and the signature format. Missing: invoice creation, a 404 on unknown invoices, and any webhook event other than \`payment.succeeded\`.`,
        ms: 6400,
      },
    );
  } else if (c.project === "web-shop") {
    agents.push(
      { type: "Explore", desc: "Map the components", prompt: "List the components and what state each owns.", steps: [{ tool: "Glob", arg: "src/**/*.tsx", result: t(["src/"]).filter((f) => f.endsWith(".tsx")).join("\n") }, { tool: "Read", arg: "src/Shop.tsx", result: "Shop owns the cart lines in useState" }], report: "`Shop` owns the cart state; `Cart` and `ProductCard` are presentational and receive callbacks. No context, no store.", ms: 3600 },
      { type: "Explore", desc: "Check price handling", prompt: "Find where prices are formatted and whether anything uses floats.", steps: [{ tool: "Grep", arg: "toFixed|price", result: "src/lib/cart.ts\nsrc/components/ProductCard.tsx" }], report: "Prices are minor units in `data/products.ts`. `ProductCard` formats with `toFixed(2)` for display; `total()` sums integers and formats once. Consistent with billing-api.", ms: 3000 },
      { type: "general-purpose", desc: "Audit the tests", prompt: "Say what cart.test.ts covers.", steps: [{ tool: "Read", arg: "src/lib/cart.test.ts", result: "addLine counts up; total of two lines" }], report: "Two tests: adding a product twice and a two-line total. Missing: the quantity clamp and removing a line.", ms: 2800 },
    );
  } else {
    agents.push(
      { type: "Explore", desc: "Map the pages", prompt: "List the docs pages and link them to each other.", steps: [{ tool: "Glob", arg: "docs/*.md", result: t(["docs/"]).join("\n") }], report: "Four pages: index, getting-started, api and webhooks. Only the index links forward.", ms: 3000 },
      { type: "Explore", desc: "Find stale statements", prompt: "Look for claims in the docs that the API no longer matches.", steps: [{ tool: "Grep", arg: "retried|backoff", result: "docs/webhooks.md" }], report: "`docs/webhooks.md` says failed deliveries are retried with backoff. That is only true once the retry change in billing-api ships.", ms: 3400 },
    );
  }
  return [
    say(`I'll send ${agents.length === 3 ? "three" : "two"} agents out in parallel so the survey does not fill this conversation.`),
    { k: "agents", items: agents },
    say(
      agents.length === 3 || c.project === "docs-site"
        ? c.project === "docs-site"
          ? "Short version: the docs are small and consistent, with one statement that runs ahead of the code. I would fix `docs/webhooks.md` together with the retry change."
          : "Short version: the project is small and consistent. The gaps are all in tests, not in the design. If you want one thing next, I would add tests for `POST /invoices`, since it is the only route that writes money without one."
        : "Done.",
    ),
  ];
}

// ── review and commit ──────────────────────────────────────────────────────────────────────────

function changed(c: Ctx) {
  const repo = c.sim.vfs.repoOf(c.cwd);
  if (!repo) return { repo, rows: [] as { path: string; add: number; del: number }[] };
  const rows = c.sim.vfs.status(repo).map((e) => {
    const old = repo.head.get(e.path) ?? "";
    const now = c.sim.vfs.read(join(repo.root, e.path)) ?? "";
    const n = counts(old, now);
    return { path: e.path, add: n.additions, del: n.deletions };
  });
  return { repo, rows };
}

function review(c: Ctx): Beat[] {
  const { rows } = changed(c);
  if (!rows.length) return [say("The working tree is clean, so there is no diff to review. Ask me to review a commit range, or make a change first.")];
  const add = rows.reduce((n, r) => n + r.add, 0);
  const del = rows.reduce((n, r) => n + r.del, 0);
  const stat = rows.map((r) => ` ${r.path.padEnd(32)} | ${String(r.add + r.del).padStart(3)} ${"+".repeat(Math.min(10, r.add))}${"-".repeat(Math.min(6, r.del))}`);
  const retry = rows.some((r) => r.path.includes("retry"));
  return [
    say("Reading the diff."),
    { k: "run", cmd: "git diff --stat", desc: "Summarise the working tree changes", ms: 900, out: [...stat, ` ${rows.length} file${rows.length > 1 ? "s" : ""} changed, ${add} insertions(+), ${del} deletions(-)`] },
    ...rows.slice(0, 2).map((r): Beat => ({ k: "read", path: r.path })),
    say(
      retry
        ? [
            `${rows.length} files, +${add}/-${del}. The change does what it says. Three notes:`,
            "",
            "1. `withRetry` uses `Math.random()` for jitter, which makes the backoff untestable with fake timers. Pass the random source in.",
            "2. The dead-letter insert is not in the same transaction as the failed update. That is fine for a log, but say so in a comment.",
            "3. Nothing records how many attempts an event took. A counter column on `webhook_dead` would make the runbook easier to follow.",
            "",
            "None of these block a merge.",
          ].join("\n")
        : `${rows.length} file${rows.length > 1 ? "s" : ""} changed, +${add}/-${del}. Nothing in the diff looks risky: the edits are small and stay inside the existing structure. I would add a test for the new path before merging.`,
    ),
  ];
}

function commit(c: Ctx): Beat[] {
  const { repo, rows } = changed(c);
  if (!repo || !rows.length) return [say("There is nothing to commit: the working tree is clean.")];
  const subject = rows.some((r) => r.path.includes("retry")) ? "Retry failed webhook deliveries with backoff" : rows.length === 1 ? `Update ${rows[0]!.path}` : `Update ${rows[0]!.path} and ${rows.length - 1} more`;
  const sim = c.sim;
  let hash = "";
  return [
    say(`I'll commit the ${rows.length} changed file${rows.length > 1 ? "s" : ""} as one commit.`),
    {
      k: "run",
      cmd: `git add -A && git commit -m "${subject}"`,
      desc: "Stage and commit the working tree",
      ask: true,
      ms: 1300,
      effect: () => {
        sim.vfs.add(repo, null);
        const r = sim.vfs.commit(repo, subject, "Demo", sim.now());
        hash = r?.hash ?? "";
      },
      out: () => [`[${repo.branch} ${hash}] ${subject}`, ` ${rows.length} file${rows.length > 1 ? "s" : ""} changed, ${rows.reduce((n, r) => n + r.add, 0)} insertions(+), ${rows.reduce((n, r) => n + r.del, 0)} deletions(-)`],
    },
    say(`Committed on \`${repo.branch}\`. I did not push; that stays yours.`),
  ];
}

// ── background ─────────────────────────────────────────────────────────────────────────────────

function background(c: Ctx): Beat[] {
  const shop = c.project === "web-shop";
  const docs = c.project === "docs-site";
  const cmd = shop ? "pnpm dev" : docs ? "pnpm dev" : "pnpm dev";
  const out = shop
    ? ["> web-shop@0.2.0 dev", "> vite", "", "  VITE v6.0.2  ready in 312 ms", "", "  ➜  Local:   http://localhost:5173/", "  ➜  press h + enter to show help"]
    : docs
      ? ["> docs-site@0.1.0 dev", "> vitepress dev docs", "", "  vitepress v1.5.0", "", "  ➜  Local:    http://localhost:5173/"]
      : ["> billing-api@0.4.0 dev", "> tsx watch src/server.ts", '{"level":30,"msg":"Server listening at http://0.0.0.0:3000"}', '{"level":30,"msg":"incoming request","req":{"method":"GET","url":"/health"}}', '{"level":30,"msg":"request completed","res":{"statusCode":200}}'];
  const beats: Beat[] = [
    say(`I'll start the dev server in the background so I can keep working while it runs.`),
    { k: "bg", cmd, desc: "Start the dev server", out, ms: 7000, summary: `Background command "${cmd}" stopped` },
  ];
  if (c.project === "billing-api") beats.push({ k: "run", cmd: "curl -s localhost:3000/health", desc: "Check the server answers", ms: 800, out: ['{"ok":true}'] });
  beats.push(say(`The server is running as a background task. Open the Tasks sheet to read its output or stop it; I'll leave it up.`));
  return beats;
}

// ── changes and plans ──────────────────────────────────────────────────────────────────────────

function chooseChange(c: Ctx, mode: "change" | "plan", depth: number): Beat[] {
  const changes = suggestions(c).filter((s) => /^(Add|Plan)/.test(s.label));
  if (!changes.length) return unknown(c, "", depth);
  const options = changes.map((s) => ({ ...s, text: mode === "plan" ? s.text.replace(/^Add/, "Plan") : s.text }));
  return [say(`${mode === "plan" ? "I can plan" : "I can make"} a few concrete changes in this sample project. Which one?`), pick(c, "Change", mode === "plan" ? "Which change should the plan cover?" : "Which change should I make?", options, depth)];
}

const PLANS: Record<Recipe, { title: string; files: string[]; body: string }> = {
  "log-webhooks": {
    title: "Log every webhook event",
    files: ["src/routes/webhooks.ts"],
    body: [
      "## Plan: log every webhook event",
      "",
      "**Goal.** Each verified event leaves one structured log line, so a support question about a missing payment can be answered from the logs.",
      "",
      "1. In `src/routes/webhooks.ts`, after the signature check and the JSON parse, call `req.log.info({ eventId, type }, \"webhook received\")`.",
      "2. Keep the body out of the log: it can carry customer data. Only the id and the type.",
      "3. Run the suite; no new test is needed because the handler's behaviour does not change.",
      "",
      "**Risk.** None for behaviour. Fastify's logger is already on.",
    ].join("\n"),
  },
  "health-db": {
    title: "Health check that reaches the database",
    files: ["src/routes/health.ts", "src/db/client.ts"],
    body: [
      "## Plan: readiness check that reaches the database",
      "",
      "**Goal.** `GET /health` should go red when Postgres is down, so the load balancer stops sending traffic.",
      "",
      "1. Import `db` from `src/db/client.ts` in `src/routes/health.ts`.",
      "2. Run `select 1` inside the handler; return `{ ok: true }` on success.",
      "3. On failure answer **503** with `{ ok: false, error: \"database_unreachable\" }` instead of throwing.",
      "4. Run the tests.",
      "",
      "**Risk.** A slow database now slows the check. Keep the default pool timeout.",
    ].join("\n"),
  },
  "cart-max": {
    title: "Cap the cart quantity",
    files: ["src/lib/cart.ts", "src/components/Cart.tsx"],
    body: [
      "## Plan: cap the cart quantity",
      "",
      "**Goal.** A line cannot hold more than 99 of one product.",
      "",
      "1. Add `MAX_QTY = 99` in `src/lib/cart.ts` and clamp in `setQuantity()` and in `addLine()`.",
      "2. Mirror it in the input with `max={99}` in `src/components/Cart.tsx`.",
      "3. Run the tests.",
      "",
      "**Risk.** Orders above 99 need a different path. Nothing in the shop needs that today.",
    ].join("\n"),
  },
};

function recipeFits(c: Ctx, r: Recipe) {
  return r === "cart-max" ? c.project === "web-shop" : c.project === "billing-api";
}

function planFor(c: Ctx, r: Recipe): Beat[] {
  if (!recipeFits(c, r)) return unknown(c, "", 0);
  const p = PLANS[r];
  return [
    say("Let me read the code the plan touches, then I'll write it down."),
    ...readIf(c, ...p.files),
    {
      k: "plan",
      plan: p.body,
      then: (choice, feedback) =>
        choice === "keep"
          ? [say(feedback ? `Understood: "${feedback}". I'll rework the plan around that and send it again. In this demo the plan stays as it is, so ask for the change directly and I will make it.` : "Understood, I'll keep planning. Tell me what to change in the plan, or ask for the change directly.")]
          : change(c, r),
    },
  ];
}

function change(c: Ctx, r: Recipe): Beat[] {
  if (!recipeFits(c, r)) return unknown(c, "", 0);
  if (c.mode === "plan") return planFor(c, r);
  if (r === "log-webhooks") {
    const old = "    const event = JSON.parse(raw) as { id: string; type: string; invoiceId?: string };";
    if (!(c.sim.vfs.read(join(c.cwd, "src/routes/webhooks.ts")) ?? "").includes(old)) return [say("The webhook handler already logs its events, so there is nothing to add.")];
    return [
      say("I'll log each verified event with its id and type, and keep the payload out of the log."),
      ...readIf(c, "src/routes/webhooks.ts"),
      { k: "edit", path: "src/routes/webhooks.ts", old, new: `${old}\n    req.log.info({ eventId: event.id, type: event.type }, "webhook received");`, ask: true },
      runTests(c),
      say(`Done. Every verified webhook now writes one line such as \`webhook received\` with \`eventId\` and \`type\`. The payload is not logged. All ${testCount(c)} tests pass.`),
    ];
  }
  if (r === "health-db") {
    const file = c.sim.vfs.read(join(c.cwd, "src/routes/health.ts")) ?? "";
    const route = '  app.get("/health", async () => ({ ok: true }));';
    if (!file.includes(route)) return [say("`/health` already checks the database, so I left it alone.")];
    const todos = (a: "pending" | "in_progress" | "completed", b: "pending" | "in_progress" | "completed", d: "pending" | "in_progress" | "completed") => [
      { content: "Import the database client", active: "Importing the database client", status: a },
      { content: "Check the database in /health", active: "Checking the database in /health", status: b },
      { content: "Run the tests", active: "Running the tests", status: d },
    ];
    return [
      say("This is a small change in two places, so I'll track it."),
      { k: "todo", items: todos("in_progress", "pending", "pending") },
      ...readIf(c, "src/routes/health.ts", "src/db/client.ts"),
      { k: "edit", path: "src/routes/health.ts", old: 'import type { FastifyPluginAsync } from "fastify";', new: 'import type { FastifyPluginAsync } from "fastify";\nimport { db } from "../db/client.js";', ask: true },
      { k: "todo", items: todos("completed", "in_progress", "pending") },
      {
        k: "edit",
        path: "src/routes/health.ts",
        old: route,
        new: '  app.get("/health", async (_req, reply) => {\n    try {\n      await db.query("select 1");\n      return { ok: true };\n    } catch {\n      return reply.code(503).send({ ok: false, error: "database_unreachable" });\n    }\n  });',
      },
      { k: "todo", items: todos("completed", "completed", "in_progress") },
      runTests(c, false),
      { k: "todo", items: todos("completed", "completed", "completed") },
      say(`\`GET /health\` now runs \`select 1\` and answers 503 with \`database_unreachable\` when Postgres is down. The suite still passes (${testCount(c)} tests); there is no test for the 503 path yet, so I would add one next.`),
    ];
  }
  // cart-max
  const cart = c.sim.vfs.read(join(c.cwd, "src/lib/cart.ts")) ?? "";
  const clamp = "  return lines.map((l) => (l.product.id === id ? { ...l, quantity: Math.max(1, Math.floor(quantity) || 1) } : l));";
  const plain = "  return lines.map((l) => (l.product.id === id ? { ...l, quantity } : l));";
  const from = cart.includes(clamp) ? clamp : cart.includes(plain) ? plain : "";
  if (!from) return [say("The quantity is already capped in `setQuantity`, so I did not touch it.")];
  return [
    say("I'll cap the quantity at 99 in the cart logic and in the input."),
    ...readIf(c, "src/lib/cart.ts"),
    { k: "edit", path: "src/lib/cart.ts", old: from, new: "  return lines.map((l) => (l.product.id === id ? { ...l, quantity: Math.min(MAX_QTY, Math.max(1, Math.floor(quantity) || 1)) } : l));", ask: true },
    { k: "edit", path: "src/lib/cart.ts", old: "export interface Line {", new: "export const MAX_QTY = 99;\n\nexport interface Line {" },
    { k: "edit", path: "src/components/Cart.tsx", old: '            type="number"\n', new: '            type="number"\n            max={99}\n' },
    runTests(c, false),
    say(`A line now holds between 1 and 99 of a product, in \`setQuantity\` and in the input's \`max\`. The ${testCount(c)} existing tests pass.`),
  ];
}

// ── tests ──────────────────────────────────────────────────────────────────────────────────────

function writeTests(c: Ctx, r: "money-rounding" | "health" | null): Beat[] {
  if (c.project !== "billing-api" || !r) {
    return [say("I can write real tests for two things in this sample project: the money rounding and the health route. Ask for either and I'll add it, run it and show you the diff."), ...[]];
  }
  if (r === "money-rounding") {
    const old = '  it("formats with the currency symbol", () => {';
    if (!(c.sim.vfs.read(join(c.cwd, "test/money.test.ts")) ?? "").includes(old)) return [say("`test/money.test.ts` already has the rounding cases.")];
    return [
      say("I'll add the rounding edge to the money tests: half a cent and a value that is not exactly representable."),
      ...readIf(c, "test/money.test.ts", "src/lib/money.ts"),
      { k: "edit", path: "test/money.test.ts", old, new: '  it("rounds half a cent instead of truncating", () => {\n    expect(toMinor(1.005)).toBe(100);\n    expect(toMinor(2.675)).toBe(268);\n  });\n\n' + old, ask: true },
      runTests(c, false),
      say(`Added one test for rounding at the half-cent boundary. It passes with the current \`Math.round\`. Worth knowing: \`2.675\` is stored as \`2.67499999\` in a float, and the test pins that \`toMinor\` still lands on 268.`),
    ];
  }
  if (exists(c, "test/health.test.ts")) return [say("`test/health.test.ts` exists already.")];
  return [
    say("I'll write a small test for the health route using Fastify's inject, so no server has to start."),
    ...readIf(c, "src/routes/health.ts"),
    {
      k: "write",
      path: "test/health.test.ts",
      text: 'import Fastify from "fastify";\nimport { describe, expect, it } from "vitest";\nimport { health } from "../src/routes/health.js";\n\ndescribe("health", () => {\n  it("answers ok", async () => {\n    const app = Fastify();\n    await app.register(health);\n    const res = await app.inject({ method: "GET", url: "/health" });\n    expect(res.statusCode).toBe(200);\n    expect(res.json()).toEqual({ ok: true });\n  });\n});\n',
      ask: true,
    },
    runTests(c, false),
    say(`\`test/health.test.ts\` is in and the suite passes (${testCount(c) + 1} tests).`),
  ];
}

// ── commands that start with ! or / ────────────────────────────────────────────────────────────

function shell(c: Ctx, cmd: string): Beat[] {
  const sim = c.sim;
  const repo = sim.vfs.repoOf(c.cwd);
  let out: string[] = [];
  if (/^ls\b/.test(cmd)) {
    const p = cmd.split(/\s+/)[1];
    const dir = p && !p.startsWith("-") ? join(c.cwd, p) : c.cwd;
    out = sim.vfs.list(dir).map((e) => e.name + (e.dir ? "/" : ""));
  } else if (/^pwd$/.test(cmd)) out = [c.cwd];
  else if (/^git status\b/.test(cmd) && repo) {
    const st = sim.vfs.status(repo);
    out = [`On branch ${repo.branch}`, st.length ? "Changes not staged for commit:" : "nothing to commit, working tree clean", ...st.map((e) => `\t${e.status === "untracked" ? "" : e.status + ":   "}${e.path}`)];
  } else if (/^git log\b/.test(cmd) && repo) out = repo.log.slice(0, 5).map((l) => `${l.hash} ${l.subject}`);
  else if (/^(pnpm|npm)( run)? test\b/.test(cmd)) out = testOutput(sim, c.cwd);
  else if (/^cat\s+\S+/.test(cmd)) out = (sim.vfs.read(join(c.cwd, cmd.split(/\s+/)[1]!)) ?? `cat: ${cmd.split(/\s+/)[1]}: No such file or directory`).split("\n").slice(0, 40);
  else if (/^echo\b/.test(cmd)) out = [cmd.replace(/^echo\s+/, "").replace(/^["']|["']$/g, "")];
  else out = [`zsh: command not found: ${cmd.split(/\s+/)[0]}`];
  return [{ k: "run", cmd, ms: 500, out, ok: !/command not found|No such file/.test(out[0] ?? "") }];
}

function slash(c: Ctx, name: string, args: string): Beat[] {
  const cv = c.sim.cvs.get(c.sid);
  const m = cv?.meta ?? {};
  const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  switch (name) {
    case "compact":
      return [{ k: "compact" }, say(args ? `Compacted. I kept the part about ${args}.` : "Compacted. The context is back to a summary and the open questions.")];
    case "clear":
      return [{ k: "clear" }];
    case "context": {
      const used = m.context_tokens ?? 24_000;
      const win = m.context_window ?? 200_000;
      const sys = 3_100;
      const tools = 11_400;
      const mem = 1_200;
      const msgs = Math.max(0, used - sys - tools - mem);
      return [{ k: "output", text: ["Context Usage", `${m.model ?? "claude-sonnet-5-5"} · ${fmt(used)}/${fmt(win)} tokens (${Math.round((used / win) * 100)}%)`, "", `System prompt   ${fmt(sys)} tokens`, `System tools    ${fmt(tools)} tokens`, `Memory files    ${fmt(mem)} tokens (CLAUDE.md)`, `Messages        ${fmt(msgs)} tokens`, `Free space      ${fmt(Math.max(0, win - used))} tokens`].join("\n") }];
    }
    case "cost":
      return [{ k: "output", text: [`Total cost:            $${(m.cost_usd ?? 0).toFixed(2)}`, `Total duration (API):  ${Math.max(1, Math.round((m.duration_ms ?? 60_000) / 1000))}s`, `Total code changes:    ${m.lines_added ?? 0} lines added, ${m.lines_removed ?? 0} lines removed`].join("\n") }];
    case "model": {
      if (args) {
        const k = args.toLowerCase().replace(/\s+/g, "");
        const hit = MODELS[k] ?? Object.entries(MODELS).find(([a]) => k.includes(a))?.[1];
        if (!hit) return [{ k: "output", text: `Unknown model: ${args}. Try default, sonnet, opus, haiku or sonnet[1m].` }];
        return [{ k: "meta", patch: { model: hit.id } }, { k: "output", text: `Set model to ${hit.name} (${hit.id})` }];
      }
      const opts = ["default", "opus", "haiku", "sonnet[1m]"].map((a) => ({ label: MODELS[a]!.name, description: a === "default" ? "Recommended for everyday work" : a === "opus" ? "Most capable, slower" : a === "haiku" ? "Fastest, for quick questions" : "Longer context for big repos", text: `/model ${a}` }));
      return [pick(c, "Model", "Choose a model", opts, 1)];
    }
    case "effort": {
      if (args) {
        const level = args.toLowerCase();
        if (!EFFORTS.includes(level)) return [{ k: "output", text: `Unknown effort level: ${args}. Use ${EFFORTS.join(", ")}.` }];
        return [{ k: "meta", patch: { effort: level } }, { k: "output", text: `Set effort level to ${level}` }];
      }
      return [pick(c, "Effort", "How hard should Claude think?", EFFORTS.map((l) => ({ label: l, description: l === "high" ? "The default" : l === "low" ? "Quick answers" : l === "max" ? "Longest thinking" : "", text: `/effort ${l}` })), 1)];
    }
    case "plan":
      return [{ k: "meta", patch: { mode: "plan" } }, { k: "output", text: "Enabled plan mode. Claude will read and plan; nothing is edited until you approve." }];
    case "review":
      return review(c);
    case "init":
      return [
        say("I'll look at the project and write a CLAUDE.md that tells future sessions how it works."),
        ...readIf(c, "package.json", "README.md"),
        {
          k: "write",
          path: "CLAUDE.md",
          ask: true,
          text: `# ${c.project}\n\n## Commands\n\n- \`pnpm test\`: run the suite (vitest)\n- \`pnpm dev\`: start the dev server\n\n## Conventions\n\n- Money is always integer minor units; see \`src/lib/money.ts\`.\n- Keep handlers thin: validation with zod, queries in the handler, helpers in \`src/lib\`.\n- Every change comes with a test next to the code it touches.\n`,
        },
        say("Wrote `CLAUDE.md` with the commands and the two conventions this code follows. Edit it freely; I read it at the start of every session."),
      ];
    case "rewind":
      return [{ k: "output", text: "Use the arrow on any of your earlier messages to rewind the conversation and the files to that point." }];
    case "memory":
      return [{ k: "output", text: "Memory files: CLAUDE.md (project). Add a line with # followed by the note." }];
    case "release-notes": {
      const log = c.sim.vfs.repoOf(c.cwd)?.log.slice(0, 6) ?? [];
      return [
        say("I'll read the commits since the last tag and group them."),
        { k: "run", cmd: "git log --oneline -n 6", ms: 700, out: log.map((l) => `${l.hash} ${l.subject}`) },
        say(["## Release notes", "", ...log.map((l) => `- ${l.subject}`), "", "Say if you want these grouped as features and fixes."].join("\n")),
      ];
    }
    case "help":
      return help(c);
    default:
      return [{ k: "output", text: `Unknown command: /${name}. Type / to see the commands.` }];
  }
}

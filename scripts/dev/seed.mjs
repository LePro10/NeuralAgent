// Demo data for screenshots in a test daemon: four workspaces, stand-in Claude/Codex/Gemini
// sessions in different states (done, waiting for permission, working, error), a fake swarm,
// optional MCP servers and a fake LLM for Neural. No model quota is used.
//
//   NEURALAGENT_HOME=/tmp/na-ui node scripts/dev/seed.mjs base|llm|nollm|mcp|ask ["question"]
//
// `base` is idempotent (skips when the demo workspaces exist). Ids land in <home>/seed.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEV, ROOT, connect, daemonBin, sleep, testHome } from "./lib.mjs";

const WORKSPACES = ["landing-site", "api-server", "product-docs", "customer-portal-redesign-2026"];

export async function seed(home, step = "base", { llmPort = 11499, question } = {}) {
  const c = await connect(home, { name: "seed", subscribe: true });
  const { req } = c;
  const D = daemonBin();
  const hook = (sid, ev, payload) => req("term_write", { sid, data: `echo '${JSON.stringify(payload)}' | ${D} hook ${ev}\r` });
  try {
    if (step === "base") {
      const have = new Set((c.state()?.workspaces ?? []).map((w) => w.name));
      if (WORKSPACES.every((n) => have.has(n))) return console.log("seed: demo data already there");
      const W = {};
      for (const n of WORKSPACES) {
        const path = `${home}-ws/${n}`;
        mkdirSync(path, { recursive: true });
        W[n] = (await req("workspace_add", { path, name: n })).id;
      }
      const fake = join(DEV, "fake-cli.sh");
      const prof = (id, name, engine) => req("profile_save", { profile: { id, name, engine, command: fake, args: [], env: {}, icon: engine, builtin: false } });
      await prof("fclaude", "Claude Code", "claude");
      await prof("fcodex", "Codex", "codex");
      await prof("fgemini", "Gemini", "gemini");
      await req("profile_save", { profile: { id: "fake", name: "Fake agent", engine: "custom", command: "node", args: [join(ROOT, "scripts/fake-agent.mjs")], env: { FAKE_AGENT_DAEMON: D }, icon: "bot", builtin: false } });
      const S = {};
      const start = async (k, w, p, title) => {
        const s = await req("session_start", { workspace_id: W[w], profile_id: p, cols: 100, rows: 30 });
        S[k] = s.id;
        await sleep(600);
        if (title) await req("session_rename", { id: s.id, title });
      };
      await start("docs", "product-docs", "fclaude", "Rewrite the README intro");
      await start("api", "api-server", "fcodex", "Fix flaky auth tests");
      await start("portal", "customer-portal-redesign-2026", "fgemini", "Migrate the checkout form to the new design tokens");
      await start("portal2", "customer-portal-redesign-2026", "fclaude", "Audit accessibility");
      await sleep(1200);
      await hook(S.docs, "UserPromptSubmit", { prompt: "Rewrite the README intro so it explains the product in two sentences" });
      await sleep(500);
      await hook(S.docs, "Stop", { last_assistant_message: "Done. **README.md** now opens with a two-sentence pitch and a `Quick start` section.\n\n- Moved install steps below" });
      await hook(S.api, "UserPromptSubmit", { prompt: "Fix the flaky auth tests" });
      await sleep(400);
      await hook(S.api, "PermissionRequest", { tool_name: "Bash" });
      await hook(S.portal, "UserPromptSubmit", { prompt: "Migrate the checkout form" });
      await hook(S.portal2, "UserPromptSubmit", { prompt: "Audit accessibility" });
      await sleep(400);
      await hook(S.portal2, "StopFailure", { error: "Rate limit reached. Try again in 4 minutes." });
      const sw = await req("swarm_start", {
        workspace_id: W["landing-site"],
        goal: "Change the greeting to “Hello, swarm.” and review it",
        members: ["Coordinator", "Scout", "Builder", "Reviewer"].map((role) => ({ role, profile_id: "fake" })),
      });
      writeFileSync(join(home, "seed.json"), JSON.stringify({ W, S, swarm: sw.id ?? sw }, null, 2));
      console.log("seed: demo workspaces, sessions and a swarm created");
    } else if (step === "llm") {
      const settings = { ...c.state().settings, llm: { provider: "ollama", base_url: `http://127.0.0.1:${llmPort}/v1`, model: "fake", call_model: "" } };
      await req("settings_set", { settings });
      console.log(`seed: Neural uses the fake LLM on :${llmPort}`);
    } else if (step === "nollm") {
      await req("settings_set", { settings: { ...c.state().settings, llm: { provider: "neuralhub", base_url: "", model: "claude/claude-sonnet-5-5", call_model: "claude/claude-haiku-5-5" } } });
      console.log("seed: Neural back on NeuralHub (no key in a test home: shows the set-up card)");
    } else if (step === "ask") {
      await req("orch_send", { text: question ?? "What are my agents doing?" });
      await sleep(3000);
      console.log("seed: asked Neural");
    } else if (step === "mcp") {
      await req("mcp_save", { server: { id: "github", enabled: true, transport: { type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] }, secrets: ["GITHUB_TOKEN"] }, values: {} });
      await req("mcp_save", { server: { id: "linear", enabled: false, transport: { type: "http", url: "https://mcp.linear.app/sse" }, secrets: [] }, values: {} });
      await req("mcp_save", { server: { id: "playwright", enabled: true, transport: { type: "stdio", command: "npx", args: ["@playwright/mcp@latest"] }, secrets: [] }, values: {} });
      console.log("seed: three MCP servers");
    } else {
      throw new Error(`unknown seed step ${step} (base|llm|nollm|mcp|ask)`);
    }
  } finally {
    c.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [step, ...rest] = process.argv.slice(2);
  await seed(testHome(), step ?? "base", { question: rest.join(" ") || undefined });
  process.exit(0);
}

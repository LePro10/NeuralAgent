// The starting point of the world: the disk, workspaces, profiles, the CLI catalog, settings,
// Neural's memory and its conversation. Identical for the same seed.

import type { CatalogEntry, NeuralState, OrchMessage, Profile, Settings, State, UsageLimit, Workspace } from "@neuralagent/protocol";
import { autopilotSeed } from "./autopilot.ts";
import { CODE, HOME, HOME_FILES, PROJECTS } from "./content.ts";
import type { Sim } from "./sim.ts";
import { join } from "./vfs.ts";

const LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><rect width="64" height="64" rx="14" fill="#1c2430"/><path d="M18 44V20l14 16 14-16v24" fill="none" stroke="#8fd3ff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>\n'; // token-ok: sample file content

const MIN = 60_000;
const HOUR = 60 * MIN;

const ENGINES: { id: string; name: string; vendor: string; command: string; install: string; note?: string; docs: string; hooks: boolean; installed?: string }[] = [
  { id: "claude", name: "Claude Code", vendor: "Anthropic", command: "claude", install: "curl -fsSL https://claude.ai/install.sh | bash", docs: "https://code.claude.com/docs", hooks: true, installed: "2.1.316" },
  { id: "codex", name: "Codex", vendor: "OpenAI", command: "codex", install: "curl -fsSL https://chatgpt.com/codex/install.sh | sh", docs: "https://github.com/openai/codex", hooks: true, installed: "0.166.0" },
  { id: "gemini", name: "Gemini CLI", vendor: "Google", command: "gemini", install: "npm install -g @google/gemini-cli", note: "Needs Node.js 20 or newer.", docs: "https://github.com/google-gemini/gemini-cli", hooks: false, installed: "0.41.2" },
  { id: "antigravity", name: "Antigravity CLI", vendor: "Google", command: "agy", install: "curl -fsSL https://antigravity.google/cli/install.sh | bash", docs: "https://antigravity.google", hooks: false },
  { id: "cursor", name: "Cursor Agent", vendor: "Cursor", command: "agent", install: "curl https://cursor.com/install -fsS | bash", docs: "https://cursor.com/docs/cli/overview", hooks: false },
  { id: "copilot", name: "Copilot CLI", vendor: "GitHub", command: "copilot", install: "curl -fsSL https://gh.io/copilot-install | bash", docs: "https://docs.github.com/en/copilot/how-tos/copilot-cli", hooks: false },
  { id: "opencode", name: "OpenCode", vendor: "SST", command: "opencode", install: "curl -fsSL https://opencode.ai/install | bash", docs: "https://opencode.ai/docs/", hooks: false, installed: "2.2.3" },
  { id: "grok", name: "Grok Build", vendor: "xAI", command: "grok", install: "curl -fsSL https://x.ai/cli/install.sh | bash", docs: "https://docs.x.ai/build/cli/reference", hooks: false },
  { id: "amp", name: "Amp", vendor: "Amp", command: "amp", install: "curl -fsSL https://ampcode.com/install.sh | bash", docs: "https://ampcode.com", hooks: false },
  { id: "droid", name: "Droid", vendor: "Factory", command: "droid", install: "curl -fsSL https://app.factory.ai/cli | sh", docs: "https://docs.factory.com/cli/getting-started/quickstart", hooks: false },
  { id: "kimi", name: "Kimi Code", vendor: "Moonshot AI", command: "kimi", install: "curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash", docs: "https://github.com/MoonshotAI/kimi-cli", hooks: false },
  { id: "qwen", name: "Qwen Code", vendor: "Alibaba", command: "qwen", install: "npm install -g @qwen-code/qwen-code@latest", note: "Needs Node.js 22 or newer.", docs: "https://github.com/QwenLM/qwen-code", hooks: false },
  { id: "aider", name: "Aider", vendor: "Aider", command: "aider", install: "curl -LsSf https://aider.chat/install.sh | sh", note: "Bring your own model API key.", docs: "https://aider.chat/docs/install.html", hooks: false },
];

export const catalog = (): CatalogEntry[] =>
  ENGINES.map((e) => ({
    id: e.id,
    name: e.name,
    vendor: e.vendor,
    command: e.command,
    installed: !!e.installed,
    ...(e.installed ? { path: `/usr/local/bin/${e.command}`, version: e.installed } : {}),
    install: e.install,
    ...(e.note ? { install_note: e.note } : {}),
    docs_url: e.docs,
    hooks: e.hooks,
  }));

export const profiles = (): Profile[] => [
  { id: "shell", name: "Terminal", engine: "shell", command: "", args: [], env: {}, icon: "shell", builtin: true },
  ...ENGINES.map((e): Profile => ({ id: e.id, name: e.name, engine: e.id, command: e.command, args: [], env: {}, icon: e.id, builtin: true })),
];

export const settings = (): Settings => ({
  keep_awake: "while_working",
  resume_on_start: true,
  // The demo collects nothing (and shows no usage notice).
  usage_stats: false,
  theme: "ice",
  discord_presence: "general",
  default_profile: "claude",
  llm: { provider: "neuralhub", base_url: "", model: "claude/claude-sonnet-5-5", call_model: "claude/claude-haiku-5-5" },
  call: { voice: 0, speed: 1.05 },
  remote_files_home: true,
  discord: { details: "agents", state: "tokens_today", hover: "model", party: false, timer: true, button: true, project_names: false },
});

export const limits = (now: number): UsageLimit[] => [
  { engine: "claude", window: "5h", window_minutes: 300, used_percent: 38, resets_at: now + 2 * HOUR + 14 * MIN, updated_at: now - 40_000 },
  { engine: "claude", window: "7d", window_minutes: 10080, used_percent: 27, resets_at: now + 3 * 24 * HOUR + 5 * HOUR, updated_at: now - 40_000 },
  { engine: "codex", window: "5h", window_minutes: 300, used_percent: 16, resets_at: now + 3 * HOUR + 40 * MIN, updated_at: now - 2 * MIN },
  { engine: "codex", window: "7d", window_minutes: 10080, used_percent: 9, resets_at: now + 5 * 24 * HOUR, updated_at: now - 2 * MIN },
];

/** Disk: home folder, the three projects (with git state) and a handful of ordinary files. */
export function seedDisk(sim: Sim) {
  const vfs = sim.vfs;
  const t0 = sim.now();
  vfs.mkdir(HOME);
  for (const [rel, text] of Object.entries(HOME_FILES)) vfs.write(join(HOME, rel), text, t0 - 3 * 24 * HOUR);
  vfs.write(join(HOME, "Documents/logo.svg"), LOGO_SVG, t0 - 9 * 24 * HOUR);
  vfs.mkdir(CODE);
  PROJECTS.forEach((p, k) => {
    const root = join(CODE, p.name);
    for (const [rel, text] of Object.entries(p.files)) vfs.write(join(root, rel), text, t0 - (6 + k) * 24 * HOUR);
    vfs.mkdir(join(root, "node_modules"));
    vfs.repos.set(root, { root, branch: p.branch, ahead: p.ahead, behind: 0, head: new Map(), log: [], staged: new Set() });
    const repo = vfs.repos.get(root)!;
    vfs.commitAll(repo);
    repo.log = p.log.map(([hash, subject], i) => ({ hash, subject, author: "Demo User", at: t0 - (i + 1) * (7 + k) * HOUR }));
    for (const [rel, edits] of Object.entries(p.working)) for (const [a, b] of edits) vfs.edit(join(root, rel), a, b);
    for (const [rel, text] of Object.entries(p.untracked)) vfs.write(join(root, rel), text, t0 - 40 * MIN);
  });
}

export function workspaces(sim: Sim): Workspace[] {
  const t0 = sim.now();
  return PROJECTS.map((p, i) => ({
    id: sim.id("workspace"),
    name: p.name,
    path: join(CODE, p.name),
    approved: i < 2,
    pinned: i === 0,
    order: i,
    created_at: t0 - (20 - i * 3) * 24 * HOUR,
  }));
}

/** Neural's older conversation and memory; the live parts are added by the scenes. */
export function neuralHistory(sim: Sim, shopClaude: string, stockWin?: string): { messages: OrchMessage[]; neural: NeuralState } {
  const t = sim.now();
  const shop = sim.state.workspaces.find((w) => w.name === "web-shop")?.id ?? "";
  const id = () => sim.id("orchm");
  const messages: OrchMessage[] = [
    { id: id(), role: "user", text: "Which of my agents are idle right now?", at: t - 26 * HOUR },
    { id: id(), role: "assistant", text: "None. Everything I can see is finished: **Claude** in billing-api shipped the refund endpoint, and **Gemini** in docs-site wrote the webhook page. Want me to start something?", at: t - 26 * HOUR + 4_000 },
    { id: id(), role: "user", text: "Start Claude in web-shop to fix the cart quantity bug", at: t - 64 * MIN },
    { id: id(), role: "action", text: "Started Claude Code in web-shop", at: t - 64 * MIN + 3_000, ok: true, session_id: shopClaude },
    { id: id(), role: "assistant", text: "**Claude** is on it in web-shop. I will let you know when it is done or when it needs you.", at: t - 64 * MIN + 5_000 },
    { id: id(), role: "assistant", text: "Claude finished in **web-shop**: the cart now clamps the quantity to 1 or more, in the logic and in the input. I allowed its one-line edit to `Cart.tsx` for you; the tests pass.", at: t - 61 * MIN, proactive: true, session_id: shopClaude },
  ];
  const neural: NeuralState = {
    mode: "active",
    tasks: [
      {
        id: sim.id("task", 12),
        title: "Clamp the cart quantity to 1 or more",
        done_when: "The quantity cannot go below 1 and the tests pass",
        status: "done",
        workspace_id: shop,
        agents: [shopClaude],
        check: "pnpm test",
        note: "Check passed: pnpm test",
        created_at: t - 64 * MIN + 3_000,
        updated_at: t - 61 * MIN,
      },
      ...(stockWin
        ? [
            {
              id: sim.id("task", 12),
              title: "Show the stock count on product cards",
              done_when: "pnpm test passes",
              status: "done" as const,
              workspace_id: shop,
              agents: [stockWin],
              check: "pnpm test",
              note: "Done",
              created_at: t - 26 * HOUR + 12 * MIN,
              updated_at: t - 26 * HOUR + 31 * MIN,
            },
          ]
        : []),
    ],
    notes: [
      { id: sim.id("note", 10), text: "Prefer pnpm over npm in every project.", at: t - 9 * 24 * HOUR },
      { id: sim.id("note", 10), text: "Money is always integer minor units, never floats.", at: t - 4 * 24 * HOUR },
    ],
    observations: [
      { id: sim.id("obs", 10), at: t - 26 * HOUR + 10 * MIN, kind: "done", text: "Claude finished \"Add a refund endpoint\" in billing-api", seen: true },
      { id: sim.id("obs", 10), at: t - 64 * MIN + 3_000, kind: "started", session_id: shopClaude, text: "Started Claude Code in web-shop: Clamp cart quantity", seen: true },
      { id: sim.id("obs", 10), at: t - 63 * MIN, kind: "waiting", session_id: shopClaude, text: "Claude in web-shop is waiting for permission to edit Cart.tsx", seen: true },
      { id: sim.id("obs", 10), at: t - 62 * MIN - 30_000, kind: "allowed", session_id: shopClaude, text: "Allowed Claude's edit to Cart.tsx in web-shop", seen: true },
      { id: sim.id("obs", 10), at: t - 61 * MIN, kind: "done", session_id: shopClaude, text: "Claude finished \"Clamp cart quantity\" in web-shop", seen: true },
    ],
    pending: [],
    summary_upto: 0,
  };
  return { messages, neural };
}

export function freshState(sim: Sim, ws: Workspace[]): State {
  const now = sim.now();
  return {
    workspaces: ws,
    layouts: {},
    sessions: {},
    profiles: profiles(),
    catalog: catalog(),
    settings: settings(),
    mcp: [
      { id: "github", enabled: true, transport: { type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] }, secrets: ["GITHUB_TOKEN"] },
      { id: "linear", enabled: false, transport: { type: "http", url: "https://mcp.linear.app/sse" }, secrets: [] },
      { id: "playwright", enabled: true, transport: { type: "stdio", command: "npx", args: ["@playwright/mcp@latest"] }, secrets: [] },
    ],
    limits: limits(now),
    remote: {
      status: "online",
      relay: "https://agent.neuralhub.dev",
      paused: false,
      account: { email: "demo@example.com", name: "Demo User" },
      devices: [
        { id: "dev-studio", name: "Studio", platform: "macos", online: true, last_seen: Math.floor(now / 1000), this: true },
        { id: "dev-phone", name: "Pixel 9", platform: "android", online: true, last_seen: Math.floor(now / 1000) - 40, this: false },
        { id: "dev-laptop", name: "MacBook Air", platform: "macos", online: false, last_seen: Math.floor(now / 1000) - 3 * 24 * 3600, this: false },
      ],
      fingerprint: "7F3A 91C2 04BE D5E8",
    },
    orchestrator: { ready: true, keys: ["neuralhub"], busy: false, messages: [] },
    neural: { mode: "active", tasks: [], notes: [], observations: [], pending: [], summary_upto: 0 },
    autopilot: autopilotSeed(ws.find((w) => w.name === "web-shop")?.id ?? ws[0]?.id ?? "", now),
  };
}

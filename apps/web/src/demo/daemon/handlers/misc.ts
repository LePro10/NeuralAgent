// Everything that is not a terminal, a file or a conversation: settings, profiles, tool servers,
// usage numbers, the Discord card, the remote account, the model check, host maintenance, history.

import type { AuditEntry, DiscordCard, DiscordPreview, HistoryEntry, HostSystem, HostUpdate, LlmCheck, McpServer, ModelInfo, Profile, RemoteDevice, Request, Settings, UsageReport, UsageRow } from "@neuralagent/protocol";
import { toBase64 } from "../ansi.ts";
import { catalog } from "../seed.ts";
import { ApiErr } from "../server.ts";
import { DEMO_VERSION } from "../../api.ts";
import { HOST, type Sim } from "../sim.ts";
import { join } from "../vfs.ts";

type P<M extends Request["m"]> = Extract<Request, { m: M }> extends { p: infer X } ? X : never;

const DAY = 86_400_000;

// ── settings, profiles, tool servers ──

export function settingsSet(sim: Sim, p: P<"settings_set">) {
  sim.emit({ e: "settings_set", settings: p.settings as Settings });
  return null;
}

export function profileSave(sim: Sim, p: P<"profile_save">) {
  const profile = p.profile as Profile;
  if (!profile.id) throw new ApiErr("bad_request", "A profile needs an id");
  const list = sim.state.profiles;
  const next = list.some((x) => x.id === profile.id) ? list.map((x) => (x.id === profile.id ? { ...profile, builtin: x.builtin } : x)) : [...list, { ...profile, builtin: false }];
  sim.emit({ e: "profiles_set", profiles: next });
  return null;
}

export function profileDelete(sim: Sim, p: P<"profile_delete">) {
  const cur = sim.state.profiles.find((x) => x.id === p.id);
  if (!cur) throw new ApiErr("not_found", "Unknown profile");
  if (cur.builtin) throw new ApiErr("bad_request", "Built-in profiles cannot be deleted");
  sim.emit({ e: "profiles_set", profiles: sim.state.profiles.filter((x) => x.id !== p.id) });
  return null;
}

export async function catalogRefresh(sim: Sim) {
  await sim.clock.sleep(700, sim.scope).catch(() => {});
  const fresh = catalog();
  sim.emit({ e: "catalog_set", catalog: fresh });
  return fresh;
}

export function mcpSave(sim: Sim, p: P<"mcp_save">) {
  const s = p.server as McpServer;
  if (!/^[A-Za-z0-9_-]+$/.test(s.id)) throw new ApiErr("bad_request", "Use letters, digits, - and _ for the name");
  const secrets = [...new Set([...s.secrets, ...Object.keys(p.values)])];
  const server = { ...s, secrets };
  const list = sim.state.mcp;
  sim.emit({ e: "mcp_set", servers: list.some((x) => x.id === s.id) ? list.map((x) => (x.id === s.id ? server : x)) : [...list, server] });
  return null;
}

export function mcpDelete(sim: Sim, p: P<"mcp_delete">) {
  sim.emit({ e: "mcp_set", servers: sim.state.mcp.filter((x) => x.id !== p.id) });
  return null;
}

export function mcpImport(sim: Sim) {
  const found: McpServer = { id: "filesystem", enabled: true, transport: { type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", join(HOST.home, "code")] }, secrets: [] };
  if (sim.state.mcp.some((x) => x.id === found.id)) return 0;
  sim.emit({ e: "mcp_set", servers: [...sim.state.mcp, found] });
  return 1;
}

// ── usage ──

const localDay = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const PRICE: Record<string, { i: number; o: number; cr: number; cw: number }> = {
  "claude-sonnet-5-5": { i: 3e-6, o: 15e-6, cr: 0.3e-6, cw: 3.75e-6 },
  "claude-haiku-5-5": { i: 1e-6, o: 5e-6, cr: 0.1e-6, cw: 1.25e-6 },
  "gpt-5.5-codex": { i: 1.25e-6, o: 10e-6, cr: 0.125e-6, cw: 0 },
};

const cost = (model: string, t: UsageRow["tokens"]) => {
  const p = PRICE[model] ?? PRICE["claude-sonnet-5-5"]!;
  return Math.round((t.input * p.i + t.output * p.o + t.cache_read * p.cr + t.cache_write * p.cw) * 100) / 100;
};

/** Synthetic usage: a plausible month for one developer, regenerated from the world's seed. */
export function usageReport(sim: Sim, p: P<"usage_report">): UsageReport {
  const days = Math.max(1, Math.min(365, p.days || 30));
  const rows: UsageRow[] = [];
  const busy: Record<string, number> = {};
  const now = sim.now();
  const ws = sim.state.workspaces;
  for (let k = days - 1; k >= 0; k--) {
    const day = localDay(now - k * DAY);
    const dow = new Date(now - k * DAY).getDay();
    const weekend = dow === 0 || dow === 6;
    const r = sim.rng.fork(`usage:${day}`);
    const level = weekend ? r.next() * 0.35 : 0.45 + r.next() * 0.55;
    if (level < 0.06) continue;
    const mk = (engine: string, model: string, scale: number, wid?: string): UsageRow => {
      const tokens = {
        input: Math.round((180_000 + r.next() * 520_000) * level * scale),
        output: Math.round((50_000 + r.next() * 190_000) * level * scale),
        cache_read: Math.round((6_000_000 + r.next() * 22_000_000) * level * scale),
        cache_write: Math.round((400_000 + r.next() * 1_400_000) * level * scale),
      };
      return { day, engine, model, ...(wid ? { workspace_id: wid } : {}), tokens, cost_usd: cost(model, tokens), calls: Math.round((40 + r.next() * 160) * level * scale) };
    };
    rows.push(mk("claude", "claude-sonnet-5-5", 1, ws[0]?.id));
    rows.push(mk("claude", "claude-sonnet-5-5", 0.45, ws[1]?.id));
    if (r.next() < 0.7) rows.push(mk("claude", "claude-haiku-5-5", 0.2));
    if (r.next() < 0.6) rows.push(mk("codex", "gpt-5.5-codex", 0.5, ws[0]?.id));
    busy[day] = Math.round((1.4 + r.next() * 4.2) * level * 3_600_000);
  }
  // Today also counts what the agents of this world have really done so far.
  const today = localDay(now);
  for (const s of Object.values(sim.state.sessions)) {
    const u = s.usage;
    if (!u) continue;
    const engine = sim.engineOf(s.id);
    const model = u.model ?? (engine === "codex" ? "gpt-5.5-codex" : "claude-sonnet-5-5");
    const row = rows.find((x) => x.day === today && x.engine === engine && x.model === model && x.workspace_id === s.workspace_id);
    if (row) {
      row.tokens = { input: row.tokens.input + u.tokens.input, output: row.tokens.output + u.tokens.output, cache_read: row.tokens.cache_read + u.tokens.cache_read, cache_write: row.tokens.cache_write + u.tokens.cache_write };
      row.cost_usd = cost(model, row.tokens);
      row.calls += 4;
    } else {
      rows.push({ day: today, engine, model, workspace_id: s.workspace_id, tokens: u.tokens, cost_usd: cost(model, u.tokens), calls: 4 });
    }
    busy[today] = (busy[today] ?? 0) + sim.busyNow(s.id);
  }
  return { rows, busy_ms: busy };
}

// ── Discord ──

const NAMES: Record<string, string> = { claude: "Claude Code", codex: "Codex", opencode: "OpenCode", gemini: "Gemini CLI" };

export function discordPreview(sim: Sim, p: P<"discord_preview">): DiscordPreview {
  const presence = p.presence ?? sim.state.settings.discord_presence;
  const o = p.options ?? sim.state.settings.discord;
  if (presence === "off" || !o) return { sample: false, connected: true };
  const agents = Object.values(sim.state.sessions).filter((s) => s.alive && sim.engineOf(s.id) !== "shell");
  const working = agents.filter((s) => s.status === "working");
  const first = working[0] ?? agents[0];
  const engine = first ? sim.engineOf(first.id) : "claude";
  const tokens = Object.values(sim.state.sessions).reduce((n, s) => n + (s.usage ? s.usage.tokens.input + s.usage.tokens.output : 0), 0);
  const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
  const project = o.project_names ? (sim.workspaceOf(first?.id ?? "")?.name ?? "a project") : "a project";
  const stat = (k: string): string | undefined => {
    switch (k) {
      case "activity":
        return working.length ? "Working with agents" : "Idle";
      case "agents":
        return `${working.length} agent${working.length === 1 ? "" : "s"} working`;
      case "subagents":
        return "2 subagents";
      case "project":
        return `in ${project}`;
      case "model":
        return engine === "codex" ? "gpt-5.5-codex" : "Claude Sonnet 5.5";
      case "engine":
        return NAMES[engine] ?? engine;
      case "tokens_session":
        return `${fmt(tokens)} tokens this session`;
      case "tokens_today":
        return `${fmt(tokens + 18_400_000)} tokens today`;
      case "cost_today":
        return `$${(tokens * 6e-6 + 14.2).toFixed(2)} today`;
      case "agent_time":
        return "3h 12m with agents";
      case "streak":
        return "9 day streak";
      case "files":
        return `${sim.vfs.status(sim.vfs.repos.values().next().value!).length} files changed`;
      default:
        return undefined;
    }
  };
  const card: DiscordCard =
    presence === "general"
      ? { details: "Orchestrating AI agents", large_text: "NeuralAgent", badge: "claude", small_text: "NeuralAgent", buttons: o.button ? ["Get NeuralAgent"] : [] }
      : {
          details: stat(presence === "custom" ? o.details : "activity") ?? "Working with agents",
          ...(stat(presence === "custom" ? o.state : "project") ? { state: stat(presence === "custom" ? o.state : "agents") } : {}),
          large_text: (presence === "custom" ? stat(o.hover) : undefined) ?? "NeuralAgent",
          badge: engine,
          small_text: NAMES[engine] ?? "NeuralAgent",
          ...(o.timer ? { start: sim.now() - 47 * 60_000 } : {}),
          ...(o.party ? { party: [working.length, agents.length] as [number, number] } : {}),
          buttons: o.button ? ["Get NeuralAgent"] : [],
        };
  return { card, sample: false, connected: true, shown: card, next_in_ms: 15_000 };
}

// ── remote ──

function qr(seed: string): string {
  const n = 25;
  const cells: string[] = [];
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const finder = (x: number, y: number) => (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
  const ring = (x: number, y: number) => {
    const fx = x >= n - 7 ? x - (n - 7) : x;
    const fy = y >= n - 7 ? y - (n - 7) : y;
    const d = Math.max(Math.abs(fx - 3), Math.abs(fy - 3));
    return d === 3 || d <= 1;
  };
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      let on: boolean;
      if (finder(x, y)) on = ring(x, y);
      else {
        h = Math.imul(h ^ (x * 31 + y * 17), 16777619) >>> 0;
        on = (h & 0x100) !== 0;
      }
      if (on) cells.push(`<rect x="${x + 2}" y="${y + 2}" width="1" height="1"/>`);
    }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 4} ${n + 4}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${cells.join("")}</g></svg>`; // token-ok: QR is black on white by design
}

export function remoteSignIn(sim: Sim, _p: P<"remote_sign_in">) {
  const r = sim.state.remote;
  const t = Math.floor(sim.now() / 1000);
  const devices: RemoteDevice[] = r.devices.length ? r.devices : [{ id: "dev-studio", name: "Studio", platform: "macos", online: true, last_seen: t, this: true }];
  sim.emit({ e: "remote_set", remote: { ...r, status: "online", paused: false, account: { email: "demo@example.com", name: "Demo User" }, devices, fingerprint: r.fingerprint ?? "7F3A 91C2 04BE D5E8", error: undefined } });
  return null;
}

export function remoteSignOut(sim: Sim) {
  const r = sim.state.remote;
  sim.emit({ e: "remote_set", remote: { status: "signed_out", relay: r.relay, paused: false, devices: [] } });
  return null;
}

export function remoteEnable(sim: Sim, p: P<"remote_enable">) {
  const r = sim.state.remote;
  if (!r.account) throw new ApiErr("bad_request", "Sign in first");
  sim.emit({ e: "remote_set", remote: { ...r, paused: !p.enabled, status: p.enabled ? "online" : "off" } });
  return null;
}

export function remotePair(sim: Sim) {
  const code = sim.id("pair", 8);
  // An address that cannot pair anything: it leads back to this demo, never to the real web remote.
  const url = `https://agent.neuralhub.dev/demo/#pair-${code}`;
  return { url, expires_in: 300, svg: qr(url) };
}

export function remoteRevoke(sim: Sim, p: P<"remote_revoke">) {
  const r = sim.state.remote;
  sim.emit({ e: "remote_set", remote: { ...r, devices: r.devices.filter((d) => d.id !== p.device_id || d.this) } });
  return null;
}

// ── model, host ──

export async function llmTest(sim: Sim): Promise<LlmCheck> {
  await sim.clock.sleep(650, sim.scope).catch(() => {});
  return { ok: true, model: sim.state.settings.llm.model, ms: 612 };
}

export function llmKeySet(sim: Sim, p: P<"llm_key_set">) {
  const o = sim.state.orchestrator;
  const keys = p.key ? [...new Set([...o.keys, p.provider])] : o.keys.filter((k) => k !== p.provider);
  sim.emit({ e: "orch_status", ready: true, keys, busy: o.busy });
  return null;
}

const MODELS: ModelInfo[] = [
  { id: "parakeet", name: "Parakeet", purpose: "Speech to text", size: 640_000_000, installed: false },
  { id: "wake", name: "Wake word", purpose: "Hey Neural", size: 3_200_000, installed: false },
  { id: "vad", name: "Voice detection", purpose: "Hears when you stop talking", size: 2_100_000, installed: false },
  { id: "supertonic", name: "Supertonic", purpose: "Text to speech", size: 260_000_000, installed: false },
];

export const hostModels = (sim: Sim): ModelInfo[] => (sim.models ??= MODELS.map((m) => ({ ...m })));

const publishModels = (sim: Sim) => sim.emit({ e: "host_notice", topic: "models", data: hostModels(sim).map((m) => ({ ...m })) });

/** A download that really takes a few seconds: progress notices, then "Installed". Nothing is fetched. */
export function modelDownload(sim: Sim, p: P<"host_model_download">) {
  const list = hostModels(sim);
  const m = list.find((x) => x.id === p.id);
  if (!m || m.installed || m.progress != null) return null;
  const steps = 10;
  const set = (patch: Partial<ModelInfo>) => {
    Object.assign(m, patch);
    publishModels(sim);
  };
  set({ progress: 0, error: undefined });
  void (async () => {
    try {
      for (let i = 1; i <= steps; i++) {
        await sim.clock.sleep(280 + Math.min(1200, m.size / 1_000_000), sim.scope);
        if (i < steps) set({ progress: i / steps });
      }
      set({ progress: undefined, installed: true });
    } catch {
      /* the world was reset */
    }
  })();
  return null;
}

export function modelDelete(sim: Sim, p: P<"host_model_delete">) {
  const m = hostModels(sim).find((x) => x.id === p.id);
  if (m) {
    m.installed = false;
    m.progress = undefined;
    publishModels(sim);
  }
  return null;
}

export function hostSystem(sim: Sim): HostSystem {
  return { started_at: sim.restartedAt || sim.now() - 4 * 3_600_000, booted_at: sim.now() - 3 * DAY, restarts: sim.restarts, before_login: false, can_restart: true, full_disk_access: true, warnings: [] };
}

/** "Restart service": nothing really stops (the agents keep working), but the page shows a fresh start. */
export function hostRestart(sim: Sim) {
  sim.restarts += 1;
  sim.restartedAt = sim.now();
  return null;
}

export const hostUpdate = (): HostUpdate => ({ current: DEMO_VERSION, service: DEMO_VERSION, app_running: true });

// ── audit and history ──

export function auditList(sim: Sim, p: P<"audit_list">): AuditEntry[] {
  return sim.audit.slice(0, p.limit ?? 100);
}

const HISTORY: { engine: string; project: string; title: string; snippet: string; prompts: number; ago: number }[] = [
  { engine: "claude", project: "billing-api", title: "Add a refund endpoint", snippet: "POST /invoices/:id/refund with partial amounts", prompts: 6, ago: 26 },
  { engine: "claude", project: "billing-api", title: "Verify webhook signatures in constant time", snippet: "timingSafeEqual instead of ===", prompts: 3, ago: 30 },
  { engine: "codex", project: "billing-api", title: "Store amounts as integer minor units", snippet: "toMinor and fromMinor helpers", prompts: 4, ago: 52 },
  { engine: "claude", project: "web-shop", title: "Cart drawer keyboard navigation", snippet: "focus trap and Escape to close", prompts: 5, ago: 74 },
  { engine: "claude", project: "docs-site", title: "Rewrite the getting-started guide", snippet: "first invoice in five minutes", prompts: 7, ago: 98 },
  { engine: "codex", project: "web-shop", title: "Flaky checkout test", snippet: "await the network idle state", prompts: 2, ago: 121 },
  { engine: "claude", project: "billing-api", title: "Explain the invoice state machine", snippet: "draft, open, paid, void", prompts: 2, ago: 147 },
  { engine: "claude", project: "docs-site", title: "Add an API reference page", snippet: "generated from the zod schemas", prompts: 8, ago: 170 },
];

export function historySearch(sim: Sim, p: P<"history_search">): HistoryEntry[] {
  const q = p.query.trim().toLowerCase();
  const now = sim.now();
  return HISTORY.map((h, i) => ({ engine: h.engine, id: sim.rng.fork(`hist${i}`).hex(32), cwd: join(HOST.home, `code/${h.project}`), title: h.title, snippet: h.snippet, prompts: h.prompts, updated_at: now - h.ago * 3_600_000 }))
    .filter((h) => !q || `${h.title} ${h.snippet} ${h.cwd}`.toLowerCase().includes(q))
    .slice(0, p.limit ?? 30);
}

export const transcribe = () => ({ text: "Run the tests again and tell me what failed." });

export const callPreview = () => ({ d: toBase64(""), rate: 24_000 });

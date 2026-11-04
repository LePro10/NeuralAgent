// NeuralAgent admin example connector: problem reports through the relay admin API with a
// scoped API key (reports:read, reports:reply). Not built in; install with "Add existing".
// Copy this folder and its lib: it imports ./lib/connector.mjs, so keep that file next to it.
import { pathToFileURL } from "node:url";
import { ConnectorError, config, secret, createServer, fetchJson, clip, getState, setState } from "./lib/connector.mjs";

export function build({ env = process.env, fetchImpl = globalThis.fetch, retryScale = 1, output = process.stdout } = {}) {
  async function admin(path, init = {}) {
    const key = secret("api_key", env);
    const base = String(config(env).base_url || "https://agent.neuralhub.dev").replace(/\/+$/, "");
    if (!key) throw new ConnectorError("No API key yet. Paste it in the setup form first.");
    if (!/^https?:\/\//.test(base)) throw new ConnectorError("The relay address must start with https://.");
    return fetchJson(base + "/api/admin" + path, {
      ...init,
      fetchImpl,
      retryScale,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "User-Agent": "NeuralAgent", ...(init.headers || {}) },
    });
  }
  const id = (v) => {
    if (!/^R-[A-Z0-9]{4,12}$/.test(String(v || ""))) throw new ConnectorError('A report id looks like "R-7F3K2Q".');
    return v;
  };
  const brief = (r) => ({ id: r.id, status: r.status, summary: r.summary, app: r.app, version: r.version, os: r.os, from: r.email || "anonymous", signed_in: !!r.user_id, created: r.created_at });

  const tools = {
    check_connection: {
      description: "Check the key and the address.",
      run: async () => {
        const j = await admin("/reports");
        return { text: `Connected, ${j.reports.length} reports (${j.reports.filter((r) => r.status === "open").length} open)` };
      },
    },
    list_reports: {
      description: "Problem reports, newest first.",
      schema: { status: { type: "string", enum: ["open", "seen", "solved"] }, limit: { type: "number" } },
      run: async ({ status, limit = 30 }) => {
        const j = await admin("/reports");
        return j.reports.filter((r) => !status || r.status === status).slice(0, +limit || 30).map(brief);
      },
    },
    get_report: {
      description: "One report with its text, the diagnostics summary and the answers so far.",
      schema: { id: { type: "string" } },
      required: ["id"],
      run: async ({ id: rid }) => {
        const j = await admin(`/reports/${id(rid)}`);
        const d = j.report.diagnostics;
        return { ...brief(j.report), details: clip(j.report.details, 8000), note: j.report.note, diagnostics: clip(typeof d === "string" ? d : JSON.stringify(d ?? {}), 6000), answers: j.answers || [] };
      },
    },
    set_status: {
      description: "Set the status of a report (open, seen, solved) without writing to the reporter.",
      schema: { id: { type: "string" }, status: { type: "string", enum: ["open", "seen", "solved"] } },
      required: ["id", "status"],
      run: async ({ id: rid, status }) => {
        await admin(`/reports/${id(rid)}`, { method: "POST", body: JSON.stringify({ status }) });
        return { ok: true, id: rid, status };
      },
    },
    reply_report: {
      description: "Answer the reporter. They see it in the app and get a notification. Only works for signed-in reports.",
      schema: { id: { type: "string" }, text: { type: "string" }, status: { type: "string", enum: ["open", "seen", "solved"], description: "default seen" } },
      required: ["id", "text"],
      run: async ({ id: rid, text, status }) => {
        const j = await admin(`/reports/${id(rid)}/reply`, { method: "POST", body: JSON.stringify({ text, status }) });
        return { sent: true, answers: j.answers?.length ?? 0 };
      },
    },
    poll: {
      description: "Returns { events } for reports not seen before. The first call only remembers what exists.",
      run: async () => {
        const j = await admin("/reports");
        const seen = getState("seen", null, env);
        const next = new Set(seen || []);
        const events = [];
        for (const r of j.reports) {
          if (next.has(r.id)) continue;
          next.add(r.id);
          if (seen) events.push({ type: "report", id: `neuralagent-report:${r.id}`, title: r.summary, text: clip(r.details || r.summary, 6000), author: r.email || undefined, meta: { report_id: r.id, app: r.app, version: r.version, os: r.os, signed_in: !!r.user_id } });
        }
        setState("seen", [...next].slice(-2000), env);
        return { events };
      },
    },
  };

  const server = createServer({ name: "neuralagent-admin", version: "1.0.0", tools, output });
  return { server, tools, start: () => server.serve() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) build().start();

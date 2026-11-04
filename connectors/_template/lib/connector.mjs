// NeuralAgent connector helper: a zero-dependency MCP stdio server for Node 22+.
//
// HOW A CONNECTOR IMPORTS THIS FILE
//   Built-in connectors (connectors/<id>/index.mjs) do:   import ... from "../_lib/connector.mjs";
//   The daemon writes connectors/<id>/ and connectors/_lib/ side by side under
//   <home>/connectors/builtin/, so the relative import works.
//   User connectors are self-contained: the template carries its own copy at
//   lib/connector.mjs and imports "./lib/connector.mjs". (A test keeps the copy identical.)
//
// CONTRACT (see docs/notes/autopilot.md): newline-delimited JSON-RPC 2.0 on stdin/stdout
// (initialize, tools/list, tools/call, ping). Config in env NA_CONFIG (JSON, non-secret fields),
// secrets in NA_SECRET_<KEY>, writable folder in NA_STATE_DIR. Events go out as the notification
// "notifications/neuralagent/event". Logs go to stderr only; never log secret values.

import fs from "node:fs";
import path from "node:path";

export const EVENT_METHOD = "notifications/neuralagent/event";

/** Non-secret setup values. */
export function config(env = process.env) {
  try {
    const v = JSON.parse(env.NA_CONFIG || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/** A secret setup value ("" when not set). Key `bot_token` reads NA_SECRET_BOT_TOKEN. */
export function secret(key, env = process.env) {
  return env["NA_SECRET_" + String(key).toUpperCase().replace(/[^A-Z0-9]/g, "_")] || "";
}

export function log(...args) {
  process.stderr.write(args.map((a) => (typeof a === "string" ? a : safeJson(a))).join(" ") + "\n");
}

function safeJson(v) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** A problem the user can understand. Its message is shown to the pilot as is. */
export class ConnectorError extends Error {}

// ---- state (cursors, last ids) ----

function stateFile(name, env = process.env) {
  const dir = env.NA_STATE_DIR || path.join(process.cwd(), ".state");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, String(name).replace(/[^a-zA-Z0-9_.-]/g, "_") + ".json");
}

export function getState(name, fallback = null, env = process.env) {
  try {
    return JSON.parse(fs.readFileSync(stateFile(name, env), "utf8"));
  } catch {
    return fallback;
  }
}

export function setState(name, value, env = process.env) {
  fs.writeFileSync(stateFile(name, env), JSON.stringify(value));
}

// ---- HTTP helpers ----

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function plainStatus(status, host) {
  if (status === 401) return `${host} refused the sign-in (401). The key or token is wrong or has expired.`;
  if (status === 403) return `${host} says this is not allowed (403). The key or token may lack a permission.`;
  if (status === 404) return `${host} could not find that (404). Check the address or the name.`;
  if (status === 429) return `${host} says too many requests (429). Try again in a minute.`;
  if (status >= 500) return `${host} has a problem on its side (${status}). Try again later.`;
  return `${host} answered with error ${status}.`;
}

/**
 * fetch + JSON with plain-word errors. Retries on 429 (honours Retry-After, up to `retries`).
 * Options: normal fetch init plus { retries = 2, text = false, timeoutMs = 30000, fetchImpl }.
 */
export async function fetchJson(url, opts = {}) {
  const { retries = 2, text = false, timeoutMs = 30000, fetchImpl = globalThis.fetch, ...init } = opts;
  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return "The server";
    }
  })();
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetchImpl(url, { ...init, signal: init.signal || AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      throw new ConnectorError(`Could not reach ${host}: ${e?.cause?.code || e?.message || e}. Check the internet connection and the address.`);
    }
    if (res.status === 429 && attempt < retries) {
      let wait = Number(res.headers?.get?.("retry-after")) || 0;
      try {
        // Discord and others also put retry_after (seconds, maybe fractional) in the JSON body.
        const j = JSON.parse(await res.text());
        wait = Math.max(wait, Number(j?.retry_after) || 0);
      } catch {}
      wait = Math.min(wait || 1, 30);
      await sleep(wait * 1000 * (opts.retryScale ?? 1));
      continue;
    }
    if (!res.ok) {
      let detail = "";
      try {
        const body = await res.text();
        const j = JSON.parse(body);
        detail = j.message || j.error?.message || j.error || "";
        if (typeof detail !== "string") detail = "";
      } catch {}
      throw new ConnectorError(plainStatus(res.status, host) + (detail ? ` (${String(detail).slice(0, 200)})` : ""));
    }
    if (res.status === 204) return null;
    if (text) return await res.text();
    try {
      return await res.json();
    } catch {
      throw new ConnectorError(`${host} did not answer with JSON.`);
    }
  }
}

/** Clip long text so one tool result stays small. */
export function clip(s, n = 4000) {
  s = String(s ?? "");
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// ---- tool schemas ----

const TYPE_ALIASES = {
  bool: "boolean", int: "integer", long: "integer", float: "number", double: "number",
  str: "string", text: "string", list: "array", dict: "object", map: "object",
};
const JSON_TYPES = ["string", "number", "integer", "boolean", "array", "object", "null"];

function fixType(t) {
  const one = (x) => {
    const l = String(x).trim().toLowerCase();
    return JSON_TYPES.includes(l) ? l : TYPE_ALIASES[l];
  };
  if (Array.isArray(t)) {
    const out = [...new Set(t.map(one).filter(Boolean))];
    return out.length === 0 ? undefined : out.length === 1 ? out[0] : out;
  }
  return one(t);
}

/**
 * Tool params are JSON Schema: types are string, number, integer, boolean, array, object.
 * ("bool" is only a setup-field kind in connector.json.) This repairs the common slips
 * (bool, int, float, str, list, dict) in a "properties" object, recursively.
 */
export function fixSchemaTypes(node) {
  if (Array.isArray(node)) return node.map(fixSchemaTypes);
  if (!node || typeof node !== "object") return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === "type" && (typeof v === "string" || Array.isArray(v))) {
      const t = fixType(v);
      if (t !== undefined) out.type = t;
    } else if (k === "properties" && v && typeof v === "object" && !Array.isArray(v)) {
      out.properties = Object.fromEntries(Object.entries(v).map(([n, p]) => [n, fixSchemaTypes(p)]));
    } else if (k === "items" || k === "additionalProperties" || k === "anyOf" || k === "oneOf" || k === "allOf") {
      out[k] = fixSchemaTypes(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ---- the server ----

/**
 * createServer({ name, version, tools, input, output })
 * tools: { tool_name: { description, schema?: JSON schema "properties" object, required?: [], run(args) } }
 * run() returns any JSON value (stringified into the text content) or a string.
 * Returns { handle(msg) -> response|null, emit(event), serve() }.
 */
export function createServer({ name, version = "1.0.0", tools = {}, input = process.stdin, output = process.stdout }) {
  const write = (obj) => output.write(JSON.stringify(obj) + "\n");

  function emit(event) {
    if (!event || !event.id) return;
    write({ jsonrpc: "2.0", method: EVENT_METHOD, params: event });
  }

  function listTools() {
    return Object.entries(tools).map(([n, t]) => {
      const properties = Object.fromEntries(Object.entries(t.schema || {}).map(([k, v]) => [k, fixSchemaTypes(v)]));
      const required = (t.required || []).filter((r) => Object.hasOwn(properties, r));
      return { name: n, description: t.description || "", inputSchema: { type: "object", properties, required } };
    });
  }

  async function handle(msg) {
    const { id, method, params } = msg || {};
    const reply = (result) => (id === undefined ? null : { jsonrpc: "2.0", id, result });
    const fail = (code, message) => (id === undefined ? null : { jsonrpc: "2.0", id, error: { code, message } });
    switch (method) {
      case "initialize":
        return reply({
          protocolVersion: params?.protocolVersion || "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name, version },
        });
      case "ping":
        return reply({});
      case "tools/list":
        return reply({ tools: listTools() });
      case "tools/call": {
        const tool = tools[params?.name];
        if (!tool) return fail(-32602, `Unknown tool: ${params?.name}`);
        try {
          const out = await tool.run(params?.arguments || {});
          const text = typeof out === "string" ? out : JSON.stringify(out ?? null);
          return reply({ content: [{ type: "text", text }] });
        } catch (e) {
          if (!(e instanceof ConnectorError)) log("tool error", params.name, e?.stack || e);
          const m = e instanceof ConnectorError ? e.message : `Something went wrong: ${e?.message || e}`;
          return reply({ content: [{ type: "text", text: m }], isError: true });
        }
      }
      default:
        if (typeof method === "string" && method.startsWith("notifications/")) return null;
        return fail(-32601, `Method not found: ${method}`);
    }
  }

  function serve() {
    let buf = "";
    input.setEncoding?.("utf8");
    input.on("data", (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
          continue;
        }
        handle(msg).then((r) => r && write(r));
      }
    });
    input.on("end", () => process.exit(0));
  }

  return { handle, emit, serve };
}

/** Pull-down for pick fields: [{ value, label }]. */
export const options = (items, value, label) => items.map((x) => ({ value: String(value(x)), label: String(label(x)) }));

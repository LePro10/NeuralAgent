// Web API connector: GET and write calls to one base URL with an optional auth header.
import { pathToFileURL } from "node:url";
import { ConnectorError, config, secret, createServer, clip } from "../_lib/connector.mjs";

/** Resolve `p` against `base`, refusing anything that leaves the base URL. */
export function resolveUnder(base, p) {
  let b;
  try { b = new URL(base); } catch { throw new ConnectorError("The base address is not a valid web address."); }
  if (!/^https?:$/.test(b.protocol)) throw new ConnectorError("The base address must start with http:// or https://.");
  const basePath = b.pathname.replace(/\/+$/, "");
  const raw = String(p ?? "");
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//")) throw new ConnectorError("Give a path like /items, not a full address. Calls must stay under the base address.");
  const u = new URL(basePath + "/" + raw.replace(/^\/+/, ""), b.origin);
  const decoded = decodeURIComponent(u.pathname);
  if (u.origin !== b.origin || !(u.pathname === basePath || u.pathname.startsWith(basePath + "/")) || decoded.split("/").includes("..")) {
    throw new ConnectorError("That path leaves the base address, which is not allowed.");
  }
  return u;
}

export function build({ env = process.env, fetchImpl = globalThis.fetch, output = process.stdout } = {}) {
  async function request(method, p, { body, query } = {}) {
    const cfg = config(env);
    if (!cfg.base_url) throw new ConnectorError("No base address yet. Enter it in the setup form.");
    const u = resolveUnder(cfg.base_url, p);
    for (const [k, v] of Object.entries(query || {})) u.searchParams.set(k, String(v));
    const headers = { Accept: "application/json, text/plain, */*", "User-Agent": "NeuralAgent" };
    const val = secret("auth_value", env);
    if (cfg.auth_header && val) headers[cfg.auth_header] = val;
    const init = { method, headers, redirect: "manual", signal: AbortSignal.timeout(30000) };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = typeof body === "string" ? body : JSON.stringify(body);
    }
    let res;
    try { res = await fetchImpl(u, init); } catch (e) { throw new ConnectorError(`Could not reach ${u.host}: ${e?.cause?.code || e?.message}. Check the address and the internet connection.`); }
    if (res.status >= 300 && res.status < 400) throw new ConnectorError(`${u.host} redirected the call (${res.status}); redirects are not followed. Use the final address as base address.`);
    const text = await res.text();
    let data = text;
    try { data = JSON.parse(text); } catch {}
    if (!res.ok) throw new ConnectorError(`${u.host} answered ${res.status}${res.status === 401 || res.status === 403 ? " (the key is missing or not allowed)" : ""}: ${clip(typeof data === "string" ? data : JSON.stringify(data), 500)}`);
    return { status: res.status, data: typeof data === "string" ? clip(data, 20000) : data };
  }

  const tools = {
    check: {
      description: "Call the test path with GET to prove the address and key work.",
      run: async () => {
        const r = await request("GET", config(env).test_path || "/");
        return { text: `Reached ${new URL(config(env).base_url).host} (status ${r.status})` };
      },
    },
    get: {
      description: "GET a path under the base address.",
      schema: { path: { type: "string", description: "e.g. /items/12" }, query: { type: "object", description: "query parameters" } },
      required: ["path"],
      run: ({ path, query }) => request("GET", path, { query }),
    },
    send: {
      description: "POST, PUT, PATCH or DELETE a path under the base address. Changes data on your service.",
      schema: { method: { type: "string", enum: ["POST", "PUT", "PATCH", "DELETE"] }, path: { type: "string" }, body: { description: "JSON body" } },
      required: ["method", "path"],
      run: ({ method, path, body }) => {
        const m = String(method).toUpperCase();
        if (!["POST", "PUT", "PATCH", "DELETE"].includes(m)) throw new ConnectorError("The method must be POST, PUT, PATCH or DELETE. Use get for reading.");
        return request(m, path, { body });
      },
    },
  };

  const server = createServer({ name: "web-api", version: "1.0.0", tools, output });
  return { server, tools, start: () => server.serve() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) build().start();

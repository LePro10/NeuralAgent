// Starting point for a NeuralAgent connector. Replace the example tools below; keep the shape.
// Rules and contract: see CLAUDE.md in this folder.
import { pathToFileURL } from "node:url";
import { ConnectorError, config, secret, createServer, fetchJson, clip } from "./lib/connector.mjs";

export function build({ env = process.env, fetchImpl = globalThis.fetch, output = process.stdout } = {}) {
  // One place for every HTTP call: base address from setup, token from the environment.
  async function call(path, init = {}) {
    const base = String(config(env).base_url || "").replace(/\/+$/, "");
    const token = secret("api_token", env);
    if (!base) throw new ConnectorError("No address yet. Enter it in the setup form.");
    if (!token) throw new ConnectorError("No access token yet. Paste it in the setup form.");
    return fetchJson(base + path, { ...init, fetchImpl, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  }

  const tools = {
    whoami: {
      description: "Check the setup. Returns who the token belongs to.",
      run: async () => {
        const me = await call("/me");
        return { text: `Signed in as ${me.name}`, name: me.name };
      },
    },
    list_items: {
      description: "List items. (Example tool: replace it.)",
      schema: { limit: { type: "number", description: "default 20" } },
      run: async ({ limit = 20 }) => (await call(`/items?limit=${+limit || 20}`)).map((i) => ({ id: i.id, title: clip(i.title, 200) })),
    },
    post_note: {
      description: "Add a note to an item. Changes data. (Example tool: replace it.)",
      schema: { id: { type: "string" }, text: { type: "string" } },
      required: ["id", "text"],
      run: async ({ id, text }) => {
        await call(`/items/${encodeURIComponent(id)}/notes`, { method: "POST", body: JSON.stringify({ text }) });
        return { ok: true };
      },
    },
  };

  const server = createServer({ name: "my-connector", version: "0.1.0", tools, output });
  // Push events (a chat, a socket): call server.emit({ type, id, text, author?, url?, title?, meta? }).
  // Polling sources: add a "poll" tool that returns { events: [...] } and "poll" to connector.json.
  return { server, tools, start: () => server.serve() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) build().start();

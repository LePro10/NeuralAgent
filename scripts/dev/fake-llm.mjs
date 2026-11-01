// Fake OpenAI-compatible streaming chat endpoint, so Neural answers without a real model.
//
// Env: FAKE_LLM_PORT (default 11499), ANSWER (the text it streams back by default).
// Scripted mode (Neural tests): FAKE_LLM_SCRIPT=<rules.json>, FAKE_LLM_LOG=<requests.jsonl>.
// Rules are tried in order; the first whose conditions all match answers:
//   { "user": "regex",   // the last user-side message (also "(system) Wake-up …" notes)
//     "tool": "name",    // the last message is the result of this tool
//     "world": "regex",  // the instructions + <world> block
//     "once": true,      // fire at most once
//     "say": "text" | "call": { "name": "start_agent", "args": { … } } }
// In `args` and `say`, {{agent}} is the first agent short id in the world block ("[ab12cd]").
// Without a matching rule: "(quiet)" for a wake-up, otherwise ANSWER.
import http from "node:http";
import { appendFileSync, readFileSync } from "node:fs";

const PORT = Number(process.env.FAKE_LLM_PORT ?? 11499);
const ANSWER =
  process.env.ANSWER ??
  "Three agents are busy right now. **Builder** in landing-site is changing the greeting, the **Reviewer** waits for it, and Codex in api-server needs your OK to run the tests. Want me to approve it?";
const rules = process.env.FAKE_LLM_SCRIPT ? JSON.parse(readFileSync(process.env.FAKE_LLM_SCRIPT, "utf8")) : [];
const used = new Set();
let n = 0;

function decide(body) {
  const msgs = body.messages ?? [];
  const system = msgs.filter((m) => m.role === "system").map((m) => m.content).join("\n");
  const last = msgs.at(-1);
  const lastUser = [...msgs].reverse().find((m) => m.role === "user")?.content ?? "";
  let lastTool = null;
  if (last?.role === "tool") {
    for (const m of msgs) for (const c of m.tool_calls ?? []) if (c.id === last.tool_call_id) lastTool = c.function.name;
  }
  const agent = /\[([0-9A-Za-z_-]{6})\]/.exec(system.slice(system.indexOf("<world>")))?.[1] ?? "";
  const fill = (s) => s.replaceAll("{{agent}}", agent);
  for (const [i, r] of rules.entries()) {
    if (r.once && used.has(i)) continue;
    if (r.user && (last?.role !== "user" || !new RegExp(r.user, "i").test(lastUser))) continue;
    if (r.tool && lastTool !== r.tool) continue;
    if (!r.tool && last?.role === "tool") continue;
    if (r.world && !new RegExp(r.world, "i").test(system)) continue;
    used.add(i);
    if (r.call) return { call: { name: r.call.name, args: JSON.parse(fill(JSON.stringify(r.call.args ?? {}))) }, rule: i };
    return { say: fill(r.say ?? ""), rule: i };
  }
  if (last?.role === "tool") return { say: "Done.", rule: null };
  return { say: /^\(system\) Wake-up/.test(lastUser) ? "(quiet)" : ANSWER, rule: null };
}

http
  .createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", async () => {
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {}
      const out = decide(body);
      n += 1;
      if (process.env.FAKE_LLM_LOG) appendFileSync(process.env.FAKE_LLM_LOG, JSON.stringify({ n, at: Date.now(), out, messages: body.messages, tools: (body.tools ?? []).map((t) => t.function?.name) }) + "\n");
      res.writeHead(200, { "content-type": "text/event-stream" });
      const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      if (out.call) {
        send({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: `call${n}`, function: { name: out.call.name, arguments: JSON.stringify(out.call.args) } }] } }] });
      } else {
        for (const w of out.say.split(/(?<= )/)) {
          send({ choices: [{ index: 0, delta: { content: w } }] });
          await new Promise((r) => setTimeout(r, 10));
        }
      }
      send({ choices: [{ index: 0, delta: {}, finish_reason: out.call ? "tool_calls" : "stop" }] });
      send({ choices: [], usage: { prompt_tokens: Math.round(raw.length / 4), completion_tokens: 20 } });
      res.write("data: [DONE]\n\n");
      res.end();
    });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`fake LLM on http://127.0.0.1:${PORT}/v1`));

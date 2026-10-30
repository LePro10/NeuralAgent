// A stand-in for an agent CLI in tests: no model, a fixed part per swarm role. It reads prompts
// like a terminal UI does (bracketed paste, then Enter) and talks to its team through the swarm's
// MCP bridge (`neuralagentd swarm-mcp`), exactly like a real agent would.
// Env: FAKE_AGENT_DAEMON = path to neuralagentd.
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const bridge = spawn(process.env.FAKE_AGENT_DAEMON, ["swarm-mcp"], { stdio: ["pipe", "pipe", "inherit"] });
let nextId = 0;
const waiting = new Map();
createInterface({ input: bridge.stdout }).on("line", (l) => {
  const m = JSON.parse(l);
  waiting.get(m.id)?.(m);
  waiting.delete(m.id);
});
const rpc = (method, params) =>
  new Promise((r) => {
    const id = ++nextId;
    waiting.set(id, r);
    bridge.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fake-agent", version: "0" } });
const tools = (await rpc("tools/list", {})).result.tools.map((t) => t.name);
console.log(`fake agent ready (tools: ${tools.join(", ")})`);

async function send(to, text) {
  const r = await rpc("tools/call", { name: "send_message", arguments: { to, text } });
  console.log(`→ ${to}: ${r.result.content[0].text}`);
}

let role = "";
async function onPrompt(text) {
  console.log(`> ${text.split("\n")[0]}`);
  // Busy for a moment, like a model thinking.
  for (let i = 0; i < 3; i++) {
    console.log(`working ${i + 1}/3`);
    await sleep(300);
  }
  role ||= text.match(/You are the (\w+)/)?.[1] ?? "";
  const from = text.match(/Message from (\w+)/)?.[1];
  if (role === "Coordinator" && !from) await send("Scout", "Find out where the greeting lives.");
  else if (role === "Coordinator" && from === "Scout") await send("Builder", "Change the greeting in hello.txt to: Hello, swarm.");
  else if (role === "Coordinator" && from === "Reviewer") await send("you", "Done: the greeting in hello.txt is changed and reviewed.");
  else if (role === "Scout" && from === "Coordinator") await send("Coordinator", "It is in hello.txt.");
  else if (role === "Builder" && from === "Coordinator") {
    writeFileSync("hello.txt", "Hello, swarm.\n");
    await send("Reviewer", "Changed hello.txt, please check.");
  } else if (role === "Reviewer" && from === "Builder") {
    const ok = readFileSync("hello.txt", "utf8").trim() === "Hello, swarm.";
    await send("Coordinator", ok ? "hello.txt looks good." : "hello.txt is wrong.");
  }
  console.log("turn done");
}

let queue = Promise.resolve();
let buf = "";
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => {
  buf += d;
  for (let m; (m = buf.match(/\x1b\[200~([\s\S]*?)\x1b\[201~/)); ) {
    buf = buf.slice(m.index + m[0].length);
    const text = m[1];
    queue = queue.then(() => onPrompt(text));
  }
  if (buf.includes("\x03")) process.exit(0);
});

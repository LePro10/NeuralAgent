// A talkative stand-in swarm member for UI checks (seed step `swarms`): on its brief it sends a
// scripted burst of messages to its team and to you, of mixed length, so the Swarm feed has
// enough to scroll, wrap and group. No model. Env: FAKE_AGENT_DAEMON = path to neuralagentd.
import { spawn } from "node:child_process";
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
await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "chatty-agent", version: "0" } });

const LINES = {
  Coordinator: [
    ["Scout", "Map the checkout flow: which components render the form, where validation lives, and which tests cover it."],
    ["Designer", "Pull the new spacing and colour tokens and list every place the old ones are still used."],
    ["Builder", "Start with the address step. Keep the old form behind a flag until the reviewer signs off."],
    ["you", "Plan: 1) map the flow, 2) swap tokens, 3) rebuild the address and payment steps, 4) review and test. I will report after each step."],
    ["Tester", "Write a regression test for the postcode field before the builder touches it."],
  ],
  Scout: [
    ["Coordinator", "The form lives in src/checkout/CheckoutForm.tsx (412 lines). Validation is in src/checkout/rules.ts; the payment step pulls in a second copy of the same rules."],
    ["Builder", "Heads-up: AddressFields uses a hard-coded 13px font and three raw hex colours."],
    ["Coordinator", "Tests: checkout.spec.ts covers the happy path only. Nothing covers an invalid postcode."],
  ],
  Designer: [
    ["Coordinator", "Old tokens are still used in 14 places. The worst are the error states: red on red, below AA contrast."],
    ["Builder", "Use the field well style from the design system for every input; the focus ring is part of it."],
  ],
  Builder: [
    ["Reviewer", "Address step rebuilt on the new tokens. Diff: 3 files, +120 −188. The flag is checkout.newForm."],
    ["Coordinator", "Payment step is next. One question: should the saved cards list stay above the new card form?"],
    ["Reviewer", "Payment step done as well; I removed the duplicated rules and import them from rules.ts."],
  ],
  Reviewer: [
    ["Builder", "Address step looks good. One nit: the postcode error appears before you finish typing. Validate on blur instead."],
    ["Coordinator", "Payment step approved after the blur fix. Ready to turn the flag on for staff."],
  ],
  Tester: [
    ["Coordinator", "Regression test added: an invalid postcode now shows one error under the field and keeps the button disabled."],
    ["you", "All 38 checkout tests pass on the new form (2 m 14 s)."],
  ],
};

let role = "";
let spoke = false;
process.stdin.setEncoding("utf8");
if (process.stdin.isTTY) process.stdin.setRawMode(true);
let buf = "";
process.stdin.on("data", async (d) => {
  buf += d;
  if (buf.includes("\x03")) process.exit(0);
  const m = buf.match(/\x1b\[200~([\s\S]*?)\x1b\[201~/);
  if (!m) return;
  buf = buf.slice(m.index + m[0].length);
  role ||= m[1].match(/You are the (\w+)/)?.[1] ?? "";
  console.log(`> ${m[1].split("\n")[0]}`);
  if (spoke || !LINES[role]) return;
  spoke = true;
  // Interleave the members a little: each starts after its own delay.
  await sleep(300 + Object.keys(LINES).indexOf(role) * 250);
  for (const [to, text] of LINES[role]) {
    await rpc("tools/call", { name: "send_message", arguments: { to, text } });
    await sleep(400);
  }
  console.log("turn done");
});

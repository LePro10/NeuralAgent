// A small, static Autopilot for the demo (D87): one pilot on web-shop, two connectors, a few inbox items.
// The demo does not run a pilot: requests are accepted and change nothing.

import type { AutopilotState, Connector, ConnectorManifest, Playbook } from "@neuralagent/protocol";

const MIN = 60_000;

function manifest(name: string, icon: string, description: string, kind: ConnectorManifest["kind"], tools: ConnectorManifest["tools"]): ConnectorManifest {
  return { name, icon, description, kind, version: "1", setup: [], guide: [], tools, events: [] };
}

function connector(id: string, m: ConnectorManifest, status: Connector["status"]): Connector {
  const tools = Object.entries(m.tools).map(([name, cls]) => ({ name, description: name.replace(/_/g, " "), class: cls }));
  return { id, manifest: m, builtin: true, enabled: status === "running", status, config: {}, secrets_set: [], tools, path: `/Users/demo/.neuralagent/connectors/${id}` };
}

export function autopilotSeed(workspaceId: string, now: number): AutopilotState {
  const playbook: Playbook = {
    mission: "Keep the shop's Discord and GitHub tidy. Turn real bugs into fixes and answer questions kindly.",
    instructions: "Never promise dates. Ask before posting anywhere.",
    tone: "Friendly and short",
    routines: [{ id: "r1", task: "Read new Discord messages and sort them", schedule: { kind: "every", minutes: 30 }, enabled: true }],
    sources: [{ connector_id: "discord", listen: true, scope: {} }],
    rules: [],
    notify: "needs_you",
  };
  return {
    pilots: [
      {
        id: "pilot-shop", workspace_id: workspaceId, name: "Shop autopilot", enabled: true, status: "needs_you", activity: undefined,
        playbook, setup_done: true, last_run: now - 12 * MIN, next_run: now + 18 * MIN, created: now - 3 * 24 * 60 * MIN,
      },
    ],
    items: [
      {
        id: "item-1", pilot_id: "pilot-shop", source: "discord", kind: "bug", title: "Cart total is wrong with a coupon",
        summary: "A customer says the total ignores the 10% coupon when two items are in the cart.",
        original: "hey, i added two shirts and the code SPRING10 but the total did not change?? is this broken", author: "mia_k",
        status: "needs_you", urgency: 2,
        steps: [{ at: now - 20 * MIN, text: "Read the message in #support", ok: true }, { at: now - 19 * MIN, text: "Found the coupon code in src/cart.ts", ok: true }],
        draft: { text: "Thanks for telling us, Mia! We found the cause and a fix is on its way. We will tell you when it is live.", connector_id: "discord", tool: "send_message", args: {} },
        created: now - 21 * MIN, updated: now - 19 * MIN,
      },
      {
        id: "item-2", pilot_id: "pilot-shop", source: "discord", kind: "question", title: "Do you ship to Canada?",
        summary: "A visitor asks whether orders can be shipped to Canada.", original: "do you ship to canada?", author: "tom88",
        status: "new", urgency: 1, steps: [], created: now - 40 * MIN, updated: now - 40 * MIN,
      },
      {
        id: "item-3", pilot_id: "pilot-shop", source: "github", kind: "feedback", title: "Add a wishlist",
        summary: "Three people asked for a wishlist this week.", original: "Feature request: wishlist", author: "sam",
        status: "done", urgency: 0, steps: [{ at: now - 3 * 60 * MIN, text: "Linked to the existing task", ok: true }], created: now - 4 * 60 * MIN, updated: now - 3 * 60 * MIN,
      },
    ],
    messages: [
      { id: "m1", pilot_id: "pilot-shop", role: "pilot", text: "I sorted 6 new messages. One bug needs your look: the coupon does not apply to two items.", at: now - 12 * MIN, item_id: "item-1", proactive: true, steps: ["Read 6 Discord messages"] },
    ],
    pending: [],
    suggestions: [],
    connectors: [
      connector("discord", manifest("Discord", "discord", "Read and answer messages in your server.", "service", { read_messages: "read", send_message: "external" }), "running"),
      connector("github", manifest("GitHub", "github", "Issues and pull requests.", "api", { list_issues: "read", comment: "write" }), "needs_setup"),
    ],
    browser: { connected: false },
  };
}

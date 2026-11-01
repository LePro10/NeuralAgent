// Classic swarms of the Teams page: one that is still talking (with a message queued for a busy
// member) and one that has ended. Their members are real sessions; the messages are scripted on the
// world clock, so they keep arriving after the scene is built.

import type { Swarm, SwarmMessage } from "@neuralagent/protocol";
import { createSession } from "./agents/spawn.ts";
import type { Sim } from "./sim.ts";

const SEC = 1000;

type Line = [at: number, from: string, to: string, text: string, queued?: boolean];

function member(sim: Sim, workspaceId: string, role: string, profileId: string, goal: string): { role: string; session_id: string } {
  const s = createSession(sim, { workspaceId, profileId, title: `${role}: ${goal.slice(0, 34)}`, prompt: `${role}: ${goal}`, place: false });
  return { role, session_id: s.id };
}

function play(sim: Sim, swarm: Swarm, lines: Line[]) {
  for (const [at, from, to, text, queued] of lines) {
    const id = sim.id("swm");
    const send = (delivered: boolean) => {
      const m: SwarmMessage = { id, swarm_id: swarm.id, from, to, text, at: sim.now(), delivered };
      sim.emit({ e: "swarm_message", message: m });
    };
    void sim.clock
      .sleep(at, sim.scope)
      .then(() => {
        send(!queued);
        // A message to a busy member waits in its queue, then goes through.
        if (queued) void sim.clock.sleep(9 * SEC, sim.scope).then(() => send(true)).catch(() => {});
      })
      .catch(() => {});
  }
}

/** A swarm in docs-site that is in the middle of its work. */
export function liveSwarm(sim: Sim, workspaceId: string): Swarm {
  const goal = "Add a Next section to the getting-started guide and check every link";
  const members = [member(sim, workspaceId, "Coordinator", "claude", goal), member(sim, workspaceId, "Scout", "codex", goal), member(sim, workspaceId, "Writer", "gemini", goal), member(sim, workspaceId, "Reviewer", "claude", goal)];
  const swarm: Swarm = { id: sim.id("swarm"), workspace_id: workspaceId, goal, members, started_at: sim.now(), ended: false };
  sim.emit({ e: "swarm_upsert", swarm });
  play(sim, swarm, [
    [300, "You", "Coordinator", `${goal}.`],
    [3 * SEC, "Coordinator", "Scout", "Find where the guide ends and which pages it should point to."],
    [8 * SEC, "Scout", "Coordinator", "The guide stops after \"Create your first invoice\" in docs/getting-started.md. Webhooks and Refunds are the natural next pages."],
    [10 * SEC, "Coordinator", "Writer", "Add a Next section with links to Webhooks and Refunds. Two sentences each."],
    [11 * SEC, "Coordinator", "You", "Scout found the end of the guide. Writer is drafting the Next section. I will ping you when Reviewer has checked the links."],
    [19 * SEC, "Writer", "Coordinator", "Draft is in docs/getting-started.md: a Next heading and two links with a sentence each."],
    [21 * SEC, "Coordinator", "Reviewer", "Check the links in the new section and read it once for tone."],
    [27 * SEC, "Reviewer", "Writer", "The Refunds link points to /refund, the page is /refunds. Otherwise good.", true],
    [30 * SEC, "Writer", "Reviewer", "Fixed, it points to /refunds now."],
    [38 * SEC, "Reviewer", "Coordinator", "Both links resolve and the section reads well. One small thing: use \"webhook\" in lower case in the sentence."],
    [44 * SEC, "Coordinator", "Writer", "Please fix the casing."],
    [52 * SEC, "Coordinator", "You", "Casing fixed, links verified. The guide has a Next section. Review the diff when you like."],
  ]);
  return swarm;
}

/** A swarm that finished yesterday and was stopped. */
export function endedSwarm(sim: Sim, workspaceId: string): Swarm {
  const goal = "Fix the broken links on the API page";
  const members = [member(sim, workspaceId, "Coordinator", "claude", goal), member(sim, workspaceId, "Builder", "codex", goal), member(sim, workspaceId, "Reviewer", "claude", goal)];
  const swarm: Swarm = { id: sim.id("swarm"), workspace_id: workspaceId, goal, members, started_at: sim.now(), ended: false };
  sim.emit({ e: "swarm_upsert", swarm });
  play(sim, swarm, [
    [300, "You", "Coordinator", `${goal}.`],
    [2 * SEC, "Coordinator", "Builder", "Run the link check on docs/api.md and fix what is broken."],
    [9 * SEC, "Builder", "Coordinator", "Three links were dead: /webhook, /refund and #auth. All three point to real pages now."],
    [11 * SEC, "Coordinator", "Reviewer", "Check Builder's three link fixes."],
    [17 * SEC, "Reviewer", "Coordinator", "All three resolve. Approved."],
    [19 * SEC, "Coordinator", "You", "Done: three links fixed and checked."],
  ]);
  void sim.clock
    .sleep(30 * SEC, sim.scope)
    .then(() => sim.emit({ e: "swarm_upsert", swarm: { ...swarm, ended: true } }))
    .catch(() => {});
  return swarm;
}

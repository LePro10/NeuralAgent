# Neural v2: a working colleague, not a launcher (2026-10-31)

**Teams/Swarm described here were removed (D88); Autopilot replaces them.** Decisions D61–D64. Code: `crates/na-daemon/src/orch.rs` (the turn engine, keys, folders) and
`crates/na-daemon/src/neural/` (world state, observer, pulse, tasks, teams, guard, memory, tools).
UI: `packages/app/src/components/NeuralPage.tsx`, `components/neural/*`, Teams in
`SwarmPage.tsx` / `components/swarm/*`.

## What was wrong
- **Feedback stuffed into the chat.** Every agent event became a `notice` message, and the model saw
  each one as a fake user message (`[log] Japan Map — Claude finished: …`). Thirty of these crowd
  out the real conversation, cost tokens every turn, repeat things that are no longer true
  ("needs input" for an agent that has long finished) and confuse "the user's latest message".
- **No memory of the goal.** Neural forgot why it started an agent. It never followed up, never
  looked at the result, never told you on its own.
- **Swarm** was a separate feature nobody used: four agents chatting through MCP, one of them a
  "Coordinator" burning tokens to do Neural's job.

## The model's context, rebuilt every turn
Three separate channels; nothing is appended to the chat that the user did not say or Neural did
not say to the user.

1. **System prompt (static).** Who Neural is, how it works, the rules. Same text every turn
   (cache friendly: Anthropic gets it as its own cached system block).
2. **World state (fresh, compact).** Rendered from the live state at every model step
   (`neural/world.rs`), never stored:
   - now, host, mode (active / quiet / off), how long since the user last talked to Neural;
   - **Tasks** Neural owns (id, status, goal, done-when, check, linked agents, last note);
   - **Agents**: one line each — short id, workspace, title, engine, status for N min, what it is
     doing (activity / last words, clipped), its open question or permission prompt, its task;
   - **New since your last turn**: the observation digest (below), coalesced, newest last;
   - **Waiting for the user**: confirmations Neural asked for;
   - **Memory**: the user's notes about preferences and projects;
   - workspaces and agent types.
3. **Conversation.** Only user ↔ Neural: user messages, Neural's answers (also the ones it sent on
   its own), and per Neural turn one compact line of what it did
   (`(did: started Claude in Japan Map [a1b2c3]; prompted …)`) folded into its own answer.
   Older parts are **compacted** into a short running summary (cheap call-model request once more
   than 30 turns piled up; the newest 14 stay verbatim). The summary is visible and part of the
   state (`neural.summary`).

A wake-up (Neural speaking on its own) adds one final `<observations>` user block for that call
only; it is never stored. If the model decides there is nothing worth saying it answers `(quiet)`
and nothing appears.

## Observations instead of notices
`neural/observe.rs` turns daemon events into **observations** (`neural.observations`, last 40):
done, waiting (with the prompt: tool + command, or the question), error, exited, stuck (working
without new output for 15 min), check passed/failed, auto-allowed, team steps. Same agent + same
kind within a minute coalesce. Each has `seen` (the model was shown it). The text keeps the old
notice shape ("Japan Map — Claude needs input: …") so the inbox can use it for "why it waits".
The UI shows them in Neural's "Seen" list, never as chat bubbles.

## Proactivity: the pulse
`neural/pulse.rs` (pure, tested with injected time) decides whether an observation wakes Neural:

| Observation | About a Neural task / team | Any other agent |
|---|---|---|
| waiting (permission / question) | wake (after auto-allow check) | digest only (the phone already got a push) |
| error, stuck | wake | digest only |
| done | wake: review it | digest only |
| check failed | wake | – |

Throttle: wake-ups are batched for 8 s (one wake covers everything that piled up), at least 45 s
apart, at most 12 per hour; nothing while a user turn runs (it is folded into that turn's
digest); mode **quiet** wakes only for waiting/error/task done, **off** never wakes. A wake runs
with at most 4 model steps. Neural's own reports carry `proactive: true` and render distinctly.

Push: agent events already push to phones (D34). Neural adds no second push for the same event;
"stuck" raises one `attention(waiting)` for that agent so the phone hears about it once.

"While you were away": the page shows, without any model call, what happened since the user's
last message when that was more than 30 minutes ago (counts + the rows), with **Catch me up**,
which asks Neural for the briefing; the world state tells the model how long the user was away.

## Tasks: Neural follows up until done
`neural/tasks.rs`. A task is a goal the user gave Neural: title, done-when, workspace, optional
check command, linked agents, status (open → working → review → done / blocked / failed), a
note. `start_agent` always links (creating a task from the prompt if none is named), so every
piece of work Neural started is tracked. When a linked agent finishes, Neural wakes with "review
it": it reads the transcript (`inspect_agent`: last answer, tools used, open prompt), the changes
(`agent_changes`: git files + clipped diff), runs the check (`run_check`), then either sends the
agent a follow-up or closes the task and tells the user in a sentence or two. The user sees the
plan on the page and can mark a task done or drop it.

## Memory
`neural.notes`: at most 40 short notes ("Prefers Codex for reviews", "japan-map deploys with
`pnpm ship`"). Neural writes them only when the user states a preference or asks it to remember
(`remember` / `forget`); the user sees, adds and deletes them on the page. Persisted with the
rest of Neural's state in `<data>/neural.json`.

## Safety: the guard
`neural/guard.rs`, pure and tested:
- **Destructive text** (`rm -rf`, `git push --force`, `reset --hard`, `clean -fd`, `branch -D`,
  drop table/database, `mkfs`, `dd of=`, …) in a prompt Neural wants to send or a command it wants
  to run → not sent; a **confirmation** appears on the page (Allow / Deny). Allow runs exactly the
  stored action (not a new model call), then Neural continues.
- **Auto-allow** an agent's permission prompt only for Neural's own agents and only for read-only
  tools (Read, Grep, Glob, LS, WebSearch, WebFetch) or allow-listed commands (tests, type checks,
  linters, builds, `git status|diff|log|show`) with no redirection, `sudo`, `rm` or chaining into
  anything else. Everything else is escalated to the user.
- `run_check` runs allow-listed commands directly (timeout 5 min, output tail); anything else
  needs a confirmation.
- Every Neural action is in the audit log: requests go through the normal client path
  (`ClientKind::Orchestrator`), and checks, auto-allows and confirmations are noted explicitly.

### Review hardening (D77)
Commands are checked strictly, prompts as prose (stated limits like "no force push" do not
trigger); an Allow answers only the agent prompt the user saw; "don't ask again" options need the
user; at most 6 wake-ups per task between user messages; team agents' turns do not wake Neural,
team results do; failed wake-ups show in the panel; model calls time out (90 s / 120 s stall).
Details: D77 in `docs/DECISIONS.md`.

## Swarm → Teams run by Neural (D62)
The free-form MCP swarm duplicated what Claude Code's own subagents and workflows already do
well inside one CLI. What NeuralAgent can do that one CLI cannot: run **different engines side by
side in separate worktrees** and judge them from the outside. So a team is now a Neural task with
a pattern, and Neural (deterministic code plus the model for judgment) is the coordinator:

- **Race (best of N).** The same brief to 2–4 agents (e.g. Claude, Codex, Gemini), each in its
  own git worktree. As each finishes Neural runs the check in its worktree and measures the
  change (files, +/−). When all are in, Neural reports a ranking with a recommendation; the user
  picks one: its worktree is merged and the others are thrown away.
- **Build + cross-review.** A builder does the work; when it finishes, a reviewer of another
  engine reviews the diff and ends with `VERDICT: APPROVED` or `VERDICT: CHANGES` plus a list.
  Changes go back to the builder (up to 3 rounds); approval closes the task and Neural reports.

The Swarm page becomes **Teams**: teams first (goal, pattern, attempts with check result and
change size, Use this / Open), classic swarms below as read-only history (Stop still works for a
running one). Old swarm data stays readable; `swarm_start` and the MCP bridge keep working for
old clients, but Neural no longer offers them.

## Protocol (additive, old builds keep working)
- `State.neural?: NeuralState` (tasks, notes, observations, pending, mode, summary, seen_at).
- Live updates travel as `host_notice { topic: "neural", data: NeuralState }`: builds before
  this one ignore host notices, whereas an unknown event type would break their `apply`.
- `OrchMessage.proactive?: bool`. Old builds show these as normal answers. Notices are no longer
  written into the conversation.
- Requests: `neural_mode`, `neural_task_edit`, `neural_note_add`, `neural_note_remove`,
  `neural_confirm`, `neural_team_start`, `neural_team_pick`.
- Calls and "Hey Neural" keep the same entry points (`orch_send`, `orch_stop`, `call_news`).

## Testing
Rust unit tests: world rendering (compact, no ids leak into labels, prompts shown), history
folding and compaction plan, pulse throttling/batching/modes, observation coalescing and stuck
detection, task linking and team transitions, guard classification. End-to-end:
`scripts/dev/fake-llm.mjs` scripted mode (rules → text and tool calls, request log) with a test
daemon (`scripts/dev/neural-e2e.mjs`). One short real-model smoke test on NeuralHub.

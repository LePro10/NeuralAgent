# Subagents and background work (D65, D66)

What the Claude view shows of the work a Claude Code session runs beside the main chat:
subagents (the `Agent`/`Task` tool, foreground and background, nested), background shells
(`Bash run_in_background`) and monitors. Phones and the desktop Claude view use the same parts.

## Where the data comes from (daemon, `crates/na-daemon/src/cv_tasks.rs`)

`Tasks` keeps one `CvTask` per piece of work and merges every source into it:

| Source | Gives |
| --- | --- |
| `tool_use` / `tool_result` in the main transcript | the task (by `tool_use_id`), title, type, background flag; `async_launched` gives the agent id |
| `<task-notification>` | final status, summary, tokens, tool count |
| hooks `SubagentStart` / `SubagentStop`, `subagentStatusLine` | start, end, last step while running |
| subagent files `<session>/subagents/agent-<id>.meta.json` + `.jsonl` (`scan`) | the agent id of a foreground agent, `parent` (nested), finished/stopped, last step, tokens, `active` |

The meta file carries `agentType`, `description`, `toolUseId`, `parentAgentId`, `spawnDepth`,
`requestShape` ("background"), `finished`, `stoppedByUser`. Nested agents sit flat in the same
folder; `scan` reads metas sorted by `spawnDepth` so a child links to a parent it has just seen.
A finished agent that was never seen running is skipped (old sessions stay quiet), unless its
parent or tool call is known. `scan` runs every 1.5 s while something runs and someone watches,
and right after `SubagentStart`; it looks at the newest 400 files.

`CvTask.active` (ms) = the subagent transcript's last write: the client shows "quiet for 2m".

Real sessions (Claude Code 2.1.316) showed two more cases:
- An agent whose turn ends while its own background shell runs gets an interim notification
  ("Agent "X" is waiting on its own background work", status `completed`, meta `finished`). It
  stays `running` with the label "Waiting for its own background work" (SubagentStop and the meta
  are ignored for it) until the next notification for the same id.
- A finished agent can be resumed (a message to it, or its background work reported). When its
  transcript gets an entry newer than its end (by the entry's timestamp, not the file mtime),
  it runs again.

`cv_attach { agent }` works as soon as the agent's meta file exists (or the task is known), not
only once its transcript is written: the view opens on "Starting…" and fills in live.

## Client (`packages/app/src/components/claude/`)

- `work.ts` (pure, tested in `src/lib/cvWork.test.ts`): status and kind of a task, its title,
  type and detail line ("Read clock.ts · quiet for 2m · 3m 10s · 21k tokens"), the summary
  ("3 agents running · 1 shell"), which items the strip keeps (`stripItems`: live ones, plus
  finished ones for `KEEP_MS` = 45 s after this client saw them end), and the tree (`workTree`:
  nested agents under their parent; 4+ agents of one parent started within 2.5 s become a group
  "5 Explore agents · 3 running · 2 done", e.g. a workflow or ultracode fan-out).
- `useWork.ts`: one shared 1 s clock (`useNow`), when a task ended on this client, fade timer.
- `WorkRow.tsx`: the one visual system: `WorkGlyph` (agent, shell, monitor, workflow; clay
  while live, danger when failed), `StatusIcon`, `WorkStatusLine`, `WorkRow` (≥ 56 px tall,
  indented per nesting level with `--cv-indent`), `GroupRow`, `WorkList`, `TaskOutput`.
- `WorkStrip.tsx`: the pill above the composer ("6 agents running · 1 shell · Read clock.ts").
  It unfolds upward into the list; a row opens the subagent; footer: "All tasks (n)" (the Tasks
  sheet) and "Stop background agents" (`cv_action stop_agents`, with a confirm sheet). Shown on
  phones and desktop, hidden on phones while a permission card holds the dock.
- `AgentCard.tsx`: the card in the transcript. Always a button while the agent runs, even before
  the daemon linked its id (it then opens by `tool_use_id` and waits for the id).
- `SubagentView.tsx`: the subagent's own transcript, a layer over the conversation. Header
  (desktop) or the Island (phones) shows "‹ Parent / Type Title"; nested agents push further.
- `TasksSheet.tsx`: every task of the session, same rows and tree.
- `StopTask.tsx`: the square stop button behind a running background agent or shell (strip and
  sheet; not nested agents) + confirm sheet → `cv_action stop_task { id }`. Offered when the
  daemon lists feature `cv_stop_task` (old daemons would drop a remote session on an unknown
  action). The daemon (`cv_action.rs`, `cv_stop_task`) refuses first when the computer's text
  field holds unsent text (it reads the box between the two `───` rules up to the inverse-video
  cursor, so a ghost suggestion does not count) or when another running task has the same name.
  It types `/tasks` unless the dialog is already open, reads it off the screen (list:
  `❯ ⏺ Name   running · model` between a `───` rule and the footer "↑/↓ to select · Enter to
  view · … x to stop"; one task may open its page "type › Name" directly), walks the selection
  to the one running row whose name matches (re-reading the screen after every key), presses
  Enter, and only presses `x` on the task's own page after its type and name match (the list
  re-sorts while it is open, the page does not). Esc is pressed only while the dialog's footer
  shows. Any doubt (no match, two matches, dialog gone, page of another task) closes the dialog
  and stops nothing. Checked live (2.1.316): idle, busy (dialog above the text field), dialog
  already open, unsent text.
- The strip's open list sorts by start time only (newest first), so rows do not jump under a
  finger when an agent ends; the Tasks sheet keeps running ones first.

## Navigation

The strip, the Tasks sheet and every subagent view are layers (`useLayer`): Back (button,
Escape, edge swipe, Android back, browser back) pops exactly one. Picking a row closes the strip
or sheet in the same step as opening the subagent, so the closing layer hands its history entry
to the new one (no `setTimeout`). Opening a nested agent from the strip pushes its whole trail
(parent first), so Back walks out level by level.

Subagents are not their own phone routes: the phone router mounts only the top page, and a
subagent belongs to its conversation (same attach, same Island). A link `#/agent/<sid>/sub/<agent>`
opens the agent page (history as for `#/agent/<sid>`) and hands the subagent over through
`usePhoneNav.sub` once the history is rebuilt; `ClaudeView` opens it (with its parents) when the
transcript is in, then clears it. The hash itself stays `#/agent/<sid>`.

## Limits

- Daemons before this change (0.3.4) send no tasks: cards still open by agent id from the tool
  result when there is one; the strip stays hidden.
- Stopping one task relies on the `/tasks` dialog's text (checked live with 2.1.316 for agents;
  shells and monitors use the same list but were not tried). "Stop background agents" (Ctrl+X
  Ctrl+K twice) stops all of them. Foreground agents stop with the session's Stop.
- `/tasks` opens while Claude is busy too (2.1.316: above the text field); if a CLI queues it
  instead, the action reports "The task list did not open" and types nothing more.
- A task scrolled out of a very long `/tasks` list is refused, not scrolled to. A draft whose
  cursor was moved to its very start is not seen as unsent text.
- The list keeps `MAX_TASKS` = 200 tasks; a fan-out of more running agents loses the oldest.
- Fan-out groups use the start-time rule (workflow tool calls are not in transcripts).

## Check by hand

```sh
CLAUDE_CONFIG_DIR=/tmp/na-sub-claude node scripts/dev/env.mjs up --home /tmp/na-subagents --port 1463 --seed
CLAUDE_CONFIG_DIR=/tmp/na-sub-claude node scripts/dev/shot.mjs subagents --home /tmp/na-subagents --devices phone,desk --schemes light,dark
```

The scene writes a fixture session (`scripts/dev/subagent-fixture.mjs`: background and
foreground agents, a nested one, a fan-out of five, a failed one, a shell, a monitor) and walks
cards, strip, group, subagent, nested + Back, Tasks sheet; `live` also watches a finish and the
fade.

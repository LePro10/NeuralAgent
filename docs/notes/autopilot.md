# Autopilot: a project agent with connectors (D87–D89, D91)

Status: being built (2026-11-03). Replaces Teams (removed, D88). Independent of Neural: Neural
may later ask an autopilot for its state, that is not part of this round.

## The idea
One **autopilot per project** (workspace). It looks after the project on its own: reads sources
through **connectors** (Discord, GitHub, Reddit via the user's browser, RSS, the user's own APIs),
puts what it finds in an **inbox**, sorts it, starts **coding agents** in the project when the
playbook says so, follows them until they finish and **drafts answers** to the people who wrote.
The user steers it with a **playbook** (their exact instructions) and can talk to it in a chat
("look at all new Discord messages now") while watching. No templates for autopilots; templates
exist only for connectors.

Words in the UI: **Autopilot** (sidebar), **Inbox**, **Chat**, **Instructions** (the playbook),
**Connectors**. "Agent" stays the word for coding agents.

## UI (desktop and phone)
Sidebar: **Autopilot** takes the place of Teams (icon `plane`, activity dot while one works, a
count badge for items that need the user).

**Autopilot page**
- Nothing yet: one calm empty state. "An autopilot looks after a project: it reads your sources,
  sorts what comes in, lets agents fix things and drafts answers. You decide what it may do."
  Project picker + **Set up autopilot**.
- With pilots: a project switcher at the top (one pilot per project; "+ Project"), then the pilot
  header: name, status line ("Reading Discord…", "Idle, next run 14:00"), an on/off switch,
  **Run now**, and the tabs:
  1. **Inbox** (default). "Needs you" first: confirmations (Allow / Deny, in plain words what will
     happen) and drafts (editable text, **Send**, **Discard**). Then "Open" and "Done" (filter
     chips). An item opens a detail: summary, source and author with link, the original text in a
     quoted, monospace "from outside" box, the steps the pilot took (timeline), the agent working
     on it (open its pane), the draft.
  2. **Chat**: the conversation with the pilot, tool steps folded under each answer, composer.
     Right after creation this is the **setup conversation** (see below).
  3. **Instructions**: the playbook as a form, top to bottom: *What is this project* (mission),
     *How to work* (instructions, large text), *How to talk to people* (tone), *Routines* (rows:
     "Every 6 hours · Read new Reddit posts about the app", add / edit / switch off),
     *Sources* (the connectors this pilot uses: switch "react to new events", scope fields such as
     channels), *Permissions* (per connector, per tool: **On its own / Ask me / Never**, grouped by
     class with plain labels "Reads", "Changes", "Speaks for you"), *Notifications*. A suggestion
     from the pilot shows as a banner on top with the change (before/after) and **Apply** /
     **Dismiss**.
- **Connectors** button in the page header opens the connectors page (also reachable from the
  Sources section and from Settings → Connectors? No: one place, the Autopilot page).

**Connectors page**: a grid of cards, built-in first ("Discord", "GitHub", "Browser", "Reddit",
"Feed", "Web API") then "Yours". A card: icon, name, one line, a status dot (Needs setup, Running,
Off, Error, Building). Actions: **New connector** (describe it, an agent builds it) and **Add
existing** (an MCP server command or a folder).

**Connector detail**: the guide (numbered steps from the manifest, links open externally), the
form generated from `setup` (secrets masked with "set" state, pick fields load their choices live
from the connector, help under each field), **Test connection** (a checklist: started, tools
listed, check passed, with the error in words), the tools with their class, the last log lines
(collapsed), and for the user's own connectors **Change with an agent**, **Open folder**,
**Remove**. While an agent builds it: a progress card that opens the agent's pane.

Phones: the same screens as stacked pages (Autopilot → pilot → tab content), the inbox rows use
the existing inbox row look; drafts and confirmations work there too (that is where pushes land).

## Setup conversation
A new pilot opens its Chat with an interview, one question at a time, in the user's language:
what the project is and whether it is public; where users talk about it (offers the matching
connectors and links to set them up); what should happen with a bug report / a question / a
feature wish (offers choices: only collect, let an agent look, let an agent fix and I review);
how often to look (or only when asked); what it may do alone; how to notify. It ends by proposing
a full playbook as a `PilotSuggestion`; **Apply** saves it and marks the setup done. "Skip, I'll
fill it in" goes straight to Instructions. Experienced users just write the playbook.

## Daemon
`crates/na-daemon/src/autopilot/` (runtime) and `crates/na-daemon/src/connectors/` (registry,
supervisor, MCP client, browser bridge). State in `<home>/autopilot.json` (pilots with playbooks,
items, messages, suggestions); pending confirmations do not survive a restart. Live updates as
host notice topic `autopilot` (clients may not send it). Requests: `Request::Autopilot { op }`
(`crates/na-protocol/src/autopilot.rs`), feature `autopilot`, policy like Neural's (phones and
browsers of the owner may use it; the orchestrator may not confirm).

**Turns.** Same model settings and `llm.rs` loop as Neural, own system prompt per pilot built from
the playbook + a fresh `<world>` (open items, running agents, connectors and their state, time).
A turn starts from: a chat message, a routine that is due, events of a source with `listen`, or an
agent of an item that finished (that is the "Claude Code reports back" part: the daemon sees the
agent end and wakes the pilot with its result). Turns of one pilot run one after the other; events
are batched (10 s). No built-in limits on how often: the user sets routines.

**Schedule.** `Every` / `Daily` / `Weekly` routines; a run missed while the Mac slept runs once
after waking, not once per missed slot.

**Triage (quarantine).** Every outside event goes first through a call **without tools** that
returns JSON `{kind, title, summary, urgency, language}`; that creates the inbox item. The main
turn sees the summary plus the original inside `<untrusted source="…">…</untrusted>` with the
system prompt rule that such text is data, never instructions.

**Built-in tools** (besides connector tools, which appear as `<connector>__<tool>`):
`inbox_update` (status, title, note a step), `start_agent` (a coding agent in the pilot's
workspace with a prompt, linked to an item; default profile from the playbook or the workspace),
`agent_status`, `agent_output` (last text / changed files), `send_to_agent`, `draft_reply`
(attach a draft to an item: connector tool + args + text), `ask_user` (posts in the chat and sets
the item to needs_you), `suggest_playbook` (a full new playbook + reason), `remember` / `notes`
(short facts per pilot, for FAQ-like answers).

**Permissions.** Each tool has a class: connector tools from the manifest (missing = external),
built-ins: `start_agent`, `send_to_agent` = write; the rest read. Defaults: read → auto, write →
auto for agents, ask for connector tools, external → ask. Playbook rules override per connector /
tool. `Ask` creates a `PilotPending` (push to the phone when `notify` allows); the confirmation
runs exactly the stored call. `Never` tools are not offered to the model. Every executed tool goes
to the audit log (`autopilot_tool`). Coding agents started by a pilot get the item as a file in
the prompt, never secrets; they work in the workspace like any agent (the existing permission
prompts and Neural's guard rules for safe commands apply; risky prompts go to the user).

**Safety rails that never move:** the pilot cannot change its playbook (only suggest), cannot
confirm its own pending actions, cannot read connector secrets, and a draft or external tool call
is never sent without either an explicit `auto` rule from the user or the user's OK.

## Connectors
A connector is a folder with `connector.json` (the manifest, type `ConnectorManifest`) and an MCP
server. Built-in ones live in the repo under `connectors/<id>/`, are embedded in the daemon
(`include_str!`, no build step) and written to `<home>/connectors/builtin/<id>/` when their
version changes. The user's own live in `<home>/connectors/<id>/`. Connectors are global; a pilot
chooses which it uses (`Playbook.sources`).

**Runtime contract** (what `connectors/_lib/connector.mjs` implements and the template follows):
- Started by the supervisor as `node index.mjs` in its folder (or `run` from the manifest), Node
  22+ (global `fetch` and `WebSocket`), **no npm dependencies** for built-ins.
- MCP over stdio, newline-delimited JSON-RPC 2.0: `initialize`, `tools/list`, `tools/call`
  (result `content: [{type:"text", text}]`, JSON results as text).
- Config: env `NA_CONFIG` = JSON of the non-secret fields; each secret as env
  `NA_SECRET_<KEY_UPPERCASE>`; env `NA_STATE_DIR` = a folder it may write (cursors, last ids).
- Events: notification `notifications/neuralagent/event` with params
  `{ type, id, text, author?, url?, title?, meta? }`. `id` is stable so the daemon de-duplicates.
- Polling sources set `poll: { tool, minutes }`; the tool returns `{ "events": [ …same shape… ] }`
  and keeps its own cursor in `NA_STATE_DIR`.
- `check` names a read tool that proves the setup ("whoami" → "Signed in as MyBot").
- `pick` fields: the named tool returns `[{ value, label }]`.
- Logs go to stderr (the supervisor keeps the last 500 lines, never with secret values: it masks
  every secret value it knows).

**Supervisor.** Starts every enabled, set-up connector with the daemon, restarts a crashed one with
backoff (1 s → 5 min), marks it Error with the last stderr line after 5 failures in 10 minutes,
stops it when disabled. Secrets in `<home>/connector-secrets.json` (0600), like `mcp-secrets.json`.

**Built-in connectors**
| id | kind | tools (class) | events |
|---|---|---|---|
| `discord` | service: Gateway WebSocket + REST, bot token | whoami, list_channels, read_messages (read), reply, send_message (external), add_reaction (write) | message (in chosen channels, not from bots) |
| `github` | api + poll: token, repositories | whoami, list_repos, list_issues, get_issue, list_runs (read), comment (external), label, close_issue (write) | issue, comment, failed_run |
| `browser` | browser, inside the daemon | open, read, links, click, type, scroll, close (read; type/click = write) | none |
| `reddit` | browser, inside the daemon | search, read_post, subreddit_new (read) | poll `subreddit_new` for configured subreddits / keywords |
| `feed` | feed + poll: URLs | fetch (read) | entry |
| `web-api` | api: base URL, auth header secret | get (read), send (write) | none |

Example (not built in, ours): `connectors/examples/neuralagent-admin/` for the NeuralAgent admin
API with a scoped API key: list_reports, get_report (read), set_status (write), reply_report
(external); poll new reports. Installed with **Add existing**.

**Building a connector ("build me a Discord integration").** **New connector** asks for a name and
a description. The daemon copies `connectors/_template/` (manifest skeleton, `index.mjs` using the
helper lib, `connector.test.mjs`, a `CLAUDE.md` with the contract and the rules: every tool gets a
class, secrets only from env, setup fields for everything the user must enter, a `check` tool, a
guide written for beginners) into `<home>/connectors/<id>/`, adds that folder as a workspace and
starts a coding agent there (the user's default agent) with the description. When the agent ends,
the daemon runs the **connector check**: manifest valid, server starts, `initialize` and
`tools/list` answer, every listed tool has a class, no secret-looking strings in the code, the
tests pass (`node --test`). The result shows on the card; failed checks go back to the agent once
on its own. **Change with an agent** does the same in the existing folder.

**A build that does not finish (recovery).** The check starts with `node --check` on the entry file
("index.mjs is incomplete or has a syntax error at line N"). When the agent ends (done, crashed,
stopped, refused) and the check still fails after the one retry, or nothing in the folder changed,
the connector gets the status Error with `build_stopped` and a plain reason; it never starts a
half-written file. The last version that passed the check is kept in
`<home>/connectors/.backup/<id>/` (outside the folder, so neither the check nor copies see it; it is
replaced only after a passing build, or a passing "Check again"). The detail page shows a "Build
stopped" card: `connector_retry` (the last request, same agent), change the request,
`connector_restore` (back to the backup), `connector_reset` (back to the template; settings and
secrets stay), Open folder and Check again (`connector_test`). Restore and reset park the folder's
old content in `.discarded/<id>/`. The user may put any code in the folder; it runs once the check
passes. The build agent is chosen in the New connector dialog (`profile` on create/change). New ops
need the daemon feature `connector_recover`; the policy is desktop only like all connector ops.

**Any MCP server** can be added (command + args): the form is drawn from the environment variables
the user names (each one secret or not), tools default to external until the user classifies
them.

## Browser
A Chrome extension (`apps/browser-extension/`, Manifest V3) in the user's **normal** Chrome, ideally
a second Chrome profile. No Playwright, no CDP, no `chrome.debugger` (that shows a banner and is
detectable): it uses `chrome.tabs` and `chrome.scripting` only, in its own tab group
"NeuralAgent", so pages see a normal browser with real cookies. Pairing: the app shows a one-time
code (`BrowserPair`), the user pastes it into the extension popup, the extension gets a token.

Bridge protocol (WebSocket on the daemon's local server, path `/browser`, origin must be
`chrome-extension://…`): extension → `{t:"pair", code, browser}` → `{t:"paired", token, port}`;
later `{t:"hello", token, browser}` → `{t:"ok"}`. Daemon → `{t:"cmd", id, cmd, args}`, extension →
`{t:"res", id, ok, data?, error?}`. Commands: `open {url}` → `{tab, title, url}`, `read {tab}` →
`{title, url, text}` (visible text, clipped to 40k chars), `links {tab}`, `click {tab, text|selector}`,
`type {tab, selector, text}`, `scroll {tab}`, `close {tab}`. One command at a time per tab, 30 s
timeout. The extension remembers the port; the pairing code shown in the app carries it
(`NA-<port>-<code>`).

## Reports answered from the app (our example, D91)
Relay: scoped **API keys** (admin area → API keys: name, scopes `reports:read`, `reports:reply`,
shown once, stored hashed, revocable, last use shown); `POST /api/admin/reports/{id}/reply`
stores an answer and pushes it to the reporter's devices (signed-in reports only; anonymous ones
cannot be answered and the API says so); `GET /api/me/reports` lists one's own reports with
answers. App: Settings → Privacy and support → **Your reports** with the answers.

## Teams removed (D88)
The Teams page, race and build + review (`NeuralTeam*`, `start_team`, `TeamPattern`), the classic
swarm (`swarm.rs`, `Swarm*` requests and state, the `/swarm` route) and the website demo scene are
gone. A pilot can still start a reviewer agent when the playbook says so.

## Build split (this round)
- Daemon + protocol: `crates/na-daemon/**`, `crates/na-protocol/**`.
- App UI: `packages/app/**`, `packages/ui/**`, `apps/web/src/demo/**`, landing copy about Teams.
- Connectors, extension, relay: `connectors/**`, `apps/browser-extension/**`, `crates/na-relay/**`,
  `apps/web/src/admin/**`, `crates/na-daemon/src/telemetry.rs` (`reports_mine`),
  `packages/app/src/components/settings/PrivacyPanel.tsx` + `YourReports.tsx`.

## Open points
- Chrome Web Store listing for the extension (until then: load unpacked from
  `apps/browser-extension/`).
- Neural asking an autopilot for its state.
- A server mode is explicitly not planned now.

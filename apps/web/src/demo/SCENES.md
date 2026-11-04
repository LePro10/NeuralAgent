# Demo scenes

`world.play(scene)` resets the simulated computer and plays the scene up to its moment (virtual time,
pre-rolled in well under a second), then keeps it alive. Every connected frame gets a fresh snapshot and
**navigates itself** to `sceneRoute(scene, view)` (see `api.ts`); a host that wants another page calls
`frame.navigate(...)` after the `scene-ready` signal. Ids never change for a seed, so
`frame.navigate({ agent: "claude-billing" })` and the handles below are stable across resets.

```ts
const world = (window.__naDemo ??= await loadWorld({ scene: "grid" }));
const off = world.on((s) => {
  if (s.type === "scene-ready" && s.scene === "permission") { /* the moment is on screen */ }
  if (s.type === "prompt-answered") console.log(s.allow, "by", s.by); // "desk" | "phone" | "world"
});
world.play("permission");
```

Signals: `ready` (first world built), `reset`, `scene` (a scene was built), **`scene-ready`** (built, snapshot
sent, frames on their start route), `client`, `agent-status`, `prompt-opened`, `prompt-answered` (`by`),
`neural-message`, `agent-started`.

## Frames

| | size | layout | note |
|---|---|---|---|
| desk | 1280 x 800 css px (any width >= 900) | desktop | Claude panes show **Chat** only where the scene says so (the frame sets it); otherwise Terminal |
| phone | 390 x 844 css px | phone (kind "web") | tabs Agents / Neural / Projects / Settings; send with the Send button (Enter is a newline on touch) |

## What every scene shares (the past)

- **Projects**: billing-api (Node, Fastify, Postgres), web-shop (React cart), docs-site. Host "Studio", user "Demo User",
  home `/Users/demo`. Nothing is copied from a real machine.
- **billing-api Claude** has a morning behind it (seven earlier prompts: signature check, retries, refunds, health check,
  tests), so scrolling up in its chat pages in older messages (`cv_history`, 48 messages per attach).
- **web-shop** has a finished Claude session (cart quantity, permission asked and allowed), a finished Codex session
  (a task Neural ran yesterday) and a done Neural task for each.
- **Neural memory**: two notes ("Prefer pnpm over npm", "Money is always integer minor units").
- Every agent Neural "follows" has a task (Tasks rail on Neural) with a live note taken from what the agent does.

## The scenes

Handles (for `navigate`, `resolve`, `focus`): `agent.claude-billing`, `agent.codex-billing`, `agent.opencode-billing`,
`agent.gemini-billing`, `agent.claude-shop`, `agent.claude-shop-totals` and `agent.gemini-docs` (agents scene),
`agent.shell-billing`, `project.{billing-api,web-shop,docs-site}`.
The four billing agents exist in grid, permission, phone, neural, idle (three in agents, one in files).

### grid (hero)
- **Desk**: `{ project: "billing-api" }`. Tab "Agents": four terminals in a 2x2 grid, all working: Claude Code
  (webhook retries, writing a diff), Codex (idempotency keys, running tests), OpenCode (refund tests), Gemini CLI
  (README table). Branch chip, changes badge, sidebar with the activity marks. Ready after 16 s of virtual time.
- **Phone**: `{ agent: "claude-billing" }`. Claude as chat: thinking row, todo card ticking, a live diff.
- Alive: all four keep typing; Claude asks "Allow `pnpm test`?" soon after (any device answers; the world answers
  after 2.5 virtual minutes so an untouched hero keeps flowing), then more agents start. Director after that.
- Visitor can: type in any pane (Claude panes understand the requests below), answer the question, open Neural.

### permission (chapter 2: it waits for you)
- **Desk**: `{ agent: "claude-billing" }`. Claude in the **Chat** view, a large pane on the left (`bigLeft`); Codex and
  OpenCode as terminals on the right, Gemini in a "Docs" tab. About 1 s after the scene is ready Claude shows the
  Allow card for `pnpm test`; the pane header and the sidebar switch to the waiting mark.
- **Phone**: `{ agent: "claude-billing" }`, same transcript, the Allow once / Always allow / Deny dock.
- Answer on either device: the card closes on both (`prompt-answered` with `by`), the tests run, Claude summarises.
- Deny asks for a reason (optional); Claude reacts and offers the alternative.

### phone (chapter 3: your phone is the remote)
- **Phone**: `"agents"`. The inbox: "Needs you" with Claude's question and Allow / Deny right on the row, "Working"
  with the other two, "Done" with the shop agents. Bottom tabs with the badge.
- **Desk**: `{ project: "billing-api" }` (Chat view of Claude in the big pane, so the same card is visible).
- Allow on the phone: the desk card disappears and its pane goes back to working (`prompt-answered.by === "phone"`).

### neural (chapter 4: talk to Neural)
- **Desk**: `"neural"`. Conversation (an earlier exchange, proactive reports), the **While you were away** card
  ("2 tasks done, 2 agents finished, 1 need input", Catch me up), a pending confirmation ("Start Gemini CLI in
  docs-site", Deny / Allow), the **Tasks** rail (running, blocked and done tasks with the note of what each agent is
  doing now), **What Neural noticed** (unseen items first), memory notes, suggestion chips for the agents.
- **Phone**: `"neural"`. Same conversation and card, composer, the tasks/memory icon in the header.
- The brain (`neural-brain.ts`) understands: "what are my agents doing" / "what is going on", "who is waiting",
  "start codex in web-shop to ...", "ask gemini in docs-site to ...", "stop claude in billing-api", "summarise
  billing-api", "run the tests in web-shop", "approve" / "deny", "remember that ...", "forget", "be quiet" /
  "speak up" / "turn yourself off", "catch me up", greetings, thanks,
  help. Replies stream word by word, action pills open the agent. Starting an agent really starts one (pane or row,
  working ring) and Neural tracks it: a task, then a proactive report when it finishes or needs you, and a check run
  when the task is about tests. What it does not understand gets one honest line and the live summary.
- Allow on the pending card starts Gemini for real; Deny leaves a "Cancelled" pill and nothing starts.
- Races and build + review are scripted for web-shop: the reply says so when the goal is not the wishlist /
  the free-shipping hint.

### files (chapter 6: files, changes, history)
- **Desk**: `{ files: "billing-api" }`: the project with the changes sheet open (files, git status, a real diff of what
  Claude edited, ahead/behind). Claude is done; its transcript in the pane has the Edit diffs.
- **Phone**: `{ files: "billing-api" }`: the Files page (folders, git dots). Tapping a file opens it; the Claude agent
  (done) has the diff cards in its chat.
- History: `frame.navigate("history")` lists the past sessions.

### agents (the overview)
- **Desk**: `"agents"`. The Agents page across all three projects: one needing you (Claude, billing-api), two to three
  working, the rest done (docs-site Gemini, web-shop agents), with their engines and usage hints.
- **Phone**: `"agents"`. The same list as the inbox, tab badge on Agents.

### idle
- **Desk**: `{ project: "billing-api" }`; **Phone**: `"agents"`. Everything finished, nobody waiting; the Director
  starts a small task after about 40 s.

## The Claude view (grid, permission, phone, files, any Claude pane in Chat)

A Claude pane answers what a visitor types (`claude/intent.ts` reads it, `claude/skills.ts` plays it):

| Type | What happens |
|---|---|
| "how do refunds work?", "explain the signature check", "how is it configured?" | reads the real files of the demo project, answers from them |
| "run the tests", "pnpm test" | asks Allow / Deny for `pnpm test`, runs it, summarises |
| "add logging to the webhook handler", "limit the cart quantity to 99" | plan or edit with a diff and an Allow card; Deny leaves the file alone |
| "make a plan for a health check that checks the database" (or `/plan`) | a plan card to approve before any edit |
| "write a test for money rounding" | writes the test file, runs it |
| "explore the repo with subagents" | 2 to 3 subagents with their own transcripts and task output |
| "commit this", "review my changes", "start the dev server in the background" | commit, review, background task |
| `!ls src` | a shell command |
| `/cost` `/context` `/model` `/effort` `/clear` `/compact` `/review` `/init` `/rewind` `/memory` `/help` | the command's own output or sheet |
| a message while the turn runs | queued ("Sent after the current step", Edit, Send now); Esc or Stop interrupts |
| anything else | an honest line ("this demo plays scripted work ...") plus a question with chips to pick a skill |

## Time and determinism

Virtual clock (`world.clock`: pause, speed, advance). Same seed, same ids and texts. Posters: freeze the browser
clock, run `scripts/dev/site-posters.mjs` (see `public/demo/`); every poster stays under 120 KB.

## Known limits

- The terminals of the pre-rolled past are 56 columns wide; in a wider pane their old text wraps or is cut with an
  ellipsis, as a real terminal would after a resize.
- Races and build + review are scripted for one goal each (web-shop); the Neural reply says so.
- Everything the visitor types that is not in the table is answered honestly, not with invented work.

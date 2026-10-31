# Mobile overhaul (branch `mobile-overhaul`, D52-D57)

The phone view (web remote and Android app, `packages/app` below the desktop breakpoint) became a
content-first app for driving Claude Code. Desktop layout is unchanged; shared chat components got
better on desktop too. Status: done on the branch, uncommitted, not released (see HANDOFF).

## What changed, per area
- **Navigation (D52)**: tabs Agents, Neural, Projects, Settings. Router `packages/app/src/lib/phoneRoute.ts`
  (state + hash + history, stacks persisted in localStorage `neuralagent.phoneNav`), `lib/openAgent.ts`
  (`useOpenAgent`: router on phones, `openAgentOnDesktop` is the only `layout_set` writer),
  `lib/inbox.ts`, `lib/updateNotice.ts`. Screens in `components/phone/*` (AgentsInbox, ProjectsPage,
  Waiting, rows, NewAgentSheet). Settings sections are routes. `MorePage.tsx` and `WorkspacesPage.tsx`
  are removed. Toasts: "finished" is desktop-only, "needs you" from another agent is one toast.
- **Chrome (D53)**: `packages/ui/ui/` Dock (`dock="hidden"` on agent screens, `--dock-h`, `pb-dock`),
  `layout/Island.tsx` + IslandPanel, `lib/keyboard.ts` (`useKeyboard`, `--kb-inset`), hide-on-scroll,
  `lib/layers.ts` (`useLayer`, one `history.go(-n)` for batched closes), `lib/chrome.ts`.
  `PhoneAgentScreen` in `components/workspace/PhoneWorkspace.tsx`; per-agent Chat/Terminal in
  `ClaudeViewSwitch.tsx`; `workspace/islandOverride.ts` for subagents; terminal key row in `KeyBar.tsx`.
- **Transcript (D54)**: `components/claude/entries.ts`, `useStickToBottom.ts`, `ChatScroll.tsx`,
  `Transcript.tsx`, `tools.tsx`, `Images.tsx`, `Markdown.tsx`. Subagents and tasks: `AgentCard.tsx`,
  `SubagentView.tsx`, `TasksSheet.tsx`, `useTasks.ts`.
- **Composer and controls**: `Composer.tsx`, `PromptCard.tsx` (dock router), `Picker.tsx` ("pours"),
  `CommandPalette.tsx`, `ContextSheet.tsx`, `QueueChips.tsx`, `DockCard.tsx`, `PlanCard.tsx`,
  `QuestionSheet.tsx`, `RewindSheet.tsx`. Pure logic with tests: `commands.ts`, `promptState.ts`,
  `queue.ts`, `actions.ts` (`act` = daemon action when `meta.actions`, else typed keys), `metaInfo.ts`.
  `# note` sends a "remember this" prompt (the CLI dropped `#` mode); bypass/don't-ask modes are listed
  only once seen.
- **Failure wording**: `lib/agentReason.ts` (plain-words reasons, raw error on tap).
- **Daemon and protocol (D55, D56)**: new `crates/na-daemon/src/cv_{parse,tasks,screen,commands,action}.rs`;
  `claude_view.rs`, `profiles.rs` (statusline and `subagentStatusLine` forwarder), `hooks.rs`,
  `server.rs`, `core.rs`; `crates/na-protocol/src/claude.rs` and `lib.rs`; generated TS in
  `packages/protocol/src/gen/`, client in `packages/protocol/src/{client,cv}.ts`.
- **Look (D57)**: tokens and themes in `packages/ui/ui/styles/`, `phone.css`; `Glow` is a no-op on phones.
- **Platform**: `apps/web/src/remote/native.ts` (back via `history.back()`, minimise at the root, SystemBars
  style per appearance), `dev-browser.tsx` keeps dev params in sessionStorage because the router rewrites
  the hash.

## Contracts worth knowing
- Everything in the protocol is additive: absent field = old daemon. `CvMeta.actions === true` means
  `cv_action` is live. `tasks` events need `features: ["tasks"]` on `cv_attach` (sent by the client).
  Subagent streams: `attachCv(sid, sink, {agent})`, history/images take the same `agent`.
- `answer` / `answer_question` carry `prompt_id` (`CvPrompt.id`); refusals come back as `ApiError`
  with a user-facing message and the app shows them as a toast.
- Image blocks with an https `url` are never loaded automatically (no host allow-list).

## How to test
- `pnpm typecheck && pnpm test && pnpm lint:tokens`, `cargo test --workspace` (protocol/daemon).
- Screenshots: `node scripts/dev/env.mjs up --seed`, then `node scripts/dev/scenes/phone.mjs` (inbox, agent,
  sheets, subagent, settings; phone and small, light and dark) and `node scripts/dev/shot.mjs pages
  --montage`. The History page shows real conversations: never publish those shots.
- Use profile args (`--model haiku`), never `/model`, in live Claude tests: the CLI saves `/model` as the
  user's default. Test daemons use their own `NEURALAGENT_HOME` under `/tmp`.

## Open issues
- Not played against a live Claude CLI: `answer_question`, rewind, `set_mode`, `stop_agents`,
  `send_queued_now`, the "Edit" of a queued message (Up + Ctrl+L), Allow/Deny from the inbox with a real
  prompt, question-tab switching without `CvQuestion.tab` (not filled), nested agents (`CvTask.parent`
  not filled).
- Image blocks with an https `url` have no tap-to-load link yet.
- Dictation that starts with "!" can still arm shell mode.
- Swarm detail on a phone opens at the end of the log (the big title starts half under the bar); the
  page header could start at the top for ended swarms.
- `native.ts` detects the router through `history.state.navIdx`; an exported `isRouterRunning()` is cleaner.
- Request handlers that lock a tail briefly can wait while the tick thread reads a file.
- Agents catalog install on a phone starts in the first project; no project rename on a phone.
- The context ring in the Island depends on `CvMeta.context_pct` from the statusline.
- Old scenes `scenes/pages.mjs` and `scenes/nav.mjs` and the `more` helper in `shot.mjs` still target
  the removed More/Workspaces tabs; use `scenes/phone.mjs`.

## APK-only (no Java changes were made)
Real-device checks and features that need a new APK: Android keyboard open/close after Back, the composer
and prompt answer field with the real keyboard, Ctrl + letter with Gboard, glass-lite cost, Island swipe vs.
system edge gestures, VIBRATE permission and haptics, edge-to-edge on Android 14 and older, notification
actions (Allow/Deny), notification grouping per agent, app shortcuts (New agent), predictive back,
iOS-only `--kb-inset` lift.

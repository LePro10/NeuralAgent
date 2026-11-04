# Handoff

Current state for a fresh session. Start with [../AGENTS.md](../AGENTS.md) (rules, routine), then
[CODEMAP.md](CODEMAP.md) to find files. Progress and the owner's checklist: [STATUS.md](STATUS.md);
plan: [PLAN.md](PLAN.md); decisions: [DECISIONS.md](DECISIONS.md). Older handoffs:
[archive/HANDOFF-2026-10-30.md](archive/HANDOFF-2026-10-30.md) and git history of this file.

## Released 0.5.2 (2026-11-02)
Tag `v0.5.2` = `mobile-overhaul` `7e4921f` (`main` not moved, as before). CI release run
41494519192 green; `/api/releases/latest` serves 0.5.2. Relay + website deployed: build
`0.5.2+mvzkram1`, rollback image `neuralagent-relay:prev` = `0.5.1+mvzcn8r8`; health, `/changelog/`,
`/app/` checked. Contents: dictation history (D85: `apps/desktop/src-tauri/src/dictations.rs`,
`components/settings/DictationHistory.tsx`, `voice.history*` host_ui ops), "Hey Neural" → call,
chime, HUD hang-up, guided learn, loose wake path (D84, D86), paste screenshots, terminal size owner
(D83), no double frame.
**Not tried in the real app yet:** wake → call, preroll timing, idle hang-up, chime, HUD hang-up
click, guided learn, loose path on a real voice, the dictation history with real dictations.
Owner idea, not started: Luna (projectWebsite) should keep "Pasted text" cards in its draft
(a long paste was lost on reload, which motivated D85).

## Released + deployed 0.5.5 (2026-11-04)
D92: connector tool schemas normalized (`connectors/schema.rs`, `Connector.warnings`), pilot tools
`build_connector`/`connector_status`, `PilotMessage.connector_id` -> live card in chat
(`LiveConnector.tsx`), chat keeps scroll, `ErrorNotice`. Relay build `0.5.5+mw1zlmvd`. Not yet
tried with a live model: the pilot building a connector from chat.

## Released + deployed 0.5.4 (2026-11-04)
Tag `v0.5.4` = `main` `9e47e38`: connector builds recover (snapshot in `connectors/.backup/`,
reset/restore/retry, `node --check` step, "Build stopped" card), agent picker per connector,
default agent in Settings -> Agents (`settings.default_profile`), Discord connector 1.1.0. Relay +
website deployed: build `0.5.4+mw1v18o8`, rollback image `neuralagent-relay:prev` = 0.5.3 build.
Note: the safety classifier of the agent can refuse some connector requests (e.g. a Discord
"admin/nuke" bot); that is not bypassed. Users can still put own code in the folder + "Check again".

## Released 0.5.3 (2026-11-04)
Tag `v0.5.3` = `main` `9b5308b` (Autopilot D87-D89/D91, SSH workspaces D90, Teams removed). CI
release run 41792783678 green; `/api/releases/latest` serves 0.5.3. `mobile-overhaul` was
fast-forwarded into `main` and deleted: **work on `main` from now on.**
**Pending:** `.github/workflows/ci.yml` drops the removed "Swarm end-to-end test" step; it is
uncommitted because the gh token lacks the `workflow` scope (run `gh auth refresh -h github.com -s
workflow` on a machine with a browser, then commit + push it). Until then the CI job fails at that
step (the release workflow is independent).

## Autopilot built, relay + website deployed (2026-11-03)
**Deployed 2026-11-03** (with the SSH workspaces of the other session): relay build
`0.5.2+mw17iga8`, rollback image `neuralagent-relay:prev` = `0.5.2+mvzkram1`. Health, `/app/`,
`/admin/`, changelog checked; `/api/me/reports`, `/api/admin/keys` answer 401 without auth.
Deploy note: rsync `git ls-files --cached --others --exclude-standard` filtered to existing files
(new files are untracked; a deleted tracked file makes rsync skip files). Desktop/Android get
Autopilot and SSH only with the next release (ask the owner for the version number).
Working copy on `mobile-overhaul` (another session's SSH workspaces, D90, is in the same copy).
Spec: [notes/autopilot.md](notes/autopilot.md); decisions D87 (autopilot per project, separate from
Neural), D88 (Teams/swarms removed), D89 (connectors = MCP + manifest, generated UI, Chrome
extension), D91 (report answers, scoped admin API keys). Code: `crates/na-protocol/src/autopilot.rs`,
`crates/na-daemon/src/{autopilot,connectors}/`, `connectors/` (built-ins discord/github/feed/web-api,
`_lib`, `_template`, `examples/neuralagent-admin`), `apps/browser-extension/`,
`packages/app/src/components/autopilot/`, relay `apikeys.rs` + reply/`/api/me/reports`, admin
`ApiKeys.tsx`, Settings → Your reports, push type `report` (sw.js, Android `PushService`).
Verified: cargo test (workspace), typecheck, pnpm test, lint:tokens, check:docs, `pnpm
test:connectors` (33), extension tests (6); UI against a real test daemon in light/dark, phone/desk
(`scripts/dev/scenes/autopilot.mjs`, montages `research-local/ap-final/`).
**Not tried yet:** a real model turn (no key in test daemons: setup interview, triage, tools,
suggestions), Discord/GitHub with real tokens, the extension in a real Chrome, a connector built by
an agent, relay changes deployed (`cargo test -p na-relay --features test-login` for integration
tests), the Android build with the new push channel. Relay push `report` opens the app home, not
Settings → Your reports directly. Owner must decide on commit/deploy.

## Where we are (2026-11-02)
- Released: 0.5.2 (see above). Earlier: 0.5.1 `046401c`.
- **Deployed but NOT committed** (working copy on `mobile-overhaul`; relay build `0.5.1+mvzcn8r8`,
  rollback image `neuralagent-relay:prev` = `0.5.1+mvy9yr2p`), D83:
  - Dark glass surfaces draw one edge, no double frame (`packages/ui/ui/styles/effects.css`
    `.glass.rim`, `Sidebar.tsx` without extra inset highlight).
  - Shared PTY size (`packages/app/src/components/TerminalView.tsx`): the device in use owns it, other
    views adopt the daemon's `session.cols/rows` and claim it back on input. Two-browser check script:
    `research-local/termtest/run.mjs`.
  - Ctrl+V pastes in the terminal on Windows/Linux; screenshots via `pastedImages()`
    (`packages/app/src/components/claude/files.ts`) in terminal, Claude composer, key bar.
  - Files: CHANGELOG (Unreleased), DECISIONS D83, CODEMAP, KeyBar, TerminalView, claude/Composer,
    claude/files, ui ai/Composer, Sidebar, effects.css. Desktop/Android get it with the next release
    (ask the owner for the version number).
- Open from this round: owner to decide on the commit; try on a real Windows PC + phone; light mode
  keeps border + white rim (two fine lines) on purpose.

## Open issues
- Website: not tried on real iOS Safari, a real Android phone or Firefox; relay soft 404 (unknown
  paths answer 200 with the 404 page) and 307 for bare directories; 900-1179 px mouse windows
  show the stage window at 0.55-0.80 scale; lucide icons in many small chunks. Details:
  [notes/website.md](notes/website.md) "Open points".
- App strings still say "New swarm" in places where the site says Teams;
  `useDaemon((c) => c.state?.swarms ?? [])` re-renders while state is empty; TerminalView makes one
  WebGL context per pane (the demo turns WebGL 2 off).
- Not run on real systems: LaunchAgent/LaunchDaemon install, `tccutil`, osascript admin,
  Windows S4U, systemd/linger; `LSEnvironment` (memory) not checked with a signed build.
- Without Full Disk Access a fresh install cannot start agents in ~/Documents from the phone until
  the Mac answered once (fixB trade-off). `CLAUDE_CONFIG_DIR` inside Documents is not guarded.
- Ducking: Mac calls lower only Music/Spotify; two NeuralAgent apps ducking at once can leave the
  inner original.
- Subagents: stopping shells/monitors not tried live; `MAX_TASKS` 200; fan-out grouping is a time
  heuristic. `notes/claude-view.md` and `notes/mobile-overhaul.md` still describe the older Tasks
  sheet.
- Neural: proactive reports are not spoken during a call; on phones the team sheet opens over the
  panel sheet. Discord: "lines changed", "turns finished today", a second button not built.
- Memory plan items not done: P4, P5, P7, P8 ([notes/performance.md](notes/performance.md)).
- review4: boot LaunchDaemon log may be root-owned; a logout leaves the daemon without its host
  until it restarts.
- From before: overhaul actions not run against a live CLI (`answer_question`, rewind, `set_mode`,
  `stop_agents`, `send_queued_now`); relay on .96 deployed by hand until the GHCR read token
  exists; only one daemon may use a copy of `remote-credentials.json` (D43).

## How to run
- Everything for interactive checks (test daemon + UI in a browser, screenshots, web remote,
  Neural/call/swarm kits, Android WebView, macOS input helpers, update test):
  [../scripts/dev/README.md](../scripts/dev/README.md).
- Tests: `cargo test --workspace`; `pnpm typecheck && pnpm test && pnpm lint:tokens && pnpm check:docs`;
  website/demo: `pnpm --filter @neuralagent/web test`. Remote E2E: `cargo build -p na-daemon &&
  cargo build -p na-relay --features test-login && node --experimental-strip-types
  scripts/e2e-remote.ts`; Neural v2 (fake model): `scripts/dev/neural-e2e.mjs` (header).
- Website dev: `pnpm --filter @neuralagent/web exec vite --port 5191` → `/`, `/demo/`
  (`/api/releases/latest` is 502 without a local relay; that is expected).
- `pnpm dev` (Tauri dev; set `NEURALAGENT_HOME=/tmp/na-dev` to keep test state separate).
- Android emulator: `export JAVA_HOME=/opt/homebrew/opt/openjdk@21
  ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`; start AVD `na36` headless
  (`$ANDROID_HOME/emulator/emulator -avd na36 -no-window -gpu swiftshader_indirect`); local relay
  (test login, FCM) + daemon via `scripts/android-dev.sh` (relay on :8095); `adb reverse tcp:8095
  tcp:8095` (WebCrypto needs localhost, not 10.0.2.2); build with
  `cd apps/android && NA_REMOTE_URL=http://localhost:8095/app/ npx cap sync android && cd android
  && ./gradlew assembleDebug`, then `adb install -r`. Run `npx cap sync android` again without
  the variable afterwards.
- Release: [RELEASING.md](RELEASING.md). Relay/website deploy: skill `deploy-web`.

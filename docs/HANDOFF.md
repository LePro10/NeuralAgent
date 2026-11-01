# Handoff

Current state for a fresh session. Start with [../AGENTS.md](../AGENTS.md) (rules, routine), then
[CODEMAP.md](CODEMAP.md) to find files. Progress and the owner's checklist: [STATUS.md](STATUS.md);
plan: [PLAN.md](PLAN.md); decisions: [DECISIONS.md](DECISIONS.md). The longer previous handoff
(module pointers per milestone): [archive/HANDOFF-2026-10-30.md](archive/HANDOFF-2026-10-30.md).

## Where we are (2026-10-31, evening)
- **Branch `mobile-overhaul`, big team round UNCOMMITTED in the working tree (~175 files).** On top
  of the committed mobile overhaul (D52-D57; web remote + relay deployed from it as
  `0.3.4+mvwk87yh`) these areas landed, each reviewed and fixed once more (reports and the summary:
  `research-local/team/FINAL.md`, `*-report.md`):
  - **System** (D58-D60, [notes/system-integration.md](notes/system-integration.md)): service host
    that keeps the daemon alive and makes it "NeuralAgent" for macOS (TCC), autostart at login or
    boot, Settings → System (permissions, restart). Folder guard: remote/background work never
    triggers a macOS privacy prompt (fixB).
  - **Neural v2 + Teams** (D61-D64, D77, [notes/neural-v2.md](notes/neural-v2.md)): tasks,
    observations instead of chat notices, proactive reports, guard with Allow/Deny, Teams (race,
    build + review) replace Swarm (old swarms still readable), restart reconcile, race clean-up.
  - **Subagents** (D65-D66, [notes/subagents.md](notes/subagents.md)): work strip, stop one task
    (`cv_stop_task`), nested/grouped subagents, deep link `#/agent/<sid>/sub/<agent>`.
  - **Files** (D67-D68, [notes/files.md](notes/files.md)): explorer pane (desktop) and pages (phone).
  - **Calls** (D69-D70, D78, [notes/calls.md](notes/calls.md)): lazy warm-up, honest states,
    Android hold/ducking. **Ducking** (D73, [notes/ducking.md](notes/ducking.md)).
  - **Settings + Discord** (D71-D72, [notes/settings-discord.md](notes/settings-discord.md)).
  - **Memory** (D74-D75, [notes/performance.md](notes/performance.md)): Parakeet unloads after 5 min.
- Protocol features (additive, `na_protocol::DAEMON_FEATURES`): `call_warm`, `files`, `neural`,
  `host_system`, `cv_stop_task`, `neural_cleanup`. Every new request in the UI is gated by
  `client.has(...)`, so the new web remote may be deployed before the 0.3.4 daemon on the owner's
  Mac is updated (0.3.4 drops unknown requests silently). New daemons answer an unknown request
  with an error (local and remote).
- Integration pass done: all checks green (cargo fmt/clippy/test, pnpm typecheck/test/lint:tokens/
  check:docs, web build, e2e-remote, e2e-swarm, neural-e2e 25/25, daemon-smoke, screenshots).
  D-numbers: D58-D75, D77, D78 (D76 unused).
- Outside this round: an unrelated "site-overhaul" session writes `apps/web/src/demo/` and
  `apps/web/src/site/{base.css,content.ts,foundation.css,fonts}` (untracked, WIP); it breaks
  `pnpm typecheck` (apps/web) and `pnpm lint:tokens` until finished. Do not commit it with this round.
- Earlier: 0.3.4 is the last release (installed on the owner's Mac, relay/web deployed). History of
  0.2.x-0.3.4: [archive/HANDOFF-2026-10-30.md](archive/HANDOFF-2026-10-30.md) and CHANGELOG.

## Next
1. Lead commits this round on `mobile-overhaul` (leave the site-overhaul WIP out).
2. Owner: hand checks in STATUS "Your checklist" (power round block): permissions, ducking,
   Discord, memory, new APK on a real phone.
3. Release 0.4.0 (desktop + APK) when the owner says so; then deploy the web remote/relay.
4. Owner decision: remote-added projects (D42) are approved at once, so a paired phone can open
   any folder (review5). Option: such projects stay unapproved until confirmed on the computer.

## Open issues
- Not run on real systems: LaunchAgent/LaunchDaemon install, `tccutil`, osascript admin,
  Windows S4U, systemd/linger; Windows code not compiled here. `LSEnvironment` (memory) not
  checked with a signed release build.
- Without Full Disk Access a fresh install cannot start agents in ~/Documents from the phone until
  the Mac answered once (fixB trade-off). `CLAUDE_CONFIG_DIR` inside Documents is not guarded.
- Ducking: Mac calls lower only Music/Spotify (browsers stay loud); two NeuralAgent apps ducking at
  once can leave the inner original.
- Subagents: stopping shells/monitors not tried live; a task scrolled out of a very long `/tasks`
  list is refused; `MAX_TASKS` 200; fan-out grouping is a time heuristic. `notes/claude-view.md`
  and `notes/mobile-overhaul.md` still describe the older Tasks sheet.
- Neural: "While you were away" card not screenshotted; proactive reports are not spoken during a
  call; on phones the team sheet opens over the panel sheet.
- Discord: "lines changed", "turns finished today", a second button not built; Night theme preview
  banner looks grey.
- Memory plan items not done: P4 (cut long dictations), P5 (app dictation via the daemon), P7
  (PTY scrollback compaction), P8 (WebKit).
- review4: boot LaunchDaemon log may be root-owned; a logout leaves the daemon without its host
  until it restarts; an old host restarting a crashed daemon copies the new binary under the old
  name (fixed by the next upgrade).
- Screenshot scene `subagents` needs `CLAUDE_CONFIG_DIR` (see its header); `files` needs
  `scenes/files.mjs --make <home>` first.
- From before: overhaul actions not run against a live CLI (`answer_question`, rewind, `set_mode`,
  `stop_agents`, `send_queued_now`); https image blocks have no tap-to-load; "Last seen" of a
  never-connected device shows its creation date; design-system gaps at the end of
  `notes/design-system.md`; relay on .96 deployed by hand until the GHCR read token exists; only one
  daemon may use a copy of `remote-credentials.json` (D43).

## How to run
- Everything for interactive checks (test daemon + UI in a browser, screenshots, web remote,
  Neural/call/swarm kits, Android WebView, macOS input helpers, update test):
  [../scripts/dev/README.md](../scripts/dev/README.md).
- Tests: `cargo test --workspace`; `pnpm typecheck && pnpm test && pnpm lint:tokens && pnpm check:docs`.
  Remote E2E: `cargo build -p na-daemon && cargo build -p na-relay --features test-login &&
  node --experimental-strip-types scripts/e2e-remote.ts`; classic swarm: `scripts/e2e-swarm.ts`;
  Neural v2 (fake model): `scripts/dev/neural-e2e.mjs` (header).
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

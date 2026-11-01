# Handoff

Current state for a fresh session. Start with [../AGENTS.md](../AGENTS.md) (rules, routine), then
[CODEMAP.md](CODEMAP.md) to find files. Progress and the owner's checklist: [STATUS.md](STATUS.md);
plan: [PLAN.md](PLAN.md); decisions: [DECISIONS.md](DECISIONS.md). The longer previous handoff
(module pointers per milestone): [archive/HANDOFF-2026-10-30.md](archive/HANDOFF-2026-10-30.md).

## Where we are (2026-11-01, night)
- **0.4.0 released and deployed.** Tag `v0.4.0` = `main` = `mobile-overhaul` (`c50ee30`). CI
  Release run 41262931077 green (desktop x4 + APK); `/api/releases/latest` serves 0.4.0, the
  update check from 0.3.4 answers 200. Relay + website deployed from that commit: build
  `0.4.0+mvx78qcr`, container healthy, rollback image `neuralagent-relay:prev` (= the 0.3.4 web
  remote build). The owner's installed app was not touched; it updates itself.
- What 0.4.0 contains (commits `33437c0`, `6844a8e` on top of the phone overhaul D52-D57):
  - **Power round** (D58-D78): service host + autostart + Settings → System
    ([notes/system-integration.md](notes/system-integration.md)), Neural v2 + Teams
    ([notes/neural-v2.md](notes/neural-v2.md)), subagents ([notes/subagents.md](notes/subagents.md)),
    Files ([notes/files.md](notes/files.md)), calls/ducking ([notes/calls.md](notes/calls.md),
    [notes/ducking.md](notes/ducking.md)), Settings + Discord
    ([notes/settings-discord.md](notes/settings-discord.md)), memory
    ([notes/performance.md](notes/performance.md)). Reports: `research-local/team/`.
  - **Website rebuild + live demo** (D79, [notes/website.md](notes/website.md)): the real app runs
    in the page against a fake daemon in the browser; new landing, /demo/, /download/,
    /changelog/, legal pages, 404, posters and share cards. Brief, research, critic and fix
    reports: `research-local/site-overhaul/` (`BRIEF.md`, `review/`).
- All checks green before the tag: pnpm typecheck/test/lint:tokens/check:docs, web tests 38/38,
  cargo test (workspace), web build; live pages checked with Playwright (no console errors).

## Next
1. Owner: hand checks in STATUS "Your checklist": the website on a real iPhone/Android and Safari,
   then the power-round block (permissions, ducking, Discord, memory, new APK on a real phone).
2. Owner decision: remote-added projects (D42) are approved at once, so a paired phone can open
   any folder (review5). The website copy states this honestly; change it if D42 changes.
3. Owner: imprint postal address and contact, Windows minimum version (both not invented).
4. When the demo or the app's look changes: `node scripts/dev/site-posters.mjs <dev url>` then
   `node scripts/dev/site-og.mjs`; new protocol requests need an answer in
   `apps/web/src/demo/daemon/handlers` (tests check every request is answered).

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

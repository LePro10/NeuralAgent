# Handoff

Current state for a fresh session. Start with [../AGENTS.md](../AGENTS.md) (rules, routine), then
[CODEMAP.md](CODEMAP.md) to find files. Progress and the owner's checklist: [STATUS.md](STATUS.md);
plan: [PLAN.md](PLAN.md); decisions: [DECISIONS.md](DECISIONS.md). The longer previous handoff
(module pointers per milestone): [archive/HANDOFF-2026-10-30.md](archive/HANDOFF-2026-10-30.md).

## Latest (2026-11-01, evening) — copy/paste overhaul (D82), NOT committed, not released
- Terminal: OSC 52 handler (`lib/osc52.ts` + test), so Claude Code's own mouse selection lands on the clipboard;
  ⌘C / menu Copy reuse it; menu hints "⌥-drag / Shift-drag to select". One clipboard path (`lib/clipboard.ts`,
  registered in `DaemonProvider`); desktop native `clipboard_write_text` / `clipboard_text` (arboard).
- Checks green: typecheck, test, lint:tokens, check:docs, `cargo check -p neuralagent-desktop`.
- Open: not tried by hand in the real Tauri app yet (needs `pnpm dev` with a test NEURALAGENT_HOME and Claude
  Code in fullscreen/mouse mode); web remote in Safari falls back to a toast with a Copy button.

## Latest (2026-11-01, afternoon) — landing slimmed down, DEPLOYED, NOT committed
- Landing 18.5k px -> 14.8k px: Hero centred over a scroll-linked aura (blobs + grid, `--c`) with a release pill and
  an agent ribbon (HeroRoster removed); new `sections/Highlights` bento (5 motion panes, pointer light, links to
  /features/); Security shows only the walkthrough (`<Security full />` on /security/ has facts, limits, what leaves);
  Platforms is now 5 compact tiles (details on /download/); FAQ shows 6, "Show all". Agents + full Spec moved to the new
  page `/features/` (`src/features.tsx`); new `/security/` (`src/security.tsx`). Nav: Features, Live demo, Security,
  Download, Changelog. Relay counts the two new pages (`telemetry.rs` PAGES), sitemap updated.
- Deployed from the working copy: build `0.5.0+mvxw9z5g`, rollback image `neuralagent-relay:prev`. Checks green.
- Open: commit this; `docs/ADMIN-HANDBUCH.md` has an unrelated uncommitted edit (not mine); no OG images for the two
  new pages yet (they use /og.png).

## Where we are (2026-11-01, afternoon)
- **0.5.0 released and deployed** (D81 insights, [notes/insights.md](notes/insights.md)): admin
  dashboard tabs, anonymous usage ping (opt-out), problem reports with diagnostics, cookieless site
  counts, downloads/update checks per platform/version/country, admin mail + push. Tag `v0.5.0` =
  `main` = `mobile-overhaul` (`16b95cc`), CI Release run 41312725246 green,
  `/api/releases/latest` serves 0.5.0. Relay + website live: build `0.5.0+mvxvve17`, healthy,
  rollback image `neuralagent-relay:prev` (= 0.4.0 build).
- GeoIP: `/opt/neuralagent/geoip.sh` ran once (DB-IP 2026-11 loaded), root cron `17 4 3 * *`.
- Not done: App Privacy panel not screenshotted (`ui-check`); admin push not tried on a real phone.
- Owner rule: always ask which version number before a release.

## Before that (2026-11-01, midday)
- **0.4.1 released** (patch, D80): LLM keys out of the macOS keychain into `keys.json` with a
  one-time migration (no more password prompts on update/settings change, daemon start no longer
  blocks), update relaunch via Launch Services (no second Dock icon), single-instance plugin on
  all desktops. Tag `v0.4.1` = `main` = `mobile-overhaul` (`1b4a0e5`), CI run 41305906543 green,
  `/api/releases/latest` serves 0.4.1. Website/relay NOT redeployed (only `/changelog` is stale;
  run `deploy-web` if wanted). The 0.4.0→0.4.1 update itself still runs the old relaunch and one
  last keychain prompt; check after that update that both are gone.

## Before that (2026-11-01, night)
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

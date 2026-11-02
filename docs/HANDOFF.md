# Handoff

Current state for a fresh session. Start with [../AGENTS.md](../AGENTS.md) (rules, routine), then
[CODEMAP.md](CODEMAP.md) to find files. Progress and the owner's checklist: [STATUS.md](STATUS.md);
plan: [PLAN.md](PLAN.md); decisions: [DECISIONS.md](DECISIONS.md). Older handoffs:
[archive/HANDOFF-2026-10-30.md](archive/HANDOFF-2026-10-30.md) and git history of this file.

## Done, not committed (2026-11-02): "Hey Neural" round (D84)
Brief: `research-local/briefs/hey-neural.md`. All in the working copy, **no commit, no deploy**
(owner decides). Build + `cargo test --workspace`, desktop `cargo test`/clippy, `pnpm typecheck/test/
lint:tokens/check:docs` green. Changes: wake word starts a call with preroll (`voice.rs`,
`voice_preroll`, `duck_call` → `call_active`, `App.tsx`, `call.ts` `startCall(client, {wake,
preroll})`, 20 s idle hang-up); daemon `call.rs` END_OF_TURN 0.8 s + HOLD for unfinished sentences,
`na_voice::text::{strip_wake, unfinished}`; wake score 1.5 (corpus `/tmp/wakecorpus`, `say` voices);
`backgroundThrottling: "disabled"`; Shimmer as clipped gradient, VoiceOrb `updatePlaybackRate`.
Only tested automatically: no real-microphone/real-app run of wake → call, preroll timing, idle
hang-up, hidden-window audio, or the animations on screen (run `ui-check` / a real try).
Round 2 (D86, also uncommitted): wake chime, call state + hang-up in the HUD pill (`hud_call`,
`hud-hangup`), guided "Learn my voice" (3 takes), loose wake path (`loose_match`). Only automatic
tests plus browser screenshots of the pill; not tried in the real app: chime, clicking the
non-focusable pill, hang-up event, guided learn, the loose path on a real voice.
Another session (neuralagent-a7) adds a dictation history in `voice.rs`, `lib.rs`, `voice.ts`,
HostSettings (D85); ship together, the owner picks the version.

## Where we are (2026-11-02)
- Released: 0.5.1 (tag `v0.5.1` = `main` = `mobile-overhaul` `046401c`); `/api/releases/latest` serves it.
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

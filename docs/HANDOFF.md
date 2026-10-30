# Handoff

Current state for a fresh session. Detailed progress: `STATUS.md`; plan: `PLAN.md`;
decisions: `DECISIONS.md`.

## Where we are (2026-10-30)
- M0–M9 done (small leftovers and user checks in STATUS). Next: M10 (own ideas, polish,
  final report). Details:
  - Themes/updates/releases (M9, D38): `packages/app/src/lib/theme.ts`,
    `packages/ui/ui/styles/themes.css`; relay `crates/na-relay/src/releases.rs`; desktop
    `apps/desktop/src-tauri/src/update.rs` + `daemon_upgrade` in `lib.rs`, watcher in
    `apps/desktop/src/main.tsx`; APK notice `useApkUpdate` in `apps/web/src/remote/Remote.tsx`;
    `/download` page `apps/web/src/download.tsx`. Release: `node scripts/set-version.mjs X.Y.Z`,
    commit, tag `vX.Y.Z`, push → `.github/workflows/release.yml` (scripts `stage-daemon`,
    `release-collect`, `release-publish`). App log: `<data>/logs/app.log`.
    Local N-1→N kit in `/tmp/na-upd` (`ctl.mjs start|status|stop`, `test.conf.json` allows
    http, run apps from `/private/tmp/…` — the updater refuses the `/tmp` symlink).
  - Swarm (M8, D37): `crates/na-daemon/src/swarm.rs` (bridge `neuralagentd swarm-mcp`,
    `POST /swarm`, outbox, briefs), `layout::grid_tab`, Neural tool `start_swarm` in `orch.rs`;
    UI `packages/app/src/components/SwarmPage.tsx`. Tests: `scripts/e2e-swarm.ts` with
    `scripts/fake-agent.mjs`. Real-agent kit outside the repo: `/tmp/na-orch/swarm-real.mjs`
    (Claude Haiku team in `/tmp/na-orch/proj/swarm-real`; `TRUST=0` once the folder is
    trusted, `git checkout greet.py` to reset), `/tmp/na-drive/swarm-ui.mjs` (screenshots).
  - Neural (M7, D36): `crates/na-daemon/src/{orch,llm,secrets,call}.rs`; UI
    `packages/app/src/components/NeuralPage.tsx`, `lib/call.ts` + `lib/mic-worklet.js`,
    Settings → Neural / Calls; Android `CallService`, `CallTile`, `MainActivity.calling`.
    Test kit outside the repo: `/tmp/na-orch` (home with testbot profile, `orch-test.mjs "<text>"`,
    `clear.mjs`, `last.mjs`), `/tmp/na-call` (`call-test.mjs a.wav b.wav@barge=2000 c.wav@wait=ms`,
    env NOISE/ECHO/HOLD/OUT; `voices.mjs`), `/tmp/na-drive/call-ui.mjs` (Chromium, fake mic).
    Start the test daemon with the key from the keychain:
    `NEURALAGENT_HOME=/tmp/na-orch/home NEURALAGENT_LLM_KEY="$(security find-generic-password -s neuralagent-llm -w)" ./target/release/neuralagentd`.
    Release daemons on macOS keep remote sign-in in the keychain: use the debug daemon for
    the Android env (`/tmp/na-android/env2.sh`).
  - Relay `crates/na-relay` live on .96 (container `neuralagent-relay`, `/opt/neuralagent`,
    env `/etc/neuralagent/relay.env` — never print it). CI pushes the image to GHCR; .96 can't
    pull it until the read token exists, so deploy by hand:
    `git ls-files -z | rsync -a --from0 --files-from=- ./ root@192.168.30.96:/opt/neuralagent/src/`
    then on .96 `cd /opt/neuralagent/src && docker build -f deploy/relay/Dockerfile -t ghcr.io/lepro10/neuralagent-relay:latest .`
    and `cd /opt/neuralagent && docker compose up -d`. The image includes `apps/web/dist`.
  - `apps/web`: landing, legal drafts, `/admin/` (admin accounts), `/app/` web remote
    (`src/remote/`, uses `@neuralagent/remote` + the shared `@neuralagent/app`).
  - `packages/remote`: RemoteAccount / RelayLink / sealed Transport (D27–D29, D32).
  - Phone layout in `packages/app` (D33).
  - Push (D34): daemon sends `notify` on attention → relay `push.rs` → FCM (Android) and Web
    Push/VAPID (browser, installed iPhone PWA). FCM service account on .96 at
    `/etc/neuralagent/firebase-service-account.json` (uid 10001, 400), mounted by compose.
    Web remote: `apps/web/public/app/sw.js` + `src/remote/push.ts`; tap → `/app/?host&sid`.
  - Chromium driver for web push: `/tmp/na-drive/web-push.mjs` (mock push service).
  - Android app `apps/android` (D35): Capacitor 8 shell loading `/app/` from the relay;
    native code in `android/app/src/main/java/dev/neuralhub/neuralagent/` (NativePlugin,
    PushService, AgentWidget, AgentTile, Status); web side `apps/web/src/remote/native.ts`.
    `google-services.json` and the release keystore (`~/.neuralagent-secrets/android-release.jks`,
    password in keychain `neuralagent-android-keystore`) are outside the repo and GitHub secrets.
- Next: M10.
- Open small things: "Last seen" for a device that never
  connected shows its creation date; dashboard says "No agents running" while only a shell runs.

## How to run
- `pnpm dev` (Tauri dev; set `NEURALAGENT_HOME=/tmp/na-dev` to keep test state separate).
- Browser UI against the same daemon: `http://localhost:1420/dev.html#port=…&token=…`
  (values from `$NEURALAGENT_HOME/daemon.json`; never paste the token anywhere).
- Headless WebKit for UI checks: playwright-core in a scratch folder (`/tmp/na-drive`), not a repo dep yet.
- `cargo test --workspace`; `pnpm typecheck && pnpm test && pnpm lint:tokens`.
- Remote E2E: `cargo build -p na-daemon && cargo build -p na-relay --features test-login &&
  node --experimental-strip-types scripts/e2e-remote.ts`. Remote page screenshots:
  `/tmp/na-drive/remote-ui.mjs` (needs vite on :1420). Web remote in WebKit:
  `pnpm --filter @neuralagent/web build && node /tmp/na-drive/web-remote.mjs` (shots in
  `/tmp/na-web-remote-shots/`).
- Daemon smoke: `NEURALAGENT_HOME=/tmp/na-smoke ./target/debug/neuralagentd &` then
  `NEURALAGENT_HOME=/tmp/na-smoke node scripts/daemon-smoke.mjs`.
- Hook tests: scripts in `/tmp/na-drive` (`perm2.mjs` permission flow, `notify-sim.mjs` Codex
  notify, `install.mjs <agent>` install pane). Claude test profiles use `--model haiku`.
- Window screenshot: `research-local/tools/winid neuralagent` → `screencapture -x -o -l <id>`.
- Voice E2E without speakers: dev build with `NEURALAGENT_TEST_MIC=a.wav:b.wav` (16 kHz, played
  in real time, 2 s apart); Swift helpers in `/tmp/na-drive` (`hold <s>` holds ⌥Space,
  `holdf5`, `sink <out> <s>` text field that saves what was typed, `click x y`). Test wavs:
  `/tmp/na-voice/{corpus,wake}`. Models: `$NEURALAGENT_HOME/models`.
- Android emulator test: `export JAVA_HOME=/opt/homebrew/opt/openjdk@21
  ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`; start AVD `na36` headless
  (`$ANDROID_HOME/emulator/emulator -avd na36 -no-window -gpu swiftshader_indirect`); local relay
  (test login, FCM) + daemon via `scripts/android-dev.sh` (relay on :8095); `adb reverse tcp:8095
  tcp:8095` (WebCrypto needs localhost, not 10.0.2.2); build with
  `cd apps/android && NA_REMOTE_URL=http://localhost:8095/app/ npx cap sync android && cd android
  && ./gradlew assembleDebug`, then `adb install -r`. Run `npx cap sync android` again without
  the variable afterwards. WebView JS: `adb forward tcp:9333
  localabstract:webview_devtools_remote_<pid>` and `/tmp/na-drive/wv.mjs '<expr>'`.
- Daemon request helper: `/tmp/na-drive/mcp.mjs save|start [profile]|type <data>|screen|usage [days]`
  (`WS=<index>` picks the workspace; `/private/tmp/na-claude-test` is trusted by Claude, use it).

# Dev and test tools (`scripts/dev`)

Drivers and kits for checking the app by hand or by an agent: a throwaway test daemon with the
UI in a browser, screenshots at phone and desktop sizes in light and dark, the web remote against
a local relay, Neural/call/swarm kits and the Android WebView probe. CI uses the scripts one level
up (`scripts/e2e-*.ts`, `scripts/daemon-smoke.mjs`); these are for interactive checks.

**Safety:** every tool runs its own daemon under a `/tmp` home (`lib.mjs` refuses the installed
app's data dir) and stops only processes it started. Never restart or kill the user's
NeuralAgent app or daemon. Tools never print the daemon token.

## Setup (once)
```
pnpm install                                   # includes playwright-core (root devDependency, pinned)
pnpm exec playwright-core install chromium webkit   # browsers, if ~/Library/Caches/ms-playwright lacks them
cargo build -p na-daemon                       # target/debug/neuralagentd
cargo build -p na-relay --features test-login  # only for web-remote / web-push / conn-repro
```
`playwright-core` (not `playwright`) is enough: no test runner, no bundled browsers download on
install. Override binaries with `NA_DAEMON_BIN` / `NA_RELAY_BIN` (e.g. a release build).

## UI screenshots (desktop UI in a browser)
```
node scripts/dev/env.mjs up --seed [--llm]     # test daemon (/tmp/na-ui) + Vite :1451 + demo data
node scripts/dev/shot.mjs pages --montage      # phone + desk, dark + light → research-local/shots/
node scripts/dev/shot.mjs pages agents settings --devices phone,small,kb --schemes light
node scripts/dev/env.mjs down                  # stops exactly what `up` started
```
- `env.mjs up|status|down [--home dir] [--port n] [--seed] [--llm] [--no-vite]`. State in
  `<home>/dev-env.json`, logs in `<home>/{daemon,vite,fake-llm}.log`. The daemon gets
  `NEURALAGENT_DEV_ORIGIN=http://127.0.0.1:<port>` (debug builds accept that one extra origin).
- `seed.mjs base|llm|nollm|mcp|ask` (`NEURALAGENT_HOME` set): four workspaces, stand-in
  Claude/Codex/Gemini sessions (`fake-cli.sh`) in done / needs-input / working / error states via
  real hook events, a fake-agent swarm, MCP servers; `llm` points Neural at `fake-llm.mjs`.
- `shot.mjs [scene] [args] [--devices] [--schemes] [--out] [--dpr] [--inset] [--status-bar]
  [--hash "&update=0.3.0"] [--fake-mic f.wav] [--engine] [--montage]`. Devices: `phone` 390×844,
  `small` 360×780, `kb` 390×450 (keyboard open), `tablet` 820×1180, `laptop` 1280×800,
  `desk` 1440×900. Phones run in Chromium with touch and a simulated 28 px Android status bar
  inset; desktop sizes in WebKit (like the macOS app). Default DPR 1 keeps images small.
- Scenes (`scenes/*.mjs`): `home` (start page), `pages` (Neural, Agents, Workspaces, Swarm,
  History, Usage, MCP, Settings; pass names to limit), `call` (Call Neural with a fake mic).
  A scene is `export default async ({ p, shot, tap, go, more, sleep, phone, light, args, req }) => …`
  where `go("Agents")` uses the phone tab bar or the desktop sidebar and `more("Usage")` the More
  page / sidebar / account menu. Write a new scene for a new screen instead of a one-off script.
- `--hash` passes fake update states to `apps/desktop/src/dev-browser.tsx` (its header lists them).
- `montage.mjs out.png [--tile 240] a.png b.png …`: one labelled contact sheet. Review the
  montage first (cheap), open single shots only where something looks off.

## Web remote and push (relay + daemon + browser)
```
pnpm --filter @neuralagent/web build
node scripts/dev/web-remote.mjs --montage      # sign-in, computers, app, Agents, More (phone + desk, dark + light)
node scripts/dev/web-remote.mjs --keep         # leave it running and explore http://127.0.0.1:8093/app/
node scripts/dev/web-push.mjs                  # Web Push with a mock push service (Chromium)
node --experimental-strip-types scripts/dev/conn-repro.mts idle|flood|upload   # reconnect harness (throttled phone link)
```
All use a fresh `/tmp/na-web-*` / `$TMPDIR/na-repro-*` folder, the relay's test sign-in and
`owner@example.com`. Ports: `--relay-port` / `RELAY_PORT` (pick free ones if another agent runs a relay).

## Daemon from the command line
`NEURALAGENT_HOME=/tmp/na-ui node scripts/dev/daemon.mjs <cmd>`: `state`, `req <method> [json]`,
`add <dir>`, `start [profile]` (`WS=<index>`), `type 'text\r'`, `screen`, `stop`, `watch [sid] [s]`
(status + attention events, e.g. a permission prompt), `tick <dir>` (session that proves it
survives updates), `orch "<text>"`, `orch-clear`, `orch-last`, `usage [days]`.
For a real Claude session use a folder Claude already trusts and `--model haiku` profiles.

## Neural, calls, swarm (real models)
- Real Neural: start a test daemon with the key from the keychain (never echo it):
  `NEURALAGENT_HOME=/tmp/na-neural NEURALAGENT_LLM_KEY="$(security find-generic-password -s neuralagent-llm -w)" target/release/neuralagentd serve`,
  then `daemon.mjs orch "Starte den testbot in …"`. Budget rules: `docs/STATUS.md`.
- `call-test.mjs a.wav b.wav@barge=2000 c.wav@wait=ms` streams 16 kHz clips like a microphone
  and measures time to first audio (env `NOISE`, `ECHO`, `HOLD`, `OUT`). Make clips with
  `say -o q.wav --data-format=LEI16@16000 "…"`. Needs voice models in `$NEURALAGENT_HOME/models`.
- Browser call UI: `shot.mjs call --devices phone --schemes dark --fake-mic q.wav`.
- `swarm-real.mjs ["goal"]`: four Claude Code (Haiku) members on a tiny task in
  `/tmp/na-swarm-real` (`TRUST=0` once trusted, `git -C /tmp/na-swarm-real checkout greet.py` resets).
  The stand-in version without models runs in CI: `scripts/e2e-swarm.ts`.

## Android
- Emulator recipe: `docs/HANDOFF.md` → "How to run". Local relay + daemon:
  `scripts/android-dev.sh` (prefix `NEURALAGENT_LLM_KEY="$(security find-generic-password -s neuralagent-llm -w)"`
  for Neural/calls).
- `wv.mjs '<expr>' [waitMs]`: evaluate JS in the app's WebView over CDP after
  `adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`.

## macOS input helpers (voice / hotkey tests)
`scripts/dev/macos/build.sh` compiles `hold <s>` (holds ⌥Space), `holdf5`, `sink <out> [s]`
(focused text window that saves what was typed), `click x y`, `move x y`, `winid <owner>` into
`scripts/dev/macos/bin/` (git-ignored). Window screenshot of the real app (read-only):
`screencapture -x -o -l $(scripts/dev/macos/bin/winid neuralagent | head -1) shot.png`.
Voice E2E without speakers: a dev build with `NEURALAGENT_TEST_MIC=a.wav:b.wav`.

## Update test (N-1 → N)
- UI only: `shot.mjs … --hash "&update=0.3.0&service=0.2.0"` (fake updater in dev-browser.tsx).
- Real install: build two versions in a separate worktree (`set-version` rewrites files), with
  `--config scripts/dev/update/test.conf.json` (allows http), serve them from a local relay, point
  the app at it with `NEURALAGENT_UPDATE_URL`, run the apps from `/private/tmp/…` (the updater
  refuses the `/tmp` symlink) with a test `NEURALAGENT_HOME`, and keep a `daemon.mjs tick`
  session running to prove agents survive. Background: `docs/RELEASING.md`, D38.

## Install a local build on the owner's Mac (only when asked)
`scripts/dev/install-local.sh path/to/NeuralAgent.app` replaces `/Applications/NeuralAgent.app`
and restarts the **real** app and daemon (log `/tmp/na-install.log`). For when CI cannot publish
(`docs/RELEASING.md`). Your own session probably runs inside that daemon: start it detached
(`nohup … >/dev/null 2>&1 &`) as the very last step; it waits 25 s (`DELAY`) before it stops anything.

# Handoff

Current state for a fresh session. Detailed progress: `STATUS.md`; plan: `PLAN.md`;
decisions: `DECISIONS.md`.

## Where we are (2026-10-30)
- M0–M4 done (small leftovers in STATUS). M5 in progress:
  - Relay `crates/na-relay` live on .96 (container `neuralagent-relay`, `/opt/neuralagent`,
    env `/etc/neuralagent/relay.env` — never print it). Image built on .96 by hand until the
    GHCR token exists: `git ls-files -z | rsync -a --from0 --files-from=- ./ root@192.168.30.96:/opt/neuralagent/src/`
    then `docker build -f deploy/relay/Dockerfile -t ghcr.io/lepro10/neuralagent-relay:latest .`
    in `/opt/neuralagent/src` and `docker compose up -d` in `/opt/neuralagent`.
  - Daemon remote client `crates/na-daemon/src/remote.rs` (D27–D29), desktop page
    `RemotePage.tsx`, tray Disconnect/Reconnect.
- Next for M5: admin web UI (`/admin`: requests, users, devices, stats, passkey) and landing in
  `apps/web` (served by the relay from `NA_RELAY_WEB`); then M6 web remote `/app` (pairing at
  `/app/pair#c=&h=&f=`, client side of the E2E envelopes `hs1/hs2/d/bye` — see remote.rs).
- Open small things: `dev:web` script points at the web package that doesn't exist yet; audit log of remote
  actions (M7); "Last seen" for a device that never connected shows its creation date.

## How to run
- `pnpm dev` (Tauri dev; set `NEURALAGENT_HOME=/tmp/na-dev` to keep test state separate).
- Browser UI against the same daemon: `http://localhost:1420/dev.html#port=…&token=…`
  (values from `$NEURALAGENT_HOME/daemon.json`; never paste the token anywhere).
- Headless WebKit for UI checks: playwright-core in a scratch folder (`/tmp/na-drive`), not a repo dep yet.
- `cargo test --workspace`; `pnpm typecheck && pnpm test && pnpm lint:tokens`.
- Remote E2E: `cargo build -p na-daemon && cargo build -p na-relay --features test-login &&
  node --experimental-strip-types scripts/e2e-remote.ts`. Remote page screenshots:
  `/tmp/na-drive/remote-ui.mjs` (needs vite on :1420).
- Daemon smoke: `NEURALAGENT_HOME=/tmp/na-smoke ./target/debug/neuralagentd &` then
  `NEURALAGENT_HOME=/tmp/na-smoke node scripts/daemon-smoke.mjs`.
- Hook tests: scripts in `/tmp/na-drive` (`perm2.mjs` permission flow, `notify-sim.mjs` Codex
  notify, `install.mjs <agent>` install pane). Claude test profiles use `--model haiku`.
- Window screenshot: `research-local/tools/winid neuralagent` → `screencapture -x -o -l <id>`.
- Voice E2E without speakers: dev build with `NEURALAGENT_TEST_MIC=a.wav:b.wav` (16 kHz, played
  in real time, 2 s apart); Swift helpers in `/tmp/na-drive` (`hold <s>` holds ⌥Space,
  `holdf5`, `sink <out> <s>` text field that saves what was typed, `click x y`). Test wavs:
  `/tmp/na-voice/{corpus,wake}`. Models: `$NEURALAGENT_HOME/models`.
- Daemon request helper: `/tmp/na-drive/mcp.mjs save|start [profile]|type <data>|screen|usage [days]`
  (`WS=<index>` picks the workspace; `/private/tmp/na-claude-test` is trusted by Claude, use it).

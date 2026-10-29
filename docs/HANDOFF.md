# Handoff

Current state for a fresh session. Detailed progress: `STATUS.md`; plan: `PLAN.md`;
decisions: `DECISIONS.md`.

## Where we are (2026-10-29, late)
- M0, M1 done; M2 done except a real Codex turn (needs `codex login`, D17). M3 done except the
  tray/overlay dictation indicator and TTS playback (needed by M7).
- M4 nearly done (see STATUS "M4 verified so far"): keep-awake, Discord, resume, history, tray,
  git + worktrees (`crates/na-daemon/src/git.rs`, D23), browser preview (`preview.rs`,
  `BrowserPane.tsx`), MCP (`mcp.rs`, `McpPage.tsx`, D24), usage & cost (`usage.rs`, statusline
  wrapper in `hooks.rs`, D25; UI `UsagePage.tsx`). After usage: close the M4 row in STATUS and
  start M5 (relay, pairing, remote) per PLAN.md.
- Windows CI: the PTY test passes since the single-write DSR fix; the git test needed
  `core.autocrlf=false` (fixed in 8f513f6).
- Open small things: `dev:web` script points at the M5 web package; check the browser iframe
  in a bundled build (tauri:// scheme); "Disconnect remote" in the tray comes with M5.

## How to run
- `pnpm dev` (Tauri dev; set `NEURALAGENT_HOME=/tmp/na-dev` to keep test state separate).
- Browser UI against the same daemon: `http://localhost:1420/dev.html#port=…&token=…`
  (values from `$NEURALAGENT_HOME/daemon.json`; never paste the token anywhere).
- Headless WebKit for UI checks: playwright-core in a scratch folder (`/tmp/na-drive`), not a repo dep yet.
- `cargo test --workspace`; `pnpm typecheck && pnpm test && pnpm lint:tokens`.
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

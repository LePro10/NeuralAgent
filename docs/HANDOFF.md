# Handoff

Current state for a fresh session. Detailed progress: `STATUS.md`; plan: `PLAN.md`;
decisions: `DECISIONS.md`.

## Where we are (2026-10-29)
- M0, M1 done; M2 done except a real Codex turn (needs `codex login`, D17). M3 in progress.
- M3 so far: `crates/na-voice` (stt/wake/vad/tts + benches in `examples/`, numbers in D19–D21);
  desktop voice in `apps/desktop/src-tauri/src/{voice,mic,models}.rs` (D22); UI
  `packages/app/src/components/SettingsPage.tsx` (gear in the sidebar rail).
- CI: commit 1e09fe3 drops stale sherpa build output after the cache restore (mac/linux failed
  with "could not find native static library sherpa-onnx-c-api"). Windows
  `pty::tests::spawn_echo_and_attach` still hangs (no exit note in 10 s even with the DSR
  answer); the test now panics with child state, bytes read and screen. Read that, then fix.
- Next in M3: tray/overlay indicator while dictating outside the app; TTS playback (cpal out)
  is needed by M4 (orchestrator). Then M4 per PLAN.md.

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

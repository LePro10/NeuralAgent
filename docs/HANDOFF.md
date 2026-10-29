# Handoff

Current state for a fresh session. Detailed progress: `STATUS.md`; plan: `PLAN.md`;
decisions: `DECISIONS.md`.

## Where we are (2026-10-29)
- M0 done: protocol (`crates/na-protocol` → TS `packages/protocol/src/gen`), daemon
  (`crates/na-daemon`), CI (`.github/workflows/ci.yml`), logo C (`docs/brand/`).
- M1 in progress: desktop shell `apps/desktop` (Tauri; `src-tauri/src/daemon.rs` starts the
  daemon detached), shared UI `packages/app` (App → WorkspaceView → PaneTree → Pane →
  TerminalView/EmptyPane). Grid, tabs, presets, shortcuts, persistence verified.
- Next in M1: settings page (keep-awake, theme, Discord mode), session list/search/resume, tab
  rename, pane drag-to-swap check, keep-awake implementation; then M2 (agent catalog with
  detection/one-click install, hooks per CLI, dashboard) — use `research-local/analysis/cli-research.md`.

## How to run
- `pnpm dev` (Tauri dev; set `NEURALAGENT_HOME=/tmp/na-dev` to keep test state separate).
- Browser UI against the same daemon: `http://localhost:1420/dev.html#port=…&token=…`
  (values from `$NEURALAGENT_HOME/daemon.json`; never paste the token anywhere).
- Headless WebKit for UI checks: playwright-core in a scratch folder (`/tmp/na-drive`), not a repo dep yet.
- `cargo test --workspace`; `pnpm typecheck && pnpm test && pnpm lint:tokens`.
- Daemon smoke: `NEURALAGENT_HOME=/tmp/na-smoke ./target/debug/neuralagentd &` then
  `NEURALAGENT_HOME=/tmp/na-smoke node scripts/daemon-smoke.mjs`.
- Window screenshot: `research-local/tools/winid neuralagent` → `screencapture -x -o -l <id>`.

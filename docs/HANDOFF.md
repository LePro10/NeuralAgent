# Handoff

Current state for a fresh session. Detailed progress: `STATUS.md`; plan: `PLAN.md`;
decisions: `DECISIONS.md`.

## Where we are (2026-10-29)
- M0, M1 done. M2 in progress (see STATUS "M2 verified so far").
- Daemon: `catalog.rs` (13 CLIs, detect/install), `profiles.rs` (launch args, hook injection),
  `core.rs::on_hook` (hook → status mapping), Windows exit detection in `pty.rs` (wait thread).
- UI: `AgentCatalog.tsx` (sheet, opened via `useCatalogSheet`), `AgentsDashboard.tsx` (sidebar
  "Agents"), `lib/profiles.ts::launchable` (installed-only launchers).
- Next in M2: custom profile editor (name, CLI, extra args), check notifications in the Tauri
  app, CI green on Windows. Then M3 per PLAN.md. Settings page, session search/resume and
  keep-awake are still open from the M1 extras.
- Codex: installed at `~/.local/bin/codex`, not logged in (D17).

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

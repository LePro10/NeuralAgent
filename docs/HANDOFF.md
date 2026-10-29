# Handoff

Current state for a fresh session. Detailed progress: `STATUS.md`; plan: `PLAN.md`.

## Where we are (2026-10-29)
- Phase 0 done (feature matrix in `research-local/FEATURES.md`, never committed).
- M0 in progress: protocol crate (`crates/na-protocol`, TS in `packages/protocol/src/gen`),
  daemon (`crates/na-daemon`: PTY + vt100 snapshots, state/events, WS server, layout placement,
  policy, smoke test `scripts/daemon-smoke.mjs`) — tests green.
- Next: Tauri desktop shell (`apps/desktop`), shared React app (`packages/app`), protocol client
  (`packages/protocol/src/*.ts`), CI, brand logos.

## How to run
- `cargo test -p na-protocol` regenerates TS types.
- `NEURALAGENT_HOME=/tmp/na-smoke ./target/debug/neuralagentd &` then
  `NEURALAGENT_HOME=/tmp/na-smoke node scripts/daemon-smoke.mjs`.

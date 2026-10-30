# NeuralAgent

A desktop app for running many AI coding agents side by side — Claude Code, Codex, Gemini and
more in a grid of persistent terminals — with a dashboard, local voice control, an orchestrator
called **Neural**, and a phone remote.

Closed source. © Leandro Probst.

## Where to start
- [`AGENTS.md`](AGENTS.md): entry point for contributors and agents (repo map, rules, release checklist).
- [`docs/README.md`](docs/README.md): index of all docs (handoff, status, plan, decisions, notes).
- [`CHANGELOG.md`](CHANGELOG.md): what changed in each release. Also at
  [agent.neuralhub.dev/changelog](https://agent.neuralhub.dev/changelog).
- [`docs/RELEASING.md`](docs/RELEASING.md): how to cut a release.

## Develop
Requirements: Rust (stable), Node 22+, pnpm 12.

```
pnpm install
cargo build
pnpm dev          # desktop app (Tauri)
pnpm dev:web      # web remote at http://localhost:5173/app
cargo test        # Rust tests (also regenerates protocol TS types)
pnpm typecheck && pnpm test && pnpm lint:tokens
```

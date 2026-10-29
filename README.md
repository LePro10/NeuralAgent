# NeuralAgent

A desktop app for running many AI coding agents side by side — Claude Code, Codex, Gemini and
more in a grid of persistent terminals — with a dashboard, local voice control, an orchestrator
called **Neural**, and a phone remote.

Closed source. © Leandro Probst.

## Layout
See [`docs/PLAN.md`](docs/PLAN.md). Product spec: [`docs/SPEC.md`](docs/SPEC.md). Decisions:
[`docs/DECISIONS.md`](docs/DECISIONS.md). Progress: [`docs/STATUS.md`](docs/STATUS.md).

## Develop
Requirements: Rust (stable), Node 22+, pnpm 12.

```
pnpm install
cargo build
pnpm dev          # desktop app (Tauri)
pnpm dev:web      # web remote at http://localhost:5173/app
cargo test        # Rust tests (also regenerates protocol TS types)
```

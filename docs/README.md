# Docs index

Start with [`../AGENTS.md`](../AGENTS.md) (entry point, per-change routine, rules, releases).
`pnpm check:docs` (also in CI) fails when a doc points at a file that does not exist.

| File | What it is for |
|---|---|
| [`HANDOFF.md`](HANDOFF.md) | Current state, next steps, open issues, how to run. Read it at the start of a session. |
| [`CODEMAP.md`](CODEMAP.md) | Generated map of every code file (purpose, main types/functions). Grep it before opening files; `pnpm codemap` after adding/renaming files. |
| [`STATUS.md`](STATUS.md) | Milestone table, the owner's checklist, test budget, known gaps. |
| [`PLAN.md`](PLAN.md) | The build plan and milestones (M0–M10; M10 is current). |
| [`DECISIONS.md`](DECISIONS.md) | Numbered design decisions (D1…) with reasons. |
| [`RELEASING.md`](RELEASING.md) | Release runbook: changelog, version, tag, CI, relay deploy, blocked-CI fallback. |
| [`../CHANGELOG.md`](../CHANGELOG.md) | User-facing release notes. Feeds the website `/changelog`, the update dialog and the release notes. |
| [`ADMIN-HANDBUCH.md`](ADMIN-HANDBUCH.md) | Operator handbook for the relay and the accounts (German). |
| [`brand/`](brand/README.md) | Logo, icon and OG image sources and how to export them. |
| [`../scripts/dev/README.md`](../scripts/dev/README.md) | Interactive test tools: test daemon + UI in a browser, screenshots, web remote, Neural/call/swarm kits. |
| [`archive/`](archive/) | History: per-milestone verification log M1–M9, the previous long handoff. Read only when you need the details. |

## Notes per feature round (`notes/`)
| File | Topic |
|---|---|
| [`notes/design-overhaul.md`](notes/design-overhaul.md) | Liquid motion, aurora, glass design system (0.2.0, D40). |
| [`notes/claude-view.md`](notes/claude-view.md) | Chat view over the real Claude Code CLI (D41). |
| [`notes/remote-host-control.md`](notes/remote-host-control.md) | Host settings, updates, models and calls from remotes (D42). |
| [`notes/website.md`](notes/website.md) | The agent.neuralhub.dev website. |
| [`notes/mobile-polish.md`](notes/mobile-polish.md) | The phone/Android polish round. |
| [`notes/launch.md`](notes/launch.md) | The launch screen on desktop, web and Android: one frame, one motion (D49). |
| [`notes/design-system.md`](notes/design-system.md) | Design-system rules (D45): tokens, phone navigation, overlays, activity marks, page checklist. Read before building a screen. |

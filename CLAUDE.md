# CLAUDE.md

Read [`AGENTS.md`](AGENTS.md) first: it is the single entry point for this repo (map, where state
lives, per-change routine, multi-agent rules, safety, secrets, releases). Current state:
[`docs/HANDOFF.md`](docs/HANDOFF.md). Find files via [`docs/CODEMAP.md`](docs/CODEMAP.md).
Project skills: `release`, `deploy-web`, `ui-check` (`.claude/skills/`).

The most important rule: never restart, kill or upgrade the user's installed NeuralAgent app or
daemon (this session may run inside it). Use a test `NEURALAGENT_HOME` under `/tmp`.
Answers to the owner: short, simple German. Code and docs: English.

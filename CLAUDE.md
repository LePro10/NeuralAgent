# CLAUDE.md

Read [`AGENTS.md`](AGENTS.md) first: it is the single entry point for this repo (map, where state
lives, run/test, conventions, safety, secrets, release checklist). Current state:
[`docs/HANDOFF.md`](docs/HANDOFF.md).

The most important rule: never restart, kill or upgrade the user's installed NeuralAgent app or
daemon (this session may run inside it). Use a test `NEURALAGENT_HOME` under `/tmp`.

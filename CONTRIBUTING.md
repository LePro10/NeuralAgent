# Contributing

Thanks for helping. NeuralAgent is open source under the [GNU AGPL-3.0](LICENSE).

## How a change gets in
1. **Fork** this repository (button "Fork" on GitHub) and clone your fork.
2. Create a branch in your fork, e.g. `fix-microphone`.
3. Make the change, run the checks below, push to your fork.
4. Open a **pull request** against `main` of `LePro10/NeuralAgent`.
5. CI runs on your pull request. The owner reviews it and merges it or asks for changes.
   Nobody but the owner can merge into `main` or publish a release.

A merge does not ship anything by itself. Users get the change with the next release, which the
owner publishes through the in-app updater and agent.neuralhub.dev.

Keep your fork current with **"Sync fork"** on GitHub before you start new work.

## Before you open a pull request
- Read [`AGENTS.md`](AGENTS.md): repo map, conventions and the per-change routine. Find files in
  [`docs/CODEMAP.md`](docs/CODEMAP.md).
- Run `pnpm install`, then `pnpm typecheck && pnpm test && pnpm lint:tokens && pnpm check:docs`,
  and `cargo test --workspace` when Rust or the protocol changed.
- For a user-visible change, add one line in plain words under `## [Unreleased]` in
  [`CHANGELOG.md`](CHANGELOG.md).
- UI: use `@neuralagent/ui` components and tokens only (see `docs/notes/design-system.md`).
- Code, comments, commits and docs in English.
- Never commit secrets, tokens, keystores or `.env` files.

For larger changes, open an issue first so we can agree on the approach.

## Builds from a fork
CI on a fork or pull request has no signing keys: the desktop app is ad hoc signed and the
Android APK unsigned, without push notifications. That is expected. Official builds come only
from the owner's release tags.

## License of contributions
By opening a pull request you agree that your contribution is licensed under the AGPL-3.0, the
same license as the project.

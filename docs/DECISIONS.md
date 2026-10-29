# Decisions

Own decisions made during the autonomous build, newest last. Each: what, why, alternatives.

## D1 — Daemon owns everything; the UI is a client (2026-10-29)
`neuralagentd` hosts PTYs, state, hooks, remote and the orchestrator. The desktop window speaks the
same protocol as the phone. **Why:** agents must survive app quit/update, and "remote feels like
the app" falls out for free. **Alternative:** PTYs inside the Tauri process + a separate remote
bridge (two code paths, agents die with the window).

## D2 — Event-sourced state with a ring buffer (2026-10-29)
Every mutation is an `Event` applied to the state by the same `apply()` on daemon and clients
(Rust + TS). Clients reconnect with `since=<seq>` and get the missed events (2048 kept) or a
snapshot. **Why:** no flicker, cheap updates for 16 panes, many viewers. **Alternative:** JSON
patch — more generic, harder to type.

## D3 — Terminal persistence via a headless VT emulator (2026-10-29)
Each PTY feeds a `vt100` parser (5000 lines scrollback). Attach = ANSI snapshot (scrollback in
basic SGR form + exact screen + cursor + input modes) and then raw bytes numbered by byte offset.
Snapshot and subscribe happen under one lock, so there are no gaps or duplicates. A client that
falls behind gets `term_reset` with a fresh snapshot. **Alternative:** replaying a raw output ring
buffer (breaks after resizes and when the buffer wraps mid-sequence).

## D4 — Local transport: WebSocket on 127.0.0.1 with token + Origin allow-list (2026-10-29)
Random port, 256-bit token in `daemon.json` (0600), Origin must be one of our webviews or absent.
**Why:** works identically on macOS/Windows/Linux and from the webview without a native bridge
for every frame. **Alternative:** Unix socket / named pipe (needs a Rust proxy in Tauri).

## D5 — Agents run with the login-shell environment (2026-10-29)
Captured once with `$SHELL -ilc 'env -0'` (8 s timeout), plus probing of the usual install dirs
(`~/.local/bin`, `~/.bun/bin`, Homebrew …), because GUI apps get a minimal PATH and some vendor
installers do not add their dir to PATH. Variables of an enclosing agent (`CLAUDECODE` …) are
stripped so a daemon started from an agent session does not confuse nested agents.

## D6 — Status: hooks first, output activity as fallback (2026-10-29)
Hooks are injected per process (`claude --settings <file>` …), never by editing the user's
config. Without hooks: output within 1.2 s = working, quiet 2.5 s after a prompt = done; short
output right after a keypress counts as echo. Details per CLI follow in M2.

## D7 — Approvals (user decision in the question round)
Every added workspace is approved by default (toggle per workspace). Phones/orchestrator may start,
prompt and stop agents only in approved workspaces; raw shells, settings and approvals need the
desktop. The approval queue for "confirm on device" comes with the remote (M5).

## D8 — Wake word "Hey Neural", orchestrator name "Neural" (user decision)
Wake word via sherpa-onnx keyword spotting (small zipformer, custom phrase, no training needed).

## D9 — Voice shortlist (benchmarks follow in M3/M7)
STT: Parakeet TDT 0.6B v3 int8 (German, fast on CPU), streaming candidates Nemotron/Moonshine,
whisper turbo as reference. TTS: Pocket TTS, Supertonic, Qwen3-TTS, Piper as baseline (GPL —
only as external process if at all). VAD Silero + Smart Turn for end of turn.

## D10 — No Xcode on the build Mac
iOS is a PWA only; it is tested in Safari's responsive mode, real-iPhone items are marked.

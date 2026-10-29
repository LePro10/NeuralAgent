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

## D11 — Logo: concept C, an "N" built from panes (2026-10-29)
Three concepts in `docs/brand/`. C wins: it is the product (a grid of terminal panes) and stays
readable at 16 px; the middle pane carries the ice accent. Icon set generated with
`pnpm tauri icon docs/brand/neuralagent-icon-1024.png`; uploads in `docs/brand/export/`.

## D12 — Layout is edited by the client, placed by the daemon
The UI changes the split tree and sends the whole `WorkspaceLayout` (`layout_set`); the daemon
only places new sessions (requested pane → empty pane → split the largest → new tab at 16).
Divider drags are local until release; the dragged sizes stay until the daemon echoes the new
layout (no snap-back). Pane order for ⌘1…9 and presets is on-screen order, not tree order.

## D13 — Terminal rendering
xterm.js 6 with the WebGL renderer while ≤ 12 terminals are visible (WebGL contexts are limited
per page), DOM renderer above. Inactive tabs and workspaces unmount and re-attach from the
daemon snapshot. Colours come from `--color-term-*`, mapped to design tokens (`@theme static`,
so Tailwind emits them although no utility uses them).

## D14 — Browser dev entry for UI tests
`apps/desktop/dev.html` runs the same UI in a plain browser against a local daemon (port/token in
the URL hash). Dev server only, not part of the build. Used with headless WebKit (closest to the
macOS webview) for automated UI checks; the Tauri window is checked with window screenshots.

## D15 — Agent catalog and one-click install
The daemon knows 13 agent CLIs (`crates/na-daemon/src/catalog.rs`): command, vendor install
command per OS (from the vendor docs), how a first prompt is passed (positional, flag, or typed
in) and how a session is resumed. Detection is `which` + `--version` (parallel, 6 s timeout).
Install runs the vendor command visibly in a pane (`install:<id>` pseudo profile) so the user can
see and answer every step (installers ask questions, e.g. sudo or "start now?"). The catalog is
refreshed when an install pane exits or is closed, and on demand. Launchers only offer installed
CLIs. Phones need approval to start an install (policy).

## D16 — Status from hooks, output as fallback
Claude Code: our hook commands are passed per process with `--settings <json>` (merged with the
user's own hooks, nothing written to their config). Codex: `-c notify=[<daemon>, "hook",
"codex-notify"]`, the JSON arrives as argv. Hook events set the status (SessionStart → idle,
prompt/tool use → working, permission → waiting, Stop/notify → done with the last message,
StopFailure → error). A StopFailure after a turn already ended with Stop is ignored (Claude
reports failed background requests that way). Other CLIs use output heuristics.

## D17 — Codex verified with a simulated notify call
No OpenAI account on this machine, and the NeuralHub gateway only offers Claude models, which
fail with Codex (prefill errors / 429). Codex install was tested for real; the notify path was
tested by running exactly the call Codex makes (`<daemon> hook codex-notify '<json>'`) inside a
daemon session. A real Codex turn needs the user's login (`codex login`).

## D18 — Agents dashboard
A sidebar entry "Agents" above the workspaces lists every agent session (not plain terminals or
installers) grouped by workspace, most urgent first, with the last message, time in status and
stop/restart/open. "Install agents" opens the catalog sheet.


## D19 — Dictation STT: Parakeet TDT 0.6B v3 (int8) via sherpa-onnx
Benchmark (`crates/na-voice/examples/stt_bench.rs`), Apple M4 CPU, 4 threads, 10 German + 10 English
sentences (synthetic `say` voices, 300 ms leading silence, digits count as errors):

| Model | DE WER | EN WER | RTF | latency / sentence | load |
|---|---|---|---|---|---|
| Parakeet TDT 0.6B v3 int8 (offline) | 8.7 % | 4.4 % | 0.075 | ~230 ms | 0.6 s |
| Nemotron 3.5 streaming 560 ms int8 | 14.0 % | 4.5 % | 0.20 | ~640 ms | 0.4 s |
| Whisper turbo int8 | 17.8 % | 4.2 % | 0.62 | ~1.9 s | — |

Parakeet is the default for push-to-talk dictation: best German, fast, 25 languages. Nemotron
stays available as the streaming engine (live partial text, call mode) — it needs leading
silence or it drops the first word. Whisper is too slow on CPU for <1 s. Models are downloaded on
demand into `$NEURALAGENT_HOME/models`, never bundled.

## D20 — Wake word "Hey Neural": keyword spotter + learn-my-voice, Silero VAD
`na_voice::wake` uses sherpa-onnx's streaming keyword spotter (zipformer gigaspeech, 3.3 M params,
~0.9 % of one CPU core in real time). "Hey Neural" is written as BPE pieces plus near-miss
variants (NURAL, NORAL, NOYRAL, MURAL, "Hi Neural"), boost score 2.0.
Test (`examples/wake_vad.rs`, synthetic `say` clips, 4 English + 4 German voices):

| Set | Hits | False wakes |
|---|---|---|
| English voices, "Hey Neural" (8 clips) | 8 / 8 | — |
| German voices, German pronunciation (8 clips) | 0 / 8 | — |
| German voices after learning from one clip each | 4 / 8 | — |
| Other sentences (42 clips) | — | 0 |

The model is English-only, so a German "noy-ral" is not heard. Fix: **learn my voice** —
`wake::learn` decodes a recording of the wake word with the spotter's own model and adds the
pieces it hears as another keyword line (rejected when shorter than 3 pieces, which would wake on
everyday speech). Settings will ask for three recordings. Real-voice check is on the user list.
A dedicated multilingual wake model can replace this later without changing the API.
`na_voice::vad` (Silero, 0.5 s pause) cut 52/52 test utterances correctly; it ends dictation and
call turns.

## D21 — Voice replies: Supertonic 3 (int8), 4 steps
Benchmark (`examples/tts_bench.rs`, M4 CPU, 4 threads, the 20 corpus sentences). "Round-trip WER" =
the speech transcribed again by Parakeet — a cheap intelligibility check (Parakeet alone scores
8.7 % / 4.4 % on the `say` recordings).

| Model | DE WER | EN WER | RTF | first audio (one sentence) |
|---|---|---|---|---|
| Supertonic 3 int8, 8 steps | 10.9 % | 6.7 % | 0.19 | ~700 ms |
| **Supertonic 3 int8, 4 steps** | 13.0 % | 2.0 % | 0.10 | ~380 ms |
| Supertonic 3 int8, 2 steps | 60 % | 30 % | 0.06 | ~220 ms |
| Pocket TTS int8 (cloned voice) | — (English only) | 8.9 % | 0.15 | ~330 ms |

Supertonic 3 speaks 31 languages (German included), loads in 0.2 s, MIT code + OpenRAIL-M
weights. Replies are spoken sentence by sentence, so the first audio comes after the first
sentence, not the whole answer. Pocket TTS is the English alternative with voice cloning. Piper
was dropped: sherpa-onnx 2.x no longer bundles espeak, so it would need our own phonemizer.

## D22 — Voice runs in the desktop app, models are downloaded on demand
Dictation and the wake word live in the Tauri process (`apps/desktop/src-tauri/src/voice.rs`),
not in the daemon: macOS grants microphone and Accessibility per app bundle, and the UI needs
the live state. Hold-to-talk uses `tauri-plugin-global-shortcut` (pressed/released), audio comes
from `cpal` (default input, mixed to mono, resampled to 16 kHz), text is typed with `enigo` on
the main thread. Settings are per machine in `<data>/voice.json`; default shortcut ⌥/Alt+Space
(also ⌘⇧Space or F5). The wake loop feeds the spotter and the VAD together; after a wake the
utterance is transcribed and the wake word dropped from the text (or, if the recognizer misheard
it, the audio before it is cut). Models (Parakeet, spotter, Silero, Supertonic; ~630 MB) are not
bundled: Settings downloads them from the sherpa-onnx GitHub releases and checks fixed SHA-256
sums. Dev builds accept `NEURALAGENT_TEST_MIC=a.wav:b.wav` as a fake microphone for end-to-end
tests; release builds ignore it. While listening, a separate small window (`hud.html`:
transparent, always on top, not focusable, ignores the mouse) shows a pill at the bottom of
the screen; it needs Tauri's `macos-private-api` for transparency (fine outside the App Store).

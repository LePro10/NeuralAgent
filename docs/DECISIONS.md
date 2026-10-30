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

## D23 — Git through the `git` CLI; agent worktrees inside the repository

The daemon runs the user's `git` (no libgit2): same config, hooks, credentials and behaviour as
in their terminal. A workspace's branch and change count are refreshed every 5 s; the Changes
sheet lists files against HEAD (untracked files included) and shows one file's diff at a time
(cut at 512 KB). "Own worktree per agent" (per device, in the New agent menu) gives each new
agent a branch `neuralagent/<profile>-<id>` checked out in `<repo>/.neuralagent/worktrees/…`,
hidden with `.git/info/exclude` (the user's `.gitignore` is not touched). Inside the repo, so
the worktree stays within the workspace and its approval. Merge back: commit what the agent
left uncommitted, `git merge` into the branch checked out in the workspace, remove the worktree
and branch, close the agent. On a conflict the merge is aborted and nothing changes; the agent
is told to merge the main branch first. Closing an agent whose worktree has no changes removes
it; one with changes stays until merged or discarded.

## D24 — MCP secrets live only in the daemon and the agent's environment

MCP servers are part of the shared state (every client sees name, command/URL and the *names*
of its secrets). The values are kept in `mcp-secrets.json` (mode 600) next to the state and are
never sent to any client. At launch each CLI gets the servers in its own form and the values
as environment variables of that agent: Claude Code `--mcp-config` with `${VAR}`, Codex
`-c mcp_servers.<id>.env_vars / env_http_headers`, OpenCode `OPENCODE_CONFIG_CONTENT` with
`{env:VAR}`. HTTP header values use `NEURALAGENT_MCP_<ID>_<HEADER>`. Nothing is written into
the CLIs' own config files, so removing a server here removes it everywhere and the user's own
settings stay untouched. Import copies servers from Claude Code and Codex once. There is no
server catalogue or store (by design).

## D25 — Usage comes from the CLIs' transcripts; cost is an API-price estimate

Token counts are read from the transcripts Claude Code and Codex already write (no proxy, no
API keys, works for conversations started outside NeuralAgent too). Claude repeats a message's
usage on every line of that message, so messages are counted once by id (also across a resumed
or forked conversation). Codex reports running totals; the difference to the previous report is
counted. Cost uses a fixed table of list prices (USD per million tokens, cache writes 1.25×/2×
input for the 5-minute/1-hour cache); a model id must match exactly or with a date suffix, so a
new model shows "no price" instead of an older model's price. Subscription users pay their plan,
the page says so. Limits: Codex writes them into its transcript; Claude Code gives them only to
its statusline command, so NeuralAgent sets its own statusline command for the agents it starts
(`--settings`), which records the limits and then runs the user's configured statusline with
the same input, so nothing visible changes for the user.

## D26 — Relay: one small Rust service, SQLite, opaque tokens

`crates/na-relay` (axum) does sign-in, accounts, admin, routing and serves the web files; one
container on .96 with a SQLite file in `/var/lib/neuralagent`. Access tokens are random strings
kept in memory for 15 minutes (a restart signs everyone in again silently via their refresh
token); refresh tokens rotate and only their hashes are stored. Using an old refresh token
again signs that device out (stolen-token signal). No JWT: nothing to verify offline, and
blocking/deleting must act at once — the relay drops the user's tokens and WebSockets
immediately. Routing only between devices of the same account, and only while the account is
approved and remote is on.

## D27 — Desktop sign-in via the daemon's loopback port

The desktop opens the system browser at the relay; the relay sends it back to
`http://127.0.0.1:<daemon port>/auth/callback` (RFC 8252 loopback redirect, PKCE). No custom
URL scheme is needed on the desktop (`neuralagent://auth` stays allowed for the Android app).
The daemon, not the window, holds the account: it keeps working while the window is closed.
Credentials (refresh token, device key) live in the OS keychain in release builds on macOS and
Windows, otherwise (dev builds, Linux) in `remote-credentials.json` readable only by the user.
They never enter the shared state.

## D28 — End-to-end encryption between phone and computer

Each device has an X25519 key registered with the relay. A session is a Noise-like handshake
(ephemeral + static keys on both sides, `na-crypto`, the same code in Rust and WebCrypto with
shared test vectors), then AES-256-GCM with strict counters. The computer only accepts a
handshake whose static key is the one the relay lists for that device, and the QR code carries
the computer's key fingerprint, so a phone paired by QR also detects a relay that swaps keys.
Honest limit: a phone added by signing in (not by QR) trusts the relay's key directory on first
use; the fingerprint is shown on both sides to compare.

## D29 — Remote clients are treated like phones, whatever they claim

The daemon serves relay sessions with the same client loop as local ones, but the client kind
comes from the relay's device record (Android → `android`, everything else → `web`), never
from the client's hello. Remote clients cannot change remote access (sign-in, pairing, revoke)
— except the emergency switch-off, which works from anywhere, including the tray.

## D30 — Admin: passkey as second factor, ES256 only, no attestation

`/admin` needs an admin account (from `ADMIN_EMAILS`, approved automatically) and a passkey.
The first passkey can be registered right after the first admin sign-in. Only ES256 keys
(every platform authenticator uses them); attestation is not checked, user verification is
required and the signature counter must not go backwards.

## D31 — Pull deployment from GHCR with health check and rollback

CI builds the relay image and pushes it to GHCR (only after the relay tests pass). On .96 a
systemd timer runs `update.sh` every 5 minutes: pull, start, wait for the container's health
check, otherwise go back to the previous image. No inbound deploy access, no secrets in CI
for the server. Until the read token is on .96, images are built on the server by hand.

## D32 — Web remote keys: IndexedDB CryptoKeys, bytes only as a fallback (2026-10-30)

The browser's device key is a non-extractable X25519 CryptoKey kept in IndexedDB, so script
can use it but never read it. WebKit in some modes stores nothing there; the store probes
once and then keeps the private key as bytes in localStorage, next to the refresh token that
already grants the same access. A private window without IndexedDB keeps the key only for
the tab. A computer's key is pinned at QR pairing; signed in without a QR it is trusted on
first use and refused if it changes later.

## D33 — One app, two navigations

The shared app gives AppShell both its hand-made desktop sidebar and a `nav` list; the shell
picks by its own width. Phones get Agents, the workspaces, then History/Usage/MCP/This device/
Settings under More. Terminals on phones get a key bar for keys a phone keyboard lacks.

## D34 — Push: minimum payload, only to devices nobody looks at (2026-10-30)

A computer tells the relay only `{kind, sid}` when an agent finishes, fails or waits; the relay
adds the computer id and pushes `{t:"attention", kind, host, sid}` — no names, no terminal
text. Devices write the text themselves (the web worker keeps agent names in its own cache).
Clients report `visible`; the relay skips devices that are connected and on screen. Web Push
endpoints must be a known push service (Apple, Google, Mozilla, Microsoft), the VAPID key lives
in the relay database unless set in env, and pushes are limited to 30 per account per minute.
Android uses FCM data messages so the app builds the notification and the tap opens the agent.
On iPhone, Web Push needs the PWA on the Home Screen (iOS 16.4+); the settings page says so.

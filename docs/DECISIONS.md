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
Credentials (refresh token, device key) live in the Windows Credential Manager in Windows
release builds, otherwise in `remote-credentials.json` readable only by the user (macOS: D43).
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

## D35 — Android: a Capacitor shell around the hosted web remote (2026-10-30)

The APK loads `https://agent.neuralhub.dev/app/` (`server.url`) instead of bundling the web
build, so phone and browser always run the same version and the relay deploy updates both;
`www/` is only an offline page. Native code adds what a page cannot: FCM (data messages, the app
writes the notification from names it keeps locally), a home-screen widget and a Quick Settings
tile fed by the page (`setStatus`), and sign-in in a Custom Tab that returns via
`neuralagent://auth` (Google blocks OAuth in WebViews). xterm.js mangles Android IME input, so
phones get an input line plus the key bar and the terminal itself takes no keyboard input; one
pane is shown at a time with chips to switch. Release builds are signed with a keystore kept
outside the repo (password in the macOS keychain, both as GitHub secrets for CI). Android stops
FCM delivery to a force-stopped app; that is platform policy, not something we can work around.

## D36 — Neural and its calls live in the daemon (2026-10-30)

**Where.** The orchestrator is a client of the daemon (`ClientKind::Orchestrator`, "Neural"), so
the same policy and audit log apply as for a phone. Its conversation is part of the synced state
(`orchestrator.messages`, last 60), so desktop, browser and phone see one chat. Calls run in the
daemon too: the phone or browser streams 16 kHz PCM16 (`call_audio`) and plays 24 kHz speech
(`call` events); STT, TTS and turn-taking never leave the computer. One call per computer; a new
one ends the old one.

**Pipeline.** Silero VAD (end of turn after 0.5 s of silence, sentences cut from a 40 s ring with
0.3 s lead-in) → Parakeet (150–600 ms) → the model, streamed; each finished sentence (or a first
clause after 24+ characters) → Supertonic → 200 ms audio chunks. If nothing is playing 80 ms
after the transcript, a cached acknowledgment ("Okay." / "Moment." / "Mhm, okay.", DE/EN) plays,
so the caller hears something in under a second while the model answers. Barge-in: the caller
talking for 300 ms over Neural flushes the client queue and stops the model. News about agents
(done / needs you / error) is spoken between answers, in the call's language.

**Model.** Calls use the separate call model (default `claude/claude-haiku-5-5`) with
`thinking: {type: "disabled"}`: through NeuralHub Haiku 5.5 otherwise thinks by default
(time to first token 2–3 s instead of ~1 s; `reasoning_effort` has no effect). Shorter history
in calls (a third), a spoken-style prompt (1–2 sentences, no ids, no opener because the
acknowledgment already plays) and a hint which language the last message was in (long German
histories otherwise pulled English questions into German answers).

**Keys.** BYOK per provider (NeuralHub, Anthropic, OpenAI-compatible, Ollama). Release builds on
Windows keep keys in the Credential Manager (`dev.neuralhub.neuralagent.keys`); macOS (since D80),
Linux and development builds in `<data>/keys.json` (0600). `NEURALAGENT_LLM_KEY` overrides for tests/CI.
Remote clients can use Neural but cannot set keys.

**Echo.** Clients ask for `echoCancellation`/`noiseSuppression`/`autoGainControl`. WebKit (Tauri
on macOS, iOS) and Android cancel all of the app's output; desktop Chrome's AEC is weaker for
Web Audio playback, so barge-in there may trigger on Neural's own voice at high volume — the
fix if it shows up is a higher barge-in threshold while playing.

**Android.** A "Call Neural" quick tile and a microphone foreground service (ongoing
notification with *Hang up*); during a call the activity shows over the lock screen and keeps
the screen on. Hanging up while the phone is locked sends the app back behind the lock.

## D37 — Swarm: teams talk through an MCP bridge in the daemon (2026-10-30)
A swarm is a goal plus 1–8 members (role + agent profile) in one workspace. Default team:
Coordinator (lead), Scout, Builder, Reviewer. The swarm gets its own grid tab with one pane per
member.

**Talking.** Every member gets one extra stdio MCP server, `neuralagent-swarm`
(`neuralagentd swarm-mcp`), with `send_message {to, text}`, `team` and `messages`. The bridge
forwards to `POST /swarm` on the daemon, authenticated with the member's session id and hook
token (passed as MCP env "secrets", so Claude, Codex and OpenCode forward them the same way).
Recipients: a role, `all`, or `you` (the user). Works for every engine that speaks MCP; no
engine-specific message format.

**Delivery.** Messages queue per recipient and are typed into its terminal (bracketed paste +
Enter) only when it is ready: status Done/Idle, and for engines with hooks only once the hooks
have reported a status, so nothing is typed into a trust or login dialog. Several queued
messages arrive as one prompt.

**Briefs.** Only the lead starts; the others wait silently for their first task. All are told
not to send acknowledgements, thanks or status pings — in real runs Haiku otherwise kept
acking each other after the goal was reached.

**Notifications.** A member finishing a turn is not news; "Done" attentions are suppressed for
swarm members. A message to `you` raises one Done attention with its first line. Errors and
permission prompts still notify.

**Lifecycle.** Stop kills all members (exited, not error); a swarm ends when every member has
exited; ended swarms take no messages and survive restarts as history (last 300 messages per
swarm). Remote clients (phone, Neural) may start and steer swarms only in approved workspaces.

**Not in scope** (PROMPT.md): agent-to-agent messages outside a swarm, tickets/kanban.

**StopFailure.** Claude also sends StopFailure for failed side requests (titles, suggestions)
while the turn goes on. A session is only marked as error when the transcript's last answer is
an API error (`isApiErrorMessage`).

## D38 — Themes per device; updates and releases through the relay (2026-10-30)

**Themes.** A theme is a colour scheme (`data-scheme`: ground, surfaces, ink, glass) plus an
accent (`data-accent`, from the design library). Six schemes, each with its own accent unless
one is picked. Stored per device in localStorage (a phone can stay black while the desktop is
graphite); other windows (voice HUD) follow through the storage event, xterm re-themes live.

**One version.** The Cargo workspace version is the app, service and relay version (Tauri reads
it from the crate); the APK uses the same string (`scripts/set-version.mjs`). A tag `v<version>`
starts `release.yml`.

**Release storage on the relay.** CI uploads each file with a bearer token
(`RELEASE_UPLOAD_TOKEN`, only in GitHub secrets and `relay.env`) to
`/api/releases/<v>/files/<name>`, then publishes `manifest.json`. Unpublished uploads are
invisible. The relay keeps the newest three published versions (the disk on .96 is small) and
drops stale uploads. Pre-releases (`-beta.1`) reach only clients already on a pre-release and
never the public download links.

**Desktop updates.** Tauri updater with our own minisign key (private key in GitHub secrets and
`~/.neuralagent-secrets`, password in the keychain), dynamic endpoint
`/api/update/{target}/{arch}/{current}` (204 when up to date). The app checks 15 s after start
and every 6 h and offers "Install" in a toast; Settings → Updates shows both versions. The
service runs from a versioned copy (`<data>/bin/neuralagentd-<v>`), so installing replaces the
app while agents keep running; the new app swaps the service only once no session is alive.
Not chosen: restarting the service with the app (kills agents), a separate update helper.

**Android.** The APK is a shell around the hosted web remote, so the UI is always current; the
page compares the APK's version with `/api/releases/latest` and offers the new APK (Custom Tab →
system installer). Same release keystore, version code `major·10⁶ + minor·10³ + patch`.

**No account, no traffic** except the update check and downloads (PROMPT.md).

**Signing.** macOS builds are not notarized and Windows builds not code-signed yet (needs an
Apple Developer ID / a certificate — the user's call); the download page explains the first
start. Updates are verified by the updater signature either way.

## D39 — Admin area without passkeys (2026-10-30)

The user found the passkey step annoying and asked for it to go. The admin area now needs only
a sign-in (Google/GitHub) with an address in `ADMIN_EMAILS`; the provider's own 2FA protects it.
WebAuthn code, the admin cookie and the `passkeys` table are gone (dropped on start).

## D40 — Design: liquid motion and glass background
The app gets a calm colour field (`AuroraField`: three drifting radial-gradient lights, transform-only, tinted per scheme and accent) behind the existing glass surfaces, and a jelly feel from fluid-goo's springs (`SPRING.goo`) on every moving indicator, menu hover lens, toasts, pages and button presses. fluid-goo (MIT) is not a dependency: only its spring constants and ideas were re-implemented in `packages/ui` to keep the NeuralHub base and the bundle small; no blur filters or canvases run continuously, so terminals stay smooth. The sidebar foot shows the signed-in account (photo, name, email) with a small menu. The whole top 40 px of the window drags on macOS. Details: `docs/notes/design-overhaul.md`.

## D41 — Claude view over the real CLI
The real `claude` CLI keeps running in its PTY. The daemon tails its transcript JSONL (path from the hook payload, so /clear, /resume and compaction follow) and streams structured `Cv` events; input, slash commands and keys go into the PTY. The UI (`components/claude/**`) shows bubbles, markdown, tool cards, native permission/question buttons, a composer with `/`, `@`, model, mode, context meter, images and dictation. Pane header toggles CLI vs Claude view (phone default: Claude view). Images upload to `<data>/uploads/<session>/` (12 MB, 7 days) and the host path is inserted. Details: `docs/notes/claude-view.md`.

## D42 — Host settings and updates from remotes (2026-10-30)

**Goal.** Everything about the host computer is reachable from any of the owner's devices (web
remote, Android, a desktop acting as remote): Neural and call voice, voice models, dictation and
wake word, app updates, workspaces. Settings are split into "This device" (theme, call audio) and
the host's own sections, labelled with the host's name.

**Where it lives.** Voice models moved from the Tauri app into `na_voice::download` and are
managed by the daemon (`host_models`, `host_model_download/delete`, progress as `host_notice`
events), so they work with the app closed and calls use them directly. The update check
(`host_update_check`) is also the daemon's: it asks the same `/api/update/...` endpoint
(`NEURALAGENT_UPDATE_URL` for tests). What only the app can do (dictation hotkey, wake word, learn
voice, install an update) stays in the app: it registers as "host UI" (`host_ui_register`) and the
daemon forwards `host_ui` requests to it as `host_call`, answered by `host_ui_reply`; with no app
the remote gets "the app is not open" and the UI says so. Not chosen: a second Tauri updater in
the daemon (needs the app bundle to replace itself), or a relay for host commands (the sealed
transport already carries requests).

**Permissions.** Remote kinds `web`/`android` may use these requests, edit settings and keys,
rename, approve and remove workspaces (the relay only admits the signed-in owner's approved
devices; every call is in the audit log). `host_notice` can only be sent by the desktop app; Neural
(orchestrator) may do none of it. Changing remote access itself stays desktop-only.
Remote folder browsing/creation stays inside the host's home folder.

**Update flow.** The remote shows a toast "NeuralAgent X is available on <host>" (once per
version, checked at start and every 6 h) and Settings -> Updates on <host>. Install tells the
host's app to download and restart; progress arrives as notices; the daemon and agents keep
running (D38). When the service version changes (hello after reconnect) the remote page reloads
itself; the web bundle and APK shell come fresh from the relay as before.

**Calls on phones.** Earpiece (quiet) is the default, speaker is a toggle in the call screen and
a setting under "This device". Android sets `MODE_IN_COMMUNICATION` and picks the communication
device (API 31+) or `setSpeakerphoneOn`; a headset always wins; the proximity sensor blanks the
screen at the ear. The choice is stored natively, so the quick tile and the notification start
calls the same way. Browsers only get it where `setSinkId` lists an earpiece output.

## D43 — Remote credentials on macOS in a user-only file; the relay loop supervises itself (2026-10-30)

0.2.0 lost remote access right after every start. Two causes: reqwest and ureq compile in
different rustls backends, so rustls could not pick one and the `wss://` connect panicked inside
the relay task (silently: the daemon's stderr goes nowhere, the status stayed "online"). And the
keychain ties an item to the exact binary; every update is a new unsigned binary, so the first
start of 0.2.0 waited 25 minutes on a keychain prompt before it even listened.

Now the daemon installs the aws-lc-rs provider at start (test `tls_backend_is_chosen`), logs
panics to `daemon.log`, and restarts the relay loop when it crashes (status "offline" meanwhile).
On macOS the credentials move from the keychain to `remote-credentials.json` (0600) once, off the
startup path. LLM keys stay in the keychain: they are read only when used. In the relay loop
nothing waits on a session any more (`try_send`; a session that cannot keep up is closed) and
every send to the relay has a timeout.

## D44 — One CHANGELOG.md feeds release notes, website and the update dialog (2026-10-30)
`CHANGELOG.md` (Keep a Changelog; groups New / Improved / Fixed, user words) is the only source
of release notes. `scripts/changelog.mjs` parses it. `set-version` cuts `[Unreleased]` into the
version and refuses without notes. CI checks the section, and `release-publish` sends it as the
manifest notes. The web build emits `/changelog.json` and `/version.json` (CORS `*`) and renders
`/changelog`. The desktop app fetches `<relay>/changelog.json` from the webview (CSP allows the
relay) instead of a Rust HTTPS client, which would risk the rustls dual-backend panic of D43.
Update checks: 4 s after start, on focus (≥ 60 s apart) and every 5 min while visible. The update
endpoints are cached for 60 s. The desktop dialog opens by itself once per version. Web remotes
compare the build id baked into the bundle with `/version.json` (static files are `no-cache`,
hashed assets immutable) and offer a reload. Code: `packages/app/src/lib/updates.ts`,
`UpdateBadge` / `UpdateDialog` / `UpdateSettings`. A failed daemon switch is no longer retried
blindly: it shows Retry.

## D45 — iOS-grade design foundation: modes, appearance, phone navigation, activity marks (2026-10-30)
`packages/ui` is rebuilt as the base for all screens; the guide is `docs/notes/design-system.md`.
Sizes follow the shell's own `data-mode` (phone/desktop), not the viewport. On phones that means
iOS type roles (large title 34, body 17/16, inputs 16 px against zoom), 44 px tap targets, 50/62 px
rows and 22–25 px icons. Every scheme has light and dark, chosen by an Appearance setting
(System/Light/Dark) through `data-appearance`, with translucency via `--fg-rgb`. Safe areas have a
single source (`--safe-*` = max(env, Capacitor var)). Phone IA is five tabs (Neural · Agents ·
Workspaces · Swarm · More) with push/pop navigation, large-title pages, a back button from context
and swipe-back. Each tab keeps its stack. Overriding DESIGN-CONTRACT: on phones a `Menu` becomes an
action sheet (pull-downs overflowed inside sheets). Sheets stay under the status bar and above the
keyboard for any portal target. Agent state on nav items is structured (`activity`): a running
light ring for working, an accent pulse for waiting, ember only for "finished, not seen", red for
error. Launch motion is ≤1.2 s and never blocks.

## D46 — Quiet agent tiles; one app-wide Chat/Terminal switch for Claude (2026-10-30)
Agent and engine icons use one quiet tile (`EngineTile`/`QuietTile`: the library's list-row tile,
`bg-fill-3` with the glyph in ink, brighter when selected) instead of a system colour per engine.
The coloured tiles read as decoration and competed with the status colours; now colour means
status only (activity ring/dots, D45). Coloured `IconTile`s stay for settings-like rows outside
the agent surfaces. The Chat/Terminal choice for Claude was already one app-wide preference, but
its switch sat in each pane header and showed only on the focused pane, so it looked per-pane.
It is now one `ClaudeViewSwitch` in the workspace bar (desktop, labelled "Claude") and at the end
of the agent strip (phones, icons only), shown only while a Claude agent is in view. Rejected: a
per-pane preference (more state, and the owner asked for one global switch). Defaults unchanged:
terminal on desktop, chat on phones.

## D47 — Quiet settings rows; Remote access and MCP servers inside Settings (2026-10-30)
Settings, the More page and Settings sub-pages use the design library's quiet row tile (glyph in
ink on `fill-3`) instead of iOS system-colour tiles; the owner found the coloured tiles noisy
("AI slop"). Colour stays for status (activity marks, a green dot for an online device, accent
for an available update). Remote access and MCP servers moved from top-level sidebar/More entries
into Settings (groups: Appearance · Neural and voice · Agents and tools · Connections · Updates,
Advanced, About); old route ids `__remote`/`__mcp` redirect to their section
(`lib/settingsRoute.ts`), and ⌘K reaches them directly. The account avatar opens Settings with
one click (no menu; sign-out lives in Remote access). The version/Update control moved out of the
account block to just above it (`Sidebar` `above` slot): a square update button in the rail that
widens into an "Update" pill on the sidebar's spring when it opens. Rejected: no icons at all
(rows get harder to scan) and keeping coloured tiles in a lighter tint (still decoration).

## D48 — Swarm desktop: master–detail in a page header; quiet members; new swarm as a dialog (2026-10-30)
The desktop Swarm view reused the phone list as a 384 px `Page` column, so its title rendered at
phone size with "New swarm" floating above it, and the detail had an empty top bar while goal and
team scrolled away with the conversation. Now the page has the shared desktop header (eyebrow,
display title, action at the right, width 1200, `--sidebar-space`), the list in a 320 px column and
the open swarm in one `card`: a fixed header (goal clamped to two lines, status, workspace, started +
running time, Terminals and Stop/Remove as visible buttons instead of a "…" menu), the feed with
the composer pinned under it, and the team as a rail on the right (`@3xl` of the card; a sideways
chip row when narrower). Members are quiet (D46): the agent's `EngineTile` with the activity mark,
role, "status · agent"; senders in the feed are initials on `fill-3`. The per-member rainbow
(`MEMBER_COLORS`) is gone: colour means status only, plus the accent for messages to you and your
own bubbles. The feed groups runs of one sender to one recipient (`lib/swarmFeed.ts`, tested).
New swarm uses `Sheet desktop="dialog"`: it is a form you fill in once, so a centred, modal
dialog with Cancel/Start reads better than a side panel over a busy conversation. Phones keep the
list → pushed detail; the goal is the inline title so it stays visible at the end of the feed.
Rejected: a colour per member in a softer tint (still decoration), and the team as a second
scrolling row above the feed on wide windows (costs the feed height on 800 px laptops).

## D49 — One launch frame and one launch motion on every surface (2026-10-30)
Opening the app showed different screens one after another: on Android a large native splash, a
black WebView, "NeuralAgent · Connecting…" with a spinner and then the small mark assembling; in
the web remote a spinner, sometimes an empty computer list or "offline", then the mark; on the
desktop a white or black window before the app. Now one element (`#na-launch`, markup in
`lib/launchFrame.ts`, injected into every entry page by a Vite plugin before any script) shows the
mark at 64 px on the ground colour from the first paint; the theme script before it sets
appearance/scheme/accent from localStorage. The Android splash (core-splashscreen, light/dark
vectors at the same size, theme switched on Android 13+ from the app's appearance) and the Tauri
window colour draw the same frame, and the native splash leaves only once the page has painted it.
`lib/launch.ts` then plays one motion (lights and bloom fade in, the panes pulse once, ≥640 ms)
and dissolves into the app when it is ready. Screens render nothing while the launch screen is up
and not late; only after 7 s (`GRACE_MS`) does a calm note under the mark say what is wrong, with
Try again. Signed-out users go straight to sign-in. Constraints learned: no inline `<style>` or
`style=` (Tauri's CSP nonce would disable `unsafe-inline` for the page), the mark's panes are HTML
elements (SVG child animations run on the main thread and stuttered or tore on Android while the
bundle started), one fading layer with only a transform inside (nested opacity animations
composited wrongly), and the Android activity theme is DayNight so the WebView's
`prefers-color-scheme` follows the phone. Rejected: keeping the native splash until React is ready
(no motion, and a blank gap if the page is slow) and a progress spinner.

## D50 — Claude view images by reference, bytes on demand (2026-10-30)
Transcript images (a `Read` of a picture, MCP screenshots, pasted images) are base64 in the
JSONL, often hundreds of KB each. `cv_attach`/`cv_history`/live upserts carry only a `CvImage`
reference (`<line offset>-<n>-<base64 length>`, type, byte size, pixel size read from the header);
`cv_image {sid, id, max?}` reads that one line again and returns the bytes. The id needs no
server state, survives daemon restarts, and the length check refuses a different transcript at
the same path. Remote clients (`platform.kind` ≠ desktop) ask for `max` 1600 px: the daemon
(`image` crate, png+jpeg only) scales and re-encodes as JPEG (PNG when transparent) and caps an
answer at 6 MB decoded, under the 16 MB relay frame. The client loads a thumbnail only near the
viewport and caches object URLs (LRU 60). Alternatives: inline base64 (megabytes per history
page over the relay), client-side downscaling (still transfers the full bytes), a temp-file cache
on the host (state to clean up). The full-screen viewer is a custom overlay, like the Picker.


## D51 — Public repository: forks and pull requests, release secrets in an environment (2026-10-30)
The repository is public under the AGPL-3.0 (copies that are changed and shared or run as a
service stay open). Outside contributors fork and open pull requests; trusted helpers may be
invited as collaborators and push branches here. Rulesets: `main` takes changes only through a
pull request with the code owner's approval (`.github/CODEOWNERS`), no force push or deletion;
`v*` tags can be created only by the owner. The owner (repository admin) is on the bypass list,
so the owner's agents keep pushing to `main` directly. All signing keys and the upload token
live in the `release` environment, usable only from `v*` tags and `main`: a branch or pull
request (even from a collaborator who edits a workflow) never sees them, and CI builds the
Android APK unsigned. An official tag without the macOS certificate now fails instead of
silently shipping an ad hoc build (users would lose their permissions). Workflows of outside
contributors need the owner's approval before they run. Note: a merge to `main` that touches
the relay or the website goes live on the server within minutes (`relay-image.yml` +
`deploy/relay/update.sh`), so review relay changes like a deploy. Alternatives: a private repo
with a public mirror (PRs ported by hand), a separate private release repo (more moving parts),
keeping the relay closed (open core; possible later).

## D52 — Phone: four tabs, a hash router, and the phone never writes layout_set (2026-10-31)
Tabs are Agents (inbox), Neural, Projects, Settings; "More" and "Swarm" are gone (their content
lives in Settings and under Agents). Navigation is state `{tab, stack[]}` with one stack per tab,
mirrored to the URL hash (`#/agent/<sid>`, `#/projects/<id>`, ...) with real history entries
(`lib/phoneRoute.ts`): a tab switch replaces the entry, a push adds one, open overlays close first
on back, and moves made before the router starts (a notification tap on cold start) are queued.
Opening an agent on a phone goes through `phoneRouter().openAgent(sid)`; only
`openAgentOnDesktop` writes `layout_set`, so using the phone never moves the computer's panes.
Alternatives: keeping More as a grid tab (hides Settings, two taps to anything), in-memory
navigation without URLs (Android and browser back break, no deep links from notifications),
letting the phone drive the layout (surprises someone sitting at the computer).

## D53 — Agent screen: Island plus composer, Dock hidden, nothing covers content (2026-10-31)
An agent on a phone is a full screen with no tab bar. Chrome is one floating glass capsule (the
Island: back with a needs-you dot, agent mark, two-line title, context ring) and the composer.
The Island shrinks while scrolling down, hides while the keyboard is open, opens into a panel
(project, agents of the project, Chat/Terminal, session actions) and swipes to the next agent.
The transcript ends above the composer (normal flow, not an overlay), the "N new" pill sits in
its own band, prompts replace the composer as a docked card (at most 45%), and the top fade is a
CSS mask only. A subagent borrows the Island's title and back (`islandOverride.ts`). Alternatives:
a second header row plus chip strip (eats height), a floating composer over text (hides lines),
a blur or gradient fade (costly on Android WebView).

## D54 — Transcript: entries and step rows, stick-to-bottom by intent (2026-10-31)
`entries.ts` turns messages into entries: all tool steps between two texts merge into one step
row; edits, images, subagents, todos, plans, questions and errors stay visible; empty thinking is
dropped; system noise becomes notices, never user bubbles. A tool result pairs with its call even
when a hook line sits between. Scrolling follows the end only while pinned; unpinning is
intent-based (wheel, touch, keys) plus a jump rule (a non-user scroll of more than 48 px away from
the end), which covers the iOS status-bar tap. Older history is prepended with an anchor on the
`[data-entry]` element. Entries keep identity through a WeakMap cache and are memoised.
Alternatives: showing every tool call (long, noisy on a phone), pinning by distance only (yanks
the view when the user reads), virtual lists (anchoring and selection problems).

## D55 — Subagents and tasks protocol (2026-10-31)
The daemon keeps one task registry (tool calls, results, task notifications, statusline, hooks, a
scan of the subagent files) and sends `tasks` events only to clients that attach with
`features: ["tasks"]`, so old web remotes keep working. A subagent's own transcript is attached
with `attachCv(sid, sink, {agent})`; its history and images take the same `agent`, streams are
keyed by (sid, agent), and it is read-only. Subagent events do not change the session status.
`cv_task_output` and `cv_file` read only regular files under `~/.claude/{projects,plans,tasks}`,
`<tmp>/claude-*` or project Markdown. `CvMeta.actions` tells the app that `cv_action` is live.
Alternatives: pushing tasks to everyone (breaks old clients), reading arbitrary paths for the
plan view (a file-read hole), a second connection per subagent.

## D56 — cv_action in the daemon, with guards (2026-10-31)
Phone controls (interrupt, mode, model, effort, fast, background, stop agents, send queued now,
answer, answer question, `!` shell, rewind) are key plans played by the daemon, which reads the
screen before each step. Guards: every action except interrupt, stop agents and answers is
refused while a dialog is open (Enter would approve it); `answer` carries the prompt's
fingerprint (`CvPrompt.id` as `prompt_id`) and is refused when a newer prompt replaced it; an
empty answer is refused; one tokio mutex per session serialises actions; the tail runs on its own
thread. `cv_action` is audited. Alternatives: the client typing keys (timing guesses, no screen
check, races across devices), trusting the cached prompt (answers land on the wrong question).

## D57 — Design language "Two Drops" on phones (2026-10-31)
A calm flat phone background (no Aurora, no page glows, `Glow` renders nothing), at most two glass
layers on screen, lighter glass on Android, light-weight (300) large titles, small mono section
labels, colour only for status and selection. Assistant prose has no bubble; the user message is a
soft bubble on the right. `dim` and `faint` text and the tone colours on light were retuned so
they meet WCAG AA in every scheme. Removed: the gradient orb avatar, cards inside cards, orange
dot noise, the centred greeting. Motion stays transform and opacity with the existing springs.
Alternatives: keeping the ground gradient on phones (costly, noisy behind text), a heavier glass
look (jank on mid-range Android).

## D58 — One permission for remote work, and background code stays out of protected folders (2026-10-31)
Remote work must never wait for a macOS dialog on the computer's screen. We ask for **Full Disk
Access** once, for the app (the stable bundle identity, so updates keep it), instead of the
per-folder prompts (Documents, Desktop, Downloads, iCloud, volumes) that appear one by one when an
agent first touches a folder. Settings → System shows every permission live (read without
prompting), opens the right pane, walks through the missing ones, repairs a stale entry
(`tccutil reset` for our bundle id only) and tells the phone what is missing. Background code
(the git refresh) skips protected folders without Full Disk Access unless an agent works there,
so the service never causes a prompt on its own. Alternatives: per-folder grants (several
dialogs, each can surprise a remote user), a privileged helper (needs Apple Developer ID and
notarization), or asking at install time (macOS has no API to request Full Disk Access; the user
must switch it on).

## D59 — A host process keeps the service running and makes it "NeuralAgent" to macOS (2026-10-31)
The service outlives the app, so after the first app restart macOS charged it and every agent to
the bare service binary — a new TCC identity per version, hence prompts after every update. The
app now starts `neuralagent --service` (its own signed executable, no window), disclaimed with
`responsibility_spawnattrs_setdisclaim`, which starts the service, restarts it after a crash
(backoff), `exec`s the newest app on `host.restart` (remote "Restart the service"), idles on
`host.stop` and is what launchd runs for autostart. Markers in the data dir instead of IPC: they
survive the service's exit, which is exactly when the host reads them. Alternatives: let the app
supervise (dies with the app), launchd only (no app-mode restart, no update hand-off), SMAppService
(needs a Developer ID to be dependable and cannot be tested without touching the real system),
or signing the service binary like the app (TCC still sees a separate identity per path).

## D60 — Autostart: off, at login, at boot, chosen per computer (2026-10-31)
"At login" uses per-user mechanisms without a password (LaunchAgent, HKCU Run, systemd user unit).
"At boot" needs one administrator prompt (LaunchDaemon with `UserName`, a Task Scheduler S4U task,
systemd linger) and is honest about what does not work before login: locked keychain on macOS
(Claude Code's login, Neural keys), no microphone, FileVault waits for the password, no
Windows credentials. The boot service hands over to the login service once the user is logged in
and no agent runs. Switching off removes entries but never stops a running service; every
generated file is tested (plutil, plans per OS, a re-rooted dry run). Alternative: always install
at boot (a password prompt and caveats for people who only want "at login").

## D61 — Neural's context: instructions, a fresh world, and the conversation only (2026-10-31)
Every model step gets three things: static instructions (the same every turn, cached), a
`<world>` block rendered fresh from the state (`neural::world`: tasks, agents with status and
open prompt, "new since your last turn", confirmations, memory, summary, workspaces), and the
conversation with the user only (`neural::history`). Agent events no longer enter the chat as
notices or `[log]` user messages: they are `State.neural.observations` and show in the world
block once, then move to "earlier". What Neural did in a turn is one "(did: …)" line in its own
answer. Past 30 turns the older ones are compacted into `neural.summary` by a quick model call.
Alternatives: keep notices in the history and trim harder (the clutter the owner complained
about), a vector memory (opaque, hard to edit), sending the full state as JSON (large, noisy).

## D62 — Teams replace Swarm: Neural runs the team (2026-10-31)
A team is a Neural task with `team` set. Two patterns: **race** (2–4 agents, often different
engines, try the same goal in separate worktrees; Neural measures each attempt: changed files,
lines, the check command; the user picks one, which merges it and discards the others) and
**build + review** (a builder, then a reviewer that ends with `VERDICT: APPROVED` or
`VERDICT: CHANGES`; changes go back to the builder, up to 3 rounds). The model may start a team
(`start_team`) and the Teams page can (`neural_team_start`). The classic swarm (four roles
messaging each other through a bus) stays readable and stoppable for old clients and old data,
but nothing starts new ones, and Neural lost its `start_swarm` tool. Alternatives: keep Swarm as
a separate feature (unused, the owner never tried it), let Neural chat inside a swarm (still the
role-play noise, no measurable result).

## D63 — Neural reports on its own, rarely and with a reason (2026-10-31)
The observer (`neural::watch`) turns attention events, exits and stuck agents (no visible
change for 15 min) into observations. Only observations about agents Neural tracks in a task
wake it, and only kinds that matter (done, waiting, error, check failed, team; stuck only in
mode Active). The pulse batches them (8 s), keeps 45 s between wakes, at most 12 per hour, and
never interrupts a user turn. A wake is a turn of at most 4 steps; the model answers `(quiet)`
when nothing is worth saying, otherwise its message is posted with `proactive: true` (styled as
"On its own"). Modes: Active, Quiet, Off. Phone pushes stay the existing attention pushes; Neural
adds one only for a stuck agent of its own or a confirmation it waits for. A guard
(`neural::guard`) holds destructive prompts, unsafe check commands and risky answers as
`neural.pending` until the user allows them (audit `neural_allow` / `neural_deny`); safe
permission prompts of Neural's own agents (read-only tools, test/build commands) are allowed
directly and logged. "While you were away" is computed in the client from the state, no model
call; "Catch me up" asks Neural. Alternatives: speak on every event (spam), a fixed timer
digest (late for failures, noise when nothing happened).

## D64 — Neural's state travels as a host notice (2026-10-31)
`State.neural` is optional in TypeScript and live updates are `host_notice { topic: "neural",
data }`: the client's `apply` has no default case, so a new event type would break old phone
builds, which ignore host notices. Clients may not send that topic. `OrchMessage.proactive` is
optional (old builds show such messages as normal answers). New requests `neural_*` are gated
with the daemon feature "neural". The daemon keeps the state in `neural.json` (not
`state.json`); pending confirmations do not survive a restart. Alternative: new events per
change (smaller, but breaks old clients).

## D65 — One model and one look for subagents and background work (2026-10-31)
Subagent cards, the running-work strip above the composer, the Tasks sheet and the subagent
view share one pure model (`claude/work.ts`: status, title, detail line, summary, tree) and one
set of rows (`WorkRow.tsx`). The strip is a pill ("3 agents running · 1 shell") that unfolds into
the list; finished items stay 45 s after this client saw them end, then leave. Nested agents sit
under their parent; 4+ agents of one parent started within 2.5 s fold into one group (workflow
and ultracode fan-outs). A running card is always a button: before the daemon knows the agent's
id it opens by its tool call and attaches once the id arrives. Overlays hand their history entry
to the subagent view in the same step, so Back always pops one level. The composer's tasks badge
is gone (the strip replaces it; `/tasks` still opens the sheet). Alternatives: a tasks badge
in the composer (one more control, no detail), a separate list per surface (they drifted apart),
subagents as phone routes (the router mounts one page; the subagent belongs to its conversation).
One background agent or shell stops from its row: `CvAction::StopTask { id }` (feature
`cv_stop_task`), played by the daemon through the `/tasks` dialog with a screen check before `x`;
on any doubt it closes the dialog and stops nothing.

## D66 — The daemon reads subagent metadata for nesting and finish (2026-10-31)
`cv_tasks::scan` reads each `agent-<id>.meta.json` (`parentAgentId`, `spawnDepth`,
`requestShape`, `finished`, `stoppedByUser`, `toolUseId`) besides the transcript: children link
to their parent (`CvTask.parent`), nested background agents end when their meta says so (they
get no task notification), and tokens come from the last assistant usage. New optional
`CvTask.active` (last transcript write) shows a quiet agent. An agent "waiting on its own
background work" (interim notification) stays running; a finished agent whose transcript gets a
newer entry (by timestamp, not mtime) runs again. `cv_attach { agent }` is accepted
once the meta file exists, so a just-started agent opens at once. Scan cap 80 → 400 files,
newest first. Alternatives: hooks only (no parent id in `SubagentStart`, no finish for nested
agents), watching the folder with notify (one more watcher per session for little gain).

## D67 — Files: where the explorer may look, and who may change that (2026-10-31)
A file browser on desktop (a pane kind `files`, kept in the layout) and phones (router pages
`#/files/<ws>/…`, `#/file/<ws>/…`), served by new requests `file_list`, `file_read`, `file_save`,
`file_upload` and `file_search` (`crates/na-daemon/src/files.rs`, `docs/notes/files.md`). Every
path is checked twice: lexically (no `..` out of a root) and after `canonicalize` (symlinks must
land inside a root too). Roots: the desktop gets every workspace and the home folder; phones and
browsers only approved workspaces, plus the home folder read-only when
`Settings.remote_files_home` is on; Neural (orchestrator) gets none, its agents have the
terminal. That switch can only be changed from the computer (the daemon keeps the old value when
a remote `settings_set` carries it). That keeps the home folder's default narrow, but it is not a
security boundary against a paired device: a paired phone or browser is trusted by design (D42) and
can add any folder as an approved workspace (`workspace_add`) and start a shell there, which reaches
further than the explorer. A lost phone is handled by revoking it (Settings → Remote access), not
by this switch. Listings never look inside child folders and mark Desktop, Documents, Downloads,
Library and media folders `protected`. Without Full Disk Access, folders macOS guards are never
opened for remotes or in the background at all (`permissions::Gate`, see
`docs/notes/system-integration.md`), so no TCC prompt appears unasked.
Reads come in 512 KiB pieces (max 1 MiB) so they fit relay frames; uploads the same way, into a
`.part` file renamed at the end, never overwriting (numbered name). Saves carry the mtime they were
based on; a newer file on disk is a `conflict` and the user decides. Remote reads (first piece)
and writes go to `audit.jsonl`; listing and search do not. Alternatives: reuse `fs_list` (stats
`<child>/.git` everywhere, home-wide for phones), whole-file reads (break the 16 MiB frame and
phone memory), a read-only remote (the owner asked to edit and upload from the phone).

## D68 — Files: one viewer, features gate, hand-offs (2026-10-31)
The viewer picks by extension and content: code and text with line numbers and a small built-in
highlighter (no new dependency, about 20 languages, 400-line blocks with `content-visibility`),
Markdown rendered with the Claude view's renderer (source a tap away), images, audio, video and
PDFs (inline only on the desktop; Android web views cannot), anything else as a card. Text over
512 KiB opens with its first part and "Load all" up to 4 MiB; bigger files are download only.
Files on another device leave as a blob download (web) or the Android share sheet (new native
`shareFile`, needs the next APK); the desktop opens them in their own app or shows them in Finder
(opener plugin). The UI offers Files only when the daemon lists `"files"` in `HelloOk.features`,
because an unknown request closed relay sessions on older daemons. "Send to agent" types the
path into a Claude chat composer (window event) or the terminal. Alternatives: Shiki/Prism
(heavy, async, extra bundle), a probe request (kills old relay sessions), sending file contents
to the agent (paths are enough; the agent can read them).

## D69 — Call models warm up lazily, load in parallel, and newer requests are gated (2026-10-31)
The speech models for calls (about 1 GB) load on `call_start` or on `call_warm`, which the Neural
page sends when it opens, after a reconnect and when it comes back to the front; they are freed
`KEEP_LOADED` (5 min) after the last call or warm-up (`crates/na-daemon/src/call.rs`,
`docs/notes/calls.md`). Nothing loads at daemon start or on connect, and no timer re-warms. STT
and TTS load in parallel, the acknowledgments follow in the background, and the engines lock is
never held during a load. A cold call start went from 3.2–4.8 s to 1.2 s, and to 5–55 ms with
the warm-up. `HelloOk.features` lists newer requests (`na_protocol::DAEMON_FEATURES`); clients
send them only when listed, and a remote message the daemon cannot parse is skipped instead of
closing the session. Alternatives: keep the models loaded all the time (1 GB for an idle
computer), or load them at connect (every phone glance would cost 1 GB for 5 minutes).

## D70 — The call screen says what the line really does (2026-10-31)
"Connecting…" until the microphone is open and the computer listens, then the timer;
"Reconnecting…" while the connection is gone (the client re-sends `call_start`, and the call
resumes); the call ends with a reason after 15 s without an answer or 45 s offline. Microphone
failures get words the caller can act on (`packages/app/src/lib/callState.ts`). Android sets the
call audio mode at the tap, takes transient audio focus that lets other apps duck
(`AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK`, `USAGE_ASSISTANT`), starts the microphone foreground
service only with the permission granted, and never restores the WebView's own communication
mode after a call. Alternative: a voice-communication focus (the system may mute media for a
"call" instead of ducking it).

## D71 — Settings: every section is a page, nothing slides in (2026-10-31)
Agents and Profiles were one side sheet (`AgentCatalog`) that Settings opened like an action; the
MCP editor was a sheet too. They are now Settings sections and detail pages with the same
navigation everywhere: phones push `#/settings/<section>[/<detail>]`, desktop shows them in the
right column with a back button (Escape goes back). `SettingsNav` gained `back()`, and a section
can rebuild a detail from its key (`detail(key)`) so a reload keeps the profile editor open.
`useCatalogSheet().setOpen(true)` keeps working for every caller: it now redirects to Settings →
Agents (phones push the page in the current tab, so back returns to where you were) and installs
run in the workspace you came from. Groups are the same on all surfaces: [Appearance,
Notifications] · Neural and voice · Agents and tools [Agents, Profiles, MCP servers, Workspaces] ·
Computer [Remote access (desktop), System, Discord, Advanced] · [Updates, About]; remotes put
"This device" first. A search field filters sections by name, keywords and group.
Confirmations (`ConfirmSheet`) stay sheets: they are a question, not a place.
Alternatives: keeping sheets on phones only (two mental models), a modal dialog on desktop (hides
the list you came from), moving the catalog out of Settings (it is configuration, not a task).

## D72 — Discord presence: presets, a card you compose, a real preview (2026-10-31)
`discord_presence` stays the privacy preset (Off, General, Detailed) and gains `stats` (numbers,
never a name) and `custom`, which uses the new `Settings.discord: DiscordOptions`: a stat for each
text line and the image tooltip (`DiscordStat`: activity, agents, subagents, project, model,
engine, tokens this session/today, cost today, agent time today, streak, files changed, none),
plus party size, timer, button and `project_names` (off by default: "In a project"). Changing any
part in Settings starts from what shows and switches to Custom, so a preset never changes behind
your back. The daemon computes the card (`discord::card`) from the state, usage rows of today,
agent time per day and the running subagents the Claude view saw; a stat with nothing to say is
left out (the first line falls back to the activity). Updates go out at most every 15 s
(clearing at once); the thread stays connected while presence is on, so Settings can say whether
Discord is open. `discord_preview` returns the card for the saved (or given) settings, what was
last sent and when the next update may go; with no agent running it returns an example with two
made-up agents (`sample: true`). The preview in Settings draws a Discord profile with the app's
tokens from that answer, so it is exactly what Discord gets. Old daemons have no `discord` field:
the panel then shows the three old presets and no preview.
Alternatives: a fixed set of toggles (cannot pick what the lines say), computing the card in the
UI (would drift from what the daemon sends), sending every change at once (Discord rate limit).

## D73 — Lowering other audio while the user talks (2026-10-31)
While the dictation hotkey is held, after "Hey Neural" and during a call in the desktop app, other
audio fades to a level (default 20 %) and fades back 0.8 s after the user is done
(`apps/desktop/src-tauri/src/duck.rs`, `docs/notes/ducking.md`). macOS has no API to duck other
apps, so: dictation and wake word lower the system output volume (no prompt, this app is silent
then); calls lower only Music and Spotify through Apple Events, and only after the user pressed
Allow in Settings on the Mac (permission checked silently before every use, players never
launched, no prompt from remotes). Windows lowers every other process's WASAPI session, Linux
every other `pactl` stream; both skip this app's process tree so Neural's voice stays loud.
Originals go to `<data>/duck.json` first and are restored on the next start after a crash and on
exit; a volume the user changes while lowered is left as they set it. Alternatives: the system
volume in calls too (Neural gets quieter with the music; gain make-up clips), Core Audio process
taps (per-app incl. browsers, but a "record system audio" prompt and all system sound through our
process), voice-processing I/O ducking (also ducks the web view's own call audio, 4 fixed levels).

## D74 — Speech models load on demand and leave after five idle minutes, one Parakeet per daemon (2026-10-31)
The desktop app's dictation/wake-word model (Parakeet, about 0.6-1 GB plus up to 0.5 GB of ONNX
arena after long utterances) was loaded on first use and kept for good; that was the "1.3 GB"
in Activity Monitor. It now unloads after `STT_KEEP` (5 min) without dictation, a wake word or a
recording (`apps/desktop/src-tauri/src/voice.rs`, `unload_idle`, checked every 15 s, never
while busy) and is warmed again on the hotkey press and right after "Hey Neural", so the
command after the wake word is not slower. The wake-word detector itself stays loaded (small).
In the daemon, calls (D69/D78 keep-alive unchanged) and Claude-view dictation get Parakeet from
`crates/na-daemon/src/speech.rs`: while either holds it the other reuses the same instance
(weak reference, no keep-alive of its own), instead of a second 1 GB copy. Alternatives: keep
the model (the owner's complaint), unload at once (each dictation would pay the 1-2 s load),
dictation through the daemon (one model per Mac, but a protocol change; open point).

## D75 — Freed memory goes back to macOS at once; the service host runs as Interactive (2026-10-31)
macOS libmalloc keeps freed large blocks and fragmented small regions dirty, so after a model
unload the process still showed 130-400 MB. `MallocSpaceEfficient=1` (read once at process
start) returns them at once (measured: daemon with Parakeet 594 vs 1155 MB, after unload
25 vs 127-399 MB; no measurable latency or CPU change). The host sets it when it starts the
daemon (`daemon::lean`, `apps/desktop/src-tauri/src/daemon.rs`, `service.rs`), the app gets it
from `LSEnvironment` in `Info.plist` (Finder, Dock, `open`, login items), and the daemon removes
it from its environment first thing in `main` (`speech::forget_malloc_env`) so agents, shells
and tools it starts run exactly as before. The login and boot host jobs get
`ProcessType Interactive` (`autostart.rs`), so launchd does not apply its background CPU/IO
limits to the service and its agents. Alternatives: `malloc_zone_pressure_relief` (released
nothing in a test on this macOS), a different allocator (mimalloc/jemalloc: a bigger change for
the same effect), leaving the variable for agents too (would change their behaviour).

## D77 — Neural's guard: prose vs commands, confirmations bound to what you saw, a wake cap per task (2026-10-31)
Review of Neural v2 (D61–D64). The guard is a heuristic, so it is tuned for both directions:
- **Commands** (`run_check`, an agent's permission prompt) are read strictly: quotes, `\`, `;`,
  `&`, newlines and `$(…)`/`${…}` cannot hide a second command; `git push` counts as forced with
  `-f`/`--force*`/`+ref`/`--mirror`/`--delete` anywhere after `push`; allow-listed read tools lose
  the options that write or run things (`sort -o`, `rg --pre`, `git diff --output`, `git branch x`,
  `git remote remove`, `tail -f`).
- **Prompts** to agents are prose: a rule the prompt itself states as forbidden ("no force push",
  "keine git-Operationen wie reset") does not trigger a confirmation (negation in the same clause,
  six words back; "don't hesitate to…" is no negation). Without this the careful prompts the system
  prompt asks for stopped every start (seen with a real model).
- **Allow runs once and only on what you saw**: an `answer_agent` confirmation stores the prompt's id
  and description; if the agent shows another prompt by then, nothing is answered. "Yes, and don't
  ask again" (and any lasting option) needs the user unless the call is a safe check; auto-allow
  only ever presses a one-time yes. Neural (as a client) cannot send `neural_confirm`,
  `neural_mode` or `neural_team_pick`.
- **No follow-up loops**: at most 6 wake-ups per task until the user writes again; a team
  agent's turn does not wake Neural (the team's own steps report), but a team result always does,
  also when it closed the task. Failed wake-ups (no key, 429, timeout) are one row in "What Neural
  noticed"; the model call has a 90 s answer and 120 s stall timeout.
- **Bounded `<world>`**: at most 12 open tasks (newest first, the rest counted), waiting agents and
  Neural's own agents listed before others, history messages clipped to 6000 characters.

## D78 — Warm-ups alone keep the call models at most 15 minutes (2026-10-31)
`call_warm` (D69) may load or keep the call's speech models only within a stretch of warm-ups
no longer than `WARM_MAX` (15 min) since its first one; later warm-ups of that stretch are
ignored until a call starts or warm-ups pause for `WARM_PAUSE` (10 min)
(`crates/na-daemon/src/call.rs`, `warm_step`). A phone left on the Neural page that wakes or
reconnects every few minutes therefore holds the 1 GB for at most about 20 minutes, not for
good; the cost after that is one cold start (about a second). Alternative: a client-side limit
(every web remote and app version would need it, and old ones would not have it).

## D79 — The website demo is the real app against a fake daemon in the browser (2026-11-01)
The site's live demo (`apps/web/src/demo`, [notes/website.md](notes/website.md)) runs the real
`@neuralagent/app` in iframes against a TypeScript daemon that speaks the real protocol, with a
virtual clock, seeded data and in-memory files/git. Desk and phone frames share one world on the
host page, so the cross-device flow (answer on the phone, the computer continues) is real app
code. The daemon is a lazy chunk and never touches the visitor's storage. Every new protocol
request the app sends needs an answer there too (`src/demo/daemon/handlers`; the tests check that
every request is answered). Alternatives: videos/screenshots (cannot be tried), a hosted real
daemon (cost, abuse, secrets), the old hand-drawn simulation (drifted from the app with every
release).

## D80 — LLM keys leave the macOS keychain; updates relaunch through Launch Services; one app instance (2026-11-01)
The keychain ties an item to the binary that created it (partition list with the cdhash for a
self-signed app without a Team ID), so every update asked for the login password again. Worse,
`orch_status` reads all four provider keys and runs on daemon start and on every settings change:
the daemon start waited on the prompt ("not answering yet") and changing any setting showed up to
four prompts. Keys now live in `<data>/keys.json` (0600) on macOS as on Linux, the same trade-off
as the remote credentials (D43); Windows keeps the Credential Manager, which has no per-binary
prompts. `secrets::migrate` copies keychain keys into the file once, in a thread after start, with
a `keys.migrated` marker so the keychain is never asked again.
After an in-place update the app no longer uses Tauri's `restart` (a direct exec, not a Launch
Services launch, which the Dock showed as a second icon): it runs `lsregister -f` on the bundle and
a detached `sh` waits for the old pid, then `open`s the bundle. `tauri-plugin-single-instance`
makes a second start show the running window on all three systems (it releases its lock in
`cleanup_before_exit`, so Tauri's restart on Windows/Linux still works).

## D81 — Insights: opt-out anonymous usage ping, user-sent problem reports, cookieless site counts (2026-11-01)
The owner asked for a complete admin dashboard (locations, platforms, downloads, request
notifications, device/version for support) and for usage data on by default, ideally including
Neural prompts. Decision ([notes/insights.md](notes/insights.md)):
- **Usage ping on by default, content-free.** Daily from the daemon: random install id (hashed on
  the relay), version, OS, arch, locale, feature counters. Switch in Settings → Privacy and
  support, with the exact payload shown, plus a one-time notice. Alternative opt-in was rejected
  by the owner's wish; legitimate interest covers anonymous minimal statistics, and the default is
  one line to flip.
- **Prompts only in a problem report, opt-in per report.** Collecting Neural prompts by default
  would break the product's promise (E2E, "your code and agents are not sent to us") and GDPR
  data minimisation. A report attaches the last 20 Neural requests only when the user switches it
  on and sees the JSON before sending.
- **Country, never IP.** `cf-ipcountry` from a trusted proxy or the DB-IP Lite table; only the
  two-letter code is stored. No third-party analytics service.
- **Website without cookies, therefore without a banner.** Page views, referrer host, country and
  download clicks as anonymous counters; DNT/GPC respected. A consent banner for a site that sets
  nothing would only cost visitors.
- **Downloads and update checks counted on the relay** (platform, version, country): installed
  versions are visible even when the ping is off.
- **Admin alerts by mail and push** (`{t: "admin"}`) for access requests and problem reports;
  admin actions go to an audit log. Retention: installs 400 days, solved reports 180 days, audit
  365 days.

## D82 — Terminal copy via OSC 52, one clipboard path, native clipboard on desktop (2026-11-01)
- **Problem**: Claude Code (and Codex, tmux, Neovim) track the mouse, so a drag selects inside the
  program, not in xterm.js; the program then copies with OSC 52, which xterm.js ignores without a
  handler. Result: "Copy" greyed out, nothing on the clipboard.
- **Decision**: `TerminalView` registers an OSC 52 handler (`lib/osc52.ts`): writes only (a `?`
  read request would let any program read the clipboard), max 1 MB, only for the focused pane in
  a focused window and not during snapshot replay (other clients on the same session stay out).
  The last program copy also feeds ⌘C / Ctrl+Shift+C and the menu's Copy until the next key or
  left click. The menu explains how to select when nothing is selected (⌥-drag / Shift-drag force
  xterm's own selection).
- **One clipboard path** (`lib/clipboard.ts`): `DaemonProvider` registers the shell's clipboard;
  every copy goes native shell → Clipboard API → textarea fallback. Desktop gets
  `clipboard_write_text` / `clipboard_text` (arboard, one long-lived handle so Linux/X11 keeps
  serving the text): OSC 52 arrives without a user gesture, which WebKit's Clipboard API refuses,
  and WebKit's readText shows its own "Paste" bubble. Browsers that refuse an un-gestured write get
  a toast with a Copy button.
- **Not done**: no automatic copy-on-select for xterm's own selection (terminals differ; iTerm2
  on, Windows Terminal off). Can become a setting.

## D83 — One PTY, several clients: the device in use owns the size, the others adopt it (2026-11-02)
- A session's PTY has one size, but a desktop pane, a phone and the Claude view can show it at once.
  Before, each view kept its own xterm size, so a phone (or the Claude view's fixed 100×30) shrinking
  the PTY left the desktop drawing narrow output at its own width: scrambled lines.
- Now (`TerminalView.tsx`): the daemon's `session.cols/rows` is watched; when it differs from what
  this view last reported, the view resizes xterm to the PTY size (clipped or with a margin) and
  repaints from the daemon snapshot. Input on this device (click or key in the focused pane, window
  focus, page shown again) claims the size back. Adopting never reports a size, so two clients
  cannot ping-pong.
- Rejected: scaling the adopted terminal to fit (unreadable at 190 columns on a phone); a daemon-side
  "owner" (needs protocol changes for what the session size already tells).
- Paste: on Windows/Linux Ctrl+V is the browser's paste in the terminal (like Windows Terminal), not
  ^V; a CLI reading the clipboard on ^V would read the host's, not a remote browser's. Screenshots in
  a paste go through `pastedImages()` (`claude/files.ts`) for terminal, Claude composer and key bar.
- Glass + rim drew the border and, one hair inside, the rim with the same radius: a double frame with
  mismatched corners (clear at 1px on Windows). Dark: the border turns clear and the rim is the edge
  (`effects.css`). Light keeps its dark border (a white rim alone is no edge).

## D84 — "Hey Neural" starts a call; generous end of speech; smooth "working" motion (2026-11-02)
- Before, the wake word recorded one utterance in the desktop process (its own VAD + Parakeet) and
  sent the text to Neural: no spoken answer, a second model in memory, and the spotter rested for up
  to 8 s while waiting and transcribing (the next "Hey Neural" went unheard).
- Now the wake word starts the same call as "Call Neural" (`voice.rs` → `voice-wake` → `startCall(
  client, { wake, preroll })`). The desktop keeps the last 1.5 s before the spotter fired plus what
  follows until the call takes it (`voice_preroll`, PCM16 base64, one `call_audio` message), so
  "Hey Neural, start Claude" in one breath reaches the call whole; the daemon strips the wake word
  from what it hears (`na_voice::text::strip_wake`). The call's first microphone frame (it overlaps
  the preroll's end) is dropped. While any call runs in the window (`duck_call` → `call_active`)
  the spotter rests and then restarts on fresh audio. A wake word call hangs up after 20 s of quiet
  (`WAKE_IDLE_MS`; no voice, Neural not busy or talking). Rejected: running the call natively in
  Rust (needs a second daemon connection and its own echo cancellation).
- Calls: the pause that ends a sentence is 0.8 s (was 0.5 s); a sentence ending on "und", "and",
  "ähm", a comma… is held up to 1.8 s more while the caller stays quiet and joined with what follows
  (`unfinished`). Cost: about 0.3 s more per turn.
- Wake spotter: boost score 1.5 (was 2.0). Synthetic `say` corpus (8 English + 6 German voices, 126
  clips, `examples/wake_vad.rs` with `NOISE=0.003`): English 17/18 (was 13/18), all 27/42 (was
  23/42), 0 false wakes either way; a higher score (3.0) hit fewer; the threshold (0.15–0.25) made no
  difference. German TTS voices are still mostly missed (the model is English-only: "Learn my
  voice", D20). A mispronunciation line for those voices (`▁HE N A IL`) did not help.
- A speaking wake word call cancels a Neural run that was busy (a new `orch_send` supersedes it).
- Background: the main window has `backgroundThrottling: "disabled"` (WKWebView suspends a hidden
  web view otherwise; macOS 14+). Browser tabs need nothing: playback is scheduled on the audio
  clock, a page with live audio is not frozen, only UI timers slow down.
- "Working…" stutter: the shimmer moved a band one way and a copy of the text the other way; the
  copy snapped to whole pixels on its own and the label shook. Now one element with a gradient
  clipped to the text (`background-position` animates; repainting one label is cheap). The orb
  switched `animation-duration` between idle and busy, which jumps a CSS animation to another
  angle; it now changes the playback rate (`updatePlaybackRate`) and keeps its angle.
  Owner: the busy orb was far too strong. Busy now swirls at about twice the idle pace (3.2 s lap,
  was 1.6 s) and the warm blob drifts less (scale 1.1, was 1.2).

## D85 — Dictation history on the desktop (2026-11-02)
**Why:** a long dictation was pasted into a web page that turned it into an in-memory card and
lost it on reload; NeuralAgent kept only the last text in memory, so it was gone for good.
**Decision:** the desktop app keeps the last 50 dictations in `dictations.json` next to
`voice.json` (mode 0600, atomic write), saved *before* the text is typed so a failed paste
cannot lose it. Settings → Voice shows them in a collapsed `Disclosure` ("Recent dictations")
with copy, delete and clear all (`components/settings/DictationHistory.tsx`). Commands
`voice_history`, `voice_history_delete`, `voice_history_clear`; remotes reach them through the
existing `host_ui` forwarding (`voice.history*`), no daemon or protocol change. Older hosts
answer "unknown operation" and the section stays hidden.
**Alternatives:** keep it only in memory (lost on restart, the case that hurt); store it in the
daemon state (dictation is the desktop app's, and the daemon may run on another machine); an
off switch (not now: nothing leaves the computer and the user can clear it).

## D86 — "Hey Neural": chime, call controls in the pill, guided "Learn my voice", looser detector (2026-11-02)
**Context:** after D84 the owner asked for a small tone when "Hey Neural" is heard, a pill that
shows the call and can hang up (minimal), a guided voice training, and "cover it more broadly so
it really recognizes it every time".
**Decision:**
- A wake call plays a short two-note sine chime (gain 0.06) once the preroll is sent, and a falling
  one before the 20 s idle hang-up (`chime()` in `lib/call.ts`).
- The voice pill shows the call state ("Neural…", "Listening", "Thinking…", "Neural speaks") and a
  round hang-up button. `hud_call` (Rust) makes the pill window clickable only while a call runs
  and forwards the state; the button emits `hud-hangup` to the main window, which ends the call.
- "Learn my voice" is guided: three takes in a row, Record/Stop, up to three misses. Turning the
  wake word on with fewer than three learned takes starts it. Learned lines are capped at 10
  (was 6). The spotter rests while learning.
- A second, looser path in `na_voice::wake`: a small streaming recognizer on the same model with
  endpointing; a short phrase whose words are close to the keyword (`loose_match`: same first and
  last letter, edit distance ≤ len/4, short first word) also wakes. On the `say` corpus +1 hit,
  still 0 false wakes; about 2 % CPU instead of 1 %. `WakeConfig.loose` turns it off.
**Alternatives:** a lower keyword score (more false wakes on the corpus); a bigger KWS model (download
size); a system notification sound (cannot be made quiet enough, not in the call's audio path).


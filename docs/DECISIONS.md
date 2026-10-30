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
macOS/Windows keep keys in the system keychain (`dev.neuralhub.neuralagent.keys`); development
builds and Linux in `<data>/keys.json` (0600). `NEURALAGENT_LLM_KEY` overrides for tests/CI.
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

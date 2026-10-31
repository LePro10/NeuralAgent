# CODEMAP – NeuralAgent

Generated 2026-10-31 by `node scripts/codemap.mjs` (516 files). Do not edit by hand; regenerate after adding,
renaming or deleting files. Per file: (lines) — purpose (first doc comment) · main types/functions/exports.
Look here first, then read only the files you need (Grep this file instead of reading it whole).

Generated, not listed: `packages/protocol/src/gen/` (95 files, from `crates/na-protocol` via `cargo test`).

## apps/android/
- **capacitor.config.ts** (20) — The app is the web remote served by the relay (`/app`), wrapped with native push, sign-in

## apps/android/android/app/src/main/java/dev/neuralhub/neuralagent/
- **AgentTile.java** (25) — `class AgentTile, onStartListening(), onClick()`
- **AgentWidget.java** (28) — `class AgentWidget, onUpdate()`
- **CallAudio.java** (140) — `class CallAudio`
- **CallService.java** (71) — `class CallService, onStartCommand(), onDestroy(), onBind()`
- **CallTile.java** (29) — `class CallTile, onStartListening(), onClick()`
- **MainActivity.java** (152) — `class MainActivity, onCreate(), onPageStarted(), onPageCommitVisible(), onNewIntent(), onResume()`
- **NativePlugin.java** (265) — `class NativePlugin, load(), callActive(), readClipboardImage(), copyText(), callRoute(), pushState(), pushToken(), dropToken(), setStatus(), pinWidget(), setNames(), launchTheme()`
- **PushService.java** (50) — `class PushService, onMessageReceived(), onNewToken()`
- **Status.java** (92) — `class Status`

## apps/desktop/
- **vite.config.ts** (21) — Tauri expects a fixed port and must see Rust-side errors in the terminal.

## apps/desktop/src/
- **dev-browser.tsx** (60) — Dev only: the desktop UI in a plain browser (UI tests, debugging). Not part of the build.
- **hud.tsx** (44)
- **main.tsx** (197)

## apps/desktop/src-tauri/
- **build.rs** (4)

## apps/desktop/src-tauri/src/
- **daemon.rs** (165) — Finds or starts `neuralagentd`. · `const APP_ID, const PROTOCOL, struct DaemonInfo, data_dir(), ensure(), wait_gone(), stop()`
- **hud.rs** (76) — A small pill at the bottom of the screen while dictating or after "Hey Neural", so the user · `create(), update()`
- **lib.rs** (195) — `run()`
- **main.rs** (7) — Prevents an extra console window on Windows in release builds.
- **mic.rs** (187) — Microphone capture: the default input device as 16 kHz mono f32 chunks. · `take_level(), meter(), struct Mic, impl Drop for Mic`
- **models.rs** (3) — Voice models moved to `na_voice::download` so the daemon can manage them for remote clients.
- **tray.rs** (139) — Menu bar / tray icon: shows how many agents need you, opens the window, and quits either just · `create(), update(), show_main()`
- **update.rs** (175) — App updates from agent.neuralhub.dev (Tauri updater, signed with the release key). Installing · `struct UpdateInfo, update_server(), update_check(), update_install()`
- **voice.rs** (491) — Voice on the desktop: hold a hotkey to dictate into any app, and the "Hey Neural" wake word. · `struct VoiceConfig, impl Default for VoiceConfig, enum Activity, struct VoiceStatus, struct Voice, impl Drop for WakeLoop, on_shortcut()`

## apps/web/
- **vite.config.ts** (65) — One version for everything: the Cargo workspace's (scripts/set-version.mjs).

## apps/web/public/
- **install.sh** (31) — Installs or updates NeuralAgent on macOS:

## apps/web/public/app/
- **sw.js** (67) — Web remote service worker: shows "an agent needs you" pushes and opens that agent on tap.

## apps/web/src/
- **brand.tsx** (41) — The NeuralAgent mark: an N built from terminal panes (same shape as BrandMark in the app). · `BrandMark(), Brand(), Footer()`
- **changelog.tsx** (248) — /changelog: every release from CHANGELOG.md (bundled at build time via `virtual:changelog`,
- **download.tsx** (100)
- **landing.tsx** (89)
- **legal.tsx** (133)
- **simple.tsx** (32) — One tiny entry for simple pages like 404 (picked by <body data-page>).

## apps/web/src/admin/
- **App.tsx** (96) — `Screen(), App()`
- **Dashboard.tsx** (53) — `Dashboard()`
- **Requests.tsx** (64) — Runs a user action, reloads the list and reports errors as a toast. · `useAction(), Requests(), statusPill`
- **SignIn.tsx** (64) — `SignIn()`
- **Stats.tsx** (60) — `Stats()`
- **Users.tsx** (100) — `Users()`
- **api.ts** (272) — Typed client for the relay's JSON API (same origin). The access token lives in memory only; · `interface User, interface Device, interface DayStats, interface Stats, interface Session, interface Config, class ApiError, hasStoredSession, b64u(), unb64u(), onSignedOut, config(), startSignIn(), finishSignIn()` +3
- **format.ts** (23) — `bytes(), ago(), date`
- **hooks.ts** (38) — `interface Polled, usePolled()`
- **main.tsx** (13)

## apps/web/src/remote/
- **Remote.tsx** (540) — `Remote()`
- **main.tsx** (6)
- **native.ts** (134) — Inside the Android app, which loads this page from the relay: FCM push, sign-in in a Custom · `plugin, REDIRECT, signIn, apkVersion, openOutside, onActive, clipboardImage, copyText`
- **push.ts** (173) — Web Push for the web remote: the service worker, the subscription the relay pushes to, and · `startWorker(), pushState(), enablePush(), disablePush(), syncPush(), takeLaunchRequest(), onOpenRequest(), doneOpening(), rememberNames(), setPushSilent()`
- **session.ts** (56) — The web remote's account and relay link, shared by every screen. One per tab. · `ios, native, deviceName, account, link, useLink(), lastHost, REDIRECT`
- **webUpdate.ts** (23) — The web remote (and the Android shell, which loads it from the relay) runs the build that was · `webUpdate`

## apps/web/src/site/
- **Demo.tsx** (231) — The live demo: a simulated NeuralAgent window. Pure front-end; no network, no backend. · `Demo()`
- **Hero.tsx** (72) — `Hero()`
- **Nav.tsx** (91) — Where a section's content starts, below the fixed nav. Re-read on every call: lazy parts change heights. · `goTo(), Nav()`
- **Scenes.tsx** (92) — Illustrations for the story and the feature tabs. Pure CSS/SVG, tokens only. · `GridScene(), VoiceScene(), PhoneScene(), SealScene(), SCENES`
- **Sections.tsx** (215) — `DemoSection(), Numbers(), Security(), Platforms(), Faq(), Final(), SiteFooter()`
- **Showcase.tsx** (232) — `Showcase()`
- **Story.tsx** (111) — `Story()`
- **data.ts** (94) — Content for the landing page. Only things the product really does (see docs/PLAN.md, STATUS.md). · `SITE, MAIL, INSTALL_CMD, AGENTS, NAV, FAQ, interface Latest, type Os, detectOs(), OS_LABEL, useRelease()`
- **hooks.ts** (153) — Small scroll / viewport helpers for the landing page. No dependencies: one scroll listener, one · `reduced, useSeen(), useVisible(), useMedia(), startScroll(), useTyped(), useCopy()`
- **parts.tsx** (185) — Small building blocks shared by hero, story, showcase and demo: typed terminals, waveform, window frame. · `type Line, useTypist(), Term(), StatusDot(), Win(), SIDE, Wave(), Orb(), CopyCmd(), AutoPane(), Btn(), Aurora()`

## crates/na-crypto/src/
- **lib.rs** (170) — NeuralAgent E2E encryption v1. The TS twin lives in `packages/crypto`. · `enum Error, type Result, b64(), unb64(), fingerprint(), struct StaticKey, struct ClientHandshake, host_accept(), host_accept_with(), struct Session`

## crates/na-crypto/tests/
- **e2e.rs** (70)
- **vectors.rs** (60) — Cross-implementation vectors. Regenerate with NA_WRITE_VECTORS=1 (only when the spec changes).

## crates/na-daemon/src/
- **audit.rs** (127) — Audit log: what phones, browsers and the orchestrator did on this computer. · `struct Audit`
- **awake.rs** (109) — Keeps the computer from sleeping while agents work (setting `keep_awake`). The display may · `struct Awake`
- **call.rs** (579) — Voice calls with Neural. The client streams echo-cancelled microphone audio; everything · `const OUT_RATE, struct Engines, struct Calls, struct CallHandle, impl Drop for CallHandle, lang_of()`
- **catalog.rs** (315) — Known agent CLIs: how to find, install, start and resume them, and how we get their status. · `enum PromptMode, enum Hooks, struct Agent, const AGENTS, agent(), detect(), parse_version()`
- **claude_view.rs** (2274) — Claude view: reads the transcript of a Claude Code session (JSONL in `~/.claude/projects`) · `struct ClaudeView, struct Parsed, const EFFORTS, effort_from_output(), detect_effort(), settings_effort(), parse_line(), parse_line_in(), detect_prompt(), detect_activity(), detect_mode(), claude_dir(), match_files()`
- **core.rs** (1370) — The daemon's state and everything that changes it. · `now_ms(), err(), struct Core, struct Subscription, apply()`
- **cv_action.rs** (328) — Claude view: actions the phone asks for (`Request::CvAction`), done by typing the CLI's own · `menu_now()`
- **cv_commands.rs** (369) — Claude view: the slash commands of Claude Code (table for CLI 2.1.316) plus the user's, · `builtin(), front_matter(), read_small(), collect_commands(), collect_skills(), collect_plugins()`
- **cv_image.rs** (290) — Images in a Claude transcript (a `Read` of a picture, pasted images, screenshots from MCP · `const MAX_SEND, images_in(), index_of(), image_ref(), image_url(), dims(), serve(), fit()`
- **cv_parse.rs** (485) — Claude view: the less common transcript shapes, kept out of `claude_view::parse_line`. · `between(), tool_meta(), agent_result_text(), task_kind(), task_notification(), enum ShellLine, shell_line(), split_pasted(), hook_attachment(), stop_hook_summary(), api_error(), refusal(), enum QueueOp, queue_op()` +4
- **cv_screen.rs** (273) — Claude view: more that is read off the CLI's screen. The busy spinner (Claude Code drops · `spinner(), is_spinner(), checkbox(), wants_text(), detect_menu(), fingerprint(), classify()`
- **cv_tasks.rs** (576) — Claude view: the background tasks of a conversation (subagents, background shells, monitors). · `valid_agent_id(), subagent_dir(), subagent_path(), struct Tasks, last_step(), step_label()`
- **discord.rs** (200) — Discord Rich Presence (setting `discord_presence`). General shows only that NeuralAgent is in · `struct Presence, presence(), struct Discord`
- **env.rs** (225) — The environment agents run in. · `const STRIP, struct LoginEnv, default_shell()`
- **fsbrowse.rs** (109) — Read-only folder browsing for picking workspaces (also from the phone). · `expand(), list(), roots(), mkdir()`
- **git.rs** (331) — Git through the `git` CLI: a summary per workspace, the changed files and their diff, and one · `const WORKTREE_DIR, is_repo(), summary(), changes(), diff(), worktree_create(), worktree_dirty(), worktree_merge(), worktree_remove()`
- **history.rs** (279) — Search over past agent conversations on this computer, so they can be resumed: Claude Code · `struct History`
- **hooks.rs** (130) — Agent hooks: `neuralagentd hook <event>` runs inside the agent's process tree and forwards · `client_main(), statusline_main(), subagent_statusline_main(), receive()`
- **host.rs** (284) — The host as seen from remote devices (D42): voice models and update checks live in the · `struct Host`
- **layout.rs** (265) — Split-tree helpers. Clients edit layouts freely (drag, resize, close); the daemon only needs · `const MAX_PANES, new_id(), new_tab(), grid_tab(), default_layout(), count_panes(), place_session(), clear_session(), sessions_in()`
- **llm.rs** (343) — Chat with tool calls against the user's own model provider (BYOK): NeuralHub and other · `enum Msg, struct Call, struct Tool, struct Turn, struct Llm, impl Default for Llm, default_url(), needs_key(), struct Ask`
- **main.rs** (232) — neuralagentd — the NeuralAgent host daemon. · `tls_init()`
- **mcp.rs** (289) — MCP servers managed in one place and handed to every agent at launch. · `type Secrets, secrets_path(), load_secrets(), save_secrets(), valid_id(), struct Extra, for_engine(), import()`
- **orch.rs** (774) — Neural, the orchestrator: a conversation with the user's own model that starts, prompts, · `struct Orch, type Speech, system_prompt(), watch(), trim()`
- **paths.rs** (79) — Where the daemon keeps its files. · `const APP_ID, struct Paths, struct DaemonInfo, write_private()`
- **policy.rs** (106) — What a client may do without asking. · `check()`
- **preview.rs** (92) — Finds the address a dev server prints ("Local: http://localhost:5173/") in terminal output, · `find_url()`
- **profiles.rs** (168) — Built-in launch profiles and how a profile becomes a command line. · `const INSTALL_PREFIX, builtin(), install_profile(), struct Launch, launch(), const CLAUDE_EVENTS, claude_settings()`
- **pty.rs** (377) — One process in a pseudo terminal, mirrored by a headless VT emulator. · `struct Chunk, struct Spawn, enum PtyNote, struct Pty`
- **remote.rs** (830) — Remote access: sign-in with the relay, the connection to it, and phones/browsers of the same · `const DEFAULT_RELAY, struct Remote, start(), handle(), struct Callback, callback(), impl Drop for Sess`
- **secrets.rs** (49) — Keys the user typed in (LLM providers): the OS keychain in release builds on macOS and
- **server.rs** (425) — Local WebSocket server (127.0.0.1 only, token + Origin check). · `random_token(), ct_eq(), struct App, router(), run_client(), run_channel(), struct Conn`
- **swarm.rs** (619) — Swarms: a team of agents on one goal that hand work to each other. · `const SERVER_ID, const YOU, struct Outbox, default_team(), brief(), server(), bridge_env(), trim(), receive(), bridge_main()`
- **usage.rs** (634) — Token use and cost from the CLIs' own transcripts, so it covers every conversation on this · `struct Price, price(), struct Usage, claude_limits(), since_day(), today()`

## crates/na-protocol/src/
- **claude.rs** (844) — Claude view: the structured conversation of a Claude Code session, read from its transcript · `enum CvRole, enum CvBlock, struct CvToolMeta, struct CvHunk, struct CvTask, struct CvTodo, struct CvPr, struct CvWorktree, struct CvQueued, struct CvImage, struct CvImageData, struct CvMessage, struct CvMeta, struct CvOption` +14
- **lib.rs** (1509) — Wire types shared by every NeuralAgent component. · `const PROTOCOL_VERSION, type Id, type Millis, enum ClientMsg, enum ServerMsg, enum CallEvent, enum CallState, struct ClientInfo, enum ClientKind, struct HostInfo, struct ApiError, enum ErrorCode, struct State, struct Swarm` +57

## crates/na-relay/src/
- **admin.rs** (125) — Admin API (`/api/admin`): accounts whose email is in `ADMIN_EMAILS`. · `router(), struct Admin`
- **auth.rs** (541) — Sign-in (Google OIDC / GitHub OAuth, both with state + PKCE), one-time code exchange, rotating · `config(), struct StartQuery, start(), struct CallbackQuery, callback(), struct NewDevice, struct Tokens, struct Exchange, exchange(), struct RefreshBody, refresh(), logout(), me(), struct DeviceUpdate` +9
- **config.rs** (120) — Configuration from the environment (the env file on the server; never in the repository). · `struct Provider, struct Smtp, struct Config`
- **db.rs** (470) — SQLite storage: accounts, provider identities, devices and anonymous stats. · `const MAX_DEVICES, enum Status, struct User, struct Device, struct Identity, enum Refresh, struct Db`
- **hub.rs** (347) — WebSocket hub: routes opaque end-to-end envelopes between online devices of the same account, · `struct Hub, upgrade()`
- **lib.rs** (246) — NeuralAgent relay: Google/GitHub sign-in with admin approval, devices, QR pairing, admin · `mod admin, mod auth, mod config, mod db, mod hub, mod mail, mod push, mod releases, mod util, mod web, const ACCESS_TTL, const PAIR_TTL, struct Flow, struct Code` +9
- **mail.rs** (98) — Notification mails over SMTP (Brevo). Without SMTP settings mails are only recorded. · `struct Mailer`
- **main.rs** (33) — `neuralagent-relay health`: exit 0 if the local relay answers (container health check).
- **push.rs** (347) — Push to phones and browsers when an agent needs attention: FCM (Android app) and Web Push · `enum Target, struct Push, struct Notice, encrypt()`
- **releases.rs** (377) — Releases: CI uploads the builds of a version, then publishes its manifest. The relay answers · `struct Manifest, struct Update, router(), downloads(), valid_version(), compare(), prune()`
- **tests.rs** (284) — Whole account flow against a real server on a local port, with the test sign-in:
- **util.rs** (134) — Small helpers: time, random tokens, hashing, short-lived in-memory maps, HTTP errors. · `now(), day(), b64u(), unb64u(), token(), hash(), s256(), ct_eq(), struct Ttl, impl Default for Ttl, struct ApiError, type ApiResult, impl From for ApiError, impl IntoResponse for ApiError`
- **web.rs** (104) — Static web pages: landing (`/`), web remote (`/app`), admin (`/admin`), changelog, brand assets. · `router()`

## crates/na-voice/examples/
- **stt_bench.rs** (69) — STT benchmark: word error rate, real-time factor and latency per model on a corpus.
- **tts_bench.rs** (88) — Text-to-speech benchmark: speed, time to first audio, and intelligibility (the speech is
- **wake_vad.rs** (88) — Checks the wake word and the VAD against a corpus (see `stt_bench`).

## crates/na-voice/src/
- **download.rs** (180) — Voice models: what exists, what is installed, and a checked download into `<data>/models`. · `struct Spec, const PARAKEET, const WAKE, const VAD, const SUPERTONIC, const SPECS, struct ModelStatus, spec(), path(), download()`
- **lib.rs** (23) — Local speech for NeuralAgent, on top of sherpa-onnx (CPU, int8 models). · `mod download, mod stt, mod text, mod tts, mod vad, mod wake, const SAMPLE_RATE, mod models`
- **stt.rs** (171) — Speech to text: offline models transcribe a finished utterance, streaming models also give · `enum SttKind, struct SttModel, file(), tokens(), enum Engine, struct Stt, struct Live`
- **text.rs** (43) — Text helpers: normalisation for comparisons and word error rate. · `normalize(), wer()`
- **tts.rs** (136) — Local text to speech (sherpa-onnx): Supertonic (multilingual) and Pocket TTS (English, cloned voice). · `enum TtsKind, struct TtsModel, struct Speech, struct Tts`
- **vad.rs** (69) — Voice activity detection (Silero): cuts microphone audio into utterances. · `struct Segment, struct Vad`
- **wake.rs** (100) — Wake word ("Hey Neural") with a small streaming keyword spotter (zipformer, ~3 MB). · `const HEY_NEURAL, struct WakeConfig, impl Default for WakeConfig, struct Wake, learn()`

## deploy/relay/
- **update.sh** (25) — Pull deployment (systemd timer): fetch a newer relay image, restart, keep it only if healthy,

## docs/brand/
- **build-web-icons.mjs** (163) — Regenerates every web / PWA / Discord icon and the Open Graph cards from one master geometry.

## packages/app/src/
- **App.tsx** (437) — `App()`
- **index.ts** (14) — `App, DaemonProvider, useClient, useDaemon, usePlatform, useUi, VoiceHud, HostUpdateWatcher, bindCallAudio, storedZoom, launch, useLaunch, GRACE_MS, LaunchNote` +2

## packages/app/src/components/
- **AccountRow.tsx** (34) — The user at the foot of the sidebar: photo (Google/GitHub when the relay knows it), name, email, · `AccountRow()`
- **AgentCatalog.tsx** (141) — Every known agent CLI: what is installed, and a one-click install that runs visibly in a pane. · `AgentCatalog()`
- **AgentGlyph.tsx** (36) — `AgentGlyph(), GlyphTile()`
- **AgentsDashboard.tsx** (186) — `AgentsDashboard()`
- **BrandMark.tsx** (13) — The NeuralAgent mark: an N built from terminal panes (docs/brand/neuralagent-mark.svg). · `BrandMark()`
- **BrowserPane.tsx** (90) — Normalises what was typed: `localhost:3000` → `http://localhost:3000/`. · `toUrl(), BrowserPane()`
- **CallAudioToggle.tsx** (26) — Earpiece / speaker switch among the call controls. Hidden where the browser cannot choose. · `CallAudioToggle()`
- **CallScreen.tsx** (60) — The in-call surface for Neural: orb, running time, what was heard and said, mute / speaker / end. · `CallScreen()`
- **ChangesSheet.tsx** (226) — `ChangesSheet()`
- **EmptyPane.tsx** (119) — An empty pane is a launcher: pick what runs here. · `EmptyPane()`
- **EngineTile.tsx** (58) — `QuietTile(), EngineTile(), tileGlyph`
- **FolderBrowser.tsx** (188) — `pickHostFolder(), FolderBrowserSheet()`
- **Glow.tsx** (33) — Colour pairs for a page's light: [left, right, centre] as colour tokens. · `Glow()`
- **HistoryPage.tsx** (140) — The workspace whose folder holds `cwd` (the deepest one). · `HistoryPage()`
- **HostSettings.tsx** (307) — `HostVoiceSettings(), HostUpdates(), WorkspaceSettings()`
- **HostWatcher.tsx** (68) — `HostUpdateWatcher()`
- **KeyBar.tsx** (268) — Phones: one compact row of the keys a phone keyboard lacks, right above the keyboard · `KeyBar()`
- **LaunchScreen.tsx** (70) — The app's side of the launch screen (lib/launch.ts): it lifts the moment the daemon state is · `LaunchScreen(), LaunchNote()`
- **McpPage.tsx** (243) — `McpPanel()`
- **NeuralPage.tsx** (471) — `NeuralPage(), useOpenSession`
- **Pane.tsx** (197) — `interface PaneActions, Pane()`
- **PaneTree.tsx** (102) — `interface TreeCtx, PaneTree()`
- **ProfileEditor.tsx** (108) — `ProfileEditor()`
- **ReleaseNotes.tsx** (81) — Release notes from CHANGELOG.md (lib/changelog.ts): used by the update dialog and Settings → Updates. · `CHANGELOG_URL, ReleaseNotes()`
- **RemotePage.tsx** (330) — Settings → Remote access: invite-only sign-in, then this computer's devices and "Add phone". · `RemotePanel()`
- **SettingsPage.tsx** (308) — Settings. Phones: the computer on top, then a grouped list with quiet icon tiles; each row is a · `SettingsPage(), PhoneSettingsRoot(), PhoneSettingsSection()`
- **SwarmPage.tsx** (95) — Swarms: teams of agents on one goal that hand work to each other, and their conversation. · `SwarmPage()`
- **TerminalText.tsx** (66) — The terminal's text as plain, selectable text: phones cannot select in xterm's canvas, so this · `showTerminalText, onShowTerminalText(), TerminalTextSheet()`
- **TerminalView.tsx** (403) — One xterm.js view of a daemon session. The daemon holds the real terminal; this view attaches · `isAppShortcut(), TerminalView()`
- **UpdateBadge.tsx** (124) — The running version and the Update button. Desktop: above the account block at the sidebar's · `UpdateBadge()`
- **UpdateDialog.tsx** (120) — "NeuralAgent X is available": what changed since this version and Install now / Later (desktop), · `UpdateDialog()`
- **UpdateSettings.tsx** (122) — Settings → Updates. Desktop: app and background-service versions, the service switch after an · `LocalUpdates(), WebVersion()`
- **UsagePage.tsx** (260) — `UsagePage()`
- **VoiceHud.tsx** (92) — `type VoiceLevelSource, VoiceHud()`
- **WorkspaceView.tsx** (299) — WebGL contexts are limited per page; above this many visible panes we fall back to the DOM renderer. · `interface PaneRef, WorkspaceView()`
- **ZoomControl.tsx** (126) — Desktop interface size: applies the chosen size to the window's web view and handles the zoom · `ZoomControl()`

## packages/app/src/components/claude/
- **AgentCard.tsx** (111) — Subagents in the transcript (A3 §2.7): one card per Agent/Task call with its type, what it was · `TasksContext, tokens(), counts(), AgentCard, AgentCards()`
- **ChatScroll.tsx** (84) — The scrolling transcript of a conversation (main or subagent): `useStickToBottom` wired to the · `interface ChatScrollHandle, interface ChatScrollProps, ChatScroll`
- **ClaudeView.tsx** (231) — The Claude Code UI over the real CLI, dressed like Anthropic's own apps: the conversation is · `ClaudeView(), splitActivity()`
- **CommandPalette.tsx** (175) — Every Claude Code command in one place: built-ins grouped the way people think about them, · `interface CommandPaletteProps, CommandPalette()`
- **Composer.tsx** (922) — The input at the bottom, shaped like Claude's. Resting: one 48px pill (attach "+", the text, · `interface ComposerProps, Composer()`
- **ContextSheet.tsx** (102) — How full the context is and what the session cost so far. The ring sits in the composer; · `ContextRing(), ContextSheet()`
- **DockCard.tsx** (151) — The frame of a card docked where the composer sits (permission, plan, question, menu): · `DockCard(), Btn(), AnswerField()`
- **Images.tsx** (480) — Pictures in the conversation, like Claude Code desktop shows them: a rounded thumbnail under · `ImageSidContext, ImageAgentContext, interface Pic, GalleryContext, Thumb(), NoImage(), Pictures, Viewer()`
- **Markdown.tsx** (333) — A small Markdown renderer for assistant text in Claude's reading style (no HTML is ever injected). · `parseBlocks(), copyText(), CopyButton(), CodeBlock(), plainText(), Markdown`
- **Picker.tsx** (157) — Choices in the Claude view (model, effort, permission mode, attachments). Phones: a "pour" · `Picker(), Pour(), PickSection(), PickRow(), PickNote()`
- **PlanCard.tsx** (96) — Plan approval (ExitPlanMode): the plan as markdown, the CLI's approve choices in its own · `PlanCard()`
- **PromptCard.tsx** (320) — A menu the CLI shows right now, docked where the composer sits (on phones it takes the · `asPermission(), parseTitle(), interface PromptCardProps, PromptCard(), interface CardProps`
- **QuestionSheet.tsx** (115) — AskUserQuestion, answered natively: one tab per question (header chips), the options with · `QuestionCard()`
- **QueueChips.tsx** (52) — Messages typed while Claude works wait in the CLI's queue. They sit as chips above the · `QueueChips()`
- **RewindSheet.tsx** (62) — "Rewind to here": go back to before one of the user's messages, with the code, the · `RewindSheet()`
- **Spark.tsx** (31) — Claude's clay spark: a burst of uneven rays. It turns and breathes while Claude works. · `Spark()`
- **Steps.tsx** (145) — The machinery between two texts as one quiet line (A3 §2.5 "Steps line"): · `StepLabel(), StepRun`
- **SubagentView.tsx** (108) — A subagent's own transcript, pushed over the conversation (A3 §2.7): a breadcrumb header · `interface AgentRef, SubagentView()`
- **TasksSheet.tsx** (121) — Background work of a session in one sheet (A3 §2.7): subagents, background shells and · `TasksSheet()`
- **Transcript.tsx** (474) — The conversation, laid out like Claude's apps (A3): the owner's messages in a soft bubble on the · `time, useEntries(), BlockNote(), Transcript()`
- **actions.ts** (196) — Things the Claude view does to the CLI by typing keys into its terminal: answer menus, · `interface Keys, serverActions, act(), sendPrompt, runKeys(), interrupt, shellSteps(), memoryPrompt, inputMode(), type Armed, typedMode(), resolveInput(), cycleMode(), isRewindable()` +10
- **commands.ts** (379) — The command palette's catalogue: every Claude Code slash command (CLI 2.1.316, see · `type CommandKind, interface Command, GROUPS, CATALOGUE, catalogued, mergeCommands(), scoreCommand(), searchCommands(), interface Section, paletteSections(), commandLine(), opensDialog(), pushRecent(), loadRecent()` +1
- **entries.ts** (293) — Messages → what the transcript shows (A3 §2.4, pure; tested in `lib/cvEntries.test.ts`). · `type Step, type Piece, interface Turn, type Entry, interface EntryCache, entryCache, textOf, toEntries(), openTools(), pendingUse(), lastTurn(), latestTodo(), interface GalleryItem, gallery()` +1
- **files.ts** (122) — Getting images from paste, drop, camera and clipboard buttons to the host's upload folder. · `MAX_SEND, typeOf, isImage, filesOf(), readClipboardFiles(), shrink(), uploadFile(), pathToken`
- **metaInfo.ts** (78) — Readers for `CvMeta`, including the fields the daemon adds from the statusline payload · `type MetaX, guessWindow, interface ContextInfo, contextOf(), shortTokens(), money(), span(), tasksRunning, fastOf, queuedOf`
- **models.ts** (74) — Claude Code's model aliases (what `/model <alias>` takes), effort levels and permission modes, with Claude's … · `MODELS, modelName(), modelAlias(), EFFORTS, DEFAULT_EFFORT, EFFORT_NOTE, effortName, interface Mode, MODES, modeOf, TERMINAL_COMMANDS, contextLimit`
- **promptState.ts** (243) — What kind of menu the CLI shows (permission, plan approval, question, confirm, other menu) · `type PromptKind, interface PendingUse, type PromptX, isPlanPrompt(), isQuestionPrompt(), isReviewPrompt(), promptKind(), interface QOption, interface Question, questionsOf(), checkState(), interface ScreenOption, screenOptions(), currentQuestion()` +15
- **queue.ts** (56) — Messages sent while Claude works wait in the CLI's queue until the next step. The view shows · `interface Queued, addQueued(), reconcile(), expire(), shownQueue(), SEND_NOW, TAKE_BACK`
- **stickModel.ts** (152) — The decision part of "stick to the bottom" (no DOM, tested in `lib/stickModel.test.ts`). · `NEAR_END, interface Metrics, class StickModel, firstVisible()`
- **toolText.ts** (329) — Words and numbers for tool calls (pure, no React; tested in `lib/cvEntries.test.ts`): · `type Use, type Res, str, short, inputOf, type ToolMeta, interface Hunk, metaOf, toolTitle(), VERB, verbOf, toolArg(), isPathTool, isCodeArg` +18
- **tools.tsx** (344) — What a tool call shows: the body of a step (Bash command and output, search results, tool · `changeRows, diffLines, toolArg, toolTitle, CwdContext, useRel(), picsOf(), picName, resultText, DiffStat(), Diff(), EditCard, EditCards(), Output()` +4
- **useConversation.ts** (66) — The conversation of a Claude session, live from the daemon (reconnects included). With · `useConversation(), interface Tasks, useTaskList()`
- **useDictation.ts** (75) — Speech to text: records on this device (16 kHz mono PCM), the host's local model transcribes. · `useDictation()`
- **useStickToBottom.ts** (238) — The transcript's scroll model (A3 §2.3): follow new output only while the reader is at the · `interface StickView, interface StickOptions, useStickToBottom()`
- **useTasks.ts** (118) — Background work of a session (subagents, background shells, monitors) for badges and the · `usePublishTasks(), useTasks(), useTasksOpener(), openTasksSheet()`

## packages/app/src/components/phone/
- **AgentsInbox.tsx** (134) — Phones: the Agents tab, the app's home. Every agent across all projects, sorted by what it needs · `useInbox(), inboxEyebrow(), AgentsInbox(), InboxSections()`
- **ConnectionBanner.tsx** (63) — Phones: when the computer has been out of reach for a few seconds, one calm pill under the · `ConnectionBanner()`
- **NewSheet.tsx** (175) — Phones: "+" on Agents or in a project. Pick the project and the agent, say what it should do · `NewSheet()`
- **PhoneApp.tsx** (165) — Phones: four tabs (Agents · Neural · Projects · Settings) in the Dock and the pages the phone · `PhoneApp()`
- **ProjectsPage.tsx** (180) — Phones: the Projects tab (every project folder on the computer, status at a glance) and one · `ProjectsPage(), ProjectPage()`
- **Waiting.tsx** (17) — Phones: before the computer's state is in (cold start, reconnect, "Continue anyway" on the launch · `useHasState, Waiting()`
- **rows.tsx** (215) — Phones: the rows of the Agents inbox and a project's page. One row per agent (quiet engine tile, · `wordOf, LIVE_ANSWERS, AgentInboxRow(), ErrorLine(), SwarmInboxRow()`

## packages/app/src/components/settings/
- **nav.ts** (9) — Lets a settings page open a detail page above itself (phones: pushed; desktop: right column). · `interface SettingsNav, SettingsNavCtx, useSettingsNav`
- **panels.tsx** (608) — The content of each Settings page (Appearance, Neural, Calls, Advanced, Discord, About). The · `Choice(), AppearancePanel(), appearanceSummary(), CallsPanel(), PROVIDERS, NeuralPanel(), AdvancedPanel(), alertsSummary(), NotificationsPanel(), DiscordPanel(), presenceLabel, keepAwakeLabel, AboutPanel()`

## packages/app/src/components/swarm/
- **NewSwarm.tsx** (188) — New swarm: the form (goal, workspace, team of role + agent) in a dialog on desktop, a sheet on phones. · `NewSwarmSheet()`
- **SwarmDetail.tsx** (255) — One swarm: header (goal, status, time, actions), conversation with composer, and the team. · `SwarmDetail()`
- **SwarmFeed.tsx** (133) — The swarm conversation: runs of messages, day labels, your bubbles, jump to the latest. · `SwarmFeed()`
- **SwarmList.tsx** (63) — The swarms in two groups, running first. · `SwarmGroups()`
- **members.tsx** (92) — A swarm member as the page shows it: role, its agent, and what it is doing now. · `interface MemberView, useMembers(), MemberButton(), RoleMark()`

## packages/app/src/components/workspace/
- **ClaudeViewSwitch.tsx** (84) — Chat or terminal for Claude agents. Desktop: one app-wide choice, one switch in the workspace bar · `useClaudeChat(), setAgentChat(), useAgentChat(), ClaudeViewSwitch()`
- **NewAgentSheet.tsx** (81) — Phones: "+" in a workspace opens this sheet: every agent you can start as a big tile, the · `NewAgentSheet()`
- **PhoneWorkspace.tsx** (452) — Phones: one agent at a time, full screen, under the Island ("Two Drops", PLAN C1). · `PhoneAgentScreen()`
- **islandOverride.ts** (35) — Phones: a layer inside the agent screen (the subagent view) can take over the Island for as long · `interface IslandOverride, IslandOverrideContext, useIslandOverride()`
- **paneMenu.tsx** (87) — What you can do with one pane, in one place: the desktop pane header's "…" menu and the phone · `usePaneSession(), paneTitle(), usePaneMenu()`

## packages/app/src/lib/
- **agentReason.test.ts** (43)
- **agentReason.ts** (61) — Readable status lines for agent rows (Agents inbox, Neural, the dashboard): a failed agent says · `isNoiseLine(), humanError()`
- **agentui.test.ts** (24)
- **agentui.ts** (98) — Small shared helpers for the agent-facing pages (Neural, Agents, Swarm, History): · `plainText(), NOTICE, agentSays(), shortAgo(), clock, dayLabel(), byDay(), useNow()`
- **alerts.ts** (79) — How this device tells you that an agent finished, needs your input or stopped with an error: · `type AlertMode, type AlertKind, useAlerts, setAlertMode(), wantsSound, wantsNotify, ALERT_TEXT, chime()`
- **call.ts** (220) — A call with Neural. The daemon does the listening and the speaking (local speech models); · `useCall, callLevel, startCall(), endCall(), muteCall(), interruptCall(), playPreview()`
- **callaudio.ts** (97) — Where a call with Neural is heard: at the ear (quiet, default) or on the loudspeaker. · `type CallRoute, interface CallAudioApi, useCallRoute, bindCallAudio(), setCallRoute(), useBindCallAudio(), useCanPickRoute(), probeWebOutputs(), applyWebRoute()`
- **changelog.test.ts** (33)
- **changelog.ts** (75) — Release notes for the update dialog and Settings → Updates. The data is CHANGELOG.md parsed by · `compareVersions(), notesBetween(), notesFromMarkdown(), type InlinePart, inlineParts()`
- **clipboard.ts** (73) — Writing text to the clipboard everywhere the app runs: the native shell first when it offers it · `writeClipboard(), copyWithToast(), readClipboardText()`
- **cvComposer.test.ts** (288) — Composer and controls logic of the Claude view: command catalogue, prompt kinds and keys, queue, rewind.
- **cvEntries.test.ts** (173)
- **cvImages.test.ts** (51)
- **cvImages.ts** (98) — Images in the Claude view (a `Read` of a picture, pasted images, MCP screenshots). The daemon · `REMOTE_EDGE, edgeFor, interface Loaded, b64ToBlob(), fromData, class ImageCache, fitBox(), sourceOf(), withoutSources, saveName(), kb`
- **format.ts** (26) — 1234 -> "1.2k", 1_200_000 -> "1.2M". · `compact(), totalTokens, money(), duration()`
- **host.ts** (138) — The host computer as seen from any client (D42). Voice models and update checks are daemon · `onHostNotice(), useHostModels(), interface HostVoice, useHostVoice(), interface HostUpdateView, useHostUpdate, checkHostUpdate(), installHostUpdate(), watchHostUpdate()`
- **inbox.test.ts** (71)
- **inbox.ts** (69) — The phone's Agents inbox: every agent across all projects, sorted by what it needs from you. · `type InboxItem, interface Inbox, isAgent(), sectionOf(), buildInbox()`
- **launch.ts** (128) — The launch screen: one element (#na-launch, lib/launchFrame.ts) that is on screen from the first · `type LaunchPhase, MIN_MS, GRACE_MS, launch, useLaunch()`
- **launchFrame.test.ts** (37)
- **launchFrame.ts** (55) — The launch screen's first frame, written into every app entry page (desktop index.html and · `MARK_PANES, MARK_PX, SCHEME_ACCENT, THEME_SCRIPT, LAUNCH_MARKUP, LAUNCH_MARKER, launchFrame()`
- **layout.ts** (142) — Pure layout-tree edits. The client changes the tree and sends `layout_set`; the daemon only · `MAX_PANES, newId, newTab(), panes(), activeTab(), updateTab(), splitPane(), removePane(), setContent(), setSizes(), swapPanes(), order(), gridOf(), frontTabFor()`
- **mic-worklet.js** (39) — Microphone for calls with Neural: mono, downsampled to 16 kHz, 40 ms PCM16 frames,
- **openAgent.ts** (73) — "Open this agent", one function for every place that has an agent to show (the Agents list, · `openAgentOnDesktop(), useOpenAgent(), cachedAgent(), rememberAgents()`
- **phoneRoute.test.ts** (304) — A browser history in memory: pushState/replaceState are instant, go/back land later (as in browsers).
- **phoneRoute.ts** (472) — Phone navigation: four tabs (Agents, Neural, Projects, Settings), a stack of pages per tab, all · `type Tab, TABS, HOME, type Route, interface Nav, routeKey(), navKey, sameNav, hashOf(), parseHash(), entriesOf(), validNav(), interface PhoneNavState, usePhoneNav` +4
- **platform.ts** (129) — Push on this device: "install" means iPhone/iPad must add the page to the Home Screen first. · `type PushState, interface Platform, interface UpdateInfo, interface UpdateApi, interface ChangelogEntry, interface ServiceSwitch, interface ServiceSwitchApi, interface WebUpdateApi`
- **profiles.test.ts** (9)
- **profiles.ts** (37) — What can start right now: the terminal, custom profiles, and built-in agents whose CLI is installed. · `launchable(), splitArgs(), joinArgs()`
- **settingsRoute.test.ts** (17)
- **settingsRoute.ts** (28) — Which Settings section to show next. Anything can open Settings at a section (the command · `SETTINGS_PAGE, MOVED_TO_SETTINGS, useSettingsRoute, requestSettingsSection(), takeSettingsSection()`
- **status.ts** (37) — `STATUS, mostUrgent(), since(), activityOf()`
- **stickModel.test.ts** (118)
- **store.tsx** (82) — `DaemonProvider(), useClient(), usePlatform(), useDaemon(), useUi, useCatalogSheet, useChanges`
- **swarmFeed.test.ts** (36)
- **swarmFeed.ts** (58) — The swarm conversation as a readable feed: messages in runs (same sender and recipient, close · `interface FeedMessage, type FeedBlock, RUN_GAP_MS, feedBlocks(), toLabel, elapsed()`
- **termKeys.test.ts** (27)
- **termKeys.ts** (27) — The phone terminal key bar's keys (KeyBar.tsx): escape sequences a phone keyboard lacks, and · `SEQ, ctrlSeq(), CTRL_LETTERS`
- **termtext.test.ts** (48) — Rows as xterm stores them: fixed width, `+` prefix = soft-wrapped continuation of the row above.
- **termtext.ts** (71) — Plain text out of an xterm.js buffer, for copying: rows that xterm soft-wrapped are joined back · `interface TextLine, interface TextBuffer, MAX_TEXT, bufferLines(), capLines(), interface TerminalText, terminalText()`
- **theme.ts** (139) — Themes: a colour scheme (ground, surfaces, ink; data-scheme) plus an accent (data-accent) and an · `type Scheme, type Accent, type Appearance, APPEARANCES, SCHEMES, ACCENTS, useTheme, accentOf, THEME_EVENT, resolvedAppearance(), syncThemeColor(), startTheme()`
- **time.ts** (11) — "5 min ago", "3 h ago", or the date for anything older than a month. · `ago()`
- **updateNotice.ts** (16) — "A new version is available" comes from three checks (this app or web build, the Android APK, · `updateNotice()`
- **updates.ts** (240) — Update state for the version label / Update button (UpdateBadge), the update dialog (UpdateDialog) · `FIRST_CHECK_MS, EVERY_MS, FOCUS_GAP_MS, interface Offer, interface UpdateState, useUpdates(), checkNow(), openUpdateDialog(), closeUpdateDialog(), applyUpdate(), loadChangelog(), notesFor(), useUpdateWatch()`
- **voice.ts** (49) — Desktop voice (dictation, wake word); mirrors `apps/desktop/src-tauri/src/voice.rs`. · `interface VoiceConfig, type VoiceActivity, interface VoiceModel, interface VoiceStatus, interface VoiceApi, HOTKEYS, megabytes`
- **voiceMeter.test.ts** (30)
- **voiceMeter.ts** (37) — Motion for the voice pill's level bars: the daemon-side mic sends a 0..1 loudness ~25 times a · `METER_REST, METER_STALE_MS, approach(), barProfile(), listeningHeight(), writingHeight()`
- **worktree.ts** (9) — Extra `session_start` fields: agents (not shells) in a git workspace get their own worktree when that is swit… · `useWorktreeStart()`
- **zoom.test.ts** (35)
- **zoom.ts** (63) — Interface size (desktop): the whole window's web view is scaled (Tauri `setZoom`), like a · `ZOOM_STEPS, ZOOM_MIN, ZOOM_MAX, clampZoom(), stepZoom(), zoomLabel, storedZoom(), useZoom, zoomKey()`

## packages/crypto/src/
- **index.test.ts** (107)
- **index.ts** (222) — NeuralAgent E2E encryption v1 (WebCrypto only). Twin of crates/na-crypto. · `b64(), unb64(), toHex(), fingerprint(), generateStaticKey(), exportPublic(), importPrivateRaw(), interface DerivedKeys, deriveKeys(), class Session, interface ClientHello, clientStart(), hostAccept()`

## packages/protocol/src/
- **apply.test.ts** (48)
- **apply.ts** (77) — Messages kept in the conversation with Neural (`KEEP` in crates/na-daemon/src/orch.rs). · `apply()`
- **client.test.ts** (137) — A transport the test plays the daemon on.
- **client.ts** (611) — `PROTOCOL_VERSION, CV_FEATURES, interface Transport, type Connect, type ConnStatus, PING_EVERY, PING_TIMEOUT, WAKE_TIMEOUT, SEND_STALL, SLOW_UPLINK, drainedBy, REQUEST_WAIT, class RequestError, interface TermSink` +4
- **cv.test.ts** (35)
- **cv.ts** (61) — A client's copy of a Claude session's conversation (or of one subagent's, see `attachCv`). · `interface Conversation, emptyConversation, fromAttach(), prepend(), applyCv(), sortTasks(), taskForTool()`
- **index.ts** (5) — `apply`

## packages/remote/src/
- **index.ts** (748) — Remote client for phones and browsers: the account at the relay, pairing, the relay · `interface Store, interface KeyStore, memoryStore(), localStore(), memoryKeyStore(), webKeyStore(), type AccountStatus, interface RelayUser, interface RelayDevice, class RemoteError, interface AccountOptions, class RemoteAccount, type LinkStatus, RELAY_PING_EVERY` +5
- **link.test.ts** (120) — Stands in for the browser's WebSocket; the test plays the relay.

## packages/ui/ui/
- **index.ts** (21) — Everything, for projects that install the whole library. Copy-in projects

## packages/ui/ui/components/ai/
- **AgentTrace.tsx** (197) — What the assistant is doing, above its answer — tools and thinking in one · `type StepState, interface TraceStep, traceLabel(), AgentTrace(), StatusLine()`
- **AssistantOrb.tsx** (24) — Luna's presence in chat: the voice orb, driven by assistant state. · `AssistantOrb()`
- **ChangePill.tsx** (39) — What an answer changed, as small pills under it ("Moved Gym to 18:00", · `interface Change, ChangePills()`
- **Composer.tsx** (342) — The assistant's input: a slim glass pill (44px on phones, 40 on desktop) · `type Attachment, interface ComposerHandle, interface ComposerProps, Composer(), SendButton(), ComposerDock()`
- **ConfirmCard.tsx** (60) — Approval before an external or irreversible action (send a mail, pay, · `type Decision, ConfirmCard()`
- **DiffCard.tsx** (100) — What a change did, line by line. Inline (one column, red out / green in) · `type DiffLine, diffLines(), DiffCard()`
- **EmptyChatHero.tsx** (47) — The first screen of a chat: the mark (or a small orb), a greeting that · `EmptyChatHero()`
- **Message.tsx** (116) — Messages. The user speaks in a bubble (right, tail at the bottom-right); · `UserBubble(), AssistantMessage(), type Feedback, MessageActions(), ChatDivider()`
- **ModelPill.tsx** (78) — Which model answers this chat. A quiet pill in the chat header that opens a · `interface ModelOption, ModelPill()`
- **QuestionCard.tsx** (107) — When the assistant needs a decision, it asks with options instead of a wall · `interface Question, interface Answer, QuestionCard()`
- **Sources.tsx** (108) — Sources make an answer checkable. Inline, a numbered citation sits where a · `interface Source, SourceIcon(), Citation(), SourceCards(), SourceStack()`
- **StreamingText.tsx** (77) — An answer as it streams: words arrive by colour (`.word-in`), never by blur · `StreamingText()`
- **Suggestions.tsx** (51) — Starting points for an empty chat. Suggestions are real next steps from · `interface Suggestion, SuggestionGrid()`
- **Thinking.tsx** (57) — "Working" indicators, quietest first. Use the one that matches what you · `type ThinkingVariant, ThinkingIndicator()`
- **ToolCallCard.tsx** (92) — A tool call as a first-class event, not a log line. Four states, one card: · `type ToolState, ToolCallCard()`
- **VoiceOverlay.tsx** (146) — Voice mode: the orb fills the screen's heart, a status word sits under it, · `type VoiceState, VoiceOverlay(), VoiceControl()`
- **Waveform.tsx** (94) — Voice level as bars. With `stream` (a MediaStream from getUserMedia) the · `Waveform(), requestMic()`
- **index.ts** (19)
- **stream.ts** (98) — Streaming helpers. Networks deliver tokens in bursts (a worker batches · `releaseStep(), toWordEnd(), useSmoothText(), useStable(), useLinger(), useElapsed()`

## packages/ui/ui/components/core/
- **Activity.tsx** (59) — Activity marks: one vocabulary for "what are the agents behind this item doing", · `type Activity, ACTIVITY_LABEL, ACTIVITY_RANK, topActivity(), ActivityMark()`
- **Avatar.tsx** (44) — Avatar: photo, or initials on a tile. With `color` the tile becomes a · `Avatar(), AvatarStack()`
- **Button.tsx** (131) — Buttons. Pill-shaped, light type, no glow. One action per view is `primary` · `type ButtonVariant, type ButtonSize, interface ButtonProps, Button(), type IconButtonVariant, IconButton()`
- **Chips.tsx** (85) — Chips filter, Pills label. Chips are buttons (h-control-sm: 36 on phones, quiet surfaces, scroll · `interface ChipOption, Chips(), ToggleChip(), type Tone, TONE, Pill()`
- **ConnectionPill.tsx** (34) — Calm connection indicator: a small material pill that drops in under the · `ConnectionPill()`
- **Feedback.tsx** (98) — States are part of the feature: empty, loading, error, live. · `Empty(), Callout(), StatusDot(), Spinner(), Skeleton(), SkeletonText(), SkeletonRow(), SkeletonList(), Kbd()`
- **Field.tsx** (81) — Inputs. Wells sunk into the page: a faint fill, an inner shadow from the · `inputClass, Field(), Input(), TextArea(), SearchField()`
- **List.tsx** (115) — Inset grouped list (iOS Settings) and its row. A surface lit from above, · `type SysColor, IconTile(), List(), interface RowProps, Row()`
- **Segmented.tsx** (58) — Segmented control (iOS): a filled capsule track and a lifted thumb that · `interface SegmentedOption, Segmented()`
- **Slider.tsx** (98) — Slider. A 4px track that fills in the place's colour, an 18px thumb that · `Slider()`
- **Stat.tsx** (41) — Figures. `Stat` is the small tile (a value over a label, in rows of 2–3); · `Stat(), Trend()`
- **Switch.tsx** (88) — Switch and Check. · `Switch(), Check()`
- **index.ts** (13)

## packages/ui/ui/components/data/
- **BarChart.tsx** (95) — Bar chart you can scrub. Thin bars (max 14px) with round ends, a quiet · `BarChart()`
- **Donut.tsx** (53) — Donut: shares of a whole. Segments keep small gaps and round ends, and draw · `interface DonutPart, Donut()`
- **Heatmap.tsx** (109) — Heatmaps: one colour, brightness = amount (five steps), always with a · `HeatLegend(), interface HeatDay, CalendarHeatmap(), GridHeatmap()`
- **Legend.tsx** (14) — `interface Series, Legend()`
- **LineChart.tsx** (98) — Line with a crosshair, and the Sparkline. Gaps (null) are skipped. A · `LineChart(), Sparkline()`
- **Meter.tsx** (51) — Usage meter: a thin bar that says how much of something is used. One · `Meter()`
- **Ring.tsx** (65) — Progress ring. One component for what used to be four (Home, charts, · `Ring()`
- **TickRing.tsx** (72) — Tick ring: a dial of 60 hairline ticks that light up one after another, · `TickRing()`
- **index.ts** (10) — `useScrub`
- **scrub.ts** (43) — Scrubbing a chart with mouse or finger. · `useScrub(), num`

## packages/ui/ui/components/effects/
- **Ambient.tsx** (80) — Ambient light at the top of a page: soft, two- or three-coloured light that · `type AmbientMotion, Ambient()`
- **AuroraField.tsx** (22) — AuroraField: the calm colour field behind the whole app. Three large soft · `AuroraField()`
- **Glass.tsx** (70) — Glass surfaces. · `GlassPanel(), LiquidGlass()`
- **LightBorder.tsx** (49) — Light border — the "Now" frame: a thin light runs around the edge and a · `interface LightBorderProps, LightBorder()`
- **Logo.tsx** (119) — NeuralHub mark "n.": one monoline stroke and a dot. The right leg stops · `N_PATH, N_DOT, MarkDefs(), LogoMark(), Wordmark()`
- **LogoIntro.tsx** (183) — Start intro "point of light" (≈ 2.3 s). A template for any brand intro: · `LogoIntro()`
- **LogoLoader.tsx** (32) — The mark at work: a short light runs along the "n" while the dot breathes. · `LogoLoader()`
- **Magnetic.tsx** (43) — Magnetic: the child leans towards the pointer while it is near, and springs · `Magnetic()`
- **Odometer.tsx** (49) — Odometer: every digit is a reel 0–9 that rolls to its place on a spring · `Odometer(), NumberTicker`
- **ParticleOrb.tsx** (304) — A particle sphere — presence for an assistant. It breathes when idle, bands · `type OrbMood, interface ParticleOrbProps, ParticleOrb()`
- **RevealText.tsx** (51) — Lines that rise out of a mask, as if set: for page titles and the one · `RevealText()`
- **Shimmer.tsx** (18) — "Working…" label with a light sweeping across it, compositor only (see · `Shimmer()`
- **Spotlight.tsx** (40) — Spotlight card: a soft accent light follows the pointer across the surface · `Spotlight()`
- **TaskCheck.tsx** (46) — Task check: done in three precise steps, 520 ms in all — the circle fills · `TaskCheck()`
- **TextScramble.tsx** (35) — Decode: characters cycle through glyphs and settle left to right into the · `TextScramble()`
- **VoiceOrb.tsx** (63) — Voice orb: a small glass sphere with light swirling inside. Small, it is a · `interface VoiceOrbProps, VoiceOrb()`
- **index.ts** (17)

## packages/ui/ui/components/layout/
- **AppShell.tsx** (117) — App frame: a floating glass sidebar on desktop, the glass Dock (tab bar) on · `type NavItem, interface Nav, AppShell()`
- **Dock.tsx** (180) — The Dock: the one bottom drop on phones ("Two Drops"), here as the tab bar. · `interface TabItem, signalOf, Dock()`
- **Island.tsx** (210) — The Island: the top drop on phone agent screens ("Two Drops"). One 44px floating capsule · `type IslandTone, Island(), IslandPanel()`
- **Page.tsx** (166) — A scrollable screen with a large title — and the one owner of page spacing. · `interface PageProps, BackButton(), Page(), Section()`
- **Sidebar.tsx** (340) — Desktop navigation: a glass island that floats off the window's edge — · `interface SidebarItem, Sidebar()`
- **TabBar.tsx** (3) — Old name of the phone Dock (see Dock.tsx). The liquid lens, refraction copy and More grid are gone. · `TabBar`
- **index.ts** (7)

## packages/ui/ui/components/overlays/
- **ActionSheet.tsx** (111) — Action sheet (phones): a choice rises from the bottom as an opaque card of · `ActionSheet(), ActionRows()`
- **CommandPalette.tsx** (224) — Command palette (⌘K / Ctrl+K): one field that reaches everything. · `interface Command, interface CommandGroup, fuzzyMatch(), useCommandShortcut(), CommandPalette()`
- **ConfirmButton.tsx** (117) — Confirm inside the button itself — no dialog. The first tap arms it: the · `ConfirmButton()`
- **ConfirmSheet.tsx** (47) — Confirm before something that is irreversible AND external: sending to · `ConfirmSheet()`
- **ContextMenu.tsx** (169) — iOS-style context menu. Touch: a long-press (420ms) lifts the item above a · `ContextMenu()`
- **Disclosure.tsx** (165) — Inline editing instead of a sheet. A row that opens its content right · `Disclosure(), interface PickerOption, InlinePicker()`
- **Menu.tsx** (183) — Menu for toolbars and rows (sort, filter, "more", account switch, any choice · `interface MenuEntry, menuKeys(), Menu()`
- **MenuList.tsx** (94) — The one look of every small menu (pull-down, context menu): an opaque · `MENU_SURFACE, menuHeight(), MenuItems()`
- **Sheet.tsx** (394) — Panel for tasks — writing a mail, adding an event, picking files. · `interface SheetProps, Sheet()`
- **Stack.tsx** (193) — Navigation stack inside a tab or pane (folder → subfolder → file, list → · `interface StackLevel, interface StackApi, useStack(), useStackNav(), Stack()`
- **SwipeRow.tsx** (152) — List row with iOS Mail-style swipe actions. Adapted from 21st.dev · `interface SwipeAction, swipeState, SwipeRow()`
- **Toast.tsx** (156) — Toasts: short confirmations with an optional Undo, floating above the tab · `type ToastTone, interface ToastItem, interface ToastOptions, TOAST_MS, TOAST_MAX, stackToasts(), interface ToastHandle, toast(), Toaster()`
- **geometry.ts** (30) — Overlays position themselves with `position: fixed`. Inside a transformed · `interface Box, frameOf(), toLocal(), pointToLocal()`
- **index.ts** (14)

## packages/ui/ui/lib/
- **chrome.test.ts** (76)
- **chrome.ts** (107) — Pure rules behind the phone chrome (keyboard, hide-on-scroll, toasts), kept free of · `type KeyboardPlatform, interface ViewportSample, interface KeyboardState, KB_MIN, keyboardState(), detectPlatform(), interface ScrollSample, interface HideState, HIDE_START, hideStep(), phoneToasts(), neighbour()`
- **cn.ts** (5) — Joins class names, skipping falsy values. No merging: components never need to override their own classes. · `cn()`
- **focus-trap.ts** (63) — Keyboard focus for sheets, dialogs and menus: Tab stays inside while open, · `focusableIn(), useFocusTrap()`
- **haptics.ts** (25) — One haptics API. Web: navigator.vibrate (Android Chrome; iOS ignores it). · `type Haptic, setHapticDriver(), haptic()`
- **hooks.ts** (76) — `useKeyboard, keyboardNow, DESKTOP, useMediaQuery(), useDesktop, useFinePointer, useReducedMotion, useKeyboardOpen(), useHideOnScroll(), useLatest(), MOD_KEY`
- **keyboard.ts** (97) — The on-screen keyboard, once for the whole app (C3): one listener set feeds a tiny store, · `keyboardNow, useKeyboard()`
- **layers.test.ts** (14)
- **layers.ts** (105) — Overlay stack for sheets, menus, context menus, search, lightboxes. · `configureLayers(), closedOnTop(), isTopLayer, openLayerCount, useLayer()`
- **motion.ts** (91) — Motion vocabulary. The dashboard grew 14 hand-typed spring pairs; they all · `SPRING, squashFor(), type SpringName, EASE, rise(), prefersReducedMotion(), TICK, springPoints(), pointAt()`
- **navigation.tsx** (132) — Phone navigation: where "back" goes, and how pages move. · `interface NavBack, NavBackProvider, useNavBack(), PUSH, NavPage()`
- **surface.tsx** (118) — Surface: where overlays portal to and which layout mode applies. · `type LayoutMode, Surface(), useLayoutMode(), usePortalTarget(), surfaceHeight(), useSurfaceHeight(), useKeyboardInset(), ShellProvider, useShell(), useWidthMode()`
- **tokens.ts** (103) — JS side of the tokens, for canvases, SVG and inline styles that cannot use · `color, GLOW, TAG_COLORS, SERIES, AMBIENT, type AmbientName, AMBIENT_POSE, SIGNALS, type Signal, PLACES, type Place, ACCENTS, type Accent, GLASS_LEVELS` +6

## scripts/
- **android-dev.sh** (16) — Local relay (test sign-in, real FCM if the service account exists) and a throwaway daemon for
- **changelog.d.mts** (20) — Types for scripts/changelog.mjs (imported by apps/web/vite.config.ts). · `interface ChangelogGroup, interface ChangelogRelease, CHANGELOG, GROUPS, parseChangelog(), readChangelog(), findRelease(), releaseMarkdown(), cutRelease()`
- **changelog.mjs** (124) — CHANGELOG.md as data. Used by the web build (changelog.json + the /changelog page), the release · `CHANGELOG, GROUPS, parseChangelog(), readChangelog, findRelease, releaseMarkdown(), cutRelease()`
- **changelog.test.mjs** (51) — node --test scripts/changelog.test.mjs (part of `pnpm test`)
- **check-docs.mjs** (101) — Docs guard: keeps the agent-facing docs pointing at things that exist.
- **check-tokens.mjs** (52) — Design contract check: app code uses design tokens only (packages/ui/DESIGN-CONTRACT.md).
- **codemap.mjs** (120) — Generates docs/CODEMAP.md: one line per code file with its purpose (first doc comment) and its
- **daemon-smoke.mjs** (108) — End-to-end smoke test for neuralagentd over its local WebSocket.
- **e2e-remote.ts** (501) — End-to-end test of remote access: a local relay (test login), a daemon that signs in to it,
- **e2e-swarm.ts** (151) — End-to-end test of a swarm: daemon + four stand-in agents (scripts/fake-agent.mjs) that hand a
- **fake-agent.mjs** (71) — A stand-in for an agent CLI in tests: no model, a fixed part per swarm role. It reads prompts
- **gen-protocol-index.mjs** (11) — Writes packages/protocol/src/gen/index.ts re-exporting every ts-rs generated type.
- **release-collect.mjs** (64) — Release CI: picks one platform's build outputs, gives them stable names and writes the part of
- **release-publish.mjs** (59) — Release CI: uploads every collected file to the relay and then publishes the merged manifest.
- **set-version.mjs** (50) — Sets the release version everywhere it lives: the Cargo workspace (daemon, desktop app, relay;
- **stage-daemon.mjs** (19) — Copies the release daemon to where the Tauri bundle picks it up as a sidecar

## scripts/dev/
- **call-test.mjs** (137) — Synthetic call against the daemon: streams 16 kHz wavs as a microphone would (real time),
- **chatty-agent.mjs** (79) — A talkative stand-in swarm member for UI checks (seed step `swarms`): on its brief it sends a
- **conn-repro.mts** (210) — Repro harness for the phone's "Reconnecting to the daemon…": local relay (test login) + throwaway
- **daemon.mjs** (128) — Talk to a test daemon from the command line (requests, sessions, Neural, usage).
- **env.mjs** (124) — A throwaway test environment for UI work: a test daemon (own NEURALAGENT_HOME) + the desktop
- **fake-cli.sh** (5) — Stand-in agent CLI for screenshots: ignores its args and gives a plain shell, so the daemon
- **fake-llm.mjs** (23) — Fake OpenAI-compatible streaming chat endpoint, so Neural answers without a real model.
- **install-local.sh** (44) — Installs a locally built NeuralAgent.app over /Applications and restarts app + daemon. · `pid()`
- **launch.mjs** (177) — Frame series of the launch sequence (a cold start) on each surface, to check that it is one
- **lib.mjs** (237) — Shared helpers for the dev/test tools in scripts/dev: repo paths, a safe test-daemon home, · `ROOT, DEV, sleep, DEFAULT_HOME, DEFAULT_VITE_PORT, realDataDir(), testHome(), daemonBin, relayBin, daemonInfo, readState, waitForFile(), connect(), redact` +12
- **montage.mjs** (12) — One labelled contact sheet from many screenshots (cheaper to review than many images).
- **seed.mjs** (113) — Demo data for screenshots in a test daemon: four workspaces, stand-in Claude/Codex/Gemini · `seed()`
- **shot.mjs** (148) — Screenshot driver for the desktop UI (dev.html) against a test daemon, at standard sizes in
- **swarm-real.mjs** (65) — A real swarm: four Claude Code (Haiku) members on a tiny task in a throwaway git repo.
- **web-push.mjs** (132) — Web Push in Chromium: the web remote (/app) against a local relay (test sign-in) + daemon, with
- **web-remote.mjs** (127) — The web remote (/app, also what the Android app loads) in a browser against a local relay
- **wv.mjs** (21) — Evaluate JS in the Android app's WebView over raw CDP and print the result + recent console.

## scripts/dev/macos/
- **build.sh** (14) — Builds the macOS input/window helpers into scripts/dev/macos/bin (git-ignored).
- **click.swift** (11) — Clicks at screen point x y (top-left origin), optionally moving there first for hover.
- **hold.swift** (16) — Holds Option+Space for N seconds (posts real key events, like a user would). · `key()`
- **holdf5.swift** (8) — Holds F5 for 2 s (the alternative dictation shortcut).
- **move.swift** (5) — Moves the mouse to screen point x y (hover tests).
- **sink.swift** (19) — A plain text window that takes focus, then writes what was typed into it to a file and quits.
- **winid.swift** (9) — Prints the window id(s) of an app by owner name, for `screencapture -x -o -l <id>`.

## scripts/dev/scenes/
- **alerts.mjs** (22) — Settings → Notifications: sound, notification, both or nothing for this device.
- **call.mjs** (22) — Call Neural in the browser with a fake microphone and log the call states.
- **claude-images.mjs** (91) — Pictures in the Claude view: a Read of an image, an MCP screenshot, two reads folded into a
- **home.mjs** (6) — The start page after load. Usage: node scripts/dev/shot.mjs home
- **nav.mjs** (67) — Navigation chrome: Settings (with Remote access and MCP servers inside; phones: the Settings
- **pages.mjs** (31) — Tour of the main pages. Seed first (env.mjs up --seed [--llm]).
- **phone.mjs** (66) — Phone shell (components/phone): the four tabs and the pages the phone router pushes.
- **swarm.mjs** (135) — The Swarm page, clicked through: list, each swarm, the feed scrolled, a member, the actions,
- **workspace.mjs** (59) — The workspace view: split panes (Gemini + Claude), the focused pane, the Chat/Terminal switch,
- **ws-menu.mjs** (37) — Desktop sidebar workspaces: the right-click menu, renaming in place, and dragging into a new order.
- **zoom.mjs** (33) — Interface size (desktop): the setting in Settings → Appearance and the "120%" that shows while

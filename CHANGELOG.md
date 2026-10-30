# Changelog

What changed in NeuralAgent, written for the people who use it. Newest first.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/). Every version has up to three groups: **New**,
**Improved**, **Fixed**.

This file is the source for the in-app update dialog, the website's `/changelog` page and the
release notes in the update manifest (`scripts/changelog.mjs` parses it). Rules for writing it:
`docs/RELEASING.md`.

## [Unreleased]

### Improved
- The desktop sidebar is short again when closed and grows to full height when you point at it.
- The changelog on the website is easier to scan: the newest release is open, older ones are short rows you can open, and links like `/changelog#v0-3-0` open that release.
- Agent icons are calm now: one quiet style instead of a colourful tile per agent, in workspaces, the "+" sheet and the agent lists. Colour is left for status: a light runs around an agent while it works, and a dot shows when it needs you, finished or failed.
- Chat or terminal for Claude is one clear switch in the workspace bar (on phones at the end of the agent strip) instead of a switch hidden in one pane. It applies to every Claude agent and only shows when a Claude agent is in view.

### Fixed
- Terminals no longer keep broken leftovers of Claude Code's screen after you resize the window or a pane.

## [0.3.0] - 2026-10-30

The phone round: NeuralAgent now feels made for phones, on the desktop too.

### New
- **Light mode**: every theme comes in light and dark; Appearance follows the system or your choice.
- **Launch animation** when the app opens, and a branded loader while it connects.
- **Update button**: your version shows above your account, and an Update button appears as soon
  as a new version is out, with what changed. The desktop app also asks once at start.
- **Changelog** on the website, in the update dialog and in Settings → Updates.
- The web remote and the Android app notice a newer web version and offer to reload.
- **Copy from the terminal**: select and press ⌘C / Ctrl+C on computers; on phones a copy button
  (or a long press) shows the terminal as selectable text with "Copy screen" and "Copy all".
- **Effort** can be chosen in the Claude view (Low to Max), next to the model.
- **Status at a glance**: a light runs around a workspace while its agents work, a pulsing dot
  means one needs you, orange means finished, red means an error.
- ⌘K opens a command palette on the desktop.
- Discord shows the NeuralAgent logo and a small status badge; links to the website get proper
  previews, and the web app has real icons.

### Improved
- **Phone navigation**: five clear tabs (Neural, Agents, Workspaces, Swarm, More), large titles,
  back buttons and swipe-back; menus open as sheets from the bottom and never get cut off.
- Nothing hides under the status bar or the camera notch any more, also in the installed web app.
- Bigger buttons, tabs and keys everywhere; the tab bar hides while the keyboard is open.
- **Claude view** rebuilt after Claude's own apps: answers in a reading serif, soft message
  bubbles, copy on every message, grouped tool calls with diffs, an "Allow once / Always allow /
  Deny" card above the input, and model, effort and permission-mode pickers.
- **Neural**: colourful home with your agents' activity as cards grouped by day; tap one to open
  it. Calling Neural opens a full-screen call with timer, mute and a centred call button.
- **Agents**: who needs you, who works, who is done; full titles, plain-text previews, swipe to
  stop, restart or close.
- **Swarm**: a list with a detail page per swarm; the new-swarm sheet works with the keyboard open.
- **Workspaces on phones**: one agent at a time under a calm header, big agent chips, all pane
  actions in one "…" sheet, and a "+" sheet with agent tiles. On the desktop: a cleaner tab strip
  and pane header with a Chat/Terminal switch.
- **Settings** is a list with coloured icons and one page per topic; on the desktop the list
  sits beside the page. Removing or signing out asks in a confirmation sheet.
- History, Usage and MCP servers: grouped lists, loading placeholders, clearer charts.
- The phone app stays connected while it is open and reconnects within a second or two after
  it comes back; a small notice only shows when the connection is really gone.

### Fixed
- Photos uploaded from a phone to the Claude view no longer fail; big photos are scaled down and
  a failed one can be retried with a tap.
- The Claude view shows the effort and mode the CLI really uses.
- Sheets on phones are no longer cut off when the keyboard opens.
- The Agents tab says why an agent waits ("Wants to use Bash") instead of the raw terminal menu.
- Side panels on the desktop are no longer see-through.
- Switching terminals often in Safari no longer leaves terminals blank.
- The desktop sidebar no longer moves its icons when it widens on hover; long names end in "…".

## [0.2.1] - 2026-10-30

### Fixed
- Phone and web access to your computer stopped working shortly after NeuralAgent 0.2.0 started.
  It now stays connected, and if the connection to the relay breaks it reconnects by itself.
- macOS: after an update the background service could wait many minutes on a hidden keychain
  prompt before it started. Your remote sign-in now lives in a file only your user can read.

## [0.2.0] - 2026-10-30

A new look, a chat view for Claude Code, and your whole computer in your pocket.

### New
- **Claude view**: a chat view on top of the real Claude Code CLI. Messages, tool cards,
  permission and question buttons, `/` commands and `@` files, model and mode controls, a context
  meter, images by paste or drop, and dictation. Switch any pane between terminal and Claude view.
- **Control your computer from your phone**: Neural and call voice, voice models, dictation and
  wake word, app updates and workspaces (with a folder browser) are all reachable from the web
  remote and the Android app.
- A new website at agent.neuralhub.dev with a live demo.

### Improved
- New design: a calm moving colour field behind glass surfaces, and smooth, springy motion.
- Your account (photo, name, email) sits at the foot of the sidebar with a small menu.
- macOS: drag the window from anywhere along the top edge, like a normal title bar.
- Calls with Neural on a phone use the earpiece by default; the speaker is one tap away.
- Phone and web pages reload themselves after your computer installed an update.

### Fixed
- Terminals keep the right size after switching windows, tabs or screen orientation.

## [0.1.2] - 2026-10-30

### Improved
- macOS: a one-line install command on the download page installs the app from Terminal
  without the "app is damaged" warning.

### Fixed
- macOS: the downloaded app could refuse to open because only part of it was signed.

## [0.1.1] - 2026-10-30

The first release.

### New
- Run Claude Code, Codex, Gemini and other coding agents side by side in a grid of terminals
  that keep running when you close the window or the app restarts.
- An agent catalog with one-click install, your own profiles, and live status for every agent:
  working, waiting for you, or done.
- An agents dashboard, a history of past Claude Code and Codex conversations you can resume, and
  usage and cost estimates with subscription limits.
- **Neural**, an assistant you can chat with or call. It starts agents, checks on them and tells
  you when one finishes or needs you. Bring your own model key.
- **Swarms**: teams of agents that hand work to each other.
- Local voice: hold a key to dictate into any app, "Hey Neural" wake word that learns your voice,
  and spoken replies. Everything runs on your computer.
- Git changes and diffs per workspace; each agent can work in its own worktree and merge back.
- A browser preview pane that finds your dev server's address by itself.
- MCP servers set up once for all agents.
- **Phone remote**: the web remote at agent.neuralhub.dev/app and an Android app, end-to-end
  encrypted and paired with a QR code. Push notifications when an agent needs you, an Android
  widget and quick-settings tile, and calls with Neural from the lock screen.
- Keeps your computer awake while agents work, a menu bar icon with agent counts, and optional
  Discord status.
- Six colour schemes with accent colours, chosen per device.
- Automatic updates for the desktop app; running agents keep running while it updates. The
  Android app tells you when a newer version is available.
- A download page with the newest build for macOS, Windows, Linux and Android.

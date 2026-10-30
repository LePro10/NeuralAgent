# Changelog

What changed in NeuralAgent, written for the people who use it. Newest first.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/). Every version has up to three groups: **New**,
**Improved**, **Fixed**.

This file is the source for the in-app update dialog, the website's `/changelog` page and the
release notes in the update manifest (`scripts/changelog.mjs` parses it). Rules for writing it:
`docs/RELEASING.md`.

## [Unreleased]

The phone round: the Android app and the phone layout should feel made for phones.

### Improved
- The phone app stays connected while it is open instead of reconnecting every minute or two.
- Nothing hides under the Android status bar any more; pages respect the screen's safe areas.
- Larger, clearer buttons and tabs on phones, with a calmer pane header.
- The Claude view on phones looks and feels closer to Claude's own apps; menus open fully on screen.
- The Claude view is rebuilt after Claude's own apps: answers in a reading serif, soft message
  bubbles, copy on every message, grouped tool calls with diffs, an "Allow once / Always allow /
  Deny" card above the input, and model, effort and permission-mode pickers (bottom sheets on
  phones, popovers on the desktop). Effort and mode now follow the CLI reliably.
- The Neural page has more colour: what your agents did is grouped by day as cards with each
  agent's icon, status and time; tap one to open that agent. One chip per swarm, and a clear
  "Set up Neural" card when no model is set.
- Calling Neural opens a full-screen call with a timer, a mute button and a red end button.
- Agents: a summary of who needs you, who works and who is done; full titles, plain-text
  previews, and swipe a row to stop, restart or close an agent.
- Swarm: a list of your swarms with a detail page per swarm (team, conversation, "send to").
  The new-swarm sheet works with the keyboard open: pick an agent per member, swipe to remove
  one, and the Start button stays in reach.
- History, Usage and MCP servers are tidier: grouped lists, loading placeholders, day sections
  in History (tap to resume), a cost-per-day chart, a bar per model and workspace, and an MCP
  editor with Save at the top.
- Charts, meters and sliders are readable in light mode.
- Workspaces on phones: one agent at a time under a calm header with the branch and changed
  files, big agent chips to switch (long-press to close or restart), all pane actions in one
  "…" sheet, and a "+" sheet with agent tiles. The terminal key bar has bigger keys.
- Workspaces on the desktop: a cleaner tab strip and pane header with a Chat/Terminal switch,
  a "…" menu, and split handles you can see while dragging.
- Settings on phones is a list with coloured icons that opens one page per topic (Appearance,
  Neural, Calls, Voice, Workspaces, Remote, Updates, Discord, Advanced, About); on the desktop
  the list sits beside the page. Appearance shows light and dark previews and accent swatches.
- Removing a workspace, a device, a profile or a voice model, signing out and discarding a
  worktree now ask in a confirmation sheet.
- Choosing a folder, the agent catalog and the changes sheet have bigger rows, breadcrumbs,
  search and clearer merge/discard buttons.
- The tab bar hides while the on-screen keyboard is open, so text fields sit right above it,
  and "Workspaces" fits fully in the tab bar.
- The version you run is shown above your account, and an **Update** button appears there as
  soon as a new version is out, with the changes since your version.
- The web remote and the Android app notice a newer web version and offer to reload.
- A changelog page on the website.

### Fixed
- Photos uploaded from a phone to the Claude view no longer fail.
- The effort level can be chosen in the Claude view.
- Sheets on phones are no longer cut off at the top when the keyboard opens.
- The Agents tab says why an agent waits ("Wants to use Bash") instead of showing the raw
  terminal menu.
- The Claude view shows the effort the CLI really uses from the start, not a guessed "High".
- "Scroll to latest" no longer stays up after the permission card closes.
- The Neural feed only marks an event as waiting while the agent still waits.
- Switching terminals often in Safari no longer leaves terminals blank.
- The desktop sidebar no longer moves its icons when it widens on hover, so a click lands
  where you aimed; long workspace names end in "…".
- The update dialog shows what changes right under its heading.
- Smaller layout fixes: the Neural agent chips line up with the feed, list headers align with
  their buttons, and the shell tile in the new-agent sheet reads "Shell".

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

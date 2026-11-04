# Changelog

What changed in NeuralAgent, written for the people who use it. Newest first.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/). Every version has up to three groups: **New**,
**Improved**, **Fixed**.

This file is the source for the in-app update dialog, the website's `/changelog` page and the
release notes in the update manifest (`scripts/changelog.mjs` parses it). Rules for writing it:
`docs/RELEASING.md`.

## [Unreleased]

### Fixed
- **Quit now really quits on macOS.** Quit from the Dock or with Cmd+Q stops NeuralAgent and its background service, so nothing old keeps running after an update. "Quit (agents keep running)" in the menu bar still leaves your agents running, and a service set to start at boot keeps running.

## [0.5.5] - 2026-11-04

### Fixed
- **The autopilot no longer stops working because of one badly written connector tool.** A connector tool with a wrong parameter type (for example "bool") used to make the AI provider refuse every request. Such mistakes are now repaired automatically, and a tool that cannot be repaired is skipped with a warning on the connector.
- The autopilot setup chat no longer repeats a question you already answered, says it cannot build a connector, or claims a running connector is missing. It also stays in your language.

### Improved
- The autopilot can now start building a connector for you when you ask for a new source in the chat, and always sees the current state of all connectors.
- When a connector is built, its check now tells the building agent exactly which tool parameter is wrong and how to fix it.
- **The Autopilot chat keeps your place.** Scrolling up while it works no longer throws you back to the bottom; a small "new" button takes you down when you want.
- **Setting up a connector happens in the chat.** When the autopilot builds or sets up a connector, a card appears right under its message: build progress, the login form, the test, "Use as source", or the way out if the build stopped.
- Autopilot errors are shown once, in plain words, with a "Details" button for the technical text and a link to the connector that is probably at fault.
- A connector shows a short note when one of its tools was skipped or repaired, on its page and in the chat card.
- Clearer first steps: the empty Inbox points you to connecting a source, and an empty Chat offers one-tap starters such as "Connect Discord".

## [0.5.4] - 2026-11-04

### Improved
- **Discord connector does more**: it also notices messages in threads, direct messages to the bot, new members and reactions (you choose which), can find messages, list roles and members, start threads and pin messages, and can note every action it takes with the reason in a log channel of your choice.
- A connector whose build stops halfway now keeps its last working version and offers Try again, Restore, Reset to template, Open folder and Check again; you can also pick which agent builds it.
- **Choose your default agent** in Settings → Agents (Claude Code, Codex, Gemini or any other you have): the autopilot, connector builds and Neural use it whenever they start an agent on their own.

## [0.5.3] - 2026-11-04

### New
- **Autopilot looks after your project.** Give a project an autopilot and tell it exactly what to do: read your Discord, GitHub issues, Reddit or your own app, sort what comes in, let an agent look at a bug and write the answer for you to send. It asks you first before it speaks for you, and it can set itself up in a short conversation if you are not sure what it should do. Run it on a schedule or just ask it ("look at all new Discord messages").
- **Connectors**: Discord, GitHub, Browser, Reddit, RSS feeds and any web API are built in. Need another one? Describe it and an agent builds it for you, with a setup form and a "Test connection" button. Existing MCP servers can be added too.
- **Browser extension for Chrome**: the autopilot reads pages in your normal Chrome, so sites see a normal browser.
- **Answers to your problem reports** arrive as a notification and under Settings → Privacy and support → Your reports.
- Workspaces on other computers over SSH: "Add workspace" now asks "This computer" or an SSH host (your `~/.ssh/config` hosts are listed, or type `user@host`). You browse its folders, and terminals and agents there work like any other workspace, also from your phone. Right-click a workspace → "Change folder…" switches it to another folder.

### Improved
- **Autopilot replaces Teams**: race, build + review and the older swarms are gone. The autopilot can still let one agent review another's work.

## [0.5.2] - 2026-11-02

### New
- **Your last dictations are kept** in Settings → Voice → Recent dictations: copy one, delete one or clear all. A long dictation is no longer lost when the app you spoke into drops it. The last 50 stay on your computer only.

### Improved
- **"Hey Neural" now starts a call with Neural**, the same as Call Neural: Neural answers out loud and you can keep talking. What you say in the same breath as "Hey Neural" is not lost. The call hangs up by itself after about 20 seconds of quiet.
- **A soft tone when "Hey Neural" is heard**, and the voice pill shows the call (listening, thinking, speaking) with a button to hang up.
- **"Learn my voice" guides you** through three short recordings and starts by itself when you turn on "Hey Neural". A second, looser check catches "Hey Neural" said quickly or unclearly.
- **Neural lets you finish your sentence in calls.** A short pause to breathe no longer cuts you off, and a sentence that stops on "and" or "ähm" waits for the rest.
- **"Hey Neural" is heard more often the first time** (tuned on test recordings: 17 of 18 instead of 13 of 18 for English voices, still no false wakes).
- **Neural answers out loud while its window is in the background** or closed to the menu bar.
- **The "Working…" animation runs smoothly**: the label no longer shakes and the orb no longer jumps when Neural starts or stops working.
- **Paste screenshots with Ctrl+V or ⌘V** everywhere: in the terminal, the Claude view and the phone's input line, in the app and in the browser. On Windows and Linux, Ctrl+V now pastes in the terminal like in Windows Terminal (Ctrl+Shift+V still works).

### Fixed
- **The terminal no longer scrambles when the same agent is open on your phone and your computer.** The device you use sets the terminal size; the other one shows it cleanly and takes it back as soon as you click or type there.
- **No more double frame** around the sidebar, sheets, the dock and menus in dark mode, most visible on Windows.

## [0.5.1] - 2026-11-01

### Fixed
- **Copy in the terminal works again.** Text you select in Claude Code (and other programs that use the mouse, like Codex, tmux or Neovim) lands on your clipboard right away, and ⌘C / Ctrl+Shift+C or right-click → Copy copies it again. When nothing is selected, the menu tells you how to select (⌥-drag on Mac, Shift-drag elsewhere, for the terminal's own selection).
- **Paste from the right-click menu** works in the desktop app without a browser prompt, and all copy buttons use the same reliable way to the clipboard.

## [0.5.0] - 2026-11-01

### New
- **Report a problem** from Settings → Privacy and support. You see exactly what is sent and choose whether the service log and your recent Neural requests are attached; you get a report id to quote.
- **Anonymous usage statistics** help decide what to improve: once a day, no prompts, code or names. You can see what is sent and turn it off in Settings → Privacy and support.

### Improved
- The privacy page explains the new usage statistics, problem reports and the cookieless visit counts of the website.

## [0.4.1] - 2026-11-01

### Fixed
- macOS: no more keychain password prompts after updates or when you change a setting. Your Neural keys now live in a file only you can read, like on Linux. After this update macOS may ask one last time to move them over; if you deny, enter the key again in Settings.
- macOS: after an update the app restarts like a normal launch, so the Dock no longer shows a second NeuralAgent icon.
- Starting NeuralAgent while it already runs brings the open window to the front instead of opening a second copy (macOS, Windows, Linux).

## [0.4.0] - 2026-11-01

The biggest update so far: a redesigned phone app, Neural that thinks along, Teams, Files, a background service that keeps your agents running, and a new website with a live demo.

### New
- NeuralAgent is now open source (AGPL-3.0). Anyone can read the code and suggest changes on GitHub.
- **Phone redesign**: four tabs (Agents, Neural, Projects, Settings). Every screen has its own address, so back (button, edge swipe, Android back, browser back) always goes one step back, and opening an agent on the phone no longer moves your computer's panes.
- **Agents inbox** on the phone: Needs you, Working, Done, with teams grouped. Answer a waiting agent (Allow / Deny / Reply) right in the list; the tab shows how many need you. A notification opens that agent's conversation at once.
- **New agent sheet** on the phone: pick project, agent and first prompt, optionally its own worktree, or start a team. Projects tab with a page per project (its agents, files, changes, past conversations).
- **Agent screen**: the agent fills the phone under one small floating bar. Tap it for the project, other agents and actions (stop, restart, rename, changes, copy id); swipe it to reach the next agent. Chat or Terminal is remembered per agent.
- **Command palette** with every Claude Code command grouped, plus your own commands, skills and plugins, with search, recents and argument hints. Fast mode switch in the model picker; `!command` runs a shell command, `# note` asks Claude to remember it.
- **Context and usage sheet**: real context size and cost, Compact, Start fresh, plan limits. Rewind to an earlier message (code, conversation, both or summarize) from its long-press menu.
- **Subagents and background work**: a small pill above the text field says what runs ("3 agents running · 1 shell"). Tap it for the list with status, time, last step and tokens; tap a row to read that subagent's own transcript. Each subagent is also a card in the conversation; nested ones show under the agent that started them, big fan-outs are grouped ("5 Explore agents · 3 running") and Back walks out one level at a time. Stop one background agent or shell, or all of them: it checks it has the right task first and never types over text you left unsent on the computer.
- Messages typed while Claude works show as queued chips with Send now and Edit.
- **Neural thinks along**: it keeps a list of tasks and follows them up. When an agent finishes it looks at what changed, runs the tests and tells you the result on its own, asks you only what it cannot answer itself, and notices agents that seem stuck. Choose how proactive it is: Active, Quiet or Off. Tasks cut off by a restart are marked as stopped and Neural tells you once.
- Neural's conversation is clean now: agent events no longer fill the chat. A panel shows its tasks, what it noticed and what it remembers (you can edit the notes). After a break, “While you were away” sums up what happened, and “Catch me up” asks Neural for the story.
- Neural asks before risky steps (deleting files, force pushing, publishing), also when they hide behind quotes, `;`, a new line or a trailing flag: you get Allow / Deny in the chat, and an Allow answers only the exact prompt you saw. "Yes, don't ask again" always needs you.
- **Teams** replace Swarm: give one goal to several agents. Race lets 2 to 4 agents try it in separate worktrees, Neural compares them and you keep the best ("Clean up worktrees" removes a finished race's leftovers after you confirm, never on its own); Build + review has a reviewer check the builder's work until it approves. Old swarms stay readable.
- **Files**: browse a project's folder from the desktop (a Files pane next to your agents) or the phone (Files on the project page). Sort, search, show hidden files, see git changes, open code with line numbers and colours, Markdown, pictures, PDFs, audio and video; big files open with their first part, UTF-16 and Latin-1 text read-only.
- Edit and save text files right in Files; if an agent changed the file meanwhile, you are asked before anything is overwritten. Add files from your phone into a project (refused with a clear message when the computer would run low on space), download or share files to the phone, copy a path or send it to an agent. On the computer: open in its own app or show in Finder.
- Phones only see approved projects. Settings → Remote access on the computer can allow the whole home folder (read only); key and token folders (`.ssh`, `.aws`, `.config`, …) and Desktop, Documents, Downloads and Library stay closed from the phone.
- **Settings → System**: see which macOS permissions NeuralAgent has, open the right place in System Settings with one click, or let "Set up all permissions" walk you through them. Choose whether the background service starts when you log in or already when the computer starts, and restart it from your phone.
- **Discord card you design**: presets (General, Stats, Detailed) or Custom, where you pick both lines and the image tooltip (agents, subagents, tokens today or this session, cost, model, agent CLIs, agent time today, your streak, files changed, project) plus party size "(2 of 5)", timer and button. A live preview in Settings shows exactly what Discord shows, and whether Discord is open. Project names stay private unless you turn them on.
- Music and other audio now drop to a quiet background level while you dictate, say “Hey Neural” or are in a call with Neural on the desktop, and fade back afterwards, also when the output device (e.g. AirPods) changes meanwhile. Switch and level in Settings → Voice → Other audio; on a Mac, calls lower Music and Spotify once you allow it. On Android, calls lower other audio too.
- **New website** at agent.neuralhub.dev: calm, fast, and the real app runs live in the page. Scroll through six chapters (agents side by side, a question answered from the phone, Neural, Teams, files and changes) and try it yourself: type to Claude, tap Allow on the phone and watch the computer continue. Made for phones too.
- **Live demo** at agent.neuralhub.dev/demo/: the real desktop and phone app against a simulated computer, in your browser, without an account or install. Your browser's data is never touched.
- The download page picks the right installer for your system and lists every build, first-start steps and requirements; the changelog is a timeline with a version index.

### Improved
- macOS no longer asks again for access to Documents, Desktop or Downloads after every update: the background service and its agents now count as NeuralAgent itself. Grant Full Disk Access once and remote work never stops at a dialog on the Mac. If the service stops unexpectedly, it starts again by itself.
- NeuralAgent uses much less memory on the Mac (about 1.3 GB down to well under 100 MB when idle): the dictation model is freed five minutes after its last use and comes back when you dictate or say "Hey Neural", calls and Claude dictation share one speech model, and freed memory goes back to macOS at once. Agents keep running exactly as before.
- Calls with Neural connect at once: the voice is prepared while the Neural page is open, and a cold start takes about a second instead of four.
- The call screen says "Connecting…" until your computer really listens and "Reconnecting…" when the connection drops; the call then continues by itself. Microphone problems are explained in plain words.
- Settings has a search field and clearer groups (Agents and tools, Computer); the same order on the computer, the web remote and phones. Agents, Profiles, a profile and an MCP server each open as a Settings page instead of a side panel; "Install agents…" anywhere opens Settings → Agents.
- The Claude composer on phones rests as one slim row; tapping it adds mode, model, commands, files and the context ring. Menus open out of the composer.
- Permission cards take the composer's place on phones, stay small with Show full, and let you tell Claude what to do instead. Plan approval and multiple-choice questions (tabs, multi-select, Other) look like Claude's own.
- The conversation: tool steps collapse into one quiet line ("Ran 6 commands, read 3 files"), edits show real diffs, notices (hooks, compaction, "Worked for 3m", errors) are quiet lines, and tables and code read well at 360 px.
- Scrolling stays at the end while Claude writes and stops following the moment you scroll up; a "N new" pill brings you back.
- Tap a message for Copy, Copy as Markdown or Select text. One picture viewer for every image in the chat.
- Calmer phone look: flat background, lighter titles, lighter glass on Android, and dim text now meets AA contrast in every colour scheme, light and dark. Lists and the agent chat fade out softly under the status bar and the floating bar.
- Failed agents say why in plain words (tap for the raw error). Hook calls no longer show as an agent's last line.
- Phone notices: at most one, at the top. No "finished" toasts, one calm pill when the computer is out of reach, update notice once per start.
- Android: Back walks back and minimises at the start; the keyboard no longer stays "stuck open"; status bar icons follow light and dark.
- Phones: the terminal has one compact key row above the keyboard; phone links can open one subagent directly (`#/agent/…/sub/…`), and its buttons are full finger size.
- The web remote works with a computer that still runs an older NeuralAgent: new parts (Files, Teams, Neural's tasks) simply do not show, and a request the computer does not know gets a clear "update NeuralAgent" error instead of waiting forever or dropping the connection.

### Fixed
- macOS: working from the phone no longer makes the Mac ask "NeuralAgent would like to access Documents" (or Desktop, Downloads, iCloud Drive, other volumes). Without Full Disk Access such folders show as "Needs Full Disk Access on the Mac" in the folder picker and Files, and background checks and Neural leave them alone, unless the Mac already allowed it.
- "Working" is reliable again when Claude Code uses a status line.
- A tool result is no longer lost when a hook line sits between the call and its result.
- An answer can no longer land on a newer question, and phone actions can no longer press Enter into an open permission dialog.
- Two quick agent switches on the phone land on the second agent; closing two sheets at once leaves no stray back step.
- Errors from answering, Send now and mode switches show a short message.
- Desktop: pasted text starting with "#" or "!" stays text.
- Settings values that do not fit move under their label; phone lists say "Connecting to your computer..." instead of "No agents yet". Editing a profile or an MCP server on the phone no longer pops up the keyboard by itself, and "Delete server" looks like the other delete buttons.
- Calls: hanging up while the call was still starting and calling again no longer ends the new call; a call taken over by another device says so; a computer that never gets ready ends the call after 45 s with a reason instead of "Connecting…" for good.
- Android calls: media plays at normal volume again afterwards instead of staying in call mode; the call's audio settings and the music ducking are released when the app is closed or reloaded mid-call; a headset connected during a call takes the sound; a real phone call puts the call with Neural on hold ("On hold during your phone call") and it resumes afterwards; starting a call without the microphone permission or hanging up right as it starts no longer crashes the app.
- Discord: "Live on Discord" now goes away within about a minute after Discord quits, and a Discord that stops answering can no longer freeze the status; it reconnects when Discord is back.
- Stopping NeuralAgent's background service takes at most a few seconds instead of up to a minute.

## [0.3.4] - 2026-10-30

### Improved
- The **Update** button is filled with your theme's accent colour, shows a download arrow, and unrolls smoothly into a pill when the sidebar opens.
- **Workspaces in the sidebar**: right-click one to rename it right in place (its folder stays the same), pin it to the top, copy its folder path or remove it; drag workspaces to change their order.
- **Notifications** in Settings: choose per device whether a finished agent (or one that needs you or failed) plays a sound, shows a notification, both or nothing — on the desktop, in the browser and on the phone. No sound while you are looking at that agent; in front but elsewhere, a small note with Open.

### Fixed
- macOS: after an update, NeuralAgent stays pinned in the Dock instead of showing up as a second icon.
- macOS: the app now has a fixed signature, so Accessibility and microphone permissions stay granted after updates (grant them one last time after this update).

## [0.3.3] - 2026-10-30

### Improved
- The listening pill at the bottom of the screen now follows your voice: its bars rise and fall with how loud you speak while you dictate or after "Hey Neural", stay calm when it is quiet, and settle into a gentle shimmer while your words are written out.

### Fixed
- Dictation into a terminal types the whole text again instead of only the first letter.

## [0.3.2] - 2026-10-30

See the images Claude reads, a clean start everywhere, a new Swarm view and calls that work again.

### New
- Interface size on the desktop: make text and controls bigger or smaller in Settings → Appearance (80% to 150%), or with ⌘+ and ⌘− (Ctrl on Windows and Linux), ⌘0 for 100%, ⌘ with the scroll wheel, or a pinch. The app remembers the size and opens with it.
- The Claude view shows the pictures Claude looks at: when it reads an image or a tool takes a screenshot, you see the picture right under the step instead of "[image]", and images you pasted show above your message. Tap one to see it full screen, zoom in (pinch, double tap or scroll wheel), copy or save it; swipe down or press Esc to close. On your phone the pictures load only when you scroll to them and come in a smaller size, so long conversations stay quick.

### Improved
- Opening the app is one calm motion on the Mac, in the browser and on Android: the NeuralAgent mark appears in your light or dark look right away, lights up once and fades into the app. No more black or white flashes, spinners or "not connected" screens in between; only if your computer really does not answer after a few seconds does it say so, with Try again.
- Settings looks like the rest of the app: the same large title, background light and widths, with the section list on the left and the chosen section on the right. Remote access and MCP servers now sit inside it in the same style.
- The closed sidebar opens sooner when you rest the pointer on it, and stays closed when you just move across it.
- The update button in the closed sidebar is centred exactly under the other icons and grows smoothly into the "Update" button.
- Swarm on the desktop is redesigned: the same header as the other pages, your swarms on the left, and the open swarm on the right with its goal, status and running time, Stop and Terminals buttons, the team beside the conversation (each member with its agent and what it is doing; click one to open its terminal) and the message box at the bottom.
- The swarm conversation is easier to read: a member's name once per run of messages, an arrow to whom it went, times on the right, messages to you highlighted, quiet initials instead of a colour per member, and a button that jumps back to the newest message when you scrolled up.
- "New swarm" opens as a centred window on the desktop, with Cancel and Start, and each member shows the icon of its agent.

### Fixed
- Calling Neural from the desktop app works again (it failed with "Not allowed by CSP").
- Saying "Hey Neural, …" now sends what you said to Neural instead of only showing it.
- Swarm: the goal and the team no longer scroll out of view in a long conversation, the "New swarm" button sits next to the title instead of floating above it, and an ended swarm without messages no longer says the team is getting ready.

## [0.3.1] - 2026-10-30

Calmer, more colourful: your accent is back, the icons are quiet, and Settings holds everything.

### Improved
- The desktop sidebar is short again when closed and grows to full height when you point at it.
- The changelog on the website is easier to scan: the newest release is open, older ones are short rows you can open, and links like `/changelog#v0-3-0` open that release.
- Agent icons are calm now: one quiet style instead of a colourful tile per agent, in workspaces, the "+" sheet and the agent lists. Colour is left for status: a light runs around an agent while it works, and a dot shows when it needs you, finished or failed.
- Chat or terminal for Claude is one clear switch in the workspace bar (on phones at the end of the agent strip) instead of a switch hidden in one pane. It applies to every Claude agent and only shows when a Claude agent is in view.
- The app background glows in your colours again: soft light in your accent and theme colours behind every page, the launch screen and the phone status bar, in light and dark mode. Each accent and theme now looks clearly different.
- Settings, the More page and the account look calmer: plain grey icons instead of colourful tiles, and Settings is grouped into clear sections.
- Remote access and MCP servers now live in Settings instead of having their own places in the sidebar. Old links still open them.
- Clicking your profile picture in the sidebar opens Settings straight away.
- The version now sits above your account in the sidebar. When an update is ready, a small update button shows there and turns into an "Update" button when the sidebar opens.

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

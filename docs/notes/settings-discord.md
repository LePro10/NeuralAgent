# Settings structure and Discord presence (D71, D72)

## Settings structure (D71)
- **Every section is a page.** Nothing in Settings slides in from the side any more: Agents,
  Profiles and MCP servers are sections; editing a profile or a server is a detail page
  (`useSettingsNav().push(key, title, node)` / `.back()`). Phones push
  `#/settings/<section>/<detail>`, desktop shows the detail in the right column with a back
  button; Escape goes back. Only confirmations stay `ConfirmSheet`s.
- **Reloads**: a section may rebuild a detail from its key (`SectionDef.detail`). Profiles do
  (`new`, `p-<id>`); other details fall back to their section.
- **"Install agents…"** anywhere (`useCatalogSheet().setOpen(true)`, unchanged for callers):
  `AgentCatalog.tsx` is now a redirect to Settings → Agents. Phones push the page in the current
  tab (back returns), desktop switches to Settings. Installs run in the workspace you came from
  (`rememberInstallTarget`), else the first one.
- **Groups** (same order everywhere; remotes put "This device" first and name the host group):

  | Desktop | Phone / web remote |
  |---|---|
  | Appearance, Notifications | This device: Account and devices, Appearance, Notifications |
  | Neural and voice: Neural, Voice, Calls | *host name*: Neural, Voice, Calls |
  | Agents and tools: Agents, Profiles, MCP servers, Workspaces | same |
  | Computer: Remote access, System (agent `sys`), Discord, Advanced | Computer: System, Discord, Advanced |
  | Updates, About | Updates, About; Activity: History, Usage (phone) |
- **Search**: a field on top of the section list (desktop sidebar column, phone tab root)
  filters by title, keywords (`SectionDef.keywords`) and group label (`matchesQuery`).
- Code: `components/SettingsPage.tsx` (sections, search, shells), `components/settings/nav.ts`,
  `components/settings/AgentsPanel.tsx` (Agents, Profiles), `McpPage.tsx` (editor page),
  `ProfileEditor.tsx`.

## Discord presence (D72)
What Discord can show for an app: two text lines (`details`, `state`), a big image with a
tooltip, a small badge image with a tooltip, an elapsed timer, a party size after the second
line ("(2 of 5)") and up to two buttons (shown to others, not on your own profile). Lines are
2..128 characters. Discord accepts about 5 updates per 20 s; we send at most one per 15 s.

- **Presets** (`discord_presence`): Off · General ("Working with AI agents") · Stats (agents,
  tokens today, streak; never a name) · Detailed (project, agents, model) · Custom
  (`Settings.discord`). Any change to a part switches to Custom, starting from what shows.
- **Stats** (`DiscordStat`), each with an example in `lib/discord.ts`: activity, agents
  ("3 agents · 2 working"), subagents ("4 subagents running", from the Claude view's task list:
  `ClaudeView::subagents_running`), project ("In website" only with `project_names`), files
  changed (workspace git summary), model ("Opus 5.5", `discord::model_label`), agent CLIs
  ("Claude Code + Codex"), tokens this session (running agents' conversations), tokens today and
  cost today (usage rows of today: every Claude Code / Codex conversation), agent time today
  (finished busy time plus the running stretches), streak (days in a row with agent work, today
  counts once an agent works), none.
- A stat with nothing to say (no subagents, no tokens yet) is left out; the first line then falls
  back to the activity. A second line equal to the first is dropped. Party size needs a second
  line, so it adds "Agents working" when there is none.
- **Preview**: `discord_preview {presence?, options?}` → `DiscordPreview { card, sample,
  connected, shown, next_in_ms }`. With no agent running, `card` is built from two made-up agents
  in the most recent workspace (`sample: true`). The panel polls it every 3 s and draws a Discord
  profile with the app's tokens (`ProfileCard` in `components/settings/DiscordPanel.tsx`); the
  status line says "Live on Discord", "On Discord in 9 s", "Discord is not open on …" or that it
  is an example.
- **Thread** (`discord.rs`): connects while presence is on (so "connected" means Discord runs),
  retries every 20 s, sends only the newest card, clears at once when off or idle.
- The daemon tick builds the card every 333 ms; today's usage is summed at most every 10 s with a
  `try_lock` (`Usage::try_rows`), so the first usage scan after a start never blocks the tick.
- Old daemons: no `settings.discord`; the panel shows the three old presets and no preview.
- Tests: `cargo test -p na-daemon discord` (every preset, every stat, fallbacks, rate limit,
  streak, formatting, the example card), `lib/discord.test.ts`. A real Discord check:
  `cargo test -p na-daemon shows_in_discord -- --ignored --nocapture` with Discord running.
- Screens: `node scripts/dev/shot.mjs settings`.

## Ideas not built
- "Agents shipped today" (turns finished): the daemon does not count finished turns yet.
- Lines changed: the git summary has changed files only; diff stats are computed on demand.
- A second button ("Watch my agents", a public link) once there is something public to link to.

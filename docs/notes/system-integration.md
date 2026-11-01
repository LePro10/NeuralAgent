# System integration: permissions, the service host, autostart (D58-D60)

How NeuralAgent fits into macOS, Windows and Linux so that remote work from the phone never waits
for a dialog on the computer's screen, and so that the service is there after a reboot.

Code: `apps/desktop/src-tauri/src/{service,autostart,permissions,system}.rs` (desktop side),
`crates/na-daemon/src/{service,permissions}.rs` (service side), UI
`packages/app/src/components/settings/SystemPanel.tsx` (Settings → System), terminal helper
`scripts/macos-permissions.sh`.

## Why prompts came back after every update (root cause)

macOS TCC (privacy permissions) charges every file access to the *responsible process*, not to the
process that does it. A child inherits its parent's responsible pid; when that pid has exited,
macOS treats the process as responsible for itself (checked with `responsibility_get_pid_responsible_for_pid`).

Up to 0.3.4 the app spawned `neuralagentd` from `<data>/bin/neuralagentd-<version>` and the
service outlived the app (by design: agents keep running through app restarts and updates). After
the first app restart, the service and every agent it started (Claude Code, git, the login shell)
were their own responsible process: a bare binary at a versioned path. TCC knows that as a new
"app" for every version, with no grants, so the first access to Documents/Desktop/Downloads/iCloud
after an update opened a dialog on the Mac — which nobody on the phone can answer.

Signing was not the problem: the bundle and both binaries are signed with the stable
"NeuralAgent Code Signing" identity; the designated requirement is
`identifier "dev.neuralhub.neuralagent" and certificate root = H"ce48…"` and stays the same across
releases (`scripts/macos-permissions.sh check`).

## The host (D59)

`neuralagent --service --mode app|login|boot` is the app's own signed main executable running
without a window. It

- is spawned by the app with `responsibility_spawnattrs_setdisclaim` (macOS: it becomes its own
  responsible process, so macOS counts it — and the service and every agent under it — as
  "NeuralAgent", the bundle identity that keeps its grants across updates);
- holds `<data>/host.lock`, writes `<data>/host.json` (`pid`, `mode`, `started_at`, `restarts`,
  `app`, `version`) and logs to `<data>/logs/host.log`;
- starts the service (`install_binary` as before), waits for it, and acts on how it ended:

| Marker in `<data>` | Who writes it | Host does |
| --- | --- | --- |
| none, exit/crash | — | start again, backoff 1 s … 60 s (reset after 5 min of running) |
| none, exit code 3 | — (another service holds `daemon.lock`) | watch it, look again every 2 s (never a tight start loop) |
| `host.restart` | service (`HostRestart`), app (`daemon_upgrade`) | `exec` the newest installed app (same pid on Unix, so launchd and TCC see the same job); if that fails for 30 s (app deleted, update half-swapped), keep running this version |
| `host.stop` | app ("stop agents" on quit) | idle until the marker is gone (the app removes it when it starts the service again) |
| `host.handover` | boot service, once the user is logged in and no agent runs | release the lock so the login host takes over; take it back when that ends |

A second host waits for the lock (`app` mode gives up after 20 s); a healthy service started by
an older app is watched, not replaced: the app starts a host for it when none runs, and a
`host.restart` written while the host only watched (the post-update switch) makes the host `exec`
the newest app first. When the app is gone (deleted, moved, an unmounted quarantine copy), the host
restarts the service from its versioned copy in `<data>/bin`. `NEURALAGENT_NO_HOST=1` makes the app spawn the service
directly (old behaviour, for debugging). Windows runs the host from a copy in
`<data>/bin/neuralagent-host-<version>.exe` so updates can replace the installed exe.

The service learns how it runs from `NEURALAGENT_HOST_MODE` and `host.json`, answers
`host_system` (`HostSystem`: started, booted, mode, restarts, before login, Full Disk Access,
warnings) and `host_restart`; both are gated on feature `host_system` in `HelloOk.features`.

## Permissions (D58)

One grant matters for remote work: **Full Disk Access** for NeuralAgent. It covers Documents,
Desktop, Downloads, iCloud Drive, removable and network volumes for the app, the service and every
agent, and survives updates (stable designated requirement). The others are local features:
Accessibility (dictation types text), Microphone (dictation, wake word, calls; there is no
"always allow" for it other than the grant), Screen Recording (optional), Automation (per target
app, asked on first use; music ducking).

Status is read without ever prompting: Full Disk Access by opening TCC.db, Accessibility
`AXIsProcessTrusted`, Screen Recording `CGPreflightScreenCaptureAccess`, Microphone
`AVCaptureDevice authorizationStatusForMediaType:`. Settings → System lists them live, opens the
right pane per permission (`x-apple.systempreferences:…Privacy_AllFiles` etc.; for Full Disk
Access Finder also shows the app to drag in), walks through all missing ones ("Set up all
permissions", polls and moves on by itself), and repairs a stale entry (`tccutil reset <Service>
dev.neuralhub.neuralagent`, then ask again). A notification after start says when a permission
that was on last time is gone (`<data>/permissions.json`). Phones see the same list read-only via
`host_ui` "system.status" and the service's warnings via `host_system`.

### No dialog from remote or background work (the folder guard)

Without Full Disk Access the service never opens a folder macOS guards on behalf of a phone, a
browser, Neural or its own background work: `~/Desktop`, `~/Documents`, `~/Downloads`, iCloud
Drive (`~/Library/Mobile Documents`), `~/Library/CloudStorage`, other apps' data
(`~/Library/Containers`, `~/Library/Group Containers`), `~/Music`, `~/Pictures`, `~/Movies` and
`/Volumes/*`. Code: `crates/na-daemon/src/permissions.rs` (`Guards`, `Gate`, `check`).

- **Which folder**: `Guards::root_of` walks a path from `/` down, compares each step by name in
  any case (also `ſ`, Kelvin sign) and by device + inode, follows links itself (relative,
  absolute, chains, loops end after 40) and stops at the first guarded folder. It never looks
  inside one: a stat of `~/Documents` itself is a lookup in Home and asks nothing; `canonicalize`
  of `~/Documents/x` would already ask, so nothing resolves a path before the gate.
- **When it is open**: Full Disk Access on (or not macOS); the desktop window asked (the user is at
  the computer and can answer); an agent runs in that guarded folder; or the service already read
  in it (macOS answered "allow"). Those answers are kept per guarded folder in
  `<data>/folder-access.json` when the host runs the service (D59, same identity across updates),
  else in memory; a "not permitted" removes the entry.
- **Shut**: requests answer `Forbidden` "Needs Full Disk Access on the Mac. …" (`NEEDS_FDA`).

Sweep of the daemon (what can touch a folder for a remote request or in the background):

| Path | Guard |
| --- | --- |
| Folder picker `fs_list`, `fs_roots`, `fs_mkdir` (`fsbrowse.rs`) | Gate before resolving; guarded entries come back `needs_fda: true` (locked row in `FolderBrowser.tsx`) and no `.git` probe inside a guarded folder for anyone. |
| Files `file_*` (`files.rs`) | Gate on the requested path; a workspace in a shut folder is a `shut` root, never resolved. |
| `workspace_add`, `session_start`/`restart`, `swarm_start`, `git_changes`/`git_diff`, `worktree_merge`/`discard` | `permissions::check` after `policy::check` (core.rs), for every non-desktop client incl. Neural. |
| Git badges (`refresh_git`, background) | `folder_gate(None)`: skipped where shut. |
| Neural: `find_folder` scan of `~/Documents`, `~/Desktop`, …; its folder check; agent change sizes; `agent_changes`; check commands | `folder_ok` (orch.rs, neural/mod.rs, neural/tools.rs). |
| Claude view for a finished agent: project commands/skills, `@` file list, Markdown files of the project | `folder_ok` on the session folder (claude_view.rs). |
| Transcripts, usage and history scans (`~/.claude`, `~/.codex`), uploads for agents (`<data>/uploads`), audit, models | Not guarded folders: nothing to do (a `CLAUDE_CONFIG_DIR` inside Documents is not handled). |
| Agents themselves | Their own processes: covered only by Full Disk Access, which is why the System page asks for it. |

Other systems: Windows has no per-app file privacy (only Microphone/Camera under
`ms-settings:privacy-microphone`, status unknown from the API; the service binds 127.0.0.1 only,
so no firewall prompt). Linux has none (Flatpak portals are not used). The list is empty there.

## Autostart (D60)

Settings → System → "Start the background service automatically": Off / at login / at boot, and
"Open the window at login". Switching off only removes the entries; it never stops a running
service, and launchd never unloads the host that runs the service right now (that would leave the
service and its agents without "NeuralAgent" until they restart): a login or boot host that is
running stays loaded until the next login or boot. Only what changes is touched; entries pointing
at another copy of the app are rewritten on the next status (`stale`). Autostart refuses an app run from a disk image or quarantine copy.

| | At login | At boot (before login) | Window at login |
| --- | --- | --- | --- |
| macOS | LaunchAgent `~/Library/LaunchAgents/dev.neuralhub.neuralagent.service.plist` (`KeepAlive`, `LimitLoadToSessionType Aqua`, `AssociatedBundleIdentifiers`) | LaunchDaemon `/Library/LaunchDaemons/dev.neuralhub.neuralagent.boot.plist` with `UserName`, installed with one administrator prompt (`osascript … with administrator privileges`); the login agent is installed too | LaunchAgent running `open -a` |
| Windows | `HKCU\…\Run` | Task Scheduler task `NeuralAgent\Service at startup` (BootTrigger, S4U, restart on failure), one UAC prompt | (same Run key, window) |
| Linux | systemd user unit `neuralagent.service` (`Restart=always`, `KillMode=process`) | the same unit + `loginctl enable-linger` (pkexec) | XDG autostart entry |

Honest limits of "at boot", shown in the UI:
- macOS before login: the login keychain is locked, so Claude Code (keeps its login there) and
  saved Neural keys work only after login; no microphone or GUI. When the user logs in and no
  agent runs, the boot service hands over to the login service (`host.handover`).
- FileVault: a restarted Mac waits at the unlock screen; nothing runs until then. Use
  `sudo fdesetup authrestart` for planned restarts.
- Windows S4U: no network shares or stored credentials before sign-in.
- Linux before login: no session bus, keyring or audio.

Tests: `cargo test -p neuralagent-desktop` (plans and generated plists/units/XML per OS, `plutil
-lint`, a disclaim test that checks the responsible pid of a child and grandchild),
`cargo test -p na-daemon service permissions`. Dry run of every install step without touching the
system: `NEURALAGENT_SERVICE_ROOT=/tmp/x` re-roots all paths and logs commands to
`/tmp/x/commands.log`.

## Checking by hand

```
scripts/macos-permissions.sh            # app, signature, host, autostart, last seen permissions
scripts/macos-permissions.sh check      # designated requirements (exit 1 on ad hoc)
scripts/macos-permissions.sh setup      # open the panes one by one
```
A test host that never touches the real install:
`NEURALAGENT_HOME=/tmp/na-x NEURALAGENT_DAEMON_BIN=… target/debug/neuralagent --service --mode login`
(run it from a binary outside `~/Documents`, or macOS asks the test binary for Documents access).

## Uninstall

Switch autostart to Off in Settings → System first, then "Quit NeuralAgent and stop agents", then
delete the app. Entries left behind by an app that is already gone (launchd would keep trying to
start a missing program every 10 s):

```
# macOS
launchctl bootout gui/$(id -u)/dev.neuralhub.neuralagent.service; launchctl bootout gui/$(id -u)/dev.neuralhub.neuralagent.window
rm -f ~/Library/LaunchAgents/dev.neuralhub.neuralagent.*.plist
sudo launchctl bootout system/dev.neuralhub.neuralagent.boot; sudo rm -f /Library/LaunchDaemons/dev.neuralhub.neuralagent.boot.plist
tccutil reset All dev.neuralhub.neuralagent          # forget the permissions
rm -rf ~/Library/Application\ Support/dev.neuralhub.neuralagent   # data, logs, service copies
# Windows (admin for the task)
schtasks /Delete /TN "NeuralAgent\Service at startup" /F
reg delete HKCU\Software\Microsoft\Windows\CurrentVersion\Run /v "NeuralAgent Service" /f
# Linux
systemctl --user disable --now neuralagent.service; rm ~/.config/systemd/user/neuralagent.service
loginctl disable-linger; rm -f ~/.config/autostart/neuralagent.desktop
```

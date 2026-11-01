#!/bin/bash
# NeuralAgent and macOS permissions (TCC), from a terminal. See docs/notes/system-integration.md.
#
#   scripts/macos-permissions.sh [status]     what is installed, how it is signed, how the service runs
#   scripts/macos-permissions.sh check        exit 1 when the app's signature or designated requirement
#                                             would make macOS forget permissions after an update
#   scripts/macos-permissions.sh setup        open each System Settings pane in turn (press Enter between)
#   scripts/macos-permissions.sh open <pane>  fda | accessibility | microphone | screen | automation | login
#   scripts/macos-permissions.sh reveal       show NeuralAgent.app in Finder (to drag it into a list)
#
# Read-only apart from opening System Settings / Finder: it never resets, grants or restarts
# anything. A terminal cannot read another app's permission state (that needs Full Disk Access for
# the terminal); the app shows it live in Settings → System, and records what it saw last in
# <data>/permissions.json, which `status` prints.
#
# Env: NEURALAGENT_APP (default /Applications/NeuralAgent.app), NEURALAGENT_HOME (data dir).
set -u

APP="${NEURALAGENT_APP:-/Applications/NeuralAgent.app}"
ID="dev.neuralhub.neuralagent"
DATA="${NEURALAGENT_HOME:-$HOME/Library/Application Support/$ID}"
PANE="x-apple.systempreferences:com.apple.preference.security?Privacy_"

pane_url() {
  case "$1" in
    fda) echo "${PANE}AllFiles" ;;
    accessibility) echo "${PANE}Accessibility" ;;
    microphone) echo "${PANE}Microphone" ;;
    screen) echo "${PANE}ScreenCapture" ;;
    automation) echo "${PANE}Automation" ;;
    login) echo "x-apple.systempreferences:com.apple.LoginItems-Settings.extension" ;;
    *) return 1 ;;
  esac
}

json_get() { # file key → value (no jq needed)
  /usr/bin/plutil -extract "$2" raw -o - "$1" 2>/dev/null
}

signature() {
  local what="$1"
  echo "  $what"
  if ! /usr/bin/codesign --verify --strict "$what" 2>/dev/null; then
    echo "    signature: INVALID or missing"
    return 1
  fi
  local info dr
  info=$(/usr/bin/codesign -dvv "$what" 2>&1)
  dr=$(/usr/bin/codesign -d -r- "$what" 2>&1 | sed -n 's/^designated => //p')
  echo "    identifier: $(sed -n 's/^Identifier=//p' <<<"$info")"
  echo "    authority:  $(sed -n 's/^Authority=//p' <<<"$info" | head -1)"
  echo "    team:       $(sed -n 's/^TeamIdentifier=//p' <<<"$info")"
  echo "    requirement: $dr"
  # macOS keeps a grant across updates when the designated requirement stays the same. A
  # requirement that pins the exact build (cdhash) changes with every update: ad-hoc signing.
  if grep -q "cdhash" <<<"$dr"; then
    echo "    PROBLEM: ad-hoc signature (cdhash): every update looks like a new app to macOS"
    return 1
  fi
  return 0
}

status() {
  echo "App"
  if [ ! -d "$APP" ]; then
    echo "  not found at $APP (set NEURALAGENT_APP)"
  else
    echo "  $APP, version $(defaults read "$APP/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null)"
    case "$APP" in
      */AppTranslocation/* | /Volumes/*) echo "  PROBLEM: runs from a disk image or quarantine copy: move it to /Applications" ;;
    esac
    signature "$APP" >/dev/null 2>&1 && echo "  signature: ok (stable requirement)" || echo "  signature: see 'check'"
  fi

  echo "Background service"
  if [ -f "$DATA/host.json" ]; then
    local pid mode since
    pid=$(json_get "$DATA/host.json" pid)
    mode=$(json_get "$DATA/host.json" mode)
    since=$(json_get "$DATA/host.json" started_at)
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      echo "  kept running by the NeuralAgent host (pid $pid, mode $mode, since $(date -r $((since / 1000)) '+%F %T'))"
      echo "  restarts after a stop: $(json_get "$DATA/host.json" restarts)"
    else
      echo "  host not running (last mode: ${mode:-?})"
    fi
  else
    echo "  no host yet: the service was started by an older app (before the host), so macOS does not"
    echo "  count it as NeuralAgent. Quit NeuralAgent (stop the agents) and open it again once."
  fi
  if [ -f "$DATA/daemon.json" ]; then
    local dpid
    dpid=$(json_get "$DATA/daemon.json" pid)
    if kill -0 "$dpid" 2>/dev/null; then
      echo "  service: running (pid $dpid, version $(json_get "$DATA/daemon.json" version))"
    else
      echo "  service: not running"
    fi
  fi

  echo "Autostart"
  local found=0 f
  for f in "$HOME/Library/LaunchAgents/$ID.service.plist" "/Library/LaunchDaemons/$ID.boot.plist" "$HOME/Library/LaunchAgents/$ID.window.plist"; do
    [ -f "$f" ] && echo "  $f" && found=1
  done
  [ $found = 0 ] && echo "  off (the service starts with the app)"

  echo "Permissions the app saw on its last start ($DATA/permissions.json)"
  if [ -f "$DATA/permissions.json" ]; then
    echo "  on: $(tr -d '[]"' <"$DATA/permissions.json" | sed 's/,/, /g')"
  else
    echo "  (not recorded yet)"
  fi
  echo "Live state and buttons: NeuralAgent → Settings → System."
}

check() {
  local ok=0
  echo "Signatures (an update keeps permissions only when these stay the same)"
  signature "$APP" || ok=1
  local exe="$APP/Contents/MacOS/neuralagent"
  [ -f "$exe" ] && { signature "$exe" || ok=1; }
  local d="$APP/Contents/MacOS/neuralagentd"
  [ -f "$d" ] && { signature "$d" || ok=1; }
  [ $ok = 0 ] && echo "ok" || echo "FAILED"
  return $ok
}

setup() {
  echo "One permission at a time. Switch NeuralAgent on in each list (use + or drag it in if it is"
  echo "missing; 'reveal' shows it in Finder). Press Enter for the next one."
  open -R "$APP" 2>/dev/null
  local p
  for p in fda accessibility microphone; do
    echo "→ $p"
    open "$(pane_url "$p")"
    read -r _
  done
  echo "Done. Check in NeuralAgent → Settings → System; restart the service there once after Full Disk Access."
}

case "${1:-status}" in
  status) status ;;
  check) check ;;
  setup) setup ;;
  reveal) open -R "$APP" ;;
  open)
    url=$(pane_url "${2:-}") || { echo "panes: fda accessibility microphone screen automation login" >&2; exit 2; }
    open "$url"
    ;;
  -h | --help | help) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//' ;;
  *) echo "unknown command $1 (try --help)" >&2; exit 2 ;;
esac

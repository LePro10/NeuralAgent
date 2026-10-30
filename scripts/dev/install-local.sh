#!/bin/sh
# Installs a locally built NeuralAgent.app over /Applications and restarts app + daemon.
# For the owner's own Mac while CI cannot publish (docs/RELEASING.md, "While GitHub Actions is blocked").
#
# THIS STOPS THE OWNER'S REAL DAEMON. Only when the owner asked for it. An agent session usually
# runs inside NeuralAgent and dies with it, so start this detached as the very LAST action of the
# turn, after the final answer is written:
#   nohup scripts/dev/install-local.sh path/to/NeuralAgent.app >/dev/null 2>&1 &
# It waits DELAY seconds (default 25) before it quits anything. Log: $LOG (default /tmp/na-install.log).
set -u
APP_SRC="${1:?usage: install-local.sh path/to/NeuralAgent.app}"
APP_SRC="$(cd "$(dirname "$APP_SRC")" && pwd)/$(basename "$APP_SRC")"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
LOG="${LOG:-/tmp/na-install.log}"
exec >"$LOG" 2>&1
H="$HOME/Library/Application Support/dev.neuralhub.neuralagent"
LSREG=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
pid() { python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['pid'])" "$H/daemon.json"; }

echo "start $(date)"
sleep "${DELAY:-25}"
osascript -e 'quit app "NeuralAgent"'; sleep 3
pkill -x neuralagent 2>/dev/null
PID=$(pid)
echo "stopping daemon $PID"; kill -TERM "$PID"
for _ in $(seq 1 60); do kill -0 "$PID" 2>/dev/null || break; sleep 0.5; done
kill -0 "$PID" 2>/dev/null && { echo "daemon still alive, KILL"; kill -KILL "$PID"; }

rm -rf /Applications/NeuralAgent.app && ditto "$APP_SRC" /Applications/NeuralAgent.app &&
  echo "installed $(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' /Applications/NeuralAgent.app/Contents/Info.plist)"
# Build outputs in the repo show up as a second NeuralAgent in Spotlight/Launchpad.
for b in "$REPO/target/release/bundle/macos/NeuralAgent.app" "$REPO/target/aarch64-apple-darwin/release/bundle/macos/NeuralAgent.app"; do
  [ "$b" = "$APP_SRC" ] && continue
  "$LSREG" -u "$b" 2>/dev/null; rm -rf "$b" && echo "removed $b"
done
"$LSREG" -f /Applications/NeuralAgent.app

open -a /Applications/NeuralAgent.app
sleep 15
python3 -c "import json,sys;d=json.load(open(sys.argv[1]));print('new daemon', d['pid'], d.get('version'))" "$H/daemon.json"
sleep 15
grep -E "relay|remote|panic|ERROR" "$H/logs/daemon.log" | tail -8
echo "done $(date)"

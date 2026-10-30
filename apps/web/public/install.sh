#!/bin/sh
# Installs or updates NeuralAgent on macOS:
#   curl -fsSL https://agent.neuralhub.dev/install.sh | sh
# Downloads the newest release for this Mac and copies the app to /Applications. A download in
# the terminal is not quarantined, so macOS opens the app without the "unverified developer"
# prompt. Running agents keep running; the app swaps its service once they are done.
set -eu

BASE="${NEURALAGENT_URL:-https://agent.neuralhub.dev}"
[ "$(uname -s)" = Darwin ] || { echo "This installer is for macOS. Downloads for other systems: $BASE/download"; exit 1; }
case "$(uname -m)" in
  arm64) kind=mac ;;
  *) kind=mac-intel ;;
esac

tmp="$(mktemp -d)"
trap 'hdiutil detach -quiet "$tmp/mnt" 2>/dev/null || true; rm -rf "$tmp"' EXIT
echo "Downloading NeuralAgent…"
curl -fL --progress-bar -o "$tmp/NeuralAgent.dmg" "$BASE/download/latest/$kind"
hdiutil attach -nobrowse -quiet -mountpoint "$tmp/mnt" "$tmp/NeuralAgent.dmg"

dest="${NEURALAGENT_APPS:-/Applications}"
[ -w "$dest" ] || dest="$HOME/Applications"
mkdir -p "$dest"
[ "$dest/NeuralAgent.app" -ef /Applications/NeuralAgent.app ] && { osascript -e 'quit app "NeuralAgent"' 2>/dev/null || true; }
rm -rf "$dest/NeuralAgent.app"
cp -R "$tmp/mnt/NeuralAgent.app" "$dest/"
xattr -dr com.apple.quarantine "$dest/NeuralAgent.app" 2>/dev/null || true
echo "Installed NeuralAgent $(defaults read "$dest/NeuralAgent.app/Contents/Info" CFBundleShortVersionString) in $dest."
[ -n "${NEURALAGENT_NO_OPEN:-}" ] || open "$dest/NeuralAgent.app"

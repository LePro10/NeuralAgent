#!/bin/zsh
# Builds the macOS input/window helpers into scripts/dev/macos/bin (git-ignored).
#   hold <s>        hold Option+Space (push-to-talk) for s seconds
#   holdf5          hold F5 for 2 s
#   sink <out> [s]  focused text window; writes what was typed into <out>, quits after s seconds
#   click x y       click at a screen point;   move x y   move the mouse there
#   winid <owner>   window ids of an app, e.g. `winid neuralagent` → screencapture -x -o -l <id> shot.png
# Posting key/mouse events needs Accessibility permission for the terminal that runs them.
set -e
cd ${0:A:h}
mkdir -p bin
for f in *.swift; do swiftc -O "$f" -o "bin/${f:r}" 2>&1 | grep -v "^$" || true; done
ls bin

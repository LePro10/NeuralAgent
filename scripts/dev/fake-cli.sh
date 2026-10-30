#!/bin/zsh -f
# Stand-in agent CLI for screenshots: ignores its args and gives a plain shell, so the daemon
# treats it like Claude/Codex/Gemini (profile engine) without spending any model quota.
PS1='$ ' exec /bin/zsh -f -i

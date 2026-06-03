#!/usr/bin/env sh
# sessionstart-check.sh — fired at SessionStart by the plugin.
#
# Quiet by design: prints a one-line reminder ONLY when the current directory is
# a git repo whose hooks are not yet installed. Once installed (core.hooksPath
# set, or .husky present), it stays silent. Never fails the session.

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0

# Only relevant inside a git work tree.
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

hooks_path=$(git config --get core.hooksPath 2>/dev/null || true)
if [ -n "$hooks_path" ] || [ -d .husky ]; then
  exit 0
fi

echo "ℹ️  sdlc-workflow: git hooks not installed in this repo. Run /sdlc-workflow:install-hooks to enforce the [TICKET] commit + branch conventions locally."
exit 0

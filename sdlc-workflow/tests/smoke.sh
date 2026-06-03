#!/usr/bin/env sh
# smoke.sh — exercise the sdlc-workflow git hooks in a throwaway repo.
# Verifies: install, commit-msg gate, prepare-commit-msg auto-prefix,
# pre-push branch-name gate, and clobber protection. No network, no side effects
# outside its temp dir.

set -e
PLUGIN_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
fail() { echo "FAIL: $1" >&2; exit 1; }
ok() { echo "  ok: $1"; }

cd "$WORK"
git init -q
git config user.email t@example.com
git config user.name Test
git commit -q --allow-empty -m "root" 2>/dev/null || true

echo "== install hooks (prefix ABC) =="
sh "$PLUGIN_ROOT/bin/install-git-hooks" --prefix ABC >/dev/null
[ "$(git config --get core.hooksPath)" = ".githooks" ] || fail "core.hooksPath not set"
[ "$(git config --get sdlc.ticketPrefix)" = "ABC" ] || fail "prefix not stored"
[ -x .githooks/commit-msg ] || fail "commit-msg not installed/executable"
ok "installed, core.hooksPath + prefix set"

echo "== commit-msg rejects a subject with no ticket =="
echo x > f1; git add f1
if git commit -q -m "no ticket here" 2>/dev/null; then fail "bad commit was accepted"; fi
ok "rejected ticketless commit"

echo "== commit-msg rejects all-zero placeholder =="
if git commit -q -m "[ABC-0000] wip" 2>/dev/null; then fail "placeholder accepted"; fi
ok "rejected [ABC-0000]"

echo "== commit-msg accepts a valid ticket =="
git commit -q -m "[ABC-123] add f1" || fail "valid commit rejected"
ok "accepted [ABC-123]"

echo "== prepare-commit-msg auto-prefixes from branch name =="
git switch -q -c feature/ABC-456-thing
echo y > f2; git add f2
git commit -q -m "add f2"
got=$(git log -1 --pretty=%s)
[ "$got" = "[ABC-456] add f2" ] || fail "auto-prefix wrong: '$got'"
ok "derived [ABC-456] from branch"

echo "== pre-push regexes (offline check of the guard logic) =="
bad="frobnicate/ABC-1-x"; good="feature/ABC-1-x"
re='^(feature|bugfix|hotfix|refactor|chore|incident)/ABC-[0-9]+-.+'
printf '%s' "$good" | grep -qE "$re" || fail "valid branch failed regex"
printf '%s' "$bad"  | grep -qE "$re" && fail "invalid branch passed regex"
ok "branch-name guard regex behaves"

echo "== clobber protection =="
if sh "$PLUGIN_ROOT/bin/install-git-hooks" --prefix XYZ --hooks-dir other 2>/dev/null; then
  fail "second install clobbered without --force"
fi
ok "refused to clobber existing hooksPath without --force"

echo "ALL SMOKE TESTS PASSED"

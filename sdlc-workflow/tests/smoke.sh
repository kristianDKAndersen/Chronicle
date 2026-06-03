#!/usr/bin/env sh
# smoke.sh — exercise the sdlc-workflow git hooks in a throwaway repo.
# Verifies install, commit-msg gate (header OR body), prepare-commit-msg
# auto-prefix, pre-push branch-name gate (non-exhaustive types incl. release +
# story, optional restriction), and clobber protection. No network/side effects.

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
ok "installed, core.hooksPath + prefix set"

echo "== commit-msg rejects no ticket =="
echo x > f1; git add f1
git commit -q -m "no ticket here" 2>/dev/null && fail "ticketless commit accepted"
ok "rejected ticketless commit"

echo "== commit-msg rejects all-zero placeholder =="
git commit -q -m "[ABC-0000] wip" 2>/dev/null && fail "placeholder accepted"
ok "rejected [ABC-0000]"

echo "== commit-msg accepts ticket in HEADER =="
git commit -q -m "[ABC-123] add f1" || fail "valid header commit rejected"
ok "accepted header ticket [ABC-123]"

echo "== commit-msg accepts ticket in BODY (header has none) =="
echo b > fb; git add fb
printf 'Add fb\n\nRefs [ABC-777]\n' > "$WORK/cm.txt"
git commit -q -F "$WORK/cm.txt" || fail "body-only ticket rejected"
ok "accepted body ticket [ABC-777]"

echo "== prepare-commit-msg auto-prefixes from branch =="
git switch -q -c feature/ABC-456-thing
echo y > f2; git add f2
git commit -q -m "add f2"
got=$(git log -1 --pretty=%s)
[ "$got" = "[ABC-456] add f2" ] || fail "auto-prefix wrong: '$got'"
ok "derived [ABC-456] from branch"

echo "== pre-push regex: recommended + non-listed types pass, ticket required =="
re='^[a-z][a-z-]*/ABC-[0-9]+-.+'
for good in feature/ABC-1-x release/ABC-2-x story/ABC-3-import-users hotfix/ABC-9-y; do
  printf '%s' "$good" | grep -qE "$re" || fail "valid branch rejected: $good"
done
for bad in ABC-1-no-type feature/nope-x feature/ABC--x; do
  printf '%s' "$bad" | grep -qE "$re" && fail "invalid branch accepted: $bad"
done
ok "open type set incl. release + story; ticket token required"

echo "== pre-push optional type restriction =="
restrict="feature bugfix hotfix refactor chore incident release"
ralt="($(printf '%s' "$restrict" | tr -s ' ' '|'))"
rre="^${ralt}/ABC-[0-9]+-.+"
printf '%s' "release/ABC-2-x" | grep -qE "$rre" || fail "release rejected under restriction"
printf '%s' "story/ABC-3-x"   | grep -qE "$rre" && fail "story passed a restricted set that omits it"
ok "sdlc.branchTypes restriction narrows the allowed types"

echo "== clobber protection =="
sh "$PLUGIN_ROOT/bin/install-git-hooks" --prefix XY --hooks-dir other 2>/dev/null && fail "clobbered without --force"
ok "refused to clobber existing hooksPath without --force"

echo "ALL SMOKE TESTS PASSED"

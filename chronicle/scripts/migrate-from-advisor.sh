#!/usr/bin/env bash
# migrate-from-advisor.sh — migrate advisor vault .md notes into a Chronicle vault.
# Usage: migrate-from-advisor.sh --source <advisor-vault-root> [--target <project-slug>] [--dry-run]
# The target Chronicle vault root is taken from CHRONICLE_VAULT env var if set;
# otherwise it is derived from --target as ~/.claude/vault/projects/<slug>.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="$SCRIPT_DIR/../lib/chronicle-vault.js"

SOURCE=""
TARGET_SLUG=""
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source)   SOURCE="$2";       shift 2 ;;
    --target)   TARGET_SLUG="$2";  shift 2 ;;
    --dry-run)  DRY_RUN=true;      shift   ;;
    *) echo "migrate-from-advisor: unknown option: $1" >&2; exit 1 ;;
  esac
done

[[ -z "$SOURCE" ]] && { echo "Error: --source <path> required" >&2; exit 1; }

# Determine target vault root. CHRONICLE_VAULT env takes precedence over --target slug.
if [[ -n "${CHRONICLE_VAULT:-}" ]]; then
  TARGET_VAULT="${CHRONICLE_VAULT}"
elif [[ -n "$TARGET_SLUG" ]]; then
  TARGET_VAULT="$HOME/.claude/vault/projects/$TARGET_SLUG"
else
  echo "Error: --target <project-slug> or CHRONICLE_VAULT env var required" >&2
  exit 1
fi

TMPJS=$(mktemp /tmp/chronicle-migrate-XXXXX.mjs)
trap 'rm -f "$TMPJS"' EXIT

cat > "$TMPJS" << 'JSEOF'
import fs from 'fs';
import path from 'path';

const LIB    = process.env.CHRONICLE_LIB;
const SOURCE = process.env.CHRONICLE_SOURCE;
const DRY    = process.env.CHRONICLE_DRY_RUN === 'true';

const { writeNote, rebuildIndex, parseFrontmatter } = await import(LIB);

// Detect multi-line YAML frontmatter: any line inside --- ... --- block that starts
// with whitespace (continuation / nested value) indicates multi-line frontmatter.
function isMultiLineFm(text) {
  const t = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!t.startsWith('---\n')) return false;
  const end = t.indexOf('\n---\n', 4);
  if (end === -1) return false;
  for (const line of t.slice(4, end).split('\n')) {
    if (line === '') continue;
    if (/^\s/.test(line)) return true;
  }
  return false;
}

function walk(dir, files = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return files; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '.cache') walk(full, files);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(full);
    }
  }
  return files;
}

const allFiles = walk(SOURCE);
let imported = 0, skipped = 0;

for (const file of allFiles) {
  let content;
  try { content = fs.readFileSync(file, 'utf8'); } catch (_) { skipped++; continue; }

  if (isMultiLineFm(content)) {
    process.stderr.write(`WARN: skipping ${file} (multi-line frontmatter)\n`);
    skipped++;
    continue;
  }

  if (DRY) { imported++; continue; }

  const { fm, body } = parseFrontmatter(content);

  // Build Chronicle frontmatter: copy compatible fields, rename repo->project
  const chronicleFm = {};
  for (const key of ['type', 'agent', 'sid', 'seq', 'created_at',
                     'established', 'gap', 'plan_ref', 'worker_verdict',
                     'failure_mode', 'heuristic', 'due_date', 'status']) {
    if (fm[key] !== undefined) chronicleFm[key] = fm[key];
  }
  // advisor uses repo; Chronicle uses project
  if (fm.project)      chronicleFm.project = fm.project;
  else if (fm.repo)    chronicleFm.project = fm.repo;

  const relPath = path.relative(SOURCE, file);
  writeNote(relPath, chronicleFm, body);
  imported++;
}

if (DRY) {
  process.stdout.write(`Dry run: ${imported} notes would be imported (${skipped} skipped).\n`);
} else {
  rebuildIndex();
  process.stdout.write(`Imported ${imported} notes. Index rebuilt. Source vault untouched.\n`);
}
JSEOF

CHRONICLE_LIB="$LIB" \
  CHRONICLE_SOURCE="$SOURCE" \
  CHRONICLE_DRY_RUN="$DRY_RUN" \
  CHRONICLE_VAULT="$TARGET_VAULT" \
  CHRONICLE_PROJECT_SLUG="" \
  bun run "$TMPJS"

#!/usr/bin/env bash
# verify-cascade.sh — Full verification of the Battle Plan cascade system.
# Checks: dates, metrics, staleness, battle plan freshness.
# Usage: tools/verify-cascade.sh
# Exit 0 if clean, exit 1 if issues found.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOCS_DIR="$REPO_ROOT/docs"
METRICS_FILE="$REPO_ROOT/metrics.yml"
TODAY=$(date +%Y-%m-%d)

WARNINGS=0
ERRORS=0

echo "=== Battle Plan Verification ==="
echo "Date: $TODAY"
echo ""

# --- Check 1: Last Updated dates ---
echo "--- Check 1: Last Updated Dates ---"

while IFS= read -r doc; do
  [ -z "$doc" ] && continue

  # Skip docs/README.md (vault rules, not a cascade doc)
  [[ "$doc" == "$DOCS_DIR/README.md" ]] && continue

  status=$(grep '^\*\*Status:\*\*' "$doc" | head -1 | sed 's/\*\*Status:\*\* //' || true)

  # Skip archived and draft docs
  [[ "$status" == "Archived" ]] && continue

  last_updated=$(grep '^\*\*Last Updated:\*\*' "$doc" | head -1 | sed 's/\*\*Last Updated:\*\* //' || true)

  if [ -z "$last_updated" ]; then
    echo "WARNING: No Last Updated line in $doc"
    WARNINGS=$((WARNINGS + 1))
  fi
done < <(find "$DOCS_DIR" -name "*.md" -not -path "*/examples/*" 2>/dev/null)

# --- Check 2: Metrics consistency ---
echo ""
echo "--- Check 2: Metrics Consistency ---"

if [ -f "$METRICS_FILE" ]; then
  if ! "$REPO_ROOT/tools/check-metrics.sh" 2>&1; then
    ERRORS=$((ERRORS + 1))
  fi
else
  echo "WARNING: metrics.yml not found"
  WARNINGS=$((WARNINGS + 1))
fi

# --- Check 3: Battle plan freshness ---
echo ""
echo "--- Check 3: Battle Plan Freshness ---"

BATTLE_PLAN="$DOCS_DIR/battle-plan.md"
if [ -f "$BATTLE_PLAN" ]; then
  bp_date=$(grep '^\*\*Last Updated:\*\*' "$BATTLE_PLAN" | head -1 | sed 's/\*\*Last Updated:\*\* //' || true)

  while IFS= read -r doc; do
    [ -z "$doc" ] && continue
    [[ "$doc" == "$BATTLE_PLAN" ]] && continue
    [[ "$doc" == "$DOCS_DIR/README.md" ]] && continue

    doc_date=$(grep '^\*\*Last Updated:\*\*' "$doc" | head -1 | sed 's/\*\*Last Updated:\*\* //' || true)
    [ -z "$doc_date" ] && continue

    if [[ "$doc_date" > "$bp_date" ]]; then
      echo "WARNING: $doc ($doc_date) is newer than battle plan ($bp_date)"
      WARNINGS=$((WARNINGS + 1))
    fi
  done < <(find "$DOCS_DIR" -name "*.md" -not -path "*/examples/*" 2>/dev/null)
else
  echo "WARNING: Battle plan not found at $BATTLE_PLAN"
  WARNINGS=$((WARNINGS + 1))
fi

# --- Check 4: TL;DR existence ---
echo ""
echo "--- Check 4: TL;DR Presence ---"

while IFS= read -r doc; do
  [ -z "$doc" ] && continue

  # Skip docs/README.md (vault rules, not a cascade doc)
  [[ "$doc" == "$DOCS_DIR/README.md" ]] && continue

  status=$(grep '^\*\*Status:\*\*' "$doc" | head -1 | sed 's/\*\*Status:\*\* //' || true)
  [[ "$status" == "Archived" ]] && continue

  if ! grep -q '^\*\*TL;DR:\*\*' "$doc"; then
    echo "WARNING: No TL;DR in $doc"
    WARNINGS=$((WARNINGS + 1))
  fi
done < <(find "$DOCS_DIR" -name "*.md" -not -path "*/examples/*" 2>/dev/null)

# --- Check 5: Stale inline references ---
echo ""
echo "--- Check 5: Inline Reference Staleness ---"

while IFS= read -r doc; do
  [ -z "$doc" ] && continue

  # Skip docs/README.md (vault rules, contains example syntax)
  [[ "$doc" == "$DOCS_DIR/README.md" ]] && continue

  doc_date=$(grep '^\*\*Last Updated:\*\*' "$doc" | head -1 | sed 's/\*\*Last Updated:\*\* //' || true)
  [ -z "$doc_date" ] && continue

  while IFS= read -r ref; do
    [ -z "$ref" ] && continue
    ref_file=$(echo "$ref" | grep -oE '[a-zA-Z0-9_-]+\.md' || true)
    [ -z "$ref_file" ] && continue

    # Skip metrics.yml references (handled by check-metrics)
    [[ "$ref" == *"metrics.yml"* ]] && continue

    ref_path=$(find "$DOCS_DIR" -name "$ref_file" -not -path "*/examples/*" 2>/dev/null | head -1)
    if [ -z "$ref_path" ]; then
      echo "WARNING: Referenced file $ref_file not found (from $doc)"
      WARNINGS=$((WARNINGS + 1))
      continue
    fi

    ref_date=$(grep '^\*\*Last Updated:\*\*' "$ref_path" | head -1 | sed 's/\*\*Last Updated:\*\* //' || true)
    [ -z "$ref_date" ] && continue

    if [[ "$ref_date" > "$doc_date" ]]; then
      echo "WARNING: $doc references $ref_file, but $ref_file ($ref_date) is newer than $doc ($doc_date) — reference may be stale"
      WARNINGS=$((WARNINGS + 1))
    fi
  done < <(grep -oE '\(→ [^)]+\)' "$doc" 2>/dev/null || true)
done < <(find "$DOCS_DIR" -name "*.md" -not -path "*/examples/*" 2>/dev/null)

# --- Check 6: today.md freshness (task subsystem) ---
echo ""
echo "--- Check 6: today.md Freshness ---"

TASKS_YML="$REPO_ROOT/tasks.yml"
TODAY_MD="$DOCS_DIR/today.md"
if [ -f "$TASKS_YML" ] && [ -f "$TODAY_MD" ]; then
  if [ "$TASKS_YML" -nt "$TODAY_MD" ]; then
    echo "WARNING: tasks.yml is newer than docs/today.md — run \`node tools/tasks/render-today.js\`"
    WARNINGS=$((WARNINGS + 1))
  fi
elif [ -f "$TASKS_YML" ] && [ ! -f "$TODAY_MD" ]; then
  echo "WARNING: tasks.yml exists but docs/today.md does not — run \`node tools/tasks/render-today.js\`"
  WARNINGS=$((WARNINGS + 1))
fi

# --- Summary ---
echo ""
echo "========================="
echo "Warnings: $WARNINGS"
echo "Errors:   $ERRORS"

if [ $ERRORS -gt 0 ]; then
  echo "RESULT: FAIL"
  exit 1
elif [ $WARNINGS -gt 0 ]; then
  echo "RESULT: PASS with warnings"
  exit 0
else
  echo "RESULT: CLEAN"
  exit 0
fi

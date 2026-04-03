#!/usr/bin/env bash
# check-metrics.sh — Verifies that (→ metrics.yml#field) references in docs match actual values.
# Usage: tools/check-metrics.sh [docs_dir]
# Exit 0 if all match, exit 1 if mismatches found.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
METRICS_FILE="$REPO_ROOT/metrics.yml"
DOCS_DIR="${1:-$REPO_ROOT/docs}"

if [ ! -f "$METRICS_FILE" ]; then
  echo "ERROR: metrics.yml not found at $METRICS_FILE"
  exit 1
fi

ERRORS=0
CHECKED=0

# Parse metrics.yml into key=value pairs (skip comments, blank lines, string values)
while IFS= read -r line; do
  # Skip comments, blank lines, and string values (quoted)
  [[ "$line" =~ ^[[:space:]]*# ]] && continue
  [[ -z "$line" ]] && continue
  [[ "$line" =~ \" ]] && continue

  key=$(echo "$line" | cut -d: -f1 | tr -d ' ')
  value=$(echo "$line" | cut -d: -f2 | tr -d ' ')

  # Skip the last_updated meta field
  [[ "$key" == "last_updated" ]] && continue

  # Find all docs referencing this metric
  pattern="→ metrics\\.yml#${key}"
  while IFS= read -r match_file; do
    [ -z "$match_file" ] && continue
    CHECKED=$((CHECKED + 1))

    # Extract the number immediately before the reference
    while IFS= read -r match_line; do
      # Pull the number that precedes (→ metrics.yml#field)
      ref_number=$(echo "$match_line" | grep -oE '[0-9]+[[:space:]]*\(→ metrics\.yml#'"$key"'\)' | grep -oE '^[0-9]+' || true)

      if [ -z "$ref_number" ]; then
        # Try bold format: **N** (→ metrics.yml#field)
        ref_number=$(echo "$match_line" | grep -oE '\*\*[0-9]+\*\*[[:space:]]*\(→ metrics\.yml#'"$key"'\)' | grep -oE '[0-9]+' || true)
      fi

      if [ -z "$ref_number" ]; then
        echo "WARNING: Could not parse number for $key in $match_file"
        echo "  Line: $match_line"
        ERRORS=$((ERRORS + 1))
      elif [ "$ref_number" != "$value" ]; then
        echo "MISMATCH: $key in $match_file"
        echo "  metrics.yml: $value"
        echo "  Document:    $ref_number"
        echo "  Line: $match_line"
        ERRORS=$((ERRORS + 1))
      fi
    done < <(grep "$pattern" "$match_file")
  done < <(grep -rl "$pattern" "$DOCS_DIR" 2>/dev/null || true)
done < "$METRICS_FILE"

echo ""
echo "=== Metrics Check ==="
echo "Checked: $CHECKED references"
echo "Errors:  $ERRORS"

if [ $ERRORS -gt 0 ]; then
  exit 1
else
  echo "All metrics references match."
  exit 0
fi

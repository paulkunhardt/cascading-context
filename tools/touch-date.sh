#!/usr/bin/env bash
# touch-date.sh — Updates the "Last Updated:" line in a markdown file to today's date.
# Usage: tools/touch-date.sh <file> [<file2> ...]

set -euo pipefail

TODAY=$(date +%Y-%m-%d)

if [ $# -eq 0 ]; then
  echo "Usage: tools/touch-date.sh <file> [<file2> ...]"
  echo "Updates the 'Last Updated:' line to today's date ($TODAY)."
  exit 1
fi

for file in "$@"; do
  if [ ! -f "$file" ]; then
    echo "WARNING: File not found: $file"
    continue
  fi

  if grep -q '^\*\*Last Updated:\*\*' "$file"; then
    if [[ "$OSTYPE" == "darwin"* ]]; then
      sed -i '' "s/^\*\*Last Updated:\*\*.*/\*\*Last Updated:\*\* $TODAY/" "$file"
    else
      sed -i "s/^\*\*Last Updated:\*\*.*/\*\*Last Updated:\*\* $TODAY/" "$file"
    fi
    echo "Updated: $file → $TODAY"
  else
    echo "WARNING: No 'Last Updated:' line found in $file"
  fi
done

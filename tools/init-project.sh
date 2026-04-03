#!/usr/bin/env bash
# init-project.sh — Scaffolds a new project from onboarding wizard answers.
# Called by the LLM after the 5-question interview.
#
# Usage: tools/init-project.sh \
#   --name "Project Name" \
#   --horizon "3 weeks" \
#   --metrics "metric1,metric2,metric3" \
#   --domains "market,validation,strategy" \
#   --people "Name1:Role1,Name2:Role2"

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Parse arguments
PROJECT_NAME=""
HORIZON=""
METRICS=""
DOMAINS=""
PEOPLE=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --name) PROJECT_NAME="$2"; shift 2 ;;
    --horizon) HORIZON="$2"; shift 2 ;;
    --metrics) METRICS="$2"; shift 2 ;;
    --domains) DOMAINS="$2"; shift 2 ;;
    --people) PEOPLE="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [ -z "$PROJECT_NAME" ] || [ -z "$METRICS" ] || [ -z "$DOMAINS" ]; then
  echo "ERROR: --name, --metrics, and --domains are required."
  echo "Usage: tools/init-project.sh --name \"...\" --horizon \"...\" --metrics \"m1,m2\" --domains \"d1,d2\" --people \"N1:R1,N2:R2\""
  exit 1
fi

TODAY=$(date +%Y-%m-%d)

echo "=== Initializing project: $PROJECT_NAME ==="

# Step 1: Move demo content to examples/
echo "Moving demo content to examples/startup-validation/..."
mkdir -p "$REPO_ROOT/examples/startup-validation"

if [ -d "$REPO_ROOT/docs" ]; then
  # Preserve the docs/README.md (vault rules) — it's generic
  cp "$REPO_ROOT/docs/README.md" /tmp/cascade-vault-rules.md 2>/dev/null || true

  # Move all docs to examples
  cp -r "$REPO_ROOT/docs/"* "$REPO_ROOT/examples/startup-validation/" 2>/dev/null || true
  rm -rf "$REPO_ROOT/docs/"*/
  rm -f "$REPO_ROOT/docs/"*.md

  # Restore vault rules
  cp /tmp/cascade-vault-rules.md "$REPO_ROOT/docs/README.md" 2>/dev/null || true
fi

# Also preserve the demo metrics.yml
cp "$REPO_ROOT/metrics.yml" "$REPO_ROOT/examples/startup-validation/metrics.yml" 2>/dev/null || true

# Step 2: Create domain directories and initial docs
IFS=',' read -ra DOMAIN_ARRAY <<< "$DOMAINS"
for domain in "${DOMAIN_ARRAY[@]}"; do
  domain=$(echo "$domain" | tr -d ' ')
  mkdir -p "$REPO_ROOT/docs/$domain"

  # Create an initial doc for each domain
  cat > "$REPO_ROOT/docs/$domain/${domain}-overview.md" << DOCEOF
# ${domain^} Overview

**Last Updated:** $TODAY
**Status:** Draft
**Role:** cascade-target

**TL;DR:** Initial ${domain} document for $PROJECT_NAME. To be filled in as the project progresses.

---

## Notes

_Start adding content here._
DOCEOF

  echo "Created: docs/$domain/${domain}-overview.md"
done

# Step 3: Create metrics.yml
echo "Creating metrics.yml..."
cat > "$REPO_ROOT/metrics.yml" << METRICSEOF
# metrics.yml — project-wide metrics registry for $PROJECT_NAME
# The LLM updates this file FIRST in any cascade, before touching docs.
# Scripts verify all (→ metrics.yml#field) references against these values.

last_updated: $TODAY

METRICSEOF

IFS=',' read -ra METRIC_ARRAY <<< "$METRICS"
for metric in "${METRIC_ARRAY[@]}"; do
  metric_key=$(echo "$metric" | tr -d ' ' | tr '[:upper:]' '[:lower:]' | tr ' ' '_' | tr -cd 'a-z0-9_')
  echo "${metric_key}: 0" >> "$REPO_ROOT/metrics.yml"
done

echo "Created: metrics.yml with ${#METRIC_ARRAY[@]} metrics"

# Step 4: Create battle plan
echo "Creating battle plan..."
cat > "$REPO_ROOT/docs/battle-plan.md" << BPEOF
# Battle Plan — $PROJECT_NAME

**Last Updated:** $TODAY
**Status:** Active
**Role:** source-of-truth

**TL;DR:** $PROJECT_NAME — just initialized. Time horizon: ${HORIZON:-"not set"}. All metrics at 0. First priority: fill in the battle plan with real tasks and targets.

---

## Rules for This Document

1. Every task has an assigned date — no "sometime this week"
2. Tasks move, never disappear — if slipped, add new date + reason
3. New info updates the battle plan FIRST, before any other doc
4. Everything links — tasks reference the doc they depend on or produce

---

## Key Metrics

| Metric | Target | Current |
|--------|--------|---------|
BPEOF

for metric in "${METRIC_ARRAY[@]}"; do
  metric_key=$(echo "$metric" | tr -d ' ' | tr '[:upper:]' '[:lower:]' | tr ' ' '_' | tr -cd 'a-z0-9_')
  metric_display=$(echo "$metric" | sed 's/^[[:space:]]*//')
  echo "| $metric_display | _set target_ | **0** (→ metrics.yml#${metric_key}) |" >> "$REPO_ROOT/docs/battle-plan.md"
done

cat >> "$REPO_ROOT/docs/battle-plan.md" << 'BPEOF2'

---

## Today's Priorities

- [ ] Set targets for each metric
- [ ] Fill in this week's tasks
- [ ] Record any existing conversations in external-insights.md

---

## This Week

_Add day-by-day tasks here._

---

## Daily Log

_Append-only. Three lines per day._
BPEOF2

echo "Created: docs/battle-plan.md"

# Step 5: Create external-insights.md with people sections
echo "Creating external-insights.md..."
cat > "$REPO_ROOT/docs/external-insights.md" << EIEOF
# External Insights

**Last Updated:** $TODAY
**Status:** Active
**Role:** cascade-target

**TL;DR:** All external conversations, calls, and meetings for $PROJECT_NAME. 0 sessions recorded so far.

---

## How to Use This Document

Every conversation gets appended as a dated session. Record everything — even "small" chats contain signal.

### Template

\`\`\`markdown
## Session N (YYYY-MM-DD) — [Person Name], [Role/Company]

### Context
[Why this conversation happened]

### Key insights
1. **Insight title.** Detail. \`Confidence: [level]\`

### Raw quotes (if available)
> "Quote here"

### Action items
- [ ] Follow-up X
\`\`\`

---

## People

EIEOF

if [ -n "$PEOPLE" ]; then
  IFS=',' read -ra PEOPLE_ARRAY <<< "$PEOPLE"
  for person in "${PEOPLE_ARRAY[@]}"; do
    name=$(echo "$person" | cut -d: -f1 | sed 's/^[[:space:]]*//')
    role=$(echo "$person" | cut -d: -f2 | sed 's/^[[:space:]]*//')
    cat >> "$REPO_ROOT/docs/external-insights.md" << PERSONEOF
### $name — $role
_No sessions recorded yet._

PERSONEOF
    echo "  Added person: $name ($role)"
  done
fi

echo "Created: docs/external-insights.md"

# Step 6: Install hooks
echo ""
"$REPO_ROOT/tools/setup-hooks.sh"

# Step 7: Create initialized flag
touch "$REPO_ROOT/.cascading-context-initialized"

echo ""
echo "=== Project initialized! ==="
echo "Project: $PROJECT_NAME"
echo "Domains: $DOMAINS"
echo "Metrics: $METRICS"
echo "Demo content preserved in: examples/startup-validation/"
echo ""
echo "Next steps:"
echo "  1. Open docs/battle-plan.md and set your targets"
echo "  2. Tell your LLM about your project context"
echo "  3. Start working — the cascade will keep docs in sync"

---
description: End-of-day wrap-up — status check, final cascade, metrics report, and commit. Run at the end of each work day.
---

# End-of-Day Wrap-Up

Run these steps in order. Be concise.

## Step 1: Scan

Read `docs/battle-plan.md` and `metrics.yml`. Find today's day section. Categorize all tasks:
- Done
- Partially done
- Not started
- New (added during the day but not in the morning plan)

## Step 2: Present

Show the user:
```
Today's status:
[x] [done tasks]
[~] [partial tasks]
[ ] [not started]
[+] [new things that happened]
```

Ask: "Does this look right?"

## Step 3: Prompt

Ask: "Anything else happen today? Even small things — a reply, an update, a thought, a link. Everything counts."

Wait for the user's answer before proceeding.

## Step 4: Cascade

With all info gathered, run the full cascade from CLAUDE.md:
1. Update `metrics.yml` if any metric changed
2. Update battle plan TL;DR + today's day log
3. Update source docs (only what's relevant to today's changes)
4. Run `tools/touch-date.sh` on every modified file
5. Run `tools/verify-cascade.sh` — fix any errors

## Step 5: Report

Print:
- **Metrics changed today** (before -> after, with deltas)
- **Docs updated** (list of files touched)
- **Verification warnings** (if any)
- **Tomorrow's top priorities** (carry-forwards + known agenda items)

## Step 6: Commit

Ask: "Want me to commit today's updates?"

If yes, commit with message: `eod YYYY-MM-DD: [one-line summary]`

## Tone

Direct. No fluff. Close out fast.

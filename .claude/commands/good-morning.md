---
description: Morning standup — status briefing, metrics snapshot, and today's priorities. Run at the start of each work day.
---

# Morning Standup

Run these steps in order. Be concise — the user wants a briefing, not an essay.

## Step 1: Gather State (parallel reads)

Read all of these in parallel:
- `metrics.yml` — current numbers
- `docs/battle-plan.md` — TL;DR + latest day log (find today or the most recent day entry)
- Run `git log --oneline -15` — what changed since last session

## Step 2: Present the Briefing

Print a compact morning report with these sections:

### Sprint Position
- Where you are in the timeline (calculate from battle plan dates if available)
- One-line status from TL;DR

### Key Metrics (from metrics.yml)
Show as a compact table:
| Metric | Value | Target | Gap |
Pull all defined metrics from `metrics.yml`. If targets are defined in the battle plan, include them.

### Yesterday's Unfinished Business
- Scan the most recent day log for unchecked `[ ]` items — list them
- Flag any that have been carried forward 2+ days

### Today's Agenda
- If there's already a day entry for today in the battle plan, show its tasks
- If not, suggest one based on yesterday's carryovers + sprint priorities

## Step 3: Ask Directed Questions

End with 2-3 short questions:
- "Anything happen since we last talked? Replies, updates, new info?"
- If there are stale items (no progress for 2+ days), ask about them specifically
- If a key deliverable is outstanding, ask about it

## Step 4: Prep the Day

After the user answers:
- If they report any updates → run the full cascade (Steps 0-4 from CLAUDE.md)
- Update the battle plan day log with today's plan

## Tone

Direct, no fluff. Think military briefing, not newsletter.

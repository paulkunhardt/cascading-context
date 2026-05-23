---
description: Morning standup — status briefing, metrics snapshot, and today's priorities. Run at the start of each work day.
---

# Morning Standup

Run these steps in order.

## Step 0: First-run gate

If `.battle-plan-onboarding.json` exists in the repo root, the user hasn't run `/welcome` yet. Don't run the standup — tell them:

> Hey — looks like this is a fresh install and you haven't gone through the welcome yet. Run `/welcome` first to get the proper tour, then come back to `/good-morning` tomorrow (or whenever you start your next session).

Stop here. Don't proceed to Step 1.

If neither `.battle-plan-onboarding.json` nor `.battle-plan-onboarding-done.json` exists, continue normally — the project may have been bootstrapped without the create-battle-plan CLI.

## Step 1: Gather State (parallel reads)

Run these in parallel:
- `node tools/tasks/render-today.js --quiet` — regenerate `docs/today.md` from `tasks.yml`
- Read `metrics.yml` — current numbers
- Read `docs/today.md` — user's daily surface (open tasks, calls, pulse)
- Read `docs/battle-plan.md` TL;DR + latest day log *only if needed for deep context*
- Run `git log --oneline -15` — what changed since last session

The battle plan is your orientation layer — read it on demand, not by default. `docs/today.md` is what the user sees, so lead with that.

## Step 1.6: Events context-debt warning (silent unless overdue)

`events.yml` carries past events that haven't been gated yet (transcript / spawned-tasks / insight not captured). Wrap-up's Step 4.5d handles these — but if the user skipped it or no wrap-up ran, they accumulate as context-debt.

Run `node tools/events/due-for-gate.js --json` and check whether any returned event has `end || start < (now - 2 days)`. If so, surface in the briefing:

> ⚠️ **Context-debt: N past event(s) ungated >2d** — EVT-{id} {title} ({start date}). Run `/wrap-up` Step 4.5d to capture transcript + insights.

Don't walk the gate during good-morning — wrap-up is the right time for that. Just flag it so the user knows.

If no events are returned, or none are >2d old, this step is silent.

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
- "Any new events to schedule? Calls, demos, meetings I should add to `events.yml`?" — if they name anything, call `node tools/events/add.js --title "..." --start "ISO" [--lead-id <id-if-any>] --source manual-chat`.
- If there are stale items (no progress for 2+ days), ask about them specifically
- If a key deliverable is outstanding, ask about it

## Step 4: Prep the Day

After the user answers:
- If they drop new tasks verbally, run `node tools/tasks/add.js "..." [--due ...] [--tag ...] [--priority 1|2|3]` for each, then re-run `render-today.js`.
- If they report any updates → run the full cascade (Steps 0-4 from CLAUDE.md)
- Update the battle plan day log with today's plan

## Tone

Direct, no fluff. Think military briefing, not newsletter. The user is starting a work session — they want their position and their next move, not a pep talk. (First-session warmth lives in `/welcome`, not here.)

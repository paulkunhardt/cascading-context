---
description: Morning standup — status briefing, metrics snapshot, and today's priorities. Run at the start of each work day.
---

# Morning Standup

Run these steps in order.

## Step 0: First-Run Welcome (one time only)

Check if `.battle-plan-onboarding.json` exists in the repo root. If it does, this is the user's **FIRST session** after running `npx create-battle-plan`. This is a special moment — the user just installed this and wants to understand what they've got. Make them feel like their project is in good hands.

**Read `.battle-plan-onboarding.json`** to get their project context. Then write a warm, personal welcome that covers ALL of the following. This should feel like a knowledgeable co-pilot introducing itself, not a product manual.

### Part 1: Personal welcome (reflect their project back to them)

Greet them warmly. Show them you already know their project by name, their time horizon, their metrics, their domains, and their people. Reference these specifics naturally — don't just list them. The user should feel like they're continuing a conversation, not configuring a tool.

Example tone: "Welcome to your battle plan for [project]. You've got [horizon] and you're tracking [metrics] — I've got all of that loaded and ready to go."

### Part 2: What this is (the big picture)

Explain what they now have, in plain language:

- **This is your project's memory.** Every conversation, decision, metric, and insight lives here in markdown files. When you close this chat and come back tomorrow — or next week — I read these files and pick up exactly where we left off. Nothing gets lost between sessions.
- **You don't organize anything.** When you tell me something new — a call you had, research you found, a number that changed, a reply you got — I update the right files in the right order automatically. That's called the cascade.
- **The cascade works like this:** new info flows into `metrics.yml` first (if a number changed), then into your battle plan (the operating doc that tracks where you are), then into the source docs for each domain. At the end, a verification script checks that everything is consistent.
- **Think of it as dumping context.** You can paste a full call transcript, a messy list of notes, a forwarded email, a research summary — anything. You don't need to format it or tell me where it goes. Just dump it in and I'll cascade it to the right places.

### Part 3: How to use it day to day

Explain the rhythm:

- **Start each session** with `/good-morning` (what you just ran). I'll brief you on where you stand — metrics, priorities, what's stuck, what's next. Think of it as a daily standup with your AI co-pilot.
- **During the day**, just talk to me. Tell me what happened, paste in notes, ask me to update things. Every piece of new info triggers the cascade automatically.
- **End each session** with `/wrap-up`. I'll review the day, show you what changed, sync everything, and offer to commit. This is how you close out clean without forgetting to log something.
- **When docs get long**, run `/distill`. Over time, your daily logs and conversation journals will grow. `/distill` compresses older content into a thorough summary and archives the raw text — nothing is ever deleted, but I can read the docs faster.

### Part 4: How metrics work

- Your key metrics live in `metrics.yml` — it's the single numeric source of truth for the whole project.
- Every number that appears in any doc traces back to that file via source annotations. When a metric changes, the cascade propagates the new value everywhere it's referenced.
- Shell scripts verify the numbers stay in sync. You'll never have a stale "42" in one doc when the real number is "47" in another.
- Right now all your metrics are at zero. One of the first things we'll do is set targets.

### Part 5: What to do right now

Transition into action:

- "Let's start by getting some real data into the system. Here's what I'd suggest..."
- Prompt them to set targets for their metrics
- Ask if there's any existing context they already have — calls they've had, research they've done, decisions they've already made. Anything they can tell you now will make the battle plan immediately useful.

### After the welcome

Rename `.battle-plan-onboarding.json` to `.battle-plan-onboarding-done.json` so this welcome doesn't repeat.

Then show a **compact metrics table** (all zeros, no targets yet) and transition into the onboarding questions naturally. Don't run the full standup format (Steps 1-4 below) on the first run — there's nothing to report yet. Instead, go straight to helping them populate the battle plan.

---

## Step 1: Gather State (parallel reads)

*Skip this on first run (Step 0 handles it). On all subsequent runs, start here.*

Run these in parallel:
- `node tools/tasks/render-today.js --quiet` — regenerate `docs/today.md` from `tasks.yml`
- Read `metrics.yml` — current numbers
- Read `docs/today.md` — user's daily surface (open tasks, calls, pulse)
- Read `docs/battle-plan.md` TL;DR + latest day log *only if needed for deep context*
- Run `git log --oneline -15` — what changed since last session

The battle plan is your orientation layer — read it on demand, not by default. `docs/today.md` is what the user sees, so lead with that.

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
- If they drop new tasks verbally, run `node tools/tasks/add.js "..." [--due ...] [--tag ...] [--priority 1|2|3]` for each, then re-run `render-today.js`.
- If they report any updates → run the full cascade (Steps 0-4 from CLAUDE.md)
- Update the battle plan day log with today's plan

## Tone

On first run: warm, confident, thorough. The user should feel like they just hired a great project manager who already read the brief.

On subsequent runs: direct, no fluff. Think military briefing, not newsletter.

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

## Step 4.5: Task hygiene — REQUIRED daily

This step keeps `tasks.yml` honest. Run before regenerating `today.md` so any closures land in the day's surface.

**4.5a — Detect drift (tasks that should be closed but aren't):**

Run `node tools/tasks/triage.js --json` and scan the output for any open task with non-empty `recent_commits` (commits mentioning `TASK-N` since the task was created). For each:
- Surface to the user: "TASK-{id} ({title}) — recent commit '{subject}' suggests it's done. Mark closed?"
- If yes → set `status: done`, `done_at: <today>` via Edit on `tasks.yml`. If no → leave it.

Also surface any open task with `implications_drift` flagged (linked doc untouched since task created) — the user may have closed the work without updating the doc, OR the doc work is genuinely pending.

**4.5b — Archive old closed tasks:**

Run `node tools/tasks/archive.js`. This moves any `status: done|cancelled` row with `done_at < today - 14d` into `tasks-archive.yaml` (created on first run). Idempotent. Default retention = 14 days; pass `--days N` to override or `--all` to archive everything closed.

**4.5c — Regenerate today.md:**

Run `node tools/tasks/render-today.js --quiet` so today's surface reflects any closures from 4.5a.

If 4.5a/4.5b changed anything, list it in Step 5 ("Task hygiene: N closed via git-drift, M archived").

**4.5d — Events gate (REQUIRED when past events exist):**

`events.yml` is the single source of truth for time-based events (calls, demos, meetings). Past events that haven't been "gated" (transcript + insights + spawned tasks captured) accumulate as context-debt. This step cycles the user through each one so context lands in the right docs before the event is archived.

Run `node tools/events/due-for-gate.js --json` and parse. If empty, this step is silent — skip to Step 5.

For each event returned, walk the user through them one-by-one (ONE at a time, sequential — do NOT batch):

```
Gate EVT-{id} — {title}  ({start HH:MM}, type={type})
  [a] Transcript path? (drag/paste a file path, or "none" for no recording)
  [b] Hypothesis impacts? (comma-separated like "H47, H49", or "none" — skip if your project has no hypothesis tracker)
  [c] Tasks spawned? (free-text bullets; each becomes a `tools/tasks/add.js` call)
  [d] Insight worth saving? (yes → append to the relevant cascade-target doc; no/skip otherwise)
  [skip]  ← leave gate open, will resurface tomorrow
```

**Apply each answer immediately:**

- (a) → If a path was provided, copy/symlink the raw transcript to `docs/archive/transcripts/<slug>-YYYY-MM-DD.<ext>` (save raw verbatim FIRST, then distill). Store the final path on the event's `transcript_path` field via the events lib:
  ```js
  const E = require('./tools/events/lib/events');
  const state = E.load();
  E.upsert(state, { id: <id>, transcript_path: '<path>' });
  E.save(state);
  ```
- (b) → For each `H{n}`, append a short `> **[UPDATE YYYY-MM-DD · Source: EVT-{id} {title}]**` block to `docs/validation/hypotheses.md` (or your equivalent) near the relevant hypothesis. Store the list in the event's `hypothesis_impacts` field via the events lib. Skip if no hypothesis tracker exists.
- (c) → For each task description, run `node tools/tasks/add.js "<title>" [--due ...] [--lane ...] [--priority ...]`. Capture returned `TASK-N` ids into the event's `spawned_tasks` field.
- (d) → Append a dated section to the relevant cascade-target doc (e.g. `docs/validation/external-insights.md` for conversation findings) using its `Compression: chronological` format: `## YYYY-MM-DD — <title>` heading.
- After ALL non-skipped answers applied → stamp `gate_completed_at` (ISO now) on the event via the events lib.
- If the user picked `[skip]` → leave `gate_completed_at` null; the event resurfaces in tomorrow's wrap-up.

**Outreach add-on (Profile B only):** if `outreach/leads.csv` exists, also ask `[e] Lead status change? (e.g. call_done → verbal, or call_done → dead; "none" if unchanged)`. Update `leads.csv` via the Node load-mutate-save pattern in `tools/outreach/lib/leads.js`, then `node tools/outreach/sync-metrics.js`.

**Finally:** run `node tools/events/archive.js`. Moves gated events (terminal status + `gate_completed_at` set) → `events-archive.yml`. Idempotent.

## Step 5: Report

Print:
- **Metrics changed today** (before -> after, with deltas)
- **Docs updated** (list of files touched)
- **Verification warnings** (if any)
- **Tomorrow's top priorities** (carry-forwards + known agenda items)
- **Task hygiene** (if Step 4.5 changed anything)

## Step 6: Commit

Ask: "Want me to commit today's updates?"

If yes, commit with message: `eod YYYY-MM-DD: [one-line summary]`

## Tone

Direct. No fluff. Close out fast.

# Changelog

All notable changes to `create-battle-plan-outreach` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.0] - 2026-05-11

### Changed (breaking-but-backwards-compatible)
- **`leads.csv:call_at` column removed.** Time-based events now live in `events.yml` /
  `events-archive.yml` (single source of truth, see `create-battle-plan` 1.4.0). The CSV
  reader picks up live headers from row 1, so existing CSVs with a `call_at` column still
  load — the column is dropped on the next save once HEADERS propagates. Run
  `node tools/events/migrate-from-csv.js --commit` once to split historical `call_at`
  values into the events files (idempotent).
- **`leads.csv:followup_template` column added** (between `inmail_template` and `notes`).
  Tracks which follow-up template the operator actually wrote (`FU` / `FU-B` / `FU-C` /
  `FU-FREE` / blank=legacy) — independent of the connection-note template, which is
  immutable per lead.
- **`VALID_STATUS`** in `lib/leads.js` now accepts `withdrawn` (invitation pulled — can
  be re-contacted by resetting to `new`).

### Added
- **FU template tracking.** Follow-ups in the daily blitz now render a backtick template
  marker per line: `- [ ] 🔄 \`FU\` [Name](url) · ...`. Default suggestion is `FU` for
  A/B/C-connected leads and `FU-B` for NONE-connected (the standard `FU` references
  "previously stated" — breaks for bare-connect). The operator swaps the marker to match
  what they actually wrote before flushing.
- **Three new FU template entries** in `templates.json`: `FU-B` (problem-fresh, for NONE),
  `FU-C` (direct call-ask, for NONE), `FU-FREE` (marker for bespoke hand-written messages).
  All `track: true` so reply/call attribution flows through `stats.js`.
- **`stats.js` — new "FU template breakdown" table** after the rollup follow-up line.
  Shows sent / reply / call per FU template style. Pre-tracking follow-ups display as
  `(legacy)`. Lets you measure "is `FU-B` better for NONE-connected leads than `FU`?"
- **`flush-targets.js` regex update** captures the optional backtick FU template from
  the line. Backwards-compatible: legacy lines with no backtick still parse (template
  becomes empty, attributed as `(legacy)`). The write path now sets
  `lead.followup_template` and stamps the template id into the notes prefix:
  `"Follow-up sent YYYY-MM-DD (FU-B) | ..."`.
- **Daily-targets follow-up section** prints all three FU variants for copy-paste with
  hint about when each fits.

### Refactored
- **`sync-metrics.js`** — `callDone` / `callBooked` flags now use
  `events.leadHadCall(linkedin_url)` (unions events.yml + events-archive.yml) and
  `events.eventsByLead()` (for future scheduled). The dead-lead-that-had-a-call edge case
  is preserved because the historical event row carries `status=done` regardless of the
  lead's current status. Defensive: if the events directory is absent, falls back to
  no-op stubs and metrics still derive (status-only) — useful while migrating.
- **`update-dashboard.js`** — same `events.leadHadCall` swap in `rowFlags()`.
- **`flush-updates.js`** — when Haiku emits a `call_at` field (still the easiest English
  parse), the value is now routed through `events.upsert()` instead of written to the
  lead row. The resulting event has `type=unspecified` (operator fills in via wrap-up
  gate or `events/add.js --id N`) and `status=scheduled` if future, `done` if past.
- **`flush-inbox.js`** and **`flush-updates.js` new-lead default** — dropped `call_at: ''`
  from the row template. Cosmetic — since HEADERS no longer contains `call_at`, the field
  would have been dropped on write anyway.

### Migration
- Run `node tools/events/migrate-from-csv.js --commit` once (idempotent). It scans every
  row with non-empty `call_at`, emits events into events.yml (future) or events-archive.yml
  (past), then clears the `call_at` values. The column itself drops on the next leads.csv
  save once you've updated `tools/outreach/lib/leads.js`.
- New `followup_template` column is added automatically on next save. Existing rows
  without it bucket as `(legacy)` in `stats.js`. No backfill needed.
- All metric derivations (outreach_sent, responses, discovery_calls, calls_booked,
  invitations_accepted, verbal_commitments) preserve their values after migration — the
  events-driven derivation reproduces the old `call_at`-driven counts exactly.

## [1.2.2] - 2026-04-21

### Fixed
- Rejection now works on **any** lead status, not just `new`. Previously,
  ticking `[x] reject` on a `dm_sent` lead (typical in the InMail or
  follow-up section) did nothing — status stayed `dm_sent`, no tag, no
  note, and the lead re-surfaced in the next blitz. The processor loop
  is now idempotent: it marks any non-`dead` lead as `dead` and appends
  a `(was dm_sent)`-style audit trail to the note when the prior status
  wasn't `new`.
- Ticking `[x] reject` **and** `[x] 🗑️ withdraw connection` on the same
  line now records both signals. Reject still wins precedence (lead is
  terminal), but a `Connection withdrawn on LinkedIn` note is written
  so the record matches what you did on LinkedIn.
- Rejected items now also flow through `applyMetadataEdits()`, so
  inline `emp:` / `rev:` / `type:` corrections on a reject line persist.

### Changed
- Console summary after flush now annotates rejections that came from
  non-new stages, e.g. `❌ Rejected 6 leads (marked dead) (incl. 5 from
  prior stages)`.

### Migration

No schema change. Leads where you previously ticked `reject` on a
non-`new` row and nothing happened are still `dm_sent` in your CSV.
Two options:
1. **Do nothing** — next time they appear in a blitz, re-tick reject and
   this version will handle them.
2. **Backfill** (optional) — any lead whose `notes` contains a
   `Rejected in blitz YYYY-MM-DD` line but whose `status` is not `dead`
   can have its status flipped to `dead` in a one-shot CSV edit.

## [1.2.1] - 2026-04-21

### Fixed
- Inline metadata edits (`emp:`, `rev:`, `type:`, title, country) on
  follow-up rows in the daily blitz were silently dropped on flush —
  only `type:` was being synced back to `leads.csv`. Symptom: "I keep
  fixing `emp` and `rev` on the same follow-up leads every day and it
  never sticks." The follow-up and snooze branches in `flush-targets.js`
  now route through the same `applyMetadataEdits()` helper already used
  by the withdrawal, InMail, and new-DM branches.
- You can now edit metadata on a follow-up row **without** ticking any
  action checkbox. The parser picks up the inline edits and persists
  them via the existing `isMetadataOnly` path — same behavior the
  withdrawal section has always had.

## [1.2.0] - 2026-04-21

### Fixed
- Follow-up cooldown now anchors to the accept date instead of the original DM
  date. Previously, when a lead accepted a weeks-old connection request, the
  3-day follow-up cooldown was measured against the original DM — so the lead
  landed in the next day's follow-up pool before they'd had a chance to react
  to the connection note. `flush-accepts.js` now stamps `followed_up_at = today`
  whenever it tags a lead as `accepted`, so the cooldown restarts from the
  accept date.

### Added
- **Snooze button** on follow-up items in the daily blitz. Tick
  `[x] 💤 snooze (not ready yet)` to defer a follow-up without sending a
  message: `followed_up_at` is reset to today, no metric is bumped, and the
  lead reappears in the follow-up pool 3+ days later. Use cases:
  - Manual override when the 3-day heuristic is too eager (e.g. the lead
    has been actively viewing your profile).
  - Retroactive fix for leads tagged `accepted` before the `flush-accepts.js`
    fix above shipped.

### Migration

No schema change, no manual migration required.

Leads that were tagged `accepted` **before** this release will not have a
proper `followed_up_at` stamp. They will surface in the follow-up pool
anchored to the old DM date. You have two options:

1. **Snooze them one by one** as they appear in the daily blitz — the new
   snooze button handles this cleanly.
2. **Backfill manually** (optional, for high-volume users): for every lead
   with the `accepted` tag and no `followed_up_at`, copy the accept-date
   from the `notes` field (pattern `Accepted connection YYYY-MM-DD | …`)
   into the `followed_up_at` column of `outreach/leads.csv`.

## [1.1.0] - 2026-04-20

- Priority scoring, rejection loop, InMail gating, stale invitation tracking.
- Fix: use proper ISO 8601 week numbering in weekly breakdown.

## [1.0.0] - Initial release

- CSV-powered outreach pipeline with daily blitz, metrics sync, and
  mermaid dashboards as a Battle Plan add-on.

[1.4.0]: https://github.com/paulkunhardt/battle-plan/releases/tag/outreach-v1.4.0
[1.3.0]: https://github.com/paulkunhardt/battle-plan/releases/tag/outreach-v1.3.0
[1.2.2]: https://github.com/paulkunhardt/battle-plan/releases/tag/outreach-v1.2.2
[1.2.1]: https://github.com/paulkunhardt/battle-plan/releases/tag/outreach-v1.2.1
[1.2.0]: https://github.com/paulkunhardt/battle-plan/releases/tag/outreach-v1.2.0
[1.1.0]: https://github.com/paulkunhardt/battle-plan/releases/tag/outreach-v1.1.0
[1.0.0]: https://github.com/paulkunhardt/battle-plan/releases/tag/outreach-v1.0.0

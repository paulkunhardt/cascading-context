# Changelog

All notable changes to `create-battle-plan` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.2] - 2026-05-23

### Fixed
- **Folder name no longer derives from the one-sentence description.** The Q1
  answer (e.g. "Personal admin work like bills, taxes, private events, and
  anything unrelated to work.") used to be slugified verbatim into an 80-char
  default folder name. Now Q1 stays a description (used in `battle-plan.md`
  TL;DR and Claude context), and a new **Q2 — "Short name for the folder?"**
  asks for the slug separately. Default is `path.basename(process.cwd())` when
  the cwd is empty and not a generic parent like `Projects`/`Documents`, so the
  common flow `mkdir paul-admin && cd paul-admin && npx create-battle-plan`
  picks `paul-admin` automatically — just press enter.

### Added
- **"Install in this folder (no subfolder)" option in the folder picker.**
  When `process.cwd()` is empty, the picker now offers installing files
  directly into cwd (no nested subfolder). Default-selected. Fixes the
  `mkdir paul-admin && cd paul-admin && ...` mental model that previously
  produced `~/Projects/paul-admin/paul-admin/`.

## [1.4.1] - 2026-05-22

### Added
- **`verify-cascade.sh` — four new checks (7-10) that catch real classes of
  cascade-system bugs.** Each check has an inline docstring explaining the
  failure mode it guards against:
  - **Check 7 — Qualitative wrappers near metric links.** Flags phrases like
    "exceeded N", "target hit ✓", "Nx better" that appear on the same line as
    a `metrics.yml#` reference. These wrappers can become factually wrong
    after `sync-metrics` auto-updates the linked number — the substitution
    is silent, the wrapper is now wrong, and nothing else surfaces it. Tunable
    via `QUALITATIVE_REGEX`. Warnings only, never errors.
  - **Check 8 — Personal-surface files on disk.** Catches the case where
    `tasks.yml`, `events.yml`, or `events-archive.yml` are missing on disk.
    These files are typically gitignored but the scripts (`render-today.js`,
    `due-for-gate.js`) silently no-op when they're absent, so a stray
    `git rm` (instead of `git rm --cached`) can delete them and create empty
    surfaces for days before anyone notices. Git-history-aware: errors only
    if the file was previously tracked (real recovery scenario); silently
    notes "not bootstrapped" if the file has never been tracked (fresh
    install — run `tools/init-project.sh` or create empty stubs). Includes
    recovery instructions using `git log --diff-filter=D`.
  - **Check 9 — Amended-doc UPDATE block discipline.** For every doc with
    `Compression: amended`, diffs against `origin/main` (fallback `HEAD`) and
    warns if content lines were added without a new
    `> **[UPDATE YYYY-MM-DD · Source: ...]**` block. Catches silent rewrites
    that break `/distill`'s ability to tell old from new. Skipped silently in
    fresh repos without git history.
  - **Check 10 — Chronological-doc dated headings.** For every doc with
    `Compression: chronological`, diffs against the same base and warns when
    new `##` or `###` headings don't match the dated patterns
    (`YYYY-MM-DD`, `Session N (YYYY-MM-DD)`, `Day N`). Standard fixed
    headings (TL;DR, Status, Daily Log, etc.) are exempted via
    `FIXED_HEADING_REGEX`, which you can extend for project-specific sections.
- **Shared `FIND_EXCLUDES` list** in `verify-cascade.sh` — every check now
  skips `examples/`, `superpowers/`, `archive/`, `social/`, `today-archive/`,
  `today.md`, and `CLAUDE.md`. Previously these were inline-duplicated on each
  `find`, causing checks to fire false-positive warnings on plugin-skill docs
  and archived snapshots.

### Fixed
- `verify-cascade.sh` Check 6 (`today.md` freshness) now emits a "today.md is
  fresh relative to tasks.yml" confirmation line on success, matching the
  output style of the other checks. Previously silent on success.

### Migration
- Fully additive. Existing installs: re-run `tools/verify-cascade.sh` after
  updating — Checks 9 & 10 silently skip in repos without `origin/main` or
  `HEAD`, so a fresh-clone smoke run still works. Existing repos may surface
  new warnings from Checks 7-10 on the first run; treat them as a one-time
  audit pass rather than a regression. None of the new checks are blocking
  errors except Check 8 (missing on-disk personal-surface files that were
  once tracked in git), which is a real recoverable failure.
- No schema break in `metrics.yml`, `tasks.yml`, `events.yml`, or any doc.

## [1.4.0] - 2026-05-11

### Added
- **`events.yml` + `events-archive.yml` — single source of truth for time-based events.**
  Calls, demos, meetings, advisor sessions, dentist appointments — anything with a start
  datetime AND a counterparty/attendee. Tasks (deadline-only, no time-span) stay in
  `tasks.yml`. Past/completed events live in `events-archive.yml` after the wrap-up gate
  captures transcript / spawned tasks / insights. IDs share a global sequence across both
  files; an event's ID never changes when archived.
- **`tools/events/` directory** (six files):
  - `lib/events.js` — YAML reader/writer with `load`, `save`, `upsert` (idempotent on
    `(lead_id, start)` tuple), `upcoming`, `todayEvents`, `dueForGate`, `leadHadCall`,
    `eventsByLead`, `defaultEnd`. Self-contained, no external YAML deps.
  - `add.js` — CLI: `node tools/events/add.js --title "..." --start "ISO" [--type ...]
    [--lead-id ...] [--attendee "X"]`. Idempotent — same lead_id+start updates instead
    of inserting. Used by Claude when the user mentions an event in chat.
  - `upcoming.js` — `node tools/events/upcoming.js [--json] [--today] [--days N]`.
    Single read path for "what's coming up?" Used by `render-today.js` and skills.
  - `due-for-gate.js` — returns events whose end-time has passed without `gate_completed_at`.
    Used by `/wrap-up` Step 4.5d (mandatory gate) and `/good-morning` Step 1.6 (warns when
    context-debt > 2 days old).
  - `archive.js` — moves gated terminal events to `events-archive.yml`. Auto-marks stale
    `>14d` scheduled events as `no_show`. Idempotent.
  - `migrate-from-csv.js` — one-shot migration for installs that previously stored scheduled
    calls in `outreach/leads.csv:call_at`. Splits into events.yml (future) + events-archive.yml
    (past). Idempotent. No-ops when no `leads.csv` is present (Profile A — base only).
- **`render-today.js` reads events.yml.** `buildCallsSection()` surfaces `events.todayEvents()`
  in the "Calls & meetings" block. `buildPulseSection()` adds an "Upcoming events" line from
  `events.upcoming()` (future-dated only — today's calls are surfaced separately).
- **`/wrap-up` Step 4.5d — Events gate.** Walks the user through every past event whose
  `gate_completed_at` is unset, one at a time, with a five-question menu (transcript path,
  hypothesis impacts, tasks spawned, insight worth saving, [skip]). Each answer cascades
  immediately to the right place (transcripts → `docs/archive/transcripts/`, hypotheses →
  `[UPDATE]` block in hypotheses.md, tasks → `add.js` calls, insights → chronological doc).
  After all non-skipped answers applied, stamps `gate_completed_at` and runs `archive.js`.
  Skip leaves the gate open; the event resurfaces tomorrow.
- **`/good-morning` Step 1.6 — Events context-debt warning.** Silent unless `due-for-gate.js`
  returns events older than 2 days. Then surfaces a `⚠️ Context-debt` line pointing at
  `/wrap-up` Step 4.5d. Does NOT walk the gate during morning — wrong time of day.
- **`/good-morning` Step 3 prompt:** "Any new events to schedule? Calls, demos, meetings I
  should add to `events.yml`?" — when the user names anything, Claude calls
  `tools/events/add.js` with the right flags instead of just acknowledging verbally.

### Changed
- **CLAUDE.md structural rewrite (310 → 205 lines, ~34% shorter).** Five-section structure
  in priority order: (1) How this project works, (2) The Cascade — stated once, (3)
  Behavioral rules — action-shaped "when X happens, do Y" rules, (4) Schemas & format,
  (5) Pointers. Each rule now lives in one place — no more drift from "never hand-edit
  metrics" stated 3x in slightly different wording. Outreach-specific rules are clearly
  marked "Profile B only". The backup is preserved as `CLAUDE.md.backup-2026-05-11`.
- **Render-today's calls section signature.** `buildCallsSection(leads)` → `buildCallsSection()`.
  No longer takes the leads array — pulls events directly from `events.yml`. The events
  lib loads lazily so the base template (no outreach add-on) still works even if a user
  removes the events directory.

### Migration
- Fully additive for the base package — `events.yml` and `events-archive.yml` are created
  empty. Existing installs: run `tools/events/upcoming.js` to confirm the events lib loads.
- Outreach add-on users (Profile B): also bump `create-battle-plan-outreach` to 1.4.0 and
  run `node tools/events/migrate-from-csv.js --commit` once to split your historical
  `leads.csv:call_at` column into `events.yml` (future) + `events-archive.yml` (past).
  Idempotent. Re-running it is safe.
- No schema break in `metrics.yml`, `tasks.yml`, or any existing doc.

## [1.3.0] - 2026-05-07

### Added
- **Task system v2 — lanes, implications, weekly triage.** Tasks now carry
  a `lane` field (default vocab: `build / outreach / discovery / infra /
  fundraising / meta`) grouping them by primary action. `today.md` groups
  open tasks by lane within each priority bucket and emits `#lane/<lane>`
  hashtags so the Obsidian Tasks plugin can filter on them. Tasks may
  also carry an optional `implications: [doc paths...]` array — the docs
  that should change when the task closes.
- **`tools/tasks/triage.js`** — read-only triage data layer. Surfaces
  overdue / stale tasks, recent commits mentioning each task ID, and
  *implications drift* (linked doc untouched since task creation).
  Markdown to stdout by default; `--json` for programmatic consumers;
  `--lane LANE` to filter; `--stale-days N` to tune.
- **`tools/tasks/triage-due.js`** — lightweight SessionStart-hook nudge.
  Silent unless triage is due (≥7d since last triage, or ≥20 stale
  ≥14d-old tasks, or ≥60 open total). Wired in `.claude/settings.json`.
- **`tools/tasks/migrate-lanes.js`** — one-shot heuristic backfill of the
  `lane` field on existing tasks. Tags-then-title two-pass classifier;
  generic keyword buckets; tasks falling through default to `meta`.
  Adapt the keyword table to your project. Idempotent.
- **`/weekly-triage` slash command** (`.claude/commands/weekly-triage.md`).
  Walks the user through every open task one at a time using
  `AskUserQuestion`'s arrow-key UI. Each decision (`done` / `snooze N` /
  `demote` / `merge X` / `delete` / `lane LANE` / `priority N` / `keep`)
  is applied to `tasks.yml` immediately. Stamps `last_triage_at` on
  completion to suppress the SessionStart nudge until the next cycle.
- **`in_progress` task status with `[/]` checkbox.** `render-today.js`
  emits `[/]` for in-progress tasks and `flush-today.js` round-trips it
  back to `status: in_progress`. Open ↔ in_progress transitions are now
  honored in the reconciler.
- **CLAUDE.md additions:** lane vocabulary table, weekly-triage workflow,
  strategic-vs-routine principle (`tasks.yml` is for ad-hoc strategic
  work; routine pipeline maintenance lives in `daily-targets.js` +
  `leads.csv` flags), and "personalities don't get their own lane".
- **`add.js` flags:** `--lane LANE` (validated against `VALID_LANES`,
  defaults to `meta`), `--implication PATH` (repeatable, accumulates to
  `task.implications`), and `--blocked-by N` (repeatable; comma-separated
  also accepted; each ID validated against existing rows).
- **`tools/tasks/archive.js`** — moves `status: done|cancelled` rows with
  `done_at < today - 14d` into a sibling `tasks-archive.yaml` (created on
  first run; same schema; sorted by `done_at` ascending). Idempotent.
  Backfill-safe: closed rows missing `done_at` get stamped today and kept
  one cycle. Flags: `--days N` / `--all` / `--dry-run`.
- **`/wrap-up` Step 4.5 — task hygiene as daily routine.** Three sub-steps:
  4.5a detect git-drift (open tasks with commits mentioning their TASK-N —
  prompt user to confirm closure); 4.5b run archive.js; 4.5c re-render
  today.md so closures land on the day's surface.
- **`blocked_by: [TASK-IDs]` field** on tasks. When at least one blocker
  is still open: triage shows a `🚧 Blocked by:` line per task; the stale
  flag and snooze-or-demote suggestion are suppressed (a deliberate
  blocker shouldn't penalize the task); replacement suggestion becomes
  "blocked — chase blocker(s) or demote"; stats gain a "Blocked by
  another open task: N" line. `render-today.js` emits a `🚧 blocked-by:
  TASK-N,TASK-M` token on the task line — only for *still-open* blockers,
  so the token disappears once a blocker closes.
- **`triage.js` source-context.** Each task now shows a `Source:` line
  derived from three signals: (1) battle-plan day match — scans
  `docs/battle-plan.md` for headings in three formats and maps
  `task.created` → "Day N — title"; (2) transcript references —
  regex-extracts `docs/archive/validation/transcripts/...` paths from
  the task's `tags` + `context`; (3) hint tags matching
  `^(spawned-by-|from-|call-|h\d+)`. Helps the user re-orient on tasks
  whose origin context has faded.

### Fixed
- **`lib/tasks.js` array-int serializer.** Integers inside arrays were
  being wrapped in quotes on round-trip (`blocked_by: ["74"]` instead of
  `[74]`), which would break `byId.get(id)` lookups in triage. Latent
  before — `implications` are strings; surfaced now that `blocked_by` is
  the first int-array field.

### Changed
- The Two-View Model section of CLAUDE.md is sharper: the chat is the
  user's only UI; the cascade and `tasks.yml` exist for the LLM, not
  the human. `today.md` is a thin clickable surface.

### Migration
- Fully additive. Existing `tasks.yml` rows without `lane` load fine
  and render under `meta`. Run `node tools/tasks/migrate-lanes.js --dry`
  to preview heuristic classifications, then re-run without `--dry` to
  apply. Adapt the `LANE_KEYWORDS` table in `migrate-lanes.js` to your
  project's vocabulary first.
- No schema break in `metrics.yml` or any existing doc.

## [1.2.0] - 2026-04-23

### Added
- **Script-owned daily task view subsystem.** New `tasks.yml` at repo
  root is the source of truth for open/done/snoozed/cancelled tasks.
  `node tools/tasks/render-today.js` regenerates `docs/today.md` from
  it, formatted for the Obsidian Tasks plugin (query blocks on top
  project pill-styled lists over a raw `## Task data` section at the
  bottom). `node tools/tasks/flush-today.js` reconciles checkbox edits
  back into `tasks.yml` and archives the daily file to
  `docs/today-archive/YYYY-MM-DD.md`. `node tools/tasks/add.js "..."
  [--due ...] [--tag ...] [--priority 1|2|3]` appends a task.
- **Two-View Model** documented in `CLAUDE.md`: the cascade is the
  LLM's orientation layer, `docs/today.md` is the user's operating
  surface. The LLM never grows the battle-plan TL;DR into a prose
  blob; tasks go through `add.js`, not buried in daily-log bullets.
- **`verify-cascade.sh` Check 6**: warns if `tasks.yml` is newer than
  `docs/today.md` (prompts `render-today.js`).
- **`README.md` — "How this system is meant to be used"** section
  explaining the two-layer model (cascade vs. today.md) before
  installation, so first-time users don't over-edit the battle plan
  and under-use the daily surface.

### Changed
- `good-morning` command gathers state via `render-today.js --quiet`
  and reads `docs/today.md` first. Battle plan is read on-demand for
  deep context, not by default.

### Migration
- Fully additive. Existing battle-plan projects: run
  `node tools/tasks/render-today.js` once to generate
  `docs/today.md`, install the Obsidian Tasks plugin (optional — the
  raw `- [ ]` lines still work in any markdown editor), start adding
  tasks via `add.js`.
- No schema break in `metrics.yml` or any existing doc.

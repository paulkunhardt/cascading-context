# Changelog

All notable changes to `create-battle-plan` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

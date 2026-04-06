# Documentation Vault Rules

These rules govern all documents in this vault. Follow them on every update.

---

## 1. Update, Don't Duplicate

Amend existing docs with timestamped updates. Never create a new file that makes an old one obsolete.

**Amendment format:**

> **[UPDATE YYYY-MM-DD · Source: person/research/call]** New finding here.

## 2. Cross-Link Everything

Claims validated or invalidated by another doc must link to it. Use relative paths:
`[Document Name](relative/path/to/doc.md)`

## 3. Confidence Levels on Every Claim

Mark every claim with one of:
- `Unvalidated` — no evidence yet
- `Soft signal` — directional but not confirmed (e.g., 1-2 anecdotes)
- `Practitioner-validated` — confirmed by someone who does this work
- `Data-validated` — confirmed by quantitative evidence

Always include the source: who said it, when, in what context.

## 4. Source Reference Format

**Registry metrics** (defined in `metrics.yml`):
`[**N**](metrics.yml#field_name)`

**Inline metrics** (from another doc):
`(→ source-doc.md#section-slug)`

**Rule:** Every number referenced from another document MUST include a source annotation. Only numbers native to a doc (where they originate) have no annotation.

## 5. Minimize File Count

Notes from the same person go in ONE file, appended with dates. Don't create a new file per conversation — append to `external-insights.md`.

## 6. Source Everything

Every claim needs: who said it, when, and the confidence level. Unsourced claims get `Unvalidated` until sourced.

## 7. Record and Transcribe Calls

Every call, meeting, and significant conversation should be recorded (with consent), transcribed, and integrated into the relevant docs. External input is the highest-value content in this system.

## 8. Standardized Frontmatter

Every doc in `docs/` must have:

```
**Last Updated:** YYYY-MM-DD
**Status:** Active | Draft | Archived
**Role:** source-of-truth | cascade-target

**TL;DR:** One paragraph summary with sourced numbers.
```

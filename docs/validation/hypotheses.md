# Hypotheses & Validation Tracker

**Last Updated:** 2026-03-21
**Status:** Active
**Role:** cascade-target

**TL;DR:** 8 hypotheses tracked. **3** validated or partially validated after [**3**](metrics.yml#discovery_calls) discovery calls. Strongest signal: H1 (evidence collection is the bottleneck) confirmed by all 3 calls. H3 (pricing at €199-399/mo) has 1 verbal commitment. H5 (LLM can reason about compliance) untested — critical risk.

---

## Problem Hypotheses

### H1: Evidence collection (not certification) is the real bottleneck
- **Confidence:** Practitioner-validated (3 independent sources)
- **Impact:** Critical
- **Status:** Validated
- **Evidence:** All 3 discovery calls confirmed. Sam (DataGuard Pro): "I spend 3 days before every audit just pulling screenshots." Priya (CloudSecure): "We tried building internal scripts — gave up after 2 months." Morgan (RegTech): "I compile evidence from 4 different tools manually."
- **Kill criteria:** If <30% of interviewees report this, thesis weakens.

### H2: Existing tools are "expensive checkbox software"
- **Confidence:** Soft signal (2 sources)
- **Impact:** High
- **Status:** Partially validated
- **Evidence:** Sam called Drata "a glorified spreadsheet." Morgan said "we pay $15K/year for what's basically a task list." Priya was more neutral — "it's fine, it just doesn't do the hard part."

---

## Solution Hypotheses

### H3: Pricing at €199-399/mo is viable
- **Confidence:** Soft signal (1 verbal commitment)
- **Impact:** Medium
- **Status:** Partially validated
- **Evidence:** Morgan (RegTech Solutions) verbally committed to beta at €299/mo. Sam said "under $500/mo is a no-brainer." Priya couldn't commit without VP approval.

### H4: AI evidence collection is technically feasible
- **Confidence:** Low
- **Impact:** Critical
- **Status:** Untested
- **Evidence needed:** Technical prototype connecting to 3-4 common tools (AWS, GitHub, Jira, Slack)

### H5: LLMs can reliably reason about compliance requirements
- **Confidence:** Low
- **Impact:** Critical
- **Status:** Untested
- **Evidence needed:** Accuracy benchmarks on real compliance scenarios
- **Key risk:** Hallucination in compliance = legal liability

---

## Validation Log

| Date | Hypothesis | Action | Finding |
|------|-----------|--------|---------|
| 2026-03-10 | All | Initial hypothesis creation | 8 hypotheses documented |
| 2026-03-17 | H1, H2 | Discovery call: Sam Rivera | H1 strongly confirmed. H2 confirmed ("glorified spreadsheet"). |
| 2026-03-19 | H1 | Discovery call: Priya Patel | H1 confirmed. Internal scripts failed — too many edge cases. |
| 2026-03-20 | H1, H3 | Discovery call: Morgan Chen | H1 confirmed (4-tool evidence compilation). H3 soft signal (verbal commit €299/mo). |

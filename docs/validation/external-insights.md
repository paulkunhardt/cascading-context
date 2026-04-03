# External Insights

**Last Updated:** 2026-03-21
**Status:** Active
**Role:** cascade-target

**TL;DR:** 3 discovery call sessions recorded. Key theme: evidence collection is universally painful, existing tools handle certification but not the daily documentation grind. Morgan Chen (RegTech) is first verbal commitment for beta.

---

## Session 1 (2026-03-17) — Sam Rivera, GRC Lead at DataGuard Pro

### Context
First discovery call. Sam manages ISO 27001 compliance for an 85-person fintech. Found via LinkedIn outreach.

### Key insights
1. **Evidence collection is a multi-day ordeal.** Sam spends 3 full days before each audit pulling screenshots and exporting logs from AWS, GitHub, and Jira. `Confidence: Practitioner-validated`
2. **Drata is "a glorified spreadsheet."** Pays $15K/year. Uses it for task tracking and audit scheduling, but evidence collection is still entirely manual. `Confidence: Practitioner-validated`
3. **Access reviews are the worst.** Quarterly access reviews across 40+ SaaS apps take 2 full days. No automation — manual export, manual comparison. `Confidence: Practitioner-validated`

### Raw quotes
> "I spend 3 days before every audit just pulling screenshots. Drata tracks what I need to collect, but I still have to go get it all myself."
> "It's basically a glorified spreadsheet. A $15K spreadsheet."

### Action items
- [x] Update hypotheses H1 and H2 with Sam's evidence
- [ ] Follow up in 2 weeks to share early wireframes

---

## Session 2 (2026-03-19) — Priya Patel, Compliance Director at CloudSecure

### Context
Second discovery call. Priya leads a 3-person compliance team at a 200-person cloud security company. Manages SOC 2, ISO 27001, and HIPAA.

### Key insights
1. **Internal automation attempts fail.** CloudSecure tried building Python scripts to auto-collect evidence. Gave up after 2 months — too many edge cases, API changes, false positives. `Confidence: Practitioner-validated`
2. **60% of time on evidence, not compliance.** Priya estimates her team spends 60% of their time collecting and formatting evidence, 20% on actual compliance decisions, 20% on audit coordination. `Confidence: Practitioner-validated`
3. **Multi-framework overlap is painful.** SOC 2 and ISO 27001 have ~40% control overlap but Drata tracks them separately. `Confidence: Practitioner-validated`

### Raw quotes
> "We tried building scripts — gave up after two months. Every tool's API is different, things break, and you can't trust the output without checking."
> "The actual controls are usually fine. It's the proof and consistency over time that becomes the headache."

### Action items
- [x] Update H1 with Priya's evidence
- [ ] Follow up after VP approval process (2 weeks)

---

## Session 3 (2026-03-20) — Morgan Chen, CTO at RegTech Solutions

### Context
Third discovery call. Morgan is CTO of a 60-person regtech startup. Handles compliance himself alongside engineering leadership. No dedicated compliance hire yet.

### Key insights
1. **Solo compliance owner = no bandwidth.** Morgan does compliance as "one of 12 things." Spends ~5 hours/week, wishes it was 0. `Confidence: Practitioner-validated`
2. **4-tool evidence chain.** Compiles evidence from AWS CloudTrail, GitHub, Jira, and Slack manually. Copy-paste into a shared drive for auditor access. `Confidence: Practitioner-validated`
3. **Price sensitivity is lower than expected.** Morgan immediately accepted €299/mo for beta access. Said: "If it saves me 3 hours a week, it's a no-brainer." `Confidence: Soft signal`

### Raw quotes
> "I compile evidence from 4 different tools. It's all manual — copy from CloudTrail, screenshot from GitHub, export from Jira."
> "Under $500 a month? If it actually works, take my money."

### Action items
- [x] Log verbal commitment in hypotheses
- [ ] Send beta onboarding doc when ready
- [ ] Schedule follow-up for Week 3

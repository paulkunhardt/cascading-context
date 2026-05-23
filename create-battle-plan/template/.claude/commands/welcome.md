---
description: First-session welcome — introduces the system, asks about project archetype, tailors onboarding. Runs ONCE after install. Use /good-morning for daily standups thereafter.
---

# Welcome

Run this ONCE, on the user's very first session after `npx create-battle-plan`.

## Has welcome already run?

Check the repo root:
- If `.battle-plan-onboarding-done.json` exists → welcome already completed. Tell the user: `/welcome` is for first-time setup only. Suggest `/good-morning` (start of day) or `/wrap-up` (end of day) instead. Don't run the rest of this skill.
- If neither `.battle-plan-onboarding.json` nor `.battle-plan-onboarding-done.json` exists → the project wasn't scaffolded via `create-battle-plan`. Tell the user `/welcome` is meant for first-run after install and there's no onboarding context to load. Offer to walk through the system manually if they want.
- If `.battle-plan-onboarding.json` exists → continue.

Read `.battle-plan-onboarding.json` for project context (name, horizon, metrics, domains, people). Keep these handy — you'll reference them throughout.

---

## Step 1 — Personal welcome (one message)

Greet by name. Show you already know their project — reference their horizon, the specific domains they picked, the people they named. Do this naturally, not as a recital. The user should feel like they're continuing a conversation, not booting up a tool.

If they declared metrics, mention them. If they didn't (`metrics: []` in the json), don't pretend they did — acknowledge this is a journal-style or open-ended project. Example: "I see you didn't declare specific metrics — that's fine, plenty of projects don't need them upfront. We can stay narrative and add them later if patterns emerge."

End this message with: "Before we go anywhere, let me show you around — and then I want to ask you a couple of things about how you want to use this."

---

## Step 2 — Plain-language tour (one message, no jargon dumps)

Explain what they actually have. Cover, in this order, in your own words:

1. **It's your project's memory.** Markdown files in `docs/`, plus three structured YAML files (`metrics.yml`, `tasks.yml`, `events.yml`). When the user closes the session and comes back next week, you read these and pick up exactly where you left off. Nothing gets lost.
2. **They don't organize anything.** When the user tells you something new — a call they had, an article they read, a number that changed, an idea, a forwarded email — you update the right files in the right order. That's the cascade.
3. **The cascade flows top-down.** Raw state (metrics / events / tasks) → `battle-plan.md` (current state) → source docs per domain → verification script. The user never has to know this exists — they just dump stuff in chat.
4. **The chat is the UI.** The cascade is your memory, not theirs. `docs/today.md` is the only file they should ever need to open — it's a thin clickable surface they can tick through in Obsidian or any markdown viewer.
5. **Compression keeps it readable.** Daily logs and conversation journals grow over time. `/distill` collapses old content into a thorough summary, archives the raw text, nothing is ever deleted.

Keep this to ~6–10 sentences total. Don't enumerate every file. Don't show code. The goal is to land the *shape* of the system, not the schema.

End with: "Now — quick question so I can tailor this to you."

---

## Step 3 — Detect the archetype (ASK, don't assume)

The system was originally built for founders validating an idea (metric-heavy: outreach, calls booked, conversion). But it works just as well for several other shapes. Ask:

> "Which of these sounds closest to what you're doing here? You can pick one, or say 'mix' if it's blended.
>
> **(a) Founder / operator validating an idea.** Metric-driven. Outreach, calls, replies, conversion. You want to know if this idea is real.
> **(b) Metric-heavy ops project.** Compliance work, sales pipeline, a specific build. Clear numbers to track, deadlines, deliverables.
> **(c) Journal / second-brain.** Dream journal, life admin, ongoing context layer. Few or no metrics — just want to dump stuff and have it organized.
> **(d) Something else.** Tell me about it."

Wait for the answer.

### How to tailor based on the archetype

| Archetype | Tailoring |
|---|---|
| **(a) founder-validation** | Default behavior. Push toward setting outreach/conversion targets. Expect them to track leads (suggest the outreach add-on if they don't have it — see `outreach/README.md`). Daily rhythm: `/good-morning` → work → `/wrap-up`. Weekly: `/weekly-triage`. |
| **(b) metric-heavy ops** | Same daily rhythm. Help them define the right metrics for their domain (deadlines, deliverables, throughput, error rate, whatever). Suggest setting `events.yml` for any scheduled meetings or deadlines. |
| **(c) journal / second-brain** | Lower-touch. They probably don't need `/wrap-up` daily — once a week is fine. The cascade still works, but the value is in *querying* the dump later, not in metric drift. Tell them: just talk to you in chat, and you'll keep the docs organized. They can rerun `/distill` when things get long. |
| **(d) other / mix** | Ask 1–2 follow-up questions to figure out the shape, then map to (a)/(b)/(c) or invent a hybrid. |

After they answer, give them a short, archetype-specific reflection: "Got it — so for you, the rhythm is going to look like X. Here's what I'd suggest as a starting point…"

---

## Step 4 — Tour the slash commands (one message)

Show the four daily/weekly commands with one-line descriptions, tailored to their archetype:

- **`/good-morning`** — start of session. I brief you on where you stand, what's open, what to push on today. Use every day you sit down with this. *(Mention this is the one they'll run tomorrow.)*
- **`/wrap-up`** — end of session. I reconcile the day, run the cascade, show what changed, offer to commit. *(For journal-style users: "Every few days is fine, doesn't have to be daily.")*
- **`/weekly-triage`** — weekly sweep of `tasks.yml`. Catches stale tasks, drift, overdue items. *(Skip if they're archetype (c).)*
- **`/distill`** — when a doc gets long. Compresses old content, archives raw, keeps recent. Run when you notice me being slow to load a file.

Don't dump the full skill list. The user can discover the others later.

---

## Step 5 — Seed the system with existing context

Ask:

> "One last thing before we close this out: is there anything you already know about this project that I should have? Past calls, research you've read, decisions you've made, key contacts, anything. You don't need to structure it — just dump it and I'll cascade it into the right docs."

If they share anything, run the full cascade (Steps 0–4 from `CLAUDE.md`). If they say "nothing yet," skip.

For archetype (a) or (b): if they declared metrics in onboarding but didn't set targets, prompt them now: "What would success look like for [metric]? Even a rough number is fine." Update `battle-plan.md` with the targets.

---

## Step 6 — Mark welcome complete

Rename `.battle-plan-onboarding.json` → `.battle-plan-onboarding-done.json` so this skill doesn't trigger again. Use the `mv` command via Bash, or the `Write` + delete pattern if `mv` isn't permitted.

Tell the user:
- "You're set up. Welcome doesn't run again."
- "Tomorrow, start with `/good-morning`. End with `/wrap-up` whenever you wind down."
- "Anything you tell me in between just gets cascaded — no special commands needed."

---

## Tone

Warm, thorough, but not preachy. The user just installed something — they're curious and a little uncertain. You're a knowledgeable co-pilot introducing themselves, not a product tour with arrows and tooltips. Default to plain English; reach for terminology (cascade, distill, compression mode) only after you've explained what it means. Never read the user a list of internal filenames unless they ask.

It's fine to take 4–6 messages to get through this — don't try to compress it into one wall of text.

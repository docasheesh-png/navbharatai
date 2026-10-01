# Build-report queue — every item not yet ✅

The sixth absolute rule (CLAUDE.md) keeps this file. **Read it before starting any work of our own choosing.**
A row leaves this table only when the PR that resolves it is MERGED; its ledger stays in `PROGRESS.md`.
A row with a PR number in **Owner** is taken by that session.

States: **OPEN** (actionable, nobody working it) · **IN PROGRESS** (owner set) · **🟡 BLOCKED** (all four fields:
what · why · needs · tried).

Seeded 2026-10-01 from the items the 6461025c and bee95692 autopsies left without a final state. Older
"OPEN root cause" entries in `PROGRESS.md` predate this file; move one here when it is next touched.

| ID | Report | Problem | State | Owner | Notes / last action |
|---|---|---|---|---|---|
| Q-004 | 6461025c | The lean reviewer could not run as one call: 44 changed files exceed the 60K inline bound, so it read files with tools | 🟡 BLOCKED | — | **What:** whether the one-call review should also cover apps larger than the bound. **Why:** an admin trade-off — on 6461025c the tool-reading review FINISHED (85/100, 33 s, inside its 45 s budget), so this is cost and speed, not a failure. **Options:** (a) keep as is — review with tools above the bound (recommended until a report shows it timing out on a big app); (b) review only the inlined files in one call and name the rest as not reviewed — cheaper, less coverage; (c) raise the bound — one call, a larger prompt. **Tried:** measured on this report. |
| Q-007 | bee95692 | `HEAL_NOT_DURABLE` | 🟡 BLOCKED | — | **What:** a heal whose write did not reach the saved project. **Why:** the report that showed it was truncated around the event. **Needs:** a full (untruncated) report carrying the code. **Tried:** read the available timeline. |
| Q-008 | bee95692 | Golden scaffolds ship `strict: false` | 🟡 BLOCKED | — | **What:** turning strict on. **Why:** it changes how every generated app typechecks; the effect on build success is unmeasured. **Needs:** an admin go-ahead for a measured trial (a cohort, compare build failures). **Tried:** nothing changed yet. |
| Q-009 | 6461025c | The GLM lead rung crawled (15 s abandoned) — provider latency | 🟡 BLOCKED | — | **What:** provider speed. **Why:** external (Z.ai). **Needs:** nothing from us beyond the existing bench, which worked (benched in 15 s). **Tried:** the throughput bench already handles it. |

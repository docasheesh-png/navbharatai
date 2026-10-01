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
| Q-001 | 6461025c | `@types/express` v5 beside `express` v4 — the model rewrote `package.json` by hand after `npm install` | 🟡 BLOCKED | — | **What:** a deterministic downgrade of the types. **Why:** the app typechecked clean on v5; forcing v4 could turn a green build red (first absolute rule). **Needs:** an upstream fix instead — stop hand-written dependency versions overriding what `npm install` resolved; that part is actionable and should be split out when worked. **Tried:** read `DependencyAnalysis.ts` (detection only, no fixer). |
| Q-002 | 6461025c | 3 icon-only buttons with no accessible name, noted at write time and not fixed | OPEN | — | The write-time note fired and the model ignored it. A deterministic fix needs a real name, which cannot be guessed safely; the likely root is that the note is advice, not a gate. |
| Q-003 | 6461025c | `src/index.css` edited 11 times piecemeal (3 failed edits) | OPEN | — | #3425 (merged) now hands unstyled screens back before the turn ends, and #3427 made a closing question no longer stop it. Confirm on the next real report before marking ✅. |
| Q-004 | 6461025c | The lean reviewer could not run as one call: 44 changed files exceed the 60K inline bound, so it read files with tools | OPEN | — | Decide whether the bound should scale, or the inline set be prioritised further; measure reviewer time on large apps first. |
| Q-005 | 6461025c | The feature-list card was not shown on a "हाँ." confirmation turn | OPEN | — | The spec stand-down (#3427) removes the harm for long specs; for a short confirmation reply the card's intent check still misses. |
| Q-006 | 6461025c | A CORS `origin: true` + `credentials: true` blocker has an upstream rule (#3427) but no deterministic repair | OPEN | — | Watch the next reports for `cors-credentials-reflect-origin`; if it recurs, build the repair. |
| Q-007 | bee95692 | `HEAL_NOT_DURABLE` | 🟡 BLOCKED | — | **What:** a heal whose write did not reach the saved project. **Why:** the report that showed it was truncated around the event. **Needs:** a full (untruncated) report carrying the code. **Tried:** read the available timeline. |
| Q-008 | bee95692 | Golden scaffolds ship `strict: false` | 🟡 BLOCKED | — | **What:** turning strict on. **Why:** it changes how every generated app typechecks; the effect on build success is unmeasured. **Needs:** an admin go-ahead for a measured trial (a cohort, compare build failures). **Tried:** nothing changed yet. |
| Q-009 | 6461025c | The GLM lead rung crawled (15 s abandoned) — provider latency | 🟡 BLOCKED | — | **What:** provider speed. **Why:** external (Z.ai). **Needs:** nothing from us beyond the existing bench, which worked (benched in 15 s). **Tried:** the throughput bench already handles it. |

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
| Q-007 | bee95692 | `HEAL_NOT_DURABLE` | 🟡 BLOCKED | — | **What:** a heal whose write did not reach the saved project. **Why:** the report that showed it was truncated around the event. **Needs:** a full (untruncated) report carrying the code. **Tried:** read the available timeline. |
| Q-008 | bee95692 | Golden scaffolds ship `strict: false` | IN PROGRESS | this PR (strict trial) | **Decided by the admin 2026-10-01 ("han"): run a measured trial.** This PR seeds 20% of NEW workspaces with `"strict": true` (`AGENTV3_STRICT_TRIAL` / `_PCT`, `strictTrial.ts`), records `STRICT_TRIAL` on every build and folds `byStrictCohort` into the daily cost telemetry. **After merge it waits on data:** compare `strict-new` with `loose-new` (success rate, cost, duration) over about two weeks of builds, then the admin decides 100% or off. Building it found two real starter defects (Panchang null check; Arcade `<Empty>` props), both fixed and locked by a census that typechecks every starter in both modes. |
| Q-009 | 6461025c | The GLM lead rung crawled (15 s abandoned) — provider latency | 🟡 BLOCKED | — | **What:** provider speed. **Why:** external (Z.ai). **Needs:** nothing from us beyond the existing bench, which worked (benched in 15 s). **Tried:** the throughput bench already handles it. |
| Q-010 | 19641ab5 | The workspace held only our starter's `index.html`: the machine (`started-by=files`) was refilled from an EMPTY durable store plus a warm cache holding one file | 🟡 BLOCKED | — | **What:** why an earlier machine of this workspace left one file in this instance's warm cache and nothing in the durable store. **Why:** the report carries only this build; the earlier session that touched the workspace is not in it. **Needs:** a report (or admin build-report session) that includes the build/Files-tab activity that FIRST created this workspace's machine. **Tried:** traced `_restoreFreshSandbox` and `ensureWorkspace`; #3435 made setup complete a starter fragment (`starterFragment.ts`, `starter=completed N` on `SETUP_TIMING`), so the outcome is right whatever the cause — watch for that marker to find the next instance. |
| Q-013 | iOS build 105 (admin screenshot 2026-10-01) | App Mart crashed with `c.missing.join` — WHICH guard answered the phone with an `{ error }` body (adaptive 429 / App Check 401 / global 500)? The crash itself is fixed (Q-012, PR pending) | 🟡 BLOCKED | — | **What:** the sentence that error body carried. **Why:** a session cannot read the production log or the phone. **Needs:** open App Mart → Publish on build 105+ once (the Publish tab now prints *"The store's status could not be checked just now (<sentence>)"*), or the admin Errors view for a 500 on `/api/nav-store/status`. A 429 means the per-IP adaptive burst guard is hitting a CGNAT phone network — a second real defect with its own fix. **Tried:** read every guard in front of the route; the route and its helpers cannot throw on their own. |

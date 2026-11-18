# BR1993 — a large-app first build: the planner spoke and an ETA was shown, then setup refused to reconnect

Scope: BR1993 only, inside the frozen audit boundary 1951..2105. Branched from origin/main `d6a417f2` (BR1992, #4269). Read only via the read-only failed-BR MCP tools (`list_build_reports`, `get_build_report`, `get_failed_build`, `get_failed_build_autopsy`, `list_scope_failures`). No remote autopsy write, replay, deploy, provider call, or production read or write happened outside those tools. Routing, billing, Router One and Pro Chain V2 admission were not touched. **No product code changed.**

## What the report holds (described generically; no request text, ids or timestamps)

- **The request:** a free Weak-tier **first** build of a large multi-feature AI media app (APP_SCOPE LARGE, about 18 features; complexity 83).
- **Engine:** Surplus was admitted. Two Surplus calls ran: the scope-admission classifier (about 8 s) and the mega-app roadmap planner (about 17 s). Both succeeded.
- **Before setup, the user saw:**
  - the roadmap's own message ("I'll build the working core first … in just a few minutes"), with the roadmap saved at step 1;
  - a labelled rough ETA of about 10–16 min;
  - "Setting up your workspace…".
- **Then:** within about a second, **SANDBOX_RECOVERY_UNAVAILABLE** ("Your workspace could not be safely reconnected. Please retry shortly.") and **OUTCOME_SANDBOX_UNAVAILABLE**.
- **Outcome:** failed in about 19 s. No commands ran, no files were written and no builder turn started.
- **Billing:** the report has no billing block and no charge record, so no cost is claimed. The two Surplus calls are supplier usage on a free build; their cost is not known from the report and is not estimated here.
- **Truncation:** complete. No saved autopsy exists for this report, and `list_scope_failures` for the workspace is empty.
- **Deployed code:** the report was written by code deployed **before** BR1983 (#4251) and BR1984 (#4254). It carries no admin-only refusal reason, and its outcome row has `phase: sandbox`. Main now records both differently (see E1 and E2).

## Root causes

| # | Defect in this report | Root cause | Closed by | Lock |
|---|---|---|---|---|
| D1 | The refusal carries no reason, so this autopsy cannot say which reconnect step refused (identity lookup, connect, allocation, winner) | The deployed `SandboxRecoveryUnavailableError` carried only the user sentence | **✅ Already closed on main by BR1983 (#4251).** All six reasons are now recorded on `adminDetail` (admin only), and the user view never copies it. A proven E2B cap on reconnect is now treated as capacity. | `tests/br1993Autopsy.test.ts` E1 (all six reasons; no-reason neighbour; no reason in message, summary, `detail` or the user view) |
| D2 | The outcome row is `phase: sandbox` | Deployed before the outcome normalisation | **✅ Already closed on main.** `BuildDiagnostics.record` normalises OUTCOME_SANDBOX_UNAVAILABLE to build/error/unresolved. | E2 |
| D3 | "Please retry shortly": the same workspace's next attempt (outside this audit item) failed setup again within seconds | First-refusal wording invites an immediate retry | **✅ Already closed on main by BR1984 (#4254).** A second refusal after a settled refusal is not retryable, uses the "try again in a few minutes" wording, and holds back the opening ETA. The first-refusal wording is unchanged, by BR1983's decision (an uncertain reconnect must not invent a machine). | E3 (repeat true; in-progress skipped; user-stop, later success and an unreadable list are not a repeat) |
| D4 | The ETA learned nothing wrong from an 18 s failure | `isTeachableBuild` excludes failed builds | No defect. Pinned. | E4 |
| D5 | On a **first** attempt, a 17 s planner call, the roadmap's "just a few minutes" message and a rough ETA all came before workspace setup, which then failed at once | The large-app planner and the ETA run before the build clock and setup, by design: setup latency is not added to every build. BR1983 recorded the same order ("not shipped"); BR1993 adds the large-app variant, where a whole planner call is spent first. | **🟡 BLOCKED — Q-2705** | E5 pins the current order, so a future change is deliberate |
| D6 | The two Surplus rows are labelled `SURPLUS` (admission) and `surplus` (planner), and the delivery count names one call | Two existing label paths. Every cost and ledger consumer compares in upper case (`providerRates`, `unbilledTurns`, the route's Surplus ledger split); the delivery count records builder-lane deliveries, not the admission classifier. | No defect established. Not changed. | — |

**Review residual (BR1992):** AgentRunner takes `recordModel` once at `run()` start, so a Surplus → Weak fail-open in the middle of a run can keep the Surplus name on later failed rows. This report is **not** on that path: no AgentRunner run started; the failure came during setup. **Not changed;** it stays a candidate for a report that shows it.

## Side-effect review (owner rule t311u)

| Candidate | Adjacent behaviour | Risk | Decision |
|---|---|---|---|
| Run workspace setup (or a reconnect probe) before the scope classifier, large-app planner and ETA | Adds setup latency and first-call timing changes to every build; BR1983 already rejected it without a replay | High | **Not shipped** → Q-2705 |
| Hold back the roadmap message and ETA on every first attempt until setup succeeds | Every large build's first line moves later; BR1984 limited this to a proven prior refusal | Medium | **Not shipped** → Q-2705 |
| Change the first-refusal "retry shortly" wording | An uncertain reconnect may clear quickly (BR1983 Phase 2 decision) | High | **Not shipped** |
| Unify the `SURPLUS` / `surplus` row labels | Every consumer already compares in upper case; renaming touches admin views and stats with no proven defect | Medium for no gain | **Not shipped** |
| Change `recordModel` to be read per call (BR1992 residual) | Not on this report's path | — | **Not shipped**; mentioned |
| Pin E1–E5 on this report's shape | Tests only | Low | **Ship** |

## Queue

New row **Q-2705** (BLOCKED): on a first attempt, the large-app planner, its message and a rough ETA run before workspace setup, so a setup that fails at once still spends a planner call and shows a promise. No row is closed. Q-2621 (E2B capacity) and Q-2703 are unchanged.

Lessons carried: BR1987 (no Node path changed; nothing newly charged), BR1989 (no parser loosening), BR1990 (no new refusal or discard rule). This PR changes no runtime code.

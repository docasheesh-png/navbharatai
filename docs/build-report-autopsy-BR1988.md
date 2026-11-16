# BR1988 — missing styles on a user-stopped unfinished build were treated as a leftover app defect

Scope: BR1988 only, inside the frozen audit boundary 1951..2105. Branched from origin/main `f7040b78b` (BR1987 non-Node launch plan, #4257). Read only via `get_build_report` — no remote autopsy write, no replay, no deploy, no provider call. `src/server/AI/RouterOne/*` and Pro Chain V2 admission were not touched.

## What the user asked

Generic summary: a request to build a small invoice-style form app. Distinctive request details, account/workspace/session/history/build identifiers, and precise event timestamps are omitted from public evidence.

## Event sequence (wall-clock timestamps omitted)

1. **Stage.** The build was admitted as an ordinary one-shot app on the Weak path. Surplus ran the fast lane and wrote several TypeScript screens and helpers. The planned file list was not finished (the remaining screens and their style rules were still to come).
2. **Stage.** The user asked for the build to stop. The in-flight model call was cancelled. The files written so far were saved. The outcome is STOPPED BY THE USER — no provider failed, and the app was never judged finished. The release gate was RED because the build was stopped before it could be finished or checked. Markup was waived because no live preview was proved; the AI subtotal was billed at real cost and was not debited from the wallet.
3. **Stage.** The post-answer integrity pass still compared the screens to the project stylesheet. Nine class names used by the unfinished screens had no style rule, so `CSS_CLASSES_UNDEFINED` was recorded as an unresolved warning of the app and opened in the issue queue. The CSS heal correctly did not run, because the build had been aborted. Design and accessibility scores of 100/100 described an incomplete tree.
4. **Stage.** Surplus also returned no token usage on the streamed path (`USAGE_NOT_REPORTED`). Nothing was over-charged. This is the same blocked receipt class as Q-2414 / Q-2363.

Outcome **stopped** (`ok=false`, `OUTCOME_USER_STOPPED`). The leftover warning was not a defect of a finished app; generation had been interrupted.

## Root causes, and where main already closed them

| # | Defect in this report | Root cause on the deployed code | Closed on main by | Lock in this PR |
|---|---|---|---|---|
| D1 | Nine class names used by unfinished screens were recorded as `CSS_CLASSES_UNDEFINED`, left unresolved, and opened in the issue queue after the user stopped the build | The integrity pass always recorded a warning when the mismatch crossed the threshold. The heal already required `result.ok` and `!abort.signal.aborted`, but the warning did not | **This PR** — if the build was stopped and the app was never judged finished (`result.readyAt` is absent), record the mismatch as info (`autoResolved`), not a leftover app warning. A finished app, including one stopped after it was judged finished, still gets the Universal Remote warning. A failed build that was not stopped is unchanged. The heal gate is unchanged | `tests/br1988Autopsy.test.ts`: a synthetic form-screen tree with only scaffold CSS is info, not queued, and not unresolved when stopped before `readyAt`; the same tree is a queued warning when finished, when Stop happens after `readyAt`, and when a failed build was not stopped; a styled tree and a two-class miss stay silent; the route passes `abort.signal.aborted` and `result.readyAt`; reversion of the guard fails the tests |
| D2 | Surplus streamed a turn without token usage, so the report's cost is an under-estimate | Streamed path (`stream_options.include_usage`) does not always receive usage from this provider | **Already on main as Q-2414 / Q-2363 (blocked)** | Not changed. This report's evidence is added to Q-2414: nothing was over-charged; the bill was at real cost, markup waived, and not debited. Reconstructing usage is still blocked on an existing provider receipt |
| D3 | `TIME_TO_FIRST_CALL` said 0s of preparation and a 0s first call, while setup timing and the first recorded call were longer | A pre-build admission call can be backfilled against a short timer window | **Already on main (BR1958 window-mismatch wording; BR1983 recorded the classifier-first wording)** | Not changed. Rewriting first-call attribution again would affect every build (t311u) |
| D4 | Design and accessibility scored 100/100 on an incomplete tree | The lint runs over the files that exist and can score a partial app as clean | **Not shipped** | Changing those scores would affect finished apps. The CSS finding is now honest about an unfinished Stop; the scores stay as they are |
| D5 | The user was billed at real cost (a 1-paisa line) and the wallet was not debited; markup and the 10% discount were waived because there was no proved preview | `CANCELLED_BUILD_CHARGED`, `MARKUP_WAIVED_NO_PREVIEW`, and `BUILD_DISCOUNT` already implement this policy | **Already on main** | Not changed. A failed or empty build is not newly charged |

## Side-effect review (owner rule t311u)

| Candidate | Adjacent behaviour | Risk | Decision |
|---|---|---|---|
| Record `CSS_CLASSES_UNDEFINED` as info only when aborted and `readyAt` is absent | A finished app with missing styles, including a later Stop, still warns and can still be queued. A failed build that was not stopped still warns. The heal still runs only when `result.ok && !aborted`. Below-threshold misses stay silent. Scaffold CSS with no matching rules still triggers the check on a finished app | Low if kept this narrow, with opposite-class tests | **Ship**, with neighbours |
| Also skip the warning when there is no stylesheet at all | The Universal Remote case included a scaffold stylesheet that the turn never rewrote. Hiding a finished app that has no stylesheet would reopen that blind spot | High | Do not ship |
| Suppress the warning whenever the user pressed Stop, even after `readyAt` | A finished but unstyled app that is stopped during preview would lose the Universal Remote finding | High | Do not ship |
| Reconstruct Surplus streamed usage or change the bill | Unknown usage is not free usage. Q-2414 stays blocked on an existing receipt | High | Do not ship. Carry Q-2414 |
| Rewrite `TIME_TO_FIRST_CALL` or change design/accessibility scores on stopped builds | Every build's first-call line and every design score would move | High without a replay that this was the DNA of the failure | Do not ship |
| Flip the stopped verdict or the charge only to tidy the report | The stop, the saved files, the waived markup, and the zero debit are already the intended policy | High | Do not ship |

## Queue

This commit closes no existing row. Q-2414 gains BR1988 evidence and stays blocked: Surplus streamed without token counts; nothing was over-charged; an existing provider receipt is still required. Q-2649, Q-2650, Q-2651, Q-2652, Q-2653, Q-2654, Q-2648, Q-2647, Q-2646, Q-2645, Q-2644, Q-2643, Q-2642, Q-2640, Q-2621, Q-2611, Q-2375 / Q-1068, Q-2662..Q-2672, Q-2702 and earlier blockers stay open.

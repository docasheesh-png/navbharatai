# BR2003: a very large quiz-app spec failed setup in one second; every defect is already closed, and the sizer gets queued

Scope: BR2003 only, inside the frozen audit boundary 1951..2105. Branched from origin/main `e8c45ef` (#4316, BR2002). Read only via the read-only failed-BR MCP tools. No replay, deploy, provider call or remote autopsy write. **No product code changed.**

## What the report holds (generic)

- **The request:** a first build on the free Weak tier. The prompt is a long, sectioned spec for a quiz game: a 100,000-question database, lifelines, levels, learning mode, login, leaderboard, an admin dashboard, and a Node/PostgreSQL/Firebase stack. It begins with a `Project Name:` header.
- **Outcome:** FAILED after about 1 s. SANDBOX_RECOVERY_UNAVAILABLE ("Your workspace could not be safely reconnected. Please retry shortly.") was followed by OUTCOME_SANDBOX_UNAVAILABLE. No commands ran and no files were written. Not charged. The only model call was the scope-admission classifier.
- **Window:** the same minutes as BR1999 and BR2001, which both hit the E2B cap of 20.
- **Truncation:** complete.

## Ledger

| # | Item | Root cause | State |
|---|---|---|---|
| D1 | SANDBOX_RECOVERY_UNAVAILABLE carried no reason | The error class deployed at the time held only the user's sentence | ✅ Closed on main by **BR1983 (#4251)**: the admin-only reason is recorded. Locked by `tests/br1993Autopsy.test.ts`. |
| D2 | "Please retry shortly" on a refusal that would repeat | First-refusal wording | ✅ Closed on main by **BR1984 (#4254)**: a repeat refusal says "in a few minutes". Locked by the BR1993 test. |
| D3 | ETA line: "the build took 0.0 min — 0.0× the midpoint and UNDER the band" | A setup failure was scored as if it were a completed delivery | ✅ Closed on main by **BR1986** (`ETA_UNTESTED_OUTCOMES` includes OUTCOME_SANDBOX_UNAVAILABLE). Locked here with this report's exact numbers. |
| D4 | The capacity behind the failure | The E2B concurrent-sandbox cap | 🟡 **Q-2621** (evidence appended). |
| D5 | FREE_BUILD_TIME_CAP said a paid build "would get 58 min"; other reports from the same window say 29 | Not established which figure is true | 🟡 Existing **Q-2750** (evidence appended). |
| D6 | APP_SCOPE: "mentions a small feature ("Quiz") but the app itself is "Project Name" — kept as one build" | (a) `requestSubject` stops at the header's colon, so the subject is the label. (b) The word "Quiz" vetoes every mega signal for a seven-section spec with an admin dashboard, auth and a backend. | 🟡 **Q-2770 opened.** Fixing (a) alone makes the subject "… Quiz Master …", which reads as a *small single-purpose app* and makes the decision worse. (a) and (b) have to be decided together, and that is a scope/routing behaviour change. Today's output is pinned exactly. |

## Proof

`tests/br2003Autopsy.test.ts` (3 tests):
- The ETA of this exact shape is untested; a neighbouring completed build is still scored UNDER.
- The sizer reproduces the report's own APP_SCOPE line, so any change to it is deliberate.

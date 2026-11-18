# BR1984 — a subsequent request on an existing app: reconnect refused again, after the last goodbye had invited a retry

Scope: BR1984 only, inside the frozen audit boundary 1951..2105. Branched from origin/main `23e11c2f3` (BR1983 proven reconnect capacity refusal, #4251). Read only via `get_failed_build` — no remote autopsy write, no replay, no deploy, no provider call. `src/server/AI/RouterOne/*` and Pro Chain V2 admission were not touched.

## What the user asked

Generic summary: a subsequent request on an existing app, shortly after a previous attempt on the same app ended with the reconnect goodbye. Distinctive request details, account/workspace/session/history/build identifiers, and precise event timestamps are omitted from public evidence.

## Event sequence (wall-clock timestamps omitted)

1. **Stage.** FREE_BUILD_TIME_CAP for a free build. APP_SCOPE: ordinary one-shot (no mega-signal). TIER_LADDER Weak default. COMPLEXITY_ROUTING opened on the first rung; the request was classified as a debugging turn by a bounded preflight. SURPLUS_ADMITTED. TIME_TO_FIRST_CALL: 0s of preparation and a 0s first call. An unevidenced rough estimate of several minutes was shown from the platform's recent debugging-turn average, with the basis line "No past builds of this app" (the previous attempt is present as `priorFailedBuilds: 1`, but a setup failure is not a teachable duration).
2. **Stage.** "Setting up your workspace…". Then **SANDBOX_RECOVERY_UNAVAILABLE**: "Your workspace could not be safely reconnected. Please retry shortly." **OUTCOME_SANDBOX_UNAVAILABLE**: the sandbox could not be recovered (infrastructure, not the app or the prompt). The retained report carries no underlying vendor detail, so the exact connect/lookup failure is not named here.
3. **Stage.** The build ended during setup, well under a second, far under the ETA band. No commands, no generated files, no later SANDBOX_UNAVAILABLE / SANDBOX_RECOVERED / fast-lane / preview block. One pre-timer Surplus scope-classification model call (recorded after the build timer started). The setup-recovery refusal path emits a failed result with billedUsd 0 / billedInr 0.

Outcome **failed** (`ok=false`), truncation complete. Summary: the workspace could not be safely reconnected; please retry shortly.

## Root causes, and where main already closed them

| # | Defect in this report | Root cause on the deployed code | Closed on main by | Lock in this PR |
|---|---|---|---|---|
| D1 | Setup aborted in under a second with SANDBOX_RECOVERY_UNAVAILABLE. A proven E2B concurrent-cap refusal during resume/reconnect was wrapped as that generic goodbye | `_createSandbox` treated a proven cap as uncertain reconnect | **Already on main**, #4251 / BR1983 — only the exact cap message is unwrapped; the recorded machine is not replaced | `tests/br1984Autopsy.test.ts` and `tests/br1983Autopsy.test.ts`: cap wording still does not create or restore; a later attempt still reconnects the same id; neighbours still refuse without replacement |
| D2 | Admin-only reconnect reasons must not reach users | A first revision of #4251 put the reason in `detail`, which leaked through `issues` / `problems` and the persisted conversation record | **Already on main**, #4251 follow-up — `adminDetail` plus `userFacingReport` / `compactReportForRecord` | Same file: live SSE diagnostics via `userFacingReport`, the persisted conversation record via `compactReportForRecord`, and the GET conversation reopen via `conversationToEvents` contain no reason token, including on the new repeated-refusal message. A different code's user-facing `detail` is still kept |
| D3 | TIME_TO_FIRST_CALL said 0s of preparation and a 0s first call, while the recorded Surplus scope call lasted several seconds | A pre-build admission call is backfilled after the build timer starts; clamping its latency into a few-millisecond window invented a zero-duration call | **Already on main**, BR1958 F11 (`windowMismatch`) | Same file: a 4774ms Surplus scope row recorded 4ms after the timer starts is reported as a window mismatch, not "took 0s". A compatible in-window call still reports preparation and model time |
| D4 | The previous attempt already ended with the reconnect goodbye. This subsequent request failed the same way, and the goodbye again said "Please retry shortly." | The recovery-unavailable path used a single retryable goodbye for every refusal, including a second consecutive settled refusal on the same workspace | **This PR** — if the newest settled prior attempt was a reconnect refusal, the new goodbye does not invite an immediate retry and the event is not marked retryable. The first refusal is unchanged. A missing or unreadable history, a user-stopped prior attempt, a create-time SANDBOX_UNAVAILABLE, or any other prior failure is not treated as a repeat | Same file: issue-code and goodbye matches; neighbours listed above do not match; `publishBuildException` uses `error.retryable` and still bills 0 |
| D5 | The user was shown a several-minute estimate, then setup failed in under a second | The opening ETA is emitted before `ensureWorkspace`. After a reconnect refusal, that order promises a build that has not yet proved it can reopen the workspace | **This PR** — only when the previous settled attempt was a reconnect refusal, the estimate is held back until `ensureWorkspace` succeeds. If setup fails again, the estimate is never shown, and the report records that it was not shown. Other builds still see the estimate before setup | Same file: route census for `holdEtaUntilSandbox`, the withheld-basis wording, and the post-`ensureWorkspace` emit |

The TIME_TO_FIRST_CALL line still says sandbox setup happens in the pre-call wait; on this path the admission classifier runs first. Moving setup before classification for every build would add sandbox latency to healthy requests (t311u). It stays recorded, not shipped. Auto-retry, raising the E2B cap, broadening the cap matcher, replacing the machine on an uncertain reconnect, and changing the first-refusal wording are not shipped.

## Side-effect review (owner rule t311u)

| Candidate | Adjacent behaviour | Risk | Decision |
|---|---|---|---|
| Repeat goodbye and `retryable: false` only when the newest settled prior attempt was a reconnect refusal | First refusal, user-stopped priors, create-time cap / F2, other failures, and a failed history read stay as they are | Low — the match is the reconnect goodbye or the `SANDBOX_RECOVERY_UNAVAILABLE` code, not a shared "SANDBOX_UNAVAILABLE" root cause | **Ship**, with neighbours |
| Withhold the opening estimate until sandbox setup succeeds, only on that same prior | Healthy first attempts and unrelated failures still show the estimate before setup. A successful reconnect still shows the same estimate, just after the workspace is up | Low — fail-open if history has not arrived; module-turn skip is unchanged | **Ship**, with census |
| Leave the BR1983 cap unwrap and admin-only reason paths as shipped | Privacy and machine-replacement invariants | None if left as shipped | Lock with tests, including the new goodbye |
| Leave the BR1958 TIME_TO_FIRST_CALL window-mismatch wording as shipped | Compatible in-window calls | None if left as shipped | Lock with this report's backfill shape |
| Broaden "previous failure" to any SANDBOX_UNAVAILABLE / cap | Would change the goodbye or hide the estimate after a create-time cap, where F2 already tells the user not to retry and #4251 can wait for a slot | Medium | Do not ship |
| Change "Please retry shortly" for the first refusal, auto-retry, raise the cap, or replace the machine on a non-404 | Phase 2: an uncertain lookup/reconnect must not invent a machine; a short retry can still be right for a blip; Q-2621 stays blocked | High | Do not ship. Carry Q-2621 |
| Run sandbox setup before the admission classifier on every build, or rewrite TIME_TO_FIRST_CALL | Changes timing and first-call accounting for every build | High without a replay that this was the DNA of the failure | Do not ship |

## Queue

This commit closes no existing row and opens no row. Q-2621 gains BR1984 evidence and stays blocked on ops. Q-2649, Q-2650, Q-2651, Q-2652, Q-2653, Q-2654, Q-2648, Q-2647, Q-2646, Q-2645, Q-2644, Q-2643, Q-2642, Q-2640, Q-2621, Q-2611, Q-2375 / Q-1068, Q-2662..Q-2672 and earlier blockers stay open.

# BR1983 — a short follow-up on an existing app: reconnect refused, the build aborted, and the goodbye invited a retry

Scope: BR1983 only, inside the frozen audit boundary 1951..2105. Branched from origin/main `0fade3ca0` (BR1982 leftover apply-patch markup / missing JSX flag, #4250). Read only via `get_failed_build` — no remote autopsy write, no replay, no deploy, no provider call. `src/server/AI/RouterOne/*` was not touched.

## What the user asked

Generic summary: a short follow-up asking to make an existing app comfortable on a phone. Distinctive request details, account/workspace/session/history/build identifiers, and precise event timestamps are omitted from public evidence.

## Event sequence (wall-clock timestamps omitted)

1. **Stage.** FREE_BUILD_TIME_CAP for a free build. APP_SCOPE: ordinary one-shot (no mega-signal). TIER_LADDER Weak default. COMPLEXITY_ROUTING opened on the first rung of an unsized app. SURPLUS_ADMITTED. TIME_TO_FIRST_CALL: 0s of preparation (the admission-classifier call is the first model call; sandbox setup had not run yet). An ETA of several minutes was shown from recent unsized-app builds.
2. **Stage.** "Setting up your workspace…". Then **SANDBOX_RECOVERY_UNAVAILABLE**: "Your workspace could not be safely reconnected. Please retry shortly." **OUTCOME_SANDBOX_UNAVAILABLE**: the sandbox could not be recovered (infrastructure, not the app or the prompt). The retained report carries no underlying vendor detail, so the exact connect/lookup failure is not named here.
3. **Stage.** The build ended during setup, well under a second, far under the ETA band. No commands, no generated files, no later SANDBOX_UNAVAILABLE / SANDBOX_RECOVERED / fast-lane / preview block. One admission-classification model call. The setup-recovery refusal path emits a failed result with billedUsd 0 / billedInr 0.

Outcome **failed** (`ok=false`), truncation complete. Summary: the workspace could not be safely reconnected; please retry shortly.

## Root causes, and where main already closed them

| # | Defect in this report | Root cause on the deployed code | Closed on main by | Lock in this PR |
|---|---|---|---|---|
| D1 | Setup aborted in under a second with SANDBOX_RECOVERY_UNAVAILABLE. A neighbouring create-time E2B concurrent-cap refusal is recorded as SANDBOX_UNAVAILABLE and the tool-capable builder can wait for a slot (and often later records SANDBOX_RECOVERED). A proven cap during resume/reconnect was wrapped as a generic recovery refusal, so the setup catch rethrew and never took that path | `_createSandbox` treats every non-404 `Sandbox.connect` failure as uncertain reconnect, including the exact concurrent-cap message the admission budget already classifies. `rethrowBuildSetupRecoveryUnavailable` then ends the attempt | **This PR** — if the refusal is a proven concurrent-cap message (shared exact matcher), rethrow that error and do not replace the recorded machine. Setup then records SANDBOX_UNAVAILABLE, shows the F2 notice, and can wait. Any other non-404 failure still refuses without replacement | `tests/br1983Autopsy.test.ts`: this cap wording on reconnect does not create, restore, or session-start, and is not `SandboxRecoveryUnavailableError`; a later retry still reconnects the same id. Neighbours: `429`, a different cap wording, "Sandbox not found", timeout, `fetch failed`, and 503 still refuse without replacement. A typed 404 still restores into a replacement |
| D2 | The goodbye said "Please retry shortly." For create-time cap, F2 already tells the user not to start the build again, because an immediate retry can make a hard cap worse | The recovery-unavailable path never reaches `sandboxUnavailableNotice()` | Same as D1 for a proven cap. A genuine uncertain reconnect keeps the existing retry wording (Phase 2: do not invent a machine) | Same file: F2 notice still has no retry invite; the setup catch still rethrows a real recovery refusal before `sandboxUnavailable = true`; a cap on reconnect is no longer that refusal |
| D3 | The retained report has no reason or detail on SANDBOX_RECOVERY_UNAVAILABLE, so this autopsy cannot name the vendor failure | `SandboxRecoveryUnavailableError` carried only the user-facing sentence; the crash record stored that sentence and nothing else | **This PR** — remaining refusals keep an admin-only reason (`identity-lookup`, `identity-unavailable`, `connect-unknown`, `allocation-unrecorded`, `allocation-lost`, `winner-reconnect`) in `adminDetail`. The setup wrapper forwards that reason. `userFacingReport` does not copy `adminDetail`. Putting the token in `detail` would leak through `issues` / `problems` into the client `diagnostics` event | Same file: each reason is present on the admin report and in `renderDiagnosticsText`; `userFacingReport` of the recorded refusal, and `publishBuildException` with that report as diagnostics, contain no reason token. A different code's `detail` is still kept |

The TIME_TO_FIRST_CALL line says sandbox setup happens in the pre-call wait; on this path the admission classifier runs first. That wording is misleading, but moving setup before classification would add sandbox latency to every build (t311u). It is recorded, not shipped.

## Side-effect review (owner rule t311u)

| Candidate | Adjacent behaviour | Risk | Decision |
|---|---|---|---|
| Unwrap only the proven concurrent-cap message on resume/reconnect; still never replace the machine | Create-time cap, the admission budget, and F2 already use this message. Generic 429 / 503 / auth / timeout stay recovery-unavailable | Low — the matcher is the existing exact regex, not a broader "rate limit" / "concurrent sandboxes" search | **Ship**, with neighbours |
| Record the reason on `adminDetail` and omit that field from `userFacingReport` | Other codes still keep their user-facing `detail` (after provider redaction). The admin JSON and admin text view still show the reason | Low — a first revision put the token in `detail`, which `userFacingReport` copies into `issues` / `problems` and the crash path then sent to the client as `diagnostics` (independent review) | **Ship**, with leak and neighbour tests |
| Leave a typed connect-not-found on the existing create-and-restore path | Days-later empty-machine restore | None if left as shipped | Lock with tests only |
| Broaden the cap regex to other wordings seen in older tests | Could treat a quoted sentence or a different rate-limit as a cap | Medium — a false cap unwrap would send a non-cap failure down the continue-and-wait path | Do not ship |
| Change "Please retry shortly" for every recovery refusal | Phase 2: an uncertain lookup/reconnect must not invent a machine; a short retry can be the right move when storage or transport blips | High | Do not ship |
| Auto-retry the sandbox or raise the E2B cap | Immediate retries under a hard cap of 20 can stampede (Q-2621) | High | Do not ship. Carry Q-2621 |
| Run sandbox setup before the admission classifier / ETA, or rewrite TIME_TO_FIRST_CALL | Changes timing and first-call accounting for every build | High without a replay that this was the DNA of the failure | Do not ship |
| Treat this report as a proven cap in the ledger | The retained report has no vendor detail | High — would invent a cause | Do not ship as a claim. The class hole is still fixed |

## Queue

This commit closes no existing row and opens no row. Q-2621 gains BR1983 evidence and stays blocked on ops. Q-2649, Q-2650, Q-2651, Q-2652, Q-2653, Q-2654, Q-2648, Q-2647, Q-2646, Q-2645, Q-2644, Q-2643, Q-2642, Q-2640, Q-2621, Q-2611, Q-2375 / Q-1068, Q-2662..Q-2672 and earlier blockers stay open.

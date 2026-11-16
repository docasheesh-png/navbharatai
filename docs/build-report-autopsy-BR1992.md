# BR1992 — a Weak/Surplus edit turn that ran into the 25-minute cap while building newly sent requests

Scope: BR1992 only, inside the frozen audit boundary 1951..2105. Branched from origin/main `a5e23403` (BR1990, #4265), with `01622f3c` (BR1991, #4267) merged in normally. Read only via the read-only failed-BR MCP tools (`get_build_report`, `get_failed_build`, `get_failed_build_autopsy`, `list_build_reports`, `list_scope_failures`). No remote autopsy write, replay, deploy, provider call, or production read or write happened outside those tools. Routing, billing, Router One and Pro Chain V2 admission were not touched.

## What the report holds (described generically; no request text, ids or timestamps)

- **The turn:** a free Weak-tier **edit** turn ("continue and fix it") on an existing small map-viewer app with 23 source files. The workspace is a spring-boot project that the platform serves through Node.
- **Engine:** Surplus was admitted for the Weak build and built every delivered turn, with 136 successful Surplus calls. The build's `noClaude` flag was set.
- **Outcome:** the registry says *succeeded* ("step limit reached, app verified READY"). The root cause says **STOPPED by the 25-min wall-clock cap**, not by the user. The ETA promised about 4.5–13.5 min and the build ran 25.1 min (ratio 3.8).
- **Billing:** the user was not charged, the wallet was not debited, and the bill was $0 (free tier). Sandbox cost is recorded as the platform's own. No cost is invented here.
- **During the turn:** the user sent several new messages, which the builder picked up and built, including after the builder's loop had ended, inside the integrity-repair pass.
- **Truncation:** the report kept 500 of 573 timeline entries; 73 middle entries are gone. Nothing in this document depends on them, and nothing in them is reconstructed.

## Root causes

| # | Defect in this report | Root cause | Closed by | Lock |
|---|---|---|---|---|
| D1 | The one model call stopped by the build's clock is filed under `claude-sonnet-4-6`, on a Weak `noClaude` build that only ever called Surplus | The Surplus session's runner (`createSurplusBuildSession().runner()`) and its pre-write fail-open wrapper had no `TurnRunner.plannedModel`. AgentRunner's failed/stopped rows therefore fell back to the request's Claude default. A sibling of Q-970 (that fix gave the tier chains a plan but missed the Surplus runner). Records only: no provider ever received that id. | **F1 ✅ RESOLVED.** The session runner exposes its sticky model as `plannedModel`. The wrapper names Surplus until it is dropped, then the Weak chain once it exists, and never builds the chain just to answer. | `tests/br1992Autopsy.test.ts` F1 (session, wrapper, stopped/failed AgentRunner rows, neighbours) |
| D2 | The user saw "⏱️ Almost done… running the final checks" again and again for about 12 minutes while the builder was building newly sent requests | `etaFinalChecks` was set when the loop ended and again when the integrity pass began. The integrity pass deliberately keeps listening to the user (`steerPoll`), but a pickup never ended the phase, so the live line kept saying "final checks" while new work was in progress. | **F2 ✅ RESOLVED.** The phase is now its start epoch (`etaFinalChecksAt`). The handoff stamps the moment it actually hands a message over (`lastTakenAt`). The pure `finalChecksAfterSteer` ends the phase only for a pickup **strictly after** it began. No pickup, an earlier pickup or the same millisecond keep main's answer. | F2 helper table, handoff stamps, phase-line results, wiring pin; existing ETA pins updated deliberately |
| D3 | Repair passes absorb new user requests and spend the remaining wall clock on new features. The build ended at the cap with the late additions unverified. | By design: heal and integrity runners are given `steerPoll` "so the team keeps listening through repair". Changing that risks losing or delaying user messages. | **🟡 BLOCKED — Q-2704** (owner product decision) | Not changed. F2's wiring pin asserts `steerPoll` is untouched. |
| D4 | `mvn` / `java` were not found (exit 127) in the Weak sandbox for a spring-boot workspace | The Weak sandbox has no JDK or Maven. The preview runs through Node, and `devServerLaunchPlan` already handles spring-boot. | Not changed: a sandbox-template or tier question, not a builder defect in this report | — |
| D5 | The agent killed the managed preview server with a process-list lookup (`kill $(ps … grep …)`), which the `pkill`/`killall` redirect in PreviewGuard does not match | The guard matches named kills only | Not changed: no lasting harm (the health check adopted the restart). Candidate only, since widening a command guard needs its own false-positive corpus. | — |
| D6 | `edit_file` old_string misses (self-recovered); the ETA overran 3.8×; "verified READY" in the step-cap summary | Model quality; new user requests during the turn; a static readiness scan at that moment | Not changed: no platform defect established | — |

**Sibling, not shipped:** the ProChainV2 runner's `plannedModel` names the first tail rung even when Surplus leads that chain. It is not on this report's path, and the change would need its own Pro-chain test matrix. It is mentioned here as a candidate.

## Side-effect review (owner rule t311u)

| Change | Adjacent behaviour | Check | Decision |
|---|---|---|---|
| F1: `plannedModel` getter on the Surplus session runner | What is dispatched | The plan equals the dispatched model (test). The getter only reads `model`, and no provider ever sees it. | Ship |
| F1: getter on the fail-open wrapper | Building the Weak chain lazily | When dropped and no chain exists yet, it answers `undefined` (main's fallback) and the factory is not called (test and mutation M3) | Ship |
| F1: AgentRunner rows | Runners with no plan; delivered turns | A runner with no plan still records the request model, byte-identical to main. A delivered turn is still named by `turn.model`. | Ship |
| F2: phase epoch plus pickup stamp | Builds with no user message (the normal case) | `lastTakenAt` stays 0, so `finalChecksAfterSteer(t, 0)` equals main's `true` once the phase is set. Both set sites still sit where the pins require. | Ship |
| F2: handoff stamp | Lane ownership, steering disabled, empty polls | Stamps only when messages are really handed over. A held lane, steering off and an empty queue never stamp (tests and mutation M7). | Ship |
| F2: TypeScript control-flow limit (TS2563) | The chat handler is at the limit | A first draft that added a statement in `steerPoll` hit TS2563. The shipped version adds **no statement** to the handler: only expression changes at the two readers and two existing assignments. Server and root typecheck pass. | Ship |
| End repair-pass steering (D3) | User messages during repair | Messages could be lost or delayed | **Not shipped** (Q-2704) |

## Queue

New row **Q-2704** (BLOCKED): should heal and integrity passes keep absorbing new user requests and spend the remaining clock on new features, or hand them to a follow-up turn? No row is closed. F1 is a sibling of Q-970's class (records name the chain's plan), closed here for the Surplus runner.

Lessons carried: BR1987 (Node paths byte-identical; no new charge), BR1989 (no parser loosening here) and BR1990 (fail-safe: F2 ends the phase only for a pickup that is positively later, and the F1 wrapper answers `undefined` when unclear).

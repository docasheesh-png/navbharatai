# BR2295 — Build report forensic autopsy

**Input shape:** a bare source-file path containing a game directory, not a build request.
**Result:** failed, zero application files produced  
**Fix branch:** `fix/br2295-path-only-and-answer-preservation`

Privacy: build identifiers and raw customer text are omitted. Source-path examples below are synthetic.

## Executive finding

This was not a model that was required to implement a game and refused to work. The user supplied only a source-file path. The path segment `game` was mistaken for a product-domain requirement, so the build pipeline admitted a game build, seeded a 12-file game kit, and spent a large model context. The model then read `src/game/audio/example.ts`, explained it, and asked what the user wanted next.

The build engine lost the model's full final turn because an earlier read-only `read_file` made the old `builtNothing` condition false. The starter-page summary then shortened the response and removed the trailing question from the text consumed by the outcome recorder. The result was a generic `OUTCOME_UNEXPLAINED` instead of the correct asked-user outcome.

A second outcome gap existed: when readiness had already set `result.ok = false`, the success-only empty-build summary path did not record `OUTCOME_EMPTY_BUILD`. The build therefore had no deterministic empty-build outcome when the model had not asked the user.

## Causal chain

1. **False domain admission:** `RequirementGapAnalyzer` matched `game` inside `src/game/audio/example.ts`. The same bare path was admitted by intent/build-confirmation routing.
2. **Unnecessary game setup:** `GAME_KIT_SEEDED` wrote 12 platform kit files; these were not application files. The game fast lane was skipped and the request received a game ETA based on 82 prior game builds.
3. **Read-only model turn:** the model called `read_file` and returned an explanation plus a question. It made no implementation writes.
4. **Answer loss:** `AgentRunner` did not preserve the full answer after the read-only tool call. `starterSummary` retained only the short status.
5. **Outcome loss:** the existing asked-user recorder could no longer see the final question; the empty-build outcome path did not run because readiness had already made the result not OK. The generic safety net wrote `OUTCOME_UNEXPLAINED`.
6. **Starter preview:** HTTP 200 proved only that the starter server was listening. The preview correctly identified the untouched starter and did not upgrade the build to success.

## Fixes in this branch

### Q-2650 — bare source paths are not build orders

- Added `sourcePathPrompt.ts` with a bounded source/config-path recognizer.
- Strip source-path tokens before shared domain keyword analysis, so path directory names do not become product requirements.
- Route a message consisting only of a source path to chat, not `new_build`.
- Add a second guard in `buildConfirmation`, including when the confirmation feature flag is disabled.
- Preserve explicit game intent outside the path. A real request such as “Build a game starting from src/game/audio/example.ts” still classifies as a game and still seeds the game kit.

### Q-2651 — preserve the turn and name the outcome

- On starter-blocker stand-down, preserve the complete final model turn before `starterSummary` shortens the visible status.
- Use the same `turnAskedTheUser` and `turnDeclined` detectors used by unfinished-resume logic.
- At stand-down, emit `OUTCOME_ASKED_USER` when the model asked for clarification and no builder-authored files exist.
- At stand-down, emit `OUTCOME_EMPTY_BUILD` when the build expected artifacts, no builder-authored files exist, the model did not ask or decline, and unfinished-resume has stopped.
- Treat platform-seeded files as non-builder output by requiring the route's live `hasExistingFiles()` callback to return false.
- Normalize outcome codes in `BuildDiagnostics.record`: asked-user stays informational and not auto-resolved; empty-build and sandbox-unavailable remain errors and not auto-resolved. The generic `onNote` adapter can no longer demote them to informational, auto-resolved notes.

### SURPLUS usage-warning guidance

- Source inspection confirms the dedicated `SurplusTurnRunner` sends `stream: false`.
- A missing/unusable SURPLUS usage receipt is therefore not caused by `AGENTV3_STREAM_BUILD_CALLS` or `stream_options.include_usage`.
- `BuildDiagnostics` now corrects the detail for SURPLUS usage warnings: keep the cost unmeasured and reconcile against the provider receipt/invoice. It does not invent token counts or cost.

## Evidence and disposition of every material signal

| Diagnostic signal | Finding | Disposition |
|---|---|---|
| `REQUIREMENT_GAPS` classified domain as game | The only game word was in a source path | Fixed by Q-2650 |
| `GAME_KIT_SEEDED`, 12 files | Platform kit, not app output | Prevented for path-only prompts |
| `FAST_LANE_SKIPPED_GAME` | Downstream of false game classification | Prevented for path-only prompts |
| `GAME_CONTRACT` had unknown genre and no controls/features | No actual game request existed | Prevented for path-only prompts; real game prompts retain domain |
| `USAGE_NOT_REPORTED` | SURPLUS did not yield a usable usage/receipt mapping | Warning guidance corrected; actual provider cost remains unmeasured |
| `READINESS_BLOCKER` | Starter entry was untouched | Correct safeguard; retained |
| `READINESS_WARNING` / no tests | No application code was generated | Consequence, not an independent test-runner defect |
| `WRITE_TIME_TYPECHECK` / no TypeScript written | No TypeScript implementation existed | Consequence |
| `E2E_SCAFFOLD_SKIPPED` | Build did not succeed; no app journey existed | Correct safeguard |
| `PREVIEW_PUBLISHED` / HTTP 200 | Server listened, not proof of app rendering | Correctly not treated as success |
| `RENDERED_ONLY_THE_STARTER` | Preview showed the seeded starter page | Correct safeguard; retained |
| `RELEASE_GATE` RED | No shippable app was proven | Correct verdict; retained |
| `OUTCOME_UNEXPLAINED` | The answer/outcome was lost and empty-build fallback was skipped | Fixed by Q-2651 outcome emission |
| `LADDER_DEPTH` outside ladder | SURPLUS was admitted outside the configured ladder by design | Not a routing defect; no ladder change |
| ETA 8.1–14.2 min vs 2.05 min actual | A path-only prompt was assigned the game cohort | Root classification fixed; no ETA model retune from this misclassified sample |
| Sandbox idle 93% | Warm session was started by the files path before this build | Not attributed to this prompt without further evidence |
| Peak memory 0.71/3.71 GB; no OOM | No memory pressure | No fix needed |
| Provider time wasted = 0 | No provider time was classified as wasted | No fix needed |
| User billing = $0 | Failed empty build was not charged | Correct; retained |

## Verification plan

New regression tests cover:

- Bare path recognition, including quoted/Markdown-wrapped paths.
- Shared domain analysis and game-kit seeding for path-only vs explicit game prompts.
- Build confirmation and intent routing.
- Full model-turn preservation before starter-summary truncation.
- Asked-user vs true-empty outcomes at unfinished-resume stand-down.
- Canonical outcome severity and non-auto-resolved status.
- SURPLUS non-streaming usage guidance, while preserving streaming guidance for other providers.

CI is the authoritative test gate. No test pass is claimed until the GitHub checks on this branch complete.

## Remaining external limitation

The diagnostic records a SURPLUS usage/receipt gap. The code now explains the correct transport and does not recommend changing a global streaming flag, but it cannot reconstruct a missing provider receipt. Internal provider cost for that response remains unverified and must be reconciled with SURPLUS. The user was billed $0; recorded sandbox cost was $0.005611.

## Repository coordination

- `BUILD_REPORT_QUEUE.md` is unchanged; the Q-2650/Q-2651 rows remain open until the fix PR is merged.
- `PROGRESS.md` is currently part of another live PR (#4170), so it is not edited concurrently. Append the BR2295 entry after that PR releases the file.
- This branch does not modify `routes/agentv3.ts`, which is also being changed in PR #4170.

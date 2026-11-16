# BR1981 — an attachment-specified study/quiz app: the sandbox was down, the fast lane still built nothing and called it a success

Scope: BR1981 only, inside the frozen audit boundary 1951..2105. Branched from origin/main `af1379506fb6ff276e2c05d64173f1d55f40d4f5` (privacy cleanup of the BR1980 ledger). No PR or autopsy for BR1981 or later existed. Read only via `get_build_report` — no remote autopsy write, no replay, no deploy, no provider call. `src/server/AI/RouterOne/*` was not touched.

## What the user asked

Generic summary: a one-line create-this-app request plus one text attachment describing a study/quiz app (~12k characters, tens of features). Distinctive request details and precise event timestamps are omitted from public evidence.

## Event sequence (wall-clock timestamps omitted)

1. **Stage.** FREE_BUILD_TIME_CAP 25 min. ATTACHMENTS_READ: one text attachment, no picture. PLANNING_CONTEXT used the message plus the attachment. APP_SCOPE: ordinary one-shot (~67 distinct features; kept as one build). TIER_LADDER Weak default (GLM → KIMI → GLM). COMPLEXITY_ROUTING "simple (score 88, model)" — opens on the first rung; requestAnalysis still called the task a complex app. SURPLUS_ADMITTED qwen3-coder. TIME_TO_FIRST_CALL: 0s of preparation. ETA ~13–23 min (unevidenced guess from recent complex-app builds).
2. **Stage.** "Setting up your workspace…". **SANDBOX_UNAVAILABLE** (E2B concurrent-sandbox cap of 20). The pre-#4146 goodbye said the engine was unavailable, files could not be created, and the user should try building again in a little while. Setup continued: build wiring, personal context, project context (file listing: **0 paths**). CHANGE_CLASSIFIED: new app. PROJECT_MODE on for the account but not a mega-project (5 enumerated parts counted).
3. **Stage.** The text-only fast lane ran anyway. It planned the file list, designed a shared contract, added helper/constant homes, and announced "Building 13 file(s) — one focused pass each…". Per-file ticks used a bare checkmark as each model call finished (11 of 13 announced) — those files were not on disk. 14 Surplus calls, all with zero tool calls; generate took 148.3 s of a 181.6 s lane.
4. **Stage.** A batch write then refused **12 of 12** files: "Could not read the existing … safely (transient sandbox error) — not overwriting it." The lane logged **"Built your app — 0 file(s), each generated individually."** A type-check note said the files were being **shipped unverified**. A foundation write refused package.json, index.html and vite.config.ts the same way. Install, dev-server and preview all failed on the same cap. **SIMPLE_BUILD_SUCCESS**: "Built your app file-by-file — 0 file(s)." FAST_LANE_PHASES recorded the 181.6 s. OUTCOME_BUILD_FAILED followed immediately, then VERIFY_DID_NOT_RUN, READY_BEFORE_END (never judged finished), WRITE_TIME_TYPECHECK (no TypeScript source written).
5. **Stage.** PLATFORM_PREVIEW_SKIPPED (no files). PREVIEW_NEVER_CAME_UP. RELEASE_GATE UNKNOWN / UNPROVEN ("The app was built, but nothing here was ever proven to RUN"). **OUTCOME_SANDBOX_UNAVAILABLE**. Free-tier upsell: "Your app needs our strongest engine to finish cleanly. Add credits and I will complete it on the best engine — nothing you have done so far is lost." MARKUP_WAIVED_NO_PREVIEW, then the bill was ₹0 (empty build, never charged). Real supplier cost $0.000619. LADDER_DEPTH: Surplus 14, ladder unused. TODO_ONLY_TURNS: none. Duration 3.3 min (0.2× the ETA midpoint, UNDER the band).

Outcome **failed** (`ok=false`), truncation complete. Summary: the sandbox was unavailable, no files could be created, installed or verified; please try again; not charged. Manifest `fileHashes` empty. 0 commands. counts: total 95, errors 2, warnings 25, autoResolved 0, leftOpen 0, healRule 3, unresolved 27.

## The real delivered tree (not a reconstructed model)

Nothing landed. The planned tree was an HTML/JS study/quiz app (page shell, helpers, catalog and subject data files). There was no `App.tsx` / `app/page` root, which is why the existing "refused root component" hand-off did not fire.

## Root causes, and where main already closed them

| # | Defect in this report | Root cause on the deployed code | Closed on main by | Lock in this PR |
|---|---|---|---|---|
| D1 | After SANDBOX_UNAVAILABLE the text-only fast lane still planned and generated for ~3 minutes (14 calls) into a workspace that listed 0 paths | `fastLaneWouldRun` did not exclude a failed setup, so a text-only lane spent tokens it could never write | **BR1952 (#4124)** `fastLaneWouldRun = !sandboxUnavailable && …` and `FAST_LANE_SKIPPED_SANDBOX` | `tests/br1981Autopsy.test.ts`: the skip is recorded and admission requires `!sandboxUnavailable`; neighbour: an available workspace still admits the lane |
| D2 | The goodbye said files could not be created and invited the user to try building again, while the build continued | Pre-#4146 notice | **BR1961 F2 (#4146)** `sandboxUnavailableNotice` | Same file: this report's old goodbye is gone |
| D3 | A free-tier empty infrastructure failure invited the user to add credits for a stronger engine, and said nothing so far was lost | Zero files was read as an engine-capability limit | **BR1952** `interrupted` includes `sandboxUnavailable`; the upsell is behind `!interrupted` | Same file: the gate includes `sandboxUnavailable` and the ask is behind it |
| D4 | Per-file ticks used a bare checkmark as soon as the model finished, before any write | Progress was tied to generation, not to a landed file | Already on main: `Generated … — not saved yet` | Same file: the new line is present; the bare checkmark form is gone |
| D5 | SIMPLE_BUILD_SUCCESS / "Built your app — 0 file(s)" / "shipping the files unverified" after every write was refused | `unwrittenEntries` only watches `App.tsx` / `app/page`. This HTML/JS plan has neither, so an empty `inPlace` still fell through to `ok: true`. `classifyBuildOutcome` already returns `BUILD_FAILED` for 0 files; the boolean did not agree | **This PR** — if no file landed, `runSimpleBuild` returns `ok: false` (`nothing_landed`) before the success log, verify, or preview | Same file: this report's plan + this report's write-refusal shape is not success; neighbour: the same plan with all or one landed write still succeeds; neighbour: an `App.tsx` plan whose root cannot be written still hands off (reason stays the root-component hand-off, not `nothing_landed`); neighbour: `unwrittenEntries` still does not treat `index.html` as a root; OneShot sibling already closed (Q-982) and locked |

The write-refusal wording ("existing file — not overwriting") is a conservative merge guard. It is misleading when the workspace is down, but loosening it could overwrite a real file on a transient read failure (t311u). After D1 the text-only lane does not start; this PR does not change the guard.

## Side-effect review (owner rule t311u)

| Candidate | Adjacent behaviour | Risk | Decision |
|---|---|---|---|
| Skip the text-only lane when setup failed (already on main) | The tool-capable builder can still wait for recovery | None if left as shipped — a mid-build re-entry of the text-only lane is not added | Lock with tests only |
| Do not invite a second Start (already on main) | User-facing notice only | None | Lock with tests only |
| Suppress the paid upsell when the sandbox never recovered (already on main) | Genuine engine-limit upsells on a live workspace stay | None | Lock with tests only |
| Return ok:false when 0 files landed | `classifyBuildOutcome` already says BUILD_FAILED; the route records SIMPLE_BUILD_FALLBACK and hands off. Verify/preview are not started. A lane that *did* land files is unchanged. This path does not forward `contractRenames` / `contractEnumsAsConst` — those stay on the two file-carrying hand-offs only | Low — there is no legitimate SimpleBuilder success with 0 files (a verified no-change turn is a different path) | **Ship** |
| Widen `unwrittenEntries` to treat `index.html` as a root | Would hand off some HTML-first plans that *did* land every file except a path that only looks like an entry | Medium — a new false hand-off | Do not ship. The 0-file guard is the class fix |
| Treat a transient read failure as permission to write | The refusal exists to protect a file that might already be there | High — a flaky read on a live workspace could overwrite user work | Do not ship |
| Retarget COMPLEXITY_ROUTING "simple (score 88)" | "simple" here means "opens on the first rung", not "this is a small app"; requestAnalysis still called it a complex app | High — changing the threshold changes every Weak opener | Do not ship. Wording only; not queued |
| Raise PROJECT_MODE because ~67 attachment features were counted as 5 parts | A looser trigger costs an ordinary app an extra planner call | High without a replay that proves the under-count is the DNA of the failure (the sandbox was down either way) | Do not ship |
| Auto-retry the sandbox or raise the E2B cap | Immediate retries under a hard cap of 20 can stampede (Q-2621) | High | Do not ship. Carry Q-2621 |

## Queue

This commit closes no existing row and opens no row. Q-2621 gains BR1981 evidence and stays blocked on ops. Q-2649, Q-2650, Q-2651, Q-2652, Q-2653, Q-2654, Q-2648, Q-2647, Q-2646, Q-2645, Q-2644, Q-2643, Q-2642, Q-2640, Q-2621, Q-2611, Q-2375 / Q-1068, Q-2662..Q-2672 and earlier blockers stay open.

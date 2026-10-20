# Retained failed-build audit — 2026-10-20

**NOT COMPLETE under CLAUDE.md rules five and six.** All 551 retained reports received an
individual terminal-cause review; this is not the exhaustive item ledger for every warning,
heal, fallback, skip, false finding and struggle point across all reports. **Q-1300** now has its
first two retained-surface item ledgers: [618b1c30](failed-build-autopsy-618b1c30-2026-10-20.md)
with 61 items and [cfd01074](failed-build-autopsy-cfd01074-2026-10-20.md) with 58 items. These
**119 items cover only two reports**: 93 OPEN / 4 IN PROGRESS / 22 genuinely information-blocked.
The remaining **549 reports have no exhaustive item ledger yet**; no original full transcript or
historical application closure is implied.

The persistent [551-row report index](failed-build-audit-2026-10-20.csv) records each safe report ID,
primary assessment, current source/tests, queue reference and next action. It contains no prompts,
raw model responses, credentials or copied log excerpts. Detailed retained evidence stays outside
the repository. A report row is not an item row, and no historical application was rerun.

Current resume: all five local checkpoints rebased cleanly onto main
`68528197949135513d2df97e3b4dee667036059a` (pre-documentation HEAD `459601558`). The earlier
exact tree `3efec7ea` passed 2,798 test files / 39,996 tests, with 67 skipped, and all 14 other
checks. That result applies to that earlier tree; the complete fresh-main gate is pending.
No follow-up PR has been created. Publish only after the new gate passes; merge requires the
admin to explicitly name that PR. The queue, persisted counts and unresolved work below are unchanged.

## Count correction

The earlier `fixed-this-turn = 26` field was a mixed code-coverage label. It did **not** mean
26 newly fixed root causes, 26 repaired applications, or 26 resolved reports. Comparing source
commit `f713e64bfcd3393540f1b9dc57a297a51764b445` with baseline
`c933893859bd3416c3aaf5ea3d3753e44817e95d`, the independent review found:

| Audited meaning of the 26 legacy rows | Rows |
|---|---:|
| contributor-fixed-terminal-unresolved | 7 |
| mitigation-only | 10 |
| terminal-root-class-fixed | 4 |
| reporting-or-diagnosis-only | 3 |
| already-covered-before-pr | 2 |

**Four demonstrated terminal platform defect classes are corrected at source/test level.**
Historical saved applications rebuilt and verified: **0**. Whole reports newly RESOLVED under
the sixth rule: **0**. The exploration steer is mitigation: the real model may still keep reading.
Late-provider attribution is diagnosis/reporting work, not proof all late activity was cancelled.
The two bare-heading findings already had baseline coverage and cannot count as new fixes.

| Report mapping for the four demonstrated classes | Class | Regression reference |
|---|---|---|
| `77a2ecf5-502c-47fa-8156-30b08656bbf4` | refusal-not-empty-build | `tests/aHindiRefusalIsStillAnAnswer.test.ts` |
| `fd6be05f-a538-48a9-86ea-75d19d7e5e61` | live-env-false-security-blocker | `tests/envSecurityFindings.test.ts` |
| `303836a7-0d2a-4120-823a-4cc7761b7bc3` | copied-native-bundle-as-source | `tests/appSourceIntegrity.test.ts` |
| `7ec82d80-a97b-4311-a9bf-fe1f23282192` | review-heading-as-critical | `src/server/AgentV3/ReviewerFindingSemantics.test.ts` |

The four-class count is locked by an isolated behavior reversion: the selected existing
report-shaped assertions passed **8/8 on f713e64** and failed **8/8 on the corresponding baseline
source** across four test files. The failures were behavior assertions, not missing modules.
The same name-filter selected those eight checks in both snapshots; 79 unrelated checks were
unselected in each. This proves source-class correction, not a historical app replay.

| Source replaced by its baseline version | Observed behavior reversion |
|---|---|
| `src/server/lib/promptSafety.ts` | The report-shaped Hindi decline again produces an ACT NOW build nudge. |
| `src/server/AgentV3/SecurityAnalysis.ts` | Live environment credential findings again become high-severity app blockers. |
| `src/server/AgentV3/HooksRulesAnalysis.ts` | Copied native/generated files again enter the authored-source hook scan. |
| `src/server/AgentV3/ReviewerAgent.ts` | Review section headings again count as extra critical/warning findings. |

New finishing/cancellation/restore, SDK-opening and fatal-account judge-chain gaps discovered
during the audit are tracked separately as **Q-1890–Q-1893**. They are IN PROGRESS on
`codex/failed-build-claude-audit-20261020`, pending the follow-up gate and merge. They were not
part of merged PR #3846 and are not counted as resolved here. The initial builder-chain balance correction did not cover repeated
judge re-reviews; Q-1893 records that missed sibling explicitly. Its change retires the failed
account/candidate only within the current judge chain and disables SDK retries where that chain
owns retry, preserving independent credentials, transient rate limits and fresh-chain eligibility.
Tier membership/order and pricing are unchanged. The four terminal-report class count is unchanged.
Q-1893's latest focused validation passed **10 files / 163 tests** and the server typecheck. The initial
isolated baseline restoration produced **7 failures / 4 passes**: six behavior failures and one
source-census failure, on the earlier 11-case regression selection.
The shared predicate is in `src/server/AgentV3/providerErrorClass.ts`, with consumers in
`src/server/AgentV3/providers/MultiProviderTurnRunner.ts`, `src/server/AgentV3/judgeChain.ts` and the judge candidate in
`src/server/routes/agentv3.ts`. Regression: `tests/aPermanentJudgeFailureIsNotRetried.test.ts`
(12 cases now). This is a newly found sibling fix pending the final gate and merge, not a fifth
proven historical terminal-report class or an application replay.

Q-1890/Q-1891 now use checked, applied restoration outcomes across **eight automatic undo
producers**: finishing recheck; the shared five-consumer verification callback; final GreenGuard;
design-heal undo; dead-file salvage; dependency prune; mobile build verification and its commit
consumer; and EndgameRepair with the real removal adapter. The shared door is
`src/server/AgentV3/snapshotRestore.ts`. A refused or failed operation cannot authorize forgetting
a file or claiming a complete rollback. Stop is checked again after awaited finishing reads and
before each new mutation; already dispatched operations may still complete. The final combined
validation passed **18 files / 875 tests** and the server typecheck. Regressions include
`tests/anAutomaticRestoreReportsOnlyWhatItApplied.test.ts` and
`tests/anEndgameRollbackClaimsOnlyWhatLanded.test.ts`; deferred Stop, partial restore and real
nonzero-removal behavior failed before the repairs. This finite undo census does not certify
all forward writers, durable bookkeeping or warm-cache invalidation.

Q-1892 passes caller cancellation and deadlines into streamed and non-streamed SDK opening in
`src/server/AgentV3/providers/OpenAiToolRunner.ts`, including the interval before any response exists.
`tests/aStoppedOpenAiRequestIsCancelled.test.ts` passed all five cases; the same five behavior cases
failed on baseline restoration. It is also included in the provider owner's final combined proof.
These are implemented follow-up source corrections, not historical application reruns.

Contributor fixes, diagnostics and mitigations remain useful work; their limits are retained in
the CSV's `auditedCoverageCategory` and `auditedCoverageAssessment` columns.

## Inventory and interpretation

- Scanned **94 pages**, followed every cursor to null, retrieved **551 unique full reports**.
- Retained starts range from **2026-07-13 through 2026-10-20 UTC**. Deleted/never-saved history is unavailable.
- The original root-summary counter called **135** reports user stops. Individual evidence differs;
  do not substitute that old headline counter for actor/cause analysis.
- The primary-disposition index contains the following legacy labels. They are assessment/coverage
  categories, not sixth-rule final states, and do not sum to a count of repaired reports:

| Legacy per-report label | Rows |
|---|---:|
| no-failure-user-stop | 183 |
| needs-investigation | 220 |
| fixed-this-turn | 26 |
| report-insufficient | 13 |
| already-covered | 101 |
| external-condition | 8 |

The separate `certainty = user-stop` label occurs in 191 rows and includes qualified legacy
summaries; 183 primary dispositions are `no-failure-user-stop`. Neither number certifies that
all earlier warnings in a cancelled run were fixed. Explicit platform non-user aborts outrank
generic as-asked wording. Post-`endedAt` telemetry is excluded from terminal causality and retained
as a contamination flag in the private evidence artifact.

## Queue and exact resume point

This change adds **401 pending rows** without deleting or closing existing rows: **341 OPEN**,
**17 IN PROGRESS**, and **43 genuine four-field BLOCKED**. Per-report IDs use
`Q-(1301 + zero-based report-index)` within the reserved range; holes are intentional. The first
61 individual items map I001–I061 to Q-1900–Q-1960; the second 58 map I001–I058 to Q-1963–Q-2020.
Q-1961/Q-1962 record the two Q-1899 siblings, Q-2021 the shared unsafe-orphan class, and
Q-2022–Q-2024 the failed-gate callback wait and two discovered native-identity source siblings.
The IN-PROGRESS rows are Q-1890–Q-1893, Q-1898–Q-1899, Q-1928, Q-1961–Q-1962,
Q-1982–Q-1984, Q-2021–Q-2024 and Q-2163, owned by `codex/failed-build-claude-audit-20261020` pending
its complete gate and merge. The earlier red checkpoint was not published; PR #3856 now tracks this implementation and its subsequent merged-state gate.

Q-1383/Q-1635/Q-1670/Q-1804 credit the four terminal source-class corrections merged in #3846,
but remain OPEN / owner — for remaining report-item review and unverified historical delivery.
Other independent investigations remain OPEN with no PR owner. Q-1300 remains OPEN: the two
retained-surface ledgers enumerate 119 items while 549 reports await itemization; enumeration
does not establish root-fix or final-verification completion. The first ledger is 46 OPEN /
1 IN PROGRESS / 14 four-field BLOCKED; the second is 47 OPEN / 3 IN PROGRESS / 8 four-field
BLOCKED. Item states, primary report rows and discovered source/CI items are distinct projections,
not repaired-report counts. Every blocked row retains its four requirements with owner —.
Known contributor fixes, mitigations and diagnostics remain credited to merged #3846 in notes;
that PR does not own remaining terminal investigations or these follow-up source changes.
The 220 legacy needs-investigation assessments are not automatically blocked because old generated
source is absent. The CSV keeps queue state/owner separate from legacy assessment labels.

**Q-1894 is OPEN / owner —:** source census found a possible warm-cache/restoration gap after a
confirmed shell removal. The relevant path is `_fileCache` in
`src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts` through `mergeRestoreSources` in
`src/server/AgentV3/sandboxRestore.ts`. Reproduce removal → cache invalidation → sandbox recreation
before changing precedence; blindly dropping warm source could lose unpersisted work. The current
restore applied-result fix does not claim to invalidate that cache. This is an unproved separate risk,
not a proven historical terminal cause or a reason to invent a BLOCKED state.

Three adjacent findings remain **OPEN / owner —**, distinct from the eight corrected undo producers:

- **Q-1895:** `restoreKitRules` and `snapSpacing` in `src/server/routes/agentv3.ts` guard the sandbox
  write, but their durable merge after an awaited write lacks a fresh Stop check. Trace the existing
  final-save preservation policy and reproduce the boundary before changing it; landed work must
  not be silently lost.
- **Q-1896:** FileGuardian forward reseeding in the same route ignores `writeWorkspaceFiles`
  written/skipped outcomes, then publishes and narrates the planned `plan.count`. Reproduce refused
  per-file writes and make delivery/count claims follow actual outcomes. This is forward reseeding,
  outside the automatic undo correction.
- **Q-1897:** `src/server/AgentV3/FastLaneContinuation.ts` can accept a full restart of the same
  truncated file while leaving `discardedReplies` empty; LAST-wins parsing replaces the partial.
  Trace per-contributor discarded-usage policy and the route's `discardTurnOutput` consumer before
  changing billing: a first reply can also contain retained completed files. The parsing/attribution
  edge is reproduced locally, but neither a universal full-reply refund nor a historical debit
  correction is established. No billing source change is included.

Existing owners are preserved. Report `67a2b0a2-1216-43a5-8380-8c4833886e77` reuses
**Q-1120/Q-1121/Q-1122**, whose routing, timeout-evidence and futility-policy decisions already
describe it. Provider-account funding is related to **Q-1210**; 51 retained reports show explicit
insufficient-balance HTTP429 evidence, including 25 original user-stop summaries. Retirement of a
bad rung does not fund that account, and the balance warning is not automatically the terminal cause.
Existing E2E image work remains **Q-107**, not a newly claimed package-install fix.

Resume with the combined follow-up final gate, including Q-1890–Q-1893, Q-1898–Q-1899 and Q-2021–Q-2024,
then Q-1300 and the actionable report rows,
including the four adjacent OPEN risks Q-1894–Q-1897: enumerate all report items, separate actual
application findings from provider/process observations, inspect current siblings and prior
PROGRESS entries, then prove each claimed root fix by behavior reversion. Keep each pending row
until its resolving PR is merged; no row is RESOLVED merely because this audit or a test exists.
Five-bucket totals across all 551 reports have **not** been computed and must not be invented from
the disposition table. The first report's 61-item tally is 30 observed recoveries, 2 workarounds,
16 skips/evidence gaps, 2 still-broken conditions and 11 struggle items, with counted deduplication
and retention limits in its ledger. The second report adds 33 observed recoveries, 4 workarounds,
9 skips, 2 still-broken conditions and 10 struggles. **Two-report-only totals** are 63 recoveries,
6 workarounds, 25 skips, 4 still-broken conditions and 21 struggles (119 items). No third report is
expanded in this batch; remaining one-by-one work resumes after the combined frozen gate.

## Prevention and evidence still needed

The highest-value next lever is complete, bounded final delivery evidence linked to the saved
application: actual served entry/export graph, the final failing command or authenticity file:line,
and trustworthy stop/deadline provenance. Only **6 retained reports have a structured
`generatedFiles` payload**. Other reports may retain partial source in clipped tool previews;
absence of that structured field does not mean zero source characters survive. A passing typecheck does not prove that the browser served the same module graph.
Use existing contracts and validators first; identify the precise missing handoff before adding a
new subsystem. This is a prioritized investigation, not a claim that every future build is error-proof.

## Verification boundary

The tested source milestone `f713e64` had 2,780 passing test files, **39,717 passed / 67 skipped / 0 failed**,
both TypeScript checks, production build and whitespace validation. Those checks establish that
source snapshot, not repaired historical apps. Hosted CI run `39359912519` passed for the original
PR [#3846](https://github.com/docasheesh-png/navbharatai/pull/3846), which another session merged at
03:33 UTC on 2026-10-20. The follow-up initially started at `adc53ee215beb5b7f7c5042245b2817c16a2deca` and is now
rebased on fresh main `885ba41023c2f7327be956aadc71f79ee2840821`; its primary source checkpoint
is `27f25e050082d470849d6e99c21f1789e71592a1` before the alias/docs integration. These changes
require their own combined final gate and merge. No deployment, historical app replay or sixth-rule
whole-report closure is claimed.

The follow-up's first full-suite gate **failed 11 safety-wiring assertions across eight test files**;
39,775 tests passed and 67 were skipped. The ten non-suite checks passed, which does not make the
gate green. **Q-1898 IN PROGRESS** records the completed targeted assertion repairs tracing the new
shared restoration door and applied-state save. The three validation batches passed 3 files / 62
tests, 3 files / 70 tests and 4 files / 57 tests; deliberate boundary mutations still failed.
No assertion was skipped or production code changed for that integration repair. A fresh complete
final gate is required; this is a CI-autopsy item, not a fifth historical terminal-report class.

**Q-1899 IN PROGRESS** fixes a contributor discovered in the first item ledger: 26 successful
unchanged-preview results renewed their own mutation epoch. Exact invocation/result receipts plus
unchanged actual work counters now distinguish no-effect preview, planning-only task and pure
recipe-help responses. Real edits, rebuilds/heals, delegated work and executing recipes remain
allowed; none of these tools is blanket-banned. Sources: `src/server/AgentV3/RepeatProbeGuard.ts`
and the narrow loop/dispatch region of `src/server/AgentV3/AgentRunner.ts`. Regressions:
`tests/anUnchangedPreviewCannotResetItsLoopGuard.test.ts` and
`tests/aPureToolReceiptCannotResetItsLoopGuard.test.ts`: **31 new cases (15 preview + 16 siblings)**.
The report-shaped real-dispatcher preview script ends honestly after 8 of 26 unchanged requests.
Isolated restoration of both original sources fails **all 8 selected behavior cases** (1 preview,
3 planning-only roles, 4 recipe-help paths); final generic source passes the identical eight, with
14 unrelated tests unselected. Combined targeted validation passed **8 files / 266 tests**, both
typechecks and unused-import validation. Q-1928 tracks the historical preview item; Q-1961/Q-1962
track the two discovered siblings. Full final gate and merge remain pending. This contributor
class correction does not establish historical app convergence or increase the four demonstrated
historical terminal-source class count.


## Second retained report and latest gate boundary

The [cfd01074 58-item ledger](failed-build-autopsy-cfd01074-2026-10-20.md) maps every retained
warning/error, recovery, workaround, skip and struggle to its own Q-1963–Q-2020 row. All 326 issue
slots / 348 expanded occurrences, 17 problem mirrors, 63 model calls and 16 commands were read.
The explicit 1500-second platform stop remains the terminal event; recovered provider calls are
contributors rather than replacement terminal causes. Late finishing writes and missing final
journey proof remain open. Retention limits, overlap and deduplication are explicit in the ledger.

**Q-2021 IN PROGRESS:** the actual cleanup graph ignored source-root alias edges, allowing three
imported screens to be classified as leftovers. The source-class correction shares local import
candidates, parses static/lazy/re-export/require edges and obtains package/compiler metadata at
the real dispatcher boundary. Unknown, computed, ambiguous, malformed or unreadable graph authority
cannot justify deletion. Genuine unused-screen cleanup, ordinary external packages and advisory
first-match behavior remain controlled. Shared data-entry/journey consumers were included.
Sources: `src/server/AgentV3/ArchitectureAnalysis.ts`, `src/server/AgentV3/journeyDerivation.ts`,
`src/server/AgentV3/ToolDispatcher.ts`. Regressions: `tests/anImportedScreenIsNeverALeftover.test.ts`
(41 cases) and `tests/anUnknownImportIsNotOrphanEvidence.test.ts` (18). Scoped validation:
**59 new passed; 11 files / 244 passed / 1 existing skipped**, both typechecks and unused-import
validation. Isolated original-three-source restoration fails **53 behaviors**, with 5 controls
passing; final source passes all **58 selected behaviors**, excluding one authority census.
Historical causal linkage is supported by complete import declarations inside a retained partial
App preview, but the full historical graph/runtime was not replayed. No fifth terminal-report
class or historical delivery closure is claimed.

The second complete suite attempt was also **RED: 39,822 passed / 67 skipped / 1 failed**. All
eleven old wiring failures were gone and all eleven non-suite checks passed. **Q-2022 IN PROGRESS**
records the actual callback-wait defect in `tests/crashReportsCarryNoSecrets.test.ts`: a controlled
50 ms digest delay failed the original fixed-delay wait and passed callback-based synchronization.
This led to separate source findings, **Q-2023** stale authentication hash/clear ordering and
**Q-2024** old SDK loading across reset. `src/lib/observability/index.ts` now uses auth revisions,
generation ownership and one shared SDK promise, eliminating the redundant cached-sink fast path.
Clears remain ordered before a succeeding identity even when a new hash fails or readiness resolves
back-to-back. Already-dispatched native I/O is not cancelled. Final native/privacy validation is
**71/71 passed**, with both typechecks and unused-import validation green. Original-module isolated
proof had seven behavioral failures and five passing boundaries; final source passes all twelve
selected source cases. The subsequently found cached-order case fails on the superseded checkpoint
and passes current source. Reset is reproduced with test dependency injection; no historical
build-report or production telemetry incident is asserted. Q-2022–Q-2024 remain IN PROGRESS until
the combined final gate and merge. The original four-class / zero-rerun / zero-report-closure
counts are unchanged; no red checkpoint has been published as a green PR.


Latest resume checkpoint: PR **#3856** is published. Main advanced to `3974c34d`
with deployment configuration and one configuration test; no application source or
dependencies changed. The local merge preserves both histories and awaits its final
merged-state gate at this freeze. Earlier checkpoint gates apply to their own trees;
the PR description and hosted run carry the latest verification result.


Hosted CI on original PR head `5db7cc763` exposed one authority-census timeout:
40,154 tests passed, one census timed out at 20 seconds, and 73 were skipped.
Q-2163 owns the class-preserving scan optimization and its final verification.
All2,453 input files retain the exact18-function policy census while AST parses
fall2,453→684. All18 focused tests pass, including six encoded-name boundaries;
one-CPU V8 census9.015s stays inside the unchanged20s cap. Three negative controls
still fail correctly. Full merged-state and hosted gates remain pending.
It adds one IN-PROGRESS integration row, not a historical terminal fix. Current
application source remains unchanged while this test harness is repaired.

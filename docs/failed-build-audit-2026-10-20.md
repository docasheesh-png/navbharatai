# Retained failed-build audit — 2026-10-20

**NOT COMPLETE under CLAUDE.md rules five and six.** All 551 retained reports received an
individual terminal-cause review; this is not the exhaustive item ledger for every warning,
heal, fallback, skip, false finding and struggle point across all reports. **Q-1300** now has its
first [retained-surface item ledger](failed-build-autopsy-618b1c30-2026-10-20.md): 61 items for
618b1c30, still 46 OPEN / 1 IN PROGRESS / 14 genuinely information-blocked. The remaining 550 reports have no
exhaustive item ledger yet; no original full transcript or historical application closure is implied.

The persistent [551-row report index](failed-build-audit-2026-10-20.csv) records each safe report ID,
primary assessment, current source/tests, queue reference and next action. It contains no prompts,
raw model responses, credentials or copied log excerpts. Detailed retained evidence stays outside
the repository. A report row is not an item row, and no historical application was rerun.

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

This change adds **338 pending rows** without deleting or closing existing rows.
Per-report IDs use `Q-(1301 + zero-based report-index)` within the reserved Q-1300–Q-1899 range;
holes are intentional. The 61 individual retained-item rows map I001–I061 to Q-1900–Q-1960; Q-1961/Q-1962 record the two discovered Q-1899 siblings. Their current states are **294 OPEN**, **9 IN PROGRESS**, and **35 four-field
BLOCKED**. Q-1890–Q-1893, Q-1898–Q-1899, Q-1928 and Q-1961–Q-1962 are IN PROGRESS, owned by the follow-up branch
`codex/failed-build-claude-audit-20261020`. Q-1383/Q-1635/Q-1670/Q-1804 credit the four terminal
source-class corrections merged in #3846, but remain OPEN / owner — for the remaining report-item
review and unverified historical delivery. The other actionable investigations are also OPEN with
no PR owner; the partial source changes do not implement their remaining work. Q-1300 is OPEN
because full-item work remains incomplete: the first retained-surface ledger enumerates 61 items
for one report, while the remaining 550 reports await itemization. That ledger's 46 OPEN / 1 IN PROGRESS / 14
four-field BLOCKED item states are separate from these primary queue-row totals. The new blocked rows retain their
four fields with owner —; merged #3846 does not own their external or missing-evidence dependencies.
Known contributor fixes, mitigations and diagnostics remain credited to merged #3846 in their notes,
while their independent terminal investigations stay OPEN. Only actual missing-information/external
cases have four-field BLOCKED rows. The 220 `needs-investigation` assessments are **not** automatically
declared blocked because their old generated-app checkout is absent. The CSV includes the current
primary queue state and owner separately from its legacy assessment/coverage labels.

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

Resume with the follow-up final gate for Q-1890–Q-1893 and Q-1898–Q-1899, then Q-1300 and the actionable report rows,
including the four adjacent OPEN risks Q-1894–Q-1897: enumerate all report items, separate actual
application findings from provider/process observations, inspect current siblings and prior
PROGRESS entries, then prove each claimed root fix by behavior reversion. Keep each pending row
until its resolving PR is merged; no row is RESOLVED merely because this audit or a test exists.
Five-bucket totals across all 551 reports have **not** been computed and must not be invented from
the disposition table. The first report's 61-item tally is 30 observed recoveries, 2 workarounds,
16 skips/evidence gaps, 2 still-broken conditions and 11 struggle items, with counted deduplication
and retention limits in its ledger. Next in one-by-one order: cfd01074-7c40-4514-8f26-36ae07fdb1ae.

## Prevention and evidence still needed

The highest-value next lever is complete, bounded final delivery evidence linked to the saved
application: actual served entry/export graph, the final failing command or authenticity file:line,
and trustworthy stop/deadline provenance. Only 6 retained reports contain any generated-file samples;
545 contain none. A passing typecheck does not prove that the browser served the same module graph.
Use existing contracts and validators first; identify the precise missing handoff before adding a
new subsystem. This is a prioritized investigation, not a claim that every future build is error-proof.

## Verification boundary

The tested source milestone `f713e64` had 2,780 passing test files, **39,717 passed / 67 skipped / 0 failed**,
both TypeScript checks, production build and whitespace validation. Those checks establish that
source snapshot, not repaired historical apps. Hosted CI run `39359912519` passed for the original
PR [#3846](https://github.com/docasheesh-png/navbharatai/pull/3846), which another session merged at
03:33 UTC on 2026-10-20. The follow-up branch starts from main
`adc53ee215beb5b7f7c5042245b2817c16a2deca`; the documentation and subsequent Q-1890–Q-1893 changes
require their own final gate and merge. No deployment, historical app replay or sixth-rule
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

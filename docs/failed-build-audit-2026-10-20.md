# Retained failed-build audit — 2026-10-20

**NOT COMPLETE under CLAUDE.md rules five and six.** All 551 reports have individualized
terminal-cause reviews; seven have retained-surface per-item ledgers. This branch contains
**7 ledgers / 281 individually queued items / 544 other reports awaiting repository item ledgers**.
The seven ledgers have **248 OPEN / 0 IN PROGRESS / 33 genuine four-field BLOCKED**; no historical
application has been rerun and no whole report is newly resolved.

| Retained report | Items | OPEN | Four-field BLOCKED | Item rows |
|---|---:|---:|---:|---|
| [618b1c30](failed-build-autopsy-618b1c30-2026-10-20.md) | 61 | 47 | 14 | Q-1900–Q-1960 |
| [cfd01074](failed-build-autopsy-cfd01074-2026-10-20.md) | 58 | 50 | 8 | Q-1963–Q-2020 |
| [6af23429](failed-build-autopsy-6af23429-2026-10-20.md) | 51 | 46 | 5 | Q-2025–Q-2075 |
| [b6283d2d](failed-build-autopsy-b6283d2d-2026-10-20.md) | 42 | 40 | 2 | Q-2076–Q-2117 |
| [12514b7f](failed-build-autopsy-12514b7f-2026-10-20.md) | 44 | 43 | 1 | Q-2118–Q-2161 |
| [78e7e226](failed-build-autopsy-78e7e226-2026-10-20.md) | 23 | 21 | 2 | Q-2164–Q-2186 |
| [4cf3ec76](failed-build-autopsy-4cf3ec76-2026-10-20.md) | 2 | 1 | 1 | Q-2190–Q-2191 |

The [551-row safe CSV](failed-build-audit-2026-10-20.csv) links each report and its retained
ledger/source/test/next-action evidence. Original all-item-resolved, historical-rerun and
whole-report-closure flags remain false. Only six reports have structured generatedFiles;
other partial source can survive in clipped tool previews. Private occurrence mappings, raw
prompts, model responses, command/output excerpts and credentials remain outside the repository.

## Current branch and publication boundary

This is unpublished work on `codex/failed-build-next-ledgers-20261020`, now integrated with
main `5474b0d0ed85e9192f56e0d70243d1dd1989c071`, preserving the payment-webhook correction
from PR #3857 and app data/storage boundaries from PR #3858. The escape-aware census refinement remains part of this new branch.
PR [#3856](https://github.com/docasheesh-png/navbharatai/pull/3856) was externally merged at
12:26:44 UTC; its scope was 2 ledgers / 119 items / 549 remaining. This batch adds **5 ledgers /
162 item rows plus 4 class/CI rows = 166 new audit rows**. Twelve merged shared-class rows leave
the pending queue, giving **net +154 from 400 to 554 pending audit rows**. No new PR has been
created; the complete final-source gate is pending. Publish after that gate passes, and merge
only when the admin explicitly names the new PR.

## Approved shared-platform closures

Twelve shared platform/source/CI queue rows are closed; four linked historical item rows
Q-1928/Q-1982–Q-1984 remain OPEN / owner —. The closure evidence is exact merged head
`5456d186caab683f5bec17f3aa5e0fb1506b6476` and main `72c3252d0faf33fd51987fbc2b9d991f7742953c`,
both tree `813484db9c1349164824bf025227175f52b3b4f0`. Required hosted [CI 39418902451](https://github.com/docasheesh-png/navbharatai/actions/runs/39418902451)
passed both build-and-test and database queue-retry jobs. The older `5db7cc763` timeout failure belongs
to a different head. The separate local `d68f6dfb4` gate passed 2,822 files / 40,289 tests / 67 skipped, all 14 additional checks and 14 database drills; that result proves `d68f6dfb4` only. The later `0d8ef9f5b` gate passed 2,826 files /40,408 tests /67 skipped, all14 additional checks and14 database drills after installing a real dependency directory; this proves that earlier tree only. The current latest-main integration still requires its own final gate.

| Closed queue | Shared class | Behavior/sibling proof |
|---|---|---|
| Q-1890 | live Stop after awaited finishing read | Two deferred-await races RED; per-mutation Stop reversion RED;18 files 875 PASS. |
| Q-1891 | automatic undo/removal reports applied outcome | Before 3 finishing+5 prune+5 mobile+5 Endgame behavior failures; real-rm/Stop reversions RED;18 files 875 PASS. |
| Q-1892 | pre-response SDK request carries caller abort/deadline | Five installed-SDK injected-fetch behavior cases FAIL baseline and PASS fixed; final 10 files 163 PASS. |
| Q-1893 | fatal judge candidate retired within composed chain | Initial 11 case selection:6 behavior+1 censusFAIL/4 PASS; final 12 cases included 10 files 163 PASS; independent credentials/transient/fresh-chain controls preserved. |
| Q-1898 | restore wiring guards follow shared door/applied save | Eleven original integration assertions repaired without skips; targeted 3/62+3/70+4/57 PASS; deliberate boundary mutations RED. Q2163 remains separate later census-performance/correctness work. |
| Q-1899 | no-effect actual receipts cannot renew probe epoch | Eight original-two-source real behaviors FAIL→same 8 PASS;31 newcases;8 files 266 PASS; preview 26 request script ends after 8. |
| Q-1961 | planning-only static task cannot renew probe epoch | Three planning-role behaviors in 8 case isolated reversion FAIL→PASS; baseline 15 calls 0 actualwork; shared 31 new/266 PASS. |
| Q-1962 | pure recipe help cannot renew probe epoch | Four help-branch behaviors in 8 case isolated reversion FAIL→PASS; real executing recipes remain eligible;shared 31 new/266 PASS. |
| Q-2021 | conservative graph authority for destructive orphan verdict | Original 3 sources 53 behaviorFAIL/5 controlsPASS→58 behaviorPASS,sourcecensus excluded;59 new/11 files 244 PASS1 existingSKIP. |
| Q-2022 | privacy test waits for actual async sink receipt | Controlled 50 msdigest originalwaitFAIL/callbackwaitPASS; all original privacy assertions retained. Final expanded file 71 PASS. |
| Q-2023 | auth revision and clear/new-identity ordering | Original-module first 12 case snapshot 7 behaviorFAIL5 boundaryPASS. Final 71 PASS; later 9622 reversion withfinaltests 1 orderFAIL70 PASS→same 71 PASS. Different proof snapshots explicitly distinguished. |
| Q-2024 | old SDK load cannot own reset module/cache | Controlled stale-loader/reset behavior failed original module in earlier 12 case snapshot; final generation-owned single readiness promise removes resolved-cache split;final 71 PASS with reset/clear/hash/native-inflight boundaries. |

All listed production bytes match merged main and the `d68f6dfb4` source checkpoint. The restore-census
test differs at localQ-2163; required hosted CI exercised its own exact merged test bytes.
Restore proof covers eight reviewed automatic undo producers; forward reseeding/durable merge
and warm-cache concerns remainOPENQ-1894–Q-1897. Native privacy proof does not cancel native
I/O already dispatched. These finite source-class corrections do not prove historical app delivery.

## Active new classes and remaining leads

**Q-2162 IN PROGRESS:** Implemented current direct typed-launch lifecycle and shared literal revival boundaries. Node 22 focused cohort:17 files 624 PASS/0 skip; isolated both-baseline-sources 37 behaviorFAIL/51 controlsPASS, baseline revival consumer 5 FAIL/83 PASS, restored current 88 PASS with no module errors. Historical 300.003s/EADDRINUSE process sequence is not replayed. Pending next-batch full/hosted gate and merge; historical Q-2039 remains OPEN.
Sources:[devServerHost.ts](../src/server/AgentV3/sandbox/EngineerAI/actuators/devServerHost.ts),
[devServerLaunchLog.ts](../src/server/AgentV3/devServerLaunchLog.ts); tests:
[direct-server](../tests/aDirectNodeServerIsManaged.test.ts), [managed-reuse](../tests/aDirectTypedServerUsesManagedReuse.test.ts).

**Q-2200 IN PROGRESS:** Implemented canonical 8 abort-code ETA scoring through inclusive upper bound: a non-delivery interruption is untested; past-bound interruption retains explicit lower-bound OVER evidence. Baseline and isolated original source 15 behaviorFAIL/3 controlsPASS; final 18 PASS and 5 files 99 PASS, both typechecksPASS. Does not prove app delivery or repair futility/heartbeat timing. ADVISORY_CAPPED delivery inference remains separate OPEN Q-2201. Pending next-batch full/hosted gate and merge; historical Q-2177 remains OPEN.
Source:[BuildDiagnostics.ts](../src/server/AgentV3/BuildDiagnostics.ts);
[regression](../tests/aStoppedBuildCannotMeetItsDeliveryEta.test.ts). No universal successful-delivery
claim is made for advisory outcomes.

**Q-2163 IN PROGRESS:** The integrated census checks 2,458 input files and the exact 18-function
policy set, using 685 AST parses. All 18 focused cases pass. The earlier one-CPU V8 probe on the
2,453-file pre-integration corpus took 9.015 seconds, within the unchanged 20-second timeout.
The local `d68f6dfb4` checkpoint's complete gate passed; this new final tree and its hosted CI
still need their own gate. Q-2162, Q-2163 and Q-2200 are the only three IN PROGRESS audit rows,
owned by `codex/failed-build-next-ledgers-20261020`. Q-2039/Q-2177 remain OPEN for historical
process and saved-score evidence.

**Q-2201 OPEN/owner —:** advisory-cap code alone does not prove a completed app. Reproduce the
truthy build-result reference, later syntax/review ok=false transitions and final critical check
in the route before changing existing advisory ETA policy. This is a current-source lead, not
a proved historical 78 terminal cause or an implemented fix.

## Count interpretation and original terminal classes

Pending audit queue: **554 =497 OPEN /3 IN PROGRESS /54 four-field BLOCKED**. All blockers retain
what/why/needs/already-tried; actionable source investigations are not automatically blocked
because a historical checkout is missing. Original 551 disposition labels are assessments, not
resolved-report totals:183 user-stop /220 needs-investigation /26 legacyfixed-label /13 insufficient /
101 already-covered /8 external. The 191 certaintyuser-stop rows and 135 oldsummaryuser-stops are
different counters. Explicit platform actor/cause wins; post-endedAt telemetry is excluded.
Seven-report-only buckets: **78 observed recoveries /20 workarounds /84 skips /29 still-broken /
70 struggles =281 items**. They are not buckets for all 551 reports or a fix count. The user-stopped
`4cf3ec76` report records two prior inefficiencies without treating Stop as a defect or restarting it.

The legacy 26 coverage rows were 4 terminal-source classes /7 contributor fixes /10 mitigations /
3 diagnostic changes /2 already-covered. Four original demonstrated terminal platform classes
remain the count: `77a2ecf5` Hindi refusal; `fd6be05f` live-env security; `303836a7` native-bundle hooks;
`7ec82d80` review headings. Their identical 8 behavior assertions pass current source and fail
corresponding baseline modules. References:tests/aHindiRefusalIsStillAnAnswer.test.ts,
tests/envSecurityFindings.test.ts,tests/appSourceIntegrity.test.ts and
src/server/AgentV3/ReviewerFindingSemantics.test.ts. The 12 queue closures above do not turn
that historical count into 16 fully repaired apps. **Historical app reruns 0; whole-report closures 0.**

Resume the recorded item-level roots and new final gate without dropping unresolved rows or
starting another report in this publication task. Account funding Q-1210 remains external;
51 reports retain explicit balance 429 evidence, which is not automatically their terminal cause.
Existing routing/futility decisions Q-1120–Q-1122 and E2 Eimage Q-107 retain their original owners.

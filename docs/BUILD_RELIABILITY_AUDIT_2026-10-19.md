# Build reliability audit — 2026-10-19

Audited repository snapshot: `ed5db4d278b008a10f59c9a8d4d79fbc4394f141`. This is an initial evidence audit, not a completed production report autopsy.

## Coverage and classification

- Complete production reports examined: **0**. The private NavBharat MCP tools are absent from this session. No production credentials or report exports are available.
- Reduced historical report extracts examined: **3** (below).
- Historical artifacts read: **37 autopsy regression source files, 9 prompt fixtures, 3 report extracts**. These 49 files are not 49 builds. Several tests cover the same report or more than one build.
- Queue snapshot: **101 rows**: 3 OPEN, 2 IN PROGRESS, 96 BLOCKED. Rows are engineering findings, including non-build work; they are not report counts.
- Historical builds FIXED AND VERIFIED by this audit: **0**. This means none reverified here, not that the platform has no previous fixes.
- New/uninvestigated and recurring/regressed production failure counts: **unknown** until the complete authenticated report feed and current verification evidence are read.
- No first-attempt success percentage or 99% target attainment can be calculated from a failure-only feed. All settled builds, attempt lineage, and runtime verification are required.

| Report | Available evidence | Recorded outcome | Classification in this audit |
|---|---|---|---|
| 398db9f3 | PAWTRACE, Weak tier, 2026-10-14; reduced result with 111 calls, 1 failed call, 1,510,936 ms, provider ledger and gate | ok=false; preview rendered; RED gate with one build-breaking blocker. The extract omits that blocker's diagnostic. Framework and exact root cause cannot be established. | INSUFFICIENT EVIDENCE |
| 67a2b0a2 | Data-analyst portfolio, Weak tier, 2026-10-15; hand-reduced result with 7 calls, 2 failed, 604,090 ms, provider ledger and gate | ok=false; RED gate; no live preview, no completed typecheck in the gate evidence. Exact provider errors and generated source absent. | INSUFFICIENT EVIDENCE |
| 303e8a6f | 2026-10-12; 40 verbatim issue/timeline rows and historical count summary | USER_STOPPED_BUILD / OUTCOME_USER_STOPPED; do not relabel a voluntary stop as a compiler failure. Full source, framework and subsequent verification absent. | INSUFFICIENT EVIDENCE |

Sources: `tests/fixtures/bench/*.min.json`, `tests/fixtures/report303e8a6f.issues.json`.
The fixture comments state their provenance; the original production reports were not independently retrieved.
The generic `public/build_repair_report.json` and `tests/fixtures/buildJob.json` have no real-report provenance and are excluded.

A previous admin `fixedAt` mark (`reportTriage.ts`) proves an explicit triage decision, not current test verification. Queue closure, a comment saying “fixed”, successful compilation, and a browser render each establish different facts. None alone proves every requested user flow works.

## Existing systems to extend

Failure categories and daily ranking already exist in `failureLedger.ts` / `FailureLedgerStore.ts`; workspace retrospectives in `BuildRetrospectiveEngine.ts`; bounded repair policy in the AgentV3 repair modules; evidence-based benchmark comparison in `reliability/benchEvidence.ts` / `benchHarness.ts`. These should be extended after inspecting their actual callers, rather than replaced with parallel intelligence services.

The queue already tracks constraints relevant to this mission: Q-008 needs measured strict-mode cohort data; Q-107 needs the `@playwright/test` runner in the E2B template (the installed `playwright` library is a different package); Q-979 records the build handler's TypeScript control-flow limit. This audit does not claim those are new findings or resolved.

## Historical systemic categories

These are supported historical patterns, **not a ranking of current production frequency**:

1. Requirement interpretation drifts: a feature word triggers the wrong product category, continuation loses the original request, or an ambiguous order creates an unwanted app. Examples: Dwarka, JEE planner, notes, paper trading, Banao autopsies.
2. Scaffold/dependency/environment mismatch: compiler configuration rewritten, enum type-only imports, missing packages/env discovery, incompatible worker assets. Examples: notes, SignBridge, Mitrify, edit-PDF.
3. Repairs and persisted source diverge: refused sandbox writes or shell edits disagree with saved source; a repair claims success without a durable change. Examples: SignBridge round two, candy game, single-file game.
4. Verification/reporting disagrees with observable behavior: a live address or JSON error counts as preview, a stopped build is called failed, incomplete journeys produce false findings, static publish drops the backend. Examples: Mitrify, calculator, calendar, ad-blocker browser.
5. Provider stalls and repeated ineffective work increase time/cost. Examples: 681bd91b, 2b0a3ed5, ca99778e. Existing mitigations and overlapping prior fixes are explicitly documented in these tests; do not repeat them without reproducing a regression.

## First implemented improvement

**Source-confirmed defect:** benchmark evidence totals substituted zero for missing/invalid input, output and latency fields. A provider ledger `A:{inputTokens:10}, B:{outputTokens:2}` produced seemingly valid totals 10 and 2; a call with no latency produced modelMs=0. Partial telemetry could make a candidate appear more efficient.

The change withholds an incomplete metric as null independently of other complete metrics. Explicit zeros remain measured zeros; malformed rows and overflowing sums cannot become valid totals. Provider-ledger precedence, billing amounts, repair behavior, model routing, cache accounting conventions, and existing report formats are preserved.

**Status:** FIX IMPLEMENTED, AWAITING VERIFICATION in the full repository CI. Local dependency-free behavioral checks passed **9/9**, including both real-report reduced fixtures. Six regression cases were added to the existing Vitest suite and its invalid-field expectation corrected. Full Vitest/typecheck/build were not run locally: the environment has no project dependencies and its configured network proxy refuses connections. This is measurement correctness, not evidence of improved production build success.

## Prioritized next engineering work

1. Obtain the complete read-only authenticated feed. Traverse every continuation page, including empty pages with a cursor, deduplicate workspace/build identities, retain extraction time and pagination completeness. Fetch individual full reports and link each to prior autopsy/PR/test evidence. Missing pages must prevent a “complete audit” label.
2. Reproduce unresolved/regressed failures in an isolated sandbox. Prioritize by measured recurrence, affected users, severity and verified provider/sandbox spend. Separate user stops, infrastructure outages, unmet external credentials, real app defects and reporting defects.
3. Validate repair acceptance with actual file diffs, rebuild and runtime evidence; keep bounded attempts and signature-based repeat detection. Reuse only fixes whose framework/version/error preconditions match and whose verification is recorded.
4. Establish baseline over **all** builds: first attempt vs repaired final outcome, render plus critical-flow evidence, durations, spend, and missing-evidence coverage. Compare on the same prompt/framework/tier cohorts before claiming improvement.
5. Resolve the existing queued test-runner/template and cohort-data blockers through their established ownership. Then extend scheduled feedback using the existing ledger, rather than introduce a second daily counter.

No production deploy, merge, data mutation, live build replay, or paid model call was performed. Large `PROGRESS.md` retrieval returned empty content / a transport error, so it was not overwritten; this file preserves the audit milestone for review.


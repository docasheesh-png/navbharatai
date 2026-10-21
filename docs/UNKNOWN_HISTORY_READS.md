# Unknown history reads

## Synthetic current-code reproduction

The diagnostics history store distinguishes a successful empty read from an
unavailable or failed read through `listDiagnosticsHistoryResult`, which returns
both `entries` and `ok`. Its compatibility wrapper, `listDiagnosticsHistory`,
returns only the entries and intentionally collapses both cases to an empty list.

The build-start continuation previously consumed that wrapper. In the synthetic
unavailable-store reproduction, it stamped zero prior failures and seeded an empty
session despite having no successful history read. Its `.catch` could not protect
either field because the store resolves normally. The finalizer then summarized
that seed as a known one-turn session.

This establishes the current-code failure mechanism, not the cause of any
historical incident. No provider, database, network replay, or paid build was run.

## Bounded fix and compatibility

The build caller now consumes `listDiagnosticsHistoryResult` and returns before
stamping or seeding when `ok` is false. `BuildDiagnostics` already represents
unknown by leaving `priorFailedBuilds` and `session` absent from serialized reports.

Successful empty reads still stamp zero. Successful populated histories retain
the cancellation filter, 50-row request, and end-of-build session clock. The read
remains best-effort and non-blocking, without a new query, retry, provider call,
schema, or persistence write.

The array-only store API, report-history and picker callers, ETA learning, and
summary reducer are unchanged. Admin all-builds downloads have a separate
fetched-report count/cap contract; this patch does not change that contract.

## Regression proof

`tests/aFailedHistoryReadCannotClaimZeroBuilds.test.ts` extracts the actual
production read continuation and session finalizer using TypeScript AST boundaries.
It runs them with the real recorder, cancellation classifier, and summary helper.
Only the clock and synthetic read results are injected. The unavailable-store case
also uses the real store's credential-free `VITEST` behavior and legacy wrapper.
The harness awaits the continuation for observation; production remains `void`.

Controls cover unavailable store, explicit failed empty and partial reads,
successful empty and populated reads, user cancellation (including legacy outcome
code), thrown rejection, serialized unknown fields, seed state, and final timing.

The final focused suite passed all 77 tests across five files: the new regression,
DiagnosticsStore, sessionSummary, ETA history, and reportPicker. Removing only the
`!ok` guard reproduced three failures with four passing controls in the new
regression. The guard was restored byte-for-byte before the final successful run.

This is bounded regression proof, not full-route scheduling or persistence
integration coverage, a hosted CI result, or a production replay.

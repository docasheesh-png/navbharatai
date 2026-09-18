// MOVED to `src/lib/advisoryCapOutcome.ts` (2026-09-17, the "Top failure patterns" autopsy).
//
// The predicates are pure and have no server dependency, and the ONE failure-reason classifier
// (`src/lib/failureReason.ts`) now serves both the server's Failure Category panel and the admin
// dashboard's client-side "Top failure patterns" card — so it must live where the client can import
// it. This shim keeps every existing server import path valid; add nothing here.
export * from '../../lib/advisoryCapOutcome';

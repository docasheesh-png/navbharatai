# Phase 2 coordination checkpoint

This is a scoped sub-PR. **Phase 2 remains IN PROGRESS.** It fixes queue admission,
completion identity and identified-request replay while preserving the existing
runtime, preview origin, source and snapshot behavior. It does not implement
filesystem/process fencing, declare the full phase complete, or establish a
production 100/100 score.

## Queue and request behavior

Queue reads are authoritative and preserve running rows. A database failure or
uncertain commit returns an error rather than acknowledging an in-memory fallback.
Claims are transactional, return only the final committed callback's outcome, and
read the workspace lease. Explicit stale recovery requires a confirmed non-live
lease and pauses the interrupted roadmap for review.

The server binds an executing queue row to its item, claim token and build attempt
and settles that exact binding before forwarding terminal events. A delayed A
completion cannot change B. Existing `/queue/complete` requests remain accepted as
read-only reconciliation hints; the server cannot safely infer a generation from
an old payload. Optional new item/token fields are additive. Both versioned and
permanent unversioned API routes remain available.

A verified signed-in builder request can supply an optional secure UUID
`requestId`. After lease admission, an account/workspace/input-digest receipt
admits that UUID once and supplies a stable reference to the existing wallet
transaction. A terminal or uncertain previous receipt cannot rerun; changed input
is refused. Receipt refusal occurs before queue binding, so a replay cannot fail
a newly claimed row with the same prompt. Deterministic lease refusal does not
consume a request identity. A queue conflict after reservation may require a new,
corrected request, rather than guessing that an uncertain attempt is safe to run.

Receipts contain hashes, IDs and status, never raw prompts, source, secrets or
provider replies. They remain for the account lifetime because deleting a UUIDv4
tombstone on age would re-enable its replay. The explicit verified `ownerId`
participates in account erasure, retention classification and admin inventory.

The mounted client retains identity for an identical unresolved request and
refreshes credentials without changing that identity. An observed terminal turn
permits a new user request. An intentional new Send/continuation, changed input,
another client without the original ID, or a browser reload is not automatically
the same identified operation. Legacy clients without IDs remain supported; they
cannot disambiguate separate HTTP submissions. Do not claim exactly-once behavior
for every user resend. Read/chat classification and attachment preflight also
retain their existing policy outside this builder receipt.

The wallet's existing transactional `wallet_ops` replay guard and pricing remain
in place. Empty references are rejected before I/O: they previously bypassed both
replay guards. A lost acknowledgement means debit outcome unknown, not proof that
the balance stayed unchanged. Replaying the same reference reconciles without
another debit.

Fast admission refusals use retryable HTTP errors before headers. Slow read-only
preflight can open progress after one second; a later refusal then emits an honest
retryable stream error and failed result without starting builder execution.
HTTP stream establishment alone is not admission success.

ZIP import obtains a verified lease before constructing or starting its sandbox.
Busy ownership returns 409; unavailable or disabled coordination returns retryable
503. Long imports keep their exact token alive until their actual work finishes,
including after an HTTP disconnect. Observed Stop, uncertainty, takeover or local
expiry blocks new sandbox operations and the durable merge. This is a check before
each operation, not revocation of a provider call already in flight or an atomic
source-store fence.

## Verification

Required final-source local checks, the exact reviewed CI head and merge evidence
will be recorded before this checkpoint is called merged.

`scripts/phase2-firestore-drills.mjs` uses real Firebase Admin transactions, a
loopback **demo-navbharatai-phase2** Firestore emulator and separate OS processes,
outside Vitest. The CI `queue-retry-drills` job downloads the emulator specified
by the locked Firebase CLI, verifies size and SHA-256, runs the drills on Node 22
and Java 21, and uploads logs as `phase2-queue-retry`.

Checks cover fresh cross-worker reads, competing claims, same-owner lease token
contention, worker death, explicit stale recovery, old completion, concurrent
wallet settlement, ledger replay, concurrent receipt reservation, terminal replay
and real TCP partitions. Acknowledgement loss is explicitly injected after a real
commit. One queue partition uses only a TCP cut and the production four-second
deadline; another labels its injected SDK deadline. Recovery clocks are advanced
explicitly rather than presented as a real 90-second interruption.

No production credentials/data, E2B calls, paid model builds or store binaries are
used. The emulator does not establish production IAM, deployment draining,
provider cancellation or cross-instance filesystem fencing.

## Work still required to finish Phase 2

Lease admission hardening cannot stop a command that already runs after its old
lease expires, or fence baseline canonical source writes. The reviewed runtime
isolation proposal demonstrated that filesystem boundary with real containers,
but is **not eligible to merge** because it breaks existing app-state preservation:

- Local PostgreSQL/SQLite data, runtime uploads and generated session/JWT secrets
  are not completely represented by canonical source/assets.
- Generated apps intentionally store files in IndexedDB. The preview proxy
  preserves the sandbox ID in the iframe hostname; a fresh sandbox on every edit
  changes the browser origin, stranding IndexedDB/localStorage/cookies and OAuth
  redirect associations. A server filesystem clone would not fix browser origin.

The next runtime design needs a stable isolated origin per logical workspace,
verified HTTP/WebSocket/cookie/redirect behavior, and state-consistent database and
runtime migration without copying old source-mutating processes. Configured
staging access and browser/database fixtures are required before replacing an
existing working app. The rejected implementation is retained locally on
`codex/phase-2-build-safety` at `7c0642f`; its passing concurrency checks are not
compatibility evidence.

Explicit external deployment releases and uploads finishing after account erase
also need operation reconciliation; a local token check cannot cancel an already
submitted remote write. Automatic multiwindow continuation of a failed/paused
queued step is not newly guaranteed by this sub-PR. Those boundaries stay open.

Phases 3–6 have not started. Phase 3 additionally needs a configured test account,
provider/sandbox access and a spend limit for real benchmark cohorts. A failure-only
reports feed cannot establish an all-build success denominator.

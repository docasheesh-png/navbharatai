# Conservative allocation intent guard: design before implementation

Reviewed baseline: `9ca0ddd242b5160eb3c83661c8c445e2254c9366`.
**DESIGN ONLY — NOT IMPLEMENTED.** The investigation made no production
source edits or provider calls. This document is a required next-gate design,
not an implemented allocation or recovery guarantee.

## Decision

A coherent conservative guard is possible, but it is an allocation-dispatch,
identity-publication and initialization protocol. A transaction wrapped around
`Sandbox.create()` alone is not a sound implementation. The smallest safe
implementation must include all of the boundaries below; none can be deferred
while describing the allocator as protected.

Its precise guarantee would be one allocation POST per confirmed dispatch intent
for cooperating upgraded workers, no replay or automatic replacement of an
UNKNOWN issued intent, and no external handle publication before the same
creation's initialization is positively confirmed. This does not prove physical
SDK/process drain, historical legacy ownership, absence of pre-rollout orphaned
VMs, or complete local/browser-state restoration.

## Concrete source evidence

- `E2BActuator.getSandbox()` returns `this.sandboxes` before `_creating`.
- `_createSandbox()` has two uncoordinated create calls (first allocation and
  exact static-connect typed HTTP 404 replacement), then publishes the warm handle,
  session and durable touch BEFORE `_restoreFreshSandbox()`.
- `_restoreFreshSandbox()` turns source-read failures into an empty map, catches
  text/asset deadlines, and calls helpers that catch per-file failures. Its
  resolved `Promise<void>` is not an initialization receipt.
- `fileOp()` and command recovery evict a dead handle and recursively get another.
  Ordinary initialization through these methods can deadlock on its own creation
  promise or escape to another generation unless it has a private captured sink.
- `SandboxStore.record()` and `touch()` overwrite the top-level sandboxId using
  unconditional merge writes. A stale build finally can replace a newer identity.
- The installed SDK defaults to three control-plane retries and replays POST after
  HTTP 429 with Retry-After. An actual loopback experiment produced two POSTs from one
  default `Sandbox.create()`, and one POST with `retries:0`; see
  the retained loopback evidence below. It used only 127.0.0.1 and dummy credentials.
- SDK outer AuthenticationError does not prove no allocation: an HTTP 201 create can be
  followed by a failed compatibility DELETE returning HTTP 401. The earlier credential-free loopback review separately demonstrated
  that error provenance.

## Durable state and authority

Use a versioned `allocation` subrecord of the EXISTING `agentv3_sandboxes` document.
This avoids creating a second independently erasable identity namespace. Preserve
snapshot/recipe/port/session fields. Store operation UUID, generation, exact
expected predecessor ID (or confirmed record absence), dispatch token,
creation-origin, immutable connection-scope fingerprint, stage and created ID.
No API credential, raw error, source or prompt belongs in this record.

Stages:

1. PREPARED: validated supported options; no dispatch token has been granted.
2. ISSUED: a final acknowledged transaction granted one exact token. It may mean
   crash-before-send, create-running, or create-committed/ACK-lost. These histories
   are intentionally indistinguishable after worker loss.
3. CREATED: an exact allocation response identified one VM and was CAS-bound;
   initialization has not yet been granted to any owner.
4. INITIALIZING: a final acknowledged transaction granted one initialization
   token. Unknown owner/ACK/outcome is non-reclaimable.
5. READY: exact created ID, initialization token and confirmed initialization
   receipt agree. Only now publish the top-level resumable ID and public handle.
6. REFUSED-NO-ALLOCATION: only an explicit supported refusal observed at the exact
   allocation POST boundary (or the same live worker's proven no-send result),
   never an arbitrary outer SDK error. A later corrected attempt can advance.

No age/lease expiry clears ISSUED or INITIALIZING. Database timeout, malformed
state or inconsistent identity always refuses. Firestore callbacks perform no
HTTP and generate no new UUID. Only the final committed callback result grants
work; a late commit ACK after the caller's deadline does not issue a POST.

An exact late HTTP 201 can still CAS-bind CREATED while its original handler is gone,
without publishing a handle or starting restoration. A later caller may claim
never-started initialization from CREATED. If the initialization grant itself is
unknown, another caller must not take it over.

## Exact allocation boundary

Use `retries:0` on the actual control-plane client. Do not replace the SDK with
an unchecked fetch. A small typed adapter using its exported ConnectionConfig and
ApiClient must own and test precisely the currently supported options: template,
lifetime, lifecycle pause, metadata and SDK default security/network settings.
Reject unsupported/debug options before intent dispatch. Preserve inherited
proxy/CA/headers/credential selection.

Observe the exact POST response before constructing an SDK handle or attempting
compatibility cleanup. CAS-bind a valid returned ID immediately. A malformed HTTP 201,
transport failure, deadline, ambiguous HTTP 5xx or rejected binding remains UNKNOWN.
An unsupported envd/template after creation is CREATED/non-ready, not proof that
no allocation occurred. Do not delete a VM as a recovery shortcut.

The no-allocation refusal allowlist needs an explicit endpoint contract. The SDK
outer exception class is insufficient. Start with only exact supported refusals;
unknown statuses remain ISSUED. A lost refusal-CAS ACK must be reconciled by exact
read before another dispatch.

Creation scope must be pinned before grant and compared on every epoch/reconnect.
At minimum use the resolved API endpoint and an opaque credential fingerprint,
never raw keys. Different keys conservatively count as different scope even when
they might belong to the same account. A fingerprint is not proof of provider
account identity; proxy-mapped identity/profile changes need a trusted explicit
scope/version and operational reconciliation. No configured provider profile or
staging identity exists in this session, so live scope behavior remains untested.

## Initialization is part of this slice

Maintain a private captured initialization context keyed by exact workspace,
operation and initialization token. Public `getSandbox` first joins `_creating`;
only calls inside that private context can use its captured one-generation sink.
Do not put an initializing handle into `this.sandboxes` merely to support
reentrancy. Publish the ordinary handle only after READY CAS acknowledgment.

The captured sink must preserve existing safe-path/GreenFreeze/cache behavior,
but must not evict/reconnect/recreate implicitly. An SDK failure or unknown timeout
marks initialization uncertain and stops new initialization dispatch. A proxy or
explicit captured sink must track the actual underlying SDK promises BEFORE any
outer timeout wrapper can release them. The same-worker raw restore promise,
all issued SDK promises and all helper work must be settled before a receipt can
claim READY; a snapshot of tracked promises is insufficient if later dispatch is
still permitted. Close dispatch before the final join and refuse if anything
tries to start after closing.

Source and asset readers need strict completeness evidence. Current file status
can still omit indexed missing records; asset `complete:true` can omit unreadable
object pointers. A resolved helper or count alone must not become a READY proof.
Either add a strict captured restoration snapshot/result covering every eligible
path, or leave initialization non-ready. Live secrets/local databases/browser
state are not restored by source copying and must remain explicitly outside this
bounded guarantee. A new fresh machine is never a claim of full state recovery.

If restore/SDK work remains uncertain after the request's response deadline,
return an honest setup-unconfirmed/review state and retain the intent. Do not
show the existing short-retry wording as if time alone would unlock it. Do not
start an untracked background restore or admit another initialization token.

## Existing paths and epoch rules

- `record()` may observe/update only the exact current READY identity; no stale
  finally can replace it. `touch()` is observational and cannot select identity.
  The allocation protocol performs the first identity publication.
- `recordSessionStart/End`, reaper stamps and other sandbox-scoped observations
  must compare exact current ID/generation where they can affect lifecycle.
  Snapshot/recipe metadata cannot accidentally clear or replace allocation state.
- Explicit resume ID is not an authority override. A stale ID cannot create a new
  generation, and managed READY scope/ID must match before reconnect/replacement.
- Exact static-connect404 can advance only the matching current READY ID and
  generation under its pinned scope. Legacy records lack that scope proof; retain
  the current legacy exception as explicitly unproven, or conservatively refuse
  replacement. Do not silently label a legacy HTTP 404 as managed epoch evidence.
- `AGENTV3_SANDBOX_RESUME=off` cannot bypass the new guard. If honoring it would
  require an unproven new generation, return unavailable. Do not clear authority
  as a rollback mechanism or silently create beside an existing READY/UNKNOWN VM.
- `clear()` cannot delete a managed intent/tombstone. Current account/workspace
  erasure already refuses unverified legacy workspace attribution. A later erase
  needs stop/drain and exact terminal proof before removing authority; deleting
  the intent first would re-enable dispatch while a VM may still exist.

## Deployment and user impact

This protocol coordinates only upgraded cooperating workers. Old revisions ignore
nested intents and can still allocate or overwrite identity, so activation needs
a drained/isolated compatible pool. A feature flag alone does not fence old
writers. New managed state must never fall back to legacy creation on rollback.
Historical unrecorded VMs and ambiguous workspace owner IDs remain unproven.

Unknown dispatch can permanently block a workspace until an authoritative
provider operation result or separately verified reconciliation is available.
The SDK offers neither idempotent replay nor a terminal create-operation journal.
No automatic metadata adoption/reset/kill endpoint belongs in the first slice.
Zero list results, elapsed time and an empty dashboard never unlock an intent.
Normal pre-dispatch validation and exact POST refusals should remain recoverable.

## Required proof before a mergeable implementation

- OCC retries/contention and multiprocess emulator: one exact dispatch grant,
  one actual POST; duplicate creates cannot be granted by callback closure state.
- Commit ACK loss/late ACK/worker loss before and after POST; never auto-retry.
- Exact refusal versus HTTP 201 followed by cleanup failure and malformed/late success.
- Two actuator instances during blocked restoration: no second create or use of
  an initializing machine; private initialization reentrancy does not deadlock.
- Actual source/bucket partial reads, swallowed item failures and raw operations
  outliving wrappers: no READY, no public cache, no second initialization token.
- Stale record/touch/session/finally writers cannot replace the current ID.
- Stale explicit IDs, changed scope, resume-off and concurrent typed HTTP 404 epochs
  cannot bypass current authority.
- Ordinary confirmed success still writes/reads actual files, records correct
  creation origin and permits the existing warm/resume path; no-op mutation fails.
- Inventory and erasure preserve nonterminal intents; no TTL-reset escape.
- Rollout compatibility, real provider semantics and physical process/source
  fencing stay OPEN until configured staging supplies actual evidence.

## Current outcome

No production implementation is represented as complete. This design and the
independent review show exactly why a small pending flag would be unsafe. No allocation runtime implementation was added during the investigation. A complete implementation can
be undertaken as the above coherent slice; cutting its initialization/scope/
writer boundaries would leave a misleading partial feature.


## Retained local SDK evidence

The installed SDK was pointed only at a loopback HTTP fixture with dummy
credentials. Its recorded request sequence was:

| Setting | Observed allocation requests | Local result |
| --- | --- | --- |
| SDK default retries | `POST /sandboxes`, then `POST /sandboxes` | Local protocol fixture response |
| `retries: 0` | One `POST /sandboxes` | `RateLimitError` |

This demonstrates control-plane POST replay in that fixture. It does not prove
provider-side idempotency, production allocation count or physical cancellation.
Setting retries to zero alone does not implement the outer durable dispatch,
created-ID publication, initialization or stale-writer protocol above.
The independent source review is retained below so its limits remain reviewable.

## Independent review: bounded allocation authority

Read-only source review at `9ca0ddd242b5160eb3c83661c8c445e2254c9366`, 2026-10-20.
This independent source review made no production source changes, provider
calls, SDK experiments or test runs. The separate loopback evidence above
comes from the allocation investigation, not this review.

### Verdict

A conservative allocation guard is implementable without provider idempotency if
an issued UNKNOWN intent is permanently non-reclaimable until positive evidence
resolves that exact operation. It can establish at most one allocation POST per
compatible protocol intent. It cannot establish automatic recovery, full state
preservation, historical workspace ownership or physical command drain.

It is not sound to ship only a CAS pending flag around the two current
`Sandbox.create` expressions. The minimum coherent slice includes dispatch,
created-ID binding, initialization authority, exact identity writers and every
create entry path. If initialization/identity integration is excluded, retain
the proposal as design rather than representing it as an implemented workspace
allocation guarantee.

### Why the current lifecycle matters

- `E2BActuator.ts:1494-1504` reads the warm map before checking `_creating`.
  `:1621-1644` publishes the handle, session and durable touch before source
  restoration completes. Thus the in-process lock does not exclude unrelated
  readers/writers during initialization.
- `_restoreFreshSandbox` at `:1680-1738` catches load/write/asset deadlines.
  `withTimeout` at `:170-178` only rejects its wrapper; it does not cancel or
  join the underlying operation. A returned restore promise is not a drain or
  complete-restoration receipt.
- `WorkspaceFiles.ts:441-443,475-478` and
  `WorkspaceAssetStore.ts:322-332,338-346` swallow landing and per-asset failures.
  Archive failure can fall back to per-file dispatch while an ambiguous earlier
  command remains unconfirmed. A high-level resolved return can hide unknown
  low-level work.
- `fileOp` at `E2BActuator.ts:1986-2006` evicts a failed handle and calls
  `getSandbox` again; ordinary commands retry similarly at `:2685-2703`.
  During initialization, a newly added pending gate can deadlock on its own
  creation promise, or can accidentally authorize replacement. It must never
  blindly retry a new generation from within initialization.
- `SandboxStore.record` at `:111-120` and `touch` at `:405-414` overwrite the
  top-level ID with merge-set. An old warm holder or route finally can roll
  back a newer identity unless these writes become conditional.

### Minimum protocol

1. Prevalidate actual SDK/configuration options before reserving dispatch.
   Persist operation UUID, exact expected predecessor ID/generation, creation
   origin, provider/API credential scope and state in one transaction domain.
   Use only the final committed callback return. No HTTP occurs in a retryable
   transaction callback.
2. A positively acknowledged exact dispatch grant permits one POST with
   `retries: 0`. A timed-out/lost transaction acknowledgment never permits POST.
   A worker that knows it never dispatched may compensate its matching grant;
   another worker cannot infer no-send from time or process disappearance.
3. Observe allocation HTTP response before SDK compatibility/MCP cleanup. The
   installed SDK can return `AuthenticationError` after POST201 followed by
   DELETE401 (`index.js:5094-5147,5440-5478`). Outer error classes cannot clear
   an intent. A narrow observed adapter must preserve SDK create options and
   classify only documented exact allocation-POST refusals as no-allocation.
4. CAS-bind the returned provider ID as CREATED/INITIALIZING before any warm
   publication, touch, session start or source write. A failed/unknown bind
   never publishes a handle. A late success can record evidence against the
   unchanged intent without granting a second creation or stale caller access.
5. Keep one private initialization owner. Either use a captured one-generation
   sink with existing path/GreenFreeze/cache safeguards, or a private async
   context that permits only reentrant initializer work. Other same-process
   and cross-process callers must wait/refuse until confirmed READY.
6. Track raw SDK work below swallowed timeout/error helpers. Do not dispatch
   retries/fallback generations after initialization becomes uncertain. READY
   requires positively completed owned initialization, not merely resolution of
   a best-effort wrapper. Unknown initialization stays non-ready and cannot be
   adopted/replayed by another worker. Failed/partial initialization needs an
   explicit honest support/reconciliation outcome.
7. The smallest first slice should omit metadata adoption. If later added,
   positive all-page scope/operation matches can bind a candidate; empty,
   multiple or incomplete lists do not prove no allocation. Preserve original
   fresh/replacement origin and initialization state on any adoption.
8. Make record/touch/session identity observations conditional on exact current
   ID/generation. Touch must not establish or replace identity. Clear/erasure
   must not delete issued UNKNOWN authority or tombstones.
9. An exact current READY ID's typed static-connect HTTP404 may retain the
   existing bounded replacement policy only through a CAS transition checking
   that ID/generation and provider scope. A stale explicit ID, changed key/API
   scope or a differently bound current ID cannot create another epoch.
   Legacy records with no provider scope remain an explicitly qualified legacy
   boundary, not newly proven authority.
10. Explicit resume IDs and `AGENTV3_SANDBOX_RESUME=off` cannot bypass the new
    allocation gate. Off may conservatively make unproven replacement
    unavailable; it cannot mean create another machine despite pending state.

### Release and evidence

The protocol needs current source/Firestore OCC and real-multiprocess proofs of
one grant/one POST, committed-lost ACKs, late callbacks, stale identity writers,
explicit/off paths and exact 404 epochs. Actual SDK loopback tests should prove
201-to-cleanup-error provenance and exact POST refusal handling. Initialization
tests must hold underlying raw file/asset work after wrapper deadlines, exercise
both other-instance and same-instance access, and prove no deadlock or automatic
replacement. Mutation proofs should remove the gate and observe two creates or
foreign/stale identity overwrite; a no-op guard should fail legitimate creation.

Older deployed writers do not honor these CAS rules. A deployment claim requires
a compatible pool/drain or explicit activation precondition; source-only tests do
not prove the live rollout. Known legacy key ownership and physical provider
command/source fences remain separate OPEN issues. Do not present retries:0,
READY or a handler's exit as physical cancellation proof.

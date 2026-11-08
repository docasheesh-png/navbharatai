# Local sandbox observation persistence

Audit baseline: `1660a99683561811e5d517df46e2eacc14a7f679`.
Combined validation includes main `f3a147ce88f0635607adb7e857507b409bae93d1`.

This repair changes telemetry persistence only. It does not change sandbox sizing,
timeouts, create/connect/restore/pause behavior, identity-write semantics, billing
rates, or app files/databases. It is not an allocation-authority or pause-fencing
implementation. No cost reduction is claimed.

## Contract

- Each local create/connect observation gets a random UUID. Reconnecting to the
  same sandbox, even at the same reported timestamp, is a distinct observation.
  The optional field remains compatible with legacy rows lacking an ID.
- Local session publication and app restoration proceed without waiting for
  telemetry. The existing initial identity touch is invoked exactly once under
  its existing flag/throttle conditions. Its same caught promise is returned and
  used as the prerequisite for the start's session transaction. No added touch,
  identity repair, retry, or identity-write precondition is introduced.
- Session writes require an existing record with the exact workspace and sandbox
  identity. They update only the whole `session` field, retaining every unrelated
  field. They cannot create a record or establish/replace allocation identity.
- A start replaces absent telemetry or a valid predecessor with a strictly lower
  `startedAt`. Equal timestamps, an already-recorded identical UUID, malformed
  predecessors, or mismatched allocation identity are skipped. This is only a
  **reported-start timestamp high-water register**, not physical chronology.
  Clock skew can suppress later observations or invert real-world order. A UUID
  is an identity, never an ordering token. No complete observation history exists.
- An end matches the current UUID, sandbox ID, start timestamp, origin, and reason.
  Only the first valid end is accepted. Duplicate, stale, missing, legacy, or
  malformed matches are ignored. An end describes this instance's observation,
  not a confirmed provider pause or the lifetime/billing interval of the VM.
- The actuator chains an end to that exact observation's start promise using weak
  keys and removes the key on end. A later observation on the same workspace
  cannot lend its start promise to an older end. A failed counter cannot release
  the start promise before the session transaction settles. This adds no durable
  ledger or per-operation database calls.
- Daily reason counters retain independent, best-effort increments. Repeated
  starts may increment again, rejected observations may increment, and failed
  counter writes may be lost. They are not exactly-once or accepted-write counts.

## Failure and concurrency behavior

A successful initial touch permits fresh-create telemetry to bind its existing
identity. A failed or lost touch acknowledgment still leads to the same exact-ID
check; absence/mismatch is unknown, not permission to create or repair. A stuck
touch delays telemetry only. A committed start whose acknowledgment is lost can
still be completed by the exact-ID end. A direct end arriving before any start
is dropped; it is never cached or invented later. Deletion between touch and
telemetry cannot be reversed by telemetry.

Transactions serialize competing session writes, and Firestore retries preserve
the timestamp comparison and exact end match. They do not establish global
ownership. Existing unconditional `touch()`/`record()` writers can still roll back
allocation identity or resurrect records. In the tested late-old-touch case,
the top-level ID rolls back while the newer session remains intact; its end then
refuses the mismatched identity. The inconsistency remains visible rather than
being hidden or repaired by telemetry. Mixed deployments with old unconditional
session writers are also outside this guarantee.

Historical malformed sessions can remain unknown rather than being replaced.
An outage or clock skew can cause observation loss; this is preferable to
inventing completion, billing, or global lifecycle evidence.

## Validation

- `tests/sandboxSessionPersistence.test.ts`: whole-map replacement, preservation,
  stale/tied starts, duplicate writes, malformed/legacy/missing identity, lost ACK,
  failed counters, immutable snapshots, deletion, and documented old-touch race.
- `tests/sandboxSessionOrdering.test.ts`: real actuator methods with mocked SDK
  and store; app/restoration remain unblocked, touch count/throttle/flag preserved,
  separate observation promises, final numbers and bookkeeping cleanup.
- `scripts/sandbox-session-persistence.check.mjs`: real local Firestore emulator,
  concurrent store instances and the persistence/failure cases above. Requires an
  explicit loopback endpoint and uses only a `demo-` project and synthetic records.
  Included in the existing CI queue/drill job; it never contacts E2B.

Focused/emulator checks do not replace the full required CI and coverage suite
on the latest combined, integrated commit. A test failure or incomplete run is
not a pass. Production fleet behavior and actual provider spend remain unverified.

## Snapshot source-hash invalidation

A separate metadata-only correction in `saveSnapshot` clears `snapshotFilesHash`
when a replacement capture supplies no source hash (null, undefined, or empty),
including recapture at the same URL. Previously recursive merge retained the
previous capture's hash, which could falsely match unrelated current files.
Known hashes still replace it. URL, capture timestamp, merge behavior and all
unrelated fields remain unchanged. No saved artifact, user file or database is
removed. A missing hash returns unknown from `snapshotMatchesFiles`; existing
fallback/trust rules are unchanged, including the 24-hour boundary. This neither
proves artifact availability nor claims savings. Behavioral tests and the real
emulator cover unknown/known replacements, same-URL recapture, first unknown
capture and preservation of session, recipe and sandbox identity.

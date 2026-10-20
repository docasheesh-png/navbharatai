# Phase 2: recovery identity and private asset erasure

This is a second scoped Phase 2 checkpoint, proposed in
[PR #3852](https://github.com/docasheesh-png/navbharatai/pull/3852).
Phase 2 remains **IN PROGRESS**.
The queue/retry checkpoint [PR #3848](https://github.com/docasheesh-png/navbharatai/pull/3848)
passed [both CI jobs](https://github.com/docasheesh-png/navbharatai/actions/runs/39378125233)
at `7241043914134488c4f54b005988fc76cc62ef9d` and merged as
`06f8065629debbd846c1f836241c5be9a5a8337e`. Its real database evidence is
14 distinct emulator/multiprocess drills passed, not production-provider testing.

## Uncertain reconnects

Previously an unavailable sandbox identity read looked like a missing record,
and every rejected reconnect, including authentication, network and deadline
errors, created a replacement VM. A slow reconnect could still succeed after
its caller had started another machine, splitting the workspace and preview
origin.

The allocation boundary now reads a strict found/missing/unavailable identity.
An unavailable read or nonterminal reconnect failure returns
`SANDBOX_RECOVERY_UNAVAILABLE`, with a user-facing retry message. An explicit
resume ID bypasses the identity read. Only the installed SDK's typed not-found
error at the static `Sandbox.connect` HTTP boundary retains the existing
fresh-machine/source-restoration policy. Broad dead-handle message matching is
not evidence for replacement.

Initial builder setup propagates this refusal before builder execution and
publishes a failed result, settling an admitted request/queue binding. A typed
failure later in a build does not fabricate a zero-step result or a definite
outcome. Diagnostics classify recovery refusal as sandbox infrastructure.
Preview diagnosis returns retryable HTTP 503 with Retry-After before headers;
an already-open progress stream sends an unsuccessful terminal result instead.
Neither path claims that a temporary reconnect problem means package.json is
missing. Ordinary crash messages and reports retain their existing redaction.

Behavioral tests exercise the real actuator acquisition/retry lifecycle with
controlled SDK outcomes and late promise settlements. The installed SDK's
404/401/429/503 classification is checked against a loopback HTTP server.
Registered preview routes exercise verified owner authentication and both JSON
and streaming responses. Request receipt integration checks distinguish definite
setup failure from unknown later outcomes. No provider credential or paid VM is
used by these tests.

This does **not** establish a durable allocation claim: a fresh create can still
time out ambiguously, an unrecorded VM can exist, and two instances can race their
first allocation. Resume disabled explicitly retains its prior policy. A
provider not-found response is not physical process-drain evidence or proof that
all local databases, uploads, secrets and browser-origin data can be restored.
Existing shared restore helpers still retain their best-effort per-file
behavior. Runtime/source fencing and full state preservation remain open.

## Deadline response versus actual body exit

The deadline finalizer previously released ownership and marked the build exited
while its own comment acknowledged an unabortable awaited body might still run.
It could also be saving files after the body's finally had admitted a successor.

A captured deadline now installs an immediate body-exit hold, shares one finalizer
promise and closes its stream even when finalizer persistence fails. Both actual
cleanup paths cancel future timers synchronously and join an active finalizer
before releasing resources. Queue publication can finish before stream closure
without retiring the execution receipt early. The lease heartbeat, stopped-build
gate and reactive/proactive reapers honor this captured hold until actual exit.
Losing shared ownership is reported and aborts work; it does not turn the held
body into an exited receipt.

An unfinished deadline result is non-resumable and explains that previous work
is still stopping. It describes files changed, without promising successful
persistence or automatic continuation. A retry is refused while the held work
remains. Normal completion, pricing rules and wallet operation references retain
their existing policies.

Focused tests independently hold the body and finalizer, exercise both completion
orders, keep a real lease implementation renewed across eight virtual stale
windows, deny a competing token, verify publication/receipt separation and cover
rejection, cleanup, reentrancy and captured-map protection. These are controlled
process tests, not proof of physical provider cancellation.

Actual handler exit still cannot establish that detached or timed-out SDK
commands have drained. Ordinary Stop's older time-based local reclaim policy,
remote lease expiry/fencing and the pre-existing normal-versus-deadline
pricing/terminal race remain open. Stable wallet operation references prevent a
second debit for the same reference; they do not validate equal amount snapshots
or return the prior debit amount. This checkpoint does not claim one serialized
settlement for all concurrent exits.

## Completed private asset objects

Large workspace assets spill outside Firestore. The legacy key
`workspace-assets/<workspaceId>/<assetId>` has no independently verified owner.
Its apparent UID prefix is ambiguous: deleting for `abc` can match a workspace
belonging to `abc-d`. Refusing deletion only when the deleting UID has a hyphen
does not solve this collision. The original proposed prefix erasure was caught
before the updated PR was pushed and is replaced, not treated as safe evidence.

New authenticated spills receive the server-verified UID separately from the
workspace ID and use `workspace-assets-v2/<encoded-owner>/<encoded-workspace>/<assetId>`.
The owner component is encoded and slash-delimited, so neither a neighboring UID
nor a shared legacy workspace ID can select another owner's object. The writer,
reader and eraser retain shared bucket selection. Opaque legacy storage pointers
remain readable; unauthenticated legacy writes do not acquire verified ownership.

The authenticated, confirmed profile deletion path removes only completed objects
under that exact verified-owner namespace, including after Firestore pointer
loss. It never infers legacy ownership from session strings, history records or
workspace prefixes. Legacy objects remain retained for separately verified review.
Anonymous or unusable owner identities are refused. Published/shared and APK
objects are outside this namespace.

The additive `workspaceAssetObjects` response separates
`verifiedOwnerObjectsRemoved` from overall `removed`. Overall removal remains
unconfirmed (`removed: false`) because legacy ownership is unresolved; the
response includes that limitation. Unconfigured storage, failed deletion and
unexpected errors never claim verified-object removal. Tests exercise the actual
spill writer and registered account deletion with stateful database/bucket
doubles, metadata loss, partial failure, retry and authorization. Owners `abc` and
`abc-d` share the same legacy workspace ID in the regression: erasing one must
preserve the other's new bytes and every legacy object.

This confirms only the configured bucket's completed verified-owner objects. It
does not fence an upload already in flight, reconcile historical buckets or erase
ZIP chunks keyed by upload ID. Account-lifecycle tombstones, verified legacy
migration and durable late-write reconciliation remain open.

## Legacy workspace erasure refuses unverified attribution

The same UID collision affects the older Firestore workspace eraser, hosted
snapshot selection, build-event field ranges and histories derived from session
rows. Conversation parents can also retain one userId while turns from another
colliding workspace are appended. Cross-device sync has its own collision:
`user_workspaces/abc__c0` can be a chunk for `abc` or the manifest for `abc__c0`.
Constructing an exact composite key does not resolve these collisions.
The same class exists in voice conversation memory, ADR/debt records and app AI
identity records: production writers can merge old turns, arrays or still-valid
previous nonces while retaining or replacing a parent userId. Those five known
mixed-owner platform stores keep their registry entries but explicitly refuse
account-erasure attribution before any query. Actual writer regressions reproduce
the mixed payloads; the registry handler does not equate a last-written owner
field with proof of every retained byte.
Re-checking the same prefix does not independently verify ownership. Even
a default-shaped Firebase UID can be the shorter neighbor of a valid custom UID;
checking current Auth accounts would miss deleted historical owners.

The shared legacy workspace erasure planner now refuses every prefix-only
attribution with `ownership-unverified`, before querying or deleting workspace
documents or snapshots. Derived history and build-event paths share that refusal.
Legacy conversation cascading and synced workspace erasure likewise refuse
unverified attribution before destructive selection. Their reports retain zero
deletion counts and a reason, rather than claiming an empty completed erasure.
Exact owner-field platform and bot erasure remains separate; newly verified-owner
asset objects use their independent safe namespace. Account removal is still
reported separately from data erasure. The profile response always explains that
unverified workspace records, histories and hosted snapshots are retained, even
when an eraser fails before returning its report. This intentionally leaves a
compliance gap rather than deleting a stranger's work.

The registered profile regression holds neighboring owners' workspace,
history, event, conversation, sync and snapshot data while exercising the actual
eraser decisions. It checks that ambiguous storage is retained and independently
owned platform/bot data can still be removed. The deletion screen and public
instructions disclose retained data before confirmation; missing responses never
prove that nothing changed or that all data was erased.
This is a bounded destructive-action mitigation. Private
workspace read/write authorization still relies on the ambiguous legacy identity
scheme and remains an OPEN security issue. A prospective independently verified
owner boundary and verified legacy migration are required; changing the runtime
or browser origin without preserving state is not a safe shortcut.

## Release evidence

Final-source local checks and the exact reviewed remote CI head must pass before
this checkpoint can merge. PR and CI links record the outcome. Phases 3–6 remain
unstarted; these bounded fixes do not establish a permanent 100/100 rating.

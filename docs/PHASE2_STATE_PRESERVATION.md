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

Large workspace assets spill to private object storage at
`workspace-assets/<workspaceId>/<assetId>`. Account erasure previously deleted
their Firestore pointers while retaining the bytes. The writer, reader and eraser
now share the same bucket selection and object-key definition.

The authenticated, confirmed profile deletion path deletes the verified owner's
safe private prefix even if metadata was already erased. It uses the existing
workspace erasure planner, refuses ambiguous hyphenated UIDs, and now also
refuses the reserved anonymous namespace. Foreign owners, published/shared
objects and APK objects are outside this prefix.

The additive `workspaceAssetObjects` response reports attempted, removed and
failures separately from Firestore document counts. Unconfigured storage or a
partial/unconfirmed deletion never claims that the objects were removed.
Tests exercise the real spill writer and registered account deletion against
stateful database/bucket doubles, including metadata loss, partial failure,
retry and authorization boundaries. A deliberate no-op deletion reversion fails
on retained owner bytes.

The deletion confirms only the configured bucket's completed objects. It does
not fence an upload already in flight, reconcile historical bucket changes or
erase ZIP chunks keyed by upload ID. Account-lifecycle tombstones and durable
late-write reconciliation remain open.

## Release evidence

Final-source local checks and the exact reviewed remote CI head must pass before
this checkpoint can merge. PR and CI links record the outcome. Phases 3–6 remain
unstarted; these bounded fixes do not establish a permanent 100/100 rating.

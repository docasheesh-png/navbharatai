# Phase 2: queued normal-module handoff

This is another scoped Phase 2 checkpoint. Phase 2 remains in progress.

Previously, every HTTP `result` settled its queued command, including intermediate
`resumable:true` module results. A successful module marked logical step A done
while modules remained; automatic `continue` then ran without A's queue identity.

## Normal successful module windows

The optional `queueContinuationProtocol:1` capability enables a server-authored,
one-use handoff. A normal successful module keeps A running and B blocked. A
pending handoff records the exact item, claim, predecessor attempt, nonce and
bounded plan progress. Queue readers reject malformed metadata.

Only explicit normal-body retirement can make that handoff READY. Generic
heartbeat or initializer release cannot do so. Retirement joins captured source,
asset and memory jobs, cancels progress timers, joins owned green-proof publication,
flushes prior events, seals the predecessor publisher, and confirms its captured
stream/mirror cleanup before releasing local admission. READY and deletion of
the exact predecessor lease commit together. A shared retirement promise prevents
a lost-token heartbeat from cancelling a committed handoff while its ACK arrives.

The next window must hold its own verified lease and atomically consume the exact
READY handoff. Only this explicit path accepts the canonical continuation prompt;
ordinary prompt and attempt binding remain strict. Replayed nonces and stale
callbacks cannot bind or settle a successor. A final non-resumable result settles
A; only then can B be claimed after normal lease release.

Deadline, Stop, error, uncertain cleanup and lost-authority windows do not grant
automatic continuation. Deadline provenance also prevents an advisory-window
app success from falsely completing logical A. Existing window verdicts and
charges retain their current meaning.

Imports that resume an existing plan share the same job barrier. A partial or
failed import save, or a timed-out asset-report wrapper, requires review even if
the underlying work later returns. A joined best-effort asset save establishes
only that the captured application call settled; its void return does not prove
that every asset byte was durably stored.

## User intent and clients

Stop pauses the queue, invalidates handoffs and flags the current lease in one
transaction, including a READY gap without a live lease and a just-consumed
successor. A legacy Stop can derive the workspace from the authenticated local
build it actually stops. Unsend and Edit revoke the handoff before acknowledging
the take-back. An unknown durable cancellation returns a retryable failure.

The client preserves the active claim across intermediate results and submits
only after a fresh matching READY read. Read/auth/editor waits have deadlines and
Stop cancellation. Delayed callbacks from another session cannot submit. Explicit
pre-admission retiring refusals retry the same body and request identity for a
bounded interval; queued requests do not attach an unrelated predecessor or turn
unknown outcomes into a fresh unbound `please continue` request.

A reopened client pauses for review rather than adopting an old in-memory claim.
Durable progress strictly decreases within the plan-module bound and retains an
absolute continuation count. A newer ordinary request during pending/READY is
refused until the user stops/reviews that chain. Older bundled clients keep their
existing request shapes and receive an honest non-resumable pause for intermediate
queued windows; they cannot use the new automatic protocol until updated.

When optional request UUIDs are available and supplied, retries of one window keep
the same receipt/billing reference, and a genuinely new window gets a new UUID.
The existing per-window wallet pricing and replay guard remain unchanged. There
is no queue-wide debit key. Anonymous and older clients retain the established
capability/optional-receipt policy; the handoff remains one-use, but universal
exactly-once HTTP or billing behavior is not claimed.

## Verification and remaining boundaries

Focused tests exercise real queue/receipt coordination, optimistic transaction
retries, held commit ACKs, actual registered Stop/Unsend authorization, mounted
client requests and captured mirror cleanup. Deliberate reversions reproduce
premature module submission and loss of atomic predecessor lease deletion.

The existing credential-free Firestore script preserves its original fourteen
checks and adds seven real multiprocess handoff checks: normal progression with
per-window receipts, one-use races, Stop ordering and explicitly labelled
post-commit ACK loss. The local run passed 21/21. Full final-source checks and
exact-head CI remain release gates and are recorded separately before merge.

The isolated implementation was committed as `37e667e` after 18 focused files /
261 tests, sequential frontend/server typechecks and the import/locals guard
passed. It was then merged with the frozen state-preservation checkpoint
`9ca0ddd` at `7c6194c`. The verified asset-owner argument, deadline helper and
lease census, five mixed-owner erasure refusals, user disclosures and both
progress histories are preserved. These pre-merge focused results do not replace
the combined-source complete suite, build/boot and exact-head CI gates.

The merged-source focused cohort passed 20 files /310 tests. Sequential frontend
and server typechecks, imports/locals, native, OAuth, production build, bundle,
boot, production dependencies, audit/license and SBOM checks passed. The first
merged emulator run failed because its concurrent race demanded a confirmed ACK
when the production queue deadline correctly returned UNKNOWN. That failed run
is not passing evidence. The corrected race keeps UNKNOWN distinct, confirms an
idempotent Stop when needed, and checks authoritative paused/no-ticket/exact
lease state. The final run passed all 21 checks, including two explicitly
injected post-commit ACK-loss race interleavings. No original check, timeout or
drill count was weakened. The complete suite and exact-head CI remain pending.

After the durable-deletion sibling and the corrected canonical-history test were
integrated, the final focused cohort passed 21 files /312 tests, and sequential
types/build/boot and the remaining quick gates passed again. The deletion
negative control produced READY while its held source deletion had not run;
the safe tracker was restored. No all-queue drain guarantee follows from these
checks; the final queued-step boundary below remains open.

At 2026-10-20 11:07 UTC, the complete queue preflight at `a64370b` had been
stopped with exit 130 after two stale exact-source assertions expected the old
untracked final save and direct asset callback. It is not passing evidence.
The same kept-turn guard and save fallback remain in production. Their updated
tests execute the actual source expressions, check saved text/binary bytes,
verified-only optional asset ownership and swallowed fallback failure. Five
focused files /125 tests passed; deliberate no-op save and dropped-owner
reversions failed on missing bytes and the stored owner, then were restored.

The previous state-preservation head `00d3bc8` passed 2,811 files /40,077 tests
with 67 skipped locally. Its
[running CI](https://github.com/docasheesh-png/navbharatai/actions/runs/39411761077)
is superseded for review by newer main `6852819`. Current combined local/CI
checks remain pending. Merge/CI outcomes are recorded by later release evidence;
this timestamped snapshot is not a claim of current remote success.

This preserves the existing shared runtime and preview origin. It does not fence
remote SDK commands already running, make source writes transactional across all
workers, or establish state migration/replacement safety. A timed-out owned save
pauses automatic continuation; its underlying operation may still finish, and
ordinary manual admission/source fencing remains an open boundary. Captured local
mirror cleanup is joined; cross-instance account-wide mirror generation fencing
is not newly guaranteed. These tests do not establish production provider,
Cloud Run, browser-origin, database migration or physical process-drain behavior.

Final non-resumable queued steps have a separate OPEN source-overlap boundary.
Their result currently settles A before the normal-module retirement path, whose
non-intermediate branch does not run the publication join. After the ordinary
lease is released, B can be claimed while an earlier timed-out source/asset job
still runs. This checkpoint protects intermediate automatic handoffs; it does
not establish drainage for final queued A→B transitions or general admission.
An exact final-binding drain/pause policy is required as a separate checkpoint,
preserving window verdicts, pricing, Stop and client claim liveness.

Inherited legacy workspace-key prefix ownership/private-access ambiguity also
remains open pending trustworthy attribution and migration; this checkpoint does
not establish correct ownership for every historical workspace or account.
Phases 3–6 have not started and no permanent 100/100 score is asserted.

The next ownership/security gate has a concrete
[prospective design](PHASE2_VERIFIED_WORKSPACE_OWNERSHIP_DESIGN.md), covering an
authoritative registry, exact client bindings, old-server refusal, account
lifecycle and verified legacy migration. That document is **not implemented**;
normal queue handoff does not resolve private legacy ownership.

Fresh allocation also remains a separate gate. Its reviewed
[dispatch and initialization design](PHASE2_ALLOCATION_AUTHORITY_DESIGN.md)
is **not implemented** and preserves the independent review and local SDK retry
evidence. Normal module handoff does not supply allocation idempotency, safe
unknown-operation replay or complete restoration evidence.

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
heartbeat or initializer release cannot do so. Retirement joins captured source
and memory saves, cancels progress timers, joins owned green-proof publication,
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

This preserves the existing shared runtime and preview origin. It does not fence
remote SDK commands already running, make source writes transactional across all
workers, or establish state migration/replacement safety. A timed-out owned save
pauses automatic continuation; its underlying operation may still finish, and
ordinary manual admission/source fencing remains an open boundary. Captured local
mirror cleanup is joined; cross-instance account-wide mirror generation fencing
is not newly guaranteed. These tests do not establish production provider,
Cloud Run, browser-origin, database migration or physical process-drain behavior.
Inherited legacy workspace-key prefix ownership/private-access ambiguity also
remains open pending trustworthy attribution and migration; this checkpoint does
not establish correct ownership for every historical workspace or account.
Phases 3–6 have not started and no permanent 100/100 score is asserted.

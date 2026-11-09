# Chat supplier retry boundary

## Status: accounting foundation, not operational three-plus-three retries

The requested upper ceilings are **three total Mitrify HTTP calls, then three
total Qubax HTTP calls**, stopping on success. They are recorded as immutable
server constants, not as dispatch permission. Current Chat transports continue
to allow **one call per separately reviewed single-use supplier approval**.
There is no retry activation setting, receipt verifier, or new approval writer.
Setting a Cloud Run credential does not change this boundary.

Operational three-plus-three remains blocked by two missing pieces:

1. An independently authenticated supplier receipt, tied to the exact physical
   request, establishing no generation, no output, and zero financial liability
   for the failed call. Neither supplier currently has such a verifier in this
   integration. HTTP 429/503, a JSON `cost: 0`, an evidence-reference string, or a
   stored boolean does not establish those facts.
2. Separately scoped operator approval for each additional physical call,
   including the exact payload, credentials, selected model/revision, downstream
   processors and enforceable spend ceiling. Existing single-use approvals must
   not silently become three-use approvals.

No generic inactive receipt port is provided: it would not supply the missing
authentication and could be mistaken for a real supplier integration.

## Implemented safeguards

- The Gateway's fixed-v1 **ordinary Chat only** execution loop now honors its
  existing 12-physical-call maximum instead of stopping after an unrelated
  four-call loop. Every call still requires a distinct durable claim, trusted
  history, current policy, quota and budget admission. The tighter request cap
  and deadline still win. This does not allow replay of an attempted profile.
- Fixed Chat counts Mitrify at its conservative HTTP dispatch boundary rather
  than at budget reservation. Error metadata records whether the reviewed
  transport reached that boundary. This is local dispatch metadata, not proof
  of an invoice or zero liability. Low-level errors leave it unknown;
  `dispatched: false` alone permits no retry.
- When fixed Chat's Mitrify daily admission throws or returns a duplicate hold,
  only the newly created, undispatched monthly hold is released. The existing
  or uncertain daily liability is not refunded and the request remains terminal.
- Mitrify and Qubax Chat calls remain single-call. Ambiguous supplier charges,
  caller cancellation, partial output, lost responses and stream failures do not
  trigger another supplier. Qubax may still skip confirmed pre-dispatch
  revocation/timeouts under its existing narrow rules; this is not a retry.

Pro, Builder, professional/doctor/SDA/developer-API execution limits and nonfixed
routing are unchanged. The standalone Test Chat Bot remains Qubax-only and
single-call. Mitrify's separate low-level/manual transport retains its historical
four-call default; both Chat entry points explicitly restrict it to one.

## Conditions for any future operational retry implementation

Keep scheduling above single-call adapters so every physical call gets a unique
durable attempt ID and its own current approval. Recheck cancellation, kill
switches, supplier constraints, deadline, physical-call cap and shared budget
before each call. Keep the existing free-provider ordering, then the Mitrify
stage, then Qubax, then later eligible direct providers. A retry is optional and
bounded, never a promise to consume all three calls.

For Qubax, revalidate the exact equivalent workload and independently reviewed
prices at every dispatch, filter for at least 90% savings, then rank by reviewed
quality, reliability, latency and conservative cost. A different selected model
requires a new exact approval, not reuse of the previous model's approval.

The **aggregate logical-request ceiling** matters. Three potentially billable
Qubax calls each costing 10% of one official workload can cost 30%, which is only
70% savings. A per-HTTP discount is insufficient. Require authenticated zero
liability for earlier failed calls, or a separately verified supplier-enforced
aggregate ceiling no greater than 10% of the same official workload. Never
release unknown charges to make that comparison pass.

The global limit remains 12 physical calls and the ordinary Chat deadline remains
240 seconds. If five earlier free calls and all six supplier calls occur, only
one call remains for later direct providers. Do not raise the cap or multiply
deadlines silently. Preserve shared daily/monthly reservations and do not charge
both Gateway and legacy pools for one attempt.

Application HTTP attempts are observable; Qubax's internal seller retries are
not. This integration cannot set or verify a three-seller retry maximum. Internal
retries/failovers/fees must remain covered by the reviewed supplier ceiling.

## Offline verification

Synthetic tests cover fixed Chat reaching the fifth provider and the declared
cap, unique attempt IDs, unchanged other-surface limits, single-use approvals,
Mitrify dispatch metadata and monthly cleanup, no replay/refund on 429/503, and
rejection of self-asserted zero-charge retry authority. These are not live billing
receipts, savings measurements, quality benchmarks or production activation.

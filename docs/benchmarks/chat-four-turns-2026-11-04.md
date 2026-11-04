# Four questions per 1,000 users — isolated experiment, 2026-11-04

## Scope and outcome

The realistic four-turn scenario returns all 4,000 synthetic responses to 1,000
users with 25 ms adapters. Overlapping same-user requests and slow adapters do not
achieve all answers. Passing the stress assertions means expected safeguards held,
not that every stress request succeeded. This is not a production capacity claim.

Run `CHAT_LOAD_REPORT=/tmp/navbharatai-four-turn-final.json npm run test:load:chat`
with Node 22.23.4/npm 11.18.0. The 13 scenarios exercise the real router, admission,
provider pools, breakers and OFF matching; adapters, quota/spend store, controls,
cache and telemetry are mocked. No HTTP/auth, real provider, real network latency
or multi-replica capacity is measured. A separate real Firestore emulator drill
below exercises the quota implementation. No paid inference or production traffic.

Each sequential user submits four turns with prior exchanges in history; up to
1,000 logical requests are pending. The overlap case starts 4,000 requests grouped
four per user. Each successful reply must match its unique request marker. All
scenarios explicitly disable cache in the fixture; production cache is unchanged.
Cache lookups, hits and lookup misses are all zero: cache is bypassed, not reporting
4,000 cache misses. Physical mock dispatches are recorded separately in raw metrics.
The sequential success case performs exactly 4,000 adapter dispatches. The physical
provider concurrency peaks at 8, not 1,000/4,000.

## Measurements

All-outcome percentiles include controlled refusals; successful-only percentiles,
per-user completion distribution, total four-turn duration, CPU, sampled heap/RSS,
event-loop delay, fallback and dispatch counts are in the raw JSON. Memory includes
the test runner and prior scenarios and is not an application memory guarantee.

| Scenario | Replies | Users with all four | Request p95 / p99 ms | Peak RSS MiB | Refusals |
|---|---:|---:|---:|---:|---|
| users-1000-four-turns | 4000/4000 | 1000/1000 | 3184.8 / 3191.8 | 156.8 | {} |
| users-1000-four-overlap | 1008/4000 | 0/1000 | 2617.2 / 3129.2 | 175.2 | {"user-limit": 2992} |
| users-1000-four-turns-slow | 161/4000 | 32/1000 | 5010.5 / 5013.8 | 168.7 | {"timeout": 3839} |
| users-1000-four-overlap-slow | 40/4000 | 0/1000 | 5000.7 / 5000.9 | 139.5 | {"user-limit": 2992, "timeout": 968} |

## Bottlenecks and safe changes

- Local Chat admission stays eight active, 1,024 waiting, five-second queue deadline,
  one active/one waiting per user and16 MiB queued serialized payload budget.
- The real HTTP route also acquires shared FreeAnswer ownership before local
  admission. Four overlapping requests cannot all own the same user reservation.
  Relaxing only local per-user limits would not fix this; sequential turns preserve
  the existing contract and conversation ordering.
- At one-second replies, eight slots provide at most eight replies/second before
  overhead: 1,000 queued requests need about125 seconds; 4,000 need about500 seconds.
  That exceeds the five-second queue wait and90-second client/reservation contract.
- A separate experiment with 1,024 requests/one-second adapters yielded 40 replies
  at 8 active, 80 at 16, and 19 at 32/64 because the fixture's 19 physical slots saturated.
  Higher admission can increase immediate failures; it was not shipped.
- Per-process concurrency does not increase shared provider RPM/token/neuron or
  monetary allowances. Cloud Build declares 100 HTTP requests/instance and up to 100
  instances; live deployment and provider entitlements were not verified or changed.
- A 1024-way same-account quota transaction experiment failed to complete within
  its bounded 90-second run; sequential document reads also did not resolve it.
  New bounded local per-DB/provider lanes prevent that transaction stampede while
  retaining Firestore transactions as the cross-replica authority. Max 32 active
  lanes, 1024 total waiters, 10-second wait; no cached quota grants. A running SDK
  transaction keeps ownership until physical completion.

## Real emulator evidence

`node --import tsx scripts/freeChainQuotaLane.check.mjs --emulator 127.0.0.1:18781`
with matching FIRESTORE_EMULATOR_HOST and the repository's pinned Firestore jar:
1,024 requests through 32 store handles, 10,021.1ms elapsed, p95 9,991.2ms, p99 10,000.5ms;
27 grants, 947 RPM refusals, 50 local-capacity refusals. Durable usage was exactly 27
under unchanged 30 RPM / 0.9 margin; peak physical same-account transaction count 1,
active 0 after drain. The 10-second bound is enforced, not hidden as a storage outage.
No production database or provider used. This is a quota-decision test, not 1,024
AI answers or proof of cross-replica throughput. Local OpenJDK 21 differs from CI's
Temurin 21 distribution.

Full local/hosted validation is recorded in PROGRESS.md and the PR. The initial
nine-case baseline remains in chat-burst-2026-11-04.md. Raw final metrics and tested
source hashes: [chat-four-turns-2026-11-04.json](chat-four-turns-2026-11-04.json).

Remaining real-capacity blockers: verified provider allowances and latency, shared
storage/replica throughput, acceptable response deadline, and a separately approved
live traffic/spending plan. A durable asynchronous API could handle longer waits
but requires a separate ownership/idempotency/cancellation/result contract; this
change does not silently replace the synchronous API or remove quota/fairness.

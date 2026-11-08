# Six-part Chat follow-up — isolated validation, 2026-11-04

## What changed

1. Nonempty `finishReason=length` responses are marked truncated/stalled and never
   cached as complete. Delivered text and paid usage/unknown holds are preserved;
   no second provider is mixed into committed output. Complete replies keep normal
   cache eligibility/TTL. Older cache entries lack finish metadata and cannot be
   retrospectively classified by this change.
2. Local transaction admission pressure cannot open a provider-wide circuit for
   an artificial minute. Actual quota reset and provider cooldown still bind.
3. Zero-reservation turns facing only busy slots may wait for physical capacity
   within the original queue-wait budget and re-scan. Cancellation, OFF, 32 re-scan
   and 64-waiter caps apply. No retry after any quota reservation attempt, no new
   provider limit and no extra paid dispatch are introduced.
4. The Free Chat composer offers an explicit Queue action for three additional
   text questions. It sends them sequentially with current history, keeps a new
   draft intact and clears pending work on failure/incomplete output, Stop,
   unmount, account/session/mode change or 90-second sequence expiry. Each text
   is at most 16,000 characters; no attachments or persistent storage. Ordinary
   duplicate Send remains blocked. This is browser-local, not cross-device or
   distributed queuing; raw overlapping API calls still obey shared ownership.
5. The existing independent 16-case/4,000-record closed-answer evaluator remains
   available. No real model responses were available: actual accuracy is unmeasured,
   not 100%. Mock transport responses and grader self-check fixtures are not accuracy
   evidence. Open-ended teacher grading still needs independently reviewed rubrics
   and calibration. See chat-answer-quality.md for criteria and provenance limits.
6. All four shared admission acquisition sites now supply serialized payload bytes.
   Gateway ingress accounts verified request bodies, and direct calls account full
   inputs, including system prompts/attachments. The common 16MiB waiting budget
   does not bound total heap or active requests. Aggregate rejection is tested with
   the real admission queue before any provider dispatch.

## Reproducible offline workload

`CHAT_LOAD_REPORT=/tmp/chat-six-fixes.json npm run test:load:chat`

Node 22.23.4/npm 11.18.0, four available CPUs. Sixteen scenarios, 28,416 logical turns.
The real FreeChain router/admission/pools/circuit breakers/OFF logic executes.
Providers, quota/spend store, controls, cache and telemetry are mocked. HTTP/auth,
real provider latency/quality, replicas and production capacity are not measured.
No production traffic or paid inference. Real Firestore quota tests are separate.

One thousand distinct synthetic users each ask four sequential questions; the
stress counterpart submits 4,000 overlapping requests grouped four per user. Each
complete reply must match a unique request marker. Only complete successful
outcomes count in `ok`; stalled replies have a separate `partialResponses` count.
This tests completeness/identity, not factual correctness. All cache reads/hits/
lookup misses are zero because cache is explicitly bypassed in the fixture;
production cache is unchanged. Raw metrics count actual mock adapter dispatches.

## Measurements

| Scenario | Complete replies | Users with all requested replies | Partial | All-outcome p95/p99 ms | Peak physical | Peak RSS MiB | Incomplete/refused reasons |
|---|---:|---:|---:|---:|---:|---:|---|
| users-1000-four-turns | 4000/4000 | 1000/1000 | 0 | 3184.0/3188.9 | 8 | 159.2 | {} |
| users-1000-four-overlap | 1008/4000 | 0/1000 | 0 | 2631.7/3133.7 | 8 | 181.6 | {"user-limit": 2992} |
| users-1000-four-turns-slow | 160/4000 | 32/1000 | 0 | 5009.4/5011.4 | 8 | 186.9 | {"timeout": 3840} |
| users-1000-four-overlap-slow | 40/4000 | 0/1000 | 0 | 5000.9/5001.1 | 8 | 195.6 | {"user-limit": 2992, "timeout": 968} |
| truncated-1024 | 0/1024 | 0/1024 | 1024 | 3106.9/3236.2 | 8 | 305.1 | {"stalled": 1024} |
| single-slot-recovery-128 | 128/128 | 128/128 | 0 | 3118.5/3244.3 | 1 | 316.9 | {} |
| local-quota-recovery-1024 | 1016/1024 | 1016/1024 | 0 | 3087.6/3220.1 | 8 | 311.3 | {"all-failed": 8} |

The 1,024-turn local-pressure fixture refuses the first eight quota admissions,
then permits later requests; successful recovery does not mean any real quota was
increased. The one-slot fixture holds an actual local rung limit of one. The
truncation fixture sends nonempty text but signals length exhaustion; none of those
responses count as complete. Cache-enabled regressions separately verify that
truncated answers are not inserted and complete answers still are.

All-outcome percentiles include quick refusals. Successful-only percentiles,
four-turn user durations, per-user failure distribution, CPU, heap, event-loop
latency, provider dispatch/fallback and final queue state are in the raw JSON.
Sampled process memory includes Vitest and preceding scenarios, not per-request
RAM. The router's physical concurrency is at most 8 (or 1 in the constrained case),
not 1,000/4,000 real simultaneous inference calls.

## Validation and limits

See PROGRESS.md and the PR for final full-suite/CI results. The initial integrated
coverage launch hit a stale lock owned by a zombie from the superseded local run;
its retry used a separate report directory with unchanged thresholds. A bounded-
state census required the new 64-waiter Set to be documented, and the old physical-
ownership fixture needed to settle the newly resumed call after originals released.
Its cap/ownership assertions were retained and strengthened; no test was removed
or threshold weakened. Corrected full coverage must pass before merge.

Quota emulator: 1,024 concurrent decisions, 27 permitted grants under 30 RPM / 0.9 margin,
587 RPM refusals and 410 local-capacity refusals; durable usage 27, physical peak 1.
That run shared local resources with coverage and is correctness/backpressure
validation, not a production throughput benchmark. Existing 21 queue/retry,
13 autopsy, 8 comparison and 78 session-rule checks also passed. Local OpenJDK 21 differs
from CI's Temurin 21 distribution.

The hard limits remain: per-process 8 active Chat turns, 5-second default admission
wait, provider/account quotas and spend controls, and shared per-user ownership.
The 90-second HTTP/client contract does not promise arbitrarily long waits.
Browser sequencing reduces same-user overlap; it cannot manufacture provider
capacity or guarantee four answers after failures. Real capacity/quality requires
verified provider access and a controlled authorized test/spend plan. This workspace
had no standard free-provider credentials. The earlier Cloud Build dependency-
network failure and unverified release-freeze status are separate deployment
blockers; this change does not retry that build or alter release settings.

Raw results/source hashes: [chat-six-fixes-2026-11-04.json](chat-six-fixes-2026-11-04.json).

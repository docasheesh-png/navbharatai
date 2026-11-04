# Isolated Chat burst experiment — 2026-11-04

## Result and limits

The new default admitted and completed 1,024/1,024 simultaneous synthetic turns
with 25 ms provider replies: p95 3,118.4 ms, p99 3,245.6 ms. The same runtime with
the old 64-waiter configuration completed 72 and refused 952. This measures burst
queueing, **not 1,024 simultaneous provider calls or production capacity**.

Active turns stay at eight, GLM free rungs at two/one, queue expiry at five seconds,
and per-user active/queued limits at one/one. The queue allows 1,024 waiters with
at most 16 MiB of serialized UTF-8 payloads. Existing explicit queue overrides
still win. No live provider, quota, budget, autoscaling or Admin OFF setting changed.

## Method

Run from the repository root: `npm run test:load:chat` (Node 22.23.4, npm 11.18.0,
Linux x64, four available CPUs). Nine scenarios / 10,240 logical turns / 17.18 s.
Each scenario starts 1,024 simultaneous workers (2,048 for overload), one turn per
worker; no retries or think time. The legacy baseline overrides only maxQueued=64.
The actual FreeChain router, queue, provider bulkheads, classifiers, circuit breakers
and global OFF checks execute. Providers, durable quota/spend storage, chain-control
reads, cache and telemetry persistence are mocks; no production requests or paid
inference. Quota normally permits attempts; the quota scenario denies every
reservation. Paid reservations deny dispatch. Only GLM, Groq and Cloudflare have
synthetic configured credentials; OpenRouter discovery and paid fallback throughput
are not exercised. Both simple and teaching prompts retain the requested order.

The HTTP server, token verification, browser streaming, real SDK/network latency,
Firestore contention, replica scheduling and real-provider capacity are not measured.
Cloud Build declares 100 HTTP requests per instance and up to 100 instances; these
are configured limits, not verified live deployment/capacity. This benchmark directly
calls the router to stress a single process beyond that HTTP concurrency setting.

## Measurements

Percentiles below include all completed outcomes, including controlled refusals.
Raw JSON also reports successful-only p95/p99 and successful throughput, avoiding
any inference that fast rejections are successful answers. RSS/heap peaks are sampled
process measurements, including the runner and preceding scenarios; they are not
per-request memory or a hard heap bound. Event-loop histograms with no samples are
null. CPU is process user/system time measured over each scenario.

| Scenario | Turns | Replies OK | Non-OK | All-turn p95 ms | All-turn p99 ms | Peak RSS MiB | Non-OK reasons |
|---|---:|---:|---:|---:|---:|---:|---|
| baseline-1024 | 1024 | 72 | 952 | 112.3 | 241.4 | 125.8 | {"queue-full": 952} |
| burst-1024 | 1024 | 1024 | 0 | 3118.4 | 3245.6 | 138.0 | {} |
| overload-2048 | 2048 | 1032 | 1016 | 2977.9 | 3233.3 | 152.4 | {"queue-full": 1016} |
| glm-failure-1024 | 1024 | 1024 | 0 | 3120.7 | 3258.3 | 145.7 | {} |
| slow-provider-1024 | 1024 | 40 | 984 | 5007.0 | 5007.4 | 151.4 | {"timeout": 984} |
| large-payload-1024 | 1024 | 0 | 1024 | 640.7 | 700.0 | 315.6 | {"capacity": 903, "all-failed": 121} |
| quota-refusal-1024 | 1024 | 0 | 1024 | 100.2 | 102.8 | 315.6 | {"all-failed": 1024} |
| same-user-1024 | 1024 | 2 | 1022 | 11.5 | 11.6 | 306.7 | {"user-limit": 1022} |
| disabled-google-1024 | 1024 | 0 | 1024 | 80.8 | 83.3 | 307.2 | {"all-failed": 1024} |

Healthy 1,024-turn burst: sampled heap peak 53.5 MiB, process CPU 290.0 ms user +
24.6 ms system, event-loop p99 10.93 ms. Physical calls peaked at eight; the model
split was GLM-4.5 256, GLM-4.7 128 and Groq 640, with concurrency skips preserving
order. No order violations, uncaught exceptions or Google dispatch occurred, and
all scenarios ended with zero active/queued turns and users.

GLM failure: three initial synthetic 503 attempts, three within-turn fallbacks, then
circuit skips; Groq answered all 1,024. The 2,048 burst admitted 8+1,024 and refused
the rest. With 1,000 ms replies only 40 succeeded and 984 hit the unchanged queue
deadline. Large synthetic system prompts caused 903 byte-budget refusals; the other
121 were rejected by existing context limits, with zero physical dispatch. The
large-payload case reached 315.6 MiB RSS: the 16 MiB bound applies to retained queued
serialized payloads, not serialization transients, active inputs or total process RAM.
Quota refusal prevented all dispatch. Same-user overlap retained only one active and
one queued turn. Gemini was marked synthetically configured in its exhaustion case
but skipped as disabled; Vertex is not a chain rung and its host gate was asserted.
Existing transport/sync regressions also pass.

## Validation and evidence

- Full local coverage: 3,213 files; 48,442 passed, 85 skipped; 857.23 seconds.
- Coverage: statements 75.66%, branches 71.60%, functions 78.28%, lines 77.66%.
- All CI-equivalent local checks passed: clean install, audit, signatures, license,
  SBOM, frontend/server/benchmark typechecks, unused-import/native/OAuth checks,
  build, bundle, boot and production dependency gate.
- Real local emulator drills: 21 queue/retry, 13 autopsy, eight DeepInfra comparison
  and 78 session rules assertions. Synthetic data/providers only. Local OpenJDK 21
  differs from CI's Temurin 21 distribution.
- Targeted provider-OFF, physical-slot, entry and admission regressions: 106 passed.
- Benchmark: nine scenarios passed. This is an opt-in experiment, not a flaky wall
  clock threshold added to the full CI suite. The 1,024-turn functional drain is
  also locked by a deterministic fake-clock regression in the normal suite.

Raw metrics: [chat-burst-2026-11-04.json](chat-burst-2026-11-04.json). The raw artifact
records SHA-256 hashes of the tested routing and harness files; `working-tree`
means the experiment ran before its final documentation commit. Reproduce with
`CHAT_LOAD_REPORT=/tmp/chat-burst.json npm run test:load:chat`. Full gate commands
are the unchanged `.github/workflows/ci.yml`; no test or threshold was removed.

Real production capacity remains unverified. Its constraints include provider-account
quotas/latency, shared transactional storage, HTTP/replica capacity and spend controls.
A billable/live test requires a separately approved target, traffic and spending plan.

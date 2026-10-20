# Release quality scorecard — 2026-10-20

**Release verdict: BLOCKED. No 100/100 or ≥95% verified-success claim.**

Audit reference: `adc53ee215beb5b7f7c5042245b2817c16a2deca`.
Implementation base: `8e43c4039` on `fix/release-reliability-evidence`.
This checkpoint hardens existing work; it does not complete all six phases.
Local runtime: Node 24.19.0, Linux, UTC. Repository CI uses Node 22.
Remote CI, production rollout and live-provider outcomes are separate gates.

## Status by acceptance criterion

| Phase | Verified here | Still required before completion |
| --- | --- | --- |
| 1 — Security | Registered preview/queue routes exercise missing, invalid, expired, cross-account and valid-owner tokens; dependency gate passes with 0 critical / 4 triaged high package entries | Independent verified workspace ownership: legacy custom UID/session pairs collide. Historical ownership cannot be inferred from a prefix or a last-written owner field. A verified migration/recovery plan remains a release blocker. Review dependency exceptions by 2026-11-03. |
| 2 — Build safety | New admission fails closed; 14 real emulator/multiprocess coordination drills pass. Running builds now stop cooperatively on uncertain renewal, retain the local body-exit hold and keep attempting renewal while draining. Uncertain ownership has its own cause/outcome, never a fabricated claim of replacement or user cancellation. | Cooperative abort is not distributed source/command fencing. A prolonged partition, stalled event loop, in-flight remote command or expired lease can still cross an automatic takeover. Need state-preserving execution ownership, remote-command drain/fencing, resumable handoff and late-write reconciliation. |
| 3 — Benchmark | Existing 15/50 prompt harness dry-runs. Runner now authenticates, uses replay-safe request IDs, checkpoints IDs before submission and outcomes after completion, records source/fixture provenance and latency/cost p50/p95. Scripted local HTTP tests verify protocol only. | Configured staging account/provider/sandbox and approved spend ceiling; actual baseline; 100–200 representative tasks with held-out, edit/import cohorts and independently observed critical journeys. First-attempt success and edit preservation are currently unknown. |
| 4 — Generated apps | Outcome reduction cannot turn `result.ok=false` into success from a later `done.ok=true`. Existing gate/render evidence remains distinct from critical-flow proof. | Run real generated-app browser/backend journeys, build requirement-to-test traceability and repair measured failure cohorts with bounded loops. No generated-app success percentage was measured here. |
| 5 — Maintainability | Benchmark tools have a strict TypeScript configuration and CI check; setup docs explain the actual server environment loading and builder prerequisites. | Cohesive route/UI extraction, gradual frontend strict migration (850 diagnostics measured under strict/null/implicit-any checks) and complete exact-head CI. The builder route remains a monolith; a small strict-tooling cohort does not complete the phase. |
| 6 — Operations | Production build/boot and bundle budgets pass. Local load testing exposed probe throttling; exact liveness/readiness paths now bypass the behavioral bot guard while deep health/admin/lookalikes remain guarded. | Representative authenticated builder capacity, real-device profiling, actual production-like rollback and backup-restore drills. Local liveness throughput is not build capacity. |

## Changes and regression boundaries

- Lease renewal rejection/deadline now aborts the captured build with
  `authority-unavailable`, keeps `requiresBodyExit`, and does not release merely
  because the stream closed. Recovery cannot revive that aborted attempt.
  Existing successor-token protection is preserved. The new interruption is
  classified as platform-owned, excluded from app blockers, and does not qualify
  for user-cancellation billing or an engine-capability upsell.
- Paid benchmarks require `BENCH_AUTH_TOKEN`. Remote targets require HTTPS,
  redirect forwarding is refused, and tokens/server error bodies are absent from
  result artifacts. Request/session IDs are written before sending the HTTP request, so a mid-build runner crash leaves reconciliation identity. Unique artifact names isolate concurrent runs. Authentication failure stops the batch. Transport failures
  carry unknown remote cost/outcome and stable reconciliation IDs, with no automatic
  retry. Partial files retain `running`/`blocked` status.
- Comparison verdicts refuse gains for mismatched cohorts, incomplete batches,
  differing fixture hashes or unreconciled transport/auth failures. Old artifacts
  have less provenance; even matching files do not establish identical remote
  configuration or independently verified critical flows.
- The shared metrics parser gives the final result priority over lane-completion
  events. Nearest-rank p50/p95 include sample counts; missing measurements stay
  unknown. Independent repetitions are not repair attempts.
- Only `/api[/v1]/live` and `/api[/v1]/ready` (including trailing slash) receive the
  probe exemption. Deep `/health`, admin backup and similarly named paths retain
  behavioral protection. This fixes false probe failures; it is not a general
  rate-limit relaxation.

## Evidence

Final verification results are recorded in the accompanying
[`release-quality-2026-10-20.json`](evidence/release-quality-2026-10-20.json).

The emulator used the exact Firebase CLI lockfile download: version 1.22.0,
136707194 bytes, SHA-256
`9b6498b7f62714d67f48f59b3818883cd682dbcd46b9f59511de81c97bb5166c`.
The 14 drills cover cross-process queue visibility/claiming, same-process lease
contention, stale replacement protection, worker death/recovery, stale settlement,
commit ACK loss, concurrent/replayed wallet settlement, receipt reservation,
request replay and real loopback TCP outages. ACK/deadline injections and clock
advancement are explicitly identified in the artifact. No paid model, E2B or
Cloud Run calls are represented by those results.

Final local product suite: **2,831 files and 40,404 tests passed; 67 skipped;
zero failures** (462.27 seconds). Runtime source matches `ef54d679a`. A later
benchmark CLI-only checkpoint follow-up passed 33 focused tests and strict
typechecking. An earlier run used the outdated probe-test fixture and is not a
green gate; its correction also passed all 23 cache tests separately.

Exact-head remote CI is published under [PR #3867 checks](https://github.com/docasheesh-png/navbharatai/pull/3867/checks).
Those checks are the authority for the reviewed head; a cached earlier green
result never establishes a later head. The JSON artifact links to the checks
rather than claiming CI success before completion. No checks were bypassed and no production deployment was performed.

The probe retest completed 13,941 requests with 0 errors (20 concurrent callers,
10 seconds); p50 10 ms, p95 35 ms. Before the fix the same local test returned
19,160 errors out of 19,283 requests (mostly 429). Both runs share a localhost
caller and concurrent test load; these figures are evidence of the probe-policy
fix, not a controlled capacity comparison. Versioned and trailing-slash
liveness/readiness requests also returned 200 after that burst.

## Next concrete gate

Resolve legacy ownership with independently verified attribution and design the
state-preserving runtime/write fence. Supply a configured staging environment,
a dedicated test account and a maximum total evaluation spend through environment
bindings. Then execute the authenticated baseline and interruption journeys,
reconcile every build's outcome/cost, and use measured failures to drive Phase 4.

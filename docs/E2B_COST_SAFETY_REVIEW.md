# E2B cost safety review, 2026-11-08

## Scope and evidence

Baseline: `6dca2d474871aeafa615ebc683517f0de1e2c61b`. This is a narrow lifecycle-safety repair, not a measured cost reduction or completion of the wider optimization program. No live sandbox, billing, credential, deployment configuration or user project is changed by these tests. Resource sizes and timeout defaults remain unchanged.

## Existing controls, not new savings

- Ordinary idle pause: 5 minutes; current static snapshot: 3 minutes (`sandboxReaper.ts`, `sandboxLifetime.ts`).
- New create requests ask for pause-on-timeout: 6 minutes, extended by a busy heartbeat every 2 minutes. Operation-driven extensions are throttled (`sandboxLifetime.ts`, `E2BActuator.ts`). E2B connect/setTimeout do not convert a legacy kill-on-timeout lifecycle; the running fleet's policies are unverified. Do not disable application pauses or shorten timeouts based on an assumed provider policy.
- Durable activity refresh: 5-minute throttle; orphan eligibility: three missed refreshes plus a 5-minute margin, normally 20 minutes. Eligibility is not a deadline or a proof that a VM is stopped.
- Workspace reuse, durable resume, dependencies baked into templates and static preview snapshots already exist. No new warm pool is introduced.
- Template workflow defaults: 2 vCPU/4 GiB for the ordinary builder, 4 vCPU/8 GiB for Android/full-stack. Actual production template and overrides were not read. Do not downsize builds without measured memory and latency headroom.

## Root causes repaired

| Problem | Repair | Regression coverage |
| --- | --- | --- |
| The same bounded stale-record page can repeatedly contain already-paused history, hiding other candidates. | Snapshot-cursor pagination over raw records, including timestamp ties and malformed rows; one bounded page per pass; recent stale rows first after restart. | `sandboxReaperStoreSafety.test.ts`: >50 paused records, ties, mutation/deletion, exhaustion, query failure and bounds. |
| Pause failures escalated to deletion and could be marked paused without a confirmed pause. | Automatic cost sweeps never kill. Keep unresolved allocation records eligible for retry; bounded per-sandbox warning history. | `sandboxPauseFailure.test.ts`, `sandboxSweepSafety.test.ts`. |
| State can change while a durable read or provider pause is pending. | Recheck local holds and exact durable allocation/activity before pausing; transactional compare-and-set for pause metadata; preserve replacement handles, pending creations and their cache. | `sandboxSweepSafety.test.ts`, `sandboxReaperStoreSafety.test.ts`. |
| Slow provider calls can overlap the next scheduled sweep. | Single-flight guard spanning idle and orphan work, reset in `finally`. | `sandboxSweepSafety.test.ts`. |
| A long build can extend E2B's lifetime without refreshing durable activity visible to another instance. | Busy heartbeat refreshes an existing matching durable allocation, with the existing 5-minute throttle. It cannot create a record or replace a newer sandbox identity. Creation/hot-path initialization remains unchanged. | `sandboxSweepSafety.test.ts`, `sandboxReaperStoreSafety.test.ts`. |

## Limits and open work

1. **No global pause fence yet.** A remote instance can become active after the final durable read and before the provider pause. Metadata compare-and-set prevents false settlement; it cannot undo a pause or protect an in-flight remote command. Coordinated ownership across every create/resume/activity/pause path remains open. See `PHASE2_ALLOCATION_AUTHORITY_DESIGN.md`, which is a design, not an implemented allocation authority.
2. The scan cursor is process-local. Restarts reset it, and a large history takes multiple sweeps. This does not promise complete account inventory or a 20-minute cleanup SLA. Requested provider pause-on-timeout remains the intended crash backstop for new allocations; legacy policy is unverified.
3. Unknown durable state is not permission to pause. Missing or mismatched records are skipped. The conditional heartbeat cannot repair a failed initial identity write or resurrect a deleted record.
4. Existing session “idle” time is wall time outside measured sandbox operations; model wait and active previews can appear idle. It is not all waste. Reconcile provider usage with session reasons, active builds, previews, cold starts, resume latency, template resources and successful build counts before estimating savings.
5. The cost rate is currently global while templates differ in size. Add immutable per-session resource/rate attribution before using it to justify sizing decisions.
6. Content-matching static snapshots still have a 24-hour trust limit. A separate experiment may validate hosted artifacts and content identity before avoiding repeat VM wakes; do not simply remove freshness checks or serve stale applications.
7. File checkpoints and local databases must not be treated as independently verified backups. No destructive orphan purge, project deletion, database deletion or live migration is part of this repair.

## Validation and rollout

Run all required workflow checks and the complete coverage suite on the PR head. Focused tests do not replace CI. Local checks use the workflow's Node 22.23.4/npm 11.18.0 and lockfile dependencies; infrastructure differences and incomplete checks must be reported separately. No paid load test is required for the offline safety cases.

Before production rollout, observe a representative baseline and validate active build, preview, pause/resume, concurrent return, database outage and recovery scenarios in a non-production deployment. Stop on changed files, missing data, duplicate allocation or worse build/preview outcomes. Compare compute cost per successful build and per active preview at similar workload mix. A 90% reduction is only a stretch target until measured.

Rollback is a code revert. This patch adds no collection migration, deletes no durable record, and leaves existing timeouts and sizing unchanged. A revert would also restore the older destructive pause-failure escalation, so review that consequence before reverting indiscriminately.


The five-page SDK list cannot verify legacy timeout policies: E2B SDK 2.50.0 omits lifecycle from list results. See [Running sandbox observation limits](E2B_RUNNING_OBSERVABILITY.md) for the actual-SDK contract test and honest unknown reporting.

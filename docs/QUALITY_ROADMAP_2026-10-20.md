# NavBharatAI six-phase quality roadmap

Requested by the repository owner on 2026-10-20 after the code audit of
`adc53ee215beb5b7f7c5042245b2817c16a2deca`.

The owner authorized implementation in phase order, pull requests, and merging
the work after CI is green. This authorization is for this roadmap's changes;
it is not an instruction to merge unrelated PRs, bypass checks, or fabricate
production evidence. A phase completes only when its acceptance criteria have
evidence. Implementation, CI verification, production rollout and measured
outcomes are separate states. Finishing the roadmap does not guarantee a
permanent 100/100 rating or leadership over other products.

## Progress

| Phase | Scope | Status | Evidence / next gate |
| --- | --- | --- | --- |
| 1 | Security and authorization | MERGED / CI VERIFIED | [PR #3847](https://github.com/docasheesh-png/navbharatai/pull/3847), [successful exact-head CI](https://github.com/docasheesh-png/navbharatai/actions/runs/39370215420), merged as `885ba41023c2f7327be956aadc71f79ee2840821`. Legacy recovery and dependency exceptions remain documented. |
| 2 | Concurrent-build safety and recovery | IN PROGRESS | Queue/retry fixes being separated for review. Runtime isolation proposal is BLOCKED: existing browser-origin data, local databases/uploads and generated secrets need preservation. Real local fault checks pass but do not establish compatibility; see PHASE2_QUEUE_RETRY.md. |
| 3 | Reproducible quality baseline | NOT STARTED | Start after Phase 2; use existing benchmark harness and real outcome evidence. |
| 4 | Generated-app correctness | NOT STARTED | Start after Phase 3; prioritize measured failure cohorts. |
| 5 | Maintainability and strict typing | NOT STARTED | Start after Phase 4; preserve behavior while extracting bounded modules. |
| 6 | Performance and operations | NOT STARTED | Start after Phase 5; measure real devices, capacity and recovery. |

## Phase 1 — security and authorization

- Require a verified owner for private workspace operations, including preview
  diagnose/restart and automatic preview reports. A client-provided uid is not
  authentication. Keep the established anonymous-session capability policy
  explicit and separately tested; do not silently change that product policy.
- Audit registered workspace routes and their siblings, not only a shared helper.
  Test absent/invalid tokens, another account, a valid owner and expired-token
  recovery. Tests must exercise the production auth decision.
- Include the two additional source-confirmed findings from that sibling audit:
  database provisioning must authorize the app before loading migration SQL, and
  version history must use owner-scoped storage keys so equal session suffixes
  cannot cross account boundaries. Update restore writers/readers and account
  erasure together. Use fresh physical collections (`build_history_v2` and
  `build_sessions_v2`), because a legacy bare session id can itself look like a
  full workspace id. Legacy snapshots have no trustworthy owner metadata;
  retain them, refuse unsafe fallback, and explain the limitation. Restoring
  access or attributing legacy records for deletion requires a separately
  verified migration; key shape or workspace existence is insufficient proof.
- Inspect dependency advisory paths and reachable APIs. Apply compatible fixes;
  do not force major downgrades or broaden advisory exceptions to make CI green.
  Record remaining exceptions with exact advisory, reachability evidence,
  mitigation, and review date.
- Preserve versioned and unversioned HTTP contracts. Confirm legitimate clients
  provide tokens and can recover from a token refresh without breaking edits.

Acceptance: authorization regression tests and required CI pass; all discovered
reachable high/critical dependency paths are fixed or explicitly remain OPEN,
with no false claim of phase completion. A source audit is not a production
penetration test or proof of the deployed policy.

## Phase 2 — concurrent-build safety and recovery

- Inspect the existing queue, workspace lease, write serialization and wallet
  idempotency before adding another coordinator.
- Reproduce database unavailability, expired leases, two instances, retries,
  disconnects and a worker crash. Prevent a worker without authority from writing
  or charging again; provide a recoverable waiting/error state.
- Ensure stop/resume and delayed completions cannot change a newer build.

Acceptance: meaningful concurrency/fault tests show no overlapping authorized
writes or duplicate charges in the exercised scenarios. Record any untested
production infrastructure boundary.

Read-only preparation identified these existing paths to investigate after
Phase 1 acceptance:

- `BuildQueue.parseStoredQueue` at the Phase 1 baseline converted a persisted running row to
  failed during ordinary deserialization, including live Firestore transactions.
  A second instance can then claim a later row without proving the first stopped.
- Legacy queue completion payloads lack item/generation identity. Safe additive
  compatibility needs server-owned claim/build binding and settlement; requiring
  a new v1 field or guessing which row a delayed completion meant is insufficient.
- Workspace lease claim errors at the baseline admitted uncoordinated builds; renewal uncertainty
  and delayed writes require fencing, including already-running sandbox commands.
- Preserve the existing transactional wallet operation dedupe. Extend its tests
  for committed-but-unacknowledged operations, retries and concurrent replay.

These are findings and implementation directions, not completed Phase 2 fixes.
Live cross-instance interruption and database-outage drills require a staging
environment. The current runtime has no configured application/sandbox credentials;
the owner has been asked for a configured environment reference, test account and
spend limit. A credential-free local staging alternative is available: a
demo-prefixed Firestore emulator project, two real workers and isolated Docker
fixtures. Use it for the applicable database/process fault drills. Actual
provider/E2B and Phase 3 paid-build runs still need configured access; local
emulator evidence does not establish those external boundaries.

## Phase 3 — reproducible quality baseline

- Extend the existing 50-prompt / 15-prompt smoke harness rather than creating a
  competing scoreboard. Use Hindi, Hinglish and English plus build/edit/import
  and framework cohorts. Keep held-out prompts separate from tuning fixtures.
- Record first-attempt and final verified success, preservation of existing
  flows, p50/p95 duration, provider/sandbox cost, and missing-evidence rates.
- Require complete denominators, attempt lineage and critical-flow evidence.
  Missing observations remain unknown, never zero or successful.

Acceptance: reproducible baseline artifact with commit/configuration, prompt
cohorts, outcomes and uncertainty. Live runs need an authenticated test account,
configured sandbox/provider access and real spend; unit fixtures alone do not
complete this phase. A proposed 95% final-success target is assessed against the
measured baseline, not asserted as current performance.

## Phase 4 — generated-app correctness

- Link requested requirements to implemented files and critical user journeys.
- Verify framework/dependency configuration, real backend availability and the
  requested flows in a browser. Check edit preservation.
- Use bounded evidence-based repair and the existing failure ledger; never
  declare success because a URL exists, compilation passed, or a repair ran.

Acceptance: compare the same benchmark cohorts with baseline, report regressions
and cost/time tradeoffs, and verify critical flows. Prioritize real measured
failures instead of inventing unsupported features.

## Phase 5 — maintainability and strict typing

- Extract cohesive boundaries from the builder route and UI panel incrementally.
- Add strict TypeScript checks by module/cohort and ratchet coverage until the
  frontend's strict configuration can be enabled without suppressions.
- Keep auth behavior equivalent between runtime and tests. Update local setup
  documentation to match real prerequisites.

Acceptance: each extraction preserves contracts and passes relevant behavioral
tests plus complete CI; migrated modules pass strict checks. Do not count a
renamed monolith or disabled type error as progress.

## Phase 6 — performance and operations

- Reduce measured first-paint work and profile slower mobile devices/networks.
- Measure capacity, latency and error rates under representative load.
- Exercise monitoring, rollback and backup restoration with documented outcomes.

Acceptance: published before/after measurements, capacity limits and executed
rollback/restore evidence. Targets are set from baseline and user needs. Cloud
console access, representative devices and production-like test infrastructure
may be required; unavailable evidence is recorded as blocked, not passed.

## Release discipline

Each PR describes the concrete change and its verification. Merge only the
reviewed head after required checks pass; inspect any newer head or base changes
before merging. CI failures are investigated, never bypassed or hidden. Record
PR/check links and phase status here as the work progresses. Store binaries are
not built automatically on phase completion; follow the existing release policy.

## Phase 1 local verification checkpoint

Final Node 22.23.3/UTC suite: 2,790 files passed; 39,829 tests passed, 67 skipped,
zero failures. Frontend/server typechecks, production build/boot, production
dependency, bundle/native/import/OAuth, audit and license gates passed. The first
coverage preflight caught one missing storage-inventory entry; it was fixed and
47 related checks passed before the complete plain-suite rerun above. The first
coverage run is not a passing gate. Exact-head GitHub coverage CI passed and
PR #3847 was merged as recorded above. Detailed security evidence is in PHASE1_AUTHORIZATION_SECURITY.md
and PHASE1_DEPENDENCY_SECURITY.md.

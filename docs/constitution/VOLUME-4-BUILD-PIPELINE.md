# NavBharatAI Build Engine — Constitution

## Volume 4 — Build Pipeline Constitution

> **Status:** Binding pipeline law. Volume 3 described the architecture and drew the
> lifecycle flows; **this volume makes the pipeline constitutional** — every build
> MUST pass through defined stages, in a defined order, each with binding **entry and
> exit conditions**, **required evidence**, and **mandatory gates** that cannot be
> skipped, faked, or self-approved.
>
> **Authority:** Inherits Volumes 0–3 and may never contradict them. **Descriptive-
> first and code-anchored:** it governs the real pipeline as it runs today (with
> anchors), and marks a stage/gate **`[LIVE]`** or **`[ASPIRATIONAL]`** honestly.
>
> **Honest adaptation (per the external-suggestion rule).** The requested 35-stage
> list is an idealized template that does not know this engine. This volume maps it to
> NavBharatAI's **real** pipeline: several requested "stages" are one real stage (they
> are consolidated with facets named), and a few do not yet exist as full stages (they
> are marked `[ASPIRATIONAL]`, not invented). The goal is a pipeline that makes the
> engine stronger and error-proof — not a longer list.

---

# Part I — Pipeline Doctrine

## The five binding properties of every build

1. **Staged.** A build advances through ordered phases; no stage is skipped
   (Guarantee G1).
2. **Gated.** Between phases sit mandatory constitutional gates; a gate blocks on
   objective evidence and cannot be self-approved (Volume 1 VERIFY-01/02).
3. **Evidence-driven.** A stage's exit requires *evidence*, never confidence
   (Volume 1 TRUTH-05, VERIFY-05). "It generated" is never "it works".
4. **Bounded.** Every stage has a timeout / step / retry bound; nothing runs
   unbounded (Volume 1 ARCH-08).
5. **Recoverable.** Every stage defines its failure transition (salvage / repair /
   resume / honest stop); no failure discards work or lies (Volume 1 RECOV-*, REL-07).

## The pipeline shape (phases)

`P0 Intake → P1 Plan → P2 Generate → P3 Repair → P4 Verify → P5 Audit → P6 Decide →
P7 Ship → P8 Observe/Learn`

Each phase contains one or more stages (below). The phases form a **DAG** — control
flows forward; a gate never waits on a later phase (deadlock-free, Volume 1 ARCH-08).
The full flow is drawn in Volume 3 §42; this volume governs the *rules* of moving
through it.

## How to read a stage

```
### S<n> — <Name> · <phase> · [STATUS]
- **Purpose / Responsibilities.** ...
- **Entry.** The condition that must hold to begin.
- **Exit.** The condition (with evidence) that must hold to advance.
- **Evidence.** The concrete proof the exit requires.
- **Validation.** How the exit condition is checked (deterministic / model / gate).
- **Failure.** What counts as failure here.
- **Recovery.** The failure transition.
- **Metrics.** What is measured.
- **Audit.** What is recorded.
- **Anchor.** code → law.
```

---

# Part II — The Build Stages

## Phase P0 — Intake

### S1 — Prompt Reception · P0 · [LIVE]
- **Purpose.** Receive an authenticated request and open a build context + event
  stream.
- **Entry.** An authenticated user request arrives on the route surface.
- **Exit.** A build context exists with the raw prompt captured.
- **Evidence.** The request is recorded in diagnostics; the user is authenticated.
- **Validation.** Deterministic (auth check, context creation).
- **Failure.** Auth failure; malformed request.
- **Recovery.** Honest rejection; no partial build.
- **Metrics.** Intake success rate.
- **Audit.** Prompt hash + session recorded.
- **Anchor.** `routes/agentv3.ts`. Laws: SEC-07, LOG-01.

### S2 — Intent Analysis · P0 · [LIVE]
- **Purpose.** Classify the request: chat / edit-existing / new-build, plus language.
- **Entry.** A captured prompt.
- **Exit.** An intent classification that selects the pipeline branch.
- **Evidence.** The classification recorded; workspace existence checked.
- **Validation.** Model-assisted classification, deterministic routing.
- **Failure.** Misclassification (edit treated as rebuild).
- **Recovery.** Ambiguous → safest reading or ask; never rebuild on an edit intent.
- **Metrics.** Misroute rate.
- **Audit.** Intent recorded.
- **Anchor.** `RequestAnalyser`. Laws: PLAN-01, EDIT-03.

### S3 — Requirements Extraction + Validation · P0 · [LIVE] *(consolidates requested S3+S4)*
- **Purpose.** Extract concrete requirements + complexity, and validate they are
  coherent and buildable.
- **Entry.** A classified new-build/edit intent.
- **Exit.** A validated requirement set + a complexity score feeding tier/budget.
- **Evidence.** Complexity + required capabilities recorded.
- **Validation.** Deterministic scoring; contradictions/impossibilities flagged.
- **Failure.** Incoherent or impossible requirements.
- **Recovery.** Proceed with the safe-ambitious reading and state the assumption; a
  truly impossible ask gets an honest explanation.
- **Metrics.** Budget-adequacy vs realized complexity.
- **Audit.** Requirements + complexity recorded.
- **Anchor.** `RequestAnalyser.analyzeRequest`. Laws: PLAN-01/05, VERIFY-07.

## Phase P1 — Plan

### S4 — Planning + Architecture + Task Breakdown · P1 · [LIVE] *(consolidates requested S5+S6+S10)*
- **Purpose.** Produce one coherent plan: the file list, the shared contract
  (types/interfaces/layout), and the task order — the single design a build executes.
- **Entry.** Validated requirements + complexity + framework.
- **Exit.** A file plan + a shared contract exist; features ranked core→nice.
- **Evidence.** Plan + contract recorded; sub-agents (if any) have a contract to build
  against.
- **Validation.** Deterministic + model planning; the contract must exist before any
  sub-agent (PLAN-07).
- **Failure.** No shared contract; a per-vendor relay plan.
- **Recovery.** The plan is revisable, not sacred (PLAN-08); one coherent plan only
  (PLAN-02).
- **Metrics.** Integration-defect rate across sub-agent outputs.
- **Audit.** Plan + contract + ranking recorded.
- **Anchor.** Planning phase + `RequestAnalyser`. Laws: PLAN-02/03/07/08.

### S5 — Repository Analysis · P1 · [LIVE]
- **Purpose.** Ground the build in the true project (edit mode) or a clean scaffold
  (new).
- **Entry.** A plan + a provisioned workspace.
- **Exit.** The full, true file map is known; the scaffold is guaranteed present.
- **Evidence.** Durable-store map loaded; guardian restore run; scaffold ensured.
- **Validation.** Deterministic (full-map load, guardian reconcile).
- **Failure.** A partial/cold view; a missing scaffold.
- **Recovery.** Union reconcile; shrink-guard; `ensureScaffoldOnce`.
- **Metrics.** Grounding accuracy; data-loss events (safe-recovered).
- **Anchor.** WorkspaceMemory + File Guardian + scaffold ensure. Laws: MEM-01/05,
  EDIT-04/13.

### S6 — Dependency Resolution · P1 · [LIVE]
- **Purpose.** Ensure every package the plan implies is declared and installable.
- **Entry.** The plan + package.json.
- **Exit.** A reconciled, installable dependency set (pre-flight + at readiness).
- **Evidence.** Well-known missing deps added; conflicts flagged.
- **Validation.** Deterministic (curated allowlist; version pins).
- **Failure.** A missing/guessed/conflicting dependency.
- **Recovery.** Allowlist auto-add; never a guessed package; conflict surfaced.
- **Metrics.** Missing-dep dev-server failures (→0).
- **Anchor.** `DependencyAutoFix` + pre-flight sync. Laws: EDIT-11, VERIFY-09.

### S7 — Risk Assessment · P1 · [LIVE]/[ASPIRATIONAL]
- **Purpose.** Assess the build's risk: complexity, security surface, cost.
- **Entry.** Requirements + plan.
- **Exit.** A tier/budget + a security posture chosen; high-risk commands pre-blocked.
- **Evidence.** Tier, budget, and risk posture recorded.
- **Validation.** Deterministic (complexity score, command risk classifier).
- **Failure.** Under-provisioning; an unassessed security surface.
- **Recovery.** Adaptive budget; the security gate (S20) backstops.
- **Metrics.** Step-cap-hit rate by complexity; blocked-high-risk count.
- **Anchor.** RequestAnalyser + risk classifier. Laws: PLAN-05, SEC-04. `[ASPIRATIONAL]`
  for formal pre-build risk scoring.

### S8 — Execution Scheduling · P1 · [LIVE]
- **Purpose.** Order the work: serialize mutations, parallelize independent work, bound
  everything.
- **Entry.** A plan + a budget.
- **Exit.** A bounded, race-free execution order is set.
- **Evidence.** Timeouts/step-caps/concurrency configured.
- **Validation.** Deterministic (scheduler config).
- **Failure.** An unbounded or racy schedule.
- **Recovery.** Serialized mutations; single-flight checkpoints.
- **Metrics.** Wall-clock efficiency.
- **Anchor.** dispatch loop + checkpoint scheduler. Laws: PERF-08/09, ARCH-08.

## Phase P2 — Generate

### S9 — Code Generation · P2 · [LIVE]
- **Purpose.** Produce real, working source via the cascade (fast-lane → salvage →
  full builder → sub-agents).
- **Entry.** A plan + contract + workspace + budget.
- **Exit.** Real source files exist for the planned scope.
- **Evidence.** Files written to the workspace + durable store; provider per turn
  attributed.
- **Validation.** Downstream gates (P4+) validate; generation alone is not success.
- **Failure.** A stub; a fast-lane timeout; a zombie stage; a truncated write.
- **Recovery.** Salvage handoff (never restart); zombie-kill; truncated-write rewrite.
- **Metrics.** First-pass gate-pass rate; stub rate (0).
- **Anchor.** SimpleBuilder → salvage → AgentRunner → SubAgent. Laws: TRUTH-04,
  RECOV-01/02/03, EDIT-09.

### S10 — Semantic Editing · P2 · [LIVE]
- **Purpose.** Apply edits that keep the project resolvable and never corrupt it.
- **Entry.** A target file + a change.
- **Exit.** The project still resolves after the edit.
- **Evidence.** Imports/exports reconciled; no dangling import; change recorded.
- **Validation.** Deterministic import fixers; stale-match fails loudly.
- **Failure.** A dangling import; a blank overwrite; a silent no-op edit.
- **Recovery.** Deterministic fixers; blank-overwrite refused; loud stale-match error.
- **Metrics.** Post-edit resolution rate.
- **Anchor.** ToolDispatcher edit path + fixers. Laws: EDIT-01/06/07/08/10/12.

## Phase P3 — Repair (deterministic-first)

### S11 — Deterministic Endgame Repair · P3 · [LIVE]
- **Purpose.** Fix mechanically-fixable defects before spending any model repair.
- **Entry.** Generation complete but verification not yet earned.
- **Exit.** All deterministically-fixable errors fixed; remainder handed to a single
  bounded model repair; readiness re-earned.
- **Evidence.** tsc/import/dep fixes applied; re-verification run.
- **Validation.** Deterministic layer first, then ONE bounded model pass, then
  re-verify (Volume 1 RECOV-05).
- **Failure.** An unbounded repair loop; a blank-overwrite repair.
- **Recovery.** Bounded to one model pass; blank-overwrite guarded; re-verify after.
- **Metrics.** Deterministic-fix ratio; repair-pass count (≤1).
- **Anchor.** `EndgameRepair` + AgentRunner. Laws: RECOV-05, PERF-11, VERIFY-14.

## Phase P4 — Verify (the evidence gates — none self-approved)

### S12 — Compilation · P4 · [LIVE]
- **Purpose.** Confirm the project type-checks — necessary, never sufficient.
- **Entry.** Source generated + repaired.
- **Exit.** Clean typecheck (a single-file probe never becomes a build's rootCause;
  test-only tsc failures never fail a working app).
- **Evidence.** Incremental tsc result.
- **Validation.** Deterministic (tsc).
- **Failure.** A real type error; a false type verdict.
- **Recovery.** → endgame fixers; re-verify.
- **Metrics.** Post-build type-error rate; false-verdict count (0).
- **Anchor.** incremental tsc. Laws: TRUTH-02, VERIFY-13.

### S13 — Static Analysis · P4 · [LIVE]
- **Purpose.** Catch structural defects deterministically before any model review.
- **Entry.** Compilation attempted.
- **Exit.** No unresolved structural defect (hooks, imports, JSX, dep conflict) over
  the full durable map.
- **Evidence.** Analyzer findings + deterministic fixes.
- **Validation.** Deterministic, over the full map (VERIFY-10).
- **Failure.** A structural defect reaching runtime.
- **Recovery.** Auto-fix or escalate to readiness/reviewer.
- **Metrics.** Runtime crashes from missed structural defects (→0).
- **Anchor.** analyzers. Laws: VERIFY-09/10.

### S14 — Repository Validation · P4 · [LIVE]
- **Purpose.** Confirm structural integrity (no orphan/duplicate stylesheet, no mixed
  specifiers, no duplicate-purpose entry) over the full map.
- **Entry.** Static analysis run.
- **Exit.** No integrity violation, or each auto-fixed/honestly recorded.
- **Evidence.** Integrity findings + fixes.
- **Validation.** Deterministic (ProjectIntegrityChecks).
- **Failure.** A silent integrity defect.
- **Recovery.** Deterministic auto-fix (CSS wire, specifier normalize) or honest
  finding.
- **Metrics.** Integrity-defect escape rate.
- **Anchor.** `ProjectIntegrityChecks`. Laws: QA-07/12, VERIFY-10. *(duplicate-purpose
  file check `[ASPIRATIONAL]`.)*

### S15 — Runtime Verification · P4 · [LIVE]
- **Purpose.** Confirm the app actually runs — the authoritative readiness verdict.
- **Entry.** Compilation + static + integrity attempted.
- **Exit.** A ready verdict backed by observed behavior (in-process parse + preview
  render + readiness scan).
- **Evidence.** In-process esbuild parse pass; preview publishes; readiness score.
- **Validation.** Deterministic parse (immune to sandbox tooling failure) + observed
  render (Volume 1 VERIFY-06).
- **Failure.** A broken app passed; a working app failed; an un-run check assumed pass.
- **Recovery.** Un-run → reported unverified; not-ready → repair + re-verify or honest
  fail.
- **Metrics.** False-ready rate (0); false-fail rate (0).
- **Anchor.** readiness gate + SyntaxCheck + preview verify. Laws: TRUTH-01,
  VERIFY-01/06/13.

### S16 — UI Verification · P4 · [LIVE]/[ASPIRATIONAL]
- **Purpose.** Confirm requested UI features are present (on the rendered app) and the
  app is styled with resolving design tokens.
- **Entry.** The app renders.
- **Exit.** Requested UI present + tokens resolve + styled.
- **Evidence.** Feature-presence on the rendered DOM; token render check.
- **Validation.** Model + deterministic, judged on the rendered app, never a shell
  (VERIFY-08).
- **Failure.** A missing UI feature or broken-token/unstyled render.
- **Recovery.** Auto-fix (CSS wire, token inject) or honest finding.
- **Metrics.** Requested-UI presence rate; token-failure rate (→0).
- **Anchor.** FeaturePresence + ReactPreview tokens. Laws: VERIFY-07/08, QA-05/06.
  `[ASPIRATIONAL]` for visual-diff.

### S17 — API Verification · P4 · [ASPIRATIONAL]
- **Purpose.** Exercise a full-stack app's real API endpoints and assert responses.
- **Entry.** A running backend + a route contract.
- **Exit.** Endpoints respond per contract.
- **Evidence.** (To build) real request/response assertions on the live-server path.
- **Validation.** Runtime, on the real server.
- **Failure.** A broken endpoint ships.
- **Recovery.** → repair.
- **Metrics.** API-defect escape rate.
- **Anchor.** Open — ties to full-stack layout-contract work. Laws: TRUTH-04, VERIFY-05.

### S18 — Database Verification · P4 · [LIVE]/[ASPIRATIONAL]
- **Purpose.** Confirm the data layer is valid and runnable (schema generates,
  seed/migrate run).
- **Entry.** A schema + data commands.
- **Exit.** Schema generates; seed/migrate succeed.
- **Evidence.** generate/seed exit 0 (with the prisma-format self-heal on the
  documented failure).
- **Validation.** Runtime (real commands) + deterministic self-heal.
- **Failure.** A broken data layer ships; a blind retry.
- **Recovery.** prisma-format + one retry on the documented failure; else honest error.
- **Metrics.** Schema-generate/seed success rate.
- **Anchor.** prisma-heal + SQLite-enum guard. Laws: RECOV-08, EDIT-11. `[ASPIRATIONAL]`
  for broad DB-runtime assertion.

### S19 — Performance Verification · P4 · [ASPIRATIONAL]
- **Purpose.** Flag app-level performance smells (bundle bloat, obvious anti-patterns).
- **Entry.** A built app.
- **Exit.** No serious performance defect (advisory unless promoted).
- **Evidence.** (To build) bundle/pattern analysis.
- **Validation.** Deterministic analysis; advisory by default (never blocks a working
  app on style, QA-03).
- **Failure.** A severe perf defect unflagged.
- **Recovery.** Warning findings.
- **Metrics.** Perf-finding coverage.
- **Anchor.** Open item. Laws: QA-03. *(Engine-side performance is governed by
  PERF-01..12; this stage is the APP-side counterpart.)*

### S20 — Security Verification · P4 · [LIVE]
- **Purpose.** Confirm no secret leak, no destructive action, no hardcoded credential
  in the delivered app.
- **Entry.** The build's outputs + commands.
- **Exit.** No secret on any surface; no destructive action ran; no hardcoded secret
  in generated source.
- **Evidence.** Redaction applied; high-risk blocked; source scanned for secrets.
- **Validation.** Deterministic (redaction + risk classifier), at the choke point.
- **Failure.** A leak or a destructive action.
- **Recovery.** Prevention — refused before it runs.
- **Metrics.** Secret-leak count (0).
- **Anchor.** redaction + risk classifier + destructive-delete block. Laws: SEC-01..14.

### S21 — Accessibility Verification · P4 · [ASPIRATIONAL]
- **Purpose.** Confirm baseline a11y (semantics, labels, contrast, keyboard).
- **Entry.** A rendered app.
- **Exit.** Baseline a11y met (advisory unless promoted).
- **Evidence.** (To build) a11y analysis on the rendered DOM.
- **Validation.** Deterministic; advisory (never blocks a working app on cosmetics).
- **Failure.** A seriously inaccessible app unflagged.
- **Recovery.** Warning findings.
- **Metrics.** A11y-finding coverage.
- **Anchor.** Open item. Laws: QA-03, VERIFY-07.

## Phase P5 — Audit

### S22 — Acceptance Testing · P5 · [LIVE]/[ASPIRATIONAL]
- **Purpose.** Confirm the app does what the user asked, by exercising it (the app's
  own tests as a detector; red-team/fuzz).
- **Entry.** A verified app + the requirements.
- **Exit.** Requirements satisfied under executed tests.
- **Evidence.** Vaccine test results; red-team findings.
- **Validation.** Runtime (executed tests), not source inspection.
- **Failure.** A functional gap surviving to the user.
- **Recovery.** → repair; unrepairable → honest finding.
- **Metrics.** Requirement-satisfaction rate under test.
- **Anchor.** immune vaccine + red-team. Laws: TEST-07, QA-11, VERIFY-07.
  `[ASPIRATIONAL]` for full user-journey acceptance.

### S23 — QA Review · P5 · [LIVE]
- **Purpose.** A bounded, independent model review that critiques and repairs
  authorized defect classes, honestly.
- **Entry.** All P4 gates + acceptance run.
- **Exit.** No unrepaired critical defect; the honest summary preserved.
- **Evidence.** Reviewer findings + bounded repairs.
- **Validation.** Model reviewer (mode-aware judge), separate from the builder
  (VERIFY-02).
- **Failure.** A real defect passed; a working app blocked on style; the summary
  overwritten.
- **Recovery.** One bounded repair pass; heal never fails a working build.
- **Metrics.** Defect escape rate; false-block rate.
- **Anchor.** C9 reviewer. Laws: QA-01/03/04/08/09, VERIFY-02.

## Phase P6 — Decide

### S24 — Production Readiness Assessment · P6 · [LIVE]
- **Purpose.** The single go/no-go: aggregate all gate verdicts into one honest
  production-ready decision.
- **Entry.** All P4–P5 verdicts.
- **Exit.** A ready verdict (verified + reversible + observable + non-regressive) OR an
  honest not-ready.
- **Evidence.** The aggregate readiness verdict + basis.
- **Validation.** Deterministic aggregation; ready only if verified against reality
  (§45).
- **Failure.** An unready app declared ready.
- **Recovery.** Not-ready → escalation or honest failure to the user; never delivered.
- **Metrics.** Post-delivery failure rate.
- **Anchor.** readiness final verdict. Laws: §45, TRUTH-03, VERIFY-01. **This is the
  hard delivery barrier.**

## Phase P7 — Ship

### S25 — Deployment Preparation · P7 · [LIVE]
- **Purpose.** Prepare the change for production via the one disciplined path.
- **Entry.** (Engine change) a ready branch; (user app) a ready build.
- **Exit.** A PR opened (engine) / the build persisted to the user's GitHub archive.
- **Evidence.** PR created; verification gate green locally before push.
- **Validation.** Deterministic (gate-before-push).
- **Failure.** An unverified push.
- **Recovery.** Gate before push; fix and re-push.
- **Metrics.** Local-gate-vs-CI agreement.
- **Anchor.** repo flow + GitHub storage. Laws: REPO-02/13, DEPLOY-07.

### S26 — Release Approval · P7 · [LIVE] (human-bounded)
- **Purpose.** Approve release only on green CI; the release decision is a
  human/session act, never an autonomous unbounded one.
- **Entry.** A PR with CI results.
- **Exit.** CI green confirmed → approved to merge; red → refused.
- **Evidence.** The CI-green check on the branch.
- **Validation.** Deterministic (CI status).
- **Failure.** Approving a red or unverified PR.
- **Recovery.** Never approve red; diagnose, fix, re-push, re-check.
- **Metrics.** Red-approval count (0).
- **Anchor.** CI gate. Laws: REPO-03, DEPLOY-02. **Human/admin authority governs any
  dangerous/irreversible release (ETHIC-03).**

### S27 — Deployment · P7 · [LIVE]
- **Purpose.** Ship the approved change (engine: merge → Cloud Run auto-deploy; user
  app: archived to GitHub).
- **Entry.** An approved (CI-green) merge.
- **Exit.** The merge lands; the auto-deploy is triggered.
- **Evidence.** The merge commit; the deploy pipeline run.
- **Validation.** Deterministic (merge = the only trigger).
- **Failure.** A red/side-channel deploy; a webhook miss.
- **Recovery.** Rollback via revert/redeploy; flags disable without a deploy; documented
  manual trigger only for a genuine webhook miss.
- **Metrics.** Deploy success; rollback readiness.
- **Anchor.** merge → cloudbuild. Laws: DEPLOY-01/03/04/14.

### S28 — Post-Deployment Verification · P7 · [LIVE]/[ASPIRATIONAL]
- **Purpose.** Confirm the deploy is genuinely live and healthy, not just merged.
- **Entry.** A triggered deploy.
- **Exit.** The new revision is serving; the live site is healthy.
- **Evidence.** Deploy completion; (aspirational) an automated live health check.
- **Validation.** Deploy-timing honesty (merged ≠ instantly live); today largely
  admin-observed.
- **Failure.** A broken deploy left live.
- **Recovery.** Restoring the live site takes priority over all other work (DEPLOY-12).
- **Metrics.** Time-to-healthy; broken-deploy count.
- **Anchor.** Cloud Run + honest timing. Laws: DEPLOY-10/12. `[ASPIRATIONAL]` for an
  automated post-deploy health gate.

## Phase P8 — Observe / Learn

### S29 — Observability Validation · P8 · [LIVE]
- **Purpose.** Confirm the build left a complete, honest forensic record at two tiers.
- **Entry.** A finished build.
- **Exit.** A reconstructable diagnostics report exists (admin-detailed,
  user-anonymized).
- **Evidence.** The diagnostics report + telemetry.
- **Validation.** Deterministic (report completeness).
- **Failure.** A blind spot; a misattribution; a user-facing vendor leak.
- **Recovery.** Fail-open recording; attribution fixes.
- **Metrics.** Report completeness; attribution accuracy.
- **Anchor.** BuildDiagnostics + DiagnosticsStore. Laws: LOG-01..10, PROV-13.

### S30 — Incident Detection · P8 · [LIVE]
- **Purpose.** Detect real post-ship signals (CI failures, PR review events, broken
  deploy) and route them to recovery.
- **Entry.** A subscribed PR / a monitored signal.
- **Exit.** Each event investigated + classified (actionable / duplicate / needs-admin).
- **Evidence.** The event + its investigation.
- **Validation.** Model + deterministic triage.
- **Failure.** A stuck or ignored incident on a subscribed PR.
- **Recovery.** Fix + re-push; ambiguous → ask admin; never silently abandon.
- **Metrics.** Time-to-detect; unresolved-incident count.
- **Anchor.** PR-activity handling. Laws: REPO-03, REL-05.

### S31 — Recovery · P8 · [LIVE]
- **Purpose.** On any failure at any stage, preserve work, converge to a correct state,
  keep the never-break promise.
- **Entry.** A failure signal from any stage.
- **Exit.** Work preserved + state converged, OR an honest safe stop + open-root record.
- **Evidence.** Salvage/restore/resume/heal applied; re-verification run.
- **Validation.** Idempotent recovery; honest messaging.
- **Failure.** Lost work; a corrupted/doubled recovery.
- **Recovery.** *It is* recovery — all idempotent (RECOV-09/12).
- **Metrics.** Data-loss events (safe-recovered); double-charge count (0).
- **Anchor.** salvage + guardian + step-resume + endgame + prisma-heal. Laws:
  RECOV-01..13, REL-03/12.

### S32 — Learning Capture · P8 · [LIVE]
- **Purpose.** Turn every real report into a five-bucket forensic autopsy and a
  root-cause, engine-wide fix.
- **Entry.** A real build/diagnostics report.
- **Exit.** Every flaw classified; the class fixed (or open-root recorded); siblings
  hunted; tests locked.
- **Evidence.** The ledger + the merged fixes + regression tests.
- **Validation.** The autopsy discipline (whole report, honest counts).
- **Failure.** A skimmed report; a one-app patch; a workaround as a win.
- **Recovery.** The discipline itself.
- **Metrics.** Recurrence rate (→0).
- **Anchor.** the fifth absolute rule. Laws: LEARN-01..12.

### S33 — Knowledge Update · P8 · [LIVE]
- **Purpose.** Synchronize every lesson and new capability into durable knowledge so
  the next session inherits it.
- **Entry.** A learning or a new user-facing capability.
- **Exit.** The lesson recorded (law/PROGRESS/guard/test); the capability registered in
  the knowledge base.
- **Evidence.** The durable record + the knowledge-base entry.
- **Validation.** Deterministic (sync rule).
- **Failure.** An unrecorded lesson; an unregistered feature.
- **Recovery.** The sync rule: record in the same change.
- **Metrics.** Knowledge-base coverage; lessons-recorded rate.
- **Anchor.** AppKnowledgeBase + PROGRESS + this library. Laws: LEARN-09, QA-13, DOC-07.

---

# Part III — The Constitutional Gates (mandatory barriers)

A **gate** sits between phases; it blocks advance until its exit evidence exists, and
**no gate can be self-approved** (Volume 1 VERIFY-02). Each is `[LIVE]` unless noted.

| Gate | Blocks advance past | Passes only when | Anchor / Law |
|---|---|---|---|
| **Planning Gate** | P1 | a coherent plan + shared contract exist | PLAN-02/07 |
| **Repository Gate** | P1 | the true full map is loaded + scaffold ensured | MEM-01, EDIT-13 |
| **Dependency Gate** | P1/P4 | every implied package is declared/installable | EDIT-11 |
| **Compilation Gate** | P4 | typecheck clean (necessary, not sufficient) | TRUTH-02 |
| **Static/Integrity Gate** | P4 | no unresolved structural/integrity defect | VERIFY-09/10 |
| **Runtime Gate** | P4 | the app parses + renders (observed) | TRUTH-01, VERIFY-01/06 |
| **Security Gate** | P4 | no secret/leak/destructive action/hardcoded secret | SEC-01..14 |
| **QA Gate** | P5 | no unrepaired critical; honest summary intact | QA-01/04, VERIFY-02 |
| **Production Readiness Gate** | P6 | verified + reversible + observable + non-regressive | §45, TRUTH-03 |
| **Deployment Gate (CI)** | P7 | CI green on the branch | REPO-03, DEPLOY-02 |
| **Release Gate** | P7 | approved on green + (dangerous → admin) | DEPLOY-01, ETHIC-03 |
| **API / DB / Perf / A11y Gates** | P4 | *(partial/aspirational — see S17–S21)* | — |

**The two hard barriers** (a build/deploy cannot pass without them): the **Production
Readiness Gate** (no delivery without verification) and the **Deployment Gate** (no
production without CI-green).

---

# Part IV — Pipeline Rules

- **Mandatory stages (never skipped):** Intake (S1–S3), Planning (S4–S5), Generation
  (S9), Runtime Verification (S15), Security Verification (S20), Production Readiness
  (S24). For an engine change: the Deployment Gate (S26). A build that cannot pass a
  mandatory stage fails honestly — it does not skip it (Guarantee G1).
- **Parallel-eligible:** the P4 verification checks (S12–S21) and P5 audit run as
  findings allow — *deterministic first* (VERIFY-09) — then converge. Independent reads
  run parallel; **mutations run serially and first** (PERF-08).
- **Blocking stages:** every gate blocks its phase boundary; **S24 (Readiness)** blocks
  delivery; **S26 (CI)** blocks deployment.
- **Human-approval stages:** S26 Release (dangerous/irreversible releases) and any
  destructive/irreversible/policy fork (ETHIC-03). Ordinary reversible advance is
  autonomous (ETHIC-04).
- **Runtime-evidence-required stages:** S15 Runtime, S16 UI, S17 API, S18 DB, S22
  Acceptance, S28 Post-Deploy — these require *observed behavior*, not source
  inspection (VERIFY-05).
- **Deterministic-validation-required stages:** S6 Dependency, S11 Repair (det. layer),
  S12 Compilation, S13/S14 Static/Integrity, S20 Security, S26 CI.
- **Retry policy + limits:** transient provider failures fall through the chain and
  bench on repeated saturation (per-key rotate / service pool-bench), auto-recovering
  after cooldown; a **deterministic failure is never blindly retried** (PERF-02); a
  documented tool failure self-heals **once** then reports honestly (RECOV-08); model
  repair is bounded to **one** batch pass (RECOV-05); a step-cap resumes with a
  **bounded** extension (RECOV-04), not infinite.
- **Rollback strategy:** engine — revert the merge / redeploy known-good / disable via
  flag without a deploy (DEPLOY-04); build — salvage + guardian restore return to the
  last good state; billing — idempotent, so a rollback never double-charges.
- **Failure propagation:** a stage failure propagates to its recovery transition, not
  onward as success; a gate failure **fails closed** (never passes); a diagnostics
  failure **fails open** (never breaks the build) (ARCH-10).
- **Cancellation policy:** a cancelled/lapsed stage is *truly* stopped — no zombie turn
  keeps spending (RECOV-03); work already produced is salvaged, never discarded.
- **Timeout policy:** every stage, turn, tool, and build is bounded; a timeout **stops
  honestly and preserves work** (REL-07), never hangs.
- **Pipeline restart policy:** a build never silently restarts from zero; it *resumes*
  from salvaged/durable state (RECOV-02, REPO-07). A full rebuild happens only on
  explicit, consent-gated user approval (EDIT-03).

---

# Part V — The Pipeline Guarantees (and how each is enforced)

Each guarantee is a promise the pipeline structurally keeps, mapped to its mechanism +
law:

- **G1 — No skipped stages.** Mandatory stages fail honestly rather than being skipped;
  the lifecycle is a fixed DAG. *(ARCH-08; Part IV mandatory list.)*
- **G2 — No false success.** Success requires observed evidence; the Readiness Gate
  downgrades any unverified claim. *(TRUTH-01/03, VERIFY-01.)*
- **G3 — No silent failures.** Every failure leaves actionable evidence and surfaces;
  best-effort catches still record. *(REL-02, TRUTH-12, LOG-07.)*
- **G4 — No deployment without verification.** The Readiness Gate (S24) then the CI
  Gate (S26) both precede any deploy. *(§45, REPO-03, DEPLOY-02.)*
- **G5 — No release without QA approval.** The QA Gate (S23) precedes readiness; a
  critical defect blocks. *(QA-01/04.)*
- **G6 — No runtime failure ignored.** Runtime/UI/DB verification require observed
  behavior; a console error or failed render is a blocker, not a footnote. *(VERIFY-05,
  TRUTH-01.)*
- **G7 — No missing requested feature.** Feature-presence is verified on the rendered
  app; a missing requested feature is a build failure. *(VERIFY-07/08.)*
- **G8 — No evidence-free approval.** No gate approves on confidence; every approval
  carries its evidence, and no stage approves its own output. *(TRUTH-05, VERIFY-02.)*

Where a guarantee currently relies on an `[ASPIRATIONAL]` stage (API/DB-runtime/a11y/
post-deploy health), that gap is named honestly and its closure is mandated work — the
guarantee is never claimed stronger than the mechanism that backs it (Volume 1
DOC-04/05, TRUTH-03).

---

# Closing

This is the constitutional pipeline every NavBharatAI build must obey: **staged, gated,
evidence-driven, bounded, recoverable.** Its strength is not the number of stages but
the two hard barriers no build may cross without earning them — **verified before
delivered, CI-green before deployed** — and the guarantees those barriers make
structural: no skipped stage, no false success, no silent failure, no unverified
deploy, no missing requested feature, no evidence-free approval.

Where a stage or gate is `[ASPIRATIONAL]`, the pipeline is honest that the guarantee it
would strengthen is not yet fully machine-enforced; closing that gap is mandated work
under the Learning and Continuous-Improvement stages, tracked until `[LIVE]`.

Every future build follows this pipeline; every later volume inherits it. When a stage
decision is unclear, resolve by the gates and the Decision Hierarchy; when a release is
genuinely dangerous, the human admin approves; and in every tie, the Prime Law
governs — **truth is the product, trust is the treasure.**

---

*Volume 4 of the NavBharatAI Build Engine Constitution. Descriptive-first and
code-anchored; inherits Volumes 0–3; amendments follow the engine's own discipline
(branch → PR → CI green → merge).*

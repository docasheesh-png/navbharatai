# NavBharatAI Build Engine — Constitution

## Volume 5 — Requirements & Planning Constitution

> **Status:** Binding planning law. Governs how NavBharatAI converts natural language
> into an engineering-grade plan **before** code is written. Inherits Volumes 0–4;
> may never contradict them. **Descriptive-first, code-anchored**, with honest
> `[LIVE]`/`[ASPIRATIONAL]` tags.
>
> **Honest adaptation (external-suggestion rule).** The requested spec contains one
> line that, taken literally, would make the engine *worse* — *"Assumptions are
> forbidden."* — while the same spec also demands *"proceed autonomously when
> sufficient evidence exists."* These conflict. This volume resolves the conflict the
> way a world-best AI builder actually must (Vol 0 §2, ETHIC-04): **safe, reasonable,
> best-for-the-user assumptions are not forbidden — they are required for speed;**
> only *unsafe or consequential* silent assumptions are forbidden. NavBharatAI does
> **lightweight intent-understanding + smart defaults + a strong verification safety
> net**, not heavy waterfall requirements interrogation — because the interrogation
> model is slower and loses to fast-iterating competitors. The chapters below are
> adapted to that real model.

---

# Part I — The Requirements Doctrine

## The core principle, correctly stated

> **No code until the system understands *enough* to build the RIGHT thing — and no
> *consequential* ambiguity ever passes silently into implementation.**

"Enough" — not "everything." Demanding total requirement capture before a single line
would make a simple app slow and a demanding one interrogate the user to death. The
engine understands enough, assumes safely for the rest, builds fast, and lets the
verification net (feature-presence, acceptance) catch what light planning missed —
cheaply, after the build, not by pre-interrogation.

## The five binding rules of understanding

1. **Understand intent first.** Classify what the user actually wants (chat / edit /
   new-build; the app's purpose and core features) before planning. *(LIVE:
   RequestAnalyser.)*
2. **Assume safely, never dangerously.** A reasonable, reversible, best-for-the-user
   default is made and *stated*; an assumption that is unsafe, irreversible, spends
   money, or changes what the user fundamentally gets is **not** assumed — it is
   surfaced. *(LIVE: the 60-second auto-answer rule; ETHIC-04.)*
3. **Ask only on the genuinely-blocking fork.** A clarification is asked only when the
   choice is consequential AND cannot be safely defaulted; ordinary ambiguity is
   resolved by proceeding with the best default. *(LIVE.)*
4. **Detect the consequential gaps.** Missing *core* features, direct contradictions,
   and impossible asks must be detected — the rest is handled by safe defaults + the
   verification net. *(LIVE for missing-feature via feature-presence; `[ASPIRATIONAL]`
   for formal contradiction/impossibility detection.)*
5. **Plan is mandatory; heaviness is proportional.** Every build has a plan (file
   list + shared contract); the plan's depth scales with complexity — light for a
   simple app, deep for a full-stack one. *(LIVE.)*

## Why light planning + strong verification beats waterfall

Heavy upfront requirements engineering front-loads cost on *every* build, most of
which are simple, and still cannot foresee the runtime defects that only a running app
reveals. NavBharatAI instead spends its rigor where evidence is real: a lightweight
plan gets to a running app fast, and the **feature-presence check + acceptance tests
verify against the rendered app** what the user actually asked for. Rigor moves from
*prediction* (guessing all requirements) to *evidence* (checking the real result) —
the Verification Philosophy (Vol 0 §9) applied to requirements.

## How to read a chapter

```
### C<n> — <Name> · [STATUS]
- **Purpose / Responsibilities.** ...
- **Inputs → Outputs.** ...
- **Decision process.** how the call is made (deterministic / model / default).
- **Evidence + Validation.** what proves it, how it is checked.
- **Failure → Recovery.** what counts as failure, the transition.
- **Success / KPIs.** the measure.
- **Audit.** what is recorded.
- **Anchor.** code → law.
```

---

# Part II — The 25 Chapters

## Understanding (C1–C11)

### C1 — User Intent Interpretation · [LIVE]
- **Purpose.** Determine what the user actually wants: chat vs edit vs new-build,
  language, and the app's core purpose.
- **Inputs → Outputs.** The prompt (+ workspace state) → a classified intent that
  selects the pipeline.
- **Decision process.** Model classification + deterministic routing.
- **Evidence + Validation.** Intent recorded; edit-vs-new checked against workspace
  existence.
- **Failure → Recovery.** Misroute → safest reading; never rebuild on an edit intent.
- **Success / KPIs.** Misroute rate → 0.
- **Audit.** Intent in diagnostics.
- **Anchor.** `RequestAnalyser`. Laws: PLAN-01, EDIT-03.

### C2 — Requirement Discovery · [LIVE]/[ASPIRATIONAL]
- **Purpose.** Surface the explicit requirements stated and the implicit ones a
  reasonable builder infers.
- **Inputs → Outputs.** The intent + prompt → a requirement set (explicit + safely
  inferred).
- **Decision process.** Model extraction + safe inference; inferred items are defaults,
  not facts.
- **Evidence + Validation.** Requirements recorded; core features named.
- **Failure → Recovery.** A missed *core* requirement → caught post-build by
  feature-presence and repaired.
- **Success / KPIs.** Requested-feature presence rate.
- **Audit.** Requirement set recorded.
- **Anchor.** RequestAnalyser + FeaturePresence net. Laws: VERIFY-07. `[ASPIRATIONAL]`
  for a formal discovery pass.

### C3 — Requirement Classification · [LIVE] *(covers requested C12–C16: functional,
non-functional, UX, technical/platform constraints)*
- **Purpose.** Classify requirements by type: functional, non-functional (perf/
  security/scale), UX, and technical/platform constraints.
- **Inputs → Outputs.** The requirement set → typed requirements + a target
  framework/platform.
- **Decision process.** Model + deterministic framework/platform detection.
- **Evidence + Validation.** Framework locked; platform constraints (web/native)
  applied.
- **Failure → Recovery.** A mis-typed constraint → the relevant gate (security, perf,
  UI) backstops.
- **Success / KPIs.** Constraint-honoring rate.
- **Audit.** Types + framework recorded.
- **Anchor.** RequestAnalyser + framework detect. Laws: PLAN-01, SEC-06, QA-06.

### C4 — Requirement Prioritization · [LIVE]/[ASPIRATIONAL]
- **Purpose.** Rank requirements core → important → nice-to-have so the core survives
  under pressure.
- **Inputs → Outputs.** Typed requirements → a ranked set + a degradation order.
- **Decision process.** Model ranking; core is never droppable.
- **Evidence + Validation.** Ranking recorded; a core feature is never dropped
  silently.
- **Failure → Recovery.** Budget pressure → drop nice-to-haves, announce; deliver the
  working core.
- **Success / KPIs.** Core-delivery rate; silent-drop count (0).
- **Audit.** Ranking recorded.
- **Anchor.** RequestAnalyser scoping. Laws: PLAN-03, TRUTH-09. `[ASPIRATIONAL]` for
  full explicit ranking.

### C5 — Requirement Validation · [LIVE]/[ASPIRATIONAL] *(covers requested C5–C7:
validation, completeness, consistency)*
- **Purpose.** Check the requirement set is buildable — complete enough for the core,
  internally consistent, not self-defeating.
- **Inputs → Outputs.** The ranked set → a validated set (or a surfaced blocker).
- **Decision process.** Model reasoning + deterministic complexity/feasibility scoring.
- **Evidence + Validation.** Complexity scored; core completeness checked.
- **Failure → Recovery.** An incomplete *core* → proceed with a safe default and state
  it; a truly infeasible ask → honest explanation.
- **Success / KPIs.** Post-build core-satisfaction rate.
- **Audit.** Validation result recorded.
- **Anchor.** RequestAnalyser + feature-presence. Laws: VERIFY-07, PLAN-05.
  `[ASPIRATIONAL]` for a formal completeness/consistency validator.

### C6 — Conflict Detection · [ASPIRATIONAL]
- **Purpose.** Detect two user requests that directly contradict each other.
- **Inputs → Outputs.** The requirement set → conflict findings (or none).
- **Decision process.** Model reasoning over the requirement set.
- **Evidence + Validation.** (To build) a formal contradiction check.
- **Failure → Recovery.** An undetected conflict → the later request generally wins;
  a *consequential* conflict → surface to the user.
- **Success / KPIs.** Conflict-detection coverage.
- **Audit.** Conflicts recorded.
- **Anchor.** Open item. Laws: PLAN-12, ETHIC-03. **A real gap — formalizing this
  improves the engine.**

### C7 — Ambiguity Detection · [LIVE]/[ASPIRATIONAL]
- **Purpose.** Recognize ambiguity and route it correctly: safe-default it, or (if
  consequential) ask.
- **Inputs → Outputs.** The requirement set → resolved defaults + (rarely) a
  clarification.
- **Decision process.** The 60-second rule: consequential + un-defaultable → ask;
  else default and state.
- **Evidence + Validation.** Assumptions stated; asks reserved for the blocking fork.
- **Failure → Recovery.** A dangerous ambiguity slipping through → the safety net /
  admin stop.
- **Success / KPIs.** Clarification rate (low); dangerous-silent-assumption count (0).
- **Audit.** Assumptions + asks recorded.
- **Anchor.** the auto-answer rule. Laws: ETHIC-03/04. `[ASPIRATIONAL]` for formal
  ambiguity scoring.

### C8 — Missing Requirement Discovery · [LIVE]
- **Purpose.** Detect a requested feature that did not make it into the delivered app.
- **Inputs → Outputs.** The requirement set + the rendered app → missing-feature
  findings + auto-fix.
- **Decision process.** Feature-presence check on the rendered DOM (never a shell).
- **Evidence + Validation.** Presence judged on the real render (VERIFY-08).
- **Failure → Recovery.** Missing → auto-fix or honest finding.
- **Success / KPIs.** Requested-feature presence rate.
- **Audit.** Findings recorded.
- **Anchor.** `FeaturePresence`. Laws: VERIFY-07/08. **This is our real "missing
  requirement" mechanism — post-build, evidence-based.**

### C9 — Impossible-Requirement Detection · [LIVE]/[ASPIRATIONAL]
- **Purpose.** Recognize an ask that cannot be built (missing infra, contradictory
  physics, unavailable service) and be honest instead of faking it.
- **Inputs → Outputs.** The requirement set → an honest not-available state for the
  impossible part.
- **Decision process.** Model reasoning + known-infra checks.
- **Evidence + Validation.** An honest not-available state (never a fake result).
- **Failure → Recovery.** An undetected impossibility → surfaces at a gate as an
  honest failure, never a fake success.
- **Success / KPIs.** Fake-result count (0).
- **Anchor.** honest not-available states. Laws: TRUTH-08. `[ASPIRATIONAL]` for a
  formal feasibility pre-check.

### C10 — Business-Rule Identification · [LIVE]/[ASPIRATIONAL]
- **Purpose.** Extract the domain/business rules implied by the request (e.g. "only
  owner can delete", "stock < 5 is low").
- **Inputs → Outputs.** The prompt → identified rules feeding the plan + acceptance.
- **Decision process.** Model extraction.
- **Evidence + Validation.** Rules reflected in the plan; verified by feature-presence/
  acceptance.
- **Failure → Recovery.** A missed rule → caught by acceptance tests or user iteration.
- **Success / KPIs.** Rule-satisfaction rate under test.
- **Anchor.** planning + acceptance. Laws: VERIFY-07, TEST-07. `[ASPIRATIONAL]` for
  explicit rule extraction.

### C11 — Facts vs Assumptions Separation · [LIVE]
- **Purpose.** Keep what the user *stated* distinct from what the engine *inferred*, so
  an inference is never treated as a fact.
- **Inputs → Outputs.** The requirement set → labelled facts vs safe assumptions.
- **Decision process.** Inference is a stated default, revisable on user correction.
- **Evidence + Validation.** Assumptions surfaced in one line so the user can correct.
- **Failure → Recovery.** An assumption treated as fact → corrected on user feedback.
- **Success / KPIs.** Assumption-correction friction (low).
- **Anchor.** auto-answer "state the assumption". Laws: ETHIC-04, TRUTH-05.

## Planning (C12–C25)

### C12 — Architecture Planning · [LIVE] *(requested C17)*
- **Purpose.** Design the app's shape — the shared contract (types/interfaces/layout)
  all builders build against — coherently, once.
- **Inputs → Outputs.** Validated requirements + framework → a file plan + shared
  contract.
- **Decision process.** One coherent plan; no per-vendor relay (PLAN-02).
- **Evidence + Validation.** Contract exists before any sub-agent (PLAN-07).
- **Failure → Recovery.** No contract → sub-agents drift; the plan is revisable
  (PLAN-08).
- **Success / KPIs.** Integration-defect rate.
- **Anchor.** planning phase. Laws: PLAN-02/07/08.

### C13 — Feature Dependency Planning · [LIVE] *(requested C18)*
- **Purpose.** Order features by their dependencies so prerequisites are built first.
- **Inputs → Outputs.** The ranked features → a dependency-ordered build sequence.
- **Decision process.** Dependency graph over features + the import graph.
- **Evidence + Validation.** The import/dependency graph engine (§25 of Vol 3).
- **Failure → Recovery.** A dangling dependency → deterministic import/dep fixers.
- **Success / KPIs.** Post-build resolution rate.
- **Anchor.** dependency graph engine + import fixers. Laws: EDIT-06/08/11.

### C14 — Complexity Estimation · [LIVE]
- **Purpose.** Estimate the build's complexity to set tier, budget, and step cap.
- **Inputs → Outputs.** The requirement set → a complexity score → tier/budget.
- **Decision process.** Deterministic scoring in RequestAnalyser.
- **Evidence + Validation.** Adaptive step cap by complexity.
- **Failure → Recovery.** Under-estimate → step-resume extends the budget (RECOV-04).
- **Success / KPIs.** Step-cap-hit rate vs complexity.
- **Anchor.** RequestAnalyser + adaptive cap. Laws: PLAN-05, PERF-10.

### C15 — Task Decomposition · [LIVE] *(requested C21)*
- **Purpose.** Break the plan into a file/task list a coherent build executes,
  optionally via same-workspace sub-agents.
- **Inputs → Outputs.** The plan → a task/file list + sub-agent assignment.
- **Decision process.** Decompose only where pieces share one contract + one workspace
  (coherence).
- **Evidence + Validation.** Sub-agents build against the shared contract.
- **Failure → Recovery.** Drift → integration caught by verification.
- **Success / KPIs.** Sub-agent integration success.
- **Anchor.** plan + SubAgent. Laws: PLAN-02, ARCH-01.

### C16 — Execution Strategy + Sequencing + Scheduling · [LIVE] *(requested C22 + planning-engine sequencing)*
- **Purpose.** Decide the execution order — serialize mutations, parallelize
  independent work, bound everything.
- **Inputs → Outputs.** The task list + budget → a bounded, race-free schedule.
- **Decision process.** "Find in parallel, fix serially"; all bounded.
- **Evidence + Validation.** Timeouts/step-caps/concurrency configured.
- **Failure → Recovery.** A race → serialized mutations; a stall → bounded timeout.
- **Success / KPIs.** Wall-clock efficiency.
- **Anchor.** dispatch scheduler. Laws: PERF-08/09, ARCH-08.

### C17 — Milestone / Incremental-Delivery Planning · [LIVE]/[ASPIRATIONAL] *(requested C23)*
- **Purpose.** Where a build is large, deliver in coherent increments with progressive
  preview, keeping a working core at each step.
- **Inputs → Outputs.** A large plan → module milestones + progressive preview points.
- **Decision process.** Software-project mode for large apps; checkpoints mid-build.
- **Evidence + Validation.** Preview updates progressively; checkpoints sanity-check.
- **Failure → Recovery.** Budget pressure → graceful degradation to the core.
- **Success / KPIs.** Working-core-at-each-milestone rate.
- **Anchor.** software-project mode + checkpoints. Laws: PLAN-03, REL-08.
  `[ASPIRATIONAL]` for full milestone orchestration.

### C18 — Risk Analysis · [LIVE]/[ASPIRATIONAL] *(requested C19 + risk-management section)*
- **Purpose.** Assess and route the build's risks (see Part V for the ten risk types).
- **Inputs → Outputs.** The plan → a risk posture + mitigations/gates selected.
- **Decision process.** Deterministic (command risk, complexity) + gate selection.
- **Evidence + Validation.** High-risk pre-blocked; the relevant gates armed.
- **Failure → Recovery.** An unassessed risk → the gates backstop.
- **Success / KPIs.** Risk-caught-before-ship rate.
- **Anchor.** risk classifier + gates. Laws: SEC-04, PLAN-05. `[ASPIRATIONAL]` for a
  unified risk score.

### C19 — Acceptance Criteria · [LIVE]/[ASPIRATIONAL] *(requested C24)*
- **Purpose.** Define, per feature, what "working" means — the criteria the delivered
  app is judged against.
- **Inputs → Outputs.** The requirement set → acceptance criteria feeding verification.
- **Decision process.** Feature-presence expectations + (aspirational) explicit
  criteria + generated tests.
- **Evidence + Validation.** Judged on the rendered app + executed tests (VERIFY-08,
  TEST-07).
- **Failure → Recovery.** Unmet criteria → repair or honest finding.
- **Success / KPIs.** Acceptance-pass rate.
- **Anchor.** feature-presence + vaccine. Laws: VERIFY-07, TEST-07. `[ASPIRATIONAL]`
  for explicit per-feature acceptance criteria.

### C20 — Definition of Done · [LIVE] *(requested C25)*
- **Purpose.** The binding bar a build must meet to be delivered.
- **Inputs → Outputs.** All verdicts → a done/not-done decision.
- **Decision process.** The Production Readiness barrier (Vol 4 S24): verified +
  reversible + observable + non-regressive; requested features present; honest bill.
- **Evidence + Validation.** The aggregate readiness verdict.
- **Failure → Recovery.** Not-done → not delivered; honest failure, no charge.
- **Success / KPIs.** Post-delivery failure rate.
- **Anchor.** readiness gate. Laws: §45, TRUTH-03, VERIFY-01. **Done = Vol 0 §46 +
  the readiness barrier; there is no partial done.**

*(Requested C8 Conflict, C9 Ambiguity, C10 Missing-req are covered by C6/C7/C8 above;
requested C20 Complexity by C14; requested C11 Business Rules by C10. Consolidated so
each concern has one home, per DOC-03.)*

---

# Part III — Requirement Engine Rules

NavBharatAI shall:

- **Identify explicit requirements** — extract what the user stated. *(LIVE.)*
- **Infer implicit requirements** — add what a reasonable builder assumes, as a
  *stated default*, never a fact. *(LIVE.)*
- **Separate facts from assumptions** — label inferences so they are correctable
  (C11). *(LIVE.)*
- **Detect conflicting requests** — surface a consequential contradiction; default the
  later request on an ordinary one. *(LIVE for ordinary; `[ASPIRATIONAL]` formal
  conflict detection — C6.)*
- **Recognize hidden dependencies** — via the feature + import dependency graph (C13).
  *(LIVE.)*
- **Detect impossible requirements** — respond with an honest not-available state, never
  a fake (C9). *(LIVE honesty; `[ASPIRATIONAL]` formal pre-check.)*
- **Detect incomplete specifications** — for the *core*; the rest is safe-defaulted and
  verified post-build. *(LIVE via feature-presence; `[ASPIRATIONAL]` formal
  completeness.)*
- **Ask clarification only when absolutely necessary** — the consequential,
  un-defaultable fork only (C7). *(LIVE.)*
- **Proceed autonomously whenever sufficient evidence exists** — the default; state the
  assumption and move (ETHIC-04). *(LIVE.)*
- **Generate an engineering spec from natural language** — the plan + shared contract.
  *(LIVE.)*
- **Generate acceptance criteria** — feature-presence expectations + tests. *(LIVE
  partial; `[ASPIRATIONAL]` explicit criteria — C19.)*
- **Generate implementation priorities** — core → nice ranking (C4). *(LIVE partial.)*
- **Estimate engineering effort / technical risk / architectural + integration +
  verification complexity** — via the complexity score + tier/budget; unified formal
  estimates are `[ASPIRATIONAL]`. *(LIVE partial.)*

**The governing rule:** an assumption is made only when it is *safe and reversible*;
anything consequential is either evidence-backed or surfaced. Sufficient evidence →
proceed; insufficient + consequential → ask; insufficient + ordinary → safe-default and
state.

---

# Part IV — Planning Engine Rules

NavBharatAI's planning shall govern:

- **Feature decomposition** — into a coherent file/task list on one workspace (C15).
- **Module planning** — module milestones for large apps (C17, software-project mode).
- **Dependency-graph generation** — the feature + import graph (C13, Vol 3 §25).
- **Repository-impact analysis** — edit mode grounds every change in the true full map
  before touching it (Vol 4 S5). *(LIVE.)*
- **Execution sequencing** — serialize mutations, parallelize independent (C16).
- **Parallel-execution opportunities** — independent reads/reviews run concurrently;
  mutations never do (PERF-08).
- **Rollback planning** — salvage + guardian return to the last good state; engine
  changes revert/redeploy; flags disable without a deploy (DEPLOY-04).
- **Failure containment** — the layered failure-isolation strategy (Vol 3 §36); a fault
  degrades to a fallback, never cascades.
- **Incremental delivery** — progressive preview + graceful degradation to a working
  core (C17).
- **Architecture consistency** — one coherent design, the shared contract; no drift
  (PLAN-02, ARCH-02).
- **Technical-debt prevention** — root-cause fixes with tests, not surface patches;
  centralize duplicates (Vol 0 §5, ETHIC-10). Debt is tracked honestly, never hidden
  (Vol 0 §50).
- **Scalability planning** — plan for the large case (bounded listings, overflow,
  adaptive budgets — PLAN-05, REL-08).
- **Maintainability planning** — write for the next session; comment the constraint
  (DOC-01/02).
- **Future-extensibility planning** — additive, flag-gated, reversible extension points
  (Vol 3 §30, ARCH-05).

**The governing rule:** planning depth is proportional to complexity (least-power) —
light for a simple app, deep for a complex one — but *architecture consistency and a
shared contract are non-negotiable at every depth*.

---

# Part V — Risk Management

Constitutional handling for the ten risk classes (each: how it is assessed + mitigated):

| Risk | Assessed by | Mitigated by |
|---|---|---|
| **Requirement risk** | complexity + core-completeness | safe defaults + feature-presence net |
| **Architecture risk** | contract coherence | one coherent plan + shared contract (PLAN-02) |
| **Repository risk** | edit-mode full-map grounding | guardian restore + shrink-guard (MEM-01/02) |
| **Security risk** | command risk classifier + surface scan | block-before-run + redaction (SEC-01..14) |
| **Performance risk** | prompt size + provider signals | cooldowns, diet, incremental checks (PERF-*) |
| **Deployment risk** | CI status | CI-green-before-merge + rollback (DEPLOY-02/04) |
| **Provider risk** | saturation/outage signals | fallback chain + permanent backstop (PROV-03) |
| **Integration risk** | sub-agent contract adherence | shared contract + integration verification |
| **Regression risk** | full-suite diff | additive + flag-gated + full-suite green (§25, TEST-05) |
| **Maintenance risk** | clarity for the next session | write-for-next-session + this library (DOC-01) |

**The governing rule:** a known risk is either mitigated by a structural guarantee or
honestly recorded as open (Vol 0 §35, RECOV-11) — never silently accepted.

---

# Part VI — Acceptance Planning

Every feature receives:

- **Acceptance criteria** — what "working" means, judged on the rendered app (C19).
- **Verification strategy** — which gates apply (type, static, runtime, UI, security;
  DB/API for full-stack) (Vol 4 Part III).
- **Runtime-validation plan** — observed behavior (render, endpoints, console), not
  source inspection (VERIFY-05). *(LIVE for UI; `[ASPIRATIONAL]` for API/DB runtime.)*
- **Negative-test scenarios** — red-team/fuzz edge-case discovery (immune system).
  *(LIVE partial.)*
- **Edge-case analysis** — the immune red-team phase surfaces edge cases. *(LIVE
  partial; `[ASPIRATIONAL]` for exhaustive analysis.)*
- **Regression checklist** — the full test suite + the analyzer suite must stay green
  (TEST-05). *(LIVE for the engine; app-level regression is `[ASPIRATIONAL]`.)*
- **Production-readiness checklist** — the readiness barrier: verified + reversible +
  observable + non-regressive + requested-features-present (§45). *(LIVE.)*

**The governing rule:** acceptance is judged by *evidence against the real app*, never
by the plan's promise (Vol 0 §9).

---

# Part VII — Forbidden Behaviors & Quality Standards

## The planning engine must never:

- **Assume a *consequential* requirement** silently (safe defaults are allowed and
  required; dangerous ones are not — the corrected form of "no assumptions").
- **Ignore a detected contradiction** — a consequential conflict is surfaced.
- **Skip planning** — every build has a plan (depth proportional to complexity).
- **Start implementation on a genuinely-blocking unknown** — ask first on the
  consequential, un-defaultable fork.
- **Overlook a core dependency** — the dependency graph + fixers catch it.
- **Ignore platform limitations** — framework/platform constraints are applied.
- **Ignore user intent** — intent overrides implementation convenience (PLAN-12).
- **Optimize for convenience over correctness** — correctness wins (Decision
  Hierarchy).
- **Produce an unverifiable plan** — every plan resolves to gate-checkable outcomes.
- **Approve an incomplete *core* specification** as done — Definition of Done is
  binding (C20).

## Planning must be:

Evidence-driven · deterministic where computable · auditable · repeatable ·
repository-aware · architecture-aware · runtime-aware · security-aware · scalable ·
maintainable · production-oriented. Each maps to an enforced law above; where a
standard is only `[ASPIRATIONAL]` today (formal completeness/consistency/impossibility
detection, explicit acceptance criteria, unified effort/risk estimation), the gap is
named and its closure is mandated work — never claimed as already met.

---

# Closing

NavBharatAI converts natural language into an engineering plan by **understanding
enough, assuming safely, planning proportionally, and verifying against the real
app** — not by waterfall interrogation. The corrected core principle: *no code until
the right thing is understood, and no **consequential** ambiguity ever passes
silently* — while safe, reversible assumptions keep the engine as fast as the best
builders in the world.

Where a chapter is `[ASPIRATIONAL]` (formal conflict / impossibility / ambiguity
detection, explicit acceptance criteria, unified effort/risk estimation), that is an
honest gap the engine intends to close — its rigor today lives in the *verification
net* (feature-presence, acceptance tests, the readiness barrier), which makes light,
fast planning *safe*.

Every build complies with this Constitution before implementation begins. When a
requirement is unclear and consequential, ask; when it is ordinary, safe-default and
state; and in every tie, the Prime Law governs — **truth is the product, trust is the
treasure.**

---

*Volume 5 of the NavBharatAI Build Engine Constitution. Descriptive-first and
code-anchored; inherits Volumes 0–4; amendments follow the engine's own discipline
(branch → PR → CI green → merge).*

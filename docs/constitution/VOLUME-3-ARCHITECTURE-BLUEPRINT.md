# NavBharatAI Build Engine — Constitution

## Volume 3 — System Architecture Blueprint

> **Status:** Reference architecture. Volume 0 set the philosophy, Volume 1 the
> laws, Volume 2 the roles. This volume defines the **permanent structure** — the
> subsystems, their boundaries, how data and control flow between them, and how
> failure is isolated. Every future implementation must fit this structure.
>
> **Authority:** This blueprint inherits Volumes 0–2 and may never contradict them.
> It is **descriptive-first and code-anchored**: it documents the architecture as it
> genuinely exists (with `subsystem → code` anchors), and marks a subsystem
> **`[LIVE]`** (built today) or **`[ASPIRATIONAL]`** (a target whose gap is mandated
> work). It describes structure, not implementation — no code, no APIs.
>
> **An honest consolidation.** The requested section list splits several concerns
> that are, in the real engine, one subsystem (e.g. Knowledge / Memory / Storage are
> facets of one Durable Truth subsystem; Planning / Architecture are two phases of
> one Planning subsystem). This blueprint honors every requested topic but names the
> **real** subsystem once and shows the facets under it — because a blueprint that
> invents subsystems the engine does not have would violate Volume 1 DOC-04/05 and
> the Prime Law. Where a requested subsystem does not yet exist, it is marked
> `[ASPIRATIONAL]`, honestly.

---

# Part I — The Shape of the System

## §1. High-Level System Architecture

NavBharatAI is a **single coherent build engine** wrapped by a thin request surface
and backed by durable stores. At the highest level there are five bands:

1. **Edge / Request Surface** — receives a user request (web, native, API),
   authenticates it, and streams events back. Thin; it holds no build logic.
2. **The Coherent Execution Core** — the one place a build actually happens: the
   Architect agent driving a bounded tool loop over a shared workspace, calling
   deterministic gates, services, and functions. This is the heart.
3. **The Provider Fabric** — an abstraction that turns "run a model turn" into a
   fault-tolerant call across a fallback chain, invisibly to everything above it.
4. **The Sandbox / Runtime** — an ephemeral cloud execution environment (E2B) plus
   an in-browser preview, where the built app actually runs and is observed.
5. **The Durable Substrate** — the sources of truth that survive an ephemeral
   sandbox: the workspace file store, the user's GitHub archive, diagnostics, and
   the wallet/cost ledger.

The **one architectural invariant** binding all five: *the ephemeral is never
trusted as truth; the durable substrate is.* A recycled sandbox is a cache miss,
never a data loss (Volume 1 ARCH-11, MEM-01).

*Anchor:* the request surface (`routes/agentv3.ts`) → the core (`AgentRunner`,
`ToolDispatcher`) → the provider fabric (`MultiProviderTurnRunner`) → the sandbox
(`E2BActuator`, `ReactPreview`) → the substrate (`WorkspaceFileStore`,
`BuildDiagnostics`, wallet).

## §2. Architectural Philosophy

The architecture is a direct expression of Volume 0:

- **Coherence over federation** (§17) — one build, one workspace, few agents; not a
  mesh of independent services relaying artifacts.
- **Least-Power** (§26) — every concern is placed in the *weakest sufficient*
  structural primitive: a deterministic gate or function wherever a concern is
  computable, a model-driven agent only where judgment is required.
- **Structural quality** (§6) — correctness is built into the structure (templates,
  write-time guards, typed boundaries) so bad states are hard to produce, not merely
  caught later.
- **Durable-truth-first** (§11, §31) — the durable substrate is authoritative;
  everything ephemeral is reconstructable from it.
- **Additive, reversible, observable** (§24, §25, §27) — every subsystem is added
  alongside the proven path, flag-gated, and emits honest signals.

## §3. Architectural Layers

The engine is layered so that **dependencies point downward only** (low coupling,
high cohesion). A higher layer may call a lower one; a lower layer never depends on
a higher one. Top to bottom:

| Layer | Owns | Real subsystem(s) |
|---|---|---|
| **L7 Request Surface** | intake, auth, event streaming | route handlers |
| **L6 Orchestration** | the build lifecycle, phase sequencing | AgentRunner + route pipeline |
| **L5 Reasoning Agents** | judgment: architect, sub-agents, reviewer | AgentRunner / SubAgent / reviewer |
| **L4 Gates & Analysis** | deterministic verification & repair | Readiness, Integrity, analyzers, EndgameRepair |
| **L3 Capabilities** | tools & transforms | ToolDispatcher + functions |
| **L2 Provider Fabric** | model execution + fallback | MultiProviderTurnRunner |
| **L1 Runtime** | sandbox execution + preview | E2BActuator, ReactPreview |
| **L0 Durable Substrate** | truth that survives | WorkspaceFileStore, GitHub, Diagnostics, wallet |

*Failure isolation follows the layering:* a fault in a higher layer degrades to a
lower-layer fallback; a fault in a lower layer surfaces upward as an honest,
bounded error — never an unbounded cascade (Volume 1 ARCH-10, REL-06).

---

# Part II — The Subsystems

*Each subsystem carries the full contract, terse by design (Volume 1 style):
Purpose · Responsibilities · Inputs · Outputs · Dependencies · Interface ·
Ownership · Failure modes · Recovery · Observability · Scalability · Security ·
Performance · Anchor · Status. Where two requested sections are one real subsystem,
they are consolidated with the facets named.*

## §4. Core Execution Engine · [LIVE]
- **Purpose.** The one place a build happens: drive a bounded tool loop that turns a
  plan into a verified working app.
- **Responsibilities.** Run the Architect's turn loop; execute/serialize tools;
  spawn same-workspace sub-agents; enforce step/time/token budgets; sequence the
  lifecycle phases; produce an honest result.
- **Inputs.** Classified request, plan + shared contract, workspace handle, tool
  catalog, provider runner.
- **Outputs.** A built app in the workspace + an honest `done` verdict + usage.
- **Dependencies.** Provider Fabric (L2), Capabilities (L3), Gates (L4), Durable
  Substrate (L0).
- **Interface.** One event stream out (narration/tool_call/tool_result/done); the
  tool-call protocol in.
- **Ownership.** Owns the build's control flow and budget; owns nothing durable
  directly (it writes through the substrate).
- **Failure modes.** A stalled model turn; a step-cap reached; a poison turn; a tool
  timeout.
- **Recovery.** Per-turn timeout → honest stop + salvage; step-cap → pause-and-resume
  (not death); tool timeout → is_error result, loop continues; poison turn →
  recovery.
- **Observability.** Every step, tool, provider, and token recorded to diagnostics.
- **Scalability.** Bounded transcript sent to the model (compaction); adaptive step
  budget by complexity; concurrency-capped parallel tool group.
- **Security.** Never self-approves; cannot destroy source; all tool output redacted.
- **Performance.** Serial mutations first, parallel reads/reviews after; git off the
  hot path.
- **Anchor.** `AgentRunner`. Laws: PLAN-02, ARCH-08, VERIFY-02, RECOV-04.

## §5. Shared Workspace · [LIVE]
- **Purpose.** The single mutable surface all builders and gates operate on, so work
  stays coherent.
- **Responsibilities.** Hold the current file set for a build; mediate every read and
  write; keep the sandbox and durable store reconciled.
- **Inputs.** File writes/edits from agents; restores from the substrate.
- **Outputs.** A consistent, resolvable project view to every consumer.
- **Dependencies.** Durable Substrate (truth), Runtime (the sandbox cache).
- **Interface.** read/write/list file operations via the actuator.
- **Ownership.** Owns the *reconciliation* between ephemeral sandbox and durable
  truth; owns no judgment.
- **Failure modes.** A recycled/cold sandbox; a partial listing; a concurrent-write
  race.
- **Recovery.** File Guardian restores missing files from the store before any edit;
  union-only reconcile; single-flight checkpoints.
- **Observability.** Every mutation recorded; data-loss events logged honestly.
- **Scalability.** Bounded edit-mode file tree; content-based retrieval for large
  repos; overflow storage for 10k+ files.
- **Security.** Per-user isolation; no cross-workspace access.
- **Performance.** Merge-not-replace writes; shrink-guarded so a cold listing never
  wipes truth.
- **Anchor.** Workspace reconciliation in `routes/agentv3.ts` + actuator. Laws:
  ARCH-11, MEM-02/05, EDIT-04.

## §6. Repository Intelligence Layer · SERVICE · [LIVE]
- **Purpose.** Know the project deeply enough to ground every edit in reality, at any
  scale — *repository-first reasoning*.
- **Responsibilities.** Index files and symbols; retrieve by content; answer "where
  is X / what imports Y"; bound the tree for large repos.
- **Inputs.** The durable file map + sandbox listing.
- **Outputs.** File maps, symbol lookups, dependency facts, grounding context.
- **Dependencies.** Durable Substrate.
- **Interface.** query/recall/retrieve.
- **Ownership.** Owns project *knowledge*; approves nothing, builds nothing.
- **Failure modes.** A stale or partial index.
- **Recovery.** Rebuilds from durable truth; never lets a partial listing shrink the
  known set.
- **Observability.** Grounding accuracy visible via edit-resolution rate.
- **Scalability.** Bounded listings, streaming, content retrieval for scale.
- **Security.** Reads within the user's workspace only.
- **Performance.** Indexed lookups instead of full scans.
- **Anchor.** `WorkspaceMemory` + retrieval. Laws: MEM-01, EDIT-04, REL-08.

## §7. Knowledge Layer · [LIVE] — *(a facet of the Durable Substrate + App Self-Awareness)*
- **Purpose.** Hold what the engine and its AIs *know*: cross-session lessons, the app
  capability catalog, and error memory.
- **Responsibilities.** Persist lessons/errors for recall; keep the app knowledge base
  (what NavBharatAI can do, with exact navigation) in sync.
- **Inputs.** Learnings, errors, new user-facing capabilities.
- **Outputs.** Recallable knowledge to agents; navigation answers to every AI.
- **Dependencies.** Storage (L0); the Learning Layer feeds it.
- **Interface.** record/recall.
- **Ownership.** Owns institutional knowledge; distinct from per-project file memory
  (§6).
- **Failure modes.** Stale or unsynced knowledge → a feature no AI can find.
- **Recovery.** Sync rule: a new capability updates the knowledge base in the same
  change (Volume 1 DOC-07, QA-13).
- **Observability.** Coverage of capabilities in the knowledge base.
- **Scalability.** Bounded, indexed recall.
- **Security.** Redacted at storage (no secrets in recallable memory).
- **Performance.** Recall is a bounded lookup.
- **Anchor.** `AppKnowledgeBase` + WorkspaceMemory error/lesson store. Laws: LEARN-09,
  QA-13, MEM-09.

## §8. Planning Layer · [LIVE] — *(consolidates "Planning Layer" §8 + "Architecture Layer" §9)*
- **Purpose.** Turn a classified request into a coherent build plan and a shared
  contract before any code is written.
- **Responsibilities.** Classify intent + complexity (the *Requirements/Planning*
  facet); rank features core→nice (the *Product* facet); produce the file list and
  the shared types/interfaces/layout all builders build against (the *Architecture*
  facet).
- **Inputs.** The user request; framework; prior workspace (edit vs new).
- **Outputs.** A file plan + a shared contract + a tier/budget recommendation.
- **Dependencies.** Provider Fabric (for the planning model per routing policy).
- **Interface.** analyze → plan → contract.
- **Ownership.** Owns *what to build and in what shape*; the Core owns *building it*.
- **Failure modes.** Under-scoping a large app; sub-agents without a shared contract.
- **Recovery.** Adaptive budget by complexity; the contract precedes any sub-agent
  (PLAN-07); the plan is revisable, not sacred (PLAN-08).
- **Observability.** Complexity, tier, and plan recorded.
- **Scalability.** Plans for the large case by design.
- **Security.** No secrets in the plan.
- **Performance.** Cheap planning model per routing policy.
- **Anchor.** `RequestAnalyser` + planning phase. Laws: PLAN-01/02/03/05/07.

## §9. Architecture Layer
*Consolidated into §8 (Planning Layer) — "produce the shared contract/layout" is the
architecture facet of one Planning subsystem. Splitting it into a separate runtime
subsystem would create a seam with no owner. See §8.*

## §10. Code Generation Layer · [LIVE]
- **Purpose.** Produce real, working source for the planned files against the shared
  contract — the cascade that guarantees *something real* is always produced.
- **Responsibilities.** Run the generation cascade: **(1)** a fast-lane simple build
  (bounded), **(2)** on timeout, *salvage* its finished files and hand them forward,
  **(3)** the full agentic builder continues (never restarts), **(4)** same-workspace
  frontend/backend sub-agents where warranted.
- **Inputs.** Plan + contract + workspace.
- **Outputs.** Real source files (never a stub reported as done).
- **Dependencies.** Core Execution (L5), Provider Fabric (L2).
- **Interface.** generate/continue on the shared workspace.
- **Ownership.** Owns code production; owns no approval.
- **Failure modes.** Fast-lane timeout; a zombie stage; a truncated write.
- **Recovery.** Salvage handoff with "continue, do not start over"; zombie-kill of the
  lapsed stage; truncated-write syntax check + rewrite.
- **Observability.** Files, provider per turn, salvage events recorded.
- **Scalability.** Sub-agents on one shared workspace; adaptive budgets.
- **Security.** Real features only; no fake/stub.
- **Performance.** Cheap floor leads; vertical escalation only on failure.
- **Anchor.** `SimpleBuilder` → salvage → `AgentRunner` → `SubAgent`. Laws: TRUTH-04,
  RECOV-01/02/03, EDIT-09.

## §11. Semantic Editing Layer · [LIVE]
- **Purpose.** Apply edits that keep the project resolvable and never corrupt it.
- **Responsibilities.** write/edit files; reconcile imports/exports; normalize
  specifiers; fix wrong-source and mispath imports deterministically; guard against
  blank overwrites and silent stale-match edits.
- **Inputs.** A target file + a change.
- **Outputs.** A consistent, resolvable file set.
- **Dependencies.** Shared Workspace, deterministic fixers.
- **Interface.** write_file / edit_file + import reconcilers.
- **Ownership.** Owns file mutation under the guards.
- **Failure modes.** A dangling import; a stale `old_string`; a blank overwrite.
- **Recovery.** Deterministic import fixers; a stale edit fails loudly with current
  content; blank overwrite refused.
- **Observability.** Every write recorded and attributed.
- **Scalability.** Operates per-file; unaffected by repo size.
- **Security.** Cannot destroy source directories.
- **Performance.** Deterministic fixes before any model repair.
- **Anchor.** ToolDispatcher edit path + import fixers. Laws: EDIT-01/06/07/08/10/12.

## §12. Verification Layer · [LIVE]
- **Purpose.** Establish, by evidence, whether the app actually works — *independent,
  evidence-driven validation*.
- **Responsibilities.** Type check (incremental); static analysis (hooks, imports,
  JSX, dependency conflicts, integrity); in-process syntax parse (immune to sandbox
  tooling failure); runtime readiness scan; preview-render verification.
- **Inputs.** The full durable file map + the running preview.
- **Outputs.** A readiness verdict (score + blockers) + structural findings.
- **Dependencies.** Runtime (preview), Repository Intelligence (full map).
- **Interface.** assess → verdict.
- **Ownership.** Owns the *binding pre-delivery verdict*; independent of the builder
  (no self-approval).
- **Failure modes.** A false-ready or false-fail verdict; an un-runnable check.
- **Recovery.** An un-run check is reported unverified, never assumed pass; the
  in-process parser backstops sandbox-tsc failure.
- **Observability.** Verdict + blockers lead the build summary.
- **Scalability.** Bounded, parallel, timeout-guarded analysis.
- **Security.** Reads only.
- **Performance.** Deterministic checks before any model review; incremental tsc.
- **Anchor.** Readiness gate + analyzers + `SyntaxCheck` + preview verify. Laws:
  TRUTH-01, VERIFY-01/06/09/10/13.

## §13. Runtime Layer · [LIVE]
- **Purpose.** Actually run the built app and let it be observed.
- **Responsibilities.** Provide the ephemeral cloud sandbox (E2B) for full execution;
  provide the in-browser preview (bundler + injected design tokens) for instant
  render; manage the dev server on the one host-checked preview path; capture
  screenshots/console.
- **Inputs.** The workspace + run commands.
- **Outputs.** A managed preview URL + observed runtime signals.
- **Dependencies.** Shared Workspace.
- **Interface.** run command / publish preview / screenshot / console.
- **Ownership.** Owns execution + observation; owns nothing durable (the sandbox is a
  cache).
- **Failure modes.** A recycled sandbox; a dev-server boot crash; a blocked preview
  host.
- **Recovery.** Guardian restore of a recycled sandbox; scaffold/config invariants
  (`type:module`, `allowedHosts`) so the server boots; preview guard redirects
  unmanaged servers.
- **Observability.** Preview-publish rate; dev-server boot rate; console errors.
- **Scalability.** In-browser for simple apps (least-power); sandbox for full-stack.
- **Security.** Managed host boundary; no arbitrary host binding.
- **Performance.** In-browser render is instant; sandbox reserved for real execution.
- **Anchor.** `E2BActuator`, `ReactPreview`, preview guard. Laws: ARCH-11, SEC-14,
  QA-06, EDIT-15.

## §14. Quality Assurance Layer · [LIVE]
- **Purpose.** Ensure the delivered app meets the quality bar — objective gates plus a
  bounded, honest reviewer.
- **Responsibilities.** Run readiness + integrity + lint gates; run the reviewer
  (mode-aware judge) that auto-fixes authorized defect classes in one bounded pass;
  run the immune system (feature-presence, vaccine tests, red-team/fuzz).
- **Inputs.** The built + verified app.
- **Outputs.** A quality verdict + bounded repairs.
- **Dependencies.** Verification Layer, Provider Fabric (the judge).
- **Interface.** gate → verdict + repairs.
- **Ownership.** Owns quality judgment; separate from the builder (no self-approval).
- **Failure modes.** A defect escaping; a working app wrongly blocked on style.
- **Recovery.** Blocks on real defects only; heal never fails a working build; the
  honest summary is preserved.
- **Observability.** Findings + repairs recorded.
- **Scalability.** Find-in-parallel, fix-serially.
- **Security.** The security gate is part of the audit band (§15).
- **Performance.** Deterministic gates before the model reviewer.
- **Anchor.** Readiness/integrity/lint + C9 reviewer + immune system. Laws:
  QA-01..12, TEST-07.

## §15. Security Layer · [LIVE]
- **Purpose.** Keep secrets in and dangerous actions out — a cross-cutting choke
  point, not a bolt-on.
- **Responsibilities.** Redact secrets at every user/model/log surface; classify and
  block high-risk commands before execution; enforce tenancy and credential
  boundaries; treat untrusted input as hostile.
- **Inputs.** Commands, outputs, generated code, config, external content.
- **Outputs.** Redacted surfaces; blocked dangerous actions.
- **Dependencies.** Applied within Capabilities (L3) and the substrate.
- **Interface.** redact / classify-and-block, at one choke point.
- **Ownership.** Owns the safety boundary; overrides convenience.
- **Failure modes.** A leak; a destructive/exfiltrating action.
- **Recovery.** Prevention, not recovery — the illegal action is refused before it
  runs.
- **Observability.** Every risk decision recorded (admin-only detail).
- **Scalability.** A choke point scales to every call site by construction.
- **Security.** *It is* the security boundary.
- **Performance.** Redaction/classification is cheap and synchronous.
- **Anchor.** `redactSecrets`, risk classifier, destructive-delete block, no-Claude
  zone. Laws: SEC-01..15, ARCH-12.

## §16. Deployment Layer · [LIVE] (human-bounded)
- **Purpose.** Get verified change to production safely, via one disciplined path.
- **Responsibilities.** For the *engine's own* changes: enforce branch → PR → CI green
  → merge → auto-deploy. For *user apps*: save the build to the user's GitHub archive.
- **Inputs.** A CI-green PR (engine); a completed build (user app).
- **Outputs.** A production deploy (engine) / an archived app (user).
- **Dependencies.** The CI pipeline; the GitHub storage integration.
- **Interface.** merge → Cloud Run; commit → user repo.
- **Ownership.** Owns the deploy discipline; the merge decision is a human/session
  act, never an autonomous unbounded one.
- **Failure modes.** A red or side-channel deploy; a webhook miss.
- **Recovery.** Never merge red; rollback via revert/redeploy; flags disable behavior
  without a deploy; a documented manual trigger only for a genuine webhook miss.
- **Observability.** Every merge/deploy traceable.
- **Scalability.** One reproducible pipeline.
- **Security.** Signing keystore stays admin-only; env values never in the repo.
- **Performance.** Deploy latency communicated honestly.
- **Anchor.** Repo flow + `cloudbuild.yaml` + GitHub storage. Laws: DEPLOY-01..12,
  REPO-02/03/14.

## §17. Observability Layer · SERVICE · [LIVE]
- **Purpose.** Make the engine's behavior visible and honest, richly enough to improve
  it — *you cannot improve what you cannot see*.
- **Responsibilities.** Record the forensic build report (events, commands, providers,
  errors, cost) at two tiers (admin-detailed, user-anonymized); emit signals even on
  success; feed the learning loop.
- **Inputs.** The whole build lifecycle.
- **Outputs.** Diagnostics + telemetry.
- **Dependencies.** Storage (L0).
- **Interface.** record / report.
- **Ownership.** Owns the audit trail; alters no build.
- **Failure modes.** A blind spot; a misattribution; a leak to the user.
- **Recovery.** Fail-open (a diagnostics throw never breaks a build); keep-the-tail
  trimming; provider names admin-only.
- **Observability.** *It is* observability.
- **Scalability.** Bounded, trimmed records.
- **Security.** Secrets masked; vendors anonymized on user surfaces.
- **Performance.** Best-effort, off the correctness path.
- **Anchor.** `BuildDiagnostics` + `DiagnosticsStore`. Laws: LOG-01..10, TRUTH-06,
  PROV-13.

## §18. Learning Layer · [LIVE] (session/admin-driven)
- **Purpose.** Turn every real failure into a permanently harder engine.
- **Responsibilities.** Run the five-bucket forensic autopsy on every real report;
  diagnose the missing subsystem; fix the class engine-wide; hunt siblings; lock with
  tests; record the lesson durably.
- **Inputs.** Real build/diagnostics reports.
- **Outputs.** Root-cause fixes + regression tests + recorded lessons + new laws.
- **Dependencies.** Observability (the report), the repo cycle, this library.
- **Interface.** autopsy → fix → record.
- **Ownership.** Owns the engine's improvement from experience.
- **Failure modes.** A skimmed report; a workaround counted as a win; a one-app patch.
- **Recovery.** The discipline itself is the recovery: read the whole report, fix the
  class, record honestly.
- **Observability.** Recurrence rate → 0; autopsy-to-fix conversion.
- **Scalability.** Each fix raises the floor for all future builds.
- **Security.** Redacted reports feed the loop.
- **Performance.** Prevents future waste by eliminating classes.
- **Anchor.** The fifth absolute rule + PROGRESS + this library. Laws: LEARN-01..12.

## §19. Provider Abstraction Layer · [LIVE]
- **Purpose.** Turn "run a model turn" into a fault-tolerant, policy-governed,
  vendor-anonymous call — the fabric that keeps the engine alive when a vendor is not.
- **Responsibilities.** Execute a turn across a fallback chain (cheap floor →
  … → permanent backstop); bench saturated providers (per-key rotate, service-level
  pool-bench); route per the Model Routing Policy; enforce the weak-tier no-Claude
  zone; attribute the real model that answered; anonymize the vendor upward.
- **Inputs.** A turn request + the tier/mode.
- **Outputs.** A completed turn (from whichever provider answered) + attribution.
- **Dependencies.** The provider chain config; the routing policy.
- **Interface.** runTurn — one call, invisible fallback.
- **Ownership.** Owns model execution + resilience; owns no build logic.
- **Failure modes.** A saturated/throttled provider; a retired model id; a fatal auth
  error.
- **Recovery.** Cooldowns with auto-expiry; a model-id ladder tolerates a retired id;
  a fatal error is dead-for-run; the backstop always answers.
- **Observability.** Provider delivery + failures recorded (admin-only).
- **Scalability.** Key pools; prompt diet; concurrency-aware cooldowns.
- **Security.** No vendor name ever reaches a user; weak tier structurally cannot run
  Sonnet/Opus.
- **Performance.** Fast fallthrough on known-doomed calls; pool bench avoids timeout
  storms.
- **Anchor.** `MultiProviderTurnRunner` + routing. Laws: PROV-01..15.

## §20. Memory Layer · [LIVE] — *(the ephemeral+durable file memory; the truth store is §21)*
- **Purpose.** Hold and reconcile a project's files across the ephemeral sandbox and
  the durable store.
- **Responsibilities.** Serve the current file set; merge writes; guard against a
  shrinking set replacing a larger one; restore missing files; re-materialize binary
  assets; replay build/edit history.
- **Inputs.** Writes; restores; a sandbox listing.
- **Outputs.** The reconciled, authoritative project view.
- **Dependencies.** Storage (§21).
- **Interface.** save/merge/load/restore.
- **Ownership.** Owns file-level truth reconciliation.
- **Failure modes.** A cold sandbox; a partial listing; a handoff race.
- **Recovery.** Shrink-guard; union reconcile; guardian restore; asset
  re-materialization.
- **Observability.** Data-loss events logged (safe-recovered).
- **Scalability.** Overflow storage; streaming for large projects.
- **Security.** Per-user; redacted recall.
- **Performance.** Merge-not-replace; bounded restore.
- **Anchor.** `WorkspaceFileStore` + File Guardian + asset store. Laws: MEM-01..13.

## §21. Storage Layer · [LIVE] — *(the durable substrate: the truth that survives)*
- **Purpose.** Be the authoritative, durable record everything ephemeral is
  reconstructed from.
- **Responsibilities.** Persist the workspace file store; the user's GitHub archive
  (the real long-term archive); the diagnostics store; the wallet/cost ledger.
- **Inputs.** Durable writes from Memory, Observability, Billing.
- **Outputs.** The recoverable truth on demand.
- **Dependencies.** The underlying database + GitHub.
- **Interface.** durable read/write per store.
- **Ownership.** *It is* the source of truth (Volume 1 MEM-01, REL-03).
- **Failure modes.** A store write failure.
- **Recovery.** GitHub as the ultimate archive; idempotent, merge-safe writes.
- **Observability.** Store operations traceable.
- **Scalability.** Overflow + streaming for scale.
- **Security.** Per-user isolation; env values never stored in the repo.
- **Performance.** Bounded, indexed access.
- **Anchor.** `WorkspaceFileStore` + GitHub storage + `DiagnosticsStore` + wallet.
  Laws: MEM-01/13, REL-03, DEPLOY-05.

## §22. Communication Layer · [LIVE]
- **Purpose.** One event bus that carries all inter-role and engine→user
  communication, making the build observable and auditable.
- **Responsibilities.** Stream typed events (narration/tool_call/tool_result/event/
  done); brand + anonymize user-facing narration; carry evidence with every claim.
- **Inputs.** Events emitted by every role.
- **Outputs.** A live stream to the client + the recorded timeline.
- **Dependencies.** Observability (recording), Security (redaction/anonymization).
- **Interface.** emit(event) / subscribe.
- **Ownership.** Owns the message format; there is no separate inter-agent protocol to
  drift.
- **Failure modes.** A dropped or mis-branded event.
- **Recovery.** Best-effort emit never breaks a build; the durable timeline replays.
- **Observability.** The bus *is* the observable surface.
- **Scalability.** One stream, bounded payloads.
- **Security.** Redacted + vendor-anonymized on user surfaces.
- **Performance.** Streaming, non-blocking.
- **Anchor.** `AgentEventStream` + session timeline. Laws: LOG-08, PROV-01, TRUST-08.

## §23. Configuration Layer · [LIVE]
- **Purpose.** Govern behavior by environment configuration so every risky subsystem
  has an instant, no-deploy off-switch.
- **Responsibilities.** Read per-request env flags (never boot-cached where a kill
  switch is needed); default safely when config is absent; keep the env-key registry
  (names only, never values).
- **Inputs.** Environment variables.
- **Outputs.** Behavior toggles + model/rate config.
- **Dependencies.** The deploy environment.
- **Interface.** flag reads at call sites.
- **Ownership.** Owns reversibility (Volume 1 ARCH-06/07, §24).
- **Failure modes.** A misconfigured or missing key.
- **Recovery.** Flag-off equals prior behavior byte-for-byte; missing optional config
  degrades cleanly, never crashes.
- **Observability.** Effective config reflected in the build report.
- **Scalability.** Config, not code, tunes behavior across all builds.
- **Security.** Values live only in Cloud Run, never the repo; names in the registry.
- **Performance.** A flag read is trivial.
- **Anchor.** `AGENTV3_*` flags + env registry (CLAUDE.md). Laws: ARCH-06/07, DEPLOY-05/06.

## §24. Feature Registry · [LIVE]
- **Purpose.** Be the single source of truth for what NavBharatAI can do, so every AI
  answers "where/how" with exact navigation, not guesses.
- **Responsibilities.** Register every user-facing feature (path, description,
  how-to, keywords, owning AI); stay in sync as features ship.
- **Inputs.** New user-facing capabilities.
- **Outputs.** Navigation + capability answers to every AI.
- **Dependencies.** Knowledge Layer (§7).
- **Interface.** lookup by intent/keyword.
- **Ownership.** Owns app self-awareness.
- **Failure modes.** An unregistered feature — invisible to every AI.
- **Recovery.** The sync rule: register in the same change that ships the feature.
- **Observability.** Capability coverage.
- **Scalability.** Indexed lookup.
- **Security.** No secrets.
- **Performance.** Bounded lookup.
- **Anchor.** `AppKnowledgeBase`. Laws: QA-13, DOC-07.

## §25. Dependency Graph Engine · [LIVE]
- **Purpose.** Understand and repair the project's dependency and import graph so the
  app resolves and installs.
- **Responsibilities.** Analyze import/export edges; detect missing/mismatched/wrong-
  source imports; reconcile well-known missing packages into package.json (pre-flight
  + at readiness); detect dependency version conflicts.
- **Inputs.** The file set + package.json.
- **Outputs.** A resolvable import graph + an installable dependency set + findings.
- **Dependencies.** Repository Intelligence, Semantic Editing.
- **Interface.** analyze → reconcile/fix.
- **Ownership.** Owns graph integrity.
- **Failure modes.** A dangling import; a missing package; a version conflict.
- **Recovery.** Deterministic import fixers; curated dep allowlist auto-add; conflict
  flagged.
- **Observability.** Findings + fixes recorded.
- **Scalability.** Graph analysis bounded to source files.
- **Security.** Only allowlisted deps auto-added; never a guessed package.
- **Performance.** Deterministic, pre-model.
- **Anchor.** import/export analyzers + `DependencyAutoFix` + import fixers. Laws:
  EDIT-06/08/11, VERIFY-09.

## §26. Prompt Processing Pipeline · [LIVE]
- **Purpose.** Shape what reaches a model so it is correct, bounded, and cost-efficient
  — without ever losing the true record.
- **Responsibilities.** Compact the transcript sent to the model (recent verbatim, old
  large tool-results trimmed); apply the cheap-floor prompt diet (per-block trim);
  size-gate routing; keep the full transcript for persistence and the next turn.
- **Inputs.** The growing transcript + the target provider.
- **Outputs.** A bounded model payload; the untouched full record.
- **Dependencies.** Provider Fabric.
- **Interface.** compact/diet before runTurn.
- **Ownership.** Owns the model-payload shape; not the content's truth.
- **Failure modes.** An oversized prompt timing out a cheap provider.
- **Recovery.** Diet + compaction; the backstop always gets full context when needed.
- **Observability.** Prompt sizes visible in llm-call records.
- **Scalability.** Bounds a growing transcript for arbitrarily long builds.
- **Security.** Redaction applies to displayed/logged content.
- **Performance.** Smaller prompts = faster, cheaper turns.
- **Anchor.** transcript compaction + `capMessageContentForCheapFloor` + size-gate.
  Laws: PERF-05, ARCH-08.

## §27. Execution Scheduler · [LIVE]
- **Purpose.** Sequence the build's work correctly and efficiently — serialize what
  must be ordered, parallelize what is independent, bound everything.
- **Responsibilities.** Run mutating tools serially and first; run independent
  reads/reviews in a concurrency-capped parallel group; enforce per-turn/tool
  timeouts and step budgets; keep git checkpoints off the hot path (single-flight,
  coalescing).
- **Inputs.** The set of tool calls a turn requests.
- **Outputs.** Ordered, bounded, race-free execution.
- **Dependencies.** Core Execution, Capabilities.
- **Interface.** dispatch(serial|parallel) with budgets.
- **Ownership.** Owns control-flow ordering + concurrency safety.
- **Failure modes.** A race on shared state; a stuck tool blocking a turn.
- **Recovery.** Serialized mutations; single-flight checkpoints; per-tool timeout →
  is_error, loop continues.
- **Observability.** Timings recorded per tool.
- **Scalability.** Concurrency cap tuned to cores.
- **Security.** —
- **Performance.** "Find in parallel, fix serially"; git off the hot path.
- **Anchor.** dispatch loop in `AgentRunner` + checkpoint scheduler. Laws: PERF-08/09,
  REL-11, ARCH-08.

## §28. Artifact Management · [LIVE]
- **Purpose.** Manage everything a build produces — source files, binary assets,
  previews, reports, and store releases.
- **Responsibilities.** Persist source to the durable store + GitHub; keep binary
  assets in a durable asset store and re-materialize them on restore; publish
  previews; produce the diagnostics artifact; build signed store releases on phase
  boundaries.
- **Inputs.** Build outputs.
- **Outputs.** Durable, restorable, shippable artifacts.
- **Dependencies.** Storage, Runtime, Deployment.
- **Interface.** persist/publish/materialize.
- **Ownership.** Owns artifact lifecycle.
- **Failure modes.** A lost binary; a stale release.
- **Recovery.** Asset re-materialization; GitHub as archive; release rebuilt on phase
  completion.
- **Observability.** Artifacts traceable to their build.
- **Scalability.** Overflow storage; batched releases.
- **Security.** Signing stays admin-only; no unsigned release faked.
- **Performance.** Data-URI assets; bounded restore.
- **Anchor.** file store + asset store + `ReactPreview` + `BuildDiagnostics` + `.aab`
  workflow. Laws: MEM-07, DEPLOY-07/08/09.

## §29. Error Recovery Architecture · [LIVE]
- **Purpose.** Guarantee that any failure preserves work, converges to a correct
  state, and keeps the never-break promise.
- **Responsibilities.** Salvage timed-out work and hand it forward; kill zombie
  stages; resume past a step cap; restore a recycled sandbox; run deterministic-then-
  bounded endgame repair; self-heal documented tool failures; keep every recovery
  idempotent.
- **Inputs.** A failure signal + the durable substrate.
- **Outputs.** Preserved work + a converged state, or an honest safe stop.
- **Dependencies.** Memory, Provider Fabric, Verification.
- **Interface.** recover(failure).
- **Ownership.** Owns failure→recovery transitions.
- **Failure modes.** Lost work; a corrupted or doubled recovery.
- **Recovery.** *It is* the recovery architecture; all actions idempotent and honest.
- **Observability.** Recoveries recorded honestly.
- **Scalability.** Recovers builds of any size (guardian, overflow).
- **Security.** No secret leak in recovery messages.
- **Performance.** Deterministic repair before model repair.
- **Anchor.** salvage + guardian + step-resume + `EndgameRepair` + prisma-heal. Laws:
  RECOV-01..13, REL-03/12.

---

# Part III — Cross-Cutting Strategy

## §30. Extensibility Architecture · [LIVE]
New capability enters by **addition, behind a flag**, never by mutating the proven
path (Volume 1 ARCH-05). A new gate/runner/guard is prepended/appended to an existing
chain; a snapshot test proves flag-off equals the prior behavior byte-for-byte. This
is the real extensibility model — safe, reversible, and non-regressive by
construction. *Anchor:* the additive chain pattern + `AGENTV3_*` flags.

## §31. Plugin Architecture · [ASPIRATIONAL] (partial)
The engine has **plugin-shaped seams** today — the tool catalog (tools are registered
entries), the provider chain (runners are pluggable `NamedRunner`s), and the framework
templates (each a provider implementing one interface). A *formal, third-party* plugin
system does not exist and is not currently needed; if built, it must inherit the
Extensibility rules (§30) — additive, flag-gated, sandboxed, verified. Marked
aspirational so it is never assumed to exist.

## §32. Versioning Strategy · [LIVE]
The **engine** versions through git (branch → PR → CI → merge); production is always
one revert from a known-good state. **Model ids** version through a newest→older
ladder that tolerates a retired id, adopted deliberately (a code-default bump after a
bake-off), never blind auto-latest. **This constitution** versions as numbered volumes,
amended only by admin-signed PRs. Store releases auto-increment their version code per
signed build. *Anchor:* git + `parseModelLadder` + the `.aab` workflow. Laws: PROV-09/10,
DEPLOY-03.

## §33. State Management Strategy · [LIVE]
State is partitioned by durability: **ephemeral** (the sandbox, an in-flight
transcript) is never authoritative; **durable** (the file store, GitHub, diagnostics,
wallet) is the truth; **process-shared** (the rate-limit cooldown registry) is a
singleton, reset between tests. The invariant: reconstruct the ephemeral from the
durable on any interruption, and never let a partial ephemeral view overwrite durable
truth. *Anchor:* store + guardian + shared cooldown singleton. Laws: ARCH-11, MEM-01/02,
REL-11.

## §34. Data Flow Architecture · [LIVE]
Data flows **request → plan → workspace → verification → delivery**, with the durable
store as the hub every stage reads truth from and writes truth to. A build never
passes files agent-to-agent as messages (which would drift); it passes them through
the **shared workspace** (one authoritative copy). Cost/usage data flows into the
wallet ledger idempotently. See §41 for the full traced flow. Laws: MEM-01, ARCH-11.

## §35. Control Flow Architecture · [LIVE]
Control flows as a **bounded lifecycle DAG** (understand → build → verify → audit →
decide → ship), never a cyclic wait. Within the build phase, the Architect's tool loop
is the single control locus; escalation is **vertical** (a stronger model retries the
same coherent build), never a horizontal relay. Every loop, gate, and call is bounded
(no infinite control). A step-cap pauses-and-resumes rather than spinning; a stalled
turn stops honestly. See §42 for the traced lifecycle. Laws: ARCH-08, PLAN-02, RECOV-04.

## §36. Failure Isolation Strategy · [LIVE]
Failures are isolated by the layering (§3): a fault degrades to a lower-layer fallback
or surfaces upward as a bounded, honest error — never an unbounded cross-layer cascade.
Concretely: a provider fault is absorbed by the fabric's fallback chain; a sandbox
recycle is absorbed by the guardian; a diagnostics fault fails open (never breaks a
build); a gate fault fails closed (never passes unverified). One user's failure never
affects another (per-user isolation). Laws: ARCH-10, REL-06/10, SEC-07.

## §37. Scalability Strategy · [LIVE]/[ASPIRATIONAL]
Quality must not degrade with size (Volume 0 §21): bounded listings, content
retrieval, streaming, and overflow storage handle large repos; adaptive step budgets
scale effort to complexity; concurrency caps bound parallel work; key pools scale
provider throughput. **Open:** full-stack multi-service parity (the layout-contract
subsystem) and bulk restore of 20–30k-file projects are `[ASPIRATIONAL]` — the honest
scaling frontier, tracked until closed. Laws: REL-08, MEM-10, PERF-10.

## §38. Reliability Strategy · [LIVE]
Reliability rests on four structural guarantees: **durable truth** (no data loss),
**bounded everything** (no hangs), **a permanent backstop** (no vendor outage breaks a
build), and **idempotent recovery** (no corrupted/doubled state). It is proven by
telemetry (gate-pass rate, failure counts, recurrence rate), never asserted. The one
absolute rule — never break — is the reliability ceiling everything else serves. Laws:
REL-01..14, ARCH-13.

## §39. Performance Strategy · [LIVE]
Performance is won by **removing waste**, never by cutting a corner: cooldowns stop
provider hammering, the prompt diet shrinks payloads, incremental tsc gives fast honest
feedback, deterministic fixes avoid model round-trips, git stays off the hot path, and
independent work parallelizes. Speed is never bought by skipping a gate or faking a
result. Laws: PERF-01..12.

## §40. Architectural Anti-Patterns (forbidden by construction)
The architecture **structurally forbids** these — each maps to an enforced law:

- **The 30-vendor relay** — splitting one app across independent per-task agents
  (PLAN-02, §17). *Forbidden: coherence over federation.*
- **Ephemeral-as-truth** — trusting the sandbox as authoritative (ARCH-11, MEM-01).
- **Self-approval** — a builder verifying its own output (VERIFY-02).
- **Silent failure / silent degradation** — a swallowed error or an unannounced drop
  (REL-02, TRUTH-09).
- **The unbounded operation** — a loop/call with no cap (ARCH-08).
- **The un-reversible change** — a risky subsystem with no kill switch (ARCH-06).
- **The sprinkled cross-cutting rule** — redaction/anonymization/no-Claude applied
  per-site instead of at a choke point (ARCH-12).
- **Provider leakage** — a vendor name on a user surface (PROV-01).
- **The surface patch** — hiding a symptom instead of fixing the class (§36 forbidden
  behaviors).
- **Duplicated truth** — the same fact defined in two places, free to drift (ARCH-02,
  DOC-03).

---

# Part IV — Lifecycle Flows (the diagrams, described in text)

## §41. Data Flow
`request → [Planning: plan + contract] → [Shared Workspace ⇄ Durable Store] →
[Generation writes files → Workspace] → [Verification reads full map + preview] →
[QA/Security audit] → [Readiness decision] → [Delivery: app + honest bill] `.
The **Durable Store is the hub**: every stage reads truth from and writes truth to it;
files never travel agent-to-agent as messages. Cost flows into the wallet
idempotently; diagnostics flow into the observability store throughout.

## §42. Request Lifecycle (control flow)
`P0 Intake+Classify → P1 Provision (workspace, scaffold, guardian restore) →
P2 Plan+Contract → P3 Generate (fast-lane → salvage → full builder → sub-agents) →
P4 Deterministic Repair (endgame: import/dep/tsc fixers) → P5 Verify (type, static,
syntax, runtime readiness) → P6 Audit+Heal (integrity, security, reviewer,
feature-presence) → P7 Readiness Decision (the barrier: go/no-go, honest verdict) →
P8 Deliver+Bill (working app or honest failure; real bill or free)`.
Each phase has an **entry condition** (the prior phase's success) and a **failure
transition** (salvage / resume / repair / honest stop). P7 is a **hard barrier** —
delivery cannot occur without a verified verdict.

## §43. Artifact Lifecycle
`generated → written to Workspace → persisted to Durable Store + GitHub → (binary
assets → asset store) → published as preview → recorded in diagnostics → (on phase
completion) built into a signed store release`. On any sandbox recycle, artifacts are
re-materialized from the durable store; GitHub is the ultimate archive.

## §44. Repository Lifecycle
`(new) scaffold ensured → files written → durable-store + GitHub saved` OR
`(import) clone → land (durable store, framework lock, memory index, preview boot) →
edit mode`. Every turn begins with a **guardian reconcile** (restore missing files),
so the repository is always the true project before any edit.

## §45. Memory Lifecycle
`write → merge into durable store (shrink-guarded) → sandbox cache updated →
(recycle) guardian restores from store (union, never subtract) → assets
re-materialized → history replayed on reopen`. Durable truth is never overwritten by
a smaller ephemeral view without explicit consent.

## §46. Failure Recovery Flow
`failure signal → classify (timeout / step-cap / provider / sandbox / tool / schema)
→ preserve work (salvage) → converge (guardian restore / step-resume / endgame repair
/ documented self-heal) → re-verify → (success) continue OR (unrecoverable-here)
honest stop + open-root record`. Every step is idempotent; nothing is discarded,
doubled, or faked.

## §47. Provider Routing Flow
`turn request → select chain by tier/mode (routing policy) → try cheap floor →
(429 per-key) rotate key / (service overload/timeout) pool-bench + fall through →
… → permanent backstop (weak tier: Haiku-only) → attribute the real model →
anonymize vendor upward`. A saturated provider auto-recovers after cooldown; a retired
id falls through the ladder; a fatal auth error is dead-for-run. The user sees only
"NavBharatAI".

---

# Closing

This blueprint is the permanent reference structure of NavBharatAI: **five bands, a
downward-only layering, few coherent agents over many deterministic gates and
services, and a durable substrate that makes the ephemeral disposable.** Its power is
not in how many subsystems it has, but in what it makes *structurally impossible* —
lost data, self-approval, silent failure, vendor leakage, unbounded cascade — each
forbidden by construction and anchored to an enforced law.

Where a subsystem is `[ASPIRATIONAL]` (a formal plugin system, full-stack layout
parity, bulk large-repo restore, app-runtime API/DB/a11y/perf auditing), closing its
gap is mandated work under the Learning and Continuous-Improvement layers, tracked
honestly until `[LIVE]` — never drawn as if already built.

Every future implementation must fit this structure; every later Constitution volume
inherits it. When a structural choice is unclear, resolve by the layering and the
anti-patterns above; when it is genuinely dangerous, the human admin decides; and in
every tie, the Prime Law governs — **truth is the product, trust is the treasure.**

---

*Volume 3 of the NavBharatAI Build Engine Constitution. Descriptive-first and
code-anchored; inherits Volumes 0–2; amendments follow the engine's own discipline
(branch → PR → CI green → merge).*

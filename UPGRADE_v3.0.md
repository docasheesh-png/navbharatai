# NavBharatAI Pro — UPGRADE v3.0 (Rock-Solid Architecture)
## Goal: World No. 1 AI App Maker — Enterprise-Grade, Break-Proof Foundation

> This roadmap is the result of a full architecture audit (200 enterprise components + 30 core
> principles) run on 2026-06-27. It captures **only what is PARTIAL or MISSING** and orders it by
> priority. After this roadmap is complete, the architecture must be **rock-solid** — no core-law
> violations, no untested paths, full observability, and forward/backward compatible.

---

## 🔒 PERMANENT CORE LAWS (never remove, apply to every phase)
- **App break nahi honi chahiye** — app must NEVER break (this is why P0 test suite exists).
- World-best AI + app maker banana.
- **Phase complete hone ke baad deploy bhi kar diya karo** (push to `main` → Cloud Build → Cloud Run).
- Real API keys NEVER in `.env.example`. `ADMIN_PASSWORD` only in Cloud Run console.
- `min-instances=0` must stay (budget constraint).
- Admin credentials NEVER hardcoded in source.
- **ALL UI/frontend code 100% English** — no Hindi/Hinglish in buttons/labels/placeholders/errors.
  (Internal docs like this file may be Hinglish; shipped UI may not.)

### Three Universe Isolation (PERMANENT — never share state)
- **FREE** (navbharat): Vertex → Gemini → Grok. **Claude NEVER used.**  ✅ implemented
- **PROFESSIONAL** (Doctor AI/SDA + Teacher, Lawyer, CA, Astrologer, Kisan, … — the whole
  Professionals universe): **RACE Grok × Gemini × Vertex** (concurrent; first success wins) →
  **Claude Haiku ONLY** if all three fail (last resort). ✅ implemented (2026-06-28, P0.1 —
  isolated `professional` namespace + `AIRouter.routeRaced` in `AIRouterManager`).
- **PRO** (build + plan): Claude → Grok → Gemini → Vertex (Claude primary).  ✅ implemented

---

## 📊 STATUS SNAPSHOT (audit baseline)
- ✅ HAVE (strong, real): ~62% (architecture) · ~30% (infrastructure) · **~55% (AI intelligence)**
- 🟡 PARTIAL (works but incomplete): ~23%
- ❌ MISSING (not present): ~15% (architecture) · ~25% (infrastructure)
- **AI Intelligence audit (2026-06-28, 300 components):** 164 ✅ DONE · 69 🟡 PARTIAL · 67 ❌ MISSING → 136 gaps tracked in **P11**.
- **0 core-law violations open** — the last one (professional isolated router, P0.1) was
  closed on 2026-06-28.

> **2026-06-27 CORRECTION:** A deeper infra scan (`tests/`, `AgentV3/`, `infra/e2b/`,
> `.github/workflows/`) found that several items first marked MISSING are in fact **already
> done**. These are now ticked below. The original P0.2 "no test suite" finding was WRONG —
> there are **293 test files + Vitest + GitHub Actions CI gate**. Corrected items: P0.2 (tests + CI
> gate), P1.2 (migration), P4.3 (AST). The architecture base is stronger than first reported;
> the real remaining work is now mostly the **INFRASTRUCTURE LAYER (P6–P10)** appended at the end.

**Status Legend:** ⏳ Pending | 🔄 In Progress | ✅ Complete | ⏸️ Paused | ⬜ N/A-by-design

---

## PRIORITY TRACKER

| Phase | Name | Why | Status | % |
|-------|------|-----|--------|---|
| P0 | Core-Law Violations | Breaks your own permanent rules | ✅ Complete | 100% |
| P1 | Break-Proof Foundation | "App break nahi honi chahiye" guarantee | 🔄 In Progress | 50% |
| P2 | Resilience & Observability | See + survive failures | ⏳ Pending | 0% |
| P3 | Scale & Frontend Health | Grow without rewrites | ⏳ Pending | 0% |
| P4 | Advanced Enterprise Patterns | True enterprise depth | 🔄 In Progress | 25% |
| P5 | Hygiene & Hardening | Remove rot, close small holes | ⏳ Pending | 0% |
| **P6** | **IaC & Provisioning** | Reproducible, version-controlled infra | ⏳ Pending | 0% |
| **P7** | **Async Infra (Queue/Cache)** | Scale beyond Firestore-polling | ⏳ Pending | 0% |
| **P8** | **Observability Infra** | Tracing + alerting + SLO | ⏳ Pending | 0% |
| **P9** | **Zero-Downtime & DR** | Canary/blue-green + cross-region | ⏳ Pending | 0% |
| **P10** | **Edge & Hardening Infra** | CDN, KMS, chaos/load testing | ⏳ Pending | 0% |
| **P11** | **AI Intelligence Layer** | Reasoning, RAG, vision, safety, eval depth | ⏳ Pending | 55% have |

---

## 🔴 PHASE P0 — CORE-LAW VIOLATIONS (do FIRST)
> These break rules you yourself set as permanent. Highest priority.

### P0.1 — PROFESSIONAL Universe Isolated Router Chain  ✅ DONE (2026-06-28)
- **Was:** Backend `src/server/AI/AIRouterManager.ts` only had FREE + PRO namespaces. The professional
  chain **Grok → Gemini → Vertex → Claude** (Grok primary, Claude last resort) did NOT exist as an
  isolated routing namespace. Worse, the generic config-driven professionals engine routed
  **Gemini → Claude → Grok** (Claude reached 2nd — a Grok-primary/Claude-last violation).
- **Scope (admin direction 2026-06-28):** isolate the WHOLE professional universe, not just SDA —
  Doctor AI/SDA **and** every config-driven professional (Teacher, Lawyer, CA, Astrologer, Kisan, … 70+)
  now share ONE isolated `professional` namespace.
- **Routing shape (admin spec 2026-06-28):** RACE Grok × Gemini × Vertex concurrently (first
  non-empty success wins); Claude **Haiku** is reached ONLY if all three racers fail (last resort).
- **Done:**
  - [x] Added a third namespace `professional` in `AIRouterManager.ts`: race participants Grok / Gemini / Vertex + Claude Haiku (`lastResort`).
  - [x] Added `AIRouter.routeRaced()` — concurrent `Promise.any` over non-last-resort providers, sequential last-resort fallback only on total race failure.
  - [x] Added `lastResort` flag to the `AIProvider` interface; Claude Haiku marked last-resort.
  - [x] Wired tier routing in `UniversalAIRouter.ts`: `sda` / `doctor` / `professional` tier → `professional` namespace; FREE never reaches Claude.
  - [x] `/api/sda-chat` (already isolated) uses `routeRaced` on the `professional` namespace for its text-only path; multimodal (image/PDF) keeps its inline Vertex/Claude safety net.
  - [x] `professionals/engine.ts` `resilientCall` now routes through the isolated `professional` namespace via `routeRaced` (replaced the Gemini→Claude→Grok inline chain) — fixes the Claude-2nd violation for all professionals.
  - [x] Added `AIRouter.getProviderChain()` read-only inspector for provable isolation.
  - [x] Test `tests/professionalRouter.test.ts` (8 tests) proves: race = Grok/Gemini/Vertex, Claude is the ONLY last-resort; race winner never touches Claude; Claude reached only when all racers fail; graceful failure when everything fails; PROFESSIONAL ≠ FREE ≠ PRO instances; FREE never includes Claude; PRO still Claude-first.
- **Verification:** `tsc --noEmit` ✅ · `tsc -p tsconfig.server.json` ✅ · `vitest run` 2702/2702 ✅ · build ✅ · boot smoke-check ✅
- **Files:** `src/server/AI/AIRouterManager.ts`, `src/server/AI/UniversalAIRouter.ts`, `src/server/AI/Router/AIRouter.ts`, `src/server/routes/sda.ts`, `src/server/professionals/engine.ts`, `tests/professionalRouter.test.ts`.

### P0.2 — Real Test Suite (the "break nahi honi chahiye" engine)  ✅ DONE (2026-06-27)
- **Was:** thought to be missing. **Reality:** **293 test files** + Vitest are present.
- **Done:**
  - [x] **Vitest** installed + `npm test` (`vitest run`) script in `package.json`.
  - [x] Critical-path coverage exists: `tests/aiRouterManager.test.ts`, `tests/routesBuildPro.test.ts`,
        `tests/reactPreview.test.ts`, `tests/previewBundle.test.ts`, `tests/authMiddleware.test.ts`,
        `tests/routesPaymentPreview.test.ts`, plus ~90 `AgentV3/*.test.ts`.
  - [x] **CI gate live:** `.github/workflows/ci.yml` runs typecheck → test → build → boot-check on every push.
- **Remaining:** add an explicit test step inside `cloudbuild.yaml` too (today the gate is GitHub Actions only,
  so a direct `gcloud builds submit` could bypass it). Small follow-up.
- **Files:** `package.json`, `tests/`, `.github/workflows/ci.yml`.

---

## 🟠 PHASE P1 — BREAK-PROOF FOUNDATION
> Forward/backward safety + the safety nets that stop silent breakage.

### P1.1 — API Versioning  ❌ MISSING
- [ ] Introduce `/api/v1/...` prefix (alias current routes; keep old paths as deprecated shims).
- [ ] Document the version contract in `AGENTS.md`.
- **Files:** `server.ts`.

### P1.2 — Data Migration System  ✅ DONE (2026-06-27)
- **Reality:** `src/server/project/ProjectMigrator.ts` exists (+ `tests/projectMigrator.test.ts`).
- **Remaining:** confirm a `_migrations` ledger collection + startup hook are wired; document the runbook.
- **Files:** `src/server/project/ProjectMigrator.ts`.

### P1.3 — Circuit Breaker  🟡 PARTIAL → full
- **Now:** only per-provider cooldown in `AIRouter.ts`. No real breaker (open/half-open/closed).
- [ ] Add a `CircuitBreaker` class per provider: trip after N consecutive failures, half-open probe, auto-close.
- [ ] Integrate into the router fallback path for all three universes.
- **Files:** new `src/server/AI/Router/CircuitBreaker.ts`, `AIRouter.ts`.

### P1.4 — Idempotency & Deterministic Jobs  🟡 PARTIAL
- [ ] Add idempotency keys to build-job creation (`BuildJobManager.ts`) so retries don't double-run.
- [ ] Ensure orchestrator steps are replay-safe.
- **Files:** `src/server/AppMakerLab/jobs/BuildJobManager.ts`, `generator/ExecutionOrchestrator.ts`.

---

## 🟡 PHASE P2 — RESILIENCE & OBSERVABILITY
> "Agar break ho to dikhe, aur recover ho."

### P2.1 — Distributed Tracing + Metrics  🟡 PARTIAL
- **Now:** `ObservabilityManager.ts` + `console.log` only. No spans, no external sink.
- [ ] Add OpenTelemetry tracing (request → provider → job spans) exported to Cloud Trace.
- [ ] Emit metrics (latency, error rate, token spend) to Cloud Monitoring.
- **Files:** `src/server/ObservabilityManager.ts`, `server.ts`, `AIRouter.ts`.

### P2.2 — Error Tracking (external)  ❌ MISSING
- [ ] Wire Sentry (or Cloud Error Reporting) on both backend (`server.ts`) and frontend (`main.tsx`).
- **Files:** `server.ts`, `src/main.tsx`.

### P2.3 — Bulkhead Isolation  🟡 PARTIAL
- [ ] Separate in-flight pools per universe so a FREE-tier spike can't starve PRO/SDA.
- **Files:** `AIRouter.ts`.

### P2.4 — Disaster Recovery / Backup  ❌ MISSING
- [ ] Scheduled Firestore export (backup) + a documented restore runbook.
- [ ] Health/readiness probe wired into Cloud Run spec.
- **Files:** `cloudbuild.yaml`, new `docs/DR_RUNBOOK.md`.

---

## 🟢 PHASE P3 — SCALE & FRONTEND HEALTH

### P3.1 — Split the `App.tsx` God Component  🟡 PARTIAL (9,156 lines)
- **Problem:** Violates SRP/SoC — state + chat + files + preview + payment + routing in one file.
- [ ] Extract into context providers + hooks: `PreviewProvider`, `ChatProvider`, `PaymentProvider`,
      `FilesProvider`, plus `usePreviewBundler`, `useProBuild` hooks.
- [ ] Target: `App.tsx` < 1,500 lines, no behavior change.
- **Files:** `src/App.tsx` → `src/contexts/`, `src/hooks/`.

### P3.2 — Offline-First Runtime  🟡 PARTIAL
- [ ] Service worker: cache dynamic API responses + queue writes for replay on reconnect.
- **Files:** `public/sw.js`, `src/lib/storage.ts`.

### P3.3 — Scalability / HA  🟡 PARTIAL
- [ ] Keep `min-instances=0` (budget), but add a lightweight keep-warm ping for PRO/SDA endpoints.
- [ ] Evaluate multi-region readiness (config only; no spend until needed).
- **Files:** `cloudbuild.yaml`.

### P3.4 — Real CDN / Edge Caching  ❌ MISSING
- [ ] Front static assets with a CDN (Cloudflare / Cloud CDN) instead of browser cache only.
- **Files:** infra config, `server.ts` cache headers.

---

## 🔵 PHASE P4 — ADVANCED ENTERPRISE PATTERNS
> Depth that makes it genuinely "enterprise", not just functional.

### P4.1 — CQRS  ❌ MISSING
- [ ] Separate command (write) and query (read) paths for workspace/build operations.
- **Files:** `src/server/AppMakerLab/`.

### P4.2 — Event Sourcing + Replay  ❌ MISSING (history store exists, replay doesn't)
- [ ] Make `EventHistoryStore` replayable to rebuild workspace state from the event log.
- **Files:** `src/server/AppMakerLab/eventbus/EventHistoryStore.ts`.

### P4.3 — Full AST (replace regex code model)  ✅ MOSTLY DONE (2026-06-27)
- **Reality:** `ts-morph` (real TS AST) is a dependency and used by `AgentV3/ASTAnalyzer.ts` (+test).
- **Remaining:** point the older `Memory/MemoryIndexer.ts` regex path at the AST analyzer too (consolidate).
- **Files:** `src/server/AgentV3/ASTAnalyzer.ts`, `src/server/Memory/MemoryIndexer.ts`.

### P4.4 — Replication / Consistency guarantees  ❌ MISSING
- [ ] Document and enforce consistency model for cross-device sync (currently newer-wins only).
- **Files:** `server.ts` sync routes, `src/App.tsx` sync logic.

---

## ⚪ PHASE P5 — HYGIENE & HARDENING

### P5.1 — Remove hardcoded Firebase key fallback  🟡 PARTIAL
- [ ] `src/config/firebase.ts:9` — drop the hardcoded fallback API key; env-var only.
- **Files:** `src/config/firebase.ts`.

### P5.2 — Monorepo tooling  🟡 PARTIAL
- [ ] Adopt pnpm workspaces / Turborepo so `remote-keyboard/` (Android) and web build are isolated.
- **Files:** root config.

### P5.3 — Delete throwaway scripts & junk files
- [ ] Remove root junk: `open.txt`, `close.txt`, `div_open.txt`, `another-file.txt`, etc.
- [ ] Remove ad-hoc `*_test.ts` once replaced by Vitest (P0.2).
- **Files:** repo root, `src/server/`.

---

---

# 🏗️ INFRASTRUCTURE LAYER (P6–P10)
> From the 280-component infrastructure audit (2026-06-27). Architecture base is solid; these are
> the deployment/runtime infra gaps that remain. **Note:** this stack is **managed-serverless**
> (Cloud Run + Firestore + E2B/Docker sandbox), so low-level infra (bare metal, Kubernetes, SAN/NAS,
> hypervisor, etcd, BGP, GPU/TPU cluster) is **⬜ N/A by design** — Cloud Run abstracts it. Those are
> intentionally NOT in this roadmap. Only real, applicable gaps are below, priority-ordered.

### ✅ Infra ALREADY DONE (do not redo)
- Cloud Run gen2 + Docker; GCR image registry; CI (`ci.yml`) + CD (`deploy.yml`, `cloudbuild.yaml`).
- **Sandbox / secure execution:** E2B + Docker actuators (`EngineerAI/actuators/E2BActuator.ts`, `DockerActuator.ts`), `infra/e2b/`.
- Multi-cloud **deploy targets:** `VercelProvider.ts`, `NetlifyProvider.ts`, `DeployProviders.ts`.
- Auth/IAM/OAuth/session; `helmet` security headers; AES-256 secrets; rate limiter; `/api/health`.
- Firestore + compound indexes; checkpoint/snapshot backup; in-process event bus; immutable-revision rollback.
- 293 tests + Vitest; `xterm` terminal; `ts-morph` AST; `lighthouse` perf; SSE streaming.

---

## 🟣 PHASE P6 — IaC & PROVISIONING  ❌ MISSING
> Today infra lives in `cloudbuild.yaml` CLI flags — not reproducible, not reviewable as code.
- [ ] **Terraform** (or Pulumi) for Cloud Run service, Firestore, IAM, secrets, indexes — one `terraform apply` rebuilds prod.
- [ ] Move Cloud Run flags (cpu/mem/min/max/concurrency) into versioned IaC, not inline args.
- [ ] **Policy as Code** — guardrails (no public buckets, required labels) via Terraform/OPA.
- **Acceptance:** prod infra reproducible from code; drift detectable.
- **Files:** new `infra/terraform/`.

## 🟣 PHASE P7 — ASYNC INFRA (Queue + Cache)  ❌ MISSING
> Build jobs currently run on Firestore writes + client polling — won't scale and wastes reads.
- [ ] **Job queue:** Cloud Tasks (or Redis + BullMQ) for build jobs; replace polling with queue workers.
- [ ] **Distributed cache:** Redis (Memorystore) for sessions, provider-cooldown state, hot reads.
- [ ] **Rate-limit store:** move `express-rate-limit` to Redis so limits hold across instances.
- **Acceptance:** build jobs survive instance restarts; rate limits are global, not per-instance.
- **Files:** `server.ts`, `src/server/AppMakerLab/jobs/`, `AIRouter.ts`.

## 🟣 PHASE P8 — OBSERVABILITY INFRA  🟡 PARTIAL → full
> Logs + basic metrics exist; tracing + alerting do not. Failures are visible only after-the-fact.
- [ ] **Distributed tracing:** OpenTelemetry spans (request → provider → job) → Cloud Trace.
- [ ] **Error tracking:** Sentry / Cloud Error Reporting on backend (`server.ts`) + frontend (`main.tsx`).
- [ ] **Alerting + SLO:** Cloud Monitoring alert rules (error rate, p95 latency, token-spend spike).
- [ ] **Incident runbook** + on-call notes.
- **Acceptance:** a prod error pages someone; a trace shows the full request path.
- **Files:** `server.ts`, `src/main.tsx`, `src/server/ObservabilityManager.ts`, new `docs/RUNBOOK.md`.

## 🟣 PHASE P9 — ZERO-DOWNTIME & DR  ❌ MISSING
> Cloud Run swaps revisions (≈ rolling), but no controlled canary and no disaster recovery.
- [ ] **Canary / Blue-Green:** split traffic to new Cloud Run revision (e.g. 10% → 100%) with auto-rollback on error spike.
- [ ] **Scheduled Firestore backup** (export) + documented **restore** runbook (DR).
- [ ] **Cross-region readiness** (config only; keep cost at zero until needed — respects `min-instances=0` law).
- [ ] Wire Cloud Run **readiness/liveness probes** explicitly.
- **Acceptance:** a bad deploy auto-rolls-back; data is restorable from backup.
- **Files:** `cloudbuild.yaml`, `deploy.yml`, new `docs/DR_RUNBOOK.md`.

## 🟣 PHASE P10 — EDGE & HARDENING INFRA  🟡 PARTIAL / ❌ MISSING
- [ ] **Real CDN / edge cache** (Cloudflare or Cloud CDN) in front of static assets — not just browser `Cache-Control`.
- [ ] **KMS:** move encryption keys + secrets to Cloud KMS / Secret Manager (off env-var fallbacks).
- [ ] **WAF / DDoS:** Cloud Armor in front of Cloud Run (currently only app-level `helmet` + path blocking).
- [ ] **Chaos + load testing:** k6/Locust load tests + a basic fault-injection check in CI.
- **Acceptance:** static assets edge-cached; keys in KMS; a load test runs in CI.
- **Files:** infra config, `server.ts`, `.github/workflows/`.

---

---

# 🧠 AI INTELLIGENCE LAYER (P11)
> From a 300-component AI-Intelligence audit (2026-06-28). Each item was scanned against the real
> codebase and classified ✅ DONE (rock-solid — not listed here) / 🟡 PARTIAL (exists but shallow,
> upgrade it) / ❌ MISSING (build it). **Result: 164 DONE · 69 PARTIAL · 67 MISSING.** Only the 136
> PARTIAL + MISSING gaps are tracked below, grouped by sub-pillar. Legend: 🟡 = upgrade · ❌ = build.

### ✅ AI Intelligence ALREADY DONE (do not rebuild — 164 components)
The agent/intelligence base is far stronger than first assumed. Already real & wired, e.g.:
- **Agent runtime & multi-agent:** `AgentV3/AgentRunner`, `AgentRegistry` (8+ roles, 6 layers), `SubAgent`,
  `ToolDispatcher`, `AgentLifecycle`, `ReviewerAgent`, delegation via task tool.
- **Reflection / confidence / learning:** `Reflection`, `KnowledgeEvolution`, `BuildConfidence`
  (calibrated 0–100), `Consensus` (expert panel), `EscalationOrchestrator` (cheap→expensive).
- **Memory & RAG:** `WorkspaceMemory` (episodic + semantic ProjectGraph), `EmbeddingSearch`,
  `ContextRetriever`, `Memory/ProjectMemoryManager`, `AppContext/AppKnowledgeBase`.
- **Code intelligence:** `ASTAnalyzer` (ts-morph), `ArchitectureAnalysis`, `AppMakerLab/intelligence/*`
  (RepositoryIntelligenceEngine, GraphGenerator, ImpactAnalyzer), `autorepair/*` (RootCauseAnalyzer,
  RepairPlanner), `AutoFix`, framework/language/runtime detection.
- **Tool / automation / model routing:** Gemini/OpenAI tool runners, Git/Deploy/Browser/Terminal tools,
  `AIRouterManager` (3 isolated universes) + `AIRouter.routeRaced`, `HealthRegistry`.
- **Safety / governance / eval:** `SecretRedactor`, `SecurityAnalysis`, `ComplianceAnalysis`,
  `UntrustedContent` (prompt-injection fencing), `CommandGovernance`, `Approvals` (human-in-the-loop),
  `QualityEvaluationEngine/*` (8 evaluators), `Readiness`, cost/token budgeting, `lib/audit`, `lib/metrics`.

---

## 🧩 P11.1 — Reasoning Engine  (10 🟡 · 11 ❌)
> Reasoning today is implicit inside LLM prompts. No explicit, testable reasoning modules.
- 🟡 #5 AI Decision Engine · #6 AI Reasoning Engine · #9 Logical Inference Engine · #10 Knowledge Reasoning Engine — only signal/heuristic patterns (`IntentClassifier`, `Reflection`); make them explicit, composable engines.
- 🟡 #22 Decision Tree Engine · #23 Policy Decision Engine · #24 Rule-Based Decision Engine — `CommandGovernance`/`PatternMatcher` are narrow; generalize into a reusable rules/policy layer.
- 🟡 #26 Optimization Engine · #30 State Machine Engine · #31 Finite State Machine — only lifecycle phase-tracking; add a real FSM/optimizer abstraction.
- ❌ #7 Symbolic Reasoning Engine · #8 Probabilistic Reasoning Engine · #25 Constraint Solver · #27 Multi-Objective Optimizer · #32 Behavior Tree Engine.
- ❌ #105 Temporal · #106 Causal · #107 Spatial · #108 Numerical · #110 Mathematical · #111 Scientific Reasoning.
- **Files:** new `src/server/AI/reasoning/`.

## 🧩 P11.2 — Planning & Multi-Agent  (7 🟡 · 2 ❌)
- 🟡 #13 Goal Planning · #14 HTN Planner · #21 Action Prioritization — `TaskScheduler`/`PlanningAgent` do dependency ordering, not true hierarchical/goal decomposition.
- 🟡 #39 Agent Communication Bus — `AgentEventStream` is one-way; add bidirectional agent messaging.
- 🟡 #46 Supervisor Agent · #50 Executor Agent · #51 Verifier Agent — roles exist but not as dedicated, isolated agents.
- ❌ #44 Capability Negotiation · #52 Critic Agent.
- **Files:** `src/server/AgentV3/AgentRegistry.ts`, new `src/server/AgentV3/planning/`.

## 🧩 P11.3 — Self-Reflection & Confidence  (2 🟡 · 1 ❌)
- 🟡 #56 Self-Consistency Engine — limited to lesson-level; extend to multi-sample output consistency.
- 🟡 #60 Uncertainty Estimator — confidence is a point estimate; add interval/distribution.
- ❌ #57 Hypothesis Generator.
- **Files:** `src/server/AgentV3/BuildConfidence.ts`, new `Hypothesis.ts`.

## 🧩 P11.4 — NLU / Dialogue / Conversation  (3 🟡 · 3 ❌)
- 🟡 #71 Dialogue Manager · #73 Conversation Planner — persistence exists, no turn-by-turn policy/forward planning.
- 🟡 #87 Ontology Manager — predefined enums only; build a real taxonomy/ontology.
- ❌ #67 Entity Recognition · #68 Slot Filling · #72 Dialogue Policy Engine.
- **Files:** new `src/server/AI/nlu/`.

## 🧩 P11.5 — Memory  (3 🟡)
- 🟡 #79 Procedural Memory — lessons stored, no reusable procedures/macros.
- 🟡 #83 Memory Compression — recent-N + truncation only; add summarization-based compaction.
- 🟡 #88 Fact Store — code-derived facts only; add a real fact/triple store.
- **Files:** `src/server/AgentV3/WorkspaceMemory.ts`.

## 🧩 P11.6 — RAG / Knowledge / Grounding / Fact-checking  (6 🟡 · 7 ❌)
- 🟡 #99 Fact Verification · #100 Truthfulness Evaluator · #102 Consistency Checker · #103 Conflict Resolver — shallow stubs (`verify_manager`, `ConflictDetector`); make real.
- 🟡 #117 Code Semantics Engine · #125 API Understanding — symbol extraction only; add semantic/API-signature reasoning.
- ❌ #92 Reranker · #93 Retriever Fusion · #96 Evidence Aggregator · #97 Evidence Ranking · #98 Citation Manager.
- ❌ #101 Hallucination Detection · #104 Knowledge Conflict Detection.
- **Files:** new `src/server/AI/rag/`, `src/server/AI/verify_manager.ts`.

## 🧩 P11.7 — Code & Program Intelligence  (1 🟡 · 3 ❌)
- 🟡 #114 Control Flow Analyzer — only import-cycle detection; add real CFG.
- ❌ #115 Data Flow Analyzer · #129 Code Completion Intelligence · #130 Refactoring Intelligence.
- **Files:** `src/server/AgentV3/ASTAnalyzer.ts`, new `codeintel/`.

## 🧩 P11.8 — Analysis & Diagnostics  (4 🟡 · 3 ❌)
- 🟡 #139 Dynamic Analysis · #151 Log Analysis · #152 Stack Trace Intelligence · #153 Terminal Output Interpreter — basic capture/pattern-match; add structured parsing + interpretation.
- ❌ #141 Performance Analysis Intelligence · #144 Regression Analysis · #146 Change Prediction.
- **Files:** `src/server/AgentV3/AutoFix.ts`, `src/server/project/ErrorPatternMatcher.ts`, new `diagnostics/`.

## 🧩 P11.9 — Vision / Multimodal  (4 🟡 · 10 ❌)
- 🟡 #154 Visual Intelligence Coordinator · #158 UI Understanding · #159 DOM Understanding · #169 Image Captioning — `visionDescribe`/`attachmentText` cover images/PDF text only.
- ❌ #160 Layout · #161 Design · #162 Diagram · #163 Flowchart · #164 Chart Understanding.
- ❌ #170 Multimodal Fusion · #171 Cross-Modal Alignment · #172 Speech · #173 Audio · #174 Video Understanding.
- **Files:** `src/server/lib/visionDescribe.ts`, new `src/server/AI/vision/`.

## 🧩 P11.10 — Tool & Database/Infra Intelligence  (5 🟡 · 8 ❌)
- 🟡 #179 Tool Scheduling · #183 API Invocation Planner — dispatch exists, no scheduling/planning layer.
- 🟡 #191 Infrastructure Intelligence · #192 Database Intelligence · #199 Cost Optimization Intelligence — scaffolding/templates only.
- ❌ #176 Tool Discovery · #178 Tool Invocation Planner.
- ❌ #193 Query Planner · #194 Schema Reasoner · #195 SQL Generation · #196 NoSQL Query · #197 Caching Intelligence · #198 Optimization Recommendation Engine.
- **Files:** `src/server/AgentV3/ToolDispatcher.ts`, new `src/server/AI/db/`.

## 🧩 P11.11 — Model Ensemble / Fusion  (2 🟡 · 3 ❌)
- 🟡 #205 Ensemble Coordinator · #210 Output Ranking — `Consensus` is panel-only; generalize ensemble + ranking.
- ❌ #206 Response Fusion Engine · #208 Voting Engine · #209 Arbitration Engine.
- **Files:** `src/server/AgentV3/Consensus.ts`, new `ensemble/`.

## 🧩 P11.12 — Safety / Moderation / Policy / Governance  (5 🟡 · 5 ❌)
- 🟡 #214 Policy Evaluator · #223 Policy Enforcement Coordinator — risk classification only; add enforcement.
- 🟡 #226 PII Detection · #230 Decision Trace Manager · #298 AI Reliability Manager — partial coverage; harden.
- ❌ #219 Jailbreak Detection · #220 Adversarial Input Detection · #221 Abuse Detection · #222 Content Moderation Intelligence · #297 AI Compliance Manager.
- **Files:** `src/server/AgentV3/{CommandGovernance,UntrustedContent}.ts`, new `src/server/AI/safety/`.

## 🧩 P11.13 — Personalization & Learning  (3 🟡 · 3 ❌)
- 🟡 #233 Recommendation Engine · #234 Ranking Engine · #237 Behavior Modeling — narrow/internal only.
- ❌ #235 Personalization Intelligence · #236 Preference Learning · #238 User Modeling.
- **Files:** new `src/server/AI/personalization/`.

## 🧩 P11.14 — Resilience / Scheduling / Estimation  (7 🟡 · 3 ❌)
- 🟡 #248 Retry Planner · #252 Scalability Intelligence · #256 Queue Intelligence · #257 Priority Management — basic caps/status, no smart scheduling.
- 🟡 #259 Progress Estimation · #261 Time Estimation · #266 Reliability Predictor — tracking only, no prediction.
- ❌ #255 Scheduling Intelligence · #260 Deadline Prediction · #265 Latency Predictor.
- **Files:** `src/server/AppMakerLab/jobs/BuildJobManager.ts`, new `scheduling/`.

## 🧩 P11.15 — Observability / Analytics / Evaluation  (5 🟡 · 2 ❌)
- 🟡 #268 Observability Intelligence · #269 Analytics Intelligence — `ObservabilityManager` is a stub; daily aggregates only.
- 🟡 #273 Regression Intelligence · #275 Capability Benchmarking · #277 Prompt Optimization Intelligence — partial.
- ❌ #270 Experimentation Intelligence · #271 A/B Evaluation Coordinator.
- **Files:** `src/server/ObservabilityManager.ts`, new `src/server/AI/eval/`.

## 🧩 P11.16 — Validation & Output Integrity  (2 🟡 · 3 ❌)
- 🟡 #285 Goal Tracking Engine · #289 Structured Output Validator — feature-match/architecture checks only.
- ❌ #286 Milestone Tracker · #290 Schema Validator · #291 Response Normalizer.
- **Files:** `src/server/project/ProjectVerifier.ts`, new `src/server/AI/validation/`.

---

## ✅ DEFINITION OF "ROCK-SOLID" (exit criteria for this roadmap)
1. All **three universes** isolated and provably correct (FREE no-Claude, SDA Grok-first, PRO Claude-first).
2. **Real test suite** green + CI gate blocks broken deploys.
3. **API versioned** + migration system in place (forward/backward safe).
4. **Tracing + error tracking + metrics** live (failures are visible).
5. **Circuit breaker + bulkhead** protect every provider call.
6. `App.tsx` modularized (SRP/SoC restored).
7. No hardcoded secrets, no junk files, no untested critical path.
8. **Infra as code** — prod reproducible from Terraform (P6).
9. **Async infra** — queue + Redis cache, no Firestore-polling for jobs (P7).
10. **Observability infra** — tracing + alerting + error tracking live (P8).
11. **Zero-downtime + DR** — canary deploy with auto-rollback + restorable backups (P9).
12. **Edge hardening** — CDN + KMS + WAF + load test in CI (P10).

---

## NOTES / DECISIONS LOG
- 2026-06-27: Roadmap created from full architecture audit (200 components + 30 principles).
  Baseline: ~62% HAVE / ~23% PARTIAL / ~15% MISSING. Two core-law violations identified (SDA router, tests).
- 2026-06-27 (same day, deeper scan): Ran the 280-component **infrastructure** audit. Found the codebase
  far more mature than the first pass — `tests/` (293 specs), `AgentV3/`, `infra/e2b/`, GitHub Actions CI/CD,
  `ts-morph` AST, `ProjectMigrator`, E2B/Docker sandbox actuators all present. **Corrected** P0.2 / P1.2 / P4.3
  to ✅ DONE. Added **INFRASTRUCTURE LAYER P6–P10** (IaC, queue/cache, observability, zero-downtime/DR, edge).
  Confirmed low-level infra (k8s, bare metal, hypervisor, etc.) is ⬜ N/A by design (managed-serverless).
  **Only remaining core-law violation: P0.1 SDA isolated router.**
- 2026-06-28: **P0.1 DONE.** Per admin direction, isolated the ENTIRE professional universe (not just
  SDA): added the `professional` namespace in `AIRouterManager`, wired `UniversalAIRouter` tier mapping,
  pointed the SDA route's text path and the config-driven professionals engine at it (fixing the engine's
  previous Gemini→Claude→Grok Claude-2nd violation).
- 2026-06-28 (refinement, admin spec): professional routing shape finalized as **RACE Grok × Gemini ×
  Vertex** (concurrent, first success wins) with **Claude Haiku ONLY as last resort**. Implemented
  `AIRouter.routeRaced` + a `lastResort` provider flag; consumers (SDA text path, professionals engine)
  switched to `routeRaced`. Test grown to 8 cases (chain shape + race behavior). Gate green (tsc ×2,
  2702 tests, build, boot). **Zero core-law violations open. P0 complete (100%).**
- 2026-06-28: **AI Intelligence audit (300 components)** added as **P11**. Each component was scanned
  against the real codebase by parallel deep-scan agents and classified DONE/PARTIAL/MISSING (verified
  cited files exist). Result: **164 DONE · 69 PARTIAL · 67 MISSING**. The 136 PARTIAL+MISSING gaps are
  tracked under P11.1–P11.16 (reasoning, planning/multi-agent, reflection, NLU/dialogue, memory, RAG,
  code-intel, diagnostics, vision/multimodal, tool/db, ensemble, safety/governance, personalization,
  resilience/scheduling, observability/eval, validation). The 164 DONE are listed (not re-tracked) so
  they are never rebuilt. AgentV3's agent/reflection/memory/confidence/governance stack is the strong base.
  (This is the 1st of the admin's category lists; remaining categories — Code Generation, Project
  Management, Dev Environment, etc. — will be added as P12+ as their lists arrive.)
- Deploy after each phase (permanent law). Maintain English-only UI (permanent law).

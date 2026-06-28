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
- **SDA** (Doctor AI): Grok → Gemini → Vertex → Claude (Grok primary, Claude last resort).  ❌ **router missing — P0.1**
- **PRO** (build + plan): Claude → Grok → Gemini → Vertex (Claude primary).  ✅ implemented

---

## 📊 STATUS SNAPSHOT (audit baseline)
- ✅ HAVE (strong, real): ~62% (architecture) · ~30% (infrastructure)
- 🟡 PARTIAL (works but incomplete): ~23%
- ❌ MISSING (not present): ~15% (architecture) · ~25% (infrastructure)
- **1 core-law violation still open:** SDA isolated router (P0.1).

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
| P0 | Core-Law Violations | Breaks your own permanent rules | 🔄 In Progress | 50% |
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
| **P-UX** | **UX Engine Gaps** | User-facing quality, trust, retention | ⏳ Pending | 0% |
| **P-PE** | **Prompt Engine Gaps** | AI quality, cost, safety | ⏳ Pending | 0% |
| **P-AI** | **AI Intelligence Gaps** | Deeper reasoning, RAG, safety, personalization | ⏳ Pending | 0% |

---

## 🔴 PHASE P0 — CORE-LAW VIOLATIONS (do FIRST)
> These break rules you yourself set as permanent. Highest priority.

### P0.1 — SDA "Doctor AI" Isolated Router Chain  ❌ MISSING
- **Problem:** Backend `src/server/AI/AIRouterManager.ts` only has FREE + PRO namespaces.
  The SDA chain **Grok → Gemini → Vertex → Claude** (Grok primary, Claude last resort) does NOT exist
  as an isolated routing namespace. Frontend `SDAChat` UI exists but routes without true isolation.
- **Tasks:**
  - [ ] Add a third namespace `sda` in `AIRouterManager.ts` with priority order: Grok(1-2) → Gemini(3-4) → Vertex(5-9) → Claude(last).
  - [ ] Wire tier routing in `src/server/AI/UniversalAIRouter.ts`: `sda` / `doctor` tier → `sda` namespace.
  - [ ] Add dedicated SDA endpoint(s) in `server.ts` (e.g. `/api/sda-chat`) that force the `sda` namespace.
  - [ ] Verify **complete isolation** — SDA must never touch FREE or PRO state/history/cache.
  - [ ] Frontend: point `SDAChat` at the new isolated endpoint.
- **Acceptance:** A test proves SDA uses Grok first and Claude only as final fallback, and that
  FREE never reaches Claude.
- **Files:** `src/server/AI/AIRouterManager.ts`, `src/server/AI/UniversalAIRouter.ts`, `server.ts`, `src/components/.../SDAChat`.

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

## 🟤 PHASE P-AI — AI INTELLIGENCE GAPS
> From the 300-component AI Intelligence audit (2026-06-28). Already-strong items not listed.
> Only PARTIAL → Full and MISSING items, priority-ordered.

### ✅ AI Intelligence Already Strong (do not redo)
- Full orchestration: AppMakerOrchestrator, ExecutionOrchestrator, RuntimeKernel, BlueprintPlanner,
  FilePlanningEngine, TaskScheduler (DAG + cycle detection), DeploymentPlanner, RepairPlanner.
- Agent roles: RequirementsAgent, PlanningAgent, FeatureImplementationAgent, ProjectStructureAgent
  + AgentV3 13-role roster (architect/planner/engineer/qa/repair/triage/ops/docs/knowledge/evaluator/persona).
- Code Intelligence: ASTAnalyzer (ts-morph real AST), WorkspaceMemory (project graph), RepositoryIntelligenceEngine,
  ImpactAnalyzer, FailureClassifier, RootCauseAnalyzer, AutoRepairEngine, RepairKnowledgeBase.
- Quality Evaluation: QualityEvaluationEngine (Build+Lint+Runtime+Security+Architecture evaluators),
  PostEditReviewer, BuildEvaluator, RepairConfidenceEngine, QualityScorer.
- Tool Use: ToolDispatcher (30+ tools, role-based), E2BActuator, DockerActuator, WorkspaceManager,
  VCSStateManager, DeploymentEngine, VercelProvider, NetlifyProvider.
- Safety: CommandGovernance, SecretRedactor (12+ providers), UntrustedContent (fenceUntrusted),
  SecurityEvaluator, rate limiting, auth middleware.
- Model Routing: AIRouter (2-pass, 8-slot, racing top-2), powerLevel Opus effort, AIRouterManager.
- Resilience: CheckpointManager (ACID), TransactionCoordinator, LockManager, ConflictDetector,
  DeploymentRollbackManager, RepairBudgetManager (maxAttempts=3, maxTokens=200k).
- Governance/Audit: AuditManager, DeploymentAuditManager, AgentV3CostTelemetry, TokenUsageManager.
- Event System: InProcessEventBus (47+ event types), EventHistoryStore.
- Consensus/Hallucination mitigation: Consensus.ts, ReviewerGuard.ts (partial, present).

### P-AI.1 — Hallucination Detection  🟡 PARTIAL → full  [HIGH]
- `Consensus.ts` + `ReviewerGuard.ts` provide multi-hat mitigation but are not wired on every generation path.
  No dedicated hallucination classifier or confidence threshold gate.
- [ ] Wire `ReviewerGuard` on every LLM output path in `AppMakerOrchestrator.ts` (currently optional).
- [ ] Add a lightweight consistency check: re-generate critical code segments twice, compare; flag divergence.
- [ ] Surface low-confidence outputs to the user with a warning badge instead of silently accepting them.
- **Files:** `src/server/AgentV3/Consensus.ts`, `src/server/AgentV3/ReviewerGuard.ts`,
  `src/server/AppMakerLab/AppMakerOrchestrator.ts`.

### P-AI.2 — Full RAG Pipeline (Reranker + Grounding + Citation)  🟡 PARTIAL → full  [HIGH]
- `RepositoryIntelligenceEngine.ts` retrieves project files. `EmbeddingSearch.ts` does ada-002 similarity.
  Missing: reranker (sort retrieved chunks by relevance), grounding engine (attach evidence to claims),
  citation manager (trace which file/line supported which generated snippet).
- [ ] Add a `ContextReranker.ts` — BM25 or cross-encoder score on retrieved chunks before injection.
- [ ] Add a `GroundingEngine.ts` — wrap each generated code block with its source file references.
- [ ] Citation metadata injected into `AgentV3CostTelemetry.ts` records (which file context was used).
- **Files:** new `src/server/AgentV3/ContextReranker.ts`, new `src/server/AgentV3/GroundingEngine.ts`,
  `src/server/AgentV3/EmbeddingSearch.ts`.

### P-AI.3 — Dialogue Manager / Multi-Turn Context Manager  🟡 PARTIAL → full  [HIGH]
- `ConversationStore.ts` persists transcript (durable `MessageParam[]`). Missing: a stateful dialogue
  manager that tracks conversation phase (requirements → planning → building → debugging) and adjusts
  intent classification based on prior turns rather than treating each message as independent.
- [ ] Add `DialogueStateManager.ts` — tracks phase (REQUIREMENTS / PLANNING / BUILDING / DEBUGGING /
  DEPLOYED) and injects phase context into `IntentClassifier` decision.
- [ ] Multi-turn context compression: when transcript > 50 turns, summarize older turns before injection
  (currently `UniversalAIRouter.ts` does token-based truncation only).
- **Files:** new `src/server/AgentV3/DialogueStateManager.ts`, `src/server/AgentV3/IntentClassifier.ts`,
  `src/server/AI/UniversalAIRouter.ts`.

### P-AI.4 — NLU Completion (Entity Recognition + Slot Filling)  🟡 PARTIAL → full  [HIGH]
- `IntentExtractor.ts` does keyword/heuristic domain detection. `RequirementIntelligenceEngine.ts` does
  structured requirement parsing via LLM. No named entity extraction or slot filling (e.g. "build me a
  shop with Razorpay" → entity: Razorpay, slot: payment_gateway).
- [ ] Add entity recognition pass to `IntentClassifier.ts`: extract named technologies, frameworks, APIs
  from user message and inject as structured slots into `FilePlanningEngine`.
- [ ] Map extracted slots → `BlueprintInferenceEngine.ts` template selection for higher accuracy.
- **Files:** `src/server/AgentV3/IntentClassifier.ts`, `src/server/AppMakerLab/intelligence/IntentExtractor.ts`,
  `src/server/AppMakerLab/BlueprintInferenceEngine.ts`.

### P-AI.5 — Preference Learning / Personalization  ❌ MISSING  [HIGH]
- The AI treats every user identically. No tracking of user's preferred tech stack, coding style, or
  past decisions (e.g. "this user always picks React + Tailwind + Firestore").
- [ ] Add `UserPreferenceStore.ts` — Firestore collection `userPrefs/{userId}` storing: preferred
  framework, DB, language, component style, last 5 successful blueprint patterns.
- [ ] Inject top preferences as context in `architectSystemPrompt()` for returning users.
- [ ] Update preferences on every successful build (infer from blueprint, not from explicit user input).
- **Files:** new `src/server/AgentV3/UserPreferenceStore.ts`, `src/server/AgentV3/systemPrompt.ts`,
  `src/server/AppMakerLab/AppMakerOrchestrator.ts`.

### P-AI.6 — Dedicated PII Detection  🟡 PARTIAL → full  [MED]
- `SecretRedactor.ts` masks API keys/tokens (12+ provider patterns). Does not detect general PII:
  Aadhaar numbers, PAN, phone numbers, emails, Indian bank account numbers in user-submitted code/data.
- [ ] Extend `SecretRedactor.ts` with Indian PII patterns: Aadhaar (12-digit), PAN (AAAAA0000A),
  mobile (10-digit starting 6-9), email, IFSC.
- [ ] Add `redactPII()` export alongside existing `redactSecrets()` — called on user-uploaded file content.
- **Files:** `src/server/AgentV3/SecretRedactor.ts`.

### P-AI.7 — Test Generation Intelligence  ❌ MISSING  [MED]
- The system generates app code but never generates corresponding tests. `QualityEvaluationEngine`
  evaluates existing tests but nothing generates new ones.
- [ ] Add a `TestGenerationAgent.ts` role in `AgentRegistry.ts` — post-generation step that produces
  Vitest unit tests for generated services/hooks/utils.
- [ ] Trigger after successful build: generate tests for the top 3 most-used functions in the built app.
- **Files:** new `src/server/AgentV3/TestGenerationAgent.ts`, `src/server/AgentV3/AgentRegistry.ts`,
  `src/server/AppMakerLab/AppMakerOrchestrator.ts`.

### P-AI.8 — Human-in-the-Loop Coordinator  ❌ MISSING  [MED]
- The AI executes full build pipelines autonomously. No step asks the user to review/approve before
  committing a destructive change (e.g. full app regeneration that overwrites existing edits).
- [ ] Add `HumanReviewGate.ts` — before full-app overwrite, emit a SSE event to frontend asking for
  user confirmation if existing `generatedCode` is non-empty.
- [ ] Frontend: show "AI wants to overwrite your app — Approve / Cancel" dialog.
- **Files:** new `src/server/AgentV3/HumanReviewGate.ts`, `src/server/AppMakerLab/AppMakerOrchestrator.ts`,
  `src/App.tsx`.

### P-AI.9 — Explainability / Decision Trace  ❌ MISSING  [MED]
- `AuditManager.ts` logs mutations. `DeploymentAuditManager.ts` logs deploy steps. But no trace of
  AI *decisions*: why was this architecture chosen? why this repair strategy? why this provider?
- [ ] Add `DecisionTraceManager.ts` — append-only log of: intent detected → blueprint chosen → provider
  selected → repair strategy chosen. Stored per build in Firestore `buildTraces/{jobId}`.
- [ ] Expose via `/api/admin/trace/:jobId` (admin only) for debugging.
- **Files:** new `src/server/AgentV3/DecisionTraceManager.ts`, `src/server/AppMakerLab/AppMakerOrchestrator.ts`.

### P-AI.10 — Adversarial Input / Abuse Detection  🟡 PARTIAL → full  [MED]
- `CommandGovernance.ts` blocks shell commands. `UntrustedContent.ts` fences prompt injection.
  Rate limiter throttles requests. No dedicated abuse pattern detection (bulk generation abuse,
  adversarial prompts to extract training data, prompt-stuffing to bypass governance).
- [ ] Add `AbuseDetector.ts` — track: requests/minute per userId, unusual prompt patterns (very long
  prompts, high repetition, requests for "ignore above" variants), generation cost spikes.
- [ ] On detection: rate-limit tier drop + Firestore `abuseLedger/{userId}` entry + audit log.
- **Files:** new `src/server/AgentV3/AbuseDetector.ts`, `server.ts` (inject pre-AI call).

### P-AI.11 — Dedicated Log / Stack Trace Intelligence  ❌ MISSING  [LOW]
- Errors are classified by `FailureClassifier.ts` (pattern matching). No dedicated log parser that
  understands structured output from Vite, TypeScript, ESLint, or runtime stack traces.
- [ ] Add `LogIntelligenceEngine.ts` — parse stderr/stdout from build steps into structured error objects
  (file, line, column, error type, severity).
- [ ] Feed structured errors directly into `RootCauseAnalyzer.ts` instead of raw string matching.
- **Files:** new `src/server/AppMakerLab/intelligence/LogIntelligenceEngine.ts`,
  `src/server/AppMakerLab/autorepair/RootCauseAnalyzer.ts`.

### P-AI.12 — Model Evaluation / Benchmark Engine  ❌ MISSING  [LOW]
- No systematic comparison of output quality across providers (Claude vs Grok vs Gemini for code gen).
  A/B flags exist for UI (`featureFlags.ts`) but not for model quality evaluation.
- [ ] Add `ModelEvaluationEngine.ts` — run a sample prompt against two providers, score both via
  `QualityEvaluationEngine`, log winner to Firestore `modelEvals/{promptHash}`.
- [ ] Wire into `AIRouter.ts` as an optional shadow-scoring pass (1% of requests).
- **Files:** new `src/server/AgentV3/ModelEvaluationEngine.ts`, `src/server/AI/Router/AIRouter.ts`.

### P-AI.13 — Visual Intelligence (Multimodal)  ❌ MISSING  [LOW — future scope]
- No computer vision, OCR, screenshot understanding, or diagram/document parsing.
  Low priority for a text-first code-generation app but is a differentiator for "build from screenshot".
- [ ] Future: integrate Claude's vision API to accept a screenshot and generate matching UI code.
- [ ] Future: accept Figma export JSON → code (FigmaImporter exists in frontend; backend generation not wired).
- **Files:** `src/server/AI/AIRouterManager.ts` (add vision model routing), new `src/server/Vision/`.

---

## 🔶 PHASE P-UX — UX ENGINE GAPS
> From the 300-component UX Engine audit (2026-06-27). Items already done are NOT listed.
> Only PARTIAL → Full and MISSING items, priority-ordered.

### ✅ UX Already Strong (do not redo)
- Dark/Light theme (system preference), PWA install + offline mode, Ctrl+K command palette,
  onboarding welcome modal, toast notification system (useToast + ToastContainer),
  AI Suggestions sidebar (Copilot-style), Skeleton loader (Suspense), 18+ language + RTL support,
  Keyboard shortcuts (Ctrl+Z/Y), Mobile-first responsive layout, LiveCollaboration (Firestore-backed).

### P-UX.1 — Privacy Consent / GDPR Banner  ❌ MISSING  [HIGH]
- No cookie consent or data-processing notice exists for EU/India PDPB compliance.
- [ ] Add a "We use analytics + AI" consent banner (localStorage flag to suppress on accept).
- [ ] Respect consent before firing `trackEvent()` or `PerformanceObserver`.
- **Files:** `src/main.tsx`, `src/lib/analytics.ts`, new `src/components/ConsentBanner.tsx`.

### P-UX.2 — Skeleton Screens (per-component)  🟡 PARTIAL → full  [HIGH]
- Global Suspense spinner exists, but individual list/card components have no shimmer placeholders.
- [ ] Add skeleton variants for: chat history list, template cards, file tree, billing view.
- **Files:** new `src/components/ui/Skeleton.tsx`, applied in 4-6 component views.

### P-UX.3 — One-Click AI Fix after Error  ❌ MISSING  [HIGH]
- Console errors are tracked (`window.error → /api/logs/error`) but the UI offers no "Fix it" button.
- [ ] Show an inline "AI Fix" button in the preview error overlay that prepopulates the chat with the error.
- [ ] Wire into error-aware AI flow already in `AgentV3` (Phase 7 built error context injection).
- **Files:** `src/App.tsx` (PREVIEW_BOOTSTRAP error handler), `src/contexts/WorkspaceContext.tsx`.

### P-UX.4 — Product Tour / Guided Walkthrough  ❌ MISSING  [HIGH]
- Onboarding modal exists (4 cards) but no interactive step-by-step tour highlighting UI elements.
- [ ] Add a lightweight driver.js (or Shepherd.js) product tour triggered from the onboarding modal CTA.
- [ ] Cover: sidebar → chat → preview → deploy → billing (5 steps).
- **Files:** new `src/components/ProductTour.tsx`, `src/App.tsx`.

### P-UX.5 — Breadcrumb Navigation  ❌ MISSING  [MED]
- No breadcrumbs in deep views (Database Studio → collection → document; Code Studio → file → symbol).
- [ ] Add a `<Breadcrumb>` component used in panel headers.
- **Files:** new `src/components/ui/Breadcrumb.tsx`.

### P-UX.6 — NPS / CSAT Feedback  ❌ MISSING  [MED]
- No in-app Net Promoter Score or thumbs-up/down per AI response.
- [ ] Add a thumbs-up/down icon after each AI response; fire `trackEvent('feedback', {score})`.
- [ ] Show an NPS prompt (0-10 scale) on session 5 / after first successful deploy.
- **Files:** `src/App.tsx` (chat message rendering), `src/lib/analytics.ts`.

### P-UX.7 — Token Usage Visualization  ❌ MISSING  [MED]
- Token spend is tracked in `AgentV3CostTelemetry.ts` but never surfaced to the user.
- [ ] Show a token/cost gauge in the billing dashboard (daily spend vs. quota).
- [ ] Optional: per-message token count badge in pro mode.
- **Files:** `src/App.tsx` (billing view), new backend endpoint `/api/usage/tokens`.

### P-UX.8 — Account Recovery (forgot password)  ❌ MISSING  [MED]
- Email/password login exists but no "Forgot password" link — Firebase Auth supports this natively.
- [ ] Add a "Forgot password?" link in the login modal → `firebase.auth().sendPasswordResetEmail()`.
- **Files:** `src/App.tsx` (login modal), `src/config/firebase.ts`.

### P-UX.9 — Session Replay / Heatmap  ❌ MISSING  [LOW]
- No session replay tool (Hotjar / PostHog / LogRocket) for UX debugging.
- [ ] Integrate PostHog (GDPR-compliant, self-hostable) — fire after consent (P-UX.1).
- **Files:** `src/main.tsx`.

### P-UX.10 — Storybook / Component Gallery  ❌ MISSING  [LOW]
- 109 components but no isolated visual dev/test environment.
- [ ] Set up Storybook for at least the 10 core `src/components/ui/` primitives.
- **Files:** new `.storybook/`, `src/components/ui/*.stories.tsx`.

---

## 🔷 PHASE P-PE — PROMPT ENGINE GAPS
> From the 300-component Prompt Engine audit (2026-06-27). Already-strong items not listed.
> Only PARTIAL → Full and MISSING items, priority-ordered.

### ✅ Prompt Engine Already Strong (do not redo)
- IntentClassifier (chat/new_build/edit_existing + confidence), Context Building (dynamic composition,
  5-file injection, context compression), Memory (KnowledgeEvolution Jaccard dedup + Firestore,
  ConversationStore transcript, RecalledLessons top-6 inject), AI Router (2-pass 8-slot, powerLevel
  Opus effort), Tool Use (ToolDispatcher 30+ tools, role-based catalog, structured output),
  Safety/Policy (CommandGovernance, SecretRedactor, UntrustedContent, fenceUntrusted),
  RequirementIntelligenceEngine, FilePlanningEngine, ASTAnalyzer (ts-morph), EmbeddingSearch (ada-002).

### P-PE.1 — Prompt/Response Cache  ❌ MISSING  [HIGH — cost & latency]
- Every AI call is a fresh API hit. Identical prompts (template generation, common questions) spend money.
- [ ] Add a cache layer (Redis / in-memory LRU with TTL) in `AIRouter.ts` — cache key = hash(model + messages).
- [ ] TTL: 5 min for builds, 1 hr for template/docs prompts. Skip cache for edit/fix intents.
- [ ] Cache hit metric: fire `trackEvent('cache_hit', {promptHash})`.
- **Files:** `src/server/AI/Router/AIRouter.ts`, new `src/server/AI/PromptCache.ts`.

### P-PE.2 — Prompt Versioning / Registry  ❌ MISSING  [HIGH]
- System prompts are hardcoded in `AgentV3/systemPrompt.ts`. No version history, no rollback.
- [ ] Create a `PromptRegistry` (simple YAML/JSON store or Firestore collection) with version IDs.
- [ ] `systemPrompt.ts` reads from registry; CI can diff versions.
- [ ] Log which prompt version was active in `AgentV3CostTelemetry.ts` records.
- **Files:** `src/server/AgentV3/systemPrompt.ts`, new `src/server/AgentV3/PromptRegistry.ts`.

### P-PE.3 — Jailbreak Detection  ❌ MISSING  [HIGH — safety]
- `CommandGovernance.ts` blocks dangerous shell commands. `UntrustedContent.ts` fences injection.
  But there is no classifier for prompt-level jailbreak attempts ("ignore your instructions", DAN, etc.).
- [ ] Add a `JailbreakDetector.ts` — regex + embedding similarity check against known patterns.
- [ ] On detection: reject + log to audit trail (same `audit()` function as Phase 4) + increment abuse counter.
- [ ] Hard-block if 3+ violations from same userId in 1 hour.
- **Files:** new `src/server/AgentV3/JailbreakDetector.ts`, `server.ts` (inject before AI call).

### P-PE.4 — Token Estimator (pre-call)  ❌ MISSING  [MED — cost control]
- Token spend tracked post-hoc in `AgentV3CostTelemetry.ts` but no pre-call estimate.
- [ ] Add `estimateTokens(messages, model)` using `tiktoken` (or `gpt-3-encoder`) — runs in < 1ms.
- [ ] Use estimate to: (a) warn user when context is near limit, (b) decide to compress before calling.
- [ ] Integrate with `powerLevel.ts` — if estimate > 80% of model limit, force context compression.
- **Files:** new `src/server/AgentV3/TokenEstimator.ts`, `AgentV3/powerLevel.ts`, `AIRouter.ts`.

### P-PE.5 — Prompt Evaluation / A-B Testing  🟡 PARTIAL → full  [MED]
- A/B feature flags (`featureFlags.ts`) exist for UI. No prompt-level A/B: variant A vs B system prompts.
- [ ] Extend `featureFlags.ts` to support prompt variant bucketing (same deterministic hash).
- [ ] Log variant + quality signal (user thumbs/NPS from P-UX.6) to Firestore for offline eval.
- **Files:** `src/lib/featureFlags.ts`, `src/server/AgentV3/systemPrompt.ts`, `src/lib/analytics.ts`.

### P-PE.6 — Prompt Audit Trail  🟡 PARTIAL → full  [MED]
- `AgentV3CostTelemetry.ts` logs cost/tokens but not the exact prompt text or version that produced a response.
- [ ] Append `promptVersion`, `intentLabel`, and first 200 chars of system prompt to each telemetry record.
- [ ] Firestore collection: `promptAudits/{userId}/{timestamp}`.
- **Files:** `src/server/AgentV3/AgentV3CostTelemetry.ts`, `src/server/AgentV3/systemPrompt.ts`.

### P-PE.7 — Prompt Debugger / Trace View  ❌ MISSING  [LOW — dev tool]
- No admin view showing: intent → context assembled → system prompt → model selected → tokens used.
- [ ] Add a hidden debug panel (dev + admin only, gated by `isDev || isAdmin`) in the UI.
- [ ] Show the full composed prompt, token estimate, provider chosen, and response latency.
- **Files:** new `src/components/PromptDebugPanel.tsx`, `src/config/env.ts`.

### P-PE.8 — Time/Date Context Injection  ❌ MISSING  [LOW]
- AI has no awareness of current date/time — can give stale advice about "latest" frameworks.
- [ ] Prepend `[Current date: ${new Date().toISOString()}]` to system prompt in `architectSystemPrompt()`.
- **Files:** `src/server/AgentV3/systemPrompt.ts`.

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
13. **UX baseline** — consent banner, skeleton screens, one-click AI fix, product tour (P-UX.1–4).
14. **Prompt engine hardened** — response cache, prompt versioning, jailbreak detection (P-PE.1–3).
15. **AI Intelligence hardened** — hallucination gated, RAG reranker+grounding, dialogue manager,
    preference learning, PII detection, human review gate (P-AI.1–5, P-AI.6, P-AI.8).

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
- Deploy after each phase (permanent law). Maintain English-only UI (permanent law).
- 2026-06-27 (UX + PE audits): Ran 300-component **UX Engine** audit → found 10 gaps (4 HIGH, 4 MED, 2 LOW).
  Already-strong: theme, PWA, Ctrl+K, onboarding modal, toast, AI Suggestions, LiveCollaboration. MISSING:
  privacy consent/GDPR, one-click AI fix, product tour, breadcrumbs, NPS/CSAT, token gauge, forgot-password,
  session replay, Storybook. Added as **PHASE P-UX**.
- 2026-06-28 (AI Intelligence audit): Ran 300-component **AI Intelligence** audit → found 13 gaps (5 HIGH, 5 MED, 3 LOW).
  Already-strong (~45%): full orchestration layer, 13-role AgentV3 roster, real AST (ts-morph), code-gen engines
  (frontend/backend/database), quality evaluation (5 evaluators), ToolDispatcher 30+ tools, CommandGovernance,
  SecretRedactor, ACID checkpoints/transactions, audit managers, AIRouter 2-pass + powerLevel.
  HIGH gaps: hallucination detection not wired everywhere, RAG missing reranker+grounding+citation,
  no dialogue manager/phase tracking, no NLU entity recognition/slot filling, no preference learning.
  MED gaps: PII detection (general), test generation, human-in-the-loop gate, decision trace, abuse detection.
  LOW gaps: log/stack trace parser, model evaluation engine, multimodal/vision (future scope).
  Added as **PHASE P-AI**.
- 2026-06-27 (PE audit): Ran 300-component **Prompt Engine** audit → found 8 gaps (3 HIGH, 3 MED, 2 LOW).
  Already-strong: IntentClassifier, RequirementIntelligenceEngine, FilePlanningEngine, Context Building,
  KnowledgeEvolution, ConversationStore, EmbeddingSearch, AIRouter 2-pass, ToolDispatcher 30+ tools,
  CommandGovernance, SecretRedactor, UntrustedContent. MISSING: prompt/response cache (every call = fresh
  API hit), prompt versioning/registry, jailbreak detection, token pre-call estimator, prompt A/B eval,
  prompt audit trail (partial), prompt debugger/trace, date/time context. Added as **PHASE P-PE**.

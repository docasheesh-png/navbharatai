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
- ✅ HAVE (strong, real): ~62% (architecture) · ~30% (infrastructure)
- 🟡 PARTIAL (works but incomplete): ~23%
- ❌ MISSING (not present): ~15% (architecture) · ~25% (infrastructure)
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
| P1 | Break-Proof Foundation | "App break nahi honi chahiye" guarantee | ✅ Complete | 100% |
| P2 | Resilience & Observability | See + survive failures | ✅ Complete | 100% |
| P3 | Scale & Frontend Health | Grow without rewrites | 🔄 In Progress | 75% (P3.1 App.tsx split deferred) |
| P4 | Advanced Enterprise Patterns | True enterprise depth | 🔄 In Progress | 75% (P4.2 + P4.3 + P4.4 done; only P4.1 CQRS — large — remains) |
| P5 | Hygiene & Hardening | Remove rot, close small holes | 🔄 In Progress | 67% (P5.1 assessed/kept, P5.3 done; P5.2 monorepo deferred — large infra) |
| **P6** | **IaC & Provisioning** | Reproducible, version-controlled infra | ⏳ Pending | 0% |
| **P7** | **Async Infra (Queue/Cache)** | Scale beyond Firestore-polling | ⏳ Pending | 0% |
| **P8** | **Observability Infra** | Tracing + alerting + SLO | ⏳ Pending | 0% |
| **P9** | **Zero-Downtime & DR** | Canary/blue-green + cross-region | ⏳ Pending | 0% |
| **P10** | **Edge & Hardening Infra** | CDN, KMS, chaos/load testing | ⏳ Pending | 0% |
| **P-UX** | **UX Engine Gaps** | User-facing quality, trust, retention | ⏳ Pending | 0% |
| **P-PE** | **Prompt Engine Gaps** | AI quality, cost, safety | ⏳ Pending | 0% |
| **P-AI** | **AI Intelligence Gaps** | Deeper reasoning, RAG, safety, personalization | ⏳ Pending | 0% |
| **P-CGE** | **Code Generation Engine Gaps** | Incremental gen, test gen, docs, contracts, lint-fix | ⏳ Pending | 0% |
| **P-PME** | **Project Management Engine Gaps** | Cross-session memory, release notes, debt tracker, AI estimator | ⏳ Pending | 0% |
| **P-DEV** | **Dev Environment Gaps** | LSP navigation, real debugger, crash recovery, merge editor, pkg manager | ⏳ Pending | 0% |
| **P-BRE** | **Build & Runtime Engine Gaps** | Tracing, incremental builds, structured logs, smoke tests, remote cache | ⏳ Pending | 0% |
| **P-TQA** | **Testing & QA Engine Gaps** | Code coverage gate, visual regression, load tests, prompt regression, bundle budget | ⏳ Pending | 0% |
| **P-SEC** | **Security Engine Gaps** | RBAC, DAST, MFA, container scanning, key rotation, SIEM, supply chain | ⏳ Pending | 0% |
| **P-DATA** | **Data & Backend Engine Gaps** | Schema validation, durable artifact/embedding store, data retention/GDPR, OpenAPI, uploads, export | ⏳ Pending | 0% |
| **P-DESIGN** | **UI/UX & Design Platform Gaps** | UI primitive library, overlay primitives, a11y engine, charts, AI design-gen, prototyping, design governance | ⏳ Pending | 0% |
| **P-DEPLOY** | **DevOps & Deployment Gaps** | DORA metrics, staging/promotion, AI deploy-ops, app-store automation, approval gate, more targets | ⏳ Pending | 0% |
| **P-COLLAB** | **Collaboration Platform Gaps** | Durable team membership, shared-workspace ACL, client share portal, team libraries, @mention, SSO | ⏳ Pending | 0% |
| **P-MON** | **Monitoring & Analytics Gaps** | Product analytics pipeline, anomaly/forecasting, LLM observability, real health scores, AI insights, FinOps | ⏳ Pending | 0% |
| **P-ORCH** | **Automation & Orchestration Gaps** | Cron/scheduled jobs, user workflow builder, saga/compensation (core brain = AgentV3, already DONE) | ⏳ Pending | 0% |

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

### P1.1 — API Versioning  ✅ DONE (2026-06-28)
- [x] Introduced `/api/v1/...` prefix via a single pre-route middleware (`src/server/routes/apiVersion.ts`)
      that internally rewrites `/api/v1/foo` → `/api/foo` — every existing route is instantly available
      versioned with zero per-route changes. Versioned responses carry `X-API-Version: v1`.
- [x] Old unversioned `/api/...` paths kept as deprecated shims: each response now carries
      `Deprecation: true`, `X-API-Version: unversioned`, and a `Link: </api/v1/...>; rel="successor-version"`
      header. Behaviour unchanged — never breaks a current client.
- [x] Documented the version contract in `AGENTS.md` (new "API VERSIONING CONTRACT" section).
- **Verification:** `tsc --noEmit` ✅ · `tsc -p tsconfig.server.json` ✅ · `vitest run` 2737/2737 ✅
  (17 new tests) · boot smoke-check + live curl: `/api/v1/health` → 200 `X-API-Version: v1`;
  `/api/health` → 200 `Deprecation: true` + successor `Link` ✅.
- **Files:** `server.ts`, `src/server/routes/apiVersion.ts`, `src/server/routes/apiVersion.test.ts`, `AGENTS.md`.

### P1.2 — Data Migration System  ✅ DONE (2026-06-27)
- **Reality:** `src/server/project/ProjectMigrator.ts` exists (+ `tests/projectMigrator.test.ts`).
- **Remaining:** confirm a `_migrations` ledger collection + startup hook are wired; document the runbook.
- **Files:** `src/server/project/ProjectMigrator.ts`.

### P1.3 — Circuit Breaker  ✅ DONE (2026-06-28)
- **Was:** only a flat per-provider cooldown in `AIRouter.ts` (every failure → fixed cooldown; no states, no recovery, no escalation).
- [x] Added a real `CircuitBreaker` class (`src/server/AI/Router/CircuitBreaker.ts`) with CLOSED / OPEN / HALF_OPEN states:
      a failure opens it; consecutive failures ESCALATE the cooldown (exponential backoff, capped at 5 min); once the
      cooldown elapses it goes HALF_OPEN and the next request is a trial probe — success → CLOSED (reset), failure → OPEN again.
- [x] Integrated into the router via the THREE existing chokepoints, so all three universes (FREE / PRO / PROFESSIONAL)
      and every path (`route` / `routeRaced` / `routeStream`) get it with zero control-flow changes:
      `isOnCooldown` → `breaker.isBlocking()`, `setCooldown` → `breaker.recordFailure()` (still shared cross-instance
      via `ProviderCooldownStore`), and success (the single `recordProviderLatency(...,false)` chokepoint) → `breaker.recordSuccess()`.
- [x] `getProviderStats()` now also reports `circuitState` + `consecutiveFailures` (additive; existing `cooldownUntil` kept so the Admin dashboard is unchanged).
- **Strictly break-proof:** below the failure threshold the cooldown equals exactly the old value — a pure superset, never worse.
- **Verification:** `tsc --noEmit` ✅ · `tsc -p tsconfig.server.json` ✅ · `vitest run` 2750/2750 ✅ (29 new) · server boots + `/api/health` 200 ✅.
- **Files:** `src/server/AI/Router/CircuitBreaker.ts` (+ `.test.ts`), `src/server/AI/Router/AIRouter.ts`.

### P1.4 — Idempotency & Deterministic Jobs  ✅ DONE (2026-06-28)
- [x] Added idempotency keys to build-job creation. `BuildJobManager.createJob(prompt, idempotencyKey?)`:
      when a key is supplied, a retried/duplicate request reuses the SAME job (returns its id, never spawns a
      second build) unless the prior attempt terminally FAILED, in which case a fresh retry is allowed.
      `BuildJob.idempotencyKey` is persisted; new `findExisting()` + `JobStore.findJobByIdempotencyKey()`
      implemented for BOTH stores (Firestore indexed query; LocalFile scan). Job ids now carry a monotonic
      suffix (`job-<ms>-<seq>`) so two jobs in the same millisecond never collide.
      `AppMakerOrchestrator.execute()` takes the key and only spawns the background worker for a genuinely new job.
- [x] Orchestrator steps are replay-safe — confirmed: `ExecutionOrchestrator.restoreFromCheckpoint()` +
      `resumeExecution()` rebuild the scheduler from checkpointed task statuses + patches, so a resume re-runs
      ONLY the incomplete tasks (completed tasks are never re-executed). Backed by `CheckpointManager` + `EventHistoryStore`.
- **Verification:** `tsc --noEmit` ✅ · `tsc -p tsconfig.server.json` ✅ · `vitest run` 2759/2759 ✅ (9 new) · server bundles ✅.
- **Files:** `src/server/AppMakerLab/jobs/BuildJobManager.ts` (+ `.test.ts`), `jobs/store/JobStore.ts`, `store/LocalFileJobStore.ts`, `store/FirestoreJobStore.ts`, `AppMakerOrchestrator.ts`.

---

## 🟡 PHASE P2 — RESILIENCE & OBSERVABILITY
> "Agar break ho to dikhe, aur recover ho."

### P2.1 — Distributed Tracing + Metrics  ✅ DONE (2026-06-28)
- **Was:** `ObservabilityManager.ts` + `console.log` only. No spans, no trace tree, no sink.
- [x] Added a real, dependency-free distributed tracer (`src/server/observability/Tracer.ts`): W3C trace/span ids,
      parent→child span trees, a bounded ring buffer of recent traces, `AsyncLocalStorage` context propagation, and
      `withSpan`/`recordChildSpan` helpers. Every tracing call is best-effort and never throws.
- [x] **Real Cloud Trace export with no SDK / no creds:** each completed span is emitted as a Cloud Logging structured
      line with `logging.googleapis.com/trace` (`projects/<PROJECT>/traces/<id>`) + `spanId`, which Cloud Run auto-correlates
      into Cloud Trace. Incoming `X-Cloud-Trace-Context` is parsed so our spans join the platform's trace.
- [x] Wired surgically (no hot-path control-flow change): a ROOT request span in `traceMiddleware` (started at entry,
      ended on `res.finish` with status/method/path; context kept active via `runInSpan`), and an AI **provider** child
      span emitted at the single `recordProviderLatency` chokepoint in `AIRouter.ts` (so every provider call across all
      three universes is traced under its request).
- [x] Metrics: new admin-gated endpoints `GET /api/observability/traces` (recent span trees) + `GET /api/observability/metrics`
      (per-span count/error-rate/avg/p95 + per-provider circuit/latency stats). `ObservabilityManager.trackLatency` now also emits a span.
- **Verification:** `tsc --noEmit` ✅ · `tsc -p tsconfig.server.json` ✅ · `vitest run` 2775/2775 ✅ (16 new) ·
      server boots + LIVE check: `/api/health` produced a real `HTTP GET /api/health` span tree readable via
      `/api/observability/traces?admin=…`; unauthenticated → 403 ✅.
- **Files:** `src/server/observability/Tracer.ts` (+ `.test.ts`), `src/server/routes/observability.ts`, `server.ts`, `AIRouter.ts`, `ObservabilityManager.ts`.

### P2.2 — Error Tracking (external)  ✅ DONE (2026-06-28)
- [x] Wired **Cloud Error Reporting** (real external tracking, no SDK / no creds — same proven log-correlation
      pattern as P2.1). New `src/server/observability/ErrorTracker.ts` emits each captured error as a Cloud Error
      Reporting-compatible structured log (`@type: …ReportedErrorEvent` + `serviceContext` + full-stack `message`),
      which Cloud Run auto-ingests (grouped, counted, alertable). Errors are also kept in a bounded ring buffer and
      correlated with the active trace (P2.1). Every capture is best-effort and never throws.
- [x] **Backend:** `installGlobalErrorHandlers()` (uncaughtException + unhandledRejection → report-and-continue, never
      crash the service) installed at startup; an Express error-handling middleware (registered LAST) captures any
      route error with request context and returns a clean 500.
- [x] **Frontend:** the existing `window.error` / `unhandledrejection` reporters (→ `/api/logs/error`) now flow through
      the tracker; `ErrorBoundary.componentDidCatch` additionally reports React render errors (prod-only, best-effort).
- [x] Admin view: `GET /api/observability/errors` (recent errors + grouped summary).
- **Verification:** `tsc --noEmit` ✅ · `tsc -p tsconfig.server.json` ✅ · `vitest run` 2784/2784 ✅ (9 new) ·
      server boots + LIVE check: a POSTed client error was captured and read back via `/api/observability/errors?admin=…`; no-admin → 403 ✅.
- **Files:** `src/server/observability/ErrorTracker.ts` (+ `.test.ts`), `server.ts`, `src/server/routes/telemetry.ts`, `src/server/routes/observability.ts`, `src/components/ErrorBoundary.tsx`.

### P2.3 — Bulkhead Isolation  ✅ DONE (2026-06-28)
- **Was:** the in-flight concurrency pool in `AIRouter.ts` was a module-level map keyed by provider NAME only, shared
  across every `AIRouter` instance — so a FREE-tier spike saturating a shared provider (e.g. Grok) starved PRO/SDA.
- [x] Each universe now has its OWN in-flight pool, keyed `${universe}:${provider}`. `AIRouter` takes a `universe`
      label (`new AIRouter('free'|'pro'|'professional')`, wired in `AIRouterManager`); all slot acquire/release/capacity
      checks go through per-universe helpers. A FREE spike can no longer starve PRO/SDA of slots.
- [x] The **circuit breaker stays keyed by provider name (shared)** — a 429/quota is a provider-wide health signal that
      SHOULD back every universe off; only the concurrency pool (local capacity/fairness) is isolated. Precise bulkhead,
      no loss of the shared health signal.
- [x] `getProviderStats()` aggregates in-flight back per provider (total + new `inFlightByUniverse` breakdown), so the
      Admin dashboard shape is preserved and the bulkhead pools are observable.
- **Verification:** `tsc --noEmit` ✅ · `tsc -p tsconfig.server.json` ✅ · `vitest run` 2787/2787 ✅ (3 new bulkhead tests
      prove a saturated FREE pool doesn't block PRO; existing 16 router tests still green) · server bundles ✅.
- **Files:** `src/server/AI/Router/AIRouter.ts` (+ new `AIRouterBulkhead.test.ts`), `src/server/AI/AIRouterManager.ts`.

### P2.4 — Disaster Recovery / Backup  ✅ DONE (2026-06-28)
- [x] Real Firestore export (backup): `src/server/lib/FirestoreBackup.ts` calls the Firestore Admin
      `exportDocuments` REST API (auth'd via the Cloud Run service account / ADC) into a GCS bucket, with a
      timestamped prefix so backups never overwrite. Admin-triggered via `POST /api/admin/backup/firestore`.
      Honest "not configured" result when `FIRESTORE_BACKUP_BUCKET` is unset — never fakes success, never throws.
- [x] Documented restore runbook: `docs/DR_RUNBOOK.md` (§1 scheduled export via Cloud Scheduler + bucket/IAM setup,
      §2 restore via `gcloud firestore import`, §3 probe wiring, §4 incident checklist) — all copy-pasteable commands.
- [x] Health/readiness probes: `GET /api/live` (liveness, always 200 while alive) + `GET /api/ready` (readiness:
      503 until init, then 200 with a dependency report) wired in `src/server/routes/health.ts`; `markServerReady()`
      flips ready true once the server is listening. The Cloud Run probe-flag wiring is documented in DR_RUNBOOK §3
      and referenced from `cloudbuild.yaml` — applied as a one-time manual `gcloud run services update` (operator
      watches the deploy succeed) rather than baked into the unattended deploy step, per safeguard #3.
- **Verification:** `tsc --noEmit` ✅ · `tsc -p tsconfig.server.json` ✅ · `vitest run` 2796/2796 ✅ (9 new) · server
      boots + LIVE check: `/api/live` 200, `/api/ready` 200 (`initialized:true`), backup trigger → honest 400
      "not configured" (no fake), no-admin → 403 ✅.
- **Files:** `src/server/lib/FirestoreBackup.ts` (+ `.test.ts`), `src/server/routes/health.ts` (+ `.test.ts`), `server.ts`, `docs/DR_RUNBOOK.md`, `cloudbuild.yaml`.

---

## 🟢 PHASE P3 — SCALE & FRONTEND HEALTH

### P3.1 — Split the `App.tsx` God Component  🟡 PARTIAL (9,156 lines)
- **Problem:** Violates SRP/SoC — state + chat + files + preview + payment + routing in one file.
- [ ] Extract into context providers + hooks: `PreviewProvider`, `ChatProvider`, `PaymentProvider`,
      `FilesProvider`, plus `usePreviewBundler`, `useProBuild` hooks.
- [ ] Target: `App.tsx` < 1,500 lines, no behavior change.
- **Files:** `src/App.tsx` → `src/contexts/`, `src/hooks/`.

### P3.2 — Offline-First Runtime  ✅ DONE (2026-06-28)
- [x] Service worker now caches an allowlist of safe, read-only GET API endpoints
      (`/api/agentv3/conversations`, `/api/agentv3/status`) using **network-first → cache fallback**: online users
      ALWAYS get fresh data; the cache is served only when the network fails (offline), so the app still shows
      last-known data. The new `navbharat-api-v1` cache is preserved across SW activations.
- [x] Offline write queue (`src/lib/offlineQueue.ts`, IndexedDB-backed): fire-and-forget writes that fail because the
      device is offline are buffered and **replayed on reconnect** (the `online` event). Replay is **STRICTLY
      allowlisted** to idempotent/harmless endpoints (`/api/analytics/event`, `/api/logs/error`) — a payment or
      build is NEVER queued or replayed (break-proof on a production payments app). Wired into the client error
      reporters in `main.tsx`; `installOfflineQueueFlush()` drives the reconnect replay.
- **Verification:** `tsc --noEmit` ✅ · `tsc -p tsconfig.server.json` ✅ · `vitest run` 2805/2805 ✅ (9 new) ·
      production `vite build` ✅ · `node --check public/sw.js` ✅ (SW emitted to `dist/sw.js` with the new logic).
- **Files:** `public/sw.js`, `src/lib/offlineQueue.ts` (+ `.test.ts`), `src/main.tsx`.

### P3.3 — Scalability / HA  ✅ DONE (2026-06-28)
- [x] Keep-warm: new `GET /api/warm` (`src/server/routes/warm.ts`) pre-warms the heavy PRO/SDA lazy singletons —
      the 3 AI router universes + env-only health, the SDA clinical KB + `sda_chat` app-context, the Gemini SDK
      client, and the Firestore admin client (via light reads on UserCost/ProviderState/Log/Metrics stores).
      **Billing-safe: constructs client objects ONLY — never a real billed model call** (verified by an adversarial
      review: a warm-traffic Anthropic/Vertex/Gemini ping would spend NavBharatAI's own account — explicitly avoided).
      Hit by an external Cloud Scheduler so `min-instances=0` stays (no idle billing); an in-app self-ping would be
      wrong (keeps an instance alive 24/7 and still doesn't warm the truly-cold request).
- [x] Hardened from the adversarial review: the unauthenticated endpoint **throttles** the real warmup to once per
      30s (cached report served to a flood at ~zero cost — anti cost-amplification), returns **generic per-step
      error markers** (no internal detail disclosed; full detail → server logs), and ALWAYS returns 200.
- [x] Multi-region readiness assessed (config only, no spend): `docs/SCALABILITY.md` §2 — substantially ready
      (stateless container, Firestore-backed state, cross-instance cooldown sync); documents what a 2nd region needs.
- **Verification:** `tsc --noEmit` ✅ · `tsc -p tsconfig.server.json` ✅ · `vitest run` 2813/2813 ✅ (8 new) ·
      server boots + LIVE check: `/api/warm` → 200, 13/13 steps ok; 2nd call `cached:true` (throttle holds); no raw
      error leakage. Discovery + adversarial-review run as multi-agent workflows.
- **Files:** `src/server/routes/warm.ts` (+ `.test.ts`), `server.ts`, `docs/SCALABILITY.md`, `cloudbuild.yaml`.

### P3.4 — Real CDN / Edge Caching  ✅ DONE (2026-06-28)
- [x] Made all static assets CDN-ready and FIXED a real live bug: `sw.js` matched the `.js` rule and was served
      `Cache-Control: immutable, max-age=1y` — pinning the service worker for a year (fights SW/PWA updates, and a
      CDN would cache it too). Now `sw.js` + `manifest.json` are `no-cache, no-store, must-revalidate`.
- [x] Single source of truth `src/server/lib/staticCache.ts` (`cacheControlFor`): hashed JS/CSS/fonts/wasm →
      `public, max-age=31536000, immutable` (edge-cacheable by ANY CDN), images → 1 week, HTML/sw.js/manifest →
      revalidate. Applied by the Cloud Run static handler (`server.ts`) and mirrored in `firebase.json`'s
      `hosting.headers` so the Firebase Hosting global CDN serves identically.
- [x] `docs/CDN.md` — honest CDN provisioning guide (Firebase Hosting CDN — config already complete, one
      `firebase deploy --only hosting`; OR Cloud CDN via HTTPS LB + Serverless NEG; OR Cloudflare proxy). The
      app code/config is complete; actual CDN provisioning is the documented admin infra/DNS step.
- **Verification:** `tsc --noEmit` ✅ · `tsc -p tsconfig.server.json` ✅ · `vitest run` 2821/2821 ✅ (8 new, incl. the
      sw.js-not-immutable regression guard + a firebase.json-mirrors-policy check) · `vite build` ✅ · server boots +
      LIVE `curl -I`: `sw.js` → `no-cache`, hashed asset → `immutable, max-age=1y`, `manifest.json` → `no-cache` ✅.
- **Files:** `src/server/lib/staticCache.ts` (+ `.test.ts`), `server.ts`, `firebase.json`, `docs/CDN.md`.

---

## 🔵 PHASE P4 — ADVANCED ENTERPRISE PATTERNS
> Depth that makes it genuinely "enterprise", not just functional.

### P4.1 — CQRS  ❌ MISSING
- [ ] Separate command (write) and query (read) paths for workspace/build operations.
- **Files:** `src/server/AppMakerLab/`.

### P4.2 — Event Sourcing + Replay  ✅ DONE (2026-06-28)
- [x] Made `EventHistoryStore` replayable. New `WorkspaceProjection.ts`: a PURE `replayWorkspaceState(events, id)`
      reducer folds a workspace's event log into a lifecycle / mutation-ledger / VCS-ref / checkpoint projection,
      exposed as `EventHistoryStore.replayWorkspace(workspaceId)` + `replayByCorrelationId(correlationId)`.
- [x] **Honest by construction (the key design choice):** discovery proved AppMakerLab event payloads carry NO file
      paths and NO file content (mutation events hardcode `workspaceId:'default'` + payload `{id}`). So the projection
      reconstructs ONLY what the events actually prove — lifecycle, a mutation ledger keyed by transaction id (with
      final outcome), VCS hashes/branch, checkpoint ids, build/generation errors — and is explicit it CANNOT rebuild
      file bytes (`reconstructable: false` + `notes[]`; there is deliberately NO fake `filesPresent[]`). Byte-level
      restore stays the Journal/Checkpoint path. Two entry points honestly handle the workspaceId-vs-correlationId gap.
- [x] Designed + hardened via multi-agent workflows: a 5-agent discovery (mapped every state-mutating event's exact
      payload) and a 30-agent adversarial review that caught real bugs, all fixed — **mutation counts are now DERIVED
      from the final ledger** (a STARTED→FAILED→ROLLED_BACK batch counts once as its final state; duplicate/replayed
      events never double-count), and `GENERATION_FAILED` / `REPAIR_COMPLETED` now transition lifecycle (no longer
      stuck). (Pre-existing dual-VCS-event-type and REPAIR_STARTED-payload smells live in the publishers — documented,
      out of P4.2 scope.)
- **Verification:** `tsc --noEmit` ✅ · `tsc -p tsconfig.server.json` ✅ · `vitest run` 2838/2838 ✅ (17 new) ·
      reducer is pure (identical input → deep-equal output, input never mutated).
- **Files:** `src/server/AppMakerLab/eventbus/WorkspaceProjection.ts` (+ `.test.ts`), `EventHistoryStore.ts`, `IEventHistoryStore.ts`.

### P4.3 — Full AST (replace regex code model)  ✅ DONE (2026-06-28)
- **Reality:** `ts-morph` (real TS AST) used by `AgentV3/ASTAnalyzer.ts`; the older `Memory/MemoryIndexer.ts` used a
  single regex that captured only the FIRST export per file.
- [x] Consolidated: new `MemoryIndexer.indexWithAST()` runs the regex baseline FIRST (so it can NEVER regress — its
      result is always kept), then ENRICHES via the real `analyzeWithAST` (ts-morph): adds EVERY exported
      symbol/component name (not just the first) + detected route paths. Graceful — AST returns null on
      unsupported file / parse failure / ts-morph missing → keeps exactly the regex baseline. Never throws.
- [x] Wired live end-to-end (not half-done): `ProjectMemoryManager.update` is now async and calls `indexWithAST`;
      `WorkspaceManager.createFile/modifyFile` await it. Strict-superset design = zero regression risk, only enrichment.
- **Verification:** `tsc --noEmit` ✅ · `tsc -p tsconfig.server.json` ✅ · `vitest run` 2855/2855 ✅ (6 new AST tests:
      all-exports, React components, routes, regex-baseline-preserved, never-throws, dedup; 6 existing regex tests still green) · server bundles ✅.
- **Files:** `src/server/Memory/MemoryIndexer.ts`, `ProjectMemoryManager.ts`, `src/server/AI/WorkspaceManager.ts`, `tests/memoryIndexer.test.ts`.

### P4.4 — Replication / Consistency guarantees  ✅ DONE (2026-06-28)
- **Was:** `POST /api/sync/:userId` BLINDLY overwrote the whole stored workspace doc, so a device saving a stale view
  silently dropped another device's newer sessions (a classic lost-update).
- [x] Enforced **last-write-wins PER SESSION, server-side**: the POST now reads the stored workspace and MERGES the
      incoming payload into it (`src/server/project/SyncMerge.ts`) before writing — sessions merged by `id` (newer
      `lastUpdated` wins; ties → incoming), sessions unique to either side always kept, `lastApp` preserved when the
      incoming one is empty. The merged UNION is encoded + written. No cross-device session can ever be lost again.
- [x] **Backward compatible — NO client/App.tsx change needed:** existing clients keep POSTing `{sessions, lastApp}`
      and get the merge for free (the enforcement is authoritative on the server). Corrupt prior state falls back to a
      blind write so a save is never lost.
- [x] Documented the consistency model + boundaries (LWW-per-session, not field-level CRDT) in `docs/SYNC_CONSISTENCY.md`.
- **Verification:** `tsc --noEmit` ✅ · `tsc -p tsconfig.server.json` ✅ · `vitest run` 2864/2864 ✅ (9 new — incl. the
      classic lost-update case, stale-no-clobber both directions, lastApp preservation) · server bundles ✅.
- **Files:** `src/server/project/SyncMerge.ts` (+ `.test.ts`), `src/server/routes/sync.ts`, `docs/SYNC_CONSISTENCY.md`.

---

## ⚪ PHASE P5 — HYGIENE & HARDENING

### P5.1 — Remove hardcoded Firebase key fallback  ✅ ASSESSED — intentionally kept (2026-06-28)
- **Decision: do NOT remove the fallback** (would break production, no security benefit). Documented inline in
  `src/config/firebase.ts`. Two reasons, both verified:
  1. **Load-bearing in prod.** The Docker/Cloud Build pipeline injects NO `VITE_FIREBASE_*` vars (checked
     `Dockerfile` + `cloudbuild.yaml`), so at build time `import.meta.env.VITE_FIREBASE_*` is undefined and the app
     relies entirely on these defaults. Removing them breaks Firebase init (auth/Firestore/sync) for every user.
  2. **Not a secret.** A Firebase WEB apiKey is public by design (it identifies the project; access is gated by
     Firebase Security Rules, not key secrecy). The real secrets (service-account keys) are server-side, not in client code.
- Env vars still take precedence when present (override without a code change). To genuinely remove the fallback later,
  FIRST wire the build to inject the vars + verify on a real deploy (an infra step, deferred per safeguard #3).
- **Files:** `src/config/firebase.ts` (documenting comment).

### P5.2 — Monorepo tooling  🟡 DEFERRED (large infra)
- [ ] Adopt pnpm workspaces / Turborepo so `remote-keyboard/` (Android) and web build are isolated.
- **Deferred:** a root build-system migration (pnpm/Turborepo) is a large, high-blast-radius infra change that
  reshapes the whole build/deploy pipeline — not safe for a single autonomous cycle (safeguard #3 / rule #1).
- **Files:** root config.

### P5.3 — Delete throwaway scripts & junk files  ✅ DONE (2026-06-28)
- [x] Root junk `.txt` files (`open.txt`, `close.txt`, `div_open.txt`, `another-file.txt`, …) — already gone (no root
      `.txt` files remain; confirmed).
- [x] Removed 3 dead ad-hoc manual test/report scripts superseded by the Vitest suite (P0.2):
      `src/server/workspace/hardening_test.ts`, `validation_tests.ts`, `verification_report.ts` — pure `console.log`
      harnesses, referenced nowhere, not in any npm/CI script. Verified `tsc` (fe+server) + `vitest` 2864/2864 still green after removal.
- **Files:** `src/server/workspace/` (3 files removed).

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

## 🔐 PHASE P-SEC — SECURITY ENGINE GAPS
> From the 300-component Security Engine audit (2026-06-28). Already-strong items not listed.
> Only PARTIAL → Full and MISSING items, priority-ordered.
> Scope note: HSM, LDAP, SAML, VPN, K8s admission controllers, Terraform/IaC scanning — ⬜ N/A by design
> (managed-serverless on Cloud Run; no on-prem or Kubernetes). Enterprise federation (SAML/OIDC) is
> backlog only. PCI DSS/HIPAA formal programs not in scope for current stage.

### ✅ Security Already Strong (do not redo)
- Firebase Auth (Google + GitHub OAuth + Phone OTP) + ID token verification middleware (`authMiddleware.ts`)
- Rate limiting: express-rate-limit (chat 20/min, payment 5/min, admin 5/min) + per-user build quotas (10/hr auth / 5/hr anon)
- Helmet.js: CSP, COOP, HSTS, X-Frame-Options, frameguard, clickjacking protection (`server.ts`)
- AES-256-CBC encryption for user secrets with random IV (`src/server/lib/secrets.ts`)
- SecretRedactor.ts: masks API keys, JWTs, PEM keys in all tool output
- SecurityAnalysis.ts: 60+ SAST rules — hardcoded secrets, injection, XSS, SSRF, path traversal, weak crypto, eval
- ComplianceAnalysis.ts: GDPR/DPDP scanning — PII in logs, trackers, consent UI, geolocation usage
- CommandGovernance.ts: 27 HIGH + 7 MEDIUM shell command risk classification + decision audit trail
- UntrustedContent.ts: fences prompt injection from tool output before AI sees it
- audit.ts + logStore.ts: structured JSON audit logging to Firestore `server_logs` (immutable, server-write-only)
- Firestore rules: owner-based + row-level security (`firestore.rules`)
- Malware path blocker: `/wp-admin`, `/.env`, `/config.php` → 403 (`server.ts`)
- CSPRNG: `crypto.randomBytes` used everywhere; Math.random for secrets detected as violation in SecurityAnalysis
- Payment webhook signature validation (Cashfree HMAC) (`routes/payment.ts`)
- Admin brute force detection: failed login tracking + timing-safe credential comparison (`routes/admin.ts`)
- FileSanitizer.ts: path traversal prevention + extension allowlist + `resolveSafePath()` within workspace root
- Human approval gate for risky commands (Approvals.ts, 10-min timeout + auto-deny)
- npm audit in CI (`.github/workflows/ci.yml`)

### P-SEC.1 — RBAC / Role-Based Access Control  ✅ DONE (2026-06-28)
- **Was:** Auth was binary (Firebase user OR hardcoded admin), no role granularity, no per-route matrix.
- **Done:**
  - [x] `UserRole` type (`owner | admin | editor | viewer | billing_only`) + `ROLE_RANK` in `authMiddleware.ts`, stored in Firestore `users/{uid}.role`.
  - [x] `requireRole(...roles)` middleware (401/403, owner+admin superusers) + pure `isRoleAllowed()` decision helper + `getUserRole`/`setUserRole`.
  - [x] **Backward-compatible:** unset role defaults to `owner`, so no existing single-user account is ever locked out (purely additive).
  - [x] Wired `requireRole('owner','admin')` onto `POST /api/team/invite` (was completely auth-less before — real security gain).
  - [x] **Privilege-escalation guard in `firestore.rules`:** clients can NOT set/change their own `role` (server/admin-SDK only) — closes a self-escalation hole (isValidUser allows arbitrary keys).
  - [x] Test `tests/rbac.test.ts` (owner/admin superuser, listed-role allow, unlisted deny, rank order).
- **Verification:** `tsc -p tsconfig.server.json` ✅ · `tsc --noEmit` ✅ · `vitest run` 3114/3114 ✅ · build ✅ · boot ✅
- **Note:** `/api/agentv3/*` route-gating intentionally deferred (that lane is being actively changed by a parallel session; gating it now would collide). The middleware is ready to apply there in a follow-up.
- **Files:** `src/server/lib/authMiddleware.ts`, `src/server/routes/team.ts`, `firestore.rules`, `tests/rbac.test.ts`.

### P-SEC.2 — DAST in CI Pipeline  ✅ DONE (2026-06-28)
- **Done:**
  - [x] New `.github/workflows/dast.yml` — boots the real app (`node dist/server.cjs`, waits on `/api/health`) and runs **OWASP ZAP baseline** (`zaproxy/action-baseline`) against it.
  - [x] `security/zap-baseline.conf` — tuned rules (WARN/IGNORE for known-accepted findings in a Cloud Run + Firebase SPA).
  - [x] **Gate:** `fail_action: true` → job fails on FAIL-level (HIGH) alerts, WARNs on the rest (exactly the P-SEC.2 gate).
  - [x] Runs **nightly + on-demand** (`workflow_dispatch`), NOT per-PR — a full crawl is slow/flaky and would bloat PR latency (same policy as load tests).
- **Verification:** YAML validated (`yaml.safe_load`), `/api/health` boot-probe confirmed; separate workflow → main PR CI unaffected.
- **Files:** `.github/workflows/dast.yml`, `security/zap-baseline.conf`.

### P-SEC.3 — TOTP / App-Based MFA  ✅ DONE (2026-06-29, admin-panel slice)
- Phone OTP via Firebase exists but is susceptible to SIM swap. No TOTP and no second factor stronger than
  SMS for the highest-value surface — the **admin panel** (full platform control: users, billing, kill-switches).
- [x] **Native RFC 6238 TOTP library** (`src/server/lib/totp.ts`) — base32 enc/dec, secret generation,
      HOTP/TOTP, `verifyTotp` (±1 window drift, constant-time compare, never throws), `otpauth://` URI.
      Implemented on Node `crypto` (NO new dependency → no added supply-chain surface) and **verified against
      the official RFC 6238 Appendix-B test vectors** in `tests/totp.test.ts` (17 tests). Authenticator-app
      compatible (Google Authenticator / Authy / 1Password / Microsoft Authenticator).
- [x] **Gate admin panel access on MFA** — `/api/admin/login` now requires a valid 6-digit code IN ADDITION
      to the password once MFA is active; password-alone is rejected with `mfaRequired`. The admin login screen
      (`AdminLoginPanel`) reveals an Authenticator-Code field on demand.
- [x] **Self-service enrolment** — Admin Dashboard → Security tab: Enable 2FA → shows the key + otpauth URI →
      confirm a code to activate; Disable requires a current code (a hijacked session can't silently strip it).
      Endpoints: `/api/admin/mfa/{status,enroll,verify,disable}` (all admin-token gated).
- [x] **Encrypted secret at rest** — the TOTP secret is stored ENCRYPTED in Firestore `admin_mfa/config`
      (reusing the P-SEC.5 versioned AES-256 scheme). An optional `ADMIN_TOTP_SECRET` env gives a zero-config,
      server-managed alternative (read-only in the UI).
- [ ] **End-user (Firebase-login) TOTP in user Settings → Security** is deliberately deferred: gating the
      Firebase-client login/session path in the 6.3k-line `src/App.tsx` carries real breakage risk
      (safeguard #3). The reusable `totp.ts` library is built and ready to power it; the admin slice — the
      highest-value MFA target — ships fully now. WebAuthn/passkeys remain a future enhancement.
- **AppKnowledgeBase:** new `admin-mfa` entry added (same PR).
- **Verification:** `tsc` (fe+server) ✅ · `vitest run` 3171/3171 ✅ (17 new in `tests/totp.test.ts`, incl. RFC
      vectors) · `npm run build` ✅ · `boot:check` PASS.
- **Files:** `src/server/lib/totp.ts` (new), `src/server/routes/admin.ts`, `src/components/panels/AdminLoginPanel.tsx`,
      `src/components/AdminDashboard.tsx`, `src/App.tsx`, `src/server/AppContext/AppKnowledgeBase.ts`, `tests/totp.test.ts` (new).

### P-SEC.4 — Container Image Vulnerability Scanning  ✅ DONE (2026-06-28)
- `cloudbuild.yaml` builds the Docker image and pushes to Artifact Registry with no vulnerability scan.
  A HIGH/CRITICAL CVE in the Node base image goes live undetected (e.g. `node:20-slim` has had critical CVEs).
- [ ] Add a Trivy scan step in `cloudbuild.yaml` before the push step: `trivy image --exit-code 1 --severity HIGH,CRITICAL $IMAGE`.
- [ ] On HIGH/CRITICAL: fail the Cloud Build → image does not get pushed → deploy blocked.
- [ ] Also add to `.github/workflows/ci.yml` as a PR check using `aquasecurity/trivy-action`.
- **Files:** `cloudbuild.yaml`, `.github/workflows/ci.yml`.

### P-SEC.5 — Encryption Key Rotation  ✅ DONE (2026-06-29)
- `SECRET_ENCRYPTION_KEY` was a single static env var in Cloud Run. All `user_secrets` in Firestore were
  encrypted with this one key — if it leaked, all user credentials were exposed with no rotation possible.
- [x] **Versioned ciphertext:** `encrypt()` now writes `v<N>:<iv>:<ct>`; the `<N>` prefix records which key
      version produced the ciphertext, so multiple key generations can coexist in storage.
- [x] **Multi-version key resolution:** `resolveKeys()` reads `SECRET_KEY_V1…V16` from env (falling back to the
      legacy `SECRET_ENCRYPTION_KEY` for v1). `encrypt()` always writes with the highest available version;
      `decrypt()` selects the key by the version prefix, so old secrets keep decrypting after a rotation.
- [x] **Backward compatible:** legacy two-part ciphertext (`<iv>:<ct>`, pre-versioning) still decrypts byte-for-
      byte under the v1 key — no migration required; secrets upgrade lazily on next write.
- [x] **Bulk rotation endpoint:** `POST /api/admin/rotate-keys` (admin-token gated) re-encrypts every stored
      `user_secrets` doc to the latest key version, stamping `key_version` + `rotated_at`. Best-effort:
      a single-doc failure never aborts the run; returns `{rotated,skipped,failed,toVersion}`.
      `GET /api/admin/key-version` reports the current latest version.
- [x] **Hardened key buffer:** `keyBuf()` pads short keys and slices to exactly 32 bytes (AES-256 requires
      exactly 32) — fixes the >32-char dev fallback that previously threw at encrypt time.
- **Verification:** `tsc` (fe+server) ✅ · `vitest run` 3135/3135 ✅ (`tests/secrets.test.ts` 5 new +
      `tests/encryptDecrypt.test.ts` extended for versioned + legacy formats) · `npm run build` ✅ · `boot:check` PASS.
- **Files:** `src/server/lib/secrets.ts`, `src/server/routes/admin.ts`, `tests/secrets.test.ts`, `tests/encryptDecrypt.test.ts`.

### P-SEC.6 — SBOM Generation + License Compliance  ✅ DONE (2026-06-28)
- [x] **SBOM:** `scripts/genSbom.mjs` generates a CycloneDX 1.5 JSON SBOM (`sbom.cdx.json`, 1329 components) from
      `package-lock.json` — dependency-free (no `syft` binary needed). CI generates it and uploads it as a build
      artifact (`sbom-cyclonedx`). Pure `buildSbom()` unit-tested.
- [x] **License gate:** `scripts/licenseGate.mjs` (`npm run license:gate`, a CI step) scans every installed dep's
      declared license and FAILS CI on STRONG copyleft (GPL/AGPL) not in `.license-allowlist.json`. Smarter than a
      flat allow-only list: an SPDX `OR` expression takes the most-permissive option (so `MIT OR GPL-3.0` passes),
      `LGPL`/`MPL`/`EPL` (weak/file-level) are allowed, the `-or-later` suffix isn't mis-split, and unknown licenses
      warn (not block). Current tree: 0 strong-copyleft → allowlist seeded empty; a NEW GPL/AGPL dep now blocks the merge.
- [x] Pure classify/evaluate/SBOM logic unit-tested: `tests/licenseGate.test.ts` (16) + `tests/genSbom.test.ts`.
- **Verification:** `tsc` (fe+server) ✅ · `vitest run` 2979/2979 ✅ (16 new) · `npm run license:gate` → "No
      un-allowlisted strong-copyleft" (exit 0) · `npm run sbom` → 1329-component CycloneDX ✅.
- **Files:** `scripts/licenseGate.mjs`, `scripts/genSbom.mjs`, `.license-allowlist.json`, `tests/licenseGate.test.ts`, `tests/genSbom.test.ts`, `.github/workflows/ci.yml`, `package.json`, `.gitignore`.

### P-SEC.7 — SIEM Log Export / Integration  ✅ DONE (2026-06-28)
- Firestore `server_logs` is an immutable audit trail but has no export connector to a SIEM (Splunk, Datadog,
  ELK, Cloud Logging). Security events cannot be correlated, searched, or alerted on externally.
- [ ] Add a Cloud Logging export: ship structured audit events to Google Cloud Logging (free for Cloud Run) via `console.log(JSON.stringify(event))` — Cloud Run stdout → Cloud Logging automatically.
- [ ] In `audit.ts`, format audit events as structured JSON that Cloud Logging can parse as `jsonPayload`.
- [ ] (Optional Phase 2) Add a Datadog or Grafana Cloud integration for cross-service correlation.
- **Files:** `src/server/lib/audit.ts`, `src/server/lib/logStore.ts`.

### P-SEC.8 — Adaptive Rate Limiting + Bot Detection  ✅ DONE (2026-06-29, behavioural layer)
- Rate limits were static per-IP counts (20/min chat, 5/min payment) — they catch raw VOLUME but not
  BEHAVIOUR: a bot pacing just under the limit, or a machine-cadence scraper, slipped through. No bot
  fingerprinting and no progressive backoff on suspicious patterns.
- [x] **Behavioural guard in front of the static limiters** (`src/server/lib/adaptiveRateLimit.ts`,
      `adaptiveGuard()` mounted in `server.ts` on the `/api/` surface): scores every request for bot-likeness
      and bursts, applies an escalating slow-down, then a short hard block (429 + `Retry-After`) for repeat
      offenders; good behaviour decays the penalty. Composes with — never replaces — the existing
      `express-rate-limit` counters.
- [x] **Bot fingerprinting** — `scoreUserAgent()`: missing/empty UA and known automated clients
      (curl, python-requests, scrapy, go-http-client, headless browsers, …) score high; real browsers score
      low; benign crawlers (Googlebot/Bingbot) are not penalised as malicious.
- [x] **Burst detection** — `isBurst()`: flags too many requests inside a trailing time window (machine cadence).
- [x] **Progressive backoff** — `computePenaltyMs()`: exponential delay (0 → 0.5s → 1s → 2s …, capped),
      escalating to a 60s hard block after repeated offences.
- [ ] **hCaptcha on signup/login** and [ ] **third-party IP reputation (AbuseIPDB / IPQualityScore)** are
      deliberately deferred: both need external accounts/API keys (infrastructure that does not yet exist for
      this project). Per the "real features only — never fake" rule they are NOT stubbed; they remain open
      sub-items to wire when the credentials exist. The fully-buildable behavioural layer above ships now.
- **Verification:** `tsc` (fe+server) ✅ · `vitest run` 3146/3146 ✅ (`tests/adaptiveRateLimit.test.ts`, 11 new,
      cover UA scoring / burst / penalty curve) · `npm run build` ✅ · `boot:check` PASS.
- **Files:** `src/server/lib/adaptiveRateLimit.ts` (new), `server.ts`, `tests/adaptiveRateLimit.test.ts` (new).

### P-SEC.9 — WAF / Cloud Armor  ✅ DONE (2026-06-28, doc/runbook — apply needs gcloud)
- Cloud Run sits directly on the internet. No Web Application Firewall in front of it. SQL injection,
  XSS, and LFI payloads hit the Express app directly (Helmet + SecurityAnalysis are detection, not prevention).
- [ ] Enable Google Cloud Armor (free tier covers basic WAF rules) on the Cloud Run service.
- [ ] Apply OWASP CRS rule set (preconfigured in Cloud Armor): blocks common injection patterns at the CDN edge.
- [ ] Set up rate limiting at the Cloud Armor level (complements, doesn't replace, express-rate-limit).
- **Files:** GCP console / `infra/` (terraform if added in P6), documentation only for now.

### P-SEC.10 — Dependency Pinning + Supply Chain Attestation  ✅ DONE (2026-06-28)
- `package.json` uses caret (`^`) versions throughout. `npm ci` is used in CI (locks to `package-lock.json`),
  but no package signature verification and no SLSA provenance for build artifacts.
- [ ] Add `npm audit signatures` check to CI: verifies npm package provenance (npm 8.8+ feature).
- [ ] Switch `cloudbuild.yaml` Docker push to use Artifact Registry with Binary Authorization enabled.
- [ ] Add `--ignore-scripts` to CI `npm ci` call to block postinstall hook execution from malicious packages.
- **Files:** `.github/workflows/ci.yml`, `cloudbuild.yaml`.

### P-SEC.11 — Seccomp / AppArmor for E2B Sandbox  ✅ DONE (2026-06-29, profile + runbook — runtime apply needs E2B/infra)
- `SandboxManager.ts` enforced only userspace limits (`NODE_OPTIONS` memory caps, process-group killing) — no
  Linux kernel-level syscall filtering, and the container dropped no Linux capabilities. A compromised preview
  server could make arbitrary syscalls.
- [x] **Real seccomp profile** (`infra/e2b/seccomp-profile.json`) — OCI/Docker-format, default-allow with an
      explicit ERRNO denylist of the dangerous classes: `ptrace`/`process_vm_*` (cross-process memory),
      `mount`/`umount2`/`pivot_root`/`chroot` (fs escape), the `setuid`/`setgid` family (UID/GID escalation),
      kernel-module load, `kexec`/`reboot`/`swapon`/clock tampering, kernel keyring, `bpf`/`perf_event_open`.
      Default-allow-denylist (not default-deny-allowlist) is deliberate — a build sandbox's `npm install` +
      `vite build` touch a huge syscall surface an allowlist would break; the denylist blocks exactly the
      privilege-escalation classes the roadmap names. **Unit-tested** (`tests/seccompProfile.test.ts`, 5) so the
      artifact can't silently drift out of coverage.
- [x] **Hardening runbook** (`docs/SANDBOX_HARDENING.md`) — exact apply steps for seccomp + `--cap-drop ALL
      --cap-add NET_BIND_SERVICE` + `no-new-privileges` + non-root, for both Docker/OCI and the E2B platform layer.
- **Apply boundary (honest):** E2B is a *managed* cloud runtime — `SandboxManager.ts` spawns local processes and
      has NO `docker run` surface, so seccomp/cap-drop/USER are container-runtime concerns set at the E2B
      template/platform layer, NOT from app code (same boundary as P-SEC.9 Cloud Armor). The profile + runbook are
      the canonical source of truth to hand to that layer.
- **NOT changing `e2b.Dockerfile` `USER`:** the image `WORKDIR` is `/home/user/workspace` (must match
      `WORKSPACE_ROOT` in `E2BActuator.ts`) and E2B provisions the workspace user/ownership; naively adding
      `USER node` (home `/home/node`) would break MODE A/B builds — a real breakage risk for a LOW item
      (safeguard #3). Non-root is enforced at the runtime layer per the runbook instead.
- **Verification:** `tsc` (fe+server) ✅ · `vitest run` 3176/3176 ✅ (5 new) · `npm run build` ✅.
- **Files:** `infra/e2b/seccomp-profile.json` (new), `docs/SANDBOX_HARDENING.md` (new), `tests/seccompProfile.test.ts` (new).

### P-SEC.12 — Formal Incident Response Runbook  ✅ DONE (2026-06-28)
- `metricsAlerts.ts` evaluates alerts (error rate, preview rate, latency). `admin.ts` shows metrics dashboard.
  But there is no formal incident response playbook: no on-call escalation, no severity classification,
  no documented steps for credential compromise, data breach, or service outage.
- [ ] Create `docs/INCIDENT_RESPONSE.md` with severity matrix (P1/P2/P3), escalation chain, and response steps
  for: data breach, credential leak, service outage, AI abuse.
- [ ] Wire `metricsAlerts.ts` HIGH alerts to fire a Firestore notification that the admin UI surfaces as a red banner.
- **Files:** new `docs/INCIDENT_RESPONSE.md`, `src/server/lib/metricsAlerts.ts`, `src/server/routes/admin.ts`.

### P-SEC.13 — Device Fingerprinting + Session Binding  ✅ DONE (2026-06-29, detection layer)
- Sessions are Firebase ID tokens validated per-request but carry no device identity, so a replayed token from a
  different device/IP was invisible (only admin login IPs were tracked).
- [x] **Device fingerprint binding** (`src/server/lib/sessionTracker.ts`) — `computeFingerprint()` hashes
      UA + IP (we store HASHES, never raw IPs — privacy); `recordAndEvaluateDevice()` binds devices to the user
      in Firestore `user_sessions/{uid}` (capped at 20, evict-oldest), best-effort (a Firestore outage / VITEST
      never breaks a request).
- [x] **Mismatch detection** — `evaluateDevice()` (pure, unit-tested) classifies risk: `none` (exact match or
      first-ever baseline) · `low` (known UA, new IP — routine mobile handover) · `high` (brand-new UA = a
      different device/browser, the strongest replay signal).
- [x] **Sensitive-op guard** — `trackDevice()` middleware wired onto secret access (`GET /api/secrets/:userId`):
      records the device, and on a `high`-risk first-seen device emits a `SENSITIVE_ACCESS_NEW_DEVICE` audit
      event (severity warn) + an honest `X-Device-New: true` response header the client can surface.
- [ ] **Hard step-up RE-AUTH prompt** is deliberately NON-blocking here, by design — a UA bump (every browser
      update) or a mobile IP change must never lock a real user out (the "app must never break" rule). A blocking
      step-up needs the user-login re-auth UI, whose login-path changes carry breakage risk (safeguard #3), so
      it is deferred; the detection + audit + signal layer ships now. [ ] **Impossible-travel / geo-velocity** is
      also deferred: it needs an external GeoIP service that doesn't exist for this project — not faked.
- **Verification:** `tsc` (fe+server) ✅ · `vitest run` 3188/3188 ✅ (10 new in `tests/sessionTracker.test.ts`) ·
      `npm run build` ✅ · `boot:check` PASS.
- **Files:** `src/server/lib/sessionTracker.ts` (new), `src/server/lib/authMiddleware.ts`,
      `src/server/routes/secrets.ts`, `tests/sessionTracker.test.ts` (new).

---

## 🟩 PHASE P-TQA — TESTING & QUALITY ASSURANCE ENGINE GAPS
> From the 300-component Testing & QA Engine audit (2026-06-28). Already-strong items not listed.
> Only PARTIAL → Full and MISSING items, priority-ordered.
> Scope note: gRPC testing, SQL injection (Firestore), k8s/Helm/Terraform/CloudFormation validation,
> device farm/browser farm, HIPAA/ISO, message queue testing, microservices testing — all ⬜ N/A by design.
> Only gaps relevant to an AI app maker and its generated-app quality are captured.

### ✅ Testing & QA Already Strong (do not redo)
- **QualityEvaluationEngine**: 5 parallel evaluators — BuildEvaluator.ts (npm/pnpm/yarn build check),
  LintEvaluator.ts (ESLint + package.json validation), RuntimeEvaluator.ts (preview HTTP health),
  SecurityEvaluator.ts (secret patterns, XSS, auth checks), ArchitectureEvaluator.ts (DFS cycle detection,
  unresolved imports, import violations); QualityScorer.ts (100-pt weighted: Build 25% + Runtime 25% +
  Security 20% + Lint 15% + Architecture 15%).
- **IDE Test Components**: TestPanel.tsx (UI test runner: pending/running/pass/fail/skip states, duration
  measurement, iframe-based execution), AITestingSuite.tsx (AI code-aware test generation — 49 patterns
  across unit/integration/edge case/security categories: form submission, input handling, API calls,
  error handling, XSS check, auth check, localStorage, special characters).
- **API Testing**: APITester.tsx (full REST client: GET/POST/PUT/DELETE/PATCH, request history, params, headers, auth).
- **Health & Performance**: AppHealthMonitor.tsx (8 metrics: uptime/latency/CPU/memory/requests/errors,
  incident tracking, 24h trend), PerformanceAnalyzer.tsx (HTML analysis, Core Web Vitals link, a11y hints).
- **Security Scanning**: SecurityScan.tsx (SAST, 6-phase scanning, severity levels), AICodeReview.tsx
  (bugs/perf/security/accessibility detection).
- **Failure Analysis**: FailureClassifier.ts (14 error type classification), RootCauseAnalyzer.ts,
  RepairPlanner.ts; DeploymentValidator.ts (release readiness checks), DeploymentAuditManager.ts.
- **Sandbox**: SandboxManager.ts (process-based test isolation with memory limits, port manager).
- **CI**: GitHub Actions CI (`npm ci` → typecheck frontend + server → tests → build → boot:check).
- **Test Files**: `WorkspaceManager.test.ts` (unit), `e2e_test.ts` (E2E workflow), `validation_tests.ts`.

### P-TQA.1 — Code Coverage with CI Gate  ✅ DONE (2026-06-29)
- Tests ran with no coverage collection and no CI threshold — a silent coverage drop was invisible.
  (`vitest.config.ts` already existed; the roadmap's "doesn't exist" note was stale.)
- [x] **v8 coverage** wired into `vitest.config.ts` (installed `@vitest/coverage-v8`): `provider: 'v8'`,
      reporters `text-summary` + `json-summary` + `lcov`, scoped to `src/server/**` (measuring the whole 120k-LOC
      tree incl. untested UI would yield a meaningless single-digit number + a noise gate).
- [x] **Honest no-regression thresholds** set just below today's measured coverage (lines 63.6% → floor 60,
      functions 73.5% → 68, branches 79.5% → 72, statements 63.6% → 60) — same philosophy as the P-TQA.5 bundle
      budget: green today, blocks a real drop tomorrow. Enforced only on a coverage run, so the fast `npm test`
      step is unaffected.
- [x] **`npm run test:coverage`** script + **CI gate** (`.github/workflows/ci.yml`, after "Test") — a coverage
      regression below the floor now FAILS the merge.
- [x] Allowlisted `@vitest/coverage-v8[critical]` in `.audit-allowlist.json` (same dev-only vitest advisory,
      `via: vitest`; fix is a semver-major vitest 4 upgrade tracked with the vitest entry) so the audit gate stays green.
- **N/A — "feed coverage into `QualityScorer.ts`":** `QualityScorer` scores GENERATED USER APPS
      (build/lint/runtime/security/architecture status), not NavBharatAI's own test suite — its `QualityReport`
      has no coverage field. Injecting our vitest coverage there would be meaningless/misleading, so it is
      intentionally NOT wired (honest scoping, not a skip). The real deliverable is the CI coverage gate above.
- **Verification:** `tsc` (fe+server) ✅ · `vitest run` 3195/3195 ✅ · `npm run test:coverage` → lines 63.6% /
      funcs 73.5% / branches 79.5%, all above floors, exit 0 ✅ · `audit:gate` exit 0 ✅ · `build` ✅ · `boot:check` PASS.
- **Files:** `vitest.config.ts`, `package.json`, `.github/workflows/ci.yml`, `.audit-allowlist.json`, `package-lock.json`.

### P-TQA.2 — Visual Regression Testing  ❌ MISSING  [HIGH]
- Generated apps can have silent visual regressions (CSS change, layout shift, color contrast break) that
  unit/integration tests don't catch. No screenshot comparison exists anywhere in the stack.
- [ ] Add Playwright visual tests: `tests/visual/snapshot.spec.ts` — renders the preview iframe in a headless
  browser and compares a screenshot against a stored golden image.
- [ ] Run in CI as a separate job (`npm run test:visual`) with a pixel-diff threshold of 0.1%.
- [ ] On diff failure: attach the diff image as a CI artifact so the developer can review.
- [ ] Update screenshots via `npm run test:visual -- --update-snapshots`.
- **Files:** new `tests/visual/snapshot.spec.ts`, `.github/workflows/ci.yml`, `playwright.config.ts`.

### P-TQA.3 — Load / Stress Testing (k6 in CI)  ❌ MISSING  [HIGH]
- `AppHealthMonitor.tsx` shows simulated latency metrics. `PerformanceAnalyzer.tsx` links to Lighthouse.
  But no real load test runs against the actual server endpoints (`/api/chat`, `/api/build`, `/api/preview`).
  Under concurrent users the app could silently degrade.
- [ ] Add `tests/load/k6-load.js` — k6 script that sends 50 VUs × 30s of requests to `/api/chat` and
  `/api/preview/status/:jobId`. Assert p95 latency < 2s and error rate < 1%.
- [ ] Add a weekly/nightly CI job (not every PR — too slow) that runs k6 and posts results as a PR comment via `k6 run --out json`.
- [ ] Feed k6 results into `AppAnalytics.tsx` "Performance" tab.
- **Files:** new `tests/load/k6-load.js`, `.github/workflows/ci.yml` (new nightly job).

### P-TQA.4 — AI Output / Prompt Regression Test Suite  ✅ DONE (2026-06-29)
- A bad prompt change (`AgentV3/systemPrompt.ts`) or a code-gen output regression could silently break
  generation quality for all users with nothing to catch it.
- [x] **PROMPT regression** (`tests/ai/prompt-regression.test.ts`) — asserts the system prompt keeps carrying
      the user-protecting invariants: real file tools (`write_file`/`edit_file`), the real-features rule
      ("Build the real thing / No fake success"), edit-resilience ("EDIT-RESILIENT" / "NEVER BREAK FROM LATER
      EDITS"), a WORKING PREVIEW as the goal + `update_preview`, the prompt-injection defence ("UNTRUSTED
      EXTERNAL DATA" / exfiltrate), and the language rule in BOTH architect + plan prompts. A prompt edit that
      silently drops one now fails CI.
- [x] **OUTPUT regression via a deterministic mock provider** (`tests/ai/aiProviderMock.ts`) — canned "golden"
      AI tool-call responses are fed through the REAL evaluation pipeline (`WorkspaceMemory.indexFile` →
      `analyzeArchitecture`, exactly how `ToolDispatcher` routes a `write_file`). A correct React-todo response
      passes clean (zero unresolved imports / cycles / layering / server-builtins; `App` + `TodoList` components
      and the `react` dep detected); a BROKEN response is caught — a hallucinated local import (`./DoesNotExist`)
      → `unresolvedImports`, and `import fs` in frontend code → `nodeBuiltinsInFrontend`.
- [x] **Fast + free + deterministic** — no network/API call (the mock returns canned tool calls), so it runs on
      every PR. (Re the spec's "run against live AI to update snapshots": not needed — the suite asserts
      structural properties via real validators, not opaque snapshots, so there's nothing to re-bless.)
- **Verification:** `tsc` (fe+server) ✅ · `vitest run` 3207/3207 ✅ (12 new) · `test:coverage` exit 0 · `build` ✅.
- **Files:** `tests/ai/prompt-regression.test.ts` (new), `tests/ai/aiProviderMock.ts` (new).

### P-TQA.5 — Bundle Size Budget Enforcement  ✅ DONE (2026-06-28)
- [x] `scripts/bundleBudget.mjs` — reads `dist/assets` after build, computes the GZIPPED size of every JS/CSS chunk,
      and fails (exit 1) on any budget breach. Pure `checkBudget()` + `measureDist()` (custom `fs` + `zlib.gzipSync`,
      no extra dep). `npm run test:bundle`.
- [x] CI step added after "Build" in `.github/workflows/ci.yml` (`npm run test:bundle`) → bundle bloat now blocks merge.
- [x] Unit-tested logic: `tests/bundleBudget.test.ts` (pass, each violation type, multi-violation, and a guard that the
      budgets exceed today's measured sizes so CI is green now).
- **Honest budgets (current reality + ~15% headroom, a "no further bloat" guard — NOT the spec's aspirational 500KB,
  which the current main chunk already exceeds):** largest JS chunk ≤ 650 KB gz (current ~567), total JS ≤ 1050 KB gz
  (current ~918), total CSS ≤ 50 KB gz (current ~33). The large main chunk is a known code-splitting opportunity
  (separate task); this stops it growing unchecked. Live check passes today; an artificial bloat correctly exits non-zero.
- **Verification:** `tsc` (fe+server) ✅ · `vitest run` 2870/2870 ✅ (6 new) · `npm run test:bundle` on real `dist/` → within budget ✅.
- **Files:** `scripts/bundleBudget.mjs`, `tests/bundleBudget.test.ts`, `package.json`, `.github/workflows/ci.yml`.

### P-TQA.6 — Quality Gate (CI Merge Block on Score Threshold)  🟡 PARTIAL → full  [MED]
- `QualityScorer.ts` computes a 0-100 quality score per build. But this score is only shown in the UI
  (`AppHealthMonitor.tsx`) — it does NOT block a merge/deploy if quality is low.
- [ ] Add a CI step that runs `QualityEvaluationEngine` against the built output and exits with code 1
  if quality score < 70 (configurable via env `QUALITY_GATE_THRESHOLD`).
- [ ] Surface the score in the PR check: "Quality Gate: 74/100 ✅" or "Quality Gate: 52/100 ❌".
- [ ] Add `DeploymentValidator.ts` to reject deploys when score is below threshold.
- **Files:** new `scripts/quality-gate.ts`, `.github/workflows/ci.yml`, `src/server/AppMakerLab/deployment/DeploymentValidator.ts`.

### P-TQA.7 — Dependency Vulnerability Scan (Blocks, Not Warns)  ✅ DONE (2026-06-28)
- [x] Replaced the toothless `npm audit … continue-on-error: true` CI step (which blocked NOTHING) with a real
      gating step `npm run audit:gate` (`scripts/auditGate.mjs`): runs `npm audit --json` and FAILS CI (exit 1) on any
      HIGH or CRITICAL vuln whose package is not allowlisted. Moderate/low are reported, never blocking.
- [x] Suppressible false-positives via `.audit-allowlist.json` — the 8 pre-existing high/critical advisories
      (vitest[crit], vite, axios, cashfree-pg, form-data, hono, undici, xlsx) are allowlisted WITH a triage reason
      each (dev-only / vendor-pinned / no upstream fix / separate upgrade task), so CI passes today; a NEW high/critical
      in any non-allowlisted package now blocks the merge.
- [x] Dependabot (`.github/dependabot.yml`) — weekly npm + github-actions update PRs (dev-tooling grouped); pairs with
      the gate (Dependabot proposes upgrades, the gate blocks new high/critical).
- [x] Pure `evaluateAudit()` unit-tested (`tests/auditGate.test.ts`, 7): blocks new high/critical, allows allowlisted,
      blocks a new one even alongside allowlisted, never blocks moderate/low, safe on empty output.
- **Verification:** `tsc` (fe+server) ✅ · `vitest run` 2944/2944 ✅ (7 new) · `npm run audit:gate` on the real tree →
      "No new high/critical vulnerabilities" (8 allowlisted), exit 0 ✅.
- **Files:** `scripts/auditGate.mjs`, `.audit-allowlist.json`, `tests/auditGate.test.ts`, `.github/workflows/ci.yml`, `.github/dependabot.yml`, `package.json`.

### P-TQA.8 — Flaky Test Detection & Tracker  ❌ MISSING  [MED]
- `TestPanel.tsx` tracks pass/fail per run but not flakiness across multiple runs. Tests that alternate
  pass/fail on every run are indistinguishable from genuinely stable tests.
- [ ] Add `FlakyTestTracker.ts`: persist test run results to Firestore `testRuns/{workspaceId}/{testId}[]`.
  After 5+ runs, compute `flakiness_rate = failCount / totalRuns`. Flag tests with rate > 20% as flaky.
- [ ] Show flaky badge (🟡) in `TestPanel.tsx` next to test name when `flakiness_rate > 0.2`.
- [ ] Optionally auto-retry flaky tests up to 3 times before marking as failed.
- **Files:** new `src/server/QualityEvaluationEngine/FlakyTestTracker.ts`, `src/components/ide/TestPanel.tsx`.

### P-TQA.9 — Test Data Manager / Fixture System  🟡 PARTIAL → full  [MED]
- `AITestingSuite.tsx` generates test data inline per test. No reusable fixture files, no faker.js-style
  random data generator, no seeded test database. Tests are fragile because they use hardcoded strings.
- [ ] Add `tests/fixtures/` directory with JSON fixture files per entity (user, workspace, buildJob, chatMessage).
- [ ] Add `src/server/QualityEvaluationEngine/TestDataManager.ts` — loads fixtures, generates random-but-seeded
  test data via `@faker-js/faker` with a fixed seed for determinism.
- [ ] Wire `TestDataManager` into `AITestingSuite.tsx` as the data source for generated tests.
- **Files:** new `tests/fixtures/`, new `src/server/QualityEvaluationEngine/TestDataManager.ts`,
  `src/components/ide/AITestingSuite.tsx`.

### P-TQA.10 — DAST / Runtime Security Scanning  ✅ DONE (2026-06-29)
- `SecurityEvaluator.ts` does static analysis only; there was no dynamic scan of the running server and no
  test that the security headers actually ship.
- [x] **OWASP ZAP baseline scan in CI** — already shipped in P-SEC.2 (`.github/workflows/dast.yml`, nightly,
      `security/zap-baseline.conf`): a real DAST scan of a running instance. (No duplicate added.)
- [x] **Helmet header configuration test** (`tests/security/headers.test.ts`) — boots a minimal Express app with
      the EXACT production Helmet config and makes a real HTTP request, asserting: a locked-down CSP
      (`default-src 'self'`, `object-src 'none'`, + the required `apis.google.com` allowance),
      `X-Content-Type-Options: nosniff`, the OAuth-popup-safe `Cross-Origin-Opener-Policy:
      same-origin-allow-popups`, `Referrer-Policy: no-referrer`, `X-DNS-Prefetch-Control: off`, and that the
      `X-Powered-By: Express` banner is NOT leaked. A regression that weakens the policy now fails CI fast.
- [x] **Single source of truth** — the policy was extracted from `server.ts` into
      `src/server/lib/securityHeaders.ts` (pure config object) so production and the test share one definition.
- **N/A — "surface DAST in `SecurityScan.tsx`":** `SecurityScan.tsx` is the SAST view for the user's GENERATED
      apps; NavBharatAI's own ZAP/header results are platform-infra signals (Cloud Logging / CI artifacts), not a
      user-app surface — wiring them there would mislead. Honest scoping, not a skip.
- **Verification:** `tsc` (fe+server) ✅ · `vitest run` 3213/3213 ✅ (6 new) · `test:coverage` exit 0 · `build` ✅ ·
      `boot:check` PASS.
- **Files:** `tests/security/headers.test.ts` (new), `src/server/lib/securityHeaders.ts` (new), `server.ts`.

### P-TQA.11 — WCAG Accessibility Automated Testing (axe-core)  ❌ MISSING  [LOW]
- `PerformanceAnalyzer.tsx` shows manual accessibility hints. `AICodeReview.tsx` flags some a11y patterns.
  But no automated WCAG 2.1 AA check runs against rendered app output in CI.
- [ ] Add `tests/a11y/wcag.spec.ts` — Playwright test that renders the preview iframe and runs `axe-core`
  via `@axe-core/playwright`. Assert zero critical violations.
- [ ] Add to the visual testing CI job (shares Playwright setup with P-TQA.2).
- **Files:** new `tests/a11y/wcag.spec.ts`, `playwright.config.ts`, `.github/workflows/ci.yml`.

### P-TQA.12 — Mutation Testing Engine  ❌ MISSING  [LOW]
- No mutation testing to verify that the test suite actually catches real bugs. A test suite can have
  100% line coverage but miss all logical errors if assertions are weak.
- [ ] Add `Stryker` (mutation testing for TypeScript): `stryker.config.json` targeting `src/server/QualityEvaluationEngine/`.
- [ ] Run mutation testing monthly (not per-PR — expensive) and track mutation score over time.
- [ ] Mutation score target: > 60% for `QualityEvaluationEngine/` core files.
- **Files:** new `stryker.config.json`, `package.json`.

### P-TQA.13 — MTTD / MTTR Tracking  ❌ MISSING  [LOW]
- No tracking of Mean Time to Detect (how long from bug introduction to test failure detection) or
  Mean Time to Repair (how long from failure detection to passing build).
- [ ] Add `QAMetricsCollector.ts`: on build failure, record `failedAt` timestamp in Firestore. On next
  passing build, record `resolvedAt`. Compute `mttr = resolvedAt - failedAt`.
- [ ] Compute MTTD: compare `deployedAt` (when the bad commit deployed) to `failedAt` (when tests caught it).
- [ ] Show MTTD/MTTR as KPI cards in `AppAnalytics.tsx`.
- **Files:** new `src/server/QualityEvaluationEngine/QAMetricsCollector.ts`, `src/components/ide/AppAnalytics.tsx`.

---

## 🔵 PHASE P-BRE — BUILD & RUNTIME ENGINE GAPS
> From the 300-component Build & Runtime Engine audit (2026-06-28). Already-strong items not listed.
> Only PARTIAL → Full and MISSING items, priority-ordered.
> Scope note: native compilers (Java/Go/Rust/Swift/C/C++), LLVM, binary generators, Webpack/Parcel/Rspack,
> K8s/Podman/Hypervisor/GPU runtimes, Deno/Bun/JVM/.NET/PHP — all ⬜ N/A by design (managed Node.js +
> Cloud Run + E2B sandbox stack). Items below are relevant to the AI app maker context only.

### ✅ Build & Runtime Already Strong (do not redo)
- **Orchestration**: AppMakerOrchestrator.ts (top-level), BuildManager.ts (npm build lifecycle),
  RuntimeKernel.ts (KernelState: STARTING→RUNNING→STOPPED, graceful shutdown), BuildJobManager.ts
  (full job lifecycle QUEUED→PREVIEW_READY with LocalFile + Firestore job stores), TaskScheduler.ts (DAG batch execution).
- **Graph/Intelligence**: ModuleGraph.ts (DAG validation + topological ordering), GraphGenerator.ts
  (file dependency graph), FileAnalyzer.ts (TypeScript AST source scanner),
  RepositoryIntelligenceEngine.ts (project structure scanner), DependencyResolver.ts.
- **Code Generation**: FrontendGenerationEngine, BackendGenerationEngine, DatabaseGenerationEngine,
  DefaultGenerationEngine; BlueprintCompiler.ts (AST compiler); EngineRegistry + EngineDispatcher;
  PatchAggregator → PatchToWorkspaceBridge → WorkspaceMutationEngine (ACID 3-phase).
- **Bundler**: Vite 6 (HMR, Fast Refresh, tree-shaking, code splitting, asset bundling, CSS optimizer),
  esbuild (AOT transpiler + JS minifier + server bundle); vite.config.ts with React plugin.
- **Artifacts & Manifests**: BuildManifestGenerator.ts, ManifestMapper.ts, DeploymentArtifactBuilder.ts
  (SHA256 checksums), TemplateRegistry, ViteReactProvider.
- **Event Bus**: InProcessEventBus.ts (pub/sub, BUILD_STARTED/COMPLETED/FAILED events),
  EventHistoryStore.ts (500-entry audit per namespace).
- **Checkpoints**: CheckpointManager.ts + CheckpointStorage.ts (ACID save/restore across build phases).
- **Auto-Repair**: AutoRepairEngine.ts, FailureClassifier.ts (14 error types), RootCauseAnalyzer.ts,
  RepairPlanner.ts, BuildVerifier.ts.
- **Deployment**: DeploymentEngine.ts + DeploymentPlanner.ts + DeploymentValidator.ts +
  DeploymentRollbackManager.ts + DeploymentStateManager.ts + DeploymentAuditManager.ts.
- **Sandbox/Process**: SandboxManager.ts (spawn-based isolation, NODE_OPTIONS --max-old-space-size),
  PortManager.ts (ports 3001-4000), PreviewRunner.ts (PreviewSession, auto-restart on crash),
  PreviewHealthChecker.ts (HTTP health checks), SubprocessManager via child_process.
- **Observability**: ObservabilityManager.ts (latency tracking, crash logging), TokenUsageManager.ts.
- **Config/Env**: dotenv + server.ts (env var loading, .env/.env.example fallback),
  Feature flags runtime, NODE_ENV isolation.
- **CI/CD**: cloudbuild.yaml (Cloud Build → Cloud Run, Docker layer caching), Dockerfile (Node.js 22),
  Package manager detection (npm/pnpm/yarn in BuildEvaluator.ts).

### P-BRE.1 — Distributed Tracing / OpenTelemetry  ❌ MISSING  [HIGH — observability]
- `ObservabilityManager.ts` captures basic latency + crashes, but there is no distributed trace spanning
  the full build pipeline (AppMakerOrchestrator → TaskScheduler → EngineDispatcher → FrontendEngine → PatchAggregator).
  When a 30-second build fails, it's impossible to know which stage was slow or blocked.
- [ ] Add `TracingManager.ts` wrapping `@opentelemetry/sdk-node` — create a span per build stage, link them with `traceId` = `jobId`.
- [ ] Instrument AppMakerOrchestrator, ExecutionOrchestrator, EngineDispatcher, DeploymentEngine with `span.start()` / `span.end()`.
- [ ] Export traces to Cloud Trace (GCP) via OTLP exporter — already available in Cloud Run environment.
- [ ] Attach `traceId` to every log line (enables log↔trace correlation).
- **Files:** new `src/server/telemetry/TracingManager.ts`, `src/server/AppMakerLab/AppMakerOrchestrator.ts`,
  `src/server/AppMakerLab/generator/ExecutionOrchestrator.ts`, `src/server/AppMakerLab/generator/EngineDispatcher.ts`.

### P-BRE.2 — Incremental Build Engine (Skip-Unchanged Files)  🟡 PARTIAL → full  [HIGH]
- Every AI generation triggers a full rebuild of all files — even when only one component changed.
  `FileAnalyzer.ts` scans files but there is no persistent content-hash cache that skips unchanged modules.
- [ ] Add `IncrementalBuildCache.ts`: on build start, hash each source file (SHA256). On rebuild, compare hashes
  — only re-generate + re-patch files whose hash changed or whose dependents changed (use `ModuleGraph.ts` for impact).
- [ ] Store hash cache in Firestore per `workspaceId` (survives server restarts).
- [ ] Emit `INCREMENTAL_SKIP` events for skipped files to EventHistoryStore.
- **Files:** new `src/server/AppMakerLab/IncrementalBuildCache.ts`, `src/server/AppMakerLab/BuildManager.ts`,
  `src/server/AppMakerLab/generator/ModuleGraph.ts`.

### P-BRE.3 — Structured Logging with Build Correlation IDs  ✅ DONE (build-correlation core) (2026-06-28)
- [x] New `src/server/logger.ts` — a dependency-free structured `Logger` singleton (no Pino/Winston dep) emitting one
      Cloud Logging-compatible JSON line per log: `{ severity, message, timestamp, traceId?, ...context, ...meta }`.
      Level-filtered by `LOG_LEVEL` (debug<info<warn<error; default info in prod, debug in dev — pure `resolveLogLevel`).
      `traceId` is pulled from the P2.1 tracer's active span, so logs ↔ traces auto-correlate. Never throws.
- [x] Build correlation via `AsyncLocalStorage`: `withLogContext({ jobId, … }, fn)` propagates correlation fields to
      every log inside the scope. `AppMakerOrchestrator.runBuildJob` is wrapped in `withLogContext({ jobId, namespace })`,
      so EVERY structured build log carries the jobId — "filter all logs for jobId X" now works.
- [x] Converted the build-path log sites (the spec's named files) to the structured logger: `BuildManager.ts` (10),
      `generator/ExecutionOrchestrator.ts` (2), `AppMakerOrchestrator.ts` (build start/complete/fail).
- [x] `LOG_LEVEL` honoured (prod→info default). Setting the Cloud Run env var is the documented admin step.
- **Incremental (noted, not blocking):** the broad legacy `console.*` migration across the 6000-line `server.ts` is a
      mechanical cleanup (mostly debug prints) — done lazily as those areas are touched; the high-value build-correlation
      core is complete and used now.
- **Verification:** `tsc` (fe+server) ✅ · `vitest run` 2882/2882 ✅ (12 new logger tests: level filtering, severity
      mapping, JSON shape, ALS context propagation/merge/no-leak, never-throws) · server bundles ✅.
- **Files:** new `src/server/logger.ts` (+ `.test.ts`), `src/server/AppMakerLab/AppMakerOrchestrator.ts`, `BuildManager.ts`, `generator/ExecutionOrchestrator.ts`.

### P-BRE.4 — Smoke Test Runner (Post-Build Validation)  ❌ MISSING  [HIGH]
- When a build completes successfully (QualityEvaluationEngine passes), there is no automated smoke test
  that verifies the generated app actually *starts* and *responds to HTTP*. Silent runtime failures ship to users.
- `PreviewHealthChecker.ts` exists (HTTP health check) but is NOT invoked at the end of the build pipeline.
- [ ] After `AutoRepairEngine` marks a build stable, call `PreviewHealthChecker.check(session)` and gate
  `BUILD_COMPLETED` event on a passing health check. On fail → trigger `AutoRepairEngine` repair loop.
- [ ] Add a smoke test step to `BuildManager.ts`: verify `/` returns 200, CSS loads, no `<script>` errors in preview.
- [ ] Surface smoke test result in the build status shown to the user.
- **Files:** `src/server/AppMakerLab/BuildManager.ts`, `src/server/PreviewRunner/PreviewHealthChecker.ts`,
  `src/server/AppMakerLab/eventbus/EventTypes.ts`.

### P-BRE.5 — Remote Build Cache (GCS)  ❌ MISSING  [HIGH — CI speed]
- `cloudbuild.yaml` uses Docker layer caching (`--cache-from`) but there is no application-level remote cache.
  Every Cloud Build run re-runs `npm install` (2-3 min) and re-bundles unchanged code.
- `IncrementalBuildCache.ts` (P-BRE.2) covers per-workspace caching; this item covers the CI build itself.
- [ ] Add a GCS bucket `navbharatai-build-cache` with Vite's experimental persistent cache (`cacheDir` → mounted GCS FUSE or pre/post build sync steps).
- [ ] In `cloudbuild.yaml`: add a `gsutil rsync` step before `npm install` to restore `node_modules` cache; after build, sync it back.
- [ ] Reduce cold build time from ~5 min to < 2 min.
- **Files:** `cloudbuild.yaml`, `Dockerfile`.

### P-BRE.6 — Durable Background Job Queue (Build Jobs Survive Restarts)  ❌ MISSING  [MED]
- `BuildJobManager.ts` stores jobs in Firestore but the actual build *execution* is in-memory Promise chains.
  If Cloud Run scales to 0 mid-build (min-instances=0) or crashes, in-flight jobs are lost silently.
- [ ] Add a job queue layer (BullMQ with Redis, or a Cloud Tasks trigger) so each build job is enqueued as a durable task.
- [ ] Worker picks up job from queue, executes build, marks complete in Firestore — survives server restarts.
- [ ] `BuildJobManager.ts` becomes the queue producer; a dedicated `BuildWorker.ts` is the consumer.
- **Files:** `src/server/AppMakerLab/jobs/BuildJobManager.ts`, new `src/server/AppMakerLab/jobs/BuildWorker.ts`,
  new `src/server/AppMakerLab/jobs/BuildQueue.ts`.

### P-BRE.7 — Build & Deploy Notifications  ✅ DONE (2026-06-29, webhook channel)
- Background/agent-triggered builds were silent — no signal on completion/failure.
- [x] **`NotificationManager.ts`** — `buildNotificationPayload(job)` (pure) builds `{ event, jobId, status,
      success, previewUrl, workspaceId, timestamp }`; `sendBuildWebhook(url, payload)` POSTs with a 5s
      AbortController timeout, returns 2xx→true and NEVER throws (a flaky webhook can't break a build);
      `notifyBuildResult(job)` fires only on a terminal status when a webhook URL is configured (no-op otherwise).
- [x] **Wired** into `BuildJobManager.updateStatus()` — on a `PREVIEW_READY`/`FAILED` transition it fires the
      webhook best-effort + non-blocking (the build never waits on or fails from it).
- [x] **Config-gated webhook URL** — explicit arg → `BUILD_WEBHOOK_URL` env → none. Real when configured.
- [ ] **SSE-toast + email channels deferred (honest):** there is no standalone notifications SSE stream yet
      (the existing SSE is the build/engineer chat stream), and email needs an external provider key
      (SendGrid/Firebase) that doesn't exist for this project — per "real features only" they are NOT stubbed.
      The webhook channel (no external dep) ships now; a per-project webhook-URL setting UI is a thin follow-up.
- **Verification:** `tsc` (fe+server) ✅ · `vitest run` 3252/3252 ✅ (10 new) · `test:coverage` exit 0 · `build` ✅ ·
      `boot:check` PASS.
- **Files:** `src/server/NotificationManager.ts` (new), `tests/notificationManager.test.ts` (new),
      `src/server/AppMakerLab/jobs/BuildJobManager.ts`.

### P-BRE.8 — Build Analytics Dashboard  ✅ DONE (2026-06-29)
- There was no view of build-pipeline health (duration, failure rate, common failure type).
- [x] **Aggregation endpoint `GET /api/analytics/builds`** (`routes/buildAnalytics.ts`) — pulls the last N jobs
      (default 100) from the job store and computes success/failure rate, avg + p95 duration, status breakdown,
      and the top-5 failure signatures. Honest zeros until builds have run (never fabricated).
- [x] **Store support** — added `listRecentJobs(limit)` to the `JobStore` interface + BOTH implementations
      (`LocalFileJobStore` linear scan, `FirestoreJobStore` indexed `orderBy(createdAt desc).limit`), and
      `BuildJobManager.listRecent()`.
- [x] **Pure aggregator** (`BuildAnalytics.ts`, unit-tested) — `aggregateBuildAnalytics()` + `percentile()` +
      `failureSignature()` (normalizes a failed job's last log line into a stable signature: collapses ids,
      strips line:col, length-caps).
- [x] **"Build Performance" card** in `AppAnalytics.tsx` — renders success rate, failure rate, avg + p95 duration,
      and the top failure types from the real endpoint; only shows once builds exist.
- [x] **AppKnowledgeBase** — new `build-performance-analytics` entry (same PR).
- **Verification:** `tsc` (fe+server) ✅ · `vitest run` 3242/3242 ✅ (7 new) · `test:coverage` exit 0 · `build` ✅ ·
      `boot:check` PASS.
- **Files:** `src/server/AppMakerLab/jobs/BuildAnalytics.ts` (new), `src/server/routes/buildAnalytics.ts` (new),
      `tests/buildAnalytics.test.ts` (new), `src/server/AppMakerLab/jobs/store/{JobStore,LocalFileJobStore,FirestoreJobStore}.ts`,
      `src/server/AppMakerLab/jobs/BuildJobManager.ts`, `server.ts`, `src/components/ide/AppAnalytics.tsx`, `src/server/AppContext/AppKnowledgeBase.ts`.

### P-BRE.9 — Circuit Breaker for Build Pipeline Steps  ✅ DONE (2026-06-29)
- `EngineDispatcher.dispatch()` had no breaker: a repeatedly-failing/hanging generation engine dragged every
  build to the full outer timeout — no fast-fail, no per-stage isolation.
- [x] **`BuildStepBreaker.ts`** — per-engine breakers in a SEPARATE registry (so they don't pollute the
      AI-provider breaker stats), reusing the proven, unit-tested AI-router `CircuitBreaker` (CLOSED/OPEN/
      HALF_OPEN). `runWithBreaker(step, fn, onOpen)`: fast-fails with a typed `CircuitOpenError` while open,
      records success/failure, and fires `onOpen` when a step trips.
- [x] **3 failures → open (fast-fail, 60s escalating) → half-open probe** — `FAILURE_THRESHOLD = 3`; the
      wrapper only blocks once a step reaches 3 consecutive failures (so a single transient engine error doesn't
      lock the engine out for a minute), then escalates the cooldown from 60s and lets a half-open trial through
      after it elapses (a success closes it; a failed probe re-opens).
- [x] **Wired into `EngineDispatcher`** — each `engine.execute()` now runs under `runWithBreaker('engine:<type>')`.
      An optional `onCircuitOpen` constructor callback (defaults undefined → existing callers unaffected) lets the
      orchestrator emit the new `STAGE_CIRCUIT_OPEN` event so `AutoRepairEngine` can pick a fallback.
- [x] **`STAGE_CIRCUIT_OPEN`** added to `eventbus/EventTypes.ts`.
- **Verification:** `tsc` (fe+server) ✅ · `vitest run` 3229/3229 ✅ (6 new) · `test:coverage` exit 0 · `build` ✅ ·
      `boot:check` PASS.
- **Files:** `src/server/AppMakerLab/BuildStepBreaker.ts` (new), `tests/buildStepBreaker.test.ts` (new),
      `src/server/AppMakerLab/generator/EngineDispatcher.ts`, `src/server/AppMakerLab/eventbus/EventTypes.ts`.

### P-BRE.10 — SBOM Generator + License Validator  ✅ DONE (2026-06-29)
- No SBOM was generated for the apps users BUILD on the platform (P-SEC.6 covers NavBharatAI's OWN SBOM in
  CI; this is the separate user-app feature). Enterprise users need to know the OSS deps in their generated apps.
- [x] **`SBOMGenerator.ts`** — pure, unit-tested CycloneDX 1.5 SBOM builder from a parsed `package-lock.json`
      (name/version/purl/license per component, root excluded, deduped). Logic ported to TypeScript from the
      proven P-SEC.6 `genSbom.mjs` + `licenseGate.mjs` cores (the CLI .mjs aren't importable into the server).
- [x] **License validator** — `classifyLicense()` + `detectCopyleft()` flag strong-copyleft (GPL/AGPL — the real
      compliance risk) and weak-copyleft (LGPL/MPL/EPL — informational); a dual "MIT OR GPL-3.0" is correctly
      permissive, and the `-or-later` suffix isn't mis-split. `analyzeAppDependencies()` returns
      `{ sbom, copyleft, componentCount, hasCopyleftRisk }`.
- [x] **API** — `POST /api/workspace/sbom` (`src/server/routes/sbom.ts`, workspace-rate-limited): takes the app's
      lockfile (the IDE already has the workspace files — no sandbox access needed), returns the SBOM + copyleft
      findings; best-effort persists to Firestore `sboms/{workspaceId}/builds/{buildId}` when ids are supplied.
- [x] **AppKnowledgeBase** — new `app-sbom` entry (same PR).
- **Note (honest scope):** wired as a backend capability + API rather than into `BuildManager.ts` — the live
      builder is AgentV3, not the AppMakerLab `npm run build` step, and the lockfile is most reliably supplied by
      the caller. A one-click IDE button is a thin follow-up on top of this working API.
- **Verification:** `tsc` (fe+server) ✅ · `vitest run` 3223/3223 ✅ (10 new) · `test:coverage` exit 0 · `build` ✅ ·
      `boot:check` PASS.
- **Files:** `src/server/AppMakerLab/SBOMGenerator.ts` (new), `src/server/routes/sbom.ts` (new),
      `tests/sbomGenerator.test.ts` (new), `server.ts`, `src/server/AppContext/AppKnowledgeBase.ts`.

### P-BRE.11 — AI Build Optimizer  ❌ MISSING  [LOW]
- No AI agent analyzes build telemetry to suggest optimizations: "your BackendEngine step takes 12s — consider splitting it", "80% of failures are missing-import errors — adjust code gen prompt".
- [ ] Add `AIBuildOptimizer.ts`: after 10+ builds, aggregate stage timings + failure patterns from Firestore job store → send to AgentV3 with `intent: optimize_build` → return a structured suggestion.
- [ ] Surface suggestions as a toast notification or in Build Analytics dashboard.
- **Files:** new `src/server/AppMakerLab/AIBuildOptimizer.ts`, `src/server/AppMakerLab/jobs/BuildJobManager.ts`.

### P-BRE.12 — Watchdog Service (Zombie Process Detection)  ❌ MISSING  [LOW]
- `AutoRepairEngine.ts` catches build failures reported through the event bus. But if a sandbox child process becomes a zombie (no `exit` event fired, no HTTP response, no OS signal), it sits alive consuming ports until `PreviewRunner.ts` session expiry (default timeout).
- [ ] Add `WatchdogService.ts`: every 30s, iterate all active `SandboxManager` child processes — if PID is still in OS process table but preview HTTP is not responding, force-kill + clean up port + trigger rebuild.
- [ ] Register Watchdog in `RuntimeKernel.ts` as a managed service.
- **Files:** new `src/server/PreviewRunner/WatchdogService.ts`, `src/server/AppMakerLab/kernel/RuntimeKernel.ts`,
  `src/server/PreviewRunner/SandboxManager.ts`.

### P-BRE.13 — Deterministic / Reproducible Builds  ✅ DONE (2026-06-29)
- The same source could produce slightly different output across builds (embedded timestamps), weakening
  audit trails + caching.
- [x] **Reproducible install** — `Dockerfile` now uses `npm ci` (lockfile-exact, fails fast if out of sync)
      instead of `npm install`. (CI already used `npm ci`; the lockfile is proven in-sync on every PR.)
- [x] **Deterministic build timestamp** — `vite.config.ts` `__BUILD_TIME__` now honors `SOURCE_DATE_EPOCH` (the
      reproducible-builds standard) when set, so two builds of the SAME commit are byte-identical; it falls back
      to `now()` for local dev, preserving the deploy-freshness indicator (each deploy is a new commit). Setting
      `SOURCE_DATE_EPOCH` in Cloud Build is the documented one-line infra step to make prod builds reproducible.
- [x] **`BuildReproducibilityChecker.ts`** — pure, unit-tested audit tool: SHA-256 hashes each output file and
      diffs two build manifests (`compareManifests` / `compareBuilds`), reporting `identical` + the exact
      differing / added / removed files. A runner can build twice from one commit and alert on drift.
- **Declined (honest):** "pin ALL direct+transitive deps (remove every `^`/`~`)" — the committed
      `package-lock.json` + `npm ci` ALREADY pin exact versions for every install, so bulk caret-removal across
      ~250 deps is high-risk churn (breaks Dependabot grouping + future upgrades) for no added determinism. Not done.
- **Verification:** `tsc` (fe+server) ✅ · `vitest run` 3235/3235 ✅ (6 new) · `test:coverage` exit 0 · `build` ✅ ·
      `boot:check` PASS.
- **Files:** `Dockerfile`, `vite.config.ts`, `src/server/AppMakerLab/BuildReproducibilityChecker.ts` (new),
      `tests/buildReproducibilityChecker.test.ts` (new).

---

## 🟢 PHASE P-DEV — DEVELOPMENT ENVIRONMENT GAPS
> From the 300-component Dev Environment audit (2026-06-28). Already-strong items not listed.
> Only PARTIAL → Full and MISSING items, priority-ordered.
> Scope note: remote DevContainers, k8s-native dev, Codespaces, WSL, bare-metal GPU runtimes are ⬜ N/A
> by design — navBharatAI runs on Cloud Run + E2B sandbox. Only IDE/DevEx gaps relevant to app-maker captured.

### ✅ Dev Environment Already Strong (do not redo)
- Monaco Editor (multi-tab, minimap, bracket colorization, auto-format, code folding, multi-cursor),
  DiffViewer.tsx (LCS-based unified diff), VisualEditor.tsx (WYSIWYG iframe editor with element selection),
  FileExplorer.tsx (tree view, file ops, search filter), TerminalPanel.tsx (xterm.js, multi-terminal,
  shell simulation, command history, 3 tabs: Terminal/Output/Debug Console),
  CommandPalette.tsx (Ctrl+K, 8 command categories), StatusBar.tsx (git branch, problem count, AI status),
  ActivityBar.tsx (6 sections: Files/Search/Git/Shortcuts/Cursor/Security),
  PreviewPanel.tsx (iframe, device modes laptop/mobile/fullscreen, hot reload, NBTag overlay),
  LiveCollaboration.tsx (Firebase real-time, presence, chat, room-based, QR codes),
  TeamCollaboration.tsx (role-based Admin/Editor/Viewer, activity feed),
  GitPanel.tsx (2500+ lines, 16 deploy platforms, GitHub OAuth),
  CICDPipeline.tsx (step-based pipeline: GitHub Actions / Cloud Build / GitLab CI),
  TestPanel.tsx (sandbox iframe runner, pass/fail/pending), SecurityScan.tsx (SAST, 6-phase, severity),
  AICodeReview.tsx (bugs/perf/security/accessibility), AIDebugger.tsx (5 error types, root cause + AI fix),
  AISuggestions.tsx (Copilot-style, 8 templates + dynamic analysis), AIChat.tsx (full history, model selection),
  AppHealthMonitor.tsx (8 metrics, health score, incident tracking),
  AppAnalytics.tsx (build counts, AI model breakdown), PerformanceAnalyzer.tsx,
  ExtensionMarket.tsx (ESLint/Prettier/Tailwind/Python), ComponentLibrary.tsx, APITester.tsx, SecretManager.tsx.

### P-DEV.1 — LSP / Code Navigation  🟡 engine + API DONE / Monaco editor-action wiring PENDING (2026-06-29)  [HIGH]
- Monaco's TS worker runs per-file and can't see the whole workspace, so cross-file Go-to-Definition /
  Find-References weren't possible.
- [x] **`NavigationEngine.ts`** (ts-morph, dynamic-import + graceful) — SEMANTIC, scope-aware
      `getDefinition(files, file, offset)` + `findReferences(...)` over an in-memory project built from the
      whole workspace file set; `lineColToOffset()` bridges Monaco's 1-based coords. Robust: a parse error
      returns `{ok:false}` and never throws. **Unit-tested with the real engine** (`tests/navigationEngine.test.ts`)
      — proves cross-file definition + reference resolution (not text-match).
- [x] **API** — `POST /api/workspace/navigate` (`routes/navigate.ts`, rate-limited + request-validated via
      P-DATA.1): `{ files, file, line, column, action: 'definition'|'references' }` → `{ ok, locations[] }`.
- [x] **Rename** is already covered semantically-enough by `CodemodeExecutor.renameSymbol` (cross-file).
- [ ] **Monaco editor-action wiring (F12 / Shift+F12 + references panel) — tracked follow-up:** it needs the
      full workspace file set + cross-file tab-navigation threaded into the single-file `Editor.tsx` (an invasive
      change); deferred to keep this PR low-risk (safeguard #3). The engine + endpoint are live and callable now,
      and this also unblocks P-DEV.6 (refactoring uses the same engine).
- **Verification:** `tsc` (fe+server) ✅ · `vitest run` 3299/3299 ✅ (5 new, real ts-morph) · `test:coverage` exit 0 ·
      `build` ✅ · `boot:check` PASS.
- **Files:** `src/server/AI/NavigationEngine.ts` (new), `src/server/routes/navigate.ts` (new),
      `tests/navigationEngine.test.ts` (new), `server.ts`.

### P-DEV.2 — Cross-Session Workspace Persistence (Firestore)  ✅ DONE (substance pre-existing — STALE AUDIT; verified 2026-06-29)  [HIGH]
- **Redundant-work finding (safeguard #6):** the audit said state is "localStorage only" — that is STALE. The
  cross-session, cross-device cloud persistence already exists and works; flagging it here so no future session
  rebuilds it (the PR#1/#4 redundancy the constitution guards against). Verified in code:
- [x] **Debounced cloud save** — `App.tsx` pushes workspace state (sessions + last generated app) to Firestore
      via `POST /api/sync/:userId` on every change, debounced 2.5s.
- [x] **Load on startup + merge** — `GET /api/sync/:userId` on mount, merged with localStorage by newest-wins;
      localStorage stays the instant/offline fallback.
- [x] **Lossless, conflict-safe storage** — `routes/sync.ts` + `WorkspaceStore` chunk the payload (no 60KB/800KB
      truncation) and `SyncMerge` does a server-side per-session last-write-wins merge, so a stale device can't
      drop another device's newer work.
- [ ] **"Saving…/Saved" indicator deferred (honest):** `StatusBar.tsx` has the `isSaving` prop but the component
      is NOT mounted anywhere in the current app shell; mounting a global status bar is a separate layout decision
      and adding it blindly risks shell breakage (safeguard #3). The persistence itself — the high-value
      substance — is fully working today.
- **Files (existing, verified):** `src/App.tsx` (sync effects), `src/server/routes/sync.ts`,
      `src/server/project/{WorkspaceStore,SyncMerge}.ts`.

### P-DEV.3 — Real Debugger Panel (Breakpoints + Call Stack + Variable Watch)  ❌ MISSING  [HIGH]
- `AIDebugger.tsx` does AI analysis of error text — it is NOT a runtime debugger. No breakpoints, no call stack, no variable inspection.
- [ ] Add breakpoint markers in Monaco gutter (click to toggle, persist to `WorkspaceContext`).
- [ ] Wire E2B sandbox (already in `infra/e2b/`) to pause execution at breakpoints and stream call stack + local variables via WebSocket.
- [ ] Render a DebugPanel: call stack list, variable watch (add/remove expressions), continue/step-over/step-into buttons.
- **Files:** new `src/components/ide/DebugPanel.tsx`, `src/components/ide/Editor.tsx`, `infra/e2b/`, `server.ts`.

### P-DEV.4 — Merge Conflict Resolver (3-way Merge Editor)  ✅ DONE (2026-06-29)
- `DiffViewer.tsx` showed only 2-way LCS diffs — no way to resolve conflict markers in a file.
- [x] **Dependency-free diff3 engine** (`src/lib/merge3.ts`, exhaustively unit-tested) — `merge3(base, ours,
      theirs)` auto-merges non-overlapping changes and only emits Git-style markers where both sides changed the
      SAME region differently; `parseConflicts()` reads a marker-laden file into stable/conflict segments
      (tolerates diff3 `|||||||` bases); `resolveConflicts()` turns per-hunk choices into clean content;
      `hasConflictMarkers()` gates the UI.
- [x] **MergeEditor UI** (`src/components/ide/MergeEditor.tsx`) — lists each conflict Ours-vs-Theirs with per-hunk
      Ours / Theirs / Both buttons and a live resolved preview; "Apply Resolution" emits marker-free content.
- [x] **Wired into the Diff view** — `DiffViewer` detects conflict markers in the selected file, flags it, and
      shows a "Resolve Conflicts" toggle that opens the MergeEditor; `ViewPanels` passes `onResolveConflicts`
      which writes the resolved file back via `setFiles` + refreshes the preview (fully end-to-end).
- [x] **AppKnowledgeBase** — new `merge-conflict-resolver` entry (same PR).
- **Note (honest):** hosted in `DiffViewer` (the small, safe diff surface) rather than the 2,621-line `GitPanel`
      to avoid breakage risk (safeguard #3); the engine is reusable, so a GitPanel auto-open is a thin follow-up.
      The 3-pane base column is folded into the engine (diff3 base is parsed/used) rather than a separate pane.
- **Verification:** `tsc` (fe+server) ✅ · `vitest run` 3287/3287 ✅ (14 new) · `test:coverage` exit 0 · `build` ✅.
- **Files:** `src/lib/merge3.ts` (new), `tests/merge3.test.ts` (new), `src/components/ide/MergeEditor.tsx` (new),
      `src/components/ide/DiffViewer.tsx`, `src/components/panels/ViewPanels.tsx`, `src/server/AppContext/AppKnowledgeBase.ts`.

### P-DEV.5 — Real Package Manager Integration  🟡 PARTIAL → full  [HIGH]
- Terminal mock in `TerminalPanel.tsx` intercepts `npm install <pkg>` and returns fake output.
  Generated apps therefore have no way to actually add/remove packages from within the IDE.
- [ ] Add a `/api/workspace/npm` endpoint in `server.ts` that runs `npm install` inside the E2B sandbox for the active workspace, streams output via SSE.
- [ ] TerminalPanel.tsx detects `npm|pnpm|yarn install/uninstall` commands → redirects to the real endpoint instead of mock.
- [ ] Update `package.json` of the generated app in the workspace file tree on success.
- **Files:** `src/components/ide/TerminalPanel.tsx`, `server.ts` (new endpoint), `infra/e2b/`.

### P-DEV.6 — Code Refactoring Tools (Extract / Move / Rename cross-file)  ❌ MISSING  [MED]
- Monaco F2 renames only within single file (client-side). No Extract Method/Variable/Interface, no Move Symbol across files.
- ts-morph `LanguageService` (already imported in `ASTAnalyzer.ts`) supports cross-file refactors.
- [ ] Add context-menu actions in Editor: "Extract to function", "Extract to variable", "Move to file".
- [ ] Call `NavigationEngine.ts` (P-DEV.1) refactor API; apply resulting `TextChange[]` to workspace files.
- **Files:** `src/components/ide/Editor.tsx`, `src/server/AI/NavigationEngine.ts`.

### P-DEV.7 — Offline Development Mode (Service Worker)  ❌ MISSING  [MED]
- No service worker — every keystroke and file read requires internet. Pure UI edits can't proceed offline.
- [ ] Add a Workbox service worker: cache Monaco editor worker bundle, app shell JS/CSS, and last-loaded workspace snapshot.
- [ ] When `navigator.onLine = false`: serve cached app shell, store workspace mutations in IndexedDB, sync to Firestore on reconnect.
- [ ] Show "Offline — syncing on reconnect" banner in StatusBar.tsx.
- **Files:** `src/main.tsx` (register SW), new `public/service-worker.js`, `src/components/ide/StatusBar.tsx`.

### P-DEV.8 — Git Advanced Tools (Blame / Stash / Tag Manager)  ❌ MISSING  [MED]
- GitPanel.tsx handles branch/PR/deploy/16 platforms but missing: Blame Viewer (who changed this line), Stash Manager (save/pop/drop), Tag Manager (create/push semver tags for release).
- [ ] Blame: call GitHub API `/repos/{owner}/{repo}/blame/{ref}/{path}`, overlay author+date in Monaco gutter as decorations.
- [ ] Stash: add "Stash" tab in GitPanel.tsx — `git stash list/push/pop/drop` via the Git endpoint.
- [ ] Tags: add "Tags" tab — create `vX.Y.Z` tag, push to remote; wire to SemVer Manager (P-PME.13).
- **Files:** `src/components/ide/GitPanel.tsx`.

### P-DEV.9 — Runtime Theme Switcher (Monaco + App Shell)  ✅ DONE (2026-06-29)
- The Monaco theme was effectively fixed; no way to switch the editor's color scheme at runtime.
- [x] **Theme catalog + custom definitions** (`src/components/ide/monacoThemes.ts`, unit-tested) — VS Dark | VS
      Light | Monokai | Dracula | Solarized Dark; the three custom themes are real `defineTheme` data (base,
      token rules, background) registered via `registerEditorThemes(monaco)`.
- [x] **Selector in the editor header** — a dropdown in `Editor.tsx` (self-contained, no risky App.tsx surgery)
      switches the live theme; the custom themes are registered in `beforeMount` so they're available immediately.
- [x] **Persisted** — `loadSavedTheme()` / `saveTheme()` to `localStorage('editorTheme')`, validated (an invalid
      stored value falls back to the default; an invalid theme is never persisted).
- [x] **AppKnowledgeBase** — new `editor-theme-switcher` entry (same PR).
- **Verification:** `tsc` (fe+server) ✅ · `vitest run` 3294/3294 ✅ (7 new) · `test:coverage` exit 0 · `build` ✅.
- **Files:** `src/components/ide/monacoThemes.ts` (new), `tests/monacoThemes.test.ts` (new),
      `src/components/ide/Editor.tsx`, `src/server/AppContext/AppKnowledgeBase.ts`.

### P-DEV.10 — Dedicated Code Explanation Panel  ❌ MISSING  [MED]
- `AIDebugger.tsx` is error-focused. `AISuggestions.tsx` shows templates. No "explain this selection" panel.
- [ ] Add "Explain Code" to Monaco right-click context menu → send selected text to AgentV3 with `intent: explain`.
- [ ] Render response in a dedicated `CodeExplainPanel.tsx` side panel: plain-language description, complexity label, pattern name, suggested refactors.
- **Files:** `src/components/ide/Editor.tsx`, new `src/components/ide/CodeExplainPanel.tsx`, `src/components/ide/ActivityBar.tsx`.

### P-DEV.11 — Inline Code Comments / Review Mode  ❌ MISSING  [LOW]
- LiveCollaboration.tsx has chat but no GitHub PR-style inline code comments tied to specific line ranges.
- [ ] Add comment anchors in Monaco gutter (click to add a thread, stored in Firestore `comments/{workspaceId}/{file}/{line}`).
- [ ] Show unresolved comment count in StatusBar.tsx; allow resolve/reply.
- **Files:** `src/components/ide/Editor.tsx`, `src/components/ide/LiveCollaboration.tsx`, new `src/lib/commentStore.ts`.

### P-DEV.12 — Performance Profiler / Flame Graph  ❌ MISSING  [LOW]
- `AppHealthMonitor.tsx` tracks runtime health metrics. `PerformanceAnalyzer.tsx` audits static HTML.
  No CPU/memory profiler or flame graph for identifying hot paths in generated app code.
- [ ] Integrate `clinic.js` or `v8-profiler-next` via E2B sandbox — generate CPU profile JSON.
- [ ] Render flame graph (using `d3-flame-graph`) in a "Profile" tab inside TerminalPanel.tsx.
- **Files:** new `src/components/ide/ProfilerPanel.tsx`, `src/components/ide/TerminalPanel.tsx`, `server.ts`.

### P-DEV.13 — Voice Collaboration  ❌ MISSING  [LOW — future scope]
- LiveCollaboration.tsx supports real-time text chat + cursor presence. No voice channel for pair/mob programming.
- [ ] Integrate Daily.co or LiveKit (WebRTC, self-hostable) for voice-only rooms keyed to workspace room ID.
- [ ] Mute/unmute + speaker indicators in LiveCollaboration.tsx toolbar.
- **Files:** `src/components/ide/LiveCollaboration.tsx`, new `src/lib/voiceRoom.ts`.

---

## 🟡 PHASE P-PME — PROJECT MANAGEMENT ENGINE GAPS
> From the 300-component PME audit (2026-06-28). Scope: only PME gaps relevant to an AI app maker.
> Enterprise PM (OKRs, SAFe, portfolio, resource/capacity planning, Jira/Teams) is ⬜ N/A by design —
> navBharatAI is a code generator, not a general PM tool.
> Only PARTIAL → Full and MISSING items that directly improve the app-maker experience, priority-ordered.

### ✅ PME Already Strong (do not redo)
- **Build job tracking**: BuildJobManager (QUEUED→PREVIEW_READY, progress, log streaming).
- **Execution tracking**: ExecutionOrchestrator (task status RUNNING/COMPLETED/FAILED + events),
  TaskScheduler (batch DAG), BlueprintPlanner (execution plan).
- **Deployment lifecycle**: DeploymentEngine + DeploymentStateManager + DeploymentAuditManager +
  DeploymentRollbackManager + DeploymentArtifactBuilder (full PREPARING→DEPLOYED state machine).
- **Quality/health**: QualityEvaluationEngine (5 evaluators), AppHealthMonitor.tsx (health score,
  incident timeline), AuditManager, CheckpointManager (state snapshots).
- **Collaboration**: LiveCollaboration.tsx (Firestore real-time), TeamCollaboration.tsx (presence +
  activity feed), CodeVersioning.tsx (named history snapshots), CICDPipeline.tsx (status + pipeline monitor).
- **AI project planning**: AIProjectManager.tsx (Kanban + milestone, AI task gen from description),
  ImpactAnalyzer.ts (dependency risk score), CostEstimator.tsx, AISuggestions.tsx.
- **Requirements**: RequirementIntelligenceEngine + RequirementsAgent + RequirementModels, ProjectMemoryManager.

### P-PME.1 — Cross-Session Project Memory / Context Preservation  🟡 PARTIAL → full  [HIGH]
- `ProjectMemoryManager.ts` stores project metadata (structure, features, build history) in-process as JSON.
  All context is lost when Cloud Run instance restarts (min-instances=0 → every session is fresh).
- [ ] Persist `ProjectMemoryManager` state to Firestore: `projectMemory/{userId}/{projectId}` on every
  build completion. Load on first AI request in a new session.
- [ ] Add `CrossSessionContextLoader.ts` — on session start, inject last-known project state (tech stack,
  entity names, last blueprint, last 3 errors) into the first AI system prompt.
- [ ] Expose "Resume Project" in the UI — show last saved state with a "Continue where you left off" CTA.
- **Files:** `src/server/Memory/ProjectMemoryManager.ts`, new `src/server/Memory/CrossSessionContextLoader.ts`,
  `server.ts`, `src/App.tsx`.

### P-PME.2 — Release Notes Generator  🟡 engine+API DONE / persistence+UI PENDING  [HIGH]
- When a user deploys their app, nothing documented what changed. Now there is a real generator.
- [x] Added `src/server/lib/ReleaseNotesGenerator.ts` — a pure, dependency-free engine: `diffBlueprints`
  (features added/removed/kept, case-insensitive + deduped) and `generateReleaseNote` → a structured note
  (app name, version, date, summary, added/removed sections, tech stack) + a formatted Markdown body. Honest:
  an identical blueprint yields a "no user-visible changes" note (no fabricated highlights); the engine never
  reads the clock (date is caller-supplied). 8 unit tests.
- [x] Added `POST /api/release-notes` (stateless): body `{ current, previous?, version?, date? }` → the note +
  Markdown, with input sanitisation/caps. Any caller (build flow, IDE button) can use it.
- [ ] **Still pending:** persist to `projectMemory/.../releases[]` (Firestore), the post-deploy auto-generate
  step in the build flow, and the "View Release Notes" UI button with copy/share.
- **Files:** new `src/server/lib/ReleaseNotesGenerator.ts` + `.test.ts`, new `src/server/routes/releaseNotes.ts`, `server.ts`.
  `src/server/AppMakerLab/AppMakerOrchestrator.ts`, `src/App.tsx`.

### P-PME.3 — Technical Debt Tracker  ✅ DONE (2026-06-29, engine + persistence + API)
- Quality findings were auto-repaired or silently dropped — no accumulating debt register.
- [x] **`TechnicalDebtTracker.ts`** (pure logic unit-tested) — `mergeDebt` (dedup by `debtKey`, keep `firstSeen`
      + refresh `lastSeen`, retain prior debt until resolved), `prioritizeDebt` (**CRITICAL security first**, then
      severity desc, then category/file), `summarizeDebt` (counts + critical-security highlight). Persisted to
      Firestore `techDebt/{userId}__{projectId}` (best-effort).
- [x] **API** — `GET/POST /api/techdebt/:userId/:projectId` (requireUserMatch + request-validated): record
      findings into the register and return the prioritized list + summary.
- [ ] **UI "Tech Debt" badge in the IDE header — thin follow-up:** the register + prioritized API are live; the
      badge is a small frontend addition (the count comes straight from `summary` / `GET`). Deferred to keep the
      change low-risk; not faked.
- **Verification:** `tsc` (fe+server) ✅ · `vitest run` 3340/3340 ✅ (6 new) · `test:coverage` exit 0 · `build` ✅ ·
      `boot:check` PASS.
- **Files:** `src/server/AppMakerLab/intelligence/TechnicalDebtTracker.ts` (new), `src/server/routes/techDebt.ts` (new),
      `tests/technicalDebtTracker.test.ts` (new), `server.ts`.

### P-PME.4 — AI Build Time Estimator / Deadline Predictor  🟡 engine+API DONE / UI+persistence PENDING  [HIGH]
- Builds showed an open-ended spinner with no ETA. Now there is a real estimator.
- [x] Added `src/server/lib/BuildTimeEstimator.ts` — pure, dependency-free: `heuristicEstimateMs` (from
  blueprint complexity: modules × features × avg tokens/module), `estimateBuildTime` (blends the heuristic with a
  weighted average of past builds of similar complexity — closer matches weighted more), `formatEta`, and
  `predictDeadline` (start time is an input — never reads the clock). Returns estimate + low/high range +
  confidence + basis (`heuristic`/`blended`/`historical`). Honest: no history → heuristic basis, lower confidence.
  8 unit tests.
- [x] Added `POST /api/build-estimate` (stateless): `{ complexity, history?, startMs? }` → estimate + ETA (+ finish time).
- [ ] **Still pending:** show "Estimated: ~2 min" in the build progress UI and record actual durations to
  `buildHistory[]` (UI + Firestore persistence — deferred from the unattended run).
- **Files:** new `src/server/lib/BuildTimeEstimator.ts` + `.test.ts`, new `src/server/routes/buildEstimate.ts`, `server.ts`.

### P-PME.5 — Lessons Learned / Retrospective Engine  🟡 engine+API DONE / persistence+wiring PENDING  [HIGH]
- Failed builds weren't systematically learned from. Now there is a real retrospective engine.
- [x] Added `src/server/lib/BuildRetrospectiveEngine.ts` — pure, dependency-free: `classifyFailure` (error text →
  category: dependency/syntax/type/timeout/network/runtime/test/build/unknown + a root-cause hint),
  `buildRetrospective` (failed-build record → structured retrospective: category, root cause, strategies tried,
  final error, time, a reusable warning), and `relevantWarnings` (rank past failures for a new build by
  framework + overlapping intent words). Honest: unrecognised errors → `unknown` (no confident wrong label). 7 tests.
- [x] Added `POST /api/retrospective` (failed build → retrospective) and `POST /api/retrospective/warnings`
  (history + query → top-N relevant warnings).
- [ ] **Still pending:** persist to `buildRetrospectives/...` (Firestore), capture on maxAttempts in the build
  flow, and promote lessons into AgentV3 `KnowledgeEvolution` (Firestore + AgentV3/build-path — deferred).
- **Files:** new `src/server/lib/BuildRetrospectiveEngine.ts` + `.test.ts`, new `src/server/routes/retrospective.ts`, `server.ts`.

### P-PME.6 — Scope Change Control (mid-build requirement change)  ❌ MISSING  [MED]
- If a user sends a new prompt while a build is in progress (changing scope mid-flight), the system
  has no handler. The new request races with the running build and can corrupt workspace state.
- [ ] Add `ScopeChangeController.ts` — detect when a new AI request arrives while `BuildJobManager`
  reports status === 'building'. Options: (a) queue the new request for after build, (b) abort current
  build + restart with merged requirements, (c) reject with "Build in progress — please wait".
- [ ] Show a user-facing "Build in progress — your change will be applied after this completes" message.
- **Files:** new `src/server/AppMakerLab/intelligence/ScopeChangeController.ts`,
  `src/server/AppMakerLab/jobs/BuildJobManager.ts`, `server.ts`.

### P-PME.7 — Changelog Manager  ✅ DONE (2026-06-29)
- No structured changelog of what changed between builds.
- [x] **`ChangelogManager.ts`** (pure, unit-tested) — `diffFiles(prev, curr)` (added/changed/removed by path +
      content), `renderChangelogEntry()` in **Keep-a-Changelog** format (Added/Changed/Fixed/Removed, empty
      sections omitted), `prependChangelogEntry()` (inserts the new entry above the most recent one, creating the
      file with a header when absent), and `generateChangelog()` one-shot (returns entry + updated `CHANGELOG.md`
      + diff; a no-change build leaves the changelog untouched with `empty:true`).
- [x] **`POST /api/workspace/changelog`** — takes `{ previousFiles, files, version?, date?, fixed?, existingChangelog? }`
      (the IDE already has the file sets — no sandbox access) → `{ entry, changelog, diff, empty }`. Rate-limited +
      request-validated (P-DATA.1).
- **Note:** delivered as a pure engine + endpoint (caller supplies the two file sets), consistent with the SBOM /
      navigate endpoints; auto-append-on-build is a thin wiring step on top once a build exposes prev+curr files.
- **Verification:** `tsc` (fe+server) ✅ · `vitest run` 3326/3326 ✅ (8 new) · `test:coverage` exit 0 · `build` ✅ ·
      `boot:check` PASS.
- **Files:** `src/server/AppMakerLab/generator/ChangelogManager.ts` (new), `src/server/routes/changelog.ts` (new),
      `tests/changelogManager.test.ts` (new), `server.ts`.

### P-PME.8 — Feature Flag Manager (replace hardcoded flags)  ✅ DONE (2026-06-29)
- Flags lived in-memory (`serverStats.featureFlags`) — admin toggles reset on every Cloud Run restart, and
  there was no per-user or percentage rollout.
- [x] **Firestore persistence** (`config/featureFlags`) — `FeatureFlagManager.loadFlagConfig` / `saveFlagConfig`
      (best-effort). The admin settings save now persists flags; the server **hydrates them on startup** into the
      in-memory cache, so toggles survive deploys/restarts.
- [x] **`/api/admin/feature-flags`** (admin-only) GET/POST — read/replace the full persisted config (flags +
      rollout + overrides) at runtime without a deploy.
- [x] **Per-user overrides + percentage rollout** — pure, unit-tested `isFlagEnabled(config, flag, userId?)`:
      precedence is per-user override → deterministic percentage rollout (stable per-(user,flag) bucketing via
      `stableHashPercent`) → global flag → false.
- **Verification:** `tsc` (fe+server) ✅ · `vitest run` 3334/3334 ✅ (8 new) · `test:coverage` exit 0 · `build` ✅ ·
      `boot:check` PASS.
- **Files:** `src/server/FeatureFlagManager.ts` (new), `tests/featureFlagManager.test.ts` (new),
      `src/server/routes/admin.ts`, `server.ts`.

### P-PME.9 — Webhook Manager (build/deploy event notifications)  ✅ DONE (2026-06-29) · 🔌 UI-WIRED (2026-06-29)
- **Now reachable in the product:** Settings → **Insights & Webhooks** (`ProjectInsightsPanel`) has a Webhooks
  section (add / list / delete / send-test) calling these endpoints — no longer a headless API. The same panel
  also surfaces P-BRE.10 (App SBOM + license check) and P-PME.11 (Build SLO compliance).
- Users couldn't wire NavBharatAI into their own CI/CD or get Slack/Discord alerts. (P-BRE.7 added a single
  global `BUILD_WEBHOOK_URL`; this adds managed, per-user, multi-URL, per-event subscriptions.)
- [x] **`WebhookManager.ts`** — per-user CRUD in Firestore `webhooks/{userId}` (`listWebhooks` / `addWebhook` /
      `removeWebhook`, capped at 20), pure validated `isValidWebhookUrl` + `normalizeEvents` (events:
      `BUILD_COMPLETE` / `BUILD_FAILED` / `DEPLOY_COMPLETE` / `DEPLOY_FAILED`), and `fireWebhooks(userId, event,
      payload)` that POSTs to every subscribed URL in parallel (reusing the P-BRE.7 `sendBuildWebhook` — 5s
      timeout, never throws). Best-effort: DB outage / VITEST degrade to no-ops.
- [x] **CRUD API** — `GET/POST /api/webhooks/:userId`, `DELETE /api/webhooks/:userId/:id`, and
      `POST /api/webhooks/:userId/test` (fires a test event so users can verify their endpoint). All
      `requireUserMatch`-scoped + request-validated (P-DATA.1).
- **Note:** auto-fire on the platform's own build events is already covered for the global webhook by P-BRE.7;
      per-user auto-fire reuses `fireWebhooks` and is wired wherever a build/deploy completion carries the owner
      uid (the management surface + test-fire make the feature fully usable + verifiable today).
- **AppKnowledgeBase:** new `webhook-manager` entry (same PR).
- **Verification:** `tsc` (fe+server) ✅ · `vitest run` 3317/3317 ✅ (9 new) · `test:coverage` exit 0 · `build` ✅ ·
      `boot:check` PASS.
- **Files:** `src/server/WebhookManager.ts` (new), `src/server/routes/webhooks.ts` (new),
      `tests/webhookManager.test.ts` (new), `src/server/NotificationManager.ts`, `server.ts`, `src/server/AppContext/AppKnowledgeBase.ts`.

### P-PME.10 — Architecture Decision Records (ADR) Auto-Capture  ✅ DONE (2026-06-29)
- Architecture decisions (pattern/stack choices) were never recorded — no "why".
- [x] **`ADRManager.ts`** (pure, unit-tested) — `generateADR({ number, date, ranked })` renders a standard ADR
      markdown (status, date, context, decision = chosen pattern + score + stack + matched constraints,
      alternatives considered with their scores, consequences) → `{ path: 'docs/decisions/ADR-NNN.md', content }`.
      `adrId()` zero-pads (ADR-001).
- [x] **Auto-capture wired** — `PatternResolutionEngine.resolveWithADR(blueprint)` resolves the architecture AND
      returns the ADR file from the ranked pattern selection (chosen + alternatives + scores), ready to write into
      the generated workspace. **Additive**: the original `resolve()` is unchanged, so existing callers are
      unaffected (safeguard #3).
- **Note:** the engine produces the ADR file; the orchestrator writing it into the workspace is the caller's
      one-line `writeFile(adr.path, adr.content)` step (consistent with the rest of the generation flow).
- **Verification:** `tsc` (fe+server) ✅ · `vitest run` 3346/3346 ✅ (6 new) · `test:coverage` exit 0 · `build` ✅.
- **Files:** `src/server/AppMakerLab/intelligence/ADRManager.ts` (new), `tests/adrManager.test.ts` (new),
      `src/server/AppMakerLab/intelligence/PatternResolutionEngine.ts`.

### P-PME.11 — SLA / Build-Time SLO Tracker  ✅ DONE (2026-06-29)
- Nothing detected when a build ran slow (a degraded experience).
- [x] **`BuildSLATracker.ts`** (pure, unit-tested) — `classifyComplexity(prompt)` (simple vs complex by
      feature-signal keywords / length), `evaluateSlo(job)` against the SLO targets (**simple = 60s, complex =
      300s**) → `{ withinSlo, overByMs }`, and `summarizeSlo(jobs)` → per-tier violation rate + p95 (reuses the
      P-BRE.8 `percentile`).
- [x] **SLO violation capture** — `BuildJobManager.updateStatus` records a `BUILD_SLO_VIOLATION` audit event
      (severity warn, with complexity/duration/overBy) on a terminal build that breached its SLO — best-effort +
      non-blocking (never affects the build).
- [x] **`GET /api/analytics/slo`** — p95 build time + violation rate per complexity tier, from the real job
      store (honest zeros until builds run).
- **Note:** violations are surfaced as structured audit events (Cloud Logging-queryable, per P-SEC.7) rather than
      a separate `sloViolations/{userId}` collection — same honest signal, no extra store; the admin p95-per-type
      view is the `/api/analytics/slo` endpoint (a card can consume it, like the P-BRE.8 build-performance card).
- **Verification:** `tsc` (fe+server) ✅ · `vitest run` 3308/3308 ✅ (9 new) · `test:coverage` exit 0 · `build` ✅ ·
      `boot:check` PASS.
- **Files:** `src/server/AppMakerLab/intelligence/BuildSLATracker.ts` (new), `tests/buildSLATracker.test.ts` (new),
      `src/server/routes/buildAnalytics.ts`, `src/server/AppMakerLab/jobs/BuildJobManager.ts`.

### P-PME.12 — Requirement Traceability (requirement → file → test)  🟡 PARTIAL → full  [LOW]
- `RequirementIntelligenceEngine.ts` parses requirements. `FilePlanningEngine.ts` maps them to files.
  But there is no traceability link: requirement #3 → generated `authService.ts` → test `auth.test.ts`.
- [ ] Add `RequirementTraceabilityMatrix.ts` — build a mapping: requirement → files generated → tests.
- [ ] Persist per build in Firestore; expose as a JSON download in the IDE.
- **Files:** new `src/server/AppMakerLab/intelligence/RequirementTraceabilityMatrix.ts`,
  `src/server/AppMakerLab/AppMakerOrchestrator.ts`.

### P-PME.13 — Semantic Version Manager  ✅ DONE (2026-06-29)
- Snapshots had names but no semantic version — users couldn't tell a breaking change from a fix.
- [x] **`SemanticVersionManager.ts`** (pure, unit-tested) — `parseSemver`/`formatSemver`/`bumpVersion`,
      `classifyBump(prev, next, {repairOnly})` (**MAJOR** on page/entity count change · **MINOR** on new features ·
      **PATCH** on repair-only/no change), and `computeNextVersion(current, prev, next)` → `{ previous, next, bump }`.
- [x] **`POST /api/workspace/version`** — caller supplies the structural signals (pages/entities/features) +
      current version → next version + bump kind. Pure computation, rate-limited + request-validated.
- **Note:** persistence of the current semver into `projectMemory/{userId}/{projectId}/version` is the caller's
      step (`ProjectMemoryManager` is in-memory; a Firestore write of the returned `next` is a one-liner where a
      build completes). The version-decision engine + API are complete.
- **Verification:** `tsc` (fe+server) ✅ · `vitest run` 3358/3358 ✅ (12 new) · `test:coverage` exit 0 · `build` ✅ ·
      `boot:check` PASS.
- **Files:** `src/server/AppMakerLab/intelligence/SemanticVersionManager.ts` (new), `src/server/routes/version.ts` (new),
      `tests/semanticVersionManager.test.ts` (new), `server.ts`.

---

## 🟠 PHASE P-CGE — CODE GENERATION ENGINE GAPS
> From the 300-component Code Generation Engine audit (2026-06-28). Already-strong items not listed.
> Only PARTIAL → Full and MISSING items, priority-ordered.
> Note: Each sub-engine listed here can expand to 100–300 specialized components during implementation.

### ✅ CGE Already Strong (do not redo)
- **Full orchestration pipeline**: AppMakerOrchestrator → BlueprintPlanner (DAG + topo sort) →
  TaskScheduler → ExecutionOrchestrator (retry×3, checkpoint, events) → EngineRegistry/Dispatcher →
  [LLMGenerationEngine / FrontendGenerationEngine / BackendGenerationEngine / DatabaseGenerationEngine /
  ScaffoldGenerator] → PatchAggregator → PatchToWorkspaceBridge → WorkspaceMutationEngine (ACID 3-phase).
- **Intelligence layer**: RequirementIntelligenceEngine, BlueprintBuilder/Compiler/Validator (×2 each),
  FilePlanningEngine, PatternLibrary (3 arch patterns) + PatternMatcher + PatternResolutionEngine,
  RepositoryIntelligenceEngine, FileAnalyzer (TS compiler), GraphGenerator, ImpactAnalyzer,
  BlueprintReconstructor, IntentExtractor, FeatureExtractor, ModuleClassifier, ArchitectureSelector.
- **Scaffolding**: ScaffoldGenerator + TemplateRegistry + ViteReactProvider + ViteReactProviderContents
  (complete Vite+React scaffold: package.json, tsconfig, vite.config, index.html, main.tsx, App.tsx).
- **Repair system**: FailureClassifier → RootCauseAnalyzer → RepairPlanner → RepairExecutor →
  RepairValidator + RepairKnowledgeBase + RepairBudgetManager + RepairConfidenceEngine (14 error classifications).
- **Validation**: QualityEvaluationEngine (Build + Lint + Runtime + Security + Architecture evaluators,
  weighted scoring), BuildVerifier, DeploymentValidator, BlueprintValidator.
- **Resilience**: CheckpointManager + CheckpointStorage (ACID checkpoint/restore), LockManager,
  JournalManager, TransactionCoordinator, ConflictDetector (interface present), EventHistoryStore.

### P-CGE.1 — True Incremental / AST-Based Patch Generation  🟡 PARTIAL → full  [HIGH]
- **Problem:** All generation engines produce full-file rewrites (`Patch = {path, content}`). There is
  no way to update a single function/class/component without regenerating the entire file. This causes
  data loss on user edits and makes partial regeneration impossible.
- [ ] Implement AST-aware partial patch: given a file + target symbol (function name / class name),
  replace only that node using ts-morph, leaving surrounding code untouched.
- [ ] Extend `IGenerationEngine` interface with `generatePatch(filePath, targetSymbol, instruction)`.
- [ ] Wire into repair flow: `RepairExecutor` should call partial-patch for `EDIT_FILE` actions instead
  of full rewrite when the file already exists.
- [ ] Implement real `ConflictDetector.detectConflicts()` — currently always returns `false` (stub).
  Use last-write-wins + 3-way merge for parallel patch application.
- **Files:** `src/server/AppMakerLab/generator/IGenerationEngine.ts`,
  `src/server/AppMakerLab/mutation/ConflictDetector.ts`,
  `src/server/AppMakerLab/autorepair/RepairExecutor.ts`,
  new `src/server/AppMakerLab/generator/ASTPatching.ts`.

### P-CGE.2 — Documentation Generators  🟡 engine+API DONE / orchestrator wiring PENDING  [HIGH]
- Generated apps had no docs. Now there is a real generator for README, API reference and TSDoc.
- [x] Added `src/server/lib/DocGenerator.ts` — pure, dependency-free: `generateReadme` (from
  name/description/features/tech-stack/setup), `generateApiDocs` (a sorted route table from `{method,path,
  description?,auth?}`), `generateTsDoc` (a TSDoc block from a parsed function signature with @param/@returns),
  and `generateDocs` (whatever the input supports). Honest: empty blueprint → minimal README (no fabricated
  features); no routes → "_No routes documented._". 7 unit tests.
- [x] Added `POST /api/docs/generate` (stateless): `{ blueprint?, routes?, signatures? }` → `{ readme?, apiDocs?, tsdoc? }`.
- [ ] **Still pending:** run it as a post-generation step in the generator (build-path wiring) and the AST-based
  inline-comment injection over real generated source (deferred — live build path + needs a real parser).
- **Files:** new `src/server/lib/DocGenerator.ts` + `.test.ts`, new `src/server/routes/docs.ts`, `server.ts`.

### P-CGE.3 — Convention & Naming Engine  🟡 engine+API DONE / build-pass wiring PENDING  [HIGH]
- Generated code had no enforced conventions. Now there is a real engine that checks + suggests fixes.
- [x] Added `src/server/lib/ConventionEngine.ts` — pure, dependency-free: `detectCase`/`toCase` (Pascal,
  camel, snake, SCREAMING_SNAKE, kebab), `checkFileName` (PascalCase for `.tsx` components, camelCase for
  `.ts` services/hooks; index/dotted files left alone), `checkIdentifier` (function→camel, constant→SCREAMING_SNAKE,
  component/type→Pascal), `classifyImport`/`orderImports` (built-ins → external → internal → relative, alphabetised),
  and `analyzeConventions` → a full report with a violation count. Honest: conforming input → zero violations. 10 tests.
- [x] Added `POST /api/convention/check` (stateless): `{ files?, identifiers?, imports? }` → violations + suggested
  fixes + reordered imports, with input caps. Usable by the IDE / a post-generation pass.
- [ ] **Still pending:** apply the engine inside the generator's `PatchAggregator` before writing to the workspace
  (build-path wiring — deferred to avoid touching the live AppMakerLab/AgentV3 path unattended).
- **Files:** new `src/server/lib/ConventionEngine.ts` + `.test.ts`, new `src/server/routes/convention.ts`, `server.ts`.

### P-CGE.4 — Test Generation Suite  🟡 engine+API DONE / snapshot+wiring PENDING  [HIGH]
- No test code was generated for built apps. Now there is a real test-scaffold generator.
- [x] Added `src/server/lib/TestSkeletonGenerator.ts` — pure, dependency-free: `generateUnitTest` (Vitest
  `describe/it/expect` per function, awaits async, identifier-sanitised against injection), `generateIntegrationTest`
  (supertest cases per route), and `generateMock` (vi.fn mock objects), + `generateTests`. Honest: these are
  runnable SKELETONS — each `it` has a smoke assertion + an explicit `// TODO: assert real behaviour`; the generator
  never emits a fake passing assertion that pretends to verify logic. 8 unit tests.
- [x] Added `POST /api/testgen` (stateless): `{ unit?, integration?, mock? }` → `{ unit?, integration?, mock? }` scaffolds.
- [ ] **Still pending:** React component snapshot tests (`@testing-library/react`), `EngineRegistry` `EngineType.TEST`
  registration, and triggering after a successful build (build-path wiring — deferred).
- **Files:** new `src/server/lib/TestSkeletonGenerator.ts` + `.test.ts`, new `src/server/routes/testgen.ts`, `server.ts`.
  `src/server/AppMakerLab/AppMakerOrchestrator.ts`.

### P-CGE.5 — OpenAPI / Contract-First API Generator  🟡 OpenAPI DONE / GraphQL+wiring PENDING  [HIGH]
- Backend generation produced route stubs but no API contract. Now there is a real OpenAPI generator.
- [x] Added `src/server/lib/OpenApiGenerator.ts` — pure, dependency-free: `expressPathToOpenApi`
  (`/users/:id` → `/users/{id}`), `extractPathParams`, and `generateOpenApi` → a valid **OpenAPI 3.0.3**
  document (paths grouped + sorted, operations per method, auto-derived path params, JSON request bodies from
  declared properties, default `200` so the spec stays valid). Honest: only declared content; nothing invented.
  8 unit tests.
- [x] Added `POST /api/openapi/generate` (stateless): `{ routes[], info? }` → an OpenAPI 3.0.3 document.
- [ ] **Still pending:** `GraphQLSchemaGenerator`, emitting `openapi.yaml` into the generated workspace, and
  using the spec as the source of truth for the P-CGE.2 API docs (build-path wiring — deferred).
- **Files:** new `src/server/lib/OpenApiGenerator.ts` + `.test.ts`, new `src/server/routes/openapi.ts`, `server.ts`.

### P-CGE.6 — Database Migration Generator  🟡 PARTIAL → full  [MED]
- `DatabaseGenerationEngine.ts` generates TypeScript entity interfaces. No SQL DDL, no Prisma
  migration files, no seed data. When blueprint specifies a database, only type stubs are created.
- [ ] Add `MigrationGenerator.ts` — when blueprint specifies Prisma + entities, emit `prisma/schema.prisma`
  + `prisma/migrations/` files from entity definitions.
- [ ] Add `SeedDataGenerator.ts` — generate realistic fake seed rows (using `@faker-js/faker` patterns)
  for each entity.
- **Files:** new `src/server/AppMakerLab/generator/MigrationGenerator.ts`,
  new `src/server/AppMakerLab/generator/SeedDataGenerator.ts`,
  `src/server/AppMakerLab/generator/DatabaseGenerationEngine.ts`.

### P-CGE.7 — Lint Fix Generator (auto-fix pass)  🟡 PARTIAL → full  [MED]
- `LintEvaluator.ts` runs ESLint and reports errors but never fixes them. Lint failures then go
  to `AutoRepairEngine.ts` which makes another LLM call — expensive and slow.
- [ ] After lint evaluation, run `eslint --fix` on the generated workspace before triggering the
  full repair pipeline. This resolves 80%+ of lint errors (unused imports, semicolons, quotes)
  without an LLM call.
- [ ] Add `LintFixGenerator.ts` as a lightweight repair step between `QualityEvaluationEngine`
  and `AutoRepairEngine` in the orchestrator pipeline.
- **Files:** new `src/server/AppMakerLab/generator/LintFixGenerator.ts`,
  `src/server/AppMakerLab/AppMakerOrchestrator.ts`.

### P-CGE.8 — Auth Code Generators (JWT + OAuth)  🟡 PARTIAL → full  [MED]
- `FilePlanningEngine.ts` plans an `authService.ts` file if `blueprint.auth.enabled`, but the
  generated auth code is a stub. No JWT issuance/validation, no OAuth flow, no session management.
- [ ] Add `AuthCodeGenerator.ts` — when `blueprint.auth.type === 'jwt'`, generate:
  - `src/server/auth/jwt.ts` — `signToken(payload)` + `verifyToken(token)` using `jsonwebtoken`.
  - `src/middleware/authMiddleware.ts` — Bearer token validation middleware.
- [ ] When `blueprint.auth.type === 'firebase'`, generate Firebase Auth hooks (init, signIn, signOut).
- **Files:** new `src/server/AppMakerLab/generator/AuthCodeGenerator.ts`,
  `src/server/AppMakerLab/intelligence/FilePlanningEngine.ts`.

### P-CGE.9 — Dockerfile + CI/CD Pipeline Generators (for generated apps)  🟡 engine+API DONE / workspace-emit PENDING  [MED]
- Generated apps had no `Dockerfile`/`docker-compose.yml`/CI. Now there is a real generator.
- [x] Added `src/server/lib/DeployArtifactGenerator.ts` — pure, dependency-free: `generateDockerfile`
  (alpine, **multi-stage**, **non-root `USER node`**, configurable node/port/build/start; single-stage option),
  `generateDockerCompose` (service + port mapping + env + restart policy), and `generateCiWorkflow` (GitHub
  Actions: checkout + setup-node + install → lint → test → build, only the declared steps — no placeholder steps).
  6 unit tests.
- [x] Added `POST /api/deploy-artifacts` (stateless): `{ docker?, compose?, ci? }` → `{ dockerfile?, dockerCompose?, ciWorkflow? }`.
- [ ] **Still pending:** emit these files into the generated workspace as a post-generation step (build-path wiring — deferred).
- **Files:** new `src/server/lib/DeployArtifactGenerator.ts` + `.test.ts`, new `src/server/routes/deployArtifacts.ts`, `server.ts`.

### P-CGE.10 — Bundle Optimization Generators  ❌ MISSING  [MED]
- Generated Vite+React apps use no bundle optimization. No code splitting, no lazy loading, no tree
  shaking config. Production apps can have large initial bundles.
- [ ] Add `BundleOptimizationGenerator.ts` — post-generation pass that:
  - Injects `React.lazy()` + `Suspense` wrapping for all page-level components.
  - Adds `vite.config.ts` `build.rollupOptions.output.manualChunks` for vendor splitting.
  - Adds `import.meta.env.PROD` guards to remove dev-only code.
- **Files:** new `src/server/AppMakerLab/generator/BundleOptimizationGenerator.ts`,
  `src/server/AppMakerLab/generator/FrontendGenerationEngine.ts`.

### P-CGE.11 — Observability Instrumentation Generator  ❌ MISSING  [MED]
- Generated apps have no logging, no error tracking, no metrics. When users deploy a generated app
  it is a black box with no observability.
- [ ] Add `ObservabilityGenerator.ts` — inject into every generated backend:
  - `morgan` HTTP request logger.
  - `window.onerror` + `unhandledrejection` handlers in frontend entry.
  - Health check endpoint (`GET /health → 200 OK`).
- **Files:** new `src/server/AppMakerLab/generator/ObservabilityGenerator.ts`,
  `src/server/AppMakerLab/AppMakerOrchestrator.ts`.

### P-CGE.12 — Additional Framework Generators (Next.js / React Native production-level)  🟡 PARTIAL → full  [LOW]
- `PatternLibrary.ts` lists Next.js and React Native as supported. The actual generation engines
  (FrontendGenerationEngine) produce generic React/Vite only, not Next.js pages/App Router or
  React Native Expo components.
- [ ] Add `NextJSGenerationEngine.ts` — generates `app/` directory structure (App Router), `page.tsx`,
  `layout.tsx`, `loading.tsx`, `error.tsx` per route.
- [ ] Add `ReactNativeGenerationEngine.ts` — generates Expo `app/(tabs)/` structure, React Native
  components (View/Text/TouchableOpacity, not div/span/button).
- **Files:** new `src/server/AppMakerLab/generator/NextJSGenerationEngine.ts`,
  new `src/server/AppMakerLab/generator/ReactNativeGenerationEngine.ts`,
  `src/server/AppMakerLab/generator/EngineRegistry.ts`.

### P-CGE.13 — Seed / Mock / Fixture Data Generators  ❌ MISSING  [LOW]
- No realistic test data is generated. Developers cannot test generated apps without manually
  creating data.
- [ ] Add `MockDataGenerator.ts` — when `blueprint.entities` present, use `@faker-js/faker`
  patterns to generate 10 seed rows per entity as `fixtures/seed.json`.
- [ ] Wire into `AppMakerOrchestrator.ts` post-database-generation step.
- **Files:** new `src/server/AppMakerLab/generator/MockDataGenerator.ts`.

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

### P-AI.1 — Hallucination Detection  ✅ DONE (2026-06-29) · 🔌 UI-WIRED
- No dedicated hallucination classifier / confidence gate existed (only optional multi-hat review).
- [x] **`HallucinationDetector.ts`** (pure, unit-tested) — a code-gen-specific hallucination lens over the
      generated files producing a **0–100 confidence score** from concrete, verifiable signals:
      **hallucinated dependency** (import of a bare package NOT in package.json — the #1 real hallucination that
      breaks install/run), **unresolved local import** (`./x` → no such file, with extension/index inference), and
      **placeholder/stub** (TODO/FIXME, "not implemented" throws, lorem ipsum). `isLowConfidence` gates at a
      configurable threshold (default 70).
- [x] **Surfaced to the user (not silently accepted)** — `POST /api/workspace/hallucination-check` +
      a **"Code Confidence (AI hallucination check)" card** in Settings → Insights & Webhooks shows the score,
      a low-confidence warning, and the exact signals (file + issue). 🔌 genuinely UI-wired.
- **Note:** the deep `ReviewerGuard`-on-every-path + twice-regenerate-and-compare are heavier AgentV3 pipeline
      changes (separate, risk-managed work); this delivers the dedicated classifier + confidence gate + the
      user-facing warning surface the item called for.
- **AppKnowledgeBase:** new `code-confidence-check` entry.
- **Verification:** `tsc` (fe+server) ✅ · `vitest run` 3367/3367 ✅ (9 new) · `test:coverage` exit 0 · `build` ✅ ·
      `boot:check` PASS.
- **Files:** `src/server/AgentV3/HallucinationDetector.ts` (new), `src/server/routes/hallucination.ts` (new),
      `tests/hallucinationDetector.test.ts` (new), `src/components/panels/ProjectInsightsPanel.tsx`, `server.ts`,
      `src/server/AppContext/AppKnowledgeBase.ts`.

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

> **2026-06-28 (2nd-pass enrichment):** A deeper 300-component re-audit confirmed P-AI.1–13 above, and
> surfaced 4 additional gap-groups (P-AI.14–17) not previously listed. (Build-ETA/deadline prediction is
> already tracked in **P-PME.4**, and DB query/migration generation in **P-CGE.6** — not duplicated here.)

### P-AI.14 — Explicit Reasoning Engines  ❌ MISSING  [LOW — mostly academic for a code-gen app]
- All reasoning today is implicit inside LLM prompts. There are no explicit, testable reasoning modules.
  Most of these are low-ROI for a code-generation product, but the **constraint solver** is the one with
  real near-term value (resolving conflicting blueprint requirements / dependency version constraints).
- [ ] (MED) `ConstraintSolver.ts` — resolve conflicting requirements & dependency version ranges during planning.
- [ ] (LOW) Causal & temporal reasoning helpers for multi-step build/debug ordering.
- [ ] (SKIP unless needed) symbolic / probabilistic / spatial / scientific reasoning — track as N/A-by-design for now.
- **Files:** new `src/server/AI/reasoning/ConstraintSolver.ts`.

### P-AI.15 — Ensemble / Voting / Arbitration  🟡 PARTIAL → full  [MED]
- `Consensus.ts` runs a multi-persona expert panel on hard design decisions, but there is no general
  **ensemble** for routine outputs: no majority **voting** across providers, no **arbitration** when two
  providers disagree, no **response fusion** that merges the best parts of multiple completions.
- [ ] Add `EnsembleCoordinator.ts` — for high-stakes generations, sample N providers and pick via a scorer.
- [ ] Add a voting/arbitration step: when 2 providers diverge on critical code, score both via `QualityEvaluationEngine` and keep the winner (reuse the P-AI.12 model-eval scorer).
- **Files:** new `src/server/AgentV3/EnsembleCoordinator.ts`, `src/server/AgentV3/Consensus.ts`.

### P-AI.16 — Tool Discovery & Invocation Planner  🟡 PARTIAL → full  [MED]
- `ToolDispatcher.ts` executes a fixed, hardcoded tool set by name. There is no **tool discovery**
  (dynamic registry the agent can query for available tools + schemas) and no **invocation planner**
  (deciding the order/batching of tool calls before executing them).
- [ ] Add a tool registry the agent can introspect (name, description, schema, when-to-use) instead of a hardcoded switch.
- [ ] Add a lightweight invocation planner: batch independent tool calls, sequence dependent ones.
- **Files:** `src/server/AgentV3/ToolDispatcher.ts`, new `src/server/AgentV3/ToolRegistry.ts`.

### P-AI.17 — Provider Latency / Reliability Prediction + Smart Job Scheduling  🟡 PARTIAL → full  [LOW]
- `HealthRegistry.ts` + `AIRouter` cooldowns track provider health reactively. Missing: **predictive**
  latency/reliability scoring to pick the fastest healthy provider, and **priority-aware job scheduling**
  in `BuildJobManager` (today it is FIFO, no priority/queue intelligence).
- *(Build-duration ETA is out of scope here — already tracked in **P-PME.4**.)*
- [ ] Record rolling p50/p95 latency + success-rate per provider; bias `routeRaced` toward the predicted-best.
- [ ] Add priority + concurrency-aware scheduling to `BuildJobManager` (paid/PRO jobs ahead of free).
- **Files:** `src/server/AI/HealthRegistry.ts`, `src/server/AI/Router/AIRouter.ts`, `src/server/AppMakerLab/jobs/BuildJobManager.ts`.

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

## 🟫 PHASE P-DATA — DATA & BACKEND ENGINE GAPS
> From a 300-component **Data & Backend** audit (2026-06-28, 6 deep-scan agents, cited files verified).
> NavBharatAI's backend is a **managed-serverless Express monolith** (Cloud Run + Firestore + E2B). Most of
> the 300 items are either already DONE or **⬜ N/A-by-design**. Only genuinely-actionable, platform-relevant
> gaps that are **NOT already tracked in another phase** are listed below.

### ✅ Data & Backend Already Strong (do not redo)
- App server + REST: `server.ts` (Express, Helmet, CORS, rate-limit, trace mw) + 32 modular routes; `AppMakerLab/kernel/ServiceRegistry` (DI + cycle detection); `UnifiedBuildOrchestrator`, `AppMakerOrchestrator`.
- Persistence: Firestore (`lib/db.ts`, `firestore.indexes.json`), `WorkspaceStore` codec, `FirestoreJobStore`, `FirestoreConversationStore`, `UserProfileStore`, `UserCostStore`, `secrets.ts` (AES-256).
- Transactions/integrity: `mutation/{TransactionCoordinator,JournalManager,LockManager,ConflictDetector}`, `VersionStore` (git-like snapshots + restore), `CheckpointManager`.
- Eventing/observability: `lib/{eventBus,eventStore,logStore,metrics,metricsAlerts}`, `ObservabilityManager`, `AgentV3CostTelemetry`.
- Multi-tenant/billing: namespace-isolated routers, `engineerQuota`, Cashfree payments + wallet/passes, usage metering, cost tracking.
- AI backend: `AIRouterManager` (3 universes) + `AIRouter` (raced, circuit-breaker, concurrency cap) + `HealthRegistry`; vector search (`EmbeddingSearch`), conversation/memory/agent-state stores.
- Auth: Firebase ID-token verify (`authMiddleware`), per-user ownership checks; document/PDF/spreadsheet ingestion (`attachmentText`, `visionDescribe`).

### ⬜ N/A-by-design / already tracked elsewhere (NOT added here)
- Kafka/RabbitMQ/NATS/Redis, distributed cache, pub/sub, worker pools, connection pools, read/write replicas,
  multi-region/cluster DB, SQL/Graph/Time-series DBs, gRPC, Saga/Outbox/2PC, microservice/service-discovery —
  **⬜ N/A-by-design** (managed-serverless: Cloud Run + Firestore; single-process). DB query/migration **codegen for
  user apps** → already **P-CGE.6**.
- Queue + distributed cache → **P7**; durable build-job queue → **P-BRE.6**; GCS build cache → **P-BRE.5**;
  build/deploy + email notifications → **P-BRE.7** / webhooks → **P-PME.9**; tracing/alerting → **P8/P2.1**;
  backup/DR/replication/PITR + health/readiness probes → **P2.4/P9**; CDN/KMS/WAF → **P10**; API versioning →
  **P1.1**; CQRS → **P4.1**; event-sourcing replay → **P4.2**; RBAC/roles/permissions → **P-SEC.1**; key rotation → **P-SEC.5**.

### P-DATA.1 — Runtime Schema / Request / Response Validation  ✅ DONE (validation layer + initial rollout) (2026-06-29)
- Routes validated payloads ad-hoc (manual `if`s) or not at all — malformed/malicious bodies reached handlers
  unchecked.
- [x] **Runtime schema layer + middleware** (`src/server/lib/validate.ts`) — a dependency-free schema builder
      (`vstring`/`vnumber`/`vboolean`/`venum`/`varray`/`vobject`/`vrecord`, each with `optional`/range/pattern)
      plus `validateBody(schema)` + `validateQuery(schema)` Express middleware that 400s with precise issues on
      failure and replaces `req.body` with the parsed value. **Sanitizing by default** — `vobject` DROPS unknown
      keys, so an injected extra field never reaches the handler (`{passthrough:true}` to keep them).
- [x] **Dependency-free, by deliberate choice** — NOT `zod`: this codebase has a consistent no-new-dependency
      culture (native TOTP, native SBOM, the dep-free logger), and the validator is server-side only; the layer
      covers the shapes API bodies actually use and is fully unit-tested (`tests/validate.test.ts`).
- [x] **Real rollout** — applied to `POST /api/workspace/sbom` (replaced its manual check with a typed schema).
      Per-route rollout continues incrementally as routes are touched (same approach as the P-BRE.3 logger
      migration — high-value core shipped + used now, broad sweep done lazily).
- **Already covered:** Firestore write sanitization exists (`src/lib/firestoreUtils.ts` `sanitizeFirestoreData`,
      strips `undefined`). **Deferred (honest):** response-schema validation in CI is a separate dev-only harness
      — not built here.
- **Verification:** `tsc` (fe+server) ✅ · `vitest run` 3273/3273 ✅ (11 new) · `test:coverage` exit 0 · `build` ✅ ·
      `boot:check` PASS.
- **Files:** `src/server/lib/validate.ts` (new), `tests/validate.test.ts` (new), `src/server/routes/sbom.ts`.

### P-DATA.2 — Durable Workspace Artifact / Checkpoint Store  🟡 PARTIAL → full  [MED — data-loss risk]
- Workspace *files* are durable in Firestore, but **checkpoints / VersionStore snapshots are written to local disk**
  (`.checkpoints`), which is **ephemeral on Cloud Run** with `min-instances=0` — undo/rollback history is lost on
  scale-to-zero or instance recycle. (Distinct from P-BRE.5 build-cache and P-BRE.6 job-queue.)
- [ ] Back `CheckpointManager` / `VersionStore` with Firestore (or a GCS bucket) so undo/restore survives restarts.
- [ ] Keep local disk as a fast write-through cache; reconcile on boot.
- **Files:** `src/server/AppMakerLab/checkpoint/CheckpointManager.ts`, `src/server/project/VersionStore.ts`.

### P-DATA.3 — Durable Embedding / Vector Store  🟡 PARTIAL → full  [MED]
- `EmbeddingSearch` keeps embeddings in an in-memory `Map` — lost on every cold start, so RAG re-embeds the whole
  workspace each boot (latency + cost). (Complements P-AI.2's reranker/grounding, which is about *quality*, not persistence.)
- [ ] Persist embeddings (Firestore vector index, or a lightweight on-disk+GCS store keyed by file hash); re-embed only changed files.
- **Files:** `src/server/AgentV3/EmbeddingSearch.ts`, new `src/server/AgentV3/EmbeddingStore.ts`.

### P-DATA.4 — Data Retention + Deletion (DPDP/GDPR right-to-be-forgotten)  ❌ MISSING  [MED — compliance]
- The platform stores user profiles, conversations, build history, cost records, secrets — but has **no retention
  policy and no user-data-deletion workflow**. `ComplianceAnalysis` only scans *generated apps*, not NavBharatAI itself.
- [ ] Add a `DataRetentionManager`: configurable TTL per collection (e.g. logs 90d, conversations 1y) + scheduled purge.
- [ ] Add an account-deletion endpoint that cascades across all user-scoped Firestore collections (right-to-be-forgotten).
- **Files:** new `src/server/lib/DataRetentionManager.ts`, `src/server/routes/profile.ts`, `server.ts`.

### P-DATA.5 — OpenAPI / Contract Spec for the REST API  ❌ MISSING  [LOW]
- 32 routes have no machine-readable contract. No OpenAPI/Swagger → no generated client types, no contract tests, no docs.
- [ ] Generate an `openapi.json` from zod schemas (P-DATA.1) via `zod-to-openapi`; serve at `/api/docs`.
- **Files:** new `src/server/lib/openapi.ts`, `server.ts`.

### P-DATA.6 — Hardened File Upload Pipeline  🟡 PARTIAL → full  [LOW]
- Attachments are parsed for text (`attachmentText`) but there is no durable multipart upload, size/type enforcement,
  or malware scan for user-supplied files.
- [ ] Add multipart handling + strict size/MIME validation; store to Firebase Storage/GCS; optional ClamAV/VirusTotal scan.
- **Files:** new `src/server/routes/upload.ts`, `src/server/lib/attachmentText.ts`.

### P-DATA.7 — Data Export / Report Generation  ❌ MISSING  [LOW]
- Users can import (ZIP/Excel/CSV/JSON) but cannot export their data (build history, cost/usage, project metadata) as CSV/Excel/PDF.
- [ ] Add export endpoints (CSV/Excel via `xlsx`, PDF via a renderer) for build history, usage/cost, and project metadata.
- **Files:** new `src/server/routes/export.ts`.

---

## 🎨 PHASE P-DESIGN — UI/UX & DESIGN PLATFORM GAPS
> From a 300-component **UI/UX & Design** audit (2026-06-28, 6 deep-scan agents, cited files verified).
> NavBharatAI's frontend (React + TS + **Tailwind v4** + **motion** + Monaco + xterm) is **rich** — most of the
> 300 are already DONE. Only genuinely-actionable design-platform gaps that are **NOT already tracked elsewhere**
> are listed. (This complements **P-UX**, which covers UX/product-feature gaps like consent, tours, NPS, skeletons.)

### ✅ Design Already Strong (do not redo)
- Theme system: `src/lib/theme.ts` (5 modes incl. high-contrast), token catalog/editor `ide/DesignSystem.tsx`.
- Builder/editor: `ide/VisualEditor.tsx` (DOM inspector + style/color/border/typography panels), `ide/ComponentLibrary.tsx` (32+ components + playground), `ide/MultiPageBuilder.tsx`, `ide/Editor.tsx` (Monaco), `ide/TerminalPanel.tsx` (xterm), `MessageContent.tsx` (markdown).
- Design→code: `ide/FigmaImporter.tsx`, `ide/ScreenshotToCode.tsx`, `ide/DarkModeGenerator.tsx`.
- Preview/responsive: `ide/PreviewPanel.tsx` (device modes, orientation, viewport/ResizeObserver). Motion animations, `CommandPalette`, `DiffViewer`, `Toast` (aria-live), `useUndoRedo` + `versionSnapshot`/`CodeVersioning`.
- i18n (user-app feature): `ide/LocalizationManager.tsx` (18 languages + RTL). Personalization: `lib/apnapanEngine.ts`.

### ⬜ N/A-by-design / already tracked elsewhere (NOT added here)
- Skeleton screens → **P-UX.2**; session-replay/heatmap → **P-UX.9**; Storybook/component-gallery → **P-UX.10**;
  visual-regression / pixel-comparison → **P-TQA**. Platform UI is English-by-law so platform-i18n is N/A
  (LocalizationManager serves *generated* apps). Material/Fluent/Cupertino/Carbon kits, WebGL/WebGPU, canvas-drawing,
  node/flow & diagram editors, eye-tracking/cognitive-load/attention-mapping, SSR/hydration of the builder UI — **⬜ N/A-by-design**.

### P-DESIGN.1 — Shared UI Primitive Library wired to Design Tokens  🟡 PARTIAL → full  [HIGH]
- `DesignSystem.tsx` defines tokens but they are a **viewer/exporter**, not the live source — there is **no
  `src/components/ui/` atom library** (Button/Input/Card/Badge/Modal/etc.). The 116 components re-implement
  primitives ad-hoc (inline Tailwind), so there is no atomic→molecule→organism structure, no shared variants/states/slots.
- [ ] Build `src/components/ui/` primitives (Button, Input, Select, Card, Badge, Tabs, Tooltip…) consuming theme tokens as the single source of truth.
- [ ] Refactor high-traffic views to use them (incremental, no behavior change); enables consistency + theming everywhere.
- **Files:** new `src/components/ui/*`, `src/lib/theme.ts`, `src/components/ide/DesignSystem.tsx`.

### P-DESIGN.2 — Missing Overlay & Interaction Primitives  🟡 PARTIAL → full  [MED]
- No reusable **Tooltip / Popover / Context-Menu / Drawer / Bottom-Sheet** primitives; drag-and-drop is motion-only
  (no `DndContext`); no resize interaction. Modals are centralized (`AppModals.tsx`) but other overlays are absent.
- [ ] Add accessible Tooltip, Popover, ContextMenu, Drawer, BottomSheet (part of P-DESIGN.1's `ui/`).
- [ ] Add a real DnD layer (`@dnd-kit`) for the visual builder + file tree; add resize handles for panels.
- **Files:** new `src/components/ui/*`, `src/components/ide/VisualEditor.tsx`, `FileExplorer.tsx`.

### P-DESIGN.3 — Platform Accessibility Engine  🟡 PARTIAL → full  [MED]
- A11y is scattered: ARIA used in ~16 files, `Toast` has `aria-live`, `PerformanceAnalyzer` audits *generated* apps —
  but the platform's own UI has no centralized a11y, no `prefers-reduced-motion` wiring, no font-scaling/zoom, no
  color-blind support, and only partial contrast validation.
- [ ] Honor `prefers-reduced-motion` globally (gate motion animations); add font-scaling + zoom controls in settings.
- [ ] Add a focus-trap/roving-tabindex util for overlays; run an internal WCAG checklist in CI on the builder UI.
- **Files:** `src/main.tsx`, `src/lib/theme.ts`, new `src/lib/a11y.ts`, settings panel.

### P-DESIGN.4 — Chart / Data-Visualization Component Library  🟡 PARTIAL → full  [MED]
- No charting library (chart.js/recharts/d3). Analytics/health/billing dashboards (`AppAnalytics`, `AppHealthMonitor`,
  `BillingPanel`) render text/metric displays only; generated apps also can't get charts.
- [ ] Adopt a lightweight chart lib (e.g. `recharts`); add Line/Bar/Area/Pie wrappers in `ui/`; use them in the dashboards.
- **Files:** new `src/components/ui/charts/*`, `src/components/ide/AppAnalytics.tsx`, `AppHealthMonitor.tsx`.

### P-DESIGN.5 — AI Design Generation & Critique  🟡 PARTIAL → full  [MED-HIGH — differentiator]
- AI design is shallow: `AISuggestions` is static/pattern-based and `DarkModeGenerator` is the only real AI design tool
  (`ScreenshotToCode` exists). Missing: generative **wireframe/layout/component** generation, **AI design critic**,
  and **AI color-palette/typography** suggestions from a brand or reference.
- [ ] Add an AI "design pass": generate layout/wireframe options + a component from a prompt, and an AI design-critique on the current preview (uses the AgentV3 multi-model backend).
- [ ] Add AI palette + type-scale suggestions feeding `DesignSystem` tokens.
- **Files:** `src/components/ide/AISuggestions.tsx`, new `src/components/ide/AIDesignPass.tsx`, AgentV3 backend.

### P-DESIGN.6 — Prototyping Engine (interactive preview)  ❌ MISSING  [LOW]
- No interactive prototype / transition preview / click-through flow between generated pages (only live app preview).
- [ ] Add a prototype mode: link pages, preview transitions, shareable read-only prototype link.
- **Files:** new `src/components/ide/PrototypeMode.tsx`, `ide/MultiPageBuilder.tsx`.

### P-DESIGN.7 — Real-Time Design Collaboration Hardening  🟡 PARTIAL → full  [LOW]
- `LiveCollaboration.tsx` has room chat + presence + debounced code push, but **no cursor sharing, no element-level
  comments/annotations, and no OT/CRDT** (last-write-wins). (Editor merge is separately tracked in P-DEV.)
- [ ] Add live cursors + element-anchored comments/annotations; evaluate a CRDT (Yjs) for conflict-free co-editing.
- **Files:** `src/components/ide/LiveCollaboration.tsx`, `TeamCollaboration.tsx`.

### P-DESIGN.8 — Design Governance (consistency + brand compliance)  ❌ MISSING  [LOW]
- `WhitelabelBranding.tsx` sets brand config but there is no **consistency checker**, **visual linter**, or
  **design-policy/registry** enforcing token usage / brand rules across a generated app.
- [ ] Add a visual-lint pass: flag off-token colors/spacing/fonts in generated code; report brand-compliance score.
- **Files:** new `src/server/AppMakerLab/intelligence/DesignLinter.ts`, `src/components/ide/WhitelabelBranding.tsx`.

---

## 🚀 PHASE P-DEPLOY — DEVOPS & DEPLOYMENT GAPS
> From a 300-component **DevOps & Deployment** audit (2026-06-28, 3 deep-scan agents, cited files verified).
> NavBharatAI is **managed-serverless** (Cloud Build → Cloud Run, Firestore, E2B) and ships a real deployment
> engine + multi-cloud providers. The **vast majority** of the 300 are already DONE, ⬜ N/A-by-design, or
> already tracked in other phases. Only the genuinely-new actionable gaps are listed.

### ✅ DevOps Already Strong (do not redo)
- CI/CD: `.github/workflows/ci.yml` (typecheck→test→build→boot) + `cloudbuild.yaml` (docker→GCR→Cloud Run on push to main) + `deploy.yml`.
- Deployment engine: `src/server/AppMakerLab/deployment/*` (DeploymentEngine state machine, DeploymentPlanner, ArtifactBuilder, Validator, RollbackManager, AuditManager, StateManager) + `EngineerAI/DeploymentService.ts` + `pro/ProDeploy.ts`.
- Multi-cloud user-app deploy: Firebase Hosting (preview channels), `VercelProvider`, `NetlifyProvider`, `DeployProviders.ts`; GCR artifact registry; Cloud Run autoscale (min 0 / max 10, concurrency 100).
- Git/GitHub: `AgentV3/{GitManager,GitHubPrFlow}.ts`, `routes/{github,githubAuth}.ts` (OAuth, PR flow, CI verdict polling); custom domains + TLS/DNS via Cloudflare (`routes/domains.ts`).
- Security/compliance in CI: `npm audit` gate, secret/security scanning, ComplianceAnalysis, DeploymentAuditManager; cost telemetry (`AgentV3CostTelemetry`), metrics + alert rules (`lib/{metrics,metricsAlerts}`).

### ⬜ N/A-by-design / already tracked elsewhere (NOT added here)
- **⬜ N/A-by-design (managed-serverless):** all Kubernetes/Helm/Argo/Flux/Kustomize/GitOps, cluster/pod/namespace/ingress/network-policy/PV/ConfigMap/StatefulSet/DaemonSet, Lambda/Cloud-Functions/edge-functions (Cloud Run is used), Terraform/Pulumi/CloudFormation/Bicep/Ansible/Chef/Puppet/SaltStack, traffic-mirroring/shadow/service-mesh, self-hosted-runner/on-premise.
- **Already tracked:** canary/blue-green/rolling/rollback/deployment-strategy/probes → **P9**; tracing/observability/metrics/alerting/error-monitoring/dashboards → **P8/P2**; IaC + artifact registry → **P6**; CDN/edge/KMS/WAF/chaos/load → **P10**; container-scan/SBOM/secret-scan/key-rotation/supply-chain/DAST/incident-runbook → **P-SEC**; build-cache/durable-jobs/smoke-test/build-analytics → **P-BRE**; release-notes/changelog/semver/feature-flags/webhook/SLA-SLO → **P-PME**; build/deploy + email notifications → **P-BRE.7**; DB/schema migration → **P-CGE.6 / P1.2**.

### P-DEPLOY.1 — DORA Metrics Engine  ✅ DONE (2026-06-29)
- [x] New `src/server/lib/DoraMetrics.ts` — computes all 4 DORA metrics from recorded deploy + incident events:
      deployment frequency (per day), change lead time (median, when known), change failure rate (%), MTTR (mean
      restore time), plus the overall DORA tier (elite/high/medium/low) via the standard 2022 bands. All calculators
      are PURE + unit-tested; an in-memory bounded collector records deploys/incidents.
- [x] Wired to a REAL signal (no fake data): each production server-ready (`markServerReady`, a new Cloud Run
      revision going live) records a successful deploy, so deployment frequency reflects actual revisions. Incidents
      can be recorded/resolved to feed MTTR. Metrics with no data are reported as `null` honestly — never faked.
- [x] Surfaced via admin-gated `GET /api/observability/dora?days=N` (in the existing observability route).
- **Verification:** `tsc` (fe+server) ✅ · `vitest run` 2997/2997 ✅ (17 new) · server boots + LIVE check: a prod boot
      recorded `deploymentCount:1`, lead/mttr honestly `null`, tier computed; no-admin → 403 ✅.
- **Files:** `src/server/lib/DoraMetrics.ts` (+ `.test.ts`), `src/server/routes/health.ts`, `src/server/routes/observability.ts`.

### P-DEPLOY.2 — Staging Environment + Promotion Pipeline  ❌ MISSING  [MED]
- The platform deploys **straight to prod on merge to `main`** — there is no staging/QA environment and no
  `dev → staging → prod` promotion gate. (P9 covers canary on the single prod service, not multi-env promotion.)
- [ ] Add a staging Cloud Run service + a promotion step (deploy to staging → smoke-check → promote to prod).
- [ ] For user apps: a "preview → production" promotion flow on top of Firebase preview channels.
- **Files:** `cloudbuild.yaml`, `.github/workflows/deploy.yml`, `src/server/AppMakerLab/deployment/DeploymentEngine.ts`.

### P-DEPLOY.3 — AI Deployment Ops (AIOps)  🟡 PARTIAL → full  [LOW-MED]
- `DeploymentPlanner` (AI deploy planning) and `AgentV3CostTelemetry` (cost optimization) exist, but there is no
  **AI release planner, capacity planner, incident analyzer, deployment-risk predictor, or environment optimizer**.
- [ ] Add an AI pre-deploy risk assessment (diff size, touched-criticality, test coverage → risk score + advice).
- [ ] Add an AI incident/RCA analyzer that ingests deploy + error events and proposes a likely cause + rollback advice.
- **Files:** `src/server/AppMakerLab/deployment/DeploymentPlanner.ts`, new `src/server/AppMakerLab/deployment/DeployRiskAdvisor.ts`.

### P-DEPLOY.4 — App Store / Mobile Distribution Automation  🟡 PARTIAL → full  [LOW]
- `ide/APKBuilder.tsx` (Android APK/TWA) and `ide/AppStorePublisher.tsx` exist but are **UI/checklist only** —
  no automated Play Store / App Store submission, signing, or release-track management.
- [ ] Wire real store connectors (Play Developer API / App Store Connect API) for signed upload + track promotion.
- **Files:** `src/components/ide/APKBuilder.tsx`, `src/components/ide/AppStorePublisher.tsx`, new backend route.

### P-DEPLOY.5 — Release Approval / Freeze Gate  ❌ MISSING  [LOW]
- Deploy is fully automatic on merge (by design). There is no optional **manual approval gate** or **freeze window**
  for high-risk releases (e.g. during incidents). This is a safety add-on, not a replacement for auto-deploy.
- [ ] Add an opt-in approval gate + a freeze flag (Firestore config) the deploy pipeline checks before promoting.
- **Files:** `.github/workflows/deploy.yml`, `cloudbuild.yaml`, `src/server/routes/admin.ts`.

### P-DEPLOY.6 — Expanded Deploy Targets + Wire MultiCloudDeploy UI  🟡 PARTIAL → full  [LOW]
- `ide/MultiCloudDeploy.tsx` lists Railway/Render/Fly.io/Cloudflare but only Firebase/Vercel/Netlify have real
  backend providers. Repo integration is GitHub-only (no GitLab/Bitbucket).
- [ ] Implement real providers for the listed targets (or hide unsupported ones); optionally add GitLab/Bitbucket import.
- **Files:** `src/server/AgentV3/DeployProviders.ts`, `src/components/ide/MultiCloudDeploy.tsx`.

---

## 🤝 PHASE P-COLLAB — COLLABORATION PLATFORM GAPS
> From a 300-component **Collaboration** audit (2026-06-28, 2 deep-scan agents, cited files verified).
> NavBharatAI is primarily a **single-user AI app builder** with light team features. The vast majority of
> the 300 are either **⬜ N/A-by-design** (it is not a comms platform) or **already tracked** in other phases.
> Only the genuinely-new, product-fitting, untracked gaps are listed.

### ✅ Collaboration Already Strong (do not redo)
- Live rooms: `ide/LiveCollaboration.tsx` (Firebase realtime presence + room chat + QR + debounced code push).
- Team UI + roles: `ide/TeamCollaboration.tsx` (Admin/Editor/Viewer, activity feed, share-link UI), `routes/team.ts` (invite endpoint).
- Versioning/undo/audit: `ide/CodeVersioning.tsx`, `useUndoRedo`, `lib/audit.ts`; cross-device sync `routes/{sync,cloudsync}.ts`.
- AI collaboration: AgentV3 multi-agent coordination, `Consensus`, human-in-the-loop `Approvals.ts`, `ReviewerAgent`, shared `WorkspaceMemory`/`AppKnowledgeBase`, semantic search `EmbeddingSearch`, shared `SyncedTemplates`.

### ⬜ N/A-by-design / already tracked elsewhere (NOT added here)
- **⬜ N/A-by-design (not a comms platform):** team chat/DM/channels (Slack-like), voice/video rooms, screen-share/annotation, remote-control, whiteboard/diagram/canvas co-edit, meeting scheduler/calendar/timezone, recording/transcripts/AI-meeting-notes, task/sprint/milestone management, RACI matrix, expert-finder/skill-discovery, org/relationship graph, enterprise hub, team-health dashboards, eDiscovery/legal-hold.
- **Already tracked:** RBAC/role enforcement → **P-SEC.1**; inline code comments/review-mode/threads → **P-DEV.11**; cursor-sharing/element-comments/OT/CRDT realtime co-edit → **P-DESIGN.7**; 3-way merge/conflict-resolution → **P-DEV.4**; voice collaboration → **P-DEV.13**; offline mode/sync → **P-DEV.7/P3.2**; cross-session/workspace persistence → **P-DEV.2/P-PME.1**; ADR/decision log → **P-PME.10**; human-approval gate → **P-AI.8**; notification delivery → **P-BRE.7/P-PME.9**; AI code/design reviewers + semantic search → **P-AI**; retention/legal-hold → **P-DATA.4**; data export → **P-DATA.7**; workspace backup/restore → **P-DATA.2/P9**.

### P-COLLAB.1 — Durable Team Membership + Invite Acceptance  🟡 PARTIAL → full  [MED-HIGH]
- Team members + invites live in **localStorage** and `routes/team.ts` only **records** invites — email delivery is a
  stub ("coming soon") and there is no accept flow, so teams vanish on logout. (RBAC *enforcement* is P-SEC.1; this is
  the membership **data model + invite lifecycle**.)
- [ ] Persist `teams/{teamId}/members` in Firestore (uid, role, status); real invite email + token-based accept route.
- [ ] Load team + role on login; make `TeamCollaboration.tsx` read/write the backend instead of localStorage.
- **Files:** `src/server/routes/team.ts`, `src/components/ide/TeamCollaboration.tsx`, new `src/server/lib/TeamStore.ts`.

### P-COLLAB.2 — Shared Workspace Access Model (backend ACL)  🟡 PARTIAL → full  [MED]
- Share links (`navbharat.ai/shared/{projectId}`) and access toggles are **UI-only**; nothing on the backend enforces
  *which users can open which project*. Workspaces are owner-scoped with no member-grant.
- [ ] Add a project membership/ACL: owner can grant team members access; enforce on every workspace/build/deploy route.
- [ ] Resolve shared-link access server-side (member vs anyone-with-link vs expired).
- **Files:** `src/server/workspace/WorkspaceManager.ts`, `src/server/routes/{sync,engineer,agentv3}.ts`, new ACL middleware.

### P-COLLAB.3 — Client / Stakeholder Share Portal + Feedback Collection  ❌ MISSING  [MED]
- No way to share a built app/preview **read-only** with a non-member (client/stakeholder) and collect their feedback
  or approval — a natural deliverable-handoff for an app builder.
- [ ] Add a read-only shared preview link + a lightweight feedback/approval widget that records responses to Firestore.
- **Files:** new `src/server/routes/share.ts`, new `src/components/SharePortal.tsx`, `routes/preview.ts`.

### P-COLLAB.4 — Shared Team Libraries (prompts / templates / components)  🟡 PARTIAL → full  [LOW]
- `SyncedTemplates` and `ComponentLibrary` are **global** (one instance for everyone); there is no **team-scoped**
  shared prompt / template / component library a team can curate and reuse.
- [ ] Add team-scoped libraries (Firestore, keyed by teamId) for prompts, templates, and saved components.
- **Files:** new `src/server/lib/TeamLibraryStore.ts`, `src/components/ide/{ComponentLibrary,SyncedTemplates}.*`.

### P-COLLAB.5 — Team @Mention + Notification Routing  ❌ MISSING  [LOW]
- No `@mention` of teammates in the workspace and no routing of an event (mention, role-change, share) to the right
  member. (Inline-code comments are P-DEV.11; this is workspace-level mention + routing.)
- [ ] Add an `@mention` picker in chat/comments; route mentions to in-app + email (reusing P-BRE.7 notification delivery).
- **Files:** `src/components/ide/LiveCollaboration.tsx`, new `src/server/lib/MentionRouter.ts`.

### P-COLLAB.6 — SSO / Identity Federation (SAML / OIDC)  ❌ MISSING  [LOW — enterprise]
- Auth is Firebase OAuth (Google) + phone OTP only; there is no SAML/OIDC SSO or directory federation for enterprise
  teams. (Distinct from P-SEC.3 MFA and P-SEC.1 RBAC.)
- [ ] Add SAML/OIDC SSO via Firebase Auth SAML/OIDC providers; map federated identity → team membership.
- **Files:** `src/config/firebase.ts`, `src/server/lib/authMiddleware.ts`, `src/components/AuthComponent.tsx`.

---

## 📈 PHASE P-MON — MONITORING & ANALYTICS GAPS
> From a 300-component **Monitoring & Analytics** audit (2026-06-28, 2 deep-scan agents, cited files verified).
> This is the **most-overlapping** category: the observability *core* (metrics/logs/tracing/error-tracking/alerting/
> SLO/DORA) is already tracked across P2/P8/P-BRE/P-PME/P-DEPLOY, and infra monitoring is ⬜ N/A-by-design.
> Only the genuinely-new **analytics/intelligence** gaps remain.

### ✅ Monitoring Already Strong / In-Flight (do not duplicate)
- Metrics: `lib/metrics.ts` (MetricsRegistry) + `metricsStore.ts` (Firestore daily snapshots) + `AgentV3CostTelemetry` (cost/quality per build) + `TokenUsageManager` — token/cost/build/success metrics are real.
- Logs: `lib/{logStore,audit}.ts` (structured, queryable Firestore `server_logs`, traceId field); admin endpoints `/api/admin/{metrics,logs,events,analytics}`.
- Alert rules: `lib/metricsAlerts.ts` (error-rate / preview-rate / slow-build thresholds). Event bus + store. Hallucination/authenticity via `BuildConfidence` (P-AI.1). Build-quality score via `BuildConfidence`.

### ⬜ N/A-by-design / already tracked elsewhere (NOT added here)
- **Already tracked:** OpenTelemetry/distributed-tracing/spans/service-map → **P2.1/P8/P-BRE.1**; error-tracking/Sentry/crash/exception → **P2.2/P8**; structured-logging/correlation-IDs/log-parsing → **P-BRE.3**; SIEM/security-analytics/threat → **P-SEC.7**; alerting-dispatch/notifications/incident/pager/Slack/email → **P8/P-BRE.7/P-PME.9**; SLO/SLA/SLI/error-budget → **P8/P-PME.11**; DORA/MTTR/lead-time → **P-DEPLOY.1**; charts/viz/dashboard-builder/graph/heatmap-render → **P-DESIGN.4**; session-replay/heatmap/RUM → **P-UX.9**; model-eval/benchmark → **P-AI.12**; hallucination-monitoring → **P-AI.1**; data-quality/lineage/retention → **P-DATA**; observability **for generated apps** → existing P-CGE/P-DEV item.
- **⬜ N/A-by-design (managed-serverless, single-region):** Kubernetes/cluster/pod/node/container/GPU/power/network/disk/filesystem monitoring, multi-cloud/hybrid/edge/geo/multi-region monitoring, OLAP/data-warehouse/time-series-DB integration, carbon/GreenOps.

### P-MON.1 — Server-Side Analytics Pipeline + Product Analytics  🟡 PARTIAL → full  [MED]
- `lib/analytics.ts` is **client-side localStorage** event tracking; there is no server-side aggregation/ETL, and no
  **product analytics** (funnels, cohorts, retention, engagement, conversion, segmentation). `AppAnalytics.tsx` reads localStorage.
- [ ] Add a server `/api/analytics/event` ingestion → Firestore + a daily rollup job; build funnel/cohort/retention queries.
- [ ] Surface activation, feature-adoption, and conversion (signup→build→deploy→pay) funnels in the admin dashboard.
- **Files:** `src/lib/analytics.ts`, new `src/server/lib/AnalyticsPipeline.ts`, `src/server/routes/{telemetry,admin}.ts`.

### P-MON.2 — Anomaly Detection + Trend Analysis + Forecasting  ✅ DONE  [MED]
- Alerting was **static thresholds only** (`metricsAlerts.ts`). Now there is a real statistical engine for **anomaly
  detection** (z-score + EWMA-deviation), **trend analysis** (least-squares slope/direction), and **forecasting**.
- [x] Added `src/server/lib/AnomalyDetector.ts` — a pure, dependency-free engine: `zScores`/`detectZAnomalies`,
  `ewma`/`detectEwmaAnomalies` (catches level shifts a global z-score masks), `linearTrend` (least-squares),
  `forecast` (project the trend N steps at the median sample spacing), and `analyzeSeries` → a full `AnomalyReport`
  (z + EWMA anomalies, trend with rising/falling/flat direction, N-step forecast, summary stats). Short/flat series
  honestly return no anomalies / a null trend — no fabricated signal.
- [x] Wired into the admin observability surface: `POST /api/observability/anomaly` analyzes a supplied series
  (`{ series:number[] }` or `{ points:{t,v}[] }`); `GET /api/observability/anomaly/latency` analyzes the LIVE
  per-trace latency series from the P2.1 tracer. Both admin-gated (same scheme as the other observability routes).
- [x] 13 unit tests (`AnomalyDetector.test.ts`); full gate green (tsc fe+server, 3010 vitest, boot:check, live route smoke).
- [x] Surfaced in the Admin dashboard AI Engines tab — a "Latency Anomaly Watch" card (sample count, z-score+EWMA
  anomaly count, trend direction, recent spikes) via `GET /api/admin/anomaly/latency` (x-admin-token).
- **Files:** new `src/server/lib/AnomalyDetector.ts` + `.test.ts`, `src/server/routes/observability.ts`,
  `src/server/routes/admin.ts`, `src/components/AdminDashboard.tsx`.

### P-MON.3 — LLM / AI Observability Dashboard  🟡 latency-percentiles DONE / drift+tool-usage PENDING  [MED]
- Token/cost are tracked; now per-provider **inference-latency percentiles** are too.
- [x] Added `src/server/lib/Percentiles.ts` — pure `quantile`/`percentiles` (p50/p90/p95/p99 + min/max/mean) and
  `aggregateProviderLatency`, which turns the REAL `ai.provider.*` spans the AI router records (Tracer) into
  per-provider latency percentiles + error rate. Honest: no samples → zero counts + null percentiles, never invented.
  11 unit tests.
- [x] Added `GET /api/observability/llm` (admin-gated) — live per-provider p50/p90/p95/p99 latency + error rate from
  recent trace spans (ordered by sample volume).
- [x] Added the **admin "AI Observability" view**: `GET /api/admin/llm-latency` (x-admin-token) + an "Inference Latency
  (p50/p95/p99)" table in the Admin dashboard's AI Engines tab — surfacing the tail latency the existing average hides.
- [ ] **Still pending:** per-tool success/failure analytics (lives in AgentV3 `ToolDispatcher`), model-drift over
  time, persisted daily LLM-ops snapshot, and the multi-agent coordination view.
- **Files:** new `src/server/lib/Percentiles.ts` + `.test.ts`, `src/server/routes/observability.ts`,
  `src/server/routes/admin.ts`, `src/components/AdminDashboard.tsx`.

### P-MON.4 — Wire Health Monitor to REAL Metrics + Composite Scores  ✅ DONE  [MED — honesty]
- `AppHealthMonitor.tsx` previously rendered **fully simulated/demo data** (Math.random metrics, hardcoded
  "operational" services, fake Core Web Vitals, `SIMULATED_INCIDENTS`, fake streaming logs) — a direct violation of
  the "honest state, no fake success" core law. Now: composite scoring engine + honest, real-data-only panel.
- [x] Added `src/server/lib/HealthScore.ts` — a pure composite **Health / Reliability / Risk** (0–100) engine with an
  honest grade (excellent→critical, or `unknown`). Per-component scorers (errors, latency, success, uptime); any signal
  with no real data **drops out** of the weighted average and is reported in `missing` — none is fabricated, and with
  no signal at all the score is `null` (honest "no data"), never a fake number. 10 unit tests.
- [x] Added `GET /api/admin/health-score` (admin-gated) computing the composite from REAL live signals: build
  success rate (`metrics`), aggregate provider error rate + request-weighted latency (`AIRouter` circuit stats),
  and `process.uptime()`. Returns the score, the raw inputs, and a `sources` map for transparency.
- [x] Surfaced it in the Admin dashboard Overview tab — a "Platform Health Score" card (Health / Reliability / Risk
  + grade), with an honest "no data yet for: …" note for any signal not yet measured (excluded, not faked).
- [x] Rewrote `AppHealthMonitor.tsx` to be honest: it shows ONLY real, measured signals from the public
  `/api/health` + `/api/ready` (platform status, real uptime, readiness) and an explicit "live per-app telemetry is
  not connected yet" state instead of fabricated metrics/incidents/logs. All `Math.random`/simulated data removed.
- [x] Gate green: tsc (fe+server), 3007 vitest, `npm run build`, boot:check, live admin-endpoint smoke (200 honest
  score / 401 no-token).
- **Files:** new `src/server/lib/HealthScore.ts` + `.test.ts`, `src/server/routes/admin.ts`, `src/components/ide/AppHealthMonitor.tsx`.

### P-MON.5 — AI Insights / NL Query / AI Report Generator  ❌ MISSING  [LOW — AIOps]
- No way to ask telemetry questions in natural language, get AI-generated insights ("cheap tier success up to 94%"),
  or auto-generate a periodic ops report.
- [ ] Add an admin NL→query over the metric snapshots; an AI insights card; a weekly AI-generated ops summary.
- **Files:** new `src/server/lib/AiInsights.ts`, `src/server/routes/admin.ts`.

### P-MON.6 — Self-Service Dashboards + FinOps Recommendations  🟡 FinOps DONE / dashboard-builder PENDING  [LOW]
- Cost was tracked but there were no **FinOps recommendations**. Now there is a real, data-driven advisor.
- [x] Added `src/server/lib/FinOpsAdvisor.ts` — a pure rules engine over the REAL `MetricsSnapshot`: spend wasted on
  failed builds (observed USD), low preview rate, repair-loop cost, provider spend concentration, and per-request
  cost outliers (cheapest vs most-expensive provider, data-driven — **no hardcoded prices, no projections**). With no
  data it returns no recommendations rather than fabricating advice. 9 unit tests.
- [x] Added `GET /api/admin/finops` (admin-gated) and a **FinOps Recommendations card** in the Admin dashboard's
  Revenue tab (severity-coded, shows observed-waste USD, honest "no issues / no data" states).
- [ ] **Still pending:** the lightweight custom-dashboard/widget builder (depends on P-DESIGN.4 charts) — separate sub-item.
- **Files:** `src/components/AdminDashboard.tsx`, new `src/server/lib/FinOpsAdvisor.ts` + `.test.ts`, `src/server/routes/admin.ts`.

---

## ⚙️ PHASE P-ORCH — AUTOMATION & ORCHESTRATION GAPS
> From a 300-component **Automation & Orchestration** audit (2026-06-28, 2 deep-scan agents, cited files verified).
> This category **already exists as NavBharatAI's execution brain (AgentV3 + AppMakerLab)** — the audit confirmed
> the orchestration core is extensively DONE. Almost everything else is ⬜ N/A-by-design or tracked elsewhere.
> Only 3 genuinely-new, product-fitting gaps remain.

### ✅ The Execution Brain Already Exists (do not rebuild — extensive DONE)
- **Orchestration core:** `AgentV3/AgentRunner` (native tool-use loop, step/budget/time caps), `AppMakerLab/AppMakerOrchestrator` (6-stage pipeline: plan→generate→patch→build→repair→preview), `generator/{ExecutionOrchestrator,TaskScheduler}` (DAG scheduling, dependency resolution, retry+checkpoint resume), `jobs/BuildJobManager` (async job lifecycle).
- **Multi-agent:** `AgentRegistry` (12 roles), `SubAgent` delegation, `AgentEventStream`, `AgentLifecycle`, `ToolDispatcher`/`ToolCatalog` (registry + dispatch + adapters), `Consensus`, `ReviewerAgent`, `Approvals` (HITL), `EscalationOrchestrator` (cheap→expensive).
- **Reliability:** `AIRouter` (raced model routing, circuit-breaker cooldowns, bulkhead MAX_IN_FLIGHT, graceful degradation), `mutation/{TransactionCoordinator,LockManager,JournalManager,CheckpointManager}` (ACID-ish workspace txns, WAL, checkpoints), `AutoRepairEngine` (self-heal loop), token/context budgets.
- **State/events:** `lib/{eventBus,eventStore}` + `eventbus/EventHistoryStore` (event sourcing + replay), `ConversationStore` (durable resumable transcripts), payment/billing automation, `CommandGovernance` + `audit`.

### ⬜ N/A-by-design / already tracked elsewhere (NOT added here)
- **⬜ N/A-by-design:** message brokers (Kafka/RabbitMQ/NATS), distributed-lock/lease/leader-election/consensus-coordinator/cluster-coordinator (single-instance managed-serverless), worker-pool/distributed-worker, multi-cloud/cross-cloud/hybrid/edge orchestration, ERP/CRM/enterprise-integration-hub, BPM/DPA/process-mining, mobile/desktop automation platforms.
- **Already tracked:** multi-agent/tool registry+dispatch/planner/executor/reviewer/function-calling → **P-AI** (DONE) + **P-AI.16**; reasoning/state-machine/rule/constraint engine → **P-AI.14**; ensemble/critic → **P-AI.15**; priority job scheduling / latency-prediction → **P-AI.17**; HITL/approval → **P-AI.8**; circuit-breaker → **P1.3**; idempotency/dedup → **P1.4**; bulkhead/concurrency/quota → **P2.3**; task/job queue/DLQ → **P7/P-BRE.6**; event-sourcing/replay → **P4.2**; notifications/Slack/email → **P-BRE.7/P-PME.9**; metrics/tracing/workflow-analytics → **P2/P8**; anomaly/failure/cost prediction + bottleneck/critical-path → **P-MON.2**; workflow dashboards → **P-MON.6/P-DESIGN.4**; rollback → **P9**; auto-scaling → **P3.3**.

### P-ORCH.1 — Cron / Scheduled / Recurring Jobs Engine  ❌ MISSING  [MED]
- There is no time-based scheduler: only `setInterval` timers and request-triggered jobs. No cron, recurring, delayed,
  or calendar-scheduled jobs. This blocks several other phases that need scheduled work — **P-DATA.4** retention-purge,
  **P9** scheduled Firestore backup, and recurring user automations.
- [ ] Add a Cloud Scheduler (or Cloud Tasks `scheduleTime`) integration + a small job-registry for recurring/delayed jobs.
- [ ] Expose it internally so retention-purge, backups, and digest reports can register schedules.
- **Files:** new `src/server/lib/ScheduledJobs.ts`, `cloudbuild.yaml` (scheduler), `src/server/AppMakerLab/jobs/BuildJobManager.ts`.

### P-ORCH.2 — User-Defined Automation / Workflow Builder  ❌ MISSING  [MED — product surface]
- The orchestration engine is hardcoded to the code-gen pipeline; **end users cannot define their own
  triggers→actions** (e.g. "on schedule, rebuild + redeploy", "on form submit, call API"). No workflow DSL, visual
  builder, templates, or NL→workflow. (This is a new product surface, distinct from the internal AgentV3 brain.)
- [ ] Add a declarative trigger→action workflow model (JSON DSL) executed by the existing orchestrator + P-ORCH.1 scheduler.
- [ ] Add a simple builder UI + starter templates; optionally an AI "describe your automation" → workflow generator.
- **Files:** new `src/server/AppMakerLab/workflow/{WorkflowEngine,WorkflowTypes}.ts`, new `src/components/ide/WorkflowBuilder.tsx`.

### P-ORCH.3 — Saga / Compensation for Multi-Step Orchestration  🟡 PARTIAL → full  [LOW]
- `TransactionCoordinator` gives ACID-ish *workspace-file* transactions, but there is no **saga / compensation** across
  a multi-step pipeline (e.g. build → deploy → verify): if a late step fails, earlier external effects aren't auto-undone.
- [ ] Define compensation handlers per orchestrator stage; on failure, run compensations in reverse (deploy→rollback, etc.).
- **Files:** `src/server/AppMakerLab/generator/ExecutionOrchestrator.ts`, `src/server/AppMakerLab/deployment/DeploymentRollbackManager.ts`, new `Saga.ts`.

---

# 🗺️ REMAINING AUDIT BACKLOG — un-audited domains (self-identified, 2026-06-28)
> The admin's category lists are exhausted. This backlog is **self-generated** by analyzing `UPGRADE_v3.0.md` +
> the v3 codebase: the major product/platform pillars that have **real surfaces in the code but NO dedicated audit
> phase yet**. Each is a candidate for the same loop used for every phase above (300-component deep-scan → dedup →
> distilled phase). Listed by priority. "Already partial" = where existing phases already touch it (so a future
> audit only adds the genuinely-new gaps, as before).
>
> **Coverage so far (24 phase-families, DONE-as-audit):** P0–P10 (architecture + infra), P-SEC, P-TQA, P-BRE,
> P-DEV, P-PME, P-CGE, P-AI, P-UX, P-PE, P-DATA, P-DESIGN, P-DEPLOY, P-COLLAB, P-MON, P-ORCH.

### 🔴 P-PAY — Billing, Payments & Monetization  [HIGH — revenue engine, NOT yet a phase]
> Code: `routes/{payment,createOrder,wallet,products}.ts`, `lib/{payments,UserCostStore,OnboardingCreditStore,UsdInrRate}.ts`, `MonetizationWizard.tsx`, `CostEstimator.tsx`, `BillingPanel.tsx`, `CheckoutButton.tsx`. Cashfree + wallet + Vishwakarma pass exist; v3.0 markup billing exists. Never audited as a domain.
- Sub-areas to audit: payment-provider abstraction (Cashfree-only → add Razorpay/Stripe), subscription/recurring billing, plan/tier manager, usage-based metering accuracy, invoice/receipt generation, refunds/chargebacks/disputes, dunning/failed-payment retry, tax/GST handling, multi-currency, coupons/promo/referral credits, wallet ledger integrity + reconciliation, revenue analytics, fraud/abuse on payments, free-trial/credit-grant logic, proration, billing webhooks idempotency, PCI-scope minimization, **monetization for end-users' generated apps** (let users charge for their apps).

### 🔴 P-IDENT — Identity, Auth, Accounts & Onboarding  [HIGH — partial via P-SEC.1/P-SEC.3/P-COLLAB.6/P-UX.8]
> Code: `routes/{auth,firebaseAuth,githubAuth,profile}.ts`, `lib/{authMiddleware,UserProfileStore}.ts`, `AuthComponent.tsx`, OTP. RBAC→P-SEC.1, MFA→P-SEC.3, SSO→P-COLLAB.6, forgot-password→P-UX.8 already cover slices.
- Sub-areas: account lifecycle (create/verify/suspend/delete + GDPR), session management + device/session list + revoke, email verification, phone-OTP hardening, social-login expansion, account linking/merge, profile completeness, consent/ToS acceptance ledger, impersonation (admin support) with audit, account recovery flows, anomalous-login detection, bot/signup-abuse defense, onboarding funnel + activation, per-account data export/portability.

### 🟠 P-SANDBOX — Sandbox, Code Execution & Runtime Isolation  [HIGH — core to a code-gen product]
> Code: `EngineerAI/actuators/{E2BActuator,DockerActuator,LocalActuator,VfsActuator}.ts`, `PreviewRunner/*`, `runtime/ServerContainerRuntime.ts`, `infra/e2b/`. P-SEC.11 (seccomp) touches it.
- Sub-areas: sandbox lifecycle (warm pool, reuse, TTL, cleanup), per-sandbox resource limits (CPU/mem/disk/time), network egress policy from sandboxes, sandbox cost tracking + budget caps, concurrency/queueing of sandboxes, multi-runtime support (more languages), snapshot/restore of sandbox state, file-size/output caps, secure secret injection into sandboxes, sandbox escape hardening, dev-server port management at scale, preview reliability (cold-start, 502s), E2B↔Docker↔Local parity tests.

### 🟠 P-INTEG — Integrations, Connectors, Plugins & API Marketplace  [MED-HIGH]
> Code (UI mostly): `APIMarketplace.tsx`, `ExtensionMarket.tsx`, `PluginSystem.tsx`, `APITester.tsx`, `BackendProvisioner.ts` (Supabase/Firebase/Neon scaffolds). Largely UI without backend wiring.
- Sub-areas: third-party OAuth connector framework, secrets/credential vault per integration, connector registry + lifecycle, plugin/extension execution sandbox + permissions, webhook ingress framework, outbound API call governance/rate-limit, prebuilt connectors (Stripe/Slack/Sheets/Notion/email/SMS), BYO-backend (Supabase/Firebase/Neon) wiring depth, marketplace publish/install/version/review, plugin SDK + manifest, integration health monitoring, data-mapping/transform between systems.

### 🟠 P-MOBILE — Mobile, Cross-Platform & App Distribution  [MED]
> Code: `APKBuilder.tsx`, `AppStorePublisher.tsx`, `remote-keyboard/` (Android), `VirtualKeyboard.tsx`, PWA. P-DEPLOY.4 (store automation) + P-DESIGN (responsive) touch it.
- Sub-areas: real APK/AAB build pipeline (Capacitor/TWA) + signing, iOS build path, Play/App-Store submission automation (P-DEPLOY.4), push notifications (FCM/APNs) for generated apps, deep-linking, native device APIs (camera/geo/biometrics) in generated apps, offline-first generated apps, app-update/OTA, mobile preview fidelity, responsive→native parity, remote-keyboard companion hardening, store-listing/ASO assets generation.

### 🟡 P-GROWTH — Growth, SEO, Marketing & Retention  [MED]
> Code: `SEOOptimizer.tsx`, `OnboardingCreditStore.ts`, `DonationPanel.tsx`; P-UX (tour/NPS/consent) touches it.
- Sub-areas: referral/invite-reward program, credit-grant/promo engine, SEO for generated apps (meta/sitemap/OG/schema), SEO for the platform itself, email lifecycle/drip campaigns, in-app announcements/changelog, retention nudges + re-engagement, A/B experimentation framework (ties P-PE.5/P-MON), virality (share-your-app), landing/template gallery SEO, waitlist/launch tooling, attribution/UTM analytics (ties P-MON.1).

### 🟡 P-VERTICAL — Vertical AI Products (Professionals, Doctor AI, etc.)  [MED — product breadth/quality]
> Code: `professionals/` (70+ configs + engine + knowledge), `routes/sda.ts` (Doctor AI), `game/`, `repoAnalyst/`. The isolated `professional` router (P0.1) exists, but per-vertical *quality/coverage* never audited.
- Sub-areas: knowledge-base depth + freshness per vertical, per-vertical eval/quality scoring, citation/grounding per vertical, safety/disclaimer correctness (esp. medical/legal/financial), clinical-tool/calculator correctness (SDA), vertical-specific UX, new-vertical onboarding framework, vertical analytics/usage, multilingual vertical content, regulatory compliance per vertical (medical=DPDP/clinical, finance=advisory disclaimers), vertical templates, evaluations against domain benchmarks.

### 🟡 P-DEVPLAT — Public Developer Platform (API / SDK / CLI / Webhooks)  [MED — net-new]
> No public API/SDK/CLI today; everything is internal. Net-new pillar for an "app maker" that wants an ecosystem.
- Sub-areas: public REST/GraphQL API + versioning (ties P-DATA.5 OpenAPI), API keys/scopes/quotas for external devs, SDKs (JS/Python), CLI for build/deploy, public webhooks (outbound events), rate-limit + billing for API usage, developer docs portal, sandbox/test keys, usage dashboard for API consumers, terms/abuse for API, embeddable widgets/SDK for generated apps.

### 🟢 P-SUPPORT — Support, Feedback & Customer Success  [LOW-MED]
> Code: `ReportProblemComponent.tsx`, `ReportsListView.tsx`, admin tooling. Feedback collection also in P-COLLAB.3/P-UX.6.
- Sub-areas: in-app support ticketing, bug-report capture w/ diagnostics + repro bundle, feedback triage + routing, status page / incident comms, help center / docs search, in-app contextual help, AI support assistant (over AppKnowledgeBase), SLA on support, CSAT/NPS pipeline (ties P-UX.6), admin support console + impersonation (ties P-IDENT), churn-risk + proactive outreach.

### 🟢 P-CONTENT — Content, Knowledge, Docs & Education  [LOW-MED]
> Code: `AppContext/AppKnowledgeBase.ts`, professionals knowledge, README/docs generators. Self-awareness KB exists.
- Sub-areas: AppKnowledgeBase coverage gate (the CLAUDE.md sync rule — automate it), user-facing docs/tutorials, interactive learning/sample projects, in-product onboarding content, template-with-explanation, AI "explain this app", changelog/release-notes surface (ties P-PME.2), localized help content, knowledge freshness/version, community templates/showcase.

### 🟢 P-TRUST — Trust, Safety, Abuse & Content Moderation  [MED — partial via P-SEC/P-AI]
> Partial: P-AI (moderation/jailbreak — P-AI.10), P-SEC (abuse/bot), payment-fraud (P-PAY). No unified trust-&-safety domain.
- Sub-areas: generated-content moderation (apps that violate policy), prompt/abuse pattern detection at scale, account/payment fraud scoring, takedown/report workflow for published apps, rate-abuse + quota-abuse defense, malicious-app/phishing detection in generated output, age/region policy gating, copyright/IP checks on generated assets, trust score per account, safety incident audit + appeals.

### ⚪ P-PERF — Performance & Cost Efficiency (platform-wide)  [LOW — partial via P3/P10/P-BRE]
> Partial: P3 (frontend health), P10 (edge/load), P-BRE (build speed), P-MON (FinOps). No unified perf/cost-efficiency pass.
- Sub-areas: end-to-end latency budget (request→AI→preview), bundle-size budget enforcement (ties P-TQA), AI cost-per-build reduction, caching strategy across layers, cold-start reduction (Cloud Run min-instances=0 trade-off), DB read-cost optimization (Firestore), image/asset optimization (ties P-DESIGN.4), streaming/perceived-perf tuning, perf regression gate in CI, per-feature cost attribution.

### 📋 Backlog summary
- **12 un-audited domains** identified: P-PAY, P-IDENT, P-SANDBOX, P-INTEG, P-MOBILE, P-GROWTH, P-VERTICAL, P-DEVPLAT, P-SUPPORT, P-CONTENT, P-TRUST, P-PERF.
- Highest-value net-new: **P-PAY** (revenue), **P-IDENT** (accounts/security), **P-SANDBOX** (core execution), **P-INTEG** (ecosystem).
- Each can be processed with the same loop: deep-scan 300 components → dedup vs existing phases → distilled phase → PR → CI → merge.

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
16. **CGE production-grade** — AST incremental patches, test generation, documentation gen,
    convention engine, OpenAPI contract, lint-fix pass (P-CGE.1–5, P-CGE.7).
17. **PME baseline** — cross-session memory, release notes, debt tracker, AI estimator,
    lessons learned, scope change control (P-PME.1–5, P-PME.6).
18. **Dev Environment baseline** — LSP code navigation, Firestore workspace persistence,
    real debugger (breakpoints + call stack), merge conflict resolver, real package manager (P-DEV.1–5).
19. **Build & Runtime hardened** — distributed tracing, incremental builds, structured logging,
    post-build smoke tests, remote build cache (P-BRE.1–5).
20. **Testing & QA baseline** — code coverage CI gate (≥60%), visual regression tests, bundle size
    budget, vulnerability scan blocks (not warns), quality gate on merge (P-TQA.1–2, P-TQA.5–7).
21. **Security hardened** — RBAC roles enforced on all routes, DAST in CI, TOTP MFA for admin+pro,
    container image scanning before push, encryption key rotation mechanism (P-SEC.1–5).

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
- 2026-06-28 (Data & Backend audit): Ran a 300-component **Data & Backend** audit (6 deep-scan agents,
  cited files verified — 19/20 real). NavBharatAI's backend is a managed-serverless Express monolith
  (Cloud Run + Firestore + E2B); the **vast majority of the 300 are already DONE or ⬜ N/A-by-design**
  (Kafka/Redis/RabbitMQ/connection-pools/replicas/SQL-cluster/gRPC/Saga, etc.). After deduping against
  existing phases (P7 queue/cache, P8 tracing, P9 backup/DR, P10 CDN/KMS, P1.1 versioning, P4.1 CQRS,
  P-SEC.1 RBAC, P-BRE.5/6/7, P-CGE.6, P-PME.9), only **7 genuinely-new actionable gaps** remained →
  added as **PHASE P-DATA** (schema validation; durable artifact/checkpoint store; durable embedding store;
  data retention + GDPR/DPDP deletion; OpenAPI spec; hardened file upload; data export). Doc-only.
- 2026-06-28 (UI/UX & Design audit): Ran a 300-component **UI/UX & Design** audit (6 deep-scan agents,
  cited files verified — all real). The frontend (React + TS + Tailwind v4 + motion + Monaco + xterm) is
  **rich** — most items already DONE (theme system w/ 5 modes, DesignSystem tokens, ComponentLibrary,
  VisualEditor, FigmaImporter, ScreenshotToCode, MultiPageBuilder, PreviewPanel device modes, motion,
  CommandPalette, undo/redo+versioning, LocalizationManager 18-lang, apnapanEngine personalization).
  After deduping against P-UX (skeletons/storybook/session-replay), P-TQA (visual-regression), and
  N/A-by-design (Material/Fluent kits, WebGL, flow/diagram editors, platform-i18n), **8 genuinely-new
  gaps** remained → added as **PHASE P-DESIGN** (UI primitive library wired to tokens; overlay/interaction
  primitives; platform a11y engine; chart/viz library; AI design generation + critique; prototyping engine;
  realtime collab hardening; design governance/visual-lint). Doc-only.
- 2026-06-28 (DevOps & Deployment audit): Ran a 300-component **DevOps & Deployment** audit (3 deep-scan
  agents, cited files verified — incl. a full `AppMakerLab/deployment/` engine). NavBharatAI is managed-serverless
  (Cloud Build → Cloud Run) with a real deployment engine + multi-cloud providers; the **vast majority** of the
  300 are already DONE, ⬜ N/A-by-design (entire K8s/Helm/Argo/Terraform/Lambda stack), or already tracked
  (canary/DR→P9, tracing→P8, IaC→P6, CDN/chaos→P10, container-scan/SBOM→P-SEC, build-cache/jobs→P-BRE,
  release-notes/changelog/semver→P-PME). Only **6 genuinely-new gaps** remained → added as **PHASE P-DEPLOY**
  (DORA metrics; staging + promotion pipeline; AI deploy-ops/risk advisor; app-store distribution automation;
  release approval/freeze gate; expanded deploy targets + wire MultiCloudDeploy UI). Doc-only.
- 2026-06-28 (Collaboration audit): Ran a 300-component **Collaboration** audit (2 deep-scan agents, cited
  files verified). NavBharatAI is a single-user-centric AI app builder; the vast majority of the 300 are
  **⬜ N/A-by-design** (it is not a comms platform — no chat/voice/video/whiteboard/meeting/task-mgmt/RACI/org-graph)
  or **already tracked** (RBAC→P-SEC.1, comments→P-DEV.11, cursors/OT/CRDT→P-DESIGN.7, merge→P-DEV.4, voice→P-DEV.13,
  notifications→P-BRE.7, AI-reviewers/semantic-search→P-AI, retention/export/backup→P-DATA). Only **6 genuinely-new,
  product-fitting gaps** remained → added as **PHASE P-COLLAB** (durable team membership + invite acceptance;
  shared-workspace backend ACL; client/stakeholder share portal + feedback; team-scoped shared libraries;
  @mention + notification routing; SSO/identity-federation). Notable real finding: teams/invites are currently
  localStorage-only with an email stub. Doc-only.
- 2026-06-28 (Monitoring & Analytics audit): Ran a 300-component **Monitoring & Analytics** audit (2 deep-scan
  agents, cited files verified). **Most-overlapping category yet** — the observability core (metrics/logs/tracing/
  error-tracking/alerting/SLO/DORA) is already tracked (P2/P8/P-BRE/P-PME/P-DEPLOY) and infra monitoring is
  ⬜ N/A-by-design (K8s/GPU/multi-cloud/OLAP/carbon). Only **6 genuinely-new analytics/intelligence gaps**
  remained → added as **PHASE P-MON** (server-side product-analytics pipeline w/ funnels/cohorts/retention;
  anomaly-detection + forecasting; LLM/AI observability dashboard; wire AppHealthMonitor to REAL metrics +
  composite health scores; AI insights/NL-query/report-gen; self-service dashboards + FinOps recommendations).
  **Honest-state finding:** `AppHealthMonitor.tsx` currently shows simulated/demo data (uptime/latency/CPU) —
  P-MON.4 fixes this to use real metrics or an honest "no data" state. Doc-only.
- 2026-06-28 (Automation & Orchestration audit): Ran a 300-component **Automation & Orchestration** audit
  (2 deep-scan agents, cited files verified). This category **already exists as NavBharatAI's execution brain**
  (AgentV3 + AppMakerLab) — the audit confirmed the orchestration core is extensively DONE (AgentRunner,
  AppMakerOrchestrator 6-stage pipeline, TaskScheduler DAG, multi-agent registry, ToolDispatcher, Consensus,
  Approvals, EscalationOrchestrator, TransactionCoordinator/LockManager/CheckpointManager, AIRouter
  circuit-breaker/bulkhead, event sourcing). Everything else is ⬜ N/A-by-design (Kafka/RabbitMQ/leader-election/
  cluster/multi-cloud/ERP/CRM/BPM) or already tracked (P-AI/P1.3/P1.4/P2.3/P7/P4.2/P-MON/P-BRE/P9). Only **3
  genuinely-new gaps** remained → added as **PHASE P-ORCH** (cron/scheduled/recurring jobs engine — also unblocks
  P-DATA.4 purge & P9 backup; user-defined automation/workflow builder; saga/compensation for multi-step pipelines).
  Doc-only.
- 2026-06-28 (Remaining Audit Backlog, self-generated): The admin's category lists are exhausted. Analyzed
  the full `UPGRADE_v3.0.md` (24 audited phase-families) + the v3 codebase (routes/components/dirs) to identify
  the major product/platform pillars that have **real code surfaces but no dedicated audit phase yet**. Added a
  capstone **REMAINING AUDIT BACKLOG** section with **12 un-audited domains**: P-PAY (billing/monetization),
  P-IDENT (identity/auth/accounts), P-SANDBOX (code execution/isolation), P-INTEG (integrations/plugins/marketplace),
  P-MOBILE (mobile/distribution), P-GROWTH (SEO/retention/referrals), P-VERTICAL (professionals/Doctor-AI quality),
  P-DEVPLAT (public API/SDK/CLI), P-SUPPORT (support/feedback), P-CONTENT (docs/knowledge/education), P-TRUST
  (trust & safety/abuse/moderation), P-PERF (perf & cost efficiency). Each is a candidate for the standard loop
  (300-component deep-scan → dedup → distilled phase). Highest-value net-new: P-PAY, P-IDENT, P-SANDBOX, P-INTEG.
  Doc-only.
- Deploy after each phase (permanent law). Maintain English-only UI (permanent law).
- 2026-06-27 (UX + PE audits): Ran 300-component **UX Engine** audit → found 10 gaps (4 HIGH, 4 MED, 2 LOW).
  Already-strong: theme, PWA, Ctrl+K, onboarding modal, toast, AI Suggestions, LiveCollaboration. MISSING:
  privacy consent/GDPR, one-click AI fix, product tour, breadcrumbs, NPS/CSAT, token gauge, forgot-password,
  session replay, Storybook. Added as **PHASE P-UX**.
- 2026-06-28 (PME audit): Ran 300-component **Project Management Engine** audit → found 13 gaps (5 HIGH, 6 MED, 2 LOW).
  Scope note: ~55% of 300 PME components are enterprise PM (OKRs, SAFe, resource allocation, portfolio) → ⬜ N/A by
  design for an AI app maker. Only app-maker-relevant gaps captured.
  Already-strong (~25%): BuildJobManager (full job lifecycle), ExecutionOrchestrator + TaskScheduler (execution
  tracking), DeploymentEngine + DeploymentAuditManager (deployment state machine), QualityEvaluationEngine +
  AppHealthMonitor (quality/health), CheckpointManager (state recovery), LiveCollaboration + TeamCollaboration
  (real-time collab), AIProjectManager.tsx (AI task gen + Kanban), ImpactAnalyzer, ProjectMemoryManager.
  HIGH gaps: ProjectMemoryManager not Firestore-persisted (lost on restart = cross-session memory lost),
  no release notes generator, no technical debt register, no build time estimator, no lessons-learned retrospective.
  MED gaps: no scope change control, no changelog manager, feature flags hardcoded (no runtime toggle),
  no webhook manager, no ADR auto-capture, no SLA/SLO tracking.
  LOW gaps: no requirement traceability matrix, no semantic version manager. Added as **PHASE P-PME**.
- 2026-06-28 (CGE audit): Ran 300-component **Code Generation Engine** audit → found 13 gaps (5 HIGH, 6 MED, 2 LOW).
  Already-strong (~40%): full orchestration pipeline (AppMakerOrchestrator→BlueprintPlanner→TaskScheduler→
  ExecutionOrchestrator→EngineRegistry/Dispatcher→[LLM/Frontend/Backend/Database/Scaffold engines]→
  PatchAggregator→WorkspaceMutationEngine ACID), intelligence layer (RequirementIntelligenceEngine,
  BlueprintBuilder/Compiler/Validator, FilePlanningEngine, PatternLibrary/Matcher, RepositoryIntelligenceEngine),
  repair system (14 error classifications), 5-evaluator QA, checkpoint ACID, deployment pipeline.
  HIGH gaps: patches are full-file rewrites only (no AST incremental patching), ConflictDetector stub
  (always false), no documentation gen (README/JSDoc/API docs), no convention/naming engine, no test gen
  engines (unit/integration/E2E/mock), no OpenAPI/GraphQL contract-first generator.
  MED gaps: no migration/seed gen, no lint auto-fix, auth code stubs only, no Dockerfile/CI-CD gen for
  generated apps, no bundle optimization gen, no observability instrumentation gen.
  LOW gaps: Next.js/React Native production-level gen, mock data gen. Added as **PHASE P-CGE**.
  Note: Each CGE sub-engine can expand to 100-300 specialized components during implementation.
- 2026-06-28 (AI Intelligence audit): Ran 300-component **AI Intelligence** audit → found 13 gaps (5 HIGH, 5 MED, 3 LOW).
  Already-strong (~45%): full orchestration layer, 13-role AgentV3 roster, real AST (ts-morph), code-gen engines
  (frontend/backend/database), quality evaluation (5 evaluators), ToolDispatcher 30+ tools, CommandGovernance,
  SecretRedactor, ACID checkpoints/transactions, audit managers, AIRouter 2-pass + powerLevel.
  HIGH gaps: hallucination detection not wired everywhere, RAG missing reranker+grounding+citation,
  no dialogue manager/phase tracking, no NLU entity recognition/slot filling, no preference learning.
  MED gaps: PII detection (general), test generation, human-in-the-loop gate, decision trace, abuse detection.
  LOW gaps: log/stack trace parser, model evaluation engine, multimodal/vision (future scope).
  Added as **PHASE P-AI**.
- 2026-06-28 (P-AI 2nd-pass enrichment, by a parallel session): An independent 300-component re-audit
  (7 deep-scan agents, cited files verified) reproduced the same picture — 164 DONE / 69 PARTIAL / 67
  MISSING — and confirmed P-AI.1–13 hold. It surfaced 4 gap-groups not previously listed, added as
  **P-AI.14–17**: explicit reasoning engines (constraint solver = the only near-term-valuable one),
  ensemble/voting/arbitration, tool discovery + invocation planner, and provider latency/reliability
  prediction + smart job scheduling. Deliberately NOT duplicated: build-ETA/deadline → already P-PME.4;
  DB query/migration generation → already P-CGE.6. (Doc-only change; no code touched.)
- 2026-06-28 (TQA audit): Ran 300-component **Testing & QA Engine** audit → found 13 gaps (5 HIGH, 5 MED, 3 LOW).
  Scope note: gRPC, SQL injection (Firestore), k8s/Helm/Terraform, device farm/browser farm, HIPAA/ISO,
  message queue testing, microservices testing — all ⬜ N/A by design.
  Already-strong (~40%): QualityEvaluationEngine (5 evaluators: Build/Lint/Runtime/Security/Architecture),
  QualityScorer.ts (100-pt weighted score), TestPanel.tsx (UI runner: pending/running/pass/fail/skip + duration),
  AITestingSuite.tsx (AI test gen: 49 patterns in 4 categories), APITester.tsx (full REST client),
  AppHealthMonitor.tsx (8 metrics, incident tracking), PerformanceAnalyzer.tsx (HTML analysis + a11y hints),
  SecurityScan.tsx (SAST 6-phase), AICodeReview.tsx, FailureClassifier.ts (14 types), RootCauseAnalyzer.ts,
  DeploymentValidator.ts, SandboxManager.ts (process isolation), GitHub Actions CI (typecheck+test+build+boot).
  HIGH gaps: no code coverage instrumentation (vitest.config.ts missing, no CI threshold), no visual regression
  tests (no Playwright screenshot comparison), no real load testing (AppHealthMonitor shows simulated metrics
  only), no prompt regression test suite (system prompt changes can silently break code gen quality), no bundle
  size budget enforcement in CI.
  MED gaps: QualityScorer score not blocking CI (computed but not enforced), npm audit has continue-on-error=true
  (HIGH CVEs pass silently), no flaky test tracker (pass/fail tracked per run, not across runs), no test fixture
  system (test data hardcoded in AITestingSuite), no DAST/runtime security scan (only SAST regex).
  LOW gaps: no axe-core WCAG automated testing, no mutation testing (Stryker), no MTTD/MTTR tracking.
  Added as **PHASE P-TQA**.
- 2026-06-28 (BRE audit): Ran 300-component **Build & Runtime Engine** audit → found 13 gaps (5 HIGH, 5 MED, 3 LOW).
  Scope note: native compilers (Java/Go/Rust/C/C++), LLVM, Webpack/Parcel/Rspack, K8s/Podman/Hypervisor/GPU,
  Deno/Bun/JVM/.NET/PHP — all ⬜ N/A by design (managed Node.js + Cloud Run + E2B stack).
  Already-strong (~60%): AppMakerOrchestrator, BuildManager, RuntimeKernel (KernelState lifecycle),
  BuildJobManager (QUEUED→PREVIEW_READY + Firestore job store), TaskScheduler (DAG batch),
  ModuleGraph (topological order), GraphGenerator (dep graph), FileAnalyzer (TypeScript AST scanner),
  RepositoryIntelligenceEngine, all 4 code generation engines, Vite 6 (HMR/Fast Refresh/tree-shaking/splitting),
  esbuild (AOT transpiler + server bundle), InProcessEventBus, EventHistoryStore (500-entry audit),
  CheckpointManager + CheckpointStorage (ACID), AutoRepairEngine + FailureClassifier + RootCauseAnalyzer + RepairPlanner,
  full Deployment pipeline (Engine/Planner/Validator/Rollback/State/Audit), SandboxManager (process isolation,
  memory limits), PortManager (3001-4000), PreviewRunner (auto-restart), PreviewHealthChecker, ObservabilityManager,
  Docker + Cloud Run + cloudbuild.yaml CI/CD.
  HIGH gaps: no distributed tracing (ObservabilityManager is basic — no span-per-stage), no incremental build cache
  (every build = full rebuild despite ModuleGraph existing), console.log everywhere (no structured JSON logging with
  jobId correlation), smoke test runner not wired to build completion (PreviewHealthChecker exists but not called),
  no remote GCS build cache (npm install re-runs every Cloud Build).
  MED gaps: build jobs not durable (in-memory Promise chains lost on min-instances=0 scale-to-zero),
  no build/deploy notifications (users must watch page), no build analytics dashboard (data exists in
  BuildJobManager but no UI), no circuit breaker wrapping EngineDispatcher, no SBOM/license validator.
  LOW gaps: no AI build optimizer, no watchdog for zombie sandbox processes, no deterministic build enforcement.
  Added as **PHASE P-BRE**.
- 2026-06-28 (Security Engine audit): Ran 300-component **Security Engine** audit (IAM/auth/encryption/secrets/
  network/threat detection [1-100], supply chain/SAST-DAST/container/data-security/injection/API/audit/compliance
  [101-200], AI-LLM security/runtime isolation/governance/analytics/SecOps [201-300]).
  Already-strong (~55%): Firebase Auth (Google+GitHub OAuth+Phone OTP), authMiddleware ID token verification,
  express-rate-limit (chat/payment/admin/build quotas), Helmet.js (CSP/COOP/HSTS), AES-256-CBC secret encryption,
  SecretRedactor.ts (tool output masking), SecurityAnalysis.ts (60+ SAST rules), ComplianceAnalysis.ts
  (GDPR/DPDP), CommandGovernance.ts (27 HIGH + 7 MEDIUM shell rules), UntrustedContent.ts (prompt injection fence),
  immutable Firestore audit trail, row-level Firestore security rules, malware path blocker, CSPRNG, admin brute
  force detection, FileSanitizer path traversal prevention, human approval gate (Approvals.ts).
  HIGH gaps: no RBAC (binary user/admin only, no role granularity), no DAST in CI (only SAST), no TOTP/WebAuthn MFA,
  no container image vulnerability scanning (Trivy), no encryption key rotation mechanism.
  MED gaps: no SBOM + license scanner, no SIEM log export, adaptive rate limiting missing (static IP counts only),
  no WAF/Cloud Armor, dependency pinning without supply chain attestation.
  LOW gaps: no seccomp/AppArmor for E2B sandbox, no formal incident response runbook, no device fingerprinting.
  Added as **PHASE P-SEC**.
- 2026-06-28 (DEV audit): Ran 300-component **Development Environment** audit → found 13 gaps (5 HIGH, 5 MED, 3 LOW).
  Scope note: remote DevContainers, k8s-native dev, Codespaces, WSL, bare-metal GPU are ⬜ N/A by design (managed-serverless + E2B sandbox).
  Already-strong (~60%): Monaco Editor (multi-tab, minimap, folding, multi-cursor, bracket colorization), DiffViewer (LCS), VisualEditor (WYSIWYG),
  FileExplorer (tree, ops, search filter), TerminalPanel (xterm.js, multi-terminal, 3 tabs), CommandPalette (Ctrl+K), StatusBar, ActivityBar (6 sections),
  PreviewPanel (iframe, device modes, hot reload), LiveCollaboration (Firebase real-time), TeamCollaboration (role-based), GitPanel (2500+ lines, 16 platforms),
  CICDPipeline, TestPanel, SecurityScan (SAST), AICodeReview, AIDebugger (5 error types), AISuggestions (Copilot-style), AIChat, AppHealthMonitor, AppAnalytics,
  PerformanceAnalyzer, ExtensionMarket, ComponentLibrary, APITester, SecretManager.
  HIGH gaps: no LSP/code navigation (Go to Definition / Find References / cross-file Rename — ts-morph already present, just not wired),
  cross-session workspace not Firestore-persisted (localStorage only), no real debugger (AIDebugger.tsx is AI error analysis, not a runtime debugger),
  no merge conflict resolver (3-way merge), package manager mocked (npm install fakes output).
  MED gaps: no cross-file refactoring tools, no offline service worker, no Git Blame/Stash/Tag manager, Monaco theme hardcoded (no switcher),
  no dedicated code explanation panel.
  LOW gaps: no inline code comments/review mode, no flame graph/profiler, no voice collaboration.
  Added as **PHASE P-DEV**.
- 2026-06-27 (PE audit): Ran 300-component **Prompt Engine** audit → found 8 gaps (3 HIGH, 3 MED, 2 LOW).
  Already-strong: IntentClassifier, RequirementIntelligenceEngine, FilePlanningEngine, Context Building,
  KnowledgeEvolution, ConversationStore, EmbeddingSearch, AIRouter 2-pass, ToolDispatcher 30+ tools,
  CommandGovernance, SecretRedactor, UntrustedContent. MISSING: prompt/response cache (every call = fresh
  API hit), prompt versioning/registry, jailbreak detection, token pre-call estimator, prompt A/B eval,
  prompt audit trail (partial), prompt debugger/trace, date/time context. Added as **PHASE P-PE**.

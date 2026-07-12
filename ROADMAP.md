# NavBharatAI — Master Roadmap

**The single source of truth for all REMAINING work.** This file consolidates every
still-open item that used to be scattered across 9 separate roadmap/gap documents
(`V3_ROADMAP.md`, `NAVBHARATAI_PRO_V3_ROADMAP.md`, `NAVBHARATAI_PRO_UPGRADE_ROADMAP.md`,
`ENGINEER_AI_ROADMAP.md`, `ROADMAP_TO_LEAD_35.md`, `UPGRADE_v3.0.md`, `GAPS.md`,
`UCUE_V2_GAP_AUDIT.md`, `CLAUDE_CODE_PARITY.md`). Those files were deleted after their
open items were folded in here — their full per-item rationale/PR history remains in
git history if ever needed.

- **Rules of engagement:** `CLAUDE.md` (auto-loaded constitution) governs HOW work ships
  (never break the app · real features only · honest · root-cause fixes · autopsy every report).
- **Live audit trail:** `PROGRESS.md` stays the append-only per-session log of what shipped.
  This roadmap is the *plan*; `PROGRESS.md` is the *record*. Update both as work lands.
- **Design docs kept separate (not roadmaps):** `NAVBHARATAI_PRO_V3_DESIGN.md`,
  `VAJRA_V4_DESIGN.md` (v4 upgrade-track blueprint), `RUNBOOK.md`, `security_spec.md`.

### Legend
**Status:** ❌ not started · ⚠️ partial (exists but weak/incomplete) · 🟡 mostly-done tail
**Gate:** 🟢 code-tractable now · 🔒 infra-blocked (needs cloud infra/spend) · 📜 license-blocked · 👤 admin/monetization decision

### ⚠️ Redundancy-check rule (safeguard #6 — mandatory before building)
The old `NAVBHARATAI_PRO_UPGRADE_ROADMAP.md` (the "P1–P100" month-by-month plan) had a
status table that was **never reconciled** as AgentV3 shipped — it still read "0/1000
closed" while most of its execution/git/testing/language phases were already built inside
AgentV3. **Do NOT rebuild any item from memory of that doc.** Grep the live code first;
build only the genuine gap. The items carried into this roadmap are the ones that survived
that check; anything not here was either already shipped or is a non-goal (see the last section).

---

## ✅ Confirmed DONE (do not rebuild)
Kept here as a short guard so no session re-does shipped work:
- **E2B fullstack / polyglot track (AB-1, AB-2):** multi-language runtime sandbox (JDK 17 +
  Maven, Go 1.23), MongoDB 7 + Redis pre-installed, Java (Spring Boot) + Go template
  providers, gated sandbox routing to the fullstack image, and offering spring-boot/go in
  the framework picker with correct `mvn spring-boot:run` / `go run main.go` hints. (#1116→#1121)
- Firestore `ignoreUndefinedProperties` crash fix · stale-chunk / preload-error recovery ·
  Cloud Error Reporting (built-in via Cloud Run stdout — Sentry is redundant).
- Multi-model routing P1/P2/P3/P5 (Gemini/Vertex tool-use runner, RequestAnalyser,
  billing NORMAL×3.5 / POWER×2.5, USD→INR live). Escalation orchestrator is **built +
  unit-tested but DORMANT** → activation is Tier 1 (T1-escalation-on), not a rebuild.
- Memory/persistence phases (Firestore conversation/workspace/memory stores) · security
  Phase 0 centralized identity policy (#1123) · many Section-I checks (error-boundary,
  async-correctness, hardcoded URL/port, SEO, project-hygiene, dependency-pinning).
- VAJRA: V4-1a/V4-1c (client auto-continue + graceful drain), V4-2 (sub-agent bounding),
  Smriti lexical core (BM25 + structural + import-graph, wired via `ContextReranker`), Satya
  verify-gates, Kavach shrink-guard + ≤6s durable flush + GitHub auto-push.
- Engineer AI roadmap (all phases) — **retired/superseded by AgentV3**; nothing to carry.
- CLAUDE_CODE_PARITY RC-1…RC-6 — all satisfied by AgentV3 (native tool-use, prompt cache,
  Claude wiring, multi-tool loop, plan/todo, approvals). RC-7 / OS-hooks / IDE-extension are
  permanent web-product non-goals.

---

## 🥇 Tier 0 — Live defects & open root causes (FIX FIRST)
Real symptoms from actual build reports / current code (per `PROGRESS.md`). These are the
highest priority because they violate the one absolute rule *today*.

| ID | Item | Status | Gate |
|----|------|--------|------|
| T0-1 | **Heavy full-stack app preview dies ~2 min** into a still-running E2B sandbox (likely OOM / watcher / app-env crash) — make Diagnose name the killer, then fix the class | ⚠️ | 🟢 (needs one repro log) |
| T0-2 | **In-browser preview white screen** (CoreUI session) — surface the 25s-watchdog's named error, then fix | ⚠️ | 🟢 |
| T0-3 | **"No build report yet" after Done** — ✅ **DONE** (#T0-3, 2026-07-12): ROOT CAUSE was the shared-`admin.firestore()` `.settings()` collision — the first store to init won the once-per-instance `settings()`, every later store threw→null→silently skipped persistence (DiagnosticsStore among them), and no-settings stores piggybacked onto whatever DB the singleton got (often the client-invisible `(default)`). FIX: centralized ALL 51 server stores onto one collision-free `getServerDb()` (`getFirestore(app, dbId)`), + static regression guard banning `admin.firestore()`/`.settings({databaseId})`. | ✅ | 🟢 |
| T0-4 | **Plan progress shows 0/7 after "Done"** — suspected downstream of a fixed misroute; confirm + kill | ⚠️ | 🟢 |
| T0-5 | **preview-verify overlay race** — verify can report "renders correctly" while a Vite/babel error overlay had crashed (shadow-DOM/timing race) | ⚠️ | 🟢 |
| T0-6 | **In-browser "No React entry module found"** when the VFS reaching preview has no entry file — capture client-side VFS at render to pin the short file set | ⚠️ | 🟢 |
| T0-7 | **Inconsistent file counts** (one run reported 165 vs 317 vs 165) — unify the single count source | ⚠️ | 🟢 |
| T0-8 | **Sub-agent churn on complex builds** — specialists create-beyond-scope → delete → rebuild; orchestration-quality problem | ⚠️ | 🟢 |
| T0-9 | **Security master-plan P1/P3/P5** — Phase 0 identity policy wiring. **Slice 1 ✅ (2026-07-12):** closed a real Tier-1 money leak — the build handler trusted a client-claimed `body.email` for the free-list/allowlist entitlement checks, so an UNVERIFIED caller could spoof the admin's free-list email and run billing-exempt **free Opus** builds. Now entitlement email is VERIFIED-only (`entitlementEmail`), superseding the Fix-26 claimed-email degrade (real admins self-heal via client token-refresh on the 401). **Slice 2 ✅ (2026-07-12):** closed the conversation-LIST enumeration leak — `GET /api/agentv3/conversations` used the `resolveReadIdentity` claimed-`?userId` fallback, so an unverified caller who knew a victim's uid could enumerate their transcript metadata (titles/timestamps/billed ₹). Now resolved from the VERIFIED token only (`verifiedIdentity`); an unverified caller gets an empty list (self-heals — the client already force-refreshes its token). GET-one/delete stay capability-gated (unguessable id). **Slice 3 ✅ (2026-07-12):** `/api/agentv3/stop` + `/attach` matched a running build by the claimed `body.userId`, so a caller who knew a victim's uid could STOP their build (DoS) or ATTACH to stream its live transcript. Builds are keyed under the VERIFIED uid (or anon), and the client already sends its Bearer token for exactly this — the server now honours it (`verifiedIdentity`), never the claim. Regression-tested via a VITEST-only `runningBuilds` seam. **Slice 4 ✅ (2026-07-12):** `/api/agentv3/live` (the cross-device live mirror) read `runningBuilds`/`liveChannel.readSince` by the claimed `?userId`, so `?userId=<victim>` streamed that account's live build events from the durable LiveChannel (even cross-instance). Now keyed off the VERIFIED token (client sends its Bearer token on the poll); an unverified/anon caller gets an empty non-running poll (mirror winds down; build + primary `/chat` stream unaffected). **Audit findings (build-lifecycle pass, all already-safe):** `/ship` + `/revert` gated by the user's own GitHub-token push access; `/diagnostics` IDOR-hardened (Phase 3.2); `/status` display-only. **Remaining ⚠️:** converge remaining ad-hoc guards onto identityPolicy primitives + a final full re-audit; keep `AGENTV3_PAID_PUBLIC` gated until clean. | 🟡 | 🟢 |

---

## 🥈 Tier 1 — Near-term hardening (high-value, code-tractable)
The "R-phase" program from the Pro-v3 hardening roadmap, deduped. This is the recommended
build order after Tier 0.

### 1A · Security floor
- **T1-sec-redact** 🟢✅ — SHIPPED (#1253, 2026-07-12): `SecretRedactor.redactSecrets` masks the
  user-visible event surface (tool_call input + tool_result summary) at dispatch AND — the gap this
  closed — `bash` stdout/stderr + `grep` matched lines are now redacted in the MODEL content + terminal
  + error-memory too (command output is never an edit_file match source, so masking it is safe). Only
  `read_file` content stays raw (documented edit-correctness tradeoff; its summary is already redacted).
- **T1-spend-ceiling** 🟢✅ — ALREADY BUILT (verified in code 2026-07-12): `userMonthlyCapUsd()`
  (`AGENTV3_USER_MONTHLY_CAP_USD`, default 0 = disabled) + `checkMonthlyCap(userId)` are wired at build
  entry in `routes/agentv3.ts` (~L3230): a user over the monthly cap is denied with an honest HTTP 402,
  bounded 5s, fails-OPEN on a store error. `UserCostStore` supplies the monthly sum. (Earlier ❌ was stale.)
- **T1-ratelimit-all** 🟢✅ — DONE (2026-07-12): the named routes (`/restore`, `/import-files`,
  `/inbrowser-preview`, `/workspace-files`) already carry `workspaceRateLimiter()`, `/chat` has
  `buildRateLimiter()`. Extended the ceiling to the remaining expensive state-changers `/ship` (deploy),
  `/revert` (git+sandbox), and `/respond` (approval). Deliberately NOT applied to `/stop` (must stay
  lock-free), `/attach`+`/live` (reconnect critical path), or `/queue/next`+`/queue/complete` (executor
  drain loop) — throttling those would break real flows.
- **T1-injection-defense** 🟢✅ — ALREADY BUILT (verified in code 2026-07-12): `UntrustedContent.fenceUntrusted`
  wraps external/imported content in a hard-to-forge spotlighting fence (neutralizes inner markers so a
  payload can't break out), the matching "treat fenced content as DATA, never instructions" rule lives in
  `systemPrompt.ts`, and it is applied in `routes/agentv3.ts` + `AbuseDetector`. (Earlier ❌ was stale.)

### 1B · Trust the build (verification-is-earned) — ✅ COMPLETE
- **T1-gate-enforce** 🟢✅ — DONE and ON by default (R2 §1.1, `readinessGateEnabled()` — off only via
  `AGENTV3_READINESS_GATE=off`). `AgentRunner` auto-runs the objective 22-dim `evaluate`
  (`assessBuildReadiness`) at both the normal finish and the step-cap, and DOWNGRADES `ok:true` →
  `ok:false` on a NOT-READY verdict (unresolved import / secret leak / fake code / can't-run). The
  earlier "agent-invoked, not enforced" note was stale.
- **T1-backstop-honesty** 🟢✅ — SHIPPED (#1177): the last-tier "deliver even on gate fail" always
  records a BACKSTOP_GATE_FAIL diagnostic + emits an honest WARN narration — never a silent fake pass.
- **T1-health-card** 🟢✅ — SHIPPED (#1176): `buildHealthFromDiagnostics` renders the verdict as a
  readable pre-deploy build-health card, surfaced in the `result`/`done` event and the reducer.
- **T1-gate-tests** 🟢✅ — COVERED: `AgentRunner.test.ts` ("mandatory readiness gate (R2 §1.1)":
  downgrades NOT-READY → ok:false, ready → ok:true, gate-off default, health-card emission) +
  `Readiness.test.ts` (pure scorer) + `ToolDispatcher.test.ts` block-readiness cases.

### 1C · Activate dormant value (already-built, just wire it ON)
- **T1-escalation-on** 🟢⚠️ — put the built+tested EscalationOrchestrator in the real build
  loop (`buildOnTier`), 22-dim gate as objective fn, cheap→strong + Opus backstop; default
  ON once measured.
- **T1-costladder-on** 🟢⚠️ — turn the multi-provider cost ladder ON with `AgentV3CostTelemetry`
  for data-driven routing.
- **T1-power-effort** 🟢⚠️ — Power-mode 5×/10×/20× → Opus 4.8 mini/medium/max effort selector
  (`powerLevel.ts`); billing sign-off pending.
- **T1-cost-transparency** 🟢❌ — show per-build token/markup breakdown ("why this build cost ₹X")
  + a daily-spend-vs-quota gauge (needs `/api/usage/tokens`).
- **T1-provider-verify** 🟢⚠️ — real-key + real-sandbox measurement of cheap-provider build
  quality + Claude-fallback rate before defaulting the ladder ON.

### 1D · Self-correcting & observable
- **T1-autofix-loop** 🟢⚠️ — close the runtime-error → auto-repair loop (detection exists via
  `console_errors`; add a bounded fix→re-run→re-verify pass, honest WARN if it can't).
- **T1-session-rehydrate** 🟢⚠️ — rehydrate in-process state (GitManager/WorkspaceMemory) on
  server restart so a mid-build restart continues seamlessly (transcript survives; in-proc doesn't).
- **T1-structured-logs** 🟢✅ — SUBSTANTIALLY COVERED: P-BRE.1 `TracingManager` already gives
  every build a `traceId` + timing spans with OTLP/Cloud Trace export, and `DecisionTraceManager`
  records the semantic decision trace. A further "promote the whole event stream to JSON" pass is a
  hot-path refactor for marginal gain — not scheduled unless a concrete observability gap appears.
- **T1-admin-dashboard** 🟢❌ — aggregate logs + audit episodes into an admin build/cost/failure
  dashboard + alerting on failure-rate spikes.
- **T1-watchdog** 🟢❌ — `WatchdogService` for zombie sandbox processes (poll, force-kill + rebuild).

### 1E · Ship-it-live UX (big-app-maker parity)
- **T1-deploy-1click** 🟢✅ — ALREADY BUILT (verified in code 2026-07-12): the client `deployLive()`
  in `AgentV3Panel.tsx` (~L1654) drives the REAL build+deploy pipeline to the CHOSEN configured provider
  (only configured providers are offered — `/api/agentv3/deploy-providers`), and the permanent live URL is
  restored durably via `/api/agentv3/deployment` + `DeploymentStore`. Server side: `DeployProviders`
  (Vercel/Netlify/Cloudflare/Firebase) + `/api/agentv3/workspace-files` feeding the existing deploy backend.
  (Earlier ❌ was stale.) *(Consolidates the old 5.1 / Layer-75 / 6.5 / P-DEPLOY / Cap-5 / U-12 duplicates.)*
- **T1-db-provision-ui** 🟢❌ — one-click Supabase/Firebase/Neon for the user's app, env written
  back (BYO Provisioning Broker — old U-3 / Cap-1).
- **T1-auth-scaffold** 🟢❌ — built-in login/signup wired into the generated app.
- **T1-version-timeline** 🟢✅ — SHIPPED: the AgentV3 `history` tab renders the deduped checkpoint
  timeline across turns (`allCheckpoints`) with a per-checkpoint restore wired to the real
  `/api/agentv3/restore`, and honest "sandbox recycled" feedback when a SHA isn't live this session.
- **T1-budget-ux** 🟢❌ — honest "budget reached" state + one-click "continue with higher budget."
- **T1-mention-inbox** 🟢✅ — SHIPPED (#1179): `MentionNotificationStore` (per-user Firestore store
  + pure `deliverMentions`) delivers each @mention to the tagged member's inbox; `MentionInbox`
  bell/dropdown in the collab header polls `/api/notifications`, shows an unread badge, and marks
  read. Optional email delivery stays a future piece (needs an external provider key) — honestly
  noted, not stubbed.

---

## 🥉 Tier 2 — Engine & capability tracks (make big/complex apps real)
Each is a dedicated PR + tests. Ordered by leverage (the roadmap's own call:
**A1 → B4+B5 → C7** first — without them the agent can *run* a big app but not understand,
safely edit, or truly verify it).

### 2A · Understanding & verification (highest leverage)
- **A1** 🟢❌ — Semantic code-retrieval + code-graph + symbol index (agent *queries*
  who-defines/who-calls/where-used instead of prompt-stuffing). Lexical BM25 core exists;
  this is the query/graph layer. *(Embeddings half is infra-gated → Tier 4.)*
- **A2** 🟢❌ — Auto architecture-onboarding pass: map services/data-flow/entry-points before editing.
- **A3** 🟢⚠️ — Long-horizon persistent decision-log the agent re-reads across turns
  (overlaps GA-6 engineering memory).
- **B4** 🟢✅ — SHIPPED (#1249, 2026-07-12, Immune System Phase 2 "Vaccine"): `testRunner.detectTestPlan`
  + `parseTestOutcome` already existed as the `run_tests` agent tool; the vaccine makes running the app's
  OWN suite a guaranteed SYSTEM reflex after a successful build (opt-in `AGENTV3_VACCINE=on`), recording a
  `TEST_SUITE` finding (info green / warning + failing names red) and healing the source on failure.
- **B5** 🟢⚠️ — Real browser drive + console/network capture → auto-fix (limited today).
- **B6** 🟢❌ — Cross-language typecheck/lint (Java + Python + TS together).

### 2B · Precise editing at scale
- **C7** 🟢⚠️ — AST / surgical multi-file edits + codemods (whole-file rewrite still dominates
  and breaks big files). Also P-DEV.6 Extract-Method/Variable/Move-Symbol.
- **C8** 🟢❌ — Coordinated cross-file refactor / rename at scale (safe repo-wide renames/moves).

### 2C · The GA engine suite (from the UCUE-v2 gap audit)
- **GA-1** ⚠️ — Multi-Workspace Manager (unified orchestrator: list/switch/quota/cleanup).
- **GA-2** ❌ — Runtime Supervisor + Background Task Manager + durable Job Queue (long-run
  process tracking, restart-on-crash). *(Out-of-process half is infra → Tier 4 / V4-4.)*
- **GA-3** 🟡 — Dependency Intelligence. **Slice 1 ✅ (2026-07-12):** semver-backed version-CONFLICT detector in `DependencyAnalysis.detectVersionConflicts` — flags the same package pinned to non-intersecting ranges across dependencies/devDependencies/optionalDependencies (npm resolves ONE version → one section wrong) + a dep/devDep version that violates the project's OWN peerDependencies range. Wired into `analyzeDependencies` (the `evaluate` dependency dimension), so conflicts surface to the agent to fix. Non-semver specifiers skipped (no false positives). **Remaining ❌:** an auto-resolver (pick a satisfying version) + Bun & UV package-manager engines.
- **GA-4** ❌ — Incremental / selective / cached builds (file-dependency delta graph + artifact/`node_modules` cache).
- **GA-5** ❌ — Relationship graphs + change propagation (API-endpoint graph, DB schema/FK graph).
- **GA-6** ❌ — Persistent Engineering Memory (ADR, tech-debt register, bug DB, deploy/migration history).
- **GA-7** ❌ — Project Coordinator agent (milestone/task-board/resource coordination role).
- **GA-8** ❌ — Multi-Strategy Repair (ordered fallback + backoff + circuit-breaker +
  regression-capture) — replaces the hardcoded 3-try loop.
- **GA-10** ⚠️ — DB Migration runner + Schema Intelligence (Prisma/Knex/Drizzle/Flyway/Alembic +
  schema inference/type-gen). Also D9.
- **GA-12** ⚠️ — Static-quality engines: wire ESLint + Prettier as engines + dead-code / code-smell / coupling detectors.
- **GA-13** ❌ — Supply-chain & threat: real CVE/OSV vuln scanner + threat-modeling.
- **GA-14** ⚠️ — CI/CD intelligence: generate + repair pipelines (GitHub Actions first, GitLab/Jenkins later).
- **GA-15** ❌ — IaC engines: Dockerfile / Terraform / K8s-Helm manifest generation + infra optimizer.
- **GA-16** ❌ — Performance intelligence: runtime profiler, bundle analyzer, memory-leak, query optimizer.
- **GA-17** ✅ — SHIPPED (#1249, 2026-07-12, Immune System Phase 3 "Red-team"): `FuzzProbe.generateFuzzPlan`
  finds the running app's inputs and builds a bounded adversarial catalog (empty/oversized/injection-shaped/
  unicode/malformed numbers/emails/urls); the post-build pass drives a real browser to type each hostile
  value + submit, and `interpretFuzzErrors` records a `FUZZ_ROBUSTNESS` warning per input that crashes.
  Opt-in `AGENTV3_REDTEAM=on`, hard-capped (≤12 cases / ≤90s), heals source validation when enabled.
- **GA-18** ❌ — Feature-gap analyzer: generalize the PRESENT/PARTIAL/ABSENT audit into a reusable engine for Pro Chat.

### 2D · Quality-by-default scaffolding
- **U-1** 🟢❌ — Deterministic build harness (pin model/seed, signed manifest) + `LintGate` beside `TscGate`.
- **U-2 / Cap-3** 🟢🟡 — App-Scaffold-Defaults engine: SEO/OG + PWA manifest+SW + a11y + a
  starter test **by default** every build.
- **Cap-2** 🟢🟡 — Ship a starter test by default + E2E (Playwright) generation (`generate_tests`
  is on-request today).
- **U-4** 🟢❌ — Verified recipe modules (Stripe/Razorpay, email, realtime, search, storage)
  that are generated AND smoke-tested.
- **Cap-4** 🟢🟡 — Auto-inject observability (error handler + request logger + `/health`) into
  generated apps + cost-alerting thresholds.

### 2E · Pipeline verification stages (P-PIPE)
- 🟢❌ Runtime smoke tests (hit routes/API, auth, DB reads) · hydration validation · post-deploy liveness check.
- 🟢❌ Deterministic dependency reconciler (undeclared import → `package.json`).
- 🟢🟡 Wire eslint + prettier + `npm audit`/CVE + license-validation gates into the AgentV3 pipeline.
- 🟢❌ Perf/bundle-size + Lighthouse gate (blocker for complex apps) · a11y as a blocker for complex apps.
- 🟢❌ Task-dependency graph (`TodoItem.dependsOn`) for correct big-app build order.
- 🟢❌ Real interactive clarification round (bounded `ask_user` tool for complex apps).

### 2F · Toolchain & monorepo
- **D11** 🟢❌ — Toolchain version pinning (`.nvmrc` / JDK 17 / Python + lockfile integrity).
- **D12** 🟢⚠️ — Monorepo task-runners (turborepo / nx / pnpm-yarn workspaces, not just npm).
- **P-PIPE-runtime** 🟢❌ — Multi-runtime SDK + package-manager detection (Bun/Python/Java/Rust;
  npm is hard-coded today). Also **AB-6** polyglot build detection (Gradle/webpack).

---

## 🎯 Tier 3 — Breadth & distribution targets
- **UT-2 (mobile — biggest reach)** 🟢❌ — Native mobile output: React Native/Expo or
  Capacitor → signed **APK/AAB/IPA**, QR preview. *(= old 5.8 / P-MOBILE / U-12 / P-CGE.12.)*
- **UT-1 (desktop)** 🟢❌ — Electron/Tauri → `.exe` / `.dmg` / `.AppImage`.
- **UT-3 (extensions)** 🟢❌ — Browser extensions (Manifest V3).
- **More languages** 🟢❌ — Rust (Cargo), Ruby/Rails, PHP/Laravel, C/C++ (CMake), DevOps
  templates (Terraform/Ansible/K8s/Docker). *(Redundancy-check each against the live
  `FrameworkRegistry` first — some scaffolds may already exist.)*
- **Template-free scaffold mode** 🟢❌ — auto framework-detect + free scaffold when no template fits.
- **P-INTEG** 🟢❌ — OAuth connector framework + credential vault + prebuilt connectors + plugin
  SDK/marketplace. Also **D10** third-party integration mock/sandbox-or-real-key wiring.
- **Template gallery** 🟢❌ — starter gallery, pick-then-chat-to-customize (+ save-build-as-template).
- **Design-to-code** 🟢❌ — screenshot/Figma → matching UI via vision (= Cap-7 / U-13 / P-AI.13 / 5.7).

---

## 🔒 Tier 4 — Infra / license / admin-gated (honest open root causes)
Per constitution rule 6: recorded openly, **not** patched cosmetically. Each needs a
decision or spend outside the code session (no `gcloud`/tokens from here).

### Sandbox / build infra
- **AB-3** 🔒 — Multi-service orchestration (docker-compose: backend + mongo + redis + frontend,
  ports/proxy/health). Today: native Mongo/Redis processes in the fullstack image (honest alternative).
- **AB-4** 🔒 — Bigger E2B VM (more CPU/RAM/disk) + longer build budget for JVM/heavy builds.
- **AB-9** 🔒 — Multi-service preview (full graph: frontend → backend → DBs).
- **V4-4 Nirman workers** 🔒 — out-of-process build execution on a durable queue (Cloud Run Jobs +
  Firestore/Cloud Tasks) so a deploy/network-cut can't kill a build. In-process resilience
  already shipped (V4-1a/1c). *(= P7 job queue / P-BRE.6 / GA-2 durable half / P-ORCH.1 cron.)*
- **Warm pool / autoscale** 🔒 — Cloud Run min-instances + pre-warmed E2B (= U-6 / F9); also
  durable per-workspace warm-sandbox that survives continue-turns.
- **Firebase Emulator Suite in sandbox** 🔒 — auth/firestore without real keys (U-16).

### Retrieval / preview
- **V4-5 Smriti embeddings** 🔒 — semantic retriever over durable files (needs OPENAI/Vertex
  embeddings key). Lexical BM25 already covers grounding. *(= A1 embeddings half / V3 Phase-3 RAG.)*
- **V4-6 WebContainers** 📜 — StackBlitz WebContainers in-browser preview (commercial license).
  BrowserBox esbuild-wasm (V4-3) is **HELD by design** — `ReactPreview` already covers it;
  reopen only on a real report of the current preview failing.

### Platform / edge / observability infra
- **P6** 🔒 — Terraform/Pulumi IaC for Cloud Run/Firestore/IAM/secrets/indexes + Policy-as-Code (OPA).
- **P7** 🔒 — Redis (Memorystore) distributed cache + Redis-backed cross-instance rate-limit store.
- **P8** 🔒 — Cloud Monitoring alerting + SLO rules (error-rate/p95/token-spend) + incident runbook.
- **P9** 🔒 — Canary/blue-green traffic split with auto-rollback + cross-region readiness.
- **P10 / P-SEC.9/.11** 🔒 — Cloud KMS/Secret Manager for keys · apply Cloud Armor WAF/DDoS ·
  apply seccomp/cap-drop/non-root · k6/Locust load + fault-injection in CI.
- **P-SEC.4/.10** 🟡🔒 — Trivy HIGH/CRITICAL image scan + Binary Authorization + `npm audit
  signatures` + `--ignore-scripts` in `cloudbuild.yaml`/CI (partly code-tractable — add the CI steps).
- **P-SEC.7** 🔒 — Cloud Logging structured audit export (SIEM connector).
- **Browser-QA gates (P-TQA.11)** 🔒 — axe-core AA + Lighthouse over the LIVE preview in CI
  (needs prod E2B key / Docker host).
- **Multi-target deploy tokens · Sentry account** 🔒 — external accounts/keys.

### Admin / monetization decisions
- **Pro tier-gating** 👤 — `/api/pro-chat`, `/api/pro-build`, `/api/build` are open to everyone;
  enforcing paid tiers is a monetization call (kept open until app ~90%).
- **P-SEC.3 / .8 / .13** 👤 — end-user TOTP/WebAuthn passkeys · hCaptcha + IP-reputation
  (AbuseIPDB/IPQS) · step-up re-auth + impossible-travel (needs GeoIP) — all need external keys/decision.
- **P-BRE.7 email channel · P-DATA.6 ClamAV/VirusTotal · P-DATA.7 PDF export (pdfkit)** — need
  provider keys/deps.

---

## 🌌 Tier 5 — North-star / frontier (VISION, not committed backlog)
Explicitly aspirational. Ship a **real v1 + honest** version only as the market pulls —
this is NOT a to-do checklist, and none of it overrides the absolute rules. Listed so the
long-term direction lives in one place.

- **V3 Phases 11–15** — autonomous SDLC / "software factory" / virtual software company
  (CTO/Tech-Lead/PO roles) · enterprise & marketplace (org/team/roles, billing/quotas/
  governance/approvals; agent/plugin/template marketplaces) · self-learning & production
  intelligence (pattern/failure/success learning, prompt/skill/strategy evolution).
- **Frontier Layers 49–86** — collective intelligence · scientific discovery / autonomous
  research lab · innovation · strategic intelligence · digital twin / world simulation ·
  self-reflection · **Layer 58 Governance & Layer 85 AI-safety/alignment (hard prereqs that
  gate the self-improvement layers)** · knowledge evolution · economic agents · autonomous
  startup/org · evolutionary architecture · ecosystem · federated intelligence · recursive
  self-improvement · civilization-scale.
- **Layer 72 — UCUE v2.0 computer-use engine** (browser/vision/DOM/reasoning/memory/learning/
  recovery/verification/safety-gate/digital-workers), surfacing as the in-app AI browser
  **"Sahyatri"** (server-streamed E2B Chromium+CDP, agent click/type, co-pilot hand-off,
  approval gate as hard prereq, record-replay skills, vernacular voice).
- **Layers 73–78 (Bharat-first)** — universal language & voice (22 Indian + 12 world langs,
  speech-to-build, Bharat pack: UPI/Aadhaar/GST/ONDC) · Sahyog partnership UX (steer/interrupt/
  take-the-wheel/explainability) · Sapna-se-Site idea→live (subdomain+SSL+domain+self-healing) ·
  Srijan creator marketplace · Bharosa trust/compliance (DPDP/GDPR/SOC2, launch-safe cert) ·
  Sabke-Liye inclusion (2G/offline/WCAG).
- **P-FUTURE.1–9 / P-ARCH+.1–7** — spec-driven dev · subagent fan-out + adversarial verifiers ·
  LLM-as-judge gates · formal/property-based verification · production self-healing loop ·
  multi-candidate app tournaments · on-device/edge instant preview · complexity-adaptive
  pipeline-depth router · single deterministic `PipelineOrchestrator` · up-front frozen
  blueprint/contract/dep-graph · self-improving cross-build memory.
- **Un-audited domain backlogs** (each = a future 300-component audit → its own phase):
  `P-PAY` payments/monetization (Razorpay/Stripe, subscriptions, GST, let users charge for
  their apps) · `P-IDENT` identity/accounts/onboarding · `P-SANDBOX` sandbox/isolation depth ·
  `P-INTEG` integrations/marketplace · `P-MOBILE` distribution · `P-GROWTH` SEO/marketing/
  retention · `P-VERTICAL` per-vertical AI quality · `P-DEVPLAT` public dev platform (API/SDK/
  CLI/docs) · `P-SUPPORT` support/CS · `P-CONTENT` docs/education · `P-TRUST` moderation/abuse ·
  `P-PERF` platform-wide perf & cost.

---

## 🧹 Polish backlog (GAPS.md long-tail — triage buckets)
~150 small UX/quality items from the v2.0-vs-Claude-Code gap audit. Not individually
tracked here as PRs; pull from the relevant bucket when polishing that surface. Highest-impact
representatives per category:
- **Editor:** snippet library · compare-against-saved diff · open-in-split · move-file (cut/paste).
  *(Jump-to-def / find-refs / rename-symbol / inline TS-ESLint markers are LSP-gated.)*
- **Chat:** scroll-position lost on tab switch · @-mention file reference · LaTeX/math render · pin message.
- **Files:** multi-select bulk delete/download · file pinning · filename-with-spaces preview bug.
- **Build/Gen:** "what changed?" diff view · security findings linked to file/line · generated
  comments sometimes Hindi (CLAUDE.md violation) · report all errors (don't stop on first) · export report PDF/MD.
- **Mobile UX:** pinch-zoom preview · iOS safe-area in chat input · Android keyboard jumps ·
  settings overflow <375px · session-switcher reachability · long-press context menu.
- **Errors:** highlight failing file on preview error · error log/history panel · 429 countdown ·
  "cannot find module X" → install suggestion · component name (not URL) in preview errors.
- **Settings:** what's-new/changelog · onboarding tour · export-all-my-data (GDPR) ·
  delete-my-account button · API-key health check · preferred-AI-model selector · usage-by-feature.
- **Preview:** blank-flash on load · persist after reload · respect system dark/light · surface
  console errors in chat · error overlay shows causing file.
- **Deployment:** redeploy button · deploy history panel · step-by-step progress · `.env`
  injection for deployed app · custom-domain visual guide · post-deploy health check · PR preview URLs.
- **Git panel:** log/history view · staged-vs-unstaged · ahead/behind · `.gitignore` editor ·
  stash · remote branches in switcher · tag creation · blame · PR list.
- **Performance:** FCP >3s · App.tsx God-component (~6,096 lines) split → ~2,500 · chat-list
  virtualization · Monaco lazy-instantiate · file-tree re-render · code-split settings panels · request dedup/cache.
- **Accessibility:** modal focus-trap · dark-mode contrast <4.5:1 · sidebar tab order · high-contrast
  mode · keyboard-accessible file upload · error-msg ↔ input association.
- **Security (app-level):** CSP header · SRI for CDN scripts · block secrets in generated code ·
  per-user rate-limit · CSRF tokens · admin audit log · server-side upload MIME validation ·
  logout-on-inactivity · encrypt API keys in localStorage.
- **Collaboration:** shareable read-only preview link · share/fork project · line-level comments ·
  export-as-template · UCI QR code · embed-code generator. *(Real-time co-edit/CRDT + team backend are bigger.)*

---

## 🚫 Explicit non-goals (do NOT propose or build)
- **BYOK Anthropic key** — deliberately removed by admin (2026-06-25). Never re-introduce a
  "bring your own Claude key." (Bring-your-own-*Database* is a separate, kept feature.)
- **Local-machine execution · VS Code/JetBrains extension · global `nbai` CLI on the user's
  machine · OS-level hooks** — a hosted web builder cannot touch a user's local FS (the
  "literal-copy wall"). A hosted headless build API is fine (that's P-DEVPLAT); local execution is not.
- **PowerShell/CMD/ZSH runtimes** — cloud Linux by design; no reach gain.
- **Legacy `AppMakerLab` (non-sandbox) pipeline wiring** — dead code path; only the AgentV3
  sandbox path is live. Never "revive the legacy engine."
- **Kafka / self-managed K8s / Helm-at-cluster / gRPC / HSM / SAML-at-infra / GPU /
  multi-region DB** — marked N/A by design throughout the old docs.
- **"Bucket C" earned-over-time items** — uptime track record, user base, product age, SOC2/ISO
  *attestation*, SLA history, community size, human support. Real, but accrued over time — not
  shippable in a PR (build the substrate that enables them; don't fake the credential).

---

## ▶️ Start here (recommended order)
1. **Tier 0** live defects (T0-1…T0-9) — the app-must-never-break rule applied to today's reports.
2. **Tier 1B/1C** — enforce the eval gate + activate the dormant escalation orchestrator (biggest
   quality win for zero new infra).
3. **Tier 1A** security floor (secret redaction, spend ceiling, rate-limit-all, injection defense).
4. **Tier 2A** verification — **B4 (run the project's own test suite) next**, then A1 → B5 → C7.
5. **Tier 1E** ship-it-live UX (one-click deploy / DB-provision / auth scaffold) once verification is trustworthy.
6. Then Tier 2 engines → Tier 3 breadth, pulling Tier 4 items in as their infra/decisions unblock.

*Consolidated 2026-07-08. Update this file (and `PROGRESS.md`) as items ship; move completed
items into "Confirmed DONE" rather than deleting them, so the roadmap stays an honest ledger.*

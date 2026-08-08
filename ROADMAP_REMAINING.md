# NavBharatAI — Remaining Roadmap (compiled + code-verified, 2026-07-20)

**One place. Only what is genuinely LEFT.** Every item below was cross-matched against the LIVE
code (four parallel investigators grepping `src/server/AgentV3`, `src/server/lib`, `ToolCatalog.ts`,
`routes/agentv3.ts`, `.github/workflows`, `cloudbuild.yaml`) on 2026-07-20. Items already shipped and
items that would DOWNGRADE the app (non-goals) have been **removed** — this file is the upgrade-only
worklist.

> **Why this exists:** the old `ROADMAP.md` is ~90% stale — dozens of items marked ❌/🟡 are actually
> already built. This file is the reconciled truth. `ROADMAP.md` stays as the historical ledger; **use
> THIS file to decide what to build next.**

**Legend:** 🟢 = build now (code-tractable, no infra) · 🔵 = larger effort (multi-PR, still code) ·
🔒 = blocked (needs infra/keys/decision — do NOT attempt in a session) · 🚫 = excluded (non-goal/downgrade).

**Before picking up ANY item: re-grep the live code first** (safeguard #1/#6 — another session may have
shipped it since this audit). Every fix ships root-cause + regression test + `AppKnowledgeBase.ts` entry
if user-facing, via branch → verification gate → PR → CI green → merge. **Never touch the moat**
(multi-provider routing, billing honesty, white-label, coherence architecture).

---

## 🟢 BUILD NOW — code-tractable, real upgrade, no infra needed

### A. Engine quality & intelligence (highest leverage)
1. **Bounded `ask_user` clarification tool** — ✅ **DONE (verified 2026-07-21, corrected):** it IS built as
   a NON-BLOCKING, friction-free clarify card. On a fresh domain build with real askable gaps the server
   emits a `clarify` event (`routes/agentv3.ts` ~6800, gated `AGENTV3_ASK_USER=on`, default-OFF ⇒
   byte-identical to today) and the client renders a dismissible card (`AgentV3Panel.tsx`
   `state.pendingClarify`) — the build NEVER waits for an answer (honours "text reply > build app"); the
   user adjusts any assumption via a normal follow-up. The old "OPEN — no `ask_user` tool" line was a STALE
   grep miss (it searched the literal name `ask_user`, not the `clarify`-event implementation). REMAINING =
   a DECISION only: flip `AGENTV3_ASK_USER=on` in Cloud Run (the admin's call — friction-free vs. zero-UI).
2. **Prompt-cache stable prefixes for GLM/Kimi (AP-5)** — the stable-prefix STRUCTURE is **already built**
   (`systemPromptCache.ts` + `AGENTV3_CACHE_PREFIX`: it splits the volatile prefix out and keeps the large
   static body as a byte-stable prefix; the 2026-07-21 AP-4 fix-dispatch change preserves that byte-stability
   when its flag is off). REMAINING = per-provider cache MARKERS in the GLM/Kimi adapters. ⚠️ **Held (moat +
   unverifiable):** the provider adapters are part of the routing moat ("CONFIRM WITH ADMIN BEFORE CHANGING"),
   and the benefit is unmeasurable without provider cache-hit telemetry — do NOT change autonomously.
3. **~~Cap-4 cost-alerting thresholds~~ — ✅ DONE (verified 2026-07-21).** `costAlert.ts`
   (`costAlertThresholdUsd` / `costAlertAdvisory`, env `AGENTV3_COST_ALERT_USD`) is wired into
   `BuildDiagnostics.ts` — a build whose spend crosses the threshold records an advisory. (Prior #1771.)
4. **Daily-spend quota gauge (T1-cost-transparency remainder)** — a `/api/usage/tokens` endpoint + a
   daily-spend-vs-quota gauge. OPEN. *Needs a quota definition first (small product decision).*
5. **Network-request capture for the auto-fix loop (B5 remainder)** — console + runtime-error classifier
   are DONE (`console_errors`, `RuntimeErrorClassify.ts`). ✅ **HTTP 5xx server responses now captured**
   (2026-07-21, #1793): the E2B daemon's `page.on('response')` records an `httperror` for status ≥ 500 (a
   completed-but-500 fetch does not fire `requestfailed`), classified via the `http-status` rule. REMAINING
   (narrow): richer per-request structured capture (method/timing/body) — needs deeper daemon/E2B-template
   work, so honestly infra-adjacent, not a code-only slice.
6. **Runtime route/API/auth/DB smoke-hitter (P-PIPE)** — after a successful backend build, hit key routes
   (health, an auth flow, a DB read) and report honest pass/fail. OPEN (post-deploy liveness + browser
   verify exist; a server-route smoke-hitter does not). *Borderline: the hitter logic is code; it needs a
   live sandbox to run against (degrade honestly when absent).*

### B. Breadth recipes & scaffolds (isolated, low-risk, clear upgrades)
7. **More framework languages** — Rust/Cargo, Ruby/Rails, PHP/Laravel, C/C++/CMake. ⚠️ **RECLASSIFIED
   🔒 BLOCKED (verified 2026-07-21):** the fullstack E2B template (`infra/e2b/e2b-fullstack.Dockerfile`)
   ships Node/Python/Java+Maven/Go ONLY — NO Rust/Ruby/PHP runtimes. Registering these frameworks would
   create build options the sandbox CANNOT run (a "Rust" build that 403s = a fake feature, rule 2). Real
   fix needs the multi-GB template rebuilt + republished with those runtimes (`E2B_TEMPLATE_ID`) — admin
   infra, not a code-only slice. Do NOT add the registry entries until the template carries the runtime.
8. **More deploy targets** — AWS, Azure, Railway, Render. OPEN (`DeployProviders` has Firebase/Vercel/
   Netlify/Cloudflare/GH-Pages only). Each = a provider module.
9. **GraphQL backend recipe** — OPEN (REST CRUD recipe exists; no GraphQL). A `generate_graphql` schema +
   resolver recipe.
10. **Frontend state/animation recipe** — state-management scaffold (Zustand/Context) + animation + optimistic-
    update helpers. OPEN (LLM-driven only today; `generate_ui_states` covers loading/skeleton/empty).
11. **Settings scaffold + in-app notification-center** — OPEN (`NotifyGenerator` is channel integration only;
    no settings page / notification center generator).
12. **Design-to-code (screenshot/Figma → component)** — the vision base exists (`visionDescribe`/`visionChain`
    feed image understanding into builds); the delta is an explicit **image → layout-contract → build** step
    + a Figma/screenshot recipe. PARTIAL → build the intermediate contract step (AP-8).
13. **Template-free scaffold fallback** — when no template fits, auto framework-detect + emit a minimal free
    scaffold. PARTIAL (detection exists; the no-template fallthrough is unconfirmed).
14. **Integration-test + real-mock generator** — today `generate_tests` emits skeletons with TODO asserts;
    upgrade to real integration tests + working mocks (not stubs). PARTIAL.
15. **Developer-guide generator** — human "how this app is structured / how to run & extend" doc. PARTIAL
    (`generate_readme`/`generate_architecture_docs` exist; no dedicated dev-guide).
16. **Cap-2: auto-run E2E by default** — `generate_e2e` (Playwright) exists but is on-request; force-run a
    starter E2E after a successful build (like the U-2 defaults / auto-test pass). PARTIAL.
17. **~~Ansible IaC target~~ — ✅ DONE (stale audit line, verified 2026-07-21).** `generateAnsiblePlaybook`
    (playbook.yml + inventory.ini + README) is already in `IaCGenerator.ts` and wired into `generateIaC`
    alongside K8s/Helm/Terraform.
18. **`--ignore-scripts` on the audit/scan install (P-SEC.4 half)** — add to the CI **audit/scan** job only
    (NOT the deploy install — postinstall builds are legit there). Small, safe. OPEN in CI.

### C. Domain & polish (real, pick per surface)
19. **Packaged domain recipes** — ✅ **DONE (2026-07-21) — a strong batch shipped:** `generate_crm` (sales
    state-machine), `generate_hospital_erp` (#1819 — double-booking/RBAC/audit), `generate_school_erp`
    (#1831 — attendance/grades/fees), `generate_courier` (#1832 — shipment state-machine/tracking),
    `generate_restaurant_pos` (#1833 — table state-machine/KOT/GST). Each is real + test-locked. Further
    verticals only as real demand shows (don't churn recipes for their own sake — rule 3).
20. **Service-split generator + named paradigms** — Clean/DDD/MVC/Hexagonal scaffold + a microservice split
    path. OPEN (coupling is scored; no split generator). *Lower priority.*
21. **Pure-code polish** (pull per surface, each small): ~~CSP for generated apps~~ (✅ CSP-meta analyzer,
    #1791) · ~~SRI for CDN scripts~~ (✅ done, prior) · ~~server-side upload MIME validation~~ (✅ multer
    fileFilter analyzer, #1794) · ~~open redirect~~ (✅ already two rules in `SecurityAnalysis.ts`) ·
    "report ALL build errors, don't stop on first" · component-name (not URL) in preview errors + highlight
    the failing file · "cannot find module X → install suggestion" · 429 countdown · logout-on-inactivity ·
    server-side upload MIME validation · block secrets in generated code. *(Verify each vs live code first —
    some may already exist.)*
22. **Generated-comment language guard** — generated code sometimes carries Hindi comments (a CLAUDE.md
    violation); add a prompt/lint guard. OPEN.

---

## 🔵 LARGER — real upgrade, but multi-PR / architectural (scope before starting)
- **~~Full-builder frontend/backend sub-agent parallelism (AP-4)~~ — ✅ parallel-build DONE (2026-07-21).**
  The parallel FE/BE dispatch primitive shipped in #1790 (`isParallelSafeToolUse` for writer roles under a
  per-path `PathWriteLock`, flag `AGENTV3_PARALLEL_BUILD`), and #1798 made the architect's fix-dispatch
  guidance parallel-aware (byte-identical when the flag is off). Flip the flag in prod + measure to enable.
  ⚠️ **The "merged heal pass" sub-idea is DELIBERATELY NOT DONE (declined 2026-07-21, rule 3):** the 5
  post-build heal passes fire *conditionally* (a clean build triggers none) and carry genuine render-ordering
  deps + billing/moat threading — a merge is high-risk / low-reward. Revisit only with a specific admin call.
- **~~Cross-restart build resume (AP-3 / T1-session-rehydrate)~~ — ✅ DONE (verified 2026-07-21, task #57).**
  `CheckpointStore` (save/load) + `SandboxStore` sandbox-resume + server-restart AUTO-resume (honest
  "server is restarting — your build resumes automatically" narration) + D7 plan/todo restore on cold reopen
  are all wired in `routes/agentv3.ts`. The "resume wiring does not exist" audit line is stale.
- **~~1000+ file codemod (lift the ~50-file cap)~~ — ✅ the 50-cap is DONE (stale audit line).** The codemod
  path is relevance-scoped with a 2000-file per-pass safety cap + honest truncation ("re-run ~N more times
  to finish", converges); the old blind first-50 survives only behind `AGENTV3_CODEMOD_SCOPED=off`
  (`ToolDispatcher.ts` codemod handlers; `codemodScope.ts`; PROGRESS.md T3 Phase 1, 2026-07-19). REMAINING
  (narrow): Phase 2 = auto-loop the chunks when the *relevant* shortlist itself exceeds 2000 files, so a
  mega-refactor finishes in one call instead of N re-runs — rare (needs >2000 files containing one symbol).
- **Template gallery + save-build-as-template** — a curated 20–30 starter gallery + "pick then chat to
  customize" + save-as-template. Mostly frontend + a `/templates` listing endpoint (AP-10). Kills cold-start,
  drives weak-tier cost ≈ 0.
- **P-INTEG: OAuth-connector framework + credential vault + plugin/MCP/SDK** — a generic OAuth connector
  framework + secret vault + plugin/MCP registry. OPEN, large (per-service recipes exist; no generic
  framework). *Note: a user-facing local `nbai` CLI is a 🚫 non-goal — the SDK/MCP half is fine.* ⚠️ **Partly
  infra-gated (rule 2):** the framework + vault + registry CODE is buildable, but a *working* OAuth connector
  needs a REGISTERED OAuth app per provider (client-id/secret + redirect-URI) — that is admin infra. Building
  a vault/registry with no working connector would ship an empty shell; do it only alongside real OAuth-app
  credentials, or behind an explicit "not available yet" state.
- **Scaling / server-load / DB-growth estimators** — quantitative estimates (tradeoff critique exists; no
  numbers). Lower value.

---

## 🔒 BLOCKED / FUTURE — needs infra, keys, or a decision (do NOT attempt in a code session)
Recorded honestly per constitution rule 6. The *code* half (where one exists) is already done; only the
infra/decision remains.

- **Signed native binaries** — APK/AAB/IPA and `.exe`/`.dmg` (wrapper generators DONE; signing needs Android
  SDK/Xcode/electron-builder on the matching OS runner + the user's keystore/certs).
- **Lighthouse / Web-Vitals (LCP/CLS/INP) + axe-core over the LIVE preview** — needs headless Chrome / a prod
  E2B key / Docker host in CI. *This is the app's weakest measured category — unblock when infra allows.*
- **GA-2 out-of-process supervisor + durable job queue (V4-4 "Nirman")** — Cloud Run Jobs + Firestore/Cloud
  Tasks (in-process reaper already shipped).
- **GA-4 incremental build skip + cross-cold-sandbox cache** — needs E2B volume control (`computeBuildPlan`
  already computes the delta).
- **GA-16 runtime profiler / memory-leak detector** — needs a live-execution harness.
- **AB-3/AB-9 multi-service orchestration & preview · AB-4 bigger E2B VM · warm pool/autoscale · Firebase
  Emulator in sandbox** — sandbox/compute infra.
- **V4-5 Smriti embeddings** — OPENAI/Vertex embeddings key (BM25 already grounds).
- **V4-6 WebContainers** — commercial StackBlitz license (BrowserBox HELD by design).
- **P6–P10 / P-SEC.7/.9/.11** — Terraform/Pulumi IaC · Redis (Memorystore) cache + cross-instance rate-limit ·
  Cloud Monitoring SLO alerting · canary/blue-green + cross-region · Cloud KMS/Secret Manager · Cloud Armor
  WAF · seccomp/cap-drop · k6/Locust CI · SIEM audit export.
- **P-SEC.4 Binary Authorization** — GCP Binary Auth + attestor (the `--ignore-scripts` half IS build-now, above).
- **One-click DB auto-create** — external provisioning broker (provider API + user OAuth). Connection-wiring
  (`generate_db_config`) already shipped.
- **T1-provider-verify** — a live real-key + real-sandbox measurement RUN of cheap-provider build quality
  (not code).
- **Escalation / power-effort / cost-ladder DEFAULT-ON** — the CODE is all shipped and env-gated; flipping the
  default needs the "measure first" data + billing sign-off (a decision, not code).
- **GLM/Kimi key pool extra keys** — `parseKeyPool` code is DONE; buy the keys + set `GLM_API_KEY=k1,k2,…`.
- **External accounts/keys** — Sentry · multi-target deploy tokens · email channel (P-BRE.7) · ClamAV/VirusTotal
  (P-DATA.6) · TOTP/WebAuthn/hCaptcha+AbuseIPDB/GeoIP (P-SEC.3/.8/.13).
- **Pro tier-gating** — monetization decision (kept open until the app is ~90%), not a code gap.
- **Cache TTL jitter (admin-requested 2026-08-08 — "kabhi to pad sakti hai, roadmap me likh do").**
  **What:** add a small random spread (±10–20%) to each cache entry's expiry instead of one exact TTL, so
  many entries never expire in the same instant and stampede the source together (a "thundering herd").
  **Why it is NOT built now (honest, rule 3 — do not build this prematurely):** jitter only pays when MANY
  entries expire SIMULTANEOUSLY. Today every TTL cache in the app (`PromptCache`, `WorkspaceMemory`,
  `WorkspaceRegistry`, `ProjectPlanStore`, `BuildQueueStore`, `ShareStore`, `hostingPlan`, `WorkspaceLock`,
  `IdempotencyGenerator`) is keyed PER USER / PER WORKSPACE and each entry is created when that user acts —
  so the expiries are already naturally staggered by the users' own arrival times. Adding jitter now would
  buy nothing measurable and would make cache lifetimes non-deterministic (harder to reason about + to test)
  — cost with no gain. Note the RETRY side already HAS jitter where it genuinely matters (`ClaudeClient.ts`
  backoff, `AIRouter.ts` ±20% cooldown — the 429-storm path).
  **BUILD IT THE DAY ANY OF THESE IS TRUE (the trigger — a future session should check these, not guess):**
  (1) a SHARED/global cache is introduced (one entry served to all users — e.g. a global template list, the
  fleet mistake ledger's hot signatures, a pricing/config blob, a shared model/catalog response); (2) a cache
  is WARMED or rebuilt in bulk (a startup pre-fill, a cron refresh, a post-deploy warm-up — every entry is
  then born in the same second and dies in the same second); (3) a cross-instance cache lands (Redis /
  Memorystore — see P6 above), where one expiry storm hits every Cloud Run instance at once; or (4) real
  traffic shows periodic latency/error spikes at regular intervals matching a TTL boundary.
  **How (small, ~1 file):** one shared helper `jitteredTtl(baseMs, spread = 0.15)` in `src/server/lib/`,
  used by every cache's expiry computation — never sprinkled per call site (same one-choke-point discipline
  as `enforceNoClaude` / `publicEngineName`), plus a test asserting the spread stays inside its bounds and
  never yields a non-positive or unbounded TTL. Pair it with single-flight (one refill per key, others wait)
  — jitter spreads the herd, single-flight makes even a simultaneous herd cost ONE fetch; together they are
  the complete fix, and single-flight is the stronger half.

---

## 🚫 EXCLUDE — non-goals / downgrades (removed from the roadmap; do NOT build)
- **⚠️ Requirement-matcher tightening (AP-9)** — the roadmap itself flags this as a **DOWNGRADE**: tightening
  the incidental-mention filter causes false negatives that HIDE genuinely-skipped features, breaking the
  honesty moat. **Do not build blind.** (The grounded matcher — `isAffirmativelyRequested` — is already the
  right thing; leave it.)
- **BYOK Anthropic key** — admin-removed 2026-06-25; never re-introduce "bring your own Claude key."
  (Bring-your-own-*Database* is a separate, KEPT feature.)
- **Local-machine execution · VS Code/JetBrains extension · global `nbai` CLI on the user's machine · OS
  hooks** — a hosted web builder cannot touch a user's local FS (the "literal-copy wall"). *(A hosted headless
  build API / SDK is fine — that's P-DEVPLAT.)*
- **PowerShell/CMD/ZSH runtimes** — cloud Linux by design; no reach gain.
- **Legacy `AppMakerLab` (non-sandbox) pipeline** — dead code path; only the AgentV3 sandbox is live. Never revive.
- **Kafka · self-managed K8s · Helm-at-cluster · gRPC · HSM · SAML-at-infra · GPU · multi-region DB** — N/A by design.
- **"Bucket C" earned-over-time** — uptime record, user base, product age, SOC2/ISO/HIPAA *attestation*, SLA
  history, community, human support. Real but accrued over time — build the substrate, never fake the credential.
- **All Tier 5 "north-star" vision** — V3 Phases 11–15 (software factory) · Frontier Layers 49–86 · Layer 72
  UCUE/Sahyatri · Layers 73–78 Bharat-first · P-FUTURE.1–9 / P-ARCH+.1–7 · un-audited P-PAY/P-IDENT/… domain
  backlogs. Aspirational, NOT a committed backlog — ship a real v1 only as the market pulls.
- **Any rewrite that touches the moat** — multi-provider routing, billing honesty, white-label, coherence
  architecture. These are the positioning; do not "improve" them into a downgrade.

---

## Reconciliation notes (honesty)
- **Two investigator worktrees were briefly stale** and reported `RuntimeErrorClassify.ts` (B5 classifier,
  #1656) and `PrettierGate.ts` (#1657) as missing — both are in fact MERGED to `main` and confirmed present.
  Corrected here.
- **The following were marked ❌/🟡/⚠️ in the old roadmap but are DONE in code** (do not rebuild): T1-autofix-loop,
  T1-auth-scaffold, T1-budget-ux, T1-costladder-on, B5 classifier, B6 (Go typecheck), C7/C8 codemods, GA-5/6/7/8/
  10/13/14/15/16, D11/D12, dependency reconciler, task-dependency DAG, CSRF/ABAC/SSO/i18n/metrics/tracing/admin/
  dashboard/rbac/backup/pagination/cache/image-opt/crud/migration-schema-depth/maturity-tier grading/find_code_smells,
  UT-1/UT-2/UT-3 wrappers, prettier build-end gate. The old `ROADMAP.md` text is stale on all of these.
- Compiled from four code-anchored audits (Tier 1, Tier 2, Tier 3 + the 30-category gap ledger, Tier 4/5 +
  non-goals). Re-grep before building any item.

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
1. **Bounded `ask_user` clarification tool** — on an ambiguous/large prompt, ask 2–4 high-value scoping
   questions BEFORE building (multi-tenant? RBAC? offline? which DB?), bounded so it never over-asks or
   breaks the fast default path. OPEN (grep: no `ask_user` tool; `DialogueStateManager` has a requirements
   phase but no interactive gate). *The admin's #1-priority category. Coherent + bounded → not a downgrade.*
2. **Prompt-cache stable prefixes for GLM/Kimi (AP-5)** — byte-identical stable system/prefix blocks for the
   cheap providers. OPEN (grep: `cache_control` only in `ClaudeClient.ts`, none in `AgentV3/providers/`).
   Real speed + cost win on the cheap floor that leads every free/paid build.
3. **Cap-4 cost-alerting thresholds** — the one remaining Cap-4 half (injection trio already shipped).
   OPEN (grep empty). Emit a build-report advisory when a build's spend crosses a threshold.
4. **Daily-spend quota gauge (T1-cost-transparency remainder)** — a `/api/usage/tokens` endpoint + a
   daily-spend-vs-quota gauge. OPEN. *Needs a quota definition first (small product decision).*
5. **Network-request capture for the auto-fix loop (B5 remainder)** — console + runtime-error classifier
   are DONE (`console_errors`, `RuntimeErrorClassify.ts`); add captured **failed network requests** as a
   distinct signal into the same repair loop. OPEN.
6. **Runtime route/API/auth/DB smoke-hitter (P-PIPE)** — after a successful backend build, hit key routes
   (health, an auth flow, a DB read) and report honest pass/fail. OPEN (post-deploy liveness + browser
   verify exist; a server-route smoke-hitter does not). *Borderline: the hitter logic is code; it needs a
   live sandbox to run against (degrade honestly when absent).*

### B. Breadth recipes & scaffolds (isolated, low-risk, clear upgrades)
7. **More framework languages** — Rust/Cargo, Ruby/Rails, PHP/Laravel, C/C++/CMake (+ Ansible for IaC).
   OPEN (`FrameworkRegistry` has only TS, Python, Java, Go, static). Each = a scaffold + registry entry.
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
17. **Ansible IaC target** — `generate_iac` emits Terraform + K8s + Docker; add Ansible. PARTIAL.
18. **`--ignore-scripts` on the audit/scan install (P-SEC.4 half)** — add to the CI **audit/scan** job only
    (NOT the deploy install — postinstall builds are legit there). Small, safe. OPEN in CI.

### C. Domain & polish (real, pick per surface)
19. **Packaged domain recipes** — Hospital-ERP / CRM / EMR starters (RBAC + admin + dashboard + audit recipes
    now all exist to compose them). PARTIAL — no packaged domain recipe yet.
20. **Service-split generator + named paradigms** — Clean/DDD/MVC/Hexagonal scaffold + a microservice split
    path. OPEN (coupling is scored; no split generator). *Lower priority.*
21. **Pure-code polish** (pull per surface, each small): CSP header on generated apps · SRI for CDN scripts ·
    "report ALL build errors, don't stop on first" · component-name (not URL) in preview errors + highlight
    the failing file · "cannot find module X → install suggestion" · 429 countdown · logout-on-inactivity ·
    server-side upload MIME validation · block secrets in generated code. *(Verify each vs live code first —
    some may already exist.)*
22. **Generated-comment language guard** — generated code sometimes carries Hindi comments (a CLAUDE.md
    violation); add a prompt/lint guard. OPEN.

---

## 🔵 LARGER — real upgrade, but multi-PR / architectural (scope before starting)
- **Full-builder frontend/backend sub-agent parallelism + merged heal pass (AP-4)** — the builder does not
  yet auto-run frontend/backend sub-agents in parallel, and the heal gates (integrity/preview/C9/runtime)
  each fire their own LLM round instead of one merged pass. Big **speed** win (medium app 20 → 5–7 min).
- **Cross-restart build resume (AP-3 / T1-session-rehydrate)** — durable checkpoint of plan+todo state so a
  mid-build process restart CONTINUES instead of restarting. Substrate exists (`CheckpointStore`,
  `FirestoreWorkspaceMemoryStore`, `GitManager`); the resume wiring does not. *Higher-risk — touches the
  build loop; scope carefully.*
- **1000+ file codemod (lift the ~50-file cap)** — chunked repo-wide refactor path for very large apps
  (`CodemodeExecutor` bounded to ~50 files today). Serves ERP/large-SaaS.
- **Template gallery + save-build-as-template** — a curated 20–30 starter gallery + "pick then chat to
  customize" + save-as-template. Mostly frontend + a `/templates` listing endpoint (AP-10). Kills cold-start,
  drives weak-tier cost ≈ 0.
- **P-INTEG: OAuth-connector framework + credential vault + plugin/MCP/SDK** — a generic OAuth connector
  framework + secret vault + plugin/MCP registry. OPEN, large (per-service recipes exist; no generic
  framework). *Note: a user-facing local `nbai` CLI is a 🚫 non-goal — the SDK/MCP half is fine.*
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

# NavBharatAI v3.0 — Roadmap to Lead All 35 Engine Categories

> **Goal:** take NavBharatAI v3.0 (AgentV3) from "differentiated challenger" to a genuine **Lead**
> across all 35 engine/ops categories measured in the 1,020-point honest comparison vs
> **Bolt.new, Lovable, Replit, v0 (Vercel), Firebase Studio** — the engine/ops layer only
> (UI/design is out of scope, as the admin scoped it).
>
> **Honesty stance (non-negotiable, per the constitution):** This is a *real* upgrade plan, not
> a wish-list. Every item names the actual files/services to build. Where a category **cannot be
> won by code alone** — community size, user base, uptime track-record, SOC2/ISO attestation,
> human-support scale — it is placed in **Bucket C** and treated as an honest long game: we build
> the *substrate* now and earn the badge over quarters. We will never paint a "Lead" on something
> that is not really led. That would break the second absolute rule (no fake features) and the
> third (no sycophancy).
>
> **Scoring vocabulary:** `L` = leads all 5 rivals · `Y` = strong/fully-capable but a rival leads
> · `P` = partial/behind · `N` = absent. "Winning" a dimension = moving it to a true `L`.

---

## 0. The three buckets

All 35 categories sorted by how a Lead is actually earned. `#gap` = dimensions not yet at `L`.

| # | Category | Bucket | #gap | Headline move to Lead |
|---|----------|--------|------|-----------------------|
| 1 | AI model & routing | **A — Defend** | 2 | Already 6/8 `L`; lock with tests, ship model-registry defence |
| 2 | Code quality & safety gates | **A — Defend** | 3 | 2 `L`; promote security-scan + tsc gate to best-in-class |
| 3 | Memory & self-learning | **A — Defend** | 3 | 3 `L` (unique); extend brain to team scope |
| 4 | Diagnostics & observability | **A — Defend** | 2 | 2 `L`; make history + telemetry best-in-class |
| 5 | Cost & pricing model | **A — Defend** | 2 | 2 `L` (unique cheap-first+judge); surface cost UI |
| 6 | Self-awareness & guidance | **A — Defend** | 1 | 1 `L` (AppKnowledgeBase); promote Doctor AI to `L` |
| 7 | Language & locale | **A — Defend** | 0 | 2/2 `L` — pure defence + regression locale tests |
| 8 | Billing, quotas & governance | **A — Defend** | 1 | 3 `Y`; add cost alerting → whole category `L` |
| 9 | Agent / build engine | **B — Engineer** | 7 | Determinism harness + promote review/heal to `L` |
| 10 | Model & agent depth (extra) | **B — Engineer** | 8 | Real context-compression + promote the 7 `Y` to `L` |
| 11 | Testing & CI | **B — Engineer** | 5 | Test-gen + lint/format gate in the build loop |
| 12 | Generated-app quality defaults | **B — Engineer** | 5 | SEO/PWA/a11y/test **by default**, not on-request |
| 13 | Performance & output quality | **B — Engineer** | 5 | Perf-budget + design-lint hard gates |
| 14 | Backend & data | **B — Engineer** | 4 | **Provisioning Broker** (BYO DB/auth one-click) |
| 15 | App capabilities it can build | **B — Engineer** | 8 | Verified recipes: payments/email/realtime/storage/search |
| 16 | Data & migration | **B — Engineer** | 4 | Migration/seed/backup engine on user's own DB |
| 17 | Storage, env & config | **B — Engineer** | 3 | Multi-environment config store |
| 18 | Deploy targets | **B — Engineer** | 3 | **Deploy Broker** — real multi-provider + custom domain |
| 19 | Deploy extras | **B — Engineer** | 4 | Preview-deploy, env promotion, 1-click share, rollback |
| 20 | Monitoring & operations | **B — Engineer** | 5 | Prod error-tracking + log retention + rollback |
| 21 | Framework & language support | **B — Engineer** | 5 | APK pipeline + broaden first-class templates |
| 22 | Framework extras | **B — Engineer** | 5 | SSR/SSG + edge functions/cron templates |
| 23 | Import / export / portability | **B — Engineer** | 4 | Full git ops (branch/PR/history) to match Replit |
| 24 | Developer experience (engine) | **B — Engineer** | 6 | CLI + promote terminal/search/rewind to `L` |
| 25 | Automation & API | **B — Engineer** | 3 | **Public API + headless build service** |
| 26 | Collaboration & versioning | **B — Engineer** | 3 | Deep rewind/history to beat Replit multiplayer |
| 27 | Sandbox / runtime | **B/C — Engineer+scale** | 6 | Warm-pool kills cold-start; match persistent VM |
| 28 | Preview | **B — Engineer** | 4 | Preview reliability SLO + dual-path guard |
| 29 | Extensibility & ecosystem | **B/C — Engineer+community** | 4 | MCP-out + plugin SDK (breadth); marketplace = C |
| 30 | Security, privacy & compliance | **B/C — Engineer+audit** | 5 | Audit/RBAC/redaction `L`; SOC2 attestation = C |
| 31 | Compliance, privacy & governance | **B/C — Engineer+audit** | 5 | Residency/audit-log/RBAC/SSO build; SOC2 = C |
| 32 | Onboarding, docs & support | **B/C — Engineer+community** | 4 | Docs+gallery engine; human/community support = C |
| 33 | Reliability & scale | **C — Structural** | 4 | Autoscale is code; *uptime record* needs time |
| 34 | Track record & momentum | **C — Structural** | 2 | Age/user-base earned, not shipped |
| 35 | Maturity, support & trust | **C — Structural** | 5 | SLA/community/human-support earned over quarters |

**Tally:** Bucket A = 8 (defend the lead) · Bucket B = ~19 (winnable by real engineering) ·
Bucket C = ~8 categories carrying dimensions that code cannot buy outright (several straddle B/C).

The blunt truth up front: **we can realistically make ~27 of 35 categories a true Lead by
engineering.** The remaining dimensions (uptime track-record, user base, SOC2 badge, community
size, human-support scale, an enforceable SLA) require *time, users, an auditor, and a team* — not
a PR. Section 4 states exactly which, and the substrate we build now so the badge becomes
inevitable rather than fake.

---

## 1. Foundation workstreams (deduped cross-cutting infra)

The 35 categories collapse into **10 shared foundations**. Each is built once and lifts many
categories at once — this is where the real DNA-level leverage is. All respect the hard
constraint: **user apps run on the USER's own accounts (BYO); NavBharatAI never provisions on its
own billing, and no BYOK Anthropic key is (re)introduced.**

### F1 — Provisioning Broker (BYO, user-owned)
One service that, using the **user's own** Supabase/Firebase/Neon credentials, one-click
provisions a database + auth + storage bucket and writes the honest env vars back into the
project.
- **Build:** `src/server/provisioning/ProvisioningBroker.ts` + provider adapters
  (`SupabaseAdapter.ts`, `FirebaseAdapter.ts`, `NeonAdapter.ts`); a `/api/provision` route;
  a "Connect your data" UI wired to the existing connections flow; AppKnowledgeBase entry.
- **Constraint proof:** broker holds only the *user's* keys (already the BYO model); NavBharatAI's
  `gen-lang-client-0866594388` project is never used for user data.
- **Unlocks:** Backend&data (DB provisioning, auth), App capabilities (storage/uploads, realtime,
  search), Data&migration (import DB, seed).

### F2 — Deploy Broker (multi-target, user-owned)
Real one-click deploy to **Vercel / Netlify / Cloudflare Pages / Firebase Hosting** using the
user's tokens, plus custom-domain wiring, preview-deploy-per-branch, staging→prod promotion,
one-click share URL, and rollback.
- **Build:** `src/server/deploy/DeployBroker.ts` + `VercelTarget.ts`/`NetlifyTarget.ts`/… ;
  extend the honest "coming soon" states in `GitPanel.tsx`/deploy UI into real target cards;
  `/api/deploy/:target`, `/api/deploy/rollback`. Keep the existing "won't fake it" honesty for any
  target not yet wired.
- **Unlocks:** Deploy targets, Deploy extras, Monitoring (rollback), Storage (multi-env).

### F3 — Prod Observability Pipeline (into generated apps)
Optionally inject error-tracking + log drain into the *generated* app (user's own Sentry/GCP
project), wire health checks, log retention, and cost alerting.
- **Build:** `src/server/observability/ObservabilityInjector.ts`; a scaffold snippet added by the
  App Scaffold engine (F5); `AgentV3CostTelemetry.ts` gains threshold alerts.
- **Unlocks:** Monitoring & operations (prod error tracking, log retention), Billing (cost
  alerting).

### F4 — Deterministic Build Harness
Pin provider + model + temperature + seed per build, snapshot lockfiles, and emit a signed build
manifest so the *same prompt → same output*. Also home for the lint/format gate and test-scaffold
step.
- **Build:** `src/server/AgentV3/DeterministicBuild.ts` (records manifest to
  `workspace_diagnostics_v3`); a "reproduce this build" replay path; `LintGate.ts` beside the
  existing `TscGate.ts`.
- **Unlocks:** Agent/build engine (determinism), Testing&CI (lint/format, test-on-build),
  Generated-app quality (test defaults), Performance.

### F5 — App Scaffold Defaults Engine
Every generated app ships, **by default** (not on-request), with SEO/OG meta, a PWA manifest +
service worker, a11y defaults, the error boundary (already shipped), and a starter test.
- **Build:** extend `src/server/AgentV3/sandbox/AppMakerLab/generator/templates/`
  (`SeoDefaults.ts`, `PwaManifest.ts`, `A11yDefaults.ts`, `StarterTest.ts`), wired into
  `ViteReactProvider.ts.getFiles()`.
- **Unlocks:** Generated-app quality defaults, Performance & output quality, and the "recipe"
  side of App capabilities.

### F6 — Public API + Headless Build Service
A REST/CLI surface to trigger and stream builds programmatically, with API keys and outbound
webhooks.
- **Build:** `src/server/routes/publicApi.ts` (`POST /api/v1/builds`, key auth via a new
  `api_keys` store), an `nbai` CLI (`packages/cli/`), reuse existing NDJSON streaming.
- **Unlocks:** Automation & API (public API, headless), Developer experience (CLI access).

### F7 — Teams / RBAC + Enterprise Substrate
Org/team model, roles, SSO/SAML, data-residency region selection, and an append-only platform
audit-log store.
- **Build:** `src/server/orgs/OrgStore.ts`, `Rbac.ts`, `SsoSaml.ts`; `platform_audit_v3`
  Firestore collection (append-only); region field on org config.
- **Unlocks:** Compliance (RBAC/teams, SSO, data residency, audit logging), Security (the SOC2
  *substrate* — the controls an auditor checks).

### F8 — Docs & Template Gallery Engine
A versioned docs site generated from `AppKnowledgeBase.ts` (single source of truth), plus a public
template gallery with a submission flow (this is also the seed that lets a community *start*).
- **Build:** `scripts/gen-docs-from-kb.ts` → static docs; `src/server/gallery/TemplateGallery.ts`
  + `template_submissions` store + moderation.
- **Unlocks:** Onboarding/docs (docs depth, examples), Extensibility (templates, community
  *substrate*), Maturity (template library).

### F9 — Warm-Pool / Autoscale Infra
A warm pool of Cloud Run instances (min-instances ≥ 1) and pre-warmed E2B sandboxes to kill cold
starts, plus autoscale config for many concurrent users.
- **Build:** `cloudbuild.yaml` + Cloud Run service config (min-instances, concurrency); sandbox
  warm-pool in `SandboxStore.ts` (reuse the pause/resume work already landed).
- **Unlocks:** Sandbox (cold-start), Reliability&scale (concurrent scale), Preview (reliability).
- **Honest note:** min-instances ≥ 1 costs money continuously — this is a real infra spend
  decision for the admin, not a free code change.

### F10 — Status Page + SLA Instrumentation
A public status page + uptime monitoring + incident history. This is the **substrate** that makes
an SLA *credible* once real uptime history accrues — it does not, by itself, create a track record.
- **Build:** `/api/health` deep checks, an external uptime monitor, a public `status.` page.
- **Unlocks (substrate only):** Maturity (SLA becomes possible), Reliability (uptime record starts
  accumulating). The *record itself* is Bucket C — earned by running well for months.

---

## 2. Phased execution plan

Ordered by dependency and impact: quick engine wins first, then the foundations that unlock the
most categories, then the honest long game. Each phase follows the mandatory cycle
(branch → verify gate → PR → CI green → merge) and each item's **exit criterion is a real proof**,
never a claim.

### Phase 0 — Defend the lead (Bucket A) · effort S
Lock the 8 leading categories so no regression silently loses a Lead.
- Regression tests for routing/judge/escalation, readiness gate, self-learning lessons, diagnostics
  report, cost caps, locale, AppKnowledgeBase completeness.
- **Exit:** `vitest` suite asserts each `L` behaviour; CI fails if a lead regresses.

### Phase 1 — Quick engine wins · effort S–M · unlocks 9,10,11,12,13,8
F4 (Deterministic harness + lint gate + test-on-build), F5 (scaffold defaults: SEO/PWA/a11y/test),
context-compression in the agent loop, cost alerting.
- Moves to `L`/`Y`: determinism, lint/format, unit-test scaffolding, SEO/PWA/a11y defaults,
  context compression, cost alerting, and promotes the many `Y` dims in Agent-depth to `L`.
- **Exit:** same prompt reproduces byte-stable manifest twice; a fresh build ships with passing
  starter test + Lighthouse SEO/PWA/a11y ≥ 90 with no user request.

### Phase 2 — Provisioning Broker (F1) · effort L · unlocks 14,15,16
BYO one-click DB + auth + storage; migration/seed/backup on the user's own DB.
- Moves to `L`/`Y`: DB provisioning, auth, file storage/uploads, realtime, search recipes,
  schema-migration, seed, import-existing-DB — all on the **user's** account.
- **Exit:** from a prompt, a real Supabase/Firebase project (user's) is provisioned and the built
  app reads/writes it live; NavBharatAI billing untouched (proven in logs).

### Phase 3 — Deploy Broker + Observability (F2 + F3) · effort L · unlocks 18,19,20,17
Real multi-target deploy, custom domain, preview-per-branch, env promotion, rollback, prod
error-tracking, log retention, multi-environment config.
- **Exit:** one click deploys the built app to a chosen provider on the user's account, on a custom
  domain, with a working rollback and a live error dashboard.

### Phase 4 — Warm-pool / Autoscale (F9) · effort M · unlocks 27,33(partial),28
Kill cold starts; handle concurrent users; raise preview reliability to an SLO.
- **Exit:** p95 cold-start < 2s; N concurrent builds sustained in a load test; preview success-rate
  SLO tracked and met.

### Phase 5 — Public API + Headless + CLI (F6) · effort M · unlocks 25,24
- **Exit:** `nbai build "…"` from a terminal produces the same app headlessly; API key auth +
  outbound webhook verified end-to-end.

### Phase 6 — Teams/RBAC + Enterprise substrate (F7) · effort L · unlocks 30,31 (code parts)
Org/roles, SSO/SAML, region selection, platform audit-log.
- **Exit:** a second user joins an org with a scoped role; every privileged action lands in the
  append-only audit log; region choice honoured.

### Phase 7 — Docs & Template Gallery (F8) · effort M · unlocks 32,29 (code parts),35 (library)
- **Exit:** docs site auto-generated from AppKnowledgeBase and deployed; a user submits a template
  that appears in the gallery after moderation.

### Phase 8 — Framework breadth (21,22,23,26) · effort M–L
APK pipeline (Capacitor build → signed APK), SSR/SSG + edge/cron templates, full git ops, deep
rewind/history.
- **Exit:** an APK artifact downloads and installs; an SSR template deploys; branch/PR/history ops
  match the Replit baseline in a side-by-side.

### Phase 9 — The honest long game (Bucket C) · ongoing, quarters
F10 status page + SLA instrumentation; begin a SOC2 Type I engagement on the F7 substrate; run the
gallery + docs to grow a real community; accumulate uptime history.
- **Exit (honest):** these flip to `L` only when the *evidence* exists — 90+ days of uptime, an
  auditor's report, a real user/community count. We ship the substrate; the badge is earned.

---

## 3. Category-by-category detail (all 35)

Format: `dim: currentTier → realistic target · the real move`. Already-`L` dims get a one-line
"defend" note. Honest downgrades (target `Y`, not `L`) are stated plainly.

### Bucket A — defend (already leading)

**1. AI model & routing** — *North-star: the smartest, most resilient model layer in the field.*
6/8 already `L` (5-provider failover, cost-first, Sonnet judge, repair-not-rebuild, transparency).
- Power/Opus mode: `Y → L` · expose per-build model/effort picker (`powerLevel.ts`) with honest
  cost preview.
- BYO model key: `N` — **intentionally not built** (admin removed BYOK; do not reintroduce). Not a
  gap; document the decision so it never re-opens.
- Defend: lock routing/judge/escalation with regression tests.

**2. Code quality & safety gates** — 2 `L` (readiness gate, no-fake-success). Promote security-scan
and tsc-gate from `Y → L` by making them the strictest in the field (SAST rules + supply-chain
check in `TscGate`/a new `SecurityGate.ts`). Error-boundary already `Y`/default.

**3. Memory & self-learning** — 3 `L` and essentially unique (learns from reports *and* failures,
per-user brain). Extend the brain to **team scope** (with F7) to widen the moat. Defend with lesson
regression tests.

**4. Diagnostics & observability** — 2 `L` (full report, ranked root-cause). Promote whole-session
history + cost/token telemetry `Y → L` with a diff-across-builds view. Nobody else surfaces this
depth — make it visibly best.

**5. Cost & pricing model** — 2 `L` (cheap-first+judge, BYO-enforced). Promote transparent
per-build cost `Y → L` by surfacing a live cost gauge in the UI (reads `UserCostStore`).

**6. Self-awareness & guidance** — 1 `L` (AppKnowledgeBase). Promote Doctor AI `Y → L`: let it read
the build report + diagnostics to self-diagnose the *user's* app end-to-end.

**7. Language & locale** — 2/2 `L`. Pure defence: locale regression tests so Hindi/Hinglish native
handling never regresses.

**8. Billing, quotas & governance** — 3 `Y`. Add **cost alerting** (`P → L`, via F3) → the whole
category is `L` (per-user cap, per-build cap, rate-limit, alerts all best-in-class).

### Bucket B — winnable by engineering

**9. Agent / build engine** — 1 `L` (auto-fix reviewer). The 5 `Y` (multi-agent, planning,
tool-use, incremental edits, review, heal) → `L` by making each demonstrably deepest (e.g. reviewer
runs security+perf+a11y lenses). **Determinism `P → L`** via F4. This is the crown category —
target a clean sweep to `L`.

**10. Model & agent depth (extra)** — 7 `Y` + context-compression `P`. Real context-compression
engine (`ContextCompressor.ts`: semantic summar, file-relevance ranking) `P → L`; promote caching,
thinking-mode, sub-agent parallelism, streaming, retry, output-cap to `L` as a documented,
tested, best-in-field set.

**11. Testing & CI** — CI-gen + auto-test-on-build already `Y`. **Unit-test scaffolding `P → L`**
and **E2E `P → Y`** via F4 + F5 (generate Vitest + Playwright specs with the app); **lint/format
`P → L`** via `LintGate`.

**12. Generated-app quality defaults** — error-boundary `L`. SEO/PWA/a11y/test-scaffold `P → L`
via **F5 defaults** (shipped by default, not on request). Responsive `Y → L` with a mobile-first
template baseline.

**13. Performance & output quality** — all `Y` today (rivals lead on 3). Add a **perf-budget gate**
(bundle-size ceiling) and a **design-consistency lint** as hard gates → SEO/perf/design `Y → L`.

**14. Backend & data** — data-ownership `L`. DB provisioning + auth `P → L` and server-API/secrets
`Y → L` via **F1 Provisioning Broker** (user-owned), + a secrets vault UI.

**15. App capabilities** — i18n `L`. Payments/email/realtime/search/storage `P → L` via **verified
recipe modules** (Stripe, Resend/FCM, WebSocket/Firestore-RT, pg/Meili search, user-storage) that
are generated *and* smoke-tested. Charts/maps `Y → L` with curated best-in-class libs.

**16. Data & migration** — all `P`. Migration/seed/backup/import-DB `P → L` via a
`DataToolkit.ts` operating on the **user's** DB (Prisma/Drizzle migrations, seed scripts, scheduled
backups).

**17. Storage, env & config** — env-mgmt/config-validation/durable-store `Y`. **Multi-environment
`P → L`** via F2 (dev/staging/prod config sets). Promote the `Y`s to `L` with an encrypted vault.

**18. Deploy targets** — honesty `L`. 1st-party hosting + multi-provider + custom-domain `P → L`
via **F2 Deploy Broker** (keep honest "coming soon" for any not-yet-wired target).

**19. Deploy extras** — liveness-check `Y`. Preview-deploy/env-promotion/share-URL `P → L` via F2.

**20. Monitoring & operations** — runtime-capture + health `Y`. Prod-error-tracking/rollback/
log-retention `P → L` via **F3 + F2**.

**21. Framework & language support** — React/Next/Vue/Python all `Y`. **Mobile APK `P → L`** via a
Capacitor build pipeline (signed APK artifact). Promote the `Y`s to `L` by making each template the
most complete.

**22. Framework extras** — Tailwind/shadcn/TS `Y`. **SSR/SSG `P → L`** (real Next template) and
**edge/cron `P → L`** (edge-function + scheduler templates via F2 targets).

**23. Import / export / portability** — all `Y`. Full git ops (branch/PR/history/rebase in
`GitPanel` + server) `Y → L` to match Replit's git depth.

**24. Developer experience (engine)** — 5 `Y`, CLI `N`. **CLI access `N → L`** via **F6**; promote
terminal/file-tree/search/HMR/rewind to `L` by closing the small gaps vs Replit's IDE.

**25. Automation & API** — webhooks `Y`. **Public API `N → L`** and **headless `P → L`** via **F6**.

**26. Collaboration & versioning** — all `Y` (live collab is Firestore-backed). Deep rewind +
full history timeline `Y → L` to beat Replit's multiplayer/history.

**27. Sandbox / runtime** — memory/long-running/VM `Y`. **Cold-start `P → L`** via **F9 warm-pool**;
warm-resume `Y → L` (build on landed pause/resume). *Always-on persistent VM parity with Replit is
partly an infra-spend decision — see F9 honest note.*

**28. Preview** — managed/in-browser preview `Y`. **Reliability `P → L`** by setting a preview
success-rate SLO, the dual-path (E2B + in-browser CDN-fallback) already shipped, plus F9.

**29. Extensibility & ecosystem** — templates `Y`. **MCP/tool extensibility `P → L`** (expose an
MCP-out interface + plugin SDK); plugins-breadth `P → Y`. *Community/marketplace `N` is Bucket C —
F8 builds the substrate, the marketplace fills over time.*

**30. Security, privacy & compliance** — RBAC/audit/redaction/injection `Y` (redaction `L` in the
extra compliance category). Promote to `L` with SAST + signed audit log. **SOC2 posture `P`: the
controls are code (F7 substrate) but the attestation is Bucket C.**

**31. Compliance, privacy & governance** — secret-redaction `L`. Data-residency/audit-logging/
RBAC-teams/SSO `P/N → L` via **F7**. **Formal SOC2/ISO `N`: substrate now, attestation = Bucket C.**

**32. Onboarding, docs & support** — onboarding `Y`. Docs-depth + examples `P → L` via **F8**.
*Human/community support `N` = Bucket C.*

### Bucket C — structural (see Section 4 for the honest treatment)

**33. Reliability & scale** — graceful-failure `Y`; autoscale/scale is code (**F9**), but
**uptime-track-record `P` and infra-maturity are earned over time**, not shipped.

**34. Track record & momentum** — iteration-velocity `L` (daily ships — genuinely ours).
**Age/battle-testing `P` and user-base `N` are earned, not built.**

**35. Maturity, support & trust** — template-library `P → Y` (F8). **SLA/community-size/
human-support `N` require F10 substrate + time + a team.**

---

## 4. The honest reality — what code cannot buy

These dimensions will **not** flip to `L` from a PR. Claiming otherwise would be a fake feature.
For each: why, the real path, and the substrate we build **now** so the badge becomes inevitable.

| Dimension (category) | Why not code-alone | Substrate we build now | When it truly leads |
|---|---|---|---|
| Uptime track-record (Reliability) | Needs months of measured 99.9%+ | **F10** status page + uptime monitor starts the clock | After ~90+ days of clean history |
| Handles-scale *proven* (Reliability) | Load-tested ≠ battle-tested at real volume | **F9** autoscale + load tests | When real traffic proves it |
| Age / battle-testing (Track record) | Literally time | Keep shipping; changelog | Over quarters |
| User base (Track record) | Needs real users | F8 gallery/docs + F1/F2 lowering friction | Growth, not a commit |
| Formal SOC2 / ISO (Security/Compliance) | Requires an external auditor + a control period | **F7** RBAC + append-only audit log + SSO = the exact controls an auditor checks | After a SOC2 Type I/II engagement |
| SLA / uptime guarantee (Maturity) | An SLA is only credible with history + a team to honour it | **F10** instrumentation | Once uptime history + support exist |
| Community size (Maturity/Extensibility) | People, not code | **F8** template submissions + docs give a community a *place to exist* | Organic growth |
| Human support / SLA response (Maturity) | Needs staffed humans | A ticket/status surface | When a support function exists |

**Blunt admin note:** roughly **8 dimensions across 3–4 categories are honestly not winnable by
engineering in this cycle.** That is not a failure of the plan — it is the plan being truthful. We
build the substrate (F7, F8, F9, F10) so that when time and users arrive, the Lead is *earned and
provable*, not painted on.

---

## 5. Sequenced milestones & definition of done

Each milestone ends in a **verifiable proof** (the "Preview is EARNED" rule applied to the whole
roadmap). Nothing is "done" on a claim.

- [ ] **M0 — Lead locked.** Regression suite green for all 8 Bucket-A categories; CI fails on any
  lead regression.
- [ ] **M1 — Reproducible builds.** Same prompt → identical build manifest twice (F4).
- [ ] **M2 — Quality by default.** A no-request build ships passing starter test + SEO/PWA/a11y ≥ 90
  (F5).
- [ ] **M3 — Real data.** Prompt → provisions the *user's* DB/auth/storage; app reads/writes it
  live; NavBharatAI billing untouched in logs (F1).
- [ ] **M4 — Real deploy.** One click → live on user's Vercel/Netlify/Firebase, custom domain,
  working rollback + error dashboard (F2+F3).
- [ ] **M5 — No cold start.** p95 cold-start < 2s; concurrent load test sustained (F9).
- [ ] **M6 — Headless.** `nbai build "…"` reproduces the app from a terminal; API+webhook verified
  (F6).
- [ ] **M7 — Teams & controls.** Second user joins an org with a scoped role; every privileged
  action in the append-only audit log; region honoured (F7).
- [ ] **M8 — Docs & gallery live.** Docs auto-generated from AppKnowledgeBase and deployed; a
  submitted template appears after moderation (F8).
- [ ] **M9 — Breadth.** APK artifact installs; SSR template deploys; git ops match Replit baseline.
- [ ] **M10 — Honest long game underway.** Status page live; SOC2 engagement started on F7
  substrate; uptime clock running. *(These flip to `L` only when the evidence exists.)*

**Definition of done for a category's Lead:** a side-by-side against all 5 rivals on that
category's dimensions where NavBharatAI is demonstrably best or tied-best on every dimension that is
code-winnable — proven by a test, a benchmark, or a recorded demo, never by assertion. Every new
user-facing surface introduced by this roadmap **must** add its `AppKnowledgeBase.ts` entry in the
same PR (the app-self-awareness law).

---

*This roadmap is deliberately honest: ~27 categories are a realistic engineering Lead; the rest
carry dimensions earned only with time, users, and an auditor. We build the substrate now so those
become provable, never faked. — for the admin, no sycophancy.*

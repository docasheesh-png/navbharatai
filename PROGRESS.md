# NavBharatAI Pro → Real App Maker — Execution Progress

> ## ▶ RESUME HERE (read this first, every new session)
> **Goal:** world-best AI app maker. **Rules:** real (no hacks) • app NEVER breaks •
> zero bugs before push • commit+push every green milestone • keep this file updated.
> **Branch:** `claude/kind-lovelace-chcxp6` · **PR:** #2 (push = auto-updates it).
>
> **How to resume (do this automatically, no need to ask the user):**
> 1. `npm install` if `node_modules` missing.
> 2. Find current state below (latest Milestone). We are mid **Phase 1** (breaking
>    the `server.ts` monolith into `src/server/routes/*` + `src/server/lib/*`).
> 3. Pick the next un-extracted route group from "NEXT STEPS" and extract it using
>    the established pattern: create `registerXxxRoutes(app, deps)`, replace the
>    inline block in `server.ts` with the call + import, share state via existing
>    libs (`getDb`, `audit`, `serverStats`, `getSecretValue`, `verifyPaymentInternal`).
> 4. VERIFY before every push: `npx esbuild server.ts --bundle --platform=node
>    --format=cjs --packages=external --outfile=/tmp/s.cjs` (exit 0) +
>    `npx tsc --noEmit` (0 errors) + `npx vitest run` (pass). Only then commit+push.
> 5. Update this file, commit, push. Repeat. Don't stop until all 6 phases + the
>    final re-audit loop are done.
>
> **▶ AI-CORE EXTRACTION SUB-PLAN (the remaining server.ts work — do in THIS order, one green+push per step):**
> The last ~13 routes (`chat/*`, `/api/chat`, `pro-chat`, `pro-build`, `sda-chat`,
> `security/scan`, `audit/full`) are coupled to IIFE closures. Extract bottom-up:
> a. **AI clients + key resolution** → `src/server/lib/aiClients.ts`: move the lazy
>    `geminiClient`/`groqClient`/`deepseekClient`/`openaiClient`/`openrouterClient`
>    singletons, `isPlaceholder` (~295), `resolveApiKey` (~315). Export getters; import back.
> b0. **PROMPTS LAYER FIRST** → add to `src/server/lib/prompts.ts`: move the huge
>    `NAVBHARAT_OS_V2` system-prompt const (server.ts ~286–691, ~405 lines) + context
>    builders using it: `getBharatContext` (~693–713) and siblings (more
>    `return \`${NAVBHARAT_OS_V2}...\`` builders ~730/748/1060). Export; import back.
> b. **AI call functions** → `src/server/lib/aiCalls.ts`: `callGemini`/`callGroq`/`callDeepSeek`
>    /`callOpenAI`/`callClaude`/`callOpenRouter` (server.ts ~1077–1254) + `generateOfflineResponse`
>    (~1256). Use aiClients getters + `resolveApiKey` + `getBharatContext` (from prompts).
>    NOTE: `callClaude` also uses `OpenAI` SDK directly for the ANTHROPIC_BASE_URL proxy path.
> c. **chatHandler** (~2674) → `routes/chat.ts` (`registerChatRoutes(app, chatLimiter)`)
>    hosting `/api/chat/*` + `/api/chat`. Depends on aiCalls + db + serverStats.
> d. **pro-chat + pro-build** → `routes/pro.ts` (Pro engine; biggest — pulls in AppEngine/
>    AppMakerLab; do carefully, can split chat vs build).
> e. **sda-chat** → `routes/sda.ts`; **security/scan + audit/full** → `routes/audit.ts`.
> f. Leave `app.get('*')` SPA catch-all + `/api/health` + bootstrap in server.ts (<300 lines).
> Verify each step (esbuild + tsc 0 + vitest) before push. `getSecurityContext` already in `lib/prompts.ts`.
>
> **▶ NEXT STEPS (in order):**
> 1. Extract remaining server.ts route groups: **github OAuth** (`/api/auth/github*`),
>    **firebase auth** (`/api/auth/firebase*`), **security/scan + audit/full**,
>    **create-order** (Cashfree SDK), and the BIG one — **chat handler + `/api/chat` +
>    `/api/pro-chat` + `/api/pro-build` + `/api/sda-chat`** (~2,500 lines, the Pro
>    engine; extract carefully into `routes/chat.ts`, `routes/pro.ts`, `routes/sda.ts`
>    with services in `src/server/services/`).
> 2. Shrink `server.ts` to a thin bootstrap (<300 lines); add `tsconfig.server.json`;
>    enable strict TS per-module (burn down the 539-error frontend debt too); flip
>    global `strict:true`.
> 3. Then **Phase 2** (real project model/VFS/versioning) → **Phase 3** (hybrid
>    WebContainer + server-container runtime; kill iframe+CDN hack; real PreviewRunner;
>    replace fake BuildEngine/CodeGenerator) → **Phase 4** (diff-edit + agentic
>    generation + real auto-repair) → **Phase 5** (deploy, Pro-gating, integrated IDE,
>    QA, observability). See plan file for full step list.
> 4. **Final re-audit loop:** re-audit from 0; any new problems → new phases → fix → push.
>
> **⚠️ User action still pending:** rotate the legacy Google API key (now in
> `LEGACY_EMBEDDED_API_KEY`, git history) and set it via env.

Roadmap: 6 phases (0–5), then a full re-audit loop. Working branch: `claude/kind-lovelace-chcxp6`.
Rules: real (no hacks) • app never breaks • zero bugs before push • resume from here next cycle.

Each phase: complete → `tsc --noEmit` + tests + build green → push → next.

---

## ✅ PHASE 0 — Cleanup & Safe Foundation — **DONE** (2026-06-14)
- **Junk removed**: `open/close/*_braces/div_*/results/another-file/test-memory/test-persistence` txt files; root debug scripts (`whereami, trace_identity, debug_jobs, log_test, diagnostic_audit, ab_test, verify_key, jsx_analyzer`); root ad-hoc `test_*.ts` (7 files); `src/server/find_path.ts`; `Backup/`; `DRAFT_firestore.rules`; broken `WorkspaceManager.test.{js,ts}`.
- **Secret centralized**: hardcoded Google API key (3 inline spots in `server.ts`) → single `LEGACY_EMBEDDED_API_KEY` const, env-overridable.
  - ⚠️ **ACTION REQUIRED (user)**: this key is in git history and may be live — **rotate it in Google Cloud** and set `GEMINI_API_KEY` / `LEGACY_EMBEDDED_API_KEY` via env.
- **Test infra**: added `vitest`, `vitest.config.ts`, `tests/smoke.test.ts`, `test`/`typecheck` scripts.
- **CI**: `.github/workflows/ci.yml` (install → typecheck → test on push/PR).
- **Verification**: `tsc --noEmit` = 0 errors • tests pass • `vite build` ✅ • server esbuild bundle ✅.

### Carried-over debt (intentional, scheduled)
- **Strict TypeScript NOT yet globally on.** Full `strict` = **539 frontend errors** (400 implicit-any params `TS7006`, 117 null-guards `TS18047`, 22 real type bugs `TS2322/2769/2537/7031`). Kept `strict:false` to stay green & not break the app. **Plan: enable strict module-by-module during Phase 1** as the god-file is split into small typeable files, then flip global `strict:true`.
- `src/server` is still excluded from typecheck → addressed in Phase 1 (server tsconfig).

---

## 🔄 PHASE 1 — Break server.ts god-file (IN PROGRESS)
6,598 lines / 71 routes, all inside one giant `(async () => {...})()` IIFE.
Strategy: extract self-contained route groups into `src/server/routes/*.ts` as
`registerXxxRoutes(app, deps)`, one green milestone at a time (no behavior change).

- **Milestone 1.1 — DONE (2026-06-14)**: Extracted 4 PWA routes (`/api/pwa/save`,
  `/pwa/:id`, `/pwa/:id/manifest.json`, `/pwa/:id/sw.js`) → `src/server/routes/pwa.ts`
  (`registerPwaRoutes(app, pwaStore)`, new module is fully strict-typed). Removed
  dead `estimateTokens()`. Verified: server esbuild bundle ✅, module strict tsc ✅,
  frontend tsc 0 ✅, tests ✅.
- **Milestone 1.2 — DONE (2026-06-14)**: Extracted 3 self-contained routes
  (`/api/analyze/pagespeed`, `/api/logs/error`, `/api/analytics/event`) →
  `src/server/routes/telemetry.ts`. server.ts routes 71 → 64. Verified green.
- **Milestone 1.3 — DONE (2026-06-14)**: Extracted shared `audit()` logger →
  `src/server/lib/audit.ts` (with unit tests), and team route → `routes/team.ts`.
  server.ts routes 64 → 63. Verified green.
- **Milestone 1.4 — DONE (2026-06-14)**: Added shared Firestore accessor
  `src/server/lib/db.ts` (`setDb`/`getDb`); server bootstrap now shares the handle.
  Extracted 3 wallet read routes → `src/server/routes/wallet.ts`. routes 63 → 60.
  Verified green (server bundle, wallet+db strict tsc clean, frontend tsc 0, tests).
- **Milestone 1.5 — DONE (2026-06-14)**: Extracted encryption/secret helpers
  (`encrypt`/`decrypt`/`getSecretValue`) → `src/server/lib/secrets.ts`, and secrets
  CRUD routes → `src/server/routes/secrets.ts`. routes 60 → 57. Verified green.
- **Milestone 1.6 — DONE (2026-06-14)**: Extracted shared `serverStats` singleton
  → `src/server/lib/serverStats.ts`, and the entire admin dashboard (12 routes +
  HMAC `verifyAdminToken` middleware) → `src/server/routes/admin.ts`. routes 57 → 45.
  Verified green (server bundle, admin+serverStats strict tsc clean, frontend tsc 0, tests).
- **Milestone 1.7 — DONE (2026-06-14)**: Extracted cloud sync routes
  (`GET/POST /api/sync/:userId`) + `slimSession`/`WORKSPACE_MAX_BYTES` →
  `src/server/routes/sync.ts`. routes 45 → 43. Verified green. (Lossy slimming
  noted for Phase 2 redesign.)
- **Milestone 1.8 — DONE (2026-06-14)**: Extracted `verifyPaymentInternal`
  (Cashfree verify + wallet-credit, ~170 lines) → `src/server/lib/payments.ts`.
  server.ts 6598 → 5719 lines. Verified green. (Payment ROUTES next.)
- **Milestone 1.9 — DONE (2026-06-14)**: Extracted 5 payment routes (create-order,
  verify-payment, webhook, verify-redirect, redeem-coupon) → `src/server/routes/payment.ts`
  (`registerPaymentRoutes(app, paymentLimiter)`). routes 43 → 38; server.ts 5719 → 5393.
  Verified green (server bundle, payment strict tsc clean, frontend tsc 0, tests).
- **Milestone 1.10 — DONE (2026-06-15)**: Extracted 5 self-contained GitHub
  data-API routes (fetch, file, branches, push, push-enhanced) →
  `src/server/routes/github.ts`. routes 38 → 33; server.ts 5393 → 5088.
  Verified green. (GitHub OAuth url/callback + cloudsync still inline — next.)
- **Milestone 1.11 — DONE (2026-06-15)**: Extracted 3 cloud-sync provider routes
  (`/api/cloudsync/{github,firebase,vercel}`) → `src/server/routes/cloudsync.ts`.
  routes 33 → 30; server.ts 5088 → 5019. Verified green. (Firebase/Vercel are
  static mocks — flagged for Phase 5.)
- **Milestone 1.12 — DONE (2026-06-15)**: Extracted 3 AppMaker telemetry/job
  routes (`/api/appmaker/executions`, `/executions/:id`, `/jobs/:jobId`) →
  `src/server/routes/appmaker.ts`. routes 30 → 27; server.ts 5019 → 4968 (<5k!).
  Verified green.
- **Milestone 1.13 — DONE (2026-06-15)**: Extracted OTP anti-spam gateway
  (`POST /api/auth/send-otp` + its state maps/type) → `src/server/routes/auth.ts`.
  routes 27 → 26; server.ts 4968 → 4883. Verified green. (GitHub/Firebase OAuth
  routes still inline — next.)
- **Milestone 1.14 — DONE (2026-06-15)**: Extracted Anthropic streaming proxy
  (`POST /api/anthropic`, Pro/VIP-gated) → `src/server/routes/anthropic.ts`.
  routes 26 → 25; server.ts 4883 → 4846. Verified green.
- **Milestone 1.15 — DONE (2026-06-15)**: Extracted GitHub OAuth routes (authorize
  url, redirect, token-exchange callback, user profile) → `src/server/routes/githubAuth.ts`.
  routes 25 → 21; server.ts 4846 → 4639. Verified green.
- **Milestone 1.16 — DONE (2026-06-15)**: Extracted Firebase auth (mock) flow
  (`/api/auth/firebase`, `/consent`, `/callback`) → `src/server/routes/firebaseAuth.ts`.
  routes 21 → 18; server.ts 4639 → 4270. Verified green. (Mock flow — flagged Phase 5.)
- **Milestone 1.17 — DONE (2026-06-15)**: Moved `/api/github/repos` into
  `routes/githubAuth.ts`, and extracted legacy `/api/create-order` (Cashfree
  PGCreateOrder) → `src/server/routes/createOrder.ts`. routes 18 → 16; server.ts
  4270 → 4220. Verified green.
- **Milestone 1.18 — DONE (2026-06-15)**: Moved `/api/admin/login` into
  `routes/admin.ts` (`registerAdminRoutes(app, adminLimiter)`). routes 16 → 15;
  server.ts 4220 → 4188. Verified green.
- **Milestone 1.19 — DONE (2026-06-15)**: Extracted ZIP import/export routes
  (`/api/extract-zip` SSE, `/api/download-zip`) → `src/server/routes/zip.ts`.
  routes 15 → 13; server.ts 4188 → 3979 (<4k!). Verified green. Remaining in
  server.ts: the coupled AI core (chat/* , /api/chat, pro-chat, pro-build,
  sda-chat, security/scan, audit/full) + SPA catch-all/health.
- **Milestone 1.20 — DONE (2026-06-15)**: Extracted pure `getSecurityContext`
  prompt builder → `src/server/lib/prompts.ts`. server.ts 3979 → 3950. Verified green.
  (Remaining = coupled AI core; see AI-CORE EXTRACTION SUB-PLAN at top of this file.)
- **Milestone 1.21 — DONE (2026-06-15, AI-core step a)**: Extracted AI provider
  clients + key resolution (`LEGACY_EMBEDDED_API_KEY`, lazy client singletons,
  `isPlaceholder`, `resolveApiKey`, `hasKey`, `getGemini/getGroq/getDeepSeek/getOpenAI/
  getOpenRouter/getClaude`) → `src/server/lib/aiClients.ts`. Fixed a name collision
  (renamed the env-loader helper to `isEnvPlaceholder`). server.ts 3950 → 3803.
  Verified: esbuild bundle + `node --check` (no dup-decl) + actual load + tsc 0 + tests.
  NEXT AI-core step (b): callGemini/callGroq/callOpenAI/callOpenRouter → lib/aiCalls.ts.
- **Milestone 1.22 — DONE (2026-06-15, AI-core step b0 part 1)**: Moved the 405-line
  `NAVBHARAT_OS_V2` master system-prompt const → `src/server/lib/prompts.ts` (exported);
  server.ts imports it. server.ts 3803 → 3398. Verified bundle+node --check+tsc+tests.
  REMAINING b0: move the context builders (`getBharatContext` + siblings, server.ts
  ~285-660 region) into prompts.ts too, then step b (call* → lib/aiCalls.ts).
- **Milestone 1.23 — DONE (2026-06-15, AI-core step b0 COMPLETE)**: Moved all 5 mode/agent
  context builders (`getBharatContext`, `getApiKeysInstruction`, `getVishwakarmaBasicContext`,
  `getVishwakarmaProContext` [huge audit prompt], `getVishwakarmaVipContext`) → `lib/prompts.ts`
  (exported); server.ts imports them. server.ts 3398 → 3017. Verified bundle+load+tsc+tests.
  NEXT = step b: `call*` (6 fns, server.ts ~290-470 now) + `generateOfflineResponse` → `lib/aiCalls.ts`.
- **Milestone 1.24 — DONE (2026-06-15, AI-core step b)**: Extracted the 6 provider
  call functions (`callGemini/callGroq/callDeepSeek/callOpenAI/callClaude/callOpenRouter`)
  → `src/server/lib/aiCalls.ts` (uses aiClients + prompts). server.ts 3017 → 2841.
  Verified bundle+load+aiCalls strict tsc+tsc+tests. NOTE: `generateOfflineResponse`
  is HUGE (~886 lines, server.ts ~292-1178) — extract it as its own step (b2) →
  `lib/offlineResponse.ts` next, THEN step c (chatHandler) → routes/chat.ts.
- **Milestone 1.25 — DONE (2026-06-15, AI-core step b2)**: Extracted the huge
  `generateOfflineResponse` (~886 lines, offline fallback + templated mini-apps) →
  `src/server/lib/offlineResponse.ts` (self-contained). server.ts 2841 → 1956 (<2k!).
  Verified bundle+load+tsc+tests. NEXT = step c: `chatHandler` + routeRequest +
  `/api/chat/*` + `/api/chat` → `routes/chat.ts` (uses aiCalls + offlineResponse + db).
- **Next milestones**: extract remaining groups — admin (`/api/admin/*`),
  sync, payment, github, secrets, chat/pro-chat/pro-build/sda — each green+push.
  Then move shared helpers/limiters to modules, add server tsconfig, enable strict
  per extracted module (burn down the 539-error debt), shrink server.ts to bootstrap.

## ⏳ PHASE 2 — Real project model (VFS, persistence, versioning)
## ⏳ PHASE 3 — Real hybrid build/preview runtime (WebContainer + server containers)
## ⏳ PHASE 4 — Generation & editing engine (diff-edits, agentic loop, real auto-repair)
## ⏳ PHASE 5 — Product (deploy, Pro-gating, integrated IDE, QA, observability)
## ⏳ FINAL — Re-audit from 0; new problems → phases → fix → push, until clean.

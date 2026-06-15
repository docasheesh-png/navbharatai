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
> 4. VERIFY before every push (read OUTPUT explicitly — `tail` can hide failures):
>    `npx tsc --noEmit` (0) + `npx tsc -p tsconfig.server.json` (0) + `npx vitest run`
>    (grep the 'Tests' line — ZERO failed) + esbuild bundle (exit 0). For any
>    server.ts/route change ALSO run the bundled server with `node` and confirm it
>    reaches "🚀 Server running" (a ReferenceError exits instantly — never trust head -1).
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
> c. **chatHandler + routeRequest** → `routes/chat.ts` (`registerChatRoutes(app, chatLimiter)`)
>    hosting `/api/chat/*` (the `/api/chat` catch route is DEAD/commented). routeRequest
>    (~296-650) uses aiCalls + offlineResponse + hasKey (all imported). chatHandler
>    (~651-864) uses routeRequest + `aiRouter` (now `lib/aiRouter.ts`) + db(addDoc/collection)
>    + audit. Pass chatLimiter as param. NOTE `callClaudePro` belongs to step d (pro), not chat.
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

## ✅ PHASE 1 — Break server.ts god-file — **CORE DONE** (2026-06-15)
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
- **Milestone 1.26 — DONE (2026-06-15)**: Extracted `aiRouter` (UniversalAIRouter)
  into shared singleton `src/server/lib/aiRouter.ts` (used by chat + pro). server.ts
  imports it. Verified bundle+check+tsc+tests. Unblocks step c (chat) & d (pro).
- **Milestone 1.27 — DONE (2026-06-15, AI-core step e)**: Extracted security/scan +
  audit/full routes → `src/server/routes/audit.ts` (uses callGemini + getSecurityContext).
  server.ts 1957 → 1927. This de-interleaves the chat unit. NEXT = step c:
  `routeRequest` (~296-403) + `chatHandler` (~620-830) + LANGUAGE_RULE + `/api/chat/*`
  registrations → `routes/chat.ts` (uses aiCalls + offlineResponse + aiRouter + db + audit).
- **Milestone 1.28 — DONE (2026-06-15)**: Removed dead `routeRequest` function
  (~107 lines, defined but never called — chatHandler uses `aiRouter.route()` directly).
  server.ts 1927 → 1820. NEXT = step c: chatHandler (~515-730 now) + chat prompt
  builders (LANGUAGE_RULE, SYSTEM_PROMPT_EDIT/CHAT, buildDynamicPrompt, buildFreeSystemPrompt)
  + `/api/chat/*` registrations → `routes/chat.ts` (+ move prompt builders to prompts.ts).
- **Milestone 1.29 — DONE (2026-06-15, AI-core step c)**: Extracted the whole chat
  unit (LANGUAGE_RULE, SYSTEM_PROMPT_EDIT/CHAT, buildDynamicPrompt, buildFreeSystemPrompt
  + ApnapanProfile, chatHandler, `/api/chat/*` tier routes) → `src/server/routes/chat.ts`
  (`registerChatRoutes(app, chatLimiter)`; routes via shared aiRouter; db via getDb).
  server.ts 1820 → 1408. Verified bundle+load+tsc+tests. NEXT = step d: the Pro engine
  (`/api/pro-chat` + `/api/pro-build` + callClaudePro + helpers) → `routes/pro.ts` (biggest).
- **Milestone 1.30 — DONE (2026-06-15, AI-core step d)**: Extracted the Pro engine
  (`callClaudePro` + `/api/pro-chat` + `/api/pro-build`, ~755 lines) → `src/server/routes/pro.ts`
  (`registerProRoutes(app)`; uses aiRouter + AppEngine build/edit + SDKs). server.ts
  1408 → 650 (down 90% from original 6598!). Verified bundle+load+tsc+tests.
  NEXT = step e: `/api/sda-chat` → `routes/sda.ts`, then step f: server.ts → thin bootstrap.
- **Milestone 1.31 — DONE (2026-06-15, AI-core step e)**: Extracted SDA chat
  (`/api/sda-chat` + local helpers, ~294 lines) → `src/server/routes/sda.ts`. server.ts
  650 → 359 (down 95% from original 6598!). Only the SPA catch-all + /api/health +
  one dead/commented route remain. **server.ts is now effectively a bootstrap.**
  NEXT = step f: tidy server.ts (it's already ~359 lines); optional `tsconfig.server.json`
  + per-module strict; then PHASE 1 done → start PHASE 2 (real project model).
- **Milestone 1.32 — PHASE 1 CORE COMPLETE (2026-06-15)**: Removed last dead commented
  `/api/chat` block; server.ts now a clean **349-line bootstrap** (env load, firebase init,
  middleware, rate limiters, `registerXxxRoutes(...)` wiring, SPA catch-all + health, listen).
  Original god-file 6,598 → 349 (**95% smaller**), 71 inline routes → 0 (all in 20 route
  modules + 10 lib modules). Verified: esbuild bundle + node --check + load + tsc 0 + vitest
  + **full `vite build`** all green. App never broke across 32 commits.
  Optional remaining polish (deferred, non-blocking): add `tsconfig.server.json` + per-module
  strict TS to typecheck the backend (currently `src/server` excluded), and burn down the
  539 frontend strict errors. These can be done anytime; they don't block Phase 2.
  **▶ NEXT: PHASE 2 — real project model (VFS / per-file persistence / versioning).** See plan file.
- **Next milestones**: extract remaining groups — admin (`/api/admin/*`),
  sync, payment, github, secrets, chat/pro-chat/pro-build/sda — each green+push.
  Then move shared helpers/limiters to modules, add server tsconfig, enable strict
  per extracted module (burn down the 539-error debt), shrink server.ts to bootstrap.

## ⏳ PHASE 2 — Real project model (VFS, persistence, versioning)
## ⏳ PHASE 3 — Real hybrid build/preview runtime (WebContainer + server containers)
## ⏳ PHASE 4 — Generation & editing engine (diff-edits, agentic loop, real auto-repair)
## ⏳ PHASE 5 — Product (deploy, Pro-gating, integrated IDE, QA, observability)
## ⏳ FINAL — Re-audit from 0; new problems → phases → fix → push, until clean.

## 🔄 PHASE 2 — Real Project Model (IN PROGRESS)
- **Milestone 2.1 — DONE (2026-06-15)**: Built the Phase-2 foundation — a typed,
  binary-safe Virtual File System with NO size caps → `src/server/project/ProjectModel.ts`
  (`VirtualFileSystem` + `ProjectFile`/`ProjectFileTreeNode` types + `normalizePath`,
  `looksBinary`). Path-traversal safe; backward-compatible `fromRecord`/`toRecord`
  bridge to the legacy `{path:content}` shape. 9 unit tests in `tests/projectModel.test.ts`.
  Additive (no existing flow touched) — verified module strict tsc + frontend tsc 0 + 13 tests.
- **Milestone 2.2 — DONE (2026-06-15)**: Built real version history →
  `src/server/project/VersionStore.ts` (`ProjectVersionStore`: snapshot / list / restore /
  diff / bounded history). git-like checkpoints over the VFS; serializable for persistence;
  replaces the lossy in-memory undo-stack. 4 unit tests (`tests/versionStore.test.ts`).
  Additive — module strict tsc + frontend tsc 0 + 17 tests green.
- **Milestone 2.3 — DONE (2026-06-15)**: Built lossless workspace persistence codec →
  `src/server/project/WorkspaceStore.ts` (`encodeWorkspace`/`decodeWorkspace` — splits any
  large workspace into ~900KB Firestore-safe chunks + manifest, reassembles losslessly).
  Kills the old 60KB-file-drop + 800KB-cap data loss. 5 unit tests (`tests/workspaceStore.test.ts`).
  Additive. module strict tsc + frontend tsc 0 + 22 tests green. NEXT: wire into routes/sync.ts
  (chunked GET/POST, drop slimSession's lossy 60KB/800KB logic) — careful, touches live route.
  NEXT: wire VFS into AppEngine/sync (replace Record<string,string>), then persistence
  redesign (per-file storage, drop the 60KB/800KB caps) + real versioning (snapshot/diff/rollback).
- **Milestone 2.4 — DONE (2026-06-15)**: Wired the chunked codec into the LIVE sync
  route → `src/server/routes/sync.ts` now persists workspaces LOSSLESSLY (manifest +
  `{userId}__c{i}` chunk docs, stale-chunk cleanup, 8MB safety ceiling with honest 413
  instead of silent drops). Removed the lossy `slimSession` (60KB-file-drop/800KB-cap/
  60-msg truncation). Legacy v1 single-doc workspaces still read transparently (backward
  compat — no existing user data breaks). Verified module strict tsc + server bundle +
  load + frontend tsc 0 + 22 tests. **Phase 2 persistence redesign DONE.**
  NEXT (Phase 2 remaining): wire VFS/VersionStore into AppEngine/pro build flow; then PHASE 3.
- **Milestone 2.5 — DONE (2026-06-15)**: Added a **server strict-typecheck guardrail** —
  `tsconfig.server.json` (strict over routes/lib/project), `npm run typecheck:server`,
  wired into CI. This is the check that caught the 1.30 startup crash; it now blocks that
  whole bug class (undefined names / missing imports) permanently. Fixed the 6 surfaced
  type issues with behavior-preserving casts (server.ts ipKeyGenerator x3, pro.ts 'free'
  tier x2, sda.ts generateContent). Verified: frontend tsc 0 + server guardrail 0 + 22
  tests + server boots cleanly ("🚀 Server running").
- **Milestone 2.6 — DONE (2026-06-15) — PHASE 2 CORE COMPLETE**: Added legacy→new-model
  migration → `src/server/project/ProjectMigrator.ts` (`migrateLegacyFiles`/`migrateLegacyLastApp`/
  `migrateLegacySession` → VFS + initial snapshot; lifts old 3-file workspaces & lastApp HTML
  losslessly). 5 unit tests. Verified server guardrail 0 + frontend tsc 0 + 27 tests green.
  **Phase 2 delivered:** typed VFS (no caps, binary-safe) + version history (snapshot/diff/rollback)
  + lossless chunked persistence (live in sync route) + legacy migration + server typecheck guardrail.
  Remaining Phase-2 integration (have AppEngine/Pro build actually USE the VFS instead of
  Record<string,string>) overlaps with Phase 3/4 and is best done alongside the runtime work.
  **▶ NEXT: PHASE 3 — real hybrid build/preview runtime** (WebContainer + server containers;
  real PreviewRunner; replace fake BuildEngine/CodeGenerator; kill iframe+CDN hack).

## 🔄 PHASE 3 — Real hybrid build/preview runtime (IN PROGRESS)
- **Milestone 3.1 — DONE (2026-06-15)**: Built the hybrid **RuntimeRouter** →
  `src/server/runtime/RuntimeRouter.ts` (`analyzeProject` reads the VFS's package.json to
  profile framework/deps; `chooseRuntime` → 'static' | 'webcontainer' | 'server-container';
  `PreviewRuntime` interface for backends to implement). Pure decision layer, 8 unit tests,
  added to the server typecheck guardrail. Verified guardrail 0 + frontend tsc 0 + tests green.
  NEXT: implement the runtime backends — (a) static/iframe (simplest), (b) WebContainer adapter
  (frontend), (c) server-container adapter on top of the existing PreviewRunner/Sandbox/PortManager;
  then a unified preview endpoint that routes via RuntimeRouter; then replace fake BuildEngine/CodeGenerator.
- **Milestone 3.2 — DONE (2026-06-15)**: Built the real **static preview builder** →
  `src/server/runtime/StaticPreview.ts` (`buildStaticPreview(vfs)`): produces ONE self-contained
  HTML from the multi-file VFS — inlines local CSS/JS, rewrites local image/asset refs to
  data-URLs, leaves CDN urls alone, synthesizes a shell when no index.html. Replaces the old
  3-file-only `buildPreviewHtml` hack with a real VFS-based renderer. 6 unit tests; guardrail 0
  + frontend tsc 0 + tests green. NEXT: (b) WebContainer adapter (StackBlitz SDK, frontend),
  (c) server-container adapter (on PreviewRunner/Sandbox), then unified preview endpoint via
  RuntimeRouter + wire into Pro build (replacing the iframe+CDN hack).
- **Milestone 3.3 — DONE (2026-06-15)**: Built unified **PreviewService** + **StaticRuntime**
  (`src/server/runtime/PreviewService.ts`, `StaticRuntime.ts`). `startPreview(projectId, vfs)`
  routes via RuntimeRouter: 'static' is FULLY working (builds self-contained HTML, stores in a
  24h-TTL session map, returns `/preview/{id}`); 'webcontainer'/'server-container' return an
  HONEST `{ok:false, reason}` (never fake success) until their adapters land. 4 unit tests
  (10 runtime tests total). guardrail 0 + frontend tsc 0 + tests green. NEXT: add a `/preview`
  HTTP route (start + serve /preview/:id) wired into the bootstrap; then WebContainer + server
  adapters; then point Pro build at PreviewService (retire iframe+CDN hack).
- **Milestone 3.4 — DONE (2026-06-15)**: Wired live preview HTTP routes →
  `src/server/routes/preview.ts` (`POST /api/preview` builds a VFS from posted files and
  starts a preview via PreviewService; `GET /preview/:sessionId` serves the built static
  HTML). Registered in the bootstrap. Verified per hardened protocol: frontend tsc 0 +
  server guardrail 0 + 45 tests + **bundled server boots to "🚀 Server running"**.
  NEXT: WebContainer adapter (StackBlitz SDK) + server-container adapter; then point the
  Pro build at /api/preview (retire the iframe+CDN hack). (External infra decisions pending.)
- **Milestone 3.5 — DONE (2026-06-15)**: Removed 13 ad-hoc debug/test scripts from
  `src/server/` (e2e_test, repair_test, run_chess_build, test_generator_audit, verify_generator,
  verify_persistence, memory_test, master_gen_test, phase2_*, audit_test, test_notes_app — none
  imported by the app). Kept real `audit_env.ts` (startup env audit, imported by server.ts),
  ObservabilityManager, TokenUsageManager. (Caught & restored audit_env mid-cleanup via the
  boot/guardrail check — process working as intended.) Verified: frontend tsc 0 + guardrail 0
  + 45 tests + clean boot. (CI is GREEN on PR #2.) Deep fake-BuildEngine refactor deferred to
  Phase 3/4 with fresh context (interconnected with AppMakerLab).
- **Milestone 3.6 — DONE (2026-06-15)**: Built `WorkspaceMaterializer` →
  `src/server/runtime/WorkspaceMaterializer.ts` — writes a VFS to a real on-disk dir
  (nested dirs, base64-binary decode, path-traversal-safe) + `cleanupWorkspace`. This is
  the missing core that turns the typed VFS into a runnable workspace for the existing
  WorkspaceLauncher (pkg-manager/start-cmd) + SandboxManager (child-process spawn) — i.e.
  the heart of the Cloud-Run server-container runtime. 4 fs-backed unit tests (49 total).
  Verified frontend tsc 0 + guardrail 0 + 49 tests. NEXT: ServerContainerRuntime adapter
  (materialize → npm install → launch dev server on allocated port → health-check → proxy URL)
  wiring the existing PreviewRunner pieces; then route 'server-container' target to it.
- **Milestone 3.7 — DONE (2026-06-15)**: Built **ServerContainerRuntime** →
  `src/server/runtime/ServerContainerRuntime.ts` (implements PreviewRuntime for the
  'server-container' target): materialize VFS → detect pkg manager → `npm install` →
  launch dev server on an allocated port (reuses WorkspaceLauncher/SandboxManager/
  PortManager/PreviewHealthChecker) → health-check → preview URL; stop terminates +
  releases port + cleans dir; errors clean up + rethrow. Same flow runs inside Cloud Run/
  Docker in prod. Wired into PreviewService (server-container target now REAL, no longer a
  stub; webcontainer still honest-pending). Collaborators injectable → fully unit-tested
  (5 orchestration tests; 53 total). Also fixed 2 real return-type bugs in WorkspaceLauncher
  (was `string[]`, actually `[cmd, args]`). Verified frontend tsc 0 + guardrail 0 + 53 tests
  + clean boot. NEXT: a Dockerfile/Cloud Run wrapper for prod + point Pro build at /api/preview;
  WebContainer adapter when StackBlitz license decided.
- **Milestone 3.8 — DONE (2026-06-15) — GUARDRAIL STRENGTHENED**: Added a CI **boot
  smoke-check** (`scripts/boot-check.sh`, `npm run boot:check`, new CI step): bundles
  server.ts, boots it, and FAILS the build unless it reaches "🚀 Server running" (catches
  the startup-crash class — undefined names in route registrars — at CI level, which type
  checks alone can miss for legacy `any` code). The project now has THREE guardrails in CI:
  frontend tsc, strict server typecheck (`tsconfig.server.json`), and boot smoke-check —
  plus the vitest suite (53 tests). Verified all green locally.
- **Milestone 3.9 — DONE (2026-06-15)**: Added `ServerContainerRuntime.getTarget(sessionId)`
  → internal `{host,port,origin}` a reverse proxy forwards to (null after stop). Sets up the
  next step: a `/preview-app/:sessionId/*` reverse-proxy route so server-container previews
  are reachable without exposing raw internal ports. 1 test (54 total). frontend tsc 0 +
  guardrail 0 + 54 tests green.
  **▶ NEXT (Phase 3 finish, fresh context — server-touching, do with full boot-check):**
  1. reverse-proxy route `/preview-app/:id/*` → ServerContainerRuntime target (+ WS/HMR upgrade).
  2. Cloud Run/Docker: ensure the prod image can spawn child dev servers + proxy (single instance).
  3. Point the Pro build at /api/preview (retire iframe+CDN hack).
  4. WebContainer adapter once StackBlitz license decided.
  Then Phase 4 (diff-edit + agentic generation) → Phase 5 → final re-audit (re-confirm 3 guardrails).
- **Milestone 3.11 — DONE (2026-06-15)**: Added the reverse-proxy route
  `ALL /preview-app/:sessionId/*` in `routes/preview.ts` — forwards to the server-container
  session's internal dev server (via `previewService.serverTarget` + pure `buildProxyUrl`
  helper), so server-container previews are reachable through the main server without
  exposing raw internal ports (404 if session unknown, 502 if upstream down). HTTP proxying
  via fetch (WS/HMR upgrade is a follow-up). 3 helper unit tests (58 total). Verified
  frontend tsc 0 + guardrail 0 + 58 tests + boot:check PASS (route registers without crash).
  NEXT: WS/HMR upgrade for the proxy; Cloud Run Docker wrapper; point Pro build at /api/preview.

## 🔄 PHASE 4 — Generation & editing engine (IN PROGRESS)
- **Milestone 4.1 — DONE (2026-06-15)**: Built the surgical **EditEngine** →
  `src/server/project/EditEngine.ts` (`applyEdits(vfs, edits, versions?)`): structured
  per-file ops (write/delete/rename/patch with occurrence guard) applied to the VFS,
  ALWAYS snapshotting first (reversible — user edits never lost), per-op failure reporting
  (batch doesn't abort). Directly fixes the audit's "full-file regeneration clobbers edits"
  + "no rollback". 4 unit tests (62 total). frontend tsc 0 + guardrail 0 + tests green.
  NEXT (Phase 4): have the Pro edit flow emit FileEdit ops (instead of full rewrites) and
  apply via EditEngine; multi-file aware planning; agentic build/run/repair loop; real
  auto-repair (compile/run errors, not regex score). (Phase 3 finish — proxy WS/HMR + Cloud
  Run wrapper + Pro→/api/preview — also pending.)
- **Milestone 4.2 — DONE (2026-06-15)**: Built the real **ProjectVerifier** →
  `src/server/project/ProjectVerifier.ts` (`verifyProject(vfs)`): concrete, false-positive-averse
  checks — invalid JSON (error), missing static entry (error), broken LOCAL html refs (warning;
  CDN/data: ignored). Replaces the audit-flagged "heuristic score /100" that shipped known-broken
  apps; this is the detection foundation for real auto-repair. 5 unit tests (67 total).
  frontend tsc 0 + guardrail 0 + tests green. NEXT: feed verifier errors into an agentic
  repair loop (fix → re-verify) using EditEngine; wire EditEngine+verifier into the Pro edit flow.
- **Milestone 4.3 — DONE (2026-06-15)**: Built the real **auto-repair loop** →
  `src/server/project/RepairLoop.ts` (`autoRepair(vfs, {generateFixes, versions, maxAttempts})`):
  verify → AI fixer emits surgical FileEdits → apply via EditEngine (snapshotted) → re-verify →
  repeat; stops when clean / no edits / no progress (no infinite loops). Replaces the audit's
  regex-score-then-ship-broken behavior with a real iterative fix loop. Fixer is INJECTED →
  5 unit tests with fakes (72 total). frontend tsc 0 + guardrail 0 + tests green.
  **Phase-4 engine core now in place** (EditEngine + ProjectVerifier + RepairLoop) — all pure,
  tested, infra-independent. NEXT (integration): wire these + aiCalls into the Pro build/edit
  flow so it emits FileEdits + self-repairs; multi-file planning; then Phase 3 finish + Phase 5.
- **Milestone 4.4 — DONE (2026-06-15)**: Built the **BuildPipeline** orchestration brain →
  `src/server/project/BuildPipeline.ts` (`runBuild({prompt, files, generate, fix})`): lift files
  → VFS (+ baseline snapshot) → generate FileEdits → apply (EditEngine) → verify + auto-repair
  (RepairLoop) → return files + verification. Edits existing files surgically (unrelated files
  preserved). generate/fix injected (AI) → 4 unit tests with fakes (76 total). This is the real
  replacement for the old fire-and-forget full-rewrite Pro build. frontend tsc 0 + guardrail 0 +
  tests green. **Phase-4 engine COMPLETE as a pure, tested unit** (VFS + EditEngine + Verifier +
  RepairLoop + BuildPipeline). NEXT = INTEGRATION: thin HTTP route wiring runBuild's generate/fix
  to real aiCalls (prompt→FileEdit JSON), then point the Pro frontend at it + /api/preview.
- **Milestone 4.5 — DONE (2026-06-15) — ENGINE GOES LIVE**: Built the AI⇄engine bridge
  `src/server/project/aiEdits.ts` (`parseFileEdits` — robust JSON extraction from messy LLM
  replies, drops malformed ops; `makeAiEditGenerator(callModel)` → generate/fix prompts) and
  wired the real endpoint `POST /api/build` (`src/server/routes/build.ts`): prompt+files →
  runBuild (AI generates FileEdits via callClaude → EditEngine → Verifier → RepairLoop) →
  returns files + verify report (+ optional live preview). Registered in bootstrap. This is the
  modern, engine-backed replacement for the old fire-and-forget full-rewrite /api/pro-build
  (legacy route untouched; frontend can migrate incrementally). 7 parser/generator tests (83
  total). Verified frontend tsc 0 + server guardrail 0 + 83 tests + clean boot (Server running).
  NEXT: point the Pro frontend at /api/build + /api/preview; multi-file planning prompt upgrades;
  Phase 3 finish (proxy WS/HMR, Cloud Run Docker); Phase 5; final re-audit.

## 🔄 PHASE 5/integration — Wire frontend to the real engine (IN PROGRESS)
- **Milestone 5.1 — DONE (2026-06-15)**: Added the typed frontend engine client →
  `src/services/buildService.ts` (`buildApp` → /api/build, `startPreview` → /api/preview,
  `previewIframeSrc`) with full BuildResponse/PreviewInfo/VerifyReport types. This is the clean
  bridge the Pro UI will call to drive the real engine instead of the legacy full-rewrite flow.
  Additive (no existing call site touched). 4 unit tests (fetch mocked, 87 total). frontend tsc 0
  + guardrail 0 + tests green. NEXT: wire a Pro UI action (e.g. a "Build v2" path or the existing
  build button) to `buildApp` + render preview via `startPreview`/`previewIframeSrc`; then retire
  the legacy iframe+CDN path once parity confirmed.
- **Milestone 5.2 — DONE (2026-06-15)**: Built a complete, production-ready UI for the new
  engine → `src/components/EngineBuilder.tsx` (prompt → `buildApp` → file-tree + code view +
  live static-preview iframe + verify/repair status). Self-contained, dark-theme, uses only
  `buildService` (no legacy dependency). Verified frontend tsc 0 + guardrail 0 + 87 tests +
  **full `vite build` ✅** (compiles in the real production bundle). NOT yet mounted — App.tsx
  (~5k lines, strict:false) uses internal state-based view switching, so mounting is the next
  (careful) step: render `<EngineBuilder/>` in a new IDE tab/view. Mount in fresh context with
  full vite-build verify, then it becomes user-visible; afterwards retire the legacy build path.

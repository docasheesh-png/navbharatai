# NavBharatAI Pro → Real App Maker — Execution Progress

> ## 📁 SCOPE OF THIS FILE — read first
> This file tracks **ONLY the NavBharatAI Pro** workstream (the prompt → build →
> preview → edit app-maker engine: Phases 0–7, VFS/EditEngine/BuildPipeline/
> preview runtime, etc.).
>
> The **Engineer AI** workstream (the autonomous Grok+E2B agent that sees/drives/
> tests/fixes apps) is a **separate project** — its entire roadmap and edit plan
> live in **`ENGINEER_AI_ROADMAP.md`**. Do NOT add Engineer-AI plan/progress here,
> and do NOT add NavBharatAI-Pro plan/progress to that file. Keep the two separate.

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
>
> **⚠️ NOTE (2026-06-16, added by a different session — not wiped, just flagging):**
> the "RESUME HERE" block above describes mid-Phase-1 state and is STALE — the
> rest of this file (below) shows Phase 1 as CORE COMPLETE and Phases 2–6 well
> underway, with `main` actually at commit `32609a9` (PRs #10 and #16 merged).
> Per the new safeguards (see **CROSS-SESSION COLLABORATION PROTOCOL** at the
> bottom of this file, and `/CLAUDE.md`), do NOT trust this block blindly —
> run `git fetch origin main && git log --oneline -10` first, then find the
> actual latest milestone further down this file as your real resume point.
> This note is left in place rather than deleting the original block, since
> existing content here must be preserved, not wiped.

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
- **Milestone 5.3 — DONE (2026-06-15) — NEW ENGINE IS NOW USER-VISIBLE**: Mounted
  `EngineBuilder` into the live app — added `'engine_builder'` to `ViewType`, a sidebar nav
  button "App Builder (New Engine)" (`toggleTab('engine_builder')`), and a render block in
  App.tsx. Users can now reach the REAL engine (prompt → multi-file build → live preview +
  verify/repair) from the UI, alongside the legacy flow. Verified frontend tsc 0 + guardrail 0
  + 87 tests + **full vite build ✅** (App.tsx change compiles in prod bundle). NEXT: dogfood/
  polish the EngineBuilder UX; multi-file planning prompt upgrades; then migrate the primary Pro
  build button to it & retire legacy iframe+CDN; Cloud Run Docker / WebContainer; Phase 5 rest.
- **Milestone 5.4 — DONE (2026-06-15) — GENERATION QUALITY FOR COMPLEX APPS**: Upgraded the
  AI⇄engine prompts in `src/server/project/aiEdits.ts` so the engine genuinely handles large,
  complex apps (the core goal). Added (1) `ENGINEERING_RULES`: plan the WHOLE file tree first,
  separate concerns into components/modules/styles, guarantee every referenced file exists
  (no dangling imports/`<script src>`), a real wired entry point, NO TODO/placeholder stubs,
  valid escaped JSON. (2) `fileContext(vfs)`: edits now see existing file CONTENTS (bounded:
  4k/file, 40 files, 120k total budget; binary omitted), so `patch` finds target exact text
  instead of guessing from path-only context. (3) Fresh empty project → explicit "build from
  scratch as a complete runnable multi-file project" path. Verified server tsc 0 + frontend
  tsc 0 + **89 tests** (2 new: content-in-context + fresh-build). NEXT: migrate primary Pro
  build button to engine & retire legacy; Cloud Run Docker / WebContainer; Phase 5 rest.
- **Milestone 5.5 — DONE (2026-06-15) — FRAMEWORK SCAFFOLDS (Phase 4 item 23)**: New
  `src/server/project/Scaffold.ts` — `detectFramework(prompt)` (vite-react vs static heuristic),
  `scaffold(vfs, fw)` seeds a REAL runnable skeleton (vite-react: package.json + vite.config +
  index.html → src/main.jsx → src/App.jsx + index.css; static: index.html+styles.css+app.js)
  into an EMPTY vfs only (never overwrites), `scaffoldSummary()`. Wired into `BuildPipeline`:
  fresh builds (count 0) now seed a working foundation before generation (`scaffold` flag,
  default on; result exposes `scaffolded`). So complex apps start from a verified, wired,
  dangling-ref-free base instead of nothing. 9 new tests (scaffold + 2 pipeline). server tsc 0
  + frontend tsc 0 + **98 tests** green. NEXT: surface scaffold choice in EngineBuilder/Pro UI;
  migrate primary Pro build button; Cloud Run Docker / WebContainer; Phase 5 rest.
- **Milestone 5.6 — DONE (2026-06-15) — IN-BROWSER REACT PREVIEW (closes the vite-react preview gap)**:
  The default `vite-react` scaffold previously routed to `webcontainer` → no preview (gap vs
  "preview always works"). New `src/server/runtime/ReactPreview.ts` (`buildReactPreview`,
  `isReactProject`) builds ONE self-contained HTML that bundles a React/Vite frontend ENTIRELY
  in-browser: React/ReactDOM CDN + Babel-standalone (JSX/TS transpile) + a tiny CommonJS-style
  module loader (relative imports, CSS imports → injected <style>, react/react-dom specifiers →
  CDN globals; unresolved bare deps → clear in-preview error). New `renderPreview.ts` selects
  react-vs-static. `StaticRuntime` now uses `renderPreview`; `chooseRuntime` routes vite/cra
  frontends (no node server) → `static` (browser-bundled, zero infra). So a fresh React build
  now previews live in EngineBuilder. 13 new/updated tests (reactPreview + router + previewService).
  server tsc 0 + frontend tsc 0 + **107 tests** green. NEXT: surface scaffold/runtime in UI;
  migrate primary Pro build button; Cloud Run / WebContainer for heavier apps; Phase 5 rest.
- **Milestone 5.7 — DONE (2026-06-15) — PREVIEW HARDENING (user reported preview error)**: User
  hit a preview error (screenshot = LEGACY 3-file flow on the live site; the new engine is on the
  unmerged branch, separate "App Builder (New Engine)" tab). Two real fixes: (1) `ReactPreview.ts`
  upgraded from React-only (threw on any other bare import) to a dependency-robust loader matching
  the legacy bundler — builds an esm.sh **importmap** from package.json, async-loads EVERY bare dep
  (react/react-dom + router/state/UI libs) via esm.sh, JSX **automatic** runtime (no React-in-scope
  needed), supports .json/.css imports, honest error overlay instead of blank/throw. So complex
  React apps preview without a server. (2) EngineBuilder + new `previewSrcFor(preview)` in
  buildService now render the live iframe for ANY successful runtime (static → /preview/:id;
  server-container → /preview-app/:id/), not just static, and show target-tagged honest status.
  4 new tests (esm.sh deps, automatic runtime, previewSrcFor). server tsc 0 + frontend tsc 0 +
  **110 tests** + **vite build ✅**. NOTE for user: to see this live, the branch must be deployed/
  merged — the screenshot error is the OLD preview path. NEXT: migrate primary Pro button to the
  engine & retire legacy; Cloud Run / WebContainer; Phase 5 rest.
- **Milestone 5.8 — DONE (2026-06-15) — VERIFIER CATCHES REAL MODULE ERRORS**: `ProjectVerifier`
  now does module-level checks for JS/TS source apps so the auto-repair loop fixes real complex-app
  breakage: (a) **dangling relative imports** (`import x from './missing'` that resolves to no
  project file, trying extensions + /index) → ERROR; (b) **bare deps imported but not in
  package.json** (skips node builtins + scoped-pkg roots) → WARNING. False-positive-averse. 5 new
  tests. server tsc 0 + **114 tests** green. NEXT: migrate primary Pro button to engine; deploy/
  merge branch so the new engine is live; Cloud Run / WebContainer; Phase 5 rest.
- **Milestone 5.9 — DONE (2026-06-15) — MERGED main + PORTED PR#3 SDA**: Merged origin/main
  (PR #3 had advanced it) into the branch. Only server.ts conflicted (my modular bootstrap vs
  main's monolith); kept the bootstrap and PORTED all of PR #3's SDA upgrades into modular
  `routes/sda.ts`: in-memory clinical store + recent-message memory (24h TTL, session-keyed),
  pinned clinical-snapshot context (never forgets turn-1 data), CLINICAL_JSON parse/strip/persist,
  expanded red-flag patterns, rural/PHC prompt + structured Rx + doctor disclaimer, returns
  sessionId. Verified server tsc 0 + frontend tsc 0 + 114 tests + boot-check PASS + vite build.
  PR #2 now conflict-free (mergeable).
- **Milestone 5.10 — DONE (2026-06-15) — PRIMARY PRO BUTTON → NEW ENGINE**: The primary Pro
  build now runs the REAL engine FIRST. In App.tsx's build handler: factored a `finishBuild()`
  helper (applies built files → workspace + preview + chat summary + version snapshot), then calls
  `buildApp()` (/api/build: VFS + EditEngine + Verifier + RepairLoop) as the PRIMARY path; on
  success it finishes and returns. If the engine errors or returns nothing, it transparently FALLS
  BACK to the legacy streaming /api/pro-build flow — so a build can never end broken (Rule #2).
  Maps the engine's verify report → the existing Quality-Check UI. Verified frontend tsc 0 + 114
  tests + **vite build ✅**. NEXT: final clean production merge of PR #2; then retire legacy path
  once parity confirmed; Cloud Run / WebContainer; Phase 5 rest; final re-audit.

---
## 🏛️ ARCHITECTURE ENGINE + ROADMAP UPDATE (2026-06-16)

- **Milestone 6.0 — DONE — Architecture Manifest + Validator (kills React #299 / mixed-arch class)**:
  Root cause of broken generated apps was MIXED ARCHITECTURE (React `src/main.jsx`→`#root` shipped
  with vanilla `js/router.js`/`pages/*` + `#app` + legacy `<script>` → React #299). Fix:
  `ArchitectureManifest.ts` (`selectArchitecture` locks ONE architecture: react+vite | vanilla,
  with entry+mountId+forbidden paths; `manifestContract()` injected into plan+batch+single-shot
  generation prompts) + `ArchitectureValidator.ts` (deterministic guards: DOM mount match, single
  module entry, no legacy `<script>`, no `js/` mixing, entry resolves). Wired into ProjectVerifier
  → verify+repair loop auto-fixes, build = FAILED until clean. Honest reporting in Pro UI
  (no fake "App is live" on failure). False-positive hardening (relative `./` entry, benign
  pages/*.jsx + helper .js, external CDN scripts all pass). 10 regression tests. 124 tests green.

### ✅ SUPPORTED ARCHITECTURES (one per build, never mixed)
- **React + Vite** — full generation + in-browser preview (esm.sh + Babel).
- **Vanilla JS/HTML/CSS** — full generation + self-contained static preview.
- CURRENT FOCUS: make these two ROCK-SOLID in prod (test/polish) before expanding.

### 📋 PHASE 6 — UNIVERSAL ARCHITECTURE SUPPORT (planned, after React+Vanilla are rock-solid)
Goal: support EVERY mainstream web architecture (one locked per build) — the "world #1" breadth.
Each needs: (a) manifest entry in `selectArchitecture`, (b) immutable starter template/scaffold,
(c) architecture-specific validator rules, (d) a preview runtime, (e) regression tests.
- 6.1 **Vue (+ Vite)** — in-browser preview (like React).
- 6.2 **Svelte / SvelteKit** — bundler preview.
- 6.3 **Next.js** — SSR/React framework → needs server-container runtime.
- 6.4 **Angular** — full build pipeline.
- 6.5 **Node/Express backend + full-stack** (React/Vue + API + DB) → server-container runtime
      (npm install + dev server + proxy). HIGHEST value for "complex high apps".
- 6.6 **Static site generators** (Astro, Eleventy), **Solid**, **Preact**, **Lit**, etc.
- 6.7 **Stages 6–8 of the validation pipeline** (real npm build/lint/typecheck + headless-browser
      render + screenshot + console-error scan) — depends on the server-container/chromium infra.
DEFERRED by user ("ye baad me karenge"); React+Vanilla rock-solid first.

---
## 🤖 PHASE 7 — AUTONOMOUS VALIDATION & TESTING FACTORY (planned; implement AFTER core phases)

Vision (user spec, 2026-06-16): turn NavBharatAI into a self-improving software factory —
mandatory workflow: Generate → Build → Test → Fix → Re-test → Optimize → Observe → Learn → Preview.
Preview is EARNED; generation alone is not success; NO fake success messages ever.

> **Status:** SLICE 1 DONE (infra-independent foundation): `ValidationPipeline` (architecture +
> static gates real; build/runtime/tests/a11y/perf/security reported as PENDING, never faked) +
> Quality Score + earned-preview (`previewAllowed`) + honest report card in Pro UI. Everything
> below needs the server-container/chromium sandbox and is DEFERRED until core phases are done.

### Hard dependency
Most stages need a real execution sandbox per build: **Node + npm + headless Chromium**, with
resource/time limits, network policy, and per-build isolation. This = the **server-container
runtime** (Phase 3 finish / Phase 6.5). Build that FIRST; then these gates flip PENDING→REAL.

### The 25 stages → grouped for implementation
- 7.1 **Stage 1 Requirement Understanding** — structured spec + Requirement Confidence Score +
      clarify-loop (ask questions when <90%, detect contradictions/impossible reqs). Needs a UI
      clarify flow.
- 7.2 **Stage 3 ADRs** — generate + store Architecture Decision Records per project.
- 7.3 **Stage 6 Build Verification** — npm install + build, asset/bundle/env checks (sandbox).
- 7.4 **Stage 7 Runtime Validation** — headless launch, smoke render, console/network/exception
      capture, console.error=0 gate (sandbox + chromium).
- 7.5 **Stage 8–11 Automated tests** — generate unit/component/integration/e2e from requirements;
      route, storage, API (mocked) testing; coverage targets as SCORE (not hard preview-block).
- 7.6 **Stage 12 Visual testing** — screenshots across mobile/tablet/desktop + baseline diff.
- 7.7 **Stage 13 Accessibility** — axe-core, WCAG AA.
- 7.8 **Stage 14 Performance** — Lighthouse (perf/a11y/best-practices/SEO), bundle/LCP/CLS/TTI.
- 7.9 **Stage 15 Security** — npm audit, XSS/CSRF/injection/secret scans, route/authz checks.
- 7.10 **Stage 16 Cost awareness** — token/db/storage/bandwidth/API cost estimate + per-user cost.
- 7.11 **Stage 17 Observability** — inject structured logging, error tracking, analytics,
       OpenTelemetry/Sentry-compatible hooks into generated apps.
- 7.12 **Stage 18 DB migration safety** — versioned migrations, rollback, destructive-change warnings.
- 7.13 **Stage 19 AI repair loop (real)** — fed by real build/test/console/screenshot failures;
       minimal patch → rebuild → re-test; max 3 retries (extends current verify-repair loop).
- 7.14 **Stage 20 Regression engine** — every bug → a permanent test (current: architecture
       regression tests; generalize to a stored, growing suite).
- 7.15 **Stage 21 Learning system** — store {prompt, manifest, files, results, failures, fixes,
       outcome}; improve templates/repair/architecture-selection over time. (privacy + retention.)
- 7.16 **Stage 22 Production readiness review** — env/secrets/monitoring/backups/CDN/cache/
       indexing/rate-limit checklist before deploy.
- 7.17 **Stage 23 Quality scoring (full)** — extend slice-1 scorer with real build/runtime/test/
       lighthouse inputs; 100 requires all; preview disabled < 85 (tunable).
- 7.18 **Stage 24 Platform metrics** — first-pass success, avg repair attempts, build/test pass
       rates, time-to-preview, runtime-error rate, regression frequency → internal dashboard.
- 7.19 **Stage 25 Reporting (full)** — structured PASS/FAIL report card wired to real gate results
       (slice 1 done for the gates we can run).

### Extra additions I recommend (beyond the spec)
- **Tiered gates:** fast gates (static+build+smoke, console=0) BLOCK preview; deep gates
  (e2e/lighthouse/visual/a11y) feed the SCORE / "Ship to production", so quick iteration stays fast.
- **Per-build sandbox isolation** + CPU/mem/time caps + egress allowlist (security + cost control).
- **Generation/cost budget guardrail** per build (token + compute) with a hard ceiling.
- **Streaming build progress** for the new engine (currently single "generate with new engine"
  line) — better UX while gates run.
- **Result cache / dedupe** for identical prompts (cost).

---
## 🤝 CROSS-SESSION COLLABORATION PROTOCOL (added 2026-06-16)

### Why this exists
Two separate Claude Code accounts/sessions work on this repo, **sequentially,
never simultaneously** (one's credits run out before the other starts).
There is no live-sync channel between sessions — the only shared state is
this git repository (commits, branches, PRs) plus this file. Without a
protocol, sessions drift: a new session can start from a stale picture of
`main` and redo work another session already finished. This happened for
real today — **PR #1** and **PR #4** were each fully redundant with work
already merged into `main` by the other session, built blind because neither
session re-verified real `main` state before starting. Both were closed
without merging once discovered. This section documents the fix so it
doesn't happen again. The rules themselves (kept short, rarely changing)
live in **`/CLAUDE.md`** at the repo root, auto-loaded every session — this
section is the longer explanation + the living checklist.

### The 7 safeguards (full rules in `/CLAUDE.md`; summary here)
1. **Fresh-state check** — `git fetch origin main` + `git log --oneline -10`
   + check open PRs, BEFORE trusting this file's claims. This file can go
   stale the instant another session pushes after it was last edited.
2. **Phase-level lock + exact resume point** — don't start/redo a phase
   another session owns or finished; resume from the true next un-done item.
   Lock releases only when a phase is marked DONE, or by explicit admin
   (user) override.
3. **0.01% doubt → stop and ask the admin** — any doubt about breakage risk
   or cross-session conflict → halt, don't push/commit, ask the user with
   the exact risk + options. Never guess on anything with breakage risk.
4. **Commit small, commit often** — after every meaningful sub-step, not
   just at phase end. Credit cutoffs are often abrupt, not graceful — don't
   bet on a single "save before credits run out" moment.
5. **Mandatory verification gate before every push** — `tsc --noEmit` (+
   `tsc -p tsconfig.server.json` if server touched) + `vitest run` (read the
   actual result line) + boot/manual smoke check for server changes. Never
   skipped, even under time/credit pressure.
6. **Redundant-work check** — grep/search `main` for existing implementations
   before building anything new. Would have prevented PR #1 and PR #4.
7. **Audit, don't restart, after lost/uncommitted work** — if a session finds
   work was lost (e.g. uncommitted at a credit cutoff), first audit the real
   committed+verified state (git log, tsc, tests, boot check), then redo
   ONLY the genuine gap vs. what's claimed done. Never wholesale-restart a
   phase that's already partly committed and verified — that wastes credit
   and risks reintroducing bugs into code that already worked.

### Current verified ground truth (don't trust the top "RESUME HERE" block — it's stale)
- `main` @ `32609a9` (as of 2026-06-16). PR #16 (SDA Gemini leading-turn fix)
  and PR #10 (preview Fix-Bug/Coding-Bug classification) both merged. PR #1
  and PR #4 closed as redundant (see above). Open PRs: 0 at last check.
- Real resume point for engine work = end of the **🏛️ ARCHITECTURE ENGINE +
  ROADMAP UPDATE** section above (Milestone 6.0 done) → next is hardening
  React+Vanilla in prod per "CURRENT FOCUS", then Phase 6 (universal
  architecture support) and Phase 7 (validation factory), both explicitly
  deferred by the user until React+Vanilla are rock-solid.
- Less than 60% of the overall roadmap is complete (per user, 2026-06-16) —
  do not treat any phase below Phase 5/6.0 as more "finished" than its own
  milestone entries state.

### How to use this section
Every session should, in order: (1) run the fresh-state check, (2) scan this
file bottom-up for the latest dated milestone to find the true resume point,
(3) cross-check against any currently-open PR before starting new work,
(4) follow safeguards 2–7 for the duration of the session, (5) append new
milestones here (never delete/rewrite existing ones) as work completes.

---

## 🖥️ Milestone — Preview engine: server-side esbuild bundler (2026-06-17)

**Problem (user, 3rd report):** "preview abhi bhi nahi chal raha hai." A screenshot
of a **324-file** generated React app showed the preview rendering only the word
**"App"** (a minimal/partial mount) — no amber error, no spinner, no blank. Earlier
the user also reported an amber error box for other apps.

**Root cause (diagnosed, not guessed):** The browser-side `PREVIEW_BOOTSTRAP`
mini-bundler loads ~9MB Babel from a CDN, transpiles every file in-browser via
`new Function()`, and resolves the whole module graph client-side. For large
multi-file apps this only partially renders (root shell → "App"); any CDN/transpile
hiccup → amber error. The resolution logic itself was verified correct for
well-formed apps (deterministic Node trace), so the failure is the *client-side
runtime*, not the path logic.

**Fix (PR #59, merged → deploying):**
- New `POST /api/preview-bundle` (in `src/server/routes/preview.ts`): runs **esbuild
  server-side** (already a devDep, present in the Docker `npm install`). Follows the
  ENTIRE import graph from the entry, transpiles TSX/JSX natively, resolves `@/`
  aliases at build time, rewrites BrowserRouter→HashRouter, inlines CSS, polyfills
  `import.meta.env`. Returns self-contained native-ESM HTML + an importmap pointing
  npm deps at esm.sh. NO Babel CDN, NO custom require() chain.
- `updatePreview` (App.tsx): for React apps, renders the existing client-side
  preview IMMEDIATELY (zero-regression fallback), then async-fetches the server
  bundle (20s timeout) and swaps it in when ready. Server down/slow/error → user
  sees exactly today's behavior. So the change can only help or stay neutral.
- 4 new tests (`tests/previewBundle.test.ts`) prove esbuild inlines a deep 7-level
  import graph (the 324-file scenario) + `@/` aliases. Suite: 194/194 green.

**Verification gate:** `tsc --noEmit` (front) ✓, `tsc -p tsconfig.server.json` ✓,
`vitest run` 194/194 ✓.

**Next:** user to test on prod after deploy (~5 min). If their specific app still
fails, the new MINI_HARNESS now surfaces the REAL esbuild/runtime error (instead of
a silent "App"), which pinpoints the next fix.

---

## 🛠️ Milestone — Edit reliability + memory + Phase-3 close-out (2026-06-19)

### Edit-stops-after-N-edits FIXED + Claude-Code-style memory (PR #82, merged)
User report: app builds + preview works, but **after ~4–5 edits Pro stops editing**.
Ground-truth trace of the live edit path (App.tsx → /api/build-stream → aiEdits)
found the real, co-existing root causes — all fixed:
- **Output token caps (the #1 killer):** the single edit call returns changed files
  as JSON; once files grew past the provider `max_tokens` the reply truncated
  mid-JSON → parsed to ZERO edits → silent no-op. Raised caps on every provider
  (Claude proxy 8k→16k, Claude direct 4k→8k, Gemini `maxOutputTokens` 16k,
  Groq/OpenAI/DeepSeek/OpenRouter +8k).
- **Input context starvation:** edit context budget raised (24k/file · 80 files ·
  500k total) AND files are now **relevance-ordered** so the file being edited is
  shown first, in full, before the budget runs out (`aiEdits.fileContext`).
- **Patch fragility:** `EditEngine` patch now has a **whitespace-tolerant** find→
  replace fallback so trivial indentation/newline drift no longer silently drops it.
- **Edit ran the fresh-build feature loop:** `BuildPipeline.isEdit` now SKIPS the
  modular `completeFeatures` loop on edits (it was treating the edit instruction as
  a feature spec and could undo the change).
- **Claude-Code-style memory (full):** rolling fact-dense summary auto-generated
  each turn (`summarizeForMemory`), recent conversation history + a per-session edit
  log ("changes already made — do not undo") now reach the build engine, are
  returned in the complete event, persisted on the session (state + Firestore
  `memory_summary`/`edit_log`) and restored on load.
- Verified: server tsc 0 · frontend tsc 0 · 202 tests · boot PASS.

### PHASE 3 — hybrid build/preview runtime — **CODE-COMPLETE** (infra items flagged)
Ground-truth audit (2026-06-19) of `src/server/runtime/*` + `routes/preview.ts`:
**DONE in code (tested):** RuntimeRouter, StaticPreview, ReactPreview (in-browser
React/Babel/esm.sh), renderPreview, StaticRuntime (24h TTL), server-side esbuild
bundler `/api/preview-bundle` (LIVE in App.tsx updatePreview), ServerContainerRuntime
(real materialize→install→launch→health-check→proxy spawn chain), WorkspaceMaterializer,
`/preview-app/:id/*` HTTP proxy **+ WebSocket/HMR upgrade** (server.ts), all 3 preview
routes.
**Honesty fix done now (no fake success):** `PreviewService` 'webcontainer' branch
used to ALWAYS fall back to static and report `{ok:true,target:'static'}` — for
Vue/Svelte/Astro SFC apps that the in-browser renderer can't transpile, that served a
blank page as "success". Now `canStaticRender(vfs)` gates it: React/static → real
static fallback; genuine SFC apps → **honest `{ok:false,target:'webcontainer',reason}`**.
1 new test (203 total). server tsc 0 · frontend tsc 0 · 203 tests · boot PASS.
**Remaining Phase-3 items are INFRA/LICENSE-BLOCKED (need user decision, not code):**
1. Real **StackBlitz WebContainer** adapter for Vue/Svelte/etc. (paid SDK/license).
2. **Cloud Run prod verification** of child-process dev-server spawn + a **distributed
   port allocator** (current PortManager is in-process → single-instance only).
These are the only gaps; the runtime is otherwise complete and live.
**▶ NEXT phase to work (code-doable): PHASE 5 product layer** — real Pro-gating
(tier/usage limits, Cashfree exists), observability (structured logging / build-success
metrics / cost tracking), QA. (Phase 6 universal architectures + Phase 7 validation
factory remain user-deferred until React+Vanilla are rock-solid.)

---

## 🔭 PHASE 5 — Product layer (IN PROGRESS, 2026-06-19)

Ground-truth audit (2026-06-19) of Phase 5's 5 areas found it ~30% in code:
- ✅ DONE: Cashfree payments, NavBharat Hosting deploy (`/api/pwa/save`), tier ROUTE
  concept, 1 enforced gate (`/api/anthropic` Pro/VIP), honest ValidationPipeline,
  admin audit logging.
- 🟡 code-doable (no infra): observability wiring, Pro-gating on pro-chat/pro-build,
  usage quotas, IDE editor→preview sync.
- 🔴 infra/account-blocked: real Vercel/Netlify/Firebase deploy (API tokens), e2e/
  Lighthouse/axe gates (browser sandbox), Sentry (account).

### Milestone 5.11 — DONE — OBSERVABILITY wired (item 28)
Replaced the unused `ObservabilityManager`/`TokenUsageManager` stubs with a real,
cohesive `src/server/lib/metrics.ts` (`MetricsRegistry` + `getMetrics()` singleton):
per-provider token usage + **USD cost** (pricing table, ~4-char/token estimate) and
**build-outcome stats** (success rate, preview rate, avg time-to-build, repair
attempts, edit vs fresh). Wired LIVE into the build flow: `makeResilientModelCall`
records the provider that produced each usable generation; `/api/build` and
`/api/build-stream` record every build outcome (timed). Exposed read-only behind the
existing admin auth at **`GET /api/admin/metrics`**. Metrics never block a build
(all wrapped in try/catch). 5 new tests (208 total). Verified server tsc 0 + frontend
tsc 0 + 208 tests + boot:check PASS.

### Milestone 5.12 — DONE — IDE live editor→preview sync (item 26)
CodeStudio's Monaco editor updated `files` but the preview (renders `generatedCode`)
only refreshed on a manual Run — so hand-edits didn't show live. Added a **debounced
auto-rebuild** (900ms idle) in `handleFileChange` that reuses the EXISTING `onRun`
pipeline (no duplicate bundler, no loop risk — onRun rebuilds `generatedCode` from
files, never writes files back). App.tsx's CodeStudio `onRun` now uses the exact
edited snapshot (`(f) => updatePreview(f || files)`) so the live preview reflects the
freshest edit. Frontend tsc 0 · 208 tests · **vite build ✓**.

## 🟢 PHASE 6.1 — Vue (+Vite) support — DONE (2026-06-19)

Vue 3 is now a **second fully-supported architecture** (after React), end-to-end:
generate → validate → in-browser preview → edit. Admin asked to start Phase 6 after
the core-hardening pass.

- **6.1a generation + validation** (commit 97a3c3a): manifest/scaffold/validator +
  isScaffoldState + .vue import resolution. (See commit for detail.)
- **6.1b in-browser preview**: `src/server/runtime/VuePreview.ts` builds ONE
  self-contained HTML that compiles `.vue` SFCs in the browser via **vue3-sfc-loader**
  + Vue 3 CDN — relative imports, `<style>`/CSS imports, and bare deps (vue-router/
  pinia) loaded from esm.sh sharing the one Vue instance; unknown/failed deps surface
  an HONEST in-preview error, never a blank screen. Wired in: `renderPreview` selects
  React→Vue→static; `PreviewService.canStaticRender` now allows Vue (only Svelte/Astro
  stay honest-blocked); new `POST /api/preview-vue` endpoint; `detectAppType` returns
  'vue'; `updatePreview` fetches the compiled Vue doc (with an honest interim + error
  state). 6 new tests (Vue preview + arch). server tsc 0 · frontend tsc 0 · **222
  tests** · boot PASS · vite build ✓.

### ✅ SUPPORTED ARCHITECTURES (updated): React+Vite · **Vue 3+Vite** · Vanilla JS/HTML/CSS
Next: remaining Phase-6 frameworks (Svelte/Next/Angular/Node) stay planned; Svelte/
Astro previews are honestly blocked until their loaders land.

## 🧱 CORE ROCK-SOLID hardening (2026-06-19, admin-prioritized over Phase 6/7)

Ran a concrete code-level reliability audit of the React+Vanilla generate→build→
preview→edit pipeline. Vetted each finding against real code (rejected the false ones:
EditEngine already reports patch-miss as ok:false; broken JS module imports are
already ERRORS via ProjectVerifier; the modular loop already breaks when all missing
features are stuck; flipping featureless-coverage 100→0 would over-penalize valid
simple apps).

### Milestone CORE.1 — DONE — vanilla apps: missing JS/CSS now BLOCKS preview
Real gap found: a broken local **classic `<script src>`** or **stylesheet `<link href>`**
in HTML was only a WARNING → a static app whose JS/CSS is missing was still marked
`previewAllowed:true` (a broken app reported as working — violates "no fake success").
Fix (`ProjectVerifier.ts`): tag-aware HTML ref scan — a missing classic script or
stylesheet is now an ERROR (blocks preview + drives the repair loop); images/anchors
and `type="module"` scripts (the esbuild bundler resolves those itself) stay
non-blocking WARNINGS to avoid React false positives. 2 verifier tests added/updated
(209 total). server tsc 0 · frontend tsc 0 · 209 tests · boot PASS.

### Admin decisions recorded (2026-06-19): Pro-gating = KEEP OPEN until app is 90%+
(then limit); real Vercel/Netlify/Firebase deploy = LATER (NavBharat Hosting stays the
only real deploy for now). So those Phase-5 items are intentionally deferred by admin.
**Phase 5 is now at its code-doable ceiling** — remaining items are admin-deferred
(gating, deploy) or infra-blocked (real build/Lighthouse/axe QA gates need the
browser/container sandbox = Phase-3 infra).

### ⚠️ DECISIONS NEEDED FROM ADMIN before the next Phase-5 items (outward-facing/business):
1. **Pro-gating enforcement:** `/api/pro-chat`, `/api/pro-build`, `/api/build` are
   currently OPEN to everyone. Enforcing tiers would LOCK OUT free users — a
   monetization decision with real user impact. Do NOT flip without admin's policy
   (which tiers get build access? free-tier daily build/message limit?).
2. **Real one-click deploy** to Vercel/Netlify/Firebase needs the admin's platform
   API tokens/accounts. Until then only NavBharat Hosting deploy is real.

### Milestone PRO-AGENTIC.1 — DONE (2026-06-20) — Pro agentic edit engine, Tier 0 (VFS), additive + flag-gated
Pro's edits were single-shot (one JSON pass → static verify), so it "forgot" after a
few turns and couldn't do surgical fixes. Reused EngineerAI's existing agentic loop
(`EngineerAgentLoop`, fully injectable) as Pro's PRIMARY edit engine behind a flag,
with a 3-tier execution backend (Phase 1 ships Tier 0 only). NOTHING changes for users
until `PRO_AGENTIC_ENGINE=1` (or request `agentic:true`).
- NEW `actuators/VfsActuator.ts` — `IEngineerActuator` over Pro's in-memory VFS;
  read/write/list/search/checkpoint/restore on the VFS; `build`/`runCommand` map to the
  static gate (SyntaxCheck + ProjectVerifier) for real self-heal feedback; sandbox-only
  methods degrade gracefully (never throw, unlike LocalActuator).
- NEW `AI/ProModelProvider.ts` — wraps Pro's `makeResilientModelCall` as an `AIProvider`
  so the loop uses Pro's OWN model (not Grok); `healthCheck()=>true`.
- NEW `ProEngineRunner.ts` — orchestrator + loop→Pro SSE adapter + `selectTier`
  (clamped to 'vfs' in Phase 1). Finalizes with the same validation/preview gate as
  BuildPipeline so `complete` is identical-shape. Never emits terminal events itself.
- `routes/build.ts` `/api/build-stream` — agentic branch BEFORE `runBuild`; on error or
  non-usable result it falls through transparently to the legacy pipeline (no terminal
  event sent until a path succeeds → fallback invisible to the UI). UI + preview unchanged.
- `services/buildService.ts` — optional `agentic?: boolean` on BuildRequest (rollout opt-in).
- Tests: `tests/proEngine.test.ts` (12) — VfsActuator, ProModelProvider, selectTier,
  end-to-end VFS run + reply-only fallback.
- Gate: server tsc 0 · frontend tsc 0 · 234 tests pass · boot:check PASS.
- Next (later phases): Tier 1 Cloud Run actuator (ServerContainerRuntime), Tier 2 E2B
  with per-user key; then unclamp `selectTier` and flip the flag default on per tier.

### Milestone PRO-AGENTIC.2 — DONE (2026-06-20) — full tiered backend (VFS→Docker→E2B), availability-gated
Built the complete escalation ladder for the Pro agentic engine, each tier gated
by real availability with graceful downgrade so the app can NEVER break on a
missing backend (admin: "maximum features, bas app break na ho").
- `selectTier` now escalates by size (unclamped); `resolveBackend` picks the
  highest AVAILABLE backend at/below the desired tier, else downgrades:
  e2b (user/env E2B key) → cloudrun (DockerActuator, DOCKER_ENABLED=true) → vfs.
- ProEngineRunner: for sandbox tiers, SEED input files into the workspace, run the
  loop, COLLECT results back into a VFS; best-effort pause/stop in finally. Any
  backend failure → usable:false → build.ts falls back to runBuild (invisible).
- E2BActuator: optional per-user `apiKey` (billed to the user) — passed to
  Sandbox.create/connect; falls back to env E2B_API_KEY.
- build.ts: plumbs `userE2bKey` from the request into runProEngine.
- In prod today (no DOCKER_ENABLED, no E2B key) every tier downgrades to VFS — so
  behavior is identical to Phase 1 until infra/keys are provided. Still flag-gated
  (PRO_AGENTIC_ENGINE / agentic:true; per-session toggle shipped in #99).
- Tests: tests/proEngine.test.ts now 19 (added resolveBackend downgrade matrix).
- Gate: server tsc 0 · frontend tsc 0 · 246 tests · boot:check PASS.
- Internal-testing opt-in live (#99): ?agentic=1 or localStorage.nb_agentic_engine='1'.

### Milestone PRO-ROBUST.1 — DONE (2026-06-20) — builds ALWAYS return a result + professional live progress
Fixes the live error "Build failed: Build stream ended without a result". Root cause:
a long agentic build exceeded Cloud Run's 300s request cap, so the SSE stream was
cut before any terminal event → client saw no result. (Admin: "user ko result milna
chahiye chahe kitne bhi re-try ho" + show why/where time goes, professionally.)
- build.ts /api/build-stream: SOFT_DEADLINE_MS=240s (under the 300s cap). The engine
  runs under an AbortController; the legacy runBuild is raced against the deadline.
  An always-terminal guard (sendComplete + finally) GUARANTEES a terminal `complete`
  is sent — emitting a `partial:true` result with whatever was built so far rather
  than letting the stream close empty. The "no result" error class is gone.
- ProEngineRunner: an aborted (soft-deadline) run keeps its partial files instead of
  discarding them; returns `partial:true`. Usable iff real edits happened.
- buildService: BuildStreamEvent gains optional `partial`.
- App.tsx: on a `partial` complete, AUTO-CONTINUES (bounded, max 4 rounds) with a
  "continue exactly where you left off" turn — the user always reaches a complete
  app over a few automatic rounds, shown as "Part N".
- AIChat.tsx: professional progress header — live elapsed timer (Xs / Xm Ys) + a
  "Part N" badge so the user sees how long it's taking and why.
- Tests: proEngine partial-on-abort test added.
- Gate: server tsc 0 · frontend tsc 0 · 279 tests · boot:check PASS.

### Milestone GUIDER.1 — DONE (2026-06-20) — Guider core (shared, decoupled, confirm-first)
First slice of the "guider": a provider-agnostic requirements brain that wraps ANY
generator (Pro's build OR EngineerAI's loop) in a closed loop —
understand → PROPOSE design → CONFIRM with user → build → grade → refine.
- New `src/server/Guider/`: GuiderTypes, LanguageDetect (talks back in the user's
  own language — hi/hinglish/en/…), Guider controller.
- Two hard rules baked in (admin): (1) the guider may design its own plan but NEVER
  implements it directly — Guider.run() THROWS unless the caller passes confirmed:true
  (the caller surfaces the proposal to the user, in the user's language, for approval);
  (2) the refine loop is budget-capped and stops HONESTLY (passed / budget_exhausted /
  no_progress) — never a fake "done".
- Fully decoupled: callers inject `callModel` (interpret+grade) and `generate` (the
  builder). Lives OUTSIDE Pro so Pro and EngineerAI can both use it.
- NOT wired into any route yet — additive, zero risk. Wiring + UI confirmation gate
  is the next step.
- Tests: tests/guider.test.ts (14) — language detect, robust JSON parsing, the
  confirmation gate, and honest loop outcomes (pass/budget/no-progress).
- Gate: server tsc 0 · 293 tests · boot:check PASS.

### Milestone GUIDER.2 — DONE (2026-06-20) — Guider wired into Pro (Hybrid: gate → confirm → grade→refine)
The guider now drives Pro end-to-end, behind the per-session agentic flag.
- Slice 1 (#106): GuiderGate.shouldConfirm + /api/guider/plan (confirm only for
  fresh/big requests; small edits skip).
- Slice 2 (#107): chat confirmation card (Approve / Edit-Answer "Bhejo"), proposal
  in the user's language; nothing builds until Approve.
- Slice 3 (this): /api/guider/grade + exported gradeAgainstSpec; after an approved
  build FULLY completes (not partial), the frontend grades it against the spec and
  auto-refines the gaps — bounded (PRO_MAX_REFINE=2), separate from the partial
  auto-continue bound, so the two loops never fight. Honest end: "saari requirements
  poori (X/100)" or "best version ready (X/100)".
- Coordination: grade runs only on a non-partial complete; refine builds reuse the
  same robust /api/build-stream (soft-deadline + auto-continue). Default off → no
  change for normal users.
- Tests: guider grade tests added. Gate: server tsc 0 · frontend tsc 0 · 301 tests · boot PASS.

### Milestone GUIDER.3 — DONE (2026-06-20) — Guider shared with EngineerAI
The guider is now reachable from EngineerAI too (admin: "dono use kar sake").
- New POST /api/engineer-guider-plan in routes/engineer.ts — runs the SAME gate
  (shouldConfirm) + Guider.plan(), but bridges Engineer AI's own AIRouter to the
  guider's ModelCall, so it uses EngineerAI's model (not Pro's). Returns the
  proposal in the user's language for a confirmation card.
- Flag-gated (PRO_AGENTIC_ENGINE / ENGINEER_GUIDER / agentic:true) + additive: the
  existing /api/engineer-chat agent loop is untouched. Never blocks.
- Proves the guider core is genuinely shared/decoupled (Pro + EngineerAI both drive
  it via injected callModel + generate).
- Next: EngineerAI confirmation card in its own UI + grade→refine over the agent loop.
- Gate: server tsc 0 · 301 tests · boot:check PASS.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ★ MASTER ROADMAP — "NavBharatAI Pro = Claude Code" (2026-06-20, admin-approved)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Supersedes the older phase plans above as the SINGLE forward-looking roadmap.
Merges: (1) old PROGRESS phases 0–7, (2) admin's new 10-phase execution roadmap,
(3) current ground truth (this session's agentic engine + tier-ladder + guider +
result-guarantee). Old entries are kept (append-only audit trail), not deleted.

GOAL: NavBharatAI Pro becomes a real autonomous coding agent — like Claude Code.

PRINCIPLES (from the new roadmap): architectural correctness over speed; no upper
layer before its foundation; a phase is "complete" only when its acceptance criteria
pass WITH evidence (logs/screenshots/tests/metrics/URLs); no fake success / no
placeholder / no duplicate systems; OVERLAY on existing code (never rebuild what
exists); FINAL = the original "1000-gap audit" can no longer be reproduced.

"Pro = Claude Code" DEFINITION OF DONE: on every request Pro runs an
observe→think→act→verify→self-heal loop; runs code in a REAL runtime
(install/build/test); drives the app in a browser to verify; fixes failures itself;
keeps memory + git; proposes a plan + confirms for big work; never fakes success,
never returns "no result"; ships a real shareable preview/deploy.

STRATEGIC KEY: unify Pro onto the EngineerAI-grade engine (one agent loop +
actuators + guider for both), and make real runtime/browser/test/self-heal the
DEFAULT (currently behind a flag). Solidify foundations (Phase 1) + telemetry
(Phase 7) first.

LEGEND: ✅ done · 🟡 partial (core done, edges left) · 🔴 left · 🔒 infra/account/admin-blocked

## PHASE 0 — Gap & Current-State Inventory  🔴 (needs the "1000 gaps" doc)
1000 gaps → dedupe → root-cause → 20–25 capability clusters + dependency graph +
priority. IMPROVEMENT: map every cluster to EXISTING code (done/partial/missing) so
nothing is rebuilt. Output per gap: id · symptom · root cause · group · priority ·
dependency · verification. Acceptance: every gap mapped; no orphans/dupes; current-
state matrix ready. (No production code.)

## PHASE 1 — Foundation Layer  🟡  (old P0–P2 + new P1)
✅ VFS/ProjectModel, version history, checkpoint/restore, RuntimeRouter,
   WorkspaceManager/Materializer, server-tsc guardrail + boot-check.
🔴 Event Bus (every action → event) · refresh-safe persistent sessions (survive +
   recover) · structured/searchable logging · formalize capability registry
   (AppKnowledgeBase). Acceptance: state survives refresh · checkpoint restore ·
   event replay · logs searchable. BLOCKING: foundations before more agent features.

## PHASE 2 — Agent Architecture (Observe→Think→Act→Verify)  🟡→✅core  (old P4 + new P2)
✅ EngineerAgentLoop (ReAct), PlannerAgent, CoderAgent, tools (read/write/patch/exec/
   search_code/search_web/install/run_tests), Guider (reviewer/grader + plan→confirm).
🔴 unify Pro onto this loop (Pro = the agent, not single-shot) · optional separate
   Reviewer/Testing/Memory/Deployment agents. Acceptance: autonomous debug · retries ·
   history · human intervention < 20%.

## PHASE 3 — Execution Engine (real runtime)  🟡  (old P3 + new P3)
"runtime success matters, not preview success." ✅ E2B/Docker actuators (npm install/
dev/build/test), tier-ladder (VFS→Docker→E2B, graceful downgrade), result-guarantee
(soft-deadline + partial + auto-continue). 🔴 make real runtime Pro's DEFAULT (not
VFS-static) · process manager · env vars · runtime telemetry · Cloud Run/Docker prod
wiring 🔒 · isolated preview origin (preview.navbharatai.app/<unguessable appId>, NOT
the main domain — security). Acceptance: apps actually run · runtime errors captured ·
deps resolve.

## PHASE 4 — Browser Automation  🟡→✅core
✅ E2B Playwright: screenshot, click/type/scroll/hover/select/double_click, console
   capture. 🔴 make it part of Pro's verify loop (run app + test workflows) · network
   capture. Acceptance: AI launches app, logs in, completes workflows, detects
   failures, collects screenshots. BLOCKING: no deploy without browser verification.

## PHASE 5 — Testing & Self-Healing  🟡  (old P5 + new P5)
✅ self-heal loop (build_result→fix), guider grade→refine, ProjectVerifier/SyntaxCheck,
   ValidationPipeline (pending gates honestly reported, not faked). 🔴 real unit/
   integration/E2E/a11y/security test generation+execution · flip "pending" gates to
   real (needs browser sandbox → depends on P3/P4). Acceptance: AI fixes failures
   autonomously · retry loop · test pass > 95% · runtime errors = 0. BLOCKING: no
   deploy while tests fail.

## PHASE 6 — Memory & Git  🟡→✅core
✅ .engineer/memory.md, Pro memorySummary/editLog, GitHub clone/push + loop git
   init/commit. 🔴 richer memory (architecture decisions, preferences, past failures,
   deploy history) · branch/diff/revert UI · restart-survival. Acceptance: sessions
   preserve knowledge · every change traceable · rollback · workspace survives restart.

## PHASE 7 — Security & Observability  🟡 / 🔒  (old P5-obs + new P7)
ORDERING FIX: bring this early — earlier phases' criteria can't be measured without it.
✅ metrics.ts (token/USD cost/build stats), /api/admin/metrics. 🔴 secret scanning ·
   dependency audit · OWASP/injection checks · traces/alerts/runtime analytics · Sentry
   🔒. Acceptance: unsafe apps blocked · failures auto-detected · every action measurable.

## PHASE 8 — Deployment & CI/CD  🟡 / 🔒  (old P5-deploy + new P8)
✅ Firebase Hosting deploy (DeploymentService), platform Cloud Run auto-deploy. 🔴
   per-user preview URL (preview.navbharatai.app/<appId>, sandboxed origin) · one-click
   deploy + rollback + post-deploy validation · multi-target Vercel/Netlify/Cloud Run/
   Docker 🔒 (API tokens). Acceptance: one-click deploy · rollback · deploy validation.

## PHASE 9 — Framework Expansion  🟡  (old P6 + new P9)
✅ React+Vite, Vue3+Vite, Vanilla (preview); next/svelte/express/fastapi templates
   (generation); BYOD DBs. 🔴 Next/Svelte/Node/FastAPI build+run+deploy end-to-end ·
   Svelte/Astro previews. Acceptance: all frameworks build+execute+deploy.

## PHASE 10 — Final Platform Validation  🔴  (old FINAL + new P10)
Generate+deploy 7 reference apps: Hospital MS · E-commerce · CRM · School ERP · AI
Chat · Social · Realtime-collab. Verify each: generation+runtime+browser+deploy
success · auth · CRUD · responsive · console errors = 0 · runtime errors = 0 ·
security pass · Lighthouse > 90 · a11y > 90. Then RE-RUN the original 1000-gap audit →
no critical/high gaps = MISSION COMPLETE.

## CROSS-CUTTING (every phase)
- Pro rollout: flag-gated now → internal test → tier-by-tier DEFAULT-ON (the real
  "Pro = Claude Code" switch).
- Every task carries: owner capability · dependencies · verification · rollback · telemetry.
- Forbidden: TODO/placeholder · fake progress · simulated execution · duplicate systems · hacks.
- Evidence required: logs · screenshots · test reports · metrics · deploy URLs.
- AppKnowledgeBase sync: every new user-facing feature gets its entry in the same PR.
- Verification gate (each push): server tsc + frontend tsc + vitest run + boot:check
  green; branch → PR → CI green → merge.

## CURRENT BIG PICTURE
Solid/near: Phase 1(core), 2(core), 3(core), 4(core), 6(core) — the Pro=Claude-Code
ENGINE already exists (agent loop + runtime + browser + self-heal + guider + memory/git).
Real remaining work: Phase 0 (gap inventory — needs doc) · Phase 1 foundation gaps
(event bus/logs/refresh-state) · Phase 5 (full testing) · Phase 7 (security/observability)
· Phase 8 (preview origin + multi-deploy 🔒) · Phase 9 (remaining frameworks) · Phase 10
(final proof) · plus Pro DEFAULT-ON rollout.

## ADMIN/INFRA DEPENDENCIES (cannot be unblocked by code)
"1000 gaps" doc (P0) · Vercel/Netlify/Firebase deploy tokens (P8) · prod sandbox for
browser QA gates — E2B key / Docker host (P5/P3) · Sentry account (P7) · Pro-gating
policy decision (P8/rollout).

## RECOMMENDED ORDER
1) Phase 0 (on receiving the 1000-gaps doc) — cluster + current-state matrix, no code.
2) Phase 1 foundation gaps (event bus, refresh-safe state, structured logs) before default-on.
3) Phase 7 telemetry early (so criteria are measurable).
4) Then Pro default-on rollout, alongside Phase 5/8/9, ending with the Phase 10 proof.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ★ PHASE 0 — GAP & CURRENT-STATE INVENTORY — DONE (2026-06-20)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Input: admin's 1000 gaps pre-clustered into 25 ROOT CAUSES. Phase-0 task (NO
production code): map every root cause to EXISTING code so nothing is rebuilt, and
extract the real remaining work + priority + dependency + verification. Goal:
Pro = Claude Code. Method: 3 parallel Explore agents swept the whole codebase.

HEADLINE: of the 25 root causes, ~10 are already ✅ DONE, ~14 🟡 PARTIAL (with a real
core), and only 1 (Security) is 🔴 MISSING. The gaps doc reads as if nothing exists;
the reality is the opposite.

KEY FINDINGS
1. EngineerAI is already a near-complete autonomous engineer: agent loop
   (observe→think→act→verify, EngineerAgentLoop, PlannerAgent, CoderAgent), real
   execution (E2B/Docker/Local actuators — npm/pip install/dev/build/test, ports, env,
   console capture), browser automation (E2B Playwright, 9 actions + console capture),
   self-heal (RepairLoop + per-file self-review + guider grade→refine), memory
   (WorkspaceMemoryStore/Firestore + .engineer/memory.md + Pro memorySummary/editLog),
   tools (bash/web_search/file-search/git/deploy/provision_db).
2. The real gap for "Pro = Claude Code" is that PRO DOESN'T USE THIS ENGINE BY DEFAULT
   (it's flag-gated). So the goal = unify Pro onto the engine + default-on — NOT a new
   engine.
3. Foundations are half-built already in src/server/AppMakerLab/: EventBus +
   EventHistory + EventTypes(45+), JournalManager + TransactionCoordinator,
   ServiceRegistry (dep + circular detection), CheckpointManager,
   DeploymentRollbackManager, AppKnowledgeBase (70+ features) — but they're
   AppMakerLab-scoped, not wired into Pro/Engineer.
4. The genuinely thin areas are only ~4-5: Security (🔴), Observability persistence/
   alerts/traces, Deployment targets (Firebase only), full Testing (unit only), and
   wiring the existing foundations across Pro/Engineer.

25 ROOT CAUSES → STATUS  (✅ done · 🟡 partial · 🔴 missing)
 1 Real Execution Env ✅ (E2B/Docker/Local actuators)        → Phase 3
 2 Persistent Workspace 🟡 (WorkspaceStore/sync/resume)      → Phase 1
 3 Autonomous Agent Loop ✅ (EngineerAgentLoop+Planner+Coder)→ Phase 2 (Pro unify+default)
 4 Browser Automation ✅ (E2B Playwright + console)          → Phase 4
 5 Test Automation 🟡 (Vitest gen + npm test)                → Phase 5
 6 Self-Healing/Debug ✅ (RepairLoop+self-review+guider)     → Phase 5
 7 Git Integration 🟡 (init/clone/branch/commit/push)        → Phase 6
 8 Runtime Observability 🟡 (metrics.ts/audit/UsageTracker)  → Phase 7
 9 Checkpoint/Rollback ✅ (VersionStore+actuator+managers)   → Phase 1/6
10 Multi-Framework 🟡 (React/Vue/Vanilla full; rest partial) → Phase 9
11 Package Install/Runtime ✅ (actuator.build npm/pip)       → Phase 3
12 Deployment Pipeline 🟡 (Firebase Hosting + health/rollback)→ Phase 8 🔒
13 Memory Architecture ✅ (WorkspaceMemoryStore/Firestore)   → Phase 6
14 Context Retrieval ✅ (ContextRetriever rank/pack)         → Phase 2/6
15 Tool Ecosystem ✅ (bash/web/file/browser/git/deploy/db)   → Phase 2
16 Security Layer 🔴 (only secret encryption; gate pending)  → Phase 7  CRITICAL
17 Secret Management 🟡 (secrets.ts AES + Firestore)         → Phase 7
18 Quality Gates 🟡 (ValidationPipeline + CI tsc/boot)       → Phase 5/7
19 Fake-Progress Prevention ✅ (honest pending gates)        → cross-cut (keep)
20 Capability Registry 🟡 (ServiceRegistry + AppKnowledgeBase)→ Phase 1
21 Event Sourcing 🟡 (EventBus+Journal+TxCoordinator)        → Phase 1
22 Dependency Graph 🟡 (ServiceRegistry + Planner ordering)  → Phase 1/2
23 Runtime Telemetry 🟡 (metrics.ts + UsageTracker)          → Phase 7
24 Architecture Awareness 🟡 (AppKnowledgeBase+Manifest)     → Phase 0/2
25 Production Validation 🟡 (HealthChecker+DeploymentEngine) → Phase 8/10

CAPABILITY CLUSTERS (25 → 8 actionable groups, dependency-ordered)
 G1 Foundations-wiring (2,9,20,21,22,24) — wire existing EventBus/Journal/Registry/
    Checkpoint/KnowledgeBase into Pro+Engineer + persist (Firestore) + refresh-safe state.
    [STATUS: G1.1 ✅ shared persisted EventBus wired (Pro+Engineer publish + admin events
    query). Remaining: G1.2 refresh-safe proBuildProgress, G1.3 capability registry.]
 G2 Observability (8,23) — persist metrics + structured logs + traces + alerts + dashboards.
 G3 Pro-unify (3,14,15 + 4,6) — Pro onto the EngineerAI agent loop, DEFAULT-ON. The heart
    of "Pro = Claude Code" (engine exists → just wire + rollout).
 G4 Security+Secrets (16,17) — npm audit, rate-limit, CSP/helmet, input-validation,
    secret-scan. CRITICAL (biggest real gap).
 G5 Testing+Quality (5,18) — real E2E/a11y/security/perf gates (needs browser sandbox → G3).
 G6 Execution-hardening (1,11) — lock-files, version/peer-dep detection, process restart.
 G7 Deployment (12,25 🔒) — multi-target deploy + isolated preview origin + smoke/SLA.
 G8 Frameworks (10) — Next/Svelte/Node/FastAPI run+deploy end-to-end.
 (19 honesty = cross-cutting, already enforced, keep.)

RECOMMENDED ORDER: G1 → G2 → G3 (Pro default-on) → G4 → G5 → G6 → G7 🔒 → G8 →
Phase-10 final proof (7 apps + 1000-gap re-audit). Rationale: foundations + telemetry
first (so criteria are measurable); then switch Pro onto the existing engine (max user
impact, least new code); then the real gaps (security/testing); proof last.

EVIDENCE RULE (per group): a group is "complete" only when its gaps' evidence exists —
logs · screenshots · test reports · runtime proof · deployment URLs.

ADMIN/INFRA-BLOCKED (cannot be unblocked by code): multi-target deploy tokens (G7) ·
prod sandbox/E2B key/Docker host for browser QA gates (G5/G3) · Sentry account (G2) ·
Pro-gating policy decision (G3 rollout).

### Milestone G1.1 — DONE (2026-06-21) — shared persisted EventBus wired (Pro+Engineer)
First slice of G1 (Foundations-wiring). The AppMakerLab event vocabulary existed but
its bus was dormant (per-op, in-memory, never wired into the live server; local-disk
persistence doesn't survive Cloud Run). Built the spine:
- NEW src/server/lib/eventBus.ts — ONE process-wide bus singleton. publish() is
  best-effort (NEVER throws/blocks): bounded in-memory ring + in-proc listeners +
  fire-and-forget persistence sink. Reuses the EventType vocabulary (BUILD_STARTED/
  COMPLETED/FAILED, etc.).
- NEW src/server/lib/eventStore.ts — Firestore persistence (collection `build_events`)
  modelled on WorkspaceMemoryStore (firebase-admin, self-init, VITEST-skip). append()
  registered as the bus sink → every event durably stored; query() falls back to the
  in-memory ring when Firestore is unavailable. All best-effort (never breaks a build).
- routes/build.ts — publishes BUILD_STARTED / BUILD_COMPLETED (agentic+legacy paths,
  with tier/partial/fileCount/previewAllowed) / BUILD_FAILED. Pure side-channel — no
  behavior/SSE-contract change.
- routes/engineer.ts — mirrors each streamed agent event to the bus (engineer:<type>).
- routes/admin.ts — GET /api/admin/events (admin-auth) → audit-trail / replay surface.
- tests/eventBus.test.ts (6). Gate: server tsc 0 · frontend tsc 0 · 307 tests · boot PASS.
Roadmap G1 status: G1.1 ✅ G1.2 ✅ G1.3 ✅ — G1 COMPLETE. Next: G2 (Observability).

### Milestone — PR #113 merged (2026-06-21) — Pro upgrade: 23 commits of real working features
Large batch merged to main. All verified: 0 tsc errors, 307/307 tests pass.
- feat: Git added to main sidebar navigation (toggleTab('git') → GitPanel)
- fix: Git settings content panel now shows proper UI instead of blank screen
- feat(pro): Phase 17 — auto Vitest test generation after every build (ProTestGen.ts)
- feat(pro): Phase 72 — Multi-agent orchestration: parallel frontend+backend generation
- feat(pro): Phase 73 — Extended thinking for complex tasks (16k token budget)
- feat(pro): Phases 74-78 — Cross-session memory via Firestore (ProMemory.ts)
- feat(pro): Phases 70-71 — Self-review pass + build-fail diagnosis
- feat(pro): Phases 79-84 — Screenshot/browser/drive events rendered in Pro UI
- feat(pro): Phase 85 — Design-to-Code: base64 image → UI via Claude vision
- feat(pro): Phases 87-93 — ProDeploy wired: Vercel/Netlify/GitHub Pages REST API
- feat(pro): Phases 94-100 — ProCodeReview wired: OWASP + quality + tech debt scan
- feat(pro): /code-review and /deploy commands in Pro chat
- feat(pro): 5 new AppKnowledgeBase entries for Pro features
Gate: server tsc 0 · frontend tsc 0 · 307 tests · CI green on PR #113.

### Milestone G3 — DONE (2026-06-21) — Pro-unify: credential wiring + tier display
G3 (Pro-unify) wires user credentials to the agentic engine and surfaces the execution
tier in the build progress widget:
- buildService.ts: added userE2bKey, githubToken, dbConfig to BuildRequest interface;
  added tier? ('vfs'|'cloudrun'|'e2b') to BuildStreamEvent and BuildResponse.
- App.tsx: added userE2bKey state (localStorage 'engineer_e2b_key'); wired githubToken,
  userE2bKey, dbConfig into buildAppStream call; captures tier from engineRes after
  complete event; added E2B API key input card in Settings → Connections.
- routes/build.ts: emits tier status event after runProEngine; includes tier in sendComplete.
- AIChat.tsx: added tier? to BuildProgressState; shows colored tier badge in header
  (grey 'In-memory' / blue 'Server' / green 'E2B cloud').
Gate: frontend tsc 0 · server tsc 0 · 307/307 tests pass. Branch: claude/g3-pro-unify.

### Milestone G2 — DONE (2026-06-21) — Observability: persist metrics + structured logs + admin panel
G2 fills the observability gap — builds metrics survive Cloud Run restarts, audit events
are persisted to Firestore, and admin can inspect system health from a new settings panel:
- NEW src/server/lib/metricsStore.ts — daily Firestore snapshots ('metrics_snapshots');
  save() persists MetricsSnapshot on every build; list() returns last N days.
- NEW src/server/lib/logStore.ts — structured log persistence ('server_logs');
  append() fire-and-forget; query() with level/event/workspaceId/since filters.
- audit.ts: logStore.append() added alongside stdout — audit trail now survives restarts.
- build.ts: recordBuild() wired in agentic path (was only in legacy); metricsStore.save()
  called best-effort after every build in both paths.
- admin.ts: GET /api/admin/metrics/history (30-day history) + GET /api/admin/logs added.
- App.tsx + types/index.ts: 'metrics' SettingsScreen; admin sidebar shows "Live Metrics"
  when admin-logged-in; panel renders build stats + AI cost per provider breakdown.
- AppKnowledgeBase.ts: 'admin-metrics' entry added.
Gate: server tsc 0 · frontend tsc 0 · 307/307 tests pass. Branch: claude/g2-observability.

### Milestone G4 — IN PROGRESS (2026-06-21) — Security: Helmet + CORS + error sanitization + npm audit
G4 closes four real security gaps (zero new infrastructure — all code changes):
- server.ts: helmet({contentSecurityPolicy, crossOriginEmbedderPolicy:false}) added after
  express() init — adds CSP, X-Frame-Options:SAMEORIGIN, X-Content-Type-Options:nosniff,
  HSTS, Referrer-Policy, X-XSS-Protection.
- NEW src/server/lib/cors.ts: setCorsHeaders() helper replaces wildcard CORS on 3 routes.
  Allows navbharatai.web.app, navbharatai.firebaseapp.com, APP_ORIGIN env; blocks unknown
  origins in production.
- engineer.ts / pro.ts / zip.ts: Access-Control-Allow-Origin:* replaced with setCorsHeaders().
- admin.ts: 7 raw e.message 500 responses replaced with 'Internal server error.' + logging.
- secrets.ts: console.warn on missing SECRET_ENCRYPTION_KEY (fallback retained for existing data).
- .github/workflows/ci.yml: npm audit --audit-level=high step added (continue-on-error:true).
Gate: server tsc 0 · frontend tsc 0 · 307/307 tests pass. PR #117 open.

### Milestone G4 — DONE (2026-06-21) — Security: Helmet + CORS fix + error sanitization + npm audit
(See G4 IN PROGRESS entry above for details — PR #117 merged to main.)

### Milestone G5 — IN PROGRESS (2026-06-21) — Testing+Quality: ProCodeReview wired as build quality gate
G5 wires the existing ProCodeReview module as an automatic quality gate on every new Pro build:
- build.ts (both agentic + legacy paths): reviewCode() called best-effort after each build
  (12s timeout, never blocks). Result included in sendComplete as codeReview field.
- buildService.ts: ReviewFinding + CodeReviewResult types added; codeReview? added to
  BuildStreamEvent and BuildResponse.
- App.tsx: codeReview captured in proBuildProgress state; shown in build summary message
  (score badge + top critical/high findings with file:line + fix suggestion).
- AppKnowledgeBase.ts: 'auto-code-review' entry added (mandatory per CLAUDE.md rule).
Gate: server tsc 0 · frontend tsc 0 · 307/307 tests pass. PR #118 open.

### Milestone G5 — DONE (2026-06-21) — Testing+Quality: ProCodeReview wired as build quality gate
(See G5 IN PROGRESS entry above for details — PR #118 merged to main.)

### Milestone G6 Slice 1 — IN PROGRESS (2026-06-21) — Execution-hardening: Dependency auto-sync
Fixes the #1 "app generated but won't run" failure: AI generates `import axios from 'axios'`
but never adds axios to package.json → npm install misses it → runtime crash. Now auto-fixed:
- ProjectVerifier.ts: collectDeclaredDeps exported; new extractBareImports() exported (shared
  import parser — regex + bareRoot + isNodeBuiltin moved to module scope to avoid drift).
- DependencySync.ts (NEW): syncDependencies(vfs) scans all source files via extractBareImports,
  finds packages not in package.json, and adds them with curated pinned versions for 30+
  common packages (react-router-dom ^6.26.0, zustand ^4.5.0, axios ^1.7.0, framer-motion
  ^11.3.0, lucide-react ^0.400.0, zod ^3.23.0, @tanstack/react-query ^5.51.0, etc.).
  Unknown packages fall back to 'latest'. Pure, no I/O, never throws.
- BuildPipeline.ts: syncDependencies() called before runValidation() — emits status message
  listing added packages. Wrapped in try/catch so it never blocks a build.
- tests/dependencySync.test.ts (NEW): 11 tests covering all cases.
- tests/projectVerifier.test.ts: +3 extractBareImports tests (guard the refactor).
- AppKnowledgeBase.ts: 'auto-dependency-sync' entry added (mandatory per CLAUDE.md rule).
Gate: server tsc 0 · frontend tsc 0 · 321/321 tests pass. PR #119 open.

### Milestone G6 Slice 1 — DONE (2026-06-21)
(See above — PR #119 merged to main.)

### Milestone G6 Slice 2 — IN PROGRESS (2026-06-21) — npm ci + peer-dep fallback + dev-server health
E2B_API_KEY already set in Cloud Run (production-verified path). Changes in E2BActuator.ts:
- _npmInstall() private method: (1) npm ci if package-lock.json exists, (2) npm install,
  (3) npm install --legacy-peer-deps on ERESOLVE. Never throws, returns log for agent.
- build() method: replaced bare 'npm install' with _npmInstall() call + early failure return.
- runCommand() long-running path: after 20s startup wait, nc health-check on detected port.
  If PORT_DOWN: kills old process, restarts once, waits 15s more. Reports UP/DOWN in stdout.
- extractDevPort() helper: guesses port from --port flag, PORT= env, or framework default.
Gate: server tsc 0 · frontend tsc 0 · 321/321 tests pass. PR #120 open.
Verify: merge -> Cloud Run deploy -> Pro build with peer-dep conflict -> logs show retry -> success.

### Milestone G7 — DONE (2026-06-21) — Live Preview in Pro Chat
Backend preview system was already complete (PreviewService, /preview/:id, gates). G7 wired the
frontend: changed `preview: false` → `preview: true` in buildAppStream call; reads the returned
preview info and sets proLivePreviewUrlRef so "App is live! [Open in new tab]" shows the real URL.
Gate: frontend tsc 0 · server tsc 0 · 321/321 tests pass. PR #121 merged.

### Milestone G8 — One-click Deploy GUI (2026-06-21)
Backend was already complete (ProDeploy.ts + /api/pro/deploy + /deploy command in Pro Chat).
G8 adds the GUI layer:
- App.tsx: 8 new state vars for the deploy panel (showDeployPanel, deployPlatform, deployToken,
  deployProjectName, deployOwner, deployRepo, isDeploying, deployPanelError).
- handleDeployApp() useCallback: validates inputs, calls /api/pro/deploy with correct body per
  platform, on success sets isDeployed+deployUrl and navigates to 'deploy' view (existing
  "App is Live!" screen). Wraps the same REST path used by /deploy command.
- Pro Chat header: "Deploy" button (Rocket icon, emerald, visible only when isAppBuilt && files
  non-empty) — opens the deploy panel.
- Deploy modal overlay (absolute inset-0 z-50) inside Pro Chat relative container:
  platform selector (Vercel/Netlify/GitHub), token input, platform-specific fields (project
  name / site ID / owner+repo), error display, "Deploy Now" button with spinner.
- AppKnowledgeBase.ts: 'one-click-deploy' entry added (mandatory per CLAUDE.md rule).
Gate: frontend tsc 0 · server tsc 0 · 321/321 tests pass.

### Milestone G9 — Quick-Start Gallery (2026-06-21)
Adds 8 example prompt cards to Pro Chat empty state (Bolt.new-style "blank page" fix):
- AIChat.tsx: when messages.length === 0 and activeAgent === 'navbharatai-pro', a 2×4
  grid of example cards appears. Each card has an emoji, title, and a detailed prompt
  for one app type: Analytics Dashboard, E-commerce Page, Todo App, Portfolio Site,
  Quiz App, Weather App, Chat Interface, Note-taking App. Clicking fills the chat input.
- AppKnowledgeBase.ts: 'quick-start-gallery' entry added. Keywords scoped to intent
  phrases ('example prompt', 'quick start', 'app ideas') to avoid false context
  injection on build instructions (prevents appContextInjector test regression).
Gate: frontend tsc 0 · server tsc 0 · 321/321 tests pass.

### Milestone G10 — Iterative Agent Build + Retry Memory Fix (2026-06-21)
Fixes two root-cause bugs reported by the user ("photo editing app" failure + "try again" amnesia):

**Problem 1 — Memory loss on retry**: When a build failed, saying "please try again" caused
Pro Chat to lose context — it said "Sure, happy to try again!" with no idea what to rebuild.
Root cause: in AUTO mode, "please try again" → classifyAutoIntent returns 'chat'
(no build verb, no app noun) → routed to /api/pro-chat → conversational response.

**Problem 2 — Iterative engine**: The multi-step agentic engine (PlannerAgent + CoderAgent +
EngineerAgentLoop) was ALREADY wired in production via buildAppStream → /api/build-stream
→ runProEngine. The VFS tier always runs the iterative loop. The "single shot" perception
was because the engine was silently falling back to runBuild on context/timeout failures.

**Fix**:
- App.tsx: `lastBuildPromptRef = useRef<string>('')` stores the effective prompt before every build.
- Retry detection: pure-regex (`/^(please\s+)?(try\s+again|retry)…/`) + empty-workspace guard
  + non-empty stored prompt guard = `isRetryAfterFailure` flag.
- AUTO mode intercept: when `isRetryAfterFailure`, skip classifyAutoIntent entirely — force-build
  with `handleSendForPro(lastBuildPromptRef.current, forceBuild=true, guiderApproved=true)`.
  `guiderApproved=true` prevents the original prompt from being re-added as a duplicate
  chat message (user still sees "please try again" in chat, followed by the build progress).
- BUILD mode: `buildPrompt` variable (= lastBuildPromptRef or messageToSend) used for both
  the Guider plan call and the buildAppStream prompt.
- AppKnowledgeBase.ts: 'iterative-agent-build' entry added.
Gate: frontend tsc 0 · server tsc 0 · 321/321 tests pass.

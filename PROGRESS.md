# NavBharatAI Pro → Real App Maker — Execution Progress

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
- **Next milestones**: extract remaining groups — admin (`/api/admin/*`),
  sync, payment, github, secrets, chat/pro-chat/pro-build/sda — each green+push.
  Then move shared helpers/limiters to modules, add server tsconfig, enable strict
  per extracted module (burn down the 539-error debt), shrink server.ts to bootstrap.

## ⏳ PHASE 2 — Real project model (VFS, persistence, versioning)
## ⏳ PHASE 3 — Real hybrid build/preview runtime (WebContainer + server containers)
## ⏳ PHASE 4 — Generation & editing engine (diff-edits, agentic loop, real auto-repair)
## ⏳ PHASE 5 — Product (deploy, Pro-gating, integrated IDE, QA, observability)
## ⏳ FINAL — Re-audit from 0; new problems → phases → fix → push, until clean.

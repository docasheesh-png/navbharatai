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

## ⏳ PHASE 1 — Break server.ts god-file (NEXT)
6,598 lines / 71 routes → domain routers + services + typed AI gateway; enable strict per module; server tsconfig. (See plan file.)

## ⏳ PHASE 2 — Real project model (VFS, persistence, versioning)
## ⏳ PHASE 3 — Real hybrid build/preview runtime (WebContainer + server containers)
## ⏳ PHASE 4 — Generation & editing engine (diff-edits, agentic loop, real auto-repair)
## ⏳ PHASE 5 — Product (deploy, Pro-gating, integrated IDE, QA, observability)
## ⏳ FINAL — Re-audit from 0; new problems → phases → fix → push, until clean.

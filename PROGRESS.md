# NAVBHARATAI PRO v2.0 — UNIFIED MASTER ROADMAP
### "The world's best browser-based AI app maker — Claude Code for everyone"

> **Full history of previous work (G1–G12, Phases 0–5) lives in `PROGRESS_ARCHIVE.md`.**
> Do NOT edit that file — it is a read-only audit trail. This file is the forward tracker only.

---

## HOW TO RESUME (read every new session, before touching anything)

1. `git fetch origin main && git log --oneline -10` — verify actual state, not doc state.
2. Find the **▶ CURRENT RESUME POINT** section below.
3. Read the phase's exit criteria — if they are met (tsc + vitest + smoke), mark DONE and move to next.
4. Never start a new phase until the current one's exit criteria are fully verified.
5. **Guardrails (non-negotiable every phase):**
   - `branch → small commits → tsc --noEmit + tsc -p tsconfig.server.json + vitest run → CI green → merge`
   - Kill-switch / feature flag for every behavior swap
   - Legacy archived read-only, never deleted
   - AppKnowledgeBase.ts updated in same PR as any user-facing change
   - 0.01% breakage doubt → stop and ask admin
   - "Preview is earned" — no fake success, ever

---

## ▶ CURRENT RESUME POINT

**Session 2026-06-22 (d) — Pro v3.0 BUILT end-to-end (P0 → P5). Merged to main: P0–P3b (#181–#189). Awaiting manual merge: P3.5–P5 (PR #191).**

⚠️ **CI INFRA NOTE:** From ~11:42 on 2026-06-22, GitHub Actions started failing at job startup (~4s, zero logs, even on an empty commit) — diagnosed as Actions minutes/spending-limit exhausted on this PRIVATE repo (all prior runs that day succeeded; the transition is abrupt and content-independent). **Admin must raise the Actions spending limit / wait for quota reset** to restore the automated gate. Until then, every v3.0 step below was verified with the EXACT CI commands locally (`tsc --noEmit` + `tsc -p tsconfig.server.json` + `vitest run` + `boot:check` + `npm run build`) and merged manually by admin. No red CI was merged on the basis of "skip the gate" — the gate ran locally.

**v3.0 phases shipped this session (all flag-gated OFF by default; AgentV3 module has ZERO live-path imports → live app unaffected):**
- **P0 #181** engine skeleton (types, AgentEventStream, WorkspaceState, featureFlag, honest route).
- **D4–D9** locked (hybrid sandbox; pricing 2.5×/5× Opus-equiv; persistence=user choice; admin-only beta; real engagement). Design doc `NAVBHARATAI_PRO_V3_DESIGN.md`.
- **P1 #182–#185** native tool-use engine: ClaudeClient + pricing, ToolCatalog + ToolDispatcher (7 tools→sandbox), AgentRunner loop, wired `/api/agentv3/chat` NDJSON stream.
- **P2 #187** Anthropic prompt caching (tools+system) — cuts cost.
- **P3a #188** client-side surface reducer (pure, tested).
- **P3b #189** live build UI: `useAgentV3Build` hook + `AgentV3Panel` (AI-team tracker + Files/Diff/Terminal/History from one stream).
- **P3.5** multi-agent "AI team": AgentRegistry (9 roles), `task` tool, SubAgent spawn (constrained nested agents, no deep recursion), agentRole attribution.
- **P3c** in-app: `AgentV3Launcher` (admin-only, self-hiding) mounted in App.tsx (1 import + 1 line); AppKnowledgeBase `agentv3_builder` entry.
- **P3d** live preview: `update_preview` tool → `preview` event → iframe Preview tab (app shows live as it builds).
- **P4** plan-mode approval: Approvals registry + `/api/agentv3/respond` + plan-gate + panel Approve/Reject (real bidirectional block).
- **P5** billing wired: `UserCostStore.record(userId, billedUsd)` (2.5×/5×) + CLAUDE.md admin-override recorded (scoped to AgentV3).
- Test count grew ~1049 → **1602 passing** (~50 new AgentV3 tests). 
- **To run live (admin):** set `AGENTV3_ENABLED=true` + `AGENTV3_ALLOWLIST=<admin uid>` + `ANTHROPIC_API_KEY` + `E2B_API_KEY` in Cloud Run; a floating "v3.0" button appears for the admin → full multi-agent builder.
- **GitManager (real git commits) DONE** (pushed to #191): sandbox is a real git repo; every write/edit creates a real commit (sandbox-only; best-effort), History shows real SHAs; step caps now env-configurable (AGENTV3_MAX_STEPS=80, AGENTV3_SUBAGENT_MAX_STEPS=40). 1607 tests.
- **Remaining/next:** P6 cutover (make v3.0 default, retire old builders) — only after live dogfood; conversation persistence (D7) reconnect-durable backend; wire GitManager.restore to a History→restore endpoint (needs persistent sandbox mapping); editable-todo UI (bidirectional). **(BYOK REMOVED — see 2026-06-25 note; not a feature.)** Live run still requires admin to set keys + flag (real Claude+E2B spend) — not exercised in-session (no keys).

**Session 2026-06-22 (c) — Pro v3.0 ("Vargen 3.0") kickoff: parity audit + design doc (DESIGN ONLY, no runtime change):**
- Earlier this session: 35-bug brutal audit → 28 fixes shipped live (PRs #173–#178, all CI-green) + Cashfree payment-leak fixes.
- `CLAUDE_CODE_PARITY.md` added (PR #179, merged) — line-level NavBharatAI Pro vs Claude Code gap analysis, root causes RC-1…RC-8.
- `NAVBHARATAI_PRO_V3_DESIGN.md` added — full v3.0 design (Claude-Code-class agentic builder, ~99% feel).
- Design expanded (same PR #180) per admin: **multi-agent "AI team"** (Architect/Orchestrator + Frontend/Backend/DB/Designer/QA/Debugger/Reviewer/Deploy sub-agents, parallel-safe) as the engagement/anti-boredom layer (§3.3–§3.4), and **all 5 surfaces (Preview, IDE/Code Studio, File, Git, History) MERGED** into one `WorkspaceState`+`AgentEventStream` (§3.2). Roadmap gained P3.5 (multi-agent) + P3.6 (engagement); git is now first-class (`GitManager`).
- **Admin decisions locked (aashishcpmt09, 2026-06-22):** D1 = **strangler-fig** (build v3.0 alongside live app, never break it); D2 = **NavBharatAI pays for Claude** (admin OVERRIDE of the CLAUDE.md "AiCreditsProvider never registered / users' own accounts" rule — must be recorded in CLAUDE.md when P5 billing code lands; mandatory CostGuard guardrails apply); D3 = **design-doc first**, then phased code.
- ⚠️ A future session must NOT revert the Grok-primary / no-Claude-billing rule blindly — D2 is an explicit admin override (see design doc §0).
- **UPDATE — Phase P0 SHIPPED (2026-06-22, supersedes the "no code yet" note above):** `src/server/AgentV3/` skeleton built + verified — `types.ts` (event/tool/role vocabulary), `AgentEventStream.ts` (broadcast spine, replay buffer, throwing-listener isolation), `WorkspaceState.ts` (single source of truth), `featureFlag.ts` (AGENTV3_ENABLED default OFF + allowlist), `index.ts` (`agentV3Status()` honest `ready:false`), and `routes/agentv3.ts` (`GET /api/agentv3/status`, `POST /api/agentv3/chat` → honest 404 when off / 503 under-construction when on — NO fake build). Wired into `server.ts`; `tsconfig.server.json` include extended (+ test exclude). **Strangler-fig honored: zero imports from live Pro/Engineer paths → live app cannot be affected; flag OFF by default.** Gate green: tsc.server 0 + frontend tsc 0 + vitest 1541 passed (incl. 11 new AgentV3 tests) + esbuild server bundle clean.
- **Admin answered design §11 → decisions D4–D9 LOCKED (2026-06-22):** D4 hybrid sandbox (E2B engine + real Git repo, user owns it); D5 pricing = `user_tokens × Opus_rate × 2.5` (NavBharatAI pays real cost, bills markup → margin always positive); D6 "Only Opus" super toggle billed ×5; D7 persistence = user's choice (BYOK → user's own DB/Claude); D8 beta = admin-only now → all logged-in users at GA; D9 engagement (AI-team tracker + live preview) must be REAL, not fake animation. All in design doc §0/§5.1/§7.1/§7.2/§11.
- **Phase P1 COMPLETE (2026-06-22) — native tool-use engine, end-to-end, merged to main (flag OFF):**
  - P1a (PR #182) `ClaudeClient` (injectable Anthropic native tool-use turn + `parseMessage`) + `pricing.ts` (D5/D6: `tokens × Opus_rate × 2.5`, ×5 only-Opus).
  - P1b (PR #183) `ToolCatalog` (read/write/edit/bash/grep/glob/update_todo native defs) + `ToolDispatcher` (tool_use → sandbox via narrow `ActuatorPort`; honest is_error; emits tool_call/tool_result/file_changed/diff/todo events).
  - P1c (PR #184) `AgentRunner` — the loop (call Claude → run tools → feed results → repeat until end_turn / step cap / budget cap; growing transcript RC-2; aggregates usage + billed amount). Tested whole-loop end-to-end with scripted mock client + fake actuator.
  - P1d (PR #185) wired into `POST /api/agentv3/chat` (NDJSON stream): flag+allowlist+ANTHROPIC_API_KEY gated, hybrid actuator (E2B→Docker→Local, D4), per-build budget cap `AGENTV3_MAX_BUILD_USD` (default $25), `models.ts` (Sonnet default / Opus super-toggle), `architectSystemPrompt` (forbids fake completion).
  - Verified each step: tsc.server 0 + tsc --noEmit 0 + vitest (now 1569 passed, incl. ~28 new AgentV3 tests) + esbuild bundle clean. Strangler-fig intact: AgentV3 module has ZERO live-path imports; flag OFF by default → live app cannot be affected.
  - To exercise live: set `AGENTV3_ENABLED=true`, `AGENTV3_ALLOWLIST=<admin userId>`, `ANTHROPIC_API_KEY`, `E2B_API_KEY` in Cloud Run, then POST a prompt. (Real Claude+E2B spend — admin-gated.)
- **Next un-done items:** P2 (ConversationStore + prompt caching), P3 (AgentEventStream + GitManager + merge all 5 surfaces into the UI — preview/IDE/file/git/history real-time sync; needs frontend), P3.5 (multi-agent team), P3.6 (engagement "AI Team" live tracker UI), P4 (todo/plan/permission UI), P5 (wallet billing wiring + CLAUDE.md override amendment).

**Session 2026-06-22 — v2.0 rebranding + 5 bug fixes (PRs #158–#161, all merged to main):**
- Issue #1 — v2.0 rebranding: All "NavBharatAI Pro" labels → "NavBharatAI v2.0" across App.tsx, index.html, FilesPanel, AIChat, CodeStudio ✅
- Issue #2 — Code Studio (IDE) not opening on mobile: Added Studio to mobile bottom navigation bar ✅
- Issue #3 — App generation failing: Fixed wrong Gemini model name (gemini-3.5-flash → gemini-2.5-flash), added Grok to resilient build chain ✅
- Issue #4 — Progress UI green tick: Separated reset setTimeout to 2000ms delay so tick stays visible ✅
- Issue #5 — ZIP upload preview: Honest classification for framework apps (no fake preview), shows clear message instead ✅
- Cloud Build for commit 4dbbc14 failed transiently; this commit re-triggers deploy of correct code ✅

**Session 2026-06-25 — AgentV3 Intelligence Levels 1–9 (branch `claude/test-coverage-analysis-bq0yev`):**
- **Level 1 — LLM-upgraded intent classification:** `classifyIntentWithConfidence` (4-tier keyword confidence scoring) + `classifyIntentSmart` (LLM fallback for low-confidence inputs). Wired in agentv3.ts with best-effort try/catch. ✅
- **Level 2 — AST-level code understanding:** `ASTAnalyzer.ts` — ts-morph dynamic import (graceful fallback), extracts symbols/imports/components/routes with exact line numbers. ✅
- **Level 3 — Semantic file search:** `EmbeddingSearch.ts` — OpenAI ada-002 vector store; in-memory cosine similarity; graceful no-op when OPENAI_API_KEY absent; wired into write_file/edit_file in ToolDispatcher. ✅
- **Level 4 — Post-edit self-review:** `PostEditReviewer.ts` — pure static analysis (stub detection, typo check, missing import hints, JSX/React check, TODO count); appended to tool_result in ToolDispatcher; never blocks. ✅
- **Level 5 — Dependency-aware cascading edits:** `WorkspaceMemory.reverseDeps()` + `impactRadius()` — reverse import graph BFS (depth 5); impact radius reported in write_file/edit_file tool_result. ✅
- **Level 6 — Test-driven edit verification:** `testFileHint()` in ToolDispatcher — suggests the matching test file after every write/edit so agent can verify immediately. ✅
- **Level 7 — Structural codemods:** `CodemodeExecutor.ts` — AST-safe cross-file `renameSymbol` and `addComponentProp` via ts-morph; `codemod_rename` and `codemod_add_prop` tools in ToolCatalog. ✅
- **Level 8 — Multi-agent post-build reviewer:** `ReviewerAgent.ts` — sub-agent spawn on successful builds; parses CRITICAL/WARNING/SUGGESTION; wired in agentv3.ts after reflection. ✅
- **Level 9 — Persistent WorkspaceMemory:** `FirestoreWorkspaceMemoryStore.ts` — 30-day TTL, max 100 episodes; `restoreWorkspaceMemory` wired before warmIndexFiles in edit mode; `saveWorkspaceMemory` wired after every build. ✅
- **New ts-morph dep:** `npm install ts-morph --save` — AST parsing for Levels 2 and 7.
- **All gates green:** `tsc --noEmit` 0 errors + `tsc -p tsconfig.server.json` 0 errors + vitest **2446/2446** passed (incl. 6 new test files: PostEditReviewer, ReviewerAgent, EmbeddingSearch, ASTAnalyzer, CodemodeExecutor, CodemodeExecutor.test.ts).

**Branch:** `claude/test-coverage-analysis-bq0yev`
**Session 2026-06-21 (b) — shipped this branch, all tsc x2 + vitest 1049/1049 green:**
- Phase 17 — Auto Test Generation (multi-file Vitest for generated apps) ✅
- Phase 3.1 — World-class unified Chat+IDE workspace (Cursor/Bolt/v0 level) ✅ CORE
- Phase 5.3 — Real Express route handler tests (telemetry/pwa/secrets/sync) ✅ PARTIAL
- Phase 3.4 — Brand standardized to NavBharatAI Pro (metadata) ✅ CORE
- Phase 4.1 — AIRouter cooldown shared via Firestore; audited rest → DISTRIBUTED STATE DONE ✅
- Phase 4.3 — Metrics health-alerts engine + admin panel banners ✅ (Cloud Trace infra-gated)
- Phase 7.5 — AppKnowledgeBase fully synced (47 entries) ✅
- Phase 7.2/7.6 — k6 load-test script + RUNBOOK.md shipped (execution = admin/infra) ✅
- Phase 5.2 — measured exactly (frontend 572 strict errors); phased burn-down (server already strict)
- Phase 1.7 / 5.1 — SettingsPanel extracted (1,004 lines), App.tsx → 8,251 (11 panels done) ✅
- Phase 5.5 — providers_unavailable event + retry countdown UI in Pro Chat ✅ SUBSTANTIALLY COMPLETE

**Remaining (NOT code-completable now — honest):**
- **1.3 / 3.2 (archive legacy):** BLOCKED — `AppMakerLab/AppEngine` is still a live runtime
  dependency (`server.ts:386`, `pro.ts`). Sequencing-gated on ENGINE=v2 prod stability.
- **1.7 / 5.1 (App.tsx split to <500 lines):** ongoing large refactor, one-panel-per-PR (11 done).
- **7.1 / 7.3 / 7.4 (run) / 6.x live:** admin/infra/manual (timed sign-off, user-plan system,
  ZAP scan, live API keys, device QA) — see each section.
**Next safe code step:** extract ProChatPanel (in progress), then continue panel-per-PR App.tsx split.

---

## FOUNDATION — Already Shipped (do not redo)

All G-cluster work merged to main. These are the bedrock — build on top, never replace:

| Milestone | What shipped | Status |
|-----------|-------------|--------|
| G1 | EventBus + Firestore wiring | merged |
| G2 | Observability: metrics + logs + admin panel | merged |
| G3 | Credential wiring (E2B, GitHub, DB) + tier badge | merged |
| G4 | Security: Helmet, CORS fix, error sanitize, npm audit | merged |
| G5 | AI code review gate (security/quality/tech-debt findings) | merged |
| G6.1 | Dependency auto-sync (missing packages added to package.json) | merged |
| G6.2 | npm ci + peer-dep fallback + dev-server health check | merged |
| G7 | Live preview in Pro Chat | merged |
| G8 | One-click Deploy GUI (Vercel / Netlify / Firebase) | merged |
| G9 | Quick-Start Gallery (12 project templates) | merged |
| G10 | Retry memory fix ("try again" replays original prompt) | merged |
| G11 | Build reliability (no more "stream ended without result") | merged |
| G12 | Real-time file streaming (files appear live as agent writes) | merged |
| Guider | Pre-build plan confirm + post-build grade → auto-refine, all users | merged |
| Phase 17 | Auto Test Generation: multi-file Vitest tests for every Pro build (TestAnalyzer + generateTestSuite + ValidationPipeline injection) | branch ready |
| Phase 3.1 | World-class unified Chat+IDE workspace (WorkspacePane: live preview + code beside chat) | branch ready |
| Phase 4.1 | Distributed state complete: workspace lock + shared AIRouter cooldown + event persistence | branch ready |
| Phase 4.3 | Metrics health-alerts engine (error/preview/latency) + admin panel banners | branch ready |
| Phase 5.3 | Real Express route handler tests (telemetry/pwa/secrets/sync) | branch ready |
| Phase 5.5 | Provider-down retry countdown UI: `providers_unavailable` event + 60s timer + Retry Now button | branch ready |
| Phase 7.5 | AppKnowledgeBase fully synced (47 entries, all primary views) | branch ready |
| Phase 1.7b | SettingsPanel extracted (1,004 lines); App.tsx → 8,251 lines (11 panels total) | branch ready |

---

## MEASURABLE SUCCESS CRITERIA
_"World best" is meaningless without numbers. v2.0 ships when ALL of these pass:_

- [ ] User builds a **working 5-page React app in under 3 minutes**, first attempt
- [ ] **First token appears in under 1 second** after pressing Send
- [ ] **Zero manual npm steps** — imports resolve, preview starts automatically
- [ ] **Preview works first time on >80% of builds** — no "app built but won't run"
- [ ] **Edits are surgical** — changing one component does not regenerate the whole app
- [ ] **"Go back to version 3" works** — every build is a real, revertible git checkpoint
- [ ] Full experience works on **mobile browser** (phone/tablet, no horizontal scroll)
- [ ] **Bharat differentiator**: UPI payment app scaffold builds and previews in under 5 minutes

These are verified in Phase 7 with timed, recorded tests. Nothing marked done without evidence.

---

## PHASE 0 — Security Foundation ✅ DONE (2026-06-21)

### Phase 0a — Secrets hardening ✅ DONE — PR #128 merged
- [x] **C1** — Hardcoded Gemini key removed from `aiClients.ts`; server warns if env var missing.
- [x] **C2** — `SECRET_ENCRYPTION_KEY` insecure-fallback warning already in place (G4).
- [x] **C4** — `/api/secrets/*` auth-gated with Firebase ID token + userId-match (401/403).

### Phase 0b — Auth + rate-limit on hot endpoints ✅ DONE — PR #129 merged
- [x] **C3** — `buildRateLimiter()` on `/api/build`, `/api/build-stream`, `/api/engineer-chat`.
  10 builds/hour for authenticated users, 5/hour for anonymous (IP-keyed). Returns 429.
- [x] **C5** — `/api/engineer-chat` returns 503 in `NODE_ENV=production` when no E2B or Docker sandbox.

Exit criteria: tsc x2 + vitest + boot smoke green. All hot endpoints authenticated + rate-limited.

**Phase 0 DONE when:** 0a DONE + 0b DONE. No CRITICAL or HIGH security issue open.

---

## PHASE 1 — One Engine, Fast, Smart
_The heart of "Claude Code". Engineer AI becomes the single engine for all generation.
Pro Chat routes through it. Speed + AI model intelligence built in from day one._

### 1.1 — UnifiedBuildOrchestrator API contract ✅ DONE
`src/server/project/UnifiedBuildOrchestrator.ts` — `BuildMode` type, `UnifiedBuildInput` interface,
async-generator `runUnifiedBuild()` wrapping `runProEngine`. Callback→generator bridge using queue+promise pattern.

### 1.2 — Route Pro through Engineer AI behind ENGINE=v2 flag ✅ DONE
`ENGINE=v2` env var → build-stream uses `runUnifiedBuild` (async generator path).
`ENGINE=v1` (or unset) → direct `runProEngine` call (zero-risk rollback). Default: unset (safe).
Shadow mode deferred — enable in Cloud Run with `ENGINE=v2` after smoke test.

### 1.3 — Remove AppEngine full-rewrite path ⛔ DELIBERATELY DEFERRED (safety gate)
**Status: BLOCKED — AppEngine is still a LIVE runtime dependency. Do NOT archive yet.**

Verified 2026-06-21 (git is ground truth): `AppMakerLab/AppEngine` is still wired into
the running server — `server.ts:386` calls `registerProRoutes(app)`, and `pro.ts` invokes
`buildAppEngine()` at lines 139/644/675; `server.ts:85` also imports it. Archiving it now
would break the live `/api/pro` route → app down. The prerequisite is real: route Pro fully
through ENGINE=v2 and confirm one week stable in prod (admin decision + observation), THEN
migrate/remove those call sites, THEN move `AppMakerLab/`, `AppMakerOrchestrator`,
`BuildEngine/` to `ARCHIVE/`. This is a sequencing gate, not a code gap — forcing it
violates the one absolute rule (never break the app).

### 1.4 — Smart Tier Auto-Selection with cost display ✅ DONE
Tier cost display added to `ProEngineRunner.ts` — always emits `"Execution tier: In-memory tier (free)"` etc.
Smart tier selection was already implemented in Phase 6 — E2B if key present, otherwise auto-select by size.

### 1.5 — First token under 1 second ✅ DONE
`res.flushHeaders()` + immediate `{ type: 'status', message: 'Analyzing your request…' }` added to `/api/build-stream`
before any async work. Measured at server level: first SSE event arrives ~50ms after request receipt.

Send first SSE status event (`"Analyzing your request…"`) within 500ms of receiving the
request — before any AI model call completes. Use speculative status messages replaced by real
ones as they arrive. Measure: server-side timestamp log, "request received → first SSE event sent."
Target: p50 < 500ms, p95 < 1000ms.

### 1.6 — AI model intelligence (right model per task) ✅ DONE (2026-06-21)
**Branch:** `claude/phase-2.5-validation-gates`

- `AIRouter.route()` now accepts optional `modelOverride?: string` (4th param), passed through to `provider.execute()`.
- `EngineerAgentLoop.runBoundedLoop()` uses `'grok-3'` (most capable) for all coding steps.
- `PlannerAgent.plan()` keeps `grok-3-fast` (default) — planning only needs structured JSON.
- Net: coding accuracy improves; planning stays fast. Grok primary; fallback chain unchanged.

### 1.7 / 5.1 — App.tsx split ⏳ ONGOING LARGE REFACTOR (honest)
**Status: IN PROGRESS — 15 panels extracted (App.tsx 6,610 lines, down from 10,658 = 38% reduction).**

**Extracted so far (all in `src/components/panels/`):**
- ✅ `TemplatesPanel`, `GitViewPanel`, `DeploySuccessPanel`, `AboutPanel`, `AdminLoginPanel`,
  `FilesPanel`, `DonationPanel`, `BillingPanel`, `WorkspacePane` (Phase 3.1), `SettingsPanel`,
  `ProChatPanel` (2026-06-21), `ViewPanels` (40 lazy-loaded tool views, 2026-06-21),
  `SidebarNav` (desktop + mobile drawer, 2026-06-21), `TopNav` (tab bar + auth, 2026-06-21),
  `AppModals` (11 overlay modals, 2026-06-21, 773 lines removed, tsc x2 + vitest 1059/1059 green).

**Why this is NOT "just finish it" in one go (deliberate):** the goal "no file over 500
lines" needs ~17 more extractions from a live 8,200-line file. The remaining big ones —
main NBI chat column, content-views switcher — each thread 30+ props. Proceeds safely
one-panel-per-PR (Read → Extract → tsc x2 → vitest → build → push) rather than a
risky big-bang. Tracked honestly; not faked as done.

**Phase 1 DONE when:** ENGINE=v2 stable in prod (one week shadow mode clean). Edits are
surgical. First token <1s verified in logs. Smart tier + cost display working. App.tsx split >30% complete.
✅ **>30% split criterion MET** (38% reduction achieved as of 2026-06-21).

---

## PHASE 2 — Git-Native + Memory + Preview Ladder
_Three features that make it feel like a real professional tool._

### 2.1 — Git-native versioning (first-class) ✅ DONE (2026-06-21)
**Branch:** `claude/phase-2.1-git-versioning`

Every successful build creates a version checkpoint persisted to Firestore:
- `feat: build "todo app with dark mode" — 12 files, vfs tier`
- `feat(edit): add dark mode toggle — 3 files`

**What shipped:**
- NEW `src/server/project/BuildHistoryStore.ts` — Firestore subcollection `build_history/{sessionId}/versions/`, capped at 50 per workspace, 900KB file size cap per version.
- `src/server/routes/build.ts` — wired save after BOTH agentic and legacy `sendComplete` when `ok: true`. Added `GET /api/build-history/:sessionId` (list metadata) and `GET /api/build-history/:sessionId/:versionId` (full files for restore).
- `src/services/buildService.ts` — added `listBuildHistory()` and `fetchBuildVersion()` client helpers + `VersionMeta`/`VersionEntry` types.
- `src/components/panels/FilesPanel.tsx` — added "History" tab alongside "Files" tab; shows version list with commit messages, relative time, file count, tier, version number (v1/v2/v3); "Restore" button fetches files + calls `onRestoreVersion` prop.
- `src/App.tsx` — wired `sessionId={currentProSessionId}` and `onRestoreVersion` callback: sets files + shows toast + switches to Code Studio.
- `AppKnowledgeBase.ts` — added `build-version-history` entry.
- `tests/buildHistory.test.ts` — 5 tests (null-db path, size-capping), all green.
- tsc x2 clean, vitest 326/326 green.

**How users access it:** Files view → History tab → click Restore on any version.
**Success criterion met:** "Go back to version 3 works" — every build is a real, revertible checkpoint.

### 2.2 — Unified preview ladder (one PreviewService) ✅ DONE (2026-06-21)
**Branch:** `claude/phase-2.2-preview-ladder`

PreviewService was already unified across tiers (static → iframe, React/Vue → in-browser, server-container → dev server, webcontainer → honest ok:false). The build route had the same preview logic duplicated in both agentic and legacy paths with an inconsistency (legacy had no timeout).

**What shipped:**
- `build.ts` — extracted `startPreviewSafe()` helper: consistent 8s timeout on BOTH paths (was missing on legacy, could hang indefinitely), try/catch so preview failure never breaks build response, emits `preview_url` SSE event immediately when preview URL is ready (client can start loading iframe before `sendComplete` arrives).
- Both `agentic` and `legacy` paths now call `startPreviewSafe(files, previewAllowed, !!preview, send)` — one code path, no drift.
- tsc x2 clean, vitest 326/326 green.

### 2.3 — Unified memory store ✅ DONE (2026-06-21)
**Branch:** `claude/phase-2.2-unified-memory`

Merged Pro Chat's rolling memory into Engineer AI's context so the agent no longer
starts fresh when the user switches from Pro Chat to Engineer AI on the same project.

**What shipped:**
- `EngineerAITypes.ts` — added `proMemorySummary?: string` + `proEditLog?: string[]` to `EngineerTask`
- `ProEngineRunner.ts` — loads `proMemoryStore.load(sessionId)` at the start of each agentic run; injects summary + last 10 edit log entries into the task; best-effort (never throws)
- `EngineerAgentLoop.ts` — `runBoundedLoop()` destructures new fields from task; `buildPrompt()` accepts `proMemorySummary?` + `proEditLog?` and prepends a `[PRO CHAT CONTEXT]` section to every step prompt when present; capped at 1500 chars to prevent context bloat
- `AppKnowledgeBase.ts` — added `unified-memory` entry
- tsc x2 clean, vitest 326/326 green (no test changes needed — logic tested implicitly)

### 2.4 — Context window intelligence ✅ DONE (2026-06-21)
**Branch:** `claude/phase-2.4-context-intelligence` (PR #138, CI green)

When `history.length > 20` OR `fileList.length > 50` in `buildPrompt()`:
- Verbatim history tail: 12 → 6 (keeps only the 6 most recent steps verbatim)
- File context: perFile 3 000 chars, maxFiles 20, total capped at 60 000 chars
- Normal budget restored for short sessions (zero regression)
Prevents prompt overflow silently — agent always keeps the most recent steps.

### 2.5 — Validation gates wrap Engineer AI output ✅ DONE (already shipped via G-cluster)

`ProEngineRunner.ts` already calls `runValidation()` + `checkSyntax()` on every Engineer AI
build output. `build.ts` uses `eng.previewAllowed` to gate preview via `startPreviewSafe()`.
`App.tsx` reads `engineRes.validation` and shows validation status + quality score in the
build result message. Nothing to do — fully wired end-to-end.

### 2.6 — Dedup: context retrieval + Guider ✅ DONE — audited (2026-06-21)

Audit result: **no duplication.**
- `ContextRetriever.ts` is Engineer AI-only; Pro Chat (legacy path) regenerates from scratch and does not need context retrieval.
- `Guider` is one implementation (`src/server/Guider/`) used by both `build.ts` and `engineer.ts` routes — no duplication.
Nothing to dedup.

**Phase 2 DONE when:** "Go back to version 3" works. Preview tier-aware and honest.
Memory works across session restarts. Large projects (50+ files) don't degrade agent quality.

---

## PHASE 3 — "Conversation IS the IDE" + Archive Legacy + One Brand
_Philosophy-level change. Chat and IDE become one surface. Dead code goes to ARCHIVE/._

### 3.1 — Merge chat and IDE into one surface ✅ CORE DONE (2026-06-21)
**Branch:** `claude/test-coverage-analysis-bq0yev`

World-class "Chat IS the IDE" surface shipped, modeled on Cursor / Bolt / v0 / Lovable.

**What shipped:**
- NEW `src/components/panels/WorkspacePane.tsx` (~230 lines) — self-contained live workspace: Preview tab (reuses tested `PreviewPanel`) + Code tab (file list + tested Monaco `Editor`). Desktop-only; pure presentation, state owned by App.
- `src/App.tsx` — the `nbi_pro_chat` view now docks `WorkspacePane` to the RIGHT of the chat whenever an app exists (`isAppBuilt && files`). Chat column narrows to `md:flex-[0_0_44%]` so chat + live app are always visible together. A "Hide app / Show app" toggle (`showWorkspace` state) in the chat header collapses/restores it.
- Agent writes a file → appears live in editor + preview (reuses G12's streamed `files`/`generatedCode` state — same single source of truth).
- "Studio" button opens the full Code Studio IDE; "Deploy" button triggers one-click deploy — both from inside the workspace.
- Mobile preserved: chat stays full-width, Preview/Code remain separate tabs (workspace is `hidden md:flex`).
- `AppKnowledgeBase.ts` — added `unified-workspace` entry.
- tsc x2 clean, vitest 1019/1019 green, `vite build` succeeds.

**Editor always visible alongside conversation** ✅ · **Agent files stream live into editor** ✅ · **One-surface (no forced tab switch) on desktop** ✅

**Follow-up polish (non-blocking, future):** click an editor line → inline "explain this"; E2B terminal output inline in chat (preview click→chat reference already works via the NBTag overlay in PreviewPanel).

### 3.2 — Archive legacy engines ⛔ DELIBERATELY DEFERRED (depends on 1.3)
**Status: BLOCKED — same live-dependency gate as 1.3.**

Move to `ARCHIVE/` (read-only, excluded from tsconfig, kept in git forever):
`AppMakerLab/kernel/`, `AppMakerOrchestrator`, `BuildEngine/`, Pro Chat's original
`RepairLoop`, any remaining `AppEngine` code. **Cannot start until 1.3 unblocks** —
these are still imported by the live `/api/pro` route + `server.ts`. One PR per archive,
each verifying tsc + vitest + no broken imports. Forcing it now = app down.

### 3.3 — Pick ONE editor: Monaco ✅ DONE (2026-06-21)
**Branch:** `claude/phase-2.5-validation-gates`

Audit confirmed both Monaco (`@monaco-editor/react`) and CodeMirror (`@codemirror/*`, `@uiw/react-codemirror`) were in `package.json` but **CodeMirror had zero imports in source** — already abandoned.
Removed 6 unused CodeMirror packages from `package.json`. Monaco is the only active editor.

### 3.4 — Brand rename: NavBharatAI Pro v2.0 ✅ CORE DONE (2026-06-21)
**Branch:** `claude/test-coverage-analysis-bq0yev`

**Shipped (safe metadata brand standardization):**
- `index.html` — `<title>` `navBharatAI` → `NavBharatAI Pro — AI App Maker`; `og:title` + `twitter:title` → `NavBharatAI Pro` (casing was inconsistent: lowercase in title vs `NavBharatAI` elsewhere — now uniform).
- `package.json` — placeholder `name: "react-example"` → `navbharatai-pro`; `version: 0.0.0` → `2.0.0`.
- `public/manifest.json` already carried the correct `NavBharatAI — AI App Maker` brand (no change needed).
- tsc x2 clean, vitest green, `vite build` succeeds.

**Deliberately NOT done (data-safety decision, per "never break"):**
- localStorage key renames with migration — current keys work; renaming risks losing user sessions/settings on the migration boundary for marginal cosmetic gain. The user-facing brand is already consistent everywhere it matters (title, OG, manifest, in-app strings). Revisit only if a concrete need arises.
- Sweeping in-app UI string rewrites — would create a massive high-regression diff; CLAUDE.md explicitly warns against rewriting existing strings as unrelated churn.

### 3.5 — Remove all fake/stub features ✅ DONE (2026-06-21)
**Branch:** `claude/phase-2.5-validation-gates`

Full audit performed. Fake features fixed:
- `MultiCloudDeploy.tsx` — `Math.random()` fake deployment simulation + fake URLs removed; replaced with honest CLI deploy instructions for each platform.
- `AppHealthMonitor.tsx` — all metrics were `Math.random()` simulated; added prominent "Demo Data" badge.
- `cloudsync.ts` — fake Firebase/Vercel project lists (hardcoded fake names); replaced with `not_available` responses — UI already falls back to templates gracefully.
- `team.ts` — returned `ok: true, "Invite sent"` without sending any email; now returns `emailSent: false` + honest message; UI updated.
- `firebaseAuth.ts` — 383-line fake OAuth flow that fabricated service-account JSON; replaced with honest "not available" page with real CLI instructions (75 lines). Sends `FIREBASE_AUTH_CANCELLED` postMessage to opener.
- `audit.ts` — already returned `audit_not_available` (honest, no change needed).
- Payment simulator — intentional fallback when credentials missing (`isSimulator: true` flag sent to client — client handles it). Acceptable.

**Phase 3 DONE when:** One unified surface (chat IS the IDE). All legacy in ARCHIVE/.
One editor. NavBharatAI Pro v2.0 brand live. Zero fake features.

---

## PHASE 4 — Scale + Reliability + Cost Intelligence
_Multi-instance safe. Observable. No surprise bills._

### 4.1 — Distributed state (workspace lock first) ✅ PARTIAL (2026-06-21) — PR #143
**Branch:** `claude/phase-4.1-workspace-lock`

**Shipped (workspace lock):**
- NEW `src/server/project/WorkspaceLock.ts` — Firestore document lock with 60-min TTL. `tryAcquire()` uses a Firestore transaction to atomically check + write the lock. Returns `{ acquired: true, lockId }` or `{ acquired: false, reason, expiresInMs }`. **Fail-open**: if Firestore is unreachable, returns `{ acquired: true }` so builds always proceed.
- `release()` uses a transaction to only delete if `lockId` matches — prevents a crashed instance from releasing a lock it no longer owns.
- `build.ts` — acquires lock before `runProEngine`; releases in `finally` (success, failure, or fallback). If lock rejected, emits a 'Another build is running' status event and returns.
- `tests/workspaceLock.test.ts` — 5 unit tests in VITEST-skip/fail-open mode (350/350 total)
- tsc x2 clean

**Shipped (AIRouter cooldown → Firestore, 2026-06-21):**
- NEW `src/server/lib/ProviderCooldownStore.ts` — shares AI provider circuit-breaker cooldowns across Cloud Run instances via the `provider_cooldowns` Firestore collection. Latency-safe: the in-memory map stays the authoritative zero-latency fast path; `write()` is fire-and-forget on every cooldown; a background 20s `startSync()` loop (unref'd, VITEST-skip) pulls remote cooldowns. So a provider any instance marked down is skipped by all within one interval.
- `AIRouter.ts` — `setCooldown()` now also `providerCooldownStore.write()`s (fire-and-forget); `mergeRemoteCooldowns()` merges remote deadlines (keeps the max, never shortens a local cooldown); sync started once at module load.
- `tests/providerCooldownStore.test.ts` — 5 tests (VITEST-skip write/read/startSync no-op). tsc x2 clean, vitest green.

**Audited the remaining two items (2026-06-21) — both resolved:**
- **Event ring → Firestore: ALREADY DONE (G1.1).** `src/server/lib/eventStore.ts` registers a Firestore persist-sink on the bus (`eventBus.setPersistSink`), so every published event is durably stored to Firestore while the in-memory `ring` stays the fast read path. No work needed.
- **UsageTracker → Firestore: intentionally NOT persisted (correct as-is).** `UsageTracker` counts per-workspace E2B operations (sandbox/command/screenshot) for live display + idle-cleanup. The sandbox it tracks lives on ONE instance, so cross-instance sharing has no correctness value and would add a Firestore write to every command. Real billing accuracy is already cross-instance via `UserCostStore` (Phase 4.2, Firestore-backed per-user monthly). Persisting this tracker would add cost for no benefit.

**Phase 4.1 — DISTRIBUTED STATE: DONE.** Workspace lock (PR #143) + AIRouter cooldown (shared) + event persistence (G1.1) all cross-instance safe; UsageTracker correctly stays local.

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

**Fix**:
- App.tsx: `lastBuildPromptRef = useRef<string>('')` stores the effective prompt before every build.
- Retry detection: pure-regex + empty-workspace guard + non-empty stored prompt guard = `isRetryAfterFailure` flag.
- AUTO mode intercept: when `isRetryAfterFailure`, skip classifyAutoIntent entirely — force-build.
- AppKnowledgeBase.ts: 'iterative-agent-build' entry added.
Gate: frontend tsc 0 · server tsc 0 · 321/321 tests pass.

### Milestone G11 — Build Reliability + Real-Time File Display (2026-06-21)
Root cause fix for "Build stream ended without a result":
- SOFT_DEADLINE_MS: 240,000ms → 200,000ms (gives 100s buffer before Cloud Run 300s kill)
- `summarizeForMemory` and `previewService.startPreview`: 8s Promise.race caps added
- Max post-engine time capped at 28s; total max 228s (72s under 300s limit)
Gate: frontend tsc 0 · server tsc 0 · 321/321 tests pass.

### Milestone G12 — Real-Time File Content Streaming (2026-06-21)
Code files now appear in Generated Files panel as the agent writes them (not just at build end).
- ProEngineRunner.ts: on `files_changed`, emit individual `file` events (≤8 files, ≤40KB each)
- App.tsx: `buildAppStream` handles `type === 'file'` → updates `generatedFiles` state in real-time
Gate: frontend tsc 0 · server tsc 0 · 321/321 tests pass.


### 4.2 — Pricing intelligence per build ✅ DONE (2026-06-21)

**Shipped (cost display — PR #141):**
- `ProEngineRunner.ts` — counts reasoning steps, emits estimated cost, returns `estimatedCostUsd`
- `build.ts` — includes `costUsd` in every `sendComplete` payload
- `buildService.ts` — added `costUsd?` to `BuildResponse` and `BuildStreamEvent`

**Shipped (monthly accumulation — branch `claude/p4.2-usage-billing`, 2026-06-21):**
- `UserCostStore.ts` (NEW) — Firestore `user_costs` collection, doc `{userId}_{YYYY-MM}`, transaction-based increment of `totalBuilds` + `totalCostUsd`. VITEST-skip, best-effort (never throws, never blocks).
- `build.ts` — extracts `userId` from request body, calls `userCostStore.record()` after every agentic build with `estimatedCostUsd > 0`; adds `GET /api/user/usage/:userId` endpoint (returns monthly doc or zero defaults)
- `buildService.ts` — adds `userId?: string` to `BuildRequest`
- `App.tsx` — passes `userId: user?.uid` in `buildAppStream` call; fetches `/api/user/usage/:userId` inside `fetchWallet()`; stores result in `monthlyAiCost` state; passes to `BillingPanel`
- `BillingPanel.tsx` — adds `monthlyAiCost` prop and "This Month's AI Cost" display card (builds count + USD total + month)
- `AppKnowledgeBase.ts` — billing entry updated with monthly AI cost keywords
- tsc x2 clean, vitest 358/358 green

**Deferred (hard quotas):**
- Free: 3/day, Pro: 20/day — needs user-tier lookup wired to auth middleware

### 4.3 — Metrics + traces + alerts ✅ CODE-COMPLETE (2026-06-21)
**Branch:** `claude/test-coverage-analysis-bq0yev`

- **Metrics:** persisted to Firestore + admin panel (G2) ✅.
- **Alerts (the code-completable half) — DONE:**
  - NEW `src/server/lib/metricsAlerts.ts` — pure `evaluateAlerts(snapshot)` rules engine: high build-failure rate (>10%, min 10-build sample), low preview rate (<80%), slow builds (avg >30s). Returns typed `MetricAlert[]` with severity/message/value/threshold.
  - `admin.ts` — `GET /api/admin/metrics` now returns `{ ...snapshot, alerts }`.
  - `App.tsx` — Live Metrics panel renders critical/warning alert banners at the top.
  - `AppKnowledgeBase.ts` — `admin-metrics` entry updated with the alerts capability.
  - `tests/metricsAlerts.test.ts` — 7 tests (healthy, sample-size guard, each alert, boundary, multi-alert). tsc x2 clean, vitest green.

**Infra-gated remainder (cannot be code-completed honestly):**
- Cloud Trace distributed spans on `/api/build-stream` — needs `@google-cloud/trace-agent`/OpenTelemetry export to GCP; unverifiable without a GCP project, so not shipped as fake.
- Alert NOTIFICATION delivery (email/Slack) + E2B-quota alert — the detection rules engine is in place; wiring a notifier/quota source needs external infra. Admin sees alerts live in the panel meanwhile.

### 4.4 + 5.4b — Firestore cap + dep-sync + error-pattern expansion ✅ DONE (2026-06-21)
**Branch:** `claude/g6-dependency-sync`

Prevents Firestore documents from hitting the 1MB size limit on verbose/long builds.

**Phase 4.4 — Firestore growth cap:**
- `FirestoreJobStore.ts` — `updateJobStatus()` now uses a Firestore transaction to read logs, append the new entry, and trim to **last 100 entries** before writing. Replaces unbounded `arrayUnion(log)`.
- `ProMemory.ts` — `logDecision()` and `logErrorPattern()` also use transactions, capped at **50 decisions** and **20 error patterns** per session.

**Phase 5.4b — DependencySync + ErrorPatternMatcher expansion:**
- `DependencySync.ts` — Added `KNOWN_DEV_VERSIONS` (type packages, PostCSS, Tailwind, Vite plugins, test libs). `syncDependencies()` now routes build-tool imports to `devDependencies` instead of `dependencies`. Result has new `addedDev: string[]` field. 18 runtime + 19 dev packages in curated tables.
- `ErrorPatternMatcher.ts` — Added 6 new error patterns: `@/` path alias not configured, `process is not defined` (Node global in browser), `localStorage is not defined` (SSR), PostCSS/Tailwind `@tailwind` rule, `react-dom/client` React 17→18 migration, OpenSSL EVP error. Added 4 new instruction hints: Next.js, drag-and-drop, WebSocket/real-time, Maps/Leaflet.
- `tests/errorPatternMatcher.test.ts` — 4 new test cases (20 total)
- `tests/dependencySync.test.ts` — 5 new test cases for `addedDev` (15 total)
- tsc x2 clean, vitest 358/358 green

**Phase 4 DONE when:** Safe at 10 Cloud Run instances (no cross-instance corruption).
Every build shows tier + cost. Alerts firing. Load test baseline documented.

---

## PHASE 5 — Quality + Test + Resilience
_A world-best product cannot have a 10k-line untested god-file._

### 5.1 — Complete App.tsx split (started in Phase 1.7)
**Status: IN PROGRESS — see the consolidated 1.7/5.1 entry above for the honest plan.**

Target: no file in `src/` over 500 lines. Tracked under 1.7/5.1 (9 panels extracted;
proceeds safely one-panel-per-PR, not a risky big-bang).

### 5.2 — Strict TypeScript everywhere ⏳ MEASURED + PHASED (2026-06-21)
**Server: DONE — `tsconfig.server.json` is already `strict: true` and green.**

Frontend (`tsconfig.json`) measured exactly on 2026-06-21 under full strict:
**572 errors** — 424 `TS7006` (implicit-any params), 122 `TS18047` (possibly-null),
16 `TS2322` + 6 `TS2769` + ~8 misc (the genuine type bugs).

**Why not flipped in one PR (deliberate, per the never-break rule):** turning
`strict: true` on now produces 572 compile errors → red CI → the app does not
deploy. The 122 null-guards each need per-call-site understanding to fix without
changing runtime behavior. This is a real module-by-module burn-down tied to the
App.tsx split (5.1), NOT a one-shot flip. Flipping it red would break the live
app for all users — exactly what safeguard #5 forbids.

**Path to done:** as each panel is extracted from App.tsx (5.1), it is authored
strict-clean; when the frontend strict count reaches 0, flip the flag. Tracked,
not faked.

### 5.3 — Integration + E2E tests ✅ PARTIAL (2026-06-21)
**Branch:** `claude/test-coverage-analysis-bq0yev`

**Shipped — real route handler tests (no new dependency, no server boot):**
- NEW `tests/helpers/routeTestUtils.ts` — `captureRoutes(register)` runs a `registerXRoutes(app)` against a fake Express app that records every handler by "METHOD path"; `mockReq()`/`mockRes()` exercise the REAL handler logic (validation, status codes, payload shape) directly.
- NEW `tests/routesTelemetryPwa.test.ts` — 17 tests:
  - telemetry: pagespeed 400 on missing url; logs/error always 204; analytics/event 400 without event, 204 with; pagespeed Lighthouse-score mapping + upstream-error passthrough (mocked fetch).
  - pwa: save 400 without html; save stores app + returns id/url; name capped at 30; manifest 404 unknown / valid fields for stored; serve 404 HTML for expired; manifest-link injected into `<head>`; service worker served as JS with correct scope header.
  - secrets + sync: registration smoke (all user-scoped endpoints present).
- tsc x2 clean, vitest now 1036/1036 green.

**Still TODO (infra-gated):**
- Real build smoke (`POST /api/build-stream`) — needs the AI model + sandbox; cannot run in CI without keys.
- E2E (Playwright) — needs a browser runtime in CI.
- Heavy stream routes (zip extract/download) — fragile under handler-capture; their CORS path is already covered by `cors.test.ts`.

### 5.4 — Error pattern learning ✅ DONE (2026-06-21) — PR #140
**Branch:** `claude/phase-5.4-error-learning`

NavBharatAI now learns from build failures to prevent them repeating.

**What shipped:**
- NEW `src/server/project/ErrorPatternMatcher.ts` — pure, zero-I/O matcher: 14 error patterns (ERESOLVE, Cannot find module, named import, unclosed JSX, React hooks, TypeScript, null/undefined, missing vite.config, Supabase keys, tailwind, etc.) + 7 pre-build instruction hints (Tailwind v4, Supabase, Firebase, React Router v6, Zustand, Recharts, Framer Motion).
- NEW `src/server/project/ErrorPatternStore.ts` — Firestore store (VITEST-skip, best-effort, never throws). Collections: `session_error_hints` (per-session hints), `error_pattern_stats` (aggregate learning).
- `EngineerAITypes.ts` — added `errorHints?` to `EngineerTask`
- `EngineerAgentLoop.ts` — `buildPrompt()` injects `[KNOWN ISSUES]` section when hints present
- `ProEngineRunner.ts` — loads instruction hints + session hints before loop; after validation failure, records new hints best-effort; after success, clears stale hints
- `AppKnowledgeBase.ts` — added `error-pattern-learning` entry
- `tests/errorPatternMatcher.test.ts` — 16 unit tests (345/345 total green)
- tsc x2 clean

### 5.5 — Offline / degraded mode ✅ SUBSTANTIALLY COMPLETE (2026-06-21)
**Branch:** `claude/test-coverage-analysis-bq0yev`

**Shipped (provider fallback visibility — PR #142):**
- `AIRouter.ts` — populates `telemetry.fallbackReason` when ≥1 higher-priority provider failed
- `EngineerAITypes.ts` — added `providerFallbackShown: boolean` to `SharedLoopState`
- `EngineerAgentLoop.ts` — yields `status` event once per build when primary AI provider unavailable

**Shipped (provider-down retry queue — 2026-06-21, claude/test-coverage-analysis-bq0yev):**
- `EngineerAITypes.ts` — added `{ type: 'providers_unavailable'; retryAfterMs: number; message: string }` event type
- `EngineerAgentLoop.ts` — when `!telemetry.success` in ReAct loop, emits `providers_unavailable` (retryAfterMs: 60000) BEFORE the error event so clients can show retry UI
- `buildService.ts` — added `providers_unavailable` to `BuildStreamEvent` type union; added `retryAfterMs?: number` field
- `App.tsx` — handles `providers_unavailable` event with a live 60s countdown timer in the Pro Chat header; "Retry Now" button cancels timer and immediately retries; auto-clears when countdown expires
- `tests/engineerAgentLoop.test.ts` — new test verifying `providers_unavailable` is emitted before `error` event with correct `retryAfterMs`. 1049/1049 green.

**Deliberately NOT done (design decision):**
- Template-based generation as last resort: a generic "Hello World" template when user asked for e.g. a "UPI payment app" would be MORE confusing than the honest retry message. Removed from backlog. The retry countdown is the right UX here.

**Phase 5 DONE when:** Strict types everywhere. Real E2E green in CI. Error learning active.
Degraded mode tested. No file over 500 lines.

---

## PHASE 6 — Bharat-First + Mobile-First + Real Breadth
_NavBharatAI's genuine competitive moat. Claude Code will never do any of this._

### 6.1 — Bharat-first integrations ✅ PARTIAL (2026-06-21)
**Branch:** `claude/p1.7-prochat-panel`

**Shipped — 4 Bharat-first Quick-Start templates in `TemplatesPanel.tsx`:**
- **UPI Payment App** — complete Razorpay integration: dynamic SDK load, checkout modal, payment status (success/failure/pending), GST breakdown, paise conversion, `.env.example`. Needs VITE_RAZORPAY_KEY_ID.
- **Hindi Language App** — bilingual Hindi/English job board with i18next, Noto Sans Devanagari font, language toggle, sample Indian job listings, Indian flag palette.
- **GST Invoice Generator** — GSTIN validator (15-char format, state code map), CGST/SGST vs IGST auto-switch, HSN codes, amount-in-words (lakh/crore system), print CSS, no backend needed.
- **Startup Registration Tracker** — 11-step registration checklist, compliance calendar (GSTR-1/3B deadlines), document vault, cost tracker, all in localStorage.

**Still TODO (require admin action/infra):**
- Aadhaar/DigiLocker KYC (requires approved DigiLocker API access — not publicly available)
- PhonePe integration (requires merchant approval + webhook server)
- End-to-end verified with live Razorpay test key (needs admin to add test key)

### 6.2 — Mobile-first experience ✅ PARTIAL (2026-06-21)
**Branch:** `claude/p6.2-mobile-improvements`

**Shipped — AIChat.tsx touch + layout improvements:**
- **Mobile "Preview ready" banner** — after a successful build, a sticky emerald banner appears between messages and input on mobile (<640px). Single-tap "View Preview →" button. Replaces the draggable floating button which was hidden on small screens and overlapped the header.
- **Larger touch targets** — Send button `p-2.5` → `p-3` (~38px); Stop button same. Attach/Voice `p-2` → `p-2.5` (~36px). All have `active:scale-95` touch feedback. Approaching 44px WCAG minimum.
- **Horizontal suggestion chip scroll** — Follow-up suggestion chips changed from `flex-wrap` (multi-row clutter on mobile) to `overflow-x-auto no-scrollbar` single-row scroll. Each chip has `shrink-0`.
- **Desktop floating button cleanup** — Added `hidden sm:block` + `cursor-grab` to the draggable Live Preview button; reduced its drag constraint from 400px to 100px downward to prevent it escaping the view area.
- tsc 0 errors, vitest 358/358 green

**Still TODO:**
- File streaming on mobile network (works, but no offline/slow-network handling)
- Voice input improvements (browser-dependent, works in Chrome already)
- Responsive editor usable without keyboard (Monaco is heavy on mobile)
- Tested on real mobile device (requires manual QA)

### 6.3 — Real framework breadth (verified, not faked) ✅ PARTIAL (2026-06-21)
**Branch:** `claude/p6.3-svelte-framework`

**Vue 3** — Already fully supported (VuePreview.ts + vue3-sfc-loader CDN). No work needed.

**Svelte** — Build pipeline wired end-to-end:
- `Scaffold.ts` — Added `'vite-svelte'` to `Framework` type; `wantsSvelte()` detection; `VITE_SVELTE_FILES` template (svelte 4.2.19, @sveltejs/vite-plugin-svelte 3.1.2, correct entry wiring); `scaffoldSummary()` for Svelte. Detection fires on "svelte", "sveltekit", "svelte kit", etc.
- `ProjectVerifier.ts` — Added `.svelte` + `/index.svelte` to `MODULE_EXTS` — relative `.svelte` imports resolve without "broken import" warnings.
- `DependencySync.ts` — `svelte` added to `KNOWN_VERSIONS` (runtime dep, pinned to `^4.2.19`); `@sveltejs/vite-plugin-svelte` added to `KNOWN_DEV_VERSIONS` (build-tool dep, pinned to `^3.1.2`).
- `RuntimeRouter.ts` — Added `'svelte'` to `framework` union type; detection fires when `depSet.has('svelte')` OR `.svelte` files present in VFS.
- `ArchitectureManifest.ts` — Added `'svelte'` to `FrameworkId`; `wantsSvelte()` detection; Svelte manifest in `selectArchitecture()`; Svelte rules in `forbiddenPathPatterns()` (no React/Vue SFCs); Svelte contract in `manifestContract()` (enforces Svelte 4 syntax, warns about no in-browser preview).
- Tests: `scaffold.test.ts` +2 cases (detect Svelte, scaffold produces correct files + package.json); `projectVerifier.test.ts` +1 case (`.svelte` imports resolve). 361/361 green.

**Svelte preview**: Honest "needs WebContainer" message (not faked). Users can Download ZIP + `npm install && npm run dev` locally. In-browser Svelte transpilation deferred (needs `svelte/compiler` in browser via esm.sh — complex, separate phase).

**Astro**: Deferred — requires server-side build; no in-browser preview possible without full Vite pipeline. Will address in Phase 6.4 if needed.

tsc x2 clean, vitest 361/361 green.

### 6.4 — Real deploy targets ✅ PARTIAL (2026-06-21)
**Branch:** `claude/test-coverage-analysis-bq0yev`

**Shipped — Cloudflare Pages deploy (PR #153):**
- `src/server/pro/ProDeploy.ts` — added `deployCloudflarePages(token, accountId, projectName, files)`: uses native `fetch` for all 3 HTTP calls (project check, create, deploy). Builds SHA-256 manifest + multipart FormData for Cloudflare Direct Upload API.
- `src/server/routes/pro.ts` — added `cloudflare` as 4th deploy provider; validates `accountId + name`.
- `src/components/panels/DeployModal.tsx` — 4-platform grid (2×2); Cloudflare option shows Account ID + Project Name fields.
- `src/App.tsx` — state type updated; Cloudflare validation + body building wired.
- `tests/proDeploy.test.ts` — 8 unit tests (existing project, new project create, FormData structure, URL fallback, error cases). All using `vi.stubGlobal('fetch', ...)`.
- tsc x2 clean, 406/406 green.

**Still TODO (infra-gated):**
- Railway deploy (no direct file upload API — requires git push workflow or CLI)
- Supabase Edge Functions (requires Supabase CLI + managed runtime)

### 6.5 — Modern backend scaffolds ✅ DONE (2026-06-21)
**Branch:** `claude/test-coverage-analysis-bq0yev`

**Shipped:**
- `Scaffold.ts` — Added `'vite-pocketbase'` and `'vite-convex'` framework types. `detectFramework()` checks for PocketBase/Convex keywords before React/Svelte/Vue (priority ordering). Scaffolds full working skeletons: PocketBase (`src/lib/pb.js` singleton with `VITE_PB_URL`, auth + record listing in `App.jsx`, `.env.example`); Convex (`ConvexProvider` in `main.jsx`, `useQuery`/`useMutation` in `App.jsx`, `convex/schema.ts`, `convex/tasks.ts`, `.env.example`). `scaffoldSummary()` describes both.
- `DependencySync.ts` — Added `pocketbase ^0.21.0` and `convex ^1.13.0` to `KNOWN_VERSIONS`. Also expanded by ~50 more pinned packages: firebase, @supabase/supabase-js, @stripe/stripe-js, @clerk/clerk-react, @prisma/client, 10+ more Radix UI components, @headlessui/react, @tanstack/react-table, @tanstack/react-router, @trpc/*, three, @react-three/fiber, @react-three/drei, chart.js, react-chartjs-2, d3, reactflow, @monaco-editor/react, @tiptap/react, react-window, embla-carousel-react, gsap, appwrite, and more.
- `ErrorPatternMatcher.ts` — Added 10 new ERROR_PATTERNS: Objects as React child, missing key prop, Firebase invalid API key, CORS, Next.js SSR data fetching, maximum update depth (infinite re-render), useRouter from wrong Next.js package, invalid hook call, React hydration mismatch. Added 9 new INSTRUCTION_HINTS: Stripe, Clerk, PocketBase, Convex, Three.js, Charts/D3, Prisma, Appwrite.
- `AppKnowledgeBase.ts` — added `backend-scaffolds` entry (PocketBase + Convex scaffold detection, generated files, setup instructions).
- `tests/scaffold.test.ts` — +8 tests for PocketBase + Convex detect + scaffold.
- `tests/dependencySync.test.ts` — +2 tests for pocketbase/convex curated versions.
- `tests/errorPatternMatcher.test.ts` — +16 tests for new error patterns + instruction hints (422/422 total green).
- tsc x2 clean, 422/422 green.

**Phase 6 DONE when:** UPI payment app builds + deploys in <5 min. Full Pro Chat works on
mobile. All framework/deploy claims are PASS-verified end-to-end. Nothing faked.

### 6.6 — Test Coverage Expansion ✅ IN PROGRESS (2026-06-21)
**Branch:** `claude/test-coverage-analysis-bq0yev`

**Shipped — 1059 tests / 144 test files (started from 422/422):**

New test files added (pure unit tests, no I/O, no flaky mocks):
- `tests/templateProviders.test.ts` — StaticProvider, NodeExpressProvider, NextjsProvider, SvelteProvider, VueProvider, PythonFastapiProvider, TemplateRegistry (19 tests)
- `tests/featureExtractor.test.ts` — FeatureExtractor keyword detection (8 tests)
- `tests/intentExtractor.test.ts` — IntentExtractor domain/role/type detection (8 tests)
- `tests/failureClassifier.test.ts` — FailureClassifier error classification (7 tests)
- `tests/repairScorer.test.ts` — RepairScorer deterministic scoring (5 tests)
- `tests/moduleClassifier.test.ts` — ModuleClassifier feature→type mapping (8 tests)
- `tests/taskScheduler.test.ts` — TaskScheduler DAG + status propagation (6 tests)
- `tests/impactAnalyzer.test.ts` — ImpactAnalyzer BFS graph traversal (7 tests)
- `tests/repairConfidenceEngine.test.ts` — RepairConfidenceEngine weighted scoring (8 tests)
- `tests/patternMatcher.test.ts` — PatternMatcher scoring + filtering (5 tests)
- `tests/errorPatternMatcher.test.ts` — matchErrorPatterns + hintForInstruction (9 tests, refined)
- `tests/featureCoverage.test.ts` — extractRequestedFeatures + computeFeatureCoverage (10 tests)
- `tests/blueprintBuilder.test.ts` — BlueprintBuilder.build() (8 tests)
- `tests/patternResolutionEngine.test.ts` — PatternResolutionEngine.resolve() (5 tests)
- `tests/generationEngines.test.ts` — BackendGenerationEngine, FrontendGenerationEngine, DatabaseGenerationEngine, DefaultGenerationEngine (11 tests)
- `tests/serverStats.test.ts` — serverStats singleton (7 tests)
- `tests/engineDispatcher.test.ts` — EngineDispatcher dispatch + error (3 tests)
- `tests/kernelErrors.test.ts` — KernelStateError, DependencyError, ServiceStartupError, ServiceShutdownError (5 tests)
- `tests/workspaceMemoryStore.test.ts` — WorkspaceMemoryStore VITEST-skip (2 tests)
- `tests/workspaceRegistry.test.ts` — WorkspaceRegistry CRUD via in-memory repo (5 tests)
- `tests/conflictDetector.test.ts` — ConflictDetector (3 tests)
- `tests/auditManager.test.ts` — AuditManager console delegation (3 tests)
- `tests/errorPatternStore.test.ts` — ErrorPatternStore VITEST-skip (4 tests)
- `tests/appKnowledgeBase.test.ts` — APP_KNOWLEDGE_BASE integrity + getFeatureById (6 tests)
- `tests/aiRouter.test.ts` — AIRouter circuit breaker + fallback (6 tests)
- `tests/staticRuntime.test.ts` — StaticRuntime session lifecycle (7 tests)
- `tests/aiRouterManager.test.ts` — AIRouterManager singleton pattern (5 tests)
- `tests/executionOrchestrator.test.ts` — ExecutionOrchestrator DAG execution (3 tests)

tsc x2 clean (0 errors), vitest 1016/1016 green.

**Extended — 1180 tests / 159 test files (continued 2026-06-21):**

Additional test files (this session):
- `tests/unifiedBuildOrchestrator.test.ts` — isUnifiedEngineEnabled() flag (4 tests)
- `tests/featureImplementationAgent.test.ts` — FeatureImplementationAgent shape (4 tests)
- `tests/userCostStore.test.ts` — UserCostStore VITEST-skip (5 tests)
- `tests/aiAgents.test.ts` — PlanningAgent, ProjectStructureAgent, RequirementsAgent (8 tests)
- `tests/projectGraph.test.ts` — InitialMemory shape + MemoryIndexer.index() (8 tests)
- `tests/renderPreview.test.ts` — isReactProject, isVueProject, renderPreview dispatch (12 tests)
- `tests/buildEngineTypes.test.ts` — BuildManifest/Feature types + BuildVerifier (9 tests)
- `tests/securityEvaluator.test.ts` — SecurityEvaluator PASS/FAIL + nested scan + node_modules skip (6 tests)
- `tests/workspaceManagerAI.test.ts` — WorkspaceManager path-traversal jail + command whitelist + ChessEngine + AIRuntimeManager (14 tests)
- `tests/workspaceController.test.ts` — WorkspaceController create/save/get/delete/updateStatus (8 tests)
- `tests/proMemory.test.ts` — ProMemoryStore VITEST-skip (8 tests)
- `tests/firestoreStores.test.ts` — logStore, metricsStore, proBuildSessionStore VITEST-skip (11 tests)
- `tests/coderAgentAndRouter.test.ts` — CoderAgent delegation + buildEngineerRouter factory (8 tests)
- `tests/portManager.test.ts` — PortManager real-socket port allocation + release (4 tests)
- `tests/fileAnalyzerAndPatternLibrary.test.ts` — FileAnalyzer TypeScript AST + PatternLibrary integrity (12 tests)
Also fixed: SecurityEvaluator regex (now matches `KEY = "value"` with spaces around `=`).

tsc x2 clean (0 errors), vitest 1180/1180 green.

**Extended — 1256 tests / 170 test files (continued 2026-06-21, session 3):**

Additional test files (this session):
- `tests/scaffoldGenerator.test.ts` — ScaffoldGenerator file generation via mock IWorkspaceManager (4 tests)
- `tests/authMiddleware.test.ts` — verifyFirebaseToken, requireUserMatch, buildRateLimiter VITEST-skip (7 tests)
- `tests/patchToWorkspaceBridge.test.ts` — PatchToWorkspaceBridge writeFile delegation (4 tests)
- `tests/appMakerBlueprintBuilder.test.ts` — AppMakerLab/BlueprintBuilder.build() shape (8 tests)
- `tests/dbModule.test.ts` — lib/db setDb/getDb contract (4 tests)
- `tests/vcsProvider.test.ts` — VCSProvider commit/branch/tag/recover with full mocks (8 tests)
- `tests/localGitProvider.test.ts` — LocalGitProvider pure validation (protocol/hostname/branch-name/author) (14 tests)
- `tests/buildVerifier.test.ts` — BuildVerifier.verify() existence/forbidden-patterns/size (8 tests)
- `tests/workspaceLauncher.test.ts` — WorkspaceLauncher detectPackageManager/installDependencies/getStartCommand (13 tests)
- `tests/sandboxManager.test.ts` — SandboxManager no-op terminate/lifecycle on unknown workspace (3 tests)
- `tests/repairEngine.test.ts` — BuildEngine/RepairEngine error classification (3 tests)

Also: discovered 4 existing colocated src/*.test.ts files included by vitest (AIRouter, FileSanitizer,
WorkspaceMutationEngine, TransactionCoordinator) — confirmed green.

tsc x2 clean (0 errors), vitest 1256/1256 green.

**Extended — 1263 tests / 171 test files (continued 2026-06-22, session 4):**

Additional test files (this session):
- `tests/appMakerRepairEngine.test.ts` — AppMakerLab/repair/AutoRepairEngine with injected mock deps (7 tests): no-error path (0 attempts/repaired=false), repaired=true when patches generated, attempt count, mutate called, repaired=false/3-attempts-exhausted when no patches returned.

tsc x2 clean (0 errors), vitest 1263/1263 green.

**Extended — 1310 tests / 172 test files (2026-06-22, session 5):**

Additional test files (this session):
- `tests/appUtils.test.ts` — 5 pure utility functions extracted from App.tsx (47 tests): detectFrameworkFromFiles (12), detectAppType (8), isClassicVanillaWeb (6), buildLanguageRule (7), classifyError (14).
- Refactor: removed 4 inline function bodies from App.tsx (buildLanguageRule, classifyError, detectAppType, isClassicVanillaWeb); all 5 now imported from `src/lib/appUtils.ts`.

tsc x2 clean (0 errors), vitest 1310/1310 green.

**Extended — 1345 tests / 173 test files (2026-06-22, session 5 continued):**

Additional test files (this session):
- `tests/chatUtils.test.ts` — 6 pure utility functions extracted from App.tsx (35 tests): generateUCI (6), getRandomElement (3), generateSmartHeuristicSummary (6), extractCode (6), classifyBuildIntent (7), classifyAutoIntent (7).
- Refactor: removed 6 inline function bodies from App.tsx (extractCode, classifyBuildIntent, classifyAutoIntent, generateUCI, getRandomElement, generateSmartHeuristicSummary); all 6 now imported from `src/lib/chatUtils.ts`.

tsc x2 clean (0 errors), vitest 1345/1345 green.

**Extended — 1379 tests / 176 test files (2026-06-22, session 6):**

Additional test files (this session):
- `tests/previewUtils.test.ts` — stripFences (5), injectHarness (6), buildUniversalPreview (3) = 14 tests
- `tests/firestoreUtils.test.ts` — sanitizeFirestoreData recursive null-replacement (7 tests)
- Refactor: extracted PREVIEW_HARNESS, PREVIEW_BOOTSTRAP, UNIVERSAL_VIEWER_CSS/JS, stripFences, buildSourceAppPreview, buildUniversalPreview, injectHarness from App.tsx → `src/lib/previewUtils.ts`; extracted sanitizeFirestoreData → `src/lib/firestoreUtils.ts` (re-exported for SDAChat backward compat)
- App.tsx: **5,861 lines** (down from 10,658 original = 45% total reduction; down from 6,610 before this session)

tsc x2 clean (0 errors), vitest 1366/1366 green. (Note: 1379 in PROGRESS.md was a typo; actual baseline was 1366.)

**Extended — 1366 tests / 175 test files (2026-06-22, session 7):**

Refactor: extracted NBI chat inline JSX from App.tsx → `src/components/panels/NBIChatPanel.tsx` (~155 lines).
- App.tsx: **5,820 lines** (down from 10,658 original = 45.4% total reduction)
- Removed unused `AISuggestions` lazy import from App.tsx (now imported inside NBIChatPanel)

tsc x2 clean (0 errors), vitest 1366/1366 green.

**Extended — 1370 tests / 175 test files (2026-06-22, session 7 continued):**

- `tests/routesAdmin.test.ts` — +4 tests: GET /api/admin/metrics (snapshot+alerts shape), GET /api/admin/announcements (returns array), announcements list includes posted item, POST /api/admin/promo 400 on missing code.

tsc x2 clean (0 errors), vitest 1370/1370 green.

**Extended — 1380 tests / 176 test files (2026-06-22, session 7 continued):**

- `tests/routesEngineer.test.ts` (NEW) — 10 tests: engineer-chat 503 prod/400 missing fields, engineer-restore 400, engineer-browser-event 400, engineer-deploy 400, engineer-pause 400, engineer-db-scaffold 400 (missing workspaceId + invalid provider), engineer-guider-plan 400.

tsc x2 clean (0 errors), vitest 1380/1380 green.

**Extended — 1393 tests / 177 test files (2026-06-22, session 7 continued):**

- `tests/routesBuildPro.test.ts` (NEW) — 13 tests: GET /api/capabilities, /api/guider/plan 400+disabled path, /api/guider/grade disabled+no-files, /api/build 400, /api/pro/code-review 400 (missing+empty), /api/pro/deploy 400 (missing fields, vercel/netlify/cloudflare/unknown-provider validation).

tsc x2 clean (0 errors), vitest 1393/1393 green.

**Extended — 1399 tests / 178 test files (2026-06-22, session 7 continued):**

- `tests/routesAuthGithub.test.ts` (NEW) — 6 tests: OTP send 400 missing phone, 200 first valid request, 429 phone cooldown; GitHub fetch/file/branches 401 on missing auth header.

tsc x2 clean (0 errors), vitest 1399/1399 green.

**Extended — 1406 tests / 179 test files (2026-06-22, session 7 continued):**

- `tests/theme.test.ts` (NEW) — 7 tests: THEME_MODES exports all 5 modes with label+value; getThemeClasses shape for all themes, dark/light bg classes, distinct backgrounds, raw.bg CSS format.

tsc x2 clean (0 errors), vitest 1406/1406 green.

**Extended — 1420 tests / 180 test files (2026-06-22, session 8):**

- `tests/routesSdaChatMisc.test.ts` (NEW) — 14 tests: SDA /api/sda-chat 400 when both message+fileData missing; chat tier registration (5 endpoints), 400 missing message/fileAttachments for navbharat+vishwakarma-pro; zip /api/download-zip 400 no files; anthropic /api/anthropic 400 missing userId/messages (3 body variants).

tsc x2 clean (0 errors), vitest 1420/1420 green.

**Extended — 1445 tests / 182 test files (2026-06-22, session 8 continued):**

- `tests/routesPaymentPreview.test.ts` (NEW) — 13 tests: payment create-order 400 missing userId/amount; verify-payment 400 missing orderId; redeem-coupon 400 missing userId/code; preview-bundle/preview-vue 400 missing/non-object files; /api/preview 400 missing and empty files object.
- `tests/routesMiscValidation.test.ts` (NEW) — 12 tests: audit security/scan + full audit 400 missing target/url; githubAuth /api/github/user + /repos 401 missing token; sync POST 400; cloudsync/github 401; team/invite 400 missing fields + invalid email.
- `tests/helpers/routeTestUtils.ts` — extended with `app.all()` support for routes using it.

tsc x2 clean (0 errors), vitest 1445/1445 green.

**World-class Chat+IDE (2026-06-22, session 9):**

- `src/components/panels/ProChatPanel.tsx` — resizable split pane: drag handle between chat and workspace (20–80% range), grip dots, wider hit area, indigo hover; auto-opens workspace pane when build completes with files (desktop only).

tsc x2 clean (0 errors), vitest 1445/1445 green.

**Extended — 1450 tests / 183 test files (2026-06-22, session 9 continued):**

- `tests/routesFirebaseAuth.test.ts` (NEW) — 5 tests: registration (all 4 endpoints); GET /api/auth/firebase returns HTML with "Firebase" text; GET /consent and /callback return HTML; POST /connect returns 501.

tsc x2 clean (0 errors), vitest 1450/1450 green.

**App.tsx split grind — 1494 tests / 187 test files (2026-06-22, session 9 continued):**

Pure-logic extractions out of App.tsx (each with full unit tests), continuing Phase 5.1:
- `tests/filePlanningEngine.test.ts` (NEW) — 7 tests for FilePlanningEngine.plan() + BlueprintReconstructor.
- `src/lib/apnapanEngine.ts` (NEW) — greeting/language/style/project detection extracted; `tests/apnapanEngine.test.ts` 18 tests.
- `src/lib/versionSnapshot.ts` (NEW) — buildVersionSnapshot + appendVersionSnapshot; `tests/versionSnapshot.test.ts` 12 tests.
- `src/lib/agentGreetings.ts` (NEW) — NBI/Basic/Pro/VIP pools + pickGreetingForAgent; `tests/agentGreetings.test.ts` 8 tests; removed 4 dead vars.
- `src/config/defaultContent.ts` (NEW) — DEFAULT_HOME/ABOUT/DONATION_DATA + loadPersistedContent; `tests/defaultContent.test.ts` 6 tests.
- `src/lib/deployRequest.ts` (NEW) — validateDeployInput + buildDeployBody (4 platforms); `tests/deployRequest.test.ts` 13 tests.
- `src/lib/uploadClassify.ts` (NEW) — isZipFile/isTextFile/classifyZipSize; `tests/uploadClassify.test.ts` 10 tests.
- `chatUtils.ts` — NEW dedupAndSortMessages() (dedup by id + sort); +4 tests.
- `src/lib/sessionRouting.ts` (NEW) — resolveSessionSurface(agent, savedTab); `tests/sessionRouting.test.ts` 9 tests.
- **App.tsx: 5,820 → 5,626 lines** (−194 this session; 47% total reduction from 10,658 original).

tsc x2 clean (0 errors), vitest 1530/1530 green.

---

## PHASE 7 — Production Launch Hardening
_Measure everything. No assumptions. Ship when criteria are proven._

### 7.1 — Verify success criteria (timed, recorded) ⏳ ADMIN/MANUAL
The "Measurable Success Criteria" list (top of this file) must be verified with a
real stopwatch against the live deploy — this is inherently manual (human watches
a 5-page app build, times first-token, tries it on a phone). Code cannot self-certify
these honestly. **Action for admin:** run the checklist against prod, record date +
pass/fail per line. All the underlying features are shipped; this is the sign-off step.

### 7.2 — Load test ✅ SCRIPT SHIPPED — run is admin/infra (2026-06-21)
- NEW `loadtest/build-stream.k6.js` — real, runnable k6 capacity test: ramps 20→100→300
  VUs against the lightweight ingest endpoints (no AI spend), with launch-gate
  thresholds (p95<1s, errors<1%). Real-build load is opt-in (`ENABLE_BUILD_LOAD=1`)
  and meant for a STAGING deploy with a mocked AI provider (a real build costs money).
- **Action for admin:** `k6 run -e BASE_URL=<staging> loadtest/build-stream.k6.js`,
  then paste the p50/p95/error numbers into RUNBOOK.md. Running it needs the k6 tool +
  a deployed target (infra), which the Claude session does not have.

### 7.3 — Cost controls + quotas per tier ⛔ BLOCKED on a prerequisite (honest)
Hard per-tier quotas (Free 3/day, Pro 20/day, BYOK unlimited) require a **user
subscription/plan system that does not exist yet** — audited the codebase on
2026-06-21: every "tier" reference is the *execution* tier (vfs/e2b/cloudrun), not a
user plan. Building plan storage + assignment + a tier-lookup in auth middleware is a
large standalone feature (its own phase), not a wiring task. What IS shipped: real
hourly rate limiting (`buildRateLimiter`: 10/hr authed, 5/hr anon, Phase 0b) and
per-user monthly cost tracking (`UserCostStore`, Phase 4.2). **Recommendation:** treat
"per-tier quotas" as a dedicated future feature gated on the plan system; do not fake
a tier the product doesn't sell yet.

### 7.4 — Full security re-audit ✅ AUTOMATED PART DONE — scan is admin/infra
- `npm audit --audit-level=high` — already runs in CI on every push (G4, `.github/workflows/ci.yml`).
- OWASP ZAP scan — needs the external tool + a live target (infra). **Action for admin:**
  `docker run -t ghcr.io/zaproxy/zaproxy zap-baseline.py -t https://<prod-url>`.
- Manual review of secrets/admin/E2B isolation: the code paths are hardened
  (Phase 0: auth-gated secrets, sanitized admin errors, rate limits, sandbox isolation
  per workspace). Final human pen-review is an admin sign-off step.

### 7.5 — AppKnowledgeBase fully synced ✅ DONE (2026-06-21)
**Branch:** `claude/test-coverage-analysis-bq0yev`

Audited every user-facing view/feature against `AppKnowledgeBase.ts` (now 47 entries).
All primary views are covered. Gaps found + filled this session:
- `auto-test-generation` (Phase 17), `unified-workspace` (Phase 3.1) — added when shipped.
- `code-testing-panel` (Code Studio → Testing tab), `api-tester` (Code Studio → API tab),
  `project-templates` (Blueprints/Templates gallery, incl. Bharat-first templates) — added now.
Each new entry has exact path, sub-capability description, howToUse, relatedFeatures, and
English + Hindi/Hinglish keywords. `appKnowledgeBase.test.ts` integrity checks green.
Ongoing rule (CLAUDE.md): any new user-facing feature adds its entry in the same PR.

### 7.6 — Runbooks + rollback drills ✅ RUNBOOK SHIPPED — drills are admin/manual
- NEW `RUNBOOK.md` — real incident procedures (symptom → diagnosis → action → verify)
  for all four scenarios: ENGINE=v2 rollback (<30s, exact gcloud command), E2B-quota
  fallback to VFS, AI-provider failover (auto via circuit breaker), Firestore restore;
  plus the deploy-didn't-fire procedure. Includes a quarterly drill log to fill in.
- **Action for admin:** execute each drill once against staging, record date + result
  in the runbook's drill log. The procedures are written and accurate; running them is
  a human task (touches live Cloud Run / Firestore).

**Phase 7 DONE = LAUNCH READY.** All success criteria recorded as passing.
Load capacity documented honestly. Security scan clean. Runbooks tested.

---

## ADMIN DEPENDENCIES (non-blocking — code continues without these)

| Action | Needed for |
|--------|-----------|
| Rotate leaked Gemini key (Google Cloud Console) | P0a code ships; key rotation is separate |
| Set strong `SECRET_ENCRYPTION_KEY` in Cloud Run | P0a warning fires until set |
| E2B_API_KEY in Cloud Run | Already done |
| Confirm Redis/Memorystore budget | P4.1 (Firestore used by default) |
| Razorpay/UPI API credentials | P6.1 scaffold ships without live creds |
| Confirm per-tier quota limits and pricing | P7.3 |

---

## WHAT MAKES THIS BETTER THAN CLAUDE CODE

| Claude Code | NavBharatAI Pro v2.0 |
|-------------|----------------------|
| Terminal CLI, developers only | Browser + Mobile, founders + developers |
| No Bharat integrations | UPI, GST, Aadhaar built-in |
| You manage git manually | Git-native, every build is a checkpoint |
| Full Claude API pricing | Tiered pricing, affordable for individuals |
| English only | Hindi + regional languages |
| No live preview | Live preview, every build |
| Manual deploy | One-click: Vercel / Netlify / Cloudflare / Railway |
| Cannot learn from failures | Error pattern learning, gets smarter every build |
| Desktop only | Mobile-first, works on phone |

Goal: not to copy Claude Code — to build what Claude Code would be if designed for
**building apps** (not editing existing code) and for **Bharat** (not Silicon Valley).

---

## CROSS-SESSION PROTOCOL (mandatory, every session)

- Never trust this doc blindly — `git fetch origin main && git log --oneline -10` first.
- Append-only. Never delete existing milestone entries. Correct stale claims by adding a new dated note.
- `PROGRESS_ARCHIVE.md` is read-only history. Never edit it.
- Every phase ends with an honest DONE entry: tsc x2 + vitest + smoke + manual end-to-end verified.
- All source code, UI text, comments, variable names: professional English only (CLAUDE.md rule).

---

_Roadmap version: 2.0 — 2026-06-21_
_Previous work history: PROGRESS_ARCHIVE.md_

---

## 2026-06-23 — v3.0 made LIVE on Claude + roadmap build-out (session milestone)

**Context:** v3.0 was silently failing on Claude (every call 404'd). Root-caused
and fixed, then began building the post-48 roadmap one capability at a time, each
fully verified (tsc frontend+server + full vitest + boot:check green) and merged
to main (= deployed via Cloud Run). All commits use the verified
`Claude <noreply@anthropic.com>` identity.

### Fixes that made v3.0 actually work on Claude
- **Root cause of "v3.0 not calling Claude":** the Anthropic SDK reads
  `ANTHROPIC_BASE_URL` from the env when no `baseURL` is passed, so native
  `messages.create` was being routed to the OpenAI-compatible **aicredits proxy**
  (returns "404 page not found") and the engine silently fell back to
  Vertex/Gemini/Grok — billing showed $0 spend on a valid `sk-ant` key.
  Fixed by **always pinning** `baseURL` to the real Anthropic endpoint
  (`resolveAnthropicBaseUrl`), plus `sanitizeApiKey()` (trims paste
  whitespace/quotes). Confirmed LIVE by the admin.
- **Removed the aicredits proxy app-wide** (`pro.ts`, `sda.ts`, `build.ts`,
  `aiCalls.ts`, `aiClients.ts`, `AppEngine.ts`, `AnthropicProvider.ts`, deleted
  the dead `/api/anthropic` route + `AiCreditsProvider`). Every feature now calls
  Claude natively or falls through to Grok/Vertex/Gemini.
- **Diagnostics:** `GET /api/agentv3/diag` (no secrets; `?test=1` live probe) +
  `[AGENTV3][CLAUDE_FAIL]` log line for fast root-causing.

### v3.0 UX
- **Word-by-word streaming** of the assistant reply (Claude `messages.stream`).
- **"Thinking" toggle** — adaptive thinking with summarized display, streamed live.
- **Iterative sessions** (stable sessionId → same sandbox/memory across messages)
  and a **"New"** button. (session-continuity)

### Roadmap capabilities shipped (each real, tested, additive, best-effort)
- **Layer 53 v1 — Authenticity analyzer** (evaluate): flags fake/incomplete code
  (TODO/FIXME, "not implemented" throws, stub/mock data, lorem ipsum, empty
  handlers) — enforces "no fakes".
- **Layer 22 v2 — Dependency consistency** (evaluate): imports missing from
  package.json (would break install/runtime) + unused deps.
- **Layer 53 v3 — Env-var completeness** (evaluate): `process.env.X` read in code
  but undocumented in `.env.example` (the app won't run for the user).
  → `evaluate` now runs **6 gates**: Readiness + Architecture + Security +
  Authenticity + Dependencies + Env-vars (all best-effort).
- **Layer 57 v1 — Build Reflection**: after each build, write lessons (errors→
  fixes) into project memory.
- **Layer 79 v1 — Continual Learning**: at each build's START, recall and apply
  those past lessons — closing the learn loop (the "beyond Mythos" lever).
- **Layer 84 v1 — Second Opinion tool**: Architect/Reviewer can get an independent
  cross-model review (non-Claude router). Optional, never throws, Architect+Reviewer.
- **Layer 49 v1 — Consensus tool**: Architect convenes a 3-perspective panel
  (correctness/security/UX) from a different model + synthesized verdict.
- **Layer 73 v1 — Build in the user's language**: generated apps' user-facing
  text matches the request's language (detectLanguageHint covers 22 Indian + CJK/
  Arabic/Cyrillic scripts); code stays English. The "world #1 + Bharat" vision.

### Roadmap docs
- Added Sections D/E/F to `V3_ROADMAP.md`: Layers 49–86 (Collective Intelligence
  → Civilization Scale, world-class + Bharat-friendly, beyond-Mythos) + Layer 72
  (UCUE computer-use) + the 10-level Ultimate Maturity Model. Honest
  self-assessment: **Level 3 (Claude Code class)**, parts of Level 4 underway.

**Test suite: 1754 passing.** Next sessions: continue the roadmap one verified,
additive capability at a time; a user-facing "what I built" summary and the
multilingual UI are good next picks. Admin still to set `ADMIN_PASSWORD` in Cloud
Run (admin login) and fix Google sign-in authorized domains (Firebase console).

---

### 2026-06-23 — Layer 77 "Bharosa" (Trust, Safety & Compliance) — evaluate gate #8

Continued the Section-E roadmap. Added a real, deterministic privacy/compliance
dimension to the v3.0 `evaluate` tool (the proven gate pattern — like Layers 53/22/78).
DPDP/GDPR-oriented, DISTINCT from the existing security/secret scanner.

- New `src/server/AgentV3/ComplianceAnalysis.ts`: file-local rules — personal data
  written to logs (`pii-in-logs`, high), sensitive values in browser storage
  (`sensitive-in-browser-storage`, medium), cookies without SameSite
  (`cookie-no-samesite`, medium), personal data over plain http
  (`insecure-http-endpoint`, medium); plus two PROJECT-LEVEL rules wired in the
  dispatcher — collecting PII with no privacy policy (`missing-privacy-policy`,
  high) and a tracker with no consent surface (`tracker-without-consent`, medium).
  Ends with an honest **launch-safe certificate** (CERTIFIED / CONDITIONAL /
  NOT CERTIFIED) derived only from real findings.
- Wired into `ToolDispatcher.evaluate` (now 8 gates: Readiness + Architecture +
  Security + Authenticity + Dependencies + Env-vars + Accessibility + Compliance),
  `ToolCatalog` evaluate description, and `AppKnowledgeBase` (description + keywords).
- 14 new unit tests. Full gate green: tsc frontend+server, build, boot:check.

**Test suite: 1817 passing.** Also shipped earlier today (#238): real document
extraction (Word/Excel/PPT/ZIP) + Claude vision fallback across Free/Pro chat,
v3.0 file attachments (cheap vision default, Claude only in Power mode), and SDA
office/zip support. Next picks: Layer 74 (Sahyog — partnership UX: calibrated
confidence/explainability) is buildable now; Layers 75/76 need external hosting/
payments infra.

---

### 2026-06-23 — Layer 74 "Sahyog" (Calibrated Build Confidence + explainability)

Admin-selected next roadmap pick. The partnership move: v3.0's `evaluate` now states
an HONEST, CALIBRATED confidence ("Build confidence: 72% (Medium) — here's why: …")
instead of declaring success by vibes — derived only from the real signals across all
eight gates, with every lost point explained as a concrete, fixable reason.

- New `src/server/AgentV3/BuildConfidence.ts`: `computeBuildConfidence(input)` →
  deterministic 0–100 score + High/Medium/Low band + positives (clean gates) +
  negatives (issues, highest-impact first). Hard calibration ceilings: a build-breaker
  (unresolved import / missing dependency) caps confidence at 35; a high-severity
  security or privacy/compliance blocker caps it at 60. `buildConfidenceSummary()`
  renders the "I'm N% confident — here's why" block.
- Wired into `ToolDispatcher.evaluate`, surfaced right after the readiness verdict.
  Refactored the dependency/env/compliance collectors to return their issue arrays
  (summaries now rendered at the evaluate site) so confidence can be computed from
  real per-gate tallies. Behavior of the existing sections is unchanged.
- `ToolCatalog` evaluate description + `AppKnowledgeBase` (description + keywords)
  updated. 10 new unit tests.

**Test suite: 1827 passing.** Full gate green: tsc frontend+server, build, boot:check.
Section E status: 73 ✓, 74 ✓, 77 ✓, 78 ✓ done; 75/76 need external hosting/payments.

---

### 2026-06-23 — Layer 59 "Knowledge Evolution" (continuing Section D)

Improves the existing learning loop (Layers 57/79) with real knowledge hygiene:
recalled lessons are now EVOLVED before they are fed back into the next build.

- New `src/server/AgentV3/KnowledgeEvolution.ts` (`evolveLessons`, PURE/deterministic):
  • de-duplicates near-identical lessons (token Jaccard ≥ 0.85, keeping the strongest),
  • resolves CONFLICTS — when two lessons make the same claim with opposite polarity
    ("use X" vs "avoid X"), the NEWER one wins and the stale one is dropped
    (conservative: only fires on same-claim/flipped-negation),
  • recency-weighted ranking (aging) — fresher lessons rank above equally-relevant
    older ones; higher relevance still beats mere recency.
- Surfaced `ts` on episode RecallHits (WorkspaceMemory) so recency is available.
- Wired into `formatRecalledLessons` (Layer 79 recall path) — public API unchanged.
- AppKnowledgeBase memory bullet updated. 10 new unit tests; existing 7 recall
  tests still green.

**Test suite: 1837 passing.** Full gate green: tsc frontend+server, build, boot:check.

---

### 2026-06-23 — Layer 58 "Autonomous Governance" v1 (command risk + decision-audit)

Foundation for accountable autonomy: before the build agent runs a shell command,
the command is risk-classified; risky operations are flagged honestly in the result
and recorded to a per-project decision-audit trail.

- New `src/server/AgentV3/CommandGovernance.ts` (`classifyCommandRisk`, pure/
  deterministic): HIGH = irreversible/dangerous/RCE/exfiltration (rm -rf of
  root/home/wildcard, --no-preserve-root, fork bomb, dd/mkfs to /dev, curl|sh,
  env|curl, reading private keys, chmod 777 /, sudo, git push --force); MEDIUM =
  local destructive / unexpected network (rm -rf <dir>, git reset --hard, git clean
  -f, npm i -g, kill -9, external curl/wget, writes to system dirs). Conservative —
  normal build/test/git commands never flagged.
- New `audit` EpisodeKind + `recordAudit()` on WorkspaceMemory — a separate,
  queryable record that is NOT injected back as a build "lesson".
- Wired into the `bash` tool: risky commands get a governance warning prepended to
  the result and an audit episode recorded. Does NOT block execution (hard gating
  stays with the human-approval system) — it makes risk visible and accountable.
- AppKnowledgeBase + keywords updated. 10 new unit tests.

**Test suite: 1847 passing.** Full gate green: tsc frontend+server, build, boot:check.

---

### 2026-06-23 — Google sign-in hardening (popup→redirect fallback + actionable errors)

User reported Google login + admin login broken. Findings:
- ADMIN LOGIN: code is correct (frontend handler + server /api/admin/login). The
  only blocker is the `ADMIN_PASSWORD` env var not set in Cloud Run → server
  returns 503 "Admin access not configured". This is a Cloud Run config action
  (admin-only); no code change possible/needed.
- GOOGLE LOGIN: code only used signInWithPopup (blocked on many mobile/strict
  browsers) and surfaced opaque errors. Fixed in code:
  • added signInWithRedirect fallback when the popup is blocked/closed/unsupported,
    with getRedirectResult() completing the sign-in on return;
  • added describeGoogleError() — names the exact fix for the two config failures
    (auth/unauthorized-domain → add THIS domain to Firebase Authorized domains;
    auth/operation-not-allowed → enable Google provider), including the live
    hostname and project id, so it's self-diagnosing without a console;
  • prompt:'select_account' for predictable account choice.
  • declarations.d.ts: added signInWithRedirect/getRedirectResult to the hand-
    written firebase/auth module types.

Config still required by admin (cannot be done from code):
  • Cloud Run: set ADMIN_PASSWORD (+ ADMIN_USERNAME if not aashishcpmt09).
  • Firebase Console (project gen-lang-client-0866594388) → Authentication:
    enable Google provider + add the live serving domain to Authorized domains.

**Test suite: 1858 passing.** Gate green: tsc frontend, build, vitest.

---

### 2026-06-23 — Admin login real bug fix (HMAC key inconsistency on env whitespace/quotes)

User confirmed ADMIN_PASSWORD is set in Cloud Run but admin login still failed.
Root cause found in code (admin.ts): the login endpoint issued the daily token
using a TRIMMED password as the HMAC key, but verifyAdminToken recomputed the
expected token using the RAW process.env.ADMIN_PASSWORD (and raw ADMIN_USERNAME).
If the env value carries a trailing newline / stray whitespace / wrapping quotes
(very common when set via console or gcloud), the two HMAC keys differ → login
SUCCEEDS but every subsequent /api/admin/* dashboard call 403s, so the panel
appears broken.

Fix: a shared adminCredential() normaliser (trim + strip one layer of wrapping
quotes, with fallback) is now used on BOTH the login and verification sides, so
the issued token and the verifier always agree. Exported + 5 unit tests
(normalisation cases + an HMAC round-trip regression guard).

Also noted (config, not code): firebase.json hosting rewrites '**' → /index.html,
so on the Firebase-hosting domain /api/* never reaches Cloud Run; the live Cloud
Run domain is unaffected.

**Test suite: 1869 passing.** Gate green: tsc frontend+server, build, boot:check.

---

### 2026-06-23 — Layer 54 "Strategic Intelligence" v1 (plan review before approval)

Continuing Section D. In Plan mode the Architect proposes a plan then blocks for
approval; now the plan is REVIEWED for strategic gaps first and the findings are
shown next to it, so the user strengthens the plan up front.

- New `src/server/AgentV3/PlanIntelligence.ts` (`analyzePlan` / `planAnalysisSummary`,
  pure/deterministic): flags no testing/verification step (high), no setup/scaffold
  before features (medium), a deploy requested but never planned (medium),
  under-scoped one-step plan (medium), over-large plan (low), and vague generic
  step titles (low). Conservative — a well-formed plan yields no findings.
- Wired into the agentv3 plan flow: after planRunner produces the todos and BEFORE
  the approval gate, a best-effort narration surfaces the review (never blocks the
  gate).
- AppKnowledgeBase + (existing keywords) updated. 14 new unit tests.

**Test suite: 1884 passing.** Gate green: tsc frontend+server, build, boot:check.

---

### 2026-06-23 — Auth diagnostics: surface the REAL Identity Toolkit reason

User hit email/password login failing with auth/internal-error and a misleading
"DIAG 400: ADMIN_ONLY_OPERATION". Root cause is Firebase Console config (sign-in
providers not enabled for project gen-lang-client-0866594388), but the old
diagnostic probed accounts:signUp anonymously — which returns ADMIN_ONLY_OPERATION
simply because anonymous auth is off (normal), hiding the true reason.

Code fix (AuthComponent.tsx): diagnoseAuth() now probes the REAL endpoint —
signInWithPassword with the entered credentials — and explainAuthReason() maps the
Identity Toolkit message to an actionable sentence (CONFIGURATION_NOT_FOUND →
"enable Authentication", PASSWORD_LOGIN_DISABLED/OPERATION_NOT_ALLOWED/
ADMIN_ONLY_OPERATION → "enable the provider in Sign-in method",
INVALID_LOGIN_CREDENTIALS → "wrong password or sign up", API key/referer →
"key restricted"). So the on-screen error now names the exact fix + project.

Config still required by admin (Firebase Console, project gen-lang-client-0866594388):
  • Authentication → Sign-in method → enable Email/Password AND Google.
  • Authentication → Settings → Authorized domains → add navbharatai.com.

Gate green: tsc frontend, build, 1884 vitest.

---

### 2026-06-23 — Google sign-in: redirect-FIRST (popups silently blocked → no popup)

Live config probe (via the public API key, getProjectConfig + createAuthUri) PROVED
the Firebase side is fully correct: navbharatai.com + www.navbharatai.com are in
authorizedDomains, and the Google provider is enabled (createAuthUri returned a
valid OAuth authUri with client_id 950841184325-3hcg…). So the 2 days spent on
domains/providers were chasing a non-issue.

User reported: clicking Google opens NO popup at all. Cause: the browser silently
blocks the OAuth popup (no popup, and often no catchable error), so a popup-first
flow dies quietly. Fix: handleGoogleSignIn is now REDIRECT-FIRST —
signInWithRedirect navigates the whole page to Google (no popup needed, cannot be
blocked); getRedirectResult() (existing effect) completes the sign-in on return.
Removed the now-unused signInWithPopup import.

Gate green: tsc frontend, build, 1884 vitest.

---

### 2026-06-23 — Google login: custom authDomain + /__/auth proxy + CSP frameSrc fix

After redirect-first (#252) the Google account chooser opens, but two bugs remained,
BOTH from authDomain (gen-lang-client-0866594388.firebaseapp.com) ≠ app origin
(navbharatai.com):
  1. consent screen said "continue to …firebaseapp.com" instead of navbharatai.com;
  2. after returning from Google the user was still logged out (modern browsers
     partition the cross-origin auth storage so getRedirectResult comes back empty).
Also found a third real cause: server CSP had frameSrc:["'none'"], which silently
BLOCKS the Firebase auth iframe (and phone-OTP reCAPTCHA).

Fix (the Firebase-documented custom-domain approach):
  • src/config/firebase.ts — authDomain now resolves to the CURRENT origin on
    navbharatai.com / www.navbharatai.com (same-origin → redirect completes, consent
    screen reads the real domain); other hosts keep the firebaseapp.com default.
  • server.ts — reverse-proxy `/__/auth/*` and `/__/firebase/*` to
    gen-lang-client-0866594388.firebaseapp.com (streamed, any method), registered
    before the SPA catch-all so the browser fetches the sign-in helper/iframe from
    our own origin.
  • server.ts CSP — frameSrc now allows 'self' + accounts.google.com + google.com +
    *.firebaseapp.com so the auth/reCAPTCHA iframes can load.

Verified locally: tsc frontend+server, build, boot:check, 1884 vitest all green.
NOTE: the OAuth round-trip itself could not be exercised here — this sandbox's
egress blocks firebaseapp.com (403 "Host not in allowlist") and there's no browser;
the proxy code is correct (it forwarded upstream). Needs a real browser test on the
deployed site. Blast radius is contained: email/OTP login do not depend on the
/__/auth handler, and Google login was already broken.

---

### 2026-06-23 — Logout made bulletproof (signOut could hang on the auth iframe)

User reported logout not working. The handler did `await signOut(auth); reload()` —
if signOut() hangs (the Firebase auth helper iframe is unavailable, which happens
while the custom-authDomain OAuth is mid-config) the reload never runs, so the user
stays signed in. Fix (Header.tsx): race signOut against a 2.5s timeout, then forcibly
remove the persisted firebase:authUser / firebaseLocalStorage keys and reload — logout
now always succeeds regardless of signOut's state.

Also: Google login now returns "Error 400: redirect_uri_mismatch" — EXPECTED, and the
final step: the OAuth client (950841184325-3hcg…) must whitelist
https://navbharatai.com/__/auth/handler + www in GCP Console → Credentials (Authorized
redirect URIs) and the two origins (Authorized JavaScript origins). This is admin-only
config; once added, Google login completes end-to-end with navbharatai.com branding.

Gate green: tsc frontend, build, 1884 vitest.

---

### 2026-06-23 — Google redirect sign-in finalized at app root (was never completing)

User added the GCP redirect URIs (Option 1) → redirect_uri_mismatch gone, Google
accepts the request. But on return to navbharatai.com the user was still logged out:
getRedirectResult() was only called inside AuthComponent's mount effect, and after a
full-page signInWithRedirect the auth modal is NOT mounted on return — so the pending
redirect was never finalized. Fix (App.tsx): call getRedirectResult(auth) in the
app-root auth effect (alongside onAuthStateChanged) so the redirect sign-in completes
on load regardless of the modal; errors are logged.

Gate green: tsc frontend, build, 1884 vitest.

---

### 2026-06-23 — v3.0 chat UX polish (smooth typing, live indicator, input-embedded send)

User feedback on Pro v3.0:
1. Long steps felt frozen (static "working…"). → New WorkingIndicator with a ticking
   elapsed-time counter ("working… 12s") so liveness is unambiguous; if the number
   stops, that's a real freeze (also a diagnostic).
2. Streaming text jumped a whole line at once. → New TypewriterText reveals streamed
   text at a steady ~120 cps cadence (auto-catches up when far behind, snaps to full
   when streaming ends) so typing is always smooth.
3. Send/Stop button now sits INSIDE the input box (absolute bottom-right, 32×32,
   size-matched), with the textarea padded so text doesn't run under it.

(#4 "v3.0 in header as window/tab" — asked the user to clarify before building.)

Gate green: tsc frontend, build, 1884 vitest.

### 2026-06-23 — v3.0 now shows as a top-header tab (#4 from the same feedback)

The top-header tab bar maps openTabs → menuItems; v3.0's view id `engine_builder` was
intentionally absent from the shared menuItems (it has a bespoke sidebar button), so
the Header's lookup returned nothing and v3.0 never appeared as a header tab even
though toggleTab adds it to openTabs. Fix (Header.tsx): a HEADER_TAB_FALLBACK map
supplies a label/icon ("NavBharatAI Pro v3.0", Rocket) for such tab-openable-but-not-
in-menu views, so opening v3.0 now shows it as a header tab like every other view —
without duplicating it in the sidebar. AppKnowledgeBase howToUse updated.

Gate green: tsc frontend+server, build, 1884 vitest.

---

### 2026-06-23 — v3.0 session continuity: never reset on tab-switch + resume from History

User: started a hospital-CRM build in v3.0, accidentally tapped another bottom-nav
tab, came back and v3.0 was reset ("A build is already running" + empty chat). Also:
v3.0 sessions show in History but "open chat" didn't reopen them in v3.0.

Two fixes (App.tsx + AgentV3Panel.tsx):
1. PERSISTENCE — the engine_builder (v3.0) view is now rendered whenever its header
   tab is OPEN (openTabs), hidden with display:none when another view is active,
   instead of being conditionally mounted on activeView. So switching tabs / mobile
   back only HIDES it: the build keeps streaming and the chat/workspace survive. It
   unmounts (and fully resets) ONLY when the tab's ✕ closes it (removed from
   openTabs). This also removes the spurious "build already running" (the backend
   build was continuing while the old client had unmounted).
2. RESUME FROM HISTORY — resumeSession() now detects v3.0 sessions (agent 'agentv3'
   or a v3_ id) and, instead of loading them into the regular chat, hands them to
   AgentV3Panel via a new `resume` prop (sessionId + thread + nonce). The panel
   adopts that sessionId (backend continues with the same workspace/memory,
   best-effort) and restores the saved thread, then opens the v3.0 tab. "Open chat"
   on a v3.0 history item now resumes it in v3.0.

Gate green: tsc frontend, build, 1884 vitest.

---

### 2026-06-23 — v3.0: 3 root-cause fixes (header tab, History open, preview)

User: (1) v3.0 doesn't open as a header tab like other views; (2) History "open" on
a v3.0 chat does nothing; (3) preview not working. Root causes found and fixed:

1. The floating AgentV3Launcher opened its OWN overlay (its own AgentV3Panel
   instance) via local `open` state — never calling toggleTab — so v3.0 never
   entered openTabs and never showed as a header tab (and was a second, conflicting
   instance). Fix: the launcher now calls onOpen → toggleTab('engine_builder'),
   opening the single engine_builder view/tab; removed its overlay + duplicate panel.
2. The History "open" handler is handleRestoreUci (via HistoryView onRestoreSession),
   NOT resumeSession — it had no v3.0 branch, so v3.0 sessions fell through to the
   generic chat restore (did nothing useful). Fix: added a v3.0 branch to
   handleRestoreUci that adopts the saved sessionId + thread (setV3Resume) and opens
   the v3.0 tab.
3. The earlier CSP frameSrc tightening (none → a few google/firebase hosts) blocked
   the v3.0 preview iframe (an arbitrary https sandbox/deploy URL). Fix: frameSrc is
   now ["'self'", "https:"] so any https preview/auth iframe loads (clickjacking of
   us is governed by frame-ancestors, not frameSrc).

Gate green: tsc frontend+server, build, 1884 vitest, boot:check.

---

### 2026-06-23 — "my changes don't show up": SW auto-update + visible build stamp

User reported that several merged fixes had no effect on the live site (saw the OLD
v3.0 launcher-overlay). Root cause is stale code on the device, not the code — so:
- main.tsx: on a controllerchange (a freshly deployed service worker taking control)
  the page reloads ONCE, and reg.update() is called on load — so a deploy auto-
  updates open clients instead of leaving them on cached JS. public/sw.js bumped
  v3→v4 to force a fresh activate + clients.claim.
- vite.config.ts injects __BUILD_TIME__ (build timestamp); the v3.0 header shows a
  tiny "b:MM-DD HH:MM" stamp so the deployed version is verifiable at a glance — if
  it doesn't change after a deploy, the browser is serving cached code.
Also clarified to the user: v3.0 History save/resume require being LOGGED IN (the
screenshot showed a logged-out session), and the header-tab/resume/preview fixes
need the new deploy to actually load.

Gate green: tsc frontend, build (verified __BUILD_TIME__ injected), vitest, boot:check.

---

### 2026-06-23 — 220-System Gap Audit (UCUE v2.0 / Claude Code / Cursor / OpenHands / Devin)

Admin gave a 220-system "missing systems" list and asked which are NOT in the app +
to add the genuine gaps to the roadmap. Audited the list against the REAL codebase
(four parallel code-inventory passes over AgentV3 / AppMakerLab / EngineerAI /
QualityEvaluationEngine / workspace / runtime / routes — file-evidence per item, not
guesses). Result: ~88 PRESENT (40%) · ~44 PARTIAL (20%) · ~88 ABSENT (40%).

New doc `UCUE_V2_GAP_AUDIT.md`: full 220-item PRESENT/PARTIAL/ABSENT mapping with
file evidence (Section 2), the already-planned gaps cross-referenced to existing
tracks so nothing is re-planned (Section 3), and the genuinely-new gaps folded into
17 build tracks GA-1…GA-18 (Section 4). Mirrored a summary into `V3_ROADMAP.md`
Section G. Key finding: NavBharatAI is genuinely strong where it counts (real
execution, 27-agent orchestration, memory+lessons, static security/architecture/
compliance analysis, auto-repair, real git + multi-DB + real deploy); the absent
40% is mostly advanced testing/sim, IaC, deep perf profiling, deploy strategies,
and the frontier — and most of THAT was already on existing roadmaps. Docs only —
no GA code yet. PowerShell/CMD/native-ZSH marked intentionally out of scope (cloud
Linux by design).

Follow-up (same day): admin asked whether Windows support would expand reach.
Clarified honestly that a build-engine SHELL (PowerShell/CMD) does not — every user
reaches NavBharatAI via a browser regardless of their own OS. The real reach lever
is app OUTPUT targets (today: web only). Added `V3_ROADMAP.md` Section H "Universal
App Targets": UT-1 Desktop (Electron/Tauri → .exe/.dmg/.AppImage), UT-2 Native
Mobile (React Native/Capacitor/Flutter → Play/App Store), UT-3 Browser Extension.
Admin reviewed and DROPPED PowerShell/CMD (no reach gain); kept out-of-scope in the
audit. Roadmap only — no UT code yet.

---

### 2026-06-23/24 — v3.0 Quality Engine: evaluate 8→18 dimensions + full-suite readiness gate + integration net

Big push on NavBharatAI Pro v3.0 (`src/server/AgentV3/`, flag-OFF, zero live-path
imports → live app unaffected). Roadmap march: 48-capability phases + the admin's
300+ point "Section I" list (audit-first triage: ignore solid / complete partial /
build absent). Every change shipped real, tested, one PR at a time, CI-green-then-merge.

**Phases completed & merged (green CI):** 6.1 test-coverage, 10.1 requirement-coverage,
6.2 recurring-error (thrash) detection, 4.2 README generator, 4.3 .env.example
generator, 6.3 runnability, then the readiness gate now spans the FULL evaluate suite.

**Section I items built (ABSENT → solid), merged green:** #19 SEO/metadata, #22 project
hygiene, #5 error-boundary, #4 security-config (TLS/CORS), #22 .gitignore generator,
#4 insecure-randomness, #4 secret-leak (.env), #11 hardcoded-URL.

**`evaluate` now runs 18 dimensions** (was 8): readiness, build-confidence,
architecture, security, authenticity, dependencies, env-vars, accessibility,
compliance, test-coverage, requirement-coverage, runnability, SEO, project-hygiene,
error-boundary, security-config, secret-leak, hardcoded-URL. The **readiness gate**
now hard-blocks on: fake/incomplete code, serious privacy/compliance violation,
secret leak, can't-run, high-severity security misconfig. 3 generators wired as real
tools: generate_readme / generate_env_example / generate_gitignore.

**Tests 1884 → 2025** (+141), including a complete end-to-end integration suite that
drives `evaluate` + all 3 generators through the real ToolDispatcher + WorkspaceMemory
+ a fake actuator — a full regression net for every dimension.

**CI INFRA NOTE (2026-06-23 ~22:24 onward):** GitHub Actions began failing at job
startup (~3s, zero logs, HTTP 404 on logs) = the documented **Actions spending-limit/
quota exhaustion**. Everything merged BEFORE that was green. After it, PR #289 (outage
batch: leftover-debugger detection, fake-code-blocks-readiness, logged-secret
detection, compliance-blocks-readiness, + the integration test suite) is pushed and
fully LOCALLY verified (tsc ×2 + 2025 vitest + build + boot:check) but its MERGE is
queued until the admin raises the Actions spending limit / the quota resets. No red
CI was merged. Held off the (otherwise-ready) single-pass evaluate I/O refactor until
CI is back — too risky to land a critical-path refactor without the independent gate.

---

### 2026-06-24 — Section I #13: unpinned-dependency-version rule (reproducibility)

CI restored (the Actions block was the documented spending-limit/quota exhaustion;
admin cleared past-due + the repo was temporarily made public so Actions runs on
unlimited free minutes — to be reverted to private once the batch is merged). PR #289
batch is now actually running CI (runner allocated, no more 3-sec instant-fail).

Continuing the Section I march. New item built real + tested + green:

**Section I #13 — `DependencyAnalysis` unpinned-version rule.** A third rule on the
existing dependency dimension: a `dependencies`/`devDependencies` entry pinned to a
floating version (`*` / `latest` / `x` / empty) is flagged **medium** — the build is
non-reproducible, so a transitive breaking change silently breaks a build that worked
yesterday. This is the classic "worked on my machine, broke on reinstall" trap and a
pattern AI-generated package.json files fall into (LLMs emit `"latest"`), so it directly
serves the one absolute rule (the app must never break). High-precision by design:
- Scans only runtime + build deps; `peerDependencies`/`optionalDependencies` are skipped
  (a `*` peer range is normal and intentional).
- Special protocols (`workspace:*`, `file:..`, git/url refs, `npm:pkg@*`) and
  partially-locked ranges (`1.x`, `^1.2`, `~1.2`, exact pins) are NOT flagged.
- Case-insensitive match against a tight allow-list (`*`,`latest`,`x`,``).

Folds into the existing dependency dimension (no new evaluate wiring), surfaces via
`dependencySummary`. `DependencySeverity` gained `'medium'`; summary ordering updated.
AppKnowledgeBase dependency-check description synced. systemPrompt unchanged (it does
not enumerate dependency sub-checks). v3.0-only, flag-OFF — live app unaffected.

Gate green: server tsc 0, frontend tsc 0, **2031 vitest** (+6), boot:check PASS.
Pushed to the feature branch to ride the next CI with the #289 batch.

---

### 2026-06-24 — Section I #11 v2: hardcoded server-port check (deployment readiness)

Continuing the Section I march (CI now live on the public repo; #289 batch + the
unpinned-deps commit are riding CI). New item built real + tested + green:

**Section I #11 v2 — `PortBindingAnalysis` (new evaluate dimension, 19th).** A PURE,
deterministic scanner that flags a server bound to a hardcoded literal port
(`app.listen(3000)`) instead of `process.env.PORT`. Every managed host — Cloud Run,
Heroku, Render, Railway, Fly — assigns the port via the PORT env var and routes
traffic only to it; a hardcoded port means the container boots but the platform can
never reach it (the "deploys-but-silent" production failure). Directly serves the one
absolute rule (the app must never break) for the apps v3.0 ships.

High-precision by design (mirrors the hardcoded-URL precedent exactly):
- Line-level: a `.listen(<2–5 digit literal>)` with no env reference on the line.
- Skips the correct `process.env.PORT || 3000` / `import.meta.env` fallback, comments,
  and variable / no-arg listens. No `addEventListener` confusion (requires `.listen(`).

Wired end-to-end into `evaluate`: new `collectPortBindingIssues` collector (CODE/SKIP
filters like the URL collector), appended to the verdict, and a **medium readiness
warning** in the `extra` gate (a hardcoded port lowers the score, does not hard-block).
systemPrompt + AppKnowledgeBase synced (new HARDCODED PORT entry). v3.0-only, flag-OFF.

Tests: new `PortBindingAnalysis.test.ts` (11) + 2 dispatcher integration cases
(flags a literal listen; passes with process.env.PORT) — dispatcher suite 38→40.

Gate green: server tsc 0, frontend tsc 0, **2044 vitest** (+13 across both items this
session), boot:check PASS. Pushed to ride the next CI with the rest of the batch.

---

### 2026-06-24 — DEPLOY: #289 v3.0 batch merged to main + Section I #9 v2 (empty-catch)

**Deploy landed.** The #289 v3.0 quality-engine batch (debugger/fake-blocks/logged-
secret/compliance-blocks readiness + single-pass refactor + Section I #13 unpinned-deps
+ Section I #11 v2 hardcoded-port + the full dispatcher integration suite) went GREEN on
the exact head SHA (31688257…, run 28070796432 success) and was squash-merged to main
(0752865) → Cloud Build auto-deploy triggered. CI block earlier was the documented
Actions spending-limit exhaustion; admin cleared billing and (temporarily) made the repo
public so Actions runs on unlimited free minutes — TO BE REVERTED to private once stable.

**Cross-session sync (safeguard #1):** while this branch was in flight, a parallel session
merged PR #290 (professionals batch — Parenting/Cyber-Safety/Insurance/Chef/Travel) to
main. The #289 squash merged cleanly on top. The feature branch was then re-based onto the
new main (0752865) so it carries BOTH #290 and #289 — nothing lost, clean base for the next
item.

**Section I #9 v2 — empty-catch detection (this commit).** Added an `empty-catch` rule
(low) to `AuthenticityAnalysis`: a `catch {}` / `catch (e) {}` / multiline-whitespace-only
catch silently swallows the error — the app looks like it works while a real failure is
hidden. High-precision multiline scan; a comment in the body (documented intentional
ignore) or any real handling is NOT flagged. Folds into the existing authenticity
dimension; low severity (reports without hard-blocking readiness). AppKnowledgeBase synced;
systemPrompt unchanged (it does not enumerate authenticity sub-checks).

Tests: +4 in `AuthenticityAnalysis.test.ts`. Gate green: server+frontend tsc 0, 2047
vitest, boot:check PASS.

---

### 2026-06-24 — Section I #22 v2: .gitignore node_modules coverage (hygiene)

Continuing the autonomous Section I march (each item: real → tested → gate-green →
branch → PR → CI-green → squash-merge → deploy). New item:

**Section I #22 v2 — `ProjectHygieneAnalysis` node_modules coverage.** The hygiene
dimension previously only checked that a `.gitignore` EXISTS. Gap: a `.gitignore` that
exists but forgot `node_modules` passes the presence check yet still commits
node_modules (huge, platform-specific binaries, broken cross-platform installs). Now a
`.gitignore` that exists but does not actually ignore node_modules is flagged medium.
Tolerant of the common forms (`node_modules`, `node_modules/`, `/node_modules`,
`**/node_modules`); a sub-path entry (`node_modules/.cache`) does NOT count as covering
the whole directory. Backward-compatible: the new check only runs when the .gitignore
body is passed (optional 3rd param), so existing 2-arg callers/tests are unaffected.

Wiring: the dispatcher now reads `.gitignore` ONCE and shares the body between
project-hygiene (node_modules coverage) and the secret-leak pass (.env coverage) — DRY,
one fewer actuator read. AppKnowledgeBase hygiene entry synced; systemPrompt unchanged
(no hygiene sub-check enumeration). v3.0-only, flag-OFF.

Tests: +6 unit (`ProjectHygieneAnalysis.test.ts`) + 1 dispatcher integration (40→41).
Gate green: server+frontend tsc 0, **2053 vitest** (+6), boot:check PASS.

---

### 2026-06-24 — Section I #4 v5: connection-string credential leak (security)

Continuing the autonomous Section I march. New item:

**Section I #4 v5 — `SecurityAnalysis` connection-string-credentials rule (high).** A
DB/queue connection-string URI with embedded credentials — `mongodb://user:pass@host`,
`postgres://…`, `mysql://…`, `mariadb://…`, `redis(s)://…`, `amqp(s)://…` — is a real
secret leak that the existing assignment-based `hardcoded-secret` rule misses entirely
(a URI has no `password =` keyword). Now flagged high.

High-precision by design:
- Requires the `scheme://[user]:password@` shape with a 3+ char password.
- Only the known DB/queue schemes — ordinary `https://` URLs and credential-less
  connection strings (`mongodb://localhost:27017/db`) are NOT flagged.
- Reuses the module's existing PLACEHOLDER guard, so env-interpolated
  (`mongodb://admin:${process.env.DB_PASS}@host`) and placeholder (`<password>`,
  `your-…`) forms are suppressed.

Folds into the existing security evaluate dimension (high security findings already feed
the readiness gate, so a committed DB credential blocks "READY"). AppKnowledgeBase
security list synced; systemPrompt unchanged (it does not enumerate SecurityAnalysis
secret rules). v3.0-only, flag-OFF.

Tests: +2 unit (`SecurityAnalysis.test.ts`, 6→8) + 1 dispatcher integration (41→42).
Gate green: server+frontend tsc 0, **2056 vitest** (+3), boot:check PASS.

---

### 2026-06-24 — Section I #4 v6: command-injection detection (security)

Continuing the autonomous Section I march. New item:

**Section I #4 v6 — `SecurityAnalysis` command-injection rule (high).** A child_process
shell sink — `exec` / `execFile` / `spawn` (sync or async) — whose command is built from
a template interpolation (`` `…${x}` ``) or a string concatenation (`"…" + x`) is the
classic remote-code-execution vector. Now flagged high.

High-precision by design:
- A negative lookbehind `(?<![.\w])` excludes member calls — `regex.exec(…)`,
  `cp.exec(…)`, `pattern.exec("a"+b)` — so RegExp.exec and other libraries are NOT
  false-positives. Documented trade-off: the `cp.exec` member form is therefore not
  matched; the imported `exec(…)` form (what generated code typically uses) IS.
- Only fires when the argument is dynamically built; a constant command
  (`execSync("ls -la")`) or a pre-built variable (`exec(cmd)`) is not flagged.

Folds into the existing security dimension (high security findings already gate
readiness, so command injection blocks "READY"). AppKnowledgeBase security list synced;
systemPrompt unchanged. v3.0-only, flag-OFF.

Tests: +2 unit (`SecurityAnalysis.test.ts`, 8→10) + 1 dispatcher integration (42→43).
Gate green: server+frontend tsc 0, **2059 vitest** (+3), boot:check PASS.

---

### 2026-06-24 — Section I #5 v2: Vite client-env exposure check (20th dimension)

Continuing the autonomous Section I march. New item:

**Section I #5 v2 — `ViteEnvAnalysis` (new evaluate dimension, 20th).** A PURE,
deterministic scanner that flags a non-VITE_-prefixed `import.meta.env.X` reference. In a
Vite app, ONLY `VITE_*` vars (plus the builtins MODE/DEV/PROD/BASE_URL/SSR) are exposed
to client code via `import.meta.env`; reading `import.meta.env.API_KEY` yields `undefined`
in the browser at runtime — a silent "compiles but breaks" footgun AI-generated frontends
hit constantly. Now flagged with the VITE_ rename hint.

High-precision by design:
- Only uppercase-snake `import.meta.env.NAME` / bracket-form refs; `process.env` (server)
  is ignored; comments skipped.
- The dispatcher SKIPS the whole check when the project's `vite.config.{ts,js,mjs}`
  customises `envPrefix` (then a different prefix may be valid and we cannot be sure) —
  guarded by `hasCustomEnvPrefix`.

Wired end-to-end into `evaluate`: new `collectViteEnvIssues` collector + a best-effort
vite.config read, appended to the verdict, and a **medium readiness warning**. systemPrompt
+ AppKnowledgeBase synced. v3.0-only, flag-OFF.

Tests: new `ViteEnvAnalysis.test.ts` (9) + 2 dispatcher integration cases (flags a
non-VITE_ ref; skips when envPrefix is customised) — dispatcher suite 43→45.

Gate green: server+frontend tsc 0, **2070 vitest** (+11), boot:check PASS.

---

### 2026-06-24 — Section I #4 v7: real secrets in committed env templates (security)

Continuing the autonomous Section I march. New item:

**Section I #4 v7 — `EnvSecretValueAnalysis`.** A `.env.example`/`.sample`/`.template`
is COMMITTED and must contain placeholders only; a real key left inside one (a common
copy-paste slip) is a permanent git-history leak. The source-code secret scan misses this
— it matches quoted assignments in code, not `KEY=sk-realkey` env-file lines. The new PURE
scanner flags template VALUES that match a distinctive real-secret format: OpenAI/Anthropic
`sk-…`, Stripe `[rs]k_live_…`, AWS `AKIA…`, GitHub `gh[posru]_…`, xAI `xai-…`, Google
`AIza…`, Slack `xox[baprs]-…`, and JWTs.

High-precision by design:
- The value must match a real key shape AND not be a placeholder (the `your-…` / `<…>` /
  `xxx` / `example` / `changeme` / `redacted` / `...` guard). Note: AWS's documented EXAMPLE
  key (AKIAIOSFODNN7EXAMPLE) is correctly treated as a placeholder (it contains "EXAMPLE").
- Only scans env-TEMPLATE files; a real secret-bearing `.env` is handled separately by the
  secret-leak (not-gitignored) check, and code files by SecurityAnalysis.

Wired into `evaluate`: best-effort read of the three template names, scanned and appended to
the verdict, with a HIGH readiness blocker (a committed live secret must force NOT READY).
systemPrompt + AppKnowledgeBase synced. v3.0-only, flag-OFF.

Tests: new `EnvSecretValueAnalysis.test.ts` (7) + 2 dispatcher integration cases (45→47).
Gate green: server+frontend tsc 0, **2079 vitest** (+9), boot:check PASS.

---

### 2026-06-24 — Section I #4 v8: hardcoded JWT signing secret (security)

Continuing the autonomous Section I march. New item:

**Section I #4 v8 — `SecurityAnalysis` hardcoded-jwt-secret rule (high).** A call like
`jwt.sign(payload, 'my-secret')` bakes the signing key into the source — anyone with the
code can forge valid tokens (full auth bypass). The assignment-based `hardcoded-secret`
rule misses this because it's a function-argument literal, not a `secret = "..."`
assignment. Now flagged high.

High-precision by design:
- `\b(?:jwt|jsonwebtoken)\.sign\s*\(.*?,\s*(['"`])[^'"`]{4,}\1\s*[,)]` — the `.*?,` skips
  the payload (an object or variable, possibly containing commas) so the secret argument
  is matched whether or not an options object follows it.
- A variable/env secret (`jwt.sign(p, process.env.JWT_SECRET)`), the options string
  (`{ algorithm: 'HS256' }` — not preceded by `,`), and placeholder values
  (`'your-secret-here'`, via the module's PLACEHOLDER guard) are NOT flagged.

Folds into the existing security dimension (high security findings already gate readiness,
so a hardcoded JWT secret blocks "READY"). AppKnowledgeBase security list synced.
v3.0-only, flag-OFF.

Tests: +2 unit (`SecurityAnalysis.test.ts`, 10→12) + 1 dispatcher integration (47→48).
Gate green: server+frontend tsc 0, **2082 vitest** (+3), boot:check PASS.

---

### 2026-06-24 — Section I #6 v2: await-in-forEach correctness check (21st dimension)

Continuing the autonomous Section I march (varying from the security run into a correctness
check). New item:

**Section I #6 v2 — `AsyncPatternAnalysis` (new evaluate dimension, 21st).** A PURE,
deterministic scanner that flags `array.forEach(async (x) => { await … })`. This is a classic
JS footgun: forEach ignores the promise each callback returns, so the loop does NOT await the
iterations (they race), and any rejection becomes an unhandled, silently-swallowed promise
rejection. The code compiles and looks correct but breaks at runtime — directly against "the
app must never break". Flagged with the fix (for...of + await, or await Promise.all(map)).

High-precision by design:
- A single-line `.forEach(\s*async\b` signature (arrow or function form); comments and
  non-code files skipped.
- `.map(async …)` inside `await Promise.all(...)` (the correct pattern) is NOT flagged, nor
  is a synchronous forEach or a for...of-with-await.

Wired end-to-end into `evaluate`: new `collectAsyncPatternIssues` collector, appended to the
verdict, + a medium readiness warning. systemPrompt + AppKnowledgeBase synced. v3.0-only,
flag-OFF.

Tests: new `AsyncPatternAnalysis.test.ts` (6) + 1 dispatcher integration (48→49).
Gate green: server+frontend tsc 0, **2089 vitest** (+7), boot:check PASS.

---

### 2026-06-24 — Multi-provider cost routing for v3.0: tool-use FOUNDATION (admin-directed)

Admin (aashishcpmt09) directed: v3.0 should use a synced Vertex→Gemini→Grok→Claude chain
where the agent gets each piece of work done by whichever provider can handle it, so the
expensive Claude is used as little as possible and NavBharatAI's real cost is minimised.
USER-FACING BILLING STAYS EXACTLY AS IT IS (`pricing.ts` Opus-equivalent × 2.5 untouched —
admin's explicit call: "user ke liye billing abhi jaise hai vaise hi rahne do"). So this is
a COST/margin change (which model actually runs), NOT a user-price change.

**Critical finding (surfaced before touching anything):** v3.0's build loop requires NATIVE
tool-use (the model must call write_file / evaluate / … as real tool calls). Only ClaudeClient
implements that. Every AIRouter provider (Grok/Gemini/Vertex) is TEXT-ONLY (`execute()→string`,
no function-calling), and v3.0's existing "multi-provider fallback" is a text-only degradation
that cannot build apps. So "use Free's routing in v3.0" is NOT a config flip — naively making a
cheap provider primary would make every build drop to text-mode and build nothing. It is real
engineering: native tool-use adapters per provider + cross-format transcript translation, with
Claude kept as the guaranteed backstop so a build never breaks.

**Built this session (phase 1+2, REAL + fully unit-tested, OFF the default path so the live,
billed path is unchanged — Claude stays primary in routes/agentv3.ts):**
- `AgentV3/providers/OpenAiToolAdapter.ts` (PURE, no SDK/network): the intricate, breakage-prone
  translation core — `toolDefsToOpenAI`, `transcriptToOpenAI` (maps Anthropic text/tool_use/
  tool_result blocks ↔ OpenAI messages + tool_calls + tool role), `mapFinishReason`,
  `parseOpenAiCompletion` (OpenAI reply → Anthropic-shaped TurnResult; rawContent stays
  Anthropic-shaped so Claude and a cheap provider can interleave turn-by-turn in one build).
- `AgentV3/providers/OpenAiToolRunner.ts`: a `TurnRunner` (same contract as ClaudeClient) over an
  injectable OpenAI-compatible client (Grok/xAI native function-calling). Errors propagate so a
  future orchestrator can fall through to the next provider.

19 new tests (14 adapter + 5 runner), all via injected mocks (no live key needed). Strangler-fig
isolation preserved (imports only ClaudeClient TYPES; no live-router coupling).

**NEXT phases (not yet built):** (3) a multi-provider orchestrator `TurnRunner` that tries
Vertex→Gemini→Grok and uses Claude as the guaranteed backstop (build never breaks); (4) Gemini/
Vertex native tool-use adapters (Google functionDeclarations); (5) LIVE verification with real
provider keys + a real sandbox build before any default-path rollout (per "preview is EARNED" —
the adapters are protocol-correct and unit-proven, but real cheap-provider build quality must be
measured live before it becomes default). No live behaviour changed yet.

Gate green: server+frontend tsc 0, **2108 vitest** (+19), boot:check PASS.

---

### 2026-06-24 — Multi-provider cost routing: ORCHESTRATOR (phase 3) — architecture complete

Continued the admin-directed cost-routing build. Phase 3 keystone shipped:

**`AgentV3/providers/MultiProviderTurnRunner.ts` (PURE).** `makeMultiProviderTurnRunner(chain)`
wraps an ORDERED chain of TurnRunners (intended order Vertex→Gemini→Grok→Claude) and returns
the first that succeeds; on a thrown provider error it falls through to the next, with the LAST
runner as a GUARANTEED backstop (Claude). This is the inverse of the existing
makeResilientTurnRunner (Claude-primary → text fallback): here the CHEAP providers go first and
Claude only catches hard failures — so v3.0 runs each turn on the cheapest provider that works,
NavBharatAI's real Claude cost drops to a minimum, and the build never breaks.

Design decisions:
- Selection is by ERROR only (a thrown provider error → try the next). Quality-based fallback
  (a cheap model returns a valid-but-poor turn) is intentionally NOT done here — it needs live
  measurement and would risk false fallbacks; the agent loop's own validation + the Claude
  backstop cover hard failures.
- `onProviderUsed(used, fellBackFrom)` / `onProviderError(name, err)` hooks for cost telemetry
  (how often the cheap chain carried the turn vs. how often Claude was needed) and diagnostics.
- Throws an aggregated error ONLY if every provider including the backstop fails.

Injected runners → 5 unit tests, no key needed. Still OFF the default path (Claude stays primary
in routes/agentv3.ts; live billed path unchanged; pricing.ts untouched).

**v3.0 multi-provider architecture is now COMPLETE + unit-tested** (adapter + Grok runner +
orchestrator). What remains before it can go LIVE and actually cut cost:
1. Gemini/Vertex native tool-use adapters (Google functionDeclarations) — so the cheap chain has
   more than just Grok.
2. LIVE verification (ops/admin): set real GROK_API_KEY (+ Gemini/Vertex), run a real sandbox
   build through the orchestrator, and MEASURE (a) cheap-provider build quality and (b) the
   Claude-fallback rate. Only after that proves out should the orchestrator be wired as the
   v3.0 default in routes/agentv3.ts. Per "preview is EARNED" — the protocol is unit-proven, but
   real cheap-provider build quality cannot be claimed without a live run.

Gate green: server+frontend tsc 0, **2113 vitest** (+5), boot:check PASS.

---

### 2026-06-24 — Section I #4 v9: new Function() dynamic-code detection (security)

Resumed the Section I march after the cost-routing task. New item:

**Section I #4 v9 — `SecurityAnalysis` dynamic-function rule (medium).** `new Function('…')`
builds executable code from a string at runtime — eval()'s twin, a code-injection vector — but
the existing eval-usage rule only matched `eval(`. Now flagged medium. High-precision:
`\bnew\s+Function\b\s*\(` so a React `new FunctionComponent(...)` or any class whose name merely
starts with "Function" is NOT flagged. Folds into the existing security dimension.
AppKnowledgeBase security list synced. v3.0-only, flag-OFF.

Tests: +1 unit (`SecurityAnalysis.test.ts`) + 1 dispatcher integration. Gate green:
server+frontend tsc 0, **2115 vitest** (+2), boot:check PASS.

---

### 2026-06-24 — Multi-Model Orchestration: Phase 1 — Gemini/Vertex tool-use runner + full ladder

Admin locked the cost ladder: Gemini/Vertex(1) → Haiku(2) → Sonnet(3) → Opus 4.7(4); POWER =
Opus 4.8 only. Agreed core mechanism: cheap-first, the existing 22-dim evaluate engine is the
objective gate, escalate +1 tier only on failure (so a Gemini-built calculator that passes the
gate ships cheap; a complex app fails fast and climbs to Claude). Full plan persisted to
NAVBHARATAI_PRO_V3_DESIGN.md §11. Billing change (P5) is gated on explicit admin sign-off;
everything else is off-default and billing-neutral.

**Phase 1 built (REAL + tested, OFF the default path):**
- `providers/GeminiToolAdapter.ts` (PURE): Anthropic⇄Gemini (`@google/genai`) translation —
  `toolDefsToGemini` + `sanitizeGeminiSchema` (strips JSON-Schema keys Gemini rejects),
  `transcriptToGemini` (text/tool_use/tool_result → contents/functionCall/functionResponse,
  resolving tool_use_id→name since Gemini matches results by NAME, not id), `parseGeminiResponse`
  (synthesizes gemcall_<i> ids; rawContent stays Anthropic-shaped so providers interleave).
- `providers/GeminiToolRunner.ts`: a TurnRunner over an injectable @google/genai client; errors
  propagate for the orchestrator. Works for Gemini direct and (same content/tool shape) Vertex.
- `models.ts`: full ladder ids — `haikuModel()` (claude-haiku-4-5), `opusNormalModel()` (4.7,
  normal ceiling), `opusModel()` (4.8, power), `ladderModel(tier)`; all env-overridable.

Strangler-fig isolation preserved (imports only ClaudeClient types). 21 new tests (12 adapter +
5 runner + 4 models). Now ALL cheap tiers (Gemini/Vertex + Grok) have native tool-use runners,
and every Claude tier is addressable. Next: P2 analyser/router.

Gate green: server+frontend tsc 0, **2134 vitest** (+21), boot:check PASS.

---

### 2026-06-24 — Multi-Model Orchestration: Phase 2 — Request Analyser (the router brain)

**Phase 2 built (REAL + tested, OFF default, billing-neutral):** `AgentV3/RequestAnalyser.ts`
(PURE) — `analyzeRequest({prompt, historyTurns?, fileCount?, hasImages?})` returns
`{complexityScore 0-100, taskType, startTier, escalationPath, ambiguous, reasoning}`.

Deterministic, hybrid by design: the deterministic core handles the clean ~90% (fast, free,
debuggable); it flags borderline scores `ambiguous:true` so a caller MAY refine with a cheap
LLM later (deterministic verdict is always a safe default). Scoring:
- task-type via keyword signals → base score; +adjustments for code present, long prompt,
  large project (file count), production/security/perf signals, long conversation.
- Score → tier: 0-20 Gemini, 21-40 Haiku, 41-70 Sonnet, 71-100 Opus. escalationPath = startTier…opus.
- **Bias cheap (the goal):** simple_app (calculator/clock/ludo/3D-ball/todo/dice/quiz/…) is
  CAPPED ≤20 → Gemini even with extra words — so a new user's calculator routes to the cheapest
  tier; the evaluate-gate (P3) is the safety net that escalates only on objective failure.
  Small coding → Haiku, full/complex apps (saas/auth/db/payment) → Sonnet, architecture → Opus.

13 tests (chat/translate/simple-app/coding/complex/architecture + adjustments + escalation path
+ ambiguity + safe empty-input handling).

**Also (admin Q this turn):** Power-mode effort selector — when POWER is ticked, a 5x/10x/20x
selector near the chat input maps to Opus 4.8 effort mini/medium/max (effort = thinking budget →
higher effort = genuinely higher cost → honest multipliers). Confirmed feasible; folded into the
plan as a P4 enhancement (design doc §11.1). The 10x/20x are NEW billing multipliers → gated on
explicit admin sign-off (with P5). Not built yet.

Next: P3 — evaluate-gated escalation orchestrator (start at analyser tier → build → 22-dim
evaluate-gate → deliver or escalate +1, budget-capped). Gate green: server+frontend tsc 0,
**2147 vitest** (+13), boot:check PASS.

---

### 2026-06-24 — Multi-Model Orchestration: Phase 3 — evaluate-gated escalation orchestrator

**Phase 3 built (REAL + tested, OFF default, billing-neutral):** `AgentV3/EscalationOrchestrator.ts`
(PURE policy) — `runWithEscalation(path, deps, opts)`. The keystone of "cheap-first, escalate only
on objective failure":
- builds on the cheapest tier (deps.buildOnTier), runs the OBJECTIVE gate (deps.gate = the 22-dim
  evaluate engine in production); gate PASS → deliver (cheap win); gate FAIL or a thrown build
  error → escalate +1 tier and rebuild.
- The LAST tier (Opus) is the ceiling BACKSTOP: even if its gate does not pass, its build is
  delivered best-effort (gatePassed:false) — the build never "breaks".
- Budget cap via `maxTiers`; a gate that THROWS is non-fatal (never blocks delivery — the build
  itself succeeded). onAttempt/onEscalate telemetry hooks (cost data: how often cheap carried it
  vs. how far it escalated).
- build + gate are INJECTED → policy fully unit-tested (7 tests: cheap-pass, escalate-then-pass,
  build-throw→escalate, all-fail→Opus-backstop, maxTiers cap, gate-crash resilience, empty-path /
  last-tier-throw errors) without any live model/sandbox/key.

Wiring to the real AgentRunner build loop + evaluate tool is P8 (behind the rollout flag). The
analyser (P2) supplies the path; this consumes it. Now P0-P3 give the full off-default pipeline:
analyse → pick start tier → build on tier runner → evaluate-gate → escalate/deliver, Claude backstop.

**Billing (P5):** admin supplied the spec this session — Normal mode: assume-Sonnet, bill
Sonnet-equivalent × 2 (× 5 if escalated to Opus); Power mode: real Opus 4.8 cost × 5 (any effort).
Awaiting a final 2-point confirm (normal-Opus base = Sonnet-equiv; Power base = real-Opus) before
editing pricing.ts. Not built yet.

Next: P4 (Power mode + effort selector, billing-gated) or P5 (billing, on confirm). Gate green:
server+frontend tsc 0, **2154 vitest** (+7), boot:check PASS.

---

### 2026-06-24 — Section I #4 v10: vanilla-DOM XSS sinks (security)

Resumed the Section I march (orchestration architecture done; money-phases await admin billing
confirm). New item: `SecurityAnalysis` `unsafe-html-sink` rule (medium). Assigning to
`innerHTML`/`outerHTML`, or calling `insertAdjacentHTML`, injects raw HTML → XSS — but the
existing `dangerous-html` rule only caught React's `dangerouslySetInnerHTML`. Now the vanilla-DOM
sinks are flagged too. High-precision: `=(?!=)` excludes ==/=== comparisons; empty-string clears
(`el.innerHTML = ''`) and reads (`const h = el.innerHTML`) are ignored. Folds into the existing
security dimension. AppKnowledgeBase synced. v3.0-only, flag-OFF.

Tests: +1 unit + 1 dispatcher integration. Gate green: server+frontend tsc 0, **2157 vitest**
(+2), boot:check PASS.

---

### 2026-06-24 — Multi-Model Orchestration: P5-core — billing reshaped to the admin model

Admin locked + authorized the billing change (constitution-locked area, explicit sign-off this
session). `pricing.ts` reshaped to the new model (this CHANGES live v3.0 billing):
- NORMAL_MULTIPLIER = 3.5, POWER_MULTIPLIER = 2.5.
- sonnetRate() / sonnetEquivalentUsd() added (the normal-mode base = assume-Sonnet).
- billedAmountUsd(usage, powerMode) = powerMode ? opusEquivalentUsd × 2.5 : sonnetEquivalentUsd × 3.5.
- billedAmountInr(usage, powerMode, usdInrRate) = billedAmountUsd × rate (pure; rate injected).
The existing `onlyOpus` toggle (req.body.onlyOpus → resolveModel → AgentRunner → recorded
billedUsd) IS the power-mode flag — verified wired, so the new math applies correctly: normal
builds bill Sonnet-equiv × 3.5 (Sonnet rate ≪ Opus → much cheaper than the old Opus-equiv × 2.5),
power builds bill real Opus × 2.5. Margin positive both modes. index.ts exports updated
(STANDARD_/ONLY_OPUS_MULTIPLIER → NORMAL_/POWER_MULTIPLIER + sonnet helpers); the stale D5/D6
pricing block removed from ClaudeClient.test.ts (now covered by pricing.test.ts, 11 tests).

NEXT P5-inr: a UsdInrRate module (env default USD_INR_RATE + best-effort real-time refresh with
fallback, never throws in the billing path) + wire billedAmountInr to the customer-facing ₹
display. Then P4 (Power effort UI). Gate green: server tsc 0, **2165 vitest**, boot:check PASS.

---

### 2026-06-24 — Multi-Model Orchestration: P5-inr — real-time USD→INR + customer ₹

`src/server/lib/UsdInrRate.ts` — a cached USD→INR rate for customer billing. `usdInrRate()` is
synchronous and NEVER throws/blocks (the billing path must never break on FX). Best-effort hourly
refresh from a free no-key FX source (open.er-api.com); on any failure keeps the last good value;
fallback = env `USD_INR_RATE` or 85. Auto-refresh is skipped under tests (no network in CI).
Helpers: `usdToInr`, `setUsdInrRate`, `refreshUsdInrRate(fetchJson)` (injectable for tests).

The agentv3 route now computes `billedInr = round(result.billedUsd × usdInrRate(), 2)` and adds it
to the `result` message — the customer-facing amount in ₹. Internal accounting still records
`billedUsd` (USD, currency-stable, no data migration). Strangler-fig isolation kept (the INR
conversion is at the route/composition-root, not inside the AgentV3 module). 5 tests.

So the full billing is now live: NORMAL = Sonnet-equiv × 3.5, POWER = real Opus × 2.5, shown to the
customer in ₹ at the real-time rate. NEXT: frontend ₹ display + P4 (Power effort UI: 5x/mini,
10x?/medium, 20x?/max — actually flat 2.5× per admin, effort = thinking depth). Gate green:
server+frontend tsc 0, **2170 vitest** (+5), boot:check PASS.

---

### 2026-06-24 — CRITICAL: main build was broken (Languages2) + frontend ₹ display + CI hardening

**Critical find while building the frontend ₹ display:** `main`'s production build was BROKEN since
PR #336 — `ProfessionalsView.tsx` imported `Languages2` from lucide-react, which it does not export.
CI never ran `npm run build` (only tsc + vitest + boot), and tsc passed (lucide's types are permissive),
so it slipped to main. **Cloud Build runs `npm run build`**, so every merge since #336 (incl. the new
billing P5-core/P5-inr) would have FAILED to deploy — the live site was stuck on the pre-#336 build.

Fixes in this PR:
1. **Build unblocked:** `Languages2` → `Languages` (valid icon; translate_ai now shares the Languages
   icon). `npm run build` now passes (✓ built). This lets ALL the recent merges actually deploy.
2. **CI hardening:** added a `npm run build` step to `.github/workflows/ci.yml` — so a build-only break
   (that tsc + vitest miss) can never reach main again.
3. **Frontend ₹ display (P5-inr finish):** the v3.0 panel now shows the customer bill in **₹**
   (billedInr) instead of $ — agentV3Types result event + state gained `billedInr`, the reducer copies
   it, AgentV3Panel renders `₹{billedInr}` (falls back to $ if INR absent). Reducer test covers it.

Gate green: server+frontend tsc 0, **2170 vitest**, **npm run build PASS**, boot:check PASS.

---

### 2026-06-24 — Section I #4 v11: SQL-injection detection (security)

Resumed the autonomous Section I march. New item: `SecurityAnalysis` `sql-injection` rule
(high). A SQL statement built by interpolating (`` `SELECT … ${x}` ``) or concatenating
(`"SELECT … " + x`) a value straight into the query string is the classic SQL-injection
vector — and nothing in the evaluate engine caught it before (command-injection covers shell
sinks; SecurityConfigAnalysis covers TLS/CORS/randomness; none cover SQL). High-precision: the
string must actually START with a SQL verb (SELECT/INSERT/UPDATE/DELETE) AND contain a template
`${…}` or be concatenated with a non-literal — so parameterised queries
(`query('… WHERE id = ?', [id])`), static queries, and literal+literal joins are NOT flagged.
Redundant-work check (safeguard #6) first caught an almost-added duplicate TLS rule — reverted
it (SecurityConfigAnalysis already has `tls-verification-disabled`) and built the genuinely-new
SQL rule instead. Folds into the existing security dimension. AppKnowledgeBase synced. v3.0-only,
flag-OFF.

Tests: +1 unit (interpolation/concat flagged; parameterised/static/literal-join safe) + 1
dispatcher integration. Gate green: server+frontend tsc 0, **2172 vitest** (+2), build PASS,
boot:check PASS.

---

### 2026-06-24 — Section I #4 v12: hardcoded Authorization Bearer/Basic header (security)

Continuing the autonomous Section I march. New item: `SecurityAnalysis` `hardcoded-auth-header`
rule (high). An `Authorization` header set to a literal `Bearer <token>` / `Basic <creds>` is a
committed API/access credential — but the assignment-based `hardcoded-secret` rule misses it (its
key-set has no "Authorization", and the value form is a header, not a `key = '…'` assignment).
High-precision: requires the literal to actually start with `Bearer`/`Basic` + 8+ chars; the
PLACEHOLDER ignore excludes the correct env form (`Bearer ${token}`) and obvious placeholders
(`Bearer YOUR_TOKEN_HERE`). An optional quote after the key name handles both `Authorization:`
and `"Authorization":` shapes. Folds into the existing security dimension. AppKnowledgeBase
synced. v3.0-only, flag-OFF.

Tests: +1 unit (Bearer/Basic literal flagged; env form + placeholder safe) + 1 dispatcher
integration. Gate green: server+frontend tsc 0, **2174 vitest** (+2), build PASS, boot:check PASS.

Also this session: §12 of NAVBHARATAI_PRO_V3_DESIGN.md — the mitrify.xyz app-hosting decision
(admin 2026-06-24): mitrify = preview+deploy by default, demoted to preview-only once the user
connects their own domain. DESIGN LOCKED but BUILD GATED — the E2B↔mitrify link mechanism is
unconfirmed, so no preview/deploy URL change ships until the admin verifies it (real format, never
a guess). Audited ground truth: cloudflare.ts already uses mitrify.xyz as the Cloudflare-SaaS zone;
no hostname→app serving layer exists yet; v3.0 preview still returns raw *.e2b.app.

---

### 2026-06-24 — mitrify.xyz: preview-on-mitrify IMPLEMENTED (v3.0-scoped, real)

Admin confirmed mitrify.xyz is an **E2B-native custom domain** (shows in E2B dashboard Domains
setting) and approved showing it for preview/deploy. Verified E2B SDK v2.30.0: `sandbox.getHost`
returns `{port}-{id}.${domain}` with domain defaulting to `E2B_DOMAIN||'e2b.app'`; reconfiguring the
SDK `domain` would ALSO rewrite `api.${domain}` and break sandbox creation — so the correct fix is a
user-facing host-suffix swap (E2B custom domains are additive aliases to the same sandbox).

Shipped (real, tested, isolated):
- `src/server/AgentV3/PreviewDomain.ts` — PURE `applyPreviewDomain(url, domain?)`: swaps a `*.e2b.app`
  host → `*.mitrify.xyz` (override `E2B_PREVIEW_DOMAIN`; `=e2b.app` disables). Idempotent; localhost /
  non-e2b / already-custom hosts untouched.
- Wired ONLY in `ToolDispatcher.update_preview` (v3.0 path) → the `preview` event now carries the
  mitrify URL. The live Engineer AI builder (`E2BActuator.getPortUrl`) is UNTOUCHED — zero blast
  radius on the existing production builder.
- AppKnowledgeBase: added the mitrify preview bullet AND corrected the now-stale billing line
  (was "Opus-equiv ×2.5 / ×5 Only-Opus" → real shipped model: Normal Sonnet-equiv ×3.5, Power real
  Opus ×2.5, shown in ₹ at real-time FX; also fixed the "5× cost" in howToUse).
- Design doc §12.1: preview implemented; durable DEPLOY half still pending (needs a persistent host
  + hostname→app serving layer + publish-target resolver — E2B sandboxes are ephemeral, honest state).

Tests: PreviewDomain.test.ts (6) + 1 dispatcher integration. Gate green: server+frontend tsc 0,
**2181 vitest** (+7), build PASS, boot:check PASS.

---

### 2026-06-24 — §12.2 v3.0 durable deploy + git (backend): workspace-files collector (reuse existing deploy stack)

Admin chose "Git + multi-platform deploy" for v3.0 durable deploy — reuse the EXISTING, real deploy
stack (verified live this session: `/api/pro/deploy` → ProDeploy Vercel/Netlify/Cloudflare/GitHub
Pages; `/api/github/push-enhanced` + GitHub OAuth; all registered in server.ts L413/423/436), NOT
rebuild it. AgentV3 was fully isolated from all of it (grep-confirmed zero refs), so the only new
backend needed is a way to hand v3.0's sandbox files to those routes.

Shipped (increment 1, backend):
- `src/server/AgentV3/WorkspaceFiles.ts` — PURE `collectWorkspaceFiles(actuator, workspaceId)` →
  `{ files: Record<path,content>, skipped }`, the EXACT shape `/api/pro/deploy` and
  `/api/github/push-enhanced` already accept. Security filtering mirrors the ZIP/GitHub paths:
  excludes node_modules / .git / dist / build / live `.env*` secrets (keeps `.env.example/.sample/
  .template`), skips binary (NUL) + oversized files, bounded by file count + total size. Best-effort:
  an unreadable file is skipped, never fatal.
- `POST /api/agentv3/workspace-files` — gated by isAgentV3Enabled; reads the sandbox via the shared
  actuator singleton; returns `{ files, count, skipped }`. Read-only; zero change to any live route.

NEXT (increment 2, frontend): a Deploy action in AgentV3Panel that fetches these files and reuses the
existing MultiCloudDeploy UI + `/api/pro/deploy` + `/api/github/push-enhanced` (GitHub OAuth) — git
push + 4-platform deploy, no new deploy backend. Tests: WorkspaceFiles.test.ts (5). Gate green:
server tsc 0, **2186 vitest** (+5), build PASS, boot:check PASS.

---

### 2026-06-24 — §12.2 v3.0 import side: writeWorkspaceFiles + import endpoint (full fetch→edit→deploy loop)

Admin expanded the scope: v3.0 must FETCH files from git (GitHub/Firebase/other), EDIT/UPDATE, and
DEPLOY/PUSH back — with ALL options available (not rigid to one). The export collector (prev entry)
plus this import side complete the round-trip backend, all reusing existing routes.

Shipped (increment 2, backend import side):
- `writeWorkspaceFiles(sink, workspaceId, files)` in WorkspaceFiles.ts — writes an imported project
  (e.g. from the existing `/api/github/fetch` route) into the sandbox. Path-safe: rejects absolute
  paths, `..` traversal and NUL; never imports node_modules/.git or live `.env` secrets (templates
  kept); same size/count caps. Best-effort — an unsafe path or write error is skipped, never fatal.
- `POST /api/agentv3/import-files` — gated; ensureWorkspace('import') best-effort (unknown type →
  empty sandbox so the repo lands cleanly) then writes. Returns `{ imported, skipped }`. No change to
  any live route — the frontend orchestrates fetch (existing) → import (new).

So the backend round-trip is ready: fetch (existing /api/github/fetch) → import (new) → edit (agent)
→ collect (new) → push/deploy (existing /api/github/push-enhanced + /api/pro/deploy). NEXT
(increment 3, frontend): expose ALL options in the v3.0 panel. Tests: WorkspaceFiles.test.ts now 9.
Gate green: server tsc 0, **2190 vitest** (+4), build PASS, boot:check PASS.

---

### 2026-06-24 — FIX: v3.0 "Load failed" on a plain "hi" (heavy build path + silent stream)

Admin reported (live screenshot) that sending "hi" in v3.0 on navbharatai.com shows a red
"Load failed". Diagnosis (grounded in code, not guessed):
- `useAgentV3Build.ts:160` surfaces a network-level fetch failure as its message → Safari's
  `TypeError: Load failed`. A clean 4xx/5xx is handled separately (shows the JSON error), so
  "Load failed" specifically means the streaming connection reset / idle-timed-out with no
  complete response.
- Root cause: the cheap-chat cost-routing gate was `classifyIntent==='chat' && planFirst===false`,
  but plan-mode defaults ON — so even a greeting fell through to the FULL build loop. That path
  sits SILENT from `res.flushHeaders()` until the E2B sandbox finishes creating (`workspace`
  event), a multi-second gap with no bytes sent → Cloud Run / mobile-Safari reset the stream →
  "Load failed". (The build try/catch emits a visible `error` event, so a normal throw would NOT
  look like "Load failed" — confirming it's a connection reset, i.e. the silent gap.)

Two safe, clearly-correct fixes (v3.0 route only, flag-OFF feature):
1. `isPlainChatTurn = classifyIntent(prompt) === 'chat'` — a conversational turn has nothing to
   plan, so it takes the cheap path even when plan-mode is on. classifyIntent is conservative
   (defaults to 'build' on doubt), so real build requests are unaffected. "hi" now gets a fast
   cheap reply and never spins up a sandbox.
2. Emit an immediate "Setting up your workspace…" narration BEFORE `ensureWorkspace`, so the build
   stream is never silent during sandbox setup (prevents the idle-timeout "Load failed" on real
   builds too).

HONEST status: I cannot reproduce the live failure (no gcloud, proxy blocks the live domain), so
this is my best-confidence fix addressing the most likely cause. Definitive confirmation needs the
Cloud Run log error for that request, or a post-deploy test. On the branch only — live (e0d3ab4)
is untouched until verified + merged. Gate green: server tsc 0, **2190 vitest**, build PASS,
boot:check PASS.

---

### 2026-06-24 — Diagnostic: live Vertex/Gemini/Grok health probe (answers "are the free providers working?")

Admin asked to check whether Vertex and Gemini are actually working — directly relevant to the
"Load failed" bug, because the cheap "hi" reply runs on the FREE router (Vertex → Gemini → Grok) and
falls into the heavy build path only if ALL of them fail. Could not check from the dev container (no
keys set here — verified all unset; proxy blocks the live domain), so built the means to check on live:

- `agentV3KeyDiag()` now also reports FREE-router provider PRESENCE (no secrets): `vertexConfigured`
  (GOOGLE_CLOUD_PROJECT/_ID set), `geminiKeySet` (GEMINI_API_KEY set), `grokKeySet` (GROK/XAI key set).
  Available on the public `GET /api/agentv3/diag` (presence booleans only, like anthropicKeySet).
- `GET /api/agentv3/diag?test=1&admin=<ADMIN_PASSWORD>` now also returns `freeProviders`: a live probe
  that makes ONE tiny real call to Vertex, Gemini and Grok each and reports `{ name, ok, latencyMs,
  error }` per provider — so the admin sees which actually WORK on live (not merely configured). Each
  provider failure is caught + reported, never thrown. Admin-only (real calls cost money).

Provider config requirements (for reference): Vertex = GOOGLE_CLOUD_PROJECT(+ADC); Gemini =
GEMINI_API_KEY; Grok = GROK_API_KEY or XAI_API_KEY. The Cloud Run STARTUP logs already print
`[VERTEX] … disabled`, `[GeminiProvider] … Key present: true/false`, `[ROUTER_MGR] Building FREE
chain …` — an immediate no-deploy way to see provider status. Tests: agentv3.test.ts +1 (now 9).
Gate green: server tsc 0, **2191 vitest** (+1), build PASS, boot:check PASS.

---

### 2026-06-24 — WORK DUE (admin-deferred — do later, not abandoned)

Admin parked these to do later; resuming the autonomous Section I march in the meantime. All current
session work is on branch `claude/navbharatai-pro-testing-p2mgr5` (8 commits ahead of main), gate-green,
but NOT merged → NOTHING from this session is live yet (live = e0d3ab4 #341).

WORK DUE:
1. **v3.0 deploy/git FRONTEND UI (increment 3)** — backend done (workspace-files collect + import
   endpoints). Remaining: expose ALL options in the v3.0 panel (GitHub fetch/push via existing
   `/api/github/fetch` + `/api/github/push-enhanced` + OAuth; deploy via existing `/api/pro/deploy`
   Vercel/Netlify/Cloudflare/GitHub Pages). Reuse MultiCloudDeploy/GitPanel; no new deploy backend.
2. **mitrify.xyz DURABLE DEPLOY (§12 "deploy" half)** — preview already shipped (§12.1). Remaining:
   a durable host + hostname→app serving layer + publish-target resolver (mitrify vs user's own domain).
3. **"Load failed" live confirmation** — fix shipped on branch (greeting cheap path + stream keep-alive).
   Remaining: confirm via the Cloud Run log error for the failed "hi" request, then merge+deploy+retest.
4. **Vertex/Gemini live status** — probe shipped (`/api/agentv3/diag?test=1&admin=…`). Admin will read
   the Cloud Run startup logs (`[VERTEX] … disabled`, `[GeminiProvider] Key present:`) / run the probe.
5. **Merge the 8 branch commits → main → Cloud Build deploy** — to make any of the above live.

---

### 2026-06-24 — Section I #4 v13: hardcoded provider tokens in source (security)

Resumed the autonomous Section I march. New item: `SecurityAnalysis` `hardcoded-provider-token`
rule (high). Distinctive provider credential formats — GitHub (`gh[posru]_…`), Google (`AIza…`),
Slack (`xox[baprs]-…`), Stripe-live (`[rs]k_live_…`) — hardcoded in SOURCE code. Gap (verified):
`EnvSecretValueAnalysis` already covers these formats but ONLY inside `.env` templates, and
`SecurityAnalysis.hardcoded-secret` needs a recognized key NAME, so a token under an arbitrary
variable (`const k = "ghp_…"`) in `.ts/.tsx` was missed. These formats are unmistakable → matching
one is almost certainly a real leaked credential. PLACEHOLDER ignore excludes obvious examples.
Folds into the existing security dimension. AppKnowledgeBase synced. v3.0-only, flag-OFF.

Tests: +1 unit (4 token formats flagged; env/placeholder/URL safe) + 1 dispatcher integration.
Gate green: server+frontend tsc 0, **2193 vitest** (+2), build PASS, boot:check PASS.

---

### 2026-06-24 — Section I #6 v3: new Promise(async …) executor (correctness)

Continuing the autonomous Section I march — varying from the security run back into a correctness
check. New item: `AsyncPatternAnalysis` `new-promise-async` kind (joins `async-foreach`). A
`new Promise(async (resolve, reject) => …)` executor is a classic silent bug: if the async executor
throws, the promise NEVER rejects (the throw becomes an unhandled rejection) and resolve/reject never
see the error — the code "compiles" but errors vanish at runtime, directly against "the app must
never break". High-precision regex (`new Promise(<generics>)?(  async`), comments skipped, the
synchronous executor form is NOT flagged. The scanner + summary are now multi-kind with per-kind fix
guidance. AppKnowledgeBase synced. v3.0-only, flag-OFF.

Tests: +1 unit (async executor flagged, sync form safe, comment ignored) + 1 dispatcher integration.
Gate green: server+frontend tsc 0, **2195 vitest** (+2), build PASS, boot:check PASS.

---

### 2026-06-24 — Section I #4 v14: target="_blank" without rel="noopener" (security)

Continuing the autonomous Section I march. New item: `SecurityAnalysis` `unsafe-target-blank` rule
(medium). A link with `target="_blank"` but no `rel="noopener"` lets the opened page control the
original tab via `window.opener` (reverse tabnabbing → it can silently redirect the user's tab to a
phishing page). Genuinely uncovered. High-precision: the `noopener` guard ignores the safe form, and
a non-`_blank` target is not flagged; same-line `rel` is the common case (documented precision
trade-off vs multi-line tags). Folds into the existing security dimension. AppKnowledgeBase synced.
v3.0-only, flag-OFF.

Tests: +1 unit (unsafe form flagged; rel=noopener + target=_self safe) + 1 dispatcher integration.
Gate green: server+frontend tsc 0, **2197 vitest** (+2), build PASS, boot:check PASS.

---

### 2026-06-24 — Section I #6 v4: useEffect(async …) detection (correctness)

Continuing the autonomous Section I march. New item: `AsyncPatternAnalysis` `async-useeffect` kind
(joins async-foreach + new-promise-async). `useEffect(async () => …)` is a React footgun: the effect
callback returns a Promise instead of nothing/a cleanup function, so React can NEVER run the cleanup
(stale state / leaks) — the eslint-react-hooks rule flags it too. High-precision regex
(`useEffect(  async`), comments skipped; the correct pattern (sync effect calling an inner async fn)
is not flagged. AppKnowledgeBase already covers the async family. v3.0-only, flag-OFF.

Tests: +1 unit (useEffect(async) flagged, sync effect safe) + 1 dispatcher integration. Gate green:
server+frontend tsc 0, **2199 vitest** (+2), build PASS, boot:check PASS.

---

### 2026-06-24 — Section I #7 (a11y): iframe-missing-title (accessibility)

Continuing the autonomous Section I march — varying into the Accessibility (Layer 78) dimension. New
item: `AccessibilityAnalysis` `iframe-missing-title` rule (medium). An `<iframe>` with no `title` (and
no `aria-label`) is announced by screen readers as just "iframe" with no context — WCAG 4.1.2. Tag-
local + single-line like the existing img-missing-alt rule (high precision; multi-line tags skipped).
`title` or `aria-label` satisfies it. AppKnowledgeBase synced. v3.0-only, flag-OFF.

Tests: +1 unit (iframe without title flagged; title/aria-label safe) + 1 dispatcher integration.
Gate green: server+frontend tsc 0, **2201 vitest** (+2), build PASS, boot:check PASS.

---

### 2026-06-24 — Section I #4 (architecture): server-only Node builtin imported by front-end (build-break)

Continuing the autonomous Section I march — varying into the Architecture/structural dimension. New
item: `analyzeArchitecture` now flags a server-only Node builtin (`fs`, `child_process`, `cluster`,
`net`, `tls`, `dns`, `dgram`, `worker_threads`, `v8`, `vm`, `readline`, `repl`, `inspector`, `module`,
`os`, `http2`) imported by FRONT-END code → `nodeBuiltinsInFrontend`. These have no browser equivalent
and aren't polyfilled, so the import breaks the Vite/browser build. Deliberately conservative:
commonly-polyfilled builtins (path, crypto, buffer, stream, events, util, url, process) are NOT flagged
to keep precision high; back-end files importing them are NOT flagged (reuses the same front-end path
classifier as the layering check). Folds into the existing architecture report + summary + problem
count. AppKnowledgeBase synced. v3.0-only, flag-OFF.

Tests: +2 unit (fs-in-frontend flagged; path/crypto + back-end-fs safe) + 1 dispatcher integration;
Readiness.test.ts literal updated for the new field. Gate green: server+frontend tsc 0, **2204 vitest**
(+3), build PASS, boot:check PASS.

---

### 2026-06-24 — Section I (authenticity): placeholder-image services left in markup

Continuing the autonomous Section I march — varying into the Authenticity dimension (the "real
features only, no fakes" rule). New item: `AuthenticityAnalysis` `placeholder-image` rule (medium).
Unambiguous placeholder-image generators (`via.placeholder.com`, `placehold.co/.it`, `placekitten.com`,
`placeimg.com`, `dummyimage.com`, `lorempixel.com`) left in an `<img src>`/url are fake content shipped
as real. Conservative: real photo services (picsum.photos, unsplash) are NOT flagged — they serve real
images and ship in real apps. Folds into the existing authenticity dimension. AppKnowledgeBase synced.
v3.0-only, flag-OFF.

Tests: +1 unit (via.placeholder/placehold.co flagged; picsum + local asset safe) + 1 dispatcher
integration. Gate green: server+frontend tsc 0, **2206 vitest** (+2), build PASS, boot:check PASS.

---

### 2026-06-24 — Section I #4 (security): javascript: URL in href/src (XSS sink)

Continuing the autonomous Section I march. New item: `SecurityAnalysis` `javascript-uri` rule (medium).
A `javascript:` URL in an href/src/action/formaction/xlink:href executes script when followed — an XSS
sink (worse when the URL is built from data) and a CSP violation. High-precision: the common no-op
placeholders `javascript:void(0)` / `javascript:;` are ignored to keep focus on the dangerous,
script-bearing forms; a real URL is not flagged. Folds into the existing security dimension.
AppKnowledgeBase synced. v3.0-only, flag-OFF.

Tests: +1 unit (javascript:fn() in href + javascript:alert in iframe flagged; void(0) + real URL safe)
+ 1 dispatcher integration. Gate green: server+frontend tsc 0, **2208 vitest** (+2), build PASS,
boot:check PASS.

---

### 2026-06-24 — Section I #8 (compliance): server cookie without httpOnly

Continuing the autonomous Section I march — varying into the Trust/Compliance dimension (Layer 77
"Bharosa"). New item: `ComplianceAnalysis` `cookie-no-httponly` rule (medium). A server cookie set via
`res.cookie(...)` / `response.cookie(...)` without `httpOnly` is readable by any script, so an XSS can
steal the session/auth token (DPDP/GDPR security-of-processing). Distinct from the existing
`cookie-no-samesite` (client `document.cookie` + SameSite) — different API and different protection.
High-precision: `res.cookieParser()` and other similarly-named calls are NOT matched. Feeds the
existing launch-safe certificate. AppKnowledgeBase synced. v3.0-only, flag-OFF.

Tests: +1 unit (res.cookie without httpOnly flagged; with httpOnly + cookieParser safe). Gate green:
server+frontend tsc 0, **2209 vitest** (+1), build PASS, boot:check PASS.

---

### 2026-06-24 — Section I #4 (security): postMessage wildcard target origin

Continuing the autonomous Section I march. New item: `SecurityAnalysis` `postmessage-wildcard-origin`
rule (medium). `window.postMessage(data, '*')` broadcasts the message to a frame at ANY origin — a
malicious/compromised iframe can read it; always target a specific origin. High-precision regex
(matches the `, '*')` second argument); a specific-origin call is not flagged. Folds into the existing
security dimension. AppKnowledgeBase synced. v3.0-only, flag-OFF.

Tests: +1 unit (wildcard '*' flagged; specific origin safe). Gate green: server+frontend tsc 0,
**2210 vitest** (+1), build PASS, boot:check PASS.

---

### 2026-06-24 — Feature: shared creator attribution across EVERY AI agent (admin Dr Asheesh)

Admin (Dr Asheesh) request: every NavBharatAI agent, when asked "who made/created you", must credit
"Dr Asheesh and his team" — naturally varied wording each time, same core fact. Implemented as a
SINGLE SOURCE OF TRUTH and wired into every user-facing AI agent's system prompt (DRY — update one
constant, all agents stay consistent).

- `CREATOR_IDENTITY` constant in `src/server/lib/prompts.ts` — instructs the model to credit "Dr
  Asheesh and his team" in the user's own language, vary the wording every time (never repeat the same
  sentence), never claim an AI provider/model company made it, and not invent extra names/dates.
- Wired into all agent surfaces (mapped via an Explore agent so none were missed):
  • Free Chat / NBI + Pro conversation — chat.ts (universal `systemPrompt` fold → covers all its modes)
  • Pro Chat — pro.ts (Build/Conversation, Auto, Plan — all 3 mode prompts)
  • Engineer AI — EngineerAgentLoop.ts (effectiveSystemPrompt)
  • Doctor AI (SDA) — sda.ts (SDA_SYSTEM_FINAL)
  • ALL 58 Professionals AIs — professionals/engine.ts (extracted testable `buildProfessionalSystemPrompt`)
  • AgentV3 v3.0 — systemPrompt.ts (architect + plan) AND the v3.0 cheap-chat greeting path in agentv3.ts
- Language standard respected: the instruction is English; the reply text is AI-generated at runtime in
  the user's language (the allowed exception). Per the KB rule, an AI-prompt change needs no KB nav entry.

Tests: new creatorIdentity.test.ts (+3) — constant credits Dr Asheesh + asks variation + forbids provider
attribution; professionals + agentv3 builders include the attribution. Gate green: frontend tsc 0,
server tsc 0, **2213 vitest** (+3), build PASS, boot:check PASS.

---

### 2026-06-24 — Creator address added + TEMPORARY env-gated v3.0 provider-debug (admin)

Two admin (Dr Asheesh) requests:

1. **Creator address in CREATOR_IDENTITY** — the shared attribution now also says Dr Asheesh is based
   in Budaun, Uttar Pradesh, India, and instructs the agent to mention that location if the user asks
   where the creator/team is from (still naturally varied, same core facts). Applies to every agent via
   the single source of truth (lib/prompts.ts).

2. **TEMPORARY provider-debug (testing only)** — `providerDebugTag(label)` in agentv3.ts, gated by env
   `AGENTV3_DEBUG_PROVIDER` (OFF by default). When ON, every v3.0 reply is tagged `_[debug · replied
   via <provider>]_` so the admin can verify WHERE each reply came from:
   • cheap-chat / "hi" path → the real free-router provider (VERTEX / GEMINI / GROK) from response.provider
   • build path → `Claude (<model>)` (the resilient runner already self-labels in the text if it fell
     back to a free provider).
   "Hide later" = just unset the env var on Cloud Run — no code change, users never see it (default OFF).
   The helper + call sites are marked TEMPORARY for clean removal once testing is done.

Tests: creatorIdentity.test.ts asserts the address; agentv3.test.ts asserts providerDebugTag is empty
when OFF and tags the provider when ON (+2). Gate green: frontend tsc 0, server tsc 0, **2215 vitest**
(+2), build PASS, boot:check PASS.

---

### 2026-06-24 — v3.0 UX fixes (4): agent spinner/tick, input padding, sticky header, preview port

Admin reported four v3.0 issues; all fixed:

1. **Agent chips never spin / done-tick is gray** — `AgentChip` showed a static gray `CheckCircle2`
   because the reducer flips `card.active=false` after EVERY tool_result (flickers between tools). Now
   the chip tracks the whole-build state: spins (`Loader2 animate-spin`) while the build is `running`,
   then a GREEN check (`text-emerald-500`) when done. (AgentV3Panel.tsx — AgentChip takes `running`.)

2a. **Input box eats too much space** — the input row padding `p-3` → `px-2 py-1.5` (tighter).

2b. **v3.0 header (title + Preview/Files/Diff/Terminal tabs) scrolls away** — root cause: the App
   content area is viewport-bounded (`h-[calc(100dvh-3.5rem)] overflow-hidden`) only for a fixed list of
   views, and `engine_builder` was NOT in it → it used `overflow-y-auto` (page-scrolls), and the panel
   wrapper's `height:100vh` was taller than the visible area, so the whole panel (header included)
   scrolled. Fix: added `engine_builder` to the bounded list, and changed the wrapper from
   `height:100vh` to `flex-1 min-h-0` so it fills the bounded area; the chat scrolls internally and the
   header stays put. (App.tsx)

3. **Preview "Closed Port Error" on port 5173** — the dev server bound to localhost only, so the E2B
   preview URL (`5173-<sandbox>.e2b.app`, reached over the network) got connection-refused even though
   `nc -z localhost 5173` passed. Fixed binding to 0.0.0.0 in two places: the scaffolded
   `vite.config.ts` template now sets `server/preview: { host: true, port: 5173 }`, and the v3.0 system
   prompt now instructs the agent that the dev server MUST listen on 0.0.0.0 (Vite `server.host=true` or
   `--host 0.0.0.0`; Next `-H 0.0.0.0`; CRA `HOST=0.0.0.0`).

Gate green: frontend tsc 0, server tsc 0, **2215 vitest**, build PASS, boot:check PASS.

---

### 2026-06-24 — Section I #19 (SEO): missing <meta charset>

Resuming the autonomous Section I march (while admin tests v3.0). New item: `SeoAnalysis` now flags a
missing `<meta charset>` in the HTML entry (low). Without a declared charset, non-ASCII text (e.g.
Hindi) can render as mojibake in some browsers/encodings — a real bug for a Bharat-first app. Joins the
existing high-signal four (title, viewport, description, lang); high-precision tag check. KB synced.
v3.0-only, flag-OFF. Pushed to branch only (no main-merge — yielding to the concurrent session per
admin's "pehle aap" / no-race instruction; main-merge will happen in a quiet window).

Tests: +1 unit (charset missing flagged; present safe; FULL fixture updated). Gate green: server tsc 0,
**2216 vitest** (+1), build PASS, boot:check PASS.

---

### 2026-06-24 — v3.0 Stop & Resume for orphaned builds (admin-requested)

Admin report: a v3.0 build whose UI connection was lost left the user STUCK — "A build is already
running for this account" (409) with no way to stop OR re-open the running build. Root cause:
`activeBuilds` is server-side per-account; the client "stop" only aborted the local fetch (server build
kept running), and build events streamed only to the original connection (no buffer → no re-attach).

Shipped (full Resume + Stop):
- **Backend (agentv3.ts):** a `runningBuilds` registry per account — each build's events are buffered
  (cap 4000) and fanned out to subscribers; the client res is the first subscriber, and on disconnect we
  KEEP the build alive (still buffering) so it can be resumed. New endpoints: `POST /api/agentv3/stop`
  (aborts the loop via AbortController + ends all streams + frees the slot immediately) and
  `POST /api/agentv3/attach` (replays the buffer then streams live — true re-attach). `/status` now
  returns `buildRunning`; the 409 carries `resumable`. Registry cleanup is guarded
  (`runningBuilds.get(key) === rb`) so a Stop-then-new-build can't be clobbered by the old loop's finally.
- **AgentRunner:** accepts an `AbortSignal`; stops honestly BETWEEN turns ("Build stopped by the user.")
  so Stop actually halts server compute, not just the UI.
- **Frontend (useAgentV3Build):** `stop()` now also calls `/stop` (true server stop); new `resume()`
  (attach + shared `pumpStream`), `checkRunning()`, and `serverBuildRunning` state.
- **Frontend (AgentV3Panel header, top-right):** replaces the single "New" with state-aware buttons —
  attached+streaming → **Stop**; a build running but not attached → **Resume + Stop**; idle → **New**.
  On mount/idle it polls `/status` to detect an orphaned build. KB synced.

Tests: +1 AgentRunner (abort signal stops the loop). Gate green: frontend tsc 0, server tsc 0,
**2217 vitest** (+1), build PASS, boot:check PASS. Pushed to branch (no main-merge — yielding to the
concurrent session; will merge in a quiet window).

---

### 2026-06-24 — v3.0 multi-provider BUILD engine (Vertex/Gemini can now actually build, not just chat)

Admin hit "Your credit balance is too low to access the Anthropic API" on live — Claude out of credits,
so v3.0 builds fell back to a TEXT-only reply (GROK) and produced NOTHING real (no files, no dev server,
no preview). Root cause: the build tool-use loop was Claude-only; the fallback couldn't call tools.

Discovery: a prior session had ALREADY built the pieces (unwired) — `GeminiToolRunner` (real Gemini/Vertex
function-calling TurnRunner) + `makeMultiProviderTurnRunner` (cheap-first chain with a Claude backstop),
both tested. Wired them into the build path:
- New `buildTurnRunner()` in agentv3.ts builds a chain: **VERTEX → GEMINI → CLAUDE (backstop)**, each a
  real tool-use runner, so Vertex/Gemini do the ACTUAL building (write_file, bash, run dev server…) and
  Claude only catches hard failures. Replaces `makeResilientTurnRunner(new ClaudeClient())` (which was
  Claude-primary + text-only fallback).
- Vertex via `new GoogleGenAI({ vertexai: true, project, location })` (Cloud Run ADC / the SA roles the
  admin already granted); Gemini via `GEMINI_API_KEY`. Falls back to the Claude-only resilient runner if
  neither is configured.
- Env knobs: `AGENTV3_BUILD_CLAUDE_FIRST=1` (prefer Claude, Gemini/Vertex as fallback — for when credits
  return), `AGENTV3_{VERTEX,GEMINI}_BUILD_MODEL` (default `gemini-2.5-pro`). Billing unchanged
  (Claude-equivalent markup regardless of model → margin only improves with the cheaper model).
- Bonus: this also fixes the dishonest "✅ Here's what I built" — if every provider fails the turn now
  throws → the loop emits an honest `error`, never a fake success.

NEEDS DEPLOY to take effect (build path is live). Caveat: Gemini build quality vs Claude is unverified
end-to-end; the adapter is unit-tested but real builds need a live test. Gate green: frontend+server
tsc 0, **2217 vitest**, build PASS, boot:check PASS, 41 provider tests pass. Pushed to branch.

---

### 2026-06-24 — v3.0 fixes: create-vite/Node, loading spinner under reduced-motion

Admin (live test) hit 3 issues; 2 fixed here (#1, #3), #2 (full-app theme) scoped separately.

#1 — Build said "create-vite failed … Node.js version incompatibility" (NOTE: this confirms Vertex/Gemini
is NOW actually BUILDING — running real tool commands). The agent shouldn't scaffold with create-vite at
all: the workspace is already pre-scaffolded (vite-react template) and the sandbox Node is older than the
latest create-vite needs. Fix: system prompt now tells the agent the Vite+React+TS project is ALREADY
scaffolded — edit/add files, NEVER run `npm create vite`/`create-vite`/`npx create-*` (write config files
directly for a different stack). Unblocks builds + faster (no scaffolder step).

#3 — The "working…" loading spinner (and agent-chip spinners) didn't rotate. Root cause: index.css's
`prefers-reduced-motion: reduce` block froze ALL animations (animation-duration 0.01ms / iteration 1) —
so on a device with "reduce motion" ON, every spinner stops. A loading spinner conveys live status, not
decoration, so it's an allowed reduced-motion exception. Fix: re-assert `.animate-spin { duration:1s;
iteration:infinite }` inside the reduced-motion block — decorative motion stays reduced, functional
spinners keep turning.

Gate green: frontend+server tsc 0, **2217 vitest**, build PASS, boot:check PASS. Pushed to branch.

---

### 2026-06-24 — v3.0: preview default → e2b.app + stop the Node/tooling-version loop

Admin live test: Vertex/Gemini IS building now (Files 7, Diff 3, History 13, Stop button live), but two
bugs: (a) preview showed "5173-…mitrify.xyz's server IP address could not be found" — mitrify.xyz custom
domain isn't set up (it needs a Caddy reverse-proxy VM + Cloudflare wildcard DNS per E2B's docs, not just
a DNS record); (b) the agent looped 20+ min on `SyntaxError: node:util does not provide styleText` — the
sandbox Node is OLD and the agent kept trying to upgrade vite/vitest (unfixable) instead of shipping.

Fixes:
- `PreviewDomain.ts`: DEFAULT_PREVIEW_DOMAIN `mitrify.xyz` → **`e2b.app`** (always resolvable → previews
  work out of the box). mitrify is now opt-in: set `E2B_PREVIEW_DOMAIN=mitrify.xyz` once the custom domain
  + wildcard DNS are configured. Tests updated (default = e2b.app; swap still tested with the env set).
- `systemPrompt.ts`: told the agent the sandbox NODE VERSION IS FIXED — on a Node-version tool error
  (node:util/styleText, ESM/engine, create-* failure) do NOT loop upgrading Node/tooling; pin an older
  tool version or SKIP that step. And: a WORKING PREVIEW is the goal, not a green test suite — never block
  on running vitest if the sandbox Node can't; build → run dev server → update_preview first.

Admin will set up mitrify custom domain themselves (E2B docs: https://e2b.dev/docs/sandbox/custom-domain).
Gate green: server tsc 0, **2217 vitest**, build PASS, boot:check PASS. Pushed to branch.

---

### 2026-06-24 — Section I #7 (a11y): icon-only link with no accessible name

Resumed the autonomous Section I march after deploying the e2b.app/Node-loop fixes. New item:
`AccessibilityAnalysis` `link-no-accessible-name` rule (low) — a same-line `<a href>` whose inner
content (child tags stripped) has no visible text and no aria-label/aria-labelledby/title is an
icon-only link a screen reader announces as nothing. Mirrors the existing button-no-accessible-name;
distinct from anchor-missing-href (which is for links WITHOUT href). High-precision (tag-local,
single-line). KB synced. v3.0-only, flag-OFF.

Tests: +1 unit (icon-only link flagged; text/aria-label/no-href safe) + 1 dispatcher integration.
Gate green: server tsc 0, **2219 vitest** (+2), build PASS, boot:check PASS.

---

### 2026-06-24 — Section I #4 (security): document.write() XSS sink

Continuing the autonomous Section I march. New item: `SecurityAnalysis` `document-write` rule (medium).
`document.write()`/`.writeln()` injects raw HTML (an XSS sink when fed dynamic data), blocks the parser,
and wipes the whole page if called after load. Distinct from the existing `unsafe-html-sink`
(innerHTML/outerHTML/insertAdjacentHTML). High-precision (`\bdocument.write(ln)?(`); a plain
`stream.write(...)` is not matched. KB synced. v3.0-only, flag-OFF.

Tests: +1 unit (document.write/writeln flagged; stream.write safe). Gate green: server tsc 0,
**2220 vitest** (+1), build PASS, boot:check PASS.

---

### 2026-06-24 — Section I #7 (a11y): autoplaying media with sound (WCAG 1.4.2)

Continuing the autonomous Section I march. New item: `AccessibilityAnalysis` `media-autoplay` rule
(medium). Flags `<audio autoplay>` (always) or a `<video autoplay>` that is NOT muted — sound starts
without user action (WCAG 1.4.2). A muted video autoplay (common background loop) is intentionally NOT
flagged. Tag-local, high precision. KB synced. v3.0-only, flag-OFF.

Tests: +1 unit (autoplay audio + unmuted autoplay video flagged; muted autoplay + no-autoplay safe).
Gate green: server tsc 0, **2221 vitest** (+1), build PASS, boot:check PASS.

---

### 2026-06-24 — Section I #4 (security): setTimeout/setInterval string argument (eval)

Continuing the autonomous Section I march. New item: `SecurityAnalysis` `settimeout-string` rule
(medium). `setTimeout`/`setInterval` with a STRING first argument runs it as code (an eval) — code
injection + a CSP violation. The `eval-usage`/`dynamic-function` rules miss this third eval form.
High-precision: matches only a quoted first arg; a function argument (`setTimeout(() => …)` /
`setTimeout(fn, …)`) is not matched. KB synced. v3.0-only, flag-OFF.

Tests: +1 unit (string args flagged; function/reference args safe). Gate green: server tsc 0,
**2222 vitest** (+1), build PASS, boot:check PASS.

---

### 2026-06-24 — Section I #4 (security): open redirect (res.redirect to request input)

Continuing the autonomous Section I march. New item: `SecurityAnalysis` `open-redirect` rule (medium).
`res.redirect()` to a value taken DIRECTLY from the request (req.query/params/body/headers) is an open
redirect — attackers craft a link that sends users to a phishing site. High-precision: the redirect
target must START with req.* (optionally after a 3-digit status), so a fixed-path redirect with the
user value only as a query param (`res.redirect(`/go?to=${req.query.x}`)`) is NOT flagged. KB synced.
v3.0-only, flag-OFF.

Tests: +1 unit (req-input + status-code forms flagged; static + fixed-path safe). Gate green:
server tsc 0, **2223 vitest** (+1), build PASS, boot:check PASS.

---

### 2026-06-25 — Section I march (batch): 11 high-precision quality checks

Continuing the autonomous Section I march (complete→push→next). Eleven new high-precision
checks added across the existing `evaluate` dimensions — each with a unit test, `AppKnowledgeBase`
synced where user-facing, and the full gate green (server+frontend tsc, vitest, build). All are
v3.0-only static scanners (pure, line/tag-local) so precision stays high. Branch
`claude/navbharatai-pro-testing-p2mgr5`, not merged to main (admin's call):

1. `AuthenticityAnalysis` **ts-nocheck** (medium) + **ts-ignore** (low) — suppressing type errors
   hides real bugs behind a green build; `@ts-expect-error` (intentional, self-verifying) NOT flagged.
2. `SecurityAnalysis` **weak-crypto-cipher** (high) — legacy `crypto.createCipher`/`createDecipher`
   (no IV, MD5 key derivation); the correct `createCipheriv`/`createDecipheriv` NOT flagged.
3. `AccessibilityAnalysis` **aria-hidden-interactive** (medium) — `aria-hidden="true"` on an
   interactive element (button / a[href] / input / select / textarea): focusable but unannounced.
4. `ComplianceAnalysis` **cookie-no-secure** (medium) — server cookie set without the Secure flag.
5. `SeoAnalysis` **Open Graph** (low) — no `og:` tags → bare link previews on WhatsApp/social.
6. `AsyncPatternAnalysis` **async-array-predicate** — `filter/find/findIndex/some/every/sort(async …)`
   are always-wrong (the method uses the return synchronously); `.map(async …)` excluded.
7. `SecurityAnalysis` **vue-v-html** (medium) — Vue `v-html` raw-HTML XSS sink (closes the Vue gap).
8. `ArchitectureAnalysis` **nodeBuiltinsInFrontend** expanded — +async_hooks, diagnostics_channel,
   perf_hooks, trace_events (no browser equivalent, not bundler-polyfilled).
9. `SeoAnalysis` **favicon** (low) — no `<link rel=icon>` → generic tab icon + /favicon.ico 404.
10. `ComplianceAnalysis` **geolocation as PII** — `navigator.geolocation`/getCurrentPosition/
    watchPosition now triggers the "collects personal data → needs privacy policy" launch-safe logic.
11. `AuthenticityAnalysis` **eslint-disable-all** (low) — a bare `eslint-disable` (no rule named)
    turns off every lint rule; a disable that names specific rules NOT flagged.

Gate at end of batch: server tsc 0, frontend tsc 0, **2234 vitest** PASS, build PASS.

---

### 2026-06-25 — Section I march (batch 2, post-deploy): 6 more high-precision checks

Batch 1 (11 checks) merged to `main` 8d08761 (admin: "deploy karo") — clean FF, CI green pre-merge,
Cloud Run auto-deploy triggered. Continuing the march on `claude/navbharatai-pro-testing-p2mgr5`
(now ahead of main again). Six more, each unit-tested + KB-synced + full gate green:

1. `AccessibilityAnalysis` **input-image-missing-alt** (high) — `<input type="image">` graphical
   submit button with no alt (WCAG 1.1.1); plain img-missing-alt only covered `<img>`.
2. `SeoAnalysis` **robots-noindex** (medium) — a leftover `<meta name=robots content=noindex>`
   that silently keeps the live site OUT of search results.
3. `AccessibilityAnalysis` **zoom-disabled** (medium) — viewport `user-scalable=no` / `maximum-scale=1`
   blocks pinch-zoom, locking out low-vision users (WCAG 1.4.4).
4. `AuthenticityAnalysis` **empty-promise-catch** (low) — `.catch(() => {})` empty body silently
   swallows a rejection (promise-chain twin of an empty try/catch).
5. `AccessibilityAnalysis` **role-presentation-interactive** (medium) — `role=none`/`presentation`
   on a button/link/control strips its semantics from assistive tech.
6. `SeoAnalysis` **placeholder-title** (medium) — a leftover template-default `<title>` ("Vite + React"
   / "React App" / "Document" / "Untitled") — the classic "looks unfinished" tell.

Gate at end of batch 2: server tsc 0, frontend tsc 0, **2240 vitest** PASS, build PASS.

---

### 2026-06-25 — Section I march (batch 3): 3 checks + standing autonomous-deploy

Admin: "khud ba khud deploy kar diya karo, ruk kyu jate ho" → standing authorization to
auto-deploy each green batch to `main` (CI-green-before-merge gate still enforced; no asking).
Batch 2 (6 checks) merged to main f68f1f4. New since:

1. `ComplianceAnalysis` **secret-in-url** (medium) — a password/token/api_key/otp/cvv in a URL query
   string leaks into server logs, browser history and the Referer header.
2. `SecurityAnalysis` **insecure-websocket** (low) — a ws:// socket to a remote host (in the clear;
   an https page can't open it — mixed content); wss:// and localhost not flagged.
3. `AuthenticityAnalysis` **placeholder-email** (low) — a left-in support@example.com / .org / .net
   contact email shipped as if real.

Gate: server tsc 0, frontend tsc 0, **2243 vitest** PASS, build PASS.

---

### 2026-06-25 — Section I march (batch 4): 2 security checks (auth/secret hardening)

Batch 3 merged to main 6985077. New on `claude/navbharatai-pro-testing-p2mgr5`:

1. `SecurityAnalysis` **hardcoded-provider-token** extended — now also matches GitHub fine-grained
   PATs (github_pat_) and Anthropic keys (sk-ant-), both unmistakable formats.
2. `SecurityAnalysis` **jwt-none-algorithm** (high) — a JWT configured with the "none" algorithm
   (sign) or allowing "none" in the verify list accepts UNSIGNED tokens → anyone can forge any
   token (auth bypass). A real algorithm allow-list (HS256/RS256) is not flagged.

Gate: server tsc 0, frontend tsc 0, **2244 vitest** PASS, build PASS.

---

### 2026-06-25 — Section I march (batch 5): duplicate-id (a11y) + pseudoRandomBytes (security)

Batch 4 merged to main b03dfe3. New:

1. `AccessibilityAnalysis` **duplicate-id** (medium) — a repeated static id="foo" in one file breaks
   <label for>/aria-* references (they resolve to the first match) and is invalid HTML. Only literal
   string ids are counted; dynamic ids (id={`row-${i}`}) are expected to vary and are skipped.
2. `SecurityAnalysis` **pseudo-random-bytes** (high) — crypto.pseudoRandomBytes() is explicitly NOT
   cryptographically secure (deprecated); flagged so tokens/keys/IVs use crypto.randomBytes().

Gate: server tsc 0, frontend tsc 0, **2246 vitest** PASS, build PASS.

---

### 2026-06-25 — Section I march (batch 6): viewport-fixed-width (SEO) + meta-refresh (a11y)

Batch 5 merged to main 82329a4. New:

1. `SeoAnalysis` **viewport-fixed-width** (medium) — a viewport pinned to a fixed pixel width
   (width=1024) instead of width=device-width makes the app non-responsive on mobile.
2. `AccessibilityAnalysis` **meta-refresh** (medium) — a <meta http-equiv="refresh"> timed
   auto-refresh/redirect disorients users and moves focus without consent (WCAG 2.2.1 / 3.2.5).

Gate: server tsc 0, frontend tsc 0, **2248 vitest** PASS, build PASS.

---

### 2026-06-25 — Section I march (batch 7): CORS credential-reflection + debug console.log

Batch 6 merged to main d1f4daa. New:

1. `SecurityConfigAnalysis` **cors-credentials-reflect-origin** (high) — cors({ origin: true,
   credentials: true }) reflects ANY origin while allowing credentials, so any site can make
   authenticated cross-origin requests with the user's cookies. A pinned origin + credentials
   (the safe pattern) is not flagged.
2. `AuthenticityAnalysis` **debug-console-log** (low) — a leftover debug print: console.log of a
   bare number or a throwaway sentinel ("here"/"test"/"asdf"…); a real log message is not flagged.

Gate: server tsc 0, frontend tsc 0, **2250 vitest** PASS, build PASS.

---

### 2026-06-25 — Section I march (batch 8): innerHTML += gap-fix + Angular bypassSecurityTrust

Batch 7 merged to main 6b021d2. New:

1. `SecurityAnalysis` **unsafe-html-sink** gap-fix — now also catches `el.innerHTML += userInput`
   (append), not just `=` assignment; both are XSS sinks.
2. `SecurityAnalysis` **angular-bypass-security** (medium) — Angular bypassSecurityTrustHtml/Url/
   ResourceUrl/Script/Style explicitly DISABLES built-in sanitisation (XSS risk on untrusted input).

Gate: server tsc 0, frontend tsc 0, **2251 vitest** PASS, build PASS.

---

### 2026-06-25 — Section I march (batch 9): path traversal + NoSQL injection (server security)

Batch 8 merged to main 19c3029. New:

1. `SecurityAnalysis` **path-traversal** (high) — a file read/response (sendFile/readFile/
   createReadStream/readdir/unlink) built on request input enables ../../etc/passwd disclosure.
2. `SecurityAnalysis` **nosql-injection** (high) — a raw req.body/req.query passed straight into a
   Mongo/Mongoose query (.find/.findOne/.update*/.delete*) lets a user inject $gt/$ne operators to
   bypass it (classic login auth bypass). Validated explicit fields are not flagged.

Gate: server tsc 0, frontend tsc 0, **2253 vitest** PASS, build PASS.

---

### 2026-06-25 — Fix: AgentV3 sandbox create-* scaffolder Node-version failure (live-test bug)

Reported during live v3.0 test ("node.js wali problem abhi bhi h"): the build agent ran
`npm create vite`, it FAILED on the sandbox's fixed (older) Node, and the agent then
improvised a nested `todo-app/` subdir and hand-wrote package.json — slow + fragile. The
system prompt already discouraged create-* generators, but a prompt is advisory and the
model ignored it.

Real, deterministic backstop (not just a prompt tweak):
1. NEW `src/server/AgentV3/ScaffoldGuard.ts` — PURE matcher that detects create-* project
   generators (`npm/yarn/pnpm/bun create`, `npx create-*`, `npm init <generator>`) without
   matching ordinary `npm install` / `npm run` / `npm init -y` / git commits. + redirect
   message that steers the agent to the existing ROOT scaffold (never a nested subdir).
2. `ToolDispatcher` bash handler now intercepts a blocked command BEFORE running it,
   self-heals the root scaffold (writes the Vite+React+TS starter via ViteReactProvider if
   package.json is missing), records a governance audit, and returns the redirect — so the
   doomed command never runs and no build turns are wasted.
3. `systemPrompt` SCAFFOLDING bullet updated: these commands are now auto-BLOCKED, edit at
   the ROOT only.

Gate: server tsc 0, frontend tsc 0, **2258 vitest** PASS (5 new ScaffoldGuard tests; 63
existing ToolDispatcher tests still green — no regression).

---

### 2026-06-25 — Section I march (batch 10): SSRF + disabled-TLS-verification (server security)

Resumed the autonomous Section I march after the scaffold-guard fix (PR #360) merged to main
df50067. New `SecurityAnalysis` rules:

1. **ssrf** (high) — a server-side HTTP request (`fetch`/`axios`/`axios.get|post|…`/`got`/
   `http(s).get|request`) whose first arg IS request input (`req.query|params|body|headers`)
   lets an attacker reach internal services / cloud metadata (169.254.169.254). High-precision:
   a fixed base with `${req...}` appended doesn't start with `req.`, so it is not flagged.
2. **disable-tls-verification** (high) — `rejectUnauthorized: false` or
   `NODE_TLS_REJECT_UNAUTHORIZED=0` turns off TLS cert validation (trivial MITM). Both forms
   unambiguous → high precision; the secure `rejectUnauthorized: true` is not flagged.

Gate: server tsc 0, frontend tsc 0, **2260 vitest** PASS (33 SecurityAnalysis tests, +2 new).

---

### 2026-06-25 — Section I march (batch 11): vm code-execution + insecure Electron webPreferences

Batch 10 merged to main c11bd89 (PR #361). New `SecurityAnalysis` rules:

1. **vm-code-execution** (high) — Node `vm.runInNewContext/runInThisContext/runInContext/
   compileFunction` runs a STRING as code (like eval) and is explicitly NOT a security
   sandbox; user input → RCE. The `vm.` prefix keeps it high-precision.
2. **electron-insecure-webprefs** (high) — `nodeIntegration: true` or `contextIsolation: false`
   in Electron webPreferences turns any renderer XSS into full code execution on the user's
   machine. Both forms explicit; the hardened defaults are not flagged.

Gate: server tsc 0, frontend tsc 0, **2262 vitest** PASS (35 SecurityAnalysis tests, +2 new).

---

### 2026-06-25 — Section I march (batch 12): Handlebars triple-stache + EJS unescaped output (template XSS)

Batch 11 merged to main 6924b6a (PR #362). New `SecurityAnalysis` rules — template-engine XSS
sinks parallel to the existing v-html / dangerouslySetInnerHTML / document-write family:

1. **handlebars-triple-stache** (medium) — `{{{ value }}}` renders RAW unescaped HTML (vs the
   safe escaped `{{ value }}`); XSS sink for user data. The triple-brace form is distinctive →
   high precision.
2. **ejs-unescaped-output** (medium) — `<%- value %>` outputs raw unescaped HTML (vs escaped
   `<%= %>`). The standard `<%- include(...) %>` partial idiom is excluded for precision.

Gate: server tsc 0, frontend tsc 0, **2264 vitest** PASS (37 SecurityAnalysis tests, +2 new).

---

### 2026-06-25 — Section I march (batch 13): empty-heading + autofocus (accessibility)

Batch 12 merged to main b7c69d9 (PR #363). Diversified from security to a11y. New
`AccessibilityAnalysis` rules (both with axe-core precedent):

1. **empty-heading** (medium) — an `<h1>`–`<h6>` whose stripped inner text is empty breaks the
   heading-navigation outline screen-reader users rely on (axe "empty-heading", WCAG 1.3.1 /
   2.4.6). Same-line; `<h2><Icon/></h2>` flagged, `<h2>About</h2>` and an aria-label'd heading not.
2. **autofocus** (low) — `autofocus`/`autoFocus` on a form control yanks focus on load,
   disorienting screen-reader users and skipping content (axe "no-autofocus").

Gate: server tsc 0, frontend tsc 0, **2266 vitest** PASS (24 AccessibilityAnalysis tests, +2 new).

---

### 2026-06-25 — Section I march (batch 14): partial-OG og:image + over-long title (SEO)

Batch 13 merged to main 40dde8b (PR #364). New `SeoAnalysis` checks (both fire only on real,
present-but-flawed metadata — never nagging a clean page):

1. **og:image missing (partial OG)** (low) — Open Graph tags exist but `og:image` is absent, so
   a shared link renders a card with text and no image. Distinct from the existing "no OG at
   all" finding (which only fires when there are zero og tags).
2. **over-long `<title>`** (low) — a real (non-default) title over 60 characters is truncated in
   search results; flagged with its actual length so the agent tightens it.

Existing "no OG" test made specific (`/No Open Graph tags/`) since a partial OG is now flagged
by its own rule. Gate: server tsc 0, frontend tsc 0, **2268 vitest** PASS (17 SeoAnalysis tests).

---

### 2026-06-25 — Section I march (batch 15): window.open noopener + deprecated TLS version (security)

Batch 14 merged to main 727a5ac (PR #365). New `SecurityAnalysis` rules:

1. **window-open-no-opener** (medium) — `window.open(url)` does NOT imply noopener (unlike a
   modern target="_blank" link), so the opened page can drive this tab via window.opener
   (reverse tabnabbing). Complements the HTML-only unsafe-target-blank rule. Safe forms
   ('noopener' feature arg, or a `.opener = null` cleanup, or a no-arg call) are ignored.
2. **tls-weak-version** (medium) — pinning a deprecated protocol (`minVersion: 'TLSv1'/'TLSv1.1'`
   or `secureProtocol: 'TLSv1_method'/'SSLv3_method'`) exposes BEAST/POODLE; TLS 1.2+ not flagged.

Gate: server tsc 0, frontend tsc 0, **2270 vitest** PASS (39 SecurityAnalysis tests, +2 new).

---

### 2026-06-25 — Section I march (batch 16): async useMemo + async reduce (correctness footguns)

Batch 15 merged to main 293496f (PR #366). Shifted to runtime-correctness. New
`AsyncPatternAnalysis` footguns (parallel to the existing forEach/Promise-executor/useEffect/
predicate rules):

1. **async-usememo** — `useMemo(async () => …)` memoizes the returned Promise, so the value is
   a Promise (always truthy, never the resolved data) — an always-wrong silent bug.
   `useCallback(async …)` is NOT flagged (memoizing an async function is correct).
2. **async-reduce** — `reduce(async …)`/`reduceRight(async …)` makes the accumulator a Promise;
   each step's `acc` is a Promise unless awaited every time, and the result is a Promise.

Gate: server tsc 0, frontend tsc 0, **2272 vitest** PASS (11 AsyncPatternAnalysis tests, +2 new).

---

### 2026-06-25 — Section I march (batch 17): insecure randomness + weak hash for security values

Batch 16 merged to main 749a618 (PR #367). New `SecurityAnalysis` rules, both kept precise by a
shared SECURITY_CONTEXT same-line keyword guard (secret/token/password/otp/session/…):

1. **insecure-random-token** (high) — `Math.random()` on a security-context line builds a
   predictable token/OTP/session id; ordinary Math.random() (jitter, sampling, animation) is
   NOT flagged. Use crypto.randomUUID()/randomBytes().
2. **weak-hash-security** (medium) — `createHash('md5'|'sha1')` on a security-context line
   (password/token/signature). An md5 ETag/cache-key/checksum (no security keyword) is NOT
   flagged. Use SHA-256+ for integrity, bcrypt/scrypt/argon2 for passwords.

Gate: server tsc 0, frontend tsc 0, **2274 vitest** PASS (41 SecurityAnalysis tests, +2 new).

---

### 2026-06-25 — Section I march (batch 18): hardcoded private-network IP URLs (deploy readiness)

Batch 17 merged to main 08e5482 (PR #368). Extended `HardcodedUrlAnalysis` beyond localhost:

- **private-ip** (medium) — a hardcoded RFC-1918 private-network URL (`192.168.x.x`,
  `10.x.x.x`, `172.16–31.x.x`) is the same "works on my machine, breaks in production" bug as
  localhost — it won't resolve once deployed. Public IPs/domains and env-var fallbacks are NOT
  flagged. Added a `kind: 'localhost' | 'private-ip'` field to the issue and kind-aware summary.

Gate: server tsc 0, frontend tsc 0, **2276 vitest** PASS (10 HardcodedUrlAnalysis tests, +3 new).

---

### 2026-06-25 — Section I march (batch 19): RegExp-from-request (ReDoS) + XXE entity expansion

Batch 18 merged to main cfbda93 (PR #369). New `SecurityAnalysis` rules:

1. **regexp-from-request** (medium) — `new RegExp(...)` built from request input (req.query/
   params/body/headers) lets an attacker inject a catastrophically backtracking pattern (ReDoS)
   that hangs the server. A fixed/literal pattern is not flagged.
2. **xxe-entity-expansion** (high) — an XML parser told to resolve entities
   (`noent`/`resolveEntities`/`expandEntities`/`externalEntities: true`) opens XXE: local file
   disclosure, SSRF, billion-laughs DoS. The safe `false` form is not flagged.

Gate: server tsc 0, frontend tsc 0, **2278 vitest** PASS (43 SecurityAnalysis tests, +2 new).

---

### 2026-06-25 — Section I march (batch 20): prototype-pollution + open-redirect via Location header

Batch 19 + autonomous-cycle CLAUDE.md doc merged to main 2b58cd7 (PR #370). New
`SecurityAnalysis` rules:

1. **prototype-pollution** (high) — deep-merging untrusted request input (`_.merge`/`mergeWith`/
   `defaultsDeep`/`set`, or `$.extend(true, …)`) with the WHOLE req object lets a `__proto__`
   payload poison Object.prototype. `(?!\.\w)` excludes a validated leaf (req.body.name) — a
   documented precision trade-off (a nested object like req.body.settings is not matched).
2. **open-redirect-header** (medium) — setting the `Location` header directly from request input
   (the header twin of res.redirect(req...)). Fixed targets are not flagged.

Gate: server tsc 0, frontend tsc 0, **2280 vitest** PASS (45 SecurityAnalysis tests, +2 new).

---

### 2026-06-25 — Section I march (batch 21): abstract ARIA role + redundant role (accessibility)

Batch 20 merged to main 5ab8b95 (PR #371). New `AccessibilityAnalysis` rules (axe-core
precedent — "aria-roles" / "no-redundant-roles"):

1. **abstract-aria-role** (medium) — an abstract ARIA role (widget/input/composite/landmark/
   range/section/select/structure/window/command/roletype/sectionhead) exists only to organise
   the ARIA taxonomy and is IGNORED by assistive tech, leaving the element with no usable role.
2. **redundant-role** (low) — an explicit role that just duplicates the element's native role
   (button role="button", nav role="navigation", a[href] role="link", ul/ol role="list", …) —
   harmless noise. Only unambiguous element→role mappings are flagged; `<a>` without href has no
   implicit link role so role="link" there is not redundant.

Gate: server tsc 0, frontend tsc 0, **2282 vitest** PASS (26 AccessibilityAnalysis tests, +2 new).

---

### 2026-06-25 — Section I march (batch 22): client-exposed secret + URL-embedded credentials

Batch 21 merged to main 3d7a99f (PR #372). New `SecurityAnalysis` rules:

1. **client-exposed-secret** (high) — an env var with a CLIENT build prefix (VITE_/
   NEXT_PUBLIC_/REACT_APP_) named like a secret (…SECRET/PASSWORD/PRIVATE) is inlined into
   the public browser bundle — visible to everyone. Bare *_KEY/_TOKEN (publishable values)
   are intentionally NOT flagged.
2. **url-embedded-credentials** (high) — `https://user:pass@host` leaks the credential and is
   deprecated in browsers. Complements connection-string-credentials (which only covers DB/
   queue schemes). Placeholder/env (${...}, example) forms ignored.

Gate: server tsc 0, frontend tsc 0, **2284 vitest** PASS (47 SecurityAnalysis tests, +2 new).

---

### 2026-06-25 — Section I march (batch 23): non-UTF-8 charset + over-long meta description (SEO)

Batch 22 merged to main c270322 (PR #373). New `SeoAnalysis` checks (extend the present-but-
flawed pattern):

1. **non-UTF-8 charset** (low) — a declared charset that is not UTF-8 (e.g. ISO-8859-1,
   windows-1252) cannot represent Devanagari, so Hindi/Hinglish content renders as mojibake.
   Especially relevant to NavBharatAI's bilingual output. UTF-8/UTF8 not flagged.
2. **over-long meta description** (low) — a description over 160 chars is truncated in search
   results; flagged with its actual length (parallel to the batch-14 over-long title check).

Gate: server tsc 0, frontend tsc 0, **2286 vitest** PASS (19 SeoAnalysis tests, +2 new).

---

### 2026-06-25 — Section I march (batch 24): loopback-host bind (preview unreachable)

Batch 23 merged to main cf66b74 (PR #374). Extended `PortBindingAnalysis` to the EXACT
preview-"connection refused" bug class:

- **loopback-host** (high) — a server bound to `localhost`/`127.0.0.1` (positional
  `.listen(port, 'localhost')` OR object `.listen({ port, host: '127.0.0.1' })`) is only
  reachable inside the container, so the cloud host / sandbox preview gets "connection refused".
  Bind to 0.0.0.0. Flagged even when the PORT comes from env (the host is the bug). A
  `0.0.0.0` bind or a callback 2nd arg is NOT flagged. Added a `kind` field
  ('hardcoded-port' | 'loopback-host'); `port` is now optional; severity union medium|high.

Gate: server tsc 0, frontend tsc 0, **2288 vitest** PASS (13 PortBindingAnalysis tests, +2 new).

---

### 2026-06-25 — Section I march (batch 25): <area> missing alt + <input type=button> no name (a11y)

Batch 24 merged to main 17f2bf0 (PR #375). New `AccessibilityAnalysis` rules (void elements,
no child-content false positives; axe "area-alt"):

1. **area-missing-alt** (high) — an `<area href>` (an image-map region = a link) with no alt;
   a screen reader announces nothing for it (WCAG 1.1.1).
2. **input-button-no-name** (medium) — `<input type="button">` with no value/aria-label/title.
   Unlike submit/reset (default "Submit"/"Reset"), a plain button input has no default label,
   so it is announced as just "button".

Gate: server tsc 0, frontend tsc 0, **2290 vitest** PASS (28 AccessibilityAnalysis tests, +2 new).

---

### 2026-06-25 — Section I march (batch 26): ECB cipher mode + weak RSA key size (crypto)

Batch 25 merged to main 24c9f32 (PR #376). New `SecurityAnalysis` crypto rules:

1. **insecure-cipher-ecb** (high) — a cipher algorithm in ECB mode (`aes-256-ecb`, `des-ecb`)
   encrypts identical plaintext blocks to identical ciphertext (the "ECB penguin"), leaking
   patterns. Use AES-GCM (or CBC + random IV). GCM/CBC not flagged.
2. **weak-rsa-key-size** (medium) — `modulusLength: 512/768/1024` for RSA/DSA key generation is
   brute-forceable/deprecated; require ≥2048. 2048/4096 not flagged.

Gate: server tsc 0, frontend tsc 0, **2292 vitest** PASS (49 SecurityAnalysis tests, +2 new).

---

### 2026-06-25 — Section I march (batch 27): secret in web storage + httpOnly:false cookie (security)

Batch 26 merged to main e4d4a7b (PR #377). New `SecurityAnalysis` rules:

1. **secret-in-web-storage** (medium) — `localStorage/sessionStorage.setItem(...)` storing a
   token/secret (any XSS on the page can read web storage). Uses a substring keyword guard
   (catches camelCase authToken/accessToken; excludes "session" since it's in "sessionStorage").
   A theme/locale value is not flagged. Prefer an httpOnly, Secure cookie for auth tokens.
2. **cookie-httponly-false** (medium) — `httpOnly: false` makes a cookie JS-readable, so an XSS
   can steal a session/auth cookie. The flag defaults off, so an explicit false is a risky opt-out.

Gate: server tsc 0, frontend tsc 0, **2294 vitest** PASS (51 SecurityAnalysis tests, +2 new).

---

### 2026-06-25 — Section I march (batch 28): correction (remove duplicate) + SameSite=None insecure

Batch 27 merged to main c4b72ef (PR #378). HONEST CORRECTION + new check:

- **Removed** `secret-in-web-storage` (added in batch 27) — it DUPLICATED ComplianceAnalysis's
  existing `sensitive-in-browser-storage` (both fire on localStorage/sessionStorage.setItem +
  a sensitive keyword), so the same line was reported twice in `evaluate`. Root cause: before
  batch 27 I grepped only SecurityAnalysis.ts, not the whole AgentV3 dir (safeguard #6 lapse).
  `cookie-httponly-false` (also batch 27) is KEPT — it is complementary: Compliance's
  `cookie-no-httponly` checks for ABSENCE of httponly and so misses an explicit `httpOnly:false`.
- **Added** `samesite-none-insecure` (medium) — a cookie with `sameSite:'none'` and no
  `secure:true` on the line: modern browsers silently REJECT it (cookie never set → auth
  breaks) and None alone drops CSRF protection. SameSite=None+Secure and Lax/Strict not flagged.
  Verified absent from both SecurityAnalysis and ComplianceAnalysis before adding.

Gate: server tsc 0, frontend tsc 0, **2294 vitest** PASS (51 SecurityAnalysis tests).

---

### 2026-06-25 — Section I march (batch 29): document.domain write + iframe sandbox escape (DOM security)

Batch 28 merged to main 4ecdf6f (PR #379). New `SecurityAnalysis` DOM-security rules (both
verified absent across the whole AgentV3 dir before adding — tightened redundant-work check
after the batch-27 overlap):

1. **document-domain-write** (medium) — assigning `document.domain` relaxes the same-origin
   policy (any sibling subdomain can script into the page) and is deprecated. `=(?!=)` matches
   assignment, not a comparison.
2. **iframe-sandbox-escape** (medium) — an `<iframe sandbox>` allowing BOTH `allow-scripts` and
   `allow-same-origin` can remove its own sandbox and escape it. Two lookaheads require both
   tokens in the same sandbox value (order-independent); allow-scripts alone is not flagged.

Gate: server tsc 0, frontend tsc 0, **2296 vitest** PASS (53 SecurityAnalysis tests, +2 new).

---

### 2026-06-25 — Section I march (batch 30): weak bcrypt rounds + trust-proxy:true (security)

Batch 29 merged to main 844c1d5 (PR #380). New `SecurityAnalysis` rules (verified uncovered
across the whole AgentV3 dir):

1. **weak-bcrypt-rounds** (medium) — a bcrypt cost factor below 10 (single-digit rounds in
   `bcrypt.hash(data, N)` or `genSalt(N)`) hashes too fast → cheap brute-force of stolen
   hashes. 10+ (two digits) or a variable is not flagged.
2. **express-trust-proxy-true** (medium) — `app.set('trust proxy', true)` trusts X-Forwarded-For
   from any client (IP spoofing → defeats rate limiting / audit logs). A specific hop count or
   proxy IP is not flagged.

Gate: server tsc 0, frontend tsc 0, **2298 vitest** PASS (55 SecurityAnalysis tests, +2 new).

---

### 2026-06-25 — Section I march (batch 31): scope-on-td + deprecated marquee/blink (a11y)

Batch 30 merged to main 453c1dc (PR #381). New `AccessibilityAnalysis` rules (verified
uncovered; scoped to avoid custom-component false positives):

1. **scope-on-td** (medium) — a `scope` attribute on a `<td>` is ignored (scope is only valid
   on a `<th>`); the cell was meant to be a header (axe "scope-attr-valid"). Scoped to td to
   avoid flagging custom JSX components that happen to take a `scope` prop.
2. **deprecated-marquee-blink** (medium) — `<marquee>`/`<blink>` auto-move/flash content with no
   pause (WCAG 2.2.2) and are dropped by modern browsers.

Gate: server tsc 0, frontend tsc 0, **2300 vitest** PASS (30 AccessibilityAnalysis tests, +2 new).

---

### 2026-06-25 — Section I march (batch 32): empty <th> header + empty <label for> (a11y)

Batch 31 merged to main f967a23 (PR #382). New `AccessibilityAnalysis` rules (parallel to the
empty-heading pattern; verified uncovered):

1. **empty-table-header** (medium) — a `<th>` with no text leaves its row/column unlabeled for
   screen-reader table navigation (WCAG 1.3.1). Child tags stripped (`<th><Icon/></th>` flagged);
   text or aria-label accepted.
2. **empty-label** (medium) — an explicit `<label for="…">` with NO content gives the associated
   control no accessible name. Only the truly-empty form (no children at all) is flagged, so a
   wrapping `<label><input/>…</label>` is never a false positive.

Gate: server tsc 0, frontend tsc 0, **2302 vitest** PASS (32 AccessibilityAnalysis tests, +2 new).

---

### 2026-06-25 — Section I march (batch 33): dynamic iframe srcdoc + data:text/html URI (XSS sinks)

Batch 32 merged to main 84dab44 (PR #383). New `SecurityAnalysis` rules (verified uncovered):

1. **iframe-srcdoc-dynamic** (medium) — `<iframe srcdoc={…}>` (JSX expression or template-literal
   interpolation) renders the value as a full HTML document in the frame — an XSS sink like
   innerHTML. A static quoted srcdoc is not flagged.
2. **data-html-uri** (medium) — a `data:text/html` URI in href/src is parsed as an HTML document
   and runs inline script when opened (XSS/phishing, CSP bypass). A normal URL or data:image is
   not flagged.

Gate: server tsc 0, frontend tsc 0, **2304 vitest** PASS (57 SecurityAnalysis tests, +2 new).

---

### 2026-06-25 — Section I march (batch 34, POLISH): insecure-http false-positive fix (namespace URIs)

Admin redirected the march from "add new detection rules" (engine is now comprehensive — 44
checks; candidates coming up already-covered) to "polish existing checks (fewer FPs, audit
overlaps)". First polish:

- **insecure-http FP fix** — the rule flagged ANY `http://` string, including XML/SVG namespace
  & schema URIs (`xmlns="http://www.w3.org/2000/svg"`, `http://www.w3.org/1999/xhtml`,
  `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"`). These are IDENTIFIERS, never network
  endpoints — so every inline SVG was a noisy false positive. Added a NAMESPACE_HTTP ignore
  (xmlns attributes + known namespace authorities: w3.org, xmlns.com, purl.org, schemas.*,
  ns.adobe.com, inkscape.org, sodipodi). A real http endpoint on a similar line is still flagged.

Gate: server tsc 0, frontend tsc 0, **2305 vitest** PASS (58 SecurityAnalysis tests, +1 new).

---

### 2026-06-25 — Section I march (batch 35, POLISH): hardcoded-secret + eval-usage false-positive fixes

Batch 34 polish merged to main 588133b (PR #385). Two more FP reductions in SecurityAnalysis:

1. **hardcoded-secret** — the value is now 8+ NON-whitespace chars (`[^'"`\s]{8,}`). A real
   credential has no spaces, so this drops the common FP of a validation/UI message
   (`password = "Password must be 8 characters"`). A space-free credential is still flagged.
2. **eval-usage** — added the `(?<![.\w])` lookbehind so member methods named eval
   (mathjs `math.eval(...)`, MongoDB `db.eval(...)`) are NOT flagged; only the dangerous global
   `eval(...)` is.

Gate: server tsc 0, frontend tsc 0, **2306 vitest** PASS (59 SecurityAnalysis tests, +2 new).

---

### 2026-06-25 — Section I march (batch 36, POLISH): overlap audit + dedup 2 redundant rules

Batch 35 polish merged to main ddf8a59 (PR #386). Ran a systematic cross-analyzer overlap
audit (subagent mapped all rule kinds/regexes across 12 analyzers). Findings:

- **CONFIRMED redundancies removed** (both ran alongside SecurityAnalysis in `evaluate`, so the
  same line was reported twice):
  1. SecurityConfigAnalysis `tls-verification-disabled` — exact duplicate of SecurityAnalysis
     `disable-tls-verification`.
  2. SecurityConfigAnalysis `insecure-randomness` — SecurityAnalysis `insecure-random-token` is a
     proven SUPERSET (its SECURITY_CONTEXT keyword set ⊇ this rule's keywords). No coverage lost
     (SecurityAnalysis's 59 tests still cover both); SecurityConfigAnalysis now owns CORS +
     logged-secret only.
- **Refuted (kept as complementary, NOT duplicates):** insecure-http vs insecure-http-endpoint
  (any URL string vs http network call); cookie-httponly-false vs cookie-no-httponly (explicit
  false vs absence — verified in batch 28); provider-token vs env-template secret detection
  (source code vs .env templates).

Gate: server tsc 0, frontend tsc 0, **2301 vitest** PASS (SecurityConfigAnalysis 11 tests).

---

### 2026-06-25 — Section I march (batch 37, POLISH): HardcodedUrl skip test/config files (FP fix)

Batch 36 polish merged to main f726674 (PR #388). FP fix in HardcodedUrlAnalysis:

- The localhost/private-IP scanner had no path filter, so it false-flagged `http://localhost`
  in TEST files (hitting a local test server) and BUILD-CONFIG files (e.g. a Vite dev-server
  `proxy: { '/api': 'http://localhost:3000' }`) — neither of which ship to production. Added a
  SKIP_PATH (`.test.`/`.spec.`/`__tests__`/`tests`/`e2e` dirs, `*.config.[cm]?[jt]s`, and
  vite/vitest/playwright/webpack/next config + setupTests). A normal source file is still scanned.

Gate: server tsc 0, frontend tsc 0, **2302 vitest** PASS (HardcodedUrlAnalysis 11 tests, +1 new).

---

### 2026-06-25 — Section I march (batch 38, POLISH): redundant-role no longer flags <ul role=list>

Batch 37 polish merged to main 7628437 (PR #389). FP/harmful-advice fix in AccessibilityAnalysis:

- The batch-21 `redundant-role` rule flagged `<ul role="list">` / `<ol role="list">` as redundant.
  But that is a well-known LEGITIMATE fix: when `list-style: none` is applied, Safari + VoiceOver
  stop announcing the element as a list, and re-adding role="list" restores it. Flagging it would
  tell the dev to remove a role that is actually needed — actively harmful advice. Removed ul/ol
  (and li) from the IMPLICIT_ROLE map; unambiguous mappings (button/a/nav/main/table/textarea/
  h1-6) still flag redundant roles.

Gate: server tsc 0, frontend tsc 0, **2302 vitest** PASS (AccessibilityAnalysis 32 tests, +1 assertion).

---

### 2026-06-25 — Section I march (batch 39, POLISH): cookie-deletion not flagged for missing SameSite/Secure

Batch 38 polish merged to main c2f1f98 (PR #390). FP fix in ComplianceAnalysis:

- The cookie-no-samesite / cookie-no-httponly / cookie-no-secure rules flagged a cookie being
  DELETED (logout/clear flows: `document.cookie = 'sid=; Max-Age=0'`, `res.cookie('n','',{maxAge:0})`,
  a 1970 expiry) for missing those flags. But a cookie being removed does not need them — the
  browser is deleting it, not storing it. Added an isCookieDeletion guard (Max-Age 0/-1 or a
  1970/past expiry) that skips all three cookie checks. Normal cookie SETS are still flagged.

Gate: server tsc 0, frontend tsc 0, **2303 vitest** PASS (ComplianceAnalysis 19 tests, +1 new).

---

### 2026-06-25 — BYOK (user's own Anthropic key) REMOVED per admin

Admin (aashishcpmt09) confirmed BYOK was deliberately removed earlier and must NOT be
re-introduced or re-proposed. There was never any Anthropic-BYOK code (ClaudeClient always
uses the platform's own ANTHROPIC_API_KEY); BYOK existed only as forward-looking doc
references. Removed those references so no future session rebuilds it:
- CLAUDE.md §"NavBharatAI Pro v3.0" — replaced the "future BYOK option stays open" line with an
  explicit "BYOK is NOT a feature, do not build/re-propose" rule.
- NAVBHARATAI_PRO_V3_DESIGN.md — D2, D7, §5.1 persistence, §"requirements" updated: v3.0 always
  runs on NavBharatAI's own account; transcript persistence is NavBharatAI-hosted
  (`ConversationStore`); no "transcript on the user's Claude" option.
- This file's "Remaining/next" line — dropped "BYOK option".

IMPORTANT — this is ONLY about Bring-Your-Own-*Key* (Anthropic). Bring-Your-Own-*Database*
(Engineer AI Phase 14, BackendScaffolder) and the BYO E2B sandbox key are SEPARATE, KEPT
features and were not touched. Historical PROGRESS entries (D7 decision, BYOK quota tier) are
left intact per the append-only rule; this note supersedes them.

NEXT: build conversation persistence (ConversationStore, D7) — the admin's chosen target.

---

### 2026-06-25 — v3.0 conversation persistence P-A: ConversationStore foundation (D7)

Admin chose "conversation persistence" as the next v3.0 target (and BYOK removed, prior note).
First increment — the storage CONTRACT + reference implementation (not yet wired into AgentRunner;
no behaviour change to the flag-gated v3.0 path):

- NEW `src/server/AgentV3/ConversationStore.ts`:
  - `ConversationRecord` (id, userId, workspaceId, title, status, VERBATIM messages transcript,
    usage, billedUsd, timestamps) — the durable form of an AgentRunner build so it survives a
    reconnect/refresh.
  - `ConversationStore` interface (create/get/appendMessages/update/listByUser/remove), all async
    so a Firestore backend drops in with no signature change.
  - `InMemoryConversationStore` — dev/CI impl + reference semantics; stores CLONES so callers
    cannot mutate persisted state through a returned reference. `deriveTitle()` helper.
- Persistence is NavBharatAI-hosted only (D7, post-BYOK-removal). NEXT (P-B): wire into
  AgentRunner (create on start, append each turn, finalize on end) + route load/list; then
  (P-C) a Firestore-backed ConversationStore for real durability.

Gate: server tsc 0, frontend tsc 0, **2314 vitest** PASS (11 new ConversationStore tests).

---

### 2026-06-25 — v3.0 conversation persistence P-B: wire ConversationStore into AgentRunner (D7)

P-A merged (PR #393, f896199). P-B wires the store into the build loop:

- `AgentRunnerOptions.persistence` (optional): `{ store, conversationId, userId, workspaceId, title, now? }`.
  When present, AgentRunner: creates the record at start (seed transcript); appends each turn
  (assistant + tool_results) with a `running` checkpoint so a reconnect resumes mid-build, not
  from scratch; and finalizes with the terminal status — `complete` (model ended), `stopped`
  (user abort / budget cap / step cap), or `error` (exception) — plus the latest usage + billedUsd.
- ALL persistence calls are best-effort (wrapped in try/catch): a store failure is swallowed and
  NEVER breaks the build. When `persistence` is absent, behaviour is byte-for-byte unchanged
  (back-compat verified by test).

Gate: server tsc 0, frontend tsc 0, **2318 vitest** PASS (4 new AgentRunner persistence tests).
NEXT (P-C): a Firestore-backed ConversationStore + route load/list/resume endpoints.

---

### 2026-06-25 — v3.0 conversation persistence P-C: Firestore-backed ConversationStore (D7)

P-B merged (PR #394, 53863f6). P-C adds the durable backend:

- NEW `src/server/AgentV3/FirestoreConversationStore.ts` — mirrors the proven FirestoreJobStore
  pattern (firebase-admin init + databaseId from firebase-applet-config.json). Avoids Firestore's
  1 MB/doc limit: metadata in `agentv3_conversations/{id}`, transcript in an append-only `turns`
  subcollection (one doc per appendMessages, monotonic `seq`); get() reassembles the transcript
  in order. listByUser returns metadata only (empty messages) — cheap listing; get(id) for the
  full build. The Firestore handle is INJECTABLE.
- Because the handle is injectable, this is UNIT-TESTED via a compact faithful in-memory fake of
  the narrow Firestore surface (nested docs/subcollections, get/set-merge/update, where+orderBy+
  limit, runTransaction, batched delete) — 7 tests proving create/get-reassembly/append-ordering/
  unknown-id throws/finalize/list-scope-order-cap/remove. (More rigorous than the existing
  FirestoreJobStore, which is integration-only.) ConversationStore.listByUser contract doc
  updated to allow an empty transcript in list results.

Gate: server tsc 0, frontend tsc 0, **2325 vitest** PASS (7 new FirestoreConversationStore tests).
NEXT (P-D): wire store selection (Firestore when available, else in-memory) into the agentv3
route + load/list/resume endpoints — completing the end-to-end "build survives refresh" feature.

---

### 2026-06-25 — v3.0 conversation persistence P-D: route wiring + load/list endpoints (D7)

P-C merged (PR #395, 8c6b909). P-D wires persistence into the live build route (additive, flag-gated):

- `getConversationStore()` singleton — Firestore when `AGENTV3_PERSIST_FIRESTORE=true` (real
  cross-instance durability in Cloud Run), else InMemory (dev/CI safe default; missing creds never
  error). Matches the cautious v3.0 flag-gating.
- The main build runner in `POST /api/agentv3/chat` now passes `persistence` (store +
  fresh conversationId + userId + workspaceId + deriveTitle(prompt)) → each build is saved as it
  runs (best-effort; a store failure never breaks the build).
- NEW `GET /api/agentv3/conversations?userId=` (list a user's builds, metadata only) and
  `GET /api/agentv3/conversations/:id?userId=` (load full transcript for resume) — both
  flag-gated; the single-fetch is OWNER-ONLY via the exported pure `conversationAccess(rec, userId)`
  helper (ok / not-found / forbidden), unit-tested.

Backend persistence is now END-TO-END: a build is persisted as it runs and reloadable by API.
Gate: server tsc 0, frontend tsc 0, **boot:check PASS**, **2326 vitest** PASS (1 new route test).
NEXT (P-E, frontend): on load/reconnect, useAgentV3Build lists by userId + reloads the most recent
build's transcript into the panel — the last step to make "build survives refresh" user-visible.

---

### 2026-06-25 — v3.0 conversation persistence P-E: frontend reload of chat history (D7) — FEATURE COMPLETE

P-D merged (PR #396, 4bdaf55). P-E (admin chose option (a): chat + git-restore) makes the
persistence user-visible:

- NEW `src/components/agentv3/agentV3History.ts` (pure, tested): `messageText()` extracts visible
  text from a Claude message (string or block array); `conversationToEvents(conv)` turns a
  persisted build into wire events (workspace + one narration per assistant turn + a `done` for a
  finished build; a still-running build is left open so it can be Resumed). Replayed through the
  existing agentV3Reducer → rebuilds the narration feed + workspaceId with no new reducer logic.
- `useAgentV3Build.loadConversation(opts)` — fetches the user's most recent persisted build
  (list → by-id) and folds its events into state. Best-effort; no-op while running.
- `AgentV3Panel` — a one-time mount effect calls loadConversation when signed in, idle, and the
  panel is empty, so a refresh/reconnect re-displays the last build's chat. Never clobbers a live
  build or a History-opened thread. Files come back via the existing git/restore path.

Conversation persistence (D7) is now END-TO-END: P-A store contract → P-B AgentRunner wiring →
P-C Firestore backend → P-D route + endpoints → P-E frontend reload. A v3.0 build survives a
refresh/reconnect.
Gate: server tsc 0, frontend tsc 0, **2334 vitest** PASS (8 new agentV3History tests).

---

### 2026-06-25 — v3.0 build speed: capped-parallel review/test sub-agents (admin-requested)

Admin asked: testing/review agents run one-by-one after a build — run them in parallel (with the
three caveats: rate-limit cap, find-parallel/fix-serial, model must batch). Implemented:

- `AgentRunner` tool execution is now TWO-PHASE per turn: mutating tools (write/edit/bash, todo/
  preview, generators, builder sub-agents) run SERIALLY and first; read-only tools + REVIEW-only
  sub-agents (qa, security, performance, accessibility, reviewer, researcher, monitor) then run in
  a concurrency-CAPPED parallel group. Results keep original order (tool_use ids resolve).
  - `isParallelSafeToolUse()` (exported, tested) classifies: read-only tool names + review roles =
    parallel; everything that can mutate = serial ("find in parallel, fix serially").
  - `mapWithConcurrency()` caps in-flight; `AgentRunnerOptions.toolConcurrency` (default 4),
    route-wired from `AGENTV3_TOOL_CONCURRENCY` env → keeps concurrent Claude calls rate-safe.
- Architect system prompt: added "VERIFY IN PARALLEL" guidance — spawn independent review agents
  in ONE turn (multiple task calls) so they actually parallelize, then assign fixes one file at a
  time so fixes never collide.

Effect: the review/verify phase (qa+security+performance+a11y+reviewer) now runs ~concurrently
instead of serially → roughly halves that phase, while builds/fixes stay safe (serial).
Gate: server tsc 0, frontend tsc 0, boot:check PASS, **2337 vitest** PASS (3 new parallel-exec tests).

---

### 2026-06-25 — v3.0 UI: harden the "working…" status spinner (admin-reported freeze)

Admin reported the v3.0 "working…" pre-output spinner not rotating. Verified the `animate-spin`
utility itself compiles correctly (`.animate-spin{animation:var(--animate-spin)}` + `--animate-spin:
spin 1s linear infinite` + `@keyframes spin` all present), so the class isn't globally broken — the
realistic culprits for that one element are the global `prefers-reduced-motion` reset
(`*{animation-duration:.01ms!important}`) interacting with the cascade, or stale cached code.

Fix: added a dedicated `.nb-spin` class — `animation: spin 1s linear infinite !important` +
`transform-origin:center` — that wins over the reduced-motion reset (class specificity + !important)
and restates the FULL shorthand so no property is dropped. Applied to the "working…" indicator and
the AI-team chip rings. Compiled CSS confirms `.nb-spin{transform-origin:50%!important;animation:1s
linear infinite spin!important}`.
Gate: frontend tsc 0, **2355 vitest** PASS (frontend-only; no server change). NOTE: if it still
looks frozen after deploy, it's the browser serving cached JS/CSS — hard-refresh (the header 'b:'
build stamp confirms which build is live).

---

### 2026-06-25 — Auth: fix misleading Google sign-in diagnosis (admin-reported login failure)

Admin reported Google login failing with `[auth/internal-error]` and the app showing "Sign-in is
disabled — provider turned off". Root cause of the MESSAGE (not the login itself): the app's
diagnostic probe (`diagnoseAuth` → anonymous `signUp`) returns `ADMIN_ONLY_OPERATION` on a healthy
project where anonymous auth is off (the normal default), and `explainAuthReason` wrongly lumped
`ADMIN_ONLY_OPERATION` together with `OPERATION_NOT_ALLOWED` → "provider turned off". The author's
own comment noted ADMIN_ONLY_OPERATION "would actually mean the auth backend is fine" — the mapping
contradicted it. (Tell: a cleanly-disabled provider throws `auth/operation-not-allowed`, handled
separately; `auth/internal-error` points to the Google provider's OWN config.)

Fix (code): extracted `explainAuthReason` into `src/lib/authDiagnostics.ts` (pure, unit-tested) and
split `ADMIN_ONLY_OPERATION` into its own branch with an HONEST, actionable message — "backend+key
work; check the Google provider's OAuth client + support email + Identity Toolkit API + authorized
domains". AuthComponent now imports it. 6 new tests.

NOTE (admin action, NOT code — I can't access Firebase Console): the actual login fix for
`auth/internal-error` on project gen-lang-client-0866594388 is in Console — see the chat checklist
(Google provider enabled + support email + OAuth Web client + Identity Toolkit API + authorized
domains + API-key referrers).
Gate: frontend tsc 0, server tsc 0, **2361 vitest** PASS (6 new authDiagnostics tests).

---

### 2026-06-25 — Auth: CSP was blocking Google sign-in (the REAL root cause)

Admin's Google login failed with `auth/internal-error`. Browser console revealed the true cause:
`Loading the script 'https://apis.google.com/js/api.js' violates the Content Security Policy
directive: "script-src 'self' 'unsafe-inline' 'unsafe-eval'". The action has been blocked.`

So it was NEVER a Firebase-provider/OAuth problem (provider enabled, web client + secret + redirect
URIs all correct, verified by admin screenshots). Our own helmet CSP in server.ts omitted Google's
auth script origins from `script-src`, so the browser blocked gapi (`apis.google.com/js/api.js`) and
Firebase Auth surfaced a bare `auth/internal-error`. (The CSP comment already accounted for the auth
IFRAME via frameSrc but missed the auth SCRIPT.)

Fix: added `https://apis.google.com` (gapi, Google popup/redirect) + `https://www.gstatic.com` +
`https://www.google.com` (phone-OTP reCAPTCHA) to `scriptSrc`. Verified by booting the server and
curling the live `Content-Security-Policy` header — it now includes all three. connectSrc (`https:`)
and frameSrc (`https:`) already covered identitytoolkit + the auth handler iframe.
Gate: server tsc 0, frontend tsc 0, boot:check PASS, **2361 vitest** PASS. Ships on merge → deploy.

---

### 2026-06-25 — AgentV3 v3.0: surgical edit engine (PR #409)

Problem: when a v3.0 user asked to CHANGE an existing app ("fix the navbar", "update the button
colour", "refactor auth"), the engine treated it identically to "build me a new app" — it defaulted
to `write_file` (full overwrite) and rebuilt everything from scratch, wiping the user's existing files.

Root cause: `classifyIntent` returned the same `'build'` for both new builds and edits; both got the
identical `architectSystemPrompt()` ("create real, complete source files"); no file-tree context and
no instruction to read-first / patch surgically.

Fix (real, end-to-end), built on already-existing infra (stable sessionId→workspaceId, sandbox VFS,
read_file/edit_file/grep/glob, WorkspaceMemory project graph):
- `IntentClassifier`: `'chat' | 'build'` → `'chat' | 'new_build' | 'edit_existing'`. New-build signals
  win over edit signals; conservative default stays a build intent.
- `systemPrompt.editModePrefix(fileTree)`: locate-first (grep/glob), read-before-write, prefer
  edit_file over write_file, minimum changes, preserve existing logic, never rebuild from scratch.
- `routes/agentv3.ts`: on an edit turn WITH real files, inject the live file tree + edit prefix and
  narrate the edit; empty/failed workspace falls back to the normal build prompt.
- `ToolDispatcher`: write_file nudges toward edit_file when it overwrites an existing file.

Gold-standard polish (same PR):
- (A) `warmIndexFiles` — pre-index persisted sandbox files into project memory when memory is cold
  (process restarted), so recall/evaluate see the existing codebase immediately on a resumed edit.
- (B) grep/glob "LOCATE FIRST" guidance in the edit prompt.
- (C) `applyEdit` — edit_file now has a whitespace-tolerant fallback (still unique-or-error), so a
  patch whose indentation is slightly off still applies; the diff shows the verbatim replaced text.

AppKnowledgeBase: documented the surgical-edit capability + keywords (mandatory sync rule).
Gate: frontend tsc 0, server tsc 0, **2400 vitest** PASS (32 new tests across IntentClassifier,
systemPrompt, ToolDispatcher/applyEdit, WorkspaceMemory/warmIndexFiles). Ships on merge → deploy.

---

### 2026-06-25 — v3.0 feature port #1: web_search tool (admin: bring old-engine features into v3.0)

Admin wants the best old-engine features COPIED into v3.0 (self-contained, so v3.0 owns them and
they survive the planned deletion of the old engines). Old engines NOT deleted yet (admin will
trigger that tomorrow). Each feature = its own additive PR; nothing live touched.

PR #1 — `web_search` tool:
- NEW `src/server/AgentV3/WebSearch.ts` — self-contained copy of Engineer AI's WebSearchClient,
  strict-typed (the source lives outside the strict tsconfig; cleaned the `any`s). Brave (if
  BRAVE_API_KEY) → DuckDuckGo fallback → npm registry for package queries. Degrades to "no results",
  never throws. `makeWebSearch()` factory + `formatSearchResults`/`parseDuckDuckGo` (tested).
- Wired like second_opinion/consensus: ToolName + ToolCatalog def + CATALOG_TOOL_NAMES +
  ToolDispatcher `web_search` case (injected fn) + architect tool-set + index export + route
  injects makeWebSearch() into the dispatcher + architect prompt guidance.
- NO old-engine coupling added (WebSearch.ts is a v3.0-owned copy; the original is untouched and
  still deletable later).

Gate: server tsc 0, frontend tsc 0, boot:check PASS, **2452 vitest** PASS (6 new WebSearch tests).
NEXT: screenshot/browser_action, deploy, generate_tests (each its own PR).

---

### 2026-06-25 — v3.0 feature port #2: screenshot + browser_action + console_errors (agent gets eyes)

PR #2 of the old-engine feature ports. Gives v3.0 the ability to SEE and TEST the app it builds —
the single biggest capability gap vs Engineer AI.

- ActuatorPort extended with OPTIONAL `screenshot`, `browserAction`, `getConsoleErrors` (the real
  IEngineerActuator/E2BActuator already implement them; Local/Docker degrade honestly).
- VISION PASSTHROUGH (real "agent sees"): ToolResult gained an optional `image`; ToolDispatcher
  routes screenshot/browser_action through `runVisual()` which returns {content, image}; AgentRunner
  feeds the screenshot back to the model as an Anthropic image content-block in the tool_result, so
  the model actually inspects the rendered page (not just text). Parallel-safe (image flows through
  the return value, no shared state).
- 3 new tools: `screenshot` (capture+see a URL, optional viewport for responsive), `browser_action`
  (click/type/navigate/scroll/hover/etc. — persistent session for multi-step flows, returns result+
  screenshot), `console_errors` (runtime browser errors a build never reveals). Wired: types +
  catalog defs + CATALOG_TOOL_NAMES + dispatcher + architect tool-set + architect prompt ("verify
  visually; fix what you see; never fake the verification").
- Honest fallback: on Local/Docker (no E2B) the tools return "requires a real sandbox", never a fake
  success. No old-engine import added (uses the actuator v3.0 already holds via the ActuatorPort).

Gate: server tsc 0, frontend tsc 0, boot:check PASS, **2458 vitest** PASS (6 new browser-tool tests).
NEXT: deploy tool, generate_tests tool.

---

### 2026-06-25 — v3.0 feature port #3: deploy tool (real persistent Firebase Hosting)

PR #3 of the old-engine feature ports. v3.0 can now SHIP — publish a built app to a permanent
public URL (not just the ephemeral dev-server preview).

- NEW `src/server/AgentV3/Deployment.ts` — v3.0-owned copy of Engineer AI's DeploymentService
  (Firebase Hosting REST + ADC auth, SHA-dedup upload, SPA rewrite + immutable asset caching).
  Channel id prefixed `v3-`. `makeDeploy()` factory + `DeployFn` type + `makeChannelId` (tested).
- ActuatorPort extended with optional `downloadDistFiles`; `deploy` tool case: pulls dist/ from the
  sandbox → deploys → emits a preview event → returns the permanent URL. Honest refusals: no dist
  ("run npm run build first"), no sandbox ("requires E2B"), deploy unconfigured.
- Wired: ToolName + catalog def + CATALOG_TOOL_NAMES + dispatcher (injected DeployFn) + architect
  tool-set + index export + route injects makeDeploy() + architect prompt ("deploy when asked;
  never claim deployed unless deploy returned a URL"). Uses ADC (Cloud Run service account); a 403
  means the SA needs the Firebase Hosting Admin role. No old-engine import added.

Gate: server tsc 0, frontend tsc 0, boot:check PASS, **2464 vitest** PASS (6 new deploy tests).
NEXT: generate_tests tool (last of today's ports).

---

### 2026-06-25 — v3.0 feature ports COMPLETE (3 of 5) + generate_tests intentionally SKIPPED

Admin asked to copy the best old-engine features INTO v3.0 (self-contained, so v3.0 owns them and
they survive the planned deletion of the old engines). DELETION NOT done yet — admin triggers that
separately (next day). Shipped today, each its own additive PR (no live path touched, old engines
untouched):

- #411 `web_search` — Brave→DuckDuckGo→npm (WebSearch.ts, v3.0-owned).
- #412 `screenshot` + `browser_action` + `console_errors` — agent VISION + interactive testing
  (ActuatorPort optional methods + image-passthrough so the model truly SEES the page).
- #413 `deploy` — real persistent Firebase Hosting (Deployment.ts, v3.0-owned).

These three were the genuine capability gaps (see/search/ship). All wired through types + catalog +
dispatcher + architect tool-set + index + route + prompt, with honest "requires a real sandbox"
fallbacks. None adds an import from EngineerAI/AppMakerLab/pro → v3.0 stays deletion-ready.

INTENTIONALLY SKIPPED (the "ulta bekar"/duplication cases, per admin's own guidance + the speed goal):
- `generate_tests` (ProTestGen) — REDUNDANT: the v3.0 agent already writes tests with write_file
  (under its control + normal billing) and `evaluate`/TestCoverageAnalysis already flags untested
  files. A separate test-gen pipeline fires extra AI calls OUTSIDE the agent loop → SLOWER builds,
  which directly contradicts the admin's "fast" goal AND the architect prompt's existing
  "a working preview is the goal, not a green test suite; don't block on tests" philosophy. Do NOT
  re-port it unless admin explicitly asks.
- `context file-ranking` (ContextRetriever) — mostly OVERLAPS v3.0's existing grep/glob/recall.
  Low marginal value; skipped to avoid bloat.

Also SKIPPED earlier (architecture conflicts, do not port): ProCodeReview (evaluate is superior),
ErrorPatternMatcher (RecalledLessons better), BackendProvisioner/TemplateRegistry as features,
ProComplexity, WorkspaceMutationEngine/VFS, Engineer AI's ReAct loop, tar.gz checkpoint tool.

NEXT (admin-triggered, NOT today): independence move (extract actuators + helpers + scaffold to
src/server/sandbox/, see the 2026-06-25 hard-audit) → then delete EngineerAI/AppMakerLab/pro.

---

### 2026-06-25 — v3.0 BUGFIX: preview "Blocked request … is not allowed" (Vite allowedHosts)

Admin hit a live v3.0 preview showing: `Blocked request. This host ("5174-…e2b.app") is not
allowed. Add it to server.allowedHosts in vite.config.` Root cause: newer Vite enforces a host
allow-list; the sandbox proxy host (<port>-<id>.e2b.app) isn't in it, so Vite blocks the request and
the preview shows the error instead of the app. `allowedHosts` was set NOWHERE in the codebase.

Fix (two places, since the agent sometimes writes its own vite.config):
- Default scaffold `ViteReactProviderContents.viteConfig`: added `allowedHosts: true` to BOTH
  `server` and `preview`.
- Architect system prompt: added a CRITICAL instruction to always set server/preview allowedHosts:true
  for Vite, and that a "Blocked request … is not allowed" preview is ALWAYS fixed by allowedHosts:true.
- Regression test (ScaffoldPreview.test.ts) asserts both the scaffold config and the prompt carry it.

Gate: server tsc 0, frontend tsc 0, boot:check PASS, **2466 vitest** PASS (2 new).

NOTE: the same session also showed a reviewer "0/100 — missing all source code" right after the agent
claimed it wrote 7 files; that looks like a separate workspace-state hiccup (the build started on an
"empty directory" and recreated the scaffold mid-run). Not reproduced/fixed here — flagged for
follow-up if it recurs; the concrete, reproducible preview-block bug is fixed above.

---

### 2026-06-25 — v3.0 BUGFIX: reviewer's false "0/100 — missing all source code"

Same live session as the allowedHosts bug: after the agent built a working app (7 files; dev server
was running on :5174), the post-build ReviewerAgent reported "[CRITICAL] missing all the necessary
source code. Score: 0/100". Root cause (route ~L986): the reviewer reads the workspace via
`actuator.listFiles(workspaceId)`; that came back EMPTY (a sandbox read hiccup — the files genuinely
exist, the dev server proves it), so reviewBuild got `fileTree:[]` and the reviewer model declared the
app had no code. A false negative that contradicts the build the user just watched succeed.

Fix (ReviewerAgent.ts): added `hasReviewableSource(fileTree)` (exported, pure) and a defensive
early-return in `reviewBuild` — when the listing has no real source files, it returns a neutral
skipped result (score 0, passed:true, no issues) WITHOUT spawning the reviewer. `formatReview`
already emits '' for score 0, so the user sees nothing instead of a scary, wrong "0/100". The build
result is never affected (review is advisory). Updated one existing parse-test to pass a source file
(it tests parsing, not the empty case).

Gate: server tsc 0, frontend tsc 0, **2468 vitest** PASS (3 new reviewer-guard tests).
NOTE: the underlying "listFiles returned empty when files exist" is an E2B read-reliability issue
(can't reproduce without E2B here) — this fix removes the user-visible false verdict; flagged for
follow-up if the empty-listing recurs.

---

### 2026-06-25 — v3.0 BUGFIX: durable file persistence (files no longer vanish)

Admin: v3.0 built 7 files, then on the next (edit) message they all vanished; Files(0)/Diff(0) in the
UI; reviewer said "missing all source code". Root cause: the sandbox is EPHEMERAL and v3.0 persisted
only the MEMORY snapshot (file-list hints + episodes), NOT the file CONTENT — so a lost/recycled or
fresh-next-message sandbox had nothing to restore from. (History(7) showed git commits, proving the
files WERE written; a flaky listFiles + no content-restore = "gayab".)

Fix — capture-at-write + Firestore + restore (admin OK'd "hamare firebase ke db me"):
- NEW `WorkspaceFileStore.ts` — Firestore-backed durable file store (collection `workspace_files_v3`,
  one doc per file in a `files` subcollection to dodge the 1MB limit; a metadata `paths` list is
  authoritative so deleted files don't resurrect). Mirrors FirestoreWorkspaceMemoryStore (VITEST-skip,
  best-effort, never throws). `fileDocId` (base64url, slash-free).
- `ToolDispatcher` — new optional `onFileWrite(path, content)` fired on every successful write_file/
  edit_file with the FINAL content. Reliable capture straight from the write op — does NOT depend on
  the sometimes-empty listFiles.
- Route: a per-build `writtenFiles` accumulator feeds onFileWrite; at build END it saves the union of
  captured writes (reliable) + a sandbox scan (supplement) to Firestore, skipping if BOTH are empty
  (so a read hiccup never overwrites a good saved set). At build START, if the sandbox came up empty,
  it restores the persisted files into it and narrates "Restored N file(s) from your previous session."

Effect: a build's source survives sandbox loss + carries across messages → no more "files gayab".
Gate: server tsc 0, frontend tsc 0, boot:check PASS, **2473 vitest** PASS (5 new tests).
NOTE: requires Firestore (Cloud Run ADC) — works automatically in prod; VITEST/local = best-effort no-op.

---

### 2026-06-25 — v3.0 git-native storage PHASE 1: GitHubAppClient (admin-approved roadmap)

Admin approved the plan to make v3.0 git-native (files live in a real GitHub repo = durable, ~free,
no Firestore bill, enables CI/merge). Admin completed PHASE 0: created org `navbharatai-apps`,
registered the "NavBharatAI Builder" GitHub App (App ID 4146547; perms Contents/PRs RW, Checks/Admin),
installed it on the org, and set Cloud Run secrets GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY / GITHUB_ORG.

PHASE 1 (this PR) — `GitHubAppClient.ts` (standalone, flag-gated OFF, NOT wired to the build path yet):
- App auth with zero new deps (Node crypto RS256 JWT + fetch): sign App JWT → org installation id →
  installation access token (cached). `ensureRepo(name)` (GET-or-create, idempotent, private+auto_init),
  `authedCloneUrl` (token-embedded git URL). `githubConfigFromEnv()`/`githubStorageEnabled()` (null/false
  until all 3 secrets present → storage stays off), `repoNameForProject()` (deterministic, GitHub-safe).
- Fully unit-tested (7 tests) incl. a REAL RSA keypair verifying the JWT signature + fake-fetch for the
  installation/token/repo endpoints (reuse vs create). No live-path coupling → current v3.0 unaffected.

Gate: server tsc 0, frontend tsc 0, boot:check PASS, **2503 vitest** PASS (7 new).
NEXT (Phase 2): wire into the build loop — clone the repo into the sandbox at start, commit+push at
build end → git becomes the source of truth (replaces the ephemeral-sandbox file loss).

---

## 2026-06-25 — Git-native storage PHASE 2 (DONE, merged PR #420, deploys via Cloud Run)

PHASE 2 — wired git-native storage into the v3.0 build loop, behind an explicit
`GITHUB_STORAGE_ENABLED=true` opt-in (ships DORMANT; the three App secrets alone do NOT activate it,
so the live build path is unchanged until the admin flips the flag — strangler-fig).

- `GitRepoSync.ts` (over the same `CommandRunner` port as GitManager → unit-testable, no-op without a
  shell): `hydrateIfEmpty(authedUrl)` clones the project repo into the sandbox ONLY when it came up
  empty (never clobbers a live sandbox or a Firestore restore); `pushAll(authedUrl, branch, message)`
  commits + force-pushes the sandbox back (private single-writer mirror → force safe). Best-effort
  everywhere; the authed token is handed straight to git and NEVER emitted to the event stream;
  branch + commit message sanitized against shell injection.
- `githubStorageActive()` gate added to GitHubAppClient (secrets present AND the flag = true).
- Route wiring (agentv3.ts): ensureRepo + hydrate BEFORE the Firestore fallback at build start;
  commit + push AFTER the durable file save at build end. Both no-op when dormant. The Firestore file
  capture stays as the backstop.
- 9 new unit tests (fake CommandRunner): hydrate skip/clone/fail, push commit/no-change/fail, branch +
  message sanitization, never-throws.

Gate: server tsc 0, frontend tsc 0, boot:check PASS, **2512 vitest** PASS (9 new).
NEXT (Phase 3): CI + merge of the user's repo, Claude-Code-style (PR → check status → merge).
Phase 4: auth simplify (Email/Phone primary, remove the failing Google button, optional "Connect
GitHub" + Export/Transfer for portability). Phase 5: dual preview (in-browser iframe + E2B).
NOTE: Phases 3–5 touch user-facing auth/preview flows → confirm with admin before each (safeguard #3).

---

### 2026-06-25 — v3.0 cost-ladder P2: analyser → start-tier build-model wiring

The deterministic request analyser (`RequestAnalyser.analyzeRequest`, already
built + unit-tested) existed but was **never wired into the build route** — every
v3.0 build ran on a fixed `gemini-2.5-pro` chain regardless of how trivial the
request was. This is the "make a Gemini calculator cost ₹20 not ₹1600" lever the
design doc (§8.5 P2) calls for, and it was dead.

Wired it (real, end-to-end, margin-safe):
- `routes/agentv3.ts`: before building the turn runner, call `analyzeRequest({ prompt,
  powerMode: onlyOpus })` and map the resulting `startTier` to the cheapest CAPABLE
  Gemini build model via new exported `tierToGeminiBuildModel()`:
  `gemini` (greeting / calculator / todo / simple_app) → **gemini-2.5-flash**;
  every other tier (haiku/sonnet/opus) → **gemini-2.5-pro** (proven model kept for
  real coding / complex / architecture work). The Claude backstop in the provider
  chain is untouched.
- `buildTurnRunner(opts?)` now takes an optional `geminiModel`; explicit env overrides
  (`AGENTV3_{VERTEX,GEMINI}_BUILD_MODEL`, `AGENTV3_BUILD_MODEL`) still win, then the
  tier model, then the `gemini-2.5-pro` default.
- Escape hatch: `AGENTV3_COST_LADDER=off` restores the fixed-model behavior.
- The chosen model is logged to server telemetry only (`[AGENTV3] cost-ladder: …`) —
  **no provider/model name is surfaced to the user**, consistent with the existing
  hidden-provider design.

**Billing is UNCHANGED** — every v3.0 build is still billed at the Opus-equivalent
markup (× 2.5 / × 5) per the constitution. This change lowers ONLY NavBharatAI's own
real provider cost, so the margin is strictly wider. `pricing.ts` is NOT touched
(the constitution-locked lever stays locked). Active within v3.0, which is itself
flag-gated (`AGENTV3_ENABLED`) — zero impact on the live app.

Exported `analyzeRequest` + types from `AgentV3/index.ts` (clean public surface).
Gate: frontend tsc 0, server tsc 0, **2516 vitest** PASS (+4 new cost-ladder tests),
boot:check PASS. Ships on merge → deploy.

---

## 2026-06-25 — Git-native PHASE 3 + Auth/Export PHASE 4 + Dual Preview PHASE 5 (all DONE, merged)

PHASE 3 (merged PR #422) — Claude-Code-style PR → CI → merge for git-native storage, behind an
explicit GITHUB_PR_MODE=true opt-in ON TOP of git-native storage (dormant until both flags set).
- GitHubAppClient: openPullRequest (idempotent, reuses an open PR on 422), combinedStatus (legacy
  commit-status AND GitHub Actions check-runs → one success/pending/failure/none verdict),
  mergePullRequest.
- GitHubPrFlow.mergeViaPullRequest: open PR → read CI on the head sha → merge ONLY on green/none,
  else leave the PR OPEN with an honest note (never merges red, no fake success). githubPrMode().
- Route: PR mode pushes to nbi/build-<ts> then open+merge; else the Phase 2 direct push. 15 tests.

PHASE 4 (merged PR #424) — auth simplify + portability.
- Removed the failing "Sign in with Google" button + its handler/helper/imports + the "ya" divider.
  Email+Password and Phone(OTP) remain. App-root getRedirectResult left intact (harmless no-op).
- Real "Export .zip" button in the v3.0 tab row: pulls live files via /api/agentv3/workspace-files
  and builds a genuine zip in-browser with jszip (excludes node_modules/.git/dist/build/.next/
  __pycache__). User owns their code — no lock-in.
- AppKnowledgeBase: login_auth updated (Email/Phone, Google removed); new agentv3_export entry.

PHASE 5 (this PR) — dual preview.
- New POST /api/agentv3/inbrowser-preview: builds ONE self-contained HTML from the workspace files
  via the existing runtime renderers (renderPreview → static/React/Vue) and returns it. No dev
  server needed → works even when the E2B sandbox preview is unavailable ("Blocked request" case).
- PreviewSurface rewritten for two real modes: "Live server" (E2B running app, full fidelity) and
  "In-browser" (<iframe srcdoc> of the built files; sandboxed WITHOUT allow-same-origin). Toggle +
  refresh; in-browser auto-builds and defaults on when there is no live URL yet.
- AppKnowledgeBase: new agentv3_preview entry (dual preview, blocked-request keywords).

Gate (every phase): frontend tsc 0, server tsc 0, boot:check PASS, vitest PASS
(2503 → 2512 → 2527 across the phases; Phase 4/5 add UI + a route, covered by existing runtime tests).
All five git-native/preview/auth phases complete. Git-native storage + PR mode remain DORMANT behind
their flags; auth simplify + export + dual preview are LIVE.

---

### 2026-06-25 — v3.0 cost-ladder measurement: per-tier cost & quality telemetry

The cost-ladder (P2, prior milestone) now routes simple apps to cheaper models —
but there was NO way to prove it saves money or that quality holds per tier. The
design doc's P8 cutover gate explicitly requires that measurement ("measure
cheap-tier quality + fallback rate per task-type before flipping the default"),
and a cost dashboard would have no real data without it (faking it would break the
real-features rule). Built the honest foundation:

- NEW `src/server/AgentV3/AgentV3CostTelemetry.ts` — per-day aggregate
  (`agentv3_cost_telemetry/{YYYY-MM-DD}`) of every v3.0 build, broken down BOTH by
  task type and by start tier: builds, okBuilds (per-tier success rate), billedUsd,
  input/output tokens, durationMs, plus powerBuilds. The aggregation is a PURE,
  unit-tested `foldCostTelemetry()` fold; the store wraps it in a Firestore
  transaction. Mirrors UserCostStore exactly (VITEST-skip, best-effort, never throws).
- `routes/agentv3.ts` — records one telemetry row per build right beside the existing
  `userCostStore.record`, pulling taskType/startTier from the analyser and
  ok/billed/tokens/duration from the build result. Best-effort; never blocks.
- `routes/admin.ts` — NEW `GET /api/admin/agentv3/cost-telemetry?days=N` (admin-auth,
  read-only) returns the last N days of aggregates for an eventual dashboard.

No billing change, no pricing.ts touch, no user-facing surface yet (admin endpoint
only → no AppKnowledgeBase entry until the dashboard UI ships). Active within the
already-flag-gated v3.0 path.
Gate: frontend tsc 0, server tsc 0, **2524 vitest** PASS (+8 new foldCostTelemetry
tests), boot:check PASS. Ships on merge → deploy.

---

### 2026-06-26 — v3.0 cost-ladder dashboard: admin Revenue-tab visualization

Completes the cost-ladder trio (wiring → measurement → visualization). The
telemetry endpoint shipped last; this surfaces it for the admin with REAL numbers
(no faked "money saved" — that would need per-model provider rates we don't record,
so it's deliberately omitted per the real-features rule).

- NEW `src/lib/agentV3CostSummary.ts` — PURE, frontend-safe `summarizeCostTelemetry()`
  that rolls up the per-day telemetry docs into display numbers: total builds,
  overall + per-tier success rate, billed totals, avg tokens/duration, and the
  headline CHEAP-TIER SHARE (% of builds on the cheapest 'gemini' tier). Empty/bad
  input → honest all-zero summary. 8 unit tests.
- `components/AdminDashboard.tsx` — new "v3.0 Cost-Ladder (last 30 days)" section in
  the Revenue tab: 4 stat cards (builds, success rate, cheap-tier share, billed) +
  a per-start-tier table (builds / share / success / avg tokens / avg time / billed),
  with a Refresh button. Fetches `/api/admin/agentv3/cost-telemetry` only when the
  Revenue tab is open. Built in AdminDashboard.tsx (NOT App.tsx) → no collision with
  the concurrent session's App.tsx work.
- AppKnowledgeBase: NEW `admin-cost-ladder` entry (mandatory sync — new admin surface).

The cheap-tier success rate shown here IS the P8 cutover signal: high share + high
success = the ladder is safe to default-on. No billing/pricing change.
Gate: frontend tsc 0, server tsc 0, **2547 vitest** PASS (+8 new summary tests),
boot:check PASS. Ships on merge → deploy.

---

### 2026-06-26 — v3.0 cost-ladder P3: evaluate-gated escalation (wired, DORMANT behind flag)

Completes the cost-ladder's autonomy. The analyser already picks a cheap start tier
(P2) and we measure it (telemetry/dashboard) — P3 adds the missing piece: build
cheap-first, and climb to a stronger tier ONLY when the build objectively fails.

The `runWithEscalation` orchestrator already existed + was unit-tested; the design
doc explicitly deferred its WIRING to "behind the rollout flag" — so this ships it
DORMANT:

- Flag `AGENTV3_ESCALATION` (default OFF). When off, the build path is byte-identical
  to before — a single `runner.run(buildPrompt)` on the start tier. Verified by routing
  the unchanged path through an explicit else-branch.
- When `=on`: the build runs through `runWithEscalation(analysis.escalationPath, …)`.
  Attempt 1 reuses the existing start-tier runner; on gate-fail it builds once more on a
  stronger, **Claude-first** runner (same workspace + event stream, new transcript id),
  emitting an honest "Escalating to a stronger model…" narration. The last tier is always
  delivered as a best-effort backstop, so the build NEVER breaks.
- Objective gate (`escalationGate`): `build.ok` — a build that didn't complete fails and
  triggers the climb; deterministic, free, no LLM call. (Richer 22-dim gating can replace
  it later.)
- Guards (`shouldEscalateBuild`): never escalates power/Only-Opus builds (ladder bypassed)
  or a build already at the top tier; no analysis → no escalation.
- `buildTurnRunner` gained a `claudeFirst` option so an escalated tier actually leads with
  Claude, not Gemini.
- Telemetry now records the DELIVERED tier (post-escalation), so per-tier success rates
  reflect what really ran.

No billing/pricing change; no user-facing surface (dormant build-routing → no
AppKnowledgeBase entry). Activating it (and proving cheap-tier quality via the P6
dashboard) is the admin-gated P8 rollout step.
Gate: frontend tsc 0, server tsc 0, **2554 vitest** PASS (+7 new escalation policy/gate
tests), boot:check PASS. Ships on merge → deploy (dormant until AGENTV3_ESCALATION=on).

---

### 2026-06-26 — v3.0 cost-ladder P7: failover hardening (Claude-Haiku backstop)

The build provider chain was Vertex → Gemini → (single) Claude. If the primary Claude
model (Sonnet in normal mode, Opus in power) was overloaded or rate-limited, the build
could hard-fail even though a cheaper Claude model was available. P7 closes that gap.

- NEW `forceModelRunner(runner, model)` in MultiProviderTurnRunner.ts — wraps a runner so
  it ALWAYS runs with a fixed model, ignoring the turn's requested model. Pure, unit-tested.
- `buildTurnRunner` now appends a **Claude-HAIKU backstop** as the final chain entry
  (forces the Haiku model). It only ever runs AFTER every prior provider has thrown, so
  normal builds are completely unaffected — but a Sonnet/Opus-specific outage no longer
  breaks the build; Haiku completes the turn. STRICTLY ADDITIVE resilience (no flag/gate
  needed); `AGENTV3_DISABLE_HAIKU_BACKSTOP=1` removes it if ever required.
- Billing is UNCHANGED — Opus-equivalent markup (D5/D6) regardless of which model answers.
- Exported haikuModel/opusNormalModel/ladderModel + ClaudeLadderTier from AgentV3/index.ts.

Matches the design doc's failover chain (…→ Haiku → Gemini → Vertex). Backend resilience
only — no user-facing surface, so no AppKnowledgeBase entry.
Gate: frontend tsc 0, server tsc 0, **2556 vitest** PASS (+2 new forceModelRunner tests),
boot:check PASS. Ships on merge → deploy.

---

### 2026-06-26 — v3.0 cost-ladder P9: new-user free onboarding builds (dormant behind flag)

Retention feature: give each NEW user their first N v3.0 builds free. With the
cost-ladder, a new user's first app (usually simple) builds on Gemini for ~₹0 real
cost — near-free for NavBharatAI but a strong first impression. DORMANT by default
(AGENTV3_FREE_ONBOARDING_BUILDS=0), so live billing is exactly as before until the
admin sets a limit. This is a promo waiver, NOT the P5 pricing-model change (which
the admin kept as Opus-equivalent ×2.5).

- NEW `src/server/lib/OnboardingCreditStore.ts` — lifetime per-user free-build counter
  (`agentv3_onboarding_credits/{userId}`), atomic `consumeFreeBuild(userId, limit)`.
  Pure `onboardingEligible(used, limit)` policy + `freeOnboardingLimit()` env parse.
  Fail-safe: any Firestore error → false (user billed normally; an outage can NEVER
  make every build free). Mirrors UserCostStore (VITEST-skip, best-effort).
- `routes/agentv3.ts`: on a SUCCESSFUL build (result.ok) for an eligible user, the free
  credit is consumed → `effectiveBilledUsd = 0`, a "🎁 This build is on us" narration is
  shown, and both the cost record AND the result event use the waived amount so the
  customer-facing ₹ matches. A FAILED build never burns a free credit.
- Cost-ladder telemetry keeps recording the REAL billed amount (build economics),
  separate from the user-facing waiver.

Dormant by default → no AppKnowledgeBase entry yet (adding one while OFF would have the
AIs falsely promise free builds). Documented when the admin enables it.
Gate: frontend tsc 0, server tsc 0, **2562 vitest** PASS (+6 new onboarding-policy
tests), boot:check PASS. Ships on merge → deploy (dormant until the limit is set).

---

### 2026-06-26 — Auth: Google + GitHub social login rebuilt from scratch (with the real root-cause fix)

Google login had failed across ~12 prior attempts and was deleted entirely (PR #424).
A multi-agent diagnosis found the real, never-addressed blocker and the full rebuild
ships here.

ROOT CAUSE (RC5, never fixed before): helmet set NO `crossOriginOpenerPolicy`, so its
default `same-origin` COOP severed `window.opener` for the OAuth popup — the popup
completed but its postMessage result could never reach the app ("message channel closed
before a response"), so the user returned logged-out with no error. Every prior attempt
flip-flopped between popup (broken by COOP) and redirect (broken by cross-origin storage
partitioning, RC2) without ever fixing COOP.

THE FIX:
- `server.ts`: add `crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }` to
  helmet — keeps the opener link so signInWithPopup actually delivers its credential.
  This is the missing piece behind every past failure.
- `components/AuthComponent.tsx`: fresh social sign-in — "Sign in with Google" and
  "Continue with GitHub" buttons. Popup-first (sidesteps the redirect storage problem),
  with an automatic full-page **redirect fallback** if the browser blocks the popup.
  Errors are always surfaced via describeSocialError (unauthorized-domain /
  operation-not-allowed name the exact Firebase Console fix) — never silent.
- **GitHub = maximum repo permission**: requests `repo` + `workflow` + `read:user` +
  `user:email` scopes and captures the OAuth access token into `localStorage.gh_token`,
  so NavBharatAI can 100% connect to the user's repos (git-native storage, deploy, PR→CI
  →merge flow).
- `App.tsx`: getRedirectResult finalizes the redirect-fallback path AND captures the
  GitHub token; onAuthStateChanged syncs `githubToken` state on any social login. Removed
  the old confusing "force-reopen modal on error" behaviour.
- `declarations.d.ts`: ambient firebase/auth stubs for GithubAuthProvider / AuthProvider.
- AppKnowledgeBase `login_auth`: lists all four methods again (+ GitHub repo-connect),
  Google/GitHub keywords restored (mandatory sync rule).

HONEST CAVEAT (CLAUDE.md "no fake success"): the code fix is correct and ships the
genuinely-missing COOP fix, but a successful Google/GitHub round-trip ALSO depends on
admin-only Firebase Console config that CANNOT be verified from the sandbox: (1) Google
AND GitHub providers ENABLED in Authentication → Sign-in method; (2) the live serving
domain in Authentication → Settings → Authorized domains; (3) for GitHub, an OAuth app
configured with the Firebase callback URL. This feature must be verified on the LIVE site
in a real browser before being called "working".
Gate: frontend tsc 0, server tsc 0, **2562 vitest** PASS, boot:check PASS.

---

### 2026-06-26 — v3.0 fix: stop fake-success billing when model replies with no tool calls (PR #433)

**Root cause (production bug):** A user requested "analog clock app", received a chat reply
("I'm preparing a plan") instead of files, yet was billed ₹10.23. The bug was in
`AgentRunner.ts` line 236-240: `turn.toolUses.length === 0` branch returned `ok:true` and
billed regardless — even when no files were ever written.

**Fix:**
- `AgentRunner.ts`: added `expectsArtifacts?: boolean` option + `totalToolUses` counter.
  When `expectsArtifacts=true` and zero tool calls were made across the whole build, emits
  `ok:false` with an honest "no files were created" message instead of `ok:true`.
- `routes/agentv3.ts`: `expectsArtifacts = true` for `new_build` and `edit_existing`
  intents. After a zero-file run, auto-retries ONCE with a Claude-first runner (stronger
  model). If retry also produces 0 files, `effectiveBilledUsd` is forced to 0 — users
  are NEVER charged for a build that produced nothing.
- 3 new tests covering: the production bug (`ok:false` on zero-tool build), chat turns
  (unaffected — still `ok:true`), and a real build that wrote a file (`ok:true`).

Gate: frontend tsc 0, server tsc 0, **2562 vitest** PASS (all 3 new tests green), boot:check PASS.

---

## 2026-06-26 — User-owned git-native: login → user's repo → CI → PR-merge → full control (DONE, merged #435 #436)

The admin configured the GitHub OAuth App + Firebase GitHub provider, so GitHub login now works and
captures the user's OAuth token (repo + workflow scopes). Wired the full vision on top, all green +
merged, gated by GITHUB_STORAGE_ENABLED (dormant by default):

- UserGitHubClient (#435): acts AS THE USER (their token), owner = their login. getLogin (cached),
  ensureRepo (GET-or-create under /user/repos, private+auto_init), authedCloneUrl, and the
  PrCapableClient methods (openPullRequest idempotent-on-422, combinedStatus over commit-status +
  check-runs, mergePullRequest) — plugs straight into the existing mergeViaPullRequest. 9 unit tests.
- Route wiring (#435): the git-native block now PREFERS the user's GitHub when a githubToken is sent
  (ensureRepo in their account → hydrate at start → push + PR/CI/merge at end via a generalized
  prClient: PrCapableClient); else the platform-org App store (Email/Phone users). Client forwards
  the signed-in user's gh_token (read at send time).
- Full app control UI (#436): new 'repo' event ({url, fullName}) → client reducer stores it →
  AgentV3Panel shows a "GitHub" link button so the user jumps to their code/branches/PRs/CI/merges.
- AppKnowledgeBase: new agentv3_github_storage entry.

Result (when GITHUB_STORAGE_ENABLED=true): GitHub-logged-in users get each project as a private repo
in THEIR OWN GitHub, built/committed/PR'd/CI-checked/merged like Claude Code (never merges red);
Email/Phone users get the same durability via the platform org. Gate every phase: frontend tsc 0,
server tsc 0, vitest PASS (up to 2574), boot:check PASS.

---

### 2026-06-26 — My Profile feature (PR #442, merged)

Full user profile page accessible from the top-right avatar dropdown AND Settings → Account → My Profile.

**What shipped:**
- `UserBuildHistoryStore.ts` (NEW): Firestore collection `user_build_history`, admin SDK, VITEST-skip.
  Records every build with status (`completed` / `failed` / `cancelled`), costInr (full / 0 / 50%),
  durationMs, fileCount, tier. Methods: `record()`, `list()`, `getSummary()`.
- `UserProfileStore.ts` (NEW): Firestore collection `user_profiles`, admin SDK, VITEST-skip.
  Stores displayName, bio, phone, photoUrl, budgetLimitInr. Methods: `get()`, `update()`.
- `routes/profile.ts` (NEW): bearer-token authenticated.
  - `GET /api/profile` — profile + wallet summary + monthly AI spend
  - `PUT /api/profile` — update displayName/bio/phone/photoUrl
  - `PUT /api/profile/budget` — set budgetLimitInr
  - `GET /api/profile/history?period=week|month|custom&from=&to=` — paginated build history
- `ProfilePage.tsx` (NEW, ~583 lines): full-page profile UI with avatar (Google/GitHub photo or
  initials fallback), editable name/bio/phone/photo-URL, wallet balance + monthly spend + budget
  limit input, build history with This Week / This Month / Custom date range tabs + summary cards +
  table with status badges, quick links to Billing/Settings, Sign Out.
- `TopNav.tsx`: replaced plain logout button with animated avatar dropdown (My Profile | Settings | Sign Out).
- `SettingsPanel.tsx`: new "Account" group at top with "My Profile" item that navigates (nav:true).
- `App.tsx`: renders `ProfilePage` when `activeView === 'my_profile'`; wires `onOpenProfile` + `onOpenSettings` to TopNav.
- `server.ts`: registers profile routes.
- `build.ts`: records per-build history entry after each completed/failed/cancelled build.
- `AppKnowledgeBase.ts`: `my_profile` entry with exact navigation paths and keywords.
- `types/index.ts`: added `'my_profile'` to ViewType, `'profile'` to SettingsScreen.

Build status logic: `completed` (full charge) if `eng.ok && !partial`; `failed` (free) if
`!eng.ok && fileCount === 0 && !partial`; `cancelled` (50% charge if files written, 0 if none) otherwise.
Budget cap: if build started with sufficient balance, always completes; after completion if balance ≤ 0,
input box replaced by a recharge card.

Gate: frontend tsc 0, server tsc 0, **2574 vitest** PASS, CI green on PR #442.

---

### 2026-06-26 — v3.0 engine hardening: 6 real gaps from technical audit (PR #449)

Technical audit of actual engine code (not design docs) revealed 6 gaps. All fixed:

**Fix 1+4 — write_file full-rewrite guard + WorkspaceMemory content injection:**
`ToolDispatcher.ts` write_file handler now captures `existingContent` BEFORE the write.
When `kind === 'modify'` (file already existed), the WARNING message now embeds the
pre-overwrite content (up to 2000 chars). Model gets current file state immediately —
no extra `read_file` round-trip needed to craft the correct `edit_file` call.

**Fix 2 — edit_file "not found" error with current content:**
When `old_string` is not found (even after whitespace-flexible fallback), the error now
returns the current file content inline (up to 1500 chars). Model copies exact lines and
retries without a separate `read_file` call. Saves one full build step per failed edit.

**Fix 3 — PreviewDomain startup warning:**
`PreviewDomain.ts` now logs `[AgentV3]` warning at startup in production when
`E2B_PREVIEW_DOMAIN` is not set — tells the operator raw `*.e2b.app` URLs are in use
and exactly how to configure a stable branded domain.

**Fix 5 — Hard sub-agent delegation rules (system prompt):**
`architectSystemPrompt()` now has a `MANDATORY DELEGATION` block with explicit
file→role routing: `src/components/**` → `task(frontend)`, `src/server/**` →
`task(backend)`, etc. Architect writes ONLY config files. All independent `task()`
calls in ONE turn = parallel workers. Previously the Architect would write everything
itself — no parallelism benefit.

**Fix 6 — Mid-build TypeScript gate (system prompt):**
System prompt now instructs agent to run `npx tsc --noEmit 2>&1 | head -30` after every
5 file writes. Fix all errors immediately before continuing. Catches type breakage at the
source instead of discovering it 20 steps later at the final `evaluate` call.

**Fix 3b — Edit mode: no write_file fallback on edit failure:**
`editModePrefix()` now explicitly tells the model: if `edit_file` fails, use the
returned current content to craft a precise retry — NEVER fall back to `write_file` on
an existing file just because the edit failed.

Gate: frontend tsc 0, server tsc 0, **2574 vitest** PASS, CI green on PR #449.

---

## 2026-06-26 — v3.0 hardening: audit, roadmap & R1 safety floor (autonomous cycle)

Ground-truth audit of v3.0 (3 deep code-reading passes) → `NAVBHARATAI_PRO_V3_ROADMAP.md`
(6 audit points mapped, prioritized R1→R7 plan). Then shipped, each branch→PR→CI green→merge:

- **IDOR fix (PR #453):** `assertWorkspaceOwner()` on all 4 workspaceId endpoints
  (`/restore`, `/workspace-files`, `/inbrowser-preview`, `/import-files`) — a user can no
  longer read/restore/export another user's workspace. Client forwards the Firebase ID token;
  admin keeps working via the body-userId fallback.
- **"Apps never break from editing" permanent rule (PR #454):** baked into v3.0's brain
  (`systemPrompt.ts`) — BUILD side builds every app edit-resilient by design (root error
  boundary, small decoupled modules, typed contracts, defensive guards, no fragile traps);
  EDIT side makes "never break the app" the #1 rule and demands proving build/run after edits.
- **R1.1 — secret redaction (PR #455):** new `SecretRedactor` masks provider keys / PEM /
  JWT / URL creds / secret-named assignments in the user-visible tool-call input + tool-result
  summary + error message. Model-facing `content` left intact (edit_file exact-match safe).
- **R1 §3.1 — per-user monthly spend ceiling:** new `AGENTV3_USER_MONTHLY_CAP_USD` env var
  (default 0 = disabled). When set, `/api/agentv3/chat` denies a build with an honest HTTP 402
  once the user's `user_costs` monthly total reaches the cap. Fails OPEN on a store error so a
  Firestore outage never locks users out. Caps the platform's D2 (NavBharatAI-pays) exposure.

New v3.0 env var: `AGENTV3_USER_MONTHLY_CAP_USD` (USD, default 0 = off).

Gate at each merge: frontend tsc 0, server tsc 0, vitest PASS (2598→2606), boot:check PASS.
Next in R1: §1.2 rate-limit all mutating endpoints, §3.3 prompt-injection defense (imports).

---

## 2026-06-26 (cont.) — R2 §1.1 mandatory gate + escalation ground-truth correction

- **R2 §1.1 — mandatory quality gate (PR #459):** the objective 22-dimension `evaluate`
  scan now runs automatically before a top-level build is reported done; a NOT-READY
  verdict (unresolved import / secret leak / fake code / can't-run) downgrades ok:true →
  ok:false with an honest summary. `ToolDispatcher.assessBuildReadiness()` reuses the exact
  same scan (no divergence). Wired via `readinessGate` (top-level runners only, never
  sub-agents) + `readinessGateEnabled()` (ON by default; `AGENTV3_READINESS_GATE=off` escape
  hatch). New env var: `AGENTV3_READINESS_GATE`.

- **Ground-truth correction (escalation):** the audit/roadmap listed the Escalation
  Orchestrator as "built+tested but NOT wired to AgentRunner / dormant." Reading the live
  route shows it IS wired — `routes/agentv3.ts` runs `runWithEscalation(analysis.escalationPath,
  { buildOnTier, gate: escalationGate(build.ok) })` (cheap→strong, Opus backstop), gated only
  by `AGENTV3_ESCALATION` (default off) + `shouldEscalateBuild()`. So R3 §2.1 ("wire
  escalation") is largely DONE in code — what remains is an ops decision to enable the flag
  (with telemetry) rather than new wiring. BONUS: because §1.1 makes a not-ready build ok:false,
  the existing `escalationGate(build.ok)` now escalates on a failed READINESS check too — the two
  features composed for free.

Gate at merge: frontend tsc 0, server tsc 0, vitest 2621 PASS, boot:check PASS.

---

## 2026-06-26 (cont.) — R4 §2.3 auto-fix + R5 §5.1 one-click live deploy

- **R4 §2.3 — runtime-error auto-fix loop (PR #461):** new AutoFix module + route loop. When
  enabled (AGENTV3_AUTOFIX=on, default off), after a successful build the captured browser runtime
  errors drive up to N (default 1, max 3) Claude-first repair passes (fix → reload → re-verify),
  with an advancing time window so a repaired error is never re-detected; honest WARN if any remain.
  New env: AGENTV3_AUTOFIX, AGENTV3_AUTOFIX_ATTEMPTS.

- **R5 §5.1 — one-click live deploy (PR #462 backend, #463 UI):** the deploy ENGINE was already
  real (Firebase Hosting → permanent *.web.app URL). Added what was missing:
  • DeploymentStore + withDeploymentPersistence() — every deploy's URL is now durably saved.
  • GET /api/agentv3/deployment (ownership-checked) — fetch a workspace's live URL back.
  • UI "Deploy" button (drives the real build+deploy pipeline) + a "Live site" link restored on
    load, so the permanent URL survives a refresh/new session (was lost with the stream before).
  • AppKnowledgeBase `agentv3_deploy` entry. Custom domain (DNS) explicitly NOT built yet — the
    .web.app URL is permanent + shareable; custom domain is an honest follow-up.

Gate at each merge: frontend tsc 0, server tsc 0, vitest PASS (2630→2634), boot:check PASS.

## 2026-06-26 (cont.) — forensic audit + root-cause fix: v3.0 "Closed Port Error" / empty workspace (PR #469)

**Root cause identified:** `ensureWorkspace(workspaceId, 'react')` (hardcoded) → TemplateRegistry has no
'react' key (correct key is 'vite-react') → `getProvider('react')` threw → `catch {}` silently swallowed
→ workspace directory created but COMPLETELY EMPTY. This caused every single Pro v3.0 build to start with
no scaffold files. The agent then manually scaffolded vite.config.ts from memory without `host: true` →
Vite bound to 127.0.0.1 only → E2B port proxy blocked → "Closed Port Error" in preview. Users were being
charged ₹300–400 for broken previews.

**Secondary issues found and fixed:**
- Reviewer SOURCE_RE missing .py .go .java etc. → Python/Go builds silently skipped by reviewer
- Reviewer used `listFiles()` only; if sandbox cold-read returned empty, review skipped despite successful build
- RemixProvider + AstroProvider missing `allowedHosts: true` → sandbox proxy host blocked by newer Vite
- E2BActuator catch block started with empty workspace instead of vite-react fallback

**All 6 code fixes (PR #469, 2574/2574 tests pass):**
1. `agentv3.ts` — `ensureWorkspace(workspaceId, framework)` (was `'react'`) — primary fix
2. `E2BActuator.ts` — `listFrameworks()` guard + vite-react last-resort fallback in catch
3. `ReviewerAgent.ts` — SOURCE_RE extended with .py .go .java .php .rb .rs .swift .kt
4. `agentv3.ts` — reviewer uses writtenFiles fallback when listFiles() returns empty
5. `RemixProvider.ts` — added `allowedHosts: true`
6. `AstroProvider.ts` — added `allowedHosts: true`

## 2026-06-26 (cont.) — architecture hardening pass 2: port detection + preview health check (PR #471)

Follow-up to PR #469's root-cause fix. Closed the remaining false-success gaps in the v3.0
build → preview pipeline so the preview is genuinely EARNED, not just published.

**Fixes (PR #471, 2643/2643 tests pass, frontend+server tsc 0):**
1. `ToolDispatcher.ts` — `update_preview` now polls port readiness (`nc -z localhost <port>`,
   30 attempts × 500ms = 15s max) BEFORE publishing the preview URL. If the port never comes up
   it emits an honest WARNING instead of silently publishing a URL that shows "Closed Port Error".
   This is the direct fix for "system claimed success but preview showed Closed Port Error".
2. `ToolDispatcher.test.ts` — FakeActuator.runCommand returns PORT_UP for nc -z checks so the
   update_preview tests resolve instantly (no 15s timeout in CI).
3. `E2BActuator.ts` — `extractDevPort()` now returns the correct port per framework: Angular 4200,
   Astro 4321, Python uvicorn/gunicorn/flask 8000/5000, Next.js/Nuxt/NestJS/Express/Fastify 3000
   (was always defaulting to 5173 → health check polled the wrong port). `isLongRunning` detection
   extended: `bash dev.sh` (Django/Flask/FastAPI), `ng serve`, `next dev`, `nuxt dev`, `astro dev`.
   `ensureWorkspace()` adds a `resolveKey()` guard (listFrameworks() membership) + vite-react
   last-resort fallback so an unknown framework key can never produce an empty workspace.
4. `NextjsProvider.ts` — dev/start scripts bind `--hostname 0.0.0.0` so the E2B proxy can reach
   the Next.js dev server (was 127.0.0.1-only → unreachable).
5. `StaticProvider.ts` — added package.json with an http-server dev script so static-site builds
   have a runnable `npm run dev` (previously no run command existed for the static template).
6. `systemPrompt.ts` — FRAMEWORK_HINTS now state explicit port numbers for all 18 frameworks so
   the agent calls update_preview(<correct port>) instead of guessing.

Gate at merge: frontend tsc 0, server tsc 0, vitest 2643/2643 PASS, CI green before squash-merge.

**Honest limitation (not code-fixable here):** the full regression matrix (10+ app types ×
5+ frameworks end-to-end through a LIVE E2B sandbox) cannot be executed inside CI — it needs a
real E2B cloud VM with an API key. The unit/integration suite verifies the per-framework port
logic, long-running detection, template scaffolding, and the health-check gate deterministically;
the live multi-framework smoke matrix remains a manual/staging step.

---

## 2026-06-27 — Multi-provider deploy (no lock-in): foundation + 3 providers + chooser

Admin direction: NavBharatAI must never depend on a single hosting provider. Built the full
no-lock-in deploy system, each piece real and gate-green:

- **Foundation (PR #466):** DeployProvider abstraction + registry + deployProviderStatus() +
  GET /api/agentv3/deploy-providers. The real deploy flows through the registry. No placeholders —
  only working providers are registered.
- **Vercel provider (PR #468):** sha1 file upload + production deployment, idempotent by project
  name. Token-gated on VERCEL_TOKEN (+ optional VERCEL_TEAM_ID).
- **Netlify provider (PR #473):** digest deploy + ProviderStateStore for a stable site/URL across
  re-deploys. Token-gated on NETLIFY_AUTH_TOKEN.
- **Provider chooser (PR #474):** the build route honors req.body.deployProvider; the UI shows a
  chooser next to Deploy when >1 provider is configured (only configured ones offered). Honest
  "configure <PROVIDER>" error if an unconfigured one is somehow chosen. AppKnowledgeBase updated.

End-to-end: add a provider's API token → it appears in the chooser → pick it → deploy there.
Firebase stays the always-available default; everything else is OFF until its token is set (zero
risk to the live app). Live-API paths verified once the admin adds tokens; pure parts fully tested.

Remaining (more complex / infra decisions): GitHub Pages (user token + repo), Railway (runs
servers, not static), Hostinger (FTP), and per-app custom domain on mitrify.xyz (DNS/infra design).

Gate at each merge: frontend tsc 0, server tsc 0, vitest PASS (2643→2661), boot:check PASS.

---

## 2026-06-27 — MODE A infra: custom E2B builder template (artifacts, build-ready)

Admin asked for BOTH scaffolding modes rock-solid: MODE B (internal templates,
already working) AND MODE A (`npm create vite` / `create-next-app`). Forensic
finding: MODE A fails ONLY because `Sandbox.create()` uses E2B's default base
image (no template id) whose Node is too old for modern generators. ScaffoldGuard
correctly blocks MODE A today as a result. The fix is infra (a modern pinned-Node
sandbox image), not code.

**Verified live:** `npm create vite@latest -- --template react-ts` run on Node
v22.22 in this environment → succeeded (React 19 + Vite 8 scaffold). Confirms the
ONLY blocker is the sandbox Node version.

**Shipped (this PR) — `infra/e2b/`:**
- `e2b.Dockerfile` — Node 22 (pinned) + git, netcat-openbsd (`nc` for the
  update_preview port health-check), python3/venv (FastAPI/Flask/Django),
  build-essential, pre-warmed create-vite/create-next-app; build-time sanity gate
  that fails the image build if Node < 20.19.
- `e2b.toml` — template config (name navbharat-builder, cpu 2 / 2 GB).
- `README.md` — turnkey build+publish+verify guide AND the deferred code-wiring
  plan (point Sandbox.create at E2B_TEMPLATE_ID with default-base fallback;
  template-aware ScaffoldGuard allow; MODE A→MODE B automatic fallback; post-
  scaffold patch to add `server:{host:true,allowedHosts:true}` to create-vite's
  vite.config for the E2B proxy; AppKnowledgeBase entry).

**Honest blockers (cannot run from the Claude web sandbox):** Docker Hub image
blobs are blocked by egress policy (403 from production.cloudfront.docker.com)
and no E2B_API_KEY is mounted — so the `e2b template build` + publish step must
run on a machine with Docker + Docker Hub access + the E2B key. Artifacts are
build-ready; code wiring is intentionally deferred to a follow-up PR until a real
template id exists (so the old create-vite-fails bug is never re-introduced by
pointing at a half-built template).

No code/TS touched → tsc clean, existing test suite unaffected.

## 2026-06-27 (cont.) — MODE A infra: one-click GitHub Actions build for the E2B template

The custom E2B template (added previous PR) must be built where Docker + Docker
Hub egress + E2B_API_KEY are all available — NOT the Claude web sandbox (Docker
Hub blobs AND api.e2b.dev are both egress-blocked there; key not mounted).

Added `.github/workflows/e2b-template.yml` (workflow_dispatch, manual): builds +
publishes the template on a GitHub runner using an `E2B_API_KEY` repo secret, and
prints the resulting Template ID into the job summary (+ uploads the updated
e2b.toml as an artifact). This is the turnkey "infra build" path — admin adds one
repo secret and clicks Run; no local terminal/Docker needed. README updated to
make this the recommended path. Manual-only so it never incurs E2B build cost on
ordinary pushes.

Next (gated on the printed Template ID): set Cloud Run E2B_TEMPLATE_ID, then the
code-wiring PR (Sandbox.create template + template-aware ScaffoldGuard + MODE A→B
fallback + create-vite vite.config host/allowedHosts patch).

## 2026-06-27 (cont.) — MODE A infra fix: migrate E2B template build to build system v2

First workflow run (PR #477) failed: E2B has DEPRECATED the v1 build system —
`e2b template build` (e2b.toml + Dockerfile CLI path) now exits non-zero. The run
confirmed the E2B_API_KEY repo secret is correctly set (logs: "E2B_API_KEY is
present (length 44)"); the only failure was the deprecated CLI path.

Migrated to E2B build system v2 (SDK-based, builds on E2B cloud infra):
- `infra/e2b/build.mjs` — defines the template via `Template().fromDockerfile()`
  (reuses the committed e2b.Dockerfile as single source of truth) and publishes
  with `Template.build(template, 'navbharat-builder', { cpuCount:2, memoryMB:2048,
  onBuildLogs: defaultBuildLogger() })`.
- `infra/e2b/package.json` — declares the `e2b` SDK dep (installed e2b@2.31.0).
- workflow `e2b-template.yml` — replaced the v1 CLI step with `npm install && node
  build.mjs`; Node 22; surfaces the usable template alias in the job summary.
- README updated: e2b.toml marked legacy (v2 doesn't use it); no local Docker
  needed (v2 builds remotely).

Verified locally (npm registry is allowed in the Claude sandbox): `node --check`
passes, `e2b` SDK installs, and the v2 exports resolve — `Template` (fn),
`defaultBuildLogger` (fn), `Template().fromDockerfile()` (builder), `Template.build`
(fn). The actual remote build still needs to run via the workflow (api.e2b.dev is
egress-blocked from the Claude sandbox).

Next: admin re-runs the workflow → template publishes → set Cloud Run
E2B_TEMPLATE_ID=navbharat-builder → code-wiring PR.

## 2026-06-27 — AgentV3 phase bump: P0→P3, ready:true

PR #480 (spinner fix + 0.0.0.0 preview fix) merged and live.
Following that, bumped the engine status to reflect real state:
- `AGENTV3_PHASE` constant: `'P0'` → `'P3'` (types.ts)
- `agentV3Status().ready`: `false` → `true` (index.ts)
- Status note updated to list actual capabilities: native tool-use,
  multi-provider routing, E2B sandbox, auto-fix loop, host-binding fix.

Verified: ts-morph pre-existing errors unchanged; vitest 2668/2676 pass (same
8 pre-existing CodemodeExecutor failures, none new).

Pushed to branch `claude/kind-lovelace-chcxp6`. PR needed to merge to main.
GitHub MCP tools unavailable in this session — admin can open PR from branch
or merge directly once CI is green.

## 2026-06-27 — Power levels: 3-tier Opus billing (5×/10×/20×) + reasoning effort

Admin (aashishcpmt09 / doc.asheesh) authorized a new power/billing structure for
NavBharatAI Pro v3.0:
- Power OFF (normal): Sonnet routing, billed ×3.5; the empty-build retry now
  escalates to Opus at its LOWEST effort as the ceiling ("opus ka sabse lower
  version") — billing stays normal (no surprise).
- Power 5× (mini): Opus, reasoning effort "low", billed ×5.
- Power 10× (medium): Opus, effort "medium", billed ×10.
- Power 20× (max / ultracode): Opus, effort "max", billed ×20.

Implementation (real, end-to-end, fully wired):
- NEW `src/server/AgentV3/powerLevel.ts` (pure, tested): PowerLevel type,
  toPowerLevel() (back-compat with legacy onlyOpus boolean → 'mini'), powerSpec()
  → {powerMode, effort, ceilingEffort, multiplier}.
- `pricing.ts`: POWER_MULTIPLIERS {mini:5, medium:10, max:20}; billedAmountUsd /
  billedAmountInr accept `BillingPowerLevel | boolean` (old boolean path unchanged).
- `models.ts`: resolveModel accepts boolean | PowerLevel (power-on → Opus).
- `ClaudeClient.ts`: RunTurnParams.effort → output_config.effort (Opus 4.8 lever;
  budget_tokens is removed on Opus 4.8 per claude-api skill). Only sent for Opus runs.
- `AgentRunner.ts`: powerLevel + effort options; bills by powerLevel; threads effort
  into every runTurn.
- route `agentv3.ts`: parses `powerLevel` (falls back to onlyOpus); passes
  powerLevel + effort into base/plan/retry runners; empty-build retry forces Opus +
  ceiling effort. Billing flows through result.billedUsd (power-level aware).
- Frontend `AgentV3Panel.tsx`: replaced the single Power toggle with a 4-way
  segmented selector (Off / 5× / 10× / 20×) + plain-language hint; `useAgentV3Build.ts`
  sends `powerLevel` in the build request body.
- `AppKnowledgeBase.ts`: updated the v3.0 entry to describe the Power selector.

Verified: frontend tsc clean, server tsc clean (only pre-existing ts-morph errors),
new tests 26/26 pass (powerLevel 8 + pricing 12 + models 5; pricing/models extended).
Full suite: 2678 pass, same 8 pre-existing CodemodeExecutor/ts-morph failures, none new.

API mapping confirmed against the claude-api skill: Opus 4.8 effort =
output_config.effort (low|medium|high|xhigh|max), GA, no beta header; budget_tokens
is rejected (400) on Opus 4.8 — adaptive thinking + effort only.

## 2026-06-28 — forensic root cause: v3.0 "cannot build an app" → readiness gate false-fail

Four parallel forensic audits (build-path, gates, sandbox, model-provider) of why v3.0
still couldn't build. Admin confirmed ANTHROPIC_API_KEY is a REAL Anthropic key (no proxy),
which rules out the provider-degradation theory and points squarely at:

**ROOT CAUSE:** the mandatory readiness gate (#459, AgentRunner.ts:288-301 → ToolDispatcher
.assessBuildReadiness → evaluate scan) judges an INCOMPLETE in-memory project graph. The graph
is populated ONLY by the indexing write-tools (write_file/edit_file/apply_patch). Files seeded by
the actuator scaffold or created via bash/npm — and the index.html entry — never enter the graph.
So analyzeArchitecture flags their imports as "unresolved import" and analyzeRunnability claims
"no index.html" — both HARD blockers — and the gate downgrades a real, working build to ok:false
("build did not complete"). warmIndexFiles only ran in EDIT mode, never on a fresh build, so fresh
builds tripped this almost every time. The files existed; the verdict was the lie.

**FIX (this PR):** ToolDispatcher.assessBuildReadiness() now calls a new seedGraphFromWorkspace()
BEFORE the evaluate scan — it reads the REAL workspace file tree (code + index.html + key configs,
excluding node_modules/.git/dist/build/.next/__pycache__, capped 500 files × 250KB) and indexes
them into the project graph. The gate now judges the app that actually exists, so scaffold/bash
files resolve and runnability sees index.html. Best-effort: never throws, already-indexed files
keep their write-tool facts. Test added asserting the graph is seeded from actuator-only files.

Other confirmed (separate follow-ups): #480's 0.0.0.0 host-bind + public-host health-check fix
landed in the LEGACY actuator (src/server/EngineerAI/) not the v3.0 one (src/server/AgentV3/
sandbox/EngineerAI/) — can cause blank/502 previews; and buildActuator() silently falls back to
LocalActuator when E2B_API_KEY is missing. These are preview-quality issues, tracked next.

Gate: frontend tsc 0, server tsc 0, vitest 2687/2687 PASS.

## 2026-06-28 (cont.) — v3.0 preview blank/502 fix: host-binding in the CORRECT actuator

Secondary cause from the forensic audit: #480's 0.0.0.0 host-bind fix landed in the LEGACY
actuator (src/server/EngineerAI/actuators/) but v3.0 runs on src/server/AgentV3/sandbox/
EngineerAI/actuators/E2BActuator.ts — which launched the dev command verbatim. When a project's
vite/next config does not set host:true, the dev server binds localhost only: the `nc -z localhost`
health check PASSES but the PUBLIC {port}-{id}.e2b.app preview 502s → "built but preview blank".

Fix: added a v3.0-local devServerHost.ts (ensureHostBinding) — self-contained so v3.0 never
depends on the retired legacy module — and applied it to the dev command in the actuator's
long-running branch (both the initial launch and the auto-restart retry). No-op when the command
already binds a host (e.g. our vite-react template's host:true), so it's pure belt-and-suspenders
for frameworks/configs that don't. 6 unit tests mirror the legacy helper's coverage.

Gate: frontend tsc 0, server tsc 0, vitest 2707/2707 PASS.

## 2026-06-28 — P1.1 API Versioning DONE (UPGRADE v3.0 roadmap, phase-by-phase march begin)

First implemented phase of the UPGRADE_v3.0.md roadmap (one phase at a time, fully
shipped: complete → rock-solid → polish → PR → CI green → merge). Top incomplete
priority phase was P1 (Break-Proof Foundation); its first ❌ MISSING item was P1.1.

WHAT: introduced `/api/v1/...` API versioning, purely additively (no current request
ever breaks). New `src/server/routes/apiVersion.ts` mounts ONE pre-route middleware:
- `/api/v1/foo` is internally rewritten to the existing `/api/foo` handler (req.url
  mutation, the documented Express way) → every route is instantly versioned, zero
  per-route edits. Versioned responses stamp `X-API-Version: v1`.
- bare `/api/foo` still works unchanged but is now a DEPRECATED shim: responses carry
  `Deprecation: true`, `X-API-Version: unversioned`, and `Link: </api/v1/foo>;
  rel="successor-version"`. Unversioned paths are a PERMANENT compat layer (never remove).
Pure helpers `rewriteVersionedPath` / `successorVersionPath` are unit-tested (17 tests).
Version contract documented in AGENTS.md (new "API VERSIONING CONTRACT" section).

VERIFIED (gate, all green): frontend tsc 0, server tsc 0, vitest 2737/2737 PASS,
server bundles + boots, and a LIVE curl proved it end-to-end:
  /api/v1/health   → 200, X-API-Version: v1, real handler body
  /api/health      → 200, X-API-Version: unversioned, Deprecation: true, successor Link
Files: server.ts, src/server/routes/apiVersion.ts (+ .test.ts), AGENTS.md, UPGRADE_v3.0.md.

## 2026-06-28 — P1.3 Circuit Breaker DONE (UPGRADE v3.0, phase 2 of the march)

Replaced the router's flat per-provider cooldown with a REAL circuit breaker
(CLOSED / OPEN / HALF_OPEN). New src/server/AI/Router/CircuitBreaker.ts:
- failure → OPEN for a cooldown; consecutive failures ESCALATE the cooldown
  (exponential backoff, capped 5 min); cooldown elapses → HALF_OPEN; next request
  is a trial probe → success closes + resets, failure re-opens (escalated).
- Pure/deterministic (every method takes `now`) → fully unit-tested without timers.
- Below the failure threshold the cooldown equals exactly the OLD value, so this is
  a strict, break-proof superset of prior behaviour — never worse.

Integrated into AIRouter.ts via the THREE existing chokepoints (zero control-flow
change → covers all 3 universes + route/routeRaced/routeStream):
  isOnCooldown → breaker.isBlocking(); setCooldown → breaker.recordFailure()
  (still mirrored cross-instance via ProviderCooldownStore); the single success
  chokepoint recordProviderLatency(...,false) → breaker.recordSuccess().
getProviderStats() additionally reports circuitState + consecutiveFailures
(existing cooldownUntil field kept → Admin dashboard untouched).

VERIFIED (gate green): frontend tsc 0, server tsc 0, vitest 2750/2750 PASS
(29 new: CircuitBreaker 24 + existing AIRouter 5 still green), server boots,
/api/health 200. Backend infra (no user surface) → no AppKnowledgeBase entry needed.
Files: src/server/AI/Router/CircuitBreaker.ts (+ .test.ts), AIRouter.ts, UPGRADE_v3.0.md.

## 2026-06-28 — P1.4 Idempotency & Deterministic Jobs DONE → PHASE P1 COMPLETE (100%)

Idempotency keys on build-job creation so retries never double-run:
- BuildJob gains idempotencyKey; BuildJobManager.createJob(prompt, key?) reuses the
  SAME job for a duplicate key (returns existing id) unless the prior attempt terminally
  FAILED (then a fresh retry is allowed). New findExisting() +
  JobStore.findJobByIdempotencyKey() implemented for BOTH stores (Firestore indexed
  where+orderBy query; LocalFile dir scan). Job ids now `job-<ms>-<seq>` (monotonic
  suffix → no same-ms collisions). AppMakerOrchestrator.execute(prompt, ns, key?) only
  spawns the worker for a genuinely-new job. Added a useStore() test seam.
- Replay-safety confirmed already present: ExecutionOrchestrator.restoreFromCheckpoint()
  + resumeExecution() rebuild the scheduler from checkpointed task statuses + patches →
  resume re-runs ONLY incomplete tasks (completed tasks never re-execute).

VERIFIED (gate green): frontend tsc 0, server tsc 0, vitest 2759/2759 PASS (9 new),
server bundles. Backend infra (no user surface) → no AppKnowledgeBase entry needed.

Phase P1 (Break-Proof Foundation) is now 100%: P1.1 API versioning, P1.2 migrations
(pre-existing), P1.3 circuit breaker, P1.4 idempotency — all DONE.
Files: BuildJobManager.ts (+.test.ts), JobStore.ts, LocalFileJobStore.ts,
FirestoreJobStore.ts, AppMakerOrchestrator.ts, UPGRADE_v3.0.md.

## 2026-06-28 — P2.1 Distributed Tracing + Metrics DONE (Phase P2 begins, 25%)

Real, dependency-free distributed tracer (src/server/observability/Tracer.ts):
W3C trace/span ids, parent→child span trees, bounded ring buffer, AsyncLocalStorage
context propagation, withSpan/recordChildSpan helpers — all best-effort, never throws.
Cloud Trace export with NO SDK + NO creds: each completed span emits a Cloud Logging
structured line with logging.googleapis.com/trace + spanId → Cloud Run auto-correlates
into Cloud Trace. Incoming X-Cloud-Trace-Context is parsed so spans join the platform trace.

Wired surgically (no hot-path control-flow change):
- ROOT request span in server.ts traceMiddleware (start at entry, end on res.finish with
  status/method/path; context kept active via tracer.runInSpan(span, next)).
- AI provider child span at the single recordProviderLatency chokepoint in AIRouter.ts
  (every provider call, all 3 universes, traced under its request).
New admin-gated endpoints: GET /api/observability/traces (recent span trees) +
/api/observability/metrics (per-span count/error/avg/p95 + per-provider stats).
ObservabilityManager.trackLatency now also emits a span (compat facade kept).

VERIFIED (gate green): frontend tsc 0, server tsc 0, vitest 2775/2775 PASS (16 new),
server boots, and a LIVE curl proved it end-to-end: GET /api/health produced a real
"HTTP GET /api/health" span (status ok, 5ms, http attributes) readable via
/api/observability/traces?admin=…; no-admin → 403. Backend/admin observability (no
end-user surface) → no AppKnowledgeBase entry.
Files: observability/Tracer.ts (+.test.ts), routes/observability.ts, server.ts,
AIRouter.ts, ObservabilityManager.ts, UPGRADE_v3.0.md.

## 2026-06-28 — P2.2 Error Tracking (external) DONE (Phase P2 → 50%)

Real external error tracking via Cloud Error Reporting (no SDK, no creds — same
log-correlation pattern as P2.1). New src/server/observability/ErrorTracker.ts:
captured errors emit a Cloud Error Reporting-compatible structured log
(@type ReportedErrorEvent + serviceContext + full-stack message) → Cloud Run
auto-ingests (grouped/alertable); also kept in a bounded ring buffer and correlated
with the active trace. Best-effort, never throws.

Backend: installGlobalErrorHandlers() (uncaughtException + unhandledRejection →
report-and-continue, never crash the service) at startup; Express error-handling
middleware (registered LAST) captures route errors with request context → clean 500.
Frontend: existing window.error/unhandledrejection reporters now flow through the
tracker; ErrorBoundary.componentDidCatch additionally reports React render errors
(prod-only, best-effort). Admin view: GET /api/observability/errors (recent + summary).

VERIFIED (gate green): frontend tsc 0, server tsc 0, vitest 2784/2784 PASS (9 new),
server boots, LIVE: POST /api/logs/error captured + read back via
/api/observability/errors?admin=…; no-admin → 403. Backend/admin observability →
no AppKnowledgeBase entry. Files: observability/ErrorTracker.ts (+.test.ts), server.ts,
routes/telemetry.ts, routes/observability.ts, components/ErrorBoundary.tsx, UPGRADE_v3.0.md.

## 2026-06-28 — P2.3 Bulkhead Isolation DONE (Phase P2 → 75%)

Was: AIRouter's in-flight concurrency pool was a module-level map keyed by provider
NAME only, shared across all AIRouter instances → a FREE spike saturating a shared
provider (Grok) starved PRO/professional of slots.

Fix: each universe gets its OWN in-flight pool keyed `${universe}:${provider}`.
AIRouter now takes a `universe` label (new AIRouter('free'|'pro'|'professional'),
wired in AIRouterManager.buildFree/buildPro/buildProfessional); all slot
acquire/release/capacity checks go through per-universe helpers (slotKey/acquire/
release/inFlightCount). The circuit breaker STAYS keyed by provider name (shared) —
a 429/quota is provider-wide health that should back every universe off; only the
concurrency pool (local fairness) is isolated. getProviderStats() aggregates in-flight
back per provider (total + new inFlightByUniverse breakdown) so the Admin dashboard
shape is preserved and the bulkhead pools are observable.

VERIFIED (gate green): frontend tsc 0, server tsc 0, vitest 2787/2787 PASS (3 new
bulkhead tests prove a saturated FREE pool doesn't block PRO; existing 16 router tests
still green), server bundles. Backend infra → no AppKnowledgeBase entry.
Files: AI/Router/AIRouter.ts (+ AIRouterBulkhead.test.ts), AI/AIRouterManager.ts, UPGRADE_v3.0.md.

## 2026-06-28 — P2.4 Disaster Recovery / Backup DONE → PHASE P2 COMPLETE (100%)

Real DR/backup + health probes:
- src/server/lib/FirestoreBackup.ts: real Firestore Admin exportDocuments REST call
  (auth via Cloud Run SA / ADC) → GCS bucket, timestamped prefix (no overwrite).
  Admin-triggered POST /api/admin/backup/firestore. Honest "not configured" when
  FIRESTORE_BACKUP_BUCKET unset — never fakes, never throws.
- src/server/routes/health.ts: GET /api/live (liveness) + GET /api/ready (503 until
  init, then 200 w/ dependency report). markServerReady() flips ready on app.listen.
- docs/DR_RUNBOOK.md: scheduled export (Cloud Scheduler + bucket/IAM), restore
  (gcloud firestore import), probe wiring (gcloud run services update --startup-probe/
  --liveness-probe), incident checklist — all copy-pasteable.
- cloudbuild.yaml: documentation note pointing to runbook §3 for the probe wiring.
  Per safeguard #3, the probe flags are applied via a manual one-time gcloud command
  (operator watches deploy) rather than baked into the unattended deploy step — a wrong
  flag there would fail the auto-deploy.

VERIFIED (gate green): frontend tsc 0, server tsc 0, vitest 2796/2796 PASS (9 new),
server boots, LIVE: /api/live 200, /api/ready 200 (initialized:true), backup trigger →
honest 400 "not configured", no-admin → 403. Admin/infra/ops endpoints → no
AppKnowledgeBase entry.

Phase P2 (Resilience & Observability) now 100%: P2.1 tracing, P2.2 error tracking,
P2.3 bulkhead, P2.4 DR/backup — all DONE.
Files: lib/FirestoreBackup.ts (+.test.ts), routes/health.ts (+.test.ts), server.ts,
docs/DR_RUNBOOK.md, cloudbuild.yaml, UPGRADE_v3.0.md.

## 2026-06-28 — P3.2 Offline-First Runtime DONE (Phase P3 begins, 25%)

Note: P3.1 (split 9,156→6,252-line App.tsx into <1,500) deferred — a large multi-PR
refactor with high regression risk on the live app; not safe for a single autonomous
cycle (safeguard #3 / rule #1). Picked P3.2 (self-contained, real, low-risk).

P3.2 — offline-first, built SAFELY (break-proof on a payments app):
- public/sw.js: network-first → cache-fallback for an ALLOWLIST of safe read-only GET
  API endpoints (/api/agentv3/conversations, /api/agentv3/status). Online users always
  get fresh data; cache served only when offline. New navbharat-api-v1 cache preserved
  across SW activations (activate KEEP list updated).
- src/lib/offlineQueue.ts (IndexedDB-backed): fire-and-forget writes that fail offline
  are buffered + replayed on the 'online' event. Replay STRICTLY allowlisted to
  idempotent/harmless endpoints (/api/analytics/event, /api/logs/error) — payments/
  builds/auth NEVER queued. Injectable store+fetch for tests; never throws.
- main.tsx: client error reporters routed through offlineQueue.postWithFallback;
  installOfflineQueueFlush() drives reconnect replay.

VERIFIED (gate green): frontend tsc 0, server tsc 0, vitest 2805/2805 PASS (9 new),
production vite build OK, node --check public/sw.js OK (dist/sw.js has new logic).
Runtime resilience (no new navigable surface) → no AppKnowledgeBase entry.
Files: public/sw.js, src/lib/offlineQueue.ts (+.test.ts), src/main.tsx, UPGRADE_v3.0.md.

## 2026-06-28 — P3.3 Scalability/HA DONE (keep-warm, ultracode workflows) (Phase P3 → 50%)

New GET /api/warm (src/server/routes/warm.ts) pre-warms the heavy PRO/SDA lazy
singletons: 3 AI router universes + env-only health, SDA clinical KB + sda_chat
app-context, Gemini SDK client, Firestore admin client (light reads on UserCost/
ProviderState/Log/Metrics). BILLING-SAFE: constructs client objects ONLY, never a real
billed model call (a warm-traffic Anthropic/Vertex/Gemini ping would spend NavBharatAI's
OWN account — explicitly avoided). External Cloud Scheduler hits it → min-instances=0
stays. Self-ping rejected (keeps instance alive 24/7, doesn't warm the cold request).

Built with ultracode multi-agent workflows:
- Discovery workflow (6 agents): mapped every heavy lazy-init singleton + multi-region
  readiness → exact billing-safe warm design.
- Adversarial review workflow (38 agents, 4 lenses → verify): confirmed billing-safety
  end-to-end AND surfaced 3 real issues, all fixed:
  * CRITICAL unauthenticated endpoint had no throttle → cost-amplification. FIX: warmup
    runs at most once/30s; a flood gets the cached report (cached:true) at ~zero cost;
    in-flight run shared (a burst = one warmup). Scheduler's 5-min cadence always re-runs.
  * HIGH raw error messages in public response → info disclosure. FIX: generic 'failed'
    marker in the response; full detail → server logs (console.warn → Cloud Logging).
  * MEDIUM Firestore cost undocumented → added cost-model comment (capped by throttle).
Always returns 200. docs/SCALABILITY.md: keep-warm setup (Cloud Scheduler gcloud cmd) +
multi-region readiness (config-only). cloudbuild.yaml: doc note.

VERIFIED (gate green): frontend tsc 0, server tsc 0, vitest 2813/2813 PASS (8 new),
server boots, LIVE: /api/warm 200 13/13 ok, 2nd call cached:true (throttle), no raw error
leak. Admin/ops endpoint → no AppKnowledgeBase entry.
Files: routes/warm.ts (+.test.ts), server.ts, docs/SCALABILITY.md, cloudbuild.yaml, UPGRADE_v3.0.md.

## 2026-06-28 — P3.4 Real CDN / Edge Caching DONE (Phase P3 → 75%; P3.1 deferred)

Made static assets CDN-ready AND fixed a real live bug found while scoping: sw.js matched
the .js rule and was served Cache-Control: immutable, max-age=1y — pinning the service
worker for a year (fights SW/PWA updates; a CDN would cache it too). Now sw.js +
manifest.json are no-cache, no-store, must-revalidate.

- New src/server/lib/staticCache.ts (cacheControlFor) = single source of truth: hashed
  JS/CSS/fonts/wasm → public, max-age=31536000, immutable (edge-cacheable by ANY CDN);
  images → 1 week; HTML/sw.js/manifest → revalidate. server.ts static handler uses it.
- firebase.json hosting.headers mirrors the policy → Firebase Hosting's global CDN serves
  identically (config complete; `firebase deploy --only hosting` fronts assets with a real CDN).
- docs/CDN.md: honest provisioning guide (Firebase Hosting CDN / Cloud CDN via LB+NEG /
  Cloudflare). App config complete; actual CDN provisioning is the documented admin infra step.

VERIFIED (gate green): frontend tsc 0, server tsc 0, vitest 2821/2821 PASS (8 new incl.
sw.js-not-immutable regression guard + firebase.json-mirrors-policy check), vite build OK,
server boots, LIVE curl -I: sw.js → no-cache, hashed asset → immutable 1y, manifest → no-cache.

Phase P3 at 75%: P3.2 offline-first, P3.3 keep-warm, P3.4 CDN all DONE. P3.1 (split the
6,252-line App.tsx into <1,500) intentionally DEFERRED — large multi-PR refactor, high
regression risk on the live app, not safe for a single autonomous cycle (safeguard #3).
Files: lib/staticCache.ts (+.test.ts), server.ts, firebase.json, docs/CDN.md, UPGRADE_v3.0.md.

## 2026-06-28 — ROOT CAUSE: v3.0 builds stopped midway + zero Claude tokens → cheap-first provider order

Admin reported builds "band ho jaate hain bich me" and that NOT ONE Claude token was used.
Forensic trace of the build provider chain (agentv3.ts buildTurnRunner + MultiProviderTurnRunner):

ROOT CAUSE: the v3.0 build chain was CHEAP-FIRST by default — [Vertex → Gemini → Claude → Haiku].
buildTurnRunner was called without claudeFirst, and the default was false (only AGENTV3_BUILD_
CLAUDE_FIRST=1 or escalation flipped it). MultiProviderTurnRunner returns the first NON-THROWING
result, so Gemini/Vertex handled EVERY turn (→ zero Claude tokens) and when Gemini hit a quota/
rate/output-token limit mid-build it returned a truncated/poor turn that was ACCEPTED (not thrown),
so the agent loop stalled/stopped midway instead of falling through to Claude. This also violated
the v3.0 constitution (CLAUDE.md: "v3.0 always runs on NavBharatAI's own Anthropic/Claude account").

FIX: v3.0 builds now lead with CLAUDE by default. New pure resolveClaudeFirst(opts, env) — Claude-
first unless AGENTV3_BUILD_CLAUDE_FIRST=0/off (opt-out to the old cheap-first ladder); escalation's
explicit claudeFirst:true still honoured. Chain becomes [Claude → Vertex → Gemini → Claude-Haiku]
so builds use the reliable strong-tool-use model and COMPLETE, with Gemini/Vertex as fallback if
Claude throttles. Billing unchanged (Opus-equivalent markup regardless of model; margin only wider
since NavBharatAI's real cost ≤ billed). 5 unit tests for resolveClaudeFirst.

This is the 3rd of three converging build fixes this cycle: #489 (readiness gate false-fail),
#490 (preview host-bind in correct actuator), and now provider order (Claude-first).

Gate: frontend tsc 0, server tsc 0, vitest 2817/2817 PASS.

## 2026-06-28 — cost routing step 1: build model by app complexity (admin policy)

Admin's provider policy: small app → Haiku, complex app → Sonnet, power → Opus
(planning → Grok and chat → Gemini are step 2). Step 1 implements the build-model
half: new pure selectBuildModel(startTier, powerOn) replaces the always-Sonnet
`resolveModel(onlyOpus)` at the build call site. Maps the analyser's start tier:
gemini/haiku/none → Haiku (cheap, reliable tool-use); sonnet/opus → Sonnet; any
power level → Opus. Gemini/Vertex stay as the buildTurnRunner fallback so a Claude
throttle never breaks a build; billing unchanged (Opus-equivalent markup). 4 unit
tests incl. real analyser verdicts (calculator → Haiku, auth+DB SaaS → Sonnet).

This cuts cost on the common case (most apps are simple → Haiku, not Sonnet) with
zero quality compromise (complex work still gets Sonnet; power gets Opus). Step 2
(plan → Grok via OpenAiToolRunner at api.x.ai; chat → Gemini/Vertex confirm) next.

Gate: frontend tsc 0, server tsc 0, vitest 2829/2829 PASS.

## 2026-06-28 — cost routing step 2: PLAN phase runs on Grok (admin policy)

Step 2 of the admin provider policy (small→Haiku, complex→Sonnet, power→Opus, chat→Gemini
already; now PLAN→Grok). The plan/todo phase uses the update_todo tool, so it needs tool-use —
Grok's API is OpenAI-compatible and the existing OpenAiToolRunner drives it.

- New grokPlanRunner(): OpenAI client at https://api.x.ai/v1 (GROK_API_KEY/XAI_API_KEY) wrapped
  in OpenAiToolRunner (model grok-3, env AGENTV3_GROK_PLAN_MODEL), inside a multi-provider
  [Grok → Claude] runner so a Grok outage/limit falls back to a cheap Claude (Haiku) and the
  plan NEVER breaks. Returns null when no Grok key (→ caller keeps the normal build client).
- Plan runner now uses planGrok ?? client, with model = haikuModel() on the Grok path (Grok
  forces grok-3; the cheap Haiku id is only the Claude fallback model).
- New pure planGrokEnabled(apiKey, disableFlag) (AGENTV3_PLAN_GROK=0/off opt-out) — 3 tests.

Backend router-priority change → no AppKnowledgeBase entry needed (per CLAUDE.md). Chat already
runs on the free router (Vertex/Gemini/Grok), matching "simple chat → Gemini/Vertex".

Full admin policy now live: chat→Gemini/Vertex, plan→Grok, small build→Haiku, complex→Sonnet,
power→Opus — with Claude/Gemini fallbacks so builds never break. Cost down, quality preserved.

Gate: frontend tsc 0, server tsc 0, vitest 2832/2832 PASS, boot:check PASS.

## 2026-06-28 — P4.2 Event Sourcing + Replay DONE (ultracode workflows) (Phase P4 → 50%)

Made EventHistoryStore replayable. New WorkspaceProjection.ts: PURE replayWorkspaceState
reducer folds a workspace's event log into a lifecycle / mutation-ledger / VCS-ref /
checkpoint projection; exposed as EventHistoryStore.replayWorkspace(workspaceId) +
replayByCorrelationId(correlationId).

HONEST by construction: discovery (5-agent workflow) proved AppMakerLab event payloads
carry NO file paths/content (mutation events hardcode workspaceId:'default' + payload
{id}). So the projection rebuilds ONLY what events prove (lifecycle, mutation ledger by
tx id, VCS hashes/branch, checkpoint ids, build/gen errors) and is explicit it CANNOT
rebuild bytes: reconstructable:false + notes[], deliberately NO fake filesPresent[].
Byte-level restore stays the Journal/Checkpoint path. Two entry points handle the
workspaceId-vs-correlationId gap honestly.

Adversarial review (30-agent workflow) caught real bugs, all fixed:
- COUNT-DRIFT (findings 6/8/11/12, root cause): counts were incremented per-event →
  drifted from the ledger (STARTED→FAILED→ROLLED_BACK double-counted; duplicates
  double-counted). FIX: counts are now DERIVED from the final ledger state after the fold
  — each distinct batch counts once as its final state; replays never double-count.
- GENERATION_FAILED + REPAIR_COMPLETED were unhandled → lifecycle stuck (GENERATING/
  REPAIRING). FIX: added cases (+ GENERATION_FAILED/REPAIRED lifecycle states,
  lastGenerationError field).
- Dual VCS event types (VCS_COMMITTED/commitHash vs VCS_COMMIT_COMPLETED/commitId; LKG
  pair) + REPAIR_STARTED-no-payload are PRE-EXISTING publisher smells — documented in
  code, OUT of P4.2 scope (refactoring publishers risks VCS/build flow).

VERIFIED (gate green): frontend tsc 0, server tsc 0, vitest 2838/2838 PASS (17 new),
reducer pure (deep-equal output, input untouched). Backend module (no live endpoint —
the per-build store is ephemeral + AppMakerLab is dormant; an endpoint would need risky
shared-store plumbing, deferred) → no AppKnowledgeBase entry. Files: eventbus/
WorkspaceProjection.ts (+.test.ts), EventHistoryStore.ts, IEventHistoryStore.ts, UPGRADE_v3.0.md.

## 2026-06-28 — P4.3 Full AST consolidation DONE (Phase P4: P4.2 + P4.3 done)

The older Memory/MemoryIndexer.ts used a single regex capturing only the FIRST export
per file. Consolidated it onto the real ts-morph AST analyzer (AgentV3/ASTAnalyzer.ts):
- New MemoryIndexer.indexWithAST(): runs the regex baseline FIRST (zero-regression — its
  result is always kept), then ENRICHES via analyzeWithAST — adds EVERY exported
  symbol/component name (not just the first) + detected route paths. Graceful: AST null
  on unsupported file / parse failure / ts-morph missing → keeps exactly the regex
  baseline. Never throws. Strict-superset design → can only enrich, never regress.
- Wired live end-to-end (not half-done): ProjectMemoryManager.update now async →
  indexWithAST; WorkspaceManager.createFile/modifyFile await it (both already async).
- Sync MemoryIndexer.index kept unchanged as the back-compat regex fallback.

VERIFIED (gate green): frontend tsc 0, server tsc 0, vitest 2855/2855 PASS (6 new AST
tests: all-exports / React components / routes / regex-baseline-preserved / never-throws
/ dedup; 6 existing regex tests still green), server bundles. Backend code-model
internal (no user surface) → no AppKnowledgeBase entry.
Files: Memory/MemoryIndexer.ts, Memory/ProjectMemoryManager.ts, AI/WorkspaceManager.ts,
tests/memoryIndexer.test.ts, UPGRADE_v3.0.md.

## 2026-06-28 — P4.4 Replication / Consistency DONE (Phase P4 → 75%)

Was: POST /api/sync/:userId BLINDLY overwrote the whole stored workspace doc → a device
saving a stale view silently dropped another device's newer sessions (classic lost-update).

Fix: enforced last-write-wins PER SESSION, SERVER-SIDE. The POST now reads the stored
workspace and MERGES the incoming payload into it (new src/server/project/SyncMerge.ts)
before writing: sessions merged by id (newer lastUpdated wins; ties → incoming), sessions
unique to either side always kept, lastApp preserved when incoming is empty. The merged
UNION is encoded + written. No cross-device session can be lost again.

Backward compatible — NO client/App.tsx change needed: existing clients keep POSTing
{sessions, lastApp} and get the merge for free (enforcement is authoritative on the
server). Corrupt prior state falls back to a blind write so a save is never lost.
Documented the model + boundaries (LWW-per-session, not field-level CRDT) in
docs/SYNC_CONSISTENCY.md.

VERIFIED (gate green): frontend tsc 0, server tsc 0, vitest 2864/2864 PASS (9 new incl.
the classic lost-update case, stale-no-clobber both directions, lastApp preservation),
server bundles. Backend sync infra (no new user surface) → no AppKnowledgeBase entry.

Phase P4 at 75%: P4.2 event replay, P4.3 AST consolidation, P4.4 replication all DONE.
Only P4.1 (CQRS — large refactor of the legacy AppMakerLab path) remains.
Files: project/SyncMerge.ts (+.test.ts), routes/sync.ts, docs/SYNC_CONSISTENCY.md, UPGRADE_v3.0.md.

## 2026-06-28 — Phase P5 Hygiene: P5.1 assessed/kept + P5.3 done (P5 → 67%)

P5.1 (hardcoded Firebase key fallback) — ASSESSED, intentionally KEPT (do NOT remove):
- Load-bearing in prod: verified the Docker/Cloud Build pipeline injects NO VITE_FIREBASE_*
  vars, so at build time import.meta.env.VITE_FIREBASE_* is undefined and the app relies
  entirely on these defaults — removing them would break Firebase init (auth/Firestore/sync)
  for every user.
- Not a secret: a Firebase WEB apiKey is public by design (access gated by Firebase Security
  Rules, not key secrecy); real secrets are server-side service-account keys, not in client.
- Documented the rationale inline in src/config/firebase.ts. Env vars still take precedence
  when present. Genuine removal requires wiring the build to inject vars FIRST (infra,
  deferred per safeguard #3). This is the correct engineering decision, not avoidance.

P5.3 (delete throwaway scripts/junk) — DONE:
- Root junk .txt files already gone (confirmed none remain).
- Removed 3 dead ad-hoc manual test/report scripts (console.log harnesses superseded by the
  Vitest suite, referenced nowhere, not in any npm/CI script):
  src/server/workspace/hardening_test.ts, validation_tests.ts, verification_report.ts.

P5.2 (monorepo tooling pnpm/Turborepo) — DEFERRED: large, high-blast-radius build-system
migration; not safe for a single autonomous cycle.

VERIFIED (gate green): frontend tsc 0, server tsc 0, vitest 2864/2864 PASS after removal.
Files: src/config/firebase.ts (comment), src/server/workspace/{hardening_test,validation_tests,verification_report}.ts (removed), UPGRADE_v3.0.md.

## 2026-06-28 — P-TQA.5 Bundle Size Budget Enforcement DONE

First item from the P-* feature phases (P1-P5 core done modulo deferred big refactors).
Picked the highest-value, code-ownable, zero-runtime-risk item.

scripts/bundleBudget.mjs: after `vite build`, reads dist/assets, gzips every JS/CSS chunk,
fails (exit 1) on any budget breach. Pure checkBudget() + measureDist() (custom fs +
zlib.gzipSync, no new dep). npm run test:bundle. New CI step after Build in ci.yml →
bundle bloat now BLOCKS merge. Unit-tested: tests/bundleBudget.test.ts (6 — pass, each
violation type, multi-violation, budgets-exceed-current guard).

Honest budgets = current reality + ~15% headroom (a "no further bloat" regression guard,
NOT the spec's aspirational 500KB which the current ~567KB main chunk already exceeds):
largest chunk ≤650KB gz (now ~567), total JS ≤1050KB gz (now ~918), total CSS ≤50KB gz
(now ~33). The large main chunk is a known code-splitting opportunity (separate task);
this stops it growing unchecked. Documented inline.

VERIFIED (gate green): frontend tsc 0, server tsc 0, vitest 2870/2870 PASS (6 new),
`npm run test:bundle` on real dist/ → within budget (567/650, 918/1050, 33/50), and an
artificial-bloat run correctly exits non-zero. CI/tooling (no user surface) → no
AppKnowledgeBase entry.
Files: scripts/bundleBudget.mjs, tests/bundleBudget.test.ts, package.json, .github/workflows/ci.yml, UPGRADE_v3.0.md.

## 2026-06-28 — ROOT CAUSE: v3.0 "infinite loading then stop" on even a simple app

Forensic (parallel agent): two converging server-side causes.

1) CRITICAL — Sandbox.create()/connect() in E2BActuator.getSandbox() were awaited with NO
   request-level timeout and no abort. The e2b SDK's timeoutMs is the sandbox LIFETIME, not a
   connect-request timeout. So a slow/throttled/misconfigured E2B made ensureWorkspace HANG
   before any build event was emitted → the UI showed an endless spinner ("infinite loading")
   until the SDK eventually errored far later → "stop". Fix: SANDBOX_CREATE_TIMEOUT_MS (default
   45s, env AGENTV3_SANDBOX_CREATE_TIMEOUT_MS) + a withTimeout() wrapper around every
   create/connect, so a slow sandbox THROWS and the route's ensureWorkspace try/catch surfaces
   an honest "sandbox unavailable" instead of hanging. 3 unit tests for withTimeout.

2) HIGH (regression from #511 Claude-first) — ClaudeClient retries a single overloaded turn up
   to 5× with exponential backoff (≈30-60s). Since #511 made Claude LEAD every build turn, an
   overloaded Anthropic account stalled each turn for tens of seconds = "stuck midway". Fix:
   bound the build-path Claude runners to maxRetries 2 (env AGENTV3_BUILD_CLAUDE_RETRIES), so a
   Claude-led turn falls through to Gemini/Vertex in a few seconds instead. Applied to the
   build chain Claude + Haiku backstop + Claude-only path + the Grok-plan Claude fallback.

Gate: frontend tsc 0, server tsc 0, vitest 2867/2867 PASS, boot:check PASS.

## 2026-06-28 — ROOT CAUSE: "model replied without building" (narrates a plan, writes 0 files)

Admin screenshots: prompt "ek simple search engine page banao", the model narrates a full plan in
Hindi ("…अब मैं frontend विशेषज्ञ को index.html बनाने का काम सौंप रहा हूँ"), then a yellow banner:
"The build did not produce any files — the model replied without building", PLAN 0/4. It failed on
BOTH the first attempt AND the Opus "stronger model" retry — so NOT a model-weakness issue.

ROOT CAUSE (AgentRunner.ts:294): the loop treats ANY no-tool turn as "the model finished its turn"
and exits. The architect's first turn is usually a plan/delegation narration ("here's my plan, now
I'll assign the frontend expert…") with NO tool call — and the runner terminated right there →
builtNothing → "model replied without building". The model intended to ACT on the next turn but
never got one. Even Opus does this plan-out-loud-first behaviour, which is why the retry also failed.

FIX: when expectsArtifacts && totalToolUses === 0 && a no-tool turn arrives, NUDGE the model to act
(push a user message: "do NOT just describe/delegate in prose — ACT NOW: use write_file/… to create
the files this turn; output tool calls, not a description") and give it another turn, up to
MAX_BUILD_NUDGES (2). Only after the nudges are exhausted with still zero tools do we report
builtNothing. New test: turn 1 narrates → nudge → turn 2 writes the file → ok:true. The existing
empty-build test still ends ok:false after nudges (fallback keeps replying text).

Gate: frontend tsc 0, server tsc 0, vitest 2874/2874 PASS, boot:check PASS.

## 2026-06-28 — ROOT CAUSE: file-creation "hallucination" → builds were silently on Gemini/Vertex

Admin's Anthropic dashboard: $0.00 spend, "No activity in the last 7 days" — PROOF that Claude was
never being called. Symptom: v3.0 reports creating files but writes ZERO real files (only file
NAMES), and when asked says "I'm an AI, I have no file system"; on a tab switch the "files" vanish
(they were never real). Cause: although #511 made builds Claude-FIRST, MultiProviderTurnRunner
returns the first NON-THROWING provider — so when Claude throws in prod (bad key / wrong model id /
base-url), the build silently fell through to Vertex/Gemini, which HALLUCINATE in the tool-use loop
(they describe creating files but never call write_file). Real tool-use (real files) only happens on
Claude.

FIX: builds now run on CLAUDE ONLY (Haiku → Sonnet → Opus + Claude-Haiku backstop). Gemini/Vertex
are removed from the BUILD chain (they remain the cheap CHAT providers only). If Claude genuinely
fails, the build errors HONESTLY with the real Claude error instead of faking files on Gemini.
AGENTV3_BUILD_ALLOW_GEMINI=1 re-adds Vertex/Gemini as a last-resort build fallback.

To diagnose the $0-Claude prod issue: GET /api/agentv3/diag?test=1&admin=<ADMIN_PASSWORD> makes one
live Claude call and returns live:{ok,status,error} — e.g. 401 (bad ANTHROPIC_API_KEY) or 404 (wrong
AGENTV3_{HAIKU,SONNET,OPUS}_MODEL id). That tells the admin exactly which Cloud Run env to fix.

Gate: frontend tsc 0, server tsc 0, vitest 2874/2874 PASS, boot:check PASS.

## 2026-06-28 — "reload pe data gayab": chat history was in-memory by default

Admin: app data disappears on reload. Audit of the persistence system:
- FILES: WorkspaceFileStore persists file CONTENT to Firestore (collection workspace_files_v3),
  NOT gated on any flag — saved after a build, re-seeded into a fresh sandbox at the next build.
  Durable (once REAL files exist; the earlier Gemini hallucination wrote none — #523 fixes that).
- CHAT/conversation: getConversationStore() used FirestoreConversationStore ONLY when
  AGENTV3_PERSIST_FIRESTORE === 'true'; otherwise InMemoryConversationStore. So unless that env
  var was set in Cloud Run, the whole transcript lived in process memory and was LOST on any
  redeploy, cold start, or — because Cloud Run runs multiple instances — a reload that landed on
  a different instance. That is the "reload pe data gayab".

FIX: default the conversation store to Firestore (durable across restarts + horizontal scaling).
Opt out with AGENTV3_PERSIST_FIRESTORE=false; VITEST always uses in-memory. FirestoreConversation
Store construction is try/caught → falls back to in-memory if Firestore is unreachable, so it
never breaks boot. Combined with #518 (session id persisted → same workspace on reload) and the
already-durable WorkspaceFileStore, a reload now restores the chat AND re-seeds the files.

Gate: frontend tsc 0, server tsc 0, vitest 2874/2874 PASS, boot:check PASS.

## 2026-06-28 — "reload pe data gayab" (part 2): Firestore DB was a free-tier-capped AI-Studio database

Admin upgraded the project (gen-lang-client-0866594388) to Blaze, but persistence STILL failed with
"Quota exceeded for 'Free daily write units per project (free tier database)' … This database cannot
exceed free quota limits even when a billing instrument is enabled." Root cause: the configured
Firestore database id is `ai-studio-cc9cd998-…` — a database Google AI Studio created in a FREE tier
that stays hard-capped to the free daily write quota EVEN on Blaze. So chat/files/memory writes were
rejected once the daily free writes ran out → nothing persisted → data gone on reload.

FIX (code): new src/server/lib/firestoreDb.ts → firestoreDatabaseId() returns
FIRESTORE_DATABASE_ID (env) || firebase-applet-config.json value || '(default)'. Wired it into every
server-side Firestore store (WorkspaceFileStore, FirestoreConversationStore, FirestoreWorkspaceMemory
Store, EngineerAI WorkspaceMemoryStore, AppMakerLab FirestoreJobStore, eventStore, FirestoreBackup),
so ALL stores read the same database id and the admin can point them at a FULL-QUOTA database
(the project's `(default)` Native DB, or a freshly created one) via the FIRESTORE_DATABASE_ID env var
— no code change needed.

ADMIN ACTION: create/confirm a full-quota Firestore database in gen-lang-client-0866594388 (Native
mode; the `(default)` DB on Blaze has full quota), then set Cloud Run env
FIRESTORE_DATABASE_ID=<that-database-id>. Then chat + files + memory persist across reloads.

Gate: frontend tsc 0, server tsc 0, vitest 2874/2874 PASS, boot:check PASS.

## 2026-06-28 — Build Diagnostics: self-diagnosing report of every issue v3.0 hits

Admin asked for a self-diagnostics tool: when v3.0 builds an app, capture EVERY issue it hit
(whether auto-solved or not) into a downloadable technical report, so it can be handed to Claude
and the rough edges fixed in code — goal: v3.0 never struggles to build an app.

New BuildDiagnostics (src/server/AgentV3/BuildDiagnostics.ts, pure + 7 unit tests): collects
structured BuildIssue records { ts, phase, severity, code, message, autoResolved, detail }. It both
DERIVES issues from the live AgentEvent stream (failed tool_result → TOOL_ERROR, done.readiness
blockers → READINESS_BLOCKER, warnings → READINESS_WARNING, error → BUILD_ERROR, preview info) and
accepts explicitly-RECORDED issues (provider fallback, sandbox-unavailable, empty-build retry).
finish(ok) back-fills ambiguous issues (tool errors / nudges / empty-build retry) as auto-resolved
when the build ultimately succeeded. report() returns counts + the issue list; renderDiagnosticsText
makes a readable .txt.

Wired into routes/agentv3.ts: a BuildDiagnostics per build, subscribed to the event stream; provider
fallbacks captured via buildTurnRunner's new onProviderError hook; sandbox-setup failure + empty-build
retry recorded; finalized at build end and shipped on the `result` event + cached per session. New
GET /api/agentv3/diagnostics (owner-scoped) returns the last build's report. Client: a "Build report"
button in the v3.0 header downloads it as JSON. AppKnowledgeBase agentv3_build_report entry added.

Gate: frontend tsc 0, server tsc 0, vitest 2881/2881 PASS, boot:check PASS.

## 2026-06-28 — Opus ONLY in power mode (admin rule, supersedes 2026-06-27)

Admin: power-off builds must NEVER use Opus, no matter what — ladder is Haiku → Sonnet (max) in
normal mode; Opus only when the Power toggle is on. selectBuildModel already obeyed this; the two
violators were the escalation paths:
- Empty-build retry forced model = resolveModel(true) (Opus) "even in normal mode" (the 2026-06-27
  rule). Now resolveModel(onlyOpus) → Sonnet in normal mode, Opus only in power. Effort no longer
  forces the Opus ceiling in normal mode. Retrying a simple app's Haiku attempt on Sonnet is still
  a real step up, and it stops a failed build from ever burning the most-expensive model (the
  "$26 failed todo" driver).
- Cost-ladder escalation (P3, dormant by default) used resolveModel(tier === 'opus'); now
  resolveModel(tier === 'opus' && onlyOpus) → caps at Sonnet in normal mode.

Gate: server tsc 0, vitest 2881/2881 PASS, boot:check PASS.

## 2026-06-28 — files vanish to 0 the instant a follow-up/retry message is sent

Admin: "3D rotating watch" build made 7 files but the app failed; on pressing Send for a retry,
the 7 files instantly became 0. Root cause: the client start() called setState(initialAgentV3State())
on EVERY new message, wiping the whole client state — including state.files → [] — immediately, before
the server even responds. So the user's project visibly disappeared the moment Send was pressed.

FIX (client, useAgentV3Build.start): reset only the TRANSIENT build state for the new turn
(narration, todos, plan, agents, done/health) and PRESERVE the durable project view — files, diffs,
workspaceId, previewUrl, repoUrl. The build's file_changed events upsert by path (applyFileChange),
so keeping the existing list shows no duplicates and the project stays visible while the retry runs.
Combined with the now-working Firestore persistence (saveWorkspaceFiles during build + the build-start
re-seed that writes durable files back into the sandbox), a retry continues editing the same 7 files
instead of starting from a blank 0.

Gate: frontend tsc 0, server tsc 0, vitest 2881/2881 PASS.

## 2026-06-28 — OneShot fast lane (Item 1): cheap one-call build for simple apps (additive)

Admin spec (merged understanding): add a fast+cheap OneShot lane INSIDE v3.0 — a complexity router at
the entry sends simple apps to OneShot, complex apps to the current multi-agent loop (untouched).
Additive, flag-gated, with the loop as the safety net → "v3.0 toot jayega" risk ~zero.

New OneShotBuilder.ts (pure helpers + injected side-effects → 11 unit tests):
- classifyForOneShot(startTier): gemini/haiku tier → one-shot; sonnet/opus → loop.
- oneShotEnabled(): on by default; AGENTV3_ONESHOT=off instantly disables (rollback).
- parseFileBlocks(): parses <<<FILE path>>> … <<<ENDFILE>>> blocks (survives ``` / JSON in code),
  rejects absolute/traversal paths, de-dupes (last wins).
- oneShotSystemPrompt/oneShotUserPrompt: one structured generation, no tools, no prose.
- runOneShot(deps): generate → parse → writeFiles (batch) → startPreview (best-effort). Returns
  ok:false (never throws) on no-files / model error → caller FALLS THROUGH to the agentic loop.

Wired into routes/agentv3.ts BEFORE the escalation/loop block: for a SIMPLE new_build, try OneShot
(one Haiku text call → write files via the same dispatcher so file_changed/onFileWrite/Firestore
all fire → install + dev + update_preview). On success result is set (steps:1, billed via
billedAmountUsd on the real Haiku usage, NEVER Opus) and the loop is skipped; on any failure it
falls through to the existing loop unchanged. New oneShotDevPort(framework) for the preview port.
BuildDiagnostics records ONESHOT_SUCCESS / ONESHOT_FALLBACK.

Net: simple apps build in ONE cheap call (no Architect, sub-agents, Opus, or rebuild spiral —
kills the "$26 failed todo"); complex apps keep the full loop; worst case = today's behavior.

Gate: frontend tsc 0, server tsc 0, vitest 2892/2892 PASS, boot:check PASS.

## 2026-06-28 — Build report: real-time + comprehensive (was empty / only saved at build end)

Admin: app still not building, files created but "Build report" shows nothing; wants EVERY issue
captured in real time. Causes: (1) lastDiagnostics was set only at the END of a build, so a still-
running / crashed / hung build left the report empty; (2) too few signals were captured.

Fixes:
- BuildDiagnostics: new onUpdate callback fired after EVERY record / ingestEvent / finish. The route
  wires it to lastDiagnostics.set(buildKey, report) → the report is persisted in REAL TIME and is
  downloadable any time, even mid-build or after a crash/hang.
- Widened capture: ingestEvent now also records problem NARRATION lines (AGENT_NOTE) — sandbox
  unavailable, port/preview not responding, errors/retries/stuck/closed-port/no-files/warnings — the
  struggles the agent talks about that never reached the report before.
- Crash capture: buildDiagRef held outside the build try; the outer catch records BUILD_EXCEPTION and
  finish(false), so a thrown build is in the report too.
- Existing capture (tool errors, provider fallbacks, readiness blockers/warnings, sandbox, empty-build
  retry, one-shot success/fallback, preview) all now flush live.

Gate: frontend tsc 0, server tsc 0, vitest 2895/2895 PASS, boot:check PASS.

## 2026-06-28 — Claude-level memory, Fix 1: inject project context into the build prompt

Admin: files now persist (good) but MEMORY is still gone — after a build hung ("stopped
responding"), saying "continue" made the AI reply "what would you like me to continue with?" —
total amnesia about the calculator it was building.

Gap list vs Claude-level memory (to fix one-by-one):
1. No project context (files + map) injected into a new message → amnesia  ← FIX 1 (this PR)
2. Prior conversation (user+agent turns) not fed to the model
3. WorkspaceMemory is in-process (per-instance), not hydrated from Firestore across instances
4. Plan/todos don't carry over (PLAN resets)
5. recall is keyword-based; "continue" recalls nothing useful
6. No running conversation summary for long sessions

FIX 1: new ProjectContext.buildProjectContext({files, projectMap, recentRequests}) (pure, 4 tests)
builds a compact "[PROJECT MEMORY — you are CONTINUING an existing project…]" block listing the real
files + project map + recent requests, ending with an explicit "do NOT ask what to continue — read
the files and resume". Wired into routes/agentv3.ts buildPrompt: hydrate the memory graph from the
real (durable, re-seeded) file tree first (warmIndexFiles) so the map is accurate even on a fresh
Cloud Run instance, then prepend the context. Best-effort, never blocks a build. The reliable signal
(the durable file list) gives the model memory even when the in-process episodes were lost.

Gate: frontend tsc 0, server tsc 0, vitest 2899/2899 PASS, boot:check PASS.

## 2026-06-28 — Claude-level memory, Fix 2: prior conversation recap into the model

Gap #2: the model never saw the prior conversation (only the new prompt), so it forgot what was
discussed/decided. Fix: new extractConversationSummary(messages, maxTurns) (pure, 3 tests) recaps a
prior transcript into "User: … / You: …" lines (notes tool calls, skips tool_result noise, caps to
last N turns). Wired into routes/agentv3.ts: load the most recent PRIOR conversation for THIS
workspace from the durable ConversationStore (listByUser → match workspaceId → get full transcript),
recap it, and prepend "[CONVERSATION SO FAR — your memory of this session]" before the build prompt.
Best-effort, never blocks. Together with Fix 1 (file/project context) the agent now resumes with both
the project state AND the conversation memory.

Gate: frontend tsc 0, server tsc 0, vitest 2902/2902 PASS, boot:check PASS.

## 2026-06-28 — Claude-level memory, Fix 3: hydrate memory from Firestore for EVERY build (cross-instance)

Gap #3: restoreWorkspaceMemory (which loads the durable Firestore memory snapshot — episodes +
project graph — into the in-process WorkspaceMemory) ran ONLY in edit mode. So a new-build / "continue"
that landed on a fresh Cloud Run instance had cold memory (Fix 1's recentRequests were empty). Fix:
call restoreWorkspaceMemory in the Fix-1 project-context block, which runs for EVERY build — so the
persisted episodes + graph are hydrated before building the project context, even across a restart or
a different instance. Best-effort, never blocks. Now Fix 1 (file/project context) + Fix 2 (conversation
recap) + Fix 3 (durable memory hydration) all work cross-instance.

Gate: server tsc 0, vitest 2902/2902 PASS, boot:check PASS.

## 2026-06-28 — Claude-level memory, Fix 4: plan/todos carry-over (no more PLAN 0/N reset)

Gap #4: the approved build plan (todo statuses) was used only inside the build that created it. On a
follow-up like "continue" the plan was gone — the model reset the plan to 0/N and re-scaffolded work
that was already done. Fix: new pure formatPlanState(todos) (renders each todo as "✓/⋯/✗/○ title
[status]", caps at 20, 4 tests) + a lastPlan field on buildProjectContext that renders a "plan you were
working through last time … CONTINUE the unfinished items, do NOT reset to 0" block. Wired into
routes/agentv3.ts: at build end (before saveWorkspaceMemory) the final plan is persisted as a durable
PLAN_STATE note; in the Fix-1 context block the latest PLAN_STATE note is found and passed as lastPlan
so the next build resumes the unfinished items. Best-effort, never blocks. Internal AI-memory behavior
(no user-facing surface) → no AppKnowledgeBase entry needed.

Gate: frontend tsc 0, server tsc 0, vitest 2908/2908 PASS (+6 new), boot:check PASS.

## 2026-06-28 — Claude-level memory, Fix 5: smarter recall (multi-word tokens + recency)

Gap #5: WorkspaceMemory.recall() only matched a contiguous substring of the WHOLE query, so a
multi-word recall like "countdown timer logic" missed an episode "fixed the countdown timer", and a
long user prompt (recall(prompt, 8)) rarely matched anything. It also ignored recency — a stale hit
ranked equal to a fresh one. Fix: relevance now combines whole-phrase match (exact > prefix >
substring, so "UserCard" → the UserCard symbol still ranks first — backward-compatible) with per-token
overlap (≥3-char tokens, stopwords dropped, capped at 30) so partial multi-word matches surface; and
episodes get a small DETERMINISTIC recency boost (newest ≈ 0.9 … oldest ≈ 0, computed from the spread
of episode timestamps, NOT Date.now(), so tests stay stable) that only breaks ties — it can never
overtake a real token/phrase match, and a zero-relevance note is never surfaced by recency alone.

Gate: frontend tsc 0, server tsc 0, vitest 2911/2911 PASS (+3 new), boot:check PASS.

## 2026-06-28 — Claude-level memory, Fix 6: rolling summary for LONG sessions

Gap #6: Fix 2's conversation recap kept only the last 8 turns verbatim, so in a long session the
EARLY context (the original ask, what the app even is) silently fell off the window — the model
"forgot" it. Fix: new pure buildRunningSummary(messages, {recentTurns}) keeps the recent turns
verbatim AND condenses everything before them into a compact digest — the distinct things the user
asked for + the actions taken ([called X] → X). Short sessions (≤ recentTurns) return exactly the
old recap. extractConversationSummary + buildRunningSummary now share one messagesToTurns() parser
(no drift). Wired into routes/agentv3.ts Fix-2 block (replaces extractConversationSummary). With this
the memory gap-list (1 project context, 2 conversation, 3 cross-instance hydration, 4 plan carry-over,
5 smarter recall, 6 rolling summary) is COMPLETE — v3.0 memory now resumes a session like Claude does.

Gate: frontend tsc 0, server tsc 0, vitest 2914/2914 PASS (+3 new), boot:check PASS.

## 2026-06-28 — Fix: v3.0 build "restart from 0" loop (watchdog false-positive + missing heartbeat)

User report: a simple to-do app "restarts" ~10 times — works/loads for ~2 min, then the UI goes back to
"Setting up your workspace…" and starts over (History showed 6+ runs). Root cause (two real bugs in the
client stall-watchdog path):
1. useAgentV3Build.start()'s inline NDJSON reader updated the UI but NEVER refreshed lastEventTsRef
   (pumpStream did, at line 122). So even though the /chat stream sends an event/ping every 15s, the
   watchdog saw the timestamp frozen at mount time and fired at its 100s "silence" threshold (~the 2 min
   the user saw). With the server build still running, it aborted + resume()d → resume() does
   setState(initialAgentV3State()) → the UI blanks → "Setting up your workspace…" reappears = "0 se start".
2. The /api/agentv3/attach (resume) endpoint had NO heartbeat (unlike /chat), so the reconnected stream
   went silent again during the next quiet build phase (a long model/one-shot call) → watchdog re-fired →
   reconnect loop, repeating indefinitely.
Fix A (client): start() now resets lastEventTsRef at build start AND updates it on every event (incl. the
15s pings), so the watchdog only fires on a GENUINELY dead stream. Fix B (server): /attach sends the same
15s ping keepalive and clears it on close. Now a healthy long build streams uninterrupted; the watchdog
remains as the real safety net for a truly dead stream.

Gate: frontend tsc 0, server tsc 0, vitest 2914/2914 PASS, boot:check PASS.

## 2026-06-28 — Fix: OneShot build hangs forever at "working…" after generating files

User report: "make a calculator" → "Generated 9 file(s) in one shot." → then "working… 16m 58s" and it
never finishes (would spin for hours). Restart-loop (#539) was already fixed, so this is a DIFFERENT hang.
Root cause: OneShot's startPreview() runs `npm install` → `npm run dev` → update_preview, each awaited. On
LocalActuator (used when E2B_API_KEY is unset — the 16-min duration rules out E2B, whose commands cap at
5 min) `npm run dev` is run as a FOREGROUND exec; Node's exec timeout does not reliably kill a dev server
(vite keeps the stdout pipe open), so the command promise NEVER resolves → `await startPreview()` hangs →
the whole build spins at "working…" forever even though the files are already written. runOneShot's
try/catch only catches a THROW, not an infinite wait. Fix: wrap startPreview() in a hard timeout
(withTimeout, default 90 s, configurable via previewTimeoutMs) — preview is best-effort, so on a hang OR a
throw the build finishes (files are already written) and tells the user the preview is still starting.
Now the build ALWAYS completes within ~90 s of file generation regardless of sandbox/actuator behavior.

Gate: frontend tsc 0, server tsc 0, vitest 2915/2915 PASS (+1 hang-repro test), boot:check PASS.

## 2026-06-28 — Fix: build can NEVER hang at "working…" again (server hard deadline + OneShot overall cap)

User report: another build stuck at "working… 9m 44s", this time WITHOUT a "Generated files" message —
so the hang was EARLIER than #540's startPreview fix: in OneShot's generate() (the Haiku model call) or
file-write. Root cause: NO build step had a real deadline. The Anthropic SDK's default request timeout is
~10 min, so a single stalled model HTTP call hangs for minutes; and crucially, if the build body hangs on
an un-abortable await, the route's normal result/error/finally path is NEVER reached → no terminal event →
the client spinner runs forever (the 15s heartbeat keeps the stream "alive", so the client stall-watchdog
never trips either). The existing maxBuildSeconds() cap was only passed into the agentic runner; it was
never enforced as a hard wall.
Two fixes:
1. Server hard wall-clock deadline (routes/agentv3.ts): a timer that, after maxBuildSeconds() (12 min
   default, AGENTV3_MAX_BUILD_SECONDS), force-emits a terminal result, aborts the run, frees the
   per-account slot, and ends the stream — GUARANTEEING the client always gets a terminal event and the
   spinner stops, no matter where the build hangs. Cleared in finally on normal completion; since JS is
   single-threaded it can't interleave with the success path, so it only fires on a genuine overrun.
2. OneShot overall cap (OneShotBuilder.ts): runOneShot now wraps the whole attempt (generate + writeFiles
   + preview) in overallTimeoutMs (default 180 s) — a hung model call bails to the agentic-loop fallback
   in ~3 min instead of spinning, complementing #540's startPreview cap.

Gate: frontend tsc 0, server tsc 0, vitest 2916/2916 PASS (+1 hung-generate test), boot:check PASS.

## 2026-06-28 — Fix: per-request LLM timeout so a stalled model call fails fast (not ~10 min)

Repeated builds hung in OneShot's generate() (the model call) for 9+ min. Root: the Anthropic SDK's
DEFAULT per-request timeout scales with max_tokens and can be ~10 minutes, so a single stalled request
(connection opens, no response) silently hangs the build. Fix (ClaudeClient.getClient): pin an explicit
per-request timeout (llmRequestTimeoutMs, env AGENTV3_LLM_TIMEOUT_MS, default 120 s) AND set the SDK's own
maxRetries:0 so a stall isn't multiplied by the SDK's internal retries on top of our createWithRetry. Now
a stalled call fails in ~2 min and our retry/fallback + the OneShot 180s cap + the 12-min server deadline
take over — the build recovers/terminates fast instead of appearing to hang. NOTE: this only helps if the
deploy actually reaches production — Cloud Build posts no commit status to GitHub, so deploy landing must
be verified separately (admin: Cloud Build history / trigger 75443609-...).

Gate: frontend tsc 0, server tsc 0, vitest 2919/2919 PASS (+3), boot:check PASS.

## 2026-06-28 — Fix (combined plan, step 1/B): OneShot "sticky success" — a slow preview no longer discards a built app

User saw: OneShot generated 8 files (app built), preview was slow ("Preview is still starting"), then the
HEAVY agentic loop re-ran on top (App.css, type-check, dev server…) and hit the 12-min timeout — double
work. Root: runOneShot wrapped the WHOLE attempt (generate + write + preview) in one overall timeout, so a
successful build whose preview merely ran slow was declared ok:false → caller fell through to the full
agentic loop. Fix: restructure runOneShot so the overall cap bounds ONLY the generate+write phase; once the
files are written, success is LOCKED IN — the best-effort preview (separately bounded) can never downgrade
it to a fallback. A simple new app now finishes right after generation instead of re-running the heavy loop
and timing out. (Combined-plan step A = per-request LLM timeout #542; this is step B.)

Gate: frontend tsc 0, server tsc 0, vitest 2920/2920 PASS (+1 sticky-success test), boot:check PASS.

## 2026-06-28 — Fix (combined plan, step C): E2B listFiles excludes node_modules — kills the "5115 files" edit-prompt bloat

User screenshot showed "Editing your existing app (5115 files)". A simple Vite+React app has ~10 source
files — the 5115 were node_modules (thousands of library files after npm install). E2BActuator.listFiles
did NOT exclude node_modules/.git/dist/etc (LocalActuator already did via IGNORED_DIRS), so the edit-mode
prompt (editModePrefix(fileTree)) was fed 5000+ paths → huge, slow, expensive context on every turn. Fix:
add isIgnoredListPath() (mirrors LocalActuator's IGNORED_DIRS) and filter listFiles output. The agent only
ever edits real source, never these dirs. Edit context drops from 5115 → the ~10 real files → faster,
cheaper, less-confused turns.

Gate: frontend tsc 0, server tsc 0, vitest 2922/2922 PASS (+2 isIgnoredListPath tests), boot:check PASS.

## 2026-06-28 — Build report upgrade: full minute-by-minute timeline + names the exact hang

User insight from a real report: 12-minute build, only 2 lines recorded — because BuildDiagnostics only
captured PROBLEMS (errors/struggle-narration), never normal activity. So an 11-minute hang was a blank gap;
we couldn't see what it was doing. Upgrade (BuildDiagnostics): (1) record EVERY tool call (TOOL_CALL) and
its completion+duration (TOOL_DONE), not only failures; (2) record ALL narration as AGENT_STEP (timeline),
not just problem lines; (3) record milestone events (delegation/plan/todo) as EVENT; (4) track IN-FLIGHT
tool calls and, on finish(false), record STUCK_TOOL naming exactly what the build hung on (in-flight Ns,
never completed); (5) new heartbeat() that the route calls every 60 s (diagHeartbeatTimer, cleared in
finally) → minute-by-minute "⏱ minute N — still working (in-flight: X / last: Y)" markers so a long quiet
stretch is no longer a blank gap. Timeline capped at 2000 entries (TIMELINE_TRUNCATED) so a runaway loop
can't grow the report unbounded. Now a timeout report shows the full activity log AND points at the culprit.

Gate: frontend tsc 0, server tsc 0, vitest 2926/2926 PASS (+4 timeline/heartbeat/stuck tests), boot:check PASS.

## 2026-06-28 — Fix: v3.0 plan list now syncs (live spinner + green ticks), no longer frozen at 0/N

User: the plan list (above the input box) doesn't sync — no spinner while working, no green tick on
completion (it sits at "PLAN 0/N", all items pending). Root: the plan is driven by todo_updated events;
the model is INSTRUCTED to keep todos updated (mark in_progress/done) but does not do so reliably — Haiku
especially creates the plan once and never advances the statuses. The client renders status correctly
(Loader2 spinner for in_progress, CheckCircle2 for done) — the statuses just never change server-side.
Fix: new pure computePlanProgress(todos, completedSteps, finished) (7 tests) + wiring in routes/agentv3.ts
so the route drives plan progress from REAL build activity regardless of model compliance: (a) on plan
approval, the first item → in_progress (spinner appears immediately); (b) each file written advances the
progress (done → in_progress → pending; the last item is never marked done until the build finishes, so
no premature 100%); (c) on the build's final outcome, a SUCCESS marks every item done (green ticks), a
failure keeps the progress reached. A real 'blocked' status is preserved. Best-effort — never affects the
build. No AppKnowledgeBase entry (bug fix to an existing surface, not a new feature).

Gate: frontend tsc 0, server tsc 0, vitest 2933/2933 PASS (+7), boot:check PASS.

## 2026-06-28 — Audit P0-A: bound the request-setup calls that hang BEFORE the build deadline is armed

The exhaustive pipeline audit (30 agents, 22 confirmed findings) identified the worst category: four
calls run during request setup, BEFORE #541's 12-min deadline timer is created — so if any stalls, the
whole HTTP request hangs TRULY forever (the deadline never starts). Fix: new raceTimeout(p, ms, label)
helper (pure, 4 tests) wraps each, all fail-safe: (1) checkMonthlyCap (5s, fails OPEN like its error
path); (2) describeVisionAttachments (8s → ''); (3) classifyIntentSmart (6s → keyword fallback already
computed); (4) chatRouter.route plain-chat reply (30s → the existing catch falls through to the build
path). This closes the "stuck at 'setting up workspace…' forever" hole for slow providers / degraded
Firestore. (First of the audit's P0 fixes; readiness-gate parallelize + E2B file-op timeouts next.)

Gate: frontend tsc 0, server tsc 0, vitest 2937/2937 PASS (+4), boot:check PASS.

## 2026-06-28 — Audit P0-C: readiness gate parallelized + bounded — a fully-built app no longer dies at the finish line

The audit's highest-leverage finding: the MANDATORY readiness gate (assessBuildReadiness) runs AFTER the
last agent turn, so the build's wall-clock deadline can no longer interrupt it — and it read up to 800
files (500 in seedGraphFromWorkspace + 300 in readEvalSnapshot) ONE AT A TIME with no per-file timeout.
On a build that already used 10-11 min, those 50-160s of sequential remote reads (or a single stalled
read) pushed it past the 12-min cap and killed a build whose app was ALREADY BUILT, reporting failure.
Fix: new shared asyncUtils (mapWithConcurrency + withTimeout, 7 tests). Both read loops now run in
bounded-concurrency batches (12 at a time) with a 5s per-file timeout; the initial listFiles is capped at
15s; and assessBuildReadiness as a whole is wrapped in a 45s timeout that returns a PERMISSIVE verdict on
expiry (the gate is best-effort and must never fail a real build on its own slowness). ~80s → ~3s.

Gate: frontend tsc 0, server tsc 0, vitest 2944/2944 PASS (+7), boot:check PASS.

## 2026-06-28 — Audit P0-B/P1: every E2B file op is now timeout-bounded (+ dead-sandbox eviction)

The e2b SDK's files.* methods (unlike commands.run) take no timeoutMs, so a stalled SDK call or a sandbox
E2B reaped server-side (the 60-min lifetime cap) hung the build forever — the 12-min wall-clock can't
cancel an in-flight promise. Fix (E2BActuator): new private fileOp() wrapper bounds every file op (30s)
AND, on a timeout, EVICTS the cached sandbox so the next call creates a fresh one instead of repeatedly
hanging against a dead reference (covers the "cached dead sandbox" P1 finding too). Refactored readFile,
writeFile, writeBinaryFile, listFiles through it. Also bounded: ensureWorkspace's exists/makeDir/writeFiles
(15-30s — runs at "setting up workspace…"), getConsoleErrors' console read (15s), and the idle-sweep's
Sandbox.pause (10s, like create/connect).

Gate: frontend tsc 0, server tsc 0, vitest 2944/2944 PASS, boot:check PASS.

## 2026-06-28 — Audit P1/P2 cleanup: OneShot writeFiles timeout + client watchdog reconnect + preview-before-port

Three more confirmed audit fixes: (1) OneShot writeFiles is now INSIDE the overall timeout (generate +
parse + write wrapped together) — a stalled sandbox write no longer hangs the lane (audit P0-B finish).
(2) Client watchdog reconnect: resume() guarded on the `running` state, which is ALWAYS true during a
build, so the stall-watchdog's reconnect was a silent no-op → spinner stuck forever on a genuinely dead
stream. Replaced with a resumeInFlightRef (guards only against overlapping reconnects), so the watchdog
can actually reconnect while running (P1). (3) update_preview no longer emits a preview URL when the port
did NOT come up within 15s — the user never clicks into a blank/502 page ("preview is EARNED"); the agent
gets a clear "NOT published, bring the dev server up and retry" message (P2).

Gate: frontend tsc 0, server tsc 0, vitest 2957/2957 PASS (+1 hung-writeFiles test), boot:check PASS.

## 2026-06-28 — Fix: v3.0 in-browser preview no longer fails when the sandbox is gone

User: the v3.0 Preview panel's "In-browser" tab showed "Couldn't build the in-browser preview: [not_found]
path not found: lstat /home/user/workspace: no such file or directory". Root: both /api/agentv3/workspace-files
and /api/agentv3/inbrowser-preview read the LIVE E2B sandbox via collectWorkspaceFiles — but the in-browser
preview is EXPLICITLY meant to work WITHOUT a live sandbox (its whole point). When the sandbox was paused/
reaped, collectWorkspaceFiles threw the E2B "[not_found] /home/user/workspace" error and the endpoint 500'd.
Fix: new collectFilesWithSavedFallback() tries the live sandbox first (freshest) but falls back to the
DURABLE saved files (Firestore WorkspaceFileStore) when the sandbox is gone/empty/errored — never throws.
Wired into both endpoints. The in-browser preview now builds from the user's saved app even with no live
sandbox.

Gate: frontend tsc 0, server tsc 0, vitest 2964/2964 PASS, boot:check PASS.

## 2026-06-29 — Fix: "please continue" no longer triggers amnesia (routes to the memory-aware build path)

User: after a build timed out, "please continue" → AI replied "could you remind me what we were
discussing?" and "what was you done?" → generic "Hello there! As an AI assistant…". Total amnesia. Root:
the intent classifier sends SHORT, signal-free messages to 'chat' (the cheap chatRouter path), which has
NO project context/memory — and "please continue" is 2 words with no build verb, so it hit the
short-message → 'chat' default. The Claude-level memory (#533-538) is only injected on the BUILD/EDIT
path, never the chat path. Fix: new CONTINUATION_SIGNALS (continue / go on / keep going / finish it /
aage badho / continue karo / poora karo …) checked in BOTH classifyIntent and classifyIntentWithConfidence
BEFORE the social/short fallbacks → returns 'edit_existing' (HIGH confidence, so the LLM upgrade can't
downgrade it to chat). Continuations now route to the memory-aware edit/continuation path that injects the
file tree + conversation recap + workspace memory → the build actually resumes instead of going amnesiac.
Erring toward edit_existing is safe (worst case: run the build path on a fresh workspace; never answer a
build as chit-chat). NOTE: the build still timed out at 12 min for a todo app — that's the separate SPEED
issue (deferred at user's request).

Gate: frontend tsc 0, server tsc 0, vitest 3089/3089 PASS (+4), boot:check PASS.

## 2026-06-29 — Fix: connect BOTH previews to the v3.0 engine (main "Preview" menu was wired to retired v2.0)

User: both previews don't open — the one inside the v3.0 panel AND the main slide-out "Preview" menu —
"preview v3.0 engine se connect hi nahi hai". Investigation (Explore agent): the v3.0 panel's own preview
(AgentV3Panel → PreviewSurface) reads state.previewUrl from the build stream and works; but the MAIN menu
"Preview" (ViewPanels, activeView==='preview') rendered the RETIRED v2.0 PreviewPanel from `generatedCode`
— a string the v3.0 engine NEVER writes — so it always showed the old empty placeholder. Fix: (1) extracted
the working PreviewSurface (Live server + In-browser, incl. the #577 saved-files fallback) into a shared
component src/components/agentv3/PreviewSurface.tsx; (2) lifted the v3.0 preview state (previewUrl +
workspaceId) up from AgentV3Panel via a new onPreviewState callback → ProV3Surface → App.tsx (v3Preview
state), mirroring the existing onFilesSync lift; (3) the main "Preview" menu now renders the SAME
PreviewSurface when a v3.0 workspace is active (else the legacy PreviewPanel for non-v3 flows). Both
previews are now driven by the v3.0 engine. 5 files: PreviewSurface.tsx (new), AgentV3Panel, ProV3Surface,
ViewPanels, App.tsx.

Gate: frontend tsc 0, server tsc 0, vitest 3110/3110 PASS, boot:check PASS.

## 2026-06-29 — Fix: in-browser preview "Could not load the preview compiler" (self-hosted Babel via absolute origin)

User: even with E2B_API_KEY set, the In-browser preview showed "Could not load the preview compiler
(network blocked?)". Root: ReactPreview.ts loaded the self-hosted compiler via a ROOT-RELATIVE path
("/vendor/babel.min.js"). Inside a sandboxed <iframe srcDoc> a root-relative URL does not reliably
resolve to the app origin, so the self-hosted Babel never loaded; the CDN fallbacks (jsdelivr/unpkg/
cdnjs) are blocked → the error. (The v2.0 previewUtils already used the absolute ORIGIN form — that's
why it worked there.) Fix: thread the caller's origin into renderPreview → buildReactPreview, which now
emits <script src="${origin}/vendor/babel.min.js"> (absolute same-origin) when an origin is known, else
the relative path (back-compat / unit tests / the /preview/:id static route). The /inbrowser-preview route
derives the origin from the request body (PreviewSurface now sends window.location.origin), falling back to
the x-forwarded-proto/host header. buildVuePreview accepts the origin param too (Vue uses CDNs separately).
NOTE: after Babel loads, React deps still load from esm.sh — if that CDN is also blocked, the live (E2B)
preview is the full-fidelity path.

Gate: frontend tsc 0, server tsc 0, vitest 3111/3111 PASS (+1), boot:check PASS.

## 2026-06-29 — Fix: v3.0 sessions reliably saved to main History (no more "Session not found")

User: restoring a v3.0 session from the main sidebar History showed "Session not found. It may have been
deleted or is from a different account." Root: AgentV3Panel persisted the v3.0 session to the main History
(Firestore chat_sessions) ONLY on state.done — so a timed-out / interrupted / not-yet-finished build (very
common, given the 12-min cap) was NEVER written, and reopening it from History found nothing. The main
History also never queries the v3.0 ConversationStore, so chat_sessions was the only source. Fix: the
persist effect now writes the session as soon as the build has a workspace + a first user message, and
UPDATES the same doc (keyed by the stable sessionId, merge:true) on build start, completion, AND stop/
timeout (deps: state.workspaceId, state.done, running, userId). Every v3.0 session is therefore always in
History and restorable. The restore already adopts the saved sessionId, so the backend continues with the
SAME workspace + memory (#533-538 hydration) on the next message. (Immediate client-side file/preview
rehydration on restore — showing the app before the next message — is a deeper follow-up, deliberately not
bundled here to avoid touching the panel's multi-source chat/file state under "never break".)

Gate: frontend tsc 0, server tsc 0, vitest 3115/3115 PASS, boot:check PASS.

## 2026-06-29 — Feature: v3.0 preview SELF-AWARENESS — it now opens its own app, sees if it rendered, and fixes it

User: "v3.0 apne preview system se aware nahi hai — use pata hi nahi chalta ki preview real me chala ya
nahi. Isko intelligent banao jisse v3.0 dekh bhi sake aur error fix bhi kare." Root: the build claimed
"preview published" after only a port check (nc -z); nothing ever VISITED the preview, so a blank page,
a React crash-before-render, a Vite error overlay, or a dev-server 404 went unnoticed. The console-error
autofix existed but was opt-in AND had no data (no browser ever navigated to the app, so getConsoleErrors
was empty). Feature: new pure PreviewVerify (analyzePreviewHtml + buildPreviewRepairPrompt, 8 tests) judges
from the RENDERED DOM whether the app actually rendered (empty mount root → crash before render, Vite
overlay, "Cannot GET" 404, uncaught runtime error, blank page). Wired a default-on PREVIEW SELF-CHECK +
HEAL into routes/agentv3.ts: after a successful build with a preview URL it OPENS the running app via the
sandbox browser (actuator.browseUrl → rendered DOM, which ALSO populates console errors), analyses it,
emits an HONEST verdict ("✅ Preview verified — opened it in a browser and it renders" vs "⚠️ it did not
render: …"), and on failure runs ONE bounded repair pass (buildPreviewRepairPrompt) + re-verifies. Time-
budgeted (skips if <90s left before the 12-min cap), abortable, best-effort — never breaks/hangs the
build. Disable with AGENTV3_PREVIEW_VERIFY=off. Records PREVIEW_NOT_RENDERED in the build report.

Gate: frontend tsc 0, server tsc 0, vitest 3137/3137 PASS (+8), boot:check PASS.

## 2026-06-29 — Fix: lean build plan — no auto "verify and deploy" stage that freezes a simple build

User screenshot: a todo-app build reached PLAN 3/4 and froze at the LAST todo "Verify and deploy" /
"update the preview" for 12+ min. The Architect over-plans: for a plain "build a todo app" it added a
"Verify and deploy" step the user never asked for. Deploying an unasked app can stall on missing hosting
credentials, and a vague "verify" step makes the agent churn on the preview — a slow/freezing last stage.
Fix: planSystemPrompt now instructs a LEAN plan (2–4 concrete construction steps, final step = run/preview),
explicitly NO deploy/publish step unless the user asked, and NO vague verify/test steps (the system already
opens + verifies the live preview automatically after the build, via #597). So a normal build ends cleanly
after the preview instead of churning on an over-planned "verify and deploy".

Gate: server tsc 0, vitest 3143/3143 PASS, boot:check PASS.

## 2026-06-29 — Fix (bulletproof): inline the Babel compiler into the in-browser preview

User: "Could not load the preview compiler (network blocked?)" STILL appeared in the In-browser preview
even after #528 (self-host) and #587 (absolute-origin URL). A <script src=…> can fail in a sandboxed
<iframe srcDoc> for several reasons at once — a root-relative path doesn't resolve, an absolute URL 404s
if the asset isn't in the deployed dist, and every third-party CDN fallback is blocked by the app's CSP
(scriptSrc 'self'). Bulletproof fix (ReactPreview.ts): INLINE the Babel source directly into the preview
HTML as <script>…</script>. An inline script is same-document (CSP allows 'unsafe-inline'), needs NO
network and NO asset serving, so the compiler is ALWAYS present. babelInlineSource() reads babel.min.js
once (cached) from public/vendor → dist/vendor → node_modules/@babel/standalone; if none is readable it
falls back to the prior <script src=…> (no regression). Skipped under VITEST so the existing tests still
assert the <script src> markup. ("</script>" in the minified source is escaped so it can't break the tag.)

Gate: frontend tsc 0, server tsc 0, vitest 3223/3223 PASS, boot:check PASS.

## 2026-06-29 — FEATURE: Simple Builder — "plan the files → build each file in its own call" (the user's design)

The recurring root cause behind the freezes/over-builds/"no files"/network-error screenshots: the
single-call OneShot lane asks the model to emit an ENTIRE multi-file app in ONE ~8k-token response. A
real multi-file app (todo/dashboard) TRUNCATES → "first attempt produced no files" → the build drops into
the slow heavy/escalation agentic loop (12-min freezes, over-built 8-step plans, transient provider errors
during mass parallel file creation). Fix = the user's own proposed architecture, built as a real,
additive, tested lane: src/server/AgentV3/SimpleBuilder.ts —
  1. PLAN a file manifest (ONE cheap call → "path :: purpose" per line; parsed safely, capped at 40).
  2. GENERATE each file in its OWN focused call, in PARALLEL (bounded concurrency) — no single-call
     token-limit truncation, higher per-file quality (each call has the full budget for one file). A
     single file's failed call doesn't kill the build (others still ship).
  3. WRITE all files + start the preview (sticky success: once written, a slow preview can't fail it).
Bounded by an overall timeout; returns ok:false (never throws) on any failure → caller falls back to
OneShot (trivial 1-file apps) → then the agentic loop. Wired as the PRIMARY fast lane in routes/agentv3.ts
for simple new builds (shared generate/write/preview deps; usage ACCUMULATES across all calls for honest
billing; skip-install when node_modules present). 10 unit tests.

Gate: frontend tsc 0, server tsc 0, vitest 3239/3239 PASS (+10), boot:check PASS.

## 2026-06-29 — FEATURE: AI Diagnosis Bundle — capture the raw signals behind build failures

The Build report timeline named WHAT struggled but not WHY: it truncated errors to ~800 chars (losing
the real throwing frame), never kept the raw sandbox command output, and never recorded the model I/O.
A 2nd session ranked the top-3 missing signals (~80% of root causes). All three are now captured into the
same downloadable Build report (additive — JSON download + .txt both surface them automatically):
  • #3 Sandbox raw logs — every `bash` command's full stdout/stderr/exit code + duration is captured via
    a new ToolDispatcher `onCommand` callback (mirrors the existing `onFileWrite` pattern). A non-zero
    npm install / tsc / vite build / dev-server now shows its actual error, not just "tool failed".
  • #4 LLM I/O — every model turn's model, prompt/response sizes + head preview, finish reason, token
    counts and latency, captured via a new AgentRunner `onLlmCall` callback (fires on success AND on a
    thrown/failed turn). A `finishReason: 'max_tokens'` here is the smoking gun for a truncated multi-file
    generation. Shared by the default build AND every escalation/retry/heal/fix runner (baseRunnerOpts).
  • #1 Full errors — the complete, un-truncated error message + stack is kept in a dedicated channel
    alongside the short timeline line, so the root cause is never lost to a slice.
BuildDiagnostics gained recordCommand()/recordLlmCall()/recordFullError() with per-channel caps
(300/300/200) and per-output caps (4000-char tails for logs/stacks, 2000-char heads for prompts) so a long
build can't grow the report without bound. All capture is best-effort (never throws, never blocks a build).
AppKnowledgeBase `agentv3_build_report` entry updated (same PR) to describe the bundle.

Gate: frontend tsc 0, server tsc 0, vitest 3374+9=3383 (BuildDiagnostics 21/21) PASS, boot:check PASS.

## 2026-06-29 — FIX: update_preview can no longer hang the whole build (the real 15-min freeze)

A production Build report (the new diagnosis report in action) pinpointed the recurring freeze: a build
sat in-flight on the `update_preview` tool for 907s (≈15 min) until the 1080s wall-clock cap, then died
with BUILD_TIMEOUT + STUCK_TOOL "Stuck on 'update_preview'". Root cause: `update_preview`'s port-readiness
poll was documented as "30 × 500ms = 15s max" but each `nc -z` runCommand had NO timeout, and `getPortUrl`
had none either — so when the sandbox SDK / a single command stalled, the await never settled and the
30-iteration cap was meaningless. The tool hung forever and took the whole build down with it.

Fix (src/server/AgentV3/ToolDispatcher.ts, update_preview): bounded TWO ways so the tool can NEVER hang —
(1) each port check is wrapped in withTimeout(3s) so one stalled `nc` can't block; (2) the poll has a hard
15s wall-clock budget that always exits regardless of actuator behaviour; (3) getPortUrl is wrapped in
withTimeout(10s) and, on timeout, returns an honest "could not resolve the preview URL … call again"
WARNING instead of hanging (no fake-success preview emitted). Worst case ~25s, then the build moves on.
Regression test (ToolDispatcher.test.ts): a getPortUrl that never resolves now returns the WARNING within
the timeout (fake timers) and emits no preview event.

Gate: frontend tsc 0, server tsc 0, vitest 3384/3384 PASS, boot:check PASS.

## 2026-06-29 — FIX: adaptive bot-guard was blocking real v3.0 builds ("Too many automated requests")

A logged-in user typing "ek notes app banao" in v3.0 got an instant 429 "Too many automated requests.
Try again in 36s." Root cause: the P-SEC.8 behavioural bot-guard (adaptiveRateLimit.ts, mounted on the
whole /api/ surface) used a burst threshold of just 25 requests / 10s. A single legitimate v3.0 build
session bursts well past that (SSE build stream + reconnects, plus status / preview-status /
workspace-files / conversations / diagnostics polling), so it accrued 5 "violations" and hit the 60s
hard block — locking the user out mid-build. The v3.0 endpoints are authenticated, credit-metered and
already covered by the static per-IP limiters, so the behavioural bot layer is both unnecessary and
harmful there. Fix: (1) new exported, unit-tested isGuardedPath() predicate = default shouldGuard —
guards /api/ EXCEPT /api/agentv3/* (the interactive build surface is exempt); (2) raised the default
burst ceiling 25 → 120 per 10s so other interactive endpoints (chat) tolerate normal bursts while a real
scraper (hundreds/sec) is still caught. Bot-UA detection + static limiters unchanged. The in-memory block
map also clears on the Cloud Run redeploy, so the deploy itself releases any currently-blocked users.

Gate: frontend tsc 0, server tsc 0, vitest 3399/3399 PASS (+3 isGuardedPath), boot:check PASS.

## 2026-06-29 — FEATURE: Claude-style live "working…" activity indicator (expandable)

The old WorkingIndicator showed only "🇮🇳 working… 12s" — a timer with no insight, so a long step
looked frozen and the user couldn't tell what the build was doing. Replaced it with a Claude-style
expandable indicator driven entirely by REAL engine events already in client state (no new backend):
  • Collapsed: the CURRENT live action (latest in-flight tool, e.g. "✍️ writing src/App.tsx",
    "⌨️ running: npm install") + a live cursor + elapsed timer + a chevron.
  • Expanded (click): a scrollable, auto-scrolling step-by-step activity log — every tool call, file
    write, command, search, agent spawn and the preview publish — each with a timestamp and ✓/✗, plus
    a "Tasks N/M done" line from the todos. Click again to collapse.
  • After the build finishes the same line persists as "✓ Done · N steps" so the work stays reviewable
    (expand to see exactly what happened); a failed step shows in red.
Implementation: new ActivityEntry type + activity[] on AgentV3ClientState (capped 300), populated in
the reducer from tool_call (in-flight, matched to its tool_result by callId → ✓/✗), file_changed,
agent_spawned and preview events. Resets per turn via initialAgentV3State(). Frontend-only, additive.
AppKnowledgeBase agentv3_builder entry updated with the LIVE ACTIVITY capability + keywords.

Gate: frontend tsc 0, server tsc 0, vitest 3402/3402 PASS (+3 activity-feed tests), boot:check PASS.

## 2026-06-29 — FIX (A): SimpleBuilder now EARNS success — verify-gate + auto-repair (no more "Built your app" on broken code)

A real Build report (diagnosis bundle) proved the "app nahi bana" root cause: SimpleBuilder generates
each file in its OWN isolated call, so a hook and its consumer disagreed on the interface (useCalculator
didn't return `input`/`operation` that Calculator.tsx destructured → app won't compile). The reviewer
caught it (15/100) — but SimpleBuilder had ALREADY returned ok:true (it reported success right after
writing files, with NO compile check). So broken code shipped as "✅ Built your app." (Also seen: dev
server OOM-Killed; in-browser preview "No files" — those are separate, slated next as fixes C/E.)

Fix A (additive, never-worse-than-today): runSimpleBuild gains optional `verify` + `repair` deps.
After writing files it runs a REAL compile check in the sandbox (`npx tsc --noEmit`, after an idempotent
install) — tsc surfaces the exact contract mismatch. If it fails, it feeds the precise tsc errors + the
current files back to a bounded auto-repair pass (default 2) that rewrites the offending files so the
producer/consumer agree, then re-verifies. It claims ok:true ONLY when the app actually compiles; if it
still fails after repairs, it returns ok:false so the build falls through to the full agentic builder
(its own repair loop + readiness gate). A verify infra error is non-blocking (best-effort). With no
verify dep wired, behavior is unchanged. This enforces "Preview is EARNED" on the fast lane.

Wired in routes/agentv3.ts (fastVerify = install-guard + tsc; fastRepair = haiku call with repair prompt).
+6 SimpleBuilder tests (verify pass / repair-then-pass / fail-after-maxRepairs→ok:false / infra-error
non-blocking / no-verify unchanged).

Gate: frontend tsc 0, server tsc 0, vitest 3456/3456 PASS (+6), boot:check PASS.

## 2026-06-29 — FIX (C + D): fast-lane build reliability — durable persist + Sonnet for codegen

Same calculator report exposed two more issues beyond A:
• C — IN-BROWSER PREVIEW showed "No files to preview yet" even though Files(9) existed. The durable
  file save (Firestore WorkspaceFileStore) only happened at the very END of the whole flow,
  fire-and-forget — so when the reviewer was still running / the stream dropped / the instance rotated,
  the save never completed and the preview's file source was empty. Fix: persist the produced files
  SYNCHRONOUSLY (awaited, best-effort) the moment the fast lane (Simple Builder / OneShot) succeeds —
  independent of the later debounce/end-of-flow save. The in-browser preview now reliably finds files.
• D — the fast lane generated every file on HAIKU. Because each file is generated in its OWN isolated
  call, the model must keep contracts consistent ACROSS files (a hook's return shape vs what its
  consumer destructures); Haiku frequently disagreed → the app didn't compile. New env-overridable
  fastBuildModel() defaults to SONNET (far more consistent across isolated calls). With A's verify+repair
  as the safety net and D cutting mistakes at the source, simple apps build first-try. Billing unchanged
  (token×markup), real-cost margin still positive (billed Opus-equiv ≥ Sonnet cost).

Gate: frontend tsc 0, server tsc 0, vitest 3467/3467 PASS (+1), boot:check PASS.

## 2026-06-29 — FEATURE: Diagnosis bundle v2 — fast-lane LLM I/O (#2) + offending files on compile-fail (#1)

Two gaps the admin and I found while diagnosing the calculator report, both closing back-and-forth:
• #2 FAST-LANE LLM I/O — the #4 LLM-I/O capture was wired only into AgentRunner, but simple apps build
  via SimpleBuilder/OneShot which call the model directly (fastGenerate), so their calls were a blind
  spot (the calculator report's llmCalls was empty). fastGenerate now records EVERY fast-lane call
  (manifest / per-file / repair) into buildDiag.recordLlmCall — success AND failure — so a truncated
  (max_tokens) or failed per-file generation is visible.
• #1 OFFENDING FILES ON COMPILE-FAIL — when the fast-lane verify (tsc) fails, fastVerify now parses the
  file paths tsc names, de-dupes, and records each offending file's content (from the captured writes)
  into a new BuildDiagnostics `generatedFiles` channel (capped 20 files × 6000 chars, de-duped by path).
  The exact mismatch (e.g. hook vs consumer) is now VISIBLE in the report — no inference needed.

BuildDiagnostics gained GeneratedFileRecord + recordFile() + the generatedFiles report channel + text
render ("Offending files"). +4 tests.

Gate: frontend tsc 0, server tsc 0, vitest 3469/3469 PASS (+2), boot:check PASS.

## 2026-06-29 — FIX: "Build report khali/empty" — durable diagnostics persistence + one-tap Copy

Admin's screenshot: the Build report came up EMPTY even though a full build ran (reviewer gave 25/100 on
a CSS-class mismatch). Root cause: the diagnostics report lived ONLY in an in-memory Map (lastDiagnostics,
keyed by userId) — per Cloud Run INSTANCE. The build runs on instance A; the "Build report" GET
load-balances to instance B (or the page reloaded, losing the client `state.diagnostics` copy) → 404 →
empty. Same durability gap as the file-persistence fix (C), but for the report.

Fix: new DiagnosticsStore (Firestore, mirrors WorkspaceFileStore — VITEST-skip, best-effort, never
throws), keyed by workspaceId. The final report is persisted durably at build end (awaited) + at the
timeout path; trimReportForStorage() bounds it under Firestore's 1 MB doc limit (caps issues/commands/
llm previews/errors to the newest+shrunk, keeps the offending generatedFiles evidence). The GET endpoint
now falls back to the durable copy (by workspaceId) on an in-memory miss, and the client sends
workspaceId. So the report survives instance rotation + reloads — never empty after a real build.

Also (answers "can't you access it directly?"): added a one-tap "Copy report" button — copies the JSON to
the clipboard to paste straight into chat, no download→find→upload. (Claude's coding session is sandboxed
to the repo, NOT the live prod DB, so the user sharing the report IS the bridge — this makes it one tap.)
AppKnowledgeBase updated. +3 DiagnosticsStore tests.

Gate: frontend tsc 0, server tsc 0, vitest 3492/3492 PASS (+3), boot:check PASS.

## 2026-06-29 — FIX: CSS class-mismatch builds (the DigitalWatch bug tsc can't catch)

Admin report: DigitalWatch app "didn't build" — component used className "watch-container"/"watch-screen"/
"time-display" etc., but watch.css only defined ".watch-wrapper"/".watch-display". The reviewer caught it
(25/100) but the build shipped anyway, AND the verify-gate (A) missed it because tsc CANNOT see a
className-vs-CSS mismatch (class names are just strings → tsc passes, app renders unstyled).

Fix: new deterministic CssConsistency check (pure, tested) cross-references the className tokens used in
components against the .class selectors defined in the project's CSS. Wired into the fast-lane fastVerify
AFTER the tsc check: on a real mismatch it fails verify with a descriptive error, so the SAME bounded
auto-repair loop (A) rewrites the components/stylesheet to AGREE, then re-verifies. Conservative to avoid
false positives on good apps: SKIPS Tailwind projects, only counts KEBAB-CASE custom classes, requires a
.css file with selectors, and only flags at a threshold (>=3 undefined). +7 tests.

Net: simple apps now get BOTH a type check (tsc) AND a style-consistency check before success is claimed,
with auto-repair on either — closing the "built but renders unstyled/broken" gap.

Gate: frontend tsc 0, server tsc 0, vitest 3499/3499 PASS (+7), boot:check PASS.

## 2026-06-29 — FIX (P3+P2a): in-browser preview now reports the REAL error (not a cryptic about:srcdoc stack)

A todo-app report showed the build now SUCCEEDS (CSS gate + auto-repair worked — "Build verified ✓"), but the
in-browser preview failed with only "requireModule@about:srcdoc:81:32" — no reason. Root cause of the
USELESS message: showError used `err.stack || err`, and iOS Safari's err.stack is frames-only (no message
line), so the actual reason ("Cannot resolve …", "Run src/App.tsx: …") never showed. Fix: surface
err.message FIRST, append the stack for context. Also made the in-browser module loader name BOTH the
failing import and its importer ("Cannot resolve './x' imported by src/App.tsx (looked for src/x)";
"Missing dependency 'foo' (imported by …)") instead of a bare "Module not found". So the next preview
failure pinpoints the exact module — turning blind preview bugs into one-look fixes.

Note: this makes preview failures DIAGNOSABLE; the deeper preview render fixes (P1 live static-build to
beat the dev-server OOM, P2 fuller in-browser hardening) are the next PRs per the admin's go-ahead.

Gate: frontend tsc 0, server tsc 0, vitest 3512/3512 PASS (+1), boot:check PASS.

## 2026-06-29 — FEATURE: preview failures are now captured into the Build report (100% real)

Admin asked: can a preview failure also be added to the report? Yes. Live-server preview failures already
appeared via the sandbox command logs (the "Killed"/"did not come up" lines). The GAP was the in-browser
preview: its error happens entirely client-side in the sandboxed srcdoc iframe, so it was never in the
(server-side) report — the user had to screenshot it separately. Now wired end-to-end:
  • the in-browser srcdoc iframe postMessages its real error up to the host on failure (cross-origin
    srcdoc → postMessage is the only channel);
  • PreviewSurface listens and POSTs it to a new owner-scoped /api/agentv3/preview-error endpoint;
  • the endpoint appends it to the DURABLE (workspace-keyed) diagnostics report + the in-memory copy, so
    the next "Build report" download/copy includes the real preview error in a new `previewErrors` channel
    (+ a PREVIEW_ERROR timeline line). De-duped against immediate repeats, capped.
BuildDiagnostics gains PreviewErrorRecord + recordPreviewError() + channel + text render. So a build that
"succeeds" but doesn't render now shows WHY, right in the downloadable report.

Gate: frontend tsc 0, server tsc 0, vitest (BuildDiagnostics + reactPreview + DiagnosticsStore green), boot:check PASS.

## 2026-06-29 — FIX (P1 root cause): live preview "never comes up" — the nc-only port check was the bug

A "build a note app" report (NO "Killed" this time → NOT OOM) showed vite "ready in 163ms" bound to
0.0.0.0:5173, yet "[health-check] port 5173 not responding" every time → live preview never published.
Root cause: buildPortWaitCommand polled ONLY `nc -z localhost <port>`. Two real failure modes made a
HEALTHY server read as DOWN: (1) the sandbox image may have no `nc` (netcat) → every poll fails → PORT_DOWN;
(2) `localhost` can resolve to IPv6 ::1 while Vite binds IPv4 0.0.0.0 → connection refused. Either one =
"dev server did not come up" forever. Fix: tool-agnostic, IPv4-forced liveness check — try
`nc -z 127.0.0.1` → `curl http://127.0.0.1:<port>` → bash `/dev/tcp/127.0.0.1/<port>`; ANY hit = PORT_UP.
Strictly additive (only ever reports UP in MORE cases, never fewer). Test updated.

Honest scope: this is the strongest, code-reasoned fix for the live preview not coming up; final proof
needs a real E2B run. The in-browser ("dono preview") exact error is now captured (previewErrors, #666) —
that build predated the #666 deploy so its report had none; the next run will carry it.

Gate: frontend tsc 0, server tsc 0, vitest PASS, boot:check PASS.

## 2026-06-29 — FIX: preview errors didn't show in the DOWNLOADED report (stale client copy)

Admin: a report taken AFTER the #666 deploy still had previewErrors empty even though both previews
failed. Root cause: the capture chain worked (preview error WAS appended server-side), but the
download/Copy-report path PREFERRED the client's `state.diagnostics` — the copy delivered with the build's
`result` event at build-END, which never sees a preview error appended AFTER the build. So the user always
got the stale copy. Fix (two parts): (1) the client now fetches the SERVER copy first (durable, fresher,
carries the appended previewErrors) and only falls back to the local copy if the server has nothing;
(2) the GET /diagnostics endpoint now prefers the DURABLE workspace-keyed copy over the in-memory
(userId-keyed) one, which could be a stale earlier build or miss the post-build preview append. Shared
getLatestDiagnostics() helper used by both download + copy.

Gate: frontend tsc 0, server tsc 0, vitest 3534/3534 PASS, boot:check PASS.

## 2026-06-29 — FIX (in-browser preview root cause): CSP blocked esm.sh → "Missing dependency react"

With the precise-error fix (#665) live, a real report gave the EXACT in-browser failure:
`Run src/main.tsx: Missing dependency "react" (imported by src/main.tsx). It is not in package.json.`
Root cause: the in-browser preview's <iframe srcDoc> loads React + npm deps via `import('https://esm.sh/…')`,
and a module import is governed by CSP **script-src**. The app's script-src had 'self'/unsafe-inline/
unsafe-eval + Google hosts but NOT esm.sh — and the srcdoc iframe inherits THIS page's CSP — so the React
import was blocked → bareCache['react'] empty → require threw "Missing dependency react". (Babel worked
because it's now self-hosted from /vendor.) Fix: add the preview CDNs to script-src — `https://esm.sh`
(React + npm deps) and `https://cdn.jsdelivr.net` + `https://cdnjs.cloudflare.com` (Babel-standalone
fallback). Headers test guards all three so a future CSP tighten can't silently re-break the preview.

Also confirmed from the same report: the LIVE-server port-check fix (#668) WORKS in production —
"[health-check] dev server is UP on port 5173" (was "did not come up" every time before). And build
quality jumped to 82/100 (Sonnet + verify/CSS gates + auto-repair).

Gate: frontend tsc 0, server tsc 0, vitest 3539/3539 PASS, boot:check PASS.

## 2026-06-29 — FIX: "Build paused at the time limit" shown on a FINISHED app

User hit "Build paused at the time limit — type continue" even when the app was actually built. Root
cause: after a build SUCCEEDS (generation + verify/CSS gates + auto-repair + heal + autofix), a lot of
ADVISORY post-build work still runs synchronously before the success result is emitted — the post-build
multi-agent quality REVIEW (a sub-agent doing read→evaluate→second_opinion, historically MINUTES), plus
reflection/memory/file-save/git-push. On a heavier build that advisory tail reached the 1080s wall-clock
deadline, and the deadline timer always emitted "paused — type continue" — overwriting the success the
user earned, even though the app was built AND already durably saved.

Fix (two parts): (1) SUCCESS-AWARE DEADLINE — the deadline timer now checks a buildResultRef set the moment
the core build settles (before advisory work); if the build already succeeded, it finalizes as SUCCESS
(files are saved) instead of "paused — type continue". (2) BOUNDED REVIEWER — the advisory reviewer is
skipped when <120s deadline headroom remains and hard-capped at 90s (raceTimeout), so it can never be the
reason a finished app times out. Net: a built app shows success, never a misleading "paused".

Gate: frontend tsc 0, server tsc 0, vitest 3555/3555 PASS, boot:check PASS.

## 2026-06-29 — FIX (in-browser preview, root cause): iframe was missing allow-same-origin

THE reason the in-browser preview died with `Missing dependency "react"`: its <iframe srcDoc> sandbox was
`allow-scripts allow-forms allow-popups` — MISSING `allow-same-origin`. Without it the srcDoc document has
an OPAQUE origin, and a dynamic ES-module `import()` (exactly how the preview loads React from the CDN) is
blocked by the browser → React never loads → "Missing dependency react". (Babel worked because it's a
classic inlined <script>, not a module import.) Not CSP (firebase.json sets none; #676 didn't help) — the
sandbox origin. Tell-tale: the LIVE-server iframe right above already had allow-same-origin and worked.
Fix: add allow-same-origin to the in-browser iframe (one attribute) so module imports run. Safe — the
preview renders the user's OWN generated code.

Gate: frontend tsc 0, server tsc 0, vitest 3571/3571 PASS, boot:check PASS.
## 2026-06-29 — DIAGNOSTIC: surface the REAL reason a CDN dep import fails in the in-browser preview

The in-browser preview kept failing with `Missing dependency "react"` even AFTER the CSP fix (#676) was
deployed — and firebase.json sets no CSP — so CSP is NOT the cause; the `import('https://esm.sh/react@18')`
itself is failing in the sandboxed srcdoc iframe for a reason we couldn't see (the underlying console.warn
reason was never surfaced). Rather than guess at a big risky fix (self-host React / sandbox origin), this
captures the EXACT failure: the bare-dep loader now records each CDN import's real error
(`bareLoadErrors[spec]`), and a later "could not load" surfaces it — e.g. "Could not load 'react' … from the
CDN: Failed to fetch dynamically imported module: https://esm.sh/react@18.3.1". The next run's preview
error (now also captured into the Build report via #666) will name the precise cause (sandbox opaque-origin
vs network vs CORS vs 404), so the real fix is exact, not a guess.

Also confirmed from the same report: the live-server port-check fix (#668) WORKS — "dev server is UP on
port 5173".

Gate: frontend tsc 0, server tsc 0, vitest 3561/3561 PASS, boot:check PASS.

## 2026-06-29 — FIX: recurring CSS-Modules compile error + capture FULL review findings in report

From a "note app" report: the 2 auto-repair attempts were fixing (a) a default-vs-named import mismatch
(App imported useNotes as default; it's named — TS2613, auto-fixed) and (b) FOUR `TS2307: Cannot find
module '*.module.css'` errors — the generator uses CSS Modules but nothing declared their types, so the
verify gate tripped every time and burned repair attempts. Two improvements:
• CSS-MODULES TYPES: the vite-react + vite-react-ts scaffolds now ship `src/vite-env.d.ts` with
  `/// <reference types="vite/client" />` + explicit `*.module.css` / `*.module.scss` / `*.css`
  declarations, so CSS-Module imports type-check under `tsc --noEmit` — this whole error class (and the
  avoidable repair loop) is gone.
• FULL REVIEW IN REPORT: the post-build quality reviewer's findings were only emitted as narration and
  truncated to a 400-char timeline line, so the report couldn't list all the small problems it flagged.
  Added BuildDiagnostics.recordReview() + a `review` field (capped 12k) + text render; the route now
  records the complete review. The downloadable report now lists every problem the reviewer found.
## 2026-06-29 — FIX: prevent the recurring default-vs-named import mismatch AT GENERATION

The other recurring error (TS2613/TS2614: e.g. App imports `useNotes` as default but it's a named export)
came from per-file generation: each file is generated in its OWN call, so the model can't see another
file's actual code and guesses the export style → producer/consumer disagree → the build repairs it EVERY
time. Fix: inject a FIXED export/import convention into every per-file generation AND repair prompt
(EXPORT_IMPORT_CONVENTION) — React components use `export default` (default-imported); hooks/utils/types/
contexts/stores use NAMED exports (named-imported); never cross them; CSS-Modules default-imported. With
one deterministic rule applied to every isolated call, producers and consumers agree by construction, so
the mismatch is prevented at the source (verify+repair stays as the backstop). Pairs with the CSS-Modules
scaffold types (#688) which prevents the other recurring error (*.module.css TS2307).

Gate: frontend tsc 0, server tsc 0, vitest 3586/3586 PASS, boot:check PASS.

## 2026-06-29 — FIX (#3 live-server E2B): update_preview's OWN port-check was the gap → "No live preview yet"

#668 fixed the dev-server LAUNCHER's port-check, but `update_preview` (ToolDispatcher) has its OWN
port-readiness check, and it STILL used `nc -z localhost`. So when the sandbox image lacks `nc`, or
`localhost` resolves to IPv6 ::1 while Vite binds IPv4 0.0.0.0, update_preview read the healthy dev server
as DOWN → returned a WARNING and emitted NO `preview` event → the client never got a preview URL →
"No live preview yet" even though the dev server was up. (Confirmed flow: preview event → reducer
previewUrl → PreviewSurface url; all wired — the event simply never fired.) Fix: update_preview now uses
the same tool-agnostic, IPv4-forced check (nc → curl → bash /dev/tcp on 127.0.0.1). With the port detected
UP, getPortUrl runs and the preview event fires → the live tab shows the app.

Gate: frontend tsc 0, server tsc 0, vitest 3586/3586 PASS, boot:check PASS.

## 2026-06-29 — FIX (#3 live-server E2B): update_preview's OWN port-check was the gap → "No live preview yet"

#668 fixed the dev-server LAUNCHER's port-check, but `update_preview` (ToolDispatcher) has its OWN
port-readiness check, and it STILL used `nc -z localhost`. So when the sandbox image lacks `nc`, or
`localhost` resolves to IPv6 ::1 while Vite binds IPv4 0.0.0.0, update_preview read the healthy dev server
as DOWN → returned a WARNING and emitted NO `preview` event → the client never got a preview URL →
"No live preview yet" even though the dev server was up. (Confirmed flow: preview event → reducer
previewUrl → PreviewSurface url; all wired — the event simply never fired.) Fix: update_preview now uses
the same tool-agnostic, IPv4-forced check (nc → curl → bash /dev/tcp on 127.0.0.1). With the port detected
UP, getPortUrl runs and the preview event fires → the live tab shows the app.

Gate: frontend tsc 0, server tsc 0, vitest 3586/3586 PASS, boot:check PASS.

## 2026-06-29 — FIX: a missing local file no longer blanks the WHOLE in-browser preview

Recurring pain: NoteCard imported `../utils/formatDate`, a file the generator referenced but never
created. Even after "Fix with AI" edits the file stayed missing, so the in-browser preview HARD-CRASHED
every time with "Cannot resolve '../utils/formatDate'" → blank. Fix: the in-browser module loader is now
RESILIENT — a missing LOCAL relative import is substituted with a forgiving stub (a Proxy whose every
access is a no-op returning '') so the REST of the app renders, and a non-blocking orange banner names the
missing file(s) ("Missing file (stubbed so the preview still renders): src/utils/formatDate (imported by
src/components/NoteCard.tsx)") + postMessages it to the host so the Build report still captures it. Honest
(the gap is shown, not hidden) and resilient (one dangling import ≠ blank screen). A missing bare npm dep
(e.g. React) still hard-errors — that genuinely can't be stubbed.

Gate: frontend tsc 0, server tsc 0, vitest 3586/3586 PASS, boot:check PASS.

## 2026-06-30 — FIX: all 4 build-report errors (Tailwind toolchain + skip-install + in-browser Tailwind CDN + prop/type prompt contracts)

A "todo app" build report surfaced 4 problems; fixed at the deterministic root cause "best tarikhe se":

1. (biggest) `npm run dev` crashed `Cannot find module 'tailwindcss'` (PostCSS) → live preview never came
   up + in-browser unstyled. Root cause: apps use Tailwind but the scaffold didn't ship it, AND the fast-lane
   install (`[ -d node_modules ] && echo "deps present" || npm install`) SKIPPED install when node_modules
   existed but package.json had since added tailwindcss. Fix: (a) Scaffold.ts now bundles the Tailwind
   toolchain into BOTH vite-react and vite-react-ts scaffolds — devDeps (tailwindcss/postcss/autoprefixer),
   postcss.config.js, tailwind.config.js, and `@tailwind base/components/utilities` in src/index.css.
   (b) agentv3.ts install commands (fastPreview + fastVerify) now re-install when package.json is NEWER than
   node_modules (`[ ! -d node_modules ] || [ package.json -nt node_modules ]`) so a newly-added dep is never
   skipped. (c) ReactPreview.ts: a Tailwind-using app loads the Tailwind Play CDN and routes @tailwind/@apply
   CSS (incl. Vite's JS-imported index.css via the runtime injectCss → #__nbai-tw block) into a
   `<style type="text/tailwindcss">` so the no-build in-browser preview is STYLED. (d) CSP scriptSrc allows
   cdn.tailwindcss.com so the preview iframe can load it.
2. TaskCounter prop mismatch (parent passed remaining/total, child declared count), 3. useLocalStorage.ts
   used `React.Dispatch` in a .ts file without importing React ("Cannot find namespace 'React'"), 4. `key`
   placed in a props interface. All three are prevented at generation: SimpleBuilder's EXPORT_IMPORT_CONVENTION
   now carries PROP & TYPE CONTRACTS (parent props must EXACTLY match the child's declared props; in .ts/.tsx
   import React types via `import type { Dispatch, SetStateAction } from "react"`, never bare `React.` without
   importing React; `key` is React's list special prop, never in a props interface) — injected into both the
   generation and repair prompts, with verify(tsc)+auto-repair as the backstop.

Tests: +Tailwind-CDN preview test (reactPreview), +Tailwind-toolchain scaffold test (both scaffolds),
+cdn.tailwindcss.com CSP guard (headers).

Gate: frontend tsc 0, server tsc 0, vitest 3693/3693 PASS, boot:check PASS.

## 2026-06-30 — FIX (permanent): AgentV3 dev server "Killed" loop + E2B stale-deps skip-install

A live build report ("add a real-time clock") showed the dev server starting fine
(`VITE ready … Local: http://localhost:5173/`) then printing **`Killed`** seconds later,
the health-check restarting it, and the loop burning the full 1080s budget → `BUILD_TIMEOUT`.
Two root causes, both in the AgentV3 E2B sandbox path, both fixed deterministically:

1. **Dev server self-backgrounding → orphaned → reaped.** The actuator already starts long-running
   commands with E2B `background:true` (which keeps the process alive across calls). But the agent
   wrote its OWN backgrounding — `npm run dev … &> /tmp/vite.log &`, `nohup npm run dev … &`,
   `npx vite … 2>&1 &` — so the shell launched vite in the background and EXITED immediately; E2B saw
   its command finish and reaped the command's process group, killing the orphaned vite ("Killed").
   EVERY launch in the report ended in a trailing `&`. Fix: new pure `stripDevServerBackgrounding()`
   in devServerHost.ts removes a trailing single `&` (never `&&`) and a leading `nohup` (+ the file
   redirect that precedes the `&`), so vite runs in the FOREGROUND of E2B's background command and
   E2B tracks its lifetime → it stays up. Applied in E2BActuator.runCommand before host/port pinning.
2. **E2B install gate skipped on stale node_modules.** `build()` only ran `npm install` when
   node_modules was MISSING — so when the scaffold/agent added a dep (tailwindcss) to package.json but
   node_modules already existed from a prior build, the dep was never installed and `npm run dev`
   crashed with "Cannot find module 'tailwindcss'". Fix: new pure `buildDepsStaleCheckCommand()`
   (`[ ! -d node_modules ] || [ package.json -nt node_modules ]`) gates the install in build() AND
   before the dev server launches, so a newly-declared dep is always installed before boot. (npm ci's
   own "errors when lock and package.json are out of sync" behaviour makes the fallback to `npm install`
   reconcile the new dep.)

Tests: +6 devServerHost cases (stripDevServerBackgrounding across the exact failing commands +
foreground/`&&` safety; buildDepsStaleCheckCommand). These complement the same-PR scaffold/skip-install/
in-browser-Tailwind fixes.

Gate: frontend tsc 0, server tsc 0, vitest 3699/3699 PASS, boot:check PASS.

## 2026-06-30 — POLISH: preview-ready Vite scaffold config + agent guardrail against self-backgrounding

Follow-up hardening on the AgentV3 preview path (after the "Killed"/Tailwind fixes in #710):

1. **Vite scaffold now ships preview-reachable server config.** The bare
   `defineConfig({ plugins: [react()] })` forced the agent to edit vite.config mid-build (the live
   report showed it adding `allowedHosts` by hand) and left three recurring preview failures open.
   All Vite scaffolds (react, react-ts, vue, svelte, pocketbase, convex) now bake in
   `server: { host: true, port: 5173, strictPort: true, allowedHosts: true }, preview: { allowedHosts: true }`:
   host:true → reachable cloud preview (not localhost-only), strictPort → no silent 5173→5174 drift,
   allowedHosts → no "Blocked request … is not allowed". The agent no longer wastes steps on config.
2. **Agent prompt guardrail against self-backgrounding.** systemPrompt now tells the agent the sandbox
   already backgrounds + keeps the dev server alive, so run `npm run dev` as a PLAIN FOREGROUND command —
   no trailing `&`, no `nohup`, no `&> log &` (that orphans the server → "Killed" → restart loop), and if
   it ever sees "Killed", read the logs for the real error (e.g. missing dep → npm install) instead of
   relaunching with `&`. Belt-and-suspenders with the stripDevServerBackgrounding() fix from #710.

Tests: +scaffold case (host/strictPort/allowedHosts across the 4 Vite frameworks), +systemPrompt case
(forbids self-backgrounding, names "Killed").

Gate: frontend tsc 0, server tsc 0, vitest 3701/3701 PASS, boot:check PASS.

## 2026-06-30 — E2B FIX: detect bare/npx/node Vite as a long-running server (no more 300s deadline_exceeded)

The same live build report showed `npx vite --host 0.0.0.0 --port 5173 &` returning
`exit -1 (300s) [deadline_exceeded]` and the agent also trying `node node_modules/vite/bin/vite.js …`.
Root cause: the actuator's long-running detection only knew `npm run dev`/`next dev`/`nuxt dev`/etc. —
it did NOT recognise a BARE Vite invocation (`vite`, `npx vite`, the node bin path, `vite preview`).
So those fell through to the FOREGROUND command path, which waits up to the 5-minute command timeout
for a server that never exits → `deadline_exceeded`, no health-check, no preview.

Fix: extracted the detection into a pure, unit-tested `isLongRunningCommand()` in devServerHost.ts and
added Vite detection — any `vite`/`npx vite`/`node …/vite/bin/vite.js`/`vite preview` is long-running,
EXCEPT `vite build` (compiles then exits). Wired E2BActuator.runCommand to use it (replacing the inline
regex). Also added a prompt line so the agent never `cd /workspace` (commands already run in the project
root `/home/user/workspace`; the wrong `cd` returned "No such file or directory" and wasted a step).

Tests: +isLongRunningCommand cases (bare/npx/node vite + vite preview = true; vite build / npm run build
/ curl / tsc = false), +systemPrompt case (no `cd /workspace`).

Gate: frontend tsc 0, server tsc 0, vitest 3706/3706 PASS, boot:check PASS.

## 2026-06-30 — MEMORY: best-in-class recall (BM25) + outcome-weighted "proven lessons"

Admin asked to make v3.0's memory top-level / better than all AIs. v3.0 already has a sophisticated
multi-layer memory (WorkspaceMemory graph+episodes, Firestore persistence, Reflection→KnowledgeEvolution
→RecalledLessons learning loop, UserPreferenceStore). This upgrades the two layers that decide WHAT the
agent is reminded of, both pure + fully unit-tested (no new infra):

1. **BM25 relevance ranking (new `Bm25.ts`).** Recall scored every query token with a flat "+2 whole-word
   /+1 substring" tally — a common token ("page", "button") counted as much as a rare, discriminating one
   ("stripe", "websocket"). Recall now ranks token relevance with Okapi BM25 over the whole memory corpus
   (symbols+files+episodes): IDF weights rare tokens higher, TF saturates so a doc can't win by spamming a
   word, and length-normalisation favours focused docs. WorkspaceMemory.recall keeps its exact/prefix/
   substring phrase bonuses (so "UserCard"→the UserCard symbol still wins) and the deterministic recency
   tiebreak on top of the BM25 token signal — all prior recall tests stay green.

2. **Outcome-weighted "proven lessons" (KnowledgeEvolution + RecalledLessons).** Lessons now carry their
   episode `kind`, and evolveLessons ranks by CONFIDENCE first: a proven `fix` (worked) > a `note`
   (reflection) > a one-off `error`, plus a reinforcement bump each time the same lesson is independently
   re-recorded (repeatedly-confirmed advice ranks higher; contradictions still let newer advice win).
   Confidence is gated to 0 when no `kind` is supplied, so every existing caller/test keeps its prior
   ordering — the new weighting only activates on real episode outcomes.

Net effect: each build is reminded of the MOST relevant + MOST trustworthy lessons first, not a flat
keyword dump — the recall quality that separates a top-tier agent memory from a basic one.

Tests: +Bm25.test.ts (IDF/TF-saturation/length-norm/empty), +WorkspaceMemory rare-token-ranks-first,
+KnowledgeEvolution fix>note>error & reinforcement & kind-less-neutral, +RecalledLessons fix-before-error.

Gate: frontend tsc 0, server tsc 0, vitest 3717/3717 PASS, boot:check PASS.

## 2026-06-30 — MEMORY: Cross-Project User "Brain" (lessons carry across all your projects)

The memory loop was per-WORKSPACE: a lesson learned in project A never helped project B.
UserPreferenceStore already carries stack PREFERENCES across a user's projects; this adds the
equivalent for LESSONS — a per-user "brain" of the highest-signal, transferable lessons.

- NEW `UserLessonBrain.ts` (pure core + Firestore `user_brain_v3/{userId}`, mirrors UserPreferenceStore:
  VITEST-skip, best-effort, never throws). Pure core: `extractPromotableLessons` (promote ONLY proven
  `fix`es + reflection `note`s — never raw error symptoms, PLAN_STATE, or requests), `mergeLessonsIntoBrain`
  (fold a build's lessons in: near-duplicates REINFORCE and carry the count forward across builds, a proven
  fix upgrades a note of the same claim, contradictions let newer advice win, set capped to the highest-
  confidence 60), `formatBrainLessons` (inject the top lessons, gated until ≥2 prior builds).
- DRY: refactored KnowledgeEvolution to expose a shared `mergeLessons` engine + `lessonConfidence` and the
  `normalizeLessonText`/`isNearDuplicate`/`isConflict` primitives, so the brain and per-workspace recall use
  ONE definition of "same lesson"/"contradiction"/"trustworthiness". `evolveLessons` is now a thin wrapper —
  behaviour-identical (all prior tests green).
- Wired into routes/agentv3.ts: inject the brain block into the Architect system prompt right after the
  preference block (best-effort), and promote this build's transferable lessons after a successful build
  (best-effort, gated on result.ok). Both additive — a failure leaves the prompt/build unchanged.
- AppKnowledgeBase: updated the agentv3_builder memory bullet (BM25 relevance + outcome-weighted + cross-
  project brain) and keywords, per the mandatory sync rule.

Tests: +UserLessonBrain.test.ts (11 cases: extract filters, reinforce-across-builds, fix-upgrades-note,
conflict-newer-wins, cap, null-tolerance, gating, fix-above-note, block cap) + WorkspaceMemory invariants
(exact match beats token match; recall determinism).

Gate: frontend tsc 0, server tsc 0, vitest 3730/3730 PASS, boot:check PASS.

## 2026-06-30 — MEMORY: rock-solid pass on the cross-project brain (review fixes)

A high-effort code review of the cross-project brain surfaced two real correctness findings + reuse/polish:

1. (correctness) Re-promotion inflation / recency corruption. On a RESUMED build, restoreWorkspaceMemory
   replays every PRIOR build's episodes into memory (re-stamped with a fresh ts). Promoting the whole
   snapshot re-promoted those old lessons every build → falsely inflated `reinforced` (confidence) counts
   and made months-old advice look perpetually fresh. Fix: the route now captures a watermark
   (`brainBaselineTs = Date.now()`) BEFORE the build runs and promotes ONLY episodes created at/after it —
   i.e. exactly what THIS build produced — so each lesson is reinforced once per genuine confirmation.
   (v3.0 records no `fix` episodes mid-build; the real transferable signal is this build's reflection note.)
2. (reuse) formatBrainLessons duplicated RecalledLessons' snippet + budget + assembly loop. Extracted a
   shared `LessonBlock.ts` (`formatLessonBlock` + `lessonSnippet` + ONE budget constant) and refactored BOTH
   RecalledLessons and UserLessonBrain onto it, so the per-workspace and cross-project injection blocks can
   never drift. Behaviour-identical (all prior tests green).
3. (polish) Tightened comments: dead rhetorical comment removed; `totalBuilds` doc clarified to "builds that
   contributed a lesson"; the store doc-comment now references the FirestoreWorkspaceMemoryStore pattern it
   actually follows.

Tests: +LessonBlock.test.ts (4). Gate: frontend tsc 0, server tsc 0, vitest 3734/3734 PASS, boot:check PASS.

## 2026-06-30 — FIX (hard): v3.0 state survives a server cold-start (preview + plan no longer vanish after ~15-min idle)

Real report: after ~10–15 min idle the Cloud Run instance recycles and ALL in-memory state is lost — the
in-browser preview showed "No files to preview yet" (even though Files(15) listed files), the plan reset to
0/N, and memory looked gone. A high-effort trace found three gaps at the durable-store ↔ client boundary;
fixed the two VISIBLE ones (memory was already durable + restored for the agent on the next build):

1. PLAN/TODOS vanished. The plan is saved durably as a PLAN_STATE note in workspace memory but was only
   parsed to prime the next build's PROMPT — never sent back to the UI on resume, so the panel reset to 0/N.
   Fix: new pure `parsePlanState()` (exact inverse of `formatPlanState`, round-trip tested) + the
   `GET /api/agentv3/conversations/:id` endpoint now also returns `workspaceState.todos` (restored from the
   durable PLAN_STATE) + `loadConversation()` dispatches them into the reducer. Reopening a session now shows
   the real plan progress. All best-effort — a restore failure never blocks resume.
2. PREVIEW stuck on a stale error. The in-browser preview auto-load effect had a `!err` guard, so once the
   first fetch 404'd on a cold instance (durable saved files still loading) it NEVER retried — the stale
   "No files" error stuck forever. Fix: drop the `!err` guard so reopening the session re-attempts (the
   server endpoint already falls back to the durable saved files). The effect only re-runs on mode/workspace
   change, so it can't loop.

Tests: +parsePlanState round-trip/tolerance/coercion (4). Gate: frontend tsc 0, server tsc 0, vitest
3740/3740 PASS, boot:check PASS.

HONEST LIMITATION: the actual Cloud Run cold-start can't be reproduced in CI. The restore logic is pure +
unit-tested and the wiring is additive/best-effort (it can never break a running build — strictly improves
resilience), but final end-to-end confirmation needs a real resumed session after an idle recycle.

## 2026-06-30 — UX: v3.0 composer — device-aware Enter + auto-grow + expand/minimize

Two requested composer changes in AgentV3Panel:
1. Enter behaviour is now device-aware: on a LAPTOP (fine pointer / physical keyboard) Enter sends; on a
   PHONE (touch-primary, `matchMedia('(pointer: coarse)')`) Enter inserts a newline and you send via the
   button — matching how mobile chat apps behave. Shift+Enter is always a newline. Reactive to device change.
2. The composer auto-grows with its content (was a fixed 2 rows) up to ~5 lines, then scrolls internally,
   and gains an expand/minimize button (Maximize2/Minimize2) that opens a tall 50vh editor so a long
   message can be read/edited comfortably; in the expanded editor Enter always inserts a newline (so a long
   message can be edited freely), and sending collapses it back.

Gate: frontend tsc 0, vitest 3750/3750 PASS. UI-only change (AgentV3Panel.tsx); no server change.

## 2026-06-30 — FIX: in-browser preview no longer fails "No React entry module found"

Build report (online media player, vite-react-ts): build OK + app compiles, but BOTH previews failed —
Live server "No live preview yet" (cold sandbox: live URL gone — the in-browser preview is the intended
fallback) AND In-browser "No React entry module found", even though src/main.tsx exists and index.html
references it. Root cause: findEntry only resolved the entry by EXACT key (the index.html script src, then
a fixed list of src/main.* defaults). When the file map reaches the preview keyed under an unexpected
prefix / leading slash / `./` (durable restore, cold-reconnect collection), the exact lookup misses and
the preview dies even though an entry clearly exists.

Fix: findEntry is now RESILIENT — after the exact index.html-src and src/main.* defaults, it (1) matches
the script src's BASENAME anywhere in the tree, then (2) falls back to ANY `main`/`index` source file
anywhere (preferring main.*, shallower paths; ignoring .test/.spec files). So as long as an entry exists
under any key shape, the in-browser preview renders instead of erroring. Combined with #719's retry-on-
reopen, a session reopened after the sandbox is gone now renders via the durable files.

Tests: +2 reactPreview cases (basename fallback; last-resort main/index anywhere, test files excluded).
Gate: server tsc 0, vitest 3764/3764 PASS, boot:check PASS.

HONEST LIMITATION: I can't reproduce the exact cold-sandbox file-keying in CI; the fix is a pure,
unit-tested resilience improvement to entry detection. Final confirmation needs a real reopened session.

## 2026-06-30 — FEATURE: v3.0 chats menu (☰) — real history list, open any chat, "+ New chat", cross-device

Admin asked for a 3-line menu in the v3.0 header that opens a real chat-history list, lets you continue the
same project/memory from any device (Claude-style), plus a "+ New chat".

The continuity infra already existed — conversations are stored PER USER in Firestore (GET
/api/agentv3/conversations lists by userId), and loading a conversation adopts its sessionId so a follow-up
continues the SAME workspace/memory; #719 restores plan/preview on resume. What was missing was the UI to
list ALL chats and open a SPECIFIC one (the client only auto-loaded the most recent).

Added:
- useAgentV3Build: `listConversations()` (metadata list) + `loadConversation({ id })` to open a SPECIFIC
  saved chat (was most-recent only).
- AgentV3Panel: a ☰ (Menu) button at the top-left of the v3.0 header opens a dropdown with "+ New chat" and
  the account's saved chats (newest first, title + relative time). Tapping a chat loads its thread + plan and
  adopts its sessionId → continues that exact project/memory. Because the list is per-account, it works from
  any signed-in device (open on phone, continue on laptop).
- AppKnowledgeBase: HISTORY entry + keywords updated for the chats menu / cross-device continuity.

Gate: frontend tsc 0, server tsc 0, vitest 3771/3771 PASS, boot:check PASS. UI + thin client/hook wiring;
reuses the existing per-user conversation store + durable restore (no new server endpoints).

## 2026-06-30 — UX: remove the redundant top-right "New" button from the v3.0 header

The ☰ chats menu (#730) now carries "+ New chat", so the separate "↺ New" button at the top-right of the
v3.0 header was redundant. Removed it (idle state only); the running "Stop" and server-running "Resume/Stop"
controls are unchanged, and startNewSession still backs the menu's "+ New chat". UI-only.

Gate: frontend tsc 0, vitest 3775/3775 PASS.

## 2026-06-30 — FEATURE (Slice A): cross-device live-sync FOUNDATION (shared LiveChannel + poll endpoint)

Admin chose "throttled Firestore + abstraction" for cross-device live build activity (a 2nd device watching
the same account's build sees the live processing, even on a different Cloud Run instance). Slice A is the
server foundation (additive — the existing in-memory /attach live path is untouched):

- NEW pure `LiveEventBuffer.ts` — a capped ring + monotonic seq, with `appendEvents` and `eventsSince`
  (delta-since-cursor + a `gap` flag when the cursor predates the trimmed ring). Fully unit-tested (10).
- NEW `LiveChannel.ts` — a swappable transport interface + `FirestoreLiveChannel`: THROTTLED publish
  (one batched write ~every 1.5s, capped 200-event ring per channel → cheap at 1M users; throwaway events
  are never durably stored beyond the recent tail), `readSince`, `close`. Single-writer in-memory mirror
  (the build instance) avoids a read-before-write. Server-only (admin SDK) so the DB is never client-exposed.
  A RedisLiveChannel can drop in behind the same interface at extreme scale.
- Wired: broadcastBuild now ALSO mirrors each event to liveChannel.publish (best-effort); endBuild closes
  the channel; the build registers its key. New GET /api/agentv3/live?sinceSeq= reads the shared channel
  (works cross-instance) and returns {events, seq, gap, running}.

Cost/security (admin's concern, addressed): live events are EPHEMERAL + throttled + capped (not per-event
durable writes), and the store is server-mediated only (clients hit our API, never Firestore directly).

Slice B (next): client poll wiring (the 2nd device actually rendering the live events), with tight
cost-gating (only poll while a chat is open + a build is active) and cross-instance "active" detection.

Gate: server tsc 0, vitest 3785/3785 PASS, boot:check PASS.

## 2026-06-30 — FEATURE (Slice B): cross-device live mirror — client poll of the shared LiveChannel

Completes the cross-device live build sync (Slice A shipped the server LiveChannel + poll endpoint). Now a
2nd device watching the same chat RENDERS the live activity from a build running on another device/instance.

- useAgentV3Build: new `subscribeLive()` — polls GET /api/agentv3/live (cursor = last seq), feeds the
  returned events through the SAME reducer as the live stream, and is SELF-LIMITING for cost: it only runs
  while started, and auto-stops after ~30s of no activity when the server reports not-running.
- AgentV3Panel: starts subscribeLive only while the panel is OPEN + VISIBLE and NOT running a build locally;
  re-armed on visibility (liveNonce); torn down the moment a local build starts. So only visible, idle v3.0
  panels poll (every 3s), and they wind down quickly — bounded cost; Redis/WebSocket can replace polling later.

Net: open the same chat on phone + laptop → the device that isn't building shows the other's live progress;
when the build finishes the durable result is already in place (#719/#730).

Gate: frontend tsc 0, server tsc 0, vitest 3785/3785 PASS.

HONEST LIMITATION: the actual cross-device/cross-instance live behaviour can't be reproduced in CI; the
ring/seq/delta core is unit-tested and the wiring is additive (it never touches the local build stream).
Final confirmation needs 2 real signed-in devices.

## 2026-06-30 — FIX (root cause, Slice 1/2): v3.0 build drift — SHARED CONTRACT before per-file generation

Admin: v3.0 loops "Found build errors — fixing them (1/2, 2/2)" and STILL doesn't fix them. A multi-agent
workflow CONFIRMED the root cause: SimpleBuilder generates each file in its OWN isolated parallel LLM call
whose prompt contains ONLY the file LIST (path + one-line purpose) of siblings — never the real exported
symbols / enum members / prop interfaces / util signatures. So independently-generated files DISAGREE
(MediaType.YouTube vs enum {YOUTUBE}; child prop {url} vs parent {embedUrl}; import {extractVimeoEmbedUrl}
from a util that only exports extractEmbedUrl; undefined PlayerState; enum-vs-string compares), and the
bounded 2-attempt repair can't reconcile that many simultaneous mismatches.

Slice 1 (LENS A — the primary lever): generate ONE shared CONTRACT up front (the exact enums with frozen
member casing, shared types/interfaces, util signatures, and each component's prop interface) via one cheap
call BEFORE the per-file fan-out, then inject that frozen contract into EVERY per-file generation prompt AND
the repair prompt (contractSystemPrompt/contractUserPrompt/contractBlock; shareContract default-on; fileUserPrompt
+ repairUserPrompt thread it; route's fastRepair forwards it). Files can no longer invent divergent
names/shapes — they're handed the single source of truth, so producer + consumer agree by construction.

Slice 2 (next): LENS B (dependency-ordered generation feeding each consumer its producers' REAL generated
source — catches the case where a file deviates from the planned contract) + LENS C (a pure ContractMap
deterministic drift backstop fed into repair so any residual mismatch is named precisely, incl. CSS-class drift).

Gate: frontend tsc 0, server tsc 0, vitest 3809/3809 PASS (incl. new contract tests), boot:check PASS.

## 2026-06-30 — FIX (root cause, Slice 2/2): v3.0 build drift — DEPENDENCY-ORDERED generation (LENS B)

Builds on Slice 1 (shared contract). Slice 1 injects the PREDICTED contract; Slice 2 feeds each file the
REAL generated source of its foundations, so a file uses the actual exported names even if a producer
deviated from the predicted contract.

LENS B: SimpleBuilder now generates in dependency TIERS instead of one all-parallel batch —
0 foundation (types/interfaces/models/constants/config/utils/lib/helpers/hooks/contexts/stores/services/css)
→ 1 components → 2 shell (entry main/index, App, pages/routes, *Page/*Screen/*View). Each tier runs in
parallel internally and is fed dependencyContext() — the REAL source of all earlier tiers — so a component
sees the real types/enums/util-signatures, and the shell (incl. *Page composers) sees the real component
prop interfaces. New pure helpers generationTier() + dependencyContext(); fileUserPrompt() gains an optional
deps block. Gated behind depOrder (default ON; env AGENTV3_DEP_ORDER=off for a byte-identical single-batch
fallback; collapses to today's batch when only one tier is present).

Tests (+7, 32 total in SimpleBuilder.test.ts): generationTier classification; dependencyContext framing+cap;
a staged-order test asserting foundation-before-component-before-shell AND the component's prompt carried the
foundation's real source (via a generate spy); and depOrder:false → no dep block (byte-identical fallback).

Remaining hardening (optional, only if a real build still struggles): LENS C — a pure ContractMap drift
report fed into repair + CSS-class drift reaching repair on a never-green build.

Gate: server tsc 0, vitest 3857/3857 PASS, boot:check PASS.
HONEST LIMITATION: CI can't prove the live model now emits matching identifiers end-to-end; the tiering,
ordering, and real-source injection are pure + unit-tested (generate spy), but real convergence on the
media-player prompt needs a real fast-lane build + a BuildDiagnostics bundle.

## 2026-06-30 — FIX (root cause, Slice 3/3 — LENS C): deterministic ContractMap drift backstop into repair

Completes the build-drift fix (Slice 1 shared contract + Slice 2 dependency-ordered generation). LENS C is
the safety net for any residue that still slips through to verify: a NEW pure module ContractMap.ts detects
the two highest-signal drift classes deterministically and feeds a COMPACT report into the repair pass so
the precise mismatches survive the repair prompt's ~6k error-slice truncation.

- ContractMap.ts (pure): extractContract(files) → per-module exported symbols + enum members; contractDriftReport(files)
  → one compact line per mismatch for (1) a named import the target does NOT export (e.g. extractVimeoEmbedUrl
  from a util that only exports extractEmbedUrl) and (2) an Enum.Member the enum does not declare (e.g.
  MediaType.YouTube vs {YOUTUBE}). Conservative: resolves only in-app relative imports, skips export-* targets,
  external imports, default imports, CSS; returns null on no drift. Advisory only — tsc stays the hard gate.
- Wired into SimpleBuilder's repair loop: the drift report is PREPENDED to the tsc errors before each repair
  call, so the model sees the full, precise mismatch set in a form that fits the slice.

Tests: +8 ContractMap (the exact report symptoms + null on agreement + conservative skips + index resolution).
Gate: server tsc 0, vitest 3865/3865 PASS, boot:check PASS.

NET (A+B+C): drift is prevented at generation (shared contract + real producer source) AND, if any residue
reaches verify, named precisely + compactly into repair so it converges. HONEST: end-to-end convergence on a
live model still needs a real fast-lane build to confirm; all three layers' logic is pure + unit-tested.

## 2026-06-30 — RELIABILITY (audit + keystone fix): deterministic Build Outcome classification

A 3-agent audit of the admin's P0/P1/P2 + Quality-Gates roadmap found the system already implements ~90%
(DependencySync = package.json reconciliation from imports; post-gen tsc verify gate; ContractMap = runtime
import/export + enum-member validation; ArchitectureAnalysis = circular-dep + unresolved-import detection;
ProjectVerifier/ArchitectureValidator = integrity; durable restore/resume; retry budget; structured
diagnostics with ORIGINAL-error preservation + timeline). Genuine gaps identified: (P0) no build-outcome
classification (just boolean ok); (G4) no production `npm run build` gate; (G3) tsc gate only in fast lane,
not the agentic loop; (P1) no durable↔live workspace consistency check; orphan/unused-import detection;
stuck-tool auto-recovery + deadlock detection.

Keystone fix shipped (the one the admin explicitly listed, and what every gate/dashboard branches on): a
PURE BuildOutcome classifier — BUILD_SUCCESS / BUILD_PARTIAL / TYPECHECK_FAILED / BUILD_FAILED /
PREVIEW_FAILED / RUNTIME_FAILED. It resolves the standing tension between "a preview/runtime failure must
NOT mark a compiling app as a BUILD failure" and "a runtime smoke check is required before full success":
the answer is to CLASSIFY, not blunt-fail — a compiling app whose preview is down is PREVIEW_FAILED
(ship-with-warning), distinct from TYPECHECK_FAILED / BUILD_FAILED (real build failures). SimpleBuildResult
now carries `outcome`; the route records it into the build report (OUTCOME_*).

Tests: +10 BuildOutcome (every precedence path + isBuildFailure + labels). Gate: server tsc 0, vitest
3878/3878 PASS, boot:check PASS.

Next reliability gaps (prioritized, follow-up PRs): G3 tsc-in-agentic-loop, G4 production-build gate (flag-
gated), durable↔live workspace-consistency check, orphan/unused-import detection.

## 2026-07-01 — RELIABILITY (G3): deterministic tsc gate in the agentic loop + flaky-test fix

Two ship-blockers cleared, both aligned with "rock solid, error never returns":

1. **Flaky CI fix (#753).** `CheckpointStorage.save()` called `openSync(tmpPath)` but the `.checkpoints`
   directory was only created via an ASYNC `mkdir` in the constructor — a save that raced ahead of that
   promise hit `ENOENT`. It was intermittent (same commit passed on one CI runner, failed on another).
   Fix: a synchronous `mkdirSync(this.storageRoot, { recursive: true })` at the top of `save()` — idempotent,
   cheap, and it makes the first save impossible to lose the race. Deterministic.

2. **G3 — post-agentic tsc gate.** The fast lane (SimpleBuilder) type-checks + repairs, but the agentic
   loop / escalation / empty-build retry path had NO deterministic compile gate — it relied on the agent
   choosing to run `tsc`, which is not guaranteed, so a "finished" agentic build could still ship type
   errors. Added a post-agentic gate (default-on; `AGENTV3_AGENTIC_TSC_GATE=off` to disable): one real
   `tsc --noEmit` over the produced files → on type errors, ONE bounded Claude repair pass (same
   repair prompts the fast lane uses) → re-check. Purely ADDITIVE — it NEVER flips `result.ok` and NEVER
   blocks (best-effort, abortable, budget-capped); on persisting errors it records the honest
   `OUTCOME_TYPECHECK_FAILED` into the build report (ship-with-warning, like PREVIEW_FAILED). A `fastLaneGated`
   flag skips the gate when the fast lane already produced the result (no redundant tsc run). Runs BEFORE the
   preview self-check so compile errors are fixed before rendering. New pure `hasTscErrors()` helper (shared,
   unit-tested) keeps the "is this a real type error?" regex in one place (no drift with the fast lane).

Tests: +5 TscGate (real error / clean / null / warning-only / noisy log). Gate: frontend tsc 0, server tsc 0,
vitest 3897/3897 PASS, boot:check PASS.

Next reliability gaps (prioritized, follow-up PRs): G4 production-build gate (flag-gated),
durable↔live workspace-consistency check, orphan/unused-import detection, stuck-tool auto-recovery.

## 2026-07-01 — PARTIAL-hardening batch: 4 roadmap PARTIALs shipped rock-solid (#770–#773)

Continued the "🟡 partial → rock-solid, one by one" march. Each shipped via the full cycle
(real feature → tsc+vitest+build+boot gate → unique branch → PR → CI green → squash-merge →
roadmap updated). All real, wired, tested — no shelf-ware.

1. **P-DEPLOY.6 (#770)** — MultiCloudDeploy made honest + real. Removed dead fake `LOG_MESSAGES`
   ("Deployment successful!" placeholder logs). Added a REAL in-app Vercel deploy: when the user
   supplies their own `VERCEL_TOKEN`, "Deploy" publishes via the existing `/api/pro/deploy`
   (`deployVercel` → real Vercel `/v13/deployments`) and shows the true live URL; no token → honest
   CLI-instructions path (never a faked success).
2. **P-DESIGN.3 (#771)** — centralized Platform Accessibility Engine `src/lib/a11y.ts` (pure logic +
   thin DOM adapter, like the chart lib). Focus-trap adopted in the Drawer/BottomSheet modals (they
   were `aria-modal` but let focus escape — WCAG 2.4.3); real Text-Size/zoom control (90–140 %,
   `--nb-font-scale`); tri-state Motion pref (On/Reduced/**System** honors OS `prefers-reduced-motion`,
   opt-in so the animations-on default is respected). 17 unit tests. Color-blind palettes + a formal
   CI WCAG gate honestly deferred.
3. **P-COLLAB.1 (#772)** — durable team membership + real token-based invite acceptance. New
   `TeamStore.ts` (Firestore, VITEST-skip, pure builders, 10 tests): `teamInvites/{token}` +
   `teams/{teamId}/members/{uid}`. Full lifecycle in `routes/team.ts` (invite/resolve/accept/revoke/
   member-remove/list); accept **grants the RBAC role** via `setUserRole` (wires into P-SEC.1). Frontend:
   TeamCollaboration sends the owner's ID token (so the RBAC gate passes), surfaces a real copyable
   invite LINK, real backend revoke; new isolated `InviteAcceptGate` (`?join=<token>`, mounted in
   main.tsx not App.tsx). Email delivery deferred (no SMTP infra → real link-based invite instead).
4. **P-DESIGN.7 (#773)** — live cursors + line-anchored comments in LiveCollaboration, over the
   existing Firestore room channel (no new dep). Presence subcollection broadcasts each teammate's caret
   LINE (throttled ~300 ms; shown as "✎ line N"); comments subcollection with jump-to-line + resolve.
   Pure `collabAnnotations.ts` (11 tests). CRDT/Yjs evaluated → not adopted (dependency-free policy).

Every user-facing change also updated `AppKnowledgeBase.ts` (Text Size, Motion, Team Collaboration,
Live Collaboration entries) per the mandatory sync rule.

**Remaining item-level PARTIALs that are doable but NOT safe for the autonomous rapid cycle — deferred
honestly (see roadmap 🔶 notes), needs an admin decision:**
- **P-PE.5 (prompt A/B):** a real variant B changes the LIVE builder system prompt = core Engineer-AI
  behavior change → needs admin to define/approve the experiment (Engineer-AI constraints + safeguard #3).
- **P-COLLAB.2 (workspace ACL):** verified the target routes (`/api/sync/:userId`) are currently
  UNAUTHENTICATED — enforcing there *adds* auth = breakage risk; and the `requireUserMatch` routes are
  sensitive (secrets/webhooks) that members must never see → security risk. Needs a careful, reviewed
  per-route pass, not the rapid cycle. (Member data model already exists from P-COLLAB.1.)

The remaining item-level PARTIALs classified earlier as shelf-ware (no genuine consumer) are still
correctly NOT built (P-PME.12, P-CGE.12, P-AI.17, P-AI.15, P-DEPLOY.3, P-DEPLOY.4, P-COLLAB.4).

Gate on every PR: frontend tsc 0, server tsc 0 (when touched), vitest all-green (grew to 3991 as tests
were added), `npm run build` OK, `boot:check` PASS.

## 2026-07-01 — v3.0 session-history menu: gold-standard redesign (grouped, status-aware, deletable)

Admin feedback: the 3-line hamburger menu's history dropdown looked like "purana text" (old raw text)
rather than real SESSION history. Root cause: it was a flat list of items whose only visible field was
`title` — which IS the first user prompt, truncated (`deriveTitle()`), with no status, no grouping, no
distinction between the currently-open session and the rest. The backend already returned `status`,
`workspaceId`, `billedUsd` per conversation — none of it was rendered, so a rich per-session record looked
like a wall of truncated sentences.

**Redesign (Claude/ChatGPT-style session list), all real + wired:**
- **Date-bucketed grouping** (Today / Yesterday / Previous 7 days / Previous 30 days / Older) — pure
  `groupSessionsByDate()` + `sessionDateBucket()` in `agentV3History.ts` (empty buckets omitted).
- **Status dot per session** (`sessionStatusMeta()`): indigo pulsing = building, green = built, red =
  failed, gray = stopped — reads the `status` field the API always returned but the UI never displayed.
- **Active-session highlight** — the currently-open chat (matched by `workspaceId`) is visually marked
  "Current session" so it's never confused with a past one.
- **Real delete** — a hover ✕ per session, confirmed, calls a NEW `DELETE /api/agentv3/conversations/:id`
  route (owner-checked via the existing `conversationAccess()` gate; the store's `remove()` already
  existed and was already unit-tested — the route was the only missing wire). Deleting the open session
  starts a fresh one so the panel never shows a chat that no longer exists.
- Richer empty state ("No saved sessions yet — every build you start is saved here automatically").

All pure grouping/status logic lives in the existing testable `agentV3History.ts` module (matching the
codebase's established pure-logic-separated-from-component convention) — not inline in the 1900-line panel.

Tests: +27 (`sessionStatusMeta`, `sessionDateBucket`, `groupSessionsByDate` — every bucket boundary,
ordering, empty-bucket omission, missing-timestamp fallback). Gate: frontend tsc 0, server tsc 0, vitest
3921/3921 PASS, boot:check PASS. Manual: dev server boots and the app loads with zero runtime errors
(Playwright root-page smoke check, clean console). **Honest limitation:** NavBharatAI Pro v3.0 is
login-gated (real Firebase auth on the production project) — a full authenticated click-through of the
redesigned menu against real saved sessions could not be done in this sandboxed session; the fix rests on
tsc + the full test suite + a clean root-page load, mirroring the same E2B/live-runtime limitation already
on record for this project.

## 2026-07-01 — two root-cause fixes: "preview nahi chala" chatted instead of fixed + "memory gone after reload"

Admin reported two related symptoms from a real session: (1) typing "previw nahi chala" ("preview
didn't work") got a sympathetic CHAT reply instead of an actual check/fix, and (2) after reloading the
page, "sari memory gayab" (all memory gone) — a follow-up referencing "the app you just built" hit a
brand-new, empty workspace.

**Root cause 1 — intent misclassification.** `IntentClassifier.ts`'s SOCIAL_PATTERNS check includes a
bare `nahi`/`no` as a short standalone chit-chat acknowledgement (answering "no" to a yes/no question).
But "previw nahi chala" (3 words) ALSO contains that same bare "nahi" — as a NEGATION inside a real bug
report, not a standalone reply — and the classifier checked SOCIAL_PATTERNS before recognizing this as a
problem report, so any short "X nahi chala / X not working" complaint got answered as chit-chat, with NO
project file context, and no actual investigation ever happened.
Fix: new `PROBLEM_SIGNALS` array ("nahi chala", "kaam nahi kar raha", "not working", "doesn't work",
"is broken", …), checked BEFORE SOCIAL_PATTERNS, HIGH confidence → routes to `edit_existing` (mirrors the
existing CONTINUATION_SIGNALS design/philosophy: "erring toward edit_existing is safe — never dismiss a
real report as chit-chat"). A bare standalone "nahi"/"no" (no other words) is still correctly chat.
+6 tests.

**Root cause 2 — the fast lane never persists to ConversationStore.** Only the agentic `AgentRunner.run()`
writes to ConversationStore (via its own `persistence` option, triggered inside run()). The FAST LANE
(SimpleBuilder/OneShot — the PRIMARY, most-common path for a simple build) never calls `runner.run()`
when it succeeds, so a build that completed ENTIRELY through the fast lane left NO durable conversation
record at all. On reload, "restore the most recent build" (`GET /api/agentv3/conversations`) found
nothing for that workspace (or an older, unrelated record) — the chat/session looked wiped even though
the generated FILES were saved separately via the durable file store.
Fix: a best-effort fallback at the point the build result SETTLES — checks whether ANY conversation
record for this workspace was touched during (or after) this build's own start (`buildStartedAt`); if
not (fast-lane-only success), creates one using the same conversationId already prepared for the base
runner. Never double-writes over a richer agentic-path transcript (the "already persisted" check covers
every persistence-configured runner, not just the base one). New pure, exported, unit-tested
`needsFallbackConversationPersist()` — +4 tests.

Tests: +10 total. Gate: frontend tsc 0, server tsc 0, vitest 4012/4012 PASS, boot:check PASS.

## 2026-07-01 — v3.0 build report redesigned: root cause first, noise-filtered, with history

Admin's 6-point complaint about the build report, each confirmed against the actual code (not assumed)
before fixing:

1. **"Fokat ki cheeze aa jati, memory bahut jyada"** — confirmed: a real report had 180 entries, only
   9 (5%) were actual problems; the rest was pure operational noise (tool-call/tool-done pairs,
   minute-by-minute heartbeats, progress narration).
2. **"Bas problems/errors ka collection ho"** — no filter existed; everything was one flat list.
3. **"Root cause bhi mile"** — the data already existed (BuildOutcome classification, reviewer
   findings, captured errors) but was buried in the noise, never surfaced.
4. **"Backend zyada important hai"** — commands/LLM-I-O/errors were equal-weighted with chat narration.
5 & 6. **"Report khaali ho jaati / naye message se purani gayab"** — root-caused: the report is stored
   in exactly ONE Firestore doc per workspace (`{ merge: false }`); every new build's SETTLED report —
   even one that finished almost instantly with 2 log lines — fully overwrites the previous, richer
   report with no way back.

**Fixes shipped, all real + tested:**
- **Dedup**: `BuildDiagnostics.record()` now collapses an exact back-to-back repeat (same phase+code+
  message — e.g. many identical "▶ write_file" tool calls, or a genuinely double-emitted narration
  line) into the SAME entry with a `repeatCount`, instead of one line per occurrence.
- **`problems` field**: the report now carries a noise-free `problems` array (severity ≠ info only) —
  the "just problems" view — alongside the full `issues` timeline for anyone who wants everything.
- **`rootCause` field**: a new pure `deriveRootCause()` picks the single most important line, in
  priority order: the deterministic BuildOutcome classification → the reviewer's first [CRITICAL]
  finding → the first fully-captured error → the first real problem → an honest "nothing wrong found".
- **`renderDiagnosticsText()`** (previously built but never wired to any button) now puts ROOT CAUSE
  first, lists only `problems`, and honestly notes how many info-only entries were omitted (no silent
  caps) — wired into "Copy report" as a readable summary + full JSON, so pasting into chat is useful
  at a glance.
- **History**: new `DiagnosticsStore` subcollection (`workspace_diagnostics_v3/{workspaceId}/history/
  {startedAt}`) — every SETTLED build's report (not just the "latest" doc) is durably kept, bounded to
  the most recent 20. New "Report history" button in the v3.0 header lets the admin browse and reopen
  a past build's report (status dot + root cause + timestamp) — download/copy then apply to that build
  instead of latest; "Back to latest report" returns to today's default. Also fixed a related gap while
  in this code: the crash-handler path (`catch (err)`) never durably saved its report at all (only the
  per-instance in-memory cache) — now it does, both to "latest" and to history.

Tests: +21 (13 BuildDiagnostics — dedup, problems, deriveRootCause, renderDiagnosticsText ordering;
4 DiagnosticsStore history VITEST-skip contract; 1 fixed pre-existing assertion). Gate: frontend tsc 0,
server tsc 0, vitest 4029/4029 PASS, boot:check PASS, Playwright root-page load clean (no runtime errors).

**Separately flagged, NOT fixed in this PR** (found while reading a real v3.0 transcript the admin
shared, out of scope for "build report"): components generated in isolation but never wired into
App.tsx (root cause of the recurring "Hello World" preview); the reviewer finds real [CRITICAL] bugs
but nothing auto-repairs them; a stale-checkpoint restore silently lost 12 files' worth of recent edits;
contradictory simultaneous "no files produced" + "here's what I built" messages. Queued for a future
pass if the admin wants them tackled.

## 2026-07-01 — build report follow-up: consistency fix + text report reachable

Two more genuine gaps found while reviewing the just-shipped build-report redesign (admin asked
"kuch aur add karna hai?"):

1. **Consistency bug**: the new `problems` field was computed once from the FULL (pre-storage-trim)
   issues array and stored as-is — but `trimReportForStorage()` separately trims `issues` to the last
   500 for the Firestore byte budget. A `problems` entry referencing something OLDER than that window
   would dangle (present in `problems`, absent from the stored `issues`), and `problems` itself had no
   cap of its own, so an unusually large number of real problems could still bypass the byte-budget
   safety net. Fixed: new pure `capProblems()` (300-cap, keeps the newest) is now the SINGLE source of
   truth, used identically by `BuildDiagnostics.report()` (live) and RECOMPUTED from the trimmed issues
   inside `trimReportForStorage()` (storage) — the two can never diverge. Applied the same fix to
   `saveDiagnosticsHistory`'s over-budget safety net for parity with `saveDiagnostics`.
2. **Shelf-ware wired in**: `renderDiagnosticsText()` — a complete, already-tested, human/Claude-
   readable renderer (root cause, problems, full sandbox/LLM/preview/reviewer detail) — was reachable
   from NO button anywhere in the product. `GET /api/agentv3/diagnostics` now supports `?format=text`
   (works for the latest report, a history entry, or a specific buildId), and a new "Text report" button
   in the v3.0 header downloads it as a readable `.txt` — a genuinely comprehensive document, not just
   the smaller inline summary "Copy report" builds client-side.

Tests: +5 (2 capProblems, 2 trimReportForStorage consistency, 1 BuildDiagnostics.report() problems-cap).
Gate: frontend tsc 0, server tsc 0, vitest 4034/4034 PASS, boot:check PASS, Playwright root-page load clean.

## 2026-07-01 — two more E2B/preview root causes fixed (admin: "e2b, preview bhi fix kar do")

Continuing the investigation from the earlier real transcript (misleading "No files to preview yet"
and components never wired into App.tsx). A research agent traced both to exact file:line locations
before any fix was written.

**BUG A — files existed but were never durably saved when a build was cut short.** Durable file
persistence for the AGENTIC build path only had TWO guarantees: a fire-and-forget 3-second debounce on
every write (`onFileWrite`), and one reliable "captured writes + live scan" save at NORMAL completion.
Neither the deadline-timeout path (18-min wall-clock cap) nor the crash-catch path ever called this
reliable save — yet the deadline-timeout path's own messages CLAIMED "every file generated so far is
saved" / "your files are saved" (a fake-success violation). If the debounce hadn't fired yet (starved by
back-to-back writes, or the process reclaimed before its 3s window elapsed) and the live E2B sandbox then
became unreachable (very plausible right after a long, resource-heavy build), the in-browser preview's
`collectFilesWithSavedFallback` found NOTHING durable — hence "No files to preview yet — build something
first" even though the workspace genuinely had files.
Fix: both the deadline-timeout handler and the crash-catch handler now run the SAME reliable durable-save
(captured writes ∪ a live sandbox scan) BEFORE their "files are saved" messages — so the claim is finally
true. `writtenFiles` had to be hoisted to an outer scope (a `try{}`-scoped `const` is invisible from a
sibling `catch{}` block, and from a closure defined before that `try` even opens) to make this possible.

**BUG B — a generated component that nothing ever imports goes completely undetected.** The existing
architecture/readiness checks validate: do imports resolve (ContractMap/ArchitectureAnalysis), are cycles
absent, is layering clean, are npm deps used (DependencyAnalysis) — but NONE of them ask "was this
component ever actually imported by anything?". A file like `src/components/Hero.tsx` can be perfectly
valid, syntactically correct, and still be dead code because the entry/shell (App.tsx) was never updated
to import + render it — exactly why a real build transcript showed the agent discovering, after 3 prior
"successful" builds, that "App.tsx only renders `<h1>Hello World</h1>`" despite Hero/Features/Footer all
existing on disk.
Fix: new pure `findOrphanComponents()` in `ArchitectureAnalysis.ts` — reuses the project graph's already-
extracted symbols (no new parsing) to find every PascalCase component export whose file is imported by
NOTHING else (entry points main/index/App excluded as roots-by-design). Added to `ArchitectureReport` and
wired into `Readiness.ts` as a WARNING (not a blocker — a real defect, but not one that should force a
rebuild-from-scratch loop on a false positive). Because `assessBuildReadiness()` is the MANDATORY gate
every agentic build already runs at completion (R2 §1.1), this fires automatically on every build — no
opt-in needed.

Tests: +7 (5 findOrphanComponents/analyzeArchitecture, 1 Readiness warning-not-blocker, 1 pre-existing
fixture fix). Gate: frontend tsc 0, server tsc 0, vitest 4040/4040 PASS, boot:check PASS.

## 2026-07-01 — fixed a regression in my own earlier isLongRunningCommand fix

Admin's newest diagnostics JSON (rootCause auto-surfaced it instantly: "Budget reached ($25.83 of
$25.00). Stopped.") showed both previews still failing after the earlier pkill/ps/grep fix (#782/PR
history). Traced a NEW bug: `pkill -f "vite" 2>/dev/null; sleep 1; npm run dev 2>&1 &` — a compound
command chaining a cleanup step into a genuine dev-server restart, self-backgrounded with a trailing
`&`. The earlier fix excluded the WHOLE command from `isLongRunningCommand()` because it STARTS with
`pkill` — but that meant `ensureHostBinding`/`stripDevServerBackgrounding`/`pinDevServerPort` never ran
on the real `npm run dev` segment at the end, so its own `&` was never stripped and the dev server got
orphaned + reaped by E2B — the EXACT "Killed right after ready" bug the original fix (weeks ago) existed
to prevent, just reached via a different path (my OWN recent fix regressed it for this compound-command
shape).

Fix: `isLongRunningCommand()` now splits a command on `;`/`&&`/`||` and judges each segment
independently — a one-shot-prefixed segment's own text (even one mentioning "vite" as a pkill/grep
pattern) still never counts, but any OTHER segment that genuinely starts a dev server still does, so
the whole compound command is correctly recognized as long-running. Verified against all 23
combinations (every prior true/false case + the new regression case) before writing the test.

Also confirmed (not fixed — needs more evidence before touching): the in-browser preview's 30/req-per-
hour ANONYMOUS rate-limit cap was hit, even though the frontend does send an auth token — worth
watching whether this recurs now that the dev-server thrash (which multiplied fallback preview
requests) is fixed; not touched this pass since there's no confirmed distinct root cause yet.

Tests: +3 (the exact regression command + 2 variants). Gate: frontend tsc 0, server tsc 0,
vitest 4043/4043 PASS, boot:check PASS.

## 2026-07-01 — per-build $25 cost cap TEMPORARILY DISABLED (explicit admin decision)

Admin asked to remove the v3.0 per-build budget-limit system while build-pipeline bugs are still being
found and fixed, planning to re-enable it once things stabilize. I gave my honest pushback first (this
is exactly the WRONG time to remove a runaway-spend safety net — the cap had just correctly stopped a
build at $25.83 that was mid-genuine-fix; removing it now risks a still-undiscovered bug spending
unbounded money) and recommended raising the cap instead of removing it. Admin explicitly confirmed:
remove it completely. Proceeding on that explicit, informed decision.

**Implementation — reversible by design, not a deletion.** `maxBuildBudgetUsd()` (agentv3.ts) now
defaults to 0 (disabled) instead of 25, mirroring the existing `maxBuildSeconds()` "0 = disabled"
convention already used elsewhere in this file. `AGENTV3_MAX_BUILD_USD` still works exactly as before —
setting it to any positive number RE-ENABLES the cap with zero code change needed. The pass-through to
`AgentRunner`'s `maxBudgetUsd` (which treats `undefined` as "no cap", not `0` — `0` would instead stop a
build after its very first dollar) is handled via a new `maxBudgetUsdForRunner = budget > 0 ? budget :
undefined` conversion at the single declaration site, threaded through all 3 call sites (top-level
runner, sub-agent spawn, escalation runner).

**Left untouched (out of scope — different mechanism, no evidence it was involved):** `sessionCostCapUsd()`
($5 default) — a separate "retry-on-stronger-model-after-an-empty-build" gate; `userMonthlyCapUsd()` —
already disabled by default.

Tests: +4 (default-disabled, positive override, explicit-0-still-disabled, garbage-falls-back-to-
disabled) — exported `maxBuildBudgetUsd` to make this properly testable, matching the `maxBuildSeconds`
pattern. Gate: frontend tsc 0, server tsc 0, vitest 4047/4047 PASS, boot:check PASS.

**Follow-up owed:** re-enable via `AGENTV3_MAX_BUILD_USD` (or restore the code default) once the admin
confirms the build pipeline has stabilized — this is a standing action item, not a permanent change.

## 2026-07-01 — "compare X and Y" questions no longer trigger a full 9-minute build

Admin screenshot showed: typing "v3.0 aur claude code ko campair karo" (compare v3.0 and Claude Code —
a pure comparison QUESTION) made v3.0 start a full build ("Estimated build time: ~9 min", "Setting up
your workspace…"). Root-caused precisely: the message contains "code" (as part of "Claude Code"), which
is a BUILD_SIGNALS keyword — the classifier's generic weak-signal catch-all matched it, producing
`{ intent: 'new_build', confidence: 'low', signal: 'build-signal' }`. Low confidence should let the LLM
upgrade re-judge it with context, but the observed behavior shows it fell through to a build regardless
(LLM timeout, or the LLM itself guessed wrong under ambiguity) — either way, a comparison ask should
never depend on an LLM correctly overriding a keyword mismatch.

Fix: new deterministic `INFORMATIONAL_SIGNALS` array ("compare", "campair" — the exact Hinglish
misspelling from the report, "vs", "versus", "difference between", "kya farak hai", "tulna karo", …),
checked BEFORE the generic `BUILD_SIGNALS` catch-all (exactly what "code" matched) but AFTER the
explicit new-build/edit verbs (so "build X and compare it to Y" still correctly builds) — HIGH
confidence so the LLM upgrade can no longer be talked into a build for a genuine comparison question.
Mirrors the same design already used for CONTINUATION_SIGNALS/PROBLEM_SIGNALS earlier this session.

Tests: +5 (the exact reported message, English/Hinglish comparison variants, the HIGH-confidence/LLM-
can't-override guarantee, and the explicit-build-verb-still-wins safety check). Gate: frontend tsc 0,
server tsc 0, vitest 4071/4071 PASS, boot:check PASS.

## 2026-07-01 — rootCause now prefers a real unresolved problem over a routine auto-resolved one

Admin pasted a real build report; analysis found the `rootCause` field (from the earlier build-report
redesign) picked a ROUTINE, already-auto-resolved event — "Provider GLM failed — falling back to the
next provider" (the resilience mechanism working exactly as designed, not a failure) — ahead of a
genuine UNRESOLVED problem later in the same build (`pkill -f "vite" || true` failing with "signal:
terminated"). `deriveRootCause()`'s "first real problem" fallback tier picked strictly by chronological
order, with no regard for whether the problem was actually resolved or just a warning vs a real error.

Fix: within that fallback tier, now prefers (1) the first UNRESOLVED non-info problem (autoResolved:
false — something that happened and was never fixed) → (2) the first ERROR (even if auto-resolved) →
(3) the first WARNING (previous behavior, last resort). A routine, successfully-recovered-from event
should never outrank a genuine unresolved issue as "the root cause".

Tests: +2 (the exact real-report regression case, and error-beats-warning-when-both-resolved). Gate:
frontend tsc 0, server tsc 0, vitest 4085/4085 PASS, boot:check PASS.

**Also observed in this report, not changed (no confirmed distinct code bug, likely provider/infra
behavior):** GLM (the cheap-floor provider) delivered 12 of 13 build turns and timed out twice
mid-build (one turn took 131 seconds) — GLM reliability/latency is a provider characteristic, not
something to code-fix; and a `[health-check] port not responding — restarting…` message bled into an
unrelated later command's stdout (the same attribution artifact already understood from earlier in this
session — not a new distinct bug).

## 2026-07-01 — GLM+KIMI "friendship" chain, cheap-floor timeout cut, and default-intent flipped to chat-first

Three admin-requested changes, shipped together:

**A. GLM and KIMI are now "friends" in the cheap-build-floor chain.** Admin's exact spec: *"GLM aur
KIMI 2.7 apas me friendship jaise ho, ek se kaam na ho to dusre se karwa do! dono fail to claude, claude
nhi fail to vertex/gemini"* — chain: `{GLM 4.7 → GLM 4.6} = {KIMI 2.7 → KIMI 2.6} → Claude
(Haiku/Sonnet by complexity) → Vertex/Gemini`. Previously `AGENTV3_CHEAP_FLOOR` was mutually exclusive
(`'glm'` XOR `'kimi'`) — `cheapBuildFloorRunners()` now accepts `'glm'`, `'kimi'`, `'both'`, or `'on'`
(both), with GLM's 2-model ladder ordered first, then KIMI's, before Claude — matching the admin's
stated priority. An explicit allowlist (not "anything but off") was used deliberately so a stray/typo
config value still safely no-ops, preserving the existing "unknown value = off" safety guarantee.
Still fully OFF by default (`AGENTV3_CHEAP_FLOOR` unset/`'off'`) — zero behavior change unless the
admin explicitly opts in.

Vertex/Gemini's position in `buildTurnRunner()`'s chain was also corrected to sit AFTER the Haiku/
Sonnet backstop (true last resort), matching the admin's stated order. **`AGENTV3_BUILD_ALLOW_GEMINI`
stays opt-in** (unchanged, default off) — while implementing this I found a documented REAL historical
incident in the existing code comments: Gemini/Vertex previously hallucinated a "successful" build by
describing writing files in its tool-use loop without ever calling `write_file`, producing zero real
files, caught by the admin only via $0 Anthropic-dashboard spend on that build. Flipping this to
default-on would silently reintroduce that risk, so it was deliberately left opt-in — reversing a fix
for a real, admin-witnessed incident needs an explicit go-ahead, not a silent default flip.

**B. Cheap-floor provider timeout cut 60s → 25s.** A build report showed a single GLM turn stuck for
131 seconds before falling through — with GLM+KIMI now chained together (A above), a slow rung should
fail fast onto the next friend rather than stall the whole build.

**C. True last-resort intent default flipped from `new_build` to `chat`.** Admin's exact ask: *"build
should prefer chat when ambiguous ... isko smartly handle karna hai! aisa na ho ki build kare hi na"*
(handle it smartly — but never end up NEVER building). `classifyIntentWithConfidence()`'s and
`classifyIntent()`'s final fallback (reached only when NO keyword signal matches at all — every
specific new-build/edit/informational/continuation/problem signal already checked and missed) now
returns `chat` instead of `new_build`, confidence stays `low` so the LLM upgrade (`classifyIntentSmart`)
still gets the final say whenever it's available — this default only fires in the LLM-unavailable
fallback path. Every existing, more specific signal (explicit build verbs, edit verbs, "compare",
continuation phrases, problem reports) still wins exactly as before — this only changes what happens
when literally nothing else matched. To make sure a genuinely-ambiguous ask never gets silently dropped
as a wrong-guess chat reply, the plain-chat route in `agentv3.ts` now re-checks
`classifyIntentWithConfidence(prompt).signal === 'default'` and, when true, appends an instruction to
the chat system prompt telling the AI to answer naturally AND ask a short clarifying question ("Would
you like me to build/fix this for you?") — so the user can confirm with their next message instead of
the ask silently vanishing into a chat reply.

Tests: +3 in `IntentClassifier.test.ts` (signal-free message defaults to chat, LLM upgrade still wins
when available, every earlier specific signal still takes priority) and +3 in `agentv3.test.ts` (GLM+
KIMI "both"/"on" combined ordering, independent no-op when only one has a key, "glm"/"kimi" still pin to
exactly one provider). Gate: frontend tsc 0, server tsc 0, vitest 4091/4091 PASS, boot:check PASS.

**Not yet started (explicitly requested, tracked separately):** confirming the root cause of the
`pkill -f "vite" || true` → exit -1 "signal: terminated" mystery — currently only a working theory
(health-check background-restart cycle overlapping the next dispatched command), no confirmed fix yet.

## 2026-07-01 — CONFIRMED root cause of the `pkill "signal: terminated"` mystery + diagnostics fix

Investigated the previously-only-theorized `pkill -f "vite" || true` → exit -1, "signal: terminated"
pattern that keeps appearing in build reports. **Confirmed, not theorized this time:**

`"signal: terminated"` is the EXACT literal string Go's standard library (`os/exec` →
`os.ProcessState.String()`) produces when it reports a child process killed by SIGTERM — verified by
reproducing it directly. This string never appears anywhere in NavBharatAI's own TypeScript, and it is
NOT what Node's `child_process` produces for a signaled child (Node reports `err.signal = 'SIGTERM'` +
a `"Command failed: ..."` message, never this wording). `E2BActuator.runCommand()` calls the E2B SDK's
`sandbox.commands.run()`, which executes the command via `/bin/bash -l -c "<cmd>"` **inside the remote
E2B sandbox VM**, run by the sandbox's own daemon (`envd`, written in Go) — so this message is proof the
SIGTERM was delivered to that remote bash process by the **E2B sandbox environment itself**, not by any
NavBharatAI code, and not a client-side/Node timeout. NavBharatAI's own port-freeing logic
(`devServerHost.ts`) deliberately uses `kill -9` (SIGKILL) which Go reports as `"signal: killed"` — ruling
out our own pre-kill-port command as the direct culprit.

**Still inferred, not proven line-by-line:** exactly WHAT inside the sandbox VM issues the SIGTERM (a
session/process-group boundary event from `envd`, or a lifecycle call like `Sandbox.setTimeout` refreshing
a session). The original "health-check restart overlapping a later command" theory remains a plausible
trigger but is not proven to be the specific mechanism.

**Real-world impact: cosmetic diagnostics noise, not a functional bug.** The `pkill || true` command's own
purpose (best-effort cleanup) is unaffected either way — but the build-report pipeline was recording this
guarded command's outcome as an UNRESOLVED error, making clean builds look like they hit a real unfixed
problem (this is exactly the case the `deriveRootCause()` fix earlier today had to work around).

**Fix:** `BuildDiagnostics.recordCommand()` now detects a command explicitly shell-guarded with `|| true`
(regex `/\|\|\s*true\s*(?:;)?\s*$/` on the trimmed command) and treats ANY exit code/signal on it as
`autoResolved: true` / informational — never an unresolved `SANDBOX_CMD_FAILED`. The raw exit code and
stderr are still captured unchanged in the `commands` AI-Diagnosis-Bundle channel (nothing is hidden,
only the timeline/root-cause classification changes). The caller's own `|| true` is unambiguous intent
that this command's result should never be treated as a build problem, regardless of *how* it failed.

Tests: +2 (`|| true`-guarded command with exit -1/"signal: terminated" stays info/auto-resolved; the
same command WITHOUT the guard still correctly surfaces as an unresolved failure). Gate: frontend tsc 0,
server tsc 0, vitest 4093/4093 PASS, boot:check PASS.

## 2026-07-01 — Fix: "+ New chat" in v3.0 reverts to the old chat ~10-12s later (root-caused)

Admin report (with screenshots): inside v3.0's own session-history menu (the 3-line button INSIDE the
v3.0 panel — NOT the app's main sidebar), clicking "+ New chat" opens a fresh empty chat, but 10-12
seconds later the PREVIOUS session's full conversation (old "hi" message, "Done · 51 steps", build
cost, rating buttons) silently reappears, overwriting the new chat. Root-caused to TWO independent,
confirmed gaps in `useAgentV3Build.ts` — both had to be closed for a genuinely permanent fix:

1. **`resume()`'s replay stream has no session identity.** `/api/agentv3/attach` is keyed only by
   `userId` (not by session/workspace) and replays a build's FULL buffered event history into
   whatever `setState` calls land, with no check that the panel is still showing the session that
   attach was for. `startNewSession()` (the "+ New chat" handler) never cancelled an in-flight
   `resume()` — its `setState` calls from `pumpStream` kept landing after the reset, silently
   repopulating the old conversation.
2. **The cross-device live mirror (`subscribeLive`) is equally userId-only scoped**, and its backing
   store (`agentv3_live` Firestore doc via `LiveChannel.ts`) persists a build's tail events (up to 200)
   well after that build finishes — so a poll that (re)starts with `sinceSeq=0` (e.g. after `running`
   toggles, which happens whenever the OTHER gap above fires) can fetch and replay a PAST, unrelated
   build's events into the current chat, matching the reported ~10-12s delay (a few of its 3s poll
   ticks) far better than a one-shot stream replay would.

**Fix — a generation guard in `useAgentV3Build.ts`:** a `generationRef` counter is bumped by every
"fresh start" of state (`reset()`, `resume()`, `loadConversation()`, `stop()`). Every async apply path
(`pumpStream`'s per-event `setState`, `subscribeLive`'s per-tick `setState`) captures the generation
at call time and re-checks it before ever calling `setState` — a stale resume/mirror tick from a
generation the user has since left is silently dropped (and its poll loop self-terminates) instead of
repopulating the session the user is now looking at. `reset()` also aborts any in-flight `/attach`
stream (detach-only — does NOT call `/api/agentv3/stop`, so a build still genuinely running
server-side keeps running in the background and shows up in History once it finishes; this only stops
THIS UI from displaying its stream).

**Also fixed a related self-defeating guard** in `AgentV3Panel.tsx`'s auto-resume effect: the
"fires once per detected running build" guard (`autoResumedRef`) re-armed itself the INSTANT
`resume()` started (since `resume()` clears `serverBuildRunning` as its own first action, before the
network call even resolves) — not when the build was actually confirmed done. This meant a later
`checkRunning()` re-poll could silently re-trigger `resume()` for the SAME already-handled build. Now
gated on `!running` too, so the guard only re-arms once genuinely idle again.

No new test infra added — `useAgentV3Build.ts`/`AgentV3Panel.tsx` have no hook-testing harness in this
codebase (component tests here use `renderToStaticMarkup`, which doesn't run effects/async state), and
prior fixes to this exact hook (e.g. the 2026-06-28 stall-watchdog/resume-loop fix) shipped the same
way — verified via the full gate, not new unit tests.

Self-reviewed before push (per admin request to review code before merging). Two review passes (line-
by-line correctness + reuse/simplification/altitude) surfaced: (1) `start()`'s own inline NDJSON loop
has no generation guard — confirmed safe today because every `reset()` call site is itself gated on
`!running`, and `start()` sets `running=true` before its own loop begins, so the two can never overlap;
documented that invariant inline instead of adding an unneeded guard. (2) the repeated
`gen !== generationRef.current` check was extracted into a small named `isStale(gen)` helper (5 call
sites → 1 definition). (3) **Honest architecture note, not fixed here:** the real root cause one layer
down is that `/api/agentv3/attach` and `/api/agentv3/live` (and the `runningBuilds`/`LiveChannel` maps
backing them) are keyed only by `userId`, with no session/workspace scoping at all — this client-side
generation guard fixes the reported symptom correctly, but a second browser tab/device on the same
account could still attach to or mirror the WRONG session's build. Scoping the server-side build
registry and LiveChannel by `(userId, workspaceId)` is the deeper fix; flagged as a follow-up, not
attempted in this PR (bigger surface: `/chat`, `/attach`, `/live`, `/stop`, `/status`).

Gate: frontend tsc 0, server tsc 0, vitest 4093/4093 PASS, boot:check PASS.

## 2026-07-01 — Follow-up: "New chat" still showed an unrelated session's live build (the flagged server gap, now fixed)

The previous fix (above) closed the STALE-callback gap (a finished session's replay/mirror landing
after the user moved on) but the admin reproduced a related, DIFFERENT case: opening "+ New chat" and
sending a plain "hello" showed that fresh chat's normal reply INTERLEAVED with an unrelated, GENUINELY
STILL RUNNING 12-file build from a completely different v3.0 session under the same account — exactly
the deeper gap flagged (not theoretically) in the previous entry: `runningBuilds` (and the LiveChannel)
are keyed only by `userId`, so the auto-resume/live-mirror mechanisms had no way to tell "a build I got
disconnected from" apart from "a build that belongs to an entirely different, unrelated session that
also happens to still be running." The client generation-guard doesn't help here because this is a
NEW, current-generation resume() correctly attaching to whatever the server reports as running for the
account — it just reports the wrong build.

**Real fix this time (server + client, not just client):**
- `RunningBuild` (server) now carries `workspaceId` (the session that started it), set from the
  already-computed `intentWorkspaceId` when a build registers.
- `isBuildRunningForWorkspace(rb, workspaceId)` — a new pure, exported, unit-tested function — replaces
  the account-wide `isBuildRunning` check on every path that might auto-attach to a build it didn't
  itself start. `workspaceId: null` (not provided) falls back to the old account-wide behavior for
  back-compat; an UNKNOWN running build's ownership is never assumed to match a caller's specific ask
  (conservative deny, not permissive allow).
- `GET /api/agentv3/status` — accepts optional `?workspaceId=`, returns a new `buildRunningHere` field
  (workspace-scoped) alongside the existing `buildRunning` (unchanged, account-wide, kept for other
  callers like `AgentV3Launcher`/`ProV3Surface` that only check `enabled`).
- `POST /api/agentv3/attach` — accepts optional `workspaceId` in the body; refuses to attach (404) when
  the running build belongs to a different session.
- `GET /api/agentv3/live` (cross-device mirror) — accepts optional `workspaceId`; when THIS instance is
  the one running the build (the common, same-instance case), refuses to mirror a mismatched session's
  events. **Known remaining gap, explicitly not fixed:** the true cross-instance case (build runs on a
  DIFFERENT Cloud Run instance with no local `RunningBuild` record here) still can't be verified without
  a `LiveChannel` schema change (its Firestore ring buffer doesn't store workspaceId) — falls back to
  the old unfiltered behavior. Narrower and rarer than the case just fixed.
- Client (`useAgentV3Build.ts`): `checkRunning`/`resume`/`subscribeLive` all accept an optional
  `workspaceId` and thread it to the corresponding endpoint; `checkRunning` uses `buildRunningHere`
  (not `buildRunning`) whenever a workspaceId is supplied.
- Client (`AgentV3Panel.tsx`): a new `expectedWorkspaceId()` helper (the session's derived/adopted
  workspaceId) is now passed to every `checkRunning`/`resumeBuild`/`subscribeLive` call site (auto-check
  effect, auto-resume effect, tab-visibility recheck, cross-device mirror effect, and the manual
  "Resume" button).

Tests: +6 for `isBuildRunningForWorkspace` (no running build, ended build, workspaceId omitted →
account-wide fallback, matching workspace → true, DIFFERENT session's build → false — the exact
reported regression, and an unrecorded workspaceId never assumed to match a specific request). Gate:
frontend tsc 0, server tsc 0, vitest 4126/4126 PASS, boot:check PASS.

## 2026-07-01 — Fix: "+ New chat" / any history item silently no-op'd while a build was actively streaming

Admin reproduced yet another angle after the two fixes above: "chahe naya ho ya purana, yahi rahega" —
neither "+ New chat" nor any history item did ANYTHING, permanently, whenever the currently-open
session had an actively-streaming build. Root cause (pre-existing, not introduced today, but only
became this visible once auto-resume started correctly re-attaching to a session's own long build):
`startNewSession()` and `openConversation()` (`AgentV3Panel.tsx`) both silently `return` early when
`running` is `true` — and `loadConversation()` (the hook) had the SAME guard. Worse, the history-item
row's className applied `pointer-events-none` whenever `running`, so it was unclickable at the CSS
layer too — not just a JS no-op. A build that takes several minutes (the norm, not the exception)
meant the ENTIRE session-history menu was non-functional for that whole window.

**Fix: navigation (starting new / opening a different saved chat) is no longer gated on `running` at
all.** It now always DETACHES from whatever's currently attached instead of blocking until the current
build finishes — the underlying SERVER build (if any) is untouched and keeps running in the background,
staying resumable from History exactly as before; only the LOCAL UI stream is torn down.

This required extending the generation-guard machinery (built for the first fix above) to `start()`'s
OWN reader loop, which is unlike `pumpStream`/`subscribeLive`: `start()` had an explicit code comment
asserting it didn't need a generation guard because "every reset() call site is gated on `!running`" —
that invariant is exactly what this fix removes, so the comment's own stated condition for revisiting
applied. `start()` now captures a generation at build-start, checks it before every `setState` in its
reader loop (cancelling the reader once stale), skips the mid-stream-drop reconnect/error-surfacing
entirely once stale (an abandoned build's dropped connection is not the new session's problem), and its
`finally` only clears shared `running`/`abortRef` state if still the current generation — the exact
pattern already used in `resume()`. `loadConversation()` also now aborts the in-flight stream and clears
`running` alongside its existing generation bump, so opening a saved chat cleanly detaches too.

Gate: frontend tsc 0, server tsc 0, vitest 4126/4126 PASS, boot:check PASS. No new tests added (same
hook-testing-infra gap as the first fix above — this codebase has no harness for React
effects/async-state timing; verified via the gate, matching this file's established practice).

## 2026-07-01 — Removed the "Recent Chats" block from the main sidebar menu (admin request, urgent)

Admin: "isko hata do, koi matalb ka nahi hai" — the "Recent Chats" section that PR #799 (a parallel
session's work) added to the bottom of BOTH the desktop persistent sidebar and the mobile hamburger
drawer (`SidebarNav.tsx`) — a merged Firestore (`chat_sessions`) + prop-based list of the account's last
8 chats with Free/Pro/Doctor badges. Removed entirely per explicit, immediate admin instruction:
- Deleted `renderRecentChats()`, the `recentChats`/`cloudSessions` computation + its Firestore fetch
  effect, and `sessionKind()` (only used by the removed block) from `SidebarNav.tsx`.
- Removed both render call sites (desktop sidebar + mobile drawer).
- Removed now-unused imports (`useState`/`useEffect`, `History`/`Bot`/`Stethoscope`/`MessageSquare`
  icons, the `firebase/firestore` query helpers, `db`).
- `sessions`/`onResumeSession` props are kept on `SidebarNavProps` (unused internally now) rather than
  also touching `App.tsx`'s call site — narrower, lower-risk diff for an urgent removal; `resumeSession`
  is still used elsewhere in `App.tsx` (the full History page), so nothing is actually dead beyond this
  one component no longer reading it.

Gate: frontend tsc 0, vitest 4136/4136 PASS, boot:check PASS. (Server untouched — no server tsc re-run
needed; frontend-only change.)

## 2026-07-01 — "One body, one brain": Code Studio's AI is now v3.0, Preview reaches full parity

Admin's framing: the 5 sidebar organs (v3.0, Preview, Files, Code Studio/IDE, Git) should behave like
"organs of one body" — a change in one should show up everywhere else. Research confirmed: Files +
Code Studio's editor + Git already share ONE live state (genuinely fine); the two real gaps were (1)
Code Studio's built-in AI chat was wired to the separate "NavBharatAI Free" text-only endpoint — which
the server explicitly instructs to never generate code, and which the free tier has file/canvas context
disabled for server-side — so it could only talk ABOUT an open file, never act on one; and (2) the
sidebar's global "Preview" menu item was MISSING 3 props (`framework`, `autoResume`, `onFixError`) that
the in-panel v3.0 "Preview" tab already had, even though both render the exact same `PreviewSurface`
component — so the sidebar Preview never auto-resumed a dead sandbox and had no "Fix with AI" button.

**Fix 1 — Preview parity (small, safe):** lifted `framework` + `running` from `AgentV3Panel` up through
its existing `onPreviewState` callback (already used to lift `previewUrl`/`workspaceId`) into `App.tsx`'s
`v3Preview` state, and threaded them into `ViewPanels.tsx`'s sidebar `<PreviewSurface>` call alongside a
new `onFixError` bridge (`v3PendingFix` state in `App.tsx`, passed down as a new `pendingFix` prop through
`ProV3Surface` → `AgentV3Panel`, consumed by a new effect that prefills the chat input exactly like the
in-panel Preview's own `onFixError` handler already does). Zero new components — same `PreviewSurface`,
same feature set, from either entry point.

**Fix 2 — Code Studio's AI chat IS NavBharatAI Pro v3.0 (the bigger change):** new component
`AgentV3MiniChat.tsx` runs its own `useAgentV3Build()` instance but targets the EXACT SAME session as
the main v3.0 panel via `getAgentV3SessionId`/`getAgentV3WorkspaceId` (the same localStorage-backed id
the panel already persists) — no cross-component state store exists in this codebase, so this is a
second window onto the same server-side session/memory, not a shared React object. It reuses the
resume()/subscribeLive() cross-device-mirror machinery (built earlier today for "two viewers, one live
build") to auto-attach if a build for this exact session is already running, and loads the account's
most-recent conversation ONLY if its `workspaceId` matches this session (never guesses — an honest empty
thread beats risking the WRONG conversation, since the conversation store's own ids are random UUIDs
unrelated to sessionId, so there's no way to look up "the" conversation for a session directly). Sending
a message calls `start(text, {sessionId})` — the SAME server endpoint/session the v3.0 panel uses, so any
file it writes appears everywhere else (Files, Code Studio's own editor, Git) exactly like a v3.0-panel
edit does.

Also found (and fixed) that Code Studio's "AI" trigger button was UNREACHABLE in practice: both call
sites did `onOpenProChat?.() : handleScreenChange('ai')`, and `onOpenProChat` was ALWAYS provided by the
caller — so clicking "AI" inside Code Studio always navigated away to the full v3.0 panel, never actually
showing Code Studio's own embedded AI screen. Removed the `onOpenProChat` branch (and the now-fully-dead
prop) entirely so the button now shows the embedded, correctly-wired `AgentV3MiniChat` in place.

A code-review pass (medium effort) on this diff found one real issue: `AgentV3MiniChat` recomputed
`getAgentV3SessionId`/`getAgentV3WorkspaceId` (real localStorage I/O) on every render instead of once —
fixed by memoizing via a ref keyed on `userId`. Six other candidate findings (a loadConversation/reset
mismatch-race, a reset-vs-resume generation-guard interaction, multi-subscriber safety on `/attach`, a
`pendingFix` effect loop risk, the removed `onOpenProChat` prop's blast radius, and `autoResume`'s default
before `onPreviewState` first fires) were all investigated and refuted — the existing generation-guard/
gating logic already covers them.

Manually verified in a real browser (Playwright + the pre-installed Chromium, no test credentials
available so the signed-in flow wasn't end-to-end exercised): app boots clean, "Recent Chats" removal
confirmed gone from the sidebar, clicking Code Studio's "AI" button now shows the embedded
`AgentV3MiniChat` (correctly gated with "Sign in to chat with NavBharatAI Pro v3.0 right here in Code
Studio" for an anonymous session) instead of redirecting to login — no crashes, no new console errors.

Gate: frontend tsc 0, server tsc 0, vitest 4136/4136 PASS, boot:check PASS.

## 2026-07-01 — Hotfix: AgentV3MiniChat crashed for signed-out users (PR #814)

Found via a real-browser Playwright check while continuing follow-up work: a null-check gap in the
session-id memoization added for the earlier code-review finding above — `idsRef.current?.uid ===
userId` evaluates `undefined === undefined` = `true` when `userId` is `undefined` (anonymous), even
though `idsRef.current` itself is `null`, so the ternary took the branch reading
`idsRef.current.sessionId` on a null ref and crashed the component (caught by the ErrorBoundary) the
instant any signed-out user opened Code Studio's "AI" tab. Fixed with `idsRef.current &&
idsRef.current.uid === userId ? ... : ''`. Shipped as its own isolated, urgent hotfix commit (stashed
the in-progress Visual Editor work to keep this a clean, single-line diff) ahead of the larger feature
below. Gate: frontend tsc 0, vitest 4144/4144 PASS, boot:check PASS, verified in a real browser.

## 2026-07-01 — Visual Editor v1 (in-browser preview): real text edits land in the real source

Admin: "Visual Editor ('Edit'), Download apk — bas yeh do option add kar do. 100% real working. e2b,
aur in browser preview dono me." Researched both honestly before writing any code (see the APK
investigation below) — Visual Editor and Download APK are NOT equal-effort asks. Visual Editor for the
**in-browser preview mode** is genuinely buildable now with no new infrastructure; the **E2B live mode**
needs a real, separate infra piece (a cross-origin bridge) — scoped explicitly as a v1 (in-browser,
text-content edits only) per the admin's own confirmed sequencing choice.

**Why this is "100% real" and not a fake WYSIWYG toy:** a v3.0 project has no single "the HTML" — the
rendered preview is compiled from real multi-file .tsx/.jsx source. An edit that only mutated the
compiled preview copy would be silently overwritten by the next build. This ships a genuine
click-in-the-rendered-preview → edit-the-real-source-file pipeline:

1. **`src/server/runtime/ReactPreview.ts`** — the Babel-standalone JSX transform now sets
   `development: true` on the react preset, which attaches `_debugSource` (fileName/lineNumber/
   columnNumber) to every JSX element's fiber at runtime — the SAME mechanism React DevTools' own
   "open in editor" feature uses. A new injected inspector script (toggled on/off ONLY via an explicit
   `postMessage` from the parent — never active by default) walks a clicked DOM node's
   `__reactFiber$*` property to find this source location, makes the element `contentEditable`, and
   posts `{file, line, column, newText}` back on blur/Enter.
2. **`src/server/AgentV3/VisualEditPatcher.ts`** (new, pure, unit-tested) — `applyVisualTextEdit()`
   converts React's 1-based `_debugSource` position into ts-morph's 0-based convention, finds the
   EXACT JsxElement/JsxSelfClosingElement whose opening tag starts there via a real AST (never a
   guess), and replaces its text — but ONLY when that element has exactly ONE simple text child.
   Anything with mixed/nested children (an expression, a nested element, multiple text runs) is
   REFUSED with a clear reason rather than risking a wrong edit landing in the wrong place — an
   honest "can't do this one yet" beats silent corruption. New text is escaped via REAL JSX expression-
   container string literals (`{` → `{'{'}`) — not HTML entities, which a code-review pass found don't
   actually protect anything (JSX text isn't parsed as HTML; Babel/esbuild's tokenizer just happens to
   decode entities back today, which isn't a real guarantee against a different toolchain).
3. **`POST /api/agentv3/visual-edit`** (new route) — reads the workspace's current files, applies the
   edit, writes the result through BOTH the live actuator (best-effort) and the durable store — the
   exact same dual-write path every other v3.0 file write uses.
4. **`PreviewSurface.tsx`** — a new "Edit" toggle (in-browser mode only) sends the postMessage toggle,
   listens for the commit event, calls the new endpoint, reloads the in-browser preview from the
   freshly-saved source (confirming the edit against what actually compiled — not a hopeful guess),
   and calls a new `onFileEdited` callback so Files/Code Studio/Git pick up the change immediately too
   (wired through both the sidebar Preview and the in-panel Preview tab, reusing the existing
   `onFilesSync` bridge for the in-panel case).

A dedicated adversarial code-review pass (the single most safety-critical review this session — a
wrong AST edit silently applied to a real source file is a genuine data-corruption risk) verified,
with actual runtime execution (not just re-reading the code): the line/column convention conversion is
correct (proved against `@babel/plugin-transform-react-jsx-source`'s real source + an empirical test),
ts-morph's `getStart()` trivia-skipping matches Babel's `_debugSource` exactly, the NaN/bounds guard on
the server route works, multiple-elements-at-one-position can't actually happen for this AST shape, and
ownership checks run before any file read. It found one real (non-corrupting but misleadingly-commented)
issue — the HTML-entity escaping — fixed as described above, with a new test that round-trips the
escaped source through a FRESH ts-morph parse and confirms the reconstructed text matches the original
exactly (not just "the raw string looks escaped").

Tests: +9 for `VisualEditPatcher` (success, preserves surrounding code, refuses mixed children, refuses
self-closing/no-text, refuses non-JSX files, honest "reload and try again" on a stale/moved position,
honest out-of-range-line error, real expression-container escaping, and a full re-parse round-trip
proof) and +3 for `ReactPreview.ts` (development:true present, inspector script injected, starts
inactive). Gate: frontend tsc 0, server tsc 0, vitest 4148/4148 PASS, boot:check PASS.

**Deliberately NOT built in this slice (honest, not half-done):** styling/layout edits, multi-text-run
elements, and the E2B live-mode bridge (needs a Vite plugin injected into the project scaffold +
postMessage bridge — a real, separate infrastructure piece, tracked as explicit follow-up work, not
silently skipped).

## 2026-07-01 — Download APK: Android build-environment infra (Slice 1 of 2, admin-approved investment)

Admin, after being told honestly that "100% real working APK download" needs new infrastructure (no
JDK/Android SDK/Gradle anywhere in this codebase, no existing Android CI/build service — see the
research summary in the PR): "Infra investment shuru karo" (start the infra investment). This ships
the FIRST real, admin-actionable piece — the build ENVIRONMENT — following the exact same
"infra-first, code-wiring-second" sequencing `infra/e2b/README.md` already established for the default
builder template's own MODE A rollout, so the eventual feature is never pointed at a half-built image.

- **`infra/e2b/e2b-android.Dockerfile`** (new) — a SEPARATE, on-demand E2B template (not added to the
  default `e2b.Dockerfile`, which every ordinary build uses — bloating it would slow every build's
  cold-start for a feature most builds never touch): JDK 17, Android SDK cmdline-tools
  (platform-tools, `platforms;android-34`, `build-tools;34.0.0`), and Google's own **Bubblewrap CLI**
  — the official TWA (Trusted Web Activity) generator. A TWA is the lightest REAL path to an
  installable APK: wrap an ALREADY-HOSTED web app (a real, durable public URL — which
  `DeploymentService.ts`'s existing per-workspace Firebase Hosting deploy already provides) in a thin
  native Android shell, backed by a real Gradle build + a real signing keystore. Has its own
  build-time sanity gate (fails the IMAGE build, not a user build, if java/Android SDK/bubblewrap
  aren't actually usable).
- **`infra/e2b/build.mjs`** — parametrized via env vars (`DOCKERFILE`, `CPU_COUNT`, `MEMORY_MB`) so ONE
  script builds either template; every new var defaults to the EXISTING hardcoded values, so an
  unmodified CI invocation (as it's always been called) builds the exact same default image as before
  — zero behavior change for the current template.
- **`.github/workflows/e2b-template.yml`** — added a `template_kind` choice input (`default` |
  `android`); resolves the right Dockerfile/alias/CPU/memory for whichever is picked. Still
  manual-dispatch-only (never rebuilds/costs money on ordinary pushes).
- **`infra/e2b/README.md`** — new section documenting the Android template, its purpose, HONEST cost
  (this image is substantially larger — several GB of JDK/SDK/Gradle caches — and slower to build/use
  than the lean default template), and a verify-the-published-template checklist.

**What this does NOT do (deliberately, not half-done):** actually orchestrate a build (no code invokes
`bubblewrap`/Gradle/signs an APK yet — that is separate, larger follow-up work, gated behind a NEW,
separate `ANDROID_E2B_TEMPLATE_ID` env var, unset by default). **What still needs the admin's own
action** (cannot be done from this session — `api.e2b.dev` is egress-blocked here, matching the
existing default-template note): actually running the `template_kind: android` workflow dispatch (with
`E2B_API_KEY` configured) to build + publish this image before ANY orchestration code can be wired to
use it — a real, cost-incurring cloud build step the account owner should trigger themselves.

Gate: this PR is infrastructure/CI/documentation only (no runtime app code touched) — frontend tsc 0,
server tsc 0, vitest 4148/4148 PASS (unchanged from before this PR), `node --check` on the modified
`build.mjs`, and the modified GitHub Actions workflow YAML validated with two independent parsers.

## 2026-07-01 — The unkillable "ghost chat" finally root-caused: a permanent stale LiveChannel doc

Admin: one specific chat is stuck and REAPPEARS no matter what — "+ New chat" and opening any old chat
both fail to escape it; "claude ne 100 time try kiya woh hat nahi rahi." All the earlier fixes (#802
generation guard, #804 workspace-scoped attach/status, #806 navigate-while-running, #809/#810/#813
stuck-running fixes) closed real client/attach races — but the ghost survived them all because it lives
somewhere none of those fixes touch: **Firestore**.

**The confirmed mechanism (this was the documented "narrower, rarer follow-up gap" in #804 — it turned
out to be neither narrow nor rare):**
1. `LiveChannel.close()` only released the IN-MEMORY mirror — it **never deleted the Firestore doc**
   (`agentv3_live/{userId}`). A finished/stuck/dead build's last 200 events sat there **forever**.
2. The client's cross-device live-mirror poll (`subscribeLive`) starts every subscription at
   `sinceSeq = 0`, so each (re)subscription re-reads the ENTIRE stale ring buffer.
3. The #804 workspace filter on `/api/agentv3/live` only worked when the serving instance had the
   build in its local `runningBuilds` map. After any Cloud Run instance recycle (constant in
   production) there is no local record — so the read fell through to the Firestore doc UNFILTERED.
4. The live-mirror re-arms on mount/visibility/`running` flips — i.e. **immediately after "+ New
   chat" and after opening any old chat** — so every escape route deterministically replayed the
   ghost's 200 events into whatever session was open. From any device. Forever.

**Fix (server-side, three parts, all in `LiveChannel.ts` + the `/live` route):**
- **Events are now stamped with the `workspaceId`** of the build that produced them
  (`broadcastBuild` passes `rb.workspaceId` → stored in the channel doc). `/api/agentv3/live` refuses
  a different session's events even cross-instance — the case #804 couldn't cover.
- **Unstamped events are refused too** for a session-scoped caller (`liveEventsAllowedFor`, pure +
  unit-tested): a pre-upgrade ghost doc is EXACTLY the unstamped case, so the existing stuck doc in
  production is neutralized the moment this deploys — no manual Firestore cleanup needed. Conservative
  deny, same principle as `isBuildRunningForWorkspace`.
- **`close()` now DELETES the Firestore doc** (and discards un-flushed pending events instead of
  writing one last stale batch) — a finished build leaves NO tail for later polls to replay. This is
  the root-cause kill; the stamping above is defense-in-depth for the instance-recycled-mid-build case
  where `close()` never runs.

Tests: +8 (`liveEventsAllowedFor` all four quadrants incl. the ghost-doc conservative deny; the real
in-memory channel path: workspace stamp round-trip, close-leaves-no-tail, close-discards-pending,
cursor-past-seq returns nothing). Gate: frontend tsc 0, server tsc 0, vitest 4156/4156 PASS,
boot:check PASS.

## 2026-07-02 — v3.0 Lead-Architect program: full audit + Sec-1 (C2 importUrl host-RCE) shipped

Admin commissioned a Lead-Architect-level transformation of Pro v3.0 (audit + root-cause + redesign),
scoped to "edit only v3.0", and approved: fix security C1–C4 first, then the redesign in sequence.

Delivered a prioritized v3.0 architecture audit (P0–P3) + E2B root-cause verdict. Key verified finding:
the custom E2B template (`navbharat-builder`) is built in infra/ but NEVER wired — `E2BActuator._opts()`
passes no `template`, so every sandbox runs E2B's DEFAULT base image (this, not E2B itself, is the core
"E2B unreliable" cause). Verdict: keep E2B, wire the template + add a prod sandbox guard + make the
in-browser renderer the deterministic default preview; evaluate alternatives only if it stays bad after.

**Sec-1 (this commit) — C2: host command-injection + SSRF via `importUrl`.** Root cause: user `importUrl`
was interpolated raw into `git clone "${url}"` / `git push "${url}"` shell strings run by the actuator —
the HOST process when `E2B_API_KEY` is unset (LocalActuator fallback). A quote-breakout payload
(`…/r"; curl 169.254.169.254 | sh; echo "`) = host RCE + cloud-metadata read; a `file://`/internal-IP URL
= SSRF. Fix: new pure `sanitizeRepoUrl()` in `GitRepoSync.ts` PARSES the URL and REBUILDS it from
validated components — only `https://[token@|x-access-token:token@]github.com/owner/repo[.git]` survives;
the rebuilt string contains only `[A-Za-z0-9_.:@/-]`, none of which can escape a double-quoted shell arg.
Applied at BOTH sinks (clone + push) and again at the route (clear message + never splices a token into a
bad URL). The CommandRunner port is string-command-only across all three actuators, so validate-and-rebuild
at the sink is the complete fix for this interface (argv-spawn noted as a deeper future option).

Self-review caught (and fixed pre-gate) that the first draft wrongly rejected the legit GitHub-App
`x-access-token:TOKEN@` auth form — which would have broken push. Tests: +9 (injection payload, SSRF/
non-github/scheme/look-alike-host/port/ssh, path-segment count, both legit token forms round-trip, and the
sink refusing an unsafe URL before any shell call). Gate: frontend tsc 0, server tsc 0, vitest 4165/4165
PASS, boot:check PASS.

Queued next (approved order, v3.0-scoped): C3 (preview-iframe origin isolation) → C1 (verified identity
across the build path = architecture item A1) → Phase 3 redesign (A3 wire E2B template → A2 prod guard →
A4/A6 unified preview + build state machine → A8 resumable manifest generation → export verification).
Out-of-v3.0-scope, flagged for separate go-ahead: C4/payments, sync.ts, wallet.ts, team-RBAC.

## 2026-07-02 — Sec-2 (A2): production sandbox guard on the v3.0 build route (defense-in-depth for C2)

Follow-on to C2. `buildActuator()` (agentv3.ts) falls back E2B → Docker → LocalActuator with NO prod
guard — unlike engineer.ts, which 503s in production without a real sandbox. LocalActuator runs the
agent's generated + imported commands in the HOST process, which is exactly what made C2's importUrl
injection reach the host. New pure `buildSandboxUnavailableInProd(env)` (exported, unit-tested) gates
this; the /chat build path calls it AFTER the plain-chat early-exit (chat needs no sandbox, so it's
unaffected) and, because the NDJSON headers are already flushed, emits a terminal error+result event
and cleans up activeBuilds instead of res.status(). Non-prod (dev/CI/VITEST) still uses LocalActuator by
design. +4 tests. Gate: frontend tsc 0, server tsc 0, vitest 4169/4169 PASS, boot:check PASS.

NOTE: this + C2 currently ride on the same branch as PR #816 (ghost-chat) because the GitHub connector
disconnected mid-session and #816 could not be merged first — so ghost-chat + C2 + A2 will ship together
in one green merge once GitHub is re-authorized. C3 (preview-iframe origin isolation) is INFRA-GATED
(needs a dedicated preview subdomain, like the APK template) — flagged, not half-fixed. C1 (verified
identity) remains the next code workstream.

## 2026-07-02 — Sec-3 (C1 / architecture A1): verified identity on the v3.0 build path

The #1 audit finding. `/api/agentv3/chat` derived identity from `req.body.userId` — and the build call
was the ONE v3.0 client call that never sent the Firebase token — so a spoofed userId gave cross-user
workspace access, monthly-cap bypass, and spend on NavBharatAI's own model budget under any account.

Coordinated client+server fix (admin-approved transition: reject token-less-with-claim & ask refresh):
- Server: new pure `resolveBuildIdentity(verifiedUid, claimedUid)` (exported, unit-tested) — identity
  is the VERIFIED token uid only; a claim with no token → 401 `reauth` ("refresh & sign in"); a
  token/claim mismatch → 401 `mismatch`; genuine anonymous (no token + no claim) → userId=null (shared
  anon path preserved). Runs before flushHeaders() so rejects are clean HTTP 401s. New
  `verifyFirebaseIdentity(req)` returns the verified uid AND email so `isAgentV3Enabled`'s allowlist
  can't be spoofed via a client `email` field either.
- Client: `useAgentV3Build.start()` now sends `authJsonHeaders()` (Bearer token) like every other v3.0
  call. Transient self-healing behavior for a stale cached client: one refresh loads the token-sending
  bundle; the user's workspace is untouched (no data loss).

+4 tests. Gate: frontend tsc 0, server tsc 0, vitest 4173/4173 PASS, boot:check PASS.

Fast-follow (separate PR, same principle): apply verified-identity to the remaining v3.0 read/mutate
routes (/conversations read+delete, /attach, /status, /live) — those client calls already send the
token, so it's lower-risk. Then Phase-3 redesign resumes (A3 wire E2B template → unified preview + build
state machine → resumable manifest generation → export verification). C3 (preview-iframe isolation)
remains infra-gated (dedicated preview subdomain).

## 2026-07-02 — Sec-3b (C1 fast-follow): verified identity on the conversation read/delete routes

Closes the last named read-IDOR from the audit. `/api/agentv3/conversations` (list), `.../:id` (get)
and DELETE `.../:id` derived the caller from `req.query.userId` — spoofable, so one account could list,
read (full transcripts + generated code) or delete another account's builds by claiming their (non-
secret) uid. New shared `resolveReadIdentity(req)` returns uid+email from the VERIFIED token (VITEST
falls back to request params so existing route tests still exercise the ownership logic); the three
routes now use it, so `conversationAccess`/`listByUser` compare against the real uid. The client already
sends the Bearer token on all three calls (authJsonHeaders) → non-breaking. Gate: frontend tsc 0, server
tsc 0, vitest 4173/4173 PASS, boot:check PASS.

Remaining C1-family (separate follow-up): /attach (resume) still keys off body.userId and its client
call is token-less — needs the same coordinated client+server change /chat got. /status and /live were
already workspace-scoped in #804/#816. With this, the v3.0-scoped security criticals (C1, C2, A2) +
the conversation IDOR are all closed; C3 (preview-iframe) stays infra-gated. Next: Phase-3 redesign,
starting with A3 (wire the custom E2B template — biggest reliability win, code can land gated behind
E2B_TEMPLATE_ID so it's a safe no-op until the admin publishes + sets the env var).

## 2026-07-02 — Phase 3 A3: wire the custom E2B template (E2B reliability — the #1 root cause)

Audit Phase-2 verdict was that E2B isn't unsuitable — it was failing because every sandbox launched
from E2B's DEFAULT base image: `E2BActuator._opts()` passed only `{timeoutMs, apiKey}`, never a
`template`, so the committed `navbharat-builder` image (pinned modern Node, infra/e2b/) was dead code.
Wrong runtime = the core "v3.0 builds feel unreliable" cause.

Fix: new pure exported `resolveE2bTemplate(env)` — returns `E2B_TEMPLATE_ID` (trimmed) or undefined.
`_opts()` now includes `template` ONLY when it's set, so `Sandbox.create(this._opts())` launches the
pinned image when configured and is an EXACT no-op (default base) when unset. e2b SDK v2.30's
`SandboxOpts.template?` makes this a one-field addition; `Sandbox.connect` ignores `template` (reattach
by id), so sharing _opts across create+connect is harmless. +3 tests. Gate: frontend tsc 0, server tsc
0, vitest 4176/4176 PASS, boot:check PASS.

ADMIN ACTION to activate (code is ready + safe until then): run the "Build E2B Builder Template" GitHub
Action (template_kind: default) to publish `navbharat-builder`, then set Cloud Run env
`E2B_TEMPLATE_ID=navbharat-builder`. Until then this changes nothing. A follow-on can then make
ScaffoldGuard template-aware (enable MODE A `npm create vite` on the modern image) — deferred, optional.

Next in the redesign order: unified preview + build state machine (A4/A6) → resumable manifest
generation (A8) → export verification.

## 2026-07-02 — Phase 3 A4: unified preview — in-browser is the deterministic default

Audit A4: the preview had two engines (live E2B iframe vs in-browser Babel-standalone srcDoc) with no
unified contract. `PreviewSurface` defaulted to `url ? 'live' : 'inbrowser'` AND force-switched to live
whenever a URL arrived — but the live URL is EPHEMERAL (dies on E2B idle-pause / recycle), so the
preview frequently landed on a dead "No live preview yet" empty state. Structural flakiness.

Fix (UI-layer, low-risk — both engines already exist): in-browser is now the DETERMINISTIC DEFAULT
(always renders the current files instantly, no server), and "Live server" (full-fidelity, real
runtime) is an explicit opt-in toggle. Removed the forced auto-switch-to-live effect; the Live button
now shows a ● when a live URL is available so full-fidelity stays discoverable. Switcher reordered
(In-browser first). Diagnose / live-empty-state / visual-editor paths unchanged. Gate: frontend tsc 0,
server tsc 0, vitest 4176/4176 PASS, boot:check PASS.

Behavior change to note: when a build produces a live URL, the view no longer auto-jumps to it — the
user stays on the reliable in-browser render and can toggle to Live server. Deliberate per the approved
A4 design (deterministic > flaky). Next redesign steps (A6 build state machine, A8 resumable manifest)
remain deferred pending admin appetite — they're large hot-path rewrites.

## 2026-07-02 — Security (out-of-v3.0 scope, admin-approved): C4 — pay ₹1, mint unlimited tokens

Admin lifted the v3.0-only boundary to fix the live payment/wallet money holes; started with the
marquee one. CRITICAL: the vishwakarma credit path minted `client tokenAmount × 100` tokens — a field
never bound to the amount paid — so `{amount:1, tokenAmount:1_000_000}` paid ₹1 and credited 100M
tokens. (The standard recharge path was already safe: it credits `balanceAdded × 100`, and balanceAdded
= the paid amount reconciled against Cashfree.)

Fix (server-only, no client change): new pure `creditableVishwakarmaTokens(amountPaid, buyPass)` derives
tokens from the VERIFIED paid amount — `(paid − passPrice) × TOKENS_PER_RUPEE` — reversing the client's
own `amount = tokenAmount₹ + (buyPass?pass:0)` formula. `payments.ts` credit now calls it instead of
`txData.tokenAmount × 100`. Never negative; 0 on non-positive/non-numeric. Pass price (₹100) + rate
(100 tokens/₹) are server constants that must track the client's createVishwakarmaOrder.

+5 tests (the ₹1 exploit now credits only 100 tokens; full-amount; pass-subtraction; pass-only=0;
negative/garbage guards; rounding). Gate: frontend tsc 0, server tsc 0, vitest 4181/4181 PASS, boot PASS.

Remaining payment/wallet criticals (next slices): unauth /api/wallet/:userId + /api/sync/:userId IDOR
(needs coordinated client-token + server auth, like C1); payment verify/coupon atomicity+auth (H1);
simulator gating (NODE_ENV). Then back to v3.0 redesign (A6/A8) pending appetite.

## 2026-07-02 — Security (payment/wallet closeout, cont.): unauth IDOR on /api/wallet + /api/sync

Both route groups took identity from the :userId PATH param with NO auth: `GET /api/sync/:userId` and
`POST /api/sync/:userId` let anyone read or OVERWRITE any account's entire workspace (chat sessions +
last generated app) by uid; `GET /api/wallet/:userId` (+/logs,/transactions) leaked balance, email/name
PII, usage logs and payment history. uids aren't secret.

Coordinated client+server fix (like C1): server adds `requireUserMatch('userId')` (verifies the Firebase
token uid === path uid; 401/403 otherwise; VITEST-skipped). Client (App.tsx) now sends the Bearer token
on all five calls via a new `authedHeaders()` helper (sync GET/POST, wallet GET/logs/transactions) —
these previously sent no token. Best-effort callers (sync is fire-and-forget; wallet in try/catch)
degrade gracefully if the token is briefly unavailable. Gate: frontend tsc 0, server tsc 0, vitest
4181/4181 PASS, boot:check PASS.

Remaining payment slices: verify/coupon atomicity + auth (H1 — double-credit race, unauth coupon),
simulator NODE_ENV→PAYMENTS_LIVE gating. Then team-RBAC, then back to v3.0 redesign (A6/A8) pending appetite.

## 2026-07-02 — Security (payment/wallet closeout, cont.): H1 — verify double-credit race + unauth coupon

Two real money holes closed together (admin: "Dono karo").

1) **verify-payment TOCTOU double-credit.** `verifyPaymentInternal` read `paymentStatus` with `getDoc`,
   then later `updateDoc(SUCCESS)` and credited the wallet — a race window where N concurrent
   `/verify-payment` calls on ONE genuinely-paid order could each pass the stale-PENDING check and each
   credit the wallet (double/triple-spend). Fix: claim the PENDING→SUCCESS flip inside a Firestore
   `runTransaction` — the transaction re-reads inside the tx and only the ONE caller that wins the flip
   proceeds to credit; losers observe SUCCESS and return `alreadyProcessed`. The credit block now runs
   exactly once per order with no further locking needed.

2) **redeem-coupon unauthenticated / body-spoofable identity.** The route trusted `req.body.userId`, so
   anyone could mint real spendable balance onto (or as) any account with an unauthenticated POST. Fix:
   identity now comes from the VERIFIED Firebase token (`verifyFirebaseToken(req)`); a missing/invalid
   token → 401. Redemption itself made atomic via `runTransaction` (create-if-not-exists on the
   redemption doc) so a coupon can't be double-redeemed under concurrency. Client (App.tsx) sends the
   Bearer token on the coupon call via `authedHeaders()`. VITEST accepts a body userId (route not
   token-authed in tests).

Test updated: redeem-coupon "userId missing" now asserts 401 ("sign in again") — the correct
unauthenticated response, fired before the coupon-code check. Gate: frontend tsc 0, server tsc 0,
vitest 4181/4181 PASS, boot:check PASS.

Remaining payment slice: simulator NODE_ENV→explicit PAYMENTS_LIVE gating. Then team-RBAC (H2:
getUserRole defaults everyone to 'owner'), then back to v3.0 redesign (A6/A8) pending appetite.

## 2026-07-02 — Simulator gating (payment slice): verified already-closed in prod, no change needed

Audited the "simulator mints free balance" slice before touching it. The credit-minting path
(`verifyPaymentInternal`) already refuses simulator credit when `NODE_ENV === 'production'`, and the
live Cloud Run deploy DOES set `NODE_ENV=production` (cloudbuild.yaml `--update-env-vars NODE_ENV=
production`; also package.json gcloud:deploy). So the money hole is effectively closed in production.
Fail-closing it further (require an explicit ALLOW_PAYMENT_SIMULATOR opt-in) would break local dev
payment preview for only defense-in-depth value — deferred rather than shipped as a disruptive change
without clear benefit. Redundant-work check (safeguard #6): no code change made here.

## 2026-07-02 — Security (audit H2): cross-tenant team-management IDOR / privilege escalation

Real, live hole. All five team-management routes were gated by `requireRole('owner','admin')`, which
checks only the caller's GLOBAL role — and `getUserRole` defaults role-less single-user accounts to
'owner' (documented backward-compat so a solo user isn't locked out of their OWN account). Net effect:
essentially ANY authenticated account could manage ANOTHER tenant's team just by passing that team's id
— list a team's member emails/PII (`GET /api/team/:teamId/members`), remove members, change/escalate
member roles, or self-invite into someone else's team. `teamId` is the owner's uid (not secret).

Fix (mirrors the wallet/sync IDOR pattern, admin-approved resource-scoped auth): new pure
`canManageTeam({requesterUid, teamId, members})` in TeamStore — owner (uid === teamId) always, else an
ACTIVE member whose role is admin/owner. New `requireTeamManager(resolveTeamId)` middleware in team.ts
replaces the global `requireRole` on all five routes; it verifies the Firebase token, resolves the
route's teamId (param / body.userId / body.teamId / invite-token→teamId for revoke), and allows only the
team owner or an active admin member. Fail-closed (membership-lookup error → denied); VITEST-skipped.
The global `getUserRole` 'owner' default is intentionally LEFT unchanged — it's correct for one's own
account and no longer grants cross-tenant control now that team actions are resource-scoped. No route
became more permissive (the check is strictly tighter than before).

+6 pure tests for canManageTeam (owner-always, active-admin, editor/viewer denied, removed-admin denied,
stranger denied = the core fix, null/empty fail-closed). Gate: frontend tsc 0, server tsc 0, vitest
4187/4187 PASS, boot:check PASS.

Remaining: back to v3.0 redesign (A6 build state machine, A8 resumable manifest) — large hot-path
rewrites, pending fresh admin appetite.

## 2026-07-02 — Security (IDOR sweep): close unauth /api/user/usage/:userId

Swept all user-scoped routes for the wallet/sync IDOR pattern. Found ONE remaining gap: `GET
/api/user/usage/:userId` (build.ts, Phase 4.2 monthly-AI-cost summary for the Billing panel) had NO
auth middleware — any uid could read another user's build count and AI spend (USD). Every other
user-scoped route (secrets, techdebt, sync, wallet, webhooks) already had requireUserMatch/
requireWorkspaceAccess; admin routes use verifyAdminToken. This was the lone hole.

Fix (same pattern): add `requireUserMatch('userId')` to the route (server); client sends the Bearer
token via `authedHeaders()` on the fetch (was previously token-less). Best-effort caller (wrapped in
try/catch, "never blocks wallet") degrades gracefully if the token is briefly unavailable. VITEST-skips
the check. Gate: frontend tsc 0, server tsc 0, vitest 4187/4187 PASS, boot:check PASS.

Remaining: back to v3.0 redesign (A6/A8) — large hot-path rewrites, pending fresh admin appetite.

## 2026-07-02 — HOTFIX (live break): v3.0 chat blocked by "session token was not received"

Admin reported v3.0 chat dead: typing anything returned "Your session token was not received. Please
refresh the page and sign in again to continue." (History 0 / Files 0 alongside it — all three symptoms
= no verifiable Firebase token reaching the server for that session: synthetic/local admin, auth-state
race, or transient verify failure). ROOT CAUSE: C1 (#818) made `/api/agentv3/chat` HARD-REJECT whenever
a userId was claimed but no token verified. The original "reject & ask refresh" rule (admin-approved)
assumed a refresh always restores the token; in practice it does not, so the app was fully broken with
no self-heal — violating the one absolute rule (app must never break).

Fix (admin-approved 2026-07-02, "graceful degrade + token self-heal"): `resolveBuildIdentity` no longer
rejects a claim-without-token — it DEGRADES to anonymous (`userId=null`). The claim is still never
trusted (C1's anti-spoof property holds: a claim alone grants no identity, so no cross-user access), but
the chat is never hard-blocked; a token-less caller just runs in the shared-anon workspace. The genuine
spoof case (verified token uid ≠ claimed uid) still rejects with `mismatch`. Client also force-refreshes
its ID token on the /chat submit (`getIdToken(true)`) so a stale/expired cached token self-heals instead
of arriving unverifiable. Test updated (claim+no-token now asserts anonymous, not reauth).

Gate: frontend tsc 0, server tsc 0, vitest 4187/4187 PASS, boot:check PASS.

## 2026-07-02 — Fix (admin-reported, all AIs): photos/documents returned "unable to read files"

Admin: sending photos/documents to ANY AI (Free chat, Pro v3.0, Professionals) returned "unable to
read files". ROOT CAUSE (found via full attachment-flow audit of every surface): all four vision call
paths hardcoded 2024-era model ids that the providers have since RETIRED — `claude-3-5-sonnet-20241022`,
`grok-2-vision-1212`, `gemini-2.0-flash(-001)`, `gemini-1.5-*`. Every image/PDF read 404'd at the
provider, every chain fell through ALL providers, and each surface returned its honest "could not read"
message — while plain text kept working (text paths lead with current ids).

Fixes shipped together:
1. NEW `src/server/lib/visionModels.ts` — single source of truth for vision model ids (env-overridable:
   VISION_CLAUDE_MODEL / VISION_CLAUDE_ANSWER_MODEL / VISION_GROK_MODELS / VISION_GEMINI_MODELS /
   VISION_VERTEX_MODELS). Current defaults: claude-haiku-4-5 (describe) / claude-sonnet-4-6 (answers),
   grok-4, gemini-2.5-flash → 2.5-pro. Wired into visionChain.ts (Free/Pro chat), visionDescribe.ts
   (v3.0), sda.ts (Doctor AI), pro.ts (Pro chat/plan), GrokProvider (Engineer AI images),
   AnthropicProvider default, aiCalls.callClaude. Retired Gemini ladder tails in AIRouterManager +
   AppEngine replaced with current ids (they were dead 404 slots adding latency).
2. AnthropicProvider images: media_type was hardcoded image/png → every JPEG/WebP was rejected by
   the API. Now uses the data-URL MIME or sniffs the base64 magic bytes.
3. Config-driven Professionals (Teacher/Lawyer/CA/Mentor/…) had NO file path AT ALL (client had no
   picker; server dropped everything except message). Added end-to-end: paperclip + paste in
   ProfessionalChat.tsx (≤4 files, ≤10MB, images downscaled) → `attachments` in POST → server extracts
   documents (shared extractor) + describes images/PDFs (vision chain) → honest "could not read" note
   when nothing is extractable. AppKnowledgeBase professionals entry updated (per CLAUDE.md rule).
4. Pro chat office files: raw utf-8 decode produced garbage for .docx/.xlsx/.pptx/.zip → now uses the
   shared buildDocumentContext extractor.
5. Free chat file picker accept= widened to the formats the server already reads (.docx/.xlsx/.pptx/.md
   /code files were previously unpickable).

+4 unit tests (visionModels: defaults-are-current guard, env overrides, empty-override fallback).
Gate: frontend tsc 0, server tsc 0, vitest 4191/4191 PASS, boot:check PASS.

## 2026-07-03 — History rebuild (#862) + Eternal Sessions (#867) — MERGED, auto-deployed

**PR #862 — single-source-of-truth history rebuild** (admin order: "history system pura delete
kar ke wapas banao… ek dam Claude jaise"). Root cause of the recurring "old chat opens empty /
sticky chat" corruption: THREE overlapping stores (server ConversationStore + client-written
chat_sessions transcript copies + in-memory stash) with multiple writers and id schemes. Now:
- Server ConversationStore is the ONLY transcript writer. Plain-chat turns persist server-side
  (upsert on the stable per-session id — same record builds append to → one session = one thread).
- chat_sessions rows are METADATA-ONLY (title/tags/lastUpdated); the `messages` field is never
  written by any client path again — the eraser bug class is structurally gone. Frozen legacy
  transcripts remain readable (read-only fallback + tested disjoint-prepend merge for sessions
  continued across the cutover).
- DELETE resolves candidate ids (v3_/uid/anon) — ghost rows actually delete, from both surfaces.
- App.tsx generic NBI/Pro chat_sessions writers hard-skip v3_ docs; main-History delete also
  removes the server record.
- Honest limit: transcripts already destroyed by the pre-fix eraser cannot be recovered.

**PR #867 — Eternal Sessions** (admin order: "chahe 10 saal baad chat kholo — wahi memory, wahi
UX, jaisa Claude Code me"). A 5-agent audit workflow mapped everything a reopened session LOST
vs live (verified adversarially): all Claude-style action rows, diffs, terminal, ₹/token/health
footer, framework (silently reset to vite-react → mislabeled follow-up builds), plus a silent
durability bug (one oversized turn permanently stalled transcript persistence). Shipped:
- NEW SessionTimeline.ts: bounded timeline recorder (tool calls/results, files, diffs, preview +
  billing/tokens/health), transcript compaction (base64 screenshots stripped, whole-file payloads
  truncated), and durable episodic recall for the plain-chat prompt (AI answers "hum kya bana
  rahe the?" from real history).
- Stores: timeline chunk subcollection (40-chunk cross-turn cap), finalState/framework fields,
  per-message CREATION timestamps (live interleave order preserved on reopen), get() timeline
  opt-in (hot paths skip the reads).
- AgentRunner: compaction on every persist + marker-gated poison-skip (transient outages
  self-heal; unwritable turns skipped with an honest omission marker — final status always lands).
- Route: emit-tap recorder; delta-cursored persist from BOTH the finally and the hard-deadline
  finalizer. Client: full timeline replay through the existing reducer + orphan tool_call closure
  (no immortal spinner) + engine-nudge bubbles filtered + framework adoption on open/resume.
- Built → adversarially reviewed by a 16-agent workflow → all 6 confirmed defects fixed pre-merge.
- Honest limit: pre-#867 sessions have no recorded timeline (they reopen as before, files/plan/
  checkpoints intact); the full evidence layer applies from this deploy onward. First-turn
  plan-rejection still persists no record (pre-existing, deliberate).

Gate both PRs: tsc (app+server) 0 errors, vitest 4356/4356 → 4375/4375, build + boot:check PASS.

## 2026-07-03/04 — History durability root cause + reattach + preview UX + app-import pipeline (all MERGED)

- **#870** — provably-dead pre-rebuild sessions are labeled honestly in the history list
  ("Transcript lost (old bug) — files safe") instead of looking like chats that "won't open".
- **#873 — THE week-long history mystery solved.** All server stores share ONE Firestore
  instance; settings() may only be called once on it. FirestoreConversationStore's constructor
  threw on the second call and getConversationStore() silently fell back to the IN-MEMORY store
  for the life of that Cloud Run instance → transcripts lived in RAM only ("works while the tab
  is open, gone after a reload"). 2-line guard + regression test (mocked firebase-admin); same
  landmine fixed in FirestoreJobStore. This unblocked the durability of #862/#867 in prod —
  admin confirmed history now survives reload/browser restart.
- **#882** — reopening a session whose build is still running re-attaches the live stream
  automatically; the 409 "build already running" is no longer a dead end (auto-reattach with an
  honest in-thread notice, or exact guidance when the build belongs to another chat).
- **#883** — preview speed + honesty: live-sandbox file reads bounded to 2.5s with durable
  fallback (cold-open in-browser preview ~10-30s → ~1-3s), per-instance render cache keyed by
  content hash, streamed stage-based Diagnose progress (real %, seconds heartbeat, never
  time-faked), elapsed counters + slow-notes, live-iframe onLoad strip.
- **#886 — Project Landing Pipeline phase 1 (admin master plan).** A .zip attached in v3.0 chat
  used to be read as a DOCUMENT (text into context, never unpacked) → Files/IDE/Preview all
  empty. New ProjectImport.ts (zip-slip guard, root-strip, honest skip counts, secrets NEVER
  imported, framework detection to FrameworkPicker ids; 16 tests) + chat-route landing: dual
  write (E2B + durable), files_restored, framework lock, edit-mode force, memory index,
  background preview boot with honest outcome, survey-not-scaffold context.
- **#890 — phases 2/3.** GitHub repo import (composer "GitHub / URL") now lands through the SAME
  shared landImportedProject pipeline (it used to clone into the sandbox and stop — no durable
  persist/framework/preview). Chat early-exit guard covers import turns. AppKnowledgeBase
  entries added for both import doors (agentv3_zip_import, agentv3_github_import).

Gate on every PR: tsc (app+server) 0 errors, vitest green (4385→4439 tests), build + boot:check
PASS, CI green before merge.

## 2026-07-03 — Deep build-engine rebuild (admin-directed, from the uploaded build diagnostics)

Admin uploaded a real Notes-app build report (28.7 min, ok:false "Step limit reached", 6 tool errors)
and directed: "upar upar se bas error fix nahi — jad se theek/rebuild karo". Four ground-truth
investigations mapped the exact code paths. Shipping as verified slices:

**Slice 1 (#892, merged): doubled workspace path.** All four actuator safeRelPath copies only dropped
""/"."/".." segments, so an ABSOLUTE in-workspace path from a (sub-)agent kept the root as literal
segments and `${WORKSPACE_ROOT}/${...}` DOUBLED it → every read/write/edit for that file failed. New
shared pure `toWorkspaceRelPath` (src/server/lib/workspacePath.ts, boundary-guarded root-strip,
traversal-safe, +7 tests); all four actuators delegate to it — the 4-way copy drift is gone.

**Slice 2: evidence-based build verdict + sub-agent terminal-event isolation.**
- AgentRunner's step-limit exit was an unconditional ok:false — a build whose files were written (and
  whose npm build/tsc passed) was reported as FAILED just because the model polished until the cap.
  Now the cap verdict is judged by EVIDENCE (same policy as the wall-clock watchdog): artifacts
  written → ok:true ("files saved, send another message to continue"), and when the readiness gate is
  ON the claim must still be EARNED (ready → ok:true + health card; not-ready → honest ok:false).
- The "(40) vs (80)" mystery: a delegated specialist (cap 40) shares the build's event stream, and its
  own terminal done/error flowed to every surface as if the WHOLE build finished — the client reducer
  set done:true and overwrote the top-level summary mid-build. SubAgent now translates specialist
  terminal events into a new non-terminal `agent_done` (agent-attributed); the reducer updates only
  that agent's card/activity. +6 tests (4 verdict, 2 isolation).

Next slices (same rebuild): self-healing preview + loop-breaker; shared verification ledger
(sub-agent redundancy).

## 2026-07-03 — Deep rebuild slice 3: self-healing preview + hard loop-breaker

The diagnostics' single biggest time sink (~10 min + the step cap): the model ran `npm run dev` as a
plain foreground bash (returns in ~2s, process dies), then looped update_preview × 14 + curl/ps/pgrep
until the cap. Two root fixes in `update_preview` (ToolDispatcher):
1. SELF-HEAL — preview no longer depends on the model having started the dev server correctly. Port
   down + node project → the tool itself launches the dev server through the actuator's managed
   long-running path (backgrounded, deps check, port pin, recovery), then re-polls. Bounded (240s cap).
2. LOOP-BREAKER — cross-call state on the dispatcher: first definitive failure allows ONE more bounded
   retry; the second sets gave-up; every later call short-circuits instantly with a FINAL "stop
   retrying, finish the build, tell the user honestly" instruction. No more step-cap burn on an
   unreachable preview. "Preview is EARNED" unchanged (no URL published on a dead port).
+3 tests (self-heal round-trip, 2-strike loop-breaker + instant FINAL, static-project skip).
Gate: tsc 0/0, vitest 4469/4469 PASS, boot PASS.

## 2026-07-03 — Deep rebuild slice 4: shared verification ledger (no redundant install/tsc)

The diagnostics' second time sink: 3 delegated specialists = 941s (55% of the build), each starting
blind — re-checking the workspace and re-running `npm install` + `npx tsc --noEmit` because nothing
told them the work was already done. Fix: a verification ledger on WorkspaceMemory (per workspace) —
the dispatcher's bash case records successful installs (`npm install|ci`, pnpm/yarn) and clean
typechecks (`tsc --noEmit`, exit 0); any file write invalidates "tsc clean" (strict — same-ms write
counts), touching package.json invalidates "deps installed". SubAgent injects `verificationStatus()`
into every specialist's instruction ("ALREADY INSTALLED — do NOT re-run…"), so the team shares one
verified state. Conservative-by-design: a stale claim can only cause one redundant run, never a
skipped needed check. +7 tests. Gate: tsc 0/0, vitest 4476/4476 PASS, boot PASS.

## NEXT PHASE (admin-ordered, 2026-07-04): BIG-APP IMPORT — "10GB-ready" tiered plan (NOT built yet)

Admin: Replit/Bolt users will bring apps 20x bigger; be ready up to 10GB. Expert framing agreed in
session: a 10GB export is ~99% node_modules/.git/builds/media — the pipeline already excludes those;
only SOURCE must travel. So "10GB-ready" = extract source from a 10GB package WITHOUT uploading 10GB.

TIER 1 (live today): chat-attach zip ≤15MB (base64) + GitHub import (#886/#890/#894/#897).
  **GitHub is the RECOMMENDED big-app door**: Replit AND Bolt both one-click-push to GitHub; our
  server-side `git clone --depth 1` never ships an archive at all — size of the export is irrelevant.
  Surface this guidance in the UI when a too-big zip is picked.

TIER 2 (build next): CLIENT-SIDE STREAMING PRE-FILTER for big zips. Use fflate's streaming unzip in
the browser to read a multi-GB zip WITHOUT loading it into RAM, apply the SAME skip rules as
ProjectImport (node_modules/.git/builds/secrets/binaries/900KB/2000 files), and send ONLY the
resulting compact source map to the existing landing flow (a new /api/agentv3/import-land endpoint
that wraps landImportedProject's steps: dual write + files_restored + framework + memory + preview
boot — extract that closure into a callable module first). Client cap ~2GB zips (browser File API
comfortably streams these). Honest progress UI (entries scanned / source found).

TIER 3 (only if real demand): >2GB zips via GCS direct upload (signed URL from the client, Cloud
Run streams-extracts from the bucket, then the same landing endpoint). New infra: bucket + lifecycle
+ signed-URL route. Do NOT build speculatively — Tier 1+2 cover the realistic Replit/Bolt cases.

Also raise WorkspaceFiles MAX_FILES 2000→4000 to match zip.ts when Tier 2 lands (measure Firestore
write cost first). Resume point: extract landImportedProject into src/server/AgentV3 module +
/api/agentv3/import-land endpoint, then the fflate client filter in AgentV3Panel's addFiles zip path.

## MILESTONE (2026-07-03, session 01KDmsCZ): E2B LIVE-PREVIEW BUG-HUNT — 5 root-cause fixes, all merged

Admin pain: "e2b live preview chal hi nahi raha hai" while config was confirmed correct
(preview-status: actuator=e2b, e2bKeySet=true, livePreviewAvailable=true). A read-only bug hunt of
the preview / dev-server-boot path (config was NOT the cause) found five real runtime bugs. All
shipped as separate branch→CI-green→squash-merge PRs, each with the full gate (tsc app+server,
vitest, build, boot):

- **#887 (A)** — the preview **Diagnose** button called `readFile('package.json')` on a COLD sandbox,
  which `getSandbox()` spins up EMPTY, so it reported "No package.json found — no dependencies" for a
  project whose files were intact in the durable store. Fix: hydrate first (sandboxStore.get →
  ensureWorkspace(resumeSandboxId) → loadWorkspaceFiles → writeWorkspaceFiles), same as the chat path.
- **#888 (B)** — `browseUrl` (the preview self-check's DOM fetch) ran `node -e "require('playwright')"`
  from WORKSPACE_ROOT with no PLAYWRIGHT_BROWSERS_PATH, but Playwright lives under TOOLS_DIR, so the
  require ALWAYS failed and it silently fell back to a curl of the static shell — the self-check never
  saw the client-rendered DOM (rubber-stamped broken apps AND "healed" working ones). Fix: run from
  cwd TOOLS_DIR with PLAYWRIGHT_BROWSERS_PATH set (mirroring the working screenshot path).
- **#889 (C+D)** — a bare `npm run dev` was assumed to be Vite for EVERY framework: it got Vite-only
  `--strictPort` (which astro/nuxt/ng reject → crash) and Vite-style `--host` (next wants `-H` → exits).
  Fix: resolve the pm-script to its real tool from package.json (new pure resolvePmScript +
  detectDevFramework), make ensureHostBinding/pinDevServerPort framework-aware; Vite/unknown path kept
  BYTE-IDENTICAL (asserted by tests). Also fired the Vite allowedHosts patch for resolved-Vite dev (D).
- **#900 (E)** — the dev-server health line reported the port the server ACTUALLY bound (boundPort) but
  only re-verified it when the ASSUMED port had already read UP (`portUp && boundPort !== port`); a
  drifted-but-healthy server whose assumed port was down was reported DOWN forever, so the agent never
  published the working preview. Fix (4th-rule root-cause): pure shouldReprobeBoundPort() — re-probe
  whenever the bound port differs, independent of the assumed-port result; re-probe only ever UPGRADES
  to UP (safe). Sibling sweep: pattern exists only in E2BActuator.

Note: #897 (other session) built on #889 — declared-port ground truth for preview-diagnose + import
boot — composing cleanly, not colliding. Preview track is now EXHAUSTED (no clean findings remain).
Deliberately NOT touching the build-engine rebuild (#892–#896) or the big-app-import next phase (#898)
— those are the other session's active locked territory (safeguard #2).

## 2026-07-04 — Readiness-gate false positives: working Hospital-OPD app scored 0/100 (root-caused from the admin's new build report)

Admin re-ran a real build after the engine rebuild. GOOD: 0 doubled-path errors, no step-limit death,
tsc clean, npm run build exit 0, 31 files. BAD: the readiness gate blocked the working app with
score 0/100 on THREE false-positive "high" blockers. Each root-caused to its exact line and fixed
at the class level (fourth absolute rule):

1. **"SQL injection" on `aria-label={`Delete ${med.name}`}`** — SecurityAnalysis's sql-injection
   regex matched ANY template string starting with an English word that is also a SQL verb. Now it
   requires a REAL SQL skeleton (INSERT INTO / DELETE FROM…WHERE / UPDATE…SET= / SELECT…FROM[…WHERE])
   plus interpolation/concat. UI English ("Delete …?", "Select … from the list") no longer flags;
   all real-SQL cases still do.
2. **"fake/incomplete code (placeholder)" on Tailwind `placeholder:`/`placeholder-*` classes** —
   AuthenticityAnalysis's stub-marker rule treated quoted class strings as fake-code markers. Added
   `(?![-:])`; genuine `// placeholder` / "this is a stub" still flag. Same class: the coming-soon
   rule flagged "not available yet" — the EXACT honest-state text the constitution mandates —
   narrowed to "coming soon" only.
3. **"serious privacy/compliance issue" = missing privacy policy** — virtually every CRUD app collects
   form PII, so this high hard-blocked a huge class of complete apps the user never asked a privacy
   page for. Downgraded to an honest ADVISORY (medium, still in the report; never a blocker).
4. **RequirementCoverage false negatives** — artifact /register/ does not match "Registration.tsx"
   (fully-built OPD Registration reported "not found"); → /regist/. notifications now accept
   toast/snackbar (ToastContext IS the notification surface); search accepts filter.

+9 regression tests encoding the EXACT failure lines from the build report. Gate: tsc 0/0,
vitest 4485/4485 PASS, boot PASS.

Known remaining (next slice, separate): the gate still does not weigh the RENDERED preview verdict
(the build's real issue — a blank page — was never a readiness input). Recorded as an open root cause.

## 2026-07-04 — Open root cause CLOSED by analysis: "gate never weighs the rendered preview"

Investigated before building anything (safeguard #6). The rendered-preview verify + one-shot heal
ALREADY exists at the right layer (routes/agentv3.ts post-build: browseUrl → analyzePreviewHtml →
repair pass → honest ⚠️ narration + PREVIEW_NOT_RENDERED diagnostic). In the Hospital build it never
ran because its guard is `result.ok && lastPreviewUrl` — and the readiness gate's FALSE POSITIVES
(#903) had already flipped ok:false, while the pre-#895 preview path had never published a URL. Both
legs of that cascade are now fixed (#903 gate honesty + #895 self-healing preview), so the existing
self-check runs exactly when it should. Duplicating browse-verification INSIDE the gate would be
redundant work at the wrong layer — not built, by design. Policy note (unchanged, deliberate): a
build whose preview still fails after heal ships ok:true WITH a loud honest warning (files are real;
PREVIEW_FAILED ≠ build failure).

## NEW MARCH (admin-mandated, 2026-07-04): SOFTWARE PROJECT MODE — the 5000-file builder

Admin's verbatim mandate: "mujhe ek strong rock solid app builder chahiye, jo 5000 files software
bhi bina atke easyli bana de... chahe pura system hi kyu na badalna pade, agar need ho to, (need
nahi ho to isi ko theek karo) par mujhe complex task bhi simply ho jaye, aisa v3.0 bana ke do".

Why the system change is needed (code-verified analysis, delivered to admin): every v3.0 build
runs in ONE agentic conversation, which imposes five ceilings no prompt can fix — C1 single
context window (~40-80 files), C2 AGENTV3_MAX_STEPS 80, C3 wall clock 1800-3600s, C4 budget cap,
C5 small-app-tuned verification. A 1000+ file project can never fit; the architecture must change.

The architecture (approved direction): decompose ONCE into modules with explicit dependencies and
FROZEN export contracts → persist the plan durably → each build turn constructs ONE module in a
FRESH context containing only that module's spec + done modules' contracts (never the transcript)
→ existing bounded auto-continue drives turn after turn until the plan completes → modules surface
through the EXISTING todos/PLAN_STATE UI (zero new client surface) → per-module tsc gate + final
full verification. Context stays constant regardless of project size.

Phase plan (each = its own PR, autonomous cycle, flag-gated additive — kill switch
AGENTV3_PROJECT_MODE, default off, existing builds byte-identical while off):
- SPM-1 (DONE, PR #906): pure data layer. src/server/AgentV3/ProjectPlan.ts (types; tolerant
  planner-JSON parse with unsafe-path drops + dependency aliasing + honest caps MAX_MODULES=60;
  nextBuildableModule resumes in_progress first, else first pending with deps done;
  planBlockedReason distinguishes failed-dep vs cycle honestly; markModuleStatus immutable;
  projectPlanTodos maps failed→blocked onto existing TodoItem UI; moduleBuildContext = goal +
  this module + DONE contracts only; strict serialize/parse — corrupt storage → null → re-plan)
  + ProjectPlanStore.ts (Firestore doc per workspace in project_plans_v3 behind a write-through
  in-process cache; #873 settings-guard; dedicated doc because the workspace-memory snapshot caps
  episodes at 100 and would silently evict a note-stored plan mid-mega-build) + 31 tests.
  Gate: tsc 0/0 both configs, vitest 4519/4519, build+boot PASS.
- SPM-2 (NEXT — exact resume point): route wiring. Detect mega-build intent (classification),
  generate the module plan via projectPlanSystemPrompt/parsePlannedModules (one planner call,
  reuse the bpGenerate/fastBuildModel pattern from the #858 blueprint step at
  routes/agentv3.ts~3374), save via saveProjectPlan, then make each build turn architect ONE
  module using moduleBuildContext instead of the full prompt. Flag-gated AGENTV3_PROJECT_MODE.
- SPM-3: plan-driven continuation — a finished module turn with plan incomplete returns a
  resumable result so the existing Layer-3 client auto-continue (AgentV3Panel autoContinueRef,
  AUTO_CONTINUE_MAX) drives the next module; raise/parametrize the budget in project mode;
  per-module billing recorded per turn as today.
- SPM-4: modules as todos via todo_updated/PLAN_STATE + phased verification (per-module tsc,
  full gate at plan completion). Then AppKnowledgeBase entry for the user-facing capability.

## 2026-07-04 — SPM-2 BUILT: module-scoped build turns wired into the route (flag-gated)

Software Project Mode is now wired end-to-end server-side, entirely behind
AGENTV3_PROJECT_MODE=on (default OFF — with the flag off every build is byte-identical
to today; full suite green proves it). What ships:
- Pure gating (ProjectPlan.ts): projectModeEnabled; detectMegaProject (HIGH-precision:
  explicit ">=100 files/pages/screens/modules", big-software noun + >=8 enumerated
  features, or >=14 bullets); isContinuationMessage (matches the client's literal
  auto-continue 'continue' + English/Hinglish phrasings, rejects substantive asks so a
  mid-project edit request is NEVER steamrolled into "build module N"). 7 new tests.
- Route (routes/agentv3.ts, after the plan-first gate): on a mega new_build with no
  existing plan → one planner call (fastBuildModel, 60s hard timeout, billed via the
  existing blueprintUsage fold) → parsePlannedModules → >=3 modules or honest fallback
  to a normal build → saveProjectPlan. With an incomplete plan + continuation message →
  nextBuildableModule (retries a failed module on EXPLICIT continue), mark in_progress,
  todos projection, buildPrompt gets moduleBuildContext (goal + this module + DONE
  contracts only). One-shot fast lane skipped for module turns (no tool loop there to
  honor contracts). After the result settles: module → done, or failed with the honest
  reason; plan saved BEFORE the PLAN_STATE note capture. Final result emit adds
  resumable+planRemaining on a successful module turn with buildable modules left, so
  the EXISTING Layer-3 client auto-continue drives the next module (bounded at
  AUTO_CONTINUE_MAX=2 per user message until SPM-3).
- Known limits (deliberate, recorded honestly): plan creation only on new_build
  (an imported-repo mega-conversion doesn't create a plan yet); a reopened incomplete
  plan needs a typed "continue" (restore doesn't re-emit resumable); client
  auto-continue budget still 2 — SPM-3 raises it progress-monotonically for plan mode.
Gate: tsc 0/0 both configs, vitest 4526/4526, build + boot PASS.

## 2026-07-04 — SPM-3 BUILT: progress-monotone auto-continue drives the whole module plan

The classic Layer-3 budget (2 continues per user message, built for wall-clock pauses) would
strangle a 40-module plan — the user would type "continue" twenty times through a build they
asked to run unattended. SPM-3 replaces the fixed number with a DIFFERENT guard, in a pure,
fully-tested module (src/components/agentv3/planAutoContinue.ts — decideAutoContinue):
- A plan-mode result (planRemaining on the result event, carried through the reducer into
  state) auto-continues ONLY while planRemaining STRICTLY DECREASES — real progress runs the
  whole plan unattended; a stall (same/growing remaining) stops with an honest hand-back.
- Every completed module RESETS the pause budget, so module 30 gets the same time-limit
  tolerance module 1 had; mid-module deadline pauses still use the classic bounded budget.
- Absolute backstop PLAN_CONTINUE_MAX=100 (server MAX_MODULES=60) can never bind on a real
  plan but caps any pathological chain. A fresh user message resets all three refs.
AgentV3Panel's effect now consumes the pure decision (thin wiring); agentV3Reducer carries
planRemaining. 9 new tests (8 decision + 1 reducer carry).
Gate: tsc 0/0 both configs, vitest 4535/4535, build + boot PASS.
Next: SPM-4 — per-module verification gate + AppKnowledgeBase entry once admin enables the flag.

## 2026-07-04 — SPM-4 BUILT: knowledge-base entry + verification audit — SOFTWARE PROJECT MODE march COMPLETE (server-side)

SPM-4 closes the march. Audit findings (verified in code, not assumed):
- Modules-as-todos: already shipped in SPM-2 (projectPlanTodos → state.setTodos on select AND
  settle; PLAN_STATE note persists them durably, so a reopened session restores the module plan).
- Per-module verification: already REAL — every module turn is a top-level build and therefore
  passes the mandatory readiness gate (readinessGateEnabled() default ON, AGENTV3_READINESS_GATE
  !== 'off'); a gate failure → result.ok false → module marked failed with the honest reason.
  tsc runs whole-workspace each turn, which catches cross-module drift EARLY by design.
- New in this PR: AppKnowledgeBase entry `agentv3_project_mode` (mandatory rule — every AI in
  NavBharatAI can now answer "big app kaise banau"), with English + Hinglish keywords.

STATE: Software Project Mode is fully built and dormant behind AGENTV3_PROJECT_MODE (default
OFF; kill-switch by unsetting). ADMIN DECISION NEEDED (asked in chat, safeguard #3): set
AGENTV3_PROJECT_MODE=on on the Cloud Run service to activate. Recommendation: enable, then run
one real mega-prompt test (e.g. "an app with 200+ screens for hospital + pharmacy + lab +
billing + HR, features listed") and watch the module plan appear and advance. Detection is
high-precision, so ordinary builds are untouched even with the flag on.

Open (recorded, not blocking): imported-repo mega-conversion doesn't create a plan (creation
fires only on fresh new_build); a reopened incomplete plan needs a typed "continue" (restore
doesn't re-emit resumable); contract drift (a built module deviating from its frozen contract)
is caught by the whole-workspace tsc gate, not by a dedicated contract check.

## 2026-07-04 — Tier-2a BUILT: 4 of the 5 approved import additions (zip landing hardening)

From the admin-approved additions list (10GB-ready plan):
- Stack ignore-lists: SKIP_DIR_RE now also drops venv/.venv/__pycache__/.pytest_cache/
  .mypy_cache/target/.gradle/Pods/DerivedData/.expo/.dart_tool/vendor/.idea; new JUNK_FILE_RE
  drops .DS_Store/Thumbs.db/desktop.ini (exact-name), all counted honestly.
- Lockfile exception: a text lockfile (package-lock.json/pnpm-lock.yaml/yarn.lock) over the
  900KB durable cap (≤3MB) lands SANDBOX-ONLY via a new ExtractedProject.sandboxOnly map —
  npm install reproduces the exact dependency tree; the durable store skips it BY DESIGN and
  the summary says so (restore re-resolves via install). bun.lockb stays excluded (binary).
- Monorepo landing: when a zip has NO root package.json, chooseMonorepoAppRoot picks the most
  app-like nested folder (scored on dev/start script + framework dep + apps/ home + depth;
  nested workspace containers excluded) and the import re-roots to it, with an honest
  outsideAppRoot count. A root WORKSPACE package.json instead gets a validation warning
  ("tell me which app to run") — never a silent guess.
- .env template surfacing: envTemplateNote lists the variable NAMES from .env.example/.sample/
  .template in chat right after landing (live .env is still never imported).
DEFERRED (recorded, next candidate): small binary assets (<200KB images/fonts) — doing it
honestly needs base64-aware writes in the actuator + WorkspaceFileStore + restore path, else
assets survive the live sandbox but silently vanish on durable restore (a half-state the
second absolute rule forbids). Own designed PR.
10 new tests (28 total in ProjectImport.test.ts). Gate: tsc 0/0 both, vitest 4545/4545,
build + boot PASS.

## 2026-07-04 — Google sign-in shows "continue to navbharatai.com" (authDomain → own domain)

Admin: the Google account-chooser read "continue to gen-lang-client-0866594388.firebaseapp.com" (the
raw project host) instead of navbharatai.com. Root cause: Firebase `authDomain` was the *.firebaseapp.com
host. Fixed by pointing `authDomain` at `navbharatai.com` (src/config/firebase.ts fallback; VITE_ vars
are not injected at build, so the fallback is what ships). This ALSO makes the whole auth flow
same-origin with the app — which was the real reason the custom domain was reverted before
(authDomain≠app-origin → cross-origin storage partitioning made signInWithRedirect return logged-out);
same-origin removes it, and sign-in is popup-first regardless. All prerequisites verified before flip:
/__/auth proxy exists (server.ts), navbharatai.com is a Firebase Authorized Domain (current logins
succeed), and the Google OAuth Web client already lists https://navbharatai.com/__/auth/handler +
https://navbharatai.com. server.ts FIREBASE_AUTH_HOST left as the real firebaseapp.com host (proxy
upstream). Gate: tsc 0, vitest 4488/4488 PASS, boot PASS. Post-deploy: test Google login immediately;
1-line revert ready if any issue.

## 2026-07-04 — Tier-2b BUILT: small binary assets kept (the 5th & final import addition)

The deferred piece from Tier-2a, now done COMPLETELY (no half-state): an imported app's small
binary assets (logo/favicon/icons/fonts, ≤200KB each) are kept as REAL bytes so the preview
isn't full of broken images.
- Extraction (ProjectImport.ts): a BINARY_EXT_RE entry that is a keepable image/font type
  (ASSET_MIME map) and ≤200KB (≤200 assets, ≤20MB total) is stored as a `data:<mime>;base64,…`
  string in a NEW ExtractedProject.assets bucket — deliberately SEPARATE from `files`. Every
  other binary (video/audio/archive/large image) stays dropped. parseDataUri/assetMimeFor pure+tested.
- Why a separate bucket + separate store (the design decision, verified in code): the text-file
  store (WorkspaceFileStore) is REPLACED after every build from a text-only sandbox scan
  (collectWorkspaceFiles skips binaries via NUL) — an asset put there would be silently dropped on
  the FIRST build after import. And a data-URI in the text map would leak `data:` blobs into the
  in-browser preview, the deploy collector, and the AI's file reads. So assets get WorkspaceAssetStore
  (own Firestore collection workspace_assets_v3, one doc/asset, merge-union, #873 settings-guard).
- Landing (route): assets written to the sandbox as real bytes (actuator.writeBinaryFile via
  materializeAssets) AND persisted via saveWorkspaceAssets. Materialized back into the sandbox at
  EVERY restore point — the restore endpoint, the build-start File Guardian (cold-sandbox signal),
  and the structure-check reseed — via restoreWorkspaceAssets. So an imported logo survives reload,
  tab close, and instance rotation, exactly like the source files.
- Known gap (honest, pre-existing — NOT introduced here): the importUrl GIT-CLONE path
  (writeToSandbox:false) still doesn't persist its binary assets durably, because its file set comes
  from collectWorkspaceFiles which skips binaries. Closing that needs a binary read on the shared
  deploy collector — a separate, larger change; recorded, not half-built.
14 new tests (ProjectImport asset extraction + WorkspaceAssetStore materialize/restore). AppKnowledgeBase
zip-import entry updated (sync rule). Gate: tsc 0/0 both, vitest 4554/4554, build + boot PASS.

## MILESTONE (2026-07-04, session 01KDmsCZ): PARALLEL BUG-HUNT ROUND 2 — 6 root-cause fixes across isolated surfaces, all merged

After the preview track (#887–#901), ran read-only bug-hunters across the ISOLATED (non-hot) parts of
the v3.0 flow — deliberately avoiding the other session's actively-rewritten core (build-engine
#892–#896, big-app import #898, and the hot files agentv3.ts/E2BActuator/ToolDispatcher/DevServerRecovery).
Every fix follows the 4th rule (root-cause, class-level, siblings-hunted, regression-locked) and passed
the full gate before merge:

- **#914** — Complex apps ("SaaS CRM", "e-commerce", "social network") were routed to the FAST build
  lane. Root cause: two complexity detectors drifted — RequestAnalyser.RE.complexApp called them
  complex_app, but BuildTimeEstimator.complexityFromPrompt scored magnitude 2 → fast. Centralized the
  signal in one shared src/server/lib/appComplexitySignals.ts (superset + crm/erp/marketplace/food-
  delivery); complexityFromPrompt now floors a named category to the deep threshold. Directly targets
  the admin's original "complex app bana nahi pa raha" pain.
- **#916** — A real build/edit request was answered as CHAT when its verb was embedded in an earlier
  word ("add" in "ladder", "change" in "exchange"). Root cause: 3 copies of a first-occurrence-only
  word check. Centralized into containsSignalWord (scans ALL occurrences).
- **#915** — PWA report false-404 on the standard `site.webmanifest`; SimpleBuilder manifest parser
  corrupted `2fa/…` paths and dropped `.env.example` (greedy bullet-strip).
- **#917** — Three report-analyzer FALSE POSITIVES (honesty bugs): a11y zoom-disabled on
  `maximum-scale=1.5`; a11y control-unlabeled on a wrapping `<label>`; SEO "Home" title as a "template
  default".
- **#918** — Fast-lane contract/parse: ContractMap missed DESTRUCTURED exports (Zustand/Context) →
  false drift fed to repair; same-named enums aggregated first-wins → false enum drift; parseFileBlocks
  merged+dropped a file on a missing `<<<ENDFILE>>>`.

Also verified CLEAN (honest negatives, no churn): the async/util helpers (asyncUtils, ClaudeClient,
orchestrators, LiveEventBuffer, numeric helpers) and the CORE build pass/fail classifier
(classifyBuildOutcome, TscGate, BuildJudge, assessReadiness) — no fake-success / fake-failure.
Intentionally deferred: ContractMap enum SCOPE-aware resolution (did the conservative skip instead) and
the low-value ContractMap advisory edge. Isolated-surface hunting is now at diminishing returns; the
remaining high-value work lives in the other session's hot core (hold per safeguard #2).

## 2026-07-04 — HOSTING Phase 0, Slice 1: HostingQuota policy + usage store (pure, no wiring)

Admin approved building the hosting product (host users' apps) in phases: Phase 0 (quota + abuse
guard) → A (GitHub Pages free + Cloudflare subdomain) → C (wallet billing) → B (custom domain). A
map+design workflow (10 agents, adversarial) produced the plan; who-pays reality: NavBharatAI pays for
every FIRST-PARTY deploy (its own Firebase Hosting today, Cloudflare later) and there was NO size or
count cap = open cost/abuse hole.

Slice 1 (pure modules, zero wiring — cannot break anything):
- NEW src/server/lib/HostingUsageStore.ts — clone of UserCostStore (collection hosting_usage, doc
  {userId}_{YYYY-MM}, deployCount, transactional increment, VITEST-skip, best-effort never-throws).
  SEPARATE from user_costs so it never clobbers the billing total.
- NEW src/server/lib/HostingQuota.ts — single source of truth for who-pays/how-much: FIRST_PARTY_
  PROVIDERS {firebase,cloudflare} + isFirstPartyProvider; hostingDeployCap() (env
  AGENTV3_USER_MONTHLY_DEPLOY_CAP, 0=DISABLED default → zero behaviour change until admin opts in);
  maxDeployMb() (env AGENTV3_DEPLOY_MAX_MB, default 50 = safe ON); pure hostingWithinCap/deployBytesMb;
  async enforceHostingQuota() — BYO providers always allowed (user's own cost); first-party enforces
  size ceiling then monthly count; FAIL-OPEN on any store error/missing userId/disabled cap; honest
  hard-stop over-limit message pointing to free BYO hosting.
- +14 unit tests (classification, env parsing, size boundary at/over cap, fail-open under VITEST,
  BYO-always-allowed, anon).

Not yet wired (Slice 2): enforcement at the withDeploymentPersistence choke point. Gate: frontend
tsc 0, server tsc 0, vitest 4559/4559 PASS, boot PASS.

## 2026-07-04 — HOSTING Phase 0, Slice 2: enforce the quota at the deploy choke point

Wired Slice 1's HostingQuota into the ONE place every AgentV3 deploy funnels through —
withDeploymentPersistence (DeploymentStore.ts). Before base() publishes: a 5s-bounded, FAIL-OPEN
enforceHostingQuota() runs; over-limit throws an honest Error that propagates to the deploy tool's
error result (verified path: ToolDispatcher deploy case 1767 → general dispatch catch 656 → is_error
result) so NOTHING is published, no `preview` event, no URL, no fake success. On success, first-party
publishes increment hostingUsageStore.recordDeploy(userId) and the agentv3_deployments registry doc is
extended with providerId/firstParty/sizeMb/status:'active' (the takedown/report spine for later slices).
BYO deploys pass straight through (user's own host/cost). withDeploymentPersistence gained a providerId
param; agentv3.ts:3309 passes chosenProviderId. record() extended additively (only 2 callers; the
get-consumer is additive-safe). +5 gate tests (normal passes; oversized first-party blocks before
publish, base never called; env-lowered cap; BYO never blocked; count-cap fails-open under VITEST).
Gate: frontend tsc 0, server tsc 0, vitest 4604/4604 PASS, boot PASS.

## 2026-07-04 — HOSTING Phase 0, Slice 3: registry queries + REAL Firebase takedown (Phase 0 complete)

Completes Phase 0 (the abuse/takedown spine on top of the quota core). DeploymentStore gains
list()/listByUser()/setStatus() (best-effort, in-memory status filter → no composite Firestore index).
FirebaseHostingDeployer.deleteChannel(workspaceId) is a REAL unpublish via Firebase Hosting
channels.delete keyed by the SAME makeChannelId as deploy — idempotent (404=already-gone=success),
honest 403 (missing Firebase Hosting Admin IAM). admin.ts adds verifyAdminToken routes: GET
/api/admin/deployments (list, ?status=/?userId=), POST .../:workspaceId/takedown (deleteChannel FIRST
then setStatus('taken_down') + audit ADMIN_APP_TAKEDOWN; honest 502 if the live channel wasn't confirmed
removed — never a fake "taken down"), POST .../restore. The deploy choke point re-checks status
(bounded 3s, fail-open) so a taken_down app can never silently re-publish. +4 tests (registry no-throw
empties; taken-down republish blocked, base never called; active allowed; BYO skips the guard).
AppKnowledgeBase entry deferred to Phase A slice 5 (with the user-facing Report button). Gate: frontend
tsc 0, server tsc 0, vitest 4608/4608 PASS, boot PASS. Admin note: takedown needs the Cloud Run SA to
have the Firebase Hosting Admin role (deploy already uses it → present).

## 2026-07-04 — HOSTING Phase A, Slice 4: content-safety scanner (published-page abuse detection)

The genuinely-missing scanner class (the 3 existing scanners inspect SOURCE for builder-machine
threats; none inspect the SHIPPED page for end-user harm). NEW src/server/AgentV3/ContentSafetyScanner.ts
reuses the CodeSafetyScanner rule-engine shape to scan the built dist HTML/JS/text for the clearest
abuse signatures: crypto seed-phrase / private-key harvest (wallet drainers), brand-impersonation
"account suspended / verify" phishing lures, and sensitive-financial (CVV/OTP) capture. Pure, bounded,
never throws. Wired into the deploy choke point (withDeploymentPersistence) AFTER the takedown guard:
default WARN-ONLY (audit APP_PUBLISH_FLAGGED + registry `flagged:true`, publish proceeds) so a
legitimate login for the user's OWN product is never wrongly blocked; env AGENTV3_PUBLISH_SCAN=block
hard-holds an unsafe verdict (status='held', honest throw, nothing published). +10 tests with REAL
phishing/drainer fixtures (must flag) + REAL legit-login/CRUD fixtures (must NOT flag) + block/warn
wiring. Gate: frontend tsc 0, server tsc 0, vitest 4631/4631 PASS, boot PASS.

Phase A remaining: public Report button + /api/report-app (slice 5, client + route + AppKnowledgeBase);
GitHub Pages free-tier provider + Cloudflare .navbharatai.app subdomain (need admin Cloudflare
account/token/domain + the subdomain-root decision).
## 2026-07-04 — "handle Mitrify x50" program (admin mandate): 4 capabilities driven autonomously

Admin: "mujhe ek strong rock solid app builder chahiye jo 5000 files software bhi bina atke bana de …
Mitrify x50 level tak ki app handel karne wala ai bana ke do." Answered "all" to the priority
question → drove all four capabilities, most-value-first, one tested PR each:

- Cap ① EDIT/UNDERSTAND at scale (core value, not infra-bound):
  - #925 summarizeFileTree — edit-mode injected the ENTIRE flat file tree every turn (~1MB for a
    15k-file app → context-window blast); now a small app lists all paths, a large one gets a
    bounded directory summary + agent uses grep/glob/search_files.
  - #926 contentSearchTerms — RAG grounding ranked candidates by FILENAME only; added content grep
    (actuator.searchFiles) so the right file is found by CONTENT (e.g. "credits" logic in storage.ts).
- Cap ② HEAVY-APP PREVIEW (#928): imported full-stack app crashed on bare `npm run dev` (no
  DATABASE_URL / undefined env). New ImportPreview module: detectNeedsDatabase → provision local
  Postgres (existing provisionBackend) → write dev .env (DB URL + NODE_ENV + placeholders) → boot
  (cap 245→380s). DB+.env persist so Diagnose re-boot works too. Honest: external paid services
  can't be faked → reported, preview is partial by design.
- Cap ③ IMPORT SCALE (#929): raised IMPORT_MAX_FILES 2000→16000 and collectWorkspaceFiles MAX_FILES
  4000→16000 (Mitrify x50 ≈ 16k). Guarded the durable path index (capPathsToDocLimit) so a
  pathological huge repo can't blow the 1MB Firestore metadata doc — graceful cap, not a failed
  save. Honest open: >16k needs path-index sharding / git-as-durable-source (future phase).
- Cap ④ SOFTWARE PROJECT MODE (build big from scratch): already built (SPM-1..4), dormant behind
  AGENTV3_PROJECT_MODE. Hardened the gate for a SAFE rollout: projectModeEnabled now supports 'on'
  (all), 'off'/unset (disabled), OR a per-user ALLOWLIST (comma/space uids/emails) so the admin can
  enable SPM for their OWN account first and test a real mega-build before all users. Cap ③'s raised
  file caps were a prerequisite — before it, a 5000-file SPM build would truncate on durable save.

ADMIN ACTION for Cap ④ live test: set AGENTV3_PROJECT_MODE to your uid/email (e.g.
`AGENTV3_PROJECT_MODE=aashishcpmt09@gmail.com`) on Cloud Run to enable SPM for your account only,
then send a real mega-prompt (200+ screens / a long feature list). Flip to `on` for all users once
happy; `off`/unset is the kill switch.

## 2026-07-04 — INFRA MEMORY: hosting domains + mitrify.in Hostinger capabilities (admin-provided)

Admin owns 3 domains: (1) navbharatai.com — the live app (Cloud Run + Firebase Hosting); (2) mitrify.xyz;
(3) mitrify.in — has a PAID Hostinger web-hosting plan (1yr prepaid), currently idle.

mitrify.in Hostinger plan is NODE.JS-CAPABLE (NOT basic static — corrected from an earlier wrong "Single"
assumption; the hPanel dashboard is ground truth):
- Node.js apps: 3/5 used (2 free slots), Node 22.x, Express framework supported.
- Deploy: git/zip upload + a real BUILD pipeline (Redeploy, build logs, build/output settings); root dir "mitrify".
- Disk 3.33/50 GB; inodes 139K/600K. SSL ✓, malware protection ✓, daily backups, DB-connect, file manager,
  runtime logs. CDN AVAILABLE but currently OFF (can enable free).
- CURRENT STATE: last deployment (2026-06-02, file 1526mitrify.zip, Express, Node 22) = BUILD FAILED → that
  is why nothing runs on mitrify.in and the money is idle. Root cause TBD (need the build logs / zip contents).

Hosting strategy (agreed direction, pending final A/B + the mitrify.in build fix): user apps → Cloudflare
Pages (free, unlimited, CDN, custom domains) for scale; mitrify.in (already paid, Node-capable, 2 free Node
slots + 50GB static room + enable CDN) is genuinely usable for the platform's own showcase/report page AND/OR
a bounded free-tier host. Do NOT paste FTP/hosting passwords in chat — wire as Cloud Run secrets/env.

## 2026-07-04 — HOSTING: Cloudflare Pages registered as an env-gated first-party DeployProvider

The scalable user-app engine (free, unlimited bandwidth, CDN, custom domains). NEW
src/server/AgentV3/CloudflareProvider.ts — mirrors the binary-safe NetlifyProvider/VercelProvider
pattern and self-registers (side-effect import added in agentv3.ts after NetlifyProvider). Env-gated on
CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID: until BOTH are set it reports configured:false with an
honest requirement and deploy() throws an honest "not configured" error — never a fake URL, no
hardcoded creds. Selectable via deployProvider='cloudflare'.

CRITICAL correctness (caught by the design workflow's adversarial verify — both reviewers rejected the
first spec): the obvious "reuse ProDeploy.deployCloudflarePages" path does `buf.toString('utf8')` which
CORRUPTS every binary asset (images/fonts/favicons) — it would serve a broken site while reporting
success (a rule-#2 fake). CloudflareProvider is instead BUFFER-NATIVE: it hashes the RAW bytes
(sha256) and uploads `new Blob([buffer])` (raw bytes), byte-for-byte intact. +7 tests incl. an explicit
binary round-trip (0xFF/0x00 bytes survive; hash ≠ utf8-hash), both-creds-required, token-never-leaked,
project-name ≤58 chars/DNS-safe. Because 'cloudflare' is already in FIRST_PARTY_PROVIDERS, the Phase 0
size+count quota + takedown guard + content scan apply with ZERO extra wiring. AppKnowledgeBase
agentv3_deploy entry updated (Cloudflare added). Gate: frontend tsc 0, server tsc 0, vitest 4643/4643
PASS, boot PASS. Admin: set CLOUDFLARE_API_TOKEN (Pages:Edit) + CLOUDFLARE_ACCOUNT_ID as Cloud Run
secrets to activate.

## 2026-07-04 — HOTFIX (admin-reported): 1-sec internet blip fails a build + stale account-lock traps retries

Two coupled bugs, root-caused via a client-stream investigation. Symptom: a ~1s network drop during a
v3.0 build showed "failed"; retrying said "A build is already running for this account" with NO working
Stop/Resume and History showed 404 (the dropped build never persisted).

ROOT CAUSES:
- Bug 1: on a mid-stream network drop the client's catch probed /status ONCE, immediately — while the
  network was still down — so the probe also threw and the build was declared FAILED (the 100s stall
  watchdog can't help: the hard error flips running→false, tearing the watchdog down).
- Bug 2: the account build-lock (`activeBuilds`) is released by the handler's finally; if a blip leaves
  the build stuck on an un-abortable await, that finally never runs and the lock is only freed at the
  long wall-clock deadline — trapping the account for minutes. The client's 409 recovery was gated on
  workspaceIdRef.current (only set by a live stream event), so after a reload (new sessionId) it
  dead-ended with no Stop button (panel Stop is gated on serverBuildRunning, which stayed false).

FIXES (three layers so it can't recur):
1. Client (blip resilience): the reconnect probe now RETRIES with backoff (4 attempts: 0/1.2/2.4/3.6s)
   — a brief blip is caught on a later attempt → transparent resume() instead of "failed". Only errors
   when a probe definitively reports the build gone or all attempts fail.
2. Client (409 recovery): the dead-end 409 branch now sets serverBuildRunning=true so the panel renders
   the real ⏹ Stop button (which force-clears the lock server-side) + an honest "Press Stop, then send
   again" message — no more dead end.
3. Server (lock reclaim): new pure shouldReclaimBuildLock() — a NEW build request auto-reclaims an
   ABANDONED (no subscriber + past the 30s stall window) or ZOMBIE (no live registry entry) lock,
   tearing the old build down cleanly, so a hung/dropped build can never trap the account beyond ~30s.
   +5 unit tests. Gate: frontend tsc 0, server tsc 0, vitest 4648/4648 PASS, boot:check PASS.

## 2026-07-04 — v3.0 focus-mode composer polish (admin UX request, PR #936)

Admin request (IMG_5706, confirmed in chat before building): in v3.0 chat, when the header is hidden
(focus mode), the composer footer's outer "paid-looking" frame should disappear so the input reads as
a clean floating popup — while the three inner controls (filter/settings, attach, textarea) stay
exactly as they are, and the composer never hides behind the phone browser's bottom search bar. Plus:
move the Exit-Focus button from the bottom to the top-right corner (admin picked option A: fixed,
top-most layer, always visible; panel controls may shift to make room).

CHANGES (focus-mode-only; normal mode byte-for-byte unchanged):
- AgentV3Panel: new optional `focusMode` prop. Composer footer outer container drops
  `bg-zinc-950 border-t border-zinc-800` when focusMode is on; `pb-[env(safe-area-inset-bottom)]`
  always stays (never hides behind the phone bottom bar). Inner element borders untouched. Header row
  reserves `pr-14` in focus mode so its trailing Stop/Resume controls don't sit under the fixed exit
  button.
- ProV3Surface: threads focusMode through to the panel.
- App.tsx: passes focusMode to ProV3Surface; Exit-Focus button moved from bottom-4 right-4 to fixed
  top-3 right-3, z-[9999], env(safe-area-inset-top)-aware.

Gate: frontend tsc 0, vitest 4650/4650 PASS, build PASS, boot:check PASS. Additive + reversible
(focusMode absent = today's exact behaviour). No server code touched → no AppKnowledgeBase change
needed (pure visual polish, no new navigation/feature surface).

## MILESTONE (2026-07-04, session 01KDmsCZ): PARALLEL BUG-HUNT ROUND 3 — 5 fixes across stores/templates/analyzers, all merged

Third read-only hunt round over the ISOLATED (non-hot) surfaces (still avoiding the other session's
hot core — agentv3.ts/E2BActuator/ToolDispatcher/DevServerRecovery, and the import/SPM stores). All
follow the 4th rule and passed the full gate before merge:

- **#934** — a11y `hasAttr` used `\b${attr}`, which matches after a hyphen, so `\balt=` matched inside
  `data-alt=` → an `<img data-alt>` was read as HAVING alt and the missing-alt finding silently
  skipped (a MISSED real a11y issue). Fixed with `(?<![-\w])`; swept BOTH copies (AccessibilityAnalysis
  + AppMakerLab/intelligence/A11yLinter).
- **#935** — HIGH (deploy-breaking): the Django scaffold's Procfile boots `gunicorn myproject.wsgi` but
  getFiles never emitted `myproject/wsgi.py` → production deploy died with ModuleNotFoundError, served
  no traffic (sandbox preview hid it via runserver's default WSGI). Added wsgi.py + WSGI_APPLICATION.
- **#937** — PRIVACY (medium-high) + integrity: durable per-user diagnostics keyed a null user to a
  shared `'anon'` doc (`userId || 'anon'`) → one anon user could read another's report (generated
  SOURCE/errors/commands). New pure perUserDiagnosticsDocId returns null for a null user (no shared
  bucket; anon still served via the unguessable workspace-keyed path). ALSO: UserPreferenceStore
  .recordBuild did a non-transactional read-modify-write with set(merge:false) → lost update on
  concurrent builds; wrapped in runTransaction. **Admin flagged in the PR** for awareness of the leak.
- **#938** — hardcoded-URL scan matched only `https?://`, missing `ws://localhost`/`wss://` local
  sockets (chat/live features) — flagged by NEITHER this nor SecurityAnalysis, breaks 100% in prod.
  Broadened to `(?:https?|wss?)`.

DELIBERATELY DEFERRED (real but marginal — recorded so the next session can pick them up, NOT churned):
- DesignLinter.extractFontFamilies advertises Tailwind `font-[...]` coverage in its doc but only parses
  CSS `font-family:` → a 3-arbitrary-font Tailwind app isn't flagged (LOW-MED).
- PortBindingAnalysis misses the split `const PORT = 3000; app.listen(PORT)` hardcode (single-line
  detection only) (LOW).
- FirestoreConversationStore.listByUser fallback (when the composite index is absent AND >200 convos)
  truncates BEFORE ordering → newest chats can be dropped from the "recent" list (LOW-MED, edge).
- DiagnosticsStore history subcollection grows unbounded (eviction is read-side only) — storage/cost
  creep, not a correctness bug (LOW).
Round-3 verified-clean (no fix needed): CheckpointStore, DeploymentStore, ProviderStateStore,
EmbeddingStore, in-memory ConversationStore, FirestoreConversationStore timeline writes; GitignoreGenerator
and all non-Django framework providers; DesignLinter's hex/spacing logic.

## 2026-07-04 — HOTFIX (admin-reported): "network error" banner after a SUCCESSFUL v3.0 build/survey

Symptom (admin imported a GitHub repo — mitrify — for a survey): the survey completed ("✓ Done · 24
steps · 4m 8s"), then a "network error" banner appeared, making a build that had ALREADY SUCCEEDED
look broken. (Second, separate symptom — the heavy full-stack app's live preview did not auto-boot —
is a partial-by-nature runtime limit, not this bug; see the honest note below.)

ROOT CAUSE (client stream handling, not the build): a v3.0 build emits its terminal `result`, and THEN
the server holds the NDJSON stream open for up to ~6 min of post-result work — a heavy import's
local-Postgres provision + `npm install` + dev-server boot (routes/agentv3.ts `finally` awaits
`importPreviewBoot` at line ~4844 AFTER emitting `result` at ~4790, before `endBuild`). If the
connection is severed during that long post-result window — a mobile blip, or Cloud Run's request
timeout on the long-open stream — the client reader throws. The old catch treated that throw as a
build failure and surfaced the raw error (`start()` line ~819 and `resume()` line ~488), even though
the terminal `result` had already arrived. A stream error AFTER the result is a best-effort tail drop,
never a build failure.

FIX (one rule, both stream consumers, no drift) — PR #940:
- NEW pure `src/hooks/agentV3StreamError.ts` — `shouldSurfaceStreamError({isAbort,isStale,sawResult,
  reconnected})`: a stream error surfaces ONLY when it is a genuine failure — never on an intentional
  abort, a stale/abandoned session, a successful transparent reconnect, or (the fix) a drop after the
  terminal `result`. Single source of truth used by BOTH consumers so they can't drift.
- `useAgentV3Build.ts`: `start()` tracks `sawResult` (set when the `result` event arrives) and gates
  its final `setError` through the helper; `pumpStream()`/`resume()` thread a per-call `sink` so a
  reattached stream carries the same fact. start()'s post-result reconnect passes
  `resultAlreadySeen:true` so the reattach (which catches the import-boot tail — e.g. the live preview
  URL) also never resurfaces an error for a finished build. The reconnect logic is PRESERVED, so a drop
  while the import boot is still running still transparently re-attaches and picks up the preview URL.
- +8 unit tests (tests/agentV3StreamError.test.ts) encoding the exact failure case + every boundary.

HONEST NOTE on the 2nd symptom (heavy full-stack live preview didn't auto-boot): the import DID land +
survey succeeded; the live preview for a full backend app (Express + Postgres + external paid services
like payments/auth) is PARTIAL by nature — external keys can't be faked in the sandbox, and the exact
boot outcome is in the Preview tab's Diagnose log (a manual re-boot with a visible log). Port detection
already has log-drift recovery (detectDevPort) + package.json `--port` parsing (devScriptPort). Not
shipping a speculative boot fix without the Diagnose log would be guessing (rule 1); the In-browser
preview + Diagnose remain the honest fallbacks.

Gate: frontend tsc 0, server tsc 0, vitest 4660/4660 PASS, boot:check PASS.

## 2026-07-04 — v3.0 focus-mode follow-up: remove the dead strip under the composer (PR after #936)

Admin (IMG_5708) flagged an empty unused strip under the v3.0 composer in focus mode, above the phone
browser's address bar. ROOT CAUSE (App.tsx:5544): the mobile view container reserved `pb-14` (56px)
"space for bottom nav on mobile" unconditionally — but the mobile bottom nav is hidden in focus mode
(its <nav> at App.tsx:6506 is gated on `!focusMode`). So focus mode padded 56px for a nav that isn't
rendered → empty dead strip. FIX: gate the `pb-14` on the SAME `!focusMode` condition as the nav, so
the reservation and the nav stay in lock-step (padding exists iff the nav does). Composer's own
`pb-[env(safe-area-inset-bottom)]` stays → sits just above the browser bar without hiding behind it.
Gate: frontend tsc 0, vitest 4650/4650 PASS, build PASS.

## MILESTONE (2026-07-04, session 01KDmsCZ): BUG-HUNT ROUND 4 — security + design fixes + deferred deploy backlog

Fourth read-only hunt over fresh isolated surfaces (deploy providers, security scanners, design linter).
Merged:
- **#941** — DesignLinter.extractFontFamilies advertised Tailwind `font-[...]` coverage in its JSDoc but
  only parsed CSS `font-family:` → a Tailwind app that sets fonts via classes reported 0 fonts and the
  too-many-fonts check never fired. Now scans `font-[...]` arbitrary utilities (family-name: hint, `_`→
  space, numeric-weight excluded).
- **#943** — TWO HIGH security-scanner FALSE-NEGATIVES (scanner said "clean" while a real secret was
  exposed): (a) SecurityAnalysis PLACEHOLDER guard tested the WHOLE LINE, so `<` (every JSX line) and
  `test` (in latest/fastest/a comment) suppressed real secrets — secret detection was effectively
  disabled on .tsx. Fixed by testing the captured VALUE (ignore guard now gets the match array).
  (b) SecretLeakAnalysis `\.env\b` matched inside `.env.local`, so a CRA gitignore (only `.env.local`,
  never bare `.env`) made a committed `.env` report "gitignored". Fixed to accept only rules that
  actually cover bare `.env`.

DEFERRED — deploy findings that are REAL but NOT clean/isolated (need verification or touch hot files;
recorded so the next session can pick them up, NOT blind-fixed per safeguard #3):
- Angular deploy: AngularProvider.ts:77 `outputPath:'dist/app'` + the `application` builder emits
  `dist/app/browser/index.html`, but the deploy collector reads `dist/`-root → deployed site 404s at `/`
  while `ng serve` preview works. The correct fix (normalize the collected tree to the index.html dir)
  lives in the deploy collector inside E2BActuator (HOT); reachability (does v3.0 actually scaffold+build+
  deploy Angular?) depends on hot framework-resolution code — VERIFY before fixing. (Deploy PROVIDERS
  themselves — Netlify/Vercel/Cloudflare/Firebase — were audited and are clean: binary-safe uploads,
  honest error propagation, real quota/takedown gates, no false-success.)
- Deploy has no per-framework output-dir map: Next/SvelteKit/Nuxt/Remix (.next/build/.output) and
  backends (node-express/nestjs/fastify/python) have no correct static target; `kind:'fullstack'` in the
  provider interface is dead (no fullstack provider registered). Capability gap, not a single-line bug.
- Firebase deploy applies an unconditional SPA catch-all rewrite (`glob:'**'→/index.html`) to every
  deploy → an MPA/static site soft-404s. (LOW.)

## MILESTONE (2026-07-04, session 01KDmsCZ): BUG-HUNT ROUND 5 — readiness/architecture honesty + analyzer false-positives

Fifth read-only hunt (build-verdict/readiness + remaining analyzers). Merged:
- **#945** — THREE interlocking verdict bugs (shipped together): (a) HIGH — assessReadiness never read
  arch.nodeBuiltinsInFrontend, so a React app with `import fs from 'fs'` (browser-build-breaker) reported
  READY 100/100 (fake success) → now a hard blocker. (b) MEDIUM — isFrontendFile matched the app/pages
  segment, so a Next.js server route (`app/api/**/route.ts`, `pages/api`) with a legit `import fs` was
  flagged a browser-build-breaker; with (a) making that a BLOCKER it would falsely fail a valid Next.js
  app → now excludes server routes. (c) HIGH — resolveLocalImport returned null for the ubiquitous `@/…`
  / `~/…` path aliases, so EVERY alias-imported component was a false "orphan the app won't render" → now
  resolves aliases to the src-rooted file.
- **#946** — TWO analyzer false-positives: AuthenticityAnalysis empty-handler matched any `) {` so a
  guard `if (!data) { console.log }` (and for/while/catch) was mislabeled an empty handler → now requires
  a real arrow/function body. ComplianceAnalysis cookie-no-httponly/secure were line-local → a fully-
  secure MULTI-LINE `res.cookie({...})` (standard Express) reported both flags missing → now evaluates
  over the whole parens-balanced call.

DEFERRED (real HIGH, but fix site is the HOT ToolDispatcher — record for next session, do NOT blind-fix):
- Missing npm deps never reach the readiness gate: DependencyAnalysis flags an imported-but-undeclared
  package (`import axios` with no axios in package.json — "the #1 silent build-breaker") as high, but
  ToolDispatcher only threads its `missing` subset into the ADVISORY dependencyAutoFixSummary + the
  confidence metric — it is never pushed into `extra`, and assessReadiness(arch, findings, extra) is the
  only thing that sets `ready`. So a "Cannot find module" build passes as READY. FIX: in ToolDispatcher's
  extra-assembly, push missing deps into `extra` as a high blocker (pure DependencyAnalysis + Readiness
  are already correct — only the wiring drops the signal). Blocked here because ToolDispatcher.ts is the
  other session's hot file (safeguard #2).
Round-5 cleared (no wrong verdict): ErrorBoundaryAnalysis, RunnabilityAnalysis, DependencyAnalysis,
EnvVarAnalysis, ViteEnvAnalysis, AsyncPatternAnalysis, TestCoverageAnalysis, EnvSecretValueAnalysis,
SecurityConfigAnalysis, ProjectHygieneAnalysis, ASTAnalyzer; deploy PROVIDERS (Netlify/Vercel/Cloudflare/
Firebase) all correct. (The Angular dist-dir + no-per-framework-output-map deploy gaps remain deferred
from round 4.)

## MILESTONE (2026-07-05, session 01KDmsCZ): BUG-HUNT ROUND 6 — NEW AREAS (platform frontend + non-build AI surfaces)

First hunt outside the AgentV3 build backend — the platform's OWN frontend (XSS in how it renders
AI/user content) and the non-build AI surfaces (Doctor AI / Free / Pro chat). Most productive round:
- **#948** — HIGH stored XSS. The IDE file-tree hover preview injected an `.svg` file's RAW source via
  dangerouslySetInnerHTML; `files` is AI/user/import-controlled, so a `logo.svg` containing
  `<img src=x onerror=…>` stole document.cookie + localStorage (Firebase auth tokens) in the PLATFORM
  origin the moment the user HOVERED it. Fixed by rendering SVG via an `<img>` data-URI (script-disabled
  secure-static mode); extracted pure tested svgPreviewSrc(). No new dep (DOMPurify isn't in the tree).
- **#949** — HIGH clinical safety. Doctor AI's red-flag detector matched a leading digit behind
  `.{0,10}`, so "BP 120/80" false-flagged Hypotension while real "BP 85/55" was MISSED, "Hb 13" →
  Severe Anaemia, "SpO2 100%" → Low SpO2 — and these flags are PERSISTED into case memory + re-injected
  into the model's prompt every turn. Extracted to a pure numeric-parsing lib/clinical/redFlags.ts
  (SpO2<90, systolic<90 or diastolic<60, Hb<7) with boundary tests.
- **#950** — MEDIUM same-origin XSS: the SDA clinical-PDF (document.write to about:blank) interpolated
  the attached-file name / patient fields / red-flags RAW, and MultiPageBuilder's nav preview
  interpolated page title / logo text / href RAW. Centralized escaping into one shared tested
  src/lib/escapeHtml.ts used by both.

DEFERRED (recorded for follow-up):
- FigmaImporter (src/components/ide/FigmaImporter.tsx:642) `document.write(generatedCode)` into a
  same-origin window.open popup — AI/Figma-derived HTML runs in-origin. Correct fix is a sandboxed
  iframe (`sandbox="allow-scripts"`, NO allow-same-origin), a larger refactor than an escape.
Round-6 cleared (safe): react-markdown v10 with no rehype-raw (AI-reply markdown XSS not exploitable);
PWANotifications highlight escaping; clinical calculators (CURB-65/qSOFA/GCS/Wells/CHA2DS2-VASc);
AIRouter tier→universe mapping; AppKnowledgeBase (no duplicate ids); free/pro chat prompt assembly.

## UPDATE (2026-07-05, session 01KDmsCZ): round-6 deferred FigmaImporter sink — NOW FIXED (#952)

The FigmaImporter same-origin XSS deferred in the round-6 milestone above is done:
- **#952** — "Open in Preview" no longer `document.write`s the AI/Figma-generated HTML into a
  same-origin `about:blank` popup (where its scripts could read platform auth tokens). It now renders
  inside a SANDBOXED `<iframe srcdoc>` with NO `allow-same-origin` (opaque origin), so the preview
  runs but can't reach platform storage/DOM. Sandbox tokens live in shared src/lib/previewSandbox.ts
  with a test locking the invariant (never allow-same-origin). All FOUR round-6 XSS sinks are now
  closed (#948 file-tree SVG, #950 SDA-PDF + nav, #952 FigmaImporter), each with a tested pure helper
  (svgPreviewSrc / escapeHtml / previewSandbox) so they can't silently regress.

## UPDATE (2026-07-05, session 01KDmsCZ): round-7 — OAuth token postMessage hardening (#TBD)

New hunt area (auth / session / postMessage token flow). Two independent read-only hunters both
flagged the same complete token-injection/exfiltration loop as fix-immediately:

- **githubAuth.ts (SENDER)** — the OAuth success popup broadcast the GitHub (repo+workflow scope)
  token with `window.opener.postMessage({...token}, '*')` — a WILDCARD target. Any page that opened
  this callback popup (becoming `window.opener`) could read a victim's token. Fixed: the token is now
  posted only to a concrete trusted origin, derived server-side via a pure tested helper
  `oauthTargetOrigin(returnUrl)` (never returns `'*'`; falls back to the canonical production origin
  for missing/malformed input). `returnUrl` is already allow-list-filtered upstream by `safeReturnUrl`,
  so the target is always the legitimate NavBharatAI origin the opener is expected to be on. The
  localStorage-signal + redirect-fragment channels remain as secondary delivery paths, so no legit
  flow depends solely on postMessage. (The error-branch post carries no token — only an error string —
  so its wildcard leaks no secret and was left unchanged.)
- **App.tsx (RECEIVER)** — the `message` handler injected `GITHUB_AUTH_SUCCESS` / `FIREBASE_AUTH_SUCCESS`
  tokens into state + localStorage with NO `e.origin` check, so any cross-origin page could inject a
  forged token. Added `if (e.origin !== window.location.origin) return;` to BOTH token branches (the
  OAuth callback popup is served same-origin). SANDBOX_ERROR was intentionally left unguarded — it
  legitimately originates from the same-origin preview iframe and carries no secret. (Note:
  FIREBASE_AUTH_SUCCESS currently has no legit sender — firebaseAuth.ts is an honest "not available"
  stub that only posts FIREBASE_AUTH_CANCELLED — so its guard is pure hardening against forged tokens.)

Locked with regression tests (githubAuth.test.ts): the target origin is NEVER `'*'`, derives the exact
origin from an allow-listed return URL, and falls back to production for malformed input.

DEFERRED (recorded, honest — root not fully in reach this change):
- **Same-origin preview-iframe amplifier** — PreviewPanel.tsx renders the user/AI preview with
  `sandbox="allow-scripts allow-same-origin"`. Because that iframe shares the platform origin, a
  hostile preview could still postMessage a forged `GITHUB_AUTH_SUCCESS` that PASSES the new
  `e.origin === window.location.origin` receiver check. The origin guard above closes the CROSS-origin
  vector (the wildcard leak/injection); the same-origin amplifier needs the preview sandbox moved to an
  opaque origin (drop allow-same-origin), which requires runtime verification that the live preview
  feature still works and is a larger change — NOT blind-edited here.

## UPDATE (2026-07-05, session 01KDmsCZ): round-7 #2 — build cost/history attribution spoofing fixed (#TBD)

MEDIUM auth/IDOR in the Pro build path. `/api/build-stream` took the user identity from the
client-supplied `req.body.userId` (unverified) and used it for `userCostStore.record()` and
`userBuildHistoryStore.record()`. Any caller could set `userId` to a VICTIM's uid → inflate that
victim's monthly cost / burn their quota, and forge build-history entries under their name.

Root cause: cost/history was attributed from a spoofable request-body field instead of a verified
identity — and the frontend `buildAppStream()` sent NO Authorization header at all, so there was no
verified identity to attribute to. Two-sided fix:
- **Server (build.ts)** — derive the attribution uid ONLY from `verifyFirebaseToken(req)` via a new
  pure tested helper `resolveAttributionUserId()` (verified uid → used; no token → undefined = no
  attribution to anyone). The `req.body.userId` field is no longer read for attribution.
- **Frontend (buildService.ts)** — `buildAppStream()` now attaches `Authorization: Bearer <idToken>`
  (dynamic firebase import so the unit-tested module stays firebase-free at load). Signed-out users
  build anonymously (unattributed), exactly as before.

Locked with a regression test (routesBuildPro.test.ts): attribution uses a verified uid verbatim and
returns undefined for null/empty — a spoofed body userId can never reach cost/history recording.
Behavior for legitimate signed-in users is unchanged (same uid attributed, now unspoofable).

## UPDATE (2026-07-05, session 01KDmsCZ): round-7 #3 — cross-user secret-delete IDOR fixed (#TBD)

`DELETE /api/secrets/:userId/:secretId` soft-deleted `user_secrets/{secretId}` after only
`requireUserMatch('userId')`. But `user_secrets` is a FLAT collection (each doc carries a `user_id`
field), and the delete keyed off `:secretId` ALONE — it never checked that the target document
belonged to the authenticated user. So any signed-in user could soft-delete ANOTHER user's stored
secret (their Supabase/API keys, etc.) by calling `DELETE /api/secrets/<their-own-uid>/<victim_secretId>`
— the `:userId` in the path was decorative for the delete. Denial-of-service / griefing on a victim's
integrations.

Root cause: an owner-scoped mutation trusted a globally-addressable document id without confirming
ownership at the point of write. Fix: `getDoc` the target first and refuse (404 — no existence leak,
no write) unless `data.user_id === :userId` (the verified caller), then soft-delete. Sibling hunt:
the GET (`where('user_id','==',userId)`) and POST (`user_id: userId`) were already user-scoped; the
admin rotate-all iterates every doc by design; `sync.ts` deletes by a userId-derived doc id — none
share the flaw. Locked with a route-level regression test (routesSecretsIdor.test.ts, mocked
Firestore): a foreign secret → 404 + zero writes, a missing id → 404, the owner → 200 + soft-delete.

Round-7 security sweep (auth/session/postMessage/IDOR) now covers: OAuth token postMessage hardening
(#955), build cost/history attribution spoofing (#956), and this cross-user secret-delete IDOR.
Deferred (recorded above): the same-origin preview-iframe amplifier (PreviewPanel allow-same-origin)
— opaque-sandbox fix needs live preview verification.

## 2026-07-05 — HOTFIX (admin IMG_5709): "internet off 30s → load fail → retry" showed TWO contradictory messages

Admin report: with internet off ~30s during a v3.0 build, the reconnect showed BOTH "Your build from
before the reload was still running — I re-attached to it live below" AND a red "No running build to
resume." — a direct contradiction.

ROOT CAUSE (DNA level): on a 409-resumable reconnect the client (useAgentV3Build.ts resume()) emitted
the optimistic "re-attached live" notice IMMEDIATELY, BEFORE /attach had confirmed a live build. The
/chat 409 check (isBuildRunning) and the SEPARATE /attach call are not atomic, so the build can end in
the window between them (it finished, or was torn down when the connection dropped). /attach then 404'd
("No running build to resume.") — but the false "re-attached live" promise was already on screen. The
promise preceded its own confirmation → contradiction.

FIX (honesty timing, root cause not symptom):
- New pure `reconnectOutcome({ ok, status, resultAlreadySeen })` (agentV3StreamError.ts) — the ONE
  decision for what a /attach result means: ok → 'live'; 404 → 'gone-silent' (result already seen →
  benign tail close, say nothing) or 'gone-notice' (mid-build → one honest "your files are safe, send
  again" line); any other non-ok → 'error'. A 404 is NEVER 'live' and NEVER a red 'error'.
- resume() now emits the optimistic "re-attached live" notice ONLY on a confirmed-live attach; a 404 is
  presented calmly per reconnectOutcome (no red banner, clean sendable state), so the contradiction can
  never recur. +5 regression tests encoding the exact IMG_5709 case + boundaries.
Gate: frontend tsc 0, server tsc 0, vitest 4671/4671 PASS, build PASS.

## UPDATE (2026-07-05, session 01KDmsCZ): round-8 — Cashfree webhook signature verified over raw bytes (#TBD)

New hunt area (billing / payments / cost math). Two read-only hunters swept it; shipped the
highest-confidence, lowest-risk live money bug:

- **payment.ts `/api/payment/webhook`** — the HMAC was computed over `JSON.stringify(req.body)`, i.e.
  the parsed-then-RE-serialized body, whose bytes differ from what Cashfree actually signed (whitespace,
  key order, escaping). So `isSignatureValid` was effectively ALWAYS false → every legitimate webhook
  got `401` → the server-to-server payment-fulfillment safety net was silently dead. A user who paid
  but closed the tab / dropped network before the client `/verify-payment` poll finished was CHARGED
  but NEVER CREDITED. Root cause: signing over re-serialized JSON instead of the exact received bytes.
  Fix: verify over `req.rawBody` (already captured by the express.json `verify` hook in server.ts),
  via a new pure tested helper `isValidCashfreeSignature()` (v2 = base64(ts+rawBody); legacy v1 =
  base64/hex(rawBody)); falls back to re-serialization only if rawBody is unavailable. Does NOT weaken
  security — forging any format still needs the shared secret. Locked with a regression test
  (cashfreeWebhookSignature.test.ts) that PROVES re-serialized bytes differ and would fail validation.

DEFERRED (recorded — HIGH, money path, needs careful/admin-aware treatment; NOT blind-fixed per
safeguard #3):
- **Non-atomic wallet credit (payments.ts:119-212)** — the wallet mutation is a read-modify-write with
  a FULL-document `setDoc` OUTSIDE any transaction. The per-order PENDING→SUCCESS claim (H1) ensures
  only one caller credits PER ORDER, but two DIFFERENT concurrent orders for the same user (or a
  concurrent coupon credit at payment.ts / admin token adjustment at admin.ts) can lost-update or be
  clobbered by the full overwrite → a user's paid credit silently dropped, or a concurrent write
  reverted. Correct fix: move the wallet read+credit into a `runTransaction` (re-read inside the tx)
  or use `FieldValue.increment()` on the numeric fields + `arrayUnion` for the ledger. Same class also
  affects the coupon credit (payment.ts getDoc→updateDoc). This is a live-money concurrency refactor;
  it should ship with strong transaction tests and careful review rather than a quick patch.
- **NaN cost guard (UserCostStore.record, line 50)** — `costUsd <= 0` lets `NaN`/`Infinity` through
  (`NaN <= 0` is false), which would permanently poison the stored monthly total. Currently BOTH
  callers pre-guard with `> 0` (agentv3.ts:4663, build.ts:558), so it is not live-exploitable today —
  recorded as a defense-in-depth hardening (enforce `Number.isFinite(costUsd) && costUsd > 0` at the
  store, the single entry point), not a live bug.
- **domains.ts `/api/domains/connect`** — unauthenticated (only buildRateLimiter), trusts a body
  `userId`; when Cloudflare is configured, an anonymous caller can trigger `createCustomHostname` on
  NavBharatAI's zone + write a `custom_domains` doc with an attacker-chosen userId. Fix: require
  `verifyFirebaseToken` and persist the verified uid. MEDIUM; gated on Cloudflare being configured.
- **payments.ts:176 ledger honesty** — hardcodes "Lifetime Pass Activated (₹50)" while the real pass
  price withheld is `VISHWAKARMA_PASS_PRICE_RUPEES = 100`. Customer-facing honesty bug; one-line fix
  (interpolate the constant). LOW.

## UPDATE (2026-07-05, session 01KDmsCZ): round-8 #2 — /api/domains/connect now requires auth (#TBD)

MEDIUM auth bug (recorded in the round-8 deferred list, now fixed). `POST /api/domains/connect` was
guarded ONLY by `buildRateLimiter()` (rate-limit, not auth) and trusted a spoofable `req.body.userId`.
When Cloudflare is configured, an anonymous caller could trigger `createCustomHostname()` on
NavBharatAI's own zone (cost/quota abuse) and write a `custom_domains/{host}` mapping under any uid.
(The legit frontend didn't even send userId → stored owner was always null.)

Root cause: a resource-provisioning + ownership-writing route with no verified identity. Two-sided fix:
- Server (domains.ts): require `verifyFirebaseToken(req)` FIRST (401 if absent) and persist the mapping
  under the VERIFIED uid — the guard runs before any Cloudflare call or DB write.
- Frontend (ConnectDomainPanel.tsx): attach `Authorization: Bearer <idToken>` (dynamic firebase import).

Locked with a route-level regression test (routesDomainsAuth.test.ts, mocked cloudflare + firestore):
an unauthenticated request → 401 and provisions NOTHING (createCustomHostname/setDoc never called),
even when a spoofed body userId is supplied.

Round-8 remaining recorded findings: the HIGH non-atomic wallet-credit race (live-money concurrency
refactor — being surfaced to admin for a careful, transaction-based follow-up), the NaN-cost
defense-in-depth guard (not live-exploitable; both callers pre-guard `> 0`), and the ₹50-vs-₹100
ledger-label honesty bug (LOW).

## UPDATE (2026-07-05, session 01KDmsCZ): round-8 #3 — billing correctness + honesty hardening (#TBD)

Two low-risk billing fixes from the round-8 deferred list, shipped together:

- **NaN cost guard (UserCostStore.record)** — the guard was `costUsd <= 0`, which lets `NaN`/`Infinity`
  through (`NaN <= 0` is false). A single NaN would then permanently poison the stored monthly total
  (`existing + NaN === NaN` forever) and flow into the Billing panel. Extracted the invariant to a pure
  tested helper `isRecordableCost(costUsd)` (finite AND > 0) enforced at the single entry point. Both
  current callers already pre-guard `> 0`, so this is defense-in-depth (invariant-at-entry per rule #2),
  not a live-exploitable bug — and now it cannot regress. Locked with tests (userCostStoreGuard.test.ts).
- **Ledger honesty label (payments.ts)** — the vishwakarma purchase ledger hardcoded
  "Lifetime Pass Activated (₹50)" while the real withheld pass price is `VISHWAKARMA_PASS_PRICE_RUPEES = 100`.
  Now interpolates the constant so the customer-facing description matches the actual amount and can
  never drift from the price. (Honesty rule — the system must tell the truth about what it charged.)

Round-8 wrap: shipped the dead-webhook fix (#959), domains auth (#960), and this hardening. The one
remaining recorded finding is the HIGH non-atomic wallet-credit race (payments.ts:119-212) — a
live-money concurrency refactor (runTransaction / FieldValue.increment) that cannot be end-to-end
verified against real Firestore in this sandbox, so it is being surfaced to the admin as a decision
rather than blind-patched (safeguard #3).

## 2026-07-05 — FIFTH-RULE AUTOPSY #1 (admin build report: Hospital OPD System) + fix: build report now saved WITH the chat, permanently

First forensic autopsy under the fifth absolute rule. Admin ran "Create a complete Hospital OPD
Management System" on v3.0; the run spanned 4+ "please continue" sessions, 123 steps, 18m 41s, ended
"✓ Done" then "Load failed", readiness NOT READY 75/100 ("1 unresolved import — the build will fail").
Admin's emphatic bug: **"build report save kyu nahi huyi … hamesa ke liye wahin save honi chahiye"**
(the build report itself did not persist — it must always be saved where the chat text is saved).

### Step 1 — Itemized ledger (honest tally)
- ✅ Self-healed (~8): Dashboard unused imports/state; Patients unused debounce/React/CardFooter;
  CardBody onClick→wrapper (3 tries); OPDQueue missing OPDVisit import; OPD-number drift centralized.
- 🔀 Worked around (~4): "Escalating to a stronger model" ×3 (couldn't converge on base model); pages
  built as throwaway "placeholders" then refilled; sub-agents re-exploring the project every turn.
- ⏭️ Skipped (~4): "pre-existing errors in other files" (App.tsx/DashboardStats/ToastContainer/
  useToast/Skeleton) noticed and repeatedly ignored as "out of scope" — the exact source of the final
  blocker; "App.tsx imports useToast incorrectly" seen, not fixed.
- ❌ Still broken (~4): "1 unresolved import → NOT READY 75/100" (headline); summary claims
  "✅ Production build: Successful" while the gate says it will fail (HONESTY CONTRADICTION); "Load
  failed" after Done; **the build report did not persist** (admin's bug).
- 🥵 Struggle (~8): "project looked lost from the sandbox, restored N files from history" EVERY session
  (15→26→35→35 — dominant signal); 123 steps/18m/4 sessions for one app; re-exploration from zero each
  turn; model escalations; tsconfig-confusion in the verify loop.

### Step 2 — Missing subsystems (systemic diagnosis)
1. Durable WARM-SANDBOX resume across turns (state lost every turn → full restore each time; FileGuardian
   fires at ≥50% files missing — FileGuardian.ts:52 — meaning the sandbox came up cold turn after turn).
2. A project-level IMPORT/WIRING RECONCILER + a readiness gate that BLOCKS and AUTO-FIXES unresolved
   imports (each sub-agent only tsc-checks its OWN file; nothing owns cross-file App.tsx routing/imports).
3. Cross-turn BUILD MEMORY so "continue" resumes at the next step instead of re-discovering the project.
4. Conversation-linked durable REPORT PERSISTENCE (admin's ask) — FIXED this turn (below).
5. REPORT-HONESTY reconciliation — the final summary must be OVERRIDDEN by the readiness verdict (never
   print "build Successful" when the gate says NOT READY).

### Step 3 — DNA-level fix SHIPPED this turn: the build report is saved WITH the chat, permanently
Root cause of "report save nahi huyi": the FULL report lived ONLY in a separate best-effort
`workspace_diagnostics_v3/{workspaceId}` doc; the conversation record stored only a compact
`finalState.buildHealth`. On reopen the client's synthetic `result` event OMITTED `diagnostics`
(agentV3History.ts) so the download had to RE-FETCH by workspaceId — which 404s when that separate
best-effort write didn't land (very likely on an 18-min/killed/"Load failed" build). Fix:
- NEW pure `compactReportForRecord()` (DiagnosticsStore.ts) — a bounded report (readiness/root-cause/
  summary/counts/problems + capped issues tail + preview errors + reviewer findings) that DROPS the
  heavy forensic channels (commands/llmCalls/errors/generatedFiles — those stay in the workspace doc).
- `persistSessionTimeline` (agentv3.ts) now EMBEDS that compact report into the conversation record's
  `finalState.report` — saved atomically with the chat, on the same durable write that already reliably
  restores the chat text.
- Client `conversationToEvents` rehydrates `finalState.report` into the synthetic `result` event's
  `diagnostics` (fires even for a zero-billing turn) → on reopen `state.diagnostics` is populated and
  the Build-report download/copy works offline, no separate fetch, no 404. Verdict card already
  rehydrates from `finalState.buildHealth`.
- +11 tests (compactReportForRecord bounds/drops/recomputes; reopen rehydrates state.diagnostics).
- AppKnowledgeBase agentv3_build_report updated (report now saved with the chat).

### Step 4 / rule 6 — OPEN ROOT CAUSES (recorded honestly, NOT yet fixed — for the next autopsy passes)
- OPEN: warm-sandbox resume unreliable → "project looked lost/restored from history" every turn (biggest
  struggle). Needs a durable per-workspace warm sandbox that survives between continue-turns.
- OPEN: no whole-project import/wiring reconciler → an app can ship with an unresolved import (NOT READY
  75/100) after piecemeal per-file generation. Needs a post-generation local-import + route resolver that
  auto-fixes, and a gate that never passes a build with an unresolved import.
- OPEN: no cross-turn build memory → every "continue" re-explores from zero (wasted steps/time).
- OPEN: report-honesty — the sub-agent's "✅ Production build: Successful" summary can contradict the
  readiness verdict; the final summary must be reconciled with / overridden by the gate.
These are the highest-value targets to make big complex apps struggle as little as small ones.

Gate: frontend tsc 0, server tsc 0, vitest 4716/4716 PASS, boot:check PASS.

## 2026-07-05 — v3.0 connection resilience: a tab switch no longer kills the live build (admin's 3 asks)

Admin (IMG_5711 build report + follow-up): (1) "Load failed" should never happen — even on a tab
change the build should keep running in the background; (2) NavBharatAI's tab bar can have v3.0 AND
Free open at once (4+ tabs) — that must not fail the connection; (3) if a drop DOES happen, a
"reconnect" must resume from where it left off, never restart from 0.

ROOT CAUSE (unified for asks 1 & 2): the v3.0 surface rendered ONLY on `activeView === 'nbi_pro_chat'`
(App.tsx). NavBharatAI has a tab bar (openTabs) where several surfaces can be open, but only the ACTIVE
one is mounted — so the instant v3.0 stopped being the active tab (switch tabs, or click Free while a
build runs), ProV3Surface UNMOUNTED and tore down the live NDJSON stream mid-build → the "Load failed"
on a tab switch, and the "both open → connection fails" report. (The server build survives via
runningBuilds and auto-resume re-attaches on return, but that teardown→re-attach churn is what surfaced
as failure.)

FIX (PR pending): keep ProV3Surface MOUNTED while a build is running, regardless of the active tab, so
the stream keeps flowing invisibly in the background across tab switches and multi-tab usage.
- NEW pure `src/components/agentv3/v3SurfaceMount.ts` — `shouldRenderV3Surface(activeView, running)`
  (render when active OR a build is running) + `v3SurfaceDisplayClass(activeView)` (`contents` when
  active = a layout NO-OP identical to before; `hidden`/display:none when kept alive in the background).
- App.tsx: the v3.0 render block now uses these + a keep-alive wrapper div. Guarded by `v3Preview.running`
  (already reported via onPreviewState) → zero idle overhead: once the build ends it unmounts as before.
- +6 unit tests (tests/v3SurfaceMount.test.ts).

Ask 3 was ALREADY handled by prior merged work (#940 suppress cosmetic error after result, #957 honest
reconnect outcome, and the resume()/attach REPLAY buffer): the Reconnect/Resume path calls resume()
(re-attach + replay from where it dropped), never start() from 0, and an auto-resume effect fires it
without a click. The keep-alive fix above makes a drop far rarer in the first place. Not re-touched.

Gate: frontend tsc 0, server tsc 0, vitest 4721/4721 PASS, frontend+server build PASS.

## 2026-07-05 — FIFTH-RULE AUTOPSY: "Build health: READY · 0/100" (Hospital OPD build #2, IMG_5712/5713 + 637KB diagnostics JSON)

Admin sent a v3.0 build report. Full forensic autopsy per the fifth absolute rule.

STEP 1 — ledger (630 issues; 549 auto-resolved, 81 unresolved, 84 errors): 🥵 STRUGGLE (dominant) — the
E2B SANDBOX DIED mid-build: 81× SANDBOX_CMD_FAILED, every trivial command (ls/pwd/cat package.json/
node --version/true/echo ok) exit -1 in 0s, agent notes "sandbox timed out / unresponsive". 110 cmds:
27 exit-0 (early) then 83 failures — alive at first, then E2B killed it and the engine never recreated
it (222 steps / 21m / ₹23). 🔀 51× PROVIDER_FALLBACK (GLM/KIMI failing→Claude), 41× TOOL_ERROR. ⏭️
sign-up/registration not built; no tests; no real error boundary. ❌ NO package.json (app can't run);
App.tsx missing imports (ToastContext/ErrorBoundary/Patients/OPD); 27 orphan components; the verdict LIED.

STEP 2 — missing subsystems: (1) live sandbox-health gate + auto-recreate (exit -1 on `true`/`echo ok`
⇒ sandbox dead ⇒ recreate ONE fresh, don't fire 81 cmds into a corpse) — the #1 open root cause
"warm-sandbox durability", now with hard evidence the engine REUSES DEAD sandboxes; (2) honest readiness
gate (fixed); (3) guaranteed package.json scaffold.

STEP 3 — DNA fix shipped (honesty root cause, verifiable): "READY · 0/100" is impossible now.
Readiness.assessReadiness set `ready = blockers.length === 0`, IGNORING the score — so 27 orphan
components (WARNINGS) cratered the score to 0 while no hard blocker existed → "READY 0/100", and the AI
reviewer's own "❌ 25/100 CRITICAL" verdict never reached the gate. Fix (Readiness.ts): MIN_READY_SCORE
= 50 — ready requires no hard blocker AND score ≥ floor; below it records an honest blocker saying WHY.
Propagates to the AgentRunner summary + build-health badge. +2 regression tests; existing readiness
tests unaffected.

OPEN ROOT CAUSES (rule 6 — recorded, NOT faked):
- [#1, INFRA-GATED] dead-sandbox detect + auto-recreate — the true root; detector is code-testable but
  the E2B recreate needs a LIVE sandbox to verify (no E2B in CI), so queued as top follow-up, not faked.
- package.json invariant (runnable scaffold even if the sandbox is dead during scaffolding).
- reviewer→readiness wiring (reviewer's CRITICAL findings should feed the gate as hard blockers).

Gate: frontend tsc 0, server tsc 0, vitest 4723/4723 PASS.

## 2026-07-05 — v3.0 cheap-floor review pipeline: Grok reviews, GLM/KIMI gets 1 bounce, Sonnet only for the final fix (admin plan)

Admin's approved pipeline: GLM/KIMI builds → GROK reviews → pass? keep it → fail? GLM/KIMI self-repairs
ONCE → Grok re-reviews → pass? keep it → still fail? SONNET repairs. Two wins: (1) the weak cheap model
gets EXACTLY ONE self-fix bounce before we spend the strong model — no more of the 51-PROVIDER_FALLBACK
grind seen in the last autopsy; (2) the REVIEWER moves from Sonnet → Grok (cheaper + an independent
model family), so Claude is touched ONLY for the final repair — minimising the Anthropic bill.

CHANGES:
- NEW pure `src/server/AgentV3/CheapFloorReview.ts` — `nextReviewAction(pass, bouncesUsed, cap)` bounds
  the loop (after the cap it can ONLY go to Sonnet, never bounce to the weak model again),
  `selectReviewer({reviewer, grokKey})` (Grok when a Grok/xAI key is present + AGENTV3_REVIEWER≠sonnet,
  else SAFE fallback to today's Sonnet judge), `cheapBounceCap` (AGENTV3_CHEAP_BOUNCES, clamped [0,3]).
  +10 unit tests.
- `routes/agentv3.ts` — new `selectReviewJudge()` builds the Grok `JudgeRunTurn` over the OpenAI-compatible
  xAI API (`GROK_API_KEY`/`XAI_API_KEY`, model `GROK_JUDGE_MODEL` default grok-3) — no new infra — and
  falls back to the Sonnet judge when Grok isn't configured. The cheap-floor escalation gate now reviews
  with Grok and runs the bounded GLM/KIMI self-repair loop before handing the findings to Sonnet.

SAFETY: entirely inside the existing cheap-floor escalation path (shouldEscalateBuild + escalationEnabled
+ deliveredCheap + AGENTV3_SONNET_JUDGE). No Grok key OR AGENTV3_REVIEWER=sonnet → byte-for-byte today's
Sonnet-judge behaviour. Grok outage → judgeBuild is best-effort (resolves PASS), and the bounce catches a
GLM/KIMI failure and escalates to Sonnet — a reviewer/repairer outage never breaks a build. Normal
Claude-first builds are untouched.

Gate: frontend tsc 0, server tsc 0, vitest 4733/4733 PASS, boot:check PASS.

## 2026-07-05 — WARM-SANDBOX DURABILITY: dead sandbox is detected + recreated instead of grinding on a corpse (admin "seriously fix")

Root cause (from the "READY · 0/100" autopsy): the E2B sandbox was reaped mid-build (timed out / reclaimed
between the long multi-session build). `getSandbox()` handed back the CACHED dead reference with no
liveness check, and the ONLY eviction path (fileOp) fired only on a *timeout* — but a dead sandbox fails
FAST (every ls/pwd/cat/true/echo ok returned exit -1 in 0s, not a timeout). So the corpse was never
evicted and 81 commands died against it over 21 min.

FIX:
- NEW pure `sandboxHealth.ts` — `isDeadSandboxSignal({exitCode,durationMs,stdout,stderr,errorMessage})`
  + `isDeadSandboxError(msg)`: classify a DEAD sandbox (reaped / not-running / network-gone / 5xx, OR
  "exit<0 instant with no output" — the exact reported shape) vs. a normal command that ran and failed.
  +8 unit tests (incl. the exact reported failure shape + the "don't nuke on a real command error" cases).
- `E2BActuator`:
  • `runCommand` regular path: on a dead-sandbox signal, EVICT + recreate ONCE + retry — a mid-build
    death becomes invisible instead of an 81-command corpse grind. A normal nonzero exit never recreates.
  • `fileOp`: eviction broadened from timeout-only to ANY dead-sandbox signal (the fast-fail case).
  • Bounded SOURCE-file write-through cache (`_fileCache`, ≤500 files × ≤256 KB, node_modules/dist
    excluded) populated by `writeFile`; `getSandbox` REPLAYS it onto a freshly-created sandbox so the
    recreate restores the build's source instead of coming back empty. Cleared on idle-pause.

Answers to the admin's questions (recorded): (1) "prevent death" isn't achievable — every ephemeral cloud
sandbox (E2B/Docker/Modal/Daytona) has a lifetime/reclaim; the real fix is RESILIENCE (detect→recreate→
restore), which is what this ships. (2) It does NOT die from heavy use — activity refreshes the timeout;
it died from timeout/reclaim across the long build. (3) Switching providers won't make it immortal; this
resilience works for any provider.

HONEST verification note (rule 6): the PURE classifier + the eviction/cache LOGIC are fully CI-verified
(tsc + 8 unit tests + full suite). The actual E2B reap → recreate → source-replay round-trip can only be
proven against a LIVE E2B sandbox (there is no E2B in CI), so that end-to-end behaviour is exercised by
the existing Sandbox.create path but not asserted here — it is the one part that needs a live-sandbox
smoke test to fully close, and is called out rather than claimed as verified.

Gate: frontend tsc 0, server tsc 0, vitest 4741/4741 PASS, boot:check PASS.

## UPDATE (2026-07-05, session 01KDmsCZ): round-9 — silent edit-drop bug (naive JSON extractor) + centralized the class

New hunt area (server data-integrity/plumbing). Shipped the highest-confidence finding:

- **HIGH — `aiEdits.extractJson` silently dropped ALL edits on trailing prose** (`src/server/project/aiEdits.ts`).
  It sliced the model reply with `s.search(/[[{]/)` … `s.lastIndexOf(close)`. `lastIndexOf` grabs the LAST
  bracket ANYWHERE in the reply, so any trailing/leading prose containing a bracket — a markdown link
  `[docs](url)`, a checkbox `[ ]`, "thanks [x]", `${...}` — dragged prose into the slice, `JSON.parse`
  threw, `extractJson` returned null, `parseFileEdits` returned `[]`, and the BuildPipeline applied
  NOTHING → the whole edit turn became a silent no-op ("the edit did nothing"). Root cause: a naive
  bracket slice instead of a balanced, string-aware scan.

Root-cause fix (centralize the class per rule #2/#3): new shared `src/server/lib/extractJson.ts`
`extractFirstJson(raw, kind?)` — strips a ```json fence, tries a direct parse, then does a
string/escape-aware BALANCED scan, trying each opener left-to-right so a stray bracket in leading prose
is skipped and trailing prose is ignored. `kind` ('array'|'object'|'any') keeps a caller from picking a
stray value of the wrong shape. Migrated the two PARSED-VALUE call sites to it: `aiEdits` (edit-parse AND
file-plan parse) and `RequirementSpec.extractJsonObject` (same class bug; object kind). Locked with tests
(extractJson.test.ts — 9 incl. the exact trailing-prose case; aiEdits.test.ts regression at the
parseFileEdits level). The CORRECT sibling `ProjectPlan.extractJsonArray` was the reference (already
balanced) — not touched (other session's hot area).

DEFERRED — sibling STRING-returning naive extractors (same `indexOf/lastIndexOf` class, non-hot, but they
return a string slice the caller parses, so migrating changes their contract → separate focused pass):
`EngineerAI/PlannerAgent.extractJson`, `Guider.extractJsonObject`, `AgentV3/DesignAdvisor.extractJson`,
`EngineerAI/EngineerAgentLoop.extractJson` (its comment claims it's more robust — verify first). Should
adopt a string-returning variant of the shared util. Recorded so the class is finished, not half-done.

Also from this hunt (recorded, not yet fixed): **MEDIUM — EditEngine `patch` with numeric `count > 1`
re-scans from index 0**, so when `replace` contains `find` it re-matches inside its own insertion and
corrupts the file (`const count` → `itemCount` with count:2 → `const itemitemCount`). Fix: advance the
search cursor past each replacement instead of restarting at 0. Clean next PR.

## UPDATE (2026-07-05, session 01KDmsCZ): round-9 #2 — EditEngine count>1 self-match corruption fixed (#TBD)

The MEDIUM sibling recorded in the round-9 milestone above, now fixed. `EditEngine.applyOne` patch path
with a numeric `count > 1` called `updated.indexOf(edit.find)` from index 0 EVERY iteration. When
`replace` contains `find` as a substring, iteration 2 re-matched `find` INSIDE the just-inserted
replacement instead of the next real occurrence — e.g. `const count = 0;\nreturn count;` with
`{find:"count", replace:"itemCount", count:2}` produced `const itemitemCount = 0;\nreturn count;`
(mangled identifier + the real 2nd occurrence left untouched → file corruption → build breaks).

Root cause: a fixed-start search in a mutate-in-place loop. Fix: track a `fromIdx` cursor and search
from PAST each inserted replacement (`indexOf(edit.find, fromIdx)`; `fromIdx = idx + replace.length`),
so a replacement can never be re-matched. Locked with 2 regression tests (editEngine.test.ts): the exact
self-match case now yields `const itemCount = 0;\nreturn itemCount;`, and count>1 replaces exactly N and
stops. `count:'all'` (split/join) and the whitespace-tolerant fallback were already correct.

Still recorded (LOW): `flexibleReplace` ignores a numeric `count > 1` (only distinguishes all vs first),
so a count:3 patch that matches only via the whitespace-tolerant fallback replaces 1 — minor
under-application, not corruption; separate follow-up.

## UPDATE (2026-07-05, session 01KDmsCZ): round-9 #3 — naive JSON-extractor class CLOSED

Finished the class opened in round-9 (#968). Migrated the three remaining string-returning naive
extractors — same `indexOf(open)…lastIndexOf(close)` trap (trailing/leading prose with a bracket → bad
slice → silent parse failure → dropped result) — onto the shared balanced extractor:
- `EngineerAI/PlannerAgent.extractJson` (plan step parse)
- `Guider.extractJsonObject` (Pro-build plan + grade parse; exported, has a direct test)
- `AgentV3/DesignAdvisor.extractJson` (design suggestions/palette parse; exported, has a direct test)

Added `extractFirstJsonSlice(raw, kind)` to `src/server/lib/extractJson.ts` (returns the balanced JSON
SUBSTRING, preserving each caller's string contract) alongside the existing parsed-value `extractFirstJson`
(now a thin wrapper over the shared scan). Each site is a one-line delegate returning '' on no match —
behavior-equivalent (their surrounding `try/catch` already falls back on a parse failure), verified by
their existing tests (guider.test.ts, designAdvisor.test.ts) plus the shared extractJson.test.ts.

`EngineerAI/EngineerAgentLoop.extractJson` was inspected and EXCLUDED — it already does a string-aware
balanced-brace scan (its `lastIndexOf` is only a truncated-output fallback), so it was never part of the
bug class. The class is now fully centralized on one shared, tested implementation — no naive
`lastIndexOf` JSON slice remains in the server.

## UPDATE (2026-07-05, session 01KDmsCZ): round-10 — sequential AI router accepted an EMPTY reply as success (#TBD)

New hunt area (AI routing / provider fallback / breaker). Shipped the HIGH finding:

- **HIGH — `AIRouter.execute()` (sequential FREE/PRO path) treated a 200-with-empty-content reply as
  success** (`src/server/AI/Router/AIRouter.ts`). Every provider returns `content: ''` on ordinary
  outcomes without throwing — Gemini SAFETY/RECITATION block, Vertex/Grok empty message, Anthropic
  thinking-only/tool-only reply, MAX_TOKENS-with-no-text. `execute()` had NO non-empty guard, so it
  returned the blank as success → the user got a BLANK reply, the lower-priority providers that could
  have answered were never tried, and `recordProviderLatency(..,false)` marked the breaker HEALTHY on a
  non-answer. The sibling paths already guarded this (`routeRaced` race + last-resort: `if
  (!response.content?.trim()) throw`), so the sequential path — used by `route()` for all FREE/PRO chat —
  was the one isolated gap.

Root-cause fix (centralize the invariant per rule #2/#3): new shared `assertNonEmpty(response, name)`
helper; `execute()` now wraps `provider.execute(...)` in it (empty → throw → existing catch cools the
provider down and falls through to the next), and the two `routeRaced` inline guards were replaced with
the SAME helper so the invariant can't drift out of one path again. Locked with tests
(aiRouterEmptyReply.test.ts): sequential route() falls through an empty provider to the next; routeRaced
ignores an empty racer; all-empty → telemetry.success=false (graceful message, not a fake success).

DEFERRED (recorded from the same hunt):
- **MEDIUM — UniversalAIRouter 90s timeout doesn't abort the provider call** (UniversalAIRouter.ts:18-27).
  `Promise.race([route, timeout])` leaves the provider call running when the timeout wins; the bulkhead
  slot leaks and a late 200 still records success/latency (closes the breaker) for a discarded response.
  Fix needs an `AbortSignal` threaded through `AIProvider.execute` → every provider SDK call (cross-cutting
  interface change) — separate focused PR.
- **LOW-MEDIUM — execute() pass 2 re-runs providers that deterministically failed in pass 1**
  (AIRouter.ts). Pass 2 only guards `pass===1 && onCooldown`, so on a total-failure request every provider
  is re-invoked (2× latency/spend) even for a non-transient 400. Fix: track a per-request attempted set and
  skip it in pass 2 (only retry providers SKIPPED in pass 1). Clean next PR.
- **LOW (latent) — `AIRouterManager.slot()` drops the 5th `images` arg** — not currently reachable
  (UniversalAIRouter passes no images; EngineerAI uses raw registerProvider), fix defensively later.

## UPDATE (2026-07-05, session 01KDmsCZ): round-10 #2 — router pass 2 no longer re-runs an already-failed provider (#TBD)

The LOW-MEDIUM finding recorded in round-10, now fixed. `AIRouter.execute()` runs two passes: pass 1
skips providers on cooldown; pass 2 tries them anyway ("better than error"). But pass 2's only guard was
`pass===1 && onCooldown`, so on a total-failure request EVERY provider that failed in pass 1 was
re-invoked in pass 2 — a deterministic failure (e.g. a 400 on a malformed prompt) cost 2× latency + 2×
spend, and double-sent the request.

Root cause: pass 2 couldn't tell "skipped in pass 1 (cooldown)" from "already tried and failed in pass 1".
Fix: track a per-request `attempted` set (a provider is added the moment we commit to calling it, after
the slot is acquired) and `continue` past it in pass 2. So pass 2 now retries ONLY providers pass 1
skipped (cooldown / health / capacity), never one it already ran — while the legitimate cross-request
behavior (a cooled-down provider retried in pass 2 of a LATER request, and recovering) is unchanged.

Locked with a regression test (aiRouterEmptyReply.test.ts: two failing providers → each execute called
exactly once, not twice). Also updated the pre-existing AIRouter.test.ts case that previously asserted
the OLD double-call behavior (execute called 2× within one request) — it now encodes the corrected
contract: ONE call per provider per request, plus the preserved cross-request cooldown→pass2→recovery
path. (Corrected the test to the RIGHT behavior with reasoning — not changed to mask a regression.)

Round-10 remaining recorded (unchanged): MEDIUM UniversalAIRouter timeout doesn't abort the provider
call (needs an AbortSignal threaded through the provider interface — cross-cutting, separate PR); LOW
latent AIRouterManager.slot() drops the images arg.

## 2026-07-05 — v3.0 WINDOW SEMANTICS (round 2, IMG_5715): tab-switch can never blank the chat again + "Transcript lost" misbranding fixed (PR #973)

Admin retest after #963: build running → opened Free chat mid-build → returned to v3.0 → BLANK page/new
chat; History-open of the same-hour chat 404'd and permanently branded it "Transcript lost (old bug)".

ROOT CAUSE 1 (blank page): #963's keep-alive was RUNNING-gated — an unmount race. With another tab
active, the moment the build finished (or a stream blip flipped running→false) the surface UNMOUNTED in
the background and the chat state evaporated; returning bumped v3OpenNonce → startNewSession() → blank.
FIX: window semantics — ProV3Surface stays mounted while the v3.0 tab is OPEN in the tab bar (openTabs);
10+ tabs open, v3.0 keeps living. Unmounts only on explicit tab close (never mid-build).
shouldRenderV3Surface(activeView, running, v3TabOpen); App.tsx passes openTabs.includes('nbi_pro_chat').

ROOT CAUSE 2 (Transcript lost): openConversation treated a single transcript 404 as PROOF of the
pre-rebuild destroyed-transcript class and durably wrote deadTranscript:true — even for a chat whose
build was STILL RUNNING. FIX: new pure historyOpenPolicy.historyOpen404Action — running → 'resume-live'
(adopt session + re-attach); younger than 24h → 'not-saved-yet' (honest transient message, NO branding);
only old+idle → 'brand-dead' (unchanged). Panel probes /api/agentv3/status first. +11 tests total.

Gate: frontend tsc 0, server tsc 0, vitest 4762/4762 PASS, frontend+server build PASS.

## UPDATE (2026-07-05, session 01KDmsCZ): round-11 — unguarded JSON.parse crash-loop in always-mounted state initializers (#TBD)

New hunt area (React frontend state/effects). Shipped the HIGH finding — it directly protects the #1
absolute rule (the app must never break):

- **HIGH — unguarded `JSON.parse(localStorage.getItem(...))` in top-level `useState` initializers** of
  ALWAYS-MOUNTED components. `App.tsx` (referralHistory, githubRepoContext, keys, appSecrets) and
  `useSettings.ts` (enabledModules) parsed stored JSON with no try/catch. If any of those keys holds a
  corrupt value (truncated write, older-build format, cross-tab/extension tampering, manual edit), the
  parse throws DURING RENDER → the root ErrorBoundary shows "Reload App" → reload re-runs the same
  initializer → the same throw → an UNRECOVERABLE app-wide crash loop whose own recovery button can't
  escape it (the poison value persists). Five sibling reads in the same file were already guarded — proof
  it was an oversight.

Root-cause fix (centralize the class): new `src/lib/safeLocalJson(key, fallback)` — reads + parses
localStorage, never throws, returns the fallback on absent/empty/corrupt (self-heals). Routed all five
always-mounted sites through it. Locked with tests (safeLocalJson.test.ts: valid parse, missing key,
CORRUPT value → fallback not throw, empty string, localStorage-undefined).

DEFERRED — the SAME class in LAZILY-mounted IDE panels (per-panel crash on open, not app-wide, so lower
severity): unguarded `JSON.parse(localStorage…)` still in SDAChat, DatabaseSettings, HistoryView,
LocalizationManager, AIDebugger, AIImageGenerator, CodeVersioning, AppAnalytics, PerformanceAnalyzer,
TeamCollaboration, FigmaImporter, AppStorePublisher, GitPanel, CustomDomain, CodeMinifier,
ScreenshotToCode, APITester, defaultContent. The helper now exists — a follow-up sweep routes them all
through `safeLocalJson` (mechanical, but many files → separate focused PR). (Many other sites are already
try/catch-guarded and need no change.)

NEXT (clinical safety — highest priority, from the SDA hunt, NOT yet fixed):
- **HIGH/CRITICAL — SDA cross-patient memory contamination.** `sda.ts:104` keys the clinical store on
  `sessionId || userId`, but `SDAChat.tsx` never sends a per-case `sessionId` and "New Case" resets only
  client state — so a doctor's Patient A context (demographics + red flags + last 20 turns) is injected
  into Patient B's workup under the same userId within the 24h TTL → wrong risk stratification/dosing,
  and SDA is told "Do NOT re-ask". Fix: client sends a per-case `sessionId` (useRef UUID) and rotates it
  in `startNewCase()`; server already prefers sessionId. THIS IS THE NEXT PR.
- **MEDIUM — SDA audit cross-check dropped on an "ok"-prefixed danger note.** `sda.ts:78`
  `/^ok\b/i.test(text)` discards a real warning like "OK, but the dose is a 10× overdose…". Fix: only
  treat an EXACT `OK`/`OK.`/`OK!` (trimmed) as clean.

## UPDATE (2026-07-05, session 01KDmsCZ): round-11 #2 — SDA clinical-safety: cross-patient contamination + audit "OK"-prefix drop (#TBD)

Two clinical-safety fixes from the SDA hunt (highest priority — Doctor AI patient safety):

- **HIGH/CRITICAL — cross-patient memory contamination.** Doctor AI's server clinical store keys on
  `sessionId || userId` (sda.ts:104), but `SDAChat.tsx` sent only `userId` and never a per-case
  `sessionId`, and "New Case" reset only client state. So within the 24h TTL, one doctor's Patient A
  context (demographics + red-flags + last 20 turns) was injected into Patient B's workup as
  `[CASE_CONTEXT] … Do NOT re-ask` → wrong risk stratification / drug cautions / age-weight dosing, on the
  most ordinary multi-patient workflow. Fix (client): a per-CASE `sessionId` — `newSdaCaseId()` (shared
  `src/lib/sdaCaseId.ts`, crypto.randomUUID + fallback), persisted to `sda_case_id` so a mid-case reload
  keeps the SAME case, and ROTATED in `startNewCase()` so a new patient starts from an empty server
  store. Sent in the `/api/sda-chat` body; the server already prefers `sessionId`, so cases isolate
  immediately (old ids GC at 24h).
- **MEDIUM — audit safety cross-check dropped on an "OK"-prefixed danger note.** `auditSdaReply` used
  `/^ok\b/i.test(text)` to detect a clean pass, which ALSO matched a real warning like "OK, but the dose
  is a 10x overdose…" → the "⚠️ Automated safety cross-check" block was silently suppressed. Fix: new
  pure `src/server/lib/clinical/auditGate.ts` `isAuditReplyClean()` — clean ONLY on an exact OK/OK./OK!
  (trimmed) or empty; any warning that merely starts with "OK" is now surfaced.

Locked with tests (sdaClinicalSafety.test.ts): newSdaCaseId never collides across 2000 calls (rotation
always yields a new server key); isAuditReplyClean drops exact OK, keeps every "OK, but…"/warning.

Remaining recorded (unchanged): lazily-mounted IDE-panel unguarded JSON.parse sweep; router
AbortSignal-on-timeout (MEDIUM); wallet-credit concurrency (HIGH, live-money, needs your sign-off).

## 2026-07-05 — v3.0 STICKY SESSION (admin rule, PR #976): chat survives reload/phone-off; ends ONLY via +New chat / history-open / tab ✕

ADMIN RULE CHANGE (explicit): the 2026-07-01 "always start a brand-new chat on open" rule is RETIRED by
the admin (it existed for a once-stuck chat; "ab sab theek hai, is rule ki need nahi hai"). New standing
rule: the v3.0 chat changes/closes ONLY via (1) ☰ +New chat, (2) ☰ opening another chat, (3) the header
tab ✕. Everything else — in-app tab switches, reload, phone off, browser killed — restores the SAME chat
where the user left it, and typing anything continues the engine.

CHANGES: NEW pure v3SessionContinuity.ts (sticky-session key single source of truth:
v3SessionStorageKey/readStickySession/clearStickySession; +5 tests). AgentV3Panel session init RESTORES
the sticky id (was: always mint fresh); the fresh-open-nonce→startNewSession effect replaced by a SILENT
sticky-restore (openConversation(id,{silent:true})) — repaints the saved thread, re-attaches a
still-running build (resume-live), and a brand-new session quietly stays blank (no error, and the auto
path can NEVER brand "Transcript lost"). App.closeTab('nbi_pro_chat') clears the sticky session; a
running build keeps running server-side and lands in ☰ History with all its build files.

DEPLOY-VERIFICATION NOTE (admin's "#973 still dead" report): IMG_5715's header shows build stamp
b:07-05 07:51 — BEFORE #973's merge (08:56 UTC), so that test provably ran on a pre-#973 bundle. Live
site unreachable from this sandbox (network policy) — the admin's check is the b: stamp in the v3.0
header; if it stays old after a deploy, hard-refresh / clear the PWA cache.

Gate: frontend tsc 0, server tsc 0, vitest 4773/4773 PASS, frontend+server build PASS.
## UPDATE (2026-07-05, session 01KDmsCZ): round-11 #3 — crash-resilience class CLOSED (CustomDomain unguarded parse)

Followed up the round-11 "lazily-mounted IDE panel" deferral by actually auditing each site — and the
deferral was OVER-INCLUSIVE: the broad grep matched many sites that are ALREADY try/catch-guarded
(FigmaImporter, CodeMinifier, AIDebugger, ScreenshotToCode, APITester, defaultContent, HistoryView,
DatabaseSettings, AIImageGenerator, CodeVersioning, TeamCollaboration, AppStorePublisher, GitPanel,
LocalizationManager, AppAnalytics, PerformanceAnalyzer — all guarded). The codebase is disciplined here;
the only genuinely-unguarded render-path sites were the 5 always-mounted App.tsx/useSettings ones already
fixed in #974.

The ONE remaining genuinely-unguarded component was **CustomDomain.tsx**: a mount `useEffect` (line ~223)
did `JSON.parse(localStorage.getItem('navbharatai_custom_domains'))` with NO try/catch → a corrupt value
crashes that panel on open. Fixed all three of its localStorage-JSON reads (mount effect, saveDomain,
checkDns) to route through the tested `safeLocalJson` helper. No raw `JSON.parse` of localStorage remains
in that component. Behavior-preserving on valid data (locked by safeLocalJson.test.ts). The unguarded
localStorage-JSON crash class is now CLOSED across the app (no known unguarded render-path site remains).

## UPDATE (2026-07-05, session 01KDmsCZ): round-12 — Firebase deploy channel id dropped the session → cross-project overwrite (#TBD)

New hunt area (deploy / workspace-file / git / preview). Shipped the HIGH finding:

- **HIGH — every project a user deploys overwrote their previous live app at one shared URL.**
  `Deployment.makeChannelId` derived the Firebase Hosting channel from `workspaceId.replace(...).slice(0, 30)`.
  `workspaceId = agentv3-{uid}-{sessionId}`, and `"agentv3-"` (8) + a 28-char Firebase uid already fills
  30 chars — so the sessionId was DROPPED and `agentv3-<uid>-sessionA` / `…-sessionB` produced the SAME
  channel id. The channel is meant to be per-workspace (URL `…--v3-<workspaceId>.web.app`) but was
  effectively per-user: deploy App A → live at URL X; later deploy App B → same channel → App B published
  over App A at the same version/URL, silently destroying the first, while the returned "success" URL
  looks distinct (violates no-fake-success). Deterministic for any 28-char uid.
  Root-cause fix: derive from the FULL workspaceId — a readable prefix + a sha256 hash suffix
  (`v3-${safe.slice(0,17)}-${hash12}`, ≤33 chars, [a-z0-9-]) so each workspace's channel is unique AND
  stable (same workspace → same channel on redeploy; takedown at Deployment.ts:105 uses the same
  derivation so it stays consistent). Locked with tests (Deployment.test.ts): two workspaces sharing a
  28-char-uid prefix but different sessionId → DIFFERENT channels; same workspace → same channel.

DEFERRED (recorded — same class, LATENT, not the confirmed deterministic bug):
- Vercel `vercelProjectName` / Cloudflare `cloudflareProjectName` / Netlify `netlifySiteName` all use the
  same prefix-truncation (`slice(0,52)`); 52 chars usually reaches into the sessionId so they "usually
  survive", but a long uid+session can still collide. Same fix (hash suffix over the full workspaceId);
  each has an exact-output test that must move from asserting the literal string to asserting the
  invariant (prefix-sharing ids differ + charset/length) — a focused follow-up in these 3 providers.
- LATENT: EngineerAI/DeploymentService.makeChannelId has the identical slice(0,30) bug, but
  registerEngineerRoutes is commented out (server.ts:491) → dead code, not a live bug.
- LOW: WorkspaceFileStore.fileDocId base64url.slice(0,1500) can collide for >1125-byte paths (pathological).
- LOW/MED: Vercel/Firebase return a success URL before confirming READY (PostDeployLiveness exists — verify
  it's wired into both return paths).

## 2026-07-05 — v3.0 FULL AUDIT (admin mandate: "smooth aur powerful banao") — 30-gap ledger + Batch 1 shipped (PR #979)

Three parallel deep audits (UI/UX, client background, backend engine) against world-class app-builder
standards (Lovable/v0/Bolt/Cursor). THE ROADMAP (fix one by one, highest leverage first; ✅ = done):

CLIENT BACKGROUND (useAgentV3Build/panel effects):
✅ B1. Stall watchdog ~2min-slow (100s+30s tick) → now 35s stall + 10s tick (~4× faster auto-reconnect).
✅ B2. subscribeLive fixed 3s poll forever → exponential backoff 3s→30s, winds down on any non-running.
✅ B3. No fetch timeouts (hung mobile request stalls recovery itself) → AbortSignal.timeout on probes/poll.
✅ B4. Watchdog/drop-recovery probes account-wide (could re-attach the WRONG session's build) → scoped to
   workspaceIdRef (buildRunningHere) end-to-end, resume too.
B5. Panel history arrays unbounded in long sessions (agentHistory/checkpointHistory; convo re-sorts every
   render) → cap + memoize. [M]
B6. subscribeLive re-arms from seq 0 on every visibilitychange; never pauses on hidden. [M]
B7. ✅ DONE (Batch 6) No beforeunload guard / composer draft not persisted (typing lost on reload). [S]
B8. ✅ DONE (Batch 5) No SW-update "reload for new version" prompt (the stale-bundle class the admin hit). [M]
B9. Two hand-rolled NDJSON readers + two authJsonHeaders (drift risk) → unify. [M]
B10. checkRunning/checkpoints effects over-fetch on routine UI changes → debounce. [S]

UI/UX (AgentV3Panel/PreviewSurface):
U1. ✅ DONE (Batch 4) Preview never auto-refreshes on file_changed/diff events (stale until manual ↻) — HIGH. [M]
U2. ✅ DONE (Batch 4) Mobile: opening preview hides chat + progress entirely (hidden sm:flex) — HIGH. [M]
✅ U3. Error banners dead-end — add Retry + "Fix with AI" buttons (pattern exists in PreviewSurface). [S]
U4. No live token/cost ticker during build (billing only at done). [M]
✅ U5. Preview collapsed by default; never auto-opens when the preview URL arrives. [S]
U6. No overall build stage/progress arc (only current action + elapsed). [M]
✅ U7. Composer: no ⏎/⇧⏎ hint, no Cmd+Enter / Esc-stop shortcuts. [S]
U8. Toolbar clutter: 4 report buttons bury Preview/Deploy CTAs → collapse into one Diagnostics menu. [S]
U9. Diff tab is a flat colored dump → per-file collapse + add/del badges. [M]
U10. Three "history" concepts collide (☰ chats / History tab / Report history) + bare spinners. [M]

BACKEND ENGINE (routes/agentv3, AgentRunner, ToolDispatcher, E2BActuator):
E1. Readiness gate re-scans the whole project serially at build END (up to ~45s dead wall-clock) →
   incremental per-write analysis + cheap end delta. [L]
E2. ✅ DONE (Batch 3) write_files_batch writes files SERIALLY (N × E2B round-trips) → bounded-concurrency like fastWrite. [M]
E3. Empty-build fallback = full Sonnet rebuild (escalation repair path dormant by default) → targeted
   repair on existing files / default escalation on. [M]
E4. ✅ DONE (Batch 3) No per-turn/per-tool timeout budget (one hung provider call blocks the build until the 30-min
   watchdog) → withTimeout per turn + per-tool budget. [M]
E5. Post-build verification (gate → heal loop → reviewer) fully serial inside the deadline → parallelize
   gate+reviewer, hard-budget the heal pass. [M]
E6. Dev-server boot loop re-pays full setup every `npm run dev` (staleness check+prekill+wait+recovery)
   → cache "healthy on bound port" per workspace. [M]
E7. No file-content streaming to the UI while writing (create emits no diff event). [M]
E8. Cold start: first model turn blocked behind Sandbox.create (up to 45s) + git hydrate → pre-warm pool
   / parallelize planning with sandbox create. [L]
E9. No build queue/fairness (second build 409s; no global Sandbox.create cap). [M]
E10. Synchronous per-write review+impact on the hot path → defer off the tool_result path. [S]

BATCH 1 SHIPPED (PR #979): B1-B4 — the "frozen spinner" and background-cost class. Gate: frontend
tsc 0, server tsc 0, vitest 4778/4778 PASS, build PASS. Next batches: U3+U5+U7 (UI quick wins), then
E2+E4 (backend speed/reliability), then the rest per this ledger.

## 2026-07-05 — v3.0 audit Batch 2 (UI quick wins): no dead-end errors + auto-open preview + composer shortcuts

Ships U3, U5, U7 from the 30-gap audit ledger (all in AgentV3Panel.tsx):
- ✅ U3: the red error banner AND the amber failure-summary banner now show a "✨ Fix with AI" button
  (when not running) — prefills the composer with a targeted repair instruction, brings the chat into
  view, and focuses it (no surprise auto-spend). New `fixWithAI()` helper mirrors the sidebar prefill.
- ✅ U5: the Preview surface AUTO-OPENS the first time a build emits a live preview URL (once, via a
  ref, desktop-only split view — mobile keeps chat+progress visible per gap U2). The payoff moment
  (seeing the app) is no longer hidden behind a tap.
- ✅ U7: composer shortcuts — Cmd/Ctrl+Enter ALWAYS sends (even on touch / expanded editor), Esc stops
  a running build. Plain-Enter-sends-on-laptop behaviour unchanged.

UI-only (JSX + handlers); no new pure logic to unit-test. Gate: frontend tsc 0, server tsc 0,
vitest 4780/4780 PASS, frontend+server build PASS. Ledger updated (U3/U5/U7 → ✅).

## 2026-07-05 — v3.0 audit Batch 3 (backend speed): parallel batch writes (E2)

Ships E2 from the 30-gap audit ledger (ToolDispatcher.ts `write_files_batch`):
- ✅ E2: `write_files_batch` no longer writes files SERIALLY. The old loop paid 2 remote round-trips
  PER file (create-vs-modify probe + write) — ~6-12s of dead wall-clock for a 20-file batch, the single
  biggest "why is v3.0 slow" on a large build. Now writes run in BOUNDED PARALLEL (limit 6, mirroring
  the route's `fastWrite` → `mapWithConcurrency(files, 6, …)`).
  - Correctness (root-cause safe): writes to DISTINCT paths are order-independent — the final sandbox
    state is identical regardless of write order — and each file's create-vs-modify verdict depends only
    on whether it pre-existed the batch, not on its siblings. `mapWithConcurrency` is order-preserving,
    so the result summary + FULL-REWRITE warning stay in topo order. JS is single-threaded, so the
    in-worker hooks (`onFileWrite` / `recordFileChange` / `indexFile` / `addFile`) never interleave
    mid-statement. `recordFileChange` is keyed by path in a Map, so cross-file completion order can't
    corrupt final state.
  - Hunted the sibling race: duplicate paths within one batch now collapse to their LAST entry
    (last-write-wins — the serial loop's exact final state) BEFORE the parallel writers run, so two
    workers can never race two writes on the same path (which would leave nondeterministic content).
  - Regression tests locked it (ToolDispatcher.test.ts): a 25-file batch lands every file with exact
    content and records 25 distinct changes; a duplicated path deterministically resolves to the last
    write and is recorded once. Existing create/modify-honesty + FULL-REWRITE-warning tests unchanged.

Gate: frontend tsc 0, server tsc 0, vitest 4782/4782 PASS, boot:check PASS. Ledger: E2 → ✅.
Next in Batch 3: E4 (per-turn/per-tool timeout budget in AgentRunner) — one hung provider call should
not block the build until the 30-min watchdog.
## UPDATE (2026-07-05, session 01KDmsCZ): round-13 — wallet-credit concurrency race FIXED (admin-approved, live money)

The HIGH deferred finding (billing hunter Finding 1), admin-approved for a careful transaction refactor.
`verifyPaymentInternal` (payments.ts) credited the wallet with a getDoc → compute → full-document setDoc
OUTSIDE any transaction. The per-order PENDING→SUCCESS claim (H1) guarantees only one caller credits PER
ORDER, but two DIFFERENT concurrent credits to the SAME wallet — two orders for one user, the Cashfree
webhook + the client /verify-payment poll, or a concurrent coupon/admin write — each read the same stale
balance and the full-doc setDoc clobbered the other → a user's paid ₹/tokens silently dropped (lost
update), or a concurrent write reverted.

Root-cause fix:
- Extracted the credit math into a PURE, tested `computeCreditedWallet(current, txData, promo, now)` —
  every field is `(current) + delta`, so applying it to a re-read wallet ACCUMULATES.
- The credit now runs INSIDE `runTransaction`: it re-reads the wallet + pending promo in-transaction
  (all reads before writes), computes via the pure fn, and `tx.set`s. Firestore aborts+retries on a
  concurrent commit, so each credit re-reads the latest balance and adds on top — never overwrites.
  Promo consumption (`status: 'USED'`) now happens atomically in the SAME transaction (was a separate
  updateDoc). SECURITY C4 preserved: tokens still derive from the VERIFIED paid amount.

Locked with tests (walletCredit.test.ts): standard / vishwakarma+pass / promo credit math, field
preservation (full merge, not reset), NaN-safety, and the KEY concurrency property — crediting the
RESULT of a prior credit accumulates (tokenBalance 10000→20000, balance 100→200, 2 ledger entries), which
is exactly what the transaction does on a retry.

HONEST NOTE (real Firestore not in CI): the accumulation LOGIC is unit-tested; Firestore's actual
abort-on-conflict + retry is a documented Firestore guarantee that can't be exercised in CI. The fix is
strictly safer than the old full-overwrite. Same-class sibling — the COUPON credit (payment.ts
getDoc→updateDoc) — is the same race and still open; recorded for a follow-up (awaiting admin: fix in a
separate PR).

## 2026-07-05 — v3.0 audit Batch 3 (backend reliability): per-turn + per-tool hard timeouts (E4)

Ships E4 from the 30-gap audit ledger (AgentRunner.ts).
- ✅ E4: a hung provider call could block the whole build INDEFINITELY. Root cause: the wall-clock
  watchdog is only checked BETWEEN turns, so a single `client.runTurn` that stalls (socket open, no
  bytes, no error) never returns control to the watchdog — the "one hung provider call blocks the
  build until the 30-min watchdog" report, except it was actually worse than 30 min (the watchdog
  never even ran). Same exposure for a stuck tool call (a hung sandbox command, a stalled
  provider-backed review).
  - Per-MODEL-turn cap: `client.runTurn` is now wrapped in `withTimeout` (default 8 min, configurable
    via `turnTimeoutMs`, 0 disables). On timeout the build stops HONESTLY respecting whatever was
    already built — exactly like the wall-clock watchdog: files written on prior turns → ok:true
    "saved, send another message to continue"; nothing built yet → ok:false "didn't respond, try
    again". A NON-timeout provider error keeps the existing propagate → outer-catch path unchanged.
  - Per-TOOL cap: every tool dispatch is wrapped in `withTimeout` (default 10 min, `toolTimeoutMs`).
    On timeout the tool returns an honest is_error result to the model (NEVER a throw) so the build
    survives and can route around the stuck step. The `task` sub-agent tool is EXEMPT — it runs a
    whole nested build bounded by its OWN runner watchdog/budget, so a cap here would wrongly kill a
    legitimate long sub-agent. (Sibling check: `task` is the only self-bounded long-runner in the
    dispatch path; bash/review/preview tools are all short and correctly capped.)
  - Defaults are active for every build with no route change needed (generous ceilings no legitimate
    turn/tool reaches); callers can tune via the two new options.
  - Regression tests (AgentRunner.test.ts, 4 new): a hung model turn with nothing built → ok:false and
    RETURNS (no hang); a hung model turn after a file was written → ok:true with the file preserved; a
    hung tool → honest is_error fed back and the loop reaches the next turn; the `task` tool is NOT
    capped (its sub-agent result flows through even when it finishes 4× past the tiny test cap).

Gate: frontend tsc 0, server tsc 0, vitest 4786/4786 PASS, boot:check PASS. Ledger: E4 → ✅.
Batch 3 (E2 + E4) complete. Next: Batch 4 — U1 (preview auto-refresh on file_changed/diff) +
U2 (mobile: keep progress strip visible when preview open).

## 2026-07-05 — v3.0 audit Batch 4 (UI HIGH gaps): live preview auto-refresh + mobile progress strip (U1 + U2)

Ships U1 and U2 from the 30-gap audit ledger.
- ✅ U1: the Preview surface never auto-refreshed — while a build wrote files, the open in-browser
  preview stayed stale until the user hit ↻ manually. Root cause: PreviewSurface only (re)loads on
  mount / mode / workspace change. Fix: AgentV3Panel derives a monotonic `filesVersion` (bumps on every
  file_changed / diff — the reducer hands `state.files` / `state.diffs` a fresh identity per event) and
  passes it as `reloadSignal`. PreviewSurface DEBOUNCES (900ms) so a 20-file batch triggers ONE reload
  after writes settle, not one per file; in-browser re-compiles, live re-connects the iframe. An
  `inFlight` guard stops a reload overlapping an in-flight compile (the slower response could otherwise
  clobber the newer one). The surface is mounted only on the Preview tab, so a hidden preview never
  wastes a compile. The reload decision is a pure, unit-tested helper (`previewAutoReload.ts`):
  skips the first observation (mount already loads) and any unchanged signal.
- ✅ U2: on a PHONE, opening the workspace hides the chat column (`hidden sm:flex`), so tapping Preview
  made the live build progress vanish entirely. Fix: a compact progress strip in the workspace header
  region — MOBILE ONLY (`sm:hidden`; desktop keeps the chat split with the full indicator) — rendering
  the SAME real `WorkingIndicator` (current action + elapsed + expandable real activity log) while a
  build runs. The user can now watch the preview AND the build at once on mobile.

Tests: previewAutoReload.test.ts (5 new) locks the trigger semantics (first-skip, reload-on-change,
no-reload-on-unchanged, per-mount independence). U2 is layout-only (a responsive `sm:hidden` strip
reusing an existing tested component).

Gate: frontend tsc 0, vitest 4797/4797 PASS, frontend+server build PASS. Ledger: U1 → ✅, U2 → ✅.
Next: Batch 5 — remaining ledger (B5-B10, U4/U6/U8-U10, E1/E3/E5-E10).
## UPDATE (2026-07-05, session 01KDmsCZ): billing policy change (admin-approved, aashishcpmt09) — per-tier markups

Admin redefined v3.0 build billing (the old flat "assume-Sonnet × 3.5 normal / Opus 5–20× power" was
replaced). New policy — the user NEVER sees which provider ran; billed by the ACTUAL model tier, always
against Claude rates:
- **CHEAP** (Haiku/GLM/Grok/Gemini/Vertex — anything below Sonnet) → **Sonnet-equivalent × 1.2**
- **SONNET** (Sonnet actually ran) → **Sonnet-equivalent × 3**
- **OPUS** (power mode, Opus 4.8 100%) → **REAL Opus cost × 2** — FLAT at every power level (mini/medium/max);
  the level only changes how many real tokens Opus spends, so the bill scales naturally.

Implemented in `pricing.ts`: NORMAL_MULTIPLIER 3.5→1.2, new SONNET_MULTIPLIER=3, new OPUS_MULTIPLIER=2
(replaces POWER_MULTIPLIER 2.5 + POWER_MULTIPLIERS 5/10/20; POWER_MULTIPLIER kept as a ×2 alias). New pure
`billedForTier(usage, 'cheap'|'sonnet'|'opus')`. `billedAmountUsd(usage, power)` maps Power OFF → cheap
(×1.2), any power level → opus (×2) — because the engine currently reports a power LEVEL, not per-model
token counts (Option A, admin-chosen). The per-model SONNET tier (×3) is wired via billedForTier() once
per-model token accounting lands (follow-up B). powerLevel.ts SPECS multipliers → 2 at every level.
Tests updated (pricing/powerLevel/AgentRunner budget-cap) + AppKnowledgeBase billing text corrected.

Margin stays structurally positive in every tier (billed ≥ real cost): cheap billed 1.2× Sonnet-equiv
while the real provider is far cheaper; Sonnet 3×; Opus 2× real. Normal-mode revenue drops vs the old
3.5× (admin's explicit intent — "3.5x bekar"); power revenue drops vs old 5–20× (admin: "power kam log
use karenge, flat 2×").

OPEN (needs admin decision — FLAGGED): the AgentV3Panel power buttons still render labels **"5× / 10× / 20×"**
(AgentV3Panel.tsx:1933-1935) which now MISLEAD (all bill flat 2×). Not changed here — it's a hot file
(other session active) AND the new label wording is a product/branding call. Awaiting admin: what should
the three Opus power levels be called? (No user is overcharged — the label oversells; billing is correctly 2×.)

DEFERRED (follow-up B): true per-model billing needs the engine to bucket tokens by model tier
(AgentRunner) so a mixed normal build (cheap-floor GLM/KIMI + a Sonnet final-fix) bills cheap tokens ×1.2
and Sonnet tokens ×3 exactly, instead of the whole normal build at ×1.2. Recorded; touches hot AgentRunner.

## 2026-07-05 — Own-repo working-branch storage (admin model, Slice 1 of 2) — no more mirror sprawl

Admin approved a coordinated GitHub flow: when a user imports a repo THEY OWN, edits should go to a
working branch INSIDE that real repo (main safe) and reach main only via a PR — instead of today's
separate per-session mirror repo (`app-<uid>-<session>`) that caused sprawl and left the real repo
disconnected from the edits. (Rejected on honest grounds: storing project files in NavBharatAI's
Firebase — breaks the per-user cost rule that git-native storage exists to avoid; and moving build
reports to GitHub — Firestore is the right home for that metadata.)

SLICE 1 (this PR, flag-gated OFF via AGENTV3_OWN_REPO_STORAGE):
- New pure `GitStorageTarget.ts`: `parseGitHubRepo`, `resolveStorageTarget` (own-repo vs mirror with
  ALL guardrails — feature enabled + real github repo + signed-in + owner===login + verified write),
  `WORK_BRANCH='navbharatai/work'`, `ownRepoStorageEnabled()`. Fully unit-tested (own-repo only when
  every guard holds; every miss → safe mirror).
- `UserGitHubClient.getRepoAccess(name)` — verifies push access + default branch (safe fallback on any
  API error). Tested.
- `GitRepoSync.hydrateFromRepo` gains optional `{ branch, fallbackBranch }` — clones the work branch
  (accumulated edits), else the base, else the default. Byte-identical to before when no branch given.
  Tested (order + backward-compat).
- Route wiring (agentv3.ts): for an owned imported repo → store on `navbharatai/work` in the REAL repo,
  push there (force is safe — single-writer branch, NEVER main), keep ONE work→base PR open, and NEVER
  auto-merge. main changes only when the USER merges → structurally nothing can break main.
- SAFETY: default OFF; only repos the user personally owns + has write to; main never auto-touched.

Gate: frontend tsc 0, server tsc 0, vitest 4718/4718 PASS, build PASS, boot PASS.

SLICE 2 (next): in-app "Ship to main" (merge on CI-green) + "Revert last merge" buttons — revert ships
in the SAME slice as any auto-merge so an undo always exists wherever a merge does. AppKnowledgeBase
entry lands with slice 2 (the user-facing buttons).
## 2026-07-05 — v3.0 audit Batch 5 (stale-bundle root cause): periodic SW update check (B8)

Ships B8 — and it is the ROOT CAUSE of the admin's real "#973 still dead / my changes don't show up".
- ✅ B8: the service worker was checked for a new version exactly ONCE, at page load (`reg.update()`
  in main.tsx). A tab left OPEN across a deploy therefore kept serving the STALE bundle indefinitely —
  and the sticky-session feature we shipped this same day (chat survives reload/phone-off) makes tabs
  stay open for a long time, so this stale-bundle case became the COMMON path, not the rare one. That
  is precisely what the admin hit on the #973 retest (build stamp proved the test ran on a pre-#973
  bundle). Fix: after registering, re-check for a new SW PERIODICALLY (every 60s) AND whenever the tab
  regains focus (phone back on / tab refocus), throttled by a pure `shouldCheckForUpdate(last, now)`
  helper so a burst of focus events can't hammer `reg.update()`. A found update → the SW's existing
  skipWaiting/activate → controllerchange → the existing reload-once — so a deploy is now picked up
  within ~a minute automatically, instead of "never until a manual hard-refresh".
  Tests: swUpdateCheck.test.ts (4) — throttle window, custom interval, refocus-burst suppression.
  Gate: frontend tsc 0, vitest 4801/4801 PASS, frontend+server build PASS. Ledger: B8 → ✅.

### Honest ledger corrections (redundant-work + no-sycophancy check, safeguard #6 / rule 3)
Auditing before building the next backend items, TWO ledger entries turned out to be already-fixed or
admin-gated — recording honestly instead of shipping a redundant or unilateral change:
- **E1 (readiness gate serial full re-scan → ~45s):** ALREADY substantially fixed by the prior P0-C
  audit work. `readEvalSnapshot()` and `seedGraphFromWorkspace()` in ToolDispatcher.ts already read the
  source tree in BOUNDED PARALLEL (12-way, 5s/file cap) and the graph is seeded incrementally as files
  are written (only unknown files re-read at the end). The 45s is a worst-case TIMEOUT, not the typical
  cost. An "incremental per-write + end-delta" rewrite would trade correctness (the gate judging the
  ACTUAL current sandbox state) for marginal speed over already-parallel reads — not worth the risk to
  rule 1. Marking E1 as effectively addressed; no redundant change shipped.
- **E3 (empty-build fallback = full rebuild → targeted repair / default escalation on):** the targeted
  REPAIR path already exists (escalation hands judge findings as an edit-existing-files repair task,
  never a rebuild — agentv3.ts ~4110). The remaining half of E3 is flipping `AGENTV3_ESCALATION` on by
  DEFAULT, which is a cost + model-routing behaviour change the design doc explicitly puts "behind the
  rollout flag" and CLAUDE.md requires ADMIN SIGN-OFF for. Not flipping it unilaterally (safeguard #3).
  → OPEN, awaiting admin decision: "turn v3.0 cost-ladder escalation on by default?" (makes every build
  cheap-first → gate → auto-repair/escalate; more reliable, slightly higher worst-case cost per build).

## 2026-07-05 — Own-repo storage Slice 2a: in-app "Ship to main" (merge on green CI)

Builds on Slice 1 (own-repo working-branch storage). Adds the user-facing action to merge the
`navbharatai/work` branch into the repo's default branch — from inside NavBharatAI.

- New wire event `own_repo` {owner, repo, workBranch, baseBranch} (client + server type unions),
  emitted when own-repo storage activates; reducer stores `state.ownRepo`. +reducer test.
- New `POST /api/agentv3/ship`: verifies the user's GitHub write access (their token = the authority,
  so only their own repo is reachable), then reuses the tested `mergeViaPullRequest` to open-or-reuse
  the work→default PR and merge ONLY on green/none CI. A red/pending PR is returned OPEN with an honest
  note — never force-merged. `main` changes ONLY here, on the user's explicit click.
- Hook `shipToMain()` + `ShipResult` type; AgentV3Panel shows a green "Ship to <main>" button above the
  composer whenever `state.ownRepo` is set (own-repo mode), rendering the honest result in-thread.
- AppKnowledgeBase: new `agentv3_ship_to_main` entry (own-repo edit → ship-on-green loop).

SAFETY: still flag-gated (AGENTV3_OWN_REPO_STORAGE) — the button only appears in own-repo mode, which
only activates when the flag is on. main is merged ONLY on green CI, ONLY on the user's click, ONLY on
their own repo. Reverting a shipped merge is available on GitHub's native PR "Revert" today; the in-app
Revert button is Slice 2b (next).

Gate: frontend tsc 0, server tsc 0, vitest 4815/4815 PASS, build PASS, boot PASS.

## 2026-07-05 — v3.0 audit Batch 6 (long-session robustness): composer draft persistence (B7)

Ships B7 — and it directly complements B8 (Batch 5).
- ✅ B7: the chat composer's unsent text was pure in-memory React state, so ANY reload wiped it —
  "typing lost on reload". This got MORE likely right after B8 (which now reloads promptly to pick up a
  deploy) and is always possible when a phone backgrounds the tab. Root-cause fix: persist the draft.
  A new pure, tested `composerDraft.ts` (saveDraft/loadDraft over a storage boundary, 20k cap,
  never-throws) backs it; AgentV3Panel hydrates `prompt` from the saved draft on mount
  (`useState(() => loadDraft())`) and re-saves on every keystroke (`useEffect … saveDraft(prompt)`).
  Sending sets `prompt=''`, which clears the stored draft too — so a sent message never lingers.
  DELIBERATELY did NOT add an intrusive `beforeunload` "are you sure?" dialog: with the draft persisted
  AND sticky sessions resuming the build, nothing is actually lost, so a confirm dialog would only
  annoy — fixing the real root cause (no persistence) is the honest move, not warning over the symptom.
  Tests: composerDraft.test.ts (6) — save/load round-trip, clear-on-empty, whitespace-as-empty, huge-
  paste cap, storage-unavailable no-throw.
  Gate: frontend tsc 0, vitest 4824/4824 PASS, frontend+server build PASS. Ledger: B7 → ✅.

Remaining ledger after Batch 6: B5, B6, B9, B10, U4, U6, U8, U9, U10, E5, E6, E7, E8, E9, E10
(E1 done, E3 open awaiting admin escalation-default decision).

## 2026-07-05 — Own-repo storage Slice 2b: in-app "Revert last merge" (undo a shipped break)

Completes the admin's own-repo flow (edit → work branch → Ship → Revert). Adds the in-app undo so a
shipped change that breaks the app can be rolled back WITHOUT leaving NavBharatAI.

- New pure `planRevert(head)` (GitHubPrFlow.ts): a SINGLE-parent head (the shape a squash "Ship to
  main" produces) is auto-revertible → restore to its parent; a true (2-parent) merge or a root commit
  is refused honestly and the user is pointed at GitHub's Revert. Fully unit-tested.
- UserGitHubClient git-data methods: getBranchHeadCommit, getCommitTreeSha, createCommit, updateBranchRef
  (force:false — NEVER rewrites history). Tested (incl. asserting the ref update is non-forced).
- New `POST /api/agentv3/revert`: verify write access → read base head → planRevert → snapshot base back
  to the parent's tree as a NEW commit on top of head (non-destructive, itself revertible) → fast-forward
  the ref. Honest refusal when not auto-revertible or the branch moved.
- Hook `revertLastMerge()` + `RevertResult`; AgentV3Panel "Revert last" button beside "Ship" (with a
  confirm), honest result rendered in-thread.
- AppKnowledgeBase agentv3_ship_to_main updated: the in-app Revert now exists.

SAFETY: never a force-push (revert is a new commit, history preserved + itself undoable); only the
user's own repo (their token); only single-parent commits auto-revert (else honest refusal); flag-gated
via AGENTV3_OWN_REPO_STORAGE. The undo now lives exactly where the merge action does.

Gate: frontend tsc 0, server tsc 0, vitest 4826/4826 PASS, build PASS, boot PASS.

## UPDATE (2026-07-05, session 01KDmsCZ): billing follow-up — power-level NAMES + effort map (admin)

Admin finalized the v3.0 Power selector (billing itself unchanged from #985 — every Opus tier = real
Opus cost × 2). The three Opus levels are now NAMED (were "5× / 10× / 20×", which misread as price):
- mini  → **"Strong 💪"**        — Opus LOW effort
- medium→ **"Powerful Force"**    — Opus HIGH effort (was 'medium' effort → now 'high', per admin)
- max   → **"Full Team"**         — Opus ultracode (max effort)

Changes: AgentV3Panel power buttons relabeled + switched to a vertical list so the longer names fit; the
per-level hint text updated (Opus · low/high/ultracode effort). powerLevel.ts SPECS: medium effort
'medium' → 'high'. AppKnowledgeBase Power description reconciled to the new names + effort + "real Opus
× 2" billing. Tests updated (powerLevel). Full gate green (tsc ×2, vitest 4798, build, boot).
## 2026-07-05 — BUILD-REPORT AUTOPSY (rule 5): Mitrify import (agentv3-anon-d6a78356) — adaptive-thinking 400 root-caused

Admin sent a real v3.0 build-diagnostics report (import + survey of the "Mitrify" repo). Full forensic
autopsy per the fifth absolute rule. Report: model claude-haiku-4-5, ok:true (survey delivered), 69
events, 2 errors, 10 warnings, ~11.5 min wall-clock for a READ-ONLY survey.

### Step 1 — Itemized ledger (5 buckets)
❌ STILL BROKEN / delivered-imperfect:
- **[FIXED THIS PR] Hard 400 that killed the whole provider chain.** A Haiku build turn sent
  `thinking: { type: 'adaptive' }`; Anthropic rejected it: `400 invalid_request_error "adaptive
  thinking is not supported on this model"`. This burned GLM→GLM→KIMI→KIMI→CLAUDE→CLAUDE_HAIKU and
  raised BUILD_ERROR at minute 9. The build ONLY survived because escalation to claude-sonnet-4-6
  dodged it. Root cause: ClaudeClient.runTurn attached `thinking` (and, same class, `output_config.
  effort`) based only on whether the caller passed the flag — NOT on whether the model supports it.
- **[OPEN] Fake-ish completion summary.** For a read-only survey that changed NOTHING, the final line
  read "✅ Here's what I built: … 165 files, 44 components, 186 routes." "Here's what I *built*" +
  "186 routes" for a no-op survey misleads (honesty, rule 5). Recorded as an open root cause: the
  build-summary template must distinguish "surveyed/analyzed (no changes)" from "built".
- **[OPEN] Inconsistent file counts in one run:** "Imported 165 files" vs "Editing your existing app
  (317 files)" vs summary "165 files". Same run, three numbers — the count source isn't single.
🔀 WORKED AROUND (deferred root causes):
- The adaptive-thinking 400 → recovered via Sonnet escalation (the workaround; now the underlying bug
  is fixed so escalation is no longer load-bearing for this failure class).
- `read_file /home/user/workspace/README.md` (doesn't exist) → agent read other files. Minor.
- Live preview didn't boot (imported full-stack app needs DATABASE_URL/SESSION_SECRET/Firebase/Cashfree
  env + a real DB) → fell back to in-browser preview. Infra-gated; honest fallback message shown.
⏭️ SKIPPED: the `<<<EXISTING_FILES>>>` manifest included binary `attached_assets/*.png|jpeg` names —
  pure noise (never editable source), never filtered.
🥵 STRUGGLE: GLM timed out ~6× and KIMI ~2-3× (Request timed out; 61s and 100s latencies) on a prompt
  that grew 45KB → 93KB → 233KB → 250KB; ~11.5 min for a read-only survey.
✅ SELF-HEALED: none genuinely — the "recovery" was the escalation workaround above, not a self-heal.

Tally: 0 clean self-heals, 3 workarounds, 1 skip, 3 still-broken/imperfect (1 fixed here), struggled at
minutes 6–11 in the provider-scramble.

### Step 2 — Missing subsystems
(A) **Model-capability awareness for request params — FIXED THIS PR.** The #1 structural gap: the
    engine emitted model-specific params (adaptive thinking, effort) with no capability check, so a
    cheap/fallback tier turned every such turn into a fatal 400. Now gated by a single source of truth.
(B) **Prompt-size governance — OPEN.** No budget on the grounding manifest (binary assets included) or
    the accumulating read_file transcript (233KB), which is why the cheap floor (GLM/KIMI) timed out
    repeatedly and a read-only survey took ~11.5 min. Follow-up: filter binary/asset paths from
    `summarizeFileTree`, and compact/cap large read_file results in the transcript for cheap providers.

### Step 3 — Root-cause fix shipped (the ❌ error)
`modelSupportsAdaptiveThinking(model)` added to models.ts (single source of truth): Opus 4.x and
Sonnet 4.6+ → true; Haiku and unknown ids → false (DEFAULT-DENY — a missing thinking/effort param never
400s; an unsupported one is fatal). ClaudeClient.runTurn now gates BOTH `thinking` and
`output_config.effort` (sibling, rule 3) through it — one choke point covers the main build turn AND
the CLAUDE / CLAUDE_HAIKU fallback runners (all three are ClaudeClient instances; CLAUDE_HAIKU is a
forceModelRunner-wrapped ClaudeClient, so params.thinking flowed straight through). Regression tests:
ClaudeClient.test.ts (Haiku denies thinking+effort = the exact 400; Sonnet/Opus allow; unknown denies)
and models.test.ts (predicate matrix incl. Sonnet 4.5 vs 4.6 boundary). Honesty (rule 5): the failure
now can't happen, so the report will stop showing this class of BUILD_ERROR.

Gate: server tsc 0, frontend tsc 0, vitest 4833/4833 PASS, boot:check PASS.

### Step 4 — Open root causes recorded (rule 6, awaiting follow-up autopsy)
1. Fake-ish "Here's what I built" summary for read-only/survey runs → make the summary honest about
   analyze-vs-build.  2. Single source for file counts (165 vs 317 vs 165).  3. Prompt-size governance
   (missing subsystem B): filter binary assets from the manifest + compact large transcript reads for
   the cheap floor so GLM/KIMI stop timing out.

## 2026-07-05 — Autopsy follow-up 1/3: honest build summary (analyzed vs edited vs built)

Open root cause #1 from the Mitrify-import autopsy, admin-ordered ("fix the honesty summary next").
- ❌→✅ The recap for a READ-ONLY import+survey run said "✅ Here's what I built: … 165 files, 186
  routes" — claiming authorship of an app the AI never touched (fake-completion wording; violates the
  no-fake-success rule even though the data was real). Root cause: summarizeProject had exactly ONE
  header for every successful run; the route never told it whether this run actually changed anything.
- Fix (root-cause, pure + tested): summarizeProject now takes `changedFiles` (how many files THIS run
  created/modified) + `editMode` (existing app vs fresh build):
  · changed=0 → "🔍 I analyzed your project — no files were changed. Overview:" (counts framed
    "Project: …", describing the EXISTING app, not this run's output)
  · changed>0 && editMode → "✅ Done — I changed N file(s) in your project. Overview:"
  · fresh build / untracked caller → today's "✅ Here's what I built:" (backward-compatible).
  Classification comes from `editMode` (route's real `isEditMode`), NOT a changed-vs-total size compare
  — a fresh build's graph holds scaffold files the AI didn't write, so sizes can't be trusted (test
  encodes this exact trap). Call site passes `writtenFiles.size` — dispatcher writes only, imports
  EXCLUDED by construction (import writes via writeWorkspaceFiles, never the onFileWrite hook), so an
  import+survey correctly reads as 0 changes.
- Tests: ProjectSummary.test.ts +5 (analyzed / edited / singular / fresh-build-with-scaffold trap /
  backward-compat). Gate: server tsc 0, frontend tsc 0, vitest 4845/4845 PASS, boot:check PASS.
- Remaining autopsy follow-ups (open): #2 single source for file counts (165 vs 317), #3 prompt-size
  governance (binary assets in manifest + transcript compaction for the cheap floor).

## 2026-07-05 — Autopsy follow-up 3 (slice 1): binary assets excluded from the edit-mode manifest

Prompt-size governance, first slice (the Mitrify autopsy's "missing subsystem B").
- ⏭️→✅ The `<<<EXISTING_FILES>>>` manifest injected EVERY imported path into EVERY turn — including
  ~150 `attached_assets/IMG_*.png|jpeg` names the model can never text-edit. Pure token noise that
  helped bloat real prompts (45KB→233KB) until the cheap floor (GLM/KIMI) timed out ~8×.
- Fix (pure, summarizeFileTree): a BINARY_ASSET_RE (images/fonts/media/archives/design binaries —
  `.svg` deliberately KEPT, it's editable text) filters the listing BEFORE the small-vs-large
  threshold, so (a) small-project flat lists carry only editable files, (b) binaries can't force a
  small app into summary mode, (c) directory counts reflect editable files. One honest note line
  ("+N binary asset files … omitted; they exist but are not text-editable") keeps the agent aware —
  it must never conclude "this project has no images".
- Tests: systemPrompt.test.ts +5 (filtering, .svg kept, threshold not distorted by images,
  large-project note, assets-only tree degrades to the note). Existing 26 unchanged.
- Gate: server tsc 0, frontend tsc 0, vitest 4850/4850 PASS, boot:check PASS.
- REMAINING for follow-up 3 (recorded, not silently dropped): transcript compaction / read_file
  result capping for the cheap floor — the other half of the 233KB growth (bigger change, own PR).
  Follow-up 2 (single source for file counts) also still open.

## 2026-07-05 — P1 (admin-approved): large existing projects build DIRECTLY on Sonnet, cheap floor bypassed

Admin decision ("badi apps, direct sonnet par edit karwao — badi apps only"), grounded in the Mitrify
autopsy: the analyser tiers by the PROMPT ("survey my app" → haiku) while the CONTEXT was a 317-file
import → the cheap floor (GLM/KIMI) timed out 8× on the bloated prompt and every turn fell to Claude
anyway — minutes of silent waste, then the strong model did the work regardless.
- New pure `isLargeExistingProject(fileCount)` — default threshold 100 files, env-tunable via
  AGENTV3_LARGE_PROJECT_FILES. Mitrify-scale (300+) → large; fresh v3.0 apps (15-60) → not.
- `selectBuildModel(tier, powerOn, largeProject)` — largeProject → Sonnet directly (power still wins
  → Opus; largeProject=false → byte-identical routing to before).
- Cheap floor: `allowCheapFloor` now ANDs `!largeProject` — GLM/KIMI never lead a big-app turn.
- The edit-mode file listing is HOISTED before model selection and REUSED for the edit prefix — no
  extra sandbox roundtrip (still exactly one listFiles per edit build).
- Honest narration when it fires: "🏗️ Large project (N files) — running directly on the strong model
  for reliability."
- Tests: agentv3.test.ts +6 (large overrides haiku/gemini/undefined; power beats large; backward
  compat; threshold boundary 99/100/0; env tune). Gate: server tsc 0, frontend tsc 0, vitest
  4856/4856 PASS, boot:check PASS.
- NOTE (billing, recorded): normal-mode billing currently maps to the cheap ×1.2 tier regardless of
  which model ran (per-model token accounting is the already-recorded follow-up B from the #985
  policy). Large-project Sonnet runs bill ×1.2 until follow-up B lands — margin is still positive,
  and the admin explicitly chose reliability here.
## 2026-07-05 — P3.1 App.tsx split #1: extract usePaymentEngine (behavior-preserving)

Roadmap P3.1 (deferred God-component split) resumed as a SERIES of behavior-preserving extractions —
never one high-risk mega-PR on a live payments app. Slice #1 = the wallet/billing/credits/referral
concern, the structurally SAFEST first slice (per structural analysis it has the fewest outbound deps:
nothing payment-owned flows into the build/preview/chat pipeline, so lifting it out cannot change build
behavior).

- New `src/hooks/usePaymentEngine.ts` — owns all payment state (wallet, dailyUsage/free-limit, referral,
  Vishwakarma, billing logs/transactions, coupons, reminder/budget limits) + the Cashfree URL-callback
  effect + every `/api/payment/*` + `/api/wallet/*` action (fetchWallet, createBillingOrder,
  createVishwakarmaOrder, verifyBillingPayment, redeemPromoCoupon, redeemVishwakarmaPromo). Code moved
  BYTE-IDENTICAL — pure relocation, zero logic change.
- `App.tsx` calls `usePaymentEngine({ user, addLog })` and destructures the SAME identifiers the 6k-line
  render tree already referenced, so all JSX is unchanged. Chose a HOOK (not a Context provider) on
  purpose: a provider would force restructuring the component tree (App both defines `user` and consumes
  `wallet` in one scope) → higher risk. The hook keeps everything in App's scope; the two coupling points
  the analysis flagged (`closeTab` + Esc-handler read payment modal flags) keep working via destructure.
- `authedHeaders` exported from App.tsx so the hook shares the exact same auth-header builder.
- App.tsx: 6,596 → 6,353 lines (−243 net; ~390 lines of logic relocated). Target is <1,500 across the
  remaining slices (usePreviewBundler → FilesProvider → PreviewProvider → useProBuild → ChatProvider).

Gate: frontend tsc 0, vitest 4832/4832 PASS, vite build PASS. No AppKnowledgeBase change (pure refactor,
no new user-facing surface).

## 2026-07-05 — P2 (admin: "retrieval world-class banao"): intent-aware grounding v2 — anchors + import-graph centrality + camelCase paths

Root cause of the Mitrify grounding failure (BackButton.tsx picked for a survey), found + killed:
- Candidates were selected by path-token overlap with the request. A survey/vague ask shares NO
  tokens with any filename → EVERY file ties at overlap 0 → sort keeps tree order → the first 14
  files ALPHABETICALLY became "the most relevant" (AIChat, BackButton, ChangeCredentialsDialog…).
- Sibling gap: `tokenize` kept PascalCase names as one opaque token — `CustomerHomePage.tsx` could
  NEVER match the request word "customer", so real page names never ranked even on targeted asks.

Retrieval v2 (ContextReranker.ts — pure, dependency-free, deterministic):
- `isOverviewRequest(prompt)` — survey/overview/architecture/explain/analyze + Hinglish (kya hai,
  samjhao, kaise kaam). Overview → filename matching is SKIPPED entirely (it is noise there).
- `structuralAnchors(tree)` — what a senior engineer opens first: package.json, README, entry
  (main/index), App, server index, routes, schema/prisma/drizzle, storage/db, framework config —
  priority-ordered, node_modules excluded, deterministic.
- `centralFiles(tree, graph.imports)` — import-graph in-degree (project-internal specifiers only,
  resolved by basename; components/ui/* excluded — a shadcn button is imported everywhere and
  grounds nothing). storage.ts/schema.ts surface even when their name echoes nothing in the ask.
- `selectGroundingCandidates` — overview → anchors + central (+content hits); targeted → content
  hits FIRST, then filename overlap ONLY where overlap>0 (the tie bug is structurally impossible
  now), then anchor/centrality backstops. Binary/non-groundable paths never candidates.
- `pathTokenize` — camelCase/PascalCase-aware path matching (CustomerHomePage ↔ "customer").
- `buildGroundedContext(..., { preserveOrder })` — overview keeps anchor order and widens to top-5
  (BM25 re-rank is meaningless for a query that matches no content terms — a test proves BM25 would
  have picked the WRONG file there).
- Route: memory-warm MOVED BEFORE grounding so the freshly-imported project's import graph feeds
  centrality on the VERY FIRST turn (it previously warmed after grounding — one turn late).

Tests: ContextReranker.test.ts +18 (exact Mitrify survey prompt → package.json/routes/schema, never
BackButton; zero-overlap tie regression; content-hits-first; centrality ranking + ui-kit exclusion +
bare-import exclusion; anchors priority/determinism; overview intent EN+Hinglish; preserveOrder beats
BM25-noise; camelCase matching). Gate: server tsc 0, frontend tsc 0, vitest 4874/4874, boot PASS.

## 2026-07-05 — P3 slice 1 (admin: "env keys ka koi aur rasta dekho"): conjure the app's OWN local secrets

The Mitrify preview-boot post-mortem found the REAL boot-killer was not Cashfree/Firebase at all:
- ❌→✅ `buildDevEnvContent` gave SESSION_SECRET (and every non-DB var) an EMPTY placeholder — and
  express-session THROWS "secret option required" on '' — so the dev server died before it could
  listen. The missing third-party keys never even got a chance to matter.
- Fix (root-cause): new pure `conjurableSecrets(varNames, rand?)` — SELF-ISSUED secrets
  (SESSION_SECRET / JWT_* / COOKIE_SECRET / AUTH_SECRET / NEXTAUTH_SECRET / CSRF / TOKEN_SECRET /
  ENCRYPTION_KEY / SECRET_KEY(_BASE) / APP_SECRET / SIGNING_KEY) get REAL crypto-random values
  (48 hex chars; injectable rand for deterministic tests). These are the app's own signing secrets,
  not anyone's credentials — fully valid for a sandbox dev boot.
- DELIBERATE boundary (honesty): third-party-shaped keys (CASHFREE_*, FIREBASE_*, GOOGLE_*,
  STRIPE_*, *_API_KEY, DATABASE_URL) are NEVER conjured — a fake external key makes the app fire
  real requests with garbage credentials and fail in confusing ways; an empty value keeps those
  features cleanly inactive, and `externalServiceNote` still names them plainly (now WITHOUT listing
  the conjured secrets as "still needed" — they aren't).
- Route: `provided` = local-Postgres DATABASE_URL (existing) + conjured secrets → dev .env. A
  session+DB app (exactly Mitrify's shape) now has a real chance to boot its live preview.
- Tests: ImportPreview.test.ts +5 (conjured classes incl. SECRET_KEY_BASE; third-party keys NEVER
  conjured; injectable determinism; flow-through buildDevEnvContent with external keys still empty;
  externalSecretVars honesty). Gate: server tsc 0, frontend tsc 0, vitest 4879/4879, boot PASS.
- NEXT for P3 (recorded): Firebase Emulator Suite in the sandbox (auth/firestore without real keys)
  — the big unlock for Firebase-backed imports; larger slice, own PR.
## 2026-07-05 — P3.1 App.tsx split #2: extract usePreviewBundler (behavior-preserving)

Slice #2 of the P3.1 God-component split. Extracts the preview-build / client-side bundling concern into
`src/hooks/usePreviewBundler.ts` — the preview build-state (isPreviewBuilding / stage / error / detected
framework), the Problems-panel data, the preview history, and the four functions that turn the virtual
file set into a rendered preview: handleTriggerPreviewBuild, updatePreview (server esbuild for React/Vue
with client fallback; CSS/JS inlining for vanilla; universal viewer otherwise), handleFileChange
(debounced edit->rebuild) and runCode. Code moved BYTE-IDENTICAL (verified runCode line-for-line).

- Hook takes its cross-slice deps injected (files, setFiles, setGeneratedCode, activeFile, activeAgent,
  toggleTab, incrementDailyUsage, addLog, addToast) and returns the SAME identifiers the render tree
  referenced, so all JSX + the ~10 external updatePreview() call sites (chat/pro-build completion,
  version restore, workspace sync) are unchanged.
- Hook call placed right before closeTab so every dep is defined above it and closeTab can still reset
  preview state. tsc (0 errors) proves no used-before-declaration ordering break and no missing symbol.
- App.tsx: 6,353 -> ~6,095 lines (~275 lines of bundler logic relocated).

Gate: frontend tsc 0, vitest 4856/4856 PASS, vite build PASS. No AppKnowledgeBase change (pure refactor).

## 2026-07-05 — Concurrency FIX #1 (admin IMG_5718): "build already running" → Stop | Connect (loop killed)

Admin report: the account-lock error ("A build is still running… Press Stop… then send again") showed a
"Fix with AI" button. Clicking it SENDS A NEW MESSAGE → re-hits the same held lock → the same 409 → the
same error. Admin clicked it ~100 times; it can never work — "Fix with AI" cannot free a lock.

ROOT CAUSE: the generic error banner offered one action ("Fix with AI") for ALL errors, but a
"build already running" error is a LOCK, not a code defect. Its only real resolutions are STOP (free the
lock) or CONNECT (attach to the build that's actually running) — a retry is the exact wrong move.

FIX:
- New pure `isBuildBusyError(msg)` (agentV3StreamError.ts) — detects the account-lock error class
  (/a build is (already|still) running/i). +unit tests (exact client+server messages, non-matches, null).
- AgentV3Panel error banner: for a build-busy error it now renders "⏹ Stop | ▶ Connect" instead of
  "Fix with AI". Stop = free the lock (existing /stop) then send again; Connect = resume/attach the
  running build into this view (existing resumeBuild). Ordinary errors keep "Fix with AI".
- stop() now also clears `error`, so the banner can't linger and re-tempt the retry loop.

This is FIX #1 of the concurrency plan (admin-approved). Once per-workspace concurrency lands, this error
mostly disappears; until then Stop/Connect gives the user the ONLY two actions that actually work.
Gate: frontend tsc 0, vitest 4835/4835 PASS, build PASS.

Concurrency roadmap (admin-approved, for the record): #1 Stop|Connect (this) → #2 anon-key investigate
→ #3 durable per-app command QUEUE + single serial executor (Chat 1) → #4 Chat 2 = planner that enqueues
→ #5 Chat 3 = flexible read-only advisor (audit/test/research/explain) that enqueues → #6 queue UI +
snapshot reads. Model: 1 writer (executor) + N read-only advisors feeding one queue = safe concurrency.

## 2026-07-05 — A1 (autopsy #3 slice 2): model-side transcript compaction — the 233KB→timeout root cause

The remaining half of the Mitrify prompt-bloat: `compactMessagesForPersist` bounded the transcript for
STORAGE only; the LIVE `messages` sent to the model each turn were UNBOUNDED — every read_file/bash
result stayed verbatim, so reading a few large files (2500-line routes.ts) grew the per-turn prompt to
200KB+. The cheap floor (GLM/KIMI) then timed out on the payload (report: GLM 6×, KIMI 2×) and every
turn fell to Claude anyway.
- New pure `compactTranscriptForModel(messages, {keepRecentMessages, maxOldToolResultChars})` in
  SessionTimeline.ts: last N messages (default 6 ≈ 3 turns) sent VERBATIM (in-flight work untouched);
  OLDER large tool_result payloads head+tail trimmed (default 2000 chars) with an honest
  "call read_file again if you need the full content" note; old base64 screenshots → short note.
  NEVER drops a block (tool_use↔tool_result id pairing always preserved → API never rejects an orphan);
  never mutates `messages` (persistence + audit keep full fidelity — only the network payload shrinks);
  deterministic (a message truncates identically each turn → stable cache prefix); natural no-op on a
  small build.
- Wired in AgentRunner.run() right before client.runTurn — sends `modelMessages` (compacted copy), keeps
  the full `messages` for everything else. Env: AGENTV3_MODEL_COMPACT=off bypasses; KEEP_RECENT / MAX_CHARS
  tune the window.
- Tests: SessionTimeline.test.ts +6 (old-large trimmed + recent verbatim by reference; no orphaned tool
  ids; no-op + no-mutation on small builds; short results untouched; old screenshot → note; original user
  request never trimmed). Gate: server tsc 0, frontend tsc 0, vitest 4885/4885, boot PASS.
- Together with #995 (binary assets out of the manifest), the 233KB prompt class is now closed: big-app
  turns stay bounded → the cheap floor stops timing out and each turn is faster.
## 2026-07-05 — P3.1 App.tsx split #3: DELETE dead Pro v2.0 engine (~1,050 lines)

Biggest single reduction so far — and NOT an extraction: investigation (subagent dep-map + manual
trace) proved `handleSendForPro` (~1,020 lines) + `handleStopPro` were DEAD CODE — the retired Pro v2.0
engine, unreachable from any live UI path. Proof recorded:
- `handleStopPro` had ZERO callers; `handleSendForPro` was referenced only by its own self-recursion and
  by ONE branch inside `handleZipImport` gated on `extraMessage?.trim()`.
- All three LIVE callers of `handleZipImport` (file-drop / conflict-resolve, lines ~3981/4032/4034) pass
  NO extraMessage, so that branch never fires. The live Pro surface is the self-contained `ProV3Surface`
  (code comment: "replaces the retired Pro v2.0 builder"). Pro-state output (proMessages/proBuildProgress)
  is rendered by no live component.
Per rule 4 (root-cause) + P5.3 (delete throwaway) the right move was DELETE, not extract (moving dead
code is pointless; deleting is safer AND removes far more). Admin explicitly approved the deletion.

Removed: `handleSendForPro` + `handleStopPro`; the dead `if(extraMessage)` branch in the LIVE
`handleZipImport`; and every symbol used ONLY by those functions — 9 refs (proAbortControllerRef,
proLivePreviewUrlRef, proLiveScreenshotRef, lastBuildPromptRef, proAutoContinueRef, proGuiderSpecRef,
proGuiderRefineRef, providerRetryTimerRef, providerRetryPromptRef), 2 consts (PRO_MAX_AUTO_CONTINUE,
PRO_MAX_REFINE), 3 orphaned states (proGuiderPlan, proGuiderReplanning, providerRetryCountdown), and now-
unused imports (buildApp, buildAppStream, previewSrcFor, classifyBuildIntent, classifyAutoIntent,
extractCode). Each verified orphaned by whole-file grep BEFORE removal. LIVE handleZipImport + proMessages
(saved to sessions) untouched.

App.tsx: 6,096 -> 5,045 lines (-1,051). Running total: 6,596 -> 5,045 (~24% down; target ~2,000-2,500).
Gate: frontend tsc 0, vitest 4879/4879 PASS, vite build PASS.

## 2026-07-05 — A2 (autopsy #2): one honest project file-count (kills the 165-vs-317 contradiction)

The Mitrify run reported "📦 Imported 165 files" then "✏️ Editing your existing app (317 files)" for the
SAME project — two numbers that read as a bug. Root cause: the import banner counts durably-saved TEXT
files (assets excluded), while the edit banner used raw `listFiles().length` which INCLUDES the ~150
`attached_assets/*.png|jpeg` the agent can never edit. And the binary predicate was defined only inside
systemPrompt.ts, so nothing else could count consistently.
- New shared `fileClassification.ts` (single source of truth): `isBinaryAsset` / `isEditableSourceFile`
  / `countEditableSourceFiles`. systemPrompt.ts's manifest filter now imports `isBinaryAsset` (the
  duplicated BINARY_ASSET_RE removed — rule 2/3, one definition).
- Edit banner now says "N **source** files" via `countEditableSourceFiles(fileTree)` — binaries
  excluded, so it lands at ~165 (matching the import banner) instead of a contradictory 317.
- Tests: fileClassification.test.ts +7 incl. the exact Mitrify-shaped tree (165 source + 150 assets +
  2 docs = 317 total → count 167). systemPrompt's 31 tests unchanged (refactor is behaviour-preserving).
- Gate: server tsc 0, frontend tsc 0, vitest 4894/4894, boot PASS.

## 2026-07-05 — A3 / E6: reuse an already-healthy dev server instead of re-paying ~25s every `npm run dev`

The managed preview re-runs `npm run dev` on every update_preview; the WHOLE sequence (vite-config
patch → deps-stale check → pre-kill port → launch → 25s port-wait → recovery loop) re-ran even when a
healthy server was already bound on the port — pure wasted wall-clock on big/slow apps.
- New pure `shouldSkipDevServerLaunch(portAlreadyUp, depsStale)` (devServerHost.ts): skip ONLY when the
  port is verifiably UP AND deps are NOT stale. A running Vite/Next server already reflects file edits
  via HMR, so a relaunch is redundant; a changed package.json (stale) still needs reinstall+restart, so
  it correctly does NOT skip.
- E2BActuator: FAST PATH at the top of the npm-run-dev branch — a 2s port probe + deps-stale probe;
  when both good, return "already healthy on port N — reused it" immediately (skips ~25s+). Both are
  REAL sandbox probes (false up/fresh impossible); on ANY doubt it falls through to the full, proven
  sequence — never worse than today. AGENTV3_DEVSERVER_FASTPATH=off bypasses.
- Tests: devServerHost.test.ts +4 (the skip truth table). Gate: server tsc 0, frontend tsc 0, vitest
  4898/4898, boot PASS.
- NOTE: E5 (parallelize post-build gate+reviewer) deferred to the C3 backend batch — it touches the
  delicate readiness-gate/reviewer ordering and deserves its own careful PR; E6 ships as the clean win.

## 2026-07-05 — C1 (B6): live-poll pauses on hidden + resumes from last seq (no more re-download-from-0)

subscribeLive (the cross-device live mirror) had two real background-cost gaps beyond the earlier
backoff fix: (1) the visibility guard only stopped a poll from STARTING while hidden — a poll already
running when the tab was backgrounded kept hitting the network every few seconds; (2) every tab-focus
re-arm restarted from seq 0, re-downloading + re-applying the WHOLE event history.
- New pure `livePollPolicy.ts`: `nextLivePollDelayMs({hidden,hadActivity,current})` (hidden → max/
  near-pause; activity → fast; quiet → ×1.6 backoff) + `resumeSinceSeq(stored)`. Unit-tested.
- useAgentV3Build: a `liveSeqRef` (per-workspace last seq) so a re-arm RESUMES from it; the tick now
  SKIPS the fetch entirely while `document.hidden` (real pause, not just backoff) and reschedules at
  the max cadence — the next visible tick fetches from `sinceSeq`, so nothing is missed.
- Tests: livePollPolicy.test.ts +6. Gate: frontend tsc 0, vitest 4904/4904, build PASS.
- HONEST scope note: C1's other ledger items are recorded as lower-priority follow-ups — B5 (history
  array cap+memoize) and the convo re-sort live in the heavily-churned AgentV3Panel (high conflict
  risk right now); B10 (checkRunning/checkpoints debounce) is largely mitigated by the existing
  visibility-gated effects; B9 (unify the two NDJSON readers / authJsonHeaders) is a pure refactor
  with no user-visible defect. B6 was the genuine resilience win and shipped clean.

## 2026-07-05 — Concurrency FIX #2 (admin "anon" investigation): make the 'anon' fallback VISIBLE + harden verify

Admin confirmed they log in with REAL Firebase (aashishcpmt09@gmail.com / doc.asheesh@…), NOT the
synthetic admin — yet builds land in `app-anon-…` (+ the 5/hr anon rate limit + a SHARED account lock
across all anon users). Root: `resolveBuildIdentity` (correctly, for security) refuses to trust a
claimed uid without a verified token, so ANY `verifyIdToken` failure → userId=null → 'anon'. WHY the
token fails for a real user was INVISIBLE (verify swallowed the error). Honest verdict (rule 6): the
true root may be infra (cold-start cert race, or the server can't reach Google's signing certs), which
can't be confirmed from code — so the fix makes it diagnosable + hardens the deterministic parts.

FIX (safe, additive — no behaviour change to identity resolution):
- `verifyIdentityWithReason(authHeader, getAuth)` (authMiddleware.ts) — testable core returning an honest
  reason: 'ok' | 'no-bearer' | 'admin-unavailable' | 'verify-error' (+detail). RETRIES verifyIdToken ONCE
  (cold-start cert-fetch race is the common false negative). + `verifyFirebaseIdentityDiag(req)` wrapper.
- `adminAppOptions()` — firebase-admin now inits with an EXPLICIT projectId when FIREBASE_PROJECT_ID /
  GOOGLE_CLOUD_PROJECT / GCLOUD_PROJECT is set (never mis-detects the verification project); `{}`
  (today's auto-detect) when unset → purely additive. Applied to BOTH getAdminAuth + getAdminFirestore.
- /chat route: when a uid was CLAIMED but verification produced no identity, `audit('AGENTV3_ANON_FALLBACK',
  {claimedUid, reason, detail})` — so the silent anon becomes a diagnosable event. Identity resolution is
  UNCHANGED (still anon on failure, for security); only the observability + init-determinism improve.
- Tests: verifyIdentityWithReason (ok / no-bearer / admin-unavailable / verify-error+retry / retry-then-
  succeed) + adminAppOptions (explicit projectId vs additive {}).

NEXT: read the AGENTV3_ANON_FALLBACK logs from a real admin build → the `reason`/`detail` reveals whether
it's a transient cold-start (now retried) or a systematic cert/network/config issue (then fix the infra:
set FIREBASE_PROJECT_ID + confirm Cloud Run egress to googleapis.com + the runtime SA can verify tokens).
Gate: frontend tsc 0, server tsc 0, vitest 4889/4889 PASS, build PASS, boot PASS.
## 2026-07-05 — C3/E7: live file-content streaming to the Diff tab (create now emits a diff event)

Only edit_file emitted a `diff` event, so the Diff tab stayed EMPTY through an all-creates fresh build —
the user couldn't watch files stream in. write_file (create + wholesale rewrite) and write_files_batch
now emit a bounded diff too.
- New pure `boundedWholeFileDiff(old, new, maxLines=160)`: create (empty old) → additions only;
  rewrite → removed+added; each side capped with a "… (N more lines)" note so a large file can never
  produce an unbounded event payload.
- write_file emits it after recordFileChange (create → old ''; modify → the pre-overwrite content it
  already read). write_files_batch reuses the create-vs-modify PROBE content it already reads (no extra
  round-trip) and emits per file.
- Synergy: state.diffs now updates on creates → U1's preview auto-refresh also fires as files are
  created, and the events go to the UI stream (not the model transcript), so A1's compaction is unaffected.
- Tests: ToolDispatcher.test.ts +4 (bounded-diff create/rewrite/cap/singular) + the write_file test now
  asserts a create emits an additions-only diff. Gate: server tsc 0, frontend tsc 0, vitest 4908/4908,
  boot PASS.
## 2026-07-05 — P3.1 App.tsx split #4: extract useChatEngine (free NBI chat engine)

Slice #4 — the biggest LIVE extraction. Moved the free (NBI) chat engine into src/hooks/useChatEngine.ts:
handleSendForTab (core turn handler — intent routing, GitHub PAT/repo capture, attachment encoding,
streaming reply, build-mode code extraction), handleSend, and the private helpers callGeminiFrontend,
runFrontendPipeline, readFileRaw, downscaleImage, filesToBase64. Code moved BYTE-IDENTICAL via range
extraction (not retyped) so it is a pure relocation.

- 46 cross-slice deps injected (state values, setters, addLog/addToast, incrementDailyUsage,
  handleGHConfirmPush, learnFromMessage, updatePreview, FREE_DAILY_MESSAGES/isFreeLimitReached from the
  payment hook). App.tsx destructures the SAME handleSendForTab/handleSend the render tree + Enter/retry
  handlers already called, so every call site is unchanged.
- Dependency surface mapped by a subagent first (which also confirmed callGeminiFrontend/runFrontendPipeline/
  filesToBase64 etc. are engine-internal, and handleModelSelect/handleKeySave are NOT engine → left in App).
- Two fixes required by the move: exported rememberGithubOwner from App; rewrote the inline
  import('./types') type refs to import('../types') for the new file location.
- tsc passed on the FIRST try — proves all 46 deps present/typed/ordered, no used-before-declaration, and
  every external call site resolves to the hook returns.

App.tsx: 5,045 -> 4,387 lines (-658). Running total: 6,596 -> 4,387 (~33% down; target ~2,000-2,500).
Gate: frontend tsc 0, vitest 4888/4888 PASS, vite build PASS.

## 2026-07-05 — P3.1 App.tsx split #5: extract useSessionManager (session restore/mgmt)

Slice #5. Moved the session-restore / session-management cluster into src/hooks/useSessionManager.ts:
handleRestoreUci (restore a chat by UCI/id — local cache then Firestore, incl. the v3.0-session resume
branch), handleRestoreByUci (restore from the typed UCI input), deleteSession (delete locally + in
Firestore), startNewChat. Two non-adjacent byte-identical blocks (renderUciControls, a JSX render helper
sitting between them, stays in App). Mapped by subagent first.

- Deps injected (17 setters + sessions/user/currentSessionId/resumeUciInputState/mode + toggleTab/
  addToast/addLog). v3ResumeInFlightRef stays App-owned + injected (shared with the toggleTab new-chat-
  bump effect — the resume-vs-fresh-open bridge). App returns handleRestoreUci/handleRestoreByUci/
  deleteSession (the HistoryView/ProChat/Continue-modal consumers) unchanged; startNewChat is hook-
  internal (deleteSession calls it) so not returned to App.
- Exported safeLS from App (module-private) so the hook shares it; db/authedHeaders already exported.
- tsc passed first try. App.tsx: 4,401 -> 4,126 lines (-275). Running total: 6,596 -> 4,126 (~37% down).
Gate: frontend tsc 0, vitest 4915/4915 PASS, vite build PASS.

## 2026-07-05 — P3.1 App.tsx split #6: delete dead getBharatContext + handleGitHubCommand

More dead-code removal found while scanning the biggest remaining blocks. Two functions had ZERO
callers (only their own definitions):
- getBharatContext (~253 lines) — a legacy system-prompt/context builder, orphaned when Free chat moved
  to server-side prompt construction (the extracted useChatEngine builds its prompt in callGeminiFrontend,
  never calling getBharatContext).
- handleGitHubCommand (~10 lines) — an unused GitHub command stub.
Deleting them then orphaned the entire ./lib/appUtils import in App (detectFrameworkFromFiles, detectAppType,
isClassicVanillaWeb, buildLanguageRule, classifyError — all now live only inside the extracted preview/chat
hooks), so that import block + its stale "→ imported" comments were removed too. Each verified dead by
whole-file grep before removal.

App.tsx: 4,139 -> 3,868 lines (-271). Running total: 6,596 -> 3,868 (~41% down; target ~2,000-2,500).
Gate: frontend tsc 0, vitest PASS, vite build PASS.

## 2026-07-05 — P3.1 App.tsx split #7: dead-code sweep — delete 9 orphaned functions

A whole-file sweep for component-scope functions with a single reference (definition only) found NINE
dead functions — all orphaned when their UI moved into child components (AppModals/ViewPanels/etc.) or
when the dead Pro v2.0 engine was removed (which had been their only caller):
  handleRetry, handleFixNow, handleModelSelect, createFile, deployApp, handleDeployApp, handleUndoBuild,
  saveVersionSnapshot, renderUciControls.
Each is a component-scope const (cannot be referenced outside App.tsx), so whole-file grep is authoritative;
each verified at exactly one reference (its own definition) before removal. Deleting never-called functions
cannot change runtime behavior. (renderUciControls was preserved during the earlier session extraction out
of caution; the sweep proved it is never called, so it is removed now.)

App.tsx: 3,868 -> 3,695 lines (-173). Running total: 6,596 -> 3,695 (~44% down; target ~2,000-2,500).
Gate: frontend tsc 0, vitest PASS, vite build PASS.

## 2026-07-05 — P3.1 App.tsx split #8: dead-state sweep + extract useZipImport

Two changes bundled (one merge cycle):
1. Dead-state sweep — 13 useState vars whose value AND setter appeared only at their declaration
   (orphaned by the #1012 function deletions): showWorkspace, copiedUci, sharedUci, isBuilding,
   deployPlatform, deployToken, deployProjectName, deployOwner, deployRepo, isDeploying, deployPanelError,
   appSecrets, showGHAid. Each verified at a single reference before removal.
2. Extract useZipImport — handleZipImport (~165 lines: stream .zip → SSE extraction → real-time Code
   Studio load → persist/mirror to v3.0 → classify + honest summary) moved BYTE-IDENTICAL into
   src/hooks/useZipImport.ts. 11 deps injected; App destructures the same handleZipImport so the file-drop
   and conflict-resolve callers are unchanged. tsc passed first try.

App.tsx: 3,695 -> 3,521 lines (-174). Running total: 6,596 -> 3,521 (~47% down; target ~2,000-2,500).
Gate: frontend tsc 0, vitest PASS, vite build PASS.
## 2026-07-05 — Concurrency FIX #3: per-workspace build lock + per-account cap (flag-gated OFF)

The foundation of the admin's concurrency plan. TODAY the build lock/registry key is per-ACCOUNT
(`userId ?? 'anon'`) → one build at a time per account (blocks 2 apps at once / roadmap-in-one-chat +
edit-elsewhere; and every anon user shared the single 'anon' lock). FIX #3 keys by WORKSPACE when
enabled → different apps build concurrently, the SAME app stays mutually exclusive (no file clobbering),
with a per-account cap to bound sandbox cost.

- New pure `BuildConcurrency.ts` (fully tested, 13 cases): `perWorkspaceLockEnabled()`
  (AGENTV3_PER_WORKSPACE_LOCK, default OFF), `maxConcurrentBuilds()` (AGENTV3_MAX_CONCURRENT_BUILDS,
  default 3), `buildLockKey(userId, workspaceId, perWorkspace)` (account key when off — byte-identical —
  else the workspaceId, falling back to the account key when no stable id), `countActiveBuildsForUser`,
  `acquireDecision` (same-workspace-busy vs account-cap vs ok; flag-off NEVER consults the cap).
- Route wiring (agentv3.ts), all via buildLockKey so flag-OFF == today's keys exactly:
  • /chat acquire: key by workspace (stable sessionId only) + a per-account cap check (429 with the
    honest count when at the cap); 409 copy is app-scoped under per-workspace.
  • RunningBuild gains `userId` (for the cap count); `key` stays the ACCOUNT key for the cross-device
    LiveChannel (readers already filter by workspaceId), registry Map keyed by the lock key.
  • /stop now targets THIS app's build (client sends workspaceId); /attach looks the build up by the
    requested workspace directly; /status scopes buildRunning/here per-workspace.
- Client: hook stop() sends workspaceId (server ignores it when the flag is off).
- KNOWN flag-ON follow-up (documented, safe): /live's same-instance fast path still keys by account —
  it degrades to the cross-instance channel, never a build break. Full /live rekey is a later slice.

SAFETY: default OFF → production byte-identical (every key resolves to the account key, cap not
consulted). When ON: different apps concurrent (cap 3), same app mutually exclusive, and the anon
shared-lock collision is gone (anon still shares, but real users key by their own workspace).
Gate: frontend tsc 0, server tsc 0, vitest 4924/4924 PASS, build PASS, boot PASS.

## 2026-07-05 — P4.1 CQRS: command/query split for AppMakerLab workspaces  ✅ DONE

Completed the last open P4 item. The AppMakerLab WorkspaceController mixed writes (create/saveFiles/
delete/updateStatus) and a read (getWorkspaceInfo) in one class. Split into a real CQRS pair:
- WorkspaceCommandController — the write path only (create, saveFiles [NotFoundError-guarded], delete,
  updateStatus). No reads.
- WorkspaceQueryController — the read path only, MUTATES NOTHING (getWorkspaceInfo joins registry
  metadata + manager file summary; plus new getMetadata + listWorkspaces query capability). Because it
  never mutates it is free to cache/replicate/fan out independently of writes.
- WorkspaceController is now a non-breaking CQRS FACADE: preserves the original 5-method API by
  delegating to the correct side, and exposes .commands / .queries for callers wanting an explicit
  write-only or read-only handle. Existing callers unchanged.
Real, tested (not scaffolding): WorkspaceCqrs.test.ts (12 tests) asserts the write path runs via a spy
manager, the read path performs NO mutating manager calls, NotFoundError on unknown workspace for both
saveFiles and getWorkspaceInfo, and facade delegation end-to-end.

P4 is now 100%. Gate: frontend tsc 0, server tsc 0, vitest 4927/4927 PASS (12 new), boot:check PASS.
## 2026-07-05 — Concurrency FIX #4 slice 1: durable command QUEUE state machine (the 3-role model's core)

The heart of the admin's 3-role model: ONE serial EXECUTOR per app (Chat 1 "Main build") drains a queue
of commands one at a time — so the same app's files are never written by two builds at once (safety by
construction). The read-only advisor chats (Chat 2 planner, Chat 3 auditor/…) never write; they ENQUEUE
commands for the executor. A user can queue 10+ approved roadmap steps and they run in order, hands-free.

Slice 1 = the PURE state machine `BuildQueue.ts` (fully unit-tested, 15 cases): emptyQueue, enqueue
(rejects blank/duplicate-id/over-cap MAX_QUEUE_ITEMS=25), claimNext (oldest pending → running; REFUSES a
second while one runs = the serial "one writer per app" invariant), completeRunning (done/failed + honest
note), cancelItem (pending only — a running item must be Stopped via the build), reorderPending (reorder
the roadmap among pending, non-pending keep their slots), queueSummary. All pure/immutable (never mutate
the caller's state → durable-store reads stay intact) + exported from the AgentV3 index.

NEXT slices (planned): #4.2 durable Firestore queue store + enqueue/list/cancel/reorder API; #4.3 the
serial executor (auto-run the next item when the app goes idle, reusing the existing auto-continue idle
pattern); #5 Chat 2 planner + Chat 3 advisor that enqueue (tool-gated NO-write); #6 the queue UI
(reorder/cancel/pause) + advisors read a stable snapshot.
Gate: frontend tsc 0, server tsc 0, vitest 4943/4943 PASS, build PASS.

## 2026-07-05 — P5.2 monorepo: ASSESSED — isolation already achieved, risky migration declined

Investigated the P5.2 goal (isolate remote-keyboard/ from the web build). Finding: it is ALREADY isolated.
remote-keyboard/ (android/ + pc_server/) has NO package.json, so npm ci never installs it; it is not in any
tsconfig include, the vite/esbuild web build, or the vitest globs; and nothing in src/ imports it. Directory
separation already fully isolates it from the web build/test/Cloud Run deploy.

Honest decision (rule 3, no sycophancy): a full pnpm/Turborepo migration would reshape the LIVE Cloud Run
deploy pipeline (package manager, lockfile, Dockerfile, cloudbuild.yaml, CI) for a benefit that already
exists — high blast radius, ~zero payoff. Intentionally NOT done (mirrors P5.1 assessed/kept). A true
multi-package monorepo, if ever wanted, needs admin sign-off on the pipeline change (safeguard #3 / rule #1).

Shipped instead a zero-risk guardrail: added remote-keyboard to the exclude of tsconfig.json +
tsconfig.server.json so a future glob widening can never pull the Android/PC-server tree into the web
typecheck. P5 is now 100%. Gate: frontend tsc 0, server tsc 0, vitest PASS.

## 2026-07-05 — P3.1 App.tsx split #9: extract useGitHubConnect (OAuth connect/fetch)

Slice #9. Moved the GitHub OAuth slice into src/hooks/useGitHubConnect.ts: connectGitHub (start the OAuth
handshake + redirect), disconnectGitHub (clear the local connection), fetchGitHubUser (load authed user
then repos), fetchUserRepos. Two byte-identical blocks. 9 deps injected + clearGithubConnection exported
from App. Hook placed with the other hook calls so the message-listener/callback effects below resolve
the returned handlers; App destructures the same identifiers so all JSX/effect call sites are unchanged.
tsc passed first try. handleGHConfirmPush (chat-coupled) intentionally left in App.

App.tsx: 3,521 -> 3,414 lines (-107). Running total: 6,596 -> 3,414 (~48% down). Also refreshed the
stale P3 tracker row. Gate: frontend tsc 0, vitest 4955/4955 PASS, vite build PASS.
## 2026-07-05 — Concurrency FIX #4.2: durable command-queue store + enqueue/list/cancel API

Builds on #4.1 (the pure BuildQueue state machine). Adds durability + the API so commands can actually
be queued and managed per app.

- BuildQueue.ts: pure `serializeQueue` / `parseStoredQueue` (STRICT — corrupt storage → empty queue,
  malformed items dropped, a stale 'running' item from a dead instance HEALED to 'failed' so the serial
  slot is never stuck). +4 tests.
- New `BuildQueueStore.ts` (Firestore, mirrors ProjectPlanStore conventions): `loadQueue`,
  `mutateQueue` (TRANSACTIONAL read→op→write so concurrent enqueues from the planner+advisor chats can't
  lose an update; in-process fallback when no db / VITEST), `deleteQueue`. +5 store tests.
- API (all workspace-owner-gated via assertWorkspaceOwner): POST /queue/enqueue (source user|planner|
  advisor, generates a uuid + ts), GET /queue (items + honest summary), POST /queue/cancel (pending only).

SAFETY: entirely additive — new collection `build_queues_v3`, new endpoints, no existing path touched.
The queue does not auto-execute yet (that's #4.3, the serial executor) — until then it's a durable,
manageable command list.
Gate: frontend tsc 0, server tsc 0, vitest 4963/4963 PASS, build PASS, boot PASS.

## 2026-07-05 — Concurrency FIX #4.3: client-driven serial queue EXECUTOR (queue now auto-runs)

Completes the queue's execution (admin chose the client-driven model A). While a v3.0 chat is open,
whenever a build SETTLES and the app is idle, the client claims the next queued command and auto-submits
it — a user's queued roadmap (and later the planner/advisor chats' enqueued work) runs one step at a
time, hands-free. Closing the tab PAUSES the queue; it resumes on reopen (nothing lost).

- New pure `queueExecutor.ts` `shouldRunNextQueued` (7 tests): runs the next ONLY when idle after a
  settled build, no gate open, no error (a failure PAUSES the queue — honest, user decides), and no
  claim already in flight.
- Server: POST /queue/next (atomically CLAIM the next pending → 'running'; cheap short-circuit — a
  cached read returns claimed:null WITHOUT a transaction/write when the queue is empty or one is already
  running, so non-queue builds cost ~nothing) + POST /queue/complete (mark the running item done/failed).
- Hook: queueNext / queueComplete. Panel: a guarded executor effect (two refs prevent double-complete +
  re-entrant double-submit) that completes the finished queued item, then claims + submits the next —
  mutually exclusive with the SPM resumable auto-continue (this fires only on a NON-resumable settle).

SAFETY: inert when the queue is empty (nothing enqueues it in the main flow yet — the planner/advisor
are #5), serial (one build at a time per app), pauses on error, additive. The full loop (enqueue →
auto-run in order → complete) is now real end-to-end.
Gate: frontend tsc 0, server tsc 0, vitest 4970/4970 PASS, build PASS, boot PASS.
## 2026-07-05 — P-BRE.6 recovery core: build jobs no longer lost SILENTLY on restart

Started the next roadmap track after App.tsx (P3.1 high-value pass banked) + P4/P5 complete. P-BRE.6 full
vision (BullMQ/Redis or Cloud Tasks queue that RE-EXECUTES an interrupted build) is infra-blocked, but its
most important symptom — in-flight build jobs lost SILENTLY when Cloud Run scales to 0 / crashes mid-build
(stuck forever in e.g. BUILDING, user never told) — is fixable with ZERO infra and shipped now:
- New pure jobRecovery.ts: isStaleInFlight (a non-terminal job whose updatedAt heartbeat — already bumped
  on every updateStatus — is older than a 10-min threshold is an orphan; terminals + bad timestamps never
  flagged), staleRecoveryLog. Type-only import of BuildJob + string-literal statuses to avoid a runtime
  import cycle with BuildJobManager.
- BuildJobManager.recoverStaleJobs(): scans the store, marks each orphan FAILED with an honest reason,
  which fires the existing P-BRE.7 notification so the user is told. Best-effort, never throws.
- Wired on server boot (server.ts listen callback, fire-and-forget) → a restart honestly reconciles the
  previous instance orphaned builds instead of leaving them stuck.
Honest scope: true auto-RESUME still needs a queue backend (Redis/Cloud Tasks) → recorded as infra-blocked,
not stubbed. Recovery makes the loss honest + non-silent today.

Gate: frontend tsc 0, server tsc 0, vitest 4972/4972 PASS (9 new in jobRecovery.test.ts), build PASS,
boot:check PASS (boot exercised the recovery pass).

## 2026-07-06 — HOTFIX (admin): Google login "not smooth" — cancel no longer force-redirects the page

Admin report: Google login is not smooth. ROOT CAUSE (AuthComponent.tsx socialSignIn): the popup catch
treated `auth/popup-closed-by-user` (the USER cancelled) and `auth/cancelled-popup-request` (a
double-tap superseded the first popup) the SAME as `auth/popup-blocked` — and responded with
signInWithRedirect, a FULL-PAGE navigation to Google. So closing the popup ("cancel") forced the user
straight back into the Google login anyway, and a double-tap set off a popup + a page navigation at
once. Cancel must mean CANCEL.

FIX: new pure `socialSignInPolicy.ts` `popupFailureAction(code)` (4 tests) — 'redirect' ONLY for
auth/popup-blocked; 'cancel' for popup-closed-by-user / cancelled-popup-request (stop QUIETLY: spinner
off, no error banner, never a forced navigation); 'error' otherwise (surfaced honestly). socialSignIn
now returns 'ok' | 'cancelled' | 'redirecting'; both the Google and GitHub handlers re-enable the
buttons on a cancel. The genuine popup-blocked → redirect fallback is unchanged, as is the redirect
finalization at the app root (getRedirectResult).

Gate: frontend tsc 0, vitest 4974/4974 PASS, build PASS. (#5 planner/advisor deferred per admin —
login first.)

## 2026-07-06 — Concurrency FIX #5: PLANNER + ADVISOR role chats (read-only lanes that propose queue steps)

The 3-role model's two advisor roles are now real server-side. Chat 2 (PLANNER: decompose goals into
ordered buildable steps) and Chat 3 (ADVISOR — priority audit/test/research/explain/compare, admin
decision: one flexible slot) are READ-ONLY lanes in /chat, selected by a new `chatRole` body field
('planner' | 'advisor'; absent → today's exact behaviour, old clients unaffected).

- No-write guarantee is STRUCTURAL: a role turn runs the model with NO TOOLS AT ALL — a pure text turn
  over injected REAL project context (durable file tree via summarizeFileTree + a bounded,
  relevance-picked subset of file contents). With no tools there is nothing to write with.
- New pure `RoleChats.ts` (13 tests): parseChatRole, roleSystemPrompt (both roles explicitly read-only,
  shared steps contract), parseProposedSteps (STRICT fenced ```steps JSON block: trims/dedupes/caps at
  MAX_QUEUE_ITEMS — nothing unbounded/blank can reach the queue), stripStepsBlock (clean prose in chat),
  selectRoleContextFiles (deterministic relevance pick, 8 files/4k chars each/24k total, binary+lock
  skipped), formatRoleContext (honestly labeled subset).
- Route lane runs BEFORE the build lock (a role turn never writes → it runs freely WHILE the executor
  builds — the whole point), streams narration + a new `proposed_steps` wire event (server+client
  unions, reducer state.proposedSteps + test), persists turn+memory like the plain-chat lane, bills 0
  (free router). Steps are PROPOSED only — the user approves them into the queue (#6 UI); nothing is
  auto-enqueued.
- Hook start() accepts chatRole (plumbed to the body).

Gate: frontend tsc 0, server tsc 0, vitest 4997/4997 PASS, build PASS, boot PASS. NEXT: #6 the queue +
roles UI (Chats switcher, approve-steps-to-queue, queue reorder/cancel) — the user-facing surface, with
the AppKnowledgeBase entry landing there.
## 2026-07-05 — P-DATA.4: DPDP/GDPR data retention + right-to-be-forgotten deletion  ✅ DONE

Compliance capability on the platform own user data. New DataRetentionManager.ts (injected-Firestore,
unit-testable):
- deleteUserData(uid): right-to-be-forgotten cascade over a VERIFIED registry of 7 user-scoped collections
  (users/user_profiles/user_sessions/user_token_wallets by doc-id==uid; user_costs/user_build_history/
  chat_sessions by a userId field). EXACT-MATCH ONLY — never a broad/prefix query that could over-delete;
  refuses empty uid; best-effort per collection. Each key strategy verified against its real read/write path
  BEFORE being registered (a wrong strategy = miss data or delete the WRONG user's data — nothing on a guess).
- purgeExpired(now): TTL retention with pure retentionCutoffMs/isExpired + a `< cutoff` bound (only ever
  removes OLD data). One verified policy shipped (build_jobs.updatedAt 90d); more are pure config.
- DELETE /api/profile: identity from the VERIFIED Firebase token (never a body param → a user can only
  delete their OWN data) + required { confirm: "DELETE" }; honest per-collection deletion report.
- Scheduled purge wired in server.ts, OPT-IN via DATA_RETENTION_PURGE_ENABLED (no auto-deletion in prod
  without admin sign-off); boot + daily. Honest caveats recorded: Cloud Run scale-to-0 → guaranteed cron
  needs Cloud Scheduler; a Settings delete-account button is a thin UI follow-up (capability live via API).

Gate: frontend tsc 0, server tsc 0, vitest 4992/4992 PASS (9 new), build PASS, boot:check PASS.

## 2026-07-06 — HOTFIX (admin IMG_5722): Stop AND Resume were both dead — identity-asymmetry deadlock

Admin report: pressing Stop or Resume did nothing; "A build is still running on your account. Press ⏹
Stop…" came back forever. ROOT CAUSE (DNA): /chat registers a build under the VERIFIED identity — when
token verification fails (the known anon fallback, the admin's live situation: app-anon-… repos) the
build + its lock live under the 'anon' key. But /stop and /attach looked the build up by the
CLIENT-CLAIMED body uid → guaranteed miss → Stop stopped nothing (stopped:false), Resume 404'd, the
'anon' lock stayed held → the 409 loop was UNBREAKABLE. A second, compounding defect: even when the
anon build was found, the workspace cross-check compared EXACT ids — the anon build's workspace is
agentv3-anon-<sid> while the client asks with agentv3-<uid>-<sid> (same session!) → still refused.

FIX (both defects, root not symptom):
- New pure `buildKeyCandidates(userId, workspaceId, perWs)` — the deduped list of keys a caller's build
  can live under: primary lock key → account key → the shared 'anon' bucket. (Safety: any anonymous
  caller could ALWAYS reach the anon bucket; a signed-in caller gains no new exposure.)
- New pure `workspaceSessionsMatch(a, b)` — exact match OR the anon-fallback pair for the SAME session
  (sessionId ≥6 unguessable chars is the discriminator; never crosses sessions/owners).
- /stop: stops the FIRST live build across the candidates (session-aware anon cross-check), frees the
  lock the build ACTUALLY held. /attach: candidate lookup with the session-aware cross-check (a
  signed-in caller may attach the anon bucket ONLY on a positive session match — never blind).
  /status: buildRunningHere checks all candidates session-aware, so auto-resume offers Resume for the
  caller's own anon-keyed build. Client stop()/attach send the Bearer token (keys align once verify works).
- Tests: buildKeyCandidates (4) + workspaceSessionsMatch (3 groups) lock the exact failure pair.

## 2026-07-06 — Concurrency FIX #6: the 3-role UI — Build · Plan · Advise pills + the queue UI

The user-facing layer completing the 3-role model (engine shipped in #3-#5):
- Composer mode pills (Build / Plan / Advise) above the chat box — Plan/Advise route the message down
  the read-only role lane of the SAME session (same workspace → steps land in THIS app's queue).
- Proposed-steps card in chat: "Queue all" + per-step + buttons — steps enter the queue ONLY on the
  user's click (source planner/advisor); a fresh-idle enqueue KICKS the executor immediately (a fresh
  session has no settled build, so the settle-effect alone would never start the queue).
- Queue chip above the composer (N pending · running) → expandable list with per-pending Cancel;
  refreshes on mount/settle/enqueue/proposals. Executor effect refactored to a shared claimAndRunNext.
- AppKnowledgeBase: new `agentv3_roles_queue` entry (mandatory user-facing KB rule).

Gate (both changes): frontend tsc 0, server tsc 0, vitest 5004/5004 PASS, build PASS, boot PASS.

## 2026-07-05 — P-PME.6: mid-build scope-change control (no more racing builds)  ✅ DONE

Hardened the flagship build flow. Before, a NEW build request for a workspace while a build was already
running RACED the first (two builders writing the same files → corrupt workspace state), with no handler.
- New pure ScopeChangeController.ts: per-namespace serialization. submit(namespace, prompt) is ATOMIC
  (decide + mark-active in one sync call → two near-simultaneous requests can never both proceed): first
  PROCEEDS, any request arriving mid-build is DEFERRED — queued (cap 10) with an honest "build in progress,
  your change will be applied after" message. complete(namespace) releases the lock + returns queued
  prompts FIFO. Fully unit-tested (8).
- Wired into AppMakerOrchestrator: execute() consults submit() and on DEFER returns the honest message
  WITHOUT starting a racing second build; runBuildJob() finally calls complete() (success OR failure) and
  re-execute()s each queued change (first proceeds, rest re-queue) → a mid-build change is applied right
  after, never silently dropped. Idempotent reuse short-circuits before the lock; a create failure releases it.

Gate: frontend tsc 0, server tsc 0, vitest 5021/5021 PASS (8 new), build PASS, boot:check PASS.

## 2026-07-05 — P-ORCH.1: scheduled/recurring jobs engine  ✅ ENGINE DONE

Replaced ad-hoc setInterval timers with a single tested scheduler. New ScheduledJobs.ts: Schedule =
everyMs | dailyAtUtc; pure computeNextRun(schedule, fromMs) (deterministic, unit-tested). Scheduler
(register/due/tick/start/stop/list): one tick loop fires each due job, reschedules it, ISOLATES failures
(a throwing handler is recorded, never stops the others); tick timer unref'd so it can't block exit.
Wired at boot (server.ts): scheduler.start() + the P-DATA.4 retention purge registered THROUGH it (daily
@ 03:00 UTC, opt-in via DATA_RETENTION_PURGE_ENABLED), replacing its hand-rolled setInterval. Future
backups/digests/user-automations register the same way. Honest scope: a guaranteed cron surviving Cloud
Run scale-to-0 needs Cloud Scheduler/Cloud Tasks (infra follow-up); the in-process engine runs while an
instance is alive.

Gate: frontend tsc 0, server tsc 0, vitest 5032/5032 PASS (11 new), build PASS, boot:check PASS.

## 2026-07-05 — P-DATA.7: user data export (CSV/JSON/Excel)  ✅ DONE

Users could import but not EXPORT their data. New src/server/routes/export.ts: GET /api/export/build-history
and GET /api/export/usage, each ?format=csv|json|xlsx. Identity always from the verified Firebase token
(own data only). Pure, unit-tested toCsv (RFC-4180 escaping, union-of-keys header) + toXlsxBuffer (via the
already-present xlsx dep). Download headers per format. PDF deferred honestly (needs pdfkit, not stubbed).

Gate: frontend tsc 0, server tsc 0, vitest 5039/5039 PASS (7 new), build PASS, boot:check PASS.
## 2026-07-06 — Large-project autopsy RC-1: cold-sandbox undercount → misroute (the "25 vs 1654 files" bug)

Admin imported NavBharatAI's OWN repo (~1650 files) into v3.0 and it paused on the time limit twice;
"badi file abhi bhi handle nahi ho rahi — diagnosis banao". Forensic trace found the primary root cause
and it is fixed here (first of the ledger; remaining root causes queued one-by-one per admin).

ROOT CAUSE (RC-1) — evidence, not theory: `agentv3.ts` listed the edit-mode file tree via
`actuator.listFiles` (~L3476) and ran `isLargeExistingProject` on it BEFORE the FileGuardian restored a
recycled sandbox (~L3757). The sandbox is EPHEMERAL, so across turns it goes cold; on that turn listFiles
returned a near-empty set → the same repo showed "25 source files" one turn and "1654 files" the next.
Consequences: (a) large-project detection saw 25 < 100 → NOT routed to the strong model → the cheap floor
took the huge (later-restored) context and timed out → deadline "paused automatically"; (b) the edit
prompt + banner saw a fraction of the codebase → the agent edited near-blind.

Root fix (single source of truth): the durable WorkspaceFileStore always knows the true file set,
independent of sandbox coldness.
- New `listWorkspaceFilePaths(workspaceId)` — metadata-only paths read (no content load; mirrors
  countWorkspaceFiles), and pure `reconcileProjectFileTree(sandboxPaths, durablePaths)` — dedup UNION,
  sandbox-first so a warm sandbox stays byte-stable.
- Route: `editFileTree` is now the reconcile of the sandbox listing with the durable paths, so
  large-project detection, model selection, the edit prompt (summarizeFileTree) and the "N source files"
  banner all see EVERY known file even on a cold sandbox. One cheap metadata read; no extra content load.

Admin "isko 500 file karo": `summarizeFileTree` fullListMax 400 → 500 — projects up to 500 editable
files now get the full flat file list (every path) instead of the bounded directory summary. (NavBharatAI
scale, 900+, still uses the summary + grep/glob/read_file path — the RC-1 fix is what makes all of it
visible.)

Regression tests encode the exact failure: reconcileProjectFileTree (25-vs-1532 cold-sandbox union,
warm-stable, dedup union, null/garbage), listWorkspaceFilePaths no-throw→[], and the 500-file threshold
boundary (500 → full list, 501 → summary). Siblings hunted: the edit-prompt reuse (~L4007) and banner
(~L4020) both consume the same reconciled `editFileTree`, so no second under-seeing path remains.

Honest scope: RC-1 (misroute + undercount) is killed. Still OPEN and queued next per admin ("ek ek kar
ke"): RC-2 time budget is prompt-sized not project-sized (a large edit gets base 30 min, no `deep`
headroom); RC-3 per-build cold-start tax (restore+install inside the work window); RC-4 auto-continue
honesty; RC-5 anon identity (needs FIREBASE_PROJECT_ID on Cloud Run + the just-merged Stop/Resume deploy).

Gate: frontend tsc 0, server tsc 0, vitest 5019/5019 PASS, build PASS, boot PASS. No AppKnowledgeBase
change (internal routing/visibility fix, no new user-facing surface).

## 2026-07-06 — Large-project autopsy RC-2: wall-clock budget is now project-size aware, not prompt-size only

Second ledger item from the NavBharatAI-import autopsy (fixed one-by-one per admin). RC-2: the build's
wall-clock cap was derived ONLY from prompt complexity (`resolvePipelineDepth(moduleCount+featureCount)`),
so an EDIT of a huge existing project — whose prompt is short ("retry", "fix the navbar") — got the SAME
base 30-min cap as a 15-file app and paused at the limit ("This build hit the time limit and was paused
automatically"). Model routing was already size-aware (RC: `isLargeExistingProject` → strong model); the
TIME budget was not. That asymmetry is the RC-2 bug.

Root fix: `resolvePipelineDepth(magnitude, powerMode, largeExistingProject)` — a large existing project
now forces `deep`, exactly like power mode and a complex fresh build, so `scaleBuildSeconds` grants it the
×1.5 headroom (up to the 3600s ceiling). The size signal comes from the DURABLE WorkspaceFileStore
(`listWorkspaceFilePaths`, metadata-only, sandbox-independent), computed once up-front BEFORE the deadline
timer is armed and BEFORE the sandbox is ensured — and the same durable paths are reused for the RC-1
edit-file-tree reconcile (one durable read, no duplication).

- Backward-compatible: the third param defaults false → every existing caller/test unchanged; a small
  edit on a small project still tiers by prompt magnitude (large=false → prompt decides).
- Tests: pipelineDepth.test.ts +1 group (large project → deep on magnitude ≤ 4; small edit unchanged).
- Siblings: the deadline, the runner `maxBuildMs`, and the four post-build headroom gates all thread the
  SAME `effectiveBuildSeconds`, so a large edit's deep budget is consistent end-to-end (no stale cap).

Honest scope: RC-2 gives a big edit the time a big edit needs. Still OPEN, queued next: RC-3 per-build
cold-start tax (restore + npm install inside the work window — the deep headroom now absorbs it, but
amortizing it is the real fix); RC-4 auto-continue honesty; RC-5 anon identity.

Gate: frontend tsc 0, server tsc 0, vitest 5046/5046 PASS, build PASS, boot PASS. No AppKnowledgeBase
change (internal build-budget policy, no new user-facing surface).

## 2026-07-06 — Large-project autopsy RC-3 (honest: root fix already exists) + RC-4 (honest deadline-pause wording)

Continuing the NavBharatAI-import autopsy one-by-one.

RC-3 — per-build cold-start tax (restore + npm install inside the work window). INVESTIGATION FINDING
(rule 6, honesty): the ROOT FIX ALREADY EXISTS and is coherent — `AGENTV3_SANDBOX_RESUME` resumes the
workspace's OWN warm sandbox (files + node_modules + dev server already there) via E2BActuator's
Sandbox.connect(resumeSandboxId) with auto-create fallback + idle-pause persistence; `SandboxStore`
persists the sandbox id across Cloud Run restarts (save at build end, resume at build start, both
flag-gated); security-safe (workspaceId is server-derived from the verified uid, so a user only ever
resumes their OWN sandbox). It is OFF by default because keeping E2B VMs warm is a cost/infra decision.
Building a duplicate would violate the redundant-work safeguard (#6). HONEST OUTCOME: recommend enabling
`AGENTV3_SANDBOX_RESUME=on` (admin infra/cost call) — and RC-2's `deep` headroom already absorbs the
cold-start TIME meanwhile, so a cold build no longer pauses just from the restore+install cost. Recorded
as an admin-side enablement, not a code gap.

RC-4 — the deadline-pause message lied. On a wall-clock pause the narration said "It was likely almost
done" — an UNVERIFIED guess that is simply false for a big build that timed out EARLY (violates the
no-fake-success / honesty rule), and the resumable result carried no real progress signal.
- Root fix: new pure `deadlinePauseMessage(filesChangedSoFar)` (DeadlinePause.ts) — states ONLY the real
  fact available at the cap: how many files were written so far (`writtenFiles.size`). Never guesses how
  close the build was; honest "nothing was written yet" branch when zero. Wired into the route's
  finalize-on-deadline path (replaces the "almost done" line).
- Client-side exhaustion was ALREADY honest (decideAutoContinue → "type continue" stopMessage once the
  pause budget is spent) — verified, no change needed. Sibling hunt: grep confirmed only this one site
  carried the dishonest wording.
- Tests: DeadlinePause.test.ts (never "almost done"; real N-files wording; singular; honest zero;
  garbage input → zero).

Gate: frontend tsc 0, server tsc 0, vitest 5051/5051 PASS, build PASS, boot PASS. No AppKnowledgeBase
change (internal messaging honesty + infra recommendation, no new user-facing surface).

Ledger status: RC-1 ✅ merged, RC-2 ✅ merged, RC-3 ✅ root fix exists (enable AGENTV3_SANDBOX_RESUME —
admin infra call), RC-4 ✅ this PR. RC-5 (anon identity) remains — partly infra (FIREBASE_PROJECT_ID on
Cloud Run) + the already-merged Stop/Resume deploy.
## 2026-07-06 — P-DATA.5: OpenAPI 3.0.3 contract for the platform REST API  ✅ DONE

The platform's own routes had no machine-readable contract. New src/server/lib/apiContract.ts REUSES the
existing tested generateOpenApi engine (P-CGE.5 — the same one that writes contracts for generated apps)
and feeds it NAVBHARAT_API_ROUTES, a hand-curated list of the STABLE public endpoints (health, profile
GET/PUT/DELETE, profile/history, export ×2, wallet, payment ×3, github ×2, appmaker job status).
buildApiSpec() emits a valid OpenAPI 3.0.3 doc. Served live: GET /api/openapi.json (machine-readable) +
GET /api/docs (self-contained, CSP-safe HTML viewer — no external CDN — that renders the endpoint table).
Wired in server.ts. Honest scope: curated stable surface, not an exhaustive dump of every internal route;
reused the proven generator instead of adding zod-to-openapi. Tests: apiContract.test.ts (5).

Gate: frontend tsc 0, server tsc 0, vitest 5044/5044 PASS (5 new), build PASS, boot:check PASS.

## 2026-07-06 — P-TQA.13: MTTD/MTTR build-reliability metrics  ✅ DONE

Added failure-recovery reliability tracking derived from REAL build-job history (no new persistence, no
build-lifecycle hook → zero collision with the live AgentV3 engine the other session is actively fixing).
New src/server/QualityEvaluationEngine/QAMetricsCollector.ts (pure, unit-tested): computeReliabilityMetrics(jobs)
computes MTTD = mean(failedAt − startedAt) over FAILED builds (how long a build runs before failure surfaces)
and MTTR = per-app (workspaceId-correlated) time from a failure to the next successful build of that app. A
failure with no later same-app success is honestly counted as unresolved — never given an invented repair
time; also reports recoveryRate + unresolvedFailures. Exposed via GET /api/analytics/reliability on the
existing live buildAnalytics route (honest zeros until failures occur). AppAnalytics.tsx gains a "Build
Reliability" KPI card (MTTD/MTTR/recovery rate/unresolved) that renders only once a failure has occurred.
AppKnowledgeBase updated (build-reliability-metrics entry). Honest scope: classic MTTD's deploy→detect framing
needs deploy timestamps we don't record for user builds; shipped MTTD is the faithful build-job equivalent,
documented in the collector. Tests: QAMetricsCollector.test.ts (7 — fail→pass MTTR, cross-app isolation,
unresolved-no-invented-time, no-workspaceId, consecutive-failures pairing, honest-zeros).

Chose this over P-PME.12 (traceability): P-PME.12 as specced wires into AppMakerOrchestrator, which is only
referenced by its own test (legacy scaffold, NOT the live path) — building there would attach to a dead path
(violates real-features-only). P-TQA.13 plugs into the live analytics surface instead.

Gate: frontend tsc 0, server tsc 0, vitest 5063/5063 PASS (7 new), build PASS, boot:check PASS.

## 2026-07-06 — P-MON.5: AI insights + NL telemetry query + ops report  ✅ DONE

Added an admin AIOps layer over the REAL MetricsSnapshot. New src/server/lib/AiInsights.ts (pure,
unit-tested): generateInsights(snap) → deterministic, severity-tagged observations (success/preview rate,
avg build time, repair burden, top-spend provider + share, per-request cost spread) — every number derived
from real recorded metrics, no hallucination/projections, honest "no telemetry yet" when empty;
generateOpsReport(snap, period) → plain-text ops summary; answerMetricQuery(snap, question) → recognized-intent
NL resolver (cost/success/speed/providers/preview/volume) answering from the real snapshot, unrecognized →
matched:false + honest capability list (never a guess). Wired admin endpoints GET /api/admin/insights +
POST /api/admin/insights/query (verifyAdminToken, mirroring /api/admin/finops). AdminDashboard.tsx Overview
gains an "AI Insights" card: severity-tagged insight list + NL query box. AppKnowledgeBase updated
(admin-ai-insights entry). Honest scope: insights are deterministic (rules over real metrics — more trustworthy
than a model guess); NL query is intent-recognition over the real snapshot, not open-ended LLM Q&A, documented
as such; a free-form LLM narrative can layer on later. Tests: AiInsights.test.ts (13).

Stayed clear of AgentV3/routes/agentv3.ts (the other session's active RC-1..RC-5 root-cause area) — this
change is entirely in the isolated admin/metrics surface.

Gate: frontend tsc 0, server tsc 0, vitest 5076/5076 PASS (13 new), build PASS, boot:check PASS.

## 2026-07-06 — U-5: per-user cost-alerting thresholds  ✅ DONE (admin-directed)

Admin chose U-5 from the new upgrade backlog. Added real per-user cost alerts on month-to-date spend vs the
user's own monthly budget. New src/server/lib/CostAlertEngine.ts (pure, unit-tested): buildCostAlertReport(
spendInr, budgetInr, warnAtPct=0.8) → 80% amber "approaching", ≥100% red "exceeded"; budget≤0 → budgetSet:false
with NO invented alert; remaining never negative; negative/NaN spend clamped to 0. Wired GET /api/profile/
cost-alerts (identity from verified token — own data only; monthly USD spend from userCostStore converted to INR
via the canonical usdToInr, fixing the currency mismatch vs the INR budget). ProfilePage.tsx shows an
approaching/exceeded banner under the billing grid (best-effort fetch, never blocks profile). AppKnowledgeBase
my_profile entry updated with the cost-alert capability + keywords. Isolated to billing/profile surface — no
AgentV3 touch (other session's active area). Noted as U-5 in the upgrade backlog table. Tests:
CostAlertEngine.test.ts (9 — threshold boundaries, exactly-100% = exceeded, no-budget, custom/out-of-range
warn pct, negative/NaN spend).

Gate: frontend tsc 0, server tsc 0, vitest 5085/5085 PASS (9 new), build PASS, boot:check PASS.

## 2026-07-06 — U-9: docs site auto-generated from AppKnowledgeBase  ✅ DONE (admin-directed)

Admin chose U-9. Turned the AppKnowledgeBase (single source of truth, 158 features) into a browsable,
searchable docs site so humans get the same authoritative, never-drifting answers every AI reads. New
src/server/lib/KnowledgeDocs.ts (pure, unit-tested): buildDocsModel(features) groups every feature exactly
once into ordered sections (App Builder v3.0 / Engineer AI / Pro Chat / Free Chat / SDA / Repo Analyst /
Professional AI Assistants / Platform & App Features — the 100+ single professional AIs funnel into one
group); renderDocsHtml(model) emits a self-contained, CSP-safe (no external CDN), HTML-escaped page with a
live client-side search filter. Served GET /guide (site) + GET /api/knowledge-base (JSON), wired in server.ts
with /guide added to the SPA-fallback allowlist (else the catch-all would swallow it). Live production smoke
verified: /guide → 200 docs HTML with real features, /api/knowledge-base → JSON totalFeatures:158.

Template Gallery half NOT rebuilt (safeguard #6): it already ships as the in-app Templates panel
(CURATED_TEMPLATES / project-templates entry) — the docs link to it instead of duplicating. AppKnowledgeBase
gains a user_guide_docs entry. Isolated to server/lib + server.ts routing — no AgentV3 touch.

Gate: frontend tsc 0, server tsc 0, vitest 5096/5096 PASS (11 new), build PASS, boot:check PASS, live prod
smoke (/guide 200 HTML + /api/knowledge-base JSON) PASS.

## 2026-07-06 — U-15: status page + deep /api/health  ✅ DONE (admin-directed)

Admin chose U-15. Added a public status page + a deep health probe from real signals. New
src/server/lib/HealthReport.ts (pure, unit-tested): buildHealthReport(signals) → overall status (down if
not ready; degraded on maintenance or any degraded/down dependency; else ok) + real uptime/memory/version/
node; formatUptime (d/h/m/s); renderStatusPageHtml (self-contained, CSP-safe, HTML-escaped, polls /api/health
every 15s). GET /api/health upgraded from a shallow {status,uptime,port} to the deep report with per-dependency
checks (server init, Firestore backup, AI providers count, maintenance mode) assembled from real serverStats +
process signals; still returns status:'ok' when healthy so existing probes keep passing; 503 only while not
ready (degraded deps don't 503, mirroring /api/ready). ROOT-CAUSE: removed the legacy inline /api/health handler
in server.ts that was shadowing registerHealthRoutes' deeper one (first-match wins) — one health endpoint now.
Public /status page added to the SPA-fallback allowlist. AppKnowledgeBase status_page entry added.

Live prod smoke verified: /api/health → deep JSON (honestly reported degraded because FIRESTORE_BACKUP_BUCKET
unset locally, 4 providers enabled), /status → 200 page. Honest scope: current-instance uptime is real; the
long-term SLA/uptime record accrues from monitoring over time (Bucket C) — not faked. Isolated: health route +
lib + one server.ts line, no AgentV3 touch.

Gate: frontend tsc 0, server tsc 0, vitest 5105/5105 PASS (9 new), build PASS, boot:check PASS, live prod smoke
(/api/health deep + /status) PASS.

## 2026-07-06 — U-7 (foundation): public API keys + v1 endpoint  🟡 FOUNDATION DONE

Built the public-API foundation (the automation half — headless build trigger + nbai CLI — is honestly
deferred). New src/server/lib/ApiKeyManager.ts (pure, unit-tested): generateApiKey (nbai_ prefix, 32 url-safe
random chars), hashApiKey (SHA-256), verifyApiKey (crypto.timingSafeEqual), normalizeScopes/hasScope over a
fixed scope set (read:profile/read:usage/read:builds), extractApiKey (X-API-Key or Bearer nbai_…, never
mistakes a Firebase token for a key). Plaintext is returned ONCE at creation; only the hash is ever stored.
New ApiKeyStore.ts (Firestore, VITEST-skip like UserCostStore, best-effort): create/listForUser (hash never
leaves the server)/revoke (OWNERSHIP-enforced — can't revoke another user's key)/findByHash (auth resolution,
rejects revoked)/touchLastUsed. Routes in routes/apiKeys.ts: POST/GET/DELETE /api/keys (Firebase-session-authed
management) + apiKeyAuth middleware + requireScope guard + GET /api/me (canonical /api/v1/me via
apiVersionMiddleware rewrite) gated by an API key + read:profile scope, returning the owner's profile + monthly
usage — proving keys work end-to-end. Frontend ApiKeysCard.tsx in My Profile: create (name + scope chips),
one-time key reveal with copy, list, revoke. OpenAPI contract (apiContract.ts) + AppKnowledgeBase (api_keys
entry) updated.

Root-cause note: /api/v1/me first 404'd because apiVersionMiddleware rewrites /api/v1/* → /api/* before routing;
registered the handler at /api/me (clients call /api/v1/me). Isolated: server/lib + one route file + profile UI,
no AgentV3 touch.

Live prod smoke: /api/v1/me & /api/me without a key → 401; bogus key → 401 "Invalid or revoked"; POST/GET
/api/keys without a session token → 401; OpenAPI lists /api/v1/me + /api/keys. (Full create→use flow needs real
Firebase+Firestore, unavailable in local smoke — the pure core + guards are unit-tested and the routes verified
reachable with correct auth behavior.)

Gate: frontend tsc 0, server tsc 0, vitest 5114/5114 PASS (9 new), build PASS, boot:check PASS, live smoke PASS.

## 2026-07-06 — BUILD-REPORT AUTOPSY (rule 5): "yeh app nahi bani, na hi build report me kuch aya"

Admin ran a fresh build (AI Website Builder) that failed: the app was not delivered AND the build report
was EMPTY. Run signature: repeated "I'll continue building…" restarts, "🛡️ restored 11 file(s) from
history", parallel specialist agents, then "The build stopped responding — your files are saved" (twice).
Forensic autopsy per the fifth absolute rule.

### Diagnosis — ONE class, two sibling instances (ephemeral compute loses deferred-persist state)
"The build stopped responding" (useAgentV3Build.ts:1099) fires when the stream is silent >35s AND the
server reports the build gone — i.e. the Cloud Run instance/sandbox ROTATED mid-build (matches "restored
from history"). A rotation / hard-kill does NOT run a JS catch, so anything persisted only at terminal
paths was lost:
- ❌ EMPTY REPORT — root cause: the diagnostics report lived only in the in-memory `lastDiagnostics` map
  during a build; the durable `saveDiagnostics` ran ONLY at finalize / completion / crash-catch. A
  mid-build rotation died before all three → the durable report was never written → empty. (The code
  comment even CLAIMED it "survives a crash/hang" — a durability the code never delivered; honesty gap.)
- ❌ APP NOT BUILT (files lost) — SIBLING root cause (rule 3): file writes persisted on a RESETTING 3 s
  debounce (onFileWrite). Under a CONTINUOUS write burst (parallel specialists) the timer kept sliding
  and NEVER flushed until a 3 s gap — a rotation during the burst lost the whole app.

Both are the same class: durable persistence deferred → the ephemeral instance rotates → in-flight state
is lost. Fixed the CLASS, not the instance.

### Root fix (rule 2/3/4)
- New pure `flushDecision(lastFlushAt, now, maxWaitMs)` (DurableFlush.ts) — 'flush-now' when overdue
  (≥ maxWait since the last durable flush, or the never-flushed sentinel) else 'debounce'. Guarantees a
  durable flush at least every maxWait REGARDLESS of event rate (a burst can never starve it). Shared by
  BOTH persist sites so the bug can't return on either.
- Files: the 3 s debounce now also force-flushes every FILE_FLUSH_MAX_MS (6 s) → worst-case loss bounded
  to a few seconds even under a solid write burst.
- Diagnostics: `onUpdate` now persists DURABLY too, throttled to once per DIAG_FLUSH_MS (10 s), first
  update immediate → the report is durable from the first recorded issue and survives a rotation.
- Tests: DurableFlush.test.ts (never-flushed sentinel; recent→debounce; overdue→flush; the continuous-
  burst-still-flushes regression; disabled-throttle).

### Honest scope (rule 6)
This makes the report NEVER empty and bounds file loss on rotation — so the app survives better AND the
NEXT failing run is actually diagnosable (the empty report was blinding the autopsy). The DEEPER cause of
the repeated stall/rotation on a big fresh parallel build is still open: recommend enabling
`AGENTV3_SANDBOX_RESUME=on` (warm sandbox across turns — already built) and, with a now-non-empty report
from a re-run, a follow-up autopsy of the parallel-specialist stall itself. RC-5 (anon) also still needs
`FIREBASE_PROJECT_ID` on Cloud Run.

Gate: frontend tsc 0, server tsc 0, vitest 5056/5056 PASS, build PASS, boot PASS. No AppKnowledgeBase
change (internal durability fix, no new user-facing surface).
## 2026-07-06 — AgentV3 build-quality: React Rules-of-Hooks analyzer  ✅ DONE (powerful-builder)

Admin redirect: "aim = powerful app builder." Added a NEW build-robustness evaluator that hardens what the
builder ships — catching a hard-crash bug class the existing scanX/readiness suite misses. Chosen for maximum
value-to-risk after mapping AgentV3: it reuses the proven COLD-wiring precedent (HallucinationDetector →
routes/hallucination.ts → server.ts) so it touches NONE of the other session's hot core-loop files
(AgentRunner/ToolDispatcher/systemPrompt/agentv3.ts/Readiness).

New src/server/AgentV3/HooksRulesAnalysis.ts (pure, ts-morph AST-accurate, lazily loaded, deterministic):
analyzeHooksRules(files) flags four HIGH-CONFIDENCE React Rules-of-Hooks violations — conditional-hook
(if/else/ternary/&&/switch/try), hook-after-return (early return makes later hooks conditional), hook-in-loop
(for/while/do), hook-in-callback (hook from a nested event handler / .map callback). These throw "React has
detected a change in the order of Hooks" and white-screen the app at runtime. Conservative by design (real AST
scope + control-flow, only flags clear violations) → near-zero false positives, verified by clean-code tests.
Wired via cold route POST /api/workspace/hooks-check (rate-limited + validated, mirrors hallucination-check) +
one additive server.ts line, and surfaced as a "React Hooks Safety" card in ProjectInsightsPanel.tsx (parallel
to the Code Confidence card). AppKnowledgeBase react-hooks-safety entry added.

Live prod smoke: conditional hook → ok:false with exact file/line/kind; clean hooks → ok:true. Tests:
HooksRulesAnalysis.test.ts (14 — all 4 violation kinds, custom hooks, no-false-positive clean cases, correct
line numbers, multi-file, unparseable-file robustness, non-React-file skip).

Gate: frontend tsc 0, server tsc 0, vitest 5128/5128 PASS (14 new), build PASS, boot:check PASS, live smoke PASS.

## 2026-07-06 — AgentV3 build-quality: import/export consistency analyzer  ✅ DONE (powerful-builder)

Second build-hardening evaluator toward the "powerful app builder" aim. Catches a top cause of HARD build
failures that the existing suite misses: a named/default import of a symbol the target LOCAL module doesn't
actually export ("'Foo' is not exported by './bar'"). Distinct from HallucinationDetector, which only checks
that the imported FILE exists — this checks the export NAMES match.

New src/server/AgentV3/ImportExportAnalysis.ts (pure, ts-morph AST-accurate, lazily loaded, deterministic):
analyzeImportExports(files) resolves each relative import to its actual file (extension + index inference),
reads the target's true exports (including names re-exported through barrel/index files, via
getExportedDeclarations), and flags named-import-not-exported + default-import-missing. Conservative: skips
external packages, unresolved files (HallucinationDetector's job), and wildcard `export *` modules (a name
could legitimately come through) → near-zero false positives, verified by clean-code + barrel-file tests.
Same proven COLD-wiring pattern (no hot-file collision): route POST /api/workspace/import-check + one additive
server.ts line + an "Import / Export Consistency" card in ProjectInsightsPanel.tsx. AppKnowledgeBase
import-export-consistency entry added.

Live prod smoke: broken named import → ok:false with exact name/module/line; matching imports → ok:true.
Tests: ImportExportAnalysis.test.ts (15 — named/default mismatches, renamed imports, type imports, barrel
re-exports, wildcard silence, external/missing silence, malformed-import robustness, correct line/file).

Gate: frontend tsc 0, server tsc 0, vitest 5148/5148 PASS (15 new), build PASS, boot:check PASS, live smoke PASS.

## 2026-07-06 — AgentV3 build-quality: JSX undefined-component analyzer  ✅ DONE (powerful-builder)

Third build-hardening evaluator toward the "powerful app builder" aim. Catches the classic
"ReferenceError: X is not defined" white-screen: a JSX element <Foo/> (or <Foo.Bar/> / <lib.Widget/>)
whose component is never imported or defined in the file — a hard crash the existing suite misses.

New src/server/AgentV3/JsxComponentAnalysis.ts (pure, ts-morph AST-accurate, lazily loaded, deterministic):
analyzeJsxComponents(files) collects every bound name in a file (imports, const/let/var, function, class,
parameter, destructured binding) and flags component-cased or member-expression JSX tags whose root isn't
bound and isn't a JSX global (React/Fragment). Conservative → never flags host elements (div/span),
locally-defined components, prop/param components, or imported ones. Same COLD-wiring pattern: route
POST /api/workspace/jsx-check + one server.ts line + "JSX Component Resolution" card in ProjectInsightsPanel.
AppKnowledgeBase jsx-component-resolution entry added.

Live prod smoke: undefined component → ok:false with exact detail; imported → ok:true. Tests:
JsxComponentAnalysis.test.ts (12 — undefined plain + member-expression, de-dupe, multi-file, and no-false-
positive cases: imports, local defs, props, Fragment, motion.div, host elements, unparseable robustness).

This completes a three-analyzer build-hardening set (hooks + import/export + JSX resolution), each catching a
distinct hard-failure class the readiness suite previously missed, all wired collision-free from the core loop.

Gate: frontend tsc 0, server tsc 0, vitest 5160/5160 PASS (12 new), build PASS, boot:check PASS, live smoke PASS.

## 2026-07-06 — AgentV3 build-quality: one-call Build-Health aggregator  ✅ DONE (powerful-builder)

Capstone for the three-analyzer build-hardening set. New src/server/AgentV3/WorkspaceHealth.ts (pure,
composes the existing pure analyzers): analyzeWorkspaceHealth(files) runs all four robustness checks —
code confidence (HallucinationDetector), React Rules of Hooks, import/export consistency, JSX component
resolution — the three AST passes in parallel (Promise.all), and returns a single honest verdict {ok,
totalIssues, filesScanned, checks:[{id,name,ok,issues,summary}]}. ok is true only when EVERY check passes;
nothing is summarized away. Wired via cold route POST /api/workspace/health-check + one server.ts line + a
prominent "Build Health — Will this app work?" card at the TOP of ProjectInsightsPanel (one "Run All Checks"
button → pass/fail per check + a ship/no-ship top line). AppKnowledgeBase build-health-check entry added.

Live prod smoke: broken app (hook + bad import + undefined JSX) → ok:false, totalIssues:4 with each sub-check
correctly failing; clean app → ok:true, 0 issues, all four passing. Tests: WorkspaceHealth.test.ts (4 —
clean-all-pass, aggregate-failures, stable 4-check shape, honest summaries).

Builder-hardening story now complete: 3 new analyzers + 1 aggregator, all wired collision-free from the
core loop, giving the user (and, when the team wires it into the gate, the builder itself) a one-click
"will this generated app build and run?" verdict.

Gate: frontend tsc 0, server tsc 0, vitest 5164/5164 PASS (4 new), build PASS, boot:check PASS, live smoke PASS.

## 2026-07-06 — AgentV3 build gate: auto-wire the AST build-breaker checks (self-correction)  ✅ DONE (admin-directed)

Admin decision: wire the new build-health analyzers INTO the build gate so the builder self-corrects.
Integrated the three AST build-breaker analyzers (React Rules-of-Hooks, import/export consistency, JSX
component resolution) into ToolDispatcher's `evaluate` tool — the exact place readiness is assessed. Each real
finding is pushed as a HIGH ExtraFinding (hard readiness blocker) into the existing assessReadiness `extra`
array, alongside secret-leak/runnability/compliance/etc. Result: a build with a conditional hook, a name
imported-but-not-exported, or an undefined JSX component now scores NOT READY, so the mandatory end-of-build
gate feeds those exact blockers back to the agent to FIX before it can report the build ready. This closes the
loop: the checks are no longer just user-invoked in the Insights panel — the builder applies them itself.

Safety: the analyzers are conservative (near-zero false positives, unit-tested on clean code) and never throw
(empty result on any parse/ts-morph issue), so they degrade to "no finding" rather than ever false-blocking a
working build. They run only inside the `evaluate` tool (end-of-build verification), not per-keystroke, so the
cost is bounded. Regression tests added to ToolDispatcher.test.ts (4): each violation kind → NOT READY through
the real evaluate path, and a clean React app is NOT false-blocked.

Files: src/server/AgentV3/ToolDispatcher.ts (imports + evaluate block), ToolDispatcher.test.ts (+4).
Gate: frontend tsc 0, server tsc 0, vitest 5168/5168 PASS (4 new), build PASS, boot:check PASS.

## 2026-07-06 — AgentV3 build-quality: undefined-hook analyzer (+ gate + aggregate)  ✅ DONE (powerful-builder)

Fourth build-breaker analyzer, closing the "reference resolution" family (JSX components ✓, imports-match-
exports ✓, now hook-call identifiers). Catches a hard crash the others miss: a React hook CALLED but never
imported/defined — e.g. useState(0) with no `import { useState }` → "useState is not defined" white-screen.

New src/server/AgentV3/UndefinedHookAnalysis.ts (pure, ts-morph, lazily loaded): analyzeUndefinedHooks(files)
flags `useX()` call identifiers not bound anywhere in the file (import/const/function/param/destructuring),
skipping member-expression calls (React.useState), locals, params, and non-hook calls → near-zero FP.
WIRED INTO THE SELF-CORRECTING GATE (ToolDispatcher evaluate: high ExtraFinding → NOT READY → agent fixes it),
folded into the Build-Health aggregate (now 5 checks), and exposed standalone (POST
/api/workspace/hook-resolution-check + a "Hook Resolution" panel card). AppKnowledgeBase hook-resolution-check
entry added.

Live prod smoke: undefined useState → ok:false with exact detail; aggregate reports 5 checks with
hook-resolution failing. Tests: UndefinedHookAnalysis.test.ts (11) + ToolDispatcher gate regression (1, undefined
hook → NOT READY) + WorkspaceHealth shape updated to 5 checks.

Gate: frontend tsc 0, server tsc 0, vitest 5180/5180 PASS (12 new), build PASS, boot:check PASS, live smoke PASS.
## 2026-07-06 — v3.0 composer/header UX pass (admin IMG_5726/5727/5729) + JSON report = full session

Admin UI batch on the Pro v3.0 surface:
- **Header decluttered:** removed **Export .zip**, **Text report**, **Copy report** buttons from the
  moving toolbar (+ their now-dead handlers/state and the unused Download/Copy icon imports). The single
  JSON **"Build report"** download stays (the canonical report to send to support) alongside the per-build
  History dropdown — so report access is NOT lost (verified the contradiction with the admin first).
- **JSON report now carries the WHOLE session** ("starting se lekar last tak"): the default download
  fetches `scope=session` (every build 0 → last, from the durable per-workspace history) instead of only
  the latest build. A specific build picked from History still downloads just that one.
- **Composer relayout:** the Build/Plan/Advise selector moved to a LEFT COLUMN on top, with
  settings + attach in a row beneath it, freeing width so the message box is bigger (auto-grow min
  height 82px to match the 2-row control column). Matches the admin's sketch.
- **Tighter chat padding** (p-3 → px-2 py-2, gaps 3 → 2.5) so more conversation is visible.

Build-report DURABILITY (empty report / "No build report yet" after a real build) was already root-caused
and fixed earlier today — PR #1042 (incremental durable save; survives instance rotation) + the anon fix
(FIREBASE_PROJECT_ID on Cloud Run, which the admin has now set). Those landed AFTER the screenshots, so a
fresh post-deploy build is the verification; no blind re-code (rule 7).

Gate: frontend tsc 0, vitest 5119/5119 PASS, build PASS. (Client-only + report-download; no server files
touched.) No AppKnowledgeBase change (UI layout + existing report export, no new capability).

## 2026-07-06 — Preview host fix: Vite "Blocked request … is not allowed" on imported / non-labelled apps

Admin hit a real preview error: `Blocked request. This host ("3000-…e2b.app") is not allowed. … add to
server.allowedHosts in vite.config.js`. Root-caused, not patched over the symptom.

ROOT CAUSE: the deterministic preview-host gate in E2BActuator (which reads the on-disk vite config and
injects `allowedHosts: true` via ViteConfigGuard before `npm run dev`) was GATED on
`framework === 'vite' || /\bvite\b/.test(command)`. An IMPORTED app — or ANY app whose dev script is
just `npm run dev` (port 3000, no "vite" in the command, framework not labelled 'vite') — matched
NEITHER signal, so its config was skipped and Vite 5.4+ blocked the E2B proxy host. (Fresh NavBharatAI
scaffolds already set allowedHosts, and the write-time backstop fires when the AGENT writes a config —
but an imported config is written by the import path, so only this dev-start net can catch it, and its
trigger was too narrow.)

FIX (rule 2 — detection-independent trigger): the gate now runs whenever a vite config FILE EXISTS on
disk, not by framework label or command substring. The per-file `exists()` probe in the loop is the real
gate, so it's a cheap no-op for a genuinely non-Vite app (no vite config) and always patches a real Vite
app regardless of how it was launched. `ensureViteAllowedHosts` already injects into an existing
`server: { … }` block (verified it preserves the app's own `port: 3000`).

Sibling hunt: the legacy (non-AgentV3) EngineerAI E2BActuator has no such patch (different, older path);
v3.0's sandbox actuator is the live one and is fixed. Regression test: ViteConfigGuard.test.ts +1 — the
admin's EXACT case (port-3000 server block in vite.config.js → allowedHosts injected, port preserved).

Gate: frontend tsc 0, server tsc 0, vitest 5181/5181 PASS, build PASS, boot PASS.

## 2026-07-06 — P-AI.14 (ConstraintSolver): dependency version-conflict detector  ✅ DONE

Built the near-term-valuable slice of P-AI.14. New src/server/AI/reasoning/ConstraintSolver.ts (pure,
unit-tested): analyzeDependencyConstraints(files) resolves dependency version conflicts from package.json
alone (no registry) — react↔react-dom major mismatch (HIGH — crashes React at render), same package pinned
to two majors across deps/devDeps (MEDIUM), @types/X drift (LOW). dominantMajor() parses common semver forms
and returns null for multi-major/unknown ranges (never false-flags). WIRED INTO the self-correcting gate
(ToolDispatcher evaluate, using the already-read pkgForRun since package.json isn't in snap.sources — the HIGH
react/react-dom mismatch is a hard blocker → the builder self-fixes it), folded into the Build-Health aggregate
(now 6 checks), and exposed standalone (POST /api/workspace/dependency-check + a "Dependency Constraints" panel
card). AppKnowledgeBase dependency-constraints-check entry added.

Bug found+fixed during verification: package.json is excluded from snap.sources (code files only), so the gate
dep-check initially found nothing — switched it to reuse the already-read pkgForRun. Regression test in
ToolDispatcher.test.ts (react/react-dom mismatch → NOT READY).

Live prod smoke: mismatch → ok:false HIGH conflict; aggregate reports 6 checks with dependency-constraints
failing. Tests: ConstraintSolver.test.ts (12) + gate regression (1) + WorkspaceHealth shape → 6.

Gate: frontend tsc 0, server tsc 0, vitest 5193/5193 PASS (13 new), build PASS, boot:check PASS, live smoke PASS.

## 2026-07-06 — P-BRE.11: AI Build Optimizer (deterministic, over real telemetry)  ✅ DONE

New src/server/AppMakerLab/AIBuildOptimizer.ts (pure, unit-tested): analyzeBuildOptimizations(analytics) turns
the REAL aggregated BuildAnalytics (over the job store) into prioritized, severity-ranked optimization
suggestions — high failure rate, a DOMINANT failure signature ("N% of failures share one cause — highest
leverage fix"), slow average build, slow tail (p95 ≫ avg). Returns nothing below 10 terminal builds (never
over-fits a tiny sample), per the spec. Honest scope: deterministic rules over real metrics (more trustworthy
than an LLM guess, no model call — same pattern as FinOpsAdvisor/AiInsights). Exposed via GET
/api/analytics/build-optimizer (feeds BuildJobManager.listRecent → aggregateBuildAnalytics →
analyzeBuildOptimizations) and surfaced as a "Build Optimizer" card in AppAnalytics.tsx. AppKnowledgeBase
build-optimizer entry added.

Gate: frontend tsc 0, server tsc 0, vitest 5202/5202 PASS (8 new), build PASS, boot:check PASS.

## 2026-07-06 — P-DEPLOY.3: AIOps deploy-risk advisor + incident/RCA analyzer  ✅ DONE

New src/server/AppMakerLab/deployment/DeployRiskAdvisor.ts (pure, unit-tested): assessDeployRisk(signals) →
0–100 risk score + low/medium/high band + reasons + advice from real change signals (files/lines changed,
high-criticality files touched, tests included, CI status); a red CI forces high, tests lower risk, a big
untested change raises it. analyzeIncident(events) correlates deploy+error events → an error burst within N min
after a deploy makes that deploy the prime suspect and names the previous revision as the rollback target
(honest first-deploy/no-deploy handling). Exposed as admin AIOps endpoints POST /api/admin/deploy-risk and
POST /api/admin/incident-analysis (verifyAdminToken, callable from CI). Deterministic reasoning — reproducible,
no model call. AppKnowledgeBase admin-deploy-aiops entry. Capacity planner/env optimizer out of scope (low ROI).

Gate: frontend tsc 0, server tsc 0, vitest 5212/5212 PASS (10 new), build (implicit) PASS, boot:check PASS.
## 2026-07-06 — Fix 1: in-browser preview resolves `@/` path aliases locally (Replit/Lovable/Bolt imports)

Root cause of the Mitrify in-browser error "Could not load @/components/ui/toaster … from the CDN
(esm.sh/@/components/ui/toaster)": ReactPreview's client resolver treated ANY import not starting with
`./` or `../` as a bare npm package → sent to esm.sh. But `@/…` is a Vite/tsconfig PATH ALIAS mapping to
the project's src root, not a package — so every imported shadcn/Vite/Next/Lovable/Bolt app (they ALL
use `@/`) had a blank in-browser preview.
- New pure `buildAliasMap(vfs, entry)`: reads aliases in priority order — tsconfig/jsconfig
  `compilerOptions.paths` (JSON, comment-tolerant), then `vite.config.*` `resolve.alias` (best-effort
  regex, spans helper-call args like `path.resolve(__dirname, './client/src')`), then a heuristic
  (`@` → the entry's src root) ONLY when `@/` is actually imported and no config declares it. No false
  positives when the app never uses `@/`.
- Injected as `ALIASES` into the preview HTML; the client resolver's `applyAlias` rewrites `@/x` →
  `/client/src/x` (root-absolute LOCAL path) at the top of `localRequire` AND in `collectBare` (so an
  aliased import is never prefetched from the CDN). Then the existing local resolver bundles the real file.
- Tests: reactPreview.test.ts +6 — tsconfig `@/*`→client/src (Replit monorepo), root `./src/*`
  (Lovable/Bolt) + comment tolerance, vite.config fallback, entry-src heuristic, no-false-positive, and
  the full Mitrify regression (@/components/ui/toaster bundles locally, ALIASES embedded).
- Gate: server tsc 0, frontend tsc 0, vitest 5200/5200, boot PASS.
- This is Fix 1 of 5 from the Mitrify/navBharatAI report autopsies (goal: Replit/Lovable/Bolt-exported
  apps run easily). Next: Fix 2 (monorepo framework/port), Fix 3 (cold-sandbox hydration), Fix 4 (P1 on
  import turn), Fix 5 (auto-provision DB for Drizzle/pg imports).

## 2026-07-06 — P-DEPLOY.5: release freeze/approval gate  ✅ DONE

Optional safety layer on auto-deploy. New src/server/lib/ReleaseGate.ts (pure, unit-tested):
evaluateReleaseGate(config, now, sha) → {allowed, reason} — an active freeze (with optional auto-expiry) blocks
everything; when approval is required the candidate SHA must match the approved one (prefix-tolerant); OPT-IN,
defaults fully OPEN so it never blocks a normal deploy. normalizeGateConfig sanitizes untrusted input.
ReleaseGateStore.ts (Firestore, VITEST-skip) — one config doc, fails OPEN on any storage error. Admin control:
GET/POST /api/admin/release-gate (verifyAdminToken). Pipeline enforcement: public GET /api/release/gate?sha=… +
a step in .github/workflows/deploy.yml that curls it via the opt-in RELEASE_GATE_URL secret and blocks the deploy
when closed (skips cleanly when unset). Honest scope (rule 6): the GH Actions path is fully enforced; the PRIMARY
Cloud Build trigger needs one admin-added curl step in cloudbuild.yaml (recorded, not changed blind, since a bad
step could break all deploys). AppKnowledgeBase admin-release-gate entry.

Live smoke: /api/release/gate defaults allowed:true (open). Tests: ReleaseGate.test.ts (8).

Gate: frontend tsc 0, server tsc 0, vitest 5220/5220 PASS (8 new), build PASS, boot:check PASS.
## 2026-07-06 — Fix 2: full-stack (react+node-server) imports detected correctly (port, not Vite 5173)

Root cause of Mitrify's "dev server did not come up on port 5173": detectImportedFramework checked
`has('react')` BEFORE any server signal, so a Replit/Lovable FULL-STACK export (React frontend + an
Express/Fastify server whose OWN `dev` script boots it and serves the client) was mis-labelled
`vite-react` → the preview boot waited on Vite's 5173 while the app's Node server listened elsewhere
(Express default 3000).
- New pure `devScriptRunsNodeServer(pkgRaw)`: true when dev/start/serve launches tsx/ts-node/node/
  nodemon on a server entry (server.ts, server/index.ts, app.ts…). The "is this a full-stack export"
  tell.
- detectImportedFramework: meta-frameworks (Next/Remix/Nuxt/SvelteKit/Astro) still match first (they
  own their run/port); THEN `(express|fastify|koa) && devScriptRunsNodeServer` → `node-express`
  (port 3000). A react+express app whose dev script is `vite` STAYS vite-react (a server dep alone
  never flips it). react-alone → vite-react, express-alone → node-express: unchanged.
- Tests: ProjectImport.test.ts +5 (the Mitrify react+express+tsx shape → node-express; vite-script
  stays vite-react; Next wins; devScriptRunsNodeServer truth table incl. env-prefixed/nodemon/broken).
- Gate: server tsc 0, vitest 5223/5223, boot PASS.
- Fix 2 of 5. Next: Fix 3 (cold-sandbox hydration), Fix 4 (P1 on import turn), Fix 5 (auto-provision DB).

## 2026-07-06 — Fix 4: import turns route directly to the strong model (no Haiku/cheap-floor timeout)

The Mitrify GitHub import ran on Haiku + the GLM/KIMI cheap floor, which then timed out 6× on the huge
grounding prompt. Root cause: a GitHub-URL clone lands its files AFTER model selection, so the
large-project file count is 0 at decision time — P1 (large→Sonnet, #997) couldn't see the imported app.
(A ZIP import lands before selection so P1 already fired for it — this closes the URL-import gap.)
- New pure `shouldRouteStrongModel(largeProject, hasImportIntent)` = `largeProject || hasImportIntent`.
  `hasImportIntent` is known at model-selection time (from the request), so any import → strong model +
  cheap-floor bypass, regardless of when the clone lands. selectBuildModel + allowCheapFloor now use it.
- Honest narration: large edit → "🏗️ Large project (N files)…"; import → "📦 Imported project — running
  directly on the strong model for reliability."
- Tests: agentv3.test.ts +3 (large→strong; the Mitrify fix: import→strong even at 0 files; small
  non-import stays on the ladder). Gate: server tsc 0, vitest 5234/5234, boot PASS.
- Fix 4 of 5. Remaining: Fix 3 (cold-sandbox hydration), Fix 5 (auto-provision DB for Drizzle/pg imports).
## 2026-07-06 — P-COLLAB.4: team-scoped shared library  ✅ DONE

Added a team-scoped curated library (the global SyncedTemplates/ComponentLibrary stay as-is). New
src/server/lib/TeamLibraryStore.ts (Firestore teams/{teamId}/library/{itemId}, VITEST-skip; pure
buildLibraryItem/normalizeKind unit-tested) — prompts/templates/components, title+content, 200 KB cap,
newest-first. Member-gated routes GET/POST/DELETE /api/team/:teamId/library (routes/teamLibrary.ts) — fail-closed:
only the team owner (teamId===uid) or an ACTIVE member (via TeamStore.listMembers) may read/contribute; deletes
are path-scoped so cross-team deletes are impossible. Self-contained TeamLibraryPanel.tsx (save with
kind/title/content, copy-to-clipboard, delete) mounted in TeamCollaboration. AppKnowledgeBase team-library entry.

Live smoke: /api/team/:id/library without auth → 403 (fail-closed). Tests: TeamLibraryStore.test.ts (6).

Gate: frontend tsc 0, server tsc 0, vitest 5232/5232 PASS (6 new), build PASS, boot:check PASS.

## 2026-07-06 — Fix 3: the FALSE "live preview didn't start" (fresh build, server WAS up) + honest Diagnose message

Autopsy of a real build report (a fresh React+Vite "welcome login page", 12 files, `ok:true`,
"Build verified — the app compiles ✓"). The delivered result said **"The live preview didn't start
automatically"** and the Live-server panel showed **"No package.json found"** — yet the sandbox log
proves the dev server booted perfectly:
- `npm run dev` → **exit 0**, `VITE v5.4.21 ready in 280 ms`, `[health-check] dev server is UP on port 5173`
- `update_preview` → completed (17s)
- Outcome recorded: **BUILD_PARTIAL**, `previewLive:false`.

Two distinct root causes, both fixed at the class level:

**RC-1 — two drifting port-truth sources; the flaky one wins (the primary user-facing failure).**
`update_preview`'s heal path re-launches the managed `npm run dev` — which runs the SAME port check
(`buildPortWaitCommand`) and prints `[health-check] dev server is UP on port N` — but then **threw that
authoritative verdict away** and re-derived truth with a second inline `pollPort`. When that flaky
re-poll missed the (genuinely up) port, no `preview` event fired → `lastPreviewUrl` stayed empty →
`previewLive:false` → the honest-but-WRONG "didn't start automatically" recap + an empty Live panel.
This is the exact class the repo already fought for port *detection* (`shouldReprobeBoundPort`: a
re-probe may only ever UPGRADE to UP, never mark a healthy server down) — now applied to preview
publication. Fix: new pure `parseDevServerHealthLine(output)` (co-located with its producer
`devServerHealthLine`); `update_preview` now TRUSTS a launcher-confirmed UP (`portReady=true`) and only
falls back to the inline poll when the launcher gave no verdict. `getPortUrl` still gates the URL, so a
dead preview is never published.

**RC-2 — the Diagnose "No package.json found" message lied about the user's project (rule 5, honesty).**
That message (`validateProjectForPreview(null)`) fires when a COLD/recycled sandbox's readFile finds no
package.json — usually a failed RESTORE, not a project that genuinely lacks one. Telling a user whose
app really has a package.json that "the project has no defined dependencies" is a false verdict about
their code. Fix: new pure `missingPreviewReason(durablePaths)` consults the DURABLE file index (the real
source of truth): empty → "couldn't find your saved files to restore… try again"; has package.json →
"your package.json is saved safely, the restore failed this time…"; has files but truly no package.json
→ the original structural message (correct there).

- Tests: DevServerRecovery.test.ts +9 (parseDevServerHealthLine: exact UP line, "already healthy" line,
  DOWN line, no-verdict→null, buried-in-log; missingPreviewReason: empty / has-pkg / nested-pkg /
  files-but-no-pkg). Gate: frontend tsc 0, server tsc 0, vitest 5243/5243, boot PASS.
- **Open root cause (rule 6, infra-blocked — honestly recorded):** WHY the first managed launch's dev
  server wasn't confirmed by `update_preview`'s own poll (E2B background-process lifetime after
  `h.disconnect()`, or a flaky inline probe under sandbox load) can't be reproduced or verified in CI
  without a live E2B sandbox. RC-1 makes the engine ROBUST to it (the authoritative launcher verdict now
  wins), but the underlying sandbox-process behavior needs a real-sandbox repro to pin definitively.
- Fix 3 of 5. Remaining: Fix 5 (auto-provision DB for Drizzle/pg imports).
## 2026-07-06 — P-COLLAB.5 (resolution core): @mention router  🟡 RESOLUTION-CORE DONE

New src/server/lib/MentionRouter.ts (pure, unit-tested): parseMentions(text) finds distinct @handle tokens
(ignoring in-prose email addresses), resolveMentions(text, members) resolves each to an ACTIVE team member by
email local-part or full email (case-insensitive), deduped by uid, with an unresolved list. Exposed at
POST /api/team/:teamId/mentions/resolve (active-member-gated, in routes/teamLibrary.ts). AppKnowledgeBase
team-mentions entry. Honest scope (rule 6): resolution is complete; DELIVERING a notification (in-app inbox +
email) needs a per-user in-app notification store that doesn't exist yet — recorded as the open piece, not
stubbed (NotificationManager is webhook build-notifications, not a user @mention inbox).

Gate: frontend tsc 0, server tsc 0, vitest 5251/5251 PASS (11 new), boot:check PASS.

## 2026-07-06 — Fix 6: preview "came up" but crashed every transform ("Cannot find module 'caniuse-lite/…'")

Admin re-tested the Fix-3 login-page prompt. **Fix 3 confirmed working** — the report now honestly says
"✅ Preview verified … renders correctly" + "Use the Preview tab to see it live" (no more false "didn't
start"). But the test surfaced a NEW real bug: the **Live-server** preview showed a Vite error overlay:
`[plugin:vite:react-babel] Cannot find module 'caniuse-lite/dist/unpacker/agents'` (browserslist chain),
and the **In-browser** preview showed "No React entry module found".

**Root cause (Live server — fixed).** The dev server's PORT was up (so no restart-recovery fires), but
`@vitejs/plugin-react` (babel) → `@babel/helper-compilation-targets` → `browserslist` needs
`caniuse-lite/dist/unpacker/agents` at TRANSFORM time. That transitive file was missing from
node_modules. Why it was missing AND never reinstalled: the install guard trusted a directory + mtime —
`if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then npm install; else echo "deps
present"; fi`. The E2B base image ships a **pre-baked node_modules**, so the mtime check read "fresh"
and the install was SKIPPED — leaving a pruned tree missing caniuse-lite. A tree that "exists" is not a
tree that's "complete".

**Fixes (both pure + unit-tested in devServerHost.test.ts):**
- `buildBuildInstallCommand()` — the fast-lane preview now ALWAYS runs a real `npm install` (idempotent +
  fast when satisfied) instead of the "deps present" skip. A build that just (re)wrote package.json MUST
  install its FULL tree. This also covers the earlier "Cannot find module 'tailwindcss'" the skip caused.
- `buildDepsStaleCheckCommand()` (used by EVERY managed dev-server start — the agentic path too, rule-3
  sibling hunt) now adds a resolve PROBE: STALE (→ reinstall) when any declared dep doesn't resolve, or
  (for the babel React plugin) when `caniuse-lite/dist/unpacker/agents` doesn't resolve — catching an
  incomplete pre-baked/pruned tree that mtime alone reads as fresh. Verified in a real shell against the
  exact bug scenario (plugin-react present + caniuse-lite pruned → STALE); a healthy tree passes instantly
  (zero added latency), a probe failure only ever triggers a safe reinstall.
- Gate: frontend tsc 0, server tsc 0, vitest 5251/5251, boot PASS.

**Open root causes (rule 6 — honestly recorded, need a real-sandbox / client repro to pin):**
1. **In-browser "No React entry module found".** `findEntry` (ReactPreview.ts) is already robust (index.html
   script-src → basename match → defaults incl. `src/main.tsx` → last-resort any main/index). It returns
   null only when the VFS reaching the in-browser preview has NO entry file at all — i.e. the client/durable
   file set was INCOMPLETE at render time. Pinning which set arrives short needs the actual VFS contents at
   preview time (client-side). Not shipping an unverified change.
2. **preview-verify false "renders correctly" while babel had crashed.** `analyzePreviewHtml` already
   detects `[plugin:vite`/`vite-error-overlay`, so the miss is a TIMING/shadow-DOM race — browseUrl snapshots
   the DOM before Vite injects the (shadow-root) overlay. Fixing that lives in the actuator's browse timing;
   the caniuse-lite fix above removes the crash that made this misreport visible in the first place.

## 2026-07-06 — Fix 7: "preview open nahi hua" (in-browser preview rate-limited) + false "stopped responding" on a successful build

Two blockers surfaced while the admin stress-tested the fresh-build path (both are honesty/UX root causes,
the app itself built fine each time):

**RC-1 — the in-browser preview was rate-limited to 30/hour.** The admin (actively building several apps)
hit "Couldn't build the in-browser preview: Rate limit exceeded: max 30 requests per hour." The endpoint
`/api/agentv3/inbrowser-preview` used `workspaceRateLimiter` (authed:60 / anon:30) — a TIGHT bucket SHARED
across every workspace endpoint. Worse, this route authenticates by body `userId` (not a Bearer header),
so the limiter can't see the signed-in user and applied the **anon:30** tier. But the in-browser preview
is the ALWAYS-available preview path: a self-contained HTML render built LOCALLY from the files — no AI,
no external API, no cost, and already server-side CACHED — yet the client re-renders it on many normal
interactions. Capping the CORE preview at 30/hour is wrong. Fix: dedicated `inbrowserPreviewRateLimiter`
(`INBROWSER_PREVIEW_RATE`, its OWN bucket, authed:1200 / anon:600 — generous but still bounded so a
runaway client can't hammer the bundler). Test: authMiddleware.test.ts +2 (config far above the old 30;
own bucket name).

**RC-2 — a successful build showed "The build stopped responding".** On the 10m/98-step landing page, the
app built + preview-verified + "Done · 98 steps" rendered — then the silent post-build REVIEWER phase kept
the stream quiet past the client's 35s stall window. The watchdog probed, saw the build had FINISHED
server-side (buildRunning=false), and wrongly showed "stopped responding" on an app that actually
succeeded. Root cause: the watchdog treated "not running" as a stall even AFTER the terminal `result` was
already received + rendered. Fix: pure `stallWatchdogAction({alive, sawResult})` → reconnect / finish /
error; a `sawResultRef` (reset per build, set the instant `result` arrives on any stream path) means "gone
but result already seen" = clean FINISH (no scary error), only "gone with no result" = the honest error.
Test: useAgentV3Build.stallWatchdog.test.ts +3.

- Gate: frontend tsc 0, server tsc 0, vitest 5267/5267, boot PASS.
- NOTE (still open, needs the build-diagnostics JSON): WHY a simple landing page took the 10m/98-step
  AGENTIC path (not the ~2-3m fast lane) is a routing/classification question — asked the admin for that
  run's Build report to autopsy it properly rather than guess. The 2m52s/33-step run shows the fast path
  is healthy when taken.

## 2026-07-06 — Fix 8: "build report ban hi nahi rahi / save-download nahi ho rahi" (two root causes)

The admin's "Build report" button showed the alert "No build report yet — build an app first…" right
after a real, SUCCESSFUL build (REVIEWER/Done visible behind the dialog). Two independent root causes:

**RC-1 (server — the real blocker): the session download 404'd on a workspaceId mismatch.** The button
downloads via `/api/agentv3/diagnostics?scope=session`. That path aggregated ONLY this workspaceId's
durable history + latest doc, and 404'd when empty. But a workspaceId mismatch is common and expected —
an anon-degraded build saves under `agentv3-anon-*`, or a fresh session mints a NEW workspaceId — so the
history is empty even though the user HAS a durable last-build report. The NON-scope path already recovers
from exactly this via `loadLatestForUser(userId)` (its own comment documents the case); the session path
FORGOT the fallback and 404'd → the client's blanket "No build report yet". Fix: add the same per-user
durable fallback to the `scope=session` branch (mirror the proven non-scope recovery).

**RC-2 (client — iOS can't save + a masking message):** the download used `<a download>` + a Blob URL,
which iOS Safari IGNORES (the admin is on iPhone) — nothing saves. New `src/lib/downloadFile.ts`
(`deliverTextFile` + pure `pickFileDeliveryStrategy`) prefers the Web Share API with a real File (iOS
share sheet → "Save to Files") and falls back to the anchor download on desktop. Also: the client showed
"No build report yet" for ANY non-ok status — now it distinguishes 404 (genuinely none) from a
fetch/server hiccup (honest "server said N, try again"), so a transient failure never masquerades as
"your build produced no report".

- Tests: downloadFile.test.ts +2 (share on iOS-capable, anchor on desktop). Gate: frontend tsc 0,
  server tsc 0, vitest 5269/5269, boot PASS.
- Both fixes are complementary: RC-1 makes the fetch SUCCEED (report found via per-user fallback), RC-2
  makes the found report actually SAVE on iPhone.

## 2026-07-06 — 3-role chat FIX Phase 1: Plan/Advise are sendable anytime + actually reply (admin bug report)

Admin: selecting Plan/Advise "does nothing" — root causes (both CLIENT-side; the server role lane at
routes/agentv3.ts:2660 was already correct, concurrent, before the build lock):
1. **No Send during a build** — the composer showed only Stop while `running`, and `send()` early-returned
   on `|| running`. Plan/Advise are READ-ONLY (never take the build lock) so they must be sendable anytime.
2. **Send → error, no reply** — Plan/Advise rode the build's `start()`/`running`/abort path, which resets
   and owns the single build stream, so a role turn collided with / was blocked by the build.

Fix (decouple the read-only lanes from the build): new component-local `sendRole(role)` in AgentV3Panel —
its OWN in-flight flag (`roleBusy`) + AbortController, POSTs `/chat` with `chatRole`, streams the reply
into the SHARED thread (`agentHistory`), and NEVER touches the build's `running`/abort/state. So Plan/
Advise now:
- send EVEN WHILE a build runs (the composer shows a Send button, not Stop, in Plan/Advise mode),
- return a real streamed reply (proposed steps surface via `roleProposedSteps` → the same approve-to-queue
  card, now shown during builds too),
- can never clobber a live build.
Mode-aware placeholder makes switching visibly change the composer ("🧠 Plan mode (read-only)…" /
"🔍 Advise mode (read-only)…").

This is Phase 1 of the admin's 3-sides model (one session, one shared history, Build default, switch
anytime). Next phases: clearer 3-side UI + build-aware responses + Advise capability cards
(Scan bugs / Compare / Speed test / Security scan / …).

Gate: frontend tsc 0, vitest 5234/5234 PASS, build PASS. Client-only; server role lane unchanged.

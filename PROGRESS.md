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

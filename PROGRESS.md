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
- **Remaining/next:** P6 cutover (make v3.0 default, retire old builders) — only after live dogfood; conversation persistence (D7) reconnect-durable backend; wire GitManager.restore to a History→restore endpoint (needs persistent sandbox mapping); editable-todo UI (bidirectional); BYOK option. Live run still requires admin to set keys + flag (real Claude+E2B spend) — not exercised in-session (no keys).

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

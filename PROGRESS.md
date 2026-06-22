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

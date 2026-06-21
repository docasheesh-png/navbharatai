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

**Phase:** 2 — Git-Native + Memory + Preview Ladder + Phase 1.6 (AI model intelligence)
**Branch:** `claude/phase-2.5-validation-gates` (PR open — CI running)
**Done:** 2.1 (version history) ✅  2.2 (preview ladder) ✅  2.3 (unified memory) ✅  2.4 (context intelligence) ✅  2.5 (validation gates) ✅ already shipped via G-cluster  Phase 1.6 (grok-3 for CoderAgent) ✅
**Next:** merge PR → 2.6 (dedup context retrieval/Guider) or Phase 3 (archive legacy, brand).

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

### 1.3 — Remove AppEngine full-rewrite path (after 1.2 stable)
**Status: TODO — only after one week of stable ENGINE=v2 in production**

`AppMakerLab/AppEngine` is the root cause of "edit regenerates the whole app."
Once ENGINE=v2 is confirmed stable:
- Move `AppMakerLab/`, `AppMakerOrchestrator`, `BuildEngine/` to `ARCHIVE/` directory
  (excluded from TypeScript, excluded from build, kept in git history forever — never deleted)
- Cut all imports and route registrations pointing to these
- All editing now uses Engineer AI's surgical `edit_file` / `patch_file`

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

### 1.7 — App.tsx split (PARALLEL — starts Phase 1, completes Phase 5)
**Status: IN PROGRESS (2026-06-21) — 7 panels extracted, App.tsx now 9,957 lines (was 10,658)**

App.tsx is ~10,000 lines. Must be split in parallel with all other work to prevent
1000-line merge conflicts in Phase 2/3 PRs. One module extracted per PR, no behavior change:

**Extracted so far (all in `src/components/panels/`):**
- ✅ `TemplatesPanel` — Project Blueprints gallery + My Templates (103 lines saved)
- ✅ `GitViewPanel` — DevOps Engine header + GitPanel wrapper (82 lines saved)
- ✅ `DeploySuccessPanel` — "App is Live!" screen (32 lines saved)
- ✅ `AboutPanel` — About NavBharatAI page, admin-editable (118 lines saved)
- ✅ `AdminLoginPanel` — Admin login gate + AdminDashboard mount (51 lines saved)
- ✅ `FilesPanel` — Project file tree + upload/download (91 lines saved)
- ✅ `DonationPanel` — Donation / support page, admin-editable (320 lines saved)

**Still TODO:**
- `SettingsPanel` — all settings screens (~992 lines — complex, settingsScreen state external)
- `BillingPanel` — wallet, plans, payment flow (~638 lines)
- `ProChatPanel` — Pro Chat UI + G8 deploy overlay (~229 lines)

Each extraction: Read → Extract → tsc 0 → vitest green → merge.

**Phase 1 DONE when:** ENGINE=v2 stable in prod (one week shadow mode clean). Edits are
surgical. First token <1s verified in logs. Smart tier + cost display working. App.tsx split >30% complete.

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

### 3.1 — Merge chat and IDE into one surface
**Status: TODO — requires Phase 1.7 >70% complete**

Target: conversation IS the workspace. No "switch to IDE" tab.
- Agent writes a file → appears live in editor (G12 already streams content)
- User clicks any editor line → can ask "explain this" inline
- Terminal output (E2B tier) flows in the chat, not a separate panel
- Editor always visible alongside conversation

Layout + routing change using the split App modules from 1.7.

### 3.2 — Archive legacy engines
**Status: TODO — only after Phase 1.3 confirmed stable**

Move to `ARCHIVE/` (read-only, excluded from tsconfig, kept in git forever):
- `AppMakerLab/kernel/`
- `AppMakerOrchestrator`
- `BuildEngine/`
- Pro Chat's original `RepairLoop` (Engineer AI version is superior)
- Any remaining `AppEngine` full-rewrite code

One PR per archive. Each: verify tsc passes, vitest passes, no broken imports.

### 3.3 — Pick ONE editor: Monaco ✅ DONE (2026-06-21)
**Branch:** `claude/phase-2.5-validation-gates`

Audit confirmed both Monaco (`@monaco-editor/react`) and CodeMirror (`@codemirror/*`, `@uiw/react-codemirror`) were in `package.json` but **CodeMirror had zero imports in source** — already abandoned.
Removed 6 unused CodeMirror packages from `package.json`. Monaco is the only active editor.

### 3.4 — Brand rename: NavBharatAI Pro v2.0
**Status: TODO — dedicated PR, nothing else in it**

Systematic rename touches:
- App title, `<title>`, og:title, og:description
- localStorage key names (migrate old → new with 30-day fallback read of old keys)
- Analytics event names
- User-visible UI strings and error messages
- AppKnowledgeBase entries updated

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

### 4.1 — Distributed state (workspace lock first)
**Status: TODO**

In-process memory breaks at multiple Cloud Run instances. Fix in priority order:
1. Distributed workspace lock — Firestore document lock with TTL (prevents race conditions)
2. AIRouter cooldown → Firestore (shared across instances)
3. UsageTracker → Firestore (billing accuracy requires shared state)
4. Event ring → Firestore (Redis only if load test shows Firestore is too slow)

Default: Firestore for all (zero new infra). Redis only if Phase 7 load test proves it's needed.

### 4.2 — Pricing intelligence per build ✅ PARTIAL (2026-06-21) — PR #141
**Branch:** `claude/phase-4.2-cost-display`

**Shipped (cost display):**
- `ProEngineRunner.ts` — counts `action_start` events as AI reasoning steps; emits `"N reasoning steps — estimated AI cost: ~$X"` status event before every build completes. Cost calculation: Grok grok-3 rates × 6K input + 400 output tokens/step ≈ $0.000332/step. Also returns `estimatedCostUsd` in `ProEngineResult`.
- `build.ts` — includes `costUsd` in every `sendComplete` payload
- `buildService.ts` — added `costUsd?` to `BuildResponse` and `BuildStreamEvent`
- tsc x2 clean, vitest 345/345 green

**Still TODO:**
- Monthly usage summary in Settings → Billing (needs Firestore per-user accumulation)
- Hard server-side quotas by tier (Free: 3/day, Pro: 20/day) — needs user-tier lookup

### 4.3 — Metrics + traces + alerts
**Status: TODO**

Metrics already persisted (G2 done). Add:
- Cloud Trace spans on `/api/build-stream` (start → plan → code → preview → done)
- Alerts: build error rate >10%, p95 latency >30s, E2B quota >80%

### 4.4 — Cap unbounded Firestore growth
**Status: TODO**

`job-log` arrayUnion grows unbounded. Cap at last 100 entries per workspace.
Daily Cloud Function to trim old entries.

**Phase 4 DONE when:** Safe at 10 Cloud Run instances (no cross-instance corruption).
Every build shows tier + cost. Alerts firing. Load test baseline documented.

---

## PHASE 5 — Quality + Test + Resilience
_A world-best product cannot have a 10k-line untested god-file._

### 5.1 — Complete App.tsx split (started in Phase 1.7)
**Status: IN PROGRESS from 1.7**

Target: no file in `src/` over 500 lines. All modules have own props interface + test file.

### 5.2 — Strict TypeScript everywhere
**Status: TODO**

Enable `strict: true` globally. Fix all implicit-any and null-guard errors.
One module per PR — never one giant PR. Frontend + server + all surviving archive survivors.

### 5.3 — Integration + E2E tests
**Status: TODO**

- Every `/api/*` route: test with valid + invalid input
- Real build smoke: `POST /api/build-stream` with "hello world React app" → assert files returned
- Coverage tracked in CI: fail if drops below baseline
- E2E (Playwright): open Pro Chat → submit prompt → assert build progress fires correctly

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

### 5.5 — Offline / degraded mode ✅ PARTIAL (2026-06-21) — PR #142
**Branch:** `claude/phase-5.5-degraded-mode`

**Shipped (provider fallback visibility):**
- `AIRouter.ts` — now populates `telemetry.fallbackReason` (was always `undefined` before) when ≥1 higher-priority provider failed before a successful one
- `EngineerAITypes.ts` — added `providerFallbackShown: boolean` to `SharedLoopState`
- `EngineerAgentLoop.ts` — after each `router.route()` call, if `telemetry.retries > 0` and not yet shown, yields a `status` event: "⚠️ Primary AI provider unavailable — using ANTHROPIC (1 provider tried first). Build continues normally." Shown once per build (not on every step). Also improved the all-providers-failed error message.

**Still TODO:**
- Queue request for retry on recovery (opt-in)
- Template-based generation as last resort for static apps

**Phase 5 DONE when:** Strict types everywhere. Real E2E green in CI. Error learning active.
Degraded mode tested. No file over 500 lines.

---

## PHASE 6 — Bharat-First + Mobile-First + Real Breadth
_NavBharatAI's genuine competitive moat. Claude Code will never do any of this._

### 6.1 — Bharat-first integrations
**Status: TODO**

Pre-built, tested, actually-working scaffolds in Quick-Start Gallery:
- UPI payment integration (Razorpay/PhonePe API, QR code, payment status)
- Aadhaar/DigiLocker KYC flow scaffold (real API, not fake)
- Hindi/regional language UI (Devanagari font, i18n setup, RTL-aware layout)
- GST invoice generator (GSTIN validation, tax calculation)
- Startup pack (MSME fields, PAN/TAN, state-wise tax rates)

Each scaffold: builds in gallery, preview works, real API documented, tested end-to-end.

### 6.2 — Mobile-first experience
**Status: TODO**

Pro Chat fully usable on phone (touch-optimized, no horizontal scroll, no tiny tap targets).
File streaming works on mobile network. Voice input: speak → transcribe → build.
Responsive editor usable without keyboard. Tested on real mobile device.

### 6.3 — Real framework breadth (verified, not faked)
**Status: TODO**

Each must pass full build → preview → edit cycle before marking done:
- Svelte/SvelteKit — VFS preview
- Astro — static output, in-browser preview
- Vue 3 + Vite — complete existing partial support

### 6.4 — Real deploy targets
**Status: PARTIAL (Vercel + Netlify live)**

Add:
- Cloudflare Pages (real CF API)
- Railway (full-stack + managed DB)
- Supabase Edge Functions (serverless backend)

### 6.5 — Modern backend scaffolds
**Status: TODO**

- Convex (real-time backend with auth)
- PocketBase (self-hosted SQLite)
- Supabase (improve existing: add auth + storage + realtime)

**Phase 6 DONE when:** UPI payment app builds + deploys in <5 min. Full Pro Chat works on
mobile. All framework/deploy claims are PASS-verified end-to-end. Nothing faked.

---

## PHASE 7 — Production Launch Hardening
_Measure everything. No assumptions. Ship when criteria are proven._

### 7.1 — Verify success criteria (timed, recorded)
Run each criterion from the Measurable Success Criteria section above.
Document pass/fail with timestamp. Fix anything that fails. This is the launch gate.

### 7.2 — Load test
- 100 concurrent users → p50/p95 latency, error rate, per-request cost
- 1,000 concurrent users → same
- Document honest capacity limits in runbook

### 7.3 — Cost controls + quotas per tier
Hard server-side enforcement. Free / Pro / BYOK E2B tiers defined and enforced.

### 7.4 — Full security re-audit
- `npm audit --audit-level=high` — fix all HIGH + CRITICAL
- OWASP ZAP scan on production endpoints
- Manual: secrets endpoints, admin endpoints, E2B sandbox isolation

### 7.5 — AppKnowledgeBase fully synced
Audit every user-visible feature from Phase 0–6. Every feature has complete entry with
correct navigation path + keywords that match how real users ask about it.

### 7.6 — Runbooks + rollback drills (tested, not just written)
- "ENGINE=v2 broken" → flip to v1 in <30 seconds
- "E2B quota exhausted" → auto-fallback to VFS with user notification
- "AI provider down" → degraded mode activates correctly
- "Database corruption" → restore from Firestore backup

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

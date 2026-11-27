> 📚 **Older entries are archived by month in `docs/progress/PROGRESS-YYYY-MM.md`** (moved verbatim on 2026-11-24, admin decision):
> `PROGRESS-2026-06.md` (112), `PROGRESS-2026-07.md` (546), `PROGRESS-2026-08.md` (400), `PROGRESS-2026-09.md` (664), `PROGRESS-2026-10.md` (270). This file keeps the current month and every undated entry, and stays append-only.

## 2026-11-09 — Voice AI text-to-speech implementation (not production activation)

Added a separate white-label Voice AI mode between Image Generator AI and Teacher AI. It uses the reviewed text-to-speech REST schema and nine language-specific built-in personas, with playback and WAV download. Existing live voice conversations, chat provider chains, Pro/App Builder and user projects are unchanged.

Pricing is an explicit reviewed supplier rate and supplier tax configuration, at 2x effective cost with exact fractional settlement. The temporary paise-rounded hold is released atomically before the exact final debit, preserving the existing token carry rather than imposing a minimum fee. Generation requires an authenticated account, current accepted quote and an atomic wallet reservation. A durable request identity prevents replayed inference or double charging. Failed/disconnected responses refund; successful HTTP response completion permits settlement. Crash recovery refunds expired holds in bounded, paginated batches. Provider timeout never triggers a retry. Prompt/audio/credentials are not persisted in operation records or logs.

Review found two shared safety conditions: legacy wallets could merge while holding pending reservations, and the existing rollup helper can trim more than 50 open holds. All wallet merges now reject pending reservations; Voice AI refuses a full hold bucket or a retired canonical owner. Tests cover duplicate admission, transaction conflicts, refunds, expiry, delivery races, canonical-owner changes and poisoned recovery pages. The new real Firestore drill is part of CI. Frontend helper filenames avoid case-insensitive native module collisions.

The collection census exposed an omitted financial-retention classification during the first full run. Voice operations are now explicitly retained financial/idempotency evidence, and account erasure transactionally preserves wallets with unresolved reservations so pending refunds remain recoverable. Other profile/Auth deletion behavior is unchanged; later wallet erasure still needs reconciliation. A delayed admission cannot dispatch against an expired hold. Focused regressions and a real Firestore deletion/refund/replay case cover these paths.

The window registry now includes a sidebar-hidden Voice chip so standalone views remain closable while Mode windows stay parented. Navigation regressions pass. Two unchanged full-suite census tests exceeded their original timeouts; exact-source TypeScript preprocessing reuse and parent-free parsing with equivalent explicit parent traversal remove redundant work. Full-corpus/fixture output and visited-node equivalence were checked; focused instrumented censuses pass without changing timeouts, scan scope, assertions or coverage thresholds.

The complete serial run on the earlier frozen Voice tree recorded 49,800 passed, five failed and 90 skipped; it was not a passing release gate. It exposed two guide references and three timing-sensitive tests. The guides and cold gift-policy read are now repaired; ordinary trial gifts, protected build-only grants and refund provenance have focused and real Firestore coverage. Main 9eb0317 was reconciled without replacing its Qubax work. Static restore analysis now runs in a bounded test-only child with complete inventory/body equality, while all policy assertions and production coverage stay intact. Separate recipe dependency/contract work removes repeated generation and parsing without changing generated output or provider routing; real PGlite fixtures preserve cold-constructor and isolated SQL execution while reusing only a pristine catalog. Final combined-tree gates remain required.

Validation must be read from the exact PR/commit evidence: focused local tests are not proof of real provider access, hosted CI, merge or deployment. Full CI-equivalent validation and paid provider acceptance remain release gates. No provider calls, billing-plan changes, secret setup or live deployment were performed by this implementation. The feature stays honestly unavailable unless explicitly enabled with reviewed server configuration. Actual account terms/DPA, privacy disclosures, invoice pricing and output compatibility must be reviewed before activation. See docs/VOICE_AI.md for operating limits and rollback.

## 2026-11-08 — E2B lifecycle safety audit, first bounded repair

Baseline: 6dca2d474871aeafa615ebc683517f0de1e2c61b. Requested objective: reduce sandbox waste without damaging user-built apps. This is not a measured savings claim, a production rollout, or completion of the broader optimization program.

Fixed: raw-document pagination prevents stale history starving later orphan candidates; automatic pause failures no longer escalate to kill or false paused metadata; sweeps are single-flight; allocation/activity compare-and-set and local rechecks preserve replacement state; busy heartbeats refresh only an existing matching durable allocation. Timeouts, template resources, build logic and user data are unchanged.

Proof: 21 sandbox test files / 282 tests pass with Node 22.23.4, npm 11.18.0 and lockfile dependencies. A real local Firestore emulator passed tied-record pagination and allocation/activity CAS/heartbeat checks. All six existing emulator drill scripts passed. Security/signature/license/SBOM, frontend/server/benchmark typechecks, unused-import/native guards, OAuth/Mitrify/quality checks, build, bundle, boot and server-dependency checks passed locally. Full coverage is not yet a passing result: an initial reconstructed checkout retained one file already deleted on main (corrected locally), and this environment's Node proxy warning makes the existing branding stderr-empty assertion fail. Required PR CI must pass; no gate is bypassed or weakened.

OPEN: cross-instance ownership fencing between the final activity read and provider pause; real provider baseline and per-template cost attribution; existing snapshot expiry/recovery evidence; safe staged rollout and measured savings. The scan cursor is process-local and is not a complete-inventory or 20-minute reclamation guarantee. See docs/E2B_COST_SAFETY_REVIEW.md for root causes, tests, limits, rollout and rollback.

## 2026-11-04 — Follow-up: fix the eight baseline failures and Google startup guard

Owner: find the root cause of all eight failed checks; Gemini and Vertex were
switched OFF with the Admin → AI Engines buttons. Global HTTP/fetch/HTTP2 now
holds these two families before the first successful durable switch read; restart,
first-read failure, later read failure and stale snapshot ordering have regressions.
No admin switch is turned on by this change.

Four stale assertions covered deliberately retired test-account routing or an
extracted health helper; tests now enforce the documented 2026-11-02 retirement
and the actual helper's never-used/failed/successful states. Hosting waivers remain
independent and tested. The Admin capacity description uses the current AI Chat
name. Three terrain timeouts came from repeatedly scanning every triangle in the
native raycast test oracle. The oracle now partitions the same index buffer into
bounded batches; every probe/assertion remains. A separate equivalence test compares
native raycasts across transforms, misses, vertex edits, draw ranges and groups.
Terrain coverage tests: all 21 pass in 16.71s (previous baseline 3 timeouts/156.52s).
Final local validation passed: 3,213 files, 48,434 tests, 85 skipped; coverage
statements 75.66%, branches 71.60%, functions 78.28%, lines 77.66%. All CI-equivalent
checks passed, including the locked emulator drills. No gate/timeout was weakened.
Code verified at 7747f84d8; this entry records its results. PR/hosted CI follow;
no live setting or deployment is claimed.

## 2026-11-04 — Ordinary Chat default provider order (local implementation; publication blocked)

Owner requested GLM 4.5 Flash → GLM 4.7 Flash → Groq → Cloudflare → verified-free
OpenRouter → CheaperInference → DeepInfra 8B → DeepInfra DeepSeek V4 Flash → GPT-5
Nano → GLM FlashX → paid Gemini Flash-Lite, with Gemini/Vertex remaining OFF.
The constant already matched; default selection and quality promotion did not.
Default selection now uses the shared ON policy at context/entry/config and 100%
rollout when no override exists. Classification retains output sizing, while
promotion requires explicit route-reorder opt-in. Family OFF is checked before
quota reservations even if credentials were captured before the switch. Gemini is
withheld before the first successful switch-state read; monotonically applied
snapshot revisions prevent delayed reads from undoing newer OFF settings.
Gateway/Strict Free, saved controls, private/health exclusions, account evidence,
quotas, budgets, four-attempt limit and exclusive admin diagnostics remain intact.
See docs/FREE_CHAT_CHAIN.md for scope and exceptions. No live settings changed.
Validation: 518 targeted tests passed. CI-equivalent typechecks, unused imports,
native/OAuth guards, security audit, signatures, license/SBOM, build, bundle, boot
and production-dependency gates passed. Locked emulator: 21 queue/retry, 13 autopsy,
8 DeepInfra and 78 session-rule assertions passed. Full coverage run completed:
48,422 passed, 8 failed, 85 skipped (3,206 passing files, 6 failing files).
The five assertion failures reproduce on untouched main 9dac8a71a (admin engine
status, admin display naming, Weak Router pinning and two test-account checks).
All three terrain timeouts also reproduce under coverage on untouched main
(18 passed, 3 timed out at the unchanged 20-second limit). All eight failures
therefore reproduce on the baseline. Coverage gate is NOT green. Per the mandatory pre-push gate,
branch remains local: no push, PR, hosted CI, merge or deployment yet.

## 2026-11-03 — Autopsy of build report #1836 (958aa1ec, second-newest failure)

3D endless car racing game, weak tier, ENGINE_R1 `deepseek-v4.1-flash`, RED in 170 s, never charged; all 162 issues and 18 model calls read.

**Tally:** ✅ self-healed 1 (SPACING_SNAPPED on our own kit) · 🔀 workaround 1 (PROVIDER_FALLBACK with nothing to fall to) · ⏭️ skipped 0 · ❌ shipped broken 3 (provider exhaustion, starter page left showing, outcome unexplained) · 🥵 struggle 1 (80 s of reading the kit, 0 writes).

| Item | Root cause → class | State |
|---|---|---|
| "no login, multiplayer, purchases or backend" made multiplayer a REQUIRED feature and the game a LARGE build | `withoutDeclinedSentences` dropped only the clause that began with "no"; `gameIntent` and the scope's heavy-infra check read raw text → *a refusal's list read as requests* | ✅ this PR: a refusal now covers its bare list items (and do-not clauses); both readers use it |
| OUTCOME_UNEXPLAINED although BUILD_ERROR named the cause | `terminalOutcomeCode` (2026-10-30 fix) knew two terminal sentences, not the provider chain's → *a terminal message the classifier did not share* | ✅ this PR: prefixes exported from `buildOutcomeSummaries`, the chain builds its message from them |
| SPACING_SNAPPED rewrote `touchControls.ts` and `meta.ts` — our kit — on every game build, and moved the knob 2 px off centre | the kit shipped 10/14/18/26 px → *a heal that fires on our own output* | ✅ this PR: kit on the grid (knob 48 px, centred); census over every recipe file |
| Fast empty reply labelled OUTPUT_BUDGET_STARVED | label from flags, not from time | 🔲 Q-2308 |
| Router One alone in the chain; the build ended on its one empty reply, starter page left | weak routing order (RED test on `main` since #4065) | 🔲 Q-2309 (another session's area) |
| Fast-lane gate and floor budget disagree on whether the engine reasons | two capability sources, ladder rung vs model that ran | 🔲 Q-2310 (class of Q-2306) |
| DESIGN_CONSISTENCY counts the kit's own colours | linter scope includes platform files | 🔲 Q-2311 |
| 80 s of exploration, nudge silent | — | 🔲 Q-2312 |
| DISCOUNT_COST_UNCONFIRMED | an honest billing note (unverified supplier cost excluded from the charge) | ✅ not a defect |

**Lock:** `tests/theDeclinedListStaysDeclined.test.ts` (8, the report's request verbatim). Reversion-proved: refusal covers only its clause (3 fail), game contract on raw text (1), provider exhaustion unnamed (1), kit back off-grid (1).
## 2026-11-03 — Autopsy of build report #1846 (c71e56de, newest failure): Q-2301 + Q-2303

Admin: *"/failedbr me new to old one by one autopsy karo"*. #1846 ("car age nahi bad rahi hai!!", 3D racing game, weak tier, SURPLUS qwen3-coder, 431 s, RED) is the newest failed report. With #1844 (8701aaa1) and #1845 (7aa2fe7c) it was already autopsied by #4069 (merged): the per-call `ctx` and driveVehicle's lost state were fixed there; Q-2301…Q-2307 were left OPEN. This change resolves two of them from evidence in #1846 itself (all 212 issues and 41 model calls read).

- **Q-2301 — the error reached the builder with no file.** Evidence: the repair prompt carried only "Cannot read properties of undefined (reading 'rotation')"; the builder edited `Bird.ts`, whose rotations were already inside a try/catch. Root: every browser lane records `error.stack`, every reader kept `e.text` (`formatRuntimeErrors` had learned the stack in autopsy 95598899 — only its own lane used it). Class: an error's site captured, then dropped before the model sees it. Fix: `locatedErrorText` (runtimeErrorSite.ts), used by the three render checks that feed the preview repair prompt, the auto-repair reproduce check, the `console_errors` tool and AutoFix; the game playtest keeps `errorStacks` beside its errors and reports through `firstPlayError`; ToolDispatcher's actuator port now types `stack`. Census in `tests/aRuntimeErrorNamesItsFile.test.ts` (the red-team fuzz classifier is the one listed exception). Watch: a repair prompt or GAME_DEFECT_RUNTIME_ERROR line ending in `[at src/…:line:col]`.
- **Q-2303 — "the console was read and it was clean", three times, while the game threw 1,298 errors.** Evidence: +61 s, +119 s and +328 s; the last read came 32 s after the builder's last edit and after no browser look. Root: `captured` meant "the log file exists", and the log outlives the turn (resumed sandbox, append-only), so a window no browser looked in read as clean. Siblings: the fallback screenshot browser had no listener at all; the daemon attached to a new page only on its next 1-second poll; the empty session marker carried no time. Fix: stamped `{kind:'session'}` markers from every lane (browseUrl when painted, both screenshot lanes, each browser action, daemon launch); `captured` = an error in the window or a stamped look in it; `lastSessionAt` returned; `console_errors` says "BEFORE your last file change … NOT evidence" when the newest look predates the last write (`consoleCleanVerdict`), and that a game in PLAY is measured by the playtest. Also closes a quieter hole: a stale log could let a dead preview earn RUNTIME_VERIFIED.
- **Proof:** `tests/aRuntimeErrorNamesItsFile.test.ts` (8), `tests/aCleanConsoleReadCoversOnlyWhatItSaw.test.ts` (13, every browser script `node --check`ed). Reversion-proved: helper drops the site (3 fail), one render check back to bare text (2), captured = file exists (1), stale read not called stale (1), fallback screenshot without listeners (1). 189 related test files, 4,110 tests green.
- **Still OPEN from this report family:** Q-2302 (silencing try/catch accepted), Q-2304 (final text vs RED gate), Q-2307 (TODO tests counted as proof); Q-2305/Q-2306 are the admin's decisions.
## 2026-11-03 — failedbr: the newest failed build is row 1, at a glance

Admin: *"koi aisa system banao, jisse ek nazar me hi sabse new br pata lag jaye … sabse pahle show hone wali br sabse new ho"*.

- **Root cause:** `list_failed_builds` (and `/api/failedbr/reports`) walked workspaces by document id, so the newest failure could be anywhere among ~640 rows; finding it meant reading them all. Clients holding the pre-1.3.0 tool list could not reach the new sorted tool either.
- **Fix:** the failed list now reads the build report registry from the HIGHEST permanent number down (`scanRegistry`, one shared walk for this list and `list_build_reports`), keeping `failed` + `stopped` (exactly `settledFailure`). Row 1 of page 1 is the newest failed build, for every client, with no reconnect. `observation.ordering` says `newest-first`; while numbering is pending the old walk serves the page, marked `workspace-history`, so nothing disappears. A v1 cursor is refused with a clear message; a malformed cursor is judged before storage. The numbering job re-sweeps daily, so a report whose history write failed half-way still gets a number within a day. Admin `/failedbr` sorts by the same number. MCP server 1.4.0; tool text and server instructions say newest-first.
- **Lock:** `tests/buildReportRegistry.test.ts` "the failed list is NEWEST FIRST" (first row = highest failed number, paging without repeats, old cursor refused, expired = gap, daily re-sweep). Reversion-proved: oldest-first (4 fail), no re-sweep (1).

## 2026-11-02 — Built apps and games are LIGHT unless the user asks for dark

Admin: *"jab navbharatai par koi app ya game banaya jata hai, to woh, dark mode banta hai. mai chahta hu, jab tak user saf saf na bol de, tab tak light mode me hi game banne chahiye!!"*

- **Root cause:** the design kit every scaffold ships (`designKit.ts`) followed the DEVICE (`color-scheme: light dark` + `@media (prefers-color-scheme: dark)`). Most phones are set to dark, so the phone, not the user's request, chose the look. The game recipe's stage (`--game-bg: #0b0a1a`) and its overlays were hard-coded dark on top of that.
- **Class:** a built app's theme chosen by the phone setting or by the model's own taste, not by the user's words.
- **Fix (DNA level):** the kit is light whatever the device says (`color-scheme: light`); `withThemeSwitch` now REPLACES the device block with the switch blocks, so the unchanged dark palette applies only when the app sets `data-theme="dark"` / class `dark`. The game recipe's dark literals are tokens (`--game-bg/-fg/-glow/-scrim/-glass*/-line/-chip/-track`), light by default and dark under the same switch. `LIGHT_THEME_BY_DEFAULT_RULE` (noEvalRule.ts) rides every lane (architect, fast lane, one-shot, writing sub-agents): light unless the user's own words ask for dark; 3D scenes lit as day.
- **Siblings fixed:** `kitRestore.ts` (restore and keep-on-rewrite re-added the device block — now only an app's OWN device block is kept); `SettingsScaffoldGenerator` default `system` → `light`; golden `ThemeToggle` started on `auto` (device) → starts light, `auto` is the person's choice and is now really resolved; `ConsentBannerGenerator` dark scoped to the app's switch; `GameShellGenerator` black canvas host and dark WebGL fallback → light tokens; golden game canvas fallbacks; `project/aiEdits.ts` said "Follow the system light/dark preference" → light by default; two prompt lines that said "follows the device".
- **Lock:** `tests/appsAreLightUnlessTheUserAsks.test.ts` (kit output, game tokens + contrast in both themes, every lane, scaffold defaults, and a CENSUS: every server file mentioning `prefers-color-scheme` is listed with its reason — a new one fails). The real-browser test in `theDarkModeButtonSwitchesTheKit.test.ts` now asserts a DARK device with no switch renders LIGHT. Reversion-proved: kit follows the phone (6 fail), `color-scheme: light dark` (1), restore re-adds device block (1), fast lane drops the rule (1), settings default `system` (1).
- **What to watch:** the next game and app built on a phone set to dark should open light; a request saying "dark mode" should open dark.
- **Not changed:** NavBharatAI's own pages (legal, marketing, checkout hand-off, preview loading screen) still follow the device — they are not built apps. 3D presets night/horror/neon remain available when the user asks for them.
## 2026-11-02 — failedbr: every build report, permanent numbers, filter and sort

Admin: *"usme bas failed build report ati hai, aur numbering bhi stable nahi hai … 1. sabhi build report failedbr me aye. sort/filter option bana do. 2. numbering rocksolid karo"*.

- **Root cause 1 (numbers moved):** the number shown was a RANK — `buildReportNumbering.ts` scanned up to 5,000 documents per read and sorted retained failures by start time. A report expiring off the 180-day clock, or a late arrival, shifted every number after it.
- **Root cause 2 (no permanent number ever):** the permanent allocator (`reportNumber`, failures only) read `admin_failed_report_numbers/counter`, which nothing ever created, so every report was saved with `counter_uninitialized`. Confirmed live: no row carried `permanentReportId`.
- **Root cause 3 (failures only):** every reader filtered with `settledFailure()`; there was no list of all reports.
- **Fix (class, not instance):** `buildReportRegistry.ts` — one row per report in `build_report_numbers` (id `${workspaceId}~${startedAt}`), its number taken once from `admin_build_report_counter/counter` inside the same transaction as the report's FIRST history write, for EVERY outcome (failed / succeeded / stopped / unfinished). Re-saves keep the number and only update the outcome. Readers look the number up (`numberBuildReports`, no scan, no cache); every screen and tool shows the same number. A leased, resumable, oldest-first backfill (`build-report-numbering` job, every 15 min, `exclusive`; one read once done) numbers older reports and then sweeps the ones saved while it ran. Numbers are never reused: expiry and erasure leave gaps.
- **Plugin:** new MCP tools `list_build_reports` (outcome: all|failed|succeeded|stopped|unfinished, order: newest|oldest, cursor bound to its filter/order) and `get_build_report` (any outcome, with number and digest). No REST twin: nothing in the app would call it, and an uncalled route is dead code (`everyRouteHasACaller`). `list_failed_builds` stays, with permanent numbers. Server version 1.3.0.
- **Retention/erase:** registry on the report's own 180-day clock (`lastSavedAt`), erased with the workspace (doc-id range); counter RETAINED_INDEFINITELY.
- **Locks:** `tests/buildReportRegistry.test.ts`, `tests/buildReportNumbering.test.ts` (expiry and late-arrival lock + class source guard), `tests/diagnosticsHistoryWriterIntegrity.test.ts`. Reversion-proved: renumber-on-save (5 fail), allocate-while-backfilling (3), no oldest-first order (4), failures-only numbering (6), rank on read (2).
- **What to watch after deploy:** the first `[build-report-numbering] numbered N` log line; until then lists say "numbering pending". The legacy `admin_failed_report_numbers` counter is retired (still classified, nothing writes it).
- **Not built:** an "all reports" view with these filters on the admin `/failedbr` web page — the page still lists failures (now with permanent numbers). The plugin has the full feature.

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
## What was fixed in THIS change

### 1. 🔴 The scaffold shipped known vulnerabilities to every app — and no heal could ever clear them

`"vite": "^5.4.1"` resolves to **5.4.21, the LAST 5.4.x**, which still carries advisories. So
`npm audit fix` — compatible-only, and exactly what `AGENTV3_AUDIT_FIX=on` runs — **could never fix
it**. npm says so itself: *"To address all issues (including breaking changes), run `npm audit fix
--force`."*

**Measured on the REAL scaffold**, emitted to disk verbatim from the template module and installed:

```
current pins  →  2 vulnerabilities (1 high, 1 moderate)
+ vitest       →  5 vulnerabilities (1 CRITICAL, 1 high, 3 moderate)   ← what this build shipped
vite ^8 / plugin-react ^5 / vitest ^5  →  0 vulnerabilities
```

⚠️ **They are dev-server flaws, and that makes them WORSE here, not better** — path traversal in
optimized-deps `.map` files, a `server.fs.deny` bypass, an esbuild dev-server request flaw. **We
publish the vite dev server on a public preview host.** A dev-server path traversal on a publicly
reachable port is sandbox filesystem exposure.

🔒 **Proven before it was written**, because a bump that breaks every build is worse than the
advisories: the real scaffold **built clean** on the new pins (947 ms → 444 ms), its **dev server
booted and served HTTP 200** with `#root` and the module script, and the exact-pinned, load-bearing
`vite-tsconfig-paths@5.1.4` still resolved. Sandbox image is `node:22-bookworm`, satisfying vite 8's
`^20.19.0 || >=22.12.0`.

**The DNA half — the drift, not the version.** The pins live in THREE places: two live copies of the
template plus a base64 blob in `e2b.Dockerfile`, whose own comment says they *"MUST stay in sync"* —
enforced by nothing. All three are updated and `tests/theScaffoldShipsNoKnownVulnerability.test.ts`
now asserts them equal **to each other**, so a future bump stays green only if all three move.

🔴 **ADMIN ACTION: the E2B template image must be rebuilt** for the pre-baked warm `node_modules` to
match. Until then the primer still primes react/react-dom and `npm install` reconciles the rest —
the Dockerfile's own words: *"correct, only less optimal"*. Builds are not broken, just a slower
install delta on vite-react.

⚠️ **Deliberately NOT done:** vite 8 supports tsconfig paths natively (`resolve.tsconfigPaths: true`)
and says so at startup. Dropping `vite-tsconfig-paths` is a second change with its own risk; this one
is about the advisories.

⚠️ **Unexplained and NOT guessed at:** the agent's own `npm install -D vitest` resolved **2.1.9**
(carrying the CRITICAL) when npm's latest is 5.0.1. We pin vitest nowhere. That is a sandbox-runtime
fact I could not reproduce from this session — recorded, not invented.

### 2. 🔴 The Researcher could not research

`researcher` advertises `best approach`, `framework choice`, `search` — and was handed
`READONLY_TOOLS` (`read_file`, `grep`, `glob`, `recall`, `evaluate`), **every one of which reads the
current workspace**. An agent whose job is "find the best approach BEFORE code is written" could only
read code that did not exist yet.

It spent a model call and 13 s replying *"I don't have a web-browsing or screenshot tool available"*.
The architect then did it itself with six `browser_action` calls, the loop-detector fired, and the
next thing it did was declare an empty workspace complete.

**The rule: a sub-agent must be able to do the job its capabilities advertise.** `web_search` is the
cheapest tool that closes it (read-only, ₹0 when unused, DuckDuckGo-first for `reference` intent) —
added to **that role only**, never to the shared constant, because `accessibility` and `reviewer`
share it and must not acquire a web budget as a side effect. A test asserts both halves.

---

## Open, with the reason (rule 6) — not silently dropped

- **A11y label + 4px grid (items 2, 3).** Both are in MODEL-GENERATED files, so the DNA fix is
  upstream: the per-page design contract in the architect prompt. ⚠️ `src/index.css` here was written
  by the FAST LANE, and `platformAuthored.ts` correctly did not shield it. Worth doing; it is a prompt
  change whose effect only a real build can measure, and I would rather ship it with evidence than
  guess at wording.
- **Journey never derived (items 4, 15).** `AGENTV3_JOURNEY_CHECK` only began launching a browser on
  2026-09-17; per its own CLAUDE.md entry the first real `JOURNEY_PASSED`/`FAILED` lines are the first
  evidence it has ever produced. **Watch the next reports before changing it.**
- **"build budget reached" at 105 s of a 1800 s build, `provider=unknown` (item 13).** The streaming
  half of this was root-caused on 2026-09-17 (autopsy fdd59ef8) and fixed; this report is from 09-19
  and still shows it, so a path survives — most likely the fast lane's own stage deadline reported in
  the language of the build budget. The fix lands in `BuildDiagnostics`/`OpenAiToolRunner`, and
  **#3162 is open in the reviewer/diagnostics area** — per the concurrency rule I am not racing another
  session into that file. Named, not taken.
- **`READY_BEFORE_END` 701 s (item 11).** `#3084` shipped this as a MEASUREMENT first, deliberately,
  and CLAUDE.md says not to build the stronger protection until the measurement produces warnings on
  real builds. This is one data point.
- **`PREVIEW_SNAPSHOT_STALE` (item 21).** The snapshot is taken, then a post-build pass writes more
  files and invalidates it. An ordering defect in the post-build sequence.
- **ETA 5.5× out (item 12).** The estimator correctly refused to SHOW a number (unevidenced), which is
  the honesty guard working. The underlying estimate is still poor; `#3157` fixes the fast lane's half.
## 2026-11-01 — Router One supplier-expense billing investigation (not shipped)

Requested policy: verified supplier actual expense times 10 exactly once, separate sandbox/other providers, configured discount last with the existing real-cost floor. Root cause: ENGINE_R1 entered model-first static rate matching, including the Sonnet fallback for unknown DeepSeek models. Local mitigation excludes unverified Router One usage before all legacy build pricing, subtracts it from the sink as well as the attributed ledger, rejects static-rate/actual-cost lookup and preserves other providers in the cost ceiling. Admin diagnostics distinguish unknown supplier expense from measured zero. Surplus is unchanged.

BLOCKED — actual-receipt ingestion and therefore positive 10x Router One charges: the reviewed public OpenAPI completion contract reports tokens but does not expose a documented per-request settlement endpoint or supplier-expense response field. Router One's customer observability documentation describes dashboard walletChargedUsd, chargeSource and planQuotaUnits; totalCost on a plan-covered call is only list-price equivalent and pending means unknown. Need a supported authenticated per-request settlement contract, its account/key/build/request binding and a redacted real response before implementing receipt validation/replay. No public tariff, synthetic receipt, aggregate dashboard total or concurrent wallet balance delta is accepted as actual expense. No paid calls, historic wallet edits or configuration changes performed.

Sources inspected: https://router.one/docs/openapi.json ; https://router.one/docs/chat/createChatCompletion ; https://router.one/llm-observability ; https://router.one/llm-cost-tracking . Local tests cover fail-closed pricing, model-rate leakage, forged receipt-like data, repeated settlement calculation, cache-inclusive input, mixed providers, sandbox, discount/floor and legacy modes. Test execution and publication status must be recorded after validation; this entry does not claim passing checks or deployment.

### Router One billing follow-up — local validation and transport audit

Preserved the documented X-Request-ID header in metadata-only admin audit events for builder and scope calls, without reading response bodies or assuming a completion id is a settlement id. These records remain expenseEvidence=unknown; they are not receipts or authorization for charges. Updated the existing billing call-site/failure-ledger source guards for the additional excluded partition. Final focused run: 10 files, 216 tests passed. Final Node 22.23.4/npm 11.18.0 frontend/server/benchmark typechecks, native guard, security audit, license gate, SBOM, build, bundle gate, boot smoke, production dependency gate, unused-import check and OAuth checks passed. Optional registry-signature verification failed to download.

The full coverage run is NOT green: it found the existing six-versus-eight runTurn census mismatch and unregistered GET /api/agentv3/router-one/catalog + POST /api/agentv3/router-one/catalog/refresh; both reproduce in a separate untouched ddfceb0cb worktree. It also hit a 20-second restore-census timeout under coverage (the unchanged test passes without coverage). The earlier queue-label and failure-ledger source-guard failures from this change were corrected and included in the 216 passing focused tests. The aggregate run began before these final corrections, so it cannot certify the final tree even when complete. Required Firestore drills could not start: the exact pinned 1.22.0 emulator download returned HTTP 403 on both ordinary and escalated attempts; no installed copy was found. No PR, push, hosted CI, merge or deployment has occurred. Local boot is the only runtime verification; no paid provider calls, live billing tests, credentials/configuration changes or historical wallet writes.

Aggregate-run disposition: stopped the obsolete coverage process after its confirmed failures because it started before final corrections and cannot certify this tree. It additionally timed out in tests/aTestThatChecksNothingFails.test.ts's whole-tree census. No aggregate pass count or coverage-threshold pass is claimed; a complete final-tree coverage run remains required after the baseline blockers are resolved. The final code's 216 focused tests and listed non-coverage gates passed. Publication is pending, not attempted or denied by GitHub; the emulator request itself failed with HTTP 403, not an automatic-approval rejection.

### 2026-11-01 recovery — completed aggregate evidence and narrow guard corrections

Completed the unchanged c5d8a0159 aggregate run: 3,171 files, 48,002 passed tests, 8 failed, 85 skipped (1,504.58 seconds). Seven failures reproduced on untouched ddfceb0cb: runTurn census (1), caller census (1), chat-handler budget (2; both trees measure 539 against 537), canary SDK census (2), admin-audit census (1). The eighth was our remaining watchdog source assertion for the changed known-cost expression; updated it while retaining the single-expression/once-write assertions. Corrected the earlier suspicion of added measured headroom branches: the measured count is identical to main, so no budget or unrelated handler refactor is needed.

The transport census now recognizes only an audit observer that wraps canaryFetch(), checks both arms of conditional transports, and rejects unguarded or unknown observers. Negative cases and guard-refusal propagation are tested. Existing SDK count and retry-policy assertions are unchanged; the pre-existing scope constructor still prevents a green census. This is an explicit validation of the new composition, not a baseline waiver.

Emulator recovery diagnosis: CONNECT is denied by the environment proxy; current enforced restricted network policy excludes storage.googleapis.com. The installed official firebase-tools downloader points to that host and its normal cache is empty. No alternate-host bypass was attempted. Need an allowed-host configuration change or the exact verified official cached artifact. CLAUDE.md lines 472 and 727 require green verification before every push; no draft or baseline waiver was found. Publication remains unattempted. Final validation after these narrow corrections is required and recorded separately.

### Router One billing recovery — baseline defects authorized (2026-11-01)

User explicitly authorized fixing the seven reproduced baseline failures. Continued `fix/routerone-receipt-billing` without replacing prior commits; main remained ddfceb0cb and no overlapping open PR was found.

- Removed the scope classifier SDK retry; admitted its guarded constructor to the exact census (five factories), retaining guard and zero-retry assertions for every construction. Reviewed both Router One/Weak delegates in the exact eight-call census and asserted completion-callback propagation.
- Extracted the existing lazy pin admission/scope selection into a tested helper; chat budget remains 537, never raised.
- Wired catalog read/refresh into the existing admin registry, with authenticated requests, unconfirmed/error states, disabled refresh until status is read, and administrator/result audit. Catalog prices are explicitly not settlement evidence.
- Added cancelled/zero-token and separate-request audit coverage. Broader targeted run: 15 files / 188 tests passed. Final-tree aggregate and remaining CI gates are still pending at this checkpoint; no claim of green/full verification.
- Rechecked official accounting docs. Positive actual-times-10 remains blocked by absent verified settlement transport. `docs/billing/router-one-reconciliation.md` specifies a disabled, trusted-record reconciliation design including identity binding, conflicts, cancellations, retries, absorption, exact arithmetic and idempotency. No importer, wallet changes or production activation.
- Enforced network policy still excludes the official Firestore download host; no available cached artifact. No forbidden retry or alternate route attempted. Publication remains gated on required checks and emulator access.

### Coverage recovery: deterministic upload-banner fixture (2026-11-01)

Completed aggregate on 7bfcd542c: 3,173 files, 48,031 passed / 1 failed / 85 skipped, 1,644.56 seconds. All seven original failures resolved. The remaining `aStorageMarkerDoesNotWireLocalUpload` failure was a module-initialization fixture calling the scanner's wall-clock-bounded path: forced timeout reproduces empty banner → no-op mutation → one finding instead of zero. Both branch and untouched main isolated runs passed 126/126, confirming load sensitivity. Replaced only banner-fixture construction with a fixed synthetic finding, asserted the actual scanner matches it, and added nonempty/non-no-op mutation assertions. Production scanner budget, security logic and expected outcomes unchanged. A fresh full coverage run is required after this test-only fix; no prior run is represented as final green.

### Coverage recovery: bounded census and deterministic semantic clocks (2026-11-01)

Completed aggregate on 41a1024fd: 3,173 files; 48,030 passed / 2 failed / 85 skipped; 1,733.39 seconds. Upload fixture fix passed. Terminal evidence confirms the entire AST census exceeded the existing 20-second per-test timeout (23 seconds) and a local-login semantic test returned no finding under its 40 ms production budget (84 ms test duration). Isolated census 18/18 and login 107/107 passed. Split the SAME complete census into <=128-file batches with an exact once-only completeness assertion; no sampling or timeout increase. Freeze Date.now only in the two semantic scanner test suites, retaining their explicit injected-clock expiry assertions, all security expectations, and production 40/80 ms budgets. No application behavior changes. Fresh final coverage remains required.

### 2026-11-01 — Router One offline export observations (follow-up to #4057)

Added a pure, disconnected CSV validator with synthetic tests and explicit unverified-export/billingAuthorized:false output. Exact micro-USD parsing, unknown versus zero, schema/quoting limits, file-local duplicate/conflict quarantine and retained cancellation charges are covered. No accepted receipts, production caller, wallet writes, real private fixtures or live imports. Supplied export establishes observed schema only; provider finality/account binding and durable request-to-attempt correlation remain prerequisites. Targeted tests passed on the initial implementation; final-tree verification is recorded separately before publication.

### 2026-11-01 — Offline validator placement correction

The disconnected parser belongs in scripts/lib, not application src. Moved it and its synthetic tests without adding a production caller or modifying deadCodeGuard. The superseded full-coverage run exposed that guard failure and was terminated at 23 minutes (exit143), not reported green. Final-tree verification follows on the corrected tooling placement.

### 2026-11-01 — Router One prospective model multiplier revised to 2.5x

Owner replaced the earlier Router One 10x target with actual model expense times 2.5. There is still no accepted Router One settlement transport or positive live charge path. The offline validator now exposes the immutable prospective ratio 5/2 while preserving unverified-export, billingAuthorized:false and the original unmarked wallet observation. Surplus stays 10x; ordinary providers, sandbox/hosting rates, routing and historical wallets are unchanged. Reconciliation documentation states the separate-subtotal, discount-last and existing floor formula, with a synthetic example. Focused parser/fail-closed/dead-code tests: 52 passed. Aggregate final-tree verification follows; this does not claim activated 2.5x billing.

## 2026-11-01 — owner-confirmed Pro fee and Weak fallback revision (local verification)

Scope: Router One prospective model markup 5/2 (Surplus stays 10); all Pro bands
replace measured VM customer billing with a 2.5% fee on the discounted AI subtotal;
Weak becomes admitted Surplus → eligible Router One → GLM → existing tail.
Profile pin/no-fallback overrides no longer bypass Weak. Shared fallback uses the
existing bench/dead-rung/stop/usage machinery; plan/heal/complex preserve provider
order and selected GLM models. Explicit retries can advance past failed tail rungs.
Missing keys and explicit Router One disable remain respected. Non-Weak routing,
hosting subscriptions and historical wallets are unchanged.

Billing class fixed: VM expense was mixed into markup, waiver/Stop and discount
floors while the user authorized a subtotal fee. Normal/watchdog/live paths now
share proSandboxFee AFTER those rules, with internal rate-priced VM expense kept
separate. Breakdown and diagnostics name subtotal/fee, and waiver/Stop copy no
longer denies the separate fee. A zero bill cannot acquire a fee. Existing exact
source/execution regressions were updated to the authorized policy, not removed.
43 affected files / 718 tests passed on the current implementation; subsequent
full gates and final coverage remain pending at this checkpoint.

OPEN: Router One positive actual-cost settlement remains blocked by verified
supplier finality/identity/request-binding evidence. Offline exports remain
billingAuthorized:false; routing does not make unknown expense billable. Unknown
Router One portions are absorbed, an economic limitation explicitly documented.
No paid calls, account changes, historical debits, CSV identifiers or credentials.
Local emulator download remains denied by enforced network policy (not retried).
Deployment verification still requires accessible Cloud Build/Run revision evidence;
this environment has no configured cloud identity. No live claim at this checkpoint.

Final focused checkpoint: 44 files / 724 tests pass, including the dead-code guard.
The final review also preserves the active Weak scope policy when a configured
ladder omits GLM: its GLM fallback model comes from the same registry with only the
ladder override removed. No configured key or spending-policy flag is fabricated.
Rollout warning sent to the owner thread: a configured Router One key with no
explicit disable makes the new Weak fallback reachable by all Weak users. Unknown
supplier expense is absorbed and is not measurable by the dollar cost ceiling;
existing admission, stop/deadline, maintenance/canary, bench and retry protections
remain, but they do not establish a verified supplier expense cap.

## 2026-11-01 15:04 UTC — catalogue-based Router One billing replaces receipt-only target

New explicit owner instruction rejects permanent platform-absorbed Router One
builds and authorizes official catalogue rate × returned actual usage, then 2.5×,
truthfully labeled catalogue-calculated rather than settled supplier expense.
Broad rollout is now BLOCKED until positive catalogue billing and missing-data
preflight/dispatch handling are tested; no merge/deploy of the silent-zero path.

Completed independent foundation: scripts/lib/routerOneCatalogueMath.ts calculates
exact decimal rates with integer arithmetic, inclusive cached reads, whole-request
long-context tiers, immutable normalized snapshot and missing-data states. It is
offline and billingAuthorized:false, not production settlement. Official docs do
not define the authenticated catalogue's price field names/units; the old discovery
engine's numeric-unit heuristic is unsuitable for billing. Need an authentic
redacted GET /v1/models pricing response or complete provider schema, plus raw
usage semantics for any non-documented cache fields. No available provider identity
here, no paid test, no guessed adapter fields. Existing fee/routing milestone is
preserved in bb76912715b6aeb8fe2d0b1871052da15d576cde, unpublished at this checkpoint.

Validation checkpoint: catalogue foundation plus offline export and dead-code guard
passed 3 files / 50 tests (catalogue-foundation.log). No verification process remains
active. Production integration is NOT complete and no branch publication, merge or
deployment has occurred. Latest owner instruction makes positive catalogue billing
and safe missing-data admission a release prerequisite; bb769127 must not ship alone.

2026-11-01 public catalogue source correction: independently confirmed explicit
DeepSeek V4.1 Flash wallet tariffs and units on its official public model page.
Authenticated GET /v1/models pricing fields are not the only viable adapter source.
Normal raw-page GET returned HTTP403; current enforced executor allowlist excludes
router.one. No alternate-route retry was attempted. Need approved source access or
authentic supplied raw HTML to validate live parsing, followed by production
snapshot/usage/billing integration. No new runtime edits, paid calls, PR or deploy.

2026-11-01 public JSON-LD reader foundation: added scripts/lib/routerOnePublicTariff.ts
and synthetic regression tests. Strict Product SKU, USD, explicit per-million units,
complete unique token components and contiguous whole-request tier validation; inert
JSON-LD decoding only, no script execution. Unsupported Chat cache-write tariffs are
excluded. Offline outputs remain billingAuthorized:false. Authentic previously captured
page fixtures are pending transfer from the parent; no live parser acceptance claimed.
Verification: 4 files / 65 tests passed; npm run typecheck passed before the final small
HTML extraction addition (that addition passed targeted Vitest). No process running.

2026-11-01 catalogue integration milestone (unpublished, verification ongoing):
inline captured public JSON-LD fixtures accepted for exact DeepSeek SKU; Luna rejected
for unsupported write usage and unverified short alias. Moved parser/math to server;
added public snapshot source, durable pre-dispatch attempt/key fence, raw usage capture,
request-ID association, issued evidence ledger attribution and separate 2.5x settlement.
Scope classifiers and tool runners share guards. Positive cost feeds existing ceilings;
unknown/uncertain responses preserve output and block more requests on that key.
Public ranking checks explicit tariffs. No CSV promotion, historic wallet changes,
paid calls or live network bypass. 14 files / 214 targeted tests and server typecheck
passed before the last malformed-state hardening. Final gates and coverage pending.

## 2026-11-01 — Router One catalogue accounting: concurrent dispatch and verification follow-up

On `fix/routerone-prospective-2-5x`, replaced the global one-outstanding-request restriction with per-attempt persisted deadlines and unresolved holds. Normal calls sharing a credential remain concurrent under existing pacing/admission. Pending usage blocks new dispatch across workers; expired reserved attempts become durable unresolved holds. A successful completion releases only its own hold. Persist/acknowledge/issue/release sequencing preserves a fence after a lost completion acknowledgement and retains billable evidence after release acknowledgement failure. A failed completion write blocks the current worker immediately; cross-worker protection follows the persisted SDK deadline. No claim of instantaneous global knowledge after a failed database write.

The completed aggregate coverage run on the preceding production tree reported 3,171 passing files, 10 failing files; 48,120 passing tests, 39 failures, 85 skipped (1,820.68s). Corrected the evidenced route extraction harnesses and old billing/wiring assertions without weakening gates; all ten failing files passed in the follow-up. Final-tree targeted verification: 13 files/205 tests, 7 files/158 tests, and 2 files/34 tests passed. Server/frontend/benchmark typechecks, native/audit/license/SBOM, build/bundle/boot, dependency, unused-import and OAuth checks passed. Full aggregate coverage has NOT been rerun on this final tree. Required remote CI remains mandatory before merge. One gate-script invocation used the wrong cwd and failed with missing package.json; rerun from the repo passed, with both logs retained outside Git.

Draft PR creation was denied by automatic approval review, which said explicit publication authorization was absent. It did not execute. Fresh confirmation is pending in the parent conversation; no retry or alternative publication path was attempted. Last published head remains a4346a6bb7a845e5aa9efed170bf42da19ff2e96. These follow-up changes are local. Public tariff live-fetch verification and local emulator drills remain blocked by enforced environment network policy; no bypass. No paid build, wallet mutation, merge or deployment performed. Evidence is preserved under /workspace/routerone-25-verification.

## 2026-11-01 17:03 UTC — terminal aggregate evidence and bounded uncertainty correction

Completed the requested aggregate coverage on 14feb7a580110cc08c29c52c934c990a2fa03176 without interruption: exit 1; 3,177 files passed / 4 failed; 48,159 tests passed / 4 failed / 85 skipped; duration 1,904.56s. Three failures were explicit timeouts in unchanged tests (aPlayerStandsOnTheGround:20s, anAutomaticRestoreReportsOnlyWhatItApplied:20s, noTestLeavesATempDirBehind:60s). They passed in the earlier aggregate run at 19,877ms / 12,713ms / 31,208ms respectively; this is timing-sensitivity evidence, not a waiver or proof of a clean baseline aggregate.

The fourth failure correctly identified new unbounded module-level uncertainKeys state. Replaced it with the repository BoundedCache, hard limit64 credential hashes. Holds are never evicted to enable spending: saturation blocks this worker's Router One dispatch until restart; durable attempt deadlines remain intact. Only uncertain persistence populates this local fence, not normal requests. Added capacity/overflow regression coverage and documentation; the census guard remains unchanged.

Follow-up, unchanged timeouts with supported --maxWorkers=1: all four failed files plus Router One persistence/accounting/positive billing passed, 7files/76tests (44.63s), non-coverage. Server typecheck passed. The aggregate above remains FAILED and full coverage has not been rerun after this small correction. Required remote CI and full-tree green evidence remain outstanding. No publication retry/push, emulator or public-site network retry, paid call, merge or deployment. Publication approval is still pending in the parent conversation. Logs: /workspace/routerone-25-verification/final-14feb7a-coverage.log, final-bounded-targeted.log, final-bounded-typecheck.log.

## 2026-11-01 — L3 external asset engine audit and local foundation (NOT COMPLETE)

Branch `feat/universal-3d-assets`, based on main `504b79298` (billing preserved). Audited
Game3DGenerator/gameKitSeed/buildAssets/WorkspaceAssetStore/publishing and existing SSRF guard.
Added local GLB policy, exact subject/license filtering, bounded guarded downloader, cache-first
acquisition core with mandatory parse/storage acknowledgements, and optional Three.js loader source.
GLB now participates in the central binary classifier; publishing knows GLB/glTF MIME types.
The acquisition core and loader are not wired into the game seed; no provider catalogue is deployed.

Provider access BLOCKED — requests to api.polyhaven.com/assets?t=models and api.github.com's official
KayKit repository tree failed with proxy 403; environment status confirms both hosts absent from its
enforced restricted allowlist. No alternate-host download retry/bypass. Parent/environment owner
must authorize needed provider API/download hosts or supply reviewed offline assets/provenance.
No actual external models downloaded; all current test assets are synthetic. No paid calls.

Dependency install succeeded after moving npm's cache to writable /tmp. Environment Node24.19.0 /
npm11.9.0 differs from CI22.23.4 / npm11.18.0. Targeted verification checkpoint: 4 files / 45 tests,
server typecheck and unused-import check passed; subsequent geometry-work bound is under final
recheck. Full coverage/emulator/CI/browser/mobile/restart/publish verification not completed.
No commit, push, PR, merge or deployment attempted. Do not claim this as the completed engine.
Detailed work/evidence/gaps: docs/game-engine/l3-implementation-status.md. Logs: /tmp/navbharat-asset-*.

L3 final local checkpoint: re-ran after geometry-work bounding; 4 files / 45 tests PASS,
frontend and server typechecks PASS, unused imports/locals PASS, git diff --check PASS.
No background test processes remain. All full-CI/live-model limitations above still apply.
Poly Haven's current official API terms were read: commercial use needs no key/payment;
identifying User-Agent and visible credit when surfacing live API content are required. Preserve
those service obligations separately from the CC0 asset licence when wiring the provider.

### 2026-11-01 — L3 independent implementation and verification follow-up

- Extended the initial foundation into the guarded 3D kit seed: default-off flag, reviewed provider
  registry, private content-addressed cache, bounded single-flight download, reviewed glTF resource
  bundling, sandbox render proof, acknowledged binary/text persistence, generated local loader,
  attribution, and restore/publish format support. Production catalogue remains empty.
- Added explicit real Chromium harness and local-only Firestore persistence harness. Chromium rendered
  and animated the synthetic textured fixture and verified runtime normalization, credit cleanup,
  missing-file fallback and reload. Firestore saved model+manifest and a fresh process restored
  identical bytes/provenance. No real provider assets, cloud bucket spill or published game claim.
- Affected 37 files / 657 tests passed; later 4 asset files / 35 tests passed (overlapping).
  Full coverage remains running separately; initial interrupted attempt exposed a seed-writer census
  assertion, which was extended with explicit guard assertions before restarting the full run.
- CI Node 22.23.4/npm 11.18.0: audit, license, SBOM, frontend/server/benchmark types, unused/native
  guards, OAuth check, build, bundle, boot and dependency gate passed. Four existing Firestore emulator
  drills passed on Java 21 and verified Firestore emulator 1.22.0.
- Required npm signature gate failed HTTP 403 (Sigstore TUF host); not waived. Provider API hosts
  api.polyhaven.com and api.github.com were already denied. No retries via alternate hosts, security
  changes, paid inference, production activation, PR or merge. Exact download origins need verified
  metadata before an environment-access request can name them.
- Updated docs/game-engine/l3-implementation-status.md with current implementation and limitations.
  Remaining acceptance includes real licensed catalogue assets, six complete games, mobile and live
  publication, optimizer/LOD scope and required CI completion. This is not a completed universal engine.
- Added and passed a production Vite-build browser harness: synthetic GLB and manifest survive the
  real build byte-for-byte; nested `/published/` base renders/animates after reload without provider
  URLs. This is local artifact acceptance, not a cloud deployment. Browser checks also passed under
  CI-matching Node 22.23.4.
- The single-worker full-coverage attempt was interrupted without a reported test failure because
  3,186 files were progressing too slowly. Restarted the unchanged complete suite with four workers
  after confirming four CPUs and a 16 GiB container limit; no test/coverage gate was removed.
- Final security review found repeated mesh nodes could multiply rendered triangles beyond the
  geometry-only budget. Policy now sums mesh instances before any browser decoding/rendering;
  added synthetic under/over-budget cases. The in-progress full run was interrupted for this real
  source correction; targeted checks and the complete suite are being rerun on the corrected source.

### 2026-11-01 — complete coverage diagnosis and lossless asset compaction

- Local checkpoint 3610b09b3 preserved the default-off pipeline; no push or activation.
- Full coverage reached terminal: 3,185 files passed, one file failed; 48,200 tests passed, one failed,
  85 existing skips. The genuine failure was a test fixture in production source. Moved it into
  tests/fixtures; the dead-code guard remains unchanged. No skip or allowlist was added.
- Added bounded lossless compact-v1 packing, with reviewed source/output hash pinning, attribution
  change metadata, and an offline no-overwrite admission CLI. Supports both reviewed GLB and bundled
  glTF. It does not change triangles, texture pixels or animation tracks.
- Optimized synthetic fixture saved 65,672 bytes. Real Chromium, actual Vite production artifact and
  fresh-process emulator restore passed on the derived bytes. Provenance includes both hashes and
  processing version. This does not establish actual-provider savings or live publication.
- Investigated existing Three.js simplification: unsupported morph/skin attributes are discarded, so
  universal automatic LOD remains disabled rather than risking character animation. No new dependency.
- Required TUF signature gate and provider requests remain blocked; no denied request was retried.
  Full final verification is pending on the corrected/optimized tree.
- Corrected/optimized targeted suite: seven files / 49 tests passed, including unchanged dead-code
  guard, source/output pinning, glTF resource hashes, CLI no-overwrite and optimized manifest/cache reuse.
- All available CI-equivalent gates passed again on optimized production code. The driver retains
  the prior signature failure; it intentionally makes no new request to the denied TUF service.
  All four required emulator drills passed again using the locally verified Firestore jar.
- Added and passed local private Storage-emulator spill/cache/fresh-process restore. Kept CRC and byte
  caps intact. Independently reproduced an immediate post-abort keepalive reset in the unmodified SDK
  + local emulator; the harness waits 10 ms for deliberate abort cleanup, without retrying requests or
  weakening assertions. Production-cloud same-tick recovery remains unverified.
- Final full coverage will run on this local checkpoint; no PR/push, merge or feature activation.

- Second complete full run: 3,186 files passed, one failed; 48,206 tests passed, one failed, 85 existing
  skips. The failure was the new local harness's direct boolean env read. Changed both that reader and
  L3's opt-in reader to the existing shared parser; no guard exemption or assertion weakening.
- Removed the provider-backoff truncation and extended bounded per-origin spacing/backoff to binary
  downloads. Added long numeric/date Retry-After, concurrent cooldown, cancellation and no-second-fetch
  checks. No denied network request was retried; these provider checks use mocked responses.
- Targeted guards/assets: ten files / 93 tests passed. Final CI-equivalent gates and complete coverage
  are being repeated on the corrected tree. Signature access remains blocked.
- Shared-parser/backoff checkpoint: 93 targeted tests, all available CI-equivalent gates, all four
  required emulator drills and the local private-storage drill passed. The signature gate remains
  explicitly failed/blocked from the prior 403 and was not retried. Starting complete coverage on the
  corrected checkpoint; prior complete failures are retained in the evidence directory.

### 2026-11-01 — terminal full coverage checkpoint

- Code commit 2e97244d61e7520f5d22ab8b629665dfa3ef288b completed full coverage with exit 0.
  3,188 files passed; 48,211 tests passed, 85 existing skips; duration 956.14 seconds.
  Statements 75.53%, branches 71.45%, functions 78.15%, lines 77.50%; thresholds passed.
  Evidence: /workspace/navbharat-asset-verification/coverage-verified-tree.log. Session 97491 ended.
- No owned verification process remains running. This documentation-only checkpoint follows the
  verified source; no further implementation change was made after that coverage run.
- Required signature verification remains failed/blocked by the prior TUF HTTP 403; no retry or
  bypass. Provider API access to api.polyhaven.com and api.github.com remains denied. Minimal third
  evidenced host needed for the signature gate is tuf-repo-cdn.sigstore.dev. Download hosts remain
  unknown until authorized official metadata can be inspected.
- Zero actual external models admitted/downloaded; production catalogue empty and feature off.
  Synthetic rendering/animation/artifact/reload/storage evidence does not establish six complete
  real-asset games, physical mobile performance or live publication. No push, PR, merge or deployment.

### 2026-11-02 — real reviewed asset continuation, feature remains OFF

- Resumed exact remote checkpoint abf2d97; main remains billing merge 504b79298. No rewrite or billing change.
- Published managed policy contains all four requested domains. API/TUF read-only requests return 200;
  npm signatures now passes (1,375 signatures / 197 attestations). No security settings changed.
- Four exact free model licences reviewed and source bytes downloaded: KayKit Knight, sedan and building
  (CC0), Khronos Fox (model CC0; animation/conversion CC BY 4.0, full credit retained).
- Added hash-pinned animation-selection-v1: removes unselected clips/data without changing retained skin,
  geometry or animation samples. Knight shrinks 3,659,532 -> 490,608 bytes; unchanged policy validates it.
- All four models actually rendered in Chromium; Knight and Fox walking clips moved. Local Vite artifact
  with four models passed keyboard/button movement, animation, same-origin asset loading, 390x844 layout,
  reload and fresh-process disk cache restore: 9,578 triangles / 22 draw calls. This is one local fixture.
- OPEN: direct DNS in production guarded transport fails EAI_AGAIN for raw.githubusercontent.com here.
  Ordinary permitted HTTPS client obtained the sources; successful artifact harness explicitly uses
  offline-reviewed input. No guard/proxy bypass. Actual production downloader acceptance is not claimed.
- OPEN: Poly Haven metadata identifies dl.polyhaven.org; not allowed, not requested. Owner permission
  needed before download. Other providers, six complete game cases, physical mobile, generated LODs,
  cloud publication and broad semantic discovery remain incomplete. Feature OFF; no publish/activation.
- Current final CI-equivalent suite and database drills are being run; prior-run evidence is not reused
  as a current pass. See docs/game-engine/l3-reviewed-assets.md for exact admission and commands.

### 2026-11-02 — terminal verification for reviewed asset source commit 80c1e4e0c

- Full coverage passed: 3,189 files, 48,216 tests, 85 existing skips; 980.82 s. Thresholds passed:
  statements 75.54%, branches 71.47%, functions 78.16%, lines 77.51%. No assertions/skips weakened.
- All CI-equivalent non-coverage gates, all four database drills, synthetic persistence/private-storage
  drills and real Knight inline project/private-cache/fresh-process restore passed. Node/npm match CI;
  Java is Debian OpenJDK 21 rather than Temurin 21. No local verification process remains owned/running.
- Separate controlled human/car/animals fixtures passed actual Vite CLI artifact build, movement,
  animation where applicable, mobile viewport and reload. Animals mix downloaded Fox with existing
  procedural dog/cow/horse/tree. They do not complete train/station, bird or ship acceptance.
- System DNS fails independently for all checked allowed hosts while managed HTTPS succeeds. Kept
  connection-level SSRF protection intact; production downloader remains unverified, not diagnosed as
  a production code defect. Poly Haven dl.polyhaven.org remains not allowed/not attempted.
- Feature stays OFF. No production game publication, activation, deployment or merge. The preceding
  source commit is the full-suite-tested code; this following change only records evidence.

### 2026-11-02 — seven assets and six local fixtures, source 66d021504

- Added Kenney diesel, Quaternius cruise ship and pinned CC0 Eagle derivative. Seven total reviewed
  GLBs occupy 3,061,304 bytes. Exact license/source/output hashes retained. Offline Eagle conversion
  is reproducible but not lossless: four skin influences and adjusted materials are disclosed.
- Added bounded reviewed GLB/PNG embedding and conservative subject/clause matching; 61 asset tests pass.
- Six local interactive fixtures pass render/movement/animation where applicable, mobile viewport,
  Vite build and reload. Railway station and some animals are procedural. Not six generated games,
  physical devices, a full sandbox restart, or a cloud publication.
- Non-coverage CI-equivalent gates, signatures (1,375 signatures/197 attestations), four database drills,
  synthetic persistence/storage and real Eagle spill/private-cache/fresh-process restore pass.
- Final coverage remains running in original executor; its owner will record terminal result.
- Owner published dl.polyhaven.org addition, catalog version ends 6ae8177f7f9881a283d07ad40c0e7574.
  Current executor remains on 6ae80b27205c81a2917a4210d73f511a without CDN allowance. No CDN attempt.
  Fresh executor needed; recheck actual policy and direct DNS separately. Do not bypass SSRF.
- Source pushed, main/billing untouched. PR creation remains paused after automatic approval denial;
  no new permission was granted by environment publication. Feature OFF; no merge/deploy/activation.

### 2026-11-02 — terminal verification for seven-asset source 66d021504

- Full coverage terminal PASS: 3,191 files, 48,227 tests, 85 existing skips, 1,085.11 seconds.
  Thresholds: statements 75.55%, branches 71.49%, functions 78.17%, lines 77.53%.
  All owned verification processes are terminal; no pending old-runtime coverage run remains.
- Parent's fresh executor confirms five allowed hosts, but actual secure downloader returns EAI_AGAIN
  and zero bytes for both Poly Haven and Fox at the same source/Node version. No bypass. Do not request
  more domains to solve this DNS failure. Platform direct-DNS/HTTPS support or reviewed transport design
  is needed. Poly Haven table additionally needs safely validated JPEG support, currently unimplemented.
- Source checkpoint is verified locally, not by remote PR CI. PR still paused after approval denial;
  main/billing unchanged, L3 OFF, no merge/deployment/activation. See l3-reviewed-assets.md for exact
  real-vs-procedural fixture limits, license evidence, formats, cache bytes and remaining acceptance work.

### 2026-11-02 — demand-driven source d580c7fa3 (full coverage pending)

- No startup, bulk or gameplay provider downloads. The existing new-game build hook checks verified
  cache, exact curated candidates, then bounded official Poly Haven discovery for requested table,
  chair, bench, rock, tree or plant. Empty curated catalogue is supported; no raw prompt leaves the app.
- Added first-admission provider-policy checks, source/final SHA-256 provenance, 1k self-contained glTF
  packaging, visible service credit and six bounded private discovery cache pointers. Model bytes stay
  private/content-addressed. Actual production guarded network transport is still blocked by EAI_AGAIN.
- Added bounded baseline/progressive JPEG inspection plus actual decode of every texture, Hindi/Spanish
  canonical vocabulary, conservative negation and static Three.js LOD (rigs/morphs/instances excluded).
  Real train switches 1,742->1,388 triangles; ship 858->472. No physical-device performance claim.
- 90 targeted tests pass. Synthetic demand pipeline passes actual browser admission, durable project
  acknowledgement, fresh-process cache hit, Vite build/reload and visible credit with no vendor requests
  during play. Real private Storage emulator verifies discovery pointers/model bytes and zero provider
  calls on fresh-process reuse. No additional third-party models downloaded in this continuation.
- Corrected an invalid synthetic PNG and the history-command fixture's missing new helper dependencies;
  no checks weakened. Incomplete coverage runs were stopped and restarted against corrected source.
- Non-coverage gates pass at a1f704378; required checks are rerunning for d580c7fa3. One unchanged Phase 2
  race drill initially returned an unconfirmed-store result; separate unchanged rerun passes 21/21.
  Initial failure retained, no queue/billing code changed. See docs/game-engine/l3-on-demand.md.
- Branch checkpoints only. L3 OFF; previously denied PR creation paused, no merge/deploy/activation.


### 2026-11-02 — demand-driven final local verification, source d580c7fa3

- Full coverage terminal PASS: 3,195 files, 48,253 tests, 85 existing skips, 1,051.29 seconds.
  Coverage: statements 75.60%, branches 71.54%, functions 78.21%, lines 77.58%; thresholds passed.
- Final required local gates and all six emulator/drill groups pass on this source. Signatures:
  1,375 packages / 197 attestations verified. 90 targeted tests and all recorded browser/cache/runtime
  checks pass. All owned runs are terminal; prior incomplete runs/failures remain documented.
- No new model downloads in this continuation. Demand-only Poly Haven discovery covers six canonical
  static subjects; other providers remain exact curated candidates. JPEG and bounded static LOD added.
- Production secure downloader remains zero-byte EAI_AGAIN per the parent's fresh-worker verification.
  No DNS/proxy bypass. Full generated games, physical devices and cloud publication remain unverified.
- Source checkpoint d580c7fa355086af746de3cd5e5915da3499ed4b; documentation-only commits follow it.
  L3 OFF. PR creation remains paused after automatic approval-review denial. No merge/deploy/activation.
  See docs/game-engine/l3-on-demand.md for exact gate evidence, scope, limits and failure disclosure.


### 2026-11-02 — PR 4064 live acceptance and conditional merge

- User explicitly authorized draft PR creation, then merge after all local and hosted required CI.
  PR https://github.com/docasheesh-png/navbharatai/pull/4064 is open. No approval review or check bypass.
- Production source 05b8b939d: ten bounded canonical Poly Haven subjects; official category mappings;
  exact object names/components guarded. Six real curated assets securely downloaded/rendered in CI;
  Eagle now ships privately as a reviewed CC0 derivative instead of a private-repository hotlink.
- Hosted live acceptance job 125144700590 / run 41404930510 PASS: real side_table_01 discovery,
  actual guarded transfer/browser admission, persistence, fresh-process cache hit, production artifact
  reload/service credit; all seven reviewed models and six local scenario fixtures pass.
- Fixed real failures: 1k packs can share bounded geometry under gltf/8k; only that BIN path class was
  added, not 8k textures. Browser job pinned to supported Ubuntu 24.04. Assertions/SSRF unchanged.
- Local required non-coverage gates/drills pass on corrected source; full local and hosted suites
  remain owned until terminal. Final exact-head validation is recorded in PR #4064's report/checks.
- L3 OFF. Remaining: deployed-network, physical-device, full generated-game and cloud-publication
  acceptance. Main merge triggers existing Cloud Build deployment; do not start a duplicate deploy.


### 2026-11-02 — final local verification and hosted job allowance

- Source 05b8b939d full local coverage PASS: 3,195 files / 48,263 tests, 85 existing skips;
  1,236.10s; statements 75.60%, branches 71.54%, functions 78.21%, lines 77.59%. All local gates and
  database/storage drills pass. Fresh 1,375 signatures / 197 attestations verified.
- Runtime image build, non-root packaged Eagle hash/size/license and HTTP 200 health pass with no
  network. Managed verification used CA secret mounts and matching image Node headers; canonical Git
  file modes were restored after this executor's restrictive umask caused fixture-only EACCES.
- Extra scheduled Trivy check blocked at database host mirror.gcr.io (Forbidden); no alternate mirror
  or policy bypass. This is unverified and separate from configured PR CI.
- Hosted final-head live asset acceptance and database drills pass. Prior run 41403264320's check
  annotation explicitly says maximum 45m exceeded, while tests were still advancing. Main also had a
  44m13s successful run and a cancelled 45m run. Raised only overall build-and-test allowance to 60m;
  every test, coverage threshold and 20s test/hook timeout is unchanged. Require terminal green CI.
- User conditionally authorizes deployment/activation after readiness. No GCP connector/CLI or cloud
  identity is configured here; physical devices and production game acceptance are still unavailable.
  No flag activation or new credentials/security configuration. PR report/checks carry final status.

### 2026-11-02 — Autopsy cf1706d2 / 8701aaa1 / 7aa2fe7c / c71e56de: a driven vehicle always moves

Admin: *"jab bhi koi vehicle game banaya jaye, to vehicle chalni chahiye. 50% vehicles chalti hi nahi hai."*
Four builds of one 3D racing game (car, train, birds): one stopped by the user, three RED, the car never moved
(playtest Controls 0, 1,419 runtime errors).

**Root cause (one class, two halves):**
1. `Game.context` (GameShellGenerator.ts) was a getter that built a NEW object on every access, so anything a
   game kept on `ctx` in setup() was undefined in update(). driveVehicle(car, undefined) threw "reading
   'speed'"; after the builder's `|| { speed: 0, heading: 0 }` "fix", driveVehicle(undefined) threw "reading
   'rotation'". Fixed: ONE context for the game's life, members as live getters.
2. `driveVehicle` was pure: the car only gained speed if the game wrote the result back into a variable that
   outlived the frame. Discarded return, a fresh literal every frame, or no state at all each froze the car.
   Fixed: the kit holds each vehicle's state; the passed state is updated in place and returned; a missing
   state uses the vehicle's own; a literal re-made with the same values every frame is replaced by the
   vehicle's own; a state the game sets ONCE (crash stop, respawn) is still obeyed. No vehicle → a clear error
   naming the fix instead of "reading 'rotation'".

**Prevention upstream:** the kit type contract now carries `MaterialKind`, `PaletteName` (spelled out from
PALETTES) and `RailTrackOptions` — build cf1706d2 guessed 'plastic' / 'rubber' / 'steel' / 'coal' and
`createRailTrack({ path })` (11 type errors, ~10 fix-up rounds). Repair hints for VEHICLE_STALLED and
RUNTIME_ERROR now name the correct pattern and forbid try/catch silencing.

**Locked by** `tests/aDrivenVehicleAlwaysMoves.test.ts`: the real generated kit and shell, driven through
every way a game keeps its car (kit example, on ctx, discarded return, fresh literal per frame, no state,
spread copy) — each must move > 25 m in 3 s with Up held. Proven by reversion: old code fails 5 of 10;
old driveVehicle with the new ctx still fails 4.

**Not finished (queue rows):** Q-2301 stack/file:line for runtime errors · Q-2302 write-time guard against
silencing catch · Q-2303 a single clean console read taken as proof · Q-2304 final text vs RED gate ·
Q-2305 post-green unverified writes (admin) · Q-2306 ladder text vs SURPLUS route (admin) · Q-2307 gate
counts TODO tests as proof. Watch on the next real vehicle build: GAME_DEFECT_VEHICLE_STALLED should not fire.

## 2026-11-03 — Admin → Money → API Providers (admin: "one click par dekh len kon se api provider ka balance low/khatam hai")

- Audit: the AI routing code reads 30+ provider keys. All of them, plus the services the admin listed (E2B, Google Cloud,
  Brave, Render, Resend, RapidAPI, Cashfree) and the five registered-only free-chain providers, are now ONE directory:
  `src/server/lib/apiProviderDirectory.ts` (31 rows: key names set, billing link, what to look at).
- Live balance only where the provider has a documented balance API: OpenRouter (`/api/v1/credits`), DeepSeek
  (`/user/balance`), Moonshot/Kimi (`/v1/users/me/balance`). Graded OK / LOW / EMPTY. Everything else is
  "check manually" with its 🔗 billing link — never shown as OK. A refused or unknown-shape answer is "could not check".
- Route `GET /api/admin/api-providers` (verified admin, rate-limited, no-store); panel `ApiProvidersPanel.tsx`, attention
  first. Census `tests/everyApiProviderHasABalanceLink.test.ts`: a new `*_API_KEY` in the routing code without a
  directory row fails CI (reverted → failed). No key value ever leaves the server (test-locked).
- Not possible from code: live balances for providers with no balance API (Surplus, Router One, GLM, Groq, xAI, E2B, …).
  If any of them adds one, it becomes one more `BalanceProbe`.
## 2026-11-03 — Autopsy 8cdb4817 / cb9757a5 / 1c74b3fc (build reports #1817, #1814, #1813 — ENGINE_UNAVAILABLE on SURPLUS)

Ledger (all three: weak tier on SURPLUS qwen3-coder, files on disk, then one call folded to "The build engine is
temporarily unavailable" and the build ended with the starter page showing):
- ✅ (already fixed) the build ending on one SURPLUS death with files written — #4050 (merged 2026-10-31 12:21 UTC)
  continues the same turn on the Weak ladder after writes too. #1813/#1814 started before it; #1817 started 5 min
  after the merge, inside the deploy window. No ENGINE_UNAVAILABLE report since. Watch: the next SURPLUS death
  must show SURPLUS_FALLBACK and continue.
- Q-2320 "your app is built" after a failed loop — class: a success claim gated on "files were written" instead of
  "the loop succeeded" (sibling of Q-1024 and Q-2314). `etaAppExists(files, loopFailed)` now gates both writers
  (immediate line + heartbeat tick); class lock in `tests/aFailedLoopBuiltNoApp.test.ts`, reverted → failed.
- Q-2321 SURPLUS_FALLBACK said "before any user file" after #4050 widened it — `surplusFallbackMessage(reason)`.
- OPEN: Q-2322 failed-call row names a Claude label on a SURPLUS build · Q-2323 a document request went on to build an app.
- TODO_ONLY_TURNS (7.7 s) — second evidence for Q-2317 (#4074).
## 2026-11-03 — Autopsy 5413e6f1 (build report #1823, AI health coach with camera, weak tier)

Ledger: 0 files written, RED gate, "All providers failed".
- ✅ Q-2313 crawl floor killed a healthy Kimi call 1 s after first byte (bytes ÷ time since request) — class: a
  rate measured over time the stream was not producing. Fix: `streamIsCrawling` takes `producingMs` from the
  first byte, after a 5 s window; callers that do not know it keep the old rule. Locked by
  `tests/aStreamIsJudgedOnWhatItProduced.test.ts` (reverted → failed).
- ✅ Q-2314 the previous version rendering was told to the user as this turn's app — class: a render claim not
  tied to this turn's writes. Fix: `inBuildWroteThisTurn` gates the narration and the ETA; restore point and
  billing proof unchanged. Same test (reverted → failed).
- OUTCOME_UNEXPLAINED for "All providers failed": already fixed by #4073; this report is second evidence.
- OPEN: Q-2315 GLM single 429 ends chain · Q-2316 orphan `nb-autostyle.css` · Q-2317 TODO-only first turn ·
  Q-2318 stale SURPLUS snapshot · Q-2319 "engine slow" note when we abandoned the call.
Watch on the next weak build: no "crawling after ~15 s" abandonment of a stream that has started producing.

## 2026-11-04 — Admin → AI Engines → AI provider switches (enforced on/off per AI provider)

Admin: "sabhi ai provider (google vertex ai, gemini ai etc) ko on off karne ka switch banao … 100% real and working".
The old `providerEnabled` switches were removed on 2026-10-11 (audit F16) because nothing read them; this one is its
own enforced system (`src/server/lib/providerSwitches.ts`), as that audit required:
- **Layer 1, keys withdrawn:** while a provider is off its AI keys are removed from the server env (restored exactly
  when on), so every existing "no key" path — ladder rung skipped, Surplus fallback, chat router, features — degrades
  on its own. Shared infra keys are never withdrawn (Cloudflare DNS token, AWS creds, GOOGLE_API_KEY).
- **Layer 2, network refused:** `fetch`, `https.request/get` and `http2.connect` refuse the provider's hosts before a
  socket opens — this catches cached SDK clients, Vertex (no key: server identity) and Nova Sonic (Bedrock, http2).
  Installed by the FIRST import of server.ts; verified in a CJS esbuild bundle for default/named/require/fetch.
- **State:** `admin_provider_switches/state`, revision-checked transaction, reason required, last 50 changes kept;
  every instance re-reads every 10 s; a failed read keeps the last known state (never switches a provider back on).
  Before the first successful read after boot nothing is off (a boot window of one Firestore read).
- **Proof:** `tests/anAiProviderSwitchIsEnforced.test.ts` (18 tests, incl. a cached OpenAI and Anthropic SDK client
  refused after the switch and working again when on); reversion of the guard → 4 tests fail.
- **Correction:** the API Providers page said Nova Sonic voice was not used — wrong (`src/server/sonic/SonicBridge.ts`
  uses Bedrock). The Bedrock row now says "Voice chat (Nova Sonic)". My earlier search missed the word "sonic".

## 2026-11-04 — L3 steps 2 + 4 (L3 OFF): 35-model catalogue and genre world dressing

Step 2: 28 CC0 KayKit models (City / Medieval Hexagon / Prototype Bits), admitted with `scripts/gameAssetAdmitGltf.mjs`
(production bundler/compactor/validator; reproduces building_A exactly); all 35 render through the live guarded
downloader (`gameAssetReal.check.ts` PASS). Step 4: `worldDressing.ts` — genre scenery + `dressWorld()`; browser proof
for racing/village/shooting; two layout defects found from screenshots and fixed. Tests: theCatalogueServesEveryGameType,
aGameGetsAWorldNotOneObject, assetIntegration (seed writes worldDressing only when scenery arrived).
## 2026-11-04 — L3 step 1: Admin → AI Engines → Game asset download check (L3 OFF)

The L3 asset layer had never downloaded from Cloud Run. New admin check runs the real guarded transports (Poly Haven
search + reviewed `fox` download + hash + validator) from the live server, writes nothing, never reads the L3 flag.
`tests/theGameAssetLiveCheckIsReal.test.ts` (9); reverted timing bug → failed. Sandbox: GitHub ✓, Poly Haven ✗ ENOTFOUND
(container egress). Next: the admin runs it on production; steps 2–4 follow in order (catalogue, acceptance, rollout).
### 2026-11-04 — Bounded 1,024-turn Chat bursts (validation in progress)
- User requested 1,000+ simultaneous requests after the isolated load test. Root cause of burst rejections: per-instance 64-waiter limit, distinct from 8 active turns, per-account slots and durable shared quota/spend reservations. Cloud Build already declares HTTP concurrency 100 and max instances 100; no live infrastructure/settings changed.
- Increased default waiting capacity to 1,024; centralized config default/max at the queue's existing 1,024 ceiling. Active calls, five-second queue deadline, per-user fairness and provider budgets/OFF switches unchanged. Saturated drain avoids useless scans. Explicit overrides remain effective.
- Added a fixed 16 MiB serialized queued-payload budget at both ingress paths; grant/abort/timeout return bytes. This is a payload bound, not a total-heap claim. Added regression tests for byte accounting, UTF-8, invalid sizes, cleanup and full-body entry accounting; existing 10,000-user overload regression now checks the new bounded default.
- Added offline `npm run test:load:chat`: real router/queue/breakers, synthetic adapters and mocked durable store. First run: 1,024/1,024 replies at 25 ms simulated provider latency, p95 3.10s/p99 3.23s; same baseline queue allowed 72/1,024. At 1,000 ms latency only 40/1,024 completed before the unchanged deadline. No production capacity claim or paid traffic. Full validation and final evidence follow before publishing.

### 2026-11-04 — 1,024-turn burst validation complete locally
- Final offline benchmark: nine scenarios, 10,240 turns; 1,024/1,024 healthy replies, p95 3.118s/p99 3.246s with 25ms simulated providers. Baseline queue: 72/1,024; slow (1000ms) providers: 40 replies/984 deadline refusals. Healthy peak RSS 138.0MiB; worst large-payload experiment 315.6MiB. Zero uncaught exceptions, order violations, Google dispatch or retained queue entries. Exact metrics, caveats and source hashes: docs/benchmarks/chat-burst-2026-11-04.{md,json}.
- All local CI-equivalent gates passed, including full coverage (3,213 files; 48,442 passed/85 skipped), build/boot/dependency gates and emulator drills (21+13+8 checks, 78 session assertions). Node/npm match CI; Java distribution differs (OpenJDK21 vs Temurin21). No live capacity test or infrastructure/provider setting change. Hosted CI still required before merge.
- Ledger: burst refusal → 64-waiter per-instance cap → count-only admission also risks retained payload growth → both HTTP entry and direct runtime now account queued payload bytes → deterministic 1,024-user drain, 10,000-user overload, byte-budget cleanup and full-body-entry regressions; reproducible real-router synthetic load scenarios.

### 2026-11-04 — Further throughput diagnosis; cache stays unchanged in production
- User requested all four answers for 1,000 users and cache-disabled tests only. Harness now explicitly sets FREE_CHAIN_CACHE_ENABLED=off, asserts zero cache reads/hits, measures dispatch count, validates a per-request synthetic response ID and reports per-user completion. Production cache configuration/code untouched.
- Four-turn experiment: realistic 1,000-user sequential scenario produced all 4,000 synthetic replies (25ms adapter latency); the simultaneous 4,000-request scenario hit existing per-user overlap policy. Slow 1-second adapters still exceed the five-second queue deadline. These are unresolved real-capacity constraints, not claimed solved by a larger queue. Actual HTTP also has a shared per-user FreeAnswer reservation; direct-router benchmarks do not bypass or prove that production admission policy.
- Independent shared-store root cause: a local 1,024-way quota-transaction stampede failed to complete in a bounded emulator run with lock timeouts. Sequential document reads did not fix it; that experiment was not shipped. A serialized per-account lane completed all 1,024 decisions in ~8.67s, granting exactly27 under unchanged30RPM/0.9 safety margin and refusing997. Added bounded per-DB/per-provider local lanes (32 active account lanes,1024 total waiters,10s wait) to quota reservations AND status snapshots, preserving Firestore as cross-replica authority and holding physical ownership until SDK completion. Saturation reports local_capacity separately from store outage.
- Regression coverage includes multiple store handles sharing the lane, cross-account/database isolation, queue/identity cleanup, timeouts without releasing an active SDK transaction and post-read transaction clocks across simulated separate processes. Added a real 1,024-request quota-lane emulator drill to CI. Full checks must rerun on these changes; prior head05c29080f CI is green but does not validate this follow-up.
- Screenshot investigation: exact generic error text matches useChatEngine.ts before67550f06d (2026-10-26); absent from current source. Old client assets or historical text are possibilities, not a proven failed-request root cause. Production logs unavailable in this environment; app/platform/version and HTTP/request error evidence requested. No cache or OFF-switch changes made based on a guessed cause.

### 2026-11-04 — Independent closed-answer quality gate
- User requires teacher-style correctness checks, not a nonempty/mock-response pass. Added16 explicit Hindi/arithmetic/factual/code-tracing/uncertainty cases and a1,000-user/four-turn manifest. Offline evaluator requires all4,000 distinct records, correct identity/source/status and exact independent answer keys; reports failures and users with allfour correct. No provider calls or supplied-code execution.
- Self-check validates positive/adversarial fixtures, including incorrect/missing/duplicate/timeout/identity/source rejection; fabricated fixtures never count as real model quality. Empty actual-response evaluation intentionally fails with0/4,000 passed and4,000 missing. Actual real-provider quality remains unmeasured; source labels require independent provenance review. CI adds the evaluator self-check. Production caching unchanged.
- This closed-answer gate covers16 distinct questions repeated250times, not arbitrary teacher answers or universal correctness. Open-ended judging needs task rubrics, independently reviewed labels and calibration before deployment; no self-grading model is used.

### 2026-11-04 — Follow-up validation completed locally
- All16 CI-equivalent local checks passed on the quota-lane implementation: install/audit/signatures/license/SBOM, frontend/server/benchmark types, imports/native/OAuth, full coverage/build/bundle/boot/dependency gate. Coverage:3,214 files;48,448 passed,85 skipped;876.04s; statements75.67%,branches71.61%,functions78.29%,lines77.67%. Node22.23.4/npm11.18.0.
- Real emulator drills passed:21 queue/retry,13 autopsy,8 comparison,78 session rules plus the new1,024-request quota-lane drill (27 grants,947 RPM refusals,50 local-capacity refusals; durable27; physical peak1). No paid inference.
- Final offline load run:13 scenarios passed in59.49s;26,240 logical turns total. Cache lookups/hits/misses zero, production caching unchanged. Four-turn results and resource/latency data are in docs/benchmarks/chat-four-turns-2026-11-04.{md,json}; this verifies transport/guardrails, not live model accuracy or universal capacity. Supplemental load-harness typecheck and offline quality-evaluator self-check passed. New exact-head hosted CI is required before merge; old-head CI is not substituted.

### 2026-11-04 — Autopsy 61279465 (3D train simulator, L3 on for z@gmail.com)
- **Q-2330 camera inside the train** — root: `CameraRig.chaseFrom` fixed 7 m/2.2 m offset + collision ray hitting the vehicle's own body. Class: the camera did not know the size of what it framed. Fix: size-aware chase from the target's own extent, own-body exclusion, inside/NaN/teleport recovery, front-cab first-person for long vehicles, 'cinematic' view, `setKind`. Car framing unchanged. 37 tests (train 0–6 coaches × 4 headings, collision, accel/turn/reverse/brake 900 frames, respawn, phone portrait/landscape, car/bus/truck/bike/aircraft); 31 fail on the old camera.
- **Q-2331 GREEN over an unplayed game** — root: the release gate had no playtest input. Class: a check whose answer never reached the verdict. Fix: `RuntimeEvidence.game`, fed on every playtest ending; GREEN needs `passed`; card says "not verified yet".
- **Q-2332 contract `genre: unknown`** — 'simulator' genre, vehicle, camera, subjects, externalAssets, implied throttle/braking; handed to the builder.
- **Q-2333 prepared models unused** — object_spec/HERO OBJECTS said "HAND-MODEL" for a subject L3 had a reviewed model for. object_spec now reads assetModels.ts; handoff overrides. Asset provenance verified: all six GLB hashes are reviewed CC0 catalogue entries (train-diesel-a, medieval-tree_single_A, city-building_A, medieval-mountain_A_grass_trees, medieval-hills_A_trees, medieval-building_home_A_red).
- **Q-2334** playtest now ends itself at its budget with stage + fps (was killed with nothing). Q-2335…Q-2339 open/blocked in `BUILD_REPORT_QUEUE.md`.
- **Same autopsy, second pass (admin: "puri autopsy kar ke sabhi choti badi problem fix karo").** Added: Q-2336 (claim audit: an unplayed game may not be called "complete and working"), Q-2339 (done readers ask the game contract — the 4th return of the "score measures the project, not the request" class), Q-2310 (fast-lane gate judges the engine that runs), Q-2340 (glass / tile in both material vocabularies), Q-2341 (recipe install stamps node_modules), Q-2342 (LADDER_DEPTH names Surplus), Q-2345 (looking at a filed error is a step), Q-2346 (prompt's hand-written chase camera sized by the model), Q-2347 (playtest catches a camera inside the vehicle for ANY three.js game). Blocked with all four fields: Q-2334, Q-2337, Q-2338, Q-2343, Q-2344. Open: Q-2335 (token cost — candidate: one batched object spec).
### 2026-11-04 — Follow-up correctness review: three confirmed defects
- Independently verified that local quota-lane saturation opened the provider circuit until an artificial future reset. Exclude local_capacity from remote circuit opening and return the observation time instead of a synthetic minute. Preserve authoritative quota/cooldown decisions; regression proves the next healthy turn can dispatch while RPM refusals still bench until reset.
- Verified that nonempty finishReason=length was marked served and cached. Preserve the established stalled/partial contract, mark telemetry truncated, retain paid accounting, prohibit caching/provider hopping after partial text. Complete stop-finished responses remain cached. Existing cache records cannot be retrospectively classified because they lack finish metadata; TTL/cache settings unchanged.
- Verified missing payloadBytes on both gateway queue paths. Account verified ingress bodies and direct invocation inputs using the shared serialized UTF-8 byte estimator. Regressions exercise oversized and aggregate limits with the real admission queue; separate UTF-8 test includes Hindi history and attachments.
- Initial targeted runtime/gateway/store regression suite: 286 tests passed. Full checks and emulator drills running; no production claims or game-related changes. Add a cache-OFF 1,024-turn local-pressure recovery scenario to distinguish temporary transaction saturation from an unnecessary provider blackout.

### 2026-11-04 — Six-part follow-up: bounded capacity and browser sequencing
- Added slot-release notification and bounded pre-reservation waiting: only zero-quota-attempt turns can re-scan; queue wait already spent is deducted,32 re-scans/64 waiters maximum, cancellation/deadline/OFF preserved. No extra provider call or paid/unknown retry. Targeted release/cancel/OFF tests passed; small one-slot and local-pressure load probes both passed (synthetic providers, concurrent local coverage means probe timings are not final measurements).
- Added explicit Free Chat Queue action: three pending text questions,16k characters each,90-second sequence expiry, FIFO with current history. Stop/account/session/mode changes, failure/incomplete output and unmount clear pending work. No attachments queued; no server reservation until a real turn starts. Ordinary duplicate Send remains blocked. Client lifecycle/queue suite68tests passed, including four ordered mock answers, updated history and preserving an unsent draft. Used React best-practices skill for hook lifecycle and accessible optional UI action review.
- All four shared queue acquisition sites now account payload bytes. Existing independent closed-answer evaluator remains the quality gate; actual real-provider quality is still unmeasured, not claimed100%. Complete-answer production cache stays enabled as configured.
- Scope expanded while earlier validation ran; that run is not final evidence for the added scheduler/UI. Freeze final source then rerun all repository gates and emulator checks before publication/merge. Cloud Build retry remains blocked on access/freeze status; no retry or settings change performed.

### 2026-11-04 — Six-part final local evidence
- Integrated main through25d5b2a14 without modifying external game work. Final full coverage:3,220 files passed;48,501 tests passed/85 skipped;858.82s; statements75.69%,branches71.62%,functions78.30%,lines77.68%. All other applicable local CI gates passed, plus supplemental load-harness types. Initial stale coverage lock and superseded retry are retained as failed/cancelled runs, not passed evidence. Census entry and physical-ownership fixture were corrected without weakening assertions.
- Real emulator drills:21 queue/retry,13 autopsy,8 comparison,78 session assertions.1,024 quota decisions:27 grants,587 RPM refusals,410 local-capacity refusals; durable27,peak physical1. No real inference/production data.
- Final cache-OFF load run:16 scenarios/28,416 logical turns passed in68.20s.25ms mock providers:4,000/4,000 complete answers for1,000 sequential four-turn users,p95 3184.0ms/p99 3188.9ms. Raw4,000 simultaneous requests:1,008 complete,2,992 per-user refusals.1s mock providers:160/4,000 sequential complete,3,840 deadline refusals; only32 users got allfour. These hard capacity limits remain; no production capacity or accuracy claim.
- New constrained-slot probe128/128 complete at physical peak1; local-quota recovery1,016/1,024 after first8 deliberate refusals; truncation probe0complete/1,024 partial,never cached. Actual model accuracy still unmeasured. Raw metrics/source hashes and limitations:docs/benchmarks/chat-six-fixes-2026-11-04.{md,json}.
- Exact-head hosted CI remains required. Cloud Build retry not performed; access and unknown release-freeze status remain deployment blockers. No live settings, cost ceilings, provider quotas or OFF states changed.
- **Same autopsy, third pass (admin: "inko bhi fix karo").** Q-2334 + Q-2338 (one root: the sandbox's software renderer drew the 'real' tier at 2.5 fps → kit detects it, lite + 0.5 pixel ratio + no MSAA → 17.6/22.5 fps, playtest played in 30 s), Q-2343 (proofs 3 at once, downloads chained, saves serial: 25.6 s → 17.9 s on the six real models), Q-2335 (object_spec takes every object in one call; ~30% fewer input tokens estimated, not yet measured live), Q-2337 (edit turns refresh untouched kit files; proven on the real workspace's 31 files, strict tsc 0 errors). New 🟡: Q-2348 (provider budget fail-fast vs concurrent builds — admin decision). Q-2344 still the admin's decision.

### 2026-11-05 — The editor's corner button now CLOSES the keyboard (admin report)
- **The report (verbatim):** *"han, isko hide kar do! aur jab keyboard on ho, tab dikhna chahiye, par size me 1/8 ke as pas ho! iska kaam bas keyboard ko band karna hai! keyboard open to kahi bhi touch karo, keyboard open ho jata hai. band nahi hota, is button se keyboard band ho jaye, bas itna karo!!"*
- **Root cause (it was never our button).** The 58×36 box in Code Studio's bottom-right corner is Monaco's own `iPadShowKeyboard` overlay widget, registered by the standalone bundle on every iOS device, whose single action is `editor.focus()` — it OPENS the keyboard. Verified in the installed package: `node_modules/monaco-editor/min/vs/editor/editor.main.css` carries `.iPadShowKeyboard{width:58px;…height:36px}` with a base64 keyboard glyph. Nothing in our repo rendered it (the only `<Keyboard` render in `src/` is the Shortcuts popup header, `VirtualKeyboard.tsx:360`).
- **The class: a control that repeats a gesture the user cannot avoid, standing where the unreachable action belongs.** On a touchscreen a tap anywhere in the code already focuses the editor and raises the keyboard, so the widget's action was free; CLOSING the keyboard had no control at all, because `installKeyboardBehaviour` (nativeShell.ts) removes iOS's accessory bar to stop the app reading as a WebView. Hiding the widget alone would have left the user worse off — the fix is the inverse control in the same corner.
- **Fix.** `.monaco-editor .iPadShowKeyboard { display: none !important }` in `index.css`, plus a 22×22 chevron chip (inside a 38px tap area) in `Editor.tsx`, gated by the new pure `keyboardDismiss.ts` and blurring through the shared `dismissKeyboardOnMobile`.
- **The non-obvious half: the signal is FOCUS, not the viewport.** The obvious implementation — `useKeyboardHeight()`, i.e. `window.innerHeight − visualViewport.height` — is structurally blind inside our own app, because `capacitor.config.ts` sets `Keyboard.resize: 'native'` and the WebView itself shrinks with the keyboard, leaving that difference at 0. A height-driven button would have worked in mobile Safari and never appeared in the shipped Android/iOS app. A coarse pointer plus focus inside the editor is true in both, and is the exact inverse of the blur the button performs.
- **Locked by `tests/theKeyboardCanBeClosed.test.ts`** (13 tests: the decision table, the focus-within bookkeeping, the CSS rule, and source guards that the button is gated on the shared decision, calls the shared blur and never `focus()`). Proven by reversion — restoring `display: block` fails 2 of them. `AppKnowledgeBase.ts` carries the new control.
### 2026-11-05 — Explicit Free Chat Chain configuration diagnosis
- Confirmed source defect: config records FREE_CHAIN_ORDER errors but preserves unknown/duplicate IDs; admin status returned that order as successful JSON, and strict frontend validation hid even its configuration-error explanation. The user's exact live failing field remains unproven without the sanitized response and serving revision.
- Status now rejects invalid order before store reads with a fixed typed diagnostic; route emits sanitized no-store503 with only code and the allowlisted configuration field. Panel renders a local fixed message and retains blocked controls, including after an older valid snapshot. No raw environment value or partial healthy snapshot is returned. Strict successful-snapshot validation and routing/configuration semantics are unchanged; no normalization, settings, budget, credentials or provider activation.
- Targeted297tests passed initially on environment Node24; final required gates are being rerun with CI Node22.23.4/npm11.18.0. Regressions cover duplicate/unknown/paid-first order, JSON contracts, stale success responses, OFF/uninitialized policy, no reads for malformed order and no writes/inference. No production calls or paid tests.

- Final local validation: all17 CI-equivalent gates passed on Node22.23.4/npm11.18.0; full coverage3,220 files,48,514 passed/85 skipped,851.56s; statements75.69%,branches71.62%,functions78.30%,lines77.68%. Build/bundle/boot/dependency gates passed. Emulator drills21queue/retry+13autopsy+8comparison+78session assertions passed;1,024 quota decisions27grants/997RPM refusals,physical peak1. Local Java is OpenJDK21 rather than CI Temurin21. Artifact uploads/hosted runner execution remain hosted-only; exact-head CI required. Initial npm bootstrap cache-path error resolved using writable /tmp cache; no gate weakened.

## 2026-11-06 — Mitrify transport and explicit general-chat privacy boundary (local work)

Inspection found general chat includes health data, profile, memory and attachments, and is already classified health/clinical. The cache's six public questions do not prove the whole outgoing request public. Added an isolated provider-agnostic transport, server env names, offline HTTP mock checks, an explicit opt-in manual smoke script and documentation. Both general-chat callbacks remain direct even when Mitrify is requested; no privacy classification was downgraded. App Builder and generation logic are untouched.

Production eligibility remains BLOCKED pending trusted full-request public provenance. No credentials configured, no live gateway request, no switch enabled. Verification results will be reported separately; this entry does not claim CI or deployment success.

### 2026-11-06 — Mitrify buffered-stream cancellation correction

Review reproduced cancellation after the first of several already-buffered SSE events: the transport could deliver the remaining events and report success. Added a regression that fails on the original transport, then checked AbortSignal before/after reads, before each event, after the consumer callback and before success. General-chat privacy blocking remains unchanged. Required validation is rerun on this corrected tree before publishing it.

### 2026-11-06 — Account-only no-fallback privacy boundary (not enabled)

- Added an optional server-only verified-email selector at both general-chat endpoints. The selected verified account is refused before either chain, quota admission or private context processing; unrelated accounts keep the existing path. No account value, key or production flag is installed.
- No request has proven whole-request public provenance, so this is explicitly a privacy pause, not operational Mitrify chat. No prompt rewriting, live calls, spending or App Builder changes. Shared client notices display the privacy refusal without mislabeling it as server load.
- Added offline account selection/default/no-fallback tests and actual route tests for both endpoints, streaming and non-streaming, forged body claims, plus the user-facing refusal. Full validation pending at this entry.

- Validation found four source-census failures because moving quota wiring into a wrapper hid it from existing guards. Restored inline quota calls at both route registrations; guards were not weakened. All 85 targeted route/quota/notice tests pass. Re-running full checks on the corrected source.

- Corrected source validation: all 3,235 coverage suites pass (48,641 tests passed, 89 skipped), 25 offline Mitrify checks pass, 85 targeted route/quota/notice checks pass. All applicable CI-equivalent type/import/security/license/build/bundle/boot/dependency gates and all five emulator drills pass on Node 22.23.4/npm 11.18.0/Java 21 (Debian locally; Temurin in hosted CI). Missing-key smoke exits 1 as intended. No live inference performed; no production configuration changed.

### 2026-11-06 — Replace draft account pause with isolated public-test preparation

- The pause-only draft must not be merged or enabled. Removed its ordinary-chat refusal and shared frontend notice changes. Both existing chat routes retain their direct path for all users.
- Added a separate authenticated, empty-body public arithmetic test. Its entire provider payload is server-owned and excludes identity, private context and caller parameters; it has no direct fallback. Unexpected output is never echoed.
- Production admission is deliberately absent. A real server adapter must verify a gateway-side finite total-cost bound covering retries/failover and durably consume one test authorization bound to the endpoint/model/credential snapshot. No client flag, env boolean or token estimate grants admission. The formerly discussed test cap is not hardcoded as a current user preference.
- No live test, credential access, production switch or financial-control change occurred. Offline verification pending for this replacement.

### 2026-11-06 — Updated backend naming and concurrency requirements

- Read the latest full user task. Added canonical AI_BACKEND with deterministic precedence over the legacy alias, X-Mitrify-Attempts metadata, and a process-wide bounded FIFO with default 200 active calls. The queue holds permits through retries and stream completion, removes cancelled waiters, bounds count/serialized bytes/wait time, and does not claim fleet throughput.
- Isolated public-test responses now preserve the provider body/wording and expose only sanitized metadata headers; no fixed-answer rewriting. Ordinary chat remains direct and no pause-only code will be enabled.
- Stopped the obsolete in-progress validation run when the requirements changed; it is not claimed as passing. Final validation must rerun after these changes. No credential, live-call, production or spending-control action occurred.

- Final coverage identified required census entries for the new operator endpoint and bounded semaphore. Registered its real operator-only caller, strict empty-JSON/default-small-parser contract and numeric/lifecycle state bounds; no guard was disabled. Added explicit JSON content-type refusal and regression checks. The cancelled prior run also left a lock owned by a confirmed defunct process; removed only that stale temporary lock and reran coverage. These incomplete/failed runs are not reported as passing.

- Corrected replacement validation: all 3,235 coverage suites pass (48,642 tests passed, 89 skipped), 43 loopback Mitrify tests pass, and 29 focused ingress tests pass, including rejection of an invalid upstream HTTP 200. All applicable local CI-equivalent security/license/type/import/build/bundle/boot/dependency gates and all five emulator drills pass. Node 22.23.4 and npm 11.18.0 match CI; Java 21 is Debian locally rather than hosted Temurin. Missing-key smoke exits 1 as intended. Artifact uploads and hosted-only infrastructure are verified separately by CI. No live inference, credential configuration, account pause or production setting change occurred.

### 2026-11-06 — Independent-review streaming and deadline corrections

- Review reproduced credential leakage through SSE comments and split text deltas, and a permit retained by a stalled downstream callback after cancellation. Added regressions that fail on b753dad; the identity deadline regression also fails against that exact original source. The PR is draft and that head must not merge.
- Added bounded per-choice credential-prefix lookahead, omit non-answer SSE comments/control fields, and cancellation-aware waits for downstream consumers, identity and admission. Safe data text remains unchanged; caller-owned delayed writes still must honor AbortSignal. Complete local/hosted validation and independent re-review are required for the corrected head. No live inference or production action occurred.

- Corrected review-fix validation: 49 offline gateway tests pass; all 3,235 full coverage suites pass (48,643 passed, 89 skipped), with all applicable local CI-equivalent gates and all five emulator drills green. Missing-key smoke exits 1 as intended. Earlier failed reproductions are retained as evidence; no failing check was weakened. A new exact-head hosted CI and independent review remain required before merge.

### 2026-11-06 — Extend streaming credential inspection to every forwarded string

- Independent re-review confirmed the previous cancellation/comment/content fixes but reproduced split credentials in refusal/reasoning fields. Added failing reproductions for those fields and metadata against 4016c877; that head must not merge.
- The bounded rolling inspector now traverses all JSON string values, field names and nested arrays, rather than content alone. A bounded event queue releases earlier safe events once possible matches move on; repeated metadata prefixes cannot retain the entire preceding stream. Added nested-token and incremental metadata regressions. Local gates, fresh exact-head CI and independent review are required again; no live inference or production changes.

- Broader-inspector validation: all 54 loopback gateway tests pass; 3,235 full coverage suites pass (48,643 passed, 89 skipped); all applicable local CI-equivalent checks and all five emulator drills pass. Missing-key smoke exits 1 as intended. New hosted exact-head CI and independent re-review remain required. No live gateway call or production change occurred.

### 2026-11-06 — Remove credential-lookahead stream stalls

- Re-review reproduced a permanent prefix from one-time role metadata: a t-prefixed credential and role assistant caused a normal large stream to remain buffered. Added a failing regression against bc387a7 that requires the first role event before the server sends the remaining 1.5+ MiB answer.
- Removed answer-event buffering entirely. The inspector keeps only bounded short string prefixes and immediately rejects a substantial credential-prefix marker, including across events. Benign marker collisions fail closed; ordinary short prefix collisions cannot stall streaming. Added single-character fragmentation coverage. Full local/hosted validation and re-review remain required; no production/live-call change occurred.

- Non-buffering correction validation: all 56 loopback gateway tests pass; all 3,235 coverage suites pass (48,643 passed, 89 skipped); all applicable local CI-equivalent gates and five emulator drills pass. Missing-key smoke exits 1 as intended. Published replacement still requires exact-head hosted CI and independent review before merge. No live call or production change occurred.

### 2026-11-06 — Separate account-only Mitrify public-question bot

- PR #4092 merged as 86997144; post-merge CI 42218994732 passed and Cloud Run revision navbharat-ai-prod-05087-vjt serves 100% traffic. No provider activation or live inference was performed.
- User requested a separate Mitrify-only bot visible to one account. Added server-verified visibility and dispatch using the existing server-only email selector; no account address or credential is committed. Sidebar/navigation/render all require the server capability, and changing accounts discards/cancels the panel.
- The privacy boundary is an allowlist of three server-owned public questions, not a text classifier. Free text, identity, profile, history, files and caller parameters cannot enter the gateway payload. Each request is stateless, non-streaming, bounded to 256 output tokens, and has no direct fallback. Existing chat and App Builder remain unchanged.
- Missing selector hides the bot; direct mode or missing key gives the selected account an unavailable state. No production flags or credentials are installed, and no live test is run. The user-operated bot may spend gateway credits if enabled and clicked; it does not claim an INR cap or implement wallet charges. The prior single-use diagnostic admission remains unchanged.
- Initial verification: 60 loopback transport/bot tests and 67 targeted route/privacy tests pass. Full local CI-equivalent gates, required hosted CI and deployment remain pending before publication/merge claims.

- First full gate exposed four legacy POST-only route harnesses, hardcoded panel colors, and the chip-registry parser/icon uniqueness check. Added GET support to the harnesses without changing their existing assertions, used semantic theme tokens and a distinct chat icon, and let the registry test parse a dynamic memo dependency list. Losing capability now closes the private tab to Home; Stop clears pending UI immediately. All 200 targeted tests across the nine affected suites pass after correction, and build/boot pass. Full corrected-tree coverage remains required; the initial failing run is not counted as passing.

- Corrected runtime validation: all 3,236 coverage suites pass (48,647 passed, 89 skipped), all 60 loopback tests pass, and all five emulator drills pass again. Audit/signatures/licenses/SBOM, unused imports, native guard, server/benchmark types, OAuth/answer checks, build/bundle/boot/dependency gates pass; missing-key smoke exits 1 as intended. The final result matrix caught a frontend type error: the installed Lucide package exports MessagesSquare but this repository's manual declaration omitted it. Added that one type-only export; frontend typecheck and the declaration/registry/privacy tests pass after correction. No runtime code changed after full coverage. Node 22.23.4/npm 11.18.0 match CI; local Java 21 is Debian OpenJDK rather than hosted Temurin. No live gateway or authenticated-browser test occurred. Hosted exact-head CI and deployment remain pending.

### 2026-11-06 — Make restricted bot failures diagnosable on a phone

- User can now see the separate bot but a preset request fails. The UI discarded every server error code, preventing configuration, authorization, network and response-format failures from being distinguished. Added fixed local explanations and bounded HTTP status display; arbitrary error payloads and raw gateway messages never reach the screen. Non-JSON failures retain their HTTP status.
- This fixes diagnostic visibility, not an unverified live gateway failure. No production credentials/settings or live inference were accessed. Free typing remains a separate unresolved privacy decision: arbitrary text cannot be guaranteed free of sensitive data by a keyword detector. Account authorization and existing chat/App Builder behavior are unchanged. Required validation remains pending.

- Diagnostic validation: all 3,237 coverage suites passed (48,650 tests passed, 89 skipped), all 60 loopback Mitrify tests and all five emulator drills passed. All applicable local security/type/build/bundle/boot/dependency gates passed. Missing-key smoke exited 1 as expected. Node 22.23.4/npm 11.18.0 match CI; Java 21 is Debian OpenJDK rather than hosted Temurin. Required hosted CI and deployment remain pending; no live inference was run.

### 2026-11-06 — Add explicitly reviewed text to the selected-account bot

- User reiterated free typing after the notice that the sender must review sensitive content. Replaced the preset-only UI with a bounded text box and confirmation that resets on edit/send. Only the submitted message is sent, unchanged; no account/profile/history/files are appended. Older installed preset clients remain compatible.
- Server identity authorization remains mandatory. Exact payload validation, per-send confirmation and conservative recognizable-sensitive-pattern rejection add safeguards; neither documentation nor UI claims complete sensitive-data detection. No raw gateway error is rendered or logged by this change. No live inference or credential/configuration change occurred.
- Required local/hosted gates must run again. Existing GitHub CI startup failures remain unresolved; reading repository Actions permissions returned integration HTTP 403 and was not bypassed. This restriction prevents policy inspection, not local implementation/testing.

- Reviewed-text validation: all 3,237 final coverage suites passed (48,650 tests passed, 89 skipped), all 63 loopback tests, 36 focused tests and all five emulator drills passed. Other applicable local gates passed. A restarted coverage attempt initially hit a stale lock owned by a defunct prior test process; final coverage used a separate report directory with identical thresholds, and the confirmed stale lock was removed. Missing-key smoke exited 1 as expected. Hosted CI and deployment remain blocked/unverified; no live inference or production change.

### 2026-11-07 — Default-off verified-user availability preparation

- Added explicit selected/verified access modes for the separate bot. Default/blank retains the selected-account behavior; unknown modes fail closed. Verified mode still requires server-verified UID/email and does not change rate limits, content review, direct main chat or the isolated INR diagnostic.
- Public activation remains a separate operator step requiring authorized runtime access and applicable spending safeguards. No live request, credential change or public activation occurred. Documented valid alternative spend bounds without assuming provider discounts or token estimates prove costs; user-specific financial/access details are not published here.
- Local tests and required hosted CI must pass before publication/merge. No secret values or actual account addresses were added.

- Verified-user access validation: all 3,237 coverage suites passed (48,650 tests passed, 89 skipped), 67 loopback transport/access checks, 36 focused tests and all five emulator drills passed. All applicable local security/type/build/bundle/boot/dependency gates passed; missing-key smoke exited 1 as expected. Node 22.23.4/npm 11.18.0 match CI; Java 21 is Debian OpenJDK rather than hosted Temurin. Required exact-head hosted CI remains pending. No live gateway request or production activation occurred.
### 2026-11-07 — Controlled synthetic guest load-test preparation

- Added a separate default-off endpoint without Firebase login, restricted to fixed public arithmetic prompts and 1110 numbered single-use slots across three batches. Shared Firestore transactions bind expiring operator admission to the gateway configuration and inclusive hard-cap confirmation; claims are not refunded. This request ledger is not a monetary cap.
- Ordinary chat/App Builder and their limiters remain unchanged. Invalid control tokens keep the guest/IP limiter; valid test credentials use the isolated campaign's shared limits. No campaign, credential, production setting or live traffic was created.
- Added a barrier-start operator runner and loopback/route regressions. Required full validation and hosted CI remain pending. Live execution needs authorized runtime binding, campaign provisioning and permitted destination access; it is not claimed complete.

- Guest-campaign final validation: 3,237 coverage suites passed (48,654 tests passed, 89 skipped), 76 loopback transport/access/runner checks passed, 35 route tests and all five existing emulator drills passed. A separate real Firestore emulator check with two independent clients verified single-dispatch replay protection and revocation. All applicable local security/type/build/bundle/boot/dependency gates passed; missing-key smoke exited 1 as expected.
- Full coverage initially found the new operator endpoint missing from the external-caller inventory. Added its actual runner as the documented caller; all 18 census checks and the clean full rerun passed. The earlier validation restart also required removal of a lock whose owner was confirmed defunct. Node 22.23.4/npm 11.18.0 match CI; Java 21 is Debian OpenJDK rather than hosted Temurin. Hosted CI has startup failures before jobs execute. No live guest traffic, campaign provisioning, credentials or production activation occurred.

## 2026-11-07 — default-off fixed text-chain policy (partial rollout preparation)

Based on main f52d32a1d (PR #4096 is merged). Added `TEXT_CHAIN_POLICY=legacy|fixed-v1`, default legacy, to order eligible FreeChain and reviewed InferenceGateway text profiles. Legacy limits and behavior remain default. Fixed mode suppresses competing order/admin/sticky/cache selectors, binds policy to gateway evidence and ledger history, stops uncertain paid fallback, and preserves quota/price/quality/privacy gates. Ordinary professional ingress fails closed when its selected gateway/funding authority is absent; shared developer helpers, structured exam generation, Pro and App Builder retain their existing paths.

Mitrify's position is an explicit non-dispatching policy boundary: no complete-payload public provenance or monetary admission bridge exists for ordinary health-classified chat. `MITRIFY_CHAIN_ENABLED` cannot override this. Paid-professional funding integration and universal ingress enrollment remain incomplete; this is not a production-ready universal chain. Details and rollback: `docs/fixed-text-chain.md`.

Validation checkpoint: 49 focused suites / 1,775 tests passed, then 245 issuer/ledger/professional tests passed after the history-bound and structured-exam exclusion changes. All five CI Firestore emulator drills and the two-client guest admission drill passed. Node 22.23.4 / npm 11.18.0 match CI; local OpenJDK 21 is Debian rather than hosted Temurin. Full coverage and remaining CI-equivalent gates are running; final result will be recorded separately. No live inference, secrets/configuration changes, activation, deployment or capacity claim. Workspace still lacks production runtime identity/secret binding and permitted Mitrify/NavBharatAI egress.

## 2026-11-07 — professional ingress contract follow-up after #4097

The user merged #4097 as f1c46c837 before hosted CI could start. Source tree matches tested head 99c23c778 exactly. Main's post-merge Actions run 42352380871 also reports startup_failure with zero jobs; no deployment of this commit was verified. Main-chat Mitrify remains non-dispatchable and fixed mode must not be treated as a complete rollout.

Full local coverage exposed three existing professional conversation contract assertions: the new option changed the literal source order and the default-mode engine argument shape. Follow-up preserves the existing conversationId/platform prefix and adds fixedTextChainIngress only when the server policy is fixed-v1. Existing assertions were not weakened; two new regressions prove default shape and rejection of body-controlled policy. Targeted conversation/route checks: 23 passed. Complete coverage rerun and all applicable gates remain required before merging this follow-up. No production configuration or provider call was made; the separate guest load test is not a prerequisite for main-chain rollout.

### Exact-public-payload Mitrify admission

- Added actual conditional dispatch at the fixed FreeChain Mitrify position. Exact
  server-reviewed public payload, UID, endpoint/model/credential binding, one-use
  expiring Firestore claim and evidenced supplier hard per-request ceiling are
  required. No approvals or production settings are created by this change.
- Reserve all permitted HTTP attempts in the existing shared daily/monthly budget;
  retain uncertain/used liability and stop fallback after dispatch failure or
  partial output. Revalidate shared controls and approval before each attempt.
- General health/private classification, selected Gateway funding requirements,
  paid-professional funding boundaries, standalone no-fallback bot, Pro and App
  Builder remain intact. This is not universal production activation.
- Added local HTTP regressions and a real two-client Firestore claim race check;
  CI now executes the admission emulator check alongside existing database drills.

### Separate Mitrify bot response truncation

- Root cause in code: the bot requested 256 output tokens and discarded the
  provider finish reason; the plain-text UI displayed that cut response as complete.
- Default output allowance is now 2,048 tokens. Server-only
  MITRIFY_BOT_MAX_OUTPUT_TOKENS accepts 1–32,768; this application ceiling is not
  a verified model limit or a monetary authorization. No account cap is changed.
- Preserve the full returned text and show length/filter/unconfirmed-completion
  warnings; missing finish reasons and old-server responses cannot imply success.
  No automatic continuation, additional paid retry, timeout extension or history
  replay is introduced. Privacy/account gates and main chain/Builder stay intact.
- Added longer-answer, completion-reason, malformed-response, deadline and UI
  regressions. Required local checks are recorded in the accompanying PR.


### Reviewed Mitrify continuation capability (fail closed)

- Added explicit context review and one-at-a-time continuation controls for length
  stops only. Old answer text remains intact; appends preserve repetition.
- Server binds one-use Firestore tickets to account, exact context, gateway,
  credential, output allowance, instruction and expiry; three rounds, 32 KiB
  request context, one HTTP attempt and 60 seconds per call are enforced.
- Production has no verified funding adapter and therefore cannot dispatch a
  continuation. No environment/browser flag grants funding. No merchant cap,
  credential, production setting, main chain, guest test or Builder was changed.
- Offline tests cover races, replay, privacy/account checks, bounds, cancellation,
  funding denial and revalidation. Required gate results are recorded in the PR.

## 2026-11-07 — More room for long public Mitrify answers

The separate bot still defaulted to 2,048 output tokens after the first truncation
fix. That application allowance can end a long Hindi answer before the requested
line count. Raise only the unset/blank default to 8,192; preserve explicit operator
values (including 2,048), the finite 32,768 configuration ceiling, existing supplier
errors, deadlines, cancellation, privacy gates and monetary controls. This is an
application allowance, not evidence that every gateway-selected model supports it
or a promise of unlimited output. No automatic continuation/replay is added.

Mock regressions preserve all 100 Hindi lines and their exact prompt, assert the
8,192-token request, and retain length/incomplete status and unavailable continuation
when funding is unverified. A component test preserves the final line. Existing
broken-body, timeout/cancellation and gateway error tests remain applicable. Actual
production override/model capability and live behavior are unverified: no permitted
runtime identity or new gateway evidence is available. No paid requests or production
configuration changes were made. Required aggregate validation is pending.

Long-answer validation completed: 3,239 suites / 48,728 tests passed, 89 skipped,
coverage gate passed; 111 offline transport checks, 12 targeted UI/privacy checks,
and all six emulator drill groups passed. Security, type, build, bundle, boot and
production-dependency gates passed. Reverting the default to 2,048 makes the new
Hindi regression fail; restoring 8,192 passes. Node 22.23.4/npm 11.18.0 match CI;
Java is Debian OpenJDK 21 versus hosted Temurin 21. Missing-key smoke exits 1 as
expected. Draft PR creation was denied by automatic approval review for missing
branch-specific publication approval; GitHub lookup confirmed no PR was created.
No retry or alternate publication route was used. Live behavior/configuration
remains unverified; the default does not override an explicit Cloud Run setting.
## 2026-11-07 — Concise Mitrify message confirmation

The reported long sentence originated only in the separate bot's checkbox label;
it was not prepended to provider requests or replies. Replace it with “I confirm
this message contains no sensitive or personal information.” The existing visible
provider/privacy disclosure, unchecked default, per-edit reset, confirmation gate,
server exclusions, and continuation review remain unchanged. Sibling search found
no other production occurrence of the removed sentence. Component regressions
cover the concise label, retained disclosure/unchecked disabled-send state, and
unmodified reply rendering; the existing mock transport test asserts the exact
single user message and reply, with no confirmation text inserted. Required local
aggregate checks and hosted CI are pending at this checkpoint; no live calls or
production settings were changed.

Validation completed for the concise-label change: 3,239 suites / 48,729 tests
passed, 89 skipped, full coverage gate passed; 109 offline transport checks and
all six emulator drill groups passed (queue 21/21). Type, security, dependency,
license, build, bundle and boot gates passed. Node 22.23.4/npm 11.18.0 match CI;
local Java is Debian OpenJDK 21, while CI uses Temurin 21. Missing-key smoke exited
1 as expected without an inference call. Draft PR creation was rejected by
automatic approval review for lack of branch-specific publication approval; a
read-only lookup confirmed no PR was created. No bypass/retry was attempted.

## 2026-11-07 — Resolve #4103 after #4102 merged

Merged main 5f5661d43 into the long-answer branch. The sole conflict was adjacent
additions in MitrifyChatPanel.test.tsx; retain both the 100-line Hindi rendering
regression and concise affirmative privacy-confirmation regressions. The concise
checkbox and 8,192-token default are both preserved, along with both documentation
entries. Combined targeted tests pass (14); full required validation is running.
No provider calls or production configuration changes were made.

## 2026-11-07 — Compact ordinary-chat quota details

The shared daily quota banner occupied a separate flex row below AI Chat's title.
Ordinary AI Chat now renders the same server-derived remaining/limit as a compact
button between the title and New chat. Details use a non-modal portal overlay,
with outside-pointer/focus dismissal, toggle, Escape, explicit close, keyboard
exit and focus restoration. Session/account keys and unmount clean up the overlay.
Professional and exam screens retain the original badge. Quota accounting, hook,
reset text, provider routing, auth and paid admission are unchanged. The existing
status contract is finite counts or null; null remains unavailable (—/—), never
an invented /50 or unlimited state.

Static regressions cover changing entitlement, zero/exhausted and unavailable
counts. An offline Chromium test renders the actual panel header and quota control
with mocked chat/API data at 320, 390, 768 and 1280 pixels: counts, refreshed details,
repeated taps, keyboard/focus, outside dismissal, session/navigation cleanup and no
horizontal overflow or lost chat space. First browser run found Tab could leave
an overlay open toward browser chrome; the boundary now closes and restores focus,
and the regression passes. Screenshot Library downloads failed for both supplied
files, including one bounded retry; their original pixels were not viewed locally.
Local fixture screenshots were viewed and show the compact header and overlay.
Full required checks are pending. No paid requests or production settings changed.

The first aggregate run found one genuine integration failure: the new dialog
omitted the shared sheet safe-area/bottom-navigation geometry contract. Adopt
nb-sheet-overlay and nb-sheet; retain safe top padding when anchoring below the
counter, and reserve the bottom bar instead of overriding the contract. The 101
targeted UI/quota/sheet tests pass; browser coverage now includes a short 320px
viewport with a 59px notch and 90px bottom-nav reservation. No baseline or test
threshold was weakened. Re-running the full required checks on this correction.

## 2026-11-08 — AI unanswered investigation: professional recovery and truthful observations

- Verified source/reproduction: professional streaming waited the entire 12s commit window even after BOTH physical racer calls had already ended without answer. Existing sequential fallback now starts immediately on both terminal results; Pro/App Builder timing, provider order, admission and spending controls unchanged. Old code failed two new regressions; corrected code passes. Partial commitment never starts another answer.
- Verified instrumentation blind spot: legacy AIRouter outcome counters omit gateway/strict-free early returns and Universal free-chain dispatch; partial streams can count as legacy success. Kept that historical denominator explicitly labelled as an incomplete legacy sample, removed unsubstantiated key-rotation advice, and added a separate approximately-15-minute process-local Universal-router observation (including helper calls). States: transport-complete, partial, refused, cancelled, failed; fixed allowlisted failure categories and per-surface counts, no prompts/IDs/raw errors retained. This is NOT an all-instance/user-request SLO, correctness assessment or a counter reset.
- Verified Monitor reporting defect: a failed write is restored to pending, but readable empty storage previously reported available with zero data. Pending unpersisted observations now make the timeline unavailable; mocked failed-write/readable-store and subsequent recovery covered. This does not establish cross-instance telemetry completeness or solve ambiguous-write accounting. Active build logs do not imply a completed-build counter should already increment.
- Open production cause: the supplied 300/340 screenshot does not reveal terminal error codes, active route/configuration, provider admission/quota state or complete request outcomes. No signed-in production/runtime log evidence was available; no previously denied access was retried. Need authorized sanitized terminal diagnostics for a defined time window/revision before attributing the 88% or measuring 99.9%. No live paid inference, keys, production configuration, privacy or cap changes.
- Focused validation checkpoint: 9 files / 110 tests passed before final small classification tightening. Full CI-equivalent gates, emulator drills and final-head results are recorded separately. Answer correctness/relevance/completeness still requires reviewed representative outputs; transport completion alone cannot establish it.
- Validation follow-up: initial full coverage surfaced cache-census and callback-identity expectations; observation state now uses the existing BoundedCache (hard 16 buckets, O(1) recording), and callback tests exercise exact forwarded text/source instead of function identity. Explicit safety codes take precedence over generic HTTP status. No census exceptions or directory exemptions added. Race and timeline negative controls both fail on restored main code and pass on the fix; final focused run: 12 files / 171 tests passed. A clean final full run follows these corrections.
- Final clean validation on corrected source: 3,241 coverage files passed; 48,755 tests passed / 89 skipped. All six emulator groups, audit/signatures/license/SBOM, frontend/server/benchmark types, imports/native guard, OAuth, answer-quality, Mitrify regressions, build/bundle/boot and dependency gates passed. Missing-key smoke exited 1 as expected without dispatch. Node 22.23.4/npm 11.18.0; Debian OpenJDK 21 differs from hosted Temurin. Metadata lookup 403 warnings occurred in tests but no final failures. Hosted CI and production outcomes remain unverified pending publication/checks.
## 2026-11-07 — Ordinary AI Chat send position

- Root cause: the shared composer vertically centered the send slot in the textarea row. Ordinary AI Chat now opts into a lower toolbar row with 10px right/bottom padding; normal flex layout reserves the actual Send or Queue/Stop width. Shared defaults and the Enter preference pill remain unchanged. No routing, billing, auth or App Builder changes.
- Added component/source regressions and a loopback browser layout check covering narrow mobile, keyboard-height viewport, long text, auto-grow, disabled/attachment, Queue/Stop, Enter preference and unchanged shared defaults. Focused tests: 8 files / 116 tests pass. Browser checks pass at 320/390/768/1280px widths; generated short and keyboard-height fixtures inspected.
- Original screenshot Library downloads failed, including one bounded retry; original pixels were not available locally. Fix is source-grounded and independently checked in browser fixtures, not represented as production screenshot verification. Full repository gates and emulator checks are tracked in the PR validation evidence. No paid inference or production settings changed.
- Final local validation: 3,240 coverage files passed; 48,739 tests passed / 89 skipped. Audit, signatures, license, SBOM, frontend/server/benchmark types, imports, native guard, OAuth, answer quality, Mitrify regressions, build, bundle, boot and dependency gates passed. Missing-key smoke exited 1 as expected without dispatch. Six real Firestore emulator groups passed. Node 22.23.4 / npm 11.18.0 match CI; local Java 21 is Debian OpenJDK, not Temurin. Coverage emitted metadata-lookup 403 warnings but passed.
- Negative control: removing the NBI layout opt-in failed the new regression; restored bytes passed all four new cases and the final browser run. Hosted CI and deployment remain separately required; no live claim is made here.

## 2026-11-08 — Reconcile #4106 with merged send-button fix

- GitHub reported #4106 dirty after main advanced to 0b3c95b99 (merged #4105). Local no-commit merge of that main completed automatically, with no unresolved files or manual conflict markers. PROGRESS histories were combined; all incoming Send/Stop positioning changes and all reliability changes are retained. No provider, budget, privacy or production configuration changes. Validating the combined tree before updating the existing PR.
- Combined-tree validation: 20 focused files / 287 tests passed; full coverage 3,242 files passed, 48,759 tests passed / 89 skipped. All six emulator groups and remaining security/type/build/bundle/boot/dependency gates passed; missing-key smoke refused dispatch as expected. No unexpected exits across 26 checks. Node 22.23.4/npm 11.18.0, Debian OpenJDK 21. No source changes were needed after the automatic merge; hosted CI remains a separate merge gate.

### 2026-11-08 — retire testing bots and revise reviewed Mitrify data policy

- Removed separate Mitrify menu/chat/continuation/public/guest endpoints and exclusive implementation, and Admin AI Engines provider testing bots including their exclusive throughput/batch modules. Preserved shared transport, provider redaction, auth/accounting and all stored records; no database migration/deletion. Retired saved Mitrify view falls back to Home without deleting history.
- Removed unconditional private/health rejection from legacy main-chain Mitrify. Existing public approvals remain public-only; new exact-data approval format requires classified scope, downstream processor review and actual authority/terms/protection evidence references. No production approval records, keys or settings were created.
- Main-chain Mitrify now requires confirmed stop finish reason; missing/length completion remains partial and terminal, without hidden fallback. Main requested order already matches fixed-v1; default legacy, Gateway Mitrify adapter and paid Professional funding remain unresolved, not falsely enabled.
- Local focused routing tests: 73 passed. Full final validation pending. Load testing remains cancelled; no live inference, broad routing activation or production change.

### 2026-11-08 — bot retirement / reviewed-data policy final validation

- Final staged-tree coverage passed: 3,222 files; 48,441 tests passed, 95 skipped. Coverage statements 75.40%, branches 71.33%, functions 77.99%, lines 77.41%. All six real Firestore emulator groups, 60 loopback Mitrify checks, audit/signatures/licenses/SBOM, type/import/native/server/benchmark, OAuth/answer-quality, build/bundle/boot and server dependency gates passed. Missing-key smoke exits 1 as designed; no inference call. Node 22.23.4/npm 11.18.0 match CI; Java is Debian OpenJDK 21, not CI Temurin. Metadata lookup warnings appeared without failing final coverage.
- Earlier attempts do not count as passes: removal initially left an empty JSX wrapper, an unused icon and an obsolete route test; these were corrected. A transport fixture accidentally gained an extra SSE stop event while retaining the old raw-event expectation; restored its original transport fixture. Coverage was interrupted during final policy/log cleanup, and another run found unstaged deleted files still listed by git ls-files. Staging the intentional deletions fixed the inventory failure; its focused 29 tests and the complete final run passed without weakening assertions.
- Requested fixed order already exists; Groq/Cloudflare fixed mode require verified-free-no-overage. Default legacy mode remains unchanged. Gateway Mitrify adapter and paid Professional predispatch funding/settlement bridge remain unfinished; no global activation substitutes for them. Existing 250/80 output defaults apply to selected non-reasoning rungs; no runtime values or live accuracy/capacity were verified.
- No load campaign, paid/live inference, production configuration, credentials or persistent access changed. No stored histories or accounting records deleted. Required hosted CI and deployment remain unverified until PR checks run.


## BR1951 sequential audit — verified-state contract (merge pending)

Owner order: after BR1950, inspect every outcome ascending, one report at a time. This branch audits ONLY succeeded BR1951 (`9abd4380`), not BR1952 and not all 155 queued IDs. Initial inventory1951–2105 is complete; later BR2106 does not silently extend the boundary.

Complete retained report, all12 problems, all301 issues,14 commands,52 LLM entries, manifest, billing, final summary and failed-autopsy lookup reviewed. Full evidence boundaries, all30 item rows and four-field blockers are in `docs/build-report-autopsy-BR1951.md`; Q-2349–Q-2377 are independent queue IDs, not BR numbers. Five buckets:5 self-heal,2 workaround,7 skip (1 intentional optional-consent observation),9 shipped-imperfect,7 struggle. Nine technical rows fixed at platform class;20 retain explicit blocked work (2 partially mitigated). No whole-report zero-defect or historical-app repair claim.

Ten class changes: unknown recipe reads return an error rather than zero-file kit success; preserved files are not compacted as writes; successful tsconfig writes invalidate cached absence across writer lanes; absent Vite/CRA entry blocks premature DONE; real JSX syntax distinguishes controls from TypeScript generics; failed managed server has nonzero receipt; undeclared direct config imports avoid two ineffective reinstalls; DOM action games are explicitly unplayed and enter summary claim checking; report counts include the actual outgoing appended issue; localhost live-preview claims are visibly corrected; zero hostile cases no longer claim a safety pass. Existing #4108 sandbox admission mitigation and Q-107 test-runner/image debt are referenced, not falsely reimplemented or closed.

Regression: `tests/br1951Autopsy.test.ts` plus neighboring recipe/JSX/claim/red-team/readiness suites; separate baseline worktree reversion proof (new dependency helper retained only as no-op API to test old recovery semantics). Full CI-equivalent local gates required before push; outcomes recorded in PR handoff. No new env flags, routing/billing change, paid call, production replay, deployment, merge or external autopsy persistence. Live connector has no autopsy write operation, and its failure-only autopsy endpoint not finding this successful BR is not a missing report.

Parent owns merge. BR1952 is the exact next report only AFTER this PR's merged state is confirmed; blocked actions remain in the queue after merge.
### 2026-11-08 — professional 10-a-day cap retired; shared 50 remains

- The "X/10 free today" badge was a real second admission counter (`professionalUsageStore` + `professionalFreeDailyLimit`), not a label. Signed-in Teacher, Doctor, Lawyer and the other professionals now use the shared free-answer ceiling (50/day, one pool with Free chat). Guest public chat stays 10. Pass holders and the free-list stay unlimited. Exam mode still prices its first 5 questions separately.
- A failed Doctor answer marks the shared reservation as a provider failure so it can be refunded. One successful logical answer still settles one credit.


## BR1952 sequential autopsy — admission/capability prevention (9 November 2026 IST; merge pending)

Only BR1952 investigated after parent confirmed BR1951 #4123 merged at `4f39a6c989a766d89454652e7465dfea843f41f4`. This corrects earlier merge-pending BR1951 status without rewriting history: nine fixed BR1951 queue rows closed with the closed-ID register; its **20 blocked technical rows remain**, including **Q-2371's real missing DOM gameplay evaluator capability**, not merely absent historical source. Initial boundary1951–2105 unchanged; next is1953 only after parent confirms this PR merged.

Full retained BR1952 report: failed/futility, not user-stop; build `84d16d0e-81fa-47e8-aeb2-d4da35d0e5e6`; digest `f1d131c8e97f1d3fc5d2c6244e4937159cab07b6bd567a1402580e03e872e8b4`;121 issues/27 selected problems/36 calls, complete retained response read. No usable sandbox,0 files/commands/steps/paths read after606.887s. Existing autopsy revision0/not_started/null; **read-only MCP has no write endpoint; no remote autopsy persisted**. Internally truncated previews and missing snapshots/receipts are not invented.

Five buckets:0 self-heals,3 workarounds,6 skips,10 broken/imperfect result observations,26 struggles = 45 independently logged items, not 45 independent root causes. 18 item rows receive eight class fixes here; one serializer item was already fixed by #4123; 26 items remain blocked with all four fields directly in the queue. New IDs Q-2378–Q-2420; existing Q-1122 futility-window policy remains blocked and unchanged; same-class Q-2176 timer fall-through now owned by this PR until merge. Full ledger and exact evidence/root/confidence/sibling disposition: `docs/build-report-autopsy-BR1952.md`.

F1 capability-aware binary manifest/OneShot/continuation/repair boundary; F2 safe resource folding shared with blueprint; F3 acknowledged early contract before consumers; F4 explicit generated-not-saved progress in English/Hindi/Hinglish; F5 post-dispatch observed effects (failed/known-no-op requests are not saved files; prior/partial work retained); F6 terminal heartbeat/ETA ordering; F7 no engine upsell for final unrecovered infrastructure; F8 unavailable setup skips both text-only lanes without aborting recovery-capable full builder. No forced quota/timeouts, model swaps, pricing/billing changes or paid replay. The late binary and read-before-write guards remain protective.

BLOCKED root causes: external E2B admission/scaffold/recovery (including every failed read/write/probe); roadmap architecture agreement vs planner-invented single HTML; complete steer-arrival/concurrent-write trace for safe lane yielding; cross-lane language binding; real public-channel/upload and monetization infrastructure/validated metrics; upstream usage settlement receipts; remaining serial/context timing trace. Each row says **What/Why/Needs/Already tried**; detailed required actions and options are in the audit. Strongest proactive lever: prove admission, capabilities and saved prerequisites before expensive generation; F1/F3/F8 implement the local prevention half. Broader app/backend/gameplay debt is not claimed fixed by wording.

Regression: real production helpers/AgentRunner and AST-selected route callbacks/expressions plus a whole-server sibling census in `tests/br1952Prevention.test.ts`; adjacent existing controls retained. Exact baseline reversion/final gates/PR head/hosted CI evidence to be reported from actual logs, not preclaimed. No merge, production replay, paid benchmark, deploy, env/credential change, send or cloud agent.

### BR1952 #4124 — independent reversion and final-gate checkpoint (9 November 2026 IST)

Draft PR #4124 is the sole BR1952 PR. Normal merge integrated main `94641a9c524380ab64236ebe2ab77a673d8ccf16` (#4058 type pin); no rewritten history. Final44-case fixture on isolated original baseline gives31 expected failures/13 passing controls, with only a compatibility helper export added so failures measure original caller behavior. Review of the new early contract write added the existing early-save settlement fence and lapse/stop guards; the late-announcement regression was first red and the six relevant lifecycle/lane suites then passed194 tests. All43 newly allocated queue rows and same-class Q-2176 now name #4124, not an ambiguous “this PR”. Final full local gates are running next; interrupted pre-main/pre-refinement attempts are retained in logs and are not passing gates. Parent merges independently;1953 remains paused.


### BR1952 #4124 review refinements — 9 November 2026 (IST), not yet merged

The existing whole hand-off write census exposed a new duplicate acknowledged-contract save introduced by F3. Preview hand-off now skips confirmed identical files too; refused/unknown receipts still retry, changed import-fixed files still overwrite, and early-save settlement ordering stays enforced. Historical fixtures release the first consumer save, not the new prerequisite; a separate Stop-after-prerequisite control keeps that new boundary covered. Own-deadline AST fixtures receive the actual binary-decline constant; saved-work source guards enforce observed post-dispatch effects. No old invariant disabled to force green.

Cross-check identified D46/Q-2421: top-level cacheReadInputTokens 259264 vs sole-provider ledger 209040, difference 50224. Current Surplus runner/manual fastGenerate both capture one delivery: receipt dedup works but independent cache += doubled it. Real production callback prefix + receipt policy/ledger reproduced 5 becoming 10 while ledger stayed 5. F9 derives informational cache/live snapshot from the same accepted ledger. Exact historical per-call cache allocation is absent; no supplier expense reconstruction or charge change. Revised buckets: 0 self-heals / 3 workarounds / 6 skips / 11 broken / 26 struggles = 46 item rows; 19 fixed-in-branch across nine classes, one previously fixed by #4123, 26 blocked. All20 BR1951 unresolved technical rows, especially Q-2371 gameplay evaluator, remain open. Final actual validation/reversion counts will be reported from logs; failed/interrupted runs are not passes. No remote autopsy persistence or BR1953 work.


BR1952 final ledger census refinement: I014 engine-unavailable error and I106 OUTCOME_FUTILE each now have individual Q-2422/Q-2423 rows, distinct from I013 and I103, even though their infrastructure class is shared. All28 retained warning/error occurrences map individually. Final report tally is 48: 0 self-heals / 3 workarounds / 7 skips / 11 broken / 27 struggles; 19 report rows fixed in branch across nine classes, one previously fixed, 28 blocked. Separately Q-2424/Q-2425 track the duplicate prerequisite and late-save race discovered while reviewing the unmerged F3 patch, not imaginary historical defects. Final47-case isolated baseline reversion produced33 expected failures/14 passes; final focused controls170 tests/six suites passed. No remote persistence or merge claimed.


The completed first integration coverage run additionally caught five source-guard mismatches: seeded-page gate now has independent sandbox availability, live cache snapshot uses its accepted ledger binding, ETA remains entered only while active, and generated “not saved yet” must not be mistaken for the kept-work narration. Guards retain their original seeded-page/live-report/measurement/white-label invariants while recognizing these stricter conditions. The initial run is archived as failed, never a passing final gate.


BR1952 integrated parent-verified latest main e4bc40b197867ff5d71f7692083174029e4cd38a (#4117) by a normal merge, no rebase/force. Verified all52 imported chat paths identical to main; BR1952 does not change routing, flags, credentials or deployments. The otherwise-corrected pre-#4117 local CI and demo-emulator runs were explicitly stopped as obsolete; partial gates do not count as final green. Full CI-equivalent recipe restarts on this final integrated code.


## BR1952 / #4124 follow-up — first-pass prevention, not historical-app repair (9 November 2026 IST)

Owner-directed independent review correctly rejected missing historical planner/steer/language detail as an absolute engineering blocker. Same BR1952 branch/PR only: F10 rejects the evidenced invented single-HTML/Vite roadmap contradiction and validates genuine original-user one-HTML constraints at manifest/OneShot boundaries; F11 keeps steering queued while fast work yields, preserves completed work, drains accepted writes before instruction ownership passes once, and prevents stale-scope terminal success; F12 binds original/live Hindi/Hinglish/English reply language across planner, text, primary/child/retry/heal boundaries; F13 bounds repeated full-builder capacity probes with one real recovery after the first proven refusal, shared across child/retry/heal runners. No arbitrary clock/quiet-window change, quota/capacity change, machine kill, deployment, credential/env change, paid replay or provider routing change.

Report ledger remains 48 observations / five original buckets: now 25 fixed-in-branch across 13 classes, 1 previously fixed (#4123), 22 blocked. D29/D30's legitimate admission/recovery refusals remain external; D31–D33's avoidable repeats are prevented. Two prior F3 review regressions stay separately tracked and protected. All 20 unresolved BR1951 rows remain, including Q-2371's real missing DOM gameplay evaluator. No queue row is closed before parent verifies merge; BR1953 not started. Server autopsy write is unavailable and was not performed.

New real offline integration fixtures and old source/ownership/Stop/SDK-deadline safeguards are enforced; existing tests were adapted only for new options/wrappers, never removed or weakened. Handler branch budget remains 537. Separate pre-follow-up worktree reversion supplies only dependency/API compatibility shims, never missing-API failures. Exact final head, reversion counts and full local CI-equivalent logs are reported only after completion in the PR handoff/verification-followup.json; earlier interrupted/exploratory/failed runs remain failures. No hosted billing rerun requested. Parent independently reviews and merges; no self-merge or BR1953.


### 2026-11-09 — BR1952 / #4124 prevention review: every admitted role and direct writer

The intermediate integrated `ffb67d53e7a03ded2eef2bfdf355f0b170d9cadf` passed the complete local workflow (48,873 tests / 89 skipped / 3,234 suites and all six emulator commands); it is not the final-head proof after this correction. Subsequent source review found two additional unmerged F13 sibling gaps, not historical BR defects: R03/Q-2426 read-only child runners discarded an explicitly supplied shared admission budget, and R04/Q-2427 append_file/write_files_batch bypassed an already-exhausted budget. Three real assertions failed before correction (32 controls passed), without missing APIs or test harness errors. The explicit budget now binds all roles and both direct-write siblings share its refusal door; unbound answer-only runners, successful recovery and non-sandbox controls remain. Final fixtures and a separate baseline worktree reversion cover these paths. No opaque batch prose is called a capacity receipt and no initial in-flight operation is claimed cancelled.

Historical ledger stays 48 = 25 fixed-in-branch / 1 prior merged fix / 22 blocked; review-only subtotal is four R01–R04. All branch fixes stay IN PROGRESS pending independent parent review and merge. Final integrated-head full CI-equivalent results and exact logs are recorded only after they actually complete in the PR handoff and /workspace/br-autopsy-1952/verification-followup.json. BR1951's 20 blocked rows, including real Q-2371 DOM gameplay evaluation engineering debt, remain unchanged. No server autopsy write, main merge, deployment, environment/credential/capacity change, paid replay or BR1953 work.


### 2026-11-09 — BR1952 / #4124: keep the architecture guard evidence-scoped

R05/Q-2428 is an unmerged F10 review-only false positive: a compatible FastAPI-served single HTML frontend failed an assertion against the actual production function because the initial guard treated every non-static framework as contradictory. The guard now targets the evidenced selected vite-react contradiction only; FastAPI and Express controls preserve compatible backend plans. This is a precision correction, not a new product capability or a claim about the historical app. Review-only subtotal is five, separate from unchanged 48 historical items (25 branch fixes / 1 prior fix / 22 blocked). The obsolete 12fe7c full coverage job was explicitly stopped after proving this defect; its partial logs are archived as interrupted, never green. All pre-gates and its six emulator commands did pass, but the full local workflow is restarted on the corrected committed head. No other job/machine, production environment or main branch was changed. No BR1953 work.

## 2026-11-09 02:28 IST — BR1953 only: exam-contract/seed autopsy, pending parent review

- Owner's sequential queue: BR1952 #4124 confirmed merged exact fbab167a via8d897a9fa; this fresh worktree includes that, #4117/e4bc40b19 and #4123/4f39a6c98. BR1954 has NOT been started; initial highwater remains2105. Parent alone reviews/merges.
- Full BR1953 e3b56ad6-b7a2-4439-885e-eb89d8471164 / digest5886f7ffa14397a743da4141afbe523478cfd530015723442f679ac20cd3c21f: outcome user-stopped,92 retained info issues (stale91 count),10 model calls,4 commands,12 final hashes. Read-only autopsy revision0/not_started/null; no server write or fabricated timestamp.
- Historical/inspection ledger11: self-heal0,workaround0,skip2,broken8,struggle1.9 rows have seven class fixes in branch,1 is already merged #4123 F8,1 remains BLOCKED on actual final edited source.4 additional unmerged-implementation review safeguards fixed separately, never attributed to the historical app. Every issue and nondefect treatment is in docs/build-report-autopsy-BR1953.md.
- F1 binds question-answer review/bookmarks upstream and at actual mutation admission, including original-request authority across specialists/retry/heal and explicit later user steering. Does NOT replace admitted SURPLUS with a template, disable custom ratings, censor reads, or pretend to be a universal semantic judge. F2 shared paper/section negative scoring; F3 absolute deadline and late-answer fence; F4 once-only attempt submission; F5 browser-history row validation; F6 independent visible/accessibility review flag; F7 build-scoped first-readiness measurement survives Stop/watchdog/admission/guard/error without fabricating final success.
- Review safeguards: inherit F1 into real writer specialist; release exact-chip restriction after accepted real steering; old search text must not block deletion; never serialize/copy unrelated large tool payloads. Actual SubAgent and route-callback controls included. Component tests execute shipped TSX in a deterministic hook harness, NOT DOM/browser proof. Isolated baseline reversion initially11 genuine failures/18 controls; final expanded proof and all ci.yml-equivalent gates still to be recorded in PR handoff. Preliminary508 adjacent checks passed; current focused+queue45 passed.
- BLOCKED Q-2439: what=actual final two App edits and their functional state; why=only capped model/tool previews and hashes, not full bodies; needs=authorized read-only retrieval of existing final12-file artifact plus exact edits; tried=whole report/autopsy/calls/commands/hashes, seed investigation and offline class fixes. No replay after user cancellation, no production workspace repair. Missing historical files do not block the implemented synthetic prevention.
- Prior carry: BR1951's20 blockers, including Q-2371 DOM gameplay evaluation engineering debt, remain honestly blocked. BR1952's22 report blockers remain (21 local rows plus shared Q-1122);25 report fixes and5 review safeguards are merged. Removed only their30 merged rows plus same-class merged Q-2176, with31 IDs appended to CLOSED; new Q-2438 refers to already-merged report-count fix and is separately closed. #4122 retains sandbox observation/cost-uncertainty ownership.
- Billing charge₹0.54 is consistent with working in-build render/Q727=b and the separately itemized discount/fee; no refund, wallet, provider/config, quota, production replay, deployment or merge done. A good render at46s is NOT proof the later edits worked; red release/unverified-turn retention after Stop is correct.
- Next lever: domain-contract first-build tests for the known template, not repeated heals; recommend versioned read-only final-source/edit artifact under existing access/retention policy. No new retention policy or broad unrelated template sweep performed. Full final local workflow and reversion proof, exact PR/head and hosted billing state are required before handoff.

### 2026-11-09 02:38 IST — BR1953 pre-PR follow-up; initial full gate correctly RED

- Actual complete coverage on5081:5 failed/48908 passed/95 skipped,3235 suites (2 failed). Four isolated prompt-producer fixtures retained new ESM exports; one current golden seed was missing from seed history. Repaired the fixture extraction without weakening any old runtime-claim reversion assertions and ran additive-only seed history generator: exactly1 new golden/src/App.tsx hash, zero old versions removed. R06/Q-2446 and R07/Q-2447 are new unmerged-implementation validation findings, not historical BR1953 app failures. No push/green claim made for that head.
- Additional demonstrated source contract D12/Q-2444: #4024 prevented admitted-SURPLUS no-model template substitution, but its prompt sibling still said make-NO-edits. Propagate actual admission into an author-the-exact-request foundation prompt for ALL simple golden apps, no unrelated features/manufactured diff, no policy/provider/routing/price/config change. Default verification/pro/custom user authority remain. The causal share in historical rating drift is not fabricated.
- R05/Q-2445: a shell read/search of rating source is not a proposed mutation. Reuse existing explicit/opaque/removal classifiers; source-reading control passes while redirected/opaque writer controls stay under the original-request contract.
- Updated ledger:12 historical/inspection rows (0 self-heal,0 workaround,3 skip,8 broken,1 struggle):10 class-fixed in branch,1 previous #4123 fix,1 BLOCKED historical-source attribution.7 separately labelled review findings repaired in branch (2 skip,4 broken,1 struggle). Total19 items:17 fixes awaiting final exact-head full gates/parent review+merge,1 already merged,1 blocked. Nine prevention classes. Prior20 BR1951 and22 BR1952 report blockers remain.
- Expanded independent baseline snapshot:17 failures/24 controls; four absent-new-callback extraction assertions are not behavioural proof. First-unmerged-guard reversion:5 failures/36 controls, four actual boundary regressions plus wiring census. Final new head must re-run all ci.yml-equivalent gates, not reuse earlier pre-gate/emulator green logs.

### 2026-11-09 (IST) — BR1953 pre-PR classification/validation refinement (same report)
- Refines the earlier R05 description: missing parsed shell-write targets are NOT read-only proof. A narrow predicate reuses the existing quote-aware tokenizer, permits literal source-search delimiters, and keeps unknown/compound/redirected/expansion/reader-execution commands under the request contract. File compile flags and GNU long-option abbreviations have negative controls. No new shell parser, sandbox capability or provider policy.
- R07 also covers the existing accepted-seed-write ordering fixture's stale three-argument call token. The new actual admission-ownership argument is asserted without weakening any ordering or unsupported-runtime-claim expectation. Focused integrated11-file matrix649 passed before the last additional command controls; final complete workflow still required on the new committed head.
- Ledger remains19 items:17 branch-fixed pending review/merge,1 already merged (#4123 F8),1 historical final-source attribution blocker Q-2439. Nine prevention classes; BR1951 Q-2371 DOM gameplay engineering debt and all prior blockers remain carried, not called fixed.

### 2026-11-09 (IST) — BR1953 expanded reversion proof, before final full gate
- Current isolated baseline73 cases:37 red/36 controls; four absent-callback extraction fixtures are explicitly NOT behavioural proof. Remaining33 are actual output/runtime or source-invariant failures, not missing imports. First-unmerged guard/old validation fixtures:193 cases,12 red/181 controls. Independently putting back the unsound zero-target shell-read classification:9 red/2 controls among11 selected cases,62 filtered. Active production source was never reverted. Raw logs/JSON live under `/workspace/br-autopsy-1953/`.
- No final full-gate success is claimed yet; the failed5081 run remains archived. Parent review/merge owns the handoff; BR1954 is not started.

### 2026-11-09 (IST) — BR1953 R08/Q-2448: prevent removal-metadata false positives
- A real pre-push check reproduced a new sibling: `rm src/StarRating.tsx` and an edit repairing that existing file were refused even though they introduce no ratings. Target identity/old code had been mistaken for new implementation. Target metadata now remains metadata; widget/setter detection requires code shape rather than a bare old name. Actual rating declarations, setter calls, JSX, affirmative addition intent and compound writers remain refused. No blanket deletion/read exemption and no new shell parser.
- Three new selected cases failed before the fix, including actual edit/bash dispatch. Final tests are also run against isolated ff3590b61 for independent reversion. The ff359 pre-push gate was deliberately interrupted for this proven defect, archived and never called green; stopped only its own local CI process tree, not a VM or another actor's job.
- Current ledger20 =12 report/inspection +8 review:18 branch-fixed pending review/merge,1 already merged (#4123),1 historical attribution blocker. Buckets0 self-heal,0 workaround,5 skipped,13 broken,2 struggle. Nine prevention classes. Prior blockers/debt, including Q-2371, unchanged. Final complete workflow is still required on the new clean committed head.

### 2026-11-09 (IST) — BR1953 R08 valid final proof, no harness-error credit
- The first draft of the two new runner fixtures used a nonexistent helper member; those two harness errors are NOT reversion proof. Corrected fixtures await the helper's actual result promise. With the final tests and only old ff3590b61 production, all3 selected cases now fail on real refusal/empty-dispatch assertions, no missing API:0 pass,73 filtered.
- Fixed adjacent matrix:9 files/292 tests passed; strict server typecheck passed. Target/path/symbol metadata remains distinct from actual new code; direct rating declarations, setter calls, JSX and compound writers retain refusal controls. Complete final-head workflow remains pending; nothing pushed yet.

### 2026-11-09 (IST) — BR1953 R07 whole-caller census and second full-gate findings
- Full coverage on50ef0254b8d260273ac4e70fca31c28fd1f3941d:2 failed/48946 passed/95 skipped;3235 suites,2 failed. The two remaining old three-argument source tokens were in brCa99778eAutopsy and theThemeSwitchThatDidNotSwitch. Updated both to the exact actual fourth admission-ownership argument. Runtime custom/Hindi-priority and all simple-template theme-control assertions are unchanged; no weakening to force green.
- Whole-repository goldenBuildPrompt/KEEP_THE_SWITCH census found all six test consumers, including the already updated accepted-write ordering guard and isolated producer. R07 owns these same-class validation siblings; ledger remains20, not inflated by each failing assertion. All pre-gates and six private demo-emulator drills passed on50ef, but are NOT reused as final-head proof. Full50ef raw logs archived; no push/PR until a new complete gate passes.

### 2026-11-09 (IST) — BR1953 #4125 code-head full gate PASS; final metadata gate next
- Independent read-only review PASS on aeb95f14ef9b0991fe2d179a247511c9048c0088; no reviewer edits. Normal fresh-main integration remains8d897a9fa8123533f837b8aba43af7c04f8ad96f, preserving1951/1952/chat4117. All current ci.yml-equivalent required commands passed on exact clean aeb:3235 suites,48948 tests passed/95existing skips/0failed, and all6 checksum-locked private demo-emulator drills. Archived this complete proof separately; no earlier failed/interrupted run promoted.
- Opened exactly one PR #4125 from the normally pushed feature branch, title carries actual number/original aeb SHA. All19 current open queue rows now owned by #4125 (18 branch prevention rows pending merge +1 historical attribution blocker).20 total ledger items includes1 prior merged fix.18 does NOT mean18 historical failures:10 report/inspection rows plus8 review-only safeguards.
- This commit changes only docs/queue/progress labels. Full current workflow gate will run again on its exact clean head before push/handoff. Hosted-CI status/billing must be observed for the final head separately; no hosted rerun, merge, deployment, paid replay or1954.


## BR1954 — stopped runner forensic audit and first-pass contract/API prevention (2026-11-09 IST)

Full127-issue/21-model/3-command all-outcomes report read. USER_STOPPED is respected; no replay/production repair/deploy/provider calls/remote-autopsy write. Detailed25-row ledger and ordered127-receipt coverage: `docs/build-report-autopsy-BR1954.md`:15report/inspection prevention rows,6review/validation-only safeguards,2merged prior fixes,2historical source/old-app verification blockers. Four upstream classes: actual source-derived public APIs; scope/API handoff independent of fresh seeding; Hindi/English runner actions/currencies/5-character contract with honest unverified static evidence; byte-identical kit colour ownership without suppressing user edits/a11y/spacing/fonts. Synthetic producer-path/member/option proof is explicitly limited to KIT consumer contracts; no historical app reconstruction. Existing34user-owned files never reset.

Initial focused8suites134tests pass. Full exact-head gates and isolated reversion are required and recorded separately at final handoff; this entry does not prematurely claim finalCIgreen or merged status. Source snapshots are saved/acknowledged, NOT fresh sandbox reads. Queue Q2311 is claimed only for the implemented palette class; new Q2449..2470 retain precise branch/blocked status. Parent-confirmed BR1953 PR4125 merge7c9ddd889 closes only18prevention rows Q2429–2437/Q2440–2448 with matching CLOSED append; Q2439 historical final source remains. Carry Q2371 real DOM-gameplay evaluator engineering debt and all prior1951/52 blockers, preserve merged chat4117/1952 admission-language/1953 scope-exam controls. No user-facing capability is added, so no unsupported AppKnowledgeBase gameplay claim. Parent independent review/merge; next1955 ONLY after confirmation.

BR1954 final-validation correction: candidate36e730436 exposed3existing guard failures, so its incomplete coverage is NOT a pass. Preserved red evidence, stopped only owned validation process group, then repaired mixed-language boundary ranges without weakening the census, the stale seeded-handoff caller assertion without removing authorship/order controls, and the truthful blocked-row fields’ required bold labels. Added R03–R05/Q2467–2469 as review/validation-only rows. All final CI-equivalent gates rerun on the resulting integrated exact head; earlier6emulator PASS belongs only to old candidate.

BR1954 R06/Q2470: full f0cccb1b8 coverage completed48988pass/1fail/95skip; the actual gameKitHistory CLI bundled the now-transitive Node-aware CJS compiler API into ESM and threw Dynamic require fs before producing history. Changed only its temporary generator bundle to real CJS/createRequire, preserving additive hashes and at-revision source resolution; canonical real CLI proof and isolated runtime reversion required. This is a validation/tooling sibling, not an invented historical app failure. All final gates rerun after the fix.


## 2026-11-09 04:33 IST — BR1955 sequential autopsy (branch, not merged)

Parent-confirmed predecessor4126 merge48acd1f closes ONLY21prevention/safeguard rows; Q2455/Q2464 and all prior debt including Q2371 persist. Full ledger: docs/build-report-autopsy-BR1955.md. All182issues/21calls/7commands/full summary/45manifest hashes reviewed; success is not playability. Remote failure-autopsy metadata not retained; no write claim.

28rows: 15fixed-in-branch prevention/safeguards across6classes; 3already-fixed/guarded; 10artifact/policy blockers. These are not28historical failures. F1actual action vocabulary; F2proof-specific claim/readiness/automatic narration/production receipts; F3AST datastore receiver; F4measured/cancellation-safe opt-in replay plus final proof agreement; F5first solo-plan withdraw; F6compiler-owned incremental reuse with real verification retained. Current canceled/old-app replay and paid activation forbidden.

Open historical roots: D03–05unplayable controls/touch/stalled car; D11/D13/D16dependency/advisory/manifest receipts; D12unused imports, D18functional test and D21privacy detail require exact app/evaluation artifacts, not guesses. D19Phase3activation is a separate platform-cost/release policy decision. All four What/Why/Needs/Tried fields are in queue/ledger. Missing source is NOT used to block implemented synthetic prevention. Remaining DOM evaluator Q2371 is real engineering debt. No blanket cached-compile success or install skip was added; real compiler still checks edits.

Final immutable latest-main integrated head fullCI-equivalent/6emulator/reversion proofs pending when this entry is authored; exact results are bound in the final external manifest/PR handoff, not fabricated here. Parent review/merge only; noBR1956until confirmed. Boundary2105unchanged.


## BR1956 forensic audit and prevention — 2026-11-09T05:19:27.224407+05:30 IST

BR1956 only, outcome succeeded, full234issues/45model records/8commands/13manifest hashes; ledger `docs/build-report-autopsy-BR1956.md`. 24 prevention rows (16report-derived,2inspection,6review) in six classes; 6 already fixed/guarded; 5 blocked old attribution/proof rows. NOT35 historical failures. F1shared inspection session/blank honesty;F2semantic finder+error flags;F3lexically source-owned SPA doors+owned-submit attribution;F4measured persistence/functionality claims;F5safe literal-placeholder upstream admission across all authored lanes;F6actual user-DB write refusal. No old-app repair/replay claim.

Only15 confirmed-merged BR1955 prevention rows close with CLOSED IDs in this commit; its10blockers remain under merged#4127. Prior Q2371 DOM-gameplay evaluator remains real engineering debt; Q2439/Q2455/Q2464 and all earlier blockers stay open. Historical blank-tab origin, exact missing-label tag, old app functional E2E/review behavior and prior feature-authority inputs are BLOCKED with what/why/needs/tried in the ledger. Synthetic prevention is implemented despite absent historical source, not excused by it. No stopped-app resume, provider-paid replay, deploy/config/funding/quota/pricing/credentials changes or remote autopsy write.

Parent owns independent review+merge. Source final exact-head gate evidence and hosted billing annotations are recorded in the PR and hashed local manifest, never mislabeled hosted green. Do not start1957 before parent confirms merge; frozen boundary2105.


BR1956 final-gate correction: first full coverage candidate ff455fb85 failed the console-lane census after transport centralization. Stopped only its owned known-red tree (actual143), retained complete logs; strengthened direct-owner +helper-consumer +emitted-script/console-owner census without removing any original guard. Add review-only R07/Q2531. Correct tally now36 rows:25 prevention pending (16report/2inspection/7review),6already,5blocked. All final gates will rerun on corrected integrated head; no hosted-green claim.


### BR1956 unpublished validation correction — 2026-11-09T05:40:07.302893+05:30 IST
- The second draft b8a3cc965 full coverage correctly exposed a genuine regression introduced by this audit: a new pre-write yield check dropped completed fast-lane files and violated BR1952 once-only handoff ownership. Removed that check; settled owned writes still precede steering delivery, existing Stop/deadline/write fences remain. R05 now states the actual ownership contract, not the incorrect zero-write draft expectation. All prior BR1952 assertions are unchanged.
- Normalization first checks for repairable fields before any sandbox source read; preserve React-value-import ordering and starter-page prompt isolation. Existing electrical/config caller guards pass unchanged. Blocked rows now carry the same measured four fields under required bold labels; queue invariant unchanged.
- Focused six-suite reproduction after correction:172 tests PASS, including all18 real PGlite tests unchanged. The earlier full-run PGlite timeout is retained as an observed failure, not attributed to external infrastructure without evidence. Both interrupted full attempts remain red/incomplete; full CI still must pass on the final integrated head. No PR published and no merge/replay/deploy performed.


## BR1957 — admission/seed-evidence/domain-template first-pass prevention (owner t307u, not merged)
Full ledger docs/build-report-autopsy-BR1957.md; all60issues(header59),13calls(5complete8legitimateStop),4hashes, existing remoteautopsy revision0/not_started unchanged.32rows:23pending prevention/safeguards(5report8inspection10review),4already,5blocked;7classes. Historical buckets0selfheal/2workaround/0skip/6broken-result/2struggle; no cancelledapp or imaginary historical math failure counted.
F1build-local direct/tool shared admission closes BR1952directsetup/seed bypass; F2unknowninventory neverauthorizes golden/game overwrite; F3candidate/seed/delivery claims and unresolvedseed honest; F4noUIadvisoryNOTSCORED; F5sharedgenerator Meeus18term lunar correction independently reference-tested in Panchang/Kundali; F6strictdate/time/boundedposition with visible invalidinput/no-save; F7browser-proven sharedSelect exactaccessiblelabel (options unchanged). No new UIfeature/setting, no AppKnowledgeBase expansion needed. All chat/routing/scope/steering/stop/data-write guards preserved.
OPEN: external providercapacity20 not repaired by boundingprobes; historical4saved-vs1durable receipt reconciliation remains PR4109engineeringownership, not external-only; exact partialapp source/functionality unverified afterStop; cappedCity/themehooks not repaired and general schema-aware generated-state enforcement remains engineeringdebt, not historicalabsence magically closing it. Current controlledseed has safe city/theme storage, separately proven. Q2371DOM-gameplay evaluator remains real engineeringdebt; all earlier blockers retained. Only25confirmedmerged BR1956pending rows close; its5blockers remain under#4128merge69679e620.
No production replay/stoppedappresume/paidcall/deploy/env/config/quota/funding/pricing/credentials/remoteautopsywrite. Parent independentreview+merge; no1958. Final exacthead gates/proofmanifest are required, not preclaimed by this authored checkpoint.

BR1957 R09/Q2562: full production-reader census additionally binds post-repair verdict equality to observeddesign scope, preventing stale equal100scores when UI appears/disappears. Both directions and tool summary are covered. Owned oldhead91d0 coverage stopped before editing; actualpipeline1/partialNOTGREEN archived. Revised finalhead must rerun all gates; no concurrent jobs/codeedits underneath and no hostedrerun.

BR1957 R10/Q2563: completed first fullcoverage2164a69ff was2failed/49161passed/95skips (NOTGREEN): current seed forms missinghistory and stale sourceassertion. Official generator appends3hashes only; allpriorhashes retained. Existing seed guard strengthened withknowninventory+BOTH old ownershipconditions; legacy17tests kept. No runtime production-code change; finalexacthead mustrerun fullCI/10behaviorcontrols/6serialemulators.


## BR1957 independent-review correction — D13/D14 feasible prevention, same PR4129 (not merged)
The prior blanket generated-schema engineering deferral was too broad: capped historical files do not block synthetic-testable source-pattern prevention. F8/Q2564/Q2565 now add one read-only symbol-bound checker shared by all existing write-time quality notes and unresolved hook-only build warnings. Exact retained L04/L05 capped previews plus aliases/casts/truthy/try/enum bypasses and guarded positive controls are fixtures. No code/data rewriting, universal schema inference, new paid calls or Stop/lane/publication changes. Existing safe templates/controls retained.
Current ledger34rows:25implemented prevention/safeguards awaiting merge (7report/preview,8inspection,10review),4already,5blocked. D13/Q2544 and D14/Q2545 now block ONLY historical exact-hook/app attribution, not this feasible prevention. Scope is local initializer dataflow into React state or data-theme; explicit predicate/decoder correctness and arbitrary interprocedural/reassignment schema proof are not claimed. Q2371 real DOM-gameplay debt and PR4109 uncertain Stop/receipt ownership remain; all older blockers retained. Historical buckets unchanged0/2/0/6/2; two prevention rows are not two extra historical failures. Only25previously confirmed merged BR1956 rows closed.
Final new-head full actual ci.yml-equivalent, all6serialprivateemulators, generated-app browser and meaningful F8+prior behavioral reversion proofs are REQUIRED/PENDING; earlier dd7b3ba8c proof archived unchanged in /workspace/br-autopsy-1957/reviewed-dd7b3ba8c. Parent independentreview+merge only; no1958/replay/production/remote-autopsy write.

BR1957 F8 self-review correction: actual existing warning census failed1/34 on initial bfe78bbb4, so ONLY that owned obsolete full validator was stopped143 (coverage interrupted, NOTGREEN) before editing. New app advisory is explicitly declared without a generic inferred-schema fix offer and cannot fabricate rootCause on success/Stop; real errors remain blockers. R11/Q2566 is a review-only safeguard, not another historical defect. Current35ledgerrows=26pending(7report/preview8inspection11review),4already5blocked;45F8+79prior=124new focusedtests. Two additional classification/root-cause behavioral removal controls bring final requirement to15. Fresh final fullCI+6serialemulators/browser rerun required on correctedhead. Logs preserved attempt-bfe78bbb4-classification; prior dd7proof remains immutable.


## 2026-11-09 — BR1958 failed GTA request, starter/milestone/evidence boundaries
Owner t307u sequential audit, BR1958 ONLY. [Full34-row autopsy](docs/build-report-autopsy-BR1958.md), [all94issues/11problems/6calls/39hashes and ledger](docs/build-report-autopsy-BR1958-evidence.json). Historical24rows:1self-heal(access only),3workarounds,5skips,14broken/imperfect,1struggle; plus1inspection defect and9review-only safeguards.12classes implemented across28pending rows;2already fixed;4BLOCKED with allfourfields, not closed. Missing starter/manifest under recovered game seed; full-goal3D vs activecanvas milestone; destructive package-error component repair; stale sandbox-unavailable; erased-interface/seed authorship; source vsruntime recap/ETA/readiness; ineligible optional review; admission timing window and fail-open compiler honesty. Prior BR1957 PR4129 merged80990c550: close ONLY26pending rows Q-2532, Q-2533, Q-2535, Q-2538, Q-2539, Q-2546, Q-2547, Q-2548, Q-2549, Q-2550, Q-2551, Q-2552, Q-2553, Q-2554, Q-2555, Q-2556, Q-2557, Q-2558, Q-2559, Q-2560, Q-2561, Q-2562, Q-2563, Q-2564, Q-2565, Q-2566 and append same closed register. Keep its5blockers and Q2371/PR4109/allprior debt. No source replay/deploy/production configuration/remote autopsy write; server record revision0/not_started/null unchanged. Focused683/683;16behavioral removal/mutation controls restored67/67; final exact-head CI+6private serialemulators and proofmanifest authoritative under `/workspace/br-autopsy-1958/`; parent review/merge required. NextBR1959 paused.

BR1958 validation checkpoint: whole e7dc91fd1 coverage finished12failed/49264passed/95skipped (3242files), never counted green. Twelve individually audited legacy caller assertions strengthened to exact new argument/evidence contracts; new ACK-only starter capture writer rederived35to36 under unchanged source-preservation guards (R02). Archive attempt-1-e7dc91fd1 retained; finalhead full-gates rerun required. Five BR1957 blocked-row owners now explicitly reference merged4129/80990c550, without closing any blocker.

BR1958 caller-contract refinement validated1200/1200 in26files; all16behavioral mutations rerun, restored67/67. Six extra coverage skips before fresh build are5CSS+1JS artifact cases; explicit post-build cssLegacy check added to the external local proof recipe (no CI-policy/threshold edit). Final source/gates/manifest to bind exact branch head.
## Daily answer badge stuck at 49/50 — 2026-11-09
The signed-in ledger already charges one successful logical answer once (50/day shared with professionals, guest 10, pass and free-list unlimited, replay/refund unchanged). The compact badge reads that server count. A completion while `document.visibilityState` was hidden was dropped, so the badge could stay on the first in-flight reading, 49/50, after later answers were already counted. Completion and invalidation now refetch even while hidden; the 15-second poll still does not. Route proof: 25 unique successes leave 25, the same request id does not charge again, the 50th is allowed, the 51st is denied, and a provider fallback charges once. Not a live ordinary-user check.

## Chat answer quality — 2026-11-09
FreeChain's last-6 trim dropped opening user facts before the recent window, including on the provider that answers after a fallback. The same turn budget now keeps those opening user turns. The compact prompt tells the model to answer the latest message, match Devanagari / Roman Hinglish / English, and state only the configured creator facts (Dr Asheesh and his team, Budaun, Uttar Pradesh) without an invented biography. Ordinary words such as history, plan, pro, mode, and error no longer pull the app manual into the prompt. Quotas are unchanged. Not a live signed-in check.

## 2026-11-09 — BR1958 current-main integration, I02/Q2601
Independentreview passed1e625c05e; parent API dirty not reproduced by actual cleanmerge-tree/currentmain5fc61f1 and ordinarymergeb5596c0d (4130previewCSS/4131dailybadge). No manualconflict resolution. Actual newhead prerequisite frontend gate exposed4TS2769errors in incomingmain's DOM Event callback/boolean permission interface; real-hook hiddenEvent red expected1fetch/got3. F13 stable zero-argument focus/visibility callback with identical cleanup preserves explicit hidden settlement/invalidation refresh(true), timerpolling, quota/routing/servercounts and all12reviewed BR classes. I02 is an integration inspection item, not historicalBR1958failure; ledger35=29pending(18report2inspection9review),2priorfixed4blocked. AddonlyQ2601; keepallpriorowners/debt/Q2371/PR4109 and26priorclosedIDs unchanged. Earliergreen belongs1e625only; fullnewheadactualCI+6serialprivateemulators/mutations required, parentreview+merge, noBR1959.

## 2026-11-09 — BR1959 autopsy (school management app, succeeded): fast-lane hand-off classes
Owner t307u sequential audit, BR1959 only (boundary 1951..2105 frozen). This was a successful build. The fast lane was handed to the full builder at 379 s because of three things a deterministic pass could have fixed, and it shipped a phone-overflowing kit header and log-only create forms. Ledger: [docs/build-report-autopsy-BR1959.md](docs/build-report-autopsy-BR1959.md), plus [evidence for all 413 issues, 87 calls, 19 commands and 41 hashes](docs/build-report-autopsy-BR1959-evidence.json).
- **F1.** Before `tsc`, the fast lane now adds undeclared packages to package.json at their pinned range and installs them. The preview's reconcile now reads the disk manifest.
- **F2.** `import type` for contract types that are used but never imported.
- **F3.** A nested wrapper that shadows its import and calls itself is re-pointed at an aliased import. This runs before the endgame's unused-import removal. A prompt rule forbids the shape.
- **F4.** The kit's `.nb-header-actions` and `.nb-chips` may shrink; seed history is regenerated.
- **F5.** The authenticity scan reports every log-only handler, including inline `}}` ones.
- **F6.** Journey routes see a page wrapped in a route guard.

Queue: Q-2602…Q-2611 (seven implemented, three 🟡 blocked: log-only-form outcome, react-router ^6 pin, summary-claim corrections). This commit also closes the 29 BR1958 rows resolved by #4132. Its four blockers, Q-2371 and the PR4109 row stay open. The historical app is not claimed repaired.
- 2026-11-09 BR1959 follow-up: exact-head test:coverage on f79856f5c failed 2 censuses (writtenFiles count, unclassified FASTLANE_DEPS_RECONCILED); fixed: one audited writer site (census 37) + PROCESS_ONLY_CODES entry. No reruns used to pass.
- 2026-11-09 BR1959 side-effect review (owner rule): F1 narrowed (disk manifest never credited as written), F2 narrowed (project-ambient types need TS2304 proof), F5 narrowed (confidence charged once per file); F3/F4/F6 kept with neighbour locks; +23 neighbour tests, mutation controls 16.

## 2026-11-09 — BR1960 autopsy (YouTube SEO generator, succeeded): a tool for a product is not a clone
Owner t307u sequential audit, BR1960 only (boundary 1951..2105 frozen). A one-screen SEO tag generator was scoped "LARGE — clone of YouTube", which cost an 8.8 s roadmap call and a "big app" message. Two admin diagnostics were also untrue. Ledger: [autopsy](docs/build-report-autopsy-BR1960.md), [evidence](docs/build-report-autopsy-BR1960-evidence.json).
- **F1.** A famous name followed by a tool noun is what the tool works on; a likeness word still wins. Over 78,007 strings, one decision changed (this prompt).
- **F2.** A client `src/services|api|models` layer is not a backend without a server signal. The CSP scan is pinned to the old reading (t311u).
- **F3.** The click explorer records the controls it drops silently; "all deliberately skipped" is said only when true.

Queue: Q-2612…Q-2617 (three implemented, three 🟡 blocked: html-code intent, compute journey, CSP on client-layer SPAs). This commit closes the seven BR1959 rows resolved by #4134. Q-2608/2610/2611, the BR1958 blockers, Q-2371 and the PR4109 row stay open.

## 2026-11-10 — BR1961 autopsy (YouTube-like follow-up, succeeded): Hindi "ki tarah" is a likeness; a busy sandbox is not a goodbye
Owner t307u sequential audit, BR1961 only (boundary 1951..2105 frozen). A follow-up on "Mujhe youtube ki tarah ek app Banakar do" was scoped as an ordinary one-shot because "ki tarah" was not treated as "like", and the user was told to retry while the build continued after an E2B cap. Ledger: [autopsy](docs/build-report-autopsy-BR1961.md), [evidence](docs/build-report-autopsy-BR1961-evidence.json).
- **F1.** Hindi "X ki/ke/ka tarah" immediately after a famous name is a likeness word. Over 78,007 strings, no decision changed.
- **F2.** sandboxUnavailableNotice says we are still trying and that the user does not need to start again (a second Start would consume another sandbox slot). The fast-lane skip after setup failure was already #4124.

Queue: Q-2618…Q-2622 (two implemented, three 🟡 blocked: exclusive-access phrasing, E2B cap of 20, paragraph-subject widening). This commit closes the three BR1960 rows resolved by #4135. Q-2615/2616/2617, Q-2608/2610/2611, the BR1958 blockers, Q-2371 and the PR4109 row stay open.

## 2026-11-10 — BR1962 autopsy (NOVA AI real-AI edit, user-stopped): a quality checklist is not ten features; "tarah-tarah" is various kinds
Owner t307u sequential audit, BR1962 only (boundary 1951..2105 frozen). A 12.5 s user-stopped edit of an existing NOVA AI app was scoped LARGE for "~10 distinct features" because a nine-item Requirements checklist was counted line-by-line; the user stop itself was honored and not charged. Reviewer residual on #4146: Hindi "ke/ka tarah-tarah" (various kinds) was not neighbour-locked. Ledger: [autopsy](docs/build-report-autopsy-BR1962.md), [evidence](docs/build-report-autopsy-BR1962-evidence.json).
- **F1.** "X ke/ka tarah-tarah" / "X ke tarah tarah" is not a likeness word. Standalone subject mentions still clone (6452c0a9).
- **F2.** Numbered lines count unless the whole line is a tight anchored quality/acceptance constraint (no product-noun list). Reviewer examples (Responsive POS screen for tablets / Hinglish twin / Keep existing order history after migration) stay features. Adversarial corpus 120: 0 LARGE→smaller vs main. BR1962 is not LARGE.

Queue: Q-2623 and Q-2624 (both implemented). This commit closes the two BR1961 rows resolved by #4146. Q-2620/2621/2622, Q-2615/2616/2617, Q-2608/2610/2611, the BR1958 blockers, Q-2371 and the PR4109 row stay open.

## 2026-11-10 — BR1963 autopsy (India-map game, succeeded): lock the recovered-starter / no-retry gates; queue #4148 residuals
Owner t311u sequential audit, BR1963 only (boundary 1951..2105 frozen). "Build a game with indian map" succeeded in 12.2 min after an E2B cap-20 unavailable that recovered into a workspace with only `src/` (no React starter). The kit on disk lacked events.ts; the builder abandoned it. Those preventable gaps were already fixed by #4132 (the next day) and #4146. This commit neighbour-locks them against this prompt and does not change a production heuristic. Ledger: [autopsy](docs/build-report-autopsy-BR1963.md), [evidence](docs/build-report-autopsy-BR1963-evidence.json).
- **F1.** Neighbour locks only: this prompt stays a 2D kit whose runtime includes events.ts even if `include` is `['meta']`; scope stays ordinary/direct; a manifest-less recovered workspace still cannot seed recipes; the unavailable notice no longer invites a retry.

Queue: Q-2625…Q-2629 (#4148 residuals, queued not fixed). This commit closes the two BR1962 rows resolved by #4148 (Q-2623, Q-2624). Q-2620/2621/2622, Q-2615/2616/2617, Q-2608/2610/2611, the BR1958 blockers, Q-2371 and the PR4109 row stay open.

## 2026-11-10 — Qubax market-only selection (t382u / t383u)
The price feed never published because OpenAI and Z.ai pages arrived with a CDN Age of hours, and the collector required all three sources. The Qubax market file itself parsed. Publication now needs only that fetch. A model is eligible when Qubax `discount_pct` is at least 90, the row is text or multimodal, and one try fits the $0.02 cap. Ranking is the Hindi/English probe, then the cheaper price. A model with no requests in 24 hours waits for a passing probe. A wrong-script reply, a timeout, an empty feed, or three failed tries falls through to the next chat provider with the same history. Each try waits 8 seconds for the first byte and 12 seconds overall. Admin Test Chat refresh collects the market. Official price pages are not fetched.
## 2026-11-10 — BR1964 autopsy (exam-analyse app, failed at 25-min cap): ship Q-2626 Handling gerund; lock ordinary scope
Owner t311u sequential audit, BR1964 only (boundary 1951..2105 frozen). "Mujhe higher exam hard exam analyse app banana hai" failed after the free 25-minute cap. A preview had been IN_BUILD_GREEN since minute 14; STYLE_RULES_RESUMED then handed 30 missing classes plus an a11y item back with about 80 s left. Scope was correctly ordinary/direct. Ledger: [autopsy](docs/build-report-autopsy-BR1964.md), [evidence](docs/build-report-autopsy-BR1964-evidence.json).
- **F1.** Neighbour locks only: this short exam-analyse ask stays ordinary/direct; the RC-4 deadline-pause sentence for 37 files still matches this report.
- **F2.** Q-2626: whole-line `Handl(?:es?|ing) errors` (optional properly/gracefully/correctly, optional period). Opposite-class corpus of 360 eight-item lists (56 real "Handling …" product features, EN/HI/Hinglish), built before the edit: 0 LARGE→smaller vs main.

Queue: this commit closes Q-2626. New rows Q-2630 (late style hand-back), Q-2631 (25-min cap after a green preview), Q-2632 (sibling loading/timeouts gerund). Q-2625/2627/2628/2629 and earlier blockers stay open.

## 2026-11-10 — BR1965 autopsy (NOVA AI Fix-with-AI continue, succeeded): ship Q-2632 loading/timeouts gerund; lock continue scope
Owner t311u sequential audit, BR1965 only (boundary 1951..2105 frozen). The platform "Fix with AI" sentence "Continue from where you left off and finish/fix the build so the app works end-to-end." succeeded in 8.8 min on an existing NOVA AI assistant (mock aiService replaced with window.NavAI.ask). Scope was correctly ordinary/direct; PROJECT_MODE created no new plan. Ledger: [autopsy](docs/build-report-autopsy-BR1965.md), [evidence](docs/build-report-autopsy-BR1965-evidence.json).
- **F1.** Neighbour locks only: this platform continue sentence stays ordinary/direct and remains `CONTINUE_AND_FIX_BUILD_PROMPT`.
- **F2.** Q-2632: whole-line `Handl(?:es?|ing) loading, timeout(s) and (API) errors` (optional properly/gracefully/correctly, optional period). Opposite-class corpus of 360 eight-item lists (56 real Handling-loading / Handling-timeout product features, EN/HI/Hinglish), built before the edit: 0 LARGE→smaller vs main.

Queue: this commit closes Q-2632. New row Q-2633 (unpinned `@types/react` / `typescript` installs on a React 18 app). Q-2625/2627/2628/2629/2630/2631 and earlier blockers stay open.

## 2026-11-10 — BR1966 autopsy (GTA5-style game, succeeded): glued gta5 is the same title as "gta 5"
Owner t311u sequential audit, BR1966 only (boundary 1951..2105 frozen). "Pura gta5 wala game banaa do" succeeded in 10.55 min as an ordinary one-shot with a 2D DOM kit ("3D assets not prepared") because `\bgta\b` does not match concatenated "gta5". The spaced twin and the BR1955 fixture already cloned GTA and seeded the 3D kit. Ledger: [autopsy](docs/build-report-autopsy-BR1966.md), [evidence](docs/build-report-autopsy-BR1966-evidence.json).
- **F1.** Neighbour locks: this prompt is a GTA clone and wants the 3D/real kit; it matches the spaced twin; India-map stays 2D/direct; `gta50` / `gta5cheats` stay unmatched; companion "using GTA5" follows "using GTA"; the existing claim-audit detector still flags this report's "ready to play" / "fully playable" sentences.
- **F2.** Glued GTA titles `gta(?:\s*[-_]?\s*[5v])?` in APP_SCOPE, `DRAWN_IN_3D` and `realismIntent`. Opposite-class corpus of 167 prompts, built before the edit: 0 field changes (0 smaller→LARGE, 0 newly famousApp=GTA, 0 newly wants3D, 0 lite→real).

Queue: this commit closes no earlier row. New rows Q-2634 (canvas-less DOM playtest) and Q-2635 (long-name "grand theft auto" still 2D/lite). Q-2633 and earlier blockers stay open. Q-2375 is not re-opened.

## 2026-11-10 — BR1967 autopsy (AI anime video generator, succeeded): stays LARGE; Process-Story journey queued
Owner t311u sequential audit, BR1967 only (boundary 1951..2105 frozen). "Upgrade my AI Anime Video Generator…" succeeded in 3.32 min as LARGE (~12 features) with a 6-step mega-roadmap, then the fast lane shipped milestone 1 as a 7-file simple success (designed: Q-975). Explorer pressed "कहानी संसाधित करें" (nothing visibly changed); RELEASE_GATE YELLOW because Process/संसाधित is not a submit word. Ledger: [autopsy](docs/build-report-autopsy-BR1967.md), [evidence](docs/build-report-autopsy-BR1967-evidence.json).
- **F1.** Neighbour locks: this prompt stays LARGE (~12 distinct features); a video/anime generator is not `fastLaneSkipsImageApp`; "कहानी संसाधित करें" / "Process Story" / "Generate" / "Calculate" still do not match CREATE_WORDS; Save/Add still do.
- **F2.** Not shipped. Expanding submit words, skipping the fast lane for mega-roadmap or video apps, tightening the unsized ETA band, or rewriting the simple-lane success summary each failed t311u or needs a product/copy decision.

Queue: this commit closes no earlier row. New rows Q-2636 (Process-Story journey), Q-2637 (ETA under-band), Q-2638 (thin milestone summary). Q-2633/2634/2635 and earlier blockers stay open. Q-2616 is the English Generate sibling and is not rewritten.

## 2026-11-10 — BR1968 autopsy (supermarket-simulator game, succeeded): lock ordinary 2D DOM path; queue famous-title 3D
Owner t311u sequential audit, BR1968 only (boundary 1951..2105 frozen). "Make a game game was type of super market simulator make a game" succeeded in 12.84 min as an ordinary one-shot with a 2D kit ("3D assets not prepared") and a DOM supermarket UI. Explorer pressed "Start Game" (it responded); RELEASE_GATE YELLOW for design consistency 94/100 (15 colours) and no form journey. Historical silence (no GAME_PLAYTEST_NOT_RUN / CLAIM_UNSUPPORTED) is already closed by BR1951 (#4123) and BR1956 (#4128), both the next day. Ledger: [autopsy](docs/build-report-autopsy-BR1968.md), [evidence](docs/build-report-autopsy-BR1968-evidence.json).
- **F1.** Neighbour locks: this prompt stays ordinary/direct and not famous; domain game skips the fast lane; 2D kit / genre simulator / dimension unspecified / realism lite; a DOM supermarket with Start Game is an unplayed `action` game (disclosed, not silent); the exact "ready to play" / "fully functional" recap is contradicted when those measurements are passed in; supermarket billing/inventory stay non-games; gta5 and an explicit 3D train simulator still want 3D.
- **F2.** Not shipped. Escalating supermarket-simulator to a famous 3D clone, or widening canvas playtest to DOM controls, each failed t311u or is already queued (Q-2634).

Queue: this commit closes no earlier row. New row Q-2639 (famous 3D supermarket-simulator title still 2D/lite). Q-2633–Q-2638 and earlier blockers stay open.

## 2026-11-10 — BR1969 autopsy (Hinglish bike-race app, succeeded): lock non-game reading; queue vehicle+race domain and badge overflow
Owner t311u sequential audit, BR1969 only (boundary 1951..2105 frozen). "Mujhe ak bike race app bana kar dedo" succeeded in 7.44 min as an ordinary unsized app (ETA key app_unsized). The fast lane failed typecheck (BikePosition/BikeColor), salvaged a DOM 6-bike progress-bar race, and never seeded the 3D kit because domain game and SCENE_WORDS both require game/khel/3d. Explorer pressed "दौड़ शुरू करें" and "रीसेट"; RELEASE_GATE YELLOW for 42px "made by NavBharatAI" overflow. User stopped after delivery and was charged ₹1.35 (designed). Ledger: [autopsy](docs/build-report-autopsy-BR1969.md), [evidence](docs/build-report-autopsy-BR1969-evidence.json).
- **F1.** Neighbour locks: this prompt stays general/direct (not domain=game), empty kit, wants3D false, genre racing; adding "game" or Hindi "khel" already seeds the 3D race kit; event/info and bike-the-vehicle neighbours stay non-games; titled games (gta5, supermarket-simulator prompt, India-map) keep their kits; this recap is game-claimed-playable + functionality-unverified when playtest/journey are not-run, and "works on all device sizes" is not size-contradicted (Q-2611).
- **F2.** Not shipped. Treating vehicle+race as domain=game and giving it the 3D kit needs two coordinated classifier gates; event/info phrases must not escalate. Badge CSS change would affect every signed app.

Queue: this commit closes no earlier row. New rows Q-2640 (vehicle+race without the word game) and Q-2641 (signature overflow / all-device-sizes claim). Q-2633–Q-2639 and earlier blockers stay open. Q-2611 is the English responsive-summary sibling and is not rewritten.

## 2026-11-10 — BR1970 autopsy (stopped busy-service line): lock ordinary admission; ship Q-2641 badge CSS
Owner t311u sequential audit, BR1970 only (boundary 1951..2105 frozen). "The AI service is temporarily busy. Please try again in 1-2 minutes." stopped in 9.7 s after SANDBOX_UNAVAILABLE (E2B cap of 20, Q-2621). The user stopped; nothing was written; not charged. The prompt is the platform English busy line without the emoji. Ledger: [autopsy](docs/build-report-autopsy-BR1970.md), [evidence](docs/build-report-autopsy-BR1970-evidence.json).
- **F1.** Neighbour locks: this prompt stays ordinary/direct; it is the English busy line without the emoji; a user-stop before writes is never charged.
- **F2.** Q-2641 shipped: new "made by NavBharatAI" injections stay inside a 390×844 visual viewport (reviewer CSS plus right: calc(12px + 100% - 100vw) for a transformed wider containing block). Existing version-2 apps are not rewritten. mobileLayoutCheck is not taught to ignore the badge.

Queue: this commit closes Q-2641 and opens Q-2642 (do not start a coding build when the prompt is only a known busy line). Q-2640, Q-2621, Q-2611 and earlier blockers stay open.

## 2026-11-10 — BR1971 autopsy (succeeded continue after BR1970’s busy-line stop): lock ordinary continue; carry two BR1970 ledger nits
Owner t311u sequential audit, BR1971 only (boundary 1951..2105 frozen). "Continue from where you left off and finish/fix the build so the app works end-to-end." succeeded in 5.44 min on the same workspace as BR1970, about 10 s after that user-stop. RELEASE_GATE GREEN; charged ₹1.21; ETA inside the 4.5–13.6 min band. Ledger: [autopsy](docs/build-report-autopsy-BR1971.md), [evidence](docs/build-report-autopsy-BR1971-evidence.json).
- **F1.** Neighbour locks: this prompt is the platform continue constant and stays ordinary/direct; it is not a busy-service line (Q-2642 must match the current prompt only).
- **F2.** BR1970 ledger nits carried here (no separate PR): the busy-line prompt is 68 characters, not 67; the Q-2641 label CSS is nowrap+ellipsis.

Queue: this commit closes no row and opens no row. Q-2642, Q-2640, Q-2621, Q-2611, Q-2375 / Q-1068 and earlier blockers stay open.

## 2026-11-10 — BR1972 autopsy (edu-ai examination assistant, succeeded): kit topbar shrinks on a phone
Owner t311u sequential audit, BR1972 only (boundary 1951..2105 frozen). "मुझे एक education app बनाना है app नाम है edu ai examination Assistant" (70 characters) succeeded in 22.2 min as an ordinary one-shot of an existing workspace (BUILD_ORDER_READ_AS_EDIT). Preview rendered at 711 s; explorer repaired "View Material"; RELEASE_GATE YELLOW for no proven save-reload journey plus 119 px of sideways phone scroll from `<header class="nb-topbar">` “EDU AI – EXAMINATION ASSISTANT” (508 px wide on a 390 px phone). Ledger: [autopsy](docs/build-report-autopsy-BR1972.md), [evidence](docs/build-report-autopsy-BR1972-evidence.json).
- **F1.** Neighbour locks: this prompt stays ordinary/direct and domain=general (not education, not game); "Make an education app" stays general; exam-analyse stays education; education-loan stays fintech; the recap "Fully responsive design that works on both mobile and desktop" is not SIZE_CLAIMED (Q-2611).
- **F2.** Kit `.nb-topbar` now shrinks and wraps (`flex-wrap: wrap; min-width: 0; max-width: 100%; box-sizing: border-box`). Overflow on the bar stays visible so dropdowns are not clipped. `overflow-wrap: anywhere` is not set on the container (it is inherited and shrinks min-content). `.nb-topbar h1` has `min-width: 0; overflow-wrap: break-word`. Platform seed history is add-only so every kit copy stays "ours". Existing shipped apps are not rewritten.

Queue: this commit closes no earlier row. New rows Q-2643 (edit_unsized ETA when a build-order is turned into an edit) and Q-2644 (education/examination words still domain=general). Q-2642, Q-2640, Q-2621, Q-2611, Q-2375 / Q-1068 and earlier blockers stay open. Q-2611 is not rewritten (this recap is sibling evidence).

Reviewer FAIL on PR #4162 head `38491a56b`: a non-visible overflow on `.nb-topbar` computes the other axis to `auto` and clips absolute dropdowns/popovers. Reviewer PASS on `4c29b671` flagged a residual: `overflow-wrap: anywhere` on the container is inherited and shrinks min-content, so a title beside the action buttons can break mid-word. Third commit on the same branch removes `overflow-wrap: anywhere` from `.nb-topbar`, keeps shrink/wrap/`box-sizing: border-box`, and puts `min-width: 0; overflow-wrap: break-word` on `.nb-topbar h1`. Seed history is add-only again. Existing shipped apps are still not rewritten; `mobileLayoutCheck` is still not taught to ignore user headers.
## 2026-11-10 — BR1974 autopsy (Chess Squad welcome-screen edit, succeeded): a WhatsApp number is not a request to open WhatsApp
Owner t311u sequential audit, BR1974 only (boundary 1951..2105 frozen). "FIX THE APP STARTING SCREEN AND LOGIN FLOW" for an existing Chess Squad app succeeded in 9.6 min (NOT charged). PROJECT_MODE treated it as an edit; RELEASE_GATE GREEN. NATIVE_CAPABILITY_BRIEF still fired open-apps because "Enter Your WhatsApp Mobile Number" matched a bare `whats\s*app`, so the builder installed @capacitor/app-launcher and added WhatsApp/SMS contact-support the user never asked for. Ledger: [autopsy](docs/build-report-autopsy-BR1974.md), [evidence](docs/build-report-autopsy-BR1974-evidence.json).
- **F1.** `open-apps.asks` no longer treats a WhatsApp number/id field as a request to open WhatsApp, and no longer treats "when I open the app" as opening another app. Same-class open/call phrases (including Jarwis "whatsapp khole") still match.
- **F2.** Extra #4164 review hardening: the case-study lookbehind class includes U+2013/U+2014 so "case–study app" / "case—study app" stay uncaptured.

Queue: this commit closes no earlier row. New rows Q-2647 (personal dashboard / Weak preflight scored this edit complex_app/68) and Q-2648 (bare `sms` in open-apps). Q-2646, Q-2645, Q-2644, Q-2643, Q-2642, Q-2640, Q-2621, Q-2611, Q-2375 / Q-1068 and earlier blockers stay open.
Reviewer FAIL on PR #4165 at `aba7e7655`: F1 dropped genuine "open apps like YouTube" / "please open apps" / "open the app store". Follow-up restores plural `open apps` / `open the apps` and the frozen compounds `app store` / `play store` / `app drawer`, while keeping singular "open the app" / "when the app opens" / "opening the app" / "open the app settings" (this app's settings screen) uncaptured. "open WhatsApp chat with this number" stays a must-match. Mutations lock each clause.
Owner rejected the first follow-up head `060b32b0b`: matching bare `app store` / `play store` handed `@capacitor/app-launcher` to publish-only prompts (t311u "fix A creates X"). The reviewer asked for "open the app store", not a bare store mention. Second follow-up verb-gates store (open/launch/redirect/link) and treats bare "app drawer" the same way (a navigation drawer in this app). Ordinary merge of `origin/main` `c072e0eb9` (#4166). Must-not-match: publish/upload/listing/screenshots/release and "play store pe daalna hai".
Reviewer FAIL on PR #4165 at `5fb218c75`: `launch to/on/in` the store is a publish idiom; store + listing/developer/account/console must not match; "play store kholo" / "go to the play store" must. Third follow-up: `launch` only as "launch the app store"; listing/developer/account/console/"page for my …" lookahead after the store name; post-nominal Hinglish `khol` (no bare store); `go to the play store`; `(?<!deep\s)link`. "link to play store page for my own app listing" is not captured (get-it-on / rate-us listing URL, not app-launcher).
Reviewer FAIL on PR #4165 at `e71c4bd44`: stop patching literal phrases. Fourth follow-up replaces the store/link mega-regex with clause-level `openAppsAsked` rules: a deep-link prefix test equivalent to `(?<!deep(?:ly)?[\s-]*)` (no lookbehind; multi-space, hyphen, deeplink, deeply); own-listing / publish / daal language anywhere in the same clause blocks the store alternative (our/the/this/my, of/for); store+khol stays a match unless that clause also has daal/publish/upload; `khol do` is excluded only when the clause names both a store and listing language. Generated fuzz corpora lock each rule. Conservative FNs of the clause rule (store-open + unrelated console/release/daal in the same sentence; comma not a clause boundary) are documented, not treated as bugs.
Reviewer FAIL on PR #4165 at `9d51b7ba0`: clause-wide bare tokens (submit/screenshots/release/console/publish\w*/daal\w*/listing) blocked genuine opens that origin/main captured. Fifth follow-up keeps clause-level exclusion but binds it to store-publish idioms only (submit/publish/upload to/on the store; Play/developer console; developer account; store listing / listing page / app listing; store screenshots / screenshots for the store; store release / release on the store; Hinglish daalna/daalo/daal dena/daal do after store + pe/par/me). Not bare tokens, and not "published". A regression gate snapshots origin/main `c072e0eb9` open-apps.asks and requires every genuine open it captured to still match. Same-clause open+publish-idiom: the idiom wins. No new queue rows.
Self-found publish-meaning FPs at `1956cdd90` closed before review: Hinglish particles include ko/se; publish/upload/submit karna/karo/kar do (and kar dena/kar de) after store+particle; English verbs accept tense and a few object words before to/on + store. Genuine opens ("see other apps we published", "After we release…", "submit a review", origin/main regression corpus) still match. Remaining residuals not queued: store-open + "submit karna" without a particle; "released in" (not to/on).
Reviewer FAIL at `0911ab617`: the 8-word English publish idiom plus idiom-wins dropped genuine App Store opens that origin/main captured. Seventh follow-up switches to precedence: Rule A explicit store opens (open/launch + store, or store + khol) always match except an immediate listing/developer-account/console/page-for-listing/screenshots/release tail, and except Hinglish khol + daal/publish-kar in the same short phrase. Rule B (link/redirect/go) keeps clause-level idioms and bare publish-family language at the end of the clause. The six lost repros, "released in the Play Store", and "open the play store and submit karna" match. The regression gate now runs the whole corpus through origin/main's regex and requires every hit that is not on a reviewed must-not-match list to still match. Remaining residuals not queued: "open the google play store" / "open up the App Store" (extra word between open and the store; origin/main also missed them).
Reviewer FAIL at `a9973b7cc`: Rule A's open-ended tail created Play Store false positives versus origin/main ('open the Play Store version of our game', developer page, agreement, review guidelines, data safety form, promo campaign, Connect dashboard, 'open the Play Store for my developer account'). Eighth follow-up cuts store matching to the minimum that cannot regress: origin/main `c072e0eb9` plus reviewed App Store presence tails only. Rule A/B idiom machinery is removed. Play Store / go-to / link / redirect / kholo / launch store opens are queued as Q-2649. BR1974 keeps stay: WhatsApp number/id fields including Hinglish; singular 'open the app' / 'open the app settings' unmatched; plural 'open apps' matched; 'open WhatsApp chat with this number' matched; explicit 'open the app store' and 'open the app drawer'. Two-sided corpus gate: every origin/main hit still matches except the reviewed must-not-match list; every origin/main miss still does not match except the reviewed must-match list (plural open-apps and the WhatsApp-chat phrase, which main already captured).
Reviewer FAIL at `c98a731b8`: dropping singular 'open the app' also dropped genuine named-app launches origin/main captured ('open the app Instagram', 'open the app called Spotify', 'open app Instagram', 'open the app Settings on the phone', and the rest of the review set). Ninth follow-up restores `open(?:\s+the)?\s+app` when it is followed by spaces/tabs only and then called/named + a name, or a capitalized proper-name token. Newline or punctuation after `app` breaks the match ('When I open the app\nShow the welcome screen', 'open the app. Then…'). Lowercase 'open the app settings', bare 'open the app', the WhatsApp set, and the BR1974 prompt stay unmatched. The two-sided gate includes the repros and asserts capitalized-token captures are a subset of origin/main hits.
Reviewer FAIL at `3562741e4`: capitalized-token-only recovery dropped lowercase names origin/main captured ('open the app iMessage', 'open the app eBay', 'open the app instagram' / youtube / spotify / gmail / maps, 'open app spotify'). Tenth follow-up inverts the after-app rule: keep origin/main's `open (the)? app` and exclude only on (a) end of text / punctuation / newline or (b) a reviewed denylist (to, first, settings lowercase, every, and, then, again, when, for, in, on, with, after, before, from, daily, now, once, so, it, is, will, should, screen, page, see, show, dashboard). called/named stay allowed. The two-sided gate asserts every capture is a main hit; a generated corpus covers lowercase app names and every denylist word.
Reviewer FAIL at `5b5e2f0cd`: the denylist words `from`, `with`, `for` and `it` dropped genuine opens origin/main captured ('open the app from the list of installed apps', 'with this package name' / 'with package name com.spotify.music', 'for Instagram', 'it is linked to'). Eleventh follow-up makes those four words deny only when a reviewed this-app continuation follows (`my home` / `my home screen`, `home` / `home screen`, `the home screen`, `login`). Unknown continuations, including bare `open the app from`, match like main. Clear launch-this-app denials that use other denylist words stay denied ('from my home screen', 'in a new window', 'after login', 'now'). `my` is bound to home so 'from my list of installed apps' and 'for my Instagram' still match. The two-sided gate includes the long-form repros. Mutations M19 (unconditional deny) and M20 (never deny) must turn red.
t332u read-only diagnosis of the two latest failed/stopped reports added queue rows Q-2650 (bare `src/game/...` path admitted as a new game), Q-2651 (explanation/question after a read loses OUTCOME_ASKED_USER — residual of Q-2238/#3885), and Q-2652 (project-mode game module 1 shows no preview for ~13 min, users stop). Those rows are not implemented here; they wait for BR order or later.
Reviewer FAIL at `281102b0e`: the accepted side-effect of case-insensitive home/login continuations dropped 'open the app from Home Assistant' (and 'from Login Manager', 'for Home Assistant') that origin/main captured. Twelfth follow-up makes those continuations case-sensitive lowercase, the same way `settings` is handled. Bare `home` denies only when followed by end of text, punctuation, or `screen`. 'from home', 'from my home screen', 'from the home screen', and 'from login' stay denied. The two-sided gate includes the new keeps and denials. Mutation M21 restores the `i` flag and must turn red.



## 2026-11-11 — BR1975 autopsy (Satyam Engineering Works website, succeeded with a yellow phone-layout gate)

Owner t311u sequential audit, BR1975 only (boundary 1951..2105 frozen). "Give me one one website code for name satyam engineering works" (62 characters) succeeded in 7.94 min inside the 4–10 min ETA. Domain/complexity were correct (ordinary one-shot, simple/15, no login). The fast lane refused a syntax-broken Footer (`<<`) and fell back; the full builder delivered Footer and a working site. Opened at 390×844 the page scrolled SIDEWAYS by 260 px: a bare `<header>` sat the long company name beside `<nav> "Home Services About Contact"` (296 px, reaching 650 px), and three links were 24 px tall. RELEASE_GATE YELLOW. Ledger: [autopsy](docs/build-report-autopsy-BR1975.md), [evidence](docs/build-report-autopsy-BR1975-evidence.json).
- **F1.** Reviewer FAIL on PR #4168 at `c201c6e6b`: the first head wrapped `<header>`/`<nav>` (the overflowing box is the inner nowrap `.row` / `ul.row` in the delivered Header.tsx), used non-zero `:where(header) nav` / `nav a`, set `display` on every header nav, and touched game HUDs and card headers. The follow-up wraps `:where(.nb-header .row)` and `:where(.nb-header nav ul)` only inside `@media (max-width: 640px)`, with no `display` change. Tests walk the real Header.tsx tree (old CSS and header/nav-only wrap still overflow 260 px at 390 px; new CSS does not) and lock game HUD, card header, desktop, stacked mobile-menu links, and dark `.nb-header` neighbours. 24 px link tap targets are not raised (changing `display` was unsafe). Seed history is add-only.

Queue: this commit closes no earlier row and opens no new row. Q-2649, Q-2650, Q-2651, Q-2652 and earlier blockers stay open (none of them appear in this report).

## 2026-11-11 — BR1976 autopsy (prompt "App", succeeded): a category word is not a deliverable

Owner t311u sequential audit, BR1976 only (boundary 1951..2105 frozen). "App" (3 characters / 1 word) succeeded in 1.88 min, UNDER the 4.0–9.9 min unsized-app ETA, and was charged ₹0.09. Surplus qwen3-coder invented a "Welcome to Your App" card whose "Get Started" button has no handler (explore: it responded, nothing visibly changed). `assessBuildInput('App')` was already `no-object` and would ask on a starter workspace; `buildConfirmation('App')` still confirmed the build because `PRODUCT_NOUN` matches `apps?`. When the ask gate's four conditions missed, that confirmation sent the turn to the fast lane. Ledger: [autopsy](docs/build-report-autopsy-BR1976.md), [evidence](docs/build-report-autopsy-BR1976-evidence.json).
- **F1.** `buildConfirmation` now returns `names-nothing-to-build` when `namesNoObject` is true (after the high-confidence and question branches, so `make an app` / `app banao` stay explicit-order and suggested-reply edits stay confirmed). Neighbours `calculator`, `todo app`, `shop app banao`, `build a notes app`, `continue`, and `make it real` still confirm. The knowledge base no longer tells the user to say "app"; the promise-handler census no longer locks `reachesConfirmedWork('app')`. The dead Get Started button, the under-band ETA, and `IN_BUILD_GREEN_RACED` are not shipped. BR1975 optional residuals (tap targets, 641–649 px, `nav > ul`) are not queued.

Queue: this commit closes no earlier row and opens no new row. Q-2649, Q-2650, Q-2651, Q-2652 and earlier blockers stay open (none of them appear in this report).

## 2026-11-10 — BR1973 autopsy (Maharashtra-board study app, failed at 25-min cap): a study app is not a school LMS
Owner t311u sequential audit, BR1973 only (boundary 1951..2105 frozen). "Make study app for Maharashtra board students" (45 characters) failed after the free 25-minute cap (NOT user-stopped; not charged). Domain was correctly education via "students", but "study app" was not a practice-tool phrase, so REQUIREMENT_GAPS injected roles/courses/enrolment/grading/progress/fees. The fast lane built a board-study UI in 287s, failed typecheck (react-router-dom missing), salvaged 26 files; the full builder then added auth/admin/enrolment screens, wrote 21 more files after first render at 735s, and hit the cap. Ledger: [autopsy](docs/build-report-autopsy-BR1973.md), [evidence](docs/build-report-autopsy-BR1973-evidence.json).
- **F1.** `namesASingleLearnerTool` now treats a "study app" as one learner's tool (same withdrawal as a mock-test/quiz/flashcard app, autopsy 73648e12), unless the request names an institution (school, teachers, logins, fees, courses, lessons, …). "study app development/security/architecture" is not a study app. Domain stays education; "Make an education app" stays general; education-loan stays fintech (Q-2644 is not rewritten). Opposite-class corpus built before the edit.

Queue: this commit closes no earlier row. New rows Q-2645 (vite-react starter missing react-router-dom) and Q-2646 (Weak preflight may still call a study app complex). Q-2644, Q-2643, Q-2642, Q-2640, Q-2621, Q-2611, Q-2375 / Q-1068 and earlier blockers stay open. The free 25-min cap after a rendered preview is already Q-2631 (not rewritten). The optional `.nb-topbar :is(h1,h2,h3)` idea from the #4162 review is not shipped (no evidence in this report).
Reviewer FAIL on PR #4164 at `9a39ae210`: `study app` also matched “case study app” / “case-study app”, and the craft-word lookahead only saw whitespace (“study-app-development”, “study app/development”). A first follow-up added `(?<!case[\s-])` and `[\s\-/]+` separators.
Reviewer FAIL at `b8bcda5fc`: that lookbehind had no word boundary, so showcase/lowercase/uppercase/briefcase study apps (and “Make a showcase study app for Maharashtra board students”) were missed and fell back to complex_app/58; “case  study app”, “case/study app” and “case, study app” still leaked. Follow-up uses `(?<!\bcase[\s\-/,]+)` and `study[\s-]+`. Corpus locks every reviewer probe; mutations drop `\b` and the `+` quantifier and must turn red.

## 2026-11-11 — WhatsApp share on published apps and APK download

Owner-approved share button. One `https://wa.me/?text=` link (Hindi message + public https app URL; a public APK URL only when it is not an /api/ path or a signed download ticket). Surfaces: publish celebration, Live site (desktop row and phone sheet), App Mart publish result, My apps, the published app sheet, App Mart APK download, the APK build result, and My built apps. The play overlay stays without a share button. Quotas, billing, referral, and chat fallback are untouched.

## 2026-11-11 — BR1977 autopsy (anonymized 3D city game, failed / RED): a kit success must leave files; gadiyan is a car

Owner-requested sequential audit, BR1977 only (boundary 1951..2105 frozen). Branched from origin/main `487a18336` (the #4169 squash-merge of exact BR1976 head `e08fd1d31`). A Hinglish 3D city-game request using the vehicle word gadiyan failed after 23.7 min on Surplus/qwen3-coder, OVER the 10.5–17.3 min game ETA band, and was not charged. GAME_KIT_SEEDED listed five recipes and 3 files after SANDBOX_UNAVAILABLE; six seconds later `events.ts` was missing. The contract had `vehicle:null` because `gadiyan` was not in the car regex (`gaadi` already was). The builder invented a custom vehicle module (written after the missing-file gate), the preview 404'd (no `index.html` in the 48-file manifest), playtest never ran, and RELEASE_GATE stayed RED on that stale missing module plus `DEFAULT_TOUCH_BUTTONS` after a frontend overwrite of `touchControls.ts`. Ledger: [autopsy](docs/build-report-autopsy-BR1977.md), [evidence](docs/build-report-autopsy-BR1977-evidence.json).
- **F1.** The car vehicle regex now accepts Hinglish `gadi` / `gadiyan` / `gadiya` / `gaadiyan` (and `gaadiyaan`) as well as `gaadi`. This prompt becomes `vehicle:'car'` with a chase camera; genre stays `unknown` (not racing). Train / bicycle / snake / `gta5 wala game` neighbours stay put.
- **F2.** After the recipe loop the route counts files that landed versus `writtenBeforeKit` and downgrades every empty `!r.is_error` success unless at least as many files landed as recipes that said they succeeded. A healthy ~30-file 3D seed is unchanged; this report's 5-ok/3-file claim becomes GAME_KIT_NOT_SEEDED and the handoff stays silent so the builder runs the recipes itself. 3D-asset prep does not run on a missing 3D layer.

Queue: this commit closes no earlier row. New rows Q-2653 (bare `game` still confirms a stub — #4169 reviewer residual) and Q-2654 (high-confidence objectless orders such as `app banao` / `Banao` still confirm when the ask-gate misses — #4169 reviewer residual). Q-2649, Q-2650, Q-2651, Q-2652 and earlier blockers stay open (none of them appear as this report's DNA). Q-2270 stays the residual `DEFAULT_TOUCH_BUTTONS` repair. Q-2621 stays the E2B cap.

## 2026-11-13 — App-lock fail-closed storage and atomic attempts
Unavailable database now throws instead of looking like an account without a PIN. Replaced read/compute/set mutations with retry-safe Firestore transitions for PIN attempts, PIN changes, OTP reservation and atomic consumption/reset, plus area changes. No external side effects inside transaction callbacks; no ticket before commit. Offline concurrency regressions cover lost updates, replay and commit failures. Existing account state/schema is preserved. Final integration CI and deployment are separate; see docs/APP_LOCK_ATOMICITY.md.

## 2026-11-13 — Categorized game librarian, bounded implementation
Reused the existing object specifications/builders and reviewed model metadata through object_spec. Added category indexing, compatibility/license/animation metadata, explicit empty map/audio and missing results, bounded search, and immutable returned metadata. The actual game seed handoff now separates prepared models from unprepared alternatives and pending scene/gameplay verification. Existing external-asset defaults, provider calls and admission gates are unchanged. No new content was purchased or acquired; no device performance or production rollout is claimed. See docs/GAME_LIBRARY_LIBRARIAN.md for remaining gaps and validation evidence from the final combined commit.

## 2026-11-13 — Library requirements/device planning and quarantined CC0 expansion
Added explicit game subject/role/animation planning with existing genre scenery as optional suggestions, conservative mobile/default planning budgets, and honest unknown/unsupported WebGL2 target handling. Acquired 11 official pinned KayKit sources, validated their derived GLBs and preserved individual provenance/hash evidence; render proof is environment-blocked, so candidates stay outside the active runtime catalogue. No finished maps/audio/weapons acquisition or device FPS guarantee. Separate successor patch, not part of the previously frozen librarian candidate.

## 2026-11-13 — Eleven CC0 models, local browser admission
Resolved the environment renderer blocker using official Chrome-for-Testing headless shell. All11candidate source/resource/license and derived hashes checked; actual render/texture proof passed, walking/running motion for4characters. Added47-model reviewed catalogue candidate, exact-subject locomotion selection, library categories, reproducible source derivation and normal seed/cache/local production-artifact acceptance. Original all11scene exceeded draw-call ceiling; bounded1character+7static fixture kept the original ceiling. No user-device FPS, completed-map, cloud transport, rollout or production deployment claim. See library-admission evidence; final CI/review still required.

## 2026-11-14 — SEO and Google Play ASO baseline

Created a clean worktree from `origin/main` for the requested SEO/ASO audit because the original checkout was dirty and behind the production branch. Source and public-page inspection confirmed that server-rendered marketing pages, canonical metadata, social cards, JSON-LD, robots, sitemap and crawler regressions already exist on current `main`; this work deliberately does not duplicate them. A factual Android `MobileApplication` JSON-LD node now links the existing Organization/WebSite graph to the published package and Play listing without ratings, price, or feature claims. `docs/SEO_ASO_BASELINE_2026-11-14.md` records evidence, severity-ranked findings, account-dependent blockers, keyword measurement plan, 90-day roadmap, and ready-to-upload English (India) and Hindi (India) Play listing copy. No Search Console, GA4, Play Console, production runtime, listing upload, app bundle, PR, merge or deployment is claimed; those require external authorization or an explicit release request.


## 2026-11-14 — PR 4200 reconciliation with current main

Preserved main’s game template imports and actual racingTrackIndex(trackName) selection instead of restoring the stale single-track constant. Preserved the stacked SEO/ASO work from PR 4201. Corrected applicationSuite to the Schema.org Text value in both static and server JSON-LD and locked parity/type in regression tests. Corrected the ASO draft length labels and shortened its English short description; no Play Console upload was performed. Full local CI on this final reconciled tree remains required; previous interrupted tests are not a passing gate, and merge or deployment is not claimed.

## 2026-11-14 — A 5.4 MB one-file game lands intact, and an AI edit cannot corrupt its media

Request: a single-file HTML game (5.4 MB, ~4.6 MB of it base64 video/audio/images) must upload into Files, IDE and Preview intact, be edited without its media being rewritten, and have every edit checked. Investigated from code first; fixture-based (the real file is not in the repo).

**Exact limits a 5.4 MB .html hit:** browser filter and server zip extractors 900 KB (dropped as tooLarge); `import-files` route 5 MiB (a 5,432,975-byte file was skipped); the durable text store silently drops anything over 900 KB regardless; a single .html picked through "Choose file" is a chat attachment that is sent to the model and never reaches Files.

**Root causes (class → fix):** (1) no single-HTML import path → `importSingleHtml` + the picker accepts a page; (2) the size cap written five times, five values → `IMPORT_LIMITS`, one object, census test; (3) `import-files` wrote a browser-sent asset (data: URI) as TEXT → `prepareImportBody` sorts assets from text at every door; (4) media is invisible to every limit and reaches the model whole → `embeddedMedia.ts` lifts media into `assets/media/` (data URIs become relative paths; a bare base64 literal read by `atob` becomes `__nbAsset64('assets/media/…')`, a synchronous loader returning the identical string, so the game's own decoder and its localStorage keys are untouched) and `elideEmbeddedMedia` hides any remaining payload from the model at `AgentRunner` (request, repair prompt, every tool result); (5) the write-time parse guard never judged `.html`, so an edit that broke the inline script was accepted → `editIntegrity.ts` on both write doors (media byte-for-byte, inline scripts still parse, page whole, new asset refs resolve; only regressions refused; `AGENTV3_EDIT_INTEGRITY=off`).

**Tests (all with reversion proofs, each seen failing):** `embeddedMedia` (23), `theImportLimitsAreOneNumber` (8), `singleFileGameImport` (10), `singleHtmlProjectImport` (6), `theBuilderIsNeverSentMedia` (14, drives the real AgentRunner and ToolDispatcher), `everyImportDoorSortsItsBody` (5).

**Still open (queue):** Q-2662 🟡 render proof for a no-package.json page needs E2B + a browser; Q-2663 bash rewrites bypass the page guard; Q-2664 Code Studio's own upload and in-browser preview bundler; Q-2665 git-clone landing; Q-2666 the class lock covers AgentRunner, not the other model lanes. The real end-to-end run (upload → edit → render) was NOT done: it needs E2B and model keys.
## 2026-11-14 — Autopsy e41fdb21: "banao" after a 3D city game request built a Notes app
- **Report:** chat said "mujhe ek 3d realistic city game bana lar do"; the next message was "banao". The build prompt was the single word `banao`; the Weak lane planned and built a Notes app (BUILD_SUCCESS, 11 files), saved as the city game's "last successful build".
- **Root cause / class:** two judges answering "does this message point at the conversation?" differently. The ask-what-to-build gate (`shouldAskWhatToBuild`) lets a bare order through when an earlier buildable turn exists; `refersToConversation` said "banao" points at nothing (POINTERS matched "isko banao", never bare "banao"), so `planningRequest` dropped the earlier turn (chat/offer/clarify lanes are not specs) and every lane read only "banao".
- **Fix:** `refersToConversation` now also returns true for a message that names no object (`namesNoObject`) — one predicate for the planner, the sizers and the conversation-reply read. Lock: `tests/aBareOrderBuildsWhatTheChatDescribed.test.ts` (9 of 12 fail with the fix reverted).
- **Not fixed here / still to watch:** why the first turn was not recorded in the `build` or `offer` lane is not provable from this report (the saved report holds only the build turn). The next real "<request>, then banao" run should show `earlier-requests` in the planning note.
- **Pre-existing, unrelated:** `tests/br1955Prevention.test.ts` fails on current `main` (game repair default ON from #4193; open PR #4199 suspends it).
- **e41fdb21 follow-up (Q-2655):** the `JOURNEY_NOT_RUN` row. Reproduced offline with a reconstruction of the two components: `NoteEditor` (imported first, rendered only after a selection) and `NewNoteForm` share ids `note-title` / `note-content`, so the derived journey used the editor's "Save Changes" with the visible form's fields. `journeyDerivation.ts` now tries forms the page always renders before ones it renders behind a condition (never drops them). Lock: `tests/aFormIsJudgedWithItsOwnSubmit.test.ts`. The reconstruction comes from the saved LLM previews, not the delivered files (the report holds only hashes), so the live effect is confirmed on the next Notes-style build: the journey should run "Add Note". Q-2656 (request-vs-app match) and Q-2657 (first turn's lane) are open/blocked in `BUILD_REPORT_QUEUE.md`.

## 2026-11-14 — Edit promotion + durable project memory (incident: an edit replaced a built 3D game with a different game)
**Root causes found in the repo (not guessed):**
1. **The turn-end settle promoted on "it renders" alone.** `decideGreenGuard` restored only when the app was proven BROKEN; a candidate that is a different app renders, so `saveWorkspaceFiles(workspaceId, toSave)` AND `saveWorkspaceFiles(greenKey, toSave, {mode:'replace'})` took it as the project and as the new last-known-good. Nothing compared the candidate with the version it was an edit of.
2. **A second unguarded promotion: the in-build proof** (`attemptInBuildGreen`) saved the rendered tree as last-known-good mid-turn, so by settle the "good" snapshot already was the replacement.
3. **The original brief had no durable home.** `WorkspaceMemory` evicted the oldest episode of ANY kind at 500 (a build writes dozens of error/fix/note episodes, so the first request went first); Firestore kept only the last 100 and ignored a snapshot after 30 days; the planner read the last 3 requests. After a worker restart the brief was gone.
4. Not a cause but a hole: the base was never proven complete — an edit over a partial hydration compared and restored against a fragment.
**Fix (all deterministic, no extra model call):** `editPromotionGate.ts` (candidate vs verified base: identity files removed, most of project removed/rewritten, engine dropped, dangling imports; moves, named deletions, asked rewrites, fresh start/approved rebuild allowed) wired at the in-build proof and the settle; `editRelease.ts` (promote / hold / keep-unverified, one rule for every tier); `projectRevisions.ts` (immutable revisions, manifests, `verifyBase`, atomic compare-and-swap promotion in Firestore, idempotent per edit id); `projectRequirements.ts` + `…Store.ts` + `projectMemoryTurn.ts` (brief, standing requirements, supersession, source message ids, rebuild from the canonical conversation, bounded block into `planningRequest`); eviction/persist fixes in `WorkspaceMemory` / `FirestoreWorkspaceMemoryStore`; the existing `/api/agentv3/restore-version` records a `restore` revision. Kill switch `AGENTV3_EDIT_PROMOTION=off` (ENV_REGISTRY).
**Rollout / migration:** none to run. A legacy project has no revision: its saved source is the base for its next edit and its first baseline (labelled `legacy-saved-source`, no browser proof) is written when that edit is promoted. The requirements ledger is rebuilt from the saved conversation on a project's first edit after deploy.
**Not done / not verified (open):** (a) no new browser smoke test of the exact built artifact, camera-flag matrix or collision drive-into-obstacle test — the existing playtest/preview checks are unchanged and `artifactDigest` is the preview copy's file hash, not a build-output digest; (b) binary assets are outside the text durable store, so the gate and restore only see text files; (c) a conflicting concurrent edit is NOT rebased in the route (the build lease serializes edits; the CAS is the backstop) — it is kept unverified and reported; (d) a held edit zeroes the bill and replaces the summary but the result's `ok` is unchanged; (e) the Firestore drill was run against the local emulator, the gate's accuracy only on a synthetic corpus; (f) old-vs-new success rate / p95 latency / cost on real edits cannot be measured without production data.
- **Census guards this change had to answer (2026-11-14):** the route's branch budget (537, unchanged — new branches were moved into helper modules because the one function is at TypeScript's control-flow limit), the green-freeze write census (a second `attempt`-key write), the shared-restore caller census (the gate's hold uses the same allowlisted `green-guard-restore` pass), the closed-warning classification (`IN_BUILD_GREEN_HELD` is not-a-repair), the promise-handler census (the held-edit message quotes no follow-up), and both Firestore census tables (`project_revisions_v3` + `revs`/`byEdit` and `project_requirements_v3` are workspace-scoped and registered with the app erase).

## 2026-11-14 — Recovered compact Pro composer popups and admin configuration notes

Root cause: mobile attachment CSS overrode the already-measured portal with left/right/bottom constraints; Pro mode/options menus remained inside the horizontally scrolling toolbar and used a fixed footer offset. Short content became wide empty sheets and controls could be covered or clipped.

The Pro mode and options choosers now use one content-sized body portal, measured above the actual composer with visual-viewport and resize/scroll updates. Attachment positioning also clears the actual composer and no longer receives the conflicting mobile override. Mode width is 240px; expanded suggestions, options and attachments are bounded to 300px and the visible viewport. Popup controls retain 44px touch targets. Escape, selection, external focus and repeated opening have explicit focus ownership; resize does not steal focus. Existing mode/build/import actions are preserved.

The registry appendix records the 38 exact variable names from the owner's two screenshots, never values. Signing-key format and fail-closed behavior are explained from code; the owner-reported successful admin login is not represented as independently verified deployment. No environment settings or credentials were changed.

Recovery note: the earlier local candidate was absent after environment recovery and this candidate was reconstructed against main abe583b8. Earlier test totals do not certify this new tree. Focused geometry/source/admin tests and frontend typecheck have been rerun; final full CI-equivalent validation and actual browser interaction evidence must be read from the final PR/commit record. No merge or production deployment is claimed here.

## 2026-11-14 — A whole HTML page picked through "Choose file" is imported, not reviewed (added to PR 4204 at the admin's order)

The admin attached their 5.2 MB game through "Choose file" and got a code review back: that path stages an attachment that the model reads and answers about, and never opens it in Files / IDE / Preview (the gap #4203 left: it fixed the Import project option, not this door). `addFiles` in `AgentV3Panel` now sends any `.html` of 200 KB or more (`shouldImportAttachedPage`, `zipPicker.ts`) to the existing `handleZipProject` import and does not stage it; a small page stays an attachment. The user's typed message stays in the box. Lock: `tests/anAttachedGamePageIsImportedNotReviewed.test.ts` (reverted twice, failed twice). Not covered: drag-and-drop or paste into the composer if they bypass `addFiles` (not checked).

## 2026-11-14 — The imported one-file game's preview was "Blocked request … host not allowed": a one-file page is a static site, not a React app

Evidence: the admin's screenshot after the (successful) import of `abcd.html` — Preview, "Live server · port 5173", "Blocked request. This host (5173-….e2b.app) is not allowed. To allow this host, add it to `server.allowedHosts` in vite.config.js". **Chain found in code:** the Pro panel's default framework label is `vite-react`; `preview-diagnose` ran `ensureViteReactFoundation(saved, { framework })`, whose `isViteReactTarget` trusts the label (`/vite|react/`), so a project with no React at all (one html page + media files) got a synthesized React + Vite `package.json` and `vite.config.ts` and Vite on 5173. The synthesized config was a DRIFTED COPY of the template's (`server: { host: true }`, no `allowedHosts`), so the E2B preview host was refused by the server the platform had just configured. **Class:** (1) a label decides what a project IS with no look at its files; (2) a copy of a template config that lost a field. **Fix:** `isStaticSiteProject` + `ensureStaticSiteFoundation` (`FrameworkFoundation.ts`): a project of plain pages (no JSX/TS, no module imports, no bundler config, no real package.json) gets the static runner (`npx http-server`, 3000) and never Vite; `preview-diagnose` asks it first; the synthesized `vite.config.ts` now carries `allowedHosts: true`. **Lock:** `tests/aOneFilePageIsAStaticSiteNotAReactApp.test.ts` (10; three reversions each failed, restored) incl. a census that fails if any server source writes `host: true` into a Vite config without `allowedHosts`.
**NOT verified:** I could not run it in a real E2B sandbox. Unproven: that `http-server` comes up and is found by the port probe (the label-derived 5173 vs the script's 3000 — `devScriptPort` reads `-p 3000`, not exercised live), that the sync-XHR media loader works behind it, and that the game then renders. The first real check is the admin re-importing `abcd.html` after deploy. This is the same open item as Q-2662.

## 2026-11-14 — Second import of the game: "0 file(s) were saved, but 1 batch(es) failed" then "✅ Imported … starting your app"

Two defects, both fixed; the failure's CAUSE is still unknown (Q-2667, blocked on the next real run). (1) `uploadExtractedFiles` threw the HTTP status and the server's sentence away and never retried a transient answer; it also put every media file of the page into one request. Now: the reason is kept and shown (`Why: 429 — …`), 408/425/429/500/502/503/504 and dropped connections are retried 3× with a growing pause, 400/403/404/413 are not, media travels in ≤3 MB requests after the text, and the old promise "send your next message and I will retry" (no such retry exists) is replaced by "import it again — saved files are merged". (2) The panel announced "✅ Imported" and booted a preview even when 0 files were saved; `importLanded` now stops it with an honest "NOT imported" line. Lock: `tests/anImportUploadFailureSaysWhyAndRetries.test.ts` (9; five reversions each failed, restored).

## 2026-11-14 — Q-2665, Q-2666 resolved; Q-2663 narrowed (the three "other doors" of the single-file game work)

**Q-2666 (other model lanes):** the class lock was proven on `AgentRunner` only; the fast lane, one-shot builder, judges and surplus runners reach a model through a LEAF runner. `elideTurnParams` (`elideTurnMedia.ts`) now runs first in the four leaves — `ClaudeClient`, `OpenAiToolRunner`, `GeminiToolRunner`, `SurplusTurnRunner` — hides media in strings, text blocks and tool results, and never touches a vision block (`image`, `image_url`, …). Lock: `tests/everyModelCallHidesEmbeddedMedia.test.ts` (5) incl. a census that fails if a NEW class implements `runTurn` and calls a provider without being a named leaf or wrapper. **Q-2665 (git clone):** `liftForLanding` now lifts for both transports and returns `landClone`, which writes the code-only page and the media files over what a clone already put in the sandbox; lock `tests/aClonedPageIsLiftedOverTheSandbox.test.ts` (5). **Q-2663 (bash):** a shell command's HTML targets (`shellWriteTargets`) are read before it runs and judged after with the same `htmlEditVerdict`; a regression is put back with a note (`tests/theBuilderIsNeverSentMedia.test.ts`, +4). Narrowed, not closed: a script that builds the path at run time is not seen. All reversions failed and were restored. **Not touched:** Q-2664 (Code Studio upload and its in-browser preview), Q-2662 and Q-2667 (need E2B / the next real failure line).
## 2026-11-14 — APK build for the one-page game: "The build stopped without leaving a reason" — my own preview fix wrote a package.json the APK classifier read as `built`

Evidence: the admin's screenshot — "Updated …/app-5-files-…", note "Your app builds itself with \"npm run build\", so the build output in \"dist/\" is what gets packaged", then "Why this build failed … the reason could not be determined". **Chain:** #4205 made the preview boot write a static-runner `package.json` (`"build": "echo \"Static site — no build step needed\""`) for a one-page project; `detectProjectKind` (mobileProjectAssembler) compared the build script with ONE exact sentence (`STATIC_NO_OP_BUILD`), so this echo read as `built`, `detectWebDir` said `dist`, and nothing produces `dist/`. **Class — the same as 2026-09-22 ("a classifier whose input is manufactured by the thing it classifies must recognise its own hand"), one sibling later:** three places of ours write a static package.json (the assembler, `StaticProvider`, `ensureStaticSiteFoundation`) and the detector knew one of them. The static TEMPLATE's package.json had the same latent defect before this. **Fix:** `isNoOpBuildScript` — a build that only `echo`es (nothing chained) is static; the detector uses it. **Lock:** `tests/aNoOpBuildIsAStaticApp.test.ts` (8; two reversions failed, restored) incl. the end-to-end assembly of the game as the preview boot leaves it (kind static, webDir www, media under www/assets/media/, no `npm run build` note). **Regression owned:** this was caused by my #4205; the APK path was not in its blast-radius trace. **Not verified:** a real APK build on GitHub; the web publish path for the same project (Q-2668).

## 2026-11-14 — Athree map PHASE 1 built (default OFF); phases 2–7 NOT built

Admin: "build karo" on the approved plan. Built: `src/server/lib/athreeMap/` — `AthreeMapGenerator` (emits `src/game/athree/{noise,config,world,collider,chunks,index}.ts`: seeded fractal terrain with an EXACTLY seamless 100 km loop or an 8 km bounded island, biomes, a shared wind field, safe spawn points for player/vehicle/plane/boat/animal, heightfield data node-for-node equal to what is drawn, chunk streaming with LOD, crack-hiding skirts and a floating origin, three quality tiers with a computed triangle budget), `athreeMapIntent` (the admin's three conditions: named+needed / needed / librarian; user-named other map and explicit refusal win; the random pick is made once per project and kept — a project that has `src/game/athree/index.ts` keeps it), `athreeMapLibrary` (the `maps` library record, owner licence). Wired: `GAME_RECIPES`, `generate_athree_map` (catalogue, both name lists, dispatcher with flag + request check), the architect prompt (step 7), the library (maps listed only while ON), `gameKitHistory`, AppKnowledgeBase `athree_map`, ENV_REGISTRY `AGENTV3_ATHREE_MAP`. Tests: 39 (generator, runs the emitted code incl. a strict typecheck, real three.js streaming) + 26 (intent) + 9 (wiring); every guard reverted and seen failing, and two redundant checks found and replaced along the way (spawn slope → plane cross-slope + ground flat ring). **Not verified:** how it LOOKS in a browser (no screenshot yet — the next step), the heightfield layout against the real Rapier API, device frame rate. Queue Q-2669 holds phases 2–7.

## 2026-11-14 — Athree map PHASE 2a (the ocean) built, default OFF; rivers/lakes (2b) NOT built

`water.ts` + `ocean.ts` (emitted from `athreeWaterSource.ts`): eight Gerstner waves (5.5–180 m), deep-water dispersion omega^2 = g k, amplitude scaled by the SHARED wind (calm 0.35 to storm 1.2), steepness budget 0.7 so a crest never loops; one component table feeds the CPU surface a boat floats on (`ocean.floatAt`, inverts the horizontal motion) and the GLSL (generated from the same table; a test round-trips every number). The ocean is one camera-following grid that moves in whole cells (no swimming), displaced on the GPU by the long waves, every wave shades the normal; colour runs shallow to deep from a shore-depth texture baked from the terrain's own height function (rows a few per frame, swapped in whole); foam gathers in shallows. Wave phase uses WORLD metres, so the floating-origin re-base never makes the sea jump. `createAthreeMap` now gives `ocean` and one `update(camX, camZ, time)`; the flat placeholder sea is gone. Tests: 24 + 7 reversions failed (dispersion, inversion, GLSL table, swimming, origin, early swap, loop budget). **Verified in headless Chromium (software GL): both shaders compile (glError 0), the sea renders, and between two times the water pixels change (25%) while the sky does not (0%).** **Not verified:** frame rate on a phone, how it looks at sunrise/storm, the short waves under 26 m are shaded not displaced (a boat feels them, the mesh does not show them). **Seen while looking:** the shore is a very wide flat sandy shelf (the terrain's land formula is gentle near sea level) — a terrain-shape item for a later phase, not a water bug. Queue Q-2669 updated.

## 2026-11-14 — Athree map PHASE 3 (grass and trees) built, default OFF; a Phase 1 defect found and fixed with it

`vegetation.ts` (pure) + `plants.ts` (three.js), emitted from `athreeVegetationSource.ts`. **Placement:** one candidate per 12.5 m cell, its random numbers owned by the CELL (so any two rectangles agree exactly, and a 100 km loop wraps with no seam: the period is a whole number of cells), rules by biome / slope / altitude (forest dense with clearings and conifer patches, grassland copses, mountain conifers thinning with height, beach palms, none in desert / sea / snow / steep). Grass: jittered grid over a 2 m world-aligned lattice of ground height + thickness blended bilinearly (a tile costs a few hundred terrain samples, not one per tuft; neighbouring tiles agree exactly). **Plants:** trees are tubes + leaf CARDS cut by a procedural fragment mask (no texture): broadleaf (2 variants), conifer (2), palm (1), each at two levels of detail with an exact triangle bound; a tuft is three crossed cards (6 triangles) whose blades are cut in the shader. **Wind:** one vertex-shader bend along the world wind direction scaled by wind speed, a travelling gust, per-leaf flutter; the uniform is `world.windAt` at the camera (tested equal). **Streaming:** 64 m tree tiles and 32 m grass tiles built a few per update, nearest first, instance buffers rebuilt when the camera moved 15-25 m, floating-origin safe (the group moves, the plants do not). **Budget:** each tier's worst case (tufts + full-detail trees + cheap trees) is tested to fit what terrain and sea leave of `budgetTriangles` (phone 25.7k drawn of 49k allowed in the screenshot run).
**Defect found while testing, fixed (class: an island seed could drown its own core):** seeds 4, 8, 11, 14 (and 10, 33, 38 nearly) of the battle-royale island were open sea — the noise swing (0.5 x 1.2) exceeded the base (0.35). Now base 0.45 over swing 0.3, and a census test checks 60 seeds for land at the core (reversion-proven).
**Proof:** 35 new tests + census; nine reversions each caught by the right test (island, loop wrap, steep ground, desert, budget, wind uniform, cell-owned scatter, rooted trunks, tree cap). Two of my first tests were vacuous (tested a patch of sea) — the reversions exposed it and they now require non-empty results. Headless Chromium (software GL): shaders compile, glError 0; 14 percent of pixels change between two times at one camera.
**NOT proven / ceilings:** phone frame rate (budgets only); trees have no collider; a far forest ends at the tier radius (a far impostor is the real fix); broadleaf trunks are stubby; the look is judged by the admin's eyes.

## 2026-11-15 — Fresh original royale practice rebuild (not release-ready)

Recovered a clean current-main checkout by verifying all 6,716 GitHub blob hashes at 2667850. Old unmerged prototype source/logs were unavailable; this is newly written code, not recovery of that tested tree. Added an experimental bounded offline recipe and guarded dispatcher/catalog/dependency integration. Default OFF; no billing, fake delays, overwrite of existing/imported source or Athree world replacement. First integration test run found a missing generated terrain import; repair and complete exact-tree validation are required. No merge/deployment or visual acceptance claimed. See docs/game-engine/original-royale-practice.md.

### Original royale reconciliation with 7948bef (#4208)

Preserved upstream edit promotion, verified revisions and durable requirements. Optional royale admission now additionally refuses an existing verified head, unreadable hydration/revision check, or non-starter hydrated source. Extended security census context so the default-OFF recipe is actually enabled and scanned through the real dispatcher; scan rules/assertions/callability thresholds remain unchanged. The old-main coverage run is obsolete and did not pass; final combined-tree gates and browser acceptance remain required.

## 2026-11-15 — Athree map PHASE 2b (rivers and lakes) built, default OFF

Admin: "baaki sab Athree phases poore karo" — phase by phase, each its own PR. `rivers.ts` (pure) + `riverwater.ts` (three.js), emitted from `athreeRiverSource.ts`. **Network:** sources hashed in the highlands; each river traced down the steepest descent of the terrain WITHOUT rivers (three scales of slope, so a flat plain still drains to the sea; a meander on gentle ground); a trace that meets another joins it (flow adds up, width grows); a pit fills into a lake up to just under its lowest rim and an outlet river leaves from the rim; a river that finds no way out after six breaches (or runs out of length) ends in a dug terminal lake. **Every river ends in the sea, a lake or another river (0 abandoned of 639 on 10 seeds + 12 islands).** Water level only ever goes down, never above the ground 40 m out on either bank, ends at the shore of its lake. **Carve:** `heightAt` = base height minus the MINIMUM of what every segment and lake asks (a minimum of continuous functions is continuous: no cliff where two rivers meet), banks as wide as the cut is deep (slope at most 45 degrees). `world.waterAt`, `world.waterBodies()`, `world.baseHeightAt`; trees, grass and ground spawns skip water. **Draw:** ribbons (4 triangles per segment) and lake fans, built per tile, a flowing-water shader (layered noise scrolled along the flow, depth from the middle to the banks, foam), `riverWater.floatAt` for boats. Budgets tested per tier against what terrain, sea and plants leave; water drawn only where the terrain mesh can hold a bed (400 / 700 / 1300 m).
**Defects found while building, fixed:** rivers silently written off as "limit" when they looped in a basin (class: a river that just stops) — now a pit; a carve that picked ONE nearest segment made a 10 m cliff where rivers met; the water level could stand 9 m above the bank after smoothing; `waterAt` called a lake centre a river; ribbons could open a hairline crack at tile joints (25 cm overlap now); **a 123 m cliff** where the spatial grid listed a river only 40 m out while a gorge bank reaches 100 m (a candidate popped in at a grid edge: the bank is now capped at 90 m and the grid pad covers it), and rivers that cut straight through ridges (water now treats more than 15 m of climb as a rim: lake or breach); rivers that looped or kinked on flat coasts (far-slope guidance 1 km and 4 km, momentum on gentle ground, no turning back when breaching).
**Proof:** 28 new tests + census; 14 reversions each caught by the right test (monotone level, nearest-only carve, loop wrap, lake priority, lake under rim, tree in water, abandoned river, bank limit, budget, confluence widening, shore cut, grid pad, ridge climb, bend guidance) — five needed a stronger test first; one guard I had added (join only at the same height) no test could tell from its absence, so it was removed.
**NOT proven / ceilings:** phone frame rate; no bridges (roads phase); no boat model; the look is judged by the admin's eyes.


## 2026-11-15 — Preserve tree scatter while avoiding rejected-candidate terrain work

The intact Athree vegetation suite exceeded its existing 20-second test limit after river-carved terrain queries were added. Reordered only pure candidate queries: reject rolls above every biome's maximum probability and ineligible biomes early, defer water/slope/species work until the candidate passes density. Random-number consumption and admitted TreeSpec attributes are unchanged; water exclusion remains mandatory. Added an independent frozen pre-optimization tree-scatter oracle and exact-output checks across real worlds, biome/slope/water boundaries, plus query-count reduction proof. Existing assertions, timeouts, scan scope and coverage thresholds remain unchanged. Focused instrumented 41 tests passed; that focused command correctly fails repository-wide coverage thresholds and is not a full CI pass. Full combined-tree validation remains required; no rollout, billing or deployment is activated by this repair.

## 2026-11-15 — Athree map PHASE 4 (desert dunes, sky, day and night, weather) built, default OFF

`dunes.ts` (pure) + `sky.ts` (pure half: sun, palette, weather; three.js half: dome, rain, lights, ambience), emitted from `athreeSkySource.ts`. **Dunes:** an asymmetric saw (gentle windward 72 percent, steep lee 28 percent) across a seeded wind, warped by periodic noise, whole-number wave vectors on a loop so 100 km repeats exactly; amplitude 3-8 m; a third of a desert is flat hardpan; added on top of the carved ground and faded to zero within 20 m of water. New world API: `dunesAt`, `desertnessAt`. **Sky:** standard hour-angle sun (26 N, late spring: ~13 h day), palette blended by sun height (day / night / twilight), gloom and fog grey it; dome shader with sun, moon, stars, five-octave clouds projected on a plane and carried by the shared wind, lightning flash; rain is lines (no triangles) falling in the vertex shader, slanted by the wind; weather clear/cloudy/rain/storm/fog eases (no overshoot), optional deterministic five-minute schedule per seed; its own sun + sky lights; `applyTo(scene)` for fog/background; `ambience()` gives wind/rain/thunder/night/waves/birds levels for the game's audio. One sun for the map: plants, sea and rivers read the sky's light each frame. Budget: dome triangles tested exact and inside what terrain, sea, plants and water leave.
**Defects found while building, fixed:** the runway search was random and could miss a strip that exists (class: a random search standing in for a complete one) — a full 100 m scan now backs it up; a dune mask on carve DEPTH (not distance) gave a 3.3 m step at river banks and could bury a bed; night was black (ambient and moon light raised).
**Proof:** 49 new tests + census; 16 reversions each caught by the right test (dunes add only, loop wrap, hardpan, height/slope bound, water mask, sun east, night, weather mix, dome formula, lightning only in storms, fog range, one sun, dome follows camera, runway scan, weather bounds, rain visibility, applyTo) — three needed a stronger test first. Headless Chromium: shaders compile (glError 0); day, dusk (warm horizon, stars), night (stars, moonlit ground), storm (dark cloud, rain), desert dunes rendered.
**NOT proven / ceilings:** phone frame rate; no sand ripple texture or heat haze; no shadows; one cloud layer; the look is judged by the admin's eyes.

## 2026-11-15 — Athree map PHASE 5a (roads, race circuit, runways, plazas, bridges) built, default OFF; vehicles (5b) NOT built

`roads.ts` (pure) + `roadmesh.ts` (three.js), emitted from `athreeRoadSource.ts`. **Network:** per 12.5 km region on demand (a bounded island is one region), built in ~0.1 s: village plazas on flat dry ground (up to 8 tries per cell); highways between neighbouring villages by A-star on a 100 m grid (cost grows with slope, no hop over 18 percent, cells over 25 percent forbidden, rivers crossable at a price, sea and lakes forbidden), Chaikin-smoothed, resampled every 10 m, height profile = ground averaged along the road limited to 7 percent grade, a flat bridge deck 3.5 m over every river (pinned, with ramps), roads that would sit more than 14 m off the ground are not built; a banked closed race circuit (racing profile) with its profile closed exactly, bank = minus 40 x curvature (outer edge higher), checkpoints every 250 m, cars gridded behind the start line; a flat runway cut and filled where the ground is flattest (every profile but racing; two on flight; planes start on them). **Carve:** a weighted blend of continuous candidates (road beds with banking, plazas), shoulder as wide as the cut is deep (5 to 40 m), so `heightAt` is one surface for renderer, collider and mesh; `drivableHeightAt` gives the deck on a bridge. **Draw:** ribbons (2 triangles per 10 m), rails and piers on bridges, plaza fans, markings (dashed centre, edge lines, red/white kerbs, chequered start line, runway piano keys and centre line) painted in the fragment shader; lit by the sky's sun. World API: `roadNetwork`, `roadAt`, `drivableHeightAt`, `homeRoads`. Trees and grass stay off roads. Budgets raised (phone 160k, mid 480k, desktop 1.4M) so roads and later actors fit; desktop river cap 20000 to 8000.
**Defects found while building, fixed:** a road kept to 7 percent next to ground that fell away made a wall of 100+ m (class: a road that floats over or hides in terrain) — hops over 18 percent, cells over 25 percent and any road more than 14 m off the ground are now refused; a bank sign error caught by the test (the outer edge must be the high one); the random-only runway search could leave an island with no strip (runways are now cut where the ground is flattest, always); the vegetation test timed out at 20 s under coverage (two-minute timeout on the world-sampling tests, assertions untouched).
**NOT proven / ceilings:** phone frame rate; roads stop at region borders and have no junctions or signs; the deck is not in `heightAt`; the look is judged by the admin's eyes.

## 2026-11-15 — Athree map PHASE 5b (sports car and sports bike with their own driving physics) built, default OFF

`vehicles.ts` (pure shapes and physics, plus `createVehicle` with three.js), emitted from `athreeVehicleSource.ts`; `world.surfaceAt`. **Shapes:** a car body is LOFTED (a stack of superellipse cross-sections whose width and height follow two profile curves, closed by fans, smooth normals computed here), a glass canopy, four tyres with spoked rims and dark wheel arches, lights; a bike is tubes plus a lofted tank; three detail tiers, each inside a tested triangle bound (phone 900, mid 1600, desktop 3200) and room for 8 vehicles at every tier. **Physics (arcade, with a real structure):** engine force that fades to nothing at the top speed (cubic), drag and rolling resistance, brakes limited by the surface (asphalt 1.15 g, rock 0.8, grass 0.62, sand 0.5, snow 0.32, water 0.1), steering lock that narrows with speed, yaw rate clamped by the friction circle, a velocity that carries on while the car turns so the tyres must bleed the sideways part (a handbrake turns the grip down: a slide), four wheel contacts sampled on `drivableHeightAt` (so a bridge deck carries the car), a spring-damper body that works on speed relative to the ground and pitches and rolls with it, flight off a crest, water that cuts the engine, a bike that leans INTO a turn while a car rolls a little out. Fixed 120 Hz steps whatever the frame rate. **Proof:** a pure-pursuit driver takes the car round the REAL race circuit (95 percent of the time within 7 m of the centre line, over a kilometre), across a REAL bridge on the deck with the river beneath, and a bike round the circuit; 51 new tests; 16 reversions each caught by the right test (two needed a stronger test first: steering narrowing hid behind the grip limit, the fixed step behind a clamp).
**Defects found while building, fixed:** `GRAVITY` exported by two modules (the strict typecheck of the emitted files caught it); a velocity rotated with the body so the car could never slide; drag so high the car topped out at 37 m/s; unused vertices had zero normals.
**NOT proven / ceilings:** phone frame rate; an arcade model, not a simulator; no collision with trees, other vehicles or bridge rails; paint has no reflections without `scene.environment`; the look is judged by the admin's eyes.

## 2026-11-15 — Athree map: MODULES CHOSEN AT RUN TIME (Q-2670, first part)

Admin: *"navbharatai ko module banana sikhao... user jo bole woh module user ki need ke anusar run time par bane"*. The map is now made of six optional modules that need nothing from each other — **sea** (water, ocean), **plants** (vegetation, plants), **rivers** (riverwater), **sky**, **roads** (roadmesh), **vehicles** — on top of an always-present core (noise, config, world, collider, chunks, and the pure rivers, dunes and roads data). To make that true the cross-module budget arithmetic (riverBudget, skyBudget, roadBudget, vehicleBudget) moved to `budget.ts`, written only when every module is; vehicles no longer import the sea's `GRAVITY`. `generateAthreeMap(include)` writes the core plus the files of the modules chosen; the INDEX, the example and the instructions are written for exactly those (no import, member, option or sentence for a module that is not there; a build without the sky tells the game to bring its own lights; a build without the sea keeps the terrain's flat sea plane so a map is never seen without water); unknown names are reported. `athreeModulesFor(prompt)` picks modules from the words a user types (English and Hinglish, whole words only: *carpet* is not *car*); no feature named means all. The tool takes `include`; the architect prompt tells the builder to pass only what the user asked for.
**Proof:** 55 module tests (16 subsets x written files, strict typecheck with the subset's own example, and a real run with three.js: world, map, ten frames, dispose) + 5 dispatcher tests + 1 catalogue test; 12 reversions each caught by the right test. **Defects found while building:** a build with only the sky left `r`, `hex` and `time` unused (the strict compile of the subset caught it).
**NOT built (same instruction, Q-2670 stays open):** 100+ map types, sizes from 1 km to 1000 km, humans, animals, birds, buildings, aircraft.

## 2026-11-15 — Q-2671 RESOLVED: the SimpleBuilder budget tests no longer read the wall clock

Admin: *"SimpleBuilder.test.ts ka ek test asli timer par tikka hai, load mein kabhi bigad sakta hai. Pahle isko theek karo, bina kuch bigade!"* **Root cause (reproduced):** "a slow PLAN shrinks the contract phase" gave the plan 380 ms inside a 400 ms share of a 1000 ms lane on REAL timers, i.e. 20 ms of slack; making the plan 410 ms reproduced the exact CI failure ("expected 0 to be greater than 0"), so a 30 ms timer delay on a loaded machine failed it. **Class:** a budget test that reads the wall clock. **Fix (tests only, production code untouched):** `onFakeClock` runs the build on vitest's fake clock (Date and every timer) advanced 10 ms at a time until it settles, so a "380 ms plan" takes exactly 380 ms whatever the machine is doing; "bails FAST on a slow PLAN" got the same treatment and now asserts the real property (it waited for the 40 ms plan cap and bailed on it, before the 400 ms plan call). **Found while doing it (a pre-existing gap):** putting the OLD independent 900 ms contract cap back changed NO test result, because a contract runs only if `contractCap > 0` AND `canAffordSharedContract` agrees and on that scenario the second says no whatever the first says. Two new WIRING tests run a COMPLEX lane (which skips the second check): a slow plan leaves the contract a sliver and it is cut; a fast plan leaves room and the contract reaches every file prompt. A third test stalls the real thread 250 ms inside every call (`Atomics.wait`: Date, performance and process.hrtime are all faked by vitest) and expects the same observable.
**Proof:** 3 reversions of `SimpleBuilder.ts` each caught (independent contract cap: the new wiring test; contract never runs: 4 tests; plan cap ignored: the bails-fast test); the whole file passes 3 of 3 under 12 busy loops on 4 cores. **Siblings hunted:** every other test in `src/server/AgentV3` that uses real timers either has a margin of an order of magnitude (a 40 ms budget against a 2000 ms ceiling) or depends on the ORDER of two timers, which load does not change; this was the only one with 5 percent slack.

## 2026-11-15 — THE OBJECT FORGE: NavBharatAI makes any object itself (Q-2672 open)

Admin: *"navbharatai koi bhi object/subject bana paye, aisa bana do!!"* and *"jo module library me na ho, NavBharatAI user ki maang ke anusar khud banaye aur game me jode"*. The library and the Athree modules are things already made; this is the other half. **What exists now:** the builder calls `run_recipe({ name: "author_object", input: { spec } })`. A spec is a JSON tree: ten primitives (box, sphere/ellipsoid, cylinder/cone, capsule, torus, lathe, loft, extrude, tube, plane), pivots, `mirror` (a reflected copy, clips reflected too, `mirrorPhase` for a walk), `repeat` (step or around), materials, animation clips. `src/server/lib/objectForge/`: `forgeEngineSource.ts` (the engine; written into the game as `src/game/forge/forge.ts` AND evaluated by the server, so there is no second implementation to drift), `forgeCheckSource.ts` (validate, measure, draw), `forgeRuntime.ts`, `ObjectForgeGenerator.ts` (kit recipe, guide, kill switch `AGENTV3_OBJECT_FORGE`, default ON), `forgeExamples.ts` (person, quadruped, house, tree, sword). **The loop that makes a model's blind spec good:** validation names the exact path and fix for each mistake (a bow-tie outline, a tube radius list of the wrong length, a repeat that stacks its copies); measurement reports triangles, size in metres, base height, centring, PARTS FLOATING FREE of the body, a clip that drives the object under the floor or blows it up; and the object is DRAWN back as FRONT / SIDE / TOP text silhouettes with one symbol per material, nearer surfaces over farther. The builder reads, fixes, calls again with the same id (the object file is replaced). **Verified in a real browser** (three 0.180 + chromium): all five examples render correctly and the person and animal walk with opposite-limb swing.
**Defects found and fixed while building it (each locked by a test proven by reversion):** wall winding of loft/tube/lathe/cylinder/pole fans (each reversion fails its shape's tests; the lathe rule was first masked by a volume test that is origin-dependent for an open wall, so a flared lathe far from the origin now pins it, and a watertight/consistent-edge check pins the pole fans); mirrored copies flipping winding (negative scale); repeat copies each rebuilding their own geometry; the top view drawing the face at the bottom while labelled top. 14 reversions of the engine, checker and dispatcher each fail the test that names them.
**Honest ceiling (stated to the user by the tool, the guide and the prompt):** stylised low-poly figures from primitives, not photoreal faces, clothing, fur or scanned models. **Open (Q-2672):** no live model has authored through it yet; humans/animals as a larger preset set, texture patterns, skinned meshes and collision shapes from a spec are not built.

## 2026-11-15 (later) — Object Forge: SELF-AUTHORING, and what the first local CI run found (4 sibling censuses)
Admin: *"asli insaan ya koi bhi cheez apne-aap bane, api call se"* / *"atma nirbhar banao"*. **Built:** `author_object({ describe: "a lighthouse with a spiral stair" })` — `forgeSelfAuthor.ts` asks a model for a spec (free router namespace, never Claude, never NavBharatAI money), runs the Forge on it, and when it comes back with errors or warnings hands the model THE FORGE'S OWN REPORT (the numbers and the FRONT/SIDE/TOP drawings, its previous spec) and asks for the corrected whole spec; up to 4 rounds; best result by `warningScore` (two detached groups are worse than one); the id is the Forge's, not the model's; a catalogue entry's real size and parts ride along as ground truth; the same description twice is one model call (bounded cache); a model that is down or talks nonsense writes NOTHING and points the builder at the spec route. 24 tests, 8 reversions each caught.
**The first local CI run was RED (4 tests of 51423) and every one was a sibling census I had not hunted:** (1) `toolWork.ts` did not classify `author_object` — a tool that writes files would have counted as "no work" for the plan-only-turn check → now in `PRODUCES_WORK_TOOLS`; (2) `aPromiseToTheUserHasAHandler` read my prompt sentence `say "stylised"` as an instruction to the user to type a phrase → reworded (class: a sentence that tells the user to say X); (3) `aRecipeExampleCompiles` requires every game recipe to carry a compiled code example → the Forge recipe now ships one, typechecked against the real `forge.ts`; (4) `gameKitHistoryCommand` copies the generator folders it bundles → now loops over `athreeMap` and `objectForge`. Also `scripts/gameKitHistory.mjs` lists the new generator.
**NOT built, honestly:** photoreal humans and scanned or sculpted models need a text-to-3D mesh service (real cost per object, 30–120 s, a mesh to host and license; declined by the admin on 2026-09-14 in `objectSpecProvider.ts`; no provider key is set). Recommendation: first see what self-authoring produces in a real build; if stylised is not enough, the admin decides the key and the cost, and an adapter goes behind the key with an honest "not available" while it is unset. A complete game MODULE is code the builder already writes; the Forge covers 3D objects only.
**Second local CI run: RED on a 5th sibling census (1 of 51446).** `tests/boundedCaches.test.ts` found a raw module-level `Map` in `forgeSelfAuthor.ts` (bounded by hand-written eviction): class = per-instance state that must be a `BoundedCache`. Now one, and the census passes. No other raw module-level Map/Set was added by the Forge.

## 2026-11-15 (later still) — THE AUTO-CUSTOMISER: the user's words change the object
Admin: *"auto customiser banao — user ke bas bolte bhar se jo chahe edit ho jaye."* `author_object({ customise: "dress ka rang neela, baal bade, thoda lamba", target: "<id>" })`. `forgeCustomise.ts`: (1) a parser for English, Hinglish and Hindi script (colours with their inflections and dark/light, roles dress/hair/shoes/skin/clothes/pants/eyes/hat, sizes, gender, hair length, wearing a dress, a named part of the object) that RETURNS what it could not read; (2) `applyEdits`: a recolour edits a material, or splits one off for a single named part so the door does not repaint every wooden thing; a scale wraps the object once with its base on the ground; (3) the PERSON is regenerated from parameters (`personSpecFor`: gender, hair length, dress, height, build, six colours), so a later edit keeps the earlier ones; (4) anything an object has no part for is reported CANNOT-be-done with the materials it does have, never skipped; (5) a new kit file `src/game/forge/customise.ts` (`customiseModel`) recolours a LOADED model by material name or role and scales it, leaves a textured material (a face photo) alone and says so, and clones materials per instance. **Honest limit, stated in the tool result and the prompt:** a loaded model keeps its shape — hair length, gender, face and body of the #4218 humans cannot change by words; that needs another model or the Forge person (stylised).
**Defects the tests found in my own first draft:** inflected colour words were missing ("kaale", "neele", "hare"…); "dress pehna do" has to be a wish while "dress ka rang" is a colour; a hair length is not a triangle count (a capsule has the same triangles however long) so the test measures the lowest point instead. Three guards were unproven until a test was written for them (a shared material split, bare legs under a dress, writing nothing when nothing changed); 14 reversions each fail the test that names them.


## 2026-11-15 — Autopsy 57604006 (4-build battle-royale session on the build that ships edit promotion)
Ledger in `BUILD_REPORT_QUEUE.md` Q-2690…Q-2701. Tally: 4 builds, 3 ok + 1 failed (ENGINE_UNAVAILABLE); 3 yellow gates (game never played), 1 red. Self-healed 15 (8+4+3+0 autoResolved) · workarounds 84 (45+5 ENGINE_R1/GLM fallbacks in build 0, 32 in build 3) · ❌ shipped imperfect: the ⚙ button covered (build 2), the brief never recorded (all four) · 🥵 struggles: Surplus glm-5.3 failing twice, 8 stale edit_file calls, a 22-minute edit.
**Fixed in this change (from the report's own facts):** the brief chosen by content (my own defect in #4208); a failed build can no longer become the verified version; one verdict about whether the app rendered; Router One refusals by our own accounting are named and retired. Everything else is a queue row with its state.
## 2026-11-15 (evening) — ATHREE MAP KINDS AND SIZES: 12 kinds x 10 sizes = 120 maps, 1 km to 1000 km
Admin: *"100+ type ke maps (1 km se 1000 km)"* — as a SPACE, not 100 hand-written presets. **How:** `createAthreeWorld` now treats any size as the reference world stretched (`k = reference / size`; ground and water widths stretch with the plan, heights by k^-0.75 so a map 100 times narrower has slopes 3 times steeper, not 30). Rivers are traced once in the reference world and converted to the game's metres (points, widths, levels, lakes); dunes likewise; roads work in game space. A KIND of land is five numbers (`relief`, `seaShift`, `aridity`, `warmth`, `rivers`) the world already used internally: `athreeMapKinds.ts` holds 12 and reads a user's words (English, Hinglish, Devanagari). `generate_athree_map` takes `archetype` and `size_km`; the choice becomes `MAP_OPTIONS` in the project's `config.ts`.
**Proof (the real emitted code):** a default-size neutral world is byte-for-byte the old one (heights, biomes, river count); the stretched ground equals the reference ground at (x*k, z*k) times k^-0.75; every size 1 to 1000 km is finite, its loop closes, a player can be put on dry land; at every size every river point is in water, below its surface, with matching width and level; roads exist only from 20 km; each kind IS what it says (desert dunes and no forest, jungle forest and rivers, tundra snow, archipelago sea, plains lower than alpine...). 17 reversions each caught.
**Defects found by those tests and fixed at the root:** the spawn height rule (4 m) rejected ALL land on a map stretched flat; the spawn search (20 km from the origin) found no land on a continent 1000 km wide whose origin was sea; tundra had snow only on mountains (a frozen map must be white at sea level); Devanagari "किमी" and the phrase "bahut bada" were not read; "snowy mountains" was read as tundra. A guard on the water width at a point had no test until the proof loop found it.
**Honest limits:** 1 to 5 km maps have no roads and no runway (a road region is 12.5 km); a map of 250 km and up is mostly empty land; the kinds differ by numbers, not by a different terrain algorithm (no canyons or volcanoes yet).


## 2026-11-15 — BR1978 autopsy ("Build one game", succeeded, charged ₹5.55): lock three closures against an empty-sandbox game build

Owner t311u sequential audit, BR1978 only (boundary 1951..2105 frozen). Branched from origin/main `55dcc3e20` (#4229); BR1977 (#4170) is merged. Under SANDBOX_UNAVAILABLE the workspace was empty, yet GAME_KIT_SEEDED claimed three recipes with 0 files and told the builder the kit was on disk; the builder rebuilt the Vite project by hand and WRITE_TIME_TYPECHECK stayed off for 20 TS writes although it had written tsconfig.json. The result was a real playable "Color Rush" DOM game (explore passed, phone OK, YELLOW gate). Ledger: [autopsy](docs/build-report-autopsy-BR1978.md), [evidence](docs/build-report-autopsy-BR1978-evidence.json).
- All three defects are already closed on main (BR1958 #4132 seed preflight, BR1977 #4170 empty-seed downgrade, BR1951 tsconfig re-arm). This PR ships no production change; `tests/br1978Autopsy.test.ts` locks each against this report's exact shape with two-sided neighbours.
- "Build one game" is still buildable / explicit-order on main; making it ask is an admin product decision. Q-2653 and Q-2654 gain this evidence and stay open.

Queue: this commit closes no row and opens no row. Q-2649..Q-2654 and earlier blockers stay open.

## 2026-11-15 — BR1979 autopsy ("ake app banane jisse free mein I video Bani", succeeded, charged ₹5.15): strip a dangling tsconfig.node.json reference so the fast lane can finish

Owner t311u sequential audit, BR1979 only (boundary 1951..2105 frozen). Branched from origin/main `08a37a81c` (#4231); BR1978 (#4230) is merged. Ordinary-merged origin/main `dafaf4061` (#4233), then later `a79cb1861` (#4237, also bringing #4235 and #4232), no rebase, no force. Under SANDBOX_UNAVAILABLE the workspace was empty; the fast lane still ran, refused 6 of 13 writes, and failed verify with TS6053 because the generated tsconfig.json referenced `./tsconfig.node.json` and that file was never written. The full builder finished a working Free Video Maker (YELLOW gate: the headless preview has no camera). Ledger: [autopsy](docs/build-report-autopsy-BR1979.md), [evidence](docs/build-report-autopsy-BR1979-evidence.json).
- D1 (retry-goodbye) and D2 (fast lane against a failed setup) are already closed on main (BR1961 F2 #4146, BR1952 #4124). `tests/br1979Autopsy.test.ts` locks each against this report's exact shape.
- D3 is new: `sanitizeTsconfigReferences` drops only a missing `tsconfig.node.json` project reference when the tsconfig already has `include`/`files`. Wired before the fast lane writes and verifies, again before tsc, and on preview restore. Vite 5 solution-style configs and a present sibling are left alone.

Queue: this commit closes no row and opens no row. Q-2621 gains this report's evidence and stays open. Q-2649..Q-2654 and earlier blockers stay open.
## 2026-11-15 (night) — ROCK-SOLID pass on the map kinds and sizes (what a sweep found that the examples did not)
Admin: *"isi ko aur improvement karo aur rocksolid karo."* A sweep of every kind at free sizes and seeds, measuring the steepest 10 m slope, found WALLS: alpine reached slope 5.0 (79 degrees) at 1 to 19 km, continental 3.3 at 5 km, even the 100 km alpine 2.7 (the reference world's own steepest ridge is 1.3). **Root cause:** a map stretched narrower had its heights shrunk by k^-0.75 but its lengths by k, so slopes grew by k^0.25 (3.2x at 1 km); and my `alpine` relief of 1.8 was too steep at any size. **Fixed:** `heightStretch(k)` (k^-0.9 on a smaller map, k^-0.75 on a bigger one) so slopes never grow more than 1.7x (a property test over every size), alpine relief 1.3. **Also fixed:** an invalid `mode` (`'sphere'`) produced a world with no ground (now only loop or bounded); every size and style number is held inside the range the terrain is tested for (a NaN, a negative, an Infinity, a text, 1e12, a relief of 50 can no longer make a hole or a wall) and style values past the edge share ONE river-cache entry (so a loop of odd numbers cannot evict legitimate worlds).
**New tests:** 15 hostile option cases; 112 random kind x size x seed worlds (finite, loop closes, steepest slope under 2.6, a player can start, dry, above sea); road edges at 20/21/25 km and 6/7/8 km islands; a bigger map is not slower to ask; the dispatcher path (words choose the map, the builder's archetype and size_km win, a bad kind is refused with the real list, a size past the range is held) which had NO test before. 21 reversions each caught (one guard, the river clamp, had no test until the proof loop found it).

## 2026-11-16 — ANY SUBJECT FROM DATA ONLY: spinning wheels, subject-aware help, train / car / bike, and an engine naming bug
Admin: *"pura code AI ko nahi bhejna — user ko jo subject/object chahiye (train, tree, car, bike, animal...) bas woh api call se bana ke"* — and my own `author_module` plan (an AI writing code that the server would run) was dropped: node's vm is not a security wall (a constructor chain reaches process, and a Cloud Run server can read its own metadata token), so **no program written by an AI is run anywhere**. The Forge already works from DATA: the model returns a spec, the validator names every fault, and the Forge's own engine builds it. This pass makes that good for ANY subject. **(1) `spin: true`** on a rotation turns for ever (wheels, propellers, fans, windmills; a swing could not); mirrored it rolls the same way about the axle. **(2) Subjects** (`forgeSubjects.ts`): 11 kinds (rail, road, bike, air, water, animal, bird, plant, building, person, prop) read from English and Hinglish; the model's first prompt carries the worked example CLOSEST to the subject and a checklist of what that kind must have (sizes in metres, wheels on the ground, legs under the body...). **(3) Examples train, car, bike** (wheels roll; the carriage is built once and repeated), rendered in a real browser. **(4) An engine defect the new examples exposed:** a repeat inside a repeated parent gave two nodes the same name (`window_1`), so a node map would silently lose one; the validator caught it. Children now inherit a "p"-tagged context from a repeated parent (`window_1p`) and a mirror adds nothing, so `knee_mirror` is still `knee_mirror`. Geometry is now shared by SHAPE, so a longer train costs no more shapes. **(5)** The checker also caught MY train: the second carriage floated 0.5 m from the first (no coupler); fixed in the example. 11 reversions each caught.
**Not built (agreed next):** BEHAVIOUR as data (a train that follows rails, an animal that wanders, a car that drives) from a small set of fixed behaviours in the kit whose parameters the model gives as data; air and water have a checklist but no worked example yet.

## 2026-11-16 (later) — BEHAVIOUR AS DATA: a train follows its rails, an animal wanders, a car is driven, a plane circles — and no movement code is ever generated
The remaining item from the subjects pass. A spec may carry `behaviour`, one of FIVE fixed movements the kit runs (`src/game/forge/behave.ts`, written once by us and tested) with numbers the spec gives: **rails** (a polyline, a speed, loop or stop at the end: a train, a guard), **wander** (a circle, a speed, pauses, a seed: an animal, a villager), **drive** (a top speed, the player's throttle and steer: a car, a bike, a boat; the wheels roll at v / 2 pi r times the clip's own spin), **orbit** (radius, altitude, speed, bank: a plane, a bird) and **static**. A model picks one and sets numbers; the validator bounds every number and requires every clip it names to exist on the object. `mover.update(dt)` moves the object AND advances its animation (one call a frame); `heightAt` lays the object on the world and tilts it with the slope. New worked examples **plane** (a propeller that spins, swept wings from an extruded outline, landing gear; it circles) and **boat** (keel at y = 0, hull loft, mast and sail; driven), and every earlier example now carries its behaviour. The object file gains `behaveX(obj, options)`.
**Defects my own tests found in the first draft (fixed at the root, each locked):** a wanderer whose pause is [0, 0] never picked a first target and stood still for ever; a fast wanderer could step out of its circle (a large step taken a little off the line), so the place it arrives at is now held to the circle; the clip of a driven vehicle was restarted every frame in a draft path, which would have frozen the wheels at their first pose. 23 reversions each caught (two guards that no test could tell from their absence were removed or given a test: the redundant first pick, and the overshoot onto a target).
**Honest limits:** a rigid train cuts a tight curve (a 30 m train round a 60 m radius is fine, round 10 m it is not); a drive behaviour is arcade, not physics (the Athree vehicles have the real model); wander has no obstacle avoidance; air and water examples are single craft.


## 2026-11-16 — BR1980 autopsy (indoor exploration game, succeeded, free / not charged): lock three closures against an empty-sandbox specified game

Owner t311u sequential audit, BR1980 only (boundary 1951..2105 frozen). Branched from origin/main `b72071ca3` (#4241); BR1979 is merged. Under SANDBOX_UNAVAILABLE (E2B cap of 20, during the same cap incident as BR1978) the workspace was empty, yet GAME_KIT_SEEDED claimed three recipes with 0 files in 17.9 s and FAST_LANE_SKIPPED_GAME told the builder the kit was on disk; the builder rebuilt the Vite project by hand and WRITE_TIME_TYPECHECK stayed off for 34 TS writes although tsconfig.json had already been written. The result was a working indoor exploration game (READY 84/100 after the 80-step cap, explore passed, phone OK, YELLOW gate for leftover dependency vulnerabilities, 21.0 min / 2.1× the ETA midpoint). Ledger: [autopsy](docs/build-report-autopsy-BR1980.md), [evidence](docs/build-report-autopsy-BR1980-evidence.json).
- All three defects are already closed on main (BR1958 #4132 seed preflight, BR1961 F2 #4146 goodbye, BR1977 #4170 empty-seed downgrade, BR1951 tsconfig re-arm). This PR ships no production change; `tests/br1980Autopsy.test.ts` locks each against this report's exact shape with two-sided neighbours.
- Q-1068's "repeat after hand-back" trigger fired on this Weak/Surplus report (1 of 2 plan-only turns). A generation-behavior change is not shipped: Q-2375 still needs a full transcript, and a forced productive write would be a new problem (t311u).

Queue: this commit closes no row and opens no row. Q-2621, Q-1068, Q-2375 and Q-2414 gain this report's evidence and stay open. Q-2649..Q-2654, Q-2662..Q-2672 and earlier blockers stay open.

## 2026-11-16 — BR1981 autopsy (attachment-specified study/quiz app, failed, free / not charged): do not call a zero-file fast-lane pass a success

Owner t311u sequential audit, BR1981 only (boundary 1951..2105 frozen). Branched from origin/main `af1379506` (BR1980 ledger privacy cleanup). Under SANDBOX_UNAVAILABLE (E2B cap of 20) the workspace listed 0 paths, yet the text-only fast lane still planned and generated for about 3 minutes (14 Surplus calls). Progress ticks claimed files were built; every write was then refused ("could not read the existing file safely — not overwriting it"); the lane logged "Built your app — 0 file(s)" and recorded SIMPLE_BUILD_SUCCESS. A type-check note said the files were being shipped unverified. The free-tier path invited credits for a stronger engine. The sandbox never recovered. 0 files landed; the user was not charged. Ledger: [autopsy](docs/build-report-autopsy-BR1981.md), [evidence](docs/build-report-autopsy-BR1981-evidence.json).
- D1–D4 are already closed on main (BR1952 #4124 fast-lane skip, BR1961 F2 #4146 goodbye, BR1952 upsell gate, "Generated … — not saved yet"). `tests/br1981Autopsy.test.ts` locks each against this report's shape.
- D5 is new: a plan with no App.tsx / app/page can have every write refused and still return ok:true, because `unwrittenEntries` only watches those roots. `runSimpleBuild` now returns ok:false (`nothing_landed`) when no file landed, before the success log, verify, or preview. A plan that did land files is unchanged. The write-refusal guard itself is not loosened (t311u). Neighbour tests lock the App.tsx root hand-off (not `nothing_landed`), a one-file landing, and `unwrittenEntries` still ignoring `index.html`. The OneShot sibling was already closed (Q-982) and is locked in the same file.

Queue: this commit closes no row and opens no row. Q-2621 gains this report's evidence and stays open. Q-2649..Q-2654, Q-2662..Q-2672 and earlier blockers stay open.

## 2026-11-16 — BR1982 autopsy (weather-app request, succeeded, charged a small free-tier amount): refuse leftover apply-patch markup and restore a missing JSX flag

Owner t311u sequential audit, BR1982 only (boundary 1951..2105 frozen). Branched from origin/main `faec01267` (BR1981 zero-file fast-lane success guard). Setup hit the E2B concurrent-sandbox cap of 20; the sandbox later served the build. The text-only fast lane still ran. A generated TypeScript file with leftover apply-patch markup was correctly refused (`Unexpected "<<"`). The same class landed in `tsconfig.json` because that file is treated as JSONC and skipped by the syntax gate. Fast-lane verify had already failed TS6053 on a dangling `tsconfig.node.json` reference. The full builder then hit TS17004 because the model-written tsconfig had a DOM lib but no jsx flag. The app eventually rendered and a journey passed; release gate YELLOW for remaining dependency advisories that need a major upgrade. Duration about 16 min (2.8× the ETA midpoint). Ledger: [autopsy](docs/build-report-autopsy-BR1982.md), [evidence](docs/build-report-autopsy-BR1982-evidence.json).
- D1–D4 are already closed on main (BR1952 #4124 fast-lane skip, BR1961 F2 #4146 goodbye, BR1979 #4241 dangling tsconfig reference, write-time syntax gate for TypeScript). `tests/br1982Autopsy.test.ts` locks each against this report's shape.
- D5 is new: leftover apply-patch / merge markers are refused on a clean write of config files the syntax gate skips (tsconfig, `*.json`, `*.jsonc`), and a parseable tsconfig whose only fault is a trailing marker block is salvaged. JS/TS that still parses, Markdown, and `.diff`/`.patch` are not refused (narrowed after the t311u review below).
- D6 is new: a clearly-React DOM/app tsconfig missing a jsx flag gains `"jsx": "react-jsx"` by insertion (comments kept). Next / Vue / Solid / Preact / `extends` / any `jsxImportSource` are left alone (narrowed after the t311u review below).

Queue: this commit closes no row and opens no row. Q-2621, Q-2362 and Q-2367 gain this report's evidence and stay open. Q-2649..Q-2654, Q-2662..Q-2672 and earlier blockers stay open.

## 2026-11-16 — BR1982 t311u review: narrow the conflict-marker guard and the jsx heal

Independent review of PR #4250 (`14193bac6`) failed under t311u. The conflict-marker guard had refused legitimate README fences, a clean-parsing TypeScript template literal with markers at column 0, and `.diff`/`.patch` files; after salvage it now refuses only config-like files the syntax gate skips (tsconfig, `*.json`, `*.jsonc`). The jsx heal had rewritten Next / Vue / Solid / Preact / `extends` tsconfigs and dropped JSONC comments via `JSON.stringify`; it now inserts `"jsx": "react-jsx"` only when the app is clearly React, and leaves comments alone so `ensureTsconfigBaseUrl`'s commented-tsconfig contract stays intact. Salvage was judged sound and is unchanged. Ordinary commits on `fix/br1982-autopsy` (no rebase or force-push). Ledger: [autopsy](docs/build-report-autopsy-BR1982.md), [evidence](docs/build-report-autopsy-BR1982-evidence.json). Not merged; BR1983 was not started.

## 2026-11-16 — BR1983 autopsy (short follow-up on an existing app, failed, not charged): a proven cap during reconnect must not abort as an unsafe reconnect

Owner t311u sequential audit, BR1983 only (boundary 1951..2105 frozen). Branched from origin/main `0fade3ca0` (BR1982 leftover apply-patch markup / missing JSX flag). Setup ended in under a second with SANDBOX_RECOVERY_UNAVAILABLE and a goodbye that invited a retry. The retained report has no vendor detail, so this ledger does not claim the E2B cap for this report. A proven concurrent-cap refusal during resume/reconnect was nevertheless wrapped as that generic refusal, so the build never took the create-time SANDBOX_UNAVAILABLE path (F2 notice; the tool-capable builder can wait for a slot). This PR unwraps only the exact cap message, still never replaces the recorded machine, and records an admin-only reason on remaining recovery refusals. Auto-retry and raising the cap are not shipped (Q-2621 stays blocked on ops). Ledger: [autopsy](docs/build-report-autopsy-BR1983.md), [evidence](docs/build-report-autopsy-BR1983-evidence.json).




## 2026-11-16 — BR1984 autopsy (subsequent request on an existing app, failed, not charged): a second reconnect refusal must not invite an immediate retry

Owner t311u sequential audit, BR1984 only (boundary 1951..2105 frozen). Branched from origin/main `23e11c2f3` (BR1983 proven reconnect capacity refusal). Setup ended in under a second with SANDBOX_RECOVERY_UNAVAILABLE, shortly after a previous attempt on the same app had already ended with a goodbye that invited a retry. The retained report has no vendor detail, so this ledger does not claim the E2B cap for this report. The opening estimate was shown before the workspace was proved reachable. This PR changes only a second consecutive settled reconnect refusal (no immediate-retry invite, not retryable) and withholds that estimate until the workspace is up. The first refusal, the BR1983 cap unwrap, and the admin-only reason paths are unchanged and locked with tests. Auto-retry and raising the cap are not shipped (Q-2621 stays blocked on ops). Ledger: [autopsy](docs/build-report-autopsy-BR1984.md), [evidence](docs/build-report-autopsy-BR1984-evidence.json). Hosted CI on the first head failed three existing ETA wiring guards that still expected the route to always record "Shown to the user" and to emit the line immediately; those guards now pin openingEtaShownNote and the same etaShown binding, including the module-turn skip.



## 2026-11-16 — BR1985 autopsy (new large game request, stopped by the user, not charged): do not treat Hindi "log" (people) as a fintech audit log

Owner t311u sequential audit, BR1985 only (boundary 1951..2105 frozen). Branched from origin/main `60a6d0ede` (BR1984 second reconnect refusal). Requirement analysis named domain=fintech and asked KYC / 2FA questions for a game, because a bare `/log/` audit-log feature matched Hindi "log" (people) and beat a zero-scoring game domain. The user stopped before any app file was written and was not charged. This PR tightens audit-log features and strips Hindi people-log constructions; that alone restores the original class, because the request's own game headlines already outnumber a single bank headline once the false score is gone. A game-as-product tie-break was drafted, then removed after independent review of #4255 (t311u): its Hindi `chahiye` / `mujhe` branches, and a narrow English stand-down, classified bank, gym, school, education, and some real-money requests as games and dropped KYC guidance. Mixed or ambiguous ties stay on the earlier-domain behaviour, locked with Hindi and English neighbour tests. Independently written paraphrases replaced any shortened extracts of the customer request. The BR1952 binary-generation hand-off, the BR1981 unsaved-progress wording, the BR1958 first-call window mismatch, and the BR1983 admin-only reason paths are unchanged and locked with tests. Preferring a game over a higher fintech feature score (a tycoon-style game that names a ledger) is not shipped (Q-2702). An explicit Spring Boot account pick is not overridden. Ledger: [autopsy](docs/build-report-autopsy-BR1985.md), [evidence](docs/build-report-autopsy-BR1985-evidence.json).


## 2026-11-16 — BR1986 autopsy (first reconnect refusal on a phone-comfort follow-up, not charged): do not score a setup failure as an early delivery, and do not treat "the whole app" as a new complete product

Owner t311u sequential audit, BR1986 only (boundary 1951..2105 frozen). Branched from origin/main `ea4ba07c6` (BR1985 Hindi "log" / audit-log tightening). Setup ended in a little over a second with SANDBOX_RECOVERY_UNAVAILABLE on a first refusal (no prior failed builds). The retained report has no vendor detail, so this ledger does not claim the E2B cap for this report. The user was shown a several-minute estimate, and the serialized report scored the one-second setup failure as UNDER the band. This PR marks sandbox and engine infrastructure outcomes untested inside the promised band (the same over-band lower-bound miss already used for aborts). It also stops `isExplicitCompleteBuild` from treating a definite bare phrase ("the whole app") as a request for a new complete product, so an existing-app edit downgrade is not blocked when durable files are present. Independently written English and Hindi paraphrases, and opposite-class new-product neighbours, lock both sides. The first-refusal goodbye, the pre-setup estimate on a first attempt, the BR1958 first-call window mismatch, and the BR1983 admin-only reason paths are unchanged and locked with tests. Auto-retry, raising the cap, and holding the estimate until setup on every first attempt are not shipped (Q-2621 stays blocked on ops). Ledger: [autopsy](docs/build-report-autopsy-BR1986.md), [evidence](docs/build-report-autopsy-BR1986-evidence.json).

## 2026-11-16 — BR1987 autopsy (battle-royale style map game in a Spring Boot workspace, failed, not charged): do not run the Node toolchain on a Spring Boot or other non-Node app

Owner t311u sequential audit, BR1987 only (boundary 1951..2105 frozen). Branched from origin/main `f5ed48ddc` (BR1986 setup-failure scoring / complete-build matcher). A battle-royale style map game with a login screen and a world map was built into a Spring Boot workspace that held only the starter POM and Java files, with no package.json. The fast lane ran npm install and npm run dev, then probed the Vite port. The install failed because there was no package.json, the release gate counted that as a defect of the app, and a success verdict was flipped to not ok. The user was not charged, and markup was waived because a preview never came up. This PR starts Spring Boot or Go from the registry command when the start file is present, skips npm on a tree with no package.json, does not count a missing-manifest npm failure or a missing Maven or Go binary as an app blocker, skips sandbox typecheck on a non-Node tree, and drops an unterminated binary tail instead of continuing it as text. A Node app with package.json, Flask's port, and a bare HTML skip are unchanged. The framework pick is not auto-switched. A bare HTML page is still not statically served (Q-2662 stays blocked). Ledger: [autopsy](docs/build-report-autopsy-BR1987.md), [evidence](docs/build-report-autopsy-BR1987-evidence.json).

## 2026-11-16 — BR1987 review: keep main's Node port, and keep a missing JS manifest as a shipping defect

Independent review of the BR1987 launch plan (t311u). `oneShotDevPort` no longer falls through to the registry, so a Spring Boot or Go app that has a package.json keeps main's Node port (5173), not 8080. npm is skipped only when the tree is clearly a non-Node app (declared Spring Boot or Go, its start file, no JS/TS app source). A Vite tree with `src/App.tsx` and no package.json keeps main's npm install, typecheck, RED gate, and ₹0 bill. The shipping exclusion checks the tree, not just the error text, so a nested `frontend/package.json` is not ignored. Platform preview still skips a no-package.json page that is not clearly non-Node (Q-2662). Ledger and evidence updated in place.

## 2026-11-16 — BR1988 autopsy (invoice-style form app, user-stopped, files saved, not debited): do not treat missing styles on an unfinished Stop as a leftover app defect

Owner t311u sequential audit, BR1988 only (boundary 1951..2105 frozen). Branched from origin/main `f7040b78b` (BR1987 non-Node launch plan). A one-shot form app was mid-generation on the Weak Surplus path when the user stopped it. The files written so far were saved, the app was never judged finished, markup was waived, and the wallet was not debited. The post-answer integrity pass still recorded `CSS_CLASSES_UNDEFINED` as an unresolved app warning and opened it in the issue queue, even though the CSS heal correctly did not run after the abort. This PR records that mismatch as info only for the user's own Stop mid-generation on a fresh build (exact conditions in the review entry below), and keeps main's Universal Remote warning in every other case. The heal gate is unchanged. Surplus streamed usage (`USAGE_NOT_REPORTED`) stays Q-2414. Ledger: [autopsy](docs/build-report-autopsy-BR1988.md), [evidence](docs/build-report-autopsy-BR1988-evidence.json).

## 2026-11-16 — BR1988 review: only the user's own Stop, mid-generation on a fresh build, is an unfinished tree

Independent review FAIL on the first BR1988 version (t311u): it keyed on `abort.signal.aborted` and a missing `readyAt`, so engine aborts would have been worded as a user stop and edit / module turns (where `readyAt` is never set) would have lost a real warning. Now the info line needs the typed cause `user-stop`, the runner's own `userStoppedBeforeReady` mark (set only in its aborted ending, with the done signal on, not an edit, not a module turn, and no ready mark), `ok === false`, no `readyAt`, and a fresh build. Everything else writes main's warning with main's own fields; any fault falls back to main. Heal gate and billing unchanged. Design-consistency findings on a stopped tree are left as they are. Ledger and evidence corrected in place.

## 2026-11-16 — Surplus: the one-call-at-a-time limit is removed (owner: "ek bar me ek call wali limit hatao, 100+ call ek saath")

Two serial points were found in code. The earlier claim that Surplus was "globally serial across builds" was stale: the cross-build lock had already been lifted for the live pilot on 2026-10-25.
1. **Inside a build** (`buildSession.ts`), the two promise queues (`queue`, `turnQueue`) serialized every model call and every turn of all the build's agents. They are now a Stop-aware FIFO slot pool, `createSurplusSlots`, capped by `SURPLUS_PARALLEL_CALLS_PER_BUILD` (default 128, max 1024; `1` = the old order).
2. **Across builds** (`receiptStore.ts`), every live call read and rewrote the ONE shared `surplus_pilot_admissions` document twice: once at reservation, once at settlement. Firestore sustains about one write per second per document, so this was the scale ceiling. Its limits also protected nothing: the budget is effectively unlimited, and the 1,000,000-call cap would have turned Surplus off for good. Live calls now touch only their own receipt document (`authorityId` stamped on it). Replay refusal, the pending/unknown state, the exact cost and the quarantine reason all stay per receipt. A live receipt reserved before this change still settles through the pilot document. Reviewed pilots are unchanged.

Tests (all proven by reversion):
- `surplusSlots.test.ts`: limit, FIFO, double release, Stop in line, 150 callers on 128 slots.
- `buildSession.test.ts`: 120 parallel turns, and the env bound plus `1`.
- `livePilotUnjam.test.ts`: 150 concurrent reserve+settle with zero pilot-document I/O, the 1M cap, replay/unknown/absorb on a live receipt, and a pre-change live receipt.

Not proven: Surplus's own per-key concurrency limit. That needs the owner's live test.
## 2026-11-16 — BR1989 autopsy (small learning-themed app, succeeded): a short file header dropped a component, and an added helper file sat beside a same-named folder

Owner t311u sequential audit, BR1989 only (boundary 1951..2105 frozen). Branched from origin/main `eef10a4a3` (BR1988). The Weak Surplus fast lane built the app and it rendered, but two avoidable defects cost a repair round and shipped a duplicate file. (1) A per-file answer used `<<<FILE path>>` and the parser only knew `>>>`, so a paid-for component was silently dropped. The header now accepts `>{1,3}` through one shared definition (`FILE_HEADER_CLOSE`, `fileHeaderPath`) used by the parser and every FastLaneContinuation header reader, so a truncated file behind a short header is still treated as cut off. (2) With no planned helper owner, the lane added `src/utils.ts` beside a planned `src/utils/` folder; a module in the folder imported `./utils` and the repair shipped a duplicate `src/utils/utils.ts`. An added helper home now goes inside such a folder (`src/utils/helpers.ts`); every other case keeps main's path, and the constants home is unchanged. The binary placeholder and the package.json fold were already closed by BR1952 (#4124). Contract-beside-types-folder, ETA calibration and the embedded icon question are recorded as unchanged candidates. Evidence: `docs/build-report-autopsy-BR1989.md`, `tests/br1989Autopsy.test.ts`. Not live until a Console Run.

## 2026-11-16 — BR1989 review: a short file header is accepted only as a real header line

Independent review FAIL on D1 (t311u); D2 passed. The first version widened the header to `>{1,3}` anywhere, so prose, Markdown and template-literal lines (`<<<FILE src/a.tsx> // …`, `<<<FILE path>`, `<<<FILE ${p}>`) became phantom files main ignored, which the one-shot lane and the repairs could write. Now `normalizeShortFileHeaders` rewrites a one- or two-bracket header to `>>>` only at a line start, with nothing but whitespace after the brackets, and a path with no whitespace or `< > $ { }` that has a slash or an extension. Every other byte is untouched; the parser and every FastLaneContinuation reader keep main's own `>>>` patterns, so `>>>` behaviour (including `>>>>`) is exactly main's. The reviewer's four inputs and twelve main spellings are pinned against a verbatim copy of main's parser on the one-shot, truncation and per-file paths.

## 2026-11-16 — BR1990 autopsy (simple calling-style app, succeeded with type errors left): a folded component's code was saved under its host file's path

Owner t311u sequential audit, BR1990 only (boundary 1951..2105 frozen). Branched from origin/main `a04d026ba` (BR1989). The budget fold told one planned file to also include a folded component; that file's per-file call answered with only the folded component's block, and the first-block fallback in `pickGeneratedFile` saved it under the host's path (refused here because the host was a binary asset; with a JS host it would compile and render the wrong component). Now, only when a fold happened and the reply has no block for the asked-for path, a first block naming a folded path is refused like an empty reply; every other reply keeps main's selection exactly (a draft that also refused other planned files was withdrawn after `tests/fastLaneWaste.test.ts` showed the side effect). The binary fold host and planned binary asset were already closed by BR1952 (#4124); the fast lane against an unavailable workspace and the user notice by BR1961 (#4146). Q-2621 (sandbox cap) gains evidence and stays blocked. Remaining type errors after the full builder's repair are not established from the retained report. Evidence: `docs/build-report-autopsy-BR1990.md`, `tests/br1990Autopsy.test.ts`. Not live until a Console Run.

## 2026-11-16 — BR1990 review: a usable host reply under the folded header is kept

Independent review FAIL on the first BR1990 version (t311u): refusing every folded-header first block also dropped a usable but mislabelled host reply (the host's component plus the folded one under the folded header), which main saves correctly; the host went missing and a paid repair followed. Now the refusal applies only when the content does not declare or export the host's own name (`hostComponentName`, `declaresName`); a combined reply, and any host whose name cannot be derived, keep main's fallback. Pinned by kept/refused neighbour tables, a real lane run with a combined reply, and the reviewer's probe.

## 2026-11-16 — BR1990 second review: fail-safe inversion of the folded-header refusal

Second independent review FAIL (t311u): the host-name check still refused usable combined replies (lowercase `header.tsx` declaring `Header`, `.ts` utility and types hosts, a camelCase export from a kebab file, an anonymous default export). Replaced it with the reviewer's option (b): `pickGeneratedFile` refuses a folded-header first block only when `looksLikeOnlyFile` positively reads the content as the folded file alone (its own name declared or exported, no other top-level declaration or export); anything unclear keeps main's fallback. Host-name derivation removed. Pinned by 16 kept / 7 refused shape tables, unit cases, a real lane run, both reviewer probes and mutation checks.

## 2026-11-16 — Discount reseller gateways: Moyi API, DiscountedTokens and MirAPI in the admin Test Chat Bot

Owner asked for the three gateways in Admin → AI Engines → Test Chat Bot, and also on `z@gmail.com`'s Pro builder.

**Done (admin Test Chat Bot only):** `src/server/lib/resellerGateways.ts` owns each gateway's key, endpoint and model.
A base URL is accepted only on the provider's own registered domain. DiscountedTokens uses its published
`https://discountedtokens.com/v1` and `gpt-6-sol`; Moyi uses `https://api.moyi-api.com/v1` (shown on its home page, owner's
screenshot); MirAPI has no default endpoint because its could not be read, so the owner sets `MIRAPI_BASE_URL`. One streamed call, no retry,
reserved at the dearest official list price (USD 10 / 50 per 1M). Each is a switch-board family and an API-providers row.
Env names and the known risks are in `docs/claude/ENV_REGISTRY.md` (2026-11-16 entry).

Tests: `src/server/lib/testChatBot.test.ts` ("discount reseller gateways…"). The own-domain guard was proven by
reversion (a substring host check let `moyi-api.com.evil.example` and `evilmoyi-api.com` through; the tests failed).

**OPEN — NOT DONE: the three gateways on `z@gmail.com`'s Pro builder.** Not built, deliberately, because the facts a
builder rung needs are unknown until a real call answers: Moyi's and MirAPI's API endpoint and model ids, whether each
gateway honours tool calling (the builder cannot run without it), and the real price per model for honest billing.
Needs: the owner sets the keys (and the two base URLs), runs each in the Test Chat Bot, and reports which model
answered. Then the rung is written the way `bluesmindsBuilder.ts` is (neutral label, own rate, brand-neutral errors,
off-ladder census), gated to the z test account. Claude models through a reseller stay out without separate sign-off.
## 2026-11-16 — BR1991 autopsy (stopped build, report not retained): nothing to fix, evidence pinned

Owner t311u sequential audit, BR1991 only (boundary 1951..2105 frozen). Branched from origin/main `a5e23403` (BR1990, #4265). The registry lists #1991 as stopped with `retained: false`; every read-only report tool answers "not found in retained storage", and the audit's starting inventory already showed it unretained, so the build's own defects cannot be read and were not reconstructed. From source: a numbered report always had saved bytes (registry row and history document are written in one transaction); the only in-repo path that removes a recent report is the user deleting that build's chat (GA-1 `purgeWorkspace` → `deleteDiagnostics`, registry row kept by design); 180-day retention and the refusing account erasure cannot explain it. Most likely an expected user deletion, not proven: Q-2703 (BLOCKED, needs one admin production read). No product code changed; `tests/br1991Autopsy.test.ts` pins the facts (5 mutations, each caught). Docs: `docs/build-report-autopsy-BR1991.md` and its evidence JSON.


## 2026-11-16 — BR1992 autopsy (Weak/Surplus edit turn, stopped by the 25-min cap): stopped Surplus call named by Surplus; "final checks" ends on a new pickup

Owner t311u sequential audit, BR1992 only (boundary 1951..2105 frozen). Branched from origin/main `a5e23403`, with #4267 merged in normally. F1: the Surplus session runner and its fail-open wrapper had no `TurnRunner.plannedModel`, so a Surplus call stopped by the build's clock was recorded as `claude-sonnet-4-6` on a `noClaude` Weak build. It is now named by the session's sticky model; the wrapper answers `undefined` (main's fallback) when unclear. Records only. F2: the live ETA said "running the final checks" for minutes while the integrity pass built newly sent requests. The phase is now an epoch, and a pickup strictly after it began ends it. No statement was added to the chat handler (TS2563). Pins in five existing test files were updated deliberately. Q-2704 (BLOCKED): repair passes absorbing new requests is an owner decision. D4–D6 were not changed. 8 mutations were run, and each was caught. Docs: `docs/build-report-autopsy-BR1992.md`, its evidence JSON, and `tests/br1992Autopsy.test.ts`. Not live until a Console Run.

## 2026-11-16 — BR1993 autopsy (large-app first build, setup refused to reconnect): already closed on main; order residual queued

Owner t311u sequential audit, BR1993 only (boundary 1951..2105 frozen). Branched from origin/main `d6a417f2` (BR1992, #4269). A free Weak/Surplus large-app first build ran the scope classifier and the roadmap planner, showed the roadmap message and a rough ETA, then failed setup within about a second with SANDBOX_RECOVERY_UNAVAILABLE, in about 19 s, with no files written. The report was written by code deployed before BR1983 (#4251) and BR1984 (#4254), which already closed its defects on main: an admin-only refusal reason, outcome phase normalisation, and a non-retryable repeat after a settled refusal. `tests/br1993Autopsy.test.ts` pins those facts on this report's shape (12 tests; 6 mutations, each caught). New Q-2705 (BLOCKED): planner, message and ETA run before setup on a first attempt. The BR1992 review residual (`recordModel` read at run start) is not on this path and is not changed. No product code changed. Docs: `docs/build-report-autopsy-BR1993.md` and its evidence JSON.

## 2026-11-17 — BR1994 autopsy (large-app first build stopped by the 25-min cap): no "I am continuing" after "Out of time"; the ending quotes the build's minutes

Owner t311u sequential audit, BR1994 only (boundary 1951..2105 frozen). Branched from origin/main `f631a04e` (BR1993, #4270). A free Weak/Surplus build rendered at about 416 s and was stopped by the 25-min cap during an unfinished-app resume.
- F1: the user was told "Out of time — saving your app", then 19 s later "I am continuing. Please keep this open." The hand-back notice is now silent once the build-wide final stage was said (`outOfTime === true` only; the resume itself is unchanged).
- F2: the ending said "about 22 min" (the full builder's remaining budget) after about 25 min. `buildClockMinutes` now quotes the minutes elapsed since the request arrived when that start is known, and main's figure otherwise.
- The `claude-sonnet-4-6` label on the stopped call was already closed by BR1992 F1.
- Q-2706 (BLOCKED): a resume in the final stage. Q-2707 (BLOCKED, money-adjacent): a superseded failed command counted on a failed build's gate.
- Two existing source pins were updated deliberately. 9 mutations were run: 8 were caught, and the one that survived exposed a redundant guard, which was removed.
- Docs: `docs/build-report-autopsy-BR1994.md`, its evidence JSON, and `tests/br1994Autopsy.test.ts`. Not live until a Console Run.

## 2026-11-17 — BR1995 autopsy ("Fix with AI" under our own reconnect refusal): the button stands down for the exact refusal sentence

Owner t311u sequential audit, BR1995 only (boundary 1951..2105 frozen). Branched from origin/main `d167b888` (BR1994, #4271). The user pressed "Fix with AI" under BR1993's reconnect refusal, so this build's request was our own infrastructure sentence. Setup refused again after about 5.6 s.
- F1: `errorCanBeFixedByEditingTheApp` now returns false for the exact first or repeat reconnect-refusal sentence. The sentences moved byte-identically to `src/lib/sandboxRecoveryMessages.ts`. Any other text keeps today's button.
- Already closed on main: the repeat refusal's wording and its held-back ETA (BR1984, #4254), the admin reason (BR1983, #4251), and the "0s of preparation" line for a pre-build call (BR1958).
- Q-2705 is referenced for the ETA before setup.
- Q-2708 (BLOCKED): a 5.3 s "Routing and ETA" window with no named steps. Q-2709 (BLOCKED): other in-stream infrastructure endings.
- BR1994 doc correction: a specialist's `childEvents` (`Object.create(parent)`) inherits `budgetStagesSaid`, so it is silenced after "Out of time" too. Pinned.
- 7 mutations, all caught.
- Docs: `docs/build-report-autopsy-BR1995.md`, its evidence JSON, and `tests/br1995Autopsy.test.ts`. Not live until a Console Run.

## 2026-11-17 — BR1996 autopsy (discounted build's green line did not add up): show only the discount and the total when the line would not reconcile

Owner t311u sequential audit, BR1996 only (boundary 1951..2105 frozen). Branched from origin/main `81a1e0ff` (BR1995, #4272). A free Weak build succeeded and was charged.
- F1: the green discount line showed "Build price ₹2.99 · Discount 10% (−₹0.30) · You pay ₹2.76", because the settle adds to the bill after the discount. When price − discount is more than one paisa from "You pay", the line now shows only "Discount 10% (−₹0.30) · You pay ₹2.76". It is one shared function (`src/lib/buildDiscountLine.ts`) for the summary and the panel.
- Reworked after review under owner rule t362u: the first version named the fee, which is admin-only. No fee, rate or subtotal is named now.
- A reconciling line is byte-identical to main. No amount, debit, floor or fee changed.
- Already closed on main: `package.json` folded into `tsconfig.json` and the fast lane run against a failed setup (BR1952, #4124); "try building again" on a setup failure (BR1961, #4146); "0s of preparation" (BR1958, #4132).
- Q-2710 (BLOCKED): the builder calls a new app a "fix" after a fast-lane hand-over. Q-2711 (BLOCKED): the pre-existing user-visible fee lines conflict with t362u.
- 10 mutations, all caught.
- Docs: `docs/build-report-autopsy-BR1996.md`, its evidence JSON, and `tests/br1996Autopsy.test.ts`. Not live until a Console Run.

## 2026-11-17 — BR1997 autopsy (a shell rm deleted a stylesheet the entry still imported): name any module that still imports a deleted file

Owner t311u sequential audit, BR1997 only (boundary 1951..2105 frozen). Branched from origin/main `2c66e533` (BR1996, #4273). A free Weak build succeeded and was not charged.

- F1: after a confirmed shell delete, the bash result names each recorded JS/TS module whose current text still imports a deleted file (`src/server/AgentV3/deletedImportNote.ts`, wired in `ToolDispatcher`). Advisory only; no importer means byte-identical output. Kill switch `AGENTV3_DELETED_IMPORT_NOTE=off`.
- Q-2712 (BLOCKED): the post-green recheck said OK while the dev server could not compile the entry module.
- 11 mutations, all caught (one after an added test).
- Docs: `docs/build-report-autopsy-BR1997.md`, its evidence JSON, and `tests/br1997Autopsy.test.ts`. Not live until a Console Run.

## 2026-11-17 — BR1997 rework after review (bounded reads on the bash critical path)

The review failed the first version under audit P0-C: up to 60 sequential reads on the bash path, each bounded only by `fileOp`'s 30 s, whose timeout also drops the sandbox. Reworked with ordinary commits on the same branch:
- Reads: entry modules first, at most 60, 12 at a time, 5 s each, an 8 s overall budget (`readSourcesWithinBudget`). They use the new `E2BActuator.readFileAdvisory`, whose timeout does not drop the cached sandbox; `readFile` is unchanged.
- Precision: a comment-, string- and template-aware tokenizer; only relative, extensioned specifiers that join to exactly a deleted path are named, so a remaining sibling never draws a note.
- The note is kept out of the user's terminal and the `tool_result` summary.
- 38 tests; 21 round-2 mutations, all caught (one after an added test).

## 2026-11-17 — BR1998 autopsy (pasted source code was told "I could not find @override"): annotations in pasted code are not missing files

Owner t311u sequential audit, BR1998 only (boundary 1951..2105 frozen). Branched from origin/main `8e5fec7b` (BR1997, #4274). A free Weak edit build succeeded and was not charged.

- F1: `parseFileMentions` no longer reports an unresolved bare identifier that is the first thing on its line in a message that looks like pasted code (3+ lines ending in `{`, `}` or `;`). Everything else is byte-identical. Pure, no I/O.
- No new queue row (USAGE_NOT_REPORTED is Q-2414).
- 9 mutations, all caught (plus one comment-only control).
- Docs: `docs/build-report-autopsy-BR1998.md`, its evidence JSON, and `tests/br1998Autopsy.test.ts`. Not live until a Console Run.

## 2026-11-17 — BR1998 rework after review (a short request plus a snippet dropped real warnings)

The review failed the first version: the pasted-code test looked at the whole message, so a short request plus a 3-line snippet dropped real missing-file warnings. Reworked with ordinary commits on the same branch: the message must be mostly code (3+ lines ending in `{ } ;`, and code-shaped lines at least half the non-empty lines); well-known extensionless names (Dockerfile, Makefile, LICENSE, README, …) are never dropped; the token's own line must read as an annotation and sit between code lines. Every review probe keeps its warning; whole Dart, Java, Kotlin and TS pastes are still silenced. 28 tests; 19 round-2 mutations, all caught (six after added tests).

## 2026-11-17 — BR1998 second rework (a neighbour ending in , or ) counted as code)

The second review found that the neighbour rule counted a line ending in `,` or `)` as code, so a lone `@Header` after a prose line, a `- item,` list or a numbered `(1)`…`(5)` list, plus a short snippet, lost its warning. Now a neighbour counts as code only when it ends in `{ } ;`, or is an annotation line that leads (within 8) to such a line; the wider set stays only in the half-of-lines test. The report's `@override` and the Dart, Java, Kotlin and TS pastes still match. 36 tests; 30 mutations rerun, all caught.

## 2026-11-17 — BR1998 third rework (the strict belt for a lone @Name)

The third review found that a lone `@Header` or `@Login` sandwiched between code lines (three `const` lines, then the token, then a function), with or without an intro line, was still dropped. Took the strict belt: a lone token is dropped only when its name is on a conservative, case-insensitive allowlist of real Dart, Java, Kotlin, TS/Angular, Spring/JPA and JUnit annotations (no app-file or screen names), and the very next line, with no blank line between, ends in `{ } ;` or is another known annotation. Tokens with code after them on their line keep the earlier rules. The report's `@override` and the Java, Kotlin, TS and Spring fixtures are still silenced. Added 13 tests (49 in the file); all earlier probes still warn; mutation round 4 (40 mutants) ends with every behavioural mutant caught.

## 2026-11-17 — Surplus Pro builder is default ON

Owner: "surplus ko bhi default on karo". `AGENTV3_SURPLUS_BUILDER` is now ON unless explicitly off, matching
Mitrify, Qubax, CheaperInference and BluesMinds. The switch moved to `surplusBuilderSwitchOn` in
`alwaysOnSuppliers.ts`; the eight places that each compared the flag to `true` (buildSession, liveAdmission x2,
productionAdapter, transport x2, the route via `surplusBuilderEnabled`, one test fixture) now read it there.
`surplusBuilderEnabled` additionally requires a usable `SURPLUS_API_KEY`, so a keyless server (CI, local) takes the
same no-I/O ladder path as before. Production already had the flag `on` (owner-reported 2026-10-25), so behaviour
there does not change. Tests: `tests/surplusBuilderDefaultOn.test.ts` (default, kill switch, keyless, and a census
that fails when another file reads the flag; proven by putting a raw reader back in `productionAdapter.ts`).
Not verified: a live Surplus build; this session cannot read Cloud Run's env or reach Surplus.

## 2026-11-17 — Moyi API is a Pro Weak builder rung, after BluesMinds

Owner: "moyi api ko bhi bluesminds ke baad lagao, its working". Weak order: Surplus → Router One → BluesMinds → Moyi →
tier ladder. `src/server/AgentV3/moyiBuilder.ts` mirrors `bluesmindsBuilder.ts`: neutral label `ENGINE_MY`, brand-neutral
errors, off-ladder census, label and name added to the redaction lists. The rung exists only when `MOYI_API_KEY`,
`MOYI_BUILDER_MODEL` and `MOYI_BUILDER_RATE_IN/_OUT` are all set: no model id is guessed and no price is invented.
Claude-family model ids are dropped from the list. Tests: `tests/weakMoyiOrder.test.ts` (order in every lane, each
missing key removes the rung and leaves the old chain, own-domain endpoint, rate, brand; the no-Claude filter was
proven by reversion). This closes the 2026-11-16 open item for Moyi, for all Weak users rather than only the
z test account, by the owner's new order. DiscountedTokens and MirAPI remain Test Chat Bot only.
OPEN: tool calling on the chosen Moyi model is unverified until a real Weak build runs through `ENGINE_MY`.

## 2026-11-17 — Moyi builder rung works with the key alone, for every Weak user

Owner: "moyi ai ko sabhi user ke liye default on kar do". `MOYI_BUILDER_MODEL` and `MOYI_BUILDER_RATE_IN/_OUT` are now
optional. With only `MOYI_API_KEY`, the rung reads Moyi's own `/models` list (cached 6 h, background refresh) and runs up
to two listed models that have a published price, priced from `MOYI_PUBLISHED_RATES` (Moyi's own page, owner-supplied
2026-11-16). No model id is guessed: until the list has been read, a build runs without the rung (proven by reversion:
returning a guessed id on an empty list failed 3 tests). Owner-set model/rate keys still win. Not verified live: whether
Moyi's ids match the table's patterns, and whether the chosen model honours tool calling; the first Weak build reports
will show `ENGINE_MY` turns or failures.
## 2026-11-17 — builder fallthrough after phone drop (t400u)

#2407 and #2408 failed ENGINE_UNAVAILABLE. Router One was marked stopped when the viewer's HTTP response closed, so a phone disconnect refused that rung before any request (`scope_stopped`). The stall banner treated "not in this process's memory" as the build being dead even when the workspace lease was still heartbeating. A build now keeps Router One until its own abort, status reports `buildHeldElsewhere` while the lease is live, and a BUILD_STARTED row is saved as soon as the report object exists. Account keys with an `ak-` prefix are redacted from stored reports and user-facing errors. Quotas, billing, referral, and white-label rules are unchanged. The wallet chip showing 0 tokens is the real token balance; it does not select the weak ladder by itself, and a paid refusal is still the 402 credits card.

## 2026-11-17 — recharge sentence when the wallet cannot cover a build (t402u)

The existing pre-start block (no positive balance, billing on, not a free-list account) now says the owner's sentence: Hindi when the request is Hindi, English otherwise, with a Recharge button. A stream error with that code uses the same card, not the stall banner. The step clock ("build budget exhausted") and a supplier account with no balance are not the user's wallet and do not show this sentence. Who is allowed to start is unchanged, including a free weak-ladder build the gate already allows.

## 2026-11-17 — no build when the wallet cannot cover it (t403u)

Owner override: a balance of 0, or below the pre-flight estimate, does not start a build at all, including the weak ladder. The same sentence stops a build whose running bill passes that balance; files already written are kept. Admin free-list and the z test account stay exempt. Prices, chat quotas, gift and referral rules are unchanged. An unreadable balance is still not treated as zero.

## 2026-11-17 — BR1998 fourth rework (colliding names and a stack with no declaration)

The fourth review found that the allowlist still contained names that are also plausible app files or components (`Input`, `Preview`, `Test`, `Component`, and others), so a tight sandwich such as three `const` lines, then `@Preview`, then `function Preview() {` dropped the warning; and that a following known annotation was enough even when no declaration followed, so `@Input` then `@Component` then a request, or `@Input` then `@Override` at EOF, also dropped the warning. Removed every colliding name (input, output, component, test, entity, directive, id, required, immutable, protected, preview, inject; the rest of the list was audited). A following known annotation now counts only if a no-blank walk (cap 8 hops) actually reaches a line ending in `{ } ;`. Annotations with arguments (`@Input()`, `@Component({`, `@Test()`) still drop through the unchanged non-lone path. Accepted residual: a paren-less Compose `@Preview` above `fun Foo()` warns again (fail-safe). 55 tests; all 49 earlier tests still pass; the three earlier FAIL probes still warn.
## 2026-11-17 — Admin panel copy (Builds · Reports): the failure panel's two numbers
- **"Worked, called failed 44" and "User got a working app 97%":** an app that rendered was taken as proof the request was delivered. 21 of the 58 failures carry an engine / sandbox / account / cap outcome code; they are now their own line (`renderedButUnfinished`) and earn no delivered credit — 92.4%, not 97% (the page's own counts reproduce both: tests fixture). Content verdicts a render contradicts (the cases of autopsies 697b38ee / 4efab9d7) are unchanged.
- **"12.6% of 497 settled builds":** the rate is 58 ÷ 460 judged (the 37 the user stopped are in neither half); the note now says so.
- Other findings on the page are queue rows Q-2721…Q-2725 (unexplained outcomes, a first-pass measure that cannot move, a fake login in a password manager, phone-size overflow ×3, save-then-lose ×2).
## 2026-11-17 — A published 3D game opened to an empty page: the game loop ran only from start()

Admin: the battle royale's published link (`a-6b8ad5b4e2f4ce94b8a8d7df.mitrify.in`) "open nahi ho raha"; *"mai chahta hu har baar pura game open ho"*.

Evidence: every published file is in the bucket (index, the 797 KB bundle, CSS, icon, manifest, service worker, all HTTP 200). Loaded in a real browser, the HUD renders (Score 0 · Enemies left 19 · ⏸), but the WebGL canvas holds zero drawn pixels and records zero draw calls. In the bundle, the game's own `setupBattleRoyale` calls `setStatus('playing')`, which hides the Play menu. The shell's `GameLoop` started only from `Game.start()`, and nothing called that. The build's playtest had already measured the result ("input ignored · no canvas large enough to measure", Controls 0).

Class: the loop was tied to one caller (`start()`) instead of to the state it represents.

Fix (`GameShellGenerator.ts`, the shared shell):
- the loop follows the status: `GAME_STARTED` / `GAME_RESUMED`, plus a check right after setup;
- one frame is drawn after setup, so a menu game shows its world behind the menu;
- a disposed game never restarts.

`gameKitHistory.ts` was regenerated, so an existing game whose `Game.ts` is untouched kit code receives the fix on its next edit.

Test: `tests/aGameRunsWhenItSaysItIsPlaying.test.ts` runs the REAL generated `Game.ts` and `core/state.ts`. It covers setup setting 'playing', the menu first frame, a later 'playing' from game code, and a disposed game. Reverting the shell fails 3 of the 4 tests. All 693 game-shell tests pass.

Still open from this report: the build that said "100/100, fully shippable" while the release gate was RED (autopsy item), and the preview that would not wake 3 days after a failed build.
## 2026-11-17 — AI Engines page shows the engines that really run, live, and why each fails

Owner: "jo ai/provider use ho rahe hai, wahi dikhen chahiye, aur yeh live rahe, kon se provider fail ho raha kyu fail ho
raha likh kar aye, admin ko saf dikhe". The page showed Weak as GLM → KIMI → GLM while its own footer said "Calls today:
ENGINE_R1 581 · SURPLUS 514": the engines doing most Weak work were missing, nothing said why an engine failed, and
13 keyless providers were listed as if in use.

- Build Engines now draws the whole chain per tier: for Weak, the leads from `weakLeadEngines.ts` (Surplus when a Weak build
  opens its session, Router One, BluesMinds, Moyi), then the keyed ladder rungs; each chip marked with its 24-hour failures.
  The admin route may not import the build route, so the leads live in their own module, and
  `tests/weakLeadEnginesMatchTheChain.test.ts` builds the real chain and fails if the two ever disagree (proven by
  reversion). A first version imported the build route into admin.ts and failed three censuses.
- New "Engine health — last 24 hours" (`engineHealth.ts`): per engine, turns delivered, failed calls, causes in plain
  words (from `classifyProviderFailure` buckets), last failure time, from the latest build of every project saved in the
  window on every server. An engine with no recorded use is "No recent use", never "Working"; an unreadable window says so.
- The tab refreshes engines every minute while open.
- Provider switches: providers with a key first; keyless ones in a closed "Not set up on this server (N)" list.
- Tests: `tests/aiEnginesShowWhatRunsAndWhyItFails.test.ts` (server half) and `src/components/admin/BuildEngineHealth.test.tsx`
  (render half, no server imports: the first version imported server routes into a src test and the frontend typecheck
  failed with 5,539 errors, the 2026-09-08 class), proven by reversion (idle shown as working; chain without
  the leads). Not verified: the page against live production data.
## 2026-11-17 — an empty provider account is recognised by every router (owner: "jis provider ka balance khatam hoga, woh khud hi band ho jayega"; "user ko 100% response mile, jaldi bhi mile")

Class: "has this provider account run out?" was answered by four private copies that had drifted. One shared, pure module now answers it: `src/server/lib/providerAccountQuota.ts`.

What was wrong, per copy:
- **Free Chat chain** (`openAiCompatProvider.ts`): a 402 was recognised from DeepSeek and CheaperInference only. A 402 from any other rung (Groq, DeepInfra, OpenAI, Cloudflare, GLM, …) became `INVALID_REQUEST`, and the chain **stops** on that code. The user got no answer, the empty account was never cooled down, and the next user hit it again.
- **Gateway text transport**: `insufficient_balance` was missing, and a 402 was recognised from DeepSeek only.
- **Gateway vision transport**: GLM codes only, and only on a 429.
- **Builder predicate** `isProviderBalanceError` (also read by the shared live-health layer in #4282): English phrases only. GLM, the lead rung of every ladder, reports an empty balance as HTTP 429, code 1113, with a Chinese message, so it was read as a rate limit and retried. OpenAI's `insufficient_quota` lives in the error code, not the message.

Fix:
- `isAccountQuotaSignal` checks status and exact enums only, keeping the no-message-parsing rule of the Free chain and the gateway. A 402 counts on any provider. GLM quota codes count only on GLM.
- `isAccountBalanceFailure` checks status, codes on the error and its nested body, and a narrow set of phrases (including 余额不足 and Vertex "requires billing to be enabled").
- Deliberately NOT matched: Gemini's per-minute "You exceeded your current quota…" (status RESOURCE_EXHAUSTED), so a healthy free rung is not benched for a per-minute limit. GLM 1308/1310/1313 are quota (they reset), not "needs recharge".

Tests:
- `providerAccountQuota.test.ts`: real error shapes, both positive and negative, plus a source census that fails when any other file keeps its own copy of the list.
- 402 cases for five Free-chain rungs.
- Each site was reverted and its test watched fail.

Live effect to watch: once #4282 (shared live health) merges, an empty GLM or OpenAI account is marked suspended there and skipped by every ladder, instead of retried as a rate limit.

Not changed: no price or spend cap was added or removed. The existing Free Chat paid cap (`FREE_CHAIN_PAID_DAILY_CAP_USD`) is untouched, pending the owner's answer on whether "price cap na lagao" includes it.
## 2026-11-17 — DiscountedTokens tries up to three of its own models (owner: "sabse pahle sasta aur accha, response na aaye to 2nd, fail to 3rd, phir aage badho")

Owner report: a DiscountedTokens chat answered (gpt-6-sol, 24 s) but a coding message died as `cancelled`, HTTP status not reported, at **90,001 ms**. That was not the model failing. The admin test page aborts every call at 90 s, and a reasoning model writing code takes longer, so the page cut the reply while it was still being written. The page also called one fixed model only.

Fix (admin Test Chat Bot, all three reseller gateways; the shared class is "a gateway called with one fixed model and one fixed short bound"):
- `resellerModelLadder` (`resellerGateways.ts`): at most three models, in this order:
  1. the owner's comma list in `DISCOUNTEDTOKENS_MODEL` / `MOYI_MODEL` / `MIRAPI_MODEL`, in that order;
  2. else the gateway's default model;
  3. then the gaps, filled from the key's own `/models` list.
- `testChatBot.ts` tries the models in order:
  - Each try reserves its own budget hold.
  - A model showing no response within **45 s** is given up and the next is tried. Activity is reported by `onActivity`, which fires on every stream event, reasoning included.
  - A model that IS answering keeps going until the test's **240 s** budget.
  - A 401/403 stops at once, because a refused key fails every model.
  - A typed model is the only one tried.
  - The reply lists every model tried.
  - When all models fail, the result is `ALL_MODELS_FAILED`, with each attempt shown.
- The client wait was raised from 100 s to 250 s, so the server bound (90 s, or 240 s for a reseller) decides when a test ends.

Tests:
- `resellerModelLadder.test.ts`
- `testChatBot.test.ts`, "the gateway's own three-model fallback". It covers: order, the second model answering, all three failing with no fourth try, a refused key, the 45 s quiet cut versus a 100 s answer that streams, and a typed model.
- `testChatBotOfficial.test.ts`: activity on reasoning events.

Every new test was proven by reversion.

NOT done: DiscountedTokens in the Pro builder. The tier and position are the owner's call. My recommendation is Normal and Strong, before Sonnet. The same ladder function is ready for a builder rung. Also not done: the "cheapest and good" order. This environment cannot read DiscountedTokens' pricing page, so the order is the owner's list in `DISCOUNTEDTOKENS_MODEL`.

## 2026-11-17 — main red after #4218: a game-asset test fixture skipped the Stop signal

#4218 (merged 12:36 UTC) added `options.signal.throwIfAborted()` to `prepareGameAssets`. Its only production caller (`agentv3.ts`) always passes `abort.signal`. But `assetRolloutGate.test.ts` built its options with `as never` and no `signal`, so CI failed with `Cannot read properties of undefined (reading 'throwIfAborted')`. That fails every PR rebased on main.

The production code is right. The fixture now passes a signal, and its outer `as never` is gone, so the type checks the options. Every other test caller of `prepareGameAssets` was checked: all of them already pass a signal.

## 2026-11-17 — Traffic Manager V2, P1: read-only registry snapshot and upstream families (owner-approved plan)

The owner approved the V2 plan with five improvements: shared-health safety, Firestore efficiency, safe rollback, accurate SLO measurement, and spending controls. They authorised P1 only, and P2 waits for the P1 report.

New in `src/server/AI/TrafficRegistry/`:
- `types.ts`: the snapshot shapes.
- `upstreamFamilies.ts`: each provider's own outage domain, plus the domains each route (provider + model) may share. Two routes are independent fallbacks only when their dependency sets are disjoint and neither is `unknown`. A reseller with an unverified host is assumed to share the model maker's domain. Unproven independence counts as shared.
- `snapshot.ts`: `buildRegistrySnapshot(env)`. It READS the kill-switch families, the API directory, `freeChainConfig(env)` (with each rung's price kept as its own offer), the builder ladders in force (`tierLadder(level, env)`, env overrides included) plus `PLAN_RUNG`, and the reseller gateways. It calls no provider, reads no secret value, and writes nothing.

Nothing reads the snapshot to route yet. It is in `tests/deadCodeGuard.test.ts`'s `KNOWN_UNREACHABLE` with "remove in P2", following the repository's building-block precedent.

Findings the snapshot makes visible (no routing change):
- The builder `NEMOTRON` rung is served through OpenRouter by default (`NEMOTRON_BASE_URL_DEFAULT`), so it is not independent of other OpenRouter traffic.
- The three GLM Free Chat rungs share one domain (zhipu).
- The two DeepInfra paid fallbacks (Llama 8B, DeepSeek V4 Flash) share one domain.
- CheaperInference `beam` and LLM7 `default` have unknown makers, so they are independent of nothing.

Census tests (`snapshot.test.ts`, `upstreamFamilies.test.ts`, 33 in total) fail when any of these is missing from the registry: a kill-switch family, a directory row, a Free Chat rung, or a builder rung. Five reversions were each caught: an unclassified family, `unknown` treated as independent, Vertex split from Google, the builder ladder not read, and the Requesty route host ignored.

Not in P1, by design: runtime catalogs (the gateway's reviewed Firestore catalog, the live OpenRouter free list, Surplus offers). They join in P2 with the control store.

## 2026-11-17 — A preview is never blank: the three layers (admin: "iska koi permanent solution dhundo … han bilkul banao")

Report: the admin opened a three-day-old battle royale to edit it, and the preview "1 second bhi nahi chala". This is the same class as 2026-09-08 ("2-3 din bad preview band"). The earlier fix (`previewWake.ts`) never covered the state a FAILED build leaves behind.

The chain:
- Build 3 ended ENGINE_UNAVAILABLE after changing files, and after its app had rendered.
- The VM-free copy is taken only inside the production-build gate, which needs `result.ok`. So no copy was taken.
- The copy from build 2 became "not current". The door refused it for a 'starting' machine.
- The machine did not answer.
- The result was an endless waiting page over an app we held a working copy of.

The fix:
1. **A failed build that rendered still leaves a copy** (`failedBuildCopy.ts`, `keepFailedBuildCopy`). This runs only for a failed turn that rendered, took no copy, was not stopped and has 90 s left. It runs the same production build and, only if that passes, takes the same copy. It changes no verdict, outcome or charge. It reports FAILED_BUILD_COPY_KEPT / _NOT_KEPT. The copy-taking itself moved out of the route into `takeBuildCopy`, so the gate and this path share one definition.
2. **A starting preview shows the last working version, labelled** (`snapshotStandIn` in `previewSnapshot.ts`). An OLDER copy stands in, with SNAPSHOT_OLDER_NOTE ("changes made after it are not in this copy yet"). It never does so while a build runs, and never within 10 minutes of the last write, so a fresh edit is never hidden. The door and preview-health ask the same function, and the live app still replaces the copy by itself.
3. **Every wake-up is recorded** (`previewWakeLog.ts`). Each preview-diagnose finish appends {at, ok, last stage, reason, seconds} to a bounded five-entry log on the sandbox record, with URLs and keys stripped. The next build writes the not-yet-reported failures into its report as PREVIEW_WAKE_HISTORY.

Constraint found: the build function in `agentv3.ts` sits exactly at TypeScript's control-flow-analysis limit (TS2563). Even a three-line `if` tipped it over and broke typechecking across the whole server. New logic therefore lives in modules, and the route keeps one branch-free call. Record this before adding anything to that function.

Tests (each proven by reversion):
- `aPreviewIsNeverBlank.test.ts`
- `failedBuildCopy.test.ts`
- `previewWakeLog.test.ts`, including a wiring guard

Five source guards were repointed to the moved copy code: `previewSnapshotWiring`, `sandboxLifetime`, `snapshotIdentity`, `theCopyFollowsEveryPass`, `theSearchBoxWasInHindi`.

Not proven: why that day's wake did not bring the machine back. No record of it existed; layer 3 makes the next one visible.

## 2026-11-17 — Autopsy 57604006, builds 969740df and 1712adfa (the battle royale): ledger

Builds 5e558cb2, 7dc42243, d0c5a371 and 9ed80cc9 of the same session were autopsied by another session (Q-2690–Q-2701, branch `claude/practical-dijkstra-e7o2hc`), and were not redone here.

Tally:
- ✅ self-heal: 2 (the write-time syntax guard; type errors left by failed build 9ed80cc9, healed in 969740df)
- 🔀 workaround: 0
- ⏭️ skip: 1 (an invented restart)
- ❌ shipped imperfect: 3 (a blank, uncontrollable game; "working / fully shippable" over a RED gate; a scratch file in the project)
- 🥵 struggle: 3 (a `cat .env` attempt blocked; an unused kit canvas; an over-estimated ETA)

Plus the session-level preview that would not wake.

Missing system: the model's closing message was not reconciled with the platform's own verdict. The claim audit existed, but its vocabulary missed every sentence these builds used.

| Item | Root cause → class | Fix | Lock |
|---|---|---|---|
| Blank canvas, Controls 0, published link "not opening" | setup() set 'playing'; the loop ran only from start() → the loop is tied to one caller, not to the state | Shell loop follows the status, plus a first frame; kit history regenerated (#4286) | `aGameRunsWhenItSaysItIsPlaying` (reverted: 3 fail) |
| "Verified working / fully healthy / fully shippable / kaam kar raha hai" over RED | Claim vocabulary too narrow → verdicts phrased outside a fixed word list | Vocabulary widened (EN + Hinglish); a whole-app verdict counts when the game failed | `aGameThatIgnoresInputIsNotCalledWorking` (reverted: 3 fail) |
| "Preview not running … now restarted" (Q-2714) | No fact for a restart → a claimed action that no command performed | `devServerLaunchEvidence()` from the command log, plus a `restart-claimed` rule | `aRestartNobodyPerformedIsCorrected` (reverted: 1 fail) |
| `typecheck_output.txt` saved with the app (Q-2713) | The ledger adopts every shell write → a tool-output capture treated as source | `isScratchCapture` (name AND content) in the ledger and both collectors | `aToolOutputCaptureIsNotTheApp` (reverted: 1 fail) |
| Preview dead 3 days after a failed build | No copy on a failed turn; an older copy refused; wakes unrecorded | Layers 1–3 (#4286) | `failedBuildCopy`, `aPreviewIsNeverBlank`, `previewWakeLog` |
| Type errors and `edit_file` misses after the failed build | Belongs to Q-2691 / Q-2697 (other session) | — | — |
| `cat .env` blocked | Not a defect: the governance guard did its job | — | — |
| USAGE_NOT_REPORTED (Surplus) | Already Q-2414 🟡 | — | — |
| Unused kit `GameCanvas.tsx` (Q-2715) | Dead-file removal skips a green-latched app | 🟡 BLOCKED: admin decision | — |
| ETA under the band (Q-2716) | The fastest build of this workspace so far; the band low sat below every earlier build | 🟡 BLOCKED: close as not-a-defect, pending agreement | — |
| Why that day's wake failed (Q-2717) | No record existed | 🟡 BLOCKED: needs the next PREVIEW_WAKE_HISTORY | — |
## 2026-11-17 — Traffic Manager V2, P2: the control store (owner-approved; STOP after P2)

What it is: a versioned, atomic, audited Firestore control store, plus an admin screen (AI Engines → Traffic control).
- **Global emergency OFF**: every gateway surface goes to its legacy path.
- **Per-surface switches**: `env` or `legacy`.
- **Per provider or model**: `enabled`, `draining`, `disabled`, plus a traffic cap of 0–100%.
- **Admission evidence per model**: capability test, price check, security review and ops test, with a reviewer and an expiry.

Files:
- `src/server/AI/TrafficRegistry/controlTypes.ts`: strict schema and validation.
- `controlDecision.ts`: the pure gates.
- `controlStore.ts`: one transaction writes the `admin_traffic_control/current` doc, CREATEs the immutable `admin_traffic_control_revisions/{rev}` copy, and creates the `admin_traffic_control_audit` row. It checks the revision before writing. A rollback is a new revision.
- `controlSync.ts`: keeps the last-known-good doc and only ever moves to a higher revision. It reads one doc per instance on an adaptive 15→60 s interval with ±20% jitter.
- `routes/trafficControlAdmin.ts`, `components/admin/TrafficControlPanel.tsx`, `lib/trafficControlView.ts`.

Safety design (owner requirements 9 and 10):
- **It can only NARROW.** No mode widens what the env enables. An empty store is exactly today's routing, so nothing changes in production until an admin turns something off.
- **Ingress decides.** Ingress (`runWithAuthenticatedInferenceGatewayRequest`, `inferenceGatewayEnabled`) takes one control snapshot per request, before any provider call.
- **The planner gate applies only to new attempts.** It is supplied only where a NEW attempt is planned (`executor.ts`), never on the ledger's re-check of an already-selected attempt.
- **Mid-request checks are env-only.** `selectedCohortCurrent` and `verifiedPrincipal` stay env-only, so a switch flipped mid-request never strands, re-runs or double-charges a request.
- **Guest quota is never double-counted.** A guest already admitted to the gateway quota keeps that decision for the request, and the guest-selection step consults the store.
- **The env OFF still beats everything.**

**DEVIATION from the approved plan text, stated plainly:**
- The plan said "legacy until the first read". That would move every cold start off the gateway, which is a production change P2 must not make.
- So before the first read the instance enforces nothing extra, which is exactly today's routing.
- The first read starts at boot, and the env OFF remains the instant backstop.

**MFA finding:**
- Admin login MFA is optional in this codebase. With nothing enrolled, login is password-only.
- So writes also need a fresh 6-digit TOTP code, accepted once per instance, and are refused until MFA is enrolled.

**Admission:**
- `required: false` means observe only: the gaps are shown and nothing is blocked. That way models serving today are unaffected.
- `required: true` means the planner refuses the model until all checks are present and unexpired.

Scope limits (P3+):
- Provider and model drain, disable and caps are enforced on the GATEWAY path.
- The legacy ladders (FreeChain, AIRouter, builder) still honour the kill switch only. They gain drain and skip through the shared health layer in P3.

Tests:
- `control.test.ts`, `trafficControlAdmin.test.ts`, `policy.test.ts` (gate), and `tests/trafficControlNeverStrandsStartedWork.test.ts` (source guards and behaviour).
- 8 reversions each caught: mid-request recheck reading live control, global switch ignored, planner ignoring the gate, no revision check, no replay guard, LKG dropped, older revision adopted, admission gate off.
- The P1 `KNOWN_UNREACHABLE` entries were removed, since the route now reads the snapshot. The three new collections are classified as kept for ever, with reasons.


## 2026-11-18 — PR #4287 republish review corrections

- Synced current main, including its existing audited dependency triage; the original PR CI failure stopped at the dependency audit gate.
- Republish now uses the existing strict, bounded registry reader. A missing record permits first publish; a read outage cannot silently choose a new address. Tests exercise the production planning path instead of bypassing it under VITEST.
- A partial overwrite of a live bucket prefix is not swept away or called unchanged. It reports that some files may have changed and keeps the existing address for a retry. Branded channel republishes require a complete bucket update, so a failed update cannot delete the live copy or fall through to a newly recreated channel.
- Raw Firebase channel republishes look up and verify the existing channel URL before uploading/releasing. Expired or mismatched channels fail without claiming the old address was updated.
- Added behavioral regressions for same-address updates, partial failure preservation, unavailable registry, stale/deleted channels, snapshot isolation and shipped service-worker upgrades. Focused checks and full validation results are recorded separately; this entry is not a full CI or deployment claim.
- Cloudflare worker source still requires its separate deployment to serve the new cache policy; merging server code does not deploy the Worker. Bucket writes remain per-file, not an atomic whole-site transaction; failure messages now state that limitation honestly.
## 2026-11-18 — reconcile #4228 Forge preservation with current main

Owner requested errors fixed before merging all open PRs. Kept #4225's exclusive-create path and Forge's preservation guards together. Updated the catalogue, prompt and tests to state real behavior: admitted architect specs can create new objects; describe-only sidecalls remain held, and existing-object customization is refused without genuine atomic expected-content replacement. The optional replacement interface now passes cancellation/authorization and durable recording. Added preservation/race tests and Unicode/project-cache isolation cases. The production actuator still has no CAS implementation; none is simulated or claimed. Final integration CI is tracked by the merge session; no live E2B or browser acceptance claimed here.
## 2026-11-17 — Owner approved every suggestion ("apke sabhi suggestion approved, build karo")

- **Qubax is the third Pro Weak engine:** Surplus → Router One → Qubax → BluesMinds → Moyi → ladder. It uses the existing Qubax builder adapter (catalogue-checked tools, own price or a labelled estimate, `ENGINE_QX`). Test: `weakQubaxThirdOrder`. `proChainV2Wiring` was repointed, because Qubax now comes from the owner's order and not from v2.
- **DiscountedTokens on Normal and Strong, right before Sonnet/Opus** (`discountedTokensBuilder.ts`, `ENGINE_DT`). It tries up to three of its models (the owner's order, else gpt-6-sol, then the key's list), one runner each, and then hands over to Claude. It is never on Weak. It is billed only at `DISCOUNTEDTOKENS_BUILDER_RATE_IN/_OUT`, and **it does not run until the owner sets those two rates**. The brand scrub now also knows Moyi, which #4276 missed. Test: `normalStrongDiscountedTokensBeforeSonnet`.
- **Q-2715 resolved, differently from the approved option:** the deletion was rejected on evidence. The builder's prompt promises the kit's modules, so deleting an unused kit file would break a later edit that imports it, and an unused module is not bundled anyway. The actual defect was the false attribution "your existing code … never used". An untouched kit file (`isKnownKitVersion`) now gets a kit note. Test: `anUnusedKitFileIsNotTheUsersCode`.
- **Q-2716 closed as not-a-defect,** with the owner's agreement: it was the workspace's fastest build so far, and the ETA learns from history.

Every new test was proven by reversion.


## 2026-11-18 — PR #4288 merge review: admission follows the configured chain; Weak supplier IDs cannot bypass its guard

Reconciled with main without dropping the existing composition changes. Fixed the pre-flight availability check so Normal and Strong can start when their only configured runner is DiscountedTokens; its missing-rate and off-switch rules still refuse it, and Weak never borrows it. Qubax model selection now excludes Claude-family IDs before they acquire the neutral ENGINE_QX name: the final Weak guard cannot recognize an underlying model from that neutral name. A configuration containing only excluded models makes the rung unavailable instead of admitting an empty chain. Regression cases cover the constructed chain, missing rates, explicit disable, catalogue and no-catalogue model filtering. Full integration validation is coordinated by the merge task; focused results are recorded separately and are not a full CI claim.
## 2026-11-18 — PR #4282 reconciliation and health regression fixes

Merged current main while retaining both live-health and traffic-control/engine-history admin features. Fixed the generated image client referencing server-only `noteProviderCall`; generated client source is again standalone, and the health board explicitly labels app image integrations as catalog-only. Provider health now uses bounded storage, retains separate pool credential identities, aliases Qubax/ENGINE_QX, records the supplied builder clock, and prevents cancelled or failed recovery probes from being stuck forever. Router admission claims recovery at dispatch and tracks physical occupancy; vision cancellation does not count as provider failure. Unmeasured providers show “not measured”. Each test starts fresh process-health state; physical-capacity/maintenance-threshold fixtures explicitly isolate their own independent gates.

Validation on Node 22.23.4: 12 historical-failure suites passed (287 tests); six router/vision/health suites passed (51 tests); final recovery/account/capability suite passed (10 tests); strict server TypeScript passed. Full combined coverage, remaining CI gates and emulator drills are being handled by the integration coordinator. No full-CI or merge completion is claimed by this entry.


## 2026-11-18 — PR #4282 cross-surface pool attribution repair

Combined review found that vision and legacy chat rotate `GLM_API_KEY` internally while generic health had treated every result as the builder's first GLM credential. Admission and outcomes now use the selected pool slot (`GLM`, `GLM#2`, …), including failures previously swallowed by the vision model loop. GLM's adapter owns this health accounting and the router/slot wrapper preserves that ownership instead of recording a second family outcome. The same pool parser/picker remains authoritative. Unconfigured/unsupported vision makes no health observation. A timed-out vision observer leaves physical occupancy with its SDK promise and a late success cannot replace the timeout record.

Validation: eight relevant suites / 87 tests passed, six final routing/pool suites / 60 tests passed, strict server TypeScript passed. New regressions cover funded second-key success, second-key failure, normal and streamed router paths, missing keys/PDFs, and late physical settlement. Full combined CI remains the coordinator's gate.


## 2026-11-18 — Surplus builder-loop fixture matches production tool scope

Full combined coverage correctly refused the fixture's oversized request: the complete catalogue grew to 217 definitions, yielding a conservative input of 192286 plus 8192 output against its reviewed 200000 context. Production uses the architect role catalogue; the test had incorrectly passed every recipe. The fixture now uses the same `catalogForTools(roleConfig('architect').tools)` path (56 definitions, 54584 serialized bytes), explicitly checks that `write_file` reaches the native provider request, and retains real authorization, dispatch, receipt, judge and billing assertions. No production admission limit changed. Builder-loop plus build-session focused validation: 24 tests passed, including context-evidence refusal.

## 2026-11-18 — Restore Athree map options to their own tool schema

The #4225 composition integration moved `archetype` and `size_km` into `generate_game_systems`, while the dispatcher still reads them only for `generate_athree_map`. The existing map-kind wiring test reproduced the failure on combined head dbd1137a. Moved both properties back to the map schema; preserved gameplay `include` and the new map `composition` schema. Added a tool-scoped regression so matching property names elsewhere cannot pass the check. Four focused suites (map-kind wiring, catalogue, composition dispatch, gameplay systems): 94 tests passed on Node 22.23.4. Combined full local and remote CI remain required before merge.

## 2026-11-18 — Autopsy 05eb30ba (racing spec: stopped → wallet stop → "Fix this error" → preview RED)

Three builds in one session: 7f11628a (user stopped at 11 s), 375b8d37 (wallet stop at 3.6 min, 40 files), 5881272e
(the "Fix with AI" turn on our own wallet sentence, 11.7 min, release gate RED on "does not provide an export named
'Game'"). Ledger (rows in `BUILD_REPORT_QUEUE.md`):

- Q-2726 ✅(PR) the wallet stop's sentence offered "Fix with AI" → class: every platform build ending; census over all
  `AbortCause`s. **Came back before:** Q-2709 (BR1995) fixed two sentences only; its abort-cause half is now closed.
- Q-2727 ✅(PR) blank app judged rendered — `<title>` + our badge counted as app text. Consequences in the same
  report: POST_GREEN_RECHECK_OK over a blank page, green guard "could not be opened" + no restore of the 246 s version.
  **Came back before:** Q-2712 (BR1997) — this is a second cause of that row.
- Q-2728 ✅(PR) the dev-server fast path swallowed 3 self-managed probe commands.
- Q-2729 ✅(PR) governance false positives (loopback curl, `/tmp/<sub>` delete).
- Q-2730 ✅(PR) domain social (low-profile) / jobs (displacement) → notifications/moderation/media built into a racing game.
- Q-2731 ✅(PR) AWD flagged as unknown service.
- OPEN: Q-2732 (stale dev-server module, no restart heal) … Q-2752. Not-a-defect, with evidence: the wallet stop on a
  Weak build is correct (Weak is charged on success, `buildBillingLabel.ts`); "the last version that ran correctly"
  was true (in-build green at 246 s).
## 2026-11-18 — One model rule for every gateway (admin: "sabhi provider ke liye same … top 10 strong family, sabse sasta")

`src/server/lib/modelChoice.ts` is the one answer to "which model?" for every gateway:
- strong families (ten for coding, ten for text);
- fit (tools for coding);
- cheapest blended price, unpriced last;
- never-empty, tier guard, and the kill switch `MODEL_CHOICE=off`.

Wired into:
- Router One (`rankForCoding`): a strong model now leads even when a weak one is cheaper;
- the shared key-list picker (BluesMinds, MirAPI, DiscountedTokens and the Moyi tests in the Test Chat Bot);
- the Qubax builder (its whole catalogue, when there is no owner list);
- the Moyi builder (its priced list);
- Surplus, as a strong-offer filter only (`strongOffers.ts`). Surplus keeps its reviewed, price-objective accounting.

The approved scope did NOT include the tier ladders.

Correction found on the way: the DiscountedTokens builder rung (#4288) filled up to three models from the key's list. It is billed at one owner rate, so a list model could cost more and be under-billed. It now runs only the owner's (or the default) models. BluesMinds and Mitrify already did. A gateway with no per-model price cannot honestly be ordered "cheapest", so its builder rung stays on priced models.

Tests: `src/server/lib/modelChoice.test.ts` covers the families, the rule, Router One, the key lists, Surplus and Qubax. Expectations whose ORDER the rule changes were updated: picker, Moyi and DiscountedTokens.


## 2026-11-18 — Hardening: a gateway's models now fail alone (the owner's "1st → 2nd → 3rd" fallback really runs)

Found by driving the real `MultiProviderTurnRunner` with three same-gateway rungs (owner asked for the live system to be
made rock-solid). Ledger:

- **Problem:** with DiscountedTokens (and Router One, Qubax, BluesMinds, Moyi) the first model's timeout or 429 sent the
  turn straight past models 2 and 3 to the next, dearer engine (Sonnet on Normal/Strong). Only 400/500 errors walked all three.
- **Root cause:** `openAiCompatRunners(label, key, url, [m1, m2, m3])` gave every model the SAME bench name, and the chain's
  transient memory (429 streak, shared cooldown, family timeout streak, `pool:` cooldown) is keyed on name/family — so one
  model's failure was recorded as the whole gateway's.
- **Class:** a multi-upstream gateway treated as one service. Fixed ladders (GLM, KIMI, OPENAI, NEMOTRON) are genuinely one
  service and keep their family semantics.
- **Fix:** `gatewayModelRungs.ts` + `gatewayRunners()` — unique `#n` bench names, `reportAs` = the label (reports, prices,
  white-label scrub unchanged), new `NamedRunner.familyKey` (`label::model`) scoping timeout/overload benches, new
  `accountKey` so an empty balance / revoked key / spend lock still retires every model on the key at once.
- **Siblings fixed:** all five gateways and all three Router One entry points (Weak chain, pinned Router One runner, Pro Chain V2).
- **Locked by:** `tests/aGatewayModelFailsAloneNotItsSiblings.test.ts` — timeout / 429 / 500 each walk to model 3, an
  account fact is proved once, and a census fails if any route call hands one rung more than one model outside
  `gatewayRunners`. Proven by reversion (familyKey ignored → 2 fail; accountKey ignored → 1 fail).
- **Trade-off stated honestly:** a gateway now spends up to three model attempts per turn before moving on, as the owner
  specified; each timed-out model is still cooled down on its own, so the next turn does not re-wait it.

**2026-11-18, later: #4290 merged** — Q-2726 Q-2727 Q-2728 Q-2729 Q-2730 Q-2731 closed (6). Autopsy 05eb30ba stays NOT
COMPLETE: Q-2732…Q-2752 open; Q-2709 and Q-2712 carry the notes of what is still open in them.
## 2026-11-18 — A race the user did not describe never runs out of road (owner request)

Owner: *"jab bhi koi racing game bane, to hamesa (100%) navbharatai me library se road map liye jaye (agar user kuch na kahe road ke bare me to!) … race bas 10-12 second ke baad track khatam ho jata hai … 10-12 road track … 1-2-3-…→1-2-3 cycle … hamesa infinity road"*.

- **Root cause:** the 3D layer already had the endless streamed track (`createTrackStream` + `DEFAULT_TRACK_PLAN`, 2026-11-02), but using it was one sentence in a long recipe instruction. Builders reached for `createRoad()`, whose default is a 300 m straight — about ten seconds at racing speed.
- **Class:** a capability the platform knows a build needs, left to the model's optional choice (same class as the game kit itself, build 46e2d74b).
- **Fix:** `src/server/AgentV3/endlessRaceCourse.ts` is the one reading of "a race whose course the request did not describe" (shape / scenery / length / end words; bare "road"/"track" describe nothing). When it holds and the 3D layer is seeded: a mandatory line in the kit handoff (`gameKitHandoffBlock`), a `RACE_COURSE_ENDLESS` info diagnostic, and a once-per-build code check in `ToolDispatcher` that notes a game driving a vehicle with no `createTrackStream()` (naming any `createRoad()` file). `DEFAULT_TRACK_PLAN` grew from 9 to 12 pieces (A..L), turns cancelling over one loop. The 3D instruction now forbids one `createRoad()` for a race.
- **Tests:** `tests/aRaceTheUserDidNotDescribeNeverEnds.test.ts` (prompt reading, handoff, code check, 12-piece plan) + the real 3-loop drive in `tests/theTrackIsWhatTheUserDescribed.test.ts`; reverted fix → 4 failures.
- **Honest limit:** the model still writes the game; the platform states the rule, checks the code and notes the exact repair, but a note does not fail a build. Watch the next racing build report for `RACE_COURSE_ENDLESS` and whether the note fired.
- **Same day, owner correction:** *"12 par takna nahi hai … user jab chahe map ko badlao karwa sake, flexibility maximum ho, kuch bhi hard-core nahi"*. The twelve pieces are now only the STARTING course: the handoff tells the builder to keep the course in the game's own `src/game/<game>/trackPlan.ts` (any number of pieces, any order, any loop mode), and `createTrackStream` gained `stream.setPlan(plan, { now })` — a new course while the game runs, continuing seamlessly from the road already laid (`now` also replaces the pieces ahead; never the one under the car). Width, land seed and stream distance stay as created (they keep joins exact); an ended course is not reopened (returns false). Tests: live swap to 2 and 20 pieces, seamless joins and distance, refusal cases; reversion of the replace-ahead step → fails.

## 2026-11-18 — Mitrify (and Qubax) complete answers were reported as "incomplete stream"

- **Problem (owner, Test Chat Bot):** Mitrify `HTTP 200 · 3144 ms · MITRIFY_INCOMPLETE_STREAM` — "ab ye mitrify response band kar gaya".
- **Root cause:** the SSE reader split events on a blank line and only then read them. A stream that ends with
  `data: [DONE]` and no blank line (or `[DONE]\n`) left that last event unread; a stream that finishes with
  `finish_reason: "stop"` and no `[DONE]` was never accepted. Driving the real reader: only `…[DONE]\n\n` passed.
- **Class:** an SSE reader that ignores the stream's final event. **Sibling:** Qubax's reader (first in the live chat
  chain) had the identical loop. Both now use `src/server/lib/sseFrames.ts` (`takeSseEvents` flushes the last event at
  end of stream; a normal finish is `[DONE]` or a "stop" finish_reason). A really cut-off stream still fails.
- **Not changed, deliberately:** the inference-gateway and LiveRegistry readers are line-based with different
  invariants; they were not touched without evidence of the same failure.
- **Locked by:** `tests/aStreamEndsWhereTheServerEndsIt.test.ts` (five valid endings pass, two cut-off streams fail,
  splitter units, census). Reversion: the old Mitrify reader fails 5 of 10.
- **Honest limit:** no live Mitrify key in the session, so the exact bytes Mitrify now sends are inferred from the error
  (HTTP 200, stream ended without the accepted ending), not captured. Re-test from Test Chat Bot after deploy.
## 2026-11-18 — BR1999 autopsy (a gun game's release-gate line was cut mid-sentence): a reason is never cut in half

Owner t311u sequential audit, BR1999 only (boundary 1951..2105 frozen). Branched from origin/main `58fa9a6` (#4292). BR1998 is merged. A free Weak new-game build succeeded GREEN and was not charged.

- F1: `releaseGate.ts` no longer takes `.slice(0, 200)` of the journey derivation's sentence. The game sentence is about 330 characters, so every canvas game's RELEASE_GATE read "… and its settings  (not a defect)". New `clipReason` (clause-safe, never inside an open parenthesis, ends with "…"), `JOURNEY_NONE_WHY_MAX` 480 (fits every sentence `noJourneyReason` returns, checked by a census), and the sibling `journeyUnreachableWhy` (160 → 200, clause-safe).
- F2: `gameNoJourneyReason` names settings as examples ("settings such as a sound switch or a speed slider"), not as facts about this game.
- Locked closures that landed after this build ran: BR1955 (".update()" is not a database write), BR1977 (0-file kit claim), BR1958 (empty-workspace seed), #4146 (setup note).
- Queue: opens Q-2753 (three different file counts); Q-2621 gains BR1999 evidence.
- Reversion: the old slice fails the report-shape test and the source guard; the old wording fails the F2 test.
- Docs: `docs/build-report-autopsy-BR1999.md`, its evidence JSON, and `tests/br1999Autopsy.test.ts`.
## 2026-11-18 — App Mart "Manage apps" tab restored for the owner (two admin lists drifted apart)

- **Problem (owner screenshot):** App Mart showed Browse / Publish / My apps and no admin tab, while the profile menu showed
  Admin Panel — "yeh system pahle tha, ab band ho gaya".
- **Root cause:** the Review tab and every App Mart moderation route asked only `NAV_STORE_ADMINS` (a verified email list);
  the platform's admin is the signed admin session (password + MFA) behind Admin Panel. #4191 correctly removed the
  `AGENTV3_FREE_LIST` fallback, after which an owner signed in with an account outside that one list lost the tab.
- **Class:** two admin authorities that drift. **Fix:** one decision, `storeAdminRequest(req, email)` in
  `storeAdminPermission.ts` = the admin session OR the explicit allowlist — never a free-build grant. Wired into every
  store (6), social (5) and gallery (3) admin check; the client sends `x-admin-token` to the store only when a session
  exists (`storeAdminHeaders.ts`: App Mart, its social client, the gallery queue). Tab renamed "Manage apps" as asked.
- **Locked by:** `tests/theOwnerCanAlwaysModerateTheAppMart.test.ts` (the screenshot case, reviewer, free-grant/forged/
  expired denied, client header, census of all three route files). Reversion: session ignored → the screenshot case fails.
- **Owner action:** sign in to Admin Panel once on the device (the tab follows that session); a frontend change reaches the
  phone apps only with the next store build.
- **Same day, owner follow-up ("admin penal ke andar alag 'app mart' button bana do, waha sab dikhe"):** Admin Panel →
  Apps → the page formerly called "Review" is now **"App Mart"** and embeds the store's own `NavAppStore` on its Manage
  apps tab (lazy-loaded, the same component — not a second review screen). The old copy "It opens as the signed-in store
  admin account, not with this panel's login" was the very drift fixed above and is replaced. Locked in
  `tests/theAdminMenuHasNineTabs.test.ts`.


## 2026-11-18 — BR99771bc7 sequential autopsy: evidence provenance and verification freshness

Owner requested failed-build autopsies one at a time, newest first, under `CLAUDE.md`. The Failed Reports plugin returned `-32603` on valid list requests; the owner then supplied this complete single-build export directly. This milestone covers **99771bc7 only**. It does not establish the complete plugin inventory or claim older reports were reviewed. Branch: `codex/autopsy-99771bc7`, based on main `899b96ef3ed53fccd10636534cecda873365acfd`; PR not assigned at this milestone. Open work owned by other sessions was left alone.

**Outcome and evidence.** The terminal cause is the user's Stop at 263.730 s, not an observed app crash. Production build and explicit project typechecks succeeded, and the app rendered at 218.194 s; gameplay, saved progress and a real test suite remain unproven. Four review calls were cancelled by Stop and are not supplier failures. The 23 retained model calls comprise 18 successful calls, one failed 30,002 ms scope call and four cancellations. The successful input/output totals reconcile exactly to 491,659 / 12,720 tokens; no user wallet debit is recorded, and the missing supplier receipt is not inferred free. `truncation.complete: true` and `omittedBuilds: 0` do not restore visibly truncated model/tool/command previews.

**Full item ledger:** `docs/build-report-autopsy-99771bc7.md`. Twelve items: self-healed 0, proven workaround 0, skipped/unverified 3, remaining defects/advisories 8, struggle 1. These are forensic item counts, not a reinterpretation of every informational `autoResolved` flag as a repair. Five source fixes are candidates; no report item is closed at this milestone.

| Item | Problem → root/class | Candidate action and siblings | State / evidence |
|---|---|---|---|
| Q-2696 | 30,002 ms scope failure → historical physical request/stage absent | Preserve a trusted classifier deadline tag through actual runner cancellation for future diagnostics; no retry, deadline or routing policy change | Existing BLOCKED row retained and appended with this recurrence; correlated audit/supplier evidence still needed |
| Q-2414 | Missing usage/settlement receipt → measured tokens and zero debit do not establish supplier expense | Keep the missing receipt visible; reconcile successful usage without inventing the missing amount | Existing BLOCKED row retained and appended; existing build-correlated request/settlement receipt needed |
| Q-2774 | Forced continuation claimed model classification → user decision misrepresented as classifier evidence | Preserve `user-override`, original failure and usage through the shared force/resolve path; normal/unforced decisions unchanged | IN PROGRESS; scope tests passed, reverting the change made 6 of 8 new cases fail; historical request flag unavailable |
| Q-2775 | Buffered scope rows got replay timestamps → flush time substituted for observation time | Stamp success/failure at the shared call observer and retain it through diagnostics; guard invalid/future timestamps and support older callers | IN PROGRESS; real scope-buffer/sanitized-observer/diagnostic and delayed-replay regressions, final validation record pending |
| Q-2776 | Skipped write-time checks denied later explicit compile proof → evidence consumers drifted | Credit only eligible whole-project checks through shared result handling; reject no-op/narrow/opaque checks and concurrent later skips; do not invent a finishing compile | IN PROGRESS; real-dispatcher/compiler-mode tests being finalized |
| Q-2777 | Verification freshness → defaults indexed only on a later read; old/narrow command receipts could also become current-project proof | Index defaults at their actual write; guard in-flight compiler results by revision; carry optional command `typecheckProof: { revision, project }` and filter it against the live revision through all three diagnostic readers. Defer early fallback to final ledger and reread proof before reviewer refutation; preserve raw history, independent evidence and conservative reindex/delete invalidation | IN PROGRESS; initial metadata-focused run passed 80 tests in 6 files; broader validation and final reversion pending. Missing-proof copy names current files; no historical revision transition invented |
| Q-2778 | No verified revision was called an old-project fact → absence turned into invented history | `editBase` reports only the missing verified revision for both fresh and legacy projects; promotion behavior unchanged | IN PROGRESS; provenance/edit-base sibling tests, final gate pending |
| Q-2779 | 21 distinct colours, 18 in the stylesheet → semantic versus inconsistent colours cannot be determined | No speculative palette reduction; appending CSS follows the kit-preservation contract | BLOCKED: exact CSS/components and task/visual evidence needed; token exclusions, attribution, seed and masking rules already inspected |
| Q-2780 | 16 off-grid values → exact declarations/intent missing; Stop prevents finishing writes | Preserve Stop; investigate first-write designer guidance rather than add post-Stop repairs | BLOCKED: exact CSS and designer prompt/task needed; shared snap/grid/abort guards and earlier precedent already checked |
| Q-2781 | No detected real suite → tool invocation is not executed suite proof | Preserve the testing gap for board rules, rent, bankruptcy and ending/replay | BLOCKED: generated project/test manifest and actual results needed; supplied command/tool evidence reviewed |
| Q-2782 | Visible render without exercised gameplay/persistence → observation cannot stand in for flow proof | Final red gate remains honest; cancelled review tasks do not count as passes | BLOCKED: retained traces or actual app for authorized continuation/replay needed; render/compile/cancellation evidence reconciled |
| Q-2783 | One medium compliance finding in a truncated evaluate preview → identity/source absent | Neither invent a privacy violation nor silently close the warning | BLOCKED: complete evaluate output or exact source needed; retained previews and analyzer paths reviewed |

Each BLOCKED row carries **what, why, required evidence/action and already tried** in `BUILD_REPORT_QUEUE.md` and the report ledger. Existing Q-2696/Q-2414 history is preserved; new Q-2774…Q-2783 rows are owned by this branch. No closed-ID entry or deletion is made. **NOT COMPLETE:** Q-2774…Q-2778 still require final verification, PR/CI and explicit merge authorization; the seven evidence-blocked rows remain blocked as specified. No merge, deployment, historical rerun or live repair is claimed.

**Validation boundary.** Focused scope and provenance tests support the candidates. The restored timestamp/revision evidence suite passed 11 cases; its three-source reversion produced 6 failures/5 passes and its timestamp-liveness-only reversion produced 1 failure/10 passes, recorded in `evidence-provenance-reversion-results.json`. Compile-evidence test inventory and reversion results are still being finalized in the session logs. An earlier read-only design review passed 37 existing tests in 3 suites on Node 24.22.1; that is supporting source evidence only, not the final CI-matched gate or a replay of missing CSS. Final validation must run the actual `.github/workflows/ci.yml` checks, full coverage and database/emulator drills on the frozen final tree with Node 22.23.4/npm 11.18.0. The local environment is Debian 13/OpenJDK 21 versus CI's Ubuntu/Temurin 21. This milestone does not predeclare any full gate passed; final logs and the PR record must say what actually ran and passed.

**Prevention priority.** One truthful verification record should serve compilation, source indexing, specialist prompts and diagnostics: defaults must be indexed when written; concurrent writes invalidate compiler proof; scoped checks cannot bless a whole app; cancellation is not a pass; and an override is not a classifier response. For design, the architect already names a numerical spacing rhythm but the shared specialist kit brief does not automatically carry that instruction. Recover the actual CSS/task before enforcing a shared first-write contract, preserve semantic game colours, and keep Stop absolute. The next BR starts only from its actual report evidence; no guessed inventory or historical result substitutes for it.

**BR99771bc7 retrieval follow-up:** a read-only GET of the reported preview's `/src/index.css?raw` returned HTTP 502 ("The sandbox was not found"). It recovered no CSS or app evidence; no start/resume/build action ran. Q-2779, Q-2780 and Q-2782 now record this attempt. The current unavailable sandbox does not contradict the historical render or establish a historical app failure. Local response evidence: `autopsy-session/business-game-css-raw-response.txt`; it contains no recovered source.

**Q-2777 sibling verification boundary:** final command-derived compiler evidence now carries its checked source revision and whole-project scope. `typecheckEvidenceFromAgentCommands`, `agentRunEvidence` and `evidenceLedger` all consult the same live revision callback; stale/narrow receipts cannot become proof of the current files. The route defers its early fallback to the last ledger fill and rereads command proof before refuting review findings. Historical command output, independent suite evidence and direct platform checks remain available. The missing-check sentence says "a typecheck of the current files is not established". This is the same item/class, not an extra ledger count. The first focused metadata run passed 80 tests in 6 files; final session records will carry broader validation/reversion results.

**BR99771bc7 final candidate checkpoint:** the same Q-2777 class also covered current failed compilers leaving CLEAN memory, and direct platform G3 proof surviving later TypeScript edits. Each G3 invocation/recheck and production compiler now carries its start revision; final gate and reviewer consumption check the current revision. A current compiler failure cannot hide behind an older pass; a current wider-project failure is preserved against a narrower production success. Focused final candidate: 678 tests in 15 files and strict server typecheck passed. Behavioral compile-coverage/freshness reversion: 22 assertion failures/32 passes, then exact restoration 54/54 passed. Two independent final source reviews found no remaining blocker. Full coverage and emulator/CI checks remain to be run on the final tree; no unrun check is claimed passed. Main advanced to a9ecb055 (BR1999) before that run and is integrated locally, preserving both histories and this autopsy's Q-2774–Q-2783. This is base integration, not a merge of this PR to main.

**BR99771bc7 first full-gate attempt (5ad1d3e):** all non-coverage build checks and all 11 database/emulator drills passed, with unchanged start/end source fingerprints. Full coverage exposed one stale route source assertion in `theReviewerSearchedInTheWrongDialect.test.ts`: it still expected the cached `gateEvidence.typecheck` argument instead of revision-checked `currentTypecheck`. The conditional stylesheet-read assertion remains intact. After the exact cause was confirmed, this known-failing coverage attempt was deliberately interrupted (exit 130, 1122 s); it is **failed/incomplete, never a full-suite pass**. The source assertion is corrected without changing runtime code, test selection or coverage thresholds. A complete final-tree CI-equivalent rerun is required before push; results belong to the retained session/PR evidence.

**Queue ownership refresh before rerun:** open PR #4298 now claims Q-2764. This unpublished autopsy uses Q-2774–Q-2783, above every currently committed/open-PR ID; previous history and other owners remain untouched. The corrected source-wiring assertion plus all four new regression files passed 99 tests in 5 files. Full final-tree rerun remains required.
## 2026-11-18 — Traffic Manager V2, P3: older paths obey drain/disable (per-path, off by default) + shared health (observe)

The owner approved P3 ("continue, until full work done"). Nothing in P3 changes routing until an admin acts.

**Older paths and the control store:**
- `src/server/AI/TrafficRegistry/legacyControl.ts` adds a new control-store field, `coverage`, set per path: `free-chain`, `chat-router`, `builder`. Absent means today's behaviour.
- When a path is covered, it skips a `draining` or `disabled` provider before starting a NEW attempt. The hooks are in `AIRouter.acquire`, the `MultiProviderTurnRunner` rung loop, and the very first step of the Free Chat rung loop, before any reservation.
- This is skip only: nothing is added or reordered, and the builder never leaves the selected tier.
- Traffic caps stay gateway-only, because these paths have no stable request id.
- Turning a path's coverage off is the rollback, with no deploy.

**Shared health:** `src/server/AI/ProviderHealth/healthShare.ts`, mode set by `TRAFFIC_HEALTH_SHARE`, default **observe**.
- `trafficHealth.ts` now emits state transitions and records when each state changed.
- Writes are coalesced: at most one per provider per 20 s, at most 32 per flush, and failures stay queued.
- One bounded read (last 15 min, newest 64), every 20 s backing off to 60 s, with jitter.
- Only state, kind, recovery time, model and a random instance id are shared. No provider text.
- `on` mode adopts only NEWER evidence (`adoptSharedState`). Observe mode shows the reports but nobody skips because of them.

**Family outages (owner improvement #1):** `familyHealth.ts`, display only.
- Only `down` providers with outage-shaped failures count. An empty balance (suspended) or a rate limit never counts.
- A domain is flagged only when at least 2 DIFFERENT providers that depend on it are down within 10 min.
- A reseller's own gateway and `unknown` are never shared domains.

**Admin panel:**
- An "Older routing paths" switch for each path.
- The scope note names the covered paths, and says caps and Gateway Emergency OFF stay gateway-only.
- A "Shared provider health" section, with its mode stated and any suspected shared outage shown.

**Tests:**
- `legacyControl.test.ts`: default off, per-path skip, census of every builder engine label and Free Chat rung, source guards on where each path asks.
- `familyHealth.test.ts`, `healthShare.test.ts`, and the panel render test.
- 10 reversions were each caught. Two were missed at first because one test combined both guards; each guard now has its own case.
- The `provider_health_shared` collection is classified as `platform`.

To decide next (owner):
- Turn `TRAFFIC_HEALTH_SHARE=on` after observing it.
- Turn path coverage on, one path at a time.
## 2026-11-18 — Autopsy of the admin Home page copy (18:26Z)

- Q-2754 ✅(PR) "Nearly full" from a rate tile → chip says "Needs attention" when only rate tiles are worst.
- Q-2755 ✅(PR) "+465 today" counted wallets WRITTEN today (`updatedAt || createdAt`); creation only now, sibling in
  the users list fixed, source guard against the pattern.
- Q-2756 ✅(PR) "vs 0 yesterday" on a 54-minute-old server → unknown unless the process ran all of yesterday.
- OPEN/BLOCKED: Q-2757…Q-2764 — UTC "today", per-instance hit counters, Reliability 0 from the legacy sample, 3 idle
  billed sandboxes, the −₹16,102 margin (admin decision), BUILD_BLOCKED_NO_CREDITS on new users, two reason-less log
  lines, the Grievance Officer env.

**2026-11-18, later: #4298 merged** — Q-2754 Q-2755 Q-2756 closed (3). The admin Home autopsy stays NOT COMPLETE: Q-2757…Q-2764 open (Q-2761, Q-2764 blocked on the admin).

### 2026-11-18 — BR 99771bc7: fresh-main integration and honest validation retries

Integrated main `766af3a` (PRs #4295 and #4298), keeping both queue append histories and all unrelated source changes. The previous final-tree coverage attempt was interrupted by an environment transition; the next attempt could not start because its orphaned Vitest process remained a zombie and held the reports-directory lock. The exact stale lock and process-state evidence are archived outside the repository. An unchanged full-suite retry had no reported assertion failure but was interrupted after 641 seconds when main advanced; it is **incomplete**, never a passing coverage result. All 15 other required build checks and 11 database/emulator drills passed on `d61b88f`, but those results do not replace the required full gate on this newly integrated tree. The complete merged-state gate remains pending and will be recorded in the session/PR. No test selection, coverage threshold or runtime gate was weakened; no merge to main is authorized.


### 2026-11-18 — BR 99771bc7: final stream-fix main integration

Main advanced again to `586e6281` (PR #4297) during the mandatory full coverage run. Integrated its stream-frame fixes without source conflicts and preserved its progress history. The `9150288` coverage run was interrupted after 1203.5 seconds solely to validate the newly merged state; no assertion failure had been reported, but the run is incomplete and is not counted as passing. Its other 15 required build checks and all 11 emulator drills passed with unchanged source fingerprints. A new complete gate on the final integrated commit is required; actual final results remain in the session/PR record. No source gate or coverage threshold changed, and no merge to main is authorized.


### 2026-11-18 — BR 99771bc7: complete-suite result and source-guard corrections

The complete CI coverage run on `5950b230` finished in 1629.5 seconds: 3,488 files passed and 2 failed; 53,785 tests passed, 89 skipped and 2 failed. Both failures were stale exact-source assertions: the command-timing guard assumed `timing` was the callback's last property, and the canonical compiler guard omitted the newly returned `revision`. Updated only those assertions while retaining actual duration/timing forwarding and unknown/not-run `verified: false` requirements. The two-file suite passed 7/7. Meaningful negative controls (removing forwarded timing; marking unknown compiler output verified) failed exactly 2 tests with 5 passing; runtime files were restored byte-for-byte and SHA256 checked. The seven-file regression group then passed 106/106. All 15 other required build checks and 11 emulator drills had passed on `5950b230`; the complete final-tree gate is still required after these assertion corrections and is not predeclared passed. The failed full-run evidence is preserved in the session, with actual final validation to be recorded in the PR. No test filter, coverage threshold or production gate was weakened; no merge to main is authorized.


### 2026-11-18 — BR 99771bc7: reconnect recovery and Traffic Manager integration

An environment reconnect interrupted the new `97112b2` gate after its audit check; that attempt is incomplete. A detached rerun preserved the unchanged commit and completed all 15 non-coverage required build checks and all 11 emulator drills. Its full coverage was interrupted after 575.5 seconds without a reported assertion failure when main advanced to `4fb28f0` (#4301), including changes to `MultiProviderTurnRunner`. Integrated that main update without source conflicts; the mandatory complete gate must now run on this merged tree. Earlier failures/interruptions remain in the evidence record and are not counted as passes. No coverage gate, test selection, routing policy or budget was changed by this autopsy. No merge to main is authorized.
## 2026-11-18 — Traffic Manager V2, P4: decision records + complete SLO counters (observation only)

The code is in `src/server/AI/TrafficRegistry/decisionRecords.ts`. It hooks the one chat boundary, `observeChatOutcome`, which every chat route passes on both the gateway and the legacy paths. `UniversalAIRouter` passes which path answered.

**Counters (owner improvement #4):**
- EVERY outcome is counted, with no sampling.
- Each instance writes its own absolute per-day, per-surface totals once a minute to `routing_slo_daily` (35 days). A retry never double-counts, and there is no hot shared doc.
- The SLO comes only from these counters. "Eligible" means complete, partial or failed. Policy refusals and user cancels are excluded.
- Shown with its denominator and a Wilson 95% interval. Target: 99.5% for free, navbharat and professional.

**Decision records (owner decision 4):**
- 100% of failures and critical events (no provider at all), plus 10% of successes, deterministic and weighted ×10.
- Fixed fields only (`RECORD_FIELDS`): no prompt, answer, uid, key or provider message. The request id is hashed.
- Bounded buffer (1,000), at most 200 written per 30 s, and a failed write keeps the records.
- `routing_decisions`, kept 30 days.

**Admin:** a "Reliability (last 7 days)" card and a recent-failures list, via `GET /api/admin/traffic-control/slo`.

**NOT built in P4, stated plainly:**
- The planned "shadow plan" for surfaces the gateway does not serve. The gateway's planner needs evidence-bound requests and candidates that only its own ingress builds. Faking them outside it would record a pick the gateway could never have made.
- The P5 baseline is therefore the legacy path's REAL outcomes from these counters, not a hypothetical gateway pick.
- Builder, vision and image decisions are recorded in their own phases (P8–P10).

**Tests:**
- `decisionRecords.test.ts`: sampling, fixed fields, SLO from counters only, absolute counters across instances, bounded buffer, kill switch, the boundary records gateway and legacy paths and rethrows.
- `ReliabilityBody.render.test.tsx`.
- 5 reversions each caught.

## 2026-11-18 — Traffic Manager V2, P5 (code): upstream diversity after a gateway failure, OFF by default, staff canary first

`policy.ts` gains `diversified()`, which is pure:
- after a `retryable-provider-failure` of the same request, the pick moves to the nearest eligible candidate of the SAME payment class whose route shares none of the failed outage domains;
- `unknown` is independent of nothing;
- if there is no independent candidate, the original order stands;
- a terminal failure ends the request exactly as before.

`familyDiversity.ts`: `GATEWAY_FAMILY_DIVERSITY` = off (default) / canary (the uids in `INFERENCE_GATEWAY_CANARY_UIDS`) / on. The executor supplies `dependsOn` only when it is active. The ledger's re-check of the selected attempt is unchanged.

Tests: policy (6 cases, including "without the hook the plan is byte-identical"), familyDiversity (4). 4 reversions each caught.

NOT done (needs the owner):
- Setting `GATEWAY_FAMILY_DIVERSITY=canary` in Cloud Run.
- Watching the Reliability card and decision records for 7 days.
- Then deciding on `on`.

The plan's "Free Chat fully on the gateway" switch is the owner's existing env (`INFERENCE_GATEWAY_ROLLOUT_MODE` canary/all). This phase does not change it.

## 2026-11-19 — BR2001 autopsy (an OS-emulator build ran out of time on a false "missing file"): a bundler query is not part of the file name

Owner t311u sequential audit, BR2001 only (BR2000 not retained). Branched from origin/main `7ed8450` (#4304). A free Weak build was stopped by the 25-min cap (RED, not charged).

- F1: `findUnresolvedLocalImports` reported `./assets/icons/start.svg?react — CREATE this file` while `start.svg` existed and `npm run build` passed; the builder spent both resumes and ~6 min on it. New shared `src/server/lib/importSpecifier.ts` (`importSpecifierPath` / `importSpecifierSuffix`) is now used by every resolver that decides whether a local import exists: ProjectImport (gate + mispath autofix, which keeps the `?react`), appGraphScan (it said "broken import that will fail the build"), writeTimeImportCheck, ArchitectureAnalysis, journeyDerivation, fileClassification. `resolveExportTarget` refuses a query-loaded module on purpose.
- Locked closures: #4146 (setup note), BR1994 (ending minutes, no "continuing" after "out of time").
- Queue: opens Q-2765 (two app registries from the fast lane) and Q-2766 (svgr import form); Q-2621 and Q-1007 gain BR2001 evidence.
- Proof: `tests/br2001Autopsy.test.ts`; reverting any of the five resolver fixes fails 2–5 tests.
- Docs: `docs/build-report-autopsy-BR2001.md` and its evidence JSON.

## 2026-11-19 — BR2002 autopsy (a website that succeeded was recorded as a stopped change): only a stop before the result is a stop

Owner t311u sequential audit, BR2002 only. Branched from origin/main `f2b1c01` (#4314). A free Weak website build succeeded YELLOW and was not charged; its change record said "status stopped".

- F1: the settle passed `stopped: abort.signal.aborted || userStop`. Several platform mechanisms abort that controller after a result exists (advisory cap, reaper, lock reclaim, deploy drain). New pure `changeWasStopped` in `buildAbortCause.ts`: the user's own stop is always a stop; any other abort only when it ended the build before a successful result.
- Sibling found and NOT changed: `runProof()` reads the same bare signal and feeds the markup rule — Q-2767, BLOCKED on the admin's billing decision (recommendation: apply the same rule).
- Queue: opens Q-2767, Q-2768 (fast lane stopped at 8/12 files and handed off a never-written CSS import), Q-2769 (journey vs accessibility label disagreement); Q-1007 and Q-2753 gain BR2002 evidence.
- Proof: `tests/br2002Autopsy.test.ts`; reverting the helper or the route fails it.
- Docs: `docs/build-report-autopsy-BR2002.md` and its evidence JSON.

## 2026-11-19 — BR2003 autopsy (a huge quiz spec failed setup in one second): all closed on main; the sizer is queued

Owner t311u sequential audit, BR2003 only. Branched from origin/main `e8c45ef` (#4316). No product code changed.

- D1–D3 already closed on main (BR1983 reason, BR1984 repeat wording, BR1986 ETA untested on a sandbox outcome); the ETA closure is locked here with this report's numbers.
- Q-2770 opened (BLOCKED, the admin's scope decision): APP_SCOPE named the app "Project Name" and kept a seven-section spec as one build because of the word "Quiz"; fixing the header alone would make the decision worse. Today's output is pinned exactly.
- Q-2621 and Q-2750 gain BR2003 evidence.
- Docs: `docs/build-report-autopsy-BR2003.md`, its evidence JSON, `tests/br2003Autopsy.test.ts`.
## 2026-11-18 — Traffic Manager V2, P8/P9: image reading (vision) and image generation obey drain/disable per path (off by default)

What changed:
- `COVERED_PATHS` / `LEGACY_PATHS` gain `vision` and `image`.
- `visionChain.ts` skips a drained or disabled provider next to its existing health skip.
- `navbharatImageEngine.ts` skips a drained or disabled engine (cloudflare, pollinations, grok → xai) before calling it.
- Skip only. Order, image holds, quotas and the word-ban guard are unchanged. Off until an admin covers the path.

Deliberately NOT done: recording image-engine health. The image engine shares provider labels with chat (GROK). An image failure would make chat skip that provider, which is a cross-surface routing change nobody approved. That needs separate image labels first.

Tests: `visionImageCoverage.test.ts` covers the census, the source guard, and the image engine with coverage off (still tried) and on (skipped, next engine tried). Reversion of each hook was caught.
## 2026-11-19 — Calculator report 9fba77d7: engine fixes proposed; GitHub validation pending

The owner supplied the complete diagnostic timeline and asked to fix it. Autopsy and per-item ledger:
`docs/autopsies/calculator-9fba77d7.md` (Q-2756–Q-2766). The saved App.tsx is a regression fixture.

The failed repair's root is a boolean union alias plus a positive truthiness guard: the previous cause
reader required an expanded union and a negated guard. A compiler-backed deterministic pass now follows
the imported alias, verifies true/false discriminants and receiver identity, and changes only the guard.
Both fast text-repair callers and the shared endgame use it. Handoffs prioritize actual compiler offenders.
Compiler repairs cannot introduce new undefined CSS classes without updating their stylesheet in the
same batch. The fast verifier reaches its existing spacing snap on failed compiles too.

Fast-lane/one-shot verify failures remain unresolved until an appropriate genuine recheck. Wallet
diagnostics retain admission balance, estimate and provisional stop cost; budget/supersession outcomes
make no claim that unfinished app code is correct. Prices, wallet gates, exemptions, provider chains,
settlement and project memory policy are unchanged. Planner guidance includes referenced PWA manifests.

Validation is deliberately GitHub-only under the owner's latest instruction: no local CI, typecheck,
suite, coverage, emulator drill or app build ran. Static diff review is not a passing gate. CI, merge
and production replay remain pending. The live registry snapshot, provider receipts, full generated
manifest/worker and duplicated-constant sources remain blocked as recorded in the ledger; no fabricated
fix, invoice or successful preview is claimed. No production workspace or wallet was mutated.

### Same session — public push blocked by automatic approval review

Local code commit: `9c997272e3b0ebccf18295b01da4fb4b2a73387f`, branch
`codex/calculator-build-repair`. The public GitHub push was rejected because explicit authorization
for publishing the complete payload was required. A read-only remote-ref check found no branch;
no connector/alternate route was used to bypass the rejection. No PR or CI run has started. A
private patch is prepared for review; public push/PR and GitHub validation await authorization.

### 2026-11-18 — BR 99771bc7: PR4303 green, then fresh Traffic Manager P4 integration

Published PR #4303 at `c172ee3` after all 27 required local CI checks plus package signatures passed. Local coverage: 53,817 passed/89 skipped; all 11 emulator drills passed. GitHub run `44407511896` passed build/test and drills on that same head (53,811 passed/95 skipped); its artifact uploads succeeded and the asset-only conditional job was inapplicable. The six-test difference matched built-CSS/JS availability: local coverage had prior-build artifacts, while CI ran coverage before building. A separate check against the completed final8 build passed 12 tests/1 skipped, including all six actual built-asset checks; no earlier artifact-freshness claim was invented.

During remote CI, main advanced to `a5b136d` (#4302 Traffic Manager P4). GitHub subsequently reported PR mergeability as dirty; the local merge completed automatically without manual source conflicts, preserving both progress histories. The complete gate must now verify this newly combined tree before updating the PR branch. The previous head's successful checks remain valid historical evidence, not a substitute for the new combined run. The generated prior `dist` is archived outside the repository before the next coverage run so local built-asset availability matches CI's fresh checkout; fresh output will be checked after the build as a separate supplemental test. No production gate, coverage threshold or test selection changed. No merge to main is authorized.
## 2026-11-19 — cdffbb71 Angular colour-game autopsy: source prepared, gates/merge not claimed

**Report:** `cdffbb71-cf6e-4591-93c4-9c9e79e6852c`. The requested game was not proven runnable; real payments were not delivered. Final report `ok=false`, no customer debit. Historical generated source was not recovered or run. [Full autopsy](docs/build-report-autopsy-cdffbb71.md).

**Exhaustive scope:**76 classifiable historical evidence rows:4 genuine stage/verdict self-heals,5 alternatives,10 skips,31 surviving defects/evidence limits,26 struggles; five withdrawn/unproven attribution notes remain separately, for81 E references. This tally includes valid observations and safeguards, not only defects. Producer `autoResolved=12` is not12 proven repairs; deleting Vitest/tests is a workaround despite producer0. Seventeen additional source/implementation/review findings are separate from historical attribution. **Queue Q-2784–Q-2875: 89 individual rows (54 IN PROGRESS,35 BLOCKED), with nine accepted/evidence-only E dispositions. Q-2792/Q-2832/Q-2837 remain unallocated after unsupported unpublished draft claims were removed.** Every E/D item has a visible map; shared roots keep separate rows. Four recurrence rows retain #4303 ownership; #4300 overlap is documented and neither PR is claimed merged.

**Evidence limits and reconciliation:**500/541 timeline rows retained,41 middle rows lost, individual bodies truncated.68 supplied successful call rows sum exactly2,529,893 input/22,479 output;67 deliveries are compatible with one scope call plus67 later calls. Four failed dev commands cost352.104s; first launch at13m18.822s. Visible policy states1500s total; source policy reserves150s for correction. Exact historical timeout/gate timing, aggregate write-skip counts and memory/idle metrics are unsubstantiated and removed. Eight-more-minutes ETA was impossible with175.649s left. E052’s elapsed-over-band miss is valid; source history/fleet ingestion excludes failed outcomes, so no learning defect is asserted. Sandbox costs reconcile to different session/build windows, not proof of double charge. Supplier receipt remains unmeasured; no outage/OOM/same-file collision/file loss is invented. First-turn failedTurns0 is prior-turn semantics, not a defect.

**Implemented candidates:**

- F01/F05: Angular22.3/TypeScript6.0.3 scaffold has valid build/serve configs and no missing assets; deterministic Angular errors no longer trigger blind restarts; host/port and npm forwarding are reconciled. Seed-history ESM globals fixed;5 hashes added/0 removed, old8 recognized.
- F02/F03: markup placeholder false positives fixed; actual Vite full ranges/installed-lock metadata select compatible Vitest families including Angular18/19 and Vite4; dependency preparation preserves suites; script declaration is not execution. Empty grep path/error flags corrected. Runner-aware evidence cannot call npm uninstall vitest a test pass.
- F04/F10: shared CLI styles/polyfills/peers and actual Angular root bootstrap inform static scanners. Native Angular compilation and receipts replace generic-tsc overclaims; irrelevant Babel path is not-applicable, never passed. Native NG warnings remain warnings.
- F06/F07: live ETA respects independent remaining wall time; monetary workflows withdraw the false no-account instruction while simulation/nonfinancial meanings remain protected. No authentication/payment capability is fabricated.
- F08: typed finishing refusal prevents saved-only mutation, optional integrity repair preserves proof time and original outcome; nine deterministic writers now share the guard. Credential/script receipts count only accepted files/records, including partial outcomes. Shared retention loops plus a named awaited deterministic-integrity boundary resolve the route compiler limit.
- F09: only positively known, unverified, completely hydrated platform starters bypass authored-project replacement comparison. Exact expected-versus-loaded inventory prevents a missing ninth authored file from being mistaken for an eight-file starter.

**Targeted/reversion proof at source preparation (overlapping sets, not a full-suite sum):** Angular7files/507tests plus19 reverted failures; test-tooling12files/227tests with eight caught mutants, later selector8files/194tests; integrity5files/203tests with each of four adapters reverted-and-failed; budget/scope6files/189tests, six isolated mutations caught; verification5files/168tests with40 old evidence-reader failures,13 integration failures and4 native-ledger failures; edit-base21tests with two independent4-failure mutations and restored21pass; parent finishing8files/96tests with refusal/provenance reversions caught, plus three receipt/census mutants caught and final restored5files/61tests passed. Actual new-scaffold production/development/native builds, HTTP200, browser counter0→1 and audit0 passed. Those are fixtures, not the historical game.

**Independent review:** five findings—native warning severity, incomplete starter hydration, Vite6.2/Vite4 compatibility, nonfinancial money words and unguarded deterministic writes—were corrected in current source and re-reviewed. Additional credential/script receipt and semver ambient/CFA findings are represented individually, not hidden. Parent server prechecks actually failed on undefined ETA clock+TS2563, subsequently passed, then failed after additional semver/CFA changes; exact typed declarations, shared loops and a named awaited phase boundary address the latter. Final server precheck exited0; the full CI gate remains separate.

**Required gates and status:** at source preparation, full CI, coverage,11 database/emulator drills and applicable live/infrastructure checks are **not claimed passed**. Follow `.github/workflows/ci.yml` with Node22.23.4/npm11.18.0/Java21. Final exact-source results, failures, environment differences and artifact links belong in the PR description/check records. Targeted tests never replace CI. No merge until explicit user authorization.

**Remaining contracts:** historical source/real-money requirements, runtime/a11y/design proof, old audit/lock data, unused-router scanner inventory, supplier receipts, and broader policy/replay roots Q2016/Q2144/Q2740 remain explicitly owned BLOCKED rows with What/Why/Needs/Tried. Generic compiler freshness/timing/legacy-age fixes remain #4303; calculator/compiler overlap remains #4300. No report-wide “all fixed” claim.

**Final attribution correction:** source-proven timeout wording, repair-result replacement and CLI-configured-style detection are D14–D16, not invented historical events. Explicit cap-deferral and contrast-score100 claims are withdrawn. Router-unused is explicitly confirmed in the root-retained report and remains an attribution blocker. Historical saved/runtime divergence is established; the swallowed-refusal path is independently reproduced, not asserted as the sole historical cause.

**First full-gate attempt (`2e651be`):**12 initial checks passed, including informational signature verification. Coverage collection failed in initialLaneDeclineRoute.test.ts because direct-child AST extraction no longer found the integrity writer within the named awaited phase boundary. Focused reproduction exited1 (“Expected one production last deterministic integrity writer, found0”, line80). Root stopped the run: coverage is incomplete and later production-build/bundle/boot checks and database/emulator drills were unrun. D17/Q-2875 fixes the harness to execute the complete actual awaited production IIFE, actual writeUnlessFrozen AST and real retention/error helpers in guard order. Focused1 file/29 tests pass, including two writer-positive controls and all six independent in-memory mutation witnesses. This is not a full-coverage replacement; final-source full CI must rerun.

**Completed clean-source validation attempt (`02adf28`):** an initial coverage startup was refused by a stale report-directory lock; the recorded owner was a zombie (`Z`), and only that confirmed stale lock was archived. That attempt is not credited with running coverage; its other checks and11 database/emulator drills passed on unchanged source. The clean build-job retry then completed coverage with3 failed/3,500 passed files and4 failed/54,094 passed/95 skipped tests (54,193 total),1,540.27s Vitest duration; all other16 build-job receipts passed and start/end source fingerprints matched. D18/Q-2876 tracks two old four-argument ETA source pins, D19/Q-2877 the eager metadata reads in four dispatcher callers, and D20/Q-2878 the obsolete return-object shape assertion. A metadata lookup warning (ECONNRESET/403) was logged, without evidence it caused these assertion failures. No full-CI pass is claimed. Focused corrections are pending validation; final-source full CI must rerun. Local Debian13/OpenJDK21 differences and unavailable GitHub action/inapplicable asset-job boundaries are recorded in the autopsy and run metadata.

**Current tally after D18–D20:**20 source/implementation discoveries;92 queue rows across Q-2784–Q-2878 (57 IN PROGRESS/35 BLOCKED, with Q-2792/Q-2832/Q-2837 unallocated). Historical76-bucket/81-E counts and nine accepted/evidence-only dispositions are unchanged. This updates the earlier committed17-discovery/89-row snapshot without rewriting it. Server typecheck after the lazy-metadata patch exited0 (`lazy-vite-server-typecheck.log`); final-source full CI remains required.

**D18/D20 focused proof:**7 ETA files/183 tests passed. Isolated source mutations caught dropped fifth delegation argument (2 failures), removed file return (2), removed step return (1), and bypassed file-window wrapper (1); restored witness subset33 tests passed. These checks preserve the new runtime contract and do not replace the required full-coverage rerun.

**D19 focused proof and current gate state:**lazy compatibility metadata selection passed9 files/230 tests. Isolated demand-guard removal failed6 tests including the original fresh-seed assertion; ignoring direct/snapshot evidence failed4, and selecting a new runner over an explicit declaration failed7. Restored2 files/58 tests passed; server typecheck and unused-import checks exited0. D18–D20 are implemented candidates, still IN PROGRESS. Final-source full CI outcomes belong in PR/check artifacts; no passing aggregate rerun or merge is claimed here.

**Full b34ae1b gate remains failed:**all17 build-job receipts passed, including full coverage and informational signatures;10/11 database/emulator drills passed. Coverage:3,504 files,54,136 passed/95 skipped tests (54,231 total),76.70% statements/72.73% branches/79.04% functions/78.78% lines. Source fingerprints were unchanged. Queue-retry alone failed the wallet settlers' both-success assertion (20/21 internal cases); aggregate26/27 required checks passed plus informational signatures. The final collector correctly withheld green status.

**D21/Q-2879 BLOCKED and D22/Q-2880 IN PROGRESS:**the original raw SDK/settlement result was discarded, so correlated emulator lock-timeout messages do not establish the cause. An external unchanged-production observational replay passed21/21 cases with expected one-charge/balance/ledger invariants; it does not resolve the original failure or prove it transient. The fixed ten-race diagnostic batch is still running. A one-line drill assertion-message change now preserves JSON.stringify(result); the predicate, invariants, SDK attempts, timeouts and retry policy are unchanged. Exact-pattern sibling search found only this case. No broader diagnostic closure is claimed; a new final-source full gate is required.

**Current tally after D21–D22:**22 source/implementation findings;94 queue rows through Q-2880 (58 IN PROGRESS/36 BLOCKED). The earlier76 historical classifications,81 E references, nine accepted/evidence-only dispositions and three unallocated draft IDs are unchanged. Earlier validation failures remain recorded and are not relabelled passed.

**D21 diagnostic batch and D22 proof:**the predetermined ten-case batch completed10/10, exit0,36.69s, with no case retry or early stop. Each fresh-wallet race produced one500-token debit and one zero-debit replay,9,500-token/₹95 balance, one operation/immutable ledger record and a valid chain; raw outcomes and read-only audits were retained. This does not reproduce or explain the original failed case, so D21 remains BLOCKED and no wallet logic, retry, timeout or invariant change is justified. D22’s one-line raw-result assertion message passes Node22 syntax checking and leaves the predicate unchanged. The new commit requires all applicable checks again; successful b34 coverage is retained as prior evidence, not final new-source proof. Final aggregate status remains unpassed pending the next full gate.

## 2026-11-19 — failedbr #2475 (aba63ead) autopsy: "pubg/bgmi jaisa game" shipped a 2D map, a stopped repair kept writing

**Report:** turn 3 of a session, Weak tier, qwen3-coder (Surplus), 625 s, gate YELLOW, recorded ok:false. Prompt
verbatim: *"mujhe pubg/bgmi jaisa game chahiye. jahan ham character ko joystick se move kare! apne pata nahi kya
photo bana diya hai"*. Tally: ✅ 1 self-heal · 🔀 0 workarounds · ⏭️ 1 skip · ❌ 5 shipped imperfect · 🥵 6 struggles.

| ID | Problem | Root cause → class | Fix · lock |
|---|---|---|---|
| Q-2910 | GAME_CONTRACT {unknown, unspecified, unspecified} for PUBG/BGMI | a named well-known game was not a spec; two private royale regexes had drifted | `namedGameReference` + one `asksForBattleRoyale` · `aNamedGameIsASpecification` |
| Q-2911 | 2D city map shipped as "the game" | same root; nothing told the builder the playable game must come first | contract block line · same test; watch next royale build |
| Q-2912 | GAME_PLAYTEST_NOT_RUN though "Enter Battleground" opened the game | closed start vocabulary (46e2d74b sibling) | arena stems + `opensGameSession` evidence · same test |
| Q-2913 | debugger kept writing 595–641 s after the repair was undone; saved as verified | delegated child ran under the BUILD signal only (zombie-write class, delegation road) | `runnerSignal.ts` zone + `childStopSignal` + write refusal · `aStoppedPassLeavesNoWriter` |
| Q-2914 | report ok:false, summary "This repair had used its time…" | pass runner's terminal `done` on the build stream | pass budget → `agent_done`, no 'stopped' persist · same test |
| Q-2915 | COVERED map buttons | 🟡 source of the revision not in the report | blocked on information |
| Q-2916–Q-2922 | repair overrun, 4 old_string misses, syntax reject, nudge, usage, exploration, todo-only | recurrences of Q-2697 / Q-2741 / Q-1347 / Q-2735 / Q-2317 | point at those rows |

**Has it come back before?** Yes — the zombie-write class (July SimpleBuilder, a38c6fef OneShotBuilder): both
earlier fixes guarded a LANE; neither could see delegation, because `makeSubAgentSpawn` held the build signal.
The start-vocabulary class (46e2d74b) was "fixed by shape" but kept a stem list; this one adds evidence.

### 2026-11-19 — failedbr #2466 (a360bc2c) and #2468 (35969611), same PR

- **#2468**: the user stopped an edit at 19 s, before any write. The one warning (DESIGN_CONSISTENCY) is correctly
  labelled as an observation of pre-existing code. No actionable item — not a defect.
- **#2466** (song app, user-stopped at 286 s after a rendered app): Q-2923 ✅-pending-merge (a lying a11y analyzer —
  forwarding primitives labelled by their caller, one shared reader for both analyzers); Q-2924–Q-2927 OPEN rows.
- **#2469** is owned by open PR #4300; **#2470** (99771bc7) was autopsied in #4303. Not touched here.
- **#2449 / #2450** (3-second runs, E2B cap of 20): Q-2928 (the outcome net now reads the recorded sandbox codes —
  no more "the engine did not record why" on a run that recorded it twice; the ETA is "untested" too), Q-2929 🟡
  (E2B plan limit, admin), Q-2930 🟡 (note vs admission budget — owned by the BR1983/BR2003 audit), Q-2931 → Q-2735.
## 2026-11-19 — Game library: storage budget + MIT licence (admin request: bigger game object library)
- Admin asked for 10-20 free models per game subject (people, animals, vehicles, water, terrain, roads...) in the
  NavBharatAI library. Survey found 100 subject specs exist but only 47 real models; the 64-entry catalogue cap blocked growth.
- Admin decisions: (1) byte budget instead of a count (320 MiB kept; `CATALOGUE_STORAGE_BUDGET_BYTES`, per-entry `bytes`,
  cache + engine reject bytes that disagree with the reviewed size); (2) MIT accepted next to CC0/CC-BY-4.0, notice required
  and the full MIT notice shipped in ATTRIBUTION.txt; (3) a personal `navbharatai` cloud environment allowing Kenney,
  Quaternius and Poly Pizza hosts. kenney.nl and poly.pizza still refuse automated clients; not bypassed.
- Tests: `catalogueBudget.test.ts`, MIT case in `assetIntegration.test.ts`, both proven by reversion.
- NEXT: admit batches of CC0/MIT GitHub models (KayKit City/Medieval/Prototype/Skeletons, Kenney starter kits) through the
  existing admission; design a hash-pinned NavBharatAI-hosted copy for non-GitHub CC0 sources (Quaternius animals/nature).
  Plan: `docs/game-engine/library-growth-plan-2026-11-19.md`.

## 2026-11-19 — Game library batch 2: 50 live-admitted models (47 → 97)
- 50 models from KayKit (CC0) and Kenney Starter Kits (MIT): motorcycle, trucks, road/race tiles, 4 animated skeletons,
  axe/crossbow/sword/shield/blasters, coins/flag, 9 furniture pieces, cactus, castle/market/tavern/church/watermill/
  tower/barracks/bridge, mountain/hill/grove, fence/bench/dustbin. +4.96 MB.
- Every one admitted LIVE (`scripts/library/admitLibraryBatch.mts`): real download, engine, Chromium render + motion proof,
  cache restore. 50/50 admitted. `tests/libraryBatch2.test.ts` refuses an entry without its admitted record.
- Sibling of the 64 cap fixed: `assetPlan.ts` matched subjects from only the first 64 catalogue entries.
- `SOURCE_RECORD_LIMIT` 10,000 → 16,384 for the 95-clip skeleton sources.
- AppKnowledgeBase: librarian entry lists the new models; two stale "NavBharatAI does not download model files" claims corrected.
- OPEN: rollout still depends on `AGENTV3_EXTERNAL_GAME_ASSETS` (its Cloud Run value is not recorded here). Animals beyond
  fox/eagle, boats, aircraft, realistic firearms and audio need non-GitHub CC0 sources + a NavBharatAI-hosted pinned copy.
## 2026-11-19 — Calculator report 9fba77d7: engine fixes proposed; GitHub validation pending

## 2026-11-19 — Safe integration of the ten open PRs (local candidate)

Integrated the latest heads of #4300, #4303, #4305, #4309, #4310, #4311, #4312, #4313, #4315 and #4318 while preserving ancestry; #4318 was already on main d4cac12. Queue conflicts retain each distinct report's entries, including independently reused Q numbers. Current main's expanded BR1999 evidence supersedes the stale duplicate row.

Cross-PR review found that native Angular receipts bypassed compiler revision freshness and that plain TypeScript proof could hide an Angular template failure at final gate/reviewer consumption. Native receipts now carry checked scope/revision; stale receipts cannot certify later writes; both consumers combine current platform and canonical command proof with current failures preserved. A stale completed compiler command cannot resolve a newer handed-off failure. Racing Resume now restores canvas keyboard focus; generator history preserves the new emitted version.

Focused offline validation: 165 tests passed before the final combined-proof helper. The extended run passed 170/171; its remaining failure was an older source assertion requiring the removed reviewer ternary. The corrected source-boundary check and independent six-case proof regression then passed 30/30. An earlier compound test-command fixture was updated to a genuine standalone completed suite receipt because #4315 deliberately withholds evidence for arbitrary command chains. No runtime gate or coverage threshold was weakened. Full local/hosted CI and native validation remain required before merging this combined candidate; this entry claims no remote merge or deployment.

### 2026-11-19 — Integration gate follow-up: actionable unresolved verification findings

Local code commit: `9c997272e3b0ebccf18295b01da4fb4b2a73387f`, branch
`codex/calculator-build-repair`. The public GitHub push was rejected because explicit authorization
for publishing the complete payload was required. A read-only remote-ref check found no branch;
no connector/alternate route was used to bypass the rejection. No PR or CI run has started. A
private patch is prepared for review; public push/PR and GitHub validation await authorization.

## 2026-11-19 — the OPEN rows from failedbr #2475/#2466/#2449/#2450, root-caused (follow-up to #4320)

Admin: *"baaki open ho woh fix karo, root cause fix karna"*. Each row was traced against the report's own timestamps first.

| Row | Root cause → class | Fix · lock (each reverted-and-failed) |
|---|---|---|
| Q-2917, Q-2926, Q-2918 (+ Q-2697 class) | misses quoted a version not on disk (own earlier edit, own REFUSED change, platform undo); the error never said which | `editProvenance.ts` — last read + last refused per file; a miss names its source · `aMissedEditSaysWhereItsTextCameFrom` |
| Q-2916 | a 150 s platform-checked repair could delegate to a fresh-context specialist; a withheld tool was only hidden, never refused | `DELEGATION_TOOLS` + `AgentRunner` refuses a withheld tool · `aTimeBoxedRepairDoesNotDelegate` |
| Q-2924 | salvaged fast-lane files skipped the write-time quality notes; no storage rule at the source | `salvageQualityNotes` in the hand-off + `PERSISTED_STATE_RULE` in all four lanes · `aSalvagedFileAndAStoredValueAreChecked` |
| Q-2925 | the contract froze callback props as `() => void` | `CALLBACK_PROP_EVENT_RULE` (required event param — an optional one fails under strict, verified with tsc) · same file |
| Q-2927 | an AI-song stub "fixed" with Web Audio tones | `AI_AUDIO_RULE` in all four lanes · same file |
| Q-2921, Q-2922 | traced: their instances were the delegated/zombie `debugger` | closed by Q-2916 / Q-2913 |
| Q-2920, Q-2931 (+ Q-2735) | a failed-and-retried Surplus attempt is reported as a zero-token turn | 🟡 billing decision for the admin, options + recommendation in the row |
## 2026-11-19 — Game library batch 3: 50 more live-admitted models (97 → 147)
- Food, kitchen, graveyard/horror, sci-fi base, town and medieval extras (KayKit Restaurant/Halloween/Space Base/Medieval/
  Prototype CC0; Kenney City Builder MIT). 50/50 admitted live. `tests/libraryBatch3.test.ts`.
- Build/admission scripts now take a batch number (`scripts/library/batch<N>.mts`); batch 2 rebuilt byte-identical.

## 2026-11-19 — Game library batches 4 and 5: 112 more (147 → 259); real sizes for the older 47
- kayquer CC0 kits (models generated by Blender scripts in the same repos): 13 walking/running people, everyday vehicles,
  boats, ~39 static animals, public buildings, energy, nature, farm, street items, dirt-road tiles. 112/112 admitted live.
- `measureCatalogueBytes.mts`: older 47 entries now declare measured bytes (7.6 MB, was counted as 235 MiB). Census test.
- `assetIntegration.test.ts`: "no dog model" assertion replaced by the real invariant (a walking dog gets no static model,
  never the fox, never an invented clip).
- OPEN: animated animals, aircraft, realistic firearms, audio; Vuena repo pending an authorship decision.
## 2026-11-19 — Big game maps: the wish read by meaning, Athree default ON, a race is not done on a short road, and a seamless 2D world

Admin: *"navbharatai par jab koi user game banwata hai, to road/map bahut chota sa banta hai … jab user kahe bada map banao, to hamare paas already maps ke sample bane rakhe ho, woh user ke game me add hote jaye, aur perfect add hon ki ek hi lage"*, then *"1,2,3,4 sab karo … AGENTV3_ATHREE_MAP ko default on karo"* and *"sirf word par nahi, intension par trigger ho!!"*.

**Root causes found (code read, not assumed):** (1) the Athree map (phases 1–5b, 120 map kinds) was default OFF and unset in Cloud Run, so no user ever got it; (2) the big-world gate matched a short English list ("big map", "open world"), so "bada map banao", "kahin bhi ghoom sakun" and "map bahut chhota hai" opened nothing; (3) the endless 12-map race road (#4293, de46e0ea) was a once-per-build NOTE — a builder that ignored it shipped a 300 m road and nothing stopped "done"; (4) 2D games had no big-world system at all.

**Fixed:** `largeWorldIntent.ts` reads five shapes of the wish (big space, free roam, never-ending, too-small complaint, distance) in English, Hinglish and Devanagari, any word order; a small map on purpose is obeyed. Wired into `mapProfileFor` (3D) and `world2dIntent` (2D). A ReDoS found while building it (`बड़ा\s*(?:\S+\s*){0,2}नहीं` hung on long Devanagari) fixed and locked by a linear-time test. `athreeMapEnabled` default ON, kill switch `AGENTV3_ATHREE_MAP=off`. A plain race on a road stays on the endless road library (`raceWantsOpenWorld`); Athree only when the race leaves the road or asks for a big map/world — otherwise default-ON would have put two road systems under every race. Readiness blocker `_blockIfRaceHasNoEndlessCourse` reads the whole workspace at the end (every lane) and blocks "done" until an undescribed race streams a course; fail-open on its own trouble. New recipe `generate_world_2d` (`src/server/lib/world2d/`): 10 pre-made 16x16 sample chunks in 5 biomes, roads cross chunk edges only at the middle and each edge is decided once from its own coordinates, straight highways, ground colour from one smooth world function, collision, spawn on a through road, bounded caches, on-screen-only renderer, minimap; laid down by the platform in `gameKitPlan` for a 2D game that wants a big world. Kill switch `AGENTV3_WORLD_2D=off`.

**Tests:** `theBigWorldWishIsReadByMeaning` (43), `aRaceIsNotDoneOnAShortRoad` (9), `theTwoDWorldIsOneSeamlessMap` (43), updated `athreeMapIntent.test`, `theAthreeMapIsUsedOnlyWhereItIsNeeded`. Reversions seen failing: blocker disabled (3 fail), edge socket broken (2 fail), per-chunk ground tint (1 fail).

**Verified in headless Chromium (software GL):** the Athree map renders (terrain, trees, grass, river, ocean, sky) and streams over ~600 m with no console errors, 42 draw calls / 48k triangles at phone quality; the 2D world renders with roads continuing across chunks, ~0.5 ms per frame. **Not verified:** frame rate on a real phone for either; a live build end-to-end after deploy.

## 2026-11-19 — Every library model is changeable, up to 100% replacement
- `assetCustomizations.ts` per game: colour (whole / per part), size, turn, offset, opacity, shadows, hidden parts,
  animation and roles, code-built instead, or the project's own .glb (replace 100% or add new). Nothing a user writes can
  break the game. Runtime split into a shared mount step; library path still hash-checked; own-file path same-origin only.
- Old unedited loaders auto-upgrade; `localModelLead` tells the builder in later turns. 13 real-runtime tests, reversion-proven.
## 2026-11-19 — Every game action is SEEN, and no press is lost (the kit, not one game)

Admin: *"game me attack, ya dript … action to ho jata hai, par action hota hua dikhata nahi hai, kabhi kabhi action bhi nahi hota … pubg jaisa … fire button press kiya goli chalne lagi par character goli chalate huye dikha nahi … sirf ek game fix nahi karna hai, navbharatai ko pura sikhana hai"*.

**Root causes (traced, file:line in the PR):** the kit humanoid had no action pose (walk, airborne tuck, aim only); the shell's player body was `private`, so game code could not pose it; gun recoil was a camera number and a melee swing an event plus a sound; `input.endFrame()` ran during a hit-stop freeze and wiped the press made in it (every shot and hit adds a freeze — the "sometimes nothing happens" half); the kit example polled guns with `isDown` only (a quick tap missed); `attack` had no keyboard key and `fire`/`shoot` had no key or button at all; `driveVehicle` had no drift; nothing told the builder an action must be visible, and nothing checked it.

**Fixed:** `Humanoid.act()` with nine one-shot poses (punch, swing, fire, kick, throw, jump, land, hit, use) laid over the walk, running in the air too, and an automatic landing squash; the shell exposes `ctx.hero`, poses every action button (`actionPoses`, default attack = recoil/sweep/punch by what the press did, interact = use), and poses from WEAPON_FIRED / MELEE_SWING (player-owned and attack held only — an enemy's shot never moves the hero) / PLAYER_JUMPED / PLAYER_DAMAGED; `endFrame(keepPresses)` keeps edges through a freeze; action groups (attack/fire/shoot/punch…, interact/use, sprint/run/boost, drift/handbrake) share keys and buttons; attack on F/J; `ownerId` on weapon events; drift in `driveVehicle` (slip angle, body lean, tyre smoke via `onVehicleDrift`, Drift touch strip above Brake/Gas); `ACTION_VISIBLE_RULE` in the architect prompt and every game kit handoff; write-time note + readiness warning for a game's own body that reads an action and never poses (`actionVisibility.ts`).

**Tests:** `everyActionIsSeen` (14, drives the real generated shell with touch presses and keys); kit census updates. Reversions seen failing: button poses removed (3 fail), freeze wipes presses (1), no aliases (1). **Not verified:** how the poses look in a real browser on a phone; 2D sprite actions are taught by rule only (no kit sprite system).
- **Admin "han, apke anusar hi continue karo" (2026-11-19):** Q-2915 built (the coverer's fingerprint → file:line for the
  repair, `coveringElementSource.ts`); Q-2920/Q-2931 built as option (a) (a failed attempt is judged by its receipt —
  `FAILED_ATTEMPT_COST_UNKNOWN`, reporting only). Both ride in #4320. Next in the agreed order: measure idle sandboxes
  (Q-2929), then the admission queue with the BR1983/BR2003 owner (Q-2929 + Q-2930), then Q-2919 after the next royale report.

## 2026-11-19 — Game-gap audit P0 #1–2: start screen, full pause menu, settings that are APPLIED, mute

Admin, after the game-gap audit: *"ek ek kar ke sabhi fix karo!! aur har fix ko pr bana kar marge karo!!"*. First fix of the series.

**Root causes:** `GameCanvas` called `start()`, which set 'playing' at once, so no start screen ever showed; the Hud's pause overlay had only Resume; there was no mute; `state.settings` (musicVolume, sfxVolume, quality) was written by nothing and read by nothing; vibration had no player-facing switch.

**Fixed:** new kit file `src/game/core/settings.ts` (validated, saved per device, `settings.get/set/toggleMute/reset/subscribe`, `SETTINGS_CHANGED`, mirrored into `state.settings`); the shell applies every change (mute/master/music/sfx/ui buses, quality scales the renderer's own pixel ratio down, look speed scales mouse and touch look); `buzz()` obeys the Vibration setting; `Game.play()` / `toMenu()` / `startScreenInfo`; a `<GameCanvas>` game opens on the kit's start screen (title, subtitle, device-correct controls, Play, Settings) — a Game constructed directly keeps the old start() behaviour, and a game whose own setup()/menu sets 'playing' is never frozen (the status-follow now un-pauses); Hud: start screen, pause menu (Resume / Restart / Settings / Menu), Settings panel, mute icon, game-over Menu; `GAME_MENU` event; prompt tells the builder the 3D shell owns these screens (no second set).

**Tests:** `theGameHasMenusAndSettingsThatWork` (10) plus the start-screen cases in `aGameRunsWhenItSaysItIsPlaying`; stubs updated in five shell tests. Reversions failing: mute ignored (2), no start screen (1). **Not verified:** the look on a real phone.

## 2026-11-19 — Game-gap audit P0 #4, #5, #9: loading bar, full screen + orientation lock + notch, a vibration on every hit

**Root causes:** nothing showed while a game built its world or downloaded models (a blank screen); no Fullscreen API, no orientation lock, and no `viewport-fit=cover`, so `env(safe-area-inset-*)` read 0 on an iPhone; `buzz()` fired only on rewards, the feedback table had no haptic.

**Fixed:** kit file `core/loading.ts` (real jobs, a fraction that moves only by real progress, `LOADING_PROGRESS`); the model loader reports bytes as `ASSET_LOADING` on the event bus — it never imports loading.ts, so an older project still compiles; `LoadingBar` in the Hud and "Loading…" in GameCanvas before the world exists; `Game.toggleFullscreen()` / `isFullscreen` / `canFullscreen`, Play on a phone goes full screen, `options.orientation` (default landscape) locks where the browser allows, a Full screen button only where allowed; `viewport-fit=cover` added only while a game is mounted and restored on dispose; `FeedbackSpec.haptic` on PLAYER_DAMAGED / PLAYER_DIED / MELEE_HIT / PROJECTILE_HIT / ENEMY_DIED / BOSS_DEFEATED / PLAYER_LANDED, through `buzz()` (obeys the Vibration setting).

**Tests:** `theGameFeelsRightOnAPhone` (9); 818 kit/asset/shell tests green. Reversions failing: haptics removed (1), notch removed (1). **Not verified:** real iPhone/Android behaviour of fullscreen and orientation lock (browser-dependent by design; every step fails quietly).
The first integrated coverage run exposed two newly unclassified problem codes: SIMPLE_BUILD_VERIFY_ERROR and ONESHOT_VERIFY_FAILED. The calculator repair correctly keeps these findings unresolved across a handoff, but omitted their user action. Both now share a focused current-file recheck/repair offer; they remain app findings with their original severity, and a genuine compiler recheck removes the offer. Dual-lane findings produce one button. The classification ratchet and its empty backlog fixture are unchanged. Isolated offline reproduction failed the ratchet with exactly those two codes; after the fix, the unchanged census plus calculator honesty/lifecycle tests pass 64/64. Full combined validation remains pending.

### 2026-11-19 — Integration gate follow-up: preserve unique queue identities

The integrated queue census caught the calculator branch's Q-2756–Q-2766 allocation colliding with pre-existing main records: Q-2756 was already closed, and ten other IDs belonged to unrelated open reports. The calculator report 9fba77d7 is now assigned fresh Q-2881–Q-2891 in the same order; its autopsy references and explicit old-to-new mapping are updated. Existing main IDs and the append-only closed register are untouched. All 1,046 open rows remain byte-identical after reversing only those eleven ID substitutions; no evidence or state was dropped or silently resolved. The unchanged closed-row/unique-ID regression now passes 4/4 offline. This supersedes the earlier integration note that retained duplicate IDs by report provenance; distinct report provenance preserves content but does not satisfy the queue's unique-identity contract.

### 2026-11-19 — Reconcile concurrent PR updates before final validation

Reconciled main d62593336 and PR heads #4305 384064ab3, #4303 53e88f515 and #4300 271d7ccd6 into the integrated candidate without losing ancestry or source repairs. The independently corrected calculator queue uses the same Q-2881–Q-2891 mapping; queue bytes and the closed register are unchanged from a5a8ff1. The external autopsy history and meaningful suggestion privacy tests are preserved. One suggestion object now uses the external curated wording and does not interpolate raw diagnostics into the user action; existing recheck/removal and deduplication coverage remains. No compiler, wallet, timeout, coverage or CI policy changes were made during reconciliation. Six focused offline files pass 84/84 tests, covering classification, both queue censuses, verification actions/privacy and combined Angular proof. A fresh complete validation of this final reconciled source remains required.


### 2026-11-19 — Current-revision compiler proof across the final PR union

Preserved main 696a45f78 and the latest #4300 69fab2520 / #4315 3e6b4b04b ancestors while reconciling their source-revision and compiler-resolution guards with the integrated final-gate/reviewer proof combination, literal shell Angular evidence, and Racing Resume focus repair. The concurrent updates added meaningful current-source and resolution regressions. Duplicate historical progress paragraphs introduced by the merge were removed; the original historical entries remain above, and the queue and closed register retain their existing bytes.

Independent real-dispatcher review exposed a remaining done/quality hint defect: a generic TypeScript success could erase a current Angular template failure, and stale asynchronous compiler results could replace newer proof. The hint now tracks source revision and native scope, retains decisive failures through incomplete checks, and allows a current native success to clear the prior failure. Its memory-clean hint follows the same native failure constraint. Seven behavioral regressions cover native-tool and literal-shell scope, held stale completions, changed source, and a subsequent unrun native check. The new regression file first failed 5 of its original 6 cases on the unchanged union; after the fix, 9 focused files passed 207 tests, and independent validation passed 3 files / 12 tests including the expanded 7-case file. The earlier union-only focused run passed 11 files / 160 tests. Node 22 TypeScript checking and the changed drill script syntax check also passed. These are targeted evidence; the complete final local CI run is still required.

The first exactly-one-lease assertion in the phase-2 handoff race now includes only a diagnostic message with the synthetic workspace ID, candidate tokens and raw claim responses. Operations, predicates, deadlines and retries are unchanged. This preserves future failure evidence; it does not establish or fix the cause of the earlier failure whose raw responses were unavailable.

## 2026-11-19 — failedbr #2431 (21d59838) autopsy: "not counted against it" was false, and the same keys were asked twice

Report: a Weak "fix the network error" turn, 25-min free window, OUTCOME_STOPPED at the cap; 12.4 min waiting for the
user, 12.7 working. Tally: ✅ 1 (REPAIR_CLAIM_WITHHELD) · 🔀 0 · ⏭️ 0 · ❌ 4 · 🥵 4.
- Q-2932 the watchdog counted the user wait → `workClock.ts` (one credit, capped below Cloud Run's 3600 s; deadline
  re-armed, runner `pausedMs`, 43 budget checks).
- Q-2933 the same keys re-asked → per-build unanswered-key memory at the one door.
- Q-2934 generate_otp ×8 → `run_recipe` reads arguments beside `name` (the error-conversion attempt was reverted:
  it escaped the do-nothing loop guard).
- Q-2935 the gate counted no-match probes as blockers, and excused a failed build after a grep → last statement decides.
- Q-2936 / Q-2937 follow from Q-2933 (watch); Q-2938 usage half closed by #4320's Q-2920; Q-2939 ETA band OPEN.
## 2026-11-19 — Game-gap audit P0 #8: the kit's screens and buttons speak the player's language

**Root cause:** every kit string was hard-coded English (Game.ts, Hud.tsx, touchControls.ts, meta summary lines), so a game asked for in Hindi still showed "Paused", "Game over", "Play again", "Attack".

**Fixed:** kit file `core/strings.ts` — English and Hindi tables with identical keys and placeholders, `t(key, vars)`, `setGameLanguage('en' | 'hi' | 'auto', overrides)`; the builder supplies any other language through `options.strings` (never machine-guessed here); a missing word falls back to English, never blank. Used by the start screen, pause menu, settings, game over, HUD, loading bar, kit touch-button labels (a label the game wrote is kept), the rotate hint and the run summary. `options.language` / `options.strings` on the Game; prompt tells the builder to set it. (The English-only rule is for NavBharatAI's own UI; this is the user's game.)

**Tests:** `theGameSpeaksThePlayersLanguage` (6). Reversion: a hard-coded Play fails 1. **Still open:** meta goal texts and achievement titles are English data; the racing starter's own buttons are English.
## 2026-11-19 — Recorded sound library for new games
- 47 CC BY 4.0 recordings (Meta-open-sound, pinned), loudness-measured in Chromium, 47/47 admitted live. New kit games get a core
  set replacing built-in voices of the same names + prompt-matched ambience/engines/animals/doors (≤28 sounds, 8 MiB, 4 loops).
- Every sound changeable in `soundCustomizations.ts` (own file, volume, back to built-in). Kit ships a stand-in loader so nothing
  can break. Publish serves .ogg as audio/ogg. Kill switch `AGENTV3_GAME_SOUND_LIBRARY` (default on). `tests/gamesGetRecordedSounds.test.ts`.
- BLOCKED: Quaternius animated animals / guns / vehicles — Google Drive answers "Quota exceeded" for every file (Google's own
  limit on popular shared files, up to 24 h). Retry later; no workaround used.

## 2026-11-19 — Game-gap audit P0 #3: the playtest now PRESSES Play again, reads the score and counts the sounds

**Root cause:** the playtest proved a game starts, renders and answers input, but never that a round can be played again, that the score moves, or that any sound plays; restart was read from the code only (`replayFromCode`'s word match).

**Fixed:** the kit's Game.ts exposes `window.__nbKit` (status, score, endRound — endRound only does what losing does; removed on dispose); the playtest counts every Web Audio source and `<audio>` play (`soundCounter` init script), reads the kit score before and after the controls, ends the round through the hook and finds and PRESSES the play-again control by its words (`RESTART_LABEL`, English and Hindi), then reads the status. New defects `GAME_DEFECT_RESTART_BROKEN` (no control, or pressing it did not restart) and `GAME_DEFECT_SILENT` (the game's code plays sound — `replayFromCode().sound` — and a whole playthrough played none), each with a repair hint; evidence appended to the verdict head, never points. Soft defects (not in HARD_DEFECTS): a new probe starts as evidence.

**Tests:** `thePlaytestChecksPlayAgainScoreAndSound` (7, four in a real Chromium against kit-hook games: works / no button / dead button / no hook); the 10 existing playtest/repair suites stay green (143). Reversion: the probe that never presses fails. **Still open:** auto-repair stays suspended by design (`docs/security/game-auto-repair-suspension.md`: needs byte-preserving rollback) — the gate and these defects are evidence for the user's one-tap fix; "a win/level can be completed" is not provable generically and is not claimed.

## 2026-11-19 — Game-gap audit P0 #7: the shooter's HUD — crosshair, ammo, hit marker, damage numbers, enemy and boss health bars

**Root cause:** the kit had the logic (Weapon ammo/reload, Health, BossPhases) and no UI for any of it — a gun game showed no crosshair, no ammo count, no sign a shot landed, and enemies had no health bar.

**Fixed:** Weapon events carry `ammo`, `magazine` and `ownerId` (new `WEAPON_RELOADING`); `PROJECTILE_HIT` carries `ownerId`; kit file `three/healthbar.ts` (`attachHealthBar(target, read)`, billboarded, hidden at full health and at zero, coloured by health, updated by the shell every frame); `Game.worldToScreen()`, `Game.setBossBar(name, read)` / `bossBar`, `options.crosshair`; the Hud's `ShooterOverlay` — crosshair shown by itself on the player's first shot, hit and kill markers, ammo with reload state, damage numbers that rise from where the enemy was hit, a boss bar — all driven by events and ignoring an enemy's weapon. Also: the playtest hook `window.__nbKit` is guarded for non-browser runs.

**Tests:** `theShooterHudShowsTheFight` (5; the overlay is bundled with esbuild and driven by the kit's events in a real Chromium). Reversion: counting enemy shots fails 1. **Still open:** a minimap and an objective tracker (P1).

## 2026-11-19 — Game-gap audit P0 #6: a race has rivals, a 3-2-1 countdown, a place, a clock and (when asked) a finish

**Root cause:** the kit's racing stopped at a road and a car: no countdown, no other cars to race, no position, no timer, no finish or results — every one hand-written per game, or missing.

**Fixed:** `TrackStream.poseAt(distance)` — the road's own centre line (the same `piecePoints` geometry) in current world coordinates; kit file `three/race.ts` — `createRace(scene, { stream, opponents, finishDistance, countdown, skill })`: a countdown that holds everyone at the line (`canDrive()`), rivals driving the road in their own lanes with a rubber band, live position and time (`RACE_STATUS`), a finite race ending with ordered results (`RACE_FINISHED`, `lastRaceResults`, the round becomes won / game over), Play again resets it to the grid; the Hud's `RaceOverlay` (big 3-2-1-GO!, P2/4 and the clock) and results on the end screen; `RacingRoadGame` races 3 rivals by default, gated by the countdown, and stays endless unless `finishKm` is given (owner 2026-11-18). Rivals are ghosts (no collision) — said in the module.

**Tests:** `aRaceHasRivalsACountdownAndAFinish` (9). Reversion: driving through the countdown fails 1. **Still open:** rival collisions, garage/car selection, nitro (P1 economy/genre packs).

## 2026-11-19 — Game-gap audit P1 #17: a gamepad plays the game (the runtime claimed it and had no code)

**Root cause:** `core/input.ts`'s header said "keyboard, mouse, gamepad and touch"; there was no Gamepad API code anywhere — an honesty defect as much as a missing feature.

**Fixed:** `Input.pollGamepads()` (the API is polled): first connected standard pad; left stick → analogue move with a 0.15 deadzone, letting go clears only what the pad wrote (the touch joystick is never cleared by an idle pad); right stick → look; buttons are `Pad:N` codes in `DEFAULT_ACTIONS` with real press/release edges (A jump, X/RT attack — the attack group answers too —, B use, Y reload, LT aim, LB drift, RB/L3 sprint, Start pause, d-pad directions); unplugging releases everything; no API = no-op. The shell polls first in every fixed step.

**Tests:** `aGamepadPlaysTheGame` (6). Reversion: ignoring buttons fails 2.

## 2026-11-19 — Game-gap audit P1 #12: enemies go AROUND walls (A* pathfinding)

**Root cause:** `stepEnemyAI` steered straight at the player; sight was the caller's `canSeePlayer` boolean, and with no notion of walls an enemy either forgot a player who hid or pressed against the first wall in the way.

**Fixed:** kit file `systems/nav.ts` — `createNavGrid` (blocked test, `inflate` for body radius, refuses absurd sizes), `blockedFromBoxes`, `lineClear` (sampled a hair to either side, so a line grazing the corner where two blocked cells meet is not clear — found by the test), `findPath` (A*, 8 directions, no corner cutting, bounded, target-in-wall reached from beside it, string-pulled). `EnemyPerception.nav`: sight needs a clear line, no attack through a wall, a chasing enemy hunts a hidden player along a re-planned path (twice a second or when the player moves two cells), waits instead of walking into a wall when there is no way. Without `nav` the old behaviour is unchanged.

**Tests:** `enemiesGoAroundWalls` (6). Reversion: no path following fails 1.

## 2026-11-19 — Game-gap audit P1 #13: levels, checkpoints, difficulty and first-time hints

**Root cause:** no stage manager, no respawn-at-checkpoint, no Easy/Normal/Hard, no tutorial; `LEVEL_STARTED`, `LEVEL_COMPLETED` and `CHECKPOINT_REACHED` were declared and never emitted by anything.

**Fixed:** kit file `core/levels.ts` — `levels.define/start/complete/next/isUnlocked/stars/checkpoint/respawnPoint/reset`, progress saved per game (unlocks, best stars, the checkpoint), `complete` wins the round; `showHint(id, text)` once per game, ever; `settings.difficulty` + `difficultyScale()`; the Hud's level list on the start screen (locked shut, stars), Level complete with stars and Next level, Difficulty in Settings, the hint bar; Game shows the controls hint on the very first start. Prompt tells the builder to use it.

**Tests:** `theGameHasLevelsCheckpointsAndHints` (7). Reversion: no unlock on complete fails 2.

## 2026-11-19 — Game gap P1 #16: minimap + objective tracker (branch `claude/game-minimap-objectives`)
- Gap: 3D games had no minimap and no tracker of what the player must do (`QUEST_*` events were declared, never emitted).
- Kit: `three/markers.ts` (`addMapMarker(obj, kind)`, `mapMarkers()`), `core/quests.ts` (`objectives.set/progress/complete`,
  emits QUEST_STARTED / QUEST_COMPLETED / OBJECTIVES_CHANGED, records `state.questsCompleted`), `Game.mapView()` + `minimap`
  option, Hud `Minimap` (turns with the camera, far goals pinned to the edge, auto-shows once a marker exists) and `ObjectiveList`.
- Builder prompt line (MAP AND GOALS); AppKnowledgeBase `game_menus_settings` updated.
- Locked by `tests/theMinimapAndObjectivesShowTheWay.test.ts` (reversion: flipped right-axis sign and dropped quest record → 2 fail).

## 2026-11-19 — Game gap P1: dialogue with choices + inventory (branch `claude/game-dialogue-inventory`)
- Gap: RPGs had no dialogue box/choices; `state.inventory` existed but nothing could fill, count, use or show it.
- Kit: `core/inventory.ts` (stacks stored as ids IN `state.inventory`, so save/load/restart need nothing new; `define/add/remove
  (all-or-nothing)/has/count/onUse/use/list`, INVENTORY_CHANGED + ITEM_USED), `core/dialogue.ts` (lines or a node graph, choices
  that can require an item, promise resolves with the last choice; DIALOGUE_STARTED/_LINE/_ENDED). Game.ts freezes the game's
  update while talking AND for the step the talk ends on (the closing press is not a jump). Hud: DialogueBox (1–9 keys,
  Enter/Space/E), bag button + InventoryPanel (I key, pauses), EN/HI strings.
- Found while testing: a locked choice named the missing item by its id (looked up only among owned items) → `inventory.nameOf`.
- Locked by `tests/aGameCanTalkAndCarryThings.test.ts` (reversion: dropping the freeze / the all-or-nothing check → 2 fail).

## 2026-11-19 — Game gap P1: coins, shop, upgrades, garage (branch `claude/game-economy`)
- Gap: no currency, shop, upgrades, or car/character selection — nothing to come back for.
- Kit: `core/economy.ts` (`setup({ id, items, startCoins })`, `earn`, `spend` all-or-nothing, `buy` → bought/owned/poor/max/unknown,
  `equip`/`equipped(slot)`, `priceOf` (upgrades ×priceStep, default 1.5, to `levels`), `stat(id, base, perLevel)`, consumables go
  in the bag; saved per game id on the device, sanitised on load so a corrupt/hand-edited save cannot crash or mint coins; a free
  slot item is owned and in use from the start). Hud: coin pill, ShopPanel from the start and game-over screens, EN/HI strings.
- Locked by `tests/aGameHasCoinsAShopAndAGarage.test.ts` (reversion: dropping the spend check / the owned-equip check → 4 fail).

## 2026-11-19 — Game gap P1: music that follows the game (branch `claude/game-music`)
- Gap: the music bus and Music volume slider existed; nothing ever played music.
- Kit: `fx/music.ts` renders five moods from code (calm, action, tense loops; victory/defeat stings), seamless and deterministic;
  `AudioManager.playMusic` (crossfade, same mood keeps going), `stopMusic`, `duckMusic`; a file loaded as `music:<mood>` replaces
  one. `bindGameFeedback` cues it from events (menu→calm, start→action, pause/dialogue→duck, boss→tense, win/loss→sting);
  `Game` option `music` (false or a cue table).
- Found while wiring: `toMenu()` never announced GAME_MENU (resetRun() sets 'menu' silently, so setStatus('menu') said nothing —
  the race overlay never cleared either); the first start screen had the same gap. Both now emit it.
- Locked by `tests/theGameHasMusicThatFollowsIt.test.ts` (reversion: dropping the cue binding / the toMenu announcement → 3 fail).

## 2026-11-19 — Game gap P1: adaptive quality + FPS counter (branch `claude/game-adaptive-quality`)
- Gap: no frame-rate watch and no automatic quality — a game that ran at 60 on a laptop ran at 18 on a budget phone and stayed.
- Kit: `core/perf.ts` (`createPerfGovernor`: smoothed fps, steps down after 3 s below 40, up after 12 s above 56, max 2 steps,
  ignores hitches > 0.25 s and a 2 s warm-up; `steppedQuality`). Game feeds it while PLAYING only and applies the result
  (pixel ratio; shadows off at low), never above the player's Graphics choice; `game.fps` / `game.quality`; PERF_CHANGED;
  playtest hook gains `fps()` / `quality()`. Settings: Auto quality (on), FPS counter (off); Hud FpsCounter.
- Found while wiring: the Graphics setting's documented "low = no shadows" was never applied (only the pixel ratio changed).
- Locked by `tests/theGameStaysSmoothOnEveryPhone.test.ts` (reversion: dropping the shadow switch / the hitch filter → 3 fail).

## 2026-11-19 — Game gap P1: the 2D game kit (branch `claude/game-2d-kit`)
- Gap: only a top-down big map existed for 2D; every platformer/side-scroller/runner hand-rolled its jump, collision and camera.
- New recipe `generate_game_2d` (`src/server/lib/Game2DGenerator.ts` → `src/game/2d/`): sprite.ts (SpriteSheet, Animator, drawn
  placeholder), camera.ts (dead zone, frame-rate-independent easing, bounds, look-ahead, shake), tilemap.ts (text rows + legend,
  markers, visible-only drawing), physics.ts (per-axis sub-stepped AABB — no tunnelling; one-way platforms; PlatformerController
  with coyote time, jump buffer, variable jump, drop-through), parallax.ts, particles.ts (capped pool). Wired into GAME_RECIPES,
  the catalog (tool + both lists), the dispatcher, the architect prompt (step 7c), the kit history script; AppKnowledgeBase entry.
- Found while testing: a drop-through left the jump press unconsumed, so the buffer + coyote time jumped the player straight back
  up onto the platform the next step.
- Locked by `tests/a2DGameFeelsRight.test.ts` (reversion: no sub-stepping / unconsumed drop press → 2 fail).

## 2026-11-19 — India games pack (a): Ludo + Snakes & Ladders (branch `claude/game-board-ludo-snakes`)
- Gap: no rules engine for any India board game; a model-written Ludo gets safe squares, exact home and sixes wrong.
- New recipe `generate_board_games` (`src/server/lib/BoardGamesGenerator.ts` → `src/game/board/`): dice.ts (seeded mulberry32,
  fair die, shuffle), ludo.ts (2–4 players, leave on six, six again / third six forfeits, safe start+star squares, capture → yard
  + extra roll, exact home + extra roll, pass, finishing order, chooseMove AI, 15×15 board geometry), snakes.ts (classic board,
  exact finish / bounce back, six again, validated custom boards, zig-zag squareCell). Wired like the 2D kit; AKB entry.
- Next in the pack (separate PRs): chess; cards (no money — Teen Patti ranking, rummy melds); carrom physics; cricket.
- Locked by `tests/indiaBoardGamesFollowTheRules.test.ts` (reversion: safe squares ignored / overshooting home → 2 fail).

## 2026-11-19 — India games pack (b): chess (branch `claude/game-board-chess`)
- `src/game/board/chess.ts` added to `generate_board_games`: FEN in/out, legal moves (castling never out of/through/into check,
  en passant, promotion), SAN with disambiguation and +/#, status (checkmate, stalemate, fifty-move, threefold repetition,
  insufficient material), movesFrom for tap highlighting, an alpha-beta computer player (depth 1/2/3).
- The move generator matches the published perft counts on five standard positions (start, Kiwipete, positions 3–5).
- Locked by `tests/chessFollowsEveryRule.test.ts` (reversion: castling through check / en passant leaving the pawn → 4 fail,
  including two perft counts).

## 2026-11-19 — India games pack (c): card games, for fun only (branch `claude/game-board-cards`)
- `src/game/board/cards.ts` added to `generate_board_games`: deck/deal/shuffle, Teen Patti hand ranking and comparison (A-K-Q >
  A-2-3 > K-Q-J; K-A-2 not a sequence), Indian rummy melds (pure/impure sequences, sets, wild + printed jokers; a jokers-only group
  is not a meld), declaration rules (all 13 grouped, two sequences, one pure), points (faces 10, jokers 0, no pure → all count,
  cap 80), bestGrouping (exhaustive, bounded).
- Points / pretend chips only: the recipe, catalog and prompt forbid real money, deposits and cash prizes (India's 2025 ban).
- Locked by `tests/cardGamesRankAndDeclareCorrectly.test.ts` (reversion: A-2-3 ranked low / no pure-sequence rule → 2 fail).

## 2026-11-19 — India games pack (d): carrom (branch `claude/game-board-carrom`)
- `src/game/board/carrom.ts` added to `generate_board_games`: real sizes in mm (740 board, coin r 15.9, striker r 20.6, pocket
  r 22.25), elastic disc collisions by mass with restitution, constant friction, cushion bounces, corner pockets, a 240 Hz step
  with 60 fps animation frames; rules — own coin continues, striker foul returns a coin, the queen pending → covered or returned,
  no last coin before the queen, board won with points (opponent coins left + 3 for the queen).
- Note from the tests: the striker is ~3× a coin's mass, so a hard straight shot follows the coin into the pocket (a foul) —
  real-board behaviour, kept on purpose.
- Locked by `tests/carromPlaysLikeTheRealBoard.test.ts` (reversion: no collision impulse / uncovered queen kept → 4 fail).

## 2026-11-19 — India games pack (e): cricket (branch `claude/game-board-cricket`)
- `src/game/board/cricket.ts` added to `generate_board_games`: legal balls/overs, wides and no-balls (a run, re-bowled, free hit —
  only run out on a protected ball), strike rotation on odd runs and at over end, the new batter at the dismissed end, innings
  end on overs/all out/target, chase and result text ("won by N wickets (M balls left)" / "by N runs" / tie), run rates, and
  timing-based batting (shotFromTiming: perfect → boundary, going big → six but riskier, miss → bowled only on the stumps).
- This completes the India games pack: Ludo, Snakes & Ladders, chess, cards (for fun), carrom, cricket.
- Locked by `tests/cricketScoresLikeAScorer.test.ts` (reversion: free hit ignored / no change of ends → 2 fail).

## 2026-11-19 — Game gap P2: power-ups and loot drops (branch `claude/game-powerups-loot`)
- Gap: no timed boosts (hand-rolled setTimeouts kept running in the pause menu and survived a restart) and no drop tables.
- Kit: `core/powerups.ts` (define/give/active/level/remaining/value/list/clear; refresh/extend/stack; onStart/onEnd; events),
  ticked by Game.fixedUpdate inside the gameplay block (frozen by hit-stop, dialogue and pause), cleared on GAME_STARTED; Hud
  PowerUpBar (icon, time ring, level). `core/loot.ts` (createLootTable: weights, rarities, nothing entries, amounts, pity,
  chances(), LOOT_DROPPED).
- Locked by `tests/powerUpsAndLootWork.test.ts` (reversion: no clear on a new round / no pity → each fails).

## 2026-11-19 — Game gap P2: share the score + on-device leaderboard (branch `claude/game-share-leaderboard`)
- Kit: `core/leaderboard.ts` (top ten per game id on the device, sanitised on read; record → place; isLatest), recorded by
  Game on GAME_OVER / GAME_WON under `leaderboardId` (the gameId option). Hud: DeviceLeaderboard ("Best on this device", top
  five, this round highlighted) and ShareButton (`shareScore`: Web Share → clipboard → hidden), EN/HI strings.
- Honest by design: labelled "on this device"; the prompt forbids claiming a worldwide board without an online service.
- Locked by `tests/theScoreCanBeSharedAndClimbed.test.ts` (reversion: the shell not recording rounds → fails).

## 2026-11-19 — Game gap P2: accessibility (branch `claude/game-accessibility`)
- Settings gain Reduce motion (no camera shake; on by itself on a first visit when the device prefers reduced motion), Large
  text (menus and top bar at zoom 1.25), Colour-blind colours (Okabe–Ito palette for the health bar and minimap markers) and
  Captions (CaptionBar: words for important sounds — hit, enemy down, pickup, reload, empty, boss, level up…, EN/HI).
- Locked by `tests/everyPlayerCanPlay.test.ts` (reversion: the shake ignoring Reduce motion → fails).

## 2026-11-19 — Game gap P2: Continue, pointer lock, credits (branch `claude/game-continue-pointerlock`)
- `options.save`: Game loads the kit state on start, saves on pause / game over / win / level complete / page hide; the start
  screen offers Continue + New game (state `hasSave` / `clearSave`; `Game.newGame`). Opt-in on purpose: only the kit's state
  is saved, not a world the game builds itself.
- Pointer lock (desktop, default on, `pointerLock: false` to opt out): captured on Play and on a canvas click during play,
  released by pause / game over / win / menu; the browser dropping the lock mid-play (its Esc) pauses the game.
- `options.credits` → a Credits button and panel on the start screen.
- Locked by `tests/continuePointerLockAndCredits.test.ts` (reversion: no autosave / no pause on lock loss → 2 fail).

## 2026-11-19 — Game gap P2: grenades and aim assist (branch `claude/game-grenade-aimassist`)
- `systems/grenade.ts`: throwVelocity, simulateThrow (gravity, ground height, bounce, friction, rolling stop, fuse — the same
  path for the aim arc and the throw), blastDamage (linear falloff to the radius, minDamage, cover blocks, impulse away).
- `systems/aimassist.ts`: a partial pull (strength) toward the target nearest the crosshair inside a cone and in range, with an
  optional line-of-sight test; never a snap; touch/gamepad only (prompt line).
- Locked by `tests/grenadesAndAimAssistWork.test.ts` (reversion: blast through cover / full snap → 2 fail).

## 2026-11-19 — Game gap P2: local 2-player (branch `claude/game-local-2p`)
- `core/input.ts`: PLAYER1_ACTIONS (the defaults without the arrows) and PLAYER2_ACTIONS (arrows + nearby keys), and
  `new Input(target, map, { padIndex })` so each player reads only their own gamepad.
- `three/splitscreen.ts`: splitRects (side by side when wide, stacked when tall) and renderSplit (viewport + scissor per camera,
  aspect set per view).
- Game `players: 2` → two inputs (polled and ended every step), `ctx.players`, `ctx.splitScreen(camera)`; render() draws the
  split when a second camera is set. The game builds player 2's body; touch drives player 1 only. Same-device play only —
  online multiplayer needs a server (not built).
- Locked by `tests/twoPlayersShareOneDevice.test.ts` (reversion: shared arrows / no split render → 2 fail).

## 2026-11-19 — Game gap P2: crafting (branch `claude/game-crafting`)
- `core/crafting.ts` over the bag: define / missing / canCraft / craft (every ingredient or none; a result with no room in the
  bag gives the ingredients back) / list; ITEM_CRAFTED. The bag screen gains a "Make" list: each recipe, what it needs (have/need)
  and a Craft button enabled only when it can be made.
- Locked by `tests/craftingTakesAllOrNothing.test.ts` (reversion: partial take / no give-back → 2 fail).
## 2026-11-19 — failedbr #2452 (6aed1d6e) autopsy: four silent minutes of `bash` reads

User-stopped at 248 s with nothing written. Q-2940: the exploration guard ignored `bash` reads → one conservative
`shellInspection.ts` definition; the guard counts a read-only `bash` as a read. Q-2941: the gate called a failed
read a "build-breaking blocker" → a read cannot break the build. Q-2942 (contract unknown for an unknown title) and
Q-2943 (Play Store research time) OPEN; Q-2944 → Q-2889.

## 2026-11-19 — failedbr #2437 (fe73bca3) autopsy: a READY app ended as "did not succeed" at the wallet stop

The real defect (a CSS `//` comment breaking the production build) was fixed at 341 s and the app was 100/100 READY at
525 s; the builder then started optional palette work and the wallet stop fired at 537 s. Q-2945 (fixed in #4346): the
palette rule judged a canvas renderer's artwork colours — that false finding started the polish. Q-2946 🟡 for the
admin (billing): finish instead of starting extras when the app is ready and the bill nears the balance — recommended.
Q-2947–Q-2949 OPEN (edit-miss watch, browser-tool outages without detail, Surplus availability).
- **Q-2946 decided by the admin (option a) and built in #4346:** a READY fresh build on a nearly-spent wallet finishes (no
  more tools; the summary is the next turn), and every build — edits included — is told once to skip optional polish when
  the wallet is ≥ 80% spent. No price or charge changes; the wallet stop remains the net.
- **Q-2950 (admin 2026-11-19): an edit is priced by its project's history before it starts.** The admission gate's estimate
  is now the larger of the prompt estimate and the median real cost of the workspace's last 5 builds (same billedAmountInr),
  so a short "fix this" prompt on a big project no longer slips under a low balance and stops mid-build.

## 2026-11-19 — Game gap P2: aircraft and flight (branch `claude/game-flight`)
- `three/flight.ts`: createAircraft (procedural jet / prop, nose +Z), createFlightState, flyAircraft (throttle spool, thrust vs
  drag, climb costs speed, lift fades to zero at the stall → soft controls, nose drop and sink, bank-to-turn with self-levelling,
  runway steering, take-off only above take-off speed with the nose up, touchdown: gentle → landing, steep / banked / nose-down →
  crash, ground height followed), flightInput (W nose up, A/D roll, Shift / brake throttle).
- Honesty fix: the architect prompt and the Athree map's "NOT built yet" list both said aircraft were not built — now they name
  the flight kit (buildings remain not built).
- Locked by `tests/aPlaneFliesLikeAPlane.test.ts` (reversion: no sink without lift / no crash check → 2 fail).

## 2026-11-19 — Game gap P2: a death the player can see (branch `claude/game-death-topple`)
- `Humanoid.die(fromFront)` / `revive()` / `isDown()`: the body topples from the hips onto the ground over 0.6 s (backward
  from the front, forward from behind), knees buckle, arms fling; while down it neither walks nor acts.
- Game drops the player's body on PLAYER_DIED and stands it up on PLAYER_SPAWNED / GAME_STARTED; the prompt tells the builder
  to topple enemies before removing them.
- Locked by `tests/aDeathIsSeen.test.ts` (reversion: no shell wiring / walking while down → 3 fail).

## 2026-11-19 — failedbr #2452 / #2437 / #2470 resolved (#4346 merged)

Closed Q-2940, Q-2941, Q-2945, Q-2946, Q-2950, Q-2951, Q-2952 (IDs appended to `docs/claude/BUILD_REPORT_QUEUE_CLOSED.txt`).
- Q-2940/Q-2941 (#2452): a read-only `bash` command counts as a read for the exploration guard and can never be a release-gate blocker (`shellInspection.ts`).
- Q-2945 (#2437): canvas / three.js scene renderers are excluded from the palette count (`isSceneRenderer`).
- Q-2946 (#2437, admin option a): a READY fresh build on a wallet ≥ 80% spent finishes instead of spending the balance on polish.
- Q-2950 (admin request): an edit's admission estimate is floored by the median real cost of the workspace's last 5 builds. CI caught a TDZ ReferenceError in the first version (the route read `workspaceId` before its declaration); fixed by deriving the lease workspace id before the first admission check, with a source guard.
- Q-2951 (#2470): THIS turn's real-browser render opens the done check at once; a delegating architect's 8 steps never reached the every-10th-step check.
- Q-2952 (#2470): after an 8 s head start the fallback scope classifier runs in parallel; the loser is cancelled as `answered_elsewhere` (info, never a Surplus failure).
- Also: `aKeyPopupIsNotCountedAgainstTheBuild` made deterministic (controlled clock).
Still open from these reports: Q-2942, Q-2943, Q-2947, Q-2948, Q-2949 (see the queue). #2469 and #2454 were autopsied by other sessions (Q-2881–Q-2890, Q-2784+).
## 2026-11-19 — 3D games were blamed for our checker's missing WebGL (Q-2698)
- Live in builds 2439–2476: every 3D game scored "Controls 0 · 0 fps · no canvas" and the user was told the controls
  do nothing, while the game had rendered its own "Error creating WebGL context" screen inside the playtest.
- Root: platform browsers in the sandbox launched without software-WebGL flags; the fallback Playwright install was
  unpinned (newer Chromium dropped the automatic SwiftShader fallback). Fix: `SANDBOX_BROWSER_ARGS` (one list, every
  launch, census test), `SANDBOX_PLAYWRIGHT_VERSION` pinned (= Dockerfiles), honest `checkerLacksWebGL` verdict.
  Real-Chromium test, reversion-proven. Watch the next 3D build for real fps / a scored Controls dimension.
## 2026-11-19 — The model library reaches existing games (add_library_models)
- The seed added library models only to NEW games; in an existing game the builder could only search metadata.
  New run_recipe tool `add_library_models`: same rollout gate, downloads, proofs and durable saves as the seed, merged
  into the game's loader/manifest/credits; the user's assetCustomizations.ts is never replaced; the runtime is written only
  when missing or too old for the new loader. Honest answers when the library is off, a name is not in it, or the sandbox
  cannot write binary files. Verified end-to-end: castle + motorcycle added to a built village game, 8/8 models in Chromium.

## 2026-11-19 — The Game library on screen (item 3 of the admin's next-level list)
- **What:** Pro → mode button → **Game library**: a searchable, filterable grid of all 259 reviewed models with a picture
  each; tapping one fills the composer with "add the <name> model … (library id: "<id>")" — nothing runs until sent.
- **Server:** `GET /api/agentv3/game-library` (signed-in, free, no model call; `enabled` is the same per-account gate the
  builder uses) and `GET /api/agentv3/game-library/thumb/:hash` (serves only a catalogue-hash file).
- **Exact model:** `add_library_models` takes `{ id }`; other models serving that id's subjects are left out of the call's
  catalogue, so the tapped cow is the cow that arrives.
- **Pictures:** 258 webp renders (1.1 MB) in `assets/game-models/thumbs/`, which the production image already copies;
  `scripts/library/renderLibraryThumbnails.mts` renders missing ones after a new batch. The one CC BY model has a plain
  tile (a picture would need an on-screen credit; users never see source names). Names drop internal batch prefixes.
- **Proof:** the real picker bundled into Chromium against the real server function: grid renders, search "cow" → "Cow",
  tap → composer holds the id instruction, no page errors. Locks: `tests/theGameLibraryIsOnScreen.test.ts` (12).

## 2026-11-20 — failedbr #2424 / #2417 / #2415 / #2421 resolved (#4357 merged)

Closed Q-2954, Q-2956, Q-2958, Q-2960 (IDs appended to `docs/claude/BUILD_REPORT_QUEUE_CLOSED.txt`).
- Q-2954 (#2424): a provider-exhaustion error event ("All NavBharatAI Pro providers failed …") is filed in the provider phase, so it is never a build-breaking blocker of an app that rendered.
- Q-2956 (#2417): a planner cancelled by a stop is `stopped`, never "failed … the build proceeded directly".
- Q-2958 (#2415): an attached text file is written whole to `attachments/<name>` before the builder starts (the prompt copy is capped at 20,000 characters); the builder is told the path and not to search the disk. The write lives in `writeAttachmentFilesInStep`, because the chat handler is at its TS2563 branch budget (CI caught the first version at 538/537).
- Q-2960 (#2421): `SIMULATED_RESULT_RE` names generated media (video/audio/blob/clip/render); a not-ok build's writes are scanned and recorded for the admin.
Still open: Q-2953, Q-2955, Q-2957, Q-2959, Q-2961 (blocked, each with what it needs), plus the earlier Q-2942/Q-2943/Q-2947/Q-2948/Q-2949.

## 2026-11-20 — Game audit 2 (#2): the seed lays down the genre's own kit (branch `claude/game-seed-by-genre`)
- Evidence: failedbr #2435 (Mario) got only loop/sound/music and hand-wrote platformer physics, renderer and touch; #2470
  (Monopoly-style "business game") got the real-time kit and no rules engine. generate_game_2d / generate_board_games
  existed but ran only if the model chose to.
- `gameKitPlan`: a 2D game that moves a body (platformer, runner, shooter, arcade, fighting) adds `generate_game_2d`; board
  and card games, and cricket, add `generate_board_games`. 3D plans unchanged. The handoff names each kit (2D: never a
  hand-written jump or tile collision; board: rules come from the pack, card games never for real money).
- `theRacingCarShowedItsHeadlights` updated to its real point (never 3D; the 2D kit may follow the shared three).
- Locked by `tests/aGameGetsItsGenresKit.test.ts` (reversion: no genre push → 3 fail).
## 2026-11-20 — Game audit 2 (#4): a browser intervention is not a crash (branch `claude/playtest-honest`)
- Evidence: failedbr #2477 — a game scoring 86 (answered up/W, left/A, right/D, Space, drag) was gated "the game was played
  and is not playable (runtime error)" because Chrome logged "Unable to preventDefault inside passive event listener".
- The playtest's console watcher now records browser interventions apart (`run.interventions`, BROWSER_INTERVENTION);
  they no longer count as errors (Stable unaffected) and become the SOFT defect GAME_DEFECT_TOUCH_SCROLLS with the fix
  ({ passive: false } / touch-action: none) — honest (the page can scroll under the thumb), never "not playable".
- Not duplicated: the 0-fps / "Controls 0" half of item #4 was already fixed by d54d489d (software WebGL; a checker without
  WebGL no longer blames the game). The "no on-screen controls" (#2435) and start-button (#2475) items stay UNVERIFIED —
  the reports do not show why the detector missed; no detector change without that evidence.
- Locked by `tests/aBrowserInterventionIsNotACrash.test.ts` (real browser; reversion: interventions as errors → fails).
## 2026-11-20 — Game audit 2 (#7): one word for loudness across the kit (branch `claude/game-playoptions-trap`)
- Evidence: failedbr #2435 spent three turns on `TS2353 'volume' does not exist in type 'PlayOptions'` — audio.play and
  playMusic take `volume`, the melody player's PlayOptions said `gain`.
- The melody player now takes `volume` (gain kept as an alias; volume wins when both are given).
- Locked by `tests/oneWordForLoudness.test.ts` (recording AudioContext; reversion: volume ignored → 2 fail).
## 2026-11-20 — Game audit 2 (#1): a 3D game that skips the kit's shell is told what it loses (branch `claude/game-shell-mounted`)
- Evidence: failedbr #2475 / #2476 / #2477 (three "pubg / bgmi jaisa" games, all asking for a joystick). The shell
  (GameCanvas.tsx) was seeded each time; the builder wrote its own `new THREE.WebGLRenderer()` + rAF loop, so the shell's
  touch joystick, menus, HUD and music never existed (#2476: d-pad handlers "empty functions", off-screen; #2477: arrows
  "changed nothing"). The prompt already said "mount <GameCanvas>"; the only signal was an end-of-build "kit component not used".
- `src/server/AgentV3/shellBypass.ts`: shell present + a game's own file builds its own renderer (WebGLRenderer or r3f) +
  nothing of its own mounts GameCanvas / new Game / RacingRoadGame → a write-time repair note naming what is lost and the exact
  way back, and a readiness WARNING (not a blocker: the game may still run on a desktop). 2D canvas games, board games and
  projects without the shell are never flagged (Q-2715 preserved).
- Locked by `tests/aGameIsBuiltOnTheShell.test.ts` (reversion: renderer detection off → 3 fail).
## 2026-11-20 — Game audit 2 (#3): the 2D kit carries the touch controls (branch `claude/game-2d-touch`)
- Evidence: failedbr #2435 (Mario) grepped the kit's Input for touch, found none, hand-rolled buttons and scored Phone 0. The
  touch joystick and buttons lived only behind the 3D shell.
- `src/game/2d/touch.ts`: mountTouchControls2D(stage, input, options) — the SAME TouchControls the 3D shell uses (joystick,
  Jump + Attack by default, no camera drag), driving the same Input as the keyboard; the recipe layer adder brings
  ui/touchControls.ts with it. The kit's instructions and compiled example show it; AppKnowledgeBase updated.
- Locked by `tests/a2DGameIsPlayableOnAPhone.test.ts` (real modules on a fake page; reversion: no 2D defaults → fails).
## 2026-11-20 — failedbr #2408 / #2342 / #2339 resolved (#4360 merged)

Closed Q-2962, Q-2963, Q-2965 (IDs appended to `docs/claude/BUILD_REPORT_QUEUE_CLOSED.txt`).
- Q-2962 (#2408, #2428): a failed Surplus turn's duration feeds the build's waste ledger (`onSurplusAttemptWasted`), so "no engine wasted any time" can no longer be said over a 90 s Surplus hang.
- Q-2963 (#2342): on an edit, the aggregate project-score blocker no longer forces an unfinished-resume (`isProjectScoreBlocker`); the verdict half is Q-2964 (admin decision).
- Q-2965 (#2339): a seeded game kit always skips the fast lane (`fastLaneSkipsGame(domain, env, kitSeededCount)`), so the lane can never regenerate files over the kit.
Still open: Q-2953, Q-2955, Q-2957, Q-2959, Q-2961, Q-2964 (blocked, each with what it needs).

## 2026-11-20 — Build report 05eb30ba: five report-honesty rows (Q-2746, Q-2747, Q-2748, Q-2751, Q-2752)
| ID | Problem → root cause → class | Fix · lock (each proven by reversion) |
|---|---|---|
| Q-2747 | "$0.0000 instead of $0.0000" → `toFixed(4)` rounds < $0.00005 to zero → 15 report amounts in 8 files | `usdAmount` (sub-cent keeps 2 significant digits) · `aSmallAmountIsNotPrintedAsZero` + census |
| Q-2746 | "longer than the 0s build timing window" → a pre-build check that ran before the timer was taken as the build's first call → the class five earlier autopsies (BR1958/84/85/86/95) only reworded | plain note, replaced by the build's own first call · `aPreBuildCallIsNotTheBuildsFirstCall` |
| Q-2748 | `startTier: "sonnet"` on Weak builds → the report printed the band key (historical model names); 2b0a3ed5 added a label but kept the key | report carries only `complexityBand`; telemetry keeps the key; legacy reports map back · `aBandIsNotAModelInTheReport` |
| Q-2751 | LADDER_DEPTH counted the scope call on an empty build → scope tokens share the build's ledger | `PHASE_SCOPE` at both scope writers; ladder skips it; bill unchanged (tested) · `aScopeCheckIsNotALadderSlice` |
| Q-2752 | domain stems inside unrelated words → census vs 275k words found 9 (parental→booking, impatient→healthcare, blending→fintech, …) | each guarded against that word only · `aWordInsideAWordIsNotADomain` (old code: 8 fail) |

**Discovered, not folded in:** Q-3101 — 488 unbounded FEATURE stems match inside source code, so most features read as already present. Fixing it changes what every domain build is told to add; it needs a measured before/after of its own.
## 2026-11-20 — An old game would not open from history: "HTTP 404: Conversation not found" for a `v3_` id

Admin report: opening an old game showed "This chat's transcript hasn't reached the server yet …" with the
diagnostic `server refused the transcript (HTTP 404: Conversation not found.) for id v3_95865209-…`.

- **Root cause.** The history list loads only the 50 most recent apps from the server; an older app shows up
  only through its `chat_sessions` row, whose id is `v3_<sid>`. To open it, `candidateConversationIds` tried
  `v3_<sid>`, `agentv3-<uid>-<sid>` and `agentv3-anon-<sid>`. It did NOT try the bare `<sid>`, where a
  **duplicated app's** record lives, and nothing could find a record saved under a **random id** (builds from
  before conversationId = workspaceId). Answer: 404.
- **Class.** Two copies of "which ids can a session's record have" had drifted: `conversationIdCandidatesForWorkspace`
  (build path) knew the bare-session-id case, `candidateConversationIds` (open, delete, pin, duplicate, rename,
  unsend) did not.
- **Fix.** `candidateConversationIds` now derives the session from either form of the id and reuses
  `conversationIdCandidatesForWorkspace`, so both lists are one. `conversationLookupIds` adds, as the last
  resort, the ids of this user's records for that workspace (`listIdsByWorkspace`, an owner-filtered
  two-field equality query that needs no composite index). All six routes use it.
- **Locked by** `tests/aDuplicatedAppOpensFromHistory.test.ts`, using the report's session id. Reverting
  either half fails it (2 tests fail for the candidate list, 1 for the old-record lookup). A census guard
  fails if a route builds its own candidate list again.
- **Not verified.** Which of the two shapes this specific game had: production data was not readable from
  this session. **Watch for:** the same game now opens with its messages.
## 2026-11-20 — failedbr #2318 / #2306 / #2399 resolved (#4361 merged)

Closed Q-2966, Q-2968, Q-2969, Q-2970 (IDs appended to `docs/claude/BUILD_REPORT_QUEUE_CLOSED.txt`).
- Q-2966 (#2318): no style/accessibility hand-back once the build has said "wrapping" (75%) or "final" (90%) — a ready app is delivered, not polished into the cap (`polishHandBackAllowed`, both sites).
- Q-2968 (#2306): the `coming-soon` fake marker ignores the honest disclosure NO_FAKE_FEATURE_RULE demands (a line naming a credential and where to add it).
- Q-2969 (#2306): a GET probe of the app's own localhost (and `sleep`) is a read-only inspection, never a release-gate blocker (`isLocalhostProbe`).
- Q-2970 (#2399): an import of a `.d.ts` file resolves in the readiness analyzer.
Still open: Q-2953, Q-2955, Q-2957, Q-2959, Q-2961, Q-2964, Q-2967, Q-2971 (blocked, each with what it needs).

## 2026-11-20 — Business (vyapaar) board game + "a game is not its theme" (game-gap audit item)

- **Gap 1 (missing engine):** no rules for the property-trading board game. `BoardGamesGenerator` now writes
  `src/game/board/business.ts` — original 36-square board (Indian cities, 4 transport, 2 utilities), pretend money only:
  buy/decline, rent (set doubles, houses, hotel), chance, taxes, Start, doubles/three-doubles jail, jail fine/tries,
  even building, mortgages, automatic fund-raising, bankruptcy to the creditor, winner, computer player. Not built:
  auctions, trading (stated in the engine, the instructions and the AppKnowledgeBase entry).
- **Gap 2 (root cause, wider class):** the request never reached a game engine. `selectDomain` let a game's THEME
  pick the domain — 10 of 14 themed game prompts measured (restaurant, hospital, bank, shop, school, stock-market,
  gym, pizza, real-estate) and every "gaadi wala" racing game (logistics) were read as a business, and `gameKitPlan`
  seeds the kit only for domain 'game'. Class: a word that describes the game's world chose the app type.
  Fix in the ONE place a domain is chosen: `asksForAGame` — a game as the thing built, with no app/website/portal
  named beside it, is a game; "game" as a modifier (schedules, slots, store, tickets) names no game (the reverse slip:
  "cricket academy app with game schedules" was a game); a game moving real money keeps the BR1985 fintech precedent.
  Corpus diff over 1,630 game-mentioning test strings: 44 changed, every real prompt in the right direction.
  `gameIntent` board genre now covers business game / vyapaar / monopoly / व्यापार का खेल.
- **Lock:** `tests/aBusinessGameFollowsTheRules.test.ts` (34) incl. 40 four-computer games with invariants each turn;
  12 reversion proofs each fail. Strict compile of the generated pack caught one union-narrowing error (fixed).
## 2026-11-20 — Game kit: swipe input + endless-runner rules (game-gap audit item)

- **Gap:** no swipe and no runner in the kit, so every runner was hand-written: a row with no way through, a fast
  run tunnelling through an obstacle between two frames, lanes backwards, touch listeners the browser refused to cancel.
- **Fix:** `GameRuntimeGenerator` (seeded into every game) now writes `src/game/core/swipe.ts` (`bindSwipe`: a swipe
  presses the same actions as the keys — left/right, up → jump, down → slide; pointer events + `touch-action: none`,
  fires mid-swipe, ignores presses that start on a button) and `src/game/core/runner.ts` (`LaneRunner`: lanes, jump,
  slide, coins, speed ramp, seeded course; every row leaves a free lane reachable at the arrival speed; swept hits).
  Declared in the ToolCatalog include list; AppKnowledgeBase `game_2d_kit` updated.
- **Lock:** `tests/aRunnerAlwaysHasAWayThrough.test.ts` (11) — an autopilot survives 60 seeded 90-second courses at
  max speed. Reversion proofs: no free lane, endpoint collision, speed-blind gap, lanes backwards, repeat swipes,
  flipped up/down each fail. A dead one-lane guard found by reversion was removed.
## 2026-11-20 — Game kit: get in and out of vehicles (game-gap audit item)

- **Gap:** walk-and-drive games hand-wrote Use + ctx.follow, and the walking body kept moving, unseen, while the player
  drove (player.update ran every step with the same axis), so getting out put the player wherever it had wandered.
- **Fix (opt-in, so no existing game changes):** `ctx.vehicles.add(car)` in the shell. Use beside it gets in (body held
  still and hidden, camera chases the car, the shell drives it); Use again gets out beside it, braking first at speed;
  the parked car is created at speed 0 and stays put. If the game drives it itself, the game wins (no double driving).
  On exit the car stops being "the player's car" so the camera returns to the player. Phones keep the Use button.
  Hud shows "E — get in / get out" (EN + HI). Shell instructions + AppKnowledgeBase updated.
- **Lock:** `tests/aPlayerGetsInAndOutOfACar.test.ts` (7, real Game.ts/objects/input/controller). 9 reversion proofs fail.
  Generated kit tsc before/after: identical 33 pre-existing errors (missing @types/three). The typecheck caught an
  unescaped apostrophe in the new knowledge-base text before push.
## 2026-11-20 — Game kit: key rebinding (game-gap audit item)

- **Gap:** keys were fixed; the Input constructor took a map but nothing saved or changed one, and Settings had no Controls.
- **Fix:** runtime `src/game/core/keybinds.ts` (`loadKeyBindings` over the defaults, sanitised; `rebindKey` in place so the
  live Input sees it at once, takes the key from other actions and gives a keyless action the old key; `resetKeyBindings`;
  `captureKey` consumes the key, Esc cancels; Escape is never bindable; mouse/pad/touch untouched). The shell's Game builds
  its Input on the saved keys (`game.keys`, null for two players), and Settings gets a Controls section on keyboard devices.
  New strings in English and Hindi. ToolCatalog include list + AppKnowledgeBase `game_menus_settings` updated.
- **Lock:** `tests/aPlayerCanChangeTheKeys.test.ts` (9, real keybinds + input). 8 reversion proofs fail. Generated kit
  compiled with tsc before/after: identical 33 pre-existing errors (all the missing `@types/three` in this repo).
  `royalePracticeLifecycle` harness gained the new import's stub.
## 2026-11-20 — Autopsy failedbr #2478 ("make a bgmi for me"): royale requests get the big map, laid down by the platform

Admin: a PUBG / Free Fire / BGMI request must get a big, realistic map; the library already has maps that were not used.
The build failed at the 25-minute cap with a 30×30 grid and five cubes. Root causes, each fixed as a class (rows Q-3010 – Q-3019):
- **Q-3010** The Athree map was a system-prompt line only; the 3D seed never laid it down. `gameKitPlan` now seeds
  `generate_athree_map` (the recipe's own `athreeMapIntent` decides) and the handoff says build IN it.
- **Q-3011** "make a bgmi for me" was domain "general". One shared title reader (`lib/wellKnownGameTitles`); apps ABOUT a game stay apps.
- **Q-3012** Milestone turns lost the user's game (contract genre "unknown"). `gameIdentityLines` + `ToolDispatcher.worldRequest()`.
- **Q-3013** "ground plane" was an aircraft / flight map. Shared `withoutNonObjectSenses` gained geometry senses.
- **Q-3014** The failure itself: `inventory.use()` read as React's `use` → 15-minute false chase. Member calls are hooks only on a PascalCase namespace.
- Open: Q-3016 (racing starter shipped for every 3D game), Q-3018, Q-3019; Q-3017 blocked on the admin's model-library rollout decision.
Locked by `tests/aRoyaleRequestGetsTheBigMap.test.ts` and `tests/aMethodNamedUseIsNotAHook.test.ts`, each half reverted-and-failed.
## 2026-11-20 — failedbr #2379 / #2337 resolved (#4362 merged); autopsies #2320, #2311, #2295, #2279, #2278, #2271 (#4369)

Closed Q-2972, Q-2973, Q-2976 (IDs appended to `docs/claude/BUILD_REPORT_QUEUE_CLOSED.txt`).
- Q-2972 (#2379): a dev server backgrounded in a subshell is unwrapped before the probes are dropped (`unwrapSubshellBackgroundedServer`).
- Q-2973 (#2379): emoji/symbol-labelled buttons are controls in the pasted-page facts (`symbolControl`).
- Q-2976 (#2337): the missing-privacy-policy note is ADVISORY — tell the user, build nothing unless asked.

Ledger for the reports worked in #4369 (rows Q-2977…Q-2984 in the queue):
- #2320 — same class as Q-2963 (edit held to the project score), already merged in #4360. No new row.
- #2311 (stopped fast-lane build) — CSS_CLASSES_UNDEFINED on a stopped tree: already RESOLVED by #4259 (BR1988), merged after this build ran. The unlabelled NotesManager field: Q-2977 🟡 (the report lacks the file's text).
- #2295 (a bare `src/game/fx/synth.ts` read as a game build, game kit seeded, "Add credits" upsell) — every item already RESOLVED on main: a source path alone is chat (`source-path-only`, 2026-11-16), chat intent seeds no kit, an answer-only turn gets no upsell (`answerOnlyNow`), and the Surplus failed-attempt usage hole was closed by #4320 (Q-2920). No new row.
- #2279 (GO CAR) — Q-2978 game words are one family; Q-2979 a game the kit owns is never split into project modules; Q-2980 a play screen is not held to a page title. Not new rows: the TOOL_ERROR write without a path (the instructive-error layer converged next turn, and a write with no path cannot be repaired without guessing); CSS_CLASSES_UNDEFINED on a stopped MODULE turn (BR1988 keeps module turns on main's warning by design, and Q-2979 removes the game instance); USAGE_NOT_REPORTED (#4320).
- #2278 (racing game) — Q-2981 a model's successful install re-stamps node_modules (sibling of the #4253 recipe-install fix); Q-2982 a seeded library is never rewritten for an importer's invented export; Q-2984 🟡 dead controls (game auto-repair is suspended by a security decision).
- #2271 (INDIAN MUSIC) — Q-2983 a music app's roadmap step got the game kit; Q-2985 an unguarded Supabase client is noted at write time; Q-2986 a blocked `.env` read lists the saved key names. Not a defect: the closing "previous work is still stopping" line is RC-4's deliberate wording, pinned by BR1964. Already resolved elsewhere: the 10-minute key wait counted against the build (#2431, `workClock.ts`, 2026-11-19); 41 "ENGINE_R1 failed" fallbacks are Q-2692 (another session's branch owns it).
Still open: Q-2953, Q-2955, Q-2957, Q-2959, Q-2961, Q-2964, Q-2967, Q-2971, Q-2974, Q-2975, Q-2977, Q-2984 (blocked, each with what it needs).

## 2026-11-20 — #4369 merged (failedbr #2279 / #2278 / #2271); autopsies #2264, #2263, #2257, #2256, #2255, #2246 (next PR)

Closed Q-2978, Q-2979, Q-2980, Q-2981, Q-2982, Q-2983, Q-2985, Q-2986 (IDs appended to `docs/claude/BUILD_REPORT_QUEUE_CLOSED.txt`): game words are one family; a game the kit owns is never split into project modules; a play screen needs no page title; a model's successful install re-stamps node_modules; a seeded library is never rewritten for an importer's invented export; a music app's roadmap step is not a game; an unguarded Supabase client is noted at write time; a blocked `.env` read names the saved keys. #4369's merge-base CI had one queue-retry-drill timeout (4002 ms on a lease claim — code the PR never touched); its single re-run passed.

Ledger for the next PR (rows Q-2987…Q-2989):
- #2263 — Q-2987 a handled missing camera in our checking browser is not an app defect (render filter + click explorer, one pattern).
- #2255 — Q-2988 "make my internet 5× faster" is the fifth impossible power; the builder is told and the honest alternative named.
- #2246 — Q-2989 a declined turn records OUTCOME_DECLINED (UPSELL_SUPPRESSED after a refusal deliberately stays a warning).
- #2216 — Q-3011 a model write that removes an untouched kit file's exports or class members is refused.
- #2208 — Q-3012 music-genre and AI terms are one unknown-name family; Q-3013 "<framework> Vite plugin not found in Vite config" is a configuration error, not a blind restart.
- #2193 — the free-build cost-ceiling class, Q-2240 (🟡 the admin's money decision; the report is added to that row).
- #2224 — Q-3010 the install stamp never creates a `node_modules` FILE (the 115 s reinstall-before-every-start on a dependency-free site); a static file server keeps its own host binding.
- #2264 — not new rows: the "📨 picked up your message" text that equalled the model's own narration came through `/api/agentv3/steer`, which sends only the composer's content (`sendSteer` in AgentV3Panel.tsx) — the user's own action, not an engine echo. The mock "realistic simulation" of video generation is the SIMULATED_RESULT class already fixed for videos (Q-2960, #4360). edit_file misses are the weak model's, met by the designed layer.
- #2257 — no defect: the user stopped 2.8 min in after the app rendered; the two warnings are accurate notes on an unfinished tree.
- #2256 (and #2252, same workspace) — the same class as Q-2979 (a game split into project modules, module 3 of 14); resolved by #4369.
Still open: Q-2953, Q-2955, Q-2957, Q-2959, Q-2961, Q-2964, Q-2967, Q-2971, Q-2974, Q-2975, Q-2977, Q-2984 (blocked, each with what it needs).

## 2026-11-20 — Real-money betting apps are not built; pretend-chip games are (admin point 9)

- **Admin decision:** "other app builder jo karte hai, same karo". Published policies: Bolt (StackBlitz) and Builder.io
  forbid UNLAWFUL gambling (Builder.io: only with licences); Replit lists gambling among illegal uses. India's Promotion
  and Regulation of Online Gaming Act, 2025 bans every real-money online game (offering/facilitating: cognizable,
  non-bailable). Same standard for an Indian platform ⇒ never the real-money part.
- **Fix:** `REAL_MONEY_GAMBLING` (`illegal`) in `illegalContentRules.ts` — subject (betting/casino/satta/poker/rummy/
  teen patti/fantasy league/lottery) AND context (deposit, withdraw, cash out, real money, cash prizes, UPI top-up,
  paise lagao/jeeto). Negated mentions skipped inside the pattern (before AND after), because the publish scanner has no
  exempt step and our own board-games kit says "Real-money play is not something this pack supports" beside Teen Patti.
  Exempt: de-addiction/helpline/awareness apps. All nine other Indian scripts (census), with word-end guards
  (ಚಟ/ಚಟುವಟಿಕೆ). The refusal now names the 2025 Act and offers the same game with pretend chips (EN + HI); all 7
  `blockMessage` callers pass `triage.ruleId` (census test). AppKnowledgeBase updated.
- **Lock:** `tests/realMoneyBettingIsNotBuilt.test.ts` (24). Reversion proofs: class, leading negation, trailing
  negation, exemption, generic message, a caller dropping the rule, the ಚಟ word-end — each fails.
## 2026-11-20 — #4375 merged (failedbr #2263 / #2255 / #2246 / #2224 / #2216 / #2208)

Closed Q-2987, Q-2988, Q-2989, Q-2990, Q-2991, Q-2992, Q-2993 (IDs appended to `docs/claude/BUILD_REPORT_QUEUE_CLOSED.txt`): a handled missing camera/microphone in our checking browser is not an app defect; "make the internet faster" is the fifth impossible power; a declined turn records OUTCOME_DECLINED; the node_modules stamp never creates a file (and a static file server keeps its own host); a model write that removes an untouched kit file's exports or class members is refused; music-genre and AI terms are one unknown-name family; "<framework> Vite plugin not found in Vite config" is a configuration error. CI caught one defect of the PR's own (an install-stamp test leaving temp dirs behind — moved to makeTempDir) before merge.
Still open: Q-2953, Q-2955, Q-2957, Q-2959, Q-2961, Q-2964, Q-2967, Q-2971, Q-2974, Q-2975, Q-2977, Q-2984, Q-2240 (blocked, each with what it needs).

Ledger, older reports (2026-11-20, #4377):
- #2169 — Q-2994 our browser's media limits (no H.264, a play()/pause() race) are not an app defect.
- #2205 — no new row: an edit turn on an existing app got no platform kit seed by design (the kit is never written over somebody's work); the model's own run_recipe laid it down safely; the four edit_file misses are the weak model's.
- #2196 — no new row: a 32-file app rendered at 7 min and the build kept writing until the 25-min cap — the free-tier convergence ceiling, Q-2240.
- #2163 — Q-2995 "गेम" (and "game" in the other Indian scripts) is a game: an all-Devanagari racing request now gets the kit.
- #2188 — not opened in full: stopped by the user at 51 s on "a game fully like Free Fire Max"; its class (a famous-game clone on the weak tier) is covered by the roadmap/kit path.
- #2155 — Q-2996 a missing plain stylesheet import (`./index.css`) is created deterministically.
- #2159, #2160 — no new row: SANDBOX_RECOVERY_UNAVAILABLE within 1 s; the refusal's admin-only reason was not in these 11-09 reports, and the report has carried it since #4253 (11-16).
- #2141 — Q-2997 Hinglish fillers (aisa, jismein, bhai…) are not subjects, so a new game order on an unrelated app is asked about instead of built into it.


## 2026-11-20 — Game kit: swimming (game-gap audit item)

- **Gap:** nothing in the kit knew what water was — a player who walked into a lake sank and walked along the bottom.
- **Fix:** motor `stepSwim` (pure: float at head-out depth by buoyancy spring, water drag, slower swim speed, Jump held
  up / dive held down, Jump at the surface climbs out); controller `setWater(level | (x,z)=>level|null)` with a 0.25 m
  exit margin so the edge does not flicker, breath (runs down under water, refills 4× faster, `onOutOfBreath` once a
  second), `swimming` / `underwater` / `breath` getters, reset clears it. New `crouch` action (C / Left Ctrl / Pad:11),
  rebindable in Settings → Controls (EN + HI label); the shell passes `diveHeld`. Instructions + AppKnowledgeBase.
  Not built (stated): swim animation, a phone dive button.
- **Lock:** `tests/aPlayerSwims.test.ts` (9, real motor/controller/terrain, incl. the sink-to-the-bottom baseline).
  8 reversion proofs fail. Generated kit tsc before/after: identical 33 pre-existing errors.
## 2026-11-20 — Game kit: match-3 engine (game-gap audit item)

- **Gap:** no match-3 rules; every one was hand-written (starting matches, dead boards with no reshuffle, holes after
  cascades, swaps accepted without a match) — and a match-3 request (genre `puzzle`) was never seeded with any engine.
- **Fix:** `src/game/board/match3.ts` in the board pack: deal with no runs and a guaranteed move; adjacent swaps only,
  refused without a match; cascades with chain scoring (10 × tiles × chain); line (4), area (L/T), bomb (5) tiles that
  chain-fire; gravity + seeded refill; reshuffle (same tiles) when stuck, fresh deal if no order works; hint; moves and
  target → won/lost; per-cascade steps for animation; deterministic per seed. `gameKitSeed` seeds the pack for match-3
  words (MATCH3, not other puzzles). ToolCatalog, instructions, handoff line, AppKnowledgeBase updated.
- **Lock:** `tests/aMatch3BoardIsAlwaysFair.test.ts` (10). 9 reversion proofs fail. Strict compile of the pack clean.
## 2026-11-20 — #4365 merged (Q-2746/2747/2748/2751/2752 closed); four more 05eb30ba-era rows fixed
Closed on merge of #4365 (IDs appended to `BUILD_REPORT_QUEUE_CLOSED.txt`): Q-2746, Q-2747, Q-2748, Q-2751, Q-2752 — ledger in the entry above.

| ID | Problem → root cause → class | Fix · lock (each proven by reversion) |
|---|---|---|
| Q-2750 | "a paid build would get 58 min" vs "29 min" in the same hour → both true: a deep build's window is doubled, the line never said so | `freeWindowLine` names the size when scaled · `aPaidWindowSaysWhyItDiffers` |
| Q-2753 | four file counts in one report (28/21/30/30) → four different sets, CHANGE_RECORDED the only one naming none | its scope is in the line · `everyFileCountNamesItsScope` |
| Q-2769 | JOURNEY_NOT_DERIVED told a list-driven form (`name={field.name}`) it had no names while accessibility scored 100 → the check reads names from source | the limit is said as the check's; real unnamed forms keep the remedy · `aFormBuiltFromAListIsNotUnnamed` |
| Q-2766 | `{ ReactComponent }` + `?react` (two SVG plugins' styles) → preview errors until rewired | named on write with the exact default-import fix · `anSvgImportUsesOnePluginsStyle` |

**Opened:** Q-3102 — a list-driven form gets no journey at all; the real fix reads field names from the running page.
## 2026-11-20 — #4377 merged (failedbr #2169 / #2163 / #2155 / #2141); autopsies #2158, #2133, #2122, #2116 (next PR)

Closed Q-2994, Q-2995, Q-2996, Q-2997 (IDs appended to `docs/claude/BUILD_REPORT_QUEUE_CLOSED.txt`): our browser's media limits are not an app defect; "game" in the Indian scripts is a game; a missing plain stylesheet import is created; Hinglish fillers are not subjects in the "add to this app or a new one?" check.
- #2139 — no defect: a "hack" request with photo, map and location was planned as a harmless map where users drop their own markers (no tracking, no cheat); the user stopped it at 22 s.

Ledger for the next PR (rows Q-3021…Q-3024):
- #2158 — Q-3021 a rule about how to build ("do not publish …", "after building, run …") and the staples of a small game (score, lives, restart) are not parts: a compact space shooter counted 22 and went to 14 project modules; it now counts 6 and builds as one app. Q-3022 opened: a list opener's colon still spans its whole line; scoping it per sentence needs the project gates re-measured. Also in #2158, already fixed and not given rows: "WASD" as an unknown service (#4369), and a stopped Surplus call filed under `claude-sonnet-4-6` on a Weak build (BR1992, 2026-11-16).
- #2133 — Q-3023 the orphan-stylesheet check reads Astro/Vue/Svelte component files (imports, `<link>`, `<style>` `@import`, Vue `<style src>`), and our `nbai-native.css` is written only together with the `<link>` that uses it. Q-3024 opened: the project graph never reads component-file imports, so three broken `.astro` imports were found only by full builds (the app had rendered at 135 s; the user stopped it at 743 s).
- #2122 — no defect: a battle-royale game rendered at 182 s; the user stopped it at 200 s.
- #2116 — no defect: a Marathi auto-rickshaw simulator was still rendering when the user stopped it at 219 s. Its "13 distinct colours" warning (identical in #2122) is the kit/scene-renderer class already excluded from the colour count by BR1954/Q-2311 and #2437.
- #2100 — Q-3025 a numbered list whose few items carry sub-bullets is not a spec in sections: a 40-part, three-role driver-booking app was sized small, went to the fast lane and then to the 25-minute cap; the project gate now fires. Q-3026 opened: the build ran on a sandbox holding another app's 30 files while the durable store was empty. Q-3027 opened: `App.tsx` went back to that app's version mid-build, and no event names the heal that wrote it.
- #2105 — Q-3028 🟡 blocked on the admin: an exact starter chip on a finished template still runs the model, which edited a working to-do app for 300 s against its "make NO edits" instruction; the model-free fix collides with #4253's Surplus authoring rule.
- #2094 — Q-3029 exam and classroom words (MCQ, PYQ, OMR…) are not unknown services. Q-3030 opened: the fast lane learns it cannot finish only after ~330 s of generation (here and in #2100). The 25-minute cap itself is the free-tier ceiling, Q-2240. Its final "the previous work is still stopping" line is deliberate (RC-4). #2094 is also the counter-case that keeps Q-3025's sections rule honest: a real sectioned spec stays sectioned.
- #2090 — Q-3031 a game whose subject is a game ("…cricket game") is a game even when it names a hospital, unless the other domain has more feature signals or the game handles real money (BR1985). Q-3032 a package-manager query (`npm list …`) is a read, not a build-breaking blocker (the #2452/#2306 class). The fast lane's ten `.png` jerseys were already refused at plan time since BR1952 (#4253, 2026-11-16).
- #2092 — no new row: a user stop at 96 s. The model wrote its own `GameEngine` over the kit's loop against the kit prompt; a 2D game drawing its own canvas is allowed (Q-2715), and the phone-playability cost is already checked at write time (`touchPlayableGame`). Its stopped call's Sonnet label was fixed by BR1992.
- #2086 — Q-3033 a roadmap step that invents a native mobile stack (React Native, Flutter…) over a Vite project is rejected, the BR1952 class. Its binary `.png` plan is the BR1952 plan-time refusal, already fixed.
- #2078 — no new row: a user stop at 50 s. The fast lane's "simulate the process and return a dummy blob" is the fake-media class failedbr #2421 already names.
- #2036 — Q-3034 every game-kit file now compiles under a strict app tsconfig (noUnusedLocals/noUnusedParameters): the only offender, TouchControls' unread `container` field, failed the user's typecheck and looped the builder. Its E2B-cap setup failure is Q-2929.
- #2065 — no defect: a "continue" turn rendered at 221 s and the user stopped it at 274 s; its two unused `@capacitor/*` warnings are advisory and true.
- #2064, #2037, #2001, #2003 — no new rows: #2064's "could not find @Composable" was fixed by BR1998; #2037's skipped write-time typecheck by autopsy 61279465; #2001's `?react` SVG imports by BR2001; #2001's and #2003's E2B concurrency refusals are Q-2929 (blocked on the plan limit).

## 2026-11-20 — Game kit: breakable objects (game-gap audit item)

- **Gap:** no breakables — a crate took hits and nothing happened, or a builder hid it and it kept blocking invisibly.
- **Fix:** 3D kit `src/game/three/breakable.ts`: `makeBreakable(obj, { health, pieces, color, debrisSeconds, onBreak })`;
  `breakableTargets()` joins the weapon's own target list and `hitBreakables(hits, from)` routes hits back (enemies
  untouched, stale hits on a broken crate ignored); at zero the object LEAVES the scene (stops blocking) and shatters
  into debris (object colour, flies away from the hit, gravity, bounce, settle, shrink, dispose geometry + material);
  broken objects leave the registry (WeakSet remembers them). The shell steps debris every frame and clears on dispose.
  ToolCatalog, 3D instructions, AppKnowledgeBase updated; lifecycle harness stub added.
- **Lock:** `tests/aCrateBreaksWhenHit.test.ts` (7, real breakable + real ProjectileSystem). 11 reversion proofs fail
  (three first slipped through — two were real test gaps, now covered; one was a dead mutation, redone on the guard).

Note (2026-11-20): the feature-stem row first opened as Q-2972, then Q-3020, and the list-form row as Q-3021 were renumbered Q-3101 / Q-3102 — each earlier number was taken by another session in parallel (two Q-3020 rows briefly existed on main).
## 2026-11-20 — #4380 merged (failedbr #2158 / #2133 / #2100 / #2094 / #2090 / #2086 / #2036)

Closed Q-3021, Q-3023, Q-3025, Q-3029, Q-3031, Q-3032, Q-3033, Q-3034 (IDs appended to `docs/claude/BUILD_REPORT_QUEUE_CLOSED.txt`): a rule about how to build and the staples of a small game are not features; a numbered list with a few sub-bullets is not a spec in sections; a stylesheet wired by an Astro/Vue/Svelte component is wired; exam words are not services; a game that names a hospital is a game (unless it handles real money); a package-manager query is a read; a roadmap step cannot invent a native mobile stack; every game-kit file compiles under a strict app tsconfig.
Still open, our own work: Q-3022, Q-3024, Q-3026, Q-3027, Q-3030. Blocked on the admin: Q-3028 (exact starter chip vs the Surplus authoring rule), plus the earlier blocked rows.

Also renumbered the queue-retry-drills row from a duplicate Q-3020 to Q-3035: two sessions had both taken Q-3020 on 2026-11-20 (3eea5cae1 and 6942a03ec), so `theQueueIdsAreUnique` was red on `main`.
- #2030 — Q-3036 a handler that admits it is pretend ("for demo purposes, we'll just show an alert", "…in a real application") is a HIGH authenticity finding; a fake Download button had shipped unnamed. Its "Play Store button" order enabled the deploy tool (PUBLISH_REQUESTED), which is the designed reading.
- #2005 — no new row: the E2B concurrency cap (Q-2929) refused setup and the fast lane still ran, with all 22 writes refused; since BR1952 a text-only lane is skipped against an unavailable workspace (`FAST_LANE_SKIPPED_SANDBOX`).

## 2026-11-20 — #4385 merged (failedbr #2030; #4380 rows closed; duplicate Q-3020 renumbered)

Closed Q-3036 (ID appended to `docs/claude/BUILD_REPORT_QUEUE_CLOSED.txt`): a handler that admits it is pretend is a HIGH authenticity finding.

Ledger, older reports (2026-11-20, next PR):
- #1994 — no new rows, and my first attempt WITHDRAWN before merge. Reports #1950–#2003 had already been autopsied by another session (the BRxxxx series). BR1994 had recorded both of my findings: the recovered `npm install` still counted on a failed build's gate is **Q-2707**, 🟡 blocked on an owner billing decision (a red gate is what makes a failed build free, so forgiving a recovered failure there can newly charge a build). The YouTube-downloader policy is **Q-1005**, 🟡 blocked on the admin. I had changed `recordCommand` to make exactly the Q-2707 change without that decision; it was reverted in #4387 before merging, and Q-3037/Q-3038 (which never reached `main`) were removed. Lesson: check the `BRxxxx` series for a report number before autopsying it.
- #1987 — no new row: the workspace was already a Spring Boot project (its saved starter), so a PUBG-style request was built on it without the game kit by design; its `npm install` without a package.json blocker is BR1987, fixed.
- #1995, #1993, #1986, #1984, #1983 — no new rows: all five are SANDBOX_RECOVERY_UNAVAILABLE ("could not be safely reconnected") within 1–19 s, not the E2B cap (read, not assumed). The refusal's reason has been in the report since #4253. #1995 and #1984 were "Fix this error and continue building the app: <that refusal>", the Fix-with-AI-on-our-own-notice class BR1995 fixed (2026-11-17).


## 2026-11-20 — #4383 merged (Q-2750/2753/2766/2769 closed); Q-3019 traced, its visibility half fixed
Closed on merge of #4383 (IDs appended to `BUILD_REPORT_QUEUE_CLOSED.txt`): Q-2750, Q-2753, Q-2766, Q-2769.

**25-minute investigation (last 50 builds, #2430–#2479):** 3 of 50 hit the wall-clock cap; ~10 games were judged "not playable" (Controls 0 / 0 fps / no canvas), all BEFORE the WebGL checker fix (#4358). #2478 (bgmi, the only post-fix cap) was already autopsied (Q-3010–Q-3019); its 15-minute false Rules-of-Hooks chase (Q-3014) is fixed on main — verified: the kit Hud.tsx is now clean.

**Q-3019 traced:** ~63k input tokens per call for ~160 output; the 8 slow calls (40–122 s) each followed a model switch inside Surplus (same-model median 4.6 s vs 36.7 s after a switch), ~7.5 of 25 min. Each switch follows a failed attempt the session retried silently (`console.warn` only), so the report said every call was ok. Fixed here: `onAttemptFailed` (one notice per failure, codes only) → `onProviderError('SURPLUS')` at both runner sites · `aRetriedAttemptIsReported`. Open: retry the same model once before benching.
- #1941, #1940, #1938, #1933 — no new rows (each read; none in the BR1950–2003 series): #1941's guessed `Input.bind` is BR1954's kit-type-contract class; #1940 rendered at 761 s and was stopped by the user at 782 s (the free-tier ceiling, Q-2240); #1938's "kit laid down (0 files)" after the E2B cap is BR1977's `downgradeEmptyKitSeedSuccesses`; #1933 rendered at 359 s as an original runner before the user stopped it.
- #1926 — Q-3037 (the ID freed by the withdrawn row) a type imported beside a same-name value is refused at write time when the in-browser preview cannot compile it (tsc and esbuild accept it, Babel does not); the E2B-cap start with the fast lane running anyway is BR1952, fixed.
- #1925 — Q-3039 a React-writing game recipe is refused in a project that cannot mount React (a Svelte game spent ~20 min reconciling the kit's React files); its kit `Game.ts` rewrite is the class #4375's kit guard refuses; its E2B-cap start is Q-2929.
- #1916 — Q-3040 a dropped-connection message ("network error", "Failed to fetch") no longer offers Fix with AI, and a missing optional `test`/`lint` script is not a build-breaking blocker.
- #1900 — no defect: the gate's one blocker was BUILD_TIMEOUT on a build that had reported success. Counting it is deliberate (Q-381 batch six, "NO BILL MOVES"): it is what keeps a build that ran out of time unfinished and uncharged. A change to exclude it was tried and reverted when that guard failed.
- #1922 — no new row: HEAL_NOT_DURABLE (`App.tsx` ×6, "our write held") again without a name. Q-3027's first half is now done: every heal write carries its name and the line prints it. Its binary `.mp3` is BR1952.
- #1876 — no new rows: 53 ENGINE_R1 fallbacks (Q-2692) and a free build that cost about $1 before the ceiling stopped it (Q-2240, blocked on the admin's money decision).
- #1913 — Q-3041 the Play Store / App Store are where an app is published, not a shop: a game that mentioned uploading to the play store was read as ecommerce and got no kit.
- #1930, #1914 — no defect: a user stop at 18 s before any write; the write guard refused a duplicate declaration, then the user stopped.
- #1910, #1909, #1906, #1898 — no new rows (each read): a user stop at 9 s; #1909 and #1906 rendered at 451 s and 415 s before user stops (#1906's unreported Surplus usage only under-counts our own cost); #1898's guessed `createTerrain` is BR1954's kit-contract class and its skipped write-time typecheck is autopsy 61279465, both fixed.
- #1896 — Q-3106: the clarity judge's decision (or why it was not consulted) is now a CLARITY_DECISION line in the build report. "Make the game you were going to make" was built without a question, and the report could not say why.
- #1890 — no defect: a Ludo board stopped by the user at 61 s in the fast lane.
- #1888 — Q-3103: CGST, SGST and the other GST/invoice terms are ordinary words, not unknown services.
- #1881 — Q-3104: screens written in Tailwind utilities in a project without Tailwind are named as such in every undefined-class note (they asked for one hand-written rule per utility). Its CSS warning on a user stop of a starter-seeded build is BR1988's boundary (edit-mode turns carry no readyAt).
- #1879 — Q-3105: a remark ("I saw your ad on YouTube… you don't even make games") no longer confirms a build on the word "game", and "YouTube dekh raha tha" (watching YouTube) is no longer a clone request.
- #1876 — already ledgered above.
- #1871 — no defect: a "Continue" turn stopped by the user at 43 s while reading the project.
- #1870 — Q-3028 again (the Panchang chip rendered at 43 s, then about 130 s of invented polish and three missed edits until a user stop); the row is blocked on the admin's decision and now names this report.
- #1857 — Q-3040's class (fixed in #4388): "Fix this error and continue building the app: network error" was a NavBharatAI-composed fix request for a dropped connection, stopped at 9 s.
- #1847 — no new rows: the scope classification ran its full 30 s deadline and failed (Q-2949, which now names this report); a `claude-sonnet-4-6` label on an unanswered Weak builder call is Q-970 (blocked on the admin's routing decision); the user then sent a different request mid-build and stopped.
- #1846, #1845, #1844, #1843, #1836 — already autopsied by build ID (rows exist).
- #1838 — Q-3107: the `.env` read rule (and five sibling verb-and-argument rules) crossed `;` and `&&`, so `cat a.ts; ls -la .env` or `git push && rm -f tmp` were refused or flagged; each now reads one command. Its failed `ls` of missing directories as a gate blocker is already fixed on main (`isReadOnlyInspection`). Whether this report's own truncated command had that shape cannot be read from the report; the class is proven.

## 2026-11-20 — #4388 merged (failedbr #1926 / #1925 / #1916; Q-3037, Q-3039, Q-3040 closed)

Closed (IDs appended to `docs/claude/BUILD_REPORT_QUEUE_CLOSED.txt`): Q-3037 a type imported beside a same-name value is refused at write time when the in-browser preview cannot compile it; Q-3039 a React-writing game recipe is refused in a project that cannot mount React; Q-3040 a dropped-connection message no longer offers Fix with AI, and a missing optional `test`/`lint` script is not a gate blocker. The rows above (Q-3041, Q-3103–Q-3107) go in the next PR.

Ledger, older reports (2026-11-20, next PR):
- #1831 — no new rows: a user stop at 94 s while the builder read the camera files; its `claude-sonnet-4-6` label on an unanswered Weak call is Q-970, and the Surplus debug note's path is disabled on main.
- #1823, #1822, #1821 — Q-2316: the style floor's import survives a rewrite of the mount, and an orphaned floor sheet is re-imported once per turn. #1822 also showed invented polish after the app rendered (`generate_tests` with no functions) before a user stop.
- #1820 — Q-3108: a conflict, diff or wrapper marker in a whole-file write is named in the refusal instead of the duplicate-declaration hint.
- #1817, #1814, #1813 — already autopsied by build ID (rows exist).
- #1811 — no new rows: the gate's one blocker was the provider sentence "The build engine is temporarily unavailable", already filed in the provider phase on main (#2424's fix maps this exact sentence to OUTCOME_ENGINE_UNAVAILABLE); its `Input.active` guess is BR1954's kit-contract class; "Start Game" threw in model-written code, which the explore pass found correctly before the outage ended the build.
- #1808 — Q-3109: a durable forget of files that were never stored is complete, so the rollback is no longer called incomplete. Its 38 build-loop files after the 85 s render, then a broken app and a restore, are Q-2305 (post-green writes kept unverified; blocked on the admin's decision).
- #1803 — Q-3110: a system package install (apt, yum, apk, brew…) is answered at the bash door with the npm route; the 300 s foreground `node server.ts` is backgrounded on main, and the ffmpeg core and EADDRINUSE items are existing rows/rules.
- #1801 — Q-3111 (with #1803): a server written without the SPA catch-all is told so at the write; its OUTCOME_AUTHORITY_UNAVAILABLE at 547 s is Q-2957 (blocked), which now names this report.
- #1798 — Q-3112: a scaffold file the fast-lane plan describes only as it already is (package.json, vite.config, index.html, src/main) is not regenerated; the counter app lost its budget to two byte-copies of the starter before `App.tsx`. The 503 that ended it is a Surplus engine condition.
- #1795 — no defect: an admin bench prompt stopped by the user at 14 s.
- #1791 — already fixed: the "BMI autopsy" (#4025) absorbs unverifiable Surplus usage at ₹0 and never stops a build on it.
- #1786, #1784, #1782, #1781, #1780, #1779, #1776 — already fixed on main: the Surplus scope check's token cap (DNA 05011), the unverified-charge stop (#4025), the billing throw after a rendered app, and OUTCOME_UNEXPLAINED for the engine sentence; "Fix with AI" no longer offers the engine's own outage message; the "your app is built" ticker is gated (Q-1024, #1817).
- #1785 — Q-3112 again (byte-copied package.json / vite.config.ts) plus the #4025 accounting 503s.
- #1773 — Q-2957 (lease authority, blocked), which now names this report.
- #1763–#1757 (seven benchmark builds) — already fixed: a Surplus outage no longer counts as the app's blocker (#2424) or as "no outcome recorded"; the Haiku label on a Weak call is Q-970 (blocked).
- #1745 — already fixed: "hu" no longer confirms a build (`buildConfirmation`).

Ledger, older reports #1743–#1536 (2026-11-20, next PR):
- #1743 — no defect: an AI chat app rendered at 261 s, then a user stop; one GLM silence (benched by design).
- #1617 — Q-3113 (`. ./node_modules/.bin/tsc` sourced as shell → ImageMagick `import`); its missing `src/` and TS5102 `baseUrl` errors were the user's own IDE edits to the starter.
- #1620 — Q-3114 ("free fire app ke lia panel app" is FOR Free Fire, not a clone).
- #1577, #1565, #1561, #1544, #1540 — Q-2732 / Q-2242: a "does not provide an export named …" that the file on disk disproves restarts the dev server with a fresh cache before any repair.
- #1619, #1564, #1537 — Q-3115: a turn that asked the user a question is no longer "no specific error was captured". #1537's ecommerce domain for a voice-assistant spec reads "general" on main.
- #1615 — Q-3116: bare `types` / `lib` under `baseUrl: "src"` are project files, not missing packages; its failed `ls` blockers and `cd /workspace` are fixed on main (`isReadOnlyInspection`, `fixSandboxWorkspaceCd`).
- #1563 — Q-3117: no preview ever published is RUNTIME_UNCHECKED, never "runtime verified".
- #1636 — fixed on main: a Free-Fire-style game read as logistics now reads as game.
- #1626, #1606, #1605, #1600 — the admin's maintenance pause; filed as OUTCOME_AI_PAUSED on main, never a blocker. #1626's kit-contract TS2322 is BR1954's class; #1600's saved `'types'` vs sandbox `'@/types'` is Q-2232 (shell writes the parser cannot name).
- #1588, #1584, #1577, #1565, #1563, #1560 — the E2B 20-sandbox cap (Q-2929, blocked on the admin). Their "add credits" upsell on a sandbox outage is suppressed on main (`sandboxUnavailable` counts as interrupted); #1565's kit announced with 0 files is BR1977 (`kitSeedClaimIsHonest`).
- #1570 — fixed on main: "stopped before the app was running" after a 310 s render (`earliestRenderProof`, a75153ab).
- #1553 — the 123 no-op `update_preview` calls are now steered after 2 and end honestly (RepeatProbeGuard); its 25-min timeout followed.
- #1624 — Weak-tier reasoning timeouts (KIMI 150 s with only reasoning) and a futility stop after 10 quiet minutes; the provider class, no platform defect beyond the rows already open.
- #1559 — a GTA-scale spec in project mode: Kimi TPM / Nemotron 429s, a syntax repair that answered with an unshown file (refused, REPAIR_OUT_OF_SCOPE), then a RED gate; recorded, no new class.
- #1544 — its Marathi narration for a Hindi request was the model's; main detects the request as Hindi.
- #1629, #1611, #1609, #1608, #1591, #1573, #1548, #1536 — user stops, no defect.

Ledger, older reports #1533–#1432 (2026-11-20, next PR):
- #1533 — Q-3118 ("CORS" read as a typo); its replaceSymbol duplicate-declaration refusals worked as designed; the 25-min cap ended a module-1 turn that grew into the whole app (project mode).
- #1441, #1440 — Q-3118 ("SNR"); user stops.
- #1449 — Q-3119 OPEN (Minecraft server hosting read as a game).
- KIMI "suspended due to insufficient balance" (429) in #1465, #1449, #1446, #1441, #1440, #1435, #1432 — Q-1210 (blocked: the provider account's balance is the admin's).
- glm-5.3 first calls of 140–331 s (#1446, #1435, #1432, #1449) and GLM flashx silences (#1507, #1493, #1487, #1465, #1455) — the Weak-tier provider class already open; benching worked as designed.
- #1507, #1493 — "stopped before the app was running" after an in-build render is fixed on main (`earliestRenderProof`); #1493's failed `ls` blocker (`isReadOnlyInspection`) and 14 no-op `update_preview` calls (RepeatProbeGuard) are fixed on main; #1507's "stub marker" on coordinate placeholders is the authenticity analyzer's precision, recorded.
- #1446 — `cd /workspace` (fixed on main: `fixSandboxWorkspaceCd`); a FULL-REWRITE of the kit's `state.ts` was warned and the model restored it.
- #1509, #1498, #1487, #1465, #1455, #1453, #1447, #1435, #1432 — user stops.

Ledger, older reports #1430–#1358 (2026-11-20, next PR):
- #1430, #1420 — Q-3120 (a document request is answered, not built).
- #1384, #1373 — Q-3121 (game titles and ranks are not services).
- #1270 — Q-3122 (a refusal such as "Nhi banao" is neither a build order nor a yes to our offer).
- Batch #1357–#1263 (20 reports, 2026-11-20). Fixed: Q-3123 (stringified tool arguments), Q-3124 (Indian places, public-works
  terms), Q-3125 (FF = Free Fire), Q-3126 (stop discount named apart), Q-3127 (starter preview named to the model), Q-3128
  (defaults follow the project on disk), Q-3129 (pasted calculator keys and colours), Q-3130 (recharge refusal = balance),
  Q-3131 (a picture's subject), Q-3132 (code with no words), Q-3133 (every GameOptions type exported), Q-3134 (quoted symptom).
  Already fixed on main when checked (no new row): stop_build needs the user's own words (1b38d662); "UTF"/"GTA"
  (Q-3121); cross-origin autofocus noise (AutoFix); Devanagari गेम (#2163); startTier label (Q-2748); "Hindi me bolo" parts
  count (now 0); stale-module `combo` (Q-2732); the 22× preview loop (Q-3018); kit colours (BR1954); ETA of a stopped build
  (cut short). Providers (flashx silent, glm-5.3 reasoning-only, Nemotron crawl, KIMI balance) stay with Q-962, Q-1121,
  Q-1211, Q-1212, Q-1210. Open: Q-3135–Q-3152.
- Batch #1262–#1177 (25 reports, 2026-11-20; bulk-indexed by the 2026-10-20 audit with completion "not established").
  Fixed: Q-3153 (best-guess note: present tense, user's script), Q-3154 (planners are not ladder rungs), Q-3155 (planner
  seconds named, not "0s of preparation"), Q-3156 (an AI with no API dependency gets no API client). Already fixed on main
  when checked: stopped calls name the served engine (03368870 = #1215), decline/question turns are answers (r6–r10 =
  #1220), STUCK_TOOL on a Stop is "cut off", "हिंदी में" binds the reply voice (#1225), online classes is education and a
  404 names its URL (#1182), the starter preview is named to the model (Q-3127, #1188's 76 publishes), the engine stop
  code (Q-3141, #1202), GTA (Q-3121), stale tier labels (Q-2748), partial batch writes lead with what failed (#1182/#1234),
  the overdraft floor records debited vs absorbed (#1258/#1234 debit gap), the audit-fix line (npm exits 1 while
  vulnerabilities remain). Blocked: Q-3157 (dependency-only stop charge — admin), Q-3158 (composer of a "Fix this error"
  prompt — missing information). Open: Q-3159–Q-3167.
- Batch #1171–#1021 (20 reports, 2026-11-20). Fixed: Q-3168 (👍 accepts the offer), Q-3169 ("banana hai" is the verb, a
  date token is a format, "WhatsApp-ready" is not a clone), Q-3170 (vite --force is honoured), Q-3171 (a timed-out build did
  not "report success"), Q-3172 (the unverified note says which happened). Already fixed on main when checked: STUCK_TOOL on
  a Stop (#1151), a question turn read as an engine outage (#1171, #1053 — r6–r10), stopped-call model labels (#1155,
  #1111, #1077 — 03368870), "Almost done… your app is built" (#1043, #1046 — BR1992/8cdb4817), "clone of Instagram" (#1052),
  "VPS"/"LLM" unknown names (#1052, #1049), the stale-module restart (#1153, #1043 — Q-2732), planner seconds and rungs
  (Q-3154/Q-3155), the 99% index.html rewrite (#1022: it removed an overlaid old app — the fix, not a loss). Charges on
  stopped builds (#1161, #1111, #1077, #1049, #1046, #1022, #1021) are Q-3148/Q-3157's policy; vague prompts built at once
  (#1142, #1078) are Q-3137's. Open: Q-3173–Q-3184.
- Batch #1020–#919 (11 reports, 2026-11-20). Fixed: Q-3185 (deployment instructions are not a publish order), Q-3186 (a
  Hindi admin panel is an access gate), Q-3187 (an indirect question is a question). Already fixed on main when checked:
  the stopped lane's file count (31254f9a), a stopped call is LLM_CALL_STOPPED (#919), STUCK_TOOL on a Stop (#959), the
  per-module starter (6a5fb04b, #961's 19 minutes), the roadmap's simulated-reply guardrail (#947), design observations
  on untouched code (obs()). Open: Q-3188–Q-3198.
- Batches #898–#796 and #755–#698 (23 reports, 2026-11-20, mostly late-September builds). Fixed: Q-3188 (an unfilled
  template names no app), Q-3199 (Hinglish "bus" is not a vehicle), Q-3200 (the shim repair stays inside the app).
  Already fixed on main when checked: a user-stop RED gate is info, LLM_CALL_STOPPED, the stopped-build upsell, "I made
  your change" on a zero-change stop, "send me the code" is answered, compiled Android CSS and vendored CSS are not
  graded, the "fake/incomplete" blocker names its files, the 45-token grounding warning (Q-3140), pipe-masked tsc errors
  are counted. Half-charges on stopped builds with no agent change (#733, #732, #749) are Q-3148/Q-3157's policy.
  Open: Q-3201–Q-3208.
- KIMI "suspended due to insufficient balance" in 11 of these reports — Q-1210 (blocked: the provider account's balance).
- #1359 — "stopped before the app was running" after a 908 s render with the stop at 945 s, billed at cost (in the user's favour): fixed on main (`earliestRenderProof`, a75153ab); its "clone of GTA" reading came from an earlier request in the planning context (needsIntent / subject rule on main).
- #1419 — a 8 s LAPSED game-runtime recipe left no kit; the builder was told to run the recipes itself (honest), recorded.
- #1426, #1425, #1417, #1406, #1397, #1392, #1377, #1372, #1371, #1362, #1358 — user stops; the slow glm-5.3 / Nemotron first calls and GLM flashx silences are the Weak-tier provider class already open.


## 2026-11-20 — Ready-to-play endless runner starter; one list of genre starters (engine plan, item 3)

- **Checked first:** item 2 of the plan (a playtest that plays) already exists — `gamePlaytest.ts` plays every canvas game
  (start, keys, drag, touch, errors, FPS) and `gameRepair.ts` gates completion; AUTOMATIC repair is deliberately suspended
  (docs/security/game-auto-repair-suspension.md: rollback from an incomplete snapshot could lose user files). Left
  suspended — re-enabling needs the reviewed byte-preserving snapshot protocol that note describes, and the admin's call.
- **Starters before this:** racing (`RacingRoadGame`) and the royale practice. A runner was wired from parts every time.
- **Fix:** `src/game/LaneRunnerGame.tsx` in the shell — `createLaneRunnerScene()` draws the kit's LaneRunner (track,
  lane lines, recycled posts for speed, block / low / high obstacles, spinning coins, the humanoid running, jumping,
  sliding, dying) and wires the kit (GameCanvas start screen, pause, game over + Play again via GAME_STARTED, settings,
  language, swipes + keys, score into core/state, jump/coin/crash feedback events). Lane 0 is the LEFT on screen: drawn at
  `x = -run.x` because the chase camera looks down +Z (screen-right is world -X).
- **Class fix:** `src/server/lib/gameStarters.ts` is the ONE list of starters; `actionVisibility`, `endlessRaceCourse`
  and `shellBypass` each hard-coded RacingRoadGame and now read it; the seed gives each starter only to its genre
  (a racing request no longer receives the whole shell; a runner no longer receives the race).
- **Proof:** `tests/theRunnerStarterPlays.test.ts` (8): Right moves right on screen through the real chase camera; a bot
  playing through the player's own input survives 90 s / 1200+ m; standing still → game over; Play again is clean; the
  right starter per genre. Seven reversions each failed. Kit strict compile + shell/seed/reader suites green.
## 2026-11-20 — Game menus in nine more Indian languages + Settings → Language (game-gap audit)

- **Problem:** the game kit's own screens (start, pause, settings, game over, shop, controls, captions) were English or
  Hindi only. A Tamil, Telugu or Bangla player got English menus unless the builder translated every word, and a missed
  word stayed English. Nothing told the builder which language the request wanted.
- **Root cause / class:** the kit had two languages and no path from "the request is in Tamil" to "the game is in Tamil".
- **Fix:**
  - `src/server/lib/gameStringsIndic.ts`: full tables for Tamil, Telugu, Bangla, Marathi, Gujarati, Kannada, Malayalam,
    Punjabi and Odia (every key, every `{placeholder}`, technical tokens kept). Typed as `Record<StringKey, string>` in the
    generated `core/strings.ts`, so a new key that is not translated everywhere fails the kit's strict compile.
  - `core/strings.ts`: 11 languages, `'auto'` detects all of them, and a **player choice** (`choosePlayerLanguage`) saved
    on the device that wins over the game's own; the game's word changes stay in the game's own language only.
  - Shell: **Settings → Language** list (each language in its own script); every screen re-renders on a change.
  - `AgentV3/gameLanguage.ts`: the request decides — a language NAMED as the game's language ("Tamil mein", "in Telugu",
    "Bangla version") or the SCRIPT the request is written in; a subject mention ("a Tamil movie quiz") is not a choice.
    The kit handoff tells the builder `language: 'ta'` and to write the game's own text in it.
- **Proof:** `tests/theGameSpeaksIndianLanguages.test.ts` (24 tests; five reversions each failed).
- 🟡 **Open:** the nine tables were written without a native speaker reviewing every word. They are ordinary words, and any
  word can be changed with `options.strings`, but a native-speaker pass per language is recommended.
## 2026-11-20 — Cars crash into walls and into each other (engine audit, item 1 of the admin-approved plan)

- **Measured first, with the real kit:** cars already stopped at walls (an earlier claim of mine in this session that
  they did not was wrong — `vehicleTravel` sweeps the body against scenery). Two real defects:
  1. a car drove straight THROUGH a parked car at full speed — vehicles were never obstacles, only scenery was;
  2. a car that clipped a wall at an angle stopped dead and stayed glued to it.
- **Class:** the vehicle sweep knew one kind of obstacle (scenery) and one outcome (full stop).
- **Fix (shared `objects.ts`, so every driving game gets it):**
  - every kit vehicle (car, auto, bus, truck, tractor, motorcycle, bicycle) and every model `driveVehicle` moves is a
    vehicle body; the sweep also tests the other bodies in the same scene (capsule–capsule, binary-searched fraction);
    bodies that left their scene are forgotten; overlapping cars can always separate (never lock together);
  - a blocked car slides along what it hit; the speed loss is paid once at contact, then only scraping friction;
    a head-on hit still stops dead (existing tests pin it);
  - `onVehicleCrash(at, vehicle, impact)` once per hit (> 3 m/s lost, 0.3 s apart); the shell turns the PLAYER's crash
    into `VEHICLE_CRASHED` → sparks, impact sound, trauma, haptic via the feedback table.
- **Proof:** `tests/aCarHitsWhatItDrivesInto.test.ts` (9 tests, eight reversions each failed); all 28 existing vehicle
  test files (485 tests) pass.
- 🟡 **Not built yet:** pushing the other car, dents and damage.
## 2026-11-20 — City blocks in the 3D game kit (game-gap audit)

- **Problem:** a "city" game was one straight road with houses beside it — the kit had `createRoad()` (one strip),
  `createTraffic()` (one strip) and one/two-storey houses. Builders hand-placed boxes: streets that did not meet,
  buildings in the road, pavements at the wrong height, and a draw call per box.
- **Fix:** `src/server/lib/GameCityGenerator.ts` → kit file `src/game/three/city.ts`:
  - `planCity()` (pure, seeded): streets, crossings, lots (two rows per block, so every lot faces a street), parks (never
    every block), street lights, a spawn in the left lane. Styles: town / mixed / downtown; size and tallest floor bounded.
  - `cityRoute()`: along the streets, turning only at crossings, in the LEFT lane (India), ending at a door.
  - `createCity()`: asphalt with centre dashes and zebra crossings, raised pavements, shops (awning, signboard + `lot.sign`
    anchor for the name), apartments (balconies, water tanks), office towers, houses (yard + compound wall), parks (trees,
    paths, benches, fountain), street lights — merged per block (a 6×6 city ≈ 180 meshes). Streets/pavements are ground
    colliders, buildings solid. `city.heightAt` is the ground for `driveVehicle`, which already stops at the solid buildings; `city.solidAt` is for movers a game positions by hand. (An earlier draft said driveVehicle had no walls — wrong; measured, it sweeps against solid colliders.)
  - 3D instructions + kit handoff name `createCity()`; AppKnowledgeBase `game_city_blocks`.
- **Proof:** `tests/aCityHasStreetsAndBlocks.test.ts` (10 tests; seven reversions each failed).
- 🟡 **Not built yet:** traffic that turns at crossings, traffic lights, pedestrians.
## 2026-11-20 — #4389 merged (Q-2750/2753/2766/2769 closed; Surplus retries reported); game library batch 6
- #4389 merged: every failed Surplus attempt (benched or retried by the stay-alive loop) now reaches the build report as one `SURPLUS` provider notice with codes only (`aRetriedAttemptIsReported`). Q-3019 stays IN PROGRESS for its speed half (retry the same model before benching, decided from the new notices).
- **Library batch 6** (this PR): the admin's own Quaternius downloads from Drive, licence checked in each archive and on the pack page: Ultimate Gun Pack (12 firearms, the library's first) and Realistic Car Pack (7 cars). The packs have no GLB, so each was converted offline (OBJ+MTL → GLB) and ships PACKAGED in the image (`assets/game-models/<sha256>.glb`). The packaged path is generalized from the eagle to any Quaternius CC0 entry with a pinned hash and size; the transport looks up the reviewed entry by id and checks provider, hash and size. New prompt words (English and Hindi: gun/बंदूक, pistol/पिस्तौल, AK47, sniper, shotgun, SMG, revolver, jeep/SUV, sports car), and a named subtype is not also the generic subject (police car is not also "car"; laser gun is not "gun"). Admission: all 19 rendered live in Chromium. Test: `libraryBatch6`.
- Drive review (2026-11-20): accepted N1, N2, N3, N4, N8, N9, N16, Downtown City, Medieval Village, KayKit Adventurers 2.0, SBS textures (CC0 per the archive's licence file). Rejected: N5 (licence forbids redistribution), N6 (paid, attribution), N10 (Cenji licence), Bestiary (not CC0), and every archive with no licence file (sounds, PSX cars, retro weapons, furniture, rooms, etc.) until a source page shows its licence.
- Next: animated clothed characters (Universal Base Characters + Modular Outfits + Universal Animation Library, same 65-joint rig; four built under 5 MB with 16 animations each).

## 2026-11-20 — Game maker: Indian characters, library chosen by meaning, the user's own models (admin: "a. b. sab karo")
- **Library batch 7:** the first clothed, fully animated characters: village man, village woman, and ranger man/woman (archer, hunter).
  - Built from three of the admin's CC0 Quaternius packs on one 65-joint rig.
  - Indian look by default, set as material colours: skin tone, black hair, a white kurta-like shirt, red for the village woman.
  - Plain part names so a user can change any part: materials Skin/Hair/Eyes/Clothes; nodes Head/Body/Arms/Legs/Hood….
  - 12 animation roles, every moving one proven in the live admission.
  - New subjects only, so man/woman keep their models. Test: `libraryBatch7`.
- **By meaning, not by word:** a new game's builder gets the whole library as a menu (`gameLibraryMenuHandoff`), only when the library is on for the account.
  - `add_library_models` takes every role.
  - A role the model lacks keeps the model and is reported; it used to make the model unavailable.
  - Test: `theLibraryIsChosenByMeaning`.
- **The user's own models** (`userModels.ts`): attach .glb / .gltf (+bin, textures) / .obj (+mtl, textures), loose or as a zip of models.
  - Each model is converted to one checked GLB, saved durably, then written to the sandbox at public/models/<name>.glb.
  - The builder is told the parts and animations of what really landed.
  - FBX and Draco/Meshopt are refused, with the exact export step.
  - A missing texture loads without it and the user is told.
  - Limits: 8 MB, 200k triangles, 4096 px, 8 per message.
  - Test: `theUsersOwnModelGoesIntoTheGame`.
- **Sibling bug fixed:** a 3D app imported as a PROJECT zip had its .glb read as text (corrupted) and its glTF .bin dropped. Both are now kept byte-exact.
- **Open:** real Indian clothing (saree/dhoti/kurta/turban) geometry. No CC0 rigged model exists. The admin decides: accept CC-BY with an automatic credit, or buy a pack whose licence allows redistribution. FBX conversion is also open: no converter we can trust in the server yet.

## 2026-11-20 — failedbr #745 … #691 autopsied (PR #4390, continued)

Every report from #745 down to #691 read in full (reader subagents, then each item checked against current `main`).
Most September items were already fixed by later autopsies; those are recorded with their evidence, not re-fixed.

| ID | Report | Problem → root cause / class | Fix · lock |
|---|---|---|---|
| Q-3200 | #734/#735/#731/#729/#728 | AMBIENT_SHIM_REMOVED rewrote a reference `.d.ts` in the user's imported repo every build — the repair scanned every `.ts` | `inAppBuildScope` · `theShimRepairStaysInTheApp` |
| Q-3201 | #728/#731/#734/#735 | ~480 vendored reference files crowded the real app out of the 300-file evaluate snapshot (false sink, "partially scanned", false unused deps) | `foldersOutsideTheApp` decided from tsconfig include / scripts / bundler config / index.html BEFORE the cap · `aVendoredFolderIsNotTheApp` |
| Q-3202 | #741/#755 | A folder/glob `rm` of files an EARLIER build saved never reached the durable store (Q-246 checked this build's writes only) | `pathsAShellRemovalIsCheckedAgainst(written, savedAtStart)` · `aShellDeleteLeavesTheSavedProject` |
| Q-3203 | #724–#735 | VITE_ENV_TYPES_ADDED every build | already fixed (de3bb2bb, 2026-10-01) · `theCoactCollectorAutopsy` §6 |
| Q-3204 | #745 | `ProfilePage() { return null }` / `useSocial() { return {} }` shipped and sold as "profile pages" | `hollowFeature.ts`: write-time note, HOLLOW_FEATURE report line, `feature-claimed-but-empty` claim · `aStubIsNotTheFeature` |
| Q-3205 | #728 | "Working AI replies — simulated responses" | scripted chat already disclosed (466c260a); `ai-working-but-simulated` claim · same file |
| Q-3206 / Q-3207 / Q-3208 | #729–#735 | wrong clock named; blocked `rm` shown ✓; dev server given up on while starting | already fixed (bb688add; `refuse()`; 2720e553) |
| Q-3209 | #696 | A cap filled by stalled ANSWERS ended "not converging / endless loop" — the waste ledger counted only failed calls | stalled successful turn → `stalled` waste · `aStalledAnswerIsEngineTime` |
| Q-3210 | #693 | A library attendance app graded against a school's LMS list (courses, grading, fees) on "student" | narrow `library` domain before education · `aLibraryIsNotASchool` |
| Q-3211 | #697 | Assamese UPSC essay routed to a build on length alone | already fixed (e628efd4, f2ff962f, buildConfirmation) · `anEssayQuestionIsNotABuild` |
| Q-1553…Q-1557 | #696/#695/#693/#692/#691 | bulk rows | autopsied; every remaining item mapped to a fix above or to an earlier one (slowRungBench/crawlBench, runnerChainSummary, retryLeadsHigher, OUTCOME_REAPED, BuildDeadlineLifecycle, isLongRunningCommand, fileMentions KNOWN_ANNOTATIONS) |

Merged `origin/main` (#4391's Q-3035/Q-3017 rows kept; Q-3037/39/40 stay closed). No local CI per the admin.
## 2026-11-20 — #4392 and #4394 merged; library batch 8 (KayKit Adventurers 2.0)
- #4392 (batch 6: guns and cars) and #4394 (Indian characters, library by meaning, user's own models) merged. The full local gate was green on each final tree (#4394: 3656 files, 55562 tests).
- **Batch 8** (this PR): the admin's KayKit Adventurers 2.0 download (Kay Lousberg, CC0 per the archive's License.txt: "free to use in personal, educational and commercial projects").
  - A cartoon bowman with 15 clips; all 9 moving roles proven animated in the live admission.
  - 15 props the library lacked: bow, arrow, arrow bundle, quiver, dagger, greatsword, battle axe, round/spiked shields, magic staff/wand, spellbook, book, mug, smoke bomb.
  - Packaged in the image. KayKit joins Quaternius as a packaged provider; every other provider is still refused.
  - Word guards: "arrow keys", "book a ticket", "hotel staff", "bow tie" match nothing. "big sword" is a greatsword only.
  - The pack's knight/mage/barbarian/rogue were already in the library from KayKit's public 1.0 repository, so they are not duplicated. Test: `libraryBatch8`.
- **Evidence note:** this environment cannot reach itch.io, so the evidence link is the distributor URL inside the archive (`More KayKit Assets.url`). The licence itself is the archive's License.txt, pinned by the archive's sha256.

## 2026-11-20 — What the library lacks is made with the Object Forge (admin: "han")

- **Class:** an object the user named that neither the reviewed model library nor the 3D kit provides was left to one
  generic system-prompt line, so a weak builder drew it from boxes (the Athree map's class before it was seeded).
- **What the platform now does (`AgentV3/forgeForMissing.ts`):** after the 3D kit seed, it reads the objects the user
  named (`forgeSubjects.subjectWordsIn`), drops those the library serves (`gameAssetRequirements`) or the kit builds,
  and hands the builder, per object, the `author_object` instruction with its kind's worked example and checklist. The
  builder also tells the user, in the user's own language, that they can attach their own model (.glb/.gltf/.obj/.fbx
  or a zip) and ask where to get free ones. The download guide is the other session's `modelSourcesGuide.ts` (#4397).
- **Checked after:** `ToolDispatcher._warnIfForgeSkipped` adds a readiness WARNING (never a blocker) for an assigned
  object with no Forge object saved. Diagnostic `FORGE_SUBJECTS_ASSIGNED` names the assignment.
- **Not done, and why:** the platform writing the Forge spec itself needs a model call outside the builder's turn, which
  stays held in `ToolDispatcher` (`describe`) until it has admitted billing and cancellation — a money decision.
- Locked by `tests/whatTheLibraryLacksIsForged.test.ts`; removing the library check fails it.
## 2026-11-20 — #4396 merged (batch 8); batches 9–10, FBX import, "where to get it", library on every 3D turn
- #4396 merged. It also merged the other session's switch: the library is ON by default (`7aac6be51`). The admin can now delete `AGENTV3_EXTERNAL_GAME_ASSETS` from Cloud Run — a value of `admin` would keep it owner-only.
- **Batch 9:** the Quaternius Farm Animal Pack (CC0 per the pack page). Cow, horse and zebra idle/walk/run/jump/die; llama, pig, sheep and pug idle/jump. Every moving role proven live.
  - FBX-only pack, converted with `scripts/library/fbxToGlb.mjs` (three.js in a sandboxed Chromium).
  - Running the downloaded FBX2glTF binary was refused by the auto-mode classifier, so it was not used.
- **Batch 10:** the Downtown City MegaKit (CC0) — 3 whole brick buildings, city street tiles, sidewalks and 5 street props.
  - The kit's vertex-colour wear mask, painted as red streaks, is removed.
  - Hindi words: chauraha, tiraha, footpath, gamla.
- **FBX attachments** are converted on the server (`fbxToGlb` in userModels.ts), keeping skin and animations. Three defects were fixed and locked by real CC0 fixtures in `tests/fixtures/fbx`:
  - materials came out fully transparent;
  - one primitive per polygon run;
  - a texture made FBXLoader call `document`, so a textured FBX never parsed.
  - Open: textures cannot come across in Node. The user is told, with the .glb route.
- **Where to get a model** (`modelSourcesGuide.ts`): when the user asks for something the library lacks, the builder builds the closest version AND tells the user the free CC0/CC-BY sources, the file to pick, the upload path and the licence rule.
- **The library on every later turn of a 3D game** (`withLibraryMenuForExistingGame`): it reached only the creating turn before.
  - Withdrawn after checking: the tested templates are never 3D, so the template path was not a gap.
- **Process note:** I wrote files into the main checkout while its gate was running. That gate was stopped and discarded; GitHub CI on the exact pushed commit decided #4396.
## 2026-11-20 — City traffic: the grid comes alive (engine plan, item 4)

- **Gap:** city.ts gave streets and buildings, and nothing moved on them — `createTraffic()` drives one straight road.
- **Fix:** `src/server/lib/GameCityTrafficGenerator.ts` → kit file `src/game/three/citytraffic.ts`: the kit's cars, autos
  and buses drive the city grid in the LEFT lane, turn at crossings (never a U-turn unless the street ends), obey traffic
  lights (one street green at a time, amber between, neighbouring crossings offset; two instanced meshes for every lamp
  in the city), keep a gap to the vehicle ahead, stop for the player, and are deterministic per seed.
- **Found by the test, fixed at the class:** the first version checked the gap only within a street — measured, a vehicle
  turned onto a street on top of one that had just entered it 52 times in two minutes. Now a vehicle passes its stop line
  only when its light is green, the crossing is EMPTY (one vehicle in a crossing at a time) and the street it turns into
  has room (so a queue never blocks the crossing). Each vehicle chooses its next street in advance.
- `dispose()` never frees the vehicles' geometry: the kit shares parts between all vehicles, the player's car included.
- **Proof:** `tests/cityTrafficObeysTheRoad.test.ts` (8): two minutes of 20 vehicles checked every frame (on the street,
  left lane, never through red, never inside the gap, never two in a crossing, everyone moves, most turn); rush hour of
  45 with long reds (no overlap, no blocked crossing, no gridlock); a queue backed into a crossing; stopping for the
  player; no-lights mode; determinism; dispose. Six reversions each failed (one needed the targeted queue test to bite).
- 🟡 **Not built yet:** pedestrians.

## 2026-11-21 — People in the city; cars wait behind the zebra (admin plan: "people walking in the city")

- **Kit file `src/game/three/citypeople.ts`** (`GameCityPeopleGenerator.ts`): people walk the pavement loop around each
  block and, at corners, sometimes cross to the next block — only on the zebra, kerb to kerb, briskly (≥ 1.4 m/s), only
  when the cars on that street have red for the WHOLE crossing (sampled every 0.5 s) and no car is near; they stop for the
  player; `people.bodies` passed to `traffic.update` makes cars stop for them. The crowd is two instanced meshes (body and
  head) — two draw calls for up to 150 people, for budget phones.
- **Found by the test, fixed:** the first light check sampled only "now" and "at the far kerb" — a light red at both and
  green in between let people start across just before green (8,823 frames on the road off red). The whole window is now
  checked, and the crossing is kerb to kerb so it fits inside one red.
- **Sibling found while designing it, fixed:** traffic's stop line sat 1 m past the crossing's edge — a waiting car's
  bumper was ON the zebra stripes. `CITY_ZEBRA` is now the one source of the zebra's size; the stop line (`stopBack`) is
  1 m behind it, and a test proves no waiting car is on the stripes (fails with the old line).
- **Proof:** `tests/cityPeopleWalkSafely.test.ts` (5; four reversions each failed, including the original bug) and the
  new zebra test in `tests/cityTrafficObeysTheRoad.test.ts`.
## 2026-11-21 — Games stay smooth on budget phones (admin plan: "smooth on cheap Android phones")

- **Found first:** the kit already adapts at run time (perf governor: steps quality down after ~3 s of stutter), and the
  playtest scores frame rate — but in the sandbox's SOFTWARE renderer, which says little about a phone GPU. Two gaps:
  1. every game STARTED at the highest picture, so a cheap phone's first impression was 3–6 s of stutter;
  2. nothing measured how much each frame asks of the GPU, so a game too heavy for budget phones passed unnoticed.
- **Fix:** `core/perf` `budgetDevice()` (deviceMemory ≤ 3 GB, or — when memory is not reported — ≤ 2 cores; cores alone
  are not trusted: cheap phones have 8, iPhones report 4) and `createPerfGovernor({ startDrop })`; the shell starts a
  budget phone one level down, never above the player's choice, climbing back after a smooth run. The playtest hook
  reports the last frame's draw calls / triangles / geometries / textures (`window.__nbKit.load`, from renderer.info);
  the playtest reads it after a round; over `BUDGET_PHONE` (300 calls, 600k triangles) → `GAME_DEFECT_TOO_HEAVY` and a
  `GAME_TOO_HEAVY` finding with a one-tap "Make it smooth on budget phones" fix (merge, instance, lite detail, reuse).
  A game that does not report its load is never accused.
- **Proof:** `tests/aGameStaysSmoothOnABudgetPhone.test.ts` (6; four reversions each failed); census, playtest, repair and
  perf suites green (32 files, 477 tests).
## 2026-11-21 — Real physics for 3D games: things fall, roll, topple, and ragdoll

- **Why:** the admin's plan item "real physics: objects that fall over, roll and ragdoll". The kit had none: a crate
  a car hit never moved, a stack could not topple, and a character's death could only be a canned pose.
- **What:** a new kit module `three/physics.ts` (`src/server/lib/GamePhysicsGenerator.ts`) built on cannon-es 0.20.0
  (MIT, no dependencies, pinned). Hand-writing a rigid-body solver was rejected: stacks jitter and objects tunnel.
  - `createPhysics(scene)` has gravity and a ground, and turns the scene's solid kit colliders into fixed walls.
  - `add(mesh, { mass })` sizes a box or sphere from the mesh. Also: `remove`, `explode(point, strength, radius)`,
    `ragdoll(humanoid)` (11 bones pinned at the joints, driving the kit humanoid's joints), and `step(dt)`
    (fixed 60 Hz from the game's own dt), `dispose`.
  - cannon-es is installed **only** when physics.ts ships; the repo pins the same version as a devDependency so
    our tests run against exactly what users get.
- **Root cause caught while building:** cannon's `fixedStep` reads the wall clock, so a game stepped by its own `dt`
  (and every test) barely moved. The module uses `world.step(1/60, dt, 6)`.
- **Proof:** `tests/thingsFallRollAndRagdoll.test.ts` (7). A crate comes to rest at y = 0.5. A five-box stack stands
  still for 5 s. A blast topples it away from the blast. A ball rolls and stops at a kit wall. Mass 0 never moves. A
  ragdoll lands with its head near the ground, no body below the ground, every joint's pivots still meeting, at rest.
  Four reversions each failed: no joint constraints, no scene walls, no conditional dependency, and wall-clock stepping.
## 2026-11-21 — Tune a game with sliders in the preview (admin plan: "a tuning panel … without prompting again")

- **Kit `core/tuning.ts`:** `tunable(key, default, { label, min, max, step })` returns a live handle; saved values come from
  `src/game/tuning.values.ts` (a declared DATA file — `GAME_RUNTIME_DATA_FILES` — kept by the kit once edited) and win over
  the default; every value is clamped. Inside a frame it announces its sliders to the parent (`{ nbTuneList }`) and accepts
  `{ nbTuneSet }` ONLY from `window.parent`.
- **Preview:** `src/lib/gameTuning.ts` validates the frame's list (≤ 30, plain keys, finite numbers, min < max) and writes the
  file byte-for-byte as the kit's `tuningFile()` does; `TuningPanel.tsx` (sliders, Save, Reset); `PreviewSurface` listens only
  to its own frames, shows a Tune button in the toolbar, sends each change with `postToPreview`, and Save writes the file
  through the owner-verified `/api/agentv3/import-files` (live sandbox + durable store) and `onFileEdited`.
- **Games declare tunables:** the runner starter's Game speed slider; `TUNING_RULE` in the kit handoff tells the builder to
  declare speed, gravity, enemy count, difficulty… with `tunable()`.
- **Proof:** `tests/theGameCanBeTunedInThePreview.test.ts` (9; four reversions each failed — any window setting a value,
  saved values ignored, no range, the runner slider doing nothing). Module census, runtime pack, kit history and strict kit
  compile updated for the declared data file.
## 2026-11-21 — Game repair, carefully back on: optional, asked, and one tap to undo a change that made it worse

- **Admin:** "isko savdhani se on karo … optional karo, app/game banne ke bad user se hi pucho … agar game tut jaye to user
  ek prompt se wapas undo ho jaye."
- **Found first (mapped end to end):** the ASK already existed — the playtest's problems become a one-tap "Make the game
  playable" offer that runs only when tapped, as a normal turn; the real version system already saves every good build
  whole (BuildHistoryStore / Time Machine) and `/restore-version` saves the current app before restoring; "undo /
  pehle wala" already opens the version picker. What was MISSING: nothing compared the game before and after a turn, so
  a change that broke a working game ended silently. The old automatic repair stays suspended (it edited unasked and
  rolled back from an incomplete snapshot).
- **Fix:** `gameRegression.ts` (pure): the previous turn's measure is read from the stored report BEFORE this turn's first
  progress save; after this turn's playtest, a new unplayable defect or a ≥15-point drop below 75 is "worse"; the
  version to go back to is the newest good one saved before the turn. The route records `GAME_GOT_WORSE` (detail = that
  version id); `GameUndoCard` shows the plain sentence with one-tap "Go back" (the Time Machine's own restore route) and
  "Keep this version". `docs/security/game-auto-repair-suspension.md` records what replaced the suspended path.
- **Proof:** `tests/aGameMadeWorseCanBeUndone.test.ts` (12; five reversions each failed, one after a stronger case was
  added); census green; both typechecks clean.
## 2026-11-21 — #4397 merged; batch 11 (Medieval Village), textures, FBX pictures, Q-3019, CC-BY packaging
- **#4397 merged:** batches 9 and 10, FBX attachments, the "where to get it" guide, and the library on every 3D turn.
- **Batch 11:** the Medieval Village MegaKit (CC0). The kit has no whole house, so two whole village houses were assembled from its 2 m pieces: walls with a door and windows, a floor, and a roof with closed gables. The first assembly left the gables open and the inside showed. Also a wagon, wooden fence, stone stairs, chimney and vine. Test: `libraryBatch11`.
- **Textures:** Screaming Brain Studios' Tiny Texture Pack (CC0) — 125 seamless 128 px surfaces (grass, bricks, roofs, tile, wood), losslessly recompressed from 10.3 to 4.2 MB.
  - `add_library_models({ textures })` puts one into a game: durable first, then the sandbox, with the three.js lines to repeat it.
  - Test: `theGameGetsRealSurfaceTextures`.
- **FBX pictures:** the picture an FBX names, attached beside it, is embedded as its base colour.
  - UVs are flipped for glTF on those meshes; the first try put a silver blade in brown.
  - A missing picture is named to the user. Test: `anFbxBecomesAModelInTheGame` (+3).
- **Q-3019 closed:** a Surplus model is benched only at its SECOND failure, so the retry keeps a warm cache instead of a cold-cache switch per blip.
  - Proven by reversion: putting the old rule back fails 5 tests. The two older tests now assert the new rule.
- **Indian clothing:** a CC-BY model may ship packaged, only with its author credit, which reaches the game.
  - No such model exists in the library yet. Sketchfab needs a login, so the admin downloads them.
  - Test: `aCcByModelCarriesItsCredit`.
- **Env:** `AGENTV3_EXTERNAL_GAME_ASSETS` is ON by default. ENV_REGISTRY now says the key can be deleted (a value of `admin` would keep it owner-only).
## 2026-11-21 — PR #4390 merged (3c91ff3); its 122 queue rows closed

#4390 (failedbr #1913 → #669 autopsies; Q-3041…Q-3223 and the bulk rows Q-1553…Q-1573 it resolved) merged after CI went green on
its final head and the merge with `main` (#4397) was checked clean. The 122 rows it owned were removed from the open table and their
IDs appended to `docs/claude/BUILD_REPORT_QUEUE_CLOSED.txt`; their ledgers stay in the entries above. Rows still open after it:
the admin-decision rows (Q-3137, Q-3139, Q-3142, Q-3148, Q-3157, Q-3161, Q-3164, Q-3180, Q-3198 and the older ones) and the
untouched reports below #669 (admin, 2026-11-21: old reports are set aside; only new reports are autopsied).

## 2026-11-21 — The ❗️ button: game "Go back" moves into it, and "Find and fix bugs" finally does something

- **Admin:** "alag se card dikhaoge, to user paresan ho jayega! koi new button nahi, existing ❗️ button ko hi update
  kar do" — and "❗️ me 'bug fix' popup … us par click karo, kuch bhi nahi hota hai, builder chalta hi nahi hai".
- **Go back lives in the ❗️ list.** The separate GameUndoCard is gone. A finished build's GAME_GOT_WORSE finding becomes
  a row in "What you need to do" (`userActionView.mergeLiveActions`, `gameUndo.ts`) with "Go back" (the Time Machine
  restore, current app saved first) and "Keep this version".
- **Root cause of the dead bug-fix button:** the build offers the optional deep bug hunt as a gate and waits 30 s,
  then carries on. `releaseGate` keeps the row open (rightly), but it still offered "Find and fix bugs", which answered
  a gate nobody was waiting on. The tap did nothing and the row was marked done.
  **Class:** an approve row whose gate expired offering an answer button.
- **Fix (the class):** `gateExpired(action, liveGateCallId)`. A row is live only while the running build holds that
  exact gate.
  - An expired bug-hunt row's "Find and fix bugs" starts a NEW turn ("Find and fix the bugs in my app.") with
    `bugHunt: true`. The route passes `preApproved` to `offerBugHunt`, which runs the review without asking again. On
    an app that did not finish, it says why and charges nothing for it.
  - Every other expired gate shows no Approve: "The build carried on without this answer" + Dismiss.
- **Proof:** `tests/theAlertListActuallyDoesIt.test.ts` (9) + the reworked `tests/aGameMadeWorseCanBeUndone.test.ts`.
  Reversions failed: `gateExpired` always false (2 failed), and the pre-approved branch removed (1 failed).
## 2026-11-21 — #4403 merged; a character customizer on request; the builder picks by meaning (intent map)
- **#4403 merged:** batch 11 village houses, 125 textures, FBX pictures, Q-3019, CC-BY packaging.
- **Character customizer** (admin: "par user agar bole to … user jo chahe change bol sakta hai, unexpected"):
  - `generate_character_customizer` is a recipe, run only when the user means it.
  - It writes one framework-free module into the USER'S game. The module discovers the parts of ANY loaded model: a colour picker per named material, show/hide per mesh part, size, a pose picker, reset, and the look saved per character.
  - Materials are cloned per character.
  - Tested by compiling the generated module with esbuild and driving it with real three.js. Test: `aPlayerCanCustomizeTheirCharacter`.
- **Intent map** (admin: "words par nahi intention par … universal intent picker"):
  - `gameCapabilities.ts` describes every game capability by the OUTCOME the user wants.
  - It tells near-twins apart by who changes the thing and when.
  - Its example phrasings (Hinglish, Devanagari, Tamil) are shown as examples, not triggers.
  - The rule: build what they mean, never refuse or fake.
  - It rides the library menu to every 3D game turn, with no extra classifier call. The library menu cap goes 8000 → 11000 chars (~2.5k tokens a turn in all).
  - Test: `theBuilderPicksByMeaningNotWords`.
- **Proposed, not built (needs the admin's yes):** step 2 — replace the deterministic word checks that build reports show misfiring with one cheap model call, evidence first.
- **Process note:** a second time this session, I wrote in the main checkout during a running gate. That gate was stopped; #4403 was merged on CI green for its exact commit.

## 2026-11-21 — Big worlds stream; library batch 12 (variety); the longest name wins

The admin asked: "1000 module … 100 house, 100 tree, 100 vehicle, 100 humans … kya navbharatai pura alag world bana dega?" They then approved: "ok models streaming banao, phir library variety badhao".

- **Model streaming.** `GameWorldStreamingGenerator.ts` writes `src/game/three/worldStreaming.ts` into every game that gets library models. It is written once; a later turn keeps the game's copy.
  - **What was there:** every model loaded at game start and stayed until the end. Each copy had its own draw calls. `dressWorld` capped a world at 120 copies over 120 m. Only the terrain streamed.
  - **What it does now:**
    - The world is split into cells, and only the cells near the camera exist, with one ring of slack.
    - Each model loads once.
    - All copies of a static model in a cell are drawn as one InstancedMesh per part.
    - Far cells swap to the reduced mesh (the existing LOD level 1) without a rebuild.
    - Animated copies get their own handle each, capped per device: phone 12, mid 24, desktop 48.
    - Unused models are freed past the device budget.
    - Collision marks are copied onto the instanced parts. The kit's collision already tests every instance (`shapesFor`).
  - **How the builder is told:** in the asset handoff, in `add_library_models`, and through a new `big-world` outcome in the intent map.
  - **Checks:** the generated module typechecks under strict mode with @types/three 0.180. Test: `aBigWorldStreamsModels` runs the emitted code with real three.js. Reversion proven three times: the cache, freeing far cells, and the actor cap.
  - **Not proven yet:** a frame-rate measurement in a real game on a phone. Watch the first big-world build for that.
- **Library batch 12:** 40 CC0 models from kayquer kits, live-admitted 40/40, with thumbnails.
  - 9 kinds of home, plus 6 town buildings and a beach umbrella.
  - 4 trees.
  - 8 vehicle bodies.
  - 12 people with walk and run.
  - Subjects that are everyday game words were refused: boss, pickup, manager, navigator, coach.
- **Root cause, matcher class:** a word inside a longer known name was also matched on its own ("pickup truck" → truck + pickup truck). Each earlier batch patched one hand-written exclusion at a time. Now the longest known name in a clause wins; the old exclusion table stays for non-subject senses (rock music, log in).
- **Root cause, moving subjects:** walk and run were asked for only for a hand-typed list of subjects, which the new people were not on. Now the list also includes every subject a library model animates. The role stays the game's need: "walking dog" still asks for walk, so the code-built dog walks.
- **Root cause, duplicate models:** batch 12 first listed three people that batch 4 already had. `buildLibraryBatch.mts` now refuses a model already in the library (reversion proven), and a test asserts that no model is in the catalogue twice.
- **Library menu:** subjects with the same roles now share one line. It went from 11558 to about 10700 chars, under the 11000 cap.
## 2026-11-21 — #4406 merged; FBX from Sketchfab / Mixamo / avatar creators now converts
- #4406 merged: the character customizer on request, and the intent map.
- The admin added 3 Indian-clothing models to Drive: a man in a dhoti, a man in a kurta, a woman in a saree. Their FBX exports exposed two class bugs in the server FBX import:
  - **Embedded pictures:** FBXLoader calls `window.URL.createObjectURL`, so all 3 failed to parse in Node. `withLentWindow` now lends a window for the synchronous parse only, captures the pictures (they now go into the GLB), then removes it.
  - **Face shape keys:** 126 morph targets were 42 MB of a 55 MB GLB. `dropMorphTargets` removes them and the user is told.
  - Test: `anFbxBecomesAModelInTheGame` (+2).
- **NOT in the library — licences unverified.** None of the 3 zips carries a licence file, and sketchfab.com is unreachable from this session.
  - The dhoti model looks like Sketchfab's "Indian Man In Dhoti" (earlier search: CC-BY).
  - The kurta and saree went through Mixamo (a "mixamo.com" clip, an avatar-creator body), and their licence is unknown.
  - Also too heavy for the 8 MB user path (13 MB / 23 MB after the fix; 65k / 118k triangles).
  - Waiting on the admin for each model's licence (a page screenshot).
- **OPEN root cause:** an FBX's axis setting can arrive turned (the dhoti lies on its side). FBXLoader does not apply every exporter's up-axis.
  - Mitigation: each FBX import tells the user, and a Sketchfab GLB download arrives upright.
  - Fix needed: read GlobalSettings UpAxis/FrontAxis from the FBX and rotate.

## 2026-11-21 — Firestore read bill: no whole-collection reads on the polled paths (branch `claude/firestore-read-budget`)

Admin report: `server_logs` was scanned in full about every 5 minutes (8,160 runs and about 4.5 crore reads in 30 days, 71% of the Firestore bill), plus large repeated reads of `ai_usage_logs`, `user_token_wallets`, `payment_transactions`, `admin_notifications` and `provider_cooldowns`.

- **Root cause (server_logs):** `logStore.query()` with no filter went through `listEqNewestFirst(…, [], 'ts', 500, 500)`. On a collection this large the first `.limit(500)` page is always full, and a full page makes that helper read every match in document-id order, up to its 5,000 ceiling. That is about 5,500 reads per call (4.5 crore ÷ 8,160 = 5,514).
  - Callers: Cloud Scheduler `navbharat-keep-warm` (`*/5`) → `GET /api/warm` → step `firestore:logStore` (`limit: 1`), and the admin Monitor log panel (`/api/admin/logs?limit=40`, every 30 s while it is open).
  - **Class:** an index-free "newest N" helper built for per-user filters, used on a collection that grows per event.
  - **Fix:** `queryServerLogs` uses `orderBy('ts','desc').limit(n)` (single-field index, no composite needed). Filtered searches read the newest pages under a 2,000-read budget and return `complete:false` when they stop at it. Default page size is 50.
  - Test: `tests/serverLogsReadBudget.test.ts`. A fake Firestore counts reads; the warm call now costs 1 read. A reversion test shows the old path costs more than 5,000.
- **Cleanup:** every log line now carries `expireAt` (a Timestamp) for a Firestore TTL policy. The existing daily purge already reads only expired lines (`where ts < cutoff`), so it is not a full scan.
- **`/api/admin/analytics`:** it read every wallet, every chat log and every payment on each load. Now:
  - `count()` for total users, and a ranged `count()` for new users today.
  - `orderBy(totalTokensUsed).limit(10)` for the top users.
  - `sum()` for all-time revenue.
  - A 30-day window (capped at 20,000 rows) for chat usage and purchases. The payload carries `window`, and the windowed tiles say "last 30 days".
- **provider_cooldowns:** the sync now reads only cooldowns still in force (`where until > now`). It runs every 60 s instead of 20 s, and only while this instance is routing AI calls.
- **admin_notifications:** the shared newest-50 list is cached per instance for 5 minutes and cleared on save. Per-user read/dismiss state is never cached. The client bell polls every 3 minutes, only while the tab is visible.
- **OPEN (admin action, rule 6):** the TTL policy is a database setting, and no Claude session can make it. From a gcloud-authenticated terminal:
  `gcloud firestore fields ttls update expireAt --collection-group=server_logs --enable-ttl --database='(default)' --project=gen-lang-client-0866594388`
  Use the `--database` value that matches the server's `FIRESTORE_DATABASE_ID`. Until this runs, the opt-in daily purge (`DATA_RETENTION_PURGE_ENABLED`) is the only deletion path.
- **Not changed, on purpose:** `/api/admin/users`, `/api/admin/purchases` and `/api/admin/audience` still read every wallet and payment when the admin opens them. Their substring search and sort run over the full set, and paging the read would quietly turn "search all users" into "search this page". The real fix is a search index or a denormalised summary, which is a separate decision.
## 2026-11-21 — failedbr #2481: a big game on a roadmap build gets its kit and its big map

- **Report:** "ek real gta jaise game banao, bahut bade map par, user apne charecter ko joystik se control kare" → a cube on a flat plane. The build said "The game kit was NOT laid down (this request is not a game the kit serves)", and the big-app planner told the user a large map "needs dedicated backend infrastructure".
- **Root cause 1 (kit skipped):** the request read LARGE, so the mega roadmap wrote step 1 ("a flat terrain (like a square plane) … a cube or capsule"). `gameTurnRequest` marked it as a game's milestone, but `gameKitPlan`, `wantsSceneDetail` and `gameTurnHandoff` each re-read the domain from the whole turn text, and the step's words outvoted the game ("real-estate"). **Class:** a turn's domain decided from the planner's words instead of the user's request. **Fix:** one reader, `turnIsGame` (gameKitSeed.ts), trusts the `GAME_MILESTONE_LINE` that `gameTurnRequest` writes only when the user's own request is a game; every turn reader uses it. Census test: `analyzeRequirementGaps(` appears once in the seed (inside `requestIsGame`).
- **Root cause 2 (planner unaware of the kit):** `gamePlannerCapability` said only "plan a limited playable slice", so the planner called a big map infrastructure and planned @react-three/fiber + a cube. **Fix:** the capability is built from the same plan the seed runs and tells the whole kit (big library map, city, traffic, people, physics, joystick), that a big map is never an infrastructure ceiling, and that step 1 is playable on the map. `roadmapGuardrail` refuses a roadmap that brings a second 3D engine to a kit game (same class as the native-stack refusal), unless the user named it.
- **Tests:** `tests/aBigGameGetsItsKitAndMap.test.ts` (8, uses the real #2481 request and step 1). Reversions proven: marker check removed → 3 failed; guardrail disabled → 1 failed. `br1958Prevention` capability assertion updated to the new wording.
- **Watch on the next big game build:** `FAST_LANE_SKIPPED_GAME` must not appear with "not a game the kit serves"; the kit seed line should list `generate_athree_map`; the roadmap note must not call the map infrastructure.

## 2026-11-21 — every planner is told what the platform's builder has (admin: "Planner ko … sab batao")

- **Class (from failedbr #2481):** a planner decides an app's steps and what is "beyond a normal build" without knowing what is ready. The game half was fixed above; this covers apps and games together.
- **Built:** `src/server/AgentV3/plannerCapabilities.ts` — `platformCapabilityDigest()`, generated from the tool catalog itself (167 recipes, one line each from the recipe's own description; docs/ignore-file housekeeping left out; AI product names scrubbed). ~22 KB, computed once.
- **Wired into all four scope-deciding planner calls** in `routes/agentv3.ts`: the mega-app roadmap, plan mode, the Software Project Mode planner and its replan. The roadmap call's recorded prompt size counts it.
- **Tests:** `tests/thePlannerKnowsWhatThePlatformHas.test.ts` (7): catalog census (a new recipe reaches the planner by itself), apps + games coverage, White-Label guard, size cap, and a route census (no planner system prompt used without the digest). Reversions proven: digest removed from the project planner → 2 failed; vendor scrub removed → 1 failed.
- **Honest cost:** about 5–6 thousand extra input tokens on each planner call (one call per big build, plus plan mode when the user asks for a plan). Watch the next big build's roadmap for slower or lower-quality planning on the weak tier; if seen, the digest can be narrowed to the request's domain.
## 2026-11-21 — Autopsy failedbr #2481: a GTA request delivered as a purple box (Q-3224)

Admin: *"gta jaisa bada game bnane ko bola, to yeh ghumne wala dabba bana diya!"* Report #2481 ("succeeded", 4.1 min, Weak/Surplus):
- The mega-roadmap split the request; step 1's brief was "a flat terrain (like a square plane) … a simple player character (can be a
  cube or capsule). Use OrbitControls". `gameKitPlan` and `gameTurnHandoff` re-read the DOMAIN of the milestone text — REAL ESTATE —
  though `gameTurnRequest` had marked it as a game's. FAST_LANE_SKIPPED_GAME: "not a game the kit serves". Fix: `isAGameTurn`.
- The planner called a big map, traffic and pedestrians "backend infrastructure … browser mein nahi ho sakti". Fix: planner rule 9,
  `GAME_KIT_CLAUSE` on every game step, a game's own needsInfra is not a ceiling (only multiplayer), the false note dropped.
- "Succeeded" with no playtest: the R3F scene (`@react-three/fiber`, `<Canvas>`, `useFrame`) matched neither half of
  `isCanvasGameProject`. Fix: R3F counts when the user asked for a game; the skip reason reads the same condition.
- Seen, not fixed here: the console check probed ports 3000/5000/8080 the app does not use and reported 502s (~30 s of struggle);
  the summary came in English for a Hinglish prompt.
Locked by `tests/aGtaRequestIsNotABox.test.ts` (reverted ⇒ 6 + 2 fail). Admin 2026-11-21: open the PR, do not merge.

## 2026-11-21 — #4414 and #4415 combined into one (admin: "dono ko milakar ek kar do")

- Two sessions fixed failedbr #2481 in parallel (8 minutes apart). #4415's branch is merged into #4414's; one implementation of each thing is kept.
- **One game-turn reader:** `turnIsGame` / `GAME_MILESTONE_LINE` (#4415's `isAGameTurn` / `GAME_MILESTONE_MARKER` renamed onto it; its three readers plus `wantsSceneDetail`, the sibling #4415 had not reached).
- **Kept from #4415:** the R3F game is playtested when the user asked for a game (the "succeeded with nothing played" root cause, which #4414 had missed); a game's own `needsInfra` is not a ceiling; the false "needs backend" note is dropped; planner rule 9; queue rows Q-3224/3225/3226.
- **Reconciled:** #4414 refused a whole roadmap that named a second 3D engine; #4415 kept the roadmap and appended a kit clause that did not mention the engine (two opposite instructions in one step). Now the roadmap is kept and the clause itself overrules the engine. The clause is said only for a 3D kit game (`game3D`, from the caller's kit plan) — #4415 said "big map, follow camera" to every game, a Ludo board included — and never when the user named the engine. `megaRoadmap.ts` no longer reads the domain itself; the caller's kit decision is the one answer.
- Q-3225 and Q-3226 stay OPEN in the queue.

## 2026-11-21 — failedbr #2481, the two small items: Q-3225 (probe 502s) and Q-3226 (English narration)

- **Q-3225.** The preview flip visited candidate ports 3000/5000/8080 in the sandbox browser with console recording on; the sandbox's 502s were written into the app's runtime record and the builder chased "network issues" on a healthy app (pkill refused, ~30 s lost). Class: our probe's facts recorded as the app's. Fix: `portVisitBrowseOpts` (PortDiscovery.ts); both flip loops (Diagnose route, import path) pass it, so a probe never records.
- **Q-3226.** On a roadmap build the language line said "the user wrote this request in …" above the planner's English brief; the user's own message was not in the turn. Fix: `usersOwnWordsLine` (LanguageDetect.ts) quotes the user's message and names the brief as the planner's, via `buildLanguageInstruction({ briefReplacesRequest })`, read identically by the architect and every sub-agent. The earlier BR1952 system-prompt binding alone was incomplete for a weak builder. The platform's own fixed English lines are UI text under the Language standard, not a defect.
- **Tests:** `tests/aProbeIsNotTheApp.test.ts` (8). Reversions proven: probe flag removed → 1 failed; brief flag removed → 1 failed. Two existing source guards updated to the new shared argument list.
- **Open honesty:** Q-3226 is an instruction to a model; it cannot be made deterministic. Watch the next Hinglish roadmap build.

## 2026-11-21 — failedbr #2485 autopsy: the player stands on the big map (open-world starter)

- **Report:** "ek bada open-world 3D game … PUBG, GTA aur racing" → succeeded/YELLOW, but the user saw no map: a character walking in the air. The kit WAS seeded (runtime, 3D, Athree map, vfx, melody, shell; 83 files).
- **Root cause:** the Athree map and the game shell were laid side by side with no code between them. The map streams terrain around a camera and re-bases its origin; the character controller walks on collider meshes (and on an implicit y = 0 when there are none); the kit city is flat at y = 0. Joining them was left to the builder, which instead wrote CustomGame.tsx (never used), its own characterController.ts and WorldSetup.ts over 70 steps. **Class:** two kit layers that only work together, shipped with nothing between them.
- **Built:** `GameOpenWorldGenerator.ts` → recipe `generate_open_world`: `src/game/play/openWorld.ts` (a ground patch sampled from the map's own height function follows the player; the sea is swimmable; origin shifts move the player and anchored objects; `world.place()`), and `src/game/OpenWorldGame.tsx` (the starter: setup/update props). The map gained `world.levelGround()` / `clearAt()` so a city stands on levelled ground with nothing growing through it; the city brings traffic, people and parked cars given to `ctx.vehicles`.
- **Wired:** the seed plans `generate_open_world` after the shell for an on-foot big-map game and asks it to mount `src/App.tsx` (only where no game is mounted); `ON_FOOT_LINE` / `CITY_LINE` carry both answers into roadmap milestones; `OPEN_WORLD_HANDOFF` tells the builder the game already plays. Catalog, RECIPE_TOOLS, GAME_RECIPES, GAME_STARTERS, kit history, AppKnowledgeBase (`game_open_world`).
- **Proof:** real Chromium (software GL): the character is grounded on the terrain at its exact height, walks 30 m and runs 42 m, and with `city: true` starts on a street between buildings; no page errors. `tests/thePlayerStandsOnTheBigMap.test.ts` (9) runs the real generated kit headless; reversions proven (flat patch → fails, levelling off → fails, plan without the starter → fails). 176 related test files pass.
- **Queue:** Q-3224/3225/3226 closed (merged in #4414/#4416). Q-3227/3228 this PR; Q-3229 (replace the character by text or from the library) is next; Q-3230…3236 open, Q-3234 blocked on the provider.

## 2026-11-21 — a game grows by features: 1 to 100 additions without breaking (admin: "sirf 2 hisse nahi … 10-100 kitne bhi")

- **Admin's point:** joining two layers is one case; a user keeps adding things to the same game, and each addition must join without breaking what works.
- **Class:** a game written as one big setup() is rewritten on every request, and each rewrite can break what worked.
- **Built (kit, every game on the shell):** `src/game/play/features.ts` — `defineFeature({ id, needs?, setup, update, dispose })`, `createFeatureHost()`, `withFeatures(options, list)`. Each feature runs inside its own guard: one that throws (in setup or update) is switched off, named once in the console (`[feature <id>] switched off — …`) and announced as `FEATURE_FAILED`; the others keep running. `needs` orders features, shares values (`api.get(id)`), and switches dependants off with the reason when a base fails; duplicate ids and circular needs are refused by name. New shell module `features`.
- **Wired:** `<OpenWorldGame features={FEATURES} />`; the open-world mount creates `src/game/features/index.ts` once (the user's file, never replaced) and App.tsx passes it. `GAME_FEATURES_RULE` is in the first build's handoff and — read from the project's own list — on EVERY later turn (`gameTurnHandoff`), even when the turn's words name no game ("police bhi daalo").
- **Proof:** `tests/aGameGrowsByFeatures.test.ts` (8) on the real generated host: 100 features in order; 1 throwing among 99 (990 of 990 other steps run, one console line); setup failure; needs/sharing/cascade; duplicates; withFeatures. Reversions proven (guard removed → fails; rule not said on a non-game-worded turn → fails). Real Chromium: a throwing feature beside a working one — the working one ran 202 steps, one console line, no page error. 226 related test files pass.
- **What is enforced and what is an instruction:** the isolation, ordering and the "said on every turn" are code. "Add one file, do not rewrite the others" is an instruction to the builder; GreenGuard still restores the last working version if a turn breaks the render. A write-time refusal of a turn that rewrites other features' files is the next hardening if a report shows it happening.

## 2026-11-21 — a map grows by regions into a giant map; map places in the game library (admin: "1-1 kar ke ya ek sath kayi map jod ke … giant map")

- **Admin's point:** a user adds maps one at a time or several together; "map / jameen bada karo" or, in a race, "track / road bada karo" must add map or road by INTENT; the user can pick maps and objects from the game library.
- **Class:** a world that is one hand-built scene is rebuilt to be made bigger.
- **Kit:** `play/openWorld.ts` takes `regions: [{ id, kind: 'city' | 'town' | 'village', toward?, distance?, city? }]` (up to 12). Each place gets the flattest dry ground in its direction, levelled before the terrain is drawn, never on top of another place; far places are not drawn and only near ones run traffic and people. `world.regions`, `world.nearestRegion()`. The old `city` option is the first place.
- **The game's own map file:** the mount writes `src/game/world.ts` once (`WORLD.regions`), App passes `world={WORLD}`; never replaced.
- **Intent → smallest change:** `GAME_WORLD_RULE` (bigger land → ADD a region per place asked for, several at once when asked; bigger city → edit only that entry; never touch the others) and `RACE_ROAD_RULE` (road-library race: longer road → `finishKm`, or endless). `projectGrowthRules(files)` says them on every later turn from the project's own files, with the features rule.
- **Library:** `mapPlaceRows()` — New city / New town / New village under the `map-places` category of the existing Game Library picker (search works in English and Hinglish); choosing one sends "Add one more <kind> to my game's map … keep every place already on the map". Objects were already there (unchanged).
- **Proof:** `tests/aMapGrowsByRegions.test.ts` (8) on the real kit: three places each level, spread apart, east is east; a far place frozen and hidden; the cap and duplicate ids; the rules by project files; the library rows and prompts. Reversions proven (far-freeze removed → fails; world rule not said → fails). Real Chromium: three places built, the player teleported into the town stands grounded on its street, no errors. 233 related test files pass.
- **Not built (honest):** only places the kit can generate are offered (city, town, village) — no other map files exist in the library yet; a longer race is a prop of the road library, not new road geometry; "add a region" is done by the builder following the rule (an instruction), not yet by a deterministic platform action.

## 2026-11-21 — the growth guard: adding never rewrites what works, enforced by two locks (admin: "isko rocksolid karo")

- **Class:** an invariant of the user's project that only a prompt defended ("do not touch the other files").
- **`growthGuard.ts` (one pure verdict):** in a game that grows by lists, an existing feature file may be edited only when the user's own words name it, are about everything, are a repair, or give permission; removed only with a removal word AND its name. The features list and the map's regions are append-only (a dropped entry is re-listed, the turn's own additions kept). The mount keeps `<OpenWorldGame … world={WORLD} features={FEATURES}>`. Kit files are not edited (the kit's current version and the platform's own writes are always allowed).
- **Lock 1 (ToolDispatcher):** `write_file` / `write_files_batch` / `replace_symbol` / `edit_file` on a protected file is refused at the write with what to do instead; the refusal is remembered.
- **Lock 2 (growthTurn.ts → route, before any check looks at the app):** whatever the door (a shell command, a script), every protected file is compared with its turn-start content and a change that was not asked for is put back inside `runInPass('growth-guard-restore')`; `GROWTH_GUARD_RESTORED` in the report, plain words to the user. A read that fails is never treated as a deletion.
- **When a change really is needed (admin: "agar badalna sach me zaruri hua to?"):** the user decides. The platform itself ends the turn naming the working parts the builder wanted to change and the words that allow it ("police bhi badlo", or "jo zaroori ho badal do" for this once) — `GROWTH_GUARD_ASKED`. Permission to change is never permission to delete. The game engine is never edited for one game.
- **Library place-add is the platform's (worldGrow.ts):** the library's exact request for New city / town / village appends one entry to the live `src/game/world.ts` at turn start (`MAP_PLACE_ADDED`), with a fresh id, every existing entry byte-for-byte; at 12 places it says the map is full. No model call makes the change.
- **Proof:** `tests/addingNeverRewritesWhatWorks.test.ts` (15: verdict, both locks through real ports and a real dispatcher, the ask note), `tests/aPlaceFromTheLibraryIsAddedByThePlatform.test.ts` (7). Reversions proven (edit guard removed → fails; feature verdict opened → 4 fail; restore write removed → fails). 967 dispatcher/route test files ran: the one failure was the post-answer writer census, which now counts the new named pass (`growth-guard-restore` in ALLOWED_PASSES).
- **Found on the way:** Q-3237 — the route handler is at TypeScript's control-flow limit (TS2563).
- **Kill switch:** `AGENTV3_GROWTH_GUARD=off`.

## 2026-11-21 — which part the user means: by meaning, not by the file's name (admin: "sipahi … isko intention ke anusar banao")

- **The weakness named in the last entry:** the growth guard opened a part only when the request's words matched the part's file name — a name the builder chose, not the user. "sipahi ko tez karo" did not reach `police.ts`.
- **Class:** a decision about the user's intent made by matching their words against a name they never chose.
- **`partMeaning.ts` (pure):** a part is known by (1) its id's words, (2) its own `about: [...]` list (new on `GameFeature`; the features rule tells the builder to give it in English and the user's language), (3) THE USER'S OWN WORDS for it, kept by the platform in `src/game/features/names.json` (filed when a part is made, and again whenever a request is about it; six sayings, bounded), and (4) a table of ~70 meanings of the things games are made of, in English, Roman Hindi and Devanagari (police = sipahi = cop = पुलिस). Words that say nothing and words most parts share never decide; Roman-Hindi and English plurals are stemmed.
- **Wired:** `requestIsAbout` in `growthGuard.ts` (edits, removals, the features list); the dispatcher and the end-of-turn lock both pass what is known from the turn-start project; `growthTurn.ts` writes the record (also on a first build); `names.json` is protected — only the platform writes it.
- **Still shut when unclear, on purpose:** an unknown word opens nothing and the platform asks (growthAskNote). No model's guess is allowed to open a working part: a wrong "yes" would rewrite what works.
- **Proof:** `tests/thePartTheUserMeans.test.ts` (8): the exact "sipahi" case in three scripts, `about`, the remembered word no table knows ("chowkidar"), first build, bounds, protected record, non-distinctive words. Reversions proven (meanings removed → 4 fail; record not written → 2 fail). The lock-2 call moved out of the integrity try block (its harness executes that block alone) and skips a declined turn.

## 2026-11-21 — failedbr #2485, the remaining rows: the game on screen before the builder starts, a playtest that keeps what it measured, a one-call review, a replaceable character (admin: "yeh sabhi bhi fix karo")

- **Q-3231 (explorer said "covered" for a captured mouse):** `clickExplorer.ts` releases pointer lock and retries before calling a button covered. `tests/aCapturedMouseIsNotACoveredButton.test.ts` (real browser).
- **Q-3230 (playtest threw away its evidence at the time limit):** the watchdog in `gamePlaytest.ts` now returns what the keyboard stage measured, marked partial; the phone dimension is "not checked" (excluded from score and defects), never a failure. `tests/aPlaytestThatRanOutOfTimeKeepsWhatItMeasured.test.ts`.
- **Q-3236 (lean review went into a tool loop on a long file):** `ReviewerAgent.leanReviewInline` shows long files as marked head excerpts, so a lean review always answers in one call. `tests/aLeanReviewAlwaysAnswersInOneCall.test.ts`.
- **Q-3233 (minutes of spinner before anything was on screen):** `seedPreview.ts` — when the seed has mounted a playable game, the preview starts before the builder's first call. Kill switch `AGENTV3_SEED_PREVIEW=off` (ENV_REGISTRY). `tests/theGameIsOnScreenBeforeTheBuilderStarts.test.ts`.
- **Q-3232 (the seed's time was one number):** per-recipe milliseconds in `GAME_KIT_SEEDED`. Instrumented only — the slow recipe is named by the next real report.
- **Q-3235 (first reply repeated the task back):** `usersOwnWordsLine` now says the first reply starts the work with a tool call.
- **Q-3229 (the character could not be replaced):** class — the player's body was a fixed look inside the shell that nothing in a game named. Now ONE user-owned file, `src/game/player.ts` (written once at the mount): `look` restyles the kit person (`GameOptions.playerLook`); `model` puts a library model in its place (`play/playerBody.ts`: person-sized, feet on the ground, turns with the controls, idle/walk/run when the model has them; the kit person stays while it loads or if it cannot load). `GAME_PLAYER_RULE` on every turn of a game with the file; the library screen gained "Use as my character" (`useAsCharacterPrompt`, `characterPrompts` on the route); the growth guard refuses deleting the file and keeps `player={PLAYER}` in the mount. AppKnowledgeBase `game_player_character`. Proof: `tests/thePlayerCharacterIsReplaceable.test.ts` (11, reverted-and-failed) + a real Vite build run in Chromium for both paths (restyled person; model in place with the kit person hidden, 0 console errors).
- **Honest limits (Q-3229):** open-world starter games only; a game mounted before this change has no `player.ts`; a model has only the moves it was made with; the library swap is carried out by the builder following the rule (the platform does not do it itself, unlike a library map place).
- **Q-3237 → 🟡 BLOCKED (admin decision):** splitting the 17,000-line route handler is the riskiest refactor in the repo with several sessions editing it daily; options and a recommendation are in the queue row. **Q-3234** stays 🟡 BLOCKED (external provider).
- **OPEN root cause (billing, admin's decision):** #2485 charged ₹41.52 for a game that was never played.

## 2026-11-21 — #2485 follow-up: the kit is written several files at once; a library character is set by the platform; nothing changed on a guess; a refused request is named (admin: "andaze se kuch bhi change/update na ho … q3229-3234 sab fix karo")

- **Q-3232 — root cause found in the code:** `writeRecipeFiles` wrote ~120 kit files one after another, three sandbox round trips each. Now up to 6 in flight (`RECIPE_WRITE_CONCURRENCY`); receipt order kept; additive compositions stay serial; a failure starts no new file. `tests/aKitIsNotWrittenOneFileAtATime.test.ts` (reverted ⇒ fails). Not yet measured on a real sandbox — watch `recipes N s` on the next game build.
- **Q-3229 — the library swap is the platform's now:** `characterSwap.ts` + `setLibraryCharacterAtTurnStart` (growthTurn.ts): the library's exact "Use as my character" request adds that exact model through `add_library_models` and sets `PLAYER.model` (one line; every other byte kept). Not in the library / could not be added / the file is not in a settable shape ⇒ nothing is written, `PLAYER_CHARACTER_NOT_SET` is recorded and the builder is told to say so and ask. `tests/aLibraryCharacterIsSetByThePlatform.test.ts`.
- **"Nothing on a guess" (admin rule):** `GAME_NO_GUESS_RULE` is said on every turn of a game that grows by lists: do what is clear, change nothing that is unclear, ask one short question naming the choices. This is an instruction to the builder, not an enforced lock; the enforced locks remain the growth guard and the platform-done library actions. Scope today: games on the features list only — whether it should be said in every app build is the admin's call.
- **Q-3234 — the honest half:** six attempts answered HTTP 404 and each was reported as "invalid_completion". Every attempt line now names the status; the server log keeps the engine's machine code token. `tests/aRefusedRequestIsNotAnInvalidCompletion.test.ts`. **OPEN root cause:** why the engine answered 404, and whether a refused request should be retried on the same model (routing decision) — 🟡 in the queue with options.
## 2026-11-21 — a signed-in user told "Please sign in" by the Pro build; an empty private-files row (admin screenshot)

- **Evidence:** signed in (avatar shown); the build answered "Please sign in to build with NavBharatAI Pro"; the queue said "Not your workspace."; the private-files list on the same screen loaded with the same account (its GET was verified).
- **Root cause:** the build asks for a FRESH token (`getIdToken(true)`, a network call). The build hook kept a private copy of the header helper whose catch dropped the token entirely when that call failed, so the build went out anonymous while every request sent with the cached token was verified. "Not your workspace." followed from it (the workspace was never registered to the user). **Class:** a transient refresh failure turned into "not signed in". **Fix:** one token path, `currentIdToken` (lib/authHeaders.ts) — a failed forced refresh falls back to the cached token (the server still verifies and refuses an expired/revoked one); the hook's private copy removed; a `signin` 401 for a user signed in here is retried once (pre-stream, no build started), and if it still fails reads "Your sign-in could not be confirmed on this device. Please sign out and sign in again" — never "please sign in".
- **Not proven from here:** production logs (the `AGENTV3_ANON_FALLBACK` audit line carries the exact reason) are not reachable from this session; the fix covers the client-side cause the evidence points to. If the admin still sees the new message after this deploys, the cause is server-side verification and that audit line says which.
- **Empty panel:** "Private attached files · all my chats (0)" is hidden while nothing is saved and nothing failed; it appears with the first saved original (the feature stays). AppKnowledgeBase updated.
- **Tests:** `tests/aSignedInUserIsNotToldToSignIn.test.ts` (7); reversion proven (fallback removed → 1 failed). Three mounted-client fixtures updated for the shared helper. 47 related test files pass.

## 2026-11-21 — admin decisions applied: "no guess" in every app lane; a refused engine request benches at once; the build route split begins (admin: "1. han … 2. a 3. a")

- **No guess, every lane:** `NO_GUESS_RULE` (noEvalRule.ts) in the architect, fast-lane and one-shot prompts: an unclear change is not made — what is clear is done and ONE short question names the choices; a new app asks first only when it could mean two really different apps; an obvious default is not "unclear"; an exact request is never questioned back. Sub-agents do not carry it (they answer the architect). It is an instruction to the model, not an enforced lock. Locked in `tests/aLibraryCharacterIsSetByThePlatform.test.ts`.
- **Q-3234 option A:** `refusedOutright` — a 4xx refusal (not 408/429) benches the Surplus model on its first failure. Test in `aRetriedAttemptIsReported.test.ts` (reverted ⇒ fails).
- **Q-3237 option A, phase 1:** route smoke check moved to `buildPhases/routeSmoke.ts`; `tests/theBuildRouteIsSplitByPhase.test.ts`; CLAUDE.md core rule "the build route's handler only shrinks". Next: one phase per PR.

## 2026-11-21 — admin's screenshot items + autopsy of failedbr #2487/#2488/#2484 (admin: "find and fix bugs sach me … wake up … autopsy")

- **Q-3238 "Find and fix bugs" is a real hunt:** `optionalBugHunt.ts` — `BUG_HUNT_TURN_BRIEF` (read every source file, typecheck, preview errors, fix only real bugs, honest list), `bugHuntReviewScope` (whole app, not this turn's edits), the review runs with no edits and in the fast lane, full strength (`greenReviewPlan({ userAskedToFix })`). `tests/findAndFixBugsReallyHunts.test.ts`.
- **Q-3241 the game was never played (both builds, 1–3 fps):** reproduced locally on the real kit; the shell starts at the low tier and the open-world map at its phone tier on a software renderer. Measured 5 → 12.75 fps (start screen), 1.25 → 5.75 (playing), Play 5.2 s → 2.1 s. `tests/aBrowserWithNoGpuStartsAtTheBottom.test.ts`.
- **Q-3242:** "open world" no longer makes "levels" a required feature (`gameIntent.ts`).
- **Q-3243 (honesty half):** the map rule says regions are only city/town/village and the builder must say so instead of renaming towns. Real land regions: open.
- **Q-3239 (proof card in the timeline + Dismiss) and Q-3240 (Wake up really wakes):** separate PRs.
- **Open, queued:** Q-3244 (summary claimed "fully functional" for an unplayed game), Q-3245 (#2484: 5.4 min of preparation before any model call), Q-3246 (8 read-only turns; 32 steps after "ready").
- Evidence that #4420's Q-3232 fix landed: #2487's seed recipes took 25.0 s (61.5 s on #2485); SEED_PREVIEW_UP 27 s after the kit, first render at 87 s.

## 2026-11-22 — a completed Weak build is billed even when Surplus receipts do not settle (failedbr #2487; owner: "yahi to hamara revenue hai")

- **Q-3247.** Root cause: `surplusBuildCharges` threw on ONE call without a valid receipt and the route absorbed ALL Surplus calls at ₹0; only a user Stop had an estimate (BR2279). Now: per-call settlement, and a completed Weak build (preview ran, own files, not a stop) bills the unsettled calls an estimate — recorded tokens × cheapest published Surplus rate × `tieredMarkupUsd`, capped at 10× cost, `SURPLUS_UNSETTLED_COST_ESTIMATED`. One helper for both billing points (`decideSurplusStopTokenFloor`). Kill switch `AGENTV3_BILL_SURPLUS_UNSETTLED_ESTIMATE=off`. #2487 would have been $0.64 (cost estimate $0.16). Owner decision recorded in ROUTING_AND_BILLING.md (2026-11-22). Open: why #2487's receipts did not settle.

## 2026-11-22 — real lands on the open-world map: desert, jungle, mountains, snow, beach (failedbr #2488, Q-3243)

- `setLand` in the Athree world (biome override inside a ragged-edged area; mountains rise from dry land), land region kinds in `play/openWorld.ts` (`OpenWorld.lands`), the map rule, worldGrow and five new Game Library map places. Places and lands share the 12-region limit. `tests/aDesertIsReallyADesert.test.ts` runs the real kit with the #2488 request; Chromium shows the mountain beside the city, 0 console errors.
- Also in flight: #4426 (Weak billing estimate), #4427 (correction at the top), #4428 (build start bounded; the seed is not the builder's work).

## 2026-11-22 — a universe of maps: up to 100 places and lands, cities built as the player nears them (failedbr #2490, Q-3248)

- `play/openWorld.ts`: MAX_REGIONS 100; every place planned at once (spot + levelled ground), its city built only within BUILD_AHEAD (1.5 km), one per frame; golden-angle √n spiral with dry-ground search; `OpenWorld.places` lists all. The rule: bigger = more regions (never sizeMeters), duplicate = copies. `MAX_PLACES` 100. Tests: aUniverseOfMaps, the 100-region headless test; Chromium: 60-place universe, start screen 2.1 s, 0 errors.
- Q-3249 queued: the claim audit called a typechecked build "no typecheck ran".

## 2026-11-22 — racing is the user's to change: their own car, their own track, anything else (admin: "racing game ko bhi AI se modified karwa sake, sab free hand do")

- Root cause: the race starter had one kit car and one road library, and `RACE_ROAD_RULE` ended "Never hand-build a second track" — the library was a cage, and a user's attached car or track had no path into the game.
- Kit `src/game/play/raceCustom.ts` (new generator `GameRaceCustomGenerator.ts`, shipped only beside `RacingRoadGame.tsx`): `RacingRoadGame` reads the game's own `src/game/car.ts` (CAR: colour, tuning, or a model — a project file or a saved library subject, sized to the car, the kit car keeps driving) and `src/game/track.ts` (TRACK: a track model becomes the ground; the racing line is read from its road or given as points; laps, position and rivals run on it). A car model that does not load, or a track that cannot be raced on, is said on screen with the reason. `createRace` now takes anything with `poseAt`.
- Platform path: Game library → "Use as my car" (`carSwap.ts`, through `libraryActionsAtTurnStart`) adds the model and sets `CAR.model` itself, or writes the car file; where it cannot, nothing is changed and the builder is told to say so. `RACE_ROAD_RULE` rewritten as a map of paths (library = starting point, a clear request wins); a race turn now also carries `GAME_NO_GUESS_RULE`.
- Tests: `aRaceCarAndTrackAreTheUsers` (real kit, headless), `aLibraryCarIsSetByThePlatform`, new cases in `racingRoadStarter`. Honest limits: track scenery is not solid; rivals are kit cars; a loop that crosses itself, a point-to-point road or an open flat area needs TRACK.line. An attached model becomes the car through the builder following the rule (no deterministic platform step for attachments yet).
- OPEN (found, not fixed here): on the ROAD LIBRARY with `finishKm`, "Play again" after the finish restarts the race (race.ts resets its own distance) but the car and the stream keep their distance, so the next race ends at GO. race.ts's comment says the game puts its car back at `stream.startPose`; RacingRoadGame never did, and TrackStream has no reset. Needs a stream reset (re-create the stream or a `reset()`); the user's own track already resets (`ModelTrack.reset`).
- 2026-11-22 (follow-up, same PR): the "Play again ends the next race at GO" bug recorded above is FIXED — TrackStream gains reset() (lays the course again from its first piece, distance 0, origin 0) and onReset; race.ts calls stream.reset() on Play again before placing the rivals; RacingRoadGame puts the car on the new start line in onReset. Test: the new case in tests/aRaceHasRivalsACountdownAndAFinish.test.ts drives a real car along the real streamed road past a rebase (removing the reset call fails it).
## 2026-11-22 — any clear edit to any game is done, never refused or put back (admin: "isko aur flexible aur strong karo! user koi bhi game banaye kuch bhi edit/update karwa sake!!", Q-3252)

- **Class:** protective rules written as cages — the growth guard and the game prompt rules protected a working game from the user's own explicit request, not only from unasked changes.
- **Gaps found (each a real request, now a test):** "jo chahe badlo" / "change whatever you want" / "apne hisaab se badal do" opened nothing; "poora game badal do, ab yeh racing game hai", "sab kuch hata ke naya game banao", "redo the whole game from scratch" had every old feature, the features list, the map's places and the `<OpenWorldGame>` mount PUT BACK; "poora world badal do" had the old places put back; "apna camera chahiye", "joystick ko bada karo", "shehar ka traffic kam karo" were refused at the write (kit files refused for every request); "OpenWorldGame hata do, mera apna 2D game likho" had the mount put back; "missions wala part hatao" did not reach a `deliveryJobs` feature; a put-back whose write failed was told only to the report.
- **Fix (one verdict, growthGuard.ts):** FREE_HAND opens edits (never removals); `replacesWholeGame` / `replacesWholeMap` (whole-scope word as the verb's object, or "from scratch") open removals; `mayEditKit` / `mayRemoveKit` open exactly the kit part a request names by name or by what it does (`partMeaning.kitPartVocabulary`); `mayUnmount`; `growthNotRestoredNote`; refusal and ask-note now name the words that open a part instead of "the engine is never edited".
- **Prompts:** `GAME_ASKED_CHANGE_WINS` (gameKitSeed.ts) in GAME_FEATURES_RULE, OPEN_WORLD_HANDOFF, the non-open-world kit handoff and every `projectGrowthRules` set; OPEN_WORLD_HANDOFF and GAME_KIT_RULE say "a second copy" is banned, a change the user asks for is done (camera via `options={{ camera: … }}`); VEHICLE_CAMERA_RULE_LINES is a default, not a refusal of an asked view.
- **Kept:** protection for requests that do not ask (repair or "sab" alone never opens the kit; a quantity/possessive "whole" replaces nothing; App.tsx deletion always restored); GAME_NO_GUESS_RULE untouched.
- **Not touched (other sessions):** RACE_ROAD_RULE ("never … shorten the road" refuses "race chhoti karo"), GAME_PLAYER_RULE, characterSwap.ts, player.ts. The kit's own file comments ("never replace the world, the player or the camera" in OpenWorldGame.tsx) were not changed (kit hash history).
## 2026-11-22 — Nothing passes through anything (Q-3251, admin: "do object takrayenge to aar paar nahi jane chahiye")
- Root cause: city traffic and the crowd compared world positions with plan coordinates, so on the open-world map (city away from the origin) cars drove through the hero and people walked through him.
- citytraffic.ts / citypeople.ts read positions in the city's frame; traffic.pushOut called every frame by play/openWorld.ts for the player or their car.
- collision.ts gains keepApart(movers) for any two moving things; GAME_COLLISION_RULE (gameCollisionRule.ts) said in GAME_KIT_RULE, the seed handoff and projectGrowthRules.
- Test: tests/twoThingsNeverPassThrough.test.ts (reversion of inCity fails 2 tests). Traffic-vs-traffic was measured already clean; locked, not changed.

## 2026-11-22 — A finished build ends clean (failedbr #2494/#2495/#2496; Q-3290..Q-3294, admin-approved)
- Ledger: 5 items — Q-3290, Q-3291, Q-3292, Q-3293 fixed in this PR (close when merged); Q-3294 🟡 blocked on the project owner.
- Q-3290 end-of-build wait: problem → the user waited 30 s after "Done" for the optional bug-hunt question. Root cause → the offer was a gate the finished build awaited (2f46a4d8 had only shortened it, 90 s → 30 s: the instance). Class → a question about optional work holding a finished turn open. Fix → `bug_hunt_offer`, a standing non-blocking ❗️ row; the turn ends with its work; "Find and fix bugs" starts a bug-hunt turn (preApproved). Lock → tests/aFinishedTurnHoldsNoQuestion.test.ts (census of waitForUser vs the review decision; a wait put back fails it).
- Q-3291 scratch copies: problem → `world.ts.backup` shipped; `worldCorrected.ts` compiled with the app. Root cause → nothing asked "is this a copy of a project file?" (scratchCapture.ts covers tool output only). Siblings → write_file copies and shell `cp` copies, both lanes. Fix → SCRATCH_COPY_RULE (builder prompt) + scratchCopies.ts net (exact patterns, this build's, new this turn, unreferenced, unnamed). Lock → tests/aScratchCopyIsNotTheApp.test.ts.
- Q-3292 peak memory honesty: 99% with zero pressure. The probe now reads memory.current + anon/file; the line says "No memory pressure" only when the counters prove it. Lock → tests/cgroupOwnPath.test.ts 1b.
- Q-3293 (discovered): a second browser daemon started on every cache miss (new server instance on a resumed sandbox, browser_action retry) and leaked a whole Chromium. Fix → precheck reuses a live daemon, kills stale ones. Lock → tests/oneBrowserDaemonPerSandbox.test.ts (real processes; un-bracketed pkill kills its own shell and fails).
- Open: Q-3294 — the #2494 workspace still holds `src/game/world.ts.backup` (pre-existing, never auto-deleted). How much of the 99% was the leak and how much cache is unknown until the next report shows the anon/file split.
## 2026-11-22 — "City size badh kyu nahi raha??" (failedbr #2494 / #2495, Q-3300 … Q-3306; Q-3307 open)
- Q-3300: the kit refresh was blocked whole by a read-back missing 5 kit files; `planKitRefreshAgainstSandbox` plans on the sandbox's own contents (re-plans until every file it writes was read; kit files missing from the copy are looked for). This is why #2494 had no lands/joinTo and #2495 an hour later did.
- Q-3301: `gameWorldRule(openWorld.ts)` states only what the project's own map file can do (lands, joinTo, custom, spreadMeters, max regions), naming the rest as CANNOT.
- Q-3302: "shehar bada karo / city ka size badhao / city ko copy kar ke jodo" grows ONE city with joinTo tiles, done by the platform (`worldTurn.worldWishAtTurnStart`, one route call); unclear → asked, nothing changed.
- Q-3303: `WORLD.spreadMeters` (kit) honours "map 40km*40km"; set by the platform or declined with the reason.
- Q-3304: a new feature claiming to grow the map is refused at the write with the one real path. Q-3305: claimAudit catches map size / place-count claims the turn did not produce. Q-3306: 'grassland' land (open field, no trees).
- Test: tests/theCityReallyGrows.test.ts (headless kit: 25-tile city, 40 km spread, grassland). Kit history regenerated (4 new versions).

## 2026-11-22 — failedbr #2494/#2495/#2496 autopsy (one open-world 3D game): a lying game gate, a black sky, the playtest frame rate (claude/game-gate-honest)

Ledger (problem → root cause → class → siblings → lock):
- **Q-3280** #2494 "GAME_PLAYTEST_NOT_RUN — never played" then "the game was played and is not playable (missing layer)" → RELEASE_GATE RED. Root: `gameIncompleteReason` phrased every hard defect as a play result and never knew whether the game was played. Class: a reader of the playtest result that states "played" without the playtest's answer. Siblings: the only other "was played" strings are the release gate's `game === 'passed'` branch and the (suspended) repair prompt; census added. Lock: tests/aGameNeverPlayedIsNeverCalledPlayedAndBroken.test.ts (real report lines, reverted → 4 fail).
- **Q-3281** the "missing layer" was false (PROD_BUILD_OK). Root: the playtest's file map was the partial saved copy (EDIT_BASE_PARTIAL). Fix: `withKitLayersFromDisk` asks the sandbox. Same test (2 fail on revert). Discovered upstream cause recorded as **Q-3284** (OPEN).
- **Q-3283** #2495 "aapne asmaan kala kar diya hai". Root in the kit: the Athree sky ShaderMaterial wrote its linear palette raw (night rgb(4,6,16) measured headless → 34,43,71 after `#include <colorspace_fragment>`). Class 1: kit shaders without the output colour-space step — census test, four siblings BLOCKED on a visual review (**Q-3282**). Class 2: a visual complaint answered "already correct / ✅ fixed" without a look — claim audit `visual-fix-unseen` (real lines, reverted → 3 fail).
- **Q-2698** recurred in #2494/#2495/#2496 (1–4 fps). Measured: the open-world starter is geometry-bound in SwiftShader (scene hidden → 60 fps; 192×108 buffer still ~8 fps; ~220 draws / ~109k triangles), so render scale, shadows and post are not levers. Needs a software geometry tier for the open world or a GPU sandbox (rule 6) — recorded in the row.
## 2026-11-22 — failedbr #2496: platform temp files are never the user's project (Q-3257, Q-3258)
- Why the proof script survived: `proveAssetInSandbox` wrote `.nbai-asset-<sha>.mjs` at the project root through the dispatcher's recorded write door, so it was recorded for the durable save; the `rm -f` in `finally` only cleaned the sandbox. The saved copy was restored into later sandboxes, listed in the build manifest and graded by readiness ("hardcoded localhost URL", "hardcoded server port").
- Class fix: `PLATFORM_SCRATCH_DIR = node_modules/.cache/nbai-scratch` + `isPlatformScratchPath` (generatedDirs.ts), enforced at toDurableFileKey (heals old stores), every listing, recordedWrites, the E2B replay cache, readEvalSnapshot and .gitignore. The proof stages model, script and log there with a nonce; all three are removed.
- Starter tests: `generatedAssetFiles.ts` recognises unedited model-library files byte-exactly by re-running their generator; `isPlatformSeededFile` uses it; `planAutoTests` skips platform-owned files (route passes `platformOwned: isPlatformSeededFile`); narration says the suite's result is reported separately.
- Test: tests/platformTempFilesAreNotTheProject.test.ts, each fix proven by reversion.
## 2026-11-22 — a request the platform already completed runs no builder (failedbr #2496, Q-3270–Q-3273, PR #4442)
- Report: "Use as my character" (Q7 Villager Man). The platform set PLAYER.model at 20.5 s, then the builder loop ran anyway: 16 model calls (~1 M tokens), an unasked edit put back by the growth guard, a model review, a starter test, the explorer and the playtest. Total 6.9 min, under an ETA of 7.5–23.5 min.
- Class: a turn whose whole request a deterministic platform action satisfied still ran the builder, and its ETA was priced as a build. Covered for every action in `libraryActionsAtTurnStart`: character, car and map place.
- Fix: `platformDoneTurn.ts`. A request that is exactly the library's own instruction, whose action recorded its success receipt, ends with a zero-token stand-in result. The preview is started, and the typecheck gate plus the real-browser render proof are kept. The reviewer, finishing writers, explorer and playtest stand down, each said in the report. The ETA is a short honest band, and the turn never teaches the build ETA. Kill switch: `AGENTV3_PLATFORM_DONE_TURN=off`.
- Test: `tests/aRequestThePlatformFinishedRunsNoBuilder.test.ts` (15). The census fails if a new `*AtTurnStart` action has no success receipt. Proven by reversion: 7 mutations, each one fails.
- Open (honest): a request with words added still runs the builder; the growth guard (not prevention) catches an unasked edit there. The finishing proofs (preview verify, mobile, prod build, tests) still take their time on a picker turn.


## 2026-11-22 — a status notice is not an error, and a dead build gets an end (failedbr #2497 → #2498, Q-3320–Q-3328, PR #4452)
- Report: #2497 (a big-map game) recorded nothing after 46 s; the user's next message was refused with "Your earlier build for this app is still running…", which arrived in the open preflight stream, was shown as an error with "Fix with AI", and the press ran #2498 on that sentence for 15+ minutes (5 min of reads with no kit API, a max_tokens cut, two blank-browser clicks).
- Fixes: `platformAdmissionNotices.ts` (every admission refusal; client stands down, in-stream refusals carry `beforeBuildStarted`); `platformNoticeAsBuildRequest` + route 400 before any work; orphaned reports settled when the next build holds the lease (`orphanedBuildReport.ts`); a silent lease holder (2 missed beats) is waited out instead of reported as running; the kit API snapshot on game-project turns whose words name no other app; a third "WRITE NOW" exploration hand-back; browser_action reopens the last preview page when the shared browser is blank.
- Tests: aPlatformNoticeIsNotAnError, aDeadBuildGetsAnHonestEnd, aBlankBrowserReopensThePreview — 8 reversions, each fails.
- Open: Q-3323 (why the instance died — Cloud Run logs), Q-3326 (reasoning budget vs output cap — admin's money decision), Q-3328 (benched Surplus model chosen again — not worked).
## 2026-11-22 — a misspelled game title is still the game; a big map is the 3D big map (failedbr #2497, Q-3310–Q-3316, PR #4453)
- Report: "ek bahut bada map par bubg jaisa game banao!!" ("bubg" = PUBG). The contract said genre unknown and view unspecified, and the kit laid generate_game_runtime, generate_game_vfx, generate_melody and generate_world_2d, which is a 2D top-down game. Admin: "ye pubg ki jagah kya bana diya".
- Class 1: title recognition was exact-spelling only, in seven private lists. Fix: one tolerant matcher and one catalogue in `lib/wellKnownGameTitles.ts` (`findGameTitles`, `mentionsBattleRoyale`, `namesGtaTitle`, `gameTitleRegexIn`). gameIntent, gameKitSeed, athreeMapIntent, appScopeAnalyzer, realismIntent, unknownName, RequirementGapAnalyzer and heroObjectSpec all read it. Short titles match curated spellings only, so "bug", "pub", "bus", "big", "PBG tender" and "bgm" never match. Edit distance applies only to long fuzzy titles.
- Class 2: a big map with no stated view went 2D, while the map profile read the same request as 3D. Fix: `gameIntent.bigWorldWantsThreeD` is the one explicit rule, read by the contract, the kit and the 2D world. The 2D world stays the default when the request names 2D, top-down or a flat genre.
- Class 3: an unknown name was built on a guess. Fix: the contract's `unrecognisedReference`, and a builder line that says ask, do not guess.
- Sibling: an FPS title (Valorant, CoD) is now 3D in the kit as well as in the contract. Runner titles are blocked on an admin decision (Q-3314).
- Test: `tests/aMisspelledGameTitleIsStillTheGame.test.ts` (98). It uses the real prompt as a fixture, a negative corpus (every non-game prompt in tests/fixtures), and a census that fails when a private title regex appears. Proven by reversion: PUBG reduced to its exact spelling (11 failed), the big-world rule removed (4 failed), unrecognisedReference removed (1 failed), PUBG made fuzzy at 3 letters (3 negatives failed), the ordinary-word list emptied (2 failed). Existing tests changed: freeFireShorthandIsARoyale now uses `mentionsBattleRoyale` (BATTLE_ROYALE_REFERENCE is gone); GTA 6 is deliberately left out of the catalogue to keep the BR1966 boundary test.
- Open: Q-3314 (runner titles, admin decision), Q-3315 (clarity judge timed out), Q-3316 (provider 404).

## 2026-11-24 — Locked plan item 1: a comment is not a game feature; a real feature named the way code is written counts

Admin locked the weakness-audit plan (adapted under the external-suggestion rule) and asked to start with item 1. Weakness audit P0-4, verified against the code at `d7763ac`.

- New `src/server/lib/codeOnly.ts` (`withoutComments`): one pass, blanks comments, keeps strings and templates (UI text such as "Play again" proves a feature), keeps length and lines.
- Applied to every reader that decides a game fact from source: `gameIntent.scopeMatch`, and in `gamePlaytest.ts` `isCanvasGameProject`, `replayFromCode` (progress, restart, sound), `isDrivingGame`, `domGameKind`; and `touchPlayableGame.isKeyboardOnlyGame`.
- Found while testing, same function: `PRESENT` missed plurals and camelCase (`levels`, `currentLevel`, `spawnEnemy`, `addScore` were "missing"). Plurals are now accepted, and the code is also read with camelCase split.
- Test: `tests/aCommentIsNotAGameFeature.test.ts`.
- Still open by design (locked plan item 3): presence is still proven by source, not by playing; runtime rule assertions replace it.

## 2026-11-24 — Locked plan item 2: the game playtest's time is reserved, not left over

Weakness audit P0-2, verified at `ba2e646` (#4512 merged). The playtest needed 90 s of headroom and every pass before it could spend that time first, so late builds — the ones with problems — were the ones never played. About 30 sites in the route each computed headroom in their own words.

- New `src/server/AgentV3/buildPhases/buildHeadroom.ts`: `hasHeadroom`, `headroomMs`, `playtestReserveMs` (`PLAYTEST_RESERVE_MS` 95 s = playtest 60 s + load 15 s + timeout margin 20 s). Kill switch `AGENTV3_GAME_PLAYTEST_RESERVE=off`.
- The route asks one question everywhere (`roomFor(ms)`, `roomLeftMs()`); on a game turn whose build is OK, the playtest's 95 s are held until `runGamePlaytest` starts, and the three generation runners get `generationBudgetMs(…, heldMs)` that much less. A failed build or a non-game turn holds nothing (byte-identical arithmetic).
- Test: `tests/aGameIsPlayedEvenWhenTheBuildRunsLate.test.ts` (report shape, neighbours, census of hand-written headroom).
- Queue: Q-3329 opened for the CI flake seen on #4512 (Python backend boot test).
- Live effect to watch: GAME_PLAYTEST_NOT_RUN "the build had no time left to play it in" should become rare on game builds.

## 2026-11-24 — Locked plan item 3: a tapped game fix is measured, not claimed

Weakness audit P0-1, safe form (automatic game repair stays OFF). Before: only a turn that made the game WORSE was compared and said (`GAME_GOT_WORSE`); a better or unchanged game ended with no verdict.

- `gameRegression.gameFixOutcome` (pure): `GAME_FIX_VERIFIED` (score +5 or an unplayable defect cleared — "Played before: 41/100. Played after: 78/100 — playable now") or `GAME_FIX_NO_CHANGE`; worse stays with GAME_GOT_WORSE.
- `buildPhases/gameFixVerdict.ts`: says a better game on any turn; an unchanged one, or one that could not be played again (`GAME_FIX_UNVERIFIED`), only on the user's own "Make the game playable" turn (`isGameFixTurn`). The route makes two one-line calls.
- An edit of an existing canvas game now holds the playtest's reserved time too (item 2's hold), so the fix turn is played.
- Findings classified: GAME_FIX_NO_CHANGE → offered through GAME_PLAYTEST_ISSUES; GAME_FIX_UNVERIFIED → no button (reason recorded). AppKnowledgeBase `game_fix_and_undo` updated.
- Test: `tests/aGameFixIsMeasuredAfterTheUserTaps.test.ts`.

## 2026-11-24 — Locked plan item 4: the free repair allowance is said to the user

Weakness audit P1-5. The Weak tier's platform-wide daily allowance for automatic button fixes (`explorerRepairBudget.ts`, default 100) stopped repairs with only an admin line and a server `console.warn`. Now `explorerRepairTierGate` carries a `userNote` ("Today's free automatic button fixes are used up … Tap "Fix the button that breaks your app" … comes back tomorrow"), said through `sayRepairGateNote` beside the admin line. The cap (a money rule) is unchanged. Test: `tests/theFreeRepairAllowanceIsSaid.test.ts`.

## 2026-11-24 — Locked plan item 5: one redactor union (Pro Chain V2's private copy)

Weakness audit P1-6, adapted: `SourceSecretRedactor` already wraps the shared `SecretRedactor` by design and is unchanged. The real duplicate was `proChainV2/redact.ts`, a private short pattern list: a JWT, an AWS/GitHub/Google key or a password inside a URL was masked by the shared redactor and NOT there, while our gateway keys (`mtf_live_`, `qbx_`, `qubax_`) were masked ONLY there. Now Pro Chain V2 runs the shared redactor first and keeps only its stricter admin-line shapes on top; the gateway keys (20+ chars) are in the shared list; the error line keeps 1200 chars (was 600), marked with "…" when cut. Test: `tests/oneRedactorUnionHolds.test.ts` (one row per shape, both redactors). The plain-redactor caller census lists `proChainV2/redact.ts` with its reason.

## 2026-11-24 — G1+G2: the rules the user names are kept, built with the combat kit, and proved by playing (game factory, admin question 2)

Admin: *"user kahta hai enemy add karo, jisko kill karne se score bade, par navbharatai yeh nahi kar pata hai … hame game factory banna hai"*.
- **Root cause:** the scope contract (`gameIntent.ts`) read a request as features (`enemies`, `score`) and dropped the RELATION between them, so nothing told the builder to wire one to the other and nothing checked it. The combat layer (Health emits ENEMY_DIED) was not seeded for 2D games at all.
- **Fix:** `gameRules.ts` reads cause → effect rules (EN/Hinglish/Hindi, one sentence per rule, precision first) into the contract; `gameKitSeed` seeds `generate_game_systems` when the game needs combat; the runtime exposes `window.__nbRules`; the playtest emits each rule's event in the real browser and checks the effect (`GAME_RULE_BROKEN` warning / `GAME_RULES_CHECKED` info via `buildPhases/gameRuleProbes.ts`, one call from the route).
- **Locks:** `aGameKeepsTheRulesTheUserNamed`, `aRuleIsProvenByPlaying`, `theUsersRulesAreReportedFromPlay`. Kit history regenerated.

## 2026-11-24 — G5: the kit keeps the user's rules by itself, as data (game factory)

- **Root cause (50/50 second half of G1+G2):** a rule the user named still lived only as a sentence the builder had to remember to wire; a weak builder could skip it or wire it twice.
- **Fix:** the request's rules become DATA in `src/game/gameRules.ts` (`gameKitRecipeInput('generate_game_runtime')` → `generateGameRuntime(include, { rules })`, cleaned by `cleanGameRules`). The new kit module `src/game/core/rules.ts` validates and applies them from the first round (`state.ts` imports it lazily on `playing`); a life lost with lives left does not end the round. The builder is told never to add a second listener. `generate_game_runtime` takes `rules` (`ToolCatalog`).
- **Lock:** `theGameKeepsItsRulesByItself` (runs the real kit files; proven by reversion — disabling the auto-start fails it).

## 2026-11-24 — G3+G4: a library character can hold an item and punch, with moves made from its skeleton (admin question 1)

Admin: *"character ke hath me gun do, to navbharatai bolta hai, character ke pas yeh move nahi hai, character ke pas punch move nahi hai"*.
- **Root cause:** a library or uploaded model was a baked file; the kit only played its own clips and put nothing in its hand, so a missing clip became "the character cannot".
- **Fix:** `playerBody.ts` finds the rig's bones by name (mixamo, Blender, Unity styles; exact names, never a guess), parents a held item to the hand bone (`holdItem`, `PlayerChoice.holds`), and makes punch, fire, swing, throw, kick and use from the skeleton by aiming bones in WORLD space (rig-agnostic), said once on screen. `playerMoves.lackedMovesClause` tells the builder which moves are made and which stay unanimated.
- **Locks:** `aLibraryCharacterCanHoldAndPunch` (real kit file, real three.js); `theUsersCharacterJoinsEveryGame` updated. Kit history regenerated.

## 2026-11-24 — G6: the chosen character does any action the user names; compose_action makes what the kit lacks

Admin: *"user jo bole, woh agar kit me nahi hai, navbharatai ai ko api call kar ke woh bhi bana sake … sadak par padi banduk uthao, ya gate khol kr ghar me ghusna, ya hero khana khaye … usi character jo abhi user ne select kiya woh karne lage"*.
- **Root cause:** an action outside a character's clips was refused ("the character has no such move"); an action had no form except an animation clip.
- **Fix:** an action is DATA (key poses for named limbs in the character's own frame, plus steps: pickUp, drop, open, consume, emit). New kit file `src/game/play/actions.ts` (`GameActionsGenerator.ts`) plays it on whatever body is shown — the kit person's joints or a model's bones by name — and the shell calls `updateActions` every step. The kit ships pick-up, drop, eat, drink, open-door, wave, point, raise-hands, bow. Anything else: the `compose_action` recipe (`gameAssets/composeAction.ts`) — library first, else ONE model call designs it, validated by `validateAction`, written to `src/game/actions/<name>.ts`, which the kit reads by itself. `playerMovesLine` and the shell handoff tell the builder never to say the character lacks a move. `playerBody.playerModelRoot` exposes the shown model.
- **Locks:** `theCharacterDoesWhatTheUserAsks` (gun pick-up, eat, gate, a user's own action, validation, compose_action; reverted-and-failed) and `theChosenCharacterDoesTheAction` (a library model picks the gun up with its own hand bone). AppKnowledgeBase entry `game_character_any_action`. Kit history regenerated.

## 2026-11-24 — S7: the game playtest moved out of the build route (locked plan; Q-3237 option A)

- `runGamePlaytest`'s ~140-line body (play, judge, defects, geometry, too-heavy, made-worse/undo, fix verdict, rule probes, scope, not-run and DOM-game lines) moved to `src/server/AgentV3/buildPhases/gamePlaytestPhase.ts`, unchanged in behaviour. The route builds ONE `facts` object; the phase plays only when every fact allows it and otherwise says why from the SAME facts, so the gate and the reason cannot disagree by construction. It returns the proof, the gate value and the measured defects; the route keeps them.
- Eight route imports only the moved body used were removed. The phase census now accepts a phase imported by another phase the route imports (`gameRuleProbes`, via the playtest phase).
- Locks: `theBuildRouteIsSplitByPhase` S7 block (four behaviour tests through the ports, plus a census that the body is not back inline); eleven route-pin tests re-pinned to the phase file. Full local suite: 57,697 passed; the two remaining local failures are this sandbox's symlinked node_modules (`nodeModulesIsNotAFile`, a ragdoll test's `cannon-es`).

## 2026-11-24 — Q-2768: a file the saved work imports that nobody wrote is named in the hand-off

- **Root cause:** the fast-lane salvage hand-off listed what exists (the saved files) and the missing entry, never what the saved files NEED that does not exist. BR2002's `ServicesSection.css` was planned, imported and never written; the hand-off typecheck cannot see a stylesheet, so the app stayed blank ~40 s.
- **Fix (class + sibling):** `src/server/AgentV3/salvageMissingImports.ts` — `loadedRelativeSpecifiers` (named, re-export, bare side-effect, dynamic; comments ignored), `missingImportsOfSaved` (turn files, turn-start project, then bounded sandbox reads, so an existing starter file is never named), `savedWorkMissingLine` (one call, bounded at 10 s). Wired at both hand-off doors: the fast-lane salvage block and the one-shot's `steeringSalvage`.
- **Lock:** `tests/aHandOffNamesWhatTheSavedWorkImports.test.ts` (reverted-and-failed). `initialLaneDeclineRoute` env given the new helper.

## 2026-11-24 — Q-2765: one shared name has one owner, and the other planned files are told

- **Root cause:** the fast lane's owner choice (`helperOwners`, `valueOwnerFor`) changed only the owner's purpose. A second planned file whose purpose also claimed the same shared name (BR2001: `src/utils/apps.tsx` and `src/utils/system.ts`, two app registries) kept claiming it, and each isolated per-file call reads its own purpose first.
- **Fix:** `SimpleBuilder.disownSharedNames` runs after both owner choices: every other planned code file whose purpose names an owned symbol is told, in its own purpose, to import it from the owner and never define it. Whole names only, idempotent.
- **Lock:** `tests/oneSharedNameHasOneOwner.test.ts` (reverted-and-failed). **Open:** whether BR2001's two registries used the same contract name was not re-read from the report (the build-report connector needs a fresh sign-in).

## 2026-11-24 — Q-3329: the Python boot test now names its own failure (still OPEN)

- The CI-only failure (`not-up` on the second boot) came after the boot's 30 s wait loop, so the first server was not answering at all for 30 s: it died, or never owned the port. The test now uses a port the OS reports free, checks from outside that the first server is listening before the second boot, and prints both outputs, the reason and the backend log on failure. Root cause not yet proven; the row stays OPEN until the next occurrence names it.

## 2026-11-24 — G7: any rule the user imagines is run by the kit as data (compose_rule)

Admin: *"navbharatai api call se user ki sabhi ulti sidhi imagination ko real banaye"* (and questions 7–8: bleeding, "5 shoot me marna chahiye").
- **Root cause:** a combat rule ("5 shots kill", "enemies bleed") lived only as words the builder had to remember; the kit's Health had no notion of either.
- **Fix:** the kit's `Health` (src/game/systems/combat.ts) reads COMBAT data by itself — `enemyHitsToKill`, `playerHitsToKill`, `bleed { seconds, perSecond }` (blood each half second, can bleed to death) — from src/game/gameRules.ts and every file under src/game/rules/; `core/rules.ts` reads rules/ too. The request's combat words become that data (`gameRules.gameCombatFrom`, EN/Hinglish/Hindi), seeded through `generate_game_runtime({ combat })` and said in the contract. Any other rule: the `compose_rule` recipe (`gameAssets/composeRule.ts`) — ONE model call turns the sentence into the checked vocabulary and writes src/game/rules/<name>.ts; outside the vocabulary it is refused honestly ("write it as code").
- **Locks:** `anyRuleTheUserImaginesIsRun` (real kit files; reverted-and-failed). AppKnowledgeBase `game_any_rule`. Kit history regenerated.

## 2026-11-24 — G8: a crash dents the car (admin question 9)

- **Root cause:** the kit heard every crash (`onVehicleCrash`: point, vehicle, speed lost) and only made it felt; nothing ever changed the car.
- **Fix:** new kit file `src/game/three/dents.ts` (`GameDentsGenerator.ts`, Game3D module `dents`): `enableVehicleDents()` dents every crashing vehicle where it hit — vertices within a radius pushed toward the car's centre, deeper for a harder crash and capped, wheels untouched, paint scuffed, `userData.damage` 0..1 and `VEHICLE_DAMAGED`; a shared geometry is copied once so one car's dent never shows on another; `repairVehicle` restores it. The request's words ("dent", "realistic accident", Hinglish) make `crashDamage` a required feature with the call to make, checked from code by scopeMatch.
- **Lock:** `aCrashDentsTheCar` (real three.js; reverted-and-failed). AppKnowledgeBase `game_crash_dents`.

## 2026-11-24 — G9: every character can hold things, not only the player (admin question 1)

- **Root cause:** `holdItem(ctx, …)` reached only the player's character; an NPC or enemy that was a library model had no way to hold anything.
- **Fix:** `holdInHand(character, item, side)` in the kit's `playerBody.ts`: a library or uploaded model by its hand bone (same bone-name matching as the player), a kit person (`createHumanoid`) by its own grip (right through `hold`, left by its joint); sized to a third of the character's height; no hand bone → at its side, and false says so. The shell handoff tells the builder.
- **Lock:** `everyCharacterCanHoldThings` (real kit files; reverted-and-failed). Kit history regenerated.

## 2026-11-24 — G10: any visual effect the user imagines is drawn by the kit (compose_effect)

- **Root cause:** the kit's particles played only nine fixed presets; an imagined effect ("aag ka bawandar") had no form.
- **Fix:** an effect is a checked ParticleSpec with a name. `particles.ts` reads `src/game/effects/<name>.ts` by itself (through the new `fx/effectFiles.ts`, so particles.ts has no import.meta), `registerEffect` adds one from code, `burst(name, …)` plays it, an unknown name plays impact and says so. `compose_effect` (`gameAssets/composeEffect.ts`): a kit effect asks no model; otherwise ONE model call designs the spec, clamped to what a phone can draw, written to src/game/effects/<name>.ts.
- **Lock:** `anyEffectTheUserImaginesIsDrawn` (real kit file; census of the kit's preset list; reverted-and-failed). AppKnowledgeBase `game_any_effect`.

## 2026-11-24 — Q-2767: "the run is proven" follows the change record's stop rule (admin decision: yes)

- **Root cause:** `runProof()` passed `stopped: abort.signal.aborted`, so an abort that only cut the settling AFTER a successful result (advisory cap, reaper, lock reclaim, deploy drain) made the run unproven — the same class BR2002 F1 fixed in the change record.
- **Fix:** `stopped: changeWasStopped({ aborted, cause, userStopRecorded, resultOk })` — one rule for both readers. Billing reads the proof ("the markup needs a preview that ran"); the admin approved the change on 2026-11-24 ("aapke suggestion ke anusar").
- **Lock:** `tests/runProvenApp.test.ts` Q-2767 block (reverted-and-failed) + the route pin.

## 2026-11-24 — Q-2770: a sectioned spec with product parts is a project, whatever small word its name holds (admin decision: yes)

- **Root cause (two, changed together):** `requestSubject` stopped at a `Project Name:` header's own colon (the app "was" "Project Name"); and the small word in the name ("Quiz") vetoed every mega signal, so BR2003's seven-section spec with 100,000 questions, an admin dashboard, login and a Node/PostgreSQL/Firebase backend was "kept as one build".
- **Fix:** `requestSubject` reads a name header's value; `analyzeAppScope` adds `sectionedProduct` (≥6 numbered sections and ≥2 `PRODUCT_PARTS`) as a strong signal with its own reason line. A sectioned small app with none of those parts is unchanged.
- **Lock:** `tests/br2003Autopsy.test.ts` Q-2770 block. Scope suite: 49 files / 764 tests green.

## 2026-11-24 — The repository is proprietary: "All rights reserved", not MIT (admin decision)

- The external fix plan proposed an MIT licence ("owner approved"). Under the external-suggestion rule that was not transcribed: MIT would let any competitor copy the whole engine (ladders, autopsy lessons, the India-first moat), which works against the AIM. Recommended instead: "All rights reserved". The admin approved the recommendation on 2026-11-24 ("aapke suggestion ke anusar banao").
- Added `LICENSE` (proprietary, no licence granted; third-party components keep their own) and `"license": "UNLICENSED"` in package.json (npm's marker for proprietary code). `license:gate` scans dependencies only, so it is unaffected.
- Not done here (only the admin can): making the GitHub repository private, if it is public.

## 2026-11-24 — S4: a good game is measured, not claimed (GOOD_SCORE 88; playtest 90 s; reserve 125 s — admin decision)

- **Root cause:** "playable" (75) was the only bar, and the playtest never measured how a game feels, whether it progresses, or how it looks — so nothing could honestly say "good".
- **Fix:** three new measured dimensions in the real-browser playtest: **feel** (ms from pressing RIGHT to the first idle-still scene object moving; three.js scenes), **progression** (a round of up to 45 s played, reading the kit's own score/level, stopping as soon as it moves), **visual** (distinct colours and edge fraction of the idle picture at 96×54). Weights: the old seven × 0.8 (80) + feel 8, progression 6, visual 6; an unmeasured new dimension (`notMeasured`) costs nothing, so an old run scores exactly as before and its message is unchanged. `GOOD_SCORE = 88` with `isGoodGame` (≥88, no measured zero, progression measured, no named rule not-held); the report's head says "A good game — …" only then. The new three never make a game unplayable. `PLAYTEST_BUDGET_MS` 60→90 s, `PROGRESS_PLAY_MS` 45 s, `PLAYTEST_RESERVE_MS` 95→125 s, the route's room check `PLAYTEST_BUDGET_MS + 30_000`.
- **Deviation from the spec, on purpose:** the spec's runs 15 / alive 5 were changed to 16 / 4 so the old seven stay exactly in proportion (the "old games keep their score" promise).
- **Locks:** `aGoodGameIsMeasuredNotClaimed` (scoring, the good condition, the budgets, and a REAL Chromium run where progression and looks are measured; reverted-and-failed). Re-pinned: `aPlaytestThatRanOutOfTimeKeepsWhatItMeasured`, `aRuleIsProvenByPlaying`, `aRequestThePlatformFinishedRunsNoBuilder`.

## 2026-11-24 — S6: every AGENTV3 flag is in the registry (census, ratchet) — admin decision

- **Measured:** 489 `AGENTV3_*` names are read in server code (`src/server/**`, `server.ts`); 278 of them appear nowhere in `docs/claude/ENV_REGISTRY.md`, so their default and meaning could be found only by reading code.
- **Class:** a flag could be ADDED without being documented. **Lock:** `tests/everyFlagIsRegistered.test.ts` fails on any new undocumented `AGENTV3_*` name, and on a baseline entry that has since been documented or removed — `tests/fixtures/unregisteredFlagsBaseline.json` (278 today) may only shrink (reverted-and-failed).
- **Open (not a defect of this change):** the 278 are still undocumented; each is documented when its file is next touched, and the baseline shrinks with it.

## 2026-11-24 — S9: the suspended game auto-repair wiring is KEPT, not deleted (decision, with evidence)

- **Measured:** `gameAutoRepairEnabled()` returns false with no value that enables it (suspended until byte-preserving backup and verified rollback exist — `docs/security/game-auto-repair-suspension.md`), so the ~45-line repair block in the build route is unreachable.
- **Tried:** deleting it. Nine tests guard that wiring for the day it is re-enabled (`br1955Prevention` F4, `aBrokenGameIsRepairedOrNotCalledDone`, the barren-billing, AgentRunner-chain, revert and green-freeze censuses); deleting it destroys tested, ready work for a ~45-line saving.
- **Decision:** keep it as it is. When repair is re-enabled, it moves to a `buildPhases/` helper (Q-3237) in that same PR — never re-enabled inline.

## 2026-11-24 — PROGRESS.md archived by month (admin decision, my recommendation)

- PROGRESS.md had grown to 8.3 MB. Every dated entry before 2026-11 was moved VERBATIM, in its original order, to `docs/progress/PROGRESS-2026-06.md` … `PROGRESS-2026-10.md`; this file keeps 2026-11 and every undated entry, with a pointer at the top. Verified line by line before the commit: 0 of the original non-blank lines missing.
- The append-only rule stands: new entries and corrections go HERE; the archives are never edited. History stays in git. No test reads PROGRESS.md's content (checked).
## 2026-11-25 — A bullet goes where the crosshair is: ctx.aim() (master audit, Part A)

- **Root cause (confirmed in code):** the kit's `ProjectileSystem` is correct (swept, fixed-step, frame-rate independent), but it is handed a direction and the kit never said where that comes from. Its own instruction read `gun.update(…, muzzleWorldPos, aimDir, …)` — two placeholders every game filled by hand; a constant fires "always north", the hero's rotation fires the way it last walked, and a build was seen guessing a `ctx.crosshairTarget` that does not exist (GameShellGenerator's own comment). Only the royale generator aimed from the camera.
- **Fix (class):** one source of aim — new kit file `src/game/play/aim.ts` (`GameAimGenerator.ts`): `aimFrom` casts a ray from the camera through the crosshair, takes the first visible solid thing (never the player, its vehicle, particles, or `userData.noAim`), finds the muzzle at the far end of what the hand holds (the chosen model's hand bone or the kit person's), and fires `shot = normalize(point − muzzle)`, spawned just past the muzzle; top-down games fire the way the player faces. `ctx.aim()` on every shell game; the systems instruction and the shell handoff now say `const a = ctx.aim(); gun.update(dt, fire, a.muzzle, a.shot, bullets)`; enemy guns use `shotFrom`.
- **Lock:** `tests/aBulletGoesWhereTheCrosshairIs.test.ts` — 8 compass directions, up, down, third-person, a moving turned player, each FIRED through the real ProjectileSystem and counted as a hit; plus the reversion case (a constant north shot misses the target the crosshair is on).

## 2026-11-25 — Every character is spawned, verified, ticked and kept apart: Entities (master audit, Parts B, C, D)

- **Reported:** enemies sometimes never appear; a spawned enemy stands still; the player walks through characters; a punch passes through a body.
- **Root cause (confirmed in code):** every piece existed — `systems/ai.ts` (state machine), `systems/combat.ts` (Health), `three/humanoid.ts`, `play/character.ts` (walking capsule) — and nothing assembled them. Each game wired them by hand and forgot a different step (the body never added to the scene; `stepEnemyAI` never called each frame; no character-vs-character push at all — the capsule only collides with marked world meshes). The royale practice kept a private copy of the wiring.
- **Fix (class):** one assembler, `src/game/systems/entities.ts` (`GameEntitiesGenerator.ts`, in the systems recipe). `spawn()` builds capsule + body + Health and VERIFIES the result (in the scene graph, finite position, a visible mesh); a failure is rolled back, said with `ENTITY_SPAWN_FAILED` and counted in `report`, never reported as spawned. It ticks itself through the new **`ctx.onStep`** shell hook (run after `update()`, frozen with the game, cleared on dispose; a throwing hook is stopped and logged). Characters are pushed apart from each other and from the player every step. `targets()`/`applyHits()` connect bullets; `melee()` is a forward-cone strike (nearest first). Death plays the fall, emits `ENTITY_DIED` (plus Health's own `ENEMY_DIED` for a hostile one) and removes + disposes the body after `corpseSeconds` (`ENTITY_REMOVED`). `goTo()` walks to a point and emits `ENTITY_ARRIVED` only when it is there — the base for the police dispatch (Part I, next PR).
- **Found while testing:** a character sent somewhere walked back to where it spawned (its patrol home never moved) — fixed: the arrival point becomes its home.
- **Lock:** `tests/everyCharacterIsSpawnedVerifiedAndKeptApart.test.ts` (15) runs the REAL kit files (capsule, AI, Health, humanoid). Reversion proved: removing the push-apart fails the player-collision test; removing the visible-mesh check fails the rollback test; without onStep the enemy stands still (the reported bug, encoded).
- **Wired:** systems recipe (+ its imports), `GAME_SYSTEM_MODULES`, catalog subset list, systems instructions, the build prompt's game section, AppKnowledgeBase.

## 2026-11-25 — A crime brings real police, not a sentence: Dispatch + Wanted (master audit, Part I)

- **Reported:** "when any crime happens, police should arrive" → the game said "Police aa gayi" and showed nobody.
- **Root cause (confirmed):** the kit had NO crime, wanted or dispatch system — "police" existed only as a word in a feature example and as a car asset — so the builder had nothing to call and wrote the sentence. A police car model is not a dispatch.
- **Fix (class — any service):** `src/game/systems/dispatch.ts` (`GameDispatchGenerator.ts`, systems recipe, on Entities). `Dispatch.call(service, target)` for police / ambulance / fire / security / military: a spawn point min–max metres away, inside `bounds`, allowed by `isValidSpawn`, out of the camera's view when such a point exists; a REAL car (`createCar`) driven by the kit's own `driveVehicle` (wheels on the ground; hidden from the shell's vehicle watch so it never becomes "the player's car"), flashing siren lights; a car that stops getting closer unloads its crew to walk; crew spawned by `Entities.spawn` (verified). `DISPATCHED` / "dispatched" only after the car or crew exists; `DISPATCH_ARRIVED` / "arrived" only when an officer is really at the target; no spawn point or no crew ⇒ `DISPATCH_FAILED` and an honest "could not come" line. `Wanted`: crimes the PLAYER did (new `byPlayer` on `ENTITY_HURT`/`ENTITY_DIED`, read from the bullet's ownerId / the melee attacker) raise 0–5 stars; each star brings officers who pursue; an officer holding the player in reach for 2 s arrests (`PLAYER_ARRESTED`, level 0, police stand down and are cleared); from 3 stars they fight; unseen for 15 s a star cools.
- **Found while testing:** one killing blow counted as assault AND murder (3 stars) — fixed: `ENTITY_HURT` carries `died`, and a fatal blow is only the murder.
- **Lock:** `tests/aCrimeBringsRealPolice.test.ts` (11) on the real kit: villager killed → 2 stars → real cars with sirens ≥ 34 m away → they drive in, crews get out, officers within 3 m when "arrived" is said, and that line comes AFTER the arrival event; arrest → level 0 → everything cleared; 3 stars → officers hostile, player hurt; an enemy's kill is not the player's crime; no spawn point / unknown service fail honestly; bounds and out-of-view respected; ambulance and on-foot guards arrive. Reversion: saying "arrived" at dispatch (the reported bug) fails the test. Strict compile with real `@types/three`: 0 diagnostics.

## 2026-11-25 — The muzzle flash goes out (master audit, Part G — "it stays yellow after firing")

- **Root cause (confirmed in three 0.180's own `points.glsl.js`: `uniform float size; … gl_PointSize = size;`):** `PointsMaterial` draws every point at ONE size and never reads a per-point size attribute. `fx/particles.ts` "hid" a dead particle by setting its `size` attribute to 0 — which the shader never read — so every particle ever fired stayed DRAWN where it died, in its last colour: the muzzle flash's `colorEnd 0xff8a00` on the additive layer = a permanent yellow-orange glow at the muzzle (and dead smoke, blood, sparks the same, everywhere). Not a lifetime bug: the 0.1 s life ran correctly. Sibling hunt: the only `PointsMaterial` + size attribute in the kit.
- **Fix:** the material reads each point's size (`onBeforeCompile` → `gl_PointSize = size * particleSize`, attribute renamed so it cannot collide with the uniform, material size 1) AND a dead particle is moved out of the world (`DEAD_Y`), which hides it even if a future three changes the shader line (the patch then says so). No lights are used by the flash, so none can be left behind.
- **Lock:** `tests/theMuzzleFlashGoesOut.test.ts` (7) on the real `particles.ts` and three's real points shader source: the patch applies to three 0.180; the material is patched; a dead particle is out of the world; 200 shots + smoke leave nothing drawn; the flash shrinks while it lives; no lights. Reversion: removing the patch and the move fails 2 tests. (The two "nothing drawn" tests read the size attribute, which the old code also zeroed — the shader-patch and position tests are what see the bug.)

## 2026-11-25 — The map has an edge that holds (master audit, Part F)

- **Root cause (confirmed):** the kit had only a fall recovery (`play/character.ts`: 60 m below the last safe ground, back you go) and no horizontal boundary. A player walked off the terrain and FELL first; a car (no recovery at all) drove into empty space; an NPC wandered off.
- **Fix:** `src/game/play/boundary.ts` (`GameBoundaryGenerator.ts`, owned by the shell). `GameOptions.bounds` / `ctx.world.setBounds(area, { walls })`: real collider walls on the four edges — visible by default, `'invisible'` when the map's own mountains or sea are the visible edge, or none — reaching below the ground so a slope leaves no gap; bad bounds are refused and said (`WORLD_BOUNDS_INVALID`), never half-applied. Every step after `groundScene`, the shell keeps the player, the vehicle the player drives (stopped at the edge) and every `userData.bounded` object (Entities characters, dispatched cars) inside. `ctx.world.inside(x, z)` — Dispatch never sends anything from outside the map. Bounds are DECLARED, never read from the ground loaded so far (a streamed world would trap the player in its first chunks).
- **Also found:** the real BR1977 prompt "police aur bail ka system ho" now gets the required feature `police` and the systems kit in its plan — the old contract dropped the word, so that build was never checked for police (test updated with the reason).
- **Lock:** `tests/theMapHasAnEdgeThatHolds.test.ts` (12): the REAL walking capsule walks 30 s at the edge east, west, north, south and diagonally and is still on the map (and never fell); reversion — no bounds, same walk leaves the map; a car past the edge is put back; invisible walls still collide and are skipped by the aim; refused bounds leave nothing; the shell wiring. Strict compile with real `@types/three`: 0 diagnostics.

## 2026-11-25 — The minimap is in the same layout editor (master audit, Part H)

- **Root cause (confirmed):** the touch layout editor (`ui/touchControls.ts`) only knew the controls it created itself (joystick, buttons, drive pads); the minimap is a React element in the Hud placed only from `options.minimap.corner/size`, outside the editor and outside the saved layout — so it could never be moved or resized, and the overlap solver never kept controls off it.
- **Fix (class):** a HUD-element registry in the editor — `TouchControls.addHudElement(id, { label, width, height, home, apply })` (via `Game.registerHud`). The editor shows a proxy box for it that is dragged, pinched, nudged (keyboard), Bigger/Smaller'd, Reset and saved exactly like a button, in the SAME `SavedTouchLayout` (`controls.minimap`), and takes part in the overlap solver in both layouts; the real element is told where to draw and at what size. The Minimap registers itself and draws at the player's place and size (64–320 px). Backward compatible: an old saved layout has no `minimap` and keeps the game's corner. A real control id cannot be taken over. Any future HUD element (compass, health bar) uses the same call.
- **Lock:** 7 new tests in `tests/playersRearrangeTouchControls.test.ts` on the REAL editor (its fake-DOM harness): a box appears; drag saves and the map is told; Bigger resizes, Reset restores; a saved place applies on the next start, an old layout keeps the corner; no control overlaps the map; taking it out removes the box; the Hud wiring. Reversion: leaving the map out of the layout (the reported state) fails the overlap test. Strict compile of Game.ts, Hud.tsx and touchControls.ts with real types: 0 diagnostics.

## 2026-11-25 — The chat remembers the whole conversation, and writes it as it goes (admin: "response bahut slow hai" + "10-15 message ke baad starting me text bhul jaye")

Two reports, two root causes, one PR. Both were root-caused at the class, with siblings hunted across the repo.

### 1. Slow — the free chat never used the stream that already existed

- **Root cause (confirmed by reading the send path end to end):** `useChatEngine.handleSendForTab` chose between two paths. `isGeminiSovereign` is TRUE for the NBI tab whenever there are no attachments — i.e. on **every ordinary free-chat message** — and sent the turn to `runFrontendPipeline` → `callGeminiFrontend`: ONE blocking `axios.post` to `/api/chat/navbharatai` with **no `stream` field**, so the route took its non-streaming branch. Nothing reached the screen until the model had finished the entire answer. The comment above it read *"Switch to a single high-speed call for near-instant response"* — the premise was backwards: a blocking call has the worst time-to-first-word there is. The server's real token stream (`aiRouter.routeStream`, SSE) and this hook's own consumer of it (`performStreamingBackendCall` → `consumeChatResponseStream`) existed the whole time and were reachable **only as an error fallback**.
- **Second loss, same cause:** on a grounded question (prices, scores, "aaj") the route spends up to ten seconds on a live web lookup *before* the model speaks. `chat.ts` opens the stream FIRST and sends a status frame precisely so that silence is narrated — and that frame can only arrive on a request that asked for a stream. The blocking path turned a narrated ten seconds into a silent one.
- **Third loss, same cause:** the blocking path was strictly the POORER request. The server reads neither `files` nor `target` — the only two fields it sent that the streaming one does not — while the streaming path sends `currentApp` (canvas edits), `userProfile` (Apnapan personalisation) and `vials`. Free chat was silently losing all three on every turn.
- **Fix:** there is now ONE send path for chat text, and it is the streaming one. Both blocking helpers are DELETED, not left unreachable (an unused copy is what a later change re-routes to). The `addLog('Falling back to background AI processing…')` line, which was never a fallback once this is the only path, now says what is actually happening.
- **Class, and the 50/50 half:** the condition that allowed it is that `stream` is an OPTIONAL field whose ABSENCE buys the slowest behaviour — a new caller gets a blocking reply by forgetting a line. `tests/theChatAnswerArrivesAsItIsWritten.test.ts` fails when any client file that talks to a chat route does not state `stream` out loud, when the engine regains an `axios`/blocking send path, and when the grounded status frame stops preceding the lookup.

### 2. Forgetting — THREE drifted history cuts, each unaware of the other two

- **Root cause (confirmed; this is the "10–15 message" number itself):** the same history was cut in three independent places, and the cuts multiplied.
  1. `src/lib/chatContextWindow.ts` — `COMPACT_AFTER = 10`: from the 11th message on, the whole middle of the conversation became eight 180-character bullets of the USER's lines only, and every assistant turn in the middle was dropped outright.
  2. `FreeChain.trimHistory` — `FREE_CHAIN_HISTORY_TURNS = 6` (default ON): whatever survived step 1 was cut to two opening user turns plus the last four. The deepest cut of the three, and it hit the most common case (7–40 turns) hardest, because `historyForChain` only reached for the shared window ABOVE 40 turns.
  3. `UniversalAIRouter.buildPrompt` — its own last-15-turns-at-1500-characters rule, with everything older squeezed to 150 characters per turn.
- **Class:** a TURN COUNT is the wrong unit. A provider's limit and price are in tokens, so six long turns cost the same as sixty short ones — an ordinary chat turn is 200–400 characters, so a turn cap throws away most of the conversation while buying nothing. All three places now call ONE shared window, budgeted in CHARACTERS.
- **Fix:** `chatContextWindow.ts` is the one window. Inside its budget nothing is shortened at all (so 15 and 40 messages arrive verbatim, both sides of them). Over budget it keeps the opening six turns and the recent thirty whole, SHORTENS the middle instead of erasing it (keeping assistant turns), and only then drops oldest-middle-first into a recap. It is stable over its own output, and provably never exceeds its budget for any input. FreeChain's budget is the new `FREE_CHAIN_HISTORY_CHARS` (24,000 ≈ 6k tokens — the same worst case the six-turn cap already allowed at its own 4,000-character-per-turn ceiling); `trimForRung` still trims to each rung's real input window afterwards, so a small-context rung is no more exposed than before.
- **Siblings hunted:** every reader of a chat history was checked. `checkChatInput` was a fourth, quieter cut — a 60-turn cap that threw away the OLDEST turns of a cheap 150-turn conversation. It is now bounded by `CHAT_MAX_HISTORY_CHARS = 120_000`, so the worst case it exists to stop is **half** what it was (was 60 × 4,000 = 240,000) while a real long conversation survives whole.
- **Lock:** `src/lib/chatContextWindow.test.ts` (10) — 15 messages forget NOTHING (the reported case, verbatim equality with the input), 40 messages whole with both roles, the middle shortened not erased, a smaller chain budget honoured, idempotency, the budget invariant. `masterPlan.test.ts` and `chatReplyLanguage.test.ts` asserted the OLD contract (ten one-character turns arriving as six) and were updated with the reason recorded in place. `aFreeAiRequestIsBounded.test.ts` gains the 150-short-turn case. **Reversion proof:** shrinking the window budget to 3,000 fails 7 of those tests; re-adding a blocking send path fails the stream guard.
- **Honest trade, stated to the admin:** remembering more conversation sends more input tokens per message. The budget is bounded and tunable from Cloud Run without a deploy (`FREE_CHAIN_HISTORY_CHARS`), and the worst case at the request boundary went DOWN, not up.
- **Docs:** `docs/claude/ENV_REGISTRY.md` and `docs/FREE_CHAT_TIERS.md` carry the new knob; `AppKnowledgeBase.ts` carries both user-facing changes, so every AI in the app answers "does the chat remember?" correctly.
## 2026-11-25 — A named feature counts only when it is really built (master audit, Part J)

- **Root cause (confirmed):** the game contract knew ~15 features and checked them by WORD (`/\bswim/` style), and "swimming", "enterable houses", "destructible", "traffic", "NPCs" were not features at all — so "add a swimming system" / "make the house walkable" / "destructible doors" / "cars that follow roads" / "add villagers" were never checked, and a variable or a HUD line satisfied whatever was.
- **Fix:** five required features (English, Hinglish, Hindi); each tells the builder the kit call that really does it (`setWater`/`addWater`, `createEnterableHouse`/`enterableShellFor`, `makeBreakable`, `createCityTraffic`/`createTraffic`, `new Entities`/`createCityPeople`); in a kit game each is PRESENT only when that call is in the code. A game without the kit keeps the word check (no false "missing" on a hand-made 2D game). "Traffic" must be ASKED for — the platform's own city line ("streets, buildings and traffic") is not a request. NPCs seed the systems kit.
- **Lock:** `tests/aNamedFeatureCountsOnlyWhenItIsReallyBuilt.test.ts` (24). Reversion (strict check off) fails 5. Affected suites: 1 325 tests.

## 2026-11-25 — Nothing sinks or floats on real ground; the foot is a disk (master audit, Part E)

- **Audit:** the kit already has the grounding the audit asked for — `play/character.ts` (capsule, step offset, slope limit, last-safe recovery) and `three/objects.ts settleOnGround` (four wheel contacts, pitch and roll from them, sprung only downward; never the centre height copied). The runtime proof was missing, so it was written on the real kit: a character over a hill (feet never in the ground, never hovering while grounded), up a staircase, blocked by a 1 m wall; a car over a hill and along a side slope with every wheel on the surface and the body pitching/rolling.
- **The proof found a real defect:** ground support was read from ONE ray at the capsule's centre, but the foot is a disk. Over a seam narrower than the foot (two floor pieces, a step and a landing, a kerb and the road) the centre ray missed: the character was "airborne" while its rounded foot rested on both edges — it could not fall, and an airborne character cannot climb the next edge, so it hung there for ever (measured: z 6.90, y 1.99, not grounded, for 7 s).
- **Fix (class: support is a point, the foot is a disk):** when the centre misses or finds only a lower floor, the rim of the foot (8 points at 0.7 × radius) is felt and the highest walkable support holds the character.
- **Lock:** `tests/nothingSinksOrFloatsOnRealGround.test.ts` (5). Reversion (rim off) fails the staircase. Every controller / ground / collision / shell / royale / buildings test: 2 814 passed (the one local failure is `cannon-es` not installed here).

## 2026-11-25 — A walk-in house is really walked into; the door opens away from its opener (master audit, Part K)

- **Proof by traversal, as the audit required** (`tests/aWalkInHouseIsReallyWalkedInto.test.ts`, 4, the REAL capsule and door code): a shut door blocks; Use opens it; the player walks in, stands on the 0.15 m floor, and the side and back walls hold; a two-storey house's stairs reach the upper floor (y ≥ 2.9); a solid library model wrapped by `enterableShellFor` is entered the same way.
- **The proof found the defect behind "the house cannot be entered":** the door always swung OUT (−π/2) — into the player who had just pressed Use at it. The "never swing through a body" guard stopped it half open (measured −0.54 rad) and the half-open leaf blocked the doorway. Fix (class: a fixed swing direction): the door opens AWAY from whoever opens it (`interactHouseDoor` passes the actor; from outside → in, from inside → out); a door opened by game code with no actor swings in, as a house door does; the swing is chosen only while shut, so a moving door never reverses through the doorway. One door implementation in the kit (sibling hunt: none other).
- **Test updated honestly:** `enterableHouses` "blocks occupied swings" put its blocking body OUTSIDE (the old swing side); it now stands inside, in the arc — same rule (stops at a body, resumes when clear). New case: from outside it swings in, from inside out, never blocked by the opener.
- Reversion (always out) fails 3 of the 4 traversal tests. Building / house / shell / royale / town suites: 2 430 + the updated one pass.

## 2026-11-25 — One physics contract; a bullet stops at a wall (master audit, Part L)

- **Audit (every movement / collision path in the kit, by the calls it makes):** the character (`sweepWorldCapsules`, `worldFloorAt`), vehicles (`settleOnGround`, `worldColliders`), the camera, doors, buildings and the cannon-es physics (`physics.ts` builds its bodies from `worldColliders`) all read ONE world-collider registry (`markWorldCollider` → `worldColliders`) and ONE ground height (`setGround` / `groundHeightAt`). So no new engine and no migration — that would be risk with nothing gained.
- **The one path outside the contract:** `ProjectileSystem.update(dt, targets)` tested targets only, never the world, so a bullet went through walls and hit an enemy hiding behind one.
- **Fix:** `update(dt, targets, world?)` — a wall nearer along the path than the first target stops the bullet there and emits `PROJECTILE_HIT_WORLD` (a registered GameEvent, with sparks and the impact sound in the VFX table). `worldBlocker(scene)` in `play/aim.ts` is that world: a raycast against the same registry, its collider list refreshed every 0.5 s, not per bullet. Both systems-instruction examples pass it. Old callers are unchanged (no world ⇒ old behaviour).
- **Lock:** `tests/aBulletStopsAtAWall.test.ts` (5) on the real kit: an enemy behind a wall is not hit and the bullet stops at the wall; reversion (no world) hits through it; an enemy in front of the wall is hit; no wall ⇒ hit. 1 501 tests in the systems / aim / VFX / runtime / contract / history suites pass. Strict compile with real types: 0 diagnostics.
- **Sibling, fixed too:** `Entities.melee` takes the same optional `world` test, so a punch through a wall misses (test in everyCharacterIsSpawnedVerifiedAndKeptApart).

## 2026-11-25 — "Your app is live" needs a real deploy (master audit, Part N)

- **Audit of what exists:** NavBharatAI already has the no-fake-work machinery the audit asked for, for AgentV3 — `claimAudit.ts` weighs the model's own summary against MEASURED facts across 27 claim kinds (console clean, preview renders, screenshot seen, demo feature, game playable, app delivered over zero files, …) and corrects it out loud; the deploy tool throws on every failure (autopsy aed2906d), so a failed deploy is never a success result. No parallel "state machine" was added — a second verdict system beside the existing one would be the duplicated-ownership the audit forbids.
- **The gap found:** no rule for a DEPLOY claim. The summary could say "your app is now live!" on a turn where nothing was published.
- **Fix:** claim kind `deploy-claimed`, precision first — a sentence that claims it HAPPENED ("is now live", "has been deployed", "live at https://…", "deploy ho gaya"), never an offer or instruction ("press Publish to make it live", "ready to deploy", "not deployed yet"). The fact comes from `deployedThisTurn.ts` (one call in the build route — the handler only shrinks): true when a deploy SUCCEEDED this turn (TOOL_DONE), false when none did and nothing is live, UNKNOWN (silence) when the app is already live from an earlier Publish or the record cannot be read in 1.5 s.
- **Lock:** `tests/aLiveClaimNeedsARealDeploy.test.ts` (26). Claim-audit / route / deployment suites: 1 288 pass.
- **Sibling, fixed too:** `github-claimed` — the build agent has no GitHub tool (pushing is the user's own button), so "I pushed the code to your GitHub" / "opened a pull request" is corrected; the fact is `toolWasUsed('github')`, so a future GitHub tool answers it truthfully. 857 claim-audit tests pass.
- **Analytics (pattern sweep of admin / telemetry / build-analytics routes — not a line-by-line audit of every screen):** no fabricated fallback found — an unread figure is left ABSENT ("unmeasured ⇒ no badge"), the load board names unreadable tiles `unknown` instead of showing 0, analytics failures answer 500 with an error. Nothing changed.

## 2026-11-25 — Dual Android build providers: NavBharatAI Native Cloud Build + the existing GitHub Actions build

**Admin task:** one "Build Android App" button → exactly two genuine providers. Full design: `MOBILE_NATIVE_BUILD.md`.

- **UI:** `AndroidBuildProviders.tsx` (the button + two-option sheet; the last choice is pre-selected, never auto-switched) wraps the
  UNCHANGED `StoreBuildPanel` (GitHub) and the new `NativeBuildPanel` (native). Wired in `APKBuilder.tsx`.
- **No second recipe:** the native worker runs the app's own generated GitHub workflow, translated step by step
  (`workflowScript.ts`, census-tested for every step of both lanes on Capacitor 5–8; unknown actions / GitHub expressions throw).
- **No duplicate preparation or charge:** `/api/mobile-ship/setup`'s GitHub-independent body moved verbatim into
  `prepareMobileProject.ts`; the ₹ charge moved into `mobileBuildCharge.ts`; both providers call them. Source guards re-pointed, not weakened.
- **Stateless native driver:** detached build in a disposable E2B machine, Firestore job row, `advanceNativeBuild` under a transactional lease
  (a read-then-write lease race was caught by a test and fixed; the test Firestore double now models contention retries).
- **Trust split:** untrusted build machine (no env, restricted egress) → fresh network-less signing machine (fixed script, key files deleted by trap)
  → private bucket (md5-verified) → completed → charged once (`native_<id>`). Upload keys sealed with `secrets.ts`, consent recorded, every use audited.
- **Real verification in this container:** real Gradle APK + signed/validated AAB from NavBharatAI-assembled projects; real keytool checks for
  PKCS12/JKS; the whole orchestrator end to end (`tests/nativeCloudBuildRealGradle.test.ts`, opt-in).
- **Defaults:** native OFF (`MOBILE_NATIVE_BUILD_ENABLED`), GitHub ON (`MOBILE_GITHUB_BUILD_ENABLED`).
- **OPEN (owner-side, not code):** build the worker template (`template_kind: android-native`) — the image has never been built (no Docker
  daemon here); set `MOBILE_NATIVE_BUILD_TEMPLATE` + `MOBILE_BUILD_ARTIFACT_BUCKET`; pin Temurin digests; bucket lifecycle rule; a first
  live native build and a real-device install.
- **OPEN (admin decision):** whether a native build whose paid balance cannot cover ₹1 should withhold the download (GitHub cannot; native could).
## 2026-11-25 — The first online Royale match: server-authoritative, 2–4 players, quota-bound (admin "sab karo")

- **What was asked:** an external audit's order, approved by the admin — first a small, complete online match for the original Royale game, then scale. Until now only the offline Practice (PR #4217) existed.
- **Server (`src/server/lib/royaleOnline/`):** `matchCore.ts` is one room's whole simulation, pure (no sockets, no clock): movement is a SPEED BUDGET (metres earned at 11 m/s, capped at 6.25, spent per accepted move — a per-message allowance would let a client spam tiny moves at one instant and outrun the cap), arena bounds and cover blocks; shots (cooldown, range, cover in the line of fire, armour); loot that changes hands in one place (`claimLoot`, a held crate is never handed out again); the zone on the server clock, collapsing to nothing so every match ends; elimination, placement and ONE frozen result (simultaneous zone deaths: the one with most health before the tick stands). `matchService.ts`: per-app queue (4 ⇒ start now; 2–3 ⇒ after 10 s; alone ⇒ after 30 s; empty seats filled by bots LABELLED bots), signed per-session resume tokens (anonymous store players have no account), 15 s reconnect grace then forfeit, the result reported once (`reported` is the only door), "queue again", hard quotas, `drain()` on SIGTERM. `royaleWs.ts`: the `/api/royale-online/ws` upgrade (wired in `server.ts` after Sonic), the store check (`getWebApp` + `canAccessNavData`, the NavData precedent), per-address socket limits, 512-byte frames, heartbeat, kill switch **`AGENTV3_ONLINE_MATCH`, default OFF** (ENV_REGISTRY).
- **Kit (`GameRoyaleGenerator.ts`):** `royale/onlineClient.ts` (protocol, 100 ms interpolation, automatic resume, honest states: not on the store / switched off / full / unreachable), `royale/onlineMatch.ts` (the arena with the server's cover blocks, remote humanoids, position sent ~15/s, shots along the camera yaw, server corrections applied), `RoyaleOnline.tsx` (lobby, queue, HUD, eliminated, result, Queue again), `RoyaleGame.tsx` (Practice | Online tabs). The instructions now mount `RoyaleGame`. `characterSwap.ts` recognises it; the tool catalogue describes both modes.
- **Locks (reversion-proven, each guard put back and its test watched fail):** `tests/anOnlineRoyaleMatchIsPlayedOnTheServer.test.ts` (19, real HTTP server + real WS clients: a three-player match to one winner with the same result for all, four start at once, lone player gets labelled bots, an unfought match still ends, teleport/bounds/garbage refused, tiny-move spam cannot outrun the cap, cover stops a shot, a crate goes to one player, reconnect restores, forged/foreign tokens resume nothing, forfeit after grace with the late returner shown the same result, drain, kill switch, store/private refusals, connection cap, daily cap, message flood, per-address limit, room cap); `tests/theOnlineRoyaleKitTalksToTheRealServer.test.ts` (6: the EMITTED client against the real server — lobby → queue → match → interpolation → server correction → automatic resume → result → queue again; truthful unavailable states; the adapter's send rate and remote bodies). The emitted modules compile under the strict kit census.
- **Open, recorded in the queue:** Q-3390 🟡 (switching it on is the admin's money decision), Q-3391 🟡 (rooms are per Cloud Run instance; players on different instances do not meet), Q-3392 OPEN (the daily cap counts per instance).
## 2026-11-25 — NavBharatAI's own Indian clothes (library batch 16); library pictures show characters standing

The admin approved building the garments ourselves: "haan, Indian kapde banana shuru karo". The three downloaded Indian-clothing models (dhoti, kurta, saree) still have no verified licence, and **none of them is used**.

- **What was added:** `scripts/library/buildIndianGarments.mts` makes the garments from geometry on the CC0 batch-7 villager bodies. There are 4 packaged models, live-admitted 4/4 and animated in a browser:
  - `q16-man-kurta-pajama`: cream kurta, white pajama;
  - `q16-man-pagdi`: white kurta-pajama with a saffron pagdi;
  - `q16-man-dhoti`: khadi kurta, white dhoti, white pagdi;
  - `q16-woman-saree`: maroon saree with a gold border and pallu, green blouse.
  - Each is about 3.4 MB, with 19–22k triangles and all 16 clips.
- **How the garments are made:**
  - **Rings fitted to the body:** at each height (or along an arm), the body's cross-section is measured in 24 directions, smoothed, and given ease.
  - **Tubes:** the rings become tubes for the torso, sleeves, legs, skirts and pagdi wraps.
  - **Pallu:** a ribbon laid on the body's surface.
  - **Weights:** taken from the nearest body vertices.
  - **Hems:** a skirt, a kurta's skirt and a dhoti's wrap follow the pelvis plus the thigh on their own side, the usual game method for a skirt. Following only the nearest leg dragged the saree with each step. Averaging both legs let a thigh show through the hem in the standing pose.
  - **Pagdi:** follows the head bone only.
  - **Changeable by name:** each garment is its own node and material — Kurta, Pajama, Pagdi, Dhoti, Blouse, Saree, Pallu, Border.
- **Found on the way:**
  - **The villager had only its head's faces.** Only 1,683 of its 7,281 vertices were used. The base pack's full-body mesh has the same vertices in the same order, so its face list is written back. The fantasy outfit, including the knee-high boots that showed through, is detached; feet are bare.
  - **Library pictures took the wrong pose.** They used the FIRST clip whose name contained "idle". In the animation library that is "Crouch_Idle_Loop", so every such character was pictured crouching. The 60+ kayquer people have their idle named "parado", so they were pictured in a T-pose. `thumbnailPoseClip` now prefers the entry's own idle role. 120 pictures were re-rendered and 77 changed.
- **Matching:** Hindi and Hinglish aliases were added, as whole phrases ("dhoti wala aadmi", "पगड़ी वाला आदमी"), so the longest-name rule gives one person rather than "a dhoti man AND a man". The knowledge base has a new `game_indian_clothes` entry.
- **Test:** `tests/indianGarmentsAreOurOwn.test.ts` checks the bytes, admission, garment nodes and materials, the restored body, skin weights, word matching, and the picture pose.
- **Still open:**
  - Saree in a full sprint: the forward leg comes through the front of the skirt. Walking and jogging are clean. Real cloth would need a physics simulation, which is not built.
  - The kurta still shows a little of the base body's muscle shape.
  - More colours and outfits (a woman's salwar-kameez, a lungi, a sherwani) can come from the same builder when asked.
## 2026-11-25 — One ground, never layers: a NaN ground edit can no longer poison the whole map (failedbr #2499, Q-3353…Q-3356)
## 2026-11-25 — Game proof: a named feature is present only on evidence that ran; four proofs per game build (#4542, Q-3360…Q-3365)

External Game Maker audit, adapted under the external-suggestion rule.
- **The audit's claim was real.** `scopeMatch` (`src/server/AgentV3/gameIntent.ts`) counted a feature present on a code SIGNAL: in a game without the 3D kit, `WORD_WITHOUT_KIT` accepted the words `traffic|cars`, `swim|water`, `door|interior|inside`, `destroy|break`, `npcs|villagers|people`; every other feature (score, levels, sound…) was a word/identifier match everywhere; and a kit game passed on a kit identifier anywhere — in a file nothing imports, or an import list.
- **Class:** "present" was decided by text, not by anything that runs. **Fix:** present = a kit call (call syntax) in a file reachable from the entry (`gameCodeReach.ts`), with the kit's 3D or systems layer on disk, or a played action whose state change was observed (`gameProof.ts` `playedFeatureEvidence`: score rose, level rose, a sound started, Play again started a round, the vehicle moved under the accelerator). Anything else the code names is `notVerified` — said in GAME_SCOPE_GAP and in the release gate (unproven list, and named in the green headline). `missing` is unchanged by construction, so the done signal, game repair and complete-gate behave as before.
- **Four proofs:** one GAME_PROOF info line for every game build the playtest reached — (a) contract, (b) start / after-moving / far pictures kept in the sandbox (size, id, path, measured change; the far view by a one-draw camera pull-back, three.js only; every view not taken said with why, day/night included), (c) every action played with pass/fail and the observed change, (d) wall time against the 90 s budget and idle fps, labelled the sandbox's software renderer, NOT a real phone. About a second; skipped and said with under 25 s of budget left.
- **Wording:** "A good game" → "Plays well"; the head says "for playability, not graphics"; "Looks" → "Picture detail"; the proof card says "for playability (not a rating of its graphics)". The `Game Quality Score N/100` token the parsers read is kept.
- **Lock:** `tests/aGameFeatureIsProvenNotNamed.test.ts` (17), proven by reversion (word→present: 7 fail; reach check removed: 2 fail; "A good game" restored: 1 fail; GAME_PROOF recording removed: theBuildRouteIsSplitByPhase fails). Six older tests re-pointed at the stricter meaning. The real-browser playtest suites ran the changed script and passed.
- **Not done (queue):** Q-3363 🟡 keeping the pictures past the sandbox (a storage decision); Q-3364 🟡 played proof for swimming / houses / inventory / seated vehicle and the day/night pictures need a kit state hook in files #4535 is changing; Q-3365 OPEN — a kept game repair's replay does not re-record GAME_PROOF.
## 2026-11-25 — External Game Maker audit: new games get their own look and keep it; placeholders are caught (Q-3370 … Q-3374)

- **Variety (Q-3370).** Class: a starting choice the platform makes for a new game was a constant — every race's car 0xb42b2b, every open world WORLD.seed 7, every first city seed 11 + 17n. One rule now (`src/server/lib/projectVariety.ts`): the choice is fixed by the project id over a pool and written ONCE into the project's own file; everything else is derived from that file, so different projects differ and an edit ("ek dukaan jodo") changes nothing.
  - A race the seed knows is a race gets `src/game/car.ts` with one of seven paints (ToolDispatcher `ensureRaceCarFile`, created once, never replaced; byte-registered in platformAuthored so an untouched car file is ours).
  - The open world's `src/game/world.ts` seed comes from the workspace id — the SAME hunk #4535 carries, byte-identical, so the two merge cleanly in either order.
  - The kit (`openWorld.ts`) derives each place's lots/buildings/traffic paint, a city's style (mixed or downtown) and the parked-car paints from WORLD.seed (`placeLook`, `parkedPaintShift`). A map on seed 7 keeps exactly the city it had — no existing game moves.
  - Lock: `tests/aNewGameGetsItsOwnLookAndKeepsIt.test.ts` (9; real ToolDispatcher recipes and the real kit). Reverted (constant paint / world seed / city seed) → 4 fail.
  - Not here: the human half (starter appearance presets, REALISTIC_HUMANS outfits) is #4535's (Q-3372); the action town and race road still start the same (Q-3373, waits on #4535's GameBuildingGenerator rewrite).
- **Placeholders (Q-3371).** Class: no detector looked for a stand-in, so a game showing the code-built object for a missing GLB, a frozen rig, a player in the sea, a blank map or controls off the screen passed every measure. `gamePlaceholderProbe.ts` adds separate deterministic detectors (no change to the playtest's scoring or the release gate): missing model from the files; in the page, failed model/image requests (404 or an HTML answer), broken textures, a 10+-bone rig with an unchanged pose over the round, water over the player's head at the start (new read-only `__nbWorld.standing()`), ≤2 meshes after a round, phone controls laid out but off-screen/transparent/hidden/tiny. One GAME_PLACEHOLDERS line (process-only) and a builder-only repair note on the next game turn; that turn's playtest looks again.
  - Lock: `tests/aPlaceholderIsCaught.test.ts` (17; the browser hook run against a real three.js scene, the real kit's open world, the real phase). The character GLB removed → fires naming "human", its path and its loader; a healthy kit game → silent. Reverted (phase gate, hook line, file check, comment stripping, standing hook) → each fails.
  - Open: in-build repair is suspended by the admin, so the repair is on the next game turn (Q-3374, 🟡 BLOCKED on that decision).
## 2026-11-25 — One ground, never layers: a NaN ground edit can no longer poison the whole map (failedbr #2499, Q-3357…Q-3360)

Admin 2026-11-22, on their GTA-style game: *"mujhe lag raha hai, maps me sabhi city/village ko ek plane me na bana kar vertical
layers me banaya ja raha hai!"* — screenshots of the hero swimming in the sea under a flat slab with lamps, people and cars on it.

- **Reproduced in Chromium (real kit, vite build, swiftshader).** With valid regions, both the kit at build time (acae9e7c, 11
  places, admin-like world) and main (20 mixed regions: cities, joinTo tiles, desert/jungle/mountain/snow/beach/grassland, a
  venue) stand every place, the player and the drawn terrain on one ground: terrain off 0 at every place, pending 0, player
  0.2–0.6 m over heightAt. With ONE region asked toward `'southwest'` (not one of the eight directions) the spot became NaN, its
  pad was filed under "every point" in the pad index, and heightAt was NaN EVERYWHERE: no terrain was drawn, the player dropped
  into the sea, and the cities already planned hung at their pad heights (11 m) — exactly the screenshots. The geometry report
  said `off: 0` (NaN compares false).
- **Class:** one bad number poisons the whole ground, silently. **Fix (at the entry):** `levelGround` / `setLand` / `addRoad`
  refuse a non-finite value and say so (`finiteEdit`, AthreeMapGenerator); the open world reads each region's `toward`
  (aliases such as `northeast`, `NE`, `North East` mapped; anything else left out and said) and `distance` (metres or left out)
  before laying it (`cleanRegion`).
- **Honesty (rule 5):** geometry() counts a non-finite sample as off and as `terrain.notNumber`; `geometryFindings` names it
  first ("The map's ground is NOT A NUMBER…").
- **Late edits (builds on #4466 — aedfd171, 896c8ba9, 3df5395d):** the open world now redraws late ground edits by default
  (`lateEdits: false` opts out; a bare Athree map stays off — the rollout page's two follow-ups do not apply to the open world,
  which keeps no stored heightfield and whose rivers/roads draw their own heights), re-stands `world.place()` objects on the
  new ground, and counts edits from the FIRST DRAW, so an edit in a feature's `setup()` is reported when the redraw is off.
- **Lock:** `tests/oneGroundNeverLayers.test.ts` (9) — every fix reverted on its own and watched fail (guard, cleanRegion,
  notNumber, default redraw, prop re-stand, first-draw count).
- **🟡 Q-3360 BLOCKED:** the exact non-finite value in the admin's own game is unknown — the saved report has file hashes, not
  world.ts / features. Needs those files or one rebuild on the fixed kit (the console then names the refused value).
## 2026-11-25 — Autopsy of BR2514–BR2519 (last six builds; all "succeeded", none played)

Ledger (one row each in BUILD_REPORT_QUEUE.md, Q-3330 … Q-3343). Fixed in this PR: **Q-3330** kit refresh was all-or-nothing → partial, safe, named (real kit: 0 → 124 of 137 files reach the existing game); **Q-3333** Surplus refusal (HTTP 4xx) parks the engine 30 min instead of costing 80–94 s on every build; evidence fixes for the two classes that had no root cause — **Q-3332** the playtest says each stage's seconds (real-browser proof) and **Q-3337** the kit seed says each recipe's seconds. Already fixed upstream (merged #4532/#4533, after these builds): **Q-3335** the user's repeated asks (enemies, bullets to the sky, walking through bots, knock-back, police). BLOCKED with options: Q-3331 (the shell chain behind an edited playerBody.ts), Q-3334 (why Surplus 404s every model — the provider), Q-3336/3339/3340/3343 (need project files or fuller records), Q-3338 (weak model tier, follows Q-3334), Q-3341 (report storage cap), Q-3342 (charging an unplayed game — a policy decision).
- **Q-3331 (admin "continue next" → the recommended option):** a held-back kit update is finished by the builder, safely — `kitHeldBackHandoff` names the exports the edited file must add; the growth guard's `restoresKitExports` lets through only an edit that keeps every line and adds only exports the kit's own version has. Test on the real playerBody.ts (8).
- **Q-3344 (admin, 2026-11-25):** the admin analytics 500 — seven independent reads in one Promise.all; one failure sank the page. Each read is settled and named now (`adminAnalyticsReads.ts`, `analyticsUnread.ts`); the failing read itself is named on the page after deploy (it is in Cloud Run logs this session cannot read).
## 2026-11-25 — failedbr #2499: places stand close, with a road between (Q-3350–Q-3352, claude/places-close-road)

- Admin: "maine kaha map me 4 village/city add karo, to add huye hi nahi" — then "maps thode pas pas rahe, aur beech me road ho".
- Measured headless on the real kit (on main): the 4 new cities WERE in world.ts, 2.5–3.2 km out. The n-th place sat about sqrt(n) spacings from the first on a golden-angle spiral. A city is built within reach + BUILD_AHEAD (1500 m), so nothing new showed from the start.
- Class (Q-3350): a place's distance came from WHEN it was added, not from where there was room. Fix: every place, land, user map and venue takes the nearest free spot to the first place.
  - The search is a box-exact ray search. It keeps `PLACE_GAP` (150–300 m by size) edge to edge, on dry ground off roads, and gives the same map every time.
  - A place with no usable ground on any ray goes to the existing rescue (#3add3f10), so it is never put in the sea or on a highway.
  - Kept as before: toward, distance, spreadMeters, joined lands and joined venues.
  - The tiles of a grown city are worked out first, from the same cells and the same seeded draws, so nothing is laid where a city will grow.
  - Results with 25 regions: the farthest place went from 3151 m to 1489 m, and the farthest land from 5814 m to 1781 m. 1000 villages now plan in 4.2 s; they took 42 s before.
- Sibling (Q-3352): `world.addRoad`'s grade passes moved the end heights, so a road cut into or lifted a city's ground at the gate. An end on levelled ground is now pinned.
- Sibling (Q-3351): once the ends are pinned, two places on very different levels would get a road too steep to climb. In that case the highway tree is rebuilt with the steep pairs last. A map with no steep pair keeps exactly the same tree.
- Test: `tests/placesStandCloseWithARoadBetween.test.ts` (9). It drives the road graph from the spawn to every place (25 and 100 regions) and checks:
  - no road crosses a block, and no city's ground moves at a gate;
  - gaps are at least PLACE_GAP.min;
  - the map comes out the same every time;
  - toward, distance and spread are kept;
  - tiles keep room, and a land listed first leaves the start free;
  - the full map gets every place and road, and nothing is built twice.
- Proven by reversion:
  - spiral back → 5 tests fail;
  - end pin off → 2 fail;
  - climb-aware tree off → 1 fails;
  - start reserve off → 1 fails.
- Old games: their places move closer at the next kit refresh, which is what the admin asked for. The spawn stays in the first place, and tiles keep their cells.
- Siblings updated: the world race's own default towns (`GameWorldCourseGenerator` TOWNS) now name their distances (600 / 850 / 1050 m, what the spiral gave them), so a default world race is still a real drive. A race on a game's own compact world.ts gets a shorter route and finishes at the route's end — an open product choice, recorded in Q-3350. Updated, with reasons: the race test regions now name distances, the bridge source guard reads highwayTree(), and the 1,000-village test no longer requires a rescue.

## 2026-11-25 — Autopsy failedbr #2523 + #2525 (FPS shooter, server lost, continue build)

**Billing check (code read, not assumed):** both build debits (`debitWalletForBuild`, agentv3.ts settle and watchdog
finalizer) run only at the END of a build, and a build with `!result.ok` bills 0. #2523's server died without running
JS, so it never reached a debit: it was not charged. #2525 is charged only if it settles ok, for its own spend (estimate
₹0.10).

**Fixed in PR #4554:** Q-3460 — the seeded game kit failed its own first typecheck (6 errors
across playerBody, externalAssets ×2, RacingRoadGame, openWorld, worldLayer, plus the LOD block). New census
`tests/theKitTypechecksInTheAppItShipsTo.test.ts` compiles the whole kit under the scaffold tsconfig and strict; each
fix reverted-and-failed; a scratch app with three@0.180 + @types/three + TS 5.9.3 compiles it with 0 errors.

**Recorded in BUILD_REPORT_QUEUE.md:** Q-3461 (vitest declared, never installed — decision), Q-3462 (typecheck note says
test errors fail the release), the four lost servers are main's Q-3354 (recorded first by another session, same evidence), Q-3463 (no live dead-build sweep), Q-3464 (Surplus 404 on six models → provider
breaker; evidence for Q-3316), Q-3465 (fallbackMs 0), Q-3466 (COMPLEX vs cheapest band), Q-3467 (fallback message names
the wrong ladder), Q-3468 (HERO_OBJECTS "table"), Q-3469 (Surplus on COMPLEX game builds — decision), Q-3470 (no
continue hand-off), Q-3471 (seed assets serial after recipes).
## 2026-11-25 — "FREE AI CHALU KAREIN": an app's AI, free, in three steps under the ❗ button

Admin, verbatim: *"navbharatai me jab bhi koi user ai banwaye, koi bhi ai. to header me ❗ button me 2
button dikhe — 1. login … 2. ganerate api … 3. pest api keys … login button se z.ai (glm) ka login page
open ho, aur api se https://z.ai/manage-apikey/apikey-list … (sab user ki language me)"*, then *"'free ai
chalu karen' ho to? glm 4.5 flash, glm 4.6v flash glm 4.7 flash — yeh teeno free module hai. yahi use hone
chahiye only!"*, then *"han yahi bana do!!!!"*.

**What shipped.** One row under the existing ❗ tray ("Turn on free AI"), offered only when the app really
uses AI and no key of the owner's own is answering. It opens three numbered steps, English first with Hindi
beside it: open the sign-in page, open the key page, paste the key in the box. The key is saved into the
owner's own encrypted vault, scoped to that app, through the one shared `saveUserSecrets` write — so nobody
has to find Settings → Secrets & API Keys at all, which is where the old flow lost people. After that the
app's assistant answers on the owner's free account: `glm-4.7-flash` by default, `glm-4.5-flash`
automatically when the first is busy, and the user never picks or sees a model.

**The ✅ is earned, not drawn.** `/api/app-ai/free-key` asks the free model one real question on the pasted
key BEFORE saving it; a key that is refused is not saved and not ticked, and a busy free tier is reported as
"wait a few seconds and press Save again" rather than as a broken key. Steps 1 and 2 tick on "you opened
this page", and the card says so — a browser cannot honestly know whether a sign-in succeeded in another tab.

**The money class, locked.** The key is the USER'S, so a paid model id on it would spend their own balance
behind a button that said "free". `appFreeAi.ts` therefore holds an explicit three-id ALLOWLIST (the three
Z.ai prints as Free, already quoted in `providerRates.ts`) and `APP_FREE_AI_MODELS` may only narrow it. A
matcher on the word "flash" would have been the fourth walk into the trap `providerRates.ts` records:
`glm-4.7-flashx` and `glm-5.3-flash` both contain "flash" and both cost money.

**Siblings hunted.** `browserAiKeyScan.ts` did not know `api.z.ai` or `*_ZAI_API_KEY` — and the free key is
exactly what makes that shape reachable, since `ZAI_API_KEY` now really exists in an app's `.env`. Both are
added, same class as the OpenAI case the module was written for. `secretRequest.ts` now refuses to let a
build ask for the key in a mid-build popup: the ❗ box owns it, and a popup would be the same thing done
worse, without the two links that make a key gettable.

**Honest gap, recorded:** the free VISION model (`glm-4.6v-flash`) is unreachable because the app-AI gateway
carries text only — no image input exists anywhere on that path today. It is **Q-3400** in
`BUILD_REPORT_QUEUE.md` with what it needs, rather than shipped as a model id with nothing behind it.

Gate: `typecheck`, `noUnusedImports`, `native:guard`, `typecheck:server`, `typecheck:benchmark`,
`test:coverage`, `build`, `test:bundle`, `boot:check`, `deps:server-gate` — on the final state.
31 new tests in `tests/freeAiChaluKarein.test.ts`.
### 2026-11-25 — Q-3334 root-caused live: Surplus 404 is a dead seller PAIR, not the request (PR #4536)

Admin: "surplus app builder me kam nahi kar raha, vaise woh reply de raha hai". Probed /min90 with the builder's own
shape (provider pin + si_route + tools + reasoning_effort, prompts up to 211k tokens, max_tokens up to 64k, tool history):
qwen3-coder/bedrock and glm-5.3-flash/mistral → 200 at every size; glm-5.3 and deepseek-v4.1-flash pinned to
dashscope-cn → 404 `no_sellers_for_model` on every request; glm-5.3/zai → 404 `minimum_discount_not_met` (router 80%,
market page 99.5%). Over ~260k tokens qwen3-coder also gets `minimum_discount_not_met` (context, expected).
Class: the selector trusted the public market's `discount_pct` as "the router will fill this pair", and treated a
pair refusal as a MODEL failure (bench) and — in #4536's first cut — as an ENGINE refusal (30-min park).
Fix: `surplusPairRefusals.ts` (process-wide pair memory, 20 min / 2 min if recently served), selector skip, same-model
next-seller retry, no bench on a market refusal, 404 removed from the circuit's immediate open; sibling found and fixed:
a retried attempt on the adapter path returned before the bench decision and the report notice (Q-3019 class).
Test: `aDeadSurplusSellerIsSkippedNotTheEngine.test.ts` (reverted ⇒ 3 fail). Open: none in this row; watch the next
Weak build's Surplus attempts.

### 2026-11-25 — Build Engines: per-day failures + tap-through engine stats; Firestore indexes ship with the code

Admin: "BUILD ENGINES me … inko per day fail response karo! … tap kar ke … kitne request gayi, kitne response aye,
kitni der me aye (avg) aur kitne fail huye … fallback system kam kyu nahi kiya woh bhi likh kar ana chahiye".
- The chip's "18 failed" was the engine-health aggregate: a rolling 24 h over the LATEST build of each project only.
  New `agentv3_engine_day/{UTC day}` (engineDayStats.ts): each finished build adds, per engine family, answered turns,
  failed attempts, measured answer time, failure codes (the engine's own refusal code when it gives one) and which
  engine answered the turns it failed. One write per build at `BuildDiagnostics.finish()`.
- To time each engine, the chain now returns `answeredBy` and AgentRunner's call row carries it as `provider`; the
  route passes `fellBackFrom` to `recordProviderTurn` (existing lines edited, no new block in the handler).
- UI: chips say "N failed today" / "OK today" and are buttons; `EngineDayDetail` shows 7 days (requests, answered,
  failed, avg answer time), reasons in words, and "X answered N turns instead". Body shape-checked (src/lib/engineDays.ts).
- Limit, stated on screen: a build whose server was lost before `finish()` is not counted (see Q-3354).
- Q-3344 root: the revenue index was in firestore.indexes.json but Cloud Build deployed only `firestore:rules`;
  a `deploy-firestore-indexes` step now runs on every merge (optional, no --force).
- **2026-11-25 update, CI on the merge with #4535:** `libraryBatch14.test.ts` held a 300 MiB snapshot of the library. With #4535's realistic humans, `main` alone was 298.4 MiB.
  - **Smaller files:** the garment files now drop what nothing references (`pruneGlb`: the detached outfit, its materials and textures, the old head-only face list). Each model went from 3.45 to 2.4 MB, and the four look identical (the same changed-pixel proof at admission).
  - **Size now:** the catalogue is 307.6 MiB, inside the admin's 320 MiB budget, which stays the only limit. The snapshot line was replaced by a note.
  - **Watch:** only about 12 MiB of library room is left. The next large batch needs the budget raised (the admin's decision), or older models slimmed the same way. Many packaged characters still carry their unused materials.
- **2026-11-26 follow-up (same PR #4544):** CI caught `tests/webSocketSingleSource.test.ts` — the kit opened a socket without a resolver. Not a lint nit: the store player is a srcdoc frame whose base is the PARENT page, which in the Android/iOS app is the local shell, so the online socket would have dialled the phone (the Sonic-on-phones class, 2026-08-13). Fix: the open route writes `window.__NBAI_API_ORIGIN` per response (`src/server/lib/storeApiOrigin.ts`, strict scheme://host[:port] only), and the kit's `resolveWebSocketUrl` prefers it. Locks: `tests/aStoreAppKnowsWhereTheApiIs.test.ts` and the native case in `tests/theOnlineRoyaleKitTalksToTheRealServer.test.ts` (reverted ⇒ fails). Sibling NavData (relative fetch from the same frame) recorded as Q-3393.

## 2026-11-26 — Q-2698: the open world's frame rate in the sandbox, measured to its causes (claude/light-city-tier)
- **Measured, not assumed.** Playwright + SwiftShader, 1280×720, the open-world starter built from the merged kit. A Chrome trace showed the game's own JS at ~2 ms a frame and the GPU process ~23% busy; the frame was waiting on 36,000 synthetic input messages a second. Cause: the playtest clicks the canvas, the shell asks for pointer lock, and pointer lock in an automated headless browser floods input. Lock stubbed, same build: 4 → 15 fps.
- **Fix 1 (root):** the shell skips pointer lock when `navigator.webdriver` is set. A person's own browser never sets it, so desktop mouse capture is unchanged.
- **Fix 2:** a light geometry tier (`geometryTier()` in three/surfaces.ts). It is chosen automatically for a software renderer or a ≤4-core/≤4 GB touch phone; Settings (Auto quality off + Graphics low) force it, and any other Graphics choice with Auto off forces full. It draws one textured facade panel per wall instead of a box per window, road marks as quads, each moving vehicle as one mesh, and at most 6 vehicles and 12 people. The starter place drops from 360 meshes / 84.8k triangles to 163 / 34.0k (on screen: 222–233 draw calls → 146–147). Colliders are identical vertex for vertex (the RNG draws are kept). The full tier is unchanged. `generateGame3D(['city'])` now ships surfaces.ts, which the city imports.
- **Result:** before 0.2–4.4 fps, after 9.3–11.6 fps. **The ≥ 20 fps target was NOT reached.** The geometry tier alone did not move the fps. The ceiling is software compositing reading the canvas back every frame (Q-3381, blocked: it needs a GPU or a compositor change in the sandbox). The checker-side lock stub for games that do not use the kit shell is Q-3380 (gamePlaytest.ts is being edited by #4541/#4542).
- **Tests:** `tests/aCityIsLightWithoutAGpu.test.ts`. Mesh and triangle budgets per tier on the real kit, identical colliders, traffic and people working in the light tier, tier selection, the webdriver guard, module-subset imports. Each was proven by reversion.
- **Not done:** parked (drivable) cars stay whole in both tiers (68 meshes for 4 cars), and no impostors for far cities.
## 2026-11-26 — No pointer lock in the platform's browsers (Q-3380, follow-up to #4552)
- gamePlaytest.ts (desktop page) and clickExplorer.ts (every fresh page) stub Element.prototype.requestPointerLock before app code runs, so a game the builder wrote itself (or an older kit copy) can no longer flood the headless page with synthetic input after the playtest clicks its canvas (#4552 measured 4 → 15 fps with the lock stubbed).
- Test: tests/aPlaytestBrowserNeverLocksThePointer.test.ts (removing the playtest install fails it).
## 2026-11-26 — One seed rule, not four copies (reconciling #4541 with #4535)

- **What was found:** after #4535 and #4541 both merged, the same per-project pick existed four times: #4535's starter look (`'player:'`), realistic outfit (`'human:'`) and world seed (`'world:'`), each a private `createHash('sha256').update(facet + ':' + id)`, plus #4541's `projectVariety.ts`. This is the same class as the drifted `safeRelPath` copies: duplicates that agree today and can drift tomorrow.
- **Fix:** all three now call `projectVariety.ts` (`pickVariant` / the new `varietySeed`). The digests are identical, so no existing project's hero, outfit or map changes; a test proves byte-identity against the old formula for several ids.
- **Lock:** a census in `tests/aNewGameGetsItsOwnLookAndKeepsIt.test.ts` fails when any server file hashes a facet and a project id by itself. Proved by putting back one private copy: the census fails.
- **Queue:** Q-3370 and Q-3371 were closed by the #4541 merge, and Q-3372 by the #4535 merge. Q-3373 (action town seed) is no longer waiting on #4535; its row now gives the design it needs.
## 2026-11-26 — The game library's storage budget is 400 MiB (admin decision)

- **Why:** after the Indian clothes (#4540) the catalogue was 307.6 MiB of the 320 MiB budget, leaving about 12 MiB (roughly five animated characters).
- **Options measured first:**
  - **Pruning:** removing unused data from all 721 packaged files would save nothing. They are already lean, which corrects my own earlier guess that old characters carried leftover data.
  - **Dye recolours:** storing them as patches on their base models would free at most 25.8 MiB of their 92.4 MiB, because the recoloured textures are most of each file. It would also need a change to how packaged models are served.
- **Decision:** asked with the options, the admin chose to raise the budget to 400 MiB. `CATALOGUE_STORAGE_BUDGET_BYTES` changed. The error messages are derived from the constant, so they cannot state a stale number again. `catalogueBudget.test.ts` now asserts 400 MiB (80 × the 5 MiB worst case).
- **Effect:** the models ship in the server image (Dockerfile `COPY assets/game-models`), so the image can grow by up to about 80 MiB more, to fill the budget.
- **Not built:** the dye-patch dedupe. It is worth doing only if the library nears 400 MiB again.

## 2026-11-26 — Three more Indian outfits (batch 16 grows to 7)

- **New models:** built from the same `buildIndianGarments.mts`. The four earlier models are byte-identical (same sha256), because the builder is deterministic.
  - `q16-woman-salwar-kameez`: magenta knee-length kameez, cream salwar, yellow dupatta with a gold border.
  - `q16-man-lungi`: white baniyan with shoulder straps, blue lungi with a white band.
  - `q16-man-sherwani`: gold sherwani with a high collar, cream churidar, red safa.
- **Checks:** all seven were admitted live; the three new thumbnails were rendered.
- **New builder pieces:** `longTop` (a kameez or sherwani sized to the body's own shoulders and neck), `trousers` (ease set by height), `baniyan`, `lungi` and `dupatta`.
- **Fixed on the way:** `ribbon` kept any sample more than 6 cm from the body at its own point, which is right for the pallu's hanging end. Between a strap's waypoints, that made the curve arch into the air. Now `freeBeyond` is a parameter, and a strap passes `Infinity`; the pallu keeps the old value, so the saree file is unchanged.
- **Tried and reverted:** "one model, one requirement" deduping. Two names of one model (for example "groom" and "man in sherwani") each give the game a key, and the file downloads once. Dropping a name would make a builder's `loadRequestedAsset('groom')` fall back to a code-built stand-in, so the duplicate name is harmless and stays.
- **Matching:** Hindi and Hinglish aliases for salwar suit, lungi and sherwani/dulha. The knowledge-base entry `game_indian_clothes` is updated.

## 2026-11-26 — Open-world problems 4/5/8 and the autopsy of failedbr #2521–#2530 (Q-3520…Q-3535)

Branch `claude/kind-cannon-s3hgxm`. The admin asked for the open-world problems in their order ("user ke words par nahi
intention par kaam ho"), then for every small and big problem in the last ten build reports to be fixed. Per the admin, the
PR is opened and NOT merged. Local CI was not run in full (admin); targeted suites, both typechecks and noUnusedImports were.

**Ledger (problem → root cause → class → siblings → lock):**
- Q-3520 city does not grow → a narrow word list; no-city answered "no-city" → intent read from words, not wishes →
  `growthWish` reads what each size word describes; map words (`map bada karo`) stay map growth → `aBiggerCityIsTheWishNotTheWords`.
- Q-3521 no enemies/police in a GTA world → systems kit never seeded, starter made no entities → a genre's core action
  missing from the starter → `streetDanger.ts` written first when the world has a fight, peaceful prompts excluded →
  `anOpenWorldHasStreetDanger` (strict compile of the feature against the real kit; reverted-and-failed).
- Q-3522 trees dropped → naming one module narrowed the set → "named" read as "only" → only/sirf/keval narrows → four pinned tests updated with the admin's instruction cited.
- Q-3523 objects sink/float in the open world → `setGround` was never given the map's height → the ground-contact hard
  rule unmet in one lane → the bridge sets and clears it → setGround guard.
- Q-3524 gun never fires (#2526–#2530) → the playtest never pressed fire → an action the game is built around is never
  exercised → `fireProbe` (F, J, click) + kit counters, reported through the rule probes → `aGunThatNeverFiresIsCaught`
  (real browser; reverted-and-failed twice).
- Q-3525 "continue" turns refused (#2524 wrote nothing for 8 min; #2527–#2530) → the guard read the word "continue", and
  locked feature files nothing imports → a guard judging a continuation without what it continues → `growthRequestFor` at
  both locks + `featureInPlay` → `aContinueTurnFinishesTheGunItStarted` (reverted-and-failed).
- Q-3526 `<title>Continue the build from</title>` → named from this turn's message → an order about the build read as an
  app description → continued request + continuation names nothing + junk title is a placeholder → `aContinueMessageIsNeverTheAppName`.
- Q-3527 "game build clean hai" over PROD_BUILD_FAILED → the audit had no production-build fact → build-health claims
  unaudited → `prodBuildFailed` + BUILD_CLEAN → `aBuildCleanClaimOverAFailedBuildIsCorrected` (reverted-and-failed).
- Q-3528 lost builds carry no memory evidence → nothing recorded it before death → evidence must land before an OOM kill
  → SERVER_MEMORY_HIGH per band on the build tick → `aLostBuildShowsItsServersMemory`. Q-3354 stays 🟡 BLOCKED on Cloud Run logs; six more death times added.
- Q-3529, Q-3530: both proved TRUE by the reports (the "nothing written" line was accurate; the `.env` block was a real
  `sed … .env`) → 🟡 waiting for the admin's agreement to close as not-a-defect.
- Owned by other open PRs, deliberately not touched: kit typecheck errors (TS2352/TS2322 in openWorld.ts/worldLayer.ts) and
  kit-file refusals on continue turns (#4554 Q-3420, #4536), the Surplus 404 storm, dead-build sweep, handover (#4554).
- Queue ID note: this branch first used Q-3355/Q-3356 in code comments; those IDs are taken on main (failedbr #2499), so
  they were renumbered to Q-3520/Q-3521.

**Next, in the admin's order:** Q-3531 + Q-3532 (map variety, boundary/water), then Q-3533 (solid citizens, punch), then
Q-3534 (enterable houses, human citizens), then Q-3535 (library trees and animals).

### 2026-11-26 (same branch, #4562) — a character makes its own moves (Q-3536)
Admin, with a screenshot: *"mujhe aisa app maker chahiye jo movement khud bana le"*. Root cause: `findBones` matched exact
bone names only, so any other rig, and any model with no skeleton, got "It is not animated" instead of a move; a model
with no walk clip never walked. Class: a capability gated on one naming convention. Fix: `findBonesByShape` (skeleton
shape, names still win), `RIGID_MOVES` (whole-body punch/kick/fire/swing/throw/use), `MADE_GAIT` (walk/run made after a real
stand-in clip), one "animates its moves" line for a model with no clips. Builder line (`playerMoves.ts`), done message and
`AppKnowledgeBase` say the same. Old tests that encoded "a missing move is never animated" were updated, citing the admin.
Locked: `tests/aCharacterMakesItsOwnMoves.test.ts`. Still not made when missing: jump, swim, dive, block, hit, die, slide.
Also fixed on CI: openWorld.ts's `softwareRenderer` import kept on its own line (the no-GPU guard pins it).


## 2026-11-26 — Runner titles in 3D; each game its own town and race road; world races keep their length (PR #4561, Q-3314, Q-3373, Q-3450–Q-3455)

The admin approved three items.
- **Q-3314: "temple run / subway surfers jaisa".**
  - **Class:** two readers disagreed. The contract's `NAMED_KINDS` said 3D third-person, while the kit seed kept a private FPS-only list and laid the 2D kit.
  - **Fix:** `gameKitWants3D` reads `gameIntent.namesTitleDrawnIn3D` (one table), so these requests get the 3D kit and the lane-runner starter. A request that says 2D keeps 2D. AppKnowledgeBase was updated, and its claim that every runner starts from the ready game was corrected (Q-3454).
  - **Lock:** `tests/aRunnerTitleIsBuiltIn3D.test.ts`, with a census over every catalogue spelling. Reverted: 8 fail.
- **Q-3373: the action town and the race road.**
  - **Class:** the same as #4541: constants (`seed = 1`; map 1, land seed 11), in calls the builder writes.
  - **Fix:** the platform writes `src/game/gameSeed.ts` once, from `projectVariety`, only when the recipe call creates the town file or the race starter, and only ever adds to it. `createActionTown()` and `projectRoadPlan()` (start map plus land) read it by themselves. Older games keep the defaults. An untouched seed file counts as platform-seeded.
  - **Lock:** `tests/aGameStartsInItsOwnTownAndRoad.test.ts`. Four reversions, each fails.
- **World race length (Q-3450, admin: "keep races as long as before").**
  - **Measured on the real kit:** compact own-world routes went from 1.9–6.2 km before #4537 to 0.8–2.2 km after.
  - **Fix:** a route under 2 km (or under the `finishKm` asked) becomes laps of the tour: every highway out and back, so it stays on real roads, capped at 100 km.
  - **Siblings fixed in the same change:** the off-road straight links in the chain (Q-3451); a tracker that ran backwards on a road driven twice, now resolved by heading and then continuity (Q-3452); a "needs two places" message shown to a world that has two (Q-3453).
  - **Lock:** `tests/aWorldRaceKeepsItsLength.test.ts`. Reversions: 7, 3 and 2 tests fail.
- **Open:** Q-3455. Games already racing on their world keep their old `worldRace.ts` / `worldCourse.ts`, because nothing refreshes those two files.
- **Queue IDs:** started at Q-3450, because Q-3420–Q-3442 are taken by open PRs #4554 and #4555.
## 2026-11-26 — One bounded in-build placeholder repair (Q-3374) and the replay moved into the playtest phase (Q-3365)

- **Admin decision:** option (b) for Q-3374, "baaki sab build karo". Repair of measured game DEFECTS stays suspended (`gameRepair.ts` is unchanged in behaviour).
- **Why the old repair was suspended, and what answers it:** its way back was `collectWorkspaceFiles(...).files`, a best-effort text map that cannot undo a binary move or delete. New `gameWorkspaceBackup.ts` takes a tar of the whole project outside it plus a sha256 manifest. It refuses (no repair) on a special file, a control character in a name, a tree over 400 MB, too little space or any tar warning. The restore removes every non-directory, extracts, removes directories the repair created, and compares a fresh manifest with the backup's own fingerprint. Only `node_modules` and Vite's `*.timestamp-*.mjs` are outside it, by declaration.
- **The repair (`gamePlaceholderRepair.ts`, through `buildPhases/gamePlaytestPhase.ts`):** only when the placeholder look found ONLY `MISSING_MODEL` and/or `EMPTY_MAP`. One pass, file tools only (`onlyTheseTools` in `repairScope.ts` makes the runner refuse every other name), 120 s, 160,000 tokens, 8 steps, 12,000 output tokens per turn. Platform-paid: billing phase `game-repair` is added to the barren set before the first call. The game is played again; kept only if it has fewer stand-ins, no new kind, no new defect, no named feature lost and a score not lower. Otherwise every byte is put back and verified, the captured writes are restored exactly, and the store gets each touched file back (or forgets one the repair created). A restore that does not match is a warning, and the backup stays in the sandbox. Every outcome is one `GAME_PLACEHOLDER_REPAIR` line. Free tier: shares the explorer repair's daily allowance. Kill switch `AGENTV3_GAME_PLACEHOLDER_REPAIR=off` (ENV_REGISTRY).
- **Q-3365:** the route's repair `replay` closure is deleted. `replayGamePlaytest` runs the same `playIt` as the first play, with its report lines held and flushed only on keep (prefixed "Replay after the kept placeholder repair:"). So a kept repair re-records GAME_PROOF and the unverified-feature list. The route applies the first play and a kept replay through one `applyGamePlayed`, which deletes `gameFeaturesUnverified` when the replay proves them all. When no stand-in is left, a final GAME_PLACEHOLDERS "none left" line makes `placeholderRepairNote` hand the next turn nothing.
- **Tests:** `tests/aGameRepairCanAlwaysGoBack.test.ts` runs the real shell backup/restore on a real directory (binary move and delete, a 300 KB file a text map never saw, a mode change, a swapped symlink, new nested folders, and each refusal). `tests/aPlaceholderIsRepairedInTheBuild.test.ts` covers the judgement, caps (time, tokens), keep/undo/no-change/restore-unverified, a write outside the backup, the phase end to end (GAME_PROOF re-recorded on keep, nothing on discard, captured writes and store put back), and route source guards. The restore census (`anAutomaticRestoreReportsOnlyWhatItApplied`) classifies the new restore.
- **Opened by the sibling hunt (OPEN, not fixed here):** Q-3500 (`E2BActuator.checkpoint()` reports an id when tar failed; `restore()` is neither exact nor verified), Q-3501 (five live repairs still undo from the text map).
- **Watch on the next real game build with a missing model or a blank map:** the `GAME_PLACEHOLDER_REPAIR` line, and on a keep, a second GAME_PROOF prefixed with the replay note.
## 2026-11-26 — Game full screen: only the button, and it fills the screen (admin iPhone screenshot)

- Q-3440: `Game.play()` no longer goes full screen on a phone; the Full screen button is the only way in (builder prompt
  updated). Locked by a census (only Game.ts asks the browser; the only other caller is the button).
- Q-3441: root of the "two-thirds screen": `createRenderer` wrote the window size in px onto a canvas Game.ts sizes at 100%,
  and container-mode `handleResize` never touches the style, so the canvas never grew with its box. A page-sized canvas
  now keeps its style. Locked by running the real generated renderer.ts into a grown box.
- Q-3442 🟡: the HUD under the status bar inside the app's preview frame (iOS gives an iframe 0 safe-area insets) — needs
  the page to pass its insets in; recorded with a recommendation.
## 2026-11-26 — Q-3363: game proof pictures kept privately for 30 days, admin-only (#4557, not merged)

The admin approved option A. What changed:
- **Stored:** the playtest's start / moved / far JPEGs are copied out of the sandbox into the existing private workspace-asset bucket (`workspaceAssetBucketName`) under `game-proof-v1/<YYYY-MM-DD>/<buildId>/<view>-<id>.jpg` (`src/server/AgentV3/gameProofPictures.ts`). Each picture is checked first: a JPEG, at most 40 KB, at most 3 a build, and its bytes must hash to the id the playtest printed. The copy is bounded to 15 s. No new bucket, no ACL.
- **Expiry:** a delete-after sweep, not a bucket lifecycle rule, because the server does not change bucket configuration. The day folder is the expiry: the sweep deletes folders older than 30 days (at most every 6 h per instance), and the admin route refuses an expired key with 410.
- **Viewing:** `GET /api/admin/game-proof-picture?key=…` (`src/server/routes/gameProofPicturesAdmin.ts`) behind `verifyAdminToken`, streamed with `no-store`. Admin → Apps → "v" shows the latest build's pictures (`src/components/admin/GameProofPictures.tsx`).
- **Report:** GAME_PROOF's `looks.taken[].stored` holds each key, and the line says how many were kept, or why none were.
- **Kill switch:** `AGENTV3_GAME_PROOF_KEEP=off`.
- **Proof:** `tests/gameProofPicturesAreKeptPrivately.test.ts` (20 tests). Seven separate reversions each fail it: no admin middleware, no hash check, no size cap, no count cap, no path guard, no `stored` key, a shifted expiry.
- **Open:** Q-3410 (account erasure does not reach these pictures before the 30 days are up).
## 2026-11-26 — Asked-for enemies are put where the hero is, and the playtest proves they are on screen (Q-3401)

The admin reported: "jab user kahta hai yeh enemy bana, aur hero par enemy attack kare, to builder pura kam kar deta hai … par real game me enemies show hi nahi hote".

- **Evidence:** BR2519 ("Knight Boxer enemy show nahi ho rahe hai"). The builder said the enemies were visible and attacking.
  - Its enemies were hand-made: a custom GLTFLoader dressed bots of a `criminal-mobs` feature, around a fixed centre of a 1000-house city.
  - It wrote that it "could not test by playing". The playtest ran out of time while starting the game (Q-3332).
- **Earlier work, merged 2026-11-25 (#4532/#4533):** the kit already had `Entities`, which verifies each spawn: in the scene, at a finite position, with a visible body. The admin's game was built the day before.
- **Two gaps were still open:**
  1. Nothing PROVED that asked-for enemies are on screen. The played evidence covered score, level, sound, restart and a vehicle.
  2. There was no primitive to put characters where the hero is.
- **Fix:**
  - `Entities.spawnAround(n, spec, {near, far})` rings characters round the PLAYER, on the ground, at golden-angle spacing.
  - `window.__nbEntities` is a read-only list of live characters plus the player's position. It is added by the constructor and removed by `dispose`.
  - The playtest's existing placeholder page hook measures, with the game's own camera: hostiles alive, the nearest one's distance, and how many are in the frame.
  - `MISSING_ENEMIES` is said only when the contract asked for enemies. It fires when none is alive (with the failed-spawn count), when all are more than 60 m away and none is in view, or when the enemies are made outside Entities. It goes to the builder through the existing placeholder repair note.
  - The system prompt and the systems instructions say "enemies go where the hero is".
- **Proof:** `tests/enemiesAreWhereTheHeroIs.test.ts`, 8 tests, run on the real emitted kit and the real page hook. Each of three reversions made it fail: rings round the origin, no hook, no camera check. The related suites pass: 3906 tests in 164 files.
- **What it does NOT fix:**
  - A game the playtest never plays gets no page read (Q-3332, owned elsewhere).
  - The admin's existing city game keeps its hand-made enemies until a turn moves them onto Entities. With this change, the next turn's playtest says so, and the builder is told the fix.

## 2026-11-26 — Q-3402 (BR2532): a repair pass never breaks a file that was clean

- **Report:** admin, "isme game ban gaya par enemy aa hi nahi rahe". The game built, but no enemy appeared.
- **What happened:**
  - The builder wrote `src/game/features/monsters.ts`. The write-time typecheck said that file was clean, with 3 errors left in old kit files.
  - After the summary, the typecheck-gate repair pass was shown every written file and asked to fix those 3 errors. It rewrote `monsters.ts` with APIs that do not exist (`world.scene`, `controller.position`).
  - The re-check failed, and the pass's writes were kept. No monster reached the scene, and the production build named the monsters.ts errors.
  - The builder's summary blamed old kit files.
- **Root cause:** a model repair's writes were kept even when they made the project worse. The typecheck-gate pass reverted nothing. The agentic endgame reverted only when the TOTAL error count rose, so 3 errors fixed in one file plus 3 new ones in another passed.
- **Also:** the turn was an edit, and an edit turn records no game contract. So the playtest never looked for the asked-for enemies.
- **Fix:**
  - `repairBreakage.ts` holds one pure rule. A touched file that gained its first error goes back. A raised total puts back every touched file.
  - `buildPhases/typecheckGateRepair.ts` (moved out of the route) snapshots, writes, re-checks, puts back what the rule names, records `REPAIR_REVERTED`, and re-checks.
  - `EndgameRepair` applies the same per-file rule beside its count rule.
  - `asksForEnemies` (gameIntent.ts) reads enemies from the turn's own words (English, Hinglish, Hindi; a declined sentence and "chatbot" do not count). The playtest uses it when there is no contract.
- **Proof:** `tests/aRepairNeverBreaksACleanFile.test.ts`, 9 tests, replaying BR2532 on the real helper and the real endgame. Three reversions each made it fail: the rule, the endgame rule, the Hindi words. The related suites pass: 774 tests in 45 files.
- **Watch:** the next game edit that asks for enemies. `REPAIR_REVERTED` shows if a repair broke a file; `MISSING_ENEMIES` shows if none is on screen.
### 2026-11-26 — Q-3392: the online Royale daily match-start cap is shared across instances (PR #4559)

- **Problem:** the per-app daily cap (300) lived in each Cloud Run instance's memory, so N instances allowed N × 300 starts a day.
- **Root cause / class:** a quota that bounds NavBharatAI's own bill was counted in process memory. The other online caps are per instance on purpose (rooms live in one instance); this one is a daily total, so it needs one count.
- **Fix:** `matchService.ts` claims each start on a shared counter before the room opens (one claim per app at a time; the room is built from whoever is queued when the answer arrives). The counter is the durable limiter's own Firestore window — `DurableRateLimit.firestoreRateCounter` was extracted so `consumeDurableRate` and the Royale cap share one implementation (NavData's daily quota is inside a row-total transaction and is not reusable). One `rate_limits_v1` doc per app per UTC day; increment-then-read, so a boundary race refuses early and never lets a start through late; `expireAt` for the TTL policy (Q-809). No sharding: ≤300 accepted writes/app/day plus one refused write per instance per day ("full" is remembered).
- **Fallback (stated choice):** `consumeWithStore` now marks its fail-open result `unavailable`; an error or a 4 s timeout makes the start use the in-memory cap, logged at most every 5 min, never blocking play.
- **Tests:** `tests/theOnlineDailyCapIsSharedByEveryInstance.test.ts`. Reverted the claim line ⇒ 6/9 fail; reverted the `unavailable` flag ⇒ 3/9 fail; reverted the production wiring ⇒ 1/9 fails.
- **Open:** Q-3430 🟡 (fallback starts are not added to the shared count after an outage). Service still off by default (Q-3390); shared matchmaker still deferred (Q-3391, SCALE_PLAN §6).
## 2026-11-26 — Online Royale go-live and the shared matchmaker are deferred (admin)
- Admin, on Q-3390 (switch AGENTV3_ONLINE_MATCH / AGENTV3_ORIGINAL_ROYALE on) and Q-3391 (one matchmaker for every Cloud Run instance): "isko future ke liye yad rakho, mujhe yad dilana puchne par". Recorded in docs/claude/SCALE_PLAN.md §6 with its trigger: remind the admin when they ask; build/enable nothing until they say yes.

## 2026-11-26 — Failed builds #2523 / #2525: a dead build is found without waiting for the next one, and the next one is told what it did (PR #4575)
- **Q-3463:** `isAbandonedReport` (orphanedBuildReport.ts): silent for two heartbeat intervals AND the workspace lease answers `false` (an unknown `null` never settles). Two places check it: the client's status poll (`settleAbandonedReportsOnStatus`, at most once a minute per workspace per instance) and a two-minute exclusive sweep (`sweepAbandonedBuildReports`, server.ts). The sweep's collection-group index on `history.inProgress` is in firestore.indexes.json. Its deploy step may fail without holding a release, so a failing sweep logs once an hour and the status-poll path still works. `workspaceLeaseEnabled` moved into workspaceBuildLease.ts so the sweep stands down when the lease is off.
- **Q-3470:** `deadBuildHandoff.ts` takes the dead build's writes and its last typecheck from its saved report. `loadDeadBuildHandoff` reads them through the index-safe newest-refs reader and puts them in front of the prompt, before the conversation recap.
- **Test:** `tests/aDeadBuildIsFoundAndHandedOver.test.ts`, using #2525's own saved report as the fixture (`tests/fixtures/failedbr2525-dead-build-report.json`). Three reversions each fail it.
- **Q-3471 → 🟡 BLOCKED (admin decision):** assets and sounds download from one origin through a process-wide permit that refuses requests past one in the queue. That refusal is deliberate provider politeness, so running the two side by side would lose models and sounds when the cache is cold. The options are in the queue row; the recommendation is to let the permit queue a request for up to ~8 s.
### 2026-11-26 (same branch, #4562) — enemies in every open world (Q-3540…Q-3544)
Admin: *"kitna bhi prompt de! par open world game me enemy ban hi nahi rahe hai … enemy aye, fire kare, punch kare … sabhi
possible cause aur root cause dhundo"*. Evidence: the code, plus failedbr #2510–#2532 (9 reports read in full).
- Kit only on a NEW build; an "enemy banao" edit turn got nothing (#2510, #2514, #2518/#2519) → `enemiesTurn.ts` (Q-3540).
- `async setup()` → host ran update before the monsters existed (#2531) → the host waits for it (Q-3541).
- A throwing feature was silent → GAME_FEATURE_OFF from the playtest (Q-3542).
- Street enemies punch-only, slow to arrive, immune to the hero's gun → fill at once, gunmen fire visibly, the hero's shot hits (Q-3543).
- Enemy bodies hidden before their model loaded (#2518/#2519) → OPEN (Q-3544).
- Already fixed by #4560 (merged 11:32): enemies far from the hero (`spawnAround`), no on-screen enemy check
  (`window.__nbEntities`, MISSING_ENEMIES), a repair that rewrote a clean `monsters.ts` into a broken one (#2532).
- Also seen: a server loss before any enemy was written (#2520, Q-3354); a turn spent on an unrelated warning (#2511), now covered by the platform acting itself.


## 2026-11-26 — Failed builds #2523 / #2525: honest routing band, fall-back engine, fallback time, hero objects, test-file typecheck notes (PR #4570)
- **Q-3466:** `scoreBandVersusRouting` (RequestAnalyser.ts) is the one answer for the score's band and the routing verdict; COMPLEXITY_ROUTING (`complexityRoutingMessage`) and `requestAnalysis` (`routedAs`, `routedBy`, `bandOverriddenByRouting`) carry the same sentence when a model verdict overrides the band. `tests/theBandAndTheRoutingSayTheSameThing.test.ts` (reverted ⇒ 3 fail).
- **Q-3467:** SURPLUS_FALLBACK names the engine that runs next (the Weak chain's planned model, read once Surplus is dropped), never "the Weak ladder"; the admission fall-back line (sibling) names the chain. **Q-3465:** `addFallbackMs` (fallbackTime.ts) adds the seconds before the answer to `fallbackMs` in every retrying wrapper (Surplus fail-open, Surplus stay-alive, proChainV2, resilient runner). `tests/theTurnAfterSurplusSaysWhereAndHowLong.test.ts` (reverted ⇒ 6 fail).
- **Q-3468:** HUD and screen senses of catalogue words (score counter, leaderboard table, fire button, splash screen, text/hit box, first-/third-person) no longer become hero objects. `tests/aScoreCounterIsNotATable.test.ts` (#2523's prompt ⇒ only gun; reverted ⇒ 19 fail).
- **Q-3462:** the write-time typecheck and the `typecheck` tool say a test-file error blocks the release only when the release config compiles tests (`releaseBuildExcludesTests`, globs locked to the platform tsconfig.build.json). `tests/aTestFileErrorIsNotAReleaseBlocker.test.ts` (reverted ⇒ 2 fail).
- **Q-3464 → 🟡 BLOCKED (admin decision):** a provider-level Surplus breaker on a route-level 404; options and a recommendation (trip on the second distinct model's 404) in the queue row.
- **Still open from these reports:** Q-3463, Q-3470 (build liveness / hand-off) and Q-3471 (seed speed) — next PR; Q-3461 and Q-3469 stay 🟡 (admin decisions); Q-3460 closed by #4554.
## 2026-11-26 — Q-3410: deleting an account now deletes that user's game proof pictures (filed by verified owner)
- **Root cause:** #4557 filed the playtest's private proof pictures as `game-proof-v1/<day>/<buildId>/…`. The key named the build, not the owner, so DELETE /api/profile had nothing to search by and a deleted user's pictures lived out their 30 days.
- **Class:** a per-user bucket object keyed by something other than its owner (build id, token, upload id, content hash) is invisible to the account eraser.
- **Fix:** new pictures go to `game-proof-v2/<day>/<owner>/<buildId>/…`; `<owner>` is the build route's VERIFIED uid (`verified?.uid`, never `req.body.userId`), encoded by the new shared `verifiedOwnerKeySegment` (`workspaceAssetStorage.ts`; `workspaceAssetVerifiedOwnerPrefix` now uses it too). A build with no verified owner keeps no pictures and GAME_PROOF says why. `eraseUserProofPictures` (called by DELETE /api/profile before the sign-in is removed, reported as its own `gameProofPictures` line) deletes `game-proof-v2/<day>/<owner>/` in each day folder. The day stays first, so the 30-day sweep is still one delete per day; it now sweeps both layouts. Old v1 pictures cannot be attributed: they are still served to the admin and deleted by day 30, and the eraser reports that limitation while any remain. The admin view accepts both layouts.
- **Sibling hunt:** a census of every server module that touches Cloud Storage (`tests/accountDeletionReachesGameProofPictures.test.ts`). Each must say which eraser removes its objects, why they belong to nobody, or which queue row owns the gap. Three gaps found and recorded: Q-3611 (large share HTML `shares/<token>.html` orphaned when the `shares` docs are erased), Q-3612 (never-public App Store APK bytes left when the listing is deleted), Q-3613 (abandoned zip-upload chunks left when the `zip_uploads` record is erased).
- **The census paid for itself at once:** merging main brought #4564's `mobileBuild/nativeArtifactStore.ts` (owner-hashed native build files that no eraser deletes); the census failed until it was registered, and it is recorded as Q-3614.
- **Proof by reversion:** six reversions, each fails: eraser not called by the route (2 fail), eraser deletes whole day folders (1), key filed by build id only (7), route passes the claimed uid (2), admin view accepts only v1 (1), a new unregistered storage writer (1).

## 2026-11-26 — Moves separated from characters: 120+ moves on ANY character, plus NavBharatAI-made moves

**Admin task:** "sabhi characters ke moves ko character se alag kar do … sirf hero nahi kisi bhi character par … police /
villagers / bot", and "jo move library me nahi hai, NavBharatAI khud API call se bana sake".

- **Was:** library model clips belong to one rig (never retargeted); the data action system (2026-11-24) had 9 moves and
  played only on the player.
- **Library:** `src/server/lib/gameMoveLibrary.ts` — 120+ moves as data (shared pose pieces, mirrored sides), plus English /
  Hindi / Hinglish aliases. The kit gets the SAME library and alias table injected as JSON (the old kit copy of the alias
  table was a hand-typed duplicate of the server's — drift class removed; census test holds it).
- **Vocabulary v2** (`GameActionsGenerator.ts`): whole-body motion (rise / pitch / roll / yaw shown on a pivot; forward /
  side / turn real travel), `loop`, `hold`, `requires` (water, vehicle, seated, item), and world-touching steps: strike,
  push, fire, throw, enterVehicle, exitVehicle.
- **Any character:** `performAction(ctx, name, who?)` — no who = the player; a kind ('police', 'villagers'); 'all'; or one
  entity's object. `stopAction`, `currentAction(ctx, who)`, `heldItem(ctx, who)`. Entities expose `userData.actor` and stand
  still while acting; physics bodies take a strike as an impulse (`userData.onStruck`, removed only if physics installed it);
  the shell runs `updateActions` after every character has animated. The player's own model clip wins where it exists.
- **compose_action v2:** the prompt teaches the same vocabulary; the tool and the shell handoff say any character.
- **Tests:** `tests/anyCharacterDoesAnyMove.test.ts` (21, real kit) — reversion-proven for the actor hook, stand-still and
  the water rule. `theCharacterDoesWhatTheUserAsks` example of a missing move moved from "climb ladder" (now in the library)
  to juggling.
- **Honest limits:** data moves look simpler than hand-animated clips; humanoid bodies only (four-legged needs its own limb
  map); NPC library-model clips are not used (no mixer access) — they play the data pose.
- **Correction (same day):** NPC library-model clips ARE now used. `three/assetModels` exposes `root.userData.playRole`
  (the handle's `play`), and `play/actions.ts` plays an NPC model's own clip for a move it has (falling back to the data pose),
  returning it to `idle` after. The game's `handle.update(dt)` keeps advancing it. Locked in `anyCharacterDoesAnyMove`
  (reversion-proven). Remaining honest limits: data moves look simpler than clips; humanoid bodies only.
## 2026-11-26 — PR A of the admin's 18-point game list: restart, a gun that fires, drowning, the map's edge, library ids

- Q-3516 (was Q-3500; renumbered at merge — #4563 had taken it) Restart / Menu stand the player at the start (ctx.setRespawn; open world sets its own), out of any car.
- Q-3517 (was Q-3501; renumbered at merge — #4563 had taken it) A held gun fires: Attack becomes Fire, shots along ctx.aim, SHOT_HIT hurts Entities characters.
- Q-3502 Water drowns by default (WORLD.water), swimming only when asked.
- Q-3503 Every open world has an edge (WORLD.boundary): a wall past the farthest place, holding player and car.
- Q-3504 A Game Library pick inserts a mention at the cursor; the build reads it into the exact model.
- KIT_CONTRACT_BUDGET 13_000 → 13_100 for ctx.setRespawn.

## 2026-11-26 — PR B of the admin's 18-point game list: enemies in one step, a punch that lands, solid/hittable crowds, run-over, scope

Stacked on PR A (claude/game-play-fixes-a). Queue Q-3505..Q-3508.
- #4 enemies: GameEnemiesFeature.ts — the platform writes src/game/features/enemies.ts from the request and lists it (first open-world build via the seed; later turns via growthTurn.addEnemiesAtTurnStart). Root: the kit had every part of an enemy and nothing put them in a game; each request asked a model to assemble them by hand. The written file is compiled against the real kit in tests/enemiesComeWhenAsked.test.ts.
- #1 punch + crowd: the shell's punch emits PLAYER_PUNCHED; Entities hurt the first character in reach; city people gain solid/hittable (WORLD.citizens, only when asked).
- #18 run-over: WORLD.runOver (off by default) → VEHICLE_STRUCK.
- #14 scope: with a held gun, a Zoom button (Z) steps 1x/2x/4x/8x.
Remaining from the list: PR C (#2 enterable buildings, #7/8/11 vehicle ground census, #17 variety, #9 cinematic camera) and PR D (#10 multiplayer on the user's backend, #20 real-3D tier).

## 2026-11-26 — PR C of the admin's 18-point game list: camera shots the user describes (#9)

Stacked on PR B. Queue Q-3509 (fix in PR) and Q-3510..Q-3514 (still OPEN, honestly recorded — not started in this session):
- #9: play/cinematics.ts — shot lists as data, a Director in the render loop, DEATH_CAM / introDrone / HERO_SHOT, ctx.cinematic(list), GameOptions.cinematics from the request (cinematicsWanted), HUD bars and title, the end card waits, a tap skips.
- OPEN: #2 enterable painted-door city lots (Q-3510), #7/8/11 car ground census (Q-3511, not reproduced), #17 variety (Q-3512, mostly exists since 2026-11-25; blocked on which case the admin saw), #10 multiplayer on the user's backend (Q-3513), #20 realism tier (Q-3514).
- Note for the next session: PR A's open-world edge is separate from play/boundary.ts on purpose (it is in WORLD metres, follows the floating origin and grows with places; boundary.ts declares fixed render-space bounds). If they are ever unified, boundary.ts must learn the floating origin first.

## 2026-11-26 — Q-3515: the cricket bat meets the ball (admin)

Stacked on PR C. Roots: the timing windows (30/70 ms) were tighter than a phone's touch delay, and the kit had no play between the rules engine and the 3D layout (the arrival moment, the ball leaving the bat and the scoring were each game's own code; deliveryPath ran the ball through the batter). Fix: CRICKET_TIMING by difficulty, battedBallPath, createCricketPlay, and src/game/cricketRules.ts as the user's own rules file (changed by asking). tests/theBatMeetsTheBall.test.ts plays it on the real engine, proven by two reversions.

## 2026-11-26 — Q-3510 (#2): a city building opens when the user asks

Stacked on the cricket branch. city.openLot redraws one block without the lot's ground floors and stands a walk-in building (three/buildings.ts) there; WORLD.openBuildings opens the door the player walks up to. Each city block now draws from its own random stream (window tones per block change once, deterministically). tests/aCityBuildingOpensWhenAsked.test.ts.

## 2026-11-26 — Q-3511 (#7/#8/#11): a car follows the open world's ground between the places

Root: the Athree open world never registered its terrain with the kit's ground (getGround() null), so settleOnGround and groundScene did nothing there. createOpenWorld now calls setGround with the map's height through the floating origin. tests/aCarFollowsTheOpenWorldGround.test.ts (reverted → fails). Note: the first build of the #2 reader matched "open-world"/"khule maidan" in failedbr #2485's request; fixed on the #2 branch with that request as a fixture.
## 2026-11-26 — Game maker: the places the user named, fighting and tower-defense kits, a 50-game benchmark

Admin: "mujhe ek aisa game maker chahiye … sabhi prkar ke game … user jo bole wahi bane (village bole to city nahi)".
Honest scope: this PR builds what can be built and verified in the repo; the infrastructure items are recorded BLOCKED.

- **Q-3480 places:** `worldSetting.ts` — the named places and lands (mapGrowthIntent's vocabulary), counts, order, refusals.
  Houses/roads never turn a named village into a city; the open-world seed writes exactly those regions; a PLACES line
  travels into milestones. Real prompt locked: failedbr #2520 "ek gav(village) game banao".
- **Q-3481 genre kits:** `generate_genre_kits` — fighting.ts and towerDefense.ts (pure, 60 Hz, 2D or 3D), seeded by genre,
  named in the handoff, design doc, system prompt and AppKnowledgeBase. Tests play the generated files frame by frame.
- **Q-3482 benchmark:** `gameCoverage.ts` — 50 canonical games; today 22 of 50 get a starter / rules / genre kit, 28 are
  kit-only (the builder improvises), 0 fall out of the game path. Ratchet MAX_KIT_ONLY = 28, only down. Fixed on the way:
  ball sports read before shooters; Tekken / Street Fighter / Mortal Kombat in the shared title catalogue.
- **Open / blocked (rows in BUILD_REPORT_QUEUE.md):** Q-3483 runner 3D starter, Q-3484 GTA with a car gets no player,
  Q-3485 voxel kit, Q-3486 village drawn as a small town, Q-3487 GPU playtest, Q-3488 57 library subjects, Q-3489
  post-processing / IK / retargeting, Q-3490 general multiplayer, Q-3491 real-phone runs, Q-3492 playtest adapters,
  Q-3493 the 28 kit-only games. Auto-repair stays Q-3374.
- Q-3460 (kit typecheck, #4554) closed — merged.
## 2026-11-26 — Q-3380: one no-pointer-lock stub on every platform browser that sends input (#4568)
- **Problem:** a game that calls `requestPointerLock` floods a headless platform browser with synthetic input (108,052 messages in 3 s, 1–4 fps on #4552). #4553 stubbed it in the playtest's desktop context and the click explorer with two hand-written copies.
- **Class:** our checker's browser behaves unlike a person's browser, and the app is judged on it. The siblings #4553 never hunted were the playtest's phone context (it taps the canvas), journey pages, the sign-in context, and the Engineer AI shared CDP browser.
- **Fix:** `NO_POINTER_LOCK_INIT` and `noPointerLockInstall()` in `sandboxBrowserScript.ts` are the one source, installed on every page or context opened by every browser that sends input. The CDP browser also runs it on the document that is already open, because its context outlives each action script. Visit-only browsers (PageRouteCheck, mobileLayoutCheck, assetBrowserProof) are listed with a reason: Chromium refuses pointer lock without user activation.
- **Lock:** `tests/aPlaytestBrowserNeverLocksThePointer.test.ts` runs a source census and a generated-script census across 7 scripts. Proved by reversion: it failed when the journey install was removed, when the phone install was removed, when the old copied `clickExplorer.ts` was restored, and when a new browser file was added.

### 2026-11-26 (same branch, #4562) — an admin's App Mart pin is invisible to users
Admin, with a phone screenshot of App Mart's "Pinned by NavBharatAI" shelf: *"admin jis app ko pin kare users ko pata bhi nahi
lage … user ko naturally woh app top par show ho"*. Root cause: the public lists already put pinned apps first, and then also
sent `pinned` / `pinOrder` on every row, which NavAppStore drew as its own amber shelf. Now the order is the only trace: no pin
field in `/api/nav-store/apps` or the web-apps list (Newest and For You keep pinned first), no shelf, the same tile as every
app; the admin's Pin / Unpin is unchanged. Locked: `tests/anAdminPinIsInvisibleToUsers.test.ts` (reverted-and-failed).
## 2026-11-26 — Q-3514 (#20): real 3D graphics when the user asks

three/realism.ts (GameOptions.graphics 'real'): image-based lighting and soft shadows everywhere; GTAO + subtle bloom + output pass on a capable device only. Stacked on the car-ground branch. tests/realGraphicsWhenAsked.test.ts.

## 2026-11-26 — Q-3513 (#10): play with friends online on the user's own Supabase

three/rooms.ts: joinRoom on the user's Supabase Realtime (raw websocket, Phoenix protocol, no package), remotePlayers, showRoomNotice (RED line until VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are saved). The 3D handoff asks the builder to request the keys. Q-3490 (NavBharatAI-hosted rooms) is separate and stays open. tests/friendsPlayOnTheUsersOwnBackend.test.ts.
## 2026-11-26 — Admin Home "total revenue NOT real": the index was deployed to the wrong database (Q-3700)
- Admin screenshot: `9 FAILED_PRECONDITION: The query requires an index` for the revenue sum, although #4545's `deploy-firestore-indexes` step reports SUCCESS on every merge.
- Root cause: the index link names `databases/(default)` (103-byte encoded name), and so did an earlier production error; the server reads `(default)` (FIRESTORE_DATABASE_ID), but `firebase.json` deployed indexes only to `navbharat-prod`.
- Fix: `firebase.json` now lists both databases for `firestore.indexes.json`; rules still go only to `navbharat-prod`. Verified with firebase-tools 15.35.0's own config resolver that `--only firestore:indexes` targets both and `--only firestore:rules` deploys rules only where declared.
- Lock: `tests/adminAnalyticsFirestoreIndex.test.ts` (both databases carry the index; rules not widened); `firestoreIndexSafe.test.ts` reads the array form.
- Found on the way: `deploy-storage-rules` fails on every deploy (Q-3701, BLOCKED on the Cloud Build log).
## 2026-11-26 — "Made with NavBharatAI" was doubled on published apps, with no × (admin screenshot)

- **Root cause:** two modules each put a badge in the same bottom-right corner, at the same z-index: the build writes
  the "made by NavBharatAI" signature into the app's own index.html (`AgentV3/appSignature.ts`, has a × since 2026-09-30),
  and publishing stamped "Made with NavBharatAI" (`lib/madeWithBadge.ts`, no ×) on top of it — covering the signature's ×.
- **Fix (the class: two owners of one corner):** `injectBadge` removes the build's signature from the page it stamps
  (`withoutAppSignature`), so a published page carries ONE badge; the paid plan removes both. The publish badge gained the
  same CSS-only × (checkbox, `autocomplete="off"` — works under a strict CSP, back on refresh, nothing stored), the guard
  script respects a close and still re-shows a pill hidden by injected CSS, and the pill can shrink on a narrow phone.
- **Proof:** `tests/onePublishedBadgeThatCloses.test.ts` (9, reversion-proven: 4 fail without the dedupe); Chromium run of a
  real stamped page: one badge, × closes it, guard leaves it closed after 4 s, refresh restores it, injected CSS cannot hide it.
- **Limit (honest):** apps published BEFORE this change keep the old doubled badge until they are published again — the
  edge worker (`infra/cloudflare/mitrify-apps-worker.js`) serves stored files and is deployed by hand, so it was not changed.
## 2026-11-26 — Admin Apps → Built apps: sort and filter (admin: "be tarteeb hai, sort karne ka system banao")
- **Problem:** the list came newest-first only, with no way to see the oldest apps, only failed builds, or only paid/free users' apps.
- **Built:** Order (newest / oldest — a real Firestore `orderBy('savedAt', asc|desc)`), Last build (passed / failed / no result, read field-masked from the diagnostics store via `getBuildOutcomesMany`), Paid or free user (paid / free / admin / unknown), Live or not. Filters combine.
- **How a filtered page is found:** the facts live in three other collections, so the server reads apps in order in batches of 48 (at most 8 batches) and keeps matches. The reply says how many apps it looked at; the cursor resumes right after the last app examined — never skipping one it did not look at (`takeMatches`).
- **Honesty:** a build with no result is never counted as failed; an unknown account is never counted as free.
- **Sibling class fixed:** the paid/free tier was spelled out twice in `admin.ts` (build reports, All builds) and the apps list would have been a third copy → one `src/server/lib/identityTier.ts` (`tierOfIdentity`) used by all three.
- **Tests:** `tests/adminAppsSortAndFilter.test.ts` (10; reversion-proven: the cursor rule and unknown≠failed fail when broken). Re-pointed guards in `everyBuiltAppHasAPreview`, `paidUserFilter`, `BuiltAppsPanel.render`.
- Registry statuses (Banned / Held / Paused / Unpublished) keep their own list and ignore the other filters, with a note on screen.
## 2026-11-26 — queue: close Q-3363 and Q-3380 (resolved by merged PRs)
- Q-3363 (game proof pictures kept privately for 30 days, admin-only view) resolved by #4557, merged and live.
- Q-3380 (every platform browser that sends input installs one shared no-pointer-lock stub) resolved by #4568, merged.
- Rows deleted from `BUILD_REPORT_QUEUE.md`; IDs appended to `docs/claude/BUILD_REPORT_QUEUE_CLOSED.txt`.

## 2026-11-26 — Q-3560: a cricket game refused from App Mart as CSAM; flagged apps are now HELD for the admin (PR #4586)

- **Report (admin):** publishing a plain cricket game to App Mart gave *"This app was not published: it pairs words describing a child with explicitly sexual words."*
- **Root cause:** `classifyPublishedText` paired `subject` and `context` anywhere in the whole concatenated source. The game kit carries three.js `scene.children` and, in `GameShellGenerator.ts`, the comment "car control hardcore joystick…", so every game with the shell layer got CSAM_SIGNAL + ADULT_CONTENT. Three more recipes carried `children` + "explicit" and passed only because a protective word happened to stand the rule down.
- **Class:** whole-document co-occurrence of two word lists over source code is not evidence.
- **Fix:** `classifyPublishedFiles` pairs inside one phrase only (same file, same code statement, at most `PAIR_WINDOW` = 80 chars apart, no code identifiers via `isCodeToken`, no words ambiguous alone via `isAmbiguousWordAlone`), for every rule on the publish path. `scannableFiles` keeps the per-file text (one definition shared with `scannableText`).
- **Policy (admin 2026-11-26, "sex se sambandhit app publish apply ho jaye, admin ko saf saf bataya jaye … khud reject kar dega"):** a sexual/illegal text finding no longer refuses an App Mart publish. The app is saved `heldForReview`, unlisted, served only to owner and store admin (`webAppServableTo`, used by page, metadata, remix, report and social), with the file and matched phrase on the admin review card (red notice at the top). Listing releases it; Remove rejects it. The creator sees a neutral "held for review" message. Prompt triage, the malware/phishing rules and hosting are unchanged. `illegalRefusal` removed (no caller left). Recorded in `docs/claude/PRODUCT_POLICY_PRECEDENTS.md`; `AppKnowledgeBase.ts` updated.
- **Siblings:** every `ILLEGAL_RULES` rule shares the new pairing on the publish path; `CONTENT_RULES` already used bounded windows; `DeploymentStore` never ran the classifier. **Open sibling Q-3561 (🟡 decision):** prompt triage false-blocks "a cricket game for kids with a hardcore mode" and similar prompts; out of scope by instruction.
- **Accounts:** none marked. A refused publish saved nothing and logged only `STORE_PUBLISH_REFUSED`.
- **Lock:** `tests/aKitGameIsNotACrime.test.ts` (census of every recipe; failed 11 tests when whole-document pairing was restored) and the hold tests in `storePublishSafety.test.ts` (failed 4 when "illegal refuses" was restored).

### 2026-11-26 — after #4562 merged: main's broken city-people kit, and no second set of enemies
#4562 was merged from GitHub at its conflict-resolution commit, without the App Mart pin fix and the kit-history update, and
with two sessions' "people fall down" work merged into one file: `citypeople.ts` declared `DOWN_SECONDS` twice (6 and 4), so
the kit file did not compile — every new open world with city people broke. Fixed: one `DOWN_SECONDS` (6, the first session's).
Found in the same merge: a new GTA game whose user named enemies got BOTH the requested-enemies feature and street danger's
own enemies; `streetDangerSource({ ownEnemies })` now brings only bystanders and police then. Locked in
`tests/anOpenWorldHasStreetDanger.test.ts`; the kit typecheck test now passes apart from this container's missing cannon-es.
## 2026-11-26 — main red after the game stack merged: two sessions built the same crowd and features-list code

The game stack (#4578…#4584) and another session's street-danger work (e92a4949, "city people are solid and a punch knocks
one down") both added crowd knock-down and both learned to start a game's features list. The merge kept both: citypeople.ts
declared DOWN_SECONDS twice (6 and 4) — a parse error that failed every suite that writes the 3D kit — and
GAME_FEATURES_INDEX_WITH_DANGER stayed a hand-written copy of what the dispatcher now builds with featuresIndexWith.
Fix: one DOWN_SECONDS (6, every blow); GAME_FEATURES_INDEX_WITH_DANGER is derived from featuresIndexWith(GAME_FEATURES_INDEX,
'streetDanger'), so the dispatcher and the fixture cannot drift; the street-danger test asserts the dispatcher's real line.

## 2026-11-26 — Q-3561: innocent prompts were refused for a word that is innocent alone; Q-3560 closed (PR #4593)

- **Problem (measured on main):** prompt triage (build, chat, image) refused, finally, "a cricket game for kids with a hardcore mode" (CSAM_SIGNAL), "build a hardcore racing game app" and "Hardcore mode: watch the timer" (ADULT_CONTENT), and "school admission form: child name, child sex, date of birth" (CSAM_SIGNAL).
- **Root cause / class:** the shared rule lists hold words that are sexual only next to a sexual noun ("hardcore", "explicit") or not sexual at all as a form field ("sex:"). Q-3560 fixed this on the publish path only; prompt triage was its unhunted sibling.
- **Fix:** `triagePrompt` reads subject and context through `matchesUnambiguously` (the one `isAmbiguousWordAlone` rule both readers share). Prose keeps whole-message pairing; real pairs ("kids hardcore videos", "underage sex videos", every existing promptSafety / Hindi / every-Indian-script positive) still block, and a refusal stays final.
- **Honesty:** false blocks had been written to `safety_flags` (admin queue, 180 days; no strike system reads it). The admin safety queue now labels a row "False alarm: the current rules allow this message" when its own excerpt proves it (`flagWasOnlyAmbiguousWords`), and leaves it out of the per-account count. Records are not altered or deleted.
- **Lock:** `tests/anInnocentPromptIsNotRefused.test.ts`; reversion (restore `rule.subject.test(body)` / `rule.context.test(body)`) failed 7 tests.
- **Q-3560 closed:** #4586 merged (42f76c87); row deleted, ID added to `docs/claude/BUILD_REPORT_QUEUE_CLOSED.txt`.
## 2026-11-26 — Q-3611…Q-3614: account deletion now erases the bucket objects only a record could find (PR #4594)

The Q-3410 storage census (#4571) left four open exceptions — per-user Cloud Storage objects that outlived account
deletion because their key names a share token, a content hash or an upload id (or, for native builds, because no
eraser called the owner-derived folder). **Class:** an object filed for one user under a key that is not that user is
invisible to the account eraser, and `deleteUserData` erases the only record pointing at it.
- **Q-3611** share-link HTML: new pages filed `shares/<owner>/<token>.html` (verified owner); `eraseUserShareHtml`
  deletes that folder and each legacy page through its own record, before `deleteUserData`. Foreign pointers refused.
- **Q-3612** never-public APK: deleted before the listing through `navStoreApkObjects()`, kept when another listing
  names the same content-addressed object; a failed delete keeps the listing de-identified (`objectsNotConfirmed`).
  Sibling: the republish cleanup deleted the old APK even when another person's listing named it — now
  `deleteApkIfUnreferenced`.
- **Q-3613** zip-upload chunks: `eraseUserZipUploadChunks` (chunks, then record) + `sweepAbandonedZipUploads`
  (record gone or older than 48 h), started by `beginSharedUpload`.
- **Q-3614** native .apk/.aab: `eraseUserNativeArtifacts` stops running builds, then deletes `mobile-builds/<uid-hash>/`.
- Each eraser has its own response line in DELETE /api/profile; failures are failures. The census now requires all four.
- **Lock:** `tests/accountDeletionReachesRecordOnlyStorage.test.ts` — 16 reversions, each fails.
- **New rows:** Q-3702 (OPEN: native build job rows not erased; the collection census is blind to non-`*_COLLECTION`
  constants), Q-3703 (🟡 decision: delete a departing user's signing keys?), Q-3704 (OPEN: expired shares never purged).
## 2026-11-26 — failedbr #2549: police the user asks for are the kit's real police, put in by the platform

The kit's Dispatch (a police car with its siren drives in, officers get out) existed and no game used it; the builder hand-wrote
police five times in #2549's project. GamePoliceFeature.ts + addPoliceAtTurnStart write src/game/features/policeDispatch.ts on
the kit and list it (and on the first build); missing kit files are added. tests/policeComeWhenAsked.test.ts runs it on the real kit.

## 2026-11-26 — a car picked in the Game Library arrives in an open-world game (admin)

"Use as my car" refused in every game but the racing starter. carSwap.setLibraryCarAtTurnStart now writes
src/game/features/myCar.ts (GameMyCarFeature.ts) in a game on the kit's features list: the model added, drivable in front of the
player. tests/aLibraryCarArrivesInAnOpenWorld.test.ts.

## 2026-11-26 — Q-3702 + Q-3704: native build rows leave with the account, the collection census reads call receivers, expired shares are purged (PR #4602)

- **Queue:** #4594 merged, so Q-3611…Q-3614 are closed (deleted, IDs registered).
- **Q-3702, the census's class:** `everyCollectionIsClassified` read only `<identifier>.collection(…)`. Any store
  reached through a call, a cast or optional chaining (`db().collection(BUILDS)`) was skipped in silence, so the
  three native-build collections had no classification. Form 5 reads every receiver shape or demands a declared
  reason; witnesses lock it. Sibling found by it: the `blocked`-row id check (`Q-\d{3}\b`) refused every four-digit
  queue id.
- **Q-3702, the data:** `mobile_native_builds` is erased by `userId` after its files; the runner deletes a file it saved
  for a row that is gone or already final (never charged). Signing keys stay `blocked` on Q-3703 (admin decision).
- **Q-3704:** `purgeExpiredShares` — 30 days past expiry, page → feedback → record, bounded at 200 per run, a failure
  keeps the record; daily `expired-share-purge` under `DATA_RETENTION_PURGE_ENABLED`.
- **Lock:** `tests/nativeRowsAndExpiredShares.test.ts`, census witnesses, two runner cases — 9 reversions, each fails.

## 2026-11-27 — Game maker vs the reference game: Kadam 1–6, first slice (#4595–#4600, all merged)

The admin compared a reference game (single-file WebGL open world, two prompts, screenshot-checked after every step) with
NavBharatAI's game maker and asked for a 6-step plan, then "bina ruke sabhi kaam karo, PR bana kar merge karo". Merged:
- **#4595 (Kadam 1)** — a slow game is still played. Measured on a 6 fps WebGL page: 7 picture compares took 40.9 s of the
  63 s keyboard stage because each decoded two PNGs INSIDE the game's page (BR2539/2540/2542/2545 "never played"). All
  picture work now runs on a separate bench page; the phone context draws at DPR 1. Keyboard 63→29 s, start 17.4→5.8 s, the
  phone stage is reached. Census `aSlowGameIsStillPlayed` (browser proof opt-in `NBAI_BROWSER_PERF=1`). Also: the
  street-danger compile test got its own 120 s timeout + census `aKitCompileTestHasItsOwnTimeout` (it timed out in CI).
- **#4596 (Kadam 2)** — `PLAYER.holds` was silently dropped for the kit person (the default body) and after a model failed
  to load (BR2535). One loader `holdChosen()` for every body; `window.__nbHeld()` records what is really in a hand.
- **#4597 (Kadam 2)** — what the request asked for is proved by playing: `asksForHeldItem`, `MISSING_HELD`, and
  `MISSING_ENEMIES`/`MISSING_HELD` → `GAME_DEFECT_ASK_NOT_MET`, which the completion gate reads ("what you asked for is not
  in the game yet").
- **#4598 (Kadam 6)** — the game bench counts `ask-not-met` and carries the realistic cricket prompt (45 prompts, 15 smoke).
- **#4599 (Kadam 3)** — the project map names the game's own files (those importing the kit) and what they export.
- **#4600 (Kadam 4)** — `ENTITY_BALANCE`: at most 3 attackers at once, 2 s grace after spawning (six enemies used to kill
  the hero in 2 s).

**OPEN (not done, recorded so nothing is lost):**
- Kadam 1: an in-game scene control for the playtest, per-genre photo lists, and a vision judge (each judged photo is a
  paid call → needs the admin's billing decision).
- Kadam 3: the kit's left/right is mirrored (humanoid `right = arm(1)` is +X; a +Z-facing figure's right is −X;
  `cricketLayout.side`, `deliveryPath` line and `leftHanded` follow it; the cricket test comment encodes it). Builders
  patched games locally (#2543), so flipping the kit through KIT_REFRESHED would re-break those games — needs a migration
  path first. Also the batter's side-on stance (needs a new bat swing) and model orientation/height normalisation review.
- Kadam 4: enemy-visibility kit (markers, hit-direction arrows, tracers, stereo pan) and the camera kit.
- Kadam 5: a stronger planner/judge model for hard game edits — the admin's money decision.
- Kadam 6: running the game bench on a schedule spends real money — the admin's decision.

### 2026-11-27 — Queue: Q-3561, Q-3702, Q-3704 closed
- #4601 (prompt triage precision, Q-3561) and #4602 (native build rows erased with the account, census reads call receivers, expired shares purged — Q-3702, Q-3704) merged and deployed (Cloud Build succeeded for 07d70213 and 4ce04b96). Rows deleted from `BUILD_REPORT_QUEUE.md`; IDs appended to `docs/claude/BUILD_REPORT_QUEUE_CLOSED.txt`.
- Watch on the next real runs: `[share-purge]` log line daily at 03:25 UTC (needs `DATA_RETENTION_PURGE_ENABLED=on`); admin safety flags labelled "False alarm" for prompts the current rules allow.

## 2026-11-27 — Autopsy of failedbr #2555 (8b4e7f6b) — Q-3720…Q-3728
New build, mini tier, STOPPED at 7.9 min by the wallet guard (provisional ₹126.14 > balance ₹93.63; final bill ₹0, real $0.37).
Ledger: 4 workarounds (GLM 150 s reasoning-only, KIMI 429 no balance, three ENGINE_DT benched), 1 shipped-broken stop, 1 skip
(the styles turn cut), struggles (two silences of 164 s and 186 s; 64% of the clock on calls that returned nothing).
- Q-3720 RESOLVED in this branch: design 100/A beside 47 unstyled classes → `withUnstyledClasses`.
- Q-3721 (offensive-hacking prompt untriaged), Q-3722 (wallet guard prices the markup before any preview; estimate ignores the
  fallback rung) — admin decisions, options and recommendations in the queue rows.
- Recurrences, still blocked: Q-3724 = Q-1121 (150 s reasoning-only), Q-3725 = Q-1210 (KIMI balance), Q-3723 ≈ Q-2306 (a route
  outside the declared ladder); Q-3726 ENGINE_DT silence (external).
- Q-3727, Q-3728: not defects, with evidence — waiting for the admin's agreement.

### 2026-11-27 (later) — the admin's two #2555 decisions, built (#4607)
- Q-3721: `cyberIntrusionRule.ts` — prompts to break into other people's systems are refused at the prompt (prompt-only rule).
- Q-3722: `walletSpendLimitInr` — a build may start and run while its estimate / running bill is within 120% of a positive balance;
  no balance, no build. #2555's own stop (₹126.14 > ₹112.36) would still happen; the before-preview real-cost idea is undecided.


### 2026-11-27 — the map planner ("naksha banane wala dimaag") and the robot checks (admin's map order, wave 1 part 1)
- **What:** `src/server/lib/athreeMap/mapPlan.ts` — ONE pure reader turns the request (English / Hinglish / Devanagari input) into a
  nine-field MapPlan: area km² ("5 km" = side → 25 km²; "5 km²/sq km/varg km" = area), archetype, boundary
  (`sea|mountains|canyon|forest-river|dunes|wall`, from "se ghira / surrounded by", else per archetype), water
  (`{sea, rivers, lakes, ponds, canals}` with counts, or refused), roadStyle (`grid|highway|organic|hill|straight`, default grid),
  density (`sparse|normal|dense`), region flavour (Rajasthan, Kerala, Mumbai, Goa, Himalaya, Ladakh, Sundarbans, Punjab, Deccan,
  North-East), game type, time of day.
- **Defaults (admin-approved):** on foot / shooter / RPG 5 km², driving / racing 25 km², flight 100 km²; battle royale keeps its 8 km
  island; a game that needs roads (circuit, runway) is raised to the world's own `MIN_ROAD_SIZE` (read from the emitted world source,
  so it follows when small-map roads land); the user's stated size ALWAYS wins, over the builder's `size_km` too.
- **Wired:** `generate_athree_map` (ToolDispatcher) uses the planner instead of `mapChoiceFor` / `sizeKmIn` / builder picking.
  `mapPlanWiring.ts` (additive; AthreeMapGenerator.ts untouched because #4608/#4612 are on it) appends `MAP_PLAN` to config.ts and
  `Object.assign(MAP_OPTIONS, {areaKm2, boundary, water, roadStyle, density})` — the shared option names reach createAthreeWorld
  through the existing spread and are ignored until the world reads them. The build note says per layer APPLIED vs "recorded, not
  built yet", decided by reading the emitted world source (`appliedMapLayers`), never assumed.
- **Robot checks:** `athreeMapCheckSource.ts` emitted as `src/game/athree/mapChecks.ts` (spawn on dry land, no lot in water or on a
  road, road graph connected, nothing below ground, bounded boundary ring closed; `publishMapChecks` leaves `window.__nbMapChecks`).
  `mapRobotRun.ts` runs the SAME emitted code at build time on the generated files (seed 1) in a WORKER THREAD with an 8 s budget
  (a 500 km world costs ~2 s of CPU; never on the main thread) and puts the verdict in the build note; a crash or timeout reads
  "could not run", never a pass. `tests/helpers/loadAthree.ts` now delegates to the same loader.
- **Superseded test expectation:** `theAthreeMapKindsAreWired` — an unsized racing request is no longer the 100 km default world; it is
  the racing default raised to the 20 km road floor (admin-approved defaults).
- **Honest limits / open:** boundary, water wishes, road style and density are passed but NOT consumed by the world yet (wave 1 agents
  W and R build them; the notes flip to APPLIED by themselves). Time of day is only an instruction to the builder (skyOptions.hours).
  The playtest does not yet read `window.__nbMapChecks` into its findings. Lots-clear has no lots to check until the colonies layer
  exists. The racing/flight defaults are 400 km² today because roads need 20 km — they shrink when small-map roads land.

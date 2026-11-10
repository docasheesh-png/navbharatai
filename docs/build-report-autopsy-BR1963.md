# BR1963 — a succeeded India-map game, seeded into a recovered workspace that had no React starter

Scope: BR1963 only, inside the frozen audit boundary 1951..2105. Branched from `3dcb409daf9e2656cbc00c620e10fa1416ec1c98` (the #4148 squash-merge of exact BR1962 head `1c106e1ef`, which is origin/main at branch creation). The parent reviews and merges this PR; BR1964 is not started. Nothing was replayed, deployed or reconfigured; no provider was called, and no autopsy was written to a remote service (`get_failed_build_autopsy` returns "Failed report not found" for a succeeded build).

This report's preventable gaps are already on main: #4132 (BR1958 F2, `prepareGameSeedWorkspace`, merged 2026-11-09 08:32:57 IST — the day AFTER this build) and #4146 (BR1961 F2, `sandboxUnavailableNotice`). This PR does not change a production heuristic or classifier (no opposite-class corpus required). It neighbour-locks those shipped gates against this prompt, closes the two #4148 rows that merge resolved (Q-2623, Q-2624), and queues the five #4148 reviewer residuals.

## Identity and evidence
- Prompt: **"Build a game with indian map"**.
- Outcome **succeeded** (ok=true). Root cause recorded: the build completed; 2 unresolved items (DEPENDENCY_VULNERABILITIES, RELEASE_GATE) are advisories that cannot name a cause. Model qwen3-coder (SURPLUS), weak (free) tier, vite-react. **Not charged** (free tier). Sandbox cost $0.033304.
- Build `eb4d3d0f-31c6-4633-b437-e1923a3d02be`, workspace `agentv3-xVU22DMl2gM8pQpS1BjUL0o3Gyg1-e9c055b0-eaa7-4dec-9d39-da51c77fa7fc`, history `1794109241939`, session `e9c055b0-eaa7-4dec-9d39-da51c77fa7fc`, report digest `3591cb9764eef8e76f8ad65bf37aaff64f74603a1433b97c31da24720f060f67`, promptHash `56f4e91f`.
- Started **2026-11-08 09:10:41.939 IST**, ended **09:22:54.643 IST** (732.7 s / 12.2 min). User-wait 30001 ms (the unanswered bug-hunt offer). ETA shown 9.0–17.3 min (midpoint 10.2 min, game/platform); actual 702.7 s landed **inside** the band (not counting the 0.5 min wait).
- 301 issue entries (report count 300), 3 errors, 5 warnings, 6 auto-resolved, 2 unresolved, 10 commands, 57 model calls (SURPLUS / qwen3-coder). Indexed in [the evidence file](build-report-autopsy-BR1963-evidence.json).
- Request analysis: `simple_app`, complexity 15, startTier gemini / cheapest band; Surplus admitted. APP_SCOPE: ordinary one-shot, no mega-signal (correct for this short prompt).
- Original retained report bytes sha256 `d618270eae151b9fccbb17de8b41c950cee41300d90d57f193a2872ce104add5` (matches the fetch asset name). Pretty-printed copy sha256 `914a7cdd585503fabfff074d282154bf9a2673d5d737034245c8d143a3e0ecda`. Digest matches the list_build_reports value.

## Five buckets (report-backed)
2 already-fixed classes locked here (D04 notice, D05/D06 starter-less seed + missing events.ts) · 4 blocked siblings (D03 cap, D07 vite pin, D08 plan-only turns, D09 unrun tests) · 5 #4148 residuals queued (Q-2625…Q-2629) · the rest not-a-defect / context / already-correct.

## What happened (IST)
1. **09:10:41.** REQUIREMENT_GAPS: domain=game, 8 likely-missing features, 4 clarifying questions assumed as defaults (win/lose, scoring, difficulty curve, save, touch, sound, pause/restart, tutorial). APP_SCOPE: ordinary one-shot, no mega-signal (**D01**, correct). Complexity simple 15; Surplus / qwen3-coder.
2. **09:10:43.** SANDBOX_UNAVAILABLE: E2B "maximum number of concurrent E2B sandboxes (20)" (**D03**, sibling of Q-2621 / Q-2567). AGENT_NOTE used the pre-#4146 goodbye: *"I can't create files right now … please try building again in a little while."* (**D04**; already fixed by BR1961 F2). Planning continued.
3. **09:10:47–09:11:00.** GAME_KIT_SEEDED: `generate_game_runtime`, `generate_game_vfx`, `generate_melody` (7 files, 12.9 s). FAST_LANE_SKIPPED_GAME (by design). The 7 files that later appeared on disk were `state.ts` + `meta.ts` + two VFX audio files + three melody files — **not** loop/input/events/pool/feel (**D06**).
4. **09:12:00.** `ls -la` of the workspace root showed **only `src/`** (C00). No `package.json`, `tsconfig.json`, or `index.html`. `ls src/` showed `App.tsx`, `audio/`, `game/`. The recovered machine came up created-fresh without the vite-react starter (**D05**; BR1958 / Q-2567 class). Write-time typecheck later said: *"never ran although 14 TypeScript write(s) happened — no tsconfig.json was found, so the project is not TypeScript"* (I253).
5. **09:11:50.** TOOL_ERROR reading `src/index.css` (does not exist). The model bootstrapped the project itself (`npm install` at 09:15:37).
6. **09:15:40.** DEPENDENCY_VULNERABILITIES: 2 known vulns (1 high, 1 moderate) after `npm audit fix` exited 1. Remaining pin is vite@4.5.14 (OSV lists 12 advisories). Compatible fixes applied; majors left for the user (**D07**, sibling of Q-2362).
7. **09:16:41.** First `tsc --noEmit` failed: missing `./events` (from `state.ts`), and `--jsx` is not set on `src/main.tsx` / `src/App.tsx`. The model created a stub events file; the second `tsc` then reported TS2322/TS2349 in `meta.ts` (void vs `() => void` at lines 296–302 and 525) — the stub's `on()` did not return an unsubscribe. An `edit_file` of `meta.ts` missed `old_string`. The model abandoned the kit: *"create a complete standalone game without relying on the complex game engine"* (**D06** cascade).
8. **09:19:57.** `tsc --noEmit` exit 0 after the standalone rewrite. Preview already up from 09:16:00. Click explorer: Start Game + Chennai + Kolkata markers responded (EXPLORE_PASSED). Phone layout OK. No form journey (JOURNEY_NOT_DERIVED — expected; the explorer is the substitute) (**D10**).
9. **09:22:17.** RELEASE_GATE YELLOW because of the two leftover dependency advisories (**D07**). BUG_HUNT_NOT_RUN: offer unanswered (**D11**, the 30 s user-wait). TODO_ONLY_TURNS: 2 plan-only turns, 21.3 s, one after the existing hand-back (**D08**, sibling of Q-2375). SANDBOX_RECOVERED: setup failed at first, then served the build. Delivered as "India Map Explorer" (city-click quiz, 60-second rounds, high scores) — a reasonable one-shot reading of the prompt.
10. Final CHANGE_RECORDED: new-app/standard, status **partial**, gate YELLOW, ISS-001 open (the vulns).

## Prevention classes in this PR
| Fix | Class | Where | Locks |
|---|---|---|---|
| F1 | Neighbour lock only (no production change). This prompt stays a 2D game-kit plan with a full runtime that includes `events.ts`, even if `include` is `['meta']`. Scope stays ordinary/direct. A recovered workspace without `package.json` still cannot seed recipes (`prepareGameSeedWorkspace`). The unavailable notice no longer uses this report's "please try building again in a little while" goodbye. | existing `gameKitSeed.ts` / `GameRuntimeGenerator.ts` / `gameSeedWorkspace.ts` / `sandboxUnavailableNotice` | `tests/anIndiaMapGameStillGetsItsKit.test.ts` |

## Side-effect review (owner rule t311u: no fix may create another problem)
| Fix | Adjacent behaviour checked | Side-effect risk | Decision |
|---|---|---|---|
| F1 | No production heuristic or classifier is edited. Tests only lock already-shipped behaviour: 2D plan for this prompt (not 3D — "indian map" must not trip `DRAWN_IN_3D`); default runtime still has all seven modules; `generateGameRuntime(['state'])` already pulled events (existing test) and `['meta']` now does too; `prepareGameSeedWorkspace` still recovers-once / blocks on missing manifest (BR1958 suite); `youtube` / shop-ERP / quality-checklist neighbours are untouched. Residuals that would change `isQualityAcceptanceLine` or `CLEARLY_SMALL` were queued, not implemented. | **None from production code** (none changed). Tests fail closed if a future change drops events.ts from a meta-only include, 3D-seeds this prompt, invites a retry, or seeds recipes without a React manifest. | Kept as neighbour locks |

## Every item
| ID / queue | Origin / bucket | Problem | State |
|---|---|---|---|
| D01 | report / not-a-defect | APP_SCOPE ordinary one-shot, no mega-signal, for a 5-word game ask. | Correct (locked by F1) |
| D02 | report / not-a-defect | REQUIREMENT_GAPS assumed 8 game defaults and 4 questions. Most were delivered (timer end, scoring, difficulty, save, touch, sound). | Not a defect |
| D03 / Q-2621, Q-2567 | report / blocked | E2B concurrent cap of 20. Later SANDBOX_RECOVERED. | BLOCKED (ops/capacity). No retry loop added. |
| D04 | report / already-fixed | AGENT_NOTE invited "try building again in a little while" while recovery continued. | Already fixed by #4146 F2; locked by F1. Sibling of closed Q-2619. |
| D05 / Q-2567 | report / already-fixed | Recovered created-fresh workspace had no React starter (`ls` = only `src/`; no tsconfig; write-time typecheck stood down; missing `index.css`; `--jsx` not set). | Already fixed by #4132 F2 (`prepareGameSeedWorkspace`); locked by F1. Historical sibling of Q-2567 (starter not restored). This build predates that merge by one day. |
| D06 | report / already-fixed (consequence of D05) | Kit on disk lacked `events.ts`; stub `on()` returned void; `meta.ts` TS2322/TS2349; builder abandoned the kit. | Current `generateGameRuntime(['meta'])` pulls `state.ts` and `events.ts`. Locked by F1. |
| D07 / Q-2362 | report / blocked | vite@4.5.14 left with advisories after `npm audit fix` exited 1 (breaking fix would be vite 8.x). Drives RELEASE_GATE YELLOW and ISS-001. | BLOCKED (major-upgrade policy). Sibling of Q-2362. |
| D08 / Q-2375 | report / blocked | 2 plan-only turns (21.3 s); 1 after the existing hand-back. | Sibling of Q-2375. Not re-prompted here. |
| D09 / Q-107, Q-2368 | report / blocked | STARTER_TESTS_SKIPPED (no vitest); E2E scaffolded but TEST_SUITE_UNVERIFIED. | Existing test-runner debt. Not re-opened. |
| D10 | report / not-a-defect | JOURNEY_NOT_DERIVED: buttons, no form. Click explorer pressed 3 controls. | Covered by design (not Q-2616's compute-journey; this is a game). |
| D11 | report / not-a-defect | BUG_HUNT_NOT_RUN: offer unanswered (30 s user-wait). | Expected. |
| D12 | report / not-a-defect | ETA inside the shown 9.0–17.3 min band. | Not a defect. |
| R1 / Q-2625 | #4148 review / residual | Hindi quality-checklist lines still count (English-only patterns; same as main). | Queued, not fixed. |
| R2 / Q-2626 | #4148 review / residual | "Handling errors" gerund does not match `Handle(?:s|ing)?` (English drops the e). | Queued. Verified live gap: "Handle errors." matches; "Handling errors" does not. |
| R3 / Q-2627 | #4148 review / residual | Trailing `!` / ellipsis vs `\.?$`. | Queued. Verified: "Handle errors!" and "All tests pass!" do not match. |
| R4 / Q-2628 | #4148 review / residual | `Don't fake (data\|results) .*` greed. | Queued. Verified: longer product sentences currently match. |
| R5 / Q-2629 | #4148 review / residual | timer/clock CLEARLY_SMALL suppresses a feature-count mega signal on an 8-item support-ticket list. Pre-existing main behaviour. | Queued, not fixed. |

## Queue
- This commit closes the two BR1962 rows that #4148's merge resolved (Q-2623, Q-2624) and appends them to the closed register.
- The three BR1961 blockers (Q-2620, Q-2621, Q-2622) stay open, owner `#4146 MERGED (568beed6c); blocker retained`.
- All earlier debt stays as it was, including Q-2371, the PR4109 ownership row, the BR1958 blockers (Q-2567, Q-2587, Q-2588, Q-2589), Q-2608/2610/2611, and the BR1960 blockers Q-2615/2616/2617.
- New rows are Q-2625…Q-2629 (#4148 residuals, all 🟡 blocked / queued, not implemented).

# BR1966 — a succeeded “Pura gta5 wala game banaa do”

Scope: BR1966 only, inside the frozen audit boundary 1951..2105. Branched from `75681b3e5a0d642ef8718656257b25df812aecf1` (the #4151 squash-merge of exact BR1965 head `274ee2c38`, which is origin/main at branch creation). The parent reviews and merges this PR; BR1967 is not started. Nothing was replayed, deployed or reconfigured; no provider was called, and no autopsy was written to a remote service (`get_failed_build_autopsy` returns "Failed report not found in retained storage" for a succeeded build). Other PRs for admin Test Chat Bot and gift-removal may land in parallel; this branch integrates them by ordinary merge only if needed, never rebase or force-push.

The production follow-up is a tight GTA-title morphology: glued `gta5` / `GTA5` / `gtav` / `gta-5` / `gta_5` are the same title as spaced `gta 5`, which already cloned GTA, seeded the 3D kit and chose the real-objects tier. An opposite-class adversarial corpus of 167 prompts (ordinary apps, prior-BR neighbours, already-matching spaced GTA forms, lookalikes such as `gta50` / `gta5cheats` / `gtable`, games that must keep their current 2D or 3D reading, tool mentions, and realism false positives) was built **before** the production edit and showed **0 field changes**: 0 smaller→LARGE, 0 newly `famousApp=GTA`, 0 newly `wants3D`, 0 lite→real. This report's prompt now matches its spaced twin.

This does not claim that an AAA GTA clone can be delivered. The honest path is the one spaced `gta 5` already takes: escalate as a famous-app clone and seed the existing 3D kit. `gamePlannerCapability` already tells the builder not to promise a full commercial-game copy.

## Identity and evidence
- Prompt: **"Pura gta5 wala game banaa do"**
- Outcome **succeeded** (`ok=true`). Root cause recorded: the build completed; the most severe leftover against the app is `GAME_PLAYTEST_NOT_RUN` (no canvas and no start-game control). Model qwen3-coder (SURPLUS), weak (free) tier, vite-react. **Charged** ₹2.14 (`billedUsd` 0.022703, `walletDebited` true, `walletTokensDebited` 213). Sandbox cost $0.029026.
- Build `85d34ea7-1215-46b4-890c-16653798db63`, workspace `agentv3-nAFHwwuJq9e2LQ5jdmkatWq4VMy2-5928cf50-0cec-4c37-8295-08bf722c68af`, history `1794109453597`, session `5928cf50-0cec-4c37-8295-08bf722c68af`, report digest `949fe0c07e1242f661f99ed3be821f6d2e4591d606c05afa31b977c8d4eb9bf9`, promptHash `086309e1`.
- Started **2026-11-08 09:14:13.597 IST**, ended **09:24:46.814 IST** (633.217 s / 10.55 min). User-wait 30000 ms (the unanswered deep bug-hunt offer). ETA shown 9.0–17.3 min (midpoint 10.2 min, key `game`, evidenced, 26 recent game builds); actual 603.217 s landed **inside** the band (not counting the 0.5 min wait; ratio 0.988).
- 248 issue entries (report count 247), 0 errors, 4 warnings, 0 auto-resolved, 0 leftOpen, 4 unresolved (the four warnings), 16 commands, 35 model calls (SURPLUS / qwen3-coder; provider tokens in 1,889,287 / out 11,611 / cache-read 1,645,136). Indexed in [the evidence file](build-report-autopsy-BR1966-evidence.json).
- Request analysis: `simple_app`, complexity 15, startTier gemini / cheapest band; Weak ladder opened on the second rung; Surplus admitted. APP_SCOPE: ordinary one-shot, no mega-signal (**D01** — the preventable miss). PROJECT_MODE on; this prompt is not a mega-project (0 enumerated parts).
- Original retained report bytes sha256 `3b82d54a4168ecde73b8146ec621eb333a2656a37ecaae115288b00c3db24c52` (103373 bytes; matches the fetch asset name). Pretty-printed copy sha256 `b151276f4e7bb552da305d5dc7c77374b81b6bcb1f6b8eef98f877c54d6de45b` (124038 bytes). Digest matches the list_build_reports value.

## Five buckets (report-backed)
1 production classifier follow-up shipped after a passing opposite-class corpus (glued GTA titles) · neighbour locks of this prompt, its spaced twin, the BR1955 fixture, the India-map 2D neighbour, lookalikes, companion/tool phrases, and the existing `game-claimed-playable` detector · 2 queued residuals of this report (canvas-less DOM playtest; long-name "grand theft auto" still 2D/lite) · the rest not-a-defect / designed / existing siblings.

## What happened (IST, 2026-11-08)
1. **09:14:13.** FREE_BUILD_TIME_CAP: 25 min free (a paid build would get 29 min). REQUIREMENT_GAPS: domain=game, 8 likely-missing defaults (win/lose, scoring, difficulty, save, touch, sound, pause/restart, tutorial). APP_SCOPE ordinary one-shot, no mega-signal (**D01**). Complexity COMPLEX 15; Surplus / qwen3-coder.
2. **09:14:13.** ETA ~9–17 min (midpoint ~10 min, 26 recent game builds, confidence 0.77). No sign-in words; the builder was told to add no login.
3. **09:14:20.** PROJECT_MODE: Software Project Mode is ON; this prompt is not a mega-project — normal path (**D02**).
4. **09:14:33.** GAME_KIT_SEEDED: `generate_game_runtime`, `generate_game_vfx`, `generate_melody` (12 files, 11.8 s). Detail: **“3D assets not prepared”** (**D03**). FAST_LANE_SKIPPED_GAME as designed for a game (**D04**).
5. **09:14:44.** The builder announced a simplified 2D GTA-style game (Los Santos / Blaine County / San Fierro; Michael / Franklin / Trevor; five missions) and built it as a DOM surface in `src/game/GTAStyleGame.tsx` (no canvas).
6. **09:15:26.** EXPLORATION_WITHOUT_CHANGE: 8 model turns made 8 file/search calls without changing the project; the platform asked for a concrete change.
7. **09:21:04–09:21:12.** Preview live. TIME_TO_FIRST_RENDER 418 s. IN_BUILD_GREEN: the app rendered in a real browser — 35 files recorded as last known good.
8. **09:23:16.** READY_BEFORE_END: judged finished at step 30 (92/100), then 4 more steps / 66 s (**D12**). WRITE_TIME_TYPECHECK: 14 runs, 12 clean, 5 errors quoted back, 35 s.
9. **09:23:22.** DESIGN_CONSISTENCY 62/100 (C): 22 colours, 12 off-grid spacings, worst `src/index.css` (**D09**). Accessibility 100/100 (A) across 28 files (**D16**).
10. **09:23:24–09:23:25.** E2E_SCAFFOLDED (not run here). STARTER_TESTS_SKIPPED (no vitest). The later “no tests at all” readiness warning was withdrawn once the scaffold existed.
11. **09:23:35.** JOURNEY_NOT_DERIVED: a form element in `src/game/GTAStyleGame.tsx` (the game Input class / in-screen controls, not a user form with a named open-control) (**D11**).
12. **09:23:38–09:23:53.** MOBILE_LAYOUT_OK. EXPLORE_PASSED: pressed 8 controls — FRANKLIN, TREVOR, Bank Heist, Delivery Job, Eliminate Targets, Interact, Attack, Jump — each “responded (nothing visibly changed)”; one unnamed control was not pressed (**D17**).
13. **09:23:57.** GAME_PLAYTEST_NOT_RUN: no canvas and no start-game control (**D05**). PROD_BUILD_OK at 09:24:04.
14. **09:24:09–09:24:11.** RELEASE_GATE YELLOW: renders, but playability NOT VERIFIED, plus design consistency 62/100 (**D07**). CLAIM_UNSUPPORTED: the summary claimed `game-claimed-playable` (“Your game is ready to play!” / “Fully playable on both desktop and mobile devices”) while playtest did not run (**D06** — the existing detector fired correctly).
15. **09:24:46.** CHANGE_RECORDED CHG-0001 new-app/standard · 13 files · status partial · gate YELLOW. TODO_ONLY_TURNS: 2 plan-only turns, 16.6 s (1 first/handed back, 1 after hand-back) — Q-2375 sibling (**D10**). Build ended succeeded. Charged ₹2.14 (**D13**).

## Prevention classes in this PR
| Fix | Class | Where | Locks |
|---|---|---|---|
| F1 | Neighbour locks (and the existing claim-audit detector against this report's own “ready to play” / “fully playable” sentences). | existing `analyzeAppScope` / `gameKitWants3D` / `gameKitPlan` / `realismIntent` / `auditSummaryClaims` | `tests/aGta5WalaGameIsGta.test.ts`; extra AAA-title and `gta50` cases in `src/server/lib/realismIntent.test.ts` |
| F2 | Classifier follow-up. Glued GTA titles `gta(?:\s*[-_]?\s*[5v])?` so `gta5` / `gtav` / `gta-5` / `gta_5` match the same famous-app, 3D-kit and real-objects path as spaced `gta 5`. Does not match `gta50`, `gta6`, `gta4` or `gta5cheats`. | `FAMOUS_APPS` GTA in `appScopeAnalyzer.ts`; `DRAWN_IN_3D` in `gameKitSeed.ts`; AAA-title list in `realismIntent.ts` | `tests/aGta5WalaGameIsGta.test.ts` |

## Side-effect review (owner rule t311u: no fix may create another problem)
| Fix | Adjacent behaviour checked | Side-effect risk | Decision |
|---|---|---|---|
| F1 | No production heuristic of its own (locks only). Claim-audit cases use this report's exact “ready to play” / “fully playable” wording; a qualified “controls remain unverified” sentence is left alone. India-map, BR1955 spaced fixture, lookalikes and companion/tool phrases are locked. | **None from new production code.** | Kept as neighbour locks |
| F2 | Opposite-class corpus of 167 prompts built **before** the edit (ordinary EN/HI apps, exact prior-BR neighbours including “Build a game with indian map”, the platform continue sentence, YouTube SEO / shop-ERP / exam-analyse neighbours, already-matching spaced `gta` / `gta 5` / `grand theft auto` forms, lookalikes `gta50` / `gta5cheats` / `gtable` / `gta6` / `gta4`, racing/driving/village/quiz/board/card games, tool mentions, and realism false positives such as “real-time”). Versus current main: **0 field changes** on decision, size, famousApp, wants3D, kit plan or realism tier. Same-class glued titles now match their spaced twins, including this report vs “Pura gta 5 wala game banaa do”. Companion phrases (“using GTA5”, “GTA5 wiki”) follow the existing “using GTA” / “GTA wiki” reading (not a clone). A “gta5 quiz” follows the existing “gta quiz” reading (famous, no 3D kit). Hyphenated `GTA-5` already matched via a bare `gta` word-boundary and is unchanged. | False clone / false 3D kit / lite→real on a non-GTA prompt. Measured: **none**. | Kept |

## Every item
| ID / queue | Origin / bucket | Problem | State |
|---|---|---|---|
| D01 | report / preventable | APP_SCOPE ordinary one-shot, no mega-signal, for “Pura gta5 wala game banaa do”. Spaced “Pura gta 5 wala game banaa do” already cloned GTA. | **Fixed as F2** (and locked by F1) |
| D02 | report / designed | PROJECT_MODE created no plan because this prompt is not a mega-project (0 enumerated parts). After F2 the prompt is LARGE via the famous name; it is still not a split-able project spec. | Designed / correct |
| D03 | report / preventable | GAME_KIT_SEEDED prepared only the 2D kit; “3D assets not prepared”. Same `\bgta\b` gap as D01, in `DRAWN_IN_3D` (and the matching realism miss). | **Fixed as F2** |
| D04 | report / designed | FAST_LANE_SKIPPED_GAME: a game uses the full builder. | Designed |
| D05 / Q-2634 | report / residual | GAME_PLAYTEST_NOT_RUN: no canvas and no start-game control, even though the explorer pressed Franklin / Trevor / missions / Interact / Attack / Jump on the DOM surface. | Queued. Broadening playtest is high t311u (false playtests). F2 should send future glued-gta5 asks down the existing canvas 3D kit; it does not widen playtest. |
| D06 | report / not-a-defect | CLAIM_UNSUPPORTED `game-claimed-playable` fired on “Your game is ready to play!” / “Fully playable…”. | Existing detector; locked by F1 |
| D07 | report / consequence | RELEASE_GATE YELLOW because playability was not verified (and design 62/100). | Consequence of D05 + D09; the gate told the truth |
| D08 / Q-2635 | measured sibling / residual | “grand theft auto wala game” is already LARGE / famousApp GTA, but `DRAWN_IN_3D` and `realismIntent` do not include the long name, so the 3D kit and real tier stay off. | Queued. Not this report's spelling; adding the long name is a separate escalating change |
| D09 | report / advisory | DESIGN_CONSISTENCY 62/100 (C), 22 colours, 12 off-grid spacings in `src/index.css`. | Advisory; not independently a ship-now heuristic |
| D10 | report / existing sibling | TODO_ONLY_TURNS 2 × 16.6 s (1 handed back, 1 after hand-back). | Sibling of Q-2375; not re-opened |
| D11 | report / existing detector | JOURNEY_NOT_DERIVED from a form/input in `GTAStyleGame.tsx`. | Existing journey limit for in-screen game controls without a router |
| D12 | report / designed | READY_BEFORE_END: finished at step 30, then 4 more steps / 66 s. | Designed |
| D13 | report / fact | Charged ₹2.14 on the weak/surplus lane. | Report fact; no billing change |
| D14 | tool / expected | `get_failed_build_autopsy` “Failed report not found in retained storage”. | Expected for a succeeded build |
| D15 | report / not-a-defect | ETA inside the shown 9.0–17.3 min band (ratio 0.988). | Not a defect |
| D16 | report / not-a-defect | Accessibility 100/100 across 28 files. | Not a defect |
| D17 | report / context | EXPLORE_PASSED on 8 DOM controls that “responded (nothing visibly changed)”. | Context for D05; the explorer ran |
| D18 | product honesty | A full commercial GTA cannot be promised even after escalation. | Existing `gamePlannerCapability` wording; not changed |

## Queue
- This commit closes no earlier row (nothing previously queued was implemented here).
- New rows are Q-2634 (canvas-less DOM playtest) and Q-2635 (long-name “grand theft auto” still 2D/lite).
- Q-2633 and earlier blockers stay open. Q-2375 is not re-opened.

## Opposite-class corpus (built first)
- 167 opposite-class prompts plus 23 same-class glued titles with spaced twins. Opposite corpus sha256 `b122fd3ccd6e5cb791a40fc6b4da5c84bf9ee40af900810b461c9a76defb0c58`. Same-class corpus sha256 `809d4f450ce92974168089c00cf88f8d5ae0620f8aa66bb67cc7dd5899e8c005`.
- Before: opposite LARGE 30 / famousApp=GTA 11 / wants3D 25 / real 16. After: the same four counts. **0 field changes**. Delta: [br1966-adv-delta.json](build-report-autopsy-BR1966-adv-delta.json) sha256 `f902e2b1e59a6f14e65e4eeb912d38c7bcc9942cf47d08a842cf8f4929dcef3a`.
- Before measure sha256 `6951e5217e6e4ef9996a051aa184701071c179b386bb6cc22719cbd0d91d0e5d`; after measure sha256 `d405d4e852fef559fea8e03ab903913abbfa163c2b77c66eec191adeae87ccca`.
- This report's prompt moved from direct/small/no-famous/2D-kit/lite to analyze/large/GTA/3D-kit/real, identical to “Pura gta 5 wala game banaa do”.

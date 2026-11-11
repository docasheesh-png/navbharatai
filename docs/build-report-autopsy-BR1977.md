# BR1977 — a Hinglish gadiyan city game was told the kit was on disk

Scope: BR1977 only, inside the frozen audit boundary 1951..2105. Branched from `487a18336e12e6d914a86c33f6225f5027c6f6c4` (the #4169 squash-merge of exact BR1976 head `e08fd1d31`, which is origin/main at branch creation). The parent reviews and merges this PR; BR1978 is not started. Nothing was replayed, deployed or reconfigured; no provider was called. Read only via `get_build_report` (no remote autopsy write).

## What the user asked

A 488-character Hinglish request (promptHash `421851e4`) for a realistic 3D Indian-city game named Lata Mangeshkar City: the player arrives, is given work, earns Paisa, and can buy gadiyan (cars); if they commit a crime the police arrest them and bail also costs Paisa. Full text is in the evidence file.

## What happened (IST, 2026-11-08)

1. **09:47:37.** FREE_BUILD_TIME_CAP 25 min (paid would get 58). REQUIREMENT_GAPS domain=game, 8 missing-feature defaults, 4 clarifying questions assumed. APP_SCOPE ordinary one-shot — "no mega-signal". COMPLEXITY_ROUTING COMPLEX score 63 (model) — ladder second rung. Surplus admitted (qwen3-coder). ETA key `game`, promised ~10.5–17.3 min (midpoint 11.9). **SANDBOX_UNAVAILABLE** immediately (E2B concurrent-sandbox cap of 20) plus an AGENT_NOTE that files cannot be created. REQUEST_SCOPE_NOTE: no login. CHANGE_CLASSIFIED: new app, 0 parts. HERO_OBJECTS: human, uniformed (real tier). PROJECT_MODE is ON for the account, but "this prompt is not a mega-project — normal path".
2. **09:48:04.** GAME_KIT_SEEDED: `generate_game_runtime`, `generate_game_3d`, `generate_game_vfx`, `generate_melody`, `generate_game_shell` **(3 files, 22.4 s)**; detail `recipes 22.4 s · 3D assets 0.0 s (off)`. The builder was told the kit is on disk and to build only the game on it. GAME_CONTRACT: `{"genre":"unknown","dimension":"3d","controls":[],"requiredFeatures":[],"winLoseNamed":false,"vehicle":null,"camera":"unspecified","subjects":["building"],"externalAssets":false}`. FAST_LANE_SKIPPED_GAME, repeating that the five-recipe kit is already laid down.
3. **09:48:10.** TOOL_ERROR: `src/game/core/events.ts` does not exist (six seconds after the seed announcement). The architect notes the recipes were supposed to have run and the files are not there; `index.css` is also missing. It then writes a custom `src/game/lata-city/` game and rebuilds `package.json`, the tsconfigs, `vite.config.ts`, `src/main.tsx` and `src/index.css`. It never writes `index.html` (absent from the final 48-file manifest). WRITE_TIME_TYPECHECK never ran: "no tsconfig.json was found, so the project is not TypeScript" — 21 TypeScript writes went unchecked (the model wrote tsconfig later).
4. **09:55:48–10:05:55.** PREVIEW_PUBLISHED. Repeated IN_BUILD_GREEN_UNCHECKED (a real browser opened and nothing painted). Ready-before-end fired at step 10 (92/100), then 61 more steps over 908 s. Frontend rewrote `LataCityGame.ts`, `LataCityUI.tsx`, `atmosphere.ts`, `environment.ts` and **`touchControls.ts`**.
5. **10:06:03–10:08:07.** OUTCOME_TYPECHECK_FAILED. OUTCOME_MISSING_FILES: `src/game/lata-city/car` imported by `LataCityGame.ts`. OUTCOME_MISSING_EXPORT: `touchControls.ts` must export `DEFAULT_TOUCH_BUTTONS` (imported by `Game.ts:19`) — after the frontend overwrite. UNFINISHED_BUILD_RESUMED (resume 1 of 2) handed those blockers back. `car.ts` was written at 10:08:07, after the missing-file gate.
6. **10:10:39–10:11:17.** CSS_CLASSES_HEALED. Finishing passes held at the cap. PREVIEW_UNVERIFIED (empty/blank). JOURNEY_NOT_DERIVED (game). MOBILE_LAYOUT_NOT_RUN (nothing at phone size). EXPLORE_NOT_RUN (HTTP 404). GAME_PLAYTEST_NOT_RUN — no canvas and no start control. PROD_BUILD_FAILED (`buttons`/`layout`/`setLayout` missing on the overwritten touch-controls types, unused locals, a `Touch[]` overload error). RELEASE_GATE RED with the same two blockers (stale missing `car` module + still-missing `DEFAULT_TOUCH_BUTTONS`). OUTCOME_RELEASE_GATE_RED corrects success → NOT ok. SANDBOX_RECOVERED (setup failed first, later served the build). GREEN_GUARD_NONE. MARKUP_WAIVED_NO_PREVIEW. CHG-0001 failed, gate RED, 40 files. Not charged (`zeroBillReason`: working app or free).

Outcome **failed** (`ok=false`). Duration 1,420,045 ms (~23.7 min), ETA ratio ~1.994, OVER the band. Truncation incomplete: 500 of 508 issue entries kept (first 250 + last 250; 8 from the middle gone). counts: total 507, errors 10, warnings 18, autoResolved 14, leftOpen 3, healRule 3, unresolved 43.

## The real delivered tree (not a reconstructed model)

Final manifest `fileHashes` lists 48 paths: the eventual kit (`src/game/core/*`, `src/game/three/*`, `src/game/fx/*`, `src/audio/*`, `src/game/Game.ts`, `GameCanvas.tsx`, `ui/Hud.tsx`, `ui/touchControls.ts`, play/systems files), custom `src/game/lata-city/{LataCityGame.ts,LataCityUI.tsx,car.ts}`, `src/App.tsx`, `package.json`, the tsconfigs, `vite.config.ts`, `src/main.tsx`, `src/index.css`, `src/nb-autostyle.css`. **There is no `index.html`.** READINESS_WARNING said "A Vite/CRA app has no index.html entry — the dev server has nothing to serve" (autoResolved true). The llm FILE-block extractor stored no bodies (the model used `write_file`); the excerpts below are the real on-disk contents the edit_file error reporter read back.

`src/App.tsx` (edit_file error 10:02:40 IST, lines 1–26):

```tsx
import React, { useState } from 'react';
import { GameCanvas } from './game/GameCanvas';

function App() {
  const [gameStarted, setGameStarted] = useState(false);

  if (!gameStarted) {
    return (
      <div className="nb-game-screen">
        <div className=
```

A start-gate UI in front of `GameCanvas`. Playtest later found no canvas and no start control because the page itself was 404/blank.

`src/game/lata-city/LataCityGame.ts` (edit_file error 09:58:07 IST, lines 59–107):

```ts
  // Set up lighting and environment
  ctx.lights.preset = 'sunset';
  ctx.renderer.setClearColor(new THREE.Color(0.5, 0.7, 0.9));

  // Create terrain
  const terrain = createTerrain({
    size: 200,
    palette: 'indianVillage'
```

The custom game imported `./car` before that module existed. `car.ts` appears in the final hashes because it was written at 10:08:07, after the 10:06:04 missing-file gate; RELEASE_GATE at 10:11:13 still cited the stale blocker.

The user-facing DNA is not a billed stub and not a yellow phone layout. A specified 3D city game became a RED unshippable preview (404/blank, never playtested) because the platform (1) missed the cars the user named and (2) told the builder a five-recipe kit was on disk when only three files had landed.

## Root cause (F1)

`buildGameContract` already maps English `cars?` and Hinglish `gaadi` to `vehicle: 'car'`, and `gameContractBlock` then tells the builder "The player drives: a car" using the kit's `driveVehicle` / chase-camera path. This prompt never said `car`, `gaadi`, `drive` or `driving`. It said **gadiyan** ("vah kuchh gadiyan matlab jo kharidna chahe vah kharidega"). That spelling was not in `VEHICLES`, so the recorded contract had `vehicle: null` and `camera: "unspecified"`. The only world subject extracted was `building` (from "City" / "city"). Genre stayed `unknown` — correctly, this is not a racing request.

Without a vehicle in the contract the builder invented `src/game/lata-city/car` instead of using the kit vehicle, imported it before writing it, and the missing-file gate fired. The first RED blocker is that module.

## Root cause (F2)

The seed records `r.ok = !r.is_error` and then announces GAME_KIT_SEEDED whenever any recipe is ok. It does not check that the recipes wrote their files. `kitFiles` counts entries in `writtenFiles` that changed versus `writtenBeforeKit`. This build listed all five recipes as ok and only **3 files** after `SANDBOX_UNAVAILABLE`. A healthy 3D seed writes about 30 files.

Six seconds later `events.ts` was missing. The architect rebuilt a Vite project by hand and never restored `index.html`. Later, kit files that did eventually appear (`Game.ts` expecting `DEFAULT_TOUCH_BUTTONS`) were crossed with a frontend overwrite of `touchControls.ts`, producing the second RED blocker. Preview, explore, mobile-layout and playtest all failed as a consequence (404 / blank / no canvas) — they are not separate CSS or DOM bugs.

`gameKitHandoffBlock` is already honest about failed recipes ("NOT laid down — run them yourself") and silent when none succeeded. The hole was treating empty dispatcher success as success.

## Prevention classes in this PR

| Fix | Class | Where | Locks |
|---|---|---|---|
| F1 | The vehicle the user named, in the spelling they used, must reach the contract. Hinglish `gadi` / `gadiyan` / `gadiya` / `gaadiyan` are the same car as `gaadi`. Genre is not changed — buying cars in a city is not a racing game. | `gameIntent.ts` (`VEHICLES` car regex) | `tests/aGadiyanCityGameNamesItsCar.test.ts`: this exact prompt is `vehicle: 'car'`, `genre: 'unknown'`, `dimension: '3d'`, `subjects: ['building']`, camera chase-view; `gaadi` / `car wala khel` unchanged; train simulator stays train; bicycle / snake / brigadier / `gta5 wala game` do not become cars; the prompt still plans the five-recipe 3D kit; `Mujhe ak bike race app bana kar dedo` stays non-game (Q-2640). |
| F2 | A recipe success with no files is not a seeded kit. After the recipe loop, count files that landed versus `writtenBeforeKit` and downgrade every empty success unless at least as many files landed as recipes that said they succeeded. Asset prep (`gameKitCanPrepareAssets`) then sees the downgraded 3D recipe and does not run on a missing layer. GAME_KIT_NOT_SEEDED / a silent handoff tell the builder to run the recipes itself. | `gameKitSeed.ts` (`kitSeedClaimIsHonest`, `downgradeEmptyKitSeedSuccesses`); `routes/agentv3.ts` (after the recipe loop, before 3D-asset prep) | Same test: (5 ok, 3 files) is not honest and produces an empty handoff; (5 ok, 30 files) is unchanged and still says the kit is on disk; a 1-for-1 seed and a 3-ok-plus-1-failed mix stay honest; the route counts recipe writes (not later assets) and downgrades before `gameKitCanPrepareAssets`. |

## Side-effect review (owner rule t311u)

| Fix | Adjacent behaviour checked | Side-effect risk | Decision |
|---|---|---|---|
| F1 add `gadi` / `gadiyan` to the car regex | `gaadi` and `cars?` still match first-or-later as before. Train / aircraft / bus / truck / motorcycle / bicycle keep their earlier alternatives. This prompt's genre stays `unknown` (the racing alternatives need `car game` / `gaadi wala khel` / `race`, which this text does not say). `gta5 wala game` still has no vehicle. `brigadier` does not contain a `gadi` word. | A prompt that uses "Gadi" as a person's name would pick up a car. That is vanishingly rare next to Hinglish "gadi" = vehicle. Adding `gadi wala khel` to the *racing* genre would have mis-labelled this city sandbox as a race — not done. | Ship. Mutations: drop `gadiyan` from the regex (this prompt's vehicle goes back to null) and keep the train / bicycle / snake neighbours green. |
| F2 refuse to claim a seed when files < successful recipes | A healthy ~30-file 3D seed (`files >= 5`) is unchanged: GAME_KIT_SEEDED, handoff "files are on disk NOW", fast-lane still skipped, asset prep still allowed when the 3D recipe actually wrote. A 2D three-recipe seed that writes its files is unchanged. A seed that already failed every recipe still records GAME_KIT_NOT_SEEDED. Recipes that did land stay on disk; the builder is told to run the missing ones, and recipes refuse to overwrite existing files. | A successful seed whose `writtenFiles` tracking under-counted real disk writes would be downgraded (the builder would re-run recipes that no-op on files that are already there). That is the same view of the project the builder uses; in this report disk and `writtenFiles` agreed — `events.ts` was missing. A threshold of "one file per ok recipe" is the minimum honest bar (3 files / 5 ok fails; 5/5 passes). | Ship. Mutations: always-honest (5 ok / 3 files still claimed) and never-honest (a 30-file seed also downgraded) must turn red. |
| Auto-regenerate `DEFAULT_TOUCH_BUTTONS` after a frontend overwrite of `touchControls.ts` | The missing-export gate correctly reported the hole (Q-1427's detection class). Repair did not restore the export (Q-2270). | Teaching every kit-file overwrite to regenerate cross-file exports is Q-2270's job and can fight a deliberate edit of the touch layout. | Do not ship. Existing Q-2270. |
| Re-scan the missing-file gate after every late write (`car.ts` at 10:08:07) | Final disk has `car.ts`; RELEASE_GATE cited the stale 10:06 blocker. | Re-running import gates after every write is a wide scheduler change. The file arriving late is a symptom of F1 (invented module) plus resume ordering. | Do not ship. |
| Add police / Paisa / jobs to the contract catalog | The prompt names police, money and work. There is no `police` / `wanted` / `economy` slot in `FEATURES` today. `HERO_OBJECTS` already applied `human, uniformed`. | New feature types are a classifier expansion (false positives on "police verification app", "Paisa wallet"). They would not have created `index.html` or restored `DEFAULT_TOUCH_BUTTONS`. | Do not ship. Do not queue a new catalog slot without an opposite-class corpus. |
| Treat this as a mega-project / retune APP_SCOPE or the game ETA band | PROJECT_MODE explicitly said this is not a mega-project. The build ran 23.7 min on Surplus against a 10.5–17.3 min game band in a 25-min free window, in part because the kit was missing and the model rebuilt the stack. | Scope and ETA policy. A false mega-positive costs an ordinary app an extra planner. | Do not ship. |
| Charge, or change the RED release-gate policy | Not charged was correct. RED was correct (unplayable preview, two formal blockers, prod build failed). | Billing / verdict policy. | Do not ship. |
| Invent a prettier start screen or a stub canvas so playtest can run | The start-gate UI and missing canvas are consequences of no `index.html` and crashy imports. | A fake canvas would hide the 404 and could earn a green playtest on an empty world. | Do not ship. |
| Q-2649..Q-2652 and earlier carried rows | None of them are this report's DNA (no store-open language; this is a real game request, not a bare `src/game/...` path; not an unexplained asked-user empty build; PROJECT_MODE said not a mega-project, so not Q-2652's module-1-no-preview path). SANDBOX_UNAVAILABLE is already Q-2621. | Out of scope. | Carry unchanged. Do not implement. |
| Reviewer residual of #4169: one-word `game` still builds a stub | `game` is in `PRODUCT_NOUN` and not in `PLACEHOLDER_NOUNS`, so `namesNoObject('game')` is false and `buildConfirmation` still confirms via the product-noun rule (the same class as BR1976's `App` before F1). This report is a specified city game, not the word `game`. Adding `game` to the placeholders would also make `make a game` / `game banao` `namesNoObject`, which then collides with high-confidence orders (next row). | Classifier change with neighbour risk vs named games (`snake game`, `chess game`) if scoped carelessly. | Queue Q-2653. Do not implement here. |
| Reviewer residual of #4169: high-confidence objectless orders (`app banao`, `Banao`) can still build when the ask-gate misses | BR1976 F1 runs `namesNoObject` only after the high-confidence and question branches, on purpose (suggested-reply edits such as `add it to this app` stay confirmed). `shop app banao` has an object and must still build. This report is not an objectless order. | Widening confirmation into the high-confidence `new_build` branch is the exact change BR1976 declined. | Queue Q-2654. Do not implement here. |

## Queue

This commit closes no earlier row. It opens Q-2653 (bare `game` still confirms a stub) and Q-2654 (high-confidence objectless orders still confirm when the ask-gate misses) from the independent review of #4169 / BR1976. Q-2649, Q-2650, Q-2651, Q-2652, Q-2648, Q-2647, Q-2646, Q-2645, Q-2644, Q-2643, Q-2642, Q-2640, Q-2621, Q-2611, Q-2375 / Q-1068 and earlier blockers stay open. Q-2238 stays open as the parent of Q-2651. Q-2270 stays open as the residual "reported but not auto-regenerated" `DEFAULT_TOUCH_BUTTONS` repair.

# BR1978 — "Build one game": the kit claimed 0 files, the compiler slept through a tsconfig

Scope: BR1978 only, inside the frozen audit boundary 1951..2105. Branched from origin/main `55dcc3e20947f7bcd63495a499e85a04d73fdefc` (#4229). BR1977 (#4170) is merged (squash `e511ed9ce`). No PR or autopsy for BR1978 or later existed (gh title search `BR1978` empty; no `docs/build-report-autopsy-BR19{78..}`; `get_failed_build_autopsy` says "Failed report not found" because this report succeeded). Read only via `get_build_report` — no remote autopsy write, no replay, no deploy, no provider call.

## What the user asked

`Build one game` (14 characters, promptHash `6debba63`). No genre, no theme, no feature.

## What happened (IST, 2026-11-08)

1. **09:50:19.** FREE_BUILD_TIME_CAP 25 min. REQUIREMENT_GAPS domain=game. APP_SCOPE ordinary one-shot. TIER_LADDER Weak default (GLM → KIMI → GLM). COMPLEXITY_ROUTING simple 15. SURPLUS_ADMITTED qwen3-coder. ETA ~9–17 min. **09:50:20 SANDBOX_UNAVAILABLE** (E2B concurrent-sandbox cap of 20) plus AGENT_NOTE "can't create files". Project context: file listing **0 path(s)** — no starter. CHANGE_CLASSIFIED new app. PROJECT_MODE not a mega-project.
2. **09:50:23–09:50:30.** `run_recipe` generate_game_runtime / generate_game_vfx / generate_melody, then **GAME_KIT_SEEDED "… (0 files, 7.4 s). The builder was told the kit is on disk"**. FAST_LANE_SKIPPED_GAME repeats that the kit is laid down. No GAME_CONTRACT line (the contract for this prompt is empty: genre unknown, no dimension, no feature).
3. **09:50:42–09:53:35.** The builder chose "Color Rush" (tap the falling block of the matching colour). `write_files_batch` refused 5 files on a transient read error; `read_file src/App.tsx` hit the E2B cap again; then `src/App.tsx does not exist`; two globs found no project. "It seems the project files haven't been created yet" — it rebuilt `package.json`, `vite.config.ts`, **`tsconfig.json` (09:53:53)**, `tsconfig.node.json`, `index.html`, `src/main.tsx`, `src/index.css`, `src/App.tsx` by hand.
4. **09:55:30–09:56:20.** `npm install` (19 s), `npm audit fix` (exit 1; 2 vulnerabilities remain, vite 4.5.14), dev server, PREVIEW_PUBLISHED, first real-browser render at 361 s, IN_BUILD_GREEN.
5. **09:56:21–10:00:01.** The builder said it would use "the game kit that's already available" for audio and wrote its own `src/game/color-rush/audio.ts` (no kit file exists in the manifest). `tsc --noEmit` failed at 09:57:49 (JSX config, unused `tappedBlock`, `./App` resolution) and 09:59:07 (`React` unused); clean at 10:00:01. `npm run build` exit 0.
6. **10:01:39–10:03:10.** READY_BEFORE_END (step 10, 86/100, then 39 more steps). **WRITE_TIME_TYPECHECK: "never ran although 20 TypeScript write(s) happened — no tsconfig.json was found, so the project is not TypeScript."** Production defaults, e2e scaffold, ADR. MOBILE_LAYOUT_OK 390×844. EXPLORE_PASSED ("Start Game"). PROD_BUILD_OK. RELEASE_GATE YELLOW (2 dependency vulnerabilities; design consistency 98/100 — 13 colours). Bug-hunt offer unanswered. SANDBOX_RECOVERED. Charged ₹5.55 (₹6.02 → ₹5.42 after the 10% build discount, plus the 2.5% sandbox fee); wallet debited 555 tokens.

Outcome **succeeded** (`ok=true`), 770,773 ms build / 740,396 ms measured (30.4 s user wait excluded), ETA ratio 1.22 INSIDE the 8.9–17.3 min game band. Truncation complete. counts: total 283, errors 3, warnings 9, unresolved 3 (DEPENDENCY_VULNERABILITIES, DESIGN_CONSISTENCY, RELEASE_GATE). 50 Surplus calls (qwen3-coder); the Weak ladder was never used; PROVIDER_TIME_WASTED 0.

## The real delivered tree (not a reconstructed model)

Manifest `fileHashes` (22 paths): `src/game/color-rush/{types.ts,GameLogic.ts,ColorRushGame.tsx,audio.ts}`, `src/App.tsx`, `src/main.tsx`, `src/index.css`, `index.html`, `package.json`, `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `.gitignore`, `README.md`, `playwright.config.ts`, `e2e/smoke.spec.ts`, `docs/decisions/ADR-001.md`, `public/{manifest.webmanifest,robots.txt,icon.svg,sw.js,nbai-native.css}`. **No `src/game/core/*`, no `src/game/fx/*`, no `src/audio/*`** — not one of the three "laid down" recipes left a file. The `src/App.tsx` the edit-error reader read back (09:57:15 IST) begins `import React, { useState } from 'react'; import ColorRushGame from './game/color-rush/ColorR…` and later `import React, { useState, useEffect } from 'react';` (09:59:13 IST). The rendered DOM had one styled button ("Start Game"; RENDER_STYLE 133 rules, 1 of 1 button styled).

The user-facing result is a working, playable DOM tap game — not a stub. The DNA is two platform statements that were false while the sandbox was down: "the kit is on disk" (0 files) and "the project is not TypeScript" (the builder had written tsconfig.json 13 writes earlier).

## Root causes, and where main already closed them

| # | Defect in this report | Root cause on the deployed code | Closed on main by | Lock in this PR |
|---|---|---|---|---|
| D1 | Recipes ran into an empty workspace (0 paths) during SANDBOX_UNAVAILABLE | No preflight required a project manifest before `run_recipe` | **BR1958 (#4132)** `prepareGameSeedWorkspace`: no readable React manifest ⇒ recover the starter through the ownership-checked path; still none ⇒ `ready:false`, "no game recipes were run" | `tests/br1978Autopsy.test.ts`: E2B-cap read + failed recovery ⇒ not ready; recovery without a manifest ⇒ not ready; recovered starter ⇒ ready with its scaffold; existing manifest ⇒ ready without recovery |
| D2 | GAME_KIT_SEEDED "(0 files)" and a handoff that said the kit was on disk | `r.ok = !r.is_error` with no check that anything landed | **BR1977 (#4170)** `downgradeEmptyKitSeedSuccesses` (files landed ≥ successful recipes) | Same file: this report's 3 ok / 0 files ⇒ all downgraded, empty handoff, "Not laid down: …"; neighbour 3 ok / 12 files keeps the claim |
| D3 | WRITE_TIME_TYPECHECK silent for 20 TS writes; two avoidable failing `tsc` runs | The first TS write cached `tsconfig: no`, and nothing expired it when the builder wrote tsconfig.json | **BR1951** `onFileWrite`: a successful `tsconfig.json` write sets the project verdict to yes | Same file: the delivered order (game files → package.json → tsconfig.json → App.tsx) compiles App.tsx; neighbour: a project that never writes a tsconfig still is not compiled |

All three fixes were merged after this build ran (2026-11-08 09:50 IST). This PR ships **no production code change**; it locks each closure against BR1978's exact shape so none can regress.

## Side-effect review (owner rule t311u)

| Candidate | Adjacent behaviour | Risk | Decision |
|---|---|---|---|
| Lock D1–D3 with tests only | Tests read pure helpers and an in-memory dispatcher; no route or classifier changes. | None at runtime. | Ship (tests + ledger). Mutations: D1 ready-on-failed-recovery, D2 always-honest seed, D3 drop the tsconfig re-arm must each turn red. |
| Make "Build one game" ask "which game?" (Q-2653 / Q-2654) | On main `assessBuildInput('Build one game')` is buildable and `buildConfirmation` is explicit-order (high-confidence `build`). `Build one app` is `no-object` and asks. Adding `game` to PLACEHOLDER_NOUNS would also make "make a game", "game banao", "ek game banao" and "koi bhi game banao" ask. | This report produced a real playable game (explore passed, phone layout OK), not the stub the #4169 reviewer predicted. Asking would add a turn to every generic game order — a product decision, not a minimum-scope fix. | Do not ship. Q-2653 and Q-2654 updated with this report's evidence; they stay open for an admin decision. |
| GAME_CONTRACT absent / no GAME_PLAYTEST line | The contract for this prompt is empty (`gameContractBlock` = ''), and the deployed code of 2026-11-08 did not record it; the game is a DOM game with no canvas. Main has since changed both paths (#4087, BR1951 `domGameKind`). | Cannot be established from this report without a replay. | Do not ship. Not queued (no evidence of a current-main hole). |
| `audio.ts` written after the builder was told the kit had audio | Consequence of D2. | — | Covered by D2. |
| SANDBOX_UNAVAILABLE / E2B cap | Already Q-2621. | Infrastructure. | Carry. |
| Dependency vulnerabilities (vite 4.5.14) and 13-colour palette | Advisory; the builder wrote its own `package.json` because the starter was missing (D1). | Starter pins / design policy. | Do not ship. |
| Charge ₹5.55 | The build succeeded and rendered (working app or free). | Billing policy. | Do not ship. |
| Q-2649..Q-2652 and earlier rows | None is this report's DNA. | — | Carry unchanged. |

## Queue

This commit closes no row and opens no row. Q-2653 and Q-2654 gain BR1978 evidence. Q-2649, Q-2650, Q-2651, Q-2652, Q-2653, Q-2654, Q-2648, Q-2647, Q-2646, Q-2645, Q-2644, Q-2643, Q-2642, Q-2640, Q-2621, Q-2611, Q-2375 / Q-1068 and earlier blockers stay open.

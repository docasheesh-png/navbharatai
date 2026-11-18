# BR1999 — a gun game shipped GREEN, but its release-gate line was cut mid-sentence and named settings it did not have

Scope: BR1999 only, inside the frozen audit boundary 1951..2105. Branched from origin/main `58fa9a6` (#4292). BR1998 is merged (`docs/build-report-autopsy-BR1998.md`, four reworks). Read only via the read-only failed-BR MCP tools (`list_build_reports`, `get_build_report`). No remote autopsy write, replay, deploy or provider call. Routing, billing and admission were not touched.

## What the report holds (described generically; no request text, ids or timestamps)

- **The request:** a short Hinglish request for a gun game. New app, free Weak tier, Surplus (qwen3-coder) on every turn, no Claude.
- **Outcome:** SUCCEEDED, RELEASE_GATE GREEN. The game was played in a real browser (Game Quality Score 94/100), production build OK, phone layout OK. Not charged.
- **Time:** 17.4 min against a 9.0–17.3 min game band (1.7× the midpoint, just over the band).
- **Truncation:** complete (294 issues, 52 model calls, 7 commands, 30 manifest paths).

The order, in seconds after the start (rounded):

1. **0.6 s.** SANDBOX_UNAVAILABLE (the E2B cap of 20 concurrent sandboxes), plus the old "I can't create files right now, try again later" note.
2. **3–14 s.** Three game-kit recipes "succeeded" and GAME_KIT_SEEDED said "(0 files) … the builder was told the kit is on disk".
3. **30–60 s.** The builder found an empty folder, ran `npm init`, installed React and Vite by hand (it later pinned vite 4.5.14, 12 advisories), and wrote its own entry files.
4. **213 s.** First real-browser render (IN_BUILD_GREEN).
5. **382 s.** The done check scored 100/100 and the user saw "✅ The app looks complete — wrapping up."
6. **395–720 s.** Still told the kit was on disk, the builder wrote "simplified versions" of the kit itself (`src/game/core/*`, `src/game/fx/*`, `src/audio/*`) and rewired the game onto them: READY_BEFORE_END, 31 more steps over 601 s.
7. **980–1072 s.** End-of-build checks. RELEASE_GATE GREEN, but its "NOT established" list read *"… (it keeps its progress in a database write in src/game/GameManager.js), and its settings  (not a defect)"*.

## Ledger

| # | Item | Bucket | Root cause | State |
|---|---|---|---|---|
| D1 | RELEASE_GATE line cut mid-sentence ("and its settings  (not a defect)") | ❌ shipped imperfect (admin-visible) | `releaseGate.ts` took `.slice(0, 200)` of the journey derivation's own sentence. The game sentence is about 330 characters, so every canvas game got a half sentence with a label after it. Class: a consumer caps a sentence its producer writes, and the cap is shorter than the producer's sentences. Sibling: `journeyUnreachableWhy`, same blind slice (160). | ✅ **F1** — `clipReason` + `JOURNEY_NONE_WHY_MAX` (480, fits every sentence `noJourneyReason` returns) + `JOURNEY_UNREACHABLE_WHY_MAX` (200). Text still too long is cut at a clause or word, never inside an open parenthesis, and ends with "…". |
| D2 | The game sentence said "its settings controls (a sound switch, a speed slider)" about a game that had neither | ❌ false claim | `gameNoJourneyReason` wrote the examples as if they were facts about this game. | ✅ **F2** — "settings such as a sound switch or a speed slider are not data". |
| D3 | "it keeps its progress in **a database write**" for a localStorage best score | ❌ false claim | The pre-BR1955 datastore regex read a game loop's `.update()` as a database write. | ✅ Closed on main by **BR1955** (`datastoreWriteEvidence`, AST and datastore-shaped chain). Locked here: this report's shape now says "browser storage". |
| D4 | GAME_KIT_SEEDED claimed 3 recipes with 0 files; builder told the kit was on disk | 🔀 workaround (the builder rebuilt the kit by hand) | `r.ok = !r.is_error` with no file check. | ✅ Closed on main by **BR1977** (`downgradeEmptyKitSeedSuccesses`). Locked here with this report's 3-ok / 0-files shape. |
| D5 | Recipes ran into an empty workspace; the builder scaffolded Vite by hand and chose vite 4.5.14 | 🥵 struggle | No preflight required a project manifest before the seed. | ✅ Closed on main by **BR1958** (`prepareGameSeedWorkspace`), locked by `tests/br1978Autopsy.test.ts`. The vite advisory is a consequence: the starter's own pins never landed. |
| D6 | 31 steps / 601 s after "wrapping up", spent writing copies of the kit | 🥵 struggle | Consequence of D4: the handoff told the builder to import a kit that was not there. | ✅ Covered by D4. Nothing to change in the done check: the game it judged did work. |
| D7 | ETA 1.7× the midpoint, just over the band | 🥵 struggle | Consequence of D4–D6 (about 10 min of kit re-writing). | ✅ Covered by D4/D5. |
| D8 | "I can't create files right now, try again later" while the build went on and succeeded | ❌ false message | Setup-failure note sent before the sandbox recovered. | ✅ Closed on main by **#4146** (the note no longer exists in the source). |
| D9 | SANDBOX_UNAVAILABLE: E2B cap of 20 concurrent sandboxes | infrastructure | Capacity. | 🟡 **Q-2621** (ops decision). BR1999 evidence appended. |
| D10 | One `edit_file` miss on `src/App.jsx`, then a full rewrite | ✅ self-healed | Builder tool use; the miss reader returned the real file. | ✅ No platform defect. |
| D11 | TODO_ONLY_TURNS: 2 plan-only turns (23 s) | 🥵 struggle | Model behaviour; the hand-back from autopsy 9c612cdb fired. | ✅ Existing mechanism worked. No change. |
| D12 | Final summary said "28 files, 1 component"; CHANGE_RECORDED said 21 files; FE_BE_PARTITION said 30; the manifest has 30 paths | ⏭️ unexplained | Not established which scope each count uses. | 🟡 **Q-2753** opened. |

## Side-effect review (owner rule t311u)

| Change | Adjacent behaviour | Risk | Decision |
|---|---|---|---|
| F1 cap 200 → 480 with clause-safe clipping | The headline at "It runs and renders. No user journey was derived to drive (…)" also uses the reason, so it can now be longer. Sentences under 200 characters are byte-identical. | A longer headline on button apps with saved state. That is the true sentence; the cut one was not. | Ship. Reversion: put the old slice back and the report-shape test and the source guard fail. |
| F1 unreachable reason, clause-safe at 200 | Runner notes under 160 characters are unchanged. | None. | Ship. |
| F2 wording | Only `gameNoJourneyReason`. No test pinned the old text. | None. | Ship. Reversion: put the old text back and the F2 test fails. |
| Make the done check wait for a kit that was claimed | D6 was caused by the false claim, which is closed. | Would change a working check. | Do not ship. |
| Pin a newer Vite in hand scaffolds | D5 closed the path that led to hand scaffolding. | Dependency policy. | Do not ship. |

## Queue

Opens Q-2753. Q-2621 gains BR1999 evidence. No row closed.

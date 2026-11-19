# BR2001 — a Windows 10 emulator ran out of time arguing with a false "missing file"

Scope: BR2001 only, inside the frozen audit boundary 1951..2105. BR2000 was not retained (no report to read). Branched from origin/main `7ed8450` (#4304). Read only via the read-only failed-BR MCP tools. No replay, deploy, provider call or remote autopsy write.

## What the report holds (generic; no request text, ids or timestamps)

- **Request:** a desktop-OS emulator (Windows-style). New app, free Weak tier. Surplus (qwen3-coder) ran every turn, 109 slices. No Claude.
- **Outcome:** FAILED. The 25-min wall-clock cap stopped it (OUTCOME_STOPPED, BUILD_TIMEOUT) and RELEASE_GATE was RED. Not charged.
- **Time:** the ETA was 4.0–9.5 min (unsized app). The build ran 25.1 min, 4.3× the midpoint.
- **Truncation:** complete (451 issues, 111 calls, 37 commands, 35 manifest paths).

Timeline, in seconds:

1. **0.6** SANDBOX_UNAVAILABLE (the E2B cap of 20), plus the old "I can't create files" note.
2. **10–183** Fast lane: 11 files planned, generated and salvaged. Verify failed with "UNRESOLVED IMPORTS": eight `src/assets/icons/*.svg?react` icons were imported but never planned. The build fell back to the full builder.
3. **186–460** The full builder wrote the eight `.svg` files.
4. **460–976** Typecheck went 22 → 14 errors, then held at 14 for about 5 min. The fast lane had produced two app registries (`utils/system.ts` with string icons, `utils/apps.tsx` with svgr components). After it made them agree, the typecheck was clean.
5. **1015** First real-browser render (IN_BUILD_GREEN).
6. **1102–1218** Console errors on the svg imports. The builder installed `vite-plugin-svgr`, and `npm run build` passed.
7. **1266–1500** The readiness check still reported the same unresolved `…svg?react` imports. The builder said so itself: *"the evaluator is flagging the SVG imports as unresolved, even though they work in practice"*. Two resumes and about 6 min went to that, then the cap stopped the build.

## Ledger

| # | Item | Bucket | Root cause | State |
|---|---|---|---|---|
| D1 | `…/start.svg?react — CREATE this file` while `start.svg` existed and the build passed | ❌ false finding, the decisive struggle | `findUnresolvedLocalImports` appended `.tsx` / `/index.ts` to the whole specifier, `?react` included, so it could never match the file. **Class:** a resolver that treats the bundler's `?query` / `#hash` as part of the file name. `isBinaryAssetSpecifier` already stripped it; its siblings did not. **Siblings found by an empirical census (one fixture, every resolver):** `appGraphScan.resolveRelative` (reported "broken import that will fail the build", high severity), `writeTimeImportCheck.candidatePaths`, `ArchitectureAnalysis.localImportCandidates`, `journeyDerivation.resolveLocalImport`, and `fixMispathLocalImports`, which would have dropped the `?react` from a rewritten path. | ✅ **F1**: one shared `src/server/lib/importSpecifierPath`, used by all six. The mispath autofix keeps the suffix. `resolveExportTarget` refuses a query-loaded module on purpose: svgr creates its exports, the file does not declare them. |
| D2 | The fast lane imported eight icons it never planned | 🔀 workaround (full-builder fallback) | Plan/import mismatch, a real miss at that moment. Once D1 is fixed, the fallback that creates the files is enough. | ✅ Real misses are still reported (neighbour test: a missing `tray.svg` is still named). |
| D3 | Two app registries with different icon types; 14 type errors held for about 5 min | 🥵 struggle | The fast-lane plan produced both `utils/apps.tsx` and `utils/system.ts` for one concept. | 🟡 **Q-2765** opened. |
| D4 | `import { ReactComponent as X } from './x.svg?react'`, a mix of the CRA and svgr-v4 styles (v4 gives a default export), caused console errors | 🥵 struggle | The builder had no stack knowledge of svgr. | 🟡 **Q-2766** opened. |
| D5 | ETA 4–10 min ("app_unsized") for an OS emulator; 4.3× | 🥵 struggle | The sizer recognised nothing in the request. | 🟡 Existing **Q-1007** (BR2001 evidence appended). |
| D6 | SANDBOX_UNAVAILABLE (E2B cap 20) | infrastructure | Capacity. | 🟡 **Q-2621** (evidence appended). |
| D7 | "I can't create files right now" while the build went on | ❌ false note | — | ✅ Closed on main by **#4146**. |
| D8 | The ending quoted "about 22 min" when the build had run 25 | ❌ wrong number | The runner's budget was quoted instead of the build's clock. | ✅ Closed on main by **BR1994** (`buildClockMinutes`). |
| D9 | "Not finished yet, I am continuing" after "Out of time" | ❌ contradiction | — | ✅ Closed on main by **BR1994**. |
| D10 | REPEATED_READS 39 %, one `edit_file` miss, and a model claim "completed successfully" with a blocker still open | ✅ self-healed / existing | The resume mechanism corrected the claim; the reads followed real changes. | ✅ No platform change. |

## Proof

`tests/br2001Autopsy.test.ts`, 10 tests. Reverting each of the five resolver fixes makes 2–5 tests fail, so each one is proven by reversion. A census guard fails if a listed resolver stops using `importSpecifierPath`. Neighbours: a missing icon is still reported, `isBinaryAssetSpecifier` is unchanged, and `ProjectImport.test.ts` (98 tests) still passes.

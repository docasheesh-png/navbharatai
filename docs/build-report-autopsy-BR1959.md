# BR1959 — school management app: the fast lane handed off over three fixable classes

Scope: BR1959 only, inside the frozen audit boundary 1951..2105. Base `59a03712db57e1447b5cb1f5922116160943ad9c` (BR1958 PR #4132 merged). The parent reviews and merges this PR; BR1960 is not started. Nothing was replayed, deployed or reconfigured; no provider was called, and no autopsy was written to a remote service.

## Identity and evidence
- Prompt: **"Build a school management app with all features nav bar and ither things"**. Outcome **succeeded** (ok=true). Model qwen3-coder (SURPLUS), weak tier, vite-react.
- Build `9479f253-71ca-4c46-bc5b-c0e10e15e0be`, workspace `agentv3-N4KBavL7xSO4Dl6BwsrzH031k7v2-ab136c40-0be0-4391-81ad-dd67d66567c1`, history 1794108866838, report digest `fe51e126ed418d611b25a5aea43c99780c776045a123b8920e588bd07f814257`.
- Started **2026-11-08 09:04:26 IST**, ended **09:24:25 IST** (19.5 min; the ETA midpoint shown was 9.7 min). Charged ₹4.62.
- 413 issue entries (the report's own count says 412), 6 warnings, 0 errors, 6 selected problems, 19 commands, 87 model calls and 41 file hashes. All of them are indexed in [the evidence file](build-report-autopsy-BR1959-evidence.json); every warning maps to a ledger row (the generator asserts this).
- The autopsy MCP returns "Failed report not found in retained storage" because this build succeeded. No server autopsy exists, and none was written.
- **Evidence limits.** `generatedFiles` holds 12 previews capped at 6023 characters, captured at the fast-lane hand-off. The delivered files are known only by hash. `src/types.ts`, and the Classes, Courses, Students and Teachers pages, were not captured. Nothing below claims what the delivered app's code looks like, apart from what those previews and the report's own messages show.

## Five buckets (report-backed)
3 self-heal (D11, D13, D15) · 1 workaround (D01: the hand-off) · 3 skip (D08, D09, D14) · 5 broken (D02 latent, D05, D06 and D07 the shipped forms, D10 honesty) · 3 struggle (D03, D04, and D12, which is their consequence) = 15 rows: 7 implemented, 3 blocked, 5 not-a-defect/already-handled/covered.

## What happened (IST)
1. **09:04:26 → 09:10:45.** The fast lane planned, wrote a contract and generated the files one per call (generation 302.9 s, 83 %). Then it verified: `tsc` failed with TS2307 for `react-router-dom`, which Navbar and App import and the scaffold's package.json does not declare. The fast lane had **no dependency reconcile before verify**; its only one ran in `fastPreview`, after verify passed. The paid repair round (26.9 s) can only rewrite files, so it changed nothing. The lane handed off (TYPECHECK_FAILED) and salvaged 28 files. **→ D01, F1.**
2. **09:11:32.** The full builder ran `npm install react-router-dom` itself. The write-time typecheck then surfaced the two classes the fast lane had also left:
   - **D03.** `src/utils/api.ts` used all seven contract types in type positions and imported none of them (TS2304).
   - **D04.** In six hooks, a nested `const fetchX = async () => { … await fetchX() }` shadowed the imported api function and called itself (TS2345 `void`).
   
   The model fixed the hooks one per turn from 09:12:46 to 09:15:45, with errors falling from 47 to 42. It then fixed api.ts. `tsc` was clean at 09:18:12. **→ F2, F3.**
3. **09:16:24.** First real-browser render (718 s).
   - At phone size the page scrolled sideways by 990 px. `.nb-header-actions` (a design-kit class) was 1364 px wide, because the kit drew it inline-flex with nothing letting it shrink. **→ D05, F4.**
   - The journey check passed `/attendance` and could not reach the forms on `/classes` and `/courses`. **→ D08, F6.**
4. **Shipped as working.**
   - App.tsx's create/edit routes submit forms that only `console.log` ("In a real app, this would call the API"), and logout only logs. The authenticity scan saw at most one such handler per file and could not see inline `}}` handlers at all. **→ D06, F5 (detection); D07 is blocked on the user-facing decision.**
   - The summary lists user roles and promises a layout that "works across all device sizes". Meanwhile `ProtectedRoute` hardcodes `isAuthenticated = true`, and the phone check measured the opposite. **→ D10, blocked.**

## Prevention classes in this PR
| Fix | Class | Where | Locks |
|---|---|---|---|
| F1 | An undeclared package is a setup gap, not a code error: install it before the compile check, pinned where the platform has a pin, add-only. The sibling: the preview reconcile now reads the disk manifest when the lane wrote none. | `src/server/AgentV3/fastLaneDependencies.ts`, `routes/agentv3.ts` (`fastReconcileDependencies` in `fastVerifyOnce` before tsc and in `fastPreview`) | `tests/theSchoolAppsRouterWasNeverInstalled.test.ts`; M1, M1b, M2 |
| F2 | A contract type used and never imported gets `import type` (one owner, a TypeReference use, not local or a type parameter, and compiler-reported or not a TS lib global). | `ImportExportReconcile.ts` `addMissingProjectImports` (type arm) | `tests/theSchoolAppsTypesWereNeverImported.test.ts` (real tsc before/after); M3, M3b |
| F3 | A nested wrapper that shadows the import it wraps and calls it unconditionally is re-pointed at an aliased import. This runs first in the endgame, before unused-import removal, and in the fast-lane fixes. A prompt rule forbids the shape. | `ImportExportReconcile.ts` `fixSelfShadowedImports`, `EndgameRepair.ts`, `SimpleBuilder.ts` (`NO_SHADOWED_IMPORT_RULE`) | `tests/theHookThatCalledItself.test.ts` (executes the hook: RECURSION before, api calls after); M4, M4b, M5 |
| F4 | A header action row holding a whole nav may shrink and wrap; its chip row scrolls inside the screen. Seed history is regenerated, so the previous kit is still ours. | `designKit.ts`, `platformSeedHistory.ts` | `tests/theSchoolNavFitsAPhone.test.ts`; M6. Local Chrome (headless clamps to a 500 px viewport): overflow 673 px → 0 |
| F5 | Every log-only handler is reported, including inline JSX-attribute handlers closed by `}}`. | `AuthenticityAnalysis.ts` | `tests/theCreateFormThatOnlyLogged.test.ts`; M7, M7b |
| F6 | A page wrapped in a route guard (`element={<ProtectedRoute …><Page/></ProtectedRoute>}`) is still that route's page for journeys. | `journeyDerivation.ts` `routeFromRouter` | `tests/theFormBehindTheGuard.test.ts`; M8, M8b |

Nothing here repairs the historical app; nor does it claim the two unreachable BR1959 journeys would now pass. Their source files were not captured.

## Every item
| ID / queue | Origin / bucket | Problem | State |
|---|---|---|---|
| D01 / Q-2602 | report / workaround | Verify ran before any dependency reconcile; TS2307 react-router-dom ×5, a repair that cannot install, hand-off at 379 s (I112–I116). | IMPLEMENTED (F1), merge pending |
| D02 / Q-2603 | inspection / broken (latent) | fastPreview's reconcile read only the lane's writes, so with no package.json every import (react included) counted as undeclared and installed unpinned. | IMPLEMENTED (F1), merge pending |
| D03 / Q-2604 | report / struggle | api.ts contract types never imported (TS2304 ×7 kinds); the deterministic import fixer skipped type positions by construction. | IMPLEMENTED (F2), merge pending |
| D04 / Q-2605 | report / struggle | Six hooks shadowed and recursed into their api import; about 3 minutes of one-per-turn fixes. | IMPLEMENTED (F3), merge pending |
| D05 / Q-2606 | report / broken | Header nav 1364 px wide on a 390 px phone; RELEASE_GATE YELLOW (I384, I394). | IMPLEMENTED (F4), merge pending; historical app not repaired |
| D06 / Q-2607 | inspection / broken | Seven log-only create/edit submits and a log-only logout were invisible to the authenticity scan. | IMPLEMENTED (F5), merge pending |
| D07 / Q-2608 | report+inspection / broken | Those forms shipped as working; findings are agent-facing only. | 🟡 BLOCKED: whether they become a user disclosure or a paid heal is an admin decision (four fields in the queue) |
| D08 / Q-2609 | report+inspection / skip | Journeys /classes and /courses unreachable; guarded routes mapped to no file (I383). | IMPLEMENTED (F6), merge pending; the historical cause is not attributable |
| D09 / Q-2610 | report / skip | The platform pin `react-router-dom ^6` carries 2 moderate advisories; the fix is the 7.x major (I144, C00/C01). | 🟡 BLOCKED: major-version pin change needs an admin decision |
| D10 / Q-2611 | report+inspection / broken (honesty) | The summary lists user roles and says the app "works across all device sizes", while the guard always allows and the phone check measured 990 px of sideways scroll (I1, I384, captured App.tsx). | 🟡 BLOCKED: summary-claim corrections need an admin decision |
| D11 | report / self-heal | Two edit_file old_string misses; closest-match context recovered (I162, I308). | Not a defect |
| D12 | report / struggle | 8 read-only turns, ready-before-end 29 steps/343 s, TTFR 718 s, ETA 2.0× (I138, I361, I237, I7). | Covered by D01/D03/D04 |
| D13 | report / self-heal | Style resume (a11y labels in 3 files), spacing snap (padding/margin/gap only), one todo-only turn (I285, I364, I412). | Not a defect |
| D14 | report / skip | No unit tests (vitest undeclared), e2e scaffold not run, red team 0 cases, bug hunt unanswered (I358, I370, I372, I390, I395, I399). | Already handled; the red-team zero-case wording was fixed by BR1951 #4123 |
| D15 | report / self-heal | SIMULATED_RESULT_SHIPPED: api.ts is a real in-memory mock, disclosed by the existing rule (I397). | Already handled |

## Queue
- This commit closes the 29 BR1958 rows that #4132's merge resolved (Q-2568…Q-2584, Q-2590…Q-2601) and appends them to the closed register.
- Its four blockers (Q-2567, Q-2587, Q-2588, Q-2589) stay open, with their owner now `#4132 MERGED (59a03712d)`.
- All earlier debt stays as it was, including Q-2371 and the PR4109 ownership row.
- New rows are Q-2602…Q-2611: seven are implemented and three are blocked with what/why/needs/tried.

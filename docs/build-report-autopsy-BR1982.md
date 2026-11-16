# BR1982 — a weather-app request: leftover apply-patch markup landed in tsconfig, and the JSX flag was missing

Scope: BR1982 only, inside the frozen audit boundary 1951..2105. Branched from origin/main `faec0126745830ef6d34e16ebbba1e3f53b75cff` (BR1981: a fast-lane pass that saved no files is not a successful build). No PR or autopsy for BR1982 or later existed. Read only via `get_build_report` — no remote autopsy write, no replay, no deploy, no provider call. `src/server/AI/RouterOne/*` was not touched.

## What the user asked

Generic summary: a short request to make a weather app (search by city, current conditions, a rain hint, a five-day forecast). Distinctive request details and precise event timestamps are omitted from public evidence.

## Event sequence (wall-clock timestamps omitted)

1. **Stage.** FREE_BUILD_TIME_CAP 25 min. APP_SCOPE: ordinary one-shot. TIER_LADDER Weak default (GLM → KIMI → GLM). COMPLEXITY_ROUTING "COMPLEX (score 15, model)" — opens on the second rung; Surplus was admitted (qwen3-coder). TIME_TO_FIRST_CALL: 0s of preparation. ETA ~4–9 min (midpoint ~6 min, evidenced from recent unsized-app builds).
2. **Stage.** **SANDBOX_UNAVAILABLE** (E2B concurrent-sandbox cap of 20). The pre-#4146 goodbye said the engine was unavailable, files could not be created, and the user should try building again in a little while. Setup continued (project listing, CHANGE_CLASSIFIED: new app, PROJECT_MODE on for the account but not a mega-project).
3. **Stage.** The text-only fast lane still ran (pre-#4124). It generated a Vite React tree. One pass wrote two files and the workspace **refused** `src/types/weather.ts` with the syntax gate: `Unexpected "<<"`. `PLATFORM_WRITE_REFUSED` recorded that this file was not counted as written. About 20 seconds of repair did not make the tree compile. Fast-lane verify failed **TS6053** (`tsconfig.json` referenced `./tsconfig.node.json`, and that sibling was never written). Outcome: TYPECHECK_FAILED, handed off to the full builder. The lane salvaged 12 finished files, including a tsconfig and a weather types file that had landed from an earlier write.
4. **Stage.** A later snapshot of `tsconfig.json` (captured as a compile-error reference) is a valid JSONC object (DOM lib, `moduleResolution: "bundler"`, no `jsx` flag, no `references`) followed by leftover apply-patch SEARCH / REPLACE marker lines that were trying to delete a `tsconfig.node.json` reference. The syntax gate does not judge tsconfig JSONC, so that tail could be saved. `sanitizeTsconfigReferences` also cannot parse a file once that tail is present.
5. **Stage.** The sandbox later served the build (`SANDBOX_RECOVERED`). The full builder struggled: `tsc` was missing while install was still running; then TS17004 (`--jsx` is not set) plus a CSS side-effect import and `ImportMeta.env`; then an unused `React` import; an `edit_file` miss; `npm run build` against an older TypeScript that rejected `moduleResolution: "bundler"` / `allowImportingTsExtensions`; then default-import flags. Production build eventually succeeded.
6. **Stage.** The app rendered in a real browser (~11.5 min in), a form journey passed, phone layout was OK. Advisory CSS classes were missing and then healed. A readiness warning noted no error boundary (`autoResolved=true` here means non-blocking, not proof a boundary was added). An end-to-end starter suite was written but not run. Release gate **YELLOW** for 3 remaining dependency advisories that need a major-version upgrade (compatible fixes had already been applied). Charged a small free-tier amount (10% build discount applied). Duration ~16.0 min, 2.8× the ETA midpoint, over the band. Truncation complete. Outcome **succeeded**.

## Five-bucket tally

- ✅ **Self-healed (count: the recovered compile/CSS/install failures).** Sandbox recovered and served the app. Syntax-refused markup in a TypeScript file did not land. tsc-missing, unused import, default-import flags, bundler-option mismatch, and undefined platform CSS classes were later healed. A "no tests" readiness warning was withdrawn after the starter e2e suite was written.
- 🔀 **Worked around (count: 1).** Fast-lane TYPECHECK_FAILED handed off to the full builder (`SIMPLE_BUILD_FALLBACK`). The one-shot lane was then skipped because the plan was already multi-file.
- ⏭️ **Skipped / ignored.** Starter unit tests were not added (vitest not declared). The e2e suite was not run here. The deep bug hunt was offered and did not run. Explore skipped a form-submit control because the form check already covered it. READY_BEFORE_END: the app was never judged finished during the build, even after a real-browser render.
- ❌ **Still imperfect in the delivered result.** Remaining dependency advisories that need a major upgrade (YELLOW release gate). No evidence that an error boundary was actually added. The refused types write itself did not ship in that pass.
- 🥵 **Struggle.** E2B cap at setup; a goodbye that invited a retry while the build continued; a fast lane that ran against a workspace that had just failed setup; leftover apply-patch markup in tsconfig; TS17004 from a missing jsx flag; eight exploration turns with no project change after the hand-off; first real render at ~11.5 min; total ~16 min (2.8× the midpoint).

## The missing subsystem

A durable-write filter that treats leftover apply-patch / merge-conflict markers as corrupt content in **every** text file — not only in files esbuild can parse. tsconfig JSONC was the hole. Beside that, a tsconfig completeness backstop should add the official starter's `"jsx": "react-jsx"` when a DOM/app tsconfig is missing the flag, so TS17004 is not left for the full builder to discover.

## Root causes, and where main already closed them

| # | Defect in this report | Root cause on the deployed code | Closed on main by | Lock in this PR |
|---|---|---|---|---|
| D1 | After SANDBOX_UNAVAILABLE the text-only fast lane still ran | `fastLaneWouldRun` did not exclude a failed setup | **BR1952 (#4124)** `FAST_LANE_SKIPPED_SANDBOX` | `tests/br1982Autopsy.test.ts`: the skip is recorded and admission requires `!sandboxUnavailable` |
| D2 | The goodbye said files could not be created and invited the user to try building again, while the build continued | Pre-#4146 notice | **BR1961 F2 (#4146)** `sandboxUnavailableNotice` | Same file: this report's old goodbye is gone |
| D3 | Fast-lane verify failed TS6053 (`tsconfig.json` referenced `./tsconfig.node.json`, sibling absent) | A model-written tsconfig copied a Vite solution-style reference without writing the sibling | **BR1979 (#4241)** `sanitizeTsconfigReferences` | Same file: this report's dangling-reference-in-the-prefix shape is still stripped (and still stripped after a leftover apply-patch tail is dropped) |
| D4 | `src/types/weather.ts` was refused with `Unexpected "<<"`, so the syntax gate did its job for TypeScript | The model emitted leftover apply-patch markup as file content | Already on main: write-time syntax gate | Same file: this report's types-file shape is still a syntax error at line 4 |
| D5 | The same leftover apply-patch tail landed in `tsconfig.json` | tsconfig is treated as JSONC, so the syntax gate skips it; the reference sanitizer cannot parse the file once the tail is present | **This PR** — refuse line-start apply-patch / merge markers on a clean write (`conflictMarkerRefusal`, both write doors). A parseable tsconfig whose only fault is a trailing marker block is salvaged (prefix kept) before jsx / reference heals | Same file: this report's exact tsconfig is refused on a new write and salvaged by the sanitizer; neighbours cover clean files, in-string mentions, Markdown `=======` underlines, repair-in-progress, and the kill switch |
| D6 | Full-builder tsc failed TS17004 (`--jsx` is not set) on a model-written DOM tsconfig | The official starter sets `"jsx": "react-jsx"`, but a model rewrite can omit it. BR1980 declined a sanitizer because the official starter already has the flag; this report is a second instance of a model-written tsconfig without it | **This PR** — `ensureTsconfigJsx` adds `"jsx": "react-jsx"` only when the flag is absent, the tsconfig has a DOM lib, and it is not a Vue `jsxImportSource` / Node-only / already-set jsx | Same file and `TsconfigGuard.test.ts`: this report's prefix gains the flag; neighbours cover preserve/react, Node, Vue, `tsconfig.node.json`, and the official starter (untouched) |

The write-refusal wording for a typo-valid TypeScript file stays as it is. The syntax gate is not loosened (t311u).

## Side-effect review (owner rule t311u)

| Candidate | Adjacent behaviour | Risk | Decision |
|---|---|---|---|
| Skip the text-only lane when setup failed (already on main) | The tool-capable builder can still wait for recovery | None if left as shipped | Lock with tests only |
| Do not invite a second Start (already on main) | User-facing notice only | None | Lock with tests only |
| Strip a dangling `tsconfig.node.json` reference (already on main) | A Vite 5 solution-style tsconfig (files: [] + references only) is already left alone | None | Lock with tests only, including the "tail present, reference in the prefix" neighbour |
| Refuse leftover apply-patch / merge markers on a clean write | Repair of an already-marked file still allowed; indented or in-string mentions allowed; Markdown `=======` not treated as a marker | Low — there is no legitimate reason to save line-start markers into an app file | **Ship** |
| Salvage a parseable tsconfig by dropping a trailing marker block | Only when the prefix itself parses (JSONC). A file that starts with a marker is not invented | Low — the prefix is kept verbatim | **Ship** |
| Add `"jsx": "react-jsx"` when a DOM tsconfig is missing jsx | An existing jsx value is never overwritten. Node-only and Vue `jsxImportSource` are left alone. Adding the flag rewrites that file as strict JSON (JSONC comments in that one case are not preserved) | Low on official starters (already have jsx). Medium only if a DOM tsconfig deliberately omitted jsx — that tree already fails TS17004 on TSX | **Ship**, with neighbours |
| Auto-retry the sandbox or raise the E2B cap | Immediate retries under a hard cap of 20 can stampede (Q-2621) | High | Do not ship. Carry Q-2621 |
| Force a Vite major bump to clear remaining advisories | Changes bundler behaviour for generated apps (same class as Q-2362 / BR1980) | High | Do not ship. Carry Q-2362 |
| Add an error boundary automatically | Changes app structure; this report's `autoResolved=true` is not proof a boundary exists (Q-2367) | Medium | Do not ship. Carry Q-2367 |
| Retarget COMPLEXITY_ROUTING "COMPLEX (score 15)" for a short weather-app request | Changes every Weak opener | High | Do not ship |
| Strengthen the plan-only / exploration hand-back because 8 turns searched without writing | Q-2375 still needs a full prompt/tool-choice transcript; TODO_ONLY_TURNS on this report was none (this was exploration, not plan-only turns) | High | Do not ship. Do not add misleading evidence to Q-1068 / Q-2375 |

## Queue

This commit closes no existing row and opens no row. Q-2621, Q-2362 and Q-2367 gain this report's evidence and stay blocked. Q-2649, Q-2650, Q-2651, Q-2652, Q-2653, Q-2654, Q-2648, Q-2647, Q-2646, Q-2645, Q-2644, Q-2643, Q-2642, Q-2640, Q-2621, Q-2611, Q-2375 / Q-1068, Q-2662..Q-2672 and earlier blockers stay open.

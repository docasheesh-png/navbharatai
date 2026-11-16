# BR1989 — a short file header dropped a paid-for component, and an added helper file sat beside a same-named folder

Scope: BR1989 only, inside the frozen audit boundary 1951..2105. Branched from origin/main `eef10a4a3` (BR1988, #4259). Read only via `get_build_report` — no remote autopsy write, no replay, no deploy, no provider call. Routing, billing, Router One and Pro Chain V2 admission were not touched.

## What the user asked

Generic summary: a request for a small learning-themed app, phrased partly as a question about what its picture/icon should be. Distinctive request details, account/workspace/session/history/build identifiers and precise event timestamps are omitted from public evidence.

## Event sequence (wall-clock timestamps omitted)

1. **Stage.** Admitted as an ordinary one-shot app on the Weak path; Surplus ran the per-file fast lane. The plan listed about a dozen files, including a binary placeholder image and `package.json`; the file budget folded `package.json` into a component's purpose.
2. **Stage.** The shared contract was written as `src/types.ts`. No planned file owned the contract's one helper, so the lane added `src/utils.ts` — beside a planned `src/utils/` folder.
3. **Stage.** Per-file generation. The placeholder image call returned text bytes and the writer refused it. The component call answered with `<<<FILE path>>` (two closing brackets); the parser found no block, so the component was never counted, written or announced. A module inside `src/utils/` imported the helper from `./utils`.
4. **Stage.** The compile failed. The one repair round wrote the missing component and a second, identical copy of the helper as `src/utils/utils.ts`. The two missing React dependencies were installed. The app compiled, rendered in a real browser, passed the production build and was saved. Gate YELLOW (no data-entry journey to drive), billed a small amount at the normal Weak rate.

Outcome **succeeded**. The defects were wasted work and a duplicate file, not a broken app.

## Root causes

| # | Defect in this report | Root cause | Closed by | Lock |
|---|---|---|---|---|
| D1 | A generated component was silently dropped because its header ended `>>` instead of `>>>`; a repair round had to write it again | `parseFileBlocks` matched the header only with exactly `>>>`. The end marker had already been widened to `>{1,3}` (eed79815); the header had not | **This PR** — one shared definition `FILE_HEADER_CLOSE = '>{1,3}'` and `fileHeaderPath` (trim, unquote, strip stray `>`). The parser AND every header reader in `FastLaneContinuation` (tail path, tail body, resumed-file detection, duplicate-header strip, next-header check) use it, so a truncated file behind a short header is still treated as cut off and never shipped as finished. `TruncationRecovery` reads through the parser, so it follows automatically | `tests/br1989Autopsy.test.ts`: `>>>` byte-for-byte unchanged; `>>` and `>` parse; `>>>>` gives a clean path; mixed blocks stay apart; quoted, unsafe-path and mid-sentence neighbours; truncated short-header tail is still open; resumed short-header continuation welds instead of replacing the head; truncated-turn marker listed for rewrite; source pin that no `>>>`-only header regex remains. Mutations: header back to `>>>` (8 fail); tail reader alone back to `>>>` while the parser is widened (3 fail — the "cut-off file passed as finished" case) |
| D2 | `src/utils.ts` was added beside a planned `src/utils/` folder; a module inside the folder imported `./utils`, compile failed, and the repair shipped an identical duplicate `src/utils/utils.ts` | `utilOwnerFor`'s fallback always added `<contract dir>/utils.ts`, even when the plan had a same-named folder. That makes relative imports ambiguous, and would shadow a planned `src/utils/index.ts` barrel (a file wins over a folder index) | **This PR** — `newSharedHome`: an ADDED helper home goes to `<dir>/utils/helpers.<ext>` only when the plan has a `<dir>/utils/` folder (an already planned `helpers` file there becomes the owner, not a second file). Every owner the plan already names, helper-named files, beside-contract helpers and word matches are unchanged. Plans without such a folder get main's exact path. The shared-constants home (`valueOwnerFor`) is deliberately unchanged | Tests: folder ⇒ `src/utils/helpers.ts`; barrel not shadowed; planned `helpers.ts` reused; neighbours keep `src/utils.ts` (no folder, look-alike `utilsPanel`, nested `lib/utils/`), root and `.js` contracts; named/beside/by-name owners unchanged; constants home unchanged; same generation stage. Mutation: dropping the folder rule (5 fail) |
| D3 | A binary placeholder image was planned for a text-only lane and refused after a generation call | Plan was not checked for binary assets before generation | **Already on main (BR1952, #4124, merged after this build)** — a plan with a binary asset hands off to the tool-capable builder before any file call | Not changed |
| D4 | `package.json` was folded into a component's purpose, so React was missing from the manifest and had to be installed afterwards | The budget fold treated config files as co-locatable | **Already on main (BR1952, #4124)** — only JS/TS source modules fold; config, documents, styles, data and binaries keep their own paths | Not changed |
| D5 | The contract `src/types.ts` sat beside a planned `src/types/` folder that duplicated one type | Same file/folder class as D2, but on the contract path | **Not shipped** | The contract path is used across the lane, repairs and consumers; moving it is a wider change than this report proves. It compiled and rendered here. Candidate follow-up with its own neighbour tests |
| D6 | The release gate was YELLOW (no data-entry journey) | The app has no save/reload surface to drive | Not a defect — policy on main | Not changed |
| D7 | ETA was 4–9 min; the build took about 2.9 min (under the band) | The estimate is blended from recent builds of this kind; a quick fast-lane build lands under it | Not changed | Recalibrating ETA would move every build's estimate; it is measured, not invented (`etaAccuracy` records it) |
| D8 | The request also asked what the app's picture should be; the reply described the build and did not answer that part | The build path does not answer embedded questions | Not changed | Changing classification or adding an answer pass is a classifier/UX change (BR1985/1986 lesson) that needs its own Hindi/English tests and an owner decision |

## Side-effect review (owner rule t311u)

| Candidate | Adjacent behaviour | Risk | Decision |
|---|---|---|---|
| Widen the header in the parser only | A truncated file behind `>>` would be parsed as complete while the truncation check still missed it — a half file shipped as finished | High | **Rejected**; the parser and all continuation readers share one definition, locked by a mutation test |
| Widen the header in parser + continuation readers | More model replies parse; `>>>` output is byte-for-byte the same; mid-sentence mentions and unsafe paths stay rejected | Low | **Ship** |
| Also widen the secret redactor's envelope detector | It already treats an unrecognised envelope as one code region, which is the more conservative redaction path | Low benefit | Not changed |
| Move the added helper home into a same-named planned folder | Only when no planned file owns the helpers and such a folder exists; every other path is main's | Low | **Ship** |
| Apply the same folder rule to the shared-constants home (`data.ts`) | Not this report's failure; an existing test pins `src/data.ts` beside a data folder | Medium | Not shipped |
| Move the contract file away from a same-named folder | Touches every consumer and repair prompt | Medium–High | Not shipped (D5) |
| Change the bill | The charge used real recorded usage at the normal rate; nothing was invented | — | Not changed |

## Queue

This commit closes no existing row and opens none: D3/D4 were already closed by #4124; D5, D7 and D8 are recorded here as candidates, not defects that broke the app.

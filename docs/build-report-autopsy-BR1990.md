# BR1990 — a folded component's code was saved under its host file's path

Scope: BR1990 only, inside the frozen audit boundary 1951..2105. Branched from origin/main `a04d026ba` (BR1989, #4262). Read only via `get_build_report` — no remote autopsy write, no replay, no deploy, no provider call. Routing, billing, Router One and Pro Chain V2 admission were not touched.

## What the user asked

Generic summary: a short request for a simple calling-style app. Distinctive request details, account/workspace/session/history/build identifiers and precise event timestamps are omitted from public evidence.

## Event sequence (wall-clock timestamps omitted)

1. **Stage.** Admitted as an ordinary one-shot app on the Weak path. Workspace setup hit the provider's concurrent-sandbox cap, recorded `SANDBOX_UNAVAILABLE`, and told the user the engine was unavailable; the Surplus per-file fast lane still ran.
2. **Stage.** The plan listed a binary audio asset. The file budget folded one component into that asset's purpose ("ALSO INCLUDE IN THIS SAME FILE").
3. **Stage.** The asset's per-file call answered with ONLY the folded component's own file block. The per-file lane's first-block fallback took that block and tried to save the component's source under the asset's path; the binary-write guard refused it. The component was not written.
4. **Stage.** The compile failed (missing component, a contract name drift). One repair round fixed the drift; the second type-check could not execute in the sandbox. The five foundational files (package.json, index.html, Vite and TS configs) were added late because setup never scaffolded them. The full builder's type-check later still found errors after one repair (`OUTCOME_TYPECHECK_FAILED`, one issue opened). The app installed, rendered with no console errors, passed the production build, and `SANDBOX_RECOVERED` re-judged the setup failure. Gate YELLOW. Billed a small amount at the normal Weak rate.

Outcome **succeeded** (with type errors left open).

## Root causes

| # | Defect in this report | Root cause | Closed by | Lock |
|---|---|---|---|---|
| D1 | A folded component's source was saved (attempted) under its host file's path; the component itself was lost | `pickGeneratedFile` falls back to the reply's FIRST block when no block has the asked-for path. A host told to "also include" a folded file can answer with only that file's block. With a binary host the write was refused; with a JS host (the only host main can pick now) it compiles and the host's importers silently render the folded component | **This PR (narrowed after an independent review FAIL)** — when a fold happened and the reply has no block for the asked-for path, a first block whose path is one of the FOLDED paths is refused like an empty reply (null) **only when its content does not declare or export the host's own name** (`hostComponentName`: `Panel` from `Panel.tsx`, PascalCase from kebab/snake, the folder name for `index.*`; `declaresName` counts `function`/`class`/`const`/`let`/`var` declarations, `export default Name` and `export { … Name … }`, not imports, JSX or strings). A usable mislabelled host reply (host component plus folded one, under the folded header) keeps main's fallback and is saved under the host path. An undeterminable host name, an exact match, a slipped unknown name, another planned (not folded) file, a folded block that is not first, and every lane without a fold keep main's selection exactly | `tests/br1990Autopsy.test.ts` (26 tests): folded-only refused; five usable shapes under the folded header (combined function, const arrow, export list, `export default Name`, class) kept and identical to main; four refused shapes (folded only, imports the host, mentions it in JSX/strings, a longer name starting with the host name); host-name derivation incl. undeterminable → main; six neighbours and no-fold identical to main; a real `runSimpleBuild` with a folding plan: folded-only never written as the host, combined reply written under the host path as main, own-block host unchanged; wiring pin; the reviewer's probe gives main's result. Mutations (mktemp backups): refuse regardless of content (the first version) → 7 fail; never refuse → 6; declaration check counts any mention → 3; refusal removed → 2; lane not wired → 2 |
| D2 | A binary asset was planned for the text-only lane and chosen as the fold host | Plan was not checked for binary assets; the fold could pick any non-protected file as host | **Already on main (BR1952, #4124, merged after this build)** — a plan with a binary asset hands off to the tool-capable builder; only JS/TS source modules fold | Not changed |
| D3 | Setup failed on the concurrent-sandbox cap, the fast lane still ran against a bare workspace (no scaffold, so the second type-check could not execute and foundational files were added late), and the user was told files could not be created | Setup failure did not stop text-only lanes; the user notice said to try again | **Already on main (BR1961, #4146)** — `FAST_LANE_SKIPPED_SANDBOX` keeps text-only lanes off an unavailable workspace, and the notice says the engine is still being started and not to restart. `SANDBOX_RECOVERED` re-judges at the end | Not changed |
| D4 | The concurrent-sandbox cap itself | Provider account limit | **🟡 BLOCKED — Q-2621** (ops: quota / reclamation decision) | Evidence added below; no quota or config change |
| D5 | Type errors remained after the full builder's one repair pass (`OUTCOME_TYPECHECK_FAILED`, YELLOW gate) | The report does not retain the compiler output of that pass; the earlier errors (missing component, contract drift) trace to D1 and D3 | Not changed | Any further cause is in output the report did not keep; guessing would risk a fix that is not this report's DNA |
| D6 | The repair's answer also carried the missing component, but only the drift fix appears among the writes | Not established from the report (the reply is truncated in the record) | Not changed | Needs a fuller record; not guessed |

## Side-effect review (owner rule t311u)

| Candidate | Adjacent behaviour | Risk | Decision |
|---|---|---|---|
| Refuse a first block naming any OTHER PLANNED file (not just folded ones) | `tests/fastLaneWaste.test.ts` and real replies can answer a sibling's header with usable code; refusing would turn those into missing files and hand-offs | Medium | **Not shipped** (first draft; withdrawn after the neighbour test failed). Candidate follow-up with its own evidence |
| First PR version: refuse any first block naming a FOLDED path, whatever it holds | A usable host reply mislabelled with the folded header (host component plus the folded one) was saved correctly by main; this returned null, the host went missing and a **paid repair call** followed | **Medium–High** (my earlier "Low" was wrong) | **Withdrawn after independent review FAIL** |
| Refuse a folded-header first block only when it does not declare or export the host's own name; otherwise keep main | Only replies that cannot be the host's source are refused; a usable mislabelled reply is saved as main does; an undeterminable host name keeps main | Low (residual: a folded-only reply that happens to declare a same-named symbol is kept, i.e. main's behaviour) | **Ship** |
| Write the folded block into the host (merge) | Would invent a file layout the plan did not ask for | Medium | Not shipped |
| Change the sandbox quota or reclamation | Ops/billing decision | High | Not shipped (Q-2621) |
| Change the bill | The charge used real recorded usage at the normal rate; nothing was invented | — | Not changed |

## Queue

Q-2621 gains BR1990 evidence and stays blocked: setup hit the concurrent-sandbox cap and the sandbox later served the build. No row is closed. Lesson carried from BR1989: any parser or selection loosening is anchored and strictly validated and proven identical to main for normal input; this PR only tightens one fallback and pins six neighbours to main's verbatim selection.

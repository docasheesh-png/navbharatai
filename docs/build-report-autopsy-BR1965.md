# BR1965 — a succeeded Fix-with-AI continue of a NOVA AI assistant

Scope: BR1965 only, inside the frozen audit boundary 1951..2105. Branched from `e807060955468f5ec75468375cad16debb37745c` (the #4150 squash-merge of exact BR1964 head `6c9f6984f`, which is origin/main at branch creation). The parent reviews and merges this PR; BR1966 is not started. Nothing was replayed, deployed or reconfigured; no provider was called, and no autopsy was written to a remote service (`get_failed_build_autopsy` returns "Failed report not found in retained storage" for a succeeded build).

The optional Q-2632 follow-up is included. An opposite-class adversarial corpus of 360 eight-item lists (56 real "Handling loading …" / "Handling timeout …" product features, English / Hindi / Hinglish, built **before** the production edit) showed **0 LARGE→smaller**. Same-class lines such as "Handling loading, timeout and API errors" / "Handling loading, timeout and API errors properly" now match; "Handling loading screens for the exam evaluator" and "Handling timeouts from the payment gateway webhook" still count.

## Identity and evidence
- Prompt: **"Continue from where you left off and finish/fix the build so the app works end-to-end."** — this is the platform `CONTINUE_AND_FIX_BUILD_PROMPT` ("Fix with AI") sentence verbatim.
- Outcome **succeeded** (`ok=true`). Root cause recorded: the build completed; nothing is left open against the app. 6 problem(s) were recorded along the way (SANDBOX_CMD_FAILED, READINESS_WARNING) — each was fixed during the build or is an advisory. Model qwen3-coder (SURPLUS), weak (free) tier, vite-react. **Not charged** (`charged=false`). Sandbox cost $0.024347.
- Build `b759c9c6-0d4d-4364-932f-79203983f884`, workspace `agentv3-mxn412CI1VMdkgcPqGUyQY6beNx2-7e11df5d-5fbd-4c58-be4f-8de4bb7f4526`, history `1794109290517`, session `7e11df5d-5fbd-4c58-be4f-8de4bb7f4526`, report digest `ebece6c83224514cc84d8ac9f295bd6c1672970892f828e7bd2ff1fca1e396f2`, promptHash `b7502ebc`.
- Started **2026-11-08 09:11:30.517 IST**, ended **09:20:20.484 IST** (529.967 s / 8.83 min). User-wait 30000 ms (the unanswered deep bug-hunt offer). ETA shown 5.0–19.7 min (midpoint 6.2 min, `edit_unsized` / workspace); actual 500.0 s landed **inside** the band (not counting the 0.5 min wait; ratio 1.33).
- 245 issue entries (report count 244), 4 errors, 2 warnings, 4 auto-resolved, 2 leftOpen (the two types-mismatch advisories), 0 unresolved, 22 commands, 45 model calls (SURPLUS / qwen3-coder, 2,353,710 input / 5,244 output / 2,183,200 cache-read). Indexed in [the evidence file](build-report-autopsy-BR1965-evidence.json).
- Request analysis: `edit_unsized`, complexity 17, startTier gemini / cheapest band; Weak ladder opened on the second rung; Surplus admitted. APP_SCOPE: ordinary one-shot, no mega-signal (correct for this short platform continue). PROJECT_MODE on; this turn is not a fresh build, so no plan was created (correct).
- Original retained report bytes sha256 `b5a9fbe253215f74a0b27f9de6e393e5c274ed0d978dd39ad008a9cea3603ef4` (matches the fetch asset name). Pretty-printed copy sha256 `7f45f144b31032174ea3d7ac8523b767822f8abcbe62b99bcc32978bd7635cc9`. Digest matches the list_build_reports value.

## Five buckets (report-backed)
1 production classifier follow-up shipped after a passing opposite-class corpus (Q-2632) · 1 neighbour lock of this platform continue sentence's correct ordinary scope · 1 queued residual of this report (unpinned `@types/react` / `typescript` installs) · the rest not-a-defect / designed / existing siblings.

## What happened (IST, 2026-11-08)
1. **09:11:30.** FREE_BUILD_TIME_CAP: 25 min free (a paid build would get 29 min). APP_SCOPE ordinary one-shot, no mega-signal (**D01**, correct). Complexity COMPLEX 17 (`edit_unsized`); Surplus / qwen3-coder. TIME_TO_FIRST_CALL 0 s (the scope-classification call).
2. **09:11:30.** ETA ~5–20 min (midpoint ~6 min), labelled a rough guess (only 1 past build to learn from).
3. **09:11:34.** GRAPH_RESTORED_STUBS: 10 of 24 files in the project graph carried PLACEHOLDER facts from a cold resume (**D03**; the instrument fired as designed). Grounding then read 3 files (~260 tokens of a 4000-token budget).
4. **09:11:37–09:11:38.** CHANGE_CLASSIFIED as bug (risk medium, depth standard) and also feature; 3 requirements on record; impact 0 files at classify time. PROJECT_MODE: Software Project Mode is ON; this turn is not a fresh build, so no plan was created (**D02**, correct — a real mid-project instruction must not be steamrolled into "build module N").
5. **09:11:43–09:12:43.** The builder recognised the existing app as the NOVA AI personal assistant and found `src/lib/aiService.ts` still returning mock/demo replies. No `.env` and no AI SDK packages were present.
6. **09:13:06.** It replaced the mock with `window.NavAI` (`window.NavAI.ask`) — the documented host path for preview and published-app AI, not an invented API key (**D11**, correct). A fallback to demo replies when the host AI is unavailable was also added and later disclosed in the summary.
7. **09:13:32–09:13:36.** Preview live. TIME_TO_FIRST_RENDER 126 s. IN_BUILD_GREEN: the app rendered in a real browser — 27 files recorded as last known good (**D08**).
8. **09:14:02.** `npm run test -t aiService` failed: `vitest: not found` (exit 127). `npm install` recovered it; subsequent unit tests and `npm run build` passed (**D05**, self-healed).
9. **09:16:10–09:16:19.** The builder ran `npm install --save-dev @types/react @types/react-dom` with no version pin, then `./node_modules/.bin/tsc --noEmit` exited 127 (binary missing). It then ran `npm install --save-dev typescript` with no version pin (**D06**).
10. **09:16:29–09:16:48.** The new `tsc` rejected `baseUrl` (TS5102) and a side-effect import of `./index.css` (TS2882). The builder removed `baseUrl`, added `src/index.d.ts`, wrapped the root in an ErrorBoundary, and later `tsc` / `npm run build` / tests passed (**D07**).
11. **09:18:19.** READINESS_WARNING types-mismatch: `@types/react` and `@types/react-dom` are v19 but `react` / `react-dom` are v18. Both warnings are auto-resolved advisories (`leftOpen: 2`) and were not uninstalled. WRITE_TIME_TYPECHECK: 2 runs, 1 clean; 2 TypeScript writes were skipped before the compiler was ready (one because tsc was not installed yet; one because `package.json` had changed since the last install). READY_BEFORE_END: not measured, because this turn was an edit of files already in the project (**D12**, designed).
12. **09:18:34–09:19:07.** JOURNEY_PASSED (form submitted). MOBILE_LAYOUT_OK. EXPLORE_PASSED (6 controls: History, Attach Image, Voice Input, Settings, Chat, Stop Listening). PROD_BUILD_OK.
13. **09:20:16–09:20:20.** The deep bug-hunt offer went unanswered, so it did not run (**D10**, the 30 s user-wait). Build ended succeeded.

## Prevention classes in this PR
| Fix | Class | Where | Locks |
|---|---|---|---|
| F1 | Neighbour lock only (no production change). This platform continue sentence stays an ordinary/direct one-shot (not LARGE). It remains `CONTINUE_AND_FIX_BUILD_PROMPT` and is recognised as a platform continuation. | existing `analyzeAppScope` / `continueBuildPrompts` / `isContinuationMessage` | `tests/aContinueAndFixBuildStillEditsDirect.test.ts` |
| F2 | Q-2632 classifier follow-up. Whole-line `Handl(?:es?|ing) loading, timeout(s) and (API) errors` (optional properly/gracefully/correctly, optional period) so the English gerund matches, while "Handling loading screens for the exam evaluator" and longer "Handling timeouts from …" product sentences still count. | `QUALITY_WHOLE_LINE` in `enumeratedFeatures.ts` | `tests/aQualityChecklistIsNotTenFeatures.test.ts` |

## Side-effect review (owner rule t311u: no fix may create another problem)
| Fix | Adjacent behaviour checked | Side-effect risk | Decision |
|---|---|---|---|
| F1 | No production heuristic edited. Tests only lock this prompt's already-correct ordinary scope and the existing platform-continue constant. Intent / plan-advance behaviour of the three continue sentences is already locked by `theSurTaalAutopsy.test.ts` and is not re-specified here. | **None from production code** (none changed). | Kept as neighbour locks |
| F2 | Opposite-class corpus of 360 eight-item lists built **before** the edit (56 real "Handling loading …" / "Handling timeout …" product features, EN/HI/Hinglish, including the queue example "Handling loading screens for the exam evaluator" and extra-tail near-misses such as "Handling timeouts from the payment gateway webhook"). Versus current main: 345 stayed LARGE both before and after; 15 were already small on main because the Handling line itself contained "invoice" on restaurant/factory/exam templates without a big-software noun (pre-existing Q-2629-class `CLEARLY_SMALL`); **0 LARGE→smaller**, 0 smaller→LARGE, 0 opposite lines newly treated as quality. Reviewer locks (Responsive POS…, Keep existing order history…, Handling loading screens for the exam evaluator) stayed LARGE. Same-class "Handle(s) loading, timeout and API errors" lines still match; the gerund forms now match; "Handling loading, timeout and API errors!" still does not (Q-2627 remains queued). The errors-only Q-2626 pattern was not widened. | Line-level false drop of a genuine "Handling loading/timeout …" product feature, or an 8-item list dropping from LARGE to smaller. Measured: **none**. | Kept |

## Every item
| ID / queue | Origin / bucket | Problem | State |
|---|---|---|---|
| D01 | report / not-a-defect | APP_SCOPE ordinary one-shot, no mega-signal, for the short platform continue sentence. | Correct (locked by F1) |
| D02 | report / not-a-defect | PROJECT_MODE created no new plan because this turn is not a fresh build. | Designed / correct |
| D03 | report / designed instrument | GRAPH_RESTORED_STUBS: 10 of 24 files were placeholders from a cold resume. Grounding still read 3 files. | The instrument already exists (`theHollowGraphIsMeasured.test.ts`). Not independently proven harmful on this succeeded turn |
| D04 | report / designed | CHANGE_CLASSIFIED as bug + feature before any files were attributed. | Designed |
| D05 | report / self-healed | `vitest` missing (exit 127) until `npm install`. Tests then passed. | Not a leftover defect |
| D06–D07 / Q-2633 | report / blocked | Unpinned `npm install --save-dev @types/react @types/react-dom` then `typescript` on a React 18 app. `tsc` vanished (exit 127), then TS5102 (`baseUrl`) and TS2882 (CSS side-effect import). READINESS_WARNING left `@types/*` v19 vs `react` / `react-dom` v18. | Queued. DependencyAnalysis already flags the mismatch. Must not cap majors without an opposite-class of legitimate React 19 upgrades |
| D08 | report / context | Preview + IN_BUILD_GREEN at 126 s (27 files). | The app rendered; the turn then finished |
| D09 | report / not-a-defect | ETA inside the shown 5.0–19.7 min band. | Not a defect |
| D10 | report / not-a-defect | BUG_HUNT_NOT_RUN: offer unanswered (30 s user-wait). | Expected |
| D11 | report / not-a-defect | Mock `aiService` replaced with `window.NavAI.ask` (documented host path). Fallback to demo replies when the host AI is unavailable was disclosed. | Correct path; not a don't-fake defect |
| D12 | report / designed | READY_BEFORE_END not measured because this turn was an edit. | Designed |
| R1 / Q-2632 | BR1964 residual / implemented | "Handling loading, timeout and API errors" gerund. | **Implemented as F2** after 0 LARGE→smaller |
| R2 / Q-2625, Q-2627, Q-2628, Q-2629 | #4148 review / residual | Hindi QA lines; trailing `!`/ellipsis; Don't-fake greed; timer/clock `CLEARLY_SMALL`. | Still queued |
| R3 / Q-2630, Q-2631 | BR1964 / residual | Late style hand-back; 25-min cap after a green preview. | Still queued |

## Queue
- This commit closes Q-2632 (implemented as F2) and appends it to the closed register.
- New row is Q-2633 (unpinned `@types/react` / `typescript` installs on a React 18 app).
- Q-2625, Q-2627, Q-2628, Q-2629, Q-2630, Q-2631 stay open. Earlier blockers stay as they were.

## Q-2632 corpus (built first)
- 360 opposite-class 8-item lists from 56 "Handling loading …" / "Handling timeout …" product phrases × English / Hindi / Hinglish templates, plus slot-1 and slot-8 rotations. Corpus sha256 `21813d94f143d8e0a5c6db67adceaa29f9c7ecb0932254a4b20485caa94e40f2`.
- Before: 345 LARGE, 15 already small (invoice word / Q-2629-class). After: 345 LARGE, 15 small, **0 LARGE→smaller**. Delta: [q2632-adv-delta.json](build-report-autopsy-BR1965-q2632-adv-delta.json) sha256 `f6a4f6baf433c4ba4119ae21d42c5032e63498303e1ae5537e23626781ec895b`.
- Before measure sha256 `b823f7e8c4b99ddc2343e15284d9f290f219694b003231d63b7717218879848a`; after measure sha256 `b48f9c2c879a523f629c5e40ebe2af1df799cf61945da738adb4af4816d2d1b2`.

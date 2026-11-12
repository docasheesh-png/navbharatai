# BR1964 — a failed exam-analyse app that rendered, then hit the free 25-minute cap during late style polish

Scope: BR1964 only, inside the frozen audit boundary 1951..2105. Branched from `cc8cb585c6ed7d4de1be503be829cba1da7a9055` (the #4149 squash-merge of exact BR1963 head `edf173bfb`, which is origin/main at branch creation). The parent reviews and merges this PR; BR1965 is not started. Nothing was replayed, deployed or reconfigured; no provider was called, and no autopsy was written to a remote service (`get_failed_build_autopsy` returned `state: not_started`, `record: null`, digest matched).

The reviewer-suggested Q-2626 follow-up is included: whole-line `Handl(?:es?|ing)\s+errors(?:\s+(?:properly|gracefully|correctly))?\.?$`. An opposite-class adversarial corpus of 360 eight-item lists (56 real "Handling …" product features, English / Hindi / Hinglish, built **before** the production edit) showed **0 LARGE→smaller**. Same-class lines such as "Handling errors" / "Handling errors properly" now match; "Handling customer refunds for COD orders" and "Handling errors from the payment gateway webhook" still count.

## Identity and evidence
- Prompt: **"Mujhe higher exam hard exam analyse app banana hai"**.
- Outcome **failed** (`ok=false`). Root cause: `STOPPED` — the wall-clock cap (25 min) was reached before the build converged. **Not** stopped by the user. Model qwen3-coder (SURPLUS), weak (free) tier, vite-react. No `charged` / `sandboxCostUsd` field on this report (USAGE_NOT_REPORTED: streamed Surplus turns contribute 0 tokens, so shown cost is an under-estimate).
- Build `6d70928a-947d-48fd-8a16-102bd4429fcf`, workspace `agentv3-L3u4gnvvkTV45lz4nIDWeWwqVoo1-445e9eda-dc59-4985-9963-a34f04215689`, history `1794109267249`, session `445e9eda-dc59-4985-9963-a34f04215689`, report digest `1041906b9d7ddbe47e7939b2ac6deeeb58cee5eb13553dcb7d59c950dfc4f9a6`, promptHash `3ab683b7`.
- Started **2026-11-08 09:11:07.249 IST**, ended **09:36:10.214 IST** (1502.965 s / 25.05 min). ETA shown 8.4–15.4 min (midpoint 10.0 min, complex_app / platform); actual 25.0 min was **over** the band (2.5× the midpoint) because the cap cut it short (`withinBand: false`).
- 393 issue entries (report count 392), 2 errors, 3 warnings, 0 auto-resolved in `counts`, 4 unresolved, 27 commands, 88 model calls (SURPLUS / qwen3-coder). Indexed in [the evidence file](build-report-autopsy-BR1964-evidence.json).
- Request analysis: `complex_app`, complexity 58, startTier sonnet / standard band; Weak ladder opened on the second rung; Surplus admitted. APP_SCOPE: ordinary one-shot, no mega-signal (correct for this short prompt). PROJECT_MODE on, but not a mega-project (0 enumerated feature parts).
- Original retained report bytes sha256 `012fb9d38cbccf2b2a452bd95a2c90fa463240bc2998db8b0cdaa4f8dc189236` (matches the fetch asset name). Pretty-printed copy sha256 `76108fa584fdd3042c731656209da4f60f5b48bc15ef292c4170f6cce4e3ed74`. Digest matches the list_build_reports value.

## Five buckets (report-backed)
1 production classifier follow-up shipped after a passing opposite-class corpus (Q-2626) · 1 neighbour lock of this prompt's correct ordinary scope · 3 queued residuals of this report (late style hand-back; 25-min cap after a green preview; sibling `Handle(?:s|ing)?` on the loading/timeouts quality line) · the rest not-a-defect / designed salvage / existing siblings.

## What happened (IST, 2026-11-08)
1. **09:11:07.** FREE_BUILD_TIME_CAP: 25 min free (a paid build would get 58 min). REQUIREMENT_GAPS: domain=education, 5 likely-missing (roles, courses, enrolment/attendance, progress, fees) and 6 clarifying questions assumed. APP_SCOPE ordinary one-shot, no mega-signal (**D01**, correct). Complexity COMPLEX 58; Surplus / qwen3-coder.
2. **09:11:17.** PROJECT_MODE: on for the account, but this prompt is not a mega-project — normal path.
3. **09:15:37.** SIMPLE_BUILD_FALLBACK: fast lane generated 20 files in 259.2 s (generate 240.5 s) then stopped because the 2 stages left would need about 634 s against a 480 s complex-lane budget. Outcome BUILD_FAILED; 20 files salvaged (ExamForm, ResultCard, AnalysisChart, SubjectBreakdown, PerformanceSummary, ComparisonChart, StudyRecommendations, PrintReport, SettingsPanel, …). Typecheck of the salvage handed **8 errors** to the full builder (**D03/D04**, designed salvage).
4. **09:16:19.** EXPLORATION_WITHOUT_CHANGE: 8 model turns / 8 file-or-search calls after the last recorded change (1 hand-back). Then dependency advisories cleared (`npm audit fix`, C01).
5. **09:25:03–09:25:10.** Preview live. TIME_TO_FIRST_RENDER 842 s. IN_BUILD_GREEN: the app rendered in a real browser — 35 files recorded as last known good. From here the in-chat clock said "your app is already running in the preview — I'm finishing it" every two minutes.
6. **09:26:06.** TOOL_ERROR: `edit_file` old_string not found in `src/main.tsx` (**D10**, model miss).
7. **09:29:41.** WRITE REJECTED: syntax error in `src/App.tsx` (closing `main` vs opening `div`) — not saved (**D10**, the reject path working).
8. **09:31:20.** Budget steer: "Time is short — wrapping up so you get a working app rather than an unfinished one."
9. **09:34:50.** STYLE_RULES_RESUMED: 30 class names with no style rule and 1 file with a11y issues, handed back once. About **80 s** of the 25-minute cap remained; the style-pass cap itself is 180 s and does not consult remaining build time (**D07** → Q-2630).
10. **09:36:07–09:36:10.** OUTCOME_STOPPED / BUILD_TIMEOUT (1500 s). An `evaluate` call was still in flight. READY_BEFORE_END: the app was never judged finished. User-facing summary (RC-4 `deadlinePauseMessage(37)`): *"Time limit reached — 37 files changed so far. The previous work is still stopping. Please retry after it finishes."* (**D08** → Q-2631; the retry-after-exit wording is honest — this path cannot promise automatic continuation, unlike #4146's in-recovery goodbye.)

## Prevention classes in this PR
| Fix | Class | Where | Locks |
|---|---|---|---|
| F1 | Neighbour lock only (no production change). This short exam-analyse ask stays an ordinary/direct one-shot (not LARGE). Deadline-pause wording for 37 files still matches this report (RC-4). | existing `analyzeAppScope` / `deadlinePauseMessage` | `tests/anExamAnalyseAppStillBuildsDirect.test.ts` |
| F2 | Q-2626 classifier follow-up. Whole-line `Handl(?:es?|ing) errors` (optional properly/gracefully/correctly, optional period) so the English gerund "Handling errors" is quality, while "Handling customer refunds for COD orders" and longer "Handling errors from …" product sentences still count. | `QUALITY_WHOLE_LINE` in `enumeratedFeatures.ts` | `tests/aQualityChecklistIsNotTenFeatures.test.ts` |

## Side-effect review (owner rule t311u: no fix may create another problem)
| Fix | Adjacent behaviour checked | Side-effect risk | Decision |
|---|---|---|---|
| F1 | No production heuristic edited. Tests only lock this prompt's already-correct ordinary scope and the existing RC-4 deadline-pause sentence. Education-domain gap defaults are observed, not narrowed (a classifier change of their own). | **None from production code** (none changed). | Kept as neighbour locks |
| F2 | Opposite-class corpus of 360 eight-item lists built **before** the edit (56 real "Handling …" product features, EN/HI/Hinglish, including the reviewer's "Handling customer refunds for COD orders" and extra-tail near-misses such as "Handling errors from the payment gateway webhook"). Versus current main: 351 stayed LARGE both before and after; 9 were already small on main because the Handling line itself contained "invoice" on restaurant/factory/exam templates without a big-software noun (pre-existing Q-2629-class `CLEARLY_SMALL`); **0 LARGE→smaller**, 0 smaller→LARGE, 0 opposite lines newly treated as quality. Reviewer locks (Responsive POS…, Keep existing order history…) stayed LARGE. Same-class "Handle(s) errors" lines still match; "Handling errors!" still does not (Q-2627 remains queued). The sibling loading/timeouts pattern was **not** changed. | Line-level false drop of a genuine "Handling …" product feature, or an 8-item list dropping from LARGE to smaller. Measured: **none**. | Kept |

## Every item
| ID / queue | Origin / bucket | Problem | State |
|---|---|---|---|
| D01 | report / not-a-defect | APP_SCOPE ordinary one-shot, no mega-signal, for a short exam-analyse ask. | Correct (locked by F1) |
| D02 | report / not independently proven | REQUIREMENT_GAPS assumed school-management defaults (roles, courses, enrolment, fees). The salvaged files were an exam-analysis UI, not a school ERP. | Not independently proven causal; not narrowed |
| D03 | report / designed | Fast lane stopped after 20 files because remaining stages needed ~634 s vs a 480 s budget, then salvaged. | Designed (`FAST_LANE_COMPLEX_BUDGET_MS`). Not changed |
| D04 | report / context | Salvage typecheck handed 8 errors to the full builder. | Context for the later repair work |
| D05 | report / existing sibling | EXPLORATION_WITHOUT_CHANGE: 8 turns of reads after salvage. | Existing exploration-nudge debt; not re-opened |
| D06 | report / context | Preview + IN_BUILD_GREEN at 842 s (35 files). | The app *did* render; the failure is non-convergence after that |
| D07 / Q-2630 | report / blocked | STYLE_RULES_RESUMED at 09:34:50 with ~80 s left (30 classes + a11y) after the wrap-up steer. | Queued. Must not claim "complete" over missing styles (autopsy 2f723acb) |
| D08 / Q-2631 | report / blocked | 25-min free cap / BUILD_TIMEOUT / READY_BEFORE_END after a green preview. | Queued (billing / verdict). Cap not raised |
| D09 | report / consequence | ETA 2.5× over the shown 8.4–15.4 min band. | Consequence of D08 |
| D10 | report / not-a-defect | `edit_file` miss on `src/main.tsx`; WRITE REJECTED syntax error on `src/App.tsx`. | The reject path worked |
| D11 / Q-2375 | report / blocked sibling | 1 plan-only turn (7.8 s), first in the run, handed back. | Sibling of Q-2375 |
| D12 | report / advisory | USAGE_NOT_REPORTED (streamed Surplus). | Advisory, auto-resolved |
| D13 | report / not-a-defect | User-facing "Please retry after it finishes" (RC-4). Unlike #4146, this path cannot promise automatic continuation. | Honest; locked by F1 / existing `DeadlinePause.test.ts` |
| R1 / Q-2626 | #4148 review / implemented | "Handling errors" gerund. | **Implemented as F2** after 0 LARGE→smaller |
| R2 / Q-2632 | F2 sibling / residual | The loading/timeouts quality line still uses `Handle(?:s|ing)?`. | Queued, not changed |
| R3 / Q-2625, Q-2627, Q-2628, Q-2629 | #4148 review / residual | Hindi QA lines; trailing `!`/ellipsis; Don't-fake greed; timer/clock `CLEARLY_SMALL`. | Still queued |

## Queue
- This commit closes Q-2626 (implemented as F2) and appends it to the closed register.
- New rows are Q-2630 (late style hand-back), Q-2631 (25-min cap after a green preview), Q-2632 (sibling loading/timeouts gerund).
- Q-2625, Q-2627, Q-2628, Q-2629 stay open. The BR1961 blockers (Q-2620/2621/2622) and earlier debt stay as they were.

## Q-2626 corpus (built first)
- 360 opposite-class 8-item lists from 56 "Handling …" product phrases × English / Hindi / Hinglish templates, plus slot-1 and slot-8 rotations. Corpus sha256 `e2acd070d23f722fb930f499f2608ce1813b695c3fc3893c1e4faec983eeb7bc`.
- Before: 351 LARGE, 9 already small (invoice word / Q-2629-class). After: 351 LARGE, 9 small, **0 LARGE→smaller**. Delta: [q2626-adv-delta.json](build-report-autopsy-BR1964-q2626-adv-delta.json) sha256 `6da9ef4a840115b16ba0e5a0aeb77ad464c3d0ddd6b1f9a41766c149a161eb8e`.

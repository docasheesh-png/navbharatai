# BR1962 — a stopped "real AI" edit, and a Requirements checklist counted as ten features

Scope: BR1962 only, inside the frozen audit boundary 1951..2105. Base `568beed6c359c0999bc7cbaee9f3178188373fb2` (current origin/main; BR1961 PR #4146 squash-merged at 2026-11-10 09:21:49 IST after independent PASS of exact head `d9150bb84`). F1/F2 source and tests from that head byte-match main. The parent reviews and merges this PR; BR1963 is not started. Nothing was replayed, deployed or reconfigured; no provider was called, and no autopsy was written to a remote service.

## Identity and evidence
- Prompt: **"Now I want to make NOVA AI a real AI assistant."** plus a review note that `src/lib/aiService.ts` returns demo results, a nine-item Requirements checklist (inspect the file, connect a real service, Hindi/English, history, errors, never show fake replies, keep the existing design), and an instruction not to invent an API key. Test questions: "Who is the President of India?" and "भारत की राजधानी क्या है?".
- Outcome **stopped** (ok=false). Root cause recorded: stopped by the user — no failure of the app or the engine is implied. Model qwen3-coder (SURPLUS), weak (free) tier, vite-react. **Not charged** (`zeroBillReason`: stopped by the user before any file was written).
- Build `ad20309a-06c7-48c1-9249-6f2bae0dacf7`, workspace `agentv3-mxn412CI1VMdkgcPqGUyQY6beNx2-7e11df5d-5fbd-4c58-be4f-8de4bb7f4526`, history 1794109214932, report digest `be761ff8df441e62a271cee0657b80ef9af6a9730142aae2b7546c3c4d3b15af`.
- Started **2026-11-08 09:10:14.932 IST**, ended **09:10:27.407 IST** (12.5 s). User stop at **09:10:23.722 IST** (~8.8 s). ETA shown: 5.7–19.7 min (edit_unsized, 1 past build, unevidenced); the stop does not test completion time.
- 46 issue entries (report count 45), 0 errors, 0 warnings, 0 selected problems, 0 commands, 1 model call (admission classification, 2 output tokens), no file hashes. All are indexed in [the evidence file](build-report-autopsy-BR1962-evidence.json); there were no warnings or errors to map.
- No failed-build autopsy exists for a user-stopped build. None was written.
- **Evidence limits.** Nothing was written, so there are no generated files. No stored transcript beyond this prompt. The "Your review identified…" wording was not found as a platform template.

## Five buckets (report-backed)
1 broken (D01 false LARGE from a quality checklist) · 1 residual pin (R1 tarah-tarah, from the #4146 review) · 1 self-heal/correct-stop (D02) · 1 struggle (D03 ETA, not testable) · 6 context/skip = 10 rows: 2 implemented, 0 blocked, 8 not-a-defect / covered / not independently fixable.

## What happened (IST)
1. **09:10:14.** APP_SCOPE: *"LARGE — ~10 distinct features requested"* (I1). The shared enumerator (`countEnumeratedFeatures`) sees only three short named parts; `featureCount`'s legacy numbered tally counted all nine Requirements lines plus halved verbs (`support` / `with`) = 10. **→ D01, F2.** Complexity COMPLEX 27 (I3); Surplus admitted (I4).
2. **09:10:15.** User shown a rough estimate of ~6–20 min (I6, I7) and "Setting up your workspace". Warm sandbox, started-by-other, resumed 76 s earlier (I10). 27 durable files restored.
3. **09:10:17.** "Editing your existing app (25 source files) — I'll make targeted changes, not rebuild it" (I15). CHANGE_CLASSIFIED large/deep, impact 2 files + 2 dependents (I18). Software Project Mode is ON; this is not a fresh build, so **no plan was created** (I20). The LARGE signal therefore did not spend a planner call on this turn; it would on a new app.
4. **09:10:23.** USER_STOPPED_BUILD / OUTCOME_USER_STOPPED from the abort signal (I22, I23). Nothing written (I25, I37). RELEASE_GATE RED — honest: stopped before it could be finished or checked (I36). Upsell suppressed (I39). Final bill ₹0 (I40). Incremental "26/27 unchanged (1 changed)" is versus the last build, not a write this turn (I38).

## Prevention classes in this PR
| Fix | Class | Where | Locks |
|---|---|---|---|
| F1 | Hindi "X ke/ka tarah-tarah" / "X ke tarah tarah" is "various kinds of X", not "like X". Reviewer residual on #4146. Standalone still clones via first-line subject (6452c0a9) — not widened. | `appScopeAnalyzer.ts` (`HINDI_LIKE_AFTER` negative lookahead) | `tests/aProductKiTarahIsAClone.test.ts` |
| F2 | A numbered Requirements / QA checklist is not ten product features. Numbered (`1.`/`2.`) lines use the same `isFeatureLine` filters as the shared enumerator (MAX_ITEM_WORDS / attributes / style). Markdown bullets keep the previous `notAFeatureLine`-only tally so a picture's visual-element list still witnesses autopsy 19641ab5. Only ever a smaller count. | `enumeratedFeatures.ts` (`isFeatureLine`), `appScopeAnalyzer.ts` (`featureCount`) | `tests/aQualityChecklistIsNotTenFeatures.test.ts` |

## Side-effect review (owner rule t311u: no fix may create another problem)
| Fix | Adjacent behaviour checked | Side-effect risk | Decision |
|---|---|---|---|
| F1 | BR1961 `youtube ki tarah` / `YouTube ke tarah ek app` still clone; tool phrases and heading mentions stay direct; standalone "YouTube ke tarah-tarah ke videos" still clones via subject (6452c0a9). 8 scope suites (116 tests) green. | **Low.** Tightening (non-escalating) of F1 only when `tarah` is reduplicated. | Kept, with neighbour locks |
| F2 | Eight short numbered ERP features still LARGE; one-line comma list of eight modules still LARGE; `youtube ki tarah` still clones. Corpus 78,007: **0 decision changes** (analyze 282, famous 178). The BR1962 checklist is not in that repo-string corpus; it is locked by its own test. | **Low after measurement.** Only-ever-smaller count, the direction `featureCount` already claims. | Kept, with neighbour locks |

## Every item
| ID / queue | Origin / bucket | Problem | State |
|---|---|---|---|
| R1 / Q-2623 | #4146 review / broken (residual) | `ke/ka tarah-tarah` (various kinds) matched F1 likeness when the name was not in the first-line subject. | IMPLEMENTED (F1), merge pending |
| D01 / Q-2624 | report+inspection / broken | "~10 distinct features" / LARGE for a nine-item quality checklist (I1). Shared enumerator: 3. | IMPLEMENTED (F2), merge pending |
| D02 | report / self-heal | User stopped; nothing written; not charged; gate RED. | Not a defect |
| D03 | report / struggle | ETA 6–20 min; stopped at 0.2 min. | Not independently fixable |
| D04 | report / context | Existing-app edit; project mode created no plan. | Not a defect |
| D05 | report / context | Incremental "1 changed" vs last build. | Not a defect |
| D06 | report / context | Only an admission-classification call ran. | Not a defect |
| D07 | report / context | Warm sandbox started-by-other. | Not a defect |
| D08 | report / skip | Complexity 27 COMPLEX. | Not independently proven |
| D09 | report / skip | I1 promised a planner; I20 correctly skipped it on an edit. | Covered by D01 |

## Queue
- This commit closes the two BR1961 rows that #4146's merge resolved (Q-2618, Q-2619) and appends them to the closed register.
- Its three blockers (Q-2620, Q-2621, Q-2622) stay open, with their owner now `#4146 MERGED (568beed6c); blocker retained`.
- All earlier debt stays as it was, including Q-2371, the PR4109 ownership row, the BR1958 blockers (Q-2567, Q-2587, Q-2588, Q-2589) and Q-2608/2610/2611, plus the BR1960 blockers Q-2615/2616/2617.
- New rows are Q-2623 and Q-2624 (both implemented).

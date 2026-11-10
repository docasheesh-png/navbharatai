# BR1961 — "youtube ki tarah": a Hindi likeness was missed, then a sandbox goodbye invited a retry

Scope: BR1961 only, inside the frozen audit boundary 1951..2105. Base `a783809c39f5df1fac73528117f396753b546ee4` (current origin/main; BR1960 PR #4135 squash-merged as `9647e98c8` at 2026-11-09 14:57 IST). The parent reviews and merges this PR; BR1962 is not started. Nothing was replayed, deployed or reconfigured; no provider was called, and no autopsy was written to a remote service.

## Identity and evidence
- Prompt (this turn): **"Ab main us app par khud kuch ficar cenj kar sakta hu aur Koi nahin"**. Earlier in the same conversation, no app yet built: **"Mujhe youtube ki tarah ek app Banakar do"** (from L01 promptPreview). Outcome **succeeded** (ok=true). Model qwen3-coder (SURPLUS), weak (free) tier, vite-react. Not charged.
- Build `c6c509e8-2843-45cc-9f46-d1571d4c6127`, workspace `agentv3-jW4zKL3DZNSdHOY2oSe7Fl789KF2-1c70dd9f-4b3c-4804-85a3-5900c49c2363`, history 1794109089587, report digest `cd97069357ec3f40e8703bda9ec5c4c3f47714a4aba23f920ba97732e4941521`.
- Started **2026-11-08 09:08:09 IST**, ended **09:29:30 IST** (21.4 min; the ETA shown was 4.0–10.4 min, so the build finished over the band at 3.5× the midpoint). 0.5 min of that was waiting for an unanswered bug-hunt offer.
- 499 issue entries (the report's own count says 498), 9 errors, 41 warnings, 50 selected problems, 22 commands, 104 model calls and 32 file hashes. All are indexed in [the evidence file](build-report-autopsy-BR1961-evidence.json); every warning and error maps to a ledger row (the generator asserts this).
- The autopsy MCP has no failed-build autopsy for a succeeded build. None exists, and none was written.
- **Evidence limits.** No `generatedFiles` were captured. The earlier request is taken from the model-call prompt preview, not from a stored transcript. The I423 CLI error text is truncated in the report.

## Five buckets (report-backed)
3 self-heal (D07, D09, and D12's FIX_REVERTED) · 1 workaround (D03: wasted generation after sandbox unavailable, already #4124) · 4 skip (D05 capacity, D10 vulns, D11 advisory, D13 latent subject) · 3 broken (D01 likeness, D02 exclusive-access intent, D04 goodbye notice) · 4 struggle/consequence (D06 unseeded workspace, D08 generate_tests, D12 test-runner collision, D15 ETA) · 1 context (D14) = 15 rows: 2 implemented, 3 blocked, 10 already-handled / not-a-defect / covered.

## What happened (IST)
1. **09:08:09.** PLANNING_CONTEXT sized from this message plus the earlier request (213 characters read, this message 66) (I1). APP_SCOPE: *"ordinary one-shot app — no mega-signal"* (I2). Complexity simple (15). The earlier line alone, *"Mujhe youtube ki tarah ek app Banakar do"*, is a YouTube clone request (`ki tarah` = like). Concatenated, the follow-up is the first line, so `requestSubject` + `needsIntent` dropped YouTube because `ki tarah` was not a likeness word. The file planner still planned a YouTube-like video app from the earlier request. **→ D01, F1.** The follow-up's "I myself / no one else" was not read as access control (I16). **→ D02, blocked.**
2. **09:08:10.** SANDBOX_UNAVAILABLE: E2B concurrent sandbox cap of 20 (I11 detail). The user was told files could not be created and to try building again (I12). **→ D04, F2; D05 blocked (ops).** The build did not stop.
3. **09:08:22 → 09:09:41.** The fast lane generated 12 files (86.6 s) and every write was refused (PLATFORM_WRITE_REFUSED 13/13 twice). Hand-off BUILD_FAILED. **→ D03, already handled by #4124** (`fastLaneWouldRun = !sandboxUnavailable`), which landed the next morning.
4. **09:10:11 → 09:10:15.** Full builder also hit read failures and the same E2B cap (I89, I92), then writes started succeeding. The workspace had no starter (package.json and index.css missing). The model created them. First preview **09:16:12**, first render 496 s.
5. **09:16:42 → 09:24:29.** tsc failed and was fixed (self-heal). Platform e2e scaffold was written. `npm run test -- --exclude 'e2e/**'` crashed the CLI (I423); a later bare `npm run test` collected `e2e/smoke.spec.ts` (I427); jest-dom then failed (I455). A test-suite repair broke the working app and was rolled back (I474). RELEASE_GATE **YELLOW** (I479) — correct, given the suite did not pass. **→ D12.**
6. **09:29:27.** SANDBOX_RECOVERED (I488): setup failed at first, but the sandbox served the rendered app.

## Prevention classes in this PR
| Fix | Class | Where | Locks |
|---|---|---|---|
| F1 | Hindi "X ki/ke/ka tarah" immediately after a famous name is a likeness word, the same idea as "X jaisa" / "like X". Tighter than jaisa's 40-character window so a tool phrase plus "ki tarah" does not inherit a clone reason. | `appScopeAnalyzer.ts` (`HINDI_LIKE_AFTER`, `hasLikeness`) | `tests/aProductKiTarahIsAClone.test.ts` |
| F2 | When setup fails, do not tell the user to start the build again — the tool-capable builder keeps trying, and a second Start would consume another sandbox slot. | `agentv3.ts` (`sandboxUnavailableNotice`) | `tests/aBusySandboxIsNotAGoodbye.test.ts` |

## Side-effect review (owner rule t311u: no fix may create another problem)
| Fix | Adjacent behaviour checked | Side-effect risk | Decision |
|---|---|---|---|
| F1 | BR1960 tool phrases (youtube seo generator, video downloader) stay direct; "YouTube jaisa", "youtube clone", "Build me an Instagram" still escalate; "YouTube ka tournament" / "for YouTube players" stay audience-not-clone; a later "7. WhatsApp and Contact System" heading stays not a clone (6452c0a9); 23 scope suites (421 tests); Free and Pro (one analyser) | **Low after tightening.** Escalating direction, so the construction must be immediate. Corpus 78,007 strings: **0 decisions changed**. Residual locked: an earlier "Build me an Instagram" without a likeness word still misses when a follow-up is line 1 (Q-2622). | Kept, with neighbour locks |
| F2 | Existing Fix 62 test (temporarily unavailable; no E2B/payment/403 leak); the notice is only emitted at initial setup failure; the empty-build terminal summary is separate | **Low.** Copy only. The build already continues after this notice (and after #4124 skips the fast lane). | Kept |
| (D02) | requestScope sign-in words | **High.** "koi nahin" is common Hindi and would false-add login. | Dropped → Q-2620 |
| (D05) | E2B cap of 20 | **High.** Immediate retries stampede. Sibling of Q-2567. | Dropped → Q-2621 |
| (D13) | requestSubject over every paragraph | **High.** Reopens 6452c0a9 (headings as subjects). | Dropped → Q-2622 |

## Every item
| ID / queue | Origin / bucket | Problem | State |
|---|---|---|---|
| D01 / Q-2618 | report+inspection / broken | "youtube ki tarah" in an earlier request missed after a follow-up first line (I2). | IMPLEMENTED (F1), merge pending |
| D02 / Q-2620 | report+inspection / broken (intent) | "khud … koi nahin" not treated as exclusive access (I16). | 🟡 BLOCKED: product decision |
| D03 | report / workaround | Fast lane generated 12 files after SANDBOX_UNAVAILABLE; all writes refused (I11, I57, I74). | Already handled by #4124 |
| D04 / Q-2619 | report / broken (honesty) | User told to try building again while the build continued (I12). | IMPLEMENTED (F2), merge pending |
| D05 / Q-2621 | report / skip (infra) | E2B concurrent sandbox cap of 20 (I11 detail, I89, I92). | 🟡 BLOCKED: ops/capacity |
| D06 | report / struggle | Unseeded workspace after failed setup (I171, I184, I393). | Covered by recovery + #4124 |
| D07 | report / self-heal | tsc failed, then passed. | Not a defect |
| D08 | report / struggle | generate_tests empty functions (I293). | Not a defect |
| D09 | report / self-heal | npm install testing-library / vite 8 failed, later succeeded. | Not a defect |
| D10 | report / skip | 4 remaining dependency advisories need a major (I321). | Disclosed; same class as Q-2610 |
| D11 | report / skip | Design consistency 98/100, 13 colours (I397). | Not a defect |
| D12 | report / struggle | Test runner exclude CLI crash; e2e/smoke collected; FIX_REVERTED; gate YELLOW (I423–I479). | Existing guards; CLI error truncated |
| D13 / Q-2622 | inspection / skip (latent) | Earlier "Build me an Instagram" without likeness still missed after a follow-up first line. | 🟡 BLOCKED: would reopen 6452c0a9 |
| D14 | report / context | CHANGE_CLASSIFIED new app (I18) — correct, no earlier app existed. | Not a defect |
| D15 | report / struggle | ETA 3.5× over the band. | Consequence of D03 |

## Queue
- This commit closes the three BR1960 rows that #4135's merge resolved (Q-2612, Q-2613, Q-2614) and appends them to the closed register.
- Its three blockers (Q-2615, Q-2616, Q-2617) stay open, with their owner now `#4135 MERGED (9647e98c8); blocker retained`.
- All earlier debt stays as it was, including Q-2371, the PR4109 ownership row, the BR1958 blockers (Q-2567, Q-2587, Q-2588, Q-2589) and Q-2608/2610/2611.
- New rows are Q-2618…Q-2622: two implemented and three blocked with what/why/needs/tried.

# BR1960 — YouTube SEO generator: a tool for a product was read as a clone of it

Scope: BR1960 only, inside the frozen audit boundary 1951..2105. Base `e29e893db6222cc3ea76ef322effbc1343bd2826` (BR1959 PR #4134 merged). The parent reviews and merges this PR; BR1961 is not started. Nothing was replayed, deployed or reconfigured; no provider was called, and no autopsy was written to a remote service.

## Identity and evidence
- Prompt: **"Create a html code of youtube seo generator"**. Outcome **succeeded** (ok=true). Model qwen3-coder (SURPLUS), weak (free) tier, vite-react. Charged ₹0.16.
- Build `71738e8d-10c7-4954-88c8-c32cba0ae517`, workspace `agentv3-V5WFOLu2szWL9f9yaL6OGLDHiUo1-7fdaaa82-1c95-4e65-8761-57ed3c2a1c41`, history 1794109058331, report digest `1946f7973c2fb3d4e79b396252ce0de5131cc96e9fec5cbe97a09a6934dad1b8`.
- Started **2026-11-08 09:07:38 IST**, ended **09:11:06 IST** (3.5 min; the ETA shown was 4.0–10.4 min, so the build finished under the band).
- 136 issue entries (the report's own count says 135), 2 warnings, 0 errors, 2 selected problems, 3 commands, 19 model calls and 24 file hashes. All are indexed in [the evidence file](build-report-autopsy-BR1960-evidence.json); every warning maps to a ledger row (the generator asserts this).
- The autopsy MCP has no failed-build autopsy for a succeeded build. None exists, and none was written.
- **Evidence limits.** No `generatedFiles` were captured; the delivered files are known only by hash and by names in issue and model-call previews. Which two controls the explorer dropped (I111) is not in the report: the code path is read, and the shape is reproduced on a reconstructed page in real Chrome, not read from the build.

## Five buckets (report-backed)
4 self-heal (D03, D04, D09, D10) · 1 waste (D01) · 3 skip (D05, D08 latent, D13 disclosed) · 3 broken (D02 intent, D06 and D07 admin honesty) · 1 struggle (D11, benign) · 1 context (D12) = 13 rows: 3 implemented, 3 blocked, 7 not-a-defect/already-handled/covered.

## What happened (IST)
1. **09:07:38.** APP_SCOPE: *"LARGE — clone of YouTube"* (I1). The complexity router scored the same request **simple (15)** (I3). `scopeDispute` stands a famous-name escalation down only when the prompt also carries a small-app word, and "SEO generator" is not one, so the escalation stood. **→ D01.**
2. **09:07:47.** The mega-roadmap planner ran: an extra **8.8 s** model call (L01), the user-facing line *"YouTube SEO is a big app — I'll build a working SEO tool for video creators first …"* (I7), a 5-checkpoint roadmap (I6), and Project Mode deferred to it (I22). **→ F1.**
3. **09:07:47 → 09:09:43.** The fast lane planned 15 files for a React + Vite app, although the user asked for "html code" and the roadmap's own step text said "HTML + JavaScript". **→ D02, blocked.** The model used three CSS classes it never defined; one repair round (12 s, L18) defined them, and DESIGN_KIT_KEPT restored dropped kit rules (I89). **→ D04, self-heal.**
4. **09:09:44.** `react` and `react-dom` were installed as imported-but-undeclared (I76). This is BR1959 D02 / Q-2603, fixed by #4134 after this build ran. **→ D03.**
5. **09:10:08 → 09:10:29.** First real-browser render (141 s); a racing write meant the first green was not saved, and the later one was (I101 → I126). No journey was derived, because the only action is "Generate", not a submit word (I109), so RELEASE_GATE stayed **YELLOW** (I119). **→ D05, blocked.** The explorer said *"No control on the home screen was safe to press (2 found, all deliberately skipped)"* and recorded no detail (I111). **→ D07, F3.**
6. **09:11:03.** FE_BE_PARTITION: *"9 frontend, 1 backend … A clean full-stack split exists"* (I125). The one "backend" was `src/services/seoAPI.ts`, a client-side mock fetcher in an app with no server. **→ D06, F2.** Its sibling, the CSP scan's skip, is pinned rather than changed. **→ D08, blocked.**

## Prevention classes in this PR
| Fix | Class | Where | Locks |
|---|---|---|---|
| F1 | A famous name followed by a tool noun ("YouTube SEO generator", "Instagram caption generator", "WhatsApp chat analyzer", "Uber fare calculator") names what the tool works on, not a product to clone. A likeness word on either side ("like", "jaisa", "clone", "copy") still wins. | `appScopeAnalyzer.ts` (`TOOL_FOR_AFTER` in `namesAsProduct`) | `tests/aToolForAProductIsNotAClone.test.ts` |
| F2 | `src/services/`, `src/api/` and `src/models/` directly under the source root are a client layer ('shared') unless the same file set carries an unambiguous server signal. The single-path `classifyFile` is unchanged, and the CSP scan keeps the old reading through `clientLayerAsBackend: true`. | `frontendBackendPartition.ts`, `CspMetaAnalysis.ts` | `tests/aClientServiceFolderIsNotAServer.test.ts` |
| F3 | A sentence that claims a reason must have recorded one. `collect()` counts controls it drops silently (hidden, disabled, error overlay, our badge, repeat), the summary carries `dropped`, and the message and detail name them. The old sentence is kept byte-for-byte when nothing was dropped or the runner is older. | `clickExplorer.ts` | `tests/aSkipIsNamedOrNotClaimed.test.ts` |

## Side-effect review (owner rule t311u: no fix may create another problem)
| Fix | Adjacent behaviour checked | Side-effect risk | Decision |
|---|---|---|---|
| F1 | Real clone asks (plain, with a tool noun after, Hinglish likeness, "app like X with a … generator", "Build me an Instagram"); `scopeVerdict` / Project Mode; existing tournament, audience, spec-name and study-racer rules (21 suites, 374 tests); Free and Pro (one code path; no client, chat or device dependency) | **Low.** It moves in one direction only: it can remove a clone reason, never add one. Measured with origin/main against the branch over 78,007 strings (every prompt-like literal in the test suite plus 1,524 real report app labels): **exactly one decision changed, the BR1960 prompt** (famous detections 179 → 178). Residual: a real clone written as "&lt;Name&gt; &lt;tool noun&gt;" with no likeness word now builds directly. Complexity and feature-count signals still escalate it on their own. | Kept, with neighbour locks |
| F2 | Real backends (`server/`, `backend/`, `src/server/services`, root `api/`, `src/app/api`, `pages/api`, `src/routes`, `*.server.ts`, migrations); a server tree beside `src/services`; monorepo client packages; the CSP scan; serviceGraph | **Low after narrowing.** The only behaviour that changes is the admin-only FE_BE_PARTITION advisory (auto-resolved info; no gate, user text, tier or device difference). The CSP scan, the one agent-facing consumer, is pinned to its old skip, so it produces no new findings. Residual: a turn that edits only `src/services/*` in a project whose server was written in an earlier turn now reads "shared" (the advisory measures this turn's writes by design). | Kept, narrowed (CSP pinned; widening it is Q-2617) |
| F3 | Older runner output (no `dropped`); all-zero drops; `chosen > 0` with no presses; a passing run and the user's proof card; the 8-entry safety skip list; generated-module syntax (existing `node --check` test); every other explorer suite | **Low.** It changes admin text only: code, outcome, pressed, failures and gates are unchanged, and the user card for "nothing" stays empty. Drops are counts, so they cannot crowd out safety-skip entries. | Kept, with neighbour locks |
| (D02) | resolveFrameworkSelection on client (AgentV3Panel) and server (agentv3) every turn | **High.** It could re-route edits on existing React projects and add framework-conflict dialogs. | Dropped → Q-2615 |
| (D05) | Release gate semantics | **High.** A new journey kind could make a YELLOW gate falsely GREEN, or fail working async tools. | Dropped → Q-2616 |
| (D08) | CSP findings reach the agent | **Medium.** An agent could add a CSP meta that blocks the app's own scripts. | Dropped → Q-2617 |

## Every item
| ID / queue | Origin / bucket | Problem | State |
|---|---|---|---|
| D01 / Q-2612 | report / waste | "LARGE — clone of YouTube" for a simple SEO tool; roadmap planner +8.8 s, "a big app" message (I1, I6, I7, I22, L01). | IMPLEMENTED (F1), merge pending |
| D02 / Q-2615 | report+inspection / broken (intent) | "html code" produced a 15-file React app (I86). | 🟡 BLOCKED: product decision; every-turn detection risk |
| D03 | report / self-heal | react/react-dom installed as undeclared (I76, C01). | Already handled by #4134 (Q-2603) |
| D04 | report / self-heal | Three undefined CSS classes, one 12 s repair (L18); design-kit rules kept (I89). | Not a defect (existing guards; class context already supplied) |
| D05 / Q-2616 | report / skip | No journey for a compute-only "Generate" tool; RELEASE_GATE YELLOW (I109, I119). | 🟡 BLOCKED: new gate feature |
| D06 / Q-2613 | report+inspection / broken (admin honesty) | A client mock in `src/services/` counted as backend; "clean full-stack split" (I125). | IMPLEMENTED (F2), merge pending |
| D07 / Q-2614 | report+inspection / broken (admin honesty) | "all deliberately skipped" with nothing recorded (I111). | IMPLEMENTED (F3), merge pending |
| D08 / Q-2617 | inspection / skip (latent) | The CSP scan never runs on an SPA with a client `src/services/` layer. | 🟡 BLOCKED: pinned in F2 on purpose |
| D09 | report / self-heal | IN_BUILD_GREEN_RACED, later saved (I101, I126). | Not a defect |
| D10 | report / self-heal | SIMULATED_RESULT_SHIPPED, disclosed (I123). | Already handled |
| D11 | report / struggle (benign) | ETA 0.58×, under the band (I8). | Not a defect; F1 removes the misrouted planner |
| D12 | report / context | "15 file(s)" against "23 files" are different scopes (I86, I124). | Not a defect |
| D13 | report / skip (disclosed) | Write-time typecheck not reached in the fast lane; no starter tests; e2e not run; red team 4/4 (I92, I98, I99, I115, I121). | Covered by existing disclosures |

## Queue
- This commit closes the seven BR1959 rows that #4134's merge resolved (Q-2602…Q-2607, Q-2609) and appends them to the closed register.
- Its three blockers (Q-2608, Q-2610, Q-2611) stay open, with their owner now `#4134 MERGED (e29e893db); blocker retained`.
- All earlier debt stays as it was, including Q-2371, the PR4109 ownership row and the BR1958 blockers (Q-2567, Q-2587, Q-2588, Q-2589).
- New rows are Q-2612…Q-2617: three are implemented and three are blocked with what/why/needs/tried.

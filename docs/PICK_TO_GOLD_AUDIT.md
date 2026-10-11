# PICK-TO-GOLD AUDIT

**Requested by the admin, 2026-10-11, as an external suggestion** ("NAVBHARATAI — PICK-TO-GOLD MASTER
UPGRADE", 38 phases). Produced under `CLAUDE.md`'s **external-suggestion rule**: the text is raw material,
adapted to this codebase, with proposals corrected where they contradict what actually makes the engine
stronger. Nothing here is taken from documentation — **every claim below was verified by reading code**,
and the file and line are given so the next session can re-check instead of re-deriving.

Audited at `origin/main` = `23ece92a1`. Scale: **4,711 TS/TSX files, 185,184 lines**, 1,543 test files.

---

## 🔴 THE HEADLINE, STATED BEFORE THE DETAIL

**The suggestion is written as if NavBharatAI were a greenfield project. It is not.** Of the 38 phases,
**24 are already built**, 7 are partial, and 4 are genuinely missing. More importantly:

**Two of its proposals would make this product measurably worse**, because they would replace designs this
repo adopted *after* paying for the alternative:

| Proposal | Why it is a regression here |
|---|---|
| **Phase 6** — "Production Readiness Score: 94/100", weighted categories | `releaseGate.ts` had a 0–100 confidence number and **deleted it on purpose**. Its header records why, verbatim: *"an app whose preview never came up … an app about which we know NOTHING — scores 100%, band HIGH."* A weighted average **cannot express "we did not look"**, and it structurally inflates: security at 15% failing still prints **85/100**, which reads as good. The four-state gate (RED / YELLOW / GREEN / **UNKNOWN**) is strictly more honest and is the fix for the exact defect Phase 6 re-introduces. |
| **Phase 2** — 13 named agents (`ArchitectAgent`, `FrontendAgent`, … `ReviewerAgent`) | `CLAUDE.md`'s external-suggestion rule names this exact shape as the thing to correct: *"a 30-independent-agent relay that our coherence architecture rejects"*. The real problem Phase 2 is pointing at is true (see **F1**), but the fix is **extracting the orchestration that already exists**, not spawning twelve more model-calling roles for one app. |

The suggestion's own Phase 30 ("NO FAKE FEATURES") is already **`CLAUDE.md`'s second absolute rule**, enforced
in CI by `fakeFeatureScan.ts` and `NO_FAKE_FEATURE_RULE`. Phase 38's acceptance criteria are already the
standing definition of done.

---

## A. Current architecture

```
Client (React/Vite, src/)            Server (src/server/, server.ts at repo ROOT)
  AgentV3Panel ──────────────────►   routes/agentv3.ts ... 26,187 lines  ← the orchestrator, inlined
  ViewPanels (figma, apk, seo,         ├─ AgentRunner.ts (1,625)   one agent's turn loop
   domain, team, pwa, …)               ├─ AgentRegistry.ts (479)   roles + their prompts
  DiffViewer, FigmaImporter,           ├─ ToolCatalog.ts (3,889)   tool schemas
  AppAnalytics, AppHealthMonitor,      ├─ ToolDispatcher.ts (11,423) tool execution + write-time guards
  PerformanceAnalyzer, SecretManager   ├─ BuildDiagnostics.ts (4,152) the evidence ledger
                                       ├─ releaseGate.ts (509)     RED/YELLOW/GREEN/UNKNOWN
                                       ├─ tierLadder.ts (486)      model routing (3 tiers)
                                       └─ sandbox/.../E2BActuator.ts (3,489) real cloud VM
```

Runtime: `runtime/RuntimeRouter.ts` (110) + `runtime/PreviewService.ts` (132). Deploy: Cloud Build →
Cloud Run (`cloudbuild.yaml`). Governance: `docs/constitution/` (11 volumes) + `CLAUDE.md` + the
`BUILD_REPORT_QUEUE.md` contract.

## B & C. Existing capabilities and strengths (verified in code)

The suggestion's phases, mapped to what is already here:

| Phase | Asked for | Status | Evidence |
|---|---|---|---|
| 3 | Autonomous browser agent | **built** | `clickExplorer.ts` (1,161), `signInExplore.ts` (469), `PageRouteCheck.ts` (520), `journeyDerivation.ts` (1,742) |
| 4 | Autonomous repair loop | **built** | `AutoFix.ts` (542), `explorerRepair.ts` (402), plus the incomplete-code / boot-killer / render heals in the route |
| 5 | Evidence ledger | **built** | `BuildDiagnostics.ts` (4,152) — phase/severity/code/`autoResolved` per item, `deliveryProof.ts`, `renderProof.ts` |
| 6 | Release verdict | **built, stronger** | `releaseGate.ts`: `CheckOutcome = 'passed' \| 'failed' \| 'not-run'` — *"`not-run` is a first-class outcome, never folded into a pass"*; `JourneyOutcome` adds `'unreachable'` and `'none-derivable'` |
| 7 | Security gate | **built** | `ComplianceAnalysis.ts` (257) + the repo-wide P0–P3 audit merged as #3538 |
| 8 | Accessibility gate | **built** | **three** modules: `AccessibilityAnalysis.ts`, `AppMakerLab/intelligence/A11yLinter.ts`, `lib/a11y.ts`; `PageRouteCheck.ts` runs six deterministic in-browser checks |
| 9 | Performance gate | **built** | `PerformanceAnalyzer.tsx`, `scripts/bundleBudget.mjs` (CI step `test:bundle`) |
| 10 | One-click backend | **built** | `postgresProvision.ts`, `lib/supabaseProvision.ts`, `lib/supabaseProvisionFlow.ts`, `routes/supabaseIntegration.ts` |
| 12 | Project memory | **built** | `WorkspaceMemory.ts` (868) — graph, symbols, components, routes, audit trail |
| 13 | Visual editor, AST-safe | **built** | `VisualEditPatcher.ts` (335) |
| 16 | **Figma import** | **built** | `FigmaImporter.tsx` + `routes/figmaProxy.ts` + `tests/figmaProxy.test.ts`, mounted in `server.ts`, listed in `AppKnowledgeBase.ts` |
| 17 | Git-native workflow | **built** | `routes/github.ts`, `publishRollback.ts`, `DiffViewer.tsx` (538) |
| 19 | Analytics | **built** | `AppAnalytics.tsx` + `lib/siteAnalytics.ts` |
| 24 | Business primitives | **built** | `AgentV3/goldenScaffolds/` (`appsA`, `appsB`, `aiImage`, `proShell`, …) |
| 25 | Model routing | **built** | `tierLadder.ts` — three tiers, three ladders, single source of truth |
| 26 | Cost estimate **before** execution | **built** | `PreflightEstimate.ts` → `estimateBuildCost()`; `PaidGate.ts`: *"Pre-flight estimated billed cost of THIS build, in ₹"* |
| 30 | No fake features | **built, absolute** | `fakeFeatureScan.ts` + `NO_FAKE_FEATURE_RULE` in every lane; it is `CLAUDE.md`'s second absolute rule |
| 31/32/36 | Tests, security, docs | **built** | 1,543 test files; CI has 12 gates; `docs/` + `docs/constitution/` (11 volumes) |

⚠️ **Three of these I first concluded were missing**, and was wrong each time — recorded because it is
`CLAUDE.md` safeguard #6 in action, not trivia:

- **Cost estimate**: searched `estimateCost`, `costEstimate` → nothing. The real name is **`PreflightEstimate`**.
- **Screenshot-to-app**: a search for `vision` "found" `supabaseProvision.ts` — the substring in **pro-VISION**.
  A false *positive* is as misleading as a false negative.
- **Figma**: assumed aspirational because the suggestion proposes it; it has a server route and a test.

## D. Existing gaps (genuinely missing — verified absent, not merely unfound)

| # | Gap | Phase | Verified by |
|---|---|---|---|
| **D1** | **No design canvas** — no "generate 3 concepts → pick → refine" surface | 14 | no file matches `canvas\|designConcept`; no route |
| **D2** | **No visual database/schema designer** — provisioning exists, a schema UI with relations/indexes/migration preview does not | 11 | no file matches `schema.*\|erd` as a designer; `postgresProvision.ts` provisions only |
| **D3** | **No screenshot-to-app path** — the vision *plumbing* exists (`visionDescribe.ts`, `visionChain.ts`, `visionModels.ts`) but nothing turns an image into a layout+components | 15 | no caller joins vision output to a build plan |
| **D4** | **No generic connector framework** — Supabase and GitHub are bespoke integrations; there is no `AUTH/READ/WRITE/WEBHOOK/SEARCH/ACTION` model with per-action permission boundaries | 18 | only `routes/supabaseIntegration.ts`, `routes/github.ts`, `routes/figmaProxy.ts` — three one-offs |

## E. Duplicate systems

- **E1 — Three accessibility implementations**: `AccessibilityAnalysis.ts`, `A11yLinter.ts`, `lib/a11y.ts`,
  plus six checks inside `PageRouteCheck.ts`. This is the `safeRelPath` drift pattern (four copies) at an
  earlier stage. **Not yet a defect — a defect waiting**: the moment two disagree about one rule, a user
  gets two verdicts about one app.
- **E2 — `BakeoffMetrics.ts` scores builds** while `releaseGate.ts` grades them. Different purposes
  (harness vs product), but both own "how good was this build", and only one is user-facing.

## F. Dangerous technical debt

- **F1 — `routes/agentv3.ts` is 26,187 lines**, and it is where the orchestration lives: intent, planning,
  lane selection, heals, gates, billing and the verdict are all inline in one Express handler. Every
  concurrency conflict this repo has had in the last week landed in it. **This is the single highest
  structural risk in the codebase**, and it is the real target Phase 2 is gesturing at.
- **F2 — `ToolDispatcher.ts` is 11,423 lines** and carries six pre-shell guards plus every write-time
  note. It is coherent, but it is one file away from F1's condition.
- **F3 — The evidence ledger's severity vocabulary is `error | warning | info` only** (verified: those are
  the only three literals in `BuildDiagnostics.ts`). `releaseGate.ts` has `'not-run'`, `'unreachable'` and
  `'none-derivable'` — so **the gate can say "we did not look" and the ledger feeding it cannot.** That
  asymmetry is exactly the class this repo keeps paying for: one fact, two readers, one of them told.
- **F4 — Queue claims are invisible until a PR's diff is read.** Four duplications happened in one day
  (2026-10-04/05). A row is claimed *after* the work, and a PR's title need not mention the row it claims.

## G. Already implemented → see **B & C** (24 of 38 phases)

## H. Partially implemented

| Phase | What exists | What is missing |
|---|---|---|
| 2 Orchestrator | `ProjectPlan.ts`, `PlanIntelligence.ts`, `AgentRegistry.ts`, `AgentRunner.ts` | no extracted orchestrator **layer**; the lifecycle is inline in F1 |
| 3 Browser safety classes | `PressVerdict` incl. `'skipped'` with a reason; conservative skip list (*"Order summary" is skipped while "Borders" is not*) | not the 5-level `SAFE/CAUTION/DESTRUCTIVE/FINANCIAL/EXTERNAL_SIDE_EFFECT` model, and the classification is per-label, not per-action-kind |
| 5 Evidence ledger | per-item phase/severity/code | **F3**: no `not-run` / `blocked` / `skipped` severity |
| 20 Post-deployment agent | `AppHealthMonitor.tsx`, `lib/jobLease.ts` (scheduled-job lease) | no scheduled agent that opens production, diagnoses and files an incident |
| 23 Mobile testing | Android workflows + `e2b-android.Dockerfile` | no MobileAgent (tap/swipe/logs/crash) feeding the same ledger |
| 27 Approval system | `CommandGovernance.ts` (risk classification, audit), green-freeze, permission questions | risk levels are **not unified** across browser / connectors / DB / deploy / GitHub |
| 12 Memory scoping | `WorkspaceMemory` is workspace-scoped | no explicit `USER / PROJECT / BUILD / SESSION` scopes |

## I. Documented but NOT implemented

- **Phase 21 native Android (Kotlin/Jetpack Compose) is not a gap — it is a REFUSAL, on purpose.**
  `unsupportedStack.ts` detects the request (*autopsy 042e472f: "Technology: Kotlin, Jetpack Compose …"*)
  and instructs the builder: *"Never write … Gradle, Kotlin, Swift, Dart, Xcode or AndroidManifest files
  and never claim the app is native."* Phone apps ship via Capacitor bundling (`CLAUDE.md`). **So Phase 21
  asks to reverse a standing decision** — that is the admin's call, not mine (see the ledger below).
- `COMPETITIVE_ANALYSIS_2026.md`, `MISSION_10_10.md`, `ROADMAP.md`, `VAJRA_V4_DESIGN.md` and
  `docs/constitution/VOLUME-10-SELF-IMPROVEMENT.md` already cover much of Phases 34–37's intent. Phase 37
  asks for a new benchmark doc; one exists.

## J. Requires architecture change (do NOT attempt incrementally)

- **F1 extraction** — moving the lifecycle out of a 26k-line route. Needs its own plan, and it is the one
  change most likely to collide with every other live session.
- **D4 connector framework** — a permission model that spans six subsystems.
- **Phase 22 iOS** — the suggestion itself says not to build a fake pipeline. Agreed: an abstraction
  (`MobileTarget`) first, and only if Phase 21's refusal is reversed.

## K. Can be implemented incrementally (safe, high value)

1. **F3 — give the ledger the vocabulary the gate already has** (`not-run` / `skipped` / `blocked`).
   Small, additive, and it closes a one-fact-two-readers asymmetry on the honesty path. **This is the
   recommended first change.**
2. **E1 — collapse the three accessibility implementations to one** before they drift.
3. **H/Phase 3 — promote `clickExplorer`'s skip list into an explicit action-risk classification**, reusing
   `CommandGovernance.ts`'s existing `RiskLevel` rather than inventing a second vocabulary.
4. **F4 — a one-command queue-claim check** (read every open PR's `BUILD_REPORT_QUEUE.md` diff).
5. **D1/D2/D3** — real features, each shippable alone, none of them blocking.

---

## Resolution ledger for the 38 phases

```
ALREADY IMPLEMENTED (24): 3 4 5 7 8 9 10 12 13 16 17 19 24 25 26 28 29 30 31 32 33 35 36 38
PARTIALLY (7):            2 6(stronger-not-weaker) 11* 20 23 27 34
NOT IMPLEMENTED (4):      14 15 18 and 11/D2
BLOCKED — ADMIN DECISION (3):
  · Phase 21 native Kotlin — reverses `unsupportedStack.ts`, an autopsy-driven refusal. Needs: the
    admin's word that native Android generation is in scope. Tried: nothing — flipping it unilaterally
    would break the second absolute rule (half-built native output is worse than an honest refusal).
  · Phase 6 numeric score — I recommend AGAINST it, with the evidence above. Needs: the admin to either
    accept the four-state gate as the answer, or overrule me knowing it re-creates the 100%-with-no-
    evidence defect.
  · Phase 2's 13 agents — I recommend AGAINST the agent count and FOR the extraction (F1). Needs: the
    admin's agreement on which half of Phase 2 to build.
REJECTED WITH REASONS (0 silently) — every disagreement above is argued, not dropped.
```

**What this audit deliberately does not do:** implement anything. Per the suggestion's own Phase 0 and
`CLAUDE.md`'s safeguard #3, the next step is the smallest high-value change (K1), not a 38-phase march.

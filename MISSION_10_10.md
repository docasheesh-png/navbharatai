# MISSION 10/10 — Phase 0 Forensic Audit

**Date:** 2026-08-11 · **Auditor:** Claude Code session `app-control-deployment-q1wq51`
**Codebase at audit:** `main` @ `879a018` · 318 AgentV3 modules · 289 co-located test files (91%) ·
1,179 test files · **14,070 tests passing**

---

## THE HEADLINE, STATED PLAINLY

This platform is **strong on implementation and weak on proof**.

Nearly every capability the directive asks for already exists, is wired, and has tests. What almost
none of it has is **field evidence** — measured behaviour on real users' real builds. The directive's
own §3 says a subsystem is 10/10 only when implementation *and* real-world verification are both
satisfied, and §39 forbids claiming a score without it.

Applied honestly, that caps most dimensions at **7–8**, not because the code is weak but because
**we have not yet measured it**. The scorecard that would measure it shipped today (`#2277`,
`/api/admin/builder-scorecard`) and currently contains **zero builds**.

**So the single highest-value action is not to build anything. It is to run real builds through the
measurement we now have.** Every score below marked `UNKNOWN` becomes knowable within days of real
traffic, at no engineering cost.

### What this audit is NOT

It is not a list of things to construct. Three large external directives have now been reviewed
against this codebase in one session; the first two both described systems that already existed, and
one of them would have re-broken a shipped fix (`launchAutoHide`, which had already bricked the app
once). The pattern is consistent: **the gap is rarely the feature, it is the evidence.**

---

## SCORECARD

Scoring rule, applied uniformly:

| Score | Meaning |
|---|---|
| 9–10 | Implemented, wired, tested **and** verified against real-world runs |
| 7–8 | Implemented, wired, tested — **no field evidence yet** |
| 4–6 | Implemented but partial, unwired, or unreliable |
| 1–3 | Stub or missing |
| `UNKNOWN` | Cannot be assessed without a real device / real run — **not guessed at** |

| # | Dimension | Score | Evidence | Gap |
|---|---|---|---|---|
| 1 | AI Intelligence | **8** | `ComplexityClassifier`, `PlanIntelligence`, `EscalationOrchestrator`, `ContextReranker`, `AgentRegistry`, `SubAgent`, `Reflection`, `RecalledLessons` — all tested | No measured routing-quality data |
| 2 | Code Generation | **7** | 24 scaffold providers, `CodemodeExecutor`, `SyntaxCheck`, `TruncationRecovery`, `DuplicateImportGuard` | First-pass rate exists (`firstPassQuality`) but is unread |
| 3 | Runtime | **7** | 24 providers; `detectDevFramework`, `PortDiscovery`, dev-server watchdog (#2264) | Only vite-react is exercised routinely; others untested in the field |
| 4 | Preview | **8** | `PreviewVerify`, `PreviewHealth`, `PreviewGuard`, `GreenGuard`, `browseUrl`, `console_errors`, screenshots | Reliability rate unmeasured |
| 5 | Full Stack | **6** | `postgresProvision`, `MigrationPlanner`, `authFlowSpec`, `userStorageContext`, `apiGraph`, `schemaGraph` | **Multi-service is described, not RUN** (#2278) — the genuine gap |
| 6 | Auto Repair | **8** | `AutoFix`, `EndgameRepair`, GA-8 repair ladder, `HealLedger`, integrity/design/runtime heal gates | Repair success rate unmeasured |
| 7 | Verification | **7** | `TscGate`, `LintGate`, `testRunner`, `e2eScaffold`, `e2eAutoScaffold`, `RouteSmokeCheck`, `Readiness` | **No autonomous E2E journey derivation** (§7) — real gap |
| 8 | Security | **8** | `CommandGovernance`, `shellCommandSafety`, `SecretLeakAnalysis`, `CodeSafetyScanner`, `threatModelAnalysis`, `PlatformSourceGuard`, E2B isolation | **No adversarial test suite** (§4) — real gap |
| 9 | Cost | **8** | `providerRates`, `ProviderUsageLedger`, tiered markup, `FastLaneBudget`, `costAlert`; attribution fixed today (#2261) | One documented exemption remains (`makeFastTextRunner`) |
| 10 | Memory | **8** | `WorkspaceMemory`, `adrMemory`, `engineeringMemory`, `MistakeLedger`, `FleetMistakeLedger`, `KnowledgeEvolution`, `BuildLessons` | Lesson-reuse effectiveness unmeasured |
| 11 | Existing-App Evolution | **7** | Edit mode, `ContextReranker`, `couplingAnalysis`, diff-scoped review (#2267) | Edit-survival curve computable (#2277) but **no data** |
| 12 | Scalability | `UNKNOWN` | `fileBudget`, `BuildConcurrency`, `Bm25`, `EmbeddingSearch` exist | Never benchmarked at 500/1000/5000 files |
| 13 | Performance | **6** | `BundleSize`, `heavyImportAnalysis`, `queryPatternAnalysis`, `queryOptimizerAnalysis` | Advisory only; no perf gate |
| 14 | Accessibility | **6** | `AccessibilityAnalysis`, 44px touch targets, `prefers-reduced-motion` honoured | Not part of the release gate (§17) |
| 15 | Deployment | **8** | `Deployment`, `DeployProviders`, Vercel/Netlify/Cloudflare/Render, `PostDeployLiveness` | Deploy success rate unmeasured |
| 16 | Long-Term Reliability | `UNKNOWN` | `BuildCheckpoints`, `CheckpointStore`, `GitManager`, regression memory | **100/500/1000-edit survival never run** |

**OVERALL: 7.3 / 10 on implementation — `UNKNOWN` on field performance.**

Reporting one blended number would hide exactly the distinction that matters, so it is not given.

---

## THE FOUR GENUINE GAPS

Everything else is "built but unmeasured". These four are actually absent:

1. **Multi-service execution (§6).** The service graph describes topology (#2278) but nothing starts a
   second process. Deliberately staged that way: the graph records `SERVICE_GRAPH_MULTI` so we learn
   how often a real project even has a second service before building a runner for it.
2. **Autonomous E2E journey engine (§7).** Scaffolding exists; deriving and executing realistic
   journeys (signup → create → refresh → verify persistence) does not.
3. **Adversarial security tests (§4).** Strong controls exist; nothing actively attacks them
   (path traversal, command injection, malicious package scripts, process explosion).
4. **Benchmarks (§9, §36).** No golden suite, no edit-survival curve. **See the cost warning.**

---

## ⚠️ THE COST WARNING — READ BEFORE APPROVING ANY BENCHMARK PHASE

The directive says "operate autonomously, do not wait after every phase". That is right for code. It
is **wrong** for the benchmark phases, and the directive never states why:

**Each benchmark build is a real build, spending real money on real providers.**

Measured on this platform *today*: **₹150–₹567 per build.**

| Benchmark | Builds | Realistic cost |
|---|---|---|
| §9 500-edit survival (one app) | 500 | **₹75,000 – ₹2,80,000** |
| §36 Golden suite (10 apps) | 10+ | ₹1,500 – ₹6,000 |
| §11/§12 100/250/500 edits × suite | thousands | **lakhs** |

This is not compute time. It is the admin's Anthropic/GLM/Kimi spend.

**I will not start a benchmark phase without explicit budget approval**, per §44 (stop conditions).
Everything else proceeds autonomously.

A far cheaper substitute exists and is already shipped: `/api/admin/builder-scorecard` computes edit
survival from **real user projects**. It costs nothing, it cannot be gamed (§53 forbids nursing a
curated benchmark), and it measures the projects people actually keep.

---

## PHASE PLAN

| Phase | Work | Cost | Approval |
|---|---|---|---|
| 0 | This audit | free | ✅ done |
| 1 | Architecture invariants (§10) — machine-readable, checked before edits | free | autonomous |
| 2 | Adversarial security suite (§4) | free | autonomous |
| 3 | Multi-service **runner** (§6) — only if the graph shows real demand | free | autonomous |
| 4 | E2E journey derivation (§7) | free | autonomous |
| 5 | Error taxonomy (§24) + release gate states GREEN/YELLOW/RED/UNKNOWN (§23) | free | autonomous |
| 6 | Accessibility + performance into the gate (§17, §26) | free | autonomous |
| 7 | Fast-lane cost attribution (the one open exemption) | free | **needs decision** — moves real money both ways |
| 8 | Golden benchmark suite (§36) | ₹1.5k–6k | **needs approval** |
| 9 | Edit-survival benchmark (§9) | ₹75k–2.8L | **needs approval** |

Phases 1–6 begin immediately, one at a time, each reported in the required format.

---

## PER-PHASE REPORT FORMAT

```
PHASE:
STATUS:
CURRENT SCORE:
TARGET:
WHAT CHANGED:
TESTS:
BENCHMARK:
REGRESSIONS:
NEXT PHASE:
```

---

## PHASE 0 REPORT

```
PHASE:          0 — Forensic audit
STATUS:         VERIFIED
CURRENT SCORE:  7.3/10 implementation · UNKNOWN field
TARGET:         10/10 with evidence
WHAT CHANGED:   No code. MISSION_10_10.md created.
TESTS:          14,070 passing (1,179 files); 289/318 AgentV3 modules have co-located tests
BENCHMARK:      NOT RUN — see the cost warning
REGRESSIONS:    None (audit only)
NEXT PHASE:     1 — Architecture invariants
```

**No score in this document is 10/10, and none will be until there is evidence behind it.**

---

## PHASE 1 REPORT

```
PHASE:          1 — Architecture invariants (§10)
STATUS:         SHIPPED (implementation) · UNVERIFIED (field)
CURRENT SCORE:  Dimension 11 (Existing-App Evolution) 7 → 7. Unchanged ON PURPOSE: the mechanism
                is in, but the scoring rule in this document says 9–10 needs field evidence, and
                there is none yet. Claiming 8 for shipping code would be the exact inflation §39
                forbids.
TARGET:         9 once real edit builds show ARCHITECTURE_INVARIANTS_HELD dominating
                ARCHITECTURE_INVARIANT_VIOLATED, and edit survival (#2277) holds across 20+ edits.
WHAT CHANGED:   src/server/AgentV3/architectureInvariants.ts — a project's own architectural rules,
                READ OUT OF its code, never a house style of ours. Six kinds: styling system,
                internal import style, API hub, state store, client/server layering, page location.
                • PREVENT — rendered into the edit prompt before the model writes a line. Derived
                  from the already-warm project graph, so it costs zero extra file reads.
                • DETECT — the files the build changed are checked against the rules derived from
                  the project as it was BEFORE the build. Deterministic, no model call, advisory.
                Wired in src/server/routes/agentv3.ts (both halves). Kill switch
                AGENTV3_ARCH_INVARIANTS=off. ARCHITECTURE_INVARIANT_VIOLATED added to
                NEVER_ROOT_CAUSE — a consistency note must never be blamed for a build.

                THE GAP IT CLOSES: every gate we own judges a file on its OWN merits. Not one asked
                "is this how THIS app is built?" So an app is degraded not by one bad edit but by
                fifty locally-reasonable ones, and the whole stack stays silent through all of them.

                WHAT IT DELIBERATELY DOES NOT DO: three of the six invariants are stated to the
                builder but never checked. A new useState does not violate "shared state lives in
                the store", and accusing it would be a false alarm — false alarms are what teach
                people to ignore a report. Layering is checkable but stays with
                ArchitectureAnalysis; two modules reporting one defect is how they drift apart.
                A project that genuinely uses two styling systems gets NO styling rule at all.
TESTS:          14,181 passing (1,184 files), up from 14,070. 46 new, most of them about the cases
                where the honest answer is "this project has not decided that" — including the
                self-exoneration trap: judged against the project as it BECAME rather than as it
                WAS, the very edit that broke a rule dissolves the rule and reports itself clean.
                Both the file list and the dependencies read out of the graph are filtered to the
                baseline for that reason.
BENCHMARK:      NOT RUN — no cost incurred, per the cost warning above. The field evidence arrives
                free, from real edit builds, through the two new report codes.
REGRESSIONS:    None. tsc (frontend + server) clean; full suite green. Every path is advisory and
                best-effort — it cannot fail, block or slow a build, and a fresh build derives no
                invariants at all, so the prompt is byte-identical to before.
NEXT PHASE:     2 — Adversarial security suite (§4)
```

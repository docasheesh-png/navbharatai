# NavBharatAI Pro v3.0 — Hardening & Greatness Roadmap

> **Purpose:** Turn v3.0 from "production-ready engine, dormant behind a flag" into
> the **world's best AI app maker** — rock-solid, fully-working, no half-done parts.
> **Method:** This roadmap is built on a **ground-truth code audit** (3 deep
> code-reading passes over `src/server/AgentV3/`, `routes/agentv3.ts`, and
> `components/agentv3/` on 2026-06-26 — not memory). Every "have / half / missing"
> claim below is anchored to real files.
> **Companion docs:** `NAVBHARATAI_PRO_V3_DESIGN.md` (locked decisions), `PROGRESS.md`
> (living state), `CLAUDE.md` (constitution).

> **Rule reminder (CLAUDE.md):** every item ships **real, fully-wired, or not at
> all**. No "looks done". Every change: branch → commit → CI green → merge.
> AppKnowledgeBase entry for every user-facing surface.

---

## 0. Ground-truth snapshot (what actually exists today)

A surprising amount is **already real and wired** (contradicting the earlier
"delivery-optimized, never verifies" worry). Honest current state:

| Area | Status | Evidence |
|---|---|---|
| Native tool-use agent loop (honest, never fakes success) | ✅ GOLD | `AgentRunner.ts` — `builtNothing → ok:false` |
| 22-dimension objective quality gate (`evaluate`) | ✅ REAL — but **agent-invoked, not mandatory** | `ToolDispatcher.ts` `evaluate`, `Readiness.ts`, `BuildConfidence.ts` |
| Actuators E2B/Local/Docker (E2B default, real sandbox) | ✅ GOLD | `sandbox/EngineerAI/actuators/*` |
| Billing markup (NORMAL ×3.5 / POWER ×2.5) recorded in Firestore | ✅ GOLD | `pricing.ts`, `UserCostStore.ts` |
| Hard **per-build** budget cap ($25 default, honest abort) | ✅ GOLD | `AgentRunner.ts` budget guardrail |
| Git-native storage (clone→push, PR→CI→merge, user-owned repos) | ✅ REAL — flag-gated OFF | `GitRepoSync.ts`, `UserGitHubClient.ts`, `GitHubPrFlow.ts` |
| Multi-layer persistence (transcript survives restart, resume works) | ✅ GOLD | `FirestoreConversationStore.ts`, `WorkspaceFileStore.ts`, `FirestoreWorkspaceMemoryStore.ts` |
| Workspace-ownership IDOR guard on all workspace endpoints | ✅ GOLD (merged 2026-06-26, PR #453) | `routes/agentv3.ts` `assertWorkspaceOwner` |
| Rate limiting | ⚠️ PARTIAL — only `/chat` | `authMiddleware.ts` `buildRateLimiter` |
| UI surfaces (chat, dual preview, files, diff, terminal, git, animated tiranga) | ✅ GOLD | `AgentV3Panel.tsx`, `ProV3Surface.tsx` |
| Escalation orchestrator (cheap→strong, objective-gated) | ⚠️ BUILT + TESTED but **DORMANT** (not wired to AgentRunner) | `EscalationOrchestrator.ts`, `index.ts` `ready:false` |
| Multi-provider cost-ladder | ⚠️ adapters exist, **not ON by default** | `MultiProviderTurnRunner.ts` |
| Runtime-error → auto-fix loop | ⚠️ **detection only**, no closed-loop repair | `console_errors` tool; no auto-trigger |
| Per-**user** spend ceiling (monthly cap) | ❌ MISSING (per-build cap exists) | — |
| Secret/API-key redaction in **tool output** streamed to user | ❌ MISSING (detection in source exists) | `SecurityAnalysis.ts` scans source only |
| Prompt-injection defense (imported repos / external content) | ❌ MISSING | — |
| Central log aggregation / trace IDs / alerting | ❌ MISSING (UI event stream exists) | `AgentEventStream.ts` |
| Disaster recovery (multi-region, automated external backup) | ⚠️ BASIC (git + Firestore, no multi-region) | — |
| One-click deploy to live hosting + custom domain | ❌ MISSING | — |

---

## Point 1 — Gold standard we already have → polish to ROCK-SOLID

These are strong; the work is hardening, not building.

- **1.1 Make the quality gate MANDATORY.** Today `evaluate` is objective and real
  but only runs if the *agent chooses* to call it. Harden: auto-run `evaluate`
  before any build is reported `done`, and **block `ok:true` on a FAIL verdict**
  (high-severity: fake code, secret leak, app can't run). This converts a great
  *available* gate into a great *enforced* gate. (Backs audit point 4.)
- **1.2 Rate-limit every mutating/expensive endpoint**, not just `/chat`
  (`/restore`, `/import-files`, `/inbrowser-preview`, `/workspace-files`).
- **1.3 Escalation backstop audit** — confirm the "last tier delivers even on gate
  fail" path always surfaces an honest WARN to the user (never a silent fake pass).
- **1.4 Budget-cap UX polish** — when the per-build cap trips, the UI should show
  the honest "budget reached" state with a one-click "continue with higher budget"
  (admin-tunable), instead of just stopping.
- **1.5 Test-suite reinforcement** — add tests for the new mandatory-gate path and
  the rate-limited endpoints so the guarantees are locked by CI.

## Point 2 — Half-baked → make FULL WORKING, rock-solid

- **2.1 Wire the Escalation Orchestrator to the real AgentRunner.** It's built,
  pure, and unit-tested but dormant — the single highest-leverage activation. Put
  the real build loop inside `buildOnTier`, use the 22-dim gate as the objective
  function, ship cheap→strong with the Opus backstop. Default ON once measured.
- **2.2 Turn the multi-provider cost-ladder ON** with telemetry (`AgentV3CostTelemetry`
  already records per-tier success/cost) so routing is data-driven, margin stays
  positive (D5).
- **2.3 Close the runtime-error auto-fix loop.** Detection exists (`console_errors`).
  Add: after a build, if the preview/console shows a runtime error, auto-spawn a
  repair pass (bounded by budget + a repair-attempt cap) that fixes → re-runs →
  re-verifies. Honest WARN if it can't.
- **2.4 Full session rehydrate on restart.** Transcript already survives restart;
  also rehydrate in-process session state (GitManager/WorkspaceMemory) on resume so
  a mid-build server restart continues seamlessly, not just "restart the build".
- **2.5 Structured ops logging.** Promote the rich event stream into structured
  JSON logs (per-build trace ID, tool latencies) for ops — keep the UI stream as-is.

## Point 3 — Completely missing → BUILD, full working, rock-solid

- **3.1 Per-user spend ceiling.** A monthly USD cap per user that **denies new
  builds** (honest message) when exceeded — infra is ready (`UserCostStore` already
  sums per user/month); add the enforcement gate at build entry. Protects D2 exposure.
- **3.2 Secret redaction in tool output.** Mask API keys / tokens / `.env` values in
  bash stdout/stderr and file reads **before** they stream to the user or into the
  transcript. (Pattern + entropy based; never weaken, never log raw.)
- **3.3 Prompt-injection defense** for imported repos and any external content
  (fetched pages, imported files) — treat them as untrusted, fence them in the
  prompt, and never let them redirect tool use or exfiltrate secrets.
- **3.4 Central observability + admin audit dashboard.** Aggregate logs + the
  existing audit episodes into an admin-visible build/cost/failure dashboard with
  basic alerting on failure-rate spikes.
- **3.5 Disaster recovery upgrade.** Automated periodic export of each user project
  to durable external storage (beyond the single Firestore + git), a user-facing
  "download my project" backup, and a documented restore runbook. Handle >900 KB
  files (currently silently dropped).

## Point 4 — My audit suggestions worth building

(Most fold into the points above; listed so nothing is lost.)
- **4.1** Mandatory gate (= 1.1). **4.2** Escalation default-ON (= 2.1).
- **4.3** Per-user ceiling (= 3.1). **4.4** Secret redaction (= 3.2).
- **4.5 "Why this build cost ₹X" transparency** — show the user the per-build
  token/markup breakdown (data already recorded), building trust.
- **4.6 Pre-deploy security/quality report** — surface the `evaluate` verdict to the
  user as a readable "build health" card before they ship.

## Point 5 — What the world's big app-makers have that we don't → BUILD

(Lovable / Bolt / v0 / Replit Agent class features.)
- **5.1 One-click deploy to live hosting** (Vercel/Netlify/Cloud Run) → real public
  URL, with **custom domain** support. Today we build + store; we don't *ship live*.
- **5.2 Integrated database provisioning UI** — one-click Supabase/Firebase for the
  user's app (BYO-Database is kept; make it one-click in the v3.0 flow).
- **5.3 Built-in auth scaffolding** for the generated app (login/signup wired).
- **5.4 Template / starter gallery** — pick a starting point, then chat to customize.
- **5.5 Visual version timeline** — branch/checkpoint/rollback as a friendly UI
  (git-native plumbing already exists; add the timeline UX).
- **5.6 Generated-app analytics + error monitoring** baked into shipped apps.
- **5.7 Multi-modal input** — screenshot/sketch → app, Figma import.
- **5.8 Mobile targets** — Expo/React Native output for "make it an app".

## Point 6 — Future vision 2050 → BUILD (staged moonshots)

- **6.1 Self-healing deployed apps** — runtime monitors detect prod errors → agent
  opens an auto-PR fix → CI green → auto-deploy. (Extends 2.3 + 5.1.)
- **6.2 Long-horizon autonomous builds** — multi-day projects the agent advances and
  checks in on, with durable resumable state (extends 2.4).
- **6.3 Voice-driven + conversational building** end to end.
- **6.4 Agent/sub-agent marketplace** — users compose specialized teams.
- **6.5 Full autonomous lifecycle** — build → deploy → monitor → scale → bill, with
  per-region compliance auto-adherence (DPDP/GDPR) baked in.
- **6.6 Edge/on-device model fallback** for resilience and cost.

---

## Prioritized execution plan (recommended order)

Ordering principle: **(A) protect users & money first → (B) activate value already
built → (C) reach feature parity with big app-makers → (D) moonshots.** Each "R-phase"
is one ship cycle (branch → PR → CI green → merge), small and reversible.

| Phase | Items | Why this slot | Risk | Depends on |
|---|---|---|---|---|
| **R1 — Safety floor** | 3.2 secret redaction, 3.1 per-user ceiling, 1.2 rate-limit all endpoints, 3.3 prompt-injection (imports) | Before v3.0 widens to real users, money + secrets must be airtight. Pure guards, low blast radius. | Low | — |
| **R2 — Trust the build** | 1.1 mandatory gate, 1.3 backstop honesty, 4.6 build-health card, 1.5 tests | Make "done" mean *verified*. Builds on the gate that already exists. | Low–Med | R1 |
| **R3 — Activate dormant value** | 2.1 wire escalation, 2.2 cost-ladder ON + telemetry, 4.5 cost transparency | Biggest quality/margin win from code already written & tested. | Med | R2 (gate is the objective fn) |
| **R4 — Self-correcting** | 2.3 auto-fix loop, 2.4 full rehydrate, 2.5 structured logs, 3.4 observability dashboard | Reliability + ops visibility once the engine is escalating. | Med | R3 |
| **R5 — Ship it live** | 5.1 one-click deploy + domains, 5.5 version timeline, 5.2 DB one-click, 5.3 auth scaffold | The headline parity feature: build → **live URL**. | Med–High | R2 (health gate before deploy) |
| **R6 — Breadth** | 5.4 templates, 5.6 app analytics, 5.7 multi-modal, 5.8 mobile, 3.5 DR upgrade | Breadth + resilience after the core loop is great. | Med | R5 |
| **R7 — 2050** | 6.1 self-healing, 6.2 long-horizon, 6.3 voice, 6.4 marketplace, 6.5 lifecycle, 6.6 edge | Moonshots once everything below is rock-solid. | High | R4 + R5 |

**Recommended start: R1.1 — secret redaction in tool output** (highest-severity gap,
self-contained, no dependency, directly protects every user the moment v3.0 widens).

> Each phase updates `PROGRESS.md` (append-only) and `AppKnowledgeBase.ts` for any
> user-facing surface, per CLAUDE.md.

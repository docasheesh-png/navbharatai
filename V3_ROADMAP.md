# NavBharatAI Pro v3.0 — "48 Capabilities" Roadmap

Goal: take v3.0 from a strong AI app builder toward a Claude-Code / Devin-class
autonomous engineering system, and ultimately an autonomous software
organization — implementing all 48 capability areas the admin specified.

**Hard rules (from CLAUDE.md, never broken):**
- Real features only. No fakes, no stubs shipped as done. Two states only:
  fully working, or honestly "not built / not configured yet".
- External paid infra (Pinecone, Kubernetes, AWS, etc.) ships as a real
  integration with an honest "connect your X" state — never a faked result.
- Every phase: build → `tsc` + `vitest` + `boot:check` green → commit → push →
  CI green → merge. Push when a phase (or a meaningful increment) is complete,
  then start the next.
- Update `AppKnowledgeBase.ts` for every user-facing capability added.

---

## Honesty tiers (applied to every item)

- **Tier A — Real & self-contained:** built to fully work now, unit-tested with
  the existing sandbox/actuator abstraction (runs end-to-end once `E2B_API_KEY`
  is set; logic is verifiable now via mocks).
- **Tier B — Real but BYO/integration-gated:** vector DBs, cloud providers,
  external databases. Built with real connectors + honest "not configured" UI.
- **Tier C — Frontier:** self-evolution, meta-agents, world models, autonomous
  business. Built as a **real framework + a working v1**, explicitly labelled v1
  — never marketed as magic/AGI.

---

## Section A — What already EXISTS (audit, 2026-06-22)

In v3.0 (`src/server/AgentV3/`):
- Native tool-use loop (`AgentRunner`), multi-provider client + fallback
  (`ClaudeClient`, `routes/agentv3Resilient`) — cat 12, 28
- Multi-agent team (`AgentRegistry`, `SubAgent`), Architect + 8 specialists,
  delegation via `task` — cat 13, 18, 23
- Event-driven stream (`AgentEventStream`), state (`WorkspaceState`), feature
  flag — cat 1, 2, 20
- Git engine: diff/checkpoint/rollback/restore (`GitManager`), workspace
  registry/persistence (`WorkspaceRegistry`) — cat 3, 6, 19, 20
- Real execution via actuators (E2B/Docker/Local = real filesystem + terminal),
  approvals (`Approvals`) — cat 4, 20, 21
- Cost/billing (`pricing`, `UserCostStore`) — cat 42
- 11 real tools: read/write/edit_file, bash, grep, glob, update_todo,
  update_preview, task — cat 46 (partial)

Reusable infra elsewhere (to wire into v3.0):
- `Memory/` ProjectGraph, MemoryIndexer, ProjectMemoryManager — cat 22, 24, 48
- `QualityEvaluationEngine/` Architecture/Build/Lint/Runtime/Security + Scorer —
  cat 26, 15, 16
- `AppContext/` AppKnowledgeBase + ContextInjector — cat 2, 29
- `runtime/` PreviewService + React/Vue/Static runtimes — cat 4, 19
- `lib/` eventBus, eventStore, metrics, metricsAlerts, audit, secrets,
  ObservabilityManager — cat 16, 17, 34

---

## Section B — Phases (sequenced for "verifiable first")

Phases are ordered so the early ones are fully testable **today** (no external
infra), and execution-heavy phases (which need `E2B_API_KEY`) build their real
code now and run end-to-end the moment E2B is configured.

### Phase 1 — Agent Orchestration & Registry  (cat 13, 23, 35, 37)
Expand the agent roster to the full planning/dev/quality/repair/knowledge/ops
set + human-simulation roles; add a Capability Registry, Agent Lifecycle &
Health, and a coordination/communication bus. Parallel delegation.
Tier A. Testable now.

### Phase 2 — Memory & Artifact Intelligence  (cat 22, 24, 48)
Wire `Memory/` into v3.0: project/episodic/semantic/procedural/error/fix memory,
memory search/rank/compress/summarize; ProjectGraph + symbol/semantic indexing,
dependency & call graphs, codebase mapping. Tier A.

### Phase 3 — Knowledge & RAG  (cat 12, 29)
RAG + embeddings + vector storage (Chroma/Pinecone/Weaviate/Qdrant — Tier B BYO),
knowledge bases (framework/SDK/security/best-practices), AppKnowledgeBase wiring.

### Phase 4 — Engines Expansion  (cat 3)
Planning/reasoning/code-analysis/repair/refactor/test/validation/dependency/
search/docs/security/perf/cost + DB/API/UI/backend/mobile/infra generation +
CI/CD engines. Integrate `AppMakerLab`, `BuildEngine`, `QualityEvaluationEngine`.

### Phase 5 — Execution Quality (needs E2B)  (cat 4, 20, 21, 19)
Real terminal/process manager + supervisor, build runtime, real browser testing
(Playwright in sandbox), real deployment, snapshots, resource quotas, network
isolation. Tier A code now; runs when E2B is set.

### Phase 6 — Testing & Autonomous Loops  (cat 15, 18)
Unit/integration/e2e/visual/browser/load/security/api/regression/snapshot/a11y;
plan→build→test→debug→fix→validate→optimize→deploy→recover loops.

### Phase 7 — Storage, Databases, Integrations  (cat 7, 8, 11)
Object/artifact/vector/blob/cache/log/backup/snapshot storage; DB connectors
(Postgres/MySQL/Mongo/Redis/…); dev integrations (GitHub/GitLab/Docker/K8s/
Firebase/Supabase/Vercel/Netlify/Cloudflare/AWS/GCP/Azure). Tier B BYO.

### Phase 8 — Security & Observability  (cat 16, 17, 34)
RBAC/ABAC, secret vault, scanners, encryption, audit; logging/metrics/tracing/
monitoring/alerting/error+crash tracking; production telemetry/analytics. Build
on existing `metrics*`, `audit`, `secrets`, `ObservabilityManager`.

### Phase 9 — Evaluation, Reliability, Economic Intelligence  (cat 26, 41, 42)
Benchmark/eval engines, agent scorecards, deployment-readiness; chaos/failure-
injection/recovery testing; token/compute/build/cloud cost optimizers.

### Phase 10 — Product Understanding, World Model, Research  (cat 27, 39, 40)
User-journey/requirement/feature-priority/domain-modeling; domain knowledge
engines (healthcare/finance/gov — the "UP hospital" example); autonomous research
agents (research before coding).

### Phase 11 — Autonomous SDLC, Software Factory, Human Simulation  (cat 33, 36, 37, 38)
Full autonomous SDLC loop; software factory (parallel dev/test/deploy/mass
production); human-simulation org (CTO/Tech-Lead/PO/…) = "virtual software
company".

### Phase 12 — Enterprise & Marketplace  (cat 30, 31)
Org/team/role mgmt, billing/quotas/compliance/governance/approval workflows;
agent/plugin/template/workflow/component/integration marketplaces. Tier B/C.

### Phase 13 — Advanced Dev, Meta-Agent, Self-Evolution, OS Layer  (cat 32, 43, 44, 45)
Reverse-engineering/migration/modernization; meta-agents (agent creator/trainer/
evaluator); self-evolution engines; OS-layer universal buses. Tier C (real
framework + honest v1).

### Phase 14 — Autonomous Business & Grand Unified Memory  (cat 47, 48)
Market/pricing/marketing/SEO/analytics agents; grand-unified memory finalization
(search/rank/compress/summarize/evolve across user/project/team/org). Tier C/A.

### Phase 15 — Self-Learning & Production Intelligence polish  (cat 25, 34)
Pattern/failure/success learning, prompt/skill/strategy evolution loops;
production telemetry/behaviour/error/perf/cost/reliability analytics. Tier C.

---

## Section C — The "3 that matter most" (admin's final assessment)

Every phase is graded against these, because they are what makes the difference:
1. **Execution Quality** — real filesystem, terminal, browser, deployment (Ph 5,6)
2. **Agent Orchestration Quality** — how well agents coordinate (Ph 1, 11)
3. **Memory + Self-Improvement** — how much the system learns per project (Ph 2, 15)

---

## Progress log (append-only)

- 2026-06-22: Roadmap created. Audit complete (Section A). Starting Phase 1.
- 2026-06-22: Phase 1 step 1 — expanded the agent roster from 9 to 27 roles
  across six org layers (planning/development/quality/repair/knowledge/
  operations), each with a focused system prompt, constrained tool set and
  declared capabilities. Added a Capability Registry (findRolesByCapability,
  rolesByLayer, allRoles) so work is routed to the right specialist. Task-tool
  enum + dispatcher validation auto-wire from WORKER_ROLES. Frontend AgentRole +
  AppKnowledgeBase synced. 1628 tests green. Next: agent lifecycle/health +
  capability-aware routing in the Architect prompt + parallel coordination.
- 2026-06-22: Phase 1 step 2 — capability-aware routing. rosterBriefing()
  generates a grouped, capability-tagged team description from the registry and
  is injected into the Architect's system prompt, so delegation picks the right
  specialist by real capability (never drifts — generated from the roster).
- 2026-06-22: Phase 1 step 3 — Agent Health Monitor (AgentLifecycle). Records
  every delegated run's real start/success/failure/duration with a deterministic
  monotonic ordering; wired into the sub-agent spawn and exposed via
  GET /api/agentv3/status (`team`). 1634 tests green. Phase 1 remaining: parallel
  coordination polish + surface the team health in the AI-team UI.
- 2026-06-22: Phase 1 merged to main (#205) → deployed.
- 2026-06-22: Phase 2 + 2.4 merged (#206, #207) → deployed.
- 2026-06-22: Phase 4 (Engines) start — native architecture analysis. The legacy
  QualityEngine evaluators assume a host path/the wrong repo, so they cannot
  serve v3.0; built ArchitectureAnalysis instead: real import-cycle detection,
  unresolved-local-import detection and front-end→back-end layering checks over
  the indexed project graph (no sandbox needed). New `evaluate` tool wired into
  the catalog/dispatcher, granted to the whole team, and the Architect is told to
  evaluate-and-fix before declaring done. 1649 tests green (+7).
- 2026-06-22: Phase 4.1 merged (#208) → deployed.
- 2026-06-22: Phase 8.1 (Security) — native security scanner. scanSecurity()
  detects hardcoded secrets/credentials, AWS keys, private keys, eval(),
  dangerouslySetInnerHTML and insecure http:// over real indexed content
  (placeholder/env-based values ignored). Findings are computed at index time
  (only findings kept, not file bodies) and folded into the `evaluate` tool
  alongside architecture analysis. 1655 tests green (+6).
- 2026-06-22: Phase 2 (Memory & Artifact Intelligence) — built a real per-
  workspace WorkspaceMemory: artifact index / project graph (files → exported
  symbols, React components, routes, import edges, external dependencies) updated
  on every real write/edit; episodic memory (build request + bash errors);
  relevance recall across symbols/files/episodes; projectMap() for context. New
  `recall` tool wired into the catalog + dispatcher and granted to the whole team
  (read-only). Replaces the unsafe global Memory/ProjectMemoryManager for v3.0.
  1641 tests green (+7). Next (Phase 2 cont.): inject projectMap into the
  Architect context automatically + persist memory across sessions.
- 2026-06-22: Phase 8.1 merged (#209) → deployed.
- 2026-06-22: Phase 9.1 (Deployment readiness) — assessReadiness() combines the
  architecture + security findings into a deterministic 0–100 score and a hard
  ready/not-ready gate (build-breakers and high-severity security issues block).
  Folded into `evaluate` as a top-line verdict, and the Architect must reach
  READY before declaring done. 1661 tests green (+6).
- 2026-06-22: Phase 9.1 merged (#210) → deployed. E2B confirmed set by admin.
- 2026-06-22: Phase 5.1 (Session continuity) — iterative building. The actuator
  is now a process-level singleton and the workspace id is derived from a stable
  client sessionId (deriveWorkspaceId), so consecutive messages reuse the SAME
  E2B sandbox + project memory + git repo instead of a fresh one each time. The
  panel generates a stable sessionId and adds a "New" button to start a fresh
  project. 1665 tests green (+4).
- 2026-06-23: Provider diagnosis — GET /api/agentv3/diag reports (no secrets)
  whether ANTHROPIC_API_KEY is a real sk-ant key, plus base-url config; optional
  admin-gated ?test=1 makes one real Claude call and returns the exact outcome.
  Added because the Anthropic dashboard showed the key "Last used: Never" while
  chat still replied — i.e. Claude 401s and the engine falls back to
  Vertex/Gemini/Grok (likely a leftover non-Anthropic key in ANTHROPIC_API_KEY).

---

## Section D — Beyond Level 48: The Frontier Roadmap (Layers 49-71)

Admin-specified on 2026-06-23. These extend the 48-capability roadmap toward a
self-improving, civilization-scale intelligence platform. **Honesty tier: almost
all are Tier C** — each ships as a REAL framework + an explicitly-labelled
working v1, never as faked "AGI". They build on the Section A-C foundation
(orchestration, memory, evaluation, execution) already in place.

> Ordering principle (unchanged): build the verifiable core first. Layers that
> need external infra (research corpora, simulators, edge nodes) ship with real
> connectors + an honest "not configured" state.

### 49 — Collective Intelligence Layer  (builds on Ph 1 orchestration, cat 13/23)
Swarm engine, multi-agent democracy/voting/debate/jury, consensus building,
adversarial review, red-team/blue-team agent networks. **Purpose:** many agents
deliberate before a decision. *Foundation exists:* 27-agent roster + capability
router; v1 = structured debate→vote→consensus over a decision.

### 50 — Scientific Discovery Layer
Hypothesis generation, experiment design, research planning, knowledge-gap &
novelty detection, theory evaluation. **Purpose:** discover new solutions, not
just reuse old ones.

### 51 — Autonomous Research Laboratory  (extends cat 40)
Research agent swarm, paper reading/comparison, citation intelligence, research
memory graph, OSS discovery, patent awareness. **Purpose:** read research,
compare ideas, create innovations. Tier B for external corpora (BYO API).

### 52 — Innovation Engine
Architecture/framework/workflow invention, algorithm & pattern discovery.
**Purpose:** invent new architectures and workflows.

### 53 — Meta-Reasoning Layer  (extends Ph 9 evaluation)
Thought evaluator, reasoning auditor, logic validator, contradiction detector,
uncertainty & confidence-calibration engines. **Purpose:** evaluate and improve
its own thinking. *Foundation exists:* readiness/quality scorers.

### 54 — Strategic Intelligence Layer
Long-horizon planner, strategic-goal & milestone & resource planners, opportunity
& risk analyzers. **Purpose:** plan months and years ahead.

### 55 — Digital Twin Layer
User / team / project / product / organization digital twins. **Purpose:**
simulate outcomes before execution.

### 56 — World Simulation Layer
Market / user / infrastructure / competitor / economic simulators.
**Purpose:** predict real-world results before launch. Tier C.

### 57 — Self-Reflection Layer  (extends cat 25, memory)
Failure / success / strategy / agent / project reflection engines.
**Purpose:** learn from every success and failure. *Foundation exists:* episodic
error/fix memory.

### 58 — Autonomous Governance Layer  (extends cat 16)
Ethics, policy, risk-governance, compliance, decision-audit engines.
**Purpose:** safe, accountable AI behaviour. Hard requirement before higher
autonomy ships.

### 59 — Knowledge Evolution Layer
Knowledge verification / aging / refresh / conflict-resolution / ranking.
**Purpose:** keep knowledge accurate and current.

### 60 — Creativity Layer
Design / product / UX creativity, naming, branding engines. **Purpose:**
generate creative solutions and products.

### 61 — Economic Agent Layer  (extends cat 42/47)
Cost / revenue / pricing / growth / ROI agents. **Purpose:** understand business
and profitability.

### 62 — Autonomous Startup Layer  (extends cat 47)
Startup validation, market research, product launch, monetization, growth,
competitive-analysis agents. **Purpose:** build and launch complete startups.

### 63 — Autonomous Organization Layer  (extends Ph 11, cat 37)
CTO / product / engineering / QA / research / security / support team agents.
**Purpose:** operate like a complete software company.

### 64 — Evolutionary Architecture Layer
Architecture mutation / selection / fitness / evolution engines. **Purpose:**
continuously evolve better architectures.

### 65 — Autonomous Ecosystem Layer  (extends cat 31)
Agent / plugin / workflow / skill / template stores. **Purpose:** a developer
ecosystem around the platform.

### 66 — Universal Interface Layer
Text / voice / video / image / AR / VR / API interfaces. **Purpose:** interact
through any medium.

### 67 — Federated Intelligence Layer
Local / edge / cloud AI nodes, federated learning, distributed memory.
**Purpose:** distributed intelligence across environments. Tier C.

### 68 — Autonomous Knowledge Creation
New pattern / framework / architecture / workflow discovery engines.
**Purpose:** create knowledge instead of only retrieving it.

### 69 — General Problem Solving Layer
Engineering / business / legal-workflow / operations / research / strategy
solvers. **Purpose:** solve problems beyond software development.

### 70 — Recursive Self-Improvement Layer  (extends cat 43/44)
Self-evaluation / modification / optimization / architecture-upgrade /
agent-creation / workflow-creation engines. **Purpose:** the platform improves
itself continuously. **Strictly gated behind Layer 58 (Governance).**

### 71 — Civilization-Scale Layer
Global knowledge graph, planetary memory, universal agent network, distributed
research network, collective-intelligence fabric. **Purpose:** planet-scale
intelligence infrastructure. Tier C — long-horizon north star.

---

## Ultimate Maturity Model (north-star levels)

| Level | Stage | Maps to |
|---|---|---|
| 1 | Normal App Builder | base |
| 2 | Agentic App Builder | Ph 1-4 |
| 3 | Claude Code Class | Ph 5-9 (execution + memory + evaluation) |
| 4 | Mythos / Devin Class | Ph 10-12 |
| 5 | Autonomous Software Engineer | Ph 13-15 + Layer 53/57 |
| 6 | Autonomous Software Company | Layer 62/63 |
| 7 | Autonomous Research Organization | Layer 50/51/52/68 |
| 8 | Self-Improving Intelligence Platform | Layer 58 (gate) + 64/70 |
| 9 | Federated Collective Intelligence System | Layer 49/67/71 |
| 10 | FOD — Future-Oriented Distributed Intelligence | full stack, governed |

**Self-assessment (2026-06-23):** the platform is solidly at **Level 3** (real
execution via E2B, 27-agent orchestration, project memory, evaluation/readiness
gates), with parts of Level 4 underway. Layers 49-71 are the long road to
Levels 5-10. Same rules apply: real or honestly "not built yet" — never faked.

### Progress log (append-only)
- 2026-06-23: Added Section D (layers 49-71) + Ultimate Maturity Model per admin.
  Self-assessed current maturity at Level 3. No code yet for 49-71 — roadmap only.

---

## Layer 72 — Universal Computer Use Engine (UCUE) v2.0  (admin-specified 2026-06-23)

**Mission:** NavBharatAI can *see → understand → navigate → reason → execute →
verify → recover → learn* across websites, SaaS platforms, desktop & mobile
apps, cloud consoles, internal dashboards, and multi-step workflows.

> **Honesty tier: B/C with a REAL head start.** Unlike most of 49-71, UCUE's
> execution + vision layers already have a working foundation: the E2B sandbox
> ships real Playwright + Chromium, a CDP path, screenshot capture, and a
> browser-action daemon (built for Engineer AI visual testing). UCUE productises
> and extends that — it is NOT greenfield. Sensitive-action approval + credential
> vault (Layer J) are HARD prerequisites before any autonomous execution ships.

**Sub-layers (A-R):**
- **A. Core Control:** browser / computer-use / desktop / mobile / visual control;
  keyboard, mouse, clipboard, file-interaction; window/tab/session/profile
  managers; multi-browser / multi-device / multi-monitor. *(browser+session
  control: foundation exists in E2BActuator.)*
- **B. Execution:** Playwright, Browser-Use, Stagehand, CDP, Puppeteer, Selenium
  compat, remote/headless/headed/distributed browser, browser-pool + session
  persistence. *(Playwright + CDP + headless Chromium already in E2B.)*
- **C. Vision:** OCR, UI/button/form/input/menu/modal/table/chart detection,
  image & layout understanding, screenshot + screen-semantic analyzers, visual
  reasoning/grounding, element ranking. *(screenshot capture exists; detection is
  new — pair with the multimodal model.)*
- **D. Website Understanding:** website mapping, DOM + semantic-DOM analysis,
  navigation/site-structure/workflow detection, user-journey + interaction graph.
- **E. Reasoning:** goal/action/navigation/workflow/recovery/retry/multi-step/
  long-horizon planners, decision engine, risk-aware planner. *(builds on Ph 1
  AgentRunner + Layer 53/54.)*
- **F. Memory:** browser / session / website / user / task / workflow / error /
  fix / experience / navigation memory + encrypted credential memory. *(builds on
  Ph 2 WorkspaceMemory + episodic error/fix memory.)*
- **G. Learning:** workflow / pattern / error / success-pattern / website /
  user-preference / skill learning. *(ties to Layer 57 self-reflection / cat 25.)*
- **H. Recovery:** selector / visual / DOM / retry / failure / workflow / session
  / browser recovery — survive UI changes.
- **I. Verification:** action / state / page / form-submission / workflow-
  completion / goal-completion / screenshot / visual-diff verification. *("preview
  is EARNED" applied to computer use — verify, never assume.)*
- **J. Safety (PREREQUISITE):** human-approval engine, sensitive-action detector,
  risk evaluation, permission engine, audit logger, secret protection, credential
  vault, compliance + policy enforcement. *(builds on Ph 8 security + Approvals.)*
- **K. Autonomous Tasks:** research / browser / form-filling / data-collection /
  dashboard / CRM / SaaS / reporting / monitoring agents.
- **L. Digital Workers:** email / spreadsheet / document / CRM / ERP / ticketing /
  support / reporting workers.
- **M. Evaluation:** browser benchmark suite, website/task/recovery success
  trackers, failure analytics, agent scorecards, reliability metrics. *(builds on
  Ph 9 + agent health monitor.)*
- **N. Observability:** browser telemetry, interaction logs, session replay,
  screen recording, metrics, alerting, failure analytics. *(builds on existing
  metrics/audit infra.)*
- **O. Multi-Agent:** browser / vision / planner / recovery / verification /
  security / research agents. *(new roles in the 27-agent registry.)*
- **P. Enterprise:** org / team / workspace-permission management, approval
  workflows, audit trails, compliance monitoring.
- **Q. Advanced Intelligence:** website digital twin, workflow + user-behaviour
  simulation, competitor-site analysis, autonomous research + workflow discovery.
  *(ties to Layers 51/55/56/68.)*
- **R. Future:** agent-swarm + computer-swarm coordination, autonomous skill +
  agent creation, self-improving browser intelligence, recursive optimization.
  *(gated behind Layer 58 governance + 70 recursive self-improvement.)*

**Success criteria (the bar for "done"):** open any supported site; understand
page structure; navigate autonomously; fill forms; upload/download files; operate
SaaS + cloud consoles; recover from UI changes; verify outcomes; learn & reuse
workflows; work across tabs/browsers; run long tasks; improve over time. Each
criterion ships only when verifiably real — never a faked "it worked".

**Suggested build order (verifiable-first):** B+C+A (real navigation+vision on the
existing E2B browser) → I (verification) → J (safety/approval — before any
write/destructive action) → F+H (memory + recovery) → E (planning) → K/L (task &
worker agents) → G+M+N (learning + eval + observability) → O/P/Q/R.

### Progress log (append-only)
- 2026-06-23: Added Layer 72 (UCUE v2.0) per admin. Noted the real E2B
  Playwright/CDP foundation it extends; flagged Layer J (safety/approval) as a
  hard prerequisite. Roadmap only — no UCUE code yet.

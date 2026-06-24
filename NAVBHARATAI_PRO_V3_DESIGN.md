# NavBharatAI Pro v3.0 — Design Document

> **Codename:** Vargen 3.0 · **Goal:** a Claude-Code-class agentic app builder (~99% of the "feel")
> **Status:** DESIGN — for admin review. **No runtime code has been changed.**
> **Companion docs:** `CLAUDE_CODE_PARITY.md` (gap analysis, root causes RC-1…RC-8), `PROGRESS.md` (living state).

---

## 0. Locked decisions (admin sign-off — 2026-06-22)

| # | Decision | Choice | Notes |
|---|---|---|---|
| D1 | **Build approach** | **Strangler-fig** — build v3.0 alongside the live app, behind a feature flag, prove, then cut over. | The live app + payments must NEVER break (CLAUDE.md absolute rule #1). No "delete & rewrite". |
| D2 | **Who pays for Claude** | **NavBharatAI pays** (admin override). | This **overrides** the CLAUDE.md constraint *"AiCreditsProvider is NEVER registered / user apps run on the user's own accounts"* — authorized by admin (aashishcpmt09) on 2026-06-22. **Mandatory cost-control guardrails** apply (§7). A future BYOK option stays open. |
| D3 | **Sequencing** | **Design-doc first** (this doc) → admin review → then code, phase by phase. | |
| D4 | **Sandbox** | **Hybrid: E2B sandbox (engine execution) + real Git repo (user ownership).** | Both E2B keys and real-repo are available. "Give the engine what the engine needs (a fast cloud sandbox), give the user what the user needs (a real, ownable git repo)." World's-best app maker (§7.1). |
| D5 | **Pricing / CostGuard** | **User is billed `user_tokens × Opus_price × 2.5`** — regardless of which model actually runs (Sonnet, Opus, or Vertex under the hood). | NavBharatAI pays the real provider cost (D2) and bills the user a **2.5× markup over the Opus-equivalent rate** → revenue-positive; D2 exposure is covered. The user always pays the Opus-equivalent ×2.5; the engine is free to route to a cheaper model and keep the margin (§7.2). |
| D6 | **Super (only-Opus) toggle** | A premium **"Only Opus" super toggle** bills at **×5** (Opus-equivalent ×5). | Forces every step onto Opus; charged at 5× (§7.2). |
| D7 | **Transcript / DB persistence** | **User's choice** — the user is asked where their data/DB lives. With BYOK, the transcript + app DB live on the **user's own account** (their Claude/their DB). | Honors CLAUDE.md "users' own accounts" for user *data* even though compute billing is D2/D5 (§5.1). |
| D8 | **Beta allowlist** | **Admin-only now**; once v3.0 is complete → **all logged-in users**. | Matches the strangler-fig rollout (§6). P0 default is admin-only via `AGENTV3_ALLOWLIST`. |
| D9 | **Engagement is REAL** | The "AI Team" live tracker + live preview must reflect **real running state** — never a fake/scripted animation. | Each agent card = a real running sub-agent + real tool calls; preview updates from real sandbox files as they're written (§3.4, §7.1). CLAUDE.md real-features rule. |

> ⚠️ Because of D2/D5, before any v3.0 billing code lands, the CLAUDE.md "Engineer AI permanent constraints" section must be amended (in the same PR that wires Claude billing) to record this admin override — otherwise a future session will revert it per the old rule.

---

## 1. Scope — what "99% Claude Code" means here

### ✅ In scope (100% of the Claude-Code *architecture* + a multi-agent layer on top)
- **Native Anthropic tool-use** agent loop (parallel tool calls, structured, no JSON-in-text parsing) — RC-1.
- **Multi-agent "AI team"** — an **Architect/Orchestrator** that plans and delegates to specialized sub-agents (Frontend, Backend, Database, Designer, QA/Tester, Debugger, Reviewer, Deploy) via a native `task` sub-agent tool, some running **in parallel**. This is Claude-Code's subagent model, extended into a visible *team* so the user is engaged, never bored (§3.3, §3.4).
- **Growing transcript + prompt caching** for long-horizon coherence — RC-2.
- **Claude Sonnet/Opus** as the reasoning model — RC-3.
- **One canonical engine** that **all five surfaces (Preview, IDE/Code Studio, File explorer, Git, History) are merged into and sync from in real time** — RC-5 + the user's explicit merge/sync ask (§3.2).
- **Editable todo list, plan mode, permission prompts** — RC-6.
- Claude-Code-style tool catalog: Read / Write / Edit / Bash / Grep / Glob / `task` (sub-agent).

### ❌ Explicitly out of scope (the 1% — physically impossible in a hosted web app)
- Editing the **user's real local machine/repo** — a browser app runs on a cloud sandbox (RC-7). v3.0's "real repo" is the **per-session cloud sandbox** (E2B), not the user's laptop.
- OS-level hooks on the user's machine, native IDE extension, Anthropic's proprietary harness + model post-training (RC-8).

**This is honest framing: v3.0 = Claude-Code-*class*, not a byte-for-byte Claude Code.**

---

## 2. Current state (ground truth, audited)

Three fragmented builders today:
- **Pro Chat** → `routes/pro.ts` + `AppMakerLab/AppEngine.ts` (pipeline, no tools).
- **Engineer AI** → `routes/engineer.ts` + `EngineerAI/EngineerAgentLoop.ts` (ReAct loop, **JSON-in-text** tools, **hardcoded `grok-3`** at `EngineerAgentLoop.ts:504`).
- **CodeStudio** → `components/ide/CodeStudio.tsx` (separate IDE surface).

Relevant existing assets v3.0 will **reuse** (not rewrite):
- **Actuators** (`EngineerAI/actuators/`): `E2BActuator`, `DockerActuator`, `LocalActuator`, `VfsActuator`, `IEngineerActuator` — real sandbox FS + exec. These become the **execution backend** behind v3.0's native tools.
- **Provider** (`AI/Router/providers/AnthropicProvider.ts`): today `execute()` returns **text only**, sends **no `tools` param**. v3.0 needs a tool-aware streaming path.
- **Preview** (`PreviewRunner/`, `runtime/`), **surfaces** (`PreviewPanel.tsx`, `CodeStudio.tsx`, `EngineerAIChat.tsx`).
- **AppKnowledgeBase** (`AppContext/AppKnowledgeBase.ts`) — must get v3.0 entries.

---

## 3. Target architecture

```
                    ┌──────────────────────────────────────────────┐
   user prompt ───▶ │            AgentV3 Core (new)                 │
                    │  src/server/AgentV3/                          │
                    │                                               │
                    │  ConversationStore  ── growing transcript +   │
                    │     │                  prompt caching (RC-2)  │
                    │     ▼                                         │
                    │  AgentRunner ── native tool-use loop (RC-1)   │
                    │     │   ▲                                     │
                    │     ▼   │ tool_result blocks                  │
                    │  ToolDispatcher ─▶ ToolCatalog                │
                    │     │              (read/write/edit/bash/     │
                    │     │               grep/glob/todo/task)      │
                    │     ▼                                         │
                    │  ClaudeClient (Anthropic SDK, streaming,      │
                    │     tools, tool_choice, caching) (RC-3)       │
                    └───────────────┬──────────────────────────────┘
                                    │ executes via
                                    ▼
                       Actuator (E2B sandbox = "real repo")
                                    │
                                    ▼
                       WorkspaceState  ◀── single source of truth
                                    │
              ┌─────────────────────┼───────────────────────┐
       AgentEventStream (SSE/WS): every tool call, diff, todo, file change
              │            │            │            │            │
           Preview     File Expl.   Code Studio   History     Transcript
          (real-time)  (real-time)  (real-time)  (real-time)  (real-time)
```

### 3.1 New module layout (`src/server/AgentV3/`)
| File | Responsibility |
|---|---|
| `AgentRunner.ts` | The native tool-use loop: call Claude → receive `tool_use` blocks → dispatch (parallel) → append `tool_result` → repeat until `end_turn`. |
| `Orchestrator.ts` | The Architect/lead: owns the plan, decomposes work, spawns sub-agents via the `task` tool, integrates their results, decides "done" (§3.3). |
| `SubAgentRunner.ts` | A constrained nested `AgentRunner` (own transcript, own tool budget, restricted tool set) for Frontend/Backend/DB/Designer/QA/Debugger/Reviewer/Deploy roles. |
| `AgentRegistry.ts` | Role → system-prompt + allowed-tools + parallel-safety definitions for the agent team. |
| `GitManager.ts` | First-class git in the sandbox repo: commit-per-checkpoint, branch-per-build, `git log` for History, `git checkout` for restore (§3.2). |
| `ClaudeClient.ts` | Thin wrapper over `@anthropic-ai/sdk` `messages.stream` with `tools`, `tool_choice`, `cache_control`, model routing (Sonnet default / Opus on demand). |
| `ConversationStore.ts` | Persisted, growing message transcript per session (replaces per-step prompt rebuild). Applies prompt-cache breakpoints. |
| `ToolCatalog.ts` | Native Anthropic tool **definitions** (name, description, `input_schema`) for read/write/edit/bash/grep/glob/todo/task. |
| `ToolDispatcher.ts` | Maps a `tool_use` block → an actuator/VFS call → a `tool_result`. Enforces permission mode. |
| `WorkspaceState.ts` | Canonical state: file tree, diffs, terminal log, todo list, plan, checkpoints. Emits change events. |
| `AgentEventStream.ts` | SSE/WS publisher; every surface subscribes. Event types: `tool_call`, `tool_result`, `file_changed`, `diff`, `todo_updated`, `plan_updated`, `thinking`, `permission_request`, `done`. |
| `CostGuard.ts` | Per-session + per-user budget caps, model routing, token metering (see §7). |
| `index.ts` | Public entry consumed by the new route. |

New route: `routes/agentv3.ts` → `POST /api/agentv3/chat` (NDJSON/SSE stream). Feature-flagged.

### 3.2 Surfaces MERGED into the engine (the user's explicit ask)
Today Preview, IDE/Code Studio, File explorer, Git, and History each hold their
own state and can drift. In v3.0 they are **merged into the engine**: each becomes
a **read-only subscriber** to one `AgentEventStream` + one `WorkspaceState`. One
state object → guaranteed consistency, zero drift, everything live.

| Surface | Today (separate) | v3.0 (merged/synced) | Source event |
|---|---|---|---|
| **Preview** | `PreviewPanel.tsx` / `PreviewRunner` polls | Re-renders the instant a preview-relevant file changes (debounced) | `file_changed` |
| **IDE / Code Studio** | `CodeStudio.tsx` standalone Monaco | Auto-opens the file the agent (or sub-agent) is editing; streams the live red/green `diff` as it's written | `tool_call(edit/write)`, `diff` |
| **File explorer** | independent tree | Live tree straight from `WorkspaceState.fileTree`; highlights the file each agent is touching | `file_changed` |
| **Git** | git-native versioning (Phase 2.1) loosely coupled | **First-class in the engine**: every agent checkpoint = a real git commit in the sandbox repo; branch per build; History shows real `git log`; restore = `git checkout` | `checkpoint`, `git_commit` |
| **History** | per-build list | Unified timeline of agent turns + sub-agent spawns + git checkpoints; one-click restore reverts `WorkspaceState` to that commit | `tool_call`, `checkpoint`, `agent_spawned` |

**Merge mechanism:** a single `WorkspaceState` (file tree, diffs, terminal, todo,
plan, git log, checkpoints) is the source of truth. `AgentEventStream` (SSE/WS)
broadcasts every change. The frontend builder mounts all five surfaces against
this one stream — so the preview, the code you see, the file tree, the git
history, and the restore points are always the same reality the agents are
acting on.

### 3.3 Multi-agent "AI team" (RC-4 + the user's "multiple agents" ask)

Claude Code has one main agent + `Task` subagents. v3.0 makes this a **visible
team**: an **Architect/Orchestrator** owns the conversation, plans, and delegates
to specialized sub-agents via a native `task` tool. Sub-agents are real nested
`AgentRunner` instances (own transcript, own tool budget, constrained tool set),
some launched **in parallel**.

| Agent | Role | Typical tools | Parallel-safe? |
|---|---|---|---|
| **Architect / Orchestrator** | Owns the plan, decomposes work, delegates, integrates, decides "done". Plan mode lives here. | `task`, `update_todo`, read/grep | lead (serial) |
| **Frontend** | UI, components, styling wiring | read/write/edit, bash | yes (own files) |
| **Backend** | API, server routes, business logic | read/write/edit, bash | yes (own files) |
| **Database** | schema, migrations, seed | read/write/edit, bash | yes |
| **Designer** | theme, layout, responsive polish | read/write/edit | yes |
| **QA / Tester** | runs build + tests, reports pass/fail honestly | bash, read, grep | yes (read-heavy) |
| **Debugger / Doctor** | reproduces + fixes failures the QA agent finds | read/write/edit, bash | usually serial |
| **Reviewer** | reviews the diff before "done" (real gate) | read, grep | yes (read-only) |
| **Deploy** | one-click deploy when green | bash, deploy actuator | serial, last |

**Orchestration rules (safety + correctness):**
- The Architect **serializes writes to the same files**; parallelism is used for
  **independent files** (frontend vs backend vs db) and **read-only** work
  (research, QA, review) — this avoids sandbox write races (a real risk, §9).
- Each sub-agent returns a structured result (files changed, tests run, summary)
  as a `tool_result` back to the Architect, who integrates and decides next step.
- Sub-agent depth is capped (e.g. Architect → worker, no deep recursion) and each
  has its own token/step budget under the global `CostGuard` (§7).
- A sub-agent that fails its acceptance reports honestly; the Architect re-plans
  (no fake "done").

### 3.4 Engagement layer — "user never gets bored"

The multi-agent team is also the **anti-boredom UX**. While building, the user
watches a live **"AI Team" panel**, not a dead spinner:
- **Live agent cards** — each active agent shows its name/avatar, current action
  ("Frontend agent is writing `Navbar.tsx`…", "QA agent is running tests…"),
  and a mini progress state. Parallel agents are visibly working at once.
- **Streaming narration** — the Architect narrates the plan and hands-offs in
  friendly language (this is AI-generated chat-bubble text — the one CLAUDE.md
  language exception — so it can be warm/Hinglish for end users).
- **Live everything** — todo list ticking off, diffs streaming into Code Studio,
  file tree lighting up, preview refreshing, git checkpoints appearing in History
  — all from §3.2's single stream, so it feels like a real team shipping live.
- **Plan-mode + approvals** keep the user a participant (approve the plan, confirm
  risky actions) rather than a passive waiter.

This turns "waiting for a build" into "watching your team build" — the core
engagement goal.

> **REAL, not fake (D9).** Every agent card is driven by a real running
> sub-agent and real `tool_call`/`tool_result` events — there is NO scripted or
> decorative animation. If an agent is idle, its card is idle. The **live
> preview** renders the real sandbox files the moment they're written (not a
> mock). Faking any of this would violate the CLAUDE.md real-features rule.

---

## 4. Native tool-use design (RC-1) — the heart of "the feel"

**Today:** model emits `{thought, action, args}` JSON in text → regex + `JSON.parse` → one action/step → retries on parse failure.

**v3.0:** standard Anthropic tool-use turn cycle:
1. `messages.stream({ model, system, messages, tools, tool_choice:{type:'auto'} })`.
2. Stream `text` (assistant thinking) and `tool_use` blocks to the surface live.
3. On `end_turn` with tool_use: run each tool (parallel where safe) via `ToolDispatcher` → actuator.
4. Append a `user` message containing `tool_result` blocks (with `tool_use_id`).
5. Loop until the model returns `end_turn` with no tool calls (task complete) or a budget/step cap trips.

**Tool catalog (v1):**
| Tool | Backed by | Notes |
|---|---|---|
| `read_file` | actuator read | |
| `write_file` | actuator write | full-file write |
| `edit_file` | actuator + diff | exact-string replace; emits `diff` event |
| `bash` | actuator exec | returns stdout/stderr/exit code → terminal surface |
| `grep` / `glob` | actuator search | |
| `update_todo` | WorkspaceState | drives the editable todo UI (RC-6) |
| `task` (sub-agent) | nested AgentRunner | a constrained sub-agent for fan-out (later phase) |

`AnthropicProvider` stays for the existing builders; v3.0 uses the **new `ClaudeClient`** so we don't risk the live path.

---

## 5. Context model (RC-2)

- `ConversationStore` keeps the **full** message list (assistant turns + tool_results), persisted per session.
- **Prompt caching:** mark the system prompt + tool definitions + early stable turns with `cache_control: {type:'ephemeral'}` → big cost + latency win (directly offsets D2's billing exposure).
- Compaction only when nearing the context window: summarize oldest turns, keep recent verbatim (Claude-Code-style), never silently drop tool_results mid-task.

### 5.1 Persistence is the user's choice (D7)
- The user is **asked where their data lives**. Default: NavBharatAI-managed
  storage (existing DB/Firestore) for the transcript so a build survives a
  reconnect.
- With **BYOK** (user brings their own Claude key / their own DB), the transcript
  + the app's data live on the **user's own account** — honoring the CLAUDE.md
  "users' own accounts" principle for user *data*, even though build *compute* is
  billed via D5. `ConversationStore` is an interface with pluggable backends
  (managed vs user-owned) selected per the user's setting.

---

## 6. Strangler-fig migration plan (D1)

1. v3.0 lives behind a flag `AGENTV3_ENABLED` (env) + a per-user allowlist. Default OFF.
2. New route + new module → **zero imports into the live Pro/Engineer paths** at first. Live app untouched.
3. Internal dogfood: admin + allowlisted users hit `/api/agentv3/chat`.
4. Surface integration behind a UI flag (a "v3.0 (beta)" toggle in the builder).
5. When acceptance criteria (§8) pass on real builds, flip default ON; keep old path one release as fallback.
6. Retire Pro Chat / old Engineer loop only after v3.0 is proven in production.

No step removes or rewrites working code before its replacement is proven. **App never breaks.**

---

## 7. Sandbox, pricing & cost guardrails

### 7.1 Hybrid sandbox (D4) — "engine gets a sandbox, user gets a repo"
- **Engine execution** runs in a fast **E2B cloud sandbox** (keys available) — this
  is where tools (`bash`/`write`/`edit`) act, where the **live preview** is served
  from, and where parallel sub-agents work.
- **User ownership**: the sandbox is initialized as a **real Git repo**; every
  checkpoint is a real commit (`GitManager`, §3.2). The user can take the repo
  (download / push to their GitHub) — they own a real project, not a black box.
- The actuator layer (`E2BActuator` + a `GitManager`) bridges both: the engine
  sees a sandbox, the user sees a repo. Live preview streams from the same
  sandbox files the agents write (D9 — real, not mocked).

### 7.2 Pricing model (D5/D6) — markup over Opus-equivalent
NavBharatAI fronts the real provider cost (D2) and **bills the user a markup**, so
the platform is revenue-positive and the D2 exposure is fully covered:

```
billed_amount = user_tokens × OPUS_RATE × MULTIPLIER
  MULTIPLIER = 2.5   (standard — engine may route to Sonnet/Vertex; user still
                      pays the Opus-equivalent ×2.5, margin funds the platform)
  MULTIPLIER = 5.0   ("Only Opus" super toggle, D6 — forces Opus on every step)
```

- `OPUS_RATE` = the current Claude Opus input/output token price (configurable
  constant; updated when Anthropic pricing changes — keep in one place).
- `user_tokens` = real metered tokens for the build (input + output), counted by
  `CostGuard`. The **actual** model used (Sonnet / Opus / Vertex) determines
  NavBharatAI's real cost; the **user** is always billed at the Opus-equivalent ×
  the multiplier. The spread between real cost and billed amount is the margin.
- Wallet integration: reuse the existing wallet/usage-billing (`TokenUsageManager`,
  `routes/wallet.ts`) to charge the user's balance.

### 7.3 Guardrails (protect billing + the user)
- **`CostGuard`**: per-session token budget + per-user daily cap; hard stop with an
  honest "budget reached" message (never a fake success). The user sees a **live
  running cost estimate** as the build proceeds (transparency).
- **Model routing:** standard mode defaults to **Sonnet** under the hood (cheaper
  real cost, same 2.5× Opus-equivalent bill = healthy margin); the **Only-Opus
  super toggle** (D6) forces Opus and bills ×5.
- **Prompt caching** (§5) cuts real input-token cost on every turn → widens margin.
- **Step/iteration cap** + 45-min wall clock (carry over from Engineer AI) backstop.
- **Per-build cost + margin telemetry** for admin (extend `TokenUsageManager.ts` /
  `ObservabilityManager.ts`).
- **Abuse guard:** rate-limit + auth-gate `/api/agentv3/chat` (reuse existing auth
  middleware). Beta access is **admin-only** now → **logged-in users** at GA (D8).

---

## 8. Phased roadmap + acceptance criteria

| Phase | Deliverable | Acceptance gate (must be REAL) |
|---|---|---|
| **P0** | `AgentV3/` skeleton + `routes/agentv3.ts` flag-gated; no live-path imports; tsc + tests green. | Route returns a stub stream behind flag; live app unaffected. |
| **P1** | `ClaudeClient` + `AgentRunner` native tool-use loop with `read/write/edit/bash/grep/glob`, on a real E2B sandbox. | On a real prompt, agent creates a working multi-file app in the sandbox using native tools; transcript streams live. |
| **P2** | `ConversationStore` + prompt caching + compaction. | A 30+ step build stays coherent; cached-token ratio visible in telemetry. |
| **P3** | `AgentEventStream` + `GitManager` + **all 5 surfaces merged/synced** (Preview, IDE/Code Studio, File explorer, Git, History). | All five update live from one `WorkspaceState`; git checkpoints real; restore works; no drift. |
| **P3.5** | **Multi-agent team**: `Orchestrator` + `SubAgentRunner` + `task` tool + `AgentRegistry` (Frontend/Backend/DB/Designer/QA/Debugger/Reviewer/Deploy), parallel-safe. | Architect plans → delegates → sub-agents build (parallel where safe) → integrate → honest "done"; no write races. |
| **P3.6** | **Engagement layer**: live "AI Team" panel (agent cards, narration, parallel activity). | User watches named agents work live; todos tick, diffs stream, preview refreshes — never a dead spinner. |
| **P4** | Todo tool + plan mode + permission prompts (RC-6). | User sees editable todos, approves a plan, confirms risky actions — all wired. |
| **P5** | Claude billing wiring + `CostGuard` + CLAUDE.md amendment. | Runs on Sonnet/Opus within budget caps; cost telemetry per build; CLAUDE.md override recorded. |
| **P6** | Cutover: v3.0 default; old builders retired one release later. | v3.0 proven on real production builds; rollback path intact. |

Each phase = its own branch → PR → CI green → merge (CLAUDE.md rule). `AppKnowledgeBase.ts` updated in the SAME PR that ships any user-visible v3.0 surface.

---

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Claude cost runs away (D2) | §7 CostGuard + Sonnet-default + caching; hard budget stops. **Margin is structurally positive (D5):** user is billed Opus-equivalent ×2.5 (or ×5) while the real model used is ≤ Opus price — billed always ≥ real cost. |
| v3.0 destabilizes live app | Strangler-fig (§6): zero live-path imports until proven; flag default OFF. |
| Surface drift / race conditions | Single `WorkspaceState` source of truth; surfaces are read-only subscribers. |
| Parallel sub-agents writing the same file (corruption) | Architect serializes writes per file; parallelism only for independent files + read-only work (§3.3); sub-agent results integrated by the lead. |
| Multi-agent cost multiplies (each agent burns tokens) | Per-sub-agent budget under the global `CostGuard` (§7); sub-agents default to Sonnet; depth capped. |
| "AI team" feels gimmicky / fake activity | Every agent card reflects a REAL running sub-agent + real tool calls — never scripted/faked (CLAUDE.md real-features rule). |
| Sandbox cost/limits (E2B) | Reuse existing actuator pooling; per-session lifecycle caps. |
| A future session reverts billing per old CLAUDE.md rule | P5 amends CLAUDE.md to record the admin override (D2). |

---

## 10. AppKnowledgeBase impact

New/updated entries required (added in the PR that ships each surface):
- `agentv3_builder` — the v3.0 builder (path, how-to, keywords incl. Hindi/Hinglish, `aiSurface: 'engineer_ai'`).
- `agentv3_ai_team` — the multi-agent team panel (what each agent does, how to read it).
- `agentv3_surfaces` — merged Preview/IDE/File/Git/History (how they sync live).
- Update Engineer AI / Pro Chat entries when they are folded into / replaced by v3.0.

---

## 11. Open questions — ✅ ANSWERED by admin (2026-06-22)

1. **Sandbox** → ✅ **Hybrid E2B + real Git repo** (D4, §7.1). Both available; engine gets the sandbox, user gets an ownable repo.
2. **Budget / pricing** → ✅ **`user_tokens × Opus_rate × 2.5`** standard (D5, §7.2). NavBharatAI pays real cost, bills the markup.
3. **Opus access** → ✅ **"Only Opus" super toggle billed ×5** (D6). Standard mode routes to Sonnet under the hood, still billed at Opus-equivalent ×2.5.
4. **Persistence** → ✅ **User's choice** (D7, §5.1). User is asked where their data/DB lives; with BYOK it lives on the user's own account.
5. **Beta allowlist** → ✅ **Admin-only now → all logged-in users at GA** (D8). Enforced via `AGENTV3_ALLOWLIST`.

All five are now locked as decisions D4–D9 in §0. P1 is unblocked.

---

*Grounded in a structural audit of `src/server/{EngineerAI,AI,AppContext,routes,PreviewRunner,runtime}` and `src/components/{engineer,panels,ide}` on 2026-06-22. No runtime behavior changed by this document.*

---

# §11 — Multi-Model Intelligent Orchestration Engine (admin-directed, 2026-06-24)

**Admin (aashishcpmt09) directive:** route v3.0 across a cost ladder so every task runs on
the cheapest CAPABLE model, Claude only when needed — maximum quality at minimum API cost.
A new user asking for a calculator/clock/ludo/3D-ball must NOT cost ₹1600 or they never
return. Gemini/Vertex DO handle simple coding (like Cursor/others); they only break on
complex multi-file apps — so match model to complexity, with an objective safety net.

## Ladder (low → high)
| Tier | Model | Scope | Target traffic |
|------|-------|-------|----------------|
| 1 | Gemini / Vertex | chat, translate, summary, **simple apps** | 70-90% |
| 2 | Claude Haiku | light coding, components, bug-fix, SQL | 5-15% |
| 3 | Claude Sonnet | full/multi-file apps, refactor, backend | 1-5% |
| 4 | Claude Opus 4.7 | architecture, deep debug, critical | 0.1-1% |
| ⚡ POWER | **Opus 4.8 only** | everything (premium, ×5 billing) | toggle |

## Core mechanism (agreed design)
**Cheap-first, evaluate-gate decides, escalate only on objective failure.** Do NOT guess
complexity upfront and commit. Start at the analyser's tier; after the build run the
EXISTING 22-dimension evaluate engine (build/readiness/security/tests = objective, free,
no LLM call); pass → deliver, fail → escalate +1 tier (budget-capped). A wasted cheap
attempt costs ~₹0 (Gemini ≪ Opus), so the math wins: simple apps succeed cheap, complex
apps fail the gate fast and climb to Claude. The gate is the safety net → never ship a
broken calculator.

## Phases
- **P0 ✅** OpenAiToolAdapter + OpenAiToolRunner (Grok) + MultiProviderTurnRunner (orchestrator, Claude backstop). Off-default, tested.
- **P1 ✅** Gemini/Vertex native tool-use runner (GeminiToolAdapter + GeminiToolRunner) + full ladder model-ids (haiku / sonnet / opus-4.7 normal / opus-4.8 power) in models.ts. Off-default, tested.
- **P2** Analyser/router — hybrid: deterministic features (length, file-count, code-blocks, simple-app keywords, task-type) → complexity score + startTier; LLM-analyser (on Gemini) only for ambiguous. Pure + testable.
- **P3** Evaluate-gated escalation orchestrator: start at startTier → build → evaluate-gate → pass/deliver or escalate +1 (budget cap + circuit-breaker + fail-cache).
- **P4** Power mode: bypass ladder → Opus 4.8 (existing only-opus path).
- **P5** ⚠️ Billing-follows-actual-model (constitution-locked — needs explicit admin sign-off before pricing.ts changes; this is the lever that makes a Gemini calculator cost ₹20 not ₹1600).
- **P6** Cost dashboard: per-model/task/user cost, savings-vs-always-Opus, escalation/fallback rate (extend UserCostStore + UI).
- **P7** Failover hardening (Opus→Sonnet→Haiku→Gemini→Vertex; reuse AIRouter + orchestrator).
- **P8** LIVE verification + gradual flag-gated rollout (measure cheap-tier quality + Claude-fallback rate per task-type, then flip default tier-by-tier). Claude stays default until proven — "preview is EARNED".
- **P9** (optional) New-user free onboarding builds (Gemini → ~₹0 cost → retention).
- **Advice (shadow-mode):** before flipping default, run the analyser decision (+ optional cheap attempt) in the BACKGROUND while Claude still builds, and LOG what would have happened — real success data, zero user risk.

## Reuse, don't rebuild
AIRouter (failover/cooldown), MultiProviderTurnRunner (the chain), the 22-dim evaluate
engine (= the Quality Control Engine), AgentRegistry/SubAgent/Consensus (multi-agent
workers), UserCostStore (cost tracking), ONLY_OPUS_MULTIPLIER (Power ×5 billing).

## Strangler-fig isolation (unchanged constraint)
All new runners/adapters live under `src/server/AgentV3/providers/`, import only
ClaudeClient TYPES, and stay OFF the default path (Claude primary in routes/agentv3.ts)
until P8 live-verification. No live behaviour changes before then.

## §11.1 — Power-mode effort selector (admin-directed, 2026-06-24)
When the user ticks POWER (Opus 4.8 only), reveal a 5x / 10x / 20x selector near the chat
input that maps to Opus 4.8 reasoning EFFORT and the billing multiplier:
- **5x → mini effort** (Power default — fast, least thinking)
- **10x → medium effort** (deeper reasoning)
- **20x → max effort** (deepest — architecture/critical)
Effort = Opus 4.8 thinking/reasoning budget, so higher effort = genuinely higher real cost →
the 10x/20x multipliers are honest (margin preserved). Pieces: (1) AgentV3Panel reveals the
selector on Power tick; (2) ClaudeClient `thinking:boolean` extended to an effort level
mini/medium/max → thinking budget; (3) billing multiplier 5/10/20 (extends ONLY_OPUS_MULTIPLIER).
UX: per-option label + estimated cost; 20x behind a confirm; default 5x. This is a P4 (Power
mode) enhancement. ⚠️ The 10x/20x multipliers are NEW billing — gated on explicit admin sign-off
(with P5). Build after sign-off.

## §11.2 — Opus removed from NORMAL mode (admin decision, 2026-06-24)
Admin confirmed: NORMAL mode (Power OFF) tops out at **Sonnet** — Opus is **POWER-only**.
Normal ladder is now **Gemini → Haiku → Sonnet** (Sonnet is the ceiling/backstop). Rationale:
(1) billing stays flat & predictable (Normal = Sonnet-equivalent × 2, no surprise Opus bill);
(2) margin-safe — Sonnet-equivalent × 5 ≈ Opus real cost, so a normal-mode Opus would have been
~break-even; (3) clean premium upsell (Opus = Power); (4) Sonnet handles 99% of normal requests.
RequestAnalyser now caps normal-mode tier at Sonnet and, on `powerMode:true`, bypasses the ladder
→ Opus 4.8 (no escalation). UX: when Sonnet's gate keeps failing on a genuinely complex request,
SUGGEST "enable Power for Opus-grade" instead of silently spending more (high complexityScore is
preserved for this). `opusNormalModel()` (4.7) is retired from the normal ladder; Power uses
`opusModel()` (4.8). Billing rules (Normal Sonnet-equiv×2 / Power real-Opus×5) and the Power
effort multiplier (flat 5× vs 5/10/20×) are P5 — still pending admin confirm before pricing.ts.

## §11.3 — Billing LOCKED (admin sign-off, 2026-06-24)
Final customer billing (always shown in INR; USD→INR at the real-time rate):
- **NORMAL (Power OFF):** whichever provider answered (user never knows), bill AS IF Sonnet ran
  → price the real tokens at Sonnet's rate × **3.5** → INR. (Opus is power-only, so this is flat
  and never surprises the user.)
- **POWER (Power ON):** bill the REAL Opus 4.8 cost (what Claude charges us) × **2.5** → INR. The
  effort selector (mini/medium/max) only changes real tokens; the multiplier stays 2.5×.
Margin positive in both modes (billed ≥ real cost). `onlyOpus` (the existing Power toggle,
req.body.onlyOpus) is the mode flag — already wired to resolveModel + billing.
P5-core (this change): pricing.ts reshaped — NORMAL_MULTIPLIER=3.5, POWER_MULTIPLIER=2.5,
sonnetRate()/sonnetEquivalentUsd added, billedAmountUsd(usage, powerMode) = power? Opus×2.5 :
Sonnet×3.5, + billedAmountInr(usage, powerMode, rate). NEXT (P5-inr): a UsdInrRate module
(env default + best-effort real-time refresh + fallback) and wire billedAmountInr to the
customer-facing ₹ display.

## §11.4 — P5-inr: real-time USD→INR + customer ₹ (2026-06-24)
`src/server/lib/UsdInrRate.ts`: a cached USD→INR rate, refreshed best-effort hourly from a
free no-key FX source (open.er-api.com), with synchronous `usdInrRate()` readers that NEVER
throw/block (billing must never break on FX). Fallback = env `USD_INR_RATE` or 85; auto-refresh
skipped under tests. The route computes `billedInr = round(billedUsd × usdInrRate(), 2)` and
adds it to the `result` message (customer-facing ₹). Internal accounting stays in USD
(currency-stable, no migration); INR is the display. Frontend ₹ display + the Power effort UI
(P4) are next.

## §12 — App hosting on mitrify.xyz (admin-directed, 2026-06-24) — DESIGN LOCKED, BUILD GATED ON VERIFY

Admin (aashishcpmt09) owns a web-hosting domain **mitrify.xyz** which is "linked to E2B".
Separate from NavBharatAI's OWN platform site (navbharatai.com / the Cloud Run service
`navbharat-ai-prod`) — mitrify.xyz is purely for the **end-user apps that v3.0 builds**.

### Decision (admin, 2026-06-24)
- **Default — user has NOT connected their own domain:** mitrify.xyz serves BOTH roles for the
  built app: (a) **live preview** while building, and (b) **durable deploy/hosting** that stays
  live after the build sandbox closes.
- **After the user connects their own website** (via GitHub or DNS, the existing "Connect my
  website" flow → `/api/domains/connect`, Cloudflare-for-SaaS): the user's own domain becomes the
  production/deploy home, and mitrify.xyz is demoted to **preview only**.
- So the publish-target resolver is: `userOwnDomainConnected ? deployTo(userDomain), previewOn(mitrify)
  : deployTo(mitrify), previewOn(mitrify)`.

### Ground-truth state of the code (audited 2026-06-24, NOT assumed)
- `src/server/lib/cloudflare.ts` ALREADY uses mitrify.xyz as the Cloudflare-for-SaaS zone name
  (`CLOUDFLARE_SAAS_ZONE_NAME` default `mitrify.xyz`; fallback origin `connect.mitrify.xyz`).
- `/api/domains/connect` (`src/server/routes/domains.ts`) creates the Cloudflare custom hostname
  and returns DNS records, and persists a `custom_domains` mapping — BUT there is **no serving
  layer yet** that routes an incoming hostname (`connect.mitrify.xyz` / a user domain) → the
  running user app. AppKnowledgeBase honestly states the connect backend "is being finalized".
- v3.0 live preview currently returns the RAW E2B host: `E2BActuator.getPortUrl` →
  `https://${sandbox.getHost(port)}` (i.e. `{port}-{sandboxId}.e2b.app`), NOT a mitrify URL.

### The gap (what must be built — but only after the link is verified)
1. **Preview on mitrify**: swap/override the preview URL from `*.e2b.app` to a `*.mitrify.xyz`
   form. The EXACT URL format depends on HOW mitrify is linked to E2B (E2B-native custom domain =
   host-suffix swap; a reverse proxy = proxy URL scheme; Cloudflare-SaaS = a serving layer). This
   is unconfirmed, so it is NOT yet implemented — guessing the format would ship a broken/fake URL,
   which violates the "real features only" rule.
2. **Durable deploy**: a publish step at build completion that puts the built artifact on a
   permanent home (E2B sandboxes are ephemeral and pause/expire, so they cannot be the durable
   host) + a hostname→app serving/routing layer behind mitrify.xyz.
3. **Publish-target resolver**: pick mitrify vs the user's connected domain per the decision above.

### BUILD GATE (why nothing is shipped yet)
The admin chose "not sure / I'll check" for the E2B↔mitrify link mechanism. Per safeguard #3
(0.01% doubt → stop) and the "real features only" rule, NO preview/deploy URL change ships until
the admin confirms the real mechanism (E2B dashboard custom-domain setting + mitrify DNS records +
which Cloud env vars are set). Verification steps were given to the admin. Once confirmed, wire the
real format — never a guessed one.

### §12.1 — Preview-on-mitrify IMPLEMENTED (2026-06-24); durable deploy still pending

Admin confirmed (2026-06-24) the E2B link mechanism: **mitrify.xyz is an E2B-native custom domain**
(it shows in the E2B dashboard "Domains/Custom domain" setting) and said "preview/deploy me mitrify
show hone do, chalega". E2B custom domains are an ADDITIVE alias — the sandbox keeps running on the
same infra and the SDK API endpoint (`api.e2b.app`) is unchanged; only the user-facing host suffix
differs (`{port}-{id}.e2b.app` ↔ `{port}-{id}.mitrify.xyz`).

Verified the E2B SDK (v2.30.0): `sandbox.getHost(port)` →
`connectionConfig.getHost(id, port, sandboxDomain)` → `${port}-${id}.${domain}`, where `domain`
defaults to `E2B_DOMAIN || 'e2b.app'`. Reconfiguring the SDK `domain` is the WRONG lever — it also
rewrites `apiUrl = https://api.${domain}` and would break sandbox creation. So the correct, surgical
fix is a host-suffix swap on the user-facing preview URL only.

Shipped:
- `src/server/AgentV3/PreviewDomain.ts` — PURE `applyPreviewDomain(url, domain?)`: swaps a `*.e2b.app`
  host suffix → `*.<previewDomain>` (default `mitrify.xyz`, override `E2B_PREVIEW_DOMAIN`, set it to
  `e2b.app` to disable). Idempotent; leaves localhost / already-custom / non-e2b hosts untouched.
- Wired ONLY in `ToolDispatcher.update_preview` (v3.0 path) — the live Engineer AI builder's
  `E2BActuator.getPortUrl` is untouched, so zero blast radius on the existing production builder.
- Tests: PreviewDomain.test.ts (6) + a dispatcher integration test (e2b host → mitrify.xyz).

STILL PENDING (the "deploy" half of §12): a DURABLE host + hostname→app serving layer so a finished
app stays live after the ephemeral E2B sandbox closes, plus the publish-target resolver
(mitrify vs the user's own connected domain). E2B sandboxes pause/expire, so they cannot BE the
durable host — this needs real infra (a persistent runtime or a static/SSR deploy target) and is the
next build step once the durable-host target is chosen. Preview is real now; durable deploy is not
yet built (honest state — not faked).

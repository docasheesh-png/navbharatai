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

> ⚠️ Because of D2, before any v3.0 build code lands, the CLAUDE.md "Engineer AI permanent constraints" section must be amended (in the same PR that wires Claude billing) to record this admin override — otherwise a future session will revert it per the old rule.

---

## 1. Scope — what "99% Claude Code" means here

### ✅ In scope (the 99% we CAN build)
- **Native Anthropic tool-use** agent loop (parallel tool calls, structured, no JSON-in-text parsing) — RC-1.
- **Growing transcript + prompt caching** for long-horizon coherence — RC-2.
- **Claude Sonnet/Opus** as the reasoning model — RC-3.
- **One canonical agent** that the four surfaces (Preview, File explorer, Code Studio, History) all read from in **real time** — RC-5 + the user's explicit sync ask.
- **Editable todo list, plan mode, permission prompts** — RC-6.
- Claude-Code-style tool catalog: Read / Write / Edit / Bash / Grep / Glob / a sub-agent (Task) tool.

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
| `ClaudeClient.ts` | Thin wrapper over `@anthropic-ai/sdk` `messages.stream` with `tools`, `tool_choice`, `cache_control`, model routing (Sonnet default / Opus on demand). |
| `ConversationStore.ts` | Persisted, growing message transcript per session (replaces per-step prompt rebuild). Applies prompt-cache breakpoints. |
| `ToolCatalog.ts` | Native Anthropic tool **definitions** (name, description, `input_schema`) for read/write/edit/bash/grep/glob/todo/task. |
| `ToolDispatcher.ts` | Maps a `tool_use` block → an actuator/VFS call → a `tool_result`. Enforces permission mode. |
| `WorkspaceState.ts` | Canonical state: file tree, diffs, terminal log, todo list, plan, checkpoints. Emits change events. |
| `AgentEventStream.ts` | SSE/WS publisher; every surface subscribes. Event types: `tool_call`, `tool_result`, `file_changed`, `diff`, `todo_updated`, `plan_updated`, `thinking`, `permission_request`, `done`. |
| `CostGuard.ts` | Per-session + per-user budget caps, model routing, token metering (see §7). |
| `index.ts` | Public entry consumed by the new route. |

New route: `routes/agentv3.ts` → `POST /api/agentv3/chat` (NDJSON/SSE stream). Feature-flagged.

### 3.2 Surfaces real-time sync (the user's explicit ask)
All four surfaces stop holding independent state and instead **subscribe to `AgentEventStream`** + read `WorkspaceState`:
- **Preview** — re-renders on `file_changed` for preview-relevant files (debounced).
- **File explorer** — live tree from `WorkspaceState.fileTree`; highlights touched files.
- **Code Studio** — opens the file the agent is editing; shows the live `diff` event (red/green) as it streams.
- **History** — appends every `tool_call`/checkpoint; restore = revert `WorkspaceState` to a checkpoint.

This is the same single state object → guaranteed consistency (no drift between panes).

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

- `ConversationStore` keeps the **full** message list (assistant turns + tool_results), persisted per session (DB/redis).
- **Prompt caching:** mark the system prompt + tool definitions + early stable turns with `cache_control: {type:'ephemeral'}` → big cost + latency win (directly offsets D2's billing exposure).
- Compaction only when nearing the context window: summarize oldest turns, keep recent verbatim (Claude-Code-style), never silently drop tool_results mid-task.

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

## 7. Cost-control guardrails (mandatory because of D2 — NavBharatAI pays)

These protect NavBharatAI's Anthropic billing:
- **`CostGuard`**: per-session token budget + per-user daily budget; hard stop with an honest "budget reached" message (never a fake success).
- **Model routing:** **Sonnet is the default**; Opus only when the user/task explicitly opts in (a toggle), or for a final hard step.
- **Prompt caching** (§5) to cut input-token cost on every turn.
- **Step/iteration cap** + 45-min wall clock (carry over from Engineer AI) as a backstop.
- **Per-build cost telemetry** surfaced to admin (extend `TokenUsageManager.ts` / `ObservabilityManager.ts`).
- **Abuse guard:** rate-limit + auth-gate `/api/agentv3/chat` (reuse existing auth middleware).

---

## 8. Phased roadmap + acceptance criteria

| Phase | Deliverable | Acceptance gate (must be REAL) |
|---|---|---|
| **P0** | `AgentV3/` skeleton + `routes/agentv3.ts` flag-gated; no live-path imports; tsc + tests green. | Route returns a stub stream behind flag; live app unaffected. |
| **P1** | `ClaudeClient` + `AgentRunner` native tool-use loop with `read/write/edit/bash/grep/glob`, on a real E2B sandbox. | On a real prompt, agent creates a working multi-file app in the sandbox using native tools; transcript streams live. |
| **P2** | `ConversationStore` + prompt caching + compaction. | A 30+ step build stays coherent; cached-token ratio visible in telemetry. |
| **P3** | `AgentEventStream` + 4 surfaces real-time sync. | Preview/Files/CodeStudio/History all update live from one state; no drift. |
| **P4** | Todo tool + plan mode + permission prompts (RC-6). | User sees editable todos, approves a plan, confirms risky actions — all wired. |
| **P5** | Claude billing wiring + `CostGuard` + CLAUDE.md amendment. | Runs on Sonnet/Opus within budget caps; cost telemetry per build; CLAUDE.md override recorded. |
| **P6** | Cutover: v3.0 default; old builders retired one release later. | v3.0 proven on real production builds; rollback path intact. |

Each phase = its own branch → PR → CI green → merge (CLAUDE.md rule). `AppKnowledgeBase.ts` updated in the SAME PR that ships any user-visible v3.0 surface.

---

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Claude cost runs away (D2) | §7 CostGuard + Sonnet-default + caching; hard budget stops. |
| v3.0 destabilizes live app | Strangler-fig (§6): zero live-path imports until proven; flag default OFF. |
| Surface drift / race conditions | Single `WorkspaceState` source of truth; surfaces are read-only subscribers. |
| Sandbox cost/limits (E2B) | Reuse existing actuator pooling; per-session lifecycle caps. |
| A future session reverts billing per old CLAUDE.md rule | P5 amends CLAUDE.md to record the admin override (D2). |

---

## 10. AppKnowledgeBase impact

New/updated entries required (added in the PR that ships each surface):
- `agentv3_builder` — the v3.0 builder (path, how-to, keywords incl. Hindi/Hinglish, `aiSurface: 'engineer_ai'`).
- Update Engineer AI / Pro Chat entries when they are folded into / replaced by v3.0.

---

## 11. Open questions for admin (before P1 code)

1. **Sandbox:** confirm E2B is the v3.0 "real repo" (vs Docker). E2B keys provisioned for production volume?
2. **Budget numbers:** per-build and per-user daily caps (USD) for `CostGuard`?
3. **Opus access:** Opus opt-in for all users, or premium-tier only?
4. **Persistence:** where does `ConversationStore` live (existing DB? redis?) for transcript durability across reconnects?
5. **Beta allowlist:** which users get the v3.0 toggle first?

---

*Grounded in a structural audit of `src/server/{EngineerAI,AI,AppContext,routes,PreviewRunner,runtime}` and `src/components/{engineer,panels,ide}` on 2026-06-22. No runtime behavior changed by this document.*

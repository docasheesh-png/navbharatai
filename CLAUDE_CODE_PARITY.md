# Claude Code Parity — Gap Analysis & Roadmap

> **Status:** Analysis only. No runtime/model-wiring changes have been made.
> **Owner decision pending:** RC-3 (running the agent on Claude) is gated by a
> billing/policy decision — see "Hard policy gate" below. Do NOT implement RC-3
> until the admin explicitly authorizes spending NavBharatAI's own Anthropic
> credits on builds (CLAUDE.md currently forbids it).

This document compares **NavBharatAI Pro's app-building capacity** with
**Claude Code's** (Anthropic's agentic coding harness), enumerates the gaps
grouped by **root cause**, and assesses the feasibility of the two stated goals:

1. Run the NavBharatAI Pro backend on Claude Sonnet/Opus.
2. Make NavBharatAI Pro's UX / processing / results / steps mirror Claude Code.

---

## 0. Honest verdict (TL;DR)

| Goal | Feasible? | Reality |
|---|---|---|
| **1. Backend on Claude Sonnet/Opus** | ✅ Yes (code) | Easy code change, but blocked by a **billing/policy gate** (real money on NavBharatAI's Anthropic account; CLAUDE.md forbids it today). |
| **2. UX/steps like Claude Code** | 🟡 ~70% | Most of the *experience* is replicable; Engineer AI already implements ~60%. |
| **"NavBharatAI Pro = Claude Code" (exact copy)** | ❌ Not literally | Different product categories: a hosted web app-builder on an ephemeral cloud sandbox vs a local agentic dev-CLI whose harness/model-training is Anthropic-proprietary. |

**Bottom line:** You can build a **Claude-Code-class** agentic builder (~80% of the
"feel"), not a byte-for-byte copy of Claude Code.

---

## 1. Architecture side-by-side

NavBharatAI currently ships **two** separate builders (plus a third IDE surface) —
fragmentation that is itself a gap (RC-5).

| | **Pro Chat** (`/api/build-stream`) | **Engineer AI** (`/api/engineer-chat`) | **Claude Code** |
|---|---|---|---|
| Paradigm | Pipeline `prompt → app` | Agentic ReAct loop | Agentic, native |
| Tool calls | none (blueprint→HTML→JS→CSS) | 1 JSON action / step (`{thought,action,args}`) | Native `tool_use`, **parallel** |
| Tool parsing | n/a | regex + `JSON.parse` (`EngineerAgentLoop.ts:207`) | structured tool blocks |
| Model | Claude race + Grok | **hardcoded `grok-3`** (`EngineerAgentLoop.ts:504`) | Claude Sonnet/Opus |
| Files | in-memory VirtualFileSystem | real E2B/Docker sandbox | the user's **real repo** |
| Context | rebuilt every step (grep-rank-pack + condensed history) | same | growing transcript + prompt caching |
| Completion | coverage % | `done` gated by real build+tests | model-driven, verified |
| UI | chat + Monaco + preview iframe | chat + Terminal/Files(diff)/Browser/Checkpoints tabs | terminal/IDE-native transcript |
| Plan | Guider approval gate | plan rendered as a progress bar | **editable todo list** + plan mode |
| Stream | SSE-ish reader | NDJSON event stream | native |

**Engineer AI** is the Claude-Code-shaped surface and should be the base to evolve.

---

## 2. Gap list — grouped by ROOT CAUSE

### 🔴 RC-1 — Tool-calling protocol: JSON-in-text vs native tool-use *(deepest gap)*
- **Now:** the model must emit one JSON object `{thought, action, args}` per step,
  extracted via regex + `JSON.parse` (`EngineerAgentLoop.ts:178,207`). One action
  per step; parse failures need retry "nudges"; `AnthropicProvider` never passes a
  `tools` parameter (`AI/Router/providers/AnthropicProvider.ts`).
- **Claude Code:** native Anthropic `tool_use` blocks — structured, **parallel**
  tool calls, no brittle parsing, the model is post-trained for exactly this format.
- **Impact:** reliability, speed (parallel tools), and overall "feel."
- **Effort:** 🔴 Large — rewrite `AnthropicProvider` to send `tools`/`tool_choice`,
  carry `tool_use` blocks through `AIProviderResponse` (today it's `content: string`
  only), and replace the loop's `JSON.parse` dispatch with native tool consumption.

### 🔴 RC-2 — Context model: stateless-prompt-per-step vs growing transcript + caching
- **Now:** `buildPrompt()` (`EngineerAgentLoop.ts:1307`) rebuilds the whole prompt
  every step: grep-rank-pack relevant files fresh, keep the last ~12 steps verbatim
  and condense older ones to one line each. The model never sees its own prior
  reasoning verbatim.
- **Claude Code:** a growing message transcript + **prompt caching**; the model sees
  all prior tool results/thoughts → far better long-horizon coherence.
- **Effort:** 🔴 Large — architectural shift in how history is fed to the model.

### 🔴 RC-3 — Model wiring: hardcoded Grok override *(direct blocker for Goal #1)*
- **Now:** `EngineerAgentLoop.ts:504` forces `'grok-3'` on **every** reasoning step.
  This override is passed to whichever provider wins — so the Anthropic fallback
  receives an invalid `model='grok-3'`. The Engineer loop therefore **cannot actually
  run on Claude today.** The Free chain never registers Claude at all
  (`AIRouterManager.buildFree`).
- **Claude Code:** always Claude.
- **Effort:** 🟢 Small (the wiring change is easy) — **but billing-gated** (see §4).

### 🟠 RC-4 — Loop granularity + step cap
- **Now:** one action per step; ~24–60 step cap; 45-minute deadline; each step =
  full prompt rebuild + a single tool.
- **Claude Code:** many parallel tool calls per turn; no artificially tight cap;
  long-horizon.
- **Effort:** 🟠 Medium — largely falls out of RC-1.

### 🟠 RC-5 — Fragmented surfaces (Pro Chat ≠ Engineer AI ≠ CodeStudio)
- **Now:** three different builders with different UX that don't share code. The
  retired `/api/pro-build` is dead code; Pro Chat uses `/api/build-stream`; Engineer
  AI uses `/api/engineer-chat`; CodeStudio is a separate IDE.
- **Claude Code:** one coherent agent surface.
- **Effort:** 🟠 Medium — consolidate onto Engineer AI; product decision.

### 🟠 RC-6 — UX surface: web two-pane vs editor-native transcript
- **Now:** progress bars, percent, plan-as-progress-bar, tabs. Real diffs live only
  in the separate CodeStudio surface.
- **Claude Code:** tool-call transcript, **editable todo list**, diffs applied to the
  working tree, permission prompts, slash commands, plan mode.
- **Effort:** 🟠 Medium — Engineer AI already implements ~60% (terminal w/ exit codes,
  red/green diffs, checkpoints, browser drive).

### 🟡 RC-7 — Execution environment: ephemeral sandbox vs the user's real repo *(the literal-copy wall)*
- **Now:** files live in an E2B/Docker sandbox, then are collected into a VFS / zip /
  deploy. Not the user's machine or repo.
- **Claude Code:** runs on the user's **real machine/repo** — edits real files, real
  git, persistent.
- **Impact:** this is the fundamental reason an *exact* copy is impossible — a browser
  web-app cannot have local-filesystem access to the user's machine.
- **Effort:** 🔴 Architectural, or accept that this stays different.

### 🟡 RC-8 — Missing platform features
- **Now:** no slash commands, hooks, MCP servers, subagents (Task tool), background
  tasks, per-project memory (CLAUDE.md), permission modes, plan mode, IDE integration.
- **Claude Code:** all of the above.
- **Effort:** 🔴 Very large — each is its own project.

---

## 3. Goal #1 — Backend on Claude Sonnet/Opus

**Code changes required (precise):**
1. `EngineerAI/EngineerAgentLoop.ts:504` — remove the hardcoded `'grok-3'` override
   (or pass a Claude model id). **Single most important line.**
2. `EngineerAI/EngineerRouterFactory.ts:25-51` — make `AnthropicProvider` priority 1,
   with an explicit model (`claude-sonnet-4-...` / opus).
3. `AI/AIRouterManager.ts` `buildPro` — already Claude-primary (Opus 4.8); refresh model ids.
4. `AppMakerLab/AppEngine.ts` `callAI` race — drop Grok from the racer set or make it a
   sequential fallback after Claude.
5. `.env.example` — fix the labels (it currently calls Gemini "primary").

### ⚠️ Hard policy gate (must be cleared first)
CLAUDE.md — *Engineer AI permanent constraints*:
> "Grok is primary… **AiCreditsProvider is NEVER registered** — it proxies through
> NavBharatAI's own account credits, which must never be spent on user builds.
> User apps run on the **user's own accounts**."

Running every build on Claude means spending **real money on NavBharatAI's own
Anthropic account**. That is an **admin business decision**, not just a code change.
**Do not implement RC-3 without explicit admin authorization to override this rule.**

---

## 4. Goal #2 — UX / steps like Claude Code

**✅ Replicable (much already exists in Engineer AI):**
- Tool-call transcript / action cards — ✓ already
- Real terminal with exit codes — ✓ already
- Red/green diffs — ✓ already (Files tab)
- Checkpoints / restore (≈ undo) — ✓ already
- Live preview + browser "drive" — ✓ already
- Editable **todo list** — today it's a progress bar → build a todo tool
- **Plan mode** — today it's the Guider gate → Claude-Code-style plan→approve
- **Permission prompts** — today actions auto-run → confirm-before-act
- Slash commands — addable in the web UI

**❌ Not literally replicable (RC-7, RC-8):**
- Editing the user's real local machine/repo (browser is sandbox-only)
- OS-level hooks / a real local terminal on the user's machine
- IDE-native extension (VS Code / JetBrains)
- Anthropic's proprietary harness + model training

---

## 5. Recommended roadmap (priority order)

1. **RC-3** — Claude wiring fix. Small, foundational. *Requires admin billing sign-off.*
2. **RC-1** — native tool-use. Large, but delivers the most "Claude Code feel."
3. **RC-2** — growing transcript + prompt caching. Long-horizon coherence.
4. **RC-5** — consolidate onto a single canonical surface (Engineer AI); fold Pro Chat in.
5. **RC-6** — todo-list + plan-mode + permission-prompt UI.
6. **RC-4 / RC-7 / RC-8** — incremental / accept-as-different.

---

*Generated from a line-level audit of `EngineerAgentLoop.ts`, `ProEngineRunner.ts`,
`PlannerAgent.ts`, `CoderAgent.ts`, `EngineerRouterFactory.ts`, `AppEngine.ts`,
`AIRouterManager.ts`, `AnthropicProvider.ts`, `routes/engineer.ts`, `routes/pro.ts`,
and the frontend `EngineerAIChat.tsx` / `ProChatPanel.tsx` / `App.tsx` build flow.*

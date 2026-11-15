# Pro Chain V2 — per-agent builder chain (Surplus → Router One → Qubax → Mitrify)

Owner request t350u (2026-11-15). **Status: behind a flag, ON only for the test profile `z@gmail.com`.**
Every other user — and z@ on any band other than Weak (the default Pro band) — runs exactly the
code path that existed before this change (`tests/proChainV2Wiring.test.ts` proves the Weak chain
is byte-for-byte the tier ladder without the v2 context).

Code: `src/server/AgentV3/proChainV2/` (new), wired in `src/server/routes/agentv3.ts`
(`buildTurnRunner` first line + `proChainV2TurnRunner` / `proChainV2ForBuild` helpers).

## What it does, in plain words

* A build uses many agents (planner, builders, healers, retries, escalations — roughly 10–15). In v2
  **each agent gets its own chain** and falls back on its own:
  1. **Surplus** (when the build was admitted to Surplus — unchanged admission, unchanged 10× billing).
     If Surplus fails for an agent with a recoverable engine error, **only that agent** leaves Surplus
     and the SAME turn is retried on the next engine. Other agents keep Surplus.
     If 3 agents lose Surplus within 2 minutes, NEW agents start past Surplus for 2 minutes;
     agents already running are not moved.
  2. **Router One** — called only through its existing builder entry point (`openAiCompatRunners`
     with `ROUTER_ONE_LABEL`), only when `routerOneWeakFallbackEnabled()` says so. Its accounting
     files are untouched; its billing is exactly today's.
  3. **Qubax** — a NEW builder adapter (the AI-chat Qubax files are not used or changed).
     OpenAI-compatible tool calling at `https://api.qubax.ai/v1`.
  4. **Mitrify** — a NEW builder adapter (the AI-chat Mitrify files are not used or changed).
     OpenAI-compatible tool calling at `MITRIFY_BASE_URL` (default `https://mitrify.com/v1`).
* **No GLM, no KIMI, no ladder tail** for a v2 build (even the planner/heal/escalation lanes).
* **Sticky per agent:** the engine that answered an agent's turn leads that agent's next 4 turns,
  then the owner order (R1 → Qubax → Mitrify) applies again.
* A dead key (401/403-type fatal error) is benched for the whole build, as today.

## Billing

| Engine | How it is billed |
|---|---|
| Surplus | unchanged (10×, its own accounting) |
| Router One | unchanged (its own accounting; `realRateFor` still refuses it) |
| Qubax | the model's per-token price from Qubax's public catalog (`GET /v1/models`, refreshed every 10 min, last good copy kept) × the normal tiered markup (4× up to $1, 3× above). If the catalog price is missing/zero, the existing conservative model-first card rate is used and the report says **estimated**. |
| Mitrify | `MITRIFY_BUILDER_RATE_IN/_OUT/_CACHE` (USD per million tokens) when set; otherwise an **estimated** rate ($0.15 in / $0.50 out / $0.03 cache — the Surplus floor rate for glm-5.3-flash) × normal markup, labelled estimated in the report. |

When a supplier returns **no token usage**, the turn is billed from an estimate (≈4 characters per
token of the request/response) and the report records `PRO_CHAIN_V2_USAGE_ESTIMATED`. Never a
silent ₹0.

## Reports (admin-only detail, user sees the brand only)

* The admin build report gets a `proChainV2` block: reason (`test-profile`, `allowlist`, `public`),
  per-agent engine counts, fallback turns, Surplus drops, failed calls per engine, rate source
  per engine/model (`catalog` / `configured` / `estimated`), estimated-usage turns.
* Issue lines `PRO_CHAIN_V2_ACTIVE / _AGENT / _ENGINE / _FALLBACK / _PRIMARY_DROPPED /
  _PRIMARY_SKIP / _EXHAUSTED / _CALL_FAILED / _USAGE_ESTIMATED / _RATE_ESTIMATED / _SCOPE_*`
  carry status, error code, latency, model and a redacted supplier message. Keys (exact values
  and key shapes) are stripped. Capped at 250 lines per build.
* The **user-facing** report turns every `PRO_CHAIN_V2_*` line into one neutral line
  (`ENGINE_ROUTING`, "NavBharatAI routed this step to another engine."), with no detail and no
  `proChainV2` block. A supplier's own name inside a thrown error is replaced by its neutral
  label (`ENGINE_QX` / `ENGINE_MF`) before it can reach the build's error copy.

## Cloud Run environment variables

Required for the chain to have engines after Surplus (already present if AI chat uses them —
**check, do not re-create**):

| Variable | Needed for | Notes |
|---|---|---|
| `QUBAX_API_KEY` | Qubax rung | secret; same key the chat uses |
| `MITRIFY_API_KEY` | Mitrify rung | secret (`mtf_live_…`); same key the chat uses |
| `ROUTER_ONE_API_KEY` | Router One rung | existing; unchanged |

Optional:

| Variable | Default | Meaning |
|---|---|---|
| `PRO_CHAIN_V2` | (unset = on for the listed users) | `off` = kill switch, everyone (z@ too) back on the old chain |
| `PRO_CHAIN_V2_PUBLIC` | (unset) | **`on` = GO PUBLIC** — every Weak/default-Pro build uses v2 |
| `PRO_CHAIN_V2_USERS` | (unset → z@gmail.com test profile) | comma list of exact emails/uids; REPLACES the default list |
| `PRO_CHAIN_V2_QUBAX` / `PRO_CHAIN_V2_MITRIFY` | on | `off` removes that engine from v2 only |
| `QUBAX_BUILDER_MODELS` | `glm-5.3,kimi-k2.7-code,glm-5.2` | Qubax builder models in order; non-tool / not-ready / <64k-context ids are skipped using the catalog |
| `QUBAX_BUILDER_SCOPE_MODEL` | `qwen3-235b-a22b-2507` | model for the one-word build-scope question |
| `MITRIFY_BUILDER_MODEL` | `MITRIFY_MODEL`, else `mitrify/auto-cheap` | Mitrify builder model(s), comma list |
| `MITRIFY_BASE_URL` | `https://mitrify.com/v1` | https only (shared with chat) |
| `MITRIFY_BUILDER_RATE_IN` / `_OUT` / `_CACHE` | estimated rate | real Mitrify price in USD per million tokens — set this to stop the "estimated" label |
| `PRO_CHAIN_V2_STICKY_TURNS` | 4 | turns an agent stays on the engine that last answered |
| `PRO_CHAIN_V2_SURPLUS_SKIP_AFTER` | 3 | Surplus drops (any agents) that open the skip window |
| `PRO_CHAIN_V2_SURPLUS_SKIP_MS` | 120000 | skip window length |

Existing provider kill switches (`providerSwitches.ts`) still apply to both keys/hosts.

## How the owner tests as z@ after a deploy

1. Deploy is a separate, owner-approved step (this PR does not deploy). After deploy, confirm the
   Cloud Run revision has `QUBAX_API_KEY` and `MITRIFY_API_KEY` (and, optionally,
   `MITRIFY_BUILDER_MODEL` / `MITRIFY_BUILDER_RATE_*`).
2. Sign in as `z@gmail.com`, keep the default Pro band (Weak), and build an app.
3. Open the build report (admin / Console Run → build report):
   * a `PRO_CHAIN_V2_ACTIVE` line with reason `test-profile`;
   * the `proChainV2` block: `agents` shows which engine each agent (`planner#1`, `builder#3`, …) used;
   * `PRO_CHAIN_V2_FALLBACK` / `_CALL_FAILED` lines show any fallback and why;
   * `rateSources` shows whether each engine was priced from the catalog, configuration or an estimate.
4. Build again as any other account: there must be no `PRO_CHAIN_V2_*` line (unchanged path).
5. Emergency stop: set `PRO_CHAIN_V2=off` (new revision) — z@ returns to the old chain.

## Going public (one flag)

Set `PRO_CHAIN_V2_PUBLIC=on` on the Cloud Run service. Nothing else changes. Before doing so,
resolve the open items below.

## Open items / risks (honest)

* **Mitrify tool calling is UNVERIFIED.** Its `/v1/models` needs a key, so the catalog could not be
  read and no live call was made (no paid calls in this change). If Mitrify ignores `tools`, its turns
  will produce text only and the agent will fall back or stall. Verify with one z@ build first.
* **Mitrify data review:** the chat transport keeps a data-review/approval gate for Mitrify. The builder
  adapter sends the user's code and prompt to Mitrify. Decide on this BEFORE going public.
* **Qubax tool calling is catalog-verified only** (`capabilities.tools: true` and `tools` in
  `supported_parameters` for glm-5.3, kimi-k2.7-code, glm-5.2 on 2026-11-15), not live-call verified.
* **Prices may be estimates** until `MITRIFY_BUILDER_RATE_*` is set; Qubax's catalog price is taken as
  published.
* **More Surplus attempts:** each agent tries Surplus until it fails for that agent (up to the skip
  window), so a Surplus outage costs a few extra failed calls per build compared with today's
  build-wide drop.
* **Auxiliary helpers** (fast lane, clarity judge, review judge) are unchanged; the review judge does not
  run for Qubax/Mitrify-led builds (same as Router One today).
* A Qubax 429 benches that engine process-wide for its cooldown, as every named rung does today.

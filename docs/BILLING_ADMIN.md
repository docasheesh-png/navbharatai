# NavBharatAI Pro v3.0 — Billing Admin Guide

How the v3.0 build billing works end to end, how to read the admin reports, and how the
per-provider metering is wired. This is the honest reference for the money path — it matches the
code, not a plan.

## The money model (admin-approved 2026-07-05)

The user is billed on the **model TIER** that did the work, priced against Claude rates — **never**
on which provider actually answered, and **never** shown provider names, model names, or ₹ costs.

| Tier | When | Markup |
|------|------|--------|
| `cheap`  | normal builds (Haiku / GLM / Kimi / Grok / Gemini / Vertex) | Sonnet-equivalent cost × **1.2** |
| `sonnet` | Sonnet actually ran (per-tier billing only — see flag below) | Sonnet-equivalent × **3** |
| `opus`   | power mode (Opus 4.8 runs 100%) | real Opus cost × **2** |

Margin is structurally positive in every tier (billed ≥ real cost). Rates are env-overridable
(`SONNET_INPUT_PER_MTOK`, `OPUS_OUTPUT_PER_MTOK`, …) so ops can track live Anthropic prices without
a deploy. See `src/server/AgentV3/pricing.ts`.

## The wallet (tokens are the unit)

- Users buy **tokens** (₹1 = 100 tokens, `TOKENS_PER_RUPEE` in `src/server/lib/payments.ts`). They
  never see or buy provider tokens.
- A recharge **mints** tokens (`computeCreditedWallet`); a finished build **debits** them
  (`computeDebitedWallet` in `walletDebit.ts`). Same doc (`user_token_wallets`), same rate → one
  honest unit end to end.
- The debit rounds **UP** (`inrToDebitTokens`, ceil) — a fractional token of build cost is charged
  as a whole token so the platform never eats sub-token spend. Credit/display round to nearest
  (`inrToWalletTokens`).
- Overdraft is allowed (a running build always finishes); the debt is recorded honestly and the
  next pre-flight gate blocks until recharge.
- **Zero-charge rules** (a build the user is NOT billed for): empty build (0 files), a preview that
  did not render on verification, and free-onboarding builds. These become **losses** — see below.

## Per-provider metering (Billing Phase 3)

A single build can spend tokens across several providers (GLM builds, Sonnet reviews, etc.). The
`ProviderUsageLedger` attributes each successful turn's real tokens to the provider that answered
(`MultiProviderTurnRunner.onTurnComplete`). It covers the architect, its sub-agents (they share one
client), and the escalation runner. Auxiliary raw calls (blueprint / plan / judge) are reconciled
into an `other` bucket so the per-provider view **always sums to exactly what was billed** — nothing
is dropped, nothing double-counted.

This per-provider split is folded into the daily cost telemetry (`agentv3_cost_telemetry`), which is
the source for both admin reports below.

## Admin endpoints (all require the admin token)

### `GET /api/admin/agentv3/usage-report?days=30`
Per-provider tokens, a **real-cost baseline** (Sonnet-equivalent USD), the revenue billed, and the
**achieved margin**.

- `perProvider[]` — `{ provider, builds, inputTokens, outputTokens, baselineCostUsd }`, sorted by cost.
- `totalBilledUsd` — marked-up revenue across the window.
- `totalBaselineCostUsd` — Sonnet-equivalent cost of all attributed tokens.
- `marginUsd` = billed − baseline; `marginRatio` = billed / baseline.

**Read the baseline honestly:** it prices *every* provider at Sonnet rates. Cheap providers
(GLM / Kimi / Haiku / Gemini) actually cost **less** than Sonnet, so their true cost is below this
line and **real margin is at least what the report shows**. When real GLM/Kimi rate cards land
(a later phase), the exact per-provider rate replaces this baseline.

### `GET /api/admin/agentv3/losses?days=30`
Builds that spent real provider tokens but were zeroed (empty / unrendered preview / free
onboarding) — the cost NavBharatAI absorbed for the "preview is EARNED" quality guarantee.
`{ totalLossBuilds, totalLossRealCostUsd, perDay[] }`.

### `GET /api/admin/agentv3/cost-telemetry?days=30`
The raw daily aggregate docs (task type, start tier, delivered-via provider, escalation cohort,
per-provider usage, losses).

## Per-tier billing switch — `AGENTV3_PER_TIER_BILLING`

**Default OFF.** With the flag off, the whole build is billed at the single power-derived tier
(`billedAmountUsd`) — byte-identical to today. Every normal build runs on Claude today, so this is
correct.

**ON** (`AGENTV3_PER_TIER_BILLING=1`): the build is billed per the reconciled per-provider ledger,
so a mixed build (cheap-floor builds + Sonnet reviews/edits) charges the Sonnet share at ×3 instead
of the whole build at the cheap ×1.2 — closing the mixed-build under-billing.

**When to flip it:** only after the cheap floor (GLM/Kimi) actually carries daily builds. Flipping
it while every build still runs on Claude would re-tier normal builds from ×1.2 to ×3 — a ~2.5×
price jump for users. Watch the usage-report's per-provider split first; flip when GLM/Kimi appear
as real delivery providers. It is a live env change (no redeploy) and instantly reversible.

## Adding a new provider to billing

Metering is automatic: any provider that runs through `MultiProviderTurnRunner` is attributed by its
name via `onTurnComplete` — no billing code change needed. Two optional touch-points:

1. **Tier mapping** — `providerToTier()` in `ProviderUsageLedger.ts` maps a provider label to its
   billing tier. Everything below Sonnet is `cheap` (the default); only the plain `CLAUDE` label
   maps to `sonnet`. A new cheap provider needs no change; a new Sonnet/Opus-class provider would.
2. **Real rate card** (future) — when exact GLM/Kimi/other rates are wired, replace the
   Sonnet-equivalent baseline in `providerBaselineCostUsd` with the per-provider rate so the margin
   report shows true (not upper-bound) cost.

# Requested universal conversational chain: implementation audit

Status: **not universally enabled; not deployment-ready**. This audit and the
chat-local fallback fixes do not establish that the full owner request is done.
Do not switch production to fixed-v1 just to make an ordering test pass.

## Existing exact order

`src/server/AI/fixedTextChain.ts` already defines:

1. Z.AI `glm-4.5-flash`
2. Z.AI `glm-4.7-flash`
3. Groq `openai/gpt-oss-120b`, verified free account only
4. Cloudflare `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, free allowance only
5. OpenRouter reviewed/verified-free allowlist
6. Mitrify (owner position 5.5), existing opaque `MITRIFY_MODEL`
7. CheaperInference Beam
8. DeepInfra `meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo`
9. DeepInfra `deepseek-ai/DeepSeek-V4-Flash-0731`
10. OpenAI `gpt-5-nano`
11. Z.AI `glm-4.7-flashx`
12. Google `gemini-2.5-flash-lite`, paid account

This is an order of eligible candidates, not a claim that every candidate is
configured, reviewed or usable. No different model/provider may silently replace
a missing identifier. The owner's broad “Groq GPT” allows a GPT-OSS family, but
fixed-v1 currently admits only 120B; 20B is allowed by legacy config, not fixed
ranking. Confirm that intended model choice before expanding it.

## Blocking application work (not just environment setup)

- Fixed selection defaults to legacy. Turning it on globally today can *remove*
  working routes, rather than improve availability.
- `professionals/engine.ts` explicitly rejects fixed professional text without
  selected Gateway authority (`fixed-chain-professional-authority-unavailable`).
  Paid professional ingress lacks its existing payer's predispatch funding bridge.
  Do not borrow a different payer's budget or relabel private/health data public.
- `InferenceGateway` has no Mitrify executor adapter/profile; its rank is absent
  intentionally. Legacy FreeChain alone has a reviewed Mitrify adapter.
- Guest authority, non-text chats, structured specialist workflows and the shared
  professional helper have different admission/dispatch boundaries. These are
  not covered by reordering FreeChain. Preserve tool/JSON/vision capability and
  privacy checks when implementing a common conversational policy.
- Existing reviewed Mitrify admission requires exact-payload, one-use server-owned
  approval and supplier-enforced inclusive monetary ceiling. No automatic review,
  approval writer or evidence was fabricated by this change.
- Unknown paid liability and committed output remain terminal. Retaining a hold is
  not evidence of zero billing or permission to repeat a potentially charged call.

## Missing/required configuration (names only, no credentials)

- GLM: `FREE_CHAIN_GLM_API_KEY`, current `FREE_CHAIN_GLM_FREE_VERIFIED_UNTIL`,
  real account RPM/RPD/TPM/TPD (`FREE_CHAIN_GLM_*`); defaults are zero.
- Groq: `FREE_CHAIN_GROQ_API_KEY`, current free-plan review and no-overage evidence.
- Cloudflare: `FREE_CHAIN_CF_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, current free-plan
  review, free-neuron accounting, and account enforcement against paid overage.
- OpenRouter: `OPENROUTER_API_KEY`, `FREE_CHAIN_OPENROUTER_MODELS`, and current
  verified-free registry evidence. A `:free` suffix by itself is not approval.
- Mitrify: existing `MITRIFY_BASE_URL`, `MITRIFY_API_KEY`, `MITRIFY_MODEL`, valid
  `MITRIFY_MAX_INFLIGHT`, `MITRIFY_CHAIN_ENABLED=1`, plus the reviewed approval and
  supplier ceiling described in `docs/mitrify.md`. Do not assume auto-cheap resolves
  to a particular model, price or data processor.
- CheaperInference: `CHEAPERINFERENCE_API_KEY`, verified exact `CHEAPERINFERENCE_MODEL`,
  `CHEAPERINFERENCE=all`, actual written shared-serving permission, current
  `FREE_CHAIN_CHEAPINF_RATE_VERIFIED_UNTIL` and conservative current rates.
  Existing code's $0.006/$0.022 rates are **not a new live attestation**. Search
  results for the official versioned Beam page quoted $0.65/$1.95, while a direct
  fetch returned “Model unavailable”; reconcile alias, availability and current
  account-specific rate before any rollout. No production request was made.
- Paid DeepInfra: `FREE_CHAIN_DEEPINFRA_API_KEY`, both per-rung rate attestations.
- Paid OpenAI/Z.AI/Google: their existing `FREE_CHAIN_OPENAI_*`, `FREE_CHAIN_GLMX_*`,
  `FREE_CHAIN_GEMINIPAID_*` credentials/rate attestations and approved funding.
- All current rollout, provider shutdown, privacy, concurrency, quota and explicit
  monetary policy remain authoritative. No deployed flag or environment was edited.

## Evidence and outage limits

Verified in source and offline regressions:

- A malformed `MITRIFY_MAX_INFLIGHT` threw before the rung's try/catch and could
  terminate the fixed ladder before later suppliers. It now records a safe skip.
- Caller cancellation during a non-cooperative SDK stream could wait until the
  watchdog and then emerge as all-failed, emit an outage notice and penalize the
  provider. Observation now ends promptly, emits no outage notice, suppresses late
  chunks and does not open a provider cooldown. Physical slots/paid holds remain
  conservative until the original physical promise actually settles.
- Each normal rung previously inherited a full independent hard cap, and Mitrify
  could consume all remaining time. Fixed FreeChain now shares a 90-second
  provider-observation deadline and reserves a first-token share for remaining
  positions. Mitrify gets one HTTP attempt (not four hidden attempts counted as
  one) and an idle bound after text begins. Database admission/settlement waits
  are not claimed to have a new absolute wall-clock bound.

These are reproducible code defects, **not proven causes of the owner's recent
production incident**. No serving revision, production logs, account balances or
actual incident request trace was available in this audit. PR #4115 records a
separate paid-admission fix and manual coherent Cloud Run rollout requirement;
merged source is not proof that the deployed service is restored.

## Boundary / validation / release

Only `FreeChain` observation was changed; no AgentV3, Surplus, Router One, z@ pin,
builder or shared router/watchdog implementation was edited. Existing nested
builder exclusion tests must continue to pass. No paid benchmark was run.

Run local targeted tests, all ingress-policy tests, frontend/server/benchmark
checks and the entire CI matrix before considering merge. Report incomplete
coverage/emulator checks as incomplete. CI is not assumed budget-exhausted:
repository runs were active when inspected. Keep this partial hardening change
separate from a claim of universal routing. Any later completed rollout requires
review, manual Cloud Run Console Run and verification of the actual serving
revision. No 100% uptime guarantee is possible.

Public references checked 2026-11-08 (IST):
- https://docs.z.ai/guides/overview/pricing
- https://deepinfra.com/deepseek-ai/DeepSeek-V4-Flash-0731/api
- https://deepinfra.com/meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo/api
- https://www.cheaperinference.com/models/beam-1.0-501b-a23b
- https://mitrify.com/v1/models returned 401; no attempt to extract/use credentials.

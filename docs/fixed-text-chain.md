# Fixed text chain (default off)

`TEXT_CHAIN_POLICY=legacy` (including unset) keeps existing behavior. `fixed-v1`
selects the requested ordering for admitted ordinary text chat and reviewed
professional text gateway profiles. This is **not ready for a universal production
rollout**. Do not enable it until the admission/funding prerequisites below are met.
Rollback is `TEXT_CHAIN_POLICY=legacy`; existing provider rollout controls remain.

Order among eligible candidates: GLM-4.5 Flash, GLM-4.7 Flash, Groq GPT-OSS 120B,
Cloudflare Llama 3.3 70B, reviewed free OpenRouter, the reserved Mitrify position,
CheaperInference Beam, DeepInfra Llama 3.1 8B Turbo, DeepInfra DeepSeek V4 Flash,
GPT-5 Nano, GLM-4.7 FlashX, Gemini 2.5 Flash-Lite paid. A skipped candidate is not a
physical attempt. Success stops the chain. No provider is made available or free
by appearing in this list. Gateway candidates still need current reviewed
account, model, terms, pricing, privacy, quality, quota and payer evidence.

Fixed mode suppresses FreeChain order overrides, sticky spread, route reordering,
response caching and the exclusive admin supplier shortcut. It rejects model
aliases outside the requested list and keeps all admission, cooldown, concurrency,
per-user, daily/monthly spend and deadline checks. Default physical attempt cap
is 12; a smaller explicit FreeChain cap remains effective. Uncertain paid charges,
safety/policy errors, cancellation and committed output cannot open fallback.
CheaperInference additionally needs an unexpired
`FREE_CHAIN_CHEAPINF_RATE_VERIFIED_UNTIL` attestation and the existing conservative
reservation-rate checks. No credential, allowance or price is configured here.

## Boundaries and missing prerequisites

- Current chat/professional payloads remain health/clinical. Nothing is downgraded
  to public based on keywords, empty history or gateway ownership.
- The legacy FreeChain Mitrify slot now has conditional dispatch. Enabling
  `MITRIFY_CHAIN_ENABLED=1` alone does not authorize a request. It requires a
  one-use server-owned `mitrify_chain_approvals` record bound to the exact payload,
  authenticated UID, endpoint, configured alias and credential. A trusted operator
  must have reviewed the entire payload and its permitted data classes, processor
  suitability, disclosure authority and protections (see docs/mitrify.md), and independently verified an
  enforceable per-HTTP-request supplier ceiling including internal failovers,
  retries and fees. No public approval writer or automatic approval exists.
  Records expire within one hour; each HTTP retry revalidates the immutable
  approval and current shared controls. Old v1 approvals remain public-only; v2
  approvals can cover private/health data without a blanket classification ban.
  The existing shared daily/monthly FreeChain pool reserves the ceiling times the
  remaining transport-attempt allowance (at most four). Used reservations remain
  conservative liabilities until authoritative reconciliation; they are not
  represented as actual invoices or refunded on ambiguous failures. Only a
  provably undispatched hold is released. Duplicate claims cannot dispatch.
  Selected InferenceGateway and paid-professional funding bridges are still
  unavailable; this adapter does not enroll or fund those routes.
  Standalone Mitrify bot/diagnostic interfaces have been removed.
  Model policy continues to come from `MITRIFY_MODEL` in the Mitrify module.
- Existing authenticated FreeChain enrollment and selected guest Gateway
  admission remain required. A fixed-mode request without them is terminal,
  rather than silently using an unrelated legacy chain.
- Reviewed free professional Gateway routes use fixed ordering while preserving
  health/clinical and platform budget policy. Ordinary paid professional routes
  lack a predispatch funding bridge for their existing professional payer;
  fixed mode fails closed. It never borrows the platform free-fallback budget.
- Structured professional exam generation, SDA's structured patient workflows,
  images/tools/JSON and the existing Pro/App Builder engines remain excluded.
  The shared developer/API professional helper is not globally rerouted.
- Reordering an approved Gateway catalog does not enroll additional models.
  Rejected models retain policy reasons. No production catalog was edited.

Consequently this change does not establish “100% all chats use the same chain.”
A rollout needs reviewed ingress coverage, paid-professional funding integration,
and real reviewed Mitrify data-processing/merchant-ceiling evidence. No live model calls, public load test,
production environment changes or deployment verification are included.

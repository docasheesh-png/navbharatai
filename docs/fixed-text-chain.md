# Fixed text chain (default off)

`TEXT_CHAIN_POLICY=legacy` (including unset) keeps existing behavior. `fixed-v1`
selects the requested ordering for admitted ordinary text chat and reviewed
professional text gateway profiles. This is **not ready for a universal production
rollout**. Do not enable it until the admission/funding prerequisites below are met.
Rollback is `TEXT_CHAIN_POLICY=legacy`; existing provider rollout controls remain.

Order among eligible candidates: GLM-4.5 Flash, GLM-4.7 Flash, Groq GPT-OSS 120B,
Cloudflare Llama 3.3 70B, reviewed free OpenRouter, the reviewed Mitrify position,
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
  This legacy adapter does not enroll or fund selected Gateway routes. The
  separate Gateway transport described below uses its existing durable claim and
  shared daily funding authority. Paid Professional funding remains unavailable.
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

## Reviewed Gateway Mitrify transport

The Gateway can now dispatch an independently reviewed `MITRIFY` text profile
through `gateway-mitrify-text-v1` at rank 5 (between OpenRouter and Beam). This does
not create a catalog entry, account review, credential, budget or rollout flag.
`MITRIFY_CHAIN_ENABLED=1` and the existing Gateway rollout are both required.
The model and endpoint must match `MITRIFY_MODEL` and `MITRIFY_BASE_URL`; credentials
come only from `MITRIFY_API_KEY`. No upstream model list, provider selection or
upstream price interpretation is added.

The operator-owned catalog transport has `provider: MITRIFY`, the configured
`baseURL` and `model`, `credentialEnv: MITRIFY_API_KEY`, its reviewed credential
binding, `maxOutputTokens`, `timeoutMs` and a `rateCard`. The rate card must contain
an unexpired (at most 24-hour) review with `version`, `verifiedAtMs`, `expiresAtMs`,
`perHttpRequestCeilingNanoUsd`, `hardCeilingEnforced: true`,
`includesInternalRetriesFailoversAndFees: true`, `evidenceRef`,
`gatewayAndAllDownstreamProcessorsReviewed: true`, `processorPolicyReviewRef` and
`disclosureAuthorityRef`. These must refer to real independently reviewed evidence,
not values synthesized from this document. Existing account, quota, quality,
privacy and payer reviews still apply. A public-only profile cannot serve health
or private requests. The administrative setup form does not yet publish this
transport; this change provides no alternate unreviewed catalog writer.

One durable claim permits one HTTP request. Inner retries are disabled because a
received error does not prove all upstream attempts were free. The full reviewed
all-in supplier ceiling is reserved in the existing Gateway daily pool; reported
tokens remain telemetry and never refund that hold or become an actual invoice.
An unknown final charge remains held for authoritative reconciliation. Streamed
text is forwarded in order, requires usage reporting and is never replayed after
output. Missing terminal proof or a length-limited reply is not a complete answer.

This does not implement the paid Professional wallet/funding bridge, additional
paid-provider Gateway transports, or Gateway monthly-cap accounting. Those must
be completed and reviewed before claiming universal activation or changing
production policy. No production configuration or live inference is changed.

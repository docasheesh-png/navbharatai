# Universal NavBharatAI text routing — rollout readiness

Routing/adapters are implemented, but **universal activation is not engineering-complete**: metered Gateway wallet reconciliation and existing uncapped-budget semantics remain code gaps, not operator-only inputs. This work has not enabled or deployed production.
Do not enable `TEXT_CHAIN_POLICY=fixed-v1` before reviewing the catalog and funding below.
This is eligibility-ordered fallback, not permission to bypass privacy, money, safety,
quota, or cancellation gates. Ineligible/missing rungs are skipped, never substituted.

## Exact requested order

| Owner position | Exact text transport/model |
|---|---|
| 1 | Z.AI `glm-4.5-flash` — verified free |
| 2 | Z.AI `glm-4.7-flash` — verified free |
| 3 | Groq `openai/gpt-oss-120b` — verified free account/no overage |
| 4 | Cloudflare `@cf/meta/llama-3.3-70b-instruct-fp8-fast` — verified free/no overage |
| 5 | OpenRouter reviewed, verified-free model allowlist; suffix alone is insufficient |
| 5.5 | Mitrify, the exact existing `MITRIFY_MODEL` alias bound to its reviewed gateway |
| 6 | CheaperInference Beam: reviewed `beam` or `beam-1.0-501b-a23b`, no alias rewriting |
| 7 | DeepInfra `meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo` |
| 8 | DeepInfra `deepseek-ai/DeepSeek-V4-Flash-0731` |
| 9 | OpenAI `gpt-5-nano` |
| 10 | Z.AI `glm-4.7-flashx` |
| 11 | Google `gemini-2.5-flash-lite` — metered |

The broad Groq/Cloudflare requests retain the repository's existing exact choices;
no unverified smaller/newer model is substituted. GPT-5 nano's official page now
marks it **deprecated**, but still documents this exact ID and Chat Completions/
streaming. The adapter requests `gpt-5-nano` and also recognizes only its officially
documented default response snapshot `gpt-5-nano-2025-08-07`; this is the same
identity, not a provider/model substitution. Arbitrary dated aliases and newer
nano models remain rejected. Do not silently upgrade it to another model.
Official Groq and Cloudflare pages also publish paid rates: these models are not
intrinsically free. Their rungs require reviewed actual account free allowances and
no-overage hard stops; a model name alone never authorizes free eligibility.
Google's current official lifecycle page says `gemini-2.5-flash-lite` is not deprecated
and has no announced shutdown date, but access to 2.5 models is restricted to prior
active users. Confirm account access; do not substitute a newer Gemini model.

## Entry points and exclusions

With fixed-v1, old cohort/admin/role/surface rollouts cannot choose a different text
ladder. The Gateway master switch, strict-free safety restrictions, verified identity,
reviewed capability/quality/privacy, account ownership, budget and quotas remain gates.
Turning off the master after selection fails closed, not through legacy routing.

- `/api/chat/navbharat` and `/api/chat/navbharatai`: signed-in and durable signed-out
  guests, streamed and buffered; ordinary API-version aliases retain the same handlers.
- `/api/professional/:id/chat`: every registry specialist, free/paid/pass/exempt/admin
  entitlements. The entry point enrolls before attachment/memory work; the engine retains
  the verified principal, clinical/health classification and supplier funding boundary.
- `/api/sda-chat`: Doctor primary text and independent audit use the same ordered policy.
  Audit excludes the primary canonical model. Reports use separately reviewed vision
  extraction, not a text-only pretend reading. Failed audit is explicitly disclosed.
- `/api/repo-analyst/chat` and its improver: authenticated users and genuine durable
  guests. Guest receipts are surface-scoped, one-use, expire, and do not confer account
  memory access, another specialist's access, or paid-professional payer authority.
- `/api/chat/completions` including `navbharatai/<expert>` and
  `/api/professionals/:id/chat`: developer API keys retain their scopes, per-key spend
  gate and after-answer charging. Fixed ingress independently reauthenticates the exact
  key/owner/scopes and uses the separately reviewed paid conversational supplier pool.
  A body UID or Firebase-only identity cannot enroll this boundary.

**Pro app builder is not enrolled**: AgentV3, Surplus, Router One, z@ pin routing,
provider watchdogs and builder implementation are unchanged. Retired `/api/pro-chat`
is still retired. `/api/app-ai/preview-ask` is intentionally builder-owned: its
handler in `routes/appAiOwner.ts` verifies workspace ownership, imports AgentV3
`WorkspaceFileStore`, and invokes the generated-app `answerForApp` contract with
its separate app-owner settings/preview allowance. It is not a missed product-chat
entry point. Exam/tool JSON, embeddings, search, vision, image generation and
speech are distinct capability operations, not aliases for the requested text models.
Their auxiliary policies remain separate; conversational final text uses the chain.
Customer-built published-app assistants/BYOK remain under their independent app-owner
contracts, not silently converted to NavBharatAI-owned product chat. Nova Sonic is a
separate live speech-to-speech service; these text models do not implement its audio
protocol. This change does not claim to reroute live voice or customer BYOK traffic.

## Funding bridge (no new money authorization)

Provider liability is not the user's wallet debit. Existing entitlement gates and
`chargeForAiTurn(s)` calls/billable fractions remain; no extra wallet debit is added.
The existing billing-proof rule still refuses to invent invoice spend from an estimate:
Gateway paid usage without actual billing proof remains unmeasured to the legacy wallet.
Reservations and conservative ceiling bookings are not reported as supplier invoices.

- Free product supplier money: existing `free_chat_chain/paid_budget_policy` and
  `paid_day_<IST-day>` / `paid_user_<IST-day>_<uid-hash>` documents.
- Paid professional/Doctor/developer conversational supplier money:
  **`professional_inference/paid_budget_policy`** and the same day/user schemas in
  **that collection**, never the free-chat money collection. Missing/zero authority
  cannot borrow the free pool, infer allowance from a user wallet, or create a budget.
- `free_chat_chain/gateway_catalog.professionalScope = { id, ownerId }` is required
  for the paid boundary; `id` must differ from `platformScope.id`. The supplier owner
  must match reviewed credential ownership. Catalog refresh preserves this scope.
- Existing provider account quotas/model occupancy are still shared, not multiplied
  by the funding split. Unknown paid liabilities retain their original holds.
- No default budget, migration, deployed flag, secret or production record was written.

The pre-existing Gateway USD10 planner bound was stale against the owner's existing
FreeChain USD17 ceiling; the planner now reuses that existing ceiling and still
requires the actual approved budget (no new allowance). The free per-user guard is
pre-existing. Those free-pool restrictions are not
borrowed for paid professionals: that pool follows its explicitly approved finite
`capNanoUsd` and request limit, with no invented dollar or per-user-attempt default.
The Gateway still interprets the FreeChain policy as finite even when its existing
`budgetMode=uncapped` is set. Preserving that established mode is an engineering
requirement before fixed-v1 activation; changing production flags is not a fix.
A timeout/ambiguous paid failure is **not proof of zero cost**: it remains pending
reconciliation and may terminate the request. Only supported authenticated rejection
proof permits a paid retry. Do not loosen that fence merely to demonstrate all rungs.

## Smallest operator/owner inputs before rollout

First inspect the already-deployed records through an authorized service connection;
production configuration was not accessible here. Do not assume every field is absent.
Secrets belong in the existing server secret configuration, never chat or this document.

1. Confirm the existing server credential bindings for the exact suppliers. The Gateway
   accepts `INFERENCE_GATEWAY_*` credential names or the existing provider-specific
   names: `FREE_CHAIN_GLM_API_KEY`, `FREE_CHAIN_GLMX_API_KEY`,
   `FREE_CHAIN_GROQ_API_KEY`, `FREE_CHAIN_CF_API_TOKEN`, `OPENROUTER_API_KEY`,
   `MITRIFY_API_KEY`, `CHEAPERINFERENCE_API_KEY`, `FREE_CHAIN_DEEPINFRA_API_KEY`,
   `FREE_CHAIN_OPENAI_API_KEY`, `FREE_CHAIN_GEMINIPAID_API_KEY`. No duplicate key is
   required just because the transport now goes through the Gateway.
2. Supply/renew **actual reviewed** catalog profiles and surface policies for the paths
   above: exact endpoint/model/capabilities, quality/privacy/terms references, current
   credential-account ownership fence and canonical quota/slot rules. Required policy
   keys include `chat:text`, `professional:<id>`, `doctor:text`, `doctor:audit`,
   `mode:repo-analyst:chat|generate`, `developer-api:text`, and
   `developer-api:professional:<id>`, plus actually-used auxiliary keys. Do not invent
   RPM/TPM, free-plan status, health-data consent or capacity from model names.
3. For the paid supplier pool only, confirm the approved finite positive daily `capNanoUsd` (no invented USD10/17 cap), distinct professional scope ID/supplier owner, and per-request limit within
   that authority. `paid_budget_policy` uses the existing schema: kind
   `paid_budget_policy`, version 1, positive revision, integer `capNanoUsd`, timestamp
   `updatedAt`, source `admin`. No initial day balance needs to be fabricated. Confirm
   the intended paid-product billing/reconciliation policy before commercial rollout;
   a conservative provider reservation must never be sold as measured invoice spend.
4. Mitrify-specific evidence and Beam-specific catalog/permission below. No blanket
   owner checkbox can replace their required supplier/data-processing evidence.
5. Only after review, deliberately configure `TEXT_CHAIN_POLICY=fixed-v1` and
   `INFERENCE_GATEWAY_ENABLED=on`. Existing strict-free/emergency restrictions can
   still exclude metered rungs; do not disable them without the appropriate review.
   Deploy the reviewed revision via the established manual Cloud Run Console Run
   process, and verify the actual serving revision and canary results before wider use.

## Mitrify: what 401 does and does not prove

Repository configuration already exists (`lib/mitrify.ts`, `docs/mitrify.md`, smoke
script): defaults are `https://mitrify.com/v1`, `mitrify/auto-cheap`, server-only
`MITRIFY_API_KEY`, `MITRIFY_MAX_INFLIGHT` default 200, opt-in `MITRIFY_CHAIN_ENABLED=1`.
No replacement endpoint, account, credential or model was invented.

An **unauthenticated public** GET of `https://mitrify.com/v1/models` returned 401.
No configured production key was sent, so this is not evidence that its key is bad,
expired or missing. The public root rendered “Fast Service, Instant Connect”, not an
AI model catalog; it does not verify that the default opaque AI alias currently exists.
The smallest remaining supplier input is an authorized read-only catalog/contract
confirming the actual intended base URL and exact model alias (or confirmation that
these existing values are correct), not a guess at a different URL.

The dedicated Gateway adapter now reuses the existing exact-payload approval protocol.
Before admission it skips an unapproved payload without reserving supplier money.
At dispatch it transactionally claims/revalidates the approval and performs **one**
HTTP request using the Gateway's existing atomic hold, not a second legacy reservation.

`mitrify_chain_approvals/<binding-hash>` needs the existing independently reviewed v2
record: UID, exact payload digest and gateway `{baseURL, model, credentialBinding}`;
state `approved`, `reviewedAtMs`, `expiresAtMs` <= one hour after review;
`dataReview.entirePayloadReviewed=true`, appropriate `approvedDataClasses` (health
turns require both private and health), `gatewayAndAllDownstreamProcessorsReviewed=true`,
nonempty `reviewRef`, `disclosureAuthorityRef`, `processorTermsRef`, `protectionsRef`;
`supplierContract.currency=USD`, `hardCeilingEnforced=true`,
`includesInternalRetriesFailoversAndFees=true`, independent `evidenceRef`, positive
integer **supplier-enforced** `perHttpRequestCeilingNanoUsd`. Review covers the full
wire prompt/history/system, not a user checkbox. The application creates no approval.

Gateway catalog: adapter `gateway-mitrify-text-v1`, metered, exact existing URL/model;
rate card's `supplierPerHttpRequestCeilingNanoUsd` must cover the actual reviewed
inclusive ceiling. `inputNanoUsdPerMillion=0`, `outputNanoUsdPerMillion=0` are explicit
unused placeholders for this ceiling-based adapter, **not a claim of free tokens**.
No cached token tariff is admitted. A completion can book the reviewed inclusive
ceiling conservatively; no actual supplier charge is fabricated.

## Beam alias/pricing reconciliation

Official documentation confirms the base URL `https://api.cheaperinference.com/v1`,
Bearer authentication, and authenticated GET `/v1/models` as the current exact-ID/
capability/pricing authority. IDs absent from that catalog return 404.

Official indexed versioned Beam pages quote `beam-1.0-501b-a23b`, USD0.65 input /
USD1.95 output per million (maker list USD1/USD3), but the live public page rendered
“Model unavailable”. Neither the legacy `beam` alias nor current account availability
is established by that conflict. Unauthenticated `/v1/models` also returned 401.
**Do not copy the legacy USD0.006/USD0.022 indicative prices into a new review.**

Smallest outstanding input: an authorized catalog row including exact ID/aliases,
Chat Completions/streaming/reasoning capability and current `pricing_version` /
`pricing_checked_at` / applicable maker list and ZDR rates, plus the existing required
written shared-serving permission (`CHEAPERINFERENCE_KEAK_WRITTEN_PERMISSION`) and
`CHEAPERINFERENCE=all`. Do not toggle that permission without the actual agreement.

The adapter now requires reviewed rate-card `supplierListInputNanoUsdPerMillion`,
`supplierListOutputNanoUsdPerMillion` and integer `minimumDiscountBasisPoints`
(0..9999). Reserved rates must cover list * (1 - discount). It sends the documented
`min_discount_percent` and `zdr:true`, so supplier internal fallback cannot raise the
settled rate above that reviewed ceiling or silently drop the retention constraint.
It does not opt into alternate-model routing. No supplier list or ceiling was invented.

## Verified code defects versus the reported production incident

Offline regressions verify/fix malformed optional Mitrify configuration terminating
fallback before later rungs, cancellation becoming an all-failed/outage penalty, late
stream chunks, and early providers exhausting observation time. FreeChain now shares
a shared 240-second server deadline with a 90-second provider hard cap (merged
from main); fixed Gateway first-token slices reserve
20% control-plane headroom across the 12 positions. Mitrify gets one HTTP attempt and
bounded first-token/idle/total observation. Visible output is never replayed through
another provider; a stalled prefix is explicitly incomplete, not clean success.
Physical occupancy and uncertain supplier liabilities are not falsely released.

These are **not verified causes of the recent production outage**. The sanctioned
Cloud Run log connector returned “GCP credentials are not available”; no alternate
credential extraction or signed-in browser workaround was attempted. Production
logs, serving revision, actual credentials, balances and incident traces remain
unverified. Merged PR #4115 is not proof that its fix reached production or restored it.
Hosted CI was active when inspected, not assumed Actions-budget-exhausted.
No paid benchmark, deployment, production environment change, merge, or uptime promise.

Public references checked 2026-11-08 (IST):
- https://docs.z.ai/guides/overview/pricing
- https://deepinfra.com/deepseek-ai/DeepSeek-V4-Flash-0731/api
- https://deepinfra.com/meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo/api
- https://platform.openai.com/docs/models/gpt-5-nano
- https://www.cheaperinference.com/docs
- https://www.cheaperinference.com/models/beam-1.0-501b-a23b
- https://mitrify.com/ and https://mitrify.com/v1/models
- https://console.groq.com/docs/model/openai/gpt-oss-120b
- https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/
- https://ai.google.dev/gemini-api/docs/pricing
- https://ai.google.dev/gemini-api/docs/deprecations

## Policy provenance (review clarification)

Pre-existing in base `dda0eda73`: Gateway catalog/profile quality/privacy/terms,
credential/account/quota reviews, free/no-overage evidence, strict-free safety,
Mitrify v2 exact-payload/data/downstream-processor/supplier-ceiling approval, and
CheaperInference written shared-serving permission. This PR does not invent or
relax those approvals.

Added integration configuration: `gateway_catalog.professionalScope` plus
`professional_inference/paid_budget_policy` binds paid supplier funds without
borrowing free-chat money; no default funds or new fixed USD ceiling are created.
Mitrify's adapter ceiling and Beam's maker-list/discount rate-card fields are
transport reservation bounds sourced from existing supplier contracts/catalogs,
not new consent policies or guessed supplier prices.

Live connector review: both `get_service` and `get_service_log` were attempted
through the READY connector for the named production project/region/service. Both
returned "GCP credentials are not available". READY describes tool availability,
not successful GCP authorization; no service/env values or logs were obtained.


## Bounded reliability-incident follow-up

The owner's roughly 50% success estimate is not measured telemetry and is not
converted into an uptime guarantee. Production cause/restoration remain unknown.
Both sanctioned service and log reads failed for unavailable GCP credentials; no
credential extraction, alternate authentication, paid probes or deployment occurred.

Verified **existing-path availability defect**: FreeChain returned all-failed before
any provider if publication of the shared *paid* budget failed. That unnecessarily
disabled independently reviewed free providers during a paid-policy write failure.
The small incident fix continues only eligible free rungs, skips every paid rung
(including Mitrify in fixed mode), preserves quotas/privacy/safety/master controls,
and retries publication on a later request. Paid work is never authorized by this
failure. All-free failure remains an honest failure. Publication already has a
5-second observation timeout and a one-second retry backoff.

Focused regressions exercise this actual failure, no paid reservation/dispatch,
subsequent policy recovery, fixed-chain paid exclusions, cancellation, silent/late
streams, terminal SSE settlement and shared deadline budgeting. The merged main
deadline changed an older fake-clock assertion from 90s/12 to the shared deadline/12;
the assertion is now tied to the shared constant, not a larger test timeout.

This is a repository-proven failure mode, **not a proven cause of this incident**.
A separate main-based two-file patch is prepared for independent incident review;
it does not require Mitrify configuration, paid-routing activation or billing changes.

Minimum production evidence needed: the actual serving revision and one sanitized
failed-request correlation with HTTP status, route, terminal reason/provider-rung
attempts, first-content/terminal timing and whether the client saw an SSE error,
`[DONE]`, disconnect or timeout (plus a successful comparison if available). Keep
prompts, patient data and credentials out. A safety refusal, auth/quota rejection,
provider transport failure and interrupted partial stream are different outcomes.
Existing safety refusals must not be bypassed to inflate an availability count.

The separate commercial code work is deferred for this urgent availability review:
`chatSpend.ts` still returns `unpriced-gateway` for metered Gateway responses and
`aiTurnCharge.ts` cannot debit that unmeasured spend; idempotent reconciliation has
not been implemented. Conservative supplier ceilings are not exact tariffs. Gateway
uncapped-policy compatibility also remains unimplemented. Neither gap is cured by
operator credentials, approvals, money amounts or enabling fixed-v1. Do not advertise
the full owner request as complete or activate universal commercial routing yet.

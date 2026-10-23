# Text gateway runtime: reviewed setup and release boundary

## What is implemented, and what is not

Scope: NavBharatAI Free and its Free modes only. Pro App Builder (existing Normal/Strong behavior, with the retired Weak option removed), paid Doctor AI/SDA, paid professional, tenant developer and published-app products retain their prior routing. Doctor/SDA are always excluded, even if rollout flags name them.

The default-off `InferenceGateway/runtime.ts` now composes authenticated Firebase ingress,
current server-owned configuration, the capability policy, durable Firestore holds/claims,
a one-use physical dispatch fence, real official-endpoint HTTP text transport and measured
usage settlement. The existing caller hooks import it. This is a real text and reviewed auxiliary-operation vertical path,
not an authorization inferred from an account's name or a mock transport.

Offline tests simulate Firebase, transactions and provider responses. They do **not** prove
real provider eligibility, model quality, Firestore contention, invoice completeness or live
capacity. No production configuration, credentials, account migration or rollout was changed.

Funded professionals, funded builders, tenant developer/published-app calls and BYOK are outside
the selectable Free-product surfaces. An attempted unsupported nested funding scope is rejected. Existing after-answer wallet debits and cap reads do not
constitute atomic provider-cost reservations. They must not borrow the platform fallback pool.
Text never substitutes for tools, images, vectors or search. Selected embedding, grounding search and image/PDF understanding use dedicated capability adapters through the same issuer, executor and money/quota ledger. Tools/schemas and voice are not implemented by this gateway and remain unavailable when selected. Image generation/enhancement and excluded paid products retain their separate existing pipelines.

The production composition permits at most **four physical attempts per logical request**.
Planning skips known exhausted or ineligible free capacity. After an actual HTTP 429 rejection,
a transport-private proof may authorize another eligible account only before any visible output,
with no safety/refusal signal, and after fresh authoritative planning. Every earlier quota/money
hold stays committed pending separate reconciliation; generation rejection is not zero billing.
The durable rejection record and per-account cooldown prevent replay or immediate same-account
retry. Authenticated Retry-After seconds or HTTP dates extend that cooldown above the 60-second default. A valid delay beyond the seven-day proof bound is terminal and durably blocks that account until reviewed recovery, rather than shortened into an early retry. Daily/account exhaustion is not a rate-limit retry proof. Each next attempt must reserve its own maximum within aggregate logical and shared daily
limits. Definite pre-dispatch reservation denial also permits bounded fresh replanning.
Network errors, timeouts, ambiguous outcomes, authentication/invalid requests and safety refusals
do not hop providers. No provider switch is permitted after visible text. This is a conservative
rejection fallback chain, not general retry-on-any-error or a guarantee of available free capacity.

## Deployment switches

- `INFERENCE_GATEWAY_ENABLED`: absent/OFF preserves existing paths. ON permits the audience gate below; it does not itself select all users.
- `INFERENCE_GATEWAY_ROLLOUT_MODE`: `canary` by default; only explicit `all` selects the full eligible Free audience. Unknown values fail closed to no newly selected audience, never to all.
- `INFERENCE_GATEWAY_CANARY_UIDS`: comma-separated exact Firebase UIDs, at most 32 unique entries, each 1–128 ASCII letters, digits, colon, underscore or hyphen. Whitespace around entries is trimmed; empty entries, duplicates, invalid characters, overlong entries/lists reject the entire configuration. Empty/unset selects nobody in canary mode. Only server-verified Firebase identity qualifies; body/header UID, guest locator and copied Gateway context do not. No raw UID list is logged or returned by setup status.
  The cohort is pinned before authentication awaits and checked again on selected admission, nested operations and immediately before physical dispatch. Removal, invalid configuration or OFF after selection is terminal, never an escape into legacy inference. Explicit `all` preserves the durable public guest flow; canary mode does not mint Gateway guest receipts.
  Non-canary users retain their existing routing, quota and funding behavior and receive no Gateway context. **Their legacy traffic is outside this trial's shared $10 cap.** The older Free Chat Chain percentage/UID controls do not govern this Gateway. Setup displays only the mode and configured canary count; master ON plus zero configured canaries does not mean an active trial.
  An owner trial requires a real reviewed provider/account/privacy/quality/price setup first. Setting an allowlist and ON is not provider eligibility or authorization to configure credentials. Start with master OFF, obtain the owner's actual Firebase UID through an authorized account view, review one eligible provider, then separately authorize an owner-only test. No credential configuration, provider call or production flag change is performed by this code.
- `INFERENCE_GATEWAY_SURFACES`: optional comma-separated surfaces. Absent/empty with master ON
  selects only `chat`, `professional`; explicit lists intersect this fixed allowlist.
  Builder, Doctor/SDA, developer/published-app and image surfaces are always excluded, even when explicitly listed.
  These surfaces are entered only from the Free product: owning a paid plan does not select a paid
  product or authorize diverting its wallet. Unsupported selected funding/capabilities fail, not escape
  to legacy. Start with explicitly reviewed surfaces only.
- Dedicated credential variables referenced by reviewed transport records must have the prefix
  `INFERENCE_GATEWAY_`. They are resolved only immediately before a single physical request.
  All direct and OpenRouter transport records require `credentialBinding`, the domain-separated SHA256
  generation binding produced by `gatewayTextCredentialBinding` for the reviewed credential. The
  issuer and final physical boundary compare it without persisting/logging the secret. Rotation
  requires a new reviewed catalog generation. A key fingerprint is **not** an account/quota identity,
  nor is a different credential proof of an independent provider account or allowance.

Embedding uses existing server ADC, not a newly configured API secret. Review setup pairs existing `GOOGLE_CLOUD_PROJECT` with the non-secret `INFERENCE_GATEWAY_VERTEX_PRINCIPAL` service-account identifier. The transport independently verifies the actual ADC project and service-account principal, and the canonical project quota scope must match. A project/principal association hash is neither a credential nor an extra allowance.

Account identity comes only from real `verifyFirebaseToken(req)` ingress. The existing unsigned Free-chat guest route instead requires a private, one-use request receipt issued after its durable device/IP daily-quota transaction. Its random day-scoped server principal is not a Firebase UID or permission to read account data. The receipt expires within two minutes or IST midnight, is revoked on response closure, and is confined to chat/platform funding/self-tenant and known auxiliary child policies. Storage failure, forged/copied/reused receipts, and absent admission fail closed; a flag change after selected guest admission cannot reopen legacy routing. OFF guest behavior retains the existing limit. Context strings describe requirements, never approvals, and client body UIDs never supply authority. Nested calls retain principal, tenant, funding,
privacy/quality floors, earliest deadline, cancellation and strict-free requirements.

## Required server-owned records

The Firestore rules' default deny protects the `free_chat_chain` collection from clients.
Administrators must independently verify current service terms, actual account entitlement,
privacy settings, exact model/capability behavior and versioned quality evaluations before
provisioning the following records through the bounded admin preview/apply workflow. The writer
validates reviewed bundles and derives credential-generation bindings server-side; it does not
perform the human review, infer free entitlement, configure secrets or create paid authority.

1. `free_chat_chain/gateway_catalog`, shaped by `GatewayCatalog` in `authorityStore.ts`.
   It requires a version, explicit enabled state, revision, current issuance/expiry (at most
   24 hours), platform owner/scope, surface policies, and at most 32 reviewed profiles.
   A policy binds exact surface, funding, quality gate/version, privacy policy, terms policy,
   complete input/output bounds, first-output/attempt/queue deadlines and logical spend limit.
   Request privacy and quality tiers must exactly match the caller's conservative requirements.
   Unknown clinical/privacy classification is not permission to downgrade it. Current policy keys:
   - `chat:text`: chat, health data, clinical quality.
   - `professional:<server professional id>`: exact server persona, conservatively health/clinical
     unless that persona's server policy establishes stronger or different requirements.
   - `mode:repo-analyst:chat` and `mode:repo-analyst:generate`: professional surface,
     confidential data, professional quality. Other-AI debugger/app-debug are not Free modes.
   - Auxiliary keys are derived only by server helpers from those exact parents: `:embedding`, `:grounding`, `:vision-image`, `:vision-pdf`. Each needs a separately reviewed `operation` policy retaining parent identity, tenant, privacy, quality, funding, deadline and the opaque early-admission lease. Image/PDF suffix is derived from attachment media, never a client policy override; separate input ceilings allow reviewed image and PDF profiles to coexist. Missing operation policy fails closed, never falls back to a legacy network call.
   A policy key is not an approval; each still needs independent evaluated gates.

2. Each profile includes the exact production inference API model/revision, account payer,
   surface/quality/terms approvals, capabilities, privacy settings and all overlapping quota
   dimensions. Review references for account, terms, quality, privacy, capability and pricing
   are mandatory, current, and bound to the complete catalog revision. Free profiles need
   verified no-overage production entitlement; an environment toggle alone cannot provide it.
   Hosted evaluation/coding-subscription entitlements are not production API capacity.
   OpenRouter transport reuses the actual live registry dispatcher for an exact reviewed model,
   endpoint and registry version. The catalog is manually reviewed, not automatic enrollment of
   every discovered free model: live registry freshness/eligibility is an additional gate, never a
   substitute for quality/privacy/account approval. Its dedicated credential must match the registry
   credential and the current private manifest credential-generation binding. Old manifests and key
   rotations block dispatch until an authorized refresh. Shared Pro consumers may not be broken or
   migrated by this Free-only rollout. The reviewed zero-price/hard-stop rule permits unknown
   upstream remaining without asserting that the account is exclusive. No second OpenRouter discovery client or independent quota pool is created.

3. `gatewayAccountFencePath(legacyProvider, accountScopeIds)` is a version-2 reviewed
   **account association**, not a provider-wide lock. It requires canonical non-model account
   scope IDs, reviewed credential-generation associations, account review reference and current
   expiry. `migrationId` is retained as the policy-generation field name; exclusive migration is
   not required. Shared legacy Builder/image consumers stay untouched, and a new account is not
   a prerequisite. Different keys never create extra quota or establish different accounts.
   Aliases using the same reviewed account must use the same canonical account dimensions.

4. Every local quota dimension has `gateway_quota_policy`, `gateway_quota_state` and
   `gateway_quota_period` records at `gatewayLedgerPath(...)`. Runtime policies explicitly say
   `authority: gateway-local-capacity` and `accountingBasis: gateway-local-only`. Their limits
   bound this gateway's pressure; upstream remaining allowance remains explicitly unknown.
   Existing local consumption and all pending holds must be preserved, including across model
   aliases and period changes. Missing local state is unavailable, not an assumed upstream reset.
   Every policy also binds an exact current `gatewayQuotaRulePath` document and its account review.
   `quotaRollover.ts` atomically rolls reviewed fixed-interval or civil-day LOCAL windows, preserving
   global pending holds and original consumption periods. `maintainGatewayQuotaWindows` is shared
   by request preflight and the exclusive startup/30-second scheduler; its five-second coalescing
   caches maintenance observations only, never dispatch rights. Unknown/rolling-import rules are
   not accepted by the runtime issuer. Supported meters are requests, total tokens, input tokens
   and output tokens per minute/day; unknown meters are denied.

   Unknown upstream quota is safe only for current independently reviewed `freeBillingSafety`
   proving the exact endpoint is `intrinsic-zero` or the account has a `provider-hard-stop` before
   paid charges. Ordinary free-tier labels, health checks and successful calls are not this proof.
   Automatic-overage free tiers (including a paid-plan endpoint with unknown shared consumption)
   are skipped; local counters cannot prevent upstream auto-billing. Current proof reference and
   issuance/expiry are bound to the exact catalog entry/account/model. Actual HTTP 429 remains
   possible and is handled conservatively. No complete upstream quota accounting is claimed.

5. Paid fallback uses only the **existing** `free_chat_chain/paid_budget_policy` and canonical
   `paid_day_<IST date>` plus existing UID-wide paid-request counter. The combined committed
   platform fallback limit is at most USD 10 per IST day, across all providers and users.
   No policy means no paid permission. No second allowance or automatic top-up is created.
   Paid text is restricted to direct `DEEPSEEK` / `deepseek-flash`; reviewed auxiliary charges listed below use the same pool, not separate allowances. Its reviewed
   peak reservation rates must be at least the centralized verified rate and must remain below
   the unchanged weighted Kimi chat ceiling. Paid peak tariffs are conservative admission bounds, not proof of exact billed charges.
   A complete authenticated DeepSeek Flash response can now replace the full reservation with a
   separately labeled `conservative-ceiling` liability: all prompt tokens use the uncached maximum,
   all completion tokens (including reasoning) use the output maximum. Exact model, total/cache
   consistency, documented charge classes and still-current claim/rate/catalog binding are required.
   It is **not actual invoice spend** and no wallet/user price changes. Missing, interrupted,
   inconsistent or unreviewed usage retains the full maximum, so unresolved calls can still exhaust
   the USD 10 allowance quickly. Explicit reported charges above the proven ceiling or malformed
   charges retain the full hold and quarantine the account. The ledger can atomically replace a
   ceiling with independently authenticated actual evidence, idempotently, on the original day;
   no production invoice reader or automatic actual-charge import is supplied. Days with unresolved
   conservative bookings do not expire by TTL. Free zero-cost settlement still
   requires current verified no-overage entitlement and authenticated complete usage. Explicit
   nonzero/malformed reported free cost is contradictory: no zero-cost proof is issued, holds stay
   retained, and no fallback is allowed. Transport-bound incidents durably quarantine the claimed
   profile and its shared quota state before cleanup; cancellation preserves the anomaly proof.
   Every authenticated billing contradiction also atomically zeros shared paid authority: a purported-free call has no monetary hold and makes total liability unknown. Fresh processes cannot reuse that allowance until separately reviewed recovery. No billed amount
   is guessed from the anomaly. Already-visible text cannot be retracted.

The issuer writes request-bound evidence and authority only from these records. Admission and
claim re-read the exact catalog/account-review bindings inside the transaction. Before network,
a separate durable one-use CAS rechecks cancellation, evidence expiry, profile quarantine,
quota authority and the paid-budget revision/holds. A claimed-but-unobserved outcome retains
holds; elapsed time, a transport timeout or process restart never constitutes a refund.

## Operational/release gates still outstanding

- Independent current account/terms/privacy/quality/rate evidence and intrinsic-zero/provider-hard-stop protection for shared unknown upstream quota.
- Production enrollment of reviewed local quota windows and any independently verified recovery evidence; the implemented local rollover never imports guessed upstream remaining quota. Generic cleanup must not TTL-delete authority,
  pending holds, receipts or unresolved incidents. Historical per-request authorities currently
  accumulate and require a separately reviewed retention design, not blind age deletion.
- Target Node22 full CI, boot/smoke and exact-head review; local Node24 checks are diagnostics only.
- Real Firestore contention/recovery and controlled provider verification within existing spend
  authority, before enabling even a small rollout. No invoice-level hard-cap guarantee is claimed.
- Current independent evaluations for each enrolled text/embedding/search/vision operation. Voice and structured tool/schema execution are not migrated. Funded-product integration is outside this rollout and is not a remaining requirement to reroute paid products. Do not label the present scope as every conceivable all-mode capability.


## Continuous operation and remaining recovery boundaries

1. **Local quota rollover is implemented.** Reviewed rules bind canonical account dimensions,
   all overlapping local meters, exact policy revisions and review expiry. The transactional writer
   keeps old unresolved holds in global account pressure and preserves old-period consumption.
   Its local reservation-window baseline is not an assertion about provider usage or invoice/reset
   attribution. Runtime admission and final dispatch re-read bound rule/account evidence, including
   for an already-current window. Expired reviews and unknown/rolling-import rules fail closed.

2. **Metadata refresh is approval-constrained.** `catalogRefresh.ts` refreshes existing approved
   entries against the actual registry without enrolling discovered models, changing credential
   generations or extending human reviews. Full catalog revision changes currently invalidate
   in-flight claims conservatively; they never release an old hold. The startup/exclusive scheduler
   reuses this maintenance path. Availability is not price, privacy, quality or account authority.

3. **Bounded admin setup is implemented, recovery is separate.** Preview/apply accepts reviewed
   bundles, preserves existing local consumption/holds, binds real canonical account identities and
   current server credentials, and uses CAS rather than arbitrary document editing. It does not
   rotate credentials, enable rollout, initialize/increase the shared paid budget or invent reviews.
   A production recovery reader for provider request outcome/invoice evidence is still required
   before uncertain or anomalous holds can be released automatically. `reconcileActual` provides
   idempotent replacement bookkeeping only, not an invoice source. Generation rejection, request
   age, key rotation and restart are never refund proofs. Quarantine removal requires independent
   evidence; generic cleanup/TTL deletion must not supply that authority.

Direct text complete-usage semantics are restricted to the documented endpoint:
[DeepSeek chat completion schema](https://api-docs.deepseek.com/api/create-chat-completion/).
Its final stream usage represents the entire request, completion details include reasoning, and
prompt cache hit/miss counters sum to prompt tokens. Unknown billing classes retain full holds.

Keep rollout OFF until actual reviews, setup, controlled datastore/provider checks and target CI
are complete. Source implementation and offline fixtures do not mean production enrollment.

## Reviewed auxiliary operation adapters

All three operations execute through the same authenticated parent context, durable claims, local quota rules, shared IST-day policy, cancellation and conservative usage journal. There is no independent auxiliary money pool and no paid call under strict-free. Admin preview/apply can enroll their typed operation policies but cannot infer reviews, configure credentials or increase the budget.

- **Embedding:** Vertex `text-embedding-004`, 768 dimensions and the existing default-task/trim-v1 vector identity. Actual ADC project/principal and canonical project quota association are checked. Submitted UTF-8 bytes upper-bound billable characters at a reviewed maximum of at least 25 nanoUSD per character. A complete authenticated result records that conservative liability ceiling, not invoice cost; absent/invalid usage keeps the full hold. No Gemini API retired embedding endpoint, vector migration or task-type change is introduced.
- **Grounding:** Brave Web Search, one exact query and a reviewed per-request maximum of at least 5,000,000 nanoUSD. The result retains the existing source formatting and guarded page-reading workflow. No assumed monthly credit, unsupported domain filter, DuckDuckGo paid/free inference or parallel direct search is used in a selected context. A completed request books a distinct conservative request-charge ceiling.
- **Vision:** GLM `glm-4.6v-flash` image understanding only with reviewed intrinsic-zero/hard-stop evidence, or paid Gemini Developer API `gemini-2.5-flash`/`gemini-2.5-pro` image/PDF understanding with existing-account availability reviewed separately. Local images are signature/dimension/byte checked; remote attachment URLs are not accepted by the adapter. Every Gemini image/PDF call reserves the full 1,048,576-token input limit plus the separately bounded output, using the highest applicable reviewed rate band. `pdfPages:1000` is a provider-maximum reservation, never a locally measured page count. Invalid/oversized/provider-rejected files do not become text-only answers. Complete authenticated prompt/candidate/reasoning usage may reduce the hold to a separately labeled conservative ceiling; incomplete usage retains the full maximum. No retired Vertex PDF model is used.

Maximum input and output are separate bounds. A reviewed generation capability's combined `maxContextTokens` must cover their sum; the Gemini PDF input limit is not silently reused as a smaller combined input-plus-output limit. Offline vertical tests cover the actual shared claim, maximum reservation and settlement for these operation types, including a full-input-bound PDF call. They do not prove live account eligibility, model quality or provider invoice completeness.

Provider health is separate from rejection and billing. Private physical-request observations open a credential-generation/account-scoped one-hour auth cooldown or a bounded account transient circuit (30 seconds increasing to five minutes). These records survive process restart and are checked again before physical dispatch. They never refund an uncertain hold or permit another attempt in the same logical request. Coordinator deadlines and first-output timeouts carry a private server-issued reason so real dispatched timeouts can update health without treating user cancellation as provider failure. User cancellation and policy/safety failures do not masquerade as provider-health evidence.

The Free-chat client treats explicit gateway JSON/SSE failures as terminal, preserves partial text with an interruption notice, and does not create a new logical request after an ambiguous network/timeout outcome. Stop aborts both the default JSON request and the streaming request; a late response after Stop is not displayed as success. These client safeguards do not constitute evidence that a provider did not bill.

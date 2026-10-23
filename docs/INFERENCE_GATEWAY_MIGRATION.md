# Capability-aware inference gateway: implementation status

The current requested destination is NavBharatAI Free and its eligible modes, with verified free capacity first and then the cheapest eligible, quality-approved paid capacity. The owner narrowed scope on 2026-10-23: Pro App Builder must retain its prior behavior, including removal of the previously merged but disabled Weak free-routing option. Doctor AI/SDA also retain their original paid routing and clinical audit, including removal of the earlier strict-free Doctor option. Image generation remains unchanged. This document distinguishes the destination from the current implementation.

## Present boundary

`src/server/AI/InferenceGateway/` now has real text caller wiring, a server-only runtime, reviewed-catalog/evidence/usage composition, transport and the shared Firestore transaction adapter. Ordinary Free chat, server-gated Free professional text and Repo Analyst text are connected with authenticated identity and explicit funding boundaries. Paid professional, Doctor/SDA, debug, developer and published-app products are not selected into this Free subsidy pool. The implementation remains default OFF and under integration testing. Focused caller tests with mocked runtime ports do not establish end-to-end provider operation.

Only eligible platform-subsidized Free operations may obtain this execution authority. Paid professional, tenant, funded-builder and BYOK products do not acquire that pool by inheritance and remain on their existing paths. No funded-builder adapter is required by the current Free-only scope; adding one would require a separate design and authorization without changing customer wallet or price semantics.

Current reviewed model/account/privacy/quality evidence and local-capacity policies are required before activation. Intrinsically zero-priced endpoints or reviewed provider-enforced hard-free-stop accounts may have unknown upstream remaining quota; local counters do not claim otherwise. Automatic-overage tiers are unavailable without trustworthy complete usage and cost enforcement. No real provider/account, live Firestore contention or production activation has been verified. Eligible Free non-text capability migrations, legacy cleanup and complete Free-product acceptance are still incomplete. Pro App Builder migration is no longer in scope.

The earlier `FreeChain` integration remains scoped to ordinary free text chat behind default-off flags. Its owner-funded paid fallback pool is at most **USD 10 total per IST day across paid providers**, not USD 10 per provider or key. Reservations retain uncertain charges. This pool is separate from existing funded-builder budgets, wallet prices, sandbox and hosting charges. Ordinary-chat admission defaults to five seconds total waiting, one active and one waiting turn per authenticated user, and bounded per-instance queues. These are not voice-session or build-loop deadlines.

The six former staged-building-block exemptions are removed because these modules now have actual server callers. This is source reachability, not proof of production readiness or completed all-mode migration. Dead-code and stale-exemption guards remain unchanged.

## Caller boundaries and required evidence

| Group | Existing boundaries | Required before switching |
| --- | --- | --- |
| Ordinary chat | `chat.ts`, `UniversalAIRouter`, `AIRouterManager` | Verified caller identity, language/system rules, stream parity, provider cost provenance |
| Free professional helpers | `professionals/engine.ts`, `professionalRouting.ts`, related professional routes | Clinical/privacy and quality gates; verified usage-cost compatibility |
| Doctor/SDA | `routes/sda.ts` direct races and fallback | Excluded; original paid gate, models, independent clinical audit, billing and multimodal behavior preserved |
| Weak/Normal/Strong builders | `agentv3.ts`, `tierLadder`, tool runners, judges and repairs | Excluded from the new router. Restore the former Weak routing option surgically; preserve Normal/Strong, funded behavior and owner Stop-billing fixes |
| Vision/PDF | `visionChain.ts`, `visionDescribe.ts` | Exact input modalities and limits, privacy eligibility, faithful response/usage |
| Voice | `sonic/*`, `platformVoice.ts` | Bidirectional audio/session/cancellation capability; not chat-completion replacement |
| Retrieval/search | embeddings, embedding stores/search, grounding | Exact vector-space identity and dimensions; search/citation capabilities and charges |
| Developer/published-app/BYOK | developer API, own-key helpers and generated adapters | Outside Free-product rollout; preserve existing tenant/payer routing and do not rewrite deployed applications |
| Image exception | generation/edit engines, holds, quotas and prompt enhancement | Preserve existing behavior and dependencies until deliberately decoupled |

Shared router/provider/key helpers remain until their final owned caller has a tested replacement. Deleting them first would break unrelated or explicitly excluded consumers. Current generated application templates and already deployed tenant applications require separate ownership analysis; a platform migration is not permission to rewrite them indiscriminately.

## Transaction adapter boundary

The gateway adapter reuses the existing `free_chat_chain/paid_budget_policy` and `paid_day_<IST date>` records. It does not create a second USD 10 allowance. Its constructor binds a trusted principal, tenant and platform fallback pool; funded-builder and tenant-funded execution remain unsupported. A selected reservation is rechecked transactionally before a one-use dispatch claim. Uncertain or claimed attempts do not expire into a refund. Only server-authenticated final usage can settle a hold; a reported bound violation records the full cost and atomically quarantines the affected resources, with a zero shared paid cap for cost violations.

Quota setup binds reviewed canonical account identities and credential generations. It does not make each key a new account or disable preserved legacy consumers. The gateway tracks local pressure allowances, while shared upstream remaining quota may be unknown. Reviewed fixed/civil local windows roll over atomically without releasing old unresolved holds; unsupported upstream reset/import claims fail closed. Runtime authority, administrative review/setup and scheduled/request-preflight maintenance are implemented; live account validation and recovery still require separate verification. Authority, pending holds, receipts and unresolved incidents are deliberately non-expiring; they must not be included in generic age-based cleanup.

Reservation transactions read only the selected candidate, but the current authority issuer scans the reviewed catalog and its quota evidence before planning. Each quota dimension adds document reads and writes, and transaction contention adds retries. This control-plane read amplification needs measurement and bounded caching or a narrower candidate snapshot before a high-volume rollout. These unit tests do not prove an economical 10,000-user Firestore design. Real account-level contention and recovery testing is a separate release gate.

## Integration requirements beyond pure planning and mocked execution

1. Authenticate and bind request, payload, principal, tenant, surface, quality, privacy, payer, absolute deadline and cancellation on the server. Client strings cannot issue authority.
2. Load current verified profiles and exact-version quota, availability and pricing evidence. A positive quote contradicting a free profile is rejected. Unknown capabilities, terms, prices or quality approvals fail closed.
3. Skip exhausted or unavailable free routes without making doomed calls. Paid selection requires a compatible quality gate and current scoped budget authority. Strict-free never permits paid fallback.
4. Immediately before every physical call, recheck revocation, cancellation, profile revision and expiry; acquire atomic shared quota and maximum-cost holds. A pure selection result is not either hold.
5. Never multiply provider account/organization/project limits by credentials. No multi-account quota evasion. NVIDIA hosted evaluation access is not a production entitlement; coding-subscription quotas are not standard SaaS API authorization.
6. Preserve uncertain holds, reconcile only authoritative complete usage, and include every applicable charge. No automatic top-up or silent budget expansion. Existing funded-builder budgets must not silently share the free-fallback pool.
7. Stop after terminal safety/policy/invalid-request failures, after partial visible output, or after the bounded physical attempt limit. Preserve one logical deadline and cumulative queue waiting across attempts.
8. Preserve separate image and tenant boundaries, required billing behavior, complete stream outcomes, and auditable provenance before removing any legacy path.

## Verification and release gates

Pure simulations and focused tests are useful preflight evidence, not production capacity, paid-invoice or successful-app guarantees. The historic 10,000-request mock tests primarily measured overload handling; busy responses are not AI successes, and the older two-second configuration is not evidence for the new five-second default.

Target verification remains Node 22 and the repository's complete CI sequence, plus exact-head independent review, mocked caller integration, distributed admission/budget tests and capability-specific quality evaluation. Node 24 diagnostic checks must be labeled separately. Real account/provider tests need the remaining approved setup and must stay inside the shared spending allowance. No feature activation, credential provisioning, purchase or merge is implied by writing this contract.

## Operational controls and limits

The existing OpenRouter sync job refreshes only already-reviewed exact model/endpoint entries. It checks the original reviewed credential generation and current manifest chunks/controls, never renews human approvals or enrolls a new model automatically. A changed catalog revision invalidates in-flight old authority conservatively; callers may receive a temporary unavailable result during refresh rather than dispatch with stale evidence.

The existing scheduler runs Free gateway quota maintenance every 30 seconds when enabled. Request preflight uses the same bounded, coalesced maintenance helper, then performs fresh durable admission checks. Expired account/terms/privacy/quality reviews remain unavailable until an administrator reviews them again; a timer is not consent. The admin form exposes review expiry and unknown upstream capacity, uses an audited two-step review/CAS, and does not set deployment flags, create credentials or create a paid budget.

Candidate ranking remains quota-aware. Explicit reviewed priority breaks otherwise equivalent preferences; it is not permission to use an exhausted or unsuitable primary. Only the currently implemented and approved paid candidates can be compared; a DeepSeek-only configuration is not evidence that DeepSeek is globally cheapest.

Selected Free callers now route text, GLM image understanding, reviewed Gemini Developer API PDFs, Brave grounding, and exact Vertex text-embedding-004 retrieval through the shared gateway. These capability integrations still require final exact-head CI and independent validation; mocked provider success does not establish real account eligibility. The prior paid voice product is not silently converted into a Free subsidy. No live provider access, production quota, invoice or 10,000-successful-answer capacity has been verified by mocked tests.

### Capability accounting and preservation

- Brave Search reserves one reviewed request charge per physical request. Monthly account credits are not assumed. Legacy DuckDuckGo HTML scraping and unverified commercial free data feeds are not fallback routes for a selected request. Page enrichment retains SSRF validation and inherits the selected request cancellation and deadline.
- Vertex embeddings preserve `text-embedding-004`, default task behavior, trimming, 768 dimensions and the existing vector-space identity. The submitted UTF-8 byte count is a conservative upper bound for character-based liability, not token-based pricing or invoice spend. A replacement model is not silently inserted into the existing index.
- GLM image requests and Gemini PDF requests have distinct media-specific policy keys. PDF money safety reserves the reviewed full-context maximum plus bounded output. File magic/byte validation is not a local page-count parser; the UI must not claim it measured PDF pages.
- Missing, partial, contradictory or interrupted usage retains the unresolved hold. Complete supported usage may book an authenticated conservative liability ceiling; invoice-confirmed reconciliation remains a separate idempotent operation.
- Doctor/SDA, all Pro App Builder tiers, paid professional products and image generation/edit remain outside this new Free-product pool. Authenticated Firebase sessions retain their account identity. Signed-out visitors instead receive a server-only, request-bound guest admission after the durable existing device/IP daily quota succeeds. The untrusted `x-nb-guest` header is only a quota locator. The short-lived guest principal grants no account/profile/memory access, preserves bounded client-provided conversation history, and cannot fall through to uncapped legacy routing after selection. Final actual-route regression remains a release gate; flag-off behavior remains unchanged.

The current typed media setup supports GLM image understanding and Gemini PDF-containing requests through separate policies. Reviewed Gemini profiles can also serve image-only paid fallback: they share the bounded image request policy but independently reserve the full 1,048,576-token input maximum for both money and quota. An eligible account, current model review and sufficient shared budget are required. Flash and Pro PDF profiles coexist when their reviewed payload/privacy/quality limits agree; their common logical ceiling uses the reviewed Pro-band maximum, while each physical attempt reserves its own tariff maximum.

### Reviewed health recovery

The existing MFA-backed setup review form has an explicit health-recovery checkbox. It requires a complete current review, an existing profile/account, a reason and the exact preview of the account/current-credential health records. A concurrent new failure invalidates that preview. Recovery is audited and idempotent; it does not release held money, clear billing incidents or quota quarantine, replenish usage, change the shared cap, or activate the feature. Ordinary review renewal does not clear health stops.

# Router One catalogue billing and settlement reconciliation

Current branch status: the production catalogue-calculated path is implemented and
under verification; it is not yet published or deployed. Supplier-wallet settlement
and CSV receipt promotion remain disabled. See the latest implementation section
below for the active policy; earlier receipt-only proposals are superseded for
prospective catalogue billing. Public tariffs are never labelled settled expense.

## Verified contract and missing prerequisite

Rechecked 2026-11-01 against the [official OpenAPI](https://router.one/docs/openapi.json). Completion usage supplies token counts; no supported request-bound wallet settlement retrieval contract was found. X-Request-ID can correlate responses. Completion IDs and balance differences are not substitutes.

[Dashboard observability](https://router.one/llm-observability) documents requestId, walletChargedUsd, chargeSource, planQuotaUnits and billingPricing.status, and exports for logs and wallet ledger. Pending means unknown. A plan's totalCost is a list-price equivalent. These dashboard field names are not a promised CSV schema or inference response schema. Obtain a redacted real export plus provider confirmation of column semantics, finality, currency, account/key identity and amendment behavior before implementing an adapter.

The [streaming contract](https://router.one/llm-streaming) and [changelog](https://router.one/blog/changelog) establish that cancellation can still incur settled charges, including provider estimates absent final upstream token usage. A nonstream request disconnected by the client can finish and be billed as 499; a retry can be separately billed. Zero reported tokens and failed client outcome must never overwrite a confirmed supplier debit. Our own token reconstruction is not supplier expense evidence.

## Proposed trust boundary

1. An authorized administrator supplies official records through an authenticated import path, with account identity verified against an existing configured supplier account. No credentials are accepted in files. Raw evidence stays in restricted storage, never source control or public reports. Record its SHA-256, capture time, source, uploader identity and parser version.
2. Verify the adapter against provider documentation and an actual redacted fixture. A locally typed amount or self-labelled JSON is not trusted evidence. Unknown schema, missing account/key identity, ambiguous currency or unconfirmed finality quarantines the row.
3. Normalize into an INTERNAL envelope (not invented provider fields): account reference, nonsecret key reference, request ID, requested and settled model, exact USD decimal amount, settlement finality, charge source, source digest and row locator. Preserve token counts only as diagnostics. Do not apply supplier pricing multipliers again: walletChargedUsd is already the supplier debit.
4. Correlate to exactly one internal build and physical attempt through X-Request-ID plus account/key binding. Current header audits alone do not establish this complete binding. Add durable build/attempt/account correlation before activation; do not guess from time proximity, aggregate PDFs, completion IDs or model names. Auto routing requires the provider's settled model, rather than assuming the requested `auto` is an exact-model receipt.
5. A timeout before response headers leaves correlation unresolved. Preserve an unresolved attempt; do not treat it as free or synthesize a provider request ID. Do not discard errors, cancelled streams, 499s or retries from the reconciliation queue.

## Receipt state and idempotency

Use immutable evidence plus a canonical identity `(supplier account, key reference, request ID)`, not a mutable token aggregate. Store state transitions and reason codes atomically:

- Unmatched, pending, null, negative, nonfinite, malformed, wrong currency/account/model: quarantined/unsettled, user debit unauthorized.
- Settled nonnegative wallet debit with verified binding: eligible supplier expense. Explicit settled zero remains distinct from missing/pending.
- Plan-covered record: wallet zero only when explicitly confirmed; plan list-price equivalent does not become wallet expense. Subscription allocation would be a separate authorized policy.
- Exact duplicate: no-op, retaining provenance. Same identity with any conflicting financial, model or attribution field: quarantine the identity; never last-write-wins.
- Distinct retries: distinct supplier expenses and evidence, even if one logical turn retried. Provider internal failover must not be counted again beyond the provider's settled request charge.
- Failed or absorbed work: retain supplier expense, apply existing build failure/absorption policy separately. It must not erase expense or silently make that work user-billable.
- Post-settlement correction/refund: append evidence and require a separately authorized correction workflow. This task authorizes no historical debits, refunds or ledger rewrites.

Concurrent imports must acquire the same durable identity transactionally, with a unique settlement-operation key. The transaction binds evidence version, build policy version, discount snapshot and existing settlement state. Two workers cannot authorize the same expense twice. An uncertain commit is looked up by operation key, not blindly retried.

## Prospective billing integration after prerequisites

For a newly authorized, unsettled prospective build only:

1. Validate all Router One receipts and select only user-billable work under existing failure/absorption policy.
2. Compute Router One amount as sum of verified actual USD wallet expenses multiplied by exactly 2.5 (5/2), once. Use exact decimal/minor-unit arithmetic with a documented precision and one final rounding policy.
3. Compute ordinary providers through their existing policy. Keep measured sandbox expense internal, separate from the customer fee. Keep Surplus's own receipt policy unchanged. Do not send Router One's marked-up subtotal through legacy 4x or the unattributed-token fallback.
4. Apply the configured build discount to the combined AI subtotal, preserving the AI real-cost floor and absorption rules. Then add the owner-authorized sandbox service fee, exactly 2.5% of that discounted subtotal. Store all subtotals and the policy snapshot for audit; absent expense is not a measured zero floor.
5. Commit the single wallet decision through the existing idempotent build settlement mechanism. Unsettled/conflicting portions remain explicitly unresolved according to the approved fail-closed policy. A later import must not retroactively debit a build already marked absorbed or settled.

## Activation gates and regression matrix

Keep the import path absent/disabled until trusted records and the supported adapter exist. Required tests before activation: exact account/key/request/model binding; cache included-in-input semantics; explicit zero versus pending/null; provider-settled estimated charges with zero tokens; 499 and abort-before-headers; independent retries; duplicate and conflicting imports in either order; simultaneous transactions; failed/absorbed work; plan charges; mixed providers and sandbox; exactly-once 2.5x; discount-before-sandbox-fee and AI floor; restart after uncertain commit; correction evidence without historical wallet mutation. Use synthetic fixtures for public code and restricted redacted provider evidence for adapter acceptance.

Required outside actions: supplier-confirmed settlement contract/export fixture and identity binding; administrator-approved import trust/storage workflow; permission for any future rollout. Current tests of fail-closed handling cannot certify this unimplemented positive settlement workflow.

## Offline export validation (2026-11-01)

`scripts/lib/routerOneExport.ts` is a pure, disconnected parser for the observed
18-column Logs export schema. It returns `kind: unverified-export` and
`billingAuthorized: false` in every case. It has no production caller, network,
filesystem or wallet access. No real export or private identifiers are fixtures.

The supplied export establishes observed column names, not finality or account
ownership. `Wallet charged (USD)` is preserved as a reported observation, never
an accepted receipt. `Cost (USD)` is not used for expense or fallback. Empty/null
wallet values are unknown, explicit zero remains reported zero, and decimals are
converted exactly to integer micro-USD strings. More than six decimal places,
negative/scientific/nonfinite amounts and unsupported charge sources quarantine
the row; they are never rounded or priced from tokens. Six places is this
validator's conservative supported precision, not a claim about the provider's
maximum precision. Plan observations are not evidence of confirmed plan semantics.

Quoted fields, escaped quotes, CRLF/LF and a leading BOM are supported. All headers
are required exactly once; reordering is allowed, extra headers are rejected.
Malformed CSV rejects the file. Input is bounded to 2 million JS characters and
10,000 records. Record locators are CSV record numbers, not physical lines when
quoted fields contain newlines. Token/time/status fields receive syntax checks
only; token arithmetic never establishes supplier expense or attribution.

Duplicate handling is file-local: identical key/request evidence is marked as a
duplicate; any changed field quarantines every version, in either order. This is
conservative even for formatting-only changes. It does not establish cross-file
or durable transaction idempotency, and amounts must not be summed for billing.
Returned identifiers are private evidence and must not be logged publicly.

Still blocked: provider-confirmed wallet finality/precision/amendments and export
semantics; administrator-confirmed account/key ownership and trusted provenance;
durable request-ID-to-build/physical-attempt binding. Pending, plan, cancelled499,
retry and correction examples need authentic acceptance evidence. No automatic
lookup endpoint has been established. No historical charge, accepted-receipt
promotion, production route or import activation is authorized by parsing a file.

## Owner multiplier revision — 2026-11-01

The owner replaced the earlier Router One model-expense target of 10x with **2.5x**.
This supersedes the older Router One target only. Surplus retains its existing 10x
receipt policy; other providers, hosting prices and historical wallets are unchanged.
There is no active Router One positive settlement path to retune today. The offline
validator exposes the immutable prospective ratio `{numerator:5, denominator:2}`
for review, while every output remains `billingAuthorized:false`. It neither
multiplies the exported wallet observation nor emits a customer charge. This is
policy metadata, not an activated tariff or evidence of trusted settlement.

For a future authorized successful billable build, let R be verified, user-billable
Router One expense and B the existing AI bill excluding Router One from both its
provider ledger and token remainder. The AI list subtotal is L = 2.5R + B.
Surplus retains its own 10x; ordinary providers retain their existing pricing.
Router One never passes through legacy 4x/3x or unified margin again.

The owner subsequently confirmed a sandbox policy for ALL Pro bands: measured VM
expense no longer enters the customer subtotal, markup, stop floor or discount
floor. It remains separately tracked as internal rate-priced expense when a real
hourly rate is configured; missing expense is not a verified zero. The retired
AGENTV3_BILL_SANDBOX switch cannot stack the old component onto the new fee.
Independent hosting/database subscription charges are outside this build fee.

After existing failure, waiver, stop and free-build rules, apply the configured
build discount to the AI subtotal with the AI real-cost floor. The existing helper
normalizes d to a whole percent in [0,50], never raises an already-absorbed bill,
and ignores savings smaller than one whole percent. Call that discounted subtotal P.
The sandbox SERVICE FEE is P/40; the total is P + P/40 = 1.025P, followed by existing
FX conversion and final wallet rounding. This is not 2.5% of the final total and is
not represented as actual infrastructure expense. Zero stays zero. Live, normal
and watchdog settlement use the same fee helper, and diagnostics itemize both facts.

Synthetic future example: R=$0.04, no other AI cost, L=$0.10. A 10% discount gives
P=$0.09, sandbox fee=$0.00225 and total=$0.09225 before currency rounding.
Measured VM expense is separate and does not change this formula. This is a policy
illustration, not an authorized charge from an unverified export.

Until receipt/provenance/account/request-binding prerequisites are met, Router
One model expense stays explicitly unsettled/absorbed. The prospective ratio and
fee do not unlock automatic actual-cost settlement or historical debits. Routing
activation does not certify billing readiness; unknown-cost absorption remains a
material economic limitation of this rollout.

## Weak routing revision — 2026-11-01

The owner authorized Surplus → Router One → GLM → the existing tail. Surplus still
requires its normal admission and recovery eligibility. Router One is eligible
with its existing key by default; explicit ROUTER_ONE_ENABLED=off remains an
emergency disable. No key or disabled engine is skipped honestly, never replaced
with invented credentials. The old profile pin and no-fallback profile override
no longer bypass Weak; other bands retain their routing. Router One shares the
existing multi-provider bench, dead-rung, stop and usage-attribution machinery.
Planning, complex and heal Weak lanes preserve the prefix. Explicit retry or
escalation may advance past failed tail rungs. A GLM-free override uses the existing default Weak GLM model rather than bypassing
the confirmed prefix. Configured GLM models and the tail remain subject to key availability and the existing no-Sonnet/Opus guard.

## Superseding owner decision — 2026-11-01 15:04 UTC

The owner rejected permanent unknown-cost absorption as a general Router One
product policy and explicitly authorized **posted catalogue rate × returned usage**
as the billing basis. This is catalogue-calculated cost, not a settled wallet debit.
A verified supplier settlement API is no longer a prerequisite for that separately
labeled billing basis. It remains necessary for later actual-debit reconciliation;
no historical debit/refund is authorized.

**Release hold:** the broad Router One routing change above must not be deployed
with the old silent absorption path. Production release requires a verified price
adapter, durable immutable per-call/model/build snapshot, complete protocol usage,
2.5× exactly once, and bounded missing-data behavior. Unpriceable models must be
skipped BEFORE inference. Missing usage AFTER a successful call must not cause
successful actions to replay or guessed tokens to be billed; stop further Router
One dispatch for the affected build and preserve explicit pending evidence.

Research found a concrete adapter prerequisite: the official GET /v1/models docs
and OpenAPI say that entries include posted price fields but do not define their
names or units. The existing discovery parser guesses per-token versus per-million
from the numeric magnitude and is NOT acceptable billing evidence. An authentic
redacted catalogue response with price fields, currency/units, cache rates and any
context tiers, or a complete supplier schema, is needed before binding the adapter.
No authenticated provider credential is configured in the current task environment.
Do not invent provider fields to fill this gap.

The official prompt-caching guide establishes Chat Completions prompt_tokens as
inclusive of prompt_tokens_details.cached_tokens. It does not establish a separate
Chat cache-write counter. The initial supported subset must therefore require
write price = ordinary input price; other tariffs are unpriceable on this protocol
until their write usage semantics are established. Missing discounted-read counters
are pending, not assumed zero. Whole-request context tiers use strictly greater
input thresholds and include cached input once. Reasoning is already output usage.

`scripts/lib/routerOneCatalogueMath.ts` is an offline arithmetic foundation using
explicit INTERNAL normalized fields, not an assertion about Router One API fields.
It rejects unknown units, unsupported Chat write tariffs, stale/model-mismatched
snapshots and incomplete/conflicting counters. Decimal prices and token products
use integer arithmetic; the result distinguishes catalogue cost from wallet debit
and retains an immutable snapshot. All outputs remain billingAuthorized:false.
This is not the production adapter, persistence, pending-dispatch circuit or wallet
integration, and its tests do not establish release readiness. The existing CSV
validator remains unverified and is not promoted into settlement authority.

References checked 2026-11-01: https://router.one/docs/models/listModels,
https://router.one/docs/openapi.json, https://router.one/llm-prompt-caching,
https://router.one/pricing-methodology. The public pricing page and individual
model pages can differ in plan-coverage statements; plan quota pricing must never
be substituted for a posted wallet-token tariff or treated as actual wallet debit.

## Public-page source correction (2026-11-01)

An authenticated catalogue response is not the only acceptable source. The official
public model detail pages explicitly publish wallet token tariffs and units. The
DeepSeek V4.1 Flash page was independently read on 2026-11-01 and identifies
`deepseek-v4.1-flash`, input USD 0.60, output USD 2.40, cache write USD 0.60 and
cache read USD 0.012 per million tokens. Its ordinary and write rates coincide,
so the documented Chat inclusive-input/read counters can price this tariff.
These observations establish a viable source, not a hardcoded production rate.
The methodology explicitly identifies published model rates as the pricing source.

A live adapter may consume those official pages without guessing API JSON fields.
It must verify the concrete model, explicit units and wallet-token pricing, reject
ambiguous or unsupported tiers, retain source URL, content digest, parser version
and retrieval time, and bind an immutable snapshot before each physical call.
It must never interpret a subscription allowance as a token tariff. Rate changes
apply to new attempts; refreshing must not rewrite an in-flight snapshot.

Current verification limitation: the managed executor attempted a normal HTTPS
GET of the public model page and received HTTP 403. Its current enforced network
policy includes only package-manager presets and excludes router.one. No retry,
proxy change or alternate route was used. Browser-extracted text established the
rates above but does not establish the raw HTML/embedded-data structure required
for a tested live parser. An approved environment policy update permitting the
source, or supplied authentic raw page evidence, can remove this parser-evidence
blocker. No API key or paid inference call is necessary for public-page evidence.
Production catalogue integration and broad Router One release remain on hold.

Observed JSON-LD provides a preferable adapter boundary: Product.sku and token
price components carry explicit currencies and reference quantities. The offline
reader in scripts/lib/routerOnePublicTariff.ts validates that observed structure
using synthetic fixtures; authentic artifact acceptance remains pending. It rejects
incomplete or overlapping tier intervals and unsupported cache-write tariffs instead
of admitting a model at an invented price. Its outputs do not authorize dispatch
or billing. No production caller or page fetcher has been installed by this step.


## Production catalogue path (2026-11-01, verification in progress)

The public JSON-LD reader and integer arithmetic now live in
`src/server/AI/RouterOne/publicTariff.ts` and `catalogueMath.ts`. The supplied decoded
DeepSeek fixture passes exact-SKU, explicit USD/per-million and cache-rate validation.
The Luna fixture is excluded: its SKU is `openai/gpt-6-luna`, and its distinct cache
write price cannot be calculated with the verified Chat counters. Unsupported IDs,
variants, aliases, units, offers and tier shapes are skipped, never assigned another
model's rates. The raw HTML transport remains unverified in this executor.

`publicPriceSource.ts` discovers a candidate detail link on the official models
page and requires its Product SKU to match the requested model. Slug normalization
is only a discovery hint; it cannot authorize an alias. Only static JSON-LD is read.
HTML is bounded, redirects are rejected, and snapshots expire after five minutes.
Snapshots preserve source URL, SHA-256 of retrieved HTML, parser version, currency,
units, rates and retrieval time. A refresh never modifies an in-flight snapshot.
The catalogue ranking validates public rates before ranking discovered candidates.

`catalogueAccounting.ts` reserves a physical attempt before sending it. The durable
record binds the build request, authenticated user, workspace, generated call ID,
credential hash and immutable tariff. X-Request-ID is retained when received.
No prompts, responses or secret credentials are stored in these accounting records.
Raw Chat counters are checked before the generic tool adapter defaults absent
usage to zero. Reasoning is already in completion tokens; cached input is included
in prompt tokens once. A successful calculation is explicitly
`expenseEvidence: official-public-tariff` and `settledWalletDebit: false`.

A key has at most one outstanding physical request across workers. Missing usage,
conflicting model/counters, transport ambiguity or uncertain persistence leaves the
key blocked in durable storage, including across subsequent builds and restarts.
There is no timed automatic release of this hold. A response already returned is
preserved; accounting failure does not replay its actions. Later attempts skip to
the approved provider fallback chain. This conservative concurrency limit may reduce
Router One throughput; it bounds unresolved exposure while reconciliation is absent.
Reopening a pending key requires a separately reviewed reconciliation action; no
admin bypass, automatic import or historical wallet adjustment is supplied here.

The provider ledger retains each issued call independently and rejects serialized
lookalikes. Duplicate callbacks count once; conflicting callbacks quarantine the
call. Existing discarded/empty/barren-work absorption rules remain in force.
Positive catalogue costs feed the existing build cost ceiling. Scope classification
uses the same dispatch guard and its measured expense is included in the build.

For billable work, Router One model subtotal is catalogue cost multiplied by 2.5
exactly once. Surplus keeps its existing 10x receipt policy; other providers keep
their existing policy. After existing failure, Stop, waiver and free-build rules,
apply the configured discount (the existing maximum is 50%) with the existing AI
cost floor. The sandbox service fee is 2.5% of that discounted subtotal. Therefore,
if that subtotal is P, final build charge is P * 1.025, subject to the existing
wallet conversion/rounding/affordability rules. Actual configured sandbox expense
is internal telemetry, not an additional user component or discount floor. Hosting
and database subscriptions are separate. No previous wallet is recalculated.

Release still requires final-tree aggregate tests, required remote CI and verified
deployment. Fixture acceptance is not a live network or paid-inference test.

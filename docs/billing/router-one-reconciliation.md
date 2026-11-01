# Router One settlement reconciliation — disabled design

Status: offline observation validator only; no importer, scheduled settlement, receipt acceptance endpoint, wallet write, or production activation is implemented. The billing guard rejects inferred Router One prices. It is not evidence that inference has become automatically billable. Deploying the guard alone would absorb unknown model expense; it must not be presented as completed 2.5x billing or used to enable free production traffic.

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
3. Compute sandbox and ordinary providers through their existing policy. Keep Surplus's own receipt policy unchanged. Do not send Router One's marked-up subtotal through legacy 4x or the unattributed-token fallback.
4. Apply the configured build discount LAST to the combined bill, preserving the existing real-cost floor and absorption rules. Store all subtotals and the policy snapshot for audit; absent expense is not a measured zero floor.
5. Commit the single wallet decision through the existing idempotent build settlement mechanism. Unsettled/conflicting portions remain explicitly unresolved according to the approved fail-closed policy. A later import must not retroactively debit a build already marked absorbed or settled.

## Activation gates and regression matrix

Keep the import path absent/disabled until trusted records and the supported adapter exist. Required tests before activation: exact account/key/request/model binding; cache included-in-input semantics; explicit zero versus pending/null; provider-settled estimated charges with zero tokens; 499 and abort-before-headers; independent retries; duplicate and conflicting imports in either order; simultaneous transactions; failed/absorbed work; plan charges; mixed providers and sandbox; exactly-once 2.5x; discount-last and floor; restart after uncertain commit; correction evidence without historical wallet mutation. Use synthetic fixtures for public code and restricted redacted provider evidence for adapter acceptance.

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

For a future authorized successful billable build, let R be the sum of verified,
user-billable Router One model expenses, and B be the existing bill for everything
else after removing Router One from both the attributed ledger and token remainder.
The intended pre-discount amount is **L = (5/2)R + B**. R never passes through the
legacy 4x/3x curve or unified margin again. B continues to include Surplus under its
own policy and the remaining providers/sandbox under their existing billing mode.
Failed, barren, absorbed and already-settled work retain their existing exclusions.

On the ordinary non-Opus real-cost path with unified margin disabled and the default
settings, B uses `tieredMarkupUsd(O + S)` for billable ordinary-provider expense O
and included measured sandbox expense S: first USD1 at 4x, excess at 3x. With unified
margin enabled, that existing path uses its configured build margin instead. Legacy
and Opus modes retain their existing formulas. S is included only under the existing
sandbox switch plus explicit positive verified hourly rate, using measured/capped
build time. No hosting or sandbox rate is changed by this owner decision.

The configured discount is applied LAST using existing `applyBuildDiscount`, once,
with L as billedUsd and the existing real-cost-plus-sandbox floor F augmented by
verified Router One expense. The setting is normalized to a whole percent d in
[0,50]. Zero bills remain zero. When d=0 or F>=L, L is unchanged (the discount never
raises an already-absorbed bill). Otherwise the candidate is max(L*(1-d/100),F);
if that saves less than one whole percent, the existing helper also leaves L
unchanged. Otherwise the candidate is paid. Unknown expense never becomes a
measured-zero floor. Existing conversion/final rounding still happens downstream.

Synthetic example under ordinary default real-cost billing: R=$0.04, O=$0,
S=$0.006 gives L=$0.10+$0.024=$0.124. With d=10 and F=$0.046, payment would be
$0.1116 before existing final currency rounding. This is a policy illustration,
not a live quote or a charge authorized from an unverified export.

Until the receipt/provenance/account/request-binding prerequisites above are met,
Router One's current model portion stays explicitly unsettled/absorbed. Changing
the prospective ratio does not unlock automatic billing or historical debits.

# Public Qubax price observations

The server can automatically collect Qubax marketplace prices and independent
official price pages. This is an **observation feed**, not paid-inference
authorization, an all-in quote, or proof of realized savings. It does not modify
Builder routing, the reviewed Chat catalog, supplier contracts, account authority,
privacy reviews, quality benchmarks, or exact-payload approvals.

## Activation and cadence

The existing server operator can enable `QUBAX_PRICE_FEED_ENABLED=1`. It defaults
off. A Qubax key or `QUBAX_ENABLED` does not activate this feed; enabling the feed
does not activate inference. This change does not set production environment
variables, create Cloud Scheduler infrastructure, or perform production writes
during development/tests.

The shared scheduler registers `qubax-public-price-feed`, runs it at startup and
every four minutes while the process is running, and includes it in the existing
authenticated `/api/internal/scheduler-tick` catch-up mechanism. No new public
endpoint is added. The job uses its own fail-closed 45-second Firestore lease,
not the generic fail-open ten-minute scheduler lease. Publication checks its
token, expiry, generation ordering and snapshot freshness inside one transaction.

Four-minute polling leaves nominal headroom before five-minute expiry. It is not
an availability guarantee or instantaneous price-change notification. Delayed
external ticks, scale-to-zero, network latency, unavailable stores or stale CDN
content can leave a gap. Verify the existing external tick actually runs often
enough for the deployment. Stale observations are unavailable until collection
succeeds. A failed refresh retains old source timestamps; reading a document never
refreshes them. The store permits recovery after 30 seconds, but does not add an
extra retry timer: the next startup or scheduled attempt performs the retry.

## Fixed sources and intentionally limited coverage

All requests are unauthenticated public HTTPS **GETs** with no cookies, credentials
or user data. Exactly these three URLs are allowed:

- `https://api.qubax.ai/v1/market/models`: token-priced TEXT/MULTIMODAL rows,
  excluding rows advertising zero context capacity.
- `https://developers.openai.com/api/docs/pricing.md`: flagship **Standard**
  pricing only, retaining distinct short/long context rows and explicit cache
  rates. Batch/Flex, Fast, regional, specialized and media sections are excluded.
- `https://docs.z.ai/guides/overview/pricing.md`: latest and current text-model
  tables only. Conditional free cache storage remains labeled conditional.

This deliberately does not claim coverage of every Qubax model or official
provider. Model labels remain source labels. There is no heuristic alias join,
supplier selection or provider inferred from a market label.

Qubax's documented `benchmark` and `discount_pct` are OpenRouter-relative and
are not used. Its blended price is not used as an equivalent-workload price.
See [Qubax's market contract](https://qubax.ai/docs/market).

## Bounds, provenance and unknowns

- Exact decimal lexemes are converted to integer nano-USD. Negative, unsafe or
  sub-nanodollar rates fail closed instead of rounding a discount into existence.
- Each GET has a ten-second deadline and a two-megabyte decoded body bound.
  Redirects, unexpected content types, private/reserved connection addresses,
  invalid UTF-8 and changed/ambiguous supported table schemas are rejected.
  Duplicate JSON members (including escaped-equivalent keys) and excessive
  nesting are rejected before normalization.
  A feed-local DNS/socket guard rejects mapped IPv6 and special-use ranges too.
  Native DNS has an eight-second callback deadline and one pending lookup per
  source host. A timed-out native lookup keeps that slot until its real callback.
- At most one collection runs per process. A deadline returns promptly, but a
  stalled fetch/read/cleanup retains the slot until underlying work settles,
  preventing repeated scheduled attempts from accumulating detached requests.
- All three source observations must succeed before one complete generation is
  published. Each records URL, parser version, SHA-256, fetch times, HTTP Date/Age
  and Qubax's source `updated_at`. Missing/invalid freshness evidence is rejected.
- Expiry is no later than five minutes after the oldest relevant fetch/source/cache
  observation. An old page modification date is not treated as a current quote.
- Unknown cache rates, fees, exact revision, tokenizer, region and SKU remain
  explicit unknowns. Null here means **unknown**, not free or unsupported. This
  differs deliberately from the reviewed catalog's stronger evidence contract.

The bounded generation is stored only in server-owned
`qubax_price_observations/active`, capped at 750,000 serialized bytes, below the
Firestore one-MiB document limit with room for coordination metadata. It contains
no raw documents, response cookies, user messages, credentials or unbounded
history. Error messages are fixed identifiers, never upstream bodies or secrets.
The unchanged default-deny Firestore rules provide no client access to this path.

## Why this does not authorize Chat

The observation kind is different from `qubax-reviewed-chat-catalog-v1` and always
has `canDispatch: false` and `proofStatus: unreviewed`. The collector never writes
`qubax_catalog/active` or `qubax_chat_approvals/*`. Observations alone cannot pass
the existing selector.

Before paid use, independently reviewed evidence must still establish exact
equivalent model/revision, tokenizer/SKU/context/tier, cache/fee coverage,
supplier-enforced total liability including internal retries/failovers, current
Hindi/text quality and downstream data protections. Public tariffs alone cannot
establish those facts. Missing evidence deliberately skips Qubax.

The user priority remains **at least 90% verified savings first, then response
quality**. The existing selector filters by savings and ranks the eligible
reviewed options by quality, reliability, latency and conservative cost.
Qubax's key-level routing policies and transparent internal seller failover are
not a documented per-request seller/revision pin or an all-in charge cap.
`min_discount` alone cannot supply the independent official comparison.
See [Qubax routing modes](https://qubax.ai/docs/routing-modes).

## Verification

`tests/qubaxPriceFeed.test.ts` and `tests/qubaxPriceFeedStore.test.ts` use synthetic
source pages, mocked HTTP/Firestore and a credential-empty boundary. They cover
decimal precision, unsupported schemas, stale/future source timestamps, exact
source restrictions, redirect/DNS/body/deadline bounds, retained cleanup slots,
leases/concurrent publication, unchanged expiry after failure, and the inability
of observations to authorize dispatch. These are not paid model calls, actual
Hindi quality benchmarks or invoice verification. The repository's complete CI,
coverage and emulator gates remain required.

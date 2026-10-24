# Surplus bounded discount model manager

## Scope and safety

The separate metadata manager is OFF by default. It reads public marketplace metadata
without an API key, prompts, inference requests, purchases, wallet changes or production
configuration. The opt-in Builder integration is documented separately in
[SURPLUS_BUILDER.md](SURPLUS_BUILDER.md); neither manager metadata nor admin controls grant
permission to execute a paid request.

Startup, the existing scheduler and prebuild refresh share one durable
Firestore transaction lease and a fixed five-minute cooldown. A refresh publishes only a
complete snapshot, fresh for five minutes measured from its start. Expired or incomplete
observations fail closed. This is bounded near-real-time polling, not instantaneous prices
or guaranteed capacity. In-process scheduling only runs while the service is awake; the
existing external scheduler tick must actually operate for wall-clock polling.

```dotenv
SURPLUS_REGISTRY_ENABLED=false
SURPLUS_REGISTRY_INTERVAL_MS=300000
AGENTV3_SURPLUS_BUILDER=false
```

`SURPLUS_REGISTRY_INTERVAL_MS` remains accepted for old deployment configuration, but all
values normalize to the fixed five-minute cadence. A legacy ten-minute value does not leave
an intentional stale gap. This implementation does not change deployment environment values.

## Configured candidate universe

When `SURPLUS_REGISTRY_MODELS` is absent, these 15 candidates are observed:

- deepseek-v4.1-flash
- deepseek-v4.1-flash-1017
- glm-5.3
- glm-5.3-flash
- glm-5.2
- qwen3.8-flash
- qwen3.8-2.4t-a95b
- qwen3-coder
- qwen3-coder-next
- qwen3-coder-30b-a3b-instruct
- minimax-m2.5
- minimax-m2.1
- gpt-5.6-luna
- gpt-5.6-sol
- claude-sonnet-5

These exact IDs were checked against the official public catalog on 2026-10-24. They are
observation candidates, NOT an independently demonstrated “top 15,” quality ranking, or
benchmark approval. Catalog tool support is not proof of safe transcript round trips,
parallel tools, returned identity, provider pinning or receipt semantics.

An explicit comma-separated override may select 1–15 unique valid IDs. Empty, duplicate,
malformed or oversized lists fail closed before any database/network work. The manager does
not silently truncate a larger list or discover/approve future models. Removing a model
from the current environment excludes it from fresh Builder state even during the shared
sync cooldown. Existing tier exclusions still apply independently.

## Observation data, freshness and bounds

The manager requests the provider trust feed and each configured model's detail order book:

- https://api.surplusintelligence.ai/v1/providers
- https://api.surplusintelligence.ai/api/markets/{model}

It does not rank from the aggregate market endpoint, which can lag the detail order books.
Requests are GET-only, credential-free, redirect-denied, ten-second bounded and at most
2,000,000 bytes each. Three model reads run concurrently, at most fifteen total after one
provider read, so the bounded refresh fits inside its 120-second lease. A failed group is
fully settled before returning; partial snapshots are never published.

Only available, healthy, trusted offers with exact IDs are normalized. Trust must also match
the separate provider feed; these remain provider claims, not independent quality evidence.
There are at most 64 eligible offers per model, 960 in aggregate, and 500000 serialized bytes
per snapshot. Oversized input fails closed instead of silently losing a cheaper candidate.

Fetched time, HTTP Date, Age and Cache-Control are recorded separately. Unknown origin quote
generation time stays null. A successful fetch is not a fresh executable quote. Numeric
rates remain raw unverified unit strings until an independently reviewed price contract
applies. Missing cache read/write or reasoning prices remain unknown, never zero. Different
offers' cheapest dimensions are not combined into a fictional offer.

## Same-workload ranking, not headline discounts

The pure selector compares total estimated cost for the SAME requested input/output/cache/
reasoning workload, using scaled BigInt arithmetic and conservative rounding. It requires
fresh bounded observations, current independently reviewed price units and account/privacy,
comparable reviewed coding benchmark artifacts, matching model/provider or exact offer
binding, availability/trust and the applicable discount gates.

Polling cannot create or renew any quality, capability, account, usage, official tariff,
privacy or pilot review. Default reviews remain empty. An estimated candidate returned by a
preview always has `canDispatch: false`; it is not an inference authorization or a bill.
The production adapter separately enforces fresh build/dispatch checks and request-time
floor routing, reviewed capability, returned identity, pilot budgets and receipt accounting.

## Admin-only management

Admin Dashboard → AI Engines → Live Model Registry includes the Discounted PAID Builder Manager. It displays the configured
universe, last attempt and successful observation, expiry, next allowed sync, sanitized
failure state, current raw observed prices/source timestamps, independent quality review
status and blocked reasons. Its illustrative estimate uses 10,000 input + 2,000 output tokens,
not a claimed actual build price. Complete dispatch eligibility is explicitly not granted
by this screen.

Refresh status only reads saved metadata; it does not trigger inference or bypass the
shared polling lease. OFF returns a disabled response without storage or network work.
Server outages or malformed control state return unavailable, never invented freshness.

Disable/re-enable requires the current snapshot version, manual-control revision and a
10–500 character reason. Concurrent changes return a conflict for fresh review. The control
only adds/removes an exclusion; it never creates keys, reviews, account approval or terms
acceptance. Exclusions apply on fresh reads and are rechecked at paid admission. Re-enable
only permits independent checks to run again, and does not make an unreviewed model eligible.
In-flight requests are not magically canceled by a later admin action.

## Durable state and isolation

One fixed retained document, `live_ai_registry/surplus-metadata`, contains the bounded
snapshot, transaction lease, cooldown, last attempt/success/error and manual controls:

```ts
controls: {
  revision: number;
  disabledModels: string[];
  updatedAt: number | null;
  reason: string | null;
}
```

A legacy document without controls is revision zero with no exclusions. Malformed controls
fail closed. Effective snapshot reads carry `controlRevision` so authorization can reject
an intervening control change. Polling preserves controls and failed refreshes never renew
previous snapshot age. No credentials, prompts, user/build identities, history rows or new
subcollections are stored here. Existing OpenRouter registry documents remain isolated.

## Activation still requires real evidence

No runtime flag, account, key, review or deployment was changed. Safe paid use still requires
independent coding/capability evidence, current price and usage mappings, account/privacy and
bounded pilot approval, official billing references and the Builder receipt gates described
in [SURPLUS_BUILDER.md](SURPLUS_BUILDER.md). Metadata prices and local tests do not prove live
routing, invoice settlement, coding quality or production deployment.

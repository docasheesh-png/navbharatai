# Restricted Weak canary: preparation, not activation

The guard is inactive outside an explicitly server-owned async scope. No route,
header, environment flag, authority issuer, recharge or live run is added. Production
routing, user wallet billing and normal provider requests are unchanged.

## Not the normal Weak benchmark

Normal Weak includes GLM FlashX; its exact applicable account tariff and billable
exposure have not been proven for this pilot. The restricted guard rejects FlashX,
unreviewed models/endpoints, Surplus, legacy auxiliary providers, hosted search/media
sandbox acquisition/resume/lifetime extension, and all function-tool execution.
External MCP discovery and credential probes also fail closed before network work. Only text/function-tool Kimi K2.7
Code at the standard Moonshot endpoint can be admitted, with separately reviewed
account credential binding. A cap stop, rejected auxiliary call or unavailable sandbox
is an incomplete/blocked canary, never an app pass. Do not silently reroute or count
this as unchanged production Weak quality evidence.

## Predispatch invariant

Every physical HTTP attempt uses guarded SDK fetch, including retries and race losers.
A Firestore transaction checks server-only authority, UID/request/fixture/tier, expiry,
immutable tariff and credential binding before reserving worst-case input context plus
enforced output maximum. A single authority ledger caps attempts at 12 and total API
liability at no more than 100,000 paise. All-in paise/USD must be a reviewed ceiling
including relevant taxes/fees, not an assumed FX rate. Public list prices are not
account tariff evidence. This patch issues no authority.

Kimi reserves 262,144 input tokens regardless of prompt length: no character/token
approximation. Output is at most 32,768 tokens including reasoning. Published
$0.95/$4 per million implies a maximal $0.3801088 hold, or $4.5613056 for twelve before
fees/taxes. These are reservations, not charges. No hold is refunded, even after HTTP
200. Timeouts, partial streams, cancellation, errors and lost commits retain liability.
Failures poison the store; durable halting is attempted, but local poison remains if
persistence fails. A new process/store cannot resume the ledger automatically. Pending
reservations recheck the stop fence before HTTP. Never reset a stopped pilot or issue a
second authority as a workaround.

## Remaining activation prerequisites

- Server-only authority is `benchmark_canary_authorities/{id}`. Existing rules do not
  grant client access. Create it only after verified account/tariff/FX approval; this
  patch deliberately contains no creator or activation endpoint.
- Reviewed ingress must bind authenticated test UID, exact synthetic fixture hash and
  unique request identity before all pre-intent, attachment, classifier and queued
  build work. Async context must include all descendants, not just the main runner.
- Reconcile the one pilot ledger before another canary. Never issue each app its own
  independent ₹1,000 allowance. This implementation covers one canary authority.
- Factory census covers AgentV3 and its route; runtime fences deny legacy/gateway/Surplus
  paths. It is not proof against every possible future transitive SDK bypass.
- API budget is not infrastructure permission. Sandbox access is denied until a
  separately reviewed bounded grant exists. No live generated-app benchmark can run now.
- Independent review, full CI and deployment remain prerequisites before activation.

## Primary references

- https://platform.kimi.ai/docs/pricing/chat (rendered table; public prices exclude tax)
- https://platform.kimi.ai/docs/guide/use-thinking-models (reasoning + content <= max_tokens)
- https://platform.kimi.ai/docs/guide/kimi-k2-7-code-quickstart (always-thinking K2.7 Code)
- https://docs.z.ai/guides/overview/pricing (FlashX list prices, not account proof)

## Offline evidence

Tests use an optimistic transaction simulator, not a Firestore emulator/concurrency
certificate, plus actual OpenAI SDK with mock transport. They cover parallel reserves,
duplicate physical IDs, retries, stream failures, restart/lost commit, malformed scopes,
cap/identity/model/tool rejection, scope inheritance, early abort and unchanged behavior
outside the scope. Real boundary tests deny auxiliary/media/Surplus before DB/HTTP.
No actual provider/database calls occur.

# Qubax in Chat

Qubax is an optional **paid** Chat rung immediately after Mitrify in the reviewed
`TEXT_CHAIN_POLICY=fixed-v1` order. It does not modify Builder, professional,
doctor, SDA, developer API, image, voice, or embedding routing. The existing
12-physical-attempt maximum is unchanged even though the preference list has 13
positions. Skips do not consume physical attempts.

## What is implemented

- One server-only POST to `https://api.qubax.ai/v1/chat/completions`, with the
  server's `QUBAX_API_KEY`. No redirects, retries, direct-model fallback, client
  URLs/keys/models, or alternate provider calls are allowed inside the adapter.
- `QUBAX_ENABLED=1` is required. `QUBAX_MAX_INFLIGHT` defaults to 20 and is bounded
  to 1–200. The existing provider switch withdraws the key and blocks the host.
- Both the Gateway and legacy fixed Chat path use their existing shared money
  controls. The Gateway does not also reserve the legacy budget. Completed
  Gateway usage is accounted at a conservative ceiling, **not an invoice**;
  unknown or interrupted liability remains reserved. No unsafe replay follows
  a dispatched error, cancellation, refusal, or uncertain charge.
- Confirmed pre-dispatch evidence revocation or internal timeout may skip to a
  later eligible Chat rung. Caller cancellation, partial output, any possible
  dispatch, and uncertain budget admission still stop the request. A reservation
  alone does not count as a physical attempt.
- Responses are bounded and buffered until complete to prevent partial answers
  or credentials split across SSE events from escaping. The current first-output
  deadline therefore applies to the full validated response. A slow complete
  reply may be rejected rather than emitted incrementally.
- Response-body cleanup cannot delay a validated result or cancellation. Pending
  cleanup retains its concurrency slot until it settles and never releases a
  possibly spent budget hold.
- A separate authenticated admin **Test Chat Bot** uses the same Qubax-only
  adapter without the production routing ladder. See `TEST_CHAT_BOT.md`.

## Required independent evidence, not defaults

No provider catalog or approval is seeded. Setting a key does **not** by
itself authorize a Gateway claim. Public chat and the admin Test Chat Bot use
the live price feed instead. A model is eligible when both its input and output
rates are at least 90% below the official OpenAI or Z.ai rate for that same
model. `discount_pct` is ignored. Passing Hindi and English probes are ranked by
success rate and latency. One turn tries the best three, releasing each failed
try, then the normal chat chain continues with the same history. `QUBAX_MODEL`
is only a backup when no model clears 90%. The per-try reserve defaults to
`$0.02`. Gateway callers that pin `expectedSelection` still use the catalog below.

An existing trusted server operator must maintain the catalog path for Gateway:

1. `qubax_catalog/active`, using the exported `QubaxCatalog` contract in
   `src/server/lib/qubaxSelector.ts`. Qubax and official prices must independently
   identify the exact same model, revision, SKU, tokenizer, context band, service
   tier, modality, currency, and billing basis. Unknown aliases are excluded.
2. Independently reviewed supplier-enforced per-HTTP total ceilings covering all
   fees, internal retries and seller failovers, and exact model/revision pinning.
   A local budget reservation or marketing discount is not that contract.
3. A common benchmark and approved quality evidence: text and Hindi scores at
   least 80%, success rate at least 99%, p95 latency at most 10 seconds, and at
   least 100 samples. These are explicit operational admission criteria, not
   claims that an arbitrary model has achieved those scores. Eligible candidates
   rank by reviewed task quality, reliability, latency, then conservative cost.
4. `qubax_chat_approvals/<qubaxChatBinding(...).id>`, an independently reviewed
   exact-payload, UID, credential, selected model/evidence and gateway binding.
   `qubaxReviewedApprovalCeiling` validates data disclosure and protection refs
   for **all possible downstream processors**, including private/health data
   when applicable. A client consent checkbox cannot create these approvals.
5. For Gateway use, its existing account/terms/quality/privacy/quota catalog and
   migrated account authority. Qubax entries use provider `QUBAX`, legacy provider
   `qubax`, adapter `gateway-qubax-text-v1`, the selected exact model/revision,
   `QUBAX_API_KEY`, and a matching supplier-inclusive ceiling rate card. Entries
   remain Chat-only. No new authority or account enrollment endpoint is added.

Both independent price observations and supplier-cap evidence expire no later
than five minutes after observation. Reads are single-flight cached for at most
five minutes, and every dispatch forces a fresh read. **Reading the document does
not refresh source timestamps.** Missing, stale, invalid, mismatched, revoked, or
under-90% evidence skips Qubax before transmission. Quality review must also be
unexpired. The exact-payload approval expires within five minutes and no later
than selected evidence.

The comparison uses integer nano-USD for an equivalent bounded workload, all
fees/minimum charges, possible Qubax cache-write charges, and the cheapest
applicable official cache-read rate. Every component must be at least 90% cheaper,
and the enforceable Qubax total ceiling must be at most 10% of the conservative
official workload cost. The result is a **verified maximum for that declared
workload**, not a claim about actual billed savings without supplier receipts.

## Live readiness limitation

An opt-in [public price observation feed](QUBAX_PRICE_FEED.md) collects Qubax,
OpenAI and Z.AI sources automatically, with bounded four-minute polling and
five-minute expiry. It is separate from the reviewed catalog and never certifies
unknown model mappings, fees, supplier ceilings, quality or disclosure approvals.
It does not create accounts, purchase credits or run paid inference. Independently
reviewed evidence is still required to populate and keep the dispatch catalog fresh.
Without that feed, approvals, and reviewed downstream terms, Qubax deliberately
remains unavailable and ordinary Chat continues through eligible later rungs.
The Test Chat Bot instead shows unavailable and never calls another provider.

Qubax documents a gateway/marketplace. “Qubax only” means NavBharatAI sends only to
Qubax; it does not mean the gateway performs inference itself or avoids upstream
sellers. Seller failover is transparent, and its trusted routing mode is best
effort, not a guarantee of data residency or downstream identity.

Official documentation checked read-only for the transport contract:
- https://qubax.ai/docs/chat-completions
- https://qubax.ai/docs/routing-modes
- https://qubax.ai/legal/privacy
- https://qubax.ai/docs/quickstart (official Billing link: https://qubax.ai/app/billing)
- https://qubax.ai/docs/market (public Qubax marketplace price API; not independent official-baseline or supplier-ceiling proof)

## Offline verification

`tests/qubaxSelector.test.ts` covers rate scope, exact thresholds, caches/fees,
quality ordering, freshness and forced-refresh behavior. `tests/qubaxTransport.test.ts`
uses only synthetic reviews, credentials, database state and mocked fetch. It
covers exact approval, one-use claims, concurrency, no retry, claim/model pinning,
revocation, rejected outputs and credential disclosure. FreeChain and Gateway
integration tests cover placement and the existing budget boundary. These checks
are not a live quality benchmark or evidence of actual paid savings.

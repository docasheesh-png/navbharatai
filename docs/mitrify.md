# Mitrify main-chain transport

The separate menu chatbot, continuation/public/guest test endpoints, and their
exclusive implementation have been removed. Stored history and accounting records
are retained. No production flags or credentials are changed by this removal.

## Main-chat eligibility

`TEXT_CHAIN_POLICY` still defaults to `legacy`; `fixed-v1` defines the requested
order, with Mitrify after verified-free OpenRouter and before CheaperInference.
`MITRIFY_CHAIN_ENABLED=1` permits checking admission; it does not authorize dispatch.
The Gateway has no Mitrify adapter and paid Professional funding integration remains
unavailable. Do not enable a global switch as a substitute for these integrations.
Pro and App Builder are unchanged.

The earlier unconditional private/health prohibition is removed from the legacy
main-chain adapter. Exact server-owned payload approvals remain necessary:

- `mitrify-exact-public-approval-v1` retains its public-only scope.
- `mitrify-exact-data-approval-v2` uses `dataReview.entirePayloadReviewed=true`,
  `approvedDataClasses` covering every server-classified `private`/`health` class
  (or `public` for neither), `gatewayAndAllDownstreamProcessorsReviewed=true`, and
  nonempty `reviewRef`, `disclosureAuthorityRef`, `processorTermsRef`, `protectionsRef`.
  These refer to actual independently reviewed evidence; code does not create it.

Both versions bind the same exact payload, verified user, gateway URL/model and
credential binding. One-hour expiry, atomic one-use claim, revocation checks,
capability limits, supplier-enforced inclusive charge ceiling and existing shared
monetary holds remain mandatory. Changing review evidence invalidates dispatch.
No new approval writer, browser assertion, credentials, supplier suitability claim
or production authorization is introduced. Missing evidence skips this rung.

Complete main-chain replies require a confirmed `stop` finish reason. Length,
missing finish reason, refusal or interrupted output cannot become complete success
or silently replay into another provider. The transport itself remains reusable.

## Configuration

Server-only `MITRIFY_BASE_URL`, `MITRIFY_API_KEY`, `MITRIFY_MODEL` and
`MITRIFY_MAX_INFLIGHT` retain their existing defaults. `AI_BACKEND` and legacy
`AI_PROVIDER` do not globally reroute ordinary chat. Roll back fixed ordering with
`TEXT_CHAIN_POLICY=legacy`; disable main-chain Mitrify with `MITRIFY_CHAIN_ENABLED=0`.
Never place credentials in browser code or logs.

## Transport contract

All integration logic lives in `src/server/lib/mitrify.ts`. It treats the gateway as
one URL, key and opaque model alias. Unknown provider/model response headers are
logged as metadata only; there is no upstream catalogue, price table or UI list.

The transport preserves supported OpenAI plain-text request fields, replacing only
the model and adding `stream_options.include_usage=true` for streaming. Tool calls,
structured output, images and provider-specific options are rejected, not stripped.
Serialized bodies over 8 MiB are rejected before dispatch. HTTPS is required except
for loopback mock servers, and redirects are refused.

Only HTTP 429/503 are retried, up to three retries after the first attempt, using
exponential delay, jitter and Retry-After. Network/body/stream failures are not
retried. SSE data events are forwarded in order as complete events arrive; the full
answer is never buffered. Comments and SSE control fields are not forwarded.
The guard never retains answer events while waiting for an optional metadata field
or delta to recur. It inspects every JSON string field, including refusal,
reasoning, metadata, field names and nested arrays, with at most 1,024 short rolling
prefixes. It rejects the first `min(8, ceil(key.length / 4))` credential characters
as soon as that marker appears, even across events. Shorter prefixes may pass;
substantial credential fragments and the full credential fail before disclosure.
A benign reply containing that marker also fails closed rather than stalling or
rewriting the response. This is literal credential-fragment protection, not a
claim to detect arbitrary encodings of secrets. `[DONE]` is required, and early EOF/error events throw an
explicit incomplete-answer error. Callers must render that error rather than mark a
partial reply complete. AbortSignal cancels network reads and retry waits. Future
route wiring must supply the existing response-disconnect signal and await writes
for downstream backpressure. Cancellation stops waiting for a stalled consumer and
releases the permit; it cannot undo writes already performed by a consumer.
Consumers must honor the same AbortSignal before their own delayed writes.

Logs contain status, latency, attempt number, safe error code and the five requested
X-Mitrify headers (Request-Id, Provider, Model, Attempts and Trail). Credentials are redacted from these headers. **Deliberate safety
limitation:** arbitrary upstream error-message text is not logged or returned because
it can echo prompts or secrets. HTTP 400/other failures have a status and safe code;
401 is explicitly a configuration error. This prioritizes the no-content/no-secret
logging requirement over printing an untrusted provider's raw error message.

## Concurrency and queue bounds

A single process-wide FIFO is shared by all transport clients, and main-chain requests.
A permit covers the entire logical call: retries/backoff, body reads and downstream
stream callbacks. It is released once on completion, failure or cancellation. Queued
cancellation removes the request without dispatching it. Pending requests expire
after 30 seconds; capacity refusals/timeouts are explicit 503 errors, never automatic
replays. The queue permits at most 1,000 waiting calls and reserves at most 64 MiB
of serialized request bodies across active and waiting calls; each body is still
limited to 8 MiB. These are transport retention bounds, not a total-heap guarantee;
HTTP ingress and caller-owned input memory remain separate responsibilities.

The default 200 is per process, not a fleet-wide limit across Cloud Run instances.
Neither that setting nor the local 1,000-waiter test proves 1,000-request throughput.
No production load test or capacity claim has been made. No provider/model-specific
pool, price or routing logic is introduced.

## Offline verification and manual diagnostics

Run `npm run test:mitrify`. Tests use Node's built-in runner, ephemeral generated mock
credentials and loopback HTTP only. The same command is a CI gate. No dependencies
or real gateway key are needed for these tests.

An operator may explicitly run:

```sh
node --experimental-strip-types scripts/mitrify-smoke.mjs
```

It exits if the environment key is missing. Otherwise it checks `/models`, then
makes one short non-streaming and one short streaming chat call. These calls can
spend credits; the script is never run in CI or at startup. Output is limited to
HTTP status, X-Mitrify headers, first streamed event time and the first 100 reply
characters. HTML at `/models` is rejected and stops the inference calls. It does
not establish a production privacy approval. No live endpoint success is claimed.

The manual smoke script is an operator tool; it is not a public bot endpoint and
must not be run without authorization for its potential charges.

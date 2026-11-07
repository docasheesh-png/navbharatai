# Optional Mitrify public-question bot; general chat stays direct

This change provides a server-only OpenAI-compatible transport and offline tests.
It does **not** make arbitrary NavBharatAI chat eligible for Mitrify. Both ordinary
chat entry points retain their existing callback, quota, routing and billing behavior.
App Builder, Pro, Doctor/SDA, professionals, tools, JSON output, vision and embeddings
are unchanged. No credential or deployment settings are installed by this change.

## Privacy boundary

`routes/chat.ts` classifies general chat as health/clinical. A conversation may include
patient data, personal information, profile, memory, attachments and history. The
existing six-question public cache corpus proves only the question's content, not
the full outgoing system prompt. Its broader FAQ eligibility is not privacy proof.
The gateway may forward the full prompt to third-party free-model providers or
Surplus sellers. Never send health records, personal identifiers, payment details
or other sensitive data through this route; features handling them stay direct.

`withMitrifyChatPrivacyBoundary` therefore keeps **all current general chat direct**,
even with `AI_BACKEND=mitrify`, and logs `MITRIFY_PRIVACY_BLOCKED`. No client flag,
keyword detector, missing profile or empty history bypasses this boundary. A future
review must establish trusted provenance for the whole request before connecting
the low-level transport. Do not downgrade the health classification to enable it.

## Separate authenticated text chatbot

The sidebar's **Mitrify chat** entry appears only after the server authorizes the
signed-in, email-verified account. Both GET and POST `/api/v1/chat/mitrify-bot`
verify identity; hiding the UI is not the access control.

`MITRIFY_BOT_ACCESS` defaults to `selected` (including unset/blank). This preserves
`MITRIFY_CHAT_ACCOUNT_EMAIL`: exactly one verified email, never a comma-separated
list. Missing selector denies access. `verified` permits all signed-in users with
a verified, nonempty email; it ignores the selector for this bot only. Unknown
mode values fail closed. This is not anonymous access: the client still requires
login and the server still verifies identity. The separate operator diagnostic
retains its selected-account and admission checks.

Deploying this code does not enable broader access. Changing to `verified` is an
operator activation step, pending authorized runtime access and the applicable
spending safeguards. Roll back broader access with `MITRIFY_BOT_ACCESS=selected`
and the existing selector; `AI_BACKEND=direct` disables bot sends for every account.
The existing 20 requests/minute/account limiter is unchanged in both modes.

The text box accepts up to 2000 characters. Before each send, the user must review
and confirm that the message contains no health records, personal identifiers,
payment details, credentials or other sensitive information. The notice states
that Mitrify and its upstream providers receive the full message and may log it.
Changing text or sending clears confirmation. This is a user-review safeguard,
not proof that arbitrary text is nonsensitive. Server checks reject recognizable
email, long numeric identifier, credential and sensitive-record patterns, but
can miss sensitive text and can reject benign text. Do not claim foolproof detection.

POST accepts exactly `message` and `publicContentConfirmed: true`; extra fields,
profile, history, files and caller parameters are rejected. The reviewed message
is sent unchanged as the only message, with the configured model alias,
non-streaming flag and 256-token output limit. No account identity or previous
reply is appended. Older installed clients can still send the three reviewed
question IDs. Replies are displayed as text, never executed as HTML. The local
conversation is ephemeral, and account changes discard/cancel the panel.

The bot uses only Mitrify; errors never invoke another provider. The shared chat
rate limiter, transport queue/retry bounds, disconnect cancellation and 60-second
deadline apply. Error explanations are fixed local messages with bounded HTTP
status, never raw gateway errors. Existing chat and App Builder remain unchanged.
General health/clinical chat is still routed directly.

In selected mode, configure the server-only email selector to show that account's entry.
To allow sends, also set `AI_BACKEND=mitrify` and securely supply `MITRIFY_API_KEY`;
URL/model defaults remain unchanged. Missing key or direct mode produces an
unavailable state. Roll back sends with `AI_BACKEND=direct`; remove the selector
to hide the entry in selected mode. No production settings or credentials are changed by this code.

This user-operated bot can spend gateway credits when enabled and used. A token
limit is not an INR cap. It does not implement wallet billing or claim a verified
gateway spending ceiling. No automated or live paid test is run by this change.
The separate single-use diagnostic below retains its stricter admission contract.

## Isolated fixed public test (live admission unavailable)

`POST /api/v1/chat/mitrify-public-test` (also the permanent unversioned alias
`/api/chat/mitrify-public-test`) is an operator-only diagnostic, not an end-user UI.
Its caller is an operator using the configured account's existing authenticated
HTTP session; no token or key should be pasted into chat or logs. It
accepts **only an empty JSON object**. The server owns the entire outgoing payload:
"What is 2 + 2? Reply with only the number.", 16 output tokens, no streaming, and no
system prompt, identity, profile, history, memory, attachments or caller parameters.
Only a verified Firebase account with verified email matching the server-only
`MITRIFY_CHAT_ACCOUNT_EMAIL` selector may enter. Other accounts receive 403. The
selector does not pause or switch either ordinary-chat endpoint.
The isolated endpoint has a 60-second execution deadline and aborts on disconnect.
Waiting for identity or admission is cancellation-aware; a late admission callback
cannot dispatch after cancellation. External operations must still honor their signal.

The test uses only Mitrify and has no direct-provider fallback. The OpenAI response body and metadata headers are returned without changing the
provider wording or assuming a consistent style. A response that echoes the server
credential is refused rather than exposed. Transport retries belong to the same logical test.

**No live cost-admission adapter is wired.** Even a matching account, valid key and
`AI_BACKEND=mitrify` receive `MITRIFY_TEST_BUDGET_UNVERIFIED`; no provider is called.
There is no client field or environment boolean that bypasses this guard. The
module's server-only admission interface is exercised with local mock adapters.
A real adapter must verify a gateway-enforced finite INR ceiling covering every
attempt and upstream failover, bind it to the exact endpoint/model/credential
fingerprint, and atomically consume the fixed test ID once per account across
instances. Failure, cancellation or restart must not restore the authorization
without proof that no charge occurred. A local token estimate or ledger alone is
not a charge ceiling. The module snapshots the dispatch configuration before
admission and does not log the key or its fingerprint.

Before a live test, an operator must provide a verifiable gateway-side spending
bound and authenticated account execution access, then wire and review that
admission adapter. This repository contains no production account address,
credential, cap configuration or inferred model price. Ordinary free-form chat remains direct and is not claimed
complete through Mitrify. App Builder remains unchanged.

## Configuration and rollback

Server environment only; never use a `VITE_` prefix or ship a key to a client:

- `AI_BACKEND`: `direct` by default. `mitrify` enables the separate reviewed-text
  bot for accounts authorized by its access mode; all ordinary chat stays direct. The separate
  fixed diagnostic still requires cost admission.
- `AI_PROVIDER`: legacy alias, consulted only when `AI_BACKEND` is unset/blank. An
  explicit `AI_BACKEND` always wins, including rollback to `direct`; conflicting
  aliases produce a metadata-only diagnostic. Invalid switch values stay direct.
- `MITRIFY_MAX_INFLIGHT`: defaults to 200; accepts integers 1–1000. Invalid explicit
  values fail configuration validation for the transport, never affect the direct path.
- `MITRIFY_BASE_URL`: defaults to `https://mitrify.com/v1`.
- `MITRIFY_API_KEY`: required for bot sends and manual diagnostics; no default.
- `MITRIFY_MODEL`: defaults to `mitrify/auto-cheap`; the default is defined once in the module.
- `MITRIFY_BOT_ACCESS`: `selected` by default; `verified` permits all verified signed-in
  users of the separate bot. Unknown values fail closed. No browser-controlled override.
- `MITRIFY_CHAT_ACCOUNT_EMAIL`: no default; server-only verified-account selector for
  selected bot mode and the isolated public test. It grants no diagnostic cost admission
  and does not switch ordinary chat.

Rollback: set `AI_BACKEND=direct`. No deployment or key rotation is needed for this
code switch. This switch does not modify any existing provider settings.

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

A single process-wide FIFO is shared by all transport clients, including diagnostics.
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

The manual smoke script is a separate operator diagnostic, not the single-account
public-test endpoint. It makes two chat calls and has no verified account or hard
spend-cap admission; do not use it as a substitute for that authorized test.

## Bounded concurrent load-test prerequisites

Use the user's authorized aggregate ceiling across all batches, retries, gateway
failovers and charges. Inspect the test credential's applicable limit, scope and
remaining balance through authorized runtime access; never request its value in
chat. A user's confirmation of an existing limit is configuration evidence, not
missing spending permission. A documented non-overdraft prepaid balance with auto-topup
disabled can also bound spend. Alternatively, atomic conservative reservations
can work if a documented enforceable maximum covers every request/attempt and
charge. A token estimate, an unverified discount, an unenforced ledger or stopping
after dispatch is not a charge ceiling. Gateway-specific budget APIs are not the
only possible proof.

Keep the test's credential/endpoint/model binding fixed and include prior charges
and concurrent consumers of the same cap. Do not broaden public traffic or start
live batches before authorized runtime access can establish the applicable bound.
The legacy single-use INR admission is not a new USD campaign budget.

Start each batch behind one barrier, not a serial request loop. Ordinary bot
requests still face the 20/minute/account limiter; a 100/1000-request run through
that route will mostly measure rate rejection. A separately authorized operator
runner must report its distinct scope and use an atomic bounded campaign, rather
than disabling the public limiter. Default transport capacity is 200 active per
process, with 1000 waiting and a 30-second queue timeout; the HTTP route deadline
is 60 seconds. A 1000-request client burst is not proof of 1000 concurrent upstream
requests. Measure actual concurrency, queueing, status, latency, retries and total
charges. Loopback mock timings establish no production capacity. Use only fixed
synthetic public text; never profile/history/health/payment/personal data.

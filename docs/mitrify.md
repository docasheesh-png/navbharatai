# Optional Mitrify transport: privacy-blocked for general chat

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
credential, cap configuration or inferred model price. No unlimited financial
execution is enabled. Ordinary free-form chat remains direct and is not claimed
complete through Mitrify. App Builder remains unchanged.

## Configuration and rollback

Server environment only; never use a `VITE_` prefix or ship a key to a client:

- `AI_BACKEND`: `direct` by default; `mitrify` remains blocked by the privacy boundary.
  All ordinary chat stays direct; only the separate fixed public test may request admission.
- `AI_PROVIDER`: legacy alias, consulted only when `AI_BACKEND` is unset/blank. An
  explicit `AI_BACKEND` always wins, including rollback to `direct`; conflicting
  aliases produce a metadata-only diagnostic. Invalid switch values stay direct.
- `MITRIFY_MAX_INFLIGHT`: defaults to 200; accepts integers 1–1000. Invalid explicit
  values fail configuration validation for the transport, never affect the direct path.
- `MITRIFY_BASE_URL`: defaults to `https://mitrify.com/v1`.
- `MITRIFY_API_KEY`: required for manual diagnostics; no default.
- `MITRIFY_MODEL`: defaults to `mitrify/auto-cheap`; the default is defined once in the module.
- `MITRIFY_CHAT_ACCOUNT_EMAIL`: no default; server-only verified-account selector for
  the isolated public test. It grants no cost admission and does not switch ordinary chat.

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
retried. SSE events are forwarded in order as complete events arrive; the full
answer is never buffered. `[DONE]` is required, and early EOF/error events throw an
explicit incomplete-answer error. Callers must render that error rather than mark a
partial reply complete. AbortSignal cancels network reads and retry waits. Future
route wiring must supply the existing response-disconnect signal and await writes
for downstream backpressure.

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

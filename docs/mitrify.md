# Optional Mitrify transport: privacy-blocked for general chat

This change provides a server-only OpenAI-compatible transport and offline tests.
It does **not** make arbitrary NavBharatAI chat eligible for Mitrify. By default, both ordinary
chat entry points retain their existing callback, quota, routing and billing behavior.
App Builder, Pro, Doctor/SDA, professionals, tools, JSON output, vision and embeddings
are unchanged. No credential or deployment settings are installed by this change.

## Privacy boundary

`routes/chat.ts` classifies general chat as health/clinical. A conversation may include
patient data, personal information, profile, memory, attachments and history. The
existing six-question public cache corpus proves only the question's content, not
the full outgoing system prompt. Its broader FAQ eligibility is not privacy proof.

By default, `withMitrifyChatPrivacyBoundary` therefore keeps **all current general chat direct**,
even with `AI_PROVIDER=mitrify`, and logs `MITRIFY_PRIVACY_BLOCKED`. No client flag,
keyword detector, missing profile or empty history bypasses this boundary. A future
review must establish trusted provenance for the whole request before connecting
the low-level transport. Do not downgrade the health classification to enable it.

An optional server-only `MITRIFY_CHAT_ACCOUNT_EMAIL` selects a single account for
**no-fallback** behavior when `AI_PROVIDER=mitrify`. Selection uses only a verified
Firebase token with a verified email; request-body claims never select an account.
Both general-chat endpoints then return HTTP 503 `CHAT_PRIVACY_BLOCKED` before
quota admission, prompt assembly, history/profile access or either provider chain.
The chat UI displays a privacy-policy pause. This is an explicit refusal, **not a
working Mitrify connection**. Unselected accounts keep their existing path.

No email value is stored in this repository or installed in production. Configuring
this selector would pause the selected account's general chat until whole-request
public provenance is established. A user's identity alone cannot authorize sending
their data. Removing the selector or setting `AI_PROVIDER=direct` restores the
existing path. Doctor/App Builder routes are not changed.

## Configuration and rollback

Server environment only; never use a `VITE_` prefix or ship a key to a client:

- `AI_PROVIDER`: `direct` by default; `mitrify` remains blocked by the privacy boundary.
  Unselected accounts stay direct; the optional selected verified account is refused.
- `MITRIFY_BASE_URL`: defaults to `https://mitrify.com/v1`.
- `MITRIFY_API_KEY`: required for manual diagnostics; no default.
- `MITRIFY_MODEL`: defaults to `mitrify/auto-cheap`; the default is defined once in the module.
- `MITRIFY_CHAT_ACCOUNT_EMAIL`: no default; optional verified account selector for the
  privacy-blocked, no-fallback behavior above. Do not enable expecting live chat.

Rollback: set `AI_PROVIDER=direct`. No deployment or key rotation is needed for this
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

Logs contain status, latency, attempt number, safe error code and the four requested
X-Mitrify headers. Credentials are redacted from these headers. **Deliberate safety
limitation:** arbitrary upstream error-message text is not logged or returned because
it can echo prompts or secrets. HTTP 400/other failures have a status and safe code;
401 is explicitly a configuration error. This prioritizes the no-content/no-secret
logging requirement over printing an untrusted provider's raw error message.

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

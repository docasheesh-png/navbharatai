# Optional Surplus client (server-only)

This is an isolated, opt-in utility using the project's existing official `openai`
TypeScript SDK. It does **not** enable a provider, alter production routes, change
Doctor/Builder/Free Chat, or touch the wallet. No new dependencies are needed for TS.
No live request has been made to validate credentials, account access or settlement.

## Local configuration

Add these lines to the existing local `.env` (do not replace unrelated settings):

```dotenv
SURPLUS_API_KEY=replace_with_your_surplus_api_key
SURPLUS_BASE_URL=https://api.surplusintelligence.ai/v1
SURPLUS_MODEL=deepseek-v4.1-flash
```

Keep `.env` out of git. Never use `VITE_SURPLUS_API_KEY` or import this helper in
browser code. A key is read only when you construct a helper, not at module import.
The CLI loads `.env` with dotenv; server callers must load their own environment.

## TypeScript usage

```ts
import { createSurplusChat, surplusChat, chatSurplus } from './src/server/lib/surplusClient';

// Call these only from explicitly authorized server-side code.
const chat = createSurplusChat();
const result = await chat('Hello!');
console.log(result.text);
// Provider-reported metadata, not an invoice or authority to debit a wallet:
console.log(result.usage?.buyer_cost_micro);

// Switch model per call, or set SURPLUS_MODEL to change the default.
const alternate = await chat('Hello!', { model: 'glm-5.3' });
// One-off convenience helper:
const textOnly = await chatSurplus('Hello!');
const oneOff = await surplusChat('Hello!', { model: 'deepseek-v4.1-flash' });
```

Model names must be available for your account. Official model pages currently list
`deepseek-v4.1-flash`, `glm-5.3`, `claude-opus-5.5`, and `gpt-5.6-luna`; availability
and price can change. Changing model is not a promise of identical capability.

## Explicit smoke request

```sh
node --import tsx scripts/surplus-smoke.ts --send
```

This sends one greeting and prints its text. It may incur a charge. Without `--send`,
the CLI exits without a request. Importing the smoke function also makes no request;
calling `runSurplusSmokeTest()` explicitly does. Unit tests mock all network traffic:

```sh
npx vitest run src/server/lib/surplusClient.test.ts
```

Requests default to 2,048 maximum output tokens; `maxTokens` can be set per call from
1 to 8,192. Input is limited to 128 messages / 64 KiB serialized. These are safety bounds,
not a monetary spending guarantee or a model-specific context-window check.

Each SDK request has a 60-second timeout and zero automatic retries. Aborting or timing
out does not prove the provider stopped or that no charge occurred. Errors are static,
sanitized `SurplusError` messages/codes without raw provider payloads or causes. HTTP
200 error envelopes are rejected before inspecting choices. Safe provider usage, when
present, is preserved on results and on HTTP 200 failure errors. Decimal cost strings
are retained exactly rather than parsed as floating-point numbers. The text-only
helper does not support streaming or tool calls and rejects empty/non-text responses.

## Optional minimum-discount route

```dotenv
SURPLUS_BASE_URL=https://api.surplusintelligence.ai/min30/v1
```

This is the documented path, **not** `/v1/min30`. It requests a minimum estimated 30%
discount relative to an external list-price reference. It is not a low-latency mode,
spending cap, guaranteed final saving, or guaranteed availability. Account policies and
buyer-owned routing can affect applicability. The helper never relaxes that floor or
falls back to a different provider after a failure. The standard `/v1` URL is default.
The documented `/min90/v1` endpoint is also explicitly allowed for a 90% estimated floor;
it does not activate the registry or change production routing. Only these three exact HTTPS endpoints (optionally with a trailing slash) are accepted;
redirects are refused to avoid forwarding a secret to an unintended destination.

## Optional Python example

The app is TypeScript; Python is a standalone sample, not a runtime dependency:

```sh
python -m pip install openai
# Export SURPLUS_API_KEY, SURPLUS_BASE_URL and SURPLUS_MODEL in your shell first.
# Python does not load .env automatically.
python examples/surplus/chat.py --send
```

Import `create_client` and `chat` from the sample; use `chat(client, 'Hello', model='glm-5.3')`
to switch models. This small sample returns text only; use the TS result/error usage
metadata for integration work. Do not use either sample as production accounting.

## Data and provider caveats

Surplus routes prompts to third-party sellers. Review its and the selected seller's
retention/terms before sending personal, confidential or medical data. Model labels
are not independently attested here; there is no 99% quality, uptime or cost guarantee.
No signup, purchase, credential configuration, billing or deployment is performed by
this change. Wiring the helper into a paid/live feature needs separate routing, budget,
privacy and accounting review.

Official references (checked 2026-10-24):
- https://www.surplusintelligence.ai/docs/marketplace/minimum-discount-routing
- https://www.surplusintelligence.ai/llms.txt

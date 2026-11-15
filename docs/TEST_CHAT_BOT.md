# Test Chat Bot

Open **Admin → AI Engines → Test Chat Bot**. This is a separate, reusable provider test surface with real text input and multi-turn context. It does not load, alter or save ordinary app conversations. The server-owned dropdown lists every text-chat provider adapter wired in NavBharatAI (chat-chain rungs, reviewed gateways, vision-capable text models, and named builder/pro engines). Selecting another provider starts a new conversation. Clients still cannot submit an endpoint, API key, tool, attachment or generation setting: they pick a server-defined provider id. An optional model field accepts only a short identifier (`letters`, numbers, and `.` `/` `:` `-`); leaving it blank uses the same cheapest-model selection as main chat.

## Read-only provider status

Opening the page or choosing **Refresh provider status** reads configuration and the
stored Qubax market/probe snapshot only. It does not refresh the external feed,
start a probe, reserve money or send inference. A missing or stale snapshot is not
proof that a provider is ready; displayed selection is informational, not send authority.
The scheduled collector and an explicit test send retain their existing refresh,
selection, budget and dispatch behavior. **Check Qubax balance** remains a separate
explicit account-metadata action.

This is the narrowed read-only diagnostic portion of the earlier admin-readiness
proposal. It does not introduce signed catalog/payload imports, new dispatch gates,
or a change to ordinary Chat or Qubax selection.

## Isolation

NavBharatAI calls only the selected provider; there is no fallback to another NavBharatAI provider. Qubax follows the same market auto-select as user chat and may try up to three of its own market-selected models after a failed try is released. Other listed providers make one call from this page. Some entries are gateways (Qubax, OpenRouter, Mitrify, Surplus, Router One) and may route internally among upstream sellers. A gateway response does not independently verify the underlying model. End-user chat routing, brand-hiding and error text are unchanged.

## Availability is not dispatch approval

The UI is usable for composing a message when a provider is unconfigured. Unconfigured or blocked entries appear in the dropdown as disabled, with a reason that does not name environment variables or reveal credentials. A configured status is **not** a successful connection check. Refreshing this page asks the server to collect the Qubax market (admin only, lease-limited). It does not send a chat.

When `QUBAX_ENABLED=1` and `QUBAX_API_KEY` are set, the server auto-selects a Qubax model from that market for both user chat and this admin page. The status line shows that model, its Qubax price, and its Qubax discount. The same payload includes freshness, priced rows, rows at a 90%+ Qubax discount, rows inside the try cap, and the probe-ready count. No `QUBAX_MODEL` or extra per-request cap has to be added: the reserve defaults to `$0.02` per try and still uses the shared paid budget. A failed try, including a reply in the wrong language, is released. After three failed models, user chat continues the normal chain; this admin page reports `tries-exhausted` and does not call another provider. Guest and signed-in daily answer quotas are unchanged.

Sending still uses the existing guards for that adapter:

- **Qubax:** the same `refreshQubaxPriceFeed` collector (on Send only, and only when `readQubaxMarketPlan` is empty) and the same `runApprovedQubaxChat` / `readQubaxMarketPlan` / `rankQubaxMarkets` ranking as user chat. The default `$0.02` (or `QUBAX_MAX_USD_PER_REQUEST`) reserve per try still applies, and the page may try up to three market-selected models. A typed model is used only when that shared plan is still empty; it does not write the shared model-switch ledger. If no model remains, the admin diagnostic includes feed freshness, priced-row counts and the last refresh status. The checkbox does not raise the cap. **Check Qubax balance** reads account metadata only and does not send a chat.
- **Mitrify:** dispatched through the shared `createMitrifyClient` whenever the server key is set. Mitrify’s public pilot documents only `GET /v1/models` and `POST /v1/chat/completions`, with `Authorization: Bearer mtf_live_...`. At send time this page fetches that live `/models` list (no completion call) with the same style of size cap as OpenRouter `catalogJson` (1 MB, tighter than 12 MB: reject an oversized `content-length`, stream the body, and abort once the cap is exceeded) and its own 12-second timeout, so a hung catalog cannot consume the 90-second send budget. It calls only a listed chat model: the cheapest row whose prompt and completion are both finite and greater than 0. Zero, `"0"`, negative values, and a mix where only one side is priced count as unpriced. Mitrify does not document whether catalog prices are USD per million tokens or per token, so a value below `$0.001`/MTok is treated as an untrusted per-token-looking price and the row is unpriced (no conversion). Image-like ids (`image`, `flux`, `sdxl`, `stable-diffusion`) are excluded unless the id also looks like chat/instruct/completion. If the catalog then has no usable prices, the page calls `mitrify/auto-cheap` only when that alias is listed; otherwise it fails closed and names the listed ids. It never falls through to an alphabetical listed id. A typed model is accepted only if that list contains it (and is priced when the catalog has prices). The shared client still overwrites `model` from its config, so the page passes the listed id as `MITRIFY_MODEL` for that one admin client only and does not change user-chat defaults. A send uses `stream: true` and the same reply token cap as main chat (`FREE_CHAIN_REPLY_MAX_TOKENS`, default 250, still bounded by this page’s 1,024). When catalog prices are present they are used for the shared-budget reserve; otherwise the conservative $1/MTok placeholder is used only for `mitrify/auto-cheap`. Existing daily and monthly caps still apply. This page does not require `MITRIFY_CHAIN_ENABLED`, does not flip that user-chat flag, and does not mint a payload approval. An HTTP 504 after a listed model is selected is a provider gateway time-out (often nginx in front of Mitrify), not a missing key.
- **OpenRouter verified-free:** enabled when the server key is set. When LiveRegistry is configured (`LIVE_MODEL_REGISTRY_ENABLED` plus `OPENROUTER_API_KEY`), a send uses `runRegistryRung` (and therefore `strictFreeText`) when `FREE_CHAIN_OPENROUTER_MODELS` is set, or `strictFreeText` without an allow-list when that list is empty — the same verified-free ranking as main chat. A typed model becomes the allow-list and preferred id; the registry still requires `VERIFIED_FREE`. If LiveRegistry is not configured, this page does not flip that user-chat flag. At send time it fetches OpenRouter’s public `/api/v1/models` catalog through the shared `catalogJson` helper and calls only a model whose catalog `pricing.prompt` and `pricing.completion` are 0 and whose id ends with `:free`. A typed model is accepted only when that live catalog lists it as free; priced models are never called. The reply names the chosen model. The official request also sets OpenRouter `max_price` to 0 with `allow_fallbacks: false`. User-chat OpenRouter still requires `LIVE_MODEL_REGISTRY_ENABLED` and, separately, a `FREE_CHAIN_OPENROUTER_MODELS` allow-list.
- **CheaperInference:** enabled when the server key is set, even if user-chat mode is `off` or shared-access. The adapter uses the same model string main chat would use (`CHEAPERINFERENCE_MODEL` or `beam`). This page does not change the user-chat sharing mode.
- **Paid Free Chat rungs** with a verified rate card: one reservation against the existing shared daily and monthly budget, using that card and this page’s 1,024 output-token bound.
- **Free rungs:** no paid reservation. Quota attestation used by user chat may be noted, but this page still calls only the selected provider when its credential is present.
- **Kimi, Claude and Grok:** reserved from the existing in-repo rate card, then one official HTTP/SDK call with a 1,024 token bound. This page does not use the builder adapters’ larger default output caps.
- **Router One (admin 2026-11-15):** enabled when `ROUTER_ONE_API_KEY` is set and the base URL is the official `https://api.router.one/v1` (a custom `ROUTER_ONE_BASE_URL` stays disabled here). The default model is the first priced model on the Router One path (`routerOneModels()`, skipping Router One’s own unpriced `auto` router); a typed model is used instead when given. At send time the page reads that model’s **posted public tariff** from router.one through `routerOnePublicPrices` — the same source the builder’s catalogue ranks on — and reserves the highest posted band for this page’s 1,024-token bound against the shared paid budget. Then it makes one official OpenAI-compatible call (`runOfficialOpenAiCompatTest`, no retry, no redirect). If no posted price can be read, it does not call and reports `ROUTER_ONE_PRICE_UNAVAILABLE`. As for Kimi/Claude/Grok, a dispatched hold stays reserved, because token usage is not a verified invoice.
- **Surplus:** listed so the admin can see configuration, but **not dispatched**. It has no verified per-request spending ceiling on this page, and its production transport retries. This page will not invent a cap or reuse that retry path.

Guest and signed-in daily answer quotas are unchanged. This route exposes no approval writer and does not change provider account settings. Typed content is conservatively treated as private and potentially health-related.

## Admin error details

If the selected provider returns no answer or an error, the admin-only response includes a redacted diagnostic: HTTP status, provider error code/type, a timeout vs network vs auth vs quota vs rate-limit classification, latency, provider and model id, request id when the provider returned one, and a truncated raw body/message. API keys, tokens, secrets, PEM material, AWS secret patterns, Google `AIza*` keys and environment-variable names are stripped before display. End-user chat errors stay brand-safe and do not use this payload.

When Qubax tries more than one market-selected model, the diagnostic lists each attempt (model, HTTP status, provider code, latency and redacted body) and the final outcome.

Mitrify raw error bodies are captured only when this page supplies an optional hook. User chat does not pass that hook and still cancels unread HTTP error bodies.

OpenRouter raw error bodies are **not** captured when this page uses the shared LiveRegistry dispatcher (the same path as user chat). Adding an admin-only body hook there would touch that user-chat path. The thrown HTTP status and error code are still shown. When LiveRegistry is not configured, the public-catalog fallback uses the admin official OpenAI-compat helper, which does capture a redacted body.

## Security, budgets and limits

- Three routes use the existing admin token middleware: GET `/api/v1/admin/test-chat-bot/providers`, POST `/api/v1/admin/test-chat-bot/chat`, and POST `/api/v1/admin/test-chat-bot/balance`. Compatibility URLs remain available under the existing API version middleware.
- Chat requests are exact-key validated: provider enum, UUID v4, disclosure confirmation, alternating user/assistant text messages ending in a user message, and an optional model id matching the safe identifier pattern. The balance route accepts only an empty JSON object.
- Per chat request: 8,000 characters for a typed message, 32,000 total context characters, 64 messages, and 1,024 output tokens. These are payload bounds, not a three-question or lifetime quota. Start a new test chat when context is full.
- The chat parser caps JSON at 256 KiB, including escaping. The balance route uses the standard 1 MB parser and rejects every caller field. Sends are limited to six per minute per client address, in addition to shared paid admission and provider capacity controls.
- The client prevents overlapping double-click sends, cancels on unmount/session change, allows stopping a wait, validates the response identity and never automatically retries a failed request. A cancelled or uncertain request may still incur provider cost.
- A request ID is reserved in the existing shared budget before paid dispatch. Duplicate daily claims do not authorize another call. If daily admission fails, only this attempt's fresh, undispatched monthly hold is released; an uncertain daily write is not cleared without a receipt. Known-unused pre-dispatch holds (official URL/key rejected before any network call, or a paid adapter configuration error before dispatch, including Gemini Flash which reserves an official hold then dispatches through its allowlisted compat adapter) are released; possible dispatched cost stays reserved because token usage is not a verified invoice.
- Prompts/replies are held in component memory and transmitted only for the explicitly requested test. They are not written to browser storage, app chat history or the audit trail. Audit entries contain operation metadata only. Balance audits record status, not the balance amount.

## Out of scope

Image-only, voice-only and non-AI service APIs are not chat adapters and are not listed. Vertex AI has no isolated text-test adapter on this page (it uses the server Google identity). Surplus is listed but not called, for the spending-ceiling reason above.

## Offline validation

The focused tests mock adapters and exercise only local HTTP servers. They do not make paid inference calls:

```sh
npx vitest run src/lib/testChatBot.test.ts src/server/lib/testChatBot.test.ts src/server/lib/testChatBotDiagnostics.test.ts src/server/lib/testChatBotOfficial.test.ts src/server/routes/testChatBot.test.ts src/components/admin/TestChatBotPanel.test.tsx tests/theAdminMenuHasNineTabs.test.ts tests/aRequestBodyIsOnlyAsLargeAsItsRouteNeeds.test.ts tests/adminActionsNeedAReason.test.ts tests/adminTestChatDoesNotChangeUserChat.test.ts src/server/AI/FreeChain/providers/openAiCompatProvider.test.ts
```

Run the repository's full required CI gates separately. A mock response is not evidence of live credentials, pricing, approval, model quality or production readiness.

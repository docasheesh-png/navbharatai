# Test Chat Bot

Open **Admin → AI Engines → Test Chat Bot**. This is a separate, reusable provider test surface with real text input and multi-turn context. It does not load, alter or save ordinary app conversations. The server-owned dropdown lists every text-chat provider adapter wired in NavBharatAI (chat-chain rungs, reviewed gateways, vision-capable text models, and named builder/pro engines). Selecting another provider starts a new conversation. Clients still cannot submit an endpoint, API key, tool, attachment or generation setting: they pick a server-defined provider id. An optional model field accepts only a short identifier (`letters`, numbers, and `.` `/` `:` `-`); leaving it blank uses the same cheapest-model selection as main chat.

## Isolation

NavBharatAI calls only the selected provider; there is no fallback to another NavBharatAI provider. Qubax follows the same market auto-select as user chat and may try up to three of its own market-selected models after a failed try is released. Other listed providers make one call from this page. Some entries are gateways (Qubax, OpenRouter, Mitrify, Surplus, Router One) and may route internally among upstream sellers. A gateway response does not independently verify the underlying model. End-user chat routing, brand-hiding and error text are unchanged.

## Availability is not dispatch approval

The UI is usable for composing a message when a provider is unconfigured. Unconfigured or blocked entries appear in the dropdown as disabled, with a reason that does not name environment variables or reveal credentials. A configured status is **not** a successful connection check. No network call is made by opening or refreshing the page.

When `QUBAX_ENABLED=1` and `QUBAX_API_KEY` are set, the server auto-selects a Qubax model from the live price feed for both user chat and this admin page. The status line shows that model, its Qubax price, and how far it sits below the official price. The same payload can include a Qubax price-feed summary (freshness, priced rows, official name matches, discount-eligible rows, and probe-ready count), which this page shows without shrinking the provider list. No `QUBAX_MODEL` or extra per-request cap has to be added: the reserve defaults to `$0.02` per try and still uses the shared paid budget. A failed try is released. After three failed models, user chat continues the normal chain; this admin page reports `tries-exhausted` and does not call another provider. Guest and signed-in daily answer quotas are unchanged.

Sending still uses the existing guards for that adapter:

- **Qubax:** the same `refreshQubaxPriceFeed` collector (on Send only, and only when `readQubaxMarketPlan` is empty) and the same `runApprovedQubaxChat` / `readQubaxMarketPlan` / `rankQubaxMarkets` ranking as user chat. The default `$0.02` (or `QUBAX_MAX_USD_PER_REQUEST`) reserve per try still applies, and the page may try up to three market-selected models. A typed model is used only when that shared plan is still empty; it does not write the shared model-switch ledger. If no model remains, the admin diagnostic includes feed freshness, priced-row counts and the last refresh status. The checkbox does not raise the cap. **Check Qubax balance** reads account metadata only and does not send a chat.
- **Mitrify:** dispatched through the shared `createMitrifyClient` (gateway model `MITRIFY_MODEL` or `mitrify/auto-cheap`) whenever the server key is set. This page does not require `MITRIFY_CHAIN_ENABLED`, does not flip that user-chat flag, and does not mint a payload approval. There is no verified Mitrify invoice on this page; a conservative shared-budget hold using $1/MTok is reserved and unused configuration errors are released.
- **OpenRouter verified-free:** enabled when the server key is set. A send uses `runRegistryRung` (and therefore `strictFreeText`) when `FREE_CHAIN_OPENROUTER_MODELS` is set, or `strictFreeText` without an allow-list when that list is empty — the same LiveRegistry verified-free ranking as main chat. A typed model becomes the allow-list and preferred id; the registry still requires `VERIFIED_FREE`.
- **CheaperInference:** enabled when the server key is set, even if user-chat mode is `off` or shared-access. The adapter uses the same model string main chat would use (`CHEAPERINFERENCE_MODEL` or `beam`). This page does not change the user-chat sharing mode.
- **Paid Free Chat rungs** with a verified rate card: one reservation against the existing shared daily and monthly budget, using that card and this page’s 1,024 output-token bound.
- **Free rungs:** no paid reservation. Quota attestation used by user chat may be noted, but this page still calls only the selected provider when its credential is present.
- **Kimi, Claude and Grok:** reserved from the existing in-repo rate card, then one official HTTP/SDK call with a 1,024 token bound. This page does not use the builder adapters’ larger default output caps.
- **Surplus and Router One:** listed so the admin can see configuration, but **not dispatched**. They have no verified per-request spending ceiling on this page, and Surplus’s production transport retries. This page will not invent a cap or reuse that retry path.

Guest and signed-in daily answer quotas are unchanged. This route exposes no approval writer and does not change provider account settings. Typed content is conservatively treated as private and potentially health-related.

## Admin error details

If the selected provider returns no answer or an error, the admin-only response includes a redacted diagnostic: HTTP status, provider error code/type, a timeout vs network vs auth vs quota vs rate-limit classification, latency, provider and model id, request id when the provider returned one, and a truncated raw body/message. API keys, tokens, secrets, PEM material, AWS secret patterns, Google `AIza*` keys and environment-variable names are stripped before display. End-user chat errors stay brand-safe and do not use this payload.

When Qubax tries more than one market-selected model, the diagnostic lists each attempt (model, HTTP status, provider code, latency and redacted body) and the final outcome.

Mitrify raw error bodies are captured only when this page supplies an optional hook. User chat does not pass that hook and still cancels unread HTTP error bodies.

OpenRouter raw error bodies are **not** captured here. Verified-free OpenRouter inference goes through the shared LiveRegistry dispatcher used by user chat; adding an admin-only body hook there would touch that user-chat path. The thrown HTTP status and error code are still shown.

## Security, budgets and limits

- Three routes use the existing admin token middleware: GET `/api/v1/admin/test-chat-bot/providers`, POST `/api/v1/admin/test-chat-bot/chat`, and POST `/api/v1/admin/test-chat-bot/balance`. Compatibility URLs remain available under the existing API version middleware.
- Chat requests are exact-key validated: provider enum, UUID v4, disclosure confirmation, alternating user/assistant text messages ending in a user message, and an optional model id matching the safe identifier pattern. The balance route accepts only an empty JSON object.
- Per chat request: 8,000 characters for a typed message, 32,000 total context characters, 64 messages, and 1,024 output tokens. These are payload bounds, not a three-question or lifetime quota. Start a new test chat when context is full.
- The chat parser caps JSON at 256 KiB, including escaping. The balance route uses the standard 1 MB parser and rejects every caller field. Sends are limited to six per minute per client address, in addition to shared paid admission and provider capacity controls.
- The client prevents overlapping double-click sends, cancels on unmount/session change, allows stopping a wait, validates the response identity and never automatically retries a failed request. A cancelled or uncertain request may still incur provider cost.
- A request ID is reserved in the existing shared budget before paid dispatch. Duplicate daily claims do not authorize another call. If daily admission fails, only this attempt's fresh, undispatched monthly hold is released; an uncertain daily write is not cleared without a receipt. Known-unused pre-dispatch holds (official URL/key rejected before any network call, or a paid adapter configuration error before dispatch, including Gemini Flash which reserves an official hold then dispatches through its allowlisted compat adapter) are released; possible dispatched cost stays reserved because token usage is not a verified invoice.
- Prompts/replies are held in component memory and transmitted only for the explicitly requested test. They are not written to browser storage, app chat history or the audit trail. Audit entries contain operation metadata only. Balance audits record status, not the balance amount.

## Out of scope

Image-only, voice-only and non-AI service APIs are not chat adapters and are not listed. Vertex AI has no isolated text-test adapter on this page (it uses the server Google identity). Surplus and Router One are listed but not called, for the spending-ceiling reason above.

## Offline validation

The focused tests mock adapters and exercise only local HTTP servers. They do not make paid inference calls:

```sh
npx vitest run src/lib/testChatBot.test.ts src/server/lib/testChatBot.test.ts src/server/lib/testChatBotDiagnostics.test.ts src/server/routes/testChatBot.test.ts src/components/admin/TestChatBotPanel.test.tsx tests/theAdminMenuHasNineTabs.test.ts tests/aRequestBodyIsOnlyAsLargeAsItsRouteNeeds.test.ts tests/adminActionsNeedAReason.test.ts tests/adminTestChatDoesNotChangeUserChat.test.ts src/server/AI/FreeChain/providers/openAiCompatProvider.test.ts
```

Run the repository's full required CI gates separately. A mock response is not evidence of live credentials, pricing, approval, model quality or production readiness.

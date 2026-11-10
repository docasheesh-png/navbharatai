# Test Chat Bot

Open **Admin → AI Engines → Test Chat Bot**. This is a separate, reusable provider test surface with real text input and multi-turn context. It does not load, alter or save ordinary app conversations. The server-owned dropdown lists every text-chat provider adapter wired in NavBharatAI (chat-chain rungs, reviewed gateways, vision-capable text models, and named builder/pro engines). Selecting another provider starts a new conversation. Clients still cannot submit an endpoint, API key, model, tool, attachment or generation setting: they pick a server-defined id only.

## Isolation

NavBharatAI makes one request to the selected provider or model only, with no automatic retry and no other NavBharatAI provider fallback. Some entries are gateways (Qubax, OpenRouter, Mitrify, Surplus, Router One) and may route internally among upstream sellers. A gateway response does not independently verify the underlying model. End-user chat routing, brand-hiding and error text are unchanged.

## Availability is not dispatch approval

The UI is usable for composing a message when a provider is unconfigured. Unconfigured or blocked entries appear in the dropdown as disabled, with a reason that does not name environment variables or reveal credentials. A configured status is **not** a successful connection check. No network call is made by opening or refreshing the page.

Sending still uses the existing guards for that adapter:

- **Qubax:** owner switch (`QUBAX_ENABLED=1`, credential, model and per-request cap) or the older exact-payload approval path. The checkbox does not raise the cap.
- **Mitrify:** the existing exact-payload approval and supplier-enforced ceiling. This page does not mint that approval.
- **Paid Free Chat rungs** with a verified rate card: one reservation against the existing shared daily and monthly budget, using that card and this page’s 1,024 output-token bound.
- **Free rungs:** no paid reservation. Quota attestation used by user chat may be noted, but this page still calls only the selected provider when its credential is present.
- **Kimi, Claude and Grok:** reserved from the existing in-repo rate card, then one official HTTP/SDK call with a 1,024 token bound. This page does not use the builder adapters’ larger default output caps.
- **Surplus and Router One:** listed so the admin can see configuration, but **not dispatched**. They have no verified per-request spending ceiling on this page, and Surplus’s production transport retries. This page will not invent a cap or reuse that retry path.

Guest and signed-in daily answer quotas are unchanged. This route exposes no approval writer and does not change provider account settings. Typed content is conservatively treated as private and potentially health-related.

## Admin error details

If the selected provider returns no answer or an error, the admin-only response includes a redacted diagnostic: HTTP status, provider error code/type, a timeout vs network vs auth vs quota vs rate-limit classification, latency, provider and model id, request id when the provider returned one, and a truncated raw body/message. API keys, tokens, secrets and environment-variable names are stripped before display. End-user chat errors stay brand-safe and do not use this payload.

## Security, budgets and limits

- Both routes use the existing admin token middleware: GET `/api/v1/admin/test-chat-bot/providers` and POST `/api/v1/admin/test-chat-bot/chat`. Compatibility URLs remain available under the existing API version middleware.
- Requests are exact-key validated: provider enum, UUID v4, disclosure confirmation and alternating user/assistant text messages ending in a user message.
- Per request: 8,000 characters for a typed message, 32,000 total context characters, 64 messages, and 1,024 output tokens. These are payload bounds, not a three-question or lifetime quota. Start a new test chat when context is full.
- The parser caps JSON at 256 KiB, including escaping. Sends are limited to six per minute per client address, in addition to shared paid admission and provider capacity controls.
- The client prevents overlapping double-click sends, cancels on unmount/session change, allows stopping a wait, validates the response identity and never automatically retries a failed request. A cancelled or uncertain request may still incur provider cost.
- A request ID is reserved in the existing shared budget before paid dispatch. Duplicate daily claims do not authorize another call. If daily admission fails, only this attempt's fresh, undispatched monthly hold is released; an uncertain daily write is not cleared without a receipt. Known-unused holds can be released; possible dispatched cost stays reserved because token usage is not a verified invoice.
- Prompts/replies are held in component memory and transmitted only for the explicitly requested test. They are not written to browser storage, app chat history or the audit trail. Audit entries contain operation metadata only.

## Out of scope

Image-only, voice-only and non-AI service APIs are not chat adapters and are not listed. Vertex AI has no isolated text-test adapter on this page (it uses the server Google identity). Surplus and Router One are listed but not called, for the spending-ceiling reason above.

## Offline validation

The focused tests mock adapters and exercise only local HTTP servers. They do not make paid inference calls:

```sh
npx vitest run src/lib/testChatBot.test.ts src/server/lib/testChatBot.test.ts src/server/lib/testChatBotDiagnostics.test.ts src/server/routes/testChatBot.test.ts src/components/admin/TestChatBotPanel.test.tsx tests/theAdminMenuHasNineTabs.test.ts tests/aRequestBodyIsOnlyAsLargeAsItsRouteNeeds.test.ts tests/adminActionsNeedAReason.test.ts tests/adminTestChatDoesNotChangeUserChat.test.ts src/server/AI/FreeChain/providers/openAiCompatProvider.test.ts
```

Run the repository's full required CI gates separately. A mock response is not evidence of live credentials, pricing, approval, model quality or production readiness.

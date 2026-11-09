# Test Chat Bot

Open **Admin → AI Engines → Test Chat Bot**. This is a separate, reusable provider test surface with real text input and multi-turn context. It does not load, alter or save ordinary app conversations. The initial server-owned provider registry contains **Qubax only**. Selecting a future provider must start a new conversation; adding it requires a reviewed server adapter, corresponding type/validation entry and isolation tests. Clients cannot submit an endpoint, API key, model, tool, attachment or generation setting.

## What “Qubax only” means

NavBharatAI makes one request to the Qubax gateway, with no automatic retry and no other NavBharatAI provider fallback. Qubax itself may select and fail over among upstream sellers. Its reported model name is not independent proof of the underlying model. The UI explicitly distinguishes that boundary and links its privacy policy.

References checked 2026-11-09:

- https://qubax.ai/docs/chat-completions
- https://qubax.ai/docs/routing-modes
- https://qubax.ai/legal/privacy

## Availability is not dispatch approval

The UI is usable for composing a message when Qubax is unconfigured. Sending remains disabled until the server has QUBAX_ENABLED=1 and a credential. A configured status is **not** a successful connection check or permission to infer. No network call is made by opening/refreshing the page.

The adapter still requires a current independently reviewed catalog, exact-payload disclosure approval, reviewed downstream processors, a supplier-enforced monetary ceiling covering its internal retries/failovers/fees, and the existing shared daily/monthly budget. No approval, supplier contract or credential is manufactured by this page. The checkbox confirms the intended destination for this submission; it does not mint disclosure or spend authority. If any prerequisite is missing the request fails closed and the UI says so.

The adapter's exact review UID is `admin-test-chat:` followed by the SHA-256 of the server-derived admin username. The wire body before the adapter selects its reviewed model is:

```json
{"messages":[{"role":"user","content":"The exact synthetic test text"}],"max_tokens":1024,"stream":false}
```

The entire visible history is part of that payload on later turns. Use the adapter's `qubaxChatBinding` for the actual selected model, credential and selection snapshot. Typed content is conservatively treated as private and potentially health-related; a checkbox or text classifier cannot downgrade it to public. Existing approval tools/workflows must review those classes. This route exposes no approval writer and does not change provider account settings.

## Security, budgets and limits

- Both routes use the existing admin token middleware: GET `/api/v1/admin/test-chat-bot/providers` and POST `/api/v1/admin/test-chat-bot/chat`. Compatibility URLs remain available under the existing API version middleware.
- Requests are exact-key validated: provider enum, UUID v4, disclosure confirmation and alternating user/assistant text messages ending in a user message.
- Per request: 8,000 characters for a typed message, 32,000 total context characters, 64 messages, and 1,024 output tokens. These are payload bounds, not a three-question or lifetime quota. Start a new test chat when context is full.
- The parser caps JSON at 256 KiB, including escaping. Sends are limited to six per minute per client address, in addition to shared paid admission and provider capacity controls.
- The client prevents overlapping double-click sends, cancels on unmount/session change, allows stopping a wait, validates the response identity and never automatically retries a failed request. A cancelled or uncertain request may still incur provider cost.
- A request ID is reserved in the existing shared budget before dispatch. Duplicate daily claims do not authorize another call. If daily admission fails, only this attempt's fresh, undispatched monthly hold is released; an uncertain daily write is not cleared without a receipt. Known-unused holds can be released; possible dispatched cost stays reserved because token usage is not a verified invoice.
- Prompts/replies are held in component memory and transmitted only for the explicitly requested test. They are not written to browser storage, app chat history or the audit trail. Audit entries contain operation metadata only. Qubax/upstream data retention is governed by their policies, not by this local no-history behavior.
- Output is rendered as plain text. Model HTML/code is not executed, and raw provider errors are never returned to the browser.

## Offline validation

The focused tests mock the Qubax adapter and exercise only local HTTP servers. They do not make paid inference calls:

```sh
npx vitest run src/lib/testChatBot.test.ts src/server/lib/testChatBot.test.ts src/server/routes/testChatBot.test.ts src/components/admin/TestChatBotPanel.test.tsx tests/theAdminMenuHasNineTabs.test.ts tests/aRequestBodyIsOnlyAsLargeAsItsRouteNeeds.test.ts tests/adminActionsNeedAReason.test.ts
```

Run the repository's full required CI gates separately. A mock response is not evidence of live Qubax credentials, pricing, approval, model quality or production readiness.

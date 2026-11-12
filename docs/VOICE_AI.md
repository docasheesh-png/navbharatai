# NavBharatAI Voice AI

Standalone text-to-speech in the AI chat mode picker, after Image Generator AI and before Teacher AI. It does not alter Pro/App Builder, chat fallback chains or existing live voice conversations.

## Activation and billing

Disabled by default. Review the provider account price, effective supplier tax and processing terms; configure the server-only variables in ENV_REGISTRY, then enable. The provider master switch and platform maintenance also apply. Only after an explicit wallet reservation does this paid feature dispatch in its own paid-voice scope; free-module routing and policy are unchanged. The UI is white-label and discloses that text goes to an external speech service; it makes no claim of zero retention or first-party model ownership. No deployment, key creation or paid test is implied by this change.

The user sees an exact character-based wallet quote and explicitly presses Generate. The server revalidates that quote using its current configuration. Price is twice configured effective supplier cost, expressed to six decimal places without a minimum fee. For example, configured ₹1/1,000 characters with 18% effective supplier tax produces ₹2.36/1,000 as the user rate. This example is not verification of an account's tax treatment. Actual provider invoices, Unicode billing definition and current rates must be checked before activation; provider billing may differ from estimates. No free allowance is assumed.

The operation ID, wallet hold and local account rate reservation are committed atomically. The temporary hold rounds to a whole token (up to the next paise), then successful settlement atomically releases it and debits the exact quoted fee using the existing fractional-token carry. The ceiling is not charged as a minimum fee. A repeated request ID never creates a second request or charge. Requests are restricted to signed-in accounts, valid voice/language choices, 2,500 codepoints, current wallet funds and existing safety policies. There is exactly one provider HTTP request, with no automatic retries or alternate vendors.

Voice uses the existing single-wallet funding rules. Ordinary gifted credits can pay when the free program is LIVE, including a gift-only account with no previous purchase. They are unavailable while the program is paused; purchased funds remain usable. Protected admin-issued build-only credits cannot pay for Voice in either state. Each request reads the shared free-program policy before reservation, including on a cold server, and applies its fail-closed result. This does not create a Voice free allowance or override the program switch. Refunds restore the original funding provenance; fractional charges retain the shared carry rather than consuming a minimum paise.

## Failure recovery

A rejected/failed/cancelled request refunds its hold. A generated response has a 120-second server flush deadline so a stalled client cannot retain the audio buffer indefinitely. Settlement follows successful server HTTP response completion, which does not prove that a device saved or played the sound. If the process crashes while a hold remains pending, the bounded scheduled reconciler releases expired holds after four minutes. Consequently an ambiguous delivery may be free to the user at platform expense. Recovery does not retry inference or regenerate audio. Completion and recovery transact against the same operation/wallet records, preventing duplicate settlement/refund.

Operation tombstones contain identifiers, fee and timestamps, not text/audio/credentials. They remain to prevent request replay; no TTL is applied. A corrupt record is audited rather than guessed into a refund. Refund failures remain visible for administrator investigation. The generic single-wallet ledger records the Voice AI feature; per-feature spend telemetry is best-effort.

The retention inventory classifies these operations as financial records, including their user and canonical-wallet identifiers. They survive account deletion like existing payment/refund evidence, rather than being described as anonymous platform data. Pending rows must remain recoverable and terminal rows must continue blocking replay; any future archive or de-identification requires a reviewed replacement for both guarantees. The separate admission control is one replaced-in-place document containing only a minute bucket and count.

Account erasure transactionally retains a wallet with unresolved reservations (including non-voice holds) and reports that financial exception, while the existing profile/Auth deletion flow remains unchanged. Refund recovery can still credit that retained wallet after sign-in removal. Its later erasure requires a separate reconciliation/deletion step; the recovery job does not claim to complete account erasure. A settled wallet remains eligible for normal account erasure, and unrelated profile data is not retained by this protection.

## Data and isolation

Text is processed in request memory and sent to the fixed reviewed HTTPS speech endpoint. It is not written to application operation records or logs. Generated WAV is returned to the authenticated requester; no public bucket or persisted audio link is created. Browser drafts and audio are in-memory, isolated by signed-in account and window; users must download audio before leaving. This does not assert provider-side retention is zero. Provider secrets never enter frontend config or errors. Redirects and caller-supplied endpoints/models are refused. Responses are bounded and PCM WAV structure validated.

## Operational limits

The local durable counter permits up to 50 dispatch reservations per fixed minute, leaving headroom under the published PAYG 60/min allowance. It does not account for other services sharing the credential and does not assert upstream remaining quota. Per-user anti-abuse rate limiting also applies. A timeout can stop local waiting but cannot prove the provider stopped or waived billing. No automatic retry is permitted after ambiguous completion.

## Rollback

Set VOICE_AI_ENABLED to 0 or switch the speech provider OFF. Keep the refund recovery job running so pending holds are refunded. Revert only the feature PR after all holds have settled/recovered; do not delete user wallet or operation records. No existing project files or build sandboxes are changed.

## Verification status

Local mock tests are distinct from paid provider verification. Do not describe the feature as live, provider-tested, CI-approved or merged until corresponding evidence exists. Deployment requires reviewed configuration and a separately authorized minimal paid smoke test. Retain test results and exact commit in the PR.

## Provider references reviewed 2026-11-09

- REST schema: https://docs.sarvam.ai/api-reference/text-to-speech/convert
- Persona/language mapping: https://docs.sarvam.ai/api/api-guides-tutorials/text-to-speech/voices
- Public pricing (not an account invoice): https://docs.sarvam.ai/api/getting-started/pricing
- Terms and attribution/provenance obligations: https://www.sarvam.ai/terms-of-service and https://www.sarvam.ai/eula
- Provider processing/retention disclosure: https://www.sarvam.ai/privacy-policy

The public reference recommends bulbul:v4-flash for new integrations. The implementation explicitly pins that model and requests language_code, the matching persona, WAV and 22,050 Hz. It validates the returned uncompressed WAV rather than assuming an undocumented bit depth. Public documentation is not proof of actual account credits, contractual retention settings, or production call success.

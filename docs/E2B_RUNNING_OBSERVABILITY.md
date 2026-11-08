# Running sandbox observation limits

The admin monitor reuses the existing E2B running-only list read, with at most five pages and existing per-page timeouts. It makes no additional provider calls and does not read paused machines, workspace content or per-machine details. The scope is the configured provider account, not every account or deployment. Pagination is not an atomic snapshot; a truncated read is partial, and failed or malformed pages make the result unknown.

The installed E2B SDK 2.50.0 list paginator drops `lifecycle`, even when a raw list response includes it. Its `getInfo` mapping is different. Consequently the current adapter can measure running count but cannot measure pause-on-timeout versus kill-on-timeout counts: all listed running policies are unknown. Zero in a reported-policy bucket means no explicit policies were received, not that no such machines exist. The UI says this directly rather than showing misleading zero policy totals.

The pure helper accepts explicit policy fields for adapters that actually provide them. The installed-SDK contract test executes the unmodified paginator against an in-memory response containing both policies, proves they are dropped, and verifies the final note remains unknown. Its isolated Node realm exposes only a fake credential, empty environment and in-memory fetch; optional native transports are unavailable, exercising the SDK's fetch fallback without any network.

No per-machine `getInfo` expansion, provider state mutation, recovery guarantee or measured savings claim is part of this change. Timeout policy alone would not prove saved-workspace recovery even if it were available. Any future richer read needs a separate scoped review, bounds, latency/cost review and tests.

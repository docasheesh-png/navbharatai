# Live free inference registry

This is an additive, opt-in server feature. It is not a claim that every feature,
sandbox, database, hosting service, or third-party tool is free. All Pro App Builder tiers, including Weak, remain outside this free-only policy.
The formerly merged Weak option was retired at the owner’s request on 2026-10-23.

## Operator switches (Cloud Run environment variables)

- `LIVE_MODEL_REGISTRY_ENABLED=on`: enable public/account catalog synchronization.
- `STRICT_FREE_MODULES_ENABLED=on`: use verified free inference for the explicitly
  scoped NavBharat Free and professional routes. Unsupported media/voice/search
  capabilities fail closed or use documented deterministic guidance; they never
  silently invoke a paid fallback. The existing owner-funded image-generation daily allowance is an explicit exception requested by the owner; it keeps its existing provider chain and quota.
- `STRICT_FREE_WEAK_ENABLED`: retired and ignored, even if an older Cloud Run
  revision configuration still supplies `on`. Weak uses its original builder ladder,
  judges, admission and billing behavior; no free registry option remains.
- `OPENROUTER_API_KEY`: existing server secret for account catalog and inference.
  Do not put it in the frontend. Provisioning or expanding credentials is a
  separate operator-authorized setup action.
- `LIVE_MODEL_SYNC_INTERVAL_MS`: 300000 default, bounded 60000–3600000.
- `LIVE_MODEL_METADATA_TTL_MS`: 600000 default, bounded 60000–3600000.
- `FREE_CHAT_HEDGE_ENABLED=on`: optional two-candidate delayed racing only for the explicit chat response, never professional helpers or builder tools. Default off.
- `FREE_CHAT_HEDGE_DELAY_MS`: 1500 default, bounded 100–10000.

All switches default off. Turning a strict switch **off restores the previous
routing policy, which can use paid providers**. It is not a stop-all-spending
switch. To fail closed while disabling registry work, leave the applicable strict
switch on and turn the registry master off. Prefer the existing AI maintenance
control to pause product traffic during incident response.

The requested first-time ₹1000, weekly ₹100, and referral allowances are NOT
issued by this feature. They require a separate, correctly valued service-credit
policy; zero provider inference cannot be arbitrarily marked up as an invented
provider cost. Existing gift-program and hosting-wallet controls are not globally
unpaused.

## Background operation

`server.ts` registers `live-model-registry` with the existing `ScheduledJobs`
engine and performs a startup sync attempt. The job is part of the existing
`POST /api/internal/scheduler-tick` durable catch-up flow, so the deployment's
Cloud Scheduler job can wake Cloud Run at scale-to-zero. Verify that external
scheduler is actually configured, enabled and authenticated in the deployed
project; an in-process timer alone is not an always-on scheduler.

The registry job bypasses the scheduler's generic 10-minute fail-open lease and
uses its own 120-second fail-closed transaction/fencing token. Fetch work is
bounded at 90 seconds. Concurrent manual/startup/scheduled calls single-flight
within one process and contend on the same durable lease across replicas. An
expired or replaced writer cannot publish. Registry import failure does not stop
existing unrelated scheduled jobs.

The public catalog is fetched without pagination parameters: the current official
contract returns the complete list when both offset and limit are omitted.
`total_count` and `links.next`, when supplied, are validated. An incomplete,
duplicate, empty, oversized or malformed public catalog does not replace the
last successful generation. An empty account-filtered catalog is valid and
removes account eligibility. Authentication failure is not a free eligibility
proof. HTTP 429 Retry-After is persisted as a next-allowed-sync time; bounded
backoff applies only to retryable HTTP errors.

## What verifies free inference

Official sources used for the implementation:

- https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties
- https://openrouter.ai/docs/api/api-reference/models/list-models-filtered-by-user-provider-preferences-privacy-settings-and-guardrails
- https://openrouter.ai/docs/guides/providers/integration#free-model-variants-with-is-free
- https://openrouter.ai/docs/guides/routing/provider-selection
- https://openrouter.ai/docs/guides/features/tool-calling
- https://openrouter.ai/docs/cookbook/administration/usage-accounting

The adapter requires zero input/output prices in fresh public metadata, membership
with zero token prices in the account-filtered catalog, exact model endpoint
metadata, compatible text limits/capabilities and an unexpired administrator
intended-use terms review bound to the selected endpoint. `:free` alone never
suffices. The documented free-variant contract covers omitted non-billed SKUs only
for verified exact free variants; missing prices are preserved as missing, not
rewritten as API-returned zero. Other zero-token models require explicit zero
applicable per-request/cache fees. Nonempty conditional price overrides and
contradictory applicable nonzero fees remain unknown/paid and blocked.

Price comparisons use validated decimal strings, not Number coercion. A tiny
positive or malformed number never underflows into an eligible zero.

Every inference attempt rechecks the active durable version, terms/disable
control, cooldown and freshness. Requests pin the exact endpoint, disable
provider fallbacks, require supported parameters, deny data collection, and set
zero provider-side max-price caps. Text envelopes exclude media/plugins/server
search. Builder function tools are server-owned definitions, not provider-native
billable tools; their actual execution retains existing sandbox/permission gates.
No prompt or client-chosen model overrides the server decision.

Public metadata and account filtering do not prove remaining quota, quality,
latency, or every model's handling of system instructions. A provider can change
between the last gate and receiving a request. Polling and max-price controls are
defense in depth, not a mathematical guarantee about a third party's invoice.

## Failure and accounting behavior

At most three sequential model attempts are made. Invalid/auth/account-credit
failures do not spray every model. Account auth/credit failures enter an account
cooldown; 429 is a temporary rate limit, not evidence of paid pricing. Timeouts
abort upstream requests. Partial streamed text is never transparently restarted;
an unterminated stream is interrupted, not marked complete. A successful answer
is not reissued merely because post-result telemetry storage failed.

Positive reported cost or an unexpected response model identity quarantines the
model, independently of catalog-version changes. The exact requested ID or canonical_slug from the same fresh catalog row is accepted as the response identity; outbound dispatch never switches to the canonical alias. A local quarantine remains if
the durable write fails, but cross-replica quarantine cannot be guaranteed while
storage writes are unavailable. Investigate the structured failure record before
resuming. Provider-reported cost and zero-price estimates remain separate.

In-process branded pricing proofs bind model and measured token usage to a
verified zero-price snapshot. Client JSON lookalikes and serialized copies do not
create a new trusted proof. Historical logs should use their stored measured cost
or an independently reconciled snapshot, not rerun the live proof-brand check.

## Storage and administration

Uses the existing server-admin Firestore database, not a parallel database.
`live_ai_registry/openrouter` holds the active manifest, lease and account state.
Content-addressed chunks are capped well below Firestore's 1MiB document limit;
unchanged catalog contents reuse chunk identities. No per-model rewrite is made
on every five-minute tick. The routing selection cache is short-lived, while the
final authorization uses durable point reads, never just the cache.

Controls are independent of snapshots so refresh cannot undo an admin disable.
The admin view is under AI Engines → Live Models. All endpoints use the existing
admin-token verification and explicit rate limits. Terms approval has a maximum
seven-day lifetime and requires a current registry version and review reason; it
is not an external agreement acceptance and never overrides a paid price.

The admin view shows the latest 30 of a bounded 288-slot sync-history ring and
up-to-4096-slot sampled routing-event cache. Hash collisions can replace older samples before capacity is reached; structured sanitized routing events are also emitted to deployment logs. These are bounded operational histories, not a
permanent compliance archive. Content chunks and manual action records are
retained; a separate retention policy is needed for long-term pruning. Logs do
not contain prompts, authorization headers or API keys.

## Deployment verification checklist

Do not call the feature live solely because tests pass locally.

1. Run focused deterministic tests, all project type-checks, build and final CI.
2. Verify exact deployed commit and existing Firestore/admin configuration.
3. Configure existing OpenRouter secret without exposing it. Verify provider
   privacy settings and applicable terms; do not create credentials silently.
4. Turn on registry synchronization first, with strict route switches still off.
5. Verify a startup publication, then at least two scheduler-driven publications
   with advancing last-successful timestamps while no browser/admin page is open.
6. Exercise mocked/fault-injected stale, price-change, lease and quota behavior;
   never run billable tests as part of unit tests.
7. Review exact endpoint intended-use eligibility. A public catalog fetch is not
   an authenticated inference test. Record missing quota/credential capabilities.
8. Enable each strict scope separately only after its integration tests and
   release checks pass. Normal/Strong must remain unchanged.
9. Monitor unavailable rates, quota/cooldown events, blocked stale metadata and
   unexpected provider-reported charges. Do not sell an outage as a paid upgrade.

Paid-fallback and paid-admin-test policies are deliberately not exposed by this
zero-cost rollout. Other-provider adapters remain unverified/disabled until a
provider-specific official verification method is implemented; a health ping is
never a pricing source. The optional chat hedge is separately gated: at most two distinct one-attempt candidates, delayed second start, first meaningful response wins, loser is aborted, and partial output is never replaced. A canceled loser does not poison provider health. Free quotas and privacy exposure still apply to both requests.


## Coding quality and output limits

Weak output limits are requested upper bounds, not mandatory 32K endpoint capacity.
The router selects a feasible endpoint-specific output budget and records requested
and selected limits. Truncated function arguments must never be executed as a tool.
Quality evidence is distinct from HTTP success and latency. Optional server-reviewed
coding evidence is bound to exact model/endpoint, benchmark suite/version and a
30-day lifetime, with at least five samples. Only one comparable benchmark cohort
can receive a quality preference; no Nemotron or other brand receives invented
scores. No benchmark evidence has been generated by these credential-free tests,
so cold-start model coding quality remains unverified.

## Image discovery and the funded exception

A separate hourly background job scans OpenRouter's dedicated image catalog and
endpoint SKU prices, using a separate fail-closed lease and retained last-good
snapshot. It performs no image inference. Missing pricing remains unknown; zero
priced metadata also remains unknown until account, terms and a safe dedicated
image adapter are verified. The dedicated Images API does not document chat's
max_price protections, so text dispatch controls must not be copied and described
as a guarantee. The current official public scan found no verified free image
endpoint. Existing daily owner-funded image generation remains unchanged.
Automatic future image-provider switching is not claimed complete: it requires a
real eligible candidate and verified dedicated dispatch controls. Discovery alone
never silently changes a paid image provider to an unverified endpoint.

## Coverage boundaries

Handler-bound scopes cover NavBharat chat aliases, SDA, all registered professional
chat/exam personas, debug and app-debug, design/palette, image prompt enhancement,
screenshot analysis, app review, repository analyst and security scan. Express
case/trailing-slash/version aliases inherit the actual handler scope. Unsupported
vision, voice, provider search and optional embeddings cannot silently invoke
paid AI inside these strict scopes. The image-generation allowance is the explicit
funded exception, not a declaration that image API costs are zero.

Weak scope is established after authenticated tier selection and covers main,
planner, repair, judge, admission/clarity and auxiliary provider paths. Legacy SDK
boundaries reject paid dispatch within scope. Published-app AI, developer API,
BYOK, unrelated background/admin jobs and Normal/Strong retain their existing
billing policies. This is not universal zero-cost enforcement across those
intentionally excluded products.

Professional free-access gating is scoped to the new feature; existing broad gift
and referral pause is not removed. Weak zero-balance/prepaid infrastructure gates
remain, so the flag alone does not make a funded sandbox available to an unfunded
account. The deferred credit program is separate work.


## Optional Free Chat Chain precedence (2026-10-22)

The separate [Free Chat Chain](FREE_CHAT_CHAIN.md) is OFF by default and applies
only to authenticated, admitted text turns on the explicit NavBharat Free Chat
aliases. It is not a replacement for this registry or a widening of its scoped
policy. When `STRICT_FREE_MODULES_ENABLED` applies, strict registry routing wins
and the new direct-provider chain, including its paid safety net, is bypassed.
Turning `FREE_CHAIN_ENABLED` off restores the applicable prior routing, which
can be paid when strict policy is off; neither flag is a platform-wide spend stop.

When strict policy is off and an owner explicitly enables a Free Chat canary,
the chain's OpenRouter rung still reuses this registry's fresh account/price/
endpoint/terms gates. It selects from an owner-reviewed exact-model allowlist,
keeps a bounded sticky preference, and makes at most one registry attempt for
that rung. It does not run the optional hedge or create a second unbounded
fallback loop. Unknown/stale/ineligible metadata still refuses dispatch.
Normal/Strong, Weak and professional helpers retain their existing scopes.

The proposed direct DeepSeek fallback remains blocked by the existing billing
rate-card/free-tier ceiling. No paid fallback was activated, no Gemini private
chat expansion was authorized, and no live benchmark or account-tier evidence
was produced by the offline implementation. See the chain runbook for the
remaining privacy, quota, invoice and activation gates.

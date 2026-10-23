# Free Chat Chain: implementation and operator runbook

Status, 2026-10-22: additive implementation for review. The feature defaults OFF,
rollout defaults to 0%, and Gemini defaults to skipped. No production activation,
credential creation, provider inference, live multilingual evaluation, purchase,
or deployment was performed for this change. Offline tests are not evidence that
an existing account is free, a model is available, or the launch acceptance bar is met.

> **2026-10-23:** the owner's Tier 1 → Tier 2 → Tier 3 module (new providers, paid Tier 3,
> max attempts, sticky spread, localized busy line, cost estimate) is documented in
> [`FREE_CHAT_TIERS.md`](./FREE_CHAT_TIERS.md). Default order changed accordingly.

## Scope and policy precedence

Only authenticated, text-only NavBharat Free Chat requests admitted by the existing
chat handler can enter this chain. The aliases are `/api/chat/navbharat` and
`/api/chat/navbharatai`, including their `/api/v1/` versions. A Firebase-verified
UID determines stable percentage rollout and per-user caps. A claimed body UID
is not an identity; anonymous requests retain their existing routing. Existing
attachment and vision paths bypass the new entry queue. Selected text turns enter a
bounded local queue before prompt assembly; admitted turns still execute the existing
safety and deterministic-answer logic before any model inference.
Pro, professional helpers, Weak/Normal/Strong builders, developer API, published
bots and other legacy consumers are not added to this chain.

Order of authority:

1. Existing AI maintenance and request safety controls still apply.
2. `STRICT_FREE_MODULES_ENABLED` inside the Free-module inference scope wins over
   this chain. Strict mode uses the existing verified-free registry path and
   never enters the new direct-provider or paid safety net.
3. `FREE_CHAIN_ENABLED` is the deployment gate. OFF restores the applicable old
   route, not necessarily a zero-cost route. It cannot be overridden from admin.
4. The saved admin enabled flag, stable UID allowlist/rollout and per-rung disabled
   list decide whether a request/attempt may proceed. A 0% rollout does not stop
   explicitly allowlisted users; use the global chain stop for that.
5. Credentials, account-review expiry, language/request compatibility, shared
   quota admission, circuit state, and any paid reservation are still required.

Once an admitted chain is exhausted, it returns the bounded busy response; it
must not fall through into an unbounded legacy paid ladder during the same turn.
A chain stop is not a platform-wide spending stop. Use the existing maintenance
control when the intent is to pause all AI. A stop does not cancel work already
in flight. Re-enabling a rung removes only its manual block, not the other gates.

## Configured order and account reality

Use a standard Z.AI **Model API** key for the fixed `api.z.ai/api/paas/v4` endpoint,
not a Coding Plan key. The official documentation index advertises separate key
management; the detailed guide could not be independently opened during this run.
The owner must verify the correct key type and actual account quotas in the console
before configuring this feature. No credential changes were performed.

Default logical order: GLM 4.7 Flash → GLM 4.5 Flash → Groq → existing
OpenRouter live registry → Cloudflare Workers AI → optional Gemini → separately
gated DeepSeek. Both GLM rungs share one key, account quota, bulkhead and auth/rate/quota
cooldowns. Model circuits remain separate so a model-unavailable response from
4.7 can try 4.5; switching models never creates a fresh account allowance. Unknown GLM
quota limits default to zero and its local reset defaults to conservative rolling24h. `FREE_CHAIN_ORDER` may
reorder/omit known IDs, but the paid rung may not move before a free rung.
The admin view reads the actual configured order and labels omitted providers
outside it. No key rotation/pooling is introduced by this feature.

| Rung | Exact configured profile | Important launch restriction |
| --- | --- | --- |
| GLM 4.7 Flash | `glm-4.7-flash` | One shared `FREE_CHAIN_GLM_API_KEY`; dated account/model/free-tier and quota review required. No guessed numerical quota. |
| GLM 4.5 Flash | `glm-4.5-flash` | Same GLM account/key/quota and account cooldowns as 4.7, separate model circuit; not a second free allowance or key pool. |
| Gemini | Default `gemini-2.5-flash`; approved profiles also include `gemini-2.5-flash-lite`, `gemini-3.5-flash-lite`, `gemini-3.8-flash` | Skipped by default; current account/model access, quotas and privacy review required. No universal free numeric quota is assumed. |
| Groq | `openai/gpt-oss-120b` | Free-organization attestation and actual organization limits must be checked. Enterprise-only Llama IDs are not substituted. |
| Cloudflare | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | Free-plan, model license and account review; 10,000-neuron provider allowance with local safety margin. Paid accounts can bill overages. |
| OpenRouter | At most four exact IDs from `FREE_CHAIN_OPENROUTER_MODELS` | Existing registry must independently verify fresh zero prices, account access, endpoint, terms and capabilities; an allowlist is not that verification. |
| DeepSeek | `deepseek-flash` | The exact direct SKU is recognized at verified peak rates. Configured reservations must be no lower than those rates and must remain within the unchanged free-tier ceiling; privacy, quotas, shared budget and rollout gates still apply. |

A configured key proves neither a free plan nor remaining allowance. A dated
`FREE_VERIFIED_UNTIL` declaration is an operator assertion, not an account API
check, and **cannot prevent an account upgrade from making traffic billable**.
Use dedicated provider projects/accounts with no unaccounted external usage.
Keep a rung disabled when tier, model access, terms or quota evidence is absent.
No provider monthly free-text entitlement is inferred from daily quotas.

## Privacy, language, context and cache

Gemini remains skipped unless both its skip and privacy/account gates are
intentionally satisfied. Even then it accepts only the small exact public-safe
prompt corpus in `cache.ts`, an empty conversation history, no profile or memory,
no attachment/grounding, and no private/health context. An arbitrary prompt with
no detected personal information is NOT considered public-safe. The privacy flag
is not permission to send ordinary private user conversations to an unpaid
Gemini service. Unpaid Gemini terms contain audience/geography restrictions and
allow review/improvement use; broader activation needs separate policy work.

Language matching uses the existing Hindi/Hinglish/English detector and an
explicit reply instruction. Provider language allowlists can restrict eligible
rungs. This is not multilingual-quality certification. History trimming removes
old complete messages and preserves system instructions/current input. UTF-8-byte
admission is a conservative local size heuristic, not a provider-certified token
count or invoice measurement; exact model/tokenizer framing remains a limitation.

Optional exact-match cache defaults OFF. OpenRouter responses are excluded from
this cache entirely so later registry quality/terms/account revocations cannot
be bypassed by a cached answer. It only caches the curated public-safe
corpus, never arbitrary personal/health/profile/history turns. The key includes
normalized prompt, language, system prompt and configured model family. Cached
responses still recheck current chain/rung eligibility. TTL is at most 24 hours.
There is no claim of semantic caching, generalized PII detection or a complete
privacy classifier. Cache responses are retained server data; expiry enforcement
on reads is not proof that a cloud TTL deletion policy is deployed. The existing
retention sweeper now has explicit cache/sticky expiry and 180-day action-history
policies. Pending paid holds/replay tombstones, the non-expiring paid-budget policy, and
authoritative reusable quota/control records are deliberately retained; no whole-tree bounded-storage
or live-cleanup guarantee is implied.

## Bounded local admission and fairness

The two free-chat route aliases acquire an opaque, request-bound entry lease before
expensive prompt assembly. Only a Firebase-verified UID can receive that lease;
JSON fields cannot forge it. The runtime reuses that active lease, rather than
queueing twice, and the handler releases it in `finally`.

The chain has a process-local total-turn queue, separate from each provider/account
bulkhead. Defaults admit at most 8 active chain turns and 64 waiting turns, with a
5,000 ms maximum wait. Per verified UID, defaults are one active and one queued
turn in this process. Queue-full, per-user-limit or wait-expiry outcomes return
the bounded busy response, not an invented queue position or ETA. Aborted work
must leave the queue without a later provider dispatch.

These are local fairness/pressure controls, not a cross-replica global queue or a
promise of service at a given traffic level. Replica count can multiply local
slots. Existing provider/account bulkheads are separate (8 concurrent attempts
per account by default); durable transactional quota and paid caps remain shared.
A short 1-second, single-flight controls cache is used only for selection. Every
physical provider attempt re-reads fresh controls and reserves durable quota.
The 1-in-64 event sample includes denied admission and may record admissionReason
and queueWaitMs, but it is not a complete denial count or production waiting-time
SLA. No broad admin queue monitoring or ETA is claimed by this screen.

## Shared quotas and resets

Reservations happen transactionally before each physical provider dispatch, in
`free_chat_chain`, shared by all replicas/users. A missing store or malformed
existing counter fails closed rather than becoming a fresh zero. Counters retain
uncertain attempts; failure, cancellation or missing usage does not restore free
quota. The counters measure this feature's reservations, not provider account
balances. Other applications, previously spent quota and provider changes are
not visible through them.

GLM Flash rungs share one account reservation scope, not two model budgets.
The default safety margin is 0.9. Configured RPM/RPD/TPM/TPD values are raw local
ceilings; the margin is applied by quota admission. GLM and Gemini default all four to
zero until verified values are configured. Groq defaults use the published
30 RPM, 1,000 RPD, 8,000 TPM and 200,000 TPD profile. Cloudflare also reserves
neurons, rounded upward, using 26,668 per million input tokens and 204,805 per
million output tokens for this exact model. Neuron reservations use the full
24,000-token model input context plus the output cap, not the local byte
heuristic, because that heuristic is not a verified hard token bound. Its other request/token ceilings are
conservative application policy, not a claim of published account entitlements.

Default daily windows are GLM conservative `rolling24h`, Gemini `America/Los_Angeles` with DST, Groq conservative
`rolling24h`, and Cloudflare/OpenRouter UTC local windows. The Groq implementation
retains the oldest whole hour conservatively, so recovery can be delayed by less
than an hour; it does not invent a provider midnight. Minute buckets also retain
boundary overlap rather than allow a double allowance burst. Provider reset
headers/cooldowns can further delay dispatch. Per-rung `TIME_ZONE` overrides are
only for operator-verified reset semantics, not a way to clear active counters;
changing an active ledger's zone fails closed. OpenRouter local calendar quota is
not proof of the remote account's reset. Provider and app-paid-budget days are
separate clocks.

## Paid safety net: deliberately not launched

The default application cap and owner-authorized hard maximum are **$10/day
TOTAL across all paid fallback providers in this Free Chat chain**, not $10 per
provider, plus 20 paid turns/user/day. Daily usage resets in `Asia/Kolkata` (IST);
the shared cap authority does not expire or reset at midnight. This budget is
separate from existing funded builder wallet budgets; it neither funds nor
changes those budgets. Integer nanodollars and transactionally created
reservations protect concurrent requests.

The cap is an application reservation ledger, not a provider account balance or
all-inclusive invoice guarantee. Taxes, conversion fees, other account traffic
and unverified prices are outside it.

The non-expiring `paid_budget_policy` record stores the authoritative shared cap
and revision, separate from daily held/settled usage. A validated deployment
configuration observation can initialize this authority or monotonically lower
it, including to $0 when paid routing is disabled. A more permissive old process
cannot raise it, including after an IST day rollover. Missing or corrupt shared
authority is not permission to spend; an unavailable snapshot is not a zero
balance or proof of health. Admin status GET is a pure read: refreshing it cannot
initialize, lower or otherwise modify this policy.

Only the explicit authenticated and audited admin budget action can intentionally
raise the shared cap. It requires the expected policy revision and a reviewed
reason, and accepts cents-precision USD amounts from $0 to $10, never above the
serving process's configured cap. A concurrent policy change rejects a stale
revision rather than overwriting it. Before an intentional raise, align the
serving deployment configurations and retire inconsistent stricter revisions;
increasing environment configuration alone cannot raise the saved authority.
Any stale stricter revision can lower it again on its next configuration
observation. A saved raise is therefore not proof that all deployed revisions
are consistent.

Changing the cap preserves existing held upper bounds and settled recorded
cost. Lowering it never clears a hold, refunds earlier spending, or cancels
already-dispatched work. Existing committed usage may exceed a newly lowered
cap; that does not create fresh room for paid reservations. A $0 cap blocks new
paid reservations, not other funded products or already-dispatched work.

A dispatch reserves peak, cache-miss rates and the full conservative 1,048,576
input-token model context plus capped output, not character-count tokens or an
assumed cache discount. Complete reported token usage can settle the hold using
the configured peak rates. Current settlement conservatively prices all input
at the cache-miss rate; the parsed cached-input setting does not yet credit a
reported cache discount. Missing/partial/uncertain usage leaves the full hold;
settlement after midnight reconciles the original day. Any actual settled amount
above a hold is recorded honestly, not clipped. The admin screen calls this
“Settled recorded cost”, separately from held upper bounds; neither is
provider-invoice reconciliation.

The exact direct `DEEPSEEK` / `deepseek-flash` profile is recognized at the
verified peak tariff: $0.30/M input, $1.20/M output and $0.006/M cached input.
Unknown or mismatched identities remain conservative. Configured input/output
reservation rates below peak, malformed rates, or a blended rate above the
unchanged Kimi ceiling are rejected before quota or budget admission. The
existing wallet, user markup and funded-builder prices are unchanged. Account,
API data-processing terms, spending scope and explicit activation still need
review before any paid end-to-end acceptance test. No real inference was run.
Budget threshold notifications at 50%, 80% and 100% committed usage use the
existing admin inbox for configured admin recipients; they are not email or
Slack alerts, and live receipt has not been verified. Pending holds must not be deleted to make room for more spend.

## Admin operation

Open Admin Dashboard → AI Engines → Free Chat Chain. The existing admin token
gates every status, metrics and control route. Ordinary
`GET /api/v1/admin/free-chat-chain` is no-store and reads status only: configured
order, credential-presence status (never credential values), local usage/limits
and reset, local circuit observation, and the configured process cap, effective
shared cap, policy revision, held upper bounds and settled recorded cost
separately. It never reads event history or writes paid-budget policy. Status
polls every 30 seconds only while the page is visible; `Refresh status` and
refreshes after controls also read only status. Unavailable readings remain
unavailable, not healthy zeroes. A successful read that verifies the shared
policy is absent returns `paid.policyState: "uninitialized"`, `capUsd: null` and
`policyRevision: null`; an existing valid policy returns `"initialized"`. Only
that verified uninitialized state offers `Review budget initialization`, an
explicit admin action with `expectedRevision: 0`. It lets the owner set a $0
shared cap before the first enabled chat, subject to the same authentication,
configured ceiling, amount validation, reviewed reason and atomic audit rules.
A read failure or malformed policy remains unavailable (503), not uninitialized,
and never offers initialization. Refreshing GET or opening the panel never
initializes the policy or triggers any automatic budget write.

The two GLM Flash rows share one quota snapshot within each status response, not
a cache across requests. Six distinct quota scopes require three document reads
each, plus one controls read, one paid-budget-policy read and one paid-day read:
nominally 21 document lookups per status response before possible transaction
retries. This reduces duplicate work but is not free infrastructure or an exact
invoice estimate.

Historical metrics are a separate, deliberate read. Press `Refresh sampled metrics`
to call `GET /api/v1/admin/free-chat-chain/metrics`; this route requires admin
authentication, is no-store, and is rate-limited to two requests per 60-second
window per process/IP. That is a local limiter, not a cross-replica global scan budget.
Metrics never load on mount, a timer, a control action or focus. The history query
filters the last 24 hours by the `at` timestamp, selects only `at`, `rung`,
`latencyMs`, `fallbacks` and `cacheHit`, and limits the result to 4,096 documents.
Each deliberate scan can incur up to 4,096 event-document reads, plus possible
database query/index overhead. Field projection reduces returned data, not this
document-read bound; this is not an exact invoice estimate.

The metrics response reports `scanLimit: 4096` and `observedAt`, the server's
snapshot cutoff time. The panel's `Metrics snapshot as of` time is separate from
status refresh time: newer status does not make an older metrics sample fresh.
A failed metrics refresh visibly marks the previous sample stale (or shows it
unavailable if none was loaded) and does not automatically retry. Retry only with
another deliberate press after reviewing the failure or rate-limit message.

Global/rung/whole-percentage rollout controls use
`POST /api/v1/admin/free-chat-chain/control`, require a reviewed consequence and
a 10–500-character reason, and accept only their allowlisted settings. An
expected-controls snapshot is checked atomically, so a stale admin tab cannot
overwrite another admin's stop.

The separate `POST /api/v1/admin/free-chat-chain/budget` action sets only the
shared paid cap, within $0–$10 and no higher than the serving process's configured
cap, with cents precision, an expected policy revision and a 10–500-character
reason. The request fields are `capUsd`, `expectedRevision` and `reason`; a
confirmed response contains `ok: true`, `capUsd` and `policyRevision`. Explicit
initialization uses `expectedRevision: 0` only after a successful snapshot
verified the policy is absent; an initialized policy uses its displayed revision.
The same compare-and-swap rejects a concurrent initializer rather than replacing
its policy. Its actor
is the verified server-authenticated admin principal, never a client-provided
identity. A successful policy update and its durable audit record
are atomic; the existing admin audit log also records the action outcome. This
action does not change deployment flags, secrets, URLs, models, prices, provider
agreements, funded builder budgets or the verified-rate admission gates. Lowering a
cap does not clear previous holds or cancel work already dispatched. Before
raising it, follow the deployment-consistency precautions above.

Reasons are sanitized before durable history and audit output. If a status or
control response is lost, refresh status to verify the saved policy revision,
cap and controls before retrying; absence of a confirmation does not prove a
write failed. Status/control refreshes must not trigger a historical metrics
scan. No production budget or configuration was changed for this implementation.

Statistics uniformly select requests with probability 1/64, persist that sampling
probability, and retain at most 4,096 event slots filtered to 24 hours, NOT
whole-day totals. Displayed shares, rates and p50/p95 describe retained samples
only; they are not exact population rates or measured production p95. Per-turn
console logging and the existing usage-log write path are unchanged. Sample collisions/retention can omit traffic, and `complete`
remains false. Unknown rates remain null, never invented zeroes. A 0-sample window
cannot establish no traffic. Circuit state is
process-local; durable cooldowns protect other replicas. Provider shares are
fractions of sampled chain outcomes, not successful-provider market share.
Cache hits/no-provider outcomes need not be attributed to a provider rung.

The separate admin analytics projection retains the `freeChain` marker and
measured tokens, but marked chain rows do not enter legacy fallback pricing.
They remain explicitly unpriced until verified pricing evidence is consumed;
routing estimates, including zero, are not invoice cost. Aggregate cost/margin
remain incomplete floors/ceilings, and an all-unpriced cost is shown as Unpriced,
not a reassuring zero. Legacy unmarked pricing and wallet charging are unchanged.

## Owner-only setup checklist, no commands executed

1. Leave `FREE_CHAIN_ENABLED` OFF, rollout 0 and Gemini skipped while reviewing.
2. Verify each provider's current exact model, account/project tier, active quotas,
   free allocation, privacy/retention settings, license and intended-use terms.
   Record a short-lived review expiry; do not represent it as an automated check.
3. Provision only the dedicated server secrets that the owner explicitly approves.
   See the names-only environment registry. Do not paste keys into source, chat,
   screenshots, the admin reason, a command history or a client bundle.
4. For Cloudflare, the official REST guide requires a token restricted to the
   intended account with BOTH Workers AI Read AND Workers AI Edit. Read-only is
   insufficient. Credential creation/permission expansion remains an owner action.
5. Keep existing OpenRouter registry/account/endpoint/terms verification in place;
   select exact models only after separate quality evaluation. No “auto free”
   label bypasses the registry, and no hidden paid OpenRouter fallback is enabled.
6. Verify the authoritative database, quotas, existing maintenance switch, alerts
   and retention/TTL policy before a canary. Review the single shared paid fallback
   budget (default and hard maximum $10/day total), separately from funded builder
   wallet budgets. Inspect the shared policy revision and each serving revision's
   configured cap; retire inconsistent stricter revisions before an authorized
   raise. Do not clear production ledgers or outstanding holds.
7. Run offline tests; then, only with separate authorization and isolated test
   accounts, use the opt-in evaluation harness described below. Review every
   response for language, factuality, safety and usefulness. No quality threshold
   or p95/availability acceptance has been established by this implementation.
8. Start an owner-approved UID canary, inspect actual billing/usage, then consider
   bounded percentage rollout. Account state and policy must be rechecked when
   model/pricing/tier/settings change. Activation is not performed by this runbook.

`cloudbuild.yaml` was inspected without edits. Its Cloud Run deployment uses
`--update-env-vars` for NODE_ENV, PLATFORM_MAX_INSTANCES and existing Weak-policy
settings, not a replacing `--set-env-vars` call. Unmentioned Free Chain settings
are therefore preserved by that command. This is source inspection, not live
proof of Cloud Run's current values. No infrastructure or production environment
was changed. Do not substitute the unrelated `package.json` `gcloud:deploy`
convenience command: it uses a replacing `--set-env-vars` and a different service
name. Environment preservation is not a claim about every deployment command.

## Offline verification and optional evaluation

Dedicated tests exercise shared quota/spend concurrency, reset boundaries,
provider payload/usage/error handling, strict policy, eligibility and admin
read/control/rendered state. The full repository/hosted CI result is a separate
release gate; focused passing suites are not a claim that all CI has passed.

`scripts/freeChainEval.ts` provides a 30-prompt synthetic Hindi/Hinglish/English
corpus. Dry-run is the default and makes no provider calls. Live mode must require
explicit opt-in, owner-approved isolated provider accounts and a loopback demo
Firestore emulator, with paid dispatch disabled. It invokes the actual chain
inside the Free-module policy scope; it never bypasses strict-free, rollout,
privacy or quota gates to obtain a nicer benchmark. Emulator reservations are
not production/shared-account reservations. Read the script header and required acknowledgements before any authorized use. Dry-run command: `node_modules/.bin/tsx scripts/freeChainEval.ts --dry-run`.
Live mode additionally requires `--live`, `FREE_CHAIN_EVAL_CONFIRM`,
`FREE_CHAIN_EVAL_ACCOUNT_SCOPE`, development mode, an approved loopback emulator,
explicit strict-policy OFF, caching OFF, a zero paid cap, and no DeepSeek in
configured order. These settings are checked, never silently changed or seeded.
Live artifacts stay locally under `.cache/free-chain-eval/`; responses are bounded
and redacted, metrics stay null when absent, and human scoring is required.
No live evaluation was run
for this change, and blocked/not-selected prompts are reported as such, not
scored as successful answers. Quality and factuality need human review.

## Acceptance still open

- Live account tiers/quotas, exact model availability, legal/privacy permissions,
  production configuration, alert delivery and TTL cleanup are not verified.
- DeepSeek rate compatibility is implemented and unit-tested; live account, privacy, price freshness and paid end-to-end behavior remain unverified.
- Ordinary/private Gemini conversations remain intentionally out of scope.
- Hindi/Hinglish/English quality, real latency/reliability and the desired free
  traffic share are unmeasured. There is no “zero-cost” or “unlimited” promise.
- The $10 total daily paid fallback cap does not prove an all-inclusive account invoice ceiling, and an
  account's move to a paid plan cannot be prevented by a local tier declaration.
- Full CI, production deployment, canary evaluation and owner activation remain
  separate gates; none is implied by this document.

## Official evidence, checked 2026-10-22

- GLM: [pricing](https://docs.z.ai/guides/overview/pricing),
  [4.7 model guide](https://docs.z.ai/guides/llm/glm-4.7),
  [4.5 model guide](https://docs.z.ai/guides/llm/glm-4.5),
  [standard API](https://docs.z.ai/api-reference/introduction),
  [streaming](https://docs.z.ai/guides/capabilities/streaming),
  [error codes](https://docs.z.ai/api-reference/api-code). Both Flash profiles are
  listed free, but no universal numerical quota is inferred and current account
  access/terms still require owner review.
- Gemini: [pricing](https://ai.google.dev/gemini-api/docs/pricing),
  [model lifecycle](https://ai.google.dev/gemini-api/docs/deprecations),
  [quotas](https://ai.google.dev/gemini-api/docs/rate-limits),
  [OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai),
  [API terms](https://ai.google.dev/gemini-api/terms).
- Groq: [models](https://console.groq.com/docs/models),
  [limits](https://console.groq.com/docs/rate-limits),
  [billing](https://console.groq.com/docs/billing-faqs),
  [API](https://console.groq.com/docs/api-reference),
  [data controls](https://console.groq.com/docs/your-data).
- Cloudflare: [exact model](https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/),
  [pricing/neuron conversion](https://developers.cloudflare.com/workers-ai/platform/pricing/),
  [REST permissions](https://developers.cloudflare.com/workers-ai/get-started/rest-api/),
  [data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/).
- OpenRouter: [free limits](https://openrouter.ai/pricing),
  [provider routing controls](https://openrouter.ai/docs/guides/routing/provider-selection),
  and [the existing registry runbook](LIVE_FREE_MODEL_REGISTRY.md).
- DeepSeek: [pricing](https://api-docs.deepseek.com/quick_start/pricing/),
  [chat API](https://api-docs.deepseek.com/api/create-chat-completion/),
  [token-estimation limits](https://api-docs.deepseek.com/quick_start/token_usage/),
  [platform terms](https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html),
  [privacy](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html).

Routing telemetry counts logical rung attempts and fallbacks, not confirmed HTTP calls.
A registry rung can be entered but reject eligibility before inference. Only provider
request/usage evidence can establish physical inference or billed usage.

Configuration caches only validated timezone identifiers (bounded to 32); it never
caches quota windows or eligibility. Actual reservations still calculate current
civil-day boundaries, including Pacific DST. A changed timezone is revalidated.

## Free-tier paid rungs outside FreeChain (2026-10-23)

Every Free-tier paid call that does NOT go through FreeChain now draws on the same owner-funded daily
budget (`FREE_TIER_PAID_DAILY_CAP_USD`, default $10, shared authority `free_chat_chain/paid_day_<IST>`):

| Surface | Free order | Notes |
|---|---|---|
| Legacy Free chat (`buildFree`) | GLM-4.7-flash → flash-lite → gpt-5-nano → flash | paid rungs wrapped by `cappedFreeTierRung` |
| Teacher AI / professionals / Design / Debug / App-debug | GLM-4.7-flash → flash-lite → flash | **sequential** (`route`), not raced: one answer = one bill |
| Doctor AI / SDA (free) | GLM → Vertex flash-lite → flash → Gemini flash-lite → flash | never 2.5-pro, Grok or Claude |
| Free vision (chat photo/PDF, screenshot→prompt, avatar) | GLM-4.6V-flash → Vertex flash-lite → flash → Gemini flash-lite → flash | Grok-4 / 2.5-pro removed |
| Free professional image describe | Gemini flash-lite → flash | no Grok, no Claude |

`VISION_VERTEX_MODELS` / `VISION_GEMINI_MODELS` / `VISION_GROK_MODELS` tune the PAID tier only; Free
lists are fixed by an allowlist (`visionModels.ts`, `freeTierPaidCap.ts`). `tests/freeTierPaidLeaks.test.ts`
fails CI if any Free path names `gemini-*-pro`, Grok or Claude. When the cap is reached the turn falls
back silently to the busy line in the user's language (Hindi / Hinglish / English).

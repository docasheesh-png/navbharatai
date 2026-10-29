# Admin provider diagnostics

Local implementation only. No paid provider calls, publication or deployment performed.

## Surface and manual procedure

Admin → AI Engines → Provider testing bots. Opening/remounting sends no request.
Choose **Verify admin and read test status** (authenticated GET, no inference).
Each provider has its own readiness/missing-evidence report and separate prompt panel.
Only a ready panel permits **Run surplus test** or **Run cheaperinference test**.
One manual request uses a persisted browser-session UUID; repeated clicks cannot resend.
After uncertain outcomes or navigation, choose **Recover original run**, which only
GETs the original record. Do not discard an unresolved key to create a replacement.
Confirmed settlement without an overrun permits **Prepare another test**; retained
unknown liabilities and overruns require separate reconciliation, not a UI bypass.

Routes all require existing server-verified Admin authentication:
- GET `/api/v1/admin/provider-diagnostics/status`
- GET `/api/v1/admin/provider-diagnostics/runs/{idempotencyKey}`
- POST `/api/v1/admin/provider-diagnostics/{surplus|cheaperinference}/runs`
  with exactly `{idempotencyKey: UUIDv4, prompt}`.

Prompts are bounded to 2048 UTF-8 bytes; requested output to 256 tokens; diagnostic
client deadline to 30 seconds; durable global concurrency to one across both bots.
Existing adapters and server secret configuration are used directly. No classifier,
application fallback, automatic client retry, generated code execution or normal-chat
routing change. Provider-internal retries/failover are outside this client's control.
A client timeout does not prove supplier execution/billing stopped.

The response shows plain text, generated run ID, provider/model, started/total latency,
actual supplier receipt or unavailable, reported usage, wallet distinction and safe
stage/reason/HTTP evidence. First byte/token and throughput remain unmeasured. Whole
operation latency includes accounting. Provider success does not prove builder health.
No prompts, text, raw errors, credentials or key hashes enter diagnostic persisted logs.
Only recovery UUIDs are stored in the browser session. Recovery does not invent text
or fresh timing from ledger history.

## Real evidence reader and authority

There is no stubbed verifier, evidence seed, HTTP approval writer or default approval.
`ProviderDiagnosticStore.status` performs a read-only dry-run of the same transaction
used by admission. The transaction rereads evidence, billing caps and balances; every
retry uses current time. New admissions carry an expiry checked before network dispatch.
Absent/malformed/expired records return precise field names without raw record contents.

Server-owned records:
- `free_chat_chain/provider_diagnostics/policy/review`
- referenced artifacts under `free_chat_chain/provider_diagnostics/evidence/{safeRef}`
- existing `free_chat_chain/paid_budget_policy` and daily/monthly shared ledgers
- diagnostic aggregate ledger and immutable per-key run identities under the same root

The review binds provider/model/context, input/output *ceiling* rates, aggregate INR
allowance (at most 200000 paise), conservative prior commitment and all-in conversion.
It expires within 24 hours. Admission clamps daily/monthly caps to actual
`freeChainConfig()` settings as well as persisted policy/review limits. Per-test
reservation is at most 100 paise. Full model context plus maximum output is reserved.

Each evidence artifact requires version1, verified status, review ID, artifact SHA-256,
review timestamp and validity through the admission window plus client deadline.
Reconciliation must cover earlier supplier API AND sandbox charges, unresolved prior
liabilities, and an evidenced upper bound for **all other outstanding authorized
benchmark spending**, not merely a snapshot that ignores concurrent production.
Its committed amount plus that other-spend bound must equal the review's prior floor.
Conversion must include fees/taxes. If that bound cannot be evidenced, dispatch blocks.

Tariff records bind the exact provider/model/endpoint and current `K_REVISION`, an
account review, and credentials pinned to that deployment revision. Unversioned or
mutable-latest credential configurations cannot satisfy this binding. Rates must be
verified ceilings for every billed dimension (including caching/reasoning), all served
model versions, and remain locked for the admitted supplier request even after client
timeout. Tokens-only/no additional charges must be established. Official HTTPS source
URLs are allowlisted; example URLs and synthesized `liveAdmission.ts` tariff records
are not evidence. No actual production evidence was read or fabricated in this task.

Unknown receipt/outcome retains daily/monthly/aggregate reservations and global lock
without TTL release. Exact settlement is atomic/idempotent. Overruns record the full
charge and retain the stop. Lost transaction acknowledgements require original-key
recovery. The historical disabled Surplus one-shot and production pilot holds are never
read, reset or reused by these bots.

## Supplier receipts

Surplus integer `usage.buyer_cost_micro` uses the existing exact decimal parser.
CheaperInference buffered `billing.status=settled`, `currency=USD` and decimal-string
`billed_cost_usd` are projected as the charge to us, including malformed-text responses
with evidenced settlement. These are distinct from our user-wallet charge and from
CheaperInference's private upstream costs. Missing/redacted/unsettled or unsupported
receipt data remains unavailable; token estimates are never substituted.
Protocol reference checked: https://www.cheaperinference.com/docs, Usage and response
privacy (billing), Automatic retries and fallback, Timeouts. No authenticated call made.

## Verification limits

Focused tests include transactional mocks, mounted Express authorization, component
interaction/render harness tests and independent review regressions. Real React mounting additionally passes in Happy DOM via
`scripts/providerDiagnostics.dom.check.mjs` with separately installed Happy DOM21.0.4
(no production dependency). It covers manual verification, unauthorized hiding, no mount
requests, duplicate POST suppression, remount recovery and retained holds. This is a
DOM simulation, not an actual browser or deployed end-to-end verification. Real Firestore/emulator drills remain unrun: the
previous official emulator download was proxy-denied and was not retried/bypassed.
Full local CI outcomes are recorded separately in PROGRESS.md and local check logs.
No hosted Actions are used. Production evidence and bounded paid verification remain
parent-coordinated work after review; this feature does not authorize new spend.

## Minimal production inputs and where to obtain them

No routing-mode switch, recharge, new credential or model upgrade is needed. Each
provider can become ready independently once its own evidence and shared budget pass.
No production records or secret values were inspected during this coding task.

| Input | Existing authoritative source / required action |
| --- | --- |
| Surplus adapter | Existing `SURPLUS_API_KEY`, optional allowed `SURPLUS_BASE_URL`, `SURPLUS_MODEL` (adapter default `deepseek-v4.1-flash`). Read configuration presence/metadata only; never disclose the key. |
| CheaperInference adapter | Existing `CHEAPERINFERENCE_API_KEY`, `CHEAPERINFERENCE_MODEL` (adapter default `beam`), fixed `https://api.cheaperinference.com/v1`. Normal routing modes need no change. |
| Deployment/account binding | Actual `K_REVISION`, deployed endpoint, and secret-manager metadata proving the credential is pinned to that immutable revision. An absent immutable revision or mutable-latest credential is a blocker, not permission to invent a revision. |
| Existing spending authority | Read `free_chat_chain/paid_budget_policy`, shared daily/monthly ledgers and current `FREE_CHAIN_PAID_DAILY_CAP_USD` / `FREE_CHAIN_MONTHLY_CAP_USD` configuration. Do not increase limits or clear holds. |
| Prior benchmark reconciliation | Existing authorized supplier usage/receipt records, sandbox invoices and unresolved reservation records. Customer-wallet debits are insufficient. Missing external attempts or unbounded liabilities require owner/accounting evidence; otherwise remain blocked. |
| Provider tariff evidence | Official current tariff/account documents plus authorized account configuration, including all cache/reasoning dimensions, served model versions and pricing for already admitted requests. Missing account-specific terms/guarantees require provider/account-owner evidence; do not assert unsupported guarantees. |
| Conversion and other activity | Authorized accounting conversion/fee records and the inventory/bound of all outstanding approved benchmark activity. Ask the owner only for facts absent from those records; do not request secrets or enlarge the existing approval. |

Exact review document fields: `version=1`, `expiresAt`, `priorCommittedPaise`,
`priorEvidenceRef`, `totalBudgetPaise` (<=200000), `allInPaisePerUsdCeiling`,
`monthlyCapNanoUsd`, and `providers.<provider>.{model,contextTokens,
inputPerMillionNanoUsd,outputPerMillionNanoUsd,rateEvidenceRef}`. The ledger manages
`diagnosticsInitialized`; preserve it and existing totals, never reset it manually.

Both referenced artifacts require `version=1`, `status=verified`, `reviewId`,
`artifactSha256`, `reviewedAt`, `expiresAt` (through review expiry +30000ms).
Reconciliation adds `kind=benchmark-reconciliation`, `committedPaise`,
`otherBenchmarkUpperBoundPaise` (their sum equals review `priorCommittedPaise`),
`allInPaisePerUsdCeiling`, `concurrentLiabilityBoundThrough`, and established true facts:
`includesApiAndSandbox`, `includesUnresolvedLiabilities`, `conversionIncludesFeesAndTaxes`,
`coversAllOtherBenchmarkDispatch`, `coversAllOutstandingAuthorizedBenchmarkSpend`.
Tariff adds `kind=supplier-tariff`, `provider`, `model`, `endpoint`, `deploymentRevision`,
`accountReviewId`, `sourceUrl`, `currency=USD`, `billingBasis=tokens-only`,
`additionalCharges=none`, matching context/input/output ceiling rates, and established
true facts: `accountSpecific`, `credentialsPinnedToDeploymentRevision`,
`ratesLockedForAdmittedRequest`, `ratesAreAllDimensionCeilings`,
`coversAllServedModelVersions`, `outputCapIncludesReasoning`.
These fields record verified facts; do not set attestations merely to unblock a test.

## Throughput test (`POST /api/admin/provider-diagnostics/:provider/throughput`)

Response is `application/x-ndjson`: `started` → `progress` heartbeat every 2s → exactly one `result` or `error` line.
Pre-dispatch failures are plain JSON: `400 invalid_request`, `409 run_in_progress` (one run per provider per instance),
`424 adapter_unavailable:<code>` (e.g. missing/invalid `SURPLUS_API_KEY`, `CHEAPERINFERENCE_API_KEY`, `SURPLUS_BASE_URL`).
If the UI shows "stream ended before result", the instance was recycled or a proxy cut the stream — rerun with fewer requests.

Root cause of the old opaque `503 "Throughput run unavailable"`: every adapter-construction error was flattened into
one 503 without its reason, and the run held a silent HTTP request open for minutes (no bytes until the end), so
idle/proxy timeouts and instance recycles were indistinguishable from config errors.

## Settling a stuck CheaperInference load batch (e.g. `completed 53/100, active 73`)

By design (`providerLoadBatch.ts`), only an observed complete response releases a concurrency slot; a timeout/network
failure keeps `active` held forever (the supplier may still be working and charging), and `completed` counts failures
too. So `active` can exceed `count - completed` and never drain. Nothing re-sends automatically. To settle:

1. Admin → Provider testing bots → **Stop** (`POST /api/admin/provider-load-batch/stop`). No further claims happen.
2. Read `GET /api/admin/provider-load-batch/status` and per-item `GET .../items/:ordinal`; items in state
   `dispatched`/`unknown` are the retained liabilities. Reconcile their cost against the CheaperInference dashboard.
3. To start a fresh batch, the scope must change: in Firestore delete the doc
   `free_chat_chain/provider_load_batch_settings` (the old batch doc under its `scopeId` stays as the audit record).
   The next **Save** mints a new `scopeId` with `active: 0`. Do not edit `active`/`heldNanoUsd` by hand on the old batch.
4. For raw throughput measurement prefer the Throughput test above; it does not use the durable batch ledger.

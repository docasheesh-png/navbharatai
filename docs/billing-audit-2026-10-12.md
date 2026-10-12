# Billing, revenue and profitability audit — 2026-10-12

**Type:** audit only. No production code, schema, price, balance, payment setting or cloud resource was
changed. No real charge, refund or balance change was made. No secret or customer payment data is
reproduced here.

**Builds on, does not redo:** the FULL MONEY AUDIT of 2026-09-12 (`docs/claude/ENV_REGISTRY.md`, 7 leaks
fixed) and the forensic audit of 2026-10-04 (#3538, `PROGRESS.md`). Items those audits already closed were
re-checked against the code and are listed under "Confirmed strengths", not as findings.

**Ground truth:** `main` at `fe5bd1615` (2026-10-12). Open PRs at the time: #3679, #3680 (queue and
playtest only; neither touches billing).

---

## 1. Executive summary

The money path is in good shape where it matters most. Credits come only from money a provider confirmed.
The claim and the credit happen in one transaction. Webhooks are HMAC-checked in constant time. Debits are
transactional and exact to the sub-token. Failed and unproven builds are not marked up. The client cannot
write a wallet or a payment record (`firestore.rules:77-98`).

**One confirmed customer overcharge was found (F-01).** The Opus rate card is three times Anthropic's
current price:

| | Code | Anthropic's price (claude.com/pricing, fetched 2026-10-12) |
|---|---|---|
| Input / output | $15 / $75 | $5 / $25 |
| Cache read / write | $1.50 / $18.75 | $0.50 / $6.25 |

The Strong tier bills real cost × markup. So every Strong build that reaches its last rung (Opus 4.8) is
billed on a cost three times too high. The same inflated number also does two other things:
- it pauses Opus-heavy builds early at the $5 cost ceiling;
- it understates our margin on the admin's cost cards.

The other findings fall into four groups:
- **Integrity hardening:** the FX rate has no sanity band, the build lock does not hold across instances,
  and a Play purchase is acknowledged by the client only.
- **Abuse exposure set by policy:** ₹100 of free credit per new account; a failed build is free with no
  cap on what it costs us.
- **Privacy:** customer name, email and phone are written to the logs.
- **Reporting accuracy:** store revenue, GST, and the gateway fee.

**Business-rule conflicts (not defects).** The audit brief assumed several rules the code does not follow:
- ₹1 = 200 output tokens;
- input tokens are free;
- only output deducts;
- "Sakuni Basic/Pro/VIP" modes.

These are reported in §2 for the admin's decision. Nothing was changed to match them.

**Tests executed:** 101 billing test files, **1,935 passed, 0 failed, 0 skipped** (§11). They pass while
F-01 is live, because `src/server/AgentV3/pricing.test.ts:67` pins the stale $15/$75.

---

## 2. Business rules — the brief vs the code (CONFLICTS for the admin, not defects)

| Brief assumed | What the code actually does | Evidence |
|---|---|---|
| ₹1 = 200 billable output tokens | ₹1 = **100 wallet tokens**. Wallet tokens are a currency unit, not model tokens | `src/lib/walletPricing.ts` (`TOKENS_PER_RUPEE = 100`) |
| Input tokens are free; only output deducts | Input, output **and** cache tokens are all priced at the provider's real rate, then marked up | `pricing.ts:99-109` (`tokenCostUsd`), `providerRates.ts:326-330` |
| Track input / output / total separately | Done per provider and per model in the build ledger and diagnostics | `ProviderUsageLedger.ts`, `buildCostLedger.ts` |
| Modes: NavBharatAI Free, Sakuni Basic / Pro / VIP | Three tiers: **Weak** (free floor), **Normal**, **Strong**. "SAKUNI25" was a hard-coded coupon, removed from code 2026-09-10; coupons now come only from `PROMO_COUPONS` | `powerLevel.ts:9-24`, `tierLadder.ts:25-27`, `promoCoupons.ts:4` |
| Cashfree required | Cashfree is the web rail; Google Play / App Store are the native rails, crediting the same wallet | `routes/payment.ts:84, 760` |
| Provider credentials server-side | True. The webhook secret comes only from the platform env | `payment.ts:478`, `cashfreeCredentials.ts` |

**Tier → provider map (verified in code, `tierLadder.ts:120-145`):**

| Tier | Ladder, in order |
|---|---|
| Weak | GLM glm-4.7-flashx → Kimi kimi-k2.7-code → GLM glm-5.3 → Nemotron super (no key today, skipped) → Claude Haiku 4.5 |
| Normal | glm-4.7-flashx → kimi-k2.7-code-highspeed → glm-5.3 → Nemotron super → Claude Sonnet 4.6 |
| Strong | glm-5.3 → kimi-k3 → Claude Sonnet 4.6 → **Claude Opus 4.8** (`opusModel()`, `models.ts:18`, `agentv3.ts:3736`) |

**The live billing formula.** The Opus flat tier was retired 2026-09-14, so this is the only formula in use:

```
real    R = Σ(tokens × real per-model rate) + aux remainder at Sonnet rate (+ VM, only if configured)
markup  T(R) = 4R                 when R ≤ $1
             = $4 + 3(R − $1)     when R > $1        (AGENTV3_MARKUP_* env)
bill    B = T(R) × live USD→INR
```

Then the overrides apply:
- no preview proof → B = R × FX (the margin is waived);
- failed, empty or cancelled build → B = 0;
- build discount → never below R.

Code: `agentv3.ts:2113-2207`, `previewEarnsMarkup.ts:51-100`.

**Decision needed (A):** keep the current model (real cost × tiered markup, 100 tokens per ₹), or adopt
the brief's output-only model. Recommendation: **keep the current model.** It charges for what the
platform actually pays, input included, so the margin cannot be gamed by input-heavy prompts. The brief's
"free input" would make every long-context build a loss.

---

## 3. Architecture map (money flow)

```
FUNDING
  Web:     /api/payment/create-order ─► Cashfree checkout ─► three independent paths to ONE credit:
             ├─ /api/payment/webhook        (HMAC, constant-time)
             ├─ /api/payment/verify-payment (redirect return)
             └─ /api/payment/reconcile      (sign-in sweep of own PENDING orders)
           all three ─► verifyPaymentInternal
             (GET order from Cashfree → amount check → PENDING→SUCCESS claim + credit, one transaction)
  Native:  /api/payment/store/verify ─► storeVerify.ts (Google / Apple) ─► credit in a transaction
           (idempotency read inside the transaction)
  Free:    coupons, gift codes, welcome gift, referral steps ─► mirroredCreditPatch (gift bucket)

WALLET  user_token_wallets/{uid}
  views:  tokenBalance + remaining_balance, kept in step by walletMirror.ts (the one legal writer)
  ledger: walletLedger (embedded, capped at 500)
  money:  credits recorded in payment_transactions/{id}

SPEND
  Builds: decideBuildBilledUsd → decideMarkupOnProof → zeroing rules → debitWalletForBuild
          (transactional, idempotent on buildRef, ₹50 overdraft floor, sub-token carry)
  Chat / tools (AI_WALLET_SPEND=on): runInAiSpendZone → decideAiChargeForTurns → debitWalletRolledUp
  Plans / add-ons / APK / images: paid-only or held debits (walletDebit.ts)

REVERSAL
  Cashfree refund / dispute webhooks → settleCashfreeReversal (amounts re-read from Cashfree)
  Play voided purchases (Q-690, blocked on a Console permission)
  Apple refunds (Q-614, blocked)
```

---

## 4. Findings

Severity: **P0** money is lost or wrongly taken now, at scale · **P1** confirmed wrong charge or loss on a
real path · **P2** real exposure needing a fix or a decision · **P3** hardening or reporting.

### F-01 · P1 · Customer overcharge / provider-cost accuracy · Opus rate card is 3× Anthropic's price — CONFIRMED (high confidence)

**Where**
- `src/server/AgentV3/pricing.ts:72-74`: `opusRate()` defaults to 15 / 75.
- `providerRates.ts:227`: any model id containing "opus" gets `opusRate()`.
- The Opus that runs is `claude-opus-4-8` (`models.ts:18`, `agentv3.ts:3736`), the last rung of Strong (`tierLadder.ts:144`).

**Evidence**
- claude.com/pricing (fetched in-session 2026-10-12): Opus 4.8 and Opus 4.7 are both $5 input / $25 output, cache read $0.50, cache write $6.25.
- The bundled Claude API model notes say the same: "Opus 4.8's pricing ($5/$25 per MTok)".
- Sonnet 4.6 ($3/$15) and Haiku 4.5 ($1/$5) in the code match the live page.

**Reproduction** (in-session, `npx tsx`, default env). One Opus turn of 200,000 input / 10,000 output tokens:

| | Real cost | Bill after markup | At ₹85/$ |
|---|---|---|---|
| Code today | $3.75 | $12.25 | ≈ ₹1,041 |
| Correct | $1.25 | $4.75 | ≈ ₹404 |

So that turn is billed **2.58×** what the rule (real cost × markup) allows.

**Expected vs actual:** real cost should be priced at Anthropic's real rate (the established rule,
`ROUTING_AND_BILLING.md:432`: "an Opus rung that ran is priced at its real Opus rate"). It is priced at the
retired Opus 4 / 4.1 rate.

**Siblings — the same wrong number feeds four more places:**
1. `buildCostCeiling.ts` stops a build at $5 of *computed* cost. On Opus turns that is about $1.67 of true spend, so Opus-heavy Strong builds pause early. This is a visible struggle, not only a money issue.
2. The admin's cost cards and margin figures overstate our cost and understate our margin: `buildCostLedger.ts:104`, `platformBuildMetrics.ts:131`, `routes/admin.ts:1713,1725`.
3. Historical Opus-tier build records are explained with the same rate (`explainBuildCost`).
4. `pricing.test.ts:67` locks the wrong value, which is why 1,935 green tests did not catch it.

Not affected:
- Chat (the PRO router, Opus-first) is unreachable since 2026-09-12 (`UniversalAIRouter.ts:117-123`).
- The mobile autofix uses Opus but is not billed to users.

**Root cause / class:** provider prices are hand-typed constants with no freshness check, no per-model
mapping within a family, and tests that pin the constant instead of the provider's price.

**Fix (needs approval — it lowers what Strong users pay):**
- Set the Opus defaults to 5 / 25. The `OPUS_*_PER_MTOK` env overrides stay.
- Price by model id within the family: opus-4-8 and opus-4-7 at 5 / 25; an unknown future Opus stays at the conservative upper bound.
- Re-point `pricing.test.ts:67` to a census test: every Claude id the code can call (`models.ts` defaults) must have a rate equal to a dated price table kept in one file.

**Regression test:** `realRateFor('CLAUDE_OPUS','claude-opus-4-8')` equals $5 / $25 with cache lines
$0.50 / $6.25. Prove it by reverting to 15 / 75 and watching the test fail.

**Missing evidence:**
- Whether `OPUS_INPUT_PER_MTOK` / `OPUS_OUTPUT_PER_MTOK` are set in Cloud Run (not in the registry, so probably not).
- How many past Strong builds reached the Opus rung — the admin cost card by tier can answer this.
- Whether to refund past overcharges is an admin decision.

### F-02 · P2 · Charge accuracy / integrity · the live USD→INR rate is accepted without a sanity band

**Where:** `src/server/lib/UsdInrRate.ts`.
- `refreshUsdInrRate` accepts any finite positive `rates.INR` from `open.er-api.com` and uses it for every bill.
- The rate is cached per Cloud Run instance; the fallback is 85.

**Failure:** one bad upstream value (e.g. 8,450 instead of 84.5, or a response from a compromised host)
multiplies every build, chat and tool bill on that instance until the next hourly refresh. Two instances
can also bill the same build at different rates.

**Fix:**
- Reject any value outside an absolute band (e.g. 60–150) or more than ±5% from the last good value.
- Keep the last good rate and log the refusal.
- Record the rate used on every debit. The build `costBreakdown` already carries it; the chat rollup should too.

**Regression test:** `refreshUsdInrRate` called with 8,450 keeps the previous rate.

**Confidence:** high that the band is missing. The probability of a bad upstream value is unknown.

### F-03 · P2 · Abuse / cost exposure · the per-account build lock does not hold across instances

**Where**
- The lock is in-process memory: `agentv3.ts:2339` (`activeBuilds`) and `:2428` (`runningBuilds`).
- Cloud Run scales to `_MAX_INSTANCES` instances at concurrency 100 (`cloudbuild.yaml:172-179`).
- The start gate only needs balance > 0 (`Affordability.ts:66`).
- The settle floor clamps at −₹50 (`walletFloor.ts`).

**Failure:**
1. Parallel build requests from one account that land on different instances each pass the gate.
2. The first to settle takes the balance to −₹50.
3. The rest are clamped, and their real cost is absorbed.

**Bound:** each build is still limited by the $5 real-cost ceiling. A low balance runs on the economy
engine.

**Fix:** reserve money at start. The all-or-nothing hold primitive already exists
(`holdWalletRolledUp` / `settleWalletHold`, floor 0). A Firestore lease for the account lock is the
alternative.

**Regression test:** two concurrent starts against one wallet; the second is refused, or holds nothing.

**Confidence:** medium. The code path is certain. Whether a client can land requests on different
instances in practice depends on load balancing; not reproduced live.

### F-04 · P2 · Policy exposure (admin decision) · ₹100 free credit per new web account, and failed builds cost us with no cap

**Where**
- `referralRewards.ts:104-110,153`: signup ₹50 + verified email ₹50, granted on every surface. On the web, no device check is involved.
- `payment.ts:430-436`: settled on sign-in by `/api/payment/reconcile`.
- A failed, empty or cancelled build bills ₹0 (`agentv3.ts:25831+`).
- `AGENTV3_USER_MONTHLY_CAP_USD` counts *billed* spend only and is unset (disabled) (`agentv3.ts:1649, 2308`).

**Exposure:**
- Each fresh Google account is a positive balance, and that is enough to start builds.
- Credit spent on successful builds costs us about 25–33% of its face value (the markup).
- Failed builds cost real money and consume no credit. Nothing bounds the real cost an account can absorb.

**Options:**
- (a) keep — growth over loss;
- (b) cap absorbed real cost per account per day (recommended; the ledger already has `absorbedUnbilledUsd`);
- (c) require mobile OTP before the free ₹50 email step on the web.

**Needs:** the admin's choice. Money and user-visible behaviour are not mine to change.

### F-05 · P2 · Store revenue (admin decision) · store pack prices do not model GST

**Where:** `storeBilling.ts:93-96`. The packs are ₹119→₹99, ₹299→₹249, ₹599→₹499, ₹1,199→₹999, with a 15%
fee. The header (`:31-33`) promises "our net is unchanged from the web rail". The fee note (`:57`) admits
"India also has GST in the middle".

**Arithmetic (if Play's Indian prices are GST-inclusive at 18%):**

```
₹119 / 1.18 × 0.85 ≈ ₹85.7 received, against ₹99 credited
```

That is a margin cut on every store pack. It is not a cash loss, because the credit is later spent at the
markup.

**Fix:** retune the packs from the first real payout report, or add a GST factor to `storePriceForCredit`.

**Missing evidence:** a Play Console / App Store payout statement. No figure here is presented as
measured.

### F-06 · P2 · Store integrity · a Play purchase is acknowledged only by the client

**Where:** `src/lib/playBillingNative.ts:139-149`. The client calls `consumePlayPurchase` after the server
credits. No server-side acknowledge exists; a repo-wide search for `acknowledge` in `src/server` found none.

**Failure:** Google refunds a purchase that is not acknowledged within 3 days. If the app never consumes
it — a crash, uninstall, or a modified client — Google refunds the user while the wallet keeps the credit.
The clawback for this exists in code (Q-690), but cannot run until the admin grants a Play Console
permission.

**Fix:** acknowledge server-side through the Play Developer API right after the credit. It needs the same
service account as Q-690.

**Regression test:** verify-then-acknowledge is called once per purchase token; a replay does not
re-acknowledge.

**Confidence:** medium (the client-only path is confirmed; deliberate exploitation is not reproduced).

### F-07 · P2 · Privacy (DPDP) · customer PII written to logs

**Where**
- `payment.ts:291`: every order logs the customer's name, email and phone.
- `payment.ts:469`: a webhook without an order id logs its whole body, which can carry customer details.

**Fix:** log the order id and a masked email only.

**Regression test:** a source guard that no `console.*` in `routes/payment.ts` interpolates customer
fields.

**Confidence:** high.

### F-08 · P3 · Information leak · raw gateway error returned to the browser

**Where:** `payment.ts:328-335`. On a failed order the raw Cashfree response body is returned as
`details` and logged in full.

**Fix:** return a generic message plus a reference id; keep the detail server-side.

### F-09 · P3 · Cashfree lifecycle · failed / dropped payments are treated as payments; PENDING never ends

**Where**
- `paymentReversal.ts:73-84`: anything that is not a refund or dispute is classified as a payment.
- So `PAYMENT_FAILED` and `USER_DROPPED` events run `verifyPaymentInternal`, which returns "Order not paid" with HTTP 400 (`payment.ts:528`).
- Cashfree re-delivers events that get a non-2xx answer.
- No FAILED or EXPIRED state is ever written.
- The sign-in sweep reads up to 50 PENDING orders with no ordering (`payment.ts:408`). A user with more than 50 abandoned checkouts may never have a newer paid order swept; the webhook still covers it.

**Fix:**
- Classify failed / dropped events, mark the order FAILED, and answer 200.
- Expire PENDING orders after the checkout session lifetime.
- `orderBy('createdAt','desc')` in the sweep.

**No money is mis-credited today.**

### F-10 · P3 · Redirect hygiene

**Where**
- `payment.ts:536-539`: `verify-redirect` puts `order_id` into the redirect URL without encoding it. It stays same-origin and Express escapes header characters, so this is parameter injection into the app, not an open redirect.
- `payment.ts:287-289`: `return_url` is built from the request's `Host` header, so a spoofed Host only redirects the spoofer's own checkout.

**Fix:** `encodeURIComponent`, and a configured canonical origin.

### F-11 · P3 · Fail-open amount check

**Where:** `payments.ts:323`. The paid-vs-recorded mismatch check is skipped when either amount is not a
number.

**Impact:** low. The credit is the server-recorded amount and the order must be PAID.

**Fix:** treat a non-numeric amount as a mismatch and refuse.

### F-12 · P3 · Revenue reporting

**Where:** `purchaseLedger.ts:170`. Store sales are reported at `amountPaid` = credit (₹99), not at the
store price (₹119) or the actual payout. The gateway's real fee on web payments is recorded nowhere. So the
admin's revenue card is neither gross nor net revenue.

**Fix:** report gross, fees and net as separate columns. The store fields (`storePriceInr`, `storeNetInr`)
already exist on the transaction.

### F-13 · P3 · Pricing accuracy (admin decision) · the aux remainder is priced at the Sonnet rate on every tier

**Where:** `providerRates.ts:326-330`. Model calls the ledger did not attribute are priced at $3 / $15. That
includes Weak and Normal builds, where those calls ran on far cheaper models.

**Effect:** a deliberate "never under-bill" choice that overcharges those users by an unmeasured amount.

**Real fix:** attribute aux calls in the ledger, so the remainder is about 0.

**Missing evidence:** the remainder's share in real builds. `billing.realCostRemainder` in reports would
show it.

### F-14 · P3 · Ledger durability

**Where:** `walletStatement.ts:57`. Debit history is an embedded array capped at 500 entries. Credits are
durable in `payment_transactions`; per-build bills are durable in the diagnostics reports. There is no
append-only per-entry ledger collection, so an old account's line-by-line history cannot be rebuilt (the
statement route honestly reports UNKNOWN).

**Fix:** also write each entry to an append-only `wallet_ledger_entries` collection, in the same
transaction.

### F-15 · P3 · Coupons (admin decision)

**Where**
- `promoCoupons.ts`: codes come only from the env and carry no expiry and no total-redemption cap per code (one redemption per user only).
- A coupon credit is not added to `freeGiftedTokens` (`payment.ts:646-676`), so it sits outside the ₹400 lifetime gift ceiling.

**Default:** no coupons. `PROMO_COUPONS` is not in the env registry, so whether it is set in production
is unknown.

---

## 5. Confirmed strengths (re-verified, not findings)

- **Credit from verified money only.** The order is re-read from Cashfree; the amount is checked; PENDING→SUCCESS is claimed and the wallet credited in one transaction (`payments.ts:300-330`).
- **Webhook security.** HMAC over the raw body, constant-time comparison; secret from the platform env only; an unconfigured secret is refused, not skipped (`payment.ts:478-495`).
- **Refunds and disputes (web) are clawed back** pro-rata, never below zero, idempotently (`paymentReversal.ts`; `tests/aRefundTakesBackWhatItBought.test.ts`).
- **Store verify.**
  - Google: purchaseState must be 0 and test purchases are refused.
  - Apple: Production environment only, no revocation.
  - The idempotency read is inside the transaction (`payment.ts:824-834`).
- **Coupons and gift codes:** claim and credit are atomic, and a gift code goes only to its buyer (`payment.ts:353-362`).
- **Debits.**
  - Transactional, idempotent on `buildRef`, sub-token carry and exact to 1e-6 of a token.
  - `paid-only` purchases refuse a charge that gift money would have covered.
  - Holds are all-or-nothing at floor 0 (`walletDebit.ts`).
- **No markup without proof.** A failed or empty build is ₹0; an unproven preview is billed at real cost only; the discount never goes below real cost (`agentv3.ts:25760-25860`, `previewEarnsMarkup.ts`).
- **Unmeasured provider calls bill ₹0, never an estimate** (`chatSpend.ts`, `aiTurnCharge.ts`).
- **Chat bills the markup once per request, not per call** (`chatSpend.ts:88-122`).
- **Authorization.** Every wallet route is checked against the verified uid (`routes/wallet.ts`, `requireUserMatch`). The admin balance adjustment is admin-token-gated, transactional, needs a reason, and is audit-logged (`admin.ts:2375-2432`).
- **Client writes refused.** `firestore.rules:77-98` refuses client writes to wallets and payment transactions.

---

## 6. Unit economics (formulas from the code; no production figures were available to this audit)

| Stream | Formula | Code constant |
|---|---|---|
| Web recharge | credit C = P × (1 − fee); cash in = P − gateway MDR | fee 2% (`DEFAULT_PLATFORM_FEE_PCT`); MDR UPI 0%, cards ≈ 2% + GST (per code comment — unverified) |
| Store pack | credit C fixed; cash in = S × (1 − f) ÷ (1 + GST?) | f = 15% (`STORE_FEE_PCT`); GST unmodelled (F-05) |
| Successful build | B = T(R) × FX; margin = B − R·FX | 75% at R ≤ $1, falling toward 66.7% |
| Build without preview proof | B = R·FX | margin 0 |
| Failed / empty / cancelled build | B = 0 | margin −R |
| Weak / free-list / pass-covered turn | B = 0 | margin −R (covered by pass revenue, or by growth intent) |
| Chat / tool (AI_WALLET_SPEND on) | B = T(Σ R) × FX × billable fraction | same curve; free allowance −R |
| Gift / coupon / referral credit when spent | our real cost ≈ face ÷ markup | ≈ 25–33% of face value |

**Missing for real profitability numbers:**
- Cashfree settlement reports.
- Play / Apple payout statements.
- Provider invoices (Anthropic, Z.ai, Moonshot, Google, xAI, E2B).
- The share of builds that fail or are unproven.

The admin cost card (`buildCostLedger.ts`) already measures real cost against the bill per build. Once
F-01 is fixed, its Opus rows will be correct.

**Rates verified in-session:**

| Provider | Rate | Result |
|---|---|---|
| Claude Haiku 4.5 | $1 / $5 | ✅ |
| Claude Sonnet 4.6 | $3 / $15 | ✅ |
| Claude Opus 4.8 | — | ❌ (F-01) |
| Gemini 2.5 Flash | $0.30 / $2.50 | ✅ |
| Gemini 2.5 Flash-Lite | $0.10 / $0.40 | ✅ |
| Gemini 2.5 Pro (≤ 200K input) | $1.25 / $10 | ✅ |

Gemini 2.5 Pro above 200K input ($2.50 / $15) is not modelled; it is unreachable on the live ladders.

**Not verifiable from this session** (the network refused docs.z.ai, platform.moonshot.ai and docs.x.ai):
GLM, Kimi, Grok, Nemotron and GPT rates. These are MISSING EVIDENCE, not confirmed.

---

## 7. Decision summary

- **A. Business model:** keep real cost × tiered markup at 100 tokens per ₹ (recommended), or adopt the brief's output-only model. Admin.
- **B. F-01 Opus price:** approve the correction to $5 / $25. Decide whether past Strong-Opus overcharges are refunded.
- **C. F-04 free-credit and failed-build exposure:** options (a) / (b) / (c) above. Recommended: (b).
- **D. F-05 store GST:** retune the packs after the first payout report (recommended), or add a GST factor now.
- **E. F-06 / Q-690:** grant the Play Console permission. It unlocks both the voided-purchase clawback and the server-side acknowledge.
- **F. F-15 coupons:** add per-code expiry and a total cap before any code goes public. Decide whether coupons count toward the ₹400 gift ceiling.
- **G. Hardening batch** (no price or policy change): F-02, F-03, F-07, F-08, F-09, F-10, F-11, F-12, F-14 — approve as one engineering batch.

---

## 8. Proposed, ordered remediation plan (nothing implemented — waiting for approval)

1. **F-01** — Opus rate to $5 / $25, per-model price census test, ceiling and admin cards follow automatically. Smallest change, largest user-facing effect.
2. **F-07** — remove PII from payment logs. Pure hardening, zero behaviour change.
3. **F-02** — FX sanity band, last good value kept.
4. **F-03** — reserve money at build start with the existing hold primitive (or a Firestore lease).
5. **F-06** — server-side Play acknowledge (after decision E).
6. **F-09 / F-10 / F-11 / F-08** — Cashfree lifecycle and redirect hygiene, one PR.
7. **F-12 / F-14** — revenue columns (gross / fees / net) and the append-only ledger collection.
8. **F-04 / F-05 / F-13 / F-15** — after the admin's decisions C, D and F.

Each step ships branch → full CI gate → PR → green. The merge is the admin's (CLAUDE.md, 2026-09-13).

---

## 9. Security and abuse summary

| Vector | State |
|---|---|
| Forge a payment credit | Blocked (gateway re-read + HMAC + transaction) |
| Replay a webhook / store receipt | Blocked (idempotent claim inside the transaction) |
| Credit another user (IDOR) | Blocked (verified uid on every money route) |
| Client writes a balance | Blocked (Firestore rules) |
| Refund and keep the credit — web | Clawed back |
| Refund and keep the credit — Play | Pending Q-690 / F-06 |
| Refund and keep the credit — Apple | Pending Q-614 |
| Parallel builds past the floor | F-03 |
| Free-credit farming / unlimited failed builds | F-04 |
| PII in logs | F-07 |
| Rate limits | `paymentLimiter` on create-order, verify, reconcile, coupon and store verify. The webhook is signature-gated instead |

---

## 10. Evidence and confidence per finding

| ID | Sev | Confidence | Reproduced | Fix needs approval |
|---|---|---|---|---|
| F-01 | P1 | High | Yes (numeric, in-session) | Yes (changes price) |
| F-02 | P2 | High (gap) | By reading | Engineering |
| F-03 | P2 | Medium | By reading | Engineering |
| F-04 | P2 | High (policy) | By reading | Yes (policy) |
| F-05 | P2 | Medium | Arithmetic only | Yes (price) |
| F-06 | P2 | Medium | By reading | Engineering + Console permission |
| F-07 | P2 | High | By reading | Engineering |
| F-08–F-12, F-14 | P3 | High | By reading | Engineering |
| F-13, F-15 | P3 | High (policy) | By reading | Yes (policy) |

---

## 11. Tests actually executed

```
npx vitest run <101 billing test files>   # list in the PR description
Test Files  101 passed (101)
     Tests  1935 passed (1935)
   Skipped  0   ·   Failed  0   ·   Duration 51.2 s
```

- **Selection:** every test file whose name matches wallet / payment / billing / pricing / refund / ledger / charge / spend / store / hosting / coupon / gift, plus every test file importing a core money module. Non-money ledgers (mistake, heal, takedown, failure) and app-generator tests were excluded.
- **Also run:** the F-01 numeric reproduction (`npx tsx`, output quoted in F-01).
- **Not run:**
  - live Cashfree sandbox orders (no sandbox credentials in this session, and the brief forbids real charges);
  - Play / Apple purchases;
  - load tests;
  - production log review.
- **Tests that pass while a defect is live:** `pricing.test.ts:67` (F-01).

---

## 12. File inventory

**Inspected in full**

| Area | Files |
|---|---|
| Payments | `routes/payment.ts`, `lib/payments.ts` |
| Debits and wallet | `lib/walletDebit.ts`, `lib/walletFloor.ts`, `lib/UsdInrRate.ts`, `routes/wallet.ts` (routes and guards) |
| Pricing | `AgentV3/pricing.ts`, `AgentV3/providerRates.ts`, `AgentV3/models.ts` |
| Build billing | `AgentV3/previewEarnsMarkup.ts`, `AgentV3/Affordability.ts`, `AgentV3/buildCostCeiling.ts` (header and config) |
| Chat billing | `lib/chatSpend.ts`, `lib/aiSpendZone.ts`, `lib/aiTurnCharge.ts` (decision logic) |
| Coupons and store | `lib/promoCoupons.ts`, `lib/storeBilling.ts` (pack and fee logic), `src/lib/playBillingNative.ts` (consume path) |
| Docs and rules | `docs/claude/ROUTING_AND_BILLING.md`, `firestore.rules` (money collections) |

**Inspected in part**

| Area | Files and parts |
|---|---|
| Build route | `routes/agentv3.ts`: bill decision 2113-2207, both settle paths, lock and cap 10391-10465, monthly cap |
| Refunds and routing | `lib/paymentReversal.ts` (classifier, order id), `AgentV3/tierLadder.ts` (ladders), `AgentV3/powerLevel.ts` (tiers) |
| Admin and revenue | `routes/admin.ts` (token adjust, welcome gift), `lib/referralRewards.ts` (step values), `lib/purchaseLedger.ts` (revenue fields) |
| Ledgers and fees | `lib/walletStatement.ts` (cap), `lib/storeVerify.ts`, `lib/buildCostLedger.ts` (header), `src/lib/platformFee.ts` (header) |
| Routers and infra | `AI/AIRouterManager.ts`, `AI/UniversalAIRouter.ts` (namespace reachability), `cloudbuild.yaml` (scaling flags) |

**Not inspected beyond their tests:**
- `hostingPlan*` / `hostingAddons`, `apkCharge`, `voiceBilling.ts`, `imageAllowance.ts`, `giftSpend.ts`, `navStoreRemixPurchase.ts`, `ProfessionalPassStore.ts`, `playVoidedPurchases.ts`, `paymentReversalStore.ts`, `cancelledBuildBilling.ts`, `unbilledTurns.ts`.
- These were covered by the 2026-09-12 and 2026-10-04 audits; their suites ran green here.
- Every provider adapter's token-usage parsing beyond `ClaudeClient.ts` cache handling.

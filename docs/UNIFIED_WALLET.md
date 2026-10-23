# Unified credit wallet (NavBharatAI Chat + Pro, one wallet)

## Switches (all default OFF, each independent)
| Env | Effect when on |
|---|---|
| `UNIFIED_WALLET_ENABLED` | every Free surface paid past the free quota (0.1 credit) + per-minute gate (`UNIFIED_WALLET_CHARGED_SURFACES`, default all) |
| `UNIFIED_WALLET_FREE_LIMIT` | signed-in free quota 20 → 25/day (guests stay 5) |
| `UNIFIED_WALLET_MARGIN` | `on` = real cost × 2.5 everywhere; a number 1.01–10 = that margin |
| `UNIFIED_WALLET_IMAGE_COUNTS_TEXT` | a delivered free image also uses one daily text message |

With all off, every path behaves exactly as on main.

## Charged surfaces (owner: nothing is free beyond the daily allowance)
Every surface that admits Free answers is charged 0.1 credit/message after the shared quota, by default:
`chat` (both NavBharatAI Chat aliases), `professionals` (Free professionals incl. Teacher AI chat), `exam`
(Free exam papers), `repo-analyst` (chat + generate). `withFreeAnswerQuota` requires a `surface`, and a test
scans every caller in the repo so a new one cannot be missed. `UNIFIED_WALLET_CHARGED_SURFACES` can narrow it.
Doctor AI / SDA / document & vision, paid professionals, tools and the developer API already charge real
metered cost from the same wallet after their own free allowance (× 2.5 with `UNIFIED_WALLET_MARGIN`).

## Hold lifecycle (review fixes)
- One paid reply at a time per user (`inflight_*` lock, 120 s expiry for a crashed owner).
- The 0.1 credit is kept ONLY if output was delivered. Cancel/abort before the first token, provider failure
  or timeout → released.
- Release/settle are retried 3× (idempotent by hold id). A final failure logs `[UNIFIED WALLET] ALERT` and
  stays in `unified_wallet_gate/hold_*` (`held`/`answered`).
- Sweeper `POST /api/admin/unified-wallet/sweep-holds` (Cloud Scheduler, every 5 min) closes holds older
  than 10 min: `answered` → settle, otherwise release. Needs a composite index on `unified_wallet_gate (state, at)`.
- Images: the text unit is taken only AFTER the picture was delivered, so no failure path can strand one.

## Units
1 credit = ₹1 = 100 wallet tokens (`TOKENS_PER_RUPEE`) = 1000 milli-credits. All new prices are integer
milli-credits, multiples of 10 (whole tokens = paise). No floats are introduced into the wallet.

## Flow (Free chat)
```
request ─► per-minute gate + once-only request id (unified_wallet_gate, Firestore txn)
        ─► daily allowance (existing free_answer_quota store, IST midnight reset)
             guest 5 · signed-in 20 (25 with UNIFIED_WALLET_FREE_LIMIT)
        ├─ allowance left ─► answer (failed reply restores the allowance, existing rule)
        └─ used up ─► guest: existing refusal
                      signed-in: HOLD 0.1 credit on user_token_wallets (all-or-nothing, never overdraws)
                         ├─ insufficient ─► 402 WALLET_INSUFFICIENT, message in hi / hinglish / en
                         └─ held ─► answer ─► settle (answered / uncertain) | release once (proven provider failure)
```
Low balance (< 5 credits) adds header `X-NB-Wallet-Notice` (URI-encoded, user's language).

## One margin everywhere (owner 2026-10-23: "asli kharche me 2.5 guna, har jagah")
`UNIFIED_WALLET_MARGIN=on` (= 2.5) or a number; optional per-service `UNIFIED_WALLET_MARGIN_<SERVICE>`
(AI, BUILD, HOSTING, …), bounded 1–10. Independent of `UNIFIED_WALLET_ENABLED`.

| Service | Main (flag off) | Unified wallet on |
|---|---|---|
| Pro app builds | real × 4 (first $1) then × 3 | real × 2.5 (`tieredMarkupUsd(…, 'build')`) |
| Doctor AI / SDA / vision, Professionals, AI tools, app assistant, Developer API | same ×4/×3 curve (`chatSpend`) | real × 2.5 |
| Opus build tier | flat real × 2 | unchanged (flat, separate path) |
| Hosting real-cost markup (`hostingMarkupPct`) | +20% | +150% (= 2.5×) |
| Hosting overage (frontend + backend) | ₹20/GB | ceil(egress $/GiB × USD→INR × 2.5) when `NAVBHARAT_RATE_EGRESS_GIB` is set; else ₹20 |
| NavBharatAI Chat past free quota | — | ₹0.10/message (owner rate; ≈6–7× a ~₹0.015 real cost, not 2.5×) |
| Images (paid rungs) | ₹1/image after 5 free | unchanged — **no per-image cost meter** |
| Voice | 2 paise/second | unchanged — **no cost meter** |
| APK | ₹1 | unchanged — **no cost meter** |
| Hosting plans / database / add-ons | fixed plan prices | unchanged — prepaid plans, not a metered cost |
| App Mart purchase | seller price | unchanged — not a cost of ours |

Cancelled-build rules (`cancelledBuildBilling.ts`) are untouched; they act on the bill computed above.
Derived fixed prices use `derivedPricePaise(realInr, margin)` = ceil to the paisa.

## Pay-and-use only (owner decisions 2026-10-23)
- No subscriptions. The user recharges the wallet; 1 credit = ₹1.
- The EXISTING minimum recharge (from ₹1) is unchanged; this change adds no minimum.
- Suggested packs (shortcuts only) are config: `UNIFIED_WALLET_RECHARGE_PACKS` default ₹20/₹50/₹100/₹500,
  GST-inclusive (`rechargePackView`: paise GST split, credits, chat messages — ₹20 → 200 messages).
- Recharging never removes the daily free allowance: free quota is always consumed first, then the wallet.
- The existing payment credit path mints the credits — unchanged here.

## Images
Existing rule unchanged: `AI_IMAGE_FREE_PER_DAY` (5) free images a day, then the existing per-image price from
the same wallet. With `UNIFIED_WALLET_IMAGE_COUNTS_TEXT` on, every DELIVERED free image also uses one daily text
message (counted after delivery). Best-effort: a full or busy text quota never blocks an image.

## Generic service debit
`holdService(db, uid, {service, amountMilli, idempotencyKey, description})` → `finishService(..., outcome)`.
Services: chat, build, image, hosting, database, apk, appmart, api (mapped to existing wallet features; new
feature id `database`). Chat already uses it; the others can plug in later without a new money path.

## Naming
Wallet/ledger labels added here say **NavBharatAI Chat**. The site-wide rename of "NavBharatAI Free" is a
follow-up, not part of this PR.

## Reused (not duplicated)
`holdWalletRolledUp` / `releaseWalletHold` / `settleWalletHold` / `debitWalletForBuild` (walletDebit.ts),
`wallet_ops` dedupe, `mirroredCreditPatch`, `ledgerPatch` (bounded append-only ledger), canonical merged
wallet resolution, `spendByFeature` (new feature id `free-chat`), `FreeAnswerQuotaStore` (allowance, IST
reset, idempotency, failure refund), the overdraft floor and the existing audited admin adjust.

## Admin
- `GET /api/admin/unified-wallet/:userId` — config, balance, spend by feature, last 50 ledger rows.
- Manual balance change: existing `POST /api/admin/users/:userId/tokens` (reason required, audited).

## Setup
1. Deploy with flag off. 2. Set env values (see `.env.example`). 3. Firestore TTL on `expireAt` for
`unified_wallet_gate` (optional; docs are small). 4. Turn `UNIFIED_WALLET_ENABLED=1` on a canary first.

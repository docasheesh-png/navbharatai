# Unified credit wallet (NavBharatAI Chat + Pro, one wallet)

Flag: `UNIFIED_WALLET_ENABLED` (default **off**). With it off, every path behaves exactly as on main.

## Units
1 credit = ₹1 = 100 wallet tokens (`TOKENS_PER_RUPEE`) = 1000 milli-credits. All new prices are integer
milli-credits, multiples of 10 (whole tokens = paise). No floats are introduced into the wallet.

## Flow (Free chat)
```
request ─► per-minute gate + once-only request id (unified_wallet_gate, Firestore txn)
        ─► daily allowance (existing free_answer_quota store, IST midnight reset)
             guest 5 · signed-in 25 (config)
        ├─ allowance left ─► answer (failed reply restores the allowance, existing rule)
        └─ used up ─► guest: existing refusal
                      signed-in: HOLD 0.1 credit on user_token_wallets (all-or-nothing, never overdraws)
                         ├─ insufficient ─► 402 WALLET_INSUFFICIENT, message in hi / hinglish / en
                         └─ held ─► answer ─► settle (answered / uncertain) | release once (proven provider failure)
```
Low balance (< 5 credits) adds header `X-NB-Wallet-Notice` (URI-encoded, user's language).

## One margin everywhere (owner 2026-10-23: "asli kharche me 2.5 guna, har jagah")
`UNIFIED_WALLET_MARGIN` (default **2.5**), optional per-service `UNIFIED_WALLET_MARGIN_<SERVICE>`
(AI, BUILD, HOSTING, …), bounded 1–10. Applied only while `UNIFIED_WALLET_ENABLED` is on.

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
the same wallet. New (config `UNIFIED_WALLET_IMAGE_COUNTS_TEXT`, default on while the flag is on): every FREE
image also uses one of the 25 daily text messages; it is given back if the image is not delivered. Best-effort:
an empty or busy text quota never blocks an image.

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

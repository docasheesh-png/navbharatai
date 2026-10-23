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

## Pro builds
Unchanged debit path (`debitWalletForBuild`, same wallet). When enabled the bill is
`billable real cost × UNIFIED_WALLET_BUILD_MARGIN` (default 2.5, pending owner) instead of the tiered ×4/×3 curve.
Opus flat billing, per-tier billing and all `cancelledBuildBilling` rules are untouched.

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

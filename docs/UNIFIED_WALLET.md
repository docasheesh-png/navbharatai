# Unified credit wallet (NavBharatAI Free chat + Pro, one wallet)

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
                         ├─ insufficient ─► 402 WALLET_INSUFFICIENT, message in hi / hinglish / en, min recharge ₹20
                         └─ held ─► answer ─► settle (answered / uncertain) | release once (proven provider failure)
```
Low balance (< 5 credits) adds header `X-NB-Wallet-Notice` (URI-encoded, user's language).

## Pro builds
Unchanged debit path (`debitWalletForBuild`, same wallet). When enabled the bill is
`billable real cost × UNIFIED_WALLET_BUILD_MARGIN` (default 2) instead of the tiered ×4/×3 curve.
Opus flat billing, per-tier billing and all `cancelledBuildBilling` rules are untouched.

## Pay-and-use only (owner decision 2026-10-23: no subscriptions)
No monthly plans. The user recharges the wallet; 1 credit = ₹1. Packs are config (`UNIFIED_WALLET_RECHARGE_PACKS`,
default ₹20 / ₹50 / ₹100 / ₹500, minimum `UNIFIED_WALLET_MIN_RECHARGE_INR` = ₹20), shown GST-inclusive
(`rechargePackView` gives the paise GST split, credits and Free chat messages per pack: ₹20 → 200 messages).
The existing payment/credit path (`computeCreditedWallet`, platform fee) mints the credits — unchanged here.

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

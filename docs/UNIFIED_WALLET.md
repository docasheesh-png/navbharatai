# Unified credit wallet (NavBharatAI Free chat + Pro, one wallet)

Flag: `UNIFIED_WALLET_ENABLED` (default **off**). With it off, every path behaves exactly as on main.

## Units
1 credit = ₹1 = 100 wallet tokens (`TOKENS_PER_RUPEE`) = 1000 milli-credits. All new prices are integer
milli-credits, multiples of 10 (whole tokens = paise). No floats are introduced into the wallet.

## Flow (Free chat)
```
request ─► per-minute gate + once-only request id (unified_wallet_gate, Firestore txn)
        ─► daily allowance (existing free_answer_quota store, IST midnight reset)
             guest 5 · signed-in 25 · plan.dailyMessages if higher
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

## Plans (owner decision pending)
Config-driven (`UNIFIED_WALLET_PLANS`); prices are GST-inclusive (`gstBreakdown` gives the paise split).
A plan can grant **monthly credits** into the wallet and/or a **daily message allowance**.
Defaults: ₹99 → 99 credits, ₹999 → 999 credits (usable for chat OR builds). Alternative from the owner:
₹99 → 125 msgs/day, ₹999 → 1500 msgs/day — set `dailyMessages` (and `monthlyCredits: 0`).
Entitlement is read from `unified_wallet_plans/{uid}` `{planId, periodEndMs}`; credits are granted with
`grantPlanCredits(uid, planId, 'YYYY-MM')` (idempotent via `wallet_ops`). Purchase wiring belongs to the
payments flow and is **not** part of this change.

## Reused (not duplicated)
`holdWalletRolledUp` / `releaseWalletHold` / `settleWalletHold` / `debitWalletForBuild` (walletDebit.ts),
`wallet_ops` dedupe, `mirroredCreditPatch`, `ledgerPatch` (bounded append-only ledger), canonical merged
wallet resolution, `spendByFeature` (new feature id `free-chat`), `FreeAnswerQuotaStore` (allowance, IST
reset, idempotency, failure refund), the overdraft floor and the existing audited admin adjust.

## Admin
- `GET /api/admin/unified-wallet/:userId` — config, balance, plan, spend by feature, last 50 ledger rows.
- `POST /api/admin/unified-wallet/:userId/plan-grant` `{planId, periodKey, reason}` — audited (`ADMIN_UNIFIED_PLAN_GRANT`).
- Manual balance change: existing `POST /api/admin/users/:userId/tokens` (reason required, audited).

## Setup
1. Deploy with flag off. 2. Set env values (see `.env.example`). 3. Firestore TTL on `expireAt` for
`unified_wallet_gate` (optional; docs are small). 4. Turn `UNIFIED_WALLET_ENABLED=1` on a canary first.

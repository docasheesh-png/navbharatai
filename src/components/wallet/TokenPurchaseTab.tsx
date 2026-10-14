// PAGE 1 — BUY TOKENS.
//
// One question: "how many tokens do I want, and what will it cost?". The amount is chosen with a few
// quick chips or typed, the exact tokens that will arrive are printed BEFORE paying, and there is ONE
// primary button. Everything money-related underneath is the existing machinery, untouched:
//   • the web order is created by `onCreateBillingOrder` (App.tsx → usePaymentEngine) and credited by the
//     server only after the gateway confirms it — this screen never decides a payment succeeded;
//   • the store rails are the server's own catalogue (`storeConfig.packs`), priced with their fee inside;
//   • the platform-fee split comes from the SAME pure module the server settles with, so the tokens shown
//     here are the tokens that arrive.
//
// 🔒 THE PAYMENT RAIL IS NOT A CHOICE THE USER MAKES. It is decided by where the app runs (storePurchase.ts):
// the website uses the gateway; the Play build uses Google Play packs INSTEAD of it (Play policy forbids
// offering both); the iPhone app cannot buy at all and says so plainly — without pointing anywhere else
// (Apple's anti-steering rule). A radio between rails would offer one that is not allowed to work.
//
// 🔒 NO VENDOR NAME ON SCREEN (White-Label Law): "UPI, cards and net banking", never the gateway's name.
//
// 🔒 APP LOCK. The gate sits around STARTING a purchase, never finishing one — see the original note in
// BillingPanel's history: a user who has already paid must not meet a PIN prompt on the way back.

import { useMemo } from 'react';
import { AlertCircle, CheckCircle2, Clock, Loader2, ShieldCheck } from 'lucide-react';
import { cn } from '../../lib/utils';
import { AppLockGate } from '../AppLockGate';
import { packBreakdown, type PurchaseRail, type StoreConfig } from '../../lib/storePurchase';
import { splitPaymentAtPct } from '../../lib/platformFee';
import { TOKENS_PER_RUPEE } from '../../lib/walletPricing';
import { quickAmounts, selectedQuickAmount } from '../../lib/walletQuickAmounts';
import { paymentRows } from '../../lib/walletPaymentRows';
import { TOP_UP_DOT_LABEL } from '../../lib/walletNeedsTopUp';

export const MIN_BUY_INR = 1;
export const MAX_BUY_INR = 999_999;

export interface TokenPurchaseTabProps {
  userId: string;
  platformFeePct: number;
  storeRail: PurchaseRail;
  storeConfig: StoreConfig | null;
  buyingProductId: string | null;
  storePurchaseNotice: string | null;
  onBuyStorePack?: (productId: string) => void;
  buyAmountInput: string;
  onSetBuyAmountInput: (v: string) => void;
  isRecharging: boolean;
  onCreateBillingOrder: (amount: number) => void;
  needsTopUp: boolean;
  billingTransactions: unknown;
}

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const tokensText = (n: number) => `${n.toLocaleString('en-IN')} tokens`;

/** Is the typed amount one the server will accept. The server re-checks every order regardless. */
export function buyAmountProblem(input: string): string | null {
  const n = parseFloat(input);
  if (!input.trim() || Number.isNaN(n)) return 'Enter how much you want to pay.';
  if (n < MIN_BUY_INR) return `The smallest amount is ${inr(MIN_BUY_INR)}.`;
  if (n > MAX_BUY_INR) return `The largest amount is ${inr(MAX_BUY_INR)}.`;
  return null;
}

function RecentPayments({ transactions }: { transactions: unknown }) {
  const rows = useMemo(() => paymentRows(transactions, 5), [transactions]);
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="wallet-recent-payments" className="space-y-2">
      <h3 id="wallet-recent-payments" className="text-xs font-bold text-muted">Your recent payments</h3>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.reference} className="rounded-2xl border border-line bg-card p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-ink">{inr(r.amountInr)}</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs font-semibold">
                  {r.status === 'paid' && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden />}
                  {r.status === 'waiting' && <Clock className="h-3.5 w-3.5 shrink-0 text-warn" aria-hidden />}
                  {r.status === 'failed' && <AlertCircle className="h-3.5 w-3.5 shrink-0 text-danger" aria-hidden />}
                  <span className={cn(r.status === 'paid' ? 'text-success' : r.status === 'failed' ? 'text-danger' : 'text-warn')}>
                    {r.statusText}
                  </span>
                </p>
              </div>
              <div className="shrink-0 text-right">
                {r.tokens !== null && <p className="text-sm font-bold text-success">+{r.tokens.toLocaleString('en-IN')}</p>}
                {r.whenMs !== null && (
                  <p className="text-[11px] font-semibold text-muted">
                    {new Date(r.whenMs).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </p>
                )}
              </div>
            </div>
            <p className="mt-2 break-all text-[11px] text-muted">Reference: {r.reference}</p>
            {r.status === 'waiting' && (
              <p className="mt-1 text-[11px] font-semibold text-muted">
                If you have paid, your tokens appear here once it is confirmed. Use Refresh at the top to check again.
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function TokenPurchaseTab(props: TokenPurchaseTabProps) {
  const {
    platformFeePct, storeRail, storeConfig, buyingProductId, storePurchaseNotice, onBuyStorePack,
    buyAmountInput, onSetBuyAmountInput, isRecharging, onCreateBillingOrder, needsTopUp, billingTransactions,
  } = props;

  const chips = useMemo(() => quickAmounts(platformFeePct), [platformFeePct]);
  const amount = parseFloat(buyAmountInput) || 0;
  const split = splitPaymentAtPct(amount, platformFeePct);
  const tokens = Math.round(split.creditInr * TOKENS_PER_RUPEE);
  const problem = buyAmountProblem(buyAmountInput);
  const picked = selectedQuickAmount(buyAmountInput);

  return (
    <AppLockGate
      userId={props.userId}
      area="wallet_recharge"
      embedded
      render={() => (
        <div className="space-y-5">
          <p className="text-sm font-semibold text-body">
            <span className="font-bold text-ink">100 tokens = ₹1.</span> Tokens pay for building apps, hosting and
            AI features. They never expire.
          </p>

          {storePurchaseNotice && (
            <div role="status" className="rounded-2xl border border-line bg-card p-4 text-sm font-semibold text-success">
              {storePurchaseNotice}
            </div>
          )}

          {storeRail === 'none' ? (
            // 🍎 Apple 3.1.1: stated, not hidden, and it does NOT say "buy on the website".
            <div className="space-y-2 rounded-2xl border border-line bg-card p-5">
              <h3 className="text-sm font-bold text-ink">Buying tokens is not available in this app</h3>
              <p className="text-sm text-muted">
                Your balance, your apps and any tokens you already have all work exactly as before.
              </p>
            </div>
          ) : storeRail === 'play-billing' && storeConfig ? (
            <section className="space-y-3" aria-labelledby="wallet-play-packs">
              <h3 id="wallet-play-packs" className="text-sm font-bold text-ink">How many tokens?</h3>
              <ul className="space-y-2.5">
                {storeConfig.packs.map((pack) => {
                  const b = packBreakdown(pack);
                  const busy = buyingProductId === pack.productId;
                  return (
                    <li key={pack.productId}>
                      <button
                        type="button"
                        onClick={() => onBuyStorePack?.(pack.productId)}
                        disabled={!!buyingProductId}
                        className="flex min-h-[56px] w-full items-center justify-between gap-3 rounded-2xl border border-line bg-card p-4 text-left transition-colors hover:bg-raised disabled:opacity-50"
                      >
                        <span className="min-w-0">
                          <span className="block text-base font-bold text-ink">{tokensText(b.creditInr * TOKENS_PER_RUPEE)}</span>
                          {!b.feeFree && (
                            <span className="block text-xs font-semibold text-muted">
                              {inr(b.creditInr)} credit + {inr(b.storeFeeInr)} Google Play fee
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block text-base font-bold text-ink">{inr(b.priceInr)}</span>
                          {busy && <span className="block text-xs font-semibold text-accent-text">Opening Google Play…</span>}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="text-xs font-semibold text-muted">
                Purchases in this app are made through Google Play, which adds a fee shown above. Your wallet
                receives the full token amount shown, never less.
              </p>
            </section>
          ) : (
            <section className="space-y-4" aria-labelledby="wallet-amount">
              <h3 id="wallet-amount" className="text-sm font-bold text-ink">How much do you want to add?</h3>

              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3" role="group" aria-label="Quick amounts">
                {chips.map((c) => (
                  <button
                    key={c.amountInr}
                    type="button"
                    onClick={() => onSetBuyAmountInput(String(c.amountInr))}
                    aria-pressed={picked === c.amountInr}
                    className={cn(
                      'min-h-[64px] rounded-2xl border p-3 text-left transition-colors',
                      picked === c.amountInr ? 'border-accent bg-accent/10' : 'border-line bg-card hover:bg-raised',
                    )}
                  >
                    <span className="block text-lg font-bold text-ink">{inr(c.amountInr)}</span>
                    <span className="block text-xs font-semibold text-muted">{tokensText(c.tokens)}</span>
                  </button>
                ))}
              </div>

              <div className="space-y-1.5">
                <label htmlFor="wallet-buy-amount" className="block text-xs font-bold text-muted">Or type any amount (₹)</label>
                <div className="flex items-center gap-2 rounded-2xl border border-line bg-surface px-4 py-1 focus-within:border-accent">
                  <span className="text-base font-bold text-muted" aria-hidden>₹</span>
                  <input
                    id="wallet-buy-amount"
                    type="number"
                    inputMode="decimal"
                    min={MIN_BUY_INR}
                    max={MAX_BUY_INR}
                    value={buyAmountInput}
                    onChange={(e) => onSetBuyAmountInput(e.target.value)}
                    className="min-h-[44px] min-w-0 flex-1 bg-transparent text-base font-bold text-ink focus:outline-none"
                    placeholder="Amount"
                    aria-invalid={problem !== null && buyAmountInput.trim() !== ''}
                  />
                </div>
                {problem && buyAmountInput.trim() !== '' && (
                  <p role="alert" className="text-xs font-semibold text-danger">{problem}</p>
                )}
              </div>

              {/* WHAT ARRIVES — printed before the user pays, from the server's own arithmetic. */}
              <div className="space-y-1.5 rounded-2xl bg-well p-4" aria-live="polite">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-semibold text-muted">You pay</span>
                  <span className="text-lg font-bold text-ink">{inr(amount > 0 ? amount : 0)}</span>
                </div>
                {split.feeInr > 0 && (
                  <div className="flex items-baseline justify-between gap-3 text-xs font-semibold text-muted">
                    <span>Platform fee ({platformFeePct}%)</span>
                    <span>−₹{split.feeInr.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex items-baseline justify-between gap-3 border-t border-line pt-1.5">
                  <span className="text-sm font-semibold text-muted">You get</span>
                  <span className="text-lg font-bold text-success">{tokensText(problem ? 0 : tokens)}</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => { if (!problem) onCreateBillingOrder(parseFloat(buyAmountInput)); }}
                disabled={isRecharging || problem !== null}
                title={needsTopUp ? TOP_UP_DOT_LABEL : undefined}
                className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-accent px-5 py-3.5 text-base font-bold text-on-accent transition-opacity disabled:opacity-40"
              >
                {needsTopUp && <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-danger" />}
                {isRecharging
                  ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Opening secure checkout…</>
                  : problem ? 'Choose an amount to continue' : `Pay ${inr(amount)} for ${tokensText(tokens)}`}
              </button>
              {needsTopUp && <span className="sr-only">{TOP_UP_DOT_LABEL}</span>}

              <p className="flex items-start gap-2 text-xs font-semibold text-muted">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
                <span>
                  Pay with UPI, cards or net banking on a secure checkout. Tokens are added only after the
                  payment is confirmed.
                </span>
              </p>
            </section>
          )}

          <RecentPayments transactions={billingTransactions} />
        </div>
      )}
    />
  );
}

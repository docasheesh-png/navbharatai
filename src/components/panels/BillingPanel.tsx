/**
 * Phase 1.7 — App.tsx split, Part 8: BillingPanel
 *
 * Extracted from App.tsx (was the `activeView === 'billing'` block, ~784 lines).
 * Multi-model token wallet: balance cards, transactions, promo codes,
 * buy-credit gateway, and budget/reminder SRE limits.
 *
 * Pure render — all state and side effects stay in App.tsx and are threaded in
 * via explicit typed props. No behavior change.
 */
import { cn } from '../../lib/utils';
import { HostingPlanCard } from './HostingPlanCard';
import { ReferralPanel } from './ReferralPanel';
import { WalletStatementPanel } from './WalletStatementPanel';
import type { ReferralProgress } from '../../hooks/useReferralProgress';
import { AppLockGate } from '../AppLockGate';
import {
  Wallet, Zap, RefreshCw, AlertCircle, Sparkles, Gift, CreditCard,
  Activity, CheckCircle2,
} from 'lucide-react';

import { packBreakdown, type PurchaseRail, type StoreConfig } from '../../lib/storePurchase';
import { splitPaymentAtPct, DEFAULT_PLATFORM_FEE_PCT, giftPriceAtPct } from '../../lib/platformFee';
import { giftWhatsAppUrl, type GiftCodeRow } from '../../lib/giftCodeRow';

/**
 * Fallback bounds for the gift form, used only until the server's own numbers arrive.
 *
 * They MATCH `giftCodes.ts` deliberately: a form that offered an amount the server refuses would
 * produce a refusal the user cannot act on. The server is still the authority — it re-checks every
 * order — these are what the field shows in the first render.
 */
const MIN_GIFT_FALLBACK_INR = 100;
const MAX_GIFT_FALLBACK_INR = 5_000;
import { aiSpendSummary, formatInr } from '../../lib/aiSpendSummary';
import { walletNeedsTopUp, TOP_UP_DOT_LABEL } from '../../lib/walletNeedsTopUp';

type BillingDetailTab = 'purchase' | 'gift' | 'use' | 'remaining';
type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface BillingPanelProps {
  user: { uid: string; email?: string | null } | null;
  wallet: any;
  loadingWallet: boolean;
  dailyUsage: { date: string; count: number; builds: number };
  billingTransactions: any[];
  billingLogs: any[];
  activeBillingDetailTab: BillingDetailTab;
  couponCodeInput: string;
  isRedeemingCoupon: boolean;
  couponError: string | null;
  couponSuccess: string | null;
  buyAmountInput: string;
  isRecharging: boolean;
  /**
   * GOOGLE PLAY BILLING (admin 2026-09-06). `storeRail` is the pure decision from storePurchase.ts:
   * 'play-billing' ONLY on a native shell where the server says the rail is configured AND this
   * build has the native plugin. Everywhere else it is 'web-gateway' and this panel renders exactly
   * what it renders today — which is what makes shipping the rail unable to strand anyone.
   */
  /**
   * The wallet-recharge platform fee, in percent, as this server actually charges it. Threaded in
   * (rather than fetched here) because this panel is a pure render — see the file header. The
   * default is the server's own fallback, so a config route that never answered still shows the
   * user the number they will really be charged.
   */
  platformFeePct?: number;
  storeRail?: PurchaseRail;
  storeConfig?: StoreConfig | null;
  buyingProductId?: string | null;
  storePurchaseNotice?: string | null;
  onBuyStorePack?: (productId: string) => void;
  onShowAuth: () => void;
  onFetchWallet: () => void;
  onSetActiveBillingDetailTab: (tab: BillingDetailTab) => void;
  onSetCouponCodeInput: (v: string) => void;
  /** The referral state for this account — see useReferralProgress. Empty off Android. */
  referral: ReferralProgress;
  onRefreshReferral: () => void;
  onRedeemPromoCoupon: (code: string) => void;
  onSetBuyAmountInput: (v: string) => void;
  onCreateBillingOrder: (amount: number) => void;
  /**
   * GIFT CODES (admin 2026-09-22). All optional, and the whole section is gated on
   * `onCreateGiftOrder` being supplied — a panel rendered without the wiring shows nothing rather
   * than a button that does nothing, which is what the second absolute rule requires.
   */
  giftFaceInput?: string;
  onSetGiftFaceInput?: (v: string) => void;
  isBuyingGift?: boolean;
  giftError?: string | null;
  giftCodes?: GiftCodeRow[];
  giftBounds?: { minInr: number; maxInr: number };
  lastGiftCode?: GiftCodeRow | null;
  onCreateGiftOrder?: (faceInr: number) => void;
  onToast: (message: string, type?: ToastType) => void;
  /** Phase 4.2 — current month's AI cost accumulated from Pro builds. */
  monthlyAiCost?: { totalBuilds: number; totalCostUsd: number; month: string } | null;
}

export function BillingPanel(props: BillingPanelProps) {
  const {
    user, wallet, loadingWallet, dailyUsage,
    billingTransactions, billingLogs, activeBillingDetailTab,
    couponCodeInput,
    isRedeemingCoupon, couponError, couponSuccess,
    buyAmountInput, isRecharging,
    platformFeePct = DEFAULT_PLATFORM_FEE_PCT,
    storeRail = 'web-gateway', storeConfig = null, buyingProductId = null,
    storePurchaseNotice = null, onBuyStorePack,
    onShowAuth, onFetchWallet, onSetActiveBillingDetailTab, onSetCouponCodeInput,
    onRedeemPromoCoupon, onSetBuyAmountInput, referral, onRefreshReferral,
    onCreateBillingOrder, onToast,
    giftFaceInput = '500', onSetGiftFaceInput, isBuyingGift = false, giftError = null,
    giftCodes = [], giftBounds = { minInr: MIN_GIFT_FALLBACK_INR, maxInr: MAX_GIFT_FALLBACK_INR },
    lastGiftCode = null, onCreateGiftOrder,
  } = props;

  /**
   * The price of the gift being composed, from the SAME pure function the server prices the order
   * with — so the buyer cannot be shown one number and charged another. A blank or junk input is a
   * zero price and the button below is disabled, rather than a NaN reaching the screen.
   */
  const giftPrice = giftPriceAtPct(Math.floor(Number(giftFaceInput) || 0), platformFeePct);
  const { monthlyAiCost } = props;

  // THE LAST TWO STEPS OF THE TOP-UP TRAIL (admin 2026-09-22: "☰ → wallet and billing → buy token →
  // purchage wallet token par ek red dot"). The same predicate the ☰ button and the sidebar row use,
  // so the dot cannot lead somewhere it then disappears from — which is exactly how a trail loses a
  // user. It reads the wallet this panel was already handed; nothing is fetched for it.
  const needsTopUp = walletNeedsTopUp({ wallet, loading: loadingWallet });

  // TOTAL AI SPEND — the real ₹ this wallet has been charged, derived from its own ledger by the same
  // arithmetic the debit used (`tokens / TOKENS_PER_RUPEE`). Same principle as `rechargeSplit` below:
  // the screen recomputes the server's own number rather than displaying a separately-recorded one
  // that is free to drift from it. Cheap and synchronous — it reads a wallet already in memory, so it
  // needs no fetch and nothing to keep in sync.
  const aiSpend = aiSpendSummary(wallet);

  // The recharge split, computed by the SAME pure function the server settles with. One money rule,
  // one implementation — the user is never shown a number the server will later disagree with.
  const rechargeSplit = splitPaymentAtPct(parseFloat(buyAmountInput) || 0, platformFeePct);

  return (
    <div className="flex-1 bg-surface p-6 text-left min-h-screen">
      {!user ? (
        <div className="max-w-md mx-auto text-center py-24 space-y-6">
          <div className="w-20 h-20 bg-indigo-600/10 rounded-[2rem] flex items-center justify-center mx-auto border border-indigo-600/20 shadow-2xl">
            <Wallet className="w-10 h-10 text-accent-text" />
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-black text-ink uppercase tracking-tight">Active Portal Session Required</h2>
            <p className="text-muted font-medium text-sm">Please sign in or register to set up your navBharatAI multi-model cloud token budget.</p>
          </div>
          <button
            onClick={onShowAuth}
            className="px-8 py-4 bg-indigo-600 hover:bg-indigo-700 text-on-accent rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-indigo-600/30 transition-all active:scale-95"
          >
            Authenticate Profile
          </button>
        </div>
      ) : (
        <div className="w-full max-w-6xl mx-auto space-y-8 py-4">
          {/* Header bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-6">
            <div>
              <div className="flex items-center gap-2 text-accent-text font-black uppercase tracking-widest text-[10px] font-mono">
                <Zap className="w-4 h-4 text-warn animate-bounce" />
                Cloud Token Ledger
              </div>
              <h1 className="text-3xl font-black text-ink uppercase tracking-tight mt-1">Multi-Model Token Wallet</h1>
              <p className="text-xs text-muted mt-1">Connected account: <span className="text-ink font-mono font-bold">{user.email}</span></p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={onFetchWallet}
                disabled={loadingWallet}
                className="flex items-center gap-2 px-6 py-3 bg-raised border border-line hover:border-indigo-500 rounded-2xl text-[10px] font-black uppercase tracking-widest text-ink transition-all active:scale-95"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingWallet ? 'animate-spin' : ''}`} />
                Sync Balance
              </button>
            </div>
          </div>

          {/*
            THE THREE WALLET CAPSULES — one horizontal row (admin 2026-09-22: "wallet and billing me
            all 3 options ko horizontal 3 capsule ke jaise banao! (buy token) (token balance)
            (promocode credit) jisse ui clear hoga").

            They were three tall cards, one per row on a phone — three screens' worth of chrome before
            the panel below them. As capsules they are one row, ~56px, and the tab they open is
            immediately visible underneath.

            🔴 THE ONE THING THIS LAYOUT MUST NOT RE-CREATE, and it is written in this file's own
            history: four tiles in `grid-cols-2` once gave each ~160px and truncated the balance to
            "89,894 tok…" — the one number the screen exists to show. Three capsules on a 360px phone
            is ~98px each, which is TIGHTER, so a plain grid would reproduce that defect exactly.

            So this is a FLEX row, not a grid: `flex-1` makes the three share the width equally while
            they fit, and `min-w-fit` stops any of them shrinking below its own content. A seven-digit
            balance therefore makes the row SCROLL rather than cut the number — the value never
            truncates at any width, which a grid cannot promise. Measured in a real browser at 360 /
            390 / 414px before this shipped.

            Colour is unchanged from the cards: Buy tokens is the only ACTION so it is the only solid
            fill (`text-on-accent` is legitimate only on a solid fill); the two data capsules keep the
            card surface with a hue border and a solid icon chip.
          */}
          <div className="flex items-stretch gap-2 sm:gap-3 overflow-x-auto no-scrollbar -mx-1 px-1 py-1">

            {/* CAPSULE 1 — BUY TOKENS. The only action, so the only solid fill. */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => onSetActiveBillingDetailTab('purchase')}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSetActiveBillingDetailTab('purchase'); } }}
              className={cn(
                "relative flex-1 min-w-fit flex items-center gap-1.5 sm:gap-2 rounded-full px-2.5 sm:px-4 py-2 cursor-pointer select-none transition-all",
                "bg-emerald-700 hover:bg-emerald-600 text-on-accent",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400",
                activeBillingDetailTab === 'purchase' && "ring-2 ring-emerald-300"
              )}
            >
              {/* 🔴 THE LOW-BALANCE DOT HANGS OFF THE CAPSULE, NEVER OFF THE ICON — measured, and it
                  was a real regression caught before it shipped. The icon chip stands down below
                  `sm` (it is the widest thing in the row that carries no information), so a dot
                  drawn inside it would have disappeared on exactly the screens where a ₹0 balance
                  matters most: every phone. `theRedDotLeadsToTheTopUp` exists for that dot.

                  🔴 AND THE SCREEN-READER LABEL IS A SIBLING, NOT A CHILD OF THE CHIP, for a second
                  measured reason: `sr-only` clips to 1px but keeps its full intrinsic width, and a
                  row item sized by `min-w-fit` counts it — inside the chip it pushed the capsule's
                  fit-content out and squeezed the real label to 16px at desktop widths. */}
              {needsTopUp && <span aria-hidden className="absolute top-1.5 right-2 w-2 h-2 rounded-full bg-danger" />}
              <span className="shrink-0 hidden sm:inline-flex p-1.5 rounded-full bg-emerald-800 text-on-accent">
                <CreditCard className="w-4 h-4" />
              </span>
              <span className="whitespace-nowrap">
                <span className="block text-[9px] font-extrabold tracking-wide sm:uppercase sm:tracking-widest text-on-accent opacity-90">Buy tokens</span>
                <span className="block text-sm sm:text-base font-black tracking-tight text-on-accent">
                  100 <span className="text-[10px] font-bold">/ ₹</span>
                </span>
              </span>
              {needsTopUp && <span className="sr-only">{TOP_UP_DOT_LABEL}</span>}
            </div>

            {/* CAPSULE 2 — TOKEN BALANCE. */}
            <div
              data-tour="billing"
              role="button"
              tabIndex={0}
              onClick={() => onSetActiveBillingDetailTab('remaining')}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSetActiveBillingDetailTab('remaining'); } }}
              className={cn(
                "flex-1 min-w-fit flex items-center gap-1.5 sm:gap-2 rounded-full px-2.5 sm:px-4 py-2 cursor-pointer select-none transition-all",
                "bg-card border-2 border-indigo-500 hover:bg-raised",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500",
                activeBillingDetailTab === 'remaining' && "ring-2 ring-indigo-500"
              )}
            >
              <span className="shrink-0 hidden sm:inline-flex p-1.5 rounded-full bg-indigo-600 text-on-accent">
                <Wallet className="w-4 h-4" />
              </span>
              {/* No `truncate` anywhere in this capsule: `min-w-fit` on the row item is what keeps the
                  number whole, by letting the row scroll instead of the value being cut. */}
              <span className="whitespace-nowrap">
                <span className="block text-[9px] font-extrabold tracking-wide sm:uppercase sm:tracking-widest text-muted">Token balance</span>
                <span className="block text-sm sm:text-base font-black text-ink tracking-tight">
                  {(wallet?.tokenBalance ?? 0).toLocaleString()}
                </span>
              </span>
            </div>

            {/* CAPSULE 3 — PROMOCODE CREDIT. */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => onSetActiveBillingDetailTab('gift')}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSetActiveBillingDetailTab('gift'); } }}
              className={cn(
                "flex-1 min-w-fit flex items-center gap-1.5 sm:gap-2 rounded-full px-2.5 sm:px-4 py-2 cursor-pointer select-none transition-all",
                "bg-card border-2 border-amber-500 hover:bg-raised",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500",
                activeBillingDetailTab === 'gift' && "ring-2 ring-amber-500"
              )}
            >
              <span className="shrink-0 hidden sm:inline-flex p-1.5 rounded-full bg-amber-600 text-on-accent">
                <Gift className="w-4 h-4" />
              </span>
              <span className="whitespace-nowrap">
                <span className="block text-[9px] font-extrabold tracking-wide sm:uppercase sm:tracking-widest text-muted">Promocode</span>
                <span className="block text-sm sm:text-base font-black text-ink tracking-tight">
                  ₹{(billingTransactions.filter(tx => tx.paymentProvider === 'COUPON_REDEEM' || tx.paymentProvider === 'REFERRAL' || tx.paymentProvider === 'GIFT_REDEEM').reduce((sum, tx) => sum + (tx.balanceAdded || 0), 0)).toFixed(2)}
                </span>
              </span>
            </div>

          </div>

          {/* Integrated Sub-Panel Details Module */}
          <div className="bg-card border border-line rounded-[2.5rem] p-6 sm:p-8 shadow-3xl text-left space-y-6">

            {/* DETAILED TAB 1: AVAILABLE CREDIT */}
            {activeBillingDetailTab === 'remaining' && (
              <div className="space-y-6 animate-in fade-in duration-300">
                <div className="flex flex-wrap items-center justify-between border-b border-line pb-4 gap-4">
                  <div>
                    <div className="inline-flex items-center gap-2 bg-indigo-500/10 border border-indigo-500/20 text-accent-text px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest font-mono">
                      <Sparkles className="w-3.5 h-3.5" /> Core Token Audit
                    </div>
                    <h3 className="text-lg font-black text-ink uppercase tracking-tight mt-2">Active Multi-Model Resource Pool</h3>
                  </div>
                  <button
                    onClick={onFetchWallet}
                    disabled={loadingWallet}
                    className="flex items-center gap-2 px-5 py-2.5 bg-raised border border-line hover:border-indigo-500 rounded-xl text-[10px] font-black uppercase tracking-widest text-ink transition-all active:scale-95"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingWallet ? 'animate-spin' : ''}`} />
                    Refresh Wallet Registry
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-2">
                  <div className="space-y-4">
                    {/* Billing Phase 2 — honest copy: tokens buy real AI work (input + output are both
                        metered); every finished Pro build deducts its cost from this balance. */}
                    <p className="text-xs text-muted leading-relaxed font-semibold">
                      Your tokens never expire and pay for real AI build work. Every finished Pro build deducts its actual cost from this balance — you can see each deduction in the usage statement below.
                    </p>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-well border border-line rounded-2xl p-4 font-mono">
                        <div className="text-[9px] text-muted font-black uppercase tracking-wider">Estimated Lifespan</div>
                        <div className="text-lg font-black text-ink mt-1">Unlimited</div>
                        <div className="text-[9px] text-muted mt-1">Tokens never expire</div>
                      </div>
                      <div className="bg-well border border-line rounded-2xl p-4 font-mono">
                        <div className="text-[9px] text-muted font-black uppercase tracking-wider">Token Balance</div>
                        <div className="text-lg font-black text-ink mt-1">
                          {/* The REAL token balance — not a derived ₹×rate approximation (a stale ×200
                              hardcode used to live here; the true rate travels as wallet.tokensPerRupee). */}
                          {(wallet?.tokenBalance ?? 0).toLocaleString()}
                        </div>
                        <div className="text-[9px] text-muted mt-1">Tokens remaining</div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-well border border-line rounded-[2rem] p-6 space-y-3 font-mono text-xs">
                    <h4 className="text-[10px] font-black text-ink uppercase tracking-widest font-sans">Live Wallet Breakdown</h4>
                    <div className="flex justify-between items-center py-0.5">
                      <span className="text-muted">Total Balance Added:</span>
                      <span className="text-info font-bold">₹{(wallet?.total_balance || 10.00).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center py-0.5">
                      <span className="text-muted">Total Spent Consumption:</span>
                      <span className="text-warn font-bold">₹{((wallet?.total_balance || 10.00) - (wallet?.remaining_balance || 10.00)).toFixed(4)}</span>
                    </div>
                    <div className="border-t border-line pt-3.5 flex justify-between items-center text-sm font-black">
                      <span className="text-muted tracking-tight font-sans">Active Token Balance:</span>
                      <span className="text-success">₹{(wallet?.remaining_balance || 10.00).toFixed(4)}</span>
                    </div>
                  </div>
                </div>

                {/* Unified Statement: Purchase Invoices & prompt usages */}
                <div className="space-y-4 pt-4 border-t border-line">
                  <h4 className="text-xs font-black text-ink uppercase tracking-widest font-mono">Invoice Records & Task Deductions Trace</h4>
                  <div className="space-y-6">
                    <div>
                      <p className="text-[9px] text-info font-black uppercase tracking-wider font-mono mb-2">Deposits & Promotional Code Additions</p>
                      <div className="overflow-y-auto max-h-[160px] custom-scrollbar border border-line rounded-2xl bg-well">
                        <table className="w-full text-left text-[11px] font-mono">
                          <thead>
                            <tr className="border-b border-line text-muted font-black uppercase tracking-widest text-[9px] bg-well">
                              <th className="py-2.5 px-4">OrderID / Reference</th>
                              <th className="py-2.5 px-4">Type</th>
                              <th className="py-2.5 px-4 text-success">Amount Received</th>
                              <th className="py-2.5 px-4">Datetime</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-line font-bold">
                            {billingTransactions.map((tx: any, i: number) => (
                              <tr key={i} className="hover:bg-raised transition-colors">
                                <td className="py-2.5 px-4 text-ink font-semibold truncate max-w-[140px]">#{tx.orderId || tx.transactionId}</td>
                                <td className="py-2.5 px-4 text-muted">
                                  <span className="text-[9px] bg-indigo-500/10 text-accent-text px-1.5 py-0.5 rounded uppercase font-black tracking-wider">
                                    {tx.paymentProvider || 'DEPOSIT'}
                                  </span>
                                </td>
                                <td className="py-2.5 px-4 text-success font-black">₹{(tx.balanceAdded || tx.amountPaid || 0).toFixed(2)}</td>
                                <td className="py-2.5 px-4 text-muted text-[10px]">
                                  {tx.createdAt ? new Date(tx.createdAt.seconds ? tx.createdAt.seconds * 1000 : tx.createdAt).toLocaleString() : 'Just now'}
                                </td>
                              </tr>
                            ))}
                            {billingTransactions.length === 0 && (
                              <tr>
                                <td colSpan={4} className="py-6 text-center text-muted font-black uppercase tracking-widest text-[9px]">
                                  No transactions recorded yet.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* TOTAL AI SPEND — what NavBharatAI actually charged this wallet (admin 2026-09-14).
                        Replaces a per-AI-call table read from `ai_usage_logs`, which answered the wrong
                        question AND could only ever print -₹0.0000: it read `amount_deducted` /
                        `output_tokens`, and neither is written any more (a streamed turn records no
                        token counts, and `estimated_provider_cost` was deleted in the money audit as
                        "a field whose only value was a lie"). Its header row also declared four columns
                        over five body cells, so every value sat one column right of its own label.
                        The real charge is the wallet ledger — see lib/aiSpendSummary.ts. */}
                    <div>
                      <p className="text-[9px] text-warn font-black uppercase tracking-wider font-mono mb-2">Total AI Spend (what NavBharatAI has charged you)</p>
                      {!aiSpend.ledgerAvailable ? (
                        /* HONEST FAILURE, NOT A ZERO. An unreadable wallet is a different fact from a
                           wallet that has spent nothing, and printing ₹0.00 for the first is the exact
                           defect that made the Live Metrics screen a dashboard of confident zeros. */
                        <div className="border border-line rounded-2xl bg-well px-4 py-5 text-center space-y-2">
                          <p className="text-[10px] text-warn font-black uppercase tracking-widest">Spend not loaded</p>
                          <p className="text-[10px] text-muted">We could not read your charges just now — this is not ₹0. Tap Refresh to try again.</p>
                        </div>
                      ) : (
                        <div className="border border-line rounded-2xl bg-well overflow-hidden">
                          <div className="px-4 py-4 border-b border-line bg-well">
                            <div className="text-2xl font-black text-danger">₹{formatInr(aiSpend.totalInr)}</div>
                            <div className="text-[9px] text-faint font-bold uppercase tracking-widest mt-1">
                              Charged across {aiSpend.chargeCount.toLocaleString('en-IN')} {aiSpend.chargeCount === 1 ? 'charge' : 'charges'}
                            </div>
                            <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3">
                              <div>
                                <span className="text-xs font-black text-ink">₹{formatInr(aiSpend.buildInr)}</span>
                                <span className="text-[9px] text-faint font-bold uppercase tracking-widest ml-1.5">App building</span>
                              </div>
                              <div>
                                <span className="text-xs font-black text-ink">₹{formatInr(aiSpend.assistantInr)}</span>
                                <span className="text-[9px] text-faint font-bold uppercase tracking-widest ml-1.5">Assistants</span>
                              </div>
                            </div>
                          </div>
                          <div className="overflow-y-auto max-h-[180px] custom-scrollbar">
                            <table className="w-full text-left text-[11px] font-mono">
                              <thead>
                                <tr className="border-b border-line text-muted font-black uppercase tracking-widest text-[9px] bg-well">
                                  <th className="py-2.5 px-4">What it was for</th>
                                  <th className="py-2.5 px-4 text-right text-danger">Charged</th>
                                  <th className="py-2.5 px-4">When</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-line font-bold">
                                {aiSpend.rows.map((row, i) => (
                                  <tr key={`${row.at}-${i}`} className="hover:bg-raised transition-colors">
                                    <td className="py-2.5 px-4 text-ink font-semibold">{row.label}</td>
                                    <td className="py-2.5 px-4 text-right text-danger font-black whitespace-nowrap">-₹{formatInr(row.inr)}</td>
                                    <td className="py-2.5 px-4 text-muted text-[10px] whitespace-nowrap">
                                      {row.at ? new Date(row.at).toLocaleString() : '—'}
                                    </td>
                                  </tr>
                                ))}
                                {aiSpend.rows.length === 0 && (
                                  <tr>
                                    <td colSpan={3} className="py-6 text-center text-muted font-black uppercase tracking-widest text-[9px]">
                                      Nothing charged yet — your builds so far have been free.
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* THE STATEMENT — every credit and every charge, with a running balance, reconciled
                    against the wallet's own figure (admin 2026-09-15: "ek ek paise ka sahi sahi
                    hisab … user ke current balance se match hona chahiye"). It lives under the token
                    audit because that is what it is: the audit, shown to the person whose money it
                    is. It reports an honest mismatch rather than hiding one — see the panel. */}
                <WalletStatementPanel userId={user.uid} />
              </div>
            )}

            {/* DETAILED TAB 2: PROMO CODE
                🔴 THE REFERRAL HALF OF THIS TAB WAS DELETED (admin 2026-09-15), and it was not a
                half-built feature — it was a DECORATIVE one, live to real users.

                It showed a referral code invented in the browser (`NAV-<mailbox>-REF` here, while the
                balance card above showed a DIFFERENT random `NB-XXXXXX`, so one person saw two codes
                for one thing); it promised "Earn 10% Free Tokens for every referral"; and it listed
                two invented earners — amit_sharma2026@gmail.com ₹50 and priya.rastogi@navbharat.ai
                ₹25 — hardcoded, so EVERY user was shown the same two strangers as their own earnings.
                Nothing of it existed on the server: no code, no attribution, no credit, not one
                endpoint. Nobody could ever have earned ₹1 from it.

                That is the state the second absolute rule names as forbidden: a feature that looks
                done and does nothing. The real referral system is being built now — four earning
                steps, device-verified, Android only — and it will bring its own screen backed by
                real server state. Until it lands, this tab is what it can honestly be: promo codes,
                which are real (see promoCoupons.ts).

                The coupon box also named WELCOME100 and NAVBHARAT50 as examples. Both codes were
                DELETED in the 2026-09-10 revenue audit, so the placeholder was advertising two
                guaranteed failures to everyone who read it. */}
            {activeBillingDetailTab === 'gift' && (
              <div className="space-y-6 animate-in fade-in duration-300">
                <div className="border-b border-line pb-4">
                  <span className="text-[10px] bg-amber-500/10 border border-amber-500/20 text-warn px-3 py-1.5 rounded-xl font-black uppercase tracking-wider font-mono">
                    Promo Code
                  </span>
                  <h3 className="text-xl font-black text-ink uppercase tracking-tight mt-3">Redeem a Promotional Code</h3>
                </div>

                {/* REFER A FRIEND — the four earned steps and the code. Replaces the decorative
                    referral surface deleted on 2026-09-15; every number in it is the server's. */}
                <ReferralPanel
                  userId={user.uid}
                  enabled={referral.enabled}
                  code={referral.code}
                  shareMessage={referral.shareMessage}
                  rows={referral.rows}
                  earnedRupees={referral.earnedRupees}
                  capRupees={referral.capRupees}
                  capReached={referral.capReached}
                  referred={referral.referred}
                  emailVerified={referral.emailVerified}
                  phoneVerified={referral.phoneVerified}
                  githubLinked={referral.githubLinked}
                  onRefresh={onRefreshReferral}
                  onToast={onToast}
                />

                <div className="max-w-2xl">
                  {/* Voucher redeem panel */}
                  <div className="bg-well border border-line rounded-2xl p-6 space-y-4">
                    <div>
                      <h4 className="text-xs font-black text-ink uppercase tracking-wider">Redeem Reward Coupons</h4>
                      <p className="text-[10px] text-muted font-bold font-mono">Each promo code can only be applied once.</p>
                    </div>
                    {/* The button sits UNDER the box, full width (admin 2026-09-24, phone screenshot: "apply code
                        button screen se bahar ja raha hai"). Side by side, an <input> will not shrink below its
                        built-in minimum width, so on a narrow phone the row was wider than the screen and the
                        button was pushed off it. Stacked, both always fit, and the tap target is the full width. */}
                    <div className="flex flex-col gap-3">
                      <input
                        type="text"
                        placeholder="Enter your promo code"
                        value={couponCodeInput}
                        onChange={(e) => onSetCouponCodeInput(e.target.value)}
                        className="w-full min-w-0 bg-surface border border-line rounded-xl px-4 py-3 text-xs font-mono font-bold uppercase tracking-widest text-ink focus:outline-none focus:border-amber-500 transition-colors"
                      />
                      <button
                        onClick={() => onRedeemPromoCoupon(couponCodeInput)}
                        disabled={isRedeemingCoupon || !couponCodeInput}
                        className="w-full px-6 py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-500/20 disabled:text-muted text-black rounded-xl font-black uppercase tracking-widest text-[10px] transition-all duration-200"
                      >
                        {isRedeemingCoupon ? 'VALIDATING...' : 'APPLY CODE'}
                      </button>
                    </div>

                    {couponError && (
                      <div className="bg-red-500/10 border border-red-500/20 text-danger p-3 rounded-xl text-xs flex items-center gap-2 font-semibold">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        <span>{couponError}</span>
                      </div>
                    )}

                    {couponSuccess && (
                      <div className="bg-emerald-500/10 border border-emerald-500/20 text-success p-3 rounded-xl text-xs flex items-center gap-2 font-semibold animate-pulse">
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        <span>{couponSuccess}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* ───────────────────────── GIFT A PROMO CODE ─────────────────────────
                    Admin 2026-09-22: *"promocode credit ke andar ek option aur add karo — purchage
                    promo code. yaha user promocode purchage kar ke apne family/friend ko gift kar
                    sakta hai! rate wahi jo ham charge karte hai, plus 2% pletform fee"*.

                    🔒 IT IS BOUGHT AT THE GATEWAY, NEVER FROM THE WALLET — which is the admin's own
                    condition (*"real ₹ se honge … welcome bonus se nahi"*) made true by construction:
                    there is no code path from a balance to a code, so paying with the welcome gift is
                    not a case that has to be refused.

                    🔒 ONE FEE LINE. The first request said "2% platform fee + cashfree charges"; the
                    gateway's real charge is unknowable in advance (UPI is ₹0 by regulation, cards
                    ~2%+GST, and the method is chosen on a later screen), so a second line would be a
                    number no statement will ever match. The admin confirmed: *"2% hi kaafi hai!!"*.

                    ⚠️ The price shown here is `giftPriceAtPct` — the SAME pure function the server
                    prices the order with, so the buyer cannot be shown one number and charged another. */}
                {onCreateGiftOrder && (
                  <div className="max-w-2xl">
                    <div className="bg-well border border-line rounded-2xl p-6 space-y-4">
                      <div>
                        <h4 className="text-xs font-black text-ink uppercase tracking-wider">Gift a promo code</h4>
                        <p className="text-[10px] text-muted font-bold font-mono">
                          Buy a code and send it to family or a friend. They redeem it in the box above.
                        </p>
                      </div>

                      {/* THE CODE THIS SESSION JUST BOUGHT — shown large, because the moment after
                          paying is the only moment that matters for this product. */}
                      {lastGiftCode && (
                        <div className="bg-emerald-500/10 border border-emerald-500/25 rounded-2xl p-4 space-y-3">
                          <p className="text-[10px] font-black uppercase tracking-widest text-success">Your gift code is ready</p>
                          <p className="text-lg font-black text-ink font-mono break-all select-all">{lastGiftCode.code}</p>
                          <p className="text-[10px] text-muted font-bold">
                            Worth ₹{lastGiftCode.faceInr.toLocaleString('en-IN')} when they redeem it.
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <button
                              onClick={() => {
                                // A clipboard write can be refused (an insecure context, a denied
                                // permission), and a silent failure here loses somebody's money — so
                                // the failure is SAID, and the code is selectable above either way.
                                navigator.clipboard?.writeText(lastGiftCode.code)
                                  .then(() => onToast('Gift code copied.', 'success'))
                                  .catch(() => onToast('Could not copy — press and hold the code to select it.', 'warning'));
                              }}
                              className="px-4 py-2 rounded-xl bg-raised border border-line text-[10px] font-black uppercase tracking-widest text-ink"
                            >
                              Copy code
                            </button>
                            <a
                              href={giftWhatsAppUrl(lastGiftCode.code, lastGiftCode.faceInr)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-4 py-2 rounded-xl bg-emerald-700 text-on-accent text-[10px] font-black uppercase tracking-widest"
                            >
                              Share on WhatsApp
                            </a>
                          </div>
                        </div>
                      )}

                      <div className="space-y-2">
                        <label htmlFor="nbai-gift-amount" className="text-[10px] text-muted font-bold uppercase tracking-wider block">
                          Gift amount (₹{giftBounds.minInr} to ₹{giftBounds.maxInr.toLocaleString('en-IN')})
                        </label>
                        <div className="flex items-center gap-3 bg-surface border border-line rounded-xl px-4 py-3 focus-within:border-amber-500 transition-colors">
                          <span className="text-warn font-mono font-bold text-sm">₹</span>
                          <input
                            id="nbai-gift-amount"
                            type="number"
                            min={giftBounds.minInr}
                            max={giftBounds.maxInr}
                            step="1"
                            value={giftFaceInput}
                            onChange={(e) => onSetGiftFaceInput?.(e.target.value)}
                            className="w-full bg-transparent text-ink font-mono font-bold text-sm focus:outline-none"
                            placeholder="Amount in Rupees"
                          />
                        </div>
                      </div>

                      {/* WHAT THEY PAY AND WHAT THE FRIEND GETS — both, before they press anything. */}
                      <div className="bg-surface border border-line rounded-xl p-4 space-y-1">
                        <div className="flex items-center justify-between text-[11px] font-bold text-body">
                          <span>They receive</span>
                          <span className="font-mono">₹{giftPrice.faceInr.toFixed(2)}</span>
                        </div>
                        <div className="flex items-center justify-between text-[11px] font-bold text-muted">
                          <span>Platform fee</span>
                          <span className="font-mono">₹{giftPrice.feeInr.toFixed(2)}</span>
                        </div>
                        <div className="flex items-center justify-between text-sm font-black text-ink border-t border-line pt-2 mt-2">
                          <span>You pay</span>
                          <span className="font-mono">₹{giftPrice.payInr.toFixed(2)}</span>
                        </div>
                      </div>

                      {giftError && (
                        <div className="bg-red-500/10 border border-red-500/20 text-danger p-3 rounded-xl text-xs font-semibold flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 shrink-0" />
                          <span>{giftError}</span>
                        </div>
                      )}

                      <button
                        onClick={() => onCreateGiftOrder(giftPrice.faceInr)}
                        disabled={isBuyingGift || giftPrice.faceInr < giftBounds.minInr || giftPrice.faceInr > giftBounds.maxInr}
                        /* The purchase colour, not the section colour. Amber is this tab's identity, but `bg-amber-500`
                            needs BLACK ink to be readable and a new colour literal is what the ratchet exists to
                            refuse — so the one BUY action here wears the same emerald + `text-on-accent` pairing
                            the Buy tokens capsule uses, which is a measured-good combination already in this file. */
                        className="w-full px-5 py-3 rounded-xl bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-on-accent text-[11px] font-black uppercase tracking-widest transition-all active:scale-[0.99]"
                      >
                        {isBuyingGift ? 'Opening checkout…' : `Buy this gift code — ₹${giftPrice.payInr.toFixed(2)}`}
                      </button>

                      <p className="text-[10px] text-muted leading-relaxed font-semibold">
                        A code can be redeemed once, by one person, and it does not expire. It cannot be
                        exchanged for cash and is spendable only inside NavBharatAI.
                      </p>

                      {/* THE CODES ALREADY BOUGHT — so a gift is never lost with a closed tab. */}
                      {giftCodes.length > 0 && (
                        <div className="border-t border-line pt-4 space-y-2">
                          <p className="text-[10px] font-black uppercase tracking-widest text-muted">Codes you have bought</p>
                          {giftCodes.map((g) => (
                            <div key={g.code} className="flex items-center justify-between gap-3 bg-surface border border-line rounded-xl px-3 py-2">
                              <span className="font-mono text-[11px] font-bold text-ink break-all select-all">{g.code}</span>
                              <span className="shrink-0 text-right">
                                <span className="block text-[11px] font-black text-ink font-mono">₹{g.faceInr.toLocaleString('en-IN')}</span>
                                <span className={`block text-[9px] font-black uppercase tracking-widest ${g.status === 'redeemed' ? 'text-muted' : 'text-success'}`}>
                                  {g.status === 'redeemed' ? 'Used' : 'Unused'}
                                </span>
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* DETAILED TAB 3: BUY CREDIT */}
            {/* 🔒 APP LOCK — "Wallet recharge" (admin 2026-09-13). The gate sits around the TAB BODY, not
                the whole panel, so the four balance cards above (which are this tab's own tab bar) stay
                visible and the user can still read their balance and history.

                ⚠️ IT GATES STARTING A PURCHASE, NOT FINISHING ONE. The checkout completes in a modal
                rendered from App.tsx, and a payment return can re-open that modal without passing through
                here. Gating it too would mean a user who has ALREADY PAID comes back to a PIN prompt
                instead of their confirmation — a money path interrupted by a lock, which is strictly worse
                than the hole it would close. Reaching the pay button needs the PIN; crediting money that
                was genuinely paid never does. */}
            {activeBillingDetailTab === 'purchase' && (
              <AppLockGate userId={user.uid} area="wallet_recharge" embedded render={() => (
              <div className="space-y-6 animate-in fade-in duration-300">
                <div className="flex flex-wrap items-center justify-between border-b border-line pb-4 gap-4">
                  <div>
                    <span className="text-[10px] bg-emerald-500/10 border border-emerald-500/20 text-success px-3 py-1.5 rounded-xl font-black uppercase tracking-wider font-mono">
                      Balance Store & Gateway simulation
                    </span>
                    <h3 className="text-xl font-black text-ink uppercase tracking-tight mt-3">Buy Tokens Instant Gateway</h3>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
                  <div className="space-y-6">
                    {storePurchaseNotice && (
                      <div className="bg-emerald-500/10 border border-emerald-500/25 text-success text-xs font-bold p-4 rounded-2xl">
                        {storePurchaseNotice}
                      </div>
                    )}
                    {storeRail === 'none' ? (
                      /*
                       * 🍎 APPLE 3.1.1 — this device may not buy here, so it is told so plainly.
                       *
                       * NOT a disabled button and NOT a hidden section: the second absolute rule
                       * allows exactly two states, working or honestly unavailable, and a top-up
                       * panel that silently disappears leaves a user hunting for a balance they can
                       * see going down.
                       *
                       * ⚠️ AND IT DELIBERATELY DOES NOT SAY "buy it on the website". Pointing a user
                       * at an outside purchase from inside the app is Apple's anti-steering rule, and
                       * CLAUDE.md already records the same discipline for Play ("do NOT add 'cheaper
                       * on the web' copy to the app"). Stating that a feature is unavailable is
                       * allowed; routing around the store is not.
                       */
                      <div className="bg-well border border-line p-6 rounded-[2rem] space-y-3">
                        <h4 className="text-xs font-black text-ink uppercase tracking-widest font-mono">Top-up is not available in this app</h4>
                        <p className="text-xs text-muted leading-relaxed font-semibold">
                          You cannot add credit from inside the iPhone app yet. Everything else is unchanged —
                          your balance, your apps, and any credit you already have all work exactly as they do
                          everywhere else.
                        </p>
                      </div>
                    ) : storeRail === 'play-billing' && storeConfig ? (
                      /*
                       * GOOGLE PLAY PACKS. Google Play requires digital goods consumed in the app to
                       * be bought through Play's billing, so on the Play build these fixed packs
                       * REPLACE the free-form gateway top-up rather than sitting beside it — an app
                       * offering both would still be in breach.
                       *
                       * THE FEE IS SHOWN, NOT BURIED (admin: "google ka charge add kar ke clear
                       * dikhao"). Each line is arithmetic on the server's own catalogue, never a
                       * typed-in number: credit + fee = exactly what Google will charge.
                       */
                      <div className="bg-well border border-line p-6 rounded-[2rem] space-y-4">
                        <h4 className="text-xs font-black text-ink uppercase tracking-widest font-mono">Choose a top-up pack</h4>
                        <div className="space-y-3">
                          {storeConfig.packs.map((pack) => {
                            const b = packBreakdown(pack);
                            const busy = buyingProductId === pack.productId;
                            return (
                              <button
                                key={pack.productId}
                                onClick={() => onBuyStorePack?.(pack.productId)}
                                disabled={!!buyingProductId}
                                className="w-full text-left bg-well hover:bg-well-hover disabled:opacity-40 border border-line hover:border-emerald-500/40 p-4 rounded-2xl transition-all active:scale-[0.99]"
                              >
                                <div className="flex items-center justify-between gap-4">
                                  <div>
                                    <span className="block text-sm font-black text-ink">₹{b.creditInr.toLocaleString('en-IN')} of credit</span>
                                    <span className="block text-[10px] text-muted font-bold mt-0.5 font-mono">
                                      {(b.creditInr * 100).toLocaleString('en-IN')} tokens
                                    </span>
                                  </div>
                                  <div className="text-right shrink-0">
                                    <span className="block text-base font-black text-success">₹{b.priceInr.toLocaleString('en-IN')}</span>
                                    {!b.feeFree && (
                                      <span className="block text-[10px] text-muted font-bold font-mono">
                                        ₹{b.creditInr.toLocaleString('en-IN')} + ₹{b.storeFeeInr.toLocaleString('en-IN')} fee
                                      </span>
                                    )}
                                  </div>
                                </div>
                                {busy && (
                                  <span className="block text-[10px] text-success font-black uppercase tracking-widest mt-2 font-mono">Opening Google Play…</span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                        <p className="text-[10px] text-muted leading-relaxed font-semibold border-t border-line pt-3">
                          Purchases in the app are processed by Google Play, which charges a fee on each
                          purchase — shown above as a separate line so you can see exactly what it adds.
                          Your wallet is credited the full credit amount shown, never less.
                        </p>
                      </div>
                    ) : (
                    <div className="bg-well border border-line p-6 rounded-[2rem] space-y-4">
                      <h4 className="text-xs font-black text-ink uppercase tracking-widest font-mono">Instant balance calculator (₹1 to ₹999999)</h4>

                      <div className="space-y-3">
                        <label className="text-[10px] text-muted font-bold uppercase tracking-wider block">Enter Amount (₹)</label>
                        <div className="flex items-center gap-3 bg-surface border border-line rounded-xl px-4 py-3 focus-within:border-emerald-500 transition-colors">
                          <span className="text-success font-mono font-bold text-sm">₹</span>
                          <input
                            type="number"
                            min="1"
                            max="999999"
                            value={buyAmountInput}
                            onChange={(e) => onSetBuyAmountInput(e.target.value)}
                            className="w-full bg-transparent text-ink font-mono font-bold text-sm focus:outline-none"
                            placeholder="Amount in Rupees"
                          />
                        </div>
                      </div>

                      {/*
                        WHAT THE USER ACTUALLY GETS — shown BEFORE they pay, never after.
                        This used to print `amount × 100` under the caption "at ₹1 = 100 tokens",
                        which was true of the old rupee-for-rupee credit and became a false promise
                        the moment a platform fee existed. The split comes from the SAME pure module
                        the server settles with (platformFeeAtPct), so the two can never disagree.
                      */}
                      <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-4 bg-well border border-line p-4 rounded-xl font-mono text-center">
                          <div>
                            <span className="text-[9px] text-muted font-black uppercase tracking-widest block">Wallet Tokens</span>
                            <span className="text-base text-success font-extrabold block mt-1">{Math.round(rechargeSplit.creditInr * 100).toLocaleString('en-IN')}</span>
                            <span className="text-[8px] text-muted">₹{rechargeSplit.creditInr.toFixed(2)} of credit, at ₹1 = 100 tokens</span>
                          </div>
                          <div>
                            <span className="text-[9px] text-muted font-black uppercase tracking-widest block">Equivalent AI Outputs</span>
                            <span className="text-base text-accent-text font-extrabold block mt-1">{(Math.round(rechargeSplit.creditInr * 100) * 200).toLocaleString('en-IN')}</span>
                            <span className="text-[8px] text-muted">At 1 token = 200 outputs</span>
                          </div>
                        </div>
                        {rechargeSplit.feeInr > 0 && (
                          <p className="text-[10px] text-muted font-semibold leading-relaxed font-mono text-center">
                            ₹{rechargeSplit.paidInr.toFixed(2)} paid − ₹{rechargeSplit.feeInr.toFixed(2)} platform fee ({platformFeePct}%) = <span className="text-success font-black">₹{rechargeSplit.creditInr.toFixed(2)} credited</span>
                          </p>
                        )}
                      </div>

                      <button
                        onClick={() => {
                          const enteredVal = parseFloat(buyAmountInput);
                          if (isNaN(enteredVal) || enteredVal < 1 || enteredVal > 999999) {
                            alert("Please enter a valid amount between ₹1 and ₹9,99,999");
                            return;
                          }
                          onCreateBillingOrder(enteredVal);
                        }}
                        disabled={isRecharging}
                        title={needsTopUp ? TOP_UP_DOT_LABEL : undefined}
                        className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-on-accent rounded-xl font-black uppercase tracking-widest text-xs shadow-lg shadow-emerald-600/20 active:scale-95 transition-all inline-flex items-center justify-center gap-2"
                      >
                        {/* The end of the trail. The dot stops here because this button IS the fix —
                            pressing it is what clears every dot behind it. */}
                        {needsTopUp && <span aria-hidden className="w-2 h-2 rounded-full bg-danger" />}
                        Purchase Wallet Tokens (₹{(parseFloat(buyAmountInput) || 0).toLocaleString('en-IN')})
                      </button>
                    </div>
                    )}
                  </div>

                  <div className="space-y-4">
                    <p className="text-xs text-muted leading-relaxed font-semibold">
                      Tokens are immediately funded into your multi-model ledger on successful bank sync. Checkout parameters are fully encrypted.
                    </p>

                    <h4 className="text-xs font-black text-ink uppercase tracking-wider font-mono">Invoice Records Summary</h4>
                    <div className="overflow-y-auto max-h-[220px] custom-scrollbar border border-line rounded-2xl bg-well">
                      <table className="w-full text-left text-xs font-mono">
                        <thead>
                          <tr className="border-b border-line text-muted font-black uppercase tracking-widest text-[9px] bg-well">
                            <th className="py-2 px-4">OrderID</th>
                            <th className="py-2 px-4 text-success">Rupees Paid</th>
                            <th className="py-2 px-4">Method</th>
                            <th className="py-2 px-4">Datetime</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line font-bold">
                          {billingTransactions.filter(tx => tx.paymentProvider !== 'WELCOME_BONUS' && tx.paymentProvider !== 'COUPON_REDEEM').map((tx: any, i: number) => (
                            <tr key={i} className="hover:bg-raised transition-colors">
                              <td className="py-2.5 px-4 text-ink truncate max-w-[125px]">#{tx.orderId || tx.transactionId}</td>
                              <td className="py-2.5 px-4 text-success">₹{(tx.amountPaid || tx.amount || 0).toFixed(2)}</td>
                              <td className="py-2.5 px-4 text-accent-text text-[10px] uppercase">{tx.paymentProvider || 'CASHFREE'}</td>
                              <td className="py-2.5 px-4 text-muted">
                                {tx.createdAt ? new Date(tx.createdAt.seconds ? tx.createdAt.seconds * 1000 : tx.createdAt).toLocaleDateString() : 'Today'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
              )} />
            )}

            {/* ⛔ THE BUDGET & REMINDER CONSOLE WAS REMOVED HERE (admin 2026-09-20: "yeh budget
                warning system kaam to karta nahi hai — isko jad se khatam karo").

                It was not merely unused, it made a FALSE PROMISE: "at this limit the system
                automatically switches you to Free-version mode". Both numbers lived in
                `localStorage` alone (`usePaymentEngine`), reached no server, and were read by no
                build gate, no affordability check and no debit — so the only thing the floor ever
                changed was a badge on this same screen. A control that states an outcome and
                produces none is exactly the "built but not really working" state the second
                absolute rule forbids.

                ⚠️ WHAT ACTUALLY BOUNDS A NEGATIVE BALANCE, so nobody looks for it here again:
                `WALLET_OVERDRAFT_FLOOR_INR` (`src/server/lib/walletFloor.ts`, ₹50 by default),
                applied INSIDE every debit. That is server-side, real, and untouched by this
                removal — removing a control that enforced nothing cannot have made overdraft
                worse. */}
          </div>

          {/* 11.3 — Daily Usage Stats. The third tile here used to print a "My Referral Code"
              invented in localStorage (`NB-XXXXXX`), which the Promo tab then contradicted with a
              second, different invented code. Both are gone — see the DETAILED TAB 2 note below. */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-card border border-line rounded-2xl p-5 space-y-2">
              <p className="text-[9px] font-black text-faint uppercase tracking-widest">Today's Messages</p>
              <p className="text-3xl font-black text-ink">{dailyUsage.date === new Date().toDateString() ? dailyUsage.count : 0}</p>
              <p className="text-[10px] text-success">Unlimited for registered users ✓</p>
            </div>
            <div className="bg-card border border-line rounded-2xl p-5 space-y-2">
              <p className="text-[9px] font-black text-faint uppercase tracking-widest">Today's Builds</p>
              <p className="text-3xl font-black text-ink">{dailyUsage.date === new Date().toDateString() ? dailyUsage.builds : 0}</p>
              <p className="text-[10px] text-accent-text">Preview builds today</p>
            </div>
          </div>

          {/* Plans (admin 2026-08-06): the whole account story in one card — Hosting plan (₹99
              Custom Domain, bought from THIS wallet), Database (free, user's own account), Coding
              (pay-per-use). Self-contained: talks to the ownership-checked wallet routes itself. */}
          {/* 🔒 APP LOCK — "Subscription & plans" (admin 2026-09-13). This card IS the subscription surface:
              buying a plan spends the wallet, and the auto-renew switch decides whether it is charged
              again. Default OFF, so a user who never ticked it sees the card exactly as before. */}
          <AppLockGate
            userId={user.uid}
            area="subscription"
            embedded
            render={() => <HostingPlanCard userId={user.uid} onWalletChanged={onFetchWallet} onToast={onToast} />}
          />

          {/* Phase 4.2 — This Month's AI Cost card */}
          {monthlyAiCost !== undefined && (
            <div className="bg-card border border-indigo-500/20 rounded-2xl p-5 flex items-center justify-between gap-4">
              <div className="space-y-1">
                <p className="text-[9px] font-black text-faint uppercase tracking-widest">This Month's AI Cost</p>
                <p className="text-2xl font-black text-accent-text font-mono">
                  ${(monthlyAiCost?.totalCostUsd ?? 0).toFixed(4)}
                </p>
                <p className="text-[10px] text-muted">{monthlyAiCost?.totalBuilds ?? 0} Pro builds · {monthlyAiCost?.month ?? new Date().toISOString().slice(0, 7)}</p>
              </div>
              <Activity className="w-8 h-8 text-accent-text shrink-0" />
            </div>
          )}

        </div>
      )}
    </div>
  );
}

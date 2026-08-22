/**
 * Phase 1.7 — App.tsx split, Part 8: BillingPanel
 *
 * Extracted from App.tsx (was the `activeView === 'billing'` block, ~784 lines).
 * Multi-model token wallet: balance cards, transactions, promocode/referrals,
 * buy-credit gateway, and budget/reminder SRE limits.
 *
 * Pure render — all state and side effects stay in App.tsx and are threaded in
 * via explicit typed props. No behavior change.
 */
import React from 'react';
import { cn } from '../../lib/utils';
import { FreeGiftBanner } from './FreeGiftBanner';
import { HostingPlanCard } from './HostingPlanCard';
import {
  Wallet, Zap, RefreshCw, AlertCircle, Sparkles, Gift, CreditCard,
  Activity, CheckCircle2, ShieldCheck, ExternalLink,
} from 'lucide-react';

type BillingDetailTab = 'purchase' | 'gift' | 'use' | 'remaining' | 'budget';
type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface BillingPanelProps {
  user: { uid: string; email?: string | null } | null;
  wallet: any;
  loadingWallet: boolean;
  dailyUsage: { date: string; count: number; builds: number };
  myReferralCode: string;
  billingTransactions: any[];
  billingLogs: any[];
  referralHistory: any[];
  activeBillingDetailTab: BillingDetailTab;
  reminderLimit: number;
  budgetLimit: number;
  dismissedReminderWarning: boolean;
  couponCodeInput: string;
  isRedeemingCoupon: boolean;
  couponError: string | null;
  couponSuccess: string | null;
  copiedReferral: boolean;
  buyAmountInput: string;
  isRecharging: boolean;
  tempReminderLimit: string;
  tempBudgetLimit: string;
  limitError: string | null;
  limitSuccess: string | null;
  onShowAuth: () => void;
  onFetchWallet: () => void;
  onSetActiveBillingDetailTab: (tab: BillingDetailTab) => void;
  onSetReminderLimit: (v: number) => void;
  onSetBudgetLimit: (v: number) => void;
  onSetDismissedReminderWarning: (v: boolean) => void;
  onSetCouponCodeInput: (v: string) => void;
  onRedeemPromoCoupon: (code: string) => void;
  onSetCopiedReferral: (v: boolean) => void;
  onSetBuyAmountInput: (v: string) => void;
  onCreateBillingOrder: (amount: number) => void;
  onSetTempReminderLimit: (v: string) => void;
  onSetTempBudgetLimit: (v: string) => void;
  onSetLimitError: (v: string | null) => void;
  onSetLimitSuccess: (v: string | null) => void;
  onToast: (message: string, type?: ToastType) => void;
  /** Phase 4.2 — current month's AI cost accumulated from Pro builds. */
  monthlyAiCost?: { totalBuilds: number; totalCostUsd: number; month: string } | null;
}

export function BillingPanel(props: BillingPanelProps) {
  const {
    user, wallet, loadingWallet, dailyUsage, myReferralCode,
    billingTransactions, billingLogs, referralHistory, activeBillingDetailTab,
    reminderLimit, budgetLimit, dismissedReminderWarning, couponCodeInput,
    isRedeemingCoupon, couponError, couponSuccess, copiedReferral,
    buyAmountInput, isRecharging, tempReminderLimit, tempBudgetLimit,
    limitError, limitSuccess,
    onShowAuth, onFetchWallet, onSetActiveBillingDetailTab, onSetReminderLimit,
    onSetBudgetLimit, onSetDismissedReminderWarning, onSetCouponCodeInput,
    onRedeemPromoCoupon, onSetCopiedReferral, onSetBuyAmountInput,
    onCreateBillingOrder, onSetTempReminderLimit, onSetTempBudgetLimit,
    onSetLimitError, onSetLimitSuccess, onToast,
  } = props;
  const { monthlyAiCost } = props;

  return (
    <div className="flex-1 bg-[#0d1117] p-6 text-left min-h-screen">
      {!user ? (
        <div className="max-w-md mx-auto text-center py-24 space-y-6">
          <div className="w-20 h-20 bg-indigo-600/10 rounded-[2rem] flex items-center justify-center mx-auto border border-indigo-600/20 shadow-2xl">
            <Wallet className="w-10 h-10 text-indigo-500" />
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-black text-white uppercase tracking-tight">Active Portal Session Required</h2>
            <p className="text-[#8b949e] font-medium text-sm">Please sign in or register to set up your navBharatAI multi-model cloud token budget.</p>
          </div>
          <button
            onClick={onShowAuth}
            className="px-8 py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-indigo-600/30 transition-all active:scale-95"
          >
            Authenticate Profile
          </button>
        </div>
      ) : (
        <div className="w-full max-w-6xl mx-auto space-y-8 py-4">
          {/* Header bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/5 pb-6">
            <div>
              <div className="flex items-center gap-2 text-indigo-400 font-black uppercase tracking-widest text-[10px] font-mono">
                <Zap className="w-4 h-4 text-orange-500 animate-bounce" />
                Cloud Token Ledger
              </div>
              <h1 className="text-3xl font-black text-white uppercase tracking-tight mt-1">Multi-Model Token Wallet</h1>
              <p className="text-xs text-[#8b949e] mt-1">Connected account: <span className="text-white font-mono font-bold">{user.email}</span></p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={onFetchWallet}
                disabled={loadingWallet}
                className="flex items-center gap-2 px-6 py-3 bg-white/5 border border-white/10 hover:border-indigo-500 rounded-2xl text-[10px] font-black uppercase tracking-widest text-white transition-all active:scale-95"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingWallet ? 'animate-spin' : ''}`} />
                Sync Balance
              </button>
            </div>
          </div>

          {/* 11.3 — Daily Usage Stats + 11.4 Referral Code */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-[#161b22] border border-white/5 rounded-2xl p-5 space-y-2">
              <p className="text-[9px] font-black text-[#484f58] uppercase tracking-widest">Today's Messages</p>
              <p className="text-3xl font-black text-white">{dailyUsage.date === new Date().toDateString() ? dailyUsage.count : 0}</p>
              <p className="text-[10px] text-emerald-400">Unlimited for registered users ✓</p>
            </div>
            <div className="bg-[#161b22] border border-white/5 rounded-2xl p-5 space-y-2">
              <p className="text-[9px] font-black text-[#484f58] uppercase tracking-widest">Today's Builds</p>
              <p className="text-3xl font-black text-white">{dailyUsage.date === new Date().toDateString() ? dailyUsage.builds : 0}</p>
              <p className="text-[10px] text-indigo-400">Preview builds today</p>
            </div>
            <div className="bg-[#161b22] border border-white/5 rounded-2xl p-5 space-y-2">
              <p className="text-[9px] font-black text-[#484f58] uppercase tracking-widest">My Referral Code</p>
              <p className="text-xl font-black text-indigo-400 font-mono">{myReferralCode}</p>
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(`Join NavBharatAI — India's own AI App Maker! Use my code ${myReferralCode} for bonus tokens: https://navbharatai.com`);
                  onToast('Referral link copied! ✓', 'success');
                }}
                className="text-[9px] font-black text-indigo-400 hover:text-white uppercase tracking-widest transition-colors"
              >
                Copy & Share →
              </button>
            </div>
          </div>

          {/* Plans (admin 2026-08-06): the whole account story in one card — Hosting plan (₹99
              Custom Domain, bought from THIS wallet), Database (free, user's own account), Coding
              (pay-per-use). Self-contained: talks to the ownership-checked wallet routes itself. */}
          <HostingPlanCard userId={user.uid} onWalletChanged={onFetchWallet} onToast={onToast} />

          {/* Phase 4.2 — This Month's AI Cost card */}
          {monthlyAiCost !== undefined && (
            <div className="bg-[#161b22] border border-indigo-500/20 rounded-2xl p-5 flex items-center justify-between gap-4">
              <div className="space-y-1">
                <p className="text-[9px] font-black text-[#484f58] uppercase tracking-widest">This Month's AI Cost</p>
                <p className="text-2xl font-black text-indigo-400 font-mono">
                  ${(monthlyAiCost?.totalCostUsd ?? 0).toFixed(4)}
                </p>
                <p className="text-[10px] text-[#8b949e]">{monthlyAiCost?.totalBuilds ?? 0} Pro builds · {monthlyAiCost?.month ?? new Date().toISOString().slice(0, 7)}</p>
              </div>
              <Activity className="w-8 h-8 text-indigo-500/40 shrink-0" />
            </div>
          )}

          {/* Autonomous Warning Alert Popup (Reminder Limit Trigger) */}
          {wallet && wallet.remaining_balance <= reminderLimit && !dismissedReminderWarning && (
            <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 animate-fade-in backdrop-blur-sm">
              <div className="w-full max-w-md bg-[#161b22] border border-red-500/30 rounded-[2.5rem] p-8 space-y-6 shadow-[0_0_50px_rgba(239,68,68,0.25)] text-left relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-red-500 to-rose-600"></div>

                <div className="flex items-center gap-4">
                  <div className="p-4 bg-red-500/10 rounded-2xl border border-red-500/20 text-red-500">
                    <AlertCircle className="w-7 h-7 animate-bounce" />
                  </div>
                  <div>
                    <h3 className="text-xl font-black text-white uppercase tracking-tight">Limit Reached! ⚠️</h3>
                    <p className="text-[10px] text-[#8b949e] font-black uppercase tracking-widest font-mono">Autonomous Budget SRE Warning</p>
                  </div>
                </div>

                <p className="text-xs text-[#8b949e] leading-relaxed font-semibold">
                  Warning! You have reached your reminder limit set at <span className="text-white font-mono font-black">₹{reminderLimit.toFixed(2)}</span>. Your active token wallet balance is now <span className="text-red-400 font-mono font-black animate-pulse">₹{(wallet?.remaining_balance || 10.00).toFixed(4)}</span>.
                </p>

                <div className="space-y-4 bg-black/30 border border-white/5 p-5 rounded-2xl">
                  <span className="text-[10px] text-[#8b949e] font-bold uppercase tracking-wider block">Adjust Warning Threshold Limit</span>
                  <div className="flex items-center gap-3 bg-[#0d1117] border border-white/10 rounded-xl px-4 py-3 focus-within:border-indigo-500 transition-colors">
                    <input
                      type="number"
                      value={reminderLimit === 0 ? '' : reminderLimit}
                      placeholder="Enter limit value in Rupees"
                      onChange={(e) => {
                        const val = parseFloat(e.target.value) || 0;
                        onSetReminderLimit(val);
                      }}
                      className="w-full bg-transparent text-sm font-mono font-bold text-white focus:outline-none"
                    />
                    <span className="text-xs text-[#8b949e] font-bold font-mono">₹</span>
                  </div>
                </div>

                <div className="flex gap-4 pt-2">
                  <button
                    onClick={() => onSetDismissedReminderWarning(true)}
                    className="flex-1 py-4 bg-white/5 border border-white/10 hover:bg-white/10 text-[#8b949e] hover:text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all hover:scale-105 active:scale-95"
                  >
                    Dismiss Warning
                  </button>
                  <button
                    onClick={() => {
                      onSetActiveBillingDetailTab('budget');
                      onSetDismissedReminderWarning(true);
                    }}
                    className="flex-1 py-4 bg-red-600 hover:bg-red-700 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-red-600/20 transition-all hover:scale-105 active:scale-95"
                  >
                    Modify Limits
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* THE FREE GIFT LADDER, made visible (2026-07-28). It used to grant silently: credit
              appeared, a ledger row was written that nothing rendered, and no screen said how much was
              left or when the next one arrived. Placed ABOVE the balance cards because it explains the
              number in them — and because "this was your last free credit" is the moment someone
              decides to recharge. */}
          <FreeGiftBanner
            freeGift={wallet?.freeGift}
            tokensPerRupee={wallet?.tokensPerRupee}
            onRecharge={() => onSetActiveBillingDetailTab('purchase')}
            /* A claim moves real money, so the balance beside it must be re-read from the server
               rather than adjusted locally — a number this screen computed itself could disagree
               with the wallet, and on a billing screen that is the one thing it must never do. */
            onClaimed={onFetchWallet}
          />

          {/* iOS / iPhone App Icons Styled Clickable Cards Panel */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">

            {/* CARD 1: AVAILABLE CREDIT */}
            <div
              data-tour="billing"
              onClick={() => onSetActiveBillingDetailTab('remaining')}
              className={cn(
                "relative rounded-[2.2rem] p-6 h-44 flex flex-col justify-between transition-all duration-300 cursor-pointer overflow-hidden border group select-none",
                activeBillingDetailTab === 'remaining'
                  ? "bg-gradient-to-br from-indigo-950/80 to-[#161b22] border-indigo-505 shadow-[0_0_25px_rgba(99,102,241,0.15)] ring-2 ring-indigo-500"
                  : "bg-[#161b22]/90 border-white/5 hover:border-indigo-500/40 hover:bg-[#1a212b]"
              )}
            >
              <div className="absolute -top-12 -right-12 w-28 h-28 bg-indigo-500/10 rounded-full blur-2xl group-hover:bg-indigo-500/20 transition-all duration-300"></div>
              <div className="flex justify-between items-start">
                <div className={cn(
                  "p-3 rounded-2xl border transition-all duration-300",
                  activeBillingDetailTab === 'remaining'
                    ? "bg-indigo-500/20 border-indigo-400/30 text-indigo-400"
                    : "bg-white/5 border-white/10 text-[#8b949e] group-hover:text-indigo-400 group-hover:bg-indigo-500/10"
                )}>
                  <Wallet className="w-5 h-5" />
                </div>
                <span className="text-[8px] font-black font-mono tracking-widest uppercase bg-indigo-500/10 text-indigo-300 px-2 py-0.5 rounded border border-indigo-500/20">
                  ACTIVE TOKENS
                </span>
              </div>
              <div>
                {/* Billing Phase 2 — token-first: tokens are the wallet's primary unit; ₹ is secondary. */}
                <p className="text-[10px] text-[#8b949e] font-extrabold uppercase tracking-widest text-[#8b949e]">Token Balance</p>
                <h2 className="text-2xl font-black text-white tracking-tight mt-1.5 font-mono truncate">
                  {(wallet?.tokenBalance ?? 0).toLocaleString()} <span className="text-sm font-bold text-[#8b949e]">tokens</span>
                </h2>
                <div className="text-[9px] text-amber-400 font-mono font-bold mt-1 uppercase flex items-center gap-1">
                  <span>≈ ₹{(wallet?.remaining_balance ?? 0).toFixed(2)} value</span>
                </div>
              </div>
            </div>

            {/* CARD 2: PROMOCODE */}
            <div
              onClick={() => onSetActiveBillingDetailTab('gift')}
              className={cn(
                "relative rounded-[2.2rem] p-6 h-44 flex flex-col justify-between transition-all duration-300 cursor-pointer overflow-hidden border group select-none",
                activeBillingDetailTab === 'gift'
                  ? "bg-gradient-to-br from-amber-950/40 to-[#161b22] border-amber-500 shadow-[0_0_25px_rgba(245,158,11,0.15)] ring-2 ring-amber-500"
                  : "bg-[#161b22]/90 border-white/5 hover:border-amber-500/40 hover:bg-[#1a212b]"
              )}
            >
              <div className="absolute -top-12 -right-12 w-28 h-28 bg-amber-500/5 rounded-full blur-2xl group-hover:bg-amber-500/10 transition-all duration-300"></div>
              <div className="flex justify-between items-start">
                <div className={cn(
                  "p-3 rounded-2xl border transition-all duration-300",
                  activeBillingDetailTab === 'gift'
                    ? "bg-amber-500/20 border-amber-400/30 text-amber-400"
                    : "bg-white/5 border-white/10 text-[#8b949e] group-hover:text-amber-400 group-hover:bg-amber-500/10"
                )}>
                  <Gift className="w-5 h-5" />
                </div>
                <span className="text-[8px] font-black font-mono tracking-widest uppercase bg-amber-500/10 text-amber-300 px-2 py-0.5 rounded border border-amber-500/20">
                  REFERRALS
                </span>
              </div>
              <div>
                <p className="text-[10px] text-[#8b949e] font-extrabold uppercase tracking-widest text-[#8b949e]">Promocode</p>
                <h2 className="text-2xl font-black text-white tracking-tight mt-1.5 font-mono truncate">
                  ₹{(billingTransactions.filter(tx => tx.paymentProvider === 'COUPON_REDEEM' || tx.paymentProvider === 'REFERRAL').reduce((sum, tx) => sum + (tx.balanceAdded || 0), 0)).toFixed(2)}
                </h2>
              </div>
            </div>

            {/* CARD 3: BUY TOKENS — promoted to first position (order-first) and always emerald-highlighted
                so the primary recharge CTA visibly stands out from the muted cards (admin request). */}
            <div
              onClick={() => onSetActiveBillingDetailTab('purchase')}
              className={cn(
                "order-first relative rounded-[2.2rem] p-6 h-44 flex flex-col justify-between transition-all duration-300 cursor-pointer overflow-hidden border-2 group select-none shadow-[0_0_30px_rgba(16,185,129,0.28)]",
                activeBillingDetailTab === 'purchase'
                  ? "bg-gradient-to-br from-emerald-900/60 to-[#161b22] border-emerald-400 ring-2 ring-emerald-500"
                  : "bg-gradient-to-br from-emerald-950/50 to-[#161b22] border-emerald-500/70 hover:border-emerald-400 hover:shadow-[0_0_42px_rgba(16,185,129,0.42)]"
              )}
            >
              <div className="absolute -top-12 -right-12 w-28 h-28 bg-emerald-500/5 rounded-full blur-2xl group-hover:bg-emerald-500/10 transition-all duration-300"></div>
              <div className="flex justify-between items-start">
                <div className="p-3 rounded-2xl border transition-all duration-300 bg-emerald-500/20 border-emerald-400/30 text-emerald-400">
                  <CreditCard className="w-5 h-5" />
                </div>
                <span className="text-[8px] font-black font-mono tracking-widest uppercase bg-emerald-500/20 text-emerald-200 px-2 py-0.5 rounded border border-emerald-400/40">
                  ⚡ RECHARGE
                </span>
              </div>
              <div>
                <p className="text-[10px] text-emerald-300 font-extrabold uppercase tracking-widest">Buy Tokens</p>
                <h2 className="text-lg font-black text-white tracking-tight mt-1.5 font-mono">
                  100 Tokens/₹
                </h2>
              </div>
            </div>

            {/* CARD 4: BUDGET & LIMITS */}
            <div
              onClick={() => onSetActiveBillingDetailTab('budget')}
              className={cn(
                "relative rounded-[2.2rem] p-6 h-44 flex flex-col justify-between transition-all duration-300 cursor-pointer overflow-hidden border group select-none",
                activeBillingDetailTab === 'budget'
                  ? "bg-gradient-to-br from-violet-950/40 to-[#161b22] border-violet-500 shadow-[0_0_25px_rgba(139,92,246,0.15)] ring-2 ring-violet-500"
                  : "bg-[#161b22]/90 border-white/5 hover:border-violet-500/40 hover:bg-[#1a212b]"
              )}
            >
              <div className="absolute -top-12 -right-12 w-28 h-28 bg-violet-500/5 rounded-full blur-2xl group-hover:bg-violet-500/10 transition-all duration-300"></div>
              <div className="flex justify-between items-start">
                <div className={cn(
                  "p-3 rounded-2xl border transition-all duration-300",
                  activeBillingDetailTab === 'budget'
                    ? "bg-violet-500/20 border-violet-400/30 text-violet-400"
                    : "bg-white/5 border-white/10 text-[#8b949e] group-hover:text-violet-400 group-hover:bg-violet-500/10"
                )}>
                  <Activity className="w-5 h-5" />
                </div>
                <span className={cn(
                  "text-[8px] font-black font-mono tracking-widest uppercase px-2 py-0.5 rounded border",
                  wallet && wallet.remaining_balance <= budgetLimit
                    ? "bg-red-500/10 text-red-400 border-red-500/20 animate-pulse"
                    : "bg-violet-500/10 text-violet-300 border-violet-500/20"
                )}>
                  {wallet && wallet.remaining_balance <= budgetLimit ? 'FREE MODE ⚠️' : 'LIMIT ACTIVE'}
                </span>
              </div>
              <div>
                <p className="text-[10px] text-[#8b949e] font-extrabold uppercase tracking-widest text-[#8b949e]">Budget</p>
                <h2 className="text-[11px] font-black text-white tracking-tight mt-1.5 font-mono flex flex-wrap gap-1 leading-relaxed">
                  <span>Rem: ₹{reminderLimit}</span>
                  <span className="opacity-40">|</span>
                  <span>Bud: ₹{budgetLimit}</span>
                </h2>
              </div>
            </div>
          </div>

          {/* Integrated Sub-Panel Details Module */}
          <div className="bg-[#161b22] border border-white/10 rounded-[2.5rem] p-6 sm:p-8 shadow-3xl text-left space-y-6">

            {/* DETAILED TAB 1: AVAILABLE CREDIT */}
            {activeBillingDetailTab === 'remaining' && (
              <div className="space-y-6 animate-in fade-in duration-300">
                <div className="flex flex-wrap items-center justify-between border-b border-white/5 pb-4 gap-4">
                  <div>
                    <div className="inline-flex items-center gap-2 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest font-mono">
                      <Sparkles className="w-3.5 h-3.5" /> Core Token Audit
                    </div>
                    <h3 className="text-lg font-black text-white uppercase tracking-tight mt-2">Active Multi-Model Resource Pool</h3>
                  </div>
                  <button
                    onClick={() => {
                      onFetchWallet();
                      onSetDismissedReminderWarning(false);
                    }}
                    disabled={loadingWallet}
                    className="flex items-center gap-2 px-5 py-2.5 bg-white/5 border border-white/10 hover:border-indigo-500 rounded-xl text-[10px] font-black uppercase tracking-widest text-white transition-all active:scale-95"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingWallet ? 'animate-spin' : ''}`} />
                    Refresh Wallet Registry
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-2">
                  <div className="space-y-4">
                    {/* Billing Phase 2 — honest copy: tokens buy real AI work (input + output are both
                        metered); every finished Pro build deducts its cost from this balance. */}
                    <p className="text-xs text-[#8b949e] leading-relaxed font-semibold">
                      Your tokens never expire and pay for real AI build work. Every finished Pro build deducts its actual cost from this balance — you can see each deduction in the usage statement below.
                    </p>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-black/30 border border-white/5 rounded-2xl p-4 font-mono">
                        <div className="text-[9px] text-[#8b949e] font-black uppercase tracking-wider">Estimated Lifespan</div>
                        <div className="text-lg font-black text-white mt-1">Unlimited</div>
                        <div className="text-[9px] text-[#8b949e] mt-1">Tokens never expire</div>
                      </div>
                      <div className="bg-black/30 border border-white/5 rounded-2xl p-4 font-mono">
                        <div className="text-[9px] text-[#8b949e] font-black uppercase tracking-wider">Token Balance</div>
                        <div className="text-lg font-black text-white mt-1">
                          {/* The REAL token balance — not a derived ₹×rate approximation (a stale ×200
                              hardcode used to live here; the true rate travels as wallet.tokensPerRupee). */}
                          {(wallet?.tokenBalance ?? 0).toLocaleString()}
                        </div>
                        <div className="text-[9px] text-[#8b949e] mt-1">Tokens remaining</div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-black/30 border border-white/5 rounded-[2rem] p-6 space-y-3 font-mono text-xs">
                    <h4 className="text-[10px] font-black text-white uppercase tracking-widest font-sans">Live Wallet Breakdown</h4>
                    <div className="flex justify-between items-center py-0.5">
                      <span className="text-[#8b949e]">Total Balance Added:</span>
                      <span className="text-[#58a6ff] font-bold">₹{(wallet?.total_balance || 10.00).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center py-0.5">
                      <span className="text-[#8b949e]">Total Spent Consumption:</span>
                      <span className="text-orange-400 font-bold">₹{((wallet?.total_balance || 10.00) - (wallet?.remaining_balance || 10.00)).toFixed(4)}</span>
                    </div>
                    <div className="border-t border-white/5 pt-3.5 flex justify-between items-center text-sm font-black">
                      <span className="text-[#8b949e] tracking-tight font-sans">Active Token Balance:</span>
                      <span className="text-emerald-400">₹{(wallet?.remaining_balance || 10.00).toFixed(4)}</span>
                    </div>
                  </div>
                </div>

                {/* Unified Statement: Purchase Invoices & prompt usages */}
                <div className="space-y-4 pt-4 border-t border-white/5">
                  <h4 className="text-xs font-black text-white uppercase tracking-widest font-mono">Invoice Records & Task Deductions Trace</h4>
                  <div className="space-y-6">
                    <div>
                      <p className="text-[9px] text-[#58a6ff] font-black uppercase tracking-wider font-mono mb-2">Deposits & Promotional Code Additions</p>
                      <div className="overflow-y-auto max-h-[160px] custom-scrollbar border border-white/5 rounded-2xl bg-black/10">
                        <table className="w-full text-left text-[11px] font-mono">
                          <thead>
                            <tr className="border-b border-white/5 text-[#8b949e] font-black uppercase tracking-widest text-[9px] bg-black/40">
                              <th className="py-2.5 px-4">OrderID / Reference</th>
                              <th className="py-2.5 px-4">Type</th>
                              <th className="py-2.5 px-4 text-emerald-400">Amount Received</th>
                              <th className="py-2.5 px-4">Datetime</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5 font-bold">
                            {billingTransactions.map((tx: any, i: number) => (
                              <tr key={i} className="hover:bg-white/5 transition-colors">
                                <td className="py-2.5 px-4 text-white font-semibold truncate max-w-[140px]">#{tx.orderId || tx.transactionId}</td>
                                <td className="py-2.5 px-4 text-[#8b949e]">
                                  <span className="text-[9px] bg-indigo-500/10 text-indigo-400 px-1.5 py-0.5 rounded uppercase font-black tracking-wider">
                                    {tx.paymentProvider || 'DEPOSIT'}
                                  </span>
                                </td>
                                <td className="py-2.5 px-4 text-emerald-400 font-black">₹{(tx.balanceAdded || tx.amountPaid || 0).toFixed(2)}</td>
                                <td className="py-2.5 px-4 text-[#8b949e] text-[10px]">
                                  {tx.createdAt ? new Date(tx.createdAt.seconds ? tx.createdAt.seconds * 1000 : tx.createdAt).toLocaleString() : 'Just now'}
                                </td>
                              </tr>
                            ))}
                            {billingTransactions.length === 0 && (
                              <tr>
                                <td colSpan={4} className="py-6 text-center text-[#8b949e] font-black uppercase tracking-widest text-[9px]">
                                  No transactions recorded yet.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div>
                      <p className="text-[9px] text-orange-400 font-black uppercase tracking-wider font-mono mb-2">Prompt Dedution logs (Deducted per command output)</p>
                      <div className="overflow-y-auto max-h-[180px] custom-scrollbar border border-white/5 rounded-2xl bg-black/10">
                        <table className="w-full text-left text-[11px] font-mono">
                          <thead>
                            <tr className="border-b border-white/5 text-[#8b949e] font-black uppercase tracking-widest text-[9px] bg-black/40">
                              <th className="py-2.5 px-4">Command / Agent Call</th>
                              <th className="py-2.5 px-4">Output Tokens</th>
                              <th className="py-2.5 px-4 text-red-400">Rupees Charged</th>
                              <th className="py-2.5 px-4">Datetime</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5 font-bold">
                            {billingLogs.map((log: any, i: number) => (
                              <tr key={i} className="hover:bg-white/5 transition-colors">
                                <td className="py-2.5 px-4 text-white font-semibold uppercase">{log.agent || 'Chat Prompt'}</td>
                                <td className="py-2.5 px-4 text-[#8b949e] truncate max-w-[150px]"></td>
                                <td className="py-2.5 px-4 text-orange-400">{(log.output_tokens || log.outputTokens || 0).toLocaleString()}</td>
                                <td className="py-2.5 px-4 text-red-405 font-black text-red-400">-₹{(log.amount_deducted || log.amountDeducted || 0).toFixed(4)}</td>
                                <td className="py-2.5 px-4 text-[#8b949e] text-[10px]">
                                  {log.timestamp ? (log.timestamp.seconds ? new Date(log.timestamp.seconds * 1000).toLocaleString() : new Date(log.timestamp).toLocaleString()) : 'Just now'}
                                </td>
                              </tr>
                            ))}
                            {billingLogs.length === 0 && (
                              <tr>
                                <td colSpan={4} className="py-6 text-center text-[#8b949e] font-black uppercase tracking-widest text-[9px]">
                                  No AI task execution logs captured yet.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* DETAILED TAB 2: PROMOCODE */}
            {activeBillingDetailTab === 'gift' && (
              <div className="space-y-6 animate-in fade-in duration-300">
                <div className="border-b border-white/5 pb-4">
                  <span className="text-[10px] bg-amber-500/10 border border-amber-500/20 text-amber-400 px-3 py-1.5 rounded-xl font-black uppercase tracking-wider font-mono">
                    Promo Hub & Referrals
                  </span>
                  <h3 className="text-xl font-black text-white uppercase tracking-tight mt-3">Promotional Voucher & Reward Engine</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
                  <div className="space-y-6">

                    {/* Copyable Code Box */}
                    <div className="bg-black/30 border border-amber-500/20 rounded-2xl p-6 relative overflow-hidden group">
                      <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/5 rounded-full blur-xl group-hover:bg-amber-500/10 transition-all"></div>
                      <h4 className="text-[10px] text-[#8b949e] font-black uppercase tracking-widest">Your Unique Referral Code</h4>
                      <div className="flex items-center justify-between gap-4 mt-3 bg-[#0d1117] border border-white/10 rounded-xl px-5 py-3.5">
                        <span className="text-base text-amber-400 font-mono font-black tracking-widest">
                          NAV-{(user?.email || 'USER').split('@')[0].toUpperCase()}-REF
                        </span>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(`NAV-${(user?.email || 'USER').split('@')[0].toUpperCase()}-REF`);
                            onSetCopiedReferral(true);
                            setTimeout(() => onSetCopiedReferral(false), 2000);
                          }}
                          className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-black text-[10px] font-black uppercase tracking-widest rounded-lg transition-all"
                        >
                          {copiedReferral ? 'COPIED!' : 'COPY'}
                        </button>
                      </div>
                      <p className="text-xs text-amber-200/70 leading-relaxed font-semibold mt-4">
                        🤝 Earn <span className="text-white font-black">10% Free Tokens</span> for every referral — when your referred user purchases tokens, 10% gets added to your account for free!
                      </p>
                    </div>

                    {/* Voucher redeem panel */}
                    <div className="bg-black/20 border border-white/5 rounded-2xl p-6 space-y-4">
                      <div>
                        <h4 className="text-xs font-black text-white uppercase tracking-wider">Redeem Reward Coupons</h4>
                        <p className="text-[10px] text-[#8b949e] font-bold font-mono">Each promo code / referral code can only be applied once!</p>
                      </div>
                      <div className="flex gap-3">
                        <input
                          type="text"
                          placeholder="e.g. WELCOME100, NAVBHARAT50"
                          value={couponCodeInput}
                          onChange={(e) => onSetCouponCodeInput(e.target.value)}
                          className="flex-1 bg-[#0d1117] border border-white/10 rounded-xl px-4 py-3 text-xs font-mono font-bold uppercase tracking-widest text-white focus:outline-none focus:border-amber-500 transition-colors"
                        />
                        <button
                          onClick={() => onRedeemPromoCoupon(couponCodeInput)}
                          disabled={isRedeemingCoupon || !couponCodeInput}
                          className="px-6 py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-500/20 disabled:text-[#8b949e]/30 text-black rounded-xl font-black uppercase tracking-widest text-[9px] transition-all duration-200"
                        >
                          {isRedeemingCoupon ? 'VALIDATING...' : 'APPLY CODE'}
                        </button>
                      </div>

                      {couponError && (
                        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-xl text-xs flex items-center gap-2 font-semibold">
                          <AlertCircle className="w-4 h-4 shrink-0" />
                          <span>{couponError}</span>
                        </div>
                      )}

                      {couponSuccess && (
                        <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 p-3 rounded-xl text-xs flex items-center gap-2 font-semibold animate-pulse">
                          <CheckCircle2 className="w-4 h-4 shrink-0" />
                          <span>{couponSuccess}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Refer history */}
                  <div className="space-y-4">
                    <h4 className="text-xs font-black text-white uppercase tracking-wider font-mono">Referred Accounts & Tokens Earned</h4>
                    <div className="border border-white/5 rounded-2xl overflow-hidden font-mono text-xs bg-black/10">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="border-b border-white/5 bg-black/30 text-[#8b949e] font-black uppercase tracking-widest text-[9px]">
                            <th className="py-2.5 px-4">User Email Referred</th>
                            <th className="py-2.5 px-4">Reward Link</th>
                            <th className="py-2.5 px-4 text-emerald-400">Claim Value</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5 font-semibold">
                          {referralHistory.map((ref, idx) => (
                            <tr key={idx} className="hover:bg-white/5 transition-all">
                              <td className="py-3 px-4 text-white font-medium">{ref.email}</td>
                              <td className="py-3 px-4">
                                <span className={`text-[8px] px-2 py-0.5 rounded font-black uppercase tracking-wider ${
                                  ref.status === 'CLAIMED' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-500/10 text-slate-400 border border-slate-500/15'
                                }`}>
                                  {ref.status} (10%)
                                </span>
                              </td>
                              <td className="py-3 px-4 text-emerald-400 font-bold">₹{ref.creditsEarned.toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* DETAILED TAB 3: BUY CREDIT */}
            {activeBillingDetailTab === 'purchase' && (
              <div className="space-y-6 animate-in fade-in duration-300">
                <div className="flex flex-wrap items-center justify-between border-b border-white/5 pb-4 gap-4">
                  <div>
                    <span className="text-[10px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-3 py-1.5 rounded-xl font-black uppercase tracking-wider font-mono">
                      Balance Store & Gateway simulation
                    </span>
                    <h3 className="text-xl font-black text-white uppercase tracking-tight mt-3">Buy Tokens Instant Gateway</h3>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
                  <div className="space-y-6">
                    <div className="bg-black/20 border border-white/5 p-6 rounded-[2rem] space-y-4">
                      <h4 className="text-xs font-black text-white uppercase tracking-widest font-mono">Instant balance calculator (₹1 to ₹999999)</h4>

                      <div className="space-y-3">
                        <label className="text-[10px] text-[#8b949e] font-bold uppercase tracking-wider block">Enter Amount (₹)</label>
                        <div className="flex items-center gap-3 bg-[#0d1117] border border-white/10 rounded-xl px-4 py-3 focus-within:border-emerald-500 transition-colors">
                          <span className="text-emerald-400 font-mono font-bold text-sm">₹</span>
                          <input
                            type="number"
                            min="1"
                            max="999999"
                            value={buyAmountInput}
                            onChange={(e) => onSetBuyAmountInput(e.target.value)}
                            className="w-full bg-transparent text-white font-mono font-bold text-sm focus:outline-none"
                            placeholder="Amount in Rupees"
                          />
                        </div>
                      </div>

                      {/* Live tokens calculations outputs */}
                      <div className="grid grid-cols-2 gap-4 bg-black/40 border border-white/5 p-4 rounded-xl font-mono text-center">
                        <div>
                          <span className="text-[9px] text-[#8b949e] font-black uppercase tracking-widest block">Wallet Tokens</span>
                          <span className="text-base text-emerald-400 font-extrabold block mt-1">{(parseFloat(buyAmountInput) || 0) * 100}</span>
                          <span className="text-[8px] text-[#8b949e]">at ₹1 = 100 tokens</span>
                        </div>
                        <div>
                          <span className="text-[9px] text-[#8b949e] font-black uppercase tracking-widest block">Equivalent AI Outputs</span>
                          <span className="text-base text-indigo-400 font-extrabold block mt-1">{(parseFloat(buyAmountInput) || 0) * 100 * 200}</span>
                          <span className="text-[8px] text-[#8b949e]">At 1 token = 200 outputs</span>
                        </div>
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
                        className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-xl font-black uppercase tracking-widest text-xs shadow-lg shadow-emerald-600/20 active:scale-95 transition-all"
                      >
                        Purchase Wallet Tokens (₹{(parseFloat(buyAmountInput) || 0).toLocaleString('en-IN')})
                      </button>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <p className="text-xs text-[#8b949e] leading-relaxed font-semibold">
                      Tokens are immediately funded into your multi-model ledger on successful bank sync. Checkout parameters are fully encrypted.
                    </p>

                    <h4 className="text-xs font-black text-white uppercase tracking-wider font-mono">Invoice Records Summary</h4>
                    <div className="overflow-y-auto max-h-[220px] custom-scrollbar border border-white/5 rounded-2xl bg-black/10">
                      <table className="w-full text-left text-xs font-mono">
                        <thead>
                          <tr className="border-b border-white/5 text-[#8b949e] font-black uppercase tracking-widest text-[9px] bg-black/40">
                            <th className="py-2 px-4">OrderID</th>
                            <th className="py-2 px-4 text-emerald-400">Rupees Paid</th>
                            <th className="py-2 px-4">Method</th>
                            <th className="py-2 px-4">Datetime</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5 font-bold">
                          {billingTransactions.filter(tx => tx.paymentProvider !== 'WELCOME_BONUS' && tx.paymentProvider !== 'COUPON_REDEEM').map((tx: any, i: number) => (
                            <tr key={i} className="hover:bg-white/5 transition-colors">
                              <td className="py-2.5 px-4 text-white truncate max-w-[125px]">#{tx.orderId || tx.transactionId}</td>
                              <td className="py-2.5 px-4 text-emerald-400">₹{(tx.amountPaid || tx.amount || 0).toFixed(2)}</td>
                              <td className="py-2.5 px-4 text-indigo-400 text-[10px] uppercase">{tx.paymentProvider || 'CASHFREE'}</td>
                              <td className="py-2.5 px-4 text-[#8b949e]">
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
            )}

            {/* DETAILED TAB 4: BUDGET & REMINDER SRE */}
            {activeBillingDetailTab === 'budget' && (
              <div className="space-y-6 animate-in fade-in duration-300">
                <div className="border-b border-white/5 pb-4">
                  <span className="text-[10px] bg-violet-500/10 border border-violet-500/20 text-violet-400 px-3 py-1.5 rounded-xl font-black uppercase tracking-wider font-mono">
                    Autonomous SRE Controls
                  </span>
                  <h3 className="text-xl font-black text-white uppercase tracking-tight mt-3">Safety & Threshold Limits console</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
                  <div className="space-y-6 bg-black/20 border border-white/5 p-6 rounded-[2rem]">

                    {/* REMINDER SETTING */}
                    <div className="space-y-3">
                      <h4 className="text-xs font-black text-white uppercase tracking-widest font-mono">a. Reminder warning limit</h4>
                      <p className="text-xs text-[#8b949e]">When your credit falls below this limit, you'll see a ⚠️ popup warning. You can change the reminder threshold in settings.</p>
                      <div className="flex items-center gap-3 bg-[#0d1117] border border-white/10 rounded-xl px-4 py-3 focus-within:border-violet-500 transition-all">
                        <input
                          type="text"
                          value={tempReminderLimit}
                          placeholder="Enter warning limit in Rupees"
                          onChange={(e) => onSetTempReminderLimit(e.target.value)}
                          className="w-full bg-transparent text-white font-mono font-bold text-sm focus:outline-none"
                        />
                        <span className="text-xs text-[#8b949e] font-bold font-mono">₹</span>
                      </div>
                    </div>

                    {/* BUDGET FLOOR SETTING */}
                    <div className="space-y-3 pt-4 border-t border-white/5">
                      <h4 className="text-xs font-black text-white uppercase tracking-widest font-mono">b. Last hard budget limit</h4>
                      <p className="text-xs text-[#8b949e]">Set your budget floor value. At this limit the system automatically switches you to Free-version mode.</p>
                      <div className="flex items-center gap-3 bg-[#0d1117] border border-white/10 rounded-xl px-4 py-3 focus-within:border-violet-500 transition-all">
                        <input
                          type="text"
                          value={tempBudgetLimit}
                          placeholder="Enter budget limit in Rupees"
                          onChange={(e) => onSetTempBudgetLimit(e.target.value)}
                          className="w-full bg-transparent text-white font-mono font-bold text-sm focus:outline-none"
                        />
                        <span className="text-xs text-[#8b949e] font-bold font-mono">₹</span>
                      </div>
                    </div>

                    {/* ACTION SET BUTTON */}
                    <div className="pt-4 border-t border-white/5 flex flex-col gap-3">
                      {limitError && (
                        <div className="text-xs bg-red-500/10 border border-red-500/20 text-red-100 p-3.5 rounded-xl font-bold font-mono">
                          ⚠️ {limitError}
                        </div>
                      )}
                      {limitSuccess && (
                        <div className="text-xs bg-emerald-500/10 border border-emerald-500/20 text-emerald-100 p-3.5 rounded-xl font-bold font-mono">
                          ✅ {limitSuccess}
                        </div>
                      )}
                      <button
                        onClick={() => {
                          onSetLimitError(null);
                          onSetLimitSuccess(null);
                          const rLimit = parseFloat(tempReminderLimit);
                          const bLimit = parseFloat(tempBudgetLimit);
                          const available = wallet?.remaining_balance || 10.0;

                          if (isNaN(rLimit) || rLimit < 0) {
                            onSetLimitError("Please enter a valid Reminder Warning Limit (>= 0).");
                            return;
                          }
                          if (isNaN(bLimit) || bLimit < 0) {
                            onSetLimitError("Please enter a valid Hard Budget Limit (>= 0).");
                            return;
                          }

                          // Rule 2a: always warning limit < hard budget limit
                          if (rLimit >= bLimit) {
                            onSetLimitError("Warning limit must be strictly LESS than the hard budget limit (Warning Limit < Hard Budget Limit)!");
                            return;
                          }

                          // Rule 2b: always last hard budget limit < total available credit
                          if (bLimit >= available) {
                            onSetLimitError(`Hard budget limit (₹${bLimit.toFixed(2)}) must be strictly LESS than your total available credit (₹${available.toFixed(4)})! Please recharge or lower the limit.`);
                            return;
                          }

                          onSetReminderLimit(rLimit);
                          onSetBudgetLimit(bLimit);
                          onSetLimitSuccess("Success: Threshold limits successfully configured and applied!");

                          setTimeout(() => {
                            onSetLimitSuccess(null);
                          }, 4000);
                        }}
                        className="w-full py-3 bg-violet-600 hover:bg-violet-500 hover:border-violet-400 border border-violet-700 rounded-xl text-xs font-black uppercase tracking-widest text-white transition-all active:scale-95 flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-violet-900/20"
                      >
                        Set Limits & Save Controls
                      </button>
                    </div>
                  </div>

                  {/* Active SRE system status card */}
                  <div className="space-y-4">
                    <h4 className="text-xs font-black text-white uppercase tracking-wider font-mono">System Compliance & VIP Status</h4>
                    <div className={cn(
                      "p-6 rounded-[2rem] border relative overflow-hidden transition-all duration-300",
                      wallet && wallet.remaining_balance <= budgetLimit
                        ? "border-red-500/20 bg-red-500/5 text-red-100"
                        : "border-emerald-500/20 bg-emerald-500/5 text-emerald-100"
                    )}>
                      <div className="flex items-center gap-3">
                        {wallet && wallet.remaining_balance <= budgetLimit ? (
                          <div className="p-3 bg-red-500/10 rounded-2xl border border-red-500/20 text-red-400">
                            <AlertCircle className="w-5 h-5 animate-pulse" />
                          </div>
                        ) : (
                          <div className="p-3 bg-emerald-500/10 rounded-2xl border border-emerald-500/20 text-emerald-400">
                            <ShieldCheck className="w-5 h-5" />
                          </div>
                        )}
                        <div>
                          <span className="text-[10px] text-[#8b949e] font-black uppercase tracking-widest font-mono block">Compliance Status</span>
                          <span className="text-sm font-black uppercase">
                            {wallet && wallet.remaining_balance <= budgetLimit ? 'Free version enabled mode' : 'Premium VIP Active'}
                          </span>
                        </div>
                      </div>

                      <p className="text-xs text-[#8b949e] leading-relaxed mt-4 font-semibold">
                        {wallet && wallet.remaining_balance <= budgetLimit
                          ? "Alert: Your active credit has reached your budget limit. Premium high-compute models are paused, and NavBharat AI Free core engine is running for basic queries only."
                          : `Compliance: Perfect working conditions. Remaining credit exceeds budget limits. Safe computing threshold remains above the set ${budgetLimit} INR constraint.`
                        }
                      </p>
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-white/5">
                  <button
                    onClick={() => window.open(window.location.href, '_blank')}
                    className="w-full py-3 bg-indigo-600/10 hover:bg-indigo-600 text-indigo-400 hover:text-white rounded-xl text-[9px] font-black uppercase tracking-widest transition-all gap-2 flex items-center justify-center"
                  >
                    Still having issues? Try Open in New Tab
                    <ExternalLink className="w-3 h-3" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

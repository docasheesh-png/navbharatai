/**
 * Wallet & Billing — three pages, one balance.
 *
 *   Buy Tokens  ·  Promo Code (referral rewards, promo codes, gift codes)  ·  History
 *
 * Redesigned 2026-10-14 (admin brief: a wallet an ordinary Indian user understands without instructions,
 * mobile first). It SUPERSEDES the three capsules of 2026-09-22 and the WALLET_V2_UI "three doors": two
 * competing three-button headers is exactly the conflicting navigation the brief forbids, so there is
 * one — the tab bar in `WalletHeader`.
 *
 * Pure render — all state and side effects stay in App.tsx and are threaded in via explicit typed props.
 * That is why NOTHING about money changed: the order is still created by `onCreateBillingOrder`, the
 * store packs by `onBuyStorePack`, the coupon by `onRedeemPromoCoupon`; each page is a clearer way to
 * reach the SAME handlers. The page is chosen through the `activeBillingDetailTab` App.tsx already owns
 * (`walletTabs.ts` maps its four values onto the three pages), so the red-dot trail and every deep link
 * that used to open a tab still opens the right page.
 *
 * Everything that is not one of the three pages — hosting plans and add-ons, the day's usage, this
 * month's AI cost — lives under ONE collapsed "Plans, add-ons and usage" section, so it is reachable
 * and never competes with the three pages for attention.
 */
import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, Wallet, Activity } from 'lucide-react';
import { skuById } from '../../lib/catalogue';
import { HostingPlanCard } from './HostingPlanCard';
import { HostingAddonCard } from './HostingAddonCard';
import { WalletStatementPanel } from './WalletStatementPanel';
import { AppLockGate } from '../AppLockGate';
import { WalletHeader } from '../wallet/WalletHeader';
import { TokenPurchaseTab } from '../wallet/TokenPurchaseTab';
import { PromoRewardsTab } from '../wallet/PromoRewardsTab';
import type { WalletIntent } from '../../lib/walletIntent';
import type { ReferralProgress } from '../../hooks/useReferralProgress';
import { tabForDetail, detailForTab, type WalletTab } from '../../lib/walletTabs';
import type { PurchaseRail, StoreConfig } from '../../lib/storePurchase';
import { DEFAULT_PLATFORM_FEE_PCT } from '../../lib/platformFee';
import type { GiftCodeRow } from '../../lib/giftCodeRow';
import { walletNeedsTopUp } from '../../lib/walletNeedsTopUp';

/**
 * Fallback bounds for the gift form, used only until the server's own numbers arrive.
 *
 * They MATCH `giftCodes.ts` deliberately: a form that offered an amount the server refuses would
 * produce a refusal the user cannot act on. The server is still the authority — it re-checks every
 * order — these are what the field shows in the first render.
 */
const MIN_GIFT_FALLBACK_INR = 100;
const MAX_GIFT_FALLBACK_INR = 5_000;

type BillingDetailTab = 'purchase' | 'gift' | 'use' | 'remaining';
type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface BillingPanelProps {
  user: { uid: string; email?: string | null } | null;
  wallet: any;
  loadingWallet: boolean;
  dailyUsage: { date: string; count: number; builds: number };
  billingTransactions: any[];
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
  /** The referral state for this account — see useReferralProgress (the app's four steps or the website's two). */
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
  /**
   * Go-live PR 14 (WALLET_V2_UI, default OFF): when true, `walletIntent` (a `/wallet?intent=…` deep link,
   * e.g. the chat card's Buy) opens the right page — Buy Tokens with a suggested amount, History, or the
   * plans section with a service pre-selected. False/absent ⇒ the panel opens on whatever page App.tsx
   * says, exactly as before. (The three "doors" this flag used to show are gone: the tab bar is the one
   * navigation.)
   */
  walletV2Ui?: boolean;
  walletIntent?: WalletIntent | null;
  /** Phase 4.2 — current month's AI cost accumulated from Pro builds. */
  monthlyAiCost?: { totalBuilds: number; totalCostUsd: number; month: string } | null;
}

export function BillingPanel(props: BillingPanelProps) {
  const {
    user, wallet, loadingWallet, dailyUsage,
    billingTransactions, activeBillingDetailTab,
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
    monthlyAiCost,
  } = props;

  const walletV2Ui = props.walletV2Ui === true;
  const intent = props.walletIntent ?? null;
  const tab: WalletTab = tabForDetail(activeBillingDetailTab);
  const selectTab = useCallback((t: WalletTab) => onSetActiveBillingDetailTab(detailForTab(t)), [onSetActiveBillingDetailTab]);
  const [plansOpen, setPlansOpen] = useState(walletV2Ui && intent?.door === 'buy_services');

  // The deep link (`/wallet?intent=…`, the chat card's Buy) — honoured only while WALLET_V2_UI is on, as
  // before. It now opens a PAGE: top-up → Buy Tokens (with the suggested amount), usage → History,
  // buy services → the plans section, opened and scrolled to.
  useEffect(() => {
    if (!walletV2Ui || !intent) return;
    if (intent.door === 'add_money') {
      selectTab('buy');
      if (intent.amountInr) onSetBuyAmountInput(String(intent.amountInr));
    } else if (intent.door === 'usage_bills') {
      selectTab('history');
    } else {
      setPlansOpen(true);
      window.setTimeout(() => document.getElementById('wallet-buy-services')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletV2Ui, intent]);
  const preselected = walletV2Ui && intent?.skuId ? skuById(intent.skuId) : null;

  // THE LAST STEPS OF THE TOP-UP TRAIL (admin 2026-09-22: "☰ → wallet and billing → buy token → purchage
  // wallet token par ek red dot"). The same predicate the ☰ button and the sidebar row use, so the dot
  // cannot lead somewhere it then disappears from. It reads the wallet this panel was already handed.
  const needsTopUp = walletNeedsTopUp({ wallet, loading: loadingWallet });

  return (
    <div
      className="min-h-screen flex-1 bg-surface px-4 pt-4 text-left sm:px-6 sm:pt-6"
      // The page's last control must clear the app's bottom bar and a phone's home indicator.
      style={{ paddingBottom: 'calc(2rem + var(--nb-safe-below, env(safe-area-inset-bottom, 0px)))' }}
    >
      {!user ? (
        <div className="mx-auto max-w-md space-y-5 py-20 text-center">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-accent/10 text-accent-text" aria-hidden>
            <Wallet className="h-8 w-8" />
          </span>
          <div className="space-y-2">
            <h2 className="text-xl font-extrabold text-ink">Sign in to see your wallet</h2>
            <p className="text-sm font-semibold text-muted">Your tokens, rewards and history are saved to your account.</p>
          </div>
          <button
            type="button"
            onClick={onShowAuth}
            className="min-h-[52px] w-full rounded-2xl bg-accent px-8 text-base font-bold text-on-accent hover:opacity-90 sm:w-auto"
          >
            Sign in
          </button>
        </div>
      ) : (
        <div className="mx-auto w-full max-w-2xl space-y-5 pb-2">
          <div>
            <h1 className="text-xl font-extrabold text-ink">Wallet &amp; Billing</h1>
            <p className="mt-0.5 break-all text-xs font-semibold text-muted">{user.email}</p>
          </div>

          <WalletHeader
            wallet={wallet}
            loading={loadingWallet}
            onRefresh={onFetchWallet}
            active={tab}
            onSelect={selectTab}
            needsTopUp={needsTopUp}
          />

          <div id="wallet-panel" role="tabpanel" aria-labelledby={`wallet-tab-${tab}`} className="space-y-5">
            {tab === 'buy' && (
              <TokenPurchaseTab
                userId={user.uid}
                platformFeePct={platformFeePct}
                storeRail={storeRail as PurchaseRail}
                storeConfig={storeConfig as StoreConfig | null}
                buyingProductId={buyingProductId}
                storePurchaseNotice={storePurchaseNotice}
                onBuyStorePack={onBuyStorePack}
                buyAmountInput={buyAmountInput}
                onSetBuyAmountInput={onSetBuyAmountInput}
                isRecharging={isRecharging}
                onCreateBillingOrder={onCreateBillingOrder}
                needsTopUp={needsTopUp}
                billingTransactions={billingTransactions}
              />
            )}

            {tab === 'promo' && (
              <PromoRewardsTab
                userId={user.uid}
                referral={referral}
                onRefreshReferral={onRefreshReferral}
                onToast={onToast}
                couponCodeInput={couponCodeInput}
                onSetCouponCodeInput={onSetCouponCodeInput}
                isRedeemingCoupon={isRedeemingCoupon}
                couponError={couponError}
                couponSuccess={couponSuccess}
                onRedeemPromoCoupon={onRedeemPromoCoupon}
                platformFeePct={platformFeePct}
                giftFaceInput={giftFaceInput}
                onSetGiftFaceInput={onSetGiftFaceInput}
                isBuyingGift={isBuyingGift}
                giftError={giftError}
                giftCodes={giftCodes as GiftCodeRow[]}
                giftBounds={giftBounds}
                lastGiftCode={lastGiftCode as GiftCodeRow | null}
                onCreateGiftOrder={onCreateGiftOrder}
              />
            )}

            {tab === 'history' && <WalletStatementPanel userId={user.uid} wallet={wallet} />}
          </div>

          {/* EVERYTHING ELSE — one collapsed section, so the three pages above stay the whole story.
              The plan cards fetch only when it is opened (they are not rendered while it is closed). */}
          <div id="wallet-buy-services" />
          <section className="rounded-2xl border border-line bg-card">
            <button
              type="button"
              onClick={() => setPlansOpen((o) => !o)}
              aria-expanded={plansOpen}
              aria-controls="wallet-more"
              className="flex min-h-[56px] w-full items-center justify-between gap-3 rounded-2xl p-4 text-left"
            >
              <span>
                <span className="block text-sm font-bold text-ink">Plans, add-ons and usage</span>
                <span className="block text-xs font-semibold text-muted">Hosting plan, add-ons and what you used today</span>
              </span>
              <ChevronDown className={`h-5 w-5 shrink-0 text-muted transition-transform ${plansOpen ? 'rotate-180' : ''}`} aria-hidden />
            </button>
            {plansOpen && (
              <div id="wallet-more" className="space-y-4 border-t border-line p-4">
                {preselected && (
                  <div className="rounded-2xl border border-line bg-raised px-4 py-3 text-sm text-ink" data-testid="wallet-preselected">
                    You picked <span className="font-semibold">{preselected.name}</span>. {preselected.summary}
                  </div>
                )}
                {/* Plans (admin 2026-08-06): the whole account story in one card — Hosting plan (₹99
                    Custom Domain, bought from THIS wallet), Database (free, user's own account), Coding
                    (pay-per-use). Self-contained: talks to the ownership-checked wallet routes itself.
                    🔒 APP LOCK — "Subscription & plans" (admin 2026-09-13). This card IS the subscription
                    surface: buying a plan spends the wallet, and the auto-renew switch decides whether it
                    is charged again. Default OFF, so a user who never ticked it sees it exactly as before. */}
                <AppLockGate
                  userId={user.uid}
                  area="subscription"
                  embedded
                  render={() => (
                    <>
                      <HostingPlanCard userId={user.uid} onWalletChanged={onFetchWallet} onToast={onToast} />
                      <HostingAddonCard userId={user.uid} onWalletChanged={onFetchWallet} onToast={onToast} />
                    </>
                  )}
                />

                <div className="grid grid-cols-2 gap-2.5">
                  <div className="rounded-2xl border border-line bg-surface p-3.5">
                    <p className="text-xs font-semibold text-muted">Messages today</p>
                    <p className="mt-0.5 text-2xl font-extrabold text-ink">{dailyUsage.date === new Date().toDateString() ? dailyUsage.count : 0}</p>
                  </div>
                  <div className="rounded-2xl border border-line bg-surface p-3.5">
                    <p className="text-xs font-semibold text-muted">Builds today</p>
                    <p className="mt-0.5 text-2xl font-extrabold text-ink">{dailyUsage.date === new Date().toDateString() ? dailyUsage.builds : 0}</p>
                  </div>
                </div>

                {/* Phase 4.2 — This Month's AI Cost */}
                {monthlyAiCost !== undefined && (
                  <div className="flex items-center justify-between gap-4 rounded-2xl border border-line bg-surface p-4">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-muted">This month&rsquo;s AI cost</p>
                      <p className="text-xl font-extrabold text-ink">${(monthlyAiCost?.totalCostUsd ?? 0).toFixed(4)}</p>
                      <p className="text-xs font-semibold text-muted">{monthlyAiCost?.totalBuilds ?? 0} Pro builds · {monthlyAiCost?.month ?? new Date().toISOString().slice(0, 7)}</p>
                    </div>
                    <Activity className="h-7 w-7 shrink-0 text-accent-text" aria-hidden />
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

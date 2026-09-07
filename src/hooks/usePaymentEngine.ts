// usePaymentEngine — the wallet / billing / credits / referral slice of the app, lifted out of the
// App.tsx God component (P3.1, behavior-preserving extraction). Everything here talks only to the
// `/api/payment/*` and `/api/wallet/*` endpoints, reads the signed-in `user`, and owns payment-local
// state — it never reads chat, files, or preview state. Because nothing payment-owned flows into the
// build/preview/chat pipeline, moving it into a hook cannot change build behavior; the JSX in App.tsx
// keeps working unchanged by destructuring the SAME names this hook returns.

import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import type { User as FirebaseUser } from 'firebase/auth';
import { triggerCashfreeCheckout } from '../services/paymentService';
import { safeLocalJson } from '../lib/safeLocalJson';
import { authedHeaders } from '../lib/authHeaders';
import { trackEvent } from '../lib/analytics';
import { decideReportOnce } from '../lib/conversionOnce';
import { isNativeApp } from '../lib/mobileNative';
import { purchaseRail, type StoreConfig, type PurchaseOutcome } from '../lib/storePurchase';
import { launchPlayPurchase, consumePlayPurchase, pendingPlayPurchases, playBillingAvailable, outcomeForNativeStatus } from '../lib/playBillingNative';
/** Free-tier daily message ceiling for anonymous (not-signed-in) users. */
export const FREE_DAILY_MESSAGES = 10;

export interface UsePaymentEngineDeps {
  /** The signed-in Firebase user (or null when anonymous). Payment actions no-op when null. */
  user: FirebaseUser | null;
  /** Dev-log sink (from useDevLogs) — the same one App uses, so log output is unchanged. */
  addLog: (message: string, level?: string) => void;
}

/**
 * Owns the wallet/billing/credits/referral state + actions. Returns the exact same identifiers the
 * App.tsx render tree already references, so the extraction is a pure relocation (no behavior change).
 */
export function usePaymentEngine({ user, addLog }: UsePaymentEngineDeps) {
  // navBharat Core Token Wallet & Billing States
  const [wallet, setWallet] = useState<any>(null);

  // 11.1 + 11.3 — Daily usage tracking (free tier enforcement)
  const [dailyUsage, setDailyUsage] = useState<{ date: string; count: number; builds: number }>(() => {
    try {
      const saved = localStorage.getItem('navbharat_daily_usage');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.date === new Date().toDateString()) return parsed;
      }
    } catch {}
    return { date: new Date().toDateString(), count: 0, builds: 0 };
  });
  useEffect(() => {
    try { localStorage.setItem('navbharat_daily_usage', JSON.stringify(dailyUsage)); } catch {}
  }, [dailyUsage]);
  const incrementDailyUsage = useCallback((type: 'message' | 'build') => {
    setDailyUsage(prev => {
      const today = new Date().toDateString();
      if (prev.date !== today) return { date: today, count: type === 'message' ? 1 : 0, builds: type === 'build' ? 1 : 0 };
      return { ...prev, count: prev.count + (type === 'message' ? 1 : 0), builds: prev.builds + (type === 'build' ? 1 : 0) };
    });
  }, []);
  const isFreeLimitReached = !user && dailyUsage.date === new Date().toDateString() && dailyUsage.count >= FREE_DAILY_MESSAGES;

  // 11.4 — Referral code (generated per user, stored in localStorage)
  const [myReferralCode] = useState<string>(() => {
    const saved = localStorage.getItem('navbharat_my_referral');
    if (saved) return saved;
    const code = 'NB-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    localStorage.setItem('navbharat_my_referral', code);
    return code;
  });
  const [showVishwakarmaChooser, setShowVishwakarmaChooser] = useState(false);
  const [showVishwakarmaUnlockModal, setShowVishwakarmaUnlockModal] = useState(false);
  const [vkTokenInput, setVkTokenInput] = useState<string>('50');
  /**
   * GOOGLE PLAY BILLING (admin 2026-09-06). `storeConfig` is the server's honest answer about
   * whether the Play rail can work at all; `playPluginReady` is whether THIS installed shell has the
   * native plugin (an older .aab does not). Both default to "no", so every device keeps today's
   * behaviour until all of them are genuinely true.
   */
  const [storeConfig, setStoreConfig] = useState<StoreConfig | null>(null);
  const [playPluginReady, setPlayPluginReady] = useState(false);
  const [buyingProductId, setBuyingProductId] = useState<string | null>(null);
  const [storePurchaseNotice, setStorePurchaseNotice] = useState<string | null>(null);
  const [billingLogs, setBillingLogs] = useState<any[]>([]);
  const [billingTransactions, setBillingTransactions] = useState<any[]>([]);
  const [loadingWallet, setLoadingWallet] = useState(false);
  const [monthlyAiCost, setMonthlyAiCost] = useState<{ totalBuilds: number; totalCostUsd: number; month: string } | null>(null);
  const [isRecharging, setIsRecharging] = useState(false);
  const [paymentSession, setPaymentSession] = useState<any>(null);
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [rechargeStatus, setRechargeStatus] = useState<string | null>(null);
  const [activeBillingDetailTab, setActiveBillingDetailTab] = useState<'purchase' | 'gift' | 'use' | 'remaining' | 'budget'>('remaining');
  const [customPurchaseCredits, setCustomPurchaseCredits] = useState<string>('5000');
  const [showPurchaseFormPanel, setShowPurchaseFormPanel] = useState<boolean>(false);
  const [couponCodeInput, setCouponCodeInput] = useState('');
  const [isRedeemingCoupon, setIsRedeemingCoupon] = useState(false);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [couponSuccess, setCouponSuccess] = useState<string | null>(null);

  // NEW: Vishwakarma Promo
  const [vkMode, setVkMode] = useState<'basic' | 'pro' | 'vip'>('basic');

  // iOS-style card balance states & limits
  const [reminderLimit, setReminderLimit] = useState<number>(() => {
    const cached = localStorage.getItem('navbharat_reminder_limit');
    return cached ? parseFloat(cached) : 10.00;
  });
  const [budgetLimit, setBudgetLimit] = useState<number>(() => {
    const cached = localStorage.getItem('navbharat_budget_limit');
    return cached ? parseFloat(cached) : 2.00;
  });
  const [tempReminderLimit, setTempReminderLimit] = useState<string>(() => {
    const cached = localStorage.getItem('navbharat_reminder_limit');
    return cached ? parseFloat(cached).toString() : '10';
  });
  const [tempBudgetLimit, setTempBudgetLimit] = useState<string>(() => {
    const cached = localStorage.getItem('navbharat_budget_limit');
    return cached ? parseFloat(cached).toString() : '2';
  });
  const [limitError, setLimitError] = useState<string | null>(null);
  const [limitSuccess, setLimitSuccess] = useState<string | null>(null);
  const [dismissedReminderWarning, setDismissedReminderWarning] = useState<boolean>(false);
  const [copiedReferral, setCopiedReferral] = useState<boolean>(false);
  const [buyAmountInput, setBuyAmountInput] = useState<string>('500');
  const [referralHistory, setReferralHistory] = useState<any[]>(() => safeLocalJson<any[]>('navbharat_referral_history', [
    { email: 'amit_sharma2026@gmail.com', status: 'CLAIMED', creditsEarned: 50.00, timestamp: '2026-05-18T14:20:00Z' },
    { email: 'priya.rastogi@navbharat.ai', status: 'ACTIVE', creditsEarned: 25.00, timestamp: '2026-05-19T09:12:00Z' },
  ]));

  useEffect(() => {
    localStorage.setItem('navbharat_reminder_limit', reminderLimit.toString());
  }, [reminderLimit]);

  useEffect(() => {
    localStorage.setItem('navbharat_budget_limit', budgetLimit.toString());
  }, [budgetLimit]);

  useEffect(() => {
    localStorage.setItem('navbharat_referral_history', JSON.stringify(referralHistory));
  }, [referralHistory]);

  const fetchWallet = async () => {
    if (!user) return;
    setLoadingWallet(true);
    try {
      const walletHeaders = await authedHeaders();
      // Fire the wallet, logs, transactions and usage calls IN PARALLEL (was 4 sequential awaits).
      // On a native app these are cross-origin to the production API and often hit a cold instance;
      // serialising them made a cold post-login stack up round-trip after round-trip (the "app is slow
      // to load after login on the app" symptom). allSettled keeps each independent — a failed logs/
      // transactions call never loses the wallet balance, exactly like the old per-call resilience.
      const usageUrl = `/api/user/usage/${encodeURIComponent(user.uid)}`;
      const [walletR, logsR, txsR, usageR] = await Promise.allSettled([
        axios.get(`/api/wallet/${user.uid}?email=${encodeURIComponent(user.email || '')}&name=${encodeURIComponent(user.displayName || '')}`, { headers: walletHeaders }),
        axios.get(`/api/wallet/${user.uid}/logs`, { headers: walletHeaders }),
        axios.get(`/api/wallet/${user.uid}/transactions`, { headers: walletHeaders }),
        fetch(usageUrl, { headers: walletHeaders }),
      ]);
      if (walletR.status === 'fulfilled') setWallet(walletR.value.data);
      if (logsR.status === 'fulfilled') setBillingLogs(Array.isArray(logsR.value.data) ? logsR.value.data : []);
      if (txsR.status === 'fulfilled') setBillingTransactions(Array.isArray(txsR.value.data) ? txsR.value.data : []);
      // Monthly AI cost — best-effort, never blocks the wallet.
      if (usageR.status === 'fulfilled' && usageR.value.ok) {
        try {
          const usageData = await usageR.value.json();
          setMonthlyAiCost({ totalBuilds: usageData.totalBuilds ?? 0, totalCostUsd: usageData.totalCostUsd ?? 0, month: usageData.month ?? '' });
        } catch { /* usage body parse never blocks wallet */ }
      }
      // A wallet failure is the only real error (secondary panels degrade silently).
      if (walletR.status === 'rejected') throw walletR.reason;
    } catch (err) {
      console.error('Failed to sync wallet data with Firestore:', err);
    } finally {
      setLoadingWallet(false);
    }
  };

  /**
   * REMOVED 2026-08-21 — `redeemVishwakarmaPromo` posted to `/api/payment/validate-mode-promo`, a route
   * that exists nowhere on the server (the only occurrence of that path in the whole repo was this
   * call). So the "Have a promo code?" box in the Professional Pass modal answered every code — valid
   * or not — with "Validation failed", blaming the user's code for a missing endpoint. Its success
   * message also promised a ₹1 checkout that `create-order` knows nothing about, so wiring it would
   * have meant inventing a pricing feature rather than restoring one.
   *
   * The working promo redemption is `redeemPromoCoupon` below (`POST /api/payment/redeem-coupon`,
   * surfaced in Wallet & Billing) — a user with a code still has a real place to use it. A pass-level
   * promo can come back the day a server route genuinely honours it.
   */

  const createBillingOrder = async (amount: number) => {
    if (!user) return;
    setIsRecharging(true);
    setRechargeStatus('Requesting Cashfree checkout protocol...');
    try {
      // The server derives the order's owner from this token (it no longer trusts a body `userId`).
      const res = await axios.post('/api/payment/create-order', {
        amount,
        userEmail: user.email || '',
        userName: user.displayName || 'NavBharat Client'
      }, { headers: await authedHeaders() });
      setPaymentSession(res.data);
      if (res.data.isSimulator) {
        setShowCheckoutModal(true);
        setRechargeStatus('Secure simulated checkout session active.');
      } else {
        setRechargeStatus('Handshaking with Cashfree secure gateway...');
        triggerCashfreeCheckout(res.data.paymentSessionId, res.data.environment);
      }
    } catch (err: any) {
      alert(`Checkout session initiation failed: ${err.response?.data?.error || err.message}`);
    } finally {
      setIsRecharging(false);
    }
  };

  const createVishwakarmaOrder = async (buyPass: boolean, tokenAmount: number) => {
    if (!user) return;
    setIsRecharging(true);
    setRechargeStatus('Requesting Cashfree checkout protocol for Vishwakarma...');
    try {
      const passPrice = 100;
      const amount = (buyPass ? passPrice : 0) + tokenAmount;
      const res = await axios.post('/api/payment/create-order', {
        amount,
        userEmail: user.email || '',
        userName: user.displayName || 'NavBharat Client',
        isVishwakarmaOrder: true,
        buyPass,
        tokenAmount
      }, { headers: await authedHeaders() });
      setPaymentSession(res.data);
      if (res.data.isSimulator) {
        setShowCheckoutModal(true);
        setRechargeStatus('Secure simulated checkout session active.');
      } else {
        setRechargeStatus('Handshaking with Cashfree secure gateway...');
        triggerCashfreeCheckout(res.data.paymentSessionId, res.data.environment);
      }
    } catch (err: any) {
      alert(`Checkout session initiation failed: ${err.response?.data?.error || err.message}`);
    } finally {
      setIsRecharging(false);
    }
  };

  /**
   * Report a CONFIRMED purchase to analytics (and onward to the Meta advertising pixel) exactly once
   * per order.
   *
   * WHY ONE FUNCTION FOR BOTH PATHS: a payment can be confirmed through the in-app checkout modal
   * (verifyBillingPayment) or through the external Cashfree redirect return (verifyOrderAndReport),
   * and a user can genuinely pass through both for the SAME order. Two separate report sites would
   * count that sale twice; deduping by orderId here makes the double count structurally impossible
   * rather than unlikely.
   *
   * ONLY EVER CALLED WHERE THE SERVER CONFIRMED THE MONEY. A `?payment=success` URL parameter is not
   * proof of anything (see the redirect handler below), so this is never called from one.
   *
   * `valueInr` may be undefined — the Professional Pass branch resolves with a duration, not a rupee
   * amount. That reports the conversion with NO value rather than a guessed one; see pixelEventFor().
   */
  const reportPurchaseOnce = useCallback((orderRef: string, valueInr?: number) => {
    try {
      const KEY = 'navbharat_purchase_reported';
      const decision = decideReportOnce(localStorage.getItem(KEY), String(orderRef), true);
      if (!decision.report) return;
      if (decision.nextStored) localStorage.setItem(KEY, decision.nextStored);
      const value = Number(valueInr);
      trackEvent('purchase', Number.isFinite(value) && value > 0 ? { value, currency: 'INR' } : {});
    } catch { /* measurement must never affect a payment */ }
  }, []);

  // ───────────────────────── Google Play Billing ─────────────────────────
  //
  // Google Play requires digital goods consumed inside a Play-distributed app to be sold through
  // Play's own billing; the wallet top-up is exactly that. The SERVER owns every money decision
  // (storeBilling.ts's catalogue, storeVerify.ts's call to Google, the idempotent credit route) —
  // this hook only drives the sheet, hands the opaque token to the server, and consumes AFTER.

  /**
   * Ask the server to verify one purchase with Google and credit the wallet. Shared by the buy flow
   * and the pending sweep so both take the identical path — a second implementation is how the
   * retry route ends up subtly different from the one anybody tested.
   *
   * `paidValueInr` is what the STORE charged (not what the wallet received) — the real amount the
   * user was billed, which is the only honest value to report as a purchase conversion.
   */
  const creditPlayPurchase = useCallback(async (
    purchaseToken: string,
    productId: string,
    paidValueInr?: number,
  ): Promise<PurchaseOutcome> => {
    try {
      const res = await axios.post('/api/payment/store/verify', {
        platform: 'google',
        productId,
        purchaseToken,
      }, { headers: await authedHeaders() });
      if (res.data?.alreadyProcessed) return 'already-credited';
      if (res.data?.ok) {
        reportPurchaseOnce(purchaseToken, paidValueInr);
        return 'credited';
      }
      // A 2xx that is neither shape is not something to call success — the wallet is the truth, and
      // fetchWallet below will show whatever really landed.
      return 'paid-not-verified';
    } catch {
      // The money HAS left the user's account (Google only reports `purchased` after charging), so
      // this can never be reported as "not charged". Leaving the purchase unconsumed is what makes
      // it recoverable: Google re-delivers it, the sweep replays it, and the route is idempotent.
      return 'paid-not-verified';
    }
  }, [reportPurchaseOnce]);

  /**
   * Buy one pack through Google Play. Ordering is the whole safety property:
   * launch → server credits → THEN consume. Consuming before the credit would erase Google's record
   * of a purchase the user paid for; consuming after a failure simply leaves it replayable.
   */
  const buyStorePack = useCallback(async (productId: string): Promise<PurchaseOutcome> => {
    if (!user) return 'failed';
    const pack = storeConfig?.packs.find((p) => p.productId === productId) ?? null;
    setBuyingProductId(productId);
    setStorePurchaseNotice(null);
    try {
      const native = await launchPlayPurchase(productId);
      const early = outcomeForNativeStatus(native.status);
      if (early) return early;
      if (native.status === 'pending') {
        // Play's deferred payment methods (real in India) settle later. No money has arrived, so
        // nothing may be credited — the sweep picks it up once Google marks it purchased.
        return 'paid-not-verified';
      }
      if (!native.purchaseToken) return 'failed';

      const outcome = await creditPlayPurchase(
        native.purchaseToken,
        native.productId || productId,
        pack?.priceInr,
      );
      if (outcome === 'credited' || outcome === 'already-credited') {
        // Only now: tell Google the goods were delivered, so the pack can be bought again.
        await consumePlayPurchase(native.purchaseToken);
        await fetchWallet();
      }
      return outcome;
    } catch {
      return 'failed';
    } finally {
      setBuyingProductId(null);
    }
  }, [user, storeConfig, creditPlayPurchase]);

  /**
   * Replay any purchase Google still considers undelivered — the crash/offline safety net.
   *
   * WITHOUT THIS, a user who pays and then loses network before the verify call lands has given
   * Google money and received nothing; the only thing that would eventually happen is Google's
   * automatic refund three days later, after an experience we never noticed. With it, the credit
   * appears the next time they open the app.
   */
  const sweepPendingPlayPurchases = useCallback(async () => {
    if (!user) return;
    const pending = await pendingPlayPurchases();
    if (pending.length === 0) return;
    let credited = false;
    for (const p of pending) {
      const pack = storeConfig?.packs.find((x) => x.productId === p.productId) ?? null;
      const outcome = await creditPlayPurchase(p.purchaseToken, p.productId, pack?.priceInr);
      if (outcome === 'credited' || outcome === 'already-credited') {
        await consumePlayPurchase(p.purchaseToken);
        credited = credited || outcome === 'credited';
      }
    }
    if (credited) {
      setStorePurchaseNotice('A purchase from earlier has been added to your balance.');
      await fetchWallet();
    }
  }, [user, storeConfig, creditPlayPurchase]);

  /**
   * Discover the Play rail once per session, and only on a native shell — the web has no Play
   * Billing to ask about, so this costs a web user nothing at all. Both probes fail CLOSED
   * (`config` stays null / `pluginReady` stays false), which `purchaseRail` reads as "keep the
   * existing rail", so a server hiccup here can never take away a user's ability to top up.
   */
  useEffect(() => {
    if (!isNativeApp()) return;
    let cancelled = false;
    (async () => {
      const [available, cfg] = await Promise.all([
        playBillingAvailable(),
        axios.get('/api/payment/store/packs').then((r) => r.data as StoreConfig).catch(() => null),
      ]);
      if (cancelled) return;
      setPlayPluginReady(available);
      setStoreConfig(cfg && Array.isArray(cfg.packs) ? cfg : null);
    })();
    return () => { cancelled = true; };
  }, []);

  /** Sweep once the user is known AND the rail is genuinely live — never on the web. */
  useEffect(() => {
    if (!user || !playPluginReady || !storeConfig?.enabled || !storeConfig?.google) return;
    void sweepPendingPlayPurchases();
  }, [user, playPluginReady, storeConfig, sweepPendingPlayPurchases]);

  /** Which rail this device should show. Pure decision, unit-tested in storePurchase.test.ts. */
  const storeRail = purchaseRail({ isNative: isNativeApp(), config: storeConfig, pluginReady: playPluginReady });

  const verifyBillingPayment = async (status: 'SUCCESS' | 'FAILED') => {
    if (!paymentSession || !user) return;
    setRechargeStatus('Validating secure transaction hash with backend...');
    try {
      const res = await axios.post('/api/payment/verify-payment', {
        orderId: paymentSession.orderId,
        isSimulator: paymentSession.isSimulator,
        transactionStatus: status
      });
      if (res.data.success) {
        addLog(`Payment for ORDER #${paymentSession.orderId} verified successfully! credited ₹${paymentSession.orderAmount}.`, 'success');
        reportPurchaseOnce(paymentSession.orderId, Number(paymentSession.orderAmount));
        fetchWallet();
        setShowCheckoutModal(false);
        setPaymentSession(null);
      } else {
        alert('SRE gateway rejected authorization: Status flag FAILED on bank lookup.');
      }
    } catch (err: any) {
      alert(`Payment verification handshake errored: ${err.message}`);
    } finally {
      setRechargeStatus(null);
    }
  };

  const redeemPromoCoupon = async (code: string) => {
    if (!user || !code) return;
    setIsRedeemingCoupon(true);
    setCouponError(null);
    setCouponSuccess(null);
    try {
      const res = await axios.post('/api/payment/redeem-coupon', {
        couponCode: code.trim(),
        userId: user.uid,
        userEmail: user.email || '',
        userName: user.displayName || 'NavBharat Client'
      }, { headers: await authedHeaders() }); // SECURITY (H1): server derives identity from this token
      if (res.data.success) {
        setCouponSuccess(`Successfully redeemed ₹${res.data.balanceAdded}! Added to your wallet credit.`);
        addLog(`Promo Coupon "${code.trim().toUpperCase()}" redeemed! ₹${res.data.balanceAdded} added to your wallet.`, 'success');
        setCouponCodeInput('');
        fetchWallet();
      }
    } catch (err: any) {
      setCouponError(err.response?.data?.error || err.message || 'Verification failed. Try again.');
    } finally {
      setIsRedeemingCoupon(false);
    }
  };

  /**
   * Ask the server what really happened to an order, and report only that.
   *
   * ONE implementation for every redirect branch (2026-07-27): the 'success' and 'check' returns used
   * to be handled separately, and only 'check' actually verified — so 'success' announced a credit that
   * may never have landed. Sharing this also fixes a second defect that would have surfaced the day the
   * Professional Pass went live: a pass purchase resolves with `professionalPass`, not `balanceAdded`,
   * so the old check reported a genuinely-successful pass as "not yet verified — contact support".
   */
  const verifyOrderAndReport = useCallback(async (orderRef: string) => {
    try {
      const res = await axios.post('/api/payment/verify-payment', { orderId: orderRef });
      const data = res.data || {};
      if (data.professionalPass) {
        addLog(`Professional Pass activated for Order #${orderRef} (${data.days} days).`, 'success');
        // A pass resolves with a duration, not an amount — reported with no value, never a guess.
        reportPurchaseOnce(orderRef);
        alert(`🎉 Your Professional Pass is active${data.expiresAt ? ` until ${new Date(data.expiresAt).toLocaleDateString()}` : ''}. Every professional is now unlimited.`);
      } else if (data.balanceAdded) {
        addLog(`Payment for Order #${orderRef} verified successfully! Credited ₹${data.balanceAdded}.`, 'success');
        reportPurchaseOnce(orderRef, Number(data.balanceAdded));
        fetchWallet();
        alert(`🎉 Payment of Order #${orderRef} verified! Wallet credited.`);
      } else if (data.alreadyProcessed) {
        // Deliberately NOT reported: this branch means the order was settled on an earlier pass, so
        // its conversion has already been counted. (reportPurchaseOnce would refuse it anyway — this
        // is the belt to that guard's braces, and says why for the next reader.)
        addLog(`Payment for Order #${orderRef} was already processed.`, 'info');
        fetchWallet();
      } else {
        addLog(`Payment for Order #${orderRef} check completed: status not yet success.`, 'warn');
        alert(`🤔 Payment for Order #${orderRef} is not yet verified. Please wait or contact support if funds were deducted.`);
      }
    } catch (err: any) {
      const serverMsg = err?.response?.data?.error;
      addLog(`Error verifying payment for Order #${orderRef}: ${serverMsg || err.message}`, 'error');
      alert(`❌ ${serverMsg || `Error verifying payment: ${err.message}`} Please contact support if money was deducted.`);
    } finally {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [addLog, fetchWallet, reportPurchaseOnce]);

  /**
   * On sign-in, ask the server to settle any payment of this user's that never reached their wallet.
   *
   * A payment used to arrive by two routes only: the server webhook (which is rejected entirely unless
   * a webhook secret is configured) and the redirect below (which needs the user to come back to the
   * app carrying `?payment=…`). Someone who pays by UPI and closes the app — the normal thing on a
   * phone, since the UPI app is a different app — satisfied neither, and had genuinely paid without
   * ever being credited.
   *
   * Runs once per sign-in and stays SILENT unless money actually arrived: the server returns a message
   * only when it credited something, so a user who never paid sees nothing at all.
   */
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await axios.post('/api/payment/reconcile', {});
        const data = res.data || {};
        if (cancelled || !data.message) return;
        addLog(`Recovered ${data.creditedOrders} unsettled payment(s) totalling ₹${data.creditedInr}.`, 'success');
        fetchWallet();
        alert(`🎉 ${data.message}`);
      } catch {
        // Never surface this — it is a background safety net, and a user who has no pending payment
        // must not be shown a payment error for simply opening the app.
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  // Handle URL Payment Success/Failure callbacks from Cashfree redirect return url
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paymentStatus = params.get('payment');
    const orderRef = params.get('order_id');

    if (paymentStatus && orderRef && user) {
      if (paymentStatus === 'success') {
        // A URL parameter is NOT proof of payment — anyone can type `?payment=success`, and even a
        // genuine redirect arrives before we know the credit landed. This branch used to announce
        // "your wallet has been credited" on the parameter alone, which is a fake success whenever the
        // credit had not actually happened. It now verifies with the server exactly like the 'check'
        // branch, and only says what the server confirms.
        addLog(`External Cashfree Redirect: Order #${orderRef} returned — verifying with the server...`, 'info');
        window.history.replaceState({}, document.title, window.location.pathname);
        verifyOrderAndReport(orderRef);
      } else if (paymentStatus === 'failed') {
        addLog(`External Cashfree Redirect: Order #${orderRef} marked as FAILED.`, 'error');
        window.history.replaceState({}, document.title, window.location.pathname);
        alert(`❌ Payment failed or cancelled for Order #${orderRef}. Please retry.`);
      } else if (paymentStatus === 'check') {
        addLog(`Verifying payment for Order #${orderRef}...`, 'info');
        void verifyOrderAndReport(orderRef);
      }
    }
  }, [user]);

  return {
    // constants
    FREE_DAILY_MESSAGES,
    // wallet + usage
    wallet, setWallet,
    dailyUsage, setDailyUsage, incrementDailyUsage, isFreeLimitReached,
    myReferralCode,
    // modals / vishwakarma
    showVishwakarmaChooser, setShowVishwakarmaChooser,
    showVishwakarmaUnlockModal, setShowVishwakarmaUnlockModal,
    vkTokenInput, setVkTokenInput,
    // billing data
    billingLogs, setBillingLogs,
    billingTransactions, setBillingTransactions,
    loadingWallet, setLoadingWallet,
    monthlyAiCost, setMonthlyAiCost,
    isRecharging, setIsRecharging,
    paymentSession, setPaymentSession,
    showCheckoutModal, setShowCheckoutModal,
    rechargeStatus, setRechargeStatus,
    activeBillingDetailTab, setActiveBillingDetailTab,
    customPurchaseCredits, setCustomPurchaseCredits,
    showPurchaseFormPanel, setShowPurchaseFormPanel,
    // coupons
    couponCodeInput, setCouponCodeInput,
    isRedeemingCoupon, setIsRedeemingCoupon,
    couponError, setCouponError,
    couponSuccess, setCouponSuccess,
    vkMode, setVkMode,
    // limits + referral
    reminderLimit, setReminderLimit,
    budgetLimit, setBudgetLimit,
    tempReminderLimit, setTempReminderLimit,
    tempBudgetLimit, setTempBudgetLimit,
    limitError, setLimitError,
    limitSuccess, setLimitSuccess,
    dismissedReminderWarning, setDismissedReminderWarning,
    copiedReferral, setCopiedReferral,
    buyAmountInput, setBuyAmountInput,
    referralHistory, setReferralHistory,
    // actions
    fetchWallet,
    createBillingOrder,
    // Google Play billing (native only — storeRail is 'web-gateway' everywhere else)
    storeRail, storeConfig,
    buyStorePack, buyingProductId,
    storePurchaseNotice, setStorePurchaseNotice,
    createVishwakarmaOrder,
    verifyBillingPayment,
    redeemPromoCoupon,
  };
}

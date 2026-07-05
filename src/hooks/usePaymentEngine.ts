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
import { authedHeaders } from '../App';

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
  const [vkPromoCode, setVkPromoCode] = useState('');
  const [vkMode, setVkMode] = useState<'basic' | 'pro' | 'vip'>('basic');
  const [isRedeemingVkPromo, setIsRedeemingVkPromo] = useState(false);

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
      const res = await axios.get(`/api/wallet/${user.uid}?email=${encodeURIComponent(user.email || '')}&name=${encodeURIComponent(user.displayName || '')}`, { headers: walletHeaders });
      setWallet(res.data);

      const logsRes = await axios.get(`/api/wallet/${user.uid}/logs`, { headers: walletHeaders });
      setBillingLogs(Array.isArray(logsRes.data) ? logsRes.data : []);

      const txsRes = await axios.get(`/api/wallet/${user.uid}/transactions`, { headers: walletHeaders });
      setBillingTransactions(Array.isArray(txsRes.data) ? txsRes.data : []);

      // Phase 4.2 — fetch monthly AI cost (best-effort, never blocks wallet load).
      try {
        const usageRes = await fetch(`/api/user/usage/${encodeURIComponent(user.uid)}`, { headers: await authedHeaders() });
        if (usageRes.ok) {
          const usageData = await usageRes.json();
          setMonthlyAiCost({ totalBuilds: usageData.totalBuilds ?? 0, totalCostUsd: usageData.totalCostUsd ?? 0, month: usageData.month ?? '' });
        }
      } catch { /* usage fetch never blocks wallet */ }
    } catch (err) {
      console.error('Failed to sync wallet data with Firestore:', err);
    } finally {
      setLoadingWallet(false);
    }
  };

  const redeemVishwakarmaPromo = async () => {
    if (!user) return;
    setIsRedeemingVkPromo(true);
    setCouponError(null);
    try {
        const res = await axios.post('/api/payment/validate-mode-promo', {
            couponCode: vkPromoCode,
            mode: vkMode,
            userId: user.uid
        });
        if (res.data.success) {
            setCouponSuccess(`Promo applied for ${vkMode}! Proceed to checkout to pay ₹1.`);
        }
    } catch (err: any) {
        setCouponError(err.response?.data?.error || 'Validation failed');
    } finally {
        setIsRedeemingVkPromo(false);
    }
  };

  const createBillingOrder = async (amount: number) => {
    if (!user) return;
    setIsRecharging(true);
    setRechargeStatus('Requesting Cashfree checkout protocol...');
    try {
      const res = await axios.post('/api/payment/create-order', {
        amount,
        userId: user.uid,
        userEmail: user.email || '',
        userName: user.displayName || 'NavBharat Client'
      });
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
        userId: user.uid,
        userEmail: user.email || '',
        userName: user.displayName || 'NavBharat Client',
        isVishwakarmaOrder: true,
        buyPass,
        tokenAmount
      });
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

  // Handle URL Payment Success/Failure callbacks from Cashfree redirect return url
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paymentStatus = params.get('payment');
    const orderRef = params.get('order_id');

    if (paymentStatus && orderRef && user) {
      if (paymentStatus === 'success') {
        addLog(`External Cashfree Redirect: Order #${orderRef} processed successfully!`, 'success');
        fetchWallet();
        window.history.replaceState({}, document.title, window.location.pathname);
        alert(`🎉 Payment of Order #${orderRef} was successful! Your navBharatAI Wallet has been credited.`);
      } else if (paymentStatus === 'failed') {
        addLog(`External Cashfree Redirect: Order #${orderRef} marked as FAILED.`, 'error');
        window.history.replaceState({}, document.title, window.location.pathname);
        alert(`❌ Payment failed or cancelled for Order #${orderRef}. Please retry.`);
      } else if (paymentStatus === 'check') {
        addLog(`Verifying payment for Order #${orderRef}...`, 'info');
        axios.post('/api/payment/verify-payment', { orderId: orderRef })
          .then(res => {
            if (res.data.balanceAdded) {
              addLog(`Payment for Order #${orderRef} verified successfully! Credited ₹${res.data.balanceAdded}.`, 'success');
              fetchWallet();
              alert(`🎉 Payment of Order #${orderRef} verified! Wallet credited.`);
            } else if (res.data.alreadyProcessed) {
              addLog(`Payment for Order #${orderRef} was already processed.`, 'info');
              fetchWallet();
            } else {
              addLog(`Payment for Order #${orderRef} check completed: status not yet success.`, 'warn');
              alert(`🤔 Payment for Order #${orderRef} is not yet verified. Please wait or contact support if funds were deducted.`);
            }
          })
          .catch(err => {
            addLog(`Error verifying payment for Order #${orderRef}: ${err.message}`, 'error');
            alert(`❌ Error verifying payment: ${err.message}. Please contact support.`);
          })
          .finally(() => {
            window.history.replaceState({}, document.title, window.location.pathname);
          });
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
    vkPromoCode, setVkPromoCode,
    vkMode, setVkMode,
    isRedeemingVkPromo, setIsRedeemingVkPromo,
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
    redeemVishwakarmaPromo,
    createBillingOrder,
    createVishwakarmaOrder,
    verifyBillingPayment,
    redeemPromoCoupon,
  };
}

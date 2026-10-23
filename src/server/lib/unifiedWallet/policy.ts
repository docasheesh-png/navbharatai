// UNIFIED CREDIT WALLET — POLICY (pure, no I/O). See docs/UNIFIED_WALLET.md.
//
// ONE wallet (`user_token_wallets/{uid}`, the doc builds, images, Doctor AI and hosting already debit)
// now also pays for NavBharatAI Free chat once the daily free allowance is used up. Nothing here is a
// second money path: the store layer calls the existing hold/release/settle and build debit functions.
//
// Units: 1 credit = ₹1 = 1000 milli-credits = 100 wallet tokens (TOKENS_PER_RUPEE). Every price in this
// file is an INTEGER number of milli-credits and must be a multiple of 10 so it maps to whole tokens
// (paise). No floats ever reach the wallet from here.
import { TOKENS_PER_RUPEE } from '../../../lib/walletPricing';

export const MILLI_PER_CREDIT = 1000;
const MILLI_PER_TOKEN = MILLI_PER_CREDIT / TOKENS_PER_RUPEE; // 10

type Env = Record<string, string | undefined>;
const int = (v: string | undefined, d: number, min = 0, max = Number.MAX_SAFE_INTEGER): number => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : d;
};
const num = (v: string | undefined, d: number, min: number, max: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : d;
};

/** Feature flag. Default OFF: with it off every code path behaves exactly as on main. */
export function unifiedWalletEnabled(env: Env = process.env): boolean {
  return env.UNIFIED_WALLET_ENABLED === '1' || env.UNIFIED_WALLET_ENABLED === 'true';
}

export interface UnifiedPlan {
  id: string;
  label: string;
  /** Shown price, GST INCLUSIVE (what the user pays). */
  priceInrInclGst: number;
  /** Credits (₹) granted into the ONE wallet per billing month. 0 = none. */
  monthlyCredits: number;
  /** Free chat messages per IST day before the wallet is debited. 0 = use the signed-in default. */
  dailyMessages: number;
}

/**
 * Owner decision PENDING (2026-10-23): a plan can grant monthly wallet credits, a daily message
 * allowance, or both. Defaults follow the latest instruction (₹99 → 99 credits, ₹999 → 999 credits,
 * spendable on chat OR builds). The daily-allowance variant (125 / 1500 a day) is one env line away:
 * UNIFIED_WALLET_PLANS='[{"id":"plus99",...,"monthlyCredits":0,"dailyMessages":125}, ...]'.
 */
export const DEFAULT_PLANS: readonly UnifiedPlan[] = [
  { id: 'plus99', label: 'NavBharatAI Plus', priceInrInclGst: 99, monthlyCredits: 99, dailyMessages: 0 },
  { id: 'pro999', label: 'NavBharatAI Pro', priceInrInclGst: 999, monthlyCredits: 999, dailyMessages: 0 },
];

function validPlan(p: any): p is UnifiedPlan {
  return !!p && typeof p.id === 'string' && /^[a-z0-9_-]{1,32}$/.test(p.id) && typeof p.label === 'string'
    && Number.isSafeInteger(p.priceInrInclGst) && p.priceInrInclGst > 0
    && Number.isSafeInteger(p.monthlyCredits) && p.monthlyCredits >= 0
    && Number.isSafeInteger(p.dailyMessages) && p.dailyMessages >= 0 && p.dailyMessages <= 100_000;
}

export interface UnifiedWalletConfig {
  enabled: boolean;
  /** Price of one Free chat message past the allowance. Default 100 milli = 0.1 credit (₹1 = 10 msgs). */
  chatMessageMilli: number;
  guestDailyMessages: number;
  signedInDailyMessages: number;
  /** Build charge = real provider cost × this (replaces the tiered ×4/×3 curve only when enabled). */
  buildMargin: number;
  minRechargeInr: number;
  perMinuteSignedIn: number;
  perMinuteGuest: number;
  /** Low-balance warning threshold, in credits. */
  lowBalanceCredits: number;
  gstPercent: number;
  plans: UnifiedPlan[];
}

export function unifiedWalletConfig(env: Env = process.env): UnifiedWalletConfig {
  let plans: UnifiedPlan[] = [...DEFAULT_PLANS];
  if (env.UNIFIED_WALLET_PLANS) {
    try {
      const parsed = JSON.parse(env.UNIFIED_WALLET_PLANS);
      if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(validPlan)) plans = parsed;
    } catch { /* malformed → defaults; never throw from config */ }
  }
  const chat = int(env.UNIFIED_WALLET_CHAT_MESSAGE_MILLI, 100, 10, 100_000);
  return {
    enabled: unifiedWalletEnabled(env),
    chatMessageMilli: chat % MILLI_PER_TOKEN === 0 ? chat : 100,
    guestDailyMessages: int(env.UNIFIED_WALLET_GUEST_DAILY, 5, 0, 1000),
    signedInDailyMessages: int(env.UNIFIED_WALLET_SIGNED_IN_DAILY, 25, 0, 100_000),
    buildMargin: num(env.UNIFIED_WALLET_BUILD_MARGIN, 2, 1, 10),
    minRechargeInr: int(env.UNIFIED_WALLET_MIN_RECHARGE_INR, 20, 1, 100_000),
    perMinuteSignedIn: int(env.UNIFIED_WALLET_PER_MINUTE, 20, 1, 10_000),
    perMinuteGuest: int(env.UNIFIED_WALLET_GUEST_PER_MINUTE, 6, 1, 10_000),
    lowBalanceCredits: int(env.UNIFIED_WALLET_LOW_BALANCE_CREDITS, 5, 0, 100_000),
    gstPercent: int(env.UNIFIED_WALLET_GST_PERCENT, 18, 0, 100),
    plans,
  };
}

export function milliToTokens(milli: number): number {
  if (!Number.isSafeInteger(milli) || milli <= 0 || milli % MILLI_PER_TOKEN !== 0) throw new Error(`Invalid milli-credit amount: ${milli}`);
  return milli / MILLI_PER_TOKEN;
}
/** ₹ for the existing wallet API (which takes ₹). Exact: tokens/100 is a 2-dp value. */
export function milliToInr(milli: number): number { return milliToTokens(milli) / TOKENS_PER_RUPEE; }

/** Daily free-message allowance for one requester. Plan allowance only ever RAISES the default. */
export function dailyAllowance(cfg: UnifiedWalletConfig, who: { signedIn: boolean; planId?: string | null }): number {
  if (!who.signedIn) return cfg.guestDailyMessages;
  const plan = who.planId ? cfg.plans.find((p) => p.id === who.planId) : undefined;
  return Math.max(cfg.signedInDailyMessages, plan?.dailyMessages ?? 0);
}

/** Build bill (USD) when the unified wallet is on: real cost × configured margin. */
export function unifiedBuildBilledUsd(realCostUsd: number, cfg: Pick<UnifiedWalletConfig, 'buildMargin'>): number {
  const c = Number.isFinite(realCostUsd) && realCostUsd > 0 ? realCostUsd : 0;
  return c * cfg.buildMargin;
}

/** GST split of an INCLUSIVE price, in integer paise (base + gst === total, always). */
export function gstBreakdown(priceInrInclGst: number, gstPercent: number): { totalPaise: number; basePaise: number; gstPaise: number } {
  const totalPaise = Math.round(priceInrInclGst * 100);
  const basePaise = Math.round((totalPaise * 100) / (100 + gstPercent));
  return { totalPaise, basePaise, gstPaise: totalPaise - basePaise };
}

export function isValidRecharge(inr: number, cfg: Pick<UnifiedWalletConfig, 'minRechargeInr'>): boolean {
  return Number.isSafeInteger(inr) && inr >= cfg.minRechargeInr;
}

export type ReplyLang = 'hi' | 'hinglish' | 'en';
const HINGLISH = /\b(hai|kya|kaise|mujhe|mera|nahi|karo|batao|aap|kitna|kyun|samjhao)\b/i;
export function detectLang(text: unknown): ReplyLang {
  const s = typeof text === 'string' ? text : '';
  if (/[\u0900-\u097F]/.test(s)) return 'hi';
  return HINGLISH.test(s) ? 'hinglish' : 'en';
}

const fmtCredits = (tokens: number) => (Math.max(0, tokens) / TOKENS_PER_RUPEE).toFixed(2);

/** Wallet empty: today's free messages are used and the balance cannot pay for one more. */
export function insufficientBalanceMessage(lang: ReplyLang, cfg: Pick<UnifiedWalletConfig, 'minRechargeInr' | 'chatMessageMilli'>): string {
  const per = Math.round(MILLI_PER_CREDIT / cfg.chatMessageMilli);
  if (lang === 'hi') return `आज के मुफ़्त messages ख़त्म हो गए हैं और wallet में balance नहीं है। ₹${cfg.minRechargeInr} या उससे ज़्यादा का recharge करें (₹1 = ${per} messages), या रात 12 बजे (IST) के बाद फिर आएँ।`;
  if (lang === 'hinglish') return `Aaj ke free messages khatam ho gaye aur wallet mein balance nahi hai. ₹${cfg.minRechargeInr} ya zyada ka recharge karein (₹1 = ${per} messages), ya raat 12 baje (IST) ke baad aayein.`;
  return `Today's free messages are used up and your wallet balance is too low. Recharge ₹${cfg.minRechargeInr} or more (₹1 = ${per} messages), or come back after 12:00 AM IST.`;
}

/** Shown alongside a paid reply once the balance falls under the threshold; '' otherwise. */
export function lowBalanceNotice(lang: ReplyLang, balanceTokens: number, cfg: Pick<UnifiedWalletConfig, 'lowBalanceCredits'>): string {
  if (balanceTokens >= cfg.lowBalanceCredits * TOKENS_PER_RUPEE) return '';
  const b = fmtCredits(balanceTokens);
  if (lang === 'hi') return `आपके wallet में सिर्फ़ ${b} credits बचे हैं। NavBharatAI Free chat और Pro दोनों इसी wallet से चलते हैं।`;
  if (lang === 'hinglish') return `Aapke wallet mein sirf ${b} credits bache hain. NavBharatAI Free chat aur Pro dono isi wallet se chalte hain.`;
  return `Only ${b} credits left in your wallet. NavBharatAI Free chat and Pro both use this one wallet.`;
}

export function rateLimitedMessage(lang: ReplyLang): string {
  if (lang === 'hi') return 'आप बहुत तेज़ी से messages भेज रहे हैं। एक मिनट रुककर फिर भेजें।';
  if (lang === 'hinglish') return 'Aap bahut tezi se messages bhej rahe hain. Ek minute rukkar phir bhejein.';
  return 'You are sending messages too quickly. Please wait a minute and try again.';
}

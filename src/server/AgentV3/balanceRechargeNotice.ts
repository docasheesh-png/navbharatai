import { detectLanguageHint } from './LanguageDetect';

/**
 * The one sentence a person sees when THEIR wallet cannot cover a build (owner t402u).
 *
 * Hindi when the request itself is Hindi. Every other language, including English and
 * Roman-script Hinglish, gets the English line. The detector only calls a request Hindi
 * when Devanagari dominates it — that is the same rule the builder already uses.
 *
 * This is not the step clock ("build budget exhausted before this call could start") and
 * not a supplier account that ran out. Those are not the user's wallet.
 */
export const BALANCE_RECHARGE_HI = 'इस build के लिए आपका balance पर्याप्त नहीं है, कृपया recharge करें!';
export const BALANCE_RECHARGE_EN = 'Your balance is not enough for this build, please recharge!';

export function balanceRechargeNotice(requestText: string): string {
  return detectLanguageHint(requestText)?.code === 'hi' ? BALANCE_RECHARGE_HI : BALANCE_RECHARGE_EN;
}

/**
 * 💳 HOW FAR A BUILD MAY RUN PAST THE BALANCE (admin 2026-11-27, failedbr #2555: "user ke pas balance nahi hai, to build mat
 * chalao. agar build me anuman kharcha > user balance — 10-20% tak negative ham rah lenge … user ka pas jitna paisa hai, usse
 * thoda jyada bill bane to bhi chalegi"). The ONE rule, read by the admission gate, the shared affordability decision and the
 * mid-build wallet stop:
 *   • no positive balance → no build;
 *   • a build may start, and keep running, while its estimate / its running bill is within 20% ABOVE the balance — the
 *     wallet then goes up to 20% negative, settled at the real bill (the account is blocked for the next build until top-up).
 * Before this, the estimate had to fit the balance exactly and the running bill stopped the build the moment it passed it:
 * #2555 was stopped at ₹126.14 on a ₹93.63 balance.
 */
export const WALLET_OVERDRAFT_SHARE = 0.2;
/** The most a build may cost for a balance (₹): 120% of a positive balance; 0 when there is none. PURE. */
export function walletSpendLimitInr(balanceInr: number): number {
  return Number.isFinite(balanceInr) && balanceInr > 0 ? balanceInr * (1 + WALLET_OVERDRAFT_SHARE) : 0;
}

/**
 * Refuse a build before it starts when the wallet cannot cover it (owner t403u).
 * An unreadable balance stays allowed: that is an unknown, not a measured zero.
 * Exempt accounts (admin free-list, the z test account) are decided by the caller.
 */
export function shouldRefuseBuildForBalance(input: {
  exempt: boolean;
  balanceInr: number | null;
  estimateInr: number;
}): boolean {
  if (input.exempt) return false;
  if (typeof input.balanceInr !== 'number' || !Number.isFinite(input.balanceInr)) return false;
  if (input.balanceInr <= 0) return true;                               // no balance → no build
  const needed = input.estimateInr;
  // Up to 20% over the balance is allowed (walletSpendLimitInr, admin 2026-11-27).
  if (typeof needed === 'number' && Number.isFinite(needed) && needed > 0) return needed > walletSpendLimitInr(input.balanceInr);
  return false;
}

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
  const needed = input.estimateInr;
  if (typeof needed === 'number' && Number.isFinite(needed) && needed > 0) return input.balanceInr < needed;
  return input.balanceInr <= 0;
}

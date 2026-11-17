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

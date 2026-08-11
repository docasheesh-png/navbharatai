// VOICE CHAT — the money, and the sentence the user reads before spending any of it.
//
// ADMIN 2026-08-10: "ek voice chat ka option hai SDA (doctor ai) me — usko bhi paid service bana kar
// sabhi me laga do. Jab koi user usko use kare to charge karenge. Jo ki user ko dikhega voice chat
// icon par click karne se — user ki language me ek popup aaye … word to word copy nahi kar dena."
// Rate CONFIRMED by the admin the same day: **2 paise per second** (₹1.20 per minute).
//
// WHY A PER-SECOND RATE IS HONEST HERE, when THE ONE-WALLET LAW forbids inventing costs. That law's
// rule is "never bill a number you did not measure" — and it already carves out image generation,
// whose cost is per-image rather than per-token, because there is nothing honest to price it with.
// Voice is the same shape and then some: the cost really IS time. A second of audio is a second of
// audio, measured by the clock, and the user is charged for exactly the seconds they used. That is a
// measurement, not an estimate — which is precisely what the law asks for.
//
// TWO THINGS THIS MODULE REFUSES TO DO:
//  1. Round a charge UP. `inrToDebitTokens` carries the remainder rather than ceiling for the same
//     reason (2026-08-04): ceiling a small charge can bill several times the real cost. Seconds are
//     counted whole (you cannot use half a second of a call), and the ₹ is exact from there.
//  2. Name the vendor. The white-label law covers every user-facing surface, and a consent popup is
//     the most user-facing surface there is. The user is buying NavBharatAI's voice, full stop.
//
// PURE — no clock, no network, no React. Every input is passed in, so the money is unit-testable.

/** The confirmed rate. One constant: the charge and the popup must never be able to disagree. */
export const VOICE_PAISE_PER_SECOND = 2;

/** Languages this consent text exists in. Mirrors the platform's own narration languages. */
export type VoiceLang = 'en' | 'hi';

/** ₹ per minute, derived — never a second hand-written number that could drift from the rate. */
export function voiceRupeesPerMinute(paisePerSecond: number = VOICE_PAISE_PER_SECOND): number {
  return (paisePerSecond * 60) / 100;
}

/**
 * The exact cost of a call, in rupees. Seconds are counted WHOLE (you cannot use half a second of a
 * call) and the rupee amount follows exactly — never rounded up. A call that never started costs
 * nothing rather than a minimum fee. PURE.
 */
export function voiceCostInr(seconds: number, paisePerSecond: number = VOICE_PAISE_PER_SECOND): number {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  if (s === 0) return 0;
  return (s * paisePerSecond) / 100;
}

/** A duration a person reads without doing arithmetic: "45 sec", "2 min 5 sec". PURE. */
export function formatVoiceDuration(seconds: number, lang: VoiceLang = 'en'): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  const secWord = lang === 'hi' ? 'सेकंड' : 'sec';
  const minWord = lang === 'hi' ? 'मिनट' : 'min';
  if (m === 0) return `${rest} ${secWord}`;
  return rest === 0 ? `${m} ${minWord}` : `${m} ${minWord} ${rest} ${secWord}`;
}

export interface VoiceConsent {
  title: string;
  /** The rate, the unit the user actually thinks in, and when charging starts/stops. */
  body: string;
  confirm: string;
  cancel: string;
}

/**
 * The popup shown when the user taps the voice icon — WRITTEN in each language, not translated
 * word-for-word (the admin asked for exactly that). Each version says the four things that make the
 * consent real:
 *   • it costs money, before anything starts;
 *   • the rate BOTH ways — per second (how it is billed) and per minute (how people actually think);
 *   • charging begins when the call connects and stops when it ends, so the user knows what they
 *     control;
 *   • it comes from the same balance as everything else — no separate top-up, no surprise.
 * PURE.
 */
export function voiceConsent(
  lang: VoiceLang = 'en',
  paisePerSecond: number = VOICE_PAISE_PER_SECOND,
): VoiceConsent {
  const perMin = voiceRupeesPerMinute(paisePerSecond);
  const perMinText = perMin.toFixed(2).replace(/\.00$/, '');
  if (lang === 'hi') {
    return {
      title: 'वॉइस चैट — यह सेवा सशुल्क है',
      body: `बात करने का शुल्क ${paisePerSecond} पैसे प्रति सेकंड है, यानी लगभग ₹${perMinText} प्रति मिनट। `
        + `पैसे तभी कटते हैं जब कॉल जुड़ती है, और कॉल खत्म करते ही कटना बंद हो जाता है — बीच में कोई छिपा शुल्क नहीं। `
        + `यह आपके उसी बैलेंस से कटेगा जिससे बाकी सब चलता है, अलग से कुछ भरने की ज़रूरत नहीं।`,
      confirm: 'ठीक है, शुरू करें',
      cancel: 'रहने दें',
    };
  }
  return {
    title: 'Voice chat is a paid feature',
    body: `Talking costs ${paisePerSecond} paise per second — about ₹${perMinText} a minute. `
      + `You are charged only while the call is connected, and it stops the moment you end it, so nothing runs on in the background. `
      + `It comes out of the same balance everything else uses — there is nothing separate to top up.`,
    confirm: 'Start talking',
    cancel: 'Not now',
  };
}

/**
 * The live "you have spent this much" line while a call runs, so the meter is never a surprise at the
 * end. Deliberately shows BOTH the time and the money — a number alone tells the user nothing about
 * whether to keep talking. PURE.
 */
export function voiceRunningCostLabel(
  seconds: number,
  lang: VoiceLang = 'en',
  paisePerSecond: number = VOICE_PAISE_PER_SECOND,
): string {
  const cost = voiceCostInr(seconds, paisePerSecond);
  const time = formatVoiceDuration(seconds, lang);
  const money = `₹${cost.toFixed(2)}`;
  return lang === 'hi' ? `${time} · ${money}` : `${time} · ${money}`;
}

/** Master switch, project convention: `off` disables paid voice everywhere without a deploy. */
export function voiceChatEnabled(env: Record<string, string | undefined>): boolean {
  return (env.VITE_VOICE_CHAT ?? env.VOICE_CHAT ?? '').trim().toLowerCase() !== 'off';
}

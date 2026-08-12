// PAYING FOR A VOICE CALL — the decisions, isolated from the socket.
//
// ADMIN 2026-08-10: "ek voice chat ka option hai SDA (doctor ai) me — usko bhi paid service bana kar
// sabhi me laga do. Jab koi user usko use kare to charge karenge." Rate confirmed the same day:
// **2 paise per second** (₹1.20 a minute).
//
// WHY THIS IS METERED AS IT GOES, not billed once at the end. A call has no natural length. Charging
// only on hang-up means a phone left face-down in a pocket accumulates an unbounded debt that the
// user first learns about when their balance is gone — and if the socket dies uncleanly, we would
// either lose the whole charge or bill for a call that stopped being listened to long ago. Metering
// every few seconds gives three things at once: the balance moves while the user can still see it,
// an abandoned call can be CUT OFF the moment the money runs out instead of running up a bill, and a
// dropped connection loses at most one tick rather than the whole session.
//
// WHY BILLING STARTS AT `ready`, NOT AT CONNECT. Everything before `ready` is us getting our own
// provider session up. If that fails the user got nothing, and the platform's standing rule is that a
// failed action is never charged. Seconds spent waiting for us are ours, not theirs.
//
// PURE — no clock, no socket, no Firestore. Every input is passed in, so the money is testable.

import { VOICE_PAISE_PER_SECOND, voiceCostInr } from '../../lib/voiceChatBilling';

export { VOICE_PAISE_PER_SECOND };

/**
 * How often a live call settles. 20s is a deliberate middle: short enough that an abandoned call is
 * cut off promptly and a dropped socket loses only ~40 paise of billing, long enough that an hour of
 * talking is 180 wallet writes rather than 3,600.
 */
export const VOICE_TICK_MS = 20_000;

/**
 * A hard ceiling on one call, in seconds. Even with metering, an open socket nobody is speaking into
 * should not bill forever — 2 hours is far beyond any real consultation, so hitting it means
 * something is wrong (a wedged tab, a stuck stream) and the honest response is to end the call rather
 * than keep charging for it.
 */
export const VOICE_MAX_CALL_SECONDS = 2 * 60 * 60;

/**
 * Whole seconds that have not been billed yet.
 *
 * Whole seconds only, and the remainder stays UNBILLED for the next tick — so a call is never
 * rounded up at every tick (which would silently inflate a 10-minute call by up to 30 partial
 * seconds). Time cannot run backwards: a clock that jumps back yields 0, never a negative credit.
 */
export function unbilledSeconds(startedAtMs: number, nowMs: number, alreadyBilledSeconds: number): number {
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(nowMs)) return 0;
  const elapsed = Math.floor((nowMs - startedAtMs) / 1000);
  if (!(elapsed > 0)) return 0;
  const capped = Math.min(elapsed, VOICE_MAX_CALL_SECONDS);
  return Math.max(0, capped - Math.max(0, Math.floor(alreadyBilledSeconds)));
}

/** What those seconds cost. Shared with the client's popup, so quote and charge cannot disagree. */
export function voiceSecondsCostInr(seconds: number): number {
  return voiceCostInr(seconds);
}

/**
 * May this user start a call at all?
 *
 * A balance that cannot be READ is allowed through — fail-open, exactly like the build gate and the
 * chat-turn gate: denying a paying user their consultation over a Firestore blip is the worse error,
 * and the metering below still records the debt honestly. A zero or negative balance is refused
 * BEFORE the provider is dialled, because unlike a build there is no later pre-flight to catch it.
 */
export function mayStartVoiceCall(balanceInr: number | null, isFreeListed: boolean): boolean {
  if (isFreeListed) return true;
  if (balanceInr === null) return true;
  return balanceInr > 0;
}

/**
 * Should a call in progress be ended for lack of money?
 *
 * Ending the call is the honest outcome, not letting it run into an overdraft: the user is speaking
 * live and can be told immediately, whereas a silent overdraft is discovered later as a number they
 * cannot explain. An unreadable balance keeps the call alive for the same fail-open reason as above.
 */
export function shouldEndCallForBalance(balanceInr: number | null): boolean {
  return balanceInr !== null && balanceInr <= 0;
}

/**
 * The debit reference for one tick. Includes the tick's own second-count, so:
 *  • each tick is a DISTINCT ledger entry (an idempotent debit keyed to a repeated ref would silently
 *    drop the second and every later charge in a long call), and
 *  • a retry of the SAME tick collapses onto the same ref rather than double-charging.
 */
export function voiceDebitRef(callId: string, billedThroughSeconds: number): string {
  return `voice_${callId}_${Math.max(0, Math.floor(billedThroughSeconds))}`;
}

/**
 * The wallet-ledger label. NavBharatAI's own words — never the vendor behind the voice (white-label
 * law), and never "Sonic"/"Nova"/"AWS", which is what an end user would otherwise find on their bill.
 */
export function voiceChargeDescription(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(s / 60);
  const rest = s % 60;
  const dur = mins === 0 ? `${rest}s` : rest === 0 ? `${mins}m` : `${mins}m ${rest}s`;
  return `NavBharatAI voice chat · ${dur}`;
}

/**
 * 🔴 A LOGIN NOBODY ASKED FOR IS A WALL IN FRONT OF THE APP (autopsy 70e030bb, 2026-10-04).
 *
 * "An app which takes notes from online classes." The fast lane's call that wrote `src/App.tsx` put the
 * notes behind a username/password form with a hashed demo account (`student` / `demo123`), and its
 * shared contract gave the notes list an `onClearCompleted` prop, a to-do idea, for notes that cannot
 * be completed. The full builder then wired "Clear Completed" to delete EVERY note. Nothing in the
 * request named either one. The user's first screen was a sign-in form, and one button on the second
 * screen erased their notes.
 *
 * 🔑 THE CLASS: a builder adds a feature the request never named, and two kinds cost the user the most:
 * (1) a sign-in gate, which hides the app and makes the user and every check of ours type a password
 *     the user never set;
 * (2) an action for a state the app's data does not have, which can only do something else (here, a
 *     destructive something else).
 * So the builder is told, when the request did not ask for sign-in: no login, sign-up, password gate,
 * demo account or accounts, and no button, prop or action for a state the data does not have.
 *
 * ⚠️ PRECISION-FIRST, AND IT STANDS DOWN WHEREVER SIGN-IN COULD BE WANTED:
 * - any word that asks for it (login, sign in, account, password, OTP, roles, admin, private, secure,
 *   multi-user, Hindi forms included);
 * - a request in a domain whose implicit features ADD access control (healthcare, e-commerce, SaaS, …).
 *   AGENTV3_REQUIREMENT_AWARE deliberately adds it there, and this rule must never fight it.
 *   🔴 It stood down for EVERY recognised domain until autopsy 303e8a6f — "a todo app" (productivity), "a racing
 *   game" (game) and a booking app add no access control at all, so they got no note: the 70e030bb class itself.
 *   The domain's own feature list now decides (`domainAddsAccessControl`).
 * - money movement named as a feature, even when the primary domain is a game. This only withdraws
 *   the prohibition; it neither adds authentication nor claims that payments have been implemented.
 * A missed case costs today's behaviour; a wrong note would only drop a login the request never named.
 * Kill switch: `AGENTV3_REQUEST_SCOPE=off`. PURE.
 */

import { domainAddsAccessControl } from '../lib/RequirementGapAnalyzer';

export function requestScopeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_REQUEST_SCOPE ?? '').trim().toLowerCase() !== 'off';
}

/**
 * Does the request ask for sign-in, accounts or anything that implies them? Generous on purpose: a
 * false "yes" only leaves the builder as it is today.
 */
const ASKS_FOR_SIGN_IN = new RegExp([
  String.raw`\blog[\s-]?(?:in|on|out)s?\b`, String.raw`\bsign[\s-]?(?:in|up|on|out)s?\b`,
  String.raw`\bregist(?:er|ration)\b`, String.raw`\baccounts?\b`, String.raw`\bpass(?:word|code|key)s?\b`,
  String.raw`\bauth\w*\b`, String.raw`\botp\b`, String.raw`\bsso\b`, String.raw`\boauth\b`,
  String.raw`\bprofiles?\b`, String.raw`\broles?\b`, String.raw`\brbac\b`, String.raw`\badmins?\b`,
  String.raw`\bpermissions?\b`, String.raw`\baccess control\b`, String.raw`\bprivate\b`, String.raw`\bsecur\w*\b`,
  String.raw`\bprotect\w*\b`, String.raw`\b(?:un)?lock(?:ed|s)?\b`, String.raw`\bpin\b`,
  // A gate named by its MECHANISM (adversarial review of 303e8a6f): each of these read as "no sign-in", so the
  // builder was told to add no login on a request that asked for one ("a vault that asks for credentials").
  String.raw`\busernames?\b`, String.raw`\bcredentials?\b`, String.raw`\b(?:2fa|mfa)\b`, String.raw`\btwo[\s-]?factor\b`,
  String.raw`\b(?:face|touch)[\s-]?id\b`, String.raw`\bfingerprints?\b`, String.raw`\bbiometric\w*\b`,
  String.raw`\b(?:multi|multiple|many|several)[\s-]?users?\b`, String.raw`\b(?:each|every|per)\s+user\b`,
  String.raw`\busers?\s+(?:can|could|should|will|must)\b`, String.raw`\bmembers?\b`, String.raw`\bsubscri\w*\b`,
  String.raw`\bfirebase\b`, String.raw`\bsupabase\b`, String.raw`\bclerk\b`,
  'लॉग\\s?इन', 'साइन\\s?इन', 'पासवर्ड', 'अकाउंट', 'खाता', 'लॉगिन',
].join('|'), 'i');

/**
 * A sign-in word the request DECLINES — "no login needed", "without an account", "sign-up is not required",
 * "login nahi chahiye". Narrow on purpose: only the negation immediately attached to the sign-in word is read, so
 * "Don't make it public, add a login" still asks for one (autopsy 303e8a6f: "A calculator, no login needed." read
 * as a request FOR sign-in, so the rule stood down exactly when the user had explicitly declined it).
 */
const DECLINED_SIGN_IN = new RegExp([
  String.raw`\b(?:no|without)\s+(?:an?\s+|any\s+)?(?:user\s+)?(?:log[\s-]?ins?|sign[\s-]?(?:in|up)s?|accounts?|passwords?|registration|auth(?:entication)?)\b(?:\s+(?:is\s+|are\s+)?(?:needed|required|necessary))?`,
  String.raw`\b(?:log[\s-]?ins?|sign[\s-]?(?:in|up)s?|accounts?|passwords?|registration)\s+(?:is\s+|are\s+)?not\s+(?:needed|required|necessary)\b`,
  String.raw`\b(?:log[\s-]?ins?|sign[\s-]?(?:in|up)s?|accounts?|passwords?)\s+(?:ki\s+)?(?:zarurat\s+|zaroorat\s+)?(?:nahi|nahin|mat)\b`,
].join('|'), 'gi');

/** Does the request decline sign-in in so many words? PURE. */
export function declinesSignIn(text: string | null | undefined): boolean {
  return new RegExp(DECLINED_SIGN_IN.source, 'i').test(String(text ?? ''));
}

export function asksForSignIn(text: string | null | undefined): boolean {
  // A declined sign-in word is not a request for one — read what is left once the declines are taken out.
  return ASKS_FOR_SIGN_IN.test(String(text ?? '').replace(DECLINED_SIGN_IN, ' '));
}

const DIRECT_MONEY_MOVEMENT = /\b(?:cash[\s-]?outs?|payouts?)\b|\b(?:accept|process|collect|take|make|refund)\s+(?:online\s+)?payments?\b|\b(?:send|receive|transfer)\s+(?:money|funds?)\b/i;
const DEPOSIT = /\bdeposits?\b/i;
const WITHDRAW = /\bwithdraw(?:als?|s|ing|n)?\b/i;
const MONEY_CONTEXT = /\b(?:money|funds?|cash|wallets?|bank(?:ing)?|payments?|balances?|interest|rupees?|dollars?|inr|usd|eur|upi|transactions?)\b/i;
// "Withdraw a request" means cancel it; geological deposits and course withdrawals are not money.
// Remove the mention, not the entire request: the same app may separately accept a real payment.
const NON_MONETARY_MENTIONS = /\b(?:mineral|ore|coal|oil|sediment|sand|calcium|plaque|protein|geological)\s+deposits?\b|\bdeposits?\s+of\s+(?:minerals?|ore|coal|oil|sediment|sand|calcium|plaque|protein)\b|\b(?:course|class|academic|enrolment|enrollment|consent|drug|alcohol|nicotine)\s+withdrawals?\b|\bwithdraw(?:s|ing|n)?\s+(?:(?:a|an|the|their|my)\s+)?(?:leave\s+|course\s+)?(?:requests?|applications?|consent|troops?)\b/gi;
const SIMULATED_MONEY = /\b(?:demo|mock|simulat(?:e[sd]?|ion|or)|pretend|play[\s-]+money|virtual[\s-]+(?:chips?|coins?|money)|fake[\s-]+money|sandbox[\s-]+payments?)\b/i;
const REAL_MONEY = /\b(?:real|live|actual)[\s-]+(?:money|payments?|deposits?|withdrawals?|payouts?)\b/i;
const MONEY_EXPLANATION = /\b(?:calculat(?:e|es|or|ion|ing)|interest|estimat(?:e|es|or|ion)|educational|tutorial|lessons?|explain(?:er)?|symptoms?|geolog(?:y|ical))\b/i;
const PROCESS_MONEY = /\b(?:accept|process|enable|support|implement|integrate|allow|handle)\s+(?:[\w-]+\s+){0,3}(?:deposits?|withdrawals?|payouts?|payments?)\b/i;
const MONEY_TERM = String.raw`(?:(?:real|live|actual)[\s-]+(?:money[\s-]+)?)?(?:deposits?|withdrawals?|withdraw|cash[\s-]?outs?|payouts?|payments?|money)`;
const DECLINED_MONEY = new RegExp(String.raw`\b(?:no|without|do not|don't|never)\s+(?:(?:allow|enable|support|process|accept|include)\s+)?${MONEY_TERM}(?:\s*(?:and|or|/)\s*${MONEY_TERM})*\b|\b${MONEY_TERM}\s+(?:is\s+|are\s+)?(?:not\s+(?:needed|required|allowed)|disabled)\b`, 'gi');

/**
 * BRcdffbb71: "colour prediction game ... deposit ... withdrawal process" was classified as game,
 * so the builder was explicitly forbidden accounts despite the money-moving feature. Read that
 * feature independently of the primary domain. Pure calculators, explanations and explicitly simulated
 * flows do not imply access control. Separate clauses keep "demo game, but real deposits" from being
 * discarded with the demo clause. A match only lets the builder consider the requested architecture.
 */
export function asksForMoneyMovement(text: string | null | undefined): boolean {
  const request = String(text ?? '').replace(NON_MONETARY_MENTIONS, ' ');
  // The report's deposit + withdrawal pair is monetary without an explicit "money" keyword. A
  // lone ambiguous verb/noun needs financial context, so generic requests cannot disable this rule.
  const paired = DEPOSIT.test(request) && WITHDRAW.test(request);
  return request.replace(DECLINED_MONEY, ' ').split(/[.;\n]|\b(?:but|however)\b/i).some((clause) => {
    const financialContext = paired || MONEY_CONTEXT.test(clause) || REAL_MONEY.test(clause);
    if (!DIRECT_MONEY_MOVEMENT.test(clause) && !(financialContext && (DEPOSIT.test(clause) || WITHDRAW.test(clause)))) return false;
    if (REAL_MONEY.test(clause)) return true;
    if (SIMULATED_MONEY.test(clause)) return false;
    return !MONEY_EXPLANATION.test(clause) || PROCESS_MONEY.test(clause);
  });
}

export interface RequestScopeInput {
  /** What the builder reads: the message, plus any attachment and earlier requests (planningRequest). */
  request: string;
  /** Only a NEW build is scoped; an edit of an app that exists keeps whatever that app already has. */
  newBuild: boolean;
  /** `analyzeRequirementGaps(request).domain`; a domain whose features add access control stands this rule down. */
  domain: string | null | undefined;
}

export const REQUEST_SCOPE_NOTE = [
  'REQUEST SCOPE: build the app this request describes, and nothing it did not ask for.',
  '- The request does not ask for sign-in, so add NO login, sign-up, password gate, demo account or user',
  '  accounts: the app opens straight onto its main screen.',
  '- Add no button, prop or action for a state the app\'s data does not have (for example, no "Clear',
  '  completed" for notes that cannot be completed). A control that deletes data says exactly what it deletes.',
].join('\n');

/** Why the note applies — the decider's own reason, which the report line restates and nothing else. */
export type RequestScopeReason = 'names-no-sign-in' | 'declines-sign-in';

/** The decision and its reason, or null when the note does not apply. PURE. */
export function requestScopeVerdict(input: RequestScopeInput, env: NodeJS.ProcessEnv = process.env): { note: string; reason: RequestScopeReason } | null {
  if (!requestScopeEnabled(env)) return null;
  if (!input?.newBuild) return null;
  if (domainAddsAccessControl(input.domain)) return null;
  if (asksForSignIn(input.request)) return null;
  if (asksForMoneyMovement(input.request)) return null;
  return { note: REQUEST_SCOPE_NOTE, reason: declinesSignIn(input.request) ? 'declines-sign-in' : 'names-no-sign-in' };
}

/** The note for this build, or '' when it does not apply. PURE. */
export function requestScopeNote(input: RequestScopeInput, env: NodeJS.ProcessEnv = process.env): string {
  return requestScopeVerdict(input, env)?.note ?? '';
}

/**
 * The build-report line, said HERE beside the decision and in its terms (autopsy 303e8a6f). It was a literal at the
 * call site — "The request asks for no sign-in" — on a request that never mentioned sign-in: the rule fires on
 * ABSENCE, and an explicit decline used to stand it down, so that sentence could only ever appear where it was
 * false. A false reason sends the next autopsy looking for a phrase that does not exist. PURE.
 */
export function requestScopeReportLine(reason: RequestScopeReason): string {
  // ⚠️ Credit the DETECTOR, never the request (adversarial review): "names no … access word" overclaimed — the
  // rule reads a word list, and a request can name a gate in words it does not hold.
  const why = reason === 'declines-sign-in'
    ? 'The request declines sign-in in so many words (and asks for none of the sign-in words this rule looks for)'
    : 'The request matched none of the sign-in words this rule looks for (login, sign-in, account, password, OTP, roles, admin, private, PIN, biometric, …)';
  return `${why}, matched no money-movement feature this rule looks for, and the requirement analyzer placed it in no domain whose features add access control, so this new build was told to add no login or accounts and no control for a state the data does not have.`;
}

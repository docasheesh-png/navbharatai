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
 * - a request in a domain the requirement analyzer recognises (healthcare, e-commerce, booking, …).
 *   AGENTV3_REQUIREMENT_AWARE deliberately adds access control there, and this rule must never fight it.
 * A missed case costs today's behaviour; a wrong note would only drop a login the request never named.
 * Kill switch: `AGENTV3_REQUEST_SCOPE=off`. PURE.
 */

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
  String.raw`\bprotect\w*\b`, String.raw`\block(?:ed)?\b`, String.raw`\bpin\b`,
  String.raw`\b(?:multi|multiple|many|several)[\s-]?users?\b`, String.raw`\b(?:each|every|per)\s+user\b`,
  String.raw`\busers?\s+(?:can|could|should|will|must)\b`, String.raw`\bmembers?\b`, String.raw`\bsubscri\w*\b`,
  String.raw`\bfirebase\b`, String.raw`\bsupabase\b`, String.raw`\bclerk\b`,
  'लॉग\\s?इन', 'साइन\\s?इन', 'पासवर्ड', 'अकाउंट', 'खाता', 'लॉगिन',
].join('|'), 'i');

export function asksForSignIn(text: string | null | undefined): boolean {
  return ASKS_FOR_SIGN_IN.test(String(text ?? ''));
}

export interface RequestScopeInput {
  /** What the builder reads: the message, plus any attachment and earlier requests (planningRequest). */
  request: string;
  /** Only a NEW build is scoped; an edit of an app that exists keeps whatever that app already has. */
  newBuild: boolean;
  /** `analyzeRequirementGaps(request).domain`; anything but 'general' stands this rule down. */
  domain: string | null | undefined;
}

export const REQUEST_SCOPE_NOTE = [
  'REQUEST SCOPE: build the app this request describes, and nothing it did not ask for.',
  '- The request does not ask for sign-in, so add NO login, sign-up, password gate, demo account or user',
  '  accounts: the app opens straight onto its main screen.',
  '- Add no button, prop or action for a state the app\'s data does not have (for example, no "Clear',
  '  completed" for notes that cannot be completed). A control that deletes data says exactly what it deletes.',
].join('\n');

/** The note for this build, or '' when it does not apply. PURE. */
export function requestScopeNote(input: RequestScopeInput, env: NodeJS.ProcessEnv = process.env): string {
  if (!requestScopeEnabled(env)) return '';
  if (!input?.newBuild) return '';
  if (String(input.domain ?? 'general') !== 'general') return '';
  if (asksForSignIn(input.request)) return '';
  return REQUEST_SCOPE_NOTE;
}

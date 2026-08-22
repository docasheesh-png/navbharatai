// One verified phone number, one account — and importing somebody else's code needs one.
//
// ADMIN 2026-08-22, in two parts:
//   1. *"agar koi aisa mobile number re verify ho jisse pahle hi koi account ban rakhi hai, to woh
//      number verify hi mat karo. usko otp bhejo hi mat. pura mamla hi khatam karo."*
//   2. *"otp verified nahi to — github/zip app import nahi!"*
//
// The first rule replaced an earlier proposal to MERGE two accounts when a number turned out to be
// shared. Refusing is the better design and the reason is worth keeping: in India a disconnected
// number is reallocated to a new subscriber after ~90 days, so "this number already has an account"
// often means *the previous owner of that SIM*. An automatic merge would have handed a stranger
// somebody else's apps, published sites and wallet, with no undo. Refusing makes that impossible
// rather than unlikely.
//
// ⚠️ THE DISTINCTION THIS MODULE EXISTS FOR: **LOGIN and VERIFY are opposite cases.**
//
//   • LOGIN — the user is signed OUT and proving a number to get in. A number that already has an
//     account is the WHOLE POINT: that is the account they are opening. Refusing here would lock every
//     returning phone user out of the product.
//   • VERIFY — the user is already signed IN and attaching a number to THIS account. A number owned by
//     a different account must be refused before an SMS is sent.
//
// Same endpoint, same number, opposite answers. So the purpose travels with the request, and it
// defaults to LOGIN — the behaviour that existed before this file, so an older client (and the
// installed Android/iOS build, which ships its own bundled frontend) keeps working unchanged.
//
// 🔓 AND IT FAILS OPEN. If the directory cannot be read, the OTP is SENT. The real enforcement is the
// auth provider's own one-number-one-account rule, which rejects a duplicate at link time no matter
// what this module decided; this check exists to save an SMS and to give a better message. Failing
// closed would mean one provider hiccup locks every user out of verification — a much worse outcome
// than one wasted SMS.
//
// PURE except for the injected lookup, following `resolveVerifiedEmailWith`'s shape so every branch is
// testable without a network.

import { normalizePhone, maskPhone } from '../../lib/phoneNumber';

/** The slice of the admin Auth SDK this module uses — structural, so tests need no SDK. */
export interface PhoneLookupAuth {
  getUserByPhoneNumber(phone: string): Promise<{ uid: string } | null>;
  getUser(uid: string): Promise<{ phoneNumber?: string | null } | null>;
}

export type OtpPurpose = 'login' | 'verify';

export interface OtpSendDecision {
  /** Send the SMS? */
  allow: boolean;
  /** Machine-readable, for the client to branch on. */
  code?: 'phone-belongs-to-another-account';
  /** What the user reads. Always carries the way OUT — see below. */
  message?: string;
}

/**
 * THE REFUSAL ALWAYS CARRIES THE DOOR.
 *
 * "This number is already in use" on its own is a dead end and a support ticket: the user is stuck,
 * with no idea what to do next. But we know exactly what they should do, and it is a thing the product
 * already does perfectly — sign in with that number, which opens the account that owns it. So the
 * refusal names it, and the client turns it into a button.
 */
export const PHONE_TAKEN_MESSAGE =
  'This number is already linked to another NavBharatAI account. Sign in with this number instead — '
  + 'it will open that account, with its apps and wallet.';

/** What the user is told when an import needs a verified number. Names the reason, not just the rule. */
export const IMPORT_NEEDS_PHONE_MESSAGE =
  'Verify your mobile number to import a project. It takes one OTP, and you only ever do it once.';

/**
 * Decide whether to send the OTP. Pure.
 *
 * `ownerUid` is who currently owns the number (null when nobody does), `callerUid` is the signed-in
 * user asking. Re-verifying a number you already own is allowed — a user who reinstalls the app and
 * repeats the step should not be told their own number belongs to somebody else.
 */
export function otpSendDecision(opts: {
  purpose: OtpPurpose;
  ownerUid: string | null;
  callerUid: string | null;
}): OtpSendDecision {
  // Signing in with a number that has an account is the entire point of signing in with a number.
  if (opts.purpose !== 'verify') return { allow: true };
  if (!opts.ownerUid) return { allow: true };
  if (opts.callerUid && opts.ownerUid === opts.callerUid) return { allow: true };
  return { allow: false, code: 'phone-belongs-to-another-account', message: PHONE_TAKEN_MESSAGE };
}

/**
 * Who owns this number, or null. Returns null on ANY failure — see the fail-open note in the header.
 *
 * `null` therefore means two different things (nobody owns it / we could not tell), and both lead to
 * the same action: send the OTP. That collapse is deliberate; distinguishing them would only tempt a
 * future caller into failing closed on the second one.
 */
export async function phoneOwnerUid(
  rawPhone: string,
  getAuth: () => Promise<PhoneLookupAuth | null>,
): Promise<string | null> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return null;
  try {
    const auth = await getAuth();
    if (!auth) return null;
    const user = await auth.getUserByPhoneNumber(phone);
    return user && typeof user.uid === 'string' && user.uid ? user.uid : null;
  } catch {
    return null; // not-found and provider-down are indistinguishable here, and both mean "send it"
  }
}

/**
 * Does this account have a verified number? The auth record only carries `phoneNumber` once a phone
 * credential has actually been verified and linked, so its presence IS the verification.
 *
 * ⚠️ FAILS CLOSED, unlike the lookup above, and the asymmetry is deliberate. A wrong "yes" here would
 * let an unverified account import; a wrong "no" costs the user one OTP they can complete immediately.
 * The cheap mistake is the one to make.
 */
export async function hasVerifiedPhoneWith(
  uid: string | null | undefined,
  getAuth: () => Promise<PhoneLookupAuth | null>,
): Promise<boolean> {
  if (!uid) return false;
  try {
    const auth = await getAuth();
    if (!auth) return false;
    const user = await auth.getUser(uid);
    return typeof user?.phoneNumber === 'string' && user.phoneNumber.trim().length > 0;
  } catch {
    return false;
  }
}

/** For a log line that identifies the number without printing it. Pure. */
export function phoneForLog(raw: string | null | undefined): string {
  return maskPhone(normalizePhone(raw) ?? raw ?? '');
}

/**
 * The kill switch for the import gate. ON by default — the admin asked for the rule, so the rule is
 * the default; the env exists so a live problem can be undone without a deploy, exactly like every
 * other gate in this codebase.
 *
 * ⚠️ Turning it OFF does NOT re-open the duplicate-number hole: that is enforced by the auth provider
 * itself and by the send-OTP check, neither of which reads this flag. This switch governs one thing —
 * whether an unverified account may start an import.
 */
export function importPhoneGateEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_IMPORT_REQUIRES_PHONE ?? '').trim().toLowerCase() !== 'off';
}

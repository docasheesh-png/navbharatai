// THE CODE TYPED BEFORE THERE IS AN ACCOUNT TO ATTACH IT TO.
//
// The admin asked for the referral box to appear ON THE SIGN-IN SCREEN, once, the first time the app
// is opened — which creates a small ordering problem worth stating plainly: a referral is attached to
// a USER, and on the sign-in screen there is not one yet. So the code is HELD here and applied the
// moment sign-in completes.
//
// 🔒 HELD, NOT APPLIED. Nothing in this file credits anything. The server still decides — same
// device check, same one-code-per-account rule, same refusals. A held code is a typed string with no
// more authority than a freshly typed one; the only thing it changes is that the user did not have
// to find the box again after signing in.
//
// 🔒 AND IT IS OFFERED EXACTLY ONCE. "bas 1 bad 1st time (optional)" — a box that reappears is a box
// that nags, and a referral code is only ever useful to a genuinely new account anyway. The marker
// survives the app being closed, because the first open and the sign-in that follows it can easily
// be two different launches on a slow phone.
//
// PURE apart from the guarded storage reads, which can throw (private mode, blocked site data) and
// come back empty. Every failure is treated as "no code" — losing a held code costs the user one
// re-entry in the Promo screen, while a throw on the sign-in path would cost them the app.

const PENDING_KEY = 'nbai_pending_referral';
const OFFERED_KEY = 'nbai_referral_box_offered';

function store(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** Has the one-time box already been shown? Storage failure reads as "yes" — see below. */
export function referralBoxAlreadyOffered(s: Storage | null = store()): boolean {
  try {
    return s?.getItem(OFFERED_KEY) === '1';
  } catch {
    // ⚠️ THE SAFE DEFAULT HERE IS "ALREADY SHOWN", which is the opposite of the testing notice's.
    // That one is information and showing it twice is harmless; this one is a form on the sign-in
    // path, and a browser that cannot remember would offer it on EVERY launch for ever.
    return true;
  }
}

/** Remember the box was offered, so it never appears again. Never throws. */
export function markReferralBoxOffered(s: Storage | null = store()): void {
  try { s?.setItem(OFFERED_KEY, '1'); } catch { /* it will be offered once more; not worth a crash */ }
}

/** Hold a code until there is an account. Never throws. */
export function holdReferralCode(code: string, s: Storage | null = store()): void {
  try { s?.setItem(PENDING_KEY, code); } catch { /* the user can enter it again in Promo */ }
}

/** The held code, or null. */
export function heldReferralCode(s: Storage | null = store()): string | null {
  try {
    const v = s?.getItem(PENDING_KEY);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Forget the held code.
 *
 * 🔴 CALLED ON EVERY OUTCOME, INCLUDING REFUSAL, and that is deliberate rather than careless. A code
 * the server refused — wrong code, device already used, account not new — will be refused every time,
 * so keeping it means retrying a guaranteed failure on every launch for ever. The user is told what
 * happened and can enter a different code in the Promo screen, which is the honest path.
 */
export function clearHeldReferralCode(s: Storage | null = store()): void {
  try { s?.removeItem(PENDING_KEY); } catch { /* nothing to clear it with */ }
}

/** Should the one-time box be shown right now? Android only, never offered before, not signed in. */
export function shouldOfferReferralBox(opts: {
  platform: string | null | undefined;
  alreadyOffered: boolean;
  signedIn: boolean;
}): boolean {
  if (String(opts.platform ?? '').trim().toLowerCase() !== 'android') return false;
  if (opts.alreadyOffered) return false;
  // Somebody already signed in is not meeting the sign-in screen for the first time; they reach the
  // same box in Wallet → Promo, where it belongs for the rest of the account's life.
  return !opts.signedIn;
}

// WHY IS APPLE SIGN-IN STILL FAILING? — the question, answered from inside production.
//
// THE PROBLEM WITH HOW THIS WAS BEING DEBUGGED (admin, 2026-08-21: "apple login abhi bhi nahi ho raha").
// Sign in with Apple on the web has about five independent ways to fail, and from a browser they all
// look identical: a sheet that closes with nothing signed in. Worse, most of them live where neither
// the admin nor a Claude session can see — Apple's portal, Cloud Run's env, and whatever sits in front
// of our own domain. Each round trip of "try this, tell me what happened" costs an evening.
//
// So this collapses the guessing into ONE answer. The server fetches its OWN public association URL —
// exactly what Apple fetches — and compares it with what it believes it is serving. That single
// comparison separates causes that are otherwise indistinguishable:
//
//   • 404 from our own route          → the file is not configured at all (env unset, nothing committed)
//   • HTML / a different body         → something in FRONT of us answers that path; our route never runs
//   • a body that does not match ours → a stale deploy, or a CDN serving an older copy
//   • an exact match                  → OUR side is correct, and the remaining cause is Apple-side
//                                       (Verify not pressed, wrong Service ID, or the key/return URL)
//
// The last line is the valuable one: it is the only way to say "stop looking at the code" with evidence
// rather than with confidence.
//
// PURE — the caller performs the fetch and passes the result in. No network here, so every verdict is
// unit-testable, including the ones that only happen in production.

// ONE source of truth for the Services ID. `routes/admin.ts` already imports it from here and reports
// it in this endpoint's own response, so a second copy in this file would be a value that can disagree
// with the one the same JSON prints — the exact drift this codebase centralises away.
import { APPLE_SERVICE_ID as APPLE_SERVICE_ID_FOR_ADVICE } from '../../components/socialSignInPolicy';

export type AppleSignInVerdict =
  /** Nothing is configured — the file cannot be served because we do not have it. */
  | 'not-configured'
  /** We hold the file, but the public URL does not reach our route. */
  | 'intercepted'
  /** The public URL reaches us but serves different content — stale deploy or a cache in between. */
  | 'stale'
  /** We could not check the public URL at all. NOT the same as a failure. */
  | 'unverifiable'
  /** Our side is provably correct; anything still broken is in Apple's portal. */
  | 'ours-is-correct';

export interface AppleSelfFetch {
  /** HTTP status the server got fetching its own public association URL; null when it could not ask. */
  status: number | null;
  /** The body it got back, trimmed. */
  body: string;
  /** Content-Type, lowercased. */
  contentType: string;
  /** Set when the fetch itself failed (DNS, TLS, timeout) rather than returning a status. */
  error?: string;
}

export interface AppleDiagnosisInput {
  /** What our own route would serve, or null when nothing is configured. */
  served: string | null;
  /** Where it came from, purely informational. */
  source: 'env' | 'dist-file' | 'source-file' | null;
  /** The result of fetching our own public URL, or null when the check was not run. */
  selfFetch: AppleSelfFetch | null;
  /**
   * The Firebase error code the BROWSER actually reported, when the admin has one to hand (from the
   * toast, or `[auth] social redirect failed:` in the console). Optional — omitted, everything below
   * behaves exactly as it did before.
   *
   * WHY THIS BELONGS IN A SERVER-SIDE FILE CHECK (2026-08-22). This module's strongest verdict,
   * `ours-is-correct`, used to end by sending the admin to press **Verify** in Apple's portal. For one
   * code that advice is now provably wrong: `auth/invalid-credential` comes out of
   * `accounts:signInWithIdp`, which the browser only reaches AFTER Apple has accepted the sign-in and
   * returned. Apple's Verify, the Return URL and this very association file are therefore all already
   * working — so re-checking them finds nothing, and an evening goes into the wrong portal.
   *
   * This is the same defect the client-side message had, in its sibling. Fixing one and leaving the
   * other would mean the admin's two sources of advice disagree, and the wrong one sounds more
   * authoritative because it ran a live check.
   */
  observedCode?: string | null;
}

/**
 * Codes that PROVE Apple's side already worked, because the browser cannot produce them until Apple
 * has accepted the sign-in and handed a credential back.
 *
 * Deliberately a SHORT list. A code that merely *often* means this does not belong here — the value of
 * saying "stop looking there" comes entirely from it being true every time.
 */
const CODES_PROVING_APPLE_RETURNED = new Set(['auth/invalid-credential']);

/** The one thing left to check once Apple has provably returned. Shared so the wording cannot drift. */
export function firebaseAppleConfigNextStep(serviceId: string): string {
  return 'Apple accepted the sign-in and handed the credential back — so Apple’s Verify, the Return URL '
    + 'and this file are all already working, and re-checking them will find nothing. What failed is the '
    + 'step after: exchanging Apple’s code. In Firebase Console → Authentication → Sign-in method → Apple, '
    + `check ALL FOUR values: Services ID (exactly ${serviceId}), Apple Team ID, Key ID, and the .p8 private key. `
    + 'Any one of them being wrong produces exactly this failure.';
}

export interface AppleDiagnosis {
  verdict: AppleSignInVerdict;
  /** One sentence a non-technical admin can act on. */
  message: string;
  /** The single next step, or null when there is nothing left for us to do. */
  nextStep: string | null;
}

/** Does this body look like a web page rather than Apple's token file? The commonest interception tell. */
export function looksLikeHtml(body: string): boolean {
  const b = String(body || '').trim().slice(0, 400).toLowerCase();
  return b.startsWith('<!doctype') || b.startsWith('<html') || b.includes('<head') || b.includes('<script');
}

/**
 * Decide what is actually wrong.
 *
 * ORDER MATTERS. "Not configured" is checked first because every other verdict would be a guess about a
 * file we do not have. And `unverifiable` is a real outcome rather than a failure — being unable to ask
 * is not evidence that the answer is bad, and reporting it as bad is exactly the kind of confident
 * wrongness that sends someone to fix the wrong thing.
 */
export function diagnoseAppleSignIn(input: AppleDiagnosisInput): AppleDiagnosis {
  const served = String(input.served || '').trim();
  if (!served) {
    return {
      verdict: 'not-configured',
      message: 'NavBharatAI does not have Apple’s domain-verification file, so Apple cannot verify the domain and will refuse every sign-in.',
      nextStep: 'Download the file from Apple Developer → Certificates, Identifiers & Profiles → your Services ID → Configure → Download, then paste its contents into the APPLE_DOMAIN_ASSOCIATION environment variable in Cloud Run.',
    };
  }

  const fetched = input.selfFetch;
  if (!fetched || (fetched.status === null && fetched.error)) {
    return {
      verdict: 'unverifiable',
      message: 'The file is configured, but this server could not fetch its own public address to confirm what Apple would actually receive.',
      nextStep: `Open https://navbharatai.com/.well-known/apple-developer-domain-association.txt in a browser. It should show the file’s contents${fetched?.error ? ` (the server’s own check failed with: ${fetched.error})` : ''}.`,
    };
  }

  if (fetched.status !== 200) {
    return {
      verdict: 'intercepted',
      message: `The file is configured here, but its public address answers ${fetched.status} — so Apple never receives it.`,
      nextStep: 'Something in front of the app is answering that path before NavBharatAI does. Check the domain’s hosting/CDN rules for /.well-known/.',
    };
  }

  if (looksLikeHtml(fetched.body)) {
    return {
      verdict: 'intercepted',
      message: 'The public address returns a web page instead of the verification file, so Apple reads it as the wrong file and refuses to verify the domain.',
      nextStep: 'Something in front of the app is rewriting that path to the site’s index page. Exclude /.well-known/ from that rewrite.',
    };
  }

  if (fetched.body.trim() !== served) {
    return {
      verdict: 'stale',
      message: 'The public address returns a DIFFERENT file from the one this server holds — usually an older deployment or a cached copy.',
      nextStep: 'Redeploy, then check the address again. If it still differs, clear the CDN cache for that path.',
    };
  }

  // NARROWED BY WHAT THE BROWSER ACTUALLY REPORTED, when we have it. Only reached once our own side is
  // provably correct, so this is a choice between two Apple-side answers — and the code, where one
  // exists, is stronger evidence than the general advice below it.
  if (CODES_PROVING_APPLE_RETURNED.has(String(input.observedCode || '').trim())) {
    return {
      verdict: 'ours-is-correct',
      message: 'NavBharatAI is serving exactly the file Apple asks for, and the browser’s own error proves Apple then accepted the sign-in. Nothing on this side is blocking it.',
      nextStep: firebaseAppleConfigNextStep(APPLE_SERVICE_ID_FOR_ADVICE),
    };
  }

  return {
    verdict: 'ours-is-correct',
    message: 'NavBharatAI is serving exactly the file Apple asks for, at the exact address Apple fetches. Nothing on this side is blocking sign-in.',
    nextStep: 'In Apple Developer → your Services ID → Configure, press Verify next to the domain, and confirm the Return URL is exactly https://navbharatai.com/__/auth/handler. If Verify already shows green, check that the Service ID and key in Firebase Console → Authentication → Sign-in method → Apple match that Services ID.',
  };
}

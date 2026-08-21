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

  return {
    verdict: 'ours-is-correct',
    message: 'NavBharatAI is serving exactly the file Apple asks for, at the exact address Apple fetches. Nothing on this side is blocking sign-in.',
    nextStep: 'In Apple Developer → your Services ID → Configure, press Verify next to the domain, and confirm the Return URL is exactly https://navbharatai.com/__/auth/handler. If Verify already shows green, check that the Service ID and key in Firebase Console → Authentication → Sign-in method → Apple match that Services ID.',
  };
}

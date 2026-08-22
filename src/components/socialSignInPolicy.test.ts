import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  popupFailureAction,
  waitForSignedInUser,
  settleNativeSignIn,
  appleSignInFailureMessage,
  APPLE_WEB_RETURN_URL,
  APPLE_SERVICE_ID,
  webSignInStrategy,
  socialRedirectFailureMessage,
  authErrorDetail,
  type MinimalAuthLike,
} from './socialSignInPolicy';

describe('popupFailureAction', () => {
  // THE bug (admin, 2026-07-06): closing the popup ("cancel") forced a FULL-PAGE Google redirect.
  it("the user closing the popup is a CANCEL — never a forced redirect (the reported bug)", () => {
    expect(popupFailureAction('auth/popup-closed-by-user')).toBe('cancel');
  });

  it('a double-tap superseding the first popup is also a cancel (no popup+redirect cascade)', () => {
    expect(popupFailureAction('auth/cancelled-popup-request')).toBe('cancel');
  });

  it('ONLY a genuinely blocked popup falls back to the full-page redirect', () => {
    expect(popupFailureAction('auth/popup-blocked')).toBe('redirect');
  });

  it('every other failure is surfaced as an error (unauthorized-domain, network, unknown, empty)', () => {
    expect(popupFailureAction('auth/unauthorized-domain')).toBe('error');
    expect(popupFailureAction('auth/network-request-failed')).toBe('error');
    expect(popupFailureAction('auth/internal-error')).toBe('error');
    expect(popupFailureAction('')).toBe('error');
    expect(popupFailureAction(null)).toBe('error');
    expect(popupFailureAction(undefined)).toBe('error');
  });
});

// THE bug (admin, 2026-07-11): "Google login 1st time me logout hi rahta hai, 2nd time chalta hai" —
// popup-closed-by-user raced a sign-in that actually COMPLETED; the quiet cancel swallowed the success.
describe('waitForSignedInUser — a "cancel" is only final after the sign-in grace window', () => {
  function fakeAuth(initial: unknown | null = null): MinimalAuthLike & { fire: (u: unknown | null) => void } {
    let cb: ((u: unknown | null) => void) | null = null;
    return {
      currentUser: initial,
      onAuthStateChanged(next) { cb = next; return () => { cb = null; }; },
      fire(u) { (this as { currentUser: unknown | null }).currentUser = u; cb?.(u); },
    };
  }

  it('resolves IMMEDIATELY when the user is already signed in (no wait at all)', async () => {
    const auth = fakeAuth({ uid: 'u1' });
    await expect(waitForSignedInUser(auth, 5_000)).resolves.toEqual({ uid: 'u1' });
  });

  it('THE RACE: the sign-in lands DURING the grace window → resolved as signed-in (not a cancel)', async () => {
    vi.useFakeTimers();
    try {
      const auth = fakeAuth(null);
      const p = waitForSignedInUser(auth, 2_500);
      auth.fire({ uid: 'landed-late' }); // the auth event arrives after the popup already "cancelled"
      await expect(p).resolves.toEqual({ uid: 'landed-late' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('a GENUINE cancel (nobody signs in) resolves null after the window — quiet cancel preserved', async () => {
    vi.useFakeTimers();
    try {
      const auth = fakeAuth(null);
      const p = waitForSignedInUser(auth, 2_500);
      vi.advanceTimersByTime(2_600);
      await expect(p).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('null auth events during the window do not resolve early (still waits for a real user)', async () => {
    vi.useFakeTimers();
    try {
      const auth = fakeAuth(null);
      const p = waitForSignedInUser(auth, 1_000);
      auth.fire(null); // e.g. an initial "signed out" emission
      vi.advanceTimersByTime(1_100);
      await expect(p).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('settleNativeSignIn (the "stuck on the login spinner after Google" hang fix)', () => {
  function fakeAuth(opts: { currentUser?: unknown; fireAfterMs?: number; fireUser?: unknown }): MinimalAuthLike {
    let cbs: Array<(u: unknown) => void> = [];
    const auth: MinimalAuthLike = {
      currentUser: opts.currentUser ?? null,
      onAuthStateChanged(cb) { cbs.push(cb); return () => { cbs = cbs.filter((c) => c !== cb); }; },
    };
    if (opts.fireAfterMs != null) {
      const u = opts.fireUser ?? { uid: 'landed' };
      setTimeout(() => { (auth as { currentUser: unknown }).currentUser = u; cbs.forEach((c) => c(u)); }, opts.fireAfterMs);
    }
    return auth;
  }

  it("succeeds when the credential exchange resolves normally", async () => {
    expect(await settleNativeSignIn(Promise.resolve('cred'), fakeAuth({}), 1000, 50)).toBe('ok');
  });

  it("succeeds when the exchange REJECTS but a session is already present (the SDK race)", async () => {
    const auth = fakeAuth({ currentUser: { uid: 'u' } });
    expect(await settleNativeSignIn(Promise.reject(new Error('boom')), auth, 1000, 50)).toBe('ok');
  });

  it("succeeds when the exchange rejects and the session LANDS via the listener within grace", async () => {
    const auth = fakeAuth({ fireAfterMs: 10 });
    expect(await settleNativeSignIn(Promise.reject(new Error('boom')), auth, 1000, 200)).toBe('ok');
  });

  it("succeeds when the exchange HANGS forever but the session landed (never an infinite spinner)", async () => {
    const auth = fakeAuth({ fireAfterMs: 10 }); // currentUser set at 10ms
    expect(await settleNativeSignIn(new Promise<void>(() => {}), auth, 30, 200)).toBe('ok'); // times out at 30ms
  });

  it("FAILS cleanly when the exchange fails and no session ever appears (honest error, not a hang)", async () => {
    expect(await settleNativeSignIn(Promise.reject(new Error('boom')), fakeAuth({}), 1000, 40)).toBe('failed');
  });
});

// THE bug (admin 2026-08-16, with Apple's own error page attached): Apple web sign-in dies at
// `invalid_request — Invalid web redirect url` because the Service ID has no Return URL for our custom
// authDomain. The USER-VISIBLE half of that bug is worse than the config half: the popup close came back
// as `auth/popup-closed-by-user`, the Apple handler treated it as a quiet cancel, and the app showed
// NOTHING — a button that does nothing, forever. These pin the message that ends the silence.
describe('appleSignInFailureMessage — the Apple close is never silent, and it names the actual fix', () => {
  it('names the EXACT return URL and Service ID an admin has to register (a two-minute portal change)', () => {
    const msg = appleSignInFailureMessage();
    expect(msg).toContain(APPLE_WEB_RETURN_URL);
    expect(msg).toContain(APPLE_SERVICE_ID);
    expect(APPLE_WEB_RETURN_URL).toBe('https://navbharatai.com/__/auth/handler');
    expect(APPLE_SERVICE_ID).toBe('com.navbharatai.web');
  });

  it('points at the portal page the URL is actually added on (not just "check Apple")', () => {
    expect(appleSignInFailureMessage()).toMatch(/Services\s*IDs/i);
  });

  it('ALSO serves a genuine canceller — the SDK cannot tell the two apart, so the text must cover both', () => {
    expect(appleSignInFailureMessage()).toMatch(/try again/i);
  });
});

describe('AuthComponent wiring — Apple speaks up, Google and GitHub stay quiet', () => {
  const src = readFileSync(join(__dirname, 'AuthComponent.tsx'), 'utf8');

  // The branch body only — bounded by the handler's own `} catch (`, so the window can never bleed
  // into the NEXT handler and read its setError as this one's (it did, first time round).
  function cancelledBranchAfter(handler: string): string {
    const start = src.indexOf(`const ${handler} = async`);
    expect(start, `${handler} not found`).toBeGreaterThan(-1);
    const at = src.indexOf("outcome === 'cancelled'", start);
    expect(at, `${handler} has no cancelled branch`).toBeGreaterThan(-1);
    const end = src.indexOf('} catch (', at);
    expect(end, `${handler}'s cancelled branch is not inside a try/catch`).toBeGreaterThan(at);
    return src.slice(at, end);
  }

  it('the Apple cancelled branch surfaces the honest message (this is the reported dead button)', () => {
    expect(cancelledBranchAfter('handleAppleSignIn')).toContain('setError(appleSignInFailureMessage())');
  });

  // Google's and GitHub's redirect URIs ARE registered, so a closed popup there really is a cancel.
  // Showing a config error to those users would be a lie — and re-showing an error banner on a
  // deliberate cancel is exactly the noise the 2026-07-06 fix removed.
  it('Google and GitHub cancels stay SILENT — no error banner on a deliberate cancel', () => {
    for (const handler of ['handleGoogleSignIn', 'handleGithubSignIn']) {
      expect(cancelledBranchAfter(handler), handler).not.toMatch(/setError\(/);
    }
  });
});

// APPLE ON WEB USES THE REDIRECT FLOW (admin 2026-08-19).
//
// Reproduced on desktop Chrome and iPhone Safari with the popup's own DevTools attached: Apple's
// `authorize` returned a real grant_code and userId — the sign-in genuinely completed — and the app
// still said "didn't complete". Apple returns by cross-site form_post, and that result never reached
// the window that opened the popup. The redirect flow has no such relay.
describe('webSignInStrategy — which web flow each provider gets', () => {
  it('Apple goes by REDIRECT — its form_post return cannot reach the opener', () => {
    expect(webSignInStrategy('apple.com')).toBe('redirect');
  });

  it('Google and GitHub KEEP the popup — theirs works, and a redirect would be a slower regression', () => {
    expect(webSignInStrategy('google.com')).toBe('popup');
    expect(webSignInStrategy('github.com')).toBe('popup');
  });

  it('an unknown or missing provider defaults to the popup, never a surprise navigation', () => {
    expect(webSignInStrategy(undefined)).toBe('popup');
    expect(webSignInStrategy(null)).toBe('popup');
    expect(webSignInStrategy('')).toBe('popup');
    expect(webSignInStrategy('microsoft.com')).toBe('popup');
  });
});

// SAY WHY A REDIRECT SIGN-IN FAILED (admin 2026-08-21).
//
// The app-root catch logged the real Firebase code to the console and showed the user "Sign-in failed.
// Please try again." — true of every cause, useful for none, and unreadable on a phone. This is the
// second time that class cost real debugging time (the first was Apple's popup, where a cancel and a
// misconfigured return URL closed identically).
describe('socialRedirectFailureMessage', () => {
  it('stays SILENT for auth/no-auth-event — a normal page load with no redirect pending', () => {
    expect(socialRedirectFailureMessage('auth/no-auth-event')).toBeNull();
    expect(socialRedirectFailureMessage('')).toBeNull();
    expect(socialRedirectFailureMessage(undefined)).toBeNull();
    expect(socialRedirectFailureMessage(null)).toBeNull();
  });

  it('names the browser-storage failure and what the user can actually do about it', () => {
    const m = socialRedirectFailureMessage('auth/missing-initial-state')!;
    expect(m).toMatch(/cleared the sign-in data/i);
    expect(m).toMatch(/private browsing|site data/i);
  });

  it('names the causes only an admin can fix, and where to fix them', () => {
    expect(socialRedirectFailureMessage('auth/unauthorized-domain')).toMatch(/Authorized domains/i);
    expect(socialRedirectFailureMessage('auth/operation-not-allowed')).toMatch(/Sign-in method/i);
    /**
     * SHARPENED 2026-08-22 from a real DevTools capture (`signInWithIdp 400` →
     * `auth/invalid-credential`). The old wording said "check the client id / key and the return URL",
     * which sends an admin to APPLE's portal — and reaching this error proves Apple's side already
     * works, so that is the wrong portal. The four values below are Firebase's own Apple config, the
     * only thing that can still be wrong at this point.
     */
    const cred = socialRedirectFailureMessage('auth/invalid-credential')!;
    expect(cred).toMatch(/Services ID/i);
    expect(cred).toMatch(/Team ID/i);
    expect(cred).toMatch(/Key ID/i);
    expect(cred).toMatch(/\.p8/i);
    expect(cred).toMatch(/Firebase Console/i);
    // And it says what is already RIGHT, so nobody re-checks four things that are known good.
    expect(cred).toMatch(/already correct/i);
  });

  /**
   * THE REASON WAS ALWAYS THERE AND WE DELETED IT (2026-08-22).
   *
   * `@firebase/auth` splits the identity-toolkit error on `' : '` and, when the server sent a detail,
   * throws it as the error's own `.message`. Every caller then wrote `err.code || err.message` — and the
   * code is ALWAYS truthy, so the detail half never ran. A real, reproducible Apple failure therefore
   * logged `auth/invalid-credential` and not one word about why.
   *
   * These tests exist so that can never be re-introduced by someone "simplifying" the log line back.
   */
  it('unwraps the SDK packaging and returns only the server’s own sentence', () => {
    // Exactly the shape _errorWithCustomMessage produces.
    expect(authErrorDetail({ message: 'Firebase: Invalid Idp Response: invalid_client (auth/invalid-credential).' }))
      .toBe('Invalid Idp Response: invalid_client');
    expect(authErrorDetail({ message: 'Firebase: Unable to parse id_token (auth/invalid-credential).' }))
      .toBe('Unable to parse id_token');
  });

  it('returns null when there is no real detail, so a caller can never append noise', () => {
    // The prod error map's own generic sentences arrive in the SAME shape. Repeating them at the user
    // would say the code twice and look like new information.
    expect(authErrorDetail({ message: 'Firebase: An internal AuthError has occurred. (auth/internal-error).' })).toBeNull();
    expect(authErrorDetail({ message: 'some other library’s error' })).toBeNull();
    expect(authErrorDetail({})).toBeNull();
    expect(authErrorDetail(null)).toBeNull();
    expect(authErrorDetail(undefined)).toBeNull();
    expect(authErrorDetail({ message: 42 })).toBeNull();
  });

  it('carries the server’s reason into the message, because a phone has no console', () => {
    const m = socialRedirectFailureMessage('auth/invalid-credential', 'Invalid Idp Response: invalid_client')!;
    // Our sentence says what to DO; the detail says what the server actually complained about. The
    // detail is the half that survives a cause nobody has met before, so it is APPENDED, not swapped in.
    expect(m).toMatch(/Services ID/i);
    expect(m).toContain('invalid_client');
  });

  it('is unchanged when no detail is available — every existing caller keeps working', () => {
    expect(socialRedirectFailureMessage('auth/invalid-credential'))
      .toBe(socialRedirectFailureMessage('auth/invalid-credential', null));
    expect(socialRedirectFailureMessage('auth/invalid-credential', '   '))
      .toBe(socialRedirectFailureMessage('auth/invalid-credential'));
    expect(socialRedirectFailureMessage('auth/no-auth-event', 'anything')).toBeNull();
  });

  it('the two places a human reads the failure both take the detail', () => {
    const app = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');
    const auth = readFileSync(join(process.cwd(), 'src/components/AuthComponent.tsx'), 'utf8');
    // The redirect path: logged AND shown.
    expect(app).toContain('const detail = authErrorDetail(e);');
    expect(app).toContain('socialRedirectFailureMessage(code, detail)');
    // The native exchange path — the one iOS Apple sign-in ends in, and the same blind spot.
    expect(auth).toContain('const d = authErrorDetail(e);');
  });

  it('does NOT tell an invalid CLIENT ID that the provider registration is already correct', () => {
    // These two codes shared one sentence until 2026-08-22. The invalid-credential sentence asserts the
    // provider's own registration is fine — which is precisely what invalid-oauth-client-id denies, so
    // sharing it would have sent an admin away from the one portal that could fix it.
    const clientId = socialRedirectFailureMessage('auth/invalid-oauth-client-id')!;
    expect(clientId).toMatch(/client id/i);
    expect(clientId).toMatch(/return URL/i);
    expect(clientId).not.toMatch(/already correct/i);
  });

  it('tells a user with an existing account what to do instead', () => {
    expect(socialRedirectFailureMessage('auth/account-exists-with-different-credential'))
      .toMatch(/different sign-in method/i);
  });

  it('THE KEY RULE: an unknown code is never swallowed — it travels in the message', () => {
    const m = socialRedirectFailureMessage('auth/some-brand-new-thing')!;
    expect(m).toContain('auth/some-brand-new-thing');
    // …and it asks for the code, so a user report carries the one fact that ends the investigation.
    expect(m).toMatch(/send us this code/i);
  });

  it('every message is plain user language — no vendor or model names leak', () => {
    for (const code of [
      'auth/missing-initial-state', 'auth/account-exists-with-different-credential',
      'auth/network-request-failed', 'auth/timeout', 'auth/web-storage-unsupported',
      'auth/user-disabled', 'auth/unknown-x',
    ]) {
      const m = socialRedirectFailureMessage(code)!;
      expect(m.length).toBeGreaterThan(20);
      expect(m).not.toMatch(/GLM|Kimi|Claude|Sonnet|Opus|Gemini|Grok|Anthropic|Moonshot/i);
    }
  });
});

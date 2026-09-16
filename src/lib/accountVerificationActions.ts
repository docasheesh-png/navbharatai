// THE THREE VERIFICATION ACTIONS — email, phone, GitHub (admin 2026-09-16).
//
// WHY THIS FILE EXISTS. `stepIsProven` (server, referralRewards.ts) already reads all three facts
// straight off the Firebase account record — email verified, a linked phone, `github.com` among the
// linked providers — because the referral payout needed a PROOF nobody can fake from the request
// body. What was missing was a way for a real user to actually MAKE those facts true: the referral
// screen (`ReferralPanel.tsx`) told a blocked step "Verify your email address first" / "Connect your
// GitHub account first" as plain text, with `onVerifyPhone` declared in its own props and never once
// called — three real buttons that only ever rendered as words. This file is the part that was
// missing: one real action per step, shared by the Profile page (where a user finds them proactively)
// and the referral screen (where a blocked step can now fix itself in place).
//
// Phone is NOT here — `VerifyPhoneSheet` already does that whole job correctly and is reused as-is;
// duplicating it would be exactly the "four drifted copies" class rule 4 exists to prevent.

import type { Auth, User as FirebaseUser } from 'firebase/auth';
import { raceNativeAuth } from './nativeAuthGuard';
import { popupFailureAction } from '../components/socialSignInPolicy';
import { markRedirectStarted } from './redirectSignInMarker';

/** Is `github.com` among this account's linked sign-in providers? Client-side mirror of the server's
 *  `githubIsLinked` (referralRewards.ts) — kept separate rather than shared, because that module reads
 *  `process.env` and must never reach the browser bundle (see referralStepNames.ts's own note on why
 *  the two sides keep their own small copy of a one-line check rather than one importable across the
 *  server/client boundary). */
export function isGithubLinked(user: Pick<FirebaseUser, 'providerData'> | null | undefined): boolean {
  return !!user?.providerData?.some((p) => p.providerId === 'github.com');
}

/** Send Firebase's own verification email to the signed-in account. Firebase mails a link; the account
 *  only becomes `emailVerified` once the user opens it, so the caller must `user.reload()` (or wait for
 *  the user to come back and re-check) rather than assume success from this call returning. */
export async function sendVerificationEmail(user: FirebaseUser): Promise<void> {
  const { sendEmailVerification } = await import('firebase/auth');
  await sendEmailVerification(user);
}

export type LinkGithubOutcome = 'ok' | 'cancelled' | 'redirecting';

/**
 * Connect GitHub to the CURRENTLY SIGNED-IN account, without changing who that account is.
 *
 * This is deliberately a LINK, never a sign-in: `linkWithCredential` / `linkWithPopup` attach the
 * GitHub identity to `auth.currentUser`, whereas `signInWithCredential` (what AuthComponent.tsx's
 * native GitHub branch uses for the LOGIN screen) would switch the active session to whichever
 * account that GitHub identity belongs to — the wrong outcome here, since the person is verifying the
 * account they are already in, not choosing which account to become.
 *
 * Mirrors AuthComponent.tsx's existing native-vs-web split for the exact reason documented there:
 * GitHub disallows/breaks OAuth inside an embedded WebView, so the native app must use the device's
 * own GitHub sheet via `@capacitor-firebase/authentication` and then link the resulting credential,
 * while the web app can link directly through a popup (falling back to a redirect only when the
 * browser genuinely blocks the popup — `popupFailureAction` is the SAME decision the sign-in screen
 * already makes, reused rather than re-derived so the two can never disagree on what a cancel means).
 *
 * A redirect fallback completes itself: App.tsx's existing `getRedirectResult` handler at the app
 * root already reads a GitHub credential off ANY redirect result (sign-in or link — the SDK returns
 * the same `UserCredential` shape for both) and re-applies `setUser(result.user)`, which is a no-op
 * change of uid here and simply refreshes `providerData` to include the new link. No new wiring
 * needed for that path.
 */
export async function linkGithubAccount(auth: Auth): Promise<LinkGithubOutcome> {
  const user = auth.currentUser;
  if (!user) throw new Error('You need to be signed in to connect GitHub.');
  if (isGithubLinked(user)) return 'ok'; // already done — defensive, the caller should have hidden this

  const { Capacitor } = await import('@capacitor/core');

  if (Capacitor.isNativePlatform()) {
    const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
    const nativeResult = await raceNativeAuth(
      FirebaseAuthentication.signInWithGithub({
        scopes: ['repo', 'workflow', 'read:user', 'user:email'],
        customParameters: [{ key: 'allow_signup', value: 'true' }],
      }),
      'GitHub connection timed out — please try again.',
    );
    const accessToken = nativeResult.credential?.accessToken;
    if (!accessToken) {
      throw new Error('GitHub did not return an access token — please try again.');
    }
    const { GithubAuthProvider, linkWithCredential } = await import('firebase/auth');
    const credential = GithubAuthProvider.credential(accessToken);
    // The OAuth token also powers repo connect (GitViewPanel/GitPanel) — captured exactly like the
    // sign-in path does, so connecting here doubles as connecting a repo source with no extra step.
    try { localStorage.setItem('gh_token', accessToken); } catch { /* best-effort */ }
    await linkWithCredential(user, credential);
    return 'ok';
  }

  const { GithubAuthProvider, linkWithPopup, linkWithRedirect } = await import('firebase/auth');
  const provider = new GithubAuthProvider();
  provider.addScope('repo');
  provider.addScope('read:user');
  provider.addScope('user:email');
  try {
    const result = await linkWithPopup(user, provider);
    const cred = GithubAuthProvider.credentialFromResult(result);
    if (cred?.accessToken) {
      try { localStorage.setItem('gh_token', cred.accessToken); } catch { /* best-effort */ }
    }
    return 'ok';
  } catch (err: any) {
    const action = popupFailureAction(err?.code);
    if (action === 'redirect') {
      markRedirectStarted(typeof sessionStorage !== 'undefined' ? sessionStorage : null, 'github.com', Date.now());
      await linkWithRedirect(user, provider);
      return 'redirecting'; // the page navigates away; App.tsx's getRedirectResult finishes it on return
    }
    if (action === 'cancel') return 'cancelled';
    throw err;
  }
}

/** A plain-language reason for a failed link, for the ONE case worth naming specially. */
export function describeLinkGithubError(err: unknown): string {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  if (code === 'auth/credential-already-in-use') {
    return 'This GitHub account is already connected to a different NavBharatAI account. Sign in with that account, or use a different GitHub account here.';
  }
  if (code === 'auth/provider-already-linked') {
    return 'GitHub is already connected to this account.';
  }
  const message = (err as { message?: unknown } | null | undefined)?.message;
  return typeof message === 'string' && message.trim() ? message : 'Could not connect GitHub. Please try again.';
}

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  userFacingAuthError,
  authErrorCode,
  WRONG_CREDENTIALS,
  SIGN_IN_UNAVAILABLE,
  TOO_MANY_ATTEMPTS,
} from '../src/lib/authErrorMessage';
import { firebaseConfig } from '../src/config/firebase';

/**
 * Admin 2026-09-26: "error ko generic karo = jaise 'incorrect password, incorrect mail', abhi andar ki
 * coding show ho rahi sayad". It was: the email sign-in screen printed
 * `[auth/invalid-credential] Firebase: Error (auth/invalid-credential).` — the auth vendor, the SDK's
 * internal code, and for unrecognised failures the raw server reply and the project id.
 */

/** Shaped like what the auth SDK really throws: a code, a message naming the SDK, server detail. */
function sdkError(code: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(`Firebase: Error (${code}).`), {
    code,
    customData: { serverResponse: `{"error":{"message":"INVALID_LOGIN_CREDENTIALS"}} identitytoolkit.googleapis.com ${firebaseConfig.projectId}` },
    ...extra,
  });
}

const EVERY_KNOWN_CODE = [
  'auth/invalid-credential', 'auth/invalid-login-credentials', 'auth/wrong-password', 'auth/user-not-found',
  'auth/invalid-email', 'auth/missing-email', 'auth/missing-password', 'auth/weak-password',
  'auth/email-already-in-use', 'auth/user-disabled', 'auth/too-many-requests', 'auth/network-request-failed',
  'auth/popup-closed-by-user', 'auth/popup-blocked', 'auth/account-exists-with-different-credential',
  'auth/invalid-phone-number', 'auth/invalid-verification-code', 'auth/code-expired', 'auth/quota-exceeded',
  'auth/unauthorized-domain', 'auth/operation-not-allowed', 'auth/internal-error', 'auth/invalid-api-key',
  'auth/something-nobody-has-seen-yet',
];

describe('1 · wrong email and wrong password are ONE sentence', () => {
  it.each(['auth/invalid-credential', 'auth/invalid-login-credentials', 'auth/wrong-password', 'auth/user-not-found'])(
    '%s → the same words, so the screen cannot reveal which emails have an account',
    (code) => {
      expect(userFacingAuthError(sdkError(code))).toBe(WRONG_CREDENTIALS);
    },
  );
});

describe('2 · nothing internal ever reaches the screen', () => {
  const FORBIDDEN = [/auth\//i, /firebase/i, /identitytoolkit/i, /https?:/i, /\[/, new RegExp(firebaseConfig.projectId, 'i'), /INVALID_LOGIN/];
  for (const code of EVERY_KNOWN_CODE) {
    for (const ctx of ['sign-in', 'sign-up', 'reset', 'otp', 'social'] as const) {
      it(`${code} in ${ctx}`, () => {
        const out = userFacingAuthError(sdkError(code), ctx);
        expect(out.length).toBeGreaterThan(0);
        for (const re of FORBIDDEN) expect(out).not.toMatch(re);
      });
    }
  }

  it('a configuration fault reads as "not available", never as a console instruction', () => {
    expect(userFacingAuthError(sdkError('auth/unauthorized-domain'), 'social')).toBe(SIGN_IN_UNAVAILABLE);
    expect(userFacingAuthError(sdkError('auth/operation-not-allowed'))).toBe(SIGN_IN_UNAVAILABLE);
  });

  it('a code carried only inside the message is still recognised', () => {
    expect(authErrorCode(new Error('Firebase: Error (auth/too-many-requests).'))).toBe('auth/too-many-requests');
    expect(userFacingAuthError(new Error('Firebase: Error (auth/too-many-requests).'))).toBe(TOO_MANY_ATTEMPTS);
  });

  it('junk input never throws and never prints itself', () => {
    for (const junk of [null, undefined, 42, 'raw string with https://x.y/secret', { code: 7 }]) {
      const out = userFacingAuthError(junk);
      expect(out).not.toMatch(/https?:|secret/);
    }
  });
});

describe('3 · the login screen cannot bypass the helper (source guard — tsc and vitest cannot see this otherwise)', () => {
  const src = readFileSync('src/components/AuthComponent.tsx', 'utf8');

  it('no raw error message is handed to setError', () => {
    expect(src).not.toMatch(/setError\(\s*`?\$?\{?\s*(?:err|e|event|nativeErr)\??\.message/);
    expect(src).not.toMatch(/setError\(\s*(?:err|e|event)\??\.message\s*\|\|/);
  });

  it('describeAuthError returns the helper, not the code or the SDK text', () => {
    const body = src.slice(src.indexOf('function describeAuthError'), src.indexOf('function describeSocialError'));
    expect(body).toMatch(/userFacingAuthError\(/);
    expect(body).not.toMatch(/err\?\.code \?/);
    expect(body).not.toMatch(/serverResponse/);
  });

  it('the deep diagnosis goes to the console, not the screen', () => {
    expect(src).not.toMatch(/setError\([^)]*diagnoseAuth/);
    expect(src).toMatch(/diagnoseAuth\(email, password\)\.then\(\(why\) => logAuthErrorDetail/);
  });

  it('the social-sign-in messages no longer print the auth console path or the project id', () => {
    const body = src.slice(src.indexOf('function describeSocialError'), src.indexOf('/**\n * Capture the GitHub OAuth access token'));
    expect(body).not.toMatch(/return `[^`]*Firebase Console/);
  });

  it("our own server's OTP sentence is still shown as written", () => {
    expect(src).toMatch(/ownMessage: true/);
    expect(src).toMatch(/err\?\.ownMessage \? String\(err\.message\)/);
  });
});

describe('4 · sibling: build routes no longer return a raw server error', () => {
  it('agentv3 never answers a 500 with err.message unscrubbed', () => {
    const src = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(src).not.toMatch(/status\(500\)\.json\(\{ error: err\?\.message \|\|/);
    expect(src).toMatch(/toSafeClientMessage\(err, 'Failed to read the workspace files\.'\)/);
  });
});

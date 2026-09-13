import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * THE VAULT'S RE-AUTHENTICATION — the bug this suite exists for.
 *
 * The admin opened Settings → Secrets & API Keys on the app and got
 * `Firebase: Error (auth/argument-error)` on the only button available. The unlock screen called
 * `reauthenticateWithPopup` — the WEB flow — while the app itself signs in through the NATIVE plugin
 * because popup OAuth cannot run inside the WebView. With WebAuthn also unavailable there, that left
 * the vault with no working door at all.
 *
 * So the assertions below are about WHICH CALL IS MADE on which platform, not about error text: a test
 * that only checked "an error was shown" would have passed happily while the feature stayed unopenable.
 */

let isNative = false;
const reauthWithPopup = vi.fn(async (..._a: unknown[]) => ({}));
const reauthWithCredential = vi.fn(async (..._a: unknown[]) => ({}));
const signInWithGoogle = vi.fn(async () => ({ credential: { idToken: 'goog-id-token', accessToken: 'goog-access' } }));
const googleCredential = vi.fn((idToken?: string, accessToken?: string) => ({ kind: 'google', idToken, accessToken }));

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => isNative } }));

vi.mock('firebase/auth', () => ({
  reauthenticateWithPopup: (...a: unknown[]) => reauthWithPopup(...a),
  reauthenticateWithCredential: (...a: unknown[]) => reauthWithCredential(...a),
  GoogleAuthProvider: Object.assign(function GoogleAuthProvider(this: unknown) { /* provider stub */ }, {
    PROVIDER_ID: 'google.com',
    credential: (i?: string, a?: string) => googleCredential(i, a),
  }),
  GithubAuthProvider: Object.assign(function GithubAuthProvider(this: unknown) { /* stub */ }, {
    PROVIDER_ID: 'github.com',
    credential: (t: string) => ({ kind: 'github', t }),
  }),
  EmailAuthProvider: { PROVIDER_ID: 'password', credential: (e: string, p: string) => ({ kind: 'password', e, p }) },
  OAuthProvider: function OAuthProvider(this: any) { this.credential = (o: unknown) => ({ kind: 'apple', o }); },
}));

vi.mock('@capacitor-firebase/authentication', () => ({
  FirebaseAuthentication: {
    signInWithGoogle: () => signInWithGoogle(),
    signInWithApple: async () => ({ credential: { idToken: 'apple-id-token', nonce: 'n0nce' } }),
    signInWithGithub: async () => ({ credential: { accessToken: 'gh-token' } }),
  },
}));

const googleUser = { providerData: [{ providerId: 'google.com' }], email: 'a@b.com' } as never;
const passwordUser = { providerData: [{ providerId: 'password' }], email: 'a@b.com' } as never;

async function load() {
  vi.resetModules();
  return import('./vaultReauth');
}

beforeEach(() => {
  isNative = false;
  reauthWithPopup.mockClear();
  reauthWithCredential.mockClear();
  signInWithGoogle.mockClear();
  googleCredential.mockClear();
});

describe('which door each account has', () => {
  it('reads the provider off the account rather than assuming Google', async () => {
    const { reauthMethodFor } = await load();
    expect(reauthMethodFor(googleUser)).toBe('google');
    expect(reauthMethodFor(passwordUser)).toBe('password');
    expect(reauthMethodFor({ providerData: [{ providerId: 'apple.com' }], email: null } as never)).toBe('apple');
    expect(reauthMethodFor({ providerData: [{ providerId: 'github.com' }], email: null } as never)).toBe('github');
  });

  it('a phone-only account reports NO door instead of a button that cannot work', async () => {
    const { reauthMethodFor } = await load();
    expect(reauthMethodFor({ providerData: [{ providerId: 'phone' }], email: null } as never)).toBeNull();
  });

  it('an account with no usable door is refused with a plain sentence, not a Firebase code', async () => {
    const { reauthenticateNow } = await load();
    await expect(reauthenticateNow({ providerData: [{ providerId: 'phone' }], email: null } as never))
      .rejects.toThrow(/sign out and sign in again/i);
    expect(reauthWithPopup).not.toHaveBeenCalled();
  });
});

describe('🔴 the native app never takes the popup path — this is the reported bug', () => {
  it('re-authenticates Google through the NATIVE plugin credential, not a popup', async () => {
    isNative = true;
    const { reauthenticateNow } = await load();
    await reauthenticateNow(googleUser);

    // The popup is what produced auth/argument-error inside the WebView.
    expect(reauthWithPopup).not.toHaveBeenCalled();
    expect(signInWithGoogle).toHaveBeenCalledTimes(1);
    expect(googleCredential).toHaveBeenCalledWith('goog-id-token', 'goog-access');
    expect(reauthWithCredential).toHaveBeenCalledTimes(1);
  });

  it('a native provider that returns no token fails honestly instead of re-authing with undefined', async () => {
    isNative = true;
    signInWithGoogle.mockResolvedValueOnce({ credential: {} } as never);
    const { reauthenticateNow } = await load();
    await expect(reauthenticateNow(googleUser)).rejects.toThrow(/did not return a confirmation token/i);
    expect(reauthWithCredential).not.toHaveBeenCalled();
  });
});

describe('the web path is unchanged', () => {
  it('still uses the popup in a real browser', async () => {
    isNative = false;
    const { reauthenticateNow } = await load();
    await reauthenticateNow(googleUser);
    expect(reauthWithPopup).toHaveBeenCalledTimes(1);
    expect(signInWithGoogle).not.toHaveBeenCalled();
  });

  it('a password account is re-authenticated with its password, on either platform', async () => {
    for (const native of [false, true]) {
      isNative = native;
      reauthWithCredential.mockClear();
      const { reauthenticateNow } = await load();
      await reauthenticateNow(passwordUser, 'hunter2');
      expect(reauthWithCredential, `native=${native}`).toHaveBeenCalledTimes(1);
    }
  });

  it('a password account with no password typed is told so, before any call is made', async () => {
    const { reauthenticateNow } = await load();
    await expect(reauthenticateNow(passwordUser)).rejects.toThrow(/enter your account password/i);
    expect(reauthWithCredential).not.toHaveBeenCalled();
  });
});

describe('why the phone lock is unavailable is reported honestly', () => {
  it('names the app shell rather than blaming the phone', async () => {
    isNative = true;
    const { deviceLockUnavailableReason } = await load();
    expect(deviceLockUnavailableReason()).toBe('native-shell');
  });

  it('says "browser" on the web, where the phone lock genuinely can work', async () => {
    isNative = false;
    const { deviceLockUnavailableReason } = await load();
    expect(deviceLockUnavailableReason()).toBe('browser');
  });
});

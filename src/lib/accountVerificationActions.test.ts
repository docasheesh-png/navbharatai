import { describe, it, expect, vi, beforeEach } from 'vitest';

// 🔴 ROOT CAUSE this file locks (admin 2026-09-16): `ReferralPanel.tsx` told a blocked step "Verify
// your email address first" / "Connect your GitHub account first" as plain, unclickable text, and its
// own `onVerifyPhone` prop was declared and never called by anything. Three "buttons" that only ever
// rendered as words. These tests pin the real actions behind the buttons that replace them.

let isNative = false;
const sendEmailVerificationMock = vi.fn((..._args: unknown[]) => Promise.resolve());
const linkWithPopupMock = vi.fn((..._args: unknown[]) => Promise.resolve<any>(undefined));
const linkWithRedirectMock = vi.fn((..._args: unknown[]) => Promise.resolve<any>(undefined));
const linkWithCredentialMock = vi.fn((..._args: unknown[]) => Promise.resolve());
const credentialFromResultMock = vi.fn((..._args: unknown[]) => null as { accessToken?: string } | null);
const signInWithGithubMock = vi.fn((..._args: unknown[]) => Promise.resolve<any>(undefined));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => isNative },
}));

vi.mock('@capacitor-firebase/authentication', () => ({
  FirebaseAuthentication: {
    signInWithGithub: (...args: unknown[]) => signInWithGithubMock(...args),
  },
}));

vi.mock('firebase/auth', () => ({
  sendEmailVerification: (...args: unknown[]) => sendEmailVerificationMock(...args),
  linkWithPopup: (...args: unknown[]) => linkWithPopupMock(...args),
  linkWithRedirect: (...args: unknown[]) => linkWithRedirectMock(...args),
  linkWithCredential: (...args: unknown[]) => linkWithCredentialMock(...args),
  GithubAuthProvider: class {
    scopes: string[] = [];
    addScope(s: string) { this.scopes.push(s); }
    static credential(token: string) { return { providerId: 'github.com', accessToken: token }; }
    static credentialFromResult = (...args: unknown[]) => credentialFromResultMock(...args);
  },
}));

async function freshModule() {
  vi.resetModules();
  return import('./accountVerificationActions');
}

function fakeUser(providerIds: string[] = []) {
  return { uid: 'u1', providerData: providerIds.map((providerId) => ({ providerId })) } as any;
}

function fakeAuth(user: ReturnType<typeof fakeUser> | null) {
  return { currentUser: user } as any;
}

describe('isGithubLinked', () => {
  it('is true only when github.com is among the linked providers', async () => {
    const { isGithubLinked } = await freshModule();
    expect(isGithubLinked(fakeUser(['google.com', 'github.com']))).toBe(true);
    expect(isGithubLinked(fakeUser(['google.com']))).toBe(false);
    expect(isGithubLinked(null)).toBe(false);
    expect(isGithubLinked(undefined)).toBe(false);
  });
});

describe('sendVerificationEmail', () => {
  it('sends Firebase\'s own verification mail to the given user', async () => {
    const { sendVerificationEmail } = await freshModule();
    const user = fakeUser();
    await sendVerificationEmail(user);
    expect(sendEmailVerificationMock).toHaveBeenCalledWith(user);
  });
});

describe('linkGithubAccount', () => {
  beforeEach(() => {
    isNative = false;
    sendEmailVerificationMock.mockClear();
    linkWithPopupMock.mockReset();
    linkWithRedirectMock.mockReset().mockResolvedValue(undefined);
    linkWithCredentialMock.mockReset().mockResolvedValue(undefined);
    credentialFromResultMock.mockReset().mockReturnValue(null);
    signInWithGithubMock.mockReset();
  });

  it('refuses when nobody is signed in', async () => {
    const { linkGithubAccount } = await freshModule();
    await expect(linkGithubAccount(fakeAuth(null))).rejects.toThrow(/signed in/i);
  });

  it('is a no-op success when GitHub is already linked — never re-links what is already done', async () => {
    const { linkGithubAccount } = await freshModule();
    const outcome = await linkGithubAccount(fakeAuth(fakeUser(['github.com'])));
    expect(outcome).toBe('ok');
    expect(linkWithPopupMock).not.toHaveBeenCalled();
  });

  describe('web', () => {
    it('links via popup and captures the OAuth token for repo connect', async () => {
      const user = fakeUser(['google.com']);
      linkWithPopupMock.mockResolvedValue({ user });
      credentialFromResultMock.mockReturnValue({ accessToken: 'gh-tok-1' });
      const setItem = vi.fn();
      (globalThis as any).localStorage = { setItem };
      const { linkGithubAccount } = await freshModule();
      const outcome = await linkGithubAccount(fakeAuth(user));
      expect(outcome).toBe('ok');
      expect(linkWithPopupMock).toHaveBeenCalledWith(user, expect.anything());
      expect(setItem).toHaveBeenCalledWith('gh_token', 'gh-tok-1');
      delete (globalThis as any).localStorage;
    });

    it('falls back to redirect ONLY when the popup was genuinely blocked', async () => {
      const user = fakeUser([]);
      linkWithPopupMock.mockRejectedValue({ code: 'auth/popup-blocked' });
      const { linkGithubAccount } = await freshModule();
      const outcome = await linkGithubAccount(fakeAuth(user));
      expect(outcome).toBe('redirecting');
      expect(linkWithRedirectMock).toHaveBeenCalledWith(user, expect.anything());
    });

    it('a closed popup / superseded tap is a quiet cancel, never a redirect and never a throw', async () => {
      const user = fakeUser([]);
      linkWithPopupMock.mockRejectedValue({ code: 'auth/popup-closed-by-user' });
      const { linkGithubAccount } = await freshModule();
      const outcome = await linkGithubAccount(fakeAuth(user));
      expect(outcome).toBe('cancelled');
      expect(linkWithRedirectMock).not.toHaveBeenCalled();
    });

    it('a genuine failure propagates so the caller can show it', async () => {
      const user = fakeUser([]);
      linkWithPopupMock.mockRejectedValue({ code: 'auth/credential-already-in-use' });
      const { linkGithubAccount } = await freshModule();
      await expect(linkGithubAccount(fakeAuth(user))).rejects.toMatchObject({ code: 'auth/credential-already-in-use' });
    });
  });

  describe('native — the WebView cannot run GitHub OAuth, so this is the only working path', () => {
    beforeEach(() => { isNative = true; });

    it('links the native credential onto the CURRENT user — never signs in as someone else', async () => {
      const user = fakeUser(['google.com']);
      signInWithGithubMock.mockResolvedValue({ credential: { accessToken: 'native-tok' } });
      const setItem = vi.fn();
      (globalThis as any).localStorage = { setItem };
      const { linkGithubAccount } = await freshModule();
      const outcome = await linkGithubAccount(fakeAuth(user));
      expect(outcome).toBe('ok');
      // linkWithCredential, NOT signInWithCredential — the whole point of this function.
      expect(linkWithCredentialMock).toHaveBeenCalledWith(user, { providerId: 'github.com', accessToken: 'native-tok' });
      expect(setItem).toHaveBeenCalledWith('gh_token', 'native-tok');
      delete (globalThis as any).localStorage;
    });

    it('a missing access token is an honest failure, not a silent no-op', async () => {
      const user = fakeUser([]);
      signInWithGithubMock.mockResolvedValue({ credential: {} });
      const { linkGithubAccount } = await freshModule();
      await expect(linkGithubAccount(fakeAuth(user))).rejects.toThrow(/access token/i);
      expect(linkWithCredentialMock).not.toHaveBeenCalled();
    });
  });
});

describe('describeLinkGithubError', () => {
  it('names the one case worth naming specially — a GitHub identity already used elsewhere', async () => {
    const { describeLinkGithubError } = await freshModule();
    expect(describeLinkGithubError({ code: 'auth/credential-already-in-use' })).toMatch(/already connected to a different/i);
  });

  it('says it is already done rather than repeating a generic failure', async () => {
    const { describeLinkGithubError } = await freshModule();
    expect(describeLinkGithubError({ code: 'auth/provider-already-linked' })).toMatch(/already connected/i);
  });

  it('falls back to the error message, then to an honest generic sentence', async () => {
    const { describeLinkGithubError } = await freshModule();
    expect(describeLinkGithubError({ message: 'network down' })).toBe('network down');
    expect(describeLinkGithubError({})).toMatch(/could not connect/i);
    expect(describeLinkGithubError(new Error(''))).toMatch(/could not connect/i);
  });
});

/**
 * The account menu must promise what it can deliver (admin 2026-09-02).
 *
 * Report: *"2 account login theek se nahi chal rahe hai — agar 2nd account add karo, aur wapas 1st par
 * jao to login manta hai. Ya to fix kar do, ya hata do."*
 *
 * NOTHING IS BROKEN, and that is exactly the problem.
 *
 *  • `accountRoster.ts` stores metadata and **never a token** — a refresh token in localStorage is a
 *    permanent account takeover for anyone who reaches that storage (an XSS, a shared machine, an
 *    extension). That decision is right and must not be traded for one saved tap.
 *  • The Firebase SDK holds ONE live session per app instance, so a switch re-authenticates. That is
 *    documented in the roster's own header, which even warns "the UI must not overstate it".
 *  • The Google path deliberately keeps `prompt: 'select_account'`, because a `login_hint` alone can
 *    silently sign someone into the WRONG account when only one Google session is live — in an app
 *    with wallets, that is the failure the whole menu exists to prevent.
 *
 * Then the menu said "Switch account" and "Add account" — Gmail's exact words for a mechanism that
 * DOES hold sessions live at once. The user was promised Gmail and handed a re-auth, so a correct
 * design read as a bug. The mechanism is right; the promise was wrong.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { readRoster, writeRoster, MAX_ACCOUNTS, switchBannerText, providerLabel, SIGN_IN_HINT_KEY, SIGN_IN_PROVIDER_KEY, type RosterStore } from '../src/lib/accountRoster';

const NAV = readFileSync(join(__dirname, '..', 'src/components/panels/TopNav.tsx'), 'utf8');
const ROSTER = readFileSync(join(__dirname, '..', 'src/lib/accountRoster.ts'), 'utf8');
const AUTH = readFileSync(join(__dirname, '..', 'src/components/AuthComponent.tsx'), 'utf8');

describe('the menu tells the user a switch means signing in again', () => {
  /**
   * MOVED, NOT DROPPED (admin 2026-09-12: "yeh description bina bat ke jagah kha raha hai …
   * unprofessional lagta hai"). The grey paragraph under the SWITCH ACCOUNT heading is gone; the
   * same fact now rides the `title` of the row the user actually taps, which costs no space.
   *
   * The intent these tests defend is unchanged and still enforced: the menu must never promise a
   * Gmail-style live switch it cannot deliver. What changed is WHERE the honesty lives — so the
   * assertions follow it to the control instead of being deleted, which would have quietly re-opened
   * the 2026-09-02 report.
   */
  it('says it on the row you tap, where the decision is actually made', () => {
    expect(NAV).toMatch(/this signs you in again/);
    // On the switch row's own tooltip — not loose in the menu, and not on the current account.
    const at = NAV.indexOf('title={a.isCurrent');
    expect(at).toBeGreaterThan(-1);
    expect(NAV.slice(at, at + 400)).toMatch(/this signs you in again/);
  });

  it('distinguishes the two cases honestly — they are genuinely different', () => {
    // Google: the provider session is usually live, so it is a tap. Email/password: there is no
    // provider session to lean on and the password is genuinely required. Saying "one tap" for both
    // would be the same overstatement in smaller print.
    expect(NAV).toMatch(/one tap with Google/i);
    expect(NAV).toMatch(/password for email accounts/i);
  });

  it('🔒 and it is no longer a paragraph sitting in the open', () => {
    // The whole point of the change. If a later edit puts the sentence back as visible body text,
    // this fails and the reviewer has to choose deliberately rather than by drift.
    expect(NAV).not.toMatch(/Switching signs you in again/);
  });
});

describe('the security decisions behind it are intact', () => {
  it('the roster still stores NO token', () => {
    expect(ROSTER).toMatch(/\*\*No tokens, ever\.\*\*|No tokens, ever/);
    // The stored shape is metadata only — nothing token-shaped may appear in it.
    const store: Record<string, string> = {};
    const s: RosterStore = {
      getItem: (k) => store[k] ?? null,
      setItem: (k, v) => { store[k] = v; },
      removeItem: (k) => { delete store[k]; },
    };
    writeRoster(s, [{ uid: 'u1', email: 'a@b.com', name: 'A', photo: '', provider: 'google.com', lastUsed: 1 }]);
    const raw = JSON.stringify(store);
    for (const forbidden of ['refreshToken', 'idToken', 'accessToken', 'stsTokenManager', 'password']) {
      expect(raw, `${forbidden} must never be stored`).not.toContain(forbidden);
    }
    expect(readRoster(s)).toHaveLength(1);
  });

  it('the Google chooser is still shown, so a switch cannot land on the wrong account', () => {
    // Dropping `prompt: 'select_account'` would make the switch one tap and would silently sign the
    // user into whichever Google session is live — in an app with wallets, that is not a trade.
    expect(AUTH).toMatch(/prompt: 'select_account', login_hint: signInHint/);
    expect(AUTH).toMatch(/\{ prompt: 'select_account' \}/);
  });

  it('the device roster is still capped', () => {
    // An unbounded list on a shared machine is every person who ever signed in there, shown to
    // whoever sits down next.
    expect(MAX_ACCOUNTS).toBe(5);
  });
});

describe('the menu does not claim more than it does elsewhere', () => {
  it('never promises simultaneous sessions', () => {
    for (const overstatement of [/stay signed in/i, /at the same time/i, /simultaneous/i, /no need to sign in/i]) {
      expect(NAV, `menu must not claim: ${overstatement}`).not.toMatch(overstatement);
    }
  });

  it('removing an account still says it only affects THIS device', () => {
    // The list cannot sign anyone out anywhere else, and someone would use it believing they had
    // secured a shared computer.
    expect(NAV).toMatch(/this device|This device/);
  });
});

describe('the sign-in screen knows it was opened BY a switch', () => {
  it('names the account AND the method', () => {
    expect(switchBannerText('a@gmail.com', 'google.com')).toBe('Switching to a@gmail.com — continue with Google below.');
    expect(switchBannerText('a@x.com', 'apple.com')).toMatch(/continue with Apple/);
    expect(switchBannerText('a@x.com', 'password')).toMatch(/continue with your password/);
  });

  it('still helps when the provider is unknown, instead of naming a wrong one', () => {
    const line = switchBannerText('a@x.com', 'saml.something');
    expect(line).toMatch(/Switching to a@x\.com/);
    expect(line).not.toMatch(/continue with\s*\./);
    expect(providerLabel('saml.something')).toBe('');
  });

  it('shows nothing without an email — a banner with a blank name is worse than none', () => {
    for (const e of ['', '   ', null, undefined]) {
      expect(switchBannerText(e as string | null, 'google.com')).toBe('');
    }
  });

  it('the two hint keys are distinct, so display and use cannot collide', () => {
    expect(SIGN_IN_HINT_KEY).not.toBe(SIGN_IN_PROVIDER_KEY);
  });
});

describe('the banner is display-only — it must not break the login it explains', () => {
  const AUTH_SRC = readFileSync(join(__dirname, '..', 'src/components/AuthComponent.tsx'), 'utf8');

  it('reads the email hint WITHOUT consuming it', () => {
    // handleGoogleSignIn removes the hint when it passes it to Google as a login_hint. Taking it for
    // the banner as well would clear it first and quietly put the chooser back to a full list.
    const at = AUTH_SRC.indexOf('const [switchBanner]');
    const block = AUTH_SRC.slice(at, at + 600);
    expect(block).toMatch(/switchBannerText\(localStorage\.getItem\(SIGN_IN_HINT_KEY\)/);
    expect(block).not.toMatch(/removeItem/);
    // The consumer still does remove it.
    expect(AUTH_SRC).toMatch(/if \(signInHint\) localStorage\.removeItem\(SIGN_IN_HINT_KEY\);/);
  });

  it('never auto-launches the provider — a blocked popup is worse than a tap', () => {
    // Firing the popup from an effect loses the click's user gesture and browsers block it.
    const at = AUTH_SRC.indexOf('const [switchBanner]');
    expect(AUTH_SRC.slice(at, at + 900)).not.toMatch(/handleGoogleSignIn\(\)|useEffect/);
  });

  it('a blocked storage read falls back to the ordinary screen, never a crash', () => {
    const at = AUTH_SRC.indexOf('const [switchBanner]');
    expect(AUTH_SRC.slice(at, at + 800)).toMatch(/catch \{[\s\S]{0,120}return '';/);
  });
});

describe('the provider hint cannot go stale', () => {
  const NAV_SRC = readFileSync(join(__dirname, '..', 'src/components/panels/TopNav.tsx'), 'utf8');

  it('is written and cleared together with the email', () => {
    // A provider left behind from an earlier switch would name the wrong method on the next one.
    expect(NAV_SRC).toMatch(/if \(hint && via\) store\(\)\?\.setItem\(SIGN_IN_PROVIDER_KEY, via\);/);
    expect(NAV_SRC).toMatch(/else store\(\)\?\.removeItem\(SIGN_IN_PROVIDER_KEY\);/);
  });
});

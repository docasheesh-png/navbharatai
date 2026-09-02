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
import { readRoster, writeRoster, MAX_ACCOUNTS, type RosterStore } from '../src/lib/accountRoster';

const NAV = readFileSync(join(__dirname, '..', 'src/components/panels/TopNav.tsx'), 'utf8');
const ROSTER = readFileSync(join(__dirname, '..', 'src/lib/accountRoster.ts'), 'utf8');
const AUTH = readFileSync(join(__dirname, '..', 'src/components/AuthComponent.tsx'), 'utf8');

describe('the menu tells the user a switch means signing in again', () => {
  it('says it, in the menu, where the decision is made', () => {
    expect(NAV).toMatch(/Switching signs you in again/);
  });

  it('distinguishes the two cases honestly — they are genuinely different', () => {
    // Google: the provider session is usually live, so it is a tap. Email/password: there is no
    // provider session to lean on and the password is genuinely required. Saying "one tap" for both
    // would be the same overstatement in smaller print.
    expect(NAV).toMatch(/one tap with Google/i);
    expect(NAV).toMatch(/password for email accounts/i);
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

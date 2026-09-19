/**
 * ONE ACCOUNT AT A TIME — the account switcher is gone, and this is what keeps it gone.
 *
 * ## What the admin saw, and why they were right
 *
 * Admin, 2026-09-19, looking at the sign-in screen that a "switch" had just dropped them on:
 *
 *   *"1 tab swich kam nahi kar raha hai. isko hata do! pura multiple account login wala system hata
 *   do … jab account switch ke samay login hi karna padega har baar to fayda hi kya hua, switching
 *   ka! ek account login hi rahne do."*
 *
 * That is not a bug report about a broken button. It is the correct reading of what the feature
 * actually was. `accountRoster.ts` said so in its own header, in writing, from the day it shipped:
 *
 *   *"the Firebase SDK holds ONE live session per app instance. So switching re-authenticates with
 *   the provider rather than keeping five sessions live in parallel … it is a FAST SWITCH, not five
 *   simultaneous logins."*
 *
 * So the menu said **"Switch account"** — Google's and Instagram's words for a mechanism that really
 * does hold several sessions at once — over a mechanism that signs you out of the idea and asks the
 * provider again. The honesty layers piled up around that gap rather than closing it: a banner on the
 * sign-in screen explaining that you were switching, a `login_hint` so the chooser landed on the right
 * row, a per-row `title` admitting "this signs you in again", and a 2026-09-12 edit moving that
 * admission off the screen because it *"bina bat ke jagah kha raha hai"*. Four repairs to the wording
 * of a promise the code could not keep.
 *
 * ## The honest part, stated rather than buried
 *
 * Real parallel sessions ARE buildable — several named Firebase app instances, each with its own
 * persistence — and that is roughly what the apps the admin named do. It was never attempted here.
 * What existed was the metadata half, and the metadata half on its own has no user-visible value: the
 * work it saves is typing an email address, and the work it costs is a screen that looks like the
 * switch failed. Removing it is right whether or not the full thing is ever built, because a feature
 * that makes people think they are logged out is worse than no feature.
 *
 * ## What this test locks
 *
 * 1. The roster module and its UI are gone — by FILE and by symbol, so a future reader cannot revive
 *    half of it.
 * 2. Google sign-in still asks which account (`prompt: 'select_account'`) — the one behaviour that
 *    had to survive, because without the hint a chooser that auto-picks would sign people back into
 *    the account they are trying to leave.
 * 3. The stored roster is DELETED from the devices that have one. This is the part a "just delete the
 *    code" change would miss: `nbai:accounts` is a list of everyone who ever signed in on that phone,
 *    and with no switcher left there would be no screen on earth that could clear it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const TOP_NAV = 'src/components/panels/TopNav.tsx';
const AUTH = 'src/components/AuthComponent.tsx';
const APP = 'src/App.tsx';

/** Strip comments, so the prose ABOVE (which must keep naming the removed thing) never trips a check
 *  meant for live code. This file's whole value is that the history stays readable. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('the account roster is gone, module and all', () => {
  it('the module and its test no longer exist', () => {
    expect(existsSync(resolve(root, 'src/lib/accountRoster.ts'))).toBe(false);
    expect(existsSync(resolve(root, 'src/lib/accountRoster.test.ts'))).toBe(false);
  });

  it('nothing in the app imports it — the sweep, so a half-revival fails too', () => {
    for (const f of [TOP_NAV, AUTH, APP]) {
      expect(code(read(f)), `${f} still reaches for the roster`).not.toMatch(/accountRoster/);
    }
  });

  it('its symbols appear in no live code', () => {
    // Named individually because a partial restore — say, just the hint keys "for the chooser" — is
    // the likely way this comes back, and it would pass a check that only looked for the module path.
    const gone = [
      'readRoster', 'writeRoster', 'rememberAccount', 'forgetAccount', 'switchTargets',
      'accountRows', 'canAddAccount', 'addAccountLabel', 'switchBannerText',
      'googleNativeCustomParameters', 'SIGN_IN_HINT_KEY', 'SIGN_IN_PROVIDER_KEY',
      'SWITCH_ACCOUNT_LABEL', 'MAX_ACCOUNTS',
    ];
    for (const f of [TOP_NAV, AUTH, APP]) {
      const src = code(read(f));
      for (const symbol of gone) {
        expect(src, `${f} still uses ${symbol}`).not.toMatch(new RegExp(`\\b${symbol}\\b`));
      }
    }
  });
});

describe('the avatar menu offers no switch', () => {
  const nav = code(read(TOP_NAV));

  it('no "Switch account" list and no "Add another account" button', () => {
    expect(nav).not.toMatch(/Switch account/i);
    expect(nav).not.toMatch(/Add another account/i);
    expect(nav).not.toMatch(/\bswitchTo\b/);
  });

  it('but the menu still does its real jobs — profile, settings, sign out', () => {
    // A removal that took the whole dropdown with it would pass every assertion above and leave the
    // user with no way to sign out at all.
    expect(nav).toMatch(/onOpenProfile/);
    expect(nav).toMatch(/onOpenSettings/);
    expect(nav).toMatch(/handleLogout/);
  });
});

describe("Google's chooser still asks which account", () => {
  const auth = code(read(AUTH));

  it("the sign-in button sends prompt: 'select_account' and nothing else", () => {
    // This is the behaviour the switcher's hint used to override. Without a hint, `select_account` is
    // what stops Google silently reusing the single live session — i.e. signing someone back into the
    // very account they opened this screen to leave.
    expect(auth).toMatch(/provider\.setCustomParameters\(\{ prompt: 'select_account' \}\)/);
  });

  it('no login_hint is ever read from storage', () => {
    // ⚠️ Deliberately NOT "the file contains no login_hint". Two unrelated, correct uses remain and
    // must not be swept up with the switcher: GitHub's native `allow_signup` parameter, and the
    // account-LINKING flow, which hints the email out of the pending credential in hand so a user
    // proving they own that address is not made to pick it from a list. Neither touches stored
    // accounts. What must never return is a hint that comes from a REMEMBERED account.
    expect(auth).not.toMatch(/login_hint: signInHint/);
    expect(auth).not.toMatch(/getItem\(\s*['"]nbai:sign-in/);
  });

  it('the native Google sheet is opened with no parameters at all', () => {
    expect(auth).toMatch(/signInWithGoogle\(\)/);
    expect(auth).not.toMatch(/signInWithGoogle\(\s*(?!\))/);
  });
});

describe('a device that already has a roster gets it deleted', () => {
  const app = code(read(APP));

  it('all three stored keys are removed on a signed-in load', () => {
    for (const key of ['nbai:accounts', 'nbai:sign-in-hint', 'nbai:sign-in-provider']) {
      expect(app, `${key} is never cleaned up`).toContain(key);
    }
    expect(app).toMatch(/localStorage\.removeItem\(k\)/);
  });

  it('the cleanup cannot break signing in', () => {
    // Storage can throw outright in private mode. A sign-in must never fail because of housekeeping,
    // which is the same rule the roster write it replaces already obeyed.
    const at = app.indexOf("'nbai:accounts'");
    expect(at).toBeGreaterThan(-1);
    const around = app.slice(Math.max(0, at - 400), at + 400);
    expect(around).toMatch(/try\s*\{/);
    expect(around).toMatch(/catch/);
  });
});

describe('what a user is told', () => {
  it('the knowledge base describes one account, not a switcher', () => {
    const kb = read('src/server/AppContext/AppKnowledgeBase.ts');
    expect(kb).toMatch(/ONE ACCOUNT AT A TIME \(2026-09-19\)/);
    expect(kb).not.toMatch(/SWITCH BETWEEN YOUR ACCOUNTS/);
    // Every AI in the app answers "where do I switch accounts?" from this file. Leaving the old entry
    // would have them give directions to a menu that no longer exists — worse than saying nothing.
    expect(kb).toMatch(/Sign Out and sign in with it/);
  });
});

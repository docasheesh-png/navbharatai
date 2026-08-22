import { describe, it, expect } from 'vitest';
import {
  readRoster, writeRoster, rememberAccount, forgetAccount, switchTargets,
  canAddAccount, addAccountLabel, accountLabel, accountInitial, MAX_ACCOUNTS,
  type RosterAccount, type RosterStore,
  switchRequiresSignOutFirst, SIGN_IN_HINT_KEY, SWITCH_ACCOUNT_LABEL, accountRows,
} from './accountRoster';

/**
 * ADMIN, 2026-08-22: "user apne photo/logo par click kar ke switch profile kare, wapas login kar le,
 * ek saath 5 id login ho sake" — the pattern from Google, Instagram, WhatsApp.
 *
 * 🔒 The roster holds METADATA ONLY. A refresh token in localStorage is a permanent account takeover
 * for anyone who reaches that storage, and skipping one tap is nowhere near worth it. These tests pin
 * that boundary along with the ordering and eviction rules.
 */
const acct = (over: Partial<RosterAccount> = {}): RosterAccount => ({
  uid: 'u1', email: 'a@x.com', name: 'Asha', photo: '', provider: 'google.com', lastUsed: 1000, ...over,
});

const store = (initial: Record<string, string> = {}): RosterStore & { data: Record<string, string> } => ({
  data: { ...initial },
  getItem(k) { return this.data[k] ?? null; },
  setItem(k, v) { this.data[k] = v; },
  removeItem(k) { delete this.data[k]; },
});

describe('rememberAccount', () => {
  it('adds a new account, newest-used first', () => {
    const r = rememberAccount([acct({ uid: 'u1', lastUsed: 100 })], acct({ uid: 'u2', lastUsed: 200 }));
    expect(r.map((a) => a.uid)).toEqual(['u2', 'u1']);
  });

  it('🔒 re-signing in UPDATES the same row — matched on uid, never email', () => {
    // One person can hold the same email across providers, and two rows for one human is exactly the
    // confusion a switcher exists to remove.
    const r = rememberAccount(
      [acct({ uid: 'u1', email: 'same@x.com', provider: 'google.com', lastUsed: 100 })],
      acct({ uid: 'u1', email: 'same@x.com', provider: 'apple.com', lastUsed: 500 }),
    );
    expect(r).toHaveLength(1);
    expect(r[0].provider).toBe('apple.com');
  });

  it('two different people sharing an email stay two rows', () => {
    const r = rememberAccount([acct({ uid: 'u1', email: 'same@x.com' })], acct({ uid: 'u2', email: 'same@x.com', lastUsed: 2000 }));
    expect(r).toHaveLength(2);
  });

  it(`🔒 at ${MAX_ACCOUNTS}, the LEAST-recently-used is dropped — never the one being added`, () => {
    // Evicting the account someone is signing into would make the feature look broken at the exact
    // moment it is used.
    const full = Array.from({ length: MAX_ACCOUNTS }, (_, i) => acct({ uid: `u${i}`, lastUsed: 100 + i }));
    const r = rememberAccount(full, acct({ uid: 'new', lastUsed: 9999 }));
    expect(r).toHaveLength(MAX_ACCOUNTS);
    expect(r[0].uid).toBe('new');
    expect(r.some((a) => a.uid === 'u0')).toBe(false);   // the oldest went
  });

  it('an account with no uid is not an account', () => {
    expect(rememberAccount([], acct({ uid: '  ' }))).toEqual([]);
  });
});

describe('readRoster / writeRoster', () => {
  it('round-trips and keeps newest-used first', () => {
    const s = store();
    writeRoster(s, [acct({ uid: 'u1', lastUsed: 1 }), acct({ uid: 'u2', lastUsed: 9 })]);
    expect(readRoster(s).map((a) => a.uid)).toEqual(['u2', 'u1']);
  });

  it('corrupt, absent or missing storage reads as empty and never throws', () => {
    expect(readRoster(store({ 'nbai:accounts': 'not json' }))).toEqual([]);
    expect(readRoster(store({ 'nbai:accounts': '{"not":"an array"}' }))).toEqual([]);
    expect(readRoster(store())).toEqual([]);
    expect(readRoster(null)).toEqual([]);
    expect(() => writeRoster(null, [acct()])).not.toThrow();
  });

  it('drops junk rows instead of rendering them', () => {
    const s = store({ 'nbai:accounts': JSON.stringify([{ email: 'no-uid@x.com' }, acct({ uid: 'ok' })]) });
    expect(readRoster(s).map((a) => a.uid)).toEqual(['ok']);
  });

  it(`never returns more than ${MAX_ACCOUNTS}, even if storage was hand-edited`, () => {
    const many = Array.from({ length: 12 }, (_, i) => acct({ uid: `u${i}`, lastUsed: i }));
    expect(readRoster(store({ 'nbai:accounts': JSON.stringify(many) }))).toHaveLength(MAX_ACCOUNTS);
  });
});

describe('forgetAccount', () => {
  it('removes just that one', () => {
    const r = forgetAccount([acct({ uid: 'u1' }), acct({ uid: 'u2' })], 'u1');
    expect(r.map((a) => a.uid)).toEqual(['u2']);
  });

  it('an unknown uid changes nothing', () => {
    expect(forgetAccount([acct({ uid: 'u1' })], 'nope')).toHaveLength(1);
  });
});

describe('switchTargets — you cannot switch to who you already are', () => {
  it('excludes the current account', () => {
    const r = switchTargets([acct({ uid: 'u1' }), acct({ uid: 'u2' })], 'u1');
    expect(r.map((a) => a.uid)).toEqual(['u2']);
  });

  it('signed out ⇒ every remembered account is a target', () => {
    expect(switchTargets([acct({ uid: 'u1' }), acct({ uid: 'u2' })], null)).toHaveLength(2);
  });
});

describe('the labels', () => {
  it('explains the cap instead of showing a dead disabled button', () => {
    const full = Array.from({ length: MAX_ACCOUNTS }, (_, i) => acct({ uid: `u${i}` }));
    expect(canAddAccount(full)).toBe(false);
    expect(addAccountLabel(full)).toContain('remove one');
    // Shortened to "Add account" (admin 2026-08-22) — it now sits at the BOTTOM of a list of accounts
    // under a "Switch account" heading, so "another" is already implied by everything above it.
    expect(addAccountLabel([acct()])).toBe('Add account');
  });

  it('falls back from name to email, and never renders an empty row', () => {
    expect(accountLabel(acct({ name: 'Asha' }))).toBe('Asha');
    expect(accountLabel(acct({ name: '', email: 'a@x.com' }))).toBe('a@x.com');
    expect(accountLabel(acct({ name: '', email: '' }))).toBe('Signed-in account');
  });

  it('gives an initial for an account with no photo', () => {
    expect(accountInitial(acct({ name: 'asha' }))).toBe('A');
    expect(accountInitial(acct({ name: '', email: 'zed@x.com' }))).toBe('Z');
    expect(accountInitial(acct({ name: '', email: '' }))).toBe('?');
  });
});

describe('🔒 the security boundary', () => {
  it('a stored row carries NO token field, whatever was passed in', () => {
    // The one rule that matters most here: this list remembers who you are, it does not hold the keys.
    const s = store();
    writeRoster(s, [rememberAccount([], { ...acct(), accessToken: 'secret', refreshToken: 'secret' } as never)[0]]);
    const raw = s.data['nbai:accounts'];
    expect(raw).not.toContain('secret');
    expect(raw).not.toContain('Token');
  });
});

/**
 * THE ACCOUNT MENU (admin 2026-08-22), and the bug that mattered:
 *
 *   "add account click kare aur koi bhi other account login nahi kare to logout ho ja raha hai"
 *
 * Both controls used to call performSignOut() and reload onto the sign-in screen — so pressing
 * "Add account" logged you out immediately, and changing your mind cost you your session for pressing
 * a button that promised to ADD one. A cancelled action must cost nothing.
 */
describe('signing in as another account never costs you this one', () => {
  it('THE BUG: switching never requires signing out first', () => {
    // Firebase can sign a new user in while one is active: success replaces the current user, cancel
    // changes nothing. So there is nothing to sign out of, and nothing to restore on cancel.
    expect(switchRequiresSignOutFirst()).toBe(false);
  });

  it('the sign-in hint has ONE shared name — the old one was written and never read', () => {
    expect(SIGN_IN_HINT_KEY).toBe('nbai:sign-in-hint');
    expect(SIGN_IN_HINT_KEY).not.toBe('nbai:switch-to');
  });
});

describe('accountRows — a list of ACCOUNTS, not a list of alternatives', () => {
  const me = { uid: 'u1', email: 'me@x.com', name: 'Me', photo: '', provider: 'google', lastUsed: 2 };
  const other = { uid: 'u2', email: 'other@x.com', name: 'Other', photo: '', provider: 'google', lastUsed: 1 };

  it('puts the CURRENT account first and marks it', () => {
    const rows = accountRows([other, me], 'u1');
    expect(rows.map((r) => r.uid)).toEqual(['u1', 'u2']);
    expect(rows[0].isCurrent).toBe(true);
    expect(rows[1].isCurrent).toBe(false);
  });

  it('THE UX BUG: a lone account still produces a list, so the menu is not add-only', () => {
    // The old list rendered only the OTHERS and hid itself when there were none, which is exactly why
    // a one-account user saw nothing but "Add another account".
    const rows = accountRows([me], 'u1');
    expect(rows).toHaveLength(1);
    expect(rows[0].isCurrent).toBe(true);
  });

  it('builds the current row from the live user when the roster has not recorded them yet', () => {
    // First load, or a cleared roster. The list must never be missing the person using it.
    const rows = accountRows([other], 'u9', { uid: 'u9', email: 'new@x.com', displayName: 'New', photoURL: 'p.png' });
    expect(rows[0]).toMatchObject({ uid: 'u9', email: 'new@x.com', name: 'New', photo: 'p.png', isCurrent: true });
    expect(rows).toHaveLength(2);
  });

  it('exactly one row is ever marked current', () => {
    for (const [r, uid] of [[[me, other], 'u1'], [[me, other], 'u2'], [[me, other], 'nobody']] as const) {
      expect(accountRows(r, uid).filter((x) => x.isCurrent).length).toBeLessThanOrEqual(1);
    }
  });

  it('is safe with an empty roster and a missing uid', () => {
    expect(accountRows([], null)).toEqual([]);
    expect(accountRows([], 'u1')).toEqual([]);
    expect(accountRows([me], null)).toEqual([{ ...me, isCurrent: false }]);
  });
});

describe('the menu says what it is', () => {
  it('is called Switch account, not Add another account', () => {
    expect(SWITCH_ACCOUNT_LABEL).toBe('Switch account');
  });

  it('the add control is the short form, since it sits under a list of accounts', () => {
    expect(addAccountLabel([])).toBe('Add account');
  });

  it('at the cap it still explains the limit rather than going silently dead', () => {
    const full = Array.from({ length: 5 }, (_, i) => ({ uid: `u${i}`, email: '', name: '', photo: '', provider: '', lastUsed: 0 }));
    expect(addAccountLabel(full)).toMatch(/remove one/i);
  });
});

import { describe, it, expect } from 'vitest';
import {
  readRoster, writeRoster, rememberAccount, forgetAccount, switchTargets,
  canAddAccount, addAccountLabel, accountLabel, accountInitial, MAX_ACCOUNTS,
  type RosterAccount, type RosterStore,
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
    expect(addAccountLabel([acct()])).toBe('Add another account');
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

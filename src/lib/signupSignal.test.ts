import { describe, it, expect } from 'vitest';
import { isNewAccount, decideSignupReport } from './signupSignal';
import { parseReported } from './conversionOnce';

const T0 = 'Mon, 31 Aug 2026 10:00:00 GMT';
const T0_PLUS_2S = 'Mon, 31 Aug 2026 10:00:02 GMT';
const T0_PLUS_1H = 'Mon, 31 Aug 2026 11:00:00 GMT';

describe('isNewAccount — the account was created at this very sign-in', () => {
  it('is true when creation and last-sign-in are the same moment', () => {
    expect(isNewAccount(T0, T0)).toBe(true);
  });

  it('tolerates the small gap Firebase leaves between the two writes', () => {
    expect(isNewAccount(T0, T0_PLUS_2S)).toBe(true);
  });

  it('is FALSE for a returning user signing in later', () => {
    expect(isNewAccount(T0, T0_PLUS_1H)).toBe(false);
  });

  it('is FALSE when a stamp is missing or unparseable — a guess would corrupt the signal', () => {
    expect(isNewAccount(undefined, undefined)).toBe(false);
    expect(isNewAccount(T0, undefined)).toBe(false);
    expect(isNewAccount('not a date', 'not a date')).toBe(false);
    expect(isNewAccount('', '')).toBe(false);
  });
});

describe('parseReported — tolerates anything already in storage', () => {
  it('reads a valid list', () => {
    expect(parseReported('["a","b"]')).toEqual(['a', 'b']);
  });

  it('returns empty for absent, corrupt or wrongly-shaped values', () => {
    expect(parseReported(null)).toEqual([]);
    expect(parseReported('')).toEqual([]);
    expect(parseReported('{oops')).toEqual([]);
    expect(parseReported('"a string"')).toEqual([]);
    expect(parseReported('[1,2,null]')).toEqual([]);
  });
});

describe('decideSignupReport — reports once per account, never on a reload', () => {
  it('reports the first time a brand-new account is seen', () => {
    const d = decideSignupReport(null, 'uid-1', true);
    expect(d.report).toBe(true);
    expect(parseReported(d.nextStored)).toEqual(['uid-1']);
  });

  it('does NOT report the same account again — onAuthStateChanged fires on every page load', () => {
    const first = decideSignupReport(null, 'uid-1', true);
    const second = decideSignupReport(first.nextStored, 'uid-1', true);
    expect(second.report).toBe(false);
    expect(second.nextStored).toBeNull();
  });

  it('does not report a returning user', () => {
    expect(decideSignupReport(null, 'uid-1', false).report).toBe(false);
  });

  it('does not report without a uid', () => {
    expect(decideSignupReport(null, '', true).report).toBe(false);
  });

  it('still reports a DIFFERENT new account on a shared device', () => {
    const first = decideSignupReport(null, 'uid-1', true);
    expect(decideSignupReport(first.nextStored, 'uid-2', true).report).toBe(true);
  });

  it('caps what it remembers — this is a dedupe guard, not a history', () => {
    let stored: string | null = null;
    for (const uid of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
      const d = decideSignupReport(stored, uid, true);
      if (d.nextStored) stored = d.nextStored;
    }
    expect(parseReported(stored).length).toBe(5);
    expect(parseReported(stored)[0]).toBe('g'); // most recent kept
  });
});

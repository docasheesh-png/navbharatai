import { describe, it, expect } from 'vitest';
import { banStatusFromWallet, readBanStatus, suspendedMessage } from './banGate';

describe('banStatusFromWallet', () => {
  it('flags a banned wallet with reason + timestamp', () => {
    const s = banStatusFromWallet({ banned: true, banReason: 'payment fraud', bannedAt: '2026-07-14T00:00:00Z' });
    expect(s).toEqual({ banned: true, reason: 'payment fraud', bannedAt: '2026-07-14T00:00:00Z' });
  });

  it('treats an unbanned / empty / missing doc as not banned', () => {
    expect(banStatusFromWallet({ banned: false })).toEqual({ banned: false });
    expect(banStatusFromWallet({})).toEqual({ banned: false });
    expect(banStatusFromWallet(null)).toEqual({ banned: false });
    expect(banStatusFromWallet(undefined)).toEqual({ banned: false });
  });

  it('requires a STRICT boolean true — a truthy string must never suspend an account', () => {
    expect(banStatusFromWallet({ banned: 'true' }).banned).toBe(false);
    expect(banStatusFromWallet({ banned: 1 }).banned).toBe(false);
  });

  it('omits an empty reason string', () => {
    expect(banStatusFromWallet({ banned: true, banReason: '' })).toEqual({ banned: true });
  });
});

describe('readBanStatus (fail-open)', () => {
  it('returns banned when the reader yields a banned doc', async () => {
    const read = async () => ({ banned: true, banReason: 'abuse' });
    expect(await readBanStatus(read, 'u1')).toEqual({ banned: true, reason: 'abuse' });
  });

  it('returns not-banned for a null doc', async () => {
    expect(await readBanStatus(async () => null, 'u1')).toEqual({ banned: false });
  });

  it('FAILS OPEN — a reader throw resolves to not-banned (never locks everyone out)', async () => {
    const read = async () => { throw new Error('firestore down'); };
    expect(await readBanStatus(read, 'u1')).toEqual({ banned: false });
  });

  it('short-circuits for anon / empty userId without calling the reader', async () => {
    let called = 0;
    const read = async () => { called++; return { banned: true }; };
    expect(await readBanStatus(read, 'anon')).toEqual({ banned: false });
    expect(await readBanStatus(read, '')).toEqual({ banned: false });
    expect(await readBanStatus(read, null)).toEqual({ banned: false });
    expect(called).toBe(0);
  });
});

describe('suspendedMessage', () => {
  it('includes the admin reason when present', () => {
    expect(suspendedMessage({ banned: true, reason: 'chargeback fraud' })).toContain('Reason: chargeback fraud.');
  });
  it('is honest and support-directed without a reason', () => {
    const m = suspendedMessage({ banned: true });
    expect(m).toContain('suspended by an administrator');
    expect(m).not.toContain('Reason:');
  });
});

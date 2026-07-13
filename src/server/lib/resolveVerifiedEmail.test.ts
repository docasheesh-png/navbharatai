import { describe, it, expect } from 'vitest';
import { resolveVerifiedEmailWith, type UserLookupAuth } from './authMiddleware';

// FREE-LIST EXEMPTION HARDENING (deep-test 2026-07-13 — the admin's -1,22,330-token wallet). When a
// verified ID token omits the email claim, the account email is resolved from the VERIFIED uid so
// free-list-by-email exemption still holds. These lock the best-effort resolution contract.
describe('resolveVerifiedEmailWith', () => {
  const authWith = (email: unknown): (() => Promise<UserLookupAuth | null>) =>
    async () => ({ getUser: async () => ({ email: email as string | null | undefined }) });

  it('returns the account email when the admin SDK resolves it (the token-lacked-email case)', async () => {
    expect(await resolveVerifiedEmailWith('uid-1', authWith('aashishcpmt09@gmail.com'))).toBe('aashishcpmt09@gmail.com');
  });

  it('returns null for an empty uid (never looks up)', async () => {
    let called = false;
    const auth = async () => { called = true; return { getUser: async () => ({ email: 'x@y.com' }) }; };
    expect(await resolveVerifiedEmailWith('', auth)).toBeNull();
    expect(called).toBe(false);
  });

  it('returns null when the auth provider is unavailable (admin SDK cold-start)', async () => {
    expect(await resolveVerifiedEmailWith('uid-1', async () => null)).toBeNull();
  });

  it('returns null when the user record has no email', async () => {
    expect(await resolveVerifiedEmailWith('uid-1', authWith(null))).toBeNull();
    expect(await resolveVerifiedEmailWith('uid-1', authWith(undefined))).toBeNull();
    expect(await resolveVerifiedEmailWith('uid-1', authWith(''))).toBeNull();
  });

  it('returns null (never throws) when the lookup rejects', async () => {
    const auth = async () => ({ getUser: async () => { throw new Error('user not found'); } });
    await expect(resolveVerifiedEmailWith('uid-1', auth)).resolves.toBeNull();
  });
});

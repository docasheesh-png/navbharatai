import { describe, expect, it, vi, afterEach } from 'vitest';
import { adminBusyDetail, withAdminBusyDetail } from './adminBusyDetail';
import type { FreeChainContext } from './rollout';

const adminCtx = (): FreeChainContext => ({
  uid: 'admin-uid', conversationKey: 'k', privateTurn: false, healthTurn: false, cacheEligible: true, isAdmin: true,
});
const userCtx = (): FreeChainContext => ({
  uid: 'user-uid', conversationKey: 'k', privateTurn: false, healthTurn: false, cacheEligible: true,
});

afterEach(() => vi.unstubAllEnvs());

describe('adminBusyDetail', () => {
  it('returns nothing for ordinary users', () => {
    expect(adminBusyDetail({
      context: userCtx(),
      earlyReason: 'cheapinf-key-missing-or-invalid',
      env: { CHEAPERINFERENCE: 'admin' },
    })).toBeUndefined();
  });

  it('shows mode, keyConfigured and early reason for admins without leaking secrets', () => {
    const detail = adminBusyDetail({
      context: adminCtx(),
      earlyReason: 'cheapinf-key-missing-or-invalid',
      attempts: [{ provider: 'cheapinf', reason: 'auth:http=401' }],
      env: {
        CHEAPERINFERENCE: 'admin',
        CHEAPERINFERENCE_API_KEY: 'ci_live_SHOULD_NOT_APPEAR',
        CHEAPERINFERENCE_MODEL: 'beam',
      },
    })!;
    expect(detail).toContain('CHEAPERINFERENCE=admin');
    expect(detail).toContain('keyConfigured=yes');
    expect(detail).toContain('model=beam');
    expect(detail).toContain('early=cheapinf-key-missing-or-invalid');
    expect(detail).toContain('cheapinf:auth:http=401');
    expect(detail).not.toContain('SHOULD_NOT_APPEAR');
    expect(detail).not.toContain('ci_live_SHOULD');
  });

  it('includes waitMs and ttftCapMs for timeout diagnosis', () => {
    const detail = adminBusyDetail({
      context: adminCtx(),
      earlyReason: 'all-failed',
      attempts: [{ provider: 'cheapinf', reason: 'timeout:first-token:60000ms' }],
      waitMs: 60123,
      ttftCapMs: 60000,
      env: { CHEAPERINFERENCE: 'admin', CHEAPERINFERENCE_API_KEY: 'ci_live_x', CHEAPERINFERENCE_MODEL: 'beam' },
    })!;
    expect(detail).toContain('waitMs=60123');
    expect(detail).toContain('ttftCapMs=60000');
    expect(detail).toContain('timeout:first-token:60000ms');
  });

  it('redacts a key that somehow lands in the detail string', () => {
    const wrapped = withAdminBusyDetail('busy', 'leak ci_live_abcdefg123 and Bearer tokensecret');
    expect(wrapped).toContain('[admin diagnostic]');
    expect(wrapped).toContain('ci_live_[REDACTED]');
    expect(wrapped).toContain('Bearer [REDACTED]');
    expect(wrapped).not.toContain('abcdefg123');
    expect(wrapped).not.toContain('tokensecret');
  });
});

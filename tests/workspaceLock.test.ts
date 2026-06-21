import { describe, it, expect, beforeEach } from 'vitest';
import { workspaceLock } from '../src/server/project/WorkspaceLock';

// WorkspaceLock uses Firestore which is VITEST-skipped — returns fail-open
// (acquired:true) in test mode. These tests verify the public API contract,
// not Firestore-level atomicity (which is tested in integration tests).

describe('workspaceLock (VITEST-skip / fail-open mode)', () => {
  it('returns acquired:true in test environment (fail-open)', async () => {
    const result = await workspaceLock.tryAcquire('test-workspace');
    expect(result.acquired).toBe(true);
    expect(result.lockId).toBeDefined();
  });

  it('returns a lockId on successful acquire', async () => {
    const result = await workspaceLock.tryAcquire('ws-123');
    expect(result.acquired).toBe(true);
    expect(typeof result.lockId).toBe('string');
    expect(result.lockId!.length).toBeGreaterThan(0);
  });

  it('release does not throw when no Firestore available', async () => {
    // Should never throw — release is best-effort
    await expect(workspaceLock.release('ws-123', 'some-lock-id')).resolves.toBeUndefined();
  });

  it('acquire with empty workspaceId returns acquired:true (safe noop)', async () => {
    const result = await workspaceLock.tryAcquire('');
    expect(result.acquired).toBe(true);
  });

  it('release with empty workspaceId does not throw', async () => {
    await expect(workspaceLock.release('', 'lock')).resolves.toBeUndefined();
  });
});

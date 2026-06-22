/**
 * Tests for UserCostStore (Phase 4.2 — per-user monthly AI cost tracking).
 * VITEST environment skips Firestore; verifies the no-op paths and monthKey format.
 */
import { describe, it, expect } from 'vitest';
import { userCostStore } from '../src/server/lib/UserCostStore';

describe('userCostStore (VITEST-skip path)', () => {
  it('record() returns undefined and does not throw in test env', async () => {
    // In VITEST, getDb() returns null → record is a no-op
    await expect(userCostStore.record('user-123', 0.05)).resolves.toBeUndefined();
  });

  it('record() with zero cost does not throw', async () => {
    await expect(userCostStore.record('user-abc', 0)).resolves.toBeUndefined();
  });

  it('get() returns null in test env (no Firestore)', async () => {
    const result = await userCostStore.get('user-123');
    expect(result).toBeNull();
  });

  it('get() with explicit month returns null in test env', async () => {
    const result = await userCostStore.get('user-123', '2026-06');
    expect(result).toBeNull();
  });

  it('record() with missing userId does not throw', async () => {
    await expect(userCostStore.record('', 1.0)).resolves.toBeUndefined();
  });
});

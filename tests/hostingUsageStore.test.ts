import { describe, it, expect } from 'vitest';
import { hostingUsageStore } from '../src/server/lib/HostingUsageStore';

// Under VITEST the store's getDb() returns null (mirrors UserCostStore) — so every method is a
// best-effort no-op that must NEVER throw. These lock that contract: the quota layer can call the
// store freely in tests/CI and it can never break a deploy.
describe('HostingUsageStore — best-effort, VITEST-skipped', () => {
  it('recordDeploy never throws (no Firestore in tests)', async () => {
    await expect(hostingUsageStore.recordDeploy('u1')).resolves.toBeUndefined();
  });

  it('recordDeploy is a no-op for a missing userId', async () => {
    await expect(hostingUsageStore.recordDeploy(null)).resolves.toBeUndefined();
    await expect(hostingUsageStore.recordDeploy(undefined)).resolves.toBeUndefined();
  });

  it('get returns null under VITEST (never throws)', async () => {
    await expect(hostingUsageStore.get('u1')).resolves.toBeNull();
    await expect(hostingUsageStore.get('u1', '2026-07')).resolves.toBeNull();
  });
});

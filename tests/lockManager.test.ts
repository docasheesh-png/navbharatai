import { describe, it, expect } from 'vitest';
import { LockManager } from '../src/server/AppMakerLab/mutation/LockManager';

describe('LockManager', () => {
  it('acquires a lock successfully when not held', async () => {
    const mgr = new LockManager();
    await expect(mgr.acquire('ws-1')).resolves.not.toThrow();
  });

  it('throws when acquiring a lock that is already held', async () => {
    const mgr = new LockManager();
    await mgr.acquire('ws-1');
    await expect(mgr.acquire('ws-1')).rejects.toThrow('Lock already held');
  });

  it('allows re-acquiring after release', async () => {
    const mgr = new LockManager();
    await mgr.acquire('ws-1');
    await mgr.release('ws-1');
    await expect(mgr.acquire('ws-1')).resolves.not.toThrow();
  });

  it('manages separate locks for different workspace ids', async () => {
    const mgr = new LockManager();
    await mgr.acquire('ws-1');
    await expect(mgr.acquire('ws-2')).resolves.not.toThrow();
  });

  it('release is idempotent (releasing non-held lock does not throw)', async () => {
    const mgr = new LockManager();
    await expect(mgr.release('ws-1')).resolves.not.toThrow();
  });
});

import { describe, it, expect } from 'vitest';
import { LockManager } from '../src/server/AppMakerLab/mutation/LockManager';

describe('LockManager', () => {
  it('acquire() resolves for an un-held workspace', async () => {
    const lm = new LockManager();
    await expect(lm.acquire('ws-1')).resolves.toBeUndefined();
  });

  it('acquire() throws when the lock is already held', async () => {
    const lm = new LockManager();
    await lm.acquire('ws-1');
    await expect(lm.acquire('ws-1')).rejects.toThrow('Lock already held');
  });

  it('release() allows re-acquisition after release', async () => {
    const lm = new LockManager();
    await lm.acquire('ws-1');
    await lm.release('ws-1');
    await expect(lm.acquire('ws-1')).resolves.toBeUndefined();
  });

  it('different workspace IDs are independent locks', async () => {
    const lm = new LockManager();
    await lm.acquire('ws-a');
    await expect(lm.acquire('ws-b')).resolves.toBeUndefined();
  });

  it('release() on an unlocked workspace does not throw', async () => {
    const lm = new LockManager();
    await expect(lm.release('never-acquired')).resolves.toBeUndefined();
  });
});

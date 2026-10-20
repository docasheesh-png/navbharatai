import { describe, it, expect, vi } from 'vitest';
import type * as admin from 'firebase-admin';
import { SandboxStore } from './SandboxStore';

const WS = 'agentv3-owner-session';

function storeWith(read: () => Promise<unknown>) {
  const get = vi.fn(read);
  const doc = vi.fn(() => ({ get }));
  const collection = vi.fn(() => ({ doc }));
  const db = { collection } as unknown as admin.firestore.Firestore;
  return { store: new SandboxStore(() => db), collection, doc, get };
}

describe('recovery identity reads distinguish missing records from unavailable authority', () => {
  it('reads the exact workspace from the admin collection and trims its recorded id', async () => {
    const f = storeWith(async () => ({ exists: true, data: () => ({ sandboxId: ' old-machine\n' }) }));
    await expect(f.store.lookupRecoveryIdentity(WS)).resolves.toEqual({ state: 'found', sandboxId: 'old-machine' });
    expect(f.collection).toHaveBeenCalledExactlyOnceWith('agentv3_sandboxes');
    expect(f.doc).toHaveBeenCalledExactlyOnceWith(WS);
  });

  it('a successful missing document stays distinct from an outage', async () => {
    const f = storeWith(async () => ({ exists: false }));
    await expect(f.store.lookupRecoveryIdentity(WS)).resolves.toEqual({ state: 'missing' });
  });

  it.each([undefined, null, '', ' \n'])('metadata-only or blank id %j preserves the existing no-id behavior', async (sandboxId) => {
    const f = storeWith(async () => ({ exists: true, data: () => ({ snapshotUrl: 'https://saved.example/app', sandboxId }) }));
    await expect(f.store.lookupRecoveryIdentity(WS)).resolves.toEqual({ state: 'missing' });
  });

  it.each([13, false, {}, [], ['machine']])('a malformed identity %j never becomes permission to create', async (sandboxId) => {
    const f = storeWith(async () => ({ exists: true, data: () => ({ sandboxId }) }));
    await expect(f.store.lookupRecoveryIdentity(WS)).resolves.toEqual({ state: 'unavailable' });
  });

  it('a read rejection remains unavailable while the old observation API stays best-effort', async () => {
    const f = storeWith(async () => { throw new Error('network failure'); });
    await expect(f.store.lookupRecoveryIdentity(WS)).resolves.toEqual({ state: 'unavailable' });
    await expect(f.store.get(WS)).resolves.toBeNull();
  });

  it('missing setup and a failing provider both remain unavailable under the production decision', async () => {
    await expect(new SandboxStore(() => null).lookupRecoveryIdentity(WS)).resolves.toEqual({ state: 'unavailable' });
    await expect(new SandboxStore(() => { throw new Error('setup failed'); }).lookupRecoveryIdentity(WS)).resolves.toEqual({ state: 'unavailable' });
  });

  it('refuses an empty workspace without issuing a database read', async () => {
    const f = storeWith(async () => ({ exists: false }));
    await expect(f.store.lookupRecoveryIdentity('')).resolves.toEqual({ state: 'unavailable' });
    expect(f.collection).not.toHaveBeenCalled();
  });
});

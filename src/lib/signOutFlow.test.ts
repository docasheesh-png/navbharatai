import { describe, it, expect, vi } from 'vitest';
import { performSignOut, deleteFirebaseAuthDb, type SignOutFlowDeps } from './signOutFlow';

// THE bug (admin, 2026-07-11): after a recent logout, the next Google login on desktop "hota hi
// nahi" — the logout deleted Firebase's IndexedDB unawaited and reloaded mid-delete, corrupting the
// next load's persistence. The fix: only delete on a hung signOut, await it, and reload last.
describe('performSignOut — the DB is only nuked when signOut hangs, never on a clean sign-out', () => {
  function deps(over: Partial<SignOutFlowDeps> = {}): { d: SignOutFlowDeps; order: string[] } {
    const order: string[] = [];
    const d: SignOutFlowDeps = {
      signOut: () => { order.push('signOut'); return Promise.resolve(); },
      clearStorage: () => { order.push('clearStorage'); },
      deleteAuthDb: () => { order.push('deleteAuthDb'); return Promise.resolve(); },
      reload: () => { order.push('reload'); },
      ...over,
    };
    return { d, order };
  }

  it('CLEAN signOut: does NOT delete the IndexedDB (this is the fix — a clean signOut already clears persistence)', async () => {
    const { d, order } = deps();
    const res = await performSignOut(d);
    expect(res.deletedDb).toBe(false);
    expect(order).not.toContain('deleteAuthDb');
    expect(order).toContain('reload');
  });

  it('reload is ALWAYS the last step (teardown settles before the page reloads)', async () => {
    const { d, order } = deps();
    await performSignOut(d);
    expect(order[order.length - 1]).toBe('reload');
    expect(order.indexOf('clearStorage')).toBeLessThan(order.indexOf('reload'));
  });

  it('signOut REJECTS: falls back to the forced DB delete, awaited, then reload', async () => {
    const { d, order } = deps({ signOut: () => { order.push('signOut'); return Promise.reject(new Error('iframe gone')); } });
    const res = await performSignOut(d);
    expect(res.deletedDb).toBe(true);
    expect(order).toEqual(['signOut', 'clearStorage', 'deleteAuthDb', 'reload']);
  });

  it('signOut HANGS past the timeout: still tears down (delete + reload), never wedges the UI', async () => {
    vi.useFakeTimers();
    try {
      const order: string[] = [];
      const d: SignOutFlowDeps = {
        signOut: () => { order.push('signOut'); return new Promise<void>(() => { /* never resolves */ }); },
        clearStorage: () => { order.push('clearStorage'); },
        deleteAuthDb: () => { order.push('deleteAuthDb'); return Promise.resolve(); },
        reload: () => { order.push('reload'); },
        setTimeoutFn: setTimeout,
        signOutTimeoutMs: 2500,
      };
      const p = performSignOut(d);
      await vi.advanceTimersByTimeAsync(2600);
      const res = await p;
      expect(res.deletedDb).toBe(true);
      expect(order).toEqual(['signOut', 'clearStorage', 'deleteAuthDb', 'reload']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a throwing clearStorage/extraCleanup never blocks the reload (logout must always work)', async () => {
    const { d, order } = deps({
      clearStorage: () => { order.push('clearStorage'); throw new Error('storage blocked'); },
      extraCleanup: () => { order.push('extraCleanup'); throw new Error('gh clear failed'); },
    });
    await performSignOut(d);
    expect(order).toContain('reload');
  });

  it('extraCleanup runs on a clean sign-out (e.g. clearing the per-user GitHub token)', async () => {
    const extraCleanup = vi.fn();
    const { d } = deps({ extraCleanup });
    await performSignOut(d);
    expect(extraCleanup).toHaveBeenCalledOnce();
  });
});

describe('deleteFirebaseAuthDb — await-able and never hangs the logout', () => {
  function fakeReq(): IDBOpenDBRequest & { fire: (ev: 'success' | 'error' | 'blocked') => void } {
    const req: any = { onsuccess: null, onerror: null, onblocked: null };
    req.fire = (ev: 'success' | 'error' | 'blocked') => {
      if (ev === 'success') req.onsuccess?.();
      if (ev === 'error') req.onerror?.();
      if (ev === 'blocked') req.onblocked?.();
    };
    return req;
  }

  it('resolves on onsuccess', async () => {
    const req = fakeReq();
    const idb = { deleteDatabase: () => req };
    const p = deleteFirebaseAuthDb('db', { idb });
    req.fire('success');
    await expect(p).resolves.toBeUndefined();
  });

  it('resolves on onblocked too — a live SDK connection must NOT wedge sign-out', async () => {
    const req = fakeReq();
    const idb = { deleteDatabase: () => req };
    const p = deleteFirebaseAuthDb('db', { idb });
    req.fire('blocked');
    await expect(p).resolves.toBeUndefined();
  });

  it('resolves on onerror', async () => {
    const req = fakeReq();
    const idb = { deleteDatabase: () => req };
    const p = deleteFirebaseAuthDb('db', { idb });
    req.fire('error');
    await expect(p).resolves.toBeUndefined();
  });

  it('hard-caps on the timeout when the browser fires no event at all', async () => {
    vi.useFakeTimers();
    try {
      const idb = { deleteDatabase: () => fakeReq() }; // never fires
      const p = deleteFirebaseAuthDb('db', { idb, maxWaitMs: 1500, setTimeoutFn: setTimeout });
      await vi.advanceTimersByTimeAsync(1600);
      await expect(p).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('swallows a throwing indexedDB (private mode / unavailable) and resolves', async () => {
    const idb = { deleteDatabase: () => { throw new Error('no idb'); } };
    await expect(deleteFirebaseAuthDb('db', { idb })).resolves.toBeUndefined();
  });

  it('resolves immediately when there is no indexedDB at all', async () => {
    await expect(deleteFirebaseAuthDb('db', { idb: undefined })).resolves.toBeUndefined();
  });
});

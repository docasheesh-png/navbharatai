import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { performSignOut, deleteFirebaseAuthDb, defaultClearAuthStorage, type SignOutFlowDeps } from './signOutFlow';

// Minimal in-memory Storage stub for the node test env (no DOM). A Proxy over a plain object so
// Object.keys(localStorage) — which defaultClearAuthStorage relies on to sweep stale firebase:*
// keys — reflects the real stored keys, not just get/setItem.
function makeStorageStub(): Storage {
  const store: Record<string, string> = {};
  return new Proxy(store, {
    get(target, prop: string) {
      if (prop === 'getItem') return (k: string) => (k in target ? target[k] : null);
      if (prop === 'setItem') return (k: string, v: string) => { target[k] = String(v); };
      if (prop === 'removeItem') return (k: string) => { delete target[k]; };
      if (prop === 'clear') return () => { for (const k of Object.keys(target)) delete target[k]; };
      return (target as Record<string, unknown>)[prop];
    },
  }) as unknown as Storage;
}

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

// THE bug (admin, 2026-07-25: "mobile app open karo to login karna pad raha hai" — every cold
// app restart on BOTH iOS and Android forced the admin dashboard to show "Admin session expired —
// please log out and log in again"). Root cause: admin_token was written to sessionStorage, which
// is tied to the WebView's current top-level navigation and is GUARANTEED empty after a fresh
// launch — a full app kill + reopen is a brand-new navigation on every platform, every time.
// localStorage is disk-backed and survives a cold restart; the `isAdmin` flag was already there,
// but the token the dashboard actually authenticates with was not. Fixed at every call site.
describe('defaultClearAuthStorage — admin_token lives in localStorage (survives a cold app restart)', () => {
  it('clears admin_token from localStorage on sign-out', () => {
    vi.stubGlobal('localStorage', makeStorageStub());
    vi.stubGlobal('sessionStorage', makeStorageStub());
    localStorage.setItem('admin_token', 'tok-123');
    localStorage.setItem('navbharat_admin_v1', 'true');
    defaultClearAuthStorage();
    expect(localStorage.getItem('admin_token')).toBeNull();
    expect(localStorage.getItem('navbharat_admin_v1')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('also clears the stale sessionStorage key from before the migration (best-effort cleanup)', () => {
    vi.stubGlobal('localStorage', makeStorageStub());
    vi.stubGlobal('sessionStorage', makeStorageStub());
    sessionStorage.setItem('admin_token', 'stale-tok');
    defaultClearAuthStorage();
    expect(sessionStorage.getItem('admin_token')).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe('regression guard — admin_token is NEVER written to sessionStorage again', () => {
  // A grep-style source assertion (same pattern as tests/appKnowledgeBase.test.ts): every call site
  // that sets/reads the admin token must use localStorage. sessionStorage.setItem/getItem for
  // 'admin_token' is exactly the bug above — this fails loudly if the regression is reintroduced.
  const FILES = [
    '../App.tsx',
    '../components/AdminDashboard.tsx',
    '../components/panels/SettingsPanel.tsx',
  ];

  it.each(FILES)('%s never sets or reads admin_token via sessionStorage', (rel) => {
    const src = readFileSync(join(__dirname, rel), 'utf8');
    expect(src).not.toMatch(/sessionStorage\.(setItem|getItem)\(['"]admin_token['"]/);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { API_READ_CACHE, shouldClearApiReadCache } from './swCaches';

const h = vi.hoisted(() => ({
  native: { value: false },
  signOut: vi.fn(() => Promise.resolve()),
}));

vi.mock('firebase/app', () => ({ initializeApp: () => ({}) }));
vi.mock('firebase/firestore', () => ({ getFirestore: () => ({}) }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => h.native.value } }));
vi.mock('firebase/auth', () => ({
  getAuth: () => ({ kind: 'web-auth' }),
  initializeAuth: () => ({ kind: 'native-auth' }),
  setPersistence: () => Promise.resolve(),
  browserLocalPersistence: 'LOCAL',
  indexedDBLocalPersistence: 'IDB',
  signOut: () => h.signOut(),
}));

describe('API_READ_CACHE matches the service worker', () => {
  const sw = readFileSync(join(__dirname, '../../public/sw.js'), 'utf8');

  it('is navbharat-api-v2, the name public/sw.js assigns, and not v1', () => {
    expect(API_READ_CACHE).toBe('navbharat-api-v2');
    expect(sw).toContain(API_READ_CACHE);
    expect(sw).not.toMatch(/API_READ_CACHE\s*=\s*['"]navbharat-api-v1['"]/);
    expect(sw).toMatch(/API_READ_CACHE\s*=\s*['"]navbharat-api-v2['"]/);
  });
});

describe('shouldClearApiReadCache', () => {
  it('does not clear the first sight of an account or a repeat of the same uid', () => {
    expect(shouldClearApiReadCache(null, null)).toBe(false);
    expect(shouldClearApiReadCache(null, 'user-a')).toBe(false);
    expect(shouldClearApiReadCache('user-a', 'user-a')).toBe(false);
  });

  it('clears on sign-out and on a switch to a different uid', () => {
    expect(shouldClearApiReadCache('user-a', null)).toBe(true);
    expect(shouldClearApiReadCache('user-a', 'user-b')).toBe(true);
  });
});

describe('sign-out and the auth listener delete that same cache', () => {
  const firebaseSrc = readFileSync(join(__dirname, 'firebase.ts'), 'utf8');
  const appSrc = readFileSync(join(__dirname, '../App.tsx'), 'utf8');

  it('imports the constant — the client does not retype the bucket name', () => {
    expect(firebaseSrc).toMatch(/import\s*\{[^}]*API_READ_CACHE[^}]*\}\s*from\s*'\.\/swCaches'/);
    expect(appSrc).toMatch(/import\s*\{[^}]*API_READ_CACHE[^}]*\}\s*from\s*'\.\/lib\/swCaches'/);
    expect(firebaseSrc).not.toContain("'navbharat-api-v2'");
    expect(firebaseSrc).not.toContain('"navbharat-api-v2"');
    expect(appSrc).not.toContain("'navbharat-api-v2'");
    expect(appSrc).not.toContain('"navbharat-api-v2"');
  });

  it('signOutEverywhere calls caches.delete, and the auth listener does too on a uid change', () => {
    expect(firebaseSrc).toContain('caches.delete(API_READ_CACHE)');
    expect(appSrc).toContain('caches.delete(API_READ_CACHE)');
    expect(appSrc).toContain('shouldClearApiReadCache(previousUid, nextUid)');
    expect(appSrc).toContain('onAuthStateChanged');
  });

  beforeEach(() => {
    vi.resetModules();
    h.native.value = false;
    h.signOut.mockReset();
    h.signOut.mockImplementation(() => Promise.resolve());
  });

  it('signOutEverywhere deletes navbharat-api-v2 before the web SDK sign-out', async () => {
    const order: string[] = [];
    const cacheStorage = {
      delete: async (name: string) => { order.push(`delete:${name}`); return true; },
    };
    h.signOut.mockImplementation(() => { order.push('signOut'); return Promise.resolve(); });
    vi.stubGlobal('window', { caches: cacheStorage });
    vi.stubGlobal('caches', cacheStorage);
    try {
      const { signOutEverywhere } = await import('./firebase');
      await signOutEverywhere();
      expect(order).toEqual([`delete:${API_READ_CACHE}`, 'signOut']);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

import { describe, it, expect, vi } from 'vitest';
import {
  firebaseAuthUserKey,
  hasPersistedSession,
  ensureSessionPersisted,
  FIREBASE_AUTH_USER_PREFIX,
  type KeyListingStorage,
} from './authPersistence';

// THE bug (admin, 2026-07-25): "app band karo, background se clear karo, wapas open karo — logout hi
// mila tha", on BOTH platforms and EVERY provider. Root cause: initializeAuth resolves persistence once
// at init; with a SINGLE candidate, a momentary localStorage miss silently downgraded the whole session
// to in-memory — so login worked until the app was killed, and every other localStorage value (written
// later, once storage was warm) survived. These tests lock the detect-and-heal half of the fix.

/** In-memory Storage stub exposing the real key-listing surface hasPersistedSession walks. */
function storageWith(entries: Record<string, string>): KeyListingStorage {
  const keys = Object.keys(entries);
  return {
    getItem: (k: string) => (k in entries ? entries[k] : null),
    length: keys.length,
    key: (i: number) => keys[i] ?? null,
  };
}

describe('firebaseAuthUserKey', () => {
  it('builds the exact key the Firebase SDK persists under', () => {
    expect(firebaseAuthUserKey('AIzaTESTKEY')).toBe('firebase:authUser:AIzaTESTKEY:[DEFAULT]');
  });

  it('honours a non-default app name', () => {
    expect(firebaseAuthUserKey('AIzaTESTKEY', 'secondary')).toBe('firebase:authUser:AIzaTESTKEY:secondary');
  });

  it('always starts with the documented prefix', () => {
    expect(firebaseAuthUserKey('k').startsWith(FIREBASE_AUTH_USER_PREFIX)).toBe(true);
  });
});

describe('hasPersistedSession — is the session actually durable?', () => {
  it('true when a Firebase auth record is present', () => {
    expect(hasPersistedSession(storageWith({ 'firebase:authUser:abc:[DEFAULT]': '{"uid":"u1"}' }))).toBe(true);
  });

  it('matches on the PREFIX, so a different apiKey/app name still counts', () => {
    expect(hasPersistedSession(storageWith({ 'firebase:authUser:OTHERKEY:secondary': '{"uid":"u1"}' }))).toBe(true);
  });

  it('FALSE when only unrelated app data is stored — the in-memory-auth case that caused the bug', () => {
    // This is precisely the reported state: settings/chats survived a cold restart, the login did not.
    expect(hasPersistedSession(storageWith({
      navbharat_admin_v1: 'true',
      navbharat_home_v1: '{}',
      agentv3_session_user1: 'sess-1',
    }))).toBe(false);
  });

  it('false for an empty storage', () => {
    expect(hasPersistedSession(storageWith({}))).toBe(false);
  });

  it('false (never throws) when the key is present but holds an empty value', () => {
    expect(hasPersistedSession(storageWith({ 'firebase:authUser:abc:[DEFAULT]': '' }))).toBe(false);
  });

  it('false (never throws) when storage is missing entirely', () => {
    expect(hasPersistedSession(null)).toBe(false);
    expect(hasPersistedSession(undefined)).toBe(false);
  });

  it('false (never throws) when storage access throws — routes to repair instead of crashing', () => {
    const hostile: KeyListingStorage = {
      getItem: () => { throw new Error('storage blocked'); },
      length: 1,
      key: () => { throw new Error('storage blocked'); },
    };
    expect(() => hasPersistedSession(hostile)).not.toThrow();
    expect(hasPersistedSession(hostile)).toBe(false);
  });
});

describe('ensureSessionPersisted — verify, then heal, and report honestly', () => {
  it('already durable: does NOT touch persistence (the healthy path stays a no-op)', async () => {
    const applyDurablePersistence = vi.fn(() => Promise.resolve());
    const outcome = await ensureSessionPersisted({ hasDurableSession: () => true, applyDurablePersistence });
    expect(outcome).toBe('already-persisted');
    expect(applyDurablePersistence).not.toHaveBeenCalled();
  });

  it('in-memory session: re-applies persistence and reports repaired once the record appears', async () => {
    let durable = false;
    const applyDurablePersistence = vi.fn(async () => { durable = true; });
    const outcome = await ensureSessionPersisted({ hasDurableSession: () => durable, applyDurablePersistence });
    expect(applyDurablePersistence).toHaveBeenCalledOnce();
    expect(outcome).toBe('repaired');
  });

  it('repair runs but produces NO record: reports repair-failed — never a fake success', async () => {
    const outcome = await ensureSessionPersisted({
      hasDurableSession: () => false,          // still nothing after the repair
      applyDurablePersistence: () => Promise.resolve(),
    });
    expect(outcome).toBe('repair-failed');
  });

  it('repair THROWS: swallowed into repair-failed — a broken repair can never break a working login', async () => {
    const outcome = await ensureSessionPersisted({
      hasDurableSession: () => false,
      applyDurablePersistence: () => Promise.reject(new Error('setPersistence blew up')),
    });
    expect(outcome).toBe('repair-failed');
  });

  it('never rejects, whatever the deps do', async () => {
    await expect(ensureSessionPersisted({
      hasDurableSession: () => false,
      applyDurablePersistence: () => Promise.reject(new Error('boom')),
    })).resolves.toBeDefined();
  });

  it('logs the diagnosis when a repair is needed, and stays silent on the healthy path', async () => {
    const quiet = vi.fn();
    await ensureSessionPersisted({ hasDurableSession: () => true, applyDurablePersistence: () => Promise.resolve(), log: quiet });
    expect(quiet).not.toHaveBeenCalled();

    const loud = vi.fn();
    let durable = false;
    await ensureSessionPersisted({
      hasDurableSession: () => durable,
      applyDurablePersistence: async () => { durable = true; },
      log: loud,
    });
    expect(loud).toHaveBeenCalled();
  });
});

describe('regression guard — native auth must use a DURABLE persistence hierarchy, never a lone store', () => {
  it('firebase.ts passes an array of durable persistences to initializeAuth', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const src = readFileSync(join(__dirname, 'firebase.ts'), 'utf8');
    // A single-store `persistence: browserLocalPersistence` is exactly the silent-downgrade bug.
    expect(src).toMatch(/persistence:\s*\[\s*browserLocalPersistence\s*,\s*indexedDBLocalPersistence\s*\]/);
    // localStorage must stay FIRST (synchronous; immune to the WebKit IndexedDB suspension).
    expect(src).not.toMatch(/persistence:\s*\[\s*indexedDBLocalPersistence/);
  });

  it('the signed-in path calls the persistence verifier in App.tsx', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const src = readFileSync(join(__dirname, '../App.tsx'), 'utf8');
    expect(src).toContain('ensureNativeSessionPersisted()');
  });
});

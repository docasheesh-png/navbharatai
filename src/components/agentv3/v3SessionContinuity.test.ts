import { describe, it, expect, beforeEach } from 'vitest';
import { v3SessionStorageKey, readStickySession, clearStickySession } from './v3SessionContinuity';

// A minimal storage shim for the node test env (no jsdom).
function installStorages(): void {
  const mk = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
      setItem: (k: string, v: string) => { m.set(k, v); },
      removeItem: (k: string) => { m.delete(k); },
    };
  };
  (globalThis as Record<string, unknown>).localStorage = mk();
  (globalThis as Record<string, unknown>).sessionStorage = mk();
}

describe('v3SessionContinuity', () => {
  beforeEach(installStorages);

  it('key is per-user, anon-safe, and matches the panel legacy format', () => {
    expect(v3SessionStorageKey('u1')).toBe('agentv3_session_u1');
    expect(v3SessionStorageKey(undefined)).toBe('agentv3_session_anon');
    expect(v3SessionStorageKey('')).toBe('agentv3_session_anon');
  });

  it('reads a sticky session written under the same key (reload/phone-off continuity)', () => {
    localStorage.setItem(v3SessionStorageKey('u1'), 'sid-123');
    expect(readStickySession('u1')).toBe('sid-123');
    expect(readStickySession('u2')).toBe(''); // per-user isolation
  });

  it('falls back to sessionStorage when localStorage has no value (Private mode path)', () => {
    sessionStorage.setItem(v3SessionStorageKey('u1'), 'sid-ss');
    expect(readStickySession('u1')).toBe('sid-ss');
  });

  // THE ✕-close rule: clear → next open is fresh (no sticky restore).
  it('clearStickySession removes it from BOTH storages', () => {
    localStorage.setItem(v3SessionStorageKey('u1'), 'a');
    sessionStorage.setItem(v3SessionStorageKey('u1'), 'b');
    clearStickySession('u1');
    expect(readStickySession('u1')).toBe('');
  });

  it('never throws when storages are absent entirely', () => {
    delete (globalThis as Record<string, unknown>).localStorage;
    delete (globalThis as Record<string, unknown>).sessionStorage;
    expect(readStickySession('u1')).toBe('');
    expect(() => clearStickySession('u1')).not.toThrow();
  });
});

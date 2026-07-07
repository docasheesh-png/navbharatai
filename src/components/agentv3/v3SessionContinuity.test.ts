import { describe, it, expect, beforeEach } from 'vitest';
import { v3SessionStorageKey, readStickySession, clearStickySession, clientWorkspaceId } from './v3SessionContinuity';

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

// Fix 26 (report 2026-07-07, "tab switch → sab gayab"): the client must derive the SAME workspace id
// the server derives — INCLUDING the anon identity — so continuity features (file rehydrate, chat
// restore, checkpoints, report download) never silently go dead or point at the wrong workspace.
describe('clientWorkspaceId — client mirror of the server deriveWorkspaceId (anon parity)', () => {
  it('derives the user-keyed workspace when signed in', () => {
    expect(clientWorkspaceId('u1', 'sid-1')).toBe('agentv3-u1-sid-1');
  });
  it('derives the ANON workspace when signed out / auth not yet resolved (never undefined)', () => {
    expect(clientWorkspaceId(undefined, 'sid-1')).toBe('agentv3-anon-sid-1');
    expect(clientWorkspaceId(null, 'sid-1')).toBe('agentv3-anon-sid-1');
    expect(clientWorkspaceId('', 'sid-1')).toBe('agentv3-anon-sid-1');
  });
  it('sanitizes an invalid uid to anon exactly like the server', () => {
    expect(clientWorkspaceId('bad uid with spaces', 'sid-1')).toBe('agentv3-anon-sid-1');
  });
  it("returns '' only when there is no session id at all", () => {
    expect(clientWorkspaceId('u1', '')).toBe('');
    expect(clientWorkspaceId('u1', null)).toBe('');
  });
  it('the anon-degraded candidate differs from the user candidate (the dual-candidate fallback pair)', () => {
    const sid = 'e361e8bb-2e67-48cd-8985-e0b2be785ae4'; // the real session from the admin report
    expect(clientWorkspaceId('u1', sid)).not.toBe(clientWorkspaceId(undefined, sid));
    expect(clientWorkspaceId(undefined, sid)).toBe(`agentv3-anon-${sid}`);
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { normalizeUid, getAgentV3SessionId, getAgentV3WorkspaceId } from './agentv3Workspace';

// Minimal in-memory localStorage stub for the node test env.
function installLocalStorage(): Record<string, string> {
  const store: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = String(v); },
    removeItem: (k: string) => { delete store[k]; },
  });
  return store;
}

describe('agentv3Workspace', () => {
  beforeEach(() => { vi.unstubAllGlobals(); });

  describe('normalizeUid', () => {
    it('keeps a valid uid and falls back to anon otherwise', () => {
      expect(normalizeUid('abc123_-XYZ')).toBe('abc123_-XYZ');
      expect(normalizeUid('')).toBe('anon');
      expect(normalizeUid(null)).toBe('anon');
      expect(normalizeUid('has space')).toBe('anon');
    });
  });

  describe('session reuse', () => {
    it('mints once and reuses the same session id (shared by IDE + v3.0 panel)', () => {
      installLocalStorage();
      const a = getAgentV3SessionId('user1');
      const b = getAgentV3SessionId('user1');
      expect(a).toBe(b);
      expect(a.length).toBeGreaterThanOrEqual(6);
    });

    it('reuses an id already persisted by the v3.0 panel under the same key', () => {
      installLocalStorage();
      localStorage.setItem('agentv3_session_user1', 'preexisting-session-123');
      expect(getAgentV3SessionId('user1')).toBe('preexisting-session-123');
    });

    it('separate accounts get separate sessions', () => {
      installLocalStorage();
      expect(getAgentV3SessionId('user1')).not.toBe(getAgentV3SessionId('user2'));
    });
  });

  describe('getAgentV3WorkspaceId', () => {
    it('produces the canonical agentv3-{uid}-{sessionId} id', () => {
      installLocalStorage();
      localStorage.setItem('agentv3_session_user1', 'sess-abcdef');
      expect(getAgentV3WorkspaceId('user1')).toBe('agentv3-user1-sess-abcdef');
    });

    it('uses anon for a missing/invalid uid', () => {
      installLocalStorage();
      const ws = getAgentV3WorkspaceId(null);
      expect(ws.startsWith('agentv3-anon-')).toBe(true);
    });

    it('never throws when storage is unavailable', () => {
      vi.stubGlobal('localStorage', undefined);
      expect(() => getAgentV3WorkspaceId('user1')).not.toThrow();
      expect(getAgentV3WorkspaceId('user1').startsWith('agentv3-user1-')).toBe(true);
    });
  });
});

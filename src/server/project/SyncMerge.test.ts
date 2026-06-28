import { describe, it, expect } from 'vitest';
import { mergeSessions, mergeWorkspaceState } from './SyncMerge';

describe('SyncMerge (P4.4 cross-device consistency)', () => {
  describe('mergeSessions — last-write-wins per session id', () => {
    it('keeps sessions unique to each side (no cross-device loss)', () => {
      const stored = [{ id: 'a', lastUpdated: '2026-01-01' }];
      const incoming = [{ id: 'b', lastUpdated: '2026-01-02' }];
      const merged = mergeSessions(stored, incoming);
      expect(merged.map((s) => s.id).sort()).toEqual(['a', 'b']);
    });

    it('a stale incoming write does NOT clobber a newer stored session', () => {
      const stored = [{ id: 'a', lastUpdated: '2026-06-10T00:00:00Z', title: 'new' }];
      const incoming = [{ id: 'a', lastUpdated: '2026-06-01T00:00:00Z', title: 'old' }];
      const merged = mergeSessions(stored, incoming);
      expect(merged).toHaveLength(1);
      expect(merged[0].title).toBe('new'); // newer stored wins
    });

    it('a newer incoming write DOES win over an older stored session', () => {
      const stored = [{ id: 'a', lastUpdated: '2026-06-01T00:00:00Z', title: 'old' }];
      const incoming = [{ id: 'a', lastUpdated: '2026-06-10T00:00:00Z', title: 'new' }];
      const merged = mergeSessions(stored, incoming);
      expect(merged[0].title).toBe('new');
    });

    it('the classic lost-update case: device B (stale) syncs without device A\'s session → A survives', () => {
      // Cloud already has A's session (s1) and B's old session (s2@T1).
      const stored = [
        { id: 's1', lastUpdated: '2026-06-10T00:00:00Z' },
        { id: 's2', lastUpdated: '2026-06-01T00:00:00Z' },
      ];
      // Device B never saw s1, and re-saves only its own s2 (slightly updated).
      const incoming = [{ id: 's2', lastUpdated: '2026-06-02T00:00:00Z' }];
      const merged = mergeSessions(stored, incoming);
      // Blind overwrite would have DROPPED s1. Merge keeps it.
      expect(merged.map((s) => s.id).sort()).toEqual(['s1', 's2']);
      expect(merged.find((s) => s.id === 's2')!.lastUpdated).toBe('2026-06-02T00:00:00Z');
    });

    it('missing lastUpdated is treated as oldest', () => {
      const stored = [{ id: 'a', lastUpdated: '2026-06-10T00:00:00Z' }];
      const incoming = [{ id: 'a' }]; // no timestamp → older
      expect(mergeSessions(stored, incoming)[0].lastUpdated).toBe('2026-06-10T00:00:00Z');
    });

    it('keeps the incoming writer\'s id-less sessions but does not accumulate stored id-less ones', () => {
      const stored = [{ lastUpdated: '2026-06-01' }]; // id-less stored
      const incoming = [{ lastUpdated: '2026-06-02' }, { id: 'x', lastUpdated: '2026-06-02' }];
      const merged = mergeSessions(stored, incoming);
      // one id-less (incoming) + one id'd
      expect(merged.filter((s) => !s.id)).toHaveLength(1);
      expect(merged.filter((s) => s.id === 'x')).toHaveLength(1);
    });
  });

  describe('mergeWorkspaceState — lastApp preservation', () => {
    it('keeps incoming lastApp when non-empty', () => {
      const r = mergeWorkspaceState({ sessions: [], lastApp: 'OLD' }, { sessions: [], lastApp: 'NEW' });
      expect(r.lastApp).toBe('NEW');
    });

    it('preserves stored lastApp when incoming is empty (a device with no app can\'t wipe it)', () => {
      const r = mergeWorkspaceState({ sessions: [], lastApp: 'KEEP' }, { sessions: [], lastApp: '' });
      expect(r.lastApp).toBe('KEEP');
    });

    it('merges sessions and lastApp together', () => {
      const r = mergeWorkspaceState(
        { sessions: [{ id: 'a', lastUpdated: '2026-06-10' }], lastApp: 'app1' },
        { sessions: [{ id: 'b', lastUpdated: '2026-06-11' }], lastApp: '' },
      );
      expect(r.sessions.map((s) => s.id).sort()).toEqual(['a', 'b']);
      expect(r.lastApp).toBe('app1');
    });
  });
});

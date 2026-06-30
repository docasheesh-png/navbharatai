import { describe, it, expect } from 'vitest';
import {
  checkpointDocId,
  sortDedupeCheckpoints,
  normalizeCheckpoint,
  saveCheckpoint,
  loadCheckpoints,
  type DurableCheckpoint,
} from '../src/server/AgentV3/CheckpointStore';

/** Phase G1 — durable git checkpoint store: pure helpers + best-effort no-throw under VITEST. */

describe('checkpointDocId', () => {
  it('prefers the SHA, is deterministic and Firestore-safe', () => {
    expect(checkpointDocId({ sha: 'abc123', id: 'cp_1' })).toBe('abc123');
    expect(checkpointDocId({ sha: 'abc123' })).toBe(checkpointDocId({ sha: 'abc123' }));
    expect(checkpointDocId({ sha: 'a/b c$', id: 'x' })).not.toMatch(/[^a-zA-Z0-9_-]/);
  });
  it('falls back to id when there is no SHA', () => {
    expect(checkpointDocId({ id: 'cp_42' })).toBe('cp_42');
  });
});

describe('normalizeCheckpoint', () => {
  it('rejects junk and keeps valid records', () => {
    expect(normalizeCheckpoint(null)).toBeNull();
    expect(normalizeCheckpoint({})).toBeNull();
    const cp = normalizeCheckpoint({ sha: 'deadbeef', id: 'cp_1', message: 'wrote App.tsx', ts: 123 });
    expect(cp).toEqual({ sha: 'deadbeef', id: 'cp_1', message: 'wrote App.tsx', ts: 123 });
  });
  it('clamps the message and synthesises an id from the sha when missing', () => {
    const cp = normalizeCheckpoint({ sha: 'abcdef123456', message: 'x'.repeat(500) })!;
    expect(cp.id).toBe('cp_abcdef123456');
    expect(cp.message.length).toBe(300);
    expect(cp.ts).toBeGreaterThan(0);
  });
});

describe('sortDedupeCheckpoints', () => {
  it('returns newest-first and dedupes by sha', () => {
    const list: DurableCheckpoint[] = [
      { id: 'a', sha: 's1', message: 'first', ts: 100 },
      { id: 'b', sha: 's2', message: 'second', ts: 300 },
      { id: 'c', sha: 's1', message: 'dup of first', ts: 200 },
    ];
    const out = sortDedupeCheckpoints(list);
    expect(out.map((c) => c.sha)).toEqual(['s2', 's1']);
    expect(out[0].ts).toBe(300);
  });
  it('handles empty/garbage safely', () => {
    expect(sortDedupeCheckpoints([])).toEqual([]);
    expect(sortDedupeCheckpoints([{} as DurableCheckpoint])).toEqual([]);
  });
});

describe('store (best-effort, no Firestore under VITEST)', () => {
  it('saveCheckpoint never throws and loadCheckpoints returns []', async () => {
    await expect(saveCheckpoint('ws-1', { sha: 's1', id: 'cp_1', message: 'm', ts: 1 })).resolves.toBeUndefined();
    await expect(saveCheckpoint('ws-1', null)).resolves.toBeUndefined();
    await expect(saveCheckpoint('', { sha: 's1' })).resolves.toBeUndefined();
    await expect(loadCheckpoints('ws-1')).resolves.toEqual([]);
    await expect(loadCheckpoints('')).resolves.toEqual([]);
  });
});

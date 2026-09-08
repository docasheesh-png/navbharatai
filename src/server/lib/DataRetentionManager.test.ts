import { describe, it, expect, beforeEach } from 'vitest';
import {
  retentionCutoffMs, isExpired, deleteUserData, purgeExpired,
  USER_SCOPED_COLLECTIONS, RETENTION_POLICIES, RETAINED_INDEFINITELY,
  retentionBound, isRetainedIndefinitely, collectionsNeedingRetention, DEFAULT_MAX_PER_RUN,
  type RetentionFirestore, type RetentionPolicy,
} from './DataRetentionManager';

// ── Minimal in-memory Firestore satisfying RetentionFirestore ──────────────────────────────────────
type Row = Record<string, unknown>;
class MockFirestore implements RetentionFirestore {
  data = new Map<string, Map<string, Row>>();
  seed(collection: string, id: string, row: Row) {
    if (!this.data.has(collection)) this.data.set(collection, new Map());
    this.data.get(collection)!.set(id, row);
  }
  private col(name: string) { return this.data.get(name) ?? new Map<string, Row>(); }
  collection(name: string) {
    const store = this;
    return {
      doc(id: string) {
        return {
          async get() { return { exists: store.col(name).has(id) }; },
          async delete() { store.col(name).delete(id); },
        };
      },
      where(field: string, op: '==' | '<', value: unknown) {
        /**
         * 🔒 THIS MOCK ENFORCES FIRESTORE'S TYPE ORDERING ON PURPOSE. Firestore compares values by TYPE
         * FIRST — every number sorts before every timestamp before every string — so a `<` between two
         * different types never matches. The old mock compared Dates only, which meant it could not
         * have caught the bug this change fixes: a policy on a numeric field building a Date bound and
         * silently deleting nothing. A mock that is more forgiving than the real database is a test
         * that passes for code that cannot work.
         */
        const cmp = (v: unknown, bound: unknown): boolean => {
          if (v instanceof Date && bound instanceof Date) return v.getTime() < bound.getTime();
          if (typeof v === 'number' && typeof bound === 'number') return v < bound;
          if (typeof v === 'string' && typeof bound === 'string') return v < bound;
          return false; // different types never compare — exactly as Firestore behaves
        };
        let cap = Infinity;
        const q = {
          limit(n: number) { cap = n; return q; },
          async get() {
            const out: Array<{ ref: { delete(): Promise<unknown> } }> = [];
            for (const [id, row] of store.col(name)) {
              if (out.length >= cap) break;
              const v = row[field];
              const match = op === '==' ? v === value : cmp(v, value);
              if (match) out.push({ ref: { async delete() { store.col(name).delete(id); } } });
            }
            return { docs: out };
          },
        };
        return q;
      },
    };
  }
  count(collection: string) { return this.col(collection).size; }
  has(collection: string, id: string) { return this.col(collection).has(id); }
}

describe('retention policy math (pure)', () => {
  it('retentionCutoffMs subtracts the TTL window', () => {
    const now = 1_000 * 24 * 60 * 60 * 1000; // day 1000 in ms
    expect(retentionCutoffMs(now, 90)).toBe(now - 90 * 24 * 60 * 60 * 1000);
  });
  it('isExpired: older-than-cutoff true, newer false, non-finite false', () => {
    expect(isExpired(100, 200)).toBe(true);
    expect(isExpired(300, 200)).toBe(false);
    expect(isExpired(200, 200)).toBe(false); // exactly at cutoff is not expired
    expect(isExpired(NaN, 200)).toBe(false);
  });
});

describe('deleteUserData — right-to-be-forgotten cascade', () => {
  let db: MockFirestore;
  beforeEach(() => {
    db = new MockFirestore();
    // doc-id keyed
    db.seed('users', 'u1', { role: 'user' });
    db.seed('users', 'u2', { role: 'user' });
    db.seed('user_profiles', 'u1', { name: 'A' });
    db.seed('user_token_wallets', 'u1', { balance: 5 });
    // field keyed (userId)
    db.seed('user_costs', 'u1_2026-06', { userId: 'u1', totalCostUsd: 1 });
    db.seed('user_costs', 'u1_2026-07', { userId: 'u1', totalCostUsd: 2 });
    db.seed('user_costs', 'u2_2026-07', { userId: 'u2', totalCostUsd: 9 });
    db.seed('chat_sessions', 's1', { userId: 'u1' });
    db.seed('chat_sessions', 's2', { userId: 'u2' });
    db.seed('user_build_history', 'b1', { userId: 'u1' });
  });

  it('erases every user-scoped record for the target uid', async () => {
    const report = await deleteUserData(db, 'u1');
    expect(db.has('users', 'u1')).toBe(false);
    expect(db.has('user_profiles', 'u1')).toBe(false);
    expect(db.has('user_token_wallets', 'u1')).toBe(false);
    expect(db.count('user_costs')).toBe(1); // only u2's cost doc remains
    expect(db.has('chat_sessions', 's1')).toBe(false);
    expect(db.has('user_build_history', 'b1')).toBe(false);
    // users(1) + user_profiles(1) + user_token_wallets(1) + user_costs(2) + chat_sessions(1) + user_build_history(1)
    expect(report.totalDeleted).toBe(7);
  });

  it('NEVER touches another user’s data (isolation)', async () => {
    await deleteUserData(db, 'u1');
    expect(db.has('users', 'u2')).toBe(true);
    expect(db.has('chat_sessions', 's2')).toBe(true);
    expect(db.has('user_costs', 'u2_2026-07')).toBe(true);
  });

  it('reports 0 for a user with no data, and never throws', async () => {
    const report = await deleteUserData(new MockFirestore(), 'ghost');
    expect(report.totalDeleted).toBe(0);
    expect(report.collections.every(c => c.deleted === 0 && !c.error)).toBe(true);
  });

  it('refuses to run with an empty uid (would be catastrophic)', async () => {
    await expect(deleteUserData(db, '')).rejects.toThrow(/non-empty uid/);
    // nothing deleted
    expect(db.has('users', 'u1')).toBe(true);
  });
});

describe('purgeExpired — TTL retention', () => {
  it('deletes only records older than the cutoff (a `< cutoff` bound never removes recent data)', async () => {
    const db = new MockFirestore();
    const NOW = 1_000 * 24 * 60 * 60 * 1000;
    db.seed('build_jobs', 'old', { updatedAt: new Date(NOW - 200 * 24 * 60 * 60 * 1000) }); // 200d old
    db.seed('build_jobs', 'recent', { updatedAt: new Date(NOW - 5 * 24 * 60 * 60 * 1000) }); // 5d old
    const policies: RetentionPolicy[] = [{ collection: 'build_jobs', ttlDays: 90, timestampField: 'updatedAt' }];
    const report = await purgeExpired(db, NOW, policies);
    expect(report.totalDeleted).toBe(1);
    expect(db.has('build_jobs', 'old')).toBe(false);
    expect(db.has('build_jobs', 'recent')).toBe(true);
  });
});

describe('registry sanity', () => {
  it('every registered collection has a valid key strategy', () => {
    for (const c of USER_SCOPED_COLLECTIONS) {
      const ok = c.key === 'docId' || (typeof c.key === 'object' && typeof c.key.field === 'string');
      expect(ok).toBe(true);
    }
  });
  it('default retention policies are well-formed', () => {
    for (const p of RETENTION_POLICIES) {
      expect(p.ttlDays).toBeGreaterThan(0);
      expect(p.collection.length).toBeGreaterThan(0);
      expect(p.timestampField.length).toBeGreaterThan(0);
    }
  });
});

/**
 * TYPED RETENTION BOUNDS (ROADMAP §12 #3).
 *
 * The purge built its bound as `new Date(cutoffMs)` unconditionally. Firestore orders values BY TYPE
 * FIRST, so a Date bound against a field stored as `Date.now()` matches NOTHING — forever, with no
 * error, while the policy reports itself configured. That is retention that looks done and deletes
 * nothing, and it is invisible because a purge that deletes nothing looks like a purge with nothing
 * to delete.
 */
const DAY = 24 * 60 * 60 * 1000;

describe('retentionBound — the bound is built in the type the field is STORED in', () => {
  const cutoff = Date.parse('2026-01-01T00:00:00Z');

  it('a Date field gets a Date', () => {
    const b = retentionBound(cutoff, 'date');
    expect(b).toBeInstanceOf(Date);
    expect((b as Date).getTime()).toBe(cutoff);
  });

  it('an epoch-ms field gets a NUMBER, not a Date', () => {
    expect(retentionBound(cutoff, 'epochMs')).toBe(cutoff);
    expect(retentionBound(cutoff, 'epochMs')).not.toBeInstanceOf(Date);
  });

  it('an ISO field gets an ISO STRING — which sorts in time order, so `<` is correct', () => {
    expect(retentionBound(cutoff, 'iso')).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('🔒 purgeExpired actually deletes for EVERY stored type', () => {
  const NOW = Date.parse('2026-06-01T00:00:00Z');
  let db: MockFirestore;
  beforeEach(() => { db = new MockFirestore(); });

  it('epochMs: an old numeric timestamp is purged, a recent one survives', async () => {
    // ⚠️ THIS IS THE REGRESSION TEST FOR THE BUG. Before the fix this deleted 0 of 2 — the Date bound
    // never compared against the numbers — and nothing anywhere reported a problem.
    db.seed('server_logs', 'old', { ts: NOW - 90 * DAY });
    db.seed('server_logs', 'new', { ts: NOW - 1 * DAY });
    const report = await purgeExpired(db, NOW, [
      { collection: 'server_logs', ttlDays: 30, timestampField: 'ts', timestampKind: 'epochMs' },
    ]);
    expect(report.totalDeleted).toBe(1);
    expect(db.has('server_logs', 'old')).toBe(false);
    expect(db.has('server_logs', 'new')).toBe(true);
  });

  it('iso: an old ISO timestamp is purged, a recent one survives', async () => {
    db.seed('session_error_hints', 'old', { updatedAt: new Date(NOW - 90 * DAY).toISOString() });
    db.seed('session_error_hints', 'new', { updatedAt: new Date(NOW - 1 * DAY).toISOString() });
    const report = await purgeExpired(db, NOW, [
      { collection: 'session_error_hints', ttlDays: 30, timestampField: 'updatedAt', timestampKind: 'iso' },
    ]);
    expect(report.totalDeleted).toBe(1);
    expect(db.has('session_error_hints', 'new')).toBe(true);
  });

  it('date: unchanged behaviour for the original policy shape', async () => {
    db.seed('build_jobs', 'old', { updatedAt: new Date(NOW - 200 * DAY) });
    db.seed('build_jobs', 'new', { updatedAt: new Date(NOW - 1 * DAY) });
    const report = await purgeExpired(db, NOW, [
      { collection: 'build_jobs', ttlDays: 90, timestampField: 'updatedAt', timestampKind: 'date' },
    ]);
    expect(report.totalDeleted).toBe(1);
    expect(db.has('build_jobs', 'new')).toBe(true);
  });

  it('🔒 a WRONG kind deletes NOTHING rather than the wrong rows — it fails safe', async () => {
    // The consequence of getting the type wrong must be "no deletion", never "deleted something recent".
    db.seed('server_logs', 'old', { ts: NOW - 90 * DAY });
    const report = await purgeExpired(db, NOW, [
      { collection: 'server_logs', ttlDays: 30, timestampField: 'ts', timestampKind: 'date' },
    ]);
    expect(report.totalDeleted).toBe(0);
    expect(db.has('server_logs', 'old')).toBe(true);
  });

  it('🔒 ONE RUN IS BOUNDED — the first sweep of a months-old backlog is not one giant query', async () => {
    for (let i = 0; i < 10; i++) db.seed('server_logs', `l${i}`, { ts: NOW - 90 * DAY });
    const report = await purgeExpired(db, NOW, [
      { collection: 'server_logs', ttlDays: 30, timestampField: 'ts', timestampKind: 'epochMs', maxPerRun: 4 },
    ]);
    expect(report.totalDeleted).toBe(4);
    // The rest drains over later runs, which is slower and cannot spike anything.
    expect(db.count('server_logs')).toBe(6);
    expect(DEFAULT_MAX_PER_RUN).toBeGreaterThan(0);
  });
});

describe('🔒 what is deliberately kept forever, and what is merely undecided', () => {
  it("the user's own property is never on a clock", () => {
    for (const c of ['workspace_files_v3', 'user_costs', 'app_builds', 'workspace_checkpoints_v3']) {
      expect(isRetainedIndefinitely(c)).toBe(true);
      expect(RETENTION_POLICIES.some((p) => p.collection === c)).toBe(false);
    }
  });

  it('every kept-forever entry states a REASON — a bare list would rot into a mystery', () => {
    for (const r of RETAINED_INDEFINITELY) expect(r.reason.length).toBeGreaterThan(10);
  });

  it('a collection is never both purged and kept forever', () => {
    for (const p of RETENTION_POLICIES) expect(isRetainedIndefinitely(p.collection)).toBe(false);
  });

  it('the warning counts only what a human still has to decide', () => {
    const growing = ['server_logs', 'workspace_files_v3', 'something_new'];
    expect(collectionsNeedingRetention(growing)).toEqual(['something_new']);
  });

  it('a genuinely new collection is NOT silently excused — it shows up until someone decides', () => {
    // The failure mode to avoid is a registry that quietly absorbs everything and warns about nothing.
    expect(collectionsNeedingRetention(['brand_new_v9'])).toEqual(['brand_new_v9']);
  });

  it('every shipped policy names a real field and a real kind', () => {
    for (const p of RETENTION_POLICIES) {
      expect(p.timestampField).toBeTruthy();
      expect(['date', 'epochMs', 'iso']).toContain(p.timestampKind);
      expect(p.ttlDays).toBeGreaterThan(0);
    }
  });
});

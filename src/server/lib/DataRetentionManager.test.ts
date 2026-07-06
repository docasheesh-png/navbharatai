import { describe, it, expect, beforeEach } from 'vitest';
import {
  retentionCutoffMs, isExpired, deleteUserData, purgeExpired,
  USER_SCOPED_COLLECTIONS, RETENTION_POLICIES,
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
        return {
          async get() {
            const out: Array<{ ref: { delete(): Promise<unknown> } }> = [];
            for (const [id, row] of store.col(name)) {
              const v = row[field];
              const match = op === '==' ? v === value : (v instanceof Date && value instanceof Date && v.getTime() < value.getTime());
              if (match) out.push({ ref: { async delete() { store.col(name).delete(id); } } });
            }
            return { docs: out };
          },
        };
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

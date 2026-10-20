/**
 * AN ERASE THAT DELETES THE PARENT AND LEAVES THE CHILDREN IS NOT AN ERASE.
 *
 * 🔴 THE CLASS, and it has already happened once. Q-134 (2026-10-05) found the account erase deleting
 * each workspace's latest diagnostics report and leaving its whole `history` subcollection behind —
 * every past build report, unreachable and kept — because Firestore does not cascade and the registry
 * entry named no subcollection.
 *
 * `USER_SCOPED_SUBCOLLECTIONS` covers `parent/{uid}/sub`, whose parent id is the uid. A field-owned
 * parent such as `shares/{token}` needs its own `subs` inventory so its feedback leaves first.
 *
 * Legacy conversations need a different boundary: their ambiguous workspace-derived id can combine
 * a parent claiming one owner with another owner's turns or timeline. A parent `userId` query cannot
 * prove ownership of every child. Keep that inventory, retain the entire store without querying it,
 * and report the refusal while proven field-owned stores keep their children-first behavior.
 */
import { describe, it, expect } from 'vitest';
import {
  deleteUserData, USER_SCOPED_COLLECTIONS,
  type RetentionFirestore,
} from '../src/server/lib/DataRetentionManager';

type Row = Record<string, unknown>;

/** Records the ORDER of deletes, because "children first" is the part that matters. */
class NestingFirestore implements RetentionFirestore {
  private docs = new Map<string, Map<string, Row>>();
  /** `collection/docId/sub` → child documents, including their private payloads. */
  private subs = new Map<string, Map<string, Row>>();
  readonly deletions: string[] = [];
  readonly collectionsOpened: string[] = [];
  readonly queries: Array<{ collection: string; field: string; value: unknown }> = [];
  /** When false, a matched document's ref offers no `collection()` — an older or narrower handle. */
  constructor(private readonly subcollectionsReachable = true) {}

  seedDoc(collection: string, id: string, row: Row): void {
    if (!this.docs.has(collection)) this.docs.set(collection, new Map());
    this.docs.get(collection)!.set(id, row);
  }
  seedSub(collection: string, id: string, sub: string, subIds: string[], rows: Record<string, Row> = {}): void {
    this.subs.set(`${collection}/${id}/${sub}`, new Map(subIds.map((sid) => [sid, rows[sid] ?? {}])));
  }
  surviving(collection: string): string[] { return [...(this.docs.get(collection) ?? new Map()).keys()].sort(); }
  survivingSub(collection: string, id: string, sub: string): string[] {
    return [...(this.subs.get(`${collection}/${id}/${sub}`) ?? new Map()).keys()].sort();
  }
  storedDoc(collection: string, id: string): Row | undefined { return this.docs.get(collection)?.get(id); }
  storedChild(collection: string, id: string, sub: string, childId: string): Row | undefined {
    return this.subs.get(`${collection}/${id}/${sub}`)?.get(childId);
  }

  collection(name: string) {
    const self = this;
    self.collectionsOpened.push(name);
    const col = () => { if (!self.docs.has(name)) self.docs.set(name, new Map()); return self.docs.get(name)!; };
    const subRefFor = (id: string) => (sub: string) => {
      const key = `${name}/${id}/${sub}`;
      return {
        limit(n: number) {
          return {
            async get() {
              const ids = [...(self.subs.get(key) ?? new Map()).keys()].slice(0, n);
              return {
                docs: ids.map((sid) => ({
                  ref: {
                    async delete() {
                      self.deletions.push(key + '/' + sid);
                      self.subs.get(key)!.delete(sid);
                    },
                  },
                })),
              };
            },
          };
        },
      };
    };
    return {
      doc(id: string) {
        return {
          async get() { return { exists: col().has(id) }; },
          async delete() { self.deletions.push(`${name}/${id}`); col().delete(id); },
          collection: subRefFor(id),
        };
      },
      where(field: string, op: '==' | '<', value: unknown) {
        self.queries.push({ collection: name, field, value });
        return {
          async get() {
            const hits: string[] = [];
            for (const [id, row] of col()) if (op === '==' && row[field] === value) hits.push(id);
            return {
              docs: hits.map((id) => ({
                ref: {
                  async delete() { self.deletions.push(`${name}/${id}`); col().delete(id); },
                  ...(self.subcollectionsReachable ? { collection: subRefFor(id) } : {}),
                },
              })),
            };
          },
        };
      },
    };
  }
}

/** Shares have independently stored ownerId fields; their feedback must leave with their parent. */
function seededShares(reachable = true): NestingFirestore {
  const db = new NestingFirestore(reachable);
  db.seedDoc('shares', 'share-mine', { ownerId: 'victim', appName: 'My app' });
  db.seedSub('shares', 'share-mine', 'feedback', ['0', '1', '2']);
  db.seedDoc('shares', 'share-theirs', { ownerId: 'bystander', appName: 'Their app' });
  db.seedSub('shares', 'share-theirs', 'feedback', ['0', '1']);
  return db;
}

describe('legacy conversation ownership is refused before reaching parents or children', () => {
  it('keeps the owner-field and child inventory while declaring the unverified erase policy', () => {
    const entry = USER_SCOPED_COLLECTIONS.find((c) => c.collection === 'agentv3_conversations');
    expect(entry, 'agentv3_conversations is not in the erase registry').toBeTruthy();
    expect(entry!.key).toEqual({ field: 'userId' });
    expect(entry!.subs, 'its messages live in subcollections and must be named').toEqual(['turns', 'timeline']);
    expect(entry!.erasePolicy).toBe('ownership-unverified');
  });

  it.each(['abc', 'abc-d'])('retains a colliding legacy conversation and every child when erasing %s', async (uid) => {
    const db = new NestingFirestore();
    // uid=abc/session=d-session1 and uid=abc-d/session=session1 construct the SAME legacy id.
    const conversationId = 'agentv3-abc-d-session1';
    const parent = { userId: 'abc', appName: 'Header currently claims abc' };
    const ownTurn = { userId: 'abc', bytes: Buffer.from('abc private message') };
    const foreignTurn = { userId: 'abc-d', bytes: Buffer.from('abc-d private message') };
    const foreignTimeline = { bytes: Buffer.from('abc-d private build timeline') };
    db.seedDoc('agentv3_conversations', conversationId, parent);
    db.seedSub('agentv3_conversations', conversationId, 'turns', ['own', 'foreign'], {
      own: ownTurn, foreign: foreignTurn,
    });
    db.seedSub('agentv3_conversations', conversationId, 'timeline', ['foreign'], { foreign: foreignTimeline });
    db.seedDoc('agentv3_conversations', 'unrelated', { userId: 'bystander' });
    db.seedSub('agentv3_conversations', 'unrelated', 'turns', ['0']);

    const report = await deleteUserData(db, uid);

    expect(report.collections.find((row) => row.collection === 'agentv3_conversations')).toEqual({
      collection: 'agentv3_conversations', deleted: 0, refusal: 'ownership-unverified',
      error: 'Legacy conversation ownership cannot be confirmed; conversation records and children are retained.',
    });
    expect(report.totalDeleted).toBe(0);
    expect(db.collectionsOpened).not.toContain('agentv3_conversations');
    expect(db.queries.filter((query) => query.collection === 'agentv3_conversations')).toEqual([]);
    expect(db.deletions.filter((path) => path.startsWith('agentv3_conversations/'))).toEqual([]);
    expect(db.surviving('agentv3_conversations')).toEqual([conversationId, 'unrelated'].sort());
    expect(db.storedDoc('agentv3_conversations', conversationId)).toEqual(parent);
    expect(db.survivingSub('agentv3_conversations', conversationId, 'turns')).toEqual(['foreign', 'own']);
    expect(db.survivingSub('agentv3_conversations', conversationId, 'timeline')).toEqual(['foreign']);
    expect(db.storedChild('agentv3_conversations', conversationId, 'turns', 'own')).toEqual(ownTurn);
    expect(db.storedChild('agentv3_conversations', conversationId, 'turns', 'foreign')).toEqual(foreignTurn);
    expect(db.storedChild('agentv3_conversations', conversationId, 'timeline', 'foreign')).toEqual(foreignTimeline);
    expect(db.survivingSub('agentv3_conversations', 'unrelated', 'turns')).toEqual(['0']);
  });

  it('refuses the store even when the database handle cannot reach child collections', async () => {
    const db = new NestingFirestore(false);
    db.seedDoc('agentv3_conversations', 'conversation', { userId: 'abc' });
    db.seedSub('agentv3_conversations', 'conversation', 'turns', ['0']);
    const report = await deleteUserData(db, 'abc');
    expect(report.collections.find((row) => row.collection === 'agentv3_conversations')).toMatchObject({
      deleted: 0, refusal: 'ownership-unverified',
    });
    expect(db.collectionsOpened).not.toContain('agentv3_conversations');
    expect(db.surviving('agentv3_conversations')).toEqual(['conversation']);
    expect(db.survivingSub('agentv3_conversations', 'conversation', 'turns')).toEqual(['0']);
  });
});

describe('the erase reaches every proven-owned child, not just the parent', () => {
  it('the feedback is deleted with its share instead of orphaned', async () => {
    const db = seededShares();
    await deleteUserData(db, 'victim');
    expect(db.surviving('shares')).toEqual(['share-theirs']);
    expect(db.survivingSub('shares', 'share-mine', 'feedback')).toEqual([]);
  });

  it('🔒 children go BEFORE the parent — the other order leaves them unreachable', async () => {
    const db = seededShares();
    await deleteUserData(db, 'victim');
    const parentAt = db.deletions.indexOf('shares/share-mine');
    const lastChildAt = db.deletions.reduce(
      (last, d, i) => (d.startsWith('shares/share-mine/') ? i : last), -1,
    );
    expect(lastChildAt, 'no child was deleted at all').toBeGreaterThanOrEqual(0);
    expect(parentAt).toBeGreaterThan(lastChildAt);
  });

  it("another person's share and feedback are untouched", async () => {
    const db = seededShares();
    await deleteUserData(db, 'victim');
    expect(db.surviving('shares')).toEqual(['share-theirs']);
    expect(db.survivingSub('shares', 'share-theirs', 'feedback')).toEqual(['0', '1']);
  });

  it('the count reported includes the children — it is what the person is shown', async () => {
    const db = seededShares();
    const report = await deleteUserData(db, 'victim');
    const row = report.collections.find((c) => c.collection === 'shares');
    expect(row!.deleted, '1 share + 3 feedback documents').toBe(4);
    expect(report.totalDeleted).toBe(4);
  });

  it('🔒 a handle that cannot reach subcollections REPORTS the failure instead of a false success', async () => {
    const db = seededShares(false);
    const report = await deleteUserData(db, 'victim');
    const row = report.collections.find((c) => c.collection === 'shares');
    expect(row!.error, 'it must say it could not reach the subcollection').toMatch(/cannot reach the 'feedback' subcollection/);
    expect(row!.deleted).toBe(0);
    // And it must NOT have deleted the parent, which would have orphaned the messages for ever.
    expect(db.surviving('shares')).toEqual(['share-mine', 'share-theirs']);
    expect(db.survivingSub('shares', 'share-mine', 'feedback')).toEqual(['0', '1', '2']);
  });
});

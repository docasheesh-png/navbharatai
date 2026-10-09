/**
 * AN ERASE THAT DELETES THE PARENT AND LEAVES THE CHILDREN IS NOT AN ERASE.
 *
 * 🔴 THE CLASS, and it has already happened once. Q-134 (2026-10-05) found the account erase deleting
 * each workspace's latest diagnostics report and leaving its whole `history` subcollection behind —
 * every past build report, unreachable and kept — because Firestore does not cascade and the registry
 * entry named no subcollection.
 *
 * `USER_SCOPED_SUBCOLLECTIONS` fixed that for one SHAPE: `parent/{uid}/sub`, a document whose own id is
 * the uid. It cannot express the other shape, which Q-701 found: `agentv3_conversations/{conversationId}`
 * is matched by a `userId` FIELD, and the messages live under it in `turns` and `timeline`. Registering
 * that collection without its children would have deleted the conversation's header and orphaned every
 * message in it — a fix that LOOKS done while the personal data stays, with the deletion page promising
 * "every build conversation you had with the builder".
 *
 * So these tests hold three things:
 *   1. the children really are deleted, and before the parent;
 *   2. only the right person's are;
 *   3. a database handle that CANNOT reach subcollections fails loudly rather than reporting a
 *      deletion that did not happen.
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
  /** `collection/docId/sub` → ids */
  private subs = new Map<string, Set<string>>();
  readonly deletions: string[] = [];
  /** When false, a matched document's ref offers no `collection()` — an older or narrower handle. */
  constructor(private readonly subcollectionsReachable = true) {}

  seedDoc(collection: string, id: string, row: Row): void {
    if (!this.docs.has(collection)) this.docs.set(collection, new Map());
    this.docs.get(collection)!.set(id, row);
  }
  seedSub(collection: string, id: string, sub: string, subIds: string[]): void {
    this.subs.set(`${collection}/${id}/${sub}`, new Set(subIds));
  }
  surviving(collection: string): string[] { return [...(this.docs.get(collection) ?? new Map()).keys()].sort(); }
  survivingSub(collection: string, id: string, sub: string): string[] {
    return [...(this.subs.get(`${collection}/${id}/${sub}`) ?? new Set())].sort();
  }

  collection(name: string) {
    const self = this;
    const col = () => { if (!self.docs.has(name)) self.docs.set(name, new Map()); return self.docs.get(name)!; };
    const subRefFor = (id: string) => (sub: string) => {
      const key = `${name}/${id}/${sub}`;
      return {
        limit(n: number) {
          return {
            async get() {
              const ids = [...(self.subs.get(key) ?? new Set())].slice(0, n);
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

/** Build a database holding two people's conversations, each with messages. */
function seeded(reachable = true): NestingFirestore {
  const db = new NestingFirestore(reachable);
  db.seedDoc('agentv3_conversations', 'conv-mine', { userId: 'victim', appName: 'My app' });
  db.seedSub('agentv3_conversations', 'conv-mine', 'turns', ['0', '1', '2']);
  db.seedSub('agentv3_conversations', 'conv-mine', 'timeline', ['0']);
  db.seedDoc('agentv3_conversations', 'conv-theirs', { userId: 'bystander', appName: 'Their app' });
  db.seedSub('agentv3_conversations', 'conv-theirs', 'turns', ['0', '1']);
  return db;
}

describe('the erase reaches every child, not just the parent', () => {
  it('the registry declares the conversation subcollections at all', () => {
    const entry = USER_SCOPED_COLLECTIONS.find((c) => c.collection === 'agentv3_conversations');
    expect(entry, 'agentv3_conversations is not in the erase registry').toBeTruthy();
    expect(entry!.subs, 'its messages live in subcollections and must be named').toEqual(['turns', 'timeline']);
  });

  it('the messages are deleted, not orphaned', async () => {
    const db = seeded();
    await deleteUserData(db, 'victim');
    expect(db.surviving('agentv3_conversations')).toEqual(['conv-theirs']);
    expect(db.survivingSub('agentv3_conversations', 'conv-mine', 'turns')).toEqual([]);
    expect(db.survivingSub('agentv3_conversations', 'conv-mine', 'timeline')).toEqual([]);
  });

  it('🔒 children go BEFORE the parent — the other order leaves them unreachable', async () => {
    const db = seeded();
    await deleteUserData(db, 'victim');
    const parentAt = db.deletions.indexOf('agentv3_conversations/conv-mine');
    const lastChildAt = db.deletions.reduce(
      (last, d, i) => (d.startsWith('agentv3_conversations/conv-mine/') ? i : last), -1,
    );
    expect(lastChildAt, 'no child was deleted at all').toBeGreaterThanOrEqual(0);
    expect(parentAt).toBeGreaterThan(lastChildAt);
  });

  it("another person's conversation and messages are untouched", async () => {
    const db = seeded();
    await deleteUserData(db, 'victim');
    expect(db.survivingSub('agentv3_conversations', 'conv-theirs', 'turns')).toEqual(['0', '1']);
  });

  it('the count reported includes the children — it is what the person is shown', async () => {
    const db = seeded();
    const report = await deleteUserData(db, 'victim');
    const row = report.collections.find((c) => c.collection === 'agentv3_conversations');
    expect(row!.deleted, '1 conversation + 3 turns + 1 timeline chunk').toBe(5);
  });

  it('🔒 a handle that cannot reach subcollections REPORTS the failure instead of a false success', async () => {
    const db = seeded(false);
    const report = await deleteUserData(db, 'victim');
    const row = report.collections.find((c) => c.collection === 'agentv3_conversations');
    expect(row!.error, 'it must say it could not reach the subcollection').toMatch(/cannot reach the 'turns' subcollection/);
    // And it must NOT have deleted the parent, which would have orphaned the messages for ever.
    expect(db.surviving('agentv3_conversations')).toEqual(['conv-mine', 'conv-theirs']);
  });
});

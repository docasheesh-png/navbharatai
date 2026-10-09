/**
 * Q-682 — MY DOCUMENT, UNDER SOMEBODY ELSE'S PARENT: THE FIFTH REACHABILITY SHAPE.
 *
 * 🔴 WHAT STAYED BEHIND. `teams/{ownerUid}/members/{memberUid}` holds a member's uid, email, role and
 * join date. The four shapes account deletion could express all assume the eraser can REACH the parent:
 *
 *   1. the doc id IS the uid                        (`deleteUserData` `'docId'`)
 *   2. a field EQUALS the uid                       (`deleteUserData` `{field}`)
 *   3. the doc id is a workspace id in my range     (`deleteUserWorkspaceData`)
 *   4. the doc id or a field is DERIVED from a key  (`derivedIdErase`, Q-761/764/784)
 *
 * This is the mirror image: the DOCUMENT is mine — its id is my uid — and the PARENT is somebody else's.
 * No key the eraser holds points at that parent, so there was nothing to query and nothing to declare,
 * and a departing member's uid and email stayed in every team they had ever joined. `removeMember` is no
 * help: it writes `status: 'removed'` and keeps the record on purpose, so the team can show who left.
 *
 * 🔴 AND THE TEAM ITSELF WAS CLASSIFIED AS NOBODY'S, on a sentence that was true about the wrong noun.
 * The census said `platform` — "a team outlives any one member". It does outlive a MEMBER. But
 * `teamId === owner uid` (`TeamStore.ts:14`, and `requireTeamManager` short-circuits on `uid === teamId`),
 * so the document id IS a person's uid. Nothing in the repository ever deleted a team, so an owner's
 * team, its member list — holding OTHER people's email addresses — and its shared library survived their
 * account for ever.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  deleteUserData, USER_SCOPED_COLLECTIONS, FOREIGN_PARENT_USER_DOCS,
  type RetentionFirestore,
} from '../src/server/lib/DataRetentionManager';

/** An in-memory Firestore with real subcollections, enough of them to tell a half-erase from a full one. */
function fakeDb(seed: Record<string, Record<string, unknown>> = {}) {
  const data = new Map<string, Map<string, Record<string, unknown>>>();
  for (const [path, rows] of Object.entries(seed)) {
    data.set(path, new Map(Object.entries(rows).map(([id, row]) => [id, row as Record<string, unknown>])));
  }
  const col = (name: string) => {
    if (!data.has(name)) data.set(name, new Map());
    return data.get(name)!;
  };
  const docHandle = (name: string, id: string) => ({
    async get() { return { exists: col(name).has(id) }; },
    async delete() { col(name).delete(id); },
    collection(sub: string) {
      const path = `${name}/${id}/${sub}`;
      return {
        limit(n: number) {
          return {
            async get() {
              const ids = [...col(path).keys()].slice(0, n);
              return { docs: ids.map((sid) => ({ ref: { async delete() { col(path).delete(sid); } } })) };
            },
          };
        },
        doc(sid: string) {
          return {
            async get() { return { exists: col(path).has(sid) }; },
            async delete() { col(path).delete(sid); },
          };
        },
      };
    },
  });
  const db: RetentionFirestore = {
    collection: (name: string) => ({
      doc: (id: string) => docHandle(name, id),
      async listDocuments() { return [...col(name).keys()].map((id) => docHandle(name, id)); },
      where: (field: string, op: '==' | '<', value: unknown) => {
        const q = {
          limit: () => q,
          async get() {
            const out: Array<{ ref: { delete(): Promise<unknown>; collection?(s: string): unknown } }> = [];
            for (const [id, row] of col(name)) {
              if (op === '==' ? row[field] === value : false) out.push({ ref: docHandle(name, id) });
            }
            return { docs: out };
          },
        };
        return q;
      },
    }),
  };
  return { db, count: (path: string) => col(path).size, has: (path: string, id: string) => col(path).has(id) };
}

const ME = 'me123';
const OTHER = 'other99';

describe('Q-682 — a departing member leaves no row in anybody else\'s team', () => {
  it('🔴 deletes MY member record from a team somebody ELSE owns', async () => {
    const f = fakeDb({
      teams: { [OTHER]: { name: "their team" } },
      [`teams/${OTHER}/members`]: {
        [ME]: { uid: ME, email: 'me@example.com', status: 'active' },
        [OTHER]: { uid: OTHER, email: 'them@example.com', status: 'active' },
      },
    });
    await deleteUserData(f.db, ME);
    expect(f.has(`teams/${OTHER}/members`, ME), 'my uid and email must not stay in their team').toBe(false);
    // And the team, and its owner's own row, are untouched: they are not mine to delete.
    expect(f.has('teams', OTHER)).toBe(true);
    expect(f.has(`teams/${OTHER}/members`, OTHER)).toBe(true);
  });

  it('🔴 a "removed" member row is still MY data, and still goes', async () => {
    // `removeMember` writes `status: 'removed'` and keeps the record deliberately, so the team can show
    // who left. That is fine while the account exists and is not fine afterwards.
    const f = fakeDb({
      teams: { [OTHER]: {} },
      [`teams/${OTHER}/members`]: { [ME]: { uid: ME, email: 'me@example.com', status: 'removed' } },
    });
    await deleteUserData(f.db, ME);
    expect(f.has(`teams/${OTHER}/members`, ME)).toBe(false);
  });

  it('sweeps every team, not just the first one it finds', async () => {
    const f = fakeDb({
      teams: { a: {}, b: {}, c: {} },
      'teams/a/members': { [ME]: { uid: ME } },
      'teams/b/members': { someone: { uid: 'someone' } },
      'teams/c/members': { [ME]: { uid: ME } },
    });
    const report = await deleteUserData(f.db, ME);
    expect(f.has('teams/a/members', ME)).toBe(false);
    expect(f.has('teams/c/members', ME)).toBe(false);
    expect(f.count('teams/b/members')).toBe(1);
    expect(report.collections.find((c) => c.collection === 'teams/*/members/{uid}')?.deleted).toBe(2);
  });

  it('reports zero, with no error, when the person was in no team', async () => {
    const f = fakeDb({ teams: { [OTHER]: {} }, [`teams/${OTHER}/members`]: { [OTHER]: {} } });
    const report = await deleteUserData(f.db, ME);
    const row = report.collections.find((c) => c.collection === 'teams/*/members/{uid}');
    expect(row).toMatchObject({ deleted: 0 });
    expect(row?.error).toBeUndefined();
  });

  it('🔒 a handle that cannot LIST parents fails loudly instead of reporting a clean erase', async () => {
    // Silently skipping would leave other people's email addresses in every team they had joined while
    // the report said the account was fully erased.
    const broken: RetentionFirestore = {
      collection: () => ({
        doc: () => ({ async get() { return { exists: false }; }, async delete() {} }),
        where: () => ({ async get() { return { docs: [] }; } }),
      }),
    };
    const report = await deleteUserData(broken, ME);
    const row = report.collections.find((c) => c.collection === 'teams/*/members/{uid}');
    expect(row?.error).toMatch(/cannot list parent documents/);
  });
});

describe('Q-682 — the team a person OWNS dies with them, children first', () => {
  it('🔴 erases the owner\'s team, its member list and its shared library', async () => {
    const f = fakeDb({
      teams: { [ME]: { name: 'my team' }, [OTHER]: { name: 'theirs' } },
      [`teams/${ME}/members`]: { [ME]: { uid: ME }, friend: { uid: 'friend', email: 'f@example.com' } },
      [`teams/${ME}/library`]: { snip1: { content: 'x' }, snip2: { content: 'y' } },
      [`teams/${OTHER}/members`]: { [OTHER]: { uid: OTHER } },
    });
    await deleteUserData(f.db, ME);
    expect(f.has('teams', ME), 'the team id IS the owner uid — it is their record').toBe(false);
    expect(f.count(`teams/${ME}/members`), "a team's member list holds OTHER people's emails").toBe(0);
    expect(f.count(`teams/${ME}/library`)).toBe(0);
    // Somebody else's team is untouched.
    expect(f.has('teams', OTHER)).toBe(true);
    expect(f.count(`teams/${OTHER}/members`)).toBe(1);
  });

  it('🔴 CHILDREN FIRST — and the `docId` branch used to ignore `subs` entirely', async () => {
    /**
     * This is the third place in this repository where "delete the parent, forget the children" had to
     * be fixed: `deleteUserData`'s field branch (Q-701), `purgeExpired` (Q-767), and the `docId` branch
     * here. It was latent only because every entry with `subs` happened to be a `{field}` one — the
     * registry would have declared the children and no code would have read it.
     */
    const src = readFileSync(resolve(__dirname, '../src/server/lib/DataRetentionManager.ts'), 'utf8');
    const docIdBranch = src.slice(src.indexOf("if (entry.key === 'docId')"), src.indexOf('} else {', src.indexOf("if (entry.key === 'docId')")));
    expect(docIdBranch, 'the docId branch must sweep declared subs').toMatch(/for \(const sub of entry\.subs \?\? \[\]\)/);
    // Swept whether or not the parent exists: Firestore keeps a subcollection under a missing parent.
    const f = fakeDb({ [`teams/${ME}/members`]: { [ME]: { uid: ME } } });
    await deleteUserData(f.db, ME);
    expect(f.count(`teams/${ME}/members`), 'an orphaned child is exactly how Q-134 lost data').toBe(0);
  });

  it('the registry says both of the team\'s children, and the right key', () => {
    const entry = USER_SCOPED_COLLECTIONS.find((c) => c.collection === 'teams');
    expect(entry, 'a team belongs to the account whose uid IS its id').toBeDefined();
    expect(entry!.key).toBe('docId');
    expect(entry!.subs).toEqual(['members', 'library']);
  });

  it('the fifth-shape registry names the team membership, with its reason', () => {
    expect(FOREIGN_PARENT_USER_DOCS.map((f) => `${f.parent}/${f.sub}`)).toContain('teams/members');
    for (const f of FOREIGN_PARENT_USER_DOCS) expect(f.why.length).toBeGreaterThan(30);
  });
});

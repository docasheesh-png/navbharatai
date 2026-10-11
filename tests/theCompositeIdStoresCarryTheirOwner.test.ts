/**
 * A DOCUMENT ID NOTHING CAN SEARCH BY — and the three stores that had one.
 *
 * 🔴 THE SHAPE (Q-762, Q-765). `adrDecisions` and `techDebt` key on `${userId}__${projectId}`, and
 * `app_ai_apps` keys on the app id. The erase registry is exact-match only by design — `docId` or a
 * field — so a composite id reaches it only if the BODY carries the uid. `adrDecisions` and `techDebt`
 * carried nothing: the person's own architecture decisions and tech-debt list outlived their account
 * with no way to find them. Both writers now store `userId`.
 *
 * ⚠️ A doc-id PREFIX RANGE was considered and refused. `workspaceDataErase.ts` documents why in its
 * own words: a uid that contains the separator makes `a__b` ambiguous with `a` + `b__…`, and getting
 * that wrong deletes a DIFFERENT person's data. A compliance gap is recoverable; that is not.
 *
 * These tests pin three things: both writers really store the field, the registry really queries it,
 * and — stated rather than implied — a row written BEFORE the change is NOT reached.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { USER_SCOPED_COLLECTIONS, deleteUserData, type RetentionFirestore } from '../src/server/lib/DataRetentionManager';

const root = resolve(__dirname, '..');
const read = (rel: string): string => readFileSync(join(root, rel), 'utf8');

type Row = Record<string, unknown>;
class TinyFirestore implements RetentionFirestore {
  private data = new Map<string, Map<string, Row>>();
  seed(c: string, id: string, row: Row): void {
    if (!this.data.has(c)) this.data.set(c, new Map());
    this.data.get(c)!.set(id, row);
  }
  ids(c: string): string[] { return [...(this.data.get(c) ?? new Map()).keys()].sort(); }
  private col(n: string): Map<string, Row> {
    if (!this.data.has(n)) this.data.set(n, new Map());
    return this.data.get(n)!;
  }
  collection(name: string) {
    const col = this.col(name);
    return {
      doc(id: string) {
        return { async get() { return { exists: col.has(id) }; }, async delete() { col.delete(id); } };
      },
      where(field: string, op: '==' | '<', value: unknown) {
        return {
          async get() {
            const hits: string[] = [];
            for (const [id, row] of col) if (op === '==' && row[field] === value) hits.push(id);
            return { docs: hits.map((id) => ({ ref: { async delete() { col.delete(id); } } })) };
          },
        };
      },
    };
  }
}

const KEYED_BY_USER_ID = ['adrDecisions', 'techDebt', 'app_ai_apps'] as const;

describe('the three composite-id stores are erased by the field their writers store', () => {
  it('🔒 each is in the registry, queried by `userId`', () => {
    for (const name of KEYED_BY_USER_ID) {
      const entry = USER_SCOPED_COLLECTIONS.find((c) => c.collection === name);
      expect(entry, `${name} is in no erase path`).toBeTruthy();
      expect(entry!.key, `${name} must be reached by its field, not its id`).toEqual({ field: 'userId' });
    }
  });

  it('🔒 both writers really store `userId` — the registry entry is worthless without it', () => {
    // Read the source, not the registry: an entry that queries a field no document has would report a
    // confident `deleted: 0` for ever, which is the failure mode this whole class keeps producing.
    expect(read('src/server/AgentV3/adrMemory.ts'), 'adrDecisions must write userId')
      .toMatch(/tx\.set\(ref, \{ userId,/);
    expect(read('src/server/AppMakerLab/intelligence/TechnicalDebtTracker.ts'), 'techDebt must write userId')
      .toMatch(/\{ userId, items: merged/);
    expect(read('src/server/lib/AppAiRegistryStore.ts'), 'app_ai_apps must write userId')
      .toMatch(/userId: userId \|\| ''/);
  });

  it('the cascade deletes the right person\'s rows and nobody else\'s', async () => {
    const db = new TinyFirestore();
    db.seed('adrDecisions', 'victim__proj1', { userId: 'victim', records: [1] });
    db.seed('adrDecisions', 'bystander__proj1', { userId: 'bystander', records: [1] });
    db.seed('techDebt', 'victim__proj1', { userId: 'victim', items: [1] });
    db.seed('techDebt', 'bystander__proj2', { userId: 'bystander', items: [1] });
    db.seed('app_ai_apps', 'app-a', { userId: 'victim', workspaceId: 'agentv3-victim-s1' });
    db.seed('app_ai_apps', 'app-b', { userId: 'bystander', workspaceId: 'agentv3-bystander-s1' });

    await deleteUserData(db, 'victim');

    expect(db.ids('adrDecisions')).toEqual(['bystander__proj1']);
    expect(db.ids('techDebt')).toEqual(['bystander__proj2']);
    expect(db.ids('app_ai_apps')).toEqual(['app-b']);
  });

  it('🟡 a row written BEFORE the field existed is NOT reached — the residue, stated not hidden', async () => {
    // This is deliberately asserted rather than left to a comment. The honest claim is "new rows are
    // covered", and a test that proved otherwise would be the thing to disbelieve.
    const db = new TinyFirestore();
    db.seed('adrDecisions', 'victim__old', { records: [1], updatedAt: 'x' }); // no userId
    db.seed('techDebt', 'victim__old', { items: [1] });                        // no userId
    await deleteUserData(db, 'victim');
    expect(db.ids('adrDecisions')).toEqual(['victim__old']);
    expect(db.ids('techDebt')).toEqual(['victim__old']);
  });

  it('…and it self-heals on the next write, which is why it is a residue and not a hole', () => {
    // `adrDecisions` replaces the whole document (`merge: false`) and `techDebt` merges into it, so an
    // ACTIVE project's row gains `userId` the next time that project is built. Only an abandoned
    // project's row stays unreachable. Pinned here so the claim in PROGRESS.md is checkable.
    expect(read('src/server/AgentV3/adrMemory.ts')).toMatch(/tx\.set\(ref, \{ userId,[\s\S]{0,80}\{ merge: false \}\)/);
    expect(read('src/server/AppMakerLab/intelligence/TechnicalDebtTracker.ts'))
      .toMatch(/\{ userId, items: merged[\s\S]{0,60}\{ merge: true \}\)/);
  });

  it('a doc-id prefix range is NOT used anywhere for these — the ambiguity is unacceptable', () => {
    // The refused alternative, pinned: if a future change reaches for `startAt(uid)` on these ids, the
    // reason it was refused should fail a test rather than live only in a comment.
    const drm = read('src/server/lib/DataRetentionManager.ts');
    expect(drm).not.toMatch(/startAt\(|endAt\(/);
  });
});

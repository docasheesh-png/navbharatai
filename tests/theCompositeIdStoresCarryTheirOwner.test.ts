// Composite keys and workspace hashes can join multiple owners' historical data.
// A latest userId field remains useful metadata, but does not authenticate earlier
// merged arrays or nonce generations. Real-writer regressions live in
// mixedOwnerEngineeringErasure.test.ts; these retain registry/field inventory coverage.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { USER_SCOPED_COLLECTIONS, deleteUserData, type RetentionFirestore } from '../src/server/lib/DataRetentionManager';

const root = resolve(__dirname, '..');
const read = (rel: string): string => readFileSync(join(root, rel), 'utf8');

type Row = Record<string, unknown>;
class TinyFirestore implements RetentionFirestore {
  private data = new Map<string, Map<string, Row>>();
  accessed: string[] = [];
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
    this.accessed.push(name);
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

describe('composite-id stores remain registered while legacy ownership is unverified', () => {
  it('🔒 each keeps its userId inventory and explicit attribution refusal', () => {
    for (const name of KEYED_BY_USER_ID) {
      const entry = USER_SCOPED_COLLECTIONS.find((c) => c.collection === name);
      expect(entry, `${name} is in no erase path`).toBeTruthy();
      expect(entry!.key, `${name} metadata inventory remains intact`).toEqual({ field: 'userId' });
      expect(entry!.erasePolicy).toBe('ownership-unverified');
      expect(entry!.eraseRefusalReason).toMatch(/ownership cannot be confirmed/);
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

  it('the cascade retains legacy rows regardless of latest userId while exact platform records still delete', async () => {
    const db = new TinyFirestore();
    db.seed('adrDecisions', 'victim__proj1', { userId: 'victim', records: [1] });
    db.seed('adrDecisions', 'bystander__proj1', { userId: 'bystander', records: [1] });
    db.seed('techDebt', 'victim__proj1', { userId: 'victim', items: [1] });
    db.seed('techDebt', 'bystander__proj2', { userId: 'bystander', items: [1] });
    db.seed('app_ai_apps', 'app-a', { userId: 'victim', workspaceId: 'agentv3-victim-s1' });
    db.seed('app_ai_apps', 'app-b', { userId: 'bystander', workspaceId: 'agentv3-bystander-s1' });

    db.seed('users', 'victim', { own: true });
    const report = await deleteUserData(db, 'victim');

    expect(db.ids('adrDecisions')).toEqual(['bystander__proj1', 'victim__proj1']);
    expect(db.ids('techDebt')).toEqual(['bystander__proj2', 'victim__proj1']);
    expect(db.ids('app_ai_apps')).toEqual(['app-a', 'app-b']);
    expect(db.ids('users')).toEqual([]);
    for (const name of KEYED_BY_USER_ID) {
      expect(db.accessed).not.toContain(name);
      expect(report.collections.find((entry) => entry.collection === name)).toMatchObject({ deleted: 0, refusal: 'ownership-unverified' });
    }
  });

  it('🟡 a legacy row without owner metadata is retained too', async () => {
    const db = new TinyFirestore();
    db.seed('adrDecisions', 'victim__old', { records: [1], updatedAt: 'x' }); // no userId
    db.seed('techDebt', 'victim__old', { items: [1] });                        // no userId
    await deleteUserData(db, 'victim');
    expect(db.ids('adrDecisions')).toEqual(['victim__old']);
    expect(db.ids('techDebt')).toEqual(['victim__old']);
  });

  it('writers keep their existing metadata contracts; rewriting userId does not establish earlier ownership', () => {
    // Both writers carry prior arrays into their next write; the real writer tests
    // prove that replacing the parent userId does not attribute every retained item.
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

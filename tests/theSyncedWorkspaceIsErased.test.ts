/**
 * Historical manifests and chunks share a namespace. Constructing exact keys
 * cannot distinguish another UID's manifest from this UID's chunk, so account
 * deletion must retain these bytes and report the ownership limitation.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  eraseSyncedWorkspace, SYNC_COLLECTION, SYNC_WORKSPACE_OWNERSHIP_ERASURE_LIMITATION,
  type SyncEraseFirestore,
} from '../src/server/lib/syncWorkspaceErase';
import { chunkDocId, maxChunkCount, DEFAULT_CHUNK_SIZE, MAX_WORKSPACE_BYTES } from '../src/server/project/WorkspaceStore';

const root = resolve(__dirname, '..');
const read = (rel: string): string => readFileSync(join(root, rel), 'utf8');

/** Stateful records expose actual foreign deletion, rather than only call shape. */
class RecordingFirestore implements SyncEraseFirestore {
  private docs = new Map<string, Record<string, unknown>>();
  readonly queried: string[] = [];
  readonly read: string[] = [];
  readonly deleted: string[] = [];
  seed(path: string, body: Record<string, unknown>): void { this.docs.set(path, body); }
  snapshot(): [string, Record<string, unknown>][] { return structuredClone([...this.docs]); }
  collection(name: string) {
    this.queried.push(name);
    const self = this;
    return {
      doc(id: string) {
        const key = `${name}/${id}`;
        return {
          async get() {
            self.read.push(key);
            const body = self.docs.get(key);
            return { exists: self.docs.has(key), data: () => body };
          },
          async delete() { self.deleted.push(key); self.docs.delete(key); },
        };
      },
    };
  }
}

function expectNoIo(db: RecordingFirestore): void {
  expect(db.queried).toEqual([]);
  expect(db.read).toEqual([]);
  expect(db.deleted).toEqual([]);
}

describe('sync erasure requires independent ownership proof', () => {
  it.each(['abc', 'abc__c0'])('retains foreign bytes at the manifest/chunk collision when deleting %s', async (uid) => {
    const db = new RecordingFirestore();
    db.seed(`${SYNC_COLLECTION}/abc`, { version: 2, chunkCount: 1, userId: 'abc' });
    // One document can be either the second account's manifest or the first
    // account's chunk. Both are valid writes in the historical physical format.
    db.seed(`${SYNC_COLLECTION}/abc__c0`, uid === 'abc'
      ? { version: 2, chunkCount: 1, userId: 'abc__c0', private: 'foreign manifest' }
      : { data: 'foreign chunk belonging to abc' });
    db.seed(`${SYNC_COLLECTION}/abc__c0__c0`, { data: 'second account chunk' });
    db.seed(`${SYNC_COLLECTION}/bystander`, { version: 1, private: 'unrelated bytes' });
    const before = db.snapshot();

    expect(chunkDocId('abc', 0)).toBe('abc__c0');
    const report = await eraseSyncedWorkspace(db, uid);

    // Reverting the destructive body must fail on persisted foreign bytes before
    // checking the additive refusal fields or the absence of datastore calls.
    expect(db.snapshot(), 'foreign manifest/chunk bytes must survive account deletion').toEqual(before);
    expectNoIo(db);
    expect(report).toEqual({
      uid, chunks: 0, manifestDeleted: false, probed: 0,
      refusal: 'ownership-unverified', limitations: [SYNC_WORKSPACE_OWNERSHIP_ERASURE_LIMITATION],
    });
  });

  it.each(['victim', 'firebaseGeneratedUid123', 'abc-d', 'abc__c0', 'with/slash', 'anon'])('refuses every UID spelling without consulting the datastore: %s', async (uid) => {
    const db = new RecordingFirestore();
    db.seed(`${SYNC_COLLECTION}/${uid}`, { version: 2, userId: uid, chunkCount: 1 });
    db.seed(`${SYNC_COLLECTION}/${chunkDocId(uid, 0)}`, { userId: uid, data: 'owner-shaped fields are not proof' });
    const before = db.snapshot();
    const report = await eraseSyncedWorkspace(db, uid);
    expect(db.snapshot()).toEqual(before);
    expectNoIo(db);
    expect(report.refusal).toBe('ownership-unverified');
    expect(report.chunks).toBe(0);
    expect(report.manifestDeleted).toBe(false);
    expect(report.probed).toBe(0);
  });

  it('retains a legacy inline workspace and reports the same limitation', async () => {
    const db = new RecordingFirestore();
    db.seed(`${SYNC_COLLECTION}/victim`, { sessions: [{ id: 's1' }], lastApp: 'private app' });
    const before = db.snapshot();
    const report = await eraseSyncedWorkspace(db, 'victim');
    expect(db.snapshot()).toEqual(before);
    expectNoIo(db);
    expect(report.limitations).toEqual([SYNC_WORKSPACE_OWNERSHIP_ERASURE_LIMITATION]);
    expect(report.manifestDeleted).toBe(false);
  });

  it('reports unverified ownership even when the injected store has no workspace', async () => {
    const db = new RecordingFirestore();
    const report = await eraseSyncedWorkspace(db, 'ghost');
    expectNoIo(db);
    expect(report.refusal).toBe('ownership-unverified');
    expect(report.error).toBeUndefined();
    expect(report.chunks).toBe(0);
    expect(report.manifestDeleted).toBe(false);
    expect(report.probed).toBe(0);
  });

  it('keeps the invalid-input report and performs no datastore operations', async () => {
    const db = new RecordingFirestore();
    const report = await eraseSyncedWorkspace(db, '');
    expect(report.error).toMatch(/non-empty uid/);
    expect(report.chunks).toBe(0);
    expect(report.manifestDeleted).toBe(false);
    expect(report.probed).toBe(0);
    expectNoIo(db);
  });

  it('does not invoke a broken datastore while ownership is unverified', async () => {
    const broken: SyncEraseFirestore = {
      collection: () => { throw new Error('unverified erasure must not consult Firestore'); },
    };
    const report = await eraseSyncedWorkspace(broken, 'victim');
    expect(report.refusal).toBe('ownership-unverified');
    expect(report.error).toBeUndefined();
    expect(report.limitations).toEqual([SYNC_WORKSPACE_OWNERSHIP_ERASURE_LIMITATION]);
  });
});

describe('the historical sync format is accurately documented', () => {
  it('the sync writer imports the shared chunk builder', () => {
    const writer = read('src/server/project/syncTransaction.ts');
    expect(writer).toMatch(/import \{[\s\S]*?chunkDocId[\s\S]*?\} from '\.\/WorkspaceStore'/);
    const sync = read('src/server/routes/sync.ts');
    for (const src of [writer, sync]) expect(src).not.toMatch(/const chunkDocId\s*=/);
    expect(sync).toMatch(/from '\.\.\/project\/syncTransaction'/);
  });

  it('the layout comment matches the actual colliding physical key', () => {
    const store = read('src/server/project/WorkspaceStore.ts');
    const documented = store.match(/user_workspaces\/\{userId\}(\S*)\s+→\s+\{ data/);
    expect(documented).toBeTruthy();
    const real = chunkDocId('{userId}', 0).replace('{userId}', '');
    expect(documented![1].replace('{i}', '0')).toBe(real);
  });

  it('the format ceiling covers both the current and smaller historical chunk sizes', () => {
    expect(maxChunkCount()).toBeGreaterThanOrEqual(Math.ceil(MAX_WORKSPACE_BYTES / DEFAULT_CHUNK_SIZE));
    expect(maxChunkCount()).toBeGreaterThanOrEqual(Math.ceil(MAX_WORKSPACE_BYTES / (DEFAULT_CHUNK_SIZE / 2)));
  });
});

describe('the account deletion route exposes the sync result', () => {
  it('calls the sync helper and reports its ownership refusal', () => {
    const route = read('src/server/routes/profile.ts');
    expect(route).toMatch(/eraseSyncedWorkspace\(/);
    expect(route).toMatch(/\n\s*synced,/);
  });
});

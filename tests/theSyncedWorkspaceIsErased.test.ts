/**
 * THE SYNCED WORKSPACE MUST GO WITH THE ACCOUNT — AND THE MANIFEST MUST GO LAST.
 *
 * 🔴 THE TRAP THIS EXISTS FOR (Q-763). `user_workspaces/{uid}` is the most obvious `'docId'` entry in
 * the repo: the document id IS the uid. It is also only a MANIFEST — `{ version, chunkCount, … }` —
 * while the person's whole synced workspace lives in `user_workspaces/{uid}__c{i}`.
 *
 * Registering it with the retention manager as `'docId'` would therefore have deleted the INDEX and
 * kept the DATA: an erase that reports success, passes every existing test, and leaves the workspace
 * in our database for ever — unreachable, because the manifest that counted its chunks is gone. That
 * is worse than the state before the "fix", and it is the third appearance of one shape: Q-134 (a
 * subcollection left behind), Q-701 PR A (`agentv3_conversations`, caught before it shipped), this.
 *
 * So these tests hold four things:
 *   1. the chunks really are deleted, and the manifest too;
 *   2. the manifest goes LAST, asserted on the recorded delete ORDER — reversed, a failure in between
 *      strands the chunks with nothing left pointing at them;
 *   3. chunks the manifest does NOT count are swept as well, because a save writes chunks first and
 *      the manifest last and deletes surplus chunks when a workspace shrinks — either step can be
 *      interrupted;
 *   4. nobody else's documents are touched, and an empty uid is refused rather than attempted.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  eraseSyncedWorkspace, SYNC_COLLECTION, type SyncEraseFirestore,
} from '../src/server/lib/syncWorkspaceErase';
import { chunkDocId, maxChunkCount, DEFAULT_CHUNK_SIZE, MAX_WORKSPACE_BYTES } from '../src/server/project/WorkspaceStore';

const root = resolve(__dirname, '..');
const read = (rel: string): string => readFileSync(join(root, rel), 'utf8');

/** A Firestore just large enough, which records the ORDER of deletes. */
class RecordingFirestore implements SyncEraseFirestore {
  private docs = new Map<string, Record<string, unknown>>();
  readonly deleted: string[] = [];
  seed(path: string, body: Record<string, unknown>): void { this.docs.set(path, body); }
  has(path: string): boolean { return this.docs.has(path); }
  get size(): number { return this.docs.size; }
  collection(name: string) {
    const self = this;
    return {
      doc(id: string) {
        const key = `${name}/${id}`;
        return {
          async get() {
            const body = self.docs.get(key);
            return { exists: self.docs.has(key), data: () => body };
          },
          async delete() { self.deleted.push(key); self.docs.delete(key); },
        };
      },
    };
  }
}

function seeded(chunkCount = 3, extraOrphans = 0): RecordingFirestore {
  const db = new RecordingFirestore();
  db.seed(`${SYNC_COLLECTION}/victim`, { userId: 'victim', version: 2, chunkCount, totalBytes: 42 });
  for (let i = 0; i < chunkCount + extraOrphans; i++) {
    db.seed(`${SYNC_COLLECTION}/${chunkDocId('victim', i)}`, { data: `part-${i}` });
  }
  // A bystander, with the same shape, who must come out untouched.
  db.seed(`${SYNC_COLLECTION}/bystander`, { userId: 'bystander', version: 2, chunkCount: 2 });
  db.seed(`${SYNC_COLLECTION}/${chunkDocId('bystander', 0)}`, { data: 'theirs-0' });
  db.seed(`${SYNC_COLLECTION}/${chunkDocId('bystander', 1)}`, { data: 'theirs-1' });
  return db;
}

describe('the synced workspace is erased with the account', () => {
  it('the chunks and the manifest are all gone', async () => {
    const db = seeded(3);
    const report = await eraseSyncedWorkspace(db, 'victim');
    expect(report.chunks).toBe(3);
    expect(report.manifestDeleted).toBe(true);
    expect(db.has(`${SYNC_COLLECTION}/victim`)).toBe(false);
    for (let i = 0; i < 3; i++) expect(db.has(`${SYNC_COLLECTION}/${chunkDocId('victim', i)}`)).toBe(false);
  });

  it('🔒 the manifest goes LAST — reversed, a failure in between strands the chunks for ever', async () => {
    const db = seeded(3);
    await eraseSyncedWorkspace(db, 'victim');
    const manifestAt = db.deleted.indexOf(`${SYNC_COLLECTION}/victim`);
    const lastChunkAt = db.deleted.reduce(
      (last, k, i) => (k.startsWith(`${SYNC_COLLECTION}/victim__c`) ? i : last), -1,
    );
    expect(lastChunkAt, 'no chunk was deleted at all').toBeGreaterThanOrEqual(0);
    expect(manifestAt, 'the manifest must be the last thing to go').toBeGreaterThan(lastChunkAt);
  });

  it('🔒 chunks the manifest does not count are swept too — an interrupted save leaves those', async () => {
    // The manifest says 2; three chunk documents exist, because a shrinking save was interrupted
    // before it deleted the surplus one. A sweep that trusted `chunkCount` would leave chunk 2.
    const db = seeded(2, 1);
    const report = await eraseSyncedWorkspace(db, 'victim');
    expect(report.chunks).toBe(3);
    expect(db.has(`${SYNC_COLLECTION}/${chunkDocId('victim', 2)}`)).toBe(false);
    expect(report.probed).toBe(maxChunkCount());
  });

  it("another person's manifest and chunks are untouched", async () => {
    const db = seeded(3);
    await eraseSyncedWorkspace(db, 'victim');
    expect(db.has(`${SYNC_COLLECTION}/bystander`)).toBe(true);
    expect(db.has(`${SYNC_COLLECTION}/${chunkDocId('bystander', 0)}`)).toBe(true);
    expect(db.has(`${SYNC_COLLECTION}/${chunkDocId('bystander', 1)}`)).toBe(true);
  });

  it('a legacy v1 workspace — one inline document, no chunkCount — is deleted too', async () => {
    const db = new RecordingFirestore();
    db.seed(`${SYNC_COLLECTION}/victim`, { sessions: [{ id: 's1' }], lastApp: 'app' });
    const report = await eraseSyncedWorkspace(db, 'victim');
    expect(report.manifestDeleted).toBe(true);
    expect(report.chunks).toBe(0);
    expect(db.size).toBe(0);
  });

  it('🔒 an empty uid is REFUSED, not attempted — `__c0` is a real document belonging to nobody', async () => {
    const db = seeded(3);
    const before = db.size;
    const report = await eraseSyncedWorkspace(db, '');
    expect(report.error).toMatch(/non-empty uid/);
    expect(report.chunks).toBe(0);
    expect(db.size, 'nothing may be deleted on an empty uid').toBe(before);
  });

  it('a missing workspace is not an error — it reports nothing deleted', async () => {
    const db = new RecordingFirestore();
    const report = await eraseSyncedWorkspace(db, 'ghost');
    expect(report.error).toBeUndefined();
    expect(report.chunks).toBe(0);
    expect(report.manifestDeleted).toBe(false);
  });

  it('a failure is reported, never thrown — account deletion must not be blocked by this step', async () => {
    const broken: SyncEraseFirestore = {
      collection: () => ({ doc: () => ({ async get() { throw new Error('firestore is down'); }, async delete() { /* unreachable */ } }) }),
    };
    const report = await eraseSyncedWorkspace(broken, 'victim');
    expect(report.error).toMatch(/firestore is down/);
  });
});

describe('one definition of the chunk id, and the documented layout matches it', () => {
  it('🔒 `routes/sync.ts` no longer builds the id itself — it imports the shared builder', () => {
    const sync = read('src/server/routes/sync.ts');
    expect(sync, 'sync.ts must import chunkDocId rather than define it').toMatch(/import \{[\s\S]*?chunkDocId[\s\S]*?\} from '\.\.\/project\/WorkspaceStore'/);
    expect(sync, 'a second definition of the chunk id would be free to drift from the eraser')
      .not.toMatch(/const chunkDocId\s*=/);
  });

  it('🔒 the layout comment says the id the builder actually produces', () => {
    // It used to say `{userId}_chunk_{i}` while every real document was `{userId}__c{i}`. The only
    // written description of the layout disagreed with the only implementation of it, and an eraser
    // that trusted the comment would have deleted nothing and reported success.
    const store = read('src/server/project/WorkspaceStore.ts');
    const documented = store.match(/user_workspaces\/\{userId\}(\S*)\s+→\s+\{ data/);
    expect(documented, "the header must document the chunk document's path").toBeTruthy();
    const real = chunkDocId('{userId}', 0).replace('{userId}', '');
    expect(documented![1].replace('{i}', '0'), 'the comment and the builder disagree').toBe(real);
  });

  it('the sweep ceiling really covers the size cap — with room for a smaller historical chunk size', () => {
    expect(maxChunkCount()).toBeGreaterThanOrEqual(Math.ceil(MAX_WORKSPACE_BYTES / DEFAULT_CHUNK_SIZE));
    // Half the current chunk size would need twice as many chunks; the ceiling still covers it.
    expect(maxChunkCount()).toBeGreaterThanOrEqual(Math.ceil(MAX_WORKSPACE_BYTES / (DEFAULT_CHUNK_SIZE / 2)));
  });
});

describe('the deletion route actually calls it', () => {
  it('🔒 `DELETE /api/profile` erases the synced workspace and reports it', () => {
    const route = read('src/server/routes/profile.ts');
    expect(route).toMatch(/eraseSyncedWorkspace\(/);
    // Reported on its own line, so somebody checking whether their workspace is gone can see it.
    expect(route).toMatch(/\n\s*synced,/);
  });
});

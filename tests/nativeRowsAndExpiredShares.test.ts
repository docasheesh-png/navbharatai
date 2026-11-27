/**
 * Q-3702 — a native build's job rows leave with the account (and the collection census can see them).
 * Q-3704 — an expired share link is purged: page, feedback, record, in pointer order, bounded per run.
 *
 * The census half of Q-3702 is locked in `everyCollectionIsClassified.test.ts` (form 5's witnesses); the runner half
 * (a file saved for a row that is gone is deleted) in `nativeCloudBuildRunner.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { USER_SCOPED_COLLECTIONS } from '../src/server/lib/DataRetentionManager';
import {
  SHARE_PURGE_BATCH, SHARE_PURGE_GRACE_MS, purgeExpiredShares, shareHtmlObjectPath, type ExpiredShareDeps,
} from '../src/server/lib/ShareStore';

const root = join(__dirname, '..');

describe('Q-3702 — native build job rows are erased with the account, after their files', () => {
  it('`mobile_native_builds` is erased by its `userId` field', () => {
    expect(USER_SCOPED_COLLECTIONS.find((c) => c.collection === 'mobile_native_builds')?.key).toEqual({ field: 'userId' });
  });

  it('the files go first: DELETE /api/profile erases the artifacts before the registry erases the rows', () => {
    const profile = readFileSync(join(root, 'src/server/routes/profile.ts'), 'utf8');
    const del = profile.slice(profile.indexOf("app.delete('/api/profile'"));
    expect(del.indexOf('eraseUserNativeArtifacts(identity.uid)')).toBeGreaterThan(0);
    expect(del.indexOf('eraseUserNativeArtifacts(identity.uid)')).toBeLessThan(del.indexOf('deleteUserData(db, identity.uid)'));
  });

  it('the signing keys and their events are erased too, keys first (Q-3703, admin decision (a))', () => {
    const names = USER_SCOPED_COLLECTIONS.map((c) => c.collection);
    expect(USER_SCOPED_COLLECTIONS.find((c) => c.collection === 'mobile_signing_keys')?.key).toEqual({ field: 'userId' });
    expect(USER_SCOPED_COLLECTIONS.find((c) => c.collection === 'mobile_signing_key_events')?.key).toEqual({ field: 'userId' });
    expect(names.indexOf('mobile_signing_keys')).toBeLessThan(names.indexOf('mobile_signing_key_events'));
  });
});

// ─────────────────────────────────────────── Q-3704 ───────────────────────────────────────────
const NOW = Date.parse('2026-11-26T10:00:00Z');
const T1 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const T2 = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const T3 = 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';

function shareWorld(shares: Array<{ token: string; ownerId: string; htmlPath?: string; expiresAt: number; feedback?: number }>) {
  const records = new Map(shares.map((s) => [s.token, { ...s }]));
  const objects = new Set(shares.map((s) => s.htmlPath).filter((p): p is string => !!p));
  const log: string[] = [];
  const deps: ExpiredShareDeps = {
    async listExpired(before, limit) {
      return [...records.values()].filter((r) => r.expiresAt < before).slice(0, limit);
    },
    async deleteObject(p) { log.push(`page:${p}`); objects.delete(p); },
    async deleteFeedback(token) { log.push(`feedback:${token}`); const n = records.get(token)?.feedback ?? 0; records.get(token)!.feedback = 0; return n; },
    async deleteRecord(token) { log.push(`record:${token}`); records.delete(token); },
  };
  return { deps, records, objects, log };
}

describe('Q-3704 — an expired share link is purged after its grace, page and feedback before the record', () => {
  const longAgo = NOW - SHARE_PURGE_GRACE_MS - 1;

  it('purges only shares past expiry + grace, deleting page, then feedback, then the record', async () => {
    const page = shareHtmlObjectPath('owner1', T1);
    const w = shareWorld([
      { token: T1, ownerId: 'owner1', htmlPath: page, expiresAt: longAgo, feedback: 3 },
      { token: T2, ownerId: 'owner2', expiresAt: longAgo },
      { token: T3, ownerId: 'owner3', expiresAt: NOW - 1000 }, // expired, still inside its grace
    ]);
    const r = await purgeExpiredShares(w.deps, NOW);
    expect(r).toEqual({ scanned: 2, purged: 2, pagesDeleted: 1, feedbackDeleted: 3, kept: 0, refused: 0, more: false });
    expect([...w.records.keys()]).toEqual([T3]);
    expect(w.objects.size).toBe(0);
    expect(w.log.slice(0, 3)).toEqual([`page:${page}`, `feedback:${T1}`, `record:${T1}`]);
  });

  it('a page or feedback delete that fails KEEPS the record (the pointer) for the next run, and says so', async () => {
    const page = shareHtmlObjectPath('owner1', T1);
    const w = shareWorld([{ token: T1, ownerId: 'owner1', htmlPath: page, expiresAt: longAgo }, { token: T2, ownerId: 'o2', expiresAt: longAgo }]);
    const r = await purgeExpiredShares({ ...w.deps, deleteObject: async () => { throw new Error('denied'); } }, NOW);
    expect(r).toMatchObject({ purged: 1, kept: 1 });
    expect(w.records.has(T1)).toBe(true);
    const f = shareWorld([{ token: T1, ownerId: 'o1', expiresAt: longAgo }]);
    expect(await purgeExpiredShares({ ...f.deps, deleteFeedback: async () => { throw new Error('denied'); } }, NOW)).toMatchObject({ purged: 0, kept: 1 });
    expect(f.records.has(T1)).toBe(true);
  });

  it('a record pointing at a page outside its own path is refused, never deleted through', async () => {
    const victim = shareHtmlObjectPath('someoneElse', T2);
    const w = shareWorld([{ token: T1, ownerId: 'owner1', htmlPath: victim, expiresAt: longAgo }]);
    const r = await purgeExpiredShares(w.deps, NOW);
    expect(r).toMatchObject({ purged: 0, refused: 1 });
    expect(w.objects.has(victim)).toBe(true);
    expect(w.records.has(T1)).toBe(true);
  });

  it('bounded per run, says when more are waiting, and an unlistable store is an error, not a quiet zero', async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ token: `${'D'.repeat(31)}${i}`, ownerId: 'o', expiresAt: longAgo }));
    const w = shareWorld(many);
    expect(await purgeExpiredShares(w.deps, NOW, 3)).toMatchObject({ scanned: 3, purged: 3, more: true });
    expect(w.records.size).toBe(2);
    expect(SHARE_PURGE_BATCH).toBeGreaterThan(0);
    expect(await purgeExpiredShares({ ...w.deps, listExpired: async () => { throw new Error('down'); } }, NOW))
      .toMatchObject({ purged: 0, error: expect.stringMatching(/could not be listed/) });
  });

  it('the server runs it daily, exclusive, under the same opt-in as the retention purge', () => {
    const server = readFileSync(join(root, 'server.ts'), 'utf8');
    const gate = server.indexOf("if (envFlag('DATA_RETENTION_PURGE_ENABLED')) {");
    const job = server.indexOf("id: 'expired-share-purge'");
    expect(gate).toBeGreaterThan(0);
    expect(job).toBeGreaterThan(gate);
    expect(job).toBeLessThan(server.indexOf('bootRun = () =>', gate));
    expect(server.slice(job, job + 400)).toMatch(/exclusive: true/);
    expect(server.slice(job, job + 1200)).toMatch(/purgeExpiredShares\(deps\)/);
  });
});

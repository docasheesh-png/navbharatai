/**
 * Q-3611 · Q-3612 · Q-3613 · Q-3614 — deleting an account deletes the bucket objects only a record (or nothing) could find.
 *
 * THE CLASS (Q-3410's, found by its storage census): an object written for ONE user under a key that names something
 * else — a share token, a content hash, an upload id — is invisible to the account eraser, and the record that points
 * at it is erased by `deleteUserData`, so the object outlives the account for ever. Each of the four stores now has an
 * eraser that DELETE /api/profile calls with the VERIFIED uid, BEFORE the records that point at the objects are gone,
 * and each reports its own line where a failure is a failure, never a removal.
 *
 *   Q-3611  large share-link HTML      → new pages filed under the verified owner; legacy ones through their own record
 *   Q-3612  never-public APK bytes     → deleted before the listing, only when no other listing names the same object
 *   Q-3613  unfinished zip-upload parts → each record's chunk folder before the record, plus an abandoned-upload sweep
 *   Q-3614  native .apk / .aab files   → the owner-hashed folder, running builds stopped first
 *
 * The census in `accountDeletionReachesGameProofPictures.test.ts` requires each eraser to be called by the route.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  eraseUserShareHtml, isOwnShareHtmlPath, shareHtmlObjectPath, shareHtmlOwnerPrefix, type ShareEraseDeps,
} from '../src/server/lib/ShareStore';
import {
  ZIP_UPLOAD_ABANDONED_MS, eraseUserZipUploadChunks, sweepAbandonedZipUploads, type SharedUploadRecord, type ZipUploadCleanupDeps,
} from '../src/server/lib/zipUploadStore';
import {
  RUNNING_NATIVE_BUILD_LIMITATION, artifactObjectPath, artifactOwnerPrefix, eraseUserNativeArtifacts, type NativeArtifactEraseDeps,
} from '../src/server/lib/mobileBuild/nativeArtifactStore';
import {
  CREATOR_GONE, deIdentifyPublishedListings, LISTING_POLICIES, type ListingFirestore, type ListingObjectDeps,
} from '../src/server/lib/publishedListingErase';
import { verifiedOwnerKeySegment } from '../src/server/lib/workspaceAssetStorage';
import type { MobileBuildState } from '../src/server/lib/mobileBuild/types';

const root = join(__dirname, '..');
const ME = 'leaverUid123';
const OTHER = 'stayerUid456';
const TOKEN_A = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const TOKEN_B = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const TOKEN_C = 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';

/** A bucket over a key set with exact prefix semantics. */
function bucket(keys: string[]) {
  const objects = new Set(keys);
  const log: string[] = [];
  return {
    objects, log,
    async deleteObject(path: string) { log.push(`object:${path}`); objects.delete(path); },
    async deletePrefix(prefix: string) { log.push(`prefix:${prefix}`); for (const k of [...objects]) if (k.startsWith(prefix)) objects.delete(k); },
  };
}

// ─────────────────────────────────────────── Q-3611 ───────────────────────────────────────────
describe('Q-3611 — a large share link page leaves with its owner', () => {
  it('a new page is filed under the VERIFIED owner; an owner with no usable id keeps the legacy key', () => {
    const seg = verifiedOwnerKeySegment(ME)!;
    expect(shareHtmlObjectPath(ME, TOKEN_A)).toBe(`shares/${seg}/${TOKEN_A}.html`);
    expect(shareHtmlOwnerPrefix(ME)).toBe(`shares/${seg}/`);
    expect(shareHtmlObjectPath('', TOKEN_A)).toBe(`shares/${TOKEN_A}.html`);
    // A legacy key has no slash after `shares/`, so it can never fall inside any owner's folder.
    expect(`shares/${TOKEN_A}.html`.startsWith(shareHtmlOwnerPrefix(ME)!)).toBe(false);
    // The store writes through that function, never a token-only path again.
    const src = readFileSync(join(root, 'src/server/lib/ShareStore.ts'), 'utf8');
    expect(src).toMatch(/const path = shareHtmlObjectPath\(share\.ownerId, share\.token\);/);
  });

  it('deletes the owner folder and each legacy page its OWN record points at; another owner\'s pages stay', async () => {
    const seg = verifiedOwnerKeySegment(ME)!;
    const otherSeg = verifiedOwnerKeySegment(OTHER)!;
    const b = bucket([
      `shares/${seg}/${TOKEN_A}.html`, // new layout, record already gone — still reached
      `shares/${TOKEN_B}.html`, // legacy, mine
      `shares/${TOKEN_C}.html`, // legacy, theirs
      `shares/${otherSeg}/${TOKEN_C}x.html`,
    ]);
    const deps: ShareEraseDeps = {
      ...b,
      async listOwnedShares(uid) {
        expect(uid).toBe(ME);
        return [{ token: TOKEN_B, ownerId: ME, htmlPath: `shares/${TOKEN_B}.html` }, { token: 'small', ownerId: ME }];
      },
    };
    const r = await eraseUserShareHtml(ME, deps);
    expect(r).toEqual({ attempted: true, htmlRemoved: true, legacyObjectsDeleted: 1, ownerFolderDeleted: true, failures: [] });
    expect([...b.objects].sort()).toEqual([`shares/${TOKEN_C}.html`, `shares/${otherSeg}/${TOKEN_C}x.html`].sort());
  });

  it('a record pointing anywhere but its own path is refused and reported, never trusted', async () => {
    const otherSeg = verifiedOwnerKeySegment(OTHER)!;
    const victim = `shares/${otherSeg}/${TOKEN_C}.html`;
    const b = bucket([victim, `shares/${TOKEN_C}.html`, 'nav-store/apk/x.apk']);
    const deps: ShareEraseDeps = {
      ...b,
      async listOwnedShares() {
        return [
          { token: TOKEN_A, ownerId: ME, htmlPath: victim },
          { token: TOKEN_A, ownerId: ME, htmlPath: `shares/${TOKEN_C}.html` },
          { token: TOKEN_A, ownerId: ME, htmlPath: 'nav-store/apk/x.apk' },
        ];
      },
    };
    const r = await eraseUserShareHtml(ME, deps);
    expect(r.htmlRemoved).toBe(false);
    expect(r.failures).toEqual([expect.stringMatching(/3 share link record\(s\) pointed at a page outside their own path/)]);
    expect(b.objects.size).toBe(3);
    expect(isOwnShareHtmlPath(`shares/${TOKEN_A}.html`, TOKEN_A, ME)).toBe(true);
    expect(isOwnShareHtmlPath('shares/../x.html', '..', ME)).toBe(false);
  });

  it('no store, an unusable uid, a folder delete, a listing or a page delete that fails: each is a failure', async () => {
    expect(await eraseUserShareHtml(ME, null)).toMatchObject({ htmlRemoved: false, failures: [expect.stringMatching(/not configured/)] });
    expect(await eraseUserShareHtml('anon', bucket([]) as unknown as ShareEraseDeps)).toMatchObject({ htmlRemoved: false, failures: [expect.stringMatching(/No usable account id/)] });
    const base = { ...bucket([]), listOwnedShares: async () => [] };
    expect(await eraseUserShareHtml(ME, { ...base, deletePrefix: async () => { throw new Error('denied'); } }))
      .toMatchObject({ htmlRemoved: false, ownerFolderDeleted: false, failures: [expect.stringMatching(/folder/)] });
    expect(await eraseUserShareHtml(ME, { ...base, listOwnedShares: async () => { throw new Error('down'); } }))
      .toMatchObject({ htmlRemoved: false, failures: [expect.stringMatching(/could not be listed/)] });
    expect(await eraseUserShareHtml(ME, {
      ...base,
      listOwnedShares: async () => [{ token: TOKEN_B, ownerId: ME, htmlPath: `shares/${TOKEN_B}.html` }],
      deleteObject: async () => { throw new Error('denied'); },
    })).toMatchObject({ htmlRemoved: false, legacyObjectsDeleted: 0, failures: [expect.stringMatching(/1 large share link page/)] });
  });
});

// ─────────────────────────────────────────── Q-3612 ───────────────────────────────────────────
function listingDb(rows: Record<string, Record<string, unknown>>, log: string[]) {
  const col = new Map(Object.entries(rows));
  const db: ListingFirestore = {
    collection: (name: string) => ({
      where: (field: string, _op: '==', value: unknown) => ({
        async get() {
          const docs = name !== 'nav_store_apps' ? [] : [...col].filter(([, r]) => r[field] === value).map(([id, row]) => ({
            id,
            data: () => row,
            ref: {
              async update(patch: Record<string, unknown>) { log.push(`update:${id}`); for (const [k, v] of Object.entries(patch)) { if (v === null) delete row[k]; else row[k] = v; } },
              async delete() { log.push(`delete:${id}`); col.delete(id); },
            },
          }));
          return { docs };
        },
      }),
    }),
  };
  return { db, col };
}
const APK1 = `nav-store/apk/${'1'.repeat(64)}.apk`;
const APK2 = `nav-store/apk/${'2'.repeat(64)}.apk`;
const APK3 = `nav-store/apk/${'3'.repeat(64)}.apk`;

describe('Q-3612 — a never-public APK\'s bytes leave with their listing', () => {
  const objectsOver = (b: ReturnType<typeof bucket>, all: Map<string, Record<string, unknown>>): ListingObjectDeps => ({
    async referencedElsewhere(_c, field, path, exceptId) { return [...all].some(([id, r]) => id !== exceptId && r[field] === path); },
    deleteObject: b.deleteObject,
  });

  it('the APK is deleted BEFORE the listing; a shared object and a public listing\'s APK stay', async () => {
    const log: string[] = [];
    const { db, col } = listingDb({
      pend: { uid: ME, status: 'pending', storagePath: APK1, developer: { email: 'me@x' } },
      rej: { uid: ME, status: 'rejected', storagePath: APK2 },
      twin: { uid: OTHER, status: 'approved', storagePath: APK2 }, // same bytes, somebody else's listing
      live: { uid: ME, status: 'approved', storagePath: APK3 },
    }, log);
    const b = bucket([APK1, APK2, APK3]);
    const deps = objectsOver(b, col);
    const wrapped: ListingObjectDeps = { ...deps, async deleteObject(p) { log.push(`object:${p}`); await b.deleteObject(p); } };
    const r = await deIdentifyPublishedListings(db, ME, LISTING_POLICIES, wrapped);
    const apps = r.collections.find((c) => c.collection === 'nav_store_apps')!;
    expect(apps).toMatchObject({ deleted: 2, deIdentified: 1, objectsDeleted: 1, objectsKeptShared: 1, objectsNotConfirmed: 0 });
    expect(r.objectsNotConfirmed).toBe(0);
    expect(log.indexOf(`object:${APK1}`)).toBeGreaterThanOrEqual(0);
    expect(log.indexOf(`object:${APK1}`)).toBeLessThan(log.indexOf('delete:pend'));
    expect([...b.objects].sort()).toEqual([APK2, APK3].sort()); // shared kept, public kept (Q-766)
  });

  it('an APK that could not be confirmed deleted keeps its listing — de-identified and unlisted, counted, never "deleted"', async () => {
    const log: string[] = [];
    const { db, col } = listingDb({ pend: { uid: ME, status: 'pending', storagePath: APK1, developer: { email: 'me@x' } } }, log);
    const failing: ListingObjectDeps = { referencedElsewhere: async () => false, deleteObject: async () => { throw new Error('denied'); } };
    const r = await deIdentifyPublishedListings(db, ME, LISTING_POLICIES, failing);
    expect(r.objectsNotConfirmed).toBe(1);
    expect(r.collections.find((c) => c.collection === 'nav_store_apps')).toMatchObject({ deleted: 0, deIdentified: 1, objectsNotConfirmed: 1 });
    expect(col.get('pend')).toMatchObject({ uid: CREATOR_GONE, status: 'removed', storagePath: APK1 });
    expect(col.get('pend')!.developer).toBeUndefined();
    // With no object store at all, the same: the pointer is never thrown away blind.
    const again = listingDb({ p2: { uid: ME, status: 'pending', storagePath: APK1 } }, []);
    expect((await deIdentifyPublishedListings(again.db, ME, LISTING_POLICIES, null)).objectsNotConfirmed).toBe(1);
    expect(again.col.has('p2')).toBe(true);
  });

  it('the route hands the eraser the APK bucket, and the store refuses any path it did not write', () => {
    const profile = readFileSync(join(root, 'src/server/routes/profile.ts'), 'utf8');
    expect(profile).toMatch(/deIdentifyPublishedListings\(listingDb, identity\.uid, undefined, navStoreApkObjects\(\)\)/);
    const store = readFileSync(join(root, 'src/server/lib/navStoreStore.ts'), 'utf8');
    expect(store).toMatch(/if \(!isApkObjectPath\(path\)\) throw/);
    // The republish cleanup no longer deletes a content-addressed object another listing still names.
    const route = readFileSync(join(root, 'src/server/routes/navStore.ts'), 'utf8');
    expect(route).toMatch(/await deleteApkIfUnreferenced\(existing\.storagePath, id\)/);
    expect(route).not.toMatch(/await deleteApk\(existing\.storagePath\)/);
  });
});

// ─────────────────────────────────────────── Q-3613 ───────────────────────────────────────────
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const U3 = '33333333-3333-4333-8333-333333333333';
const NOW = Date.parse('2026-11-26T10:00:00Z');

function zipStore(records: SharedUploadRecord[], folders: string[]) {
  const recs = new Map(records.map((r) => [r.uploadId, r]));
  const chunks = new Set(folders);
  const log: string[] = [];
  const deps: ZipUploadCleanupDeps = {
    async listOwnedUploads(uid) { return [...recs.values()].filter((r) => r.uid === uid); },
    async getRecord(id) { return recs.get(id) ?? null; },
    async listChunkFolders() { return [...chunks]; },
    async deleteChunks(id) { log.push(`chunks:${id}`); chunks.delete(id); },
    async deleteRecord(id) { log.push(`record:${id}`); recs.delete(id); },
  };
  return { deps, recs, chunks, log };
}
const rec = (uploadId: string, uid: string, createdAt = NOW): SharedUploadRecord => ({ uploadId, uid, fileName: 'a.zip', createdAt });

describe('Q-3613 — an unfinished zip upload\'s parts leave with their owner', () => {
  it('each of the owner\'s uploads loses its parts FIRST, then its record; another owner\'s upload stays', async () => {
    const z = zipStore([rec(U1, ME), rec(U2, ME), rec(U3, OTHER)], [U1, U2, U3]);
    const r = await eraseUserZipUploadChunks(ME, z.deps);
    expect(r).toEqual({ attempted: true, chunksRemoved: true, uploadsCleared: 2, failures: [] });
    expect([...z.chunks]).toEqual([U3]);
    expect([...z.recs.keys()]).toEqual([U3]);
    expect(z.log.indexOf(`chunks:${U1}`)).toBeLessThan(z.log.indexOf(`record:${U1}`));
  });

  it('parts that could not be deleted keep their record and are reported; a record with a bad id is never a prefix', async () => {
    const z = zipStore([rec(U1, ME), rec('../everything', ME)], [U1]);
    const r = await eraseUserZipUploadChunks(ME, { ...z.deps, deleteChunks: async () => { throw new Error('denied'); } });
    expect(r.chunksRemoved).toBe(false);
    expect(r.uploadsCleared).toBe(0);
    expect(r.failures).toEqual([expect.stringMatching(/1 unfinished zip upload/), expect.stringMatching(/not a real upload id/)]);
    expect(z.recs.has(U1)).toBe(true);
    expect(await eraseUserZipUploadChunks(ME, null)).toMatchObject({ chunksRemoved: false, failures: [expect.stringMatching(/not configured/)] });
    expect(await eraseUserZipUploadChunks(ME, { ...z.deps, listOwnedUploads: async () => { throw new Error('down'); } }))
      .toMatchObject({ chunksRemoved: false, failures: [expect.stringMatching(/could not be listed/)] });
  });

  it('the sweep reaps parts whose record is gone or abandoned, and never one in flight or one it could not check', async () => {
    const z = zipStore(
      [rec(U2, ME, NOW - 60_000), rec(U3, OTHER, NOW - ZIP_UPLOAD_ABANDONED_MS - 1)],
      [U1, U2, U3, 'not-an-upload-id'],
    );
    expect((await sweepAbandonedZipUploads(z.deps, NOW)).sort()).toEqual([U1, U3].sort());
    expect([...z.chunks].sort()).toEqual([U2, 'not-an-upload-id'].sort());
    expect(z.recs.has(U3)).toBe(false);
    const unreadable = zipStore([], [U1]);
    expect(await sweepAbandonedZipUploads({ ...unreadable.deps, getRecord: async () => { throw new Error('down'); } }, NOW)).toEqual([]);
    expect(unreadable.chunks.has(U1)).toBe(true);
  });

  it('starting an upload is what runs the sweep', () => {
    const src = readFileSync(join(root, 'src/server/lib/zipUploadStore.ts'), 'utf8');
    const begin = src.slice(src.indexOf('export async function beginSharedUpload'), src.indexOf('export async function getSharedUpload'));
    expect(begin).toMatch(/maybeSweepAbandonedZipUploads\(\)/);
  });
});

// ─────────────────────────────────────────── Q-3614 ───────────────────────────────────────────
function nativeDeps(jobs: Array<{ id: string; userId: string; state: MobileBuildState }>, cancelTo: MobileBuildState = 'cancelled') {
  const log: string[] = [];
  const b = bucket([
    artifactObjectPath(ME, `nb_${'a'.repeat(32)}`, 'app.apk'),
    artifactObjectPath(ME, `nb_${'b'.repeat(32)}`, 'app.aab'),
    artifactObjectPath(OTHER, `nb_${'c'.repeat(32)}`, 'app.apk'),
  ]);
  const deps: NativeArtifactEraseDeps = {
    async deletePrefix(p) { log.push(`prefix:${p}`); await b.deletePrefix(p); },
    async listJobs(uid) { return jobs.filter((j) => j.userId === uid); },
    async requestCancel(id) { log.push(`cancel:${id}`); return { state: cancelTo }; },
  };
  return { deps, log, b };
}

describe('Q-3614 — a finished phone app file leaves with its owner', () => {
  it('the eraser\'s folder is exactly where the runner files artifacts, and only this owner\'s', async () => {
    expect(artifactObjectPath(ME, `nb_${'a'.repeat(32)}`, 'app.apk').startsWith(artifactOwnerPrefix(ME))).toBe(true);
    expect(artifactOwnerPrefix(ME)).toMatch(/^mobile-builds\/[0-9a-f]{24}\/$/);
    const n = nativeDeps([]);
    const r = await eraseUserNativeArtifacts(ME, n.deps);
    expect(r).toEqual({ attempted: true, artifactsRemoved: true, ownerFolderDeleted: true, runningBuildsStopped: 0, failures: [], limitations: [] });
    expect([...n.b.objects]).toEqual([artifactObjectPath(OTHER, `nb_${'c'.repeat(32)}`, 'app.apk')]);
  });

  it('a running build is stopped BEFORE the folder goes; one that has not stopped yet is said, not hidden', async () => {
    const jobs = [
      { id: 'nb_run', userId: ME, state: 'building' as MobileBuildState },
      { id: 'nb_done', userId: ME, state: 'completed' as MobileBuildState },
    ];
    const n = nativeDeps(jobs, 'cancelling');
    const r = await eraseUserNativeArtifacts(ME, n.deps);
    expect(n.log).toEqual(['cancel:nb_run', `prefix:${artifactOwnerPrefix(ME)}`]);
    expect(r).toMatchObject({ runningBuildsStopped: 1, ownerFolderDeleted: true, artifactsRemoved: false, limitations: [RUNNING_NATIVE_BUILD_LIMITATION] });
    const stopped = nativeDeps(jobs, 'cancelled');
    expect(await eraseUserNativeArtifacts(ME, stopped.deps)).toMatchObject({ artifactsRemoved: true, limitations: [] });
  });

  it('a folder delete or a job check that fails is a failure, never a removal', async () => {
    const n = nativeDeps([]);
    expect(await eraseUserNativeArtifacts(ME, { ...n.deps, deletePrefix: async () => { throw new Error('No artifact bucket is configured'); } }))
      .toMatchObject({ artifactsRemoved: false, ownerFolderDeleted: false, failures: [expect.stringMatching(/could not be confirmed removed/)] });
    const m = nativeDeps([]);
    const r = await eraseUserNativeArtifacts(ME, { ...m.deps, listJobs: async () => { throw new Error('down'); } });
    expect(r).toMatchObject({ artifactsRemoved: false, ownerFolderDeleted: true, failures: [expect.stringMatching(/could not be checked/)] });
    expect(await eraseUserNativeArtifacts('', m.deps)).toMatchObject({ attempted: false, artifactsRemoved: false });
  });
});

// ──────────────────────────────────────── the route ────────────────────────────────────────
describe('DELETE /api/profile calls every eraser with the VERIFIED uid, in the order the pointers require', () => {
  const profile = readFileSync(join(root, 'src/server/routes/profile.ts'), 'utf8');
  const del = profile.slice(profile.indexOf("app.delete('/api/profile'"));
  const at = (s: string) => del.indexOf(s);

  it.each([
    ['eraseUserShareHtml(identity.uid)', 'shareLinkPages'],
    ['eraseUserZipUploadChunks(identity.uid)', 'zipUploadChunks'],
    ['eraseUserNativeArtifacts(identity.uid)', 'nativeBuildFiles'],
  ])('%s runs before the records and the sign-in are erased, and reports its own line', (call, line) => {
    expect(at(call), `${call} is not called by the deletion route`).toBeGreaterThan(0);
    // Before `deleteUserData` erases `shares` / `zip_uploads` — the only pointers to the legacy objects.
    expect(at(call)).toBeLessThan(at('deleteUserData(db, identity.uid)'));
    expect(at(call)).toBeLessThan(at('deleteAuthAccount(identity.uid)'));
    expect(del).toMatch(new RegExp(`\\n\\s+${line},\\n`));
  });
});

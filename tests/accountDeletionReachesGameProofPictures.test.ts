/**
 * Q-3410: deleting an account deletes that user's game proof pictures before their 30 days end.
 *
 * THE CLASS. An object written to a bucket for ONE user, under a key that names something other than that user (a build
 * id, a token, an upload id), cannot be found by the account eraser — so it outlives the account. #4557 filed the proof
 * pictures by build id; the fix files them by the VERIFIED owner (`game-proof-v2/<day>/<owner>/…`) and DELETE
 * /api/profile now erases that owner's folder in every day.
 *
 * The census at the bottom is the guard for the class: every server module that touches Cloud Storage is registered
 * with how its objects leave when their owner deletes the account (or why they are not per-user, or the open queue row
 * that owns the gap). A new storage writer fails here until somebody answers that question for it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LEGACY_PROOF_PICTURE_LIMITATION, eraseUserProofPictures, keepProofPictures, proofPictureKey, type ProofPictureStore,
} from '../src/server/AgentV3/gameProofPictures';
import { verifiedOwnerKeySegment, workspaceAssetVerifiedOwnerPrefix } from '../src/server/lib/workspaceAssetStorage';
import { createHash } from 'node:crypto';

const root = join(__dirname, '..');
const NOW = Date.parse('2026-11-26T10:00:00Z');
const jpeg = (fill: number) => { const b = Buffer.alloc(2000, fill); b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; return b; };
const idOf = (b: Buffer) => createHash('sha256').update(b).digest('hex').slice(0, 12);

/** A store over a key→bytes map that obeys prefix semantics exactly like the bucket (listDays = day folders). */
function bucketLike(): ProofPictureStore & { objects: Map<string, Buffer>; deleted: string[] } {
  const objects = new Map<string, Buffer>();
  const deleted: string[] = [];
  return {
    objects, deleted,
    async save(key, bytes) { objects.set(key, bytes); },
    async read(key) { return objects.get(key) ?? null; },
    async listDays() { return [...new Set([...objects.keys()].map((k) => k.split('/').slice(0, 2).join('/') + '/'))]; },
    async deletePrefix(prefix) { deleted.push(prefix); for (const k of [...objects.keys()]) if (k.startsWith(prefix)) objects.delete(k); },
  };
}

async function keepFor(store: ProofPictureStore, uid: string, buildId: string, fill: number, nowMs: number): Promise<string> {
  const bytes = jpeg(fill);
  const path = `/tmp/nbai-playtest-proof/start-${idOf(bytes)}.jpg`;
  const r = await keepProofPictures({
    verifiedOwnerUid: uid, buildId, nowMs, store,
    shots: [{ view: 'start', id: idOf(bytes), w: 480, h: 270, bytes: bytes.length, path }],
    read: async (p) => (p === path ? bytes : null),
  });
  expect(r.notKept).toEqual([]);
  return r.kept[0].key;
}

describe('the key names the VERIFIED owner, in the one shared encoding', () => {
  it('the owner segment is the same encoding the workspace-asset eraser uses, one path level, never for anon', () => {
    expect(verifiedOwnerKeySegment('abc')).toBe(Buffer.from('abc').toString('base64url'));
    expect(workspaceAssetVerifiedOwnerPrefix('abc')).toBe(`workspace-assets-v2/${verifiedOwnerKeySegment('abc')}/`);
    for (const bad of [null, undefined, '', 'anon', 'a/b', 'x'.repeat(65)]) expect(verifiedOwnerKeySegment(bad)).toBeNull();
    // The longest allowed uid still fits the key pattern.
    expect(proofPictureKey('u'.repeat(64), 'b', 'start', 'aaaaaaaaaaaa', NOW)).toMatch(/^game-proof-v2\/2026-11-26\/[A-Za-z0-9_-]+\/b\/start-aaaaaaaaaaaa\.jpg$/);
  });

  it('a key carries its owner; two owners never share a folder, even when one uid prefixes the other', () => {
    const a = proofPictureKey('abc', 'b-1', 'start', 'aaaaaaaaaaaa', NOW)!;
    const b = proofPictureKey('abcd', 'b-1', 'start', 'aaaaaaaaaaaa', NOW)!;
    expect(a).toBe(`game-proof-v2/2026-11-26/${verifiedOwnerKeySegment('abc')}/b-1/start-aaaaaaaaaaaa.jpg`);
    expect(b.startsWith(`game-proof-v2/2026-11-26/${verifiedOwnerKeySegment('abc')}/`)).toBe(false);
    expect(proofPictureKey(null, 'b-1', 'start', 'aaaaaaaaaaaa', NOW)).toBeNull();
  });
});

describe('the account eraser deletes this user\'s pictures, and nobody else\'s', () => {
  it('every day folder of the leaving user goes; another user\'s, on the same days, stays', async () => {
    const store = bucketLike();
    const mine1 = await keepFor(store, 'leaver', 'b-1', 1, NOW);
    const mine2 = await keepFor(store, 'leaver', 'b-2', 2, NOW - 5 * 86_400_000);
    const theirs1 = await keepFor(store, 'stayer', 'b-3', 3, NOW);
    const theirs2 = await keepFor(store, 'leaverX', 'b-4', 4, NOW - 5 * 86_400_000); // a uid the leaver's uid prefixes
    const r = await eraseUserProofPictures('leaver', store, NOW);
    expect(r).toMatchObject({ attempted: true, ownerPicturesRemoved: true, foldersDeleted: 2, failures: [], limitations: [] });
    expect(store.objects.has(mine1)).toBe(false);
    expect(store.objects.has(mine2)).toBe(false);
    expect([...store.objects.keys()].sort()).toEqual([theirs1, theirs2].sort());
    // Only owner folders were named — never a whole day (which would take everybody's pictures).
    for (const p of store.deleted) expect(p).toMatch(new RegExp(`^game-proof-v2/\\d{4}-\\d{2}-\\d{2}/${verifiedOwnerKeySegment('leaver')}/$`));
  });

  it('legacy owner-less pictures are not guessed at: kept until day 30, and the limitation is said while any remain', async () => {
    const store = bucketLike();
    store.objects.set('game-proof-v1/2026-11-20/b-old/start-aaaaaaaaaaaa.jpg', jpeg(5));
    const r = await eraseUserProofPictures('leaver', store, NOW);
    expect(r.limitations).toEqual([LEGACY_PROOF_PICTURE_LIMITATION]);
    expect(store.objects.size).toBe(1);
    expect(store.deleted).toEqual([]);
    // Once the legacy folder is past its 30 days, the limitation is no longer true and is no longer said.
    expect((await eraseUserProofPictures('leaver', store, Date.parse('2027-01-01T00:00:00Z'))).limitations).toEqual([]);
  });

  it('no bucket, an unusable uid, a listing that fails, a delete that fails: each is a failure, never a claimed removal', async () => {
    expect(await eraseUserProofPictures('leaver', null, NOW)).toMatchObject({ ownerPicturesRemoved: false, failures: [expect.stringMatching(/not configured/)] });
    expect(await eraseUserProofPictures('anon', bucketLike(), NOW)).toMatchObject({ ownerPicturesRemoved: false, failures: [expect.stringMatching(/No usable account id/)] });
    const unlisted: ProofPictureStore = { ...bucketLike(), listDays: async () => { throw new Error('down'); } };
    expect(await eraseUserProofPictures('leaver', unlisted, NOW)).toMatchObject({ attempted: true, ownerPicturesRemoved: false, failures: [expect.stringMatching(/could not be listed/)] });
    const store = bucketLike();
    await keepFor(store, 'leaver', 'b-1', 1, NOW);
    const stuck: ProofPictureStore = { ...store, deletePrefix: async () => { throw new Error('denied'); } };
    expect(await eraseUserProofPictures('leaver', stuck, NOW)).toMatchObject({ ownerPicturesRemoved: false, foldersDeleted: 0, failures: [expect.stringMatching(/1 day folder/)] });
  });

  it('DELETE /api/profile calls it with the VERIFIED uid, before the sign-in is removed, and reports it on its own line', () => {
    const profile = readFileSync(join(root, 'src/server/routes/profile.ts'), 'utf8');
    const del = profile.slice(profile.indexOf("app.delete('/api/profile'"));
    const call = del.indexOf('eraseUserProofPictures(identity.uid)');
    expect(call, 'the account deletion route does not erase the game proof pictures').toBeGreaterThan(0);
    expect(call).toBeLessThan(del.indexOf('deleteAuthAccount(identity.uid)'));
    expect(del).toMatch(/\n\s+gameProofPictures,\n/);
  });

  it('the build route files the pictures under the VERIFIED uid, never the client-claimed body field', () => {
    const route = readFileSync(join(root, 'src/server/routes/agentv3.ts'), 'utf8');
    const call = /gameProofKeeper\(\{[^}]*\}\)/.exec(route)?.[0] ?? '';
    expect(call).toMatch(/verifiedOwnerUid: verified\?\.uid/);
    expect(call).not.toMatch(/claimedUid|req\.body|userId/);
  });
});

/**
 * 🔒 THE CENSUS — every server module that touches Cloud Storage, and how its objects leave with their owner's account.
 * `erased-by`: the eraser the account-deletion route calls (checked against profile.ts). `not-per-user`: why no account
 * owns these objects. `open`: the queue row that owns the gap, which must still be in BUILD_REPORT_QUEUE.md.
 */
type Disposition = { erasedBy: string } | { notPerUser: string } | { open: string };
const STORAGE_MODULES: Record<string, Disposition> = {
  'src/server/AgentV3/gameProofPictures.ts': { erasedBy: 'eraseUserProofPictures' },
  'src/server/AgentV3/WorkspaceAssetStore.ts': { erasedBy: 'eraseUserWorkspaceAssetObjects' }, // verified-owner spills; legacy keys are a disclosed limitation
  'src/server/lib/workspaceAssetErase.ts': { erasedBy: 'eraseUserWorkspaceAssetObjects' },
  'src/server/lib/proAttachmentStore.ts': { erasedBy: 'proAttachmentStore.erase' },
  'src/server/AgentV3/bucketPublish.ts': { erasedBy: 'eraseUserSnapshots' }, // published snapshots (Q-795)
  'src/server/lib/domainAutoPublish.ts': { notPerUser: 'copies an already-published app to its custom domain; the source is the published-apps bucket, erased with the snapshots' },
  'src/server/AgentV3/gameAssets/objectStore.ts': { notPerUser: 'content-addressed public-licence game assets shared by every build; nothing in them belongs to a user' },
  'src/server/lib/ShareStore.ts': { erasedBy: 'eraseUserShareHtml' }, // Q-3611: owner-filed pages + legacy ones through their record
  'src/server/lib/navStoreStore.ts': { erasedBy: 'navStoreApkObjects' }, // Q-3612: a never-public listing's APK, before the listing
  'src/server/lib/zipUploadStore.ts': { erasedBy: 'eraseUserZipUploadChunks' }, // Q-3613: chunks before their record, + abandoned sweep
  'src/server/lib/mobileBuild/nativeArtifactStore.ts': { erasedBy: 'eraseUserNativeArtifacts' }, // Q-3614: the owner-hashed folder
};

function serverFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'node_modules' && name !== '__tests__') out.push(...serverFiles(p)); continue; }
    if (/\.(ts|mts)$/.test(name) && !/\.(test|spec)\.ts$/.test(name)) out.push(p);
  }
  return out;
}

describe('🔒 census: every Cloud Storage writer says how its objects leave with the account', () => {
  const STORAGE = /\.storage\(\)\s*\.bucket\(|getStorage\(/;
  const found = [...serverFiles(join(root, 'src/server')), join(root, 'server.ts')]
    .filter((f) => STORAGE.test(readFileSync(f, 'utf8')))
    .map((f) => relative(root, f).split('\\').join('/'))
    .sort();

  it('the scan sees the known modules (it has not gone blind)', () => {
    expect(found).toContain('src/server/AgentV3/gameProofPictures.ts');
    expect(found.length).toBeGreaterThanOrEqual(8);
  });

  it('every module that touches a bucket is registered — a new one must say how its objects reach the eraser', () => {
    const unregistered = found.filter((f) => !(f in STORAGE_MODULES));
    expect(unregistered, 'register it in STORAGE_MODULES: the eraser that deletes its objects with the account, why '
      + 'they belong to no user, or the queue row that owns the gap. An object filed by a build id, token or upload id '
      + 'is invisible to the account eraser (Q-3410).').toEqual([]);
    const stale = Object.keys(STORAGE_MODULES).filter((f) => !found.includes(f));
    expect(stale, 'these registered modules no longer touch storage — remove them').toEqual([]);
  });

  it('each `erasedBy` is really called by DELETE /api/profile, and each `open` row is really in the queue', () => {
    const profile = readFileSync(join(root, 'src/server/routes/profile.ts'), 'utf8');
    const del = profile.slice(profile.indexOf("app.delete('/api/profile'"));
    const queue = readFileSync(join(root, 'BUILD_REPORT_QUEUE.md'), 'utf8');
    for (const [file, d] of Object.entries(STORAGE_MODULES)) {
      if ('erasedBy' in d) expect(del.includes(`${d.erasedBy}(`), `${file}: ${d.erasedBy} is not called by the deletion route`).toBe(true);
      if ('open' in d) expect(queue, `${file}: ${d.open} is not an open queue row — fix the gap or record it`).toMatch(new RegExp(`^\\| ${d.open} \\|`, 'm'));
    }
  });
});
